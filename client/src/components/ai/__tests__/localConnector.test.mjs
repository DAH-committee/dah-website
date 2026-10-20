import test from 'node:test'
import assert from 'node:assert/strict'
import { LOCAL_PROVIDER_ID, getLocalStatus, listLocalModels, loadPairing, localBody, localProviderEntry, mapConnectorError, pairWithCode, parseSseBuffer, savePairing, streamLocal, unpair } from '../localConnector.js'

const SECRET = 'A'.repeat(43)
const mem = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const sse = (events, extra = '') => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const ev of events) c.enqueue(e.encode(`data: ${JSON.stringify(ev)}\n\n`)); if (extra) c.enqueue(e.encode(extra)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
class Err extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }
const collect = async (it) => { const out = []; for await (const e of it) out.push(e); return out }
const ANON = { ok: true, app: 'DAH Connect', version: '0.1.0', installId: 'inst1', paired: false }

test('짝짓기 저장: 형식이 맞을 때만 읽는다', () => {
  const st = mem()
  assert.equal(loadPairing(st), null)
  savePairing({ port: 47684, secret: SECRET, installId: 'i' }, st)
  assert.deepEqual(loadPairing(st), { port: 47684, secret: SECRET, installId: 'i' })
  st.setItem('dah-ai:local-pair', JSON.stringify({ port: 1, secret: 'short' }))
  assert.equal(loadPairing(st), null)
  st.setItem('dah-ai:local-pair', '깨진 json')
  assert.equal(loadPairing(st), null)
})

test('제공업체 항목: 짝짓기 전에는 미연결, 후에는 연결됨(키 없음)', () => {
  const st = mem()
  assert.equal(localProviderEntry(st).connected, false)
  savePairing({ port: 47684, secret: SECRET }, st)
  const e = localProviderEntry(st)
  assert.equal(e.id, LOCAL_PROVIDER_ID)
  assert.equal(e.connected, true)
  assert.equal(e.maxTokens, null)
  assert.equal(e.keyHint, null)
  assert.equal(e.allowBaseUrl, false)
})

test('오류 변환: 한국어 코드와 문구', () => {
  assert.equal(mapConnectorError(401, { code: 'UNAUTHORIZED' }).code, 'LOCAL_NOT_PAIRED')
  assert.equal(mapConnectorError(401, null).code, 'LOCAL_NOT_PAIRED')
  assert.equal(mapConnectorError(409, { code: 'NOT_LOGGED_IN' }).code, 'LOCAL_RECONNECT')
  assert.equal(mapConnectorError(401, { code: 'RECONNECT' }).code, 'LOCAL_RECONNECT')
  assert.match(mapConnectorError(409, { code: 'PLAN_DISABLED' }).message, /허용/)
  const lim = mapConnectorError(429, { code: 'PLAN_LIMIT', error: '한도 도달' })
  assert.deepEqual(lim, { code: 'PLAN_LIMIT', message: '한도 도달' })
  assert.equal(mapConnectorError(403, { code: 'ORIGIN_NOT_ALLOWED' }).code, 'LOCAL_NOT_RUNNING')
  assert.equal(mapConnectorError(413, { code: 'TOO_LARGE', error: '크다' }).code, 'TOO_LARGE')
  assert.equal(mapConnectorError(503, null).code, 'UPSTREAM')
})

test('SSE 버퍼: 완성된 이벤트만 꺼내고 나머지는 남긴다, ping 과 깨진 줄은 건너뛴다', () => {
  const r = parseSseBuffer('data: {"type":"text","delta":"가"}\n\n: ping\n\ndata: {깨짐}\n\ndata: {"type":"done"')
  assert.deepEqual(r.events, [{ type: 'text', delta: '가' }])
  assert.equal(r.rest, 'data: {"type":"done"')
  assert.deepEqual(parseSseBuffer('data: {"type":"done"}\r\n\r\n').events, [{ type: 'done' }])
})

test('본문: provider, maxTokens, temperature 는 연결 프로그램으로 보내지 않는다', () => {
  assert.deepEqual(localBody({ provider: 'chatgpt-local', model: 'm', messages: [], maxTokens: 500, temperature: 1, system: 's', tools: [] }), { model: 'm', messages: [], system: 's', tools: [] })
})

test('상태: 프로그램 없음 / 코드 필요 / 준비됨 / 비밀값 거절', async () => {
  const st = mem()
  const none = async () => { throw new TypeError('Failed to fetch') }
  assert.equal((await getLocalStatus({ fetchImpl: none, storage: st })).state, 'not_running')
  const anon = async () => json(200, ANON)
  const s1 = await getLocalStatus({ fetchImpl: anon, storage: st })
  assert.equal(s1.state, 'not_paired')
  savePairing({ port: 47685, secret: SECRET, installId: 'inst1' }, st)
  const calls = []
  const ready = async (url, init) => {
    calls.push([url, init?.headers?.Authorization])
    return init?.headers?.Authorization ? json(200, { ...ANON, paired: true, state: 'ready', planUsage: true }) : json(200, ANON)
  }
  const s2 = await getLocalStatus({ fetchImpl: ready, storage: st })
  assert.equal(s2.state, 'ready')
  assert.equal(calls[0][0], 'http://127.0.0.1:47685/status') // 저장된 포트부터
  assert.equal(calls.at(-1)[1], `Bearer ${SECRET}`)
  const reject = async (url, init) => (init?.headers?.Authorization ? json(401, { code: 'UNAUTHORIZED' }) : json(200, ANON))
  assert.equal((await getLocalStatus({ fetchImpl: reject, storage: st })).state, 'bad_pair')
  // 다른 설치(installId 불일치)면 코드가 다시 필요하다
  const other = async () => json(200, { ...ANON, installId: 'other' })
  assert.equal((await getLocalStatus({ fetchImpl: other, storage: st })).state, 'not_paired')
})

test('짝짓기: 코드 6자리 확인, 성공하면 비밀값 저장, 실패는 한국어 오류', async () => {
  const st = mem()
  await assert.rejects(pairWithCode('12', { port: 47684, storage: st }), /6자리/)
  let sent
  const ok = async (url, init) => { sent = [url, JSON.parse(init.body)]; return json(200, { secret: SECRET, installId: 'inst1' }) }
  await pairWithCode('123 456', { port: 47684, fetchImpl: ok, storage: st })
  assert.deepEqual(sent, ['http://127.0.0.1:47684/pair', { code: '123456' }])
  assert.equal(loadPairing(st).secret, SECRET)
  const st2 = mem()
  const wrong = async () => json(401, { error: '코드가 맞지 않습니다. 3번 더 틀리면 잠깁니다.', code: 'BAD_CODE' })
  await assert.rejects(pairWithCode('111111', { port: 47684, fetchImpl: wrong, storage: st2 }), /3번 더/)
  assert.equal(loadPairing(st2), null)
  const down = async () => { throw new TypeError('x') }
  await assert.rejects(pairWithCode('111111', { port: 47684, fetchImpl: down, storage: st2 }), (e) => e.code === 'LOCAL_NOT_RUNNING')
})

test('모델 목록: Bearer 를 붙여 부르고 목록만 돌려준다', async () => {
  const st = mem()
  savePairing({ port: 47684, secret: SECRET }, st)
  let auth
  const f = async (url, init) => { auth = init.headers.Authorization; return json(200, { models: [{ id: 'a', name: 'A' }] }) }
  assert.deepEqual(await listLocalModels({ fetchImpl: f, storage: st }), [{ id: 'a', name: 'A' }])
  assert.equal(auth, `Bearer ${SECRET}`)
  await assert.rejects(listLocalModels({ fetchImpl: async () => json(401, { code: 'UNAUTHORIZED' }), storage: st }), (e) => e.code === 'LOCAL_NOT_PAIRED')
})

test('스트림: 이벤트를 순서대로 돌려주고, 본문에서 provider·maxTokens 를 뺀다', async () => {
  const st = mem()
  savePairing({ port: 47684, secret: SECRET }, st)
  let req
  const f = async (url, init) => { req = [url, init]; return sse([{ type: 'text', delta: '안' }, { type: 'tool_call', id: 'c1', name: 't', args: { a: 1 } }, { type: 'done', stopReason: 'tool_use' }]) }
  const evs = await collect(streamLocal({ provider: 'chatgpt-local', model: 'm', messages: [], maxTokens: 9 }, { makeError: (c, m, s) => new Err(c, m, s), fetchImpl: f, storage: st }))
  assert.deepEqual(evs.map((e) => e.type), ['text', 'tool_call', 'done'])
  assert.equal(req[0], 'http://127.0.0.1:47684/chat')
  assert.equal(req[1].headers.Authorization, `Bearer ${SECRET}`)
  assert.deepEqual(Object.keys(JSON.parse(req[1].body)).sort(), ['messages', 'model'])
})

test('스트림 오류: 프로그램 꺼짐 / 코드 풀림 / 한도(JSON) / 중간 error 이벤트', async () => {
  const st = mem()
  savePairing({ port: 47684, secret: SECRET }, st)
  const make = { makeError: (c, m, s) => new Err(c, m, s), storage: st }
  const run = (fetchImpl) => collect(streamLocal({ model: 'm', messages: [] }, { ...make, fetchImpl }))
  await assert.rejects(run(async () => { throw new TypeError('x') }), (e) => e.code === 'LOCAL_NOT_RUNNING' && /연결 프로그램/.test(e.message))
  await assert.rejects(run(async () => json(401, { code: 'UNAUTHORIZED' })), (e) => e.code === 'LOCAL_NOT_PAIRED')
  await assert.rejects(run(async () => json(429, { code: 'PLAN_LIMIT', error: '한도' })), (e) => e.code === 'PLAN_LIMIT' && e.status === 429)
  await assert.rejects(run(async () => json(401, { code: 'RECONNECT' })), (e) => e.code === 'LOCAL_RECONNECT')
  const evs = await run(async () => sse([{ type: 'text', delta: 'a' }, { type: 'error', code: 'UPSTREAM', message: '끊겼습니다' }]))
  assert.equal(evs.at(-1).type, 'error')
  assert.equal(evs.at(-1).message, '끊겼습니다')
  // 짝짓기 없음
  await assert.rejects(collect(streamLocal({ model: 'm', messages: [] }, { makeError: make.makeError, fetchImpl: async () => json(200, {}), storage: mem() })), (e) => e.code === 'LOCAL_NOT_PAIRED')
})

test('스트림: 중단하면 조용히 끝난다', async () => {
  const st = mem()
  savePairing({ port: 47684, secret: SECRET }, st)
  const ac = new AbortController()
  const f = async () => { ac.abort(); const e = new Error('aborted'); e.name = 'AbortError'; throw e }
  const evs = await collect(streamLocal({ model: 'm', messages: [] }, { signal: ac.signal, makeError: (c, m) => new Err(c, m), fetchImpl: f, storage: st }))
  assert.deepEqual(evs, [])
})

test('연결 끊기: 프로그램이 꺼져 있어도 이 브라우저의 저장값은 지운다', async () => {
  const st = mem()
  savePairing({ port: 47684, secret: SECRET }, st)
  await unpair({ fetchImpl: async () => { throw new TypeError('x') }, storage: st })
  assert.equal(loadPairing(st), null)
})
