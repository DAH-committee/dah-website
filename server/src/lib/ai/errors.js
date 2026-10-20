// lib/ai/errors.js: AI 제공업체 호출 오류를 계약의 코드(NOT_CONNECTED, BAD_KEY, RATE_LIMIT, UPSTREAM)로 바꾼다.
// 제공업체가 돌려준 문장은 키처럼 보이는 조각을 지운 뒤 짧게만 사용자에게 보여 준다. 키와 프롬프트는 기록하지 않는다.

export class AiError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** 키로 보이는 문자열(긴 영숫자 토큰, sk-…, AIza…, Bearer …)과 실제 키를 가린다 */
export function maskSecrets(text, apiKey) {
  let s = String(text ?? '')
  if (apiKey && apiKey.length >= 6) s = s.split(apiKey).join('[키]')
  return s
    .replace(/Bearer\s+[\w\-.~+/=]{8,}/gi, 'Bearer [키]')
    .replace(/\b(?:sk|pk|rk|key|gsk|xai|ms|AIza)[-_]?[\w-]{12,}\b/g, '[키]')
    .replace(/[A-Za-z0-9_\-]{28,}/g, '[키]')
}

function upstreamMessage(raw, apiKey) {
  let msg = ''
  try {
    const j = JSON.parse(raw)
    const e = j?.error ?? j
    msg = typeof e === 'string' ? e : e?.message || j?.message || j?.msg || e?.type || ''
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
  } catch {
    msg = String(raw || '').replace(/<[^>]*>/g, ' ')
  }
  return maskSecrets(msg.replace(/\s+/g, ' ').trim(), apiKey).slice(0, 280)
}

/** 실패 응답(상태 코드와 본문)을 AiError 로 바꾼다 */
export async function errorFromResponse(res, apiKey) {
  let raw = ''
  try {
    raw = (await res.text()).slice(0, 4000)
  } catch {
    /* 본문 없음 */
  }
  const detail = upstreamMessage(raw, apiKey)
  const tail = detail ? ` (${detail})` : ''
  const s = res.status
  if (s === 401 || s === 403) return new AiError('BAD_KEY', `제공업체가 키를 받아들이지 않았습니다. 키가 맞는지, 이 계정에서 API를 쓸 수 있는지 확인하세요.${tail}`, 401)
  if (s === 429) return new AiError('RATE_LIMIT', `제공업체의 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도하거나 요금 한도를 확인하세요.${tail}`, 429)
  if (s === 402) return new AiError('UPSTREAM', `제공업체 계정의 잔액이나 결제 상태를 확인하세요.${tail}`, 402)
  if (s === 404) return new AiError('UPSTREAM', `모델이나 주소를 찾을 수 없습니다. 모델 이름을 확인하세요.${tail}`, 404)
  if (s === 413) return new AiError('UPSTREAM', '보낼 내용이 너무 큽니다. 문서 범위를 줄여 다시 시도하세요.', 413)
  if (s >= 300 && s < 400) return new AiError('UPSTREAM', '제공업체 주소가 다른 곳으로 옮겨졌습니다. 주소를 확인하세요.', 502)
  // Gemini 는 틀린 키에 400 과 "API key not valid" 를 돌려준다
  if (s === 400 && /api[ _-]?key.*(not valid|invalid|expired)|invalid[ _-]?api[ _-]?key/i.test(detail)) return new AiError('BAD_KEY', `제공업체가 키를 받아들이지 않았습니다. 키를 다시 확인하세요.`, 401)
  if (s >= 400 && s < 500) return new AiError('UPSTREAM', `요청을 처리하지 못했습니다.${tail}`, 400)
  return new AiError('UPSTREAM', '제공업체 서버가 응답하지 못했습니다. 잠시 뒤 다시 시도하세요.', 502)
}

/** 스트림 중간에 온 오류 이벤트(제공업체 형식)를 AiError 로 */
export function errorFromEvent(kind, message, apiKey) {
  const k = String(kind || '').toLowerCase()
  const detail = maskSecrets(String(message || ''), apiKey).slice(0, 280)
  const tail = detail ? ` (${detail})` : ''
  if (/rate|quota|limit|exhaust/.test(k)) return new AiError('RATE_LIMIT', `제공업체의 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.${tail}`, 429)
  if (/auth|permission|api_key|invalid_api/.test(k)) return new AiError('BAD_KEY', `제공업체가 키를 받아들이지 않았습니다.${tail}`, 401)
  if (/overload|unavailable|server/.test(k)) return new AiError('UPSTREAM', '제공업체가 지금 혼잡합니다. 잠시 뒤 다시 시도하세요.', 502)
  return new AiError('UPSTREAM', `제공업체 오류${tail}`, 502)
}
