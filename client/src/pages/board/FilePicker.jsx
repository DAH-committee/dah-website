// 우리 파일 고르기: 내 DAH Docs·Sheet·Form·Slides·Board 목록에서 하나를 골라 보드에 카드로 놓는다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { api } from '../../hooks/useApi'
import { FILE_META } from './BoardItem'

const TABS = [
  { id: 'doc', label: '문서' },
  { id: 'sheet', label: '스프레드시트' },
  { id: 'form', label: '설문지' },
  { id: 'slide', label: '프레젠테이션' },
  { id: 'board', label: '보드' },
]

async function loadList(kind) {
  if (kind === 'form') {
    const r = await api.get('/admin/forms')
    return (r.items || []).map((f) => ({ key: `form-${f.id}`, kind: 'form', fileId: f.id, title: f.title_ko || '제목 없는 설문지', when: f.updated_at || f.created_at }))
  }
  const r = await api.get('/workspace/files', { kind })
  return (r.items || [])
    .filter((f) => kind !== 'doc' || f.first_tab)
    .map((f) => ({ key: `${kind}-${f.id}`, kind, fileId: f.id, tabId: f.first_tab || null, title: f.title || '제목 없음', when: f.updated_at }))
}

export default function FilePicker({ onPick, onClose, excludeBoardId = null }) {
  const [tab, setTab] = useState('doc')
  const [lists, setLists] = useState({})
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const panel = useRef(null)

  useEffect(() => {
    setError('')
    if (lists[tab]) return
    let live = true
    loadList(tab)
      .then((items) => live && setLists((m) => ({ ...m, [tab]: tab === 'board' ? items.filter((f) => f.fileId !== excludeBoardId) : items })))
      .catch((e) => {
        if (!live) return
        if (e.status === 401) setError('로그인하면 내 파일을 고를 수 있습니다')
        else if (tab === 'slide' && (e.status === 400 || e.status === 404)) setError('프레젠테이션 목록을 아직 불러올 수 없습니다')
        else setError(e.message)
      })
    return () => {
      live = false
    }
  }, [tab, lists, excludeBoardId])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    panel.current?.querySelector('input')?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const shown = useMemo(() => {
    const list = lists[tab] || []
    const s = q.trim().toLowerCase()
    return s ? list.filter((f) => f.title.toLowerCase().includes(s)) : list
  }, [lists, tab, q])

  return (
    <div className="bd-modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="bd-modal__panel" role="dialog" aria-modal="true" aria-label="우리 파일 넣기">
        <div className="bd-modal__head">
          <h2>우리 파일 넣기</h2>
          <button type="button" className="bd-icon-btn" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="bd-tabs bd-tabs--wrap" role="tablist">
          {TABS.map((t) => {
            const Icon = FILE_META[t.id].Icon
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="bd-tab" onClick={() => setTab(t.id)}>
                <Icon size={20} />
                {t.label}
              </button>
            )
          })}
        </div>
        <label className="bd-search-field">
          <Search size={16} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목으로 찾기" aria-label="제목으로 찾기" />
        </label>
        <div className="bd-modal__list">
          {error && <p className="bd-modal__note">{error}</p>}
          {!error && !lists[tab] && <p className="bd-modal__note">불러오는 중</p>}
          {!error && lists[tab] && !shown.length && <p className="bd-modal__note">{q ? '찾는 파일이 없습니다' : '아직 파일이 없습니다'}</p>}
          {shown.map((f) => {
            const Icon = FILE_META[f.kind].Icon
            return (
              <button key={f.key} type="button" className="bd-modal__row" onClick={() => onPick(f)}>
                <Icon size={28} />
                <span className="bd-modal__title">{f.title}</span>
                {f.when && <span className="bd-modal__when">{new Date(f.when).toLocaleDateString('ko-KR')}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
