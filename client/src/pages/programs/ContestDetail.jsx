// /programs/contests/:id — 공모전 상세 (T2 포스터형)
// 좌 포스터 2:3 / 우 메타 표 / 하단 갤러리(원본 새탭) / 공유 / 외부 접수 버튼.
import { useParams } from 'react-router-dom'
import PageBanner from '../../components/layout/PageBanner'
import Container from '../../components/layout/Container'
import ShareButton from '../../components/common/ShareButton'
import Button from '../../components/common/Button'
import ImageFrame from '../../components/common/ImageFrame'
import Tag from '../../components/common/Tag'
import StateMessage from '../../components/common/StateMessage'
import { EditPencil } from '../../components/content/EditControls'
import { useApi, itemOf } from '../../hooks/useApi'
import { useSeo, plainText } from '../../hooks/useSeo'
import { breadcrumbJsonLd, SITE_NAME } from '../../data/seo'
import { useLang, KoreanOnlyBadge } from '../../i18n/LangContext'
import { semesterLabelOf } from '../../utils/format'

function MetaRow({ label, children }) {
  return (
    <div className="flex gap-16 border-b border-border-subtle py-12">
      <dt className="w-80 shrink-0 font-mono text-caption-m text-text-meta">{label}</dt>
      <dd className="min-w-0 flex-1 text-body-m text-text-pri md:text-body-d">{children}</dd>
    </div>
  )
}

// 주최 원문: 배열이면 줄바꿈 join, 문자열이면 그대로(whitespace-pre-line로 여러 줄 보존)
function hostText(host) {
  if (!host) return null
  if (Array.isArray(host)) return host.join('\n')
  return String(host)
}

function ContestDetail() {
  const { lang, t } = useLang()
  const { id } = useParams()
  const { data, loading, error, offline, refetch } = useApi(`/content/contest/${id}`)
  const item = itemOf(data)
  // R1(27_I18N): EN 모드는 영문 제목 우선(공모전 영문 필수 — 없으면 국문 폴백 뱃지). 본문은 구조화(주최·회차)라 EN 대역 없음
  const isEn = lang === 'en'
  const title = (isEn && item?.title_en) || item?.title_ko || item?.title
  const koFallback = isEn && item && !item.title_en
  const departmentName = isEn
    ? 'Digital Arts & Humanities, Hallym University'
    : '한림대학교 디지털인문예술전공'
  const start = (item?.event_start ?? '').slice(0, 10)
  const end = (item?.event_end ?? '').slice(0, 10)
  const gallery = Array.isArray(item?.gallery) ? item.gallery : []
  // 51_CONTEST_SPLIT: 공모전 1건 = post 1건. host·semester_label·period는 컬럼이 원본이고,
  // 분리 이전 묶음 post가 남아 있을 경우를 대비해 body.host만 폴백으로 읽는다.
  const host = hostText(item?.host ?? item?.body?.host)
  const posterUrl = item?.poster_url
  // 학기는 목록 카드와 같은 규칙으로 산출한다(저장된 라벨 우선, 없으면 개최일에서)
  const semester = semesterLabelOf(item)
  const description = item
    ? isEn
      ? `${semester ? `${semester} ` : ''}${title || 'Contest'} is a contest listed by ${departmentName}. ${plainText(item.body)}`
      : `${semester ? `${semester} ` : ''}${title || '공모전'} 관련 ${departmentName} 공모전 정보입니다. ${plainText(item.body)}`
    : null
  const event = item && start && (!end || end >= start)
    ? {
        '@context': 'https://schema.org', '@type': 'Event', name: title, startDate: start,
        ...(end ? { endDate: end } : {}), image: posterUrl || undefined,
        organizer: { '@type': 'EducationalOrganization', name: host || SITE_NAME },
      }
    : null
  useSeo({
    title: title ? `${title} | ${departmentName}${isEn ? ' — Contests' : ' 공모전'}` : undefined,
    description, image: posterUrl,
    jsonLd: item ? [event, breadcrumbJsonLd([
      { name: t('nav.home'), path: '/' }, { name: t('titles.contests'), path: '/programs/contests' },
      { name: title || t('actions.detail'), path: `/programs/contests/${id}` },
    ])].filter(Boolean) : null,
  })

  return (
    <>
      <PageBanner
        titleKo="공모전"
        titleEn="CONTESTS"
        breadcrumb={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.events') },
          { label: t('titles.contests'), to: '/programs/contests' },
          { label: title ?? t('actions.detail') },
        ]}
        nebulaX="46%"
        nebulaY="14%"
      />
      <Container as="section" className="py-section-m lg:py-section-d">
        {loading ? (
          <p className="py-64 font-mono text-caption-m text-text-meta">{t('common.loading')}</p>
        ) : error && !offline ? (
          <StateMessage state="error" onRetry={refetch} className="py-64">
            공모전 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </StateMessage>
        ) : !item ? (
          <div className="flex flex-col items-start gap-24 py-64">
            <p className="font-mono text-caption-m text-text-meta">{t('notFoundPage.contests')}</p>
            <Button variant="secondary" href="/programs/contests">
              {t('common.backToList')}
            </Button>
          </div>
        ) : (
          <article className="flex min-w-0 flex-col gap-64">
            <div className="grid gap-32 lg:grid-cols-3 lg:gap-48">
              {/* 액션 버튼은 포스터 바로 아래 고정 — 전시회 상세와 동일 구조.
                  우측 정보 영역에 두면 본문 길이에 따라 버튼 위치가 글마다 달라진다. */}
              <div className="flex min-w-0 flex-col gap-16 lg:col-span-1">
                <figure className="w-full">
                  <ImageFrame
                    src={posterUrl}
                    alt={`${title} 포스터`}
                    ratio="2/3"
                    loading="eager"
                    placeholder={title}
                  />
                </figure>
                <div className="flex flex-wrap items-center gap-12">
                  {item.external_url && (
                    <Button variant="secondary" href={item.external_url} external arrow={false}>
                      {t('actions.exhibitionSite')}
                    </Button>
                  )}
                  <ShareButton title={title} />
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-24 lg:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-16">
                  <div className="flex min-w-0 flex-col gap-12">
                    <div className="flex flex-wrap items-center gap-8">
                      {item.tag && <Tag>{item.tag}</Tag>}
                      {koFallback && <KoreanOnlyBadge />}
                    </div>
                    <h1 className="min-w-0 text-h1-m font-bold leading-snug text-text-pri md:text-h1-d">
                      {title}
                    </h1>
                  </div>
                  <EditPencil type="contest" to={`/admin/posts/contest/${id}/edit`} />
                </div>
                {host && (
                  <div className="flex min-w-0 flex-col gap-4">

                    <p className="font-mono text-caption-m uppercase tracking-label text-text-meta">
                      {t('meta.host')}
                    </p>
                    <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec md:text-body-d">
                      {host}
                    </p>
                  </div>
                )}
                <dl className="w-max max-w-full border-t border-border-subtle">
                  {semester && <MetaRow label={t('meta.semester')}>{semester}</MetaRow>}
                  {(item.period || start || end) && (
                    <MetaRow label={t('meta.period')}>
                      {item.period || (start && end ? `${start} ~ ${end}` : start || end)}
                    </MetaRow>
                  )}
                </dl>
              </div>
            </div>
            {gallery.length > 0 && (
              <section className="flex flex-col gap-16">
                <h2 className="font-mono text-label-m uppercase tracking-label text-text-meta md:text-label-d">
                  {t('sections.gallery')}
                </h2>
                <ul className="grid grid-cols-2 gap-8 md:grid-cols-3 md:gap-16">
                  {gallery
                    .map((img) => (typeof img === 'string' ? { url: img, alt: '' } : img))
                    .map((img, idx) => (
                      <li key={img.url} className="min-w-0">
                        <a
                          href={img.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block aspect-[4/3] overflow-hidden rounded-md border border-border-subtle bg-bg-elev transition-colors duration-fast ease-out hover:border-border-strong"
                          aria-label={`${title} 갤러리 이미지 ${idx + 1} 원본 새 탭 열기`}
                        >
                          <img
                            src={img.url}
                            alt={img.alt || `${title} 갤러리 이미지 ${idx + 1}`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </a>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </article>
        )}
      </Container>
    </>
  )
}

export default ContestDetail
