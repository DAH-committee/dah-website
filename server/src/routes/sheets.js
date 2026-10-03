// src/routes/sheets.js: 관리자 시트(전시회 접수 관리 시트) 편집 API
//   PUT    /admin/exhibition/entries/:id        접수 1건의 칸 고치기(fields는 얕게 합친다)
//   POST   /admin/exhibition/entries            빈 접수 1건 추가
//   POST   /admin/exhibition/entries/delete     선택한 접수 지우기(ids)
//   GET/PUT /admin/sheets/:key/state            열 너비, 숨긴 열, 서식, 메모 열 같은 화면 상태
//   POST   /admin/sheets/export-google          표를 연결된 드라이브에 구글 시트로 만들기
// 접수 전체 초기화(DELETE /admin/exhibition/entries, owner)는 adminExtra.js에 그대로 있다.
import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { wrap } from './content.js'
import { driveFor, resolveConnection } from '../lib/driveConnections.js'
import { createGoogleSheet } from '../lib/sheetExport.js'

const router = Router()

const ENTRY_COLS = 'id, semester_label, entry_type, fields, email, images, created_at, updated_at'
const KEY_RE = /^[A-Za-z0-9_.\-가-힣]{1,60}$/
const STATE_KEY_RE = /^[a-z0-9\-_:]{1,60}$/
const MAX_CELL = 4000
const MAX_STATE_BYTES = 200_000
const MAX_DELETE = 200

/** 고칠 수 있는 칸만 걸러낸다. 파일 목록과 객체는 이 화면에서 고치지 않는다 */
export function cleanFieldPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'fields must be an object' }
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!KEY_RE.test(key)) return { error: `invalid field key: ${key}` }
    if (key === 'original_files' || key === 'members') return { error: `${key} cannot be edited here` }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      return { error: `field ${key} must be text` }
    }
    const text = value == null ? '' : String(value)
    if (text.length > MAX_CELL) return { error: `field ${key} is too long` }
    out[key] = text
  }
  return { value: out }
}

router.put(
  '/admin/exhibition/entries/:id',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' })
    const body = req.body || {}
    let patch = {}
    if (body.fields !== undefined) {
      const cleaned = cleanFieldPatch(body.fields)
      if (cleaned.error) return res.status(400).json({ error: cleaned.error })
      patch = cleaned.value
    }
    const email = body.email === undefined ? null : String(body.email).trim().toLowerCase().slice(0, 200)
    const semester = body.semester_label === undefined ? null : String(body.semester_label).trim().slice(0, 60)
    if (!Object.keys(patch).length && email === null && semester === null) {
      return res.status(400).json({ error: 'nothing to update' })
    }
    const { rows } = await query(
      `UPDATE exhibition_entries
       SET fields = COALESCE(fields, '{}'::jsonb) || $1::jsonb,
           email = COALESCE($2, email),
           semester_label = COALESCE($3, semester_label),
           updated_at = now()
       WHERE id = $4
       RETURNING ${ENTRY_COLS}`,
      [JSON.stringify(patch), email, semester, id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ entry: rows[0] })
  })
)

router.post(
  '/admin/exhibition/entries',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const body = req.body || {}
    const entryType = body.entry_type === 'team' ? 'team' : 'solo'
    const semester = String(body.semester_label ?? '').trim().slice(0, 60)
    const { rows } = await query(
      `INSERT INTO exhibition_entries (semester_label, entry_type, fields, email, images)
       VALUES ($1, $2, '{}'::jsonb, '', '[]'::jsonb)
       RETURNING ${ENTRY_COLS}`,
      [semester, entryType]
    )
    res.status(201).json({ entry: rows[0] })
  })
)

router.post(
  '/admin/exhibition/entries/delete',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map((v) => parseInt(v, 10)))] : []
    if (!ids.length || ids.some((v) => !Number.isInteger(v))) return res.status(400).json({ error: 'ids required' })
    if (ids.length > MAX_DELETE) return res.status(400).json({ error: `at most ${MAX_DELETE} rows at once` })
    const result = await query('DELETE FROM exhibition_entries WHERE id = ANY($1::int[])', [ids])
    res.json({ ok: true, deleted: result.rowCount ?? 0 })
  })
)

router.get(
  '/admin/sheets/:key/state',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    if (!STATE_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'invalid key' })
    const { rows } = await query('SELECT value, updated_at FROM admin_sheet_state WHERE key = $1', [req.params.key])
    res.json({ state: rows[0]?.value ?? null, updated_at: rows[0]?.updated_at ?? null })
  })
)

router.put(
  '/admin/sheets/:key/state',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    if (!STATE_KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'invalid key' })
    const state = req.body?.state
    if (!state || typeof state !== 'object' || Array.isArray(state)) return res.status(400).json({ error: 'state must be an object' })
    const text = JSON.stringify(state)
    if (text.length > MAX_STATE_BYTES) return res.status(413).json({ error: 'state too large' })
    await query(
      `INSERT INTO admin_sheet_state (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [req.params.key, text]
    )
    res.json({ ok: true })
  })
)

router.post(
  '/admin/sheets/export-google',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    let connection
    try {
      connection = await resolveConnection({ connectionId: req.body?.connection_id ?? null })
    } catch (err) {
      return res.status(err.status || 409).json({ error: err.message, code: err.code })
    }
    try {
      const drive = await driveFor(connection)
      const parentId = String(req.body?.parent_id || connection.root_folder_id || '')
      const sheet = await createGoogleSheet({ drive, name: req.body?.name, values: req.body?.values, parentId })
      res.status(201).json({ sheet, account_email: connection.account_email || null })
    } catch (err) {
      // 릴레이가 아직 구버전이면 알 수 없는 동작이라 400이 온다. 화면이 클립보드 방식으로 넘어가게 코드를 붙인다.
      const unsupported = /알 수 없는 action/.test(String(err.message))
      res.status(unsupported ? 501 : err.status || 502).json({
        error: unsupported ? '연결된 드라이브가 구글 시트 만들기를 아직 지원하지 않습니다.' : err.message,
        code: unsupported ? 'relay_outdated' : err.code || 'sheet_export_failed',
      })
    }
  })
)

export default router
