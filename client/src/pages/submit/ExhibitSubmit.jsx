// /submit — 전시회 접수 (12_BACKEND 5절, 구글 폼 대체)
// 기간 판정 최종 권한은 서버(403) — settings/public.exhibition.is_submit_period는 UX 안내용.
// 33_PHASE18 Y2-3/Y2-4: 같은 라우트 안에서 온보딩(intro) → 폼(form) → 완료(done) 단계로 진행한다.
//   (App.jsx 라우트를 건드리지 않기 위해 단계는 컴포넌트 state로만 관리)
// 개인/팀 분기 폼: 인적사항·과목·연락처·작품명·작품 설명(100자).
// 41_AUTH_CONTRACT: 제출자 신원은 로그인한 구글 계정이다. 비로그인 상태에서는 폼 대신
//   로그인 게이트를 보여주고, 접수 이메일은 서버가 계정에서 채운다(폼에서 입력받지 않는다).
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import Container from '../../components/layout/Container'
import GlassCard from '../../components/common/GlassCard'
import Button from '../../components/common/Button'
import RadioCards from '../../components/common/RadioCards'
import { ACCENT } from '../../styles/accents'
import { api, useApi } from '../../hooks/useApi'
import { exhibitionCopy } from '../../data/exhibitionCopy'
import { useTitle } from '../../hooks/useTitle'
import { useAuth } from '../../context/AuthContext'
import { usePublicAuth } from '../../hooks/usePublicAuth'
import { EXHIBITION_SUFFIX, exhibitionFullTitle } from '../../data/exhibitionTitle'
import { isValidPhone } from '../../utils/format'
import {
  AccountBar,
  Field,
  LockedField,
  LoginGate,
  MemberRows,
  OriginalFilesField,
  PhoneInput,
  ScheduleHighlight,
  ScheduleList,
  SubjectField,
  SubmitButton,
} from './exhibitFormKit'
import {
  DESC_MAX,
  ENTRY_TYPE_LABEL,
  inputCls,
  formatKst,
  resolveCurrentSemester,
  resolveOrdinal,
  resolveSubjects,
  submitErrorMessage,
} from './exhibitFormShared'

const EMPTY_MEMBER = { name: '', studentNo: '', major: '' }

const INITIAL_FORM = {
  entryType: 'solo',
  name: '',
  studentNo: '',
  major: '',
  teamName: '',
  phone: '',
  course: '',
  workTitle: '',
  workDesc: '',
}

const ENTRY_TYPE_OPTIONS = [
  { value: 'solo', label: ENTRY_TYPE_LABEL.solo, desc: '혼자 출품합니다' },
  { value: 'team', label: ENTRY_TYPE_LABEL.team, desc: '둘 이상이 함께 출품합니다' },
]

// 53: 온보딩·폼 문구는 site_settings.exhibitionCopy가 원본이고, 비어 있으면
// data/exhibitionCopy.js의 기본값(분리 이전 코드 원문)으로 떨어진다.

// P3 카드(bg.elev + hairline) — 글래스 중첩·blur 예산(동시 3개)을 피하려고 온보딩 본문은 비유리 패널
function Panel({ title, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-16 rounded-md border border-border-subtle bg-bg-elev p-24 md:p-32">
      <h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{title}</h3>
      {children}
    </section>
  )
}

function ExhibitSubmit() {
  useTitle('전시회 접수')
  const { data: settingsRes, loading: settingsLoading } = useApi('/settings/public')
  const { data: exhibitionsRes } = useApi('/content/exhibitions', {
    params: { pageSize: 20 },
  })
  const { hasRole } = useAuth()
  // 공개 제출자 신원 — 스태프 로그인(useAuth)과 다른 신원 클래스다(41_AUTH_CONTRACT)
  const { user, loading: authLoading, logout } = usePublicAuth()
  const [searchParams] = useSearchParams()
  const exhibition = settingsRes?.exhibition ?? null
  // 53: 안내 문구는 DB 값 우선, 없으면 기본값 폴백
  const copy = exhibitionCopy(settingsRes?.settings?.exhibitionCopy, 'ko')
  // Y2-4-8: 과목 목록은 어드민(Y3-1)이 등록한 값 — 아직 없으면 빈 배열 → 자유 입력 폴백
  const subjects = resolveSubjects(settingsRes)
  // H2-4: 과목 목록의 기본 학기 — 어드민이 전시회 설정에서 지정한 현재 접수 대상 학기
  const currentSemester = resolveCurrentSemester(settingsRes)
  // H2-2: 회차는 어드민 전시회 설정(settings)이 1순위. 지정 전에는 상단 고정(피처드) 전시의
  //   회차로 폴백하고, 그것도 없으면 회차 없는 고정 문구를 쓴다(하드코딩 금지).
  const exhibitionItems = exhibitionsRes?.items ?? []
  const currentExhibition =
    exhibitionItems.find((it) => it?.is_featured) ?? exhibitionItems[0] ?? null
  const exhibitionName =
    exhibitionFullTitle(resolveOrdinal(settingsRes)) ||
    (currentExhibition
      ? exhibitionFullTitle(currentExhibition.ordinal) || currentExhibition.title
      : EXHIBITION_SUFFIX)

  // H10.3: 어드민 전용 미리보기 — manager+ 로그인 상태에서 /submit?preview=1 이면 기간 검증 우회
  //   (실제 제출은 서버가 기간 밖 403으로 차단 — 화면 테스트 용도)
  const previewBypass = searchParams.get('preview') === '1' && hasRole('manager')
  // 설정 조회 실패 시에도 폼은 노출 — 기간 밖 제출은 서버가 403으로 차단한다
  const submitOpenNow =
    previewBypass || (exhibition ? exhibition.is_submit_period === true : true)

  // 구글 로그인은 전체 페이지 이동이라 복귀 시 컴포넌트 state가 초기화된다.
  // 게이트가 next=/submit?step=form으로 돌려보내므로 폼 단계에서 이어서 진행된다.
  const [step, setStep] = useState(
    searchParams.get('step') === 'form' ? 'form' : 'intro'
  ) // intro | form | done
  const [form, setForm] = useState(INITIAL_FORM)
  const [members, setMembers] = useState([{ ...EMPTY_MEMBER }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  // 53_DRIVE_STORAGE(전시회 확장): 원본 파일은 과목을 고른 다월에 Google Drive로 올리다.
  // 파일을 하나니란 올리게 되자마자 과목 선택을 잠금 밖에(거론 폴더 보존).
  const [originalFiles, setOriginalFiles] = useState([])
  const [filesUploading, setFilesUploading] = useState(false)

  const set = (key) => (event) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const setValue = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }))
  const isTeam = form.entryType === 'team'
  const identityComplete = isTeam
    ? Boolean(form.teamName.trim()) && members.every((m) => m.name.trim() && m.studentNo.trim() && m.major.trim())
    : Boolean(form.name.trim() && form.studentNo.trim() && form.major.trim())
  const canSubmit =
    identityComplete &&
    isValidPhone(form.phone) &&
    Boolean(form.course.trim() && form.workTitle.trim() && form.workDesc.trim()) &&
    originalFiles.length > 0 &&
    !filesUploading

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit || submitting) return
    if (!isValidPhone(form.phone)) {
      setError('연락처를 010-0000-0000 형식으로 모두 입력해 주세요')
      return
    }
    if (!form.course.trim()) {
      setError('과목을 선택해 주세요')
      return
    }
    if (originalFiles.length === 0) {
      setError('작품 원본 파일을 하나 이상 올려 주세요')
      return
    }
    if (
      isTeam &&
      !members.every((m) => m.name.trim() && m.studentNo.trim() && m.major.trim())
    ) {
      setError('팀원 이름·학번·전공을 모두 입력해 주세요')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const common = {
        phone: form.phone.trim(),
        course: form.course.trim(),
        work_title: form.workTitle.trim(),
        work_desc: form.workDesc.trim(),
        original_files: originalFiles,
      }
      const fields = isTeam
        ? {
            team_name: form.teamName.trim(),
            members: members.map((m) => ({
              name: m.name.trim(),
              student_no: m.studentNo.trim(),
              major: m.major.trim(),
            })),
            ...common,
          }
        : {
            name: form.name.trim(),
            student_no: form.studentNo.trim(),
            major: form.major.trim(),
            ...common,
          }
      // 이메일은 서버가 로그인 계정에서 채운다(41_AUTH_CONTRACT) — 본문에 싣지 않는다
      await api.post('/submit/exhibition', {
        entry_type: form.entryType,
        fields,
      })
      setStep('done')
    } catch (err) {
      setError(submitErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (settingsLoading) {
    return (
      <Container as="section" className="py-section-m lg:py-section-d">
        <p className="text-body-m text-text-meta md:text-body-d" aria-live="polite">
          접수 일정 확인 중
        </p>
      </Container>
    )
  }

  if (!submitOpenNow) {
    return (
      <Container as="section" className="py-section-m lg:py-section-d">
        <GlassCard className="flex flex-col items-start gap-24 p-24 md:p-40">
            <h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">
              접수 기간 아님
            </h2>
            <p className="text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">
              지금은 전시회 접수 기간이 아닙니다. 아래 일정을 확인해 주세요.
            </p>
            <ScheduleList exhibition={exhibition} />
            <Button variant="secondary" href="/submit/edit">
              접수 내역 확인·수정
            </Button>
        </GlassCard>
      </Container>
    )
  }

  return (
    <>
      {/* H2-1: 온보딩은 상단 여백을 줄여 첫 화면에 핵심 안내가 바로 들어오게 한다
          (38_UI_FIX_BATCH 이후 시작 버튼은 섹션 최하단에 있다) */}
      <Container
        as="section"
        className={
          step === 'intro'
            ? 'pb-section-m pt-32 lg:pb-section-d lg:pt-48'
            : 'py-section-m lg:py-section-d'
        }
      >
        {step === 'intro' && (
          <div className="flex min-w-0 flex-col gap-24">
            <header className="flex min-w-0 flex-col gap-8">
              <p className="font-mono text-caption-m uppercase tracking-label text-text-meta md:text-caption-d">
                {copy.onboardingEyebrow}
              </p>
              {/* H2-1: 스케일 한 단계 하향(displayL → h1) */}
              <h2 className="min-w-0 text-h1-m font-bold leading-tight tracking-display text-text-pri md:text-h1-d">
                {exhibitionName}
              </h2>
              {copy.onboardingLead && (
                <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec md:text-body-d">
                  {copy.onboardingLead}
                </p>
              )}
            </header>

            <ScheduleHighlight exhibition={exhibition} />

            <div className="grid min-w-0 gap-24 lg:grid-cols-2">
              <Panel title={copy.stepsTitle}>
                <ol className="flex flex-col gap-16">
                  {copy.steps.map((s, i) => (
                    <li key={s.title} className="flex min-w-0 gap-16">
                      {/* 번호는 순서에서 파생한다 — 담당자가 단계를 늘려도 번호가 어긋나지 않는다 */}
                      <span
                        className={`shrink-0 font-mono text-caption-m font-bold md:text-caption-d ${ACCENT.index}`}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="flex min-w-0 flex-col gap-4">
                        <span className="text-body-m font-semibold text-text-pri md:text-body-d">
                          {s.title}
                        </span>
                        <span className="text-small-m leading-relaxed text-text-sec md:text-small-d">
                          {s.desc}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
              <Panel title={copy.notesTitle}>
                <ul className="flex flex-col gap-12">
                  {copy.notes.map((note) => (
                    <li
                      key={note}
                      className="flex min-w-0 gap-12 text-small-m leading-relaxed text-text-sec md:text-small-d"
                    >
                      <span aria-hidden="true" className={ACCENT.index}>
                        ·
                      </span>
                      <span className="min-w-0">{note}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            {/* 38_UI_FIX_BATCH: 시작 버튼을 섹션 최하단으로 이동 — 절차·유의사항을 다 읽고
                누르게 한다. Wayfinding: 안내가 길어도 발견되도록 상단 헤어라인으로 구간을
                끊고 여백을 키운다(새 구분선 컴포넌트 없이 border-t 하나로). */}
            <div className="flex flex-wrap items-center gap-16 border-t border-border-subtle pt-24 md:pt-32">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="inline-flex h-11 cursor-pointer items-center justify-center rounded-sm bg-button-primary px-24 text-body-m font-semibold text-button-primaryText shadow-btn transition duration-fast ease-out hover:bg-button-primaryHover hover:shadow-btn-hover active:bg-button-primaryPressed md:h-48 md:text-body-d"
              >
                {copy.startLabel}
              </button>
              <Button variant="secondary" href="/submit/edit">
                접수 내역 확인·수정
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <GlassCard className="flex flex-col items-start gap-24 p-24 md:p-40">
            <h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">
              접수 완료
            </h2>
            <p className="text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">
              전시회 출품이 접수되었습니다. 내용 수정은 접수에 사용한 구글 계정으로
              로그인해 가능합니다
              {formatKst(exhibition?.edit_close)
                ? ` (수정 마감: ${formatKst(exhibition?.edit_close)})`
                : ''}
              .
            </p>
            <div className="flex flex-wrap gap-12">
              <Button variant="secondary" href="/submit/edit">
                접수 내역 확인·수정
              </Button>
              <Button variant="secondary" href="/">
                홈으로 이동
              </Button>
            </div>
          </GlassCard>
        )}

        {step === 'form' && authLoading && (
          <p className="text-body-m text-text-meta md:text-body-d" aria-live="polite">
            로그인 상태 확인 중
          </p>
        )}

        {/* 41: 비로그인 상태에서는 폼 대신 로그인 게이트. 로그인 전환은 배너와 컨테이너를
            그대로 둔 채 이 블록만 교체되며 .page-fade(opacity 0→1)로 이어진다 */}
        {step === 'form' && !authLoading && !user && (
          <div key="guest" className="page-fade flex min-w-0 flex-col gap-24">
            <ScheduleHighlight exhibition={exhibition} />
            <LoginGate
              title="구글 로그인 후 접수"
              description="전시회 접수는 구글 계정으로 로그인한 뒤 진행합니다. 로그인한 계정의 이메일이 접수 이메일로 기록되고, 접수 후 수정도 같은 계정으로 합니다."
              next="/submit?step=form"
            >
              <button
                type="button"
                onClick={() => setStep('intro')}
                className="cursor-pointer text-small-m text-text-meta transition-colors duration-fast ease-out hover:text-text-pri md:text-small-d"
              >
                안내로 돌아가기
              </button>
            </LoginGate>
          </div>
        )}

        {step === 'form' && !authLoading && user && (
          <div key="account" className="page-fade flex min-w-0 flex-col gap-24">
            <ScheduleHighlight exhibition={exhibition} />
            <GlassCard className="p-24 md:p-40">
              <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-32">
                <div className="flex flex-wrap items-baseline justify-between gap-16">
                  <div className="flex min-w-0 flex-col gap-4">
                    <h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">
                      접수 폼
                    </h2>
                    {/* H2-2: 회차는 어드민 설정값 — 화면 하드코딩 금지 */}
                    <p className="min-w-0 text-small-m text-text-meta md:text-small-d">
                      {exhibitionName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep('intro')}
                    className="cursor-pointer text-small-m text-text-meta transition-colors duration-fast ease-out hover:text-text-pri md:text-small-d"
                  >
                    안내로 돌아가기
                  </button>
                </div>

                <AccountBar user={user} onLogout={logout} />

                <Field as="div" label="참가 유형" required>
                  <RadioCards
                    name="entry_type"
                    options={ENTRY_TYPE_OPTIONS}
                    value={form.entryType}
                    onChange={setValue('entryType')}
                  />
                </Field>

                {isTeam ? (
                  <>
                    <Field label="팀명" required>
                      <input
                        type="text"
                        required
                        value={form.teamName}
                        onChange={set('teamName')}
                        className={inputCls}
                        placeholder="팀 이름"
                      />
                    </Field>
                    <Field
                      as="div"
                      label="팀원"
                      required
                      hint="대표자를 포함한 전체 팀원의 이름·학번·전공을 입력합니다"
                    >
                      <MemberRows members={members} onChange={setMembers} />
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setMembers((prev) => [...prev, { ...EMPTY_MEMBER }])
                          }
                          className="inline-flex cursor-pointer items-center gap-8 rounded-sm border border-border-subtle px-16 py-8 text-small-m font-semibold text-text-pri transition-colors duration-fast ease-out hover:border-border-strong md:text-small-d"
                        >
                          <Plus size={16} aria-hidden="true" />
                          팀원 추가
                        </button>
                      </div>
                    </Field>
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-24 md:grid-cols-3">
                    <Field label="이름" required>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={set('name')}
                        className={inputCls}
                        placeholder="이름"
                      />
                    </Field>
                    <Field label="학번" required>
                      <input
                        type="text"
                        required
                        value={form.studentNo}
                        onChange={set('studentNo')}
                        className={inputCls}
                        placeholder="학번"
                      />
                    </Field>
                    <Field label="전공" required>
                      <input
                        type="text"
                        required
                        value={form.major}
                        onChange={set('major')}
                        className={inputCls}
                        placeholder="전공"
                      />
                    </Field>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-24 md:grid-cols-2">
                  {/* 접수 이메일은 로그인 계정 고정 — 서버도 본문 email을 무시한다 */}
                  <LockedField label="접수 이메일" value={user.email} />
                  <Field label="연락처" required hint="010-0000-0000">
                    <PhoneInput value={form.phone} onChange={setValue('phone')} />
                  </Field>
                </div>

                <SubjectField
                  subjects={subjects}
                  value={form.course}
                  onChange={setValue('course')}
                  defaultSemester={currentSemester}
                  disabled={originalFiles.length > 0}
                  disabledHint="원본 파일을 올린 뒤에는 과목을 바꿀 수 없습니다. 바꾸려면 올린 파일을 먼저 제거하세요."
                />

                <OriginalFilesField
                  files={originalFiles}
                  onChange={setOriginalFiles}
                  course={form.course}
                  onUploadingChange={setFilesUploading}
                />

                <Field label="작품명" required hint={copy.workTitleHint}>
                  <input
                    type="text"
                    required
                    value={form.workTitle}
                    onChange={set('workTitle')}
                    className={inputCls}
                    placeholder="작품 제목"
                  />
                </Field>

                <Field label="작품 설명" required hint={`최대 ${DESC_MAX}자`}>
                  <textarea
                    required
                    rows={4}
                    maxLength={DESC_MAX}
                    value={form.workDesc}
                    onChange={set('workDesc')}
                    className={inputCls}
                    placeholder={copy.workDescPlaceholder}
                  />
                  <span
                    aria-live="polite"
                    className="text-right font-mono text-caption-m text-text-meta"
                  >
                    {form.workDesc.length}/{DESC_MAX}
                  </span>
                </Field>

                {error && (
                  <p role="alert" className="text-small-m text-state-error md:text-small-d">
                    {error}
                  </p>
                )}
                <div>
                  <SubmitButton busy={submitting} disabled={!canSubmit}>
                    {submitting ? '접수 중' : '접수'}
                  </SubmitButton>
                </div>
              </form>
            </GlassCard>
          </div>
        )}
      </Container>
    </>
  )
}

export default ExhibitSubmit
