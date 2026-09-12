// PostList.jsx — /admin/posts/:type 공용 리스트 (13_CMS_SPEC 6절)
// 검색 + 페이지네이션(KPC 게시판 문법) + published 토글 + 수정·삭제.

import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { DragHandle, useDragSort } from '../../components/common/DragHandle'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import {
  EmptyNote,
  ErrorText,
  GhostButton,
  Input,
  PageHead,
  Pagination,
  Toggle,
} from '../../components/admin/FormControls'
import { POST_TYPES, metaOf, titleOf } from './postTypes'

const ICON_LINK =
  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-32 md:w-32'

function PostList() {
  const { type } = useParams()
  const config = POST_TYPES[type]
  useTitle(config ? `${config.label} 관리` : '콘텐츠 관리')

  const [keyword, setKeyword] = useState('')
  const [q, setQ] = useState('')
  // 페이지 번호는 URL이 원본이다. 상세 편집 후 뒤로 나오면 브라우저가 ?page=2를 되돌려주므로
  // 컴포넌트가 재마운트돼도 보던 페이지가 유지된다(state로 들고 있으면 매번 1로 초기화됐다).
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1)
  const setPage = (p) => setSearchParams(p > 1 ? { page: String(p) } : {})
  // Y3-4(33_PHASE18): 정렬 모드. 페이지 경계를 넘는 재정렬은 sort 값이 어긋나므로
  // 정렬 중에는 1페이지에 전량(100건)을 올려 놓고 조작한다.
  const [sorting, setSorting] = useState(false)

  const { data, loading, error, offline, refetch } = useApi(
    config ? `/admin/content/${type}` : null,
    { params: sorting ? { q, page: 1, pageSize: 100 } : { q, page } }
  )

  const [rows, setRows] = useState([])
  useEffect(() => {
    setRows(data?.items || (Array.isArray(data) ? data : []))
  }, [data])

  // 같은 그룹(성과=연도 tag, 동아리=유형 전체) 안에서만 이동. 저장은 그룹 sort 0..N 재부여.
  const { dragIndex, overIndex, rowProps } = useDragSort((from, to) => {
    const moved = rows[from]
    const target = rows[to]
    if (!moved || !target) return
    const scoped = config?.sortScope === 'tag'
    if (scoped && (moved.tag ?? null) !== (target.tag ?? null)) return
    const inScope = (r) => !scoped || (r.tag ?? null) === (moved.tag ?? null)

    const next = [...rows]
    next.splice(from, 1)
    next.splice(to, 0, moved)
    let seq = 0
    const withSort = next.map((r) => (inScope(r) ? { ...r, sort: seq++ } : r))
    const prevSort = new Map(rows.map((r) => [r.id, r.sort]))
    setRows(withSort)
    withSort.forEach((r) => {
      if (inScope(r) && prevSort.get(r.id) !== r.sort) {
        api.put(`/admin/content/${type}/${r.id}`, { sort: r.sort }).catch(() => {})
      }
    })
  })

  if (!config) {
    return <EmptyNote>알 수 없는 콘텐츠 유형입니다</EmptyNote>
  }

  const items = rows
  const total = data?.total ?? items.length
  const pageSize = data?.pageSize || 10

  const search = (e) => {
    e.preventDefault()
    setPage(1)
    setQ(keyword.trim())
  }

  const togglePublished = async (item) => {
    try {
      await api.put(`/admin/content/${type}/${item.id}`, { published: !item.published })
      refetch()
    } catch (err) {
      window.alert(err.message)
    }
  }

  const remove = async (item) => {
    if (!window.confirm('삭제하시겠습니까? 되돌릴 수 없습니다.')) return
    try {
      await api.del(`/admin/content/${type}/${item.id}`)
      refetch()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title={config.label}
        offline={offline}
        actions={
          <>
            {config.sortable && (
              <GhostButton onClick={() => setSorting((s) => !s)} aria-pressed={sorting}>
                <ArrowUpDown size={16} aria-hidden="true" />
                {sorting ? '정렬 완료' : '정렬'}
              </GhostButton>
            )}
            <Link
            to={`/admin/posts/${type}/new`}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border border-border-subtle px-24 text-body-m font-semibold text-text-pri transition duration-fast ease-out hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <Plus size={16} aria-hidden="true" />
            추가
            </Link>
          </>
        }
      />

      {sorting && (
        <p className="font-mono text-caption-m text-text-meta">
          {config.sortScope === 'tag'
            ? '핸들을 끌어 같은 연도 안에서 순서를 바꿉니다. 다른 연도로는 이동하지 않습니다.'
            : '핸들을 끌어 순서를 바꿉니다.'}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-16">
        <p className="font-mono text-caption-m text-text-meta">총 {total}건</p>
        <form onSubmit={search} className="flex min-w-0 items-center gap-8">
          <Input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색어"
            aria-label="검색어"
            className="max-w-xs"
          />
          <GhostButton type="submit" aria-label="검색">
            <Search size={16} />
          </GhostButton>
        </form>
      </div>

      {error && <ErrorText>{error.message}</ErrorText>}
      {loading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
      {!loading && !items.length && <EmptyNote />}

      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((item, index) => (
            <li
              key={item.id}
              className={`flex min-w-0 items-center gap-12 border-b border-border-subtle py-12 transition duration-fast ease-out first:border-t hover:bg-bg-elev ${
                dragIndex === index ? 'opacity-40' : ''
              } ${
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? 'bg-glass-bg'
                  : ''
              }`}
              {...(sorting ? rowProps(index) : {})}
            >
              {sorting && <DragHandle />}
              <span className="w-96 shrink-0 font-mono text-caption-m text-text-meta">
                {metaOf(item)}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  to={`/admin/posts/${type}/${item.id}/edit`}
                  className="block truncate text-body-m text-text-pri underline-offset-4 hover:underline md:text-body-d"
                >
                  {titleOf(item)}
                </Link>
                {item.tag && (
                  <span className="font-mono text-caption-m text-text-meta">{item.tag}</span>
                )}
              </span>
              {'published' in item && (
                <Toggle
                  checked={Boolean(item.published)}
                  onChange={() => togglePublished(item)}
                  label={`${titleOf(item)} 게시 여부`}
                />
              )}
              <Link
                to={`/admin/posts/${type}/${item.id}/edit`}
                aria-label="수정"
                className={ICON_LINK}
              >
                <Pencil size={16} />
              </Link>
              <button
                type="button"
                onClick={() => remove(item)}
                aria-label="삭제"
                className={ICON_LINK}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!sorting && (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}
    </section>
  )
}

export default PostList
