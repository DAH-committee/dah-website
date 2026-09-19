// src/lib/appsScriptDrive.js — Apps Script 웹앱을 Drive 클라이언트처럼 쓰는 어댑터 (53_DRIVE_STORAGE)
//
// 왜 필요한가: Google Cloud 콘솔에서 OAuth 클라이언트를 만들지 않고도 Drive에 파일을 넣어야 할 때가
// 있다. Apps Script 웹앱은 "나로 실행"으로 배포하면 배포한 사람의 Drive 권한으로 동작하므로,
// 우리 서버가 그 URL로 파일을 보내면 그 사람 Drive에 저장된다. GCP 프로젝트·refresh token이 필요 없다.
//
// 중요: Apps Script는 **눈에 보이지 않는 수신처**일 뿐이다. 제출자는 계속 사이트의 폼 화면을 쓴다.
// Apps Script가 만든 화면을 사용자에게 보여주지 않는다.
//
// 이 어댑터는 googleapis의 drive v3 객체와 같은 모양(files.list/create/get/update, permissions.create,
// about.get)을 제공한다. 그래서 폴더 find-or-create·재시도·바인딩 캐시 같은 상위 로직은 인증 방식이
// 무엇인지 몰라도 된다.
import { Readable } from 'node:stream'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Apps Script 웹앱이 한 번에 받을 수 있는 요청 크기에는 한계가 있고, base64는 용량을 약 33% 늘린다.
// 상한을 넘으면 Drive까지 가지 않고 서버에서 명확히 막는다(APPS_SCRIPT_MAX_UPLOAD_MB로 조정).
const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.APPS_SCRIPT_MAX_UPLOAD_MB) || 30) * 1024 * 1024

export const APPS_SCRIPT_URL_RE = /^https:\/\/script\.google(?:usercontent)?\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/

export function isAppsScriptUrl(value) {
  return APPS_SCRIPT_URL_RE.test(String(value || '').trim())
}

function httpError(message, status, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

async function bufferFrom(body) {
  if (!body) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Readable || typeof body.pipe === 'function' || typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = []
    for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  return Buffer.from(String(body))
}

/** Drive 검색어(q)에서 부모 폴더와 이름만 뽑는다. 우리 코드가 만드는 q 형태만 다룬다 */
function parseQuery(q) {
  const text = String(q || '')
  const parentId = /'((?:[^'\\]|\\.)*)' in parents/.exec(text)?.[1]?.replace(/\\'/g, "'") || ''
  const name = /name = '((?:[^'\\]|\\.)*)'/.exec(text)?.[1]?.replace(/\\'/g, "'") || ''
  return { parentId, name }
}

/**
 * Apps Script 웹앱 기반 Drive 클라이언트.
 * @param {{url:string, secret:string, fetchImpl?:Function, timeoutMs?:number}} options
 */
export function createAppsScriptDriveClient({ url, secret, fetchImpl, timeoutMs } = {}) {
  const endpoint = String(url || '').trim()
  if (!isAppsScriptUrl(endpoint)) {
    throw httpError(
      'Apps Script 웹앱 주소 형식이 아닙니다. 배포 후 받은 /exec 로 끝나는 주소를 넣으세요.',
      400,
      { code: 'apps_script_url_invalid' }
    )
  }
  if (!secret) {
    throw httpError('Apps Script 공유 비밀키가 없습니다. 연결을 다시 등록하세요.', 409, { code: 'apps_script_secret_missing' })
  }
  const doFetch = fetchImpl || fetch
  const limitMs = Number(timeoutMs) || Number(process.env.GOOGLE_DRIVE_TIMEOUT_MS) || 60_000

  async function call(action, payload = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), limitMs)
    let res = null
    try {
      res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, action, ...payload }),
        redirect: 'follow',
        signal: controller.signal,
      })
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw httpError('Apps Script 응답이 없습니다(시간 초과). 잠시 후 다시 시도하세요.', 504, { code: 'apps_script_timeout' })
      }
      // 네트워크 오류는 상위 withDriveRetry가 재시도할 수 있게 코드를 그대로 전달한다
      throw err
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    if (!json) {
      // 로그인 화면 HTML이 오는 대표적 원인: 배포 접근 권한이 "모든 사용자"가 아님
      throw httpError(
        'Apps Script가 JSON을 돌려주지 않았습니다. 웹앱 배포를 "액세스 권한: 모든 사용자"로 다시 배포했는지 확인하세요.',
        502,
        { code: 'apps_script_bad_response', status: res.status }
      )
    }
    if (json.error) {
      throw httpError(json.error, Number(json.status) || 502, { code: json.code || 'apps_script_error' })
    }
    if (!res.ok) {
      throw httpError(`Apps Script 요청이 실패했습니다 (${res.status}).`, res.status, { code: 'apps_script_http_error' })
    }
    return json
  }

  return {
    // 어느 계정으로 저장되는지 확인 — 관리 화면의 "연결 계정"에 그대로 쓰인다
    about: {
      get: async () => {
        const data = await call('about')
        return { data: { user: data.user || null, storageQuota: data.storageQuota || null } }
      },
    },
    files: {
      list: async ({ q } = {}) => {
        const { parentId, name } = parseQuery(q)
        const data = await call('list', { parentId, name })
        return { data: { files: Array.isArray(data.files) ? data.files : [] } }
      },
      create: async ({ requestBody = {}, media } = {}) => {
        const parentId = Array.isArray(requestBody.parents) ? requestBody.parents[0] : ''
        if (!media) {
          const data = await call('createFolder', { parentId, name: requestBody.name })
          return { data }
        }
        const buffer = await bufferFrom(media.body)
        if (buffer.length > MAX_UPLOAD_BYTES) {
          throw httpError(
            `Apps Script 방식은 파일 ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB까지 받을 수 있습니다. 더 큰 원본은 Drive API 연결을 사용하세요.`,
            413,
            { code: 'apps_script_too_large', maxBytes: MAX_UPLOAD_BYTES }
          )
        }
        const data = await call('upload', {
          parentId,
          name: requestBody.name,
          mimeType: media.mimeType || 'application/octet-stream',
          description: requestBody.description || '',
          appProperties: requestBody.appProperties || {},
          // 원본 바이트를 그대로 base64로 옮긴다. 변환·리사이즈는 하지 않는다.
          dataBase64: buffer.toString('base64'),
        })
        return { data }
      },
      get: async ({ fileId } = {}) => {
        const data = await call('get', { fileId })
        return { data }
      },
      update: async ({ fileId, requestBody = {} } = {}) => {
        if (requestBody.trashed) {
          const data = await call('trash', { fileId })
          return { data }
        }
        return { data: { id: fileId } }
      },
    },
    permissions: {
      create: async ({ fileId, requestBody = {} } = {}) => {
        const data = await call('share', {
          fileId,
          type: requestBody.type || 'anyone',
          role: requestBody.role || 'reader',
        })
        return { data }
      },
    },
    // 상위 코드가 폴더 MIME을 비교할 때 쓰는 상수 (테스트 가독성용)
    FOLDER_MIME,
  }
}
