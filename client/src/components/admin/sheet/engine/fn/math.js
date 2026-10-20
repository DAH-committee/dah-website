// 수학·통계 함수. 근거: https://support.google.com/docs/table/25273 (각 함수 도움말 페이지)
import { def, alias } from '../registry.js'
import { GErr, eValue, eNum, eDiv0, eNA, eRef } from '../errors.js'
import { gpow, Rng, isRng, isMat, N, S, B, I, makeCriterion, compare, flatten, parseNumberText, topLeft } from '../coerce.js'
import { collectNums, collectNumsA, flat, numFlat, optNum, chk } from './util.js'

const M = 'math', ST = 'stat'
const sum = (a) => a.reduce((x, y) => x + y, 0)
const num1 = (name, cat, sig, ko, f) => def(name, cat, 1, 1, sig, ko, (a) => f(N(a[0])), { ew: true })

// ── 기본 집계 ────────────────────────────────────────────
def('SUM', M, 1, Infinity, 'SUM(값1, [값2, ...])', '숫자의 합계', (a, ctx) => sum(collectNums(a, ctx)), { refs: true })
def('PRODUCT', M, 1, Infinity, 'PRODUCT(값1, [값2, ...])', '숫자의 곱', (a, ctx) => { const n = collectNums(a, ctx); return n.length ? n.reduce((x, y) => x * y, 1) : 0 }, { refs: true })
def('SUMSQ', M, 1, Infinity, 'SUMSQ(값1, [값2, ...])', '제곱의 합', (a, ctx) => sum(collectNums(a, ctx).map((x) => x * x)), { refs: true })
def('AVERAGE', ST, 1, Infinity, 'AVERAGE(값1, [값2, ...])', '숫자의 평균', (a, ctx) => { const n = collectNums(a, ctx); if (!n.length) throw eDiv0('AVERAGE'); return sum(n) / n.length }, { refs: true })
def('AVERAGEA', ST, 1, Infinity, 'AVERAGEA(값1, [값2, ...])', '텍스트는 0, TRUE는 1로 보는 평균', (a, ctx) => { const n = collectNumsA(a, ctx); if (!n.length) throw eDiv0('AVERAGEA'); return sum(n) / n.length }, { refs: true })
def('MIN', ST, 1, Infinity, 'MIN(값1, [값2, ...])', '최솟값', (a, ctx) => { const n = collectNums(a, ctx); return n.length ? Math.min(...n) : 0 }, { refs: true })
def('MAX', ST, 1, Infinity, 'MAX(값1, [값2, ...])', '최댓값', (a, ctx) => { const n = collectNums(a, ctx); return n.length ? Math.max(...n) : 0 }, { refs: true })
def('MINA', ST, 1, Infinity, 'MINA(값1, [값2, ...])', '텍스트는 0으로 보는 최솟값', (a, ctx) => { const n = collectNumsA(a, ctx); return n.length ? Math.min(...n) : 0 }, { refs: true })
def('MAXA', ST, 1, Infinity, 'MAXA(값1, [값2, ...])', '텍스트는 0으로 보는 최댓값', (a, ctx) => { const n = collectNumsA(a, ctx); return n.length ? Math.max(...n) : 0 }, { refs: true })
def('COUNT', ST, 1, Infinity, 'COUNT(값1, [값2, ...])', '숫자 개수', (a, ctx) => {
  let n = 0
  for (const x of a) {
    if (isRng(x) || isMat(x)) { for (const row of ctx.mat(x)) for (const v of row) if (typeof v === 'number') n++ }
    else if (typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && parseNumberText(x) !== undefined)) n++
  }
  return n
}, { refs: true, raw: true })
def('COUNTA', ST, 1, Infinity, 'COUNTA(값1, [값2, ...])', '비어 있지 않은 칸 개수', (a, ctx) => {
  let n = 0
  for (const x of a) {
    if (isRng(x) || isMat(x)) { for (const row of ctx.mat(x)) for (const v of row) if (v != null) n++ }
    else if (x != null) n++
  }
  return n
}, { refs: true, raw: true })
def('COUNTBLANK', ST, 1, Infinity, 'COUNTBLANK(범위1, ...)', '빈 칸(빈 문자열 포함) 개수', (a, ctx) => {
  let n = 0
  for (const x of a) for (const row of ctx.mat(x)) for (const v of row) if (v == null || v === '') n++
  return n
}, { refs: true })
def('COUNTUNIQUE', ST, 1, Infinity, 'COUNTUNIQUE(값1, ...)', '중복 없는 값 개수', (a, ctx) => {
  const seen = new Set()
  for (const x of a) for (const v of flat(x, ctx)) { if (v == null) continue; if (v instanceof GErr) throw v; seen.add(typeof v === 'string' ? `s${v.toLowerCase()}` : `${typeof v[0]}${v}`) }
  return seen.size
}, { refs: true, raw: true })

// ── 조건부 집계 ──────────────────────────────────────────
function critRanges(args, startIdx, ctx, name) {
  const preds = []
  let dims = null
  for (let i = startIdx; i < args.length; i += 2) {
    if (i + 1 >= args.length) throw eNA(`Wrong number of arguments to ${name}.`)
    const m = ctx.mat(args[i])
    const d = `${m.length}x${m[0]?.length ?? 0}`
    if (dims && dims !== d) throw eValue(`Array arguments to ${name} are of different size.`)
    dims = d
    preds.push({ cells: flatten(m), test: makeCriterion(ctx.sc(args[i + 1])) })
  }
  return preds
}
const matchRows = (preds) => {
  const n = preds[0].cells.length
  const idx = []
  for (let i = 0; i < n; i++) if (preds.every((p) => p.test(p.cells[i]))) idx.push(i)
  return idx
}
const numAt = (cells, idx) => idx.map((i) => cells[i]).filter((v) => typeof v === 'number')
def('SUMIF', M, 2, 3, 'SUMIF(범위, 조건, [합계범위])', '조건에 맞는 칸의 합', (a, ctx) => {
  const test = makeCriterion(ctx.sc(a[1]))
  const rng = flat(a[0], ctx)
  let sr = rng
  if (a[2] != null) {
    // 합계 범위는 조건 범위와 같은 크기로 왼쪽 위 칸 기준 맞춰진다(구글 관찰)
    const g = a[2]
    const m0 = ctx.mat(a[0])
    sr = isRng(g) ? flatten(ctx.mat(new Rng(g.sheet, g.c1, g.r1, g.c1 + (m0[0]?.length ?? 1) - 1, g.r1 + m0.length - 1))) : flat(g, ctx)
  }
  let s = 0
  rng.forEach((v, i) => { if (test(v) && typeof sr[i] === 'number') s += sr[i] })
  return s
}, { refs: true })
def('COUNTIF', ST, 2, 2, 'COUNTIF(범위, 조건)', '조건에 맞는 칸 개수', (a, ctx) => { const t = makeCriterion(ctx.sc(a[1])); return flat(a[0], ctx).filter(t).length }, { refs: true })
def('SUMIFS', M, 3, Infinity, 'SUMIFS(합계범위, 조건범위1, 조건1, ...)', '여러 조건을 모두 만족하는 칸의 합', (a, ctx) => {
  const sr = flat(a[0], ctx)
  const preds = critRanges(a, 1, ctx, 'SUMIFS')
  if (preds[0].cells.length !== sr.length) throw eValue('Array arguments to SUMIFS are of different size.')
  return sum(numAt(sr, matchRows(preds)))
}, { refs: true })
def('COUNTIFS', ST, 2, Infinity, 'COUNTIFS(조건범위1, 조건1, ...)', '여러 조건을 모두 만족하는 칸 개수', (a, ctx) => matchRows(critRanges(a, 0, ctx, 'COUNTIFS')).length, { refs: true })
def('AVERAGEIF', ST, 2, 3, 'AVERAGEIF(범위, 조건, [평균범위])', '조건에 맞는 칸의 평균', (a, ctx) => {
  const test = makeCriterion(ctx.sc(a[1]))
  const rng = flat(a[0], ctx)
  let ar = rng
  if (a[2] != null) { const g = a[2]; const m0 = ctx.mat(a[0]); ar = isRng(g) ? flatten(ctx.mat(new Rng(g.sheet, g.c1, g.r1, g.c1 + (m0[0]?.length ?? 1) - 1, g.r1 + m0.length - 1))) : flat(g, ctx) }
  const n = []
  rng.forEach((v, i) => { if (test(v) && typeof ar[i] === 'number') n.push(ar[i]) })
  if (!n.length) throw eDiv0('AVERAGEIF')
  return sum(n) / n.length
}, { refs: true })
def('AVERAGEIFS', ST, 3, Infinity, 'AVERAGEIFS(평균범위, 조건범위1, 조건1, ...)', '여러 조건을 만족하는 칸의 평균', (a, ctx) => {
  const ar = flat(a[0], ctx)
  const n = numAt(ar, matchRows(critRanges(a, 1, ctx, 'AVERAGEIFS')))
  if (!n.length) throw eDiv0('AVERAGEIFS')
  return sum(n) / n.length
}, { refs: true })
def('MAXIFS', ST, 3, Infinity, 'MAXIFS(범위, 조건범위1, 조건1, ...)', '조건을 만족하는 칸의 최댓값', (a, ctx) => { const n = numAt(flat(a[0], ctx), matchRows(critRanges(a, 1, ctx, 'MAXIFS'))); return n.length ? Math.max(...n) : 0 }, { refs: true })
def('MINIFS', ST, 3, Infinity, 'MINIFS(범위, 조건범위1, 조건1, ...)', '조건을 만족하는 칸의 최솟값', (a, ctx) => { const n = numAt(flat(a[0], ctx), matchRows(critRanges(a, 1, ctx, 'MINIFS'))); return n.length ? Math.min(...n) : 0 }, { refs: true })
def('SUMPRODUCT', M, 1, Infinity, 'SUMPRODUCT(배열1, [배열2, ...])', '같은 위치 값끼리 곱해 모두 더함', (a, ctx) => {
  const ms = a.map((x) => ctx.mat(x))
  const r = ms[0].length, c = ms[0][0]?.length ?? 0
  for (const m of ms) if (m.length !== r || (m[0]?.length ?? 0) !== c) throw eValue('Array arguments to SUMPRODUCT are of different size.')
  let s = 0
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    let p = 1
    for (const m of ms) { const v = m[i][j]; if (v instanceof GErr) throw v; p *= typeof v === 'number' ? v : typeof v === 'string' ? (parseNumberText(v) ?? 0) : 0 }
    s += p
  }
  return s
}, { arrArgs: true, refs: true })

// ── 수치 함수 ────────────────────────────────────────────
def('ABS', M, 1, 1, 'ABS(값)', '절댓값', (a) => Math.abs(N(a[0])), { ew: true })
def('SIGN', M, 1, 1, 'SIGN(값)', '부호(-1, 0, 1)', (a) => Math.sign(N(a[0])), { ew: true })
def('SQRT', M, 1, 1, 'SQRT(값)', '제곱근', (a) => { const x = N(a[0]); chk(x >= 0, `Function SQRT parameter 1 value is ${x}. It should be greater than or equal to 0.`); return Math.sqrt(x) }, { ew: true })
def('POWER', M, 2, 2, 'POWER(밑, 지수)', '거듭제곱', (a) => gpow(N(a[0]), N(a[1])), { ew: true })
def('EXP', M, 1, 1, 'EXP(값)', 'e의 거듭제곱', (a) => Math.exp(N(a[0])), { ew: true })
def('LN', M, 1, 1, 'LN(값)', '자연로그', (a) => { const x = N(a[0]); chk(x > 0, `Function LN parameter 1 value is ${x}. It should be greater than 0.`); return Math.log(x) }, { ew: true })
def('LOG', M, 1, 2, 'LOG(값, [밑])', '로그(밑 기본값 10)', (a) => { const x = N(a[0]); const b = a[1] == null ? 10 : N(a[1]); chk(x > 0, 'LOG parameter 1 must be positive.'); chk(b > 0 && b !== 1, 'LOG base must be positive and not 1.'); return Math.log(x) / Math.log(b) }, { ew: true })
def('LOG10', M, 1, 1, 'LOG10(값)', '상용로그', (a) => { const x = N(a[0]); chk(x > 0, 'LOG10 parameter 1 must be positive.'); return Math.log10(x) }, { ew: true })
def('PI', M, 0, 0, 'PI()', '원주율', () => Math.PI)
for (const [n, f, k] of [['SIN', Math.sin, '사인'], ['COS', Math.cos, '코사인'], ['TAN', Math.tan, '탄젠트'], ['ATAN', Math.atan, '아크탄젠트'], ['SINH', Math.sinh, '쌍곡사인'], ['COSH', Math.cosh, '쌍곡코사인'], ['TANH', Math.tanh, '쌍곡탄젠트']]) num1(n, M, `${n}(값)`, k, f)
def('ASIN', M, 1, 1, 'ASIN(값)', '아크사인', (a) => { const x = N(a[0]); chk(Math.abs(x) <= 1, 'ASIN value out of range.'); return Math.asin(x) }, { ew: true })
def('ACOS', M, 1, 1, 'ACOS(값)', '아크코사인', (a) => { const x = N(a[0]); chk(Math.abs(x) <= 1, 'ACOS value out of range.'); return Math.acos(x) }, { ew: true })
def('ATAN2', M, 2, 2, 'ATAN2(x, y)', '두 좌표의 아크탄젠트', (a) => Math.atan2(N(a[1]), N(a[0])), { ew: true })
num1('DEGREES', M, 'DEGREES(라디안)', '라디안을 도로', (x) => (x * 180) / Math.PI)
num1('RADIANS', M, 'RADIANS(도)', '도를 라디안으로', (x) => (x * Math.PI) / 180)
def('MOD', M, 2, 2, 'MOD(나눠질 수, 나누는 수)', '나머지(나누는 수와 같은 부호)', (a) => { const x = N(a[0]), y = N(a[1]); if (y === 0) throw eDiv0('MOD'); return x - y * Math.floor(x / y) }, { ew: true })
def('QUOTIENT', M, 2, 2, 'QUOTIENT(나눠질 수, 나누는 수)', '나눗셈의 정수 몫', (a) => { const y = N(a[1]); if (y === 0) throw eDiv0('QUOTIENT'); return Math.trunc(N(a[0]) / y) }, { ew: true })
def('INT', M, 1, 1, 'INT(값)', '가장 가까운 작은 정수로 내림', (a) => Math.floor(N(a[0])), { ew: true })
const roundTo = (x, d, mode) => {
  const m = 10 ** Math.abs(d)
  const scale = (v) => (d >= 0 ? v * m : v / m)
  const unscale = (v) => (d >= 0 ? v / m : v * m)
  const s = Number((scale(Math.abs(x))).toPrecision(15))
  let r
  if (mode === 'round') r = Math.floor(s + 0.5)
  else if (mode === 'up') r = Math.ceil(s)
  else r = Math.floor(s)
  return Math.sign(x) * unscale(r)
}
def('ROUND', M, 1, 2, 'ROUND(값, [자릿수])', '반올림(0.5는 0에서 먼 쪽)', (a) => roundTo(N(a[0]), a[1] == null ? 0 : Math.trunc(N(a[1])), 'round'), { ew: true })
def('ROUNDUP', M, 1, 2, 'ROUNDUP(값, [자릿수])', '0에서 먼 쪽으로 올림', (a) => roundTo(N(a[0]), a[1] == null ? 0 : Math.trunc(N(a[1])), 'up'), { ew: true })
def('ROUNDDOWN', M, 1, 2, 'ROUNDDOWN(값, [자릿수])', '0에 가까운 쪽으로 내림', (a) => roundTo(N(a[0]), a[1] == null ? 0 : Math.trunc(N(a[1])), 'down'), { ew: true })
def('TRUNC', M, 1, 2, 'TRUNC(값, [자릿수])', '소수 자릿수에서 잘라냄', (a) => roundTo(N(a[0]), a[1] == null ? 0 : Math.trunc(N(a[1])), 'down'), { ew: true })
def('CEILING', M, 1, 2, 'CEILING(값, [배수])', '배수로 올림', (a) => {
  const x = N(a[0]); const f = a[1] == null ? 1 : N(a[1])
  if (f === 0) return 0
  if (x > 0 && f < 0) throw eNum('CEILING: positive value with negative factor.')
  const q = Number((Math.abs(x) / Math.abs(f)).toPrecision(15))
  return f > 0 ? Math.ceil(Number((x / f).toPrecision(15))) * f : -Math.ceil(q) * Math.abs(f)
}, { ew: true })
def('FLOOR', M, 1, 2, 'FLOOR(값, [배수])', '배수로 내림', (a) => {
  const x = N(a[0]); const f = a[1] == null ? 1 : N(a[1])
  if (f === 0) return 0
  if (x > 0 && f < 0) throw eNum('FLOOR: positive value with negative factor.')
  const q = Number((Math.abs(x) / Math.abs(f)).toPrecision(15))
  return f > 0 ? Math.floor(Number((x / f).toPrecision(15))) * f : -Math.floor(q) * Math.abs(f)
}, { ew: true })
def('MROUND', M, 2, 2, 'MROUND(값, 배수)', '가장 가까운 배수로 반올림', (a) => {
  const x = N(a[0]), f = N(a[1])
  if (f === 0) return 0
  if (x * f < 0) throw eNum('MROUND: value and factor must have the same sign.')
  return Math.sign(f) * Math.floor(Math.abs(x) / Math.abs(f) + 0.5) * Math.abs(f)
}, { ew: true })
def('EVEN', M, 1, 1, 'EVEN(값)', '0에서 먼 쪽 가장 가까운 짝수', (a) => { const x = N(a[0]); const v = 2 * Math.ceil(Math.abs(x) / 2); return Math.sign(x) * v }, { ew: true })
def('ODD', M, 1, 1, 'ODD(값)', '0에서 먼 쪽 가장 가까운 홀수', (a) => { const x = N(a[0]); let v = Math.ceil(Math.abs(x)); if (v % 2 === 0) v += 1; return Math.sign(x) * v || 1 }, { ew: true })
def('ISEVEN', M, 1, 1, 'ISEVEN(값)', '짝수이면 TRUE', (a) => Math.trunc(Math.abs(N(a[0]))) % 2 === 0, { ew: true })
def('ISODD', M, 1, 1, 'ISODD(값)', '홀수이면 TRUE', (a) => Math.trunc(Math.abs(N(a[0]))) % 2 === 1, { ew: true })
def('FACT', M, 1, 1, 'FACT(값)', '계승(n!)', (a) => { const x = Math.trunc(N(a[0])); chk(x >= 0, 'FACT: negative.'); let r = 1; for (let i = 2; i <= x; i++) r *= i; if (!Number.isFinite(r)) throw eNum('FACT: result too large.'); return r }, { ew: true })
const gcd2 = (x, y) => { x = Math.abs(x); y = Math.abs(y); while (y) { [x, y] = [y, x % y] } return x }
def('GCD', M, 1, Infinity, 'GCD(값1, ...)', '최대공약수', (a, ctx) => collectNums(a, ctx).map(Math.trunc).reduce(gcd2, 0), { refs: true })
def('LCM', M, 1, Infinity, 'LCM(값1, ...)', '최소공배수', (a, ctx) => collectNums(a, ctx).map(Math.trunc).reduce((x, y) => (x === 0 || y === 0 ? 0 : (x * y) / gcd2(x, y)), 1), { refs: true })
def('RAND', M, 0, 0, 'RAND()', '0 이상 1 미만 난수', (a, ctx) => ctx.rand(), { vol: true })
def('RANDBETWEEN', M, 2, 2, 'RANDBETWEEN(하한, 상한)', '두 정수 사이 난수(양 끝 포함)', (a, ctx) => {
  const lo = Math.ceil(N(a[0])), hi = Math.floor(N(a[1]))
  chk(lo <= hi, 'RANDBETWEEN: low greater than high.')
  return lo + Math.floor(ctx.rand() * (hi - lo + 1))
}, { vol: true })
def('RANDARRAY', M, 0, 4, 'RANDARRAY([행], [열], [최소], [최대], [정수?])', '난수 배열', (a, ctx) => {
  const rows = a[0] == null ? 1 : I(a[0]), cols = a[1] == null ? 1 : I(a[1])
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ctx.rand()))
}, { vol: true, arr: true })
def('SUBTOTAL', M, 2, Infinity, 'SUBTOTAL(함수코드, 범위1, ...)', '코드로 고른 집계(1-11, 101-111)', (a, ctx) => {
  const code = I(a[0]) % 100
  const n = collectNums(a.slice(1), ctx)
  switch (code) {
    case 1: if (!n.length) throw eDiv0('SUBTOTAL'); return sum(n) / n.length
    case 2: return n.length
    case 3: { let k = 0; for (const x of a.slice(1)) for (const v of flat(x, ctx)) if (v != null) k++; return k }
    case 4: return n.length ? Math.max(...n) : 0
    case 5: return n.length ? Math.min(...n) : 0
    case 6: return n.reduce((x, y) => x * y, 1)
    case 9: return sum(n)
    default: throw eNum('SUBTOTAL: unsupported function code.')
  }
}, { refs: true })

// ── 통계 ────────────────────────────────────────────────
const sorted = (n) => [...n].sort((x, y) => x - y)
const mean = (n) => sum(n) / n.length
const varS = (n, sample) => { if (n.length < (sample ? 2 : 1)) throw eDiv0(sample ? 'VAR' : 'VARP'); const m = mean(n); return sum(n.map((x) => (x - m) ** 2)) / (n.length - (sample ? 1 : 0)) }
def('MEDIAN', ST, 1, Infinity, 'MEDIAN(값1, ...)', '중앙값', (a, ctx) => { const n = sorted(collectNums(a, ctx)); if (!n.length) throw eNum('MEDIAN: no numbers.'); const h = n.length >> 1; return n.length % 2 ? n[h] : (n[h - 1] + n[h]) / 2 }, { refs: true })
def('MODE', ST, 1, Infinity, 'MODE(값1, ...)', '최빈값(동률이면 먼저 나온 값)', (a, ctx) => {
  const n = collectNums(a, ctx); const cnt = new Map(); for (const x of n) cnt.set(x, (cnt.get(x) || 0) + 1)
  let best = null, bc = 1
  for (const [k, v] of cnt) if (v > bc) { best = k; bc = v }
  if (best === null) throw eNA('MODE: no repeated values.')
  return best
}, { refs: true })
def('VAR', ST, 1, Infinity, 'VAR(값1, ...)', '표본 분산', (a, ctx) => varS(collectNums(a, ctx), true), { refs: true })
def('VARP', ST, 1, Infinity, 'VARP(값1, ...)', '모집단 분산', (a, ctx) => varS(collectNums(a, ctx), false), { refs: true })
def('STDEV', ST, 1, Infinity, 'STDEV(값1, ...)', '표본 표준편차', (a, ctx) => Math.sqrt(varS(collectNums(a, ctx), true)), { refs: true })
def('STDEVP', ST, 1, Infinity, 'STDEVP(값1, ...)', '모집단 표준편차', (a, ctx) => Math.sqrt(varS(collectNums(a, ctx), false)), { refs: true })
def('LARGE', ST, 2, 2, 'LARGE(데이터, n)', 'n번째로 큰 값', (a, ctx) => { const n = sorted(numFlat(a[0], ctx)); const k = I(a[1]); chk(k >= 1 && k <= n.length, `LARGE: n out of range (${k}).`); return n[n.length - k] }, { refs: true })
def('SMALL', ST, 2, 2, 'SMALL(데이터, n)', 'n번째로 작은 값', (a, ctx) => { const n = sorted(numFlat(a[0], ctx)); const k = I(a[1]); chk(k >= 1 && k <= n.length, `SMALL: n out of range (${k}).`); return n[k - 1] }, { refs: true })
def('RANK', ST, 2, 3, 'RANK(값, 데이터, [오름차순?])', '데이터 안에서의 순위(동순위는 같은 값)', (a, ctx) => {
  const v = N(a[0]); const n = numFlat(a[1], ctx); const asc = a[2] != null && B(a[2])
  if (!n.includes(v)) throw eNA(`Did not find value '${v}' in RANK evaluation.`)
  return 1 + n.filter((x) => (asc ? x < v : x > v)).length
}, { refs: true })
def('PERCENTILE', ST, 2, 2, 'PERCENTILE(데이터, 백분위)', '백분위수(0~1, 선형 보간)', (a, ctx) => {
  const n = sorted(numFlat(a[0], ctx)); const p = N(a[1]); chk(p >= 0 && p <= 1 && n.length > 0, 'PERCENTILE: invalid.')
  const k = (n.length - 1) * p; const f = Math.floor(k); return f + 1 < n.length ? n[f] + (k - f) * (n[f + 1] - n[f]) : n[f]
}, { refs: true })
def('QUARTILE', ST, 2, 2, 'QUARTILE(데이터, 사분위)', '사분위수(0~4)', (a, ctx) => {
  const q = I(a[1]); chk(q >= 0 && q <= 4, 'QUARTILE: quartile must be 0-4.')
  return FNS_P(a[0], q / 4, ctx)
}, { refs: true })
function FNS_P(data, p, ctx) {
  const n = sorted(numFlat(data, ctx)); chk(n.length > 0, 'no numbers')
  const k = (n.length - 1) * p; const f = Math.floor(k); return f + 1 < n.length ? n[f] + (k - f) * (n[f + 1] - n[f]) : n[f]
}
alias('PERCENTILE.INC', 'PERCENTILE'); alias('QUARTILE.INC', 'QUARTILE'); alias('STDEV.S', 'STDEV'); alias('STDEV.P', 'STDEVP'); alias('VAR.S', 'VAR'); alias('VAR.P', 'VARP'); alias('RANK.EQ', 'RANK'); alias('MODE.SNGL', 'MODE')
def('SUMX2MY2', M, 2, 2, 'SUMX2MY2(배열x, 배열y)', 'x제곱 빼기 y제곱의 합', (a, ctx) => { const x = numFlat(a[0], ctx), y = numFlat(a[1], ctx); return sum(x.map((v, i) => v * v - y[i] * y[i])) }, { refs: true })

function pairs(a, ctx, name) {
  const x = flat(a[0], ctx), y = flat(a[1], ctx)
  if (x.length !== y.length) throw eNA(`Arrays for ${name} must be the same size.`)
  const px = [], py = []
  x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') { px.push(v); py.push(y[i]) } })
  if (px.length < 2) throw eDiv0(name)
  return [px, py]
}
const covSums = (px, py) => { const mx = mean(px), my = mean(py); let sxy = 0, sxx = 0, syy = 0; px.forEach((v, i) => { sxy += (v - mx) * (py[i] - my); sxx += (v - mx) ** 2; syy += (py[i] - my) ** 2 }); return { mx, my, sxy, sxx, syy } }
def('CORREL', ST, 2, 2, 'CORREL(데이터y, 데이터x)', '상관계수', (a, ctx) => { const [x, y] = pairs(a, ctx, 'CORREL'); const s = covSums(x, y); if (!s.sxx || !s.syy) throw eDiv0('CORREL'); return s.sxy / Math.sqrt(s.sxx * s.syy) }, { refs: true })
def('SLOPE', ST, 2, 2, 'SLOPE(데이터y, 데이터x)', '회귀직선 기울기', (a, ctx) => { const [y, x] = pairs(a, ctx, 'SLOPE'); const s = covSums(x, y); if (!s.sxx) throw eDiv0('SLOPE'); return s.sxy / s.sxx }, { refs: true })
def('INTERCEPT', ST, 2, 2, 'INTERCEPT(데이터y, 데이터x)', '회귀직선 절편', (a, ctx) => { const [y, x] = pairs(a, ctx, 'INTERCEPT'); const s = covSums(x, y); if (!s.sxx) throw eDiv0('INTERCEPT'); return s.my - (s.sxy / s.sxx) * s.mx }, { refs: true })
def('FORECAST', ST, 3, 3, 'FORECAST(x, 데이터y, 데이터x)', '선형 회귀 예측값', (a, ctx) => { const [y, x] = pairs([a[1], a[2]], ctx, 'FORECAST'); const s = covSums(x, y); if (!s.sxx) throw eDiv0('FORECAST'); const b = s.sxy / s.sxx; return s.my - b * s.mx + b * N(a[0]) }, { refs: true })
alias('FORECAST.LINEAR', 'FORECAST')
def('RSQ', ST, 2, 2, 'RSQ(데이터y, 데이터x)', '결정계수 R^2', (a, ctx) => { const [y, x] = pairs(a, ctx, 'RSQ'); const s = covSums(x, y); if (!s.sxx || !s.syy) throw eDiv0('RSQ'); return (s.sxy * s.sxy) / (s.sxx * s.syy) }, { refs: true })
def('COVAR', ST, 2, 2, 'COVAR(데이터y, 데이터x)', '모집단 공분산', (a, ctx) => { const [y, x] = pairs(a, ctx, 'COVAR'); return covSums(x, y).sxy / x.length }, { refs: true })
def('SKEW', ST, 1, Infinity, 'SKEW(값1, ...)', '표본 왜도', (a, ctx) => { const n = collectNums(a, ctx); if (n.length < 3) throw eDiv0('SKEW'); const m = mean(n); const s = Math.sqrt(sum(n.map((x) => (x - m) ** 2)) / (n.length - 1)); if (!s) throw eDiv0('SKEW'); return (n.length / ((n.length - 1) * (n.length - 2))) * sum(n.map((x) => ((x - m) / s) ** 3)) }, { refs: true })
def('AVEDEV', ST, 1, Infinity, 'AVEDEV(값1, ...)', '평균 절대 편차', (a, ctx) => { const n = collectNums(a, ctx); if (!n.length) throw eNum('AVEDEV: no numbers.'); const m = mean(n); return mean(n.map((x) => Math.abs(x - m))) }, { refs: true })
def('GEOMEAN', ST, 1, Infinity, 'GEOMEAN(값1, ...)', '기하평균', (a, ctx) => { const n = collectNums(a, ctx); chk(n.length && n.every((x) => x > 0), 'GEOMEAN: positive numbers required.'); return Math.exp(mean(n.map(Math.log))) }, { refs: true })
def('COMBIN', M, 2, 2, 'COMBIN(n, k)', '조합 수', (a) => { const n = I(a[0]), k = I(a[1]); chk(n >= 0 && k >= 0 && k <= n, 'COMBIN invalid.'); let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r) }, { ew: true })
def('PERMUT', M, 2, 2, 'PERMUT(n, k)', '순열 수', (a) => { const n = I(a[0]), k = I(a[1]); chk(n >= 0 && k >= 0 && k <= n, 'PERMUT invalid.'); let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r }, { ew: true })
def('NORMSDIST', ST, 1, 1, 'NORMSDIST(z)', '표준정규 누적분포', (a) => 0.5 * (1 + erf(N(a[0]) / Math.SQRT2)), { ew: true })
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y }
def('FREQUENCY', ST, 2, 2, 'FREQUENCY(데이터, 구간)', '구간별 빈도 배열', (a, ctx) => {
  const d = numFlat(a[0], ctx), b = sorted(numFlat(a[1], ctx))
  const out = new Array(b.length + 1).fill(0)
  for (const x of d) { let i = 0; while (i < b.length && x > b[i]) i++; out[i]++ }
  return out.map((v) => [v])
}, { arr: true, refs: true })
def('MMULT', M, 2, 2, '행렬곱 MMULT(행렬1, 행렬2)', '두 행렬의 곱', (a, ctx) => {
  const x = ctx.mat(a[0]), y = ctx.mat(a[1])
  if (x[0].length !== y.length) throw eValue('MMULT: dimension mismatch.')
  return x.map((row) => y[0].map((_, j) => sum(row.map((v, k) => N(v) * N(y[k][j])))))
}, { arr: true, arrArgs: true })
