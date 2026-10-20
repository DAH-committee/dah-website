// lib/ai/openai.js: OpenAI (Responses API)
// 확인한 공식 문서(2026-10-12):
//   Responses 권장      https://platform.openai.com/docs/guides/migrate-to-responses ("Responses is recommended for all new projects",
//                       GPT-5.4부터 Chat Completions 는 reasoning_effort 가 none 이 아니면 도구 호출을 지원하지 않는다)
//   요청 필드           https://developers.openai.com/api/reference/resources/responses/methods/create
//                       (instructions, input, tools[type=function,name,description,parameters,strict], max_output_tokens, store, include=reasoning.encrypted_content, input_image.image_url = data URL 가능)
//   스트리밍 이벤트     https://developers.openai.com/api/reference/resources/responses/streaming-events
//                       (response.output_text.delta, response.output_item.done, response.completed / incomplete / failed, error)
//   함수 호출           https://platform.openai.com/docs/guides/function-calling
//                       (output 의 function_call{call_id,name,arguments} -> input 의 function_call_output{call_id,output}. 추론 모델은 reasoning 항목도 함께 돌려보내야 한다)
//   모델 목록           https://developers.openai.com/api/reference/resources/models/methods/list  (GET /v1/models, Authorization: Bearer)
// 저장 안 함(store:false)으로 보내고, 응답의 output 항목을 meta.output 으로 그대로 보관했다가 다음 요청에 되돌려 보낸다(서버는 상태를 갖지 않는다).
import { AiError, errorFromEvent, errorFromResponse } from './errors.js'
import { parseJson, parseSse } from './sse.js'
import { cleanId, pickDefault, safeJson } from './util.js'

const headers = (key) => ({ Authorization: `Bearer ${key}`, 'content-type': 'application/json' })

// 채팅에 쓸 수 있는 모델만 남긴다(이미지·음성·임베딩·검색·날짜가 붙은 스냅샷 등 제외)
const CHAT_RE = /^(gpt-|o\d|chatgpt-)/
const SKIP_RE = /(audio|realtime|transcribe|tts|image|embedding|moderation|search|instruct|codex|dall|whisper|davinci|babbage|computer-use|deep-research|sora|-\d{4}-\d{2}-\d{2}$|-\d{4}$|^gpt-3\.5|-preview$)/

export async function listModels(c) {
  const res = await c.call('/v1/models', { method: 'GET', headers: headers(c.apiKey), signal: c.signal })
  if (!res.ok) throw await errorFromResponse(res, c.apiKey)
  const j = await res.json().catch(() => null)
  const all = (j?.data || []).filter((m) => m?.id)
  const picked = all.filter((m) => CHAT_RE.test(m.id) && !SKIP_RE.test(m.id)).sort((a, b) => (b.created || 0) - (a.created || 0))
  const models = (picked.length ? picked : all).map((m) => ({ id: m.id, name: m.id }))
  const suggested = pickDefault(models, [/^gpt-\d+(\.\d+)?-mini$/, /^gpt-\d+(\.\d+)?$/])
  return { models, suggested }
}

function toInput(messages) {
  const input = []
  for (const m of messages) {
    if (m.role === 'user') {
      const content = []
      if (m.content) content.push({ type: 'input_text', text: m.content })
      for (const url of m.images || []) content.push({ type: 'input_image', image_url: url })
      if (content.length) input.push({ role: 'user', content })
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.meta?.output) && m.meta.output.length) {
        input.push(...m.meta.output) // 이 제공업체가 만든 응답은 항목을 그대로 되돌려 준다
      } else {
        if (m.content) input.push({ role: 'assistant', content: m.content })
        for (const t of m.toolCalls || []) input.push({ type: 'function_call', call_id: cleanId(t.id), name: t.name, arguments: safeJson(t.args) })
      }
    } else if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: cleanId(m.toolCallId), output: String(m.content ?? '') })
    }
  }
  return input
}

async function open(c, withEncrypted) {
  const body = { model: c.model, input: toInput(c.messages), stream: true, store: false }
  if (c.system) body.instructions = c.system
  if (c.maxTokens) body.max_output_tokens = Math.max(16, c.maxTokens)
  if (c.tools?.length) body.tools = c.tools.map((t) => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} }, strict: false }))
  if (withEncrypted) body.include = ['reasoning.encrypted_content']
  return c.call('/v1/responses', { method: 'POST', headers: { ...headers(c.apiKey), accept: 'text/event-stream' }, body: JSON.stringify(body), signal: c.signal })
}

export async function* stream(c) {
  let res = await open(c, true)
  if (res.status === 400) {
    // 추론하지 않는 모델은 암호화된 추론 내용을 받을 수 없다고 거절한다: 그 항목 없이 한 번 더
    const text = await res.clone().text().catch(() => '')
    if (/encrypted/i.test(text)) res = await open(c, false)
  }
  if (!res.ok) throw await errorFromResponse(res, c.apiKey)

  const output = []
  let sawTool = false
  let usage
  for await (const ev of parseSse(res)) {
    const d = parseJson(ev.data)
    if (!d) continue
    switch (d.type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        if (d.delta) yield { type: 'text', delta: d.delta }
        break
      case 'response.output_item.done': {
        const it = d.item
        if (!it) break
        if (it.type === 'function_call') {
          sawTool = true
          output.push(it)
          yield { type: 'tool_call', id: it.call_id, name: it.name, args: parseJson(it.arguments || '{}') || {} }
        } else if (it.type === 'reasoning') {
          if (it.encrypted_content) output.push(it)
        } else if (it.type === 'message') {
          output.push(it)
        }
        break
      }
      case 'response.completed':
      case 'response.incomplete': {
        const r = d.response || {}
        if (r.usage) usage = { inputTokens: r.usage.input_tokens ?? 0, outputTokens: r.usage.output_tokens ?? 0 }
        const length = d.type === 'response.incomplete' && /max_output_tokens|length/.test(r.incomplete_details?.reason || '')
        yield { type: 'done', stopReason: sawTool ? 'tool_use' : length ? 'length' : 'end', ...(usage ? { usage } : {}), ...(sawTool && output.length ? { meta: { output } } : {}) }
        return
      }
      case 'response.failed':
        throw errorFromEvent(d.response?.error?.code, d.response?.error?.message, c.apiKey)
      case 'error':
        throw errorFromEvent(d.code || d.error?.code, d.message || d.error?.message, c.apiKey)
      default:
        break
    }
  }
  throw new AiError('UPSTREAM', '응답이 중간에 끊겼습니다. 다시 시도하세요.')
}

export default { listModels, stream }
