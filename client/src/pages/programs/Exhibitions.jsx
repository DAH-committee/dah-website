// /programs/exhibitions — 전시회 아카이브 (상단 피처드 히어로 + 포스터 그리드, 2017~)
// 포스터는 원색 유지(grayscale 금지 — 전시 포스터 정체성). ImageFrame(2:3)로 통일.
import Link from '../../components/common/LangLink'
import PageBanner from '../../components/layout/PageBanner'
import Container from '../../components/layout/Container'
import GlassCard from '../../components/common/GlassCard'
import ImageFrame from '../../components/common/ImageFrame'
import Button from '../../components/common/Button'
import Reveal from '../../components/common/Reveal'
import StateMessage from '../../components/common/StateMessage'
import InlineEditBar from '../../components/content/InlineEditBar'
import { exhibitionFullTitle } from '../../data/exhibitionTitle'
import { useApi } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { useLang, KoreanOnlyBadge } from '../../i18n/LangContext'

// P9: 스태거 지연은 최대 6개까지만
const staggerDelay = (index) => (index < 6 ? index * 80 : 0)

// EN 서수 접미사 (11~13은 th 예외)
function ordinalSuffix(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return 'th'
  const ones = n % 10
  return ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'
}

// EN 전시회 풀네임 — exhibitionTitle.js는 국문 전용이므로 EN 대역은 여기서 인라인 조합
function exhibitionFullTitleEn(ordinal) {
  const n = Number(ordinal)
  return Number.isFinite(n) && n > 0
    ? `The ${n}${ordinalSuffix(n)} Digital Arts & Humanities Project Exhibition`
    : null
}

// 피처드 전시(is_featured) — 목록 최상단 히어로 블록
// Y2-1(33_PHASE18): 유리 질감의 정점. 포스터를 키우고 유리 프레임으로 감싸며,
// 블록 뒤에 은은한 퍼플 글로우(bg-nebula-* 토큰)를 깐다.
// 유리 표면은 backdrop-blur 없이 bg-glass-bg + hairline + shadow-glass로만 구성한다
// (11_DESIGN_V2 2절: 동시 blur 상한 3 — 헤더·모바일 시트 몫을 남긴다).
const GLASS_SURFACE =
  'rounded-glass border border-glass-line bg-glass-bg shadow-glass'

function FeaturedExhibition({ item }) {
  const { lang, t } = useLang()
  const title = (lang === 'en' && item.title_en) || item.title
  const fullTitle =
    (lang === 'en'
      ? exhibitionFullTitleEn(item.ordinal)
      : exhibitionFullTitle(item.ordinal)) || item.title
  const showTitle = title && title !== fullTitle
  // J5: EN 모드 소개문 — intro_en 우선, 없으면 국문 intro + Korean only 뱃지
  const introText = lang === 'en' ? item.intro_en || item.intro : item.intro
  const introKoFallback = lang === 'en' && !item.intro_en && Boolean(item.intro)

  return (
    <div className="relative isolate min-w-0">
      {/* 배경 퍼플 글로우 — 토큰 그라디언트만 사용(임의 색 금지), 콘텐츠 뒤로 깔린다 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-24 -inset-y-32 -z-10 bg-nebula-violet"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-24 -inset-y-32 -z-10 bg-nebula-deep"
      />
      <div className="grid items-center gap-32 md:grid-cols-[minmax(240px,360px)_minmax(0,1fr)] md:gap-40 lg:gap-56">
        {/* 포스터 유리 프레임 — 포스터 자체는 원색 유지(grayscale 금지) */}
        <div className={`w-full max-w-[360px] p-12 ${GLASS_SURFACE}`}>
          <ImageFrame
            src={item.poster_url}
            alt={`${title} ${t('aria.poster')}`}
            ratio="2/3"
            loading="eager"
            placeholder={fullTitle}
          />
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-24">
          <div className="flex min-w-0 flex-col gap-12">
            {/* 38_UI_FIX_BATCH: displayXL(40/64) → h1(26/36). 카드 제목이 페이지 H1(PageBanner,
                h1 26/36)의 1.78배라 위계가 역전돼 있었다. 페이지 H1과 같은 상한까지만 내리고,
                웨이트·행간도 새 크기에 맞춘다(800→700, 1.05→1.25). 상세 페이지 제목과 동일 규격. */}
            <h2 className="min-w-0 text-h1-m font-bold leading-snug tracking-display text-text-pri md:text-h1-d">
              {fullTitle}
            </h2>
            {showTitle && (
              <p className="min-w-0 text-h3-m font-medium leading-snug text-text-sec md:text-h3-d">
                「 {title} 」
              </p>
            )}
          </div>
          {introText ? (
            <div className="flex min-w-0 flex-col items-start gap-8">
              <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec md:text-body-d">
                {introText}
              </p>
              {introKoFallback && <KoreanOnlyBadge />}
            </div>
          ) : null}
          {item.site_url && (
            <div className="self-start">
              <Button variant="primary" href={item.site_url} external arrow={false}>
                {item.semester_label} DAH EXHIBITION
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PosterCard({ item }) {
  const { lang, t } = useLang()
  const title = (lang === 'en' && item.title_en) || item.title
  return (
    <Link to={`/programs/exhibitions/${item.id}`} className="group block h-full">
      {/* H2: 포스터 축소 원복 — 여백은 그리드 간격+소패딩(p-12)으로만, 포스터는 크게(2:3) */}
      <GlassCard hover glow className="flex h-full flex-col gap-12 p-12">
        <ImageFrame
          src={item.poster_url}
          alt={`${title} ${t('aria.poster')}`}
          ratio="2/3"
          placeholder={item.semester_label || title}
        />
        <div className="flex min-w-0 flex-col gap-4">
          {item.semester_label && (
            <p className="font-mono text-caption-m text-text-meta">
              {item.semester_label}
            </p>
          )}
          <h3 className="min-w-0 text-body-l-m font-bold leading-snug text-text-pri underline-offset-4 group-hover:underline md:text-body-l-d">
            {title}
          </h3>
        </div>
      </GlassCard>
    </Link>
  )
}

function Exhibitions() {
  const { t } = useLang()
  useTitle(t('titles.exhibitions'))
  // 아카이브는 단일 페이지에 전량 노출(페이지네이션 UI 없음) — 서버 최대치(100)로 요청
  const { data, loading, error, offline, refetch } = useApi('/content/exhibitions', {
    params: { pageSize: 100 },
  })
  // Y2-5: 접수 진입 노출 여부는 설정 스위치(show_button)가 결정 — 기간 검증은 서버(403)
  const { data: settingsRes } = useApi('/settings/public')
  const showSubmit = settingsRes?.exhibition?.show_button === true
  const items = data?.items ?? []
  const featured = items.find((it) => it?.is_featured)
  const rest = items.filter((it) => it !== featured)

  return (
    <>
      <PageBanner
        titleKo="프로젝트 전시회"
        titleEn="EXHIBITIONS"
        breadcrumb={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.events') },
          { label: t('titles.exhibitions'), to: '/programs/exhibitions' },
        ]}
        nebulaX="64%"
        nebulaY="20%"
      />
      <Container as="section" className="pb-section-m pt-32 lg:pb-section-d lg:pt-48">
        <div className="flex flex-wrap items-center justify-end gap-16">
          <InlineEditBar
            type="exhibitions"
            addTo="/admin/posts/exhibitions/new"
            manageTo="/admin/posts/exhibitions"
          />
        </div>
        {loading ? (
          <StateMessage state="loading">{t('common.loading')}</StateMessage>
        ) : items.length === 0 ? (
          <StateMessage state={error && !offline ? 'error' : 'empty'} onRetry={error && !offline ? refetch : undefined}>
            {error && !offline ? t('common.error') : t('common.empty')}
          </StateMessage>
        ) : (
          <div className="mt-32 flex min-w-0 flex-col gap-64">
            {featured && (
              <Reveal className="min-w-0">
                <FeaturedExhibition item={featured} />
              </Reveal>
            )}
            {/* 피처드가 없어도 접수 진입은 노출한다 */}
            {!featured && showSubmit && (
              <div className="flex flex-wrap items-center gap-16">
                <Button variant="primary" href="/submit">
                  전시회 접수
                </Button>
                <Button variant="secondary" href="/submit">
                  접수 내역 확인·수정
                </Button>
              </div>
            )}
            {rest.length > 0 && (
              <ul className="grid gap-16 [grid-template-columns:repeat(auto-fill,minmax(min(220px,40vw),1fr))] md:gap-24">
                {/* K2-14: 포스터 그리드 유동화 — 220px는 기존 lg 4열 카드폭(약 260px) 근사 하한,
                    40vw 상한으로 모바일 2열 유지. 열 수가 뷰포트에 연속 대응(급전환 없음) */}
                {rest.map((item, index) => (
                  <Reveal as="li" key={item.id} delay={staggerDelay(index)} className="min-w-0">
                    <PosterCard item={item} />
                  </Reveal>
                ))}
              </ul>
            )}
          </div>
        )}
      </Container>
    </>
  )
}

export default Exhibitions
