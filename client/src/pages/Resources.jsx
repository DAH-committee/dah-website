// /resources — 자료실 (KPC 게시판 문법 + 첨부 다운로드 링크)
// API: GET /content/resource?page=&q= — 정적 폴백 데이터 없음(빈 상태 P6).
import { useState } from 'react'
import PageBanner from '../components/layout/PageBanner'
import Container from '../components/layout/Container'
import BoardList from '../components/board/BoardList'
import InlineEditBar from '../components/content/InlineEditBar'
import { useApi } from '../hooks/useApi'
import { useTitle } from '../hooks/useTitle'
import { useLang } from '../i18n/LangContext'

const PAGE_SIZE = 10

const MAJOR_COMPASS = {
  id: 'major-compass',
  no: '—',
  tag: '전공 소개',
  title: '2026 자유전공학부 전공 나침반 | 디지털인문예술전공',
  author: '디지털인문예술전공',
  date: '2026-09-21',
  pinned: true,
  to: '/resources/major-compass',
}

function toRow(post, no, isEn) {
  return {
    id: post.id,
    no,
    tag: post.tag ?? null,
    title: (isEn && post.title_en) || post.title_ko || post.title,
    author: post.author ?? null,
    date: post.date ?? (post.created_at ?? '').slice(0, 10) ?? null,
    pinned: Boolean(post.pinned),
    // N1-1: 자료실 행 → 내부 상세 진입(/resources/:id). 첨부·미리보기·다운로드는 상세에서만.
    to: `/resources/${post.id}`,
  }
}

function Resources() {
  const { lang, t } = useLang()
  const isEn = lang === 'en'
  useTitle(t('titles.resources'))
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error, offline } = useApi('/content/resource', {
    params: { page, q: q || undefined },
  })

  const remoteTotal = data?.total ?? 0
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const remoteRows = (data?.items ?? []).map((post, idx) =>
    toRow(post, remoteTotal - (page - 1) * pageSize - idx, isEn)
  )
  const includeCompass = page === 1 && (!q || MAJOR_COMPASS.title.includes(q))
  const rows = includeCompass ? [MAJOR_COMPASS, ...remoteRows] : remoteRows
  // CMS 게시물 수와 페이지네이션은 서버 값만 사용한다. 고정 소개 자료는 첫 페이지의 안내 행이다.
  const total = remoteTotal

  const statusText = loading && !includeCompass
    ? t('common.loading')
    : rows.length === 0
      ? error && !offline
        ? t('common.error')
        : t('common.empty')
      : null

  return (
    <>
      <PageBanner
        titleKo="자료실"
        titleEn="RESOURCES"
        breadcrumb={[{ label: t('nav.home'), to: '/' }, { label: t('titles.resources'), to: '/resources' }]}
        nebulaX="28%"
        nebulaY="22%"
      />
      <Container as="section" className="py-section-m lg:py-section-d">
        {offline && (
          <p className="mb-16 font-mono text-caption-m text-text-meta">
            {t('common.offline')}
          </p>
        )}
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
          searchPlaceholder={t('news.resourceSearchPlaceholder')}
          statusText={statusText}
          actions={
            <InlineEditBar
              type="resource"
              addTo="/admin/posts/resource/new"
              manageTo="/admin/posts/resource"
            />
          }
        />
      </Container>
    </>
  )
}

export default Resources
