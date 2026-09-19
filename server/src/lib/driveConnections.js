// src/lib/driveConnections.js — Google Drive 연결 프로필과 폴더 바인딩 (53_DRIVE_STORAGE)
//
// "어떤 계정으로, 어떤 루트 폴더에, 어떤 경로로 올릴지"를 DB에서 읽어 확정하는 층이다.
// refresh token은 secretBox로 봉인해 google_drive_connections.refresh_token_enc에만 있고,
// 평문은 이 파일 안에서만 잠깐 존재한다. sanitizeConnection()을 거치지 않은 행은 API로 내보내지 않는다.
//
// 폴더 바인딩(google_drive_folder_bindings)은 "경로 → 폴더 ID" 캐시다. 캐시가 있으면 Drive 조회를
// 건너뛰고, 캐시된 폴더가 삭제·이동·권한 상실로 접근 불가가 되면 캐시를 버리고 다시 찾는다.
import { query } from '../db.js'
import { seal, open, isSecretBoxConfigured } from './secretBox.js'
import {
  createDriveClient,
  ensureFolderPath,
  legacyEnvCredentials,
  oauthAppCredentials,
  probeFolder,
  uploadFile,
  aboutAccount,
  driveScope,
} from './googleDrive.js'

export const ENV_CONNECTION_ID = 0 // 환경변수 레거시 연결의 가상 ID (DB에는 저장하지 않는다)

const CONNECTION_COLUMNS = `id, label, account_email, auth_mode, scope, root_folder_id,
  root_folder_name, active, last_check_at, last_check_ok, last_error, created_at, updated_at,
  (refresh_token_enc IS NOT NULL) AS has_token`

/** API로 내보내도 되는 모양. 토큰·암호문은 어떤 경로로도 포함되지 않는다 */
export function sanitizeConnection(row) {
  if (!row) return null
  return {
    id: row.id,
    label: row.label,
    account_email: row.account_email || '',
    auth_mode: row.auth_mode || 'oauth',
    scope: row.scope || '',
    root_folder_id: row.root_folder_id || '',
    root_folder_name: row.root_folder_name || '',
    root_folder_url: row.root_folder_id
      ? `https://drive.google.com/drive/folders/${row.root_folder_id}`
      : '',
    active: row.active !== false,
    last_check_at: row.last_check_at ?? null,
    last_check_ok: row.last_check_ok ?? null,
    last_error: row.last_error || '',
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    has_token: Boolean(row.has_token ?? row.refresh_token_enc),
    is_env: row.auth_mode === 'env',
  }
}

/** 환경변수 계정(기존 배포)을 연결 프로필과 같은 모양으로 보여준다. 읽기 전용이다 */
export function envConnectionRow() {
  if (!legacyEnvCredentials()) return null
  return {
    id: ENV_CONNECTION_ID,
    label: '환경변수 연결 (레거시)',
    account_email: process.env.GOOGLE_DRIVE_ACCOUNT_EMAIL?.trim() || '',
    auth_mode: 'env',
    scope: driveScope(),
    root_folder_id: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() || '',
    root_folder_name: '',
    active: true,
    last_check_at: null,
    last_check_ok: null,
    last_error: '',
    created_at: null,
    updated_at: null,
    has_token: true,
  }
}

export async function listConnectionRows() {
  const { rows } = await query(
    `SELECT ${CONNECTION_COLUMNS} FROM google_drive_connections ORDER BY active DESC, id ASC`
  )
  return rows
}

export async function listConnections() {
  const rows = await listConnectionRows()
  const env = envConnectionRow()
  return [...rows.map(sanitizeConnection), ...(env ? [sanitizeConnection(env)] : [])]
}

export async function getConnectionRow(id) {
  if (Number(id) === ENV_CONNECTION_ID) return envConnectionRow()
  const { rows } = await query(
    `SELECT ${CONNECTION_COLUMNS}, refresh_token_enc FROM google_drive_connections WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

/**
 * 업로드·점검에 쓸 연결을 확정한다.
 *   1) 폼(파일 질문)이 연결 ID를 지정했으면 그것
 *   2) 없으면 활성 연결이 하나일 때 그것
 *   3) 없으면 환경변수 레거시 연결
 * @param {{connectionId?:number|null, requireActive?:boolean}} options
 */
export async function resolveConnection({ connectionId = null, requireActive = true } = {}) {
  if (connectionId !== null && connectionId !== undefined && connectionId !== '') {
    const row = await getConnectionRow(connectionId)
    if (!row) {
      const err = new Error('지정된 Google Drive 연결을 찾을 수 없습니다. 관리 → 저장소 → Google Drive에서 다시 선택하세요.')
      err.status = 409
      err.code = 'connection_missing'
      throw err
    }
    if (requireActive && row.active === false) {
      const err = new Error('이 폼이 사용하는 Google Drive 연결이 비활성 상태입니다.')
      err.status = 409
      err.code = 'connection_inactive'
      throw err
    }
    return row
  }

  const rows = await listConnectionRows()
  const active = rows.filter((row) => row.active !== false && row.has_token)
  if (active.length === 1) return getConnectionRow(active[0].id)
  if (active.length > 1) {
    const err = new Error('사용할 Google Drive 연결을 폼에서 선택해야 합니다. 연결 프로필이 두 개 이상입니다.')
    err.status = 409
    err.code = 'connection_ambiguous'
    throw err
  }
  const env = envConnectionRow()
  if (env) return env
  const err = new Error('연결된 Google Drive 계정이 없습니다. 관리 → 저장소 → Google Drive에서 계정을 연결하세요.')
  err.status = 409
  err.code = 'connection_none'
  throw err
}

/** 연결 행 → Drive 자격증명(평문 토큰은 이 함수 밖으로 나가지 않는다) */
function credentialsFor(row) {
  if (row.auth_mode === 'env') {
    const credentials = legacyEnvCredentials()
    if (credentials) return credentials
    const err = new Error('환경변수 Google Drive 설정이 사라졌습니다.')
    err.status = 503
    err.code = 'drive_not_configured'
    throw err
  }
  const app = oauthAppCredentials()
  if (!app) {
    const err = new Error('Google OAuth 클라이언트 설정이 없습니다.')
    err.status = 503
    err.code = 'oauth_app_missing'
    err.hint = 'Render 환경변수 GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI를 설정하세요.'
    throw err
  }
  const refreshToken = open(row.refresh_token_enc)
  if (!refreshToken) {
    const err = new Error('저장된 Google 연결 토큰을 열 수 없습니다. 계정을 다시 연결하세요.')
    err.status = 409
    err.code = 'token_unreadable'
    throw err
  }
  return {
    mode: 'oauth',
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    refreshToken,
  }
}

export async function driveFor(row) {
  return createDriveClient(credentialsFor(row))
}

/**
 * 폼에 저장된 루트 폴더가 있으면 그것을, 없으면 연결 프로필의 루트를 쓴다.
 * 폼에 남아 있는 예전 계정의 폴더 ID도 여기서 그대로 후보가 되고, 접근 가능 여부는 probe가 판정한다.
 */
export function resolveRootFolderId({ connection, formSettings = {} }) {
  const fromForm = String(formSettings?.drive_folder_id || '').trim()
  if (fromForm) return { rootFolderId: fromForm, source: 'form' }
  const fromConnection = String(connection?.root_folder_id || '').trim()
  if (fromConnection) return { rootFolderId: fromConnection, source: 'connection' }
  return { rootFolderId: '', source: 'none' }
}

// ── 폴더 바인딩 캐시 ────────────────────────────────────────

function pathKeyOf(rootFolderId, segments) {
  return `${rootFolderId}::${segments.join('/')}`
}

async function readBinding(connectionId, pathKey) {
  if (!connectionId) return null
  const { rows } = await query(
    'SELECT id, folder_id FROM google_drive_folder_bindings WHERE connection_id = $1 AND path_key = $2',
    [connectionId, pathKey]
  )
  return rows[0] || null
}

async function writeBinding(connectionId, pathKey, folderId, labels) {
  if (!connectionId) return folderId
  // 동시 요청이 각자 폴더를 만들었더라도 바인딩은 하나만 남는다. 승자 ID를 모두가 쓴다.
  await query(
    `INSERT INTO google_drive_folder_bindings (connection_id, path_key, folder_id, path_labels)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (connection_id, path_key) DO NOTHING`,
    [connectionId, pathKey, folderId, JSON.stringify(labels || [])]
  )
  const { rows } = await query(
    'SELECT folder_id FROM google_drive_folder_bindings WHERE connection_id = $1 AND path_key = $2',
    [connectionId, pathKey]
  )
  return rows[0]?.folder_id || folderId
}

async function dropBinding(id) {
  await query('DELETE FROM google_drive_folder_bindings WHERE id = $1', [id])
}

/**
 * 경로 확보. dryRun이면 만들지 않고 "무엇이 없는지"만 돌려준다(미리보기).
 * @param {{connection:object, rootFolderId:string, segments:string[], dryRun?:boolean, drive?:object}} options
 * @returns {{folderId:string|null, steps:Array, duplicates:Array, cached:boolean, root:object}}
 */
export async function ensurePath({ connection, rootFolderId, segments = [], dryRun = false, drive: injected }) {
  const drive = injected || (await driveFor(connection))
  const root = await probeFolder(drive, rootFolderId)
  if (!root.ok) {
    const err = new Error(root.message || '루트 폴더에 접근할 수 없습니다.')
    err.status = 409
    err.code = `root_${root.reason || 'error'}`
    err.detail = { root }
    throw err
  }

  const key = pathKeyOf(rootFolderId, segments)
  const connectionId = connection?.id && connection.id !== ENV_CONNECTION_ID ? connection.id : null
  const cached = await readBinding(connectionId, key)
  if (cached) {
    const probe = await probeFolder(drive, cached.folder_id)
    if (probe.ok) {
      return {
        folderId: cached.folder_id,
        steps: segments.map((name) => ({ name, id: null, created: false, cached: true })),
        duplicates: [],
        cached: true,
        root,
      }
    }
    await dropBinding(cached.id) // 삭제·권한 상실 → 캐시 폐기 후 재탐색
  }

  const result = await ensureFolderPath(drive, { rootFolderId, segments, dryRun })
  if (!dryRun && result.folderId) {
    const winner = await writeBinding(connectionId, key, result.folderId, result.steps.map((s) => s.name))
    return { ...result, folderId: winner, cached: false, root }
  }
  return { ...result, cached: false, root }
}

/** 업로드 실행 (경로는 이미 확정된 상태) */
export async function uploadToConnection({ connection, folderId, buffer, filename, mimeType, shareMode, originalName, properties, drive: injected }) {
  const drive = injected || (await driveFor(connection))
  return uploadFile(drive, { folderId, buffer, filename, mimeType, shareMode, originalName, properties })
}

// ── 연결 점검·기록 ─────────────────────────────────────────

/**
 * 연결 점검: 계정 정보 + 루트 폴더 접근을 한 번에 본다. 결과는 DB에 남겨 관리자 화면이 읽는다.
 * @returns {{ok:boolean, account:object|null, root:object|null, error:string}}
 */
export async function checkConnection(row, { rootFolderId } = {}) {
  const targetRoot = String(rootFolderId || row.root_folder_id || '').trim()
  let account = null
  let root = null
  let error = ''
  let ok = false
  try {
    const drive = await driveFor(row)
    account = await aboutAccount(drive)
    if (targetRoot) {
      root = await probeFolder(drive, targetRoot)
      ok = root.ok
      if (!root.ok) error = root.message || '루트 폴더에 접근할 수 없습니다.'
    } else {
      ok = true
      error = ''
    }
  } catch (err) {
    error = err.message || 'Drive 점검에 실패했습니다.'
    ok = false
  }

  if (row.id && row.id !== ENV_CONNECTION_ID) {
    await query(
      `UPDATE google_drive_connections
          SET last_check_at = now(), last_check_ok = $1, last_error = $2,
              account_email = COALESCE(NULLIF($3, ''), account_email),
              root_folder_name = COALESCE(NULLIF($4, ''), root_folder_name),
              updated_at = now()
        WHERE id = $5`,
      [ok, error.slice(0, 500), account?.email || '', root?.name || '', row.id]
    )
  }
  return { ok, account, root, error }
}

export async function createConnection({ label, accountEmail, refreshToken, scope, rootFolderId = '', createdBy = null }) {
  if (!isSecretBoxConfigured()) {
    const err = new Error('DRIVE_TOKEN_ENC_KEY가 없어 Google 연결을 저장할 수 없습니다.')
    err.status = 503
    err.code = 'enc_key_missing'
    err.hint = 'Render 환경변수에 DRIVE_TOKEN_ENC_KEY(32바이트 랜덤값 base64)를 추가한 뒤 재배포하세요.'
    throw err
  }
  const sealed = seal(refreshToken)
  const email = String(accountEmail || '').trim().toLowerCase()
  // 같은 계정을 다시 연결하면 새 프로필을 만들지 않고 토큰만 교체한다(중복 프로필 방지).
  const existing = email
    ? (await query('SELECT id FROM google_drive_connections WHERE lower(account_email) = $1 ORDER BY id ASC LIMIT 1', [email])).rows[0]
    : null
  if (existing) {
    const { rows } = await query(
      `UPDATE google_drive_connections
          SET label = COALESCE(NULLIF($1, ''), label), refresh_token_enc = COALESCE($2, refresh_token_enc),
              scope = $3, active = TRUE, last_error = '', updated_at = now(),
              root_folder_id = COALESCE(NULLIF($4, ''), root_folder_id)
        WHERE id = $5
        RETURNING ${CONNECTION_COLUMNS}`,
      [String(label || '').slice(0, 80), sealed, scope || driveScope(), rootFolderId, existing.id]
    )
    return rows[0]
  }
  const { rows } = await query(
    `INSERT INTO google_drive_connections (label, account_email, auth_mode, scope, root_folder_id, refresh_token_enc, created_by)
     VALUES ($1, $2, 'oauth', $3, $4, $5, $6)
     RETURNING ${CONNECTION_COLUMNS}`,
    [
      String(label || `Drive 연결 ${new Date().getFullYear()}`).slice(0, 80),
      email,
      scope || driveScope(),
      rootFolderId,
      sealed,
      createdBy,
    ]
  )
  return rows[0]
}

export async function updateConnection(id, { label, rootFolderId, rootFolderName, active }) {
  const sets = []
  const params = []
  const push = (sql, value) => {
    params.push(value)
    sets.push(`${sql} = $${params.length}`)
  }
  if (label !== undefined) push('label', String(label).slice(0, 80))
  if (rootFolderId !== undefined) push('root_folder_id', String(rootFolderId || ''))
  if (rootFolderName !== undefined) push('root_folder_name', String(rootFolderName || ''))
  if (active !== undefined) push('active', Boolean(active))
  if (!sets.length) return getConnectionRow(id)
  params.push(id)
  const { rows } = await query(
    `UPDATE google_drive_connections SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${params.length} RETURNING ${CONNECTION_COLUMNS}`,
    params
  )
  return rows[0] || null
}

/**
 * 연결 해제 — 암호화된 토큰을 폐기하고 비활성으로 바꾼다.
 * Drive 안의 실제 파일과 폴더는 건드리지 않는다(기록도 남긴다).
 */
export async function disconnectConnection(id) {
  const { rows } = await query(
    `UPDATE google_drive_connections
        SET refresh_token_enc = NULL, active = FALSE, last_check_ok = NULL,
            last_error = '연결이 해제되었습니다. Drive 안의 파일은 그대로 있습니다.', updated_at = now()
      WHERE id = $1
      RETURNING ${CONNECTION_COLUMNS}`,
    [id]
  )
  return rows[0] || null
}

/** 이 연결을 쓰는 폼 목록 — 관리자 화면의 "영향 범위" 표시용 */
export async function formsUsingConnection(connectionId) {
  const { rows } = await query(
    `SELECT id, slug, title_ko, published, fields, settings FROM custom_forms ORDER BY id DESC`
  )
  const target = Number(connectionId)
  return rows
    .filter((form) => {
      const settings = form.settings || {}
      const fields = Array.isArray(form.fields) ? form.fields : []
      const explicit = fields.some(
        (field) => field?.type === 'file' && Number(field?.storage?.connection_id) === target
      )
      const inherited =
        (settings.drive_enabled || fields.some((f) => f?.type === 'file' && f?.storage?.target === 'drive')) &&
        Number(settings.drive_connection_id || 0) === target
      return explicit || inherited
    })
    .map((form) => ({ id: form.id, slug: form.slug, title_ko: form.title_ko, published: form.published }))
}

// ── 업로드 기록 ────────────────────────────────────────────

export async function findUploadByKey(idempotencyKey) {
  const { rows } = await query('SELECT * FROM form_file_uploads WHERE idempotency_key = $1', [idempotencyKey])
  return rows[0] || null
}

export async function insertUpload(record) {
  const { rows } = await query(
    `INSERT INTO form_file_uploads
       (form_id, field_id, public_user_id, submitter_email, idempotency_key, storage, purpose,
        connection_id, drive_file_id, file_url, folder_id, original_name, stored_name, mime, bytes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      record.formId ?? null,
      record.fieldId,
      record.publicUserId ?? null,
      record.submitterEmail ?? null,
      record.idempotencyKey,
      record.storage,
      record.purpose ?? null,
      record.connectionId ?? null,
      record.driveFileId ?? null,
      record.fileUrl ?? null,
      record.folderId ?? null,
      record.originalName ?? null,
      record.storedName ?? null,
      record.mime ?? null,
      record.bytes ?? null,
    ]
  )
  return rows[0] || null
}

/**
 * 제출 확정 — 응답에 실제로 담긴 파일만 attached로 바꾼다.
 * 제출되지 않은 업로드는 pending으로 남고 자동 삭제하지 않는다(관리자 화면의 "미연결 업로드").
 */
export async function attachUploads({ formId, responseId, urls, publicUserId, email }) {
  const list = [...new Set((urls || []).filter(Boolean).map(String))]
  if (!list.length) return 0
  const { rowCount } = await query(
    `UPDATE form_file_uploads
        SET status = 'attached', response_id = $1, attached_at = now(), updated_at = now()
      WHERE form_id = $2
        AND status = 'pending'
        AND file_url = ANY($3::text[])
        AND ($4::int IS NULL OR public_user_id IS NULL OR public_user_id = $4)
        AND ($5::text IS NULL OR submitter_email IS NULL OR submitter_email = $5)`,
    [responseId, formId, list, publicUserId ?? null, email ?? null]
  )
  return rowCount || 0
}

export async function listUploads({ status = 'pending', formId = null, limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT u.*, f.title_ko AS form_title, f.slug AS form_slug
       FROM form_file_uploads u
       LEFT JOIN custom_forms f ON f.id = u.form_id
      WHERE ($1::text = 'all' OR u.status = $1)
        AND ($2::int IS NULL OR u.form_id = $2)
      ORDER BY u.created_at DESC
      LIMIT $3`,
    [status, formId, Math.min(Number(limit) || 200, 500)]
  )
  return rows
}

export async function markUploadDeleted(id) {
  const { rows } = await query(
    `UPDATE form_file_uploads SET status = 'deleted', updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  )
  return rows[0] || null
}
