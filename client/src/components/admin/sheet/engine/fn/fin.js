// 재무·엔지니어링 일부. 근거: https://support.google.com/docs/table/25273 (Financial / Engineering 범주)
import { def } from '../registry.js'
import { eNum, eValue } from '../errors.js'
import { N, B, I } from '../coerce.js'
import { collectNums } from './util.js'

const F = 'fin'
const pv = (rate, nper, pmt, fv, type) => (rate === 0 ? -(fv + pmt * nper) : -(fv + pmt * (1 + rate * type) * ((1 + rate) ** nper - 1) / rate) / (1 + rate) ** nper)
def('PMT', F, 3, 5, 'PMT(이율, 기간 수, 현재가치, [미래가치=0], [납입시점=0])', '정기 납입액', (a) => {
  const r = N(a[0]), n = N(a[1]), p = N(a[2]), fv = a[3] == null ? 0 : N(a[3]), t = a[4] == null ? 0 : (B(a[4]) ? 1 : 0)
  if (n === 0) throw eNum('PMT: nper cannot be 0.')
  if (r === 0) return -(p + fv) / n
  return -(r * (fv + p * (1 + r) ** n)) / ((1 + r * t) * ((1 + r) ** n - 1))
}, { ew: true })
def('FV', F, 3, 5, 'FV(이율, 기간 수, 납입액, [현재가치=0], [납입시점=0])', '미래가치', (a) => {
  const r = N(a[0]), n = N(a[1]), pmt = N(a[2]), p = a[3] == null ? 0 : N(a[3]), t = a[4] == null ? 0 : (B(a[4]) ? 1 : 0)
  if (r === 0) return -(p + pmt * n)
  return -(p * (1 + r) ** n + pmt * (1 + r * t) * ((1 + r) ** n - 1) / r)
}, { ew: true })
def('PV', F, 3, 5, 'PV(이율, 기간 수, 납입액, [미래가치=0], [납입시점=0])', '현재가치', (a) => pv(N(a[0]), N(a[1]), N(a[2]), a[3] == null ? 0 : N(a[3]), a[4] == null ? 0 : (B(a[4]) ? 1 : 0)), { ew: true })
def('NPER', F, 3, 5, 'NPER(이율, 납입액, 현재가치, [미래가치=0], [납입시점=0])', '납입 횟수', (a) => {
  const r = N(a[0]), pmt = N(a[1]), p = N(a[2]), fv = a[3] == null ? 0 : N(a[3]), t = a[4] == null ? 0 : (B(a[4]) ? 1 : 0)
  if (r === 0) { if (pmt === 0) throw eNum('NPER: invalid.'); return -(p + fv) / pmt }
  const x = (pmt * (1 + r * t) - fv * r) / (pmt * (1 + r * t) + p * r)
  if (x <= 0) throw eNum('NPER: invalid.')
  return Math.log(x) / Math.log(1 + r)
}, { ew: true })
def('NPV', F, 2, Infinity, 'NPV(할인율, 현금흐름1, ...)', '순현재가치(첫 현금흐름은 1기말)', (a, ctx) => {
  const r = N(ctx.sc(a[0])); const cf = collectNums(a.slice(1), ctx)
  return cf.reduce((s, v, i) => s + v / (1 + r) ** (i + 1), 0)
}, { refs: true })
def('IRR', F, 1, 2, 'IRR(현금흐름, [추정값=0.1])', '내부수익률', (a, ctx) => {
  const cf = collectNums([a[0]], ctx); let r = a[1] == null ? 0.1 : N(a[1])
  if (!cf.some((x) => x > 0) || !cf.some((x) => x < 0)) throw eNum('IRR: needs positive and negative cash flows.')
  for (let i = 0; i < 100; i++) {
    let f = 0, d = 0
    cf.forEach((v, t) => { f += v / (1 + r) ** t; d -= (t * v) / (1 + r) ** (t + 1) })
    if (d === 0) break
    const nr = r - f / d
    if (Math.abs(nr - r) < 1e-10) return nr
    r = nr
  }
  throw eNum('IRR did not converge.')
}, { refs: true })
def('RATE', F, 3, 6, 'RATE(기간 수, 납입액, 현재가치, [미래가치=0], [납입시점=0], [추정값=0.1])', '기간당 이율', (a) => {
  const n = N(a[0]), pmt = N(a[1]), p = N(a[2]), fv = a[3] == null ? 0 : N(a[3]), t = a[4] == null ? 0 : (B(a[4]) ? 1 : 0)
  let r = a[5] == null ? 0.1 : N(a[5])
  const f = (x) => (x === 0 ? p + pmt * n + fv : p * (1 + x) ** n + pmt * (1 + x * t) * ((1 + x) ** n - 1) / x + fv)
  for (let i = 0; i < 200; i++) {
    const h = 1e-7; const d = (f(r + h) - f(r - h)) / (2 * h)
    if (d === 0) break
    const nr = r - f(r) / d
    if (Math.abs(nr - r) < 1e-12) return nr
    r = nr
  }
  throw eNum('RATE did not converge.')
}, { ew: true })
def('SLN', F, 3, 3, 'SLN(취득가, 잔존가, 내용연수)', '정액법 감가상각', (a) => { const l = N(a[2]); if (l === 0) throw eNum('SLN: life is 0.'); return (N(a[0]) - N(a[1])) / l }, { ew: true })
const base = (name, to, from, cat = 'eng') => def(name, cat, 1, 2, `${name}(수, [자릿수])`, `${from}진수를 ${to}진수로`, (a) => {
  const s = String(a[0]).toUpperCase()
  const fromRadix = { DEC: 10, BIN: 2, HEX: 16, OCT: 8 }[from.slice(0, 3)]
  const toRadix = { DEC: 10, BIN: 2, HEX: 16, OCT: 8 }[to.slice(0, 3)]
  const v = typeof a[0] === 'number' ? a[0] : parseInt(s, fromRadix)
  if (Number.isNaN(v)) throw eNum(`${name}: invalid number.`)
  let out = (v < 0 && fromRadix === 10 ? (v >>> 0) & 0x3ffffffff : v).toString(toRadix).toUpperCase()
  if (a[1] != null) out = out.padStart(Math.trunc(N(a[1])), '0')
  return out
}, { ew: true })
base('DEC2BIN', 'BIN', 'DEC'); base('DEC2HEX', 'HEX', 'DEC'); base('DEC2OCT', 'OCT', 'DEC'); base('BIN2DEC', 'DEC', 'BIN'); base('HEX2DEC', 'DEC', 'HEX'); base('OCT2DEC', 'DEC', 'OCT')
