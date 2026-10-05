// /workspace/:kind (docs | sheets | forms): 문서·스프레드시트·설문지 홈.
// 구글 문서·시트·폼 홈과 같은 구조: 상단 바(햄버거, 제품 아이콘과 이름, 검색, 3종 전환, 계정)
// → 템플릿 띠 → 최근 항목(카드 격자 또는 목록, 정렬, 소유자 필터, 항목별 ⋮ 메뉴).
// 문서와 시트는 /workspace/files, 폼은 기존 /admin/forms를 쓴다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownAZ, ChevronDown, ExternalLink, LayoutGrid, List, Menu, Pencil, Plus, Search, Table2, Trash2, X, Clock3, ListChecks, Lock, Eye, EyeOff, UsersRound, Undo2 } from 'lucide-react'
import { api } from '../../hooks/useApi'
import { useAuth } from '../../context/AuthContext'
import AccountMenu, { GoogleG, startGoogleLogin, useMe } from '../../components/common/AccountMenu'
import NoAccess from '../../components/common/NoAccess'
import WorkspaceToggle from '../../components/layout/WorkspaceToggle'
import { alertDialog, confirmDialog, promptDialog } from '../../components/common/AppDialog'
import { useLoginModal } from '../../context/LoginModalContext'
import { ICONS, KINDS } from './icons'
import './workspace.css'

const FORM_SETTINGS = {
  accept_start: '', accept_end: '', edit_end: '', require_google_auth: true, confirmation_mail: true, max_responses: '',
  show_button_in_header: false, button_label_ko: '', button_label_en: '', drive_enabled: false, drive_folder_id: '',
  drive_auto_folder: true, drive_semester: '', drive_course_field_id: '', drive_share_mode: 'restricted', drive_connection_id: '',
}
const f = (id, label_ko, type, extra = {}) => ({ id, label_ko, type, required: false, options: [], ...extra })
// 개인정보 수집·이용 동의(공개 대학 동의서의 공통 요소: 수집 항목, 목적, 보유 기간, 거부 권리와 불이익). 보유 기간은 행사에 맞게 고친다.
const consent = (id, items, purpose) =>
  f(id, '개인정보 수집·이용 동의', 'radio', {
    required: true,
    options: ['동의합니다', '동의하지 않습니다'],
    hint_ko: `수집 항목: ${items}\n이용 목적: ${purpose}\n보유 기간: 목적 달성 후 ○년(행사에 맞게 수정)\n동의를 거부할 수 있으며, 거부하면 신청이 제한될 수 있습니다.`,
  })
// 템플릿 근거: 운영위원회 개강·종강총회 방명록 hwp, 기말전시 기획안(참여형 방명록), 포스터 공모전 요강·출품자 명단,
// 근로일지 기록카드 hwp, 멘토 결과 보고서 hwpx (구조만 옮김)
const FORM_TEMPLATES = [
  { id: 'blank', name: '빈 양식', sub: '', title: '제목 없는 설문지', category: 'other', fields: [f('f1', '제목 없는 질문', 'radio', { options: ['옵션 1'] })] },
  {
    id: 'register', name: '행사 참가 신청', sub: '학과, 학번, 참석 여부', title: '행사 참가 신청', category: 'event',
    desc: '행사 참가 신청서입니다.\n일시: \n장소: ',
    fields: [
      f('f1', '학과', 'text', { required: true }),
      f('f2', '학번', 'studentid', { required: true }),
      f('f3', '성명', 'text', { required: true }),
      f('f4', '연락처', 'phone', { required: true }),
      f('f5', '참석 여부', 'radio', { required: true, options: ['참석', '불참'] }),
      f('f6', '문의 사항', 'textarea'),
      consent('f7', '학과, 학번, 성명, 연락처', '참가자 확인과 행사 안내 연락'),
    ],
  },
  {
    id: 'guestbook', name: '방명록', sub: '이름과 남길 말', title: '방명록', category: 'event',
    desc: '행사에 와 주셔서 고맙습니다. 남기고 싶은 말을 적어 주세요.',
    fields: [
      f('f1', '학과', 'text', { required: true }),
      f('f2', '학번', 'studentid'),
      f('f3', '성명', 'text', { required: true }),
      f('f4', '남길 말', 'textarea', { required: true }),
      f('f5', '남긴 말을 전시·홍보에 공개해도 될까요?', 'radio', { required: true, options: ['공개해도 됩니다', '공개하지 않습니다'] }),
    ],
  },
  {
    id: 'contest', name: '공모전 출품 신청', sub: '작품, 소개, AI 활용', title: '공모전 출품 신청', category: 'other',
    desc: '공모전 출품 신청서입니다. 작품 규격과 파일 형식은 공모전 안내를 확인해 주세요.',
    fields: [
      f('f1', '참가 유형', 'radio', { required: true, options: ['개인', '팀'] }),
      f('f2', '이름(팀이면 대표자)', 'text', { required: true }),
      f('f3', '학과', 'text', { required: true }),
      f('f4', '학번', 'studentid', { required: true }),
      f('f5', '연락처', 'phone', { required: true }),
      f('f6', '이메일', 'email', { required: true }),
      f('f7', '작품명', 'text', { required: true }),
      f('f8', '작품 소개', 'textarea', { required: true }),
      f('f9', '생성형 AI 활용 도구와 활용 내용', 'textarea', { hint_ko: '사용하지 않았다면 비워 두세요.' }),
      consent('f10', '이름, 학과, 학번, 연락처, 이메일', '출품자 확인, 심사, 결과 안내, 시상'),
      f('f11', '수상작 공개 동의', 'radio', { required: true, options: ['동의합니다', '동의하지 않습니다'], hint_ko: '수상작은 전시, 웹사이트, 인스타그램에 작품명과 이름이 공개될 수 있습니다.' }),
    ],
  },
  {
    id: 'worklog', name: '근무 기록 제출', sub: '날짜, 시간, 내용', title: '근무 기록 제출', category: 'other',
    desc: '근무한 날마다 한 번씩 제출합니다.',
    fields: [
      f('f1', '이름', 'text', { required: true }),
      f('f2', '학번', 'studentid', { required: true }),
      f('f3', '근무 날짜', 'date', { required: true }),
      f('f4', '시작 시각', 'time', { required: true }),
      f('f5', '종료 시각', 'time', { required: true }),
      f('f6', '근무 내용', 'textarea', { required: true }),
      f('f7', '확인', 'checkbox', { required: true, options: ['위 내용이 사실과 같음을 확인합니다'] }),
    ],
  },
  {
    id: 'mentoring', name: '멘토링·특강 결과 보고', sub: '활동, 의견, 만족도', title: '멘토링·특강 결과 보고', category: 'other',
    desc: '멘토링 또는 특강이 끝난 뒤 작성합니다.',
    fields: [
      f('f1', '이름', 'text', { required: true }),
      f('f2', '학과·전공', 'text', { required: true }),
      f('f3', '학번', 'studentid', { required: true }),
      f('f4', '활동 날짜', 'date', { required: true }),
      f('f5', '활동 시간(시간)', 'text', { required: true }),
      f('f6', '참여 인원', 'text'),
      f('f7', '활동 내용', 'textarea', { required: true }),
      f('f8', '참여 학생에게 필요한 사항', 'textarea'),
      f('f9', '프로그램을 위한 건의 사항', 'textarea'),
      f('f10', '종합 소감', 'textarea'),
      f('f11', '전체 만족도', 'scale', { required: true, validation: { min: 1, max: 5 } }),
    ],
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

// 한글(HWPX) 양식: 같은 문서 템플릿을 kordoc으로 공문서 서식의 HWPX로 만든 파일(client/public/templates)
const HWPX_FILES = [
  { name: '행사·전시 기획안', href: '/templates/dah-plan.hwpx' },
  { name: '행사 결과 보고서', href: '/templates/dah-report.hwpx' },
  { name: '회의록', href: '/templates/dah-minutes.hwpx' },
  { name: '공모전 안내', href: '/templates/dah-contest.hwpx' },
  { name: '방명록', href: '/templates/dah-guestbook.hwpx' },
]

const DOC_PREVIEW = {
  plan: '행사·전시 기획안\n행사명 슬로건 일시 장소\n1. 기획 의도 및 목적\n2. 실행 방안\n현장 프로그램 공간 구성\n홍보 방안\n3. 필요 물품 및 예산\n4. 추진 일정\n5. 운영 인원',
  report: '행사 결과 보고서\n행사명 일시 장소\n참석 인원 추진 목적\n1. 주요 행사 내용\n2. 행사 효과\n3. 행사 현장 사진\n4. 정산\n참여자 명단',
  minutes: '회의록\n1. 회의 개요\n2. 참석자\n3. 상정 안건\n4. 논의 내용\n5. 결정 사항\n6. 기타',
  contest: '공모전 안내\n접수 기간 참가 대상\n1. 공모 주제\n2. 출품 양식\n3. 시상 내용\n4. 세부 일정\n5. 출품 방법\n6. 유의 사항',
  guestbook: '방명록\n행사명 일시 장소\n순번 학과 학번 성명 서명\n1\n2\n3\n4\n5',
}
const SHEET_PREVIEW = {
  participants: { head: ['순번', '학과', '학번', '성명', '참석'], rows: [['1', '', '', '', ''], ['2', '', '', '', ''], ['3', '', '', '', '']] },
  budget: { head: ['구분', '물품', '단가', '수량', '금액'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
  judging: { head: ['순번', '작품명', '과목명', '대표학생', '독창성'], rows: [['1', '', '', '', ''], ['2', '', '', '', ''], ['3', '', '', '', '']] },
  worklog: { head: ['날짜', '요일', '근무자', '내용', '시간'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
  files: { head: ['ID', '과목', '작품명', '파일명', '제출'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
}

function CardMenu({ items, onClose, anchorRef, align = 'right' }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  // 메뉴는 body에 고정 위치로 띄운다: 목록 아래쪽 카드에서도 잘리지 않고, 공간이 모자라면 위로 열린다
  useLayoutEffect(() => {
    const a = anchorRef?.current?.getBoundingClientRect()
    const m = ref.current
    if (!a || !m) return
    const w = m.offsetWidth
    const h = m.offsetHeight
    const left = align === 'right' ? Math.min(Math.max(8, a.right - w), window.innerWidth - w - 8) : Math.min(a.left, window.innerWidth - w - 8)
    const below = a.bottom + 2
    const top = below + h > window.innerHeight - 8 ? Math.max(8, a.top - h - 2) : below
    setPos({ top, left })
  }, [anchorRef, align, items.length])
  useEffect(() => {
    const down = (e) => {
      if (ref.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    const key = (e) => e.key === 'Escape' && onClose()
    const away = () => onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', away)
    document.querySelector('.ws')?.addEventListener('scroll', away, { passive: true })
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', away)
      document.querySelector('.ws')?.removeEventListener('scroll', away)
    }
  }, [onClose, anchorRef])
  return createPortal(
    <div ref={ref} className="ws-menu ws-menu--fixed" role="menu" style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="ws-menu__item" disabled={it.disabled} onClick={() => { onClose(); it.onClick() }}>
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}

function LockedThumb() {
  return (
    <div className="ws-locked" aria-hidden="true">
      <div className="ws-locked__ghost">
        <i /><i /><i /><i /><i /><i /><i />
      </div>
      <span className="ws-locked__badge"><Lock size={26} /></span>
    </div>
  )
}

function FileCard({ file, kind, view, onOpen, onRename, onDelete, onNewTab, onHide, onRestore, onPurge, extraMenu = [] }) {
  const [menu, setMenu] = useState(false)
  const btn = useRef(null)
  const Icon = ICONS[kind]
  const items = file.trashed ? [
    ...(file.can_delete ? [{ label: '복원', icon: <Undo2 size={20} />, onClick: () => onRestore(file) }, { label: '영구 삭제', icon: <Trash2 size={20} />, onClick: () => onPurge(file) }] : []),
  ] : [
    { label: '이름 바꾸기', icon: <Pencil size={20} />, onClick: () => onRename(file), disabled: file.system || file.my_role === 'viewer' },
    ...(file.can_hide ? [{ label: file.hidden ? '비공개 해제' : '비공개로 전환', icon: file.hidden ? <Eye size={20} /> : <EyeOff size={20} />, onClick: () => onHide(file) }] : []),
    ...(file.can_delete ? [{ label: '휴지통으로 이동', icon: <Trash2 size={20} />, onClick: () => onDelete(file), disabled: file.system }] : []),
    { label: '새 탭에서 열기', icon: <ExternalLink size={20} />, onClick: () => onNewTab(file) },
    ...extraMenu.map((m) => ({ ...m, onClick: () => m.onClick(file) })),
  ].filter((x) => !(file.system && (x.label === '이름 바꾸기' || x.label === '휴지통으로 이동')))
  const hasMenu = !file.locked
  const thumb = file.locked ? <LockedThumb /> :
    kind === 'docs' ? <DocThumb text={file.excerpt} /> : kind === 'sheets' ? <SheetThumb head={file.head} rows={file.preview} /> : <FormThumb title={file.title} fields={file.fields} />

  if (view === 'list') {
    return (
      <div className="ws-row" onClick={() => onOpen(file)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
        <span className="ws-row__title">{file.locked ? <Lock size={24} /> : <Icon size={24} />}{file.title}{file.owner_only ? <em className="ws-tag">나만 보기</em> : file.hidden ? <em className="ws-tag">비공개</em> : null}</span>
        <span className="ws-row__owner">{file.system ? '자동 연결' : file.created_by || '-'}</span>
        <span className="ws-row__date">{file.trashed ? `${file.days_left}일 뒤 삭제` : fmtDate(file.opened_at || file.updated_at)}</span>
        <span className="ws-row__more" onClick={(e) => e.stopPropagation()}>
          {hasMenu && <button ref={btn} type="button" className="ws-iconbtn" aria-label="더보기" onClick={() => setMenu((v) => !v)}><MoreV /></button>}
          {menu && <CardMenu items={items} onClose={() => setMenu(false)} anchorRef={btn} />}
        </span>
      </div>
    )
  }
  return (
    <div className={`ws-card${file.locked ? ' is-locked' : ''}`} role="button" tabIndex={0} onClick={() => onOpen(file)} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
      <div className={`ws-card__thumb ws-card__thumb--${kind}`}>{thumb}</div>
      <div className="ws-card__foot">
        <strong title={file.title}>{file.title}</strong>
        <div className="ws-card__meta">
          {file.locked ? <Lock size={20} /> : <Icon size={22} />}
          {file.owner_only ? <em className="ws-tag" title="만든 사람만 볼 수 있습니다"><Lock size={12} />나만 보기</em> : file.hidden ? <em className="ws-tag" title="공유받지 않은 사람의 목록에 나오지 않습니다"><EyeOff size={12} />비공개</em> : null}
          <span>{file.locked ? '접근 권한 없음' : file.system ? '자동 연결 시트' : file.trashed ? `${file.days_left}일 뒤 삭제` : fmtDate(file.opened_at || file.updated_at, true)}</span>
          <span className="ws-card__more" onClick={(e) => e.stopPropagation()}>
            {hasMenu && <button ref={btn} type="button" className="ws-iconbtn" aria-label="더보기" onClick={() => setMenu((v) => !v)}><MoreV /></button>}
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
  const { me, reload: reloadMe } = useMe()
  const { openLogin } = useLoginModal()
  const [params, setParams] = useSearchParams()
  const isStaff = hasRole('manager')
  const signedIn = Boolean(me?.user)
  const committee = Boolean(me?.committee)
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
  const hwpBtn = useRef(null)
  const [hwpMenu, setHwpMenu] = useState(false)
  const K = KINDS[kind]
  const Icon = ICONS[kind] || ICONS.docs

  useEffect(() => {
    if (K) document.title = `${K.name} | 디지털인문예술전공`
  }, [K])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const hiddenOnly = owner === 'hidden' ? { hidden: '1' } : owner === 'trash' ? { trash: '1' } : {}
      if (kind === 'forms') {
        const r = await api.get('/admin/forms', hiddenOnly)
        setFiles(
          (r.items || []).map((x) => ({
            id: x.id, title: x.title_ko || '제목 없는 설문지', created_by: '', opened_at: x.updated_at, updated_at: x.updated_at,
            fields: Array.isArray(x.fields) ? x.fields : [], response_count: x.response_count, slug: x.slug,
            ws_id: x.ws_id, my_role: x.my_role, can_delete: x.can_delete, locked: x.locked, hidden: x.hidden, can_hide: x.can_hide,
            trashed: x.trashed, days_left: x.days_left,
          }))
        )
      } else {
        const r = await api.get('/workspace/files', { kind: kind === 'docs' ? 'doc' : 'sheet', ...hiddenOnly })
        let items = r.items
        // 전시회 접수 현황은 접수자 개인정보라 사이트 스태프에게만 보인다
        if (kind === 'sheets' && owner !== 'hidden' && owner !== 'trash' && isStaff) items = [{ id: 'entries', system: true, title: '전시회 접수 현황', head: ['번호', '접수일시', '학기', '유형', '이메일'], preview: [['1', '', '', '개인', ''], ['2', '', '', '팀', '']], updated_at: null, to: '/admin/exhibition-entries/sheet' }, ...items]
        setFiles(items)
      }
    } catch (e) {
      setError(e.message || '불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [kind, owner, isStaff])

  useEffect(() => {
    if (K && !authLoading) load()
  }, [K, load, authLoading])

  // 운영위원회 사이트 계정으로 로그인(모달)하면 계정 정보와 목록을 다시 읽는다
  const staffId = user?.id ?? null
  const firstStaff = useRef(true)
  useEffect(() => {
    if (firstStaff.current) { firstStaff.current = false; return }
    reloadMe()
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId])

  // 구글 로그인이 실패하면 서버가 ?login_error=로 돌려보낸다. 안내를 띄우고 주소에서 지운다.
  useEffect(() => {
    const msg = params.get('login_error')
    if (!msg) return
    const next = new URLSearchParams(params)
    next.delete('login_error')
    setParams(next, { replace: true })
    alertDialog({ title: '로그인하지 못했습니다', message: msg })
  }, [params, setParams])

  useEffect(() => {
    if (signedIn) api.get('/workspace/templates').then(setTemplates).catch(() => {})
  }, [signedIn])

  const tplList = useMemo(() => {
    if (kind === 'forms') return FORM_TEMPLATES
    const src = kind === 'docs' ? templates.doc : templates.sheet
    return src.map((t) => ({ ...t, ...(kind === 'docs' ? { preview: DOC_PREVIEW[t.id] } : SHEET_PREVIEW[t.id] || {}) }))
  }, [kind, templates])

  const shown = useMemo(() => {
    let list = files.filter((x) => !q.trim() || x.title.toLowerCase().includes(q.trim().toLowerCase()))
    if (owner === 'mine') list = list.filter((x) => (x.mine || kind === 'forms') && !x.locked)
    const pinned = list.filter((x) => x.system)
    const rest = list.filter((x) => !x.system)
    rest.sort(sort === 'name' ? (a, b) => a.title.localeCompare(b.title, 'ko') : (a, b) => new Date(b.opened_at || b.updated_at) - new Date(a.opened_at || a.updated_at))
    return [...pinned, ...rest]
  }, [files, q, owner, sort, user])

  if (!K) return <Navigate to="/workspace/docs" replace />
  if (authLoading) return null

  const open = (file) => {
    if (file.trashed) return alertDialog({ title: '휴지통에 있는 파일입니다', message: `"${file.title}"은(는) 복원해야 열 수 있습니다. 카드의 ⋮ 메뉴에서 복원하세요. ${file.days_left}일 뒤에 영구 삭제됩니다.` })
    if (file.locked) return alertDialog({ title: '접근 권한이 없습니다', message: `"${file.title}"은(는) 운영위원회 및 교수진만 열 수 있습니다. 소유자에게 이메일 공유를 요청하세요.` })
    if (file.to) return navigate(file.to)
    if (kind === 'docs') {
      api.post(`/workspace/files/${file.id}/open`).catch(() => {})
      return navigate(`/docs/${file.first_tab}`)
    }
    if (kind === 'sheets') return navigate(`/sheets/${file.id}`)
    return navigate(`/form/${file.id}/edit`)
  }
  const urlOf = (file) => (file.to ? file.to : kind === 'docs' ? `/docs/${file.first_tab}` : kind === 'sheets' ? `/sheets/${file.id}` : `/form/${file.id}/edit`)

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
        navigate(`/form/${r.item.id}/edit`, { state: { justSaved: true } })
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
    if (!(await confirmDialog({ title: '휴지통으로 이동', message: `'${file.title}'을(를) 휴지통으로 옮길까요? 30일 동안 보관되며, 그 안에는 휴지통에서 복원할 수 있습니다. 30일이 지나면 영구 삭제됩니다.`, confirmLabel: '휴지통으로 이동' }))) return
    try {
      if (kind === 'forms') await api.del(`/admin/forms/${file.id}`)
      else await api.del(`/workspace/files/${file.id}`)
      setFiles((l) => l.filter((x) => x.id !== file.id))
    } catch (e) {
      setError(e.message)
    }
  }
  const wsIdOf = (file) => (kind === 'forms' ? file.ws_id : file.id)
  async function restore(file) {
    try {
      await api.post(`/workspace/files/${wsIdOf(file)}/restore`)
      setFiles((l) => l.filter((x) => x.id !== file.id))
    } catch (e) {
      setError(e.message)
    }
  }
  async function purge(file) {
    if (!(await confirmDialog({ title: '영구 삭제', message: `'${file.title}'을(를) 영구 삭제할까요? 복원할 수 없습니다.`, confirmLabel: '영구 삭제' }))) return
    try {
      await api.del(`/workspace/files/${wsIdOf(file)}/permanent`)
      setFiles((l) => l.filter((x) => x.id !== file.id))
    } catch (e) {
      setError(e.message)
    }
  }

  async function toggleHidden(file) {
    const hide = !file.hidden
    const wsId = kind === 'forms' ? file.ws_id : file.id
    if (hide && !(await confirmDialog({
      title: '비공개로 전환',
      message: `'${file.title}'을(를) 비공개로 바꿀까요? 소유자와 이메일로 추가된 사람의 목록에만 나오고, 열 수 있는 다른 사람의 목록에서도 숨겨집니다. 공유 설정은 그대로입니다.`,
      confirmLabel: '비공개로 전환',
    }))) return
    try {
      await api.put(`/workspace/files/${wsId}/hidden`, { hidden: hide })
      load()
    } catch (e) {
      setError(e.hint ? `${e.message} (${e.hint})` : e.message)
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
            {me?.admin && <Link to="/workspace/members" className="ws-drawer__item"><UsersRound size={24} />운영위원회 구성원</Link>}
            {isStaff && <Link to="/admin" className="ws-drawer__item">관리 대시보드</Link>}
            <Link to="/" className="ws-drawer__item">사이트로 돌아가기</Link>
          </nav>
        </div>
      )}

      {me && !signedIn && (
        <section className="ws-band ws-signin">
          <div className="ws-wrap">
            <h2>{K.name}에 로그인</h2>
            <p>구글 계정으로 로그인하면 누구나 새 {kind === 'docs' ? '문서' : kind === 'sheets' ? '스프레드시트' : '설문지'}를 만들고, 공유받은 파일을 열 수 있습니다.</p>
            <div className="ws-signin__btns">
              <button type="button" className="gbtn" onClick={() => startGoogleLogin()}><GoogleG size={22} /> 구글 계정으로 로그인</button>
              <button type="button" className="ws-signin__alt" onClick={() => openLogin()}>운영위원회 사이트 계정으로 로그인</button>
            </div>
          </div>
        </section>
      )}

      {signedIn && (
      <section className="ws-band">
        <div className="ws-wrap">
          <div className="ws-band__head">
            <h2>{K.start}</h2>
            {kind === 'docs' && (
              <span className="ws-owner">
                <button ref={hwpBtn} type="button" className="ws-owner__btn" onClick={() => setHwpMenu((v) => !v)}>한글(HWPX) 양식<ChevronDown size={16} /></button>
                {hwpMenu && (
                  <CardMenu anchorRef={hwpBtn} onClose={() => setHwpMenu(false)} items={HWPX_FILES.map((x) => ({ label: x.name, icon: <ExternalLink size={20} />, onClick: () => { const a = document.createElement('a'); a.href = x.href; a.download = `${x.name}.hwpx`; a.click() } }))} />
                )}
              </span>
            )}
          </div>
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
                <button ref={ownerBtn} type="button" className="ws-owner__btn" onClick={() => setOwnerMenu((v) => !v)}>{owner === 'all' ? '모든 항목' : owner === 'hidden' ? '비공개 항목' : owner === 'trash' ? '휴지통' : '내가 만든 항목'}<ChevronDown size={16} /></button>
                {ownerMenu && (
                  <CardMenu anchorRef={ownerBtn} align="left" onClose={() => setOwnerMenu(false)} items={[
                    { label: '모든 항목', icon: null, onClick: () => setOwner('all') },
                    { label: '내가 만든 항목', icon: null, onClick: () => setOwner('mine') },
                    ...(committee ? [{ label: '비공개 항목', icon: <EyeOff size={20} />, onClick: () => setOwner('hidden') }] : []),
                    ...(signedIn ? [{ label: '휴지통', icon: <Trash2 size={20} />, onClick: () => setOwner('trash') }] : []),
                  ]} />
                )}
              </div>
              <button type="button" className="ws-iconbtn ws-iconbtn--lg" aria-label={view === 'grid' ? '목록 보기' : '격자 보기'} title={view === 'grid' ? '목록 보기' : '격자 보기'} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>{view === 'grid' ? <List size={24} /> : <LayoutGrid size={24} />}</button>
              <button type="button" className={`ws-iconbtn ws-iconbtn--lg${sort === 'name' ? ' is-on' : ''}`} aria-label="정렬 옵션" title={sort === 'name' ? '이름순 (누르면 최근 연 순서)' : '최근 연 순서 (누르면 이름순)'} onClick={() => setSort(sort === 'name' ? 'opened' : 'name')}>{sort === 'name' ? <ArrowDownAZ size={24} /> : <Clock3 size={24} />}</button>
            </div>
          </div>

          {owner === 'trash' && <p className="ws-note">휴지통에 넣은 파일은 30일 동안 보관되며, 그 안에는 복원할 수 있습니다. 30일이 지나면 영구 삭제됩니다.</p>}
          {error && <p className="ws-error" role="alert">{error}</p>}
          {loading ? (
            <p className="ws-empty">불러오는 중</p>
          ) : shown.length === 0 ? (
            <div className="ws-empty">
              <p style={{ margin: 0 }}>{q ? '검색 결과가 없습니다.' : owner === 'hidden' ? '비공개 항목이 없습니다.' : owner === 'trash' ? '휴지통이 비어 있습니다.' : signedIn ? '아직 항목이 없습니다. 위 템플릿으로 새로 만들거나, 다른 사람이 이메일로 공유하면 여기에 표시됩니다.' : '로그인하면 내 파일과 나에게 공유된 파일이 여기에 표시됩니다.'}</p>
            </div>
          ) : view === 'list' ? (
            <div className="ws-list">
              <div className="ws-row ws-row--head"><span>이름</span><span>소유자</span><span>마지막으로 연 시간</span><span /></div>
              {shown.map((x) => <FileCard key={x.id} file={x} kind={kind} view="list" onOpen={open} onRename={rename} onDelete={remove} onHide={toggleHidden} onRestore={restore} onPurge={purge} onNewTab={(file) => window.open(urlOf(file), '_blank')} extraMenu={kind === 'forms' ? [{ label: '응답 시트 열기', icon: <Table2 size={20} />, onClick: (file) => navigate(`/form/${file.id}/responses`) }] : []} />)}
            </div>
          ) : (
            <div className={`ws-grid ws-grid--${kind}`}>
              {shown.map((x) => <FileCard key={x.id} file={x} kind={kind} view="grid" onOpen={open} onRename={rename} onDelete={remove} onHide={toggleHidden} onRestore={restore} onPurge={purge} onNewTab={(file) => window.open(urlOf(file), '_blank')} extraMenu={kind === 'forms' ? [{ label: '응답 시트 열기', icon: <ListChecks size={20} />, onClick: (file) => navigate(`/form/${file.id}/responses`) }] : []} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
