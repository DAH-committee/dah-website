// src/lib/googleDrive.js — Google Drive API 어댑터 (53_DRIVE_STORAGE)
//
// 이 파일은 "Drive와 말하는 법"만 안다. 어떤 계정으로 어떤 폴더에 넣을지는 lib/driveConnections.js가
// DB에서 읽어 결정한다. 그래서 테스트는 setDriveClientFactory()로 가짜 클라이언트를 주입해
// 네트워크 없이 폴더 생성·재사용·재시도·권한 거부를 모두 검증할 수 있다.
//
// 인증 경로는 두 가지다.
//   1) connection: 관리자 화면에서 연결한 Google 계정의 refresh token(DB에 암호화 보관)
//   2) env(레거시): GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN 또는 서비스 계정 JSON
// 레거시 경로는 기존 폼이 깨지지 않게 남겨둔다. 신규 연결은 전부 1)을 쓴다.
//
// 권한 범위: 관리자가 "이미 존재하는 폴더 URL을 붙여넣는" 흐름을 지원해야 하므로 drive.file만으로는
// 불가능하다(drive.file은 앱이 만든 파일과 Picker로 고른 파일만 본다 — README 인수인계 절 참고).
// 기본값은 GOOGLE_DRIVE_SCOPE 환경변수로 바꿀 수 있다.
import { Readable } from 'node:stream'
import { google } from 'googleapis'

export const DRIVE_SCOPE_FULL = 'https://www.googleapis.com/auth/drive'
export const DRIVE_SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file'

export function driveScope() {
  const raw = process.env.GOOGLE_DRIVE_SCOPE?.trim()
  return raw || DRIVE_SCOPE_FULL
}

const REQUEST_TIMEOUT_MS = Number(process.env.GOOGLE_DRIVE_TIMEOUT_MS || 30_000)
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
const RETRY_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED'])

// ── 클라이언트 주입 ─────────────────────────────────────────

let clientFactory = null

/** 테스트 주입: (credentials) => driveLikeClient */
export function setDriveClientFactory(factory) {
  clientFactory = factory
}

export function resetDriveClientFactory() {
  clientFactory = null
}

export function envOAuthCredentials() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim()
  if (!clientId || !clientSecret || !refreshToken) return null
  return { mode: 'oauth', clientId, clientSecret, refreshToken }
}

export function envServiceAccount() {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    } catch {
      parsed = null
    }
  }
  if (!parsed?.client_email || !parsed?.private_key) return null
  return { mode: 'service-account', credentials: parsed }
}

/** OAuth 앱 등록 정보(클라이언트 ID/시크릿/리디렉트). 계정 토큰이 아니라 앱 식별자다 */
export function oauthAppCredentials() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

export function isGoogleDriveConfigured() {
  return Boolean(envOAuthCredentials() || envServiceAccount() || oauthAppCredentials())
}

/**
 * 자격증명 → Drive v3 클라이언트.
 * @param {{mode:'oauth', clientId:string, clientSecret:string, refreshToken:string}
 *        |{mode:'service-account', credentials:object}} credentials
 */
export async function createDriveClient(credentials) {
  if (clientFactory) return clientFactory(credentials)
  if (!credentials) {
    const err = new Error('Google Drive 인증 정보가 없습니다.')
    err.status = 503
    err.code = 'drive_not_configured'
    throw err
  }
  if (credentials.mode === 'service-account') {
    const auth = new google.auth.GoogleAuth({
      credentials: credentials.credentials,
      scopes: [driveScope()],
    })
    return google.drive({ version: 'v3', auth })
  }
  const auth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret)
  auth.setCredentials({ refresh_token: credentials.refreshToken })
  return google.drive({ version: 'v3', auth })
}

// ── 재시도 ─────────────────────────────────────────────────

function statusOf(err) {
  return Number(err?.status || err?.code || err?.response?.status) || 0
}

export function isRetryableDriveError(err) {
  if (RETRY_CODES.has(err?.code)) return true
  return RETRY_STATUSES.has(statusOf(err))
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 429·5xx·네트워크 오류에 지수 백오프 재시도. 4xx(권한·없음)는 즉시 던진다.
 * @param {Function} fn
 * @param {{retries?:number, baseMs?:number, onRetry?:Function}} [options]
 */
export async function withDriveRetry(fn, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 4
  const baseMs = Number.isFinite(options.baseMs) ? options.baseMs : 250
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      if (attempt === retries || !isRetryableDriveError(err)) break
      const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs)
      options.onRetry?.({ attempt, delay, error: err })
      await wait(delay)
    }
  }
  throw lastErr
}

const requestOptions = { timeout: REQUEST_TIMEOUT_MS }

// ── 폴더 이름 정리 ──────────────────────────────────────────

/**
 * 폴더명 정규화. 경로 분리자·상위 경로·제어문자를 지우고 길이를 제한한다.
 * 클라이언트가 보낸 문자열이 그대로 Drive 경로가 되는 일을 여기서 끊는다.
 */
export function sanitizeFolderName(raw) {
  let name = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[/\\]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
  name = name.replace(/^\.+/, '').replace(/\.+$/, '').trim()
  if (name.length > 80) name = name.slice(0, 80).trim()
  return name
}

/** Drive 검색어(q)의 문자열 리터럴 이스케이프 */
function escapeQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// ── 조회·생성 ──────────────────────────────────────────────

export async function aboutAccount(drive) {
  const { data } = await withDriveRetry(() =>
    drive.about.get({ fields: 'user(displayName,emailAddress),storageQuota' }, requestOptions)
  )
  return {
    email: data?.user?.emailAddress || '',
    name: data?.user?.displayName || '',
    quota: data?.storageQuota || null,
  }
}

/**
 * 폴더 접근 가능 여부 점검. 계정 교체 후 "예전 루트에 접근 가능한가"를 판단하는 단일 출처다.
 * @returns {{ok:boolean, id?:string, name?:string, trashed?:boolean, canAddChildren?:boolean,
 *            driveId?:string|null, webViewLink?:string, reason?:string, message?:string}}
 */
export async function probeFolder(drive, folderId) {
  if (!folderId) return { ok: false, reason: 'missing', message: '폴더 ID가 없습니다.' }
  try {
    const { data } = await withDriveRetry(() =>
      drive.files.get(
        {
          fileId: folderId,
          fields: 'id,name,mimeType,trashed,driveId,webViewLink,capabilities(canAddChildren,canEdit)',
          supportsAllDrives: true,
        },
        requestOptions
      )
    )
    if (data.mimeType && data.mimeType !== 'application/vnd.google-apps.folder') {
      return { ok: false, reason: 'not_folder', message: '지정한 ID는 폴더가 아닙니다.', id: data.id, name: data.name }
    }
    if (data.trashed) {
      return { ok: false, reason: 'trashed', message: '폴더가 휴지통에 있습니다.', id: data.id, name: data.name }
    }
    const canAddChildren = data.capabilities?.canAddChildren !== false
    return {
      ok: canAddChildren,
      reason: canAddChildren ? undefined : 'read_only',
      message: canAddChildren ? undefined : '폴더에 파일을 추가할 권한이 없습니다(보기 전용).',
      id: data.id,
      name: data.name,
      trashed: false,
      canAddChildren,
      driveId: data.driveId || null,
      webViewLink: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
    }
  } catch (err) {
    const status = statusOf(err)
    if (status === 404) return { ok: false, reason: 'not_found', message: '현재 연결된 Google 계정에서 폴더를 찾을 수 없습니다.' }
    if (status === 403) return { ok: false, reason: 'forbidden', message: '현재 연결된 Google 계정은 이 폴더에 접근할 수 없습니다.' }
    if (status === 401) return { ok: false, reason: 'unauthorized', message: 'Google 연결이 만료되었습니다. 계정을 다시 연결하세요.' }
    return { ok: false, reason: 'error', message: err.message || 'Drive 점검에 실패했습니다.' }
  }
}

/** 부모 폴더 아래 같은 이름의 폴더 목록(휴지통 제외). 생성 시각 오름차순 */
export async function findChildFolders(drive, parentId, name) {
  const { data } = await withDriveRetry(() =>
    drive.files.list(
      {
        q: `'${escapeQuery(parentId)}' in parents and name = '${escapeQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id,name,createdTime)',
        orderBy: 'createdTime',
        pageSize: 10,
        spaces: 'drive',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
      requestOptions
    )
  )
  return Array.isArray(data?.files) ? data.files : []
}

async function createFolder(drive, parentId, name) {
  const { data } = await withDriveRetry(() =>
    drive.files.create(
      {
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
        fields: 'id,name,createdTime',
        supportsAllDrives: true,
      },
      requestOptions
    )
  )
  return data
}

/**
 * find-or-create 경로 생성. 여러 번 호출해도 같은 폴더를 돌려준다.
 *
 * 동시 생성 대비: 만든 뒤 같은 이름을 다시 조회해 createdTime이 가장 이른 폴더를 승자로 고른다.
 * 두 요청이 같은 순간에 폴더를 만들어도 이후 업로드는 하나의 폴더로 수렴한다.
 * @param {object} drive
 * @param {{rootFolderId:string, segments:string[], dryRun?:boolean}} options
 * @returns {{folderId:string|null, steps:Array<{name:string,id:string|null,created:boolean,missing?:boolean}>,
 *            duplicates:Array<{name:string,ids:string[]}>}}
 */
export async function ensureFolderPath(drive, { rootFolderId, segments = [], dryRun = false }) {
  if (!rootFolderId) {
    const err = new Error('Google Drive 루트 폴더가 지정되지 않았습니다.')
    err.status = 409
    err.code = 'root_missing'
    throw err
  }
  const names = segments.map(sanitizeFolderName).filter(Boolean)
  let parentId = rootFolderId
  const steps = []
  const duplicates = []

  for (const name of names) {
    if (parentId === null) {
      steps.push({ name, id: null, created: false, missing: true })
      continue
    }
    const found = await findChildFolders(drive, parentId, name)
    if (found.length) {
      if (found.length > 1) duplicates.push({ name, ids: found.map((f) => f.id) })
      steps.push({ name, id: found[0].id, created: false })
      parentId = found[0].id
      continue
    }
    if (dryRun) {
      steps.push({ name, id: null, created: false, missing: true })
      parentId = null
      continue
    }
    const created = await createFolder(drive, parentId, name)
    const after = await findChildFolders(drive, parentId, name)
    const winner = after[0] || created
    if (after.length > 1) duplicates.push({ name, ids: after.map((f) => f.id) })
    steps.push({ name, id: winner.id, created: winner.id === created.id })
    parentId = winner.id
  }

  return { folderId: parentId, steps, duplicates }
}

/**
 * 파일 업로드. 원본 보존이 기본이다 — 버퍼·MIME·확장자를 바꾸지 않는다.
 * @param {object} drive
 * @param {{folderId:string, buffer:Buffer, filename:string, mimeType:string,
 *          shareMode?:'restricted'|'link', originalName?:string, properties?:object}} options
 */
export async function uploadFile(drive, {
  folderId,
  buffer,
  filename,
  mimeType,
  shareMode = 'restricted',
  originalName = '',
  properties = {},
}) {
  if (!folderId) {
    const err = new Error('업로드할 Google Drive 폴더가 지정되지 않았습니다.')
    err.status = 409
    err.code = 'folder_missing'
    throw err
  }
  const appProperties = Object.fromEntries(
    Object.entries({ ...properties, originalName: originalName || filename })
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v).slice(0, 120)])
  )

  const { data } = await withDriveRetry(() =>
    drive.files.create(
      {
        requestBody: {
          name: filename,
          parents: [folderId],
          description: originalName ? `원본 파일명: ${originalName}` : undefined,
          appProperties,
        },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id,name,mimeType,size,webViewLink',
        supportsAllDrives: true,
      },
      requestOptions
    )
  )

  // 기본은 Drive의 제한 공유(폴더 권한 상속). 공개 전시에 쓸 파일만 "링크 보기 허용"을 고른다.
  if (shareMode === 'link') {
    await withDriveRetry(() =>
      drive.permissions.create(
        {
          fileId: data.id,
          requestBody: { type: 'anyone', role: 'reader' },
          supportsAllDrives: true,
        },
        requestOptions
      )
    )
  }

  return {
    id: data.id,
    name: data.name || filename,
    type: data.mimeType || mimeType,
    bytes: Number(data.size || buffer.length),
    url: data.webViewLink || `https://drive.google.com/open?id=${data.id}`,
    storage: 'google-drive',
  }
}

// ── 레거시 호환 (기존 폼: 환경변수 단일 계정) ─────────────────

export function legacyEnvCredentials() {
  const oauth = envOAuthCredentials()
  if (oauth) return oauth
  if (process.env.GOOGLE_DRIVE_AUTH_MODE === 'service-account') {
    const sa = envServiceAccount()
    if (sa) return sa
  }
  return null
}

function requireLegacyCredentials() {
  const credentials = legacyEnvCredentials()
  if (credentials) return credentials
  const err = new Error('Google Drive 업로드가 아직 설정되지 않았습니다. 관리 → 저장소 → Google Drive에서 계정을 연결하세요.')
  err.status = 503
  err.code = 'drive_not_configured'
  throw err
}

/** @deprecated driveConnections.ensurePath 사용. 환경변수 계정 전용 경로(기존 폼 호환). */
export async function ensureDriveFolderPath({ rootFolderId, names = [] }) {
  const drive = await createDriveClient(requireLegacyCredentials())
  const { folderId } = await ensureFolderPath(drive, { rootFolderId, segments: names })
  return folderId
}

/** @deprecated driveConnections.upload 사용. 환경변수 계정 전용 경로(기존 폼 호환). */
export async function uploadToGoogleDrive({ folderId, buffer, filename, mimeType, shareMode = 'restricted' }) {
  const drive = await createDriveClient(requireLegacyCredentials())
  return uploadFile(drive, { folderId, buffer, filename, mimeType, shareMode })
}

/** Drive 폴더 URL 또는 ID에서 ID만 뽑는다. 형식이 아니면 빈 문자열 */
export function folderIdFrom(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/\/folders\/([A-Za-z0-9_-]+)/) || raw.match(/[?&]id=([A-Za-z0-9_-]+)/)
  const id = match?.[1] || raw
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : ''
}
