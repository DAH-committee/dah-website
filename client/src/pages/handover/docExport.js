// 내보내기·가져오기 연결(한글 HWPX / Word DOCX).
//   편집기 JSON -> tiptapToIR -> writeHwpx | writeDocx -> 내려받기
//   .docx | .hwpx -> readDocx | readHwpx -> irToTiptap -> 새 탭
// 작성기·읽기기는 다른 담당이 만든다. 파일이 아직 없어도 빌드가 되도록 import.meta.glob 으로 있는 것만 불러온다.

import { tiptapToIR, collectImageSrcs } from '../../lib/docIR/tiptapToIR'
import { irToTiptap } from '../../lib/docIR/irToTiptap'
import { isStandard, metricsOf, normHwp } from '../hwp/hwpDoc'
import { chipText, fillTokens } from '../hwp/hwpVars'
import { API_BASE } from '../../hooks/useApi'

const MODULES = import.meta.glob(['../../lib/docIR/writeDocx.js', '../../lib/docIR/writeHwpx.js', '../../lib/docIR/readDocx.js', '../../lib/docIR/readHwpx.js'])
const loadModule = async (name) => {
  const key = Object.keys(MODULES).find((k) => k.endsWith(`/${name}.js`))
  if (!key) return null
  try {
    return await MODULES[key]()
  } catch {
    return null
  }
}

export const FORMATS = {
  hwpx: { label: '한글(HWPX)', ext: 'hwpx', mime: 'application/hwp+zip' },
  docx: { label: 'Word(DOCX)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
}

const FMT_KEY = (docId) => `gd-export-format:${docId}`
export const getDefaultFormat = (docId) => {
  try { return localStorage.getItem(FMT_KEY(docId)) === 'docx' ? 'docx' : 'hwpx' } catch { return 'hwpx' }
}
export const setDefaultFormat = (docId, f) => {
  try { localStorage.setItem(FMT_KEY(docId), f) } catch { /* 저장 불가 */ }
}

const absUrl = (u) => (u && u.startsWith('/') ? `${window.location.origin}${u}` : u)

// 그림 주소 -> { mime, data, w, h }. PNG·JPEG 은 그대로, 그 밖(webp, svg 등)은 PNG 로 바꾼다. 긴 변 2000px 초과면 줄인다.
export async function resolveImage(url) {
  try {
    if (/^data:/.test(url)) {
      const blob = await (await fetch(url)).blob()
      return await blobToAsset(blob)
    }
    const res = await fetch(absUrl(url), { credentials: url.startsWith('/') ? 'include' : 'omit' })
    if (!res.ok) return null
    return await blobToAsset(await res.blob())
  } catch {
    return null
  }
}

async function blobToAsset(blob) {
  const bmp = await createImageBitmap(blob)
  const long = Math.max(bmp.width, bmp.height)
  const okType = blob.type === 'image/png' || blob.type === 'image/jpeg'
  if (okType && long <= 2000 && blob.size < 4 * 1024 * 1024) {
    return { mime: blob.type, data: new Uint8Array(await blob.arrayBuffer()), w: bmp.width, h: bmp.height }
  }
  const k = Math.min(1, 2000 / long)
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d').drawImage(bmp, 0, 0, w, h)
  const out = await new Promise((r) => c.toBlob(r, 'image/png'))
  return { mime: 'image/png', data: new Uint8Array(await out.arrayBuffer()), w, h }
}

/** 편집기 문서 + 설정 -> IR */
export async function buildIR(json, { hwp, page, title }) {
  const settings = normHwp(hwp)
  const preset = settings.mode === 'hwp' ? { key: settings.preset, standard: isStandard(settings.preset), metrics: metricsOf(settings.preset) } : null
  const srcs = collectImageSrcs(json, page)
  const assets = {}
  await Promise.all(srcs.map(async (s) => { const a = await resolveImage(s); if (a) assets[s] = a }))
  return tiptapToIR(json, { title, hwp: settings, page, preset, assets, vars: settings.vars, chipText, fillTokens })
}

export function download(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

/** 요약 알림 글: 같은 알림은 한 번만, 최대 3건 */
export function summarizeIssues(issues) {
  const seen = []
  for (const i of issues || []) if (i.level !== 'info' && !seen.includes(i.msg)) seen.push(i.msg)
  if (!seen.length) return ''
  const head = seen.slice(0, 3).join(' / ')
  return seen.length > 3 ? `${head} 외 ${seen.length - 3}건` : head
}

/**
 * 내보내기. progress(text) 로 단계 알림. 돌려주는 값 { filename, issues, fallback }
 * fallback: 새 작성기를 쓰지 못해 옛 방식으로 만들었다는 뜻
 */
export async function exportDocument(format, { editor, hwp, page, title, fileBase, progress, legacy }) {
  const json = editor.getJSON()
  progress?.(`${FORMATS[format].label} 파일 만드는 중`)
  const writer = await loadModule(format === 'hwpx' ? 'writeHwpx' : 'writeDocx')
  const fn = writer && (format === 'hwpx' ? writer.writeHwpx : writer.writeDocx)
  if (!fn) {
    if (!legacy?.[format]) throw new Error(`${FORMATS[format].label} 작성기를 불러오지 못했습니다`)
    await legacy[format]()
    return { filename: `${fileBase}.${FORMATS[format].ext}`, issues: [], fallback: true }
  }
  const { ir, issues } = await buildIR(json, { hwp, page, title })
  const bytes = await fn(ir, { title })
  const filename = `${fileBase}.${FORMATS[format].ext}`
  download(new Blob([bytes], { type: FORMATS[format].mime }), filename)
  return { filename, issues, fallback: false }
}

/** 가져오기. 새 읽기기를 쓸 수 있으면 { json, title, issues } 를 돌려주고, 아니면 null(옛 방식으로 넘어감) */
export async function importDocument(file, { upload }) {
  const lower = file.name.toLowerCase()
  const kind = lower.endsWith('.docx') ? 'docx' : lower.endsWith('.hwpx') ? 'hwpx' : null
  if (!kind) return null
  const mod = await loadModule(kind === 'docx' ? 'readDocx' : 'readHwpx')
  const fn = mod && (kind === 'docx' ? mod.readDocx : mod.readHwpx)
  if (!fn) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ir = await fn(bytes, { name: file.name })
  const assetSrc = {}
  const issues = []
  for (const [id, a] of Object.entries(ir.assets || {})) {
    try {
      const data = typeof a.data === 'string' ? Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0)) : a.data
      const f = new File([data], `${id}.${(a.mime || 'image/png').split('/')[1].replace('jpeg', 'jpg')}`, { type: a.mime || 'image/png' })
      assetSrc[id] = (await upload(f)).url
    } catch {
      issues.push({ level: 'warn', msg: '그림 일부를 올리지 못했습니다' })
    }
  }
  const json = irToTiptap(ir, { assetSrc, issues })
  const title = String(ir.meta?.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 60)
  return { json, title, issues, page: json.page }
}

/**
 * 한글 미리보기: 내보내기와 같은 작성기로 HWPX 를 만들어 서버(kordoc)가 쪽별 그림(SVG)으로 그리게 한다.
 * 돌려주는 값 { pages: [svg...], pageCount, warnings, issues } . 작성기를 못 불러오면 null(옛 방식으로 넘어감)
 */
export async function previewDocument({ editor, hwp, page, title }) {
  const writer = await loadModule('writeHwpx')
  if (!writer?.writeHwpx) return null
  const { ir, issues } = await buildIR(editor.getJSON(), { hwp, page, title })
  const bytes = await writer.writeHwpx(ir, { title })
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: FORMATS.hwpx.mime }), 'preview.hwpx')
  const res = await fetch(`${API_BASE}/hwpx/render`, { method: 'POST', credentials: 'include', body: fd })
  if (!res.ok) {
    let msg = `요청 실패 (${res.status})`
    try { const j = await res.json(); msg = j?.error?.message || j?.error || msg } catch { /* 본문 없음 */ }
    throw new Error(msg)
  }
  const j = await res.json()
  return { pages: (j.pages || []).map((x) => x.svg), pageCount: j.pageCount, warnings: j.warnings || [], issues }
}
