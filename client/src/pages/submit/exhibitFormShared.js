import { isValidPhone } from '../../utils/format'
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

// 접수·수정 폼의 칸 id. 카드마다 하나씩이고, 오류가 있으면 이 순서로 가장 위 칸으로 이동한다.
export const FIELD_IDS = {
  applicant: 'exhibit-field-applicant',
  course: 'exhibit-field-course',
  files: 'exhibit-field-files',
  work: 'exhibit-field-work',
}

// 작품 제출은 오프라인 전시용 PDF와 온라인 웹전시용 PNG를 모두 받는다. 파일은 여러 개 올릴 수 있다.
function filesError({ filesUploading, fileCount, fileNames = [] }) {
  if (filesUploading) return { files: '파일을 올리는 중입니다. 올리기가 끝나면 다시 눌러 주세요' }
  if (fileCount === 0) return { files: '오프라인 전시용 PDF와 온라인 전시용 PNG를 모두 올려 주세요' }
  const hasPdf = fileNames.some((n) => /\.pdf$/i.test(String(n)))
  const hasPng = fileNames.some((n) => /\.png$/i.test(String(n)))
  if (!hasPdf && !hasPng) return { files: '오프라인 전시용 PDF와 온라인 전시용 PNG가 모두 필요합니다' }
  if (!hasPdf) return { files: '오프라인 전시용 PDF도 올려 주세요' }
  if (!hasPng) return { files: '온라인 전시용 PNG도 올려 주세요' }
  return {}
}

/**
 * 접수·저장 버튼을 눌렀을 때 칸별로 빠진 내용을 모은다. 비어 있는 객체면 통과.
 * 값은 칸(카드)에 붙일 오류 문장이다. 키 순서가 화면 위에서 아래 순서다.
 */
export function collectFormErrors({ isTeam, form, members, courseRequired, filesUploading, fileCount, fileNames, checkInfo = true, checkFiles = true }) {
  const errors = {}
  if (!checkInfo) return checkFiles ? filesError({ filesUploading, fileCount, fileNames }) : errors
  const lacksOf = (name, studentNo, major) =>
    [!String(name || '').trim() && '이름', !String(studentNo || '').trim() && '학번', !String(major || '').trim() && '전공'].filter(Boolean)
  const applicant = []
  if (isTeam) {
    if (!form.teamName.trim()) applicant.push('팀명을 입력해 주세요')
    members.forEach((m, i) => {
      const lacks = lacksOf(m.name, m.studentNo, m.major)
      if (lacks.length) applicant.push(`팀원 ${i + 1}의 ${lacks.join(', ')}을 입력해 주세요`)
    })
  } else {
    const lacks = lacksOf(form.name, form.studentNo, form.major)
    if (lacks.length) applicant.push(`${lacks.join(', ')}을 입력해 주세요`)
  }
  if (!isValidPhone(form.phone)) applicant.push('연락처를 010-0000-0000 형식으로 입력해 주세요')
  if (applicant.length) errors.applicant = applicant.join('\n')
  if (courseRequired && !String(form.course || '').trim()) errors.course = '과목을 선택해 주세요'
  if (checkFiles) Object.assign(errors, filesError({ filesUploading, fileCount, fileNames }))
  const work = []
  if (!form.workTitle.trim()) work.push('작품명을 입력해 주세요')
  if (!form.workDesc.trim()) work.push('작품 설명을 입력해 주세요')
  if (work.length) errors.work = work.join('\n')
  return errors
}

/** 오류가 있는 가장 위 칸으로 부드럽게 올라가 첫 빈 입력에 커서를 둔다 */
export function scrollToFirstError(errors) {
  const key = Object.keys(FIELD_IDS).find((k) => errors[k])
  const el = key ? document.getElementById(FIELD_IDS[key]) : null
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const inputs = Array.from(el.querySelectorAll('input:not([type=radio]):not([type=file]):not([type=hidden]),textarea'))
  const target = inputs.find((i) => !i.value) || inputs[0] || el.querySelector('button')
  target?.focus({ preventScroll: true })
}

