// src/routes/driveAdmin.js — 관리 → 저장소 → Google Drive (53_DRIVE_STORAGE)
//
// 다음 운영진이 코드를 고치지 않고 "자기 Google 계정을 연결하고, 루트 폴더를 고르고, 폴더를 만들고,
// 테스트 파일을 올려보는" 것까지 이 라우트들로 끝나야 한다.
//
//  GET    /admin/drive/status                     연결 목록·환경 설정 상태 (manager)
//  POST   /admin/drive/connect-url                구글 동의 URL 발급 (owner)
//  GET    /auth/google/drive/callback             code 교환 → 암호화 토큰 저장 (구글이 호출)
//  POST   /admin/drive/connections/:id/check      연결 점검 (manager)
//  PUT    /admin/drive/connections/:id            라벨·루트 폴더·활성 상태 (owner)
//  DELETE /admin/drive/connections/:id            연결 해제 = 토큰 폐기 (owner, Drive 파일은 보존)
//  POST   /admin/drive/preview                    폴더 구조 미리보기 (manager)
//  POST   /admin/drive/prepare                    누락 폴더 준비 (manager)
//  POST   /admin/drive/test-upload                테스트 파일 업로드 (manager)
//  GET    /admin/drive/uploads                    업로드 기록 / 미연결 업로드 (manager)
//  DELETE /admin/drive/uploads/:id                기록 삭제 표시 (owner, 자동 삭제 없음)
//
// 토큰·암호문은 어떤 응답에도 넣지 않는다. 연결 정보는 전부 sanitizeConnection()을 통과한 모양만 나간다.
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { requireAuth, requireRole, jwtSecret } from '../middleware/auth.js'
import { wrap } from './content.js'
import {
  aboutAccount,
  driveScope,
  folderIdFrom,
  oauthAppCredentials,
  probeFolder,
  uploadFile,
} from '../lib/googleDrive.js'
import {
  ENV_CONNECTION_ID,
  checkConnection,
  createConnection,
  disconnectConnection,
  driveFor,
  ensurePath,
  formsUsingConnection,
  getConnectionRow,
  listConnections,
  listUploads,
  markUploadDeleted,
  resolveConnection,
  resolveRootFolderId,
  sanitizeConnection,
  updateConnection,
} from '../lib/driveConnections.js'
import { isSecretBoxConfigured } from '../lib/secretBox.js'
import { preflightForm } from '../lib/drivePreflight.js'
import {
  PATH_TEMPLATES,
  buildFolderSegments,
  findCourseField,
  normalizeFileStorage,
} from '../lib/formStorage.js'

const router = Router()

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const STATE_TTL_SEC = 10 * 60
export const TEST_FOLDER_NAME = '_DAH_INTEGRATION_TEST'

function clientOrigin() {
  const first = process.env.CLIENT_ORIGIN?.split(',')[0]?.trim()
  return (first || 'http://localhost:5173').replace(/\/+$/, '')
}

function notConfigured() {
  const err = new Error('Google Drive OAuth 앱 설정이 없습니다.')
  err.status = 503
  err.hint = 'Render 환경변수 GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI를 설정한 뒤 재배포하세요.'
  return err
}

async function formById(id) {
  const { rows } = await query('SELECT * FROM custom_forms WHERE id = $1', [id])
  return rows[0] || null
}

/** 폼 + 파일 질문 + 저장소 설정을 한 번에 꺼낸다. 경로 계산의 입력은 항상 저장된 값이다 */
async function fileFieldContext(formId, fieldId) {
  const form = await formById(formId)
  if (!form) {
    const err = new Error('폼을 찾을 수 없습니다.')
    err.status = 404
    throw err
  }
  const fields = Array.isArray(form.fields) ? form.fields : []
  const field = fields.find((f) => f?.id === fieldId && f?.type === 'file')
  if (!field) {
    const err = new Error('파일 업로드 질문을 찾을 수 없습니다.')
    err.status = 404
    throw err
  }
  const storage = normalizeFileStorage(field.storage, form.settings || {})
  return { form, field, storage }
}

// ── 상태 ───────────────────────────────────────────────────

router.get(
  '/admin/drive/status',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const connections = await listConnections()
    const pending = await query(
      "SELECT COUNT(*)::int AS n FROM form_file_uploads WHERE status = 'pending'"
    )
    res.json({
      connections,
      templates: Object.entries(PATH_TEMPLATES).map(([value, t]) => ({
        value,
        label: t.label,
        needs_course: t.needsCourse,
        needs_semester: t.needsSemester,
      })),
      config: {
        oauth_app_ready: Boolean(oauthAppCredentials()),
        encryption_ready: isSecretBoxConfigured(),
        scope: driveScope(),
        redirect_uri: process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim() || '',
      },
      pending_uploads: pending.rows[0]?.n ?? 0,
    })
  })
)

router.get(
  '/admin/drive/connections/:id/forms',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    res.json({ items: await formsUsingConnection(req.params.id) })
  })
)

// ── 계정 연결 ──────────────────────────────────────────────

router.post(
  '/admin/drive/connect-url',
  requireAuth,
  requireRole('owner'),
  wrap(async (req, res) => {
    const app = oauthAppCredentials()
    if (!app) throw notConfigured()
    if (!isSecretBoxConfigured()) {
      return res.status(503).json({
        error: 'DRIVE_TOKEN_ENC_KEY가 없어 연결 토큰을 저장할 수 없습니다.',
        hint: 'Render 환경변수에 DRIVE_TOKEN_ENC_KEY(32바이트 랜덤값 base64)를 추가한 뒤 재배포하세요.',
      })
    }
    const label = String(req.body?.label || '').slice(0, 80)
    const state = jwt.sign({ purpose: 'drive-connect', uid: req.user.id, label }, jwtSecret(), {
      expiresIn: STATE_TTL_SEC,
    })
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      response_type: 'code',
      scope: driveScope(),
      state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })
    res.json({ url: `${AUTH_ENDPOINT}?${params.toString()}`, redirect_uri: app.redirectUri })
  })
)

// 구글이 직접 호출한다. 여기서 refresh token을 받아 봉인해 저장하고 관리 화면으로 되돌린다.
router.get(
  '/auth/google/drive/callback',
  wrap(async (req, res) => {
    const app = oauthAppCredentials()
    if (!app) throw notConfigured()
    const back = (params) => res.redirect(`${clientOrigin()}/admin/storage/drive?${new URLSearchParams(params)}`)

    if (req.query.error) return back({ drive_error: 'consent_cancelled' })

    let state = null
    try {
      state = jwt.verify(String(req.query.state || ''), jwtSecret())
    } catch {
      state = null
    }
    if (!state || state.purpose !== 'drive-connect') return back({ drive_error: 'invalid_state' })

    const code = String(req.query.code || '')
    if (!code) return back({ drive_error: 'missing_code' })

    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: app.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) {
      console.error('[drive] 토큰 교환 실패:', tokenRes.status)
      return back({ drive_error: 'token_exchange_failed' })
    }
    const token = await tokenRes.json()
    if (!token.refresh_token) {
      // 이미 승인된 계정이라 refresh token이 오지 않은 경우 — 계정 권한 페이지에서 접근 권한을 지운 뒤 재시도
      return back({ drive_error: 'no_refresh_token' })
    }

    // 계정 이메일은 Drive에게 직접 묻는다(추가 스코프 없이 about.get으로 확인 가능).
    let email = ''
    try {
      const { createDriveClient } = await import('../lib/googleDrive.js')
      const drive = await createDriveClient({
        mode: 'oauth',
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        refreshToken: token.refresh_token,
      })
      email = (await aboutAccount(drive)).email
    } catch (err) {
      console.error('[drive] 계정 조회 실패:', err.message)
    }

    const row = await createConnection({
      label: state.label || (email ? `${email} Drive` : 'Google Drive 연결'),
      accountEmail: email,
      refreshToken: token.refresh_token,
      scope: token.scope || driveScope(),
      createdBy: state.uid ?? null,
    })
    return back({ drive: 'connected', connection: String(row?.id ?? '') })
  })
)

router.post(
  '/admin/drive/connections/:id/check',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const row = await getConnectionRow(req.params.id)
    if (!row) return res.status(404).json({ error: '연결을 찾을 수 없습니다.' })
    const rootFolderId = req.body?.root_folder_id ? folderIdFrom(req.body.root_folder_id) : ''
    const result = await checkConnection(row, { rootFolderId })
    const fresh = await getConnectionRow(req.params.id)
    res.json({
      ok: result.ok,
      error: result.error,
      account: result.account ? { email: result.account.email, name: result.account.name, quota: result.account.quota } : null,
      root: result.root,
      connection: sanitizeConnection(fresh),
    })
  })
)

router.put(
  '/admin/drive/connections/:id',
  requireAuth,
  requireRole('owner'),
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (id === ENV_CONNECTION_ID) {
      return res.status(400).json({ error: '환경변수 연결은 화면에서 수정할 수 없습니다. Render 환경변수를 사용하세요.' })
    }
    const row = await getConnectionRow(id)
    if (!row) return res.status(404).json({ error: '연결을 찾을 수 없습니다.' })

    const patch = {}
    if (req.body?.label !== undefined) patch.label = req.body.label
    if (req.body?.active !== undefined) patch.active = req.body.active

    // 루트 폴더를 바꿀 때는 반드시 접근 가능 여부를 먼저 확인한다(조용히 다른 폴더로 업로드하지 않는다).
    if (req.body?.root_folder_id !== undefined) {
      const rootFolderId = folderIdFrom(req.body.root_folder_id)
      if (req.body.root_folder_id && !rootFolderId) {
        return res.status(400).json({ error: 'Drive 폴더 URL 또는 ID 형식이 아닙니다.' })
      }
      if (rootFolderId) {
        const drive = await driveFor(row)
        const probe = await probeFolder(drive, rootFolderId)
        if (!probe.ok) {
          return res.status(409).json({
            error: probe.message || '이 계정은 해당 폴더에 접근할 수 없습니다.',
            reason: probe.reason,
            hint: '폴더를 이 계정에 편집자로 공유한 뒤 다시 시도하거나, 새 루트 폴더를 선택하세요.',
          })
        }
        patch.rootFolderId = probe.id
        patch.rootFolderName = probe.name
      } else {
        patch.rootFolderId = ''
        patch.rootFolderName = ''
      }
    }

    const updated = await updateConnection(id, patch)
    res.json({ connection: sanitizeConnection(updated) })
  })
)

router.delete(
  '/admin/drive/connections/:id',
  requireAuth,
  requireRole('owner'),
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (id === ENV_CONNECTION_ID) {
      return res.status(400).json({ error: '환경변수 연결은 화면에서 해제할 수 없습니다.' })
    }
    const row = await disconnectConnection(id)
    if (!row) return res.status(404).json({ error: '연결을 찾을 수 없습니다.' })
    // Drive 안의 파일·폴더는 그대로 둔다. 토큰만 폐기한다.
    res.json({ connection: sanitizeConnection(row), files_kept: true })
  })
)

// ── 루트 폴더 생성 (구조 미리보기 → 확인 → 생성) ──────────────

router.post(
  '/admin/drive/connections/:id/root-folder',
  requireAuth,
  requireRole('owner'),
  wrap(async (req, res) => {
    const row = await getConnectionRow(req.params.id)
    if (!row) return res.status(404).json({ error: '연결을 찾을 수 없습니다.' })
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: '만들 루트 폴더 이름이 필요합니다.' })
    const parentId = req.body?.parent_id ? folderIdFrom(req.body.parent_id) : 'root'
    const drive = await driveFor(row)
    const { ensureFolderPath } = await import('../lib/googleDrive.js')
    const result = await ensureFolderPath(drive, {
      rootFolderId: parentId || 'root',
      segments: [name],
      dryRun: req.body?.dry_run === true,
    })
    if (req.body?.dry_run === true) {
      return res.json({ preview: result.steps, parent_id: parentId || 'root' })
    }
    const probe = await probeFolder(drive, result.folderId)
    const updated = await updateConnection(row.id, {
      rootFolderId: result.folderId,
      rootFolderName: probe.name || name,
    })
    res.status(201).json({ connection: sanitizeConnection(updated), root: probe, steps: result.steps })
  })
)

// ── 폼 경로 미리보기 / 준비 / 테스트 업로드 ───────────────────

router.post(
  '/admin/drive/preview',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const form = await formById(req.body?.form_id)
    if (!form) return res.status(404).json({ error: '폼을 찾을 수 없습니다.' })
    const result = await preflightForm(form, { deep: req.body?.deep !== false })
    res.json(result)
  })
)

router.post(
  '/admin/drive/prepare',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { form, field, storage } = await fileFieldContext(req.body?.form_id, String(req.body?.field_id || ''))
    if (storage.target !== 'drive') {
      return res.status(400).json({ error: '이 파일 질문은 Google Drive로 보내도록 설정되지 않았습니다.' })
    }
    const connection = await resolveConnection({
      connectionId: storage.connection_id ?? (Number(form.settings?.drive_connection_id) || null),
    })
    const { rootFolderId } = resolveRootFolderId({ connection, formSettings: form.settings || {} })

    const template = PATH_TEMPLATES[storage.path_template]
    // 과목명은 클라이언트가 임의로 보낼 수 없다 — 저장된 과목 질문의 보기 목록에 있는 값만 통과한다.
    let course = ''
    if (template?.needsCourse) {
      const requested = String(req.body?.course || '').trim()
      if (requested) {
        const courseField = findCourseField(form)
        const options = Array.isArray(courseField?.options) ? courseField.options.map(String) : []
        if (!options.includes(requested)) {
          return res.status(400).json({ error: '저장된 과목 보기 목록에 없는 값입니다.' })
        }
        course = requested
      }
    }

    // 과목을 지정하지 않으면 과목 위 단계까지만 만든다(과목 폴더는 제출 시점에 생긴다).
    const built = buildFolderSegments({ form, field, storage, course, placeholders: true })
    if (!built.ok) {
      return res.status(422).json({ error: '경로를 만들 수 없습니다.', reason: built.reason })
    }
    const placeholderAt = built.segments.indexOf('(과목명)')
    const segments = placeholderAt >= 0 ? built.segments.slice(0, placeholderAt) : built.segments
    const result = await ensurePath({ connection, rootFolderId, segments })
    res.status(201).json({
      folder_id: result.folderId,
      folder_url: result.folderId ? `https://drive.google.com/drive/folders/${result.folderId}` : '',
      segments,
      planned_segments: built.segments,
      steps: result.steps,
      duplicates: result.duplicates,
      cached: result.cached,
      connection: sanitizeConnection(connection),
    })
  })
)

router.post(
  '/admin/drive/test-upload',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const connection = await resolveConnection({ connectionId: req.body?.connection_id ?? null })
    const { rootFolderId } = resolveRootFolderId({ connection, formSettings: {} })
    if (!rootFolderId) return res.status(409).json({ error: '루트 폴더가 지정되지 않았습니다.' })
    const drive = await driveFor(connection)
    // 테스트 산출물은 이름으로 구분되는 별도 폴더에만 넣는다. 기존 폴더를 건드리지 않는다.
    const { folderId } = await ensurePath({
      connection,
      rootFolderId,
      segments: [TEST_FOLDER_NAME],
      drive,
    })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const body = `DAH 웹사이트 Drive 연동 점검\n요청자: ${req.user.email}\n시각: ${new Date().toISOString()}\n`
    const saved = await uploadFile(drive, {
      folderId,
      buffer: Buffer.from(body, 'utf8'),
      filename: `connection-test-${stamp}.txt`,
      mimeType: 'text/plain',
      shareMode: 'restricted',
      originalName: `connection-test-${stamp}.txt`,
      properties: { dahTest: 'true', requestedBy: req.user.email },
    })
    res.status(201).json({
      file: { id: saved.id, name: saved.name, url: saved.url, bytes: saved.bytes },
      folder_id: folderId,
      folder_name: TEST_FOLDER_NAME,
      folder_url: `https://drive.google.com/drive/folders/${folderId}`,
      note: '테스트 파일은 자동으로 지우지 않습니다. 확인 후 직접 삭제하세요.',
    })
  })
)

// ── 업로드 기록 ────────────────────────────────────────────

router.get(
  '/admin/drive/uploads',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const status = ['pending', 'attached', 'deleted', 'all'].includes(String(req.query.status))
      ? String(req.query.status)
      : 'pending'
    const formId = req.query.form_id ? Number(req.query.form_id) : null
    const items = await listUploads({ status, formId })
    res.json({
      items: items.map((row) => ({
        id: row.id,
        form_id: row.form_id,
        form_title: row.form_title,
        form_slug: row.form_slug,
        field_id: row.field_id,
        response_id: row.response_id,
        submitter_email: row.submitter_email,
        storage: row.storage,
        purpose: row.purpose,
        connection_id: row.connection_id,
        drive_file_id: row.drive_file_id,
        file_url: row.file_url,
        folder_id: row.folder_id,
        original_name: row.original_name,
        stored_name: row.stored_name,
        mime: row.mime,
        bytes: Number(row.bytes || 0),
        status: row.status,
        created_at: row.created_at,
        attached_at: row.attached_at,
      })),
      total: items.length,
      status,
    })
  })
)

// 자동 삭제는 없다. 관리자가 명시적으로 호출할 때만 기록을 지운 것으로 표시하고,
// purge=true를 함께 보낸 경우에만 Drive 파일을 휴지통으로 옮긴다.
router.delete(
  '/admin/drive/uploads/:id',
  requireAuth,
  requireRole('owner'),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM form_file_uploads WHERE id = $1', [req.params.id])
    const row = rows[0]
    if (!row) return res.status(404).json({ error: '업로드 기록을 찾을 수 없습니다.' })
    let purged = false
    if (String(req.query.purge) === 'true' && row.storage === 'google-drive' && row.drive_file_id) {
      const connection = await resolveConnection({ connectionId: row.connection_id, requireActive: false })
      const drive = await driveFor(connection)
      await drive.files.update({
        fileId: row.drive_file_id,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      })
      purged = true
    }
    const updated = await markUploadDeleted(row.id)
    res.json({ ok: true, purged, upload: { id: updated.id, status: updated.status } })
  })
)

export default router
