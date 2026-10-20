// useApi.js — API 조회 훅 + 뮤테이션 헬퍼 (12_BACKEND 7·8절)
// 인증은 httpOnly 쿠키 — JS는 credentials 'include'만. storage 사용 금지.
// 조회는 3초 타임아웃 후 src/data/snapshot/*.json 폴백(offline 플래그 제공).

import { useCallback, useEffect, useState } from 'react'

// 배포(https)에서는 서버가 다른 사이트(onrender.com)라 로그인 쿠키가 "제3자 쿠키"로 막히는 브라우저가 많다
// (사파리·아이폰·파이어폭스·시크릿 창). 그래서 같은 사이트의 /api 로 부르고, vercel.json 이 이를 서버로 전달한다.
// 그러면 쿠키가 이 사이트의 쿠키가 되어 어느 브라우저에서도 유지된다. 개발(http)은 환경 변수 주소를 그대로 쓴다.
const ENV_API = import.meta.env.VITE_API_URL
export const API_BASE =
  typeof window !== 'undefined' && window.location.protocol === 'https:' && ENV_API && !ENV_API.startsWith(window.location.origin)
    ? '/api'
    : ENV_API || 'http://localhost:4000'

const TIMEOUT_MS = 3000
// G3: 어드민 조회는 스냅샷 폴백이 없어 조기 중단이 순손실 — 콜드 스타트(Render)·원거리 지연 허용
const ADMIN_TIMEOUT_MS = 15000

// 폴백 슬롯 — lazy glob (eager 금지). 파일이 없으면 data null + offline true.
const snapshotModules = import.meta.glob('../data/snapshot/*.json')

function buildQuery(params) {
  if (!params) return ''
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  )
  if (!entries.length) return ''
  const qs = new URLSearchParams()
  for (const [k, v] of entries) qs.set(k, String(v))
  return `?${qs.toString()}`
}

async function parseResponse(res) {
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    // B1 에러 계약: { error, hint? } — 분기 플래그(mustSetPassword 등) 판독용 body 동봉
    const err = new Error(json?.error || `요청 실패 (${res.status})`)
    err.status = res.status
    err.hint = json?.hint
    err.body = json
    throw err
  }
  return json
}

/**
 * 스냅샷 폴백 판독.
 * 파일명 후보: 경로 전체 슬러그(content_notice) → 마지막 세그먼트(notice).
 * 상세 경로(/content/:type/:id, id 숫자)는 유형 스냅샷에서 id 매칭.
 */
async function readSnapshot(path) {
  const clean = path.replace(/^\/+/, '').split('?')[0]
  const segments = clean.split('/').filter(Boolean)
  if (!segments.length) return null
  const last = segments[segments.length - 1]
  const isDetail = segments.length >= 3 && /^\d+$/.test(last)
  const detailType = isDetail ? segments[segments.length - 2] : null
  const candidates = [...new Set([segments.join('_'), last, detailType].filter(Boolean))]

  for (const name of candidates) {
    const loader = snapshotModules[`../data/snapshot/${name}.json`]
    if (!loader) continue
    let json = null
    try {
      const mod = await loader()
      json = mod?.default ?? mod
    } catch {
      continue
    }
    if (name === detailType) {
      const items = Array.isArray(json) ? json : json?.items
      const found = Array.isArray(items)
        ? items.find((it) => String(it.id) === last)
        : null
      if (found) return found
      continue
    }
    return json
  }
  return null
}

/**
 * itemOf — 상세 응답 언랩 (P5-1). 라이브 서버는 단건을 { item }로 감싸 반환(content.js
 * GET /:type/:id), 스냅샷 폴백(readSnapshot)은 단일 객체를 그대로 반환한다. 목록형({items})은
 * 상세에서 취급하지 않으므로 null. 모든 :id 상세 페이지는 이 헬퍼로 일관되게 데이터를 꺼낸다.
 * @param {any} data - useApi로 받은 원본 응답
 * @returns {any|null}
 */
export function itemOf(data) {
  if (!data) return null
  if (data.item !== undefined) return data.item
  if (data.items !== undefined) return null
  return data
}

/**
 * firstItem — 싱글턴 공개 조회 언랩 (Q1). GET /content/:type(codesharing·nanodegree·ci)는
 * 목록 라우트라 { items:[row] }로 반환한다. itemOf는 { items }를 null 처리하므로 싱글턴 공개
 * 페이지가 DB 문서를 못 읽고 시드 폴백에 갇힌다 → 여기서 items[0]를 꺼낸다.
 * @param {any} data
 * @returns {any|null}
 */
export function firstItem(data) {
  if (!data) return null
  if (Array.isArray(data.items)) return data.items[0] ?? null
  if (data.item !== undefined) return data.item
  return data
}

/**
 * useApi — 조회 전용 훅.
 * @param {string|null} path - '/content/notice' 형태. null이면 조회하지 않음
 * @param {{ params?: Object }} [options] - 쿼리 파라미터
 * @returns {{ data: any, loading: boolean, error: Error|null, offline: boolean, refetch: Function }}
 *   offline true → 스냅샷 폴백 렌더 중. 상위에서 "실시간 동기화 대기 중" 배지 노출 가능
 */
export function useApi(path, { params, timeoutMs } = {}) {
  const [state, setState] = useState({
    data: null,
    loading: Boolean(path),
    error: null,
    offline: false,
  })
  const [tick, setTick] = useState(0)
  const query = buildQuery(params)
  // G3: /admin 경로는 기본 타임아웃을 길게 (프리필 GET이 3초 abort로 빈 폼이 되던 버그)
  const limit = timeoutMs ?? (path && path.startsWith('/admin') ? ADMIN_TIMEOUT_MS : TIMEOUT_MS)

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null, offline: false })
      return undefined
    }
    let alive = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), limit)
    setState((s) => ({ ...s, loading: true, error: null }))

    fetch(`${API_BASE}${path}${query}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(parseResponse)
      .then((json) => {
        if (alive) setState({ data: json, loading: false, error: null, offline: false })
      })
      .catch(async (err) => {
        if (!alive) return
        // 인증·권한 거부는 폴백 대상이 아님 — 에러 그대로 전달
        if (err?.status === 401 || err?.status === 403) {
          setState({ data: null, loading: false, error: err, offline: false })
          return
        }
        const snap = await readSnapshot(path)
        if (!alive) return
        setState({ data: snap, loading: false, error: snap ? null : err, offline: true })
      })
      .finally(() => clearTimeout(timer))

    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [path, query, tick, limit])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  return { ...state, refetch }
}

/**
 * api — 뮤테이션 헬퍼. JSON 본문 + credentials 'include', 실패 시 Error({message, status, hint}) throw.
 */
// 링크로 공유된 문서·시트는 주소의 ?k=키 를 요청 헤더로 함께 보낸다(전체 공개 링크 확인용).
function shareHeaders(base = {}) {
  try {
    const k = new URLSearchParams(window.location.search).get('k')
    return k ? { ...base, 'X-Share-Key': k } : base
  } catch {
    return base
  }
}

// 파일 업로드
// · 배포: 프론트와 서버가 같은 주소(/api)라 로그인 쿠키가 그대로 실린다. 다만 Vercel Functions는 요청 본문이
//   4.5MB를 넘으면 거절하므로, 4MB가 넘는 파일은 서버에서 한 파일용 서명 주소를 받아 브라우저가 Blob으로 바로 올린다
//   (로그인 필요, 이미지·PDF·오피스·한글·ZIP, 100MB까지). 폼 첨부(formSlug 등)는 서버가 저장 위치를 정해야 해서 4MB까지만 받는다.
// · 서버가 다른 주소(절대 URL)인 예전 구성은 같은 사이트 경로로 10분짜리 업로드 토큰을 받아 Authorization 헤더로 보낸다.
const SAME_ORIGIN_API = typeof ENV_API === 'string' && ENV_API.startsWith('/')
const DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024
const TOO_LARGE_MSG = '파일이 너무 큽니다. 4MB 이하 파일만 이 방법으로 올릴 수 있습니다.'

function uploadError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

async function uploadToServer(fd) {
  let res
  if (API_BASE === '/api' && ENV_API && !SAME_ORIGIN_API) {
    let headers = {}
    try {
      const r = await fetch(`${API_BASE}/auth/upload-token`, { method: 'POST', credentials: 'include' })
      if (r.ok) headers = { Authorization: `Bearer ${(await r.json()).token}` }
    } catch {
      /* 토큰 없이 진행 */
    }
    res = await fetch(`${ENV_API}/upload`, { method: 'POST', credentials: 'omit', headers, body: fd })
  } else {
    res = await fetch(`${API_BASE}/upload`, { method: 'POST', credentials: 'include', body: fd })
  }
  // 같은 주소 배포에서 413은 Vercel의 4.5MB 본문 한도에 걸린 것(응답 본문이 JSON이 아닐 수 있다)
  if (res.status === 413 && SAME_ORIGIN_API) throw uploadError(TOO_LARGE_MSG, 413)
  return parseResponse(res)
}

// 4MB 넘는 파일: 서명 주소 발급(POST /blob/client-token) 후 브라우저가 Blob으로 바로 PUT
async function uploadDirectToBlob(file) {
  const ticket = await fetch(`${API_BASE}/blob/client-token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, size: file.size }),
  }).then(parseResponse)
  let res
  try {
    res = await fetch(ticket.uploadUrl, { method: ticket.method || 'PUT', headers: ticket.headers, body: file })
  } catch {
    throw uploadError('파일 저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 0)
  }
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok || !json?.url) throw uploadError(`파일을 올리지 못했습니다. (${res.status})`, res.status)
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return { url: json.url, name: file.name, type: ticket.contentType, bytes: file.size, format: ext, storage: 'blob' }
}

export const api = {
  get: (path, params) =>
    fetch(`${API_BASE}${path}${buildQuery(params)}`, { credentials: 'include', headers: shareHeaders() }).then(
      parseResponse
    ),
  post: (path, body) =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: shareHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    }).then(parseResponse),
  put: (path, body) =>
    fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      credentials: 'include',
      headers: shareHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    }).then(parseResponse),
  del: (path) =>
    fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: shareHeaders(),
    }).then(parseResponse),
  /**
   * 파일 업로드 — POST /upload (multipart, 필드명 file). 응답 { url } 기대.
   * @param {File} file
   * @param {Object} [extra] - 함께 보낼 추가 필드
   */
  upload: async (file, extra) => {
    if (SAME_ORIGIN_API && file?.size > DIRECT_UPLOAD_BYTES) {
      // 용도(usage)만 있는 일반 첨부는 바로 올리기, 그 밖(폼 첨부·전시 원본)은 서버를 거쳐야 하므로 4MB 안내
      const plain = !extra || Object.keys(extra).every((k) => k === 'usage')
      if (!plain) throw uploadError(TOO_LARGE_MSG, 413)
      try {
        return await uploadDirectToBlob(file)
      } catch (err) {
        // 저장소 미연결·구버전 SDK(501·503)일 때만 서버 업로드로 대신한다(4.5MB를 넘으면 위 413 안내)
        if (err.status !== 501 && err.status !== 503) throw err
      }
    }
    const fd = new FormData()
    fd.append('file', file)
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    return uploadToServer(fd)
  },
}
