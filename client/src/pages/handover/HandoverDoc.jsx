// /handover/:id: 운영위원회 인수인계 문서 편집기 (id = 탭 id).
// 화면 구조: 제목 줄(문서 제목 하나) / 메뉴 / 알약형 툴바 / 눈금자 / 왼쪽 문서 탭·개요 / 종이 / 오른쪽 여백 댓글.
// 열람: 관리자 로그인(manager 이상) 또는 열람 비밀번호. 편집·댓글·탭 관리: 관리자 로그인.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import LinkExt from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
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
} from 'lucide-react'
import { api } from '../../hooks/useApi'
import { useAuth } from '../../context/AuthContext'
import { CommentMark, SecretNode, HandoverStorage, FontSize } from './extensions'
import { download, safeName, toDocx, toHtml, toMarkdown, toPdf, toPlainText } from './exporters'
import './handoverDoc.css'

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
const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
]
const STYLE_OPTIONS = [
  { value: 'p', label: '일반 텍스트' },
  { value: 'h1', label: '제목' },
  { value: 'h2', label: '제목 1' },
  { value: 'h3', label: '제목 2' },
  { value: 'h4', label: '제목 3' },
]

const AVATAR_COLORS = ['#7b57d1', '#1a73e8', '#188038', '#e37400', '#d93025', '#9334e6', '#00838f']
const colorOf = (name = '') => AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]

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
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#815FD7" />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill="#C8B9F2" />
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
                  { label: '삭제', onClick: () => window.confirm('이 댓글을 삭제할까요?') && onDelete(c) },
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
  const { user } = useAuth()
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

export default function HandoverDoc() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [doc, setDoc] = useState(null)
  const [tabs, setTabs] = useState([])
  const [docTitle, setDocTitle] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [comments, setComments] = useState([])
  const [access, setAccess] = useState({ loading: true })
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
  const [toast, setToast] = useState('')
  const [, force] = useState(0)
  const [titleWidth, setTitleWidth] = useState(200)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState([])
  const [selVer, setSelVer] = useState(null)
  const [olderTexts, setOlderTexts] = useState(null)
  const [showChanges, setShowChanges] = useState(true)
  const [onlyNamed, setOnlyNamed] = useState(false)
  const liveRef = useRef(null)
  const canvasRef = useRef(null)
  const pageRef = useRef(null)
  const cardRefs = useRef({})
  const saveTimer = useRef(null)
  const mirrorRef = useRef(null)
  const canEdit = access.canEdit === true

  const flash = (t) => {
    setToast(t)
    setTimeout(() => setToast(''), 2400)
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
        const [d, list, cm, meta] = await Promise.all([
          api.get(`/handover/docs/${id}`),
          api.get('/handover/docs'),
          api.get(`/handover/docs/${id}/comments`),
          api.get('/handover/meta'),
        ])
        if (off) return
        setDoc(d.item)
        setTabs(list.items)
        setComments(cm.items)
        setDocTitle(meta.title)
        setTitleDraft(meta.title)
        setAccess({ loading: false, access: d.access, canEdit: d.canEdit })
        setMode(d.canEdit ? 'edit' : 'view')
        document.title = `${meta.title} | 디지털인문예술전공`
      } catch (e) {
        if (off) return
        if (e?.status === 401 || e?.status === 404) navigate('/resources/handover', { replace: true })
        else setAccess({ loading: false, error: true })
      }
    })()
    return () => {
      off = true
    }
  }, [id, navigate])

  const save = useCallback(
    async (ed) => {
      if (!canEdit) return
      setSaveState('saving')
      try {
        await api.put(`/handover/docs/${id}`, { content: ed.getJSON() })
        setSaveState('saved')
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
        Image,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Highlight.configure({ multicolor: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TextStyle,
        FontFamily,
        FontSize,
        Color,
        CommentMark,
        SecretNode,
        HandoverStorage,
      ],
      content: doc ? doc.content || doc.content_html || '<p></p>' : '',
      editable: false,
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
        setSizeDraft(fs ? String(parseFloat(fs)) : '11')
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

  // 제목 입력칸 너비: 글자 길이만큼 늘려 끝까지 보이게
  useLayoutEffect(() => {
    if (mirrorRef.current) setTitleWidth(Math.min(mirrorRef.current.offsetWidth + 16, Math.max(240, window.innerWidth - 560)))
  }, [titleDraft, access.loading])

  const highlightCss = useMemo(() => {
    const live = new Set(visibleComments.filter((c) => !c.resolved).map((c) => c.anchor_id))
    const rules = [...live].map((a) => `.gd-page [data-comment="${CSS.escape(a)}"]{background:rgba(255,212,0,.22);border-bottom:2px solid rgba(255,190,0,.55)}`)
    if (active) rules.push(`.gd-page [data-comment="${CSS.escape(active)}"]{background:rgba(255,212,0,.55)}`)
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
    const r = await api.post('/handover/docs', content ? { title: content.title, content: content.json } : {})
    setTabs((t) => [...t, r.item])
    navigate(`/handover/${r.item.id}`)
  }
  async function renameTab(tab, title) {
    await api.put(`/handover/docs/${tab.id}`, { title })
    setTabs((t) => t.map((x) => (x.id === tab.id ? { ...x, title } : x)))
  }
  async function duplicateTab(tab) {
    const json = String(tab.id) === String(id) ? editor.getJSON() : (await api.get(`/handover/docs/${tab.id}`)).item.content
    await addTab({ title: `${tab.title} 사본`, json })
  }
  async function deleteTab(tab) {
    if (!window.confirm(`'${tab.title}' 탭을 삭제할까요? 탭 안의 내용과 댓글이 함께 삭제됩니다.`)) return
    await api.del(`/handover/docs/${tab.id}`)
    const rest = tabs.filter((x) => x.id !== tab.id)
    setTabs(rest)
    if (String(tab.id) === String(id)) navigate(`/handover/${rest[0].id}`)
  }

  async function saveDocTitle() {
    const t = titleDraft.trim()
    if (!canEdit || !t || t === docTitle) {
      setTitleDraft(docTitle)
      return
    }
    await api.put('/handover/meta', { title: t })
    setDocTitle(t)
    document.title = `${t} | 디지털인문예술전공`
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
    if (!window.confirm('이 버전으로 복원할까요? 지금 상태도 버전 기록에 남습니다.')) return
    const r = await api.post(`/handover/versions/${v.id}/restore`)
    liveRef.current = r.content
    setHistoryOpen(false)
    setSelVer(null)
    setOlderTexts(null)
    editor.commands.setContent(r.content?.html || r.content, false)
    editor.setEditable(canEdit && mode === 'edit')
    refreshOutline(editor)
    setSaveState('saved')
    flash('버전을 복원했습니다')
  }
  async function renameVersion(v, forced) {
    const name = forced !== undefined ? forced : window.prompt('버전 이름', v.name || '')
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

  function setLink() {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('링크 주소', prev)
    if (url === null) return
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^https?:|^mailto:|^\//.test(url) ? url : `https://${url}` }).run()
  }

  async function insertImage(file) {
    const r = await api.upload(file, { usage: 'general' })
    editor.chain().focus().setImage({ src: r.url }).run()
  }

  async function insertSecret() {
    const label = window.prompt('비밀값 이름 (예: 공식 Gmail 비밀번호)')
    if (!label) return
    const value = window.prompt(`${label} 값`)
    if (!value) return
    const r = await api.post('/handover/secrets', { label, value })
    editor.chain().focus().insertContent({ type: 'secret', attrs: { id: r.item.id, label } }).run()
  }

  const fileBase = () => safeName(`${docTitle} - ${doc?.title || ''}`)
  async function exportAs(kind) {
    try {
      if (kind === 'docx') {
        flash('Word 파일 만드는 중')
        download(await toDocx(editor.getJSON(), docTitle), `${fileBase()}.docx`)
      } else if (kind === 'pdf') {
        flash('PDF 만드는 중')
        await toPdf(pageRef.current, fileBase())
      } else if (kind === 'md') {
        download(new Blob([toMarkdown(editor.getJSON(), `${docTitle} - ${doc.title}`)], { type: 'text/markdown;charset=utf-8' }), `${fileBase()}.md`)
      } else if (kind === 'txt') {
        download(new Blob([toPlainText(editor.getJSON())], { type: 'text/plain;charset=utf-8' }), `${fileBase()}.txt`)
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
          'text/plain': new Blob([toPlainText(editor.getJSON())], { type: 'text/plain' }),
        }),
      ])
      flash('서식 포함 복사 완료. 새 구글 문서에서 ⌘V')
    } catch {
      flash('복사 실패. Word(.docx) 다운로드 후 구글 드라이브에서 열기')
    }
    window.open('https://docs.new', '_blank')
  }

  async function lock() {
    await api.post('/handover/lock')
    navigate('/resources/handover')
  }

  if (access.loading) return <div className="gd-loading">문서 불러오는 중</div>
  if (access.error) return <div className="gd-loading">문서를 불러오지 못했습니다. <Link to="/resources/handover">목록으로</Link></div>

  const ed = editor
  const editing = canEdit && mode === 'edit'
  const styleValue = !ed ? 'p' : [1, 2, 3, 4].map((l) => (ed.isActive('heading', { level: l }) ? `h${l}` : null)).find(Boolean) || 'p'
  const applyStyle = (v) => (v === 'p' ? ed.chain().focus().setParagraph().run() : ed.chain().focus().setHeading({ level: Number(v.slice(1)) }).run())
  const curFont = ed?.getAttributes('textStyle').fontFamily || ''
  const curFontLabel = FONTS.find((f) => f.value === curFont)?.label || (curFont ? curFont.replace(/'/g, '') : 'Pretendard')
  const applySize = (n) => {
    const v = Math.max(1, Math.min(400, Number(n) || 11))
    setSizeDraft(String(v))
    ed.chain().focus().setMark('textStyle', { fontSize: `${v}pt` }).run()
  }
  const curAlign = ['center', 'right', 'justify'].find((a) => ed?.isActive({ textAlign: a })) || 'left'
  const AlignIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify }[curAlign]

  const downloads = [
    { label: 'Microsoft Word(.docx)', onClick: () => exportAs('docx') },
    { label: 'PDF 문서(.pdf)', onClick: () => exportAs('pdf') },
    { label: '마크다운(.md)', onClick: () => exportAs('md') },
    { label: '일반 텍스트(.txt)', onClick: () => exportAs('txt') },
    { label: '웹페이지(.html)', onClick: () => exportAs('html') },
  ]
  const menus = {
    파일: [
      { label: '새 탭', icon: <Plus size={16} />, onClick: () => addTab(), disabled: !canEdit },
      { label: '문서 목록', onClick: () => navigate('/resources/handover') },
      '-',
      { label: '버전 기록', icon: <History size={16} />, children: [{ label: '버전 기록 보기', hint: '⌘⌥⇧H', onClick: openHistory }] },
      { label: '다운로드', icon: <Download size={16} />, children: downloads },
      { label: 'Google Docs로 열기', icon: <ExternalLink size={16} />, onClick: openInGoogleDocs },
      '-',
      { label: '인쇄', hint: '⌘P', icon: <Printer size={16} />, onClick: () => window.print() },
      '-',
      access.access === 'gate' ? { label: '열람 잠그기', icon: <Lock size={16} />, onClick: lock } : { label: '관리자 대시보드', onClick: () => navigate('/admin') },
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
    ],
    삽입: [
      { label: '이미지', icon: <ImagePlus size={16} />, onClick: () => document.getElementById('gd-img-input')?.click(), disabled: !editing },
      { label: '표', icon: <TableIcon size={16} />, onClick: () => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), disabled: !editing },
      { label: '링크', hint: '⌘K', icon: <Link2 size={16} />, onClick: setLink, disabled: !editing },
      { label: '가로줄', onClick: () => ed.chain().focus().setHorizontalRule().run(), disabled: !editing },
      { label: '체크리스트', icon: <ListChecks size={16} />, onClick: () => ed.chain().focus().toggleTaskList().run(), disabled: !editing },
      { label: '비밀값 (계정 비밀번호)', icon: <KeyRound size={16} />, onClick: insertSecret, disabled: !editing },
      '-',
      { label: '탭', icon: <Plus size={16} />, onClick: () => addTab(), disabled: !canEdit },
      { label: '댓글', hint: '⌘⌥M', icon: <MessageSquarePlus size={16} />, onClick: startComment, disabled: !canEdit },
    ],
    서식: [
      ...STYLE_OPTIONS.map((o) => ({ label: o.label, checked: styleValue === o.value, onClick: () => applyStyle(o.value), disabled: !editing })),
      '-',
      { label: '서식 지우기', hint: '⌘\\', icon: <RemoveFormatting size={16} />, onClick: () => ed.chain().focus().unsetAllMarks().clearNodes().run(), disabled: !editing },
    ],
    도구: [{ label: '글자 수', onClick: () => flash(`글자 수 ${ed.state.doc.textContent.length.toLocaleString()}자 · 댓글 ${comments.length}개`) }],
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
    <div className="gd">
      <style>{highlightCss}</style>
      <header className="gd-top">
        <Link to="/resources/handover" className="gd-logo" aria-label="문서 목록"><DocIcon /></Link>
        <div className="gd-titlebox">
          <div className="gd-titlerow">
            <span ref={mirrorRef} className="gd-title gd-title--mirror" aria-hidden="true">{titleDraft || ' '}</span>
            <input
              className="gd-title"
              value={titleDraft}
              readOnly={!canEdit}
              style={{ width: titleWidth }}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveDocTitle}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="문서 제목"
              title={docTitle}
            />
            <span className="gd-ticon" title="별표"><Star size={18} /></span>
            <span className="gd-ticon gd-save" title="저장 상태">
              <Cloud size={18} />
              <span>{saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중...' : saveState === 'error' ? '저장 실패' : ''}</span>
            </span>
          </div>
          <nav className="gd-menubar">
            {Object.entries(menus).map(([label, items]) => (
              <Dropdown key={label} trigger={(open) => <button type="button" className={`gd-menu__btn${open ? ' is-open' : ''}`}>{label}</button>}>
                {(close) => <MenuItems items={items} close={close} />}
              </Dropdown>
            ))}
          </nav>
        </div>
        <div className="gd-actions">
          <span className="gd-meta">{doc.updated_by ? `${doc.updated_by} 님이 마지막으로 수정` : ''}</span>
          <button type="button" className={`gd-round${historyOpen ? ' is-on' : ''}`} aria-label="버전 기록" title="버전 기록 (⌘⌥⇧H)" onClick={() => (historyOpen ? closeHistory() : openHistory())}>
            <History size={20} />
          </button>
          <button type="button" className={`gd-round${showComments ? ' is-on' : ''}`} aria-label="댓글 표시" title="댓글 표시" onClick={() => setShowComments((v) => !v)}>
            <MessageSquareText size={20} />
          </button>
          <button type="button" className="gd-share" onClick={async () => { await navigator.clipboard.writeText(window.location.href).catch(() => {}); flash('링크 복사됨. 비로그인 열람은 비밀번호 필요') }}>
            <Lock size={16} /> <span>공유</span>
          </button>
          <span className="gd-avatar gd-avatar--lg" style={{ background: colorOf(user?.name || '열람') }} title={user ? `${user.name} (${user.role})` : '비밀번호 열람'}>
            {(user?.name || '열').slice(0, 1)}
          </span>
        </div>
      </header>

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
          {(close) => FONTS.map((f) => (
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
          <button type="button" className="gd-tb gd-tb--color" disabled={!editing} title="강조 표시 색상"><Highlighter size={18} strokeWidth={1.8} /><i style={{ background: ed?.getAttributes('highlight').color || 'transparent' }} /></button>
        )}>
          {(close) => colorGrid((c) => ed.chain().focus().setHighlight({ color: c }).run(), close, () => ed.chain().focus().unsetHighlight().run())}
        </Dropdown>
        <span className="gd-sep" />
        <TB icon={Link2} label="링크 삽입 (⌘K)" onClick={setLink} active={ed?.isActive('link')} disabled={!editing} />
        <TB icon={MessageSquarePlus} label="댓글 추가 (⌘⌥M)" onClick={startComment} disabled={!canEdit} />
        <label className={`gd-tb${editing ? '' : ' is-disabled'}`} title="이미지 삽입">
          <ImagePlus size={18} strokeWidth={1.8} />
          <input id="gd-img-input" type="file" accept="image/*" hidden disabled={!editing} onChange={(e) => e.target.files[0] && insertImage(e.target.files[0])} />
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

      <div className="gd-ruler" aria-hidden="true">
        <div className="gd-ruler__inner" style={{ width: 816 * (zoom / 100) }}>
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
                        navigate(`/handover/${t.id}`)
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
          <div className={`gd-canvas${showComments && !historyOpen ? '' : ' no-comments'}`} ref={canvasRef} style={{ zoom: zoom / 100 }}>
            <div className="gd-page" ref={pageRef}>
              <EditorContent editor={ed} />
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

      {access.access === 'gate' && <div className="gd-banner">비밀번호 열람 중: 읽기 전용</div>}
      {toast && <div className="gd-toast">{toast}</div>}
      {lightbox && <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}
