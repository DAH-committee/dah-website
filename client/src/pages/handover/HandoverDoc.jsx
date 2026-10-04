// /handover/:id: 운영위원회 인수인계 문서 편집기. 구글 독스 화면 구조(제목 줄, 메뉴, 알약형 툴바, 눈금자,
// 문서 탭·개요, 종이 쪽)를 그대로 따르고, 댓글은 종이 좌우 여백에 붙는다.
// 열람: 관리자 로그인(manager 이상) 또는 열람 비밀번호 통과. 편집·댓글: 관리자 로그인.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
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
import Placeholder from '@tiptap/extension-placeholder'
import {
  Undo2, Redo2, Printer, Bold, Italic, Underline as UIcon, Highlighter, Link2, MessageSquarePlus,
  ImagePlus, AlignLeft, AlignCenter, AlignRight, AlignJustify, ListChecks, List, ListOrdered,
  IndentDecrease, IndentIncrease, RemoveFormatting, Search, Star, Cloud, MessageSquareText, Lock,
  ChevronDown, MoreVertical, Check, X, Pencil, Eye, ArrowLeft, FileText, Plus, ExternalLink, Unlink,
  KeyRound, Minus, Table as TableIcon, PanelLeft,
} from 'lucide-react'
import { api } from '../../hooks/useApi'
import { useAuth } from '../../context/AuthContext'
import { CommentMark, SecretNode, HandoverStorage } from './extensions'
import './handoverDoc.css'

const AVATAR_COLORS = ['#7b57d1', '#1a73e8', '#188038', '#e37400', '#d93025', '#9334e6', '#00838f']
const colorOf = (name = '') => AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const h = d.getHours()
  const ap = h < 12 ? '오전' : '오후'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${ap} ${hh}:${String(d.getMinutes()).padStart(2, '0')} ${d.getMonth() + 1}월 ${d.getDate()}일`
}

function linkify(text) {
  const parts = String(text || '').split(/(https?:\/\/[^\s)]+)/g)
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\//, '')}</a>
    ) : (
      <span key={i}>{p}</span>
    )
  )
}

const newAnchorId = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// 구글 독스 문서 아이콘 모양(파란 종이 + 접힌 모서리 + 줄)
function DocsIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#4285f4" />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill="#a1c2fa" />
      <rect x="13" y="18" width="14" height="2" rx="1" fill="#fff" />
      <rect x="13" y="23" width="14" height="2" rx="1" fill="#fff" />
      <rect x="13" y="28" width="9" height="2" rx="1" fill="#fff" />
    </svg>
  )
}

function Menu({ label, items, open, onOpen, onClose }) {
  return (
    <div className="gd-menu">
      <button type="button" className={`gd-menu__btn${open ? ' is-open' : ''}`} onClick={() => (open ? onClose() : onOpen())} onMouseEnter={() => open !== undefined && onOpen(true)}>
        {label}
      </button>
      {open && (
        <div className="gd-menu__panel" role="menu">
          {items.map((it, i) =>
            it === '-' ? (
              <div key={i} className="gd-menu__sep" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className="gd-menu__item"
                disabled={it.disabled}
                onClick={() => {
                  onClose()
                  it.onClick?.()
                }}
              >
                <span className="gd-menu__check">{it.checked ? <Check size={16} /> : null}</span>
                <span className="gd-menu__label">{it.label}</span>
                {it.hint && <span className="gd-menu__hint">{it.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

function TB({ icon: Icon, label, onClick, active, disabled, children }) {
  return (
    <button
      type="button"
      className={`gd-tb${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
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
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.body)
  const [busy, setBusy] = useState(false)

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
    <div
      ref={cardRef}
      className={`gd-cc${active ? ' is-active' : ''}${c.resolved ? ' is-resolved' : ''}`}
      style={style}
      onClick={() => onActivate(c.anchor_id)}
    >
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
            <div className="gd-cc__more">
              <button type="button" className="gd-icon-btn" aria-label="옵션 더보기" onClick={() => setMenu((m) => !m)}>
                <MoreVertical size={18} />
              </button>
              {menu && (
                <div className="gd-menu__panel gd-menu__panel--right" onMouseLeave={() => setMenu(false)}>
                  <button type="button" className="gd-menu__item" onClick={() => { setMenu(false); setEditing(true) }}><span className="gd-menu__check" /><span className="gd-menu__label">수정</span></button>
                  <label className="gd-menu__item"><span className="gd-menu__check" /><span className="gd-menu__label">사진 추가</span>
                    <input type="file" accept="image/*" hidden onChange={(e) => { setMenu(false); e.target.files[0] && addImage(e.target.files[0]) }} />
                  </label>
                  <button type="button" className="gd-menu__item" onClick={() => { setMenu(false); onUpdate(c, { side: c.side === 'left' ? 'right' : 'left' }) }}>
                    <span className="gd-menu__check" /><span className="gd-menu__label">{c.side === 'left' ? '오른쪽 여백으로 이동' : '왼쪽 여백으로 이동'}</span>
                  </button>
                  <div className="gd-menu__sep" />
                  <button type="button" className="gd-menu__item" onClick={() => { setMenu(false); if (window.confirm('이 댓글을 삭제할까요?')) onDelete(c) }}><span className="gd-menu__check" /><span className="gd-menu__label">삭제</span></button>
                </div>
              )}
            </div>
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
  const { side, body = '', images = [] } = draft

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
          {images.map((im, i) => (
            <span key={i} className="gd-cc__img"><img src={im.url} alt="" /></span>
          ))}
        </div>
      )}
      <div className="gd-cc__opts">
        <label className="gd-chip-btn">
          <ImagePlus size={16} /> 사진
          <input type="file" accept="image/*" multiple hidden onChange={(e) => pick([...e.target.files])} />
        </label>
        <div className="gd-seg" role="group" aria-label="댓글 위치">
          <button type="button" className={side === 'left' ? 'is-on' : ''} onClick={() => setDraft((v) => ({ ...v, side: 'left' }))}>왼쪽</button>
          <button type="button" className={side === 'right' ? 'is-on' : ''} onClick={() => setDraft((v) => ({ ...v, side: 'right' }))}>오른쪽</button>
        </div>
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

const STYLE_OPTIONS = [
  { value: 'p', label: '일반 텍스트' },
  { value: 'h1', label: '제목' },
  { value: 'h2', label: '제목 1' },
  { value: 'h3', label: '제목 2' },
  { value: 'h4', label: '제목 3' },
]

export default function HandoverDoc() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [doc, setDoc] = useState(null)
  const [docs, setDocs] = useState([])
  const [comments, setComments] = useState([])
  const [access, setAccess] = useState({ loading: true })
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState('saved')
  const [mode, setMode] = useState('edit')
  const [openMenu, setOpenMenu] = useState(null)
  const [active, setActive] = useState(null)
  const [composer, setComposer] = useState(null)
  const [showComments, setShowComments] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [showOutline, setShowOutline] = useState(() => window.innerWidth >= 1700)
  const [zoom, setZoom] = useState(() => (window.innerWidth > 1100 && window.innerWidth < 1250 ? 75 : window.innerWidth > 1100 && window.innerWidth < 1480 ? 90 : 100))
  const [outline, setOutline] = useState([])
  const [positions, setPositions] = useState({})
  const [lightbox, setLightbox] = useState(null)
  const [linkBubble, setLinkBubble] = useState(null)
  const [modeMenu, setModeMenu] = useState(false)
  const [styleMenu, setStyleMenu] = useState(false)
  const [toast, setToast] = useState('')
  const canvasRef = useRef(null)
  const cardRefs = useRef({})
  const saveTimer = useRef(null)
  const canEdit = access.canEdit === true

  const flash = (t) => {
    setToast(t)
    setTimeout(() => setToast(''), 1800)
  }

  // 접근 확인과 문서 불러오기
  useEffect(() => {
    let off = false
    ;(async () => {
      try {
        const [d, list, cm] = await Promise.all([
          api.get(`/handover/docs/${id}`),
          api.get('/handover/docs'),
          api.get(`/handover/docs/${id}/comments`),
        ])
        if (off) return
        setDoc(d.item)
        setTitle(d.item.title)
        setDocs(list.items)
        setComments(cm.items)
        setAccess({ loading: false, access: d.access, canEdit: d.canEdit })
        setMode(d.canEdit ? 'edit' : 'view')
        document.title = `${d.item.title} - Google Docs 형식 | 디지털인문예술전공`
      } catch (e) {
        if (off) return
        if (e?.status === 401 || /locked|401/.test(String(e?.message))) navigate('/resources/handover', { replace: true })
        else setAccess({ loading: false, error: true })
      }
    })()
    return () => {
      off = true
    }
  }, [id, navigate])

  const save = useCallback(
    async (editor) => {
      if (!canEdit) return
      setSaveState('saving')
      try {
        await api.put(`/handover/docs/${id}`, { content: editor.getJSON() })
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    },
    [canEdit, id]
  )

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
        Highlight,
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: '내용 입력' }),
        CommentMark,
        SecretNode,
        HandoverStorage,
      ],
      content: doc ? doc.content || doc.content_html || '<p></p>' : '',
      editable: false,
      onUpdate: ({ editor: ed }) => {
        refreshOutline(ed)
        if (!ed.isEditable) return
        setSaveState('dirty')
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => save(ed), 1200)
      },
      onSelectionUpdate: ({ editor: ed }) => updateLinkBubble(ed),
    },
    [doc?.id]
  )

  useEffect(() => {
    if (!editor) return
    editor.storage.handover.canEdit = canEdit
    editor.setEditable(canEdit && mode === 'edit')
  }, [editor, canEdit, mode])

  function refreshOutline(ed) {
    const out = []
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading') out.push({ level: n.attrs.level, text: n.textContent, pos })
    })
    setOutline(out)
  }

  function updateLinkBubble(ed) {
    if (!ed.isActive('link')) return setLinkBubble(null)
    const href = ed.getAttributes('link').href
    const { from } = ed.state.selection
    const c = ed.view.coordsAtPos(from)
    const box = canvasRef.current?.getBoundingClientRect()
    if (!box) return
    setLinkBubble({ href, top: (c.bottom - box.top) / (zoom / 100) + 6, left: (c.left - box.left) / (zoom / 100) })
  }

  useEffect(() => {
    if (editor) refreshOutline(editor)
  }, [editor])

  // 저장 전 이탈 경고
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

  const visibleComments = useMemo(
    () => comments.filter((c) => showResolved || !c.resolved),
    [comments, showResolved]
  )

  // 댓글 위치: 앵커 문장 높이에 맞추고 같은 쪽 카드끼리는 겹치지 않게 아래로 민다.
  const layout = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = zoom / 100
    const cTop = canvas.getBoundingClientRect().top
    const want = []
    for (const c of visibleComments) {
      const el = canvas.querySelector(`[data-comment="${CSS.escape(c.anchor_id)}"]`)
      if (!el) continue
      want.push({ key: `c${c.id}`, side: c.side, top: (el.getBoundingClientRect().top - cTop) / scale, anchor: c.anchor_id })
    }
    if (composer) want.push({ key: 'composer', side: composer.side, top: composer.top, anchor: composer.anchorId })
    const next = {}
    for (const side of ['left', 'right']) {
      const list = want.filter((w) => w.side === side).sort((a, b) => a.top - b.top)
      const activeIdx = list.findIndex((w) => w.anchor === active || w.key === 'composer')
      const h = (w) => (cardRefs.current[w.key]?.offsetHeight || 80) + 10
      if (activeIdx < 0) {
        let y = -Infinity
        for (const w of list) {
          const t = Math.max(w.top, y)
          next[w.key] = t
          y = t + h(w)
        }
      } else {
        // 활성 댓글은 문장 높이에 고정, 위쪽 카드는 위로, 아래쪽 카드는 아래로 밀기
        next[list[activeIdx].key] = list[activeIdx].top
        let y = list[activeIdx].top
        for (let i = activeIdx - 1; i >= 0; i -= 1) {
          const t = Math.min(list[i].top, y - h(list[i]))
          next[list[i].key] = t
          y = t
        }
        y = list[activeIdx].top + h(list[activeIdx])
        for (let i = activeIdx + 1; i < list.length; i += 1) {
          const t = Math.max(list[i].top, y)
          next[list[i].key] = t
          y = t + h(list[i])
        }
      }
    }
    setPositions((prev) => {
      const a = JSON.stringify(prev)
      const b = JSON.stringify(next)
      return a === b ? prev : next
    })
  }, [visibleComments, composer, active, zoom])

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

  // 문장 클릭으로 댓글 활성화
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const h = (e) => {
      const m = e.target.closest?.('[data-comment]')
      if (m && canvas.querySelector('.gd-page')?.contains(m)) setActive(m.getAttribute('data-comment'))
      else if (!e.target.closest?.('.gd-cc')) setActive(null)
    }
    canvas.addEventListener('click', h)
    return () => canvas.removeEventListener('click', h)
  })

  const highlightCss = useMemo(() => {
    const live = new Set(visibleComments.filter((c) => !c.resolved).map((c) => c.anchor_id))
    const rules = [...live].map((a) => `.gd-page [data-comment="${CSS.escape(a)}"]{background:rgba(255,212,0,.22);border-bottom:2px solid rgba(255,190,0,.55)}`)
    if (active) rules.push(`.gd-page [data-comment="${CSS.escape(active)}"]{background:rgba(255,212,0,.55)}`)
    return rules.join('\n')
  }, [visibleComments, active])

  function startComment() {
    if (!editor || !canEdit) return
    const { from, to, empty } = editor.state.selection
    if (empty) return flash('댓글을 달 문장을 먼저 선택')
    const c = editor.view.coordsAtPos(from)
    const box = canvasRef.current.getBoundingClientRect()
    const anchorId = newAnchorId()
    setComposer({ from, to, anchorId, side: 'right', top: (c.top - box.top) / (zoom / 100), quote: editor.state.doc.textBetween(from, to, ' ') })
    setActive(anchorId)
  }

  async function submitComment({ body, images }) {
    const cmp = composer
    const r = await api.post(`/handover/docs/${id}/comments`, { anchor_id: cmp.anchorId, side: cmp.side, quote: cmp.quote, body, images })
    const wasEditable = editor.isEditable
    if (!wasEditable) editor.setEditable(true)
    editor.chain().setTextSelection({ from: cmp.from, to: cmp.to }).setMark('comment', { id: cmp.anchorId }).run()
    if (!wasEditable) editor.setEditable(false)
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
    // 같은 앵커에 다른 댓글이 없으면 문장 표시도 지운다
    if (!comments.some((x) => x.id !== c.id && x.anchor_id === c.anchor_id) && editor) {
      const ranges = []
      editor.state.doc.descendants((n, pos) => {
        if (n.marks?.some((m) => m.type.name === 'comment' && m.attrs.id === c.anchor_id)) ranges.push([pos, pos + n.nodeSize])
      })
      if (ranges.length) {
        const tr = editor.state.tr
        for (const [a, b] of ranges) tr.removeMark(a, b, editor.schema.marks.comment)
        editor.view.dispatch(tr)
        save(editor)
      }
    }
  }

  function setLink() {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('링크 주소', prev)
    if (url === null) return
    if (!url) return editor.chain().focus().extendMarkRange('link').unsetLink().run()
    editor.chain().focus().extendMarkRange('link').setLink({ href: /^https?:|^mailto:|^\//.test(url) ? url : `https://${url}` }).run()
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

  async function newDoc() {
    const r = await api.post('/handover/docs', { title: '제목 없는 문서' })
    navigate(`/handover/${r.item.id}`)
  }

  async function saveTitle() {
    if (!canEdit || !title.trim() || title === doc.title) return
    await api.put(`/handover/docs/${id}`, { title })
    setDoc((d) => ({ ...d, title }))
    setDocs((list) => list.map((x) => (x.id === doc.id ? { ...x, title } : x)))
  }

  function downloadHtml() {
    const blob = new Blob([`<!doctype html><meta charset="utf-8"><title>${title}</title>${editor.getHTML()}`], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title}.html`
    a.click()
  }

  async function lock() {
    await api.post('/handover/lock')
    navigate('/resources/handover')
  }

  const styleValue = editor
    ? editor.isActive('heading', { level: 1 }) ? 'h1'
      : editor.isActive('heading', { level: 2 }) ? 'h2'
        : editor.isActive('heading', { level: 3 }) ? 'h3'
          : editor.isActive('heading', { level: 4 }) ? 'h4' : 'p'
    : 'p'

  function applyStyle(v) {
    const ch = editor.chain().focus()
    if (v === 'p') ch.setParagraph().run()
    else ch.setHeading({ level: Number(v.slice(1)) }).run()
  }

  if (access.loading) return <div className="gd-loading">문서 불러오는 중</div>
  if (access.error) return <div className="gd-loading">문서를 불러오지 못했습니다. <Link to="/resources/handover">목록으로</Link></div>

  const ed = editor
  const editing = canEdit && mode === 'edit'
  const menus = {
    파일: [
      { label: '새 문서', onClick: newDoc, disabled: !canEdit },
      { label: '문서 목록', onClick: () => navigate('/resources/handover') },
      '-',
      { label: 'HTML로 다운로드', onClick: downloadHtml },
      { label: '인쇄', hint: '⌘P', onClick: () => window.print() },
      '-',
      access.access === 'gate' ? { label: '열람 잠그기', onClick: lock } : { label: '관리자 대시보드', onClick: () => navigate('/admin') },
    ],
    수정: [
      { label: '실행취소', hint: '⌘Z', onClick: () => ed.chain().focus().undo().run(), disabled: !editing },
      { label: '재실행', hint: '⌘⇧Z', onClick: () => ed.chain().focus().redo().run(), disabled: !editing },
      '-',
      { label: '모두 선택', hint: '⌘A', onClick: () => ed.chain().focus().selectAll().run() },
    ],
    보기: [
      { label: '댓글 표시', checked: showComments, onClick: () => setShowComments((v) => !v) },
      { label: '해결된 댓글 표시', checked: showResolved, onClick: () => setShowResolved((v) => !v) },
      { label: '문서 개요 표시', checked: showOutline, onClick: () => setShowOutline((v) => !v) },
    ],
    삽입: [
      { label: '이미지', onClick: () => document.getElementById('gd-img-input')?.click(), disabled: !editing },
      { label: '표 (3×3)', onClick: () => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), disabled: !editing },
      { label: '링크', hint: '⌘K', onClick: setLink, disabled: !editing },
      { label: '가로줄', onClick: () => ed.chain().focus().setHorizontalRule().run(), disabled: !editing },
      { label: '체크리스트', onClick: () => ed.chain().focus().toggleTaskList().run(), disabled: !editing },
      { label: '비밀값 (계정 비밀번호)', onClick: insertSecret, disabled: !editing },
      '-',
      { label: '댓글', hint: '⌘⌥M', onClick: startComment, disabled: !canEdit },
    ],
    서식: [
      ...STYLE_OPTIONS.map((o) => ({ label: o.label, checked: styleValue === o.value, onClick: () => applyStyle(o.value), disabled: !editing })),
      '-',
      { label: '서식 지우기', hint: '⌘\\', onClick: () => ed.chain().focus().unsetAllMarks().clearNodes().run(), disabled: !editing },
    ],
    도구: [
      { label: '글자 수', onClick: () => flash(`글자 수 ${ed.state.doc.textContent.length.toLocaleString()}자 · 댓글 ${comments.length}개`) },
    ],
    도움말: [
      { label: '댓글: 문장 선택 후 툴바 댓글 버튼', onClick: () => {} },
      { label: '비밀값: 눈 아이콘 보기, 복사 아이콘 복사', onClick: () => {} },
      { label: '저장: 입력 후 자동 저장', onClick: () => {} },
    ],
  }

  const rail = (side) =>
    showComments && (
      <div className={`gd-rail gd-rail--${side}`}>
        {visibleComments.filter((c) => c.side === side).map((c) => (
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
        {composer && composer.side === side && (
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
    )

  return (
    <div className="gd" onClick={() => openMenu && setOpenMenu(null)}>
      <style>{highlightCss}</style>
      <header className="gd-top">
        <Link to="/resources/handover" className="gd-logo" aria-label="문서 목록"><DocsIcon /></Link>
        <div className="gd-titlebox">
          <div className="gd-titlerow">
            <input
              className="gd-title"
              value={title}
              readOnly={!canEdit}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              size={Math.max(8, title.length + 1)}
              aria-label="문서 제목"
            />
            <span className="gd-ticon" title="별표"><Star size={18} /></span>
            <span className="gd-ticon gd-save" title={saveState === 'saved' ? '모든 변경사항이 저장됨' : saveState === 'saving' ? '저장 중' : saveState === 'error' ? '저장 실패' : '저장 대기'}>
              <Cloud size={18} />
              <span>{saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중...' : saveState === 'error' ? '저장 실패' : ''}</span>
            </span>
          </div>
          <nav className="gd-menubar" onClick={(e) => e.stopPropagation()}>
            {Object.entries(menus).map(([label, items]) => (
              <Menu key={label} label={label} items={items} open={openMenu === label}
                onOpen={(hover) => (hover ? openMenu && setOpenMenu(label) : setOpenMenu(label))}
                onClose={() => setOpenMenu(null)} />
            ))}
          </nav>
        </div>
        <div className="gd-actions">
          <span className="gd-meta">{doc.updated_by ? `${doc.updated_by} 님이 마지막으로 수정` : ''}</span>
          <button type="button" className={`gd-round${showComments ? ' is-on' : ''}`} aria-label="댓글 표시" title="댓글 표시" onClick={() => setShowComments((v) => !v)}>
            <MessageSquareText size={20} />
          </button>
          <button
            type="button"
            className="gd-share"
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href).catch(() => {})
              flash('링크 복사됨. 비로그인 열람은 비밀번호 필요')
            }}
          >
            <Lock size={16} /> 공유
          </button>
          <span className="gd-avatar gd-avatar--lg" style={{ background: colorOf(user?.name || '열람') }} title={user ? `${user.name} (${user.role})` : '비밀번호 열람'}>
            {(user?.name || '열').slice(0, 1)}
          </span>
        </div>
      </header>

      <div className="gd-toolbar" onMouseDown={(e) => e.target.closest('select,input') || null}>
        <TB icon={Search} label="메뉴 검색" onClick={() => flash('⌘F로 문서 내 검색')} />
        <TB icon={Undo2} label="실행취소 (⌘Z)" onClick={() => ed.chain().focus().undo().run()} disabled={!editing} />
        <TB icon={Redo2} label="재실행 (⌘Y)" onClick={() => ed.chain().focus().redo().run()} disabled={!editing} />
        <TB icon={Printer} label="인쇄 (⌘P)" onClick={() => window.print()} />
        <span className="gd-sep" />
        <label className="gd-select gd-select--zoom">
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="확대/축소">
            {[50, 75, 90, 100, 125, 150].map((z) => <option key={z} value={z}>{z}%</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
        <span className="gd-sep" />
        <div className="gd-dd">
          <button type="button" className="gd-select gd-select--style" disabled={!editing} onMouseDown={(e) => e.preventDefault()} onClick={() => setStyleMenu((v) => !v)}>
            <span>{STYLE_OPTIONS.find((o) => o.value === styleValue)?.label}</span><ChevronDown size={14} />
          </button>
          {styleMenu && (
            <div className="gd-menu__panel gd-style-panel" onMouseLeave={() => setStyleMenu(false)}>
              {STYLE_OPTIONS.map((o) => (
                <button key={o.value} type="button" className={`gd-menu__item gd-style-${o.value}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { applyStyle(o.value); setStyleMenu(false) }}>
                  <span className="gd-menu__check">{styleValue === o.value ? <Check size={16} /> : null}</span>
                  <span className="gd-menu__label">{o.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="gd-sep" />
        <span className="gd-select gd-select--font" title="글꼴: Pretendard 고정">Pretendard<ChevronDown size={14} /></span>
        <span className="gd-sep" />
        <TB icon={Minus} label="글꼴 크기 줄이기" onClick={() => setZoom((z) => Math.max(50, z - 10))} />
        <span className="gd-size">11</span>
        <TB icon={Plus} label="글꼴 크기 늘리기" onClick={() => setZoom((z) => Math.min(150, z + 10))} />
        <span className="gd-sep" />
        <TB icon={Bold} label="굵게 (⌘B)" onClick={() => ed.chain().focus().toggleBold().run()} active={ed?.isActive('bold')} disabled={!editing} />
        <TB icon={Italic} label="기울임꼴 (⌘I)" onClick={() => ed.chain().focus().toggleItalic().run()} active={ed?.isActive('italic')} disabled={!editing} />
        <TB icon={UIcon} label="밑줄 (⌘U)" onClick={() => ed.chain().focus().toggleUnderline().run()} active={ed?.isActive('underline')} disabled={!editing} />
        <TB icon={Highlighter} label="강조 표시 색상" onClick={() => ed.chain().focus().toggleHighlight().run()} active={ed?.isActive('highlight')} disabled={!editing} />
        <span className="gd-sep" />
        <TB icon={Link2} label="링크 삽입 (⌘K)" onClick={setLink} active={ed?.isActive('link')} disabled={!editing} />
        <TB icon={MessageSquarePlus} label="댓글 추가 (⌘⌥M)" onClick={startComment} disabled={!canEdit} />
        <label className={`gd-tb${editing ? '' : ' is-disabled'}`} title="이미지 삽입">
          <ImagePlus size={18} strokeWidth={1.8} />
          <input id="gd-img-input" type="file" accept="image/*" hidden disabled={!editing} onChange={(e) => e.target.files[0] && insertImage(e.target.files[0])} />
        </label>
        <TB icon={KeyRound} label="비밀값 삽입" onClick={insertSecret} disabled={!editing} />
        <TB icon={TableIcon} label="표 삽입" onClick={() => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} disabled={!editing} />
        <span className="gd-sep" />
        <TB icon={AlignLeft} label="왼쪽 정렬" onClick={() => ed.chain().focus().setTextAlign('left').run()} active={ed?.isActive({ textAlign: 'left' })} disabled={!editing} />
        <TB icon={AlignCenter} label="가운데 정렬" onClick={() => ed.chain().focus().setTextAlign('center').run()} active={ed?.isActive({ textAlign: 'center' })} disabled={!editing} />
        <TB icon={AlignRight} label="오른쪽 정렬" onClick={() => ed.chain().focus().setTextAlign('right').run()} active={ed?.isActive({ textAlign: 'right' })} disabled={!editing} />
        <TB icon={AlignJustify} label="양쪽 정렬" onClick={() => ed.chain().focus().setTextAlign('justify').run()} active={ed?.isActive({ textAlign: 'justify' })} disabled={!editing} />
        <span className="gd-sep" />
        <TB icon={ListChecks} label="체크리스트" onClick={() => ed.chain().focus().toggleTaskList().run()} active={ed?.isActive('taskList')} disabled={!editing} />
        <TB icon={List} label="글머리기호 목록" onClick={() => ed.chain().focus().toggleBulletList().run()} active={ed?.isActive('bulletList')} disabled={!editing} />
        <TB icon={ListOrdered} label="번호 매기기 목록" onClick={() => ed.chain().focus().toggleOrderedList().run()} active={ed?.isActive('orderedList')} disabled={!editing} />
        <TB icon={IndentDecrease} label="내어쓰기" onClick={() => ed.chain().focus().liftListItem(ed.isActive('taskItem') ? 'taskItem' : 'listItem').run()} disabled={!editing} />
        <TB icon={IndentIncrease} label="들여쓰기" onClick={() => ed.chain().focus().sinkListItem(ed.isActive('taskItem') ? 'taskItem' : 'listItem').run()} disabled={!editing} />
        <TB icon={RemoveFormatting} label="서식 지우기" onClick={() => ed.chain().focus().unsetAllMarks().run()} disabled={!editing} />
        <span className="gd-grow" />
        <div className="gd-dd">
          <button type="button" className="gd-mode" onClick={() => canEdit && setModeMenu((v) => !v)}>
            {mode === 'edit' ? <Pencil size={16} /> : <Eye size={16} />}
            <span>{mode === 'edit' ? '수정' : '보기'}</span>
            {canEdit && <ChevronDown size={14} />}
          </button>
          {modeMenu && (
            <div className="gd-menu__panel gd-menu__panel--right gd-mode-panel" onMouseLeave={() => setModeMenu(false)}>
              <button type="button" className="gd-menu__item" onClick={() => { setMode('edit'); setModeMenu(false) }}>
                <span className="gd-menu__check"><Pencil size={16} /></span><span className="gd-menu__label"><b>수정</b><small>문서 직접 수정</small></span>
              </button>
              <button type="button" className="gd-menu__item" onClick={() => { setMode('view'); setModeMenu(false) }}>
                <span className="gd-menu__check"><Eye size={16} /></span><span className="gd-menu__label"><b>보기</b><small>읽기만, 댓글은 가능</small></span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="gd-ruler" aria-hidden="true">
        <div className="gd-ruler__inner" style={{ width: 816 * (zoom / 100) }}>
          {Array.from({ length: 22 }, (_, i) => (
            <span key={i} style={{ left: `${(i / 21.59) * 100}%` }}>{i > 2 && i < 20 ? i - 2 : ''}</span>
          ))}
        </div>
      </div>

      <div className="gd-body">
        {showOutline && (
          <aside className="gd-outline">
            <button type="button" className="gd-outline__back" aria-label="문서 목록" onClick={() => navigate('/resources/handover')}><ArrowLeft size={20} /></button>
            <div className="gd-outline__head">
              <span>문서 탭</span>
              {canEdit && <button type="button" className="gd-icon-btn" aria-label="새 문서" onClick={newDoc}><Plus size={18} /></button>}
            </div>
            {docs.map((d) => (
              <div key={d.id}>
                <Link to={`/handover/${d.id}`} className={`gd-tab${String(d.id) === String(id) ? ' is-on' : ''}`}>
                  <FileText size={18} /> <span>{d.id === doc.id ? title : d.title}</span>
                </Link>
                {String(d.id) === String(id) && (
                  <ul className="gd-outline__list">
                    {outline.length === 0 && <li className="gd-outline__empty">문서에 추가한 제목이 여기 표시됨</li>}
                    {outline.map((o, i) => (
                      <li key={i} className={`lv${o.level}`}>
                        <button type="button" onClick={() => {
                          const dom = ed.view.nodeDOM(o.pos)
                          dom?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }}>{o.text}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </aside>
        )}
        {!showOutline && (
          <button type="button" className="gd-outline-open" aria-label="문서 개요 표시" onClick={() => setShowOutline(true)}><PanelLeft size={20} /></button>
        )}
        <div className="gd-scroll">
          <div className="gd-canvas" ref={canvasRef} style={{ zoom: zoom / 100 }}>
            {rail('left')}
            <div className="gd-page">
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
            {rail('right')}
          </div>
        </div>
      </div>

      {access.access === 'gate' && <div className="gd-banner">비밀번호 열람 중: 읽기 전용. 편집·댓글은 관리자 로그인 필요</div>}
      {toast && <div className="gd-toast">{toast}</div>}
      {lightbox && <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}
