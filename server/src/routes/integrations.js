// 연동(Integrations) API
//   GET    /integrations/unfurl?url=            링크 미리보기(OG), 유튜브·비메오·피그마·노션 판별과 임베드 주소
//   GET    /integrations/connections            내 연동 목록(토큰은 내려주지 않는다)
//   PUT    /integrations/connections/:provider  개인 토큰 연결 (figma | notion), 서버에서 한 번 확인 뒤 봉인 저장
//   DELETE /integrations/connections/:provider  연결 끊기
//   GET    /integrations/figma/file?url=        피그마 파일 이름과 최상위 프레임 썸네일 (가져오기용, 이미지 주소는 30일 뒤 만료)
//   GET    /integrations/notion/page?url=       노션 페이지 제목과 본문 HTML (연동에 공유된 페이지만)
// 로그인한 사용자만 쓴다. 사용자가 입력한 주소를 서버가 가져오는 unfurl은 SSRF를 막기 위해
// http(s) 기본 포트만, DNS로 풀린 모든 IP가 공인 주소일 때만, 연결 시점에 같은 검사를 다시 하며, 리디렉션은 3번까지 매번 재검사한다.
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { optionalAuth } from '../middleware/auth.js'
import { identityOf } from '../lib/wsAccess.js'
import { SecretKeyMissingError, isSecretBoxConfigured, open, seal } from '../lib/secretBox.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
router.use('/integrations', optionalAuth)

const NOTION_VERSION = '2026-03-11' // https://developers.notion.com/reference/versioning (확인일 기준 최신)
const EMBED_HOST = 'dah-workspace'
const PROVIDERS = ['figma', 'notion']

const signedIn = wrap(async (req, res, next) => {
  const idn = await identityOf(req, res)
  if (!idn.emails.length) return res.status(401).json({ error: 'login required', hint: '구글 계정으로 로그인하세요.' })
  next()
})
const limiter = (limit) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req._wsIdentity?.emails?.[0] || 'anon',
    handler: (req, res) => res.status(429).json({ error: '요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요.' }),
  })

// ── SSRF 방어: lib/safeFetch.js 로 옮겼다(AI 연결도 같은 검사를 쓴다). 기존 import 경로를 지키려고 다시 내보낸다.
import { UnsafeUrlError, assertPublicUrl, isBlockedIp, safeFetch, MAX_BYTES, UA } from '../lib/safeFetch.js'
export { assertPublicUrl, isBlockedIp, safeFetch }

// ── HTML 메타 읽기 ──────────────────────────────────────────
function decodeEntities(v) {
  return String(v)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}
const clean = (v, n) => decodeEntities(String(v ?? '')).replace(/\s+/g, ' ').trim().slice(0, n)

function attrsOf(src) {
  const out = {}
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

function decodeBody(buf, contentType) {
  const head = buf.subarray(0, 4096).toString('latin1')
  const label = (/charset=["']?([\w-]+)/i.exec(contentType || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1] || 'utf-8'
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

export function parseMeta(html) {
  const meta = {}
  const src = html.length > MAX_BYTES ? html.slice(0, MAX_BYTES) : html
  const re = /<meta\s+([^>]*?)\/?>/gi
  let m
  while ((m = re.exec(src))) {
    const a = attrsOf(m[1])
    const key = String(a.property || a.name || '').toLowerCase()
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)
  return { meta, title: t ? t[1] : '' }
}

const absUrl = (v, base) => {
  if (!v) return null
  try {
    const u = new URL(decodeEntities(decodeEntities(v)).trim(), base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

// ── 서비스 판별 ─────────────────────────────────────────────
const hostIs = (host, ...names) => names.some((n) => host === n || host.endsWith(`.${n}`))

function youtubeId(u) {
  const h = u.hostname.toLowerCase()
  if (h === 'youtu.be') return /^[\w-]{6,20}$/.test(u.pathname.split('/')[1] || '') ? u.pathname.split('/')[1] : null
  if (!hostIs(h, 'youtube.com', 'youtube-nocookie.com')) return null
  if (u.pathname === '/watch') return /^[\w-]{6,20}$/.test(u.searchParams.get('v') || '') ? u.searchParams.get('v') : null
  const m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,20})/.exec(u.pathname)
  return m ? m[1] : null
}
function youtubeStart(u) {
  const t = u.searchParams.get('t') || u.searchParams.get('start')
  if (!t) return 0
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0
}
function vimeoInfo(u) {
  const h = u.hostname.toLowerCase()
  if (!hostIs(h, 'vimeo.com')) return null
  const m = h.startsWith('player.') ? /^\/video\/(\d+)/.exec(u.pathname) : /^\/(?:[\w-]+\/)*(\d{5,})(?:\/([0-9a-f]{6,}))?/.exec(u.pathname)
  if (!m) return null
  return { id: m[1], hash: m[2] || u.searchParams.get('h') || '' }
}
function figmaInfo(u) {
  if (!hostIs(u.hostname.toLowerCase(), 'figma.com')) return null
  const seg = u.pathname.split('/').filter(Boolean)
  const type = seg[0]
  // 커뮤니티 파일은 임베드할 수 없지만 피그마 링크로는 표시한다
  if (type === 'community' && /^[0-9]{6,30}$/.test(seg[2] || '')) return { type: 'community', key: seg[2], slug: seg[3] ? safeDecode(seg[3]).replace(/[-_+]+/g, ' ').trim() : '', node: null }
  if (!['design', 'file', 'board', 'slides', 'deck', 'proto', 'make'].includes(type) || !/^[0-9a-zA-Z]{10,128}$/.test(seg[1] || '')) return null
  return { type, key: seg[1], slug: seg[2] ? safeDecode(seg[2]).replace(/[-_+]+/g, ' ').trim() : '', node: u.searchParams.get('node-id') }
}
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
function isNotion(u) {
  return hostIs(u.hostname.toLowerCase(), 'notion.so', 'notion.site', 'notion.com')
}

/** 피그마 임베드 주소. 확인한 공식 문서(Embed Kit 2.0)는 embed.figma.com/<종류>/<키>?embed-host=... 형식이다.
 *  프로토타입은 2.0에서 임베드 API용 OAuth 클라이언트 ID를 요구하므로 기존 1.0 형식(figma.com/embed)을 쓴다. */
export function figmaEmbedUrls(u, info) {
  if (info.type === 'make' || info.type === 'community') return {}
  const legacy = `https://www.figma.com/embed?embed_host=${EMBED_HOST}&url=${encodeURIComponent(`https://www.figma.com/${info.type}/${info.key}${u.search}`)}`
  if (info.type === 'proto') return { embedUrl: legacy, embedUrlLegacy: legacy }
  const t = info.type === 'file' ? 'design' : info.type
  const q = new URLSearchParams({ 'embed-host': EMBED_HOST })
  for (const k of ['node-id', 'page-id', 'starting-point-node-id', 'scaling', 'content-scaling']) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k))
  return { embedUrl: `https://embed.figma.com/${t}/${info.key}?${q}`, embedUrlLegacy: legacy }
}

// ── 캐시 (10분) ─────────────────────────────────────────────
const CACHE_MS = 10 * 60 * 1000
const cache = new Map()
const cacheGet = (k) => {
  const e = cache.get(k)
  if (!e) return null
  if (Date.now() - e.at > CACHE_MS) {
    cache.delete(k)
    return null
  }
  return e.value
}
const cacheSet = (k, value) => {
  if (cache.size >= 500) cache.delete(cache.keys().next().value)
  cache.set(k, { at: Date.now(), value })
}

// ── 연결(토큰) ──────────────────────────────────────────────
async function tokenOf(idn, provider) {
  const { rows } = await query('SELECT token_enc FROM ws_connections WHERE lower(email) = ANY($1::text[]) AND provider = $2 ORDER BY id LIMIT 1', [idn.emails, provider])
  return rows[0] ? open(rows[0].token_enc) : null
}

// 테스트에서만 가짜 API로 바꾼다(운영에서는 환경변수를 설정하지 않는다)
const FIGMA_API = process.env.FIGMA_API_BASE || 'https://api.figma.com'
const NOTION_API = process.env.NOTION_API_BASE || 'https://api.notion.com'

class ApiError extends Error {
  constructor(status, message, hint, code) {
    super(message)
    this.status = status
    this.hint = hint
    this.code = code
  }
}

async function extJson(url, headers) {
  let r
  try {
    r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  } catch {
    throw new ApiError(502, '연결하지 못했습니다', '잠시 뒤 다시 시도하세요.')
  }
  let body = null
  try {
    body = await r.json()
  } catch {
    /* JSON이 아닌 응답 */
  }
  return { status: r.status, ok: r.ok, body, retryAfter: Number(r.headers.get('retry-after')) || 0 }
}

const figmaHeaders = (token) => ({ 'X-Figma-Token': token, Accept: 'application/json' })
const notionHeaders = (token) => ({ Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, Accept: 'application/json' })

const NOT_CONNECTED = {
  figma: new ApiError(400, '피그마가 연결되어 있지 않습니다', '연동 페이지에서 피그마 개인 액세스 토큰을 연결하세요.', 'not_connected'),
  notion: new ApiError(400, '노션이 연결되어 있지 않습니다', '연동 페이지에서 노션 내부 연동 토큰을 연결하세요.', 'not_connected'),
}

function figmaFail(r) {
  if (r.status === 401 || r.status === 403) return new ApiError(401, '피그마 토큰이 올바르지 않거나 만료되었습니다', '연동 페이지에서 토큰을 다시 연결하세요. 파일 읽기(file_content:read) 권한이 필요합니다.', 'bad_token')
  if (r.status === 404) return new ApiError(404, '피그마 파일을 찾을 수 없습니다', '내 계정이 볼 수 있는 파일의 주소인지 확인하세요.')
  if (r.status === 429) return new ApiError(429, '피그마 요청 한도를 넘었습니다', `${r.retryAfter ? `${r.retryAfter}초` : '잠시'} 뒤 다시 시도하세요.`)
  return new ApiError(502, '피그마에서 응답을 받지 못했습니다', '잠시 뒤 다시 시도하세요.')
}
function notionFail(r) {
  if (r.status === 401) return new ApiError(401, '노션 토큰이 올바르지 않습니다', '연동 페이지에서 토큰을 다시 연결하세요.', 'bad_token')
  if (r.status === 403) return new ApiError(403, '노션 연동에 콘텐츠 읽기 권한이 없습니다', '노션 연동 설정의 기능에서 “콘텐츠 읽기”를 켜세요.')
  if (r.status === 404) return new ApiError(404, '노션 페이지를 찾을 수 없거나 연동에 공유되지 않았습니다', '페이지 오른쪽 위 ⋯ 메뉴의 “연결”에서 이 연동을 추가한 뒤 다시 시도하세요.', 'not_shared')
  if (r.status === 400) return new ApiError(400, '이 주소는 페이지가 아닙니다', '데이터베이스가 아닌 페이지의 주소를 입력하세요.')
  if (r.status === 429) return new ApiError(429, '노션 요청 한도를 넘었습니다', `${r.retryAfter ? `${r.retryAfter}초` : '잠시'} 뒤 다시 시도하세요.`)
  return new ApiError(502, '노션에서 응답을 받지 못했습니다', '잠시 뒤 다시 시도하세요.')
}

router.get(
  '/integrations/connections',
  signedIn,
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const { rows } = await query('SELECT provider, meta, created_at FROM ws_connections WHERE lower(email) = ANY($1::text[])', [idn.emails])
    const by = Object.fromEntries(rows.map((r) => [r.provider, r]))
    res.json({
      items: PROVIDERS.map((p) => ({ provider: p, connected: Boolean(by[p]), meta: by[p]?.meta || null, connected_at: by[p]?.created_at || null })),
      secure_storage: isSecretBoxConfigured(),
    })
  })
)

router.put(
  '/integrations/connections/:provider',
  signedIn,
  limiter(10),
  wrap(async (req, res) => {
    const provider = req.params.provider
    if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'not found' })
    const token = String(req.body?.token || '').trim()
    if (token.length < 10 || token.length > 500 || !/^[\w\-.~+/=]+$/.test(token)) return res.status(400).json({ error: '토큰 형식이 올바르지 않습니다', hint: '발급받은 토큰을 공백 없이 그대로 붙여 넣으세요.' })
    if (!isSecretBoxConfigured()) {
      const e = new SecretKeyMissingError()
      return res.status(503).json({ error: '서버에 토큰을 안전하게 보관할 설정이 없어 연결할 수 없습니다', hint: e.hint })
    }
    // 토큰이 실제로 동작하는지 한 번 확인한다
    let meta = {}
    if (provider === 'figma') {
      const r = await extJson(`${FIGMA_API}/v1/me`, figmaHeaders(token))
      if (r.ok) meta = { name: clean(r.body?.handle || r.body?.email, 80), email: clean(r.body?.email, 120) }
      else if ((r.status === 403 || r.status === 401) && /scope/i.test(String(r.body?.err || r.body?.message || ''))) meta = { name: '', note: '사용자 정보 읽기 권한 없이 연결됨' }
      else return res.status(400).json({ error: '피그마 토큰이 올바르지 않습니다', hint: '피그마 설정의 보안 탭에서 개인 액세스 토큰을 새로 만들고 파일 읽기(file_content:read) 권한을 켠 뒤 다시 붙여 넣으세요.' })
    } else {
      const r = await extJson(`${NOTION_API}/v1/users/me`, notionHeaders(token))
      if (!r.ok) return res.status(400).json({ error: '노션 토큰이 올바르지 않습니다', hint: '노션 내부 연동(Internal integration)의 토큰을 붙여 넣으세요.' })
      meta = { name: clean(r.body?.name, 80), workspace: clean(r.body?.bot?.workspace_name, 80) }
    }
    const idn = await identityOf(req, res)
    await query(
      `INSERT INTO ws_connections (email, provider, token_enc, meta) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (lower(email), provider) DO UPDATE SET token_enc = EXCLUDED.token_enc, meta = EXCLUDED.meta, created_at = now()`,
      [idn.emails[0], provider, seal(token), JSON.stringify(meta)]
    )
    cache.clear()
    res.json({ provider, connected: true, meta })
  })
)

router.delete(
  '/integrations/connections/:provider',
  signedIn,
  wrap(async (req, res) => {
    const provider = req.params.provider
    if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'not found' })
    const idn = await identityOf(req, res)
    await query('DELETE FROM ws_connections WHERE lower(email) = ANY($1::text[]) AND provider = $2', [idn.emails, provider])
    cache.clear()
    res.json({ provider, connected: false })
  })
)

// ── 링크 미리보기 ───────────────────────────────────────────
async function oembed(endpoint, url) {
  try {
    const r = await extJson(`${endpoint}${encodeURIComponent(url)}`, { Accept: 'application/json', 'User-Agent': UA })
    return r.ok ? r.body : null
  } catch {
    return null
  }
}

async function unfurl(idn, input) {
  const u = assertPublicUrl(input)
  const out = { url: u.href, title: '', description: '', image: null, siteName: '', kind: 'link' }
  const yt = youtubeId(u)
  const vm = yt ? null : vimeoInfo(u)
  const fg = yt || vm ? null : figmaInfo(u)
  let skipFetch = false

  if (yt) {
    out.kind = 'youtube'
    out.siteName = 'YouTube'
    const start = youtubeStart(u)
    out.embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}${start ? `?start=${start}` : ''}`
    out.image = `https://i.ytimg.com/vi/${encodeURIComponent(yt)}/hqdefault.jpg`
    const o = await oembed('https://www.youtube.com/oembed?format=json&url=', `https://www.youtube.com/watch?v=${yt}`)
    if (o) {
      out.title = clean(o.title, 200)
      out.description = clean(o.author_name ? `${o.author_name}` : '', 400)
      if (o.thumbnail_url) out.image = absUrl(o.thumbnail_url, u) || out.image
      skipFetch = true
    }
  } else if (vm) {
    out.kind = 'vimeo'
    out.siteName = 'Vimeo'
    out.embedUrl = `https://player.vimeo.com/video/${vm.id}${vm.hash ? `?h=${encodeURIComponent(vm.hash)}` : ''}`
    const o = await oembed('https://vimeo.com/api/oembed.json?url=', `https://vimeo.com/${vm.id}${vm.hash ? `/${vm.hash}` : ''}`)
    if (o) {
      out.title = clean(o.title, 200)
      out.description = clean(o.description || (o.author_name ? o.author_name : ''), 400)
      out.image = absUrl(o.thumbnail_url, u)
      skipFetch = true
    }
  } else if (fg) {
    out.kind = 'figma'
    out.siteName = 'Figma'
    Object.assign(out, figmaEmbedUrls(u, fg))
    out.title = fg.slug ? clean(fg.slug, 200) : ''
    // 연결한 토큰이 있으면 파일 이름과 썸네일을 가져온다(내 계정이 볼 수 있는 파일만)
    const token = fg.type === 'make' || fg.type === 'community' ? null : await tokenOf(idn, 'figma').catch(() => null)
    if (token) {
      const r = await extJson(`${FIGMA_API}/v1/files/${fg.key}/meta`, figmaHeaders(token)).catch(() => null)
      const f = r?.ok ? r.body?.file : null
      if (f) {
        out.title = clean(f.name, 200) || out.title
        out.image = absUrl(f.thumbnail_url, u) || out.image
        out.private = true // 내 토큰으로 읽은 정보라 캐시를 사용자별로 나눈다
        skipFetch = true
      }
    }
  } else if (isNotion(u)) {
    out.kind = 'notion'
    out.siteName = 'Notion'
  }

  if (!skipFetch) {
    try {
      const r = await safeFetch(u.href)
      out.url = r.url.href
      const type = String(r.headers['content-type'] || '').toLowerCase()
      if (type.startsWith('image/')) {
        out.image = r.url.href
        out.title = out.title || decodeURIComponent(r.url.pathname.split('/').pop() || '').slice(0, 200)
      } else if (/html|xml/.test(type) && r.status < 400) {
        const { meta, title } = parseMeta(decodeBody(r.body, type))
        out.title = clean(meta['og:title'] || meta['twitter:title'] || title, 200) || out.title
        out.description = clean(meta['og:description'] || meta['twitter:description'] || meta.description, 400) || out.description
        out.image = absUrl(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'], r.url) || out.image
        out.siteName = clean(meta['og:site_name'], 80) || out.siteName
      } else if (r.status >= 400) {
        out.fetched = false
      }
    } catch (err) {
      if (err instanceof UnsafeUrlError || err.code === 'UNSAFE_URL') throw err
      out.fetched = false // 가져오지 못해도 주소로 알 수 있는 정보(종류, 임베드)는 돌려준다
    }
  }
  if (!out.siteName) out.siteName = new URL(out.url).hostname.replace(/^www\./, '')
  if (!out.title) out.title = out.siteName
  return out
}

router.get(
  '/integrations/unfurl',
  signedIn,
  limiter(30),
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const raw = String(req.query.url || '').trim()
    if (!raw) return res.status(400).json({ error: 'url required', hint: '주소를 입력하세요.' })
    const u = assertPublicUrl(raw) // 잘못된 주소는 캐시를 보기 전에 막는다
    const base = u.href
    const hit = cacheGet(`u|${base}`) || cacheGet(`u|${idn.emails[0]}|${base}`)
    if (hit) return res.json(hit)
    const out = await unfurl(idn, raw)
    const { private: priv, ...pub } = out
    cacheSet(priv ? `u|${idn.emails[0]}|${base}` : `u|${base}`, pub)
    res.json(pub)
  })
)

// ── 피그마: 파일 이름과 최상위 프레임 썸네일 ─────────────────
const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'])
const MAX_FRAMES = 80

router.get(
  '/integrations/figma/file',
  signedIn,
  limiter(20),
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    let u
    try {
      u = new URL(String(req.query.url || '').trim())
    } catch {
      return res.status(400).json({ error: '올바른 피그마 주소가 아닙니다' })
    }
    const info = figmaInfo(u)
    if (!info || info.type === 'make' || info.type === 'community') return res.status(400).json({ error: '올바른 피그마 파일 주소가 아닙니다', hint: 'figma.com/design/… 형식의 주소를 입력하세요.' })
    const token = await tokenOf(idn, 'figma')
    if (!token) throw NOT_CONNECTED.figma
    const f = await extJson(`${FIGMA_API}/v1/files/${info.key}?depth=2`, figmaHeaders(token))
    if (!f.ok) throw figmaFail(f)
    const pages = []
    const ids = []
    for (const p of f.body?.document?.children || []) {
      if (p.type !== 'CANVAS') continue
      const frames = []
      for (const c of p.children || []) {
        if (!FRAME_TYPES.has(c.type) || ids.length >= MAX_FRAMES) continue
        const bb = c.absoluteBoundingBox || {}
        frames.push({ id: c.id, name: clean(c.name, 120), width: Math.round(bb.width || 0), height: Math.round(bb.height || 0), image: null })
        ids.push(c.id)
      }
      pages.push({ id: p.id, name: clean(p.name, 120), frames })
    }
    // 썸네일: 한 번에 40개씩 PNG로 렌더링한다. 이미지 주소는 30일 뒤 만료되므로 가져오기 직후 바로 쓴다.
    const images = {}
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40)
      const r = await extJson(`${FIGMA_API}/v1/images/${info.key}?ids=${encodeURIComponent(chunk.join(','))}&format=png&scale=1`, figmaHeaders(token))
      if (!r.ok) throw figmaFail(r)
      Object.assign(images, r.body?.images || {})
    }
    for (const p of pages) for (const fr of p.frames) fr.image = absUrl(images[fr.id], FIGMA_API)
    res.json({
      key: info.key,
      name: clean(f.body?.name, 200),
      lastModified: f.body?.lastModified || null,
      selected: info.node ? info.node.replace('-', ':') : null,
      pages,
      truncated: ids.length >= MAX_FRAMES,
      imageNotice: '이미지 주소는 30일 뒤 만료됩니다. 바로 가져와 저장하세요.',
    })
  })
)

// ── 노션: 페이지 본문을 단순 HTML로 ──────────────────────────
function notionPageId(raw) {
  let u
  try {
    u = new URL(String(raw || '').trim())
  } catch {
    return null
  }
  if (!isNotion(u)) return null
  const hay = `${u.pathname} ${u.searchParams.get('p') || ''}`
  const dashed = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi.exec(hay)
  if (dashed) return dashed[0].toLowerCase()
  const all = [...hay.matchAll(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi)]
  return all.length ? all[all.length - 1][0].toLowerCase() : null
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const plainOf = (arr) => (arr || []).map((t) => t?.plain_text ?? '').join('')
function richText(arr) {
  return (arr || [])
    .map((t) => {
      let s = esc(t?.plain_text ?? t?.text?.content ?? '').replace(/\n/g, '<br>')
      if (!s) return ''
      const a = t.annotations || {}
      if (a.code) s = `<code>${s}</code>`
      if (a.bold) s = `<strong>${s}</strong>`
      if (a.italic) s = `<em>${s}</em>`
      if (a.strikethrough) s = `<s>${s}</s>`
      if (a.underline) s = `<u>${s}</u>`
      const href = t.href || t.text?.link?.url
      if (href && /^https?:\/\//i.test(href)) s = `<a href="${esc(href)}">${s}</a>`
      return s
    })
    .join('')
}
const linkP = (url, label) => (/^https?:\/\//i.test(url || '') ? `<p><a href="${esc(url)}">${esc(label || url)}</a></p>` : '')
const fileUrl = (v) => (v?.type === 'external' ? v.external?.url : v?.file?.url)

async function notionGet(token, path, ctx) {
  if (ctx.requests >= ctx.maxRequests) {
    ctx.truncated = true
    return null
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    ctx.requests++
    const r = await extJson(`${NOTION_API}${path}`, notionHeaders(token))
    if (r.status === 429 && attempt === 0 && r.retryAfter && r.retryAfter <= 3) {
      await new Promise((ok) => setTimeout(ok, r.retryAfter * 1000))
      continue
    }
    if (!r.ok) throw notionFail(r)
    return r.body
  }
  return null
}

async function childrenOf(token, blockId, ctx) {
  const list = []
  let cursor = ''
  do {
    const page = await notionGet(token, `/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`, ctx)
    if (!page) break
    list.push(...(page.results || []))
    cursor = page.has_more ? page.next_cursor : ''
    ctx.blocks += (page.results || []).length
    if (ctx.blocks >= ctx.maxBlocks) {
      ctx.truncated = true
      break
    }
  } while (cursor)
  return list
}

async function renderChildren(token, blockId, ctx, depth) {
  const blocks = await childrenOf(token, blockId, ctx)
  return renderBlocks(token, blocks, ctx, depth)
}

async function renderBlocks(token, blocks, ctx, depth) {
  let html = ''
  let open = null // 'ul' | 'ol' | 'task'
  const close = () => {
    if (open) html += open === 'ol' ? '</ol>' : '</ul>'
    open = null
  }
  const item = (kind, li) => {
    if (open !== kind) {
      close()
      html += kind === 'ol' ? '<ol>' : kind === 'task' ? '<ul data-type="taskList">' : '<ul>'
      open = kind
    }
    html += li
  }
  for (const b of blocks) {
    const v = b[b.type] || {}
    const sub = async () => (b.has_children && depth < 3 ? renderChildren(token, b.id, ctx, depth + 1) : '')
    switch (b.type) {
      case 'bulleted_list_item':
        item('ul', `<li>${richText(v.rich_text)}${await sub()}</li>`)
        continue
      case 'numbered_list_item':
        item('ol', `<li>${richText(v.rich_text)}${await sub()}</li>`)
        continue
      case 'to_do':
        item('task', `<li data-type="taskItem" data-checked="${v.checked ? 'true' : 'false'}">${richText(v.rich_text)}${await sub()}</li>`)
        continue
      default:
        close()
    }
    switch (b.type) {
      case 'paragraph':
        html += `<p>${richText(v.rich_text)}</p>${await sub()}`
        break
      case 'heading_1':
        html += `<h1>${richText(v.rich_text)}</h1>${await sub()}`
        break
      case 'heading_2':
        html += `<h2>${richText(v.rich_text)}</h2>${await sub()}`
        break
      case 'heading_3':
      case 'heading_4':
        html += `<h3>${richText(v.rich_text)}</h3>${await sub()}`
        break
      case 'quote':
        html += `<blockquote><p>${richText(v.rich_text)}</p>${await sub()}</blockquote>`
        break
      case 'callout': {
        const icon = v.icon?.type === 'emoji' ? `${esc(v.icon.emoji)} ` : ''
        html += `<blockquote><p>${icon}${richText(v.rich_text)}</p>${await sub()}</blockquote>`
        break
      }
      case 'toggle':
        html += `<p><strong>${richText(v.rich_text)}</strong></p>${await sub()}`
        break
      case 'code':
        html += `<pre><code>${esc(plainOf(v.rich_text))}</code></pre>`
        break
      case 'equation':
        html += `<pre><code>${esc(v.expression)}</code></pre>`
        break
      case 'divider':
        html += '<hr>'
        break
      case 'image': {
        const url = fileUrl(v)
        if (url) {
          if (v.type === 'file') ctx.hostedImages++
          html += `<img src="${esc(url)}" alt="${esc(plainOf(v.caption))}">`
        }
        break
      }
      case 'bookmark':
      case 'embed':
      case 'link_preview':
        html += linkP(v.url, plainOf(v.caption) || v.url)
        break
      case 'video':
      case 'file':
      case 'pdf':
      case 'audio':
        html += linkP(fileUrl(v), plainOf(v.caption) || v.name || fileUrl(v))
        break
      case 'child_page':
        html += `<p>${esc(v.title)}</p>`
        break
      case 'child_database':
        html += `<p>${esc(v.title)} (데이터베이스는 가져오지 않습니다)</p>`
        break
      case 'table': {
        const rows = await childrenOf(token, b.id, ctx)
        html += '<table><tbody>'
        rows.forEach((row, i) => {
          const cellTag = i === 0 && v.has_column_header ? 'th' : 'td'
          html += `<tr>${(row.table_row?.cells || []).map((c) => `<${cellTag}><p>${richText(c)}</p></${cellTag}>`).join('')}</tr>`
        })
        html += '</tbody></table>'
        break
      }
      case 'column_list':
      case 'column':
      case 'synced_block':
      case 'template':
        html += await sub()
        break
      default:
        break // table_of_contents, breadcrumb, link_to_page, 지원하지 않는 블록은 건너뛴다
    }
  }
  close()
  return html
}

router.get(
  '/integrations/notion/page',
  signedIn,
  limiter(10),
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const id = notionPageId(req.query.url)
    if (!id) return res.status(400).json({ error: '올바른 노션 페이지 주소가 아닙니다', hint: 'notion.so 또는 notion.site 페이지 주소를 붙여 넣으세요.' })
    const token = await tokenOf(idn, 'notion')
    if (!token) throw NOT_CONNECTED.notion
    const ctx = { requests: 0, maxRequests: 60, blocks: 0, maxBlocks: 800, truncated: false, hostedImages: 0 }
    const page = await notionGet(token, `/v1/pages/${id}`, ctx)
    const titleProp = Object.values(page?.properties || {}).find((p) => p?.type === 'title')
    const title = clean(plainOf(titleProp?.title), 200) || '제목 없음'
    const html = await renderChildren(token, id, ctx, 0)
    res.json({
      title,
      html,
      blocks: ctx.blocks,
      truncated: ctx.truncated,
      hostedImages: ctx.hostedImages,
      notice: ctx.hostedImages ? '노션에 올린 이미지는 주소가 일정 시간 뒤 만료되어 나중에 보이지 않을 수 있습니다.' : '',
    })
  })
)

// 이 라우터가 던지는 ApiError, UnsafeUrlError는 상태 코드와 한국어 안내를 그대로 돌려준다
// eslint-disable-next-line no-unused-vars
router.use('/integrations', (err, req, res, next) => {
  if (err instanceof ApiError || err instanceof UnsafeUrlError || err?.code === 'UNSAFE_URL') {
    return res.status(err.status || 400).json({ error: err.message, ...(err.hint ? { hint: err.hint } : {}), ...(err.code ? { code: err.code } : {}) })
  }
  return next(err)
})

export const _internal = { figmaInfo, youtubeId, vimeoInfo, notionPageId, renderBlocks, richText, parseMeta }

export default router
