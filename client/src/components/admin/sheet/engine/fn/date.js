// 날짜·시간 함수. 일련번호는 1899-12-30 기준. 근거: https://support.google.com/docs/table/25273 (Date 범주), https://support.google.com/docs/answer/3092991
import { def, alias } from '../registry.js'
import { GErr, eValue, eNum, eNA } from '../errors.js'
import { isRng, isMat, N, S, B, I, parseNumberText } from '../coerce.js'
import { serialFromYMD, serialFromParts, partsFromSerial, serialFromDate, isLeap, daysInMonth, parseDateText, parseTimeText } from '../dates.js'
import { flat } from './util.js'

const D = 'date'
const fl = (x) => Math.floor(x + 1e-9)
const ymd = (s) => partsFromSerial(fl(s))
const dateArg = (v) => N(v)

def('DATE', D, 3, 3, 'DATE(년, 월, 일)', '년·월·일로 날짜 만들기', (a) => {
  let y = Math.trunc(N(a[0])); const m = Math.trunc(N(a[1])), d = Math.trunc(N(a[2]))
  if (y < 0 || y > 9999) throw eNum('DATE: year out of range.')
  if (y < 1900) y += 1900
  return serialFromYMD(y, 1, 1) + 0 + (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000
}, { ew: true })
def('DATEVALUE', D, 1, 1, 'DATEVALUE(텍스트)', '날짜 텍스트를 일련번호로', (a) => {
  const s = S(a[0]); const v = parseDateText(s)
  if (v == null) throw eValue(`DATEVALUE parameter '${s}' cannot be parsed as date.`)
  return Math.floor(v)
}, { ew: true })
def('TIMEVALUE', D, 1, 1, 'TIMEVALUE(텍스트)', '시간 텍스트를 하루 중 비율(0~1)로', (a) => {
  const s = S(a[0]); let v = parseTimeText(s)
  if (v == null) { const d = parseDateText(s); if (d != null) v = d - Math.floor(d) }
  if (v == null) throw eValue(`TIMEVALUE parameter '${s}' cannot be parsed as time.`)
  return v - Math.floor(v)
}, { ew: true })
def('TIME', D, 3, 3, 'TIME(시, 분, 초)', '시·분·초로 하루 중 비율 만들기', (a) => {
  const h = Math.trunc(N(a[0])), m = Math.trunc(N(a[1])), s = Math.trunc(N(a[2]))
  if (h < 0 || m < 0 || s < 0) throw eNum('TIME: negative argument.')
  const t = (h * 3600 + m * 60 + s) / 86400
  return t - Math.floor(t)
}, { ew: true })
def('YEAR', D, 1, 1, 'YEAR(날짜)', '연도', (a) => ymd(dateArg(a[0])).y, { ew: true })
def('MONTH', D, 1, 1, 'MONTH(날짜)', '월', (a) => ymd(dateArg(a[0])).m, { ew: true })
def('DAY', D, 1, 1, 'DAY(날짜)', '일', (a) => ymd(dateArg(a[0])).d, { ew: true })
const secOfDay = (v) => { const x = N(v); return Math.round((x - Math.floor(x + 1e-12)) * 86400) } // 가까운 초로 반올림(관찰: SECOND(0.5001) = 9)
def('HOUR', D, 1, 1, 'HOUR(시간)', '시', (a) => Math.floor(secOfDay(a[0]) / 3600) % 24, { ew: true })
def('MINUTE', D, 1, 1, 'MINUTE(시간)', '분', (a) => Math.floor(secOfDay(a[0]) / 60) % 60, { ew: true })
def('SECOND', D, 1, 1, 'SECOND(시간)', '초', (a) => secOfDay(a[0]) % 60, { ew: true })
def('TODAY', D, 0, 0, 'TODAY()', '오늘 날짜(휘발성)', (a, ctx) => Math.floor(serialFromDate(ctx.now())), { vol: true })
def('NOW', D, 0, 0, 'NOW()', '지금 날짜와 시각(휘발성)', (a, ctx) => serialFromDate(ctx.now()), { vol: true })
def('TO_DATE', D, 1, 1, 'TO_DATE(값)', '숫자를 날짜로(표시 서식이 날짜)', (a) => N(a[0]), { ew: true })
def('DAYS', D, 2, 2, 'DAYS(끝, 시작)', '두 날짜 사이 일수', (a) => Math.trunc(N(a[0])) - Math.trunc(N(a[1])), { ew: true })
def('EDATE', D, 2, 2, 'EDATE(시작일, 개월 수)', '개월을 더한 날짜', (a) => {
  const p = ymd(N(a[0])); const mo = Math.trunc(N(a[1]))
  const t = p.y * 12 + (p.m - 1) + mo
  const y = Math.floor(t / 12), m = (t % 12 + 12) % 12 + 1
  return serialFromYMD(y, m, Math.min(p.d, daysInMonth(y, m)))
}, { ew: true })
def('EOMONTH', D, 2, 2, 'EOMONTH(시작일, 개월 수)', '개월을 더한 달의 마지막 날', (a) => {
  const p = ymd(N(a[0])); const mo = Math.trunc(N(a[1]))
  const t = p.y * 12 + (p.m - 1) + mo
  const y = Math.floor(t / 12), m = (t % 12 + 12) % 12 + 1
  return serialFromYMD(y, m, daysInMonth(y, m))
}, { ew: true })
def('DATEDIF', D, 3, 3, 'DATEDIF(시작일, 종료일, 단위)', '두 날짜의 차이(Y M D MD YM YD)', (a) => {
  const s = fl(N(a[0])), e = fl(N(a[1])); const u = S(a[2]).toUpperCase()
  if (s > e) throw eNum('DATEDIF: start date is after end date.')
  const p = ymd(s), q = ymd(e)
  let months = (q.y - p.y) * 12 + (q.m - p.m) - (q.d < p.d ? 1 : 0)
  switch (u) {
    case 'Y': return Math.floor(months / 12)
    case 'M': return months
    case 'D': return e - s
    case 'MD': {
      if (q.d >= p.d) return q.d - p.d
      const pm = q.m === 1 ? 12 : q.m - 1, py = q.m === 1 ? q.y - 1 : q.y
      return daysInMonth(py, pm) - p.d + q.d
    }
    case 'YM': return ((months % 12) + 12) % 12
    case 'YD': { // 관찰: 2023-12-31 ~ 2025-06-15 = 167 (연중 일수 차이, 음수면 (끝 연도-1)의 일수를 더함)
      const doy = (x) => Math.floor(x) - serialFromYMD(partsFromSerial(Math.floor(x)).y, 1, 1)
      let d = doy(e) - doy(s)
      if (d < 0) d += isLeap(q.y - 1) ? 366 : 365
      return d
    }
    default: throw eNum(`DATEDIF: unit '${u}' is invalid.`)
  }
}, { ew: true })
const WD_START = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 }
def('WEEKDAY', D, 1, 2, 'WEEKDAY(날짜, [유형])', '요일 번호(유형 1: 일=1, 2: 월=1, 3: 월=0, 11~17)', (a) => {
  const dow = ymd(N(a[0])).dow; const t = a[1] == null ? 1 : Math.trunc(N(a[1]))
  if (t === 3) return (dow + 6) % 7
  if (!(t in WD_START)) throw eNum(`WEEKDAY: type ${t} is invalid.`)
  return ((dow - WD_START[t] + 7) % 7) + 1
}, { ew: true })
function isoWeek(serial) {
  const p = ymd(serial); const dow = (p.dow + 6) % 7
  const thu = fl(serial) - dow + 3
  const y = ymd(thu).y
  return Math.floor((thu - serialFromYMD(y, 1, 1)) / 7) + 1
}
def('ISOWEEKNUM', D, 1, 1, 'ISOWEEKNUM(날짜)', 'ISO 주 번호', (a) => isoWeek(N(a[0])), { ew: true })
def('WEEKNUM', D, 1, 2, 'WEEKNUM(날짜, [유형])', '주 번호(유형 1: 일요일 시작, 2: 월요일 시작, 11~17, 21: ISO)', (a) => {
  const s = fl(N(a[0])); const t = a[1] == null ? 1 : Math.trunc(N(a[1]))
  if (t === 21) return isoWeek(s)
  if (!(t in WD_START)) throw eNum(`WEEKNUM: type ${t} is invalid.`)
  const p = ymd(s); const jan1 = serialFromYMD(p.y, 1, 1)
  const off = (ymd(jan1).dow - WD_START[t] + 7) % 7
  return Math.floor((s - jan1 + off) / 7) + 1
}, { ew: true })
function weekendSet(spec) {
  const set = new Set()
  if (spec == null) { set.add(0); set.add(6); return set }
  if (typeof spec === 'string' && /^[01]{7}$/.test(spec)) { if (spec === '1111111') throw eValue('weekend string all 1.'); for (let i = 0; i < 7; i++) if (spec[i] === '1') set.add((i + 1) % 7); return set }
  const n = Math.trunc(N(spec))
  if (n >= 1 && n <= 7) { const first = (n + 5) % 7; set.add(first); set.add((first + 1) % 7) } // 1:토일 2:일월 ... (dow 0=일)
  else if (n >= 11 && n <= 17) set.add((n - 11) % 7)
  else throw eNum(`weekend ${n} is invalid.`)
  return set
}
function weekendFor(n) {
  const spec = typeof n === 'string' ? n : n
  return weekendSet(spec)
}
const holidaySet = (v, ctx) => { const s = new Set(); if (v != null) for (const x of flat(v, ctx)) if (x != null) s.add(fl(N(x))); return s }
function networkdays(s, e, wk, hol) {
  const sign = s <= e ? 1 : -1
  const [lo, hi] = s <= e ? [s, e] : [e, s]
  let n = 0
  for (let d = lo; d <= hi; d++) if (!wk.has(ymd(d).dow) && !hol.has(d)) n++
  return sign * n
}
def('NETWORKDAYS', D, 2, 3, 'NETWORKDAYS(시작일, 종료일, [휴일])', '토·일을 뺀 근무일 수', (a, ctx) => networkdays(fl(N(a[0])), fl(N(a[1])), weekendSet(null), holidaySet(a[2], ctx)))
def('NETWORKDAYS.INTL', D, 2, 4, 'NETWORKDAYS.INTL(시작일, 종료일, [주말], [휴일])', '주말 규칙을 지정한 근무일 수', (a, ctx) => networkdays(fl(N(a[0])), fl(N(a[1])), weekendFor(a[2]), holidaySet(a[3], ctx)))
function workday(s, days, wk, hol) {
  let d = fl(s); let left = Math.abs(days); const step = days >= 0 ? 1 : -1
  while (left > 0) { d += step; if (!wk.has(ymd(d).dow) && !hol.has(d)) left-- }
  return d
}
def('WORKDAY', D, 2, 3, 'WORKDAY(시작일, 일수, [휴일])', '근무일 기준 n일 뒤 날짜', (a, ctx) => workday(N(a[0]), Math.trunc(N(a[1])), weekendSet(null), holidaySet(a[2], ctx)))
def('WORKDAY.INTL', D, 2, 4, 'WORKDAY.INTL(시작일, 일수, [주말], [휴일])', '주말 규칙을 지정한 n 근무일 뒤 날짜', (a, ctx) => workday(N(a[0]), Math.trunc(N(a[1])), weekendFor(a[2]), holidaySet(a[3], ctx)))
function days360(s, e, european) {
  const p = ymd(s), q = ymd(e)
  let d1 = p.d, d2 = q.d
  if (european) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30 } else {
    const lastFeb = (x) => x.m === 2 && x.d === daysInMonth(x.y, 2)
    if (lastFeb(p) && lastFeb(q)) d2 = 30
    if (lastFeb(p)) d1 = 30
    if (d2 === 31 && d1 >= 30) d2 = 30
    if (d1 === 31) d1 = 30
  }
  return (q.y - p.y) * 360 + (q.m - p.m) * 30 + (d2 - d1)
}
def('DAYS360', D, 2, 3, 'DAYS360(시작일, 종료일, [유럽식?])', '30일/월 기준 일수', (a) => days360(fl(N(a[0])), fl(N(a[1])), a[2] != null && B(a[2])), { ew: true })
def('YEARFRAC', D, 2, 3, 'YEARFRAC(시작일, 종료일, [기준])', '두 날짜 사이 연 단위 비율(기준 0~4)', (a) => {
  let s = fl(N(a[0])), e = fl(N(a[1])); const basis = a[2] == null ? 0 : Math.trunc(N(a[2]))
  if (s > e) [s, e] = [e, s]
  switch (basis) {
    case 0: return days360(s, e, false) / 360
    case 4: return days360(s, e, true) / 360
    case 2: return (e - s) / 360
    case 3: return (e - s) / 365
    case 1: {
      const p = ymd(s), q = ymd(e)
      let yl
      if (p.y === q.y || (q.y === p.y + 1 && (q.m < p.m || (q.m === p.m && q.d <= p.d)))) {
        if (p.y === q.y) yl = isLeap(p.y) ? 366 : 365
        else yl = (isLeap(p.y) && (p.m < 3)) || (isLeap(q.y) && (q.m > 2 || (q.m === 2 && q.d === 29))) ? 366 : 365
      } else { let tot = 0; for (let y = p.y; y <= q.y; y++) tot += isLeap(y) ? 366 : 365; yl = tot / (q.y - p.y + 1) }
      return (e - s) / yl
    }
    default: throw eNum(`YEARFRAC: basis ${basis} is invalid.`)
  }
}, { ew: true })
def('EPOCHTODATE', D, 1, 2, 'EPOCHTODATE(타임스탬프, [단위])', '유닉스 시간을 날짜·시각으로(단위 1=초 2=밀리초 3=마이크로초)', (a) => {
  const u = a[1] == null ? 1 : Math.trunc(N(a[1])); const t = N(a[0])
  const ms = u === 1 ? t * 1000 : u === 2 ? t : u === 3 ? t / 1000 : NaN
  if (Number.isNaN(ms)) throw eNum('EPOCHTODATE: unit must be 1, 2 or 3.')
  return ms / 86400000 + 25569
}, { ew: true })
