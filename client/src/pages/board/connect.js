// 연결: 링크 미리보기(제목·설명·썸네일·임베드), 우리 파일 미리보기(문서 첫 줄, 시트 첫 행)를 불러온다.
// 둘 다 없는 경로(404)나 오류면 조용히 비워 둔다. 보드는 그대로 동작한다.
import { useEffect, useState } from 'react'
import { api } from '../../hooks/useApi'
import { hostnameOf, sanitizeEmbedUrl, sanitizeImageSrc } from './sanitize'

const safePath = (u) => {
  try {
    return new URL(u).pathname
  } catch {
    return ''
  }
}

/** 주소만 보고 사이트 종류를 추정한다(미리보기 서버가 없을 때) */
export function guessKind(url) {
  const h = hostnameOf(url)
  if ((h === 'figma.com' || h.endsWith('.figma.com')) && /^\/(file|design|proto|board|slides|deck)\/[A-Za-z0-9]+/.test(safePath(url))) return 'figma'
  if (h === 'notion.so' || h.endsWith('.notion.so') || h.endsWith('.notion.site')) return 'notion'
  if (h === 'youtu.be' || h.endsWith('youtube.com')) return 'youtube'
  return 'link'
}

/** GET /integrations/unfurl?url= → 링크 data에 합칠 조각. 실패하면 종류만 */
export async function unfurl(url) {
  const base = { kind: guessKind(url) }
  try {
    const r = await api.get('/integrations/unfurl', { url })
    const out = { ...base }
    if (r.title) out.title = String(r.title).slice(0, 300)
    if (r.description) out.description = String(r.description).slice(0, 600)
    const img = sanitizeImageSrc(r.image)
    if (img) out.image = img
    if (r.siteName) out.siteName = String(r.siteName).slice(0, 100)
    if (['figma', 'notion', 'youtube', 'link'].includes(r.kind)) out.kind = r.kind
    const embed = sanitizeEmbedUrl(r.embedUrl)
    if (embed) out.embedUrl = embed
    return out
  } catch {
    return base
  }
}

// 우리 파일 목록 미리보기: 종류별 목록을 한 번만 불러와 id로 찾는다(1분 동안 다시 쓰기)
const cache = new Map() // kind → { at, map: Map(id → row), promise }
const listeners = new Set()

function loadKind(kind) {
  const hit = cache.get(kind)
  if (hit && (hit.promise || Date.now() - hit.at < 60000)) return
  const entry = { at: Date.now(), map: hit?.map || new Map(), promise: null }
  entry.promise = api
    .get('/workspace/files', { kind })
    .then((r) => {
      entry.map = new Map((r.items || []).map((f) => [Number(f.id), f]))
    })
    .catch(() => {})
    .finally(() => {
      entry.promise = null
      entry.at = Date.now()
      listeners.forEach((l) => l())
    })
  cache.set(kind, entry)
}

/** 파일 카드 미리보기 행(목록 응답 한 줄). 없으면 null */
export function useFilePreview(kind, fileId) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!fileId || kind === 'form') return undefined
    const l = () => tick((t) => t + 1)
    listeners.add(l)
    loadKind(kind)
    return () => listeners.delete(l)
  }, [kind, fileId])
  if (!fileId || kind === 'form') return null
  return cache.get(kind)?.map.get(Number(fileId)) || null
}
