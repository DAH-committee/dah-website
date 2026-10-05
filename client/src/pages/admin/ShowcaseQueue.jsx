// ShowcaseQueue.jsx — 쇼케이스 승인 큐 (13_CMS_SPEC 1절 T3, manager+)
// pending 승인(PUT status=published)·반려(삭제) + published 회수(재승인 큐).
// B1 계약: status는 pending|published 2종 — 반려는 삭제로 처리(별도 rejected 상태 없음).

import { useState } from 'react'
import { Check, ExternalLink, RotateCcw, Trash2 } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import {
  EmptyNote,
  ErrorText,
  PageHead,
  Pagination,
} from '../../components/admin/FormControls'
import { confirmDialog } from '../../components/common/AppDialog'

const PILL_BTN =
  'inline-flex cursor-pointer items-center gap-8 rounded-sm border border-glass-line bg-glass-bg px-12 py-4 font-mono text-caption-m text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus'

const TABS = [
  { key: 'pending', label: '승인 대기' },
  { key: 'published', label: '게시 중' },
]

function ShowcaseQueue() {
  useTitle('웹&앱 쇼케이스')
  const [tab, setTab] = useState('pending')
  const [page, setPage] = useState(1)
  const { data, loading, error, offline, refetch } = useApi('/admin/content/showcase', {
    params: { status: tab, page, pageSize: 12 },
  })
  const [actionError, setActionError] = useState(null)

  const items = data?.items || []
  const total = data?.total ?? items.length
  const pageSize = data?.pageSize || 12

  const setStatus = async (item, status) => {
    setActionError(null)
    try {
      await api.put(`/admin/content/showcase/${item.id}`, { status })
      refetch()
    } catch (err) {
      setActionError(err.hint ? `${err.message} (${err.hint})` : err.message)
    }
  }

  // 반려 = 삭제. B1 권한: showcase 삭제는 admin+ (manager는 서버가 403 반환)
  const reject = async (item) => {
    if (!await confirmDialog({ message: '반려하시겠습니까? 제출물이 삭제되며 되돌릴 수 없습니다.', tone: 'danger', confirmLabel: '삭제' })) return
    setActionError(null)
    try {
      await api.del(`/admin/content/showcase/${item.id}`)
      refetch()
    } catch (err) {
      setActionError(err.hint ? `${err.message} (${err.hint})` : err.message)
    }
  }

  return (
    <section className="flex flex-col gap-24">
      <PageHead title="웹&앱 쇼케이스" desc="pending 제출물 승인·반려" offline={offline} />

      <div role="tablist" aria-label="쇼케이스 상태" className="flex items-center gap-8">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key)
              setPage(1)
            }}
            className={`inline-flex cursor-pointer items-center rounded-sm border px-16 py-8 text-body-m transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
              tab === t.key
                ? 'border-glass-line bg-glass-strong text-text-pri'
                : 'border-border-subtle text-text-sec hover:text-text-pri'
            }`}
          >
            {t.label}
          </button>
        ))}
        <p className="ml-8 font-mono text-caption-m text-text-meta">총 {total}건</p>
      </div>

      {error && <ErrorText>{error.message}</ErrorText>}
      <ErrorText>{actionError}</ErrorText>
      {loading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
      {!loading && !items.length && (
        <EmptyNote>
          {tab === 'pending' ? '대기 중인 제출물이 없습니다' : '게시 중인 항목이 없습니다'}
        </EmptyNote>
      )}

      {items.length > 0 && (
        <ul className="grid grid-cols-1 gap-16 md:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col gap-12 rounded-glass border border-glass-line bg-glass-bg p-16 backdrop-blur-glass-mobile"
            >
              {item.main_img && (
                <img
                  src={item.main_img}
                  alt={`${item.title} 메인 이미지`}
                  loading="lazy"
                  className="aspect-video w-full rounded-md border border-border-subtle bg-bg-elev object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-body-m font-semibold text-text-pri md:text-body-d">
                  {item.title}
                </p>
                <p className="mt-4 truncate font-mono text-caption-m text-text-meta">
                  {[item.creator, item.topic, item.semester_label].filter(Boolean).join(' · ')}
                </p>
                {item.description && (
                  <p className="mt-8 text-small-m leading-relaxed text-text-sec">
                    {item.description}
                  </p>
                )}
                {Array.isArray(item.tools) && item.tools.length > 0 && (
                  <p className="mt-8 font-mono text-caption-m text-text-meta">
                    {item.tools.join(' · ')}
                  </p>
                )}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-8 border-t border-border-subtle pt-12">
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={PILL_BTN}
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    링크
                  </a>
                )}
                {item.status === 'pending' ? (
                  <>
                    <button type="button" onClick={() => setStatus(item, 'published')} className={PILL_BTN}>
                      <Check size={16} aria-hidden="true" />
                      승인
                    </button>
                    <button type="button" onClick={() => reject(item)} className={PILL_BTN}>
                      <Trash2 size={16} aria-hidden="true" />
                      반려
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setStatus(item, 'pending')} className={PILL_BTN}>
                      <RotateCcw size={16} aria-hidden="true" />
                      큐로 회수
                    </button>
                    <button type="button" onClick={() => reject(item)} className={PILL_BTN}>
                      <Trash2 size={16} aria-hidden="true" />
                      삭제
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </section>
  )
}

export default ShowcaseQueue
