// 찾기·참조 함수. 근거: https://support.google.com/docs/table/25273 (Lookup 범주)
import { def } from '../registry.js'
import { GErr, eValue, eNA, eNum, eRef } from '../errors.js'
import { Rng, isRng, isMat, N, S, B, I, compare, wildcardToRegex, valuesEqual, transpose } from '../coerce.js'
import { a1, colName } from '../parser.js'

const LK = 'lookup'
const norm = (v) => (typeof v === 'number' ? `n${v}` : typeof v === 'string' ? `s${v.toLowerCase()}` : typeof v === 'boolean' ? `b${v}` : null)
const idxCache = new WeakMap()
/** 한 줄(열 또는 행)의 정확 일치 색인. 같은 값이 여럿이면 앞쪽 위치 */
function exactIndex(vec) {
  let m = idxCache.get(vec)
  if (!m) {
    m = new Map()
    vec.forEach((v, i) => { const k = norm(v); if (k !== null && !m.has(k)) m.set(k, i) })
    idxCache.set(vec, m)
  }
  return m
}
const hasWild = (k) => typeof k === 'string' && /[*?]/.test(k)
function findExact(vec, key, fromEnd = false, wild = true) {
  if (hasWild(key) && wild) {
    const re = wildcardToRegex(key)
    if (fromEnd) { for (let i = vec.length - 1; i >= 0; i--) if (typeof vec[i] === 'string' && re.test(vec[i])) return i; return -1 }
    return vec.findIndex((v) => typeof v === 'string' && re.test(v))
  }
  if (fromEnd) { for (let i = vec.length - 1; i >= 0; i--) if (valuesEqual(vec[i], key) && vec[i] != null) return i; return -1 }
  const nk = norm(key)
  if (nk === null) return key == null ? -1 : -1
  const i = exactIndex(vec).get(nk)
  return i === undefined ? -1 : i
}
/** 정렬된 줄에서 key 이하의 마지막 위치(이진 탐색) */
function findLE(vec, key) {
  let lo = 0, hi = vec.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (vec[mid] == null) { hi = mid - 1; continue }
    if (compare(vec[mid], key) <= 0) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best
}
function findGE(vec, key) {
  let best = -1
  vec.forEach((v, i) => { if (v != null && compare(v, key) >= 0 && (best < 0 || compare(v, vec[best]) < 0)) best = i })
  return best
}
const colCache = new WeakMap()
/** 열 하나를 뽑아 행렬별로 기억해 둔다(같은 행렬에 반복 조회할 때 O(1)) */
const col = (m, j) => {
  let c = colCache.get(m)
  if (!c) { c = new Map(); colCache.set(m, c) }
  let v = c.get(j)
  if (!v) { v = m.map((r) => r[j]); c.set(j, v) }
  return v
}

function vlookup(a, ctx, horizontal) {
  const name = horizontal ? 'HLOOKUP' : 'VLOOKUP'
  const key = ctx.sc(a[0])
  let m = ctx.mat(a[1])
  const idx = Math.trunc(N(a[2]))
  const sorted = a[3] == null ? true : B(a[3])
  if (horizontal) m = transpose(m)
  if (idx < 1) throw eValue(`${name} parameter 3 value is ${idx}. It should be greater than or equal to 1.`)
  if (idx > (m[0]?.length ?? 0)) throw eRef(`${name} evaluates to an out of bounds range.`)
  const first = col(m, 0)
  const pos = sorted ? findLE(first, key) : findExact(first, key)
  if (pos < 0) throw eNA(`Did not find value '${S(key)}' in ${name} evaluation.`)
  return m[pos][idx - 1]
}
def('VLOOKUP', LK, 3, 4, 'VLOOKUP(찾을 값, 범위, 열 번호, [정렬됨=TRUE])', '범위 첫 열에서 찾아 같은 행의 n번째 열 값을 돌려줌(마지막 인수는 보통 FALSE)', (a, ctx) => vlookup(a, ctx, false), { refs: false })
def('HLOOKUP', LK, 3, 4, 'HLOOKUP(찾을 값, 범위, 행 번호, [정렬됨=TRUE])', '범위 첫 행에서 찾아 같은 열의 n번째 행 값을 돌려줌', (a, ctx) => vlookup(a, ctx, true))
def('MATCH', LK, 2, 3, 'MATCH(찾을 값, 범위, [유형=1])', '범위 안 위치 번호(유형 0=정확, 1=이하 최대, -1=이상 최소)', (a, ctx) => {
  const key = ctx.sc(a[0]); const m = ctx.mat(a[1]); const t = a[2] == null ? 1 : Math.trunc(N(a[2]))
  if (m.length > 1 && m[0].length > 1) throw eNA('MATCH range must be a single row or column.')
  const vec = m.length === 1 ? m[0] : col(m, 0)
  let pos
  if (t === 0) pos = findExact(vec, key)
  else if (t > 0) pos = findLE(vec, key)
  else { pos = -1; let lo = 0, hi = vec.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (vec[mid] != null && compare(vec[mid], key) >= 0) { pos = mid; lo = mid + 1 } else hi = mid - 1 } }
  if (pos < 0) throw eNA(`Did not find value '${S(key)}' in MATCH evaluation.`)
  return pos + 1
})
function xmatchPos(key, vec, mode, smode) {
  if (smode === 2 || smode === -2) {
    let lo = 0, hi = vec.length - 1, best = -1
    const asc = smode === 2
    while (lo <= hi) {
      const mid = (lo + hi) >> 1; const c = compare(vec[mid], key) * (asc ? 1 : -1)
      if (c === 0) return mid
      if (c < 0) { if (mode === -1 && asc || mode === 1 && !asc) best = mid; lo = mid + 1 } else { if (mode === 1 && asc || mode === -1 && !asc) best = mid; hi = mid - 1 }
    }
    return best
  }
  const rev = smode === -1
  let pos = mode === 2 ? findExact(vec, key, rev, true) : findExact(vec, key, rev, false)
  if (pos >= 0 || mode === 0 || mode === 2) return pos
  let best = -1
  const order = rev ? [...vec.keys()].reverse() : [...vec.keys()]
  for (const i of order) {
    const v = vec[i]; if (v == null) continue
    if (mode === -1 && compare(v, key) < 0 && (best < 0 || compare(v, vec[best]) > 0)) best = i
    if (mode === 1 && compare(v, key) > 0 && (best < 0 || compare(v, vec[best]) < 0)) best = i
  }
  return best
}
def('XMATCH', LK, 2, 4, 'XMATCH(찾을 값, 범위, [일치 모드=0], [검색 모드=1])', '위치 번호(일치 0 정확, -1 이하, 1 이상, 2 와일드카드)', (a, ctx) => {
  const key = ctx.sc(a[0]); const m = ctx.mat(a[1])
  const vec = m.length === 1 ? m[0] : col(m, 0)
  const pos = xmatchPos(key, vec, a[2] == null ? 0 : Math.trunc(N(a[2])), a[3] == null ? 1 : Math.trunc(N(a[3])))
  if (pos < 0) throw eNA(`Did not find value '${S(key)}' in XMATCH evaluation.`)
  return pos + 1
})
def('XLOOKUP', LK, 3, 6, 'XLOOKUP(찾을 값, 찾을 범위, 결과 범위, [없을 때 값], [일치 모드=0], [검색 모드=1])', '한 줄에서 찾아 결과 범위의 같은 위치 값을 돌려줌', (a, ctx) => {
  const key = ctx.sc(a[0]); const lm = ctx.mat(a[1]); const rm = ctx.mat(a[2])
  const vertical = lm[0].length === 1
  if (lm.length > 1 && lm[0].length > 1) throw eNA('XLOOKUP lookup_range must be a single row or column.')
  const vec = vertical ? col(lm, 0) : lm[0]
  const pos = xmatchPos(key, vec, a[4] == null ? 0 : Math.trunc(N(a[4])), a[5] == null ? 1 : Math.trunc(N(a[5])))
  if (pos < 0) { if (a[3] !== undefined && a[3] !== null) return a[3]; throw eNA(`Did not find value '${S(key)}' in XLOOKUP evaluation.`) }
  if (vertical) { if (pos >= rm.length) throw eValue('XLOOKUP result_range is smaller than lookup_range.'); return rm[pos].length === 1 ? rm[pos][0] : [rm[pos]] }
  if (pos >= rm[0].length) throw eValue('XLOOKUP result_range is smaller than lookup_range.')
  return rm.length === 1 ? rm[0][pos] : rm.map((r) => [r[pos]])
}, { arr: true })
def('LOOKUP', LK, 2, 3, 'LOOKUP(찾을 값, 찾을 범위, [결과 범위])', '정렬된 한 줄에서 이하 최대 값을 찾아 결과를 돌려줌', (a, ctx) => {
  const key = ctx.sc(a[0]); let sm = ctx.mat(a[1])
  let vec, res
  if (a[2] != null) { vec = sm.length === 1 ? sm[0] : col(sm, 0); const rm = ctx.mat(a[2]); res = rm.length === 1 ? rm[0] : col(rm, 0) }
  else if (sm.length > sm[0].length) { vec = sm[0]; res = sm[sm.length - 1] }
  else { vec = col(sm, 0); res = col(sm, sm[0].length - 1) }
  const pos = findLE(vec, key)
  if (pos < 0) throw eNA(`Did not find value '${S(key)}' in LOOKUP evaluation.`)
  return res[pos] ?? null
})
def('INDEX', LK, 1, 3, 'INDEX(참조, [행], [열])', '범위의 n행 m열 값(0이면 전체 행/열)', (a, ctx) => {
  const ref = a[0]
  const r = a[1] == null ? 0 : Math.trunc(N(ctx.sc(a[1]))), c = a[2] == null ? 0 : Math.trunc(N(ctx.sc(a[2])))
  const rows = isRng(ref) ? Math.min(ref.r2, Math.max(ref.r1, ctx.bounds(ref.sheet).rows)) - ref.r1 + 1 : (isMat(ref) ? ref.length : 1)
  const cols = isRng(ref) ? Math.min(ref.c2, Math.max(ref.c1, ctx.bounds(ref.sheet).cols - 1)) - ref.c1 + 1 : (isMat(ref) ? ref[0].length : 1)
  const rr = isRng(ref) ? ref.r2 - ref.r1 + 1 : rows, cc = isRng(ref) ? ref.c2 - ref.c1 + 1 : cols
  const R = Number.isFinite(rr) ? rr : rows, C = Number.isFinite(cc) ? cc : cols
  if (a[2] == null && R === 1 && C > 1 && r > 0) { if (r > C) throw eNum('INDEX parameter is out of range.') } else if (r < 0 || c < 0 || r > R || c > C) throw eNum('INDEX parameter is out of range.')
  const eff = (isRng(ref) ? [ref.r1, ref.c1] : [0, 0])
  // 1행 또는 1열짜리에서 숫자 하나만 주면 그 방향으로 해석
  let rr0 = r, cc0 = c
  if (a[2] == null && R === 1 && C > 1 && r > 0) { cc0 = r; rr0 = 0; if (cc0 > C) throw eNum('INDEX out of range.'); rr0 = 1 }
  if (isRng(ref)) {
    const r1 = rr0 ? ref.r1 + rr0 - 1 : ref.r1, r2 = rr0 ? r1 : ref.r1 + R - 1
    const c1 = cc0 ? ref.c1 + cc0 - 1 : ref.c1, c2 = cc0 ? c1 : ref.c1 + C - 1
    return new Rng(ref.sheet, c1, r1, c2, r2)
  }
  const m = ctx.mat(ref)
  const sub = (rr0 ? [m[rr0 - 1]] : m).map((row) => (cc0 ? [row[cc0 - 1]] : row))
  void eff
  return sub.length === 1 && sub[0].length === 1 ? sub[0][0] : sub
}, { arr: true, pass: true })
def('CHOOSE', LK, 2, Infinity, 'CHOOSE(번호, 값1, 값2, ...)', 'n번째 값을 고름', (args, ctx) => {
  const i = Math.trunc(N(ctx.sc(ctx.ev(args[0]))))
  if (i < 1 || i >= args.length) throw eNum(`CHOOSE index ${i} is out of range.`)
  return ctx.ev(args[i])
}, { lazy: true, pass: true })
def('OFFSET', LK, 3, 5, 'OFFSET(시작 참조, 행 이동, 열 이동, [높이], [너비])', '참조에서 떨어진 위치의 범위', (args, ctx) => {
  const g = ctx.evalRef(args[0])
  if (g instanceof GErr) return g
  if (!isRng(g)) throw eValue('OFFSET needs a reference.')
  const dr = Math.trunc(N(ctx.sc(ctx.ev(args[1])))), dc = Math.trunc(N(ctx.sc(ctx.ev(args[2]))))
  const h = args[3] && args[3].k !== 'empty' ? Math.trunc(N(ctx.sc(ctx.ev(args[3])))) : g.r2 - g.r1 + 1
  const w = args[4] && args[4].k !== 'empty' ? Math.trunc(N(ctx.sc(ctx.ev(args[4])))) : g.c2 - g.c1 + 1
  if (h < 1 || w < 1) throw eRef('OFFSET height and width must be positive.')
  const r1 = g.r1 + dr, c1 = g.c1 + dc
  if (r1 < 1 || c1 < 0) throw eRef('OFFSET moves the reference off the sheet.')
  return new Rng(g.sheet, c1, r1, c1 + w - 1, r1 + h - 1)
}, { lazy: true, pass: true })
def('INDIRECT', LK, 1, 2, 'INDIRECT(참조 텍스트, [A1 형식=TRUE])', '텍스트로 된 주소를 참조로 바꿈', (a, ctx) => {
  if (a[1] != null && !B(a[1])) throw eRef('INDIRECT with R1C1 style is not supported.')
  const g = ctx.parseRefText(S(a[0]))
  if (!g || g instanceof GErr) throw eRef(`Invalid reference '${S(a[0])}'.`)
  return g
}, { arr: false })
def('ROW', LK, 0, 1, 'ROW([참조])', '행 번호', (args, ctx) => {
  if (!args.length) return ctx.r
  const g = ctx.evalRef(args[0]); if (!isRng(g)) throw eValue('ROW needs a reference.')
  const r2 = Number.isFinite(g.r2) ? g.r2 : Math.max(ctx.bounds(g.sheet).rows, g.r1)
  return r2 === g.r1 ? g.r1 : Array.from({ length: r2 - g.r1 + 1 }, (_, i) => [g.r1 + i])
}, { lazy: true, arr: true })
def('COLUMN', LK, 0, 1, 'COLUMN([참조])', '열 번호(A=1)', (args, ctx) => {
  if (!args.length) return ctx.c + 1
  const g = ctx.evalRef(args[0]); if (!isRng(g)) throw eValue('COLUMN needs a reference.')
  const c2 = Number.isFinite(g.c2) ? g.c2 : Math.max(ctx.bounds(g.sheet).cols - 1, g.c1)
  return c2 === g.c1 ? g.c1 + 1 : [Array.from({ length: c2 - g.c1 + 1 }, (_, i) => g.c1 + i + 1)]
}, { lazy: true, arr: true })
def('ROWS', LK, 1, 1, 'ROWS(범위)', '범위의 행 수', (args, ctx) => {
  const g = ctx.evalRef(args[0])
  if (isRng(g)) { const r2 = Number.isFinite(g.r2) ? g.r2 : Math.max(ctx.bounds(g.sheet).rows, g.r1); return r2 - g.r1 + 1 }
  return ctx.mat(g).length
}, { lazy: true })
def('COLUMNS', LK, 1, 1, 'COLUMNS(범위)', '범위의 열 수', (args, ctx) => {
  const g = ctx.evalRef(args[0])
  if (isRng(g)) { const c2 = Number.isFinite(g.c2) ? g.c2 : Math.max(ctx.bounds(g.sheet).cols - 1, g.c1); return c2 - g.c1 + 1 }
  return ctx.mat(g)[0].length
}, { lazy: true })
def('ADDRESS', LK, 2, 5, 'ADDRESS(행, 열, [절대/상대=1], [A1 형식=TRUE], [시트 이름])', '행·열 번호로 주소 텍스트 만들기', (a) => {
  const r = Math.trunc(N(a[0])), c = Math.trunc(N(a[1])); const t = a[2] == null ? 1 : Math.trunc(N(a[2]))
  if (r < 1 || c < 1) throw eValue('ADDRESS: row and column must be positive.')
  const sh = a[4] != null ? `${/^[A-Za-z0-9_]+$/.test(S(a[4])) ? S(a[4]) : `'${S(a[4])}'`}!` : ''
  if (a[3] != null && !B(a[3])) {
    const rr = t === 1 || t === 2 ? `R${r}` : `R[${r}]`, cc = t === 1 || t === 3 ? `C${c}` : `C[${c}]`
    return `${sh}${rr}${cc}`
  }
  const absC = t === 1 || t === 3 ? '$' : '', absR = t === 1 || t === 2 ? '$' : ''
  return `${sh}${absC}${colName(c - 1)}${absR}${r}`
}, { ew: true })
