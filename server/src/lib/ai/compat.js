// lib/ai/compat.js: OpenAI 호환 Chat Completions (DeepSeek, Kimi, Qwen, GLM, 직접 입력 주소)
// 확인한 공식 문서(2026-10-12):
//   DeepSeek   https://api-docs.deepseek.com/            기준 주소 https://api.deepseek.com, POST /chat/completions, GET /models (Bearer)
//   Kimi       https://platform.moonshot.ai/docs/api/chat  기준 주소 https://api.moonshot.ai/v1, stream_options.include_usage, 추론 모델은 reasoning_content 를 되돌려 보낸다
//   Qwen       https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
//              싱가포르는 작업공간 주소({WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1)로 옮기는 중이고 예전 dashscope-intl.aliyuncs.com 도 쓸 수 있다. 키는 만든 지역에서만 동작한다.
//   GLM        https://docs.z.ai/api-reference/introduction  기준 주소 https://api.z.ai/api/paas/v4, thinking:{type:"disabled"} 로 생각을 끌 수 있다
// 스트림은 choices[0].delta.content / reasoning_content / tool_calls[index] 조각을 이어 붙인다.
import { AiError, errorFromEvent, errorFromResponse } from './errors.js'
import { parseJson, parseSse } from './sse.js'
import { cleanId, pickDefault, safeJson } from './util.js'

const headers = (key) => ({ Authorization: `Bearer ${key}`, 'content-type': 'application/json' })

export async function listModels(c) {
  const res = await c.call('/models', { method: 'GET', headers: headers(c.apiKey), signal: c.signal })
  if (!res.ok) {
    const err = await errorFromResponse(res, c.apiKey)
    if (c.def.id === 'custom' && (res.status === 404 || res.status === 405)) return { models: [], suggested: null, unverified: true }
    throw err
  }
  const j = await res.json().catch(() => null)
  const models = (j?.data || j?.models || []).filter((m) => m?.id).map((m) => ({ id: String(m.id), name: String(m.id) }))
  return { models, suggested: pickDefault(models, c.def.prefer || []) }
}

function toMessages(messages, system) {
  const out = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        const parts = []
        if (m.content) parts.push({ type: 'text', text: m.content })
        for (const url of m.images) parts.push({ type: 'image_url', image_url: { url } })
        out.push({ role: 'user', content: parts })
      } else out.push({ role: 'user', content: m.content || ' ' })
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || '' }
      if (m.toolCalls?.length) {
        if (m.meta?.reasoning_content) msg.reasoning_content = m.meta.reasoning_content // 도구를 부른 차례의 추론은 되돌려 보내야 한다(DeepSeek·Kimi·GLM 문서)
        msg.tool_calls = m.toolCalls.map((t) => ({ id: cleanId(t.id), type: 'function', function: { name: t.name, arguments: safeJson(t.args) } }))
        if (!msg.content) msg.content = null
      }
      if (msg.content === '' && !msg.tool_calls) continue
      out.push(msg)
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: cleanId(m.toolCallId), content: String(m.content ?? '') })
    }
  }
  return out
}

export async function* stream(c) {
  const body = { model: c.model, messages: toMessages(c.messages, c.system), stream: true }
  if (c.def.usage !== false) body.stream_options = { include_usage: true }
  if (c.maxTokens) body.max_tokens = c.maxTokens
  if (c.temperature !== undefined) body.temperature = c.temperature
  if (c.def.extraBody) Object.assign(body, c.def.extraBody)
  if (c.tools?.length) body.tools = c.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } } }))

  const res = await c.call('/chat/completions', { method: 'POST', headers: { ...headers(c.apiKey), accept: 'text/event-stream' }, body: JSON.stringify(body), signal: c.signal })
  if (!res.ok) throw await errorFromResponse(res, c.apiKey)

  const calls = new Map() // index -> { id, name, args }
  let reasoning = ''
  let finish = ''
  let usage
  let finished = false
  const flush = function* () {
    for (const [, t] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (!t.name) continue
      yield { type: 'tool_call', id: t.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: t.name, args: t.args ? parseJson(t.args) || {} : {} }
    }
  }
  for await (const ev of parseSse(res)) {
    if (ev.data === '[DONE]') {
      finished = true
      break
    }
    const d = parseJson(ev.data)
    if (!d) continue
    if (d.error) throw errorFromEvent(d.error.type || d.error.code, d.error.message, c.apiKey)
    if (d.usage) usage = { inputTokens: d.usage.prompt_tokens ?? 0, outputTokens: d.usage.completion_tokens ?? 0 }
    const ch = d.choices?.[0]
    if (!ch) continue
    const delta = ch.delta || {}
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content
    if (typeof delta.content === 'string' && delta.content) yield { type: 'text', delta: delta.content }
    for (const t of delta.tool_calls || []) {
      const i = t.index ?? 0
      const cur = calls.get(i) || { id: '', name: '', args: '' }
      if (t.id) cur.id = t.id
      if (t.function?.name) cur.name += t.function.name
      if (t.function?.arguments) cur.args += t.function.arguments
      calls.set(i, cur)
    }
    if (ch.finish_reason) finish = ch.finish_reason
  }
  if (!finished && !finish) throw new AiError('UPSTREAM', '응답이 중간에 끊겼습니다. 다시 시도하세요.')
  let sawTool = false
  for (const ev of flush()) {
    sawTool = true
    yield ev
  }
  yield { type: 'done', stopReason: sawTool || finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'length' : 'end', ...(usage ? { usage } : {}), ...(reasoning ? { meta: { reasoning_content: reasoning } } : {}) }
}

export default { listModels, stream }
