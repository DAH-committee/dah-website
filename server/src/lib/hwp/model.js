// 읽기 모델: kordoc 파싱 결과를 안정 id 가 붙은 블록 목록으로 바꾼다.
import { loadKordoc, HwpError, fromKordocFailure } from './kordoc.js'

// 표는 원본 구조 그대로(keep), 끝의 빈 열도 남긴다 → 편집 가능한 칸과 1:1
export const PARSE_OPTS = { layoutTables: 'keep', keepTrailingEmptyCols: true, images: false, ocr: false }

export const MAX_FILE_BYTES = 25 * 1024 * 1024

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const isOle2 = (b) => b.length > 8 && OLE2.every((v, i) => b[i] === v)
const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5)

/** 'hwpx' | 'hwp' | 'docx' | null (매직 바이트 + ZIP 내부 구조) */
export async function sniffFormat(bytes) {
  const k = await loadKordoc()
  if (isOle2(bytes)) {
    const f = k.detectOle2Format ? k.detectOle2Format(bytes) : 'hwp'
    return f === 'hwp' ? 'hwp' : null
  }
  if (isZip(bytes)) {
    const f = await k.detectZipFormat(bytes)
    if (f === 'hwpx' || f === 'docx') return f
  }
  return null
}

export const unesc = (s) => String(s ?? '').replace(/\\\$/g, '$')

/** 표 격자: 병합으로 덮인 칸을 표시한다 */
export function gridOf(table) {
  const rows = table.rows, cols = table.cols
  const covered = Array.from({ length: rows }, () => new Array(cols).fill(null))
  const out = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) {
      const cell = table.cells?.[r]?.[c]
      if (covered[r][c]) { row.push({ covered: covered[r][c] }); continue }
      if (!cell) { row.push({ covered: null, missing: true }); continue }
      const rs = Math.max(1, cell.rowSpan || 1), cs = Math.max(1, cell.colSpan || 1)
      for (let rr = r; rr < Math.min(rows, r + rs); rr++) for (let cc = c; cc < Math.min(cols, c + cs); cc++) if (rr !== r || cc !== c) covered[rr][cc] = [r, c]
      row.push({ cell, r, c, rs, cs })
    }
    out.push(row)
  }
  return out
}

/** 원본 바이트를 읽는다. HWPX 는 세션(블록 편집 가능성, 원본 위치)을 함께 연다. */
export async function readDoc(bytes, format, { session = true } = {}) {
  const k = await loadKordoc()
  const r = await k.parse(Buffer.from(bytes), PARSE_OPTS)
  if (!r.success) throw fromKordocFailure(r)
  let blocks = r.blocks
  let sess = null
  let caps = null
  if (format === 'hwpx' && session) {
    try {
      // 편집은 세션의 블록 번호 기준이라 읽기 모델도 세션 블록을 쓴다(파서 결과와 개수가 다를 수 있다)
      sess = await k.openHwpxDocument(bytes)
      blocks = sess.blocks
      caps = sess.capabilities()
    } catch {
      sess = null
    }
  }
  return { raw: r, blocks, session: sess, caps, metadata: r.metadata || {}, pageCount: r.pageCount || r.metadata?.pageCount || 0, pageMode: r.metadata?.pageMode, markdown: r.markdown, format }
}

function cellEditable(cap, r, c) {
  const x = cap?.cells?.[r]?.[c]
  if (!x) return { editable: true }
  return x.editable ? { editable: true } : { editable: false, reason: x.reason }
}

/** API 블록 하나 */
export function presentBlock(b, id, index, cap) {
  const out = { id, index, type: b.type === 'list' ? 'list' : b.type }
  if (b.level) out.level = b.level
  if (b.pageNumber) out.page = b.pageNumber
  if (b.type === 'table' && b.table) {
    const g = gridOf(b.table)
    out.table = {
      rows: b.table.rows, cols: b.table.cols, has_header: Boolean(b.table.hasHeader),
      cells: g.map((row, r) => row.map((x, c) => {
        const cid = `${id}#r${r}c${c}`
        if (x.covered) return { id: cid, row: r, col: c, covered: `${id}#r${x.covered[0]}c${x.covered[1]}` }
        if (x.missing) return { id: cid, row: r, col: c, covered: null }
        const o = { id: cid, row: r, col: c, text: unesc(x.cell.text) }
        if (x.rs > 1) o.rowSpan = x.rs
        if (x.cs > 1) o.colSpan = x.cs
        if (x.cell.isHeader) o.header = true
        Object.assign(o, cellEditable(cap, r, c))
        if (x.cell.blocks?.some((q) => q.type === 'table')) o.nested_table = true
        return o
      })),
    }
    out.editable = cap ? cap.capability : 'cell-text'
  } else {
    out.text = unesc(b.text)
    if (b.type === 'image') out.editable = 'locked'
    else out.editable = cap ? cap.capability : 'text'
  }
  if (cap?.reason) out.reason = cap.reason
  if (b.style && Object.keys(b.style).length) out.style = b.style
  return out
}

export const plainTextOf = (b) => (b.type === 'table' ? (b.table.cells || []).map((r) => r.map((c) => unesc(c.text)).join(' | ')).join('\n') : unesc(b.text))
