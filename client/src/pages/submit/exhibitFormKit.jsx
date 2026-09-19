// 전시회 접수 폼 공용 컴포넌트 (12_BACKEND 5절) — ExhibitSubmit·ExhibitEdit 전용
// LoginGate와 AccountBar만 공개 제출 공용이라 ShowcaseSubmit도 함께 쓴다(41_AUTH_CONTRACT).
// 상수·헬퍼는 exhibitFormShared.js(비 JSX 모듈) — 이 파일은 컴포넌트만 export.
import { useRef, useState } from 'react'
import { Lock, LogOut, Paperclip, Trash2, Upload, X } from 'lucide-react'
import GlassCard from '../../components/common/GlassCard'
import RadioCards from '../../components/common/RadioCards'
import GoogleLoginButton from '../../components/auth/GoogleLoginButton'
import { ACCENT } from '../../styles/accents'
import { api } from '../../hooks/useApi'
import { formatPhone } from '../../utils/format'
import { formatKst, inputCls, labelCls } from './exhibitFormShared'

// 53_DRIVE_STORAGE(전시회 확장): 원본 파일 확장자 허용목록. 서버가 최종 판정하지만,
// 업로드 창을 열 때 쓸데없는 파일을 미리 거르려고 accept로도 제시한다.
const ORIGINAL_FILE_ACCEPT =
  'image/*,.pdf,.ai,.eps,.psd,.tif,.tiff,.svg,.zip,.hwp,.hwpx,.docx,.xlsx,.pptx,.mp4,.mov'
const MAX_ORIGINAL_FILES = 10

/** 라벨+힌트 래퍼. 입력 1개면 기본 label, 그룹(팀원·과목 등)은 as="div". */
export function Field({ as: Tag = 'label', label, required = false, hint, children }) {
  return (
    <Tag className="flex min-w-0 flex-col gap-8">
      <span className="flex items-baseline gap-8">
        <span className={labelCls}>{label}</span>
        {required && (
          <span className="font-mono text-caption-m text-text-meta">(필수)</span>
        )}
      </span>
      {children}
      {hint && <p className="text-caption-m text-text-meta">{hint}</p>}
    </Tag>
  )
}

/**
 * 폼 제출 버튼 — Button 컴포넌트는 링크 전용이라 submit에는 쓸 수 없다.
 * 시각은 X2 Primary 위계와 동일한 토큰(bg-button-primary + shadow-btn)만 사용한다.
 */
export function SubmitButton({ busy = false, disabled = false, children, ...rest }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className="inline-flex h-11 cursor-pointer items-center justify-center rounded-sm bg-button-primary px-24 text-body-m font-semibold text-button-primaryText shadow-btn transition duration-fast ease-out hover:bg-button-primaryHover hover:shadow-btn-hover active:bg-button-primaryPressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:bg-bg-panel disabled:text-text-disabled disabled:shadow-none md:h-48 md:text-body-d"
      {...rest}
    >
      {children}
    </button>
  )
}

/** readonly 항목 — 자물쇠 아이콘 + 비활성 톤. 서버도 해당 값 변경을 무시한다. */
export function LockedField({ label, value }) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <span className="flex items-baseline gap-8">
        <span className={labelCls}>{label}</span>
        <span className="font-mono text-caption-m text-text-meta">(수정 불가)</span>
      </span>
      <div className="relative min-w-0">
        <input
          type="text"
          readOnly
          aria-label={`${label} (수정 불가 항목)`}
          value={value ?? ''}
          className={`${inputCls} cursor-not-allowed pr-48 text-text-meta focus:border-border-subtle`}
        />
        <Lock
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-16 top-1/2 -translate-y-1/2 text-text-meta"
        />
      </div>
    </div>
  )
}

/**
 * 로그인 게이트(41_AUTH_CONTRACT) — 비로그인 상태에서 폼 대신 노출한다.
 * 제출자 신원이 구글 계정으로 바뀌었으므로 폼에는 비밀번호 항목이 없다.
 * @param {string} title       카드 제목
 * @param {string} description 로그인이 필요한 이유 한 문단
 * @param {string} [next]      로그인 후 복귀 경로. 생략 시 현재 URL
 * @param {React.ReactNode} [children] 로그인 버튼 옆 보조 동선(막다른 화면 방지)
 */
export function LoginGate({ title, description, next, children }) {
  return (
    <GlassCard className="flex flex-col items-start gap-24 p-24 md:p-40">
      <h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">
        {title}
      </h2>
      <p className="text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">
        {description}
      </p>
      <div className="flex flex-wrap items-center gap-16">
        <GoogleLoginButton next={next} />
        {children}
      </div>
    </GlassCard>
  )
}

/**
 * 로그인 계정 표시(41_AUTH_CONTRACT) — 제출자 신원은 구글 계정이라 읽기 전용이다.
 * 계정을 바꾸려면 로그아웃뿐이므로 로그아웃도 신원이 보이는 이 자리에 둔다.
 * @param {{email: string, name?: string}} user
 * @param {Function} onLogout
 */
export function AccountBar({ user, onLogout }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-16 rounded-md border border-border-subtle bg-bg-elev px-16 py-12">
      <div className="flex min-w-0 flex-col gap-4">
        <span className="text-caption-m text-text-meta md:text-caption-d">
          로그인 계정
        </span>
        <span className="min-w-0 text-body-m font-semibold text-text-pri md:text-body-d">
          {user.name ? `${user.name} (${user.email})` : user.email}
        </span>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="inline-flex shrink-0 cursor-pointer items-center gap-8 rounded-sm border border-border-subtle px-16 py-8 text-small-m font-semibold text-text-pri transition-colors duration-fast ease-out hover:border-border-strong md:text-small-d"
      >
        <LogOut size={16} aria-hidden="true" />
        로그아웃
      </button>
    </div>
  )
}

/**
 * 연락처 입력 — 010-XXXX-XXXX 고정(Y2-4-5).
 * onChange에는 포맷이 끝난 값만 올린다. 숫자 외 문자는 formatPhone이 제거하므로
 * 입력 자체가 반영되지 않고, 11자리를 넘겨 칠 수도 없다.
 */
export function PhoneInput({ value, onChange, ...rest }) {
  return (
    <input
      type="tel"
      required
      inputMode="numeric"
      autoComplete="tel"
      value={value}
      onChange={(event) => onChange(formatPhone(event.target.value))}
      className={inputCls}
      placeholder="010-0000-0000"
      {...rest}
    />
  )
}

/**
 * 과목 선택(Y2-4-8) — 어드민이 등록한 과목을 카드형 라디오로 고른다(네이티브 셀렉트 금지).
 * Y3의 과목 관리가 아직 비어 있으면 목록이 없으므로 자유 입력으로 폴백해 접수를 막지 않는다.
 *
 * K3-5: 일반 사용자는 학기를 고르지 않는다. 학기 전환 UI 없이, 어드민이 지정한 현재
 * 학기(defaultSemester)에 해당하는 과목만 카드로 노출한다. 학기 태그가 없는 과목(semester
 * null)만 있는 경우는 필터 없이 전부 노출한다.
 */
export function SubjectField({ subjects, value, onChange, defaultSemester, disabled = false, disabledHint }) {
  const semesters = [
    ...new Set(subjects.filter((s) => s.semester).map((s) => String(s.semester))),
  ].sort()
  // 학기 태그가 붙은 과목이 하나도 없으면 필터 없이 전부 노출(폴백). 있으면 현재 학기로
  // 필터하되, 현재 학기에 과목이 없으면 등록된 첫 학기로 물러난다.
  const semester = semesters.includes(String(defaultSemester))
    ? String(defaultSemester)
    : (semesters[0] ?? '')
  const visible =
    semesters.length === 0
      ? subjects
      : subjects.filter((s) => String(s.semester) === semester)

  const hint = disabled && disabledHint ? disabledHint : '출품작이 제작된 수강 과목을 선택해 주세요'

  if (subjects.length === 0) {
    return (
      <Field label="과목" required hint={disabled && disabledHint ? disabledHint : '출품작이 제작된 수강 과목명'}>
        <input
          type="text"
          required
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
          placeholder="과목명"
        />
      </Field>
    )
  }
  return (
    <Field as="div" label="과목" required hint={hint}>
      {visible.length === 0 ? (
        <p className="text-small-m text-text-meta md:text-small-d">
          등록된 과목이 없습니다
        </p>
      ) : (
        <RadioCards
          name="course"
          value={value}
          onChange={onChange}
          disabled={disabled}
          options={visible.map((s) => ({
            value: s.value,
            label: s.label,
          }))}
        />
      )}
    </Field>
  )
}

/**
 * 원본 파일 업로드 필드 — 과목을 먼저 고르지 않으면 잠긄다. 여러 파일을 차례대로 올릴 수
 * 있고, 올린 파일은 원본 그대로(변환 없이) Google Drive에 저장된다(서버 upload.js
 * context='exhibition-original' 경로). 업로드 진행 중에는 제출 버튼을 잠근다(onUploadingChange).
 */
export function OriginalFilesField({ files, onChange, course, onUploadingChange, disabled = false }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const locked = disabled || !course || !course.trim()

  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file || locked) return
    if (files.length >= MAX_ORIGINAL_FILES) {
      setError(`파일은 최대 ${MAX_ORIGINAL_FILES}개까지 올릴 수 있습니다.`)
      return
    }
    setBusy(true)
    setError(null)
    onUploadingChange?.(true)
    try {
      const res = await api.upload(file, { context: 'exhibition-original', course })
      if (!res?.url) throw new Error('업로드 응답에 url이 없습니다.')
      onChange([...files, { url: res.url, name: res.name || file.name }])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      onUploadingChange?.(false)
    }
  }

  const remove = (idx) => onChange(files.filter((_, i) => i !== idx))

  return (
    <Field
      as="div"
      label="원본 파일"
      required
      hint={
        locked
          ? '먼저 위에서 과목을 선택하면 원본 파일을 올릴 수 있습니다.'
          : '작품 원본을 변환 없이 그대로 보관합니다. 파일을 올린 뒤에는 과목을 바꿀 수 없습니다.'
      }
    >
      {files.length > 0 && (
        <ul className="flex flex-col gap-8">
          {files.map((f, idx) => (
            <li
              key={`${f.url}-${idx}`}
              className="flex min-w-0 items-center justify-between gap-12 rounded-sm border border-border-subtle bg-bg-elev px-12 py-8"
            >
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-8 truncate font-mono text-small-m text-text-sec underline underline-offset-4 hover:text-text-pri"
              >
                <Paperclip size={15} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{f.name || f.url.split('/').pop()}</span>
              </a>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label={`${f.name || '파일'} 제거`}
                  className="inline-flex h-32 w-32 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-meta transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-12">
        <button
          type="button"
          onClick={() => inputRef.current && inputRef.current.click()}
          disabled={locked || busy || files.length >= MAX_ORIGINAL_FILES}
          className="inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border border-border-subtle px-24 text-body-m font-semibold text-text-pri transition duration-fast ease-out hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 md:h-44 md:text-body-d"
        >
          <Upload size={16} aria-hidden="true" />
          {busy ? '업로드 중' : '원본 파일 추가'}
        </button>
        {busy && (
          <span className="font-mono text-caption-m text-text-meta">업로드 중 — 완료된 뒤 제출하세요</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-caption-m text-state-error">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ORIGINAL_FILE_ACCEPT}
        onChange={handleFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </Field>
  )
}

/** 팀원 목록 — {name, studentNo, major} 행 편집. 최소 1행 유지. */
export function MemberRows({ members, onChange }) {
  const setAt = (idx, key) => (event) =>
    onChange(members.map((m, i) => (i === idx ? { ...m, [key]: event.target.value } : m)))
  return (
    <ul className="flex flex-col gap-12">
      {members.map((member, idx) => (
        <li key={idx} className="flex min-w-0 flex-col gap-8 md:flex-row md:items-center">
          <input
            type="text"
            required
            aria-label={`팀원 ${idx + 1} 이름`}
            placeholder="이름"
            value={member.name}
            onChange={setAt(idx, 'name')}
            className={inputCls}
          />
          <input
            type="text"
            required
            aria-label={`팀원 ${idx + 1} 학번`}
            placeholder="학번"
            value={member.studentNo}
            onChange={setAt(idx, 'studentNo')}
            className={inputCls}
          />
          <input
            type="text"
            required
            aria-label={`팀원 ${idx + 1} 전공`}
            placeholder="전공"
            value={member.major}
            onChange={setAt(idx, 'major')}
            className={inputCls}
          />
          {members.length > 1 && (
            <button
              type="button"
              aria-label={`팀원 ${idx + 1} 제거`}
              onClick={() => onChange(members.filter((_, i) => i !== idx))}
              className="flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-subtle p-12 text-text-sec transition-colors duration-fast ease-out hover:border-border-strong hover:text-text-pri"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function scheduleRows(exhibition) {
  return [
    { label: '접수 시작', value: formatKst(exhibition?.submit_open) },
    { label: '접수 마감', value: formatKst(exhibition?.submit_close) },
    { label: '수정 마감', value: formatKst(exhibition?.edit_close) },
  ].filter((row) => row.value)
}

/**
 * Y2-4-7 일정 강조 패널 — 폼·온보딩 최상단에 유리 패널로 크게 둔다.
 * 날짜는 ACCENT.proper(연보라)로 위계를 올린다. 작은 좌측 구석 표기 금지.
 */
export function ScheduleHighlight({ exhibition }) {
  const rows = scheduleRows(exhibition)
  if (!rows.length) return null
  return (
    <GlassCard as="section" className="p-24 md:p-32">
      <h2 className={`${labelCls} mb-16`}>접수 일정</h2>
      <dl className="grid gap-16 sm:grid-cols-3">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex min-w-0 flex-col gap-8">
            <dt className="text-small-m text-text-meta md:text-small-d">{label}</dt>
            <dd
              className={`min-w-0 text-h3-m font-bold leading-snug md:text-h3-d ${ACCENT.proper}`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </GlassCard>
  )
}

/** 접수·수정 일정 표기(컴팩트) — settings/public.exhibition의 KST 일시. */
export function ScheduleList({ exhibition }) {
  const rows = scheduleRows(exhibition)
  if (!rows.length) return null
  return (
    <dl className="flex flex-col gap-8">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex flex-wrap items-baseline gap-12">
          <dt className="text-small-m font-semibold text-text-pri md:text-small-d">
            {label}
          </dt>
          <dd className="font-mono text-small-m text-text-sec md:text-small-d">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
