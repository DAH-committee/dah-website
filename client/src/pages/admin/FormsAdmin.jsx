// FormsAdmin.jsx: 행사 설정, 자체 폼 목록 (39_FORM_BUILDER P1-2)
// 제목, 분류, 접수 기간, 공개 상태, 응답 수를 한 줄에 보여주고 편집기와 응답 시트로 보낸다.
// 응답 시트(/admin/forms/:id/responses/sheet)는 전체화면 라우트라 새 탭으로 연다.

import { Link } from 'react-router-dom'
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { formatKst } from '../submit/exhibitFormShared'
import { EmptyNote, ErrorText, PageHead } from '../../components/admin/FormControls'
import { CATEGORY_LABEL } from './FormEditor'

const ICON_LINK =
  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-32 md:w-32'

const NEW_LINK =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border border-border-subtle px-24 text-body-m font-semibold text-text-pri transition duration-fast ease-out hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus'

/** 접수 기간 한 줄. 한쪽만 있어도 그대로 보여준다 */
function periodOf(settings) {
  const start = formatKst(settings?.accept_start)
  const end = formatKst(settings?.accept_end)
  if (!start && !end) return '접수 기간 미설정'
  return `${start || '시작 미설정'} ~ ${end || '마감 미설정'}`
}

function FormsAdmin() {
  useTitle('행사 설정')
  const { data, loading, error, offline, refetch } = useApi('/admin/forms')
  const items = data?.items || []

  const remove = async (item) => {
    if (!window.confirm(`"${item.title_ko}" 폼을 삭제하시겠습니까? 응답도 함께 삭제됩니다.`)) return
    try {
      await api.del(`/admin/forms/${item.id}`)
      refetch()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title="행사 설정"
        desc="행사 신청, 부원 모집 등 자체 폼을 만들고 응답을 관리합니다"
        offline={offline}
        actions={
          <a href="/admin/forms/new" target="_blank" rel="noopener noreferrer" className={NEW_LINK}>
            <Plus size={16} aria-hidden="true" />
            폼 만들기
          </a>
        }
      />

      {error && <ErrorText>{error.message}</ErrorText>}
      {loading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
      {!loading && !items.length && <EmptyNote>등록된 폼이 없습니다</EmptyNote>}

      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-wrap items-center gap-12 border-b border-border-subtle py-12 transition duration-fast ease-out first:border-t hover:bg-bg-elev"
            >
              <span className="w-48 shrink-0 font-mono text-caption-m text-text-meta">
                {CATEGORY_LABEL[item.category] || CATEGORY_LABEL.other}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  to={`/admin/forms/${item.id}/edit`}
                  className="block truncate text-body-m text-text-pri underline-offset-4 hover:underline md:text-body-d"
                >
                  {item.title_ko}
                </Link>
                <span className="block font-mono text-caption-m text-text-meta">
                  {periodOf(item.settings)}
                </span>
              </span>
              <span className="font-mono text-caption-m text-text-meta">
                {item.published ? '공개' : '비공개'}
              </span>
              <span className="font-mono text-caption-m text-text-meta">
                응답 {item.response_count ?? 0}
              </span>
              <a
                href={`/admin/forms/${item.id}/responses/sheet`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${item.title_ko} 응답 보기`}
                className={ICON_LINK}
              >
                <ExternalLink size={16} />
              </a>
              <Link
                to={`/admin/forms/${item.id}/edit`}
                aria-label={`${item.title_ko} 수정`}
                className={ICON_LINK}
              >
                <Pencil size={16} />
              </Link>
              <button
                type="button"
                onClick={() => remove(item)}
                aria-label={`${item.title_ko} 삭제`}
                className={ICON_LINK}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default FormsAdmin
