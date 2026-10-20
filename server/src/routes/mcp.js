// MCP 커넥터: 사용자의 AI 앱(Claude, ChatGPT, Codex, Gemini CLI 등)이 우리 서비스에 연결해 도구를 부른다.
// 사용자의 AI 구독을 쓰되 우리는 그 자격 증명을 보지 않는다(앱이 우리에게 접속하는 방향).
//
//   GET  /.well-known/oauth-protected-resource[/mcp]       RFC 9728 보호 자원 메타데이터
//   GET  /.well-known/oauth-authorization-server[/mcp]     RFC 8414 인가 서버 메타데이터 (/.well-known/openid-configuration 도 같은 내용)
//   POST /mcp/oauth/register                               RFC 7591 동적 클라이언트 등록
//   GET|POST /mcp/oauth/authorize                          로그인 확인 + 동의 화면(허용/취소), 인가 코드 발급
//   POST /mcp/oauth/token                                  authorization_code(+PKCE S256), refresh_token(회전)
//   POST /mcp/oauth/revoke                                 RFC 7009
//   POST /mcp                                              MCP Streamable HTTP 엔드포인트(JSON-RPC, 무상태)
//   GET  /mcp/info, GET /mcp/connections, DELETE /mcp/connections/:id, GET /mcp/audit     연결 화면용(로그인 쿠키)
//   POST /mcp/relay/presence, GET /mcp/relay/jobs, POST /mcp/relay/jobs/:id/result, POST /mcp/relay/disconnect   편집기 탭(로그인 쿠키)
// 이 라우터는 app.js 에서 맨 앞에 붙는다(자체 CORS·본문 해석을 쓰기 때문). 다른 경로는 건드리지 않고 지나간다.
import express, { Router } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { isConfigured, query } from '../db.js'
import { jwtSecret, optionalAuth } from '../middleware/auth.js'
import { optionalPublicAuth } from '../middleware/publicAuth.js'
import { fileRow, identityOf, levelFor } from '../lib/wsAccess.js'
import { ensureMcpSchemaOnce } from '../lib/mcpSchema.js'
import {
  OAuthError, SCOPES, authenticateBearer, maintenance, authorizationServerMetadata, checkAuthorizeRequest, handleTokenRequest, isLoopbackUrl, issueCode,
  parseRedirect, protectedResourceMetadata, publicBase, redirectWith, registerClient, revokeByToken, revokeSession, scopeList, takeRateSlot, urlsFor,
} from '../lib/mcpOAuth.js'
import { handleRpc, E, SUPPORTED } from '../lib/mcpRpc.js'
import { actorReq, toolCount, registeredFileKinds } from '../lib/mcpTools.js'
import { cancelPending, claimJob, completeJob, dropPresence, relayActive, touchPresence } from '../lib/mcpRelay.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const lower = (v) => String(v || '').trim().toLowerCase()
const noStore = (res) => res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' })

const dbGuard = wrap(async (req, res, next) => {
  if (!isConfigured()) return res.status(503).json({ error: 'DATABASE_URL not configured' })
  await ensureMcpSchemaOnce()
  next()
})

// ── 도우미 ──────────────────────────────────────────────────
/** 브라우저가 보낸 Origin 을 검사한다(MCP 규격: DNS 리바인딩 방지). 없으면(서버·CLI 호출) 통과 */
export function allowedOrigins(req) {
  const own = publicBase(req)
  const list = new Set([own, 'https://claude.ai', 'https://claude.com', 'https://chatgpt.com', 'https://chat.openai.com'])
  for (const o of String(process.env.CLIENT_ORIGIN || '').split(',')) if (o.trim()) list.add(o.trim().replace(/\/+$/, ''))
  for (const o of String(process.env.MCP_ALLOWED_ORIGINS || '').split(',')) if (o.trim()) list.add(o.trim().replace(/\/+$/, ''))
  return list
}
export function originOk(req) {
  const o = req.get('origin')
  if (!o) return true
  return allowedOrigins(req).has(o.replace(/\/+$/, ''))
}
const jsonRpcError = (res, status, code, message) => res.status(status).json({ jsonrpc: '2.0', id: null, error: { code, message } })

const publicCors = (methods) => (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': methods, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version', 'Access-Control-Max-Age': '600' })
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
}

const tabCors = cors({ origin: process.env.CLIENT_ORIGIN?.split(',').map((s) => s.trim()) || true, credentials: true })
const lim = (name, windowMs, max) =>
  rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => res.status(429).json({ error: 'too_many_requests', error_description: `${name} 요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.` }) })
const dcrLimit = lim('등록', 3600_000, Number(process.env.MCP_DCR_LIMIT) || 60)
const tokenLimit = lim('토큰', 15 * 60_000, Number(process.env.MCP_TOKEN_LIMIT) || 300)

// ── 메타데이터 ──────────────────────────────────────────────
const prm = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/mcp/.well-known/oauth-protected-resource']
const asm = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration', '/.well-known/openid-configuration/mcp', '/mcp/.well-known/oauth-authorization-server', '/mcp/.well-known/openid-configuration']
router.use([...prm, ...asm], publicCors('GET, OPTIONS'))
router.get(prm, (req, res) => res.set('Cache-Control', 'public, max-age=300').json(protectedResourceMetadata(req)))
router.get(asm, (req, res) => res.set('Cache-Control', 'public, max-age=300').json(authorizationServerMetadata(req)))

// ── 클라이언트 등록 ──────────────────────────────────────────
router.options(['/mcp/oauth/register', '/mcp/oauth/token', '/mcp/oauth/revoke'], publicCors('POST, OPTIONS'))
router.post(
  '/mcp/oauth/register',
  publicCors('POST, OPTIONS'),
  dbGuard,
  dcrLimit,
  express.json({ limit: '64kb' }),
  wrap(async (req, res) => {
    noStore(res)
    try {
      const out = await registerClient(req.body)
      res.status(201).json(out)
    } catch (e) {
      if (e instanceof OAuthError) return res.status(e.status).json({ error: e.code === 'invalid_redirect_uri' ? 'invalid_redirect_uri' : 'invalid_client_metadata', error_description: e.description })
      throw e
    }
  })
)

// ── 인가 (동의 화면) ──────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const PAGE_CSS = `
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f2f2;color:#1f1f1f;font-family:'Pretendard Variable',Pretendard,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;line-height:1.55}
main{width:min(460px,calc(100vw - 32px));background:#fff;border-radius:16px;box-shadow:0 1px 4px rgba(0,0,0,.22);padding:28px 28px 22px}
h1{font-size:19px;margin:0 0 6px;font-weight:700}p{margin:0 0 14px;color:#4a4a4a;font-size:14px}
.app{font-weight:700;color:#1f1f1f}.acct{background:#f2f2f2;border-radius:10px;padding:9px 12px;font-size:13px;color:#333;margin:0 0 16px}
h2{font-size:13px;margin:16px 0 6px;color:#1f1f1f}ul{margin:0 0 4px;padding-left:18px;font-size:13.5px;color:#333}li{margin:3px 0}
label.opt{display:flex;gap:8px;align-items:flex-start;font-size:13.5px;margin:6px 0;color:#333;cursor:pointer}label.opt input{margin-top:3px;accent-color:#7A3CFF}
.no li{color:#555}.warn{background:#FFEA00;color:#1f1f1f;border-radius:10px;padding:9px 12px;font-size:13px;margin:12px 0}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;font:inherit;font-weight:600;font-size:15px;border:0;border-radius:24px;padding:12px 0;cursor:pointer}
.ok{background:#7A3CFF;color:#fff}.ok:hover{background:#6200ea}.no-btn{background:#e2e2e2;color:#1f1f1f}.no-btn:hover{background:#d4d4d4}
.foot{font-size:12px;color:#666;margin:14px 0 0}.err{color:#FF1744;font-weight:600}
`
function shell(title, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><main>${body}</main></body></html>`
}
function pageHeaders(res) {
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // form-action 은 일부러 비워 둔다: 허용 후 앱의 돌려받는 주소(다른 도메인)로 보내야 한다. 그 주소는 서버가 등록 값과 대조한 것만 쓴다.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  })
}
const errorPage = (res, msg, status = 400) => {
  pageHeaders(res)
  res.status(status).send(shell('연결할 수 없습니다', `<h1>연결할 수 없습니다</h1><p class="err">${esc(msg)}</p><p>연결을 시작한 AI 앱으로 돌아가 다시 시도해 주세요.</p>`))
}

/** 로그인한 사람(스태프 또는 구글 게스트). 없으면 null */
async function signedInActor(req, res) {
  await new Promise((done) => optionalAuth(req, res, done))
  await new Promise((done) => optionalPublicAuth(req, res, done))
  if (req.user) return { kind: 'staff', id: req.user.id, email: lower(req.user.email), name: req.user.name }
  if (req.publicUser) return { kind: 'guest', id: req.publicUser.id, email: lower(req.publicUser.email), name: req.publicUser.name }
  return null
}
const loginPath = () => `${process.env.VERCEL ? '/api' : ''}/auth/google/login`

function consentPage({ client, actor, txn, scopeWrite, host, loopback }) {
  let origin = '직접 등록한 앱'
  if (client.kind === 'cimd') {
    try { origin = `앱 정보 출처: ${new URL(client.client_id).hostname}` } catch { origin = '' }
  }
  return shell(
    'AI 앱 연결 허용',
    `<h1>AI 앱 연결을 허용할까요?</h1>
<p><span class="app">${esc(client.client_name)}</span> 이(가) 디인예 워크스페이스에 연결하려 합니다.</p>
<div class="acct">${esc(actor.email)} 계정으로 연결됩니다</div>
<form method="post" action="authorize">
<input type="hidden" name="txn" value="${esc(txn)}">
<h2>허용하면 이 앱은 할 수 있습니다</h2>
<ul><li>내가 열 수 있는 파일의 목록과 내용 읽기</li></ul>
${scopeWrite ? `<label class="opt"><input type="checkbox" name="write" value="1" checked><span>내가 편집 권한이 있는 문서, 시트, 발표, 보드, 설문 만들기와 고치기</span></label>` : ''}
<h2>이 앱이 할 수 없는 일</h2>
<ul class="no"><li>공유 설정과 권한 바꾸기</li><li>파일 영구 삭제</li><li>저장된 API 키와 연결 정보 읽기</li><li>다른 사람의 파일 열기</li></ul>
${loopback ? '<div class="warn">이 앱은 이 컴퓨터(localhost)에서 실행됩니다. 직접 연결을 시작했을 때만 허용하세요.</div>' : ''}
<p class="foot">${esc(origin)} · 허용 후 돌아갈 곳: ${esc(host)}</p>
<div class="row"><button class="no-btn" type="submit" name="decision" value="deny">취소</button><button class="ok" type="submit" name="decision" value="allow">허용</button></div>
<p class="foot">연결은 작업공간의 연결 화면에서 언제든 해제할 수 있습니다.</p>
</form>`
  )
}

router.use('/mcp/oauth/authorize', cookieParser())
router.get(
  '/mcp/oauth/authorize',
  dbGuard,
  wrap(async (req, res) => {
    const chk = await checkAuthorizeRequest(req, req.query)
    if (chk.fatal) return errorPage(res, chk.fatal)
    if (chk.error) return res.redirect(302, redirectWith(req, chk.redirect_uri, { error: chk.error, error_description: chk.description, state: chk.state }))
    const actor = await signedInActor(req, res)
    if (!actor) {
      noStore(res)
      return res.redirect(302, `${loginPath()}?next=${encodeURIComponent(req.originalUrl)}`)
    }
    const { client, params } = chk
    // 이미 허용한 앱이고 요청 범위가 그 안이면 동의 화면을 건너뛴다(prompt=consent 로 강제 가능)
    if (req.query.prompt !== 'consent') {
      const g = (await query('SELECT scope FROM mcp_grants WHERE user_email = $1 AND client_id = $2', [actor.email, client.client_id])).rows[0]
      if (g && scopeList(params.scope).every((s) => scopeList(g.scope).includes(s))) {
        const code = await issueCode(params, actor)
        noStore(res)
        return res.redirect(302, redirectWith(req, params.redirect_uri, { code, state: params.state }))
      }
    }
    const txn = jwt.sign({ typ: 'mcp_consent', params, email: actor.email, k: actor.kind, uid: actor.id }, jwtSecret(), { expiresIn: 600 })
    const ru = parseRedirect(params.redirect_uri)
    pageHeaders(res)
    res.send(consentPage({ client, actor, txn, scopeWrite: scopeList(params.scope).includes('dah.write'), host: ru?.host || '', loopback: Boolean(ru && isLoopbackUrl(ru)) }))
  })
)

router.post(
  '/mcp/oauth/authorize',
  dbGuard,
  express.urlencoded({ extended: false, limit: '16kb' }),
  wrap(async (req, res) => {
    // CSRF: 같은 사이트에서 보낸 폼만 받는다(Origin/Sec-Fetch-Site) + 서명된 1회용 성격의 txn 이 이 사용자에 묶여 있어야 한다
    const o = req.get('origin')
    if (o) {
      let same = false
      try { same = new URL(o).host === req.get('host') } catch { same = false }
      if (!same) return errorPage(res, '다른 사이트에서 보낸 요청입니다.', 403)
    }
    const sfs = req.get('sec-fetch-site')
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') return errorPage(res, '다른 사이트에서 보낸 요청입니다.', 403)
    let t
    try {
      t = jwt.verify(String(req.body?.txn || ''), jwtSecret())
    } catch {
      return errorPage(res, '확인 시간이 지났습니다. 앱에서 연결을 다시 시작해 주세요.')
    }
    if (t.typ !== 'mcp_consent') return errorPage(res, '잘못된 요청입니다.')
    const actor = await signedInActor(req, res)
    if (!actor || actor.email !== t.email || actor.kind !== t.k) return errorPage(res, '로그인 상태가 바뀌었습니다. 앱에서 연결을 다시 시작해 주세요.', 401)
    const params = t.params
    // 저장된 클라이언트와 돌려받을 주소를 한 번 더 대조한다
    const chk = await checkAuthorizeRequest(req, { client_id: params.client_id, redirect_uri: params.redirect_uri, response_type: 'code', code_challenge: params.code_challenge, code_challenge_method: 'S256', scope: params.scope, resource: params.resource, state: params.state })
    if (chk.fatal) return errorPage(res, chk.fatal)
    if (req.body.decision !== 'allow') {
      return res.redirect(302, redirectWith(req, params.redirect_uri, { error: 'access_denied', error_description: '사용자가 허용하지 않았습니다', state: params.state }))
    }
    let scope = params.scope
    if (scopeList(scope).includes('dah.write') && req.body.write !== '1') scope = 'dah.read'
    const final = { ...params, scope }
    await query(
      `INSERT INTO mcp_grants (user_email, client_id, scope) VALUES ($1, $2, $3) ON CONFLICT (user_email, client_id) DO UPDATE SET scope = EXCLUDED.scope, granted_at = now()`,
      [actor.email, params.client_id, scope]
    )
    const code = await issueCode(final, actor)
    noStore(res)
    res.redirect(302, redirectWith(req, params.redirect_uri, { code, state: params.state }))
  })
)

// ── 토큰·폐기 ───────────────────────────────────────────────
const formBody = [express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' })]
router.post(
  '/mcp/oauth/token',
  publicCors('POST, OPTIONS'),
  dbGuard,
  tokenLimit,
  ...formBody,
  wrap(async (req, res) => {
    noStore(res)
    if (Math.random() < 0.02) maintenance().catch(() => {})
    try {
      res.json(await handleTokenRequest(req, req.body || {}))
    } catch (e) {
      if (e instanceof OAuthError) return res.status(e.status).json({ error: e.code, error_description: e.description })
      throw e
    }
  })
)
router.post(
  '/mcp/oauth/revoke',
  publicCors('POST, OPTIONS'),
  dbGuard,
  tokenLimit,
  ...formBody,
  wrap(async (req, res) => {
    noStore(res)
    const token = String(req.body?.token || '')
    if (token) await revokeByToken(token, req.body?.client_id ? String(req.body.client_id) : null)
    res.status(200).json({})
  })
)

// ── MCP 엔드포인트 ──────────────────────────────────────────
const MCP_HEADERS = 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID'
function challenge(req, res, extra = '') {
  const u = urlsFor(publicBase(req))
  res.set('WWW-Authenticate', `Bearer resource_metadata="${u.prm}", scope="${SCOPES.join(' ')}"${extra}`)
}

router.options('/mcp', (req, res) => {
  if (!originOk(req)) return res.status(403).end()
  const o = req.get('origin')
  if (o) res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin' })
  res.set({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': MCP_HEADERS, 'Access-Control-Max-Age': '600', 'Access-Control-Expose-Headers': 'WWW-Authenticate' })
  res.status(204).end()
})

router.all(
  '/mcp',
  dbGuard,
  wrap(async (req, res, next) => {
    if (!originOk(req)) return jsonRpcError(res, 403, E.INVALID_REQUEST, '허용되지 않는 Origin 입니다')
    const o = req.get('origin')
    if (o) res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Expose-Headers': 'WWW-Authenticate' })
    res.set('X-Content-Type-Options', 'nosniff')
    const auth = await authenticateBearer(req)
    if (!auth) {
      challenge(req, res, req.get('authorization') ? ', error="invalid_token"' : '')
      return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '로그인(연결 허용)이 필요합니다' } })
    }
    if (req.method !== 'POST') {
      // 규격 2026-07-28 이후는 GET 스트림과 세션 종료(DELETE)를 두지 않는다. 옛 클라이언트에는 405 로 알린다.
      return res.set('Allow', 'POST, OPTIONS').status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'POST 만 지원합니다' } })
    }
    req.mcpAuth = auth
    next()
  }),
  express.json({ limit: '1mb', type: () => true }),
  wrap(async (req, res) => {
    const { session, scopes } = req.mcpAuth
    if (!(await takeRateSlot(session.id))) {
      res.set('Retry-After', '60')
      return jsonRpcError(res, 429, -32000, '호출이 너무 많습니다(분당 한도). 잠시 뒤 다시 시도하세요')
    }
    const actor = await actorReq(session)
    if (!actor) {
      challenge(req, res, ', error="invalid_token"')
      return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '계정을 찾을 수 없습니다. 다시 연결해 주세요' } })
    }
    const hdr = {}
    for (const k of ['mcp-protocol-version', 'mcp-method', 'mcp-name']) if (req.headers[k] !== undefined) hdr[k] = String(req.headers[k])
    const r = await handleRpc({ req: actor, session, scopes, base: publicBase(req) }, req.body, hdr)
    for (const c of r.calls) {
      query('INSERT INTO mcp_audit (user_email, client_id, session_id, tool, file_id, ok, code, ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [lower(session.user_email), session.client_id, session.id, c.tool, c.audit?.file_id ?? null, Boolean(c.ok), c.code || null, c.ms ?? null]).catch(() => {})
    }
    if (r.status === 403 && r.scopeError) {
      challenge(req, res, `, error="insufficient_scope", scope="${r.scopeError}"`)
      return res.status(403).json(r.body)
    }
    if (r.status === 202 || r.body === null) return res.status(202).end()
    // Accept 에 json 이 없고 event-stream 만 있으면 SSE 한 번으로 답한다
    const accept = String(req.get('accept') || '')
    if (!/application\/json|\*\/\*/.test(accept) && /text\/event-stream/.test(accept)) {
      res.status(r.status).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
      return res.end(`event: message\ndata: ${JSON.stringify(r.body)}\n\n`)
    }
    res.status(r.status).json(r.body)
  })
)

// JSON 해석 실패 등: /mcp 에서는 항상 JSON-RPC 모양으로 답한다
// eslint-disable-next-line no-unused-vars
router.use('/mcp', (err, req, res, next) => {
  if (req.path !== '/') return next(err)
  if (err?.type === 'entity.parse.failed') return jsonRpcError(res, 400, E.PARSE, 'JSON 을 해석할 수 없습니다')
  if (err?.type === 'entity.too.large') return jsonRpcError(res, 413, E.INVALID_REQUEST, '요청이 너무 큽니다(1MB 한도)')
  console.error('[mcp] 오류', err)
  return jsonRpcError(res, 500, E.INTERNAL, '서버 오류')
})

// ── 연결 화면·편집기 탭(로그인 쿠키) ─────────────────────────────
const tab = Router()
tab.use(tabCors, cookieParser(), express.json({ limit: '1mb' }), dbGuard)
// 경로는 /mcp 아래의 상대 경로다(router.use('/mcp', tab))
const needUser = wrap(async (req, res, next) => {
  await new Promise((done) => optionalAuth(req, res, done))
  await new Promise((done) => optionalPublicAuth(req, res, done))
  const idn = await identityOf(req, res)
  if (!idn.emails.length) return res.status(401).json({ error: 'login required' })
  req.idn = idn
  next()
})

tab.get('/info', (req, res) => res.json({ url: urlsFor(publicBase(req)).resource, versions: SUPPORTED, tools: toolCount(), kinds: registeredFileKinds() }))

tab.get(
  '/connections',
  needUser,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT s.id, s.client_id, s.scope, s.created_at, s.last_used_at, c.client_name, c.kind AS client_kind, c.redirect_uris
         FROM mcp_sessions s LEFT JOIN mcp_clients c ON c.client_id = s.client_id
        WHERE lower(s.user_email) = ANY($1::text[]) AND s.revoked_at IS NULL ORDER BY s.last_used_at DESC NULLS LAST, s.created_at DESC LIMIT 50`,
      [req.idn.emails]
    )
    const items = rows.map((r) => {
      let host = ''
      try { host = new URL((r.redirect_uris || [])[0]).hostname } catch { host = '' }
      return { id: r.id, name: r.client_name || '이름 없는 앱', host, scope: r.scope, can_write: scopeList(r.scope).includes('dah.write'), created_at: r.created_at, last_used_at: r.last_used_at }
    })
    res.json({ items })
  })
)
tab.delete(
  '/connections/:id',
  needUser,
  wrap(async (req, res) => {
    const s = (await query('SELECT id, user_email, client_id FROM mcp_sessions WHERE id = $1 AND revoked_at IS NULL', [String(req.params.id)])).rows[0]
    if (!s || !req.idn.emails.includes(lower(s.user_email))) return res.status(404).json({ error: 'not found' })
    await revokeSession(s.id, 'user_revoked')
    // 같은 앱의 "이미 허용함" 기록도 지운다: 다시 연결하면 동의 화면이 다시 나온다
    await query('DELETE FROM mcp_grants WHERE lower(user_email) = ANY($1::text[]) AND client_id = $2', [req.idn.emails, s.client_id])
    await query(`UPDATE mcp_jobs SET status = 'failed', done_at = now(), result = '{"ok":false,"error":"연결이 해제되었습니다"}'::jsonb WHERE session_id = $1 AND status IN ('pending','picked')`, [s.id])
    res.json({ ok: true })
  })
)
tab.get(
  '/audit',
  needUser,
  wrap(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
    const { rows } = await query(
      `SELECT a.at, a.tool, a.file_id, a.ok, a.code, c.client_name FROM mcp_audit a LEFT JOIN mcp_clients c ON c.client_id = a.client_id
        WHERE lower(a.user_email) = ANY($1::text[]) ORDER BY a.at DESC LIMIT $2`,
      [req.idn.emails, limit]
    )
    res.json({ items: rows })
  })
)

/** 탭이 보낸 file_id 를 확인한다: 파일이 있고 내가 열 수 있어야 한다 */
async function tabFile(req, res, raw) {
  const id = Number.parseInt(raw, 10)
  const file = Number.isInteger(id) ? await fileRow(id) : null
  const level = file && !file.gated ? await levelFor(req, res, file) : null
  if (!file || !level) {
    res.status(404).json({ error: 'not found' })
    return null
  }
  return { file, level }
}

tab.post(
  '/relay/presence',
  needUser,
  wrap(async (req, res) => {
    const f = await tabFile(req, res, req.body?.file_id)
    if (!f) return
    const tabId = String(req.body?.tab_id || '').slice(0, 64)
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(tabId)) return res.status(400).json({ error: 'tab_id required' })
    if (req.body?.leave === true) {
      await dropPresence(req.idn.emails, f.file.id, tabId)
      return res.json({ ok: true })
    }
    await touchPresence(req.idn.emails, f.file.id, tabId, f.file.kind, f.level === 'editor' && req.body?.can_edit === true)
    res.json({ ok: true, active: await relayActive(req.idn.emails, f.file.id) })
  })
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
tab.get(
  '/relay/jobs',
  needUser,
  wrap(async (req, res) => {
    const f = await tabFile(req, res, req.query.file_id)
    if (!f) return
    const tabId = String(req.query.tab_id || '').slice(0, 64)
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(tabId)) return res.status(400).json({ error: 'tab_id required' })
    let closed = false
    res.on('close', () => { if (!res.writableEnded) closed = true }) // 탭이 연결을 끊었다(응답을 끝내기 전에 닫힘)
    await touchPresence(req.idn.emails, f.file.id, tabId, f.file.kind, f.level === 'editor' && req.query.can_edit === '1')
    const deadline = Date.now() + (Number(req.query.wait_ms) > 0 ? Math.min(25_000, Number(req.query.wait_ms)) : 25_000)
    noStore(res)
    while (!closed && Date.now() < deadline) {
      const job = await claimJob(req.idn.emails, f.file.id)
      if (job) {
        if (closed) {
          // 받는 사이 탭이 사라졌다: 작업을 되돌려 놓아 다른 탭이나 다음 폴링이 가져가게 한다
          await query("UPDATE mcp_jobs SET status = 'pending', picked_at = NULL WHERE id = $1 AND status = 'picked'", [job.id])
          return
        }
        return res.json({ job: { id: String(job.id), tool: job.tool, args: job.args }, active: true })
      }
      await sleep(600)
    }
    if (closed) return
    res.json({ job: null, active: await relayActive(req.idn.emails, f.file.id) })
  })
)

tab.post(
  '/relay/jobs/:id/result',
  needUser,
  wrap(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' })
    const ok = await completeJob(req.idn.emails, id, req.body)
    res.status(ok ? 200 : 404).json({ ok })
  })
)

tab.post(
  '/relay/disconnect',
  needUser,
  wrap(async (req, res) => {
    const f = await tabFile(req, res, req.body?.file_id)
    if (!f) return
    await cancelPending(req.idn.emails, f.file.id, '사용자가 편집기에서 외부 AI 연결을 끊었습니다')
    await dropPresence(req.idn.emails, f.file.id)
    res.json({ ok: true })
  })
)
router.use('/mcp', tab)

export default router
