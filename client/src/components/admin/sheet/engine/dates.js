// 날짜 일련번호. 구글 시트는 1899-12-30을 0으로 쓴다. (https://support.google.com/docs/answer/3092991)
const DAY = 86400000
const EPOCH_OFFSET = 25569 // 1970-01-01의 일련번호

export const serialFromYMD = (y, m, d) => Date.UTC(y, m - 1, d) / DAY + EPOCH_OFFSET
export function serialFromParts(y, mo, d, h = 0, mi = 0, s = 0, ms = 0) {
  return (Date.UTC(y, mo - 1, d, h, mi, s, ms) / DAY) + EPOCH_OFFSET
}
/** 일련번호에서 UTC 기준 날짜 요소를 뽑는다(내림 처리) */
export function partsFromSerial(serial) {
  const ms = Math.round((serial - EPOCH_OFFSET) * DAY)
  const dt = new Date(ms)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds(), ms: dt.getUTCMilliseconds(), dow: dt.getUTCDay() }
}
export const serialFromDate = (dt) => serialFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds(), dt.getMilliseconds())
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

const pad = (n, w = 2) => String(n).padStart(w, '0')
export function fmtDate(serial) {
  const p = partsFromSerial(Math.floor(serial))
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`
}
export function fmtTime(serial, withSec = true) {
  const frac = serial - Math.floor(serial)
  let secs = Math.round(frac * 86400)
  if (secs >= 86400) secs = 86399
  const h = Math.floor(secs / 3600), mi = Math.floor((secs % 3600) / 60), s = secs % 60
  return withSec ? `${pad(h)}:${pad(mi)}:${pad(s)}` : `${pad(h)}:${pad(mi)}`
}
export function fmtDateTime(serial) {
  const total = Math.round(serial * 86400) / 86400
  return `${fmtDate(total)} ${fmtTime(total, false)}`
}

/** 텍스트를 날짜/시간 일련번호로 해석한다. 못 읽으면 null. */
export function parseDateText(str) {
  const s = String(str).trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
    const h = Number(m[4] || 0), mi = Number(m[5] || 0), se = Number(m[6] || 0)
    if (h > 23 || mi > 59 || se > 59) return null
    return serialFromYMD(y, mo, d) + (h * 3600 + mi * 60 + se) / 86400
  }
  m = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(s) // 한국식 2024. 2. 29
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
    return serialFromYMD(y, mo, d)
  }
  m = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
    return serialFromYMD(y, mo, d)
  }
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m) {
    const mo = MON.indexOf(m[1].slice(0, 3).toLowerCase()) + 1
    const d = Number(m[2]), y = Number(m[3])
    if (mo && d >= 1 && d <= daysInMonth(y, mo)) return serialFromYMD(y, mo, d)
  }
  return null
}
export function parseTimeText(str) {
  const s = String(str).trim()
  const m = /^(\d{1,4}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM|am|pm|오전|오후)?$/.exec(s)
  if (!m) return null
  let h = Number(m[1]); const mi = Number(m[2]); const se = Number(m[3] || 0)
  if (mi > 59 || se > 59) return null
  if (m[4]) {
    const pm = /pm|오후/i.test(m[4])
    if (h < 1 || h > 12) return null
    h = (h % 12) + (pm ? 12 : 0)
  }
  return (h * 3600 + mi * 60 + se) / 86400
}

export function fmtDateKo(serial) {
  const p = partsFromSerial(Math.floor(serial + 1e-9))
  return `${p.y}. ${p.m}. ${p.d}`
}
/** 오전 9:00:00 형식 */
export function fmtTimeKo(serial) {
  const secs = Math.round((serial - Math.floor(serial + 1e-9)) * 86400) % 86400
  const h = Math.floor(secs / 3600), mi = Math.floor((secs % 3600) / 60), s = secs % 60
  return `${h >= 12 ? '오후' : '오전'} ${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
