// /handover/:id: 운영위원회 인수인계 문서 편집기 (id = 탭 id).
// 화면 구조: 제목 줄(문서 제목 하나) / 메뉴 / 알약형 툴바 / 눈금자 / 왼쪽 문서 탭·개요 / 종이 / 오른쪽 여백 댓글.
// 열람: 관리자 로그인(manager 이상) 또는 열람 비밀번호. 편집·댓글·탭 관리: 관리자 로그인.
import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { alertDialog, confirmDialog, promptDialog } from '../../components/common/AppDialog'
import AccountMenu, { AVATAR_PURPLE, useMe } from '../../components/common/AccountMenu'
import ShareDialog, { useShareIcon } from '../../components/common/ShareDialog'
import NoAccess from '../../components/common/NoAccess'
import { DocsIcon } from '../workspace/icons'
import { useEditor, EditorContent } from '@tiptap/react'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import LinkExt from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextStyle from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import Color from '@tiptap/extension-color'
import {
  Undo2, Redo2, Printer, Bold, Italic, Underline as UIcon, Highlighter, Link2, MessageSquarePlus,
  ImagePlus, AlignLeft, AlignCenter, AlignRight, AlignJustify, ListChecks, List, ListOrdered,
  IndentDecrease, IndentIncrease, RemoveFormatting, Search, Star, Cloud, MessageSquareText, Lock,
  ChevronDown, ChevronRight, MoreVertical, Check, X, Pencil, Eye, ArrowLeft, FileText, Plus, ExternalLink, Unlink,
  KeyRound, Minus, Table as TableIcon, PanelLeft, Baseline, Copy, Trash2, Download, History,
  Variable, Upload, FileSearch, SpellCheck, PanelRight, SquareCheck, FileDown, Sparkles,
} from 'lucide-react'
import { api } from '../../hooks/useApi'
import { useAuth } from '../../context/AuthContext'
import { CommentMark, SecretNode, HandoverStorage, FontSize, Flash, flashKey } from './extensions'
import { download, safeName, toDocx, toHtml, toMarkdown, toPdf, toPlainText } from './exporters'
import './handoverDoc.css'
import './docTools.css'
import { DOC_EXTENSIONS } from './docExtensions'
import { ImageToolbar, TableToolbar } from './DocTools'
import PageSetupDialog from './PageSetupDialog'
import { insertTableFixed } from './tableOps'
import { FORMATS, exportDocument, getDefaultFormat, importDocument, previewDocument, setDefaultFormat, summarizeIssues } from './docExport'
import { normPage } from '../../lib/docIR/tiptapToIR'
import { HwpVar, HwpMarks, HwpTextStyle, LineHeight, repaintVars, setHwpView } from '../hwp/hwpExtensions'
import { HWP_FONTS, fontCss, hwpCss, hwpFontOf, metricsOf, normHwp, pageOf, walkMarks } from '../hwp/hwpDoc'
import { fillTokens, resolveVars } from '../hwp/hwpVars'
import { buildRequest, generateHwpx, lintHwp, parseHwpFile, previewHwpx, toHwpxPayload } from '../hwp/hwpExport'
import { guessPreset, markdownToHtml } from '../hwp/hwpImport'
import HwpPane from '../hwp/HwpPane'
import HwpPreview from '../hwp/HwpPreview'
import '../hwp/hwp.css'
import { createDocTools } from './aiDocTools'
import { buildQuickActions, buildSystemPrompt } from './aiDocPrompts'
import { getKnowledge } from '../../components/ai/knowledge'

// AI 창(공용 패널)은 다른 담당이 만든다. 파일이 아직 없어도 이 화면이 빌드되도록 glob 으로 느슨하게 불러온다.
import { useMcpRelay } from '../../components/ai/mcpRelay'
const AI_PANEL_LOADERS = import.meta.glob('../../components/ai/AiPanel.jsx')
const AiPanelLazy = AI_PANEL_LOADERS['../../components/ai/AiPanel.jsx']
  ? lazy(() => AI_PANEL_LOADERS['../../components/ai/AiPanel.jsx']().then((m) => ({ default: m.default || m.AiPanel })))
  : null

// AI 창이 오류를 내도 문서 화면 전체가 멈추지 않게 한다
class AiBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <div className="gd-ai__note">AI 창을 열지 못했습니다. 화면을 새로 고쳐 주세요</div> : this.props.children
  }
}

const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Pen+Script&family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@400;700&family=Gowun+Dodum&family=IBM+Plex+Sans+KR:wght@400;600&family=Roboto:wght@400;500;700&family=Montserrat:wght@400;700&family=Lora:wght@400;700&family=Merriweather:wght@400;700&family=Playfair+Display:wght@400;700&family=Open+Sans:wght@400;700&family=Lato:wght@400;700&display=swap'

const FONTS = [
  { label: 'Pretendard', value: '' },
  { label: '나눔고딕', value: "'Nanum Gothic'" },
  { label: '나눔명조', value: "'Nanum Myeongjo'" },
  { label: '나눔손글씨 펜', value: "'Nanum Pen Script'" },
  { label: 'Noto Sans KR', value: "'Noto Sans KR'" },
  { label: 'Noto Serif KR', value: "'Noto Serif KR'" },
  { label: '고운돋움', value: "'Gowun Dodum'" },
  { label: 'IBM Plex Sans KR', value: "'IBM Plex Sans KR'" },
  { label: 'Arial', value: 'Arial' },
  { label: 'Roboto', value: 'Roboto' },
  { label: 'Open Sans', value: "'Open Sans'" },
  { label: 'Lato', value: 'Lato' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Lora', value: 'Lora' },
  { label: 'Merriweather', value: 'Merriweather' },
  { label: 'Playfair Display', value: "'Playfair Display'" },
  { label: 'Times New Roman', value: "'Times New Roman'" },
  { label: 'Courier New', value: "'Courier New'" },
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS'" },
]
const SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96]
// 색 목록: 연한 색 없이 채도 높은 색과 무채색만
const COLORS = [
  '#000000', '#333333', '#666666', '#999999', '#ffffff',
  '#FF1744', '#FF3D00', '#FF9100', '#FFEA00', '#00E676',
  '#00E5FF', '#2979FF', '#7A3CFF', '#D500F9', '#F50057',
  '#D50000', '#DD2C00', '#FF6D00', '#FFD600', '#00C853',
  '#00B8D4', '#2962FF', '#6200EA', '#AA00FF', '#C51162',
]

const STYLE_OPTIONS = [
  { value: 'p', label: '일반 텍스트' },
  { value: 'h1', label: '제목' },
  { value: 'h2', label: '제목 1' },
  { value: 'h3', label: '제목 2' },
  { value: 'h4', label: '제목 3' },
]

const AVATAR_COLORS = ['#7A3CFF', '#0066FF', '#00C853', '#FF3D00', '#FF1744', '#D500F9', '#00B8D4']
const colorOf = () => AVATAR_PURPLE

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const h = d.getHours()
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getMonth() + 1}월 ${d.getDate()}일`
}

function linkify(text) {
  return String(text || '').split(/(https?:\/\/[^\s)]+)/g).map((p, i) =>
    /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\//, '')}</a> : <span key={i}>{p}</span>
  )
}

const newAnchorId = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// 문서 아이콘: 구글 독스와 같은 형태, 색은 전공 보라
function DocIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#7A3CFF" />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill="#4A12D9" />
      <rect x="13" y="18" width="14" height="2" rx="1" fill="#fff" />
      <rect x="13" y="23" width="14" height="2" rx="1" fill="#fff" />
      <rect x="13" y="28" width="9" height="2" rx="1" fill="#fff" />
    </svg>
  )
}

// 드롭다운: 화면 고정 위치로 띄워 툴바 스크롤 영역에 잘리지 않게 한다
function Dropdown({ trigger, children, align = 'left', className = '', disabled, width }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => {
      if (btn.current?.contains(e.target) || panel.current?.contains(e.target)) return
      setOpen(false)
    }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  function toggle(e) {
    if (disabled) return
    if (e.target.tagName === 'INPUT' && open) return
    const r = btn.current.getBoundingClientRect()
    setPos(align === 'right' ? { top: r.bottom + 4, right: window.innerWidth - r.right } : { top: r.bottom + 4, left: r.left })
    setOpen((v) => (e.target.tagName === 'INPUT' ? true : !v))
  }
  return (
    <>
      <span ref={btn} className="gd-dd-trigger" onMouseDown={(e) => e.target.tagName !== 'INPUT' && e.preventDefault()} onClick={toggle} aria-disabled={disabled || undefined}>
        {trigger(open)}
      </span>
      {open && (
        <div ref={panel} className={`gd-menu__panel gd-pop ${className}`} style={{ position: 'fixed', ...pos, width }} onMouseDown={(e) => e.preventDefault()}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </>
  )
}

function MenuItems({ items, close }) {
  const [sub, setSub] = useState(null)
  return items.map((it, i) =>
    it === '-' ? (
      <div key={i} className="gd-menu__sep" />
    ) : it.children ? (
      <div key={i} className="gd-menu__subwrap" onMouseEnter={() => setSub(i)} onMouseLeave={() => setSub(null)}>
        <button type="button" className="gd-menu__item" onClick={() => setSub(i)}>
          <span className="gd-menu__check">{it.icon || null}</span>
          <span className="gd-menu__label">{it.label}</span>
          <ChevronRight size={16} className="gd-menu__arrow" />
        </button>
        {sub === i && (
          <div className="gd-menu__panel gd-menu__sub">
            <MenuItems items={it.children} close={close} />
          </div>
        )}
      </div>
    ) : (
      <button key={i} type="button" className="gd-menu__item" disabled={it.disabled} onClick={() => { close(); it.onClick?.() }}>
        <span className="gd-menu__check">{it.checked ? <Check size={16} /> : it.icon || null}</span>
        <span className="gd-menu__label">{it.label}</span>
        {it.hint && <span className="gd-menu__hint">{it.hint}</span>}
      </button>
    )
  )
}

function TB({ icon: Icon, label, onClick, active, disabled, children }) {
  return (
    <button type="button" className={`gd-tb${active ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {Icon ? <Icon size={18} strokeWidth={1.8} /> : children}
    </button>
  )
}

function Lightbox({ images, index, onClose }) {
  const [i, setI] = useState(index)
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((v) => Math.min(images.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [images.length, onClose])
  return (
    <div className="gd-lightbox" onClick={onClose} role="dialog" aria-label="이미지 보기">
      <img src={images[i].url} alt={images[i].caption || ''} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="gd-lightbox__close" aria-label="닫기" onClick={onClose}><X size={22} /></button>
      {images.length > 1 && <span className="gd-lightbox__count">{i + 1} / {images.length}</span>}
    </div>
  )
}

function CommentCard({ c, active, canEdit, onActivate, onUpdate, onDelete, onOpenImage, style, cardRef }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.body)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  async function addImage(file) {
    setBusy(true)
    try {
      const r = await api.upload(file, { usage: 'general' })
      await onUpdate(c, { images: [...(c.images || []), { url: r.url, caption: '' }] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={cardRef} className={`gd-cc${active ? ' is-active' : ''}${c.resolved ? ' is-resolved' : ''}`} style={style} onClick={() => onActivate(c.anchor_id)}>
      <div className="gd-cc__head">
        <span className="gd-avatar" style={{ background: colorOf(c.author) }}>{(c.author || '?').slice(0, 1)}</span>
        <div className="gd-cc__who">
          <strong>{c.author || '익명'}</strong>
          <span>{fmtTime(c.created_at)}</span>
        </div>
        {canEdit && (
          <div className="gd-cc__actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="gd-icon-btn" title={c.resolved ? '다시 열기' : '해결됨으로 표시'} aria-label="해결" onClick={() => onUpdate(c, { resolved: !c.resolved })}>
              <Check size={18} />
            </button>
            <Dropdown align="right" trigger={() => <button type="button" className="gd-icon-btn" aria-label="옵션 더보기"><MoreVertical size={18} /></button>}>
              {(close) => (
                <MenuItems close={close} items={[
                  { label: '수정', onClick: () => setEditing(true) },
                  { label: '사진 추가', onClick: () => fileRef.current?.click() },
                  '-',
                  { label: '삭제', onClick: async () => { if (await confirmDialog({ message: '이 댓글을 삭제할까요?', tone: 'danger', confirmLabel: '삭제' })) onDelete(c) } },
                ]} />
              )}
            </Dropdown>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && addImage(e.target.files[0])} />
          </div>
        )}
      </div>
      {editing ? (
        <div className="gd-cc__edit" onClick={(e) => e.stopPropagation()}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
          <div className="gd-cc__btns">
            <button type="button" className="gd-btn-text" onClick={() => { setEditing(false); setDraft(c.body) }}>취소</button>
            <button type="button" className="gd-btn-blue" onClick={async () => { await onUpdate(c, { body: draft }); setEditing(false) }}>저장</button>
          </div>
        </div>
      ) : (
        c.body && <p className="gd-cc__body">{linkify(c.body)}</p>
      )}
      {c.images?.length > 0 && (
        <div className={`gd-cc__imgs n${Math.min(c.images.length, 4)}`}>
          {c.images.map((im, i) => (
            <button key={im.url + i} type="button" className="gd-cc__img" onClick={(e) => { e.stopPropagation(); onOpenImage(c.images, i) }}>
              <img src={im.url} alt={im.caption || ''} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {busy && <p className="gd-cc__note">사진 올리는 중</p>}
      {c.resolved && <p className="gd-cc__note">해결됨</p>}
    </div>
  )
}

function Composer({ draft, setDraft, onCancel, onSubmit, style, cardRef }) {
  const [busy, setBusy] = useState(false)
  const { user: staffUser } = useAuth()
  const { me } = useMe()
  const user = staffUser || me?.user || null
  const { body = '', images = [] } = draft

  async function pick(files) {
    setBusy(true)
    try {
      for (const f of files) {
        const r = await api.upload(f, { usage: 'general' })
        setDraft((v) => ({ ...v, images: [...(v.images || []), { url: r.url, caption: '' }] }))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={cardRef} className="gd-cc is-active gd-cc--composer" style={style}>
      <div className="gd-cc__head">
        <span className="gd-avatar" style={{ background: colorOf(user?.name) }}>{(user?.name || '?').slice(0, 1)}</span>
        <div className="gd-cc__who"><strong>{user?.name}</strong></div>
      </div>
      <textarea className="gd-cc__input" placeholder="댓글 또는 메모 추가" value={body} onChange={(e) => setDraft((v) => ({ ...v, body: e.target.value }))} rows={3} autoFocus />
      {images.length > 0 && (
        <div className={`gd-cc__imgs n${Math.min(images.length, 4)}`}>
          {images.map((im, i) => <span key={i} className="gd-cc__img"><img src={im.url} alt="" /></span>)}
        </div>
      )}
      <div className="gd-cc__opts">
        <label className="gd-chip-btn">
          <ImagePlus size={16} /> 사진
          <input type="file" accept="image/*" multiple hidden onChange={(e) => pick([...e.target.files])} />
        </label>
      </div>
      <div className="gd-cc__btns">
        <button type="button" className="gd-btn-text" onClick={onCancel}>취소</button>
        <button type="button" className="gd-btn-blue" disabled={busy || (!body.trim() && !images.length)} onClick={() => onSubmit({ body, images })}>
          {busy ? '올리는 중' : '댓글'}
        </button>
      </div>
    </div>
  )
}

// 문서 탭 한 줄: 선택 탭 재클릭 시 개요 접기, ⋮ 메뉴로 이름 바꾸기·복제·삭제
function TabRow({ tab, selected, collapsed, onSelect, canEdit, canDelete, onRename, onDuplicate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tab.title)
  useEffect(() => setName(tab.title), [tab.title])
  const commit = () => {
    setEditing(false)
    if (name.trim() && name !== tab.title) onRename(tab, name.trim())
    else setName(tab.title)
  }
  return (
    <div className={`gd-tab${selected ? ' is-on' : ''}`}>
      {selected ? (
        <button type="button" className="gd-tab__chev" aria-label={collapsed ? '개요 펼치기' : '개요 접기'} onClick={onSelect}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
      ) : (
        <span className="gd-tab__chev" />
      )}
      <FileText size={18} className="gd-tab__icon" />
      {editing ? (
        <input
          className="gd-tab__input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setName(tab.title); setEditing(false) }
          }}
        />
      ) : (
        <button type="button" className="gd-tab__name" title={tab.title} onClick={onSelect} onDoubleClick={() => canEdit && setEditing(true)}>
          {tab.title}
        </button>
      )}
      {canEdit && !editing && (
        <Dropdown className="gd-tab-menu" trigger={() => <button type="button" className="gd-tab__more" aria-label="탭 옵션"><MoreVertical size={16} /></button>}>
          {(close) => (
            <MenuItems close={close} items={[
              { label: '이름 바꾸기', icon: <Pencil size={16} />, onClick: () => setEditing(true) },
              { label: '탭 복제', icon: <Copy size={16} />, onClick: () => onDuplicate(tab) },
              '-',
              { label: '삭제', icon: <Trash2 size={16} />, disabled: !canDelete, onClick: () => onDelete(tab) },
            ]} />
          )}
        </Dropdown>
      )}
    </div>
  )
}


// 버전 기록 패널: 날짜별 묶음, 작성자·시각, 이름 지정, 선택 시 본문 미리보기
function dayLabel(iso) {
  const d = new Date(iso)
  const t = new Date()
  const y = new Date(t.getTime() - 86400000)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, t)) return '오늘'
  if (same(d, y)) return '어제'
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}
const KIND_LABEL = { restore: '복원한 버전', 'before-restore': '복원 직전 상태' }

function HistoryPanel({ versions, selId, latestId, onSelect, onRestore, onRename, onClose, canEdit, showChanges, setShowChanges, onlyNamed, setOnlyNamed }) {
  const list = versions.filter((v) => !onlyNamed || v.name)
  const groups = []
  for (const v of list) {
    const label = dayLabel(v.updated_at)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(v)
    else groups.push({ label, items: [v] })
  }
  return (
    <aside className="gd-history" aria-label="버전 기록">
      <div className="gd-history__head">
        <button type="button" className="gd-icon-btn" aria-label="버전 기록 닫기" onClick={onClose}><ArrowLeft size={20} /></button>
        <h2>버전 기록</h2>
      </div>
      <div className="gd-history__scroll">
        {groups.length === 0 && <p className="gd-history__empty">표시할 버전이 없습니다.</p>}
        {groups.map((g) => (
          <section key={g.label}>
            <h3>{g.label}</h3>
            {g.items.map((v) => {
              const t = new Date(v.updated_at)
              const hh = t.getHours()
              const time = `${t.getMonth() + 1}월 ${t.getDate()}일 ${hh < 12 ? '오전' : '오후'} ${hh % 12 === 0 ? 12 : hh % 12}:${String(t.getMinutes()).padStart(2, '0')}`
              return (
                <div key={v.id} className={`gd-ver${selId === v.id ? ' is-on' : ''}`} onClick={() => onSelect(v)}>
                  <div className="gd-ver__main">
                    <strong>{v.name || time}</strong>
                    {v.id === latestId && <span className="gd-ver__cur">현재 버전</span>}
                    {KIND_LABEL[v.kind] && <span className="gd-ver__kind">{KIND_LABEL[v.kind]}</span>}
                    {v.name && <span className="gd-ver__sub">{time}</span>}
                    <span className="gd-ver__by"><i style={{ background: colorOf(v.author) }} />{v.author || '익명'}</span>
                  </div>
                  {canEdit && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Dropdown align="right" trigger={() => <button type="button" className="gd-icon-btn" aria-label="버전 옵션"><MoreVertical size={18} /></button>}>
                        {(close) => (
                          <MenuItems close={close} items={[
                            { label: '이 버전 복원', disabled: v.id === latestId, onClick: () => onRestore(v) },
                            { label: v.name ? '이름 바꾸기' : '이 버전 이름 지정', onClick: () => onRename(v) },
                            ...(v.name ? [{ label: '이름 지우기', onClick: () => onRename(v, '') }] : []),
                          ]} />
                        )}
                      </Dropdown>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </div>
      <div className="gd-history__foot">
        <label><input type="checkbox" checked={onlyNamed} onChange={(e) => setOnlyNamed(e.target.checked)} /> 이름이 지정된 버전만 표시</label>
        <label><input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} /> 변경사항 표시</label>
      </div>
    </aside>
  )
}

const norm = (t) => t.replace(/\s+/g, ' ').trim()

function blockTexts(json) {
  const out = new Set()
  const walk = (n) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const t = norm((n.content || []).map((c) => c.text || '').join(''))
      if (t) out.add(t)
    } else (n.content || []).forEach(walk)
  }
  walk(json)
  return out
}

// 한글 모드: 기안문 두문(행정기관명, 수신, 경유, 제목)과 결문(발신명의, 결재선, 시행, 연락처). 작업 창 문서 정보에서 고친다
const spaced = (s) => [...String(s || '')].join(' ')
function GianHead({ hwp, onOpen }) {
  const v = hwp.vars
  const h = hwp.head || {}
  return (
    <div className="hw-frame hw-gian-head" onClick={onOpen} title="두문 고치기">
      <div className="org">{fillTokens(h.org, v) || '○○○'}</div>
      <div className="row"><b>{spaced('수신')}</b><span>{fillTokens(h.to, v)}</span></div>
      <div className="row"><b>(경유)</b><span>{fillTokens(h.via, v)}</span></div>
      <div className="row title"><b>{spaced('제목')}</b><span>{fillTokens(h.title, v)}</span></div>
    </div>
  )
}
function GianFoot({ hwp, onOpen }) {
  const v = hwp.vars
  const f = Object.fromEntries(Object.entries(hwp.foot || {}).map(([k, x]) => [k, fillTokens(x, v)]))
  return (
    <div className="hw-frame hw-gian-foot" onClick={onOpen} title="결문 고치기">
      <div className="end">끝.</div>
      <div className="sender">{f.sender || '○○○'}</div>
      <div className="bar" />
      <div className="line sign">{[f.drafter, f.reviewer, f.approver].filter(Boolean).map((s, i) => <span key={i}>{s}</span>)}</div>
      <div className="line"><span>협조자 {f.cooperator || ''}</span></div>
      <div className="line"><span>시행 {f.docNum || ''}</span><span>접수 {f.receive || ''}</span></div>
      <div className="line"><span>우 {f.zip || ''} {f.address || ''}</span><span>/ {f.site || ''}</span></div>
      <div className="line"><span>전화 {f.phone || ''}</span><span>/전송 {f.fax || ''}</span><span>/ {f.email || ''}</span><span>/ {f.disclosure || ''}</span></div>
    </div>
  )
}

// 머리말·꼬리말 장식: 첫 쪽 위와 마지막 쪽 아래에 보여 준다(내보낸 파일에서는 쪽마다 들어간다)
function PageDeco({ cfg, pg }) {
  const side = (spec, cls, style) => {
    if (!spec.text && !spec.image) return null
    const al = (a) => (a === 'center' || a === 'right' ? a : 'left')
    return (
      <div className={`gd-pagedeco ${cls}`} style={style}>
        {spec.image && <div className={`row ${al(spec.image.align)}`}><img src={spec.image.src} alt="머리말 그림" style={{ width: `${Math.round(((spec.image.wPt || 90) * 96) / 72)}px`, maxHeight: 'none' }} /></div>}
        {spec.text && <div className={`row ${al(spec.align)}`}>{spec.text}</div>}
      </div>
    )
  }
  return (
    <>
      {side(cfg.header, 'gd-pagedeco--head', { top: `${cfg.headerMm}mm`, left: `${pg.left}mm`, right: `${pg.right}mm` })}
      {(cfg.footer.text || cfg.footer.image || cfg.pageNumbers.on) && (
        <div className="gd-pagedeco gd-pagedeco--foot" style={{ bottom: `${cfg.footerMm}mm`, left: `${pg.left}mm`, right: `${pg.right}mm` }}>
          {cfg.footer.image && <div className={`row ${cfg.footer.image.align || 'left'}`}><img src={cfg.footer.image.src} alt="꼬리말 그림" style={{ width: `${Math.round(((cfg.footer.image.wPt || 90) * 96) / 72)}px`, maxHeight: 'none' }} /></div>}
          {cfg.footer.text && <div className={`row ${cfg.footer.align || 'center'}`}>{cfg.footer.text}</div>}
          {cfg.pageNumbers.on && <div className={`row ${cfg.pageNumbers.pos}`}>1</div>}
        </div>
      )}
    </>
  )
}

// 한글 모드 쪽 경계(근사): 양식의 위아래 여백을 뺀 본문 높이마다 점선을 긋는다. 정확한 쪽은 한글 미리보기에서 본다
const MM = 96 / 25.4
function PageGuides({ pageRef, pg, deps }) {
  const [n, setN] = useState(1)
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return undefined
    const usable = (pg.height - pg.top - pg.bottom) * MM
    const measure = () => {
      const pm = el.querySelector('.ProseMirror')
      const frames = [...el.querySelectorAll('.hw-frame')].reduce((a, f) => a + f.offsetHeight, 0)
      const h = (pm?.offsetHeight || 0) + frames
      setN(Math.max(1, Math.ceil(h / usable)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const pm = el.querySelector('.ProseMirror')
    if (pm) ro.observe(pm)
    return () => ro.disconnect()
  }, [pageRef, pg.height, pg.top, pg.bottom, deps])
  const usable = pg.height - pg.top - pg.bottom
  return (
    <>
      <style>{`.gd .gd-page{min-height:${n * pg.height}mm !important;}`}</style>
      {Array.from({ length: n - 1 }, (_, i) => (
        <div key={i} className="hw-guide" style={{ top: `${pg.top + (i + 1) * usable}mm` }} aria-hidden="true"><span>{i + 1}쪽 끝(대략)</span></div>
      ))}
    </>
  )
}

export default function HandoverDoc() {
  const { id } = useParams()
  const navigate = useNavigate()
  const loc = useLocation()
  const { pathname } = loc
  const base = pathname.startsWith('/docs') ? '/docs' : '/handover'
  const { user: staffUser } = useAuth()
  const { me } = useMe()
  const user = staffUser || me?.user || null
  const [shareOpen, setShareOpen] = useState(false)
  const [shareTick, setShareTick] = useState(0)
  const nav = (to) => navigate(`${to}${window.location.search}`)
  const [doc, setDoc] = useState(null)
  const ShareIcon = useShareIcon(doc?.ws_id, shareTick)
  const [tabs, setTabs] = useState([])
  const [docTitle, setDocTitle] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [comments, setComments] = useState([])
  const [access, setAccess] = useState({ loading: true })
  const [lastEdit, setLastEdit] = useState(null)
  const [saveState, setSaveState] = useState('saved')
  const [mode, setMode] = useState('edit')
  const [active, setActive] = useState(null)
  const [composer, setComposer] = useState(null)
  const [showComments, setShowComments] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth > 1100)
  const [outlineCollapsed, setOutlineCollapsed] = useState(false)
  const [zoom, setZoom] = useState(() => (window.innerWidth >= 1440 || window.innerWidth <= 1100 ? 100 : 90))
  const [outline, setOutline] = useState([])
  const [positions, setPositions] = useState({})
  const [lightbox, setLightbox] = useState(null)
  const [linkBubble, setLinkBubble] = useState(null)
  const [sizeDraft, setSizeDraft] = useState('11')
  const insertImageRef = useRef(null) // useEditor 안의 붙여넣기·드롭 처리가 최신 insertImage를 부르도록
  const [toast, setToast] = useState('')
  const [, force] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState([])
  const [selVer, setSelVer] = useState(null)
  const [olderTexts, setOlderTexts] = useState(null)
  const [showChanges, setShowChanges] = useState(true)
  const [onlyNamed, setOnlyNamed] = useState(false)
  // 한글 모드 설정(탭마다 content.hwp 에 함께 저장): 보기, 양식, 두문·결문, 자료값
  const [hwp, setHwp] = useState(() => normHwp(null))
  const hwpRef = useRef(hwp)
  // 쪽 설정(탭마다 content.page 에 함께 저장): 용지, 여백, 머리말·꼬리말, 쪽 번호
  const [page, setPage] = useState(null)
  const pageSetRef = useRef(null)
  const [pageDlg, setPageDlg] = useState(false)
  const [paneOpen, setPaneOpen] = useState(true)
  const [paneDocs, setPaneDocs] = useState(false) // Docs 모드에서 자료값을 넣으려고 연 작업 창
  const [paneTab, setPaneTab] = useState('char')
  const [focusVar, setFocusVar] = useState(null)
  const [preview, setPreview] = useState(null)
  const [lint, setLint] = useState(null)
  const importRef = useRef(null)
  const hwpOn = hwp.mode === 'hwp'
  const pageEff = normPage(page, hwpOn ? pageOf(hwp.preset) : null)
  const pgBox = (() => {
    const sz = typeof pageEff.size === 'object' ? pageEff.size : { A4: [210, 297], B5: [176, 250], Letter: [215.9, 279.4], A3: [297, 420] }[pageEff.size] || [210, 297]
    const [a, b] = Array.isArray(sz) ? sz : [sz.wMm, sz.hMm]
    const land = pageEff.orientation === 'landscape'
    return { width: land ? Math.max(a, b) : Math.min(a, b), height: land ? Math.min(a, b) : Math.max(a, b), top: pageEff.marginMm.top, bottom: pageEff.marginMm.bottom, left: pageEff.marginMm.left, right: pageEff.marginMm.right }
  })()
  const [fmt, setFmt] = useState('hwpx')
  const liveRef = useRef(null)
  const canvasRef = useRef(null)
  const pageRef = useRef(null)
  const cardRefs = useRef({})
  const saveTimer = useRef(null)
  const flashTimer = useRef(null)
  const canEdit = access.canEdit === true

  const flash = (t, ms = 2400) => {
    setToast(t)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setToast(''), ms)
  }

  // 구글 폰트(나눔고딕, 노토 산스 등)는 이 화면에서만 불러온다
  useEffect(() => {
    if (document.getElementById('gd-fonts')) return
    const l = document.createElement('link')
    l.id = 'gd-fonts'
    l.rel = 'stylesheet'
    l.href = GOOGLE_FONTS_HREF
    document.head.appendChild(l)
  }, [])

  useEffect(() => {
    let off = false
    setComposer(null)
    setActive(null)
    ;(async () => {
      try {
        const d = await api.get(`/handover/docs/${id}`)
        const ws = d.item.ws_id
        const [list, cm, meta] = await Promise.all([
          api.get('/handover/docs', { ws }),
          api.get(`/handover/docs/${id}/comments`),
          api.get('/handover/meta', { ws }),
        ])
        if (off) return
        const h = normHwp(d.item.content?.hwp)
        hwpRef.current = h
        setHwp(h)
        pageSetRef.current = d.item.content?.page || null
        setPage(d.item.content?.page || null)
        setLint(null)
        setDoc(d.item)
        docWsRef.current = ws
        setFmt(getDefaultFormat(ws))
        setTabs(list.items)
        setComments(cm.items)
        setDocTitle(meta.title)
        setTitleDraft(meta.title)
        setLastEdit(meta.last_edit || null)
        setAccess({ loading: false, access: d.access, canEdit: d.canEdit })
        setMode(d.canEdit ? 'edit' : 'view')
        document.title = `${meta.title} | 디인예 워크스페이스`
      } catch (e) {
        if (off) return
        if (e?.status === 401 || e?.status === 403) setAccess({ loading: false, denied: true })
        else if (e?.status === 404) setAccess({ loading: false, denied: true, notFound: true })
        else setAccess({ loading: false, error: true })
      }
    })()
    return () => {
      off = true
    }
  }, [id, navigate])

  const docWsRef = useRef(null)
  const save = useCallback(
    async (ed) => {
      if (!canEdit) return
      setSaveState('saving')
      try {
        await api.put(`/handover/docs/${id}`, { content: { ...ed.getJSON(), hwp: hwpRef.current, page: pageSetRef.current } })
        setSaveState('saved')
        // 마지막으로 수정한 위치(커서가 있는 문단)를 기록한다. 이후 "마지막으로 수정"을 누르면 그 문단으로 이동한다.
        const { $from } = ed.state.selection
        const text = ($from.parent.textContent || $from.node(1)?.textContent || '').trim().slice(0, 120)
        if (docWsRef.current) {
          api.put(`/workspace/files/${docWsRef.current}/last-edit`, { tab: String(id), text })
            .then((r) => setLastEdit(r.last_edit))
            .catch(() => {})
        }
      } catch {
        setSaveState('error')
      }
    },
    [canEdit, id]
  )

  function refreshOutline(ed) {
    const out = []
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading' && n.attrs.level > 1 && n.textContent.trim()) out.push({ level: n.attrs.level, text: n.textContent, pos })
    })
    setOutline(out)
  }

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
        Underline,
        LinkExt.configure({ openOnClick: false, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noreferrer' } }),
        ...DOC_EXTENSIONS,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Highlight.configure({ multicolor: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TextStyle,
        Flash,
        FontFamily,
        FontSize,
        Color,
        CommentMark,
        SecretNode,
        HandoverStorage,
        HwpVar,
        HwpMarks,
        HwpTextStyle,
        LineHeight,
      ],
      content: doc ? doc.content || doc.content_html || '<p></p>' : '',
      editable: false,
      // 캡처 붙여넣기(⌘V)와 파일 끌어다 놓기: 이미지 파일이면 업로드해서 넣는다.
      editorProps: {
        handlePaste: (view, event) => {
          if (!view.editable) return false
          const files = [...(event.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type))
          if (!files.length) return false
          event.preventDefault()
          ;(async () => { for (const f of files) await insertImageRef.current?.(f) })()
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved || !view.editable) return false
          const files = [...(event.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type))
          if (!files.length) return false
          event.preventDefault()
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          ;(async () => { for (const f of files) await insertImageRef.current?.(f, at) })()
          return true
        },
      },
      onUpdate: ({ editor: ed, transaction }) => {
        refreshOutline(ed)
        if (!ed.isEditable || !transaction?.docChanged) return
        setSaveState('dirty')
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => save(ed), 1200)
      },
      onSelectionUpdate: ({ editor: ed }) => {
        force((v) => v + 1)
        const fs = ed.getAttributes('textStyle').fontSize
        setSizeDraft(fs ? String(parseFloat(fs)) : ed.storage.hwpMarks?.on ? String(metricsOf(ed.storage.hwpMarks.preset).body.pt) : '11')
        if (!ed.isActive('link')) {
          setLinkBubble(null)
          return
        }
        const c = ed.view.coordsAtPos(ed.state.selection.from)
        const box = pageRef.current?.getBoundingClientRect()
        if (!box) return
        const scale = box.width / pageRef.current.offsetWidth || 1
        setLinkBubble({ href: ed.getAttributes('link').href, top: (c.bottom - box.top) / scale + 6, left: (c.left - box.left) / scale })
      },
    },
    [doc?.id]
  )

  // 한글 모드 보기와 자료값을 편집기에 알린다(자료값 칸을 누르면 작업 창 자료값으로)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.storage.hwpVar.vars = hwp.vars
    editor.storage.hwpVar.onPick = (attrs) => {
      setFocusVar(attrs.key || null)
      setPaneTab('vars')
      setPaneOpen(true)
      setPaneDocs(true)
    }
    repaintVars(editor)
    setHwpView(editor, hwp.mode === 'hwp', hwp.preset)
  }, [editor, hwp])

  const updateHwp = useCallback(
    (patch) => {
      const next = { ...hwpRef.current, ...patch }
      hwpRef.current = next
      setHwp(next)
      if (!canEdit || !editor) return
      setSaveState('dirty')
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => save(editor), 1200)
    },
    [canEdit, editor, save]
  )
  function switchMode(m) {
    if (m === hwpRef.current.mode) return
    updateHwp({ mode: m })
    if (m === 'hwp') {
      if (!aiOpenRef.current) setPaneOpen(true) // AI 창이 열려 있으면 종이가 좁아지지 않게 작업 창은 접어 둔다
      if (!comments.length) setShowComments(false)
    }
  }

  // ── AI 창: 열림 상태는 사용자별로 기억한다
  const aiUserKey = `dah.ai.doc.open:${user?.id ?? user?.email ?? user?.name ?? 'guest'}`
  const [aiOpen, setAiOpen] = useState(false)
  const aiOpenRef = useRef(false)
  useEffect(() => {
    let v = false
    try { v = localStorage.getItem(aiUserKey) === '1' } catch { /* 저장소 사용 불가 */ }
    aiOpenRef.current = v
    setAiOpen(v)
  }, [aiUserKey])
  const toggleAi = useCallback((next) => {
    const v = typeof next === 'boolean' ? next : !aiOpenRef.current
    aiOpenRef.current = v
    setAiOpen(v)
    // 한글 모드에서는 작업 창과 AI 창이 함께 있으면 종이가 너무 좁아지므로 AI 창을 열 때 작업 창을 접는다
    if (v && hwpRef.current.mode === 'hwp') setPaneOpen(false)
    try { localStorage.setItem(aiUserKey, v ? '1' : '0') } catch { /* 저장소 사용 불가 */ }
  }, [aiUserKey])
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'j') {
        e.preventDefault()
        toggleAi()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [toggleAi])
  const aiLive = useRef({})
  aiLive.current = { editor, canEdit, mode, historyOpen, doc, docTitle, comments, tabTitle: tabs.find((x) => String(x.id) === String(id))?.title, save, updateHwp, pageEff, page }
  const aiTools = useMemo(
    () => createDocTools({
      getEditor: () => aiLive.current.editor,
      editBlock: () => {
        const c = aiLive.current
        if (!c.canEdit) return '이 문서를 고칠 권한이 없습니다(보기 전용)'
        if (c.historyOpen) return '버전 기록을 보는 중에는 고칠 수 없습니다. 기록 창을 닫아 주세요'
        if (c.mode !== 'edit') return '지금은 보기 모드입니다. 수정 모드로 바꿔 주세요'
        return ''
      },
      getHwp: () => ({ mode: hwpRef.current.mode, preset: hwpRef.current.preset }),
      getTabTitle: () => aiLive.current.tabTitle || '',
      getTitle: () => aiLive.current.docTitle || '',
      setTitle: async (t) => {
        await api.put('/handover/meta', { ws: aiLive.current.doc.ws_id, title: t })
        setDocTitle(t)
        setTitleDraft(t)
        document.title = `${t} | 디인예 워크스페이스`
      },
      hwpMarks: (d) => {
        const m = new Map()
        walkMarks(d, hwpRef.current.preset, (kind, node, pos, info) => { if (info?.mark) m.set(pos, info.mark) })
        return m
      },
      runLint: async () => {
        const ed2 = aiLive.current.editor
        const { markdown } = toHwpxPayload(ed2.getJSON(), hwpRef.current)
        const r = await lintHwp(markdown, hwpRef.current.preset)
        const items = [...(r.gongmun || []), ...(r.munche || [])]
        setLint({ items })
        return items
      },
      commentCount: () => aiLive.current.comments.length,
      notify: (m) => flash(m),
      getComments: () => aiLive.current.comments,
      addComment: async ({ from, to, quote, body }) => {
        const L = aiLive.current
        try {
          const anchorId = newAnchorId()
          const r = await api.post(`/handover/docs/${id}/comments`, { anchor_id: anchorId, side: 'right', quote, body, images: [] })
          L.editor.chain().setTextSelection({ from, to }).setMark('comment', { id: anchorId }).run()
          L.save(L.editor)
          setComments((v) => [...v, r.item])
          setShowComments(true)
          return { ok: true, id: r.item.id }
        } catch (e) {
          return { ok: false, error: e?.message || '댓글을 저장하지 못했습니다' }
        }
      },
      replyComment: async ({ anchor_id, quote, body }) => {
        try {
          const r = await api.post(`/handover/docs/${id}/comments`, { anchor_id, side: 'right', quote, body, images: [] })
          setComments((v) => [...v, r.item])
          return { ok: true, id: r.item.id }
        } catch (e) {
          return { ok: false, error: e?.message || '답글을 저장하지 못했습니다' }
        }
      },
      updateComment: async (c, patch) => {
        const r = await api.put(`/handover/comments/${c.id}`, patch)
        setComments((v) => v.map((x) => (x.id === c.id ? r.item : x)))
      },
      deleteComment: async (cid, opts = {}) => {
        const L = aiLive.current
        const c = L.comments.find((x) => x.id === cid)
        await api.del(`/handover/comments/${cid}`)
        setComments((v) => v.filter((x) => x.id !== cid))
        if (c && !opts.keepMark && !L.comments.some((x) => x.id !== cid && x.anchor_id === c.anchor_id) && L.editor) {
          const tr = L.editor.state.tr
          L.editor.state.doc.descendants((n, pos) => {
            if (n.marks?.some((m) => m.type.name === 'comment' && m.attrs.id === c.anchor_id)) tr.removeMark(pos, pos + n.nodeSize, L.editor.schema.marks.comment)
          })
          if (tr.docChanged) { L.editor.view.dispatch(tr); L.save(L.editor) }
        }
      },
      getPage: () => aiLive.current.pageEff,
      getRawPage: () => pageSetRef.current,
      setPage: (p) => {
        const L = aiLive.current
        pageSetRef.current = p
        setPage(p)
        if (L.canEdit && L.editor) {
          setSaveState('dirty')
          clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => L.save(L.editor), 600)
        }
      },
      updateHwp: (patch) => aiLive.current.updateHwp(patch),
      getHwpFull: () => hwpRef.current,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const aiToolList = useMemo(() => aiTools.tools.filter((x) => x.name !== 'run_gongmun_check' || hwpOn), [aiTools, hwpOn])
  const aiSystem = useMemo(() => buildSystemPrompt({ hwp: { mode: hwp.mode, preset: hwp.preset }, knowledge: getKnowledge('docs') }), [hwp.mode, hwp.preset])
  const aiQuick = useMemo(() => buildQuickActions({ hwpOn }), [hwpOn])
  const aiGetContext = useCallback(() => aiTools.getContext(), [aiTools])
  const mcpRelay = useMcpRelay({ fileId: doc?.ws_id, kind: 'doc', tools: aiToolList, canEdit })

  useEffect(() => {
    if (!editor) return
    editor.storage.handover.canEdit = canEdit
    editor.setEditable(canEdit && mode === 'edit' && !historyOpen)
    refreshOutline(editor)
  }, [editor, canEdit, mode, historyOpen])

  useEffect(() => {
    const h = (e) => {
      if (saveState === 'dirty' || saveState === 'saving') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [saveState])

  const visibleComments = useMemo(() => comments.filter((c) => showResolved || !c.resolved), [comments, showResolved])

  // 댓글 위치: 앵커 문장 높이에 맞추고 카드끼리 겹치지 않게 밀어낸다. 활성 카드는 문장 높이 고정.
  const layout = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cBox = canvas.getBoundingClientRect()
    const scale = cBox.width / canvas.offsetWidth || 1
    const want = []
    for (const c of visibleComments) {
      const el = canvas.querySelector(`[data-comment="${CSS.escape(c.anchor_id)}"]`)
      if (el) want.push({ key: `c${c.id}`, top: (el.getBoundingClientRect().top - cBox.top) / scale, anchor: c.anchor_id })
    }
    if (composer) want.push({ key: 'composer', top: composer.top, anchor: composer.anchorId })
    want.sort((a, b) => a.top - b.top)
    const h = (w) => (cardRefs.current[w.key]?.offsetHeight || 80) + 10
    const next = {}
    const ai = want.findIndex((w) => w.anchor === active || w.key === 'composer')
    if (ai < 0) {
      let y = -Infinity
      for (const w of want) {
        const t = Math.max(w.top, y)
        next[w.key] = t
        y = t + h(w)
      }
    } else {
      next[want[ai].key] = want[ai].top
      let y = want[ai].top
      for (let i = ai - 1; i >= 0; i -= 1) {
        const t = Math.min(want[i].top, y - h(want[i]))
        next[want[i].key] = t
        y = t
      }
      y = want[ai].top + h(want[ai])
      for (let i = ai + 1; i < want.length; i += 1) {
        const t = Math.max(want[i].top, y)
        next[want[i].key] = t
        y = t + h(want[i])
      }
    }
    setPositions((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [visibleComments, composer, active])

  useLayoutEffect(() => {
    layout()
  })

  // 카드 안 사진이 늦게 로드되며 높이가 바뀌어도 다시 배치(겹침 방지)
  useEffect(() => {
    const ro = new ResizeObserver(() => layout())
    document.querySelectorAll('.gd-rail .gd-cc').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [layout, visibleComments, composer, showComments])

  useEffect(() => {
    const ro = new ResizeObserver(() => layout())
    if (canvasRef.current) ro.observe(canvasRef.current)
    window.addEventListener('resize', layout)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', layout)
    }
  }, [layout])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const h = (e) => {
      const m = e.target.closest?.('[data-comment]')
      if (m && pageRef.current?.contains(m)) setActive(m.getAttribute('data-comment'))
      else if (!e.target.closest?.('.gd-cc')) setActive(null)
    }
    canvas.addEventListener('click', h)
    return () => canvas.removeEventListener('click', h)
  })


  const highlightCss = useMemo(() => {
    const live = new Set(visibleComments.filter((c) => !c.resolved).map((c) => c.anchor_id))
    const rules = [...live].map((a) => `.gd-page [data-comment="${CSS.escape(a)}"]{background:#FFEA00}`)
    if (active) rules.push(`.gd-page [data-comment="${CSS.escape(active)}"]{background:#FFB300}`)
    return rules.join('\n')
  }, [visibleComments, active])

  function startComment() {
    if (!editor || !canEdit) return
    const { from, to, empty } = editor.state.selection
    if (empty) {
      flash('댓글을 달 문장을 먼저 선택')
      return
    }
    setShowComments(true)
    const c = editor.view.coordsAtPos(from)
    const box = canvasRef.current.getBoundingClientRect()
    const scale = box.width / canvasRef.current.offsetWidth || 1
    const anchorId = newAnchorId()
    setComposer({ from, to, anchorId, top: (c.top - box.top) / scale, quote: editor.state.doc.textBetween(from, to, ' '), body: '', images: [] })
    setActive(anchorId)
  }

  async function submitComment({ body, images }) {
    const cmp = composer
    const r = await api.post(`/handover/docs/${id}/comments`, { anchor_id: cmp.anchorId, side: 'right', quote: cmp.quote, body, images })
    const was = editor.isEditable
    if (!was) editor.setEditable(true)
    editor.chain().setTextSelection({ from: cmp.from, to: cmp.to }).setMark('comment', { id: cmp.anchorId }).run()
    if (!was) editor.setEditable(false)
    save(editor)
    setComments((v) => [...v, r.item])
    setComposer(null)
    setActive(cmp.anchorId)
  }

  async function updateComment(c, patch) {
    const r = await api.put(`/handover/comments/${c.id}`, patch)
    setComments((v) => v.map((x) => (x.id === c.id ? r.item : x)))
  }

  async function deleteComment(c) {
    await api.del(`/handover/comments/${c.id}`)
    setComments((v) => v.filter((x) => x.id !== c.id))
    if (!comments.some((x) => x.id !== c.id && x.anchor_id === c.anchor_id) && editor) {
      const tr = editor.state.tr
      let hit = false
      editor.state.doc.descendants((n, pos) => {
        if (n.marks?.some((m) => m.type.name === 'comment' && m.attrs.id === c.anchor_id)) {
          tr.removeMark(pos, pos + n.nodeSize, editor.schema.marks.comment)
          hit = true
        }
      })
      if (hit) {
        editor.view.dispatch(tr)
        save(editor)
      }
    }
  }

  // 탭 관리
  async function addTab(content) {
    const r = await api.post('/handover/docs', content ? { ws: doc.ws_id, title: content.title, content: content.json } : { ws: doc.ws_id })
    setTabs((t) => [...t, r.item])
    nav(`${base}/${r.item.id}`)
  }
  async function renameTab(tab, title) {
    await api.put(`/handover/docs/${tab.id}`, { title })
    setTabs((t) => t.map((x) => (x.id === tab.id ? { ...x, title } : x)))
  }
  async function duplicateTab(tab) {
    const json = String(tab.id) === String(id) ? { ...editor.getJSON(), hwp: hwpRef.current, page: pageSetRef.current } : (await api.get(`/handover/docs/${tab.id}`)).item.content
    await addTab({ title: `${tab.title} 사본`, json })
  }
  async function deleteTab(tab) {
    if (!(await confirmDialog({ title: '탭 삭제', message: `'${tab.title}' 탭을 삭제할까요? 탭 안의 내용과 댓글이 함께 삭제됩니다.`, tone: 'danger', confirmLabel: '삭제' }))) return
    await api.del(`/handover/docs/${tab.id}`)
    const rest = tabs.filter((x) => x.id !== tab.id)
    setTabs(rest)
    if (String(tab.id) === String(id)) nav(`${base}/${rest[0].id}`)
  }

  async function saveDocTitle() {
    const t = titleDraft.trim()
    if (!canEdit || !t || t === docTitle) {
      setTitleDraft(docTitle)
      return
    }
    await api.put('/handover/meta', { ws: doc.ws_id, title: t })
    setDocTitle(t)
    document.title = `${t} | 디인예 워크스페이스`
  }


  // 버전 기록
  async function openHistory() {
    if (!editor) return
    clearTimeout(saveTimer.current)
    if (saveState === 'dirty') await save(editor)
    liveRef.current = editor.getJSON()
    const r = await api.get(`/handover/docs/${id}/versions`)
    setVersions(r.items)
    setHistoryOpen(true)
    if (r.items[0]) await pickVersion(r.items[0], r.items)
  }
  async function pickVersion(v, list = versions) {
    setSelVer(v.id)
    const idx = list.findIndex((x) => x.id === v.id)
    const full = (await api.get(`/handover/versions/${v.id}`)).item
    const older = list[idx + 1] ? (await api.get(`/handover/versions/${list[idx + 1].id}`)).item.content : null
    editor.setEditable(false)
    editor.commands.setContent(full.content?.html || full.content, false)
    setOlderTexts(older ? blockTexts(older.html ? generateJSON(older.html, editor.extensionManager.extensions) : older) : null)
  }
  function closeHistory() {
    if (liveRef.current) editor.commands.setContent(liveRef.current, false)
    editor.setEditable(canEdit && mode === 'edit')
    setHistoryOpen(false)
    setSelVer(null)
    setOlderTexts(null)
  }
  async function restoreVersion(v) {
    if (!(await confirmDialog({ title: '버전 복원', message: '이 버전으로 복원할까요? 지금 상태도 버전 기록에 남습니다.', confirmLabel: '복원' }))) return
    const r = await api.post(`/handover/versions/${v.id}/restore`)
    liveRef.current = r.content
    setHistoryOpen(false)
    setSelVer(null)
    setOlderTexts(null)
    editor.commands.setContent(r.content?.html || r.content, false)
    if (r.content?.hwp) {
      const h = normHwp(r.content.hwp)
      hwpRef.current = h
      setHwp(h)
    }
    pageSetRef.current = r.content?.page || null
    setPage(r.content?.page || null)
    editor.setEditable(canEdit && mode === 'edit')
    refreshOutline(editor)
    setSaveState('saved')
    flash('버전을 복원했습니다')
  }
  async function renameVersion(v, forced) {
    const name = forced !== undefined ? forced : await promptDialog({ title: '버전 이름', label: '이름', defaultValue: v.name || '', confirmLabel: '저장' })
    if (name === null) return
    const r = await api.put(`/handover/versions/${v.id}`, { name })
    setVersions((list) => list.map((x) => (x.id === v.id ? { ...x, name: r.item.name } : x)))
  }

  // 미리보기 중 바뀐 문단을 초록으로 표시
  useEffect(() => {
    if (!editor || !historyOpen) return undefined
    const t = setTimeout(() => {
      editor.view.dom.querySelectorAll('p, h1, h2, h3, h4').forEach((el) => {
        const c = el.cloneNode(true)
        c.querySelectorAll('.gd-secret, .gd-secret-wrap').forEach((x) => x.remove())
        const txt = norm(c.textContent)
        el.classList.toggle('gd-changed', Boolean(showChanges && olderTexts && txt && !olderTexts.has(txt)))
      })
    }, 80)
    return () => clearTimeout(t)
  }, [editor, historyOpen, showChanges, olderTexts, selVer])

  async function setLink() {
    const prev = editor.getAttributes('link').href || ''
    const url = await promptDialog({ title: '링크', label: '링크 주소', defaultValue: prev, confirmLabel: '적용' })
    if (url === null) return
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^https?:|^mailto:|^\//.test(url) ? url : `https://${url}` }).run()
  }

  // 이미지 넣기: 툴바 버튼, 붙여넣기(캡처 ⌘V), 끌어다 놓기가 모두 이 함수를 쓴다.
  // 실패하면 이유를 알려 준다(예전에는 조용히 아무 일도 일어나지 않았다).
  async function insertImage(file, pos) {
    if (!file || !/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || '')) return
    if (file.size > 20 * 1024 * 1024) { await alertDialog({ message: '이미지는 20MB 이하만 넣을 수 있습니다.' }); return }
    try {
      const r = await api.upload(file, { usage: 'general' })
      if (!r?.url) throw new Error('업로드 응답에 주소가 없습니다')
      const chain = editor.chain().focus()
      if (typeof pos === 'number') chain.insertContentAt(pos, { type: 'image', attrs: { src: r.url } }).run()
      else chain.setImage({ src: r.url }).run()
    } catch (err) {
      const why = err?.status === 401 || err?.status === 403 ? '로그인이 풀렸거나 권한이 없습니다. 다시 로그인한 뒤 시도하세요.' : (err?.message || '알 수 없는 오류')
      await alertDialog({ message: `이미지를 올리지 못했습니다. ${why}` })
    }
  }
  insertImageRef.current = insertImage

  async function insertSecret() {
    const label = await promptDialog({ title: '비밀값 추가', label: '이름 (예: 공식 Gmail 비밀번호)', confirmLabel: '다음' })
    if (!label) return
    const value = await promptDialog({ title: label, label: '값', confirmLabel: '저장' })
    if (!value) return
    const r = await api.post('/handover/secrets', { label, value })
    editor.chain().focus().insertContent({ type: 'secret', attrs: { id: r.item.id, label } }).run()
  }

  const fileBase = () => safeName(tabs.length > 1 ? `${docTitle} - ${doc?.title || ''}` : docTitle)
  const plainJson = () => resolveVars(editor.getJSON(), hwpRef.current.vars)

  // 한글(HWPX): 서버 kordoc 엔진이 만들고 구조 검사를 통과한 파일만 내려준다
  async function hwpBody() {
    const { body, dropped } = await buildRequest(editor.getJSON(), hwpRef.current, fileBase())
    if (dropped) flash(`그림 ${dropped}개는 넣지 못했습니다`)
    return body
  }
  // 한글(HWPX), Word(DOCX): 편집기 문서 -> IR -> 형식별 작성기. 작성기를 불러오지 못하면 옛 방식(한글은 서버 마크다운 경로)으로 만든다
  async function runExport(format) {
    if (!editor || !doc) return
    setDefaultFormat(doc.ws_id, format)
    setFmt(format)
    try {
      const r = await exportDocument(format, {
        editor,
        hwp: hwpRef.current,
        page: pageSetRef.current,
        title: docTitle,
        fileBase: fileBase(),
        progress: (t) => flash(t, 30000),
        legacy: {
          hwpx: async () => { const { blob } = await generateHwpx(await hwpBody()); download(blob, `${fileBase()}.hwpx`) },
          docx: async () => { download(await toDocx(plainJson(), docTitle), `${fileBase()}.docx`) },
        },
      })
      const note = summarizeIssues(r.issues)
      flash(`${FORMATS[format].label} 저장 완료${r.fallback ? ' (간단 변환)' : ''}${note ? `. 확인할 점: ${note}` : ''}`, note || r.fallback ? 8000 : 2800)
    } catch (e) {
      flash(`${FORMATS[format].label} 저장 실패: ${e.message}`, 7000)
    }
  }
  const saveHwpx = () => runExport('hwpx')
  async function openPreview() {
    if (!editor) return
    setPreview({ loading: true })
    try {
      // 내보내기와 같은 작성기로 만든 한글 파일을 그린다(병합·칸 색·쪽 설정이 실제 결과와 같게 보인다)
      const r = await previewDocument({ editor, hwp: hwpRef.current, page: pageSetRef.current, title: docTitle })
      setPreview(r || (await previewHwpx(await hwpBody())))
    } catch (e) {
      try {
        setPreview(await previewHwpx(await hwpBody()))
      } catch {
        setPreview({ error: `미리보기 실패: ${e.message}` })
      }
    }
  }
  async function runLint() {
    if (!editor) return
    setPaneOpen(true)
    setPaneTab('lint')
    setLint({ loading: true })
    try {
      const { markdown } = toHwpxPayload(editor.getJSON(), hwpRef.current)
      const r = await lintHwp(markdown, hwpRef.current.preset)
      setLint({ items: [...(r.gongmun || []), ...(r.munche || [])] })
    } catch (e) {
      setLint({ error: e.message })
    }
  }
  function jumpTo(q) {
    if (!editor || !q) return
    const tries = [q, q.replace(/^[-*>#\s]+/, '').replace(/[*_\\]/g, ''), q.replace(/^[-*>#\s]+/, '').slice(0, 12)].filter((x) => x && x.trim())
    let hit = null
    for (const t of tries) {
      editor.state.doc.descendants((n, pos) => {
        if (hit || !n.isText) return
        const i = n.text.indexOf(t)
        if (i >= 0) hit = { from: pos + i, to: pos + i + t.length }
      })
      if (hit) break
    }
    if (!hit) {
      flash('본문에서 찾지 못했습니다')
      return
    }
    editor.chain().focus().setTextSelection(hit).scrollIntoView().run()
  }
  // 가져오기: 한글·Word·PDF 파일을 읽어 새 탭으로 넣는다(한글 파일은 한글 모드로)
  async function importFile(file) {
    if (!file || !editor) return
    if (file.size > 15 * 1024 * 1024) {
      flash('15MB 이하 파일만 가져올 수 있습니다')
      return
    }
    flash('파일 읽는 중', 30000)
    try {
      let viaIR = null
      try {
        viaIR = await importDocument(file, { upload: (f) => api.upload(f, { usage: 'general' }) })
      } catch {
        viaIR = null // 읽기기가 못 읽으면 아래 옛 방식으로
      }
      if (viaIR) {
        await addTab({ title: viaIR.title, json: { ...viaIR.json, hwp: normHwp({ mode: 'docs' }), page: viaIR.page } })
        const note = summarizeIssues(viaIR.issues)
        flash(`새 탭으로 가져왔습니다${note ? `. 확인할 점: ${note}` : ''}`, note ? 7000 : 2800)
        return
      }
      const r = await parseHwpFile(file)
      const json = generateJSON(markdownToHtml(r.markdown), editor.extensionManager.extensions)
      const isHwp = /^hwpx?$/i.test(r.fileType || '') || /\.hwpx?$/i.test(file.name)
      await addTab({ title: String(r.title || file.name).slice(0, 60), json: { ...json, hwp: normHwp({ mode: isHwp ? 'hwp' : 'docs', preset: guessPreset(r.markdown) }) } })
      flash('새 탭으로 가져왔습니다')
    } catch (e) {
      flash(e.message)
    }
  }

  async function exportAs(kind) {
    try {
      if (kind === 'hwpx' || kind === 'docx') {
        await runExport(kind)
      } else if (kind === 'pdf') {
        flash('PDF 만드는 중')
        await toPdf(pageRef.current, fileBase())
      } else if (kind === 'md') {
        download(new Blob([toMarkdown(plainJson(), `${docTitle} - ${doc.title}`)], { type: 'text/markdown;charset=utf-8' }), `${fileBase()}.md`)
      } else if (kind === 'txt') {
        download(new Blob([toPlainText(plainJson())], { type: 'text/plain;charset=utf-8' }), `${fileBase()}.txt`)
      } else if (kind === 'html') {
        download(new Blob([toHtml(editor.getHTML(), docTitle)], { type: 'text/html;charset=utf-8' }), `${fileBase()}.html`)
      }
    } catch (e) {
      flash(`내보내기 실패: ${e.message}`)
    }
  }

  // Google Docs로 옮기기: 서식 그대로 클립보드에 복사한 뒤 새 구글 문서를 연다(붙여넣기 한 번)
  async function openInGoogleDocs() {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([toHtml(editor.getHTML(), docTitle)], { type: 'text/html' }),
          'text/plain': new Blob([toPlainText(plainJson())], { type: 'text/plain' }),
        }),
      ])
      flash('서식 포함 복사 완료. 새 구글 문서에서 ⌘V')
    } catch {
      flash('복사 실패. Word(.docx) 다운로드 후 구글 드라이브에서 열기')
    }
    window.open('https://docs.new', '_blank')
  }

  // "마지막으로 수정": 수정한 문단으로 이동해 잠깐 노랗게 표시한다(다른 탭에서 고쳤다면 그 탭으로 먼저 이동)
  // 위치 기록이 없는 문서(공개 전에 고친 문서)는 가장 최근 두 버전을 비교해 바뀐 문단을 찾는다
  const deriveFromVersions = useCallback(async () => {
    try {
      const list = (await api.get(`/handover/docs/${id}/versions`)).items
      if (list.length < 2) return null
      // 내용이 같은 버전(저장만 하고 바뀐 게 없는 경우)은 건너뛰고, 실제로 달라진 가장 가까운 이전 버전과 비교한다
      const a = await api.get(`/handover/versions/${list[0].id}`)
      const newestJson = JSON.stringify(a.item.content)
      let b = null
      let by = list[0].author
      for (let k = 1; k < Math.min(list.length, 8); k += 1) {
        const prev = await api.get(`/handover/versions/${list[k].id}`)
        if (JSON.stringify(prev.item.content) !== newestJson) { b = prev; by = list[k - 1].author; break }
      }
      if (!b) return null
      // 문단마다 글자(text)와 서식까지 담은 열쇠(key)로 비교한다. 글자가 같아도 서식·순서가 바뀐 곳을 찾기 위해서다.
      const blocks = (c) => {
        const out = []
        const walk = (n) => {
          if (!n) return
          if (['paragraph', 'heading'].includes(n.type)) {
            const text = (n.content || []).map((x) => x.text || '').join('').trim()
            if (text) out.push({ text, key: JSON.stringify(n) })
          }
          ;(n.content || []).forEach(walk)
        }
        walk(c)
        return out
      }
      const newer = blocks(a.item.content)
      const older = blocks(b.item.content)
      const olderKeys = new Set(older.map((x) => x.key))
      let changed = newer.find((x) => !olderKeys.has(x.key))
      if (!changed) {
        // 같은 문단들이 순서만 바뀌었거나 일부가 지워진 경우: 처음으로 달라지는 자리
        const at = newer.findIndex((x, k) => older[k]?.key !== x.key)
        if (at >= 0) changed = newer[at]
      }
      if (!changed) {
        // 지운 문단만 있는 경우: 지워진 문단 바로 앞 문단
        const newKeys = new Set(newer.map((x) => x.key))
        const gone = older.findIndex((x) => !newKeys.has(x.key))
        if (gone > 0) changed = newer[Math.min(gone - 1, newer.length - 1)]
      }
      return changed ? { by, text: changed.text.slice(0, 120), tab: String(id) } : null
    } catch {
      return null
    }
  }, [id])

  const jumpToLastEdit = useCallback(async () => {
    let le = lastEdit
    if (!le) le = await deriveFromVersions()
    if (!le) {
      flash('수정한 위치를 찾지 못했습니다')
      return
    }
    if (le.tab && String(le.tab) !== String(id)) {
      navigate(`${base}/${le.tab}${window.location.search}`, { state: { jumpLast: true } })
      return
    }
    const ed = editor
    if (!ed) return
    const snippet = (le.text || '').trim()
    let hit = null
    if (snippet) {
      ed.state.doc.descendants((node, pos) => {
        if (hit || !node.isTextblock) return
        const t = node.textContent.trim()
        if (t === snippet || t.startsWith(snippet.slice(0, 40)) || t.includes(snippet.slice(0, 40))) hit = { pos, size: node.nodeSize }
      })
    }
    if (!hit) {
      flash('수정한 문단을 찾지 못했습니다. 그 뒤에 내용이 바뀌었을 수 있습니다')
      return
    }
    ed.view.dispatch(ed.state.tr.setMeta(flashKey, { from: hit.pos, to: hit.pos + hit.size }))
    const dom = ed.view.nodeDOM(hit.pos)
    ;(dom?.scrollIntoView ? dom : dom?.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setTimeout(() => { try { ed.view.dispatch(ed.state.tr.setMeta(flashKey, null)) } catch { /* 편집기가 이미 닫힘 */ } }, 3600)
  }, [lastEdit, id, base, editor, navigate, deriveFromVersions])

  // 다른 탭에서 넘어온 경우 로드가 끝나면 이어서 이동
  useEffect(() => {
    if (!loc.state?.jumpLast || !editor || !doc) return undefined
    const t = setTimeout(() => { jumpToLastEdit(); window.history.replaceState({}, '') }, 500)
    return () => clearTimeout(t)
  }, [loc.state, editor, doc, jumpToLastEdit])

  // 눈금자: 페이지의 실제 위치와 폭에 맞춘다(댓글 칸, 개요 칸, 확대 비율, 창 크기가 바뀌어도 어긋나지 않게)
  const rulerRef = useRef(null)
  const [rulerBox, setRulerBox] = useState(null)
  useLayoutEffect(() => {
    const page = pageRef.current
    const ruler = rulerRef.current
    if (!page || !ruler) return undefined
    const scroller = page.closest('.gd-scroll')
    const measure = () => {
      const p = page.getBoundingClientRect()
      const r = ruler.getBoundingClientRect()
      setRulerBox((prev) => {
        const next = { left: Math.round(p.left - r.left), width: Math.round(p.width) }
        return prev && prev.left === next.left && prev.width === next.width ? prev : next
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(page)
    ro.observe(ruler)
    if (scroller) ro.observe(scroller)
    window.addEventListener('resize', measure)
    scroller?.addEventListener('scroll', measure, { passive: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      scroller?.removeEventListener('scroll', measure)
    }
  }, [zoom, showComments, historyOpen, showSidebar, doc, access.loading])

  const listHref = '/workspace/docs'
  if (access.loading) return <div className="gd-loading">문서 불러오는 중</div>
  if (access.denied) return <NoAccess kind="doc" notFound={access.notFound} />
  if (access.error) return <div className="gd-loading">문서를 불러오지 못했습니다. <Link to="/">처음으로</Link></div>

  const ed = editor
  const editing = canEdit && mode === 'edit'
  const styleValue = !ed ? 'p' : [1, 2, 3, 4].map((l) => (ed.isActive('heading', { level: l }) ? `h${l}` : null)).find(Boolean) || 'p'
  const applyStyle = (v) => (v === 'p' ? ed.chain().focus().setParagraph().run() : ed.chain().focus().setHeading({ level: Number(v.slice(1)) }).run())
  const curFont = ed?.getAttributes('textStyle').fontFamily || ''
  const fontList = hwpOn ? HWP_FONTS.map((n) => ({ label: n, value: fontCss(n) })) : FONTS
  const curFontLabel = hwpOn
    ? hwpFontOf(curFont) || (curFont ? curFont.split(',')[0].replace(/'/g, '') : metricsOf(hwp.preset).body.font)
    : FONTS.find((f) => f.value === curFont)?.label || (curFont ? curFont.replace(/'/g, '') : 'Pretendard')
  const applySize = (n) => {
    const v = Math.max(1, Math.min(400, Number(n) || 11))
    setSizeDraft(String(v))
    ed.chain().focus().setMark('textStyle', { fontSize: `${v}pt` }).run()
  }
  const curAlign = ['center', 'right', 'justify'].find((a) => ed?.isActive({ textAlign: a })) || 'left'
  const AlignIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify }[curAlign]

  const downloads = [
    { label: FORMATS.hwpx.label, icon: <FileDown size={16} />, hint: fmt === 'hwpx' ? '기본' : '', onClick: () => exportAs('hwpx') },
    { label: FORMATS.docx.label, icon: <FileDown size={16} />, hint: fmt === 'docx' ? '기본' : '', onClick: () => exportAs('docx') },
    '-',
    { label: 'PDF 문서(.pdf)', onClick: () => exportAs('pdf') },
    { label: '마크다운(.md)', onClick: () => exportAs('md') },
    { label: '일반 텍스트(.txt)', onClick: () => exportAs('txt') },
    { label: '웹페이지(.html)', onClick: () => exportAs('html') },
  ]
  const menus = {
    파일: [
      { label: '새 탭', icon: <Plus size={16} />, onClick: () => addTab(), disabled: !canEdit },
      { label: '새 문서', icon: <Plus size={16} />, onClick: async () => { const r = await api.post('/workspace/files', { kind: 'doc', template: 'blank' }); navigate(`/docs/${r.item.first_tab}`) }, disabled: !canEdit },
      { label: '공유', icon: <Lock size={16} />, onClick: () => setShareOpen(true) },
      { label: '문서 목록', onClick: () => navigate(listHref) },
      { label: '쪽 설정', onClick: () => setPageDlg(true), disabled: !canEdit },
      '-',
      { label: '버전 기록', icon: <History size={16} />, children: [{ label: '버전 기록 보기', hint: '⌘⌥⇧H', onClick: openHistory }] },
      { label: '다운로드', icon: <Download size={16} />, children: downloads },
      { label: '한글 미리보기', icon: <FileSearch size={16} />, onClick: openPreview },
      { label: '가져오기(Word, 한글, PDF)', icon: <Upload size={16} />, onClick: () => importRef.current?.click(), disabled: !canEdit },
      { label: 'Google Docs로 열기', icon: <ExternalLink size={16} />, onClick: openInGoogleDocs },
      '-',
      { label: '인쇄', hint: '⌘P', icon: <Printer size={16} />, onClick: () => window.print() },
      ...(staffUser ? ['-', { label: '관리자 대시보드', onClick: () => navigate('/admin') }] : []),
    ],
    수정: [
      { label: '실행취소', hint: '⌘Z', icon: <Undo2 size={16} />, onClick: () => ed.chain().focus().undo().run(), disabled: !editing },
      { label: '재실행', hint: '⌘Y', icon: <Redo2 size={16} />, onClick: () => ed.chain().focus().redo().run(), disabled: !editing },
      '-',
      { label: '모두 선택', hint: '⌘A', onClick: () => ed.chain().focus().selectAll().run() },
    ],
    보기: [
      { label: '댓글 표시', checked: showComments, onClick: () => setShowComments((v) => !v) },
      { label: '해결된 댓글 표시', checked: showResolved, onClick: () => setShowResolved((v) => !v) },
      { label: '탭 및 개요 표시', checked: showSidebar, onClick: () => setShowSidebar((v) => !v) },
      '-',
      { label: '한글 모드', checked: hwpOn, onClick: () => switchMode(hwpOn ? 'docs' : 'hwp') },
      { label: '작업 창', checked: paneOpen, onClick: () => setPaneOpen((v) => !v) },
    ],
    삽입: [
      { label: '이미지', icon: <ImagePlus size={16} />, onClick: () => document.getElementById('gd-img-input')?.click(), disabled: !editing },
      { label: '표', icon: <TableIcon size={16} />, onClick: () => insertTableFixed(ed, 3, 3, false), disabled: !editing },
      { label: '체크박스 ☐', icon: <SquareCheck size={16} />, onClick: () => ed.chain().focus().insertCheckbox().run(), disabled: !editing },
      { label: '링크', hint: '⌘K', icon: <Link2 size={16} />, onClick: setLink, disabled: !editing },
      { label: '가로줄', onClick: () => ed.chain().focus().setHorizontalRule().run(), disabled: !editing },
      { label: '체크리스트', icon: <ListChecks size={16} />, onClick: () => ed.chain().focus().toggleTaskList().run(), disabled: !editing },
      { label: '비밀값 (계정 비밀번호)', icon: <KeyRound size={16} />, onClick: insertSecret, disabled: !editing },
      { label: '자료값', icon: <Variable size={16} />, onClick: () => { setPaneOpen(true); setPaneDocs(true); setPaneTab('vars') }, disabled: !editing },
      { label: '쪽 나눔', onClick: () => ed.chain().focus().insertPageBreak().run(), disabled: !editing },
      '-',
      { label: '탭', icon: <Plus size={16} />, onClick: () => addTab(), disabled: !canEdit },
      { label: '댓글', hint: '⌘⌥M', icon: <MessageSquarePlus size={16} />, onClick: startComment, disabled: !canEdit },
    ],
    서식: [
      ...STYLE_OPTIONS.map((o) => ({ label: o.label, checked: styleValue === o.value, onClick: () => applyStyle(o.value), disabled: !editing })),
      '-',
      { label: '위 첨자', checked: ed.isActive('superscript'), onClick: () => ed.chain().focus().toggleSuperscript().run(), disabled: !editing },
      { label: '아래 첨자', checked: ed.isActive('subscript'), onClick: () => ed.chain().focus().toggleSubscript().run(), disabled: !editing },
      '-',
      { label: '쪽 설정', onClick: () => setPageDlg(true), disabled: !canEdit },
      '-',
      { label: '서식 지우기', hint: '⌘\\', icon: <RemoveFormatting size={16} />, onClick: () => ed.chain().focus().unsetAllMarks().clearNodes().run(), disabled: !editing },
    ],
    도구: [
      { label: '글자 수', onClick: () => flash(`글자 수 ${ed.state.doc.textContent.length.toLocaleString()}자 · 댓글 ${comments.length}개`) },
      { label: 'AI 창 열기', hint: '⌘J', icon: <Sparkles size={16} />, checked: aiOpen && !historyOpen, onClick: () => toggleAi() },
      { label: '공문 검사', icon: <SpellCheck size={16} />, onClick: runLint },
      { label: '한글 미리보기', icon: <FileSearch size={16} />, onClick: openPreview },
    ],
    도움말: [
      { label: '댓글: 문장 선택 후 툴바 댓글 버튼', onClick: () => {} },
      { label: '탭 이름: 두 번 클릭 또는 ⋮ > 이름 바꾸기', onClick: () => {} },
      { label: '비밀값: 눈 아이콘 보기, 복사 아이콘 복사', onClick: () => {} },
    ],
  }

  const colorGrid = (onPick, close, none) => (
    <div className="gd-colors">
      {none && <button type="button" className="gd-colors__none" onClick={() => { none(); close() }}><X size={14} /> 없음</button>}
      <div className="gd-colors__grid">
        {COLORS.map((c) => (
          <button key={c} type="button" title={c} style={{ background: c }} onClick={() => { onPick(c); close() }} />
        ))}
      </div>
    </div>
  )

  return (
    <div className={`gd${hwpOn ? ' hw-on' : ''}`}>
      <style>{highlightCss}</style>
      {hwpOn && <style>{hwpCss(hwp.preset)}</style>}
      <input ref={importRef} type="file" hidden accept=".hwp,.hwpx,.docx,.pdf" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; importFile(f) }} />
      <header className="gd-top ed-row">
        <Link to={listHref} className="ed-icon" aria-label="문서 홈" title="문서 홈"><DocsIcon size={40} /></Link>
        <input
          className="ed-title"
          value={titleDraft}
          readOnly={!canEdit}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={saveDocTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="문서 제목"
          title={docTitle}
        />
        <span className="ed-status"><Cloud size={16} aria-hidden="true" />{saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중' : saveState === 'error' ? '저장 실패' : ''}</span>
        {mcpRelay.badge}
        <div className="hw-seg" role="group" aria-label="편집 모드">
          <button type="button" className={hwpOn ? '' : 'is-on'} aria-pressed={!hwpOn} onClick={() => switchMode('docs')}>Docs</button>
          <button type="button" className={hwpOn ? 'is-on' : ''} aria-pressed={hwpOn} onClick={() => switchMode('hwp')}>한글</button>
        </div>
        <div className="gd-actions">
          {lastEdit || doc.updated_by ? (
            <button type="button" className="gd-meta gd-meta--link" onClick={jumpToLastEdit} title="수정한 위치로 이동">
              {`${lastEdit?.by || doc.updated_by} 님이 마지막으로 수정`}
            </button>
          ) : null}
          <button type="button" className={`gd-round${historyOpen ? ' is-on' : ''}`} aria-label="버전 기록" title="버전 기록 (⌘⌥⇧H)" onClick={() => (historyOpen ? closeHistory() : openHistory())}>
            <History size={20} />
          </button>
          <button type="button" className={`gd-round${showComments ? ' is-on' : ''}`} aria-label="댓글 표시" title="댓글 표시" onClick={() => setShowComments((v) => !v)}>
            <MessageSquareText size={20} />
          </button>
          {hwpOn && (
            <button type="button" className={`gd-round${paneOpen ? ' is-on' : ''}`} aria-label="작업 창" title="작업 창" onClick={() => setPaneOpen((v) => !v)}>
              <PanelRight size={20} />
            </button>
          )}
          {hwpOn && (
            <button type="button" className="hw-primary" onClick={saveHwpx}>
              <Download size={16} /> <span>한글로 저장</span>
            </button>
          )}
          <button type="button" className={`gd-round${aiOpen && !historyOpen ? ' is-on' : ''}`} aria-label="AI 창" aria-pressed={aiOpen && !historyOpen} title="AI 창 (⌘J)" onClick={() => toggleAi()}>
            <Sparkles size={20} />
          </button>
          <button type="button" className="gd-share" onClick={() => setShareOpen(true)}>
            <ShareIcon size={16} /> <span>공유</span>
          </button>
          <AccountMenu size={40} />
        </div>
      </header>
      <nav className="gd-menubar ed-menurow">
        {Object.entries(menus).map(([label, items]) => (
          <Dropdown key={label} trigger={(open) => <button type="button" className={`gd-menu__btn${open ? ' is-open' : ''}`}>{label}</button>}>
            {(close) => <MenuItems items={items} close={close} />}
          </Dropdown>
        ))}
      </nav>

      <div className="gd-toolbar">
        <TB icon={Search} label="메뉴 검색" onClick={() => flash('⌘F로 문서 내 검색')} />
        <TB icon={Undo2} label="실행취소 (⌘Z)" onClick={() => ed.chain().focus().undo().run()} disabled={!editing} />
        <TB icon={Redo2} label="재실행 (⌘Y)" onClick={() => ed.chain().focus().redo().run()} disabled={!editing} />
        <TB icon={Printer} label="인쇄 (⌘P)" onClick={() => window.print()} />
        <span className="gd-sep" />
        <Dropdown trigger={() => <button type="button" className="gd-select gd-select--zoom">{zoom}%<ChevronDown size={14} /></button>}>
          {(close) => <MenuItems close={close} items={[50, 75, 90, 100, 125, 150, 200].map((z) => ({ label: `${z}%`, checked: zoom === z, onClick: () => setZoom(z) }))} />}
        </Dropdown>
        <span className="gd-sep" />
        <Dropdown disabled={!editing} className="gd-style-panel" trigger={() => <button type="button" className="gd-select gd-select--style" disabled={!editing}><span>{STYLE_OPTIONS.find((o) => o.value === styleValue)?.label}</span><ChevronDown size={14} /></button>}>
          {(close) => STYLE_OPTIONS.map((o) => (
            <button key={o.value} type="button" className={`gd-menu__item gd-style-${o.value}`} onClick={() => { applyStyle(o.value); close() }}>
              <span className="gd-menu__check">{styleValue === o.value ? <Check size={16} /> : null}</span>
              <span className="gd-menu__label">{o.label}</span>
            </button>
          ))}
        </Dropdown>
        <span className="gd-sep" />
        <Dropdown disabled={!editing} className="gd-font-panel" trigger={() => <button type="button" className="gd-select gd-select--font" disabled={!editing}><span style={{ fontFamily: curFont || undefined }}>{curFontLabel}</span><ChevronDown size={14} /></button>}>
          {(close) => fontList.map((f) => (
            <button key={f.label} type="button" className="gd-menu__item" style={{ fontFamily: f.value || "'Pretendard Variable', Pretendard" }}
              onClick={() => { (f.value ? ed.chain().focus().setFontFamily(f.value) : ed.chain().focus().unsetFontFamily()).run(); close() }}>
              <span className="gd-menu__check">{curFont === f.value ? <Check size={16} /> : null}</span>
              <span className="gd-menu__label">{f.label}</span>
            </button>
          ))}
        </Dropdown>
        <span className="gd-sep" />
        <TB icon={Minus} label="글꼴 크기 줄이기" onClick={() => applySize(Number(sizeDraft) - 1)} disabled={!editing} />
        <Dropdown disabled={!editing} className="gd-size-panel" width={72} trigger={() => (
          <input className="gd-size" value={sizeDraft} disabled={!editing} aria-label="글꼴 크기"
            onChange={(e) => setSizeDraft(e.target.value.replace(/[^\d.]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && applySize(sizeDraft)} />
        )}>
          {(close) => SIZES.map((s) => (
            <button key={s} type="button" className="gd-menu__item gd-size-item" onClick={() => { applySize(s); close() }}>{s}</button>
          ))}
        </Dropdown>
        <TB icon={Plus} label="글꼴 크기 늘리기" onClick={() => applySize(Number(sizeDraft) + 1)} disabled={!editing} />
        <span className="gd-sep" />
        <TB icon={Bold} label="굵게 (⌘B)" onClick={() => ed.chain().focus().toggleBold().run()} active={ed?.isActive('bold')} disabled={!editing} />
        <TB icon={Italic} label="기울임꼴 (⌘I)" onClick={() => ed.chain().focus().toggleItalic().run()} active={ed?.isActive('italic')} disabled={!editing} />
        <TB icon={UIcon} label="밑줄 (⌘U)" onClick={() => ed.chain().focus().toggleUnderline().run()} active={ed?.isActive('underline')} disabled={!editing} />
        <Dropdown disabled={!editing} trigger={() => (
          <button type="button" className="gd-tb gd-tb--color" disabled={!editing} title="텍스트 색상"><Baseline size={18} strokeWidth={1.8} /><i style={{ background: ed?.getAttributes('textStyle').color || '#000' }} /></button>
        )}>
          {(close) => colorGrid((c) => ed.chain().focus().setColor(c).run(), close, () => ed.chain().focus().unsetColor().run())}
        </Dropdown>
        <Dropdown disabled={!editing} trigger={() => (
          <button type="button" className="gd-tb gd-tb--color" disabled={!editing} title="강조 표시 색상"><Highlighter size={18} strokeWidth={1.8} /><i style={{ background: ed?.getAttributes('highlight').color || '#FFEA00' }} /></button>
        )}>
          {(close) => colorGrid((c) => ed.chain().focus().setHighlight({ color: c }).run(), close, () => ed.chain().focus().unsetHighlight().run())}
        </Dropdown>
        <span className="gd-sep" />
        <TB icon={Link2} label="링크 삽입 (⌘K)" onClick={setLink} active={ed?.isActive('link')} disabled={!editing} />
        <TB icon={MessageSquarePlus} label="댓글 추가 (⌘⌥M)" onClick={startComment} disabled={!canEdit} />
        <label className={`gd-tb${editing ? '' : ' is-disabled'}`} title="이미지 삽입">
          <ImagePlus size={18} strokeWidth={1.8} />
          <input id="gd-img-input" type="file" accept="image/*" hidden disabled={!editing} onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) insertImage(f) }} />
        </label>
        <TB icon={KeyRound} label="비밀값 삽입" onClick={insertSecret} disabled={!editing} />
        <span className="gd-sep" />
        <Dropdown disabled={!editing} trigger={() => <button type="button" className="gd-tb gd-tb--dd" disabled={!editing} title="정렬"><AlignIcon size={18} strokeWidth={1.8} /><ChevronDown size={12} /></button>}>
          {(close) => (
            <div className="gd-align-row">
              {[['left', AlignLeft, '왼쪽 정렬'], ['center', AlignCenter, '가운데 정렬'], ['right', AlignRight, '오른쪽 정렬'], ['justify', AlignJustify, '양쪽 정렬']].map(([a, I, l]) => (
                <button key={a} type="button" className={`gd-tb${curAlign === a ? ' is-active' : ''}`} title={l} onClick={() => { ed.chain().focus().setTextAlign(a).run(); close() }}><I size={18} /></button>
              ))}
            </div>
          )}
        </Dropdown>
        <TB icon={SquareCheck} label="체크박스 삽입 (☐)" onClick={() => ed.chain().focus().insertCheckbox().run()} disabled={!editing} />
        <TB icon={ListChecks} label="체크리스트" onClick={() => ed.chain().focus().toggleTaskList().run()} active={ed?.isActive('taskList')} disabled={!editing} />
        <TB icon={List} label="글머리기호 목록" onClick={() => ed.chain().focus().toggleBulletList().run()} active={ed?.isActive('bulletList')} disabled={!editing} />
        <TB icon={ListOrdered} label="번호 매기기 목록" onClick={() => ed.chain().focus().toggleOrderedList().run()} active={ed?.isActive('orderedList')} disabled={!editing} />
        <TB icon={IndentDecrease} label="내어쓰기" onClick={() => ed.chain().focus().liftListItem(ed.isActive('taskItem') ? 'taskItem' : 'listItem').run()} disabled={!editing} />
        <TB icon={IndentIncrease} label="들여쓰기" onClick={() => ed.chain().focus().sinkListItem(ed.isActive('taskItem') ? 'taskItem' : 'listItem').run()} disabled={!editing} />
        <TB icon={RemoveFormatting} label="서식 지우기" onClick={() => ed.chain().focus().unsetAllMarks().run()} disabled={!editing} />
        <span className="gd-grow" />
        <Dropdown align="right" disabled={!canEdit} className="gd-mode-panel" trigger={() => (
          <button type="button" className="gd-mode">
            {mode === 'edit' ? <Pencil size={16} /> : <Eye size={16} />}
            <span>{mode === 'edit' ? '수정' : '보기'}</span>
            {canEdit && <ChevronDown size={14} />}
          </button>
        )}>
          {(close) => (
            <>
              <button type="button" className="gd-menu__item" onClick={() => { setMode('edit'); close() }}>
                <span className="gd-menu__check"><Pencil size={16} /></span><span className="gd-menu__label"><b>수정</b><small>문서 직접 수정</small></span>
              </button>
              <button type="button" className="gd-menu__item" onClick={() => { setMode('view'); close() }}>
                <span className="gd-menu__check"><Eye size={16} /></span><span className="gd-menu__label"><b>보기</b><small>읽기만, 댓글은 가능</small></span>
              </button>
            </>
          )}
        </Dropdown>
      </div>

      <div className="gd-ruler" ref={rulerRef} aria-hidden="true">
        <div className="gd-ruler__inner" style={{ marginLeft: rulerBox?.left ?? 0, width: rulerBox?.width ?? 816 * (zoom / 100), visibility: rulerBox ? 'visible' : 'hidden' }}>
          {Array.from({ length: 22 }, (_, i) => (
            <span key={i} style={{ left: `${(i / 21.59) * 100}%` }}>{i > 2 && i < 20 ? i - 2 : ''}</span>
          ))}
        </div>
      </div>

      <div className="gd-body">
        {showSidebar ? (
          <aside className="gd-outline">
            <button type="button" className="gd-outline__back" aria-label="탭 및 개요 숨기기" title="탭 및 개요 숨기기" onClick={() => setShowSidebar(false)}><ArrowLeft size={20} /></button>
            <div className="gd-outline__head">
              <span>문서 탭</span>
              {canEdit && <button type="button" className="gd-icon-btn" aria-label="탭 추가" title="탭 추가" onClick={() => addTab()}><Plus size={20} /></button>}
            </div>
            {tabs.map((t) => {
              const sel = String(t.id) === String(id)
              return (
                <div key={t.id}>
                  <TabRow
                    tab={t}
                    selected={sel}
                    collapsed={outlineCollapsed}
                    canEdit={canEdit}
                    canDelete={tabs.length > 1}
                    onSelect={() => {
                      if (sel) setOutlineCollapsed((v) => !v)
                      else {
                        setOutlineCollapsed(false)
                        nav(`${base}/${t.id}`)
                      }
                    }}
                    onRename={renameTab}
                    onDuplicate={duplicateTab}
                    onDelete={deleteTab}
                  />
                  {sel && !outlineCollapsed && (
                    <ul className="gd-outline__list">
                      {outline.length === 0 && <li className="gd-outline__empty">문서에 추가한 제목이 여기에 표시됩니다.</li>}
                      {outline.map((o, i) => (
                        <li key={i} className={`lv${o.level}`}>
                          <button type="button" title={o.text} onClick={() => ed.view.nodeDOM(o.pos)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{o.text}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </aside>
        ) : (
          <button type="button" className="gd-outline-open" aria-label="탭 및 개요 표시" title="탭 및 개요 표시" onClick={() => setShowSidebar(true)}><PanelLeft size={20} /></button>
        )}
        <div className="gd-scroll">
          <div className={`gd-canvas${showComments && !historyOpen ? '' : ' no-comments'}`} ref={canvasRef} style={{ zoom: zoom / 100, '--pg-w': `${pgBox.width}mm`, '--pg-h': `${pgBox.height}mm`, '--pg-pad': `${pgBox.top}mm ${pgBox.right}mm ${pgBox.bottom}mm ${pgBox.left}mm` }}>
            <div className="gd-page" ref={pageRef}>
              {hwpOn && hwp.preset === '기안문' && <GianHead hwp={hwp} onOpen={() => { setPaneOpen(true); setPaneTab('info') }} />}
              <EditorContent editor={ed} />
              {hwpOn && hwp.preset === '기안문' && <GianFoot hwp={hwp} onOpen={() => { setPaneOpen(true); setPaneTab('info') }} />}
              <PageGuides pageRef={pageRef} pg={pgBox} deps={`${zoom}|${doc?.id}|${hwpOn}`} />
              <PageDeco cfg={pageEff} pg={pgBox} />
              {linkBubble && (
                <div className="gd-linkbubble" style={{ top: linkBubble.top, left: linkBubble.left }}>
                  <a href={linkBubble.href} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {linkBubble.href.replace(/^https?:\/\//, '').slice(0, 40)}</a>
                  {editing && (
                    <>
                      <button type="button" className="gd-icon-btn" aria-label="링크 수정" onClick={setLink}><Pencil size={15} /></button>
                      <button type="button" className="gd-icon-btn" aria-label="링크 삭제" onClick={() => ed.chain().focus().extendMarkRange('link').unsetLink().run()}><Unlink size={15} /></button>
                    </>
                  )}
                </div>
              )}
            </div>
            {showComments && !historyOpen && (
              <div className="gd-rail">
                {visibleComments.map((c) => (
                  <CommentCard
                    key={c.id}
                    c={c}
                    active={active === c.anchor_id}
                    canEdit={canEdit}
                    onActivate={setActive}
                    onUpdate={updateComment}
                    onDelete={deleteComment}
                    onOpenImage={(images, index) => setLightbox({ images, index })}
                    cardRef={(el) => { cardRefs.current[`c${c.id}`] = el }}
                    style={{ top: positions[`c${c.id}`] ?? -9999, visibility: positions[`c${c.id}`] == null ? 'hidden' : 'visible' }}
                  />
                ))}
                {composer && (
                  <Composer
                    draft={composer}
                    setDraft={setComposer}
                    onCancel={() => { setComposer(null); setActive(null) }}
                    onSubmit={submitComment}
                    cardRef={(el) => { cardRefs.current.composer = el }}
                    style={{ top: positions.composer ?? composer.top }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        {(hwpOn || paneDocs) && paneOpen && !historyOpen && (
          <HwpPane
            editor={ed}
            settings={hwp}
            update={updateHwp}
            editing={editing}
            tab={paneTab}
            setTab={setPaneTab}
            focusVar={focusVar}
            onClose={() => { setPaneOpen(false); setPaneDocs(false) }}
            lint={lint}
            onLint={runLint}
            onJump={jumpTo}
          />
        )}
        {aiOpen && !historyOpen && (
          <aside className="gd-ai" aria-label="문서 AI">
            {AiPanelLazy ? (
              <AiBoundary>
                <Suspense fallback={<div className="gd-ai__note">AI 창을 불러오는 중</div>}>
                  <AiPanelLazy
                    open
                    onClose={() => toggleAi(false)}
                    scope={`doc:${doc.ws_id}`}
                    title="문서 AI"
                    systemPrompt={aiSystem}
                    tools={aiToolList}
                    getContext={aiGetContext}
                    quickActions={aiQuick}
                    placeholder="문서에 대해 말해 보세요. 예: 맞춤법 고쳐 줘"
                    canEdit={canEdit && mode === 'edit'}
                  />
                </Suspense>
              </AiBoundary>
            ) : (
              <div className="gd-ai__note">AI 창을 아직 사용할 수 없습니다</div>
            )}
          </aside>
        )}
        {historyOpen && (
          <HistoryPanel
            versions={versions}
            selId={selVer}
            latestId={versions[0]?.id}
            canEdit={canEdit}
            onSelect={(v) => pickVersion(v)}
            onRestore={restoreVersion}
            onRename={renameVersion}
            onClose={closeHistory}
            showChanges={showChanges}
            setShowChanges={setShowChanges}
            onlyNamed={onlyNamed}
            setOnlyNamed={setOnlyNamed}
          />
        )}
      </div>

      {historyOpen && selVer && selVer !== versions[0]?.id && canEdit && (
        <div className="gd-restorebar">
          <span>이전 버전을 보는 중</span>
          <button type="button" className="gd-btn-blue" onClick={() => restoreVersion(versions.find((v) => v.id === selVer))}>이 버전 복원</button>
        </div>
      )}

      {!canEdit && <div className="gd-banner">보기 전용: 이 문서를 고칠 권한이 없습니다</div>}
      {shareOpen && <ShareDialog fileId={doc.ws_id} title={docTitle} linkPath={window.location.pathname} onClose={() => { setShareOpen(false); setShareTick((t) => t + 1) }} />}
      {toast && <div className="gd-toast">{toast}</div>}
      <TableToolbar editor={ed} editing={editing && !historyOpen && !preview} flash={flash} />
      <ImageToolbar editor={ed} editing={editing && !historyOpen && !preview} />
      {pageDlg && (
        <PageSetupDialog
          value={page}
          hwpOn={hwpOn}
          presetPage={pageOf(hwp.preset)}
          upload={async (f) => (await api.upload(f, { usage: 'general' })).url}
          onClose={() => setPageDlg(false)}
          onApply={(p) => {
            pageSetRef.current = p
            setPage(p)
            setPageDlg(false)
            if (canEdit && editor) {
              setSaveState('dirty')
              clearTimeout(saveTimer.current)
              saveTimer.current = setTimeout(() => save(editor), 600)
            }
          }}
        />
      )}
      {preview && <HwpPreview state={preview} onClose={() => setPreview(null)} onSave={saveHwpx} />}
      {lightbox && <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}
