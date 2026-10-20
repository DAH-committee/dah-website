// 그 밖의 자주 쓰이는 함수. 근거: https://support.google.com/docs/table/25273
import { def, alias } from '../registry.js'
import { GErr, eValue, eNum, eNA, eDiv0 } from '../errors.js'
import { N, S, B, I, compare, parseNumberText } from '../coerce.js'
import { collectNums } from './util.js'

const M = 'math', ST = 'stat'
const num1 = (name, cat, ko, f) => def(name, cat, 1, 1, `${name}(값)`, ko, (a) => { const v = f(N(a[0])); if (!Number.isFinite(v)) throw eNum(`${name}: result is not finite.`); return v }, { ew: true })
num1('ASINH', M, '역쌍곡사인', Math.asinh); num1('ACOSH', M, '역쌍곡코사인', Math.acosh); num1('ATANH', M, '역쌍곡탄젠트', Math.atanh)
num1('COT', M, '코탄젠트', (x) => 1 / Math.tan(x)); num1('CSC', M, '코시컨트', (x) => 1 / Math.sin(x)); num1('SEC', M, '시컨트', (x) => 1 / Math.cos(x)); num1('ACOT', M, '아크코탄젠트', (x) => Math.PI / 2 - Math.atan(x))
num1('SQRTPI', M, 'PI 곱의 제곱근', (x) => { if (x < 0) throw eNum('SQRTPI: negative.'); return Math.sqrt(x * Math.PI) })
def('CEILING.MATH', M, 1, 3, 'CEILING.MATH(값, [배수], [모드])', '배수로 올림(음수는 모드에 따라)', (a) => { const x = N(a[0]); const f = a[1] == null ? 1 : Math.abs(N(a[1])); const mode = a[2] == null ? 0 : N(a[2]); if (f === 0) return 0; if (x < 0 && mode !== 0) return -Math.ceil(Math.abs(x) / f) * f; return Math.ceil(x / f) * f }, { ew: true })
def('FLOOR.MATH', M, 1, 3, 'FLOOR.MATH(값, [배수], [모드])', '배수로 내림(음수는 모드에 따라)', (a) => { const x = N(a[0]); const f = a[1] == null ? 1 : Math.abs(N(a[1])); const mode = a[2] == null ? 0 : N(a[2]); if (f === 0) return 0; if (x < 0 && mode !== 0) return -Math.floor(Math.abs(x) / f) * f; return Math.floor(x / f) * f }, { ew: true })
def('MULTINOMIAL', M, 1, Infinity, 'MULTINOMIAL(값1, ...)', '다항 계수', (a, ctx) => { const n = collectNums(a, ctx).map(Math.trunc); const f = (k) => { let r = 1; for (let i = 2; i <= k; i++) r *= i; return r }; return f(n.reduce((x, y) => x + y, 0)) / n.reduce((x, y) => x * f(y), 1) }, { refs: true })
def('SUMXMY2', M, 2, 2, 'SUMXMY2(배열x, 배열y)', '(x-y) 제곱의 합', (a, ctx) => { const x = ctx.mat(a[0]).flat().filter((v) => typeof v === 'number'), y = ctx.mat(a[1]).flat().filter((v) => typeof v === 'number'); if (x.length !== y.length) throw eNA('SUMXMY2: size mismatch.'); return x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) }, { refs: true })
def('SUMX2PY2', M, 2, 2, 'SUMX2PY2(배열x, 배열y)', 'x제곱 더하기 y제곱의 합', (a, ctx) => { const x = ctx.mat(a[0]).flat().filter((v) => typeof v === 'number'), y = ctx.mat(a[1]).flat().filter((v) => typeof v === 'number'); if (x.length !== y.length) throw eNA('SUMX2PY2: size mismatch.'); return x.reduce((s, v, i) => s + v * v + y[i] * y[i], 0) }, { refs: true })
def('DEVSQ', ST, 1, Infinity, 'DEVSQ(값1, ...)', '편차 제곱합', (a, ctx) => { const n = collectNums(a, ctx); const m = n.reduce((x, y) => x + y, 0) / n.length; return n.reduce((s, v) => s + (v - m) ** 2, 0) }, { refs: true })
def('PERCENTRANK', ST, 2, 3, 'PERCENTRANK(데이터, 값, [유효숫자=3])', '데이터 안에서의 백분위 순위', (a, ctx) => {
  const d = ctx.mat(a[0]).flat().filter((v) => typeof v === 'number').sort((x, y) => x - y); const v = N(a[1]); const sig = a[2] == null ? 3 : Math.trunc(N(a[2]))
  if (!d.length || v < d[0] || v > d[d.length - 1]) throw eNA('PERCENTRANK: value out of range.')
  let i = d.findIndex((x) => x >= v); let r
  if (d[i] === v) r = i / (d.length - 1)
  else r = (i - 1 + (v - d[i - 1]) / (d[i] - d[i - 1])) / (d.length - 1)
  const m = 10 ** sig; return Math.floor(r * m) / m
}, { refs: true })
def('TRIMMEAN', ST, 2, 2, 'TRIMMEAN(데이터, 제외 비율)', '양 끝을 잘라낸 평균', (a, ctx) => { const d = ctx.mat(a[0]).flat().filter((v) => typeof v === 'number').sort((x, y) => x - y); const p = N(a[1]); if (p < 0 || p >= 1) throw eNum('TRIMMEAN: percent out of range.'); const k = Math.floor((d.length * p) / 2); const t = d.slice(k, d.length - k); return t.reduce((x, y) => x + y, 0) / t.length }, { refs: true })
def('VARA', ST, 1, Infinity, 'VARA(값1, ...)', '표본 분산(텍스트 0)', (a, ctx) => { const n = []; for (const x of a) for (const v of ctx.mat(x).flat()) { if (v instanceof GErr) throw v; if (typeof v === 'number') n.push(v); else if (typeof v === 'boolean') n.push(v ? 1 : 0); else if (typeof v === 'string') n.push(0) } if (n.length < 2) throw eDiv0('VARA'); const m = n.reduce((x, y) => x + y, 0) / n.length; return n.reduce((s, v) => s + (v - m) ** 2, 0) / (n.length - 1) }, { refs: true })
const erfc = (x) => { const t = 1 / (1 + 0.5 * Math.abs(x)); const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r }
const ncdf = (z) => 0.5 * erfc(-z / Math.SQRT2)
def('NORM.S.DIST', ST, 1, 2, 'NORM.S.DIST(z, [누적?=TRUE])', '표준정규분포', (a) => { const z = N(a[0]); return a[1] == null || B(a[1]) ? ncdf(z) : Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) }, { ew: true })
def('NORM.DIST', ST, 3, 4, 'NORM.DIST(x, 평균, 표준편차, [누적?=TRUE])', '정규분포', (a) => { const x = N(a[0]), m = N(a[1]), s = N(a[2]); if (s <= 0) throw eNum('NORM.DIST: sd must be positive.'); const z = (x - m) / s; return a[3] == null || B(a[3]) ? ncdf(z) : Math.exp(-z * z / 2) / (s * Math.sqrt(2 * Math.PI)) }, { ew: true })
def('STANDARDIZE', ST, 3, 3, 'STANDARDIZE(x, 평균, 표준편차)', '표준화 값', (a) => { const s = N(a[2]); if (s <= 0) throw eNum('STANDARDIZE: sd must be positive.'); return (N(a[0]) - N(a[1])) / s }, { ew: true })
const loan = (a, name) => {
  const r = N(a[0]), per = N(a[1]), n = N(a[2]), pv = N(a[3]), fv = a[4] == null ? 0 : N(a[4]), t = a[5] == null ? 0 : (B(a[5]) ? 1 : 0)
  if (per < 1 || per > n) throw eNum(`${name}: period out of range.`)
  const pmt = r === 0 ? -(pv + fv) / n : -(r * (fv + pv * (1 + r) ** n)) / ((1 + r * t) * ((1 + r) ** n - 1))
  const bal = (k) => (r === 0 ? pv + pmt * k : pv * (1 + r) ** k + pmt * (1 + r * t) * ((1 + r) ** k - 1) / r)
  const ipmt = t === 1 ? (per === 1 ? 0 : (-bal(per - 1) * r) / (1 + r)) : -bal(per - 1) * r
  return { pmt, ipmt }
}
def('IPMT', 'fin', 4, 6, 'IPMT(이율, 기간, 기간 수, 현재가치, [미래가치=0], [납입시점=0])', '특정 기간의 이자 납입액', (a) => loan(a, 'IPMT').ipmt, { ew: true })
def('PPMT', 'fin', 4, 6, 'PPMT(이율, 기간, 기간 수, 현재가치, [미래가치=0], [납입시점=0])', '특정 기간의 원금 납입액', (a) => { const x = loan(a, 'PPMT'); return x.pmt - x.ipmt }, { ew: true })
def('EFFECT', 'fin', 2, 2, 'EFFECT(명목이율, 연 복리 횟수)', '실효 연이율', (a) => { const n = Math.trunc(N(a[1])); if (n < 1) throw eNum('EFFECT: periods < 1.'); return (1 + N(a[0]) / n) ** n - 1 }, { ew: true })
def('NOMINAL', 'fin', 2, 2, 'NOMINAL(실효이율, 연 복리 횟수)', '명목 연이율', (a) => { const n = Math.trunc(N(a[1])); if (n < 1) throw eNum('NOMINAL: periods < 1.'); return n * ((1 + N(a[0])) ** (1 / n) - 1) }, { ew: true })
def('ISBETWEEN', 'logical', 3, 5, 'ISBETWEEN(값, 하한, 상한, [하한 포함=TRUE], [상한 포함=TRUE])', '값이 두 수 사이이면 TRUE', (a) => { const v = N(a[0]), lo = N(a[1]), hi = N(a[2]); const il = a[3] == null ? true : B(a[3]), ih = a[4] == null ? true : B(a[4]); return (il ? v >= lo : v > lo) && (ih ? v <= hi : v < hi) }, { ew: true })
def('TO_PERCENT', 'text', 1, 1, 'TO_PERCENT(값)', '숫자를 퍼센트 값으로(값 자체는 유지)', (a) => N(a[0]), { ew: true })
def('TO_DOLLARS', 'text', 1, 1, 'TO_DOLLARS(값)', '숫자를 통화 값으로(값 자체는 유지)', (a) => N(a[0]), { ew: true })
def('TO_PURE_NUMBER', 'text', 1, 1, 'TO_PURE_NUMBER(값)', '서식을 뗀 숫자', (a) => N(a[0]), { ew: true })
def('HYPERLINK', 'text', 1, 2, 'HYPERLINK(URL, [표시 텍스트])', '링크(표시 텍스트 또는 URL 값을 돌려줌)', (a) => (a[1] != null ? a[1] : S(a[0])), { ew: true })
def('ROMAN', M, 1, 2, 'ROMAN(숫자)', '로마 숫자 텍스트', (a) => { let n = Math.trunc(N(a[0])); if (n < 0 || n > 3999) throw eValue('ROMAN: out of range.'); const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let o = ''; for (const [v, s] of t) while (n >= v) { o += s; n -= v } return o }, { ew: true })
def('ARABIC', M, 1, 1, 'ARABIC(로마 숫자)', '로마 숫자를 숫자로', (a) => { const m = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; const s = S(a[0]).toUpperCase(); let r = 0; for (let i = 0; i < s.length; i++) { const v = m[s[i]]; if (!v) throw eValue('ARABIC: invalid.'); r += v < (m[s[i + 1]] || 0) ? -v : v } return r }, { ew: true })
def('BASE', M, 2, 3, 'BASE(수, 진법, [최소 자릿수])', '수를 n진법 텍스트로', (a) => { const r = Math.trunc(N(a[1])); if (r < 2 || r > 36) throw eNum('BASE: radix out of range.'); let o = Math.trunc(N(a[0])).toString(r).toUpperCase(); if (a[2] != null) o = o.padStart(Math.trunc(N(a[2])), '0'); return o }, { ew: true })
def('DECIMAL', M, 2, 2, 'DECIMAL(텍스트, 진법)', 'n진법 텍스트를 10진수로', (a) => { const v = parseInt(S(a[0]), Math.trunc(N(a[1]))); if (Number.isNaN(v)) throw eNum('DECIMAL: invalid.'); return v }, { ew: true })
def('BITAND', 'eng', 2, 2, 'BITAND(값1, 값2)', '비트 AND', (a) => Number(BigInt(Math.trunc(N(a[0]))) & BigInt(Math.trunc(N(a[1])))), { ew: true })
def('BITOR', 'eng', 2, 2, 'BITOR(값1, 값2)', '비트 OR', (a) => Number(BigInt(Math.trunc(N(a[0]))) | BigInt(Math.trunc(N(a[1])))), { ew: true })
def('BITXOR', 'eng', 2, 2, 'BITXOR(값1, 값2)', '비트 XOR', (a) => Number(BigInt(Math.trunc(N(a[0]))) ^ BigInt(Math.trunc(N(a[1])))), { ew: true })
def('BITLSHIFT', 'eng', 2, 2, 'BITLSHIFT(값, 이동량)', '비트 왼쪽 이동', (a) => Math.trunc(N(a[0])) * 2 ** Math.trunc(N(a[1])), { ew: true })
def('BITRSHIFT', 'eng', 2, 2, 'BITRSHIFT(값, 이동량)', '비트 오른쪽 이동', (a) => Math.floor(Math.trunc(N(a[0])) / 2 ** Math.trunc(N(a[1]))), { ew: true })
def('DELTA', 'eng', 1, 2, 'DELTA(값1, [값2=0])', '두 수가 같으면 1', (a) => (N(a[0]) === (a[1] == null ? 0 : N(a[1])) ? 1 : 0), { ew: true })
def('GESTEP', 'eng', 1, 2, 'GESTEP(값, [기준=0])', '값이 기준 이상이면 1', (a) => (N(a[0]) >= (a[1] == null ? 0 : N(a[1])) ? 1 : 0), { ew: true })
const UNITS = { m: ['len', 1], km: ['len', 1000], cm: ['len', 0.01], mm: ['len', 0.001], mi: ['len', 1609.344], ft: ['len', 0.3048], in: ['len', 0.0254], yd: ['len', 0.9144], g: ['mass', 1], kg: ['mass', 1000], mg: ['mass', 0.001], lbm: ['mass', 453.59237], ozm: ['mass', 28.349523125], sec: ['time', 1], s: ['time', 1], min: ['time', 60], hr: ['time', 3600], day: ['time', 86400], yr: ['time', 31557600], l: ['vol', 1], ml: ['vol', 0.001], gal: ['vol', 3.785411784], 'm^2': ['area', 1], ha: ['area', 10000], 'km^2': ['area', 1e6] }
def('CONVERT', 'eng', 3, 3, 'CONVERT(값, 원래 단위, 바꿀 단위)', '단위 변환(길이 질량 시간 부피 넓이 일부, 온도 C F K)', (a) => {
  const v = N(a[0]), f = S(a[1]), t = S(a[2])
  const T = { C: (x) => x, F: (x) => (x - 32) / 1.8, K: (x) => x - 273.15 }, TI = { C: (x) => x, F: (x) => x * 1.8 + 32, K: (x) => x + 273.15 }
  if (f in T && t in TI) return TI[t](T[f](v))
  const uf = UNITS[f], ut = UNITS[t]
  if (!uf || !ut || uf[0] !== ut[0]) throw eNA(`CONVERT: incompatible or unknown units '${f}' '${t}'.`)
  return (v * uf[1]) / ut[1]
}, { ew: true })

// ── 연산자 함수 (ADD, MINUS, EQ 등: 연산자와 같은 규칙) ─────────────
const opFn = (name, sig, ko, f, min = 2, max = 2) => def(name, 'op', min, max, sig, ko, f, { ew: true })
opFn('ADD', 'ADD(값1, 값2)', '더하기(+)', (a) => N(a[0]) + N(a[1]))
opFn('MINUS', 'MINUS(값1, 값2)', '빼기(-)', (a) => N(a[0]) - N(a[1]))
opFn('MULTIPLY', 'MULTIPLY(값1, 값2)', '곱하기(*)', (a) => N(a[0]) * N(a[1]))
opFn('DIVIDE', 'DIVIDE(값1, 값2)', '나누기(/)', (a) => { const d = N(a[1]); if (d === 0) throw new GErr('#DIV/0!', 'Function DIVIDE parameter 2 cannot be zero.'); return N(a[0]) / d })
opFn('POW', 'POW(밑, 지수)', '거듭제곱(^), POWER와 같음', (a) => N(a[0]) ** N(a[1]))
opFn('EQ', 'EQ(값1, 값2)', '같다(=)', (a) => compare(a[0], a[1]) === 0)
opFn('NE', 'NE(값1, 값2)', '다르다(<>)', (a) => compare(a[0], a[1]) !== 0)
opFn('GT', 'GT(값1, 값2)', '크다(>)', (a) => compare(a[0], a[1]) > 0)
opFn('GTE', 'GTE(값1, 값2)', '크거나 같다(>=)', (a) => compare(a[0], a[1]) >= 0)
opFn('LT', 'LT(값1, 값2)', '작다(<)', (a) => compare(a[0], a[1]) < 0)
opFn('LTE', 'LTE(값1, 값2)', '작거나 같다(<=)', (a) => compare(a[0], a[1]) <= 0)
opFn('UMINUS', 'UMINUS(값)', '부호 바꾸기(-)', (a) => -N(a[0]), 1, 1)
opFn('UPLUS', 'UPLUS(값)', '단항 플러스(+)', (a) => a[0], 1, 1)
opFn('UNARY_PERCENT', 'UNARY_PERCENT(값)', '백분율(%)', (a) => N(a[0]) / 100, 1, 1)
