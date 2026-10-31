// /submit — 전시회 처음 화면. 접수, 접수 수정, 작품 제출이 각각 따로 있는 화면이라
// 여기서는 지금 무엇을 할 수 있는지만 보여 주고 각 화면으로 보낸다. 접수 폼은 /submit/new에 따로 있다.
import Button from '../../components/common/Button'
import { HeaderCard, NoticeCard, RespondentPage, ScheduleInline, Card } from '../../components/forms/respondent'
import { useApi } from '../../hooks/useApi'
import { exhibitionCopy } from '../../data/exhibitionCopy'
import { useTitle } from '../../hooks/useTitle'
import { EXHIBITION_SUFFIX, exhibitionFullTitle } from '../../data/exhibitionTitle'
import { formatKst, resolveOrdinal } from './exhibitFormShared'

// 기간 상태: 시작 전 | 진행 중 | 마감. 판정은 안내용이고 실제 차단은 서버가 한다.
function periodState(from, to) {
  if (!from || !to) return { key: 'unknown', label: '일정 확인 중' }
  const now = new Date()
  if (now < new Date(from)) return { key: 'before', label: `${formatKst(from)}부터` }
  if (now > new Date(to)) return { key: 'closed', label: '마감되었습니다' }
  return { key: 'open', label: `진행 중 (${formatKst(to)}까지)` }
}

function StepCard({ number, title, desc, state, href, cta }) {
  const open = state.key === 'open'
  return (
    <Card className="flex flex-col gap-12">
      <div className="flex min-w-0 items-baseline gap-12">
        <span className="shrink-0 font-semibold text-purple-primary">{number}</span>
        <h2 className="min-w-0 text-body-l-m font-bold text-text-pri md:text-body-l-d">{title}</h2>
      </div>
      <p className="text-body-m leading-relaxed text-text-sec">{desc}</p>
      <p className={`text-small-m font-semibold ${open ? 'text-purple-primary' : 'text-text-meta'}`}>{state.label}</p>
      <div>
        <Button variant={open ? 'primary' : 'secondary'} href={href}>
          {cta}
        </Button>
      </div>
    </Card>
  )
}

function ExhibitHub() {
  useTitle('전시회 접수')
  const { data: settingsRes, loading } = useApi('/settings/public')
  const exhibition = settingsRes?.exhibition ?? null
  const copy = exhibitionCopy(settingsRes?.settings?.exhibitionCopy, 'ko')
  const title = exhibitionFullTitle(resolveOrdinal(settingsRes)) || EXHIBITION_SUFFIX

  const schedule = [
    { label: '접수 시작', value: formatKst(exhibition?.submit_open) },
    { label: '접수 마감', value: formatKst(exhibition?.submit_close) },
    { label: '작품 제출 시작', value: formatKst(exhibition?.files_open) },
    { label: '수정과 작품 제출 마감', value: formatKst(exhibition?.edit_close) },
  ]

  return (
    <RespondentPage>
      <HeaderCard title={title}>
        {copy.onboardingLead && <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec">{copy.onboardingLead}</p>}
        <ScheduleInline rows={schedule} />
      </HeaderCard>

      {loading ? (
        <p className="px-4 text-small-m text-text-meta" aria-live="polite">
          일정 확인 중
        </p>
      ) : (
        <>
          <StepCard
            number="1"
            title="작품 접수"
            desc="구글 로그인 후 신청자, 과목, 작품명, 작품 설명을 씁니다. 작품이 여러 개이면 작품마다 따로 접수합니다."
            state={periodState(exhibition?.submit_open, exhibition?.submit_close)}
            href="/submit/new"
            cta="작품 접수하기"
          />
          <StepCard
            number="2"
            title="접수 수정"
            desc="접수한 작품명, 작품 설명, 팀원 정보를 수정 마감까지 고칩니다."
            state={periodState(exhibition?.submit_open, exhibition?.edit_close)}
            href="/submit/edit"
            cta="접수 내역 확인과 수정"
          />
          <StepCard
            number="3"
            title="작품 제출"
            desc="접수한 작품을 골라 작품 원본 파일을 올립니다. 접수 기간에는 열리지 않습니다."
            state={periodState(exhibition?.files_open, exhibition?.edit_close)}
            href="/submit/files"
            cta="작품 제출하기"
          />
          {copy.notes.length > 0 && (
            <NoticeCard title={copy.notesTitle || '유의사항'}>
              <ul className="flex flex-col gap-8">
                {copy.notes.map((note) => (
                  <li key={note} className="flex min-w-0 gap-12 text-small-m leading-relaxed text-text-sec">
                    <span aria-hidden="true" className="mt-8 h-4 w-4 shrink-0 rounded-full bg-text-meta" />
                    <span className="min-w-0">{note}</span>
                  </li>
                ))}
              </ul>
            </NoticeCard>
          )}
        </>
      )}
    </RespondentPage>
  )
}

export default ExhibitHub
