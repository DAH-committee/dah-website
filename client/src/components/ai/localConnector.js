// localConnector.js: "내 컴퓨터의 ChatGPT 연결"(DAH Connect, 이 저장소의 connector/) 제공업체의 브라우저 쪽 로직.
// 브라우저 -> http://127.0.0.1:<포트> 로 직접 부른다. 우리 서버(/api/ai/*)를 거치지 않고, 토큰은 이 화면에 오지 않는다.
// 화면이 저장하는 것은 짝짓기 비밀값(연결 프로그램이 알려 준 무작위 값)뿐이고, localStorage 의 이 연결 프로그램 설치 한 곳에만 쓰인다.
// 계약: connector/README.md, connector/lib/server.mjs
export const LOCAL_PROVIDER_ID = 'chatgpt-local'
export const LOCAL_PROVIDER_NAME = '내 컴퓨터의 ChatGPT 연결'
export const LOCAL_PORTS = [47684, 47685, 47686, 47687, 47688]
export const USAGE_URL = 'https://chatgpt.com/settings/usage'
// 연결 프로그램을 받는 곳(별도 공개 저장소). 저장소를 만들면 이 값만 바꾸면 된다.
export const CONNECTOR_DOWNLOAD_URL = 'https://github.com/hyunho2378/dah-connect'

const PAIR_KEY = 'dah-ai:local-pair'
const MODEL_KEY = 'dah-ai:local-model'
const PROBE_TIMEOUT_MS = 1500

/** 이 파일이 던지는 오류(code, message). aiClient 쪽에서 AiError 로 바뀐다 */
export class LocalError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

const toError = (m, status) => new LocalError(m.code, m.message, status)

export const isLocalProvider = (id) => id === LOCAL_PROVIDER_ID

// ── 저장 ─────────────────────────────────────────────────────
export function loadPairing(storage = globalThis.localStorage) {
  try {
    const j = JSON.parse(storage?.getItem(PAIR_KEY) || 'null')
    return j && typeof j.secret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(j.secret) && Number.isInteger(j.port) ? j : null
  } catch {
    return null
  }
}
export function savePairing(p, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PAIR_KEY, JSON.stringify({ port: p.port, secret: p.secret, installId: p.installId || '' }))
  } catch {
    /* 저장 공간이 없으면 이번 탭에서만 쓴다 */
  }
}
export function clearPairing(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(PAIR_KEY)
  } catch {
    /* 무시 */
  }
}
export function loadLocalModel(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(MODEL_KEY) || ''
  } catch {
    return ''
  }
}
export function saveLocalModel(id, storage = globalThis.localStorage) {
  try {
    storage?.setItem(MODEL_KEY, id || '')
  } catch {
    /* 무시 */
  }
}

/** aiClient.listProviders 가 서버 목록 뒤에 붙이는 항목. "연결됨" 은 짝짓기를 마쳤다는 뜻이다(프로그램이 지금 켜져 있는지는 상태 창이 따로 확인) */
export function localProviderEntry(storage = globalThis.localStorage) {
  const p = loadPairing(storage)
  return {
    id: LOCAL_PROVIDER_ID,
    name: LOCAL_PROVIDER_NAME,
    authType: 'local',
    local: true,
    keyUrl: CONNECTOR_DOWNLOAD_URL,
    keyHelp: '내 컴퓨터에서 도는 작은 프로그램으로 내 ChatGPT 요금제를 씁니다.',
    connected: Boolean(p),
    keyHint: null,
    model: loadLocalModel(storage) || null,
    maxTokens: null,
    needsBaseUrl: false,
    allowBaseUrl: false,
  }
}

// ── 오류 ─────────────────────────────────────────────────────
export const LOCAL_ERROR_CODES = ['LOCAL_NOT_RUNNING', 'LOCAL_NOT_PAIRED', 'LOCAL_RECONNECT']

/** 연결 프로그램이 돌려준 {status, json} 를 화면 오류 {code, message} 로. 순수 함수 */
export function mapConnectorError(status, json) {
  const code = json?.code
  const msg = typeof json?.error === 'string' ? json.error : ''
  if (code === 'UNAUTHORIZED' || (status === 401 && !code)) return { code: 'LOCAL_NOT_PAIRED', message: '연결 프로그램과의 연결이 풀렸습니다. 설정에서 연결 코드를 다시 입력하세요.' }
  if (code === 'NOT_LOGGED_IN') return { code: 'LOCAL_RECONNECT', message: '연결 프로그램에 ChatGPT 로그인이 필요합니다. 연결 프로그램 창에서 로그인하세요.' }
  if (code === 'RECONNECT') return { code: 'LOCAL_RECONNECT', message: 'ChatGPT 로그인이 끊겼습니다(철회되었거나 만료). 연결 프로그램에서 다시 로그인하세요.' }
  if (code === 'PLAN_DISABLED') return { code: 'LOCAL_RECONNECT', message: 'ChatGPT 요금제 사용을 허용하지 않은 상태입니다. 연결 프로그램에서 다시 로그인해 허용하세요.' }
  if (code === 'PLAN_LIMIT') return { code, message: msg || 'ChatGPT 사용 한도에 도달했습니다. ChatGPT 설정의 사용량에서 확인하세요.' }
  if (code === 'BAD_HOST' || code === 'ORIGIN_NOT_ALLOWED') return { code: 'LOCAL_NOT_RUNNING', message: '이 사이트 주소는 연결 프로그램이 허용한 목록에 없습니다. 연결 프로그램을 최신 버전으로 받으세요.' }
  if (code === 'PAIR_LOCKED') return { code, message: msg }
  return { code: code || (status === 429 ? 'RATE_LIMIT' : status === 413 ? 'TOO_LARGE' : 'UPSTREAM'), message: msg || `요청에 실패했습니다 (${status})` }
}

export const NOT_RUNNING_MESSAGE = '내 컴퓨터의 연결 프로그램에 닿지 못했습니다. "연결 프로그램 시작"이 켜져 있는지 확인하세요. 브라우저가 "내 컴퓨터의 앱 접근" 허용을 물으면 허용해야 합니다.'

// ── 네트워크 ─────────────────────────────────────────────────
const urlOf = (port, path) => `http://127.0.0.1:${port}${path}`

async function probe(port, signal, fetchImpl) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS)
  const onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetchImpl(urlOf(port, '/status'), { signal: ac.signal, cache: 'no-store' })
    const j = await res.json().catch(() => null)
    return res.ok && j?.app === 'DAH Connect' ? j : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 열려 있는 연결 프로그램을 찾는다. 저장된 포트를 먼저 본다. 반환: { port, info } | null */
export async function findConnector({ signal, fetchImpl = globalThis.fetch, storage } = {}) {
  const saved = loadPairing(storage)
  const order = [...new Set([saved?.port, ...LOCAL_PORTS].filter(Boolean))]
  for (const port of order) {
    const info = await probe(port, signal, fetchImpl)
    if (info) return { port, info }
  }
  return null
}

/**
 * 화면용 상태. state:
 *  searching(호출 쪽에서 쓰는 값) | not_running | not_paired | bad_pair | not_logged_in | reconnect | plan_disabled | ready
 */
export async function getLocalStatus({ signal, fetchImpl = globalThis.fetch, storage } = {}) {
  const found = await findConnector({ signal, fetchImpl, storage })
  if (!found) return { state: 'not_running' }
  const pair = loadPairing(storage)
  const sameInstall = pair && (!pair.installId || pair.installId === found.info.installId)
  if (!pair || !sameInstall) return { state: 'not_paired', port: found.port, installId: found.info.installId }
  try {
    const res = await fetchImpl(urlOf(found.port, '/status'), { headers: { Authorization: `Bearer ${pair.secret}` }, signal, cache: 'no-store' })
    const j = await res.json().catch(() => null)
    if (res.status === 401) return { state: 'bad_pair', port: found.port, installId: found.info.installId }
    if (!res.ok || !j) return { state: 'not_running' }
    if (pair.port !== found.port) savePairing({ ...pair, port: found.port }, storage)
    return { ...j, state: j.state || 'ready', port: found.port }
  } catch {
    return { state: 'not_running' }
  }
}

/** 6자리 연결 코드를 비밀값으로 바꿔 저장한다. 실패는 {code, message} 를 던진다 */
export async function pairWithCode(code, { port, fetchImpl = globalThis.fetch, storage, signal } = {}) {
  const digits = String(code || '').replace(/\D/g, '')
  if (digits.length !== 6) throw new LocalError('BAD_CODE', '연결 코드는 숫자 6자리입니다.')
  let target = port
  if (!target) {
    const f = await findConnector({ fetchImpl, signal, storage })
    if (!f) throw new LocalError('LOCAL_NOT_RUNNING', NOT_RUNNING_MESSAGE)
    target = f.port
  }
  let res
  try {
    res = await fetchImpl(urlOf(target, '/pair'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: digits }), signal })
  } catch {
    throw new LocalError('LOCAL_NOT_RUNNING', NOT_RUNNING_MESSAGE)
  }
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.secret) throw toError(mapConnectorError(res.status, j), res.status)
  savePairing({ port: target, secret: j.secret, installId: j.installId }, storage)
  return { port: target, installId: j.installId }
}

/** 연결 프로그램에 비밀값 폐기를 알리고(실패해도 무시) 이 브라우저의 저장값을 지운다 */
export async function unpair({ fetchImpl = globalThis.fetch, storage } = {}) {
  const p = loadPairing(storage)
  if (p) {
    try {
      await fetchImpl(urlOf(p.port, '/unpair'), { method: 'POST', headers: { Authorization: `Bearer ${p.secret}` } })
    } catch {
      /* 프로그램이 꺼져 있어도 이 브라우저에서는 끊는다 */
    }
  }
  clearPairing(storage)
}

async function authedFetch(path, init, { fetchImpl = globalThis.fetch, storage } = {}) {
  const p = loadPairing(storage)
  if (!p) throw new LocalError('LOCAL_NOT_PAIRED', '연결 코드를 먼저 입력하세요. 설정에서 "내 컴퓨터의 ChatGPT 연결"을 여세요.')
  try {
    return await fetchImpl(urlOf(p.port, path), { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${p.secret}` } })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    // 포트가 바뀌었을 수 있다(연결 프로그램을 다시 켠 경우). 한 번 다시 찾아 본다.
    const f = await findConnector({ fetchImpl, storage })
    if (f && f.port !== p.port && (!p.installId || p.installId === f.info.installId)) {
      savePairing({ ...p, port: f.port }, storage)
      try {
        return await fetchImpl(urlOf(f.port, path), { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${p.secret}` } })
      } catch (e2) {
        if (e2?.name === 'AbortError') throw e2
      }
    }
    throw new LocalError('LOCAL_NOT_RUNNING', NOT_RUNNING_MESSAGE)
  }
}

/** 모델 목록 [{id,name}] */
export async function listLocalModels(opts = {}) {
  const res = await authedFetch('/models', { method: 'GET', signal: opts.signal }, opts)
  const j = await res.json().catch(() => null)
  if (!res.ok) throw toError(mapConnectorError(res.status, j), res.status)
  return Array.isArray(j?.models) ? j.models : []
}

// ── 스트림 ───────────────────────────────────────────────────
/** SSE 버퍼에서 완성된 이벤트를 꺼낸다. 순수 함수: { events, rest } */
export function parseSseBuffer(buf) {
  const text = buf.replace(/\r\n/g, '\n')
  const events = []
  let rest = text
  let i
  while ((i = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, i)
    rest = rest.slice(i + 2)
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data) continue // ": ping" 같은 주석 줄
    try {
      events.push(JSON.parse(data))
    } catch {
      /* 깨진 조각은 건너뛴다 */
    }
  }
  return { events, rest }
}

/** 연결 프로그램에 보낼 본문. provider 는 빼고, 이 방식이 쓰지 않는 설정(maxTokens, temperature)도 뺀다 */
export function localBody(body) {
  const { provider: _p, maxTokens: _m, temperature: _t, ...rest } = body
  return rest
}

/**
 * POST /chat 를 열어 계약의 이벤트를 하나씩 돌려준다.
 * makeError(code, message, status) 는 aiClient 의 AiError 를 만드는 함수(순환 참조를 피하려고 받는다).
 */
export async function* streamLocal(body, { signal, makeError, fetchImpl = globalThis.fetch, storage } = {}) {
  const fail = (e) => makeError(e.code || 'UPSTREAM', e.message || '처리하지 못했습니다', e.status)
  let res
  try {
    res = await authedFetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(localBody(body)), signal }, { fetchImpl, storage })
  } catch (e) {
    if (e?.name === 'AbortError') return
    throw fail(e)
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    const m = mapConnectorError(res.status, j)
    throw makeError(m.code, m.message, res.status)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const r = parseSseBuffer(buf)
      buf = r.rest
      for (const ev of r.events) {
        if (ev.type === 'error') {
          const m = mapConnectorError(0, { code: ev.code, error: ev.message })
          yield { ...ev, code: m.code, message: m.message }
        } else yield ev
      }
    }
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) return
    throw makeError('NETWORK', '응답이 중간에 끊겼습니다. 연결 프로그램이 켜져 있는지 확인하고 다시 시도하세요.')
  } finally {
    reader.cancel().catch(() => {})
  }
}
