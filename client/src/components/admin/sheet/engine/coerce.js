// 값 종류와 형 변환. 값은 number | string | boolean | null(빈 칸) | GErr | 2차원 배열(matrix) | Rng | Lambda
import { GErr, isErr, eValue, eNA } from './errors.js'
import { parseDateText, parseTimeText } from './dates.js'

/** 아직 펼치지 않은 범위 참조. 열은 0부터, 행은 1부터. r2/c2가 Infinity면 열 전체/행 전체. */
export class Rng {
  constructor(sheet, c1, r1, c2, r2) { this.sheet = sheet; this.c1 = c1; this.r1 = r1; this.c2 = c2; this.r2 = r2 }
}
export class Lambda {
  constructor(params, body, scope, owner) { this.params = params; this.body = body; this.scope = scope; this.owner = owner }
}
export const isRng = (v) => v instanceof Rng
export const isMat = (v) => Array.isArray(v)
export const isLambda = (v) => v instanceof Lambda

const NUM_RE = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?$|^[-+]?\.\d+(?:[eE][-+]?\d+)?$/
const PCT_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)%$/
const CUR_RE = /^([-+]?)[₩$€£¥]\s?([-+]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)$/

/** 텍스트 하나를 숫자(날짜·시간·퍼센트 포함)로 읽는다. 못 읽으면 undefined. */
export function parseNumberText(str) {
  const s = String(str).trim()
  if (s === '') return undefined
  if (NUM_RE.test(s)) return Number(s.replace(/,/g, ''))
  if (PCT_RE.test(s)) return Number(s.slice(0, -1)) / 100
  const cm = CUR_RE.exec(s)
  if (cm) return (cm[1] === '-' || cm[2] === '-' ? -1 : 1) * Number(cm[3].replace(/,/g, ''))
  if (/^\d{4}[-/.]|^\d{4}년/.test(s) || /^[A-Za-z]{3,9}\.?\s+\d/.test(s)) {
    const d = parseDateText(s)
    if (d != null) return d
  }
  if (/^\d{1,4}:\d{2}/.test(s)) { const t = parseTimeText(s); if (t != null) return t }
  return undefined
}

/** 칸 원본 문자열을 값으로 바꾼다(구글이 입력을 해석하는 방식). 날짜·시간·퍼센트는 숫자가 된다. */
export function literalValue(raw) {
  if (raw == null) return null
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw
  const s = String(raw)
  if (s === '') return null
  if (s.charCodeAt(0) === 39) return s.slice(1) // 작은따옴표 접두는 텍스트 강제
  const t = s.trim()
  const up = t.toUpperCase()
  if (up === 'TRUE') return true
  if (up === 'FALSE') return false
  const c = t.charCodeAt(0)
  // 빠른 걸러내기: 숫자·부호·점·통화로 시작하지 않으면 텍스트
  if (!((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46 || c === 8361 || c === 36 || c === 8364 || c === 163 || c === 165)) return s
  const n = parseNumberText(t)
  return n === undefined ? s : n
}

/** 숫자 -> 문자열(15자리 유효숫자) */
export function numToStr(n) {
  if (!Number.isFinite(n)) return n !== n ? '#NUM!' : '#NUM!'
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const s = String(Number(n.toPrecision(15)))
  return s.replace('e+', 'E+').replace('e-', 'E-')
}

/** 거듭제곱(구글 관찰): 0^0 = 1, 음수의 홀수 근(1/3 등)은 실수 근 */
export function gpow(x, y) {
  if (x === 0 && y === 0) return 1
  if (x === 0 && y < 0) return new GErr('#DIV/0!', 'Function POW parameter 2 cannot be negative when parameter 1 is zero.')
  let r
  if (x < 0 && !Number.isInteger(y)) {
    const inv = 1 / y, k = Math.round(inv)
    if (Math.abs(inv - k) < 1e-9 && Math.abs(k) % 2 === 1) r = -((-x) ** y)
    else return new GErr('#NUM!', 'Result is not a real number.')
  } else r = x ** y
  return Number.isFinite(r) ? r : new GErr('#NUM!', 'Result is not a finite number.')
}
export function topLeft(v, ctx) {
  if (isRng(v)) { const m = ctx.mat(v); return m.length && m[0].length ? m[0][0] : null }
  if (isMat(v)) return v.length && v[0].length ? v[0][0] : null
  return v
}

/** 숫자로 바꾼다. 안 되면 GErr를 던진다. */
export function N(v) {
  if (typeof v === 'number') return v
  if (v == null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    if (v.trim() === '') return 0
    const n = parseNumberText(v)
    if (n === undefined) throw eValue(`Function expects number values. But '${v}' is a text and cannot be coerced to a number.`)
    return n
  }
  if (isErr(v)) throw v
  throw eValue('Expected a single value but got a range or array.')
}
export function S(v) {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'number') return numToStr(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (isErr(v)) throw v
  throw eValue('Expected a single value but got a range or array.')
}
export function B(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v == null) return false
  if (typeof v === 'string') {
    const u = v.trim().toUpperCase()
    if (u === 'TRUE') return true
    if (u === 'FALSE' || u === '') return false
    throw eValue(`Function expects boolean values. But '${v}' is a text and cannot be coerced to a boolean.`)
  }
  if (isErr(v)) throw v
  throw eValue('Expected a single value but got a range or array.')
}
/** 정수(0 방향 버림) */
export const I = (v) => Math.trunc(N(v))

const PUNCT = '_-,;:!?.\'"()[]{}@*/\\&#%`^+<=>|~$'
/** 글자 하나의 정렬 키: 기호(0) < 이모지·기타 기호(1) < 숫자(2) < 한글(3) < 로마자(4) < 그 밖의 문자(5). 한국어(ko-KR) 정렬을 흉내낸다 */
function charKey(ch) {
  const cp = ch.codePointAt(0)
  if (cp === 32) return [0, -1]
  const pi = PUNCT.indexOf(ch)
  if (pi >= 0) return [0, pi]
  if (cp >= 48 && cp <= 57) return [2, cp]
  if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3131 && cp <= 0x318e) || (cp >= 0x1100 && cp <= 0x11ff)) return [3, cp]
  if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) return [4, ch.toLowerCase().codePointAt(0)]
  if (cp > 0xffff || (cp >= 0x2000 && cp <= 0x2bff)) return [1, cp]
  if (/\p{L}/u.test(ch)) return [4.5, ch.toLowerCase().codePointAt(0)]
  return [0.5, cp]
}
/** 대소문자 무시 사전식 비교(로케일 정렬 근사) */
export function textCompare(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase()
  if (x === y) return 0
  const ia = x[Symbol.iterator](), ib = y[Symbol.iterator]()
  for (;;) {
    const p = ia.next(), q = ib.next()
    if (p.done || q.done) return p.done && q.done ? 0 : p.done ? -1 : 1
    if (p.value === q.value) continue
    const ka = charKey(p.value), kb = charKey(q.value)
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1
    if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1
  }
}
/** 값 종류 순서: 숫자 < 텍스트 < 불리언 */
const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2)
/** 비교(구글 시트 방식): 빈 칸은 상대 종류에 맞춰 0/""/FALSE, 텍스트는 대소문자 무시 */
export function compare(a, b) {
  if (a == null && b == null) return 0
  if (a == null) a = typeof b === 'number' ? 0 : typeof b === 'string' ? '' : false
  if (b == null) b = typeof a === 'number' ? 0 : typeof a === 'string' ? '' : false
  const ra = rank(a), rb = rank(b)
  if (ra !== rb) return ra < rb ? -1 : 1
  if (ra === 0) { if (a === b) return 0; if (Math.abs(a - b) <= 1e-15 * Math.max(Math.abs(a), Math.abs(b))) return 0; return a < b ? -1 : 1 }
  if (ra === 1) return textCompare(a, b)
  return a === b ? 0 : a ? 1 : -1
}
export const valuesEqual = (a, b) => compare(a, b) === 0

/** 와일드카드(* ? ~) 패턴을 정규식으로 */
export function wildcardToRegex(pat, flags = 'i') {
  let out = '^'
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i]
    if (ch === '~' && i + 1 < pat.length) { i++; out += pat[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
    else if (ch === '*') out += '[\\s\\S]*'
    else if (ch === '?') out += '[\\s\\S]'
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${out}$`, flags)
}

/** COUNTIF류의 조건을 판별 함수로 만든다. */
export function makeCriterion(crit) {
  if (isErr(crit)) throw crit
  let op = '='
  let target = crit
  if (typeof crit === 'string') {
    const m = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(crit)
    if (m) { op = m[1]; target = m[2] }
    if (crit === '') return (v) => v == null || v === '' // ""는 빈 칸과 빈 문자열 모두
  }
  if (typeof target === 'string') {
    if (target === '') {
      if (op === '=') return (v) => v == null // "="는 진짜 빈 칸만(관찰)
      if (op === '<>') return (v) => v != null // "<>"는 ="" 도 비어 있지 않은 것으로 센다(관찰)
    }
    const n = parseNumberText(target)
    if (n !== undefined && !/^[A-Za-z]/.test(target)) target = n
    else if (target.toUpperCase() === 'TRUE') target = true
    else if (target.toUpperCase() === 'FALSE') target = false
  }
  if (typeof target === 'number') {
    const test = {
      '=': (v) => typeof v === 'number' && v === target,
      '<>': (v) => !(typeof v === 'number' && v === target),
      '<': (v) => typeof v === 'number' && v < target,
      '>': (v) => typeof v === 'number' && v > target,
      '<=': (v) => typeof v === 'number' && v <= target,
      '>=': (v) => typeof v === 'number' && v >= target,
    }[op]
    // 텍스트로 저장된 숫자도 일치로 본다(구글은 "5"와 5를 같게 본다)
    if (op === '=') return (v) => (typeof v === 'number' ? v === target : typeof v === 'string' && parseNumberText(v) === target)
    if (op === '<>') return (v) => !(typeof v === 'number' ? v === target : typeof v === 'string' && parseNumberText(v) === target)
    return test
  }
  if (typeof target === 'boolean') {
    if (op === '=') return (v) => v === target
    if (op === '<>') return (v) => v !== target
    return () => false
  }
  const t = String(target ?? '')
  if (/[*?~]/.test(t) && (op === '=' || op === '<>')) {
    const re = wildcardToRegex(t)
    return op === '=' ? (v) => typeof v === 'string' && re.test(v) : (v) => !(typeof v === 'string' && re.test(v))
  }
  const tl = t.toLowerCase()
  const isTxt = (v) => typeof v === 'string'
  switch (op) {
    case '=': return (v) => isTxt(v) && v.toLowerCase() === tl
    case '<>': return (v) => !(isTxt(v) && v.toLowerCase() === tl)
    case '<': return (v) => isTxt(v) && v.toLowerCase() < tl
    case '>': return (v) => isTxt(v) && v.toLowerCase() > tl
    case '<=': return (v) => isTxt(v) && v.toLowerCase() <= tl
    default: return (v) => isTxt(v) && v.toLowerCase() >= tl
  }
}

export const matDims = (m) => ({ rows: m.length, cols: m.length ? m[0].length : 0 })
export const flatten = (m) => { const o = []; for (const row of m) for (const v of row) o.push(v); return o }
export const colOf = (m, j) => m.map((r) => r[j])
export function transpose(m) {
  if (!m.length) return []
  return m[0].map((_, j) => m.map((r) => r[j]))
}
export { GErr, isErr, eNA }
