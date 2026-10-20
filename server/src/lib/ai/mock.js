// lib/ai/mock.js: 시험용 제공업체 "mock". 환경변수 AI_MOCK=1 일 때만 목록에 나오고 쓸 수 있다(운영에서는 절대 켜지 않는다). 키가 필요 없다.
//
// 마지막 사용자 메시지가 `/mock ` 로 시작하고 뒤가 JSON 이면 그 이벤트를 그대로(조금씩 쉬며) 흘려 보낸다:
//   /mock {"events":[{"type":"text","delta":"안녕"},{"type":"tool_call","name":"read_document","args":{"from":1}}]}
//   선택 필드: "delayMs"(이벤트 사이 간격, 기본 15), "error":{"code":"UPSTREAM","message":"..."}(오류 이벤트로 끝냄)
//   tool_call 의 id 는 없으면 만들어 준다. tool_call 이 하나라도 있으면 done.stopReason 은 'tool_use', 아니면 'end'.
// 마지막 메시지가 도구 결과(role 'tool')면 "도구 결과를 받았습니다: <앞 80자>" 로 답한다(이어서 호출하는 도구 없음).
// 그 밖에는 "에코: <내용>" 으로 답한다(이미지가 있으면 "이미지 N장" 도 붙인다).
import { AiError } from './errors.js'
import { sleep } from './util.js'

export async function listModels() {
  return { models: [{ id: 'mock-1', name: 'Mock 1' }, { id: 'mock-2', name: 'Mock 2' }], suggested: 'mock-1' }
}

export async function* stream(c) {
  const last = c.messages[c.messages.length - 1] || {}
  if (c.model && !/^mock/.test(c.model)) throw new AiError('UPSTREAM', '모델을 찾을 수 없습니다.', 404)
  let seq = 0
  if (last.role === 'tool') {
    await sleep(15, c.signal)
    yield { type: 'text', delta: `도구 결과를 받았습니다: ${String(last.content ?? '').slice(0, 80)}` }
    yield { type: 'done', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
    return
  }
  const text = String(last.content || '')
  if (last.role === 'user' && text.startsWith('/mock ')) {
    let spec
    try {
      spec = JSON.parse(text.slice(6))
    } catch {
      throw new AiError('UPSTREAM', '/mock 뒤의 JSON 을 읽을 수 없습니다.', 400)
    }
    const delay = Number.isFinite(spec.delayMs) ? Math.max(0, Math.min(spec.delayMs, 2000)) : 15
    let tools = false
    for (const ev of Array.isArray(spec.events) ? spec.events : []) {
      await sleep(delay, c.signal)
      if (c.signal?.aborted) return
      if (ev.type === 'text') yield { type: 'text', delta: String(ev.delta ?? '') }
      else if (ev.type === 'tool_call') {
        tools = true
        yield { type: 'tool_call', id: ev.id || `mock_${++seq}_${Math.random().toString(36).slice(2, 6)}`, name: String(ev.name), args: ev.args && typeof ev.args === 'object' ? ev.args : {}, ...(ev.meta !== undefined ? { meta: ev.meta } : {}) }
      }
    }
    if (spec.error) throw new AiError(String(spec.error.code || 'UPSTREAM'), String(spec.error.message || '시험 오류'), 502)
    yield { type: 'done', stopReason: tools ? 'tool_use' : 'end', usage: { inputTokens: 1, outputTokens: 1 } }
    return
  }
  const pieces = [`에코: ${text}`, ...(last.images?.length ? [` (이미지 ${last.images.length}장)`] : [])]
  for (const p of pieces) {
    await sleep(15, c.signal)
    yield { type: 'text', delta: p }
  }
  yield { type: 'done', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

export default { listModels, stream }
