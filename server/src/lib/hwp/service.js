// 서비스 층: 가져오기(검사·변환), 템플릿 만들기, 읽기 모델 캐시. express 에 의존하지 않는다.
import JSZip from './jszip.js'
import { loadKordoc, HwpError } from './kordoc.js'
import { sniffFormat, readDoc, MAX_FILE_BYTES } from './model.js'
import { docxToHwpx } from './convert.js'
import { alignIds, fingerprint } from './ids.js'
import { renderPageCount } from './render.js'

export const LIMITS = { MAX_FILE_BYTES, MAX_ENTRIES: 5000, MAX_UNPACKED: 300 * 1024 * 1024 }

/** ZIP 가벼운 사전 검사: 엔트리 수·풀린 크기·경로. kordoc 의 압축 폭탄 방어와 별개로 우리 한도를 먼저 적용한다 */
export async function zipPrecheck(bytes) {
  let zip
  try { zip = await JSZip.loadAsync(bytes) } catch { throw new HwpError('CORRUPTED', '파일이 손상되었거나 한글 문서가 아닙니다.', 422) }
  const names = Object.keys(zip.files)
  if (names.length > LIMITS.MAX_ENTRIES) throw new HwpError('ZIP_BOMB', '안전하지 않은 압축 파일입니다(엔트리가 너무 많습니다).', 422)
  let total = 0
  for (const n of names) {
    if (/(^|[\\/])\.\.([\\/]|$)/.test(n) || n.startsWith('/') || /^[A-Za-z]:/.test(n)) throw new HwpError('CORRUPTED', '안전하지 않은 파일 경로가 들어 있어 열 수 없습니다.', 422)
    total += zip.files[n]._data?.uncompressedSize || 0
  }
  if (total > LIMITS.MAX_UNPACKED) throw new HwpError('ZIP_BOMB', '안전하지 않은 압축 파일입니다(풀면 너무 큽니다).', 422)
}

/** 올라온 바이트를 저장 가능한 상태로: { bytes, format, warnings, converted_from, doc, pageCount } */
export async function inspectUpload(input, filename = '') {
  if (!input?.length) throw new HwpError('CORRUPTED', '빈 파일입니다.', 422)
  if (input.length > MAX_FILE_BYTES) throw new HwpError('TOO_LARGE', '파일이 너무 큽니다. 25MB 이하만 올릴 수 있습니다.', 413)
  const fmt = await sniffFormat(input)
  if (!fmt) throw new HwpError('UNSUPPORTED_FORMAT', '한글(.hwp .hwpx)과 워드(.docx) 파일만 올릴 수 있습니다.', 400)
  const warnings = []
  let bytes = input
  let format = fmt
  let converted_from = null
  if (fmt === 'docx') {
    await zipPrecheck(input)
    const c = await docxToHwpx(input)
    bytes = c.bytes
    format = 'hwpx'
    converted_from = 'docx'
    warnings.push('워드 파일을 한글(HWPX)로 바꿔 저장했습니다. 서식이 조금 다를 수 있습니다.')
  } else if (fmt === 'hwpx') await zipPrecheck(input)
  const k = await loadKordoc()
  if (format === 'hwpx') {
    const v = await k.validateHwpx(bytes)
    if (!v.ok) for (const x of v.issues) warnings.push(`구조 경고: ${x.path ? x.path + ': ' : ''}${x.message}`)
  }
  const doc = await readDoc(bytes, format) // 암호·DRM·손상은 여기서 오류로 나온다
  if (!doc.blocks.length) warnings.push('본문 블록을 찾지 못했습니다(그림만 있거나 빈 문서일 수 있습니다).')
  const pageCount = (await renderPageCount(bytes, format)) || doc.pageCount || 0
  return { bytes, format, warnings, converted_from, doc, pageCount }
}

export function firstIds(blocks) {
  const a = alignIds(null, fingerprint(blocks), 0)
  return { ids: a.ids, counter: a.counter }
}

export const TEMPLATES = [
  { id: 'gian', name: '일반기안문 (대외 시행문·협조문)' },
  { id: 'gian-simple', name: '간이기안문 (내부결재)' },
  { id: 'markdown', name: '마크다운으로 만들기 (공문 양식 선택)' },
]
export const PRESETS = ['기안문', '보고서', '계획서', '통지', '알림', '회의록', '보도자료', '업무보고', '개조식', '방침서']
const OPTION_KEYS = ['docHead', 'docFoot', 'approval', 'noticeHead', 'press', 'bodyFont', 'bodyPt', 'lineSpacing', 'numbering', 'cover', 'toc', 'summary', 'pageNumbers', 'endMark', 'bullet2', 'levels']
const clean = (v, d = 0) => {
  if (v == null) return undefined
  if (typeof v === 'string') return v.slice(0, 300)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, d + 1)).filter((x) => x !== undefined)
  if (typeof v === 'object' && d < 3) return Object.fromEntries(Object.entries(v).slice(0, 30).map(([a, b]) => [a, clean(b, d + 1)]).filter(([, b]) => b !== undefined))
  return undefined
}

export async function templateInfo() {
  const k = await loadKordoc()
  const out = []
  for (const id of ['gian', 'gian-simple']) {
    const t = k.resolveBuiltinTemplate(id)
    const bytes = await k.readBuiltinTemplate(t)
    const fields = await k.extractClickHereFields(bytes)
    out.push({ id, name: t.title, fields: fields.map((f) => ({ name: f.name, hint: f.placeholder || '' })) })
  }
  out.push({ id: 'markdown', name: TEMPLATES[2].name, presets: PRESETS })
  return out
}

export async function buildFromTemplate({ template, values, markdown, preset, options }) {
  const k = await loadKordoc()
  if (template === 'gian' || template === 'gian-simple') {
    const t = k.resolveBuiltinTemplate(template)
    const bytes = await k.readBuiltinTemplate(t)
    const vals = {}
    if (values && typeof values === 'object') for (const [a, b] of Object.entries(values).slice(0, 100)) vals[String(a).slice(0, 80)] = Array.isArray(b) ? b.map((x) => String(x).slice(0, 5000)) : String(b ?? '').slice(0, 5000)
    const r = Object.keys(vals).length ? await k.fillHwpx(bytes, vals) : { buffer: bytes, unmatched: [] }
    return { bytes: new Uint8Array(r.buffer), warnings: (r.unmatched || []).length ? [`채우지 못한 칸: ${r.unmatched.join(', ')}`] : [], title: t.title.split(' — ')[0] }
  }
  if (template === 'markdown') {
    const md = String(markdown || '')
    if (!md.trim()) throw new HwpError('BAD_REQUEST', '마크다운 본문이 비어 있습니다.', 400)
    if (md.length > 500 * 1024) throw new HwpError('TOO_LARGE', '본문이 너무 깁니다(500KB 이하).', 413)
    const p = PRESETS.includes(preset) ? preset : '보고서'
    const opts = Object.fromEntries(Object.entries(options && typeof options === 'object' ? options : {}).filter(([a]) => OPTION_KEYS.includes(a)).map(([a, b]) => [a, clean(b)]))
    const out = await k.markdownToHwpx(md, { gongmun: { preset: p, ...opts } })
    return { bytes: new Uint8Array(out), warnings: [], title: '새 한글 문서' }
  }
  throw new HwpError('BAD_REQUEST', `알 수 없는 템플릿입니다: ${template}`, 400)
}

// ── 읽기 모델 캐시(인스턴스 안): 같은 (파일, 버전)을 반복해서 파싱하지 않는다 ──
const cache = new Map()
const CACHE_MAX = 6
export function cacheGet(key) { const v = cache.get(key); if (v) { cache.delete(key); cache.set(key, v) } return v }
export function cacheSet(key, val) { cache.set(key, val); while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value) }
export function cacheDrop(prefix) { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k) }
