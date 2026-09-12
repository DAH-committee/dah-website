// /forms/:slug 공개 폼 페이지 (39_FORM_BUILDER P2)
//
// 폼 내용은 전부 DB에 있다. 이 파일은 GET /forms/:slug가 준 fields를 FormRenderer로 그리고
// 제출·수정 요청만 보낸다. 새 폼이 생겨도 이 파일은 고치지 않는다.
//
// 기간 판정의 최종 권한은 서버다. window(can_submit, can_edit)는 서버 시계로 계산돼 오므로
// 그대로 쓴다. 브라우저 시계는 "접수 시작 전"과 "접수 마감" 문구를 고르는 데만 쓴다
// (두 상태 모두 can_submit false라 응답만으로는 구분되지 않는다).
//
// 신원은 로그인한 구글 계정이다(41_AUTH_CONTRACT). 제출·조회·수정 API가 전부 공개 로그인을
// 요구하므로 비로그인 방문자에게는 폼 대신 로그인 게이트를 보여준다. 수정용 비밀번호는 없다.
//
// 수정 진입은 라우트가 아니라 ?mode=edit 쿼리다. 구글 로그인은 전체 페이지 이동이라 컴포넌트
// state가 초기화되는데, 쿼리는 복귀 경로(next)에 그대로 실려 돌아온다.
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import Container from '../../components/layout/Container'
import GlassCard from '../../components/common/GlassCard'
import Button from '../../components/common/Button'
import GoogleLoginButton from '../../components/auth/GoogleLoginButton'
import FormRenderer from '../../components/forms/FormRenderer'
import NotFound from '../NotFound'
import { api, useApi } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { usePublicAuth } from '../../hooks/usePublicAuth'
import {
  AccountBar,
  LoginGate,
  ScheduleHighlight,
  SubmitButton,
} from '../submit/exhibitFormKit'
import { formatKst, submitErrorMessage } from '../submit/exhibitFormShared'

const headingCls = 'text-h2-m font-bold leading-snug text-text-pri md:text-h2-d'
const leadCls = 'text-body-l-m leading-relaxed text-text-sec md:text-body-l-d'
const statusCls = 'text-body-m text-text-meta md:text-body-d'

// 서버 검증 코드({field, error, label}) → 인라인 문구
const FIELD_ERROR = {
  required: '필수 항목입니다',
  phone: '010-0000-0000 형식으로 입력해 주세요',
  email: '이메일 주소 형식으로 입력해 주세요',
  studentid: '학번 8자리 숫자로 입력해 주세요',
  date: '날짜를 선택해 주세요',
  option: '보기 중에서 선택해 주세요',
}

// 서버가 코드 문자열로 주는 거절 사유 → 사용자 문구
const SERVER_ERROR = {
  'submission period closed': '접수 기간이 아닙니다.',
  'edit period closed': '수정 기간이 지났습니다.',
  'response limit reached': '접수 인원이 모두 찼습니다.',
  'not your response': '본인이 제출한 내역만 수정할 수 있습니다.',
  'form not found': '폼을 찾을 수 없습니다.',
}

/** 검증 실패 응답을 FormRenderer errors 맵({ [field.id]: 문구 })으로 바꾼다 */
function toFieldErrors(err) {
  const list = Array.isArray(err?.body?.errors) ? err.body.errors : []
  return Object.fromEntries(
    list.map((item) => [
      item.field,
      item.error === 'maxLength'
        ? `${item.max}자 이내로 입력해 주세요`
        : (FIELD_ERROR[item.error] ?? '입력을 확인해 주세요'),
    ])
  )
}

function errorMessage(err) {
  return SERVER_ERROR[err?.message] ?? submitErrorMessage(err)
}

/** 목록 라벨로 쓸 첫 응답값. 보통 이름 필드가 걸린다 */
function firstValue(fields, data) {
  for (const field of fields) {
    const value = data?.[field.id]
    if (Array.isArray(value)) {
      if (value.length) return value.join(', ')
    } else if (value) {
      return String(value)
    }
  }
  return ''
}

// 제출 버튼의 기본 상태는 필수값 충족 여부로 결정한다. 형식·기간·정원 등 최종 검증은
// 계속 서버가 담당하므로, 여기서는 빈 제출만 선제적으로 막는다.
function hasRequiredValues(fields, value) {
  return fields.filter((field) => field.required).every((field) => {
    const current = value?.[field.id]
    if (Array.isArray(current)) return current.length > 0
    return String(current ?? '').trim().length > 0
  })
}

/**
 * 작성·수정 공용 폼 카드. 클라이언트 검증은 두지 않는다. 검증 권한은 서버 하나이고
 * 400 응답의 errors를 그대로 FormRenderer errors로 되돌려 필드 아래 인라인으로 띄운다.
 * @param {Array} fields    폼 정의
 * @param {Object} initial  초기값 { [field.id]: 값 }
 * @param {Function} onSubmit 값 객체를 받아 API를 호출하는 비동기 함수
 */
function ResponseForm({
  title,
  fields,
  initial,
  submitLabel,
  busyLabel,
  locked = false,
  notice,
  onSubmit,
  uploadContext,
  children,
}) {
  const [value, setValue] = useState(() => initial ?? {})
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const requiredComplete = hasRequiredValues(fields, value)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage(null)
    try {
      await onSubmit(value)
    } catch (err) {
      const fieldErrors = toFieldErrors(err)
      setErrors(fieldErrors)
      setMessage(
        Object.keys(fieldErrors).length
          ? '입력하지 않았거나 형식이 맞지 않은 항목이 있습니다'
          : errorMessage(err)
      )
      setBusy(false)
      return
    }
    setBusy(false)
  }

  return (
    <GlassCard className="p-24 md:p-40">
      <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-32">
        <div className="flex flex-wrap items-baseline justify-between gap-16">
          <h2 className={headingCls}>{title}</h2>
          {children}
        </div>

        {notice}

        <FormRenderer
          fields={fields}
          value={value}
          errors={errors}
          onChange={(id, next) => setValue((prev) => ({ ...prev, [id]: next }))}
          onUploadingChange={setUploading}
          uploadContext={uploadContext}
        />

        {message && (
          <p role="alert" className="text-small-m text-state-error md:text-small-d">
            {message}
          </p>
        )}
        <div>
          <SubmitButton busy={busy || uploading || locked} disabled={!requiredComplete}>
            {busy ? busyLabel : submitLabel}
          </SubmitButton>
        </div>
      </form>
    </GlassCard>
  )
}

/**
 * 제출 내역 확인·수정. 로그인한 계정의 응답만 서버가 돌려주고, 수정 기간과 소유 검증도
 * 서버가 한다. 여기서는 can_edit로 저장 버튼을 잠그기만 한다.
 */
function EditPanel({ slug, fields, canEdit, editEnd, uploadContext }) {
  const { data, loading, error } = useApi(`/forms/${slug}/mine`)
  const [selectedId, setSelectedId] = useState(null)
  const [saved, setSaved] = useState(false)

  const responses = Array.isArray(data?.responses) ? data.responses : []
  // 1건이면 목록 단계를 건너뛴다. 선택은 파생값이라 effect가 필요 없다.
  const selected =
    responses.find((item) => item.id === selectedId) ??
    (responses.length === 1 ? responses[0] : null)

  if (loading) {
    return (
      <p className={statusCls} aria-live="polite">
        제출 내역 불러오는 중
      </p>
    )
  }
  if (error) {
    return (
      <p role="alert" className="text-small-m text-state-error md:text-small-d">
        {errorMessage(error)}
      </p>
    )
  }
  if (saved) {
    return (
      <GlassCard className="flex flex-col items-start gap-24 p-24 md:p-40">
        <h2 className={headingCls}>수정 완료</h2>
        <p className={leadCls}>
          제출 내용이 수정되었습니다.
          {editEnd ? ` 수정은 ${editEnd}까지 가능합니다.` : ''}
        </p>
        <div className="flex flex-wrap gap-12">
          <Button variant="secondary" href={`/forms/${slug}`}>
            폼으로 돌아가기
          </Button>
          <Button variant="secondary" href="/">
            홈으로 이동
          </Button>
        </div>
      </GlassCard>
    )
  }
  if (!responses.length) {
    return (
      <GlassCard className="flex flex-col items-start gap-24 p-24 md:p-40">
        <p className="text-body-m leading-relaxed text-text-sec md:text-body-d">
          이 계정으로 제출한 내역이 없습니다.
        </p>
        <Button variant="secondary" href={`/forms/${slug}`}>
          폼 작성하기
        </Button>
      </GlassCard>
    )
  }
  if (!selected) {
    return (
      <div className="flex min-w-0 flex-col gap-24">
        <h2 className={headingCls}>제출 목록</h2>
        <ul className="flex flex-col gap-16">
          {responses.map((item) => (
            <li key={item.id} className="min-w-0">
              <GlassCard hover as="div" className="min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-16 p-24 text-left"
                >
                  <span className="flex min-w-0 flex-col gap-8">
                    <span className="truncate text-body-l-m font-semibold text-text-pri md:text-body-l-d">
                      {firstValue(fields, item.data) || '제출 내역'}
                    </span>
                    <span className="font-mono text-caption-m text-text-meta">
                      {formatKst(item.submitted_at) ?? ''}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-text-meta"
                  />
                </button>
              </GlassCard>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <ResponseForm
      key={selected.id}
      title="제출 내용 수정"
      fields={fields}
      initial={selected.data}
      submitLabel="수정 저장"
      busyLabel="저장 중"
      locked={!canEdit}
      notice={
        !canEdit && (
          <p
            role="alert"
            className="text-small-m leading-relaxed text-state-error md:text-small-d"
          >
            수정 기간이 지나 저장할 수 없습니다. 내용 확인만 가능합니다
            {editEnd ? ` (수정 마감: ${editEnd})` : ''}.
          </p>
        )
      }
      onSubmit={async (value) => {
        await api.put(`/forms/${slug}/responses/${selected.id}`, { data: value })
        setSaved(true)
      }}
      uploadContext={uploadContext}
    >
      {responses.length > 1 && (
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="cursor-pointer text-small-m text-text-meta transition-colors duration-fast ease-out hover:text-text-pri md:text-small-d"
        >
          목록으로
        </button>
      )}
    </ResponseForm>
  )
}

function FormPage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const { data, loading } = useApi(`/forms/${slug}`)
  // 공개 제출자 신원. 스태프 로그인(useAuth)과 다른 신원 클래스다(41_AUTH_CONTRACT)
  const { user, loading: authLoading, logout } = usePublicAuth()
  const [done, setDone] = useState(false)

  const form = data?.form ?? null
  const win = data?.window ?? null
  useTitle(form?.title_ko)

  if (loading) {
    return (
      <Container as="section" className="py-section-m lg:py-section-d">
        <p className={statusCls} aria-live="polite">
          폼 불러오는 중
        </p>
      </Container>
    )
  }
  // 비공개·없는 slug는 서버가 404를 준다(P7 에러 상태 재사용)
  if (!form || !win) return <NotFound />

  const editMode = searchParams.get('mode') === 'edit'
  const editEnd = formatKst(win.edit_end)
  const startAt = formatKst(win.accept_start)
  // 접수 전과 접수 후 둘 다 can_submit false다. 어느 쪽인지는 문구 선택에만 쓴다.
  const beforeStart =
    !win.can_submit && win.accept_start && Date.now() < new Date(win.accept_start).getTime()
  // ScheduleHighlight는 전시회 접수와 같은 일정 패널이다(유리 패널 + 연보라 날짜)
  const schedule = {
    submit_open: win.accept_start,
    submit_close: win.accept_end,
    edit_close: win.edit_end,
  }

  return (
    <Container as="section" className="py-section-m lg:py-section-d">
      <div className="flex min-w-0 flex-col gap-24">
        <header className="flex min-w-0 flex-col gap-8">
          <p className="font-mono text-caption-m uppercase tracking-label text-text-meta md:text-caption-d">
            접수 안내
          </p>
          <h1 className="min-w-0 text-h1-m font-bold leading-tight tracking-display text-text-pri md:text-h1-d">
            {form.title_ko}
          </h1>
        </header>

        <ScheduleHighlight exhibition={schedule} />

        {/* 안내문은 저장된 줄바꿈을 그대로 살린다. 마크다운 변환 금지 */}
        {form.description_ko && (
          <section className="min-w-0 rounded-md border border-border-subtle bg-bg-elev p-24 md:p-32">
            <p className="whitespace-pre-line break-keep text-body-m leading-relaxed text-text-sec md:text-body-d">
              {form.description_ko}
            </p>
          </section>
        )}

        {editMode ? (
          authLoading ? (
            <p className={statusCls} aria-live="polite">
              로그인 상태 확인 중
            </p>
          ) : user ? (
            <div key="account" className="page-fade flex min-w-0 flex-col gap-24">
              <AccountBar user={user} onLogout={logout} />
              <EditPanel
                slug={slug}
                fields={form.fields ?? []}
                canEdit={win.can_edit}
                editEnd={editEnd}
                uploadContext={{ formSlug: slug, driveEnabled: Boolean(form.settings?.drive_enabled) }}
              />
            </div>
          ) : (
            <div key="guest" className="page-fade min-w-0">
              <LoginGate
                title="구글 로그인 후 확인"
                description="제출에 사용한 구글 계정으로 로그인하면 제출 내역을 불러와 수정 마감 전까지 고칠 수 있습니다."
              >
                <Button variant="ghost" href={`/forms/${slug}`}>
                  폼으로 돌아가기
                </Button>
              </LoginGate>
            </div>
          )
        ) : done ? (
          <GlassCard className="flex flex-col items-start gap-24 p-24 md:p-40">
            <h2 className={headingCls}>제출 완료</h2>
            <p className={leadCls}>
              제출이 접수되었습니다. 내용 수정은 제출에 사용한 구글 계정으로 로그인해
              가능합니다
              {editEnd ? ` (수정 마감: ${editEnd})` : ''}.
            </p>
            <div className="flex flex-wrap gap-12">
              {win.can_edit && (
                <Button variant="secondary" href={`/forms/${slug}?mode=edit`}>
                  제출 내역 확인·수정
                </Button>
              )}
              <Button variant="secondary" href="/">
                홈으로 이동
              </Button>
            </div>
          </GlassCard>
        ) : !win.can_submit ? (
          <GlassCard className="flex flex-col items-start gap-24 p-24 md:p-40">
            <h2 className={headingCls}>{beforeStart ? '접수 시작 전' : '접수 마감'}</h2>
            <p className={leadCls}>
              {beforeStart
                ? startAt
                  ? `접수는 ${startAt}에 시작합니다.`
                  : '접수 시작 일정이 아직 공지되지 않았습니다.'
                : '접수가 마감되어 새로 제출할 수 없습니다.'}
              {!beforeStart && win.can_edit && editEnd
                ? ` 제출한 내용 수정은 ${editEnd}까지 가능합니다.`
                : ''}
            </p>
            {win.can_edit &&
              !authLoading &&
              (user ? (
                <Button variant="secondary" href={`/forms/${slug}?mode=edit`}>
                  제출 내역 확인·수정
                </Button>
              ) : (
                <GoogleLoginButton
                  variant="secondary"
                  next={`/forms/${slug}?mode=edit`}
                  label="구글 로그인 후 제출 내역 확인"
                />
              ))}
          </GlassCard>
        ) : authLoading ? (
          <p className={statusCls} aria-live="polite">
            로그인 상태 확인 중
          </p>
        ) : user ? (
          <div key="account" className="page-fade flex min-w-0 flex-col gap-24">
            <AccountBar user={user} onLogout={logout} />
            <ResponseForm
              title="제출 폼"
              fields={form.fields ?? []}
              submitLabel="제출"
              busyLabel="제출 중"
              uploadContext={{ formSlug: slug, driveEnabled: Boolean(form.settings?.drive_enabled) }}
              onSubmit={async (value) => {
                await api.post(`/forms/${slug}/submit`, { data: value })
                setDone(true)
              }}
            />
            {win.can_edit && (
              <div>
                <Button variant="secondary" href={`/forms/${slug}?mode=edit`}>
                  제출 내역 확인·수정
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div key="guest" className="page-fade min-w-0">
            <LoginGate
              title="구글 로그인 후 제출"
              description="제출은 구글 계정으로 로그인한 뒤 진행합니다. 로그인한 계정이 제출자 신원으로 기록되고, 제출 후 수정도 같은 계정으로 합니다."
            />
          </div>
        )}
      </div>
    </Container>
  )
}

export default FormPage
