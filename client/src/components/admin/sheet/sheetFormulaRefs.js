// sheetFormulaRefs.js: 수식 글 속 칸 참조를 옮기는 순수 함수(DOM 없음).
// - translateFormula: 복사·채우기처럼 상대 참조를 (행 +dr, 열 +dc) 만큼 옮긴다($ 로 고정한 쪽은 그대로).
// - shiftForStructure: 행·열을 끼워 넣거나 지울 때 참조를 맞춘다(범위는 늘거나 줄고, 지워진 칸은 #REF!).
// - renameSheetInFormula: 시트 이름이 바뀔 때 다른 시트의 수식 속 'old'! 를 새 이름으로 바꾼다.
// 큰따옴표 문자열 안은 건드리지 않는다. 엔진(formula.js)과 따로 동작하는 글자 단위 도구다.
import { colLetter } from './sheetUtils.js'

export function colIndex(letters) {
  let n = 0
  for (const ch of String(letters).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const CELL = '\\$?[A-Za-z]{1,3}\\$?\\d+'
const COL = '\\$?[A-Za-z]{1,3}'
const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z0-9_\\uAC00-\\uD7A3.]+)!"
const REF_SRC = `(${SHEET})?(${CELL}(?::(?:${CELL}|${COL}))?|${COL}:${COL})`
const WORD = /[A-Za-z0-9_.$\uAC00-\uD7A3]/
const WORD_AFTER = /[A-Za-z0-9_(\uAC00-\uD7A3]/

function parseEnd(text) {
  const m = /^(\$?)([A-Za-z]{1,3})(?:(\$?)(\d+))?$/.exec(text)
  if (!m) return null
  return { c: colIndex(m[2]), r: m[4] === undefined ? null : Number(m[4]), absC: m[1] === '$', absR: m[3] === '$' }
}
function printEnd(e) {
  return `${e.absC ? '$' : ''}${colLetter(e.c)}${e.r == null ? '' : `${e.absR ? '$' : ''}${e.r}`}`
}
const unquote = (s) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s)
export function quoteSheetName(name) {
  return /^[A-Za-z0-9_\uAC00-\uD7A3.]+$/.test(name) && !/^\d+$/.test(name) ? name : `'${String(name).replace(/'/g, "''")}'`
}
export const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

/**
 * 수식 글의 모든 참조에 fn 을 적용한다.
 * fn({sheet:string|null, ends:[{c,r,absC,absR}, ...]}) -> 새 ends 배열 | null(= #REF!) | undefined(그대로)
 * sheetFn(name) -> 새 시트 이름 | undefined
 */
export function mapRefs(formula, fn, sheetFn) {
  const src = String(formula ?? '')
  const parts = src.split(/("(?:[^"]|"")*")/)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(new RegExp(REF_SRC, 'g'), (whole, sheetPart, refPart, offset, str) => {
        const before = offset > 0 ? str[offset - 1] : ''
        const after = str[offset + whole.length] || ''
        if (before && WORD.test(before) && !(sheetPart === undefined && before === '!')) return whole
        if (after && WORD_AFTER.test(after)) return whole
        const ends = refPart.split(':').map(parseEnd)
        if (ends.some((e) => !e)) return whole
        // 열만 쓴 범위(A:A)는 양쪽 다 열만 있어야 한다. A1:B 처럼 한쪽만 열이면 끝이 열린 범위(A1:B)
        const sheet = sheetPart ? unquote(sheetPart.slice(0, -1)) : null
        const res = fn({ sheet, ends })
        let prefix = sheetPart || ''
        if (sheet && sheetFn) {
          const ns = sheetFn(sheet)
          if (ns !== undefined) prefix = `${quoteSheetName(ns)}!`
        }
        if (res === undefined) return prefix + refPart
        if (res === null) return '#REF!'
        return prefix + res.map(printEnd).join(':')
      })
    })
    .join('')
}

/** 복사·채우기: 상대 참조를 옮긴다 */
export function translateFormula(formula, dr, dc) {
  return mapRefs(formula, ({ ends }) => {
    const out = []
    for (const e of ends) {
      const c = e.absC ? e.c : e.c + dc
      const r = e.r == null ? null : e.absR ? e.r : e.r + dr
      if (c < 0 || (r != null && r < 1)) return null
      out.push({ ...e, c, r })
    }
    return out
  })
}

/**
 * 행·열 끼워 넣기·지우기에 맞춰 참조를 고친다.
 * ownSheet: 이 수식이 들어 있는 시트 이름, target: 바뀐 시트 이름
 * axis 'row' 는 at 이 1부터 세는 시트 행 번호, 'col' 은 0부터 세는 열 번호
 */
export function shiftForStructure(formula, ownSheet, target, { axis, at, count, op }) {
  const key = axis === 'row' ? 'r' : 'c'
  const mapIdx = (idx, isEnd) => {
    if (op === 'insert') return idx >= at ? idx + count : idx
    if (idx >= at + count) return idx - count
    if (idx >= at) return isEnd ? at - 1 : at
    return idx
  }
  return mapRefs(formula, ({ sheet, ends }) => {
    if (!sameName(sheet ?? ownSheet, target)) return undefined
    if (ends.length === 1) {
      const e = ends[0]
      const v = e[key]
      if (v == null) return undefined
      if (op === 'delete' && v >= at && v < at + count) return null
      return [{ ...e, [key]: mapIdx(v, false) }]
    }
    const [a, b] = ends
    const av = a[key]
    const bv = b[key]
    if (av == null && bv == null) return undefined
    if (op === 'delete' && av != null && bv != null && Math.min(av, bv) >= at && Math.max(av, bv) < at + count) return null
    const lo = av != null && bv != null ? Math.min(av, bv) : av
    const hi = av != null && bv != null ? Math.max(av, bv) : bv
    const na = lo == null ? null : mapIdx(lo, false)
    const nb = hi == null ? null : mapIdx(hi, true)
    if (na != null && nb != null && na > nb) return null
    return [{ ...a, [key]: na }, { ...b, [key]: nb }]
  })
}

export function renameSheetInFormula(formula, oldName, newName) {
  return mapRefs(formula, () => undefined, (name) => (sameName(name, oldName) ? newName : undefined))
}

/** 이 수식이 다른 시트를 가리키는 참조 이름들 */
export function referencedSheets(formula) {
  const out = new Set()
  mapRefs(formula, ({ sheet }) => {
    if (sheet) out.add(sheet)
    return undefined
  })
  return [...out]
}

export const isFormulaText = (v) => typeof v === 'string' && v.startsWith('=') && v.length > 1
