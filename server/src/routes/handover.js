// 운영위원회 인수인계 문서 API.
// 열람: 관리자 로그인(manager 이상) 또는 열람 비밀번호 통과(dah_handover 쿠키, 7일).
// 편집·댓글·비밀값 저장: manager 이상. 열람 비밀번호 변경: owner.
// 비밀값(공식 계정 비밀번호 등)은 문서 본문에 넣지 않고 handover_secrets에 따로 두며,
// 눈 아이콘·복사 버튼을 누를 때만 이 API로 값을 받는다.
import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { optionalAuth, hasRole, jwtSecret, cookieOpts, baseCookieOpts } from '../middleware/auth.js'

const router = Router()
export const HANDOVER_COOKIE = 'dah_handover'
const GATE_TTL_SEC = 7 * 24 * 60 * 60

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'too many attempts', retryAfter: '15m' }),
})

function gateValid(req) {
  const t = req.cookies?.[HANDOVER_COOKIE]
  if (!t) return false
  try {
    const p = jwt.verify(t, jwtSecret())
    return p.type === 'handover'
  } catch {
    return false
  }
}

function accessOf(req) {
  if (req.user && hasRole(req.user, 'manager')) return 'member'
  if (gateValid(req)) return 'gate'
  return null
}

function requireAccess(req, res, next) {
  const access = accessOf(req)
  if (!access) return res.status(401).json({ error: 'handover locked' })
  req.handoverAccess = access
  next()
}

function requireMember(req, res, next) {
  if (accessOf(req) !== 'member') return res.status(403).json({ error: 'member only' })
  next()
}

async function gateHash() {
  const { rows } = await query("SELECT value FROM handover_settings WHERE key = 'gate_hash'")
  return rows[0]?.value || null
}

router.use('/handover', optionalAuth)

router.get(
  '/handover/access',
  wrap(async (req, res) => {
    const access = accessOf(req)
    res.json({ access, canEdit: access === 'member', user: req.user ? { name: req.user.name, role: req.user.role } : null })
  })
)

router.post(
  '/handover/unlock',
  unlockLimiter,
  wrap(async (req, res) => {
    const password = String(req.body?.password ?? '')
    const hash = await gateHash()
    if (!hash || !password || !(await bcrypt.compare(password, hash))) {
      return res.status(401).json({ error: '비밀번호 불일치' })
    }
    const token = jwt.sign({ type: 'handover' }, jwtSecret(), { expiresIn: GATE_TTL_SEC })
    res.cookie(HANDOVER_COOKIE, token, cookieOpts(GATE_TTL_SEC))
    res.json({ ok: true, access: accessOf(req) || 'gate' })
  })
)

router.post('/handover/lock', (req, res) => {
  res.clearCookie(HANDOVER_COOKIE, baseCookieOpts())
  res.json({ ok: true })
})

router.put(
  '/handover/gate',
  wrap(async (req, res) => {
    if (!req.user || !hasRole(req.user, 'owner')) return res.status(403).json({ error: 'owner only' })
    const password = String(req.body?.password ?? '')
    if (password.length < 8) return res.status(400).json({ error: '8자 이상' })
    const hash = await bcrypt.hash(password, 10)
    await query(
      `INSERT INTO handover_settings (key, value, updated_at) VALUES ('gate_hash', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [hash]
    )
    res.json({ ok: true })
  })
)

// 문서
router.get(
  '/handover/docs',
  requireAccess,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT d.id, d.title, d.updated_at, d.updated_by, d.sort,
              (SELECT COUNT(*)::int FROM handover_comments c WHERE c.doc_id = d.id AND NOT c.resolved) AS open_comments
         FROM handover_docs d ORDER BY d.sort, d.id`
    )
    res.json({ items: rows, access: req.handoverAccess })
  })
)

router.get(
  '/handover/docs/:id',
  requireAccess,
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    const { rows } = await query('SELECT * FROM handover_docs WHERE id = $1', [id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0], access: req.handoverAccess, canEdit: req.handoverAccess === 'member' })
  })
)

router.post(
  '/handover/docs',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    const title = String(req.body?.title || '제목 없는 문서').slice(0, 200)
    const { rows } = await query(
      `INSERT INTO handover_docs (title, content_html, sort, updated_by)
       VALUES ($1, $2, COALESCE((SELECT MAX(sort) + 1 FROM handover_docs), 0), $3) RETURNING *`,
      [title, '<p></p>', req.user.name]
    )
    res.status(201).json({ item: rows[0] })
  })
)

router.put(
  '/handover/docs/:id',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    const { title, content } = req.body || {}
    const sets = []
    const params = []
    if (typeof title === 'string') {
      params.push(title.slice(0, 200))
      sets.push(`title = $${params.length}`)
    }
    if (content && typeof content === 'object') {
      params.push(JSON.stringify(content))
      sets.push(`content = $${params.length}::jsonb`)
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
    params.push(req.user.name)
    sets.push(`updated_by = $${params.length}`, 'updated_at = now()')
    params.push(id)
    const { rows } = await query(
      `UPDATE handover_docs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, title, updated_at, updated_by`,
      params
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.delete(
  '/handover/docs/:id',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    if (!hasRole(req.user, 'admin')) return res.status(403).json({ error: 'admin only' })
    const id = parseInt(req.params.id, 10)
    await query('DELETE FROM handover_comments WHERE doc_id = $1', [id])
    await query('DELETE FROM handover_docs WHERE id = $1', [id])
    res.json({ ok: true })
  })
)

// 여백 댓글 (좌·우)
const cleanImages = (v) =>
  Array.isArray(v)
    ? v
        .filter((x) => x && typeof x.url === 'string' && /^(https?:)?\//.test(x.url))
        .slice(0, 8)
        .map((x) => ({ url: x.url, caption: String(x.caption || '').slice(0, 200) }))
    : []

router.get(
  '/handover/docs/:id/comments',
  requireAccess,
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    const { rows } = await query(
      'SELECT * FROM handover_comments WHERE doc_id = $1 ORDER BY created_at, id',
      [id]
    )
    res.json({ items: rows })
  })
)

router.post(
  '/handover/docs/:id/comments',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    const b = req.body || {}
    const anchor = String(b.anchor_id || '').slice(0, 64)
    if (!anchor) return res.status(400).json({ error: 'anchor_id required' })
    const side = b.side === 'left' ? 'left' : 'right'
    const { rows } = await query(
      `INSERT INTO handover_comments (doc_id, anchor_id, side, quote, body, images, author, author_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING *`,
      [id, anchor, side, String(b.quote || '').slice(0, 500), String(b.body || '').slice(0, 5000),
        JSON.stringify(cleanImages(b.images)), req.user.name, req.user.id]
    )
    res.status(201).json({ item: rows[0] })
  })
)

router.put(
  '/handover/comments/:cid',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    const cid = parseInt(req.params.cid, 10)
    const b = req.body || {}
    const sets = []
    const params = []
    if (typeof b.body === 'string') { params.push(b.body.slice(0, 5000)); sets.push(`body = $${params.length}`) }
    if (b.side === 'left' || b.side === 'right') { params.push(b.side); sets.push(`side = $${params.length}`) }
    if (typeof b.resolved === 'boolean') { params.push(b.resolved); sets.push(`resolved = $${params.length}`) }
    if (Array.isArray(b.images)) { params.push(JSON.stringify(cleanImages(b.images))); sets.push(`images = $${params.length}::jsonb`) }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
    params.push(cid)
    const { rows } = await query(
      `UPDATE handover_comments SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.delete(
  '/handover/comments/:cid',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    await query('DELETE FROM handover_comments WHERE id = $1', [parseInt(req.params.cid, 10)])
    res.json({ ok: true })
  })
)

// 비밀값: 목록은 이름만, 값은 단건 요청으로만 내려간다.
router.get(
  '/handover/secrets',
  requireAccess,
  wrap(async (req, res) => {
    const { rows } = await query('SELECT id, label, updated_at FROM handover_secrets ORDER BY id')
    res.json({ items: rows })
  })
)

router.get(
  '/handover/secrets/:sid',
  requireAccess,
  wrap(async (req, res) => {
    const { rows } = await query('SELECT id, label, value FROM handover_secrets WHERE id = $1', [
      parseInt(req.params.sid, 10),
    ])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.set('Cache-Control', 'no-store')
    res.json({ item: rows[0] })
  })
)

router.post(
  '/handover/secrets',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    const label = String(req.body?.label || '').slice(0, 120)
    const value = String(req.body?.value || '').slice(0, 2000)
    if (!label || !value) return res.status(400).json({ error: 'label, value required' })
    const { rows } = await query(
      'INSERT INTO handover_secrets (label, value, updated_by) VALUES ($1, $2, $3) RETURNING id, label',
      [label, value, req.user.name]
    )
    res.status(201).json({ item: rows[0] })
  })
)

router.put(
  '/handover/secrets/:sid',
  requireAccess,
  requireMember,
  wrap(async (req, res) => {
    const sid = parseInt(req.params.sid, 10)
    const sets = []
    const params = []
    if (typeof req.body?.label === 'string') { params.push(req.body.label.slice(0, 120)); sets.push(`label = $${params.length}`) }
    if (typeof req.body?.value === 'string' && req.body.value) { params.push(req.body.value.slice(0, 2000)); sets.push(`value = $${params.length}`) }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' })
    params.push(req.user.name)
    sets.push(`updated_by = $${params.length}`, 'updated_at = now()')
    params.push(sid)
    const { rows } = await query(
      `UPDATE handover_secrets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, label`,
      params
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

export default router
