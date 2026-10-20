// lib/ai/gemini.js: Gemini (Generative Language API, generateContent 계열)
// 확인한 공식 문서(2026-10-12):
//   스트리밍       https://ai.google.dev/api/generate-content  (POST /v1beta/models/{model}:streamGenerateContent?alt=sse, 본문 contents / systemInstruction / tools / generationConfig.maxOutputTokens)
//   인증 헤더      https://ai.google.dev/gemini-api/docs/api-key  (x-goog-api-key)
//   함수 선언      같은 문서의 FunctionDeclaration: name, description, parametersJsonSchema(JSON 스키마 그대로)
//   함수 응답      Part.functionResponse{id?, name, response(객체)}, Part.functionCall{id?, name, args}
//   생각 서명      Part.thoughtSignature (불투명 문자열, https://ai.google.dev/gemini-api/docs/thought-signatures): 받은 그대로 같은 파트에 되돌려 보낸다 -> meta 로 통과시킨다
//   모델 목록      https://ai.google.dev/api/models  (GET /v1beta/models?pageSize=1000, models[].name/displayName/supportedGenerationMethods)
// 참고: 같은 사이트의 함수 호출 안내 문서는 새 Interactions API 를 먼저 소개하지만, generateContent 는 API 레퍼런스에 그대로 있다.
import { AiError, errorFromResponse } from './errors.js'
import { parseJson, parseSse } from './sse.js'
import { cmpVersion, resultObject, splitDataUrl } from './util.js'

const headers = (key) => ({ 'x-goog-api-key': key, 'content-type': 'application/json' })
const SKIP_RE = /(embedding|tts|image|live|audio|robotics|computer-use|aqa|imagen|veo|gemma|learnlm|native|vision)/

export async function listModels(c) {
  const res = await c.call('/v1beta/models?pageSize=1000', { method: 'GET', headers: headers(c.apiKey), signal: c.signal })
  if (!res.ok) throw await errorFromResponse(res, c.apiKey)
  const j = await res.json().catch(() => null)
  const models = (j?.models || [])
    .filter((m) => m?.name && (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || m.name }))
    .filter((m) => /^gemini/.test(m.id) && !SKIP_RE.test(m.id))
    .sort((a, b) => cmpVersion(a.id, b.id))
  const flash = models.filter((m) => /flash/.test(m.id) && !/lite/.test(m.id))
  const suggested = (models.find((m) => m.id === 'gemini-flash-latest') || flash.find((m) => !/preview|exp/.test(m.id)) || flash[0] || models[0])?.id || null
  return { models, suggested }
}

function toContents(messages) {
  const calls = new Map() // toolCallId -> { name, gid }
  for (const m of messages) for (const t of m.toolCalls || []) calls.set(t.id, { name: t.name, gid: t.meta?.gid })
  const out = []
  const push = (role, parts) => {
    if (!parts.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.parts.push(...parts)
    else out.push({ role, parts })
  }
  for (const m of messages) {
    if (m.role === 'user') {
      const parts = []
      for (const url of m.images || []) {
        const img = splitDataUrl(url)
        if (img) parts.push({ inlineData: { mimeType: img.mime, data: img.data } })
      }
      if (m.content) parts.push({ text: m.content })
      push('user', parts)
    } else if (m.role === 'assistant') {
      const parts = []
      if (m.content) parts.push({ text: m.content, ...(m.meta?.textSignature ? { thoughtSignature: m.meta.textSignature } : {}) })
      for (const t of m.toolCalls || []) {
        parts.push({
          functionCall: { ...(t.meta?.gid ? { id: t.meta.gid } : {}), name: t.name, args: t.args && typeof t.args === 'object' ? t.args : {} },
          ...(t.meta?.sig ? { thoughtSignature: t.meta.sig } : {}),
        })
      }
      push('model', parts)
    } else if (m.role === 'tool') {
      const info = calls.get(m.toolCallId) || {}
      push('user', [{ functionResponse: { ...(info.gid ? { id: info.gid } : {}), name: info.name || m.toolName || 'tool', response: resultObject(m.content) } }])
    }
  }
  return out
}

export async function* stream(c) {
  const model = String(c.model || '').replace(/^models\//, '')
  if (!/^[\w.\-]{1,100}$/.test(model)) throw new AiError('UPSTREAM', '모델 이름이 올바르지 않습니다.', 400)
  const body = { contents: toContents(c.messages), generationConfig: {} }
  if (c.system) body.systemInstruction = { parts: [{ text: c.system }] }
  if (c.maxTokens) body.generationConfig.maxOutputTokens = c.maxTokens
  if (c.temperature !== undefined) body.generationConfig.temperature = c.temperature
  if (c.tools?.length) body.tools = [{ functionDeclarations: c.tools.map((t) => ({ name: t.name, description: t.description || '', parametersJsonSchema: t.parameters || { type: 'object', properties: {} } })) }]

  const res = await c.call(`/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { ...headers(c.apiKey), accept: 'text/event-stream' }, body: JSON.stringify(body), signal: c.signal })
  if (!res.ok) throw await errorFromResponse(res, c.apiKey)

  let finish = ''
  let sawTool = false
  let usage
  let textSignature
  let n = 0
  for await (const ev of parseSse(res)) {
    const d = parseJson(ev.data)
    if (!d) continue
    if (d.error) throw new AiError('UPSTREAM', `제공업체 오류 (${String(d.error.message || '').slice(0, 200)})`)
    if (d.promptFeedback?.blockReason) throw new AiError('UPSTREAM', '입력 내용이 제공업체 안전 정책에 걸려 처리되지 않았습니다.', 400)
    if (d.usageMetadata) usage = { inputTokens: d.usageMetadata.promptTokenCount ?? 0, outputTokens: (d.usageMetadata.candidatesTokenCount ?? 0) + (d.usageMetadata.thoughtsTokenCount ?? 0) }
    const cand = d.candidates?.[0]
    for (const p of cand?.content?.parts || []) {
      if (p.functionCall) {
        sawTool = true
        const fc = p.functionCall
        yield { type: 'tool_call', id: fc.id || `call_${++n}_${Math.random().toString(36).slice(2, 8)}`, name: fc.name, args: fc.args && typeof fc.args === 'object' ? fc.args : {}, meta: { ...(p.thoughtSignature ? { sig: p.thoughtSignature } : {}), ...(fc.id ? { gid: fc.id } : {}) } }
      } else if (typeof p.text === 'string') {
        if (p.thoughtSignature) textSignature = p.thoughtSignature
        if (p.thought) continue // 생각 요약은 보여 주지 않는다
        if (p.text) yield { type: 'text', delta: p.text }
      }
    }
    if (cand?.finishReason) finish = cand.finishReason
  }
  if (!finish && !sawTool) throw new AiError('UPSTREAM', '응답이 중간에 끊겼습니다. 다시 시도하세요.')
  if (/SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII/.test(finish) && !sawTool) throw new AiError('UPSTREAM', '제공업체 안전 정책 때문에 응답이 중단되었습니다.', 400)
  yield { type: 'done', stopReason: sawTool ? 'tool_use' : finish === 'MAX_TOKENS' ? 'length' : 'end', ...(usage ? { usage } : {}), ...(textSignature ? { meta: { textSignature } } : {}) }
}

export default { listModels, stream }
