// 공문서 표기 자동 고침: 근거를 직접 열어 확인한 규칙만 넣는다. 순수 함수(DOM 없음).
// 근거(열어 본 원문)
//  [영7⑤]  「행정업무의 운영 및 혁신에 관한 규정」 제7조제5항 (법제처 law.go.kr): 날짜는 연ㆍ월ㆍ일 글자를 빼고 온점, 시ㆍ분은 24시각제와 쌍점
//  [규칙2①] 「같은 규정 시행규칙」 제2조제1항: 항목부호 1., 가., 1), 가), (1), (가), ①, ㉮ 와 특수기호 □, ○, -, ㆍ
//  [규칙2②] 같은 조 제2항: 금액은 아라비아 숫자 다음 괄호에 한글 (예: 금113,560원(금일십일만삼천오백육십원))
//  [규칙4④⑤] 같은 규칙 제4조제4항, 제5항: 붙임 표시, 끝 표시(마지막 글자에서 한 글자 띄우고)
//  [편람] 행정안전부 「2020 행정업무운영 편람」(mois.go.kr): 날짜 월·일 '0' 불표기, 2타(한글 1자) = 스페이스 2번,
//         붙임 표기 `붙임∨∨계획서 1부.∨∨끝.`, 쌍점은 앞말에 붙이고 뒷말과 띄움, 물결표는 앞뒤에 붙임(4. 23.~6. 15.),
//         항목기호와 내용 사이 1타, 항목이 하나뿐이면 항목기호를 쓰지 않음

const SP2 = '  '

/** 날짜 숫자 표기: 2026.09.01 / 2026-9-1 / 2026. 09. 01. -> 2026. 9. 1. [영7⑤][편람] */
export function fixDates(text) {
  const changes = []
  const out = text.replace(/(?<![\d.])(\d{4})\s?[.\-/]\s?(\d{1,2})\s?[.\-/]\s?(\d{1,2})(?:\s?\.)?(?![\d])/g, (m, y, mo, d) => {
    const mm = Number(mo)
    const dd = Number(d)
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return m
    const to = `${y}. ${mm}. ${dd}.`
    // 뒤에 바로 이어지는 온점(문장 끝)과 중복되지 않게 한다
    if (to !== m) changes.push({ rule: 'date', from: m, to })
    return to
  })
  return { text: out, changes }
}

/** 한글 연월일 표기: 2026년 9월 1일 -> 2026. 9. 1. [영7⑤]. 요일 괄호는 그대로 둔다 */
export function fixKoreanDates(text) {
  const changes = []
  const out = text.replace(/(\d{4})\s?년\s?(\d{1,2})\s?월\s?(\d{1,2})\s?일/g, (m, y, mo, d) => {
    const to = `${y}. ${Number(mo)}. ${Number(d)}.`
    changes.push({ rule: 'date_korean', from: m, to })
    return to
  })
  return { text: out, changes }
}

/** 시각: 오후 3시 20분 -> 15:20 [영7⑤]. 오전/오후가 있거나 '시 분'이 모두 있을 때만 바꾼다 */
export function fixTimes(text) {
  const changes = []
  const out = text.replace(/(오전|오후)?\s?(\d{1,2})\s?시\s?(?:(\d{1,2})\s?분)?/g, (m, ap, h, mi) => {
    if (!ap && mi === undefined) return m
    let hh = Number(h)
    if (hh > 24) return m
    if (ap === '오후' && hh < 12) hh += 12
    if (ap === '오전' && hh === 12) hh = 0
    const to = `${String(hh).padStart(2, '0')}:${String(mi === undefined ? 0 : Number(mi)).padStart(2, '0')}`
    changes.push({ rule: 'time', from: m.trim(), to })
    return m.startsWith(' ') ? ` ${to}` : to
  })
  return { text: out, changes }
}

/** 붙임 표시: `붙임` 뒤 2타. 붙임:, 붙임 1개 [규칙4④][편람] */
export function fixAttachment(text) {
  const changes = []
  const out = text.replace(/^(\s*)붙임(?:\s*:\s*|\s{0,1})(?=\S)/gm, (m, lead) => {
    const to = `${lead}붙임${SP2}`
    if (to !== m) changes.push({ rule: 'attachment_space', from: m.trim(), to: to.trim() })
    return to
  })
  return { text: out, changes }
}

/** 끝 표시: 마지막 글자에서 한 글자(2타) 띄우고 `끝.` [규칙4⑤][편람] */
export function fixEndMark(text) {
  const changes = []
  const out = text.replace(/(\S)[ \u00a0]{0,1}(끝\.)\s*$/, (m, prev, end) => {
    const to = `${prev}${SP2}${end}`
    if (m !== to) changes.push({ rule: 'end_mark', from: m, to })
    return to
  }).replace(/(\S)[ \u00a0]{3,}(끝\.)\s*$/, (m, prev, end) => {
    const to = `${prev}${SP2}${end}`
    changes.push({ rule: 'end_mark', from: m, to })
    return to
  })
  return { text: out, changes }
}

/** 쌍점: 앞말에 붙이고 뒷말과 한 칸 띄운다 [편람 문장부호]. 시각(15:20)과 비율은 건드리지 않는다 */
export function fixColon(text) {
  const changes = []
  const out = text.replace(/([가-힣A-Za-z)\]])\s+:\s*(?=\S)/g, (m, prev) => {
    const to = `${prev}: `
    changes.push({ rule: 'colon', from: m, to })
    return to
  })
  return { text: out, changes }
}

/** 기간 물결표: 앞뒤를 붙인다 [편람]. 날짜 뒤에서만 */
export function fixTilde(text) {
  const changes = []
  const out = text.replace(/(\d\.)\s+~\s*(?=\d)/g, (m, prev) => {
    const to = `${prev}~`
    changes.push({ rule: 'tilde', from: m, to })
    return to
  }).replace(/(\d\.)\s*~\s+(?=\d)/g, (m, prev) => {
    const to = `${prev}~`
    changes.push({ rule: 'tilde', from: m, to })
    return to
  })
  return { text: out, changes }
}

/** 항목기호와 내용 사이 1타: `1.내용`, `가.내용`, `1)내용`, `(1)내용` -> 한 칸 띄움 [편람] */
export function fixMarkerSpace(text) {
  const changes = []
  const out = text.replace(/^(\s*)((?:\d{1,2}\.|[가-하]\.|\d{1,2}\)|[가-하]\)|\(\d{1,2}\)|\([가-하]\)))(?=[가-힣A-Za-z「“"'])/gm, (m, lead, mark) => {
    const to = `${lead}${mark} `
    changes.push({ rule: 'marker_space', from: m.trim(), to: to.trim() })
    return to
  })
  return { text: out, changes }
}

/** 공문 표기 고침을 한꺼번에: 순서가 있다(한글 날짜 -> 숫자 날짜 -> 시각 ...) */
export const FIXERS = [
  ['date_korean', fixKoreanDates],
  ['date', fixDates],
  ['time', fixTimes],
  ['attachment_space', fixAttachment],
  ['end_mark', fixEndMark],
  ['colon', fixColon],
  ['tilde', fixTilde],
  ['marker_space', fixMarkerSpace],
]

export function fixGongmunText(text, only) {
  let cur = String(text ?? '')
  const changes = []
  for (const [id, fn] of FIXERS) {
    if (only && !only.includes(id)) continue
    const r = fn(cur)
    cur = r.text
    changes.push(...r.changes)
  }
  return { text: cur, changes }
}

export const RULE_KO = {
  date_korean: '날짜 표기(연월일 글자를 온점으로)',
  date: '날짜 표기(월·일의 0 빼기, 온점)',
  time: '시각 24시각제',
  attachment_space: '붙임 뒤 2칸',
  end_mark: '끝 표시 앞 2칸',
  colon: '쌍점 띄어쓰기',
  tilde: '물결표 붙여 쓰기',
  marker_space: '항목부호 뒤 한 칸',
}

/**
 * 서버 공문 검사(kordoc lint)의 규칙 id -> 이쪽에서 고칠 수 있는 규칙들. 없으면 null(자동으로 고치지 않는다).
 * 서버의 suggest 는 "예) 2025. 1. 6." 같은 설명용 예시라서 그대로 바꿔 넣으면 안 된다. 고칠 글은 이쪽 규칙이 만든다.
 */
const RULE_MAP = {
  DATE_NO_SPACE: ['date'], DATE_ZERO_PAD: ['date'], DATE_HYPHEN: ['date'], DATE_NO_END_DOT: ['date'], DATE_KOREAN: ['date_korean'],
  TIME_AMPM: ['time'], COLON_SPACE: ['colon'], END_MARK_SPACE: ['end_mark'], TILDE_SPACE: ['tilde'],
}
export function fixersForRule(rule) {
  const r = String(rule || '').toUpperCase()
  if (RULE_MAP[r]) return RULE_MAP[r]
  if (/^ATTACH/.test(r)) return ['attachment_space']
  return null
}

/** 개조식 문체 점검(관행): 본문 줄 끝이 서술형 종결이면 true. 규정 조문이 아니라 관행이므로 지적 용도로만 쓴다 */
export function looksNarrative(text) {
  const t = String(text || '').trim().replace(/[\s.]+$/, '')
  return /(합니다|입니다|됩니다|습니다|하였다|하였음\s*다|이다|한다|된다)$/.test(t)
}
