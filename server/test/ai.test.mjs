// test/ai.test.mjs: AI 창 API (제공업체 연결, 모델 목록, SSE 채팅). 제공업체는 로컬 가짜 서버로 대신하고 DB 는 mock 이다.
// 실제 제공업체(Anthropic, OpenAI, Gemini, DeepSeek...)는 호출하지 않는다: 요청 모양은 공식 문서 기준으로 맞춘 것이고, 실제 키로는 검증하지 않았다.
// 실행: server/ 안에서 `node --test test/ai.test.mjs`
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
process.env.AI_MOCK = '1'
process.env.DRIVE_TOKEN_ENC_KEY = 'test-enc-key-for-ai-suite'
delete process.env.DATABASE_URL

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import request from 'supertest'
import jwt from 'jsonwebtoken'

// 가짜 제공업체 서버: 주소를 환경변수로 바꿔 끼운다(운영에서는 무시되는 AI_BASE_OVERRIDE_*)
const fake = { server: null, port: 0, requests: [], handler: null }
fake.server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('close', () => fake.onClose?.())
  req.on('end', () => {
    let body = null
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
    } catch {
      body = null
    }
    const rec = { method: req.method, url: req.url, headers: req.headers, body }
    fake.requests.push(rec)
    fake.handler(rec, res)
  })
})
const sse = (res, items) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const [event, data] of items) res.write(`${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)
  res.end()
}
const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}
const lastReq = () => fake.requests[fake.requests.length - 1]

// 메모리 DB (ws_connections 만 흉내)
const conns = new Map()
const lower = (s) => String(s).toLowerCase()
const db = {
  query: async (text, params) => {
    if (text.includes('FROM team_members')) return { rows: [] }
    if (text.startsWith('SELECT token_enc, meta FROM ws_connections')) {
      for (const e of params[0]) {
        const r = conns.get(`${lower(e)}|${params[1]}`)
        if (r) return { rows: [r] }
      }
      return { rows: [] }
    }
    if (text.startsWith('SELECT provider, meta FROM ws_connections')) {
      const rows = []
      for (const [k, v] of conns) if (params[0].includes(k.split('|')[0]) && k.split('|')[1].startsWith('ai:')) rows.push({ provider: k.split('|')[1], meta: v.meta })
      return { rows }
    }
    if (text.startsWith('INSERT INTO ws_connections')) {
      conns.set(`${lower(params[0])}|${params[1]}`, { token_enc: params[2], meta: JSON.parse(params[3]) })
      return { rows: [] }
    }
    if (text.startsWith('DELETE FROM ws_connections')) {
      for (const e of params[0]) conns.delete(`${lower(e)}|${params[1]}`)
      return { rows: [] }
    }
    return { rows: [] }
  },
}

let app
before(async () => {
  await new Promise((ok) => fake.server.listen(0, '127.0.0.1', ok))
  fake.port = fake.server.address().port
  const base = `http://127.0.0.1:${fake.port}`
  for (const id of ['ANTHROPIC', 'OPENAI', 'GEMINI', 'DEEPSEEK', 'KIMI', 'QWEN', 'GLM', 'CUSTOM']) process.env[`AI_BASE_OVERRIDE_${id}`] = base
  const { createApp } = await import('../src/app.js')
  app = createApp({ db })
})
after(() => fake.server.close())

const cookieFor = (email, id = 1) => `dah_access=${jwt.sign({ sub: id, email, name: '시험', role: 'manager', type: 'access' }, 'test-secret', { expiresIn: '15m' })}`

async function chat(email, body, opts = {}) {
  const r = await request(app).post('/ai/chat').set('Cookie', cookieFor(email)).send(body)
  const events = []
  if (r.status === 200) for (const block of String(r.text || '').split('\n\n')) if (block.startsWith('data: ')) events.push(JSON.parse(block.slice(6)))
  return { status: r.status, body: r.body, text: r.text || '', events, ...opts }
}
const text = (events) => events.filter((e) => e.type === 'text').map((e) => e.delta).join('')
const put = (email, provider, body) => request(app).put(`/ai/connections/${provider}`).set('Cookie', cookieFor(email)).send(body)

const SECRET = 'sk-test-SECRETKEY-9f8e7d6c5b4a3210zz'

// ── 로그인, 목록, mock ───────────────────────────────────────
test('로그인 없이는 모든 /ai 경로가 401', async () => {
  for (const [m, p] of [['get', '/ai/providers'], ['get', '/ai/models?provider=mock'], ['post', '/ai/chat'], ['put', '/ai/connections/openai'], ['delete', '/ai/connections/openai'], ['post', '/ai/test']]) {
    const r = await request(app)[m](p).send({})
    assert.equal(r.status, 401, `${m} ${p}`)
  }
})

test('GET /ai/providers: 제공업체 목록, 키 안내 링크, authType, mock 은 AI_MOCK=1 일 때만', async () => {
  const email = 'list@example.com'
  const r = await request(app).get('/ai/providers').set('Cookie', cookieFor(email))
  assert.equal(r.status, 200)
  const ids = r.body.map((p) => p.id)
  assert.deepEqual(ids, ['anthropic', 'openai', 'gemini', 'deepseek', 'kimi', 'qwen', 'glm', 'custom', 'mock'])
  const by = Object.fromEntries(r.body.map((p) => [p.id, p]))
  assert.equal(by.anthropic.keyUrl, 'https://console.anthropic.com/settings/keys')
  assert.equal(by.openai.keyUrl, 'https://platform.openai.com/api-keys')
  assert.equal(by.gemini.keyUrl, 'https://aistudio.google.com/app/apikey')
  assert.ok(r.body.every((p) => p.authType === 'apikey' || p.id === 'mock'))
  assert.ok(r.body.filter((p) => p.id !== 'mock').every((p) => p.connected === false && p.keyHint === null))
  assert.equal(by.custom.needsBaseUrl, true)
  // 운영/미설정에서는 mock 이 보이지도 쓸 수도 없다
  process.env.AI_MOCK = ''
  try {
    const r2 = await request(app).get('/ai/providers').set('Cookie', cookieFor(email))
    assert.ok(!r2.body.some((p) => p.id === 'mock'))
    const c = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(c.status, 400)
  } finally {
    process.env.AI_MOCK = '1'
  }
})

test('mock: 에코, /mock 이벤트 재생, 도구 결과 인정, 잘못된 JSON, 이미지 개수', async () => {
  const email = 'mock@example.com'
  let c = await chat(email, { provider: 'mock', model: 'mock-1', messages: [{ role: 'user', content: '안녕' }] })
  assert.equal(c.status, 200)
  assert.equal(text(c.events), '에코: 안녕')
  assert.equal(c.events.at(-1).type, 'done')
  assert.equal(c.events.at(-1).stopReason, 'end')

  const spec = { events: [{ type: 'text', delta: '고칩니다. ' }, { type: 'tool_call', name: 'replace_text', args: { find: 'a', replace: 'b' } }] }
  c = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: `/mock ${JSON.stringify(spec)}` }] })
  assert.equal(text(c.events), '고칩니다. ')
  const call = c.events.find((e) => e.type === 'tool_call')
  assert.equal(call.name, 'replace_text')
  assert.deepEqual(call.args, { find: 'a', replace: 'b' })
  assert.ok(call.id)
  assert.equal(c.events.at(-1).stopReason, 'tool_use')

  c = await chat(email, {
    provider: 'mock',
    messages: [
      { role: 'user', content: '/mock {}' },
      { role: 'assistant', content: '', toolCalls: [{ id: call.id, name: 'replace_text', args: {} }] },
      { role: 'tool', toolCallId: call.id, toolName: 'replace_text', content: '{"ok":true}' },
    ],
  })
  assert.match(text(c.events), /^도구 결과를 받았습니다: \{"ok":true\}/)

  c = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: '/mock {깨짐' }] })
  assert.equal(c.events[0].type, 'error')
  c = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: '/mock {"events":[],"error":{"code":"RATE_LIMIT","message":"x"}}' }] })
  assert.equal(c.events.at(-1).code, 'RATE_LIMIT')

  const png = 'data:image/png;base64,iVBORw0KGgo='
  c = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: '봐', images: [png, png] }] })
  assert.match(text(c.events), /이미지 2장/)
})

test('입력 검증: 메시지 60개, 도구 24개, 이미지 형식, 마지막 역할, 600KB', async () => {
  const email = 'valid@example.com'
  const u = { role: 'user', content: 'x' }
  let c = await chat(email, { provider: 'mock', messages: Array.from({ length: 61 }, () => u) })
  assert.equal(c.status, 400)
  c = await chat(email, { provider: 'mock', messages: [u], tools: Array.from({ length: 25 }, (_, i) => ({ name: `t${i}`, description: '', parameters: {} })) })
  assert.equal(c.status, 400)
  c = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: 'x', images: ['data:image/svg+xml;base64,AAAA'] }] })
  assert.equal(c.status, 400)
  c = await chat(email, { provider: 'mock', messages: [u, { role: 'assistant', content: 'y' }] })
  assert.equal(c.status, 400)
  c = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: 'x'.repeat(700 * 1024) }] })
  assert.equal(c.status, 413)
  assert.equal(c.body.code, 'TOO_LARGE')
  c = await chat(email, { provider: 'nope', messages: [u] })
  assert.equal(c.status, 400)
})

test('분당 20회 한도: 21번째는 429 RATE_LIMIT', async () => {
  const email = 'rate@example.com'
  let last
  for (let i = 0; i < 21; i++) last = await chat(email, { provider: 'mock', messages: [{ role: 'user', content: String(i) }] })
  assert.equal(last.status, 429)
  assert.equal(last.body.code, 'RATE_LIMIT')
  // 다른 사용자는 영향 없다
  const other = await chat('rate-other@example.com', { provider: 'mock', messages: [{ role: 'user', content: 'ok' }] })
  assert.equal(other.status, 200)
})

// ── Anthropic ────────────────────────────────────────────────
const claudeText = (parts) => [
  ['message_start', { type: 'message_start', message: { usage: { input_tokens: 11, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ...parts.map((t) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }]),
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }],
  ['message_stop', { type: 'message_stop' }],
]

test('Anthropic: 잘못된 키는 BAD_KEY 로, 키 값은 어떤 응답에도 나오지 않는다', async () => {
  const email = 'claude-bad@example.com'
  fake.handler = (rec, res) => json(res, 401, { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key: ${SECRET}` } })
  const r = await put(email, 'anthropic', { apiKey: SECRET })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'BAD_KEY')
  assert.ok(!JSON.stringify(r.body).includes(SECRET), '응답에 키가 있다')
  assert.equal(conns.size === 0 || ![...conns.keys()].some((k) => k.startsWith(email)), true) // 저장되지 않음
  const t = await request(app).post('/ai/test').set('Cookie', cookieFor(email)).send({ provider: 'anthropic', apiKey: SECRET })
  assert.equal(t.status, 400)
  assert.ok(!JSON.stringify(t.body).includes(SECRET))
})

test('Anthropic: 연결, 모델 목록(캐시), 스트리밍 텍스트, 도구 왕복, 이미지, 연결 끊기', async () => {
  const email = 'claude@example.com'
  fake.requests.length = 0
  fake.handler = (rec, res) => {
    if (rec.url.startsWith('/v1/models')) return json(res, 200, { data: [{ id: 'claude-haiku-9', display_name: 'Claude Haiku 9', lifecycle: 'active', line: 'haiku' }, { id: 'claude-sonnet-9', display_name: 'Claude Sonnet 9', lifecycle: 'active', line: 'sonnet' }, { id: 'claude-old', display_name: 'old', lifecycle: 'deprecated', line: 'sonnet' }], has_more: false })
    return json(res, 500, {})
  }
  const r = await put(email, 'anthropic', { apiKey: SECRET, maxTokens: 2000 })
  assert.equal(r.status, 200)
  assert.equal(r.body.connected, true)
  assert.equal(r.body.model, 'claude-sonnet-9') // 목록에서 고른 추천
  assert.deepEqual(r.body.models.map((m) => m.id), ['claude-haiku-9', 'claude-sonnet-9']) // 만료 예정 모델 제외
  assert.equal(r.body.keyHint, `…${SECRET.slice(-4)}`)
  assert.ok(!JSON.stringify(r.body).includes(SECRET))
  assert.equal(lastReq().headers['x-api-key'], SECRET)
  assert.equal(lastReq().headers['anthropic-version'], '2023-06-01')
  // DB 에는 봉인된 값만
  const stored = conns.get(`${email}|ai:anthropic`)
  assert.ok(stored.token_enc.startsWith('v1.') && !stored.token_enc.includes(SECRET))

  const list = await request(app).get('/ai/providers').set('Cookie', cookieFor(email))
  const me = list.body.find((p) => p.id === 'anthropic')
  assert.equal(me.connected, true)
  assert.equal(me.model, 'claude-sonnet-9')
  assert.equal(me.maxTokens, 2000)
  assert.ok(!JSON.stringify(list.body).includes(SECRET))

  const n0 = fake.requests.length
  const m1 = await request(app).get('/ai/models?provider=anthropic').set('Cookie', cookieFor(email))
  const m2 = await request(app).get('/ai/models?provider=anthropic').set('Cookie', cookieFor(email))
  assert.equal(m1.status, 200)
  assert.deepEqual(m2.body, m1.body)
  assert.equal(fake.requests.length - n0, 1, '두 번째 호출은 캐시에서')

  // 스트리밍 텍스트 + 요청 모양
  fake.handler = (rec, res) => sse(res, claudeText(['안녕', '하세요']))
  let c = await chat(email, {
    provider: 'anthropic',
    system: '너는 편집 도우미다',
    messages: [{ role: 'user', content: '인사', images: ['data:image/png;base64,iVBORw0KGgo='] }],
    tools: [{ name: 'read_document', description: '문서 읽기', parameters: { type: 'object', properties: { from: { type: 'number' } } } }],
  })
  assert.equal(text(c.events), '안녕하세요')
  assert.deepEqual(c.events.at(-1), { type: 'done', stopReason: 'end', usage: { inputTokens: 11, outputTokens: 7 } })
  const rq = lastReq()
  assert.equal(rq.url, '/v1/messages')
  assert.equal(rq.body.model, 'claude-sonnet-9')
  assert.equal(rq.body.max_tokens, 2000)
  assert.equal(rq.body.stream, true)
  assert.equal(rq.body.system, '너는 편집 도우미다')
  assert.deepEqual(rq.body.tools[0], { name: 'read_document', description: '문서 읽기', input_schema: { type: 'object', properties: { from: { type: 'number' } } } })
  assert.deepEqual(rq.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } })
  assert.deepEqual(rq.body.messages[0].content[1], { type: 'text', text: '인사' })
  assert.ok(!c.text.includes(SECRET))

  // 도구 호출 한 번 -> 결과 -> 이어서 답
  fake.handler = (rec, res) =>
    sse(res, [
      ['message_start', { type: 'message_start', message: { usage: { input_tokens: 5 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '읽어 볼게요.' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01A', name: 'read_document', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"from":' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '3}' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 1 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }],
      ['message_stop', { type: 'message_stop' }],
    ])
  c = await chat(email, { provider: 'anthropic', messages: [{ role: 'user', content: '읽어' }], tools: [{ name: 'read_document', description: '', parameters: {} }] })
  const tc = c.events.find((e) => e.type === 'tool_call')
  assert.deepEqual({ id: tc.id, name: tc.name, args: tc.args }, { id: 'toolu_01A', name: 'read_document', args: { from: 3 } })
  assert.equal(c.events.at(-1).stopReason, 'tool_use')

  fake.handler = (rec, res) => sse(res, claudeText(['끝']))
  c = await chat(email, {
    provider: 'anthropic',
    messages: [
      { role: 'user', content: '읽어' },
      { role: 'assistant', content: '읽어 볼게요.', toolCalls: [{ id: 'toolu_01A', name: 'read_document', args: { from: 3 } }] },
      { role: 'tool', toolCallId: 'toolu_01A', toolName: 'read_document', content: '{"text":"본문"}' },
    ],
  })
  assert.equal(text(c.events), '끝')
  const m = lastReq().body.messages
  assert.deepEqual(m[1], { role: 'assistant', content: [{ type: 'text', text: '읽어 볼게요.' }, { type: 'tool_use', id: 'toolu_01A', name: 'read_document', input: { from: 3 } }] })
  assert.deepEqual(m[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01A', content: '{"text":"본문"}' }] })

  // 스트림 중간 오류 이벤트
  fake.handler = (rec, res) => sse(res, [['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]])
  c = await chat(email, { provider: 'anthropic', messages: [{ role: 'user', content: 'x' }] })
  assert.equal(c.events.at(-1).type, 'error')
  assert.equal(c.events.at(-1).code, 'UPSTREAM')

  // 제공업체가 429 / 401 을 주면 코드로 구분
  fake.handler = (rec, res) => json(res, 429, { error: { message: 'rate limited' } })
  c = await chat(email, { provider: 'anthropic', messages: [{ role: 'user', content: 'x' }] })
  assert.equal(c.events.at(-1).code, 'RATE_LIMIT')
  fake.handler = (rec, res) => json(res, 401, { error: { message: `bad ${SECRET}` } })
  c = await chat(email, { provider: 'anthropic', messages: [{ role: 'user', content: 'x' }] })
  assert.equal(c.events.at(-1).code, 'BAD_KEY')
  assert.ok(!c.text.includes(SECRET), '오류 문장에서 키가 가려져야 한다')

  // 연결 끊기
  const d = await request(app).delete('/ai/connections/anthropic').set('Cookie', cookieFor(email))
  assert.equal(d.body.connected, false)
  c = await chat(email, { provider: 'anthropic', messages: [{ role: 'user', content: 'x' }] })
  assert.equal(c.status, 409)
  assert.equal(c.body.code, 'NOT_CONNECTED')
})

test('모델 이름만 바꿔 저장하면 키는 그대로, 시험 호출도 하지 않는다', async () => {
  const email = 'claude-model@example.com'
  fake.handler = (rec, res) => json(res, 200, { data: [{ id: 'claude-sonnet-9', display_name: 'S', lifecycle: 'active', line: 'sonnet' }] })
  assert.equal((await put(email, 'anthropic', { apiKey: SECRET })).status, 200)
  const n = fake.requests.length
  const r = await put(email, 'anthropic', { model: 'claude-other-1', maxTokens: 4000 })
  assert.equal(r.status, 200)
  assert.equal(r.body.model, 'claude-other-1')
  assert.equal(fake.requests.length, n)
  assert.equal(conns.get(`${email}|ai:anthropic`).meta.model, 'claude-other-1')
  assert.equal((await put(email, 'anthropic', { model: '../bad model' })).status, 400)
})

// ── OpenAI (Responses API) ───────────────────────────────────
test('OpenAI: Responses API 요청 모양, 스트리밍, 함수 호출 왕복(output 항목 그대로), 이미지', async () => {
  const email = 'openai@example.com'
  fake.requests.length = 0
  fake.handler = (rec, res) => json(res, 200, { data: [{ id: 'gpt-4.1', created: 5 }, { id: 'gpt-5.4-mini', created: 9 }, { id: 'gpt-5.4', created: 8 }, { id: 'gpt-5.4-mini-2026-01-01', created: 7 }, { id: 'text-embedding-3', created: 1 }, { id: 'gpt-image-1', created: 2 }, { id: 'whisper-1', created: 1 }] })
  const r = await put(email, 'openai', { apiKey: SECRET })
  assert.equal(r.status, 200)
  assert.equal(r.body.model, 'gpt-5.4-mini')
  assert.deepEqual(r.body.models.map((m) => m.id), ['gpt-5.4-mini', 'gpt-5.4', 'gpt-4.1'])
  assert.equal(lastReq().headers.authorization, `Bearer ${SECRET}`)
  assert.equal(lastReq().url, '/v1/models')

  fake.handler = (rec, res) =>
    sse(res, [
      [null, { type: 'response.created', response: {} }],
      [null, { type: 'response.output_text.delta', delta: '바꿉니다' }],
      [null, { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC', summary: [] } }],
      [null, { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_abc', name: 'replace_text', arguments: '{"find":"가","replace":"나"}' } }],
      [null, { type: 'response.completed', response: { usage: { input_tokens: 30, output_tokens: 9 } } }],
    ])
  const tools = [{ name: 'replace_text', description: '바꾸기', parameters: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } } } }]
  let c = await chat(email, { provider: 'openai', system: '도우미', maxTokens: 500, messages: [{ role: 'user', content: '바꿔', images: ['data:image/jpeg;base64,/9j/4AAQ'] }], tools })
  assert.equal(text(c.events), '바꿉니다')
  const call = c.events.find((e) => e.type === 'tool_call')
  assert.deepEqual({ id: call.id, name: call.name, args: call.args }, { id: 'call_abc', name: 'replace_text', args: { find: '가', replace: '나' } })
  const done = c.events.at(-1)
  assert.equal(done.stopReason, 'tool_use')
  assert.deepEqual(done.usage, { inputTokens: 30, outputTokens: 9 })
  assert.equal(done.meta.output.length, 2) // reasoning + function_call
  const rq = lastReq()
  assert.equal(rq.url, '/v1/responses')
  assert.equal(rq.body.model, 'gpt-5.4-mini')
  assert.equal(rq.body.store, false)
  assert.equal(rq.body.stream, true)
  assert.equal(rq.body.instructions, '도우미')
  assert.equal(rq.body.max_output_tokens, 500)
  assert.deepEqual(rq.body.include, ['reasoning.encrypted_content'])
  assert.deepEqual(rq.body.tools[0], { type: 'function', name: 'replace_text', description: '바꾸기', parameters: tools[0].parameters, strict: false })
  assert.deepEqual(rq.body.input[0].content, [{ type: 'input_text', text: '바꿔' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,/9j/4AAQ' }])

  // 결과를 붙여 다시: reasoning 과 function_call 이 그대로 돌아가고 function_call_output 이 따라온다
  fake.handler = (rec, res) => sse(res, [[null, { type: 'response.output_text.delta', delta: '완료' }], [null, { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } }]])
  c = await chat(email, {
    provider: 'openai',
    messages: [
      { role: 'user', content: '바꿔' },
      { role: 'assistant', content: '바꿉니다', toolCalls: [{ id: call.id, name: call.name, args: call.args }], meta: done.meta },
      { role: 'tool', toolCallId: call.id, toolName: 'replace_text', content: '{"changed":2}' },
    ],
    tools,
  })
  assert.equal(text(c.events), '완료')
  const input = lastReq().body.input
  assert.deepEqual(input[1], { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC', summary: [] })
  assert.equal(input[2].type, 'function_call')
  assert.equal(input[2].call_id, 'call_abc')
  assert.deepEqual(input[3], { type: 'function_call_output', call_id: 'call_abc', output: '{"changed":2}' })

  // 다른 제공업체에서 온 대화(meta 없음)도 function_call 로 만들어 보낸다
  c = await chat(email, {
    provider: 'openai',
    messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_X', name: 'replace_text', args: { find: 'a' } }] }, { role: 'tool', toolCallId: 'toolu_X', content: 'ok' }],
  })
  const inp = lastReq().body.input
  assert.deepEqual(inp[1], { type: 'function_call', call_id: 'toolu_X', name: 'replace_text', arguments: '{"find":"a"}' })

  // 추론 안 하는 모델: include 를 거절하면 없이 한 번 더 보낸다
  let calls = 0
  fake.handler = (rec, res) => {
    calls++
    if (rec.body.include) return json(res, 400, { error: { message: 'Encrypted content is not supported with this model.' } })
    return sse(res, [[null, { type: 'response.output_text.delta', delta: 'ok' }], [null, { type: 'response.completed', response: {} }]])
  }
  c = await chat(email, { provider: 'openai', model: 'gpt-4.1', messages: [{ role: 'user', content: 'q' }] })
  assert.equal(calls, 2)
  assert.equal(text(c.events), 'ok')

  // 길이 제한
  fake.handler = (rec, res) => sse(res, [[null, { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }]])
  c = await chat(email, { provider: 'openai', messages: [{ role: 'user', content: 'q' }] })
  assert.equal(c.events.at(-1).stopReason, 'length')
})

// ── Gemini ───────────────────────────────────────────────────
test('Gemini: streamGenerateContent 경로·헤더, 함수 호출과 thoughtSignature 왕복, 이미지', async () => {
  const email = 'gemini@example.com'
  fake.requests.length = 0
  fake.handler = (rec, res) => json(res, 200, { models: [
    { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-flash', displayName: 'Gemini 9 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9-pro', displayName: 'Gemini 9 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-1', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemma-3', supportedGenerationMethods: ['generateContent'] },
  ] })
  const r = await put(email, 'gemini', { apiKey: 'AIzaSyFAKEKEY-1234567890abcdefghij' })
  assert.equal(r.status, 200)
  assert.equal(r.body.model, 'gemini-flash-latest')
  assert.deepEqual(r.body.models.map((m) => m.id).sort(), ['gemini-9-flash', 'gemini-9-pro', 'gemini-flash-latest'])
  assert.equal(lastReq().headers['x-goog-api-key'], 'AIzaSyFAKEKEY-1234567890abcdefghij')
  assert.equal(lastReq().url.split('?')[0], '/v1beta/models')

  fake.handler = (rec, res) =>
    sse(res, [
      [null, { candidates: [{ content: { role: 'model', parts: [{ text: '확인' }] } }] }],
      [null, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_selection', args: { a: 1 } }, thoughtSignature: 'SIG123' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } }],
    ])
  const tools = [{ name: 'get_selection', description: '선택', parameters: { type: 'object', properties: { a: { type: 'number' } } } }]
  let c = await chat(email, { provider: 'gemini', system: '도우미', maxTokens: 300, temperature: 0.2, messages: [{ role: 'user', content: '봐', images: ['data:image/webp;base64,UklGRg=='] }], tools })
  const rq = lastReq()
  assert.equal(rq.url, '/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse')
  assert.deepEqual(rq.body.systemInstruction, { parts: [{ text: '도우미' }] })
  assert.deepEqual(rq.body.generationConfig, { maxOutputTokens: 300, temperature: 0.2 })
  assert.deepEqual(rq.body.tools[0].functionDeclarations[0], { name: 'get_selection', description: '선택', parametersJsonSchema: tools[0].parameters })
  assert.deepEqual(rq.body.contents[0].parts, [{ inlineData: { mimeType: 'image/webp', data: 'UklGRg==' } }, { text: '봐' }])
  assert.equal(text(c.events), '확인')
  const call = c.events.find((e) => e.type === 'tool_call')
  assert.equal(call.name, 'get_selection')
  assert.deepEqual(call.args, { a: 1 })
  assert.equal(call.meta.sig, 'SIG123')
  assert.equal(c.events.at(-1).stopReason, 'tool_use')
  assert.deepEqual(c.events.at(-1).usage, { inputTokens: 12, outputTokens: 4 })

  fake.handler = (rec, res) => sse(res, [[null, { candidates: [{ content: { parts: [{ text: '끝' }] }, finishReason: 'STOP' }] }]])
  c = await chat(email, {
    provider: 'gemini',
    messages: [
      { role: 'user', content: '봐' },
      { role: 'assistant', content: '확인', toolCalls: [{ id: call.id, name: call.name, args: call.args, meta: call.meta }] },
      { role: 'tool', toolCallId: call.id, toolName: call.name, content: '{"text":"선택됨"}' },
    ],
    tools,
  })
  assert.equal(text(c.events), '끝')
  const contents = lastReq().body.contents
  assert.deepEqual(contents[1], { role: 'model', parts: [{ text: '확인' }, { functionCall: { name: 'get_selection', args: { a: 1 } }, thoughtSignature: 'SIG123' }] })
  assert.deepEqual(contents[2], { role: 'user', parts: [{ functionResponse: { name: 'get_selection', response: { text: '선택됨' } } }] })

  fake.handler = (rec, res) => sse(res, [[null, { candidates: [{ content: { parts: [{ text: '잘림' }] }, finishReason: 'MAX_TOKENS' }] }]])
  c = await chat(email, { provider: 'gemini', messages: [{ role: 'user', content: 'q' }] })
  assert.equal(c.events.at(-1).stopReason, 'length')
  fake.handler = (rec, res) => json(res, 429, { error: { message: 'quota exceeded' } })
  c = await chat(email, { provider: 'gemini', messages: [{ role: 'user', content: 'q' }] })
  assert.equal(c.events.at(-1).code, 'RATE_LIMIT')
})

// ── OpenAI 호환 ──────────────────────────────────────────────
test('DeepSeek(호환): chat/completions 스트리밍, 조각난 tool_calls, reasoning_content 왕복', async () => {
  const email = 'deepseek@example.com'
  fake.requests.length = 0
  fake.handler = (rec, res) => json(res, 200, { data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] })
  const r = await put(email, 'deepseek', { apiKey: SECRET })
  assert.equal(r.status, 200)
  assert.equal(r.body.model, 'deepseek-chat')
  assert.equal(lastReq().url, '/models')
  assert.equal(lastReq().headers.authorization, `Bearer ${SECRET}`)

  const ch = (delta, extra = {}) => [null, { choices: [{ index: 0, delta, ...extra }] }]
  fake.handler = (rec, res) =>
    sse(res, [
      ch({ role: 'assistant', reasoning_content: '생각 ' }),
      ch({ content: '찾아 ' }),
      ch({ content: '볼게요' }),
      ch({ tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'read_document', arguments: '' } }] }),
      ch({ tool_calls: [{ index: 0, function: { arguments: '{"from":' } }] }),
      ch({ tool_calls: [{ index: 0, function: { arguments: '2}' } }] }),
      ch({}, { finish_reason: 'tool_calls' }),
      [null, { choices: [], usage: { prompt_tokens: 8, completion_tokens: 3 } }],
      [null, '[DONE]'],
    ])
  const tools = [{ name: 'read_document', description: '읽기', parameters: { type: 'object', properties: {} } }]
  let c = await chat(email, { provider: 'deepseek', maxTokens: 700, messages: [{ role: 'user', content: '읽어', images: ['data:image/png;base64,AAAA'] }], tools })
  assert.equal(text(c.events), '찾아 볼게요')
  const call = c.events.find((e) => e.type === 'tool_call')
  assert.deepEqual({ id: call.id, name: call.name, args: call.args }, { id: 'call_9', name: 'read_document', args: { from: 2 } })
  const done = c.events.at(-1)
  assert.equal(done.stopReason, 'tool_use')
  assert.deepEqual(done.usage, { inputTokens: 8, outputTokens: 3 })
  assert.deepEqual(done.meta, { reasoning_content: '생각 ' })
  const rq = lastReq()
  assert.equal(rq.url, '/chat/completions')
  assert.equal(rq.body.max_tokens, 700)
  assert.deepEqual(rq.body.stream_options, { include_usage: true })
  assert.deepEqual(rq.body.tools[0], { type: 'function', function: { name: 'read_document', description: '읽기', parameters: tools[0].parameters } })
  assert.deepEqual(rq.body.messages[0].content, [{ type: 'text', text: '읽어' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }])

  fake.handler = (rec, res) => sse(res, [ch({ content: '완료' }), ch({}, { finish_reason: 'stop' }), [null, '[DONE]']])
  c = await chat(email, {
    provider: 'deepseek',
    system: '시스템',
    messages: [
      { role: 'user', content: '읽어' },
      { role: 'assistant', content: '찾아 볼게요', toolCalls: [{ id: 'call_9', name: 'read_document', args: { from: 2 } }], meta: done.meta },
      { role: 'tool', toolCallId: 'call_9', toolName: 'read_document', content: '본문' },
    ],
    tools,
  })
  assert.equal(text(c.events), '완료')
  const msgs = lastReq().body.messages
  assert.deepEqual(msgs[0], { role: 'system', content: '시스템' })
  assert.deepEqual(msgs[2], { role: 'assistant', content: '찾아 볼게요', reasoning_content: '생각 ', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'read_document', arguments: '{"from":2}' } }] })
  assert.deepEqual(msgs[3], { role: 'tool', tool_call_id: 'call_9', content: '본문' })
})

test('GLM 은 생각을 끈 채 호출하고 stream_options 를 보내지 않는다', async () => {
  const email = 'glm@example.com'
  fake.handler = (rec, res) => (rec.url === '/api/paas/v4/models' ? json(res, 200, { data: [{ id: 'glm-4.5' }, { id: 'glm-5' }, { id: 'glm-5-air' }] }) : sse(res, [[null, { choices: [{ delta: { content: 'z' }, finish_reason: 'stop' }] }], [null, '[DONE]']]))
  const r = await put(email, 'glm', { apiKey: SECRET })
  assert.equal(r.status, 200)
  assert.equal(r.body.model, 'glm-5')
  const c = await chat(email, { provider: 'glm', messages: [{ role: 'user', content: 'q' }] })
  assert.equal(text(c.events), 'z')
  const rq = lastReq()
  assert.equal(rq.url, '/api/paas/v4/chat/completions')
  assert.deepEqual(rq.body.thinking, { type: 'disabled' })
  assert.equal(rq.body.stream_options, undefined)
})

// ── custom 주소와 SSRF ───────────────────────────────────────
test('custom: 위험한 주소는 연결 전에 막는다', async () => {
  const email = 'ssrf@example.com'
  fake.requests.length = 0
  const bad = ['http://example.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://10.0.0.5/v1', 'https://192.168.1.1/v1', 'https://169.254.169.254/latest', 'https://[::1]/v1', 'https://example.com:8443/v1', 'https://user:pw@example.com/v1', 'https://metadata/v1', 'https://svc.internal/v1', 'https://example.com/v1?x=1', 'ftp://example.com', 'file:///etc/passwd', '']
  for (const [i, baseUrl] of bad.entries()) {
    const email = `ssrf${i}@example.com` // 사용자마다 한도가 따로라 주소마다 다른 사용자
    const r = await put(email, 'custom', { apiKey: SECRET, baseUrl })
    assert.equal(r.status, 400, baseUrl)
    assert.ok(['UNSAFE_URL', 'BAD_REQUEST'].includes(r.body.code), `${baseUrl} ${r.body.code}`)
    const t = await request(app).post('/ai/test').set('Cookie', cookieFor(email)).send({ provider: 'custom', apiKey: SECRET, baseUrl })
    assert.equal(t.status, 400, `test ${baseUrl}`)
  }
  assert.equal(fake.requests.length, 0, '막힌 주소로는 아무 요청도 나가지 않는다')
  assert.ok(![...conns.keys()].some((k) => k.startsWith('ssrf')))
  // qwen 작업공간 주소는 aliyuncs.com 만
  assert.equal((await put(email, 'qwen', { apiKey: SECRET, baseUrl: 'https://evil.example.com/compatible-mode/v1' })).status, 400)
  // 고정 제공업체는 주소를 바꿀 수 없다(무시)
  fake.handler = (rec, res) => json(res, 200, { data: [{ id: 'm' }] })
  const r = await put(email, 'deepseek', { apiKey: SECRET, baseUrl: 'https://evil.example.com' })
  assert.equal(r.status, 200)
  assert.equal(r.body.baseUrl, undefined)
})

test('custom: 공개 https 주소는 연결되고 그 경로가 그대로 쓰인다', async () => {
  const email = 'custom@example.com'
  fake.requests.length = 0
  fake.handler = (rec, res) => (rec.url === '/openai/v1/models' ? json(res, 200, { data: [{ id: 'my-model' }] }) : sse(res, [[null, { choices: [{ delta: { content: '호환' }, finish_reason: 'stop' }] }], [null, '[DONE]']]))
  const r = await put(email, 'custom', { apiKey: SECRET, baseUrl: 'https://llm.example.com/openai/v1/' })
  assert.equal(r.status, 200)
  assert.equal(r.body.baseUrl, 'https://llm.example.com/openai/v1')
  assert.equal(r.body.model, 'my-model')
  const c = await chat(email, { provider: 'custom', messages: [{ role: 'user', content: 'q' }] })
  assert.equal(text(c.events), '호환')
  assert.equal(lastReq().url, '/openai/v1/chat/completions')
})

test('custom: 모델 목록을 지원하지 않는 서버(404)는 확인 없이 연결된다', async () => {
  const email = 'custom404@example.com'
  fake.handler = (rec, res) => json(res, 404, { error: 'not found' })
  const r = await put(email, 'custom', { apiKey: SECRET, baseUrl: 'https://llm.example.com/v1', model: 'handmade' })
  assert.equal(r.status, 200)
  assert.equal(r.body.unverified, true)
  assert.equal(r.body.model, 'handmade')
})

// ── 연결 끊김과 정리 ─────────────────────────────────────────
test('클라이언트가 끊으면 제공업체 요청도 끊는다', async () => {
  const email = 'abort@example.com'
  fake.handler = (rec, res) => json(res, 200, { data: [{ id: 'deepseek-chat' }] })
  assert.equal((await put(email, 'deepseek', { apiKey: SECRET })).status, 200)
  let upstreamClosed
  const closed = new Promise((ok) => (upstreamClosed = ok))
  fake.handler = (rec, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '시작' } }] })}\n\n`)
    fake.onClose = upstreamClosed // 끊김 감지
  }
  const server = http.createServer(app)
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port
  const body = JSON.stringify({ provider: 'deepseek', messages: [{ role: 'user', content: 'q' }] })
  await new Promise((ok, fail) => {
    const req = http.request({ port, host: '127.0.0.1', method: 'POST', path: '/ai/chat', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Cookie: cookieFor(email) } }, (res) => {
      res.once('data', () => {
        req.destroy()
        ok()
      })
    })
    req.on('error', () => {})
    req.setTimeout(5000, () => fail(new Error('timeout')))
    req.end(body)
  })
  const result = await Promise.race([closed.then(() => 'closed'), new Promise((ok) => setTimeout(() => ok('still open'), 3000))])
  server.close()
  fake.onClose = null
  assert.equal(result, 'closed')
})

test('키는 어떤 응답 본문에도 나오지 않는다(목록, 모델, 저장, 오류)', async () => {
  const email = 'nokey@example.com'
  const key = 'sk-ant-api03-ZZZ-NEVER-LEAK-0123456789abcdef'
  fake.handler = (rec, res) => json(res, 200, { data: [{ id: 'claude-sonnet-9', lifecycle: 'active', line: 'sonnet', display_name: 'S' }] })
  const outs = []
  outs.push(await put(email, 'anthropic', { apiKey: key }))
  outs.push(await request(app).get('/ai/providers').set('Cookie', cookieFor(email)))
  outs.push(await request(app).get('/ai/models?provider=anthropic').set('Cookie', cookieFor(email)))
  outs.push(await request(app).post('/ai/test').set('Cookie', cookieFor(email)).send({ provider: 'anthropic' }))
  fake.handler = (rec, res) => json(res, 400, { error: { message: `bad request for key ${key} and Bearer ${key}` } })
  outs.push(await chat(email, { provider: 'anthropic', messages: [{ role: 'user', content: 'x' }] }))
  for (const o of outs) assert.ok(!(o.text || JSON.stringify(o.body)).includes(key))
  assert.ok(!(outs.at(-1).text).includes('NEVER-LEAK'))
})

test('유틸: 기본 모델 고르기, 비밀 가리기, 요청 정리, 운영에서는 주소 바꿔치기와 mock 무시', async () => {
  const { pickDefault, cmpVersion } = await import('../src/lib/ai/util.js')
  assert.equal(pickDefault([{ id: 'gpt-4.1-mini' }, { id: 'gpt-5.4-mini' }, { id: 'gpt-5.10-mini' }], [/^gpt-\d+(\.\d+)?-mini$/]), 'gpt-5.10-mini')
  assert.ok(cmpVersion('gpt-5.4', 'gpt-4.1') < 0) // 높은 버전이 앞(내림차순)
  const { maskSecrets } = await import('../src/lib/ai/errors.js')
  assert.ok(!maskSecrets('Bearer abcdefgh12345678 sk-proj-abcdefghijklmnop12345 AIzaSyA1234567890abcdefghijkl').match(/abcdefgh12345678|abcdefghijklmnop|AIzaSyA/))
  const { cleanChatBody } = await import('../src/routes/ai.js')
  assert.throws(() => cleanChatBody({ messages: [{ role: 'system', content: 'x' }] }))
  assert.throws(() => cleanChatBody({ messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'bad name', parameters: {} }] }))
  const ok = cleanChatBody({ messages: [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'u' }], tools: [{ name: 'a_b', description: 'd' }] })
  assert.equal(ok.messages.length, 1) // 맨 앞 assistant 는 버려진다
  const { makeCtx, getDef } = await import('../src/lib/ai/providers.js')
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    let hit = ''
    const origFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      hit = String(url)
      return new Response('{}', { status: 200 })
    }
    await makeCtx(getDef('anthropic'), null, { apiKey: 'k' }).call('/v1/models', {})
    globalThis.fetch = origFetch
    assert.equal(hit, 'https://api.anthropic.com/v1/models') // AI_BASE_OVERRIDE_ANTHROPIC 는 운영에서 무시
    assert.equal(getDef('mock'), null)
  } finally {
    process.env.NODE_ENV = prev
  }
})

// Gemini 는 틀린 키에 401 이 아니라 400 + "API key not valid" 를 돌려준다
test('Gemini 400 키 오류는 BAD_KEY 로 분류한다', async () => {
  const { errorFromResponse } = await import('../src/lib/ai/errors.js')
  const res = new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }), { status: 400 })
  const e = await errorFromResponse(res, 'AIzaSyFAKEKEY0000000000000000000000000')
  assert.equal(e.code, 'BAD_KEY')
  const other = await errorFromResponse(new Response(JSON.stringify({ error: { message: 'Invalid JSON payload' } }), { status: 400 }), 'k')
  assert.equal(other.code, 'UPSTREAM')
})
