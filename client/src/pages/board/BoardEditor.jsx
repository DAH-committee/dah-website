// DAH Board: 무한 캔버스 보드 편집기 (/boards/:id).
//
// 내용 모양(ws_files.content, 서버 server/src/routes/boards.js가 같은 모양을 검사한다)
//   {
//     version: 2,
//     active: canvasId,                           // 마지막으로 보던 캔버스
//     canvases: [{
//       id, name,                                 // 캔버스(페이지) 하나. 보드 파일 하나에 여러 개
//       viewport?: { x, y, zoom },                // 그 캔버스를 마지막으로 본 화면 위치(화면 좌표 = 세계 좌표 * zoom + x·y)
//       items: [{
//         id, type, x, y, w, h, color, z,         // 세계 좌표(px), 색 이름(palette.js), 겹침 순서
//         group?: string, locked?: true,          // 묶음 id, 잠금
//         data: memo {html} | keyword {text} | link {url, title, description?, image?, siteName?, kind?, embedUrl?}
//             | image {src, alt} | video {url, provider, vid, title}
//             | file {kind:'doc'|'sheet'|'form'|'slide'|'board', fileId, tabId, title}
//             | sticky {text} | shape {shape:'rect'|'rounded'|'ellipse'|'diamond'|'triangle'|'arrow', text}
//             | text {text, size, bold} | stroke {tool:'pen'|'highlighter', width, points:[x,y,...](항목 기준, 2000점까지)}
//             | frame {name, order}               // 프레임: 안에 든 항목을 함께 옮기고, 발표·내보내기의 한 장이 된다
//       }],
//       connections: [{ id, from, to, label, arrow: 'none'|'end'|'both', color, style: 'curve'|'straight'|'elbow' }],
//       comments: [{ id, itemId, author, text, at(ISO), resolved }]
//     }]
//   }
// version 1({version:1, viewport, items, connections})은 불러올 때 캔버스 하나("캔버스 1")로 옮긴다(sanitize.js migrateV1).
// 모든 캔버스를 합쳐 항목 5000개, JSON 4MB까지. 메모 HTML과 주소는 읽을 때와 그릴 때 sanitize.js로 다시 거른다.
//
// 저장: 바뀌면 0.8초 모아서 PUT /workspace/boards/:id. 보기 권한이면 읽기만 한다.
// 실행취소: 바꾸기 직전의 보드 전체(캔버스 목록)를 기록한다(history.js, 100단계). 바뀌지 않은 캔버스·항목은 참조를 공유해 가볍다.
// 화면 밖 항목은 그리지 않는다(컬링). 항목 1000개 이상에서도 이동·확대가 부드럽게.
import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, ArrowLeftRight, ArrowRight, Bold, BringToFront, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Cloud, Copy, Eraser, FileDown, FileText, Frame, Group, Hand, Heading, Highlighter, Image as ImageIcon, Italic, Keyboard,
  LayoutTemplate, Link2, List, ListOrdered, Lock, LockOpen, Map as MapIcon, Magnet, Maximize, MessageSquare, MessageSquarePlus, Minus,
  MousePointer2, MoveRight, Palette, Pen, Play, Plus, Presentation, Redo2, Search, SendToBack, Shapes, Spline, StickyNote, Tag, Trash2,
  Type, Underline, Undo2, Ungroup, Video, X, Slash, CornerDownRight, ArrowUp, ArrowDown, Sparkles,
} from 'lucide-react'
import AccountMenu from '../../components/common/AccountMenu'
import ShareDialog, { useShareIcon } from '../../components/common/ShareDialog'
import NoAccess from '../../components/common/NoAccess'
import { alertDialog, confirmDialog, promptDialog } from '../../components/common/AppDialog'
import { useToast } from '../../components/common/Toast'
import { api } from '../../hooks/useApi'
import { BoardsIcon as BoardIcon } from '../workspace/icons'
import BoardItem, { STICKY_DEFAULT, fileHref, shapeSvg } from './BoardItem'
import FilePicker from './FilePicker'
import { ACCENT, COLORS, COLOR_ORDER, LINE_DEFAULT } from './palette'
import { createHistory, record, redo as histRedo, undo as histUndo } from './history'
import {
  MAX_ZOOM, MIN_ZOOM, alignItems, boundsOf, clamp, connectionShape, draftPath, findFreePosition, fitViewport, normRect, rectInside, rectsOverlap,
  smartSnap, strokeFromPoints, strokeHit, strokePath, toWorld, zoomAt,
} from './geometry'
import { MAX_CANVASES, MAX_ITEMS, hostnameOf, normalizeBoard, normalizeDoc, parseVideo, plainText, sanitizeImageSrc, sanitizeUrl } from './sanitize'
import { buildTemplate } from './templates'
import { guessKind, unfurl } from './connect'
import { ExportError, boardToSlides, download, exportHwpx, exportPdf, exportPng, framesOf, regionsOf, safeName } from './exporters'
import { CanvasTabs, CommentsPanel, MenuItem, MenuSep, ShortcutHelp, TemplatePicker, useDismiss } from './panels'
import { createBoardTools } from './aiBoardTools'
import { BOARD_QUICK_ACTIONS, buildBoardContext, buildBoardSystemPrompt } from './aiBoardPrompts'
import { getKnowledge } from '../../components/ai/knowledge'
import './board.css'

import { useMcpRelay } from '../../components/ai/mcpRelay'
// AI 창(공용 AiPanel). 파일이 없으면 빈 객체라 빌드가 깨지지 않고 AI 단추도 숨긴다.
const AI_PANEL = import.meta.glob('../../components/ai/AiPanel.jsx')
const AI_LOADER = Object.values(AI_PANEL)[0]
const AiPanel = AI_LOADER ? lazy(() => AI_LOADER().then((m) => ({ default: m.default || m.AiPanel }))) : null
const AI_OPEN_KEY = 'dah-ai-open:board'
const SAVE_DELAY = 800
const MAX_BYTES = 4 * 1024 * 1024
const GRID = 24
const CLIP_MARK = 'dah-board-clip:'
const SIZE = {
  memo: [240, 160], keyword: [140, 44], link: [300, 128], image: [320, 220], video: [400, 262], file: [300, 92],
  sticky: [200, 200], shape: [200, 140], text: [260, 30], frame: [800, 560],
}
const MIN = {
  memo: [120, 60], keyword: [60, 32], link: [180, 84], image: [40, 30], video: [220, 150], file: [200, 64],
  sticky: [80, 80], shape: [24, 24], text: [40, 24], frame: [160, 120], stroke: [1, 1],
}
const STICKY_SIZES = [['S', 140], ['M', 200], ['L', 280]]
const SHAPE_LIST = [['rect', '사각형'], ['rounded', '둥근 사각형'], ['ellipse', '타원'], ['diamond', '마름모'], ['triangle', '삼각형'], ['arrow', '화살표']]
const CREATE_TOOLS = new Set(['sticky', 'shape', 'text', 'frame'])
const TEXT_TYPES = new Set(['memo', 'keyword', 'sticky', 'shape', 'text', 'frame'])
const newId = (p = 'i') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** 찾기에 쓰는 항목 글자 */
function itemText(it) {
  const d = it.data || {}
  if (it.type === 'memo') return plainText(d.html)
  if (it.type === 'keyword' || it.type === 'sticky' || it.type === 'shape' || it.type === 'text') return d.text || ''
  if (it.type === 'link') return `${d.title || ''} ${d.description || ''} ${d.url || ''}`
  if (it.type === 'video') return `${d.title || ''} ${d.url || ''}`
  if (it.type === 'image') return d.alt || ''
  if (it.type === 'file') return d.title || ''
  if (it.type === 'frame') return d.name || ''
  return ''
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const textToHtml = (t) =>
  String(t)
    .split(/\r?\n/)
    .map((l) => `<p>${l ? escapeHtml(l) : '<br>'}</p>`)
    .join('')

/** 피그마 공식 임베드 주소(미리보기 서버가 없을 때) */
const figmaEmbed = (url) => `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`

function imageSize(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 320, h: img.naturalHeight || 220 })
    img.onerror = () => resolve({ w: 320, h: 220 })
    img.src = src
  })
}

const effColor = (it) => (it.type === 'sticky' ? it.color || STICKY_DEFAULT : it.color)

function TB({ label, onClick, disabled, pressed, children, keep, className = '' }) {
  return (
    <button
      type="button"
      className={`bd-tb ${className}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={pressed === undefined ? undefined : pressed}
      onMouseDown={keep ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
const Sep = () => <span className="bd-sep" aria-hidden="true" />

function Swatches({ value, onPick, allowNone = true }) {
  return (
    <div className="bd-swatches" role="menu" aria-label="색">
      {allowNone && <button type="button" className={`bd-swatch bd-swatch--none ${!value ? 'is-on' : ''}`} onClick={() => onPick(null)} title="색 없음" aria-label="색 없음" />}
      {COLOR_ORDER.map((cid) => (
        <button key={cid} type="button" className={`bd-swatch ${value === cid ? 'is-on' : ''}`} style={{ background: COLORS[cid].fill }} onClick={() => onPick(cid)} title={COLORS[cid].name} aria-label={COLORS[cid].name} />
      ))}
    </div>
  )
}

function ShapeIcon({ shape, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="-1 -1 22 22" aria-hidden="true">
      <g transform={shape === 'arrow' ? 'translate(0 4)' : undefined}>{shapeSvg(shape, 20, shape === 'arrow' ? 12 : 20, 'currentColor')}</g>
    </svg>
  )
}

function Minimap({ items, vp, size, onJump }) {
  const W = 180
  const H = 120
  const ib = useMemo(() => boundsOf(items), [items])
  const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: size.w / vp.zoom, h: size.h / vp.zoom }
  const b = ib ? boundsOf([ib, view]) : view
  const pad = 40
  // 화면이 항목 범위 안에 있으면 축척이 그대로라 항목 그림(아래 memo)을 다시 그리지 않는다
  const s = Math.min(W / (b.w + pad * 2), H / (b.h + pad * 2))
  const ox = (W - (b.w + pad * 2) * s) / 2 - (b.x - pad) * s
  const oy = (H - (b.h + pad * 2) * s) / 2 - (b.y - pad) * s
  const rects = useMemo(
    () => items.map((it) => <rect key={it.id} x={ox + it.x * s} y={oy + it.y * s} width={Math.max(2, it.w * s)} height={Math.max(2, it.h * s)} rx="1" fill={it.type === 'frame' ? '#e2e2e2' : effColor(it) ? COLORS[effColor(it)].fill : '#9e9e9e'} />),
    [items, ox, oy, s]
  )
  const jump = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    onJump((e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s)
  }
  return (
    <svg
      className="bd-minimap"
      width={W}
      height={H}
      role="img"
      aria-label="미니맵"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        jump(e)
      }}
      onPointerMove={(e) => e.buttons && jump(e)}
    >
      {rects}
      <rect x={ox + view.x * s} y={oy + view.y * s} width={view.w * s} height={view.h * s} fill="none" stroke={ACCENT} strokeWidth="1.5" rx="2" />
    </svg>
  )
}

/** 연결선 층. 화면을 옮겨도(같은 컬링 칸 안이면) 다시 그리지 않는다 */
const ConnLayer = memo(function ConnLayer({ conns, selConn, filter, itemsById }) {
  return (
    <>
      <svg className="bd-links" aria-hidden="true">
        {conns.map(({ c, d, heads }) => {
          const color = c.id === selConn ? ACCENT : c.color ? COLORS[c.color].fill : LINE_DEFAULT
          const dim = filter && !(c.color === filter || effColor(itemsById.get(c.from)) === filter || effColor(itemsById.get(c.to)) === filter)
          return (
            <g key={c.id} data-conn-id={c.id} className={`bd-link-g ${dim ? 'is-dimmed' : ''}`}>
              <path d={d} className="bd-link-hit" />
              <path d={d} className="bd-link-line" stroke={color} strokeWidth={c.id === selConn ? 3 : 2} strokeLinejoin="round" />
              {heads.map((pt, i) => (
                <polygon key={i} points={pt} fill={color} />
              ))}
            </g>
          )
        })}
      </svg>
      {conns.map(({ c, mid }) =>
        c.label ? (
          <div key={`l-${c.id}`} data-conn-id={c.id} className={`bd-link-label ${c.id === selConn ? 'is-selected' : ''}`} style={{ transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)` }}>
            {c.label}
          </div>
        ) : null
      )}
    </>
  )
})

/** 항목 층. 화면 이동만 할 때는 다시 그리지 않는다(항목 1000개 이상에서 부드럽게) */
const ItemsLayer = memo(function ItemsLayer({ items, sel, editing, matchSet, curMatch, filter, readOnly, showHandles, commentCount, onCommit, onEndEdit, onComments }) {
  return items.map((it) => (
    <BoardItem
      key={it.id}
      item={it}
      selected={sel.has(it.id)}
      editing={editing === it.id}
      hit={matchSet.has(it.id)}
      hitCurrent={curMatch === it.id}
      dimmed={Boolean(filter && effColor(it) !== filter && it.type !== 'frame')}
      readOnly={readOnly}
      showHandles={showHandles}
      comments={commentCount ? commentCount.get(it.id) || 0 : 0}
      onCommit={onCommit}
      onEndEdit={onEndEdit}
      onComments={onComments}
    />
  ))
})

export default function BoardEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [denied, setDenied] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const canEditRef = useRef(false)
  const [doc, setDocState] = useState(null)
  const docRef = useRef(null)
  const boardRef = useRef(null) // 지금 보고 있는 캔버스
  const [vp, setVpState] = useState({ x: 0, y: 0, zoom: 1 })
  const vpRef = useRef(vp)
  const [stageSize, setStageSize] = useState({ w: 1000, h: 700 })
  const [sel, setSelState] = useState(() => new Set())
  const selRef = useRef(sel)
  const [selConn, setSelConnState] = useState(null)
  const selConnRef = useRef(null)
  const [editing, setEditingState] = useState(null)
  const editingRef = useRef(null)
  const [marquee, setMarquee] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saveState, setSaveState] = useState('saved')
  const [, setHistTick] = useState(0)
  const [search, setSearch] = useState(null)
  const [filter, setFilter] = useState(null)
  const [popover, setPopover] = useState(null)
  const [picker, setPicker] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [aiOpen, setAiOpenState] = useState(() => {
    try {
      return localStorage.getItem(AI_OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const [shareTick, setShareTick] = useState(0)
  const [space, setSpace] = useState(false)
  const spaceRef = useRef(false)
  const [panning, setPanning] = useState(false)
  const [showMap, setShowMap] = useState(true)
  const [tool, setToolState] = useState('select')
  const toolRef = useRef('select')
  const [opt, setOpt] = useState({ sticky: 'yellow', shape: 'rect', pen: 'black', highlighter: 'yellow', penWidth: 3 })
  const optRef = useRef(opt)
  optRef.current = opt
  const [live, setLive] = useState(null)
  const [createRect, setCreateRect] = useState(null)
  const [guides, setGuides] = useState([])
  const [snapGrid, setSnapGrid] = useState(false)
  const snapGridRef = useRef(false)
  snapGridRef.current = snapGrid
  const [moving, setMoving] = useState(false)
  const [ctx, setCtx] = useState(null)
  const [help, setHelp] = useState(false)
  const [tplMode, setTplMode] = useState(null) // 'new' | 'insert'
  const [comments, setComments] = useState(null) // null | { focus }
  const [me, setMe] = useState(null)
  const [present, setPresentState] = useState(null) // 발표 중인 프레임 번호
  const presentRef = useRef(null)
  const presentVp = useRef(null)
  const [exportAll, setExportAll] = useState(false)
  const [busy, setBusy] = useState('')
  const connStyle = useRef('curve')
  const ShareIcon = useShareIcon(Number(id), shareTick)
  const hist = useRef(createHistory())
  const root = useRef(null)
  const stage = useRef(null)
  const gesture = useRef(null)
  const needsFit = useRef(false)
  const saveTimer = useRef(null)
  const saving = useRef(false)
  const pendingSave = useRef(false)
  const imageInput = useRef(null)
  const importInput = useRef(null)
  const searchInput = useRef(null)
  const ctxRef = useRef(null)
  const popRef = useRef(null)

  const setVp = useCallback((next) => {
    vpRef.current = next
    setVpState(next)
  }, [])
  const setSel = useCallback((next) => {
    selRef.current = next
    setSelState(next)
  }, [])
  const setSelConn = useCallback((next) => {
    selConnRef.current = next
    setSelConnState(next)
  }, [])
  const setEditing = useCallback((next) => {
    editingRef.current = next
    setEditingState(next)
  }, [])
  const setTool = useCallback((t) => {
    toolRef.current = t
    setToolState(t)
  }, [])
  const setPresent = useCallback((p) => {
    presentRef.current = p
    setPresentState(p)
  }, [])
  const setDoc = useCallback((d) => {
    docRef.current = d
    boardRef.current = d.canvases.find((c) => c.id === d.active) || d.canvases[0]
    setDocState(d)
  }, [])
  const closePop = useCallback(() => setPopover(null), [])
  useDismiss(Boolean(popover), closePop, popRef)
  const closeCtx = useCallback(() => setCtx(null), [])
  useDismiss(Boolean(ctx), closeCtx, ctxRef)

  // ── 불러오기 ─────────────────────────────────────────
  useEffect(() => {
    let live = true
    api
      .get(`/workspace/boards/${id}`)
      .then((r) => {
        if (!live) return
        const d = normalizeDoc(r.item.content)
        setDoc(d)
        setFile(r.item)
        canEditRef.current = r.canEdit === true
        setCanEdit(r.canEdit === true)
        const cur = d.canvases.find((c) => c.id === d.active)
        if (cur.viewport) setVp(cur.viewport)
        else needsFit.current = true
        document.title = `${r.item.title} | 디인예 워크스페이스`
      })
      .catch((e) => {
        if (!live) return
        if (e.status === 401 || e.status === 403) setDenied('denied')
        else if (e.status === 404) setDenied('missing')
        else setLoadError(e.message)
      })
    api
      .get('/workspace/me')
      .then((r) => live && setMe(r.user || null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [id, setVp, setDoc])

  const fitItems = (items, w, h) => (items.length ? fitViewport(items, w, h) : { x: w / 2 - 120, y: h / 2 - 80, zoom: 1 })

  // 캔버스 크기 추적, 처음 열 때 저장된 화면 위치가 없으면 모든 항목이 보이게 맞춘다
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      setStageSize({ w: r.width, h: r.height })
      if (needsFit.current && boardRef.current) {
        needsFit.current = false
        setVp(fitItems(boardRef.current.items, r.width, r.height))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc !== null, setVp]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 저장 ─────────────────────────────────────────────
  const contentOf = () => {
    const d = docRef.current
    const v = vpRef.current
    const view = presentRef.current === null ? { x: Math.round(v.x), y: Math.round(v.y), zoom: Math.round(v.zoom * 1000) / 1000 } : null
    return { version: 2, active: d.active, canvases: d.canvases.map((c) => (c.id === d.active && view ? { ...c, viewport: view } : c)) }
  }
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (!canEditRef.current || !docRef.current) return
    if (saving.current) {
      pendingSave.current = true
      return
    }
    const content = contentOf()
    const text = JSON.stringify(content)
    if (new Blob([text]).size > MAX_BYTES) {
      setSaveState('error')
      toast('보드가 4MB를 넘어 저장하지 못했습니다. 큰 펜 그림이나 캔버스를 줄여 주세요')
      return
    }
    saving.current = true
    setSaveState('saving')
    try {
      await api.put(`/workspace/boards/${id}`, { content })
      setSaveState(pendingSave.current || saveTimer.current ? 'dirty' : 'saved')
    } catch (e) {
      setSaveState('error')
      toast(e.status === 413 ? '보드가 너무 커서 저장하지 못했습니다' : `저장하지 못했습니다: ${e.message}`)
    } finally {
      saving.current = false
      if (pendingSave.current) {
        pendingSave.current = false
        flush()
      }
    }
  }, [id, toast]) // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback(() => {
    if (!canEditRef.current) return
    setSaveState('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flush(), SAVE_DELAY)
  }, [flush])

  useEffect(() => {
    const h = () => {
      if (saveTimer.current) flush()
    }
    window.addEventListener('beforeunload', h)
    return () => {
      window.removeEventListener('beforeunload', h)
      h()
    }
  }, [flush])

  // ── 상태 바꾸기 + 실행취소 ─────────────────────────────
  const commitDoc = useCallback(
    (next, { record: rec = true } = {}) => {
      if (!canEditRef.current) return
      if (rec) {
        record(hist.current, docRef.current)
        setHistTick((t) => t + 1)
      }
      setDoc(next)
      scheduleSave()
    },
    [scheduleSave, setDoc]
  )
  /** 지금 캔버스를 바꾼다. 넘긴 조각은 캔버스에 합친다(이름·댓글 등은 그대로) */
  const commit = useCallback(
    (part, opts) => {
      const d = docRef.current
      const cur = boardRef.current
      const next = { ...cur, ...part, id: cur.id }
      commitDoc({ ...d, canvases: d.canvases.map((c) => (c.id === cur.id ? next : c)) }, opts)
    },
    [commitDoc]
  )
  const update = useCallback((fn, opts) => commit(fn(boardRef.current), opts), [commit])

  const pruneSelection = useCallback(() => {
    const cv = boardRef.current
    const ids = new Set(cv.items.map((i) => i.id))
    setSel(new Set([...selRef.current].filter((x) => ids.has(x))))
    if (selConnRef.current && !cv.connections.some((c) => c.id === selConnRef.current)) setSelConn(null)
  }, [setSel, setSelConn])

  const restore = useCallback(
    (snap) => {
      const before = docRef.current.active
      setDoc(snap)
      if (snap.active !== before) {
        const r = stage.current.getBoundingClientRect()
        const cv = boardRef.current
        setVp(cv.viewport || fitItems(cv.items, r.width, r.height))
      }
      pruneSelection()
      setHistTick((t) => t + 1)
      scheduleSave()
    },
    [scheduleSave, setDoc, setVp, pruneSelection]
  )
  const undo = useCallback(() => {
    if (!canEditRef.current) return
    const s = histUndo(hist.current, docRef.current)
    if (s) restore(s)
  }, [restore])
  const redo = useCallback(() => {
    if (!canEditRef.current) return
    const s = histRedo(hist.current, docRef.current)
    if (s) restore(s)
  }, [restore])

  // ── AI 창 ────────────────────────────────────────────
  // 도구는 한 번 만들고, 최신 함수는 aiLatest 로 부른다. 바꾸기는 commit 한 번(실행취소 한 단계)이다.
  const aiLatest = useRef({})
  aiLatest.current = { commit, undo, redo, toast, setSel, setSelConn, setEditing, setVp }
  const setAiOpen = useCallback((v) => {
    setAiOpenState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      try {
        localStorage.setItem(AI_OPEN_KEY, next ? '1' : '0')
      } catch {
        /* 저장소를 못 쓰는 환경 */
      }
      return next
    })
  }, [])
  const aiTools = useMemo(
    () =>
      createBoardTools({
        getCanvas: () => boardRef.current,
        getView: () => {
          const v = vpRef.current
          const r = stage.current ? stage.current.getBoundingClientRect() : { width: 1000, height: 700 }
          return { x: -v.x / v.zoom, y: -v.y / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom }
        },
        getSel: () => [...selRef.current],
        canEdit: () => canEditRef.current,
        totalItems: () => docRef.current.canvases.reduce((n, c) => n + c.items.length, 0),
        apply: ({ items, connections, comments, focus = [], fit = false }) => {
          const L = aiLatest.current
          L.setEditing(null)
          const before = docRef.current
          L.commit({ ...(items && { items }), ...(connections && { connections }), ...(comments && { comments }) })
          const after = docRef.current
          if (after === before) return null
          L.setSel(new Set(focus.filter((x) => boardRef.current.items.some((i) => i.id === x))))
          L.setSelConn(null)
          const made = boardRef.current.items.filter((i) => focus.includes(i.id))
          if (made.length && stage.current) {
            const r = stage.current.getBoundingClientRect()
            const v = vpRef.current
            const b = boundsOf(made)
            const inside = b.x * v.zoom + v.x >= 0 && b.y * v.zoom + v.y >= 0 && (b.x + b.w) * v.zoom + v.x <= r.width && (b.y + b.h) * v.zoom + v.y <= r.height
            if (fit || !inside) {
              const nv = fitViewport(made, r.width, r.height)
              if (nv.zoom > 1) L.setVp({ x: r.width / 2 - (b.x + b.w / 2), y: r.height / 2 - (b.y + b.h / 2), zoom: 1 })
              else L.setVp(nv)
            }
          }
          return { before, after }
        },
        revert: ({ after }) => {
          const L = aiLatest.current
          if (docRef.current === after && hist.current.undo.length) L.undo()
          else L.toast(`그 뒤에 고친 내용이 있어 ${MOD}Z 로 한 단계씩 되돌려 주세요`)
        },
      }),
    []
  )
  const mcpRelay = useMcpRelay({ fileId: file?.id, kind: 'board', tools: aiTools, canEdit })
  const aiContext = useCallback(() => {
    const v = vpRef.current
    const r = stage.current ? stage.current.getBoundingClientRect() : { width: 1000, height: 700 }
    return buildBoardContext({
      canvas: boardRef.current,
      canvasCount: docRef.current?.canvases.length || 1,
      sel: [...selRef.current],
      view: { x: -v.x / v.zoom, y: -v.y / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom },
      canEdit: canEditRef.current,
    })
  }, [])
  useEffect(() => {
    if (!AiPanel) return undefined
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setAiOpen((v) => !v)
        return
      }
      // 보내기 뒤에는 초점이 AI 입력칸에 있다. 입력칸이 비어 있으면 실행취소·다시 실행은 보드에 적용한다
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z') && e.target?.closest?.('.bd-ai') && (!('value' in e.target) || e.target.value === '')) {
        e.preventDefault()
        if (e.shiftKey) aiLatest.current.redo()
        else aiLatest.current.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setAiOpen])

  const totalItems = () => docRef.current.canvases.reduce((n, c) => n + c.items.length, 0)
  const tooMany = (add) => {
    if (totalItems() + add <= MAX_ITEMS) return false
    alertDialog({ message: `보드 하나(모든 캔버스 합계)에는 항목을 ${MAX_ITEMS}개까지 둘 수 있습니다` })
    return true
  }

  // ── 캔버스(페이지) ────────────────────────────────────
  const switchCanvas = useCallback(
    (cid) => {
      const d = docRef.current
      if (!d || cid === d.active) return
      document.activeElement?.blur?.()
      const v = vpRef.current
      const saved = { x: Math.round(v.x), y: Math.round(v.y), zoom: Math.round(v.zoom * 1000) / 1000 }
      const next = { ...d, active: cid, canvases: d.canvases.map((c) => (c.id === d.active ? { ...c, viewport: saved } : c)) }
      setDoc(next)
      setSel(new Set())
      setSelConn(null)
      setEditing(null)
      setSearch(null)
      const cv = boardRef.current
      const r = stage.current.getBoundingClientRect()
      setVp(cv.viewport || fitItems(cv.items, r.width, r.height))
      scheduleSave()
    },
    [setDoc, setSel, setSelConn, setEditing, setVp, scheduleSave]
  )

  const addCanvas = useCallback(
    (tplId) => {
      setTplMode(null)
      const d = docRef.current
      if (d.canvases.length >= MAX_CANVASES) return alertDialog({ message: `캔버스는 ${MAX_CANVASES}개까지 만들 수 있습니다` })
      const t = buildTemplate(tplId)
      if (tooMany(t.items.length)) return
      const cid = newId('cv')
      const used = new Set(d.canvases.map((c) => c.name))
      let name = t.name || `캔버스 ${d.canvases.length + 1}`
      for (let k = 2; used.has(name); k++) name = `${t.name || '캔버스'} ${k}`
      const r = stage.current.getBoundingClientRect()
      const cv = { id: cid, name, items: t.items, connections: t.connections, comments: [], viewport: fitItems(t.items, r.width, r.height) }
      commitDoc({ ...d, canvases: [...d.canvases, cv] })
      switchCanvas(cid)
    },
    [commitDoc, switchCanvas] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const renameCanvas = useCallback(
    async (cid) => {
      const c = docRef.current.canvases.find((x) => x.id === cid)
      if (!c) return
      const v = await promptDialog({ title: '캔버스 이름', label: '이름', defaultValue: c.name, confirmLabel: '저장' })
      if (v === null || !v.trim()) return
      const d = docRef.current
      commitDoc({ ...d, canvases: d.canvases.map((x) => (x.id === cid ? { ...x, name: v.trim().slice(0, 60) } : x)) })
    },
    [commitDoc]
  )
  const duplicateCanvas = useCallback(
    (cid) => {
      const d = docRef.current
      const c = d.canvases.find((x) => x.id === cid)
      if (!c || d.canvases.length >= MAX_CANVASES) return
      if (tooMany(c.items.length)) return
      const map = new Map()
      const gmap = new Map()
      const items = c.items.map((i) => {
        const nid = newId()
        map.set(i.id, nid)
        const out = { ...i, id: nid, data: { ...i.data } }
        if (i.group) {
          if (!gmap.has(i.group)) gmap.set(i.group, newId('g'))
          out.group = gmap.get(i.group)
        }
        return out
      })
      const connections = c.connections.map((x) => ({ ...x, id: newId('c'), from: map.get(x.from), to: map.get(x.to) }))
      const nc = { id: newId('cv'), name: `${c.name} 사본`.slice(0, 60), items, connections, comments: [], ...(c.viewport ? { viewport: c.viewport } : {}) }
      const idx = d.canvases.findIndex((x) => x.id === cid)
      const list = [...d.canvases]
      list.splice(idx + 1, 0, nc)
      commitDoc({ ...d, canvases: list })
      switchCanvas(nc.id)
    },
    [commitDoc, switchCanvas] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const moveCanvas = useCallback(
    (cid, delta) => {
      const d = docRef.current
      const i = d.canvases.findIndex((x) => x.id === cid)
      const j = i + delta
      if (i < 0 || j < 0 || j >= d.canvases.length) return
      const list = [...d.canvases]
      ;[list[i], list[j]] = [list[j], list[i]]
      commitDoc({ ...d, canvases: list })
    },
    [commitDoc]
  )
  const reorderCanvas = useCallback(
    (fromId, toId) => {
      const d = docRef.current
      const list = [...d.canvases]
      const i = list.findIndex((x) => x.id === fromId)
      const j = list.findIndex((x) => x.id === toId)
      if (i < 0 || j < 0) return
      const [m] = list.splice(i, 1)
      list.splice(j, 0, m)
      commitDoc({ ...d, canvases: list })
    },
    [commitDoc]
  )
  const deleteCanvas = useCallback(
    async (cid) => {
      const d = docRef.current
      if (d.canvases.length <= 1) return
      const c = d.canvases.find((x) => x.id === cid)
      const ok = await confirmDialog({ title: '캔버스 삭제', message: `"${c.name}" 캔버스와 항목 ${c.items.length}개를 지웁니다. 실행취소로 되돌릴 수 있습니다.`, confirmLabel: '삭제', tone: 'danger' })
      if (!ok) return
      const cur = docRef.current
      const idx = cur.canvases.findIndex((x) => x.id === cid)
      const list = cur.canvases.filter((x) => x.id !== cid)
      const nextActive = cur.active === cid ? list[Math.max(0, idx - 1)].id : cur.active
      commitDoc({ ...cur, canvases: list, active: nextActive })
      if (cur.active === cid) {
        const cv = boardRef.current
        const r = stage.current.getBoundingClientRect()
        setVp(cv.viewport || fitItems(cv.items, r.width, r.height))
        setSel(new Set())
        setSelConn(null)
      }
    },
    [commitDoc, setVp, setSel, setSelConn] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── 항목 만들기 ───────────────────────────────────────
  const maxZ = () => boardRef.current.items.reduce((m, i) => Math.max(m, i.z || 0), 0)
  const viewCenter = useCallback(() => {
    const el = stage.current
    const r = el ? el.getBoundingClientRect() : { width: 1000, height: 700 }
    return toWorld(vpRef.current, r.width / 2, r.height / 2)
  }, [])

  const addItems = useCallback(
    (list, { select = true, connections = [] } = {}) => {
      const cur = boardRef.current
      if (tooMany(list.length)) return []
      let z = maxZ()
      const made = list.map((it) => ({ color: null, ...it, z: ++z }))
      commit({ items: [...cur.items, ...made], connections: [...cur.connections, ...connections] })
      if (select) {
        setSel(new Set(made.map((m) => m.id)))
        setSelConn(null)
      }
      return made
    },
    [commit, setSel, setSelConn] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const addAt = useCallback(
    (type, data, at, size, extra) => {
      const [w, h] = size || SIZE[type]
      const c = at || viewCenter()
      const pos = findFreePosition(Math.round(c.x - w / 2), Math.round(c.y - h / 2), boardRef.current.items.filter((i) => i.type !== 'frame'), w, h)
      return addItems([{ id: newId(), type, x: pos.x, y: pos.y, w, h, data, ...(extra || {}) }])[0]
    },
    [addItems, viewCenter]
  )

  const addMemo = useCallback(
    (at, html = '') => {
      const it = addAt('memo', { html }, at)
      if (it && !html) setEditing(it.id)
    },
    [addAt, setEditing]
  )
  const addKeyword = useCallback(() => {
    const it = addAt('keyword', { text: '' })
    if (it) setEditing(it.id)
  }, [addAt, setEditing])

  /** 어느 캔버스에 있든 항목 하나를 조용히 고친다(실행취소에 남기지 않음). 링크 미리보기를 받아 왔을 때 쓴다 */
  const patchSilently = useCallback(
    (iid, data, box) => {
      const d = docRef.current
      if (!d || !canEditRef.current) return
      let hit = false
      const canvases = d.canvases.map((c) => {
        if (!c.items.some((i) => i.id === iid)) return c
        hit = true
        return { ...c, items: c.items.map((i) => (i.id === iid ? { ...i, ...(box || {}), data: { ...i.data, ...data } } : i)) }
      })
      if (hit) commitDoc({ ...d, canvases }, { record: false })
    },
    [commitDoc]
  )

  const enrichLink = useCallback(
    async (iid, url, keepTitle) => {
      const extra = await unfurl(url)
      // 피그마 파일 주소인데 미리보기 서버가 임베드 주소를 주지 않으면 피그마 공식 임베드 주소로 띄운다
      if (guessKind(url) === 'figma' && !extra.embedUrl) {
        extra.kind = 'figma'
        extra.embedUrl = figmaEmbed(url)
      }
      if (keepTitle) delete extra.title
      const it = docRef.current?.canvases.flatMap((c) => c.items).find((i) => i.id === iid)
      if (!it) return
      let box = null
      const isDefault = it.w === SIZE.link[0] && it.h === SIZE.link[1]
      if (isDefault && extra.embedUrl) box = { w: 480, h: 340 }
      else if (isDefault && extra.image) box = { w: 320, h: 260 }
      patchSilently(iid, extra, box)
    },
    [patchSilently]
  )

  const addLinkUrl = useCallback(
    (raw, at) => {
      const url = sanitizeUrl(raw)
      if (!url) return false
      const v = parseVideo(url)
      if (v) addAt('video', { url: v.url, provider: v.provider, vid: v.id, title: '' }, at)
      else {
        const it = addAt('link', { url, title: hostnameOf(url), kind: guessKind(url) }, at)
        if (it) enrichLink(it.id, url)
      }
      return true
    },
    [addAt, enrichLink]
  )

  const addLink = useCallback(async () => {
    const raw = await promptDialog({ title: '링크 넣기', label: '주소', placeholder: 'https://', confirmLabel: '넣기' })
    if (raw === null || !raw.trim()) return
    const url = sanitizeUrl(raw)
    if (!url) return alertDialog({ message: 'http 또는 https 주소만 넣을 수 있습니다' })
    addLinkUrl(url)
  }, [addLinkUrl])

  const addVideo = useCallback(async () => {
    const raw = await promptDialog({ title: '영상 넣기', label: '유튜브 또는 비메오 주소', placeholder: 'https://youtu.be/...', confirmLabel: '넣기' })
    if (raw === null || !raw.trim()) return
    const v = parseVideo(raw)
    if (!v) return alertDialog({ message: '유튜브나 비메오 영상 주소만 넣을 수 있습니다' })
    addAt('video', { url: v.url, provider: v.provider, vid: v.id, title: '' })
  }, [addAt])

  const addImages = useCallback(
    async (files, at) => {
      const imgs = [...files].filter((f) => f.type.startsWith('image/'))
      if (!imgs.length) return
      toast(imgs.length > 1 ? `이미지 ${imgs.length}개를 올리는 중` : '이미지를 올리는 중')
      let c = at || viewCenter()
      for (const f of imgs) {
        try {
          const r = await api.upload(f, { usage: 'general' })
          const src = sanitizeImageSrc(r?.url)
          if (!src) throw new Error('주소를 받지 못했습니다')
          const nat = await imageSize(src)
          const w = Math.min(360, nat.w)
          const h = Math.max(30, Math.round((w * nat.h) / Math.max(nat.w, 1)))
          addAt('image', { src, alt: f.name.replace(/\.[^.]+$/, '').slice(0, 300) }, c, [w, h])
          c = { x: c.x + 24, y: c.y + 24 }
        } catch (e) {
          await alertDialog({ title: '이미지를 올리지 못했습니다', message: e.message })
        }
      }
    },
    [addAt, toast, viewCenter]
  )

  const addFile = useCallback(
    (f) => {
      setPicker(false)
      const preview = f.kind === 'doc' || f.kind === 'sheet'
      addAt('file', { kind: f.kind, fileId: f.fileId, tabId: f.tabId || null, title: f.title }, undefined, preview ? [300, 200] : SIZE.file)
    },
    [addAt]
  )

  const insertTemplate = useCallback(
    (tplId) => {
      setTplMode(null)
      const t = buildTemplate(tplId)
      if (!t.items.length) return
      const b = boundsOf(t.items)
      const c = viewCenter()
      const pos = findFreePosition(Math.round(c.x - b.w / 2), Math.round(c.y - b.h / 2), boardRef.current.items, b.w, b.h)
      const dx = pos.x - b.x
      const dy = pos.y - b.y
      const maxOrder = framesOf(boardRef.current.items).reduce((m, f) => Math.max(m, f.data.order || 0), 0)
      const made = addItems(
        t.items.map((i) => ({ ...i, x: i.x + dx, y: i.y + dy, ...(i.type === 'frame' ? { data: { ...i.data, order: maxOrder + i.data.order } } : {}) })),
        { connections: t.connections }
      )
      if (made.length) {
        const r = stage.current.getBoundingClientRect()
        setVp(fitViewport(made, r.width, r.height))
      }
    },
    [addItems, viewCenter, setVp]
  )

  /** 만들기 도구로 누른 자리(또는 끈 상자)에 항목을 만든다 */
  const createWithTool = useCallback(
    (t, rect, at) => {
      const o = optRef.current
      let it = null
      if (t === 'sticky') {
        const s = SIZE.sticky[0]
        it = { type: 'sticky', x: Math.round(at.x - s / 2), y: Math.round(at.y - s / 2), w: s, h: s, color: o.sticky, data: { text: '' } }
      } else if (t === 'shape') {
        const [w, h] = rect ? [Math.max(24, rect.w), Math.max(24, rect.h)] : SIZE.shape
        const x = rect ? rect.x : at.x - w / 2
        const y = rect ? rect.y : at.y - h / 2
        it = { type: 'shape', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), color: 'purple', data: { shape: o.shape, text: '' } }
      } else if (t === 'text') {
        it = { type: 'text', x: Math.round(at.x), y: Math.round(at.y - 15), w: rect ? Math.max(80, Math.round(rect.w)) : SIZE.text[0], h: 30, data: { text: '', size: 20, bold: false } }
      } else if (t === 'frame') {
        const [w, h] = rect ? [Math.max(160, rect.w), Math.max(120, rect.h)] : SIZE.frame
        const x = rect ? rect.x : at.x - w / 2
        const y = rect ? rect.y : at.y - h / 2
        const frames = framesOf(boardRef.current.items)
        const order = frames.reduce((m, f) => Math.max(m, f.data.order || 0), 0) + 1
        it = { type: 'frame', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), data: { name: `프레임 ${frames.length + 1}`, order } }
      }
      if (!it) return
      if (snapGridRef.current) {
        it.x = Math.round(it.x / GRID) * GRID
        it.y = Math.round(it.y / GRID) * GRID
      }
      const made = addItems([{ id: newId(), ...it }])[0]
      setTool('select')
      if (made && t !== 'frame') setEditing(made.id)
    },
    [addItems, setEditing, setTool]
  )

  // ── 선택한 것 다루기 ──────────────────────────────────
  /** 묶음까지 넓힌 선택 */
  const unitOf = useCallback((iid) => {
    const items = boardRef.current.items
    const it = items.find((i) => i.id === iid)
    if (!it?.group) return [iid]
    return items.filter((i) => i.group === it.group).map((i) => i.id)
  }, [])

  const deleteSelection = useCallback(() => {
    const ids = new Set([...selRef.current].filter((x) => !boardRef.current.items.find((i) => i.id === x)?.locked))
    if (selRef.current.size) {
      if (!ids.size) return toast('잠긴 항목은 지울 수 없습니다')
      update((b) => ({
        items: b.items.filter((i) => !ids.has(i.id)),
        connections: b.connections.filter((c) => !ids.has(c.from) && !ids.has(c.to)),
        comments: b.comments.filter((m) => !ids.has(m.itemId)),
      }))
      if (ids.size < selRef.current.size) toast('잠긴 항목은 남겨 두었습니다')
      setSel(new Set())
      return
    }
    const cid = selConnRef.current
    if (cid) {
      update((b) => ({ connections: b.connections.filter((c) => c.id !== cid) }))
      setSelConn(null)
    }
  }, [update, setSel, setSelConn, toast])

  /** 항목 여러 개를 새 id로 복제(사이의 연결, 묶음도 함께). 반환: {items, connections, map} */
  const cloneItems = (ids, offset, src = boardRef.current) => {
    const map = new Map()
    const gmap = new Map()
    let z = maxZ()
    const items = src.items
      .filter((i) => ids.has(i.id))
      .map((i) => {
        const nid = newId()
        map.set(i.id, nid)
        const out = { ...i, id: nid, x: i.x + offset, y: i.y + offset, z: ++z, data: { ...i.data } }
        delete out.locked
        if (i.group) {
          if (!gmap.has(i.group)) gmap.set(i.group, newId('g'))
          out.group = gmap.get(i.group)
        }
        return out
      })
    const connections = src.connections.filter((c) => map.has(c.from) && map.has(c.to)).map((c) => ({ ...c, id: newId('c'), from: map.get(c.from), to: map.get(c.to) }))
    return { items, connections, map }
  }

  const duplicateSelection = useCallback(() => {
    const ids = selRef.current
    if (!ids.size || tooMany(ids.size)) return
    const cl = cloneItems(ids, 24)
    update((b) => ({ items: [...b.items, ...cl.items], connections: [...b.connections, ...cl.connections] }))
    setSel(new Set(cl.items.map((i) => i.id)))
  }, [update, setSel]) // eslint-disable-line react-hooks/exhaustive-deps

  const patchSelected = useCallback(
    (fn) => {
      const ids = selRef.current
      if (!ids.size) return
      update((b) => ({ items: b.items.map((i) => (ids.has(i.id) ? fn(i) || i : i)) }))
    },
    [update]
  )

  const setColor = useCallback(
    (color) => {
      setPopover(null)
      const cid = selConnRef.current
      if (selRef.current.size) patchSelected((i) => ({ ...i, color: i.type === 'sticky' && !color ? STICKY_DEFAULT : color }))
      else if (cid) update((b) => ({ connections: b.connections.map((c) => (c.id === cid ? { ...c, color } : c)) }))
    },
    [update, patchSelected]
  )

  const reorder = useCallback(
    (mode) => {
      const ids = selRef.current
      if (!ids.size) return
      const list = [...boardRef.current.items].sort((a, b) => (a.z || 0) - (b.z || 0))
      let arr = list
      if (mode === 'front') arr = [...list.filter((i) => !ids.has(i.id)), ...list.filter((i) => ids.has(i.id))]
      else if (mode === 'back') arr = [...list.filter((i) => ids.has(i.id)), ...list.filter((i) => !ids.has(i.id))]
      else if (mode === 'forward') {
        arr = [...list]
        for (let i = arr.length - 2; i >= 0; i--) if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
      } else if (mode === 'backward') {
        arr = [...list]
        for (let i = 1; i < arr.length; i++) if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
      }
      const zmap = new Map(arr.map((it, k) => [it.id, k + 1]))
      setPopover(null)
      update((b) => ({ items: b.items.map((i) => (i.z === zmap.get(i.id) ? i : { ...i, z: zmap.get(i.id) })) }))
    },
    [update]
  )

  const groupSelection = useCallback(() => {
    if (selRef.current.size < 2) return
    const g = newId('g')
    patchSelected((i) => ({ ...i, group: g }))
  }, [patchSelected])
  const ungroupSelection = useCallback(() => {
    patchSelected((i) => {
      if (!i.group) return null
      const n = { ...i }
      delete n.group
      return n
    })
  }, [patchSelected])
  const toggleLock = useCallback(() => {
    const items = boardRef.current.items.filter((i) => selRef.current.has(i.id))
    if (!items.length) return
    const lock = !items.every((i) => i.locked)
    patchSelected((i) => {
      const n = { ...i }
      if (lock) n.locked = true
      else delete n.locked
      return n
    })
    toast(lock ? '잠갔습니다. 옮기거나 지울 수 없습니다' : '잠금을 풀었습니다')
  }, [patchSelected, toast])

  const align = useCallback(
    (kind) => {
      setPopover(null)
      const items = boardRef.current.items.filter((i) => selRef.current.has(i.id) && !i.locked)
      const pos = alignItems(items, kind)
      if (!pos.size) return
      update((b) => ({ items: b.items.map((i) => (pos.has(i.id) ? { ...i, ...pos.get(i.id) } : i)) }))
    },
    [update]
  )

  const patchData = useCallback(
    (iid, data, box) => update((b) => ({ items: b.items.map((i) => (i.id === iid ? { ...i, ...(box || {}), data: { ...i.data, ...data } } : i)) })),
    [update]
  )
  const endEdit = useCallback(() => setEditing(null), [setEditing])

  const setConn = useCallback(
    (patch) => {
      const cid = selConnRef.current
      if (patch.style) connStyle.current = patch.style
      if (cid) update((b) => ({ connections: b.connections.map((c) => (c.id === cid ? { ...c, ...patch } : c)) }))
    },
    [update]
  )
  const editLabel = useCallback(
    async (cid) => {
      const c = boardRef.current.connections.find((x) => x.id === cid)
      if (!c || !canEditRef.current) return
      const v = await promptDialog({ title: '연결선 이름', label: '이름', defaultValue: c.label || '', placeholder: '비우면 이름 없음', confirmLabel: '저장' })
      if (v === null) return
      update((b) => ({ connections: b.connections.map((x) => (x.id === cid ? { ...x, label: v.trim().slice(0, 200) } : x)) }))
    },
    [update]
  )

  const editItem = useCallback(
    async (it) => {
      if (it.type === 'file') {
        const href = fileHref(it.data)
        if (href) window.open(href, '_blank', 'noopener')
        return
      }
      if (!canEditRef.current || it.locked) return
      if (TEXT_TYPES.has(it.type)) return setEditing(it.id)
      if (it.type === 'link') {
        const url = await promptDialog({ title: '링크 고치기', label: '주소', defaultValue: it.data.url, confirmLabel: '다음' })
        if (url === null) return
        const clean = sanitizeUrl(url)
        if (!clean) return alertDialog({ message: 'http 또는 https 주소만 넣을 수 있습니다' })
        const title = await promptDialog({ title: '링크 고치기', label: '제목', defaultValue: it.data.title || hostnameOf(clean), confirmLabel: '저장' })
        if (title === null) return
        const changed = clean !== it.data.url
        patchData(it.id, changed ? { url: clean, title: title.trim().slice(0, 300) || hostnameOf(clean), description: '', image: '', embedUrl: '', kind: guessKind(clean) } : { title: title.trim().slice(0, 300) || hostnameOf(clean) })
        if (changed) enrichLink(it.id, clean, true)
      }
      if (it.type === 'video') {
        const url = await promptDialog({ title: '영상 주소 바꾸기', label: '유튜브 또는 비메오 주소', defaultValue: it.data.url, confirmLabel: '저장' })
        if (url === null) return
        const v = parseVideo(url)
        if (!v) return alertDialog({ message: '유튜브나 비메오 영상 주소만 넣을 수 있습니다' })
        patchData(it.id, { url: v.url, provider: v.provider, vid: v.id })
      }
      if (it.type === 'image') {
        const alt = await promptDialog({ title: '이미지 설명', label: '설명(찾기에 쓰입니다)', defaultValue: it.data.alt || '', confirmLabel: '저장' })
        if (alt !== null) patchData(it.id, { alt: alt.trim().slice(0, 300) })
      }
    },
    [patchData, setEditing, enrichLink]
  )

  // ── 댓글 ─────────────────────────────────────────────
  const addComment = useCallback(
    (itemId, text) => {
      const author = me?.name || me?.email || '이름 없음'
      update((b) => ({ comments: [...b.comments, { id: newId('m'), itemId, author, text: text.slice(0, 2000), at: new Date().toISOString(), resolved: false }] }))
    },
    [update, me]
  )
  const resolveComment = useCallback((mid, resolved) => update((b) => ({ comments: b.comments.map((m) => (m.id === mid ? { ...m, resolved } : m)) })), [update])
  const deleteComment = useCallback(
    async (mid) => {
      const ok = await confirmDialog({ message: '이 댓글을 지울까요?', confirmLabel: '삭제', tone: 'danger' })
      if (ok) update((b) => ({ comments: b.comments.filter((m) => m.id !== mid) }))
    },
    [update]
  )
  const openComments = useCallback((iid) => setComments({ focus: iid || null }), [])

  // ── 화면 이동·확대 ────────────────────────────────────
  const zoomBy = useCallback(
    (factor) => {
      const r = stage.current.getBoundingClientRect()
      setVp(zoomAt(vpRef.current, vpRef.current.zoom * factor, r.width / 2, r.height / 2))
    },
    [setVp]
  )
  const zoomTo = useCallback(
    (z) => {
      const r = stage.current.getBoundingClientRect()
      setVp(zoomAt(vpRef.current, z, r.width / 2, r.height / 2))
    },
    [setVp]
  )
  const fit = useCallback(() => {
    const r = stage.current.getBoundingClientRect()
    const items = selRef.current.size ? boardRef.current.items.filter((i) => selRef.current.has(i.id)) : boardRef.current.items
    setVp(items.length ? fitViewport(items, r.width, r.height) : { x: r.width / 2, y: r.height / 2, zoom: 1 })
  }, [setVp])
  const centerOn = useCallback(
    (wx, wy) => {
      const r = stage.current.getBoundingClientRect()
      const z = vpRef.current.zoom
      setVp({ x: r.width / 2 - wx * z, y: r.height / 2 - wy * z, zoom: z })
    },
    [setVp]
  )
  const jumpToItem = useCallback(
    (iid) => {
      const it = boardRef.current.items.find((i) => i.id === iid)
      if (!it) return
      setSel(new Set([iid]))
      setSelConn(null)
      centerOn(it.x + it.w / 2, it.y + it.h / 2)
    },
    [centerOn, setSel, setSelConn]
  )

  // 휠: 손가락 두 개로 밀면 이동, ctrl/⌘ + 휠이나 핀치는 확대
  useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const onWheel = (e) => {
      if (presentRef.current !== null) {
        e.preventDefault()
        return
      }
      const body = e.target.closest?.('.bd-memo__body--edit, .bd-memo__body, .bd-textedit, .bd-side')
      if (body && body.scrollHeight > body.clientHeight && !e.ctrlKey && !e.metaKey && (body.closest('.is-editing') || body.closest('.bd-side'))) return
      if (e.target.closest?.('.bd-floating')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const v = vpRef.current
      if (e.ctrlKey || e.metaKey) {
        const dy = clamp(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, -30, 30)
        setVp(zoomAt(v, v.zoom * Math.exp(-dy * 0.01), e.clientX - r.left, e.clientY - r.top))
      } else {
        let dx = e.deltaX
        let dy = e.deltaY
        if (e.deltaMode === 1) {
          dx *= 16
          dy *= 16
        }
        if (e.shiftKey && !dx) {
          dx = dy
          dy = 0
        }
        setVp({ ...v, x: v.x - dx, y: v.y - dy })
      }
    }
    let startZoom = 1
    const onGS = (e) => {
      e.preventDefault()
      startZoom = vpRef.current.zoom
    }
    const onGC = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setVp(zoomAt(vpRef.current, startZoom * e.scale, e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGS)
    el.addEventListener('gesturechange', onGC)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGS)
      el.removeEventListener('gesturechange', onGC)
    }
  }, [doc !== null, setVp]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 끌기(이동·크기·연결·영역 선택·화면 이동·그리기) ─────────
  const worldOf = (e) => {
    const r = stage.current.getBoundingClientRect()
    return toWorld(vpRef.current, e.clientX - r.left, e.clientY - r.top)
  }
  const viewRect = (margin = 0) => {
    const v = vpRef.current
    const r = stage.current.getBoundingClientRect()
    const m = margin / v.zoom
    return { x: -v.x / v.zoom - m, y: -v.y / v.zoom - m, w: r.width / v.zoom + m * 2, h: r.height / v.zoom + m * 2 }
  }

  const grab = (e) => {
    try {
      stage.current?.setPointerCapture(e.pointerId)
    } catch {
      /* 이미 놓은 포인터 */
    }
    stage.current?.classList.add('is-busy')
  }
  const onPointerDown = (e) => {
    if (e.button === 2 || !boardRef.current || presentRef.current !== null) return
    if (e.target.closest('.bd-floating')) return
    gesture.current = null
    onPointerDownInner(e)
    if (gesture.current) grab(e)
  }
  const onPointerDownInner = (e) => {
    const t = e.target
    setPopover(null)
    setCtx(null)
    const tl = toolRef.current
    if (e.button === 1 || spaceRef.current || tl === 'hand' || (!canEditRef.current && e.button === 0 && !t.closest('[data-nodrag], [data-conn-id]'))) {
      if (t.closest('[data-nodrag]') && e.button === 0) return
      e.preventDefault()
      gesture.current = { type: 'pan', cx: e.clientX, cy: e.clientY, vx: vpRef.current.x, vy: vpRef.current.y }
      setPanning(true)
      return
    }
    if (e.button !== 0 || t.closest('[data-nodrag]')) return
    const w = worldOf(e)
    if (canEditRef.current && (tl === 'pen' || tl === 'highlighter')) {
      e.preventDefault()
      if (editingRef.current) document.activeElement?.blur?.()
      const o = optRef.current
      const g = { type: 'draw', tool: tl, points: [w], color: tl === 'pen' ? o.pen : o.highlighter, width: tl === 'pen' ? o.penWidth : Math.max(14, o.penWidth * 5) }
      gesture.current = g
      setLive({ ...g, points: [w] })
      return
    }
    if (canEditRef.current && tl === 'eraser') {
      e.preventDefault()
      gesture.current = { type: 'erase', recorded: false }
      eraseAt(w, gesture.current)
      return
    }
    if (canEditRef.current && CREATE_TOOLS.has(tl)) {
      e.preventDefault()
      if (editingRef.current) document.activeElement?.blur?.()
      gesture.current = { type: 'create', tool: tl, start: w, moved: false }
      return
    }
    const itemEl = t.closest('[data-item-id]')
    const connEl = t.closest('[data-conn-id]')
    if (itemEl) {
      const iid = itemEl.dataset.itemId
      if (itemEl.dataset.editing && !t.closest('[data-handle], [data-resize]')) return
      if (editingRef.current && editingRef.current !== iid) document.activeElement?.blur?.()
      const it = boardRef.current.items.find((i) => i.id === iid)
      if (!it) return
      e.preventDefault()
      if (t.closest('[data-handle]')) {
        gesture.current = { type: 'connect', from: iid }
        setDraft({ from: iid, x: w.x, y: w.y, target: null })
        return
      }
      if (t.closest('[data-resize]')) {
        if (it.locked) return
        gesture.current = { type: 'resize', id: iid, start: w, orig: { w: it.w, h: it.h }, ratio: it.type === 'image' || it.type === 'sticky' ? it.h / it.w : null, moved: false }
        return
      }
      const unit = unitOf(iid)
      let next = selRef.current
      let clickOnly = null
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        next = new Set(next)
        if (next.has(iid)) {
          unit.forEach((u) => next.delete(u))
          setSel(next)
          return
        }
        unit.forEach((u) => next.add(u))
      } else if (!next.has(iid)) next = new Set(unit)
      else clickOnly = unit
      setSel(next)
      setSelConn(null)
      const items = boardRef.current.items
      const movable = items.filter((i) => next.has(i.id) && !i.locked)
      // 프레임을 옮기면 그 안에 완전히 들어 있는 항목도 함께 옮긴다
      const extra = []
      for (const f of movable) {
        if (f.type !== 'frame') continue
        for (const i of items) if (!next.has(i.id) && !i.locked && i.type !== 'frame' && rectInside(i, f)) extra.push(i)
      }
      const all = [...movable, ...extra]
      const orig = new Map(all.map((i) => [i.id, { x: i.x, y: i.y }]))
      const view = viewRect(200)
      const others = items.filter((i) => !orig.has(i.id) && i.type !== 'stroke' && rectsOverlap(view, i)).slice(0, 400)
      gesture.current = { type: 'move', ids: new Set(movable.map((i) => i.id)), start: w, orig, box: boundsOf(all), others, alt: e.altKey, moved: false, clickOnly }
      return
    }
    if (connEl) {
      e.preventDefault()
      setSel(new Set())
      setSelConn(connEl.dataset.connId)
      return
    }
    if (editingRef.current) document.activeElement?.blur?.()
    setSelConn(null)
    const base = e.shiftKey ? new Set(selRef.current) : new Set()
    if (!e.shiftKey) setSel(new Set())
    gesture.current = { type: 'marquee', start: w, base }
  }

  const eraseAt = (w, g) => {
    const r = 8 / vpRef.current.zoom
    const hits = boardRef.current.items.filter((i) => i.type === 'stroke' && !i.locked && strokeHit(i, w.x, w.y, r))
    if (!hits.length) return
    const ids = new Set(hits.map((i) => i.id))
    update((b) => ({ items: b.items.filter((i) => !ids.has(i.id)), connections: b.connections.filter((c) => !ids.has(c.from) && !ids.has(c.to)), comments: b.comments.filter((m) => !ids.has(m.itemId)) }), { record: !g.recorded })
    g.recorded = true
  }

  useEffect(() => {
    const onMove = (e) => {
      const g = gesture.current
      if (!g || !stage.current) return
      if (g.type === 'pan') {
        setVp({ ...vpRef.current, x: g.vx + e.clientX - g.cx, y: g.vy + e.clientY - g.cy })
        return
      }
      const w = worldOf(e)
      if (g.type === 'draw') {
        const last = g.points[g.points.length - 1]
        if (Math.hypot(w.x - last.x, w.y - last.y) * vpRef.current.zoom < 1.5) return
        if (g.points.length >= 1990) return
        g.points.push(w)
        setLive({ ...g, points: [...g.points] })
        return
      }
      if (g.type === 'erase') {
        eraseAt(w, g)
        return
      }
      if (g.type === 'create') {
        const r = normRect(g.start.x, g.start.y, w.x, w.y)
        if (!g.moved && Math.max(r.w, r.h) * vpRef.current.zoom < 6) return
        g.moved = true
        if (g.tool !== 'sticky') setCreateRect(g.tool === 'text' ? { ...r, h: 30 } : r)
        return
      }
      if (g.type === 'marquee') {
        const r = normRect(g.start.x, g.start.y, w.x, w.y)
        setMarquee(r)
        const next = new Set(g.base)
        for (const it of boardRef.current.items) {
          if (it.type === 'frame' ? rectInside(it, r) : rectsOverlap(r, it)) unitOf(it.id).forEach((u) => next.add(u))
        }
        setSel(next)
        return
      }
      if (g.type === 'connect') {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-item-id]')
        const target = hit && hit.dataset.itemId !== g.from ? hit.dataset.itemId : null
        setDraft({ from: g.from, x: w.x, y: w.y, target })
        return
      }
      let dx = w.x - g.start.x
      let dy = w.y - g.start.y
      if (!g.moved) {
        if (Math.hypot(dx, dy) * vpRef.current.zoom < 3) return
        if (g.type === 'move' && !g.orig.size) return
        g.moved = true
        setMoving(true)
        record(hist.current, docRef.current)
        setHistTick((t) => t + 1)
        if (g.type === 'move') {
          let src = boardRef.current
          let z = maxZ()
          if (g.alt) {
            const cl = cloneItems(g.ids, 0)
            src = { ...src, items: [...src.items, ...cl.items], connections: [...src.connections, ...cl.connections] }
            g.ids = new Set(cl.items.map((i) => i.id))
            g.orig = new Map(cl.items.map((i) => [i.id, { x: i.x, y: i.y }]))
            z += cl.items.length
            setSel(new Set(g.ids))
          }
          src = { ...src, items: src.items.map((i) => (g.ids.has(i.id) && !g.alt && i.type !== 'frame' ? { ...i, z: ++z } : i)) }
          commit(src, { record: false })
        }
      }
      if (g.type === 'move') {
        if (g.box && !(e.metaKey || e.ctrlKey)) {
          const bx = g.box.x + dx
          const by = g.box.y + dy
          if (snapGridRef.current) {
            dx += Math.round(bx / GRID) * GRID - bx
            dy += Math.round(by / GRID) * GRID - by
            setGuides([])
          } else {
            const s = smartSnap({ x: bx, y: by, w: g.box.w, h: g.box.h }, g.others, 6 / vpRef.current.zoom)
            dx += s.dx
            dy += s.dy
            setGuides(s.guides)
          }
        } else setGuides([])
        update((b) => ({ items: b.items.map((i) => (g.orig.has(i.id) ? { ...i, x: Math.round(g.orig.get(i.id).x + dx), y: Math.round(g.orig.get(i.id).y + dy) } : i)) }), { record: false })
      } else if (g.type === 'resize') {
        update(
          (b) => ({
            items: b.items.map((i) => {
              if (i.id !== g.id) return i
              const [mw, mh] = MIN[i.type] || [24, 24]
              let nw = Math.max(mw, g.orig.w + dx)
              if (snapGridRef.current) nw = Math.max(mw, Math.round((i.x + nw) / GRID) * GRID - i.x)
              nw = Math.round(nw)
              let nh = g.ratio && !e.shiftKey ? Math.max(mh, nw * g.ratio) : Math.max(mh, g.orig.h + dy)
              if (snapGridRef.current && !(g.ratio && !e.shiftKey)) nh = Math.max(mh, Math.round((i.y + nh) / GRID) * GRID - i.y)
              return { ...i, w: nw, h: Math.round(nh) }
            }),
          }),
          { record: false }
        )
      }
    }
    const onUp = (e) => {
      const g = gesture.current
      gesture.current = null
      stage.current?.classList.remove('is-busy')
      if (!g) return
      setMoving(false)
      setGuides([])
      if (g.type === 'pan') setPanning(false)
      if (g.type === 'marquee') setMarquee(null)
      if (g.type === 'move' && !g.moved && g.clickOnly) setSel(new Set(g.clickOnly))
      if (g.type === 'draw') {
        setLive(null)
        if (g.points.length >= 1) {
          const s = strokeFromPoints(g.points, g.width)
          addItems([{ id: newId(), type: 'stroke', x: s.x, y: s.y, w: s.w, h: s.h, color: g.color, data: { tool: g.tool, width: g.width, points: s.points } }], { select: false })
        }
      }
      if (g.type === 'create') {
        setCreateRect(null)
        const w = worldOf(e)
        const r = g.moved ? normRect(g.start.x, g.start.y, w.x, w.y) : null
        createWithTool(g.tool, g.tool === 'sticky' ? null : r, g.moved && g.tool === 'sticky' ? w : g.start)
      }
      if (g.type === 'connect') {
        setDraft(null)
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-item-id]')
        const to = hit?.dataset.itemId
        if (to && to !== g.from) {
          const exists = boardRef.current.connections.some((c) => (c.from === g.from && c.to === to) || (c.from === to && c.to === g.from))
          if (!exists) {
            const cid = newId('c')
            update((b) => ({ connections: [...b.connections, { id: cid, from: g.from, to, label: '', arrow: 'end', color: null, style: connStyle.current }] }))
            setSel(new Set())
            setSelConn(cid)
          }
        }
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [commit, update, addItems, createWithTool, unitOf, setSel, setSelConn, setVp]) // eslint-disable-line react-hooks/exhaustive-deps

  const onDoubleClick = (e) => {
    if (!boardRef.current || presentRef.current !== null) return
    const t = document.elementFromPoint(e.clientX, e.clientY) || e.target
    if (t.closest('[data-nodrag], .bd-floating')) return
    const itemEl = t.closest('[data-item-id]')
    if (itemEl) {
      if (itemEl.dataset.editing) return
      const it = boardRef.current.items.find((i) => i.id === itemEl.dataset.itemId)
      if (it) editItem(it)
      return
    }
    const connEl = t.closest('[data-conn-id]')
    if (connEl) return editLabel(connEl.dataset.connId)
    if (canEditRef.current && toolRef.current === 'select' && t.closest('.bd-stage')) {
      const w = worldOf(e)
      addMemo({ x: w.x, y: w.y })
    }
  }

  // 오른쪽 클릭 메뉴
  const onContextMenu = (e) => {
    if (e.target.closest('.bd-memo__body--edit, .bd-textedit, .bd-floating input, .bd-floating textarea')) return
    e.preventDefault()
    if (!boardRef.current || presentRef.current !== null) return
    const t = e.target
    const itemEl = t.closest('[data-item-id]')
    const connEl = t.closest('[data-conn-id]')
    const pos = { x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 420) }
    if (itemEl) {
      const iid = itemEl.dataset.itemId
      if (!selRef.current.has(iid)) setSel(new Set(unitOf(iid)))
      setSelConn(null)
      setCtx({ kind: 'item', ...pos })
    } else if (connEl) {
      setSel(new Set())
      setSelConn(connEl.dataset.connId)
      setCtx({ kind: 'conn', ...pos })
    } else setCtx({ kind: 'canvas', ...pos, world: worldOf(e) })
  }

  // ── 찾기 ─────────────────────────────────────────────
  const board = doc ? doc.canvases.find((c) => c.id === doc.active) || doc.canvases[0] : null
  const matches = useMemo(() => {
    const q = search?.q?.trim().toLowerCase()
    if (!q || !board) return []
    return board.items.filter((i) => itemText(i).toLowerCase().includes(q)).map((i) => i.id)
  }, [search?.q, board])
  const matchSet = useMemo(() => new Set(matches), [matches])
  const curMatch = matches.length ? matches[(((search?.idx || 0) % matches.length) + matches.length) % matches.length] : null
  const goMatch = useCallback((delta) => setSearch((s) => (s ? { ...s, idx: (s.idx || 0) + delta } : s)), [])
  useEffect(() => {
    if (!curMatch) return
    const it = boardRef.current?.items.find((i) => i.id === curMatch)
    if (it) centerOn(it.x + it.w / 2, it.y + it.h / 2)
  }, [curMatch, search?.idx, centerOn])
  const openSearch = useCallback(() => {
    setSearch((s) => s || { q: '', idx: 0 })
    setTimeout(() => searchInput.current?.select(), 0)
  }, [])

  // ── 복사·붙여넣기·끌어 놓기 ───────────────────────────
  const copySelection = useCallback(async () => {
    const ids = selRef.current
    if (!ids.size) return false
    const b = boardRef.current
    const payload = { items: b.items.filter((i) => ids.has(i.id)), connections: b.connections.filter((c) => ids.has(c.from) && ids.has(c.to)) }
    try {
      await navigator.clipboard.writeText(CLIP_MARK + JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }, [])

  const pasteClip = useCallback(
    (text) => {
      let parsed
      try {
        parsed = JSON.parse(text.slice(CLIP_MARK.length))
      } catch {
        return
      }
      const clean = normalizeBoard(parsed)
      if (!clean.items.length) return
      const src = { items: clean.items, connections: clean.connections }
      if (tooMany(src.items.length)) return
      const cl = cloneItems(new Set(src.items.map((i) => i.id)), 24, src)
      update((b) => ({ items: [...b.items, ...cl.items], connections: [...b.connections, ...cl.connections] }))
      setSel(new Set(cl.items.map((i) => i.id)))
    },
    [update, setSel] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const modalOpen = picker || shareOpen || help || Boolean(tplMode)
  useEffect(() => {
    const onPaste = (e) => {
      if (!canEditRef.current || !boardRef.current || isTyping(e.target) || modalOpen || presentRef.current !== null) return
      const dt = e.clipboardData
      if (!dt) return
      const files = [...dt.files].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        addImages(files)
        return
      }
      const text = dt.getData('text/plain')
      if (!text) return
      e.preventDefault()
      if (text.startsWith(CLIP_MARK)) return pasteClip(text)
      const one = text.trim()
      if (!/\s/.test(one) && /^(https?:\/\/|www\.)/i.test(one) && addLinkUrl(one)) return
      addMemo(undefined, textToHtml(text.slice(0, 20000)))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImages, addLinkUrl, addMemo, pasteClip, modalOpen])

  const onDragOver = (e) => {
    if (!canEditRef.current) return
    const types = [...(e.dataTransfer?.types || [])]
    if (types.includes('Files') || types.includes('text/uri-list')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e) => {
    if (!canEditRef.current) return
    e.preventDefault()
    const at = worldOf(e)
    const files = [...(e.dataTransfer?.files || [])]
    if (files.length) return addImages(files, at)
    const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim()
    if (uri) addLinkUrl(uri, at)
  }

  // ── 발표 ─────────────────────────────────────────────
  const frames = useMemo(() => (board ? framesOf(board.items) : []), [board])
  const framesRef = useRef(frames)
  framesRef.current = frames
  const startPresent = useCallback(
    async (i = 0) => {
      setPopover(null)
      if (!framesRef.current.length) return alertDialog({ title: '발표할 프레임이 없습니다', message: '프레임 도구(F)로 영역을 만들면 프레임마다 한 장씩 발표합니다' })
      document.activeElement?.blur?.()
      presentVp.current = vpRef.current
      setSel(new Set())
      setSelConn(null)
      setEditing(null)
      setTool('select')
      setPresent(i)
      try {
        await root.current?.requestFullscreen?.()
      } catch {
        /* 전체 화면을 막은 브라우저는 창 안에서 발표한다 */
      }
    },
    [setSel, setSelConn, setEditing, setTool, setPresent]
  )
  const endPresent = useCallback(() => {
    if (presentRef.current === null) return
    setPresent(null)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    if (presentVp.current) setVp(presentVp.current)
  }, [setPresent, setVp])
  useEffect(() => {
    const h = () => {
      if (!document.fullscreenElement && presentRef.current !== null) endPresent()
    }
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [endPresent])
  const presentFrame = present !== null ? frames[Math.min(present, frames.length - 1)] : null
  useLayoutEffect(() => {
    if (!presentFrame) return
    const pad = 32
    const z = clamp(Math.min((stageSize.w - pad * 2) / presentFrame.w, (stageSize.h - pad * 2) / presentFrame.h), MIN_ZOOM, MAX_ZOOM)
    setVp({ x: stageSize.w / 2 - (presentFrame.x + presentFrame.w / 2) * z, y: stageSize.h / 2 - (presentFrame.y + presentFrame.h / 2) * z, zoom: z })
  }, [presentFrame, stageSize, setVp])
  const moveFrameOrder = useCallback(
    (fid, delta) => {
      const list = framesOf(boardRef.current.items)
      const i = list.findIndex((f) => f.id === fid)
      const j = i + delta
      if (i < 0 || j < 0 || j >= list.length) return
      const arr = [...list]
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      const order = new Map(arr.map((f, k) => [f.id, k + 1]))
      update((b) => ({ items: b.items.map((it) => (order.has(it.id) ? { ...it, data: { ...it.data, order: order.get(it.id) } } : it)) }))
    },
    [update]
  )

  // ── 단축키 ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!boardRef.current) return
      if (presentRef.current !== null) {
        const n = framesRef.current.length
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
          e.preventDefault()
          setPresent(Math.min(n - 1, presentRef.current + 1))
        } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
          e.preventDefault()
          setPresent(Math.max(0, presentRef.current - 1))
        } else if (e.key === 'Escape') endPresent()
        return
      }
      if (modalOpen || document.querySelector('[aria-modal="true"]')) return
      const mod = e.metaKey || e.ctrlKey
      if (e.target?.closest?.('.bd-ai')) return // AI 창 안에서 누른 키는 편집기가 가로채지 않는다
      const k = e.key.toLowerCase()
      if (mod && k === 'f') {
        e.preventDefault()
        openSearch()
        return
      }
      if (isTyping(e.target)) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!spaceRef.current) {
          spaceRef.current = true
          setSpace(true)
        }
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        setHelp(true)
        return
      }
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && k === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && (k === '=' || k === '+')) {
        e.preventDefault()
        zoomBy(1.2)
        return
      }
      if (mod && k === '-') {
        e.preventDefault()
        zoomBy(1 / 1.2)
        return
      }
      if (mod && k === '0') {
        e.preventDefault()
        zoomTo(1)
        return
      }
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault()
        fit()
        return
      }
      if (k === 'escape') {
        setSel(new Set())
        setSelConn(null)
        setSearch(null)
        setTool('select')
        setCtx(null)
        return
      }
      if (!mod && !e.altKey) {
        if (k === 'v') return setTool('select')
        if (k === 'h') return setTool('hand')
      }
      if (!canEditRef.current) return
      if (!mod && !e.altKey) {
        const toolKeys = { n: 'sticky', t: 'text', f: 'frame', e: 'eraser' }
        if (toolKeys[k]) return setTool(toolKeys[k])
        if (k === 'p') return setTool(e.shiftKey ? 'highlighter' : 'pen')
        if (k === 'r' || k === 'o') {
          setOpt((o) => ({ ...o, shape: k === 'r' ? 'rect' : 'ellipse' }))
          return setTool('shape')
        }
        if (k === ']' || k === '[') return reorder(k === ']' ? 'forward' : 'backward')
      }
      if (mod && (k === ']' || k === '[')) {
        e.preventDefault()
        return reorder(k === ']' ? 'front' : 'back')
      }
      if (mod && k === 'g') {
        e.preventDefault()
        return e.shiftKey ? ungroupSelection() : groupSelection()
      }
      if (mod && e.shiftKey && k === 'l') {
        e.preventDefault()
        return toggleLock()
      }
      if (mod && k === "'") {
        e.preventDefault()
        return setSnapGrid((v) => !v)
      }
      if (k === 'delete' || k === 'backspace') {
        e.preventDefault()
        deleteSelection()
        return
      }
      if (mod && k === 'a') {
        e.preventDefault()
        setSel(new Set(boardRef.current.items.map((i) => i.id)))
        return
      }
      if (mod && k === 'd') {
        e.preventDefault()
        duplicateSelection()
        return
      }
      if (mod && k === 'c') {
        if (selRef.current.size) {
          e.preventDefault()
          copySelection()
        }
        return
      }
      if (mod && k === 'x') {
        if (selRef.current.size) {
          e.preventDefault()
          copySelection().then(() => deleteSelection())
        }
        return
      }
      if (k === 'enter' && selRef.current.size === 1) {
        const it = boardRef.current.items.find((i) => selRef.current.has(i.id))
        if (it && TEXT_TYPES.has(it.type) && !it.locked) {
          e.preventDefault()
          setEditing(it.id)
        }
        return
      }
      const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }
      if (arrows[k] && selRef.current.size) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const [ax, ay] = arrows[k]
        const ids = selRef.current
        update((b) => ({ items: b.items.map((i) => (ids.has(i.id) && !i.locked ? { ...i, x: i.x + ax * step, y: i.y + ay * step } : i)) }))
      }
    }
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spaceRef.current = false
        setSpace(false)
      }
    }
    const onBlur = () => {
      spaceRef.current = false
      setSpace(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [modalOpen, openSearch, undo, redo, zoomBy, zoomTo, fit, deleteSelection, duplicateSelection, copySelection, update, setSel, setSelConn, setEditing, setTool, reorder, groupSelection, ungroupSelection, toggleLock, endPresent, setPresent])

  // ── 내보내기·가져오기 ─────────────────────────────────
  /** 화면 밖 항목까지 모두 그린 뒤 찍는다 */
  const withAll = async (label, fn) => {
    setPopover(null)
    setBusy(label)
    setExportAll(true)
    document.activeElement?.blur?.()
    try {
      await nextFrame()
      await sleep(250)
      return await fn()
    } finally {
      setExportAll(false)
      setBusy('')
    }
  }
  const fail = (title, e) => alertDialog({ title, message: e instanceof ExportError ? e.message : `잠시 뒤 다시 시도해 주세요 (${e?.message || '알 수 없는 오류'})` })
  const selectedFrame = () => {
    const ids = [...selRef.current]
    if (ids.length !== 1) return null
    const it = boardRef.current.items.find((i) => i.id === ids[0])
    return it?.type === 'frame' ? it : null
  }
  const exportHwpxNow = () => {
    const cv = boardRef.current
    if (!cv.items.length) return alertDialog({ message: '내보낼 항목이 없습니다' })
    const f = selectedFrame()
    const regions = regionsOf(cv.items, { frameId: f?.id || null })
    withAll('한글 파일을 만드는 중', () => exportHwpx(stage.current, f ? { ...cv, items: cv.items.filter((i) => i.id === f.id || rectInside(i, f)) } : cv, file.title, regions)).catch((e) => fail('한글로 내보내지 못했습니다', e))
  }
  const exportPngNow = () => {
    const cv = boardRef.current
    if (!cv.items.length) return alertDialog({ message: '내보낼 항목이 없습니다' })
    const f = selectedFrame()
    const [region] = regionsOf(cv.items, { frameId: f?.id || null, preferFrames: false })
    withAll('PNG를 만드는 중', () => exportPng(stage.current, region, `${file.title}_${cv.name}`)).catch((e) => fail('PNG로 내보내지 못했습니다', e))
  }
  const exportPdfNow = () => {
    const cv = boardRef.current
    if (!cv.items.length) return alertDialog({ message: '내보낼 항목이 없습니다' })
    withAll('PDF를 만드는 중', () => exportPdf(stage.current, regionsOf(cv.items), `${file.title}_${cv.name}`)).catch((e) => fail('PDF로 내보내지 못했습니다', e))
  }
  const toSlidesNow = async () => {
    setPopover(null)
    const list = framesOf(boardRef.current.items)
    if (!list.length) return alertDialog({ title: '프레임이 없습니다', message: '프레임 도구(F)로 영역을 만들면 프레임마다 슬라이드 한 장이 됩니다' })
    const ok = await confirmDialog({ title: '보드를 발표로', message: `프레임 ${list.length}개를 슬라이드 ${list.length}장으로 만든 새 DAH Slides 파일을 만듭니다.`, confirmLabel: '만들기' })
    if (!ok) return
    try {
      const sid = await withAll('슬라이드를 만드는 중', () => boardToSlides(stage.current, list, `${file.title} 발표`, (i, n) => setBusy(`슬라이드를 만드는 중 (${i}/${n})`)))
      await flush()
      const open = await confirmDialog({ title: '발표 파일을 만들었습니다', message: '지금 DAH Slides에서 열까요?', confirmLabel: '열기', cancelLabel: '보드에 머물기' })
      if (open) navigate(`/slides/${sid}`)
    } catch (e) {
      fail('발표 파일을 만들지 못했습니다', e)
    }
  }
  const exportJson = () => {
    setPopover(null)
    const data = { ...contentOf(), title: file?.title || '보드', exported_at: new Date().toISOString() }
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${safeName(file?.title)}.board.json`)
  }
  const importJson = async (f) => {
    if (!f) return
    if (f.size > MAX_BYTES) return alertDialog({ message: '4MB 이하 보드 파일만 가져올 수 있습니다' })
    let raw
    try {
      raw = JSON.parse(await f.text())
    } catch {
      return alertDialog({ message: '보드 JSON 파일이 아닙니다' })
    }
    const clean = normalizeDoc(raw)
    const count = clean.canvases.reduce((n, c) => n + c.items.length, 0)
    if (!count) return alertDialog({ message: '가져올 항목이 없습니다' })
    const d = docRef.current
    if (d.canvases.length + clean.canvases.length > MAX_CANVASES) return alertDialog({ message: `캔버스는 ${MAX_CANVASES}개까지 만들 수 있습니다` })
    if (tooMany(count)) return
    const ok = await confirmDialog({ title: '보드 가져오기', message: `캔버스 ${clean.canvases.length}개(항목 ${count}개)를 새 캔버스로 덧붙입니다. 실행취소로 되돌릴 수 있습니다.`, confirmLabel: '가져오기' })
    if (!ok) return
    const added = clean.canvases.map((c) => ({ ...c, id: newId('cv') }))
    commitDoc({ ...docRef.current, canvases: [...docRef.current.canvases, ...added] })
    switchCanvas(added[0].id)
  }

  const rename = async (title) => {
    try {
      await api.put(`/workspace/files/${id}`, { title })
      setFile((f) => ({ ...f, title }))
      document.title = `${title} | 디인예 워크스페이스`
    } catch (e) {
      toast(`이름을 바꾸지 못했습니다: ${e.message}`)
    }
  }

  // ── 그리기 ───────────────────────────────────────────
  const itemsById = useMemo(() => new Map((board?.items || []).map((i) => [i.id, i])), [board])
  const sortedItems = useMemo(() => {
    const list = [...(board?.items || [])]
    return list.sort((a, b) => (a.type === 'frame') - (b.type === 'frame') ? (a.type === 'frame' ? -1 : 1) : (a.z || 0) - (b.z || 0))
  }, [board])
  const conns = useMemo(
    () =>
      (board?.connections || [])
        .map((c) => {
          const a = itemsById.get(c.from)
          const b = itemsById.get(c.to)
          return a && b ? { c, a, b, ...connectionShape(a, b, c.arrow, c.style) } : null
        })
        .filter(Boolean),
    [board, itemsById]
  )
  const commentCount = useMemo(() => {
    const m = new Map()
    for (const c of board?.comments || []) if (!c.resolved) m.set(c.itemId, (m.get(c.itemId) || 0) + 1)
    return m
  }, [board])

  // 화면 밖 항목은 그리지 않는다. 보이는 영역을 화면 400px 칸 단위로 끊어, 칸을 넘을 때만 목록을 다시 만든다
  const qStep = 400 / vp.zoom
  const qx = Math.floor(-vp.x / vp.zoom / qStep) * qStep - qStep
  const qy = Math.floor(-vp.y / vp.zoom / qStep) * qStep - qStep
  const qw = Math.ceil(stageSize.w / vp.zoom / qStep) * qStep + qStep * 3
  const qh = Math.ceil(stageSize.h / vp.zoom / qStep) * qStep + qStep * 3
  const shown = useMemo(() => {
    if (exportAll) return sortedItems
    const view = { x: qx, y: qy, w: qw, h: qh }
    return sortedItems.filter((it) => rectsOverlap(view, it) || sel.has(it.id) || editing === it.id)
  }, [sortedItems, qx, qy, qw, qh, sel, editing, exportAll])
  const shownConns = useMemo(() => {
    if (exportAll) return conns
    const view = { x: qx, y: qy, w: qw, h: qh }
    return conns.filter(({ a, b }) => rectsOverlap(view, boundsOf([a, b])))
  }, [conns, qx, qy, qw, qh, exportAll])

  if (denied) return <NoAccess kind="doc" notFound={denied === 'missing'} />
  if (!board) return <div className="bd-loading">{loadError || '불러오는 중'}</div>


  const selItems = board.items.filter((i) => sel.has(i.id))
  const editingItem = editing ? itemsById.get(editing) : null
  const connSel = selConn ? board.connections.find((c) => c.id === selConn) : null
  const hasUndo = hist.current.undo.length > 0
  const hasRedo = hist.current.redo.length > 0
  const saveLabel = { saved: '저장됨', dirty: '저장 대기', saving: '저장 중', error: '저장 실패' }[saveState]
  const curColor = selItems.length ? effColor(selItems[0]) : connSel ? connSel.color : null
  let gridSize = GRID * vp.zoom
  while (gridSize < 10) gridSize *= 4
  const exec = (cmd, arg) => document.execCommand(cmd, false, arg)
  const presenting = present !== null
  const selBox = selItems.length ? boundsOf(selItems) : null
  const typesSel = new Set(selItems.map((i) => i.type))
  const only = (t) => typesSel.size === 1 && typesSel.has(t)
  const allLocked = selItems.length > 0 && selItems.every((i) => i.locked)
  const hasGroup = selItems.some((i) => i.group)
  const showMini = canEdit && !presenting && !moving && !marquee && !editing && !draft && (selBox || connSel)
  let miniPos = null
  if (showMini) {
    let anchor = selBox
    if (!anchor && connSel) {
      const cs = conns.find((x) => x.c.id === connSel.id)
      anchor = cs ? { x: cs.mid.x, y: cs.mid.y, w: 0, h: 0 } : null
    }
    if (anchor) {
      const sx = anchor.x * vp.zoom + vp.x + (anchor.w * vp.zoom) / 2
      const top = anchor.y * vp.zoom + vp.y
      const below = top < 70
      miniPos = { left: clamp(sx, 200, stageSize.w - 200), top: below ? Math.min(stageSize.h - 60, (anchor.y + anchor.h) * vp.zoom + vp.y + 14) : top - 14, below }
    }
  }
  const dockTool = (t, label, Icon, key) => (
    <TB label={`${label} (${key})`} onClick={() => setTool(t)} pressed={tool === t}>
      <Icon size={18} />
    </TB>
  )
  const pop = (name) => setPopover(popover === name ? null : name)
  const frameSel = selectedFrame()

  return (
    <div ref={root} className={`bd-root reading-scope ${presenting ? 'is-presenting' : ''}`}>
      {!presenting && (
        <>
          <div className="ed-row">
            <Link to="/workspace/boards" aria-label="보드 홈" title="보드 홈" className="ed-icon">
              <BoardIcon size={40} />
            </Link>
            {canEdit ? (
              <input
                defaultValue={file.title}
                key={file.title}
                aria-label="파일 이름"
                className="ed-title"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== file.title) rename(v)
                  else e.target.value = file.title
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            ) : (
              <h1 className="ed-title !cursor-default truncate">{file.title}</h1>
            )}
            <span role="status" aria-live="polite" className={`ed-status ${saveState === 'error' ? 'bd-status-error' : ''}`}>
              <Cloud size={16} aria-hidden="true" />
              {canEdit ? saveLabel : '보기 전용'}
            </span>
            {mcpRelay.badge}
            <div className="bd-row-right">
              {AiPanel && (
                <button type="button" className={`bd-ai-btn ${aiOpen ? 'is-on' : ''}`} aria-pressed={aiOpen} onClick={() => setAiOpen((v) => !v)} title={`AI 창 (${MOD}J)`}>
                  <Sparkles size={16} aria-hidden="true" /> AI
                </button>
              )}
              <button type="button" className="ed-share" onClick={() => setShareOpen(true)}>
                <ShareIcon size={16} aria-hidden="true" /> 공유
              </button>
              <AccountMenu size={40} />
            </div>
          </div>

          <div role="toolbar" aria-label="보드 도구 모음" className="bd-toolbar" ref={popover && !popover.startsWith('m-') && !popover.startsWith('d-') ? popRef : undefined}>
            {canEdit && (
              <>
                <TB label={`실행취소 (${MOD}Z)`} onClick={undo} disabled={!hasUndo}>
                  <Undo2 size={18} />
                </TB>
                <TB label={`다시 실행 (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} onClick={redo} disabled={!hasRedo}>
                  <Redo2 size={18} />
                </TB>
                <Sep />
                <TB label="메모 (캔버스를 두 번 눌러도 됩니다)" onClick={() => addMemo()}>
                  <FileText size={18} />
                </TB>
                <TB label="키워드" onClick={addKeyword}>
                  <Tag size={18} />
                </TB>
                <TB label="링크 (피그마, 노션 주소는 미리보기로)" onClick={addLink}>
                  <Link2 size={18} />
                </TB>
                <TB label="이미지 올리기 (붙여넣기, 끌어 놓기도 됩니다)" onClick={() => imageInput.current?.click()}>
                  <ImageIcon size={18} />
                </TB>
                <TB label="영상 (유튜브, 비메오)" onClick={addVideo}>
                  <Video size={18} />
                </TB>
                <button type="button" className="bd-tb bd-tb--text" onClick={() => setPicker(true)} title="우리 파일 (문서, 시트, 설문지, 프레젠테이션, 보드)">
                  우리 파일
                </button>
                <button type="button" className="bd-tb bd-tb--text" onClick={() => setTplMode('insert')}>
                  <LayoutTemplate size={18} aria-hidden="true" /> 템플릿
                </button>
              </>
            )}

            {canEdit && editingItem?.type === 'memo' && (
              <>
                <Sep />
                <TB label="굵게" keep onClick={() => exec('bold')}>
                  <Bold size={18} />
                </TB>
                <TB label="기울임" keep onClick={() => exec('italic')}>
                  <Italic size={18} />
                </TB>
                <TB label="밑줄" keep onClick={() => exec('underline')}>
                  <Underline size={18} />
                </TB>
                <TB label="제목" keep onClick={() => exec('formatBlock', document.queryCommandValue('formatBlock') === 'h3' ? 'p' : 'h3')}>
                  <Heading size={18} />
                </TB>
                <TB label="본문" keep onClick={() => exec('formatBlock', 'p')}>
                  <Type size={18} />
                </TB>
                <TB label="글머리 기호 목록" keep onClick={() => exec('insertUnorderedList')}>
                  <List size={18} />
                </TB>
                <TB label="번호 목록" keep onClick={() => exec('insertOrderedList')}>
                  <ListOrdered size={18} />
                </TB>
              </>
            )}

            <div className="bd-toolbar__right">
              <div className="bd-pop-wrap">
                <TB label="색으로 거르기" onClick={() => pop('filter')} pressed={popover === 'filter' || Boolean(filter)}>
                  <Palette size={18} />
                </TB>
                {popover === 'filter' && (
                  <div className="bd-popover bd-popover--right" role="menu" aria-label="색으로 거르기">
                    <button type="button" className={`bd-chip ${!filter ? 'is-on' : ''}`} onClick={() => { setFilter(null); setPopover(null) }}>
                      전체
                    </button>
                    {COLOR_ORDER.map((cid) => (
                      <button key={cid} type="button" className={`bd-swatch ${filter === cid ? 'is-on' : ''}`} style={{ background: COLORS[cid].fill }} onClick={() => { setFilter(cid); setPopover(null) }} title={COLORS[cid].name} aria-label={COLORS[cid].name} />
                    ))}
                  </div>
                )}
              </div>
              <TB label={`찾기 (${MOD}F)`} onClick={openSearch} pressed={Boolean(search)}>
                <Search size={18} />
              </TB>
              <TB label="댓글" onClick={() => (comments ? setComments(null) : openComments(sel.size === 1 ? [...sel][0] : null))} pressed={Boolean(comments)}>
                <MessageSquare size={18} />
              </TB>
              <Sep />
              <div className="bd-pop-wrap">
                <button type="button" className="bd-tb bd-tb--text" onClick={() => pop('present')} aria-pressed={popover === 'present'}>
                  <Presentation size={18} aria-hidden="true" /> 발표
                </button>
                {popover === 'present' && (
                  <div className="bd-popover bd-popover--right bd-popover--col" role="dialog" aria-label="발표">
                    <p className="bd-pop__title">프레임 순서</p>
                    {!frames.length && <p className="bd-pop__note">프레임 도구(F)로 영역을 만들면 프레임마다 한 장씩 발표합니다</p>}
                    <ol className="bd-frames">
                      {frames.map((f, i) => (
                        <li key={f.id}>
                          <button type="button" className="bd-frames__name" onClick={() => jumpToItem(f.id)}>
                            <span className="bd-frames__no">{i + 1}</span>
                            {f.data.name || '프레임'}
                          </button>
                          {canEdit && (
                            <>
                              <button type="button" className="bd-icon-btn bd-icon-btn--sm" disabled={i === 0} onClick={() => moveFrameOrder(f.id, -1)} aria-label="앞으로">
                                <ArrowUp size={14} />
                              </button>
                              <button type="button" className="bd-icon-btn bd-icon-btn--sm" disabled={i === frames.length - 1} onClick={() => moveFrameOrder(f.id, 1)} aria-label="뒤로">
                                <ArrowDown size={14} />
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ol>
                    <button type="button" className="bd-btn" disabled={!frames.length} onClick={() => startPresent(0)}>
                      <Play size={16} aria-hidden="true" /> 처음부터 발표
                    </button>
                  </div>
                )}
              </div>
              <div className="bd-pop-wrap">
                <button type="button" className="bd-tb bd-tb--text" onClick={() => pop('export')} aria-pressed={popover === 'export'}>
                  <FileDown size={18} aria-hidden="true" /> 내보내기
                </button>
                {popover === 'export' && (
                  <div className="bd-menu bd-menu--pop" role="menu" aria-label="내보내기">
                    <MenuItem onClick={exportHwpxNow} hint={frameSel ? '선택한 프레임' : frames.length ? `프레임 ${frames.length}개` : '캔버스 전체'}>
                      한글(HWPX)로 내보내기
                    </MenuItem>
                    <MenuItem onClick={exportPngNow} hint={frameSel ? '선택한 프레임' : '캔버스 전체'}>
                      PNG 그림
                    </MenuItem>
                    <MenuItem onClick={exportPdfNow} hint={frames.length ? '프레임마다 한 쪽' : '캔버스 전체'}>
                      PDF
                    </MenuItem>
                    {canEdit && (
                      <MenuItem onClick={toSlidesNow} hint="DAH Slides">
                        보드를 발표로
                      </MenuItem>
                    )}
                    <MenuSep />
                    <MenuItem onClick={exportJson}>JSON으로 내보내기</MenuItem>
                    {canEdit && (
                      <MenuItem onClick={() => { setPopover(null); importInput.current?.click() }}>
                        JSON 가져오기
                      </MenuItem>
                    )}
                  </div>
                )}
              </div>
              <TB label="단축키 (?)" onClick={() => setHelp(true)}>
                <Keyboard size={18} />
              </TB>
            </div>
          </div>
        </>
      )}

      <div className="bd-main">
      <div
        ref={stage}
        className={`bd-stage ${space || tool === 'hand' ? 'is-space' : ''} ${panning ? 'is-panning' : ''} ${!canEdit ? 'is-readonly' : ''} ${canEdit && tool !== 'select' && tool !== 'hand' ? `is-tool is-tool-${tool}` : ''} ${snapGrid ? 'is-grid' : ''} ${vp.zoom < 0.3 && !exportAll ? 'is-far' : ''}`}
        style={presenting ? undefined : { backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
      >
        <div className="bd-world" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, '--iz': exportAll ? 1 : clamp(1 / vp.zoom, 0.5, 6) }}>
          <ConnLayer conns={shownConns} selConn={selConn} filter={filter} itemsById={itemsById} />
          {draft && itemsById.get(draft.from) && (
            <svg className="bd-links bd-links--draft" aria-hidden="true">
              <path d={draftPath(itemsById.get(draft.from), draft)} className="bd-link-draft" />
            </svg>
          )}
          <ItemsLayer
            items={shown}
            sel={sel}
            editing={editing}
            matchSet={matchSet}
            curMatch={curMatch}
            filter={filter}
            readOnly={!canEdit || presenting}
            showHandles={canEdit && tool === 'select'}
            commentCount={presenting ? null : commentCount}
            onCommit={patchData}
            onEndEdit={endEdit}
            onComments={openComments}
          />
          {live && (
            <svg className="bd-live" aria-hidden="true">
              <path
                d={strokePath(live.points.flatMap((p) => [p.x, p.y]).concat(live.points.length === 1 ? [live.points[0].x + 0.5, live.points[0].y + 0.5] : []))}
                fill="none"
                stroke={COLORS[live.color]?.fill || '#1f1f1f'}
                strokeWidth={live.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={live.tool === 'highlighter' ? 0.45 : 1}
              />
            </svg>
          )}
          {createRect && <div className="bd-marquee bd-marquee--create" style={{ transform: `translate(${createRect.x}px, ${createRect.y}px)`, width: createRect.w, height: createRect.h }} />}
          {guides.map((g, i) => (
            <div key={i} className="bd-guide" style={{ transform: `translate(${g.x1}px, ${g.y1}px)`, width: Math.max(1 / vp.zoom, g.x2 - g.x1), height: Math.max(1 / vp.zoom, g.y2 - g.y1) }} />
          ))}
          {draft?.target && itemsById.get(draft.target) && (
            <div
              className="bd-drop-target"
              style={{ transform: `translate(${itemsById.get(draft.target).x}px, ${itemsById.get(draft.target).y}px)`, width: itemsById.get(draft.target).w, height: itemsById.get(draft.target).h }}
            />
          )}
          {marquee && <div className="bd-marquee" style={{ transform: `translate(${marquee.x}px, ${marquee.y}px)`, width: marquee.w, height: marquee.h }} />}
        </div>

        {presentFrame && (
          <div
            className="bd-present-mask"
            style={{ left: presentFrame.x * vp.zoom + vp.x, top: presentFrame.y * vp.zoom + vp.y, width: presentFrame.w * vp.zoom, height: presentFrame.h * vp.zoom }}
          />
        )}

        {!board.items.length && !presenting && (
          <div className="bd-empty-hint">
            {canEdit ? '왼쪽 도구로 포스트잇, 도형, 펜을 쓰거나 빈 곳을 두 번 눌러 메모를 만드세요. 아래 + 로 템플릿 캔버스를 더할 수 있습니다' : '아직 비어 있는 캔버스입니다'}
          </div>
        )}

        {canEdit && !presenting && (
          <div className="bd-floating bd-dock" role="toolbar" aria-label="그리기 도구" aria-orientation="vertical" ref={popover?.startsWith('d-') ? popRef : undefined}>
            {dockTool('select', '선택', MousePointer2, 'V')}
            {dockTool('hand', '화면 이동', Hand, 'H')}
            <span className="bd-dock__sep" />
            {dockTool('sticky', '포스트잇', StickyNote, 'N')}
            <TB label="도형 (R, O)" onClick={() => setTool('shape')} pressed={tool === 'shape'}>
              <Shapes size={18} />
            </TB>
            {dockTool('text', '글자', Type, 'T')}
            {dockTool('frame', '프레임', Frame, 'F')}
            <span className="bd-dock__sep" />
            {dockTool('pen', '펜', Pen, 'P')}
            {dockTool('highlighter', '형광펜', Highlighter, 'Shift+P')}
            {dockTool('eraser', '지우개 (펜 그림만)', Eraser, 'E')}
            {(tool === 'sticky' || tool === 'shape' || tool === 'pen' || tool === 'highlighter') && (
              <div className="bd-dock__flyout" style={{ top: { sticky: 96, shape: 132, pen: 248, highlighter: 284 }[tool] }}>
                {tool === 'sticky' && <Swatches value={opt.sticky} allowNone={false} onPick={(c) => setOpt((o) => ({ ...o, sticky: c }))} />}
                {tool === 'shape' &&
                  SHAPE_LIST.map(([s, label]) => (
                    <TB key={s} label={label} onClick={() => setOpt((o) => ({ ...o, shape: s }))} pressed={opt.shape === s}>
                      <ShapeIcon shape={s} />
                    </TB>
                  ))}
                {(tool === 'pen' || tool === 'highlighter') && (
                  <>
                    <Swatches value={opt[tool]} allowNone={false} onPick={(c) => setOpt((o) => ({ ...o, [tool]: c }))} />
                    <span className="bd-sep" />
                    {[2, 4, 8].map((wd) => (
                      <TB key={wd} label={`굵기 ${wd}`} onClick={() => setOpt((o) => ({ ...o, penWidth: wd }))} pressed={opt.penWidth === wd}>
                        <span className="bd-width" style={{ width: wd + 2, height: wd + 2 }} />
                      </TB>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {showMini && miniPos && (
          <div
            className={`bd-floating bd-mini ${miniPos.below ? 'is-below' : ''}`}
            style={{ left: miniPos.left, top: miniPos.top }}
            role="toolbar"
            aria-label="선택한 항목 도구"
            ref={popover?.startsWith('m-') ? popRef : undefined}
          >
            {selItems.length > 0 && !allLocked && (
              <>
                <div className="bd-pop-wrap">
                  <TB label="색" onClick={() => pop('m-color')} pressed={popover === 'm-color'}>
                    <span className="bd-swatch-mini" style={{ background: curColor ? COLORS[curColor].fill : '#ffffff' }} />
                  </TB>
                  {popover === 'm-color' && (
                    <div className="bd-popover">
                      <Swatches value={curColor} onPick={setColor} />
                    </div>
                  )}
                </div>
                {only('sticky') &&
                  STICKY_SIZES.map(([n, s]) => (
                    <TB key={n} label={`크기 ${n}`} className="bd-tb--letter" onClick={() => patchSelected((i) => ({ ...i, w: s, h: s }))} pressed={selItems.every((i) => i.w === s && i.h === s)}>
                      {n}
                    </TB>
                  ))}
                {only('shape') && (
                  <div className="bd-pop-wrap">
                    <TB label="도형 모양" onClick={() => pop('m-shape')} pressed={popover === 'm-shape'}>
                      <ShapeIcon shape={selItems[0].data.shape} />
                    </TB>
                    {popover === 'm-shape' && (
                      <div className="bd-popover">
                        {SHAPE_LIST.map(([s, label]) => (
                          <TB key={s} label={label} onClick={() => { setPopover(null); patchSelected((i) => ({ ...i, data: { ...i.data, shape: s } })) }} pressed={selItems[0].data.shape === s}>
                            <ShapeIcon shape={s} />
                          </TB>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {only('text') && (
                  <>
                    <TB label="글자 작게" onClick={() => patchSelected((i) => ({ ...i, h: Math.round(Math.max(10, i.data.size - 4) * 1.5), data: { ...i.data, size: Math.max(10, i.data.size - 4) } }))}>
                      <Minus size={16} />
                    </TB>
                    <span className="bd-mini__num">{selItems[0].data.size}</span>
                    <TB label="글자 크게" onClick={() => patchSelected((i) => ({ ...i, h: Math.round(Math.min(160, i.data.size + 4) * 1.5), data: { ...i.data, size: Math.min(160, i.data.size + 4) } }))}>
                      <Plus size={16} />
                    </TB>
                    <TB label="굵게" onClick={() => patchSelected((i) => ({ ...i, data: { ...i.data, bold: !selItems[0].data.bold } }))} pressed={Boolean(selItems[0].data.bold)}>
                      <Bold size={16} />
                    </TB>
                  </>
                )}
                {selItems.length > 1 && (
                  <div className="bd-pop-wrap">
                    <TB label="정렬" onClick={() => pop('m-align')} pressed={popover === 'm-align'}>
                      <AlignStartVertical size={18} />
                    </TB>
                    {popover === 'm-align' && (
                      <div className="bd-popover">
                        <TB label="왼쪽 맞춤" onClick={() => align('left')}><AlignStartVertical size={18} /></TB>
                        <TB label="가로 가운데" onClick={() => align('hcenter')}><AlignCenterVertical size={18} /></TB>
                        <TB label="오른쪽 맞춤" onClick={() => align('right')}><AlignEndVertical size={18} /></TB>
                        <TB label="위쪽 맞춤" onClick={() => align('top')}><AlignStartHorizontal size={18} /></TB>
                        <TB label="세로 가운데" onClick={() => align('vcenter')}><AlignCenterHorizontal size={18} /></TB>
                        <TB label="아래쪽 맞춤" onClick={() => align('bottom')}><AlignEndHorizontal size={18} /></TB>
                        <span className="bd-sep" />
                        <TB label="가로 간격 같게 (3개 이상)" onClick={() => align('hdist')} disabled={selItems.length < 3}><AlignHorizontalDistributeCenter size={18} /></TB>
                        <TB label="세로 간격 같게 (3개 이상)" onClick={() => align('vdist')} disabled={selItems.length < 3}><AlignVerticalDistributeCenter size={18} /></TB>
                      </div>
                    )}
                  </div>
                )}
                <div className="bd-pop-wrap">
                  <TB label="순서" onClick={() => pop('m-arrange')} pressed={popover === 'm-arrange'}>
                    <BringToFront size={18} />
                  </TB>
                  {popover === 'm-arrange' && (
                    <div className="bd-menu bd-menu--pop bd-menu--left" role="menu">
                      <MenuItem onClick={() => reorder('front')} hint={`${MOD}]`}>맨 앞으로</MenuItem>
                      <MenuItem onClick={() => reorder('forward')} hint="]">앞으로</MenuItem>
                      <MenuItem onClick={() => reorder('backward')} hint="[">뒤로</MenuItem>
                      <MenuItem onClick={() => reorder('back')} hint={`${MOD}[`}>맨 뒤로</MenuItem>
                    </div>
                  )}
                </div>
                {selItems.length > 1 && !hasGroup && (
                  <TB label={`묶기 (${MOD}G)`} onClick={groupSelection}>
                    <Group size={18} />
                  </TB>
                )}
                {hasGroup && (
                  <TB label={`묶음 풀기 (${MOD}Shift+G)`} onClick={ungroupSelection}>
                    <Ungroup size={18} />
                  </TB>
                )}
                <TB label={`복제 (${MOD}D)`} onClick={duplicateSelection}>
                  <Copy size={18} />
                </TB>
              </>
            )}
            {selItems.length > 0 && (
              <TB label={allLocked ? '잠금 풀기' : '잠그기'} onClick={toggleLock} pressed={allLocked}>
                {allLocked ? <LockOpen size={18} /> : <Lock size={18} />}
              </TB>
            )}
            {selItems.length === 1 && (
              <TB label="댓글 남기기" onClick={() => openComments(selItems[0].id)}>
                <MessageSquarePlus size={18} />
              </TB>
            )}
            {connSel && (
              <>
                <div className="bd-pop-wrap">
                  <TB label="색" onClick={() => pop('m-color')} pressed={popover === 'm-color'}>
                    <span className="bd-swatch-mini" style={{ background: curColor ? COLORS[curColor].fill : LINE_DEFAULT }} />
                  </TB>
                  {popover === 'm-color' && (
                    <div className="bd-popover">
                      <Swatches value={curColor} onPick={setColor} />
                    </div>
                  )}
                </div>
                <TB label="곡선" onClick={() => setConn({ style: 'curve' })} pressed={(connSel.style || 'curve') === 'curve'}>
                  <Spline size={18} />
                </TB>
                <TB label="직선" onClick={() => setConn({ style: 'straight' })} pressed={connSel.style === 'straight'}>
                  <Slash size={18} />
                </TB>
                <TB label="꺾은선" onClick={() => setConn({ style: 'elbow' })} pressed={connSel.style === 'elbow'}>
                  <CornerDownRight size={18} />
                </TB>
                <span className="bd-sep" />
                <TB label="화살표 없음" onClick={() => setConn({ arrow: 'none' })} pressed={connSel.arrow === 'none'}>
                  <Minus size={18} />
                </TB>
                <TB label="끝에 화살표" onClick={() => setConn({ arrow: 'end' })} pressed={connSel.arrow === 'end'}>
                  <ArrowRight size={18} />
                </TB>
                <TB label="양쪽 화살표" onClick={() => setConn({ arrow: 'both' })} pressed={connSel.arrow === 'both'}>
                  <ArrowLeftRight size={18} />
                </TB>
                <button type="button" className="bd-tb bd-tb--text" onClick={() => editLabel(connSel.id)}>
                  {connSel.label ? '이름 고치기' : '이름 붙이기'}
                </button>
              </>
            )}
            {(!allLocked || connSel) && (
              <TB label="삭제 (Delete)" onClick={deleteSelection}>
                <Trash2 size={18} />
              </TB>
            )}
          </div>
        )}

        {search && !presenting && (
          <div className="bd-floating bd-search" role="search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInput}
              autoFocus
              value={search.q}
              placeholder="이 캔버스에서 찾기"
              aria-label="이 캔버스에서 찾기"
              onChange={(e) => setSearch({ q: e.target.value, idx: 0 })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  goMatch(e.shiftKey ? -1 : 1)
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSearch(null)
                }
              }}
            />
            <span className="bd-search__count">{search.q.trim() ? (matches.length ? `${matches.indexOf(curMatch) + 1}/${matches.length}` : '0개') : ''}</span>
            <button type="button" className="bd-icon-btn" onClick={() => goMatch(-1)} disabled={!matches.length} aria-label="이전">
              <ChevronUp size={16} />
            </button>
            <button type="button" className="bd-icon-btn" onClick={() => goMatch(1)} disabled={!matches.length} aria-label="다음">
              <ChevronDown size={16} />
            </button>
            <button type="button" className="bd-icon-btn" onClick={() => setSearch(null)} aria-label="찾기 닫기">
              <X size={16} />
            </button>
          </div>
        )}

        {comments && !presenting && (
          <CommentsPanel
            canvas={board}
            focusId={comments.focus}
            selectedId={sel.size === 1 ? [...sel][0] : null}
            me={me?.name || ''}
            canEdit={canEdit}
            onAdd={addComment}
            onResolve={resolveComment}
            onDelete={deleteComment}
            onJump={jumpToItem}
            onClose={() => setComments(null)}
          />
        )}

        {!presenting && (
          <div className="bd-floating bd-corner" style={comments ? { right: 352 } : undefined}>
            {showMap && board.items.length > 0 && <Minimap items={board.items} vp={vp} size={stageSize} onJump={centerOn} />}
            <div className="bd-zoom" role="group" aria-label="확대·축소">
              <button type="button" className="bd-icon-btn" onClick={() => setSnapGrid((v) => !v)} aria-pressed={snapGrid} aria-label="격자에 맞추기" title={`격자에 맞추기 (${MOD}')`}>
                <Magnet size={16} />
              </button>
              <button type="button" className="bd-icon-btn" onClick={() => setShowMap((v) => !v)} aria-pressed={showMap} aria-label="미니맵" title="미니맵">
                <MapIcon size={16} />
              </button>
              <button type="button" className="bd-icon-btn" onClick={() => zoomBy(1 / 1.2)} disabled={vp.zoom <= MIN_ZOOM + 0.001} aria-label="축소" title={`축소 (${MOD}-)`}>
                <Minus size={16} />
              </button>
              <button type="button" className="bd-zoom__pct" onClick={() => zoomTo(1)} title={`100%로 (${MOD}0)`}>
                {Math.round(vp.zoom * 100)}%
              </button>
              <button type="button" className="bd-icon-btn" onClick={() => zoomBy(1.2)} disabled={vp.zoom >= MAX_ZOOM - 0.001} aria-label="확대" title={`확대 (${MOD}+)`}>
                <Plus size={16} />
              </button>
              <button type="button" className="bd-icon-btn" onClick={fit} aria-label="화면에 맞추기" title="화면에 맞추기 (Shift+1)">
                <Maximize size={16} />
              </button>
            </div>
          </div>
        )}
        {canEdit && !presenting && sel.size > 1 && <div className="bd-floating bd-selcount">{sel.size}개 선택</div>}
        {canEdit && draft && (
          <div className="bd-floating bd-selcount">
            <MoveRight size={14} aria-hidden="true" /> 이을 항목 위에서 놓으세요
          </div>
        )}
        {busy && <div className="bd-floating bd-selcount bd-busy">{busy}</div>}

        {presenting && (
          <div className="bd-floating bd-present-bar" role="toolbar" aria-label="발표">
            <button type="button" className="bd-icon-btn" onClick={() => setPresent(Math.max(0, present - 1))} disabled={present === 0} aria-label="이전 장">
              <ChevronLeft size={20} />
            </button>
            <span className="bd-present-bar__no">
              {present + 1} / {frames.length}
            </span>
            <button type="button" className="bd-icon-btn" onClick={() => setPresent(Math.min(frames.length - 1, present + 1))} disabled={present >= frames.length - 1} aria-label="다음 장">
              <ChevronRight size={20} />
            </button>
            <button type="button" className="bd-icon-btn" onClick={endPresent} aria-label="발표 끝내기" title="발표 끝내기 (Esc)">
              <X size={20} />
            </button>
          </div>
        )}
      </div>
      {aiOpen && AiPanel && !presenting && (
        <aside className="bd-ai" aria-label="AI 창">
          <Suspense fallback={<div className="bd-ai__loading">불러오는 중</div>}>
            <AiPanel
              open
              onClose={() => setAiOpen(false)}
              scope={`board:${id}`}
              title="보드 AI"
              systemPrompt={buildBoardSystemPrompt(getKnowledge('board'))}
              tools={aiTools}
              getContext={aiContext}
              quickActions={BOARD_QUICK_ACTIONS}
              placeholder="보드를 어떻게 정리할까요?"
              canEdit={canEdit}
            />
          </Suspense>
        </aside>
      )}
      </div>

      {!presenting && (
        <CanvasTabs
          canvases={doc.canvases}
          active={doc.active}
          canEdit={canEdit}
          onSwitch={switchCanvas}
          onAdd={() => setTplMode('new')}
          onRename={renameCanvas}
          onDuplicate={duplicateCanvas}
          onMove={moveCanvas}
          onDelete={deleteCanvas}
          onReorder={reorderCanvas}
        />
      )}

      {ctx && (
        <div ref={ctxRef} className="bd-menu bd-ctx" role="menu" style={{ left: ctx.x, top: ctx.y }} onContextMenu={(e) => e.preventDefault()}>
          {ctx.kind === 'item' && (
            <>
              {canEdit && !allLocked && (
                <>
                  <MenuItem onClick={() => { setCtx(null); copySelection() }} hint={`${MOD}C`}>복사</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); duplicateSelection() }} hint={`${MOD}D`}>복제</MenuItem>
                  <MenuSep />
                  <MenuItem onClick={() => { setCtx(null); reorder('front') }} hint={`${MOD}]`}>맨 앞으로</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); reorder('forward') }} hint="]">앞으로</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); reorder('backward') }} hint="[">뒤로</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); reorder('back') }} hint={`${MOD}[`}>맨 뒤로</MenuItem>
                  <MenuSep />
                  {selItems.length > 1 && !hasGroup && <MenuItem onClick={() => { setCtx(null); groupSelection() }} hint={`${MOD}G`}>묶기</MenuItem>}
                  {hasGroup && <MenuItem onClick={() => { setCtx(null); ungroupSelection() }} hint={`${MOD}Shift+G`}>묶음 풀기</MenuItem>}
                </>
              )}
              {canEdit && <MenuItem onClick={() => { setCtx(null); toggleLock() }} hint={`${MOD}Shift+L`}>{allLocked ? '잠금 풀기' : '잠그기'}</MenuItem>}
              {selItems.length === 1 && <MenuItem onClick={() => { setCtx(null); openComments(selItems[0].id) }}>댓글</MenuItem>}
              {selItems.length === 1 && selItems[0].type === 'frame' && (
                <>
                  <MenuSep />
                  <MenuItem onClick={() => { setCtx(null); exportPngNow() }}>이 프레임을 PNG로</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); startPresent(Math.max(0, frames.findIndex((f) => f.id === selItems[0].id))) }}>여기부터 발표</MenuItem>
                </>
              )}
              <MenuItem onClick={() => { setCtx(null); fit() }} hint="Shift+1">선택한 항목으로 이동</MenuItem>
              {canEdit && !allLocked && (
                <>
                  <MenuSep />
                  <MenuItem danger onClick={() => { setCtx(null); deleteSelection() }} hint="Delete">삭제</MenuItem>
                </>
              )}
            </>
          )}
          {ctx.kind === 'conn' && canEdit && (
            <>
              <MenuItem onClick={() => { setCtx(null); setConn({ style: 'curve' }) }}>곡선</MenuItem>
              <MenuItem onClick={() => { setCtx(null); setConn({ style: 'straight' }) }}>직선</MenuItem>
              <MenuItem onClick={() => { setCtx(null); setConn({ style: 'elbow' }) }}>꺾은선</MenuItem>
              <MenuSep />
              <MenuItem onClick={() => { setCtx(null); editLabel(selConnRef.current) }}>이름 붙이기</MenuItem>
              <MenuItem danger onClick={() => { setCtx(null); deleteSelection() }} hint="Delete">삭제</MenuItem>
            </>
          )}
          {(ctx.kind === 'canvas' || (ctx.kind === 'conn' && !canEdit)) && (
            <>
              {canEdit && ctx.world && (
                <>
                  <MenuItem onClick={() => { setCtx(null); createWithTool('sticky', null, ctx.world) }} hint="N">여기에 포스트잇</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); addMemo(ctx.world) }}>여기에 메모</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); createWithTool('text', null, ctx.world) }} hint="T">여기에 글자</MenuItem>
                  <MenuItem onClick={() => { setCtx(null); setTplMode('insert') }}>템플릿 넣기</MenuItem>
                  <MenuSep />
                  <MenuItem onClick={() => { setCtx(null); setSel(new Set(boardRef.current.items.map((i) => i.id))) }} hint={`${MOD}A`}>모두 선택</MenuItem>
                </>
              )}
              <MenuItem onClick={() => { setCtx(null); setSel(new Set()); fit() }} hint="Shift+1">화면에 맞추기</MenuItem>
              <MenuItem onClick={() => { setCtx(null); setSnapGrid((v) => !v) }} hint={`${MOD}'`}>{snapGrid ? '격자에 맞추기 끄기' : '격자에 맞추기'}</MenuItem>
              <MenuItem onClick={() => { setCtx(null); setHelp(true) }} hint="?">단축키</MenuItem>
            </>
          )}
        </div>
      )}

      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = '' }} />
      <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(e) => { importJson(e.target.files[0]); e.target.value = '' }} />
      {picker && <FilePicker onPick={addFile} onClose={() => setPicker(false)} excludeBoardId={Number(id)} />}
      {tplMode && <TemplatePicker mode={tplMode} onPick={tplMode === 'new' ? addCanvas : insertTemplate} onClose={() => setTplMode(null)} />}
      {help && <ShortcutHelp mod={MOD} onClose={() => setHelp(false)} />}
      {shareOpen && <ShareDialog fileId={Number(id)} title={file.title} linkPath={window.location.pathname} onClose={() => { setShareOpen(false); setShareTick((t) => t + 1) }} />}
    </div>
  )
}
