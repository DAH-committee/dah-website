import { Download } from 'lucide-react'
import PageBanner from '../components/layout/PageBanner'
import Container from '../components/layout/Container'
import SectionLabel from '../components/common/SectionLabel'
import Reveal from '../components/common/Reveal'
import Tag from '../components/common/Tag'
import Table from '../components/common/Table'
import { EditPencil } from '../components/content/EditControls'
import { useApi, firstItem } from '../hooks/useApi'
import { useTitle } from '../hooks/useTitle'
import { useLang, KoreanOnlyBadge } from '../i18n/LangContext'
import { codeSharing } from '../data/tracks'
import { motion } from '../styles/tokens'

// 코드쉐어링 v2 (10_IA_V2 2절 /curriculum/codesharing) — 구 Tracks.jsx 하단 섹션의 분리 페이지.
// Q1: 어드민 저장분(DB codesharing.body/depts/hwp_url) 우선 렌더 + 시드 폴백(그동안 시드만 읽어
//     저장이 화면에 반영되지 않던 버그). KR 편집 콘텐츠는 DB, EN은 감수 시드 대역 우선.
// P2-1: 3개 유형(대체형/인정형/학점인정형)과 졸업인증 기준을 표·태그·목록으로 제시.

const HWP_HREF = '/files/codesharing.hwp'

function CodeSharing() {
  const { lang, t } = useLang()
  useTitle(t('titles.codesharing'))

  // DB 단일 문서(있으면) → 시드 폴백. GET /content/codesharing 은 목록형이라 firstItem으로 언랩.
  const { data } = useApi('/content/codesharing')
  const remote = firstItem(data)
  const rb = remote?.body && typeof remote.body === 'object' ? remote.body : null

  // J5 유지: KR은 DB 우선(없으면 시드), EN은 감수된 시드 대역 우선(DB는 KR 편집분)
  const definition =
    lang === 'en'
      ? codeSharing.definitionEn ?? rb?.definition ?? codeSharing.definition
      : rb?.definition ?? codeSharing.definition
  const note =
    lang === 'en'
      ? codeSharing.noteEn ?? rb?.note ?? codeSharing.note
      : rb?.note ?? codeSharing.note
  const steps =
    lang === 'en' && Array.isArray(codeSharing.stepsEn)
      ? codeSharing.stepsEn
      : Array.isArray(rb?.steps) && rb.steps.length
        ? rb.steps
        : codeSharing.steps
  const types =
    Array.isArray(rb?.types) && rb.types.length ? rb.types : codeSharing.types
  const substitute =
    lang === 'en'
      ? codeSharing.substituteEn ?? rb?.substitute ?? codeSharing.substitute
      : rb?.substitute ?? codeSharing.substitute
  const recognizedCourses =
    Array.isArray(rb?.recognizedCourses) && rb.recognizedCourses.length
      ? rb.recognizedCourses
      : codeSharing.recognizedCourses
  const departments =
    Array.isArray(remote?.depts) && remote.depts.length ? remote.depts : codeSharing.departments
  const graduation =
    lang === 'en' && Array.isArray(codeSharing.graduationEn)
      ? codeSharing.graduationEn
      : Array.isArray(rb?.graduation) && rb.graduation.length
        ? rb.graduation
        : codeSharing.graduation
  const hwpHref = remote?.hwp_url || HWP_HREF

  // 유형별 학점 상한 안내 — 원문 types 항목 detail 재사용
  const recognizedNote = types?.[1]?.detail ?? ''
  const creditNote = types?.[2]?.detail ?? ''

  return (
    <>
      <PageBanner
        titleKo="코드쉐어링"
        titleEn="CODE SHARING"
        breadcrumb={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.curriculum'), to: '/curriculum' },
          { label: t('titles.codesharing'), to: '/curriculum/codesharing' },
        ]}
        nebulaX="75%"
        nebulaY="60%"
      />

      <div className="pb-section-m md:pb-section-d">
        {/* 01 안내 — 정의·유의 사항 원문 + HWP 다운로드 */}
        <Container as="section" className="pt-section-m md:pt-section-d">
          <Reveal>
            <div className="flex flex-wrap items-center gap-12">
              <SectionLabel index="01" text="OVERVIEW" />
              <KoreanOnlyBadge />
              {/* 코드쉐어링 단일 문서 편집(admin+, 13_CMS_SPEC 1절) — 비로그인 미렌더 */}
              <EditPencil type="codesharing" to="/admin/codesharing" />
            </div>
            <p className="mt-24 max-w-4xl text-h3-m font-bold leading-snug tracking-display text-text-pri md:mt-32 md:text-h3-d">
              {definition}
            </p>
            {/* K2-5: 문단 max-w 640 → 960(가독 상한) — 절반 꺾임 해소 */}
            <p className="mt-16 max-w-lead text-body-m leading-relaxed text-text-sec md:text-body-d">
              {note}
            </p>
            {/* 글래스 다운로드 버튼 — 파일 슬롯 예약(파일명 고정: codesharing.hwp) */}
            <a
              href={hwpHref}
              download="코드쉐어링_신청서.hwp"
              className="mt-32 inline-flex h-11 cursor-pointer items-center gap-8 rounded-glass border border-glass-line bg-glass-bg px-24 text-body-m font-semibold text-text-pri backdrop-blur-glass-mobile transition-colors duration-fast ease-out hover:bg-glass-strong md:h-48 md:backdrop-blur-glass md:text-body-d"
            >
              <Download size={16} aria-hidden="true" />
              {t('actions.download')}
            </a>
          </Reveal>
        </Container>

        {/* 02 승인 절차 4단계 (원문 그대로) */}
        {steps.length > 0 && (
          <Container as="section" className="pt-section-m md:pt-section-d">
            <Reveal>
              <SectionLabel index="02" text="PROCESS" />
              <h2 className="mt-24 text-h2-m font-extrabold leading-snug tracking-display text-text-pri md:mt-32 md:text-h2-d">
                {t('sections.procedure')}
              </h2>
            </Reveal>
            <ol className="mt-32 grid gap-24 border-t border-border-subtle pt-24 md:mt-48 md:grid-cols-4 md:gap-32">
              {steps.map((step, i) => (
                <Reveal key={i} delay={i < 6 ? i * motion.stagger : 0} as="li">
                  <p className="font-mono text-small-m text-text-pri md:text-small-d">
                    {String(i + 1).padStart(2, '0')}
                  </p>
                  <p className="mt-8 text-body-m leading-relaxed text-text-sec md:text-body-d">
                    {step}
                  </p>
                </Reveal>
              ))}
            </ol>
          </Container>
        )}

        {/* 03 교과목 대체형 코드쉐어링 — 값(없음) */}
        <Container as="section" className="pt-section-m md:pt-section-d">
          <Reveal>
            <SectionLabel index="03" text="SUBSTITUTE" />
            <h2 className="mt-24 text-h2-m font-extrabold leading-snug tracking-display text-text-pri md:mt-32 md:text-h2-d">
              {t('codesharing.substituteType')}
            </h2>
            <p className="mt-16 max-w-lead text-body-m leading-relaxed text-text-sec md:text-body-d">
              {substitute || t('codesharing.none')}
            </p>
          </Reveal>
        </Container>

        {/* 04 타과교과목 인정형 코드쉐어링 — 최대 9학점 안내 + 교과목 표 */}
        {recognizedCourses.length > 0 && (
          <Container as="section" className="pt-section-m md:pt-section-d">
            <Reveal>
              <SectionLabel index="04" text="RECOGNITION" />
              <h2 className="mt-24 text-h2-m font-extrabold leading-snug tracking-display text-text-pri md:mt-32 md:text-h2-d">
                {t('codesharing.recognizedType')}
              </h2>
              {recognizedNote && (
                <p className="mt-16 max-w-lead text-body-m leading-relaxed text-text-sec md:text-body-d">
                  {recognizedNote}
                </p>
              )}
            </Reveal>
            <div className="mt-32 md:mt-48">
              <Table
                columns={[
                  { key: 'semester', label: t('codesharing.thSemester') },
                  { key: 'code', label: t('codesharing.thCode'), mono: true },
                  { key: 'name', label: t('codesharing.thCourse') },
                  { key: 'credit', label: t('codesharing.thCredit'), mono: true, nowrap: true },
                  { key: 'major', label: t('codesharing.thMajor') },
                ]}
                rows={recognizedCourses}
              />
            </div>
          </Container>
        )}

        {/* 05 학점인정형 코드쉐어링 교과목 — 최대 9학점 안내 + 인정 학과 태그 */}
        {departments.length > 0 && (
          <Container as="section" className="pt-section-m md:pt-section-d">
            <Reveal>
              <SectionLabel index="05" text="CREDIT" />
              <h2 className="mt-24 text-h2-m font-extrabold leading-snug tracking-display text-text-pri md:mt-32 md:text-h2-d">
                {t('codesharing.creditType')}
              </h2>
              {creditNote && (
                <p className="mt-16 max-w-lead text-body-m leading-relaxed text-text-sec md:text-body-d">
                  {creditNote}
                </p>
              )}
            </Reveal>
            <div className="mt-32 flex flex-wrap gap-8 md:mt-48 md:gap-12">
              {departments.map((dept) => (
                <Tag key={dept}>{dept}</Tag>
              ))}
            </div>
          </Container>
        )}

        {/* 06 졸업인증 기준 */}
        {graduation.length > 0 && (
          <Container as="section" className="pt-section-m md:pt-section-d">
            <Reveal>
              <SectionLabel index="06" text="GRADUATION" />
              <h2 className="mt-24 text-h2-m font-extrabold leading-snug tracking-display text-text-pri md:mt-32 md:text-h2-d">
                {t('codesharing.graduationTitle')}
              </h2>
            </Reveal>
            <ol className="mt-32 flex flex-col gap-16 border-t border-border-subtle pt-24 md:mt-48">
              {graduation.map((g, i) => (
                <Reveal key={i} delay={i < 6 ? i * motion.stagger : 0} as="li" className="flex gap-12">
                  <span className="font-mono text-small-m text-text-meta md:text-small-d">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="min-w-0 break-keep text-body-m leading-relaxed text-text-sec md:text-body-d">
                    {g}
                  </p>
                </Reveal>
              ))}
            </ol>
          </Container>
        )}
      </div>
    </>
  )
}

export default CodeSharing
