// 한글 파일 서버 호출(계약: server/src/routes/hwpFiles.README.md). 오류 본문은 { error:{code,message,...} } 라서
// 공용 api 헬퍼(문자열 error 를 가정)를 쓰지 않고 여기서 따로 읽는다.
import { API_BASE } from '../../hooks/useApi'

export class HwpError extends Error {
  constructor(code, message, status, body) {
    super(message)
    this.code = code
    this.status = status
    this.body = body
  }
}

function shareHeaders(base = {}) {
  try {
    const k = new URLSearchParams(window.location.search).get('k')
    return k ? { ...base, 'X-Share-Key': k } : base
  } catch {
    return base
  }
}

async function parse(res) {
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    const e = json?.error
    const code = (e && typeof e === 'object' && e.code) || (res.status === 401 ? 'LOGIN' : res.status === 403 ? 'FORBIDDEN' : res.status === 404 ? 'NOT_FOUND' : 'UPSTREAM')
    const message = (e && typeof e === 'object' && e.message) || (typeof e === 'string' ? e : '') || `요청에 실패했습니다 (${res.status})`
    throw new HwpError(code, message, res.status, json)
  }
  return json
}

const qs = (params) => {
  const e = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!e.length) return ''
  const u = new URLSearchParams()
  for (const [k, v] of e) u.set(k, String(v))
  return `?${u}`
}

async function call(method, path, { body, params, signal } = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}${qs(params)}`, {
      method,
      credentials: 'include',
      signal,
      headers: shareHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new HwpError('NETWORK', '서버에 연결하지 못했습니다', 0)
  }
  return parse(res)
}

const F = (id) => `/hwp/files/${encodeURIComponent(id)}`

/** 파일 하나에 대한 호출 묶음. 모든 읽기는 version 을 줄 수 있다 */
export function hwpApi(id) {
  return {
    info: async () => {
      const r = await call('GET', F(id))
      return r.item || r
    },
    outline: (version) => call('GET', `${F(id)}/outline`, { params: { version } }),
    blocks: (from, to, version) => call('GET', `${F(id)}/blocks`, { params: { from, to, version } }),
    fields: (version) => call('GET', `${F(id)}/fields`, { params: { version } }),
    pages: (from, to, version, { format = 'svg', scale } = {}, signal) => call('GET', `${F(id)}/pages`, { params: { from, to, version, format, scale }, signal }),
    edit: (body) => call('POST', `${F(id)}/edit`, { body }),
    versions: () => call('GET', `${F(id)}/versions`),
    restore: (v) => call('POST', `${F(id)}/versions/${v}/restore`, { body: {} }),
    star: (v, starred) => call('POST', `${F(id)}/versions/${v}/star`, { body: { starred } }),
    lint: (params) => call('GET', `${F(id)}/lint`, { params: { numbers: 1, styles: 1, ...params } }),
    compare: (to, from) => call('GET', `${F(id)}/compare`, { params: { to, from } }),
    redactionSuggest: (version) => call('GET', `${F(id)}/redaction-suggest`, { params: { version } }),
    exportUrl: (format, version) => `${API_BASE}${F(id)}/export${qs({ format, version })}`,
    exportBlob: async (format, version) => {
      const res = await fetch(`${API_BASE}${F(id)}/export${qs({ format, version })}`, { credentials: 'include', headers: shareHeaders() })
      if (!res.ok) await parse(res)
      return res.blob()
    },
    pageImageUrl: (n, version, { format = 'png', scale } = {}) => `${API_BASE}${F(id)}/pages/${n}.${format}${qs({ version, scale })}`,
    thumbUrl: (n, version) => `${API_BASE}${F(id)}/thumbs/${n}.png${qs({ version })}`,
    convertToDocs: (team_id) => call('POST', `${F(id)}/convert-to-docs`, { body: team_id ? { team_id } : {} }),
  }
}

export const hwpTemplates = () => call('GET', '/hwp/templates')
export const hwpCreate = (body) => call('POST', '/hwp/files/create', { body })

/** 파일 올리기: 4MB 이하는 multipart, 그 이상은 Blob 에 먼저 올린 뒤 import */
export async function hwpUpload(file, { title, team_id } = {}) {
  const fd = new FormData()
  fd.append('file', file)
  if (title) fd.append('title', title)
  if (team_id) fd.append('team_id', String(team_id))
  if (file.size <= 4 * 1024 * 1024) {
    let res
    try {
      res = await fetch(`${API_BASE}/hwp/files`, { method: 'POST', credentials: 'include', body: fd })
    } catch {
      throw new HwpError('NETWORK', '서버에 연결하지 못했습니다', 0)
    }
    return parse(res)
  }
  const ticket = await call('POST', '/blob/client-token', { body: { filename: file.name, size: file.size } })
  const put = await fetch(ticket.uploadUrl, { method: ticket.method || 'PUT', headers: ticket.headers, body: file })
  const j = await put.json().catch(() => null)
  if (!put.ok || !j?.url) throw new HwpError('UPSTREAM', `파일을 올리지 못했습니다 (${put.status})`, put.status)
  return call('POST', '/hwp/files/import', { body: { blob_url: j.url, filename: file.name, ...(title ? { title } : {}), ...(team_id ? { team_id } : {}) } })
}
