// 한글 파일(kind='hwp') API. 계약은 hwpFiles.README.md. 논리는 lib/hwp/core.js, 저장은 lib/hwp/store.js.
import { Router } from 'express'
import multer from 'multer'
import { query } from '../db.js'
import { optionalAuth } from '../middleware/auth.js'
import { authorOf, canDeleteFile, fileRow, identityOf, levelFor, newToken, registerPurgeHook, teamRoleOf, touchRecent } from '../lib/wsAccess.js'
import { HwpError } from '../lib/hwp/kordoc.js'
import { ensureHwpSchema } from '../lib/hwpSchema.js'
import * as core from '../lib/hwp/core.js'
import * as store from '../lib/hwp/store.js'
import { inspectUpload, buildFromTemplate, templateInfo, LIMITS } from '../lib/hwp/service.js'
import { MAX_OPS } from '../lib/hwp/edit.js'
import { registerHwpTools } from '../lib/hwp/tools.js'
import { blobAuth, blobEnabled } from './upload.js'

const router = Router()
registerPurgeHook('hwp', store.purgeHwpFile)
registerHwpTools() // MCP: hwp_read_outline, hwp_edit ... (mcpTools 가 있을 때)

const MAX_SIMPLE_UPLOAD = 4 * 1024 * 1024
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIMPLE_UPLOAD, files: 1 } })
const lower = (v) => String(v || '').trim().toLowerCase()

const send = (res, status, code, message, extra = {}) => res.status(status).json({ error: { code, message, ...extra } })
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    if (e instanceof HwpError) return send(res, e.status, e.code, e.message, e.extra)
    if (e?.code === 'LIMIT_FILE_SIZE') return send(res, 413, 'TOO_LARGE', '4MB 넘는 파일은 직접 올릴 수 없습니다. 큰 파일 올리기(POST /blob/client-token → POST /hwp/files/import)를 쓰세요.')
    if (e?.code === 'DB_NOT_CONFIGURED') return next(e)
    if (e?.status === 503 && e?.hint) return send(res, 503, 'STORAGE', e.message)
    return next(e)
  })

router.use('/hwp', optionalAuth)
router.use(
  '/hwp',
  wrap(async (req, res, next) => {
    const idn = await identityOf(req, res)
    if (!idn.emails.length) return send(res, 401, 'LOGIN', '로그인이 필요합니다')
    await ensureHwpSchema().catch(() => {})
    next()
  })
)

/** 파일을 찾고 권한을 확인한다. 실패하면 응답을 보내고 null */
async function loadHwp(req, res, need = 'viewer') {
  const file = await fileRow(req.params.id)
  if (!file || file.kind !== 'hwp') { send(res, 404, 'NOT_FOUND', '파일을 찾을 수 없습니다'); return null }
  const level = await levelFor(req, res, file)
  if (!level) { send(res, 403, 'FORBIDDEN', '이 파일을 열 권한이 없습니다'); return null }
  if (need === 'editor' && level !== 'editor') { send(res, 403, 'FORBIDDEN', '이 파일을 고칠 권한이 없습니다'); return null }
  req.fileLevel = level
  // fileRow 는 content 를 가져오지 않는다(다른 종류에서는 크다). 한글 파일은 content 가 작은 메타라 여기서 붙인다.
  const extra = (await query('SELECT content, created_at, updated_at FROM ws_files WHERE id = $1', [file.id])).rows[0] || {}
  return { ...file, content: extra.content, created_at: extra.created_at, updated_at: extra.updated_at }
}

async function teamFrom(req, res) {
  const raw = req.body?.team_id
  if (raw === undefined || raw === null || raw === '') return null
  const team = parseInt(raw, 10)
  const idn = await identityOf(req, res)
  if (!Number.isInteger(team) || team < 1 || !teamRoleOf(idn, team)) throw new HwpError('FORBIDDEN', '내가 속한 팀에만 만들 수 있습니다', 403)
  return team
}

const ownerOf = (req) => lower(req.user?.email || req.publicUser?.email)
const whoOf = (req) => authorOf(req)

const created = (res, file, info, extra = {}) =>
  res.status(201).json({ item: core.fileInfo(file, 'editor'), warnings: info?.warnings || [], ...(info?.converted_from ? { converted_from: info.converted_from } : {}), ...extra })

// ── 목록 / 정보 ──────────────────────────────────────────────
router.get('/hwp/templates', wrap(async (req, res) => { res.json({ items: await templateInfo() }) }))

router.get(
  '/hwp/files',
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    const team = req.query.team !== undefined ? parseInt(req.query.team, 10) : null
    if (req.query.team !== undefined) {
      if (!team) return send(res, 400, 'BAD_REQUEST', 'team 이 올바르지 않습니다')
      if (!teamRoleOf(idn, team)) return send(res, 403, 'FORBIDDEN', '팀원만 볼 수 있습니다')
    }
    const trash = req.query.trash === '1'
    const scope = team
      ? 'f.team_id = $3::int'
      : `(lower(f.owner_email) = ANY($3::text[])
          OR (f.owner_email IS NULL AND f.created_by = $4::text)
          OR EXISTS (SELECT 1 FROM ws_shares s WHERE s.ws_id = f.id AND lower(s.email) = ANY($3::text[]))
          OR (NOT $2::boolean AND EXISTS (SELECT 1 FROM ws_recent r WHERE r.ws_id = f.id AND r.email = ANY($3::text[]))))`
    const { rows } = await query(
      `SELECT f.id, f.kind, f.title, f.content, f.created_by, f.owner_email, f.general_access, f.general_role, f.share_token, f.gated, f.form_id, f.last_edit, f.owner_only, f.deleted_at, f.team_id, f.created_at, f.updated_at, f.opened_at
         FROM ws_files f
        WHERE f.kind = $1
          AND (($2::boolean AND f.deleted_at IS NOT NULL) OR (NOT $2::boolean AND f.deleted_at IS NULL))
          AND ${scope}
        ORDER BY f.opened_at DESC, f.id DESC LIMIT 300`,
      team ? ['hwp', trash, team] : ['hwp', trash, idn.emails, idn.staff?.name || '']
    )
    const items = []
    for (const r of rows) {
      const probe = { ...r, deleted_at: null }
      const level = await levelFor(req, res, probe)
      if (!level) continue
      if (trash && !canDeleteFile(idn, req.user, probe)) continue
      items.push({ ...core.fileInfo(r, level), mine: level === 'editor' && lower(r.owner_email) === ownerOf(req) })
    }
    res.json({ items })
  })
)

router.get(
  '/hwp/files/:id',
  wrap(async (req, res) => {
    const file = await loadHwp(req, res)
    if (!file) return
    await touchRecent(req, res, file)
    if (req.fileLevel === 'editor') await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [file.id]).catch(() => {})
    res.json({ item: core.fileInfo(file, req.fileLevel), last_edit: file.last_edit || null })
  })
)

// ── 만들기 ───────────────────────────────────────────────────
router.post(
  '/hwp/files',
  (req, res, next) =>
    upload.single('file')(req, res, (e) => {
      if (!e) return next()
      if (e.code === 'LIMIT_FILE_SIZE') return send(res, 413, 'TOO_LARGE', '4MB 넘는 파일은 직접 올릴 수 없습니다. 큰 파일 올리기(POST /blob/client-token → POST /hwp/files/import)를 쓰세요.', { max_bytes: MAX_SIMPLE_UPLOAD })
      return send(res, 400, 'BAD_REQUEST', '파일을 읽지 못했습니다')
    }),
  wrap(async (req, res) => {
    if (!req.file) return send(res, 400, 'BAD_REQUEST', '파일 칸(file)이 없습니다')
    const team = await teamFrom(req, res)
    const name = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8')
    const bytes = new Uint8Array(req.file.buffer)
    const pre = await inspectUpload(bytes, name)
    const { file, info } = await core.createHwpFile({ bytes, filename: name, title: req.body?.title, who: whoOf(req), ownerEmail: ownerOf(req), team, pre, req })
    created(res, file, info)
  })
)

function blobUrlOk(u) {
  try {
    const url = new URL(String(u))
    return url.protocol === 'https:' && url.hostname.endsWith('.public.blob.vercel-storage.com') && url.pathname.startsWith('/dah/uploads/') ? url : null
  } catch { return null }
}

router.post(
  '/hwp/files/import',
  wrap(async (req, res) => {
    const url = blobUrlOk(req.body?.blob_url)
    if (!url) return send(res, 400, 'BAD_REQUEST', 'blob_url 이 우리 저장소의 /dah/uploads/ 아래 주소가 아닙니다')
    const team = await teamFrom(req, res)
    const r = await fetch(url.toString())
    if (!r.ok) return send(res, 400, 'BAD_REQUEST', '올린 파일을 읽지 못했습니다')
    const len = Number(r.headers.get('content-length') || 0)
    if (len > LIMITS.MAX_FILE_BYTES) return send(res, 413, 'TOO_LARGE', '파일이 너무 큽니다(25MB 이하)')
    const chunks = []
    let got = 0
    for await (const c of r.body) { got += c.length; if (got > LIMITS.MAX_FILE_BYTES) return send(res, 413, 'TOO_LARGE', '파일이 너무 큽니다(25MB 이하)'); chunks.push(c) }
    const bytes = new Uint8Array(Buffer.concat(chunks))
    try {
      const name = String(req.body?.filename || '')
      const pre = await inspectUpload(bytes, name)
      const { file, info } = await core.createHwpFile({ bytes, filename: name, title: req.body?.title, who: whoOf(req), ownerEmail: ownerOf(req), team, pre, req })
      created(res, file, info)
    } finally {
      // 임시 공개 파일은 보관하지 않는다(개인정보가 들어 있을 수 있다)
      if (blobEnabled()) import('@vercel/blob').then(({ del }) => del(url.toString(), blobAuth(req))).catch(() => {})
    }
  })
)

router.post(
  '/hwp/files/create',
  wrap(async (req, res) => {
    const team = await teamFrom(req, res)
    const t = await buildFromTemplate({ template: req.body?.template, values: req.body?.values, markdown: req.body?.markdown, preset: req.body?.preset, options: req.body?.options })
    const pre = await inspectUpload(t.bytes, 'new.hwpx')
    pre.warnings = [...t.warnings, ...pre.warnings]
    const { file, info } = await core.createHwpFile({ bytes: t.bytes, filename: 'new.hwpx', title: String(req.body?.title || t.title || '새 한글 문서').slice(0, 200), who: whoOf(req), ownerEmail: ownerOf(req), team, source: req.body?.template === 'markdown' ? 'markdown' : 'template', pre, req })
    created(res, file, info)
  })
)

// ── 읽기 ─────────────────────────────────────────────────────
const qv = (req) => (req.query.version ? Number(req.query.version) : undefined)

router.get('/hwp/files/:id/outline', wrap(async (req, res) => { const f = await loadHwp(req, res); if (f) res.json(await core.outline(f, qv(req))) }))
router.get('/hwp/files/:id/blocks', wrap(async (req, res) => { const f = await loadHwp(req, res); if (f) res.json(await core.blocksRange(f, qv(req), req.query.from, req.query.to ?? 200)) }))
router.get('/hwp/files/:id/fields', wrap(async (req, res) => { const f = await loadHwp(req, res); if (f) res.json(await core.fields(f, qv(req))) }))

router.get(
  '/hwp/files/:id/pages',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res)
    if (!f) return
    const as = req.query.format === 'png' ? 'png' : 'svg'
    res.json(await core.pages(f, { version: qv(req), from: req.query.from || 1, to: req.query.to || req.query.from || 1, as, scale: req.query.scale }))
  })
)

const immutable = (req) => (req.query.version ? 'private, max-age=31536000, immutable' : 'private, no-cache')
router.get(
  '/hwp/files/:id/pages/:n.svg',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res)
    if (!f) return
    const r = await core.pages(f, { version: qv(req), from: req.params.n, to: req.params.n, as: 'svg' })
    res.set('Content-Type', 'image/svg+xml; charset=utf-8').set('Cache-Control', immutable(req)).set('ETag', `"v${r.version}-p${req.params.n}"`).send(r.pages[0]?.svg || '')
  })
)
router.get(
  '/hwp/files/:id/pages/:n.png',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res)
    if (!f) return
    const r = await core.pages(f, { version: qv(req), from: req.params.n, to: req.params.n, as: 'png', scale: req.query.scale })
    const m = /^data:image\/png;base64,(.*)$/.exec(r.pages[0]?.image || '')
    res.set('Content-Type', 'image/png').set('Cache-Control', immutable(req)).send(Buffer.from(m?.[1] || '', 'base64'))
  })
)
router.get(
  '/hwp/files/:id/thumbs/:n.png',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res)
    if (!f) return
    const r = await core.pages(f, { version: qv(req), from: req.params.n, to: req.params.n, as: 'png', px: 240 })
    const m = /^data:image\/png;base64,(.*)$/.exec(r.pages[0]?.image || '')
    res.set('Content-Type', 'image/png').set('Cache-Control', immutable(req)).send(Buffer.from(m?.[1] || '', 'base64'))
  })
)

// ── 고치기 / 버전 ────────────────────────────────────────────
router.post(
  '/hwp/files/:id/edit',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res, 'editor')
    if (!f) return
    if (!Array.isArray(req.body?.ops) || !req.body.ops.length) return send(res, 400, 'BAD_REQUEST', '편집할 연산(ops)이 없습니다')
    if (req.body.ops.length > MAX_OPS) return send(res, 400, 'BAD_REQUEST', `한 번에 ${MAX_OPS}개까지 편집할 수 있습니다`)
    res.json(await core.edit(f, req.body, { who: whoOf(req), req }))
  })
)

router.get(
  '/hwp/files/:id/versions',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res)
    if (!f) return
    const rows = await store.listVersions(f.id)
    res.json({ current: core.currentVersionOf(f), items: rows.map((r) => ({ version: r.version, created_at: r.created_at, created_by: r.created_by, note: r.note, size: r.size, source: r.source, starred: r.starred, parent_version: r.parent_version, diff_summary: r.diff_summary, page_count: r.page_count })) })
  })
)
router.post('/hwp/files/:id/versions/:v/restore', wrap(async (req, res) => { const f = await loadHwp(req, res, 'editor'); if (f) res.json(await core.restore(f, req.params.v, { who: whoOf(req), req })) }))
router.post(
  '/hwp/files/:id/versions/:v/star',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res, 'editor')
    if (!f) return
    const ok = await store.starVersion(f.id, Number(req.params.v), req.body?.starred !== false)
    if (!ok) return send(res, 404, 'NOT_FOUND', '그 버전을 찾을 수 없습니다')
    res.json({ ok: true, version: Number(req.params.v), starred: req.body?.starred !== false })
  })
)
router.get(
  '/hwp/files/:id/versions/:v/download',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res)
    if (!f) return
    const x = await core.exportAs(f, core.contentOf(f).format || 'hwpx', Number(req.params.v))
    sendFile(res, x)
  })
)

function sendFile(res, x) {
  res.set('Content-Type', x.mime)
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(x.name)}`)
  if (x.approximate) res.set('X-Hwp-Approximate', '1')
  res.set('Cache-Control', 'private, no-store')
  res.send(Buffer.from(x.bytes))
}

// ── 분석 / 내보내기 ──────────────────────────────────────────
router.get('/hwp/files/:id/lint', wrap(async (req, res) => { const f = await loadHwp(req, res); if (f) res.json(await core.lint(f, { version: qv(req), numbers: req.query.numbers === '1', styles: req.query.styles === '1' })) }))
router.get('/hwp/files/:id/compare', wrap(async (req, res) => {
  const f = await loadHwp(req, res)
  if (!f) return
  const to = req.query.to ? Number(req.query.to) : undefined
  if (!to) return send(res, 400, 'BAD_REQUEST', 'to(비교할 버전)가 필요합니다')
  res.json(await core.compare(f, { from: req.query.from ? Number(req.query.from) : undefined, to }))
}))
router.get('/hwp/files/:id/redaction-suggest', wrap(async (req, res) => { const f = await loadHwp(req, res); if (f) res.json(await core.redactionSuggest(f, qv(req))) }))
router.get('/hwp/files/:id/export', wrap(async (req, res) => { const f = await loadHwp(req, res); if (f) sendFile(res, await core.exportAs(f, String(req.query.format || core.contentOf(f).format), qv(req))) }))

router.post(
  '/hwp/files/:id/convert-to-docs',
  wrap(async (req, res) => {
    const f = await loadHwp(req, res)
    if (!f) return
    const team = await teamFrom(req, res)
    const t = await core.toDocsContent(f, qv(req))
    let json = JSON.stringify(t.doc)
    const warnings = t.issues.map((i) => i.msg)
    if (t.approximate) warnings.push('HWP(5.x) 파일은 내용만 옮겨져 서식이 달라질 수 있습니다.')
    if (json.length > 3_500_000) {
      const strip = (n) => { if (Array.isArray(n)) return n.filter((x) => x?.type !== 'image').map(strip); if (n && typeof n === 'object') { const o = {}; for (const [k, v] of Object.entries(n)) o[k] = strip(v); return o } return n }
      json = JSON.stringify(strip(t.doc))
      warnings.push('문서가 너무 커서 그림을 뺐습니다.')
      if (json.length > 4_000_000) return send(res, 413, 'TOO_LARGE', '문서가 너무 커서 옮길 수 없습니다')
    }
    const owner = ownerOf(req)
    const ownerName = whoOf(req)
    const access = team ? 'team' : 'restricted'
    const role = team ? 'editor' : 'viewer'
    const { rows } = await query(
      `INSERT INTO ws_files (kind, title, template, created_by, owner_email, share_token, team_id, general_access, general_role)
       VALUES ('doc', $1, 'blank', $2, $3, $4, $5, $6, $7) RETURNING *`,
      [`${f.title} (문서로 옮김)`.slice(0, 200), ownerName, owner, newToken(), team, access, role]
    )
    const d = rows[0]
    const tab = await query(`INSERT INTO handover_docs (title, content, content_html, sort, updated_by, ws_id) VALUES ('탭 1', $1::jsonb, '<p></p>', 0, $2, $3) RETURNING id`, [json, ownerName, d.id])
    res.status(201).json({ item: { id: d.id, kind: 'doc', title: d.title, first_tab: tab.rows[0].id }, warnings })
  })
)

export default router
