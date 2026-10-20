// DAH Slides: 발표 자료 편집기 (/slides/:id).
//
// 내용 모양(ws_files.content, 서버 server/src/routes/slides.js가 같은 모양을 검사한다)
//   {
//     version: 1,
//     theme: { id, name, fonts: { heading, body },               // 글꼴: 'sans'|'serif'|'gothic'|'mono' 또는 글꼴 이름
//              colors: { bg, text, accent, accent2, muted, surface } },   // '#RRGGBB'
//     size: { w: 1920, h: 1080 },                                 // 슬라이드 좌표(px). 화면에서는 배율만 바꾼다
//     slides: [{
//       id, layout: 'title'|'title-body'|'two-col'|'section'|'image-text'|'big-number'|'quote'|'blank', variant: number,
//       background: null | { color?: 색, image?: 주소, fit?: 'cover'|'contain' },
//       notes: string, hidden: boolean, transition: 'none'|'fade'|'slide'|'magic'(매직 무브: mid가 같은 요소를 이어 움직임),
//       stacks?: { [묶음 id]: { dir: 'row'|'column', gap, pad, align: 'start'|'center'|'end', frame?: 배경 도형 id } },  // 자동 배치
//       elements: [{
//         id, type: 'text'|'shape'|'image'|'table'|'embed', role?: 레이아웃 역할('title','body','deco'...),
//         x, y, w, h, rotate, z, locked, group?: 묶음 id, name?: 레이어 이름, hidden?: 숨김(어디에도 그리지 않음),
//         mid?: 매직 무브 짝 id(슬라이드를 복제하면 원본 요소의 mid||id),
//         style: 공통  { opacity, shadow?: {x,y,blur,color('#RRGGBBAA')}, blur?(px), lockRatio? }
//                text  { font, size, color, align, valign, lineHeight, bold, italic, underline, fill, fillType?: 'solid'|'linear',
//                        gradient?: {from, to, angle}, radius, pad, autofit, sizing?: 'auto-w'|'auto-h'|'fixed', tracking(em),
//                        paraSpacing(px), textTransform: 'none'|'uppercase'|'lowercase'|'capitalize', textShadow?: {x,y,blur,color} }
//                shape { fill, fillType?, gradient?, stroke, strokeWidth, strokeStyle?: 'solid'|'dashed'|'dotted', radius, arrowEnd, color(아이콘) }
//                image { fit: 'cover'|'contain'|'fill', posX, posY (0~100), radius, mask?: 'circle'|'rounded', brightness?, contrast? (100 = 그대로) }
//                table { font, size, color, headerFill, headerColor, line, fill }
//         data:  text  { html, placeholder }            // html은 sanitize.js의 허용 태그만
//                shape { shape: 'rect'|'rounded'|'ellipse'|'triangle'|'arrow'|'line'|'icon', icon? }
//                image { src, alt, placeholder }
//                table { rows: string[][], header: boolean }
//                embed { url, title, description, image, siteName, kind: 'figma'|'notion'|'youtube'|'link', embedUrl? }
//         anim?: { type: 'fade'|'rise'|'zoom', order }
//       }]
//     }]
//   }
// 색 값은 '#RRGGBB' 또는 테마 토큰('@accent' 등, deckCore.js). 테마를 바꾸면 토큰을 쓴 요소가 함께 바뀐다.
// 슬라이드 300장, JSON 3MB까지(서버 검사). 글 HTML과 주소는 불러올 때와 그릴 때 sanitize.js로 다시 거른다.
//
// 저장: 바뀌면 0.8초 모아서 PUT /workspace/slides/:id. 보기 권한이면 읽기·발표·내보내기만 한다.
// 실행취소: 바꾸기 직전의 발표 전체를 기록한다(100단계). 끌기·크기 조절·회전은 시작할 때 한 번만 기록한다.
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowRight, Bold, Circle, Cloud, Download, Image as ImageIcon, Italic,
  Link2, List, ListOrdered, Maximize, Minus, MonitorPlay, Play, Plus, Redo2, RectangleHorizontal, Shapes, Smile, Square, StickyNote,
  Table2, Triangle, Type, Underline, Undo2, WandSparkles, LetterText, Baseline, PanelBottomClose, PanelBottomOpen, Rows3, Columns3,
  AlignVerticalJustifyCenter, MoveVertical, Lock, Copy, ImageDown, Upload, ExternalLink, Pencil, Unlink, Scissors, Group, Ungroup, Trash2,
  EyeOff, ArrowUpToLine, ArrowDownToLine, Sparkles,
} from 'lucide-react'
import AccountMenu from '../../components/common/AccountMenu'
import ShareDialog, { useShareIcon } from '../../components/common/ShareDialog'
import NoAccess from '../../components/common/NoAccess'
import { alertDialog, confirmDialog, promptDialog } from '../../components/common/AppDialog'
import { useToast } from '../../components/common/Toast'
import { api } from '../../hooks/useApi'
import {
  FONTS, LAYOUTS, SLIDE_H, SLIDE_TEMPLATE_LIST, SLIDE_W, applyLayout, imageEl, layoutById, makeSlide, nid, resolveColor, shapeEl, tableEl, textEl, themeCopy,
} from './deckCore'
import SlideView from './SlideView'
import SlideRail from './SlideRail'
import SidePanel from './SidePanel'
import OutlineDialog from './OutlineDialog'
import Present from './Present'
import { ColorButton, DeckColorsContext, Pop, Sep, TB } from './parts'
import { ICONS, ICON_WORDS } from './iconLib'
import {
  aabb, alignEls, applyStacks, cleanPastedHtml, cloneEls, cloneSlide, deckColors, distributeEls, guessEmbed, guidesFor, hitStack, intersects, maxZ,
  measureBetween, pickTop, reorderZ, scaleEls, selectionGap, selectionUnits, smartSnap, snapEdge, tidyEls, toggleListHtml, unionBox,
} from './editorOps'
import { copySelectionAsImage, readExternalClipboard, writeExternalClipboard } from './clipboardInterop'
import { hostnameOf, normalizeDeck, sanitizeEmbedUrl, sanitizeImageSrc, sanitizeRich, sanitizeUrl } from './sanitize'
import { download, exportHwpx, exportPdf, exportPng, rasterizeNode, safeName } from './exporters'
import { SlidesIcon } from '../workspace/icons'
import { createSlideTools } from './aiSlideTools'
import { SLIDE_QUICK_ACTIONS, buildSlideContext, buildSlideSystemPrompt } from './aiSlidePrompts'
import { getKnowledge } from '../../components/ai/knowledge'
import './slides.css'

const SAVE_DELAY = 800
const HIST_MAX = 100
const CLIP = 'dah-slides-clip:' // 예전 복사 형식(읽기만)
const CLIP_MIME = 'application/x-dah-slides+json'
// PPTX 가져오기 모듈(없으면 빈 객체라 빌드가 깨지지 않는다)
const PPTX_IMPORT = import.meta.glob('./pptxImport.js')
import { useMcpRelay } from '../../components/ai/mcpRelay'
// AI 창(공용 AiPanel). 파일이 없으면 빈 객체라 빌드가 깨지지 않고 AI 단추도 숨긴다.
const AI_PANEL = import.meta.glob('../../components/ai/AiPanel.jsx')
const AI_LOADER = Object.values(AI_PANEL)[0]
const AiPanel = AI_LOADER ? lazy(() => AI_LOADER().then((m) => ({ default: m.default || m.AiPanel }))) : null
const AI_OPEN_KEY = 'dah-ai-open:slides'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2]

function isTyping(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
const plainOf = (html) => String(html || '').replace(/<\/(p|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()
const emptyHtml = (html) => !String(html || '').replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

/** 링크 주소: http/https/mailto만 */
function cleanHref(raw) {
  const t = String(raw || '').trim()
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(t)) return t
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(t)) return `mailto:${t}`
  return sanitizeUrl(t)
}
const escText = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** 덱 전체에서 바뀐 슬라이드의 자동 배치를 다시 계산 */
function reflowDeck(next, prev) {
  let changed = false
  const slides = next.slides.map((s, i) => {
    if (!s.stacks || (prev && prev.slides[i] === s)) return s
    const r = applyStacks(s)
    if (r !== s) changed = true
    return r
  })
  return changed ? { ...next, slides } : next
}

function imageSize(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 })
    img.onerror = () => resolve({ w: 800, h: 600 })
    img.src = src
  })
}


const HANDLES = [
  ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0],
]

export default function SlidesEditor() {
  const { id } = useParams()
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [deck, setDeckState] = useState(null)
  const deckRef = useRef(null)
  const [canEdit, setCanEdit] = useState(false)
  const canEditRef = useRef(false)
  const [denied, setDenied] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [cur, setCurState] = useState(0)
  const curRef = useRef(0)
  const [sel, setSelState] = useState([])
  const selRef = useRef([])
  const [editing, setEditingState] = useState(null)
  const editingRef = useRef(null)
  const editHtml = useRef(null)
  const editNode = useRef(null)
  const [saveState, setSaveState] = useState('saved')
  const [, setHistTick] = useState(0)
  const hist = useRef({ undo: [], redo: [] })
  const liveBase = useRef(null)
  const [zoom, setZoom] = useState('fit')
  const [stageSize, setStageSize] = useState({ w: 1000, h: 600 })
  const [guides, setGuides] = useState([])
  const [marquee, setMarquee] = useState(null)
  const [hover, setHover] = useState(null) // { ids, box, rotate }
  const [altDown, setAltDown] = useState(false)
  const [menu, setMenu] = useState(null) // 캔버스 오른쪽 클릭 메뉴 { x, y }
  const [linkPop, setLinkPop] = useState(null) // { href, x, y }
  const scopeRef = useRef(null) // 들어간 묶음 id(두 번 눌러 들어감)
  const editCaret = useRef(null) // 편집 시작 때 커서 자리 { x, y } | 'all'
  const importInput = useRef(null)
  const [tab, setTab] = useState('design')
  const [present, setPresent] = useState(null)
  const [outline, setOutline] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareTick, setShareTick] = useState(0)
  const [job, setJob] = useState(null) // { kind, slides: [index], label, done, total }
  const [notesOpen, setNotesOpen] = useState(true)
  const [aiOpen, setAiOpenState] = useState(() => {
    try {
      return localStorage.getItem(AI_OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const [iconQuery, setIconQuery] = useState('')
  const ShareIcon = useShareIcon(Number(id), shareTick)
  const stage = useRef(null)
  const frame = useRef(null)
  const gesture = useRef(null)
  const saveTimer = useRef(null)
  const saving = useRef(false)
  const pendingSave = useRef(false)
  const imageInput = useRef(null)
  const imageTarget = useRef(null)
  const exportBox = useRef(null)
  const railRef = useRef(null)
  const scaleRef = useRef(0.5)

  const setDeck = useCallback((d) => {
    deckRef.current = d
    setDeckState(d)
  }, [])
  const setCur = useCallback((i) => {
    curRef.current = i
    setCurState(i)
  }, [])
  const setSel = useCallback((s) => {
    selRef.current = s
    setSelState(s)
  }, [])
  const setEditing = useCallback((v) => {
    editingRef.current = v
    setEditingState(v)
  }, [])

  // ── 불러오기 ─────────────────────────────────────────
  useEffect(() => {
    let live = true
    api
      .get(`/workspace/slides/${id}`)
      .then((r) => {
        if (!live) return
        setDeck(normalizeDeck(r.item.content))
        setFile(r.item)
        canEditRef.current = r.canEdit === true
        setCanEdit(r.canEdit === true)
        document.title = `${r.item.title} | 디인예 워크스페이스`
      })
      .catch((e) => {
        if (!live) return
        if (e.status === 401 || e.status === 403) setDenied('denied')
        else if (e.status === 404) setDenied('missing')
        else setLoadError(e.message)
      })
    return () => {
      live = false
    }
  }, [id, setDeck])

  // ── 저장 ─────────────────────────────────────────────
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (!canEditRef.current || !deckRef.current) return
    if (saving.current) {
      pendingSave.current = true
      return
    }
    saving.current = true
    setSaveState('saving')
    try {
      await api.put(`/workspace/slides/${id}`, { content: deckRef.current })
      setSaveState(pendingSave.current || saveTimer.current ? 'dirty' : 'saved')
    } catch (e) {
      setSaveState('error')
      toast(e.status === 413 ? '발표가 너무 커서 저장하지 못했습니다. 큰 이미지는 올리기로 넣어 주세요' : `저장하지 못했습니다: ${e.message}`)
    } finally {
      saving.current = false
      if (pendingSave.current) {
        pendingSave.current = false
        flush()
      }
    }
  }, [id, toast])

  const scheduleSave = useCallback(() => {
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

  // ── 바꾸기 + 실행취소 ─────────────────────────────────
  const pushUndo = useCallback((prev) => {
    const h = hist.current
    h.undo.push(prev)
    if (h.undo.length > HIST_MAX) h.undo.shift()
    h.redo = []
    setHistTick((t) => t + 1)
  }, [])

  const commit = useCallback(
    (next, { record = true, reflow = true } = {}) => {
      if (!canEditRef.current) return
      const prev = deckRef.current
      if (next === prev) return
      if (reflow) next = reflowDeck(next, prev)
      if (record) pushUndo(prev)
      setDeck(next)
      scheduleSave()
    },
    [pushUndo, setDeck, scheduleSave]
  )

  /** 연속 바꾸기(밀대, 색 고르기, 노트 입력): 처음 한 번만 기록 */
  const commitLive = useCallback(
    (next) => {
      if (!liveBase.current) liveBase.current = deckRef.current
      commit(next, { record: false })
    },
    [commit]
  )
  const endLive = useCallback(() => {
    if (liveBase.current && liveBase.current !== deckRef.current) pushUndo(liveBase.current)
    liveBase.current = null
  }, [pushUndo])

  const updateSlideAt = useCallback(
    (i, fn, live = false) => {
      const d = deckRef.current
      if (!d?.slides[i]) return
      const slides = d.slides.slice()
      slides[i] = fn(slides[i])
      const next = { ...d, slides }
      if (live) commitLive(next)
      else commit(next)
    },
    [commit, commitLive]
  )
  const updateSlide = useCallback((fn, live) => updateSlideAt(curRef.current, fn, live), [updateSlideAt])
  const updateEls = useCallback(
    (ids, fn, live) => updateSlide((s) => ({ ...s, elements: s.elements.map((e) => (ids.includes(e.id) ? fn(e) : e)) }), live),
    [updateSlide]
  )
  const updateSel = useCallback((fn, live) => updateEls(selRef.current, fn, live), [updateEls])

  const finishEdit = useCallback(() => {
    const eid = editingRef.current
    if (!eid) return
    const html = editHtml.current
    setEditing(null)
    editHtml.current = null
    editNode.current = null
    if (html === null) return
    const slide = deckRef.current.slides[curRef.current]
    const el = slide?.elements.find((e) => e.id === eid)
    if (!el || el.type !== 'text') return
    const clean = emptyHtml(html) ? '' : sanitizeRich(html)
    if (clean !== (el.data?.html || '')) updateEls([eid], (e) => ({ ...e, data: { ...e.data, html: clean } }))
  }, [setEditing, updateEls])

  const startEdit = useCallback(
    (eid, caret = null) => {
      if (!canEditRef.current) return
      const el = deckRef.current.slides[curRef.current]?.elements.find((e) => e.id === eid)
      if (!el || el.locked || (el.type !== 'text' && el.type !== 'table')) return
      editHtml.current = null
      editCaret.current = caret
      setSel([eid])
      setEditing(eid)
    },
    [setEditing, setSel]
  )

  const goSlide = useCallback(
    (i) => {
      finishEdit()
      const n = deckRef.current.slides.length
      setCur(Math.max(0, Math.min(n - 1, i)))
      setSel([])
      scopeRef.current = null
    },
    [finishEdit, setCur, setSel]
  )

  const undo = useCallback(() => {
    finishEdit()
    const h = hist.current
    if (!h.undo.length || !canEditRef.current) return
    h.redo.push(deckRef.current)
    const prev = h.undo.pop()
    setDeck(prev)
    if (curRef.current >= prev.slides.length) setCur(Math.max(0, prev.slides.length - 1))
    setSel(selRef.current.filter((x) => prev.slides[curRef.current]?.elements.some((e) => e.id === x)))
    scheduleSave()
    setHistTick((t) => t + 1)
  }, [finishEdit, setDeck, setCur, setSel, scheduleSave])
  const redo = useCallback(() => {
    finishEdit()
    const h = hist.current
    if (!h.redo.length || !canEditRef.current) return
    h.undo.push(deckRef.current)
    const next = h.redo.pop()
    setDeck(next)
    if (curRef.current >= next.slides.length) setCur(Math.max(0, next.slides.length - 1))
    scheduleSave()
    setHistTick((t) => t + 1)
  }, [finishEdit, setDeck, setCur, scheduleSave])

  // ── AI 창 ────────────────────────────────────────────
  // 도구는 한 번 만들고, 최신 함수는 aiLatest 로 부른다. 바꾸기는 commit 한 번(실행취소 한 단계)이다.
  const aiLatest = useRef({})
  aiLatest.current = { finishEdit, commit, undo, redo, toast, setCur, setSel }
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
      createSlideTools({
        getDeck: () => deckRef.current,
        getCur: () => curRef.current,
        getSel: () => selRef.current,
        canEdit: () => canEditRef.current,
        apply: (next, { cur: at } = {}) => {
          const L = aiLatest.current
          L.finishEdit()
          const before = deckRef.current
          L.commit(next)
          const after = deckRef.current
          if (after === before) return null
          if (at !== undefined) {
            L.setCur(Math.max(0, Math.min(after.slides.length - 1, at)))
            L.setSel([])
          }
          return { before, after }
        },
        revert: ({ after }) => {
          const L = aiLatest.current
          if (deckRef.current === after && hist.current.undo.length) L.undo()
          else L.toast(`그 뒤에 고친 내용이 있어 ${MOD}Z 로 한 단계씩 되돌려 주세요`)
        },
      }),
    []
  )
  const aiContext = useCallback(() => buildSlideContext({ deck: deckRef.current, cur: curRef.current, sel: selRef.current, canEdit: canEditRef.current }), [])
  const mcpRelay = useMcpRelay({ fileId: file?.id, kind: 'slide', tools: aiTools, canEdit })
  useEffect(() => {
    if (!AiPanel) return undefined
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setAiOpen((v) => !v)
        return
      }
      // 보내기 뒤에는 초점이 AI 입력칸에 있다. 입력칸이 비어 있으면 실행취소·다시 실행은 발표에 적용한다
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z') && e.target?.closest?.('.sl-ai') && (!('value' in e.target) || e.target.value === '')) {
        e.preventDefault()
        if (e.shiftKey) aiLatest.current.redo()
        else aiLatest.current.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setAiOpen])

  // ── 슬라이드 다루기 ───────────────────────────────────
  const addSlide = useCallback(
    (layout = 'title-body', variant = 0) => {
      finishEdit()
      const d = deckRef.current
      const at = d.slides.length ? curRef.current + 1 : 0
      const slides = d.slides.slice()
      slides.splice(at, 0, makeSlide(layout, {}, variant))
      commit({ ...d, slides })
      setCur(at)
      setSel([])
    },
    [commit, finishEdit, setCur, setSel]
  )
  const duplicateSlide = useCallback(
    (i) => {
      const d = deckRef.current
      const slides = d.slides.slice()
      slides.splice(i + 1, 0, cloneSlide(d.slides[i]))
      commit({ ...d, slides })
      setCur(i + 1)
      setSel([])
    },
    [commit, setCur, setSel]
  )
  const deleteSlide = useCallback(
    (i) => {
      finishEdit()
      const d = deckRef.current
      const slides = d.slides.filter((_, k) => k !== i)
      commit({ ...d, slides })
      setCur(Math.max(0, Math.min(i, slides.length - 1)))
      setSel([])
    },
    [commit, finishEdit, setCur, setSel]
  )
  const moveSlide = useCallback(
    (from, to) => {
      const d = deckRef.current
      if (to < 0 || to >= d.slides.length || from === to) return
      const slides = d.slides.slice()
      const [s] = slides.splice(from, 1)
      slides.splice(to, 0, s)
      commit({ ...d, slides })
      setCur(to)
    },
    [commit, setCur]
  )
  const toggleHidden = useCallback((i) => updateSlideAt(i, (s) => ({ ...s, hidden: !s.hidden })), [updateSlideAt])

  // ── 요소 더하기 ───────────────────────────────────────
  const addElements = useCallback(
    (els, { edit = false, stacks } = {}) => {
      const d = deckRef.current
      if (!d.slides.length) {
        const s = makeSlide('blank')
        commit({ ...d, slides: [s] })
        setCur(0)
      }
      const slide = deckRef.current.slides[curRef.current]
      const z = maxZ(slide.elements)
      const placed = els.map((e, i) => ({ ...e, z: z + i + 1 }))
      updateSlide((s) => ({ ...s, elements: [...s.elements, ...placed], ...(stacks && Object.keys(stacks).length ? { stacks: { ...(s.stacks || {}), ...stacks } } : {}) }))
      setSel(placed.map((e) => e.id))
      scopeRef.current = null
      setTab('format')
      if (edit && placed.length === 1) {
        editHtml.current = null
        setEditing(placed[0].id)
      }
    },
    [commit, setCur, updateSlide, setSel, setEditing]
  )

  const addText = useCallback(() => {
    finishEdit()
    const el = textEl(undefined, [560, 440, 800, 80], { size: 44, sizing: 'auto-h' }, { placeholder: '텍스트 입력' })
    addElements([el], { edit: true })
  }, [addElements, finishEdit])

  const addShape = useCallback(
    (shape) => {
      finishEdit()
      const box = shape === 'line' ? [660, 528, 600, 24] : shape === 'arrow' ? [660, 440, 600, 200] : [710, 390, 500, 300]
      const style = shape === 'line' ? { fill: null, stroke: '@text', strokeWidth: 6 } : { fill: '@accent', stroke: null, strokeWidth: 0, radius: shape === 'rounded' ? 40 : 0 }
      addElements([shapeEl(shape, box, style)])
    },
    [addElements, finishEdit]
  )

  const addIcon = useCallback(
    (name) => {
      finishEdit()
      const el = shapeEl('icon', [860, 440, 200, 200], { fill: null, color: '@accent', strokeWidth: 2 })
      el.data.icon = name
      addElements([el])
    },
    [addElements, finishEdit]
  )

  const addTable = useCallback(() => {
    finishEdit()
    addElements([tableEl([['열 1', '열 2', '열 3'], ['', '', ''], ['', '', '']], [360, 340, 1200, 400])])
  }, [addElements, finishEdit])

  const upload = useCallback(
    async (f) => {
      try {
        const r = await api.upload(f, { usage: 'general' })
        const url = sanitizeImageSrc(r.url)
        if (!url) throw new Error('주소가 올바르지 않습니다')
        return url
      } catch (e) {
        toast(`이미지를 올리지 못했습니다: ${e.message}`)
        return null
      }
    },
    [toast]
  )

  const addImages = useCallback(
    async (files, at) => {
      const list = [...(files || [])].filter((f) => f.type.startsWith('image/'))
      if (!list.length) return
      toast(list.length > 1 ? `이미지 ${list.length}장을 올리는 중` : '이미지를 올리는 중')
      const target = imageTarget.current
      imageTarget.current = null
      const els = []
      for (const f of list) {
        const url = await upload(f)
        if (!url) continue
        if (target && els.length === 0) {
          updateSlide((s) => ({ ...s, elements: s.elements.map((e) => (e.id === target ? { ...e, data: { ...e.data, src: url } } : e)) }))
          continue
        }
        const { w, h } = await imageSize(url)
        const k = Math.min(1200 / w, 760 / h, 1)
        const ew = Math.round(w * k)
        const eh = Math.round(h * k)
        const cx = at ? at.x : SLIDE_W / 2
        const cy = at ? at.y : SLIDE_H / 2
        const n = els.length * 40
        els.push(imageEl([Math.round(cx - ew / 2 + n), Math.round(cy - eh / 2 + n), ew, eh], { src: url, alt: f.name.replace(/\.[^.]+$/, '').slice(0, 120), placeholder: '' }))
      }
      if (els.length) addElements(els)
    },
    [addElements, toast, upload, updateSlide]
  )

  const addEmbed = useCallback(
    async (raw, at) => {
      const url = sanitizeUrl(raw)
      if (!url) {
        toast('http 또는 https 주소만 넣을 수 있습니다')
        return
      }
      const guess = guessEmbed(url) || {}
      let info = {}
      try {
        info = (await api.get('/integrations/unfurl', { url })) || {}
      } catch {
        info = {}
      }
      const data = {
        url,
        title: String(info.title || guess.siteName || hostnameOf(url)).slice(0, 300),
        description: String(info.description || '').slice(0, 400),
        image: sanitizeImageSrc(info.image || guess.image || ''),
        siteName: String(info.siteName || guess.siteName || hostnameOf(url)).slice(0, 100),
        kind: ['figma', 'notion', 'youtube', 'link'].includes(info.kind) ? info.kind : guess.kind || 'link',
        embedUrl: sanitizeEmbedUrl(info.embedUrl || guess.embedUrl || ''),
      }
      const [w, h] = data.embedUrl ? [1120, 630] : data.image ? [1040, 340] : [900, 220]
      const cx = at ? at.x : SLIDE_W / 2
      const cy = at ? at.y : SLIDE_H / 2
      const el = { id: nid('e'), type: 'embed', x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, rotate: 0, z: 0, locked: false, style: {}, data }
      addElements([el])
    },
    [addElements, toast]
  )

  const askEmbed = useCallback(async () => {
    finishEdit()
    const url = await promptDialog({ title: '링크 카드', label: '주소 (피그마, 유튜브, 노션, 웹 페이지)', placeholder: 'https://' })
    if (url) addEmbed(url)
  }, [addEmbed, finishEdit])

  // ── 선택한 요소 다루기 ─────────────────────────────────
  const deleteSel = useCallback(() => {
    const ids = selRef.current
    if (!ids.length) return
    updateSlide((s) => ({ ...s, elements: s.elements.filter((e) => !ids.includes(e.id) || e.locked) }))
    setSel([])
  }, [updateSlide, setSel])

  const selElsNow = () => {
    const s = deckRef.current?.slides[curRef.current]
    return s ? s.elements.filter((e) => selRef.current.includes(e.id)) : []
  }

  const duplicateSel = useCallback(() => {
    const els = selElsNow()
    if (!els.length) return
    const copies = cloneEls(els, 30, 30)
    addElements(copies)
  }, [addElements])

  const pasteEls = useCallback(
    (list, { stacks, center = false } = {}) => {
      const extra = new Map((Array.isArray(list) ? list : []).map((e) => [e?.id, e]))
      // normalizeDeck이 모르는 칸(이름, 숨김)은 다시 붙인다
      const clean = normalizeDeck({ slides: [{ id: 'p', elements: list }] }).slides[0].elements.map((e) => {
        const o = extra.get(e.id) || {}
        return { ...e, name: typeof o.name === 'string' ? o.name.slice(0, 80) : e.name, hidden: o.hidden === true ? true : e.hidden }
      })
      if (!clean.length) return
      const slide = deckRef.current.slides[curRef.current]
      const u = unionBox(clean)
      const fits = u.x >= -20 && u.y >= -20 && u.x + u.w <= SLIDE_W + 20 && u.y + u.h <= SLIDE_H + 20
      const same = slide && clean.every((c) => slide.elements.some((e) => e.x === c.x && e.y === c.y))
      const dx = center || !fits ? Math.round(SLIDE_W / 2 - (u.x + u.w / 2)) : same ? 30 : 0
      const dy = center || !fits ? Math.round(SLIDE_H / 2 - (u.y + u.h / 2)) : same ? 30 : 0
      const copies = cloneEls(clean, dx, dy)
      let newStacks
      if (stacks && typeof stacks === 'object') {
        newStacks = {}
        clean.forEach((c, i) => {
          const cfg = c.group && stacks[c.group]
          if (cfg && typeof cfg === 'object' && !newStacks[copies[i].group]) {
            const fi = cfg.frame ? clean.findIndex((x) => x.id === cfg.frame) : -1
            newStacks[copies[i].group] = { dir: cfg.dir === 'column' ? 'column' : 'row', gap: Number(cfg.gap) || 0, pad: Number(cfg.pad) || 0, align: ['center', 'end'].includes(cfg.align) ? cfg.align : 'start', ...(fi >= 0 ? { frame: copies[fi].id } : {}) }
          }
        })
      }
      addElements(copies, { stacks: newStacks })
    },
    [addElements]
  )

  const align = useCallback((how) => updateSlide((s) => ({ ...s, elements: alignEls(s.elements, selRef.current, how) })), [updateSlide])
  const distribute = useCallback((axis) => updateSlide((s) => ({ ...s, elements: distributeEls(s.elements, selRef.current, axis) })), [updateSlide])
  const layer = useCallback((how) => updateSlide((s) => ({ ...s, elements: reorderZ(s.elements, selRef.current, how) })), [updateSlide])
  const group = useCallback(() => {
    if (selRef.current.length < 2) return
    const g = nid('g')
    updateSel((e) => ({ ...e, group: g }))
  }, [updateSel])
  const ungroup = useCallback(() => updateSel((e) => ({ ...e, group: undefined })), [updateSel])
  const toggleLock = useCallback(() => {
    const all = selElsNow().every((e) => e.locked)
    updateSel((e) => ({ ...e, locked: !all }))
  }, [updateSel])
  const setAnim = useCallback(
    (type) => {
      const slide = deckRef.current.slides[curRef.current]
      const top = slide.elements.reduce((m, e) => Math.max(m, e.anim?.order || 0), 0)
      let n = top
      updateSel((e) => {
        if (!type) return { ...e, anim: undefined }
        if (e.anim) return { ...e, anim: { ...e.anim, type } }
        n += 1
        return { ...e, anim: { type, order: n } }
      })
    },
    [updateSel]
  )

  const applyLayoutNow = useCallback(
    (layout, variant) => {
      finishEdit()
      updateSlide((s) => applyLayout(s, layout, variant))
      setSel([])
    },
    [finishEdit, updateSlide, setSel]
  )
  const nextDesign = useCallback(() => {
    const s = deckRef.current.slides[curRef.current]
    if (!s) return
    const L = layoutById(s.layout)
    applyLayoutNow(L.id, ((s.variant || 0) + 1) % L.variants.length)
  }, [applyLayoutNow])

  const setTheme = useCallback(
    (theme, live) => {
      const next = { ...deckRef.current, theme }
      if (live) commitLive(next)
      else commit(next)
    },
    [commit, commitLive]
  )

  // ── 정렬 막대·변형·자동 배치·레이어 ──────────────────────
  const curEls = () => deckRef.current.slides[curRef.current]?.elements || []
  const tidy = useCallback(() => updateSlide((s) => ({ ...s, elements: tidyEls(s.elements, selRef.current) })), [updateSlide])
  const setGap = useCallback(
    (v, live) => {
      const info = selectionGap(curEls(), selRef.current)
      if (!info.axis) return
      updateSlide((s) => ({ ...s, elements: distributeEls(s.elements, selRef.current, info.axis, v) }), live)
    },
    [updateSlide]
  )
  /** 숫자 칸으로 위치·크기 바꾸기. 여럿이면 선택 범위 기준 */
  const setBox = useCallback(
    (patch, live) => {
      const els = selElsNow().filter((x) => !x.locked)
      if (!els.length) return
      if (els.length === 1) {
        const el = els[0]
        const next = { ...patch }
        if (el.style?.lockRatio && el.w && el.h) {
          if ('w' in patch) next.h = Math.round((patch.w * el.h) / el.w)
          if ('h' in patch) next.w = Math.round((patch.h * el.w) / el.h)
        }
        let style = el.style
        if (el.type === 'text' && el.style?.sizing && el.style.sizing !== 'fixed') {
          if ('h' in patch) style = { ...el.style, sizing: 'fixed' }
          else if ('w' in patch && el.style.sizing === 'auto-w') style = { ...el.style, sizing: 'auto-h' }
        }
        updateEls([el.id], (x) => ({ ...x, ...next, style }), live)
        return
      }
      const from = unionBox(els)
      const to = { ...from, ...patch }
      if (els.every((x) => x.style?.lockRatio)) {
        if ('w' in patch) to.h = (patch.w * from.h) / from.w
        if ('h' in patch) to.w = (patch.h * from.w) / from.h
      }
      const moved = 'x' in patch || 'y' in patch
      const out = moved
        ? els.map((x) => ({ ...x, x: Math.round(x.x + (to.x - from.x)), y: Math.round(x.y + (to.y - from.y)) }))
        : scaleEls(els, from, { ...to, w: Math.max(4, to.w), h: Math.max(4, to.h) })
      const map = new Map(out.map((x) => [x.id, x]))
      updateSlide((s) => ({ ...s, elements: s.elements.map((x) => map.get(x.id) || x) }), live)
    },
    [updateEls, updateSlide]
  )
  const stackGroupOfSel = () => {
    const els = selElsNow()
    const g = els[0]?.group
    return g && els.every((x) => x.group === g) ? g : null
  }
  const makeStack = useCallback(() => {
    finishEdit()
    const slide = deckRef.current.slides[curRef.current]
    const ids = selRef.current
    const sel = slide.elements.filter((x) => ids.includes(x.id) && !x.hidden)
    if (!sel.length) return
    const whole = stackGroupOfSel()
    const fullGroup = whole && slide.elements.filter((x) => x.group === whole).every((x) => ids.includes(x.id))
    if (fullGroup && slide.stacks?.[whole]) return
    const gid = fullGroup ? whole : nid('g')
    const inBox = (o, i) => i.x >= o.x - 1 && i.y >= o.y - 1 && i.x + i.w <= o.x + o.w + 1 && i.y + i.h <= o.y + o.h + 1
    const frameEl = sel.length > 1 ? sel.find((x) => x.type === 'shape' && ['rect', 'rounded', 'ellipse'].includes(x.data?.shape) && inBox(aabb(x), unionBox(sel.filter((y) => y !== x)))) : null
    const kids = sel.filter((x) => x !== frameEl)
    const info = selectionGap(kids.map((x) => ({ ...x, group: undefined })), kids.map((x) => x.id))
    const dir = info.axis === 'y' ? 'column' : 'row'
    let gap = info.gap
    if (gap === null || gap === undefined) {
      const k = dir === 'row' ? 'x' : 'y'
      const sz = dir === 'row' ? 'w' : 'h'
      const st = [...kids].map(aabb).sort((a, b) => a[k] - b[k])
      let t = 0
      for (let i = 1; i < st.length; i++) t += Math.max(0, st[i][k] - (st[i - 1][k] + st[i - 1][sz]))
      gap = st.length > 1 ? Math.round(t / (st.length - 1)) : 24
    }
    gap = Math.max(0, gap)
    let pad = 0
    if (frameEl) {
      const u = unionBox(kids)
      pad = Math.max(0, Math.round(Math.min(u.x - frameEl.x, u.y - frameEl.y, frameEl.x + frameEl.w - u.x - u.w, frameEl.y + frameEl.h - u.y - u.h)))
    }
    const minZ = Math.min(...kids.map((x) => x.z || 0))
    updateSlide((s) => ({
      ...s,
      stacks: { ...(s.stacks || {}), [gid]: { dir, gap, pad, align: 'start', ...(frameEl ? { frame: frameEl.id } : {}) } },
      elements: s.elements.map((x) => (ids.includes(x.id) && !x.hidden ? { ...x, group: gid, ...(frameEl && x.id === frameEl.id ? { z: minZ - 1 } : {}) } : x)),
    }))
    scopeRef.current = null
    setSel(sel.map((x) => x.id))
    setTab('format')
    toast('자동 배치를 만들었습니다')
  }, [finishEdit, updateSlide, setSel, toast])
  const removeStack = useCallback(() => {
    const g = stackGroupOfSel()
    if (!g) return
    updateSlide((s) => {
      const stacks = { ...(s.stacks || {}) }
      delete stacks[g]
      return { ...s, stacks: Object.keys(stacks).length ? stacks : undefined }
    })
  }, [updateSlide])
  const setStack = useCallback(
    (patch, live) => {
      const g = stackGroupOfSel()
      if (!g) return
      updateSlide((s) => (s.stacks?.[g] ? { ...s, stacks: { ...s.stacks, [g]: { ...s.stacks[g], ...patch } } } : s), live)
    },
    [updateSlide]
  )
  const selectIds = useCallback(
    (ids, additive, deep) => {
      finishEdit()
      const els = curEls().filter((x) => ids.includes(x.id))
      if (deep && els.length === 1 && els[0].group) scopeRef.current = els[0].group
      else if (!deep) scopeRef.current = null
      setSel(additive ? [...new Set([...selRef.current.filter((x) => !ids.includes(x)), ...(ids.every((x) => selRef.current.includes(x)) ? [] : ids)])] : ids)
    },
    [finishEdit, setSel]
  )
  const reorderLayers = useCallback(
    (ids, targetId, pos, groupTarget, whole) => {
      updateSlide((s) => {
        const sorted = [...s.elements].sort((a, b) => (a.z || 0) - (b.z || 0))
        const moving = sorted.filter((e) => ids.includes(e.id))
        const rest = sorted.filter((e) => !ids.includes(e.id))
        let idx
        const members = rest.filter((e) => e.group === targetId)
        if (members.length) idx = pos === 'above' ? rest.indexOf(members[members.length - 1]) + 1 : rest.indexOf(members[0])
        else {
          const t = rest.findIndex((e) => e.id === targetId)
          if (t < 0) return s
          idx = pos === 'above' ? t + 1 : t
        }
        const moved = whole ? moving : moving.map((e) => ({ ...e, group: groupTarget || undefined }))
        rest.splice(idx, 0, ...moved)
        const z = new Map(rest.map((e, i) => [e.id, i + 1]))
        const byId = new Map(moved.map((e) => [e.id, e]))
        return { ...s, elements: s.elements.map((e) => ({ ...(byId.get(e.id) || e), z: z.get(e.id) })) }
      })
    },
    [updateSlide]
  )
  const toggleElHidden = useCallback(
    (eid) => {
      updateEls([eid], (x) => ({ ...x, hidden: x.hidden ? undefined : true }))
      setSel(selRef.current.filter((x) => x !== eid))
    },
    [updateEls, setSel]
  )
  const toggleElLock = useCallback((eid) => updateEls([eid], (x) => ({ ...x, locked: !x.locked })), [updateEls])
  const renameEl = useCallback((eid, name) => updateEls([eid], (x) => ({ ...x, name: name ? name.slice(0, 80) : undefined })), [updateEls])

  // ── 링크(⌘K) ─────────────────────────────────────────
  const anchorAtCaret = () => {
    const node = editNode.current
    const sel = window.getSelection()
    if (!node || !sel?.rangeCount) return null
    let n = sel.anchorNode
    while (n && n !== node) {
      if (n.nodeType === 1 && n.tagName === 'A') return n
      n = n.parentNode
    }
    return null
  }
  const editLink = useCallback(async () => {
    if (editingRef.current && editNode.current) {
      const node = editNode.current
      const sel = window.getSelection()
      const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null
      const a = anchorAtCaret()
      const raw = await promptDialog({ title: a ? '링크 수정' : '링크 넣기', label: '주소 (비우면 링크를 지웁니다)', defaultValue: a?.getAttribute('href') || '', placeholder: 'https://' })
      if (raw === null || !editNode.current) return
      node.focus()
      if (range) {
        sel.removeAllRanges()
        sel.addRange(range)
      }
      const href = cleanHref(raw)
      if (a) {
        if (!raw.trim()) {
          const r = document.createRange()
          r.selectNodeContents(a)
          sel.removeAllRanges()
          sel.addRange(r)
          document.execCommand('unlink')
        } else if (href) a.setAttribute('href', href)
      } else if (href) {
        if (!range || range.collapsed) document.execCommand('insertHTML', false, `<a href="${escText(href)}">${escText(raw.trim())}</a>`)
        else document.execCommand('createLink', false, href)
      } else if (raw.trim()) toast('http, https, mailto 주소만 넣을 수 있습니다')
      editHtml.current = node.innerHTML
      setLinkPop(null)
      return
    }
    const el = selElsNow()[0]
    if (!el || el.type !== 'text' || selRef.current.length !== 1) return
    const raw = await promptDialog({ title: '상자 전체에 링크', label: '주소', placeholder: 'https://' })
    if (raw === null) return
    const href = cleanHref(raw)
    if (!href) return toast('http, https, mailto 주소만 넣을 수 있습니다')
    const doc = new DOMParser().parseFromString(`<body>${el.data?.html || ''}</body>`, 'text/html')
    doc.querySelectorAll('a').forEach((x) => x.replaceWith(...x.childNodes))
    const targets = doc.body.querySelectorAll('p, li')
    for (const t of targets.length ? targets : [doc.body]) {
      const a = doc.createElement('a')
      a.setAttribute('href', href)
      while (t.firstChild) a.appendChild(t.firstChild)
      t.appendChild(a)
    }
    updateEls([el.id], (x) => ({ ...x, data: { ...x.data, html: sanitizeRich(doc.body.innerHTML) } }))
  }, [toast, updateEls])

  // 편집 중 커서가 링크 안에 있으면 작은 상자(열기·수정·삭제)
  useEffect(() => {
    if (!editing) {
      setLinkPop(null)
      return undefined
    }
    const onSel = () => {
      const a = anchorAtCaret()
      if (!a) return setLinkPop(null)
      const r = a.getBoundingClientRect()
      setLinkPop({ href: a.getAttribute('href') || '', x: r.left, y: r.bottom + 6 })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [editing])
  const unlinkAtCaret = () => {
    const a = anchorAtCaret()
    if (!a) return
    const sel = window.getSelection()
    const r = document.createRange()
    r.selectNodeContents(a)
    sel.removeAllRanges()
    sel.addRange(r)
    document.execCommand('unlink')
    sel.collapseToEnd()
    if (editNode.current) editHtml.current = editNode.current.innerHTML
    setLinkPop(null)
  }

  // ── 이미지로 복사, PPTX 가져오기 ─────────────────────────
  const copyAsImage = useCallback(async () => {
    const els = selElsNow()
    const d = deckRef.current
    const node = frame.current?.querySelector('.sl-slide')
    try {
      const ok = await copySelectionAsImage({ elements: els, slide: d.slides[curRef.current], deck: d, node })
      toast(ok ? '이미지로 복사했습니다' : '이미지로 복사하지 못했습니다')
    } catch (e) {
      toast(`이미지로 복사하지 못했습니다: ${e.message}`)
    }
  }, [toast])
  const importPptxFile = useCallback(
    async (f) => {
      if (!f) return
      const loader = PPTX_IMPORT['./pptxImport.js']
      if (!loader) return toast('PPTX 가져오기를 아직 쓸 수 없습니다')
      finishEdit()
      toast('PPTX를 읽는 중')
      try {
        const { importPptx, bakeThemeColors, skippedSummary } = await loader()
        const uploadImage = async (blob, name) => {
          const r = await api.upload(new File([blob], name || 'image.png', { type: blob.type || 'image/png' }), { usage: 'general' })
          return sanitizeImageSrc(r.url)
        }
        const res = await importPptx(f, { uploadImage })
        const got = normalizeDeck({ theme: res.theme || deckRef.current.theme, slides: res.slides || [] })
        if (!got.slides.length) return toast('가져올 슬라이드가 없습니다')
        const d = deckRef.current
        let mode = 'replace'
        if (d.slides.length) {
          const append = await confirmDialog({ title: 'PPTX 가져오기', message: `슬라이드 ${got.slides.length}장을 읽었습니다. 지금 발표 뒤에 붙일까요?`, confirmLabel: '뒤에 붙이기', cancelLabel: '다른 방법' })
          if (append) mode = 'append'
          else if (!(await confirmDialog({ title: 'PPTX 가져오기', message: '지금 슬라이드를 모두 가져온 슬라이드로 바꿀까요?', confirmLabel: '모두 바꾸기' }))) return
        }
        const cur = deckRef.current
        if (mode === 'append') {
          // 뒤에 붙일 때는 원본 테마 색을 실제 색으로 고정해 지금 테마에 끌려가지 않게 한다
          const baked = res.theme && bakeThemeColors ? normalizeDeck({ theme: cur.theme, slides: bakeThemeColors(res.slides || [], res.theme) }).slides : got.slides
          commit({ ...cur, slides: [...cur.slides, ...baked].slice(0, 300) })
          setCur(cur.slides.length)
        } else {
          commit({ ...cur, theme: res.theme ? got.theme : cur.theme, slides: got.slides })
          setCur(0)
        }
        setSel([])
        toast(`슬라이드 ${got.slides.length}장을 가져왔습니다${res.skipped && skippedSummary ? (skippedSummary(res.skipped) ? `. ${skippedSummary(res.skipped)}` : '') : ''}`)
      } catch (e) {
        toast(`가져오지 못했습니다: ${e.message}`)
      }
    },
    [commit, finishEdit, setCur, setSel, toast]
  )

  // ── 글 서식 ──────────────────────────────────────────
  const exec = useCallback((cmd, arg) => {
    document.execCommand('styleWithCSS', false, true)
    document.execCommand(cmd, false, arg)
    if (editNode.current) editHtml.current = editNode.current.innerHTML
  }, [])
  const textToggle = useCallback(
    (flag, cmd) => {
      if (editingRef.current) {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && editNode.current?.contains(sel.anchorNode)) return exec(cmd)
      }
      const all = selElsNow().every((e) => e.style?.[flag])
      updateSel((e) => (e.type === 'text' ? { ...e, style: { ...e.style, [flag]: !all } } : e))
    },
    [exec, updateSel]
  )
  const textColor = useCallback(
    (v) => {
      if (editingRef.current) {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && editNode.current?.contains(sel.anchorNode)) return exec('foreColor', resolveColor(v || '@text', deckRef.current.theme))
      }
      updateSel((e) => (e.type === 'text' ? { ...e, style: { ...e.style, color: v || '@text' } } : e))
    },
    [exec, updateSel]
  )
  const textList = useCallback(
    (kind) => {
      if (editingRef.current && editNode.current) return exec(kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList')
      updateSel((e) => (e.type === 'text' ? { ...e, data: { ...e.data, html: sanitizeRich(toggleListHtml(e.data?.html || '', kind)) } } : e))
    },
    [exec, updateSel]
  )
  const setTextStyle = useCallback((patch) => updateSel((e) => (e.type === 'text' || e.type === 'table' ? { ...e, style: { ...e.style, ...patch } } : e)), [updateSel])

  const tableOp = useCallback(
    (op) => {
      updateSel((e) => {
        if (e.type !== 'table') return e
        let rows = e.data.rows.map((r) => r.slice())
        const cols = Math.max(...rows.map((r) => r.length))
        if (op === 'addRow' && rows.length < 60) rows.push(Array(cols).fill(''))
        if (op === 'delRow' && rows.length > 1) rows.pop()
        if (op === 'addCol' && cols < 30) rows = rows.map((r) => [...r, ''])
        if (op === 'delCol' && cols > 1) rows = rows.map((r) => r.slice(0, cols - 1))
        const rh = e.h / Math.max(1, e.data.rows.length)
        return { ...e, h: op === 'addRow' ? e.h + rh : op === 'delRow' && rows.length < e.data.rows.length ? Math.max(40, e.h - rh) : e.h, data: { ...e.data, rows } }
      })
    },
    [updateSel]
  )
  const onCell = useCallback(
    (eid) => (ri, ci, text) => {
      const slide = deckRef.current.slides[curRef.current]
      const el = slide?.elements.find((e) => e.id === eid)
      if (!el || el.data.rows[ri]?.[ci] === text) return
      updateEls([eid], (e) => ({ ...e, data: { ...e.data, rows: e.data.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? text.slice(0, 2000) : c)) : r)) } }))
    },
    [updateEls]
  )

  // ── 화면 배율 ─────────────────────────────────────────
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      setStageSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [deck !== null, present]) // eslint-disable-line react-hooks/exhaustive-deps
  const fitScale = Math.max(0.05, Math.min((stageSize.w - 64) / SLIDE_W, (stageSize.h - 64) / SLIDE_H))
  const scale = zoom === 'fit' ? fitScale : zoom
  scaleRef.current = scale
  const zoomStep = (dir) => {
    const s = scaleRef.current
    const next = dir > 0 ? ZOOMS.find((z) => z > s + 0.001) || ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find((z) => z < s - 0.001) || ZOOMS[0]
    setZoom(next)
  }

  const toSlide = (e) => {
    const r = frame.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scaleRef.current, y: (e.clientY - r.top) / scaleRef.current }
  }

  /** 클릭한 요소의 선택 단위: 묶음이면 묶음 전체(들어간 묶음이거나 깊게 고르면 요소 하나) */
  const unitOf = (el, deep) => {
    const slide = deckRef.current.slides[curRef.current]
    if (!el.group || deep || scopeRef.current === el.group) return [el.id]
    return slide.elements.filter((x) => x.group === el.group && !x.hidden).map((x) => x.id)
  }
  const hitAt = (p) => {
    const slide = deckRef.current.slides[curRef.current]
    return hitStack(slide.elements.filter((x) => !x.locked), p)
  }

  // ── 끌기: 옮기기, 크기, 회전, 범위 선택 ───────────────────
  const onStageDown = (e) => {
    if (e.button !== 0 || !deckRef.current?.slides.length) return
    setMenu(null)
    const slide = deckRef.current.slides[curRef.current]
    if (e.target.closest('.sl-handle, .sl-rot, .sl-linkpop')) return
    if (editingRef.current) {
      if (e.target.closest(`[data-el="${editingRef.current}"]`)) return
      finishEdit()
    }
    if (!canEditRef.current || !frame.current) return
    stage.current.focus({ preventScroll: true })
    const p = toSlide(e)
    const stack = e.target.closest('.sl-canvas__frame') ? hitAt(p) : []
    const deep = e.metaKey || e.ctrlKey
    let el = null
    if (e.altKey && stack.length) {
      // Alt: 겹친 요소를 차례로 고른다
      const curIdx = stack.findIndex((x) => selRef.current.length === 1 && selRef.current[0] === x.id)
      el = stack[(curIdx + 1) % stack.length]
      setSel([el.id])
      scopeRef.current = el.group || null
      setHover(null)
      e.preventDefault()
      return
    }
    if (stack.length) el = (!e.shiftKey && !deep && stack.find((x) => selRef.current.includes(x.id))) || pickTop(stack)
    if (el) {
      if (scopeRef.current && el.group !== scopeRef.current && !deep) scopeRef.current = null
      if (deep && el.group) scopeRef.current = el.group
      const ids = unitOf(el, deep)
      const was = ids.every((x) => selRef.current.includes(x))
      const wasOnly = selRef.current.length === 1 && selRef.current[0] === el.id
      let next
      if (e.shiftKey) next = was ? selRef.current.filter((x) => !ids.includes(x)) : [...new Set([...selRef.current, ...ids])]
      else next = was && !deep ? selRef.current : ids
      setSel(next)
      if (tab === 'layout' || tab === 'design') setTab('format')
      const movable = slide.elements.filter((x) => next.includes(x.id) && !x.locked)
      if (!movable.length || (e.shiftKey && was)) {
        stage.current.setPointerCapture(e.pointerId)
        gesture.current = { type: 'none' }
        return
      }
      const moving = new Set(movable.map((x) => x.id))
      gesture.current = {
        type: 'move', start: p, base: deckRef.current, moved: false, wasOnly: wasOnly && !e.shiftKey && !deep, target: el, client: { x: e.clientX, y: e.clientY },
        orig: new Map(movable.map((x) => [x.id, { x: x.x, y: x.y }])), box: unionBox(movable), others: slide.elements.filter((x) => !moving.has(x.id) && !x.hidden).map(aabb),
      }
    } else {
      scopeRef.current = null
      gesture.current = { type: 'marquee', start: p, additive: e.shiftKey ? selRef.current : [] }
      if (!e.shiftKey) setSel([])
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 })
    }
    setHover(null)
    stage.current.setPointerCapture(e.pointerId)
  }

  const startHandle = (e, kind, dir) => {
    e.stopPropagation()
    e.preventDefault()
    const els = selElsNow().filter((x) => !x.locked)
    if (!els.length) return
    const slide = deckRef.current.slides[curRef.current]
    const ids = new Set(els.map((x) => x.id))
    const others = slide.elements.filter((x) => !ids.has(x.id) && !x.hidden)
    if (kind === 'resize' && els.length > 1) {
      gesture.current = { type: 'resize-multi', start: toSlide(e), base: deckRef.current, els: els.map((x) => ({ ...x })), box: unionBox(els), dir, others, moved: false }
    } else {
      gesture.current = { type: kind, start: toSlide(e), base: deckRef.current, el: { ...els[0] }, dir, others, moved: false }
    }
    stage.current.setPointerCapture(e.pointerId)
  }

  /** 지금 가리키는 요소(덩어리) 테두리 */
  const updateHover = (e) => {
    if (!frame.current || !deckRef.current?.slides.length || e.buttons) return
    const p = toSlide(e)
    const inFrame = e.target.closest?.('.sl-canvas__frame')
    const top = inFrame ? pickTop(hitAt(p)) : null
    if (!top) {
      if (hover) setHover(null)
      return
    }
    const ids = unitOf(top, e.metaKey || e.ctrlKey)
    const slide = deckRef.current.slides[curRef.current]
    const els = slide.elements.filter((x) => ids.includes(x.id))
    const h = ids.length === 1 ? { ids, box: { x: top.x, y: top.y, w: top.w, h: top.h }, rotate: top.rotate || 0, aabb: aabb(top) } : { ids, box: unionBox(els), rotate: 0, aabb: unionBox(els) }
    if (!hover || hover.ids.join() !== h.ids.join() || hover.box.x !== h.box.x || hover.box.y !== h.box.y || hover.box.w !== h.box.w || hover.box.h !== h.box.h) setHover(h)
  }

  const replaceSlideEls = (g, map) => {
    const base = g.base.slides[curRef.current]
    const slides = g.base.slides.slice()
    slides[curRef.current] = { ...base, elements: base.elements.map((x) => map(x) || x) }
    return { ...deckRef.current, slides }
  }

  const onStageMove = (e) => {
    const g = gesture.current
    if (!g) {
      updateHover(e)
      return
    }
    if (g.type === 'none') return
    const p = toSlide(e)
    const s = scaleRef.current
    const noSnap = e.metaKey || e.ctrlKey
    if (g.type === 'marquee') {
      const r = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) }
      setMarquee(r)
      const slide = deckRef.current.slides[curRef.current]
      const live = slide.elements.filter((x) => !x.locked && !x.hidden)
      const hit = live.filter((x) => intersects(aabb(x), r)).map((x) => x.id)
      const groups = new Set(live.filter((x) => hit.includes(x.id) && x.group).map((x) => x.group))
      const withGroups = live.filter((x) => hit.includes(x.id) || (x.group && groups.has(x.group))).map((x) => x.id)
      setSel(r.w > 2 || r.h > 2 ? [...new Set([...g.additive, ...withGroups])] : g.additive)
      return
    }
    let dx = p.x - g.start.x
    let dy = p.y - g.start.y
    if (!g.moved && Math.hypot(dx, dy) * s < 3) return
    g.moved = true
    if (g.type === 'move') {
      let lockAxis = null
      if (e.shiftKey) {
        lockAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (lockAxis === 'x') dy = 0
        else dx = 0
      }
      const sn = smartSnap({ ...g.box, x: g.box.x + dx, y: g.box.y + dy }, g.others, 6 / s, { snap: !noSnap })
      if (lockAxis !== 'y') dx += sn.dx
      if (lockAxis !== 'x') dy += sn.dy
      setGuides(sn.guides)
      const next = replaceSlideEls(g, (x) => (g.orig.has(x.id) ? { ...x, x: Math.round(g.orig.get(x.id).x + dx), y: Math.round(g.orig.get(x.id).y + dy) } : null))
      commit(next, { record: false, reflow: false })
      return
    }
    if (g.type === 'resize-multi') {
      const [sx, sy] = g.dir
      const b = g.box
      let x1 = b.x
      let y1 = b.y
      let x2 = b.x + b.w
      let y2 = b.y + b.h
      const t = 6 / s
      if (sx < 0) x1 += dx
      if (sx > 0) x2 += dx
      if (sy < 0) y1 += dy
      if (sy > 0) y2 += dy
      if (e.altKey) {
        if (sx < 0) x2 = b.x + b.w - (x1 - b.x)
        if (sx > 0) x1 = b.x - (x2 - b.x - b.w)
        if (sy < 0) y2 = b.y + b.h - (y1 - b.y)
        if (sy > 0) y1 = b.y - (y2 - b.y - b.h)
      }
      if (!noSnap && !e.altKey) {
        if (sx) {
          const v = sx < 0 ? x1 : x2
          const hit = snapEdge(v, 'x', g.others, t)
          if (hit !== null && sx < 0) x1 = hit
          else if (hit !== null) x2 = hit
        }
        if (sy) {
          const v = sy < 0 ? y1 : y2
          const hit = snapEdge(v, 'y', g.others, t)
          if (hit !== null && sy < 0) y1 = hit
          else if (hit !== null) y2 = hit
        }
      }
      let nb = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(4, Math.abs(x2 - x1)), h: Math.max(4, Math.abs(y2 - y1)) }
      const keep = (sx && sy && e.shiftKey) || g.els.every((x) => x.style?.lockRatio)
      if (keep) {
        const k = sx && sy ? Math.max(nb.w / b.w, nb.h / b.h) : sx ? nb.w / b.w : nb.h / b.h
        const w = b.w * k
        const h = b.h * k
        nb = { x: e.altKey ? b.x + b.w / 2 - w / 2 : sx < 0 ? b.x + b.w - w : sx > 0 ? b.x : b.x + b.w / 2 - w / 2, y: e.altKey ? b.y + b.h / 2 - h / 2 : sy < 0 ? b.y + b.h - h : sy > 0 ? b.y : b.y + b.h / 2 - h / 2, w, h }
      }
      const scaled = new Map(scaleEls(g.els, b, nb).map((x) => [x.id, x]))
      setGuides(guidesFor(nb, g.others.map(aabb)).filter((q) => q.kind === 'line'))
      commit(replaceSlideEls(g, (x) => scaled.get(x.id) || null), { record: false })
      return
    }
    if (g.type === 'resize') {
      const el = g.el
      const [sx, sy] = g.dir
      const th = ((el.rotate || 0) * Math.PI) / 180
      const cos = Math.cos(th)
      const sin = Math.sin(th)
      const lx = dx * cos + dy * sin
      const ly = -dx * sin + dy * cos
      const fromCenter = e.altKey
      let w = sx ? el.w + lx * sx * (fromCenter ? 2 : 1) : el.w
      let h = sy ? el.h + ly * sy * (fromCenter ? 2 : 1) : el.h
      const corner = sx && sy
      const ratioEl = el.type === 'image' || (el.type === 'shape' && el.data?.shape === 'icon') || el.style?.lockRatio
      const keep = (corner && e.shiftKey !== !!ratioEl) || (!corner && el.style?.lockRatio)
      if (keep) {
        const ratio = el.w / el.h
        if (corner) {
          if (w / h > ratio) h = w / ratio
          else w = h * ratio
        } else if (sx) h = w / ratio
        else w = h * ratio
      }
      w = Math.max(8, w)
      h = Math.max(el.type === 'shape' && el.data?.shape === 'line' ? 4 : 8, h)
      if (!el.rotate && !keep && !noSnap && !fromCenter) {
        const t = 6 / s
        if (sx) {
          const edge = sx > 0 ? el.x + w : el.x + el.w - w
          const hit = snapEdge(edge, 'x', g.others, t)
          if (hit !== null) w = sx > 0 ? hit - el.x : el.x + el.w - hit
        }
        if (sy) {
          const edge = sy > 0 ? el.y + h : el.y + el.h - h
          const hit = snapEdge(edge, 'y', g.others, t)
          if (hit !== null) h = sy > 0 ? hit - el.y : el.y + el.h - hit
        }
      }
      const dw = w - el.w
      const dh = h - el.h
      const cxl = fromCenter ? 0 : (dw / 2) * sx
      const cyl = fromCenter ? 0 : (dh / 2) * (sy || 0)
      const cx = el.x + el.w / 2 + cxl * cos - cyl * sin
      const cy = el.y + el.h / 2 + cxl * sin + cyl * cos
      const nx = Math.round(cx - w / 2)
      const ny = Math.round(cy - h / 2)
      const nb = { x: nx, y: ny, w: Math.round(w), h: Math.round(h) }
      setGuides(el.rotate ? [] : guidesFor(nb, g.others.map(aabb)).filter((q) => q.kind === 'line'))
      // 글 상자 크기 조절 방식: 너비를 바꾸면 자동 높이, 높이를 바꾸면 고정
      let style = el.style
      if (el.type === 'text' && el.style?.sizing && el.style.sizing !== 'fixed') {
        if (sy) style = { ...el.style, sizing: 'fixed' }
        else if (sx && el.style.sizing === 'auto-w') style = { ...el.style, sizing: 'auto-h' }
      }
      commit(replaceSlideEls(g, (x) => (x.id === el.id ? { ...x, ...nb, style } : null)), { record: false })
      return
    }
    if (g.type === 'rotate') {
      const el = g.el
      const cx = el.x + el.w / 2
      const cy = el.y + el.h / 2
      let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90
      if (e.shiftKey) a = Math.round(a / 15) * 15
      else {
        const near = Math.round(a / 90) * 90
        if (Math.abs(a - near) < 4) a = near
      }
      a = ((((a + 180) % 360) + 360) % 360) - 180
      commit(replaceSlideEls(g, (x) => (x.id === el.id ? { ...x, rotate: Math.round(a) } : null)), { record: false })
    }
  }

  const onStageUp = (e) => {
    const g = gesture.current
    gesture.current = null
    setGuides([])
    if (!g) return
    if (g.type === 'marquee') {
      setMarquee(null)
      return
    }
    if (g.moved) {
      // 끌기가 끝나면 자동 배치를 다시 계산한다(끌어서 순서 바꾸기)
      if (g.type === 'move') {
        const d = deckRef.current
        const r = reflowDeck(d, g.base)
        if (r !== d) setDeck(r)
      }
      if (g.base !== deckRef.current) pushUndo(g.base)
      scheduleSave()
    } else if (g.type === 'move' && g.wasOnly && (g.target.type === 'text' || g.target.type === 'table') && e) {
      // 이미 골라 둔 글 상자를 한 번 더 누르면 누른 자리에서 편집
      startEdit(g.target.id, { x: e.clientX, y: e.clientY })
    }
  }

  const onStageDouble = (e) => {
    if (!canEditRef.current || !frame.current) return
    if (editingRef.current && e.target.closest(`[data-el="${editingRef.current}"]`)) return
    const p = toSlide(e)
    const stack = hitAt(p)
    if (!stack.length) return
    let el = stack.find((x) => selRef.current.includes(x.id)) || pickTop(stack)
    if (el.group && scopeRef.current !== el.group && !(selRef.current.length === 1 && selRef.current[0] === el.id)) {
      // 묶음 안으로 들어가 누른 요소를 고른다
      el = pickTop(stack.filter((x) => x.group === el.group)) || el
      scopeRef.current = el.group
      setSel([el.id])
      return
    }
    if (el.type === 'text' || el.type === 'table') startEdit(el.id, { x: e.clientX, y: e.clientY })
    else if (el.type === 'image') {
      imageTarget.current = el.id
      imageInput.current?.click()
    } else if (el.type === 'embed' && el.data?.url) window.open(el.data.url, '_blank', 'noopener,noreferrer')
  }

  const onStageContext = (e) => {
    if (!canEditRef.current || !frame.current || !deckRef.current?.slides.length) return
    e.preventDefault()
    if (editingRef.current) return
    const p = toSlide(e)
    const top = pickTop(hitAt(p))
    if (top && !selRef.current.includes(top.id)) setSel(unitOf(top, e.metaKey || e.ctrlKey))
    if (!top && !e.shiftKey) setSel([])
    setMenu({ x: e.clientX, y: e.clientY })
  }

  // ── 키보드 ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!deckRef.current || present || outline || shareOpen) return
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return
      if (document.activeElement?.closest?.('.sl-ai')) return // AI 창 안에서 누른 키는 편집기가 가로채지 않는다
      const mod = e.metaKey || e.ctrlKey
      const k = e.key
      if (k === 'F5' || (mod && k === 'Enter')) {
        e.preventDefault()
        finishEdit()
        setPresent({ start: e.shiftKey ? 0 : curRef.current, presenter: false })
        return
      }
      if (editingRef.current) {
        if (k === 'Escape') {
          e.preventDefault()
          const eid = editingRef.current
          finishEdit()
          setSel([eid])
          setLinkPop(null)
        }
        if (mod && (k === 'k' || k === 'K')) {
          e.preventDefault()
          editLink()
        }
        return
      }
      if (isTyping(document.activeElement)) return
      const editable = canEditRef.current
      const ids = selRef.current
      const inRail = railRef.current?.contains(document.activeElement)
      if (mod && (k === 'z' || k === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && (k === 'y' || k === 'Y')) {
        e.preventDefault()
        redo()
        return
      }
      if (!editable) {
        if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(k)) goSlide(curRef.current + 1)
        if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k)) goSlide(curRef.current - 1)
        return
      }
      if (mod && (k === 'm' || k === 'M')) {
        e.preventDefault()
        addSlide('title-body')
        return
      }
      if (k === 'PageDown' || k === 'PageUp') {
        e.preventDefault()
        goSlide(curRef.current + (k === 'PageDown' ? 1 : -1))
        return
      }
      if ((k === 'Delete' || k === 'Backspace') && (ids.length || inRail)) {
        e.preventDefault()
        if (ids.length) deleteSel()
        else deleteSlide(curRef.current)
        return
      }
      if (mod && (k === 'd' || k === 'D')) {
        e.preventDefault()
        if (ids.length) duplicateSel()
        else duplicateSlide(curRef.current)
        return
      }
      if (mod && (k === 'a' || k === 'A')) {
        e.preventDefault()
        setSel(deckRef.current.slides[curRef.current]?.elements.map((x) => x.id) || [])
        return
      }
      if (mod && (k === 'g' || k === 'G')) {
        e.preventDefault()
        if (e.shiftKey) ungroup()
        else group()
        return
      }
      if (mod && (k === ']' || k === '[')) {
        e.preventDefault()
        layer(k === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward')
        return
      }
      if (mod && (k === '=' || k === '+' || k === '-')) {
        e.preventDefault()
        zoomStep(k === '-' ? -1 : 1)
        return
      }
      if (mod && k === '0') {
        e.preventDefault()
        setZoom('fit')
        return
      }
      if (mod && ['b', 'i', 'u'].includes(k.toLowerCase()) && ids.length) {
        e.preventDefault()
        const f = { b: ['bold', 'bold'], i: ['italic', 'italic'], u: ['underline', 'underline'] }[k.toLowerCase()]
        textToggle(f[0], f[1])
        return
      }
      const slideNow = deckRef.current.slides[curRef.current]
      // 정렬: Alt(Option) + A D H / W S V, Alt+Shift+H V 분배, Alt+Shift+T 간격 정리 (Mac Option 글자 대신 키 위치로 본다)
      if (e.altKey && !mod && ids.length && /^Key[ADHWSVT]$/.test(e.code)) {
        e.preventDefault()
        const c = e.code.slice(3)
        if (e.shiftKey) {
          if (c === 'H') distribute('x')
          if (c === 'V') distribute('y')
          if (c === 'T') tidy()
          return
        }
        const how = { A: 'left', D: 'right', H: 'center', W: 'top', S: 'bottom', V: 'middle' }[c]
        if (how) align(how)
        return
      }
      if (!mod && !e.altKey && e.shiftKey && e.code === 'KeyA' && ids.length) {
        e.preventDefault()
        makeStack()
        return
      }
      if (mod && (k === 'k' || k === 'K') && ids.length === 1) {
        e.preventDefault()
        editLink()
        return
      }
      if (mod && e.shiftKey && e.code === 'KeyH' && ids.length) {
        e.preventDefault()
        const all = selElsNow().every((x) => x.hidden)
        updateSel((x) => ({ ...x, hidden: !all || undefined }))
        if (!all) setSel([])
        return
      }
      if (mod && e.shiftKey && e.code === 'KeyL' && ids.length) {
        e.preventDefault()
        toggleLock()
        return
      }
      if (k === 'Tab' && slideNow?.elements.length && !inRail) {
        // 다음·이전 요소 고르기(겹침 순서)
        e.preventDefault()
        const list = [...slideNow.elements].filter((x) => !x.hidden).sort((a, b) => (a.z || 0) - (b.z || 0))
        const at = list.findIndex((x) => x.id === ids[ids.length - 1])
        const nx = list[(at + (e.shiftKey ? -1 : 1) + list.length) % list.length]
        if (nx) {
          scopeRef.current = nx.group || null
          setSel([nx.id])
        }
        return
      }
      if (k === 'Enter' && ids.length) {
        e.preventDefault()
        const els = selElsNow()
        const units = selectionUnits(slideNow.elements, ids)
        if (e.shiftKey) {
          // 부모 묶음 고르기
          const gid = els[0]?.group
          if (gid) {
            scopeRef.current = null
            setSel(slideNow.elements.filter((x) => x.group === gid).map((x) => x.id))
          }
          return
        }
        if (ids.length === 1) startEdit(ids[0], 'all')
        else if (units.length === 1 && els[0]?.group) {
          // 묶음 안으로: 맨 위 요소
          scopeRef.current = els[0].group
          setSel([[...els].sort((a, b) => (b.z || 0) - (a.z || 0))[0].id])
        }
        return
      }
      if (k === 'Escape') {
        const els = selElsNow()
        if (scopeRef.current && els.length && els.every((x) => x.group === scopeRef.current)) {
          const gid = scopeRef.current
          scopeRef.current = null
          setSel(slideNow.elements.filter((x) => x.group === gid).map((x) => x.id))
        } else {
          scopeRef.current = null
          setSel([])
        }
        setMenu(null)
        return
      }
      if (k.startsWith('Arrow')) {
        e.preventDefault()
        if (!ids.length) {
          goSlide(curRef.current + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1))
          return
        }
        if (inRail) {
          goSlide(curRef.current + (k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0))
          return
        }
        const step = e.shiftKey ? 10 : 1
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0
        const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0
        // 키를 누르고 있는 동안은 실행취소 한 단계로 모은다
        updateSel((x) => (x.locked ? x : { ...x, x: x.x + dx, y: x.y + dy }), true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // 매번 새로 건다(최신 상태를 쓴다)

  // ── 복사·붙여넣기 ──────────────────────────────────────
  // 복사: 우리 형식(application/x-dah-slides+json) + 글(text/plain) + 외부 앱 형식(clipboardInterop).
  // 붙여넣기: 외부 앱 형식 → 우리 형식(예전 text/plain 앞머리도 읽음) → 그림 파일 → 주소 → HTML(링크·서식 유지) → 글.
  useEffect(() => {
    const modal = () => present || outline || shareOpen || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')
    const blocked = () => !deckRef.current || modal() || editingRef.current || isTyping(document.activeElement)
    const onCopy = (e) => {
      if (blocked()) return
      const els = selElsNow()
      if (!els.length) return
      e.preventDefault()
      const d = deckRef.current
      const slide = d.slides[curRef.current]
      const groups = new Set(els.map((x) => x.group).filter(Boolean))
      const stacks = slide.stacks ? Object.fromEntries(Object.entries(slide.stacks).filter(([g]) => groups.has(g))) : undefined
      e.clipboardData.setData(CLIP_MIME, JSON.stringify({ v: 2, els, stacks }))
      const text = els.filter((x) => x.type === 'text').sort((a, b) => a.y - b.y).map((x) => plainOf(x.data?.html)).filter(Boolean).join('\n\n')
      if (text) e.clipboardData.setData('text/plain', text)
      try {
        writeExternalClipboard(e.clipboardData, { elements: els, slide, deck: d })
      } catch {
        /* 외부 형식은 덤이다 */
      }
      if (e.type === 'cut' && canEditRef.current) deleteSel()
    }
    const onPaste = (e) => {
      if (!deckRef.current || modal()) return
      const cd = e.clipboardData
      if (!cd) return
      // 글 상자 편집 중: 링크·굵게·기울임·밑줄·목록만 남기고 넣는다
      if (editingRef.current && editNode.current && editNode.current.contains(document.activeElement || null)) {
        const html = cd.getData('text/html')
        const text = cd.getData('text/plain')
        if (html) {
          e.preventDefault()
          const clean = sanitizeRich(cleanPastedHtml(html))
          document.execCommand('insertHTML', false, clean || escText(text).replace(/\n/g, '<br>'))
        } else if (text) {
          e.preventDefault()
          const t = text.trim()
          if (/^https?:\/\/\S+$/i.test(t) && sanitizeUrl(t)) {
            const sel = window.getSelection()
            if (sel && !sel.isCollapsed) document.execCommand('createLink', false, sanitizeUrl(t))
            else document.execCommand('insertHTML', false, `<a href="${escText(sanitizeUrl(t))}">${escText(t)}</a>`)
          } else document.execCommand('insertText', false, text)
        }
        editHtml.current = editNode.current.innerHTML
        return
      }
      if (blocked() || !canEditRef.current) return
      // 1) 외부 앱(슬라이드 앱, 키노트 등)
      let ext = null
      try {
        ext = readExternalClipboard(cd, { deck: deckRef.current })
      } catch {
        ext = null
      }
      if (ext?.elements?.length) {
        e.preventDefault()
        pasteEls(ext.elements, { stacks: ext.stacks, center: ext.positioned === false })
        return
      }
      // 2) 우리 형식
      const own = cd.getData(CLIP_MIME)
      const text = cd.getData('text/plain') || ''
      if (own || text.startsWith(CLIP)) {
        e.preventDefault()
        try {
          const j = JSON.parse(own || text.slice(CLIP.length))
          pasteEls(j.els || [], { stacks: j.stacks })
        } catch {
          toast('붙여 넣지 못했습니다')
        }
        return
      }
      // 3) 그림 파일
      const files = [...(cd.files || [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        addImages(files)
        return
      }
      const t = text.trim()
      // 4) 주소 하나
      if (/^https?:\/\/\S+$/i.test(t)) {
        e.preventDefault()
        if (/\.(png|jpe?g|gif|webp|avif)(\?\S*)?$/i.test(t)) {
          imageSize(t).then(({ w, h }) => {
            const k = Math.min(1200 / w, 760 / h, 1)
            addElements([imageEl([Math.round(960 - (w * k) / 2), Math.round(540 - (h * k) / 2), Math.round(w * k), Math.round(h * k)], { src: sanitizeImageSrc(t), placeholder: '' })])
          })
        } else addEmbed(t)
        return
      }
      // 5) HTML: 링크와 서식을 살린 새 글 상자
      const html = cd.getData('text/html')
      if (html) {
        const clean = sanitizeRich(cleanPastedHtml(html))
        if (!emptyHtml(clean)) {
          e.preventDefault()
          const body = /^\s*<(p|ul|ol|div)[\s>]/i.test(clean) ? clean : `<p>${clean}</p>`
          addElements([textEl(undefined, [360, 340, 1200, 120], { size: 36, sizing: 'auto-h' }, { html: body, placeholder: '' })])
          return
        }
      }
      if (!t) return
      e.preventDefault()
      const el = textEl(undefined, [360, 340, 1200, 120], { size: 36, sizing: 'auto-h' }, { html: sanitizeRich(text.split(/\r?\n/).map((l) => `<p>${escText(l) || '<br>'}</p>`).join('')), placeholder: '' })
      addElements([el])
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  })

  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // Alt(Option)를 누르고 있으면 거리 재기, 화살표를 떼면 옮기기 한 단계로 기록
  useEffect(() => {
    const down = (e) => {
      if (e.key === 'Alt') setAltDown(true)
    }
    const up = (e) => {
      if (e.key === 'Alt') setAltDown(false)
      if (e.key.startsWith('Arrow')) endLive()
    }
    const blur = () => setAltDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [endLive])

  // 글 상자 자동 크기(자동 너비·자동 높이): 그린 뒤 글 높이·너비를 재서 상자에 맞춘다(실행취소에 남기지 않음)
  const fitTick = useRef(0)
  const [, setFitTick] = useState(0)
  const measureAuto = useCallback(() => {
    const d = deckRef.current
    const slide = d?.slides[curRef.current]
    const root = frame.current
    if (!slide || !root || !canEditRef.current) return
    const patch = new Map()
    for (const el of slide.elements) {
      const mode = el.type === 'text' && el.style?.sizing
      if (mode !== 'auto-w' && mode !== 'auto-h') continue
      const n = root.querySelector(`[data-el="${CSS.escape(el.id)}"] .sl-text`)
      if (!n) continue
      const pad = (el.style?.pad ?? 8) * 2
      const h = Math.ceil(Math.max(n.offsetHeight, n.scrollHeight) + pad)
      const w = mode === 'auto-w' ? Math.ceil(n.scrollWidth + pad + 2) : el.w
      if (Math.abs(h - el.h) > 1 || Math.abs(w - el.w) > 1) patch.set(el.id, { w, h })
    }
    if (!patch.size) return
    const slides = d.slides.slice()
    slides[curRef.current] = { ...slide, elements: slide.elements.map((x) => (patch.has(x.id) ? { ...x, ...patch.get(x.id) } : x)) }
    const next = reflowDeck({ ...d, slides }, d)
    setDeck(next)
    // 실행취소 기록의 마지막 상태도 같이 맞춰 두면 되돌릴 때 크기가 튀지 않는다
    scheduleSave()
  }, [setDeck, scheduleSave])
  useLayoutEffect(() => {
    measureAuto()
  })
  const onEditInput = useCallback(
    (html) => {
      editHtml.current = html
      cancelAnimationFrame(fitTick.current)
      fitTick.current = requestAnimationFrame(() => {
        measureAuto()
        setFitTick((t) => t + 1)
      })
    },
    [measureAuto]
  )

  // ── 내보내기 ─────────────────────────────────────────
  const runExport = useCallback(
    (kind) => {
      finishEdit()
      const d = deckRef.current
      if (!d.slides.length) return toast('슬라이드가 없습니다')
      const idx = kind === 'png' ? [curRef.current] : kind === 'pptx' ? d.slides.map((_, i) => i) : d.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0)
      if (!idx.length) return toast('내보낼 슬라이드가 없습니다. 건너뛰기를 해제하세요')
      setJob({ kind, slides: idx, done: 0, total: idx.length })
    },
    [finishEdit, toast]
  )
  useEffect(() => {
    if (!job || job.running) return
    job.running = true
    const title = file?.title || '발표'
    const progress = (done, total) => setJob((j) => (j ? { ...j, done, total } : j))
    const run = async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 120))
      const nodes = [...(exportBox.current?.querySelectorAll('.sl-slide') || [])]
      const d = deckRef.current
      try {
        if (job.kind === 'pdf') await exportPdf(nodes, title, progress)
        else if (job.kind === 'png') await exportPng(nodes[0], `${title} ${job.slides[0] + 1}`)
        else if (job.kind === 'hwpx') {
          const r = await exportHwpx(nodes, job.slides.map((i) => d.slides[i]), title, progress)
          if (!r.ok) alertDialog({ title: '한글로 내보내기', message: r.message })
          else if (r.truncated) toast('한글 파일에는 앞의 20장만 그림으로 넣었습니다')
        } else if (job.kind === 'pptx') {
          const { buildPptx } = await import('./pptx')
          const fitOf = (eid, si) => {
            const n = nodes[si]?.querySelector(`[data-el="${CSS.escape(eid)}"] .sl-text`)
            const el = d.slides[si].elements.find((x) => x.id === eid)
            if (!n || !el) return 1
            return parseFloat(n.style.fontSize) / (el.style?.size || 36) || 1
          }
          const rasterize = (eid, si) => rasterizeNode(nodes[si]?.querySelector(`[data-el="${CSS.escape(eid)}"]`))
          const { blob, skipped } = await buildPptx(d, { title, fitOf, rasterize, onProgress: progress })
          download(blob, `${safeName(title)}.pptx`)
          if (skipped.images) toast(`이미지 ${skipped.images}개는 가져오지 못해 빠졌습니다`)
        }
      } catch (e) {
        toast(`내보내지 못했습니다: ${e.message}`)
      } finally {
        setJob(null)
      }
    }
    run()
    // 진행률을 바꾸면 job이 새 값이 되어 이 효과가 다시 돈다. 그때 끝내기 처리를 막지 않도록 화면이 사라질 때만 멈춘다
    return undefined
  }, [job, file, toast])
  useEffect(() => () => setJob(null), [])

  const rename = async (title) => {
    try {
      await api.put(`/workspace/files/${id}`, { title })
      setFile((f) => ({ ...f, title }))
      document.title = `${title} | 디인예 워크스페이스`
    } catch (e) {
      toast(`이름을 바꾸지 못했습니다: ${e.message}`)
    }
  }

  const createFromOutline = (slides, themeId, mode) => {
    const d = deckRef.current
    const theme = themeId === d.theme.id ? d.theme : themeCopy(themeId)
    if (mode === 'replace') {
      commit({ ...d, theme, slides })
      setCur(0)
    } else {
      commit({ ...d, theme, slides: [...d.slides, ...slides] })
      setCur(d.slides.length)
    }
    setSel([])
    setOutline(false)
    toast(`슬라이드 ${slides.length}장을 만들었습니다`)
  }

  const startTemplate = async (tpl) => {
    const built = tpl.build()
    const d = deckRef.current
    if (d.slides.length && !(await confirmDialog({ message: '지금 슬라이드를 템플릿으로 바꿀까요?', confirmLabel: '바꾸기' }))) return
    commit({ ...d, theme: built.theme, slides: built.slides })
    setCur(0)
    setSel([])
  }

  // ── 그리기 ───────────────────────────────────────────
  const slide = deck?.slides[cur] || null
  const selEls = useMemo(() => (slide ? slide.elements.filter((e) => sel.includes(e.id)) : []), [slide, sel])
  const docColors = useMemo(() => deckColors(deck), [deck])
  const iconNames = useMemo(() => {
    const q = iconQuery.trim().toLowerCase()
    return Object.keys(ICONS).filter((n) => !q || n.toLowerCase().includes(q) || (ICON_WORDS[n] || '').includes(q))
  }, [iconQuery])

  if (denied) return <NoAccess kind="doc" notFound={denied === 'missing'} />
  if (!deck) return <div className="sl-loading">{loadError || '불러오는 중'}</div>

  const theme = deck.theme
  const hasUndo = hist.current.undo.length > 0
  const hasRedo = hist.current.redo.length > 0
  const saveLabel = { saved: '저장됨', dirty: '저장 대기', saving: '저장 중', error: '저장 실패' }[saveState]
  const one = selEls.length === 1 ? selEls[0] : null
  const textSel = selEls.length > 0 && selEls.every((e) => e.type === 'text')
  const tableSel = one?.type === 'table'
  const shapeSel = selEls.length > 0 && selEls.every((e) => e.type === 'shape' && !['icon', 'line'].includes(e.data?.shape))
  const ts = textSel ? selEls[0].style : tableSel ? one.style : null
  const act = {
    setTheme, endThemeEdit: endLive, updateSlide, updateSel, endLive, upload, align, distribute, layer, group, ungroup, toggleLock, setAnim, deleteSel,
    applyLayout: applyLayoutNow, toggleHidden: () => toggleHidden(curRef.current),
    bgAll: () => {
      const bg = deckRef.current.slides[curRef.current]?.background || null
      commit({ ...deckRef.current, slides: deckRef.current.slides.map((s) => ({ ...s, background: bg ? { ...bg } : null })) })
      toast('모든 슬라이드에 같은 배경을 넣었습니다')
    },
    transitionAll: () => {
      const t = deckRef.current.slides[curRef.current]?.transition || 'none'
      commit({ ...deckRef.current, slides: deckRef.current.slides.map((s) => ({ ...s, transition: t })) })
      toast('모든 슬라이드에 같은 전환을 넣었습니다')
    },
    replaceImage: () => {
      imageTarget.current = selRef.current[0]
      imageInput.current?.click()
    },
    unitCount: () => (slide ? selectionUnits(slide.elements, sel).length : 0),
    gapInfo: () => (slide ? selectionGap(slide.elements, sel) : { axis: null, gap: null }),
    tidy, setGap, setBox, makeStack, removeStack, setStack, selectIds, reorderLayers, toggleElHidden, toggleElLock, renameEl,
  }
  const selGroup = selEls.length && selEls[0].group && selEls.every((x) => x.group === selEls[0].group) ? selEls[0].group : null
  const stackOf = selGroup && slide?.stacks?.[selGroup] ? slide.stacks[selGroup] : null

  const unionSel = selEls.length > 1 ? unionBox(selEls) : null
  const showHandles = canEdit && !editing && selEls.length > 0 && selEls.some((x) => !x.locked)
  const measure = altDown && !gesture.current && selEls.length && !editing ? measureBetween(unionBox(selEls), hover && !hover.ids.every((x) => sel.includes(x)) ? hover.aabb : { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }) : []
  const marks = [...guides, ...measure]
  const gapMark = (m, i) => {
    const a = Math.min(m.from, m.to) * scale
    const b = Math.max(m.from, m.to) * scale
    const at = m.at * scale
    const len = b - a
    return m.axis === 'x' ? (
      <span key={`m${i}`} className={`sl-mgap sl-mgap--x ${m.equal ? 'is-eq' : ''}`} style={{ left: a, top: at, width: len }} />
    ) : (
      <span key={`m${i}`} className={`sl-mgap sl-mgap--y ${m.equal ? 'is-eq' : ''}`} style={{ left: at, top: a, height: len }} />
    )
  }
  const overlay = slide && (
    <div className="sl-overlay" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
      {hover && !marquee && !hover.ids.every((x) => sel.includes(x)) && (
        <div className="sl-hoverbox" style={{ left: hover.box.x * scale, top: hover.box.y * scale, width: hover.box.w * scale, height: hover.box.h * scale, transform: hover.rotate ? `rotate(${hover.rotate}deg)` : undefined }} />
      )}
      {selEls.map((el) => (
        <div
          key={el.id}
          className={`sl-selbox ${editing === el.id ? 'is-editing' : ''} ${el.locked ? 'is-locked' : ''} ${unionSel ? 'is-member' : ''}`}
          style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined }}
        >
          {el.locked && (
            <span className="sl-lockbadge" title="잠김">
              <Lock size={12} />
            </span>
          )}
          {showHandles && one && !el.locked && (
            <>
              {HANDLES.filter(([, , sy]) => !(el.type === 'shape' && el.data?.shape === 'line' && sy !== 0)).map(([name, sx, sy]) => (
                <span key={name} className={`sl-handle sl-handle--${name}`} onPointerDown={(e) => startHandle(e, 'resize', [sx, sy])} onPointerMove={onStageMove} onPointerUp={onStageUp} />
              ))}
              <span className="sl-rot" title="회전 (Shift: 15도씩)" onPointerDown={(e) => startHandle(e, 'rotate')} onPointerMove={onStageMove} onPointerUp={onStageUp} />
            </>
          )}
        </div>
      ))}
      {unionSel && (
        <div className="sl-selbox sl-selbox--union" style={{ left: unionSel.x * scale, top: unionSel.y * scale, width: unionSel.w * scale, height: unionSel.h * scale }}>
          {showHandles && HANDLES.map(([name, sx, sy]) => (
            <span key={name} className={`sl-handle sl-handle--${name}`} onPointerDown={(e) => startHandle(e, 'resize', [sx, sy])} onPointerMove={onStageMove} onPointerUp={onStageUp} />
          ))}
        </div>
      )}
      {(gesture.current?.type === 'move' || gesture.current?.type?.startsWith('resize')) && selEls.length > 0 && (() => {
        const b = unionBox(selEls)
        return <span className="sl-sizetag" style={{ left: (b.x + b.w / 2) * scale, top: (b.y + b.h) * scale + 10 }}>{Math.round(b.w)} × {Math.round(b.h)}</span>
      })()}
      {marks.map((g, i) =>
        g.kind === 'line' ? (
          g.axis === 'x' ? (
            <span key={i} className="sl-guide sl-guide--x" style={{ left: g.pos * scale, top: g.from * scale, height: (g.to - g.from) * scale }} />
          ) : (
            <span key={i} className="sl-guide sl-guide--y" style={{ top: g.pos * scale, left: g.from * scale, width: (g.to - g.from) * scale }} />
          )
        ) : (
          gapMark(g, i)
        )
      )}
      {marks.filter((m) => m.kind === 'gap').map((m, i) => {
        const a = Math.min(m.from, m.to) * scale
        const len = Math.abs(m.to - m.from) * scale
        const at = m.at * scale
        return (
          <span key={`l${i}`} className={`sl-mlabel sl-mlabel--${m.axis}`} style={m.axis === 'x' ? { left: a + len / 2, top: at + 8 } : { left: at + 8, top: a + len / 2 }}>
            {m.label}
          </span>
        )
      })}
      {marquee && (marquee.w > 0 || marquee.h > 0) && <div className="sl-marquee" style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }} />}
    </div>
  )

  return (
    <DeckColorsContext.Provider value={docColors}>
    <div className="sl-root reading-scope">
      <div className="ed-row">
        <Link to="/workspace/slides" aria-label="프레젠테이션 홈" title="프레젠테이션 홈" className="ed-icon">
          <SlidesIcon size={40} />
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
        <span role="status" aria-live="polite" className={`ed-status ${saveState === 'error' ? 'sl-status-error' : ''}`}>
          <Cloud size={16} aria-hidden="true" />
          {canEdit ? saveLabel : '보기 전용'}
        </span>
        {mcpRelay.badge}
        <div className="sl-row-right">
          {canEdit && (
            <Pop label="가져오기" align="right" icon={<Upload size={18} />} text="가져오기" className="sl-pop--row">
              {(close) => (
                <div className="sl-menu-list">
                  <button type="button" onClick={() => { close(); importInput.current?.click() }}>PPTX 가져오기 (키노트·파워포인트·구글 슬라이드)</button>
                </div>
              )}
            </Pop>
          )}
          <Pop label="내보내기" align="right" icon={<Download size={18} />} text="내보내기" className="sl-pop--row">
            {(close) => (
              <div className="sl-menu-list">
                <button type="button" onClick={() => { close(); runExport('pdf') }}>PDF</button>
                <button type="button" onClick={() => { close(); runExport('pptx') }}>파워포인트(PPTX)</button>
                <button type="button" onClick={() => { close(); runExport('png') }}>지금 슬라이드 PNG</button>
                <button type="button" onClick={() => { close(); runExport('hwpx') }}>한글(HWPX)로 내보내기</button>
              </div>
            )}
          </Pop>
          <div className="sl-present-btn">
            <button type="button" className="sl-present-btn__main" onClick={() => { finishEdit(); setPresent({ start: cur, presenter: false }) }} title={`발표 (${MOD}Enter)`}>
              <Play size={16} /> 발표
            </button>
            <Pop label="발표 방법" align="right" icon={null} className="sl-present-btn__more">
              {(close) => (
                <div className="sl-menu-list">
                  <button type="button" onClick={() => { close(); setPresent({ start: 0, presenter: false }) }}>처음부터</button>
                  <button type="button" onClick={() => { close(); setPresent({ start: cur, presenter: false }) }}>지금 슬라이드부터</button>
                  <button type="button" onClick={() => { close(); setPresent({ start: cur, presenter: true }) }}>
                    <MonitorPlay size={16} /> 발표자 보기
                  </button>
                </div>
              )}
            </Pop>
          </div>
          {AiPanel && (
            <button type="button" className={`sl-ai-btn ${aiOpen ? 'is-on' : ''}`} aria-pressed={aiOpen} onClick={() => setAiOpen((v) => !v)} title={`AI 창 (${MOD}J)`}>
              <Sparkles size={16} aria-hidden="true" /> AI
            </button>
          )}
          <button type="button" className="ed-share" onClick={() => setShareOpen(true)}>
            <ShareIcon size={16} aria-hidden="true" /> 공유
          </button>
          <AccountMenu size={40} />
        </div>
      </div>

      <div role="toolbar" aria-label="발표 도구 모음" className="sl-toolbar">
        {canEdit && (
          <>
            <TB label={`실행취소 (${MOD}Z)`} onClick={undo} disabled={!hasUndo}>
              <Undo2 size={18} />
            </TB>
            <TB label={`다시 실행 (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} onClick={redo} disabled={!hasRedo}>
              <Redo2 size={18} />
            </TB>
            <Sep />
            <Pop label={`새 슬라이드 (${MOD}M)`} icon={<Plus size={18} />} text="슬라이드" wide>
              {(close) => (
                <div className="sl-layout-gallery">
                  {LAYOUTS.map((L) => (
                    <div key={L.id} className="sl-layout-gallery__row">
                      <div className="sl-layout-gallery__name">{L.name}</div>
                      <div className="sl-layout-gallery__items">
                        {L.variants.map((_, v) => (
                          <button key={v} type="button" onClick={() => { close(); addSlide(L.id, v) }} title={`${L.name} ${v + 1}`}>
                            <SlideView slide={LAYOUT_PREVIEWS[`${L.id}-${v}`]} theme={theme} scale={120 / 1920} mode="thumb" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Pop>
            <Sep />
            <TB label="텍스트 상자" onClick={addText}>
              <Type size={18} />
            </TB>
            <Pop label="도형" icon={<Shapes size={18} />}>
              {(close) => (
                <div className="sl-grid-btns">
                  {[
                    ['rect', '사각형', <Square key="a" size={20} />],
                    ['rounded', '둥근 사각형', <RectangleHorizontal key="b" size={20} />],
                    ['ellipse', '타원', <Circle key="c" size={20} />],
                    ['triangle', '삼각형', <Triangle key="d" size={20} />],
                    ['arrow', '화살표', <ArrowRight key="e" size={20} />],
                    ['line', '선', <Minus key="f" size={20} />],
                  ].map(([k, name, icon]) => (
                    <button key={k} type="button" title={name} aria-label={name} onClick={() => { close(); addShape(k) }}>
                      {icon}
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
              )}
            </Pop>
            <TB label="이미지 (붙여넣기, 끌어 놓기도 됩니다)" onClick={() => { imageTarget.current = null; imageInput.current?.click() }}>
              <ImageIcon size={18} />
            </TB>
            <TB label="표" onClick={addTable}>
              <Table2 size={18} />
            </TB>
            <TB label="링크 카드 (피그마, 유튜브, 노션, 웹 페이지)" onClick={askEmbed}>
              <Link2 size={18} />
            </TB>
            <Pop label="아이콘" icon={<Smile size={18} />} wide>
              {(close) => (
                <div className="sl-icons">
                  <input className="sl-input" placeholder="아이콘 찾기" value={iconQuery} onChange={(e) => setIconQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="아이콘 찾기" />
                  <div className="sl-icons__grid">
                    {iconNames.map((n) => {
                      const Icon = ICONS[n]
                      return (
                        <button key={n} type="button" title={ICON_WORDS[n]?.split(' ')[0] || n} aria-label={ICON_WORDS[n]?.split(' ')[0] || n} onClick={() => { close(); addIcon(n) }}>
                          <Icon size={22} />
                        </button>
                      )
                    })}
                    {!iconNames.length && <p className="sl-hint">찾는 아이콘이 없습니다</p>}
                  </div>
                </div>
              )}
            </Pop>
            <Sep />

            {(textSel || tableSel) && ts && (
              <>
                <label className="sl-font">
                  <span className="sr-only">글꼴</span>
                  <select value={ts.font || '@body'} onChange={(e) => setTextStyle({ font: e.target.value })} aria-label="글꼴">
                    <option value="@heading">제목 글꼴</option>
                    <option value="@body">본문 글꼴</option>
                    {Object.values(FONTS).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <TB label="글자 작게" keep onClick={() => setTextStyle({ size: Math.max(8, Math.round((ts.size || 36) / 1.1)) })}>
                  <Minus size={16} />
                </TB>
                <span className="sl-size" aria-label="글자 크기">{Math.round((ts.size || 36) / 2)}</span>
                <TB label="글자 크게" keep onClick={() => setTextStyle({ size: Math.min(600, Math.round((ts.size || 36) * 1.1) + 1) })}>
                  <Plus size={16} />
                </TB>
              </>
            )}
            {textSel && ts && (
              <>
                <TB label={`굵게 (${MOD}B)`} keep pressed={ts.bold} onClick={() => textToggle('bold', 'bold')}>
                  <Bold size={18} />
                </TB>
                <TB label={`기울임 (${MOD}I)`} keep pressed={ts.italic} onClick={() => textToggle('italic', 'italic')}>
                  <Italic size={18} />
                </TB>
                <TB label={`밑줄 (${MOD}U)`} keep pressed={ts.underline} onClick={() => textToggle('underline', 'underline')}>
                  <Underline size={18} />
                </TB>
                <ColorButton label="글자 색" keep value={ts.color || '@text'} theme={theme} onPick={textColor} icon={<Baseline size={16} />} />
                <Pop label="정렬" keep icon={{ left: <AlignLeft size={18} />, center: <AlignCenter size={18} />, right: <AlignRight size={18} />, justify: <AlignJustify size={18} /> }[ts.align || 'left']}>
                  <div className="sl-iconrow">
                    <TB label="왼쪽" keep pressed={(ts.align || 'left') === 'left'} onClick={() => setTextStyle({ align: 'left' })}><AlignLeft size={18} /></TB>
                    <TB label="가운데" keep pressed={ts.align === 'center'} onClick={() => setTextStyle({ align: 'center' })}><AlignCenter size={18} /></TB>
                    <TB label="오른쪽" keep pressed={ts.align === 'right'} onClick={() => setTextStyle({ align: 'right' })}><AlignRight size={18} /></TB>
                    <TB label="양쪽" keep pressed={ts.align === 'justify'} onClick={() => setTextStyle({ align: 'justify' })}><AlignJustify size={18} /></TB>
                    <Sep />
                    <TB label="위에 붙이기" keep pressed={(ts.valign || 'top') === 'top'} onClick={() => setTextStyle({ valign: 'top' })}><span className="sl-mini-label">위</span></TB>
                    <TB label="가운데에" keep pressed={ts.valign === 'middle'} onClick={() => setTextStyle({ valign: 'middle' })}><AlignVerticalJustifyCenter size={18} /></TB>
                    <TB label="아래에 붙이기" keep pressed={ts.valign === 'bottom'} onClick={() => setTextStyle({ valign: 'bottom' })}><span className="sl-mini-label">아래</span></TB>
                  </div>
                </Pop>
                <TB label={`링크 (${MOD}K)`} keep onClick={editLink}>
                  <Link2 size={18} />
                </TB>
                <TB label="글머리 기호" keep onClick={() => textList('ul')}>
                  <List size={18} />
                </TB>
                <TB label="번호 목록" keep onClick={() => textList('ol')}>
                  <ListOrdered size={18} />
                </TB>
                <Pop label="줄 간격" keep icon={<MoveVertical size={18} />}>
                  {(close) => (
                    <div className="sl-menu-list">
                      {[1, 1.15, 1.3, 1.5, 1.8, 2].map((v) => (
                        <button key={v} type="button" className={Math.abs((ts.lineHeight || 1.4) - v) < 0.01 ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); setTextStyle({ lineHeight: v }) }}>
                          {v.toFixed(2).replace(/0$/, '')}
                        </button>
                      ))}
                    </div>
                  )}
                </Pop>
              </>
            )}
            {shapeSel && (
              <>
                <ColorButton label="채우기" value={selEls[0].style?.fill || null} theme={theme} allowNone onPick={(v) => updateSel((e) => ({ ...e, style: { ...e.style, fill: v } }))} icon={<span className="sl-mini-label">채우기</span>} />
                <ColorButton label="테두리" value={selEls[0].style?.stroke || null} theme={theme} allowNone onPick={(v) => updateSel((e) => ({ ...e, style: { ...e.style, stroke: v, strokeWidth: v ? e.style?.strokeWidth || 4 : 0 } }))} icon={<span className="sl-mini-label">테두리</span>} />
              </>
            )}
            {tableSel && (
              <>
                <Sep />
                <TB label="행 더하기" onClick={() => tableOp('addRow')}><Rows3 size={18} /><Plus size={12} /></TB>
                <TB label="마지막 행 빼기" onClick={() => tableOp('delRow')}><Rows3 size={18} /><Minus size={12} /></TB>
                <TB label="열 더하기" onClick={() => tableOp('addCol')}><Columns3 size={18} /><Plus size={12} /></TB>
                <TB label="마지막 열 빼기" onClick={() => tableOp('delCol')}><Columns3 size={18} /><Minus size={12} /></TB>
              </>
            )}
            {selEls.length > 0 && !editing && (
              <TB label="이미지로 복사 (다른 앱에 그림으로 붙여넣기)" onClick={copyAsImage}>
                <ImageDown size={18} />
              </TB>
            )}
            {one?.type === 'image' && (
              <TB label="이미지 바꾸기" text onClick={act.replaceImage}>
                <ImageIcon size={16} /> 바꾸기
              </TB>
            )}
          </>
        )}
        <div className="sl-toolbar__right">
          {canEdit && (
            <>
              <TB label="글로 만들기: 개요를 붙여 넣으면 슬라이드를 만듭니다" text onClick={() => { finishEdit(); setOutline(true) }}>
                <LetterText size={18} /> 글로 만들기
              </TB>
              <TB label="디자인 바꾸기: 지금 슬라이드의 배치를 바꿉니다" text onClick={nextDesign} disabled={!slide}>
                <WandSparkles size={18} /> 디자인 바꾸기
              </TB>
              <Sep />
            </>
          )}
          <TB label={`축소 (${MOD}-)`} onClick={() => zoomStep(-1)}>
            <Minus size={16} />
          </TB>
          <button type="button" className="sl-zoom-pct" onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} title={zoom === 'fit' ? '100%로' : `화면에 맞추기 (${MOD}0)`}>
            {Math.round(scale * 100)}%
          </button>
          <TB label={`확대 (${MOD}+)`} onClick={() => zoomStep(1)}>
            <Plus size={16} />
          </TB>
          <TB label="화면에 맞추기" pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
            <Maximize size={16} />
          </TB>
          <TB label={notesOpen ? '발표자 노트 닫기' : '발표자 노트 열기'} pressed={notesOpen} onClick={() => setNotesOpen((v) => !v)}>
            {notesOpen ? <PanelBottomClose size={18} /> : <PanelBottomOpen size={18} />}
          </TB>
        </div>
      </div>

      <div className="sl-body">
        <SlideRail
          slides={deck.slides}
          theme={theme}
          cur={cur}
          canEdit={canEdit}
          railRef={railRef}
          onPick={goSlide}
          onMove={moveSlide}
          onDuplicate={duplicateSlide}
          onDelete={deleteSlide}
          onToggleHidden={toggleHidden}
        />
        <div className="sl-main">
          <div
            ref={stage}
            className={`sl-stage ${canEdit ? '' : 'is-readonly'}`}
            tabIndex={-1}
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={onStageUp}
            onPointerCancel={onStageUp}
            onDoubleClick={onStageDouble}
            onContextMenu={onStageContext}
            onPointerLeave={() => !gesture.current && setHover(null)}
            onDragOver={(e) => canEdit && e.dataTransfer.types.includes('Files') && e.preventDefault()}
            onDrop={(e) => {
              if (!canEdit || !e.dataTransfer.files?.length) return
              e.preventDefault()
              const p = frame.current ? toSlide(e) : null
              addImages(e.dataTransfer.files, p)
            }}
          >
            {slide ? (
              <div className="sl-canvas" style={{ minWidth: SLIDE_W * scale + 64, minHeight: SLIDE_H * scale + 64 }}>
                <div className="sl-canvas__frame" ref={frame} style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
                  <SlideView
                    slide={slide}
                    theme={theme}
                    scale={scale}
                    mode="edit"
                    editingId={editing}
                    editRef={editNode}
                    editCaret={editCaret}
                    onEditInput={onEditInput}
                    onCell={editing ? onCell(editing) : undefined}
                  />
                  {overlay}
                </div>
              </div>
            ) : (
              <div className="sl-empty">
                <h2>새 발표 시작하기</h2>
                <p className="sl-hint">템플릿을 고르거나, 개요를 붙여 넣거나, 빈 슬라이드로 시작하세요.</p>
                {canEdit && (
                  <>
                    <div className="sl-empty__actions">
                      <button type="button" className="sl-btn sl-btn--primary" onClick={() => addSlide('title')}>
                        <Plus size={16} /> 빈 슬라이드
                      </button>
                      <button type="button" className="sl-btn" onClick={() => setOutline(true)}>
                        <LetterText size={16} /> 글로 만들기
                      </button>
                    </div>
                    <div className="sl-tpl-grid">
                      {SLIDE_TEMPLATE_LIST.map((t) => (
                        <button key={t.id} type="button" className="sl-tpl" onClick={() => startTemplate(t)}>
                          <SlideView slide={TEMPLATE_PREVIEWS[t.id].slides[0]} theme={TEMPLATE_PREVIEWS[t.id].theme} scale={288 / 1920} mode="thumb" />
                          <b>{t.name}</b>
                          <span>{t.sub}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {canEdit && sel.length > 1 && <div className="sl-floating">{sel.length}개 선택</div>}
          </div>
          {notesOpen && slide && (
            <div className="sl-notes">
              <StickyNote size={16} aria-hidden="true" />
              <textarea
                aria-label="발표자 노트"
                placeholder={canEdit ? '발표자 노트를 입력하세요' : '발표자 노트가 없습니다'}
                value={slide.notes || ''}
                readOnly={!canEdit}
                onChange={(e) => updateSlide((s) => ({ ...s, notes: e.target.value.slice(0, 20000) }), true)}
                onBlur={endLive}
              />
            </div>
          )}
        </div>
        {aiOpen && AiPanel ? (
          <aside className="sl-ai" aria-label="AI 창">
            <Suspense fallback={<div className="sl-ai__loading">불러오는 중</div>}>
              <AiPanel
                open
                onClose={() => setAiOpen(false)}
                scope={`slides:${id}`}
                title="발표 AI"
                systemPrompt={buildSlideSystemPrompt(getKnowledge('slides'))}
                tools={aiTools}
                getContext={aiContext}
                quickActions={SLIDE_QUICK_ACTIONS}
                placeholder="발표를 어떻게 고칠까요?"
                canEdit={canEdit}
              />
            </Suspense>
          </aside>
        ) : (
          <SidePanel tab={tab} setTab={setTab} deck={deck} slide={slide} selEls={selEls} sel={sel} canEdit={canEdit} act={act} stackOf={stackOf} />
        )}
      </div>

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addImages(e.target.files)
          e.target.value = ''
        }}
      />
      {outline && <OutlineDialog themeId={theme.id} hasSlides={deck.slides.length > 0} onClose={() => setOutline(false)} onCreate={createFromOutline} />}
      {present && <Present deck={deck} startIndex={present.start} presenter={present.presenter} onExit={() => setPresent(null)} onPresenterBlocked={() => toast('팝업이 막혀 발표자 보기를 열지 못했습니다. 이 사이트의 팝업을 허용하세요')} />}
      {job && (
        <>
          <div className="sl-export-stage" ref={exportBox} aria-hidden="true">
            {job.slides.map((i) => (
              <SlideView key={deck.slides[i].id} slide={deck.slides[i]} theme={theme} scale={1} mode="export" />
            ))}
          </div>
          <div className="sl-floating sl-floating--job" role="status">
            {{ pdf: 'PDF', pptx: 'PPTX', png: 'PNG', hwpx: '한글 파일' }[job.kind]} 만드는 중 {job.total > 1 ? `${Math.min(job.done + 1, job.total)}/${job.total}` : ''}
          </div>
        </>
      )}
      {shareOpen && (
        <ShareDialog fileId={Number(id)} title={file.title} linkPath={window.location.pathname} onClose={() => { setShareOpen(false); setShareTick((t) => t + 1) }} />
      )}
      <input
        ref={importInput}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          importPptxFile(f)
        }}
      />
      {menu && (
        <div className="sl-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 420) }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          {selEls.length > 0 ? (
            <>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); document.execCommand('copy') }}><Copy size={16} /> 복사</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); document.execCommand('cut') }}><Scissors size={16} /> 잘라내기</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); copyAsImage() }}><ImageDown size={16} /> 이미지로 복사</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); duplicateSel() }}><Copy size={16} /> 복제</button>
              <span className="sl-menu__sep" />
              <button type="button" role="menuitem" onClick={() => { setMenu(null); layer('front') }}><ArrowUpToLine size={16} /> 맨 앞으로</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); layer('back') }}><ArrowDownToLine size={16} /> 맨 뒤로</button>
              <button type="button" role="menuitem" disabled={selEls.length < 2} onClick={() => { setMenu(null); group() }}><Group size={16} /> 묶기</button>
              <button type="button" role="menuitem" disabled={!selEls.some((x) => x.group)} onClick={() => { setMenu(null); ungroup() }}><Ungroup size={16} /> 묶음 풀기</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); makeStack() }}><Rows3 size={16} /> 자동 배치</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); toggleLock() }}><Lock size={16} /> {selEls.every((x) => x.locked) ? '잠금 풀기' : '잠그기'}</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); updateSel((x) => ({ ...x, hidden: true })); setSel([]) }}><EyeOff size={16} /> 숨기기</button>
              <span className="sl-menu__sep" />
              <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenu(null); deleteSel() }}><Trash2 size={16} /> 삭제</button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); setSel(slide?.elements.filter((x) => !x.locked && !x.hidden).map((x) => x.id) || []) }}><Plus size={16} /> 모두 고르기</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(null); setTab('layers') }}><Rows3 size={16} /> 레이어 보기</button>
            </>
          )}
        </div>
      )}
      {linkPop && editing && (
        <div className="sl-linkpop" style={{ left: linkPop.x, top: linkPop.y }} onMouseDown={(e) => e.preventDefault()}>
          <span className="sl-linkpop__url" title={linkPop.href}>{linkPop.href.replace(/^https?:\/\//, '').replace(/^mailto:/, '')}</span>
          <button type="button" title="열기" aria-label="열기" onClick={() => window.open(linkPop.href, '_blank', 'noopener,noreferrer')}><ExternalLink size={15} /></button>
          <button type="button" title="수정" aria-label="수정" onClick={editLink}><Pencil size={15} /></button>
          <button type="button" title="링크 지우기" aria-label="링크 지우기" onClick={unlinkAtCaret}><Unlink size={15} /></button>
        </div>
      )}
    </div>
    </DeckColorsContext.Provider>
  )
}

// 새 슬라이드 고르기 미리보기(레이아웃 변형마다 한 장), 빈 발표의 템플릿 미리보기: 한 번만 만든다
const LAYOUT_PREVIEWS = Object.fromEntries(LAYOUTS.flatMap((L) => L.variants.map((_, v) => [`${L.id}-${v}`, makeSlide(L.id, {}, v)])))
const TEMPLATE_PREVIEWS = Object.fromEntries(SLIDE_TEMPLATE_LIST.map((t) => [t.id, t.build()]))
