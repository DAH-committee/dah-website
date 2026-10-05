// /workspace/:kind (docs | sheets | forms): 문서·스프레드시트·설문지 홈.
// 구글 문서·시트·폼 홈과 같은 구조: 상단 바(햄버거, 제품 아이콘과 이름, 검색, 3종 전환, 계정)
// → 템플릿 띠 → 최근 항목(카드 격자 또는 목록, 정렬, 소유자 필터, 항목별 ⋮ 메뉴).
// 문서와 시트는 /workspace/files, 폼은 기존 /admin/forms를 쓴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowDownAZ, ChevronDown, ExternalLink, LayoutGrid, List, Menu, Pencil, Plus, Search, Table2, Trash2, X, Clock3, ListChecks } from 'lucide-react'
import { api } from '../../hooks/useApi'
import { useAuth } from '../../context/AuthContext'
import AccountMenu, { GoogleG, startGoogleLogin, useMe } from '../../components/common/AccountMenu'
import NoAccess from '../../components/common/NoAccess'
import WorkspaceToggle from '../../components/layout/WorkspaceToggle'
import { confirmDialog, promptDialog } from '../../components/common/AppDialog'
import { ICONS, KINDS } from './icons'
import './workspace.css'

const FORM_SETTINGS = {
  accept_start: '', accept_end: '', edit_end: '', require_google_auth: true, confirmation_mail: true, max_responses: '',
  show_button_in_header: false, button_label_ko: '', button_label_en: '', drive_enabled: false, drive_folder_id: '',
  drive_auto_folder: true, drive_semester: '', drive_course_field_id: '', drive_share_mode: 'restricted', drive_connection_id: '',
}
const f = (id, label_ko, type, extra = {}) => ({ id, label_ko, type, required: false, options: [], ...extra })
const FORM_TEMPLATES = [
  { id: 'blank', name: '빈 양식', sub: '', title: '제목 없는 설문지', category: 'other', fields: [f('f1', '제목 없는 질문', 'radio', { options: ['옵션 1'] })] },
  {
    id: 'attend', name: '행사 참석 여부', sub: '참석, 동행, 문의', title: '행사 참석 여부', category: 'event',
    desc: '행사 참석 여부를 알려 주세요.',
    fields: [f('f1', '이름', 'text', { required: true }), f('f2', '참석 여부', 'radio', { required: true, options: ['참석', '불참'] }), f('f3', '동행 인원', 'select', { options: ['0', '1', '2', '3'] }), f('f4', '문의 사항', 'textarea')],
  },
  {
    id: 'recruit', name: '신입 부원 모집', sub: '지원 동기, 연락처', title: '신입 부원 모집', category: 'recruit',
    desc: '디지털인문예술전공 운영위원회 신입 부원 모집 지원서입니다.',
    fields: [f('f1', '이름', 'text', { required: true }), f('f2', '학번', 'studentid', { required: true }), f('f3', '전공', 'text', { required: true }), f('f4', '연락처', 'phone', { required: true }), f('f5', '지원 부서', 'radio', { required: true, options: ['홍보부', '기획부', '웹전시부'] }), f('f6', '지원 동기', 'textarea', { required: true }), f('f7', '개인정보 수집·이용 동의', 'checkbox', { required: true, options: ['동의'] })],
  },
  {
    id: 'survey', name: '만족도 조사', sub: '점수와 의견', title: '만족도 조사', category: 'other',
    desc: '행사 만족도를 알려 주세요.',
    fields: [f('f1', '전체 만족도', 'scale', { required: true, validation: { min: 1, max: 5 } }), f('f2', '좋았던 점', 'textarea'), f('f3', '아쉬운 점', 'textarea')],
  },
  {
    id: 'vote', name: '투표', sub: '후보 선택, 의견', title: '투표', category: 'event',
    desc: '후보를 한 명 선택해 주세요.',
    fields: [f('f1', '학번', 'studentid', { required: true }), f('f2', '후보', 'radio', { required: true, options: ['후보 1', '후보 2', '기권'] }), f('f3', '의견', 'textarea')],
  },
  {
    id: 'contact', name: '연락처 정보', sub: '이름, 이메일, 전화', title: '연락처 정보', category: 'other',
    fields: [f('f1', '이름', 'text', { required: true }), f('f2', '이메일', 'email', { required: true }), f('f3', '전화번호', 'phone'), f('f4', '소속', 'text')],
  },
]

function fmtDate(iso, prefixToday = false) {
  if (!iso) return ''
  const d = new Date(iso)
  const n = new Date()
  if (d.toDateString() === n.toDateString()) {
    const h = d.getHours()
    return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

/* 썸네일: 문서 쪽 미리보기, 시트 격자, 폼 카드 */
function DocThumb({ text }) {
  const [first, ...rest] = String(text || '').split('\n')
  return (
    <div className="ws-thumb ws-thumb--doc">
      {first && <b>{first}</b>}
      <p>{rest.join('\n')}</p>
    </div>
  )
}
function SheetThumb({ head = [], rows = [] }) {
  return (
    <div className="ws-thumb ws-thumb--sheet">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
function FormThumb({ title, fields = [] }) {
  return (
    <div className="ws-thumb ws-thumb--form">
      <div className="ws-thumb__card ws-thumb__card--head"><b>{title}</b></div>
      {fields.slice(0, 3).map((x, i) => (
        <div key={i} className="ws-thumb__card"><span>{x.label_ko}{x.required ? ' *' : ''}</span><i /></div>
      ))}
    </div>
  )
}

function TemplateThumb({ kind, tpl }) {
  if (tpl.id === 'blank') return <div className="ws-plus"><Plus size={44} strokeWidth={2.4} /></div>
  if (kind === 'docs') return <DocThumb text={tpl.preview || tpl.name} />
  if (kind === 'sheets') return <SheetThumb head={tpl.head || [tpl.name]} rows={tpl.rows || []} />
  return <FormThumb title={tpl.title} fields={tpl.fields} />
}

const DOC_PREVIEW = {
  minutes: '회의록\n항목 내용\n일시\n장소\n참석\n안건\n논의 내용\n결정 사항',
  plan: '행사 기획안\n행사명 일시 장소\n목적\n진행 순서\n역할 분담\n예산\n홍보 계획',
  notice: '공지문\n안녕하세요. 운영위원회 LUCID입니다.\n일정\n내용\n신청 방법\n문의',
  report: '결과 보고서\n행사명 일시 장소\n진행 내용\n결과\n정산\n현장 사진\n개선할 점',
  handover: '인수인계 문서\n업무 개요\n연간 일정\n계정과 링크\n주의사항\n체크리스트',
}
const SHEET_PREVIEW = {
  todo: { head: ['할 일', '담당', '기한', '상태'], rows: [['', '', '', '진행 전'], ['', '', '', '진행 전']] },
  budget: { head: ['날짜', '항목', '예산', '집행', '잔액'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
  attendance: { head: ['이름', '학번', '전공', '참석'], rows: [['', '', '', ''], ['', '', '', '']] },
  shift: { head: ['날짜', '시간', '구역', '근무자'], rows: [['', '', '', ''], ['', '', '', '']] },
  calendar: { head: ['월', '화', '수', '목', '금'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
}

function CardMenu({ items, onClose, anchorRef }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => {
      if (ref.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    const key = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose, anchorRef])
  return (
    <div ref={ref} className="ws-menu" role="menu">
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="ws-menu__item" disabled={it.disabled} onClick={() => { onClose(); it.onClick() }}>
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  )
}

function FileCard({ file, kind, view, onOpen, onRename, onDelete, onNewTab, extraMenu = [] }) {
  const [menu, setMenu] = useState(false)
  const btn = useRef(null)
  const Icon = ICONS[kind]
  const items = [
    { label: '이름 바꾸기', icon: <Pencil size={20} />, onClick: () => onRename(file), disabled: file.system || file.my_role === 'viewer' },
    { label: '삭제', icon: <Trash2 size={20} />, onClick: () => onDelete(file), disabled: file.system || file.mine === false },
    { label: '새 탭에서 열기', icon: <ExternalLink size={20} />, onClick: () => onNewTab(file) },
    ...extraMenu.map((m) => ({ ...m, onClick: () => m.onClick(file) })),
  ].filter((x) => !(file.system && (x.label === '이름 바꾸기' || x.label === '삭제')))
  const thumb =
    kind === 'docs' ? <DocThumb text={file.excerpt} /> : kind === 'sheets' ? <SheetThumb head={file.head} rows={file.preview} /> : <FormThumb title={file.title} fields={file.fields} />

  if (view === 'list') {
    return (
      <div className="ws-row" onClick={() => onOpen(file)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
        <span className="ws-row__title"><Icon size={24} />{file.title}</span>
        <span className="ws-row__owner">{file.system ? '자동 연결' : file.created_by || '-'}</span>
        <span className="ws-row__date">{fmtDate(file.opened_at || file.updated_at)}</span>
        <span className="ws-row__more" onClick={(e) => e.stopPropagation()}>
          <button ref={btn} type="button" className="ws-iconbtn" aria-label="더보기" onClick={() => setMenu((v) => !v)}><MoreV /></button>
          {menu && <CardMenu items={items} onClose={() => setMenu(false)} anchorRef={btn} />}
        </span>
      </div>
    )
  }
  return (
    <div className="ws-card" role="button" tabIndex={0} onClick={() => onOpen(file)} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
      <div className={`ws-card__thumb ws-card__thumb--${kind}`}>{thumb}</div>
      <div className="ws-card__foot">
        <strong title={file.title}>{file.title}</strong>
        <div className="ws-card__meta">
          <Icon size={22} />
          <span>{file.system ? '자동 연결 시트' : fmtDate(file.opened_at || file.updated_at, true)}</span>
          <span className="ws-card__more" onClick={(e) => e.stopPropagation()}>
            <button ref={btn} type="button" className="ws-iconbtn" aria-label="더보기" onClick={() => setMenu((v) => !v)}><MoreV /></button>
            {menu && <CardMenu items={items} onClose={() => setMenu(false)} anchorRef={btn} />}
          </span>
        </div>
      </div>
    </div>
  )
}

function MoreV() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="19" r="2" fill="currentColor" /></svg>
  )
}

export default function WorkspaceHub() {
  const { kind } = useParams()
  const navigate = useNavigate()
  const { user, hasRole, loading: authLoading } = useAuth()
  const { me } = useMe()
  const isStaff = hasRole('manager')
  const [files, setFiles] = useState([])
  const [templates, setTemplates] = useState({ doc: [], sheet: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState('grid')
  const [sort, setSort] = useState('opened')
  const [owner, setOwner] = useState('all')
  const [ownerMenu, setOwnerMenu] = useState(false)
  const [drawer, setDrawer] = useState('closed') // closed | open | closing
  const closeDrawer = () => {
    setDrawer('closing')
    setTimeout(() => setDrawer('closed'), 220)
  }
  const [busy, setBusy] = useState(false)
  const ownerBtn = useRef(null)
  const K = KINDS[kind]
  const Icon = ICONS[kind] || ICONS.docs

  useEffect(() => {
    if (K) document.title = `${K.name} | 디지털인문예술전공`
  }, [K])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (kind === 'forms' && !isStaff) {
        setFiles([])
      } else if (kind === 'forms') {
        const r = await api.get('/admin/forms')
        setFiles(
          (r.items || []).map((x) => ({
            id: x.id, title: x.title_ko || '제목 없는 설문지', created_by: '', opened_at: x.updated_at, updated_at: x.updated_at,
            fields: Array.isArray(x.fields) ? x.fields : [], response_count: x.response_count, slug: x.slug,
          }))
        )
      } else {
        const r = await api.get('/workspace/files', { kind: kind === 'docs' ? 'doc' : 'sheet' })
        let items = r.items
        if (kind === 'sheets') items = [{ id: 'entries', system: true, title: '전시회 접수 현황', head: ['번호', '접수일시', '학기', '유형', '이메일'], preview: [['1', '', '', '개인', ''], ['2', '', '', '팀', '']], updated_at: null, to: '/admin/exhibition-entries/sheet' }, ...items]
        setFiles(items)
      }
    } catch (e) {
      setError(e.message || '불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [kind, isStaff])

  useEffect(() => {
    if (K && !authLoading) load()
  }, [K, load, authLoading])

  useEffect(() => {
    if (isStaff) api.get('/workspace/templates').then(setTemplates).catch(() => {})
  }, [isStaff])

  const tplList = useMemo(() => {
    if (kind === 'forms') return FORM_TEMPLATES
    const src = kind === 'docs' ? templates.doc : templates.sheet
    return src.map((t) => ({ ...t, ...(kind === 'docs' ? { preview: DOC_PREVIEW[t.id] } : SHEET_PREVIEW[t.id] || {}) }))
  }, [kind, templates])

  const shown = useMemo(() => {
    let list = files.filter((x) => !q.trim() || x.title.toLowerCase().includes(q.trim().toLowerCase()))
    if (owner === 'mine') list = list.filter((x) => x.mine)
    const pinned = list.filter((x) => x.system)
    const rest = list.filter((x) => !x.system)
    rest.sort(sort === 'name' ? (a, b) => a.title.localeCompare(b.title, 'ko') : (a, b) => new Date(b.opened_at || b.updated_at) - new Date(a.opened_at || a.updated_at))
    return [...pinned, ...rest]
  }, [files, q, owner, sort, user])

  if (!K) return <Navigate to="/workspace/docs" replace />
  if (authLoading) return null

  const open = (file) => {
    if (file.to) return navigate(file.to)
    if (kind === 'docs') {
      api.post(`/workspace/files/${file.id}/open`).catch(() => {})
      return navigate(`/docs/${file.first_tab}`)
    }
    if (kind === 'sheets') return navigate(`/sheets/${file.id}`)
    return navigate(`/admin/forms/${file.id}/edit`)
  }
  const urlOf = (file) => (file.to ? file.to : kind === 'docs' ? `/docs/${file.first_tab}` : kind === 'sheets' ? `/sheets/${file.id}` : `/admin/forms/${file.id}/edit`)

  async function createFrom(tpl) {
    if (busy) return
    setBusy(true)
    try {
      if (kind === 'forms') {
        const payload = {
          slug: `form-${Date.now().toString(36)}`, title_ko: tpl.title, title_en: '', description_ko: tpl.desc || '', description_en: '',
          category: tpl.category, fields: tpl.fields, published: false, settings: FORM_SETTINGS,
        }
        const r = await api.post('/admin/forms', payload)
        navigate(`/admin/forms/${r.item.id}/edit`)
      } else if (kind === 'docs') {
        const r = await api.post('/workspace/files', { kind: 'doc', template: tpl.id })
        navigate(`/docs/${r.item.first_tab}`)
      } else {
        const r = await api.post('/workspace/files', { kind: 'sheet', template: tpl.id })
        navigate(`/sheets/${r.item.id}`)
      }
    } catch (e) {
      setError(e.message || '만들지 못했습니다')
      setBusy(false)
    }
  }

  async function rename(file) {
    const title = await promptDialog({ title: '이름 바꾸기', label: '새 이름', defaultValue: file.title, confirmLabel: '바꾸기' })
    if (!title || !title.trim() || title === file.title) return
    try {
      if (kind === 'forms') await api.put(`/admin/forms/${file.id}`, { title_ko: title.trim() })
      else await api.put(`/workspace/files/${file.id}`, { title: title.trim() })
      setFiles((l) => l.map((x) => (x.id === file.id ? { ...x, title: title.trim() } : x)))
    } catch (e) {
      setError(e.message)
    }
  }
  async function remove(file) {
    if (!(await confirmDialog({ title: '삭제', message: `'${file.title}'을(를) 삭제할까요? 되돌릴 수 없습니다.`, tone: 'danger', confirmLabel: '삭제' }))) return
    try {
      if (kind === 'forms') await api.del(`/admin/forms/${file.id}`)
      else await api.del(`/workspace/files/${file.id}`)
      setFiles((l) => l.filter((x) => x.id !== file.id))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="ws">
      <header className="ws-top">
        <button type="button" className="ws-iconbtn ws-iconbtn--lg" aria-label="기본 메뉴" onClick={() => setDrawer('open')}><Menu size={24} /></button>
        <Link to={K.path} className="ws-brand"><Icon size={40} /><span>{K.name}</span></Link>
        <label className="ws-search">
          <Search size={22} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" aria-label="검색" />
          {q && <button type="button" className="ws-iconbtn" aria-label="검색어 지우기" onClick={() => setQ('')}><X size={20} /></button>}
        </label>
        <span className="ws-top__right">
          <WorkspaceToggle light />
          <AccountMenu size={40} />
        </span>
      </header>

      {drawer !== 'closed' && (
        <div className={`ws-drawer-wrap is-${drawer}`} onClick={() => closeDrawer()}>
          <nav className="ws-drawer" onClick={(e) => e.stopPropagation()} aria-label="작업공간 메뉴">
            <div className="ws-drawer__head"><button type="button" className="ws-iconbtn ws-iconbtn--lg" aria-label="닫기" onClick={() => closeDrawer()}><X size={24} /></button><strong>작업공간</strong></div>
            {Object.values(KINDS).map((k) => {
              const I = ICONS[k.id]
              return <Link key={k.id} to={k.path} onClick={() => closeDrawer()} className={`ws-drawer__item${k.id === kind ? ' is-on' : ''}`}><I size={24} />{k.name}</Link>
            })}
            <hr />
            {isStaff && <Link to="/admin" className="ws-drawer__item">관리 대시보드</Link>}
            <Link to="/" className="ws-drawer__item">사이트로 돌아가기</Link>
          </nav>
        </div>
      )}

      {isStaff && (
      <section className="ws-band">
        <div className="ws-wrap">
          <div className="ws-band__head"><h2>{K.start}</h2></div>
          <div className={`ws-tpls ws-tpls--${kind}`}>
            {tplList.map((t) => (
              <button key={t.id} type="button" className="ws-tpl" disabled={busy} onClick={() => createFrom(t)}>
                <span className="ws-tpl__thumb"><TemplateThumb kind={kind} tpl={t} /></span>
                <strong>{t.name}</strong>
                {t.sub && <small>{t.sub}</small>}
              </button>
            ))}
          </div>
        </div>
      </section>
      )}

      <section className="ws-recent">
        <div className="ws-wrap">
          <div className="ws-recent__head">
            <h2>{K.recent}</h2>
            <div className="ws-recent__tools">
              <div className="ws-owner">
                <button ref={ownerBtn} type="button" className="ws-owner__btn" onClick={() => setOwnerMenu((v) => !v)}>{owner === 'all' ? '모든 항목' : '내가 만든 항목'}<ChevronDown size={16} /></button>
                {ownerMenu && (
                  <CardMenu anchorRef={ownerBtn} onClose={() => setOwnerMenu(false)} items={[
                    { label: '모든 항목', icon: null, onClick: () => setOwner('all') },
                    { label: '내가 만든 항목', icon: null, onClick: () => setOwner('mine') },
                  ]} />
                )}
              </div>
              <button type="button" className="ws-iconbtn ws-iconbtn--lg" aria-label={view === 'grid' ? '목록 보기' : '격자 보기'} title={view === 'grid' ? '목록 보기' : '격자 보기'} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>{view === 'grid' ? <List size={24} /> : <LayoutGrid size={24} />}</button>
              <button type="button" className={`ws-iconbtn ws-iconbtn--lg${sort === 'name' ? ' is-on' : ''}`} aria-label="정렬 옵션" title={sort === 'name' ? '이름순 (누르면 최근 연 순서)' : '최근 연 순서 (누르면 이름순)'} onClick={() => setSort(sort === 'name' ? 'opened' : 'name')}>{sort === 'name' ? <ArrowDownAZ size={24} /> : <Clock3 size={24} />}</button>
            </div>
          </div>

          {error && <p className="ws-error" role="alert">{error}</p>}
          {loading ? (
            <p className="ws-empty">불러오는 중</p>
          ) : shown.length === 0 ? (
            <div className="ws-empty">
              {me && !me.user && !q && (
                <button type="button" className="gbtn" onClick={() => startGoogleLogin()}><GoogleG size={22} /> 구글 계정으로 로그인</button>
              )}
              <p style={{ margin: me && !me.user && !q ? '16px 0 0' : 0 }}>{q ? '검색 결과가 없습니다.' : isStaff ? '아직 만든 항목이 없습니다. 위 템플릿으로 시작하세요.' : kind === 'forms' ? '설문지는 운영위원회 및 교수진 계정으로 로그인해야 볼 수 있습니다.' : me?.user ? '공유받은 파일이 없습니다. 소유자가 이메일로 공유하면 여기에 표시됩니다.' : '로그인하면 나에게 공유된 파일이 여기에 표시됩니다.'}</p>
            </div>
          ) : view === 'list' ? (
            <div className="ws-list">
              <div className="ws-row ws-row--head"><span>이름</span><span>소유자</span><span>마지막으로 연 시간</span><span /></div>
              {shown.map((x) => <FileCard key={x.id} file={x} kind={kind} view="list" onOpen={open} onRename={rename} onDelete={remove} onNewTab={(file) => window.open(urlOf(file), '_blank')} extraMenu={kind === 'forms' ? [{ label: '응답 시트 열기', icon: <Table2 size={20} />, onClick: (file) => navigate(`/admin/forms/${file.id}/responses/sheet`) }] : []} />)}
            </div>
          ) : (
            <div className={`ws-grid ws-grid--${kind}`}>
              {shown.map((x) => <FileCard key={x.id} file={x} kind={kind} view="grid" onOpen={open} onRename={rename} onDelete={remove} onNewTab={(file) => window.open(urlOf(file), '_blank')} extraMenu={kind === 'forms' ? [{ label: '응답 시트 열기', icon: <ListChecks size={20} />, onClick: (file) => navigate(`/admin/forms/${file.id}/responses/sheet`) }] : []} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
