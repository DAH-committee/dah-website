// sheetModel.js: 시트 내용을 읽고 바꾸는 순수 함수 모음(DOM, React 없음). AI 도구와 시험이 함께 쓴다.
//
// 상태(state) 모양: { sheets:[{id,label,columns:[{key,label,width}],rows:[{id,cells:{[key]:string}}],nextId}], nextSheet, ui:{[sheetId]:화면상태}, activeId }
//   - 1행은 머리글(열 이름)이고 데이터는 2행부터다. 칸 값은 모두 글(문자열)이며 "="로 시작하면 수식이다.
//   - 열은 시트의 columns 뒤에 화면 상태(ui.customCols)의 메모 열이 이어진다.
//   - 모든 바꾸기 함수는 새 state 를 돌려주고 원본은 건드리지 않는다. 그래서 되돌리기는 이전 state 로 돌아가면 된다.
//   - 문제가 있으면 SheetApiError(한국어, 모델이 호출을 고칠 수 있는 안내)를 던진다.
import { FILL_COLORS, FONT_SIZES, TEXT_COLORS, colLetter, normalizeSheetUi } from './sheetUtils.js'
import { colIndex, isFormulaText, mapRefs, quoteSheetName, renameSheetInFormula, sameName, shiftForStructure, translateFormula } from './sheetFormulaRefs.js'

export class SheetApiError extends Error {}
export const fail = (msg) => {
  throw new SheetApiError(msg)
}

export const MAX_ROWS = 5000
export const MAX_COLS = 200
export const MAX_SHEETS = 30
export const MAX_CELL_CHARS = 10000
export const PLACEHOLDER_LABEL = /^열 \d+$/
const clone = (v) => JSON.parse(JSON.stringify(v))

// ── A1 주소 ───────────────────────────────────────────────
/** "B7" -> {c:1, r:7}. r 은 시트 행 번호(1이 머리글). 잘못된 글이면 null */
export function parseCell(text) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(text ?? '').trim())
  if (!m) return null
  const r = Number(m[2])
  if (r < 1) return null
  return { c: colIndex(m[1]), r }
}
export const cellName = (c, r) => `${colLetter(c)}${r}`

/**
 * 범위 글 -> {c0, c1, r0, r1}. 끝이 열려 있으면 c1 또는 r1 이 null.
 * 지원: A1, A1:C5, A:C, A2:A(아래 끝까지), 3:7(행 범위)
 */
export function parseRange(text) {
  const t = String(text ?? '').trim().replace(/\$/g, '')
  if (!t) return null
  let m = /^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+)?)?$/.exec(t)
  if (m) {
    const c0 = colIndex(m[1])
    const r0 = Number(m[2])
    if (r0 < 1) return null
    if (m[3] === undefined) return { c0, c1: c0, r0, r1: r0 }
    const c1 = colIndex(m[3])
    const r1 = m[4] === undefined ? null : Number(m[4])
    return norm({ c0, c1, r0, r1 })
  }
  m = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(t)
  if (m) return norm({ c0: colIndex(m[1]), c1: colIndex(m[2]), r0: 1, r1: null })
  m = /^(\d+):(\d+)$/.exec(t)
  if (m) return norm({ c0: 0, c1: null, r0: Number(m[1]), r1: Number(m[2]) })
  return null
}
function norm(g) {
  const o = { ...g }
  if (o.c1 != null && o.c0 > o.c1) [o.c0, o.c1] = [o.c1, o.c0]
  if (o.r1 != null && o.r0 > o.r1) [o.r0, o.r1] = [o.r1, o.r0]
  return o
}
export function rangeName(g) {
  if (g.c0 === g.c1 && g.r0 === g.r1) return cellName(g.c0, g.r0)
  return `${cellName(g.c0, g.r0)}:${cellName(g.c1, g.r1)}`
}

/** "시트2!A1:B3" 또는 "'내 시트'!A1" -> {sheet, range} */
export function splitSheetPrefix(text) {
  const s = String(text ?? '').trim()
  const m = /^(?:'((?:[^']|'')+)'|([^!'\s][^!]*?))!(.*)$/.exec(s)
  if (!m) return { sheet: null, range: s }
  return { sheet: (m[1] ?? m[2]).replace(/''/g, "'"), range: m[3].trim() }
}

// ── 시트 찾기와 읽기 ─────────────────────────────────────
export function sheetNames(state) {
  return state.sheets.map((s) => s.label)
}
/** ref: 시트 이름(또는 id). 비우면 지금 보는 시트 */
export function findSheet(state, ref) {
  if (ref == null || String(ref).trim() === '') {
    const s = state.sheets.find((x) => x.id === state.activeId) || state.sheets[0]
    if (!s) fail('시트가 없습니다')
    return s
  }
  const t = String(ref).trim()
  const hit = state.sheets.find((s) => s.id === t) || state.sheets.find((s) => s.label === t) || state.sheets.find((s) => sameName(s.label, t))
  if (!hit) fail(`"${t}" 시트를 찾을 수 없습니다. 있는 시트: ${sheetNames(state).map((n) => `"${n}"`).join(', ')}`)
  return hit
}

export function uiOf(state, sheet) {
  return normalizeSheetUi(state.ui?.[sheet.id])
}
/** 열 목록: 시트 열 + 메모 열 */
export function columnsOf(state, sheet) {
  const ui = uiOf(state, sheet)
  return [
    ...sheet.columns.map((c) => ({ key: c.key, label: c.label, custom: false })),
    ...ui.customCols.map((c) => ({ key: c.key, label: c.label, custom: true })),
  ]
}
export const realColCount = (sheet) => sheet.columns.length

/** 한 칸의 원본 글. r 은 시트 행 번호(1 = 머리글) */
export function rawAt(state, sheet, c, r, cols) {
  const list = cols || columnsOf(state, sheet)
  const col = list[c]
  if (!col || r < 1) return ''
  if (r === 1) return col.label ?? ''
  const row = sheet.rows[r - 2]
  if (!row) return ''
  if (col.custom) return String(uiOf(state, sheet).customValues[String(row.id)]?.[col.key] ?? '')
  return String(row.cells?.[col.key] ?? '')
}
export const isBlank = (v) => v == null || String(v).trim() === ''

/** 머리글이 기본 이름("열 3")이면 비어 있는 것으로 본다 */
export function isPlaceholderHeader(v) {
  return PLACEHOLDER_LABEL.test(String(v ?? '').trim())
}
/** AI 에게 보이는 칸 글: 기본 머리글은 빈 칸으로 */
export function visibleRaw(state, sheet, c, r, cols) {
  const v = rawAt(state, sheet, c, r, cols)
  return r === 1 && isPlaceholderHeader(v) ? '' : v
}

/** 쓰인 영역: {rows: 마지막 행 번호, cols: 열 개수, empty} */
export function usedRange(state, sheet) {
  const cols = columnsOf(state, sheet)
  let lastR = 0
  let lastC = -1
  for (let c = 0; c < cols.length; c += 1) {
    if (!isBlank(visibleRaw(state, sheet, c, 1, cols))) {
      lastR = Math.max(lastR, 1)
      lastC = Math.max(lastC, c)
    }
  }
  const ui = uiOf(state, sheet)
  sheet.rows.forEach((row, i) => {
    const r = i + 2
    for (let c = 0; c < cols.length; c += 1) {
      const col = cols[c]
      const v = col.custom ? ui.customValues[String(row.id)]?.[col.key] : row.cells?.[col.key]
      if (!isBlank(v)) {
        lastR = Math.max(lastR, r)
        lastC = Math.max(lastC, c)
      }
    }
  })
  return { rows: lastR, cols: lastC + 1, empty: lastR === 0, totalCols: cols.length, totalRows: sheet.rows.length + 1 }
}

/** 범위 글을 시트 크기에 맞춰 닫는다. 비어 있거나 잘못이면 안내 오류 */
export function resolveRange(state, sheet, text, { allowEmpty = false, defaultUsed = true, usedOf } = {}) {
  const { sheet: prefixSheet, range } = splitSheetPrefix(text)
  const target = prefixSheet ? findSheet(state, prefixSheet) : sheet
  const usedFor = (s) => (usedOf ? usedOf(s) : usedRange(state, s))
  if (!range) {
    if (!defaultUsed) fail('범위(예: A1:C10)를 알려 주세요')
    const u = usedFor(target)
    if (u.empty) {
      if (allowEmpty) return { sheet: target, g: { c0: 0, c1: 0, r0: 1, r1: 1 } }
      fail('이 시트는 비어 있습니다')
    }
    return { sheet: target, g: { c0: 0, c1: u.cols - 1, r0: 1, r1: u.rows } }
  }
  const g = parseRange(range)
  if (!g) fail(`범위 "${range}" 를 읽을 수 없습니다. A1:C10, A:C, 2:10 같은 A1 표기로 써 주세요`)
  const u = usedFor(target)
  const out = { ...g }
  if (out.c1 == null) out.c1 = Math.max(out.c0, u.totalCols - 1)
  if (out.r1 == null) out.r1 = Math.max(out.r0, u.rows || 1)
  if (out.c0 > MAX_COLS - 1 || out.c1 > MAX_COLS - 1) fail(`열은 ${colLetter(MAX_COLS - 1)} 열(${MAX_COLS}개)까지 쓸 수 있습니다`)
  if (out.r1 > MAX_ROWS + 1) fail(`행은 ${MAX_ROWS + 1}행까지 쓸 수 있습니다`)
  return { sheet: target, g: out }
}

/** 범위의 원본 글 2차원 배열(기본 머리글은 빈 칸) */
export function matrixOf(state, sheet, g) {
  const cols = columnsOf(state, sheet)
  const out = []
  for (let r = g.r0; r <= g.r1; r += 1) {
    const line = []
    for (let c = g.c0; c <= g.c1; c += 1) line.push(visibleRaw(state, sheet, c, r, cols))
    out.push(line)
  }
  return out
}

// ── 값 해석(구글 시트와 비슷하게) ───────────────────────
const pad = (n) => String(n).padStart(2, '0')
function validDate(y, m, d) {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}
/** 날짜처럼 보이는 글이면 YYYY-MM-DD, 아니면 null */
export function parseDateText(s) {
  const t = String(s ?? '').trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?$/.exec(t)
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/.exec(t)
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}
/** 숫자처럼 보이는 글이면 수, 아니면 null. 쉼표, 원·₩, 퍼센트를 읽는다(퍼센트는 0.12 같은 수로) */
export function parseNumberText(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  let t = String(s ?? '').trim()
  if (!t) return null
  let pct = false
  if (t.endsWith('%')) {
    pct = true
    t = t.slice(0, -1).trim()
  }
  t = t.replace(/^[₩$]\s*/, '').replace(/\s*원$/, '')
  if (!/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t) && !/^[-+]?\.\d+$/.test(t)) return null
  const n = Number(t.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return pct ? n / 100 : n
}

/**
 * 모델이 준 값을 칸에 넣을 글로 바꾼다.
 * 숫자 -> 글자, 불리언 -> TRUE/FALSE, 날짜처럼 보이는 글 -> YYYY-MM-DD. asText 이면 글을 그대로 둔다.
 * 맨 앞 작은따옴표(')는 글자 고정 표시로 보고 떼어 낸다.
 */
export function cellTextFromValue(v, { asText = false } = {}) {
  if (v == null) return ''
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail('숫자가 아닌 값(무한대, NaN)은 넣을 수 없습니다')
    return String(Number(v.toPrecision(15)))
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v !== 'string') fail('value 는 글, 숫자, 참/거짓 중 하나여야 합니다. 여러 칸은 cells 배열로 나누어 주세요')
  if (asText) return v
  if (v.startsWith("'")) return v.slice(1)
  const t = v.trim()
  if (/^(true|false)$/i.test(t)) return t.toUpperCase()
  const d = parseDateText(t)
  if (d) return d
  return v
}

// ── 바꾸기(초안) ──────────────────────────────────────────
function draftOf(state, sid) {
  const sheet = clone(state.sheets.find((s) => s.id === sid))
  const ui = clone(uiOf(state, sheet))
  return {
    sheet,
    ui,
    touchedUi: false,
    commit() {
      return {
        ...state,
        sheets: state.sheets.map((s) => (s.id === sid ? sheet : s)),
        ui: this.touchedUi ? { ...(state.ui || {}), [sid]: ui } : state.ui,
      }
    },
  }
}
function newColKey(d) {
  const used = new Set([...d.sheet.columns.map((c) => c.key), ...d.ui.customCols.map((c) => c.key)])
  let n = d.sheet.columns.reduce((m, c) => Math.max(m, /^c(\d+)$/.exec(c.key) ? Number(/^c(\d+)$/.exec(c.key)[1]) : -1), -1) + 1
  while (used.has(`c${n}`)) n += 1
  return `c${n}`
}
function defaultLabel(d) {
  const nums = new Set(d.sheet.columns.map((c) => (PLACEHOLDER_LABEL.test(c.label) ? Number(c.label.split(' ')[1]) : null)))
  let n = d.sheet.columns.length + 1
  while (nums.has(n)) n += 1
  return `열 ${n}`
}
function growCols(d, upTo) {
  while (d.sheet.columns.length <= upTo) d.sheet.columns.push({ key: newColKey(d), label: defaultLabel(d), width: 140 })
}
function growRows(d, upToR) {
  while (d.sheet.rows.length < upToR - 1) {
    const id = d.sheet.nextId || d.sheet.rows.length + 1
    d.sheet.rows.push({ id, cells: {} })
    d.sheet.nextId = id + 1
  }
}
function colsOfDraft(d) {
  return [
    ...d.sheet.columns.map((c) => ({ key: c.key, custom: false })),
    ...d.ui.customCols.map((c) => ({ key: c.key, custom: true })),
  ]
}
function setRawDraft(d, c, r, raw) {
  const text = String(raw ?? '')
  if (text.length > MAX_CELL_CHARS) fail(`한 칸에는 ${MAX_CELL_CHARS}자까지 넣을 수 있습니다`)
  if (r === 1) {
    if (isFormulaText(text)) fail(`${cellName(c, r)}: 1행은 머리글(열 이름)이라 수식을 넣을 수 없습니다. 수식은 2행부터 넣어 주세요`)
    if (c >= d.sheet.columns.length) {
      if (d.ui.customCols.length) fail(`${cellName(c, r)}: 메모 열 뒤에는 머리글을 쓸 수 없습니다`)
      growCols(d, c)
    }
    d.sheet.columns[c].label = text.trim().slice(0, 40) || defaultLabel(d)
    return
  }
  const real = d.sheet.columns.length
  if (c >= real + d.ui.customCols.length) {
    if (d.ui.customCols.length) fail(`${cellName(c, r)}: 이 시트는 ${colLetter(real + d.ui.customCols.length - 1)} 열까지만 있습니다(그 뒤는 메모 열이라 열을 늘릴 수 없습니다)`)
    growCols(d, c)
  }
  growRows(d, r)
  const cols = colsOfDraft(d)
  const col = cols[c]
  const row = d.sheet.rows[r - 2]
  if (col.custom) {
    const id = String(row.id)
    const cv = { ...(d.ui.customValues[id] || {}) }
    if (text === '') delete cv[col.key]
    else cv[col.key] = text
    d.ui.customValues[id] = cv
    d.touchedUi = true
  } else if (text === '') delete row.cells[col.key]
  else row.cells[col.key] = text
}
function checkSize(d) {
  if (d.sheet.rows.length > MAX_ROWS) fail(`행은 ${MAX_ROWS}개까지 쓸 수 있습니다`)
  if (d.sheet.columns.length + d.ui.customCols.length > MAX_COLS) fail(`열은 ${MAX_COLS}개까지 쓸 수 있습니다`)
}

/** cells: [{c, r, raw}] r 은 시트 행 번호 */
export function setCells(state, sheetRef, cells) {
  const sheet = findSheet(state, sheetRef)
  const d = draftOf(state, sheet.id)
  for (const x of cells) setRawDraft(d, x.c, x.r, x.raw)
  checkSize(d)
  return { state: d.commit(), count: cells.length }
}

/** 다른 시트·같은 시트 수식 속 참조를 구조 변경에 맞춰 고친다 */
function fixFormulasForStructure(state, targetLabel, spec) {
  let changed = 0
  const fixRaw = (raw, own) => {
    if (!isFormulaText(raw)) return raw
    const out = shiftForStructure(raw, own, targetLabel, spec)
    if (out !== raw) changed += 1
    return out
  }
  const sheets = state.sheets.map((s) => {
    let touched = false
    const rows = s.rows.map((row) => {
      let cells = null
      for (const [k, v] of Object.entries(row.cells || {})) {
        const nv = fixRaw(v, s.label)
        if (nv !== v) {
          cells = cells || { ...row.cells }
          cells[k] = nv
        }
      }
      if (cells) touched = true
      return cells ? { ...row, cells } : row
    })
    return touched ? { ...s, rows } : s
  })
  // 메모 열 값에 쓴 수식도 고친다
  let ui = state.ui
  for (const s of sheets) {
    const u = ui?.[s.id]
    if (!u?.customValues) continue
    let cv = null
    for (const [id, vals] of Object.entries(u.customValues)) {
      for (const [k, v] of Object.entries(vals || {})) {
        const nv = fixRaw(v, s.label)
        if (nv !== v) {
          cv = cv || { ...u.customValues }
          cv[id] = { ...(cv[id] || vals), [k]: nv }
        }
      }
    }
    if (cv) ui = { ...ui, [s.id]: { ...u, customValues: cv } }
  }
  return { state: { ...state, sheets, ui }, changed }
}

/** 행 끼워 넣기: at 행 번호 앞에 count 개 (2 이상). 아래 행은 밀리고 수식 참조도 따라간다 */
export function insertRows(state, sheetRef, at, count) {
  const sheet = findSheet(state, sheetRef)
  if (!Number.isInteger(at) || at < 2) fail('행 삽입 위치(at)는 2 이상의 행 번호입니다(1행은 머리글). 맨 아래에 넣으려면 마지막 행 번호 + 1 을 쓰세요')
  if (!Number.isInteger(count) || count < 1 || count > 500) fail('count 는 1에서 500 사이의 정수여야 합니다')
  if (sheet.rows.length + count > MAX_ROWS) fail(`행은 ${MAX_ROWS}개까지 쓸 수 있습니다`)
  const d = draftOf(state, sheet.id)
  const index = Math.min(at - 2, d.sheet.rows.length)
  const fresh = []
  for (let i = 0; i < count; i += 1) {
    const id = d.sheet.nextId || d.sheet.rows.length + 1 + i
    fresh.push({ id, cells: {} })
    d.sheet.nextId = id + 1
  }
  d.sheet.rows.splice(index, 0, ...fresh)
  const r = fixFormulasForStructure(d.commit(), sheet.label, { axis: 'row', at, count, op: 'insert' })
  return { state: r.state, count, fixedFormulas: r.changed }
}

export function deleteRows(state, sheetRef, from, count) {
  const sheet = findSheet(state, sheetRef)
  if (!Number.isInteger(from) || from < 2) fail('지울 첫 행(from)은 2 이상입니다. 1행은 머리글이라 지울 수 없습니다')
  if (!Number.isInteger(count) || count < 1) fail('count 는 1 이상의 정수여야 합니다')
  if (from - 2 >= sheet.rows.length) fail(`${from}행은 시트 밖입니다(마지막 행 ${sheet.rows.length + 1})`)
  const d = draftOf(state, sheet.id)
  const n = Math.min(count, d.sheet.rows.length - (from - 2))
  const removed = d.sheet.rows.splice(from - 2, n)
  if (d.ui.customValues) for (const row of removed) delete d.ui.customValues[String(row.id)]
  const gone = new Set(removed.map((r) => String(r.id)))
  for (const k of Object.keys(d.ui.formats)) if (gone.has(k.split('|')[0])) delete d.ui.formats[k]
  for (const k of Object.keys(d.ui.notes)) if (gone.has(k.split('|')[0])) delete d.ui.notes[k]
  d.touchedUi = true
  const r = fixFormulasForStructure(d.commit(), sheet.label, { axis: 'row', at: from, count: n, op: 'delete' })
  return { state: r.state, count: n, fixedFormulas: r.changed }
}

/** 열 끼워 넣기: at(0부터) 앞에 count 개 */
export function insertCols(state, sheetRef, at, count) {
  const sheet = findSheet(state, sheetRef)
  if (!Number.isInteger(at) || at < 0) fail('열 삽입 위치는 0 이상(A=0)이거나 열 글자여야 합니다')
  if (!Number.isInteger(count) || count < 1 || count > 50) fail('count 는 1에서 50 사이의 정수여야 합니다')
  const d = draftOf(state, sheet.id)
  if (at > d.sheet.columns.length) fail(`${colLetter(at)} 열은 시트 끝(${colLetter(d.sheet.columns.length)})보다 뒤입니다`)
  if (d.sheet.columns.length + d.ui.customCols.length + count > MAX_COLS) fail(`열은 ${MAX_COLS}개까지 쓸 수 있습니다`)
  const fresh = []
  for (let i = 0; i < count; i += 1) {
    const col = { key: newColKey({ sheet: { columns: [...d.sheet.columns, ...fresh] }, ui: d.ui }), label: '', width: 140 }
    fresh.push(col)
  }
  d.sheet.columns.splice(at, 0, ...fresh)
  for (const col of fresh) col.label = defaultLabel(d)
  // 같은 번호가 겹치지 않게 다시 매긴다
  const used = new Set(d.sheet.columns.filter((c) => !fresh.includes(c)).map((c) => c.label))
  let k = d.sheet.columns.length
  for (const col of fresh) {
    while (used.has(`열 ${k}`)) k += 1
    col.label = `열 ${k}`
    used.add(col.label)
  }
  const r = fixFormulasForStructure(d.commit(), sheet.label, { axis: 'col', at, count, op: 'insert' })
  return { state: r.state, count, fixedFormulas: r.changed }
}

export function deleteCols(state, sheetRef, from, count) {
  const sheet = findSheet(state, sheetRef)
  if (!Number.isInteger(from) || from < 0) fail('지울 첫 열(from)을 열 글자로 알려 주세요')
  if (!Number.isInteger(count) || count < 1) fail('count 는 1 이상의 정수여야 합니다')
  const d = draftOf(state, sheet.id)
  if (from + count > d.sheet.columns.length) fail(`${colLetter(from)} 열부터 ${count}개는 시트 열 범위(A-${colLetter(d.sheet.columns.length - 1)})를 넘습니다. 메모 열은 AI 가 지울 수 없습니다`)
  if (d.sheet.columns.length - count < 1) fail('열을 모두 지울 수는 없습니다')
  const removed = d.sheet.columns.splice(from, count)
  const keys = new Set(removed.map((c) => c.key))
  for (const row of d.sheet.rows) for (const k of keys) delete row.cells[k]
  for (const k of keys) delete d.ui.widths[k]
  d.ui.hidden = d.ui.hidden.filter((k) => !keys.has(k))
  for (const k of Object.keys(d.ui.formats)) if (keys.has(k.split('|')[1])) delete d.ui.formats[k]
  for (const k of Object.keys(d.ui.notes)) if (keys.has(k.split('|')[1])) delete d.ui.notes[k]
  d.touchedUi = true
  const r = fixFormulasForStructure(d.commit(), sheet.label, { axis: 'col', at: from, count, op: 'delete' })
  return { state: r.state, count, fixedFormulas: r.changed }
}

// ── 정렬 ──────────────────────────────────────────────────
function sortKey(text) {
  const n = parseNumberText(text)
  if (n !== null && String(text).trim() !== '') return { t: 0, v: n }
  const dt = parseDateText(text)
  if (dt) return { t: 1, v: dt }
  return { t: 2, v: String(text ?? '') }
}
function cmpKey(a, b) {
  if (a.t !== b.t) return a.t - b.t
  if (a.t === 0) return a.v - b.v
  return String(a.v).localeCompare(String(b.v), 'ko')
}

/**
 * 범위 정렬. 행 단위로 칸 값을 옮기고(서식은 행에 붙어 있어 따라간다) 같은 행 상대 참조는 새 위치에 맞춘다.
 * keys: [{c: 열 번호, order: 'asc'|'desc'}]. evalAt(c, r): 정렬 기준이 될 계산된 값(없으면 원본)
 */
export function sortRange(state, sheetRef, g, keys, { hasHeader = true, evalAt } = {}) {
  const sheet = findSheet(state, sheetRef)
  if (!keys?.length) fail('정렬 기준 by 가 필요합니다. 예: [{col:"C", order:"desc"}]')
  let r0 = g.r0
  if (r0 === 1) {
    if (!hasHeader) fail('1행은 머리글이라 정렬할 수 없습니다. has_header 를 true 로 하거나 범위를 2행부터 잡아 주세요')
    r0 = 2
  } else if (hasHeader) {
    // 머리글이 범위 밖에 있으면 그대로 쓴다. 범위 첫 행은 데이터다
  }
  if (r0 > g.r1) fail('정렬할 데이터 행이 없습니다')
  const lastDataRow = sheet.rows.length + 1
  const r1 = Math.min(g.r1, lastDataRow)
  if (r0 > r1) fail('정렬할 데이터 행이 없습니다')
  for (const k of keys) if (k.c < g.c0 || k.c > g.c1) fail(`정렬 기준 열 ${colLetter(k.c)} 이(가) 범위(${colLetter(g.c0)}-${colLetter(g.c1)}) 밖에 있습니다`)
  const cols = columnsOf(state, sheet)
  const rowsIdx = []
  for (let r = r0; r <= r1; r += 1) rowsIdx.push(r)
  const val = (c, r) => (evalAt ? evalAt(c, r) : rawAt(state, sheet, c, r, cols))
  const decorated = rowsIdx.map((r, i) => ({ r, i, keys: keys.map((k) => ({ k: sortKey(val(k.c, r)), blank: isBlank(val(k.c, r)), order: k.order })) }))
  decorated.sort((a, b) => {
    for (let n = 0; n < keys.length; n += 1) {
      const x = a.keys[n]
      const y = b.keys[n]
      if (x.blank !== y.blank) return x.blank ? 1 : -1
      if (x.blank && y.blank) continue
      const s = cmpKey(x.k, y.k)
      if (s !== 0) return x.order === 'desc' ? -s : s
    }
    return a.i - b.i
  })
  const moved = decorated.some((x, idx) => x.r !== rowsIdx[idx])
  if (!moved) return { state, count: rowsIdx.length, moved: false }
  const d = draftOf(state, sheet.id)
  const before = rowsIdx.map((r) => Array.from({ length: g.c1 - g.c0 + 1 }, (_, j) => rawAt(state, sheet, g.c0 + j, r, cols)))
  decorated.forEach((item, idx) => {
    const targetR = rowsIdx[idx]
    const line = before[item.r - r0]
    line.forEach((raw, j) => {
      const c = g.c0 + j
      setRawDraft(d, c, targetR, isFormulaText(raw) ? translateFormula(raw, targetR - item.r, 0) : raw)
    })
  })
  return { state: d.commit(), count: rowsIdx.length, moved: true }
}

// ── 시트 ──────────────────────────────────────────────────
function blankSheet(id, label) {
  const columns = Array.from({ length: 10 }, (_, i) => ({ key: `c${i}`, label: `열 ${i + 1}`, width: 140 }))
  return { id, label, columns, rows: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, cells: {} })), nextId: 51 }
}
function checkSheetName(state, name, exceptId) {
  const t = String(name ?? '').trim()
  if (!t) fail('시트 이름이 비어 있습니다')
  if (t.length > 30) fail('시트 이름은 30자 이내여야 합니다')
  if (/[!'[\]:*?/\\]/.test(t)) fail('시트 이름에는 ! \' [ ] : * ? / \\ 를 쓸 수 없습니다')
  if (state.sheets.some((s) => s.id !== exceptId && sameName(s.label, t))) fail(`"${t}" 시트가 이미 있습니다`)
  return t
}
export function addSheet(state, name) {
  if (state.sheets.length >= MAX_SHEETS) fail(`시트는 ${MAX_SHEETS}개까지 만들 수 있습니다`)
  const cur = state.nextSheet || state.sheets.length + 1
  let n = state.sheets.length + 1
  while (state.sheets.some((s) => s.label === `시트${n}`)) n += 1
  const label = name == null || String(name).trim() === '' ? `시트${n}` : checkSheetName(state, name)
  let id = `s${cur}`
  while (state.sheets.some((s) => s.id === id)) id += 'x'
  return { state: { ...state, sheets: [...state.sheets, blankSheet(id, label)], nextSheet: cur + 1 }, id, label }
}
export function renameSheet(state, sheetRef, name) {
  const sheet = findSheet(state, sheetRef)
  const label = checkSheetName(state, name, sheet.id)
  if (label === sheet.label) return { state, label }
  // 다른 시트 수식 속 'old'! 도 새 이름으로 고친다
  const fixRaw = (raw) => (isFormulaText(raw) ? renameSheetInFormula(raw, sheet.label, label) : raw)
  const sheets = state.sheets.map((s) => {
    const rows = s.rows.map((row) => {
      let cells = null
      for (const [k, v] of Object.entries(row.cells || {})) {
        const nv = fixRaw(v)
        if (nv !== v) {
          cells = cells || { ...row.cells }
          cells[k] = nv
        }
      }
      return cells ? { ...row, cells } : row
    })
    return { ...s, label: s.id === sheet.id ? label : s.label, rows }
  })
  return { state: { ...state, sheets }, label }
}
export function deleteSheet(state, sheetRef) {
  const sheet = findSheet(state, sheetRef)
  if (state.sheets.length <= 1) fail('시트가 하나뿐이라 지울 수 없습니다')
  const ui = { ...(state.ui || {}) }
  delete ui[sheet.id]
  const sheets = state.sheets.filter((s) => s.id !== sheet.id)
  const activeId = state.activeId === sheet.id ? sheets[0].id : state.activeId
  return { state: { ...state, sheets, ui, activeId }, label: sheet.label }
}

// ── 서식 ──────────────────────────────────────────────────
const COLOR_ALIAS = { 보라: 'accent', purple: 'accent', 회색: 'meta', gray: 'meta', grey: 'meta', 빨강: 'error', red: 'error', 기본: '', 검정: '', black: '', default: '', none: '', 없음: '' }
const FILL_ALIAS = { 보라: 'accent', purple: 'accent', 회색: 'subtle', gray: 'subtle', grey: 'subtle', 빨강: 'error', red: 'error', 없음: '', none: '', 기본: '', clear: '' }
const ALIGN_ALIAS = { left: 'left', 왼쪽: 'left', center: 'center', 가운데: 'center', right: 'right', 오른쪽: 'right' }
export const SUPPORTED_FORMATS = {
  bold: '굵게(true/false)',
  color: `글자색: ${TEXT_COLORS.map((t) => t.key || 'none').join(', ')} (accent 보라, meta 회색, error 빨강, none 기본)`,
  fill: `채우기: ${FILL_COLORS.map((t) => t.key || 'none').join(', ')} (subtle 회색, accent 보라, error 빨강, none 없음)`,
  align: 'left, center, right',
  size: `글자 크기: ${FONT_SIZES.join(', ')}`,
  wrap: '텍스트 줄바꿈(시트 전체 켬/끔)',
}
export const UNSUPPORTED_FORMATS = ['number_format', 'numberFormat', 'italic', 'underline', 'font', 'border', 'borders', 'merge', 'conditional', 'validation']

/** fmt: {bold, color, fill, align, size, wrap}. 지원하지 않는 키는 unsupported 로 돌려준다 */
export function formatRange(state, sheetRef, g, fmt) {
  const sheet = findSheet(state, sheetRef)
  const patch = {}
  const unsupported = []
  const lower = (v) => String(v ?? '').trim().toLowerCase()
  for (const [k, v] of Object.entries(fmt || {})) {
    if (v === undefined) continue
    if (k === 'bold') {
      if (typeof v !== 'boolean') fail('bold 는 true 또는 false 입니다')
      patch.b = v
    } else if (k === 'color') {
      const key = lower(v) in COLOR_ALIAS ? COLOR_ALIAS[lower(v)] : lower(v)
      if (!TEXT_COLORS.some((t) => t.key === key)) fail(`color "${v}" 는 쓸 수 없습니다. 가능: accent(보라), meta(회색), error(빨강), none(기본)`)
      patch.color = key
    } else if (k === 'fill') {
      const key = lower(v) in FILL_ALIAS ? FILL_ALIAS[lower(v)] : lower(v)
      if (!FILL_COLORS.some((t) => t.key === key)) fail(`fill "${v}" 는 쓸 수 없습니다. 가능: subtle(회색), accent(보라), error(빨강), none(없음)`)
      patch.fill = key
    } else if (k === 'align') {
      const key = ALIGN_ALIAS[lower(v)]
      if (!key) fail('align 은 left, center, right 중 하나입니다')
      patch.align = key
    } else if (k === 'size') {
      if (!FONT_SIZES.includes(Number(v))) fail(`size 는 ${FONT_SIZES.join(', ')} 중 하나입니다`)
      patch.size = Number(v)
    } else if (k === 'wrap') {
      if (typeof v !== 'boolean') fail('wrap 은 true 또는 false 입니다')
    } else unsupported.push(k)
  }
  const wrap = typeof fmt?.wrap === 'boolean' ? fmt.wrap : undefined
  if (!Object.keys(patch).length && wrap === undefined) {
    fail(`적용할 서식이 없습니다. 이 시트가 지원하는 서식: ${Object.keys(SUPPORTED_FORMATS).join(', ')}${unsupported.length ? `. 지원하지 않는 항목: ${unsupported.join(', ')}` : ''}`)
  }
  const d = draftOf(state, sheet.id)
  let cells = 0
  if (Object.keys(patch).length) {
    const cols = colsOfDraft(d)
    const r1 = Math.min(g.r1, d.sheet.rows.length + 1)
    const c1 = Math.min(g.c1, cols.length - 1)
    for (let r = Math.max(g.r0, 2); r <= r1; r += 1) {
      const row = d.sheet.rows[r - 2]
      for (let c = g.c0; c <= c1; c += 1) {
        const key = `${row.id}|${cols[c].key}`
        const merged = { ...(d.ui.formats[key] || {}), ...patch }
        for (const f of Object.keys(merged)) if (merged[f] === '' || merged[f] === false || merged[f] == null) delete merged[f]
        if (Object.keys(merged).length) d.ui.formats[key] = merged
        else delete d.ui.formats[key]
        cells += 1
      }
    }
    if (g.r0 === 1) unsupported.push('머리글 행(1행) 서식')
  }
  if (wrap !== undefined) d.ui.wrap = wrap
  d.touchedUi = true
  // 화면 상태는 서버에 200KB 까지만 저장된다. 서식이 너무 많으면 저장이 거절되므로 미리 막는다
  if (JSON.stringify(d.ui.formats).length > 120000) fail('서식을 입힌 칸이 너무 많습니다(약 3000칸이 한도). 범위를 줄이거나 열 머리글과 요약 행에만 서식을 주세요')
  return { state: d.commit(), cells, unsupported }
}

/** 열 너비·고정 열 */
export function setLayout(state, sheetRef, { widths, freezeCols } = {}) {
  const sheet = findSheet(state, sheetRef)
  const d = draftOf(state, sheet.id)
  const cols = colsOfDraft(d)
  const changed = []
  if (widths) {
    for (const [c, w] of Object.entries(widths)) {
      const idx = Number(c)
      if (!cols[idx]) fail(`${colLetter(idx)} 열이 없습니다`)
      const n = Number(w)
      if (!Number.isFinite(n) || n < 48 || n > 800) fail('열 너비는 48에서 800 사이의 숫자입니다')
      d.ui.widths[cols[idx].key] = Math.round(n)
      changed.push(colLetter(idx))
    }
  }
  if (freezeCols !== undefined) {
    if (![0, 1, 2].includes(Number(freezeCols))) fail('고정 열은 0, 1, 2 중 하나입니다(고정 행은 지원하지 않습니다)')
    d.ui.freezeCols = Number(freezeCols)
  }
  d.touchedUi = true
  return { state: d.commit(), changed }
}

// ── 채우기, 찾아 바꾸기, 중복 제거, 열 나누기 ──────────────
const addDays = (iso, n) => {
  const [y, m, dd] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, dd + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
const addMonths = (iso, n) => {
  const [y, m, dd] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(dd, last))}`
}

/**
 * 범위 채우기. fill: {formula_template} | {kind:'series', start, step, unit?} | {kind:'repeat', values} | {kind:'copy'}
 * formula_template 은 범위 왼쪽 위 칸 기준으로 쓴 수식이고 나머지 칸은 상대 참조를 옮겨 채운다.
 */
export function fillRange(state, sheetRef, g, fill) {
  const sheet = findSheet(state, sheetRef)
  if (g.r0 < 2) fail('채우기 범위는 2행부터입니다(1행은 머리글)')
  const cells = []
  const cols = columnsOf(state, sheet)
  const rows = g.r1 - g.r0 + 1
  const width = g.c1 - g.c0 + 1
  if (rows * width > 20000) fail('한 번에 채울 수 있는 칸은 20000개까지입니다')
  if (fill.formula_template != null) {
    const f = String(fill.formula_template)
    if (!isFormulaText(f)) fail('formula_template 은 "="로 시작하는 수식이어야 합니다. 값을 채우려면 pattern 을 쓰세요')
    for (let r = g.r0; r <= g.r1; r += 1) for (let c = g.c0; c <= g.c1; c += 1) cells.push({ c, r, raw: translateFormula(f, r - g.r0, c - g.c0) })
  } else if (fill.pattern) {
    const p = fill.pattern
    const kind = p.kind || p.type
    if (kind === 'series') {
      const unit = p.unit || 'day'
      const iso = parseDateText(String(p.start ?? ''))
      const step = p.step === undefined ? 1 : Number(p.step)
      if (!Number.isFinite(step)) fail('series 의 step 은 숫자입니다')
      let k = 0
      for (let r = g.r0; r <= g.r1; r += 1) {
        for (let c = g.c0; c <= g.c1; c += 1) {
          let raw
          if (iso) raw = unit === 'month' ? addMonths(iso, step * k) : addDays(iso, step * k * (unit === 'week' ? 7 : 1))
          else {
            const n = Number(p.start)
            if (!Number.isFinite(n)) fail('series 의 start 는 숫자 또는 YYYY-MM-DD 날짜여야 합니다')
            raw = String(Number((n + step * k).toPrecision(15)))
          }
          cells.push({ c, r, raw })
          k += 1
        }
      }
    } else if (kind === 'repeat') {
      if (!Array.isArray(p.values) || !p.values.length) fail('repeat 에는 values 배열이 필요합니다')
      let k = 0
      for (let r = g.r0; r <= g.r1; r += 1) for (let c = g.c0; c <= g.c1; c += 1) cells.push({ c, r, raw: cellTextFromValue(p.values[k++ % p.values.length]) })
    } else if (kind === 'copy') {
      const src = rawAt(state, sheet, g.c0, g.r0, cols)
      for (let r = g.r0; r <= g.r1; r += 1) for (let c = g.c0; c <= g.c1; c += 1) cells.push({ c, r, raw: isFormulaText(src) ? translateFormula(src, r - g.r0, c - g.c0) : src })
    } else fail('pattern.kind 는 series, repeat, copy 중 하나입니다')
  } else fail('formula_template 또는 pattern 중 하나가 필요합니다')
  const res = setCells(state, sheet.id, cells)
  return { state: res.state, count: cells.length, cells }
}

/** 찾아 바꾸기. scope 'values'(수식이 아닌 글만) | 'all'(수식 글 포함). 바뀐 칸 목록을 돌려준다 */
export function findReplace(state, sheetRef, { find, replace = '', matchCase = false, whole = false, scope = 'values', range } = {}) {
  if (!find) fail('찾을 글(find)이 비어 있습니다')
  const sheet = findSheet(state, sheetRef)
  const { g } = resolveRange(state, sheet, range)
  const cols = columnsOf(state, sheet)
  const needle = matchCase ? find : find.toLowerCase()
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(whole ? `^${esc}$` : esc, matchCase ? 'g' : 'gi')
  const cells = []
  const hits = []
  for (let r = g.r0; r <= g.r1; r += 1) {
    for (let c = g.c0; c <= g.c1; c += 1) {
      const raw = visibleRaw(state, sheet, c, r, cols)
      if (raw === '') continue
      if (isFormulaText(raw) && scope !== 'all') continue
      if (isFormulaText(raw) && r === 1) continue
      const hay = matchCase ? raw : raw.toLowerCase()
      if (!hay.includes(needle)) continue
      if (whole && hay !== needle) continue
      const next = raw.replace(re, () => replace)
      if (next !== raw) {
        cells.push({ c, r, raw: next })
        hits.push(cellName(c, r))
      }
    }
  }
  if (!cells.length) return { state, count: 0, cells: [], hits }
  return { state: setCells(state, sheet.id, cells).state, count: cells.length, cells, hits }
}

/** 중복 행 지우기: 범위 안에서 key 열 값이 같은 행은 처음 것만 남기고 행 전체를 지운다 */
export function removeDuplicates(state, sheetRef, g, { keyCols, hasHeader = true, evalAt } = {}) {
  const sheet = findSheet(state, sheetRef)
  const u = usedRange(state, sheet)
  if (g.c0 !== 0 || g.c1 < u.cols - 1) fail(`중복 제거는 행 전체를 지우므로 범위가 모든 열(A-${colLetter(Math.max(0, u.cols - 1))})을 포함해야 합니다`)
  const cols = columnsOf(state, sheet)
  const r0 = g.r0 === 1 ? (hasHeader ? 2 : fail('1행은 머리글이라 중복 제거 대상이 아닙니다. has_header 를 true 로 하세요')) : g.r0
  const r1 = Math.min(g.r1, sheet.rows.length + 1)
  const useCols = keyCols?.length ? keyCols : Array.from({ length: g.c1 - g.c0 + 1 }, (_, i) => g.c0 + i)
  const seen = new Set()
  const dup = []
  for (let r = r0; r <= r1; r += 1) {
    const key = JSON.stringify(useCols.map((c) => String(evalAt ? evalAt(c, r) : rawAt(state, sheet, c, r, cols)).trim().toLowerCase()))
    if (useCols.every((c) => isBlank(rawAt(state, sheet, c, r, cols)))) continue
    if (seen.has(key)) dup.push(r)
    else seen.add(key)
  }
  if (!dup.length) return { state, removed: 0, rows: [] }
  // 아래 행부터 지워야 위 행 번호가 흔들리지 않는다
  let cur = state
  let i = dup.length - 1
  while (i >= 0) {
    let j = i
    while (j > 0 && dup[j - 1] === dup[j] - 1) j -= 1
    cur = deleteRows(cur, sheet.id, dup[j], i - j + 1).state
    i = j - 1
  }
  return { state: cur, removed: dup.length, rows: dup }
}

/** 열 나누기: 열 c 의 값을 구분자로 쪼개 오른쪽에 새 열을 끼워 넣고 채운다 */
export function splitColumn(state, sheetRef, c, { delimiter, headers, trim = true, r0 = 2, r1 } = {}) {
  const sheet = findSheet(state, sheetRef)
  if (c >= realColCount(sheet)) fail('메모 열은 나눌 수 없습니다')
  const sep = { 쉼표: ',', comma: ',', 공백: ' ', space: ' ', 탭: '\t', tab: '\t', 세미콜론: ';', semicolon: ';', 줄바꿈: '\n' }[String(delimiter ?? '').toLowerCase()] ?? delimiter
  if (!sep) fail('구분자(delimiter)가 필요합니다. 예: "," 또는 " " 또는 "-"')
  const cols = columnsOf(state, sheet)
  const last = r1 ?? sheet.rows.length + 1
  const lines = []
  let max = 1
  for (let r = Math.max(2, r0); r <= last; r += 1) {
    const raw = rawAt(state, sheet, c, r, cols)
    if (isFormulaText(raw)) fail(`${cellName(c, r)} 에 수식이 있습니다. 수식 칸은 나눌 수 없습니다. 값을 먼저 확인하세요`)
    const parts = String(raw).split(sep).map((x) => (trim ? x.trim() : x))
    max = Math.max(max, parts.length)
    lines.push({ r, parts })
  }
  if (max < 2) return { state, parts: 1, count: 0 }
  if (max > 20) fail(`나누면 ${max}개 열이 생깁니다(최대 20개). 구분자를 확인하세요`)
  const ins = insertCols(state, sheet.id, c + 1, max - 1)
  const cells = []
  for (const { r, parts } of lines) {
    cells.push({ c, r, raw: parts[0] ?? '' })
    for (let k = 1; k < max; k += 1) cells.push({ c: c + k, r, raw: parts[k] ?? '' })
  }
  if (Array.isArray(headers)) headers.slice(0, max).forEach((h, k) => cells.push({ c: c + k, r: 1, raw: String(h) }))
  const out = setCells(ins.state, sheet.id, cells.map((x) => ({ ...x, raw: cellTextFromValue(x.raw) })))
  return { state: out.state, parts: max, count: lines.length, newCols: Array.from({ length: max - 1 }, (_, k) => colLetter(c + 1 + k)) }
}

export { isFormulaText, mapRefs, quoteSheetName, translateFormula, sameName, colLetter }
