// Google Drive 업로드 어댑터.
// 일반 "내 드라이브"는 연결한 Google 계정 OAuth를 사용한다. 서비스 계정에는 자체 Drive 용량이
// 없으므로, 명시적으로 선택한 경우에만 공유 드라이브용 인증으로 사용한다.
import { Readable } from 'node:stream'
import { google } from 'googleapis'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

function serviceAccountCredentialsFromEnv() {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    // Render에는 원문 JSON 또는 base64 JSON 어느 쪽으로도 넣을 수 있다.
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    } catch {
      return null
    }
  }
}

function oauthCredentialsFromEnv() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim()
  if (!clientId || !clientSecret || !refreshToken) return null
  return { clientId, clientSecret, refreshToken }
}

function createDriveAuth() {
  const oauthCredentials = oauthCredentialsFromEnv()
  if (oauthCredentials) {
    const auth = new google.auth.OAuth2(oauthCredentials.clientId, oauthCredentials.clientSecret)
    auth.setCredentials({ refresh_token: oauthCredentials.refreshToken })
    return auth
  }

  if (process.env.GOOGLE_DRIVE_AUTH_MODE === 'service-account') {
    const credentials = serviceAccountCredentialsFromEnv()
    if (credentials?.client_email && credentials?.private_key) {
      return new google.auth.GoogleAuth({ credentials, scopes: [DRIVE_SCOPE] })
    }
  }

  const err = new Error('Google Drive 업로드가 아직 설정되지 않았습니다. 사용할 Google Drive 계정의 OAuth 연결이 필요합니다.')
  err.status = 503
  throw err
}

export function isGoogleDriveConfigured() {
  if (oauthCredentialsFromEnv()) return true
  const serviceAccount = serviceAccountCredentialsFromEnv()
  return process.env.GOOGLE_DRIVE_AUTH_MODE === 'service-account'
    && Boolean(serviceAccount?.client_email && serviceAccount?.private_key)
}

export async function uploadToGoogleDrive({ folderId, buffer, filename, mimeType, shareMode = 'restricted' }) {
  if (!folderId) {
    const err = new Error('이 폼의 Google Drive 폴더가 지정되지 않았습니다.')
    err.status = 409
    throw err
  }
  const auth = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })
  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,name,mimeType,size,webViewLink',
    supportsAllDrives: true,
  })

  // 기본값은 Drive의 제한 공유다. 공개 전시에 쓰일 파일만 편집기에서 "링크 공개"로 선택한다.
  if (shareMode === 'link') {
    await drive.permissions.create({
      fileId: data.id,
      requestBody: { type: 'anyone', role: 'reader' },
      supportsAllDrives: true,
    })
  }

  return {
    id: data.id,
    name: data.name || filename,
    type: data.mimeType || mimeType,
    bytes: Number(data.size || buffer.length),
    url: `https://drive.google.com/open?id=${data.id}`,
    storage: 'google-drive',
  }
}
