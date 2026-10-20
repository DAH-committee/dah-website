// 작업공간 허브 API: 문서·시트·보드·슬라이드 파일 목록, 템플릿으로 새로 만들기, 이름 바꾸기, 삭제, 시트 내용 저장, 공유, 팀.
// 목록·열기·편집은 공유 설정(lib/wsAccess.js)에 따른다. 새로 만들기는 로그인한 누구나.
// 삭제는 파일 소유자, 팀 파일이면 그 팀의 오너도. 지운 파일은 휴지통에 30일 보관(복원 가능) 뒤 영구 삭제.
// 팀은 누구나 만들 수 있고(만든 사람이 팀 오너), 팀원 관리는 팀 오너만 한다. 팀에는 오너가 한 명 이상 있어야 한다.
import crypto from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { optionalAuth } from '../middleware/auth.js'
import { GENERAL, ROLES, TEAM_ROLES, authorOf, canDeleteFile, canManageTrash, daysLeft, fileRow, identityOf, isOwnerOf, levelFor, newToken, purgeExpired, purgeFile, restoreFile, teamRoleOf, touchRecent, trashFile } from '../lib/wsAccess.js'
import { DOC_TEMPLATES, SHEET_TEMPLATES, DOC_TEMPLATE_META, SHEET_TEMPLATE_META } from '../lib/workspaceTemplates.js'
import { sanitizeHtml } from '../lib/safeHtml.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const KINDS = ['doc', 'sheet', 'board', 'slide']
// 목록 조회에만 허용하는 종류: 한글(hwp) 파일은 업로드 경로(/hwp/files/*)로만 만든다
const LIST_KINDS = [...KINDS, 'hwp']

// 슬라이드 템플릿은 다른 파일(lib/slideTemplates.js)이 맡는다. 파일이 아직 없거나 깨져도 서버는 떠야 하므로 동적으로 불러온다.
const BLANK_SLIDES = () => ({ version: 1, size: { w: 1920, h: 1080 }, theme: {}, slides: [{ id: 's1', layout: 'title', background: { color: '#ffffff' }, notes: '', elements: [] }] })
const BLANK_SLIDE_META = [{ id: 'blank', name: '빈 프레젠테이션', sub: '' }]
let slideLib = null
async function slideTemplates() {
  if (slideLib) return slideLib
  try {
    const m = await import('../lib/slideTemplates.js')
    slideLib = {
      build: m.SLIDE_TEMPLATES && typeof m.SLIDE_TEMPLATES === 'object' ? m.SLIDE_TEMPLATES : {},
      meta: Array.isArray(m.SLIDE_TEMPLATE_META) && m.SLIDE_TEMPLATE_META.length ? m.SLIDE_TEMPLATE_META : BLANK_SLIDE_META,
    }
    return slideLib
  } catch {
    return { build: {}, meta: BLANK_SLIDE_META } // 다음 요청에서 다시 시도한다
  }
}

// 슬라이드 카드 썸네일용: 첫 슬라이드의 제목 글과 배경색만 뽑는다(내용 전체는 보내지 않는다)
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/
function plainOf(v) {
  if (typeof v === 'string') return v.replace(/<\/(p|div|h[1-6]|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  if (v && typeof v === 'object') return excerpt(v, 200).replace(/\s+/g, ' ')
  return ''
}
export function slidePreview(slide, fallbackTitle = '', colors = null) {
  const els = Array.isArray(slide?.elements) ? slide.elements : []
  const palette = colors && typeof colors === 'object' ? colors : {}
  // 색은 "@accent" 같은 테마 토큰이거나 #RRGGBB다. 알 수 없으면 기본값
  const color = (v, dflt) => {
    const raw = typeof v === 'string' ? v.trim() : ''
    const val = raw.startsWith('@') ? palette[raw.slice(1)] : raw
    return typeof val === 'string' && COLOR_RE.test(val.trim()) ? val.trim() : dflt
  }
  const texts = els
    .map((el) => ({ el, text: plainOf(el?.data?.html ?? el?.data?.text ?? el?.text ?? el?.html ?? el?.content) }))
    .filter((x) => x.text)
  const size = (el) => Number(el?.style?.size ?? el?.style?.fontSize ?? el?.fontSize) || 0
  const titled = texts.find((x) => x.el?.role === 'title')
  const biggest = [...texts].sort((a, b) => size(b.el) - size(a.el))[0]
  const pick = titled || biggest
  const bg = color(typeof slide?.background === 'string' ? slide.background : slide?.background?.color, color('@bg', '#ffffff'))
  return { title: (pick?.text || fallbackTitle || '').slice(0, 80), bg, fg: color((pick?.el || els.find((el) => el?.role === 'title'))?.style?.color, color('@text', '#111111')) }
}
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
    // 심사채점표(나만 보기)도 이제 누구나 쓸 수 있다
    const strip = ({ siteOwnerOnly, ...m }) => m // eslint-disable-line no-unused-vars
    const slide = (await slideTemplates()).meta.map(({ id, name, sub }) => ({ id, name, sub: sub || '' }))
    res.json({ doc: DOC_TEMPLATE_META.map(strip), sheet: SHEET_TEMPLATE_META.map(strip), board: [{ id: 'blank', name: '빈 보드', sub: '' }], slide })
  })
)

/** 팀 id 파라미터. 숫자가 아니면 null */
const teamParam = (v) => {
  const n = parseInt(v, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

// 허브 목록은 구글 독스처럼 계정마다 빈 화면에서 시작한다.
//   내 목록(기본): 1. 내가 만든 파일  2. 이메일로 공유받은 파일  3. 링크로 열어 본 파일(최근, 지금도 열 수 있는 것만)
//   팀 목록(?team=<id>): 그 팀의 파일 중 내가 열 수 있는 것 전부(팀원만)
// ?trash=1 은 휴지통(내 목록이면 내가 지울 수 있던 파일, 팀 목록이면 그 팀 파일 중 내가 지울 수 있는 것).
router.get(
  '/workspace/files',
  wrap(async (req, res) => {
    const kind = LIST_KINDS.includes(req.query.kind) ? req.query.kind : 'doc'
    const idn = await identityOf(req, res)
    if (!idn.emails.length) return res.json({ items: [] })
    const trash = req.query.trash === '1'
    const team = teamParam(req.query.team)
    if (req.query.team !== undefined) {
      if (!team) return res.status(400).json({ error: 'invalid team' })
      if (!teamRoleOf(idn, team)) return res.status(403).json({ error: '팀원만 볼 수 있습니다' })
    }
    await purgeExpired().catch(() => {})
    // $1 kind, $2 trash, $3 team 또는 내 이메일 목록, $4 내 이름(소유자 이메일이 없는 예전 파일)
    const scope = team
      ? 'f.team_id = $3::int'
      : `(lower(f.owner_email) = ANY($3::text[])
          OR (f.owner_email IS NULL AND f.created_by = $4::text)
          OR EXISTS (SELECT 1 FROM ws_shares s WHERE s.ws_id = f.id AND lower(s.email) = ANY($3::text[]))
          OR (NOT $2::boolean AND EXISTS (SELECT 1 FROM ws_recent r WHERE r.ws_id = f.id AND r.email = ANY($3::text[]))))`
    const { rows } = await query(
      `SELECT f.id, f.kind, f.title, f.gated, f.created_by, f.owner_email, f.general_access, f.general_role, f.share_token, f.created_at, f.opened_at, f.owner_only, f.deleted_at, f.team_id,
              t.name AS team_name,
              GREATEST(f.updated_at, COALESCE((SELECT MAX(d.updated_at) FROM handover_docs d WHERE d.ws_id = f.id), f.updated_at)) AS updated_at,
              (SELECT d.id FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_tab,
              (SELECT d.content FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_content,
              (SELECT d.content_html FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_html,
              CASE WHEN f.kind = 'sheet' THEN f.content END AS sheet_content,
              CASE WHEN f.kind = 'board' THEN
                CASE WHEN jsonb_typeof(f.content->'canvases') = 'array'
                  THEN (SELECT COALESCE(SUM(jsonb_array_length(COALESCE(c->'items', '[]'::jsonb))), 0)::int FROM jsonb_array_elements(f.content->'canvases') c)
                  ELSE jsonb_array_length(COALESCE(f.content->'items', '[]'::jsonb)) END
              END AS board_items,
              CASE WHEN f.kind = 'slide' THEN f.content->'slides'->0 END AS first_slide,
              CASE WHEN f.kind = 'slide' THEN f.content->'theme'->'colors' END AS deck_colors,
              CASE WHEN f.kind = 'slide' AND jsonb_typeof(f.content->'slides') = 'array' THEN jsonb_array_length(f.content->'slides') END AS slide_count
         FROM ws_files f
         LEFT JOIN teams t ON t.id = f.team_id
        WHERE f.kind = $1
          AND (($2::boolean AND f.deleted_at IS NOT NULL) OR (NOT $2::boolean AND f.deleted_at IS NULL))
          AND ${scope}
        ORDER BY f.opened_at DESC, f.id DESC`,
      team ? [kind, trash, team] : [kind, trash, idn.emails, idn.staff?.name || '']
    )
    const items = []
    for (const r of rows) {
      const { first_content: fc, first_html: fh, sheet_content: sc, first_slide: fs, deck_colors: dc, share_token: _tok, ...rest } = r // eslint-disable-line no-unused-vars
      const probe = { ...r, deleted_at: null }
      if (trash) {
        if (!canManageTrash(idn, req.user, probe)) continue
      }
      const level = await levelFor(req, res, probe)
      if (!level) continue
      const base = {
        ...rest, my_role: level, mine: isOwnerOf(idn, probe),
        can_delete: canDeleteFile(idn, req.user, probe),
        ...(trash ? { trashed: true, days_left: daysLeft(r.deleted_at) } : {}),
      }
      if (r.kind === 'doc') {
        items.push({ ...base, excerpt: fc ? excerpt(fc) : String(fh || '').replace(/<\/(p|h[1-6]|li|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim().slice(0, 520) })
        continue
      }
      if (r.kind === 'board') {
        items.push({ ...base, items: r.board_items || 0 })
        continue
      }
      if (r.kind === 'slide') {
        items.push({ ...base, slide_count: r.slide_count || 0, slide_preview: slidePreview(fs, r.title, dc) })
        continue
      }
      const first = Array.isArray(sc?.sheets) ? sc.sheets[0] : sc
      const preview = (first?.rows || []).slice(0, 8).map((row) => (first.columns || []).slice(0, 6).map((c) => String(row.cells?.[c.key] ?? '')))
      items.push({ ...base, head: (first?.columns || []).slice(0, 6).map((c) => c.label), preview })
    }
    res.json({ items, team: team || null })
  })
)

/** 요청 본문의 team_id를 검사한다. 없으면 null, 팀원이 아니면 403을 보내고 undefined */
async function teamFromBody(req, res) {
  const raw = req.body?.team_id
  if (raw === undefined || raw === null || raw === '') return null
  const team = teamParam(raw)
  const idn = await identityOf(req, res)
  if (!team || !teamRoleOf(idn, team)) {
    res.status(403).json({ error: '내가 속한 팀에만 만들 수 있습니다' })
    return undefined
  }
  return team
}

router.post(
  '/workspace/files',
  signedIn,
  wrap(async (req, res) => {
    const kind = req.body?.kind
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be doc, sheet, board or slide' })
    const team = await teamFromBody(req, res)
    if (team === undefined) return
    const tpl = String(req.body?.template || 'blank')
    const slideLibNow = kind === 'slide' ? await slideTemplates() : null
    const meta = kind === 'doc' ? DOC_TEMPLATE_META : kind === 'sheet' ? SHEET_TEMPLATE_META : kind === 'slide' ? slideLibNow.meta : [{ id: 'blank', name: '빈 보드' }]
    const name = meta.find((m) => m.id === tpl)
    const blankTitle = kind === 'doc' ? '제목 없는 문서' : kind === 'sheet' ? '제목 없는 스프레드시트' : kind === 'slide' ? '제목 없는 프레젠테이션' : '제목 없는 보드'
    const title = String(req.body?.title || (tpl === 'blank' ? blankTitle : name?.name || '제목 없음')).slice(0, 200)
    const owner = lower(req.user?.email || req.publicUser?.email)
    const ownerName = req.user?.name || req.publicUser?.name || req.publicUser?.email
    // 팀 공간에서 만들면 팀원 모두 편집자로 시작한다
    const access = team ? 'team' : 'restricted'
    const role = team ? 'editor' : 'viewer'
    if (kind === 'doc') {
      const build = DOC_TEMPLATES[tpl] || DOC_TEMPLATES.blank
      const { rows } = await query(
        `INSERT INTO ws_files (kind, title, template, created_by, owner_email, share_token, team_id, general_access, general_role)
         VALUES ('doc', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [title, tpl, ownerName, owner, newToken(), team, access, role]
      )
      const f = rows[0]
      const tab = await query(
        `INSERT INTO handover_docs (title, content, content_html, sort, updated_by, ws_id)
         VALUES ('탭 1', $1::jsonb, '<p></p>', 0, $2, $3) RETURNING id`,
        [JSON.stringify(build()), ownerName, f.id]
      )
      return res.status(201).json({ item: { ...f, first_tab: tab.rows[0].id } })
    }
    if (kind === 'board') {
      const { rows } = await query(
        `INSERT INTO ws_files (kind, title, template, content, created_by, owner_email, share_token, team_id, general_access, general_role)
         VALUES ('board', $1, 'blank', $2::jsonb, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [title, JSON.stringify({ version: 1, items: [], connections: [] }), ownerName, owner, newToken(), team, access, role]
      )
      return res.status(201).json({ item: rows[0] })
    }
    if (kind === 'slide') {
      let content
      try {
        const fn = slideLibNow.build[tpl]
        content = typeof fn === 'function' ? fn() : BLANK_SLIDES()
      } catch (err) {
        console.error('[workspace] 슬라이드 템플릿 오류:', err.message)
        content = BLANK_SLIDES()
      }
      const { rows } = await query(
        `INSERT INTO ws_files (kind, title, template, content, created_by, owner_email, share_token, team_id, general_access, general_role)
         VALUES ('slide', $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, slideLibNow.build[tpl] ? tpl : 'blank', JSON.stringify(content), ownerName, owner, newToken(), team, access, role]
      )
      return res.status(201).json({ item: rows[0] })
    }
    const build = SHEET_TEMPLATES[tpl] || SHEET_TEMPLATES.blank
    // 심사채점표처럼 나만 보기 템플릿은 만든 사람만 열 수 있고 공유도 막힌다(팀 공간에서 만들어도 팀원에게 보이지 않음).
    const ownerOnly = Boolean(name?.ownerOnly)
    const { rows } = await query(
      `INSERT INTO ws_files (kind, title, template, content, created_by, owner_email, share_token, owner_only, team_id, general_access, general_role)
       VALUES ('sheet', $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [title, tpl, JSON.stringify(build()), ownerName, owner, newToken(), ownerOnly, team, ownerOnly ? 'restricted' : access, ownerOnly ? 'viewer' : role]
    )
    res.status(201).json({ item: rows[0] })
  })
)

// HTML로 문서 만들기(Notion 가져오기 등): 허용한 태그만 남긴 HTML을 첫 탭의 content_html로 저장한다.
// content는 비워 두며, 편집기가 content_html을 읽어 열고 처음 저장할 때 Tiptap JSON으로 바뀐다.
router.post(
  '/workspace/files/import-html',
  signedIn,
  wrap(async (req, res) => {
    const raw = typeof req.body?.html === 'string' ? req.body.html : ''
    if (!raw.trim()) return res.status(400).json({ error: '가져올 내용이 없습니다' })
    if (raw.length > 1_500_000) return res.status(413).json({ error: '내용이 너무 큽니다', hint: '페이지를 나누어 가져오세요.' })
    const team = await teamFromBody(req, res)
    if (team === undefined) return
    const html = sanitizeHtml(raw) || '<p></p>'
    const title = String(req.body?.title || '').trim().slice(0, 200) || '가져온 문서'
    const owner = lower(req.user?.email || req.publicUser?.email)
    const ownerName = req.user?.name || req.publicUser?.name || req.publicUser?.email
    const { rows } = await query(
      `INSERT INTO ws_files (kind, title, template, created_by, owner_email, share_token, team_id, general_access, general_role)
       VALUES ('doc', $1, 'blank', $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, ownerName, owner, newToken(), team, team ? 'team' : 'restricted', team ? 'editor' : 'viewer']
    )
    const f = rows[0]
    const tab = await query(
      `INSERT INTO handover_docs (title, content, content_html, sort, updated_by, ws_id)
       VALUES ('탭 1', NULL, $1, 0, $2, $3) RETURNING id`,
      [html, ownerName, f.id]
    )
    res.status(201).json({ item: { ...f, first_tab: tab.rows[0].id } })
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

// 삭제: 휴지통으로 옮긴다(30일 보관, 복원 가능). 파일 소유자, 팀 파일이면 그 팀의 오너도 할 수 있다.
router.delete(
  '/workspace/files/:id',
  signedIn,
  wrap(async (req, res) => {
    const f = await fileRow(pid(req))
    if (!f || f.deleted_at) return res.status(404).json({ error: 'not found' })
    const idn = await identityOf(req, res)
    if (!canDeleteFile(idn, req.user, f)) {
      const why = f.gated ? '인수인계 문서는 오너만 삭제할 수 있습니다' : f.owner_only ? '나만 보기 파일은 만든 사람만 삭제할 수 있습니다' : '파일을 만든 사람이나 팀 오너만 삭제할 수 있습니다'
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
    if (!canManageTrash(idn, req.user, f)) return res.status(403).json({ error: 'not allowed' })
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
    if (!canManageTrash(idn, req.user, f)) return res.status(403).json({ error: 'not allowed' })
    await purgeFile(f)
    res.json({ ok: true })
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
    await identityOf(req, res)
    let picture = null
    if (req.user) picture = (await query('SELECT picture FROM users WHERE id = $1', [req.user.id])).rows[0]?.picture || null
    else if (req.publicUser) picture = (await query('SELECT picture FROM public_users WHERE id = $1', [req.publicUser.id])).rows[0]?.picture || null
    if (req.user && !picture) picture = (await query('SELECT picture FROM public_users WHERE lower(email) = $1', [lower(req.user.email)])).rows[0]?.picture || null
    const u = req.user || req.publicUser
    res.json({ user: u ? { name: u.name, email: u.email, kind: req.user ? 'staff' : 'guest', picture } : null })
  })
)

// ── 공유 ──────────────────────────────────────────────────
async function profileOf(email) {
  const u = (await query('SELECT name, picture FROM users WHERE lower(email) = $1', [email])).rows[0]
  if (u) return u
  return (await query('SELECT name, picture FROM public_users WHERE lower(email) = $1', [email])).rows[0] || {}
}

async function shareState(file, idn = null) {
  const people = (await query('SELECT id, email, role FROM ws_shares WHERE ws_id = $1 ORDER BY created_at, id', [file.id])).rows
  const out = []
  for (const p of people) out.push({ ...p, ...(await profileOf(lower(p.email))) })
  const owner = file.owner_email ? { email: file.owner_email, ...(await profileOf(lower(file.owner_email))) } : { email: null, name: file.created_by || '' }
  if (!owner.name) owner.name = file.created_by || ''
  const team = file.team_id ? (await query('SELECT id, name FROM teams WHERE id = $1', [file.team_id])).rows[0] || null : null
  // 내가 속한 팀(파일을 옮길 수 있는 곳)
  const myTeams = idn?.teams?.size
    ? (await query('SELECT id, name FROM teams WHERE id = ANY($1::int[]) ORDER BY name, id', [[...idn.teams.keys()]])).rows
    : []
  return {
    id: file.id,
    kind: file.kind,
    title: file.title,
    // 예전 값(committee)은 제한됨으로 보인다. 팀이 없는데 team이면 제한됨과 같다
    general_access: GENERAL.includes(file.general_access) && !(file.general_access === 'team' && !team) ? file.general_access : 'restricted',
    general_role: file.general_role,
    share_token: file.share_token,
    short_code: (await query('SELECT short_code FROM ws_files WHERE id = $1', [file.id])).rows[0]?.short_code || null,
    owner_only: Boolean(file.owner_only),
    team,
    my_teams: myTeams,
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

// ── 짧은 공유 주소 ─────────────────────────────────────────────
// 링크가 있는 모든 사용자 공유 파일은 https://사이트/s/코드 로 공유한다. 긴 링크 키(?k=)와 편집기 경로를 숨겨 주소가 짧아진다.
const SHORT_PATH_RE = /^\/(?:docs|handover|sheets|boards|slides|hwp)\/\d+$|^\/form\/\d+\/edit$/
const newShortCode = () => crypto.randomBytes(9).toString('base64url').slice(0, 10)

router.post(
  '/workspace/files/:id/short',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file || blockOwnerOnly(file, res)) return
    const path = String(req.body?.path || '')
    if (!SHORT_PATH_RE.test(path)) return res.status(400).json({ error: 'invalid path' })
    if (file.general_access !== 'public') return res.status(409).json({ error: '링크가 있는 모든 사용자 공유일 때만 짧은 주소를 만듭니다' })
    const cur = (await query('SELECT short_code FROM ws_files WHERE id = $1', [file.id])).rows[0]
    if (cur?.short_code) {
      await query('UPDATE ws_files SET short_path = $1 WHERE id = $2', [path, file.id])
      return res.json({ code: cur.short_code })
    }
    for (let i = 0; i < 5; i++) {
      const code = newShortCode()
      try {
        await query('UPDATE ws_files SET short_code = $1, short_path = $2 WHERE id = $3', [code, path, file.id])
        return res.json({ code })
      } catch (err) {
        if (err?.code !== '23505') throw err
      }
    }
    res.status(500).json({ error: 'short code failed' })
  })
)

const shortLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })
router.get(
  '/workspace/s/:code',
  shortLimiter,
  wrap(async (req, res) => {
    const code = String(req.params.code || '')
    if (!/^[A-Za-z0-9_-]{6,16}$/.test(code)) return res.status(404).json({ error: 'not found' })
    const { rows } = await query(
      "SELECT short_path, share_token, general_access FROM ws_files WHERE short_code = $1 AND deleted_at IS NULL",
      [code]
    )
    const f = rows[0]
    if (!f || !f.short_path) return res.status(404).json({ error: 'not found' })
    // 링크 공유가 꺼졌다면 키를 주지 않는다(일반 권한 검사에 맡긴다)
    res.set('Cache-Control', 'no-store').json({ path: f.short_path, k: f.general_access === 'public' ? f.share_token : null })
  })
)

router.get(
  '/workspace/files/:id/share',
  wrap(async (req, res) => {
    const file = await loadFile(req, res)
    if (!file) return
    const idn = await identityOf(req, res)
    const state = await shareState(file, idn)
    if (req.fileLevel !== 'editor') {
      state.share_token = state.general_access === 'public' ? state.share_token : null
      state.short_code = state.general_access === 'public' ? state.short_code : null
      state.my_teams = []
    }
    res.json({ ...state, level: req.fileLevel })
  })
)

// 일반 액세스·권한·팀 바꾸기(편집자). team_id: 내가 속한 팀 id로 옮기거나 null로 팀에서 뺀다.
// 팀에서 빼면 일반 액세스가 팀이던 파일은 제한됨이 된다. 팀이 없는 파일은 팀 액세스로 바꿀 수 없다.
router.put(
  '/workspace/files/:id/share',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file || blockOwnerOnly(file, res)) return
    const idn = await identityOf(req, res)
    let access = req.body?.general_access
    const role = req.body?.general_role
    if (access !== undefined && !GENERAL.includes(access)) return res.status(400).json({ error: 'invalid general_access' })
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'invalid general_role' })
    let teamId = file.team_id
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'team_id')) {
      const raw = req.body.team_id
      if (raw === null || raw === '') teamId = null
      else {
        const t = teamParam(raw)
        if (!t || !teamRoleOf(idn, t)) return res.status(403).json({ error: '내가 속한 팀으로만 옮길 수 있습니다' })
        teamId = t
      }
    }
    const nextAccess = access ?? file.general_access
    if (nextAccess === 'team' && !teamId) {
      if (access === 'team') return res.status(400).json({ error: '팀에 속한 파일만 팀 액세스로 바꿀 수 있습니다' })
      access = 'restricted'
    }
    await query(
      'UPDATE ws_files SET general_access = COALESCE($1, general_access), general_role = COALESCE($2, general_role), team_id = $3 WHERE id = $4',
      [access ?? null, role ?? null, teamId, file.id]
    )
    if (req.body?.reset_link === true) {
      await query('UPDATE ws_files SET share_token = $1, short_code = NULL, short_path = NULL WHERE id = $2', [newToken(), file.id])
      // 예전 링크로 열어 둔 기록도 지운다(링크로만 들어온 사람은 새 링크가 있어야 다시 연다)
      await query('DELETE FROM ws_recent WHERE ws_id = $1', [file.id])
    }
    res.json({ ...(await shareState(await fileRow(file.id), idn)), level: 'editor' })
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
    res.status(201).json({ ...(await shareState(file, await identityOf(req, res))), level: 'editor' })
  })
)

router.put(
  '/workspace/files/:id/share/people/:sid',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    if (!ROLES.includes(req.body?.role)) return res.status(400).json({ error: 'invalid role' })
    await query('UPDATE ws_shares SET role = $1 WHERE id = $2 AND ws_id = $3', [req.body.role, parseInt(req.params.sid, 10), file.id])
    res.json({ ...(await shareState(file, await identityOf(req, res))), level: 'editor' })
  })
)

router.delete(
  '/workspace/files/:id/share/people/:sid',
  wrap(async (req, res) => {
    const file = await loadFile(req, res, 'editor')
    if (!file) return
    await query('DELETE FROM ws_shares WHERE id = $1 AND ws_id = $2', [parseInt(req.params.sid, 10), file.id])
    res.json({ ...(await shareState(file, await identityOf(req, res))), level: 'editor' })
  })
)

// ── 팀 ──────────────────────────────────────────────────
// 누구나 팀을 만들 수 있고 만든 사람이 팀 오너가 된다. 팀원 추가는 구글 이메일로 한다(메일은 보내지 않음.
// 그 이메일로 로그인하면 바로 팀원이다). 팀원 관리·이름 바꾸기·팀 삭제는 팀 오너만, 나가기는 누구나.
// 팀에는 오너가 한 명 이상 남아 있어야 한다.
const teamId = (req) => teamParam(req.params.id)
const myEmailOf = (idn) => idn.emails[0]

async function teamMembers(id) {
  const { rows } = await query(
    `SELECT m.email, m.role, m.added_by, m.created_at,
            COALESCE(u.name, p.name) AS name, COALESCE(u.picture, p.picture) AS picture,
            (u.id IS NOT NULL OR p.id IS NOT NULL) AS joined
       FROM team_members m
       LEFT JOIN users u ON lower(u.email) = lower(m.email)
       LEFT JOIN public_users p ON lower(p.email) = lower(m.email)
      WHERE m.team_id = $1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at, m.email`,
    [id]
  )
  // users와 public_users 양쪽에 있으면 같은 사람이 두 줄이 될 수 있어 이메일로 합친다
  const seen = new Map()
  for (const r of rows) if (!seen.has(lower(r.email))) seen.set(lower(r.email), r)
  return [...seen.values()]
}

async function teamDetail(id, idn) {
  const team = (await query('SELECT id, name, description, created_by, owner_email, created_at FROM teams WHERE id = $1', [id])).rows[0]
  if (!team) return null
  const members = await teamMembers(id)
  const files = (await query("SELECT kind, count(*)::int AS n FROM ws_files WHERE team_id = $1 AND deleted_at IS NULL GROUP BY kind", [id])).rows
  return { team: { ...team, my_role: teamRoleOf(idn, id), member_count: members.length, files: Object.fromEntries(files.map((f) => [f.kind, f.n])) }, members }
}

/** 팀을 찾고 내 역할을 확인한다. need = 'member' | 'owner' */
async function loadTeam(req, res, need = 'member') {
  const id = teamId(req)
  const idn = await identityOf(req, res)
  if (!id) { res.status(404).json({ error: 'not found' }); return null }
  const exists = (await query('SELECT 1 FROM teams WHERE id = $1', [id])).rows[0]
  if (!exists) { res.status(404).json({ error: 'not found' }); return null }
  const role = teamRoleOf(idn, id)
  if (!role) { res.status(403).json({ error: '팀원만 볼 수 있습니다' }); return null }
  if (need === 'owner' && role !== 'owner') { res.status(403).json({ error: '팀 오너만 할 수 있습니다' }); return null }
  return { id, idn, role }
}

function parseEmails(body) {
  const raw = Array.isArray(body?.emails) ? body.emails : String(body?.emails || body?.email || '').split(/[\s,;]+/)
  return [...new Set(raw.map(lower).filter(Boolean))]
}

async function ownerCount(id) {
  return (await query("SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND role = 'owner'", [id])).rows[0].n
}

/** teams.owner_email이 지금 오너 중 한 명을 가리키도록 맞춘다 */
async function syncTeamOwner(id) {
  await query(
    `UPDATE teams SET owner_email = sub.email FROM (
       SELECT email FROM team_members WHERE team_id = $1 AND role = 'owner' ORDER BY created_at, email LIMIT 1
     ) sub
     WHERE teams.id = $1 AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = $1 AND m.role = 'owner' AND lower(m.email) = lower(teams.owner_email))`,
    [id]
  )
}

router.get(
  '/workspace/teams',
  signedIn,
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const { rows } = await query(
      `SELECT t.id, t.name, t.description, t.owner_email, t.created_at,
              (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS member_count
         FROM teams t
        WHERE EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND lower(m.email) = ANY($1::text[]))
        ORDER BY t.name, t.id`,
      [idn.emails]
    )
    res.json({ items: rows.map((t) => ({ ...t, my_role: teamRoleOf(idn, t.id) })) })
  })
)

router.post(
  '/workspace/teams',
  signedIn,
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const name = String(req.body?.name || '').trim().slice(0, 60)
    if (!name) return res.status(400).json({ error: '팀 이름을 입력하세요' })
    const description = String(req.body?.description || '').trim().slice(0, 300) || null
    const emails = parseEmails(req.body).filter((e) => e !== myEmailOf(idn))
    if (emails.length > 100) return res.status(400).json({ error: 'too many' })
    const bad = emails.filter((e) => !EMAIL_RE.test(e))
    if (bad.length) return res.status(400).json({ error: '이메일 형식이 아닙니다', emails: bad })
    const me = myEmailOf(idn)
    const t = (await query('INSERT INTO teams (name, description, created_by, owner_email) VALUES ($1, $2, $3, $4) RETURNING id', [name, description, authorOf(req), me])).rows[0]
    await query("INSERT INTO team_members (team_id, email, role, added_by) VALUES ($1, $2, 'owner', $3)", [t.id, me, authorOf(req)])
    for (const e of emails) {
      await query("INSERT INTO team_members (team_id, email, role, added_by) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING", [t.id, e, authorOf(req)])
    }
    idn.teams.set(t.id, 'owner')
    res.status(201).json(await teamDetail(t.id, idn))
  })
)

router.get(
  '/workspace/teams/:id',
  signedIn,
  wrap(async (req, res) => {
    const t = await loadTeam(req, res)
    if (!t) return
    res.json(await teamDetail(t.id, t.idn))
  })
)

router.put(
  '/workspace/teams/:id',
  signedIn,
  wrap(async (req, res) => {
    const t = await loadTeam(req, res, 'owner')
    if (!t) return
    const name = req.body?.name === undefined ? null : String(req.body.name || '').trim().slice(0, 60)
    if (name === '') return res.status(400).json({ error: '팀 이름을 입력하세요' })
    const hasDesc = req.body?.description !== undefined
    const description = hasDesc ? String(req.body.description || '').trim().slice(0, 300) || null : null
    await query('UPDATE teams SET name = COALESCE($2, name), description = CASE WHEN $3 THEN $4 ELSE description END WHERE id = $1', [t.id, name, hasDesc, description])
    res.json(await teamDetail(t.id, t.idn))
  })
)

// 팀 삭제(팀 오너): 팀 파일은 그대로 남고 팀 연결만 풀린다. 팀 액세스였던 파일은 제한됨(소유자와 이메일 공유만)이 된다.
router.delete(
  '/workspace/teams/:id',
  signedIn,
  wrap(async (req, res) => {
    const t = await loadTeam(req, res, 'owner')
    if (!t) return
    const r = await query(
      "UPDATE ws_files SET team_id = NULL, general_access = CASE WHEN general_access = 'team' THEN 'restricted' ELSE general_access END WHERE team_id = $1",
      [t.id]
    )
    await query('DELETE FROM team_members WHERE team_id = $1', [t.id])
    await query('DELETE FROM teams WHERE id = $1', [t.id])
    res.json({ ok: true, files_unlinked: r.rowCount ?? 0 })
  })
)

router.post(
  '/workspace/teams/:id/members',
  signedIn,
  wrap(async (req, res) => {
    const t = await loadTeam(req, res, 'owner')
    if (!t) return
    const role = TEAM_ROLES.includes(req.body?.role) ? req.body.role : 'member'
    const emails = parseEmails(req.body)
    if (!emails.length) return res.status(400).json({ error: '이메일을 입력하세요' })
    if (emails.length > 100) return res.status(400).json({ error: 'too many' })
    const bad = emails.filter((e) => !EMAIL_RE.test(e))
    if (bad.length) return res.status(400).json({ error: '이메일 형식이 아닙니다', emails: bad })
    for (const e of emails) {
      // 이미 팀원이면 그대로 둔다(역할은 역할 바꾸기로)
      await query('INSERT INTO team_members (team_id, email, role, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [t.id, e, role, authorOf(req)])
    }
    res.status(201).json(await teamDetail(t.id, t.idn))
  })
)

router.put(
  '/workspace/teams/:id/members/:email',
  signedIn,
  wrap(async (req, res) => {
    const t = await loadTeam(req, res, 'owner')
    if (!t) return
    const email = lower(req.params.email)
    const role = req.body?.role
    if (!TEAM_ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' })
    const cur = (await query('SELECT role FROM team_members WHERE team_id = $1 AND lower(email) = $2', [t.id, email])).rows[0]
    if (!cur) return res.status(404).json({ error: '팀원이 아닙니다' })
    if (cur.role === 'owner' && role === 'member' && (await ownerCount(t.id)) <= 1) {
      return res.status(400).json({ error: '팀에는 오너가 한 명 이상 있어야 합니다', hint: '다른 팀원을 오너로 바꾼 뒤 다시 하세요.' })
    }
    await query('UPDATE team_members SET role = $3 WHERE team_id = $1 AND lower(email) = $2', [t.id, email, role])
    await syncTeamOwner(t.id)
    if (t.idn.emails.includes(email)) t.idn.teams.set(t.id, role)
    res.json(await teamDetail(t.id, t.idn))
  })
)

// 팀원 빼기: 팀 오너는 누구든, 팀원은 자기 자신만(나가기). 마지막 오너는 나갈 수 없다(팀 삭제를 쓴다).
async function removeMember(req, res, email) {
  const t = await loadTeam(req, res, 'member')
  if (!t) return
  const self = t.idn.emails.includes(email)
  if (!self && t.role !== 'owner') return res.status(403).json({ error: '팀 오너만 팀원을 뺄 수 있습니다' })
  const cur = (await query('SELECT role FROM team_members WHERE team_id = $1 AND lower(email) = $2', [t.id, email])).rows[0]
  if (!cur) return res.status(404).json({ error: '팀원이 아닙니다' })
  if (cur.role === 'owner' && (await ownerCount(t.id)) <= 1) {
    return res.status(400).json({ error: '팀에는 오너가 한 명 이상 있어야 합니다', hint: self ? '다른 팀원을 오너로 바꾸거나 팀을 삭제하세요.' : '' })
  }
  await query('DELETE FROM team_members WHERE team_id = $1 AND lower(email) = $2', [t.id, email])
  await syncTeamOwner(t.id)
  if (self) {
    t.idn.teams.delete(t.id)
    return res.json({ ok: true, left: true })
  }
  res.json(await teamDetail(t.id, t.idn))
}

router.delete(
  '/workspace/teams/:id/members/:email',
  signedIn,
  wrap(async (req, res) => removeMember(req, res, lower(req.params.email)))
)

// 팀 나가기(나 자신을 팀에서 뺀다)
router.post(
  '/workspace/teams/:id/leave',
  signedIn,
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const t = teamId(req)
    const mine = t ? (await query('SELECT email FROM team_members WHERE team_id = $1 AND lower(email) = ANY($2::text[]) LIMIT 1', [t, idn.emails])).rows[0] : null
    return removeMember(req, res, lower(mine?.email || myEmailOf(idn)))
  })
)

export default router
