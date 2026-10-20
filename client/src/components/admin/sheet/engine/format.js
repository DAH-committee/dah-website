// TEXT() 서식 문자열 해석. 근거: https://support.google.com/docs/answer/3094139 (TEXT), https://support.google.com/docs/answer/56470 (숫자 서식)
import { partsFromSerial } from './dates.js'
import { numToStr } from './coerce.js'
import { eValue } from './errors.js'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const KDAYS = ['일', '월', '화', '수', '목', '금', '토']

function splitSections(fmt) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]
    if (ch === '"') q = !q
    if (ch === '\\' && !q) { cur += ch + (fmt[i + 1] ?? ''); i++; continue }
    if (ch === ';' && !q) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

/** 서식을 토큰으로 쪼갠다 */
function tokenizeFmt(sec) {
  const t = []
  let i = 0
  while (i < sec.length) {
    const ch = sec[i]
    const rest = sec.slice(i)
    if (ch === '"') { const j = sec.indexOf('"', i + 1); const e = j < 0 ? sec.length : j; t.push({ k: 'lit', v: sec.slice(i + 1, e) }); i = e + 1; continue }
    if (ch === '\\') { t.push({ k: 'lit', v: sec[i + 1] ?? '' }); i += 2; continue }
    if (ch === '_') { t.push({ k: 'lit', v: ' ' }); i += 2; continue }
    if (ch === '*') { i += 2; continue }
    if (ch === '[') {
      const j = sec.indexOf(']', i)
      const body = sec.slice(i + 1, j < 0 ? sec.length : j)
      i = (j < 0 ? sec.length : j) + 1
      if (/^(h+|m+|s+)$/i.test(body)) t.push({ k: 'elapsed', v: body[0].toLowerCase(), n: body.length })
      else if (/^\$/.test(body)) { const cur = body.slice(1).split('-')[0]; if (cur) t.push({ k: 'lit', v: cur }) }
      continue
    }
    let m
    if ((m = /^(AM\/PM|am\/pm|A\/P|a\/p)/.exec(rest))) { t.push({ k: 'ampm', v: m[1] }); i += m[1].length; continue }
    if ((m = /^General/i.exec(rest))) { t.push({ k: 'general' }); i += 7; continue }
    if ((m = /^[eE][+-]/.exec(rest))) { t.push({ k: 'exp', v: m[0] }); i += 2; continue }
    if (ch === 'e' || ch === 'E') throw eValue('TEXT: invalid format string.')
    if ((m = /^(y+|Y+)/.exec(rest))) { t.push({ k: 'date', v: 'y', n: m[0].length }); i += m[0].length; continue }
    if ((m = /^(m+|M+)/.exec(rest))) { t.push({ k: 'date', v: 'm', n: m[0].length }); i += m[0].length; continue }
    if ((m = /^(d+|D+)/.exec(rest))) { t.push({ k: 'date', v: 'd', n: m[0].length }); i += m[0].length; continue }
    if ((m = /^(h+|H+)/.exec(rest))) { t.push({ k: 'date', v: 'h', n: m[0].length }); i += m[0].length; continue }
    if ((m = /^(s+|S+)/.exec(rest))) { t.push({ k: 'date', v: 's', n: m[0].length }); i += m[0].length; continue }
    if (ch === '0' || ch === '#' || ch === '?') { t.push({ k: 'dig', v: ch }); i++; continue }
    if (ch === '.') { t.push({ k: 'dot' }); i++; continue }
    if (ch === ',') { t.push({ k: 'comma' }); i++; continue }
    if (ch === '%') { t.push({ k: 'pct' }); i++; continue }
    if (ch === '@') { t.push({ k: 'at' }); i++; continue }
    t.push({ k: 'lit', v: ch }); i++
  }
  return t
}

const pad = (n, w) => String(n).padStart(w, '0')
function roundHalfAway(x, d) {
  const s = Math.abs(x)
  const r = Math.round(Number(`${s}e${d}`))
  return Number(`${r}e-${d}`) * (x < 0 ? -1 : 1)
}

function formatDate(serial, toks, locale = 'ko') {
  const ko = locale !== 'en'
  // 분(m)과 월(m) 구분
  const seq = toks.filter((x) => x.k === 'date' || x.k === 'elapsed' || x.k === 'ampm')
  toks.forEach((tk) => { if (tk.k === 'date' && tk.v === 'm') {
    const idx = seq.indexOf(tk)
    const prev = seq[idx - 1], next = seq[idx + 1]
    tk.minute = (prev && ((prev.k === 'date' && prev.v === 'h') || (prev.k === 'elapsed' && prev.v === 'h'))) || (next && ((next.k === 'date' && next.v === 's') || (next.k === 'elapsed' && next.v === 's')))
  } })
  const hasAmPm = toks.some((x) => x.k === 'ampm')
  let total = Math.round(serial * 86400000) / 86400000
  const p = partsFromSerial(Math.floor(total + 1e-9))
  let msOfDay = Math.round((total - Math.floor(total + 1e-9)) * 86400000)
  if (msOfDay >= 86400000) msOfDay = 86399999
  const H = Math.floor(msOfDay / 3600000), Mi = Math.floor((msOfDay % 3600000) / 60000), Se = Math.floor((msOfDay % 60000) / 1000), Ms = msOfDay % 1000
  let out = ''
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]
    if (tk.k === 'lit') out += tk.v
    else if (tk.k === 'date') {
      switch (tk.v) {
        case 'y': out += tk.n <= 2 ? pad(p.y % 100, 2) : pad(p.y, 4); break
        case 'm':
          if (tk.minute) out += tk.n >= 2 ? pad(Mi, 2) : String(Mi)
          else if (ko) out += tk.n === 1 ? String(p.m) : tk.n === 2 ? pad(p.m, 2) : `${p.m}월`
          else out += tk.n === 1 ? String(p.m) : tk.n === 2 ? pad(p.m, 2) : tk.n === 3 ? MONTHS[p.m - 1].slice(0, 3) : tk.n === 4 ? MONTHS[p.m - 1] : MONTHS[p.m - 1][0]
          break
        case 'd': out += tk.n === 1 ? String(p.d) : tk.n === 2 ? pad(p.d, 2) : ko ? (tk.n === 3 ? KDAYS[p.dow] : `${KDAYS[p.dow]}요일`) : (tk.n === 3 ? DAYS[p.dow].slice(0, 3) : DAYS[p.dow]); break
        case 'h': { const h = hasAmPm ? ((H + 11) % 12) + 1 : H; out += tk.n >= 2 ? pad(h, 2) : String(h); break }
        case 's': out += tk.n >= 2 ? pad(Se, 2) : String(Se); break
        default:
      }
    } else if (tk.k === 'elapsed') {
      const tot = Math.floor(total * 86400 + 1e-6)
      const v = tk.v === 'h' ? Math.floor(tot / 3600) : tk.v === 'm' ? Math.floor(tot / 60) : tot
      out += pad(v, tk.n)
    } else if (tk.k === 'ampm') {
      out += ko ? (tk.v.length > 3 ? (H >= 12 ? '오후' : '오전') : '오') : tk.v.length > 3 ? (H >= 12 ? 'PM' : 'AM') : H >= 12 ? 'P' : 'A'
    } else if (tk.k === 'dot' && toks[i + 1] && toks[i + 1].k === 'dig' && toks[i + 1].v === '0' && toks[i - 1] && toks[i - 1].k === 'date' && toks[i - 1].v === 's') {
      let n = 0
      while (toks[i + 1 + n] && toks[i + 1 + n].k === 'dig') n++
      out += `.${pad(Ms, 3).slice(0, n)}`
      i += n
    } else if (tk.k === 'dot') out += '.'
    else if (tk.k === 'comma') out += ','
    else if (tk.k === 'pct') out += '%'
    else if (tk.k === 'dig') out += tk.v
  }
  return out
}

function formatNumberSection(x, toks, neg, showMinus) {
  let v = Math.abs(x)
  const pcts = toks.filter((t) => t.k === 'pct').length
  v *= 100 ** pcts
  const expTok = toks.findIndex((t) => t.k === 'exp')
  const dotIdx = toks.findIndex((t) => t.k === 'dot')
  const lastDig = (() => { for (let i = toks.length - 1; i >= 0; i--) if (toks[i].k === 'dig') return i; return -1 })()
  const firstDig = toks.findIndex((t) => t.k === 'dig')
  // 마지막 숫자 칸 뒤의 쉼표는 1000 단위 축소
  let scale = 0
  for (let i = lastDig + 1; i < toks.length && lastDig >= 0; i++) { if (toks[i].k === 'comma') scale++; else if (toks[i].k !== 'lit' || false) break }
  if (scale) v /= 1000 ** scale
  const grouping = toks.some((t, i) => t.k === 'comma' && i > firstDig && i < lastDig)
  const end = expTok >= 0 ? expTok : toks.length
  const intToks = [], fracToks = []
  let seenDot = false
  const before = [], after = []
  for (let i = 0; i < end; i++) {
    const tk = toks[i]
    if (tk.k === 'dot' && !seenDot && i === dotIdx) { seenDot = true; continue }
    if (tk.k === 'comma' && grouping && i > firstDig && i < lastDig) continue
    if (tk.k === 'comma' && i > lastDig) continue
    if (!seenDot) intToks.push(tk); else fracToks.push(tk)
  }
  const fracDigits = fracToks.filter((t) => t.k === 'dig').length
  let digitsStr, mant = v, expStr = ''
  if (expTok >= 0) {
    const intCount = intToks.filter((t) => t.k === 'dig').length || 1
    let e = v === 0 ? 0 : Math.floor(Math.log10(v)) - (intCount - 1)
    mant = v / 10 ** e
    mant = roundHalfAway(mant, fracDigits)
    if (mant >= 10 ** intCount) { mant /= 10; e += 1 }
    const sign = e < 0 ? '-' : toks[expTok].v === 'E+' || toks[expTok].v === 'e+' ? '+' : ''
    const expDigits = toks.slice(expTok + 1).filter((t) => t.k === 'dig').length
    expStr = `${toks[expTok].v[0]}${sign}${pad(Math.abs(e), expDigits || 2)}`
    v = mant
  }
  const rounded = roundHalfAway(v, fracDigits)
  const fixed = fracDigits > 14 ? paddedDecimal(rounded, fracDigits) : rounded.toFixed(fracDigits)
  const [ip, fp = ''] = fixed.split('.')
  digitsStr = ip === '0' ? '' : ip
  // 정수부 채우기(오른쪽부터)
  const intDigitToks = intToks.filter((t) => t.k === 'dig')
  let intOut = ''
  {
    let d = digitsStr
    const parts = []
    let di = d.length - 1
    const placeholders = intDigitToks.length
    let usedPlaceholders = 0
    for (let i = intToks.length - 1; i >= 0; i--) {
      const tk = intToks[i]
      if (tk.k === 'dig') {
        usedPlaceholders++
        if (di >= 0) parts.push(d[di--])
        else if (tk.v === '0') parts.push('0')
        else if (tk.v === '?') parts.push(' ')
        else parts.push('')
        if (usedPlaceholders === placeholders) { while (di >= 0) parts.push(d[di--]) }
      } else if (tk.k === 'lit') parts.push(tk.v)
      else if (tk.k === 'pct') parts.push('%')
      else if (tk.k === 'comma') parts.push(',')
    }
    intOut = parts.reverse().join('')
    if (grouping) {
      // 숫자 구간에만 쉼표를 넣는다
      intOut = intOut.replace(/\d{4,}/, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, ','))
    }
  }
  let fracOut = ''
  {
    let fi = 0
    for (const tk of fracToks) {
      if (tk.k === 'dig') {
        const ch = fp[fi++] ?? ''
        if (tk.v === '#' && ch === '0' && fp.slice(fi - 1).replace(/0/g, '') === '') { fracOut += '\u0000' } else fracOut += ch
      } else if (tk.k === 'lit') fracOut += tk.v
      else if (tk.k === 'pct') fracOut += '%'
    }
    fracOut = fracOut.replace(/\u0000/g, '')
  }
  let s = intOut
  if (seenDot) {
    const hasFracDigit = /[0-9 ]/.test(fracOut.replace(/[^0-9 ]/g, '')) || fracToks.some((t) => t.k === 'dig' && t.v === '0')
    const fracDigitsOnly = fracOut
    const plain = fracDigitsOnly.replace(/[^0-9]/g, '')
    if (plain.length || fracToks.some((t) => t.k === 'dig' && t.v === '0')) s += `.${fracOut}`
    else s += fracOut
    void hasFracDigit
  }
  s += expStr
  // 숫자 칸 뒤 리터럴(예: "원")과 숫자 칸 앞 리터럴
  const afterExp = expTok >= 0 ? '' : ''
  // intToks 안에는 head가 이미 포함돼 있다(정수부 토큰에 포함). 중복 방지
  void afterExp; void before; void after
  const body = s
  const tailPart = expTok >= 0 ? toks.slice(expTok + 1).filter((t) => t.k === 'lit').map((t) => t.v).join('') : ''
  return (neg && showMinus ? '-' : '') + body + tailPart
}

/** 값을 서식 문자열로 바꾼다 (TEXT 함수의 본체) */
export function formatValue(value, fmt, locale = 'ko') {
  const f = String(fmt)
  if (f === '') return ''
  const secs = splitSections(f)
  if (typeof value === 'string') {
    const tsec = secs[3] ?? (secs.length === 1 && /@/.test(secs[0]) ? secs[0] : null)
    if (tsec != null) return tokenizeFmt(tsec).map((t) => (t.k === 'at' ? value : t.k === 'lit' ? t.v : '')).join('')
    return value
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const x = value
  let idx = 0
  let showMinus = true
  if (secs.length >= 2) {
    if (x < 0) { idx = 1; showMinus = false }
    else if (x === 0 && secs.length >= 3) idx = 2
  }
  const toks = tokenizeFmt(secs[idx])
  if (toks.length === 1 && toks[0].k === 'general') return numToStr(x)
  const isDate = toks.some((t) => t.k === 'date' || t.k === 'elapsed' || t.k === 'ampm')
  if (isDate) {
    const stripped = toks.map((t) => (t.k === 'date' && t.v === 'm' ? { ...t } : t))
    return formatDate(x, stripped, locale)
  }
  if (toks.some((t) => t.k === 'at')) return toks.map((t) => (t.k === 'at' ? numToStr(x) : t.k === 'lit' ? t.v : '')).join('')
  const fr = fractionFormat(secs[idx], x)
  if (fr != null) return fr
  return formatNumberSection(x, toks, x < 0, showMinus)
}

/** 분수 서식 "# ?/?" "?/?" "# ??/??" "# ?/8" */
function fractionFormat(sec, x) {
  const m = /^\s*(#\s+)?(\?+|#+)\/(\?+|#+|\d+)\s*$/.exec(sec)
  if (!m) return null
  const withWhole = !!m[1]
  const fixed = /^\d+$/.test(m[3]) ? Number(m[3]) : null
  const maxDen = fixed ?? 10 ** m[3].length - 1
  const neg = x < 0
  let v = Math.abs(x)
  let whole = withWhole ? Math.floor(v) : 0
  let frac = v - whole
  let bp = 0, bq = 1, best = Infinity
  for (let q = fixed ?? 1; q <= (fixed ?? maxDen); q++) {
    const p = Math.round(frac * q)
    const err = Math.abs(frac - p / q)
    if (err < best - 1e-12) { best = err; bp = p; bq = q }
  }
  if (bp === bq) { whole += withWhole ? 1 : 0; bp = 0; if (!withWhole) { bp = bq } }
  let out
  if (bp === 0 && withWhole) out = String(whole)
  else out = `${withWhole && whole > 0 ? `${whole} ` : ''}${bp}/${bq}`
  return (neg ? '-' : '') + out
}

/** 유효숫자 15자리까지만 쓰고 나머지 소수 자리는 0으로 채운다(구글은 15자리 이후를 0으로 표시) */
function paddedDecimal(v, d) {
  const [m, e] = Math.abs(v).toExponential(14).split('e')
  const digits = m.replace('.', '')
  const exp = Number(e)
  let int, frac
  if (exp >= 0) { int = digits.slice(0, exp + 1).padEnd(exp + 1, '0'); frac = digits.slice(exp + 1) }
  else { int = '0'; frac = '0'.repeat(-exp - 1) + digits }
  frac = frac.padEnd(d, '0').slice(0, d)
  return (v < 0 ? '-' : '') + int + (d ? `.${frac}` : '')
}
