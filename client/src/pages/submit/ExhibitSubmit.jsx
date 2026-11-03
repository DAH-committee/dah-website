// /submit/new — 전시회 접수 폼 (12_BACKEND 5절, 구글 폼 대체). 처음 화면은 /submit(ExhibitHub)
// 기간 판정 최종 권한은 서버(403) — settings/public.exhibition.is_submit_period는 UX 안내용.
// 33_PHASE18 Y2-3/Y2-4: 같은 라우트 안에서 온보딩(intro) → 폼(form) → 완료(done) 단계로 진행한다.
//   (App.jsx 라우트를 건드리지 않기 위해 단계는 컴포넌트 state로만 관리)
// 개인/팀 분기 폼: 인적사항·과목·연락처·작품명·작품 설명(100자).
// 41_AUTH_CONTRACT: 제출자 신원은 로그인한 구글 계정이다. 비로그인 상태에서는 폼 대신
//   로그인 게이트를 보여주고, 접수 이메일은 서버가 계정에서 채운다(폼에서 입력받지 않는다).
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import Button from '../../components/common/Button'
import {
  AccountStrip,
  HeaderCard,
  LoginCard,
  LongInput,
  MiniField,
  NoticeCard,
  PrimarySubmit,
  QuestionCard,
  RadioList,
  RespondentPage,
  ScheduleInline,
  ShortInput,
  SubmitRow,
  TextButton,
} from '../../components/forms/respondent'
import { api, useApi } from '../../hooks/useApi'
import { exhibitionCopy } from '../../data/exhibitionCopy'
import { useTitle } from '../../hooks/useTitle'
import { useAuth } from '../../context/AuthContext'
import { usePublicAuth } from '../../hooks/usePublicAuth'
import { EXHIBITION_SUFFIX, exhibitionFullTitle } from '../../data/exhibitionTitle'
import { MemberRows, PhoneInput, SubjectField } from './exhibitFormKit'
import {
  DESC_MAX,
  ENTRY_TYPE_LABEL,
  formatKst,
  resolveCurrentSemester,
  resolveOrdinal,
  resolveSubjects,
  submitErrorMessage,
  FIELD_IDS,
  collectFormErrors,
  scrollToFirstError,
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

  // 접수 안내(예전 첫 단계)는 제목 카드 안에 접어 두었다. 화면이 한 장이라 사용자가 중간에 나가지 않는다.
  const [step, setStep] = useState('form') // form | done
  const [form, setForm] = useState(INITIAL_FORM)
  const [members, setMembers] = useState([{ ...EMPTY_MEMBER }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // 이미 접수한 적이 있으면 가장 최근 접수의 신청자 정보(참가 유형, 이름, 학번, 전공, 팀명, 팀원, 연락처)를 채워 둔다.
  // 과목과 작품 정보는 작품마다 다르므로 비워 둔다. 값은 한 번만 채우고 이후 입력은 건드리지 않는다.
  const { data: mineRes } = useApi(user ? '/submit/exhibition/mine' : null)
  const [prefilled, setPrefilled] = useState(false)
  const [hasPrefill, setHasPrefill] = useState(false)
  if (!prefilled && mineRes) {
    setPrefilled(true)
    const last = Array.isArray(mineRes.entries) ? mineRes.entries[0] : null
    if (last) {
      const f = last.fields ?? {}
      setForm((prev) => ({
        ...prev,
        entryType: last.entry_type === 'team' ? 'team' : 'solo',
        name: f.name ?? '',
        studentNo: f.student_no ?? '',
        major: f.major ?? '',
        teamName: f.team_name ?? '',
        phone: f.phone ?? '',
      }))
      if (Array.isArray(f.members) && f.members.length) {
        setMembers(f.members.map((m) => ({ name: m?.name ?? '', studentNo: m?.student_no ?? '', major: m?.major ?? '' })))
      }
      setHasPrefill(true)
    }
  }

  const set = (key) => (event) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const setValue = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }))
  const isTeam = form.entryType === 'team'
  // 접수 버튼은 항상 눌린다. 누르면 빠진 칸을 표시하고 가장 위 칸으로 올라간다(구글 폼 방식).
  const [attempted, setAttempted] = useState(false)
  const allErrors = collectFormErrors({
    isTeam,
    form,
    members,
    courseRequired: true,
    checkFiles: false, // 접수에서는 파일을 받지 않는다. 작품 파일은 작품 제출 기간에 따로 올린다
  })
  const fieldErrors = attempted ? allErrors : {}

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    if (Object.keys(allErrors).length > 0) {
      setAttempted(true)
      setError(null)
      scrollToFirstError(allErrors)
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

  const schedule = [
    { label: '접수 시작', value: formatKst(exhibition?.submit_open) },
    { label: '접수 마감', value: formatKst(exhibition?.submit_close) },
    { label: '작품 제출 시작', value: formatKst(exhibition?.files_open) },
    { label: '수정과 작품 제출 마감', value: formatKst(exhibition?.edit_close) },
  ]

  // 맨 위 제목 카드: 전시회 이름, 안내 한 문단, 일정, 접어 둔 접수 안내
  const header = (
    <HeaderCard title={exhibitionName}>
      {copy.onboardingLead && (
        <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec">{copy.onboardingLead}</p>
      )}
      <ScheduleInline rows={schedule} />
      {step === 'form' && (
        <div>
          <Button variant="ghost" href="/submit">
            내 접수 목록
          </Button>
        </div>
      )}
    </HeaderCard>
  )

  if (settingsLoading) {
    return (
      <RespondentPage>
        <p className="px-4 text-small-m text-text-meta" aria-live="polite">
          접수 일정 확인 중
        </p>
      </RespondentPage>
    )
  }

  if (!submitOpenNow) {
    return (
      <RespondentPage>
        {header}
        <NoticeCard
          title="접수 기간이 아닙니다"
          actions={
            <Button variant="secondary" href="/submit">
              내 접수 목록
            </Button>
          }
        >
          지금은 전시회 접수 기간이 아닙니다. 위 일정을 확인해 주세요.
        </NoticeCard>
      </RespondentPage>
    )
  }

  return (
    <RespondentPage>
      {header}

      {step === 'done' && (
        <NoticeCard
          title="접수 완료"
          actions={
            <Button variant="primary" href="/submit">
              내 접수 목록으로
            </Button>
          }
        >
          <span className="block whitespace-pre-line break-keep [text-wrap:balance]">
            {`작품이 접수되었습니다.\n작품명과 설명은 ${formatKst(exhibition?.edit_close) ? `${formatKst(exhibition?.edit_close)}까지` : '수정 마감까지'} 접수 목록에서 고칠 수 있습니다.\n작품 파일은 ${formatKst(exhibition?.files_open) ? `${formatKst(exhibition?.files_open)}부터` : '작품 제출 기간에'} 같은 목록에서 올려 주세요.`}
          </span>
        </NoticeCard>
      )}

      {step === 'form' && authLoading && (
        <p className="px-4 text-small-m text-text-meta" aria-live="polite">
          로그인 상태 확인 중
        </p>
      )}

      {/* 41: 비로그인 상태에서는 폼 대신 로그인 카드. 이 블록만 교체되며 .page-fade로 이어진다 */}
      {step === 'form' && !authLoading && !user && (
        <div key="guest" className="page-fade min-w-0">
          <LoginCard
            title="구글 로그인 후 접수"
            description={'접수는 구글 계정으로 로그인한 뒤 시작합니다.\n로그인한 계정의 이메일이 접수 이메일로 기록되고,\n수정과 작품 제출도 같은 계정으로 합니다.'}
            next="/submit/new"
          />
        </div>
      )}

      {step === 'form' && !authLoading && user && (
        <form key="account" noValidate onSubmit={handleSubmit} className="page-fade flex min-w-0 flex-col gap-12">
          <AccountStrip user={user} onLogout={logout} />

          <QuestionCard label="참가 유형" required>
            <RadioList name="entry_type" options={ENTRY_TYPE_OPTIONS} value={form.entryType} onChange={setValue('entryType')} />
          </QuestionCard>

          <QuestionCard
            id={FIELD_IDS.applicant}
            label="신청자"
            required
            hint={hasPrefill ? '이전 접수의 신청자 정보를 불러왔습니다. 달라진 부분이 있으면 고쳐 주세요.' : undefined}
            error={fieldErrors.applicant}
          >
            {isTeam ? (
              <>
                <MiniField label="팀명" required>
                  <ShortInput required value={form.teamName} onChange={set('teamName')} placeholder="팀 이름" />
                </MiniField>
                <div className="flex flex-col gap-8">
                  <span className="text-small-m text-text-meta">
                    팀원 (대표자 포함) <span className="text-state-error">*</span>
                  </span>
                  <MemberRows members={members} onChange={setMembers} />
                  <div>
                    <TextButton onClick={() => setMembers((prev) => [...prev, { ...EMPTY_MEMBER }])}>
                      <span className="inline-flex items-center gap-8 text-purple-primary">
                        <Plus size={16} aria-hidden="true" />
                        팀원 추가
                      </span>
                    </TextButton>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-16 sm:grid-cols-3">
                <MiniField label="이름" required>
                  <ShortInput required value={form.name} onChange={set('name')} placeholder="이름" />
                </MiniField>
                <MiniField label="학번" required>
                  <ShortInput required value={form.studentNo} onChange={set('studentNo')} placeholder="학번" />
                </MiniField>
                <MiniField label="전공" required>
                  <ShortInput required value={form.major} onChange={set('major')} placeholder="전공" />
                </MiniField>
              </div>
            )}
            <MiniField label="연락처" required>
              <PhoneInput value={form.phone} onChange={setValue('phone')} className="max-w-[240px]" />
            </MiniField>
          </QuestionCard>

          <SubjectField
            subjects={subjects}
            value={form.course}
            onChange={setValue('course')}
            defaultSemester={currentSemester}
            id={FIELD_IDS.course}
            error={fieldErrors.course}
          />

          <QuestionCard id={FIELD_IDS.work} label="작품 정보" required error={fieldErrors.work}>
            <MiniField label="작품명" required>
              <ShortInput required value={form.workTitle} onChange={set('workTitle')} placeholder="작품 제목" />
              {copy.workTitleHint && <span className="text-caption-m text-text-meta">{copy.workTitleHint}</span>}
            </MiniField>
            <MiniField label={`작품 설명 (최대 ${DESC_MAX}자)`} required>
              <LongInput required maxLength={DESC_MAX} value={form.workDesc} onChange={set('workDesc')} placeholder={copy.workDescPlaceholder} />
              <span aria-live="polite" className="text-right text-caption-m text-text-meta">
                {form.workDesc.length}/{DESC_MAX}
              </span>
            </MiniField>
          </QuestionCard>


          {error && (
            <p role="alert" className="px-4 text-small-m text-state-error">
              {error}
            </p>
          )}
          <SubmitRow>
            <PrimarySubmit busy={submitting}>
              {submitting ? '접수 중' : '접수'}
            </PrimarySubmit>
          </SubmitRow>
        </form>
      )}
    </RespondentPage>
  )
}

export default ExhibitSubmit
