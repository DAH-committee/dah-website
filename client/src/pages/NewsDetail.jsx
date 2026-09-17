// /news/:id — 공지 상세
import { useParams } from 'react-router-dom'
import { Download, ExternalLink, Paperclip } from 'lucide-react'
import PageBanner from '../components/layout/PageBanner'
import Container from '../components/layout/Container'
import ShareButton from '../components/common/ShareButton'
import Button from '../components/common/Button'
import RichBody from '../components/content/RichBody'
import { EditPencil } from '../components/content/EditControls'
import { useApi, itemOf } from '../hooks/useApi'
import { useSeo, plainText } from '../hooks/useSeo'
import { breadcrumbJsonLd, SITE_NAME } from '../data/seo'
import { useLang, KoreanOnlyBadge } from '../i18n/LangContext'
import { notices } from '../data/notices'
import { majorCompassNotice } from '../data/majorCompass'

const ATTACH_LINK =
  'inline-flex min-h-11 items-center gap-4 rounded-sm border border-border-subtle bg-bg-base px-12 py-8 text-caption-m text-text-sec transition duration-fast ease-out hover:border-border-strong hover:bg-glass-strong hover:text-text-pri md:min-h-0'
const canPreview = (file) => /\.(pdf|jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(file.name || file.url)

function AttachmentRow({ file, t }) {
  return (
    <div className="flex min-w-0 flex-col gap-12 border-t border-border-subtle py-16 md:flex-row md:items-center md:justify-between">
      <span className="inline-flex min-w-0 items-center gap-8 text-small-m text-text-pri md:text-small-d">
        <Paperclip size={16} aria-hidden="true" className="shrink-0 text-text-meta" />
        <span className="truncate">{file.name || file.url.split('/').pop()}</span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center gap-8">
        {canPreview(file) ? (
          <a href={file.url} target="_blank" rel="noopener noreferrer" className={ATTACH_LINK}>
            <ExternalLink size={12} aria-hidden="true" />
            {t('news.preview')}
          </a>
        ) : <span className="font-mono text-caption-m text-text-meta">{t('news.previewUnavailable')}</span>}
        <a href={file.url} download className={ATTACH_LINK}>
          <Download size={12} aria-hidden="true" />
          {t('news.download')}
        </a>
      </span>
    </div>
  )
}

function NewsDetail() {
  const { id } = useParams()
  const { lang, t } = useLang()
  const isMajorCompass = id === majorCompassNotice.id
  const { data, loading, offline } = useApi(isMajorCompass ? null : `/content/notice/${id}`)

  const fallback = isMajorCompass ? majorCompassNotice : offline ? notices.find((n) => n.id === id) : null
  const post = isMajorCompass ? majorCompassNotice : itemOf(data) ?? fallback

  // R1(27_I18N): EN 모드는 영문 필드 우선(공지는 영문 선택 — 없으면 국문 폴백 + Korean only 뱃지)
  const isEn = lang === 'en'
  const title = (isEn && post?.title_en) || post?.title_ko || post?.title || ''
  const body = isEn && post?.body_en ? post.body_en : post?.body
  const koFallback = isEn && (!post?.title_en || !post?.body_en)
  const departmentName = isEn
    ? 'Digital Arts & Humanities, Hallym University'
    : '한림대학교 디지털인문예술전공'
  const tag = post?.tag ?? post?.org ?? null
  const date = post?.date ?? (post?.created_at ?? '').slice(0, 10)
  const attachments = (post?.attachments ?? post?.files ?? []).filter((f) => f && f.url)
  // K2-3 데이터 계약: posts.gallery = 이미지 URL 배열 → 본문 아래 갤러리
  const gallery = (Array.isArray(post?.gallery) ? post.gallery : []).filter(Boolean)
  useSeo({
    title: title ? `${title} | ${departmentName}${isEn ? ' — Notices' : ''}` : undefined,
    description: post
      ? plainText(body) || (isEn ? `${title} is a notice from ${departmentName}.` : `${title} 관련 ${departmentName} 공지사항입니다.`)
      : null,
    image: post?.poster_url,
    jsonLd: post ? [
      {
        '@context': 'https://schema.org', '@type': 'Article', headline: title,
        datePublished: date || undefined, dateModified: (post.updated_at || '').slice(0, 10) || undefined,
        image: post.poster_url || undefined,
        publisher: { '@type': 'EducationalOrganization', name: SITE_NAME },
      },
      breadcrumbJsonLd([
        { name: t('nav.home'), path: '/' }, { name: t('titles.notices'), path: '/news' },
        { name: title || t('actions.detail'), path: `/news/${id}` },
      ]),
    ] : null,
  })

  return (
    <>
      <PageBanner
        titleKo="공지사항"
        titleEn="NEWS"
        breadcrumb={[
          { label: t('nav.home'), to: '/' },
          { label: t('titles.notices'), to: '/news' },
          { label: title || t('actions.detail') },
        ]}
        nebulaX="72%"
        nebulaY="18%"
      />
      <Container as="section" className="py-section-m lg:py-section-d">
        {loading && !isMajorCompass ? (
          <p className="py-64 font-mono text-caption-m text-text-meta">{t('common.loading')}</p>
        ) : !post ? (
          <div className="flex flex-col items-start gap-24 py-64">
            <p className="font-mono text-caption-m text-text-meta">{t('common.notFound')}</p>
            <Button variant="secondary" href="/news">
              {t('common.backToList')}
            </Button>
          </div>
        ) : (
          <article className="mx-auto flex min-w-0 max-w-container flex-col gap-24">
            <div className="flex flex-wrap items-center gap-12">
              {koFallback && <KoreanOnlyBadge />}
              {!isMajorCompass && <EditPencil type="notice" to={`/admin/posts/notice/${id}/edit`} />}
            </div>

            <div className="rounded-glass border border-glass-line bg-bg-elev p-24 shadow-glass md:p-40 lg:p-48">
              <header className="border-b border-border-subtle pb-24 md:pb-32">
                <h1 className="max-w-4xl text-h1-m font-bold leading-snug text-text-pri md:text-h1-d">
                  {title}
                </h1>
                <div className="mt-16 flex flex-wrap items-center gap-12 text-small-m text-text-meta md:text-small-d">
                  {date && (
                    <time dateTime={date}>
                      {t('news.registered')} {date}
                    </time>
                  )}
                  {tag && (
                    <span className="inline-flex items-center rounded-sm border border-border-subtle bg-bg-panel px-8 py-2 text-caption-m text-text-sec">
                      {tag}
                    </span>
                  )}
                </div>
                {attachments.length > 0 && (
                  <div className="mt-20">
                    {attachments.map((file) => (
                      <AttachmentRow key={file.url} file={file} t={t} />
                    ))}
                  </div>
                )}
              </header>

              {post.poster_url && (
                <figure className="mt-32 overflow-hidden rounded-md border border-border-subtle bg-bg-panel md:mt-40">
                  <img
                    src={post.poster_url}
                    alt={post.poster_alt || `${title} 썸네일`}
                    className="aspect-video w-full object-cover"
                  />
                </figure>
              )}

              {body ? (
                <div className="max-w-4xl pt-32 md:pt-40">
                  <RichBody body={body} />
                  {isMajorCompass && (
                    <div className="mt-32">
                      <Button variant="primary" href="/major-compass">
                        인터랙티브 전공소개 시작하기
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="pt-32 text-body-l-m leading-relaxed text-text-meta md:text-body-l-d">
                  {t('news.noBody')}
                </p>
              )}

              {/* K2-3: 이미지 갤러리 — 본문 아래 그리드, 원본은 새 탭 */}
              {gallery.length > 0 && (
                <ul className="mt-32 grid grid-cols-2 gap-12 md:grid-cols-3 md:gap-16">
                  {gallery.map((url, i) => (
                    <li key={url} className="min-w-0">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block overflow-hidden rounded-md border border-border-subtle bg-bg-panel"
                      >
                        <img
                          src={url}
                          alt={`${title} 이미지 ${i + 1}`}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover transition-opacity duration-fast ease-out group-hover:opacity-90"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-16 border-t border-border-subtle pt-32">
              <Button variant="secondary" href="/news">
                {t('common.backToList')}
              </Button>
              <ShareButton title={title} />
            </footer>
          </article>
        )}
      </Container>
    </>
  )
}

export default NewsDetail
