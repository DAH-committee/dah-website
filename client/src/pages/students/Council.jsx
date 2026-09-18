// /students/council — 운영위원회 (T4 아카이브형: 기수별 아카이브)
// 기수 탭(최신 기본) → 로고·기수명·소개·구성원 그리드. 기수가 늘어도 동일 템플릿 보존.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PageBanner from '../../components/layout/PageBanner'
import ImageFrame from '../../components/common/ImageFrame'
import StateMessage from '../../components/common/StateMessage'
import Container from '../../components/layout/Container'
import { ACCENT } from '../../styles/accents'
import { AddButton, EditPencil } from '../../components/content/EditControls'
import { api, useApi } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { useLang } from '../../i18n/LangContext'
import { councils } from '../../data/council'

const toMember = (member) =>
  typeof member === 'string' ? { name: member } : member

// J5: EN 모드 소속 전공 라벨 — '디지털인문예술[전공]' 접두만 풀네임으로 치환(뒤 숫자 보존).
// 타 학과(사회학과 등)는 EN 대역 원문이 없어 국문 그대로 둔다.
function majorsEn(majors) {
  if (!majors) return majors
  return majors.replace(/^디지털인문예술( ?전공)?/, 'Digital Arts & Humanities')
}

// 38_UI_FIX_BATCH 기수 타이틀 3색 규칙(A2(36_ACCENT_POLISH) 톤다운·연보라 처리를 대체) —
// "2026 제1대 운영위원회 LUCID"에서
//   연도(2026)      → 화이트(text.pri). 톤다운하지 않는다.
//   제1대의 숫자 1  → purple.primary. "제", "대", "운영위원회"는 text.pri 유지(서수 숫자만 포인트).
//   기수명(LUCID)   → purple.primary. 고유명만 강조.
// purple.mid/light가 아니라 대표색 primary 하나로 통일해 두 포인트가 같은 층위임을 드러낸다.
// accents.js(ACCENT.index/proper)는 다른 화면이 공유하므로 건드리지 않고 여기서만 클래스를 쓴다.
// 원문 문자열은 자르거나 바꾸지 않고 표시만 분리한다(사용자 원문 불변).
// g 플래그 없음: split은 g 없이도 전체를 분해하고, test는 lastIndex 상태가 남지 않는다.
const TITLE_SPLIT_RE = /(^\d{4}|제\s?\d+대|\b[A-Z]{2,}\b)/
const YEAR_RE = /^\d{4}$/
const ORDINAL_RE = /^(제\s?)(\d+)(대)$/
const PROPER_RE = /^[A-Z]{2,}$/

function TitleWithAccents({ text }) {
  return String(text ?? '')
    .split(TITLE_SPLIT_RE)
    .filter((part) => part !== '')
    .map((part, i) => {
      // eslint-disable-next-line react/no-array-index-key
      const key = `${part}-${i}`
      if (YEAR_RE.test(part)) {
        return (
          <span key={key} className="text-text-pri">
            {part}
          </span>
        )
      }
      const ordinal = ORDINAL_RE.exec(part)
      if (ordinal) {
        const [, prefix, digits, suffix] = ordinal
        return (
          <span key={key}>
            {prefix}
            <span className="text-purple-primary">{digits}</span>
            {suffix}
          </span>
        )
      }
      if (PROPER_RE.test(part)) {
        return (
          <span key={key} className="text-purple-primary">
            {part}
          </span>
        )
      }
      return part
    })
}

// J6: 연속한 같은 부서(role)를 한 행으로 묶는다 — 원문 순서 보존. T1: 부서 EN(roleEn)도 함께
function groupByRole(members) {
  const rows = []
  for (const m of members) {
    const last = rows[rows.length - 1]
    if (last && last.role === (m.role ?? '')) last.members.push(m)
    else rows.push({ role: m.role ?? '', roleEn: m.roleEn ?? '', members: [m] })
  }
  return rows
}

// H3 폴백: data/council.js 원문(councils) — 2026(현 LUCID) 맨 앞, 이후 연도 내림차순
const FALLBACK_ITEMS = councils.map((c) => ({
  id: `council-${c.year}`,
  name: c.title,
  titleEn: c.titleEn,
  year_label: String(c.year),
  intro: c.intro,
  members: c.members,
}))

function HyunhoEasterEggModal({ status, onClose, onSubmitted }) {
  const [form, setForm] = useState({ name: '', student_no: '', phone: '', privacy_agreed: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  // 상태 요청이 아직 끝나지 않아도 입력창은 먼저 열어 둔다. 최종 3명 제한은 서버가
  // 원자적으로 판정하므로, 네트워크 지연 때문에 축하 모달이 빈 화면이 되지 않는다.
  const isFull = status?.remaining === 0
  const expectedPosition = status?.nextPosition ?? 1

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const submit = async (event) => {
    event.preventDefault()
    if (saving || result) return
    setSaving(true)
    setError(null)
    try {
      const response = await api.post('/easter-eggs/hyunho/discoveries', form)
      setResult(response.discovery)
      onSubmitted()
    } catch (err) {
      setError(
        err.status === 409
          ? '이번 라운드의 3명 발견자가 모두 등록되었습니다.'
          : '입력 내용을 확인한 뒤 다시 시도해 주세요.'
      )
      onSubmitted()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-gutter-m py-24">
      <button
        type="button"
        aria-label="이스터에그 창 닫기"
        onClick={!saving ? onClose : undefined}
        className="absolute inset-0 cursor-default bg-cosmos-depth0/80 backdrop-blur-glass-mobile"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hyunho-easter-title"
        className="relative z-10 w-full max-w-[520px] rounded-glass border border-border-strong bg-bg-elev p-24 shadow-glass md:p-32"
      >
        {result ? (
          <div className="flex flex-col items-start gap-16">
            <p className="font-mono text-label-m uppercase tracking-label text-purple-primary">EASTER EGG FOUND</p>
            <h2 id="hyunho-easter-title" className="text-h2-m font-bold text-text-pri md:text-h2-d">
              축하합니다!
            </h2>
            <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec md:text-body-d">
              {result.position}번째로 제작자 주현호의 이스터에그를 발견하셨습니다.\n참여 기록을 저장했습니다.
            </p>
            <button type="button" onClick={onClose} className="mt-8 inline-flex h-11 cursor-pointer items-center rounded-sm bg-button-primary px-24 text-body-m font-semibold text-button-primaryText transition duration-fast ease-out hover:bg-button-primaryHover">
              확인
            </button>
          </div>
        ) : (
          <form className="flex flex-col gap-20" onSubmit={submit}>
            <div className="flex flex-col gap-8">
              <p className="font-mono text-label-m uppercase tracking-label text-purple-primary">EASTER EGG FOUND</p>
              <h2 id="hyunho-easter-title" className="text-h2-m font-bold text-text-pri md:text-h2-d">
                축하합니다!
              </h2>
              <p className="text-body-m leading-relaxed text-text-sec md:text-body-d">
                {isFull
                  ? '이번 라운드의 3명 발견자가 모두 등록되었습니다. 다음 라운드를 기다려 주세요.'
                  : `${expectedPosition}번째로 제작자 주현호의 이스터에그를 발견하셨습니다. 3명까지만 기록됩니다.`}
              </p>
            </div>
            {!isFull && (
              <>
                <label className="flex flex-col gap-8">
                  <span className="font-mono text-label-m text-text-meta">이름</span>
                  <input required value={form.name} maxLength={50} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} className="rounded-md border border-border-subtle bg-bg-panel px-16 py-12 text-body-m text-text-pri outline-none transition duration-fast ease-out focus:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus" />
                </label>
                <label className="flex flex-col gap-8">
                  <span className="font-mono text-label-m text-text-meta">학번</span>
                  <input required inputMode="numeric" pattern="[0-9]{6,16}" value={form.student_no} maxLength={16} onChange={(e) => setForm((v) => ({ ...v, student_no: e.target.value }))} className="rounded-md border border-border-subtle bg-bg-panel px-16 py-12 text-body-m text-text-pri outline-none transition duration-fast ease-out focus:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus" />
                </label>
                <label className="flex flex-col gap-8">
                  <span className="font-mono text-label-m text-text-meta">전화번호</span>
                  <input required inputMode="tel" placeholder="010-0000-0000" value={form.phone} maxLength={24} onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))} className="rounded-md border border-border-subtle bg-bg-panel px-16 py-12 text-body-m text-text-pri outline-none transition duration-fast ease-out placeholder:text-text-meta focus:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus" />
                </label>
                <label className="flex cursor-pointer items-start gap-8 text-small-m leading-relaxed text-text-sec">
                  <input required type="checkbox" checked={form.privacy_agreed} onChange={(e) => setForm((v) => ({ ...v, privacy_agreed: e.target.checked }))} className="mt-4 h-16 w-16 accent-purple-primary" />
                  <span>이름·학번·전화번호를 이스터에그 참여 기록과 경품 안내 목적으로 수집하는 데 동의합니다.</span>
                </label>
              </>
            )}
            {error && <p role="alert" className="text-small-m text-state-error">{error}</p>}
            <div className="flex flex-wrap justify-end gap-8 border-t border-border-subtle pt-16">
              <button type="button" disabled={saving} onClick={onClose} className="inline-flex h-11 cursor-pointer items-center rounded-sm border border-border-subtle px-16 text-body-m text-text-pri transition duration-fast ease-out hover:border-border-strong disabled:opacity-40">
                닫기
              </button>
              {!isFull && <button type="submit" disabled={saving} className="inline-flex h-11 cursor-pointer items-center rounded-sm bg-button-primary px-24 text-body-m font-semibold text-button-primaryText transition duration-fast ease-out hover:bg-button-primaryHover disabled:opacity-40">
                {saving ? '저장 중' : '참여 기록 저장'}
              </button>}
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body
  )
}

function Council() {
  const { lang, t } = useLang()
  useTitle(t('titles.council'))
  // G1.3: 페이지네이션 UI 없는 목록은 전량 요청(서버 기본 12건 상한 회피)
  const { data, loading, error, offline, refetch } = useApi('/content/council', {
    params: { pageSize: 100 },
  })
  const easterStatus = useApi('/easter-eggs/hyunho/status')
  const remote = data?.items ?? []
  // H3: 연도(year_label) 내림차순 — 2026(현 운영위)이 항상 맨 앞
  const items =
    remote.length > 0
      ? [...remote].sort(
          (a, b) => Number(b.year_label ?? 0) - Number(a.year_label ?? 0)
        )
      : FALLBACK_ITEMS

  const [selectedId, setSelectedId] = useState(null)
  const [easterOpen, setEasterOpen] = useState(false)
  const hyunhoClickTimes = useRef([])
  const activateEasterEgg = () => {
    const now = Date.now()
    hyunhoClickTimes.current = [...hyunhoClickTimes.current.filter((time) => now - time < 900), now]
    if (hyunhoClickTimes.current.length < 3) return
    document.documentElement.dataset.dahEasterEgg = 'on'
    // Canvas처럼 CSS 변수·클래스만으로 색을 바꿀 수 없는 렌더러에도 전환을 알린다.
    window.dispatchEvent(new Event('dah-easter-egg'))
    hyunhoClickTimes.current = []
    easterStatus.refetch()
    setEasterOpen(true)
  }
  const active = items.find((c) => c.id === selectedId) ?? items[0] ?? null
  const members = Array.isArray(active?.members) ? active.members.map(toMember) : []
  // J5: EN 모드 소개문 — 원격 행에는 introEn이 없어 정적 원문(councils)을 연도로 매칭
  const staticMatch = councils.find((c) => String(c.year) === String(active?.year_label))
  const introText =
    lang === 'en' ? staticMatch?.introEn ?? active?.intro : active?.intro
  // J5: EN 모드 기수 타이틀 — titleEn(연도 포함) 우선, 없으면 국문 합성으로 폴백
  const composedTitle = [active?.year_label, active?.name].filter(Boolean).join(' ')
  const titleText =
    lang === 'en'
      ? staticMatch?.titleEn ?? active?.titleEn ?? composedTitle
      : composedTitle

  return (
    <>
      <PageBanner
        titleKo="운영위원회"
        titleEn="COUNCIL"
        breadcrumb={[{ label: t('nav.home'), to: '/' }, { label: t('nav.activities') }, { label: t('titles.council'), to: '/students/council' }]}
        nebulaX="24%"
        nebulaY="40%"
      />
      <Container as="section" className="py-section-m lg:py-section-d">
        <div className="flex flex-wrap items-center justify-between gap-16">
          {/* 기수 탭 — 최신 기수 기본 활성 */}
          <div
            role="group"
            aria-label={t('aria.termSelect')}
            className="flex flex-wrap gap-x-8 gap-y-4 md:gap-x-24 md:gap-y-8"
          >
            {items.map((c) => {
              const isActive = c.id === active?.id
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelectedId(c.id)}
                  className={`-mb-px inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-b-2 px-4 font-mono transition-colors duration-fast ease-out ${
                    c === items[0]
                      ? 'text-body-m font-bold md:text-body-d'
                      : 'text-small-m md:text-small-d'
                  } ${
                    // Y1-4: 활성 연도는 선택 상태 하이라이트(purple.light, CI 4.5 3단계)
                    isActive
                      ? 'border-purple-light text-purple-light'
                      : 'border-transparent text-text-meta hover:text-text-sec'
                  }`}
                >
                  {c.year_label ?? (c.ordinal ? `${c.ordinal}기` : c.name)}
                </button>
              )
            })}
          </div>
          <AddButton type="council" to="/admin/council" />
        </div>

        {loading ? (
          <StateMessage state="loading">{t('common.loading')}</StateMessage>
        ) : !active ? (
          <StateMessage state={error && !offline ? 'error' : 'empty'} onRetry={error && !offline ? refetch : undefined}>
            {error && !offline ? t('common.error') : t('common.empty')}
          </StateMessage>
        ) : (
          <div className="mt-48 flex min-w-0 flex-col gap-48">
            {/* T4 헤더 (K2-4): 로고(박스 없이 이미지만, 1.5배 h-144) + 타이틀 한 줄 수직 중앙 정렬.
                타이틀은 "{연도} {기수라벨 포함 이름}" 한 줄 합성. 로고 없으면 미표시(빈 박스 금지). */}
            <div className="flex min-w-0 flex-col gap-24">
              <div className="flex min-w-0 flex-wrap items-center gap-24 md:gap-32">
                {active.logo_url &&
                  (active.has_bg ? (
                    // Q4: 배경 토글 on — 투명 PNG를 중성 배경 프레임 위에 표시(검은 배경에서 안 보이던 문제 해결)
                    <div className="w-[144px] shrink-0 md:w-[200px]">
                      <ImageFrame
                        src={active.logo_url}
                        alt={`${active.name} 로고`}
                        ratio="3/2"
                        contain
                        bg
                      />
                    </div>
                  ) : (
                    <img
                      src={active.logo_url}
                      alt={`${active.name} 로고`}
                      loading="lazy"
                      className="h-96 w-auto shrink-0 object-contain md:h-144"
                    />
                  ))}
                <div className="flex min-w-0 flex-wrap items-center gap-12">
                  <h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">
                    <TitleWithAccents text={titleText} />
                  </h2>
                  <EditPencil type="council" to="/admin/council" />
                </div>
              </div>
              {introText && (
                <p className="max-w-lead whitespace-pre-line text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">
                  {introText}
                </p>
              )}
            </div>

            {/* J6: 구성 — eyebrow + 제목 + 부서별 행 리스트(좌 라벨 / 우 이름, 헤어라인) */}
            <div className="flex flex-col gap-24">
              <div>
                <p className="font-mono text-label-m uppercase tracking-label text-text-meta md:text-label-d">
                  COMMITTEE
                </p>
                <h3 className="mt-12 text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">
                  {t('council.compositionTitle')}
                </h3>
              </div>
              {members.length === 0 ? (
                <StateMessage className="min-h-0 py-24" state="empty">{t('common.empty')}</StateMessage>
              ) : (
                <dl className="border-t border-border-subtle">
                  {groupByRole(members).map((row) => (
                    <div
                      key={row.role}
                      className="flex flex-col gap-8 border-b border-border-subtle py-16 md:flex-row md:items-baseline md:gap-24 md:py-20"
                    >
                      {/* Y1-4: 직책·부서 라벨은 purple.mid(ACCENT.role). 원문 표기는 그대로 */}
                      <dt
                        className={`w-128 shrink-0 font-mono text-small-m font-semibold md:text-small-d ${ACCENT.role}`}
                      >
                        {lang === 'en' ? row.roleEn || row.role : row.role}
                      </dt>
                      <dd className="flex min-w-0 flex-wrap gap-x-24 gap-y-8">
                        {row.members.map((member) => (
                          <span
                            key={`${member.name}-${member.majors ?? ''}`}
                            className="text-body-m text-text-pri md:text-body-d"
                            onClick={member.name === '주현호' ? activateEasterEgg : undefined}
                            role={member.name === '주현호' ? 'button' : undefined}
                            tabIndex={member.name === '주현호' ? 0 : undefined}
                            onKeyDown={member.name === '주현호' ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') activateEasterEgg()
                            } : undefined}
                          >
                            {lang === 'en' ? member.nameEn ?? member.name : member.name}
                            {member.majors && (
                              <span className="ml-8 text-small-m text-text-meta md:text-small-d">
                                ({lang === 'en' ? member.majorsEn ?? majorsEn(member.majors) : member.majors})
                              </span>
                            )}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}
      </Container>
      {easterOpen && (
        <HyunhoEasterEggModal
          status={easterStatus.data}
          onClose={() => setEasterOpen(false)}
          onSubmitted={easterStatus.refetch}
        />
      )}
    </>
  )
}

export default Council
