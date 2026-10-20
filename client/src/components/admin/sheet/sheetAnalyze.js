// sheetAnalyze.js: analyze_range 가 쓰는 순수 계산. 모델이 직접 셈하지 않도록 열별 통계를 코드로 낸다(DOM 없음).
// 입력은 "화면에 보이는 값" 2차원 배열(수식은 이미 계산된 값)이다.
import { colLetter } from './sheetUtils.js'
import { cellName, isBlank, parseDateText } from './sheetModel.js'

const ERR_RE = /^#(DIV\/0!|N\/A|NAME\?|NUM!|REF!|VALUE!|ERROR!|NULL!)/
const fix = (n) => (Number.isFinite(n) ? Number(n.toPrecision(12)) : n)

/** 칸 글 하나를 분류한다 -> {t:'blank'|'error'|'bool'|'number'|'date'|'text', v, pct} */
export function classify(raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return { t: 'blank' }
  if (ERR_RE.test(s)) return { t: 'error', v: s }
  if (/^(TRUE|FALSE)$/i.test(s)) return { t: 'bool', v: s.toUpperCase() === 'TRUE' }
  const d = parseDateText(s)
  if (d) return { t: 'date', v: d }
  let t = s
  let pct = false
  if (t.endsWith('%')) {
    pct = true
    t = t.slice(0, -1).trim()
  }
  t = t.replace(/^[₩$]\s*/, '').replace(/\s*원$/, '')
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t) || /^[-+]?\.\d+$/.test(t)) {
    const n = Number(t.replace(/,/g, ''))
    if (Number.isFinite(n)) return { t: 'number', v: n, pct }
  }
  return { t: 'text', v: s }
}

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * matrix: 값 글의 2차원 배열, origin: 왼쪽 위 칸 {c, r}(r 은 시트 행 번호)
 * header: true | false | 'auto'
 */
export function analyzeMatrix(matrix, { origin = { c: 0, r: 1 }, header = 'auto', maxCols = 40 } = {}) {
  const rows = matrix.length
  const width = rows ? Math.max(...matrix.map((r) => r.length)) : 0
  const cls = matrix.map((line) => Array.from({ length: width }, (_, j) => classify(line[j])))
  let hasHeader = header === true
  if (header === 'auto' && rows >= 2) {
    const first = cls[0]
    const textAll = first.every((x) => x.t === 'text')
    // 머리글 후보 줄의 모든 칸이 글이고, 아래 줄에 숫자·날짜가 있거나 첫 줄 글이 아래에 다시 나오지 않으면 머리글
    const below = cls.slice(1)
    const typed = below.some((line) => line.some((x) => x.t === 'number' || x.t === 'date' || x.t === 'bool'))
    const names = new Set(first.map((x) => x.v))
    const reused = below.some((line) => line.some((x) => x.t === 'text' && names.has(x.v)))
    hasHeader = textAll && (typed || !reused)
  }
  const start = hasHeader ? 1 : 0
  const dataRows = rows - start
  const columns = []
  for (let j = 0; j < Math.min(width, maxCols); j += 1) {
    const col = { col: colLetter(origin.c + j), name: hasHeader ? String(matrix[0][j] ?? '') : null }
    const cells = []
    for (let i = start; i < rows; i += 1) cells.push({ ...cls[i][j], ref: cellName(origin.c + j, origin.r + i), raw: matrix[i][j] })
    const filled = cells.filter((x) => x.t !== 'blank')
    col.count = filled.length
    col.blank = cells.length - filled.length
    const typeCount = {}
    for (const x of filled) typeCount[x.t] = (typeCount[x.t] || 0) + 1
    const entries = Object.entries(typeCount).sort((a, b) => b[1] - a[1])
    const [topType, topN] = entries[0] || ['empty', 0]
    col.type = !filled.length ? 'empty' : topN / filled.length >= 0.8 ? topType : 'mixed'
    if (col.type === 'mixed') col.types = typeCount
    else if (entries.length > 1) col.types = typeCount
    const errs = filled.filter((x) => x.t === 'error')
    if (errs.length) col.errors = errs.slice(0, 5).map((x) => `${x.ref} ${x.v}`)
    const distinct = new Map()
    for (const x of filled) {
      const key = String(x.raw).trim()
      distinct.set(key, (distinct.get(key) || 0) + 1)
    }
    col.distinct = distinct.size
    const nums = filled.filter((x) => x.t === 'number')
    if (nums.length && (col.type === 'number' || col.type === 'mixed')) {
      const vals = nums.map((x) => x.v)
      const sorted = [...vals].sort((a, b) => a - b)
      const sum = vals.reduce((a, b) => a + b, 0)
      const mean = sum / vals.length
      const minCell = nums.reduce((a, b) => (b.v < a.v ? b : a))
      const maxCell = nums.reduce((a, b) => (b.v > a.v ? b : a))
      col.numeric = {
        count: vals.length,
        sum: fix(sum),
        mean: fix(mean),
        median: fix(quantile(sorted, 0.5)),
        min: fix(minCell.v),
        minAt: minCell.ref,
        max: fix(maxCell.v),
        maxAt: maxCell.ref,
      }
      if (vals.length > 1) col.numeric.stdev = fix(Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)))
      if (nums.some((x) => x.pct)) col.numeric.unit = '%(퍼센트 칸의 숫자는 12% 가 12 로 계산됨)'
      if (vals.length >= 6) {
        const q1 = quantile(sorted, 0.25)
        const q3 = quantile(sorted, 0.75)
        const iqr = q3 - q1
        const lo = q1 - 1.5 * iqr
        const hi = q3 + 1.5 * iqr
        const out = nums.filter((x) => x.v < lo || x.v > hi)
        if (out.length && iqr > 0) col.outliers = out.slice(0, 5).map((x) => ({ at: x.ref, value: fix(x.v) }))
      }
    }
    const dates = filled.filter((x) => x.t === 'date').map((x) => x.v).sort()
    if (dates.length && (col.type === 'date' || col.type === 'mixed')) {
      col.dates = { earliest: dates[0], latest: dates[dates.length - 1], spanDays: Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000) }
    }
    if (col.type === 'bool') col.bools = { TRUE: filled.filter((x) => x.v === true).length, FALSE: filled.filter((x) => x.v === false).length }
    const freq = [...distinct.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ko'))
    if (col.type !== 'number' || col.distinct <= 12) col.top = freq.slice(0, 5).map(([value, n]) => ({ value: value.length > 40 ? `${value.slice(0, 40)}…` : value, count: n }))
    if (filled.length && col.distinct === filled.length && filled.length > 3 && (col.type === 'text' || col.type === 'number')) col.unique = true
    // 앞뒤 공백이나 대소문자만 다른 값(정리 후보)
    const folded = new Map()
    for (const k of distinct.keys()) {
      const f = k.replace(/\s+/g, ' ').toLowerCase()
      folded.set(f, (folded.get(f) || 0) + 1)
    }
    const near = [...folded.values()].filter((n) => n > 1).length
    if (near) col.nearDuplicates = near
    const padded = filled.filter((x) => typeof x.raw === 'string' && x.raw !== x.raw.trim()).length
    if (padded) col.untrimmed = padded
    columns.push(col)
  }
  const totalBlankRows = cls.slice(start).filter((line) => line.every((x) => x.t === 'blank')).length
  const out = { rows: dataRows, columns: width, header: hasHeader, headerRowIsSheetRow: hasHeader ? origin.r : null, columnsInfo: columns }
  if (totalBlankRows) out.blankRows = totalBlankRows
  if (width > maxCols) out.note = `열이 ${width}개라 앞 ${maxCols}개만 분석했습니다`
  const keyed = new Map()
  let fullDup = 0
  for (let i = start; i < rows; i += 1) {
    if (cls[i].every((x) => x.t === 'blank')) continue
    const k = JSON.stringify(matrix[i].map((x) => String(x ?? '').trim()))
    if (keyed.has(k)) fullDup += 1
    else keyed.set(k, i)
  }
  if (fullDup) out.duplicateRows = fullDup
  return out
}

/** 분석 결과를 모델에게 줄 압축 글로 만든다 */
export function formatAnalysis(a, rangeText) {
  const lines = [`${rangeText}: 데이터 ${a.rows}행 x ${a.columns}열, 머리글 ${a.header ? `있음(${a.headerRowIsSheetRow}행)` : '없음'}${a.blankRows ? `, 빈 행 ${a.blankRows}` : ''}${a.duplicateRows ? `, 완전히 같은 행 ${a.duplicateRows}` : ''}`]
  for (const c of a.columnsInfo) {
    const parts = [`${c.col}${c.name ? ` "${c.name}"` : ''}: ${c.type}`, `값 ${c.count}`, c.blank ? `빈칸 ${c.blank}` : null, `고유 ${c.distinct}`]
    if (c.numeric) {
      const n = c.numeric
      parts.push(`합계 ${n.sum}`, `평균 ${n.mean}`, `중앙값 ${n.median}`, `최소 ${n.min}(${n.minAt})`, `최대 ${n.max}(${n.maxAt})`)
      if (n.stdev !== undefined) parts.push(`표준편차 ${n.stdev}`)
      if (n.unit) parts.push(n.unit)
    }
    if (c.dates) parts.push(`날짜 ${c.dates.earliest} ~ ${c.dates.latest}(${c.dates.spanDays}일)`)
    if (c.bools) parts.push(`TRUE ${c.bools.TRUE} / FALSE ${c.bools.FALSE}`)
    if (c.types && c.type === 'mixed') parts.push(`섞임 ${Object.entries(c.types).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    else if (c.types) parts.push(`다른 종류도 있음 ${Object.entries(c.types).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    if (c.top?.length) parts.push(`많은 값 ${c.top.map((t) => `${t.value}(${t.count})`).join(', ')}`)
    if (c.outliers) parts.push(`이상치 ${c.outliers.map((o) => `${o.at}=${o.value}`).join(', ')}`)
    if (c.errors) parts.push(`오류 ${c.errors.join(', ')}`)
    if (c.nearDuplicates) parts.push(`공백이나 대소문자만 다른 값 ${c.nearDuplicates}묶음`)
    if (c.untrimmed) parts.push(`앞뒤 공백 ${c.untrimmed}칸`)
    lines.push(parts.filter(Boolean).join(' | '))
  }
  if (a.note) lines.push(a.note)
  return lines.join('\n')
}

export { isBlank }
