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

async function gatedWsId() {
  const r = await query("SELECT id FROM ws_files WHERE kind = 'doc' AND gated = true ORDER BY id LIMIT 1")
  return r.rows[0]?.id ?? null
}
const toInt = (v) => (Number.isInteger(parseInt(v, 10)) ? parseInt(v, 10) : null)
const wsFromReq = async (req) => toInt(req.query?.ws) ?? toInt(req.body?.ws) ?? gatedWsId()
const wsOfDoc = async (req) => (await query('SELECT ws_id FROM handover_docs WHERE id = $1', [toInt(req.params.id)])).rows[0]?.ws_id ?? null
const wsOfVersion = async (req) =>
  (await query('SELECT d.ws_id FROM handover_versions v JOIN handover_docs d ON d.id = v.doc_id WHERE v.id = $1', [toInt(req.params.vid)])).rows[0]?.ws_id ?? null
const wsOfComment = async (req) =>
  (await query('SELECT d.ws_id FROM handover_comments c JOIN handover_docs d ON d.id = c.doc_id WHERE c.id = $1', [toInt(req.params.cid)])).rows[0]?.ws_id ?? null

// 문서(ws) 단위 접근 검사: 관리자는 모든 문서, 열람 비밀번호는 비밀번호 대상 문서만
async function wsAllows(req, wsId) {
  const a = accessOf(req)
  if (a === 'member') return true
  if (a !== 'gate') return false
  const r = await query('SELECT gated FROM ws_files WHERE id = $1', [wsId])
  return Boolean(r.rows[0]?.gated)
}

const guard = (resolve, { member = false } = {}) =>
  wrap(async (req, res, next) => {
    const access = accessOf(req)
    if (!access) return res.status(401).json({ error: 'handover locked' })
    const ws = await resolve(req)
    if (ws === null || ws === undefined) return res.status(404).json({ error: 'not found' })
    if (!(await wsAllows(req, ws))) return res.status(access === 'gate' ? 403 : 401).json({ error: 'not allowed' })
    if (member && access !== 'member') return res.status(403).json({ error: 'member only' })
    req.handoverAccess = access
    req.wsId = ws
    next()
  })

async function gateHash() {
  const { rows } = await query("SELECT value FROM handover_settings WHERE key = 'gate_hash'")
  return rows[0]?.value || null
}


const VERSION_WINDOW_MIN = 5

// 같은 사람이 5분 안에 이어서 고치면 마지막 편집 버전을 갱신하고, 아니면 새 버전을 쌓는다(구글 독스의 묶음 방식).
async function recordVersion(docId, title, content, author, kind = 'edit') {
  if (kind === 'edit') {
    const { rows } = await query(
      `SELECT id FROM handover_versions
        WHERE doc_id = $1 AND kind = 'edit' AND name IS NULL AND author = $2
          AND updated_at > now() - ($3 || ' minutes')::interval
          AND id = (SELECT MAX(id) FROM handover_versions WHERE doc_id = $1)
        LIMIT 1`,
      [docId, author, String(VERSION_WINDOW_MIN)]
    )
    if (rows[0]) {
      await query('UPDATE handover_versions SET content = $1::jsonb, title = $2, updated_at = now() WHERE id = $3', [JSON.stringify(content), title, rows[0].id])
      return
    }
  }
  await query(
    'INSERT INTO handover_versions (doc_id, title, content, author, kind) VALUES ($1, $2, $3::jsonb, $4, $5)',
    [docId, title, JSON.stringify(content), author, kind]
  )
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
  guard(wsFromReq),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT d.id, d.ws_id, d.title, d.updated_at, d.updated_by, d.sort,
              (SELECT COUNT(*)::int FROM handover_comments c WHERE c.doc_id = d.id AND NOT c.resolved) AS open_comments
         FROM handover_docs d WHERE d.ws_id = $1 ORDER BY d.sort, d.id`,
      [req.wsId]
    )
    res.json({ items: rows, access: req.handoverAccess })
  })
)

router.get(
  '/handover/docs/:id',
  guard(wsOfDoc),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    const { rows } = await query('SELECT * FROM handover_docs WHERE id = $1', [id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0], access: req.handoverAccess, canEdit: req.handoverAccess === 'member' })
  })
)

router.post(
  '/handover/docs',
  guard(wsFromReq, { member: true }),
  wrap(async (req, res) => {
    const { rows: cnt } = await query('SELECT COUNT(*)::int AS n FROM handover_docs WHERE ws_id = $1', [req.wsId])
    const title = String(req.body?.title || `탭 ${cnt[0].n + 1}`).slice(0, 200)
    const { rows } = await query(
      `INSERT INTO handover_docs (title, content, content_html, sort, updated_by, ws_id)
       VALUES ($1, $2::jsonb, $3, COALESCE((SELECT MAX(sort) + 1 FROM handover_docs WHERE ws_id = $5), 0), $4, $5) RETURNING *`,
      [title, req.body?.content ? JSON.stringify(req.body.content) : null, '<p></p>', req.user.name, req.wsId]
    )
    res.status(201).json({ item: rows[0] })
  })
)

router.put(
  '/handover/docs/:id',
  guard(wsOfDoc, { member: true }),
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
    if (content && typeof content === 'object') {
      // 첫 저장 전 상태를 기준 버전으로 남긴다
      const has = (await query('SELECT 1 FROM handover_versions WHERE doc_id = $1 LIMIT 1', [id])).rows.length
      if (!has) {
        const d0 = (await query('SELECT title, content, content_html, updated_by, updated_at FROM handover_docs WHERE id = $1', [id])).rows[0]
        const base = d0?.content || (d0?.content_html ? { html: d0.content_html } : null)
        if (base) await query('INSERT INTO handover_versions (doc_id, title, content, author, kind, created_at, updated_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $6)', [id, d0.title, JSON.stringify(base), d0.updated_by || req.user.name, 'base', d0.updated_at])
      }
    }
    params.push(req.user.name)
    sets.push(`updated_by = $${params.length}`, 'updated_at = now()')
    params.push(id)
    const { rows } = await query(
      `UPDATE handover_docs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, title, updated_at, updated_by`,
      params
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    if (content && typeof content === 'object') await recordVersion(id, rows[0].title, content, req.user.name, 'edit')
    res.json({ item: rows[0] })
  })
)

// 탭 삭제: 편집 권한자 가능, 마지막 탭은 유지
router.delete(
  '/handover/docs/:id',
  guard(wsOfDoc, { member: true }),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM handover_docs WHERE ws_id = $1', [req.wsId])
    if (rows[0].n <= 1) return res.status(400).json({ error: '마지막 탭은 삭제 불가' })
    await query('DELETE FROM handover_comments WHERE doc_id = $1', [id])
    await query('DELETE FROM handover_versions WHERE doc_id = $1', [id])
    await query('DELETE FROM handover_docs WHERE id = $1', [id])
    res.json({ ok: true })
  })
)

// 문서 전체 제목(탭과 별개, 하나)
router.get(
  '/handover/meta',
  guard(wsFromReq),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT id, title, gated FROM ws_files WHERE id = $1', [req.wsId])
    res.json({ ws: rows[0].id, title: rows[0].title, gated: rows[0].gated, access: req.handoverAccess, canEdit: req.handoverAccess === 'member' })
  })
)

router.put(
  '/handover/meta',
  guard(wsFromReq, { member: true }),
  wrap(async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 200)
    if (!title) return res.status(400).json({ error: 'title required' })
    await query('UPDATE ws_files SET title = $1, updated_at = now() WHERE id = $2', [title, req.wsId])
    res.json({ title })
  })
)

// 버전 기록
router.get(
  '/handover/docs/:id/versions',
  guard(wsOfDoc),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    let { rows } = await query(
      `SELECT id, name, author, kind, created_at, updated_at, title FROM handover_versions WHERE doc_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 200`,
      [id]
    )
    if (!rows.length) {
      const d = (await query('SELECT title, content, content_html, updated_by, created_at FROM handover_docs WHERE id = $1', [id])).rows[0]
      if (d?.content) {
        await query(
          'INSERT INTO handover_versions (doc_id, title, content, author, kind, created_at, updated_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $6)',
          [id, d.title, JSON.stringify(d.content), d.updated_by || '주현호', 'base', d.created_at]
        )
        rows = (await query('SELECT id, name, author, kind, created_at, updated_at, title FROM handover_versions WHERE doc_id = $1 ORDER BY updated_at DESC, id DESC', [id])).rows
      }
    }
    res.json({ items: rows })
  })
)

router.get(
  '/handover/versions/:vid',
  guard(wsOfVersion),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM handover_versions WHERE id = $1', [parseInt(req.params.vid, 10)])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.put(
  '/handover/versions/:vid',
  guard(wsOfVersion, { member: true }),
  wrap(async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 120)
    const { rows } = await query(
      'UPDATE handover_versions SET name = $1, updated_at = updated_at WHERE id = $2 RETURNING id, name',
      [name || null, parseInt(req.params.vid, 10)]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.post(
  '/handover/versions/:vid/restore',
  guard(wsOfVersion, { member: true }),
  wrap(async (req, res) => {
    const v = (await query('SELECT * FROM handover_versions WHERE id = $1', [parseInt(req.params.vid, 10)])).rows[0]
    if (!v) return res.status(404).json({ error: 'not found' })
    const cur = (await query('SELECT title, content FROM handover_docs WHERE id = $1', [v.doc_id])).rows[0]
    // 복원 직전 상태를 먼저 남겨 되돌린 것도 되돌릴 수 있게 한다
    if (cur?.content) await recordVersion(v.doc_id, cur.title, cur.content, req.user.name, 'before-restore')
    if (v.content?.html) await query('UPDATE handover_docs SET content = NULL, content_html = $1, updated_by = $2, updated_at = now() WHERE id = $3', [v.content.html, req.user.name, v.doc_id])
    else await query('UPDATE handover_docs SET content = $1::jsonb, updated_by = $2, updated_at = now() WHERE id = $3', [JSON.stringify(v.content), req.user.name, v.doc_id])
    await recordVersion(v.doc_id, v.title, v.content, req.user.name, 'restore')
    res.json({ ok: true, content: v.content })
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
  guard(wsOfDoc),
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
  guard(wsOfDoc, { member: true }),
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
  guard(wsOfComment, { member: true }),
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
  guard(wsOfComment, { member: true }),
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
