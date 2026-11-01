// format.js — 33_PHASE18 공용 입력 포맷·검증 유틸 (Y1 상담·Y2 접수 공용)
//
// 연락처는 010-XXXX-XXXX 고정이다. 숫자 외 문자는 입력 자체가 되지 않게 하고(비숫자 제거),
// 4자·8자 경계에서 하이픈을 자동 삽입하며 11자리를 넘겨 입력되지 않는다.

/**
 * 입력값을 010-XXXX-XXXX 형태로 강제한다.
 * 숫자만 남기고 최대 11자리로 자른 뒤 3-4-4로 하이픈을 넣는다.
 * @param {string} raw 사용자가 친 원문
 * @returns {string} 하이픈이 적용된 문자열
 */
export function formatPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

/** 010으로 시작하는 완전한 11자리인지 */
export function isValidPhone(v) {
  return /^010-\d{4}-\d{4}$/.test(String(v ?? ''))
}

/** 이메일 @ 포함 형식 검증 — 로컬@도메인.TLD */
export function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim())
}

/**
 * 날짜 → 학기 라벨 (52_CONTEST_CATEGORY)
 * 1~6월은 1학기, 7~12월은 2학기. 'YYYY-M' 형태로 반환하고, 파싱 실패 시 null.
 * 학기 라벨을 직접 저장하지 않은 게시글도 개최일에서 같은 규칙으로 산출한다.
 * @param {string|Date|null|undefined} date - 'YYYY-MM-DD' 또는 ISO 문자열
 * @returns {string|null} 예: '2026-1'
 */
export function semesterOf(date) {
  if (!date) return null
  const s = String(date)
  const m = s.match(/^(\d{4})-(\d{2})/)
  const year = m ? Number(m[1]) : NaN
  const month = m ? Number(m[2]) : NaN
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return `${year}-${month <= 6 ? 1 : 2}`
}

/**
 * 게시글의 학기 라벨 — 저장된 semester_label이 원본이고, 없으면 개최일에서 산출한다.
 * 카드·상세가 같은 규칙을 쓰도록 한 곳에 둔다.
 */
export function semesterLabelOf(item) {
  if (!item) return null
  return item.semester_label || semesterOf(item.event_start || item.start_date || item.created_at)
}

// ── 시각 표기: 오전, 오후 없이 24시간제로 쓴다 (00시, 14시 30분, 23시 59분) ──
function kstParts(value, timeZone = 'Asia/Seoul') {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const out = {}
  new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .forEach((part) => {
      out[part.type] = part.value
    })
  return out
}

/** 시각만: 정각이면 "00시", 아니면 "23시 59분" */
export function formatTime24(value, timeZone) {
  const p = kstParts(value, timeZone)
  if (!p) return ''
  const hour = String(p.hour).padStart(2, '0')
  return p.minute === '00' ? `${hour}시` : `${hour}시 ${p.minute}분`
}

/** 날짜와 시각: "2026년 11월 2일 00시", 연도를 빼면 "11월 2일 00시" */
export function formatDateTime24(value, { timeZone, year = true } = {}) {
  const p = kstParts(value, timeZone)
  if (!p) return ''
  const day = `${p.month}월 ${p.day}일`
  return `${year ? `${p.year}년 ` : ''}${day} ${formatTime24(value, timeZone)}`
}
