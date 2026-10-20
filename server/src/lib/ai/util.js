// lib/ai/util.js: 어댑터가 함께 쓰는 작은 도구
export const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/

/** data URL -> { mime, data } (허용하지 않는 형식이면 null) */
export function splitDataUrl(url) {
  const m = DATA_URL_RE.exec(String(url || ''))
  return m ? { mime: m[1], data: m[2] } : null
}

/** "gpt-5.4-mini" 같은 이름에서 버전 숫자 배열을 뽑는다. 못 찾으면 null */
export function versionOf(id) {
  const m = /(?:^|[^\d.])(\d+(?:\.\d+)*)/.exec(String(id).replace(/^models\//, ''))
  return m ? m[1].split('.').map(Number) : null
}
export function cmpVersion(a, b) {
  const x = versionOf(a) || []
  const y = versionOf(b) || []
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** 목록에서 패턴 순서대로 첫 일치를 고르고(같은 패턴 안에서는 버전이 높은 것), 없으면 첫 항목 */
export function pickDefault(models, patterns = []) {
  for (const re of patterns) {
    const hits = models.filter((m) => re.test(m.id))
    if (hits.length) return [...hits].sort((a, b) => cmpVersion(a.id, b.id))[0].id
  }
  return models[0]?.id || null
}

export const safeJson = (v) => {
  try {
    return JSON.stringify(v ?? {})
  } catch {
    return '{}'
  }
}

/** 도구 결과 문자열이 JSON 객체면 객체로, 아니면 { result } 로 */
export function resultObject(content) {
  const s = String(content ?? '')
  try {
    const v = JSON.parse(s)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
    return { result: v }
  } catch {
    return { result: s }
  }
}

/** 도구 호출 id 를 제공업체가 받는 문자로 맞춘다(호출과 결과에 같은 규칙을 쓴다) */
export const cleanId = (id) => String(id || 'call').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'call'

export const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })
