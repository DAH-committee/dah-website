// MCP 커넥터용 OAuth 2.1 인가 서버 (같은 서버가 보호 자원(/mcp)과 인가 서버를 함께 맡는다).
//
// 따르는 규격(2026-10 확인):
//   MCP authorization 2025-03-26/2025-06-18/2025-11-25 (Claude 가 이 세 판을 따른다고 문서에 적혀 있다) + 2026-07-28(최신)
//   RFC 9728 보호 자원 메타데이터, RFC 8414 인가 서버 메타데이터, RFC 7591 동적 클라이언트 등록, RFC 7636 PKCE(S256 만),
//   RFC 8707 resource 지시자(토큰의 audience), RFC 7009 토큰 폐기, RFC 9207 iss 응답 매개변수, RFC 8252 루프백 리디렉션,
//   Client ID Metadata Document(draft-ietf-oauth-client-id-metadata-document): client_id 가 https 주소인 클라이언트
// 설계 원칙:
//   - 공개 클라이언트만(token_endpoint_auth_method none): 클라이언트 비밀번호를 발급하지 않는다. PKCE 가 필수다.
//   - 코드·액세스·리프레시 토큰은 SHA-256 해시만 저장한다. 평문은 응답으로 한 번만 나간다.
//   - 인가 코드는 60초, 한 번만. 다시 쓰이면 그 코드로 만든 연결을 폐기한다.
//   - 리프레시 토큰은 쓸 때마다 새로 발급(회전). 이미 쓴 토큰이 다시 오면 연결 전체를 폐기한다(재사용 감지).
//   - 리디렉션 주소는 등록한 값과 글자 그대로 같아야 하고(루프백은 포트만 무시), 그 전에 허용 목록을 통과해야 한다.
import crypto from 'node:crypto'
import { query } from '../db.js'
import { safeFetch } from './safeFetch.js'

export const SCOPES = ['dah.read', 'dah.write']
export const SCOPES_ADVERTISED = ['dah.read', 'dah.write', 'offline_access']
export const ACCESS_TTL_SEC = 30 * 60
export const REFRESH_TTL_SEC = 30 * 24 * 3600
export const SESSION_MAX_SEC = 90 * 24 * 3600
export const CODE_TTL_SEC = 60
export const DEFAULT_BASE = 'https://dah-hallym.vercel.app'

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
export const rand = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')
const safeEq = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// ── 주소 ───────────────────────────────────────────────────
/** 우리 서비스의 공개 주소(끝 슬래시 없음). 운영은 환경변수 MCP_PUBLIC_URL 또는 고정값, 로컬·시험은 요청의 Host 를 쓴다 */
export function publicBase(req) {
  const env = process.env.MCP_PUBLIC_URL?.trim()
  if (env) return env.replace(/\/+$/, '')
  if (process.env.NODE_ENV === 'production') return DEFAULT_BASE
  const host = req.get('host') || 'localhost'
  const proto = /^(localhost|127\.|\[::1\]|[^:]+\.localhost)(:|$)/.test(host) ? 'http' : req.protocol || 'https'
  return `${proto}://${host}`
}
export const urlsFor = (base) => ({
  base,
  issuer: base,
  resource: `${base}/mcp`,
  authorize: `${base}/mcp/oauth/authorize`,
  token: `${base}/mcp/oauth/token`,
  register: `${base}/mcp/oauth/register`,
  revoke: `${base}/mcp/oauth/revoke`,
  prm: `${base}/.well-known/oauth-protected-resource/mcp`,
})
/** 토큰의 audience 로 인정하는 resource 값(정확히 우리 /mcp. 일부 클라이언트가 보내는 루트 주소와 /api/mcp 도 같은 자원으로 본다) */
export function resourceOk(req, value) {
  if (!value) return true
  const b = publicBase(req)
  return [`${b}/mcp`, `${b}/mcp/`, b, `${b}/`, `${b}/api/mcp`].includes(String(value))
}

// ── 메타데이터 ──────────────────────────────────────────────
export function protectedResourceMetadata(req) {
  const u = urlsFor(publicBase(req))
  return {
    resource: u.resource,
    authorization_servers: [u.issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: '디인예 워크스페이스',
    resource_documentation: `${u.base}/workspace/integrations`,
  }
}
export function authorizationServerMetadata(req) {
  const u = urlsFor(publicBase(req))
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorize,
    token_endpoint: u.token,
    registration_endpoint: u.register,
    revocation_endpoint: u.revoke,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: SCOPES_ADVERTISED,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${u.base}/workspace/integrations`,
  }
}

// ── 리디렉션 주소 허용 목록 ───────────────────────────────────
// 근거: Claude 문서(claude.com/docs/connectors/building/authentication "Callback URLs"): 호스팅 앱은 https://claude.ai/api/mcp/auth_callback 한 개,
//        Claude Code 는 임의 포트의 루프백(http://localhost:PORT/callback, 127.0.0.1)
//       ChatGPT/Codex 문서(developers.openai.com/plugins/build/auth "Redirect URL"): https://chatgpt.com/connector_platform_oauth_redirect 또는
//        https://chatgpt.com/connector/oauth/{callback_id}, Codex 는 http://127.0.0.1:PORT/callback[/id]
//       Gemini CLI: http://localhost:PORT/oauth/callback (기본 7777, 무작위 포트도 쓴다)
const EXACT_HTTPS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
  // 아래 한 줄은 OpenAI 개발자 문서의 옛 안내(Apps SDK, 2025)에 있던 값이다. 이번 조사에서 다시 확인하지 못했다.
  'https://platform.openai.com/apps-manage/oauth',
])
const CHATGPT_CB = /^\/connector\/oauth\/[A-Za-z0-9_-]{4,128}$/
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const extraAllowed = () => new Set(String(process.env.MCP_REDIRECT_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean))

export function parseRedirect(raw) {
  const s = String(raw || '')
  if (!s || s.length > 500 || /[\u0000-\u001f\u007f\s]/.test(s) || s.includes('#')) return null
  let u
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.username || u.password) return null
  return u
}
export const isLoopbackUrl = (u) => u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)

/** 등록·인가 요청에 올 수 있는 주소인가(허용 목록) */
export function redirectAllowed(raw) {
  const u = parseRedirect(raw)
  if (!u) return false
  if (extraAllowed().has(String(raw))) return true
  if (isLoopbackUrl(u)) return true // RFC 8252: 로컬 앱은 포트를 그때그때 고른다
  if (u.protocol !== 'https:' || u.port) return false
  if (EXACT_HTTPS.has(`${u.origin}${u.pathname}`) && !u.search) return true
  return u.origin === 'https://chatgpt.com' && CHATGPT_CB.test(u.pathname) && !u.search
}

/** 요청한 주소가 등록된 주소 중 하나와 같은가. 루프백은 포트만 무시하고 나머지(경로·쿼리)는 글자 그대로 같아야 한다 */
export function redirectMatches(registered, requested) {
  const req = parseRedirect(requested)
  if (!req) return false
  for (const r of registered || []) {
    if (r === requested) return true
    const reg = parseRedirect(r)
    if (reg && isLoopbackUrl(reg) && isLoopbackUrl(req) && reg.hostname === req.hostname && reg.pathname === req.pathname && reg.search === req.search) return true
  }
  return false
}

// ── 클라이언트 ──────────────────────────────────────────────
const cleanName = (v, fallback = '이름 없는 앱') => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback
export class OAuthError extends Error {
  constructor(code, description, status = 400) {
    super(description || code)
    this.code = code
    this.description = description || code
    this.status = status
  }
}

/** RFC 7591 동적 등록. 허용 목록에 없는 리디렉션 주소가 하나라도 있으면 거절한다 */
export async function registerClient(body) {
  const b = body && typeof body === 'object' ? body : {}
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : []
  if (!uris.length || uris.length > 10) throw new OAuthError('invalid_redirect_uri', 'redirect_uris 는 1~10개여야 합니다')
  for (const r of uris) if (typeof r !== 'string' || !redirectAllowed(r)) throw new OAuthError('invalid_redirect_uri', `허용되지 않는 리디렉션 주소입니다: ${String(r).slice(0, 120)}`)
  const methodWanted = b.token_endpoint_auth_method
  if (methodWanted && methodWanted !== 'none') {
    // 비밀번호 방식은 지원하지 않는다. 공개 클라이언트(none)로 등록하고 응답에 그대로 적는다(RFC 7591 3.2.1: 서버가 값을 바꿀 수 있다)
  }
  const clientId = `dah_c_${rand(18)}`
  const name = cleanName(b.client_name)
  const uri = typeof b.client_uri === 'string' && /^https:\/\//.test(b.client_uri) ? b.client_uri.slice(0, 300) : null
  await query('INSERT INTO mcp_clients (client_id, kind, client_name, client_uri, redirect_uris) VALUES ($1, $2, $3, $4, $5::jsonb)', [clientId, 'dcr', name, uri, JSON.stringify(uris)])
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPES.join(' '),
  }
}

// Client ID Metadata Document: client_id 가 https 주소. 서버가 그 주소를 SSRF 방어 도구로 가져와 검사한다.
let cimdFetcher = async (url) => {
  const r = await safeFetch(url, { accept: 'application/json' })
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
  return JSON.parse(r.body.toString('utf8'))
}
export const __setCimdFetcher = (fn) => { cimdFetcher = fn } // 시험용
const cimdCache = new Map()
function validCimdUrl(id) {
  let u
  try {
    u = new URL(id)
  } catch {
    return false
  }
  return u.protocol === 'https:' && u.pathname.length > 1 && !u.hash && !u.username && !u.password && id.length <= 400
}

export async function loadClient(clientId) {
  const id = String(clientId || '')
  if (!id) return null
  if (/^https:\/\//i.test(id)) {
    if (!validCimdUrl(id)) return null
    const hit = cimdCache.get(id)
    if (hit && hit.exp > Date.now()) return hit.client
    let doc
    try {
      doc = await cimdFetcher(id)
    } catch {
      return null
    }
    if (!doc || doc.client_id !== id) return null // 문서 안의 client_id 는 가져온 주소와 정확히 같아야 한다
    const uris = (Array.isArray(doc.redirect_uris) ? doc.redirect_uris : []).filter((r) => typeof r === 'string' && redirectAllowed(r)).slice(0, 10)
    if (!uris.length) return null
    const client = { client_id: id, kind: 'cimd', client_name: cleanName(doc.client_name, new URL(id).hostname), client_uri: typeof doc.client_uri === 'string' && /^https:\/\//.test(doc.client_uri) ? doc.client_uri.slice(0, 300) : null, redirect_uris: uris }
    cimdCache.set(id, { client, exp: Date.now() + 3600_000 })
    await query(
      `INSERT INTO mcp_clients (client_id, kind, client_name, client_uri, redirect_uris) VALUES ($1, 'cimd', $2, $3, $4::jsonb)
       ON CONFLICT (client_id) DO UPDATE SET client_name = EXCLUDED.client_name, client_uri = EXCLUDED.client_uri, redirect_uris = EXCLUDED.redirect_uris`,
      [id, client.client_name, client.client_uri, JSON.stringify(uris)]
    ).catch(() => {})
    return client
  }
  const { rows } = await query('SELECT client_id, kind, client_name, client_uri, redirect_uris FROM mcp_clients WHERE client_id = $1', [id])
  return rows[0] || null
}

// ── 범위 ────────────────────────────────────────────────────
/** 요청한 scope 문자열을 우리 범위로 걸러 낸다. 비어 있으면 둘 다. offline_access 는 항상 리프레시 토큰을 주므로 무시한다 */
export function normalizeScope(raw) {
  const asked = String(raw || '').split(/\s+/).filter(Boolean)
  const known = asked.filter((s) => SCOPES.includes(s))
  if (asked.length && !known.length && !asked.every((s) => s === 'offline_access')) return null
  const set = new Set(known.length ? known : SCOPES)
  set.add('dah.read') // 읽기 없이 쓰기만 주는 일은 없다
  return SCOPES.filter((s) => set.has(s)).join(' ')
}
export const scopeList = (s) => String(s || '').split(/\s+/).filter(Boolean)

// ── 인가 요청 검증 ───────────────────────────────────────────
/**
 * 인가 요청(GET)을 검사한다. redirect_uri 나 client_id 가 믿을 수 없을 때는 리디렉션하지 않고 화면에 오류를 보여야 하므로 fatal 로 알린다.
 * 그 밖의 오류는 redirect_uri 로 error 를 돌려보낸다.
 */
export async function checkAuthorizeRequest(req, q) {
  const client = await loadClient(q.client_id)
  if (!client) return { fatal: '알 수 없는 앱입니다. 앱 쪽에서 연결을 다시 시작해 주세요.' }
  const redirect = String(q.redirect_uri || '')
  if (!redirect) {
    if (client.redirect_uris.length === 1) q = { ...q, redirect_uri: client.redirect_uris[0] }
    else return { fatal: '돌아갈 주소(redirect_uri)가 없습니다.' }
  }
  if (!redirectMatches(client.redirect_uris, q.redirect_uri)) return { fatal: '등록되지 않은 돌아갈 주소입니다. 앱 쪽에서 연결을 다시 시작해 주세요.' }
  const fail = (error, description) => ({ client, redirect_uri: q.redirect_uri, state: q.state, error, description })
  if (q.response_type !== 'code') return fail('unsupported_response_type', 'response_type=code 만 지원합니다')
  if (!q.code_challenge) return fail('invalid_request', 'PKCE(code_challenge)가 필요합니다')
  if (q.code_challenge_method !== 'S256') return fail('invalid_request', 'code_challenge_method=S256 만 지원합니다')
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(q.code_challenge))) return fail('invalid_request', 'code_challenge 형식이 올바르지 않습니다')
  if (q.resource !== undefined && !resourceOk(req, q.resource)) return fail('invalid_target', 'resource 는 이 서버의 /mcp 주소여야 합니다')
  const scope = normalizeScope(q.scope)
  if (!scope) return fail('invalid_scope', `지원하는 범위: ${SCOPES.join(', ')}`)
  if (q.state !== undefined && String(q.state).length > 1024) return fail('invalid_request', 'state 가 너무 깁니다')
  return {
    client,
    params: {
      client_id: client.client_id,
      redirect_uri: q.redirect_uri,
      state: q.state === undefined ? undefined : String(q.state),
      code_challenge: String(q.code_challenge),
      scope,
      resource: urlsFor(publicBase(req)).resource,
    },
  }
}

/** 리디렉션 주소에 매개변수를 붙인다(iss 는 RFC 9207: 모든 응답에 넣는다) */
export function redirectWith(req, base, params) {
  const u = new URL(base)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
  u.searchParams.set('iss', urlsFor(publicBase(req)).issuer)
  return u.toString()
}

// ── 코드·토큰 ────────────────────────────────────────────────
export async function issueCode(params, actor) {
  const code = rand(32)
  await query(
    `INSERT INTO mcp_codes (code_hash, client_id, user_kind, user_id, user_email, user_name, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + ($11 || ' seconds')::interval)`,
    [sha256(code), params.client_id, actor.kind, actor.id ?? null, actor.email, actor.name || null, params.redirect_uri, params.code_challenge, params.scope, params.resource, String(CODE_TTL_SEC)]
  )
  return code
}

async function mintTokens(sessionId) {
  const access = `dah_at_${rand(32)}`
  const refresh = `dah_rt_${rand(32)}`
  await query("INSERT INTO mcp_access_tokens (token_hash, session_id, expires_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)", [sha256(access), sessionId, String(ACCESS_TTL_SEC)])
  await query("INSERT INTO mcp_refresh_tokens (token_hash, session_id, expires_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)", [sha256(refresh), sessionId, String(REFRESH_TTL_SEC)])
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, refresh_token: refresh }
}

export async function revokeSession(sessionId, why) {
  await query('UPDATE mcp_sessions SET revoked_at = now(), revoked_why = $2 WHERE id = $1 AND revoked_at IS NULL', [sessionId, why || 'revoked'])
  await query('DELETE FROM mcp_access_tokens WHERE session_id = $1', [sessionId])
  await query('DELETE FROM mcp_refresh_tokens WHERE session_id = $1', [sessionId])
}

const tokenError = (code, description, status = 400) => new OAuthError(code, description, status)

/** POST /token 의 두 가지 grant 를 처리한다. 실패는 OAuthError(RFC 6749 오류 코드)로 던진다 */
export async function handleTokenRequest(req, form) {
  const grant = form.grant_type
  const clientId = String(form.client_id || '')
  if (form.resource !== undefined && !resourceOk(req, form.resource)) throw tokenError('invalid_target', 'resource 는 이 서버의 /mcp 주소여야 합니다')
  if (grant === 'authorization_code') {
    if (!clientId || !form.code || !form.redirect_uri || !form.code_verifier) throw tokenError('invalid_request', 'client_id, code, redirect_uri, code_verifier 가 필요합니다')
    const verifier = String(form.code_verifier)
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) throw tokenError('invalid_grant', 'code_verifier 형식이 올바르지 않습니다')
    const hash = sha256(form.code)
    // 한 번만: 아직 안 쓴 행만 원자적으로 "사용됨"으로 바꾼다
    const claimed = await query('UPDATE mcp_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING *', [hash])
    const row = claimed.rows[0]
    if (!row) {
      // 이미 쓴 코드가 다시 왔다면(가로채기 의심) 그 코드로 만든 연결을 폐기한다
      const prior = (await query('SELECT session_id, used_at FROM mcp_codes WHERE code_hash = $1', [hash])).rows[0]
      if (prior?.used_at && prior.session_id) await revokeSession(prior.session_id, 'code_reuse')
      throw tokenError('invalid_grant', '인가 코드가 만료되었거나 이미 사용되었습니다')
    }
    if (row.client_id !== clientId) throw tokenError('invalid_grant', '이 코드는 다른 앱에 발급되었습니다')
    if (row.redirect_uri !== String(form.redirect_uri)) throw tokenError('invalid_grant', 'redirect_uri 가 인가 요청 때와 다릅니다')
    const expect = crypto.createHash('sha256').update(verifier).digest('base64url')
    if (!safeEq(expect, row.code_challenge)) throw tokenError('invalid_grant', 'PKCE 검증에 실패했습니다')
    const sid = `s_${rand(16)}`
    await query(
      'INSERT INTO mcp_sessions (id, client_id, user_kind, user_id, user_email, user_name, scope, resource) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [sid, row.client_id, row.user_kind, row.user_id, row.user_email, row.user_name, row.scope, row.resource]
    )
    await query('UPDATE mcp_codes SET session_id = $2 WHERE code_hash = $1', [hash, sid])
    await query('UPDATE mcp_clients SET last_used_at = now() WHERE client_id = $1', [row.client_id]).catch(() => {})
    const tokens = await mintTokens(sid)
    return { ...tokens, scope: row.scope }
  }
  if (grant === 'refresh_token') {
    if (!form.refresh_token) throw tokenError('invalid_request', 'refresh_token 이 필요합니다')
    const hash = sha256(form.refresh_token)
    const claimed = await query('UPDATE mcp_refresh_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING session_id', [hash])
    if (!claimed.rows[0]) {
      const prior = (await query('SELECT session_id, used_at FROM mcp_refresh_tokens WHERE token_hash = $1', [hash])).rows[0]
      // 이미 회전된 토큰이 다시 왔다: 도난 가능성이 있으니 연결 전체를 폐기한다
      if (prior?.used_at) await revokeSession(prior.session_id, 'refresh_reuse')
      throw tokenError('invalid_grant', '리프레시 토큰이 만료되었거나 이미 사용되었습니다')
    }
    const s = (await query('SELECT * FROM mcp_sessions WHERE id = $1', [claimed.rows[0].session_id])).rows[0]
    if (!s || s.revoked_at) throw tokenError('invalid_grant', '연결이 해제되었습니다')
    if (clientId && s.client_id !== clientId) {
      await revokeSession(s.id, 'client_mismatch')
      throw tokenError('invalid_grant', '이 토큰은 다른 앱에 발급되었습니다')
    }
    if (Date.now() - new Date(s.created_at).getTime() > SESSION_MAX_SEC * 1000) {
      await revokeSession(s.id, 'expired')
      throw tokenError('invalid_grant', '연결 기간이 끝났습니다. 다시 연결해 주세요')
    }
    let scope = s.scope
    if (form.scope) {
      const want = scopeList(form.scope)
      if (want.some((x) => x !== 'offline_access' && !scopeList(s.scope).includes(x))) throw tokenError('invalid_scope', '처음 허용한 범위보다 넓게 요청할 수 없습니다')
      const kept = want.filter((x) => scopeList(s.scope).includes(x))
      if (kept.length) scope = kept.join(' ')
    }
    if (scope !== s.scope) await query('UPDATE mcp_sessions SET scope = $2 WHERE id = $1', [s.id, scope])
    await query("DELETE FROM mcp_access_tokens WHERE session_id = $1 AND expires_at < now() - interval '1 day'", [s.id])
    const tokens = await mintTokens(s.id)
    return { ...tokens, scope }
  }
  throw tokenError('unsupported_grant_type', 'authorization_code 와 refresh_token 만 지원합니다')
}

/** RFC 7009: 모르는 토큰이어도 200. 아는 토큰이면(액세스든 리프레시든) 연결 전체를 폐기한다 */
export async function revokeByToken(token, clientId) {
  const hash = sha256(token)
  let sid = (await query('SELECT session_id FROM mcp_refresh_tokens WHERE token_hash = $1', [hash])).rows[0]?.session_id
  if (!sid) sid = (await query('SELECT session_id FROM mcp_access_tokens WHERE token_hash = $1', [hash])).rows[0]?.session_id
  if (!sid) return false
  const s = (await query('SELECT client_id FROM mcp_sessions WHERE id = $1', [sid])).rows[0]
  if (clientId && s && s.client_id !== clientId) return false
  await revokeSession(sid, 'token_revoked')
  return true
}

// ── 액세스 토큰 확인 (보호 자원 쪽) ──────────────────────────────
/**
 * Authorization: Bearer 헤더를 확인한다. 성공하면 { session, scopes } , 아니면 null.
 * 토큰은 해시로만 찾고, 연결이 폐기되었거나 audience(resource)가 다르면 거절한다.
 */
export async function authenticateBearer(req) {
  const h = req.get('authorization') || ''
  const m = /^Bearer\s+([A-Za-z0-9_\-.~+/]+=*)$/i.exec(h)
  if (!m) return null
  const { rows } = await query(
    `SELECT s.id, s.client_id, s.user_kind, s.user_id, s.user_email, s.user_name, s.scope, s.resource, s.last_used_at, c.client_name
       FROM mcp_access_tokens t JOIN mcp_sessions s ON s.id = t.session_id LEFT JOIN mcp_clients c ON c.client_id = s.client_id
      WHERE t.token_hash = $1 AND t.expires_at > now() AND s.revoked_at IS NULL`,
    [sha256(m[1])]
  )
  const s = rows[0]
  if (!s) return null
  if (!resourceOk(req, s.resource) || s.resource !== urlsFor(publicBase(req)).resource) return null // 다른 서버용으로 발급된 토큰은 받지 않는다
  if (!s.last_used_at || Date.now() - new Date(s.last_used_at).getTime() > 60_000) {
    await query('UPDATE mcp_sessions SET last_used_at = now() WHERE id = $1', [s.id]).catch(() => {})
  }
  return { session: s, scopes: scopeList(s.scope) }
}

/** 토큰당 분당 호출 한도. 한도를 넘으면 false */
export const RATE_PER_MIN = Number(process.env.MCP_RATE_PER_MIN) || 120
export async function takeRateSlot(sessionId, limit = RATE_PER_MIN) {
  const minute = Math.floor(Date.now() / 60000)
  const { rows } = await query(
    'INSERT INTO mcp_rate (session_id, minute, n) VALUES ($1, $2, 1) ON CONFLICT (session_id, minute) DO UPDATE SET n = mcp_rate.n + 1 RETURNING n',
    [sessionId, minute]
  )
  if (Math.random() < 0.02) query('DELETE FROM mcp_rate WHERE minute < $1', [minute - 5]).catch(() => {})
  return rows[0].n <= limit
}

/** 오래된 행 정리(토큰 요청 때 가끔 돌린다: 서버리스라 상시 작업이 없다). 재사용 감지를 위해 쓴 리프레시 토큰은 세션 최대 기간(90일) 동안 남긴다 */
export async function maintenance() {
  const steps = [
    "DELETE FROM mcp_codes WHERE expires_at < now() - interval '1 day'",
    "DELETE FROM mcp_access_tokens WHERE expires_at < now() - interval '1 day'",
    "DELETE FROM mcp_refresh_tokens WHERE expires_at < now() - interval '1 day' AND (used_at IS NULL OR used_at < now() - interval '90 days')",
    "DELETE FROM mcp_jobs WHERE created_at < now() - interval '1 day'",
    "DELETE FROM mcp_audit WHERE at < now() - interval '180 days'",
    "DELETE FROM mcp_sessions WHERE revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days'",
    "DELETE FROM mcp_clients WHERE kind = 'dcr' AND created_at < now() - interval '7 days' AND client_id NOT IN (SELECT client_id FROM mcp_sessions) AND client_id NOT IN (SELECT client_id FROM mcp_grants)",
  ]
  for (const sql of steps) await query(sql).catch(() => {})
}
