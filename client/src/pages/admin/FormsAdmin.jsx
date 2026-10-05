// FormsAdmin.jsx: 신청 폼 관리, 자체 폼 목록 (39_FORM_BUILDER P1-2)
//
// 기준: 개발을 모르는 운영진이 목록만 보고 "지금 신청이 열려 있나, 몇 명이 냈나"를 바로 안다.
//   1) 폼마다 상태 한 단어(접수 중, 접수 예정, 접수 마감, 비공개, 기간 미설정)를 색으로 보여준다.
//   2) 버튼은 아이콘이 아니라 글자로 쓴다. 자주 쓰는 수정과 응답 보기는 바로 보이고, 나머지는 더보기에 둔다.
//   3) 응답 시트(/admin/forms/:id/responses/sheet)는 전체화면 라우트라 새 탭으로 연다.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, EllipsisVertical, Link as LinkIcon, Pencil, Plus, Table2, Trash2 } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { formatKst } from '../submit/exhibitFormShared'
import { EmptyNote, ErrorText, PageHead } from '../../components/admin/FormControls'
import { CATEGORY_LABEL } from './FormEditor'
import { formStatus } from './formStatus'
import { alertDialog, confirmDialog } from '../../components/common/AppDialog'

const NEW_LINK =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm bg-button-primary px-24 text-body-m font-semibold text-button-primaryText transition duration-fast ease-out hover:bg-button-primaryHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus'

const ROW_BTN =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border border-border-subtle px-16 text-small-m font-semibold text-text-pri transition duration-fast ease-out hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus'

const TONE = {
  ok: 'border-purple-primary text-purple-light',
  warn: 'border-state-error text-state-error',
  info: 'border-border-purple text-text-pri',
  muted: 'border-border-subtle text-text-meta',
}

/** 접수 기간 한 줄. 한쪽만 있어도 그대로 보여준다 */
function periodOf(settings) {
  const start = formatKst(settings?.accept_start)
  const end = formatKst(settings?.accept_end)
  if (!start && !end) return '접수 기간 미설정'
  return `${start || '시작 미정'} 부터 ${end || '마감 미정'} 까지`
}

/** 더보기 메뉴: 복사본 만들기, 주소 복사, 삭제 */
function RowMenu({ item, onCopyForm, onCopyLink, onRemove, busy }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const key = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const entry =
    'flex h-11 w-full cursor-pointer items-center gap-12 px-16 text-left text-small-m text-text-pri transition hover:bg-glass-strong disabled:cursor-default disabled:opacity-40'
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`${item.title_ko} 더보기`} onClick={() => setOpen((v) => !v)} className={`${ROW_BTN} !px-12`}>
        <EllipsisVertical size={16} aria-hidden="true" />
        <span className="hidden sm:inline">더보기</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-20 w-[220px] overflow-hidden rounded-md border border-border-subtle bg-bg-panel shadow-card-glow">
          <button type="button" role="menuitem" disabled={busy} className={entry} onClick={() => { setOpen(false); onCopyForm(item) }}>
            <Copy size={16} aria-hidden="true" /> 복사본 만들기
          </button>
          <button type="button" role="menuitem" className={entry} onClick={() => { setOpen(false); onCopyLink(item) }}>
            <LinkIcon size={16} aria-hidden="true" /> 신청 주소 복사
          </button>
          <button type="button" role="menuitem" className={`${entry} !text-state-error`} onClick={() => { setOpen(false); onRemove(item) }}>
            <Trash2 size={16} aria-hidden="true" /> 삭제
          </button>
        </div>
      )}
    </div>
  )
}

function FormsAdmin() {
  useTitle('신청 폼 관리')
  const navigate = useNavigate()
  const { data, loading, error, offline, refetch } = useApi('/admin/forms')
  const items = data?.items || []
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const remove = async (item) => {
    const n = item.response_count ?? 0
    const warn = n
      ? `"${item.title_ko}" 폼을 삭제할까요?\n받은 응답 ${n}건도 함께 지워지고 되돌릴 수 없습니다.`
      : `"${item.title_ko}" 폼을 삭제할까요? 되돌릴 수 없습니다.`
    if (!(await confirmDialog({ message: warn, tone: 'danger', confirmLabel: '삭제' }))) return
    try {
      await api.del(`/admin/forms/${item.id}`)
      setMessage(`"${item.title_ko}" 폼을 삭제했습니다`)
      refetch()
    } catch (err) {
      await alertDialog({ title: '오류', message: err.message })
    }
  }

  // 질문과 설정을 그대로 복사한다. 응답은 복사하지 않고, 실수로 공개되지 않게 비공개로 만든다.
  const copyForm = async (item) => {
    setBusy(true)
    try {
      const { item: full } = await api.get(`/admin/forms/${item.id}`)
      const suffix = Date.now().toString(36).slice(-4)
      const res = await api.post('/admin/forms', {
        slug: `${full.slug}-copy-${suffix}`,
        title_ko: `${full.title_ko} (복사본)`,
        title_en: full.title_en || '',
        description_ko: full.description_ko || '',
        description_en: full.description_en || '',
        category: full.category,
        fields: full.fields,
        settings: full.settings,
        published: false,
      })
      navigate(`/admin/forms/${res.item.id}/edit`, { state: { justSaved: true } })
    } catch (err) {
      await alertDialog({ title: '오류', message: err.hint ? `${err.message} (${err.hint})` : err.message })
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async (item) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/forms/${item.slug}`)
      setMessage('신청 주소를 복사했습니다')
    } catch {
      await alertDialog({ message: `복사하지 못했습니다. 주소: ${window.location.origin}/forms/${item.slug}` })
    }
  }

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title="신청 폼 관리"
        offline={offline}
        actions={
          <Link to="/admin/forms/new" className={NEW_LINK}>
            <Plus size={16} aria-hidden="true" />
            새 폼 만들기
          </Link>
        }
      />

      {message && (
        <p role="status" className="rounded-sm border border-border-purple bg-glass-bg p-12 text-small-m font-semibold text-text-pri">
          {message}
        </p>
      )}
      {error && <ErrorText>{error.message}</ErrorText>}
      {loading && <p className="text-small-m text-text-meta">불러오는 중</p>}
      {!loading && !items.length && <EmptyNote>신청 폼 없음</EmptyNote>}

      {items.length > 0 && (
        <ul className="flex flex-col gap-12">
          {items.map((item) => {
            const st = formStatus(item.published, item.settings)
            return (
              <li key={item.id} className="flex min-w-0 flex-col gap-16 rounded-md border border-border-subtle bg-bg-panel p-20 transition duration-fast ease-out hover:border-border-strong md:flex-row md:items-center md:justify-between md:p-24">
                <div className="flex min-w-0 flex-col gap-8">
                  <div className="flex flex-wrap items-center gap-8">
                    <span className={`inline-flex h-32 items-center rounded-sm border px-12 text-small-m font-bold ${TONE[st.tone]}`}>{st.label}</span>
                    <span className="text-small-m text-text-meta">{CATEGORY_LABEL[item.category] || CATEGORY_LABEL.other}</span>
                    <span className="text-small-m font-semibold text-text-sec">응답 {item.response_count ?? 0}건</span>
                  </div>
                  <Link to={`/admin/forms/${item.id}/edit`} className="min-w-0 break-words text-body-l-m font-bold text-text-pri underline-offset-4 hover:underline md:text-body-l-d">
                    {item.title_ko}
                  </Link>
                  <p className="text-small-m text-text-meta">{periodOf(item.settings)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-8">
                  <Link to={`/admin/forms/${item.id}/edit`} className={ROW_BTN}>
                    <Pencil size={16} aria-hidden="true" /> 수정
                  </Link>
                  <a href={`/admin/forms/${item.id}/responses/sheet`} target="_blank" rel="noopener noreferrer" className={ROW_BTN}>
                    <Table2 size={16} aria-hidden="true" /> 응답 보기
                  </a>
                  <RowMenu item={item} busy={busy} onCopyForm={copyForm} onCopyLink={copyLink} onRemove={remove} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default FormsAdmin
