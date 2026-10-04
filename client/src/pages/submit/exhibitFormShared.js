// 전시회 접수 공용 상수·헬퍼 (12_BACKEND 5절) — JSX 없는 모듈(fast refresh 분리)
// 제출자 신원은 로그인한 구글 계정이다(41_AUTH_CONTRACT) — 이 모듈은 신원 값을 다루지 않는다.
// 기간 판정의 최종 권한은 서버(403) — settings/public 플래그는 UX 안내용.

export const DESC_MAX = 100

export const ENTRY_TYPE_LABEL = { solo: '개인', team: '팀' }

export const inputCls =
  'w-full min-w-0 rounded-md border border-border-subtle bg-bg-panel px-16 py-12 text-body-m text-text-pri placeholder:text-text-meta transition-colors duration-fast ease-out enabled:hover:border-border-strong focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-bg-elev disabled:text-text-disabled read-only:cursor-default read-only:bg-bg-elev read-only:text-text-meta aria-[invalid=true]:border-state-error md:text-body-d'
export const labelCls = 'text-small-m font-semibold text-text-pri md:text-small-d'

const kstFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
})

export function formatKst(iso) {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : kstFormat.format(date)
}

/** B1 에러 계약({error, hint?}) → 사용자 문구. 401은 로그인 만료, 403은 기간 밖, 429는 rate limit. */
export function submitErrorMessage(err) {
  // 41: 공개 인증이 끊긴 경우 서버 원문('google login required') 대신 재로그인을 안내한다
  if (err?.status === 401) return '로그인이 풀렸습니다. 구글 로그인을 다시 해주세요.'
  if (err?.status === 403) return err.message || '접수·수정 기간이 아닙니다.'
  if (err?.status === 429)
    return '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'
  const parts = [err?.message, err?.hint].filter(Boolean)
  return parts.length
    ? parts.join(' / ')
    : '요청에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

/**
 * Y2-4-8 과목 목록 — 어드민(Y3-1)이 전시회 설정에 등록한 과목을 공개 설정 응답에서 읽는다.
 *
 * Y3와 병렬 작업이라 저장 위치·모양이 아직 확정되지 않았다. 후보 경로를 모두 훑고
 * 문자열/객체 어느 형태든 { value, label, semester }로 정규화한다. 아무것도 없으면
 * 빈 배열을 돌려주고, 호출부는 자유 입력으로 폴백해 접수가 막히지 않게 한다.
 * @param {object} settingsRes GET /settings/public 응답 전체
 * @returns {{value: string, label: string, semester: (string|null)}[]}
 */
export function resolveSubjects(settingsRes) {
  const exhibition = settingsRes?.exhibition ?? {}
  const settings = settingsRes?.settings ?? {}
  const raw =
    exhibition.subjects ??
    exhibition.courses ??
    settings.exhibition_subjects ??
    settings.exhibitionSubjects ??
    []

  // { '1': [...], '2': [...] } 형태(학기별 분리 저장)도 하나의 목록으로 합친다
  const list = Array.isArray(raw)
    ? raw.map((item) => [null, item])
    : typeof raw === 'object' && raw !== null
      ? Object.entries(raw).flatMap(([semester, items]) =>
          (Array.isArray(items) ? items : []).map((item) => [semester, item])
        )
      : []

  const seen = new Set()
  const out = []
  for (const [groupSemester, item] of list) {
    const label =
      typeof item === 'string'
        ? item
        : (item?.name ?? item?.label ?? item?.title ?? item?.subject ?? '')
    const name = String(label).trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const semester = item?.semester ?? item?.semester_label ?? groupSemester ?? null
    out.push({
      value: name,
      label: name,
      semester: semester === null || semester === undefined ? null : String(semester),
    })
  }
  return out
}

/**
 * H2-2 회차 — 어드민 전시회 설정(site_settings.exhibitionOrdinal)에 저장한 값.
 * GET /settings/public이 exhibition.ordinal · settings.exhibitionOrdinal 두 경로로 내려준다.
 * @param {object} settingsRes GET /settings/public 응답 전체
 * @returns {number|null} 양의 정수 회차. 지정 전이면 null.
 */
export function resolveOrdinal(settingsRes) {
  const raw =
    settingsRes?.exhibition?.ordinal ?? settingsRes?.settings?.exhibitionOrdinal ?? null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * H2-4 현재 접수 대상 학기 — 접수 폼의 과목 목록 기본값이 된다.
 * @param {object} settingsRes GET /settings/public 응답 전체
 * @returns {string} '1' 또는 '2' (미지정이면 '1')
 */
export function resolveCurrentSemester(settingsRes) {
  const raw =
    settingsRes?.exhibition?.current_semester ??
    settingsRes?.settings?.exhibitionSemester ??
    1
  return Number(raw) === 2 ? '2' : '1'
}

/** 과목 카드 부제 — '1' → '1학기'. 이미 '학기'가 들어간 라벨은 그대로 둔다. */
export function semesterDesc(semester) {
  if (!semester) return undefined
  const s = String(semester)
  return /학기/.test(s) ? s : `${s}학기`
}
