// 작업공간 허브 API: 문서·시트 파일 목록, 템플릿으로 새로 만들기, 이름 바꾸기, 삭제, 시트 내용 저장.
// 폼은 기존 /admin/forms를 그대로 쓴다. 목록·새로 만들기는 manager 이상(운영위원회 및 교수진),
// 파일을 여는 일은 공유 설정(lib/wsAccess.js)에 따른다.
import { Router } from 'express'
import { query } from '../db.js'
import { optionalAuth, requireAuth, requireRole, hasRole } from '../middleware/auth.js'
import { GENERAL, ROLES, authorOf, fileRow, identityOf, levelFor, newToken } from '../lib/wsAccess.js'
import { DOC_TEMPLATES, SHEET_TEMPLATES, DOC_TEMPLATE_META, SHEET_TEMPLATE_META } from '../lib/workspaceTemplates.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const guard = [requireAuth, requireRole('manager')]
const KINDS = ['doc', 'sheet']
const MAX_UI_BYTES = 200_000
const lower = (v) => String(v || '').trim().toLowerCase()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const pid = (req) => parseInt(req.params.id, 10)

router.use('/workspace', optionalAuth)

// 문서 썸네일용 앞부분 글: Tiptap JSON에서 글자만 모은다
function excerpt(json, limit = 520) {
  const out = []
  let n = 0
  const walk = (node) => {
    if (n >= limit || !node) return
    if (node.type === 'text') {
      out.push(node.text)
      n += node.text.length
      return
    }
    if (node.type === 'secret') return
    ;(node.content || []).forEach(walk)
    if (['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type)) out.push('\n')
  }
  walk(json)
  return out.join('').replace(/\n{2,}/g, '\n').trim().slice(0, limit)
}

router.get(
  '/workspace/templates',
  ...guard,
  wrap(async (req, res) => {
    res.json({ doc: DOC_TEMPLATE_META, sheet: SHEET_TEMPLATE_META })
  })
)

router.get(
  '/workspace/files',
  ...guard,
  wrap(async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'doc'
    const idn = await identityOf(req, res)
    const { rows } = await query(
      `SELECT f.id, f.kind, f.title, f.gated, f.created_by, f.owner_email, f.general_access, f.general_role, f.created_at, f.opened_at,
              GREATEST(f.updated_at, COALESCE((SELECT MAX(d.updated_at) FROM handover_docs d WHERE d.ws_id = f.id), f.updated_at)) AS updated_at,
              (SELECT d.id FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_tab,
              (SELECT d.content FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_content,
              (SELECT d.content_html FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_html,
              CASE WHEN f.kind = 'sheet' THEN f.content END AS sheet_content
         FROM ws_files f
        WHERE f.kind = $1
          AND ($2::boolean
               OR lower(f.owner_email) = ANY($3::text[])
               OR (f.owner_email IS NULL AND f.created_by = $4)
               OR f.general_access IN ('committee', 'public')
               OR EXISTS (SELECT 1 FROM ws_shares s WHERE s.ws_id = f.id AND lower(s.email) = ANY($3::text[])))
        ORDER BY f.opened_at DESC, f.id DESC`,
      [kind, idn.isSite, idn.emails, idn.staff?.name || '']
    )
    const items = []
    for (const r of rows) {
      const { first_content: fc, first_html: fh, sheet_content: sc, owner_email, ...rest } = r
      const level = await levelFor(req, res, { ...r, id: r.id, owner_email })
      if (!level) continue
      const mine = Boolean(idn.isSite || (owner_email && idn.emails.includes(lower(owner_email))) || (!owner_email && r.created_by === idn.staff?.name))
      const base = { ...rest, my_role: level, mine }
      if (r.kind === 'doc') {
        items.push({ ...base, excerpt: fc ? excerpt(fc) : String(fh || '').replace(/<\/(p|h[1-6]|li|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim().slice(0, 520) })
        continue
      }
      const first = Array.isArray(sc?.sheets) ? sc.sheets[0] : sc
      const preview = (first?.rows || []).slice(0, 8).map((row) => (first.columns || []).slice(0, 6).map((c) => String(row.cells?.[c.key] ?? '')))
      items.push({ ...base, head: (first?.columns || []).slice(0, 6).map((c) => c.label), preview })
    }
    res.json({ items })
  })
)

router.post(
  '/workspace/files',
  ...guard,
  wrap(async (req, res) => {
    const kind = req.body?.kind
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be doc or sheet' })
    const tpl = String(req.body?.template || 'blank')
    const name = (kind === 'doc' ? DOC_TEMPLATE_META : SHEET_TEMPLATE_META).find((m) => m.id === tpl)
    const title = String(req.body?.title || (tpl === 'blank' ? (kind === 'doc' ? '제목 없는 문서' : '제목 없는 스프레드시트') : name?.name || '제목 없음')).slice(0, 200)
    const owner = lower(req.user.email)
    if (kind === 'doc') {
      const build = DOC_TEMPLATES[tpl] || DOC_TEMPLATES.blank
      const { rows } = await query(
        "INSERT INTO ws_files (kind, title, template, created_by, owner_email, share_token) VALUES ('doc', $1, $2, $3, $4, $5) RETURNING *",
        [title, tpl, req.user.name, owner, newToken()]
      )
      const f = rows[0]
      const tab = await query(
        `INSERT INTO handover_docs (title, content, content_html, sort, updated_by, ws_id)
         VALUES ('탭 1', $1::jsonb, '<p></p>', 0, $2, $3) RETURNING id`,
        [JSON.stringify(build()), req.user.name, f.id]
      )
      return res.status(201).json({ item: { ...f, first_tab: tab.rows[0].id } })
    }
    const build = SHEET_TEMPLATES[tpl] || SHEET_TEMPLATES.blank
    const { rows } = await query(
      "INSERT INTO ws_files (kind, title, template, content, created_by, owner_email, share_token) VALUES ('sheet', $1, $2, $3::jsonb, $4, $5, $6) RETURNING *",
      [title, tpl, JSON.stringify(build()), req.user.name, owner, newToken()]
    )
    res.status(201).json({ item: rows[0] })
  })
)

/** 파일을 찾고 권한을 확인한다. need가 'editor'면 편집 권한이 있어야 한다. */
async function loadFile(req, res, need = 'viewer') {
  const file = await fileRow(pid(req))
  if (!file) { res.status(404).json({ error: 'not found' }); return null }
  const level = await levelFor(req, res, file)
  if (!level) { res.status(req.user || req.publicUser ? 403 : 401).json({ error: 'not allowed' }); return null }
  if (need === 'editor' && level !== 'editor') { res.status(403).json({ error: 'editor only' }); return null }
  req.fileLevel = level
  return file
}

router.put(
  '/workspace/files/:id',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    const title = String(req.body?.title || '').trim().slice(0, 200)
    if (!title) return res.status(400).json({ error: 'title required' })
    const { rows } = await query('UPDATE ws_files SET title = $1, updated_at = now() WHERE id = $2 RETURNING id, title', [title, file.id])
    res.json({ item: rows[0] })
  })
)

router.post(
  '/workspace/files/:id/open',
  wrap(async (req, res) => {
    const file = await loadFile(req, res)
    if (!file) return
    await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [file.id])
    res.json({ ok: true })
  })
)

router.delete(
  '/workspace/files/:id',
  ...guard,
  wrap(async (req, res) => {
    const f = await fileRow(pid(req))
    if (!f) return res.status(404).json({ error: 'not found' })
    const idn = await identityOf(req, res)
    const isOwner = idn.isSite || (f.owner_email && idn.emails.includes(lower(f.owner_email))) || (!f.owner_email && f.created_by === req.user.name)
    if (!isOwner) return res.status(403).json({ error: '소유자만 삭제할 수 있습니다' })
    if (f.gated && !hasRole(req.user, 'owner')) return res.status(403).json({ error: '인수인계 문서는 오너만 삭제할 수 있습니다' })
    if (f.kind === 'doc') {
      await query('DELETE FROM handover_comments WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [f.id])
      await query('DELETE FROM handover_versions WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [f.id])
      await query('DELETE FROM handover_docs WHERE ws_id = $1', [f.id])
    }
    await query('DELETE FROM ws_shares WHERE ws_id = $1', [f.id])
    await query('DELETE FROM ws_files WHERE id = $1', [f.id])
    res.json({ ok: true })
  })
)

// ── 시트 내용 ──────────────────────────────────────────────
router.get(
  '/workspace/sheets/:id',
  wrap(async (req, res) => {
    const file = await loadFile(req, res)
    if (!file || file.kind !== 'sheet') return file ? res.status(404).json({ error: 'not found' }) : undefined
    const { rows } = await query('SELECT id, title, content, updated_at FROM ws_files WHERE id = $1', [file.id])
    if (req.fileLevel === 'editor') await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [file.id])
    res.json({ item: rows[0], level: req.fileLevel, canEdit: req.fileLevel === 'editor' })
  })
)

router.put(
  '/workspace/sheets/:id',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file || file.kind !== 'sheet') return file ? res.status(404).json({ error: 'not found' }) : undefined
    const c = req.body?.content
    const list = Array.isArray(c?.sheets) ? c.sheets : c ? [c] : []
    if (!list.length || list.length > 30 || list.some((x) => !x || !Array.isArray(x.columns) || !Array.isArray(x.rows))) {
      return res.status(400).json({ error: 'content.sheets[].columns, rows required' })
    }
    if (list.some((x) => x.rows.length > 5000 || x.columns.length > 200)) return res.status(413).json({ error: 'too large' })
    const { rows } = await query('UPDATE ws_files SET content = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING id, updated_at', [JSON.stringify(c), file.id])
    res.json({ item: rows[0] })
  })
)

// 시트 화면 상태(열 너비, 서식 등). 스태프가 아닌 공유 대상도 쓸 수 있게 공유 권한으로 검사한다.
router.get(
  '/workspace/sheets/:id/ui',
  wrap(async (req, res) => {
    const file = await loadFile(req, res)
    if (!file) return
    const { rows } = await query('SELECT value FROM admin_sheet_state WHERE key = $1', [`ws-sheet-${file.id}`])
    res.json({ state: rows[0]?.value ?? null })
  })
)
router.put(
  '/workspace/sheets/:id/ui',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    const state = req.body?.state
    if (!state || typeof state !== 'object' || Array.isArray(state)) return res.status(400).json({ error: 'state must be an object' })
    const text = JSON.stringify(state)
    if (text.length > MAX_UI_BYTES) return res.status(413).json({ error: 'state too large' })
    await query(
      `INSERT INTO admin_sheet_state (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [`ws-sheet-${file.id}`, text]
    )
    res.json({ ok: true })
  })
)

// ── 현재 계정 ──────────────────────────────────────────────
router.get(
  '/workspace/me',
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    let picture = null
    if (req.user) picture = (await query('SELECT picture FROM users WHERE id = $1', [req.user.id])).rows[0]?.picture || null
    else if (req.publicUser) picture = (await query('SELECT picture FROM public_users WHERE id = $1', [req.publicUser.id])).rows[0]?.picture || null
    const u = req.user || req.publicUser
    res.json({
      user: u ? { name: u.name, email: u.email, role: req.user?.role || null, kind: req.user ? 'staff' : 'guest', picture } : null,
      staff: Boolean(idn.staff),
    })
  })
)

// ── 공유 ──────────────────────────────────────────────────
async function profileOf(email) {
  const u = (await query('SELECT name, picture FROM users WHERE lower(email) = $1', [email])).rows[0]
  if (u) return u
  return (await query('SELECT name, picture FROM public_users WHERE lower(email) = $1', [email])).rows[0] || {}
}

async function shareState(file) {
  const people = (await query('SELECT id, email, role FROM ws_shares WHERE ws_id = $1 ORDER BY created_at, id', [file.id])).rows
  const out = []
  for (const p of people) out.push({ ...p, ...(await profileOf(lower(p.email))) })
  const owner = file.owner_email ? { email: file.owner_email, ...(await profileOf(lower(file.owner_email))) } : { email: null, name: file.created_by || '' }
  if (!owner.name) owner.name = file.created_by || ''
  return {
    id: file.id,
    kind: file.kind,
    title: file.title,
    general_access: file.general_access,
    general_role: file.general_role,
    share_token: file.share_token,
    owner,
    people: out,
  }
}

router.get(
  '/workspace/files/:id/share',
  wrap(async (req, res) => {
    const file = await loadFile(req, res)
    if (!file) return
    const state = await shareState(file)
    if (req.fileLevel !== 'editor') state.share_token = state.general_access === 'public' ? state.share_token : null
    res.json({ ...state, level: req.fileLevel })
  })
)

router.put(
  '/workspace/files/:id/share',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    const access = req.body?.general_access
    const role = req.body?.general_role
    if (access !== undefined && !GENERAL.includes(access)) return res.status(400).json({ error: 'invalid general_access' })
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'invalid general_role' })
    await query('UPDATE ws_files SET general_access = COALESCE($1, general_access), general_role = COALESCE($2, general_role) WHERE id = $3', [access ?? null, role ?? null, file.id])
    if (req.body?.reset_link === true) await query('UPDATE ws_files SET share_token = $1 WHERE id = $2', [newToken(), file.id])
    res.json(await shareState(await fileRow(file.id)))
  })
)

router.post(
  '/workspace/files/:id/share/people',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    const role = ROLES.includes(req.body?.role) ? req.body.role : 'viewer'
    const emails = [...new Set((Array.isArray(req.body?.emails) ? req.body.emails : []).map(lower).filter(Boolean))]
    if (!emails.length) return res.status(400).json({ error: 'emails required' })
    if (emails.length > 50) return res.status(400).json({ error: 'too many' })
    const bad = emails.filter((e) => !EMAIL_RE.test(e))
    if (bad.length) return res.status(400).json({ error: 'invalid email', emails: bad })
    for (const e of emails) {
      if (file.owner_email && lower(file.owner_email) === e) continue
      await query(
        `INSERT INTO ws_shares (ws_id, email, role, added_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (ws_id, email) DO UPDATE SET role = EXCLUDED.role`,
        [file.id, e, role, authorOf(req)]
      )
    }
    res.status(201).json(await shareState(file))
  })
)

router.put(
  '/workspace/files/:id/share/people/:sid',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    if (!ROLES.includes(req.body?.role)) return res.status(400).json({ error: 'invalid role' })
    await query('UPDATE ws_shares SET role = $1 WHERE id = $2 AND ws_id = $3', [req.body.role, parseInt(req.params.sid, 10), file.id])
    res.json(await shareState(file))
  })
)

router.delete(
  '/workspace/files/:id/share/people/:sid',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    await query('DELETE FROM ws_shares WHERE id = $1 AND ws_id = $2', [parseInt(req.params.sid, 10), file.id])
    res.json(await shareState(file))
  })
)

export default router
