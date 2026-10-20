// AI 창(문서·발표·보드 옆 AI) API: 계약서는 client/src/components/ai/README.md
//   GET    /ai/providers                 제공업체 목록과 내 연결 상태(키는 내려주지 않는다. 끝 4자리 힌트만)
//   PUT    /ai/connections/:provider     { apiKey?, model?, baseUrl?, maxTokens? } 키를 시험 호출(모델 목록)로 확인한 뒤 봉인 저장
//   POST   /ai/test                      { provider, apiKey?, baseUrl? } 저장하지 않고 키만 확인하고 모델 목록을 돌려준다
//   DELETE /ai/connections/:provider
//   GET    /ai/models?provider=          [{id,name}] (저장된 키로 가져와 5분 메모리 캐시)
//   POST   /ai/chat                      SSE(text/event-stream): text | tool_call | done | error
// 로그인한 사용자만. 키는 secretBox 로 봉인해 ws_connections(provider = 'ai:<id>')에 저장하고 응답·로그에 내보내지 않는다.
// 프롬프트와 응답은 저장도 기록도 하지 않는다. 제공업체 오류 문장은 키처럼 보이는 조각을 지운 뒤 짧게만 전달한다.
import crypto from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { optionalAuth } from '../middleware/auth.js'
import { identityOf } from '../lib/wsAccess.js'
import { SecretKeyMissingError, isSecretBoxConfigured, open, seal } from '../lib/secretBox.js'
import { AiError, maskSecrets } from '../lib/ai/errors.js'
import { getDef, listDefs, makeCtx, normalizeBaseUrl } from '../lib/ai/providers.js'
import { DATA_URL_RE } from '../lib/ai/util.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
router.use('/ai', optionalAuth)

const MAX_BODY_BYTES = 600 * 1024
const MAX_MESSAGES = 60
const MAX_TOOLS = 24
const CHAT_TIMEOUT_MS = 270 * 1000 // Vercel 함수 기본 최대 시간(300초)보다 먼저 끝낸다
const MODEL_CACHE_MS = 5 * 60 * 1000

const signedIn = wrap(async (req, res, next) => {
  const idn = await identityOf(req, res)
  if (!idn.emails.length) return res.status(401).json({ error: 'login required', hint: '구글 계정으로 로그인하세요.', code: 'LOGIN' })
  next()
})
const limiter = (limit, message) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req._wsIdentity?.emails?.[0] || 'anon',
    handler: (req, res) => res.status(429).json({ error: message, code: 'RATE_LIMIT' }),
  })
const chatLimiter = limiter(20, '요청이 너무 잦습니다. 1분에 20번까지 보낼 수 있습니다. 잠시 뒤 다시 시도하세요.')
const configLimiter = limiter(30, '요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요.')

const dbProvider = (id) => `ai:${id}`
const lowerEmails = (idn) => idn.emails

async function connectionOf(idn, id) {
  const { rows } = await query('SELECT token_enc, meta FROM ws_connections WHERE lower(email) = ANY($1::text[]) AND provider = $2 ORDER BY id LIMIT 1', [lowerEmails(idn), dbProvider(id)])
  return rows[0] || null
}

const fail = (res, err) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
  return res.status(status === 401 ? 400 : status).json({ error: err.message, code: err.code || 'UPSTREAM' })
}

const MODEL_RE = /^[\w.:/@+-]{1,120}$/
const keyFormatOk = (k) => k.length >= 8 && k.length <= 400 && /^[\x21-\x7e]+$/.test(k)
const intIn = (v, lo, hi) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : null
}

// ── 목록 ─────────────────────────────────────────────────────
router.get(
  '/ai/providers',
  signedIn,
  configLimiter,
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const { rows } = await query("SELECT provider, meta FROM ws_connections WHERE lower(email) = ANY($1::text[]) AND provider LIKE 'ai:%'", [lowerEmails(idn)])
    const by = new Map(rows.map((r) => [r.provider, r.meta || {}]))
    res.set('Cache-Control', 'no-store')
    res.json(
      listDefs().map((d) => {
        const meta = by.get(dbProvider(d.id))
        const connected = d.noKey ? true : Boolean(meta)
        return {
          id: d.id,
          name: d.name,
          authType: d.authType,
          keyUrl: d.keyUrl,
          keyHelp: d.keyHelp,
          needsBaseUrl: Boolean(d.userBase),
          allowBaseUrl: Boolean(d.userBase || d.hostSuffix),
          connected,
          keyHint: d.noKey ? null : meta?.keyHint || null,
          model: meta?.model || (d.noKey ? 'mock-1' : null),
          maxTokens: meta?.maxTokens || null,
          ...(meta?.baseUrl ? { baseUrl: meta.baseUrl } : {}),
        }
      })
    )
  })
)

// ── 키 확인 공통 ──────────────────────────────────────────────
async function checkKey(def, apiKey, baseUrl) {
  const ctx = makeCtx(def, baseUrl ? { baseUrl } : null, { apiKey, signal: AbortSignal.timeout(20000) })
  try {
    return await def.adapter.listModels(ctx)
  } catch (e) {
    if (e instanceof AiError) throw e
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new AiError('UPSTREAM', '제공업체 응답이 늦어 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.', 504)
    throw new AiError('UPSTREAM', '제공업체에 연결하지 못했습니다.', 502)
  }
}

function needSecretBox() {
  if (isSecretBoxConfigured()) return null
  const e = new SecretKeyMissingError()
  return { status: 503, body: { error: '서버에 키를 안전하게 보관할 설정이 없어 연결할 수 없습니다', hint: e.hint, code: 'NO_SECRET_BOX' } }
}

router.post(
  '/ai/test',
  signedIn,
  configLimiter,
  wrap(async (req, res) => {
    const def = getDef(String(req.body?.provider || ''))
    if (!def) return res.status(404).json({ error: 'not found' })
    if (def.noKey) return res.json({ ok: true, ...(await def.adapter.listModels()) })
    const idn = await identityOf(req, res)
    try {
      let apiKey = String(req.body?.apiKey || '').trim()
      const existing = await connectionOf(idn, def.id)
      if (!apiKey) {
        apiKey = existing ? open(existing.token_enc) : null
        if (!apiKey) return res.status(400).json({ error: 'API 키를 입력하세요.', code: 'BAD_REQUEST' })
      } else if (!keyFormatOk(apiKey)) return res.status(400).json({ error: '키 형식이 올바르지 않습니다. 공백 없이 그대로 붙여 넣으세요.', code: 'BAD_KEY' })
      const baseUrl = normalizeBaseUrl(def, req.body?.baseUrl ?? existing?.meta?.baseUrl)
      const r = await checkKey(def, apiKey, baseUrl)
      res.json({ ok: true, models: r.models, suggested: r.suggested, unverified: Boolean(r.unverified) })
    } catch (e) {
      if (e instanceof AiError) return fail(res, e)
      throw e
    }
  })
)

// ── 연결 ─────────────────────────────────────────────────────
router.put(
  '/ai/connections/:provider',
  signedIn,
  configLimiter,
  wrap(async (req, res) => {
    const def = getDef(req.params.provider)
    if (!def || def.noKey) return res.status(404).json({ error: 'not found' })
    const idn = await identityOf(req, res)
    const sb = needSecretBox()
    if (sb) return res.status(sb.status).json(sb.body)
    try {
      const existing = await connectionOf(idn, def.id)
      const prev = existing?.meta || {}
      const typedKey = String(req.body?.apiKey || '').trim()
      let apiKey = typedKey
      if (typedKey) {
        if (!keyFormatOk(typedKey)) return res.status(400).json({ error: '키 형식이 올바르지 않습니다. 공백 없이 그대로 붙여 넣으세요.', code: 'BAD_KEY' })
      } else {
        apiKey = existing ? open(existing.token_enc) : null
        if (!apiKey) return res.status(400).json({ error: existing ? '저장된 키를 읽을 수 없습니다. 키를 다시 입력해 연결하세요.' : 'API 키를 입력하세요.', code: existing ? 'BAD_KEY' : 'BAD_REQUEST' })
      }
      const baseUrl = normalizeBaseUrl(def, req.body?.baseUrl !== undefined ? req.body.baseUrl : prev.baseUrl)
      const model = req.body?.model === undefined ? prev.model || '' : String(req.body.model || '').trim()
      if (model && !MODEL_RE.test(model)) return res.status(400).json({ error: '모델 이름이 올바르지 않습니다.', code: 'BAD_REQUEST' })
      const maxTokens = req.body?.maxTokens === undefined ? prev.maxTokens || null : req.body.maxTokens === null || req.body.maxTokens === '' ? null : intIn(req.body.maxTokens, 16, 64000)
      if (req.body?.maxTokens && !maxTokens) return res.status(400).json({ error: '최대 출력 토큰은 16에서 64000 사이의 숫자로 입력하세요.', code: 'BAD_REQUEST' })

      // 새 키이거나 주소가 바뀌었으면 제공업체에 한 번 시험 호출한다
      let models = []
      let suggested = null
      let unverified = false
      if (typedKey || (baseUrl || '') !== (prev.baseUrl || '') || !existing) {
        const r = await checkKey(def, apiKey, baseUrl)
        models = r.models
        suggested = r.suggested
        unverified = Boolean(r.unverified)
      }
      const meta = { model: model || prev.model || suggested || null, keyHint: typedKey ? `…${typedKey.slice(-4)}` : prev.keyHint || `…${apiKey.slice(-4)}`, ...(baseUrl ? { baseUrl } : {}), ...(maxTokens ? { maxTokens } : {}), ...(unverified ? { unverified: true } : {}) }
      await query(
        `INSERT INTO ws_connections (email, provider, token_enc, meta) VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (lower(email), provider) DO UPDATE SET token_enc = EXCLUDED.token_enc, meta = EXCLUDED.meta, created_at = now()`,
        [idn.emails[0], dbProvider(def.id), typedKey ? seal(apiKey) : existing.token_enc, JSON.stringify(meta)]
      )
      modelCache.clear()
      res.set('Cache-Control', 'no-store')
      res.json({ provider: def.id, connected: true, keyHint: meta.keyHint, model: meta.model, maxTokens: meta.maxTokens || null, ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}), models, suggested, unverified })
    } catch (e) {
      if (e instanceof AiError) return fail(res, e)
      throw e
    }
  })
)

router.delete(
  '/ai/connections/:provider',
  signedIn,
  configLimiter,
  wrap(async (req, res) => {
    const def = getDef(req.params.provider)
    if (!def || def.noKey) return res.status(404).json({ error: 'not found' })
    const idn = await identityOf(req, res)
    await query('DELETE FROM ws_connections WHERE lower(email) = ANY($1::text[]) AND provider = $2', [lowerEmails(idn), dbProvider(def.id)])
    modelCache.clear()
    res.json({ provider: def.id, connected: false })
  })
)

// ── 모델 목록 (5분 캐시) ──────────────────────────────────────
const modelCache = new Map()
router.get(
  '/ai/models',
  signedIn,
  configLimiter,
  wrap(async (req, res) => {
    const def = getDef(String(req.query.provider || ''))
    if (!def) return res.status(404).json({ error: 'not found' })
    res.set('Cache-Control', 'no-store')
    if (def.noKey) return res.json((await def.adapter.listModels()).models)
    const idn = await identityOf(req, res)
    const conn = await connectionOf(idn, def.id)
    if (!conn) return res.status(409).json({ error: '연결되지 않은 제공업체입니다.', code: 'NOT_CONNECTED' })
    const apiKey = open(conn.token_enc)
    if (!apiKey) return res.status(409).json({ error: '저장된 키를 읽을 수 없습니다. 키를 다시 연결하세요.', code: 'BAD_KEY' })
    const cacheKey = `${idn.emails[0]}|${def.id}|${crypto.createHash('sha256').update(conn.token_enc).digest('hex').slice(0, 12)}|${conn.meta?.baseUrl || ''}`
    const hit = modelCache.get(cacheKey)
    if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return res.json(hit.models)
    try {
      const r = await checkKey(def, apiKey, conn.meta?.baseUrl || '')
      if (modelCache.size >= 300) modelCache.delete(modelCache.keys().next().value)
      modelCache.set(cacheKey, { at: Date.now(), models: r.models })
      res.json(r.models)
    } catch (e) {
      if (e instanceof AiError) return fail(res, e)
      throw e
    }
  })
)

// ── 채팅 (SSE) ───────────────────────────────────────────────
class BadRequest extends Error {}
const bad = (m) => new BadRequest(m)
const jsonSize = (v) => {
  try {
    return JSON.stringify(v)?.length ?? 0
  } catch {
    return Infinity
  }
}

export function cleanChatBody(b) {
  if (!b || typeof b !== 'object') throw bad('요청 형식이 올바르지 않습니다.')
  if (!Array.isArray(b.messages) || !b.messages.length) throw bad('보낼 메시지가 없습니다.')
  if (b.messages.length > MAX_MESSAGES) throw bad(`메시지는 ${MAX_MESSAGES}개까지 보낼 수 있습니다. 대화를 지우고 다시 시도하세요.`)
  const tools = b.tools === undefined || b.tools === null ? [] : b.tools
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw bad(`도구는 ${MAX_TOOLS}개까지 보낼 수 있습니다.`)
  const messages = []
  for (const m of b.messages) {
    if (!m || typeof m !== 'object' || !['user', 'assistant', 'tool'].includes(m.role)) throw bad('메시지 역할이 올바르지 않습니다.')
    const content = m.content === undefined || m.content === null ? '' : String(m.content)
    if (content.length > 300000) throw bad('메시지가 너무 깁니다.')
    const out = { role: m.role, content }
    if (m.images !== undefined) {
      if (m.role !== 'user' || !Array.isArray(m.images) || m.images.length > 6 || !m.images.every((u) => typeof u === 'string' && DATA_URL_RE.test(u))) throw bad('이미지는 사용자 메시지에 png, jpeg, webp 6장까지 붙일 수 있습니다.')
      out.images = m.images
    }
    if (m.role === 'assistant' && m.toolCalls !== undefined) {
      if (!Array.isArray(m.toolCalls) || m.toolCalls.length > MAX_TOOLS) throw bad('도구 호출 형식이 올바르지 않습니다.')
      out.toolCalls = m.toolCalls.map((t) => {
        if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 200 || typeof t.name !== 'string' || !/^[\w.:-]{1,128}$/.test(t.name)) throw bad('도구 호출 형식이 올바르지 않습니다.')
        const args = t.args && typeof t.args === 'object' && !Array.isArray(t.args) ? t.args : {}
        if (t.meta !== undefined && jsonSize(t.meta) > 50000) throw bad('도구 호출 정보가 너무 큽니다.')
        return { id: t.id, name: t.name, args, ...(t.meta !== undefined ? { meta: t.meta } : {}) }
      })
    }
    if (m.role === 'tool') {
      if (typeof m.toolCallId !== 'string' || !m.toolCallId || m.toolCallId.length > 200) throw bad('도구 결과에 toolCallId 가 필요합니다.')
      out.toolCallId = m.toolCallId
      if (typeof m.toolName === 'string') out.toolName = m.toolName.slice(0, 128)
    }
    if (m.meta !== undefined && m.meta !== null) {
      if (jsonSize(m.meta) > 200000) throw bad('메시지 정보가 너무 큽니다.')
      out.meta = m.meta
    }
    messages.push(out)
  }
  while (messages.length && messages[0].role !== 'user') messages.shift() // 맨 앞은 사용자 메시지여야 한다
  const lastRole = messages[messages.length - 1]?.role
  if (!messages.length || (lastRole !== 'user' && lastRole !== 'tool')) throw bad('마지막 메시지는 사용자 메시지나 도구 결과여야 합니다.')
  const cleanTools = tools.map((t) => {
    if (!t || typeof t.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) throw bad('도구 이름은 영문, 숫자, _, - 만 쓸 수 있습니다.')
    const parameters = t.parameters && typeof t.parameters === 'object' ? t.parameters : { type: 'object', properties: {} }
    if (jsonSize(parameters) > 30000) throw bad('도구 설명이 너무 큽니다.')
    return { name: t.name, description: String(t.description || '').slice(0, 4000), parameters }
  })
  const system = b.system === undefined || b.system === null ? '' : String(b.system)
  if (system.length > 60000) throw bad('시스템 안내가 너무 깁니다.')
  const temperature = b.temperature === undefined || b.temperature === null ? undefined : Number(b.temperature)
  if (temperature !== undefined && !(temperature >= 0 && temperature <= 2)) throw bad('temperature 는 0에서 2 사이여야 합니다.')
  return { messages, tools: cleanTools, system, temperature, maxTokens: b.maxTokens === undefined || b.maxTokens === null ? null : intIn(b.maxTokens, 16, 64000), model: typeof b.model === 'string' ? b.model.trim() : '' }
}

router.post(
  '/ai/chat',
  signedIn,
  chatLimiter,
  wrap(async (req, res) => {
    const declared = Number(req.headers['content-length'] || 0)
    if (declared > MAX_BODY_BYTES || jsonSize(req.body) > MAX_BODY_BYTES) return res.status(413).json({ error: '보낼 내용이 너무 큽니다(600KB 이하). 이미지를 줄이거나 대화를 지우세요.', code: 'TOO_LARGE' })
    const def = getDef(String(req.body?.provider || ''))
    if (!def) return res.status(400).json({ error: '제공업체를 선택하세요.', code: 'BAD_REQUEST' })
    let body
    try {
      body = cleanChatBody(req.body)
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' })
      throw e
    }

    const idn = await identityOf(req, res)
    let apiKey = ''
    let conn = null
    if (!def.noKey) {
      conn = await connectionOf(idn, def.id)
      if (!conn) return res.status(409).json({ error: `${def.name} 이(가) 연결되어 있지 않습니다. 설정에서 키를 연결하세요.`, code: 'NOT_CONNECTED' })
      apiKey = open(conn.token_enc)
      if (!apiKey) return res.status(409).json({ error: '저장된 키를 읽을 수 없습니다. 설정에서 키를 다시 연결하세요.', code: 'BAD_KEY' })
    }
    const model = body.model || conn?.meta?.model || (def.noKey ? 'mock-1' : '')
    if (!model || !MODEL_RE.test(model)) return res.status(400).json({ error: '모델을 선택하세요.', code: 'BAD_REQUEST' })

    // 여기서부터 SSE. 오류도 이벤트로 보낸다.
    res.status(200)
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders?.()
    const ac = new AbortController()
    let closed = false
    let timedOut = false
    res.on('close', () => {
      closed = true
      ac.abort()
    })
    const send = (ev) => {
      if (closed || res.writableEnded) return
      res.write(`data: ${JSON.stringify(ev)}\n\n`)
    }
    const heartbeat = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': ping\n\n')
    }, 15000)
    const timer = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, CHAT_TIMEOUT_MS)

    try {
      const ctx = makeCtx(def, conn?.meta?.baseUrl ? { baseUrl: conn.meta.baseUrl } : null, {
        apiKey,
        model,
        signal: ac.signal,
        maxTokens: body.maxTokens || conn?.meta?.maxTokens || undefined,
        temperature: body.temperature,
        system: body.system,
        messages: body.messages,
        tools: body.tools,
      })
      let ended = false
      for await (const ev of def.adapter.stream(ctx)) {
        send(ev)
        if (ev.type === 'done') ended = true
      }
      if (!ended && !closed) send({ type: 'done', stopReason: 'end' })
    } catch (e) {
      if (!closed) {
        if (timedOut) send({ type: 'error', code: 'UPSTREAM', message: '응답이 너무 오래 걸려 중단했습니다. 다시 시도하세요.' })
        else if (e instanceof AiError) send({ type: 'error', code: e.code, message: maskSecrets(e.message, apiKey) })
        else if (e?.name === 'AbortError' || e?.name === 'TimeoutError') send({ type: 'error', code: 'UPSTREAM', message: '응답이 중단되었습니다.' })
        else send({ type: 'error', code: 'UPSTREAM', message: '제공업체 응답을 처리하지 못했습니다. 다시 시도하세요.' })
      }
    } finally {
      clearTimeout(timer)
      clearInterval(heartbeat)
      if (!res.writableEnded) res.end()
    }
  })
)

export default router
