// 배열·동적 함수. 근거: https://support.google.com/docs/table/25273 (Filter / Array 범주), LAMBDA 계열은 https://support.google.com/docs/answer/12508718
import { def } from '../registry.js'
import { GErr, eValue, eNA, eNum, eRef } from '../errors.js'
import { Rng, Lambda, isRng, isMat, isLambda, N, S, B, I, compare, flatten, transpose, topLeft } from '../coerce.js'
import { flat } from './util.js'

const A = 'array'
const toM = (v, ctx) => ctx.mat(v)
/** 원본 범위 열별 서식 힌트(날짜 칸 등)를 결과 배열에 붙인다 */
export function srcHints(g, ctx) {
  if (!isRng(g)) return null
  const w = Math.min(g.c2, g.c1 + 60) - g.c1 + 1
  const out = []
  let any = false
  for (let j = 0; j < w; j++) {
    let h = null
    for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 40); r++) { h = ctx.rawHintAt(g.sheet, g.c1 + j, r); if (h) break }
    out.push(h); if (h) any = true
  }
  return any ? out : null
}
const cmpSort = (a, b, asc) => {
  const ea = a == null, eb = b == null
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1 // 빈 칸은 항상 뒤
  const r = compare(a, b)
  return asc ? r : -r
}
export function sortRows(m, keys) {
  const idx = m.map((_, i) => i)
  idx.sort((x, y) => {
    for (const k of keys) {
      const r = cmpSort(k.vals[x], k.vals[y], k.asc)
      if (r) return r
    }
    return x - y
  })
  return idx
}
function sortKeys(m, a, ctx, startIdx, byCol, name) {
  const keys = []
  for (let i = startIdx; i < a.length; i += 2) {
    const col = a[i]
    const asc = a[i + 1] == null ? true : B(ctx.sc(a[i + 1]))
    let vals
    if (isRng(col) || isMat(col)) { vals = flatten(ctx.mat(col)); if (vals.length !== (byCol ? m[0].length : m.length)) throw eValue(`${name}: sort column has wrong size.`) }
    else {
      const n = Math.trunc(N(col))
      if (byCol) { if (n < 1 || n > m.length) throw eValue(`${name}: sort_column ${n} is out of range.`); vals = m[n - 1] }
      else { if (n < 1 || n > m[0].length) throw eValue(`${name}: sort_column ${n} is out of range.`); vals = m.map((r) => r[n - 1]) }
    }
    keys.push({ vals, asc })
  }
  return keys
}
def('SORT', A, 1, Infinity, 'SORT(범위, 정렬 열, 오름차순?, [정렬 열2, 오름차순2, ...])', '열 기준으로 행 정렬(빈 칸은 맨 뒤)', (a, ctx) => {
  const m0 = toM(a[0], ctx)
  const keep = m0.map((r, i) => i).filter((i) => m0[i].some((v) => v != null)) // 완전히 빈 행은 결과에서 빠진다(관찰)
  const m = keep.map((i) => m0[i])
  if (!m.length) return [[null]]
  const keys = a.length > 1 ? sortKeys(m, a, ctx, 1, false, 'SORT') : [{ vals: m.map((r) => r[0]), asc: true }]
  const out = sortRows(m, keys).map((i) => m[i])
  out.colHints = srcHints(a[0], ctx)
  return out
}, { arr: true, arrArgs: true })
def('SORTN', A, 1, Infinity, 'SORTN(범위, [n], [동점 처리], [정렬 열], [오름차순], ...)', '정렬 후 앞의 n행(동점 처리 0=n행까지 1=동점 포함 2=중복 제거 3=동점 중복 제거)', (a, ctx) => {
  const m = toM(a[0], ctx); const n = a[1] == null ? 1 : Math.trunc(N(a[1])); const tm = a[2] == null ? 0 : Math.trunc(N(a[2]))
  const rest = a.slice(3)
  const keys = rest.length ? sortKeys(m, [null, null, null, ...rest], ctx, 3, false, 'SORTN') : []
  let ord = sortRows(m, keys.length ? keys : [{ vals: m.map((r) => r[0]), asc: true }])
  const rowKey = (i) => m[i].map((v) => (typeof v === 'string' ? v.toLowerCase() : v)).join('\u0001')
  if (tm === 2 || tm === 3) { const seen = new Set(); ord = ord.filter((i) => { const k = rowKey(i); if (seen.has(k)) return false; seen.add(k); return true }) }
  if (n <= 0) return ord.map((i) => m[i])
  let out = ord.slice(0, n)
  if ((tm === 1 || tm === 3) && out.length === n && ord.length > n) {
    const kv = (i) => (keys.length ? keys.map((k) => k.vals[i]) : [m[i][0]])
    const last = kv(out[n - 1])
    for (let j = n; j < ord.length; j++) { const cur = kv(ord[j]); if (cur.every((v, t) => compare(v, last[t]) === 0)) out.push(ord[j]); else break }
  }
  return out.map((i) => m[i])
}, { arr: true, arrArgs: true })
def('FILTER', A, 2, Infinity, 'FILTER(범위, 조건1, [조건2, ...])', '조건이 참인 행(또는 열)만 남김', (a, ctx) => {
  const m = toM(a[0], ctx)
  const conds = a.slice(1).map((c) => ctx.mat(c))
  const byRow = conds.every((c) => c.length === m.length && c[0].length === 1)
  const byCol = !byRow && conds.every((c) => c[0].length === m[0].length && c.length === 1)
  if (!byRow && !byCol) throw eNA('FILTER has mismatched range sizes.')
  const ok = (get) => (i) => conds.every((c) => { const v = get(c, i); if (v instanceof GErr) throw v; if (v == null) return false; if (typeof v === 'string') return false; return B(v) })
  if (byRow) {
    const keep = m.filter((_, i) => ok((c, k) => c[k][0])(i))
    if (!keep.length) throw eNA('FILTER evaluated to an empty array.')
    keep.colHints = srcHints(a[0], ctx)
    return keep
  }
  const cols = m[0].map((_, j) => j).filter((j) => ok((c, k) => c[0][k])(j))
  if (!cols.length) throw eNA('FILTER evaluated to an empty array.')
  return m.map((row) => cols.map((j) => row[j]))
}, { arr: true, arrArgs: true })
def('UNIQUE', A, 1, 3, 'UNIQUE(범위, [열 기준?], [한 번만 나온 것만?])', '중복 행 제거(텍스트는 대소문자 구분, 빈 칸과 ""는 다른 값)', (a, ctx) => {
  let m = toM(a[0], ctx); const byCol = a[1] != null && B(a[1]); const once = a[2] != null && B(a[2])
  if (byCol) m = transpose(m)
  const key = (r) => r.map((v) => (v == null ? '\u0000' : typeof v === 'string' ? `s${v}` : `${typeof v}${v}`)).join('\u0001')
  const counts = new Map(); const first = []
  m.forEach((r) => { const k = key(r); if (!counts.has(k)) { counts.set(k, 0); first.push([k, r]) } counts.set(k, counts.get(k) + 1) })
  let out = first.filter(([k]) => !once || counts.get(k) === 1).map(([, r]) => r)
  if (!out.length) throw eNA('UNIQUE evaluated to an empty array.')
  if (!byCol) out.colHints = srcHints(a[0], ctx)
  return byCol ? transpose(out) : out
}, { arr: true, refs: true })
def('SEQUENCE', A, 1, 4, 'SEQUENCE(행, [열=1], [시작=1], [증가=1])', '연속 숫자 배열', (a) => {
  const rows = Math.trunc(N(a[0])), cols = a[1] == null ? 1 : Math.trunc(N(a[1])), st = a[2] == null ? 1 : N(a[2]), step = a[3] == null ? 1 : N(a[3])
  if (rows < 1 || cols < 1) throw eNum('SEQUENCE: rows and columns must be at least 1.')
  if (rows * cols > 1e6) throw eValue('SEQUENCE: result too large.')
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => st + (i * cols + j) * step))
}, { arr: true })
def('TRANSPOSE', A, 1, 1, 'TRANSPOSE(배열)', '행과 열 바꾸기', (a, ctx) => transpose(toM(a[0], ctx)), { arr: true })
def('FLATTEN', A, 1, Infinity, 'FLATTEN(범위1, ...)', '여러 범위를 한 열로 펼침', (a, ctx) => a.flatMap((x) => flatten(ctx.mat(x))).map((v) => [v]), { arr: true, refs: true })
const padTo = (m, rows, cols) => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i < m.length && j < m[0].length ? m[i][j] : eNA('#N/A pad'))))
def('HSTACK', A, 1, Infinity, 'HSTACK(범위1, ...)', '가로로 이어붙임(모자라면 #N/A)', (a, ctx) => {
  const ms = a.map((x) => ctx.mat(x)); const rows = Math.max(...ms.map((m) => m.length))
  return Array.from({ length: rows }, (_, i) => ms.flatMap((m) => (i < m.length ? m[i] : new Array(m[0].length).fill(eNA('Padded by HSTACK.')))))
}, { arr: true, refs: true })
def('VSTACK', A, 1, Infinity, 'VSTACK(범위1, ...)', '세로로 이어붙임(모자라면 #N/A)', (a, ctx) => {
  const ms = a.map((x) => ctx.mat(x)); const cols = Math.max(...ms.map((m) => m[0].length))
  return ms.flatMap((m) => m.map((r) => [...r, ...new Array(cols - r.length).fill(eNA('Padded by VSTACK.'))]))
}, { arr: true, refs: true })
def('TOCOL', A, 1, 3, 'TOCOL(배열, [무시 0~3], [열 우선?])', '한 열로 펼침(무시: 1 빈 칸, 2 오류, 3 둘 다)', (a, ctx) => {
  let m = ctx.mat(a[0]); const ig = a[1] == null ? 0 : Math.trunc(N(a[1])); if (a[2] != null && B(a[2])) m = transpose(m)
  const v = flatten(m).filter((x) => !((ig === 1 || ig === 3) && x == null) && !((ig === 2 || ig === 3) && x instanceof GErr))
  if (!v.length) throw eNA('TOCOL: empty result.')
  return v.map((x) => [x])
}, { arr: true, refs: true })
def('TOROW', A, 1, 3, 'TOROW(배열, [무시 0~3], [열 우선?])', '한 행으로 펼침', (a, ctx) => {
  let m = ctx.mat(a[0]); const ig = a[1] == null ? 0 : Math.trunc(N(a[1])); if (a[2] != null && B(a[2])) m = transpose(m)
  const v = flatten(m).filter((x) => !((ig === 1 || ig === 3) && x == null) && !((ig === 2 || ig === 3) && x instanceof GErr))
  if (!v.length) throw eNA('TOROW: empty result.')
  return [v]
}, { arr: true, refs: true })
const wrap = (a, ctx, byRow) => {
  const v = flatten(ctx.mat(a[0])); const n = Math.trunc(N(a[1])); if (n < 1) throw eValue('wrap_count must be at least 1.')
  const pad = a[2] === undefined ? eNA('Padded by WRAP.') : a[2]
  const chunks = []
  for (let i = 0; i < v.length; i += n) { const c = v.slice(i, i + n); while (c.length < n) c.push(pad); chunks.push(c) }
  return byRow ? chunks : transpose(chunks)
}
def('WRAPROWS', A, 2, 3, 'WRAPROWS(벡터, 열 수, [채울 값])', '한 줄을 n개씩 끊어 행으로', (a, ctx) => wrap(a, ctx, true), { arr: true, refs: true })
def('WRAPCOLS', A, 2, 3, 'WRAPCOLS(벡터, 행 수, [채울 값])', '한 줄을 n개씩 끊어 열로', (a, ctx) => wrap(a, ctx, false), { arr: true, refs: true })
def('CHOOSECOLS', A, 2, Infinity, 'CHOOSECOLS(배열, 열1, ...)', '지정한 열만 골라냄', (a, ctx) => {
  const m = ctx.mat(a[0]); const w = m[0].length
  const cols = a.slice(1).flatMap((x) => flat(x, ctx)).map((x) => Math.trunc(N(x)))
  return m.map((row) => cols.map((c) => { const j = c < 0 ? w + c : c - 1; if (c === 0 || j < 0 || j >= w) throw eValue('CHOOSECOLS: column index out of range.'); return row[j] }))
}, { arr: true, refs: true })
def('CHOOSEROWS', A, 2, Infinity, 'CHOOSEROWS(배열, 행1, ...)', '지정한 행만 골라냄', (a, ctx) => {
  const m = ctx.mat(a[0]); const h = m.length
  const rows = a.slice(1).flatMap((x) => flat(x, ctx)).map((x) => Math.trunc(N(x)))
  return rows.map((r) => { const i = r < 0 ? h + r : r - 1; if (r === 0 || i < 0 || i >= h) throw eValue('CHOOSEROWS: row index out of range.'); return m[i] })
}, { arr: true, refs: true })
def('ARRAY_CONSTRAIN', A, 3, 3, 'ARRAY_CONSTRAIN(배열, 행 수, 열 수)', '배열을 앞쪽 n행 m열로 자름', (a, ctx) => {
  const m = ctx.mat(a[0]); const r = Math.trunc(N(a[1])), c = Math.trunc(N(a[2]))
  if (r < 1 || c < 1) throw eValue('ARRAY_CONSTRAIN: size must be positive.')
  return m.slice(0, r).map((row) => row.slice(0, c))
}, { arr: true, refs: true })
def('ARRAYFORMULA', A, 1, 1, 'ARRAYFORMULA(수식)', '안쪽 수식을 배열 모드로 계산해 결과를 펼침', (args, ctx) => {
  const saved = ctx.arr; ctx.arr = true
  try { const v = ctx.ev(args[0]); return isRng(v) ? ctx.mat(v) : v } finally { ctx.arr = saved }
}, { lazy: true, arr: true })
def('LAMBDA', A, 1, Infinity, 'LAMBDA(이름1, ..., 식)', '이름 있는 매개변수를 쓰는 함수 값', (args, ctx) => {
  const params = args.slice(0, -1).map((n) => { if (n.k !== 'name') throw eValue('LAMBDA parameter must be a name.'); return n.u })
  return new Lambda(params, args[args.length - 1], ctx.scope, ctx)
}, { lazy: true })
def('LET', A, 3, Infinity, 'LET(이름1, 값1, ..., 식)', '식 안에서 쓸 이름 정의', (args, ctx) => {
  if (args.length % 2 === 0) throw eNA('Wrong number of arguments to LET. Expected an odd number of arguments.')
  const saved = ctx.scope
  const scope = Object.create(saved || null)
  ctx.scope = scope
  try {
    for (let i = 0; i < args.length - 1; i += 2) {
      if (args[i].k !== 'name') throw eValue('LET: name expected.')
      let v = ctx.ev(args[i + 1])
      if (v instanceof GErr && false) return v
      scope[args[i].u] = v
    }
    return ctx.ev(args[args.length - 1])
  } finally { ctx.scope = saved }
}, { lazy: true, pass: true })
const lam = (v) => { if (!isLambda(v)) throw eValue('Last argument must be a LAMBDA.'); return v }
const one = (v, ctx) => { const r = ctx.sc(v); return r === undefined ? null : r }
def('MAP', A, 2, Infinity, 'MAP(배열1, [배열2, ...], LAMBDA)', '각 원소에 람다를 적용한 같은 크기의 배열', (a, ctx) => {
  const f = lam(a[a.length - 1]); const ms = a.slice(0, -1).map((x) => ctx.mat(x))
  const rows = ms[0].length, cols = ms[0][0].length
  for (const m of ms) if (m.length !== rows || m[0].length !== cols) throw eValue('MAP: arrays must have the same size.')
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => one(ctx.call(f, ms.map((m) => m[i][j])), ctx)))
}, { arr: true, refs: true })
def('REDUCE', A, 3, 3, 'REDUCE(초기값, 배열, LAMBDA(누적, 값, ...))', '배열을 하나의 값으로 누적', (a, ctx) => {
  const f = lam(a[2]); let acc = a[0]
  for (const v of flatten(ctx.mat(a[1]))) acc = ctx.call(f, [acc, v])
  return acc
}, { refs: true, raw: true })
def('SCAN', A, 3, 3, 'SCAN(초기값, 배열, LAMBDA(누적, 값, ...))', '누적 과정을 모두 담은 같은 크기 배열', (a, ctx) => {
  const f = lam(a[2]); let acc = a[0]
  return ctx.mat(a[1]).map((row) => row.map((v) => { acc = ctx.call(f, [acc, v]); return one(acc, ctx) }))
}, { arr: true, refs: true, raw: true })
def('BYROW', A, 2, 2, 'BYROW(배열, LAMBDA(행))', '행마다 람다 적용(한 열 결과)', (a, ctx) => ctx.mat(a[0]).map((row) => [one(ctx.call(lam(a[1]), [[row]]), ctx)]), { arr: true, refs: true })
def('BYCOL', A, 2, 2, 'BYCOL(배열, LAMBDA(열))', '열마다 람다 적용(한 행 결과)', (a, ctx) => { const m = ctx.mat(a[0]); return [m[0].map((_, j) => one(ctx.call(lam(a[1]), [m.map((r) => [r[j]])]), ctx))] }, { arr: true, refs: true })
def('MAKEARRAY', A, 3, 3, 'MAKEARRAY(행, 열, LAMBDA(행, 열))', '행·열 번호로 값을 만드는 배열', (a, ctx) => {
  const r = Math.trunc(N(a[0])), c = Math.trunc(N(a[1])); if (r < 1 || c < 1) throw eValue('MAKEARRAY: size must be positive.')
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => one(ctx.call(lam(a[2]), [i + 1, j + 1]), ctx)))
}, { arr: true })
def('MUNIT', A, 1, 1, 'MUNIT(크기)', '단위 행렬', (a) => { const n = Math.trunc(N(a[0])); if (n < 1) throw eValue('MUNIT: size must be positive.'); return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))) }, { arr: true })
