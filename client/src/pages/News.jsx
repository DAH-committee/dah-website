// /news — 공지사항 (10_IA_V2 2절, KPC 게시판 문법)
// 태그 필터(대내/대외/공모전모집/특강모집) + 검색 + 페이지네이션, pinned 상단.
// API: GET /content/notice?tag=&page=&q= / offline 시 src/data/notices 정적 폴백.
import { useMemo, useState } from 'react'
import PageBanner from '../components/layout/PageBanner'
import Container from '../components/layout/Container'
import BoardList from '../components/board/BoardList'
import { AddButton } from '../components/content/EditControls'
import { useApi } from '../hooks/useApi'
import { useTitle } from '../hooks/useTitle'
import { useLang } from '../i18n/LangContext'
import { notices } from '../data/notices'
import { majorCompassNotice } from '../data/majorCompass'

// 필터 값(value)은 API 파라미터로 그대로 전송 — 알려진 태그는 표시명만 사전(news.tags.*) 조회,
// 그 외 서버 태그는 원문 그대로 표시.
// K1 데이터 계약: GET /tags → { items: ['태그명', …] }. 빈 배열·미응답이면 '전체'만 표시.
const KNOWN_TAG_KEYS = {
  대내: 'internal',
  대외: 'external',
  공모전모집: 'contest',
  특강모집: 'lecture',
}
const PAGE_SIZE = 10

// API 게시글 → 게시판 행
function toRow(post, no, isEn) {
  return {
    id: post.id,
    no,
    tag: post.tag ?? post.org ?? null,
    title: (isEn && post.title_en) || post.title_ko || post.title,
    author: post.author ?? null,
    date: post.date ?? (post.created_at ?? '').slice(0, 10) ?? null,
    pinned: Boolean(post.pinned),
    // G2: 전 항목 내부 상세 우선. external_url은 상세 페이지의 "원문 보기" 버튼으로만 노출.
    to: `/news/${post.id}`,
  }
}

function pinnedFirst(list) {
  return [...list].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
}

function News() {
  const { lang, t } = useLang()
  const isEn = lang === 'en'
  useTitle(t('titles.notices'))
  const [tag, setTag] = useState('전체')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error, offline } = useApi('/content/notice', {
    params: {
      page,
      q: q || undefined,
      tag: tag === '전체' ? undefined : tag,
    },
  })

  // 공개 태그 목록 — 서버 태그가 없으면 '전체'만
  const tagsRes = useApi('/tags')
  const serverTags = (
    Array.isArray(tagsRes.data?.items) ? tagsRes.data.items : []
  ).filter((v) => typeof v === 'string' && v)
  const tagDefs = [
    { value: '전체', key: 'all' },
    ...serverTags.map((value) => ({ value, key: KNOWN_TAG_KEYS[value] ?? null })),
  ]

  // 정적 폴백: 클라이언트 측 필터·검색·페이지네이션
  const fallback = useMemo(() => {
    let list = [...notices].sort((a, b) => b.date.localeCompare(a.date))
    if (tag !== '전체') list = list.filter((n) => (n.tag ?? n.org) === tag)
    if (q) {
      list = list.filter((n) => ((isEn && (n.title_en || n.titleEn)) || n.title).includes(q))
    }
    return list
  }, [isEn, tag, q])

  const useFallback = offline || (error && !data)
  const contentTotal = useFallback ? fallback.length : data?.total ?? 0
  const total = contentTotal + 1
  const pageSize = useFallback ? PAGE_SIZE : data?.pageSize ?? PAGE_SIZE
  const source = useFallback
    ? fallback.slice((page - 1) * pageSize, page * pageSize)
    : data?.items ?? []
  const noticeRows = pinnedFirst(source).map((post, idx) =>
    toRow(post, contentTotal - (page - 1) * pageSize - idx, isEn)
  )
  const includeCompass = page === 1 && tag === '전체' && (!q || majorCompassNotice.title.includes(q))
  const rows = includeCompass
    ? [toRow(majorCompassNotice, '—', isEn), ...noticeRows.slice(0, Math.max(pageSize - 1, 0))]
    : noticeRows

  const statusText = loading && !includeCompass
    ? t('common.loading')
    : rows.length === 0
      ? error && !useFallback
        ? t('common.error')
        : t('common.empty')
      : null

  return (
    <>
      <PageBanner
        titleKo="공지사항"
        titleEn="NEWS"
        breadcrumb={[
          { label: t('nav.home'), to: '/' },
          { label: t('titles.notices'), to: '/news' },
        ]}
        nebulaX="72%"
        nebulaY="18%"
      />
      <Container as="section" className="py-section-m lg:py-section-d">
        <div className="flex flex-wrap items-center justify-between gap-12">
          <div role="group" aria-label={t('aria.tagFilter')} className="flex flex-wrap gap-8">
            {tagDefs.map((def) => {
              const isActive = def.value === tag
              return (
                <button
                  key={def.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setTag(def.value)
                    setPage(1)
                  }}
                  className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-sm border px-12 py-4 font-mono text-caption-m transition-colors duration-fast ease-out ${
                    isActive
                      ? 'border-border-strong bg-glass-strong text-text-pri'
                      : 'border-border-subtle text-text-sec hover:border-border-strong hover:text-text-pri'
                  }`}
                >
                  {def.key ? t(`news.tags.${def.key}`) : def.value}
                </button>
              )
            })}
          </div>
        </div>
        {offline && (
          <p className="mt-16 font-mono text-caption-m text-text-meta">
            {t('common.offline')}
          </p>
        )}
        <div className="mt-32">
          <BoardList
            total={total}
            items={rows}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onSearch={(next) => {
              setQ(next)
              setPage(1)
            }}
            searchValue={q}
            searchPlaceholder={t('news.searchPlaceholder')}
            statusText={statusText}
            actions={<AddButton type="notice" to="/admin/posts/notice/new" />}
          />
        </div>
      </Container>
    </>
  )
}

export default News
