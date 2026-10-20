// lib/ai/anthropic.js: Claude (Anthropic Messages API)
// 확인한 공식 문서(2026-10-12):
//   스트리밍 이벤트  https://docs.anthropic.com/en/api/messages-streaming  (message_start, content_block_start/delta/stop, message_delta, message_stop, error)
//   모델 목록        https://platform.claude.com/docs/en/api/models/list   (GET /v1/models, limit 1..1000, data[].id/display_name/lifecycle/line)
//   도구 결과        https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls  (tool_use -> user 메시지의 tool_result)
//   이미지           https://platform.claude.com/docs/en/build-with-claude/vision  (image 블록, source.type=base64)
// 헤더: x-api-key, anthropic-version: 2023-06-01. 생각(thinking)은 보내지 않아 꺼 둔다(응답이 빠르다).
import { AiError, errorFromEvent, errorFromResponse } from './errors.js'
import { parseJson, parseSse } from './sse.js'
import { cleanId, pickDefault, splitDataUrl } from './util.js'

const VERSION = '2023-06-01'
const headers = (key) => ({ 'x-api-key': key, 'anthropic-version': VERSION, 'content-type': 'application/json' })

export async function listModels(c) {
  const res = await c.call('/v1/models?limit=1000', { method: 'GET', headers: headers(c.apiKey), signal: c.signal })
  if (!res.ok) throw await errorFromResponse(res, c.apiKey)
  const j = await res.json().catch(() => null)
  const models = (j?.data || [])
    .filter((m) => m?.id && m.lifecycle !== 'deprecated' && m.lifecycle !== 'retired')
    .map((m) => ({ id: m.id, name: m.display_name || m.id, line: m.line || null }))
  const sonnet = models.filter((m) => m.line === 'sonnet' || /sonnet/.test(m.id))
  const suggested = (sonnet[0] || models[0])?.id || null // 목록은 최신순이다
  return { models: models.map(({ id, name }) => ({ id, name })), suggested: suggested || pickDefault(models, []) }
}

function toMessages(messages) {
  const out = []
  const push = (role, blocks) => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  for (const m of messages) {
    if (m.role === 'user') {
      const blocks = []
      for (const url of m.images || []) {
        const img = splitDataUrl(url)
        if (img) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } })
      }
      if (m.content) blocks.push({ type: 'text', text: m.content })
      push('user', blocks)
    } else if (m.role === 'assistant') {
      const blocks = []
      for (const b of m.meta?.blocks || []) if (b?.type === 'thinking' || b?.type === 'redacted_thinking') blocks.push(b)
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const t of m.toolCalls || []) blocks.push({ type: 'tool_use', id: cleanId(t.id), name: t.name, input: t.args && typeof t.args === 'object' ? t.args : {} })
      push('assistant', blocks)
    } else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: cleanId(m.toolCallId), content: String(m.content ?? '') || '(빈 결과)' }])
    }
  }
  // tool_result 블록은 같은 user 메시지에서 앞에 와야 한다
  for (const m of out) if (m.role === 'user') m.content.sort((a, b) => (b.type === 'tool_result') - (a.type === 'tool_result'))
  return out
}

export async function* stream(c) {
  const body = {
    model: c.model,
    max_tokens: c.maxTokens || 8192,
    stream: true,
    messages: toMessages(c.messages),
  }
  if (c.system) body.system = c.system
  if (c.temperature !== undefined) body.temperature = c.temperature
  if (c.tools?.length) body.tools = c.tools.map((t) => ({ name: t.name, description: t.description || '', input_schema: t.parameters || { type: 'object', properties: {} } }))

  const res = await c.call('/v1/messages', { method: 'POST', headers: { ...headers(c.apiKey), accept: 'text/event-stream' }, body: JSON.stringify(body), signal: c.signal })
  if (!res.ok) throw await errorFromResponse(res, c.apiKey)

  const blocks = new Map() // index -> { type, id, name, json, thinking, signature, data }
  const kept = [] // 되돌려 보내야 하는 thinking 블록
  let stop = 'end'
  let usage = { inputTokens: 0, outputTokens: 0 }
  let sawTool = false
  for await (const ev of parseSse(res)) {
    const d = parseJson(ev.data)
    if (!d) continue
    switch (d.type) {
      case 'message_start':
        usage.inputTokens = d.message?.usage?.input_tokens ?? 0
        break
      case 'content_block_start': {
        const b = d.content_block || {}
        blocks.set(d.index, { type: b.type, id: b.id, name: b.name, json: '', thinking: b.thinking || '', signature: b.signature || '', data: b.data })
        break
      }
      case 'content_block_delta': {
        const b = blocks.get(d.index)
        const x = d.delta || {}
        if (x.type === 'text_delta' && x.text) yield { type: 'text', delta: x.text }
        else if (x.type === 'input_json_delta' && b) b.json += x.partial_json || ''
        else if (x.type === 'thinking_delta' && b) b.thinking += x.thinking || ''
        else if (x.type === 'signature_delta' && b) b.signature = x.signature || ''
        break
      }
      case 'content_block_stop': {
        const b = blocks.get(d.index)
        if (!b) break
        if (b.type === 'tool_use') {
          sawTool = true
          yield { type: 'tool_call', id: b.id, name: b.name, args: b.json ? parseJson(b.json) || {} : {} }
        } else if (b.type === 'thinking') kept.push({ type: 'thinking', thinking: b.thinking, signature: b.signature })
        else if (b.type === 'redacted_thinking') kept.push({ type: 'redacted_thinking', data: b.data })
        blocks.delete(d.index)
        break
      }
      case 'message_delta':
        if (d.delta?.stop_reason) stop = d.delta.stop_reason
        if (d.usage?.output_tokens !== undefined) usage.outputTokens = d.usage.output_tokens
        break
      case 'error':
        throw errorFromEvent(d.error?.type, d.error?.message, c.apiKey)
      case 'message_stop': {
        const stopReason = stop === 'tool_use' || sawTool ? 'tool_use' : stop === 'max_tokens' ? 'length' : 'end'
        yield { type: 'done', stopReason, usage, ...(kept.length ? { meta: { blocks: kept } } : {}) }
        return
      }
      default:
        break
    }
  }
  throw new AiError('UPSTREAM', '응답이 중간에 끊겼습니다. 다시 시도하세요.')
}

export default { listModels, stream }
