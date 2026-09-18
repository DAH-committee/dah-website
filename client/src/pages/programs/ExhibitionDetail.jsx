// /programs/exhibitions/:id — 전시회 상세 (T2 확장)
// 좌 포스터 2:3 / 우 메타 표 / RichBody / 하단 현장·작품 갤러리(라이트박스 없이 원본 새탭) / 공유.
import { useParams } from 'react-router-dom'
import Container from '../../components/layout/Container'
import ShareButton from '../../components/common/ShareButton'
import Button from '../../components/common/Button'
import ImageFrame from '../../components/common/ImageFrame'
import RichBody from '../../components/content/RichBody'
import StateMessage from '../../components/common/StateMessage'
import { EditPencil } from '../../components/content/EditControls'
import { useApi, itemOf } from '../../hooks/useApi'
import { useSeo, plainText } from '../../hooks/useSeo'
import { breadcrumbJsonLd, SITE_NAME } from '../../data/seo'
import { useLang, KoreanOnlyBadge } from '../../i18n/LangContext'
import { exhibitionSiteLabel } from '../../data/exhibitionTitle'

// gallery jsonb 정규화: 배열 → 단일 갤러리, 객체 → 현장·작품 구분 섹션
const GALLERY_LABELS = {
  site: '현장',
  venue: '현장',
  scene: '현장',
  field: '현장',
  works: '작품',
  work: '작품',
  artworks: '작품',
}

function normalizeGalleries(gallery) {
  if (!gallery) return []
  if (Array.isArray(gallery)) {
    return gallery.length ? [{ label: '갤러리', images: gallery }] : []
  }
  return Object.entries(gallery)
    .filter(([, images]) => Array.isArray(images) && images.length > 0)
    .map(([key, images]) => ({ label: GALLERY_LABELS[key] ?? key, images }))
}

const toImage = (img) => (typeof img === 'string' ? { url: img, alt: '' } : img)

// TipTap 빈 문서({ type: 'doc', content: [{ type: 'paragraph' }]})는 실제 본문이 아니다.
// 해당 경우 소개문을 보여 주어야 관리자에서 등록한 핵심 설명이 사라지지 않는다.
function hasRichBodyContent(value) {
  if (!value) return false
  if (!Array.isArray(value.content)) return true
  return value.content.some((node) =>
    node?.text || node?.content?.some((child) => child?.text || child?.content?.length)
  )
}

// 전시 기간: start_date~end_date(DATE 문자열), 없으면 held_at 폴백
function periodText(start, end, fallback) {
  const s = (start ?? '').slice(0, 10)
  const e = (end ?? '').slice(0, 10)
  if (s && e) return `${s} ~ ${e}`
  return s || e || (fallback ?? null)
}

function GallerySection({ label, images, title }) {
  return (
    <section className="flex flex-col gap-16">
      <h2 className="font-mono text-label-m uppercase tracking-label text-text-meta md:text-label-d">
        {label}
      </h2>
      <ul className="grid grid-cols-2 gap-8 md:grid-cols-3 md:gap-16">
        {images.map(toImage).map((img, idx) => (
          <li key={img.url} className="min-w-0">
            <a
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block aspect-[4/3] overflow-hidden rounded-md border border-border-subtle bg-bg-elev transition-colors duration-fast ease-out hover:border-border-strong"
              aria-label={`${title} ${label} 이미지 ${idx + 1} 원본 새 탭 열기`}
            >
              <img
                src={img.url}
                alt={img.alt || `${title} ${label} 이미지 ${idx + 1}`}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ExhibitionDetail() {
  const { lang, t } = useLang()
  const { id } = useParams()
  const { data, loading, error, offline, refetch } = useApi(`/content/exhibitions/${id}`)
  const item = itemOf(data)
  // R1(27_I18N): EN 모드는 영문 제목·소개·본문 우선(전시회 영문 필수 — 없으면 국문 폴백 뱃지)
  const isEn = lang === 'en'
  const title = (isEn && item?.title_en) || item?.title
  const body = isEn && item?.body_en ? item.body_en : item?.body
  const hasBody = hasRichBodyContent(body)
  const intro = isEn && item?.intro_en ? item.intro_en : item?.intro
  const koFallback = isEn && item && (!item.title_en || (hasBody ? !item.body_en : item.intro && !item.intro_en))
  const departmentName = isEn
    ? 'Digital Arts & Humanities, Hallym University'
    : '한림대학교 디지털인문예술전공'
  const start = (item?.start_date ?? '').slice(0, 10)
  const end = (item?.end_date ?? '').slice(0, 10)
  const description = item
    ? isEn
      ? `${item.semester_label ? `${item.semester_label} ` : ''}${title || 'Project Exhibition'} is a project exhibition by ${departmentName}. ${plainText(intro || body)}`
      : `${item.semester_label ? `${item.semester_label} ` : ''}${title || '프로젝트 전시회'}은 ${departmentName} 프로젝트 전시회입니다. ${plainText(intro || body)}`
    : null
  const breadcrumbs = [
    { name: t('nav.home'), path: '/' },
    { name: t('titles.exhibitions'), path: '/programs/exhibitions' },
    { name: title || t('actions.detail'), path: `/programs/exhibitions/${id}` },
  ]
  const event = item && start && (!end || end >= start)
    ? {
        '@context': 'https://schema.org', '@type': 'Event', name: title,
        startDate: start, ...(end ? { endDate: end } : {}),
        url: item.site_url || undefined, image: item.poster_url || undefined,
        organizer: { '@type': 'EducationalOrganization', name: SITE_NAME },
      }
    : null
  useSeo({
    title: title
      ? `${item?.semester_label ? `${item.semester_label} ` : ''}${title} | ${departmentName}${isEn ? ' — Exhibitions' : ' 프로젝트 전시회'}`
      : undefined,
    description,
    image: item?.poster_url,
    jsonLd: event ? [event, breadcrumbJsonLd(breadcrumbs)] : breadcrumbJsonLd(breadcrumbs),
  })

  const galleries = normalizeGalleries(item?.gallery)

  return (
    <Container as="section" className="pb-section-m pt-32 lg:pb-section-d lg:pt-48">
        {loading ? (
          <p className="py-64 font-mono text-caption-m text-text-meta">{t('common.loading')}</p>
        ) : error && !offline ? (
          <StateMessage state="error" onRetry={refetch} className="py-64">
            전시회 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </StateMessage>
        ) : !item ? (
          <div className="flex flex-col items-start gap-24 py-64">
            <p className="font-mono text-caption-m text-text-meta">{t('notFoundPage.exhibitions')}</p>
            <Button variant="secondary" href="/programs/exhibitions">
              {t('common.backToList')}
            </Button>
          </div>
        ) : (
          <article className="flex min-w-0 flex-col gap-48">
            <div className="grid items-start gap-32 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)] lg:gap-56">
              <div className="min-w-0">
                <figure className="w-full max-w-[360px] lg:max-w-[420px]">
                  <ImageFrame
                    src={item.poster_url}
                    alt={`${item.title} 포스터`}
                    ratio="2/3"
                    loading="eager"
                    placeholder={item.semester_label || item.title}
                  />
                </figure>
              </div>
              <div className="flex min-w-0 flex-col gap-24">
                <div className="flex flex-wrap items-start justify-between gap-16">
                  <div className="flex min-w-0 flex-col gap-8">
                    {koFallback && <KoreanOnlyBadge />}
                    <h1 className="min-w-0 text-h1-m font-bold leading-snug text-text-pri md:text-h1-d">
                      {title}
                    </h1>
                  </div>
                  <EditPencil
                    type="exhibitions"
                    to={`/admin/posts/exhibitions/${id}/edit`}
                  />
                </div>
                <dl className="grid w-full max-w-[640px] gap-12 sm:grid-cols-2">
                  {item.semester_label && (
                    <div className="rounded-md border border-border-subtle bg-bg-elev px-16 py-12">
                      <dt className="font-mono text-caption-m text-text-meta">{t('meta.semester')}</dt>
                      <dd className="mt-4 text-body-m text-text-pri md:text-body-d">{item.semester_label}</dd>
                    </div>
                  )}
                  {periodText(item.start_date, item.end_date, item.held_at) && (
                    <div className="rounded-md border border-border-subtle bg-bg-elev px-16 py-12">
                      <dt className="font-mono text-caption-m text-text-meta">{t('meta.period')}</dt>
                      <dd className="mt-4 text-body-m text-text-pri md:text-body-d">
                        {periodText(item.start_date, item.end_date, item.held_at)}
                      </dd>
                    </div>
                  )}
                </dl>
                {hasBody ? (
                  <RichBody body={body} />
                ) : intro ? (
                  <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec md:text-body-d">
                    {intro}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-12 pt-4">
                  {item.site_url && (
                    <Button variant="secondary" href={item.site_url} external arrow={false}>
                      {exhibitionSiteLabel(item.semester_label) || t('actions.exhibitionSite')}
                    </Button>
                  )}
                  <ShareButton title={item.title} />
                </div>
              </div>
            </div>
            {galleries.map((g) => (
              <GallerySection
                key={g.label}
                label={g.label}
                images={g.images}
                title={item.title}
              />
            ))}
          </article>
        )}
    </Container>
  )
}

export default ExhibitionDetail
