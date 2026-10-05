// 작업공간 허브 API: 문서·시트 파일 목록, 템플릿으로 새로 만들기, 이름 바꾸기, 삭제, 시트 내용 저장.
// 목록·열기·편집은 공유 설정(lib/wsAccess.js)에 따른다. 새로 만들기는 구글로 로그인한 누구나,
// 삭제는 소유자 본인과 운영위원회 및 교수진(스태프 + 등록된 위원회 구성원). 지운 파일은 휴지통에 30일 보관(복원 가능) 뒤 영구 삭제.
// 비공개 전환은 운영위원회 및 교수진만, 구성원 등록은 사이트 관리자만.
import { Router } from 'express'
import { query } from '../db.js'
import { optionalAuth, hasRole } from '../middleware/auth.js'
import { GENERAL, ROLES, authorOf, canDeleteFile, canManageTrash, committeeOnly, daysLeft, fileRow, identityOf, isOwnerOf, levelFor, newToken, purgeExpired, purgeFile, restoreFile, touchRecent, trashFile } from '../lib/wsAccess.js'
import { DOC_TEMPLATES, SHEET_TEMPLATES, DOC_TEMPLATE_META, SHEET_TEMPLATE_META } from '../lib/workspaceTemplates.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
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

// 로그인한 사람(스태프 또는 구글 게스트)이면 통과
async function requireSignedIn(req, res, next) {
  const idn = await identityOf(req, res)
  if (!idn.emails.length) return res.status(401).json({ error: 'login required', hint: '구글 계정으로 로그인하세요.' })
  next()
}
const signedIn = wrap(requireSignedIn)

router.get(
  '/workspace/templates',
  signedIn,
  wrap(async (req, res) => {
    // siteOwnerOnly 템플릿(심사채점표)은 사이트 오너에게만 보인다
    const ownerRole = Boolean(req.user && hasRole(req.user, 'owner'))
    const show = (m) => !m.siteOwnerOnly || ownerRole
    res.json({ doc: DOC_TEMPLATE_META.filter(show), sheet: SHEET_TEMPLATE_META.filter(show) })
  })
)

// 허브 목록은 구글 독스처럼 계정마다 빈 화면에서 시작한다. 내 목록에는 아래 셋만 나온다.
//   1. 내가 만든 파일  2. 이메일로 공유받은 파일  3. 링크로 열어 본 파일(최근, 지금도 열 수 있는 것만)
// 위원회·전공·전체 공개로 설정된 파일도 목록에는 저절로 나오지 않는다(그 설정은 "링크로 누가 열 수 있나"만 정한다).
// 비공개(hidden) 파일은 3번에서 빠진다. ?hidden=1 은 내 목록 중 비공개만, ?trash=1 은 내 휴지통이다.
router.get(
  '/workspace/files',
  wrap(async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'doc'
    const idn = await identityOf(req, res)
    if (!idn.emails.length) return res.json({ items: [], staff: false, committee: false })
    const onlyHidden = req.query.hidden === '1' && idn.committee
    const trash = req.query.trash === '1'
    await purgeExpired().catch(() => {})
    const { rows } = await query(
      `SELECT f.id, f.kind, f.title, f.gated, f.created_by, f.owner_email, f.general_access, f.general_role, f.created_at, f.opened_at, f.hidden, f.owner_only, f.deleted_at,
              EXISTS (SELECT 1 FROM ws_shares s WHERE s.ws_id = f.id AND lower(s.email) = ANY($3::text[])) AS shared,
              GREATEST(f.updated_at, COALESCE((SELECT MAX(d.updated_at) FROM handover_docs d WHERE d.ws_id = f.id), f.updated_at)) AS updated_at,
              (SELECT d.id FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_tab,
              (SELECT d.content FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_content,
              (SELECT d.content_html FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_html,
              CASE WHEN f.kind = 'sheet' THEN f.content END AS sheet_content
         FROM ws_files f
        WHERE f.kind = $1
          AND (($5::boolean AND f.deleted_at IS NOT NULL) OR (NOT $5::boolean AND f.deleted_at IS NULL))
          AND ($5::boolean OR NOT $2::boolean OR f.hidden)
          AND (lower(f.owner_email) = ANY($3::text[])
               OR (f.owner_email IS NULL AND f.created_by = $4)
               OR EXISTS (SELECT 1 FROM ws_shares s WHERE s.ws_id = f.id AND lower(s.email) = ANY($3::text[]))
               OR (NOT $5::boolean AND NOT f.hidden AND EXISTS (SELECT 1 FROM ws_recent r WHERE r.ws_id = f.id AND r.email = ANY($3::text[]))))
        ORDER BY f.opened_at DESC, f.id DESC`,
      [kind, onlyHidden, idn.emails, idn.staff?.name || '', trash]
    )
    const items = []
    for (const r of rows) {
      const { first_content: fc, first_html: fh, sheet_content: sc, owner_email, ...rest } = r
      const probe = { ...r, id: r.id, owner_email, deleted_at: null }
      const level = await levelFor(req, res, probe)
      if (!level) continue
      const mine = isOwnerOf(idn, probe)
      if (trash && !canManageTrash(idn, req.user, probe, r.shared)) continue
      const base = {
        ...rest, my_role: level, mine,
        can_delete: canDeleteFile(idn, req.user, probe),
        can_hide: idn.committee && level === 'editor' && !r.owner_only,
        ...(trash ? { trashed: true, days_left: daysLeft(r.deleted_at) } : {}),
      }
      if (r.kind === 'doc') {
        items.push({ ...base, excerpt: fc ? excerpt(fc) : String(fh || '').replace(/<\/(p|h[1-6]|li|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim().slice(0, 520) })
        continue
      }
      const first = Array.isArray(sc?.sheets) ? sc.sheets[0] : sc
      const preview = (first?.rows || []).slice(0, 8).map((row) => (first.columns || []).slice(0, 6).map((c) => String(row.cells?.[c.key] ?? '')))
      items.push({ ...base, head: (first?.columns || []).slice(0, 6).map((c) => c.label), preview })
    }
    res.json({ items, staff: Boolean(idn.staff), committee: idn.committee })
  })
)

router.post(
  '/workspace/files',
  signedIn,
  wrap(async (req, res) => {
    const kind = req.body?.kind
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be doc or sheet' })
    const tpl = String(req.body?.template || 'blank')
    const name = (kind === 'doc' ? DOC_TEMPLATE_META : SHEET_TEMPLATE_META).find((m) => m.id === tpl)
    const title = String(req.body?.title || (tpl === 'blank' ? (kind === 'doc' ? '제목 없는 문서' : '제목 없는 스프레드시트') : name?.name || '제목 없음')).slice(0, 200)
    if (name?.siteOwnerOnly && !(req.user && hasRole(req.user, 'owner'))) return res.status(403).json({ error: 'not allowed', hint: '이 템플릿은 사이트 오너만 쓸 수 있습니다.' })
    const idn = await identityOf(req, res)
    const owner = lower(req.user?.email || req.publicUser?.email)
    const ownerName = req.user?.name || req.publicUser?.name || req.publicUser?.email
    if (kind === 'doc') {
      const build = DOC_TEMPLATES[tpl] || DOC_TEMPLATES.blank
      const { rows } = await query(
        "INSERT INTO ws_files (kind, title, template, created_by, owner_email, share_token) VALUES ('doc', $1, $2, $3, $4, $5) RETURNING *",
        [title, tpl, ownerName, owner, newToken()]
      )
      const f = rows[0]
      const tab = await query(
        `INSERT INTO handover_docs (title, content, content_html, sort, updated_by, ws_id)
         VALUES ('탭 1', $1::jsonb, '<p></p>', 0, $2, $3) RETURNING id`,
        [JSON.stringify(build()), ownerName, f.id]
      )
      return res.status(201).json({ item: { ...f, first_tab: tab.rows[0].id } })
    }
    const build = SHEET_TEMPLATES[tpl] || SHEET_TEMPLATES.blank
    // 심사채점표처럼 나만 보기 템플릿은 만든 사람만 열 수 있고 공유도 막힌다(다른 사람 목록에는 잠긴 카드로도 안 나옴).
    const ownerOnly = Boolean(name?.ownerOnly)
    const { rows } = await query(
      "INSERT INTO ws_files (kind, title, template, content, created_by, owner_email, share_token, owner_only) VALUES ('sheet', $1, $2, $3::jsonb, $4, $5, $6, $7) RETURNING *",
      [title, tpl, JSON.stringify(build()), ownerName, owner, newToken(), ownerOnly]
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
    await touchRecent(req, res, file)
    await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [file.id])
    res.json({ ok: true })
  })
)

// 삭제: 휴지통으로 옮긴다(30일 보관, 복원 가능). 소유자 본인과 운영위원회 및 교수진이 할 수 있다.
router.delete(
  '/workspace/files/:id',
  signedIn,
  wrap(async (req, res) => {
    const f = await fileRow(pid(req))
    if (!f || f.deleted_at) return res.status(404).json({ error: 'not found' })
    const idn = await identityOf(req, res)
    if (!canDeleteFile(idn, req.user, f)) {
      const why = f.gated ? '인수인계 문서는 오너만 삭제할 수 있습니다' : f.owner_only ? '나만 보기 파일은 만든 사람만 삭제할 수 있습니다' : '파일을 만든 사람이나 운영위원회 및 교수진만 삭제할 수 있습니다'
      return res.status(403).json({ error: why })
    }
    await trashFile(f, authorOf(req))
    res.json({ ok: true, trashed: true, days: 30 })
  })
)

// 휴지통에서 복원
router.post(
  '/workspace/files/:id/restore',
  signedIn,
  wrap(async (req, res) => {
    const f = await fileRow(pid(req))
    if (!f || !f.deleted_at) return res.status(404).json({ error: 'not found' })
    const idn = await identityOf(req, res)
    const shared = (await query('SELECT 1 FROM ws_shares WHERE ws_id = $1 AND lower(email) = ANY($2::text[]) LIMIT 1', [f.id, idn.emails])).rows.length > 0
    if (!canManageTrash(idn, req.user, f, shared)) return res.status(403).json({ error: 'not allowed' })
    await restoreFile(f)
    res.json({ ok: true })
  })
)

// 휴지통에서 영구 삭제(되돌릴 수 없음)
router.delete(
  '/workspace/files/:id/permanent',
  signedIn,
  wrap(async (req, res) => {
    const f = await fileRow(pid(req))
    if (!f || !f.deleted_at) return res.status(404).json({ error: '휴지통에 있는 파일만 영구 삭제할 수 있습니다' })
    const idn = await identityOf(req, res)
    const shared = (await query('SELECT 1 FROM ws_shares WHERE ws_id = $1 AND lower(email) = ANY($2::text[]) LIMIT 1', [f.id, idn.emails])).rows.length > 0
    if (!canManageTrash(idn, req.user, f, shared)) return res.status(403).json({ error: 'not allowed' })
    await purgeFile(f)
    res.json({ ok: true })
  })
)

// 비공개 전환: 운영위원회 및 교수진이 편집 권한을 가진 파일을 목록에서 숨기거나 다시 보이게 한다.
// 숨겨도 공유 설정은 그대로라, 소유자와 이메일로 공유받은 사람은 계속 보고 연다.
router.put(
  '/workspace/files/:id/hidden',
  committeeOnly,
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    if (file.owner_only) return res.status(400).json({ error: '나만 보기 파일은 항상 비공개입니다' })
    const hidden = req.body?.hidden === true
    await query('UPDATE ws_files SET hidden = $1, updated_at = updated_at WHERE id = $2', [hidden, file.id])
    res.json({ id: file.id, hidden })
  })
)

// 마지막으로 수정한 위치 기록(편집자). 문서: tab·text, 시트: sheet·row·col, 폼: field
router.put(
  '/workspace/files/:id/last-edit',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    const b = req.body || {}
    const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const target = Object.fromEntries(
      Object.entries({ tab: clip(b.tab, 40), text: clip(b.text, 160), sheet: clip(b.sheet, 40), row: clip(b.row, 40), col: clip(b.col, 80), field: clip(b.field, 80) }).filter(([, v]) => v !== undefined)
    )
    const value = { ...target, by: authorOf(req), at: new Date().toISOString() }
    await query('UPDATE ws_files SET last_edit = $1::jsonb WHERE id = $2', [JSON.stringify(value), file.id])
    res.json({ last_edit: value })
  })
)

// ── 시트 내용 ──────────────────────────────────────────────
router.get(
  '/workspace/sheets/:id',
  wrap(async (req, res) => {
    const file = await loadFile(req, res)
    if (!file || file.kind !== 'sheet') return file ? res.status(404).json({ error: 'not found' }) : undefined
    await touchRecent(req, res, file)
    const { rows } = await query('SELECT id, title, content, updated_at FROM ws_files WHERE id = $1', [file.id])
    if (req.fileLevel === 'editor') await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [file.id])
    res.json({ item: rows[0], level: req.fileLevel, canEdit: req.fileLevel === 'editor', last_edit: file.last_edit || null })
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
      user: u ? { name: u.name, email: u.email, role: req.user?.role || null, kind: req.user ? 'staff' : 'guest', member: Boolean(idn.member), picture } : null,
      staff: Boolean(idn.staff),
      committee: idn.committee,
      admin: idn.isSite,
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
    hidden: Boolean(file.hidden),
    owner_only: Boolean(file.owner_only),
    owner,
    people: out,
  }
}

// 나만 보기 파일은 공유 설정을 바꿀 수 없다
function blockOwnerOnly(file, res) {
  if (!file.owner_only) return false
  res.status(403).json({ error: '나만 보기 파일은 공유할 수 없습니다', hint: '만든 사람만 볼 수 있도록 고정된 파일입니다.' })
  return true
}

router.get(
  '/workspace/files/:id/share',
  wrap(async (req, res) => {
    const file = await loadFile(req, res)
    if (!file) return
    const state = await shareState(file)
    const idn = await identityOf(req, res)
    state.can_hide = idn.committee && req.fileLevel === 'editor' && !file.owner_only
    if (req.fileLevel !== 'editor') state.share_token = state.general_access === 'public' ? state.share_token : null
    res.json({ ...state, level: req.fileLevel })
  })
)

router.put(
  '/workspace/files/:id/share',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file || blockOwnerOnly(file, res)) return
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
    if (!file || blockOwnerOnly(file, res)) return
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

// ── 운영위원회 구성원(사이트 계정과 별개) ─────────────────────
// 사이트 관리자(admin·owner)가 구글 이메일을 등록하면, 그 이메일로 구글 로그인한 사람은
// DAH Docs·Sheet·Form에서 "운영위원회 및 교수진" 권한(공유 파일 열람, 삭제, 비공개 전환)을 얻는다.
// 사이트 관리 대시보드 권한은 생기지 않는다.
async function siteAdminOnly(req, res, next) {
  const idn = await identityOf(req, res)
  if (!idn.isSite) return res.status(idn.emails.length ? 403 : 401).json({ error: 'admin only', hint: '사이트 관리자만 구성원을 관리할 수 있습니다.' })
  next()
}

async function memberList() {
  const members = (
    await query(
      `SELECT m.id, m.email, m.name, m.note, m.added_by, m.created_at,
              p.name AS google_name, p.picture, p.last_login_at
         FROM ws_members m
         LEFT JOIN public_users p ON lower(p.email) = lower(m.email)
        ORDER BY m.created_at DESC, m.id DESC`
    )
  ).rows
  const staff = (
    await query("SELECT id, email, name, role, picture FROM users WHERE role IN ('owner', 'admin', 'manager') ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name")
  ).rows
  const recent = (
    await query(
      `SELECT p.email, p.name, p.picture, p.last_login_at
         FROM public_users p
        WHERE NOT EXISTS (SELECT 1 FROM ws_members m WHERE lower(m.email) = lower(p.email))
          AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(p.email))
        ORDER BY p.last_login_at DESC NULLS LAST
        LIMIT 30`
    )
  ).rows
  return { members, staff, recent }
}

router.get('/workspace/members', wrap(siteAdminOnly), wrap(async (req, res) => res.json(await memberList())))

router.post(
  '/workspace/members',
  wrap(siteAdminOnly),
  wrap(async (req, res) => {
    const raw = Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email]
    const emails = [...new Set(raw.map(lower).filter(Boolean))]
    if (!emails.length) return res.status(400).json({ error: 'emails required' })
    if (emails.length > 50) return res.status(400).json({ error: 'too many' })
    const bad = emails.filter((e) => !EMAIL_RE.test(e))
    if (bad.length) return res.status(400).json({ error: '이메일 형식이 아닙니다', emails: bad })
    const name = String(req.body?.name || '').trim().slice(0, 60) || null
    const note = String(req.body?.note || '').trim().slice(0, 120) || null
    for (const e of emails) {
      await query(
        `INSERT INTO ws_members (email, name, note, added_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (lower(email)) DO UPDATE SET name = COALESCE(EXCLUDED.name, ws_members.name), note = COALESCE(EXCLUDED.note, ws_members.note)`,
        [e, emails.length === 1 ? name : null, note, authorOf(req)]
      )
      // 이미 일반 계정으로 로그인한 적이 있으면 제출 제한(ws_only)을 푼다
      await query('UPDATE public_users SET ws_only = false WHERE lower(email) = $1', [e])
    }
    res.status(201).json(await memberList())
  })
)

router.put(
  '/workspace/members/:id',
  wrap(siteAdminOnly),
  wrap(async (req, res) => {
    const name = req.body?.name === undefined ? undefined : String(req.body.name || '').trim().slice(0, 60) || null
    const note = req.body?.note === undefined ? undefined : String(req.body.note || '').trim().slice(0, 120) || null
    await query(
      `UPDATE ws_members SET name = CASE WHEN $2 THEN $3 ELSE name END, note = CASE WHEN $4 THEN $5 ELSE note END WHERE id = $1`,
      [pid(req), name !== undefined, name ?? null, note !== undefined, note ?? null]
    )
    res.json(await memberList())
  })
)

router.delete(
  '/workspace/members/:id',
  wrap(siteAdminOnly),
  wrap(async (req, res) => {
    await query('DELETE FROM ws_members WHERE id = $1', [pid(req)])
    res.json(await memberList())
  })
)

export default router
