// formStatus.js: 신청 폼의 지금 상태를 한 단어로 알려준다.
// 서버(routes/forms.js windowState)와 같은 규칙이다. 접수 시작과 마감이 둘 다 있어야 신청을 받을 수 있다.
// 비개발자가 목록에서 "지금 신청이 열려 있나"를 바로 알 수 있게 목록과 편집기가 함께 쓴다.

/**
 * @param {boolean} published 공개 여부
 * @param {{accept_start?: string|null, accept_end?: string|null}} settings 접수 기간(ISO 문자열)
 * @param {Date} [now]
 * @returns {{key: string, label: string, tone: 'ok'|'warn'|'muted'|'info', note: string}}
 */
export function formStatus(published, settings = {}, now = new Date()) {
  if (!published) {
    return { key: 'draft', label: '비공개', tone: 'muted', note: '아직 사이트에 공개하지 않았습니다' }
  }
  const start = settings?.accept_start ? new Date(settings.accept_start) : null
  const end = settings?.accept_end ? new Date(settings.accept_end) : null
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { key: 'noperiod', label: '기간 미설정', tone: 'warn', note: '접수 시작과 마감을 정해야 신청을 받을 수 있습니다' }
  }
  if (now < start) return { key: 'soon', label: '접수 예정', tone: 'info', note: '접수 시작 전입니다' }
  if (now > end) return { key: 'closed', label: '접수 마감', tone: 'muted', note: '접수 기간이 끝났습니다' }
  return { key: 'open', label: '접수 중', tone: 'ok', note: '지금 신청을 받고 있습니다' }
}
