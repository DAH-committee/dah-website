// DAH 한글 편집기 (/hwp/:id): 올린 .hwp/.hwpx 를 원본 서식 그대로 보고, 그 자리에서 글을 고치고, AI 와 함께 다룬다.
// 서버 계약: server/src/routes/hwpFiles.README.md
//   쪽 그림(svg)과 영역(regions) -> 눌림 층 -> 블록/표 칸 선택 -> POST /hwp/files/:id/edit (replace_block, replace_cell …)
//   고칠 때마다 서버에 새 버전이 생긴다. 실행취소는 지난 버전을 새 버전으로 복원하는 것이고, 화면은 곧바로 지난 버전을 보여 준다.
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Cloud, FileDown, FileText, Maximize2, MoveHorizontal, Pencil, Redo2, Rows3, ShieldCheck, Sparkles, Undo2, ZoomIn, ZoomOut, History, ScanSearch, ClipboardList, X } from 'lucide-react'
import AccountMenu from '../../components/common/AccountMenu'
import ShareDialog, { useShareIcon } from '../../components/common/ShareDialog'
import NoAccess from '../../components/common/NoAccess'
import { confirmDialog } from '../../components/common/AppDialog'
import { useToast } from '../../components/common/Toast'
import { api } from '../../hooks/useApi'
import { HwpIcon } from '../workspace/icons'
import { getKnowledge } from '../../components/ai/knowledge'
import HwpPageView, { InPlaceEditor } from './HwpPageView'
import { ExportPanel, FieldsPanel, LintPanel, RedactPanel, VersionsPanel } from './HwpPanels'
import { HwpError, hwpApi, hwpCreate } from './hwpApi'
import { createHwpTools } from './aiHwpTools'
import { HWP_QUICK_ACTIONS, buildHwpContext, buildHwpSystemPrompt } from './aiHwpPrompts'
import {
  ERROR_KO, applyLocalEdit, createHistory, editability, errorText, fitScale, indexBlocks, makeEditOp, nearPages, parseCellId, regionsOf, summarizeEdit, textOfSel,
} from './hwpCore'
import './hwpfile.css'

// AI 창(공용 AiPanel). 파일이 없으면 빈 객체라 빌드가 깨지지 않고 AI 단추도 숨긴다.
const AI_PANEL = import.meta.glob('../../components/ai/AiPanel.jsx')
const AI_LOADER = Object.values(AI_PANEL)[0]
const AiPanel = AI_LOADER ? lazy(() => AI_LOADER().then((m) => ({ default: m.default || m.AiPanel }))) : null
const AI_OPEN_KEY = 'dah-ai-open:hwp'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'
const PX = 96 / 72 // pt 하나가 화면 px 로 얼마인가(배율 1.0 = 100%)
const DEFAULT_PAGE = { w: 595.3, h: 841.9 }
const MAX_CACHE_PAGES = 60
const RAIL_TABS = [['pages', '쪽'], ['outline', '개요'], ['tables', '표'], ['fields', '필드']]
const SIDE_TABS = [
  ['fields', '양식 필드', ClipboardList],
  ['lint', '공문 검사', ScanSearch],
  ['versions', '버전', History],
  ['redact', '개인정보', ShieldCheck],
  ['export', '내보내기', FileDown],
]

/* 왼쪽 쪽 그림: 쪽 그림(svg)을 쓴다. 서버의 PNG 작은 그림은 배포 환경에 따라 못 만들 수 있어 기대지 않는다 */
function RailThumb({ n, on, data, onVisible, onGo }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onVisible(n), { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [n, onVisible])
  return (
    <button ref={ref} type="button" className={`hf-thumb${on ? ' is-on' : ''}`} onClick={() => onGo(n)} aria-label={`${n}쪽으로 이동`}>
      {data?.url ? <img src={data.url} alt="" draggable={false} /> : <i className="hf-thumb__wait" />}
      <span>{n}</span>
    </button>
  )
}

function isTyping(el) {
  if (!el) return false
  const t = el.tagName
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable
}

export default function HwpFileEditor() {
  const { id } = useParams()
  const toast = useToast()
  const A = useMemo(() => hwpApi(id), [id])
  const [info, setInfo] = useState(null)
  const [denied, setDenied] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [current, setCurrentState] = useState(0)
  const [viewVersion, setViewState] = useState(0)
  const currentRef = useRef(0)
  const viewRef = useRef(0)
  const [pageCount, setPageCount] = useState(1)
  const [outline, setOutline] = useState(null)
  const [blocks, setBlocksState] = useState(() => new Map())
  const blocksRef = useRef(blocks)
  const [sel, setSelState] = useState(null)
  const selRef = useRef(null)
  const [hover, setHover] = useState(null)
  const [editing, setEditing] = useState(null) // { sel, text, page, rect, bbox }
  const editingRef = useRef(null)
  const [saveState, setSaveState] = useState('saved')
  const [fit, setFit] = useState('width') // 'width' | 'page' | null(직접)
  const [manual, setManual] = useState(1.2)
  const [stage, setStage] = useState({ w: 900, h: 700 })
  const [curPage, setCurPage] = useState(1)
  const [railTab, setRailTab] = useState('pages')
  const [sideTab, setSideTab] = useState('fields')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareTick, setShareTick] = useState(0)
  const [changed, setChanged] = useState(() => new Map())
  const [flagged, setFlagged] = useState(null)
  const [seal, setSeal] = useState(null)
  const [newFile, setNewFile] = useState(null)
  const [, bump] = useReducer((x) => x + 1, 0)
  const [aiOpen, setAiOpenState] = useState(() => {
    try {
      return localStorage.getItem(AI_OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const ShareIcon = useShareIcon(Number(id), shareTick)
  const scroller = useRef(null)
  const pagesRef = useRef(new Map()) // `${version}:${n}` -> { n, w, h, regions, url }
  const latestPage = useRef(new Map()) // n -> 가장 최근 데이터(새 쪽이 오기 전 흐릿하게 보여 줄 때)
  const inflight = useRef(new Set())
  const history = useRef(createHistory()).current
  const queue = useRef(Promise.resolve())
  const blocksCache = useRef(new Map()) // version -> Map
  const sealRef = useRef(null)
  const pendingJump = useRef(null)
  const canEditServer = info?.can_edit === true
  const viewingOld = viewVersion !== current
  const canEdit = canEditServer && !viewingOld
  const canEditRef = useRef(false)
  canEditRef.current = canEdit
  sealRef.current = seal

  const setSel = useCallback((s) => {
    selRef.current = s
    setSelState(s)
  }, [])
  const setBlocks = useCallback((m) => {
    blocksRef.current = m
    setBlocksState(m)
  }, [])
  const setCurrent = useCallback((v) => {
    currentRef.current = v
    setCurrentState(v)
  }, [])
  const setView = useCallback((v) => {
    viewRef.current = v
    setViewState(v)
  }, [])
  const enqueue = useCallback((fn) => {
    const run = queue.current.then(fn, fn)
    queue.current = run.catch(() => {})
    return run
  }, [])

  // ───────────── 불러오기 ─────────────
  const loadBlocks = useCallback(
    async (version, { force = false } = {}) => {
      if (!force && blocksCache.current.has(version)) {
        if (viewRef.current === version) setBlocks(blocksCache.current.get(version))
        return blocksCache.current.get(version)
      }
      const list = []
      let from = 0
      let total = Infinity
      while (from < total && from < 6000) {
        const r = await A.blocks(from, from + 300, version)
        total = r.total ?? 0
        list.push(...(r.blocks || []))
        if (!r.blocks?.length) break
        from += 300
      }
      const map = indexBlocks(list)
      blocksCache.current.set(version, map)
      if (blocksCache.current.size > 8) blocksCache.current.delete(blocksCache.current.keys().next().value)
      if (viewRef.current === version) setBlocks(map)
      return map
    },
    [A, setBlocks]
  )
  const loadOutline = useCallback(
    async (version) => {
      try {
        const o = await A.outline(version)
        if (viewRef.current === version) setOutline(o)
      } catch {
        /* 개요가 없어도 편집은 된다 */
      }
    },
    [A]
  )

  const reloadAll = useCallback(async () => {
    const fi = await A.info()
    setInfo(fi)
    const v = fi.current_version
    pagesRef.current = new Map()
    blocksCache.current = new Map()
    inflight.current = new Set()
    setCurrent(v)
    setView(v)
    setPageCount(fi.page_count || 1)
    await Promise.all([loadBlocks(v, { force: true }), loadOutline(v)])
    bump()
    return v
  }, [A, loadBlocks, loadOutline, setCurrent, setView])

  useEffect(() => {
    let live = true
    reloadAll()
      .then(() => {
        if (live) document.title = `${info?.title || '한글 문서'} | 디인예 워크스페이스`
      })
      .catch((e) => {
        if (!live) return
        if (e.status === 401 || e.status === 403) setDenied('denied')
        else if (e.status === 404) setDenied('missing')
        else setLoadError(errorText(e))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => {
    if (info?.title) document.title = `${info.title} | 디인예 워크스페이스`
  }, [info?.title])

  // ───────────── 쪽 그림 ─────────────
  const pageKey = (v, n) => `${v}:${n}`
  const ensurePages = useCallback(
    async (list, version = viewRef.current) => {
      const need = [...new Set(list)].filter((n) => n >= 1 && !pagesRef.current.has(pageKey(version, n)) && !inflight.current.has(pageKey(version, n))).sort((a, b) => a - b)
      if (!need.length) return
      const groups = []
      for (const n of need) {
        const g = groups[groups.length - 1]
        if (g && n === g[g.length - 1] + 1 && g.length < 3) g.push(n)
        else groups.push([n])
      }
      await Promise.all(
        groups.map(async (g) => {
          g.forEach((n) => inflight.current.add(pageKey(version, n)))
          try {
            const r = await A.pages(g[0], g[g.length - 1], version, { format: 'svg' })
            for (const p of r.pages || []) {
              const url = p.svg ? URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml' })) : p.image || null
              const data = { n: p.n, w: p.width || DEFAULT_PAGE.w, h: p.height || DEFAULT_PAGE.h, regions: p.regions || [], url, version }
              pagesRef.current.set(pageKey(version, p.n), data)
              latestPage.current.set(p.n, data)
            }
            if (r.page_count && viewRef.current === version) setPageCount(r.page_count)
            if (pagesRef.current.size > MAX_CACHE_PAGES) {
              for (const k of [...pagesRef.current.keys()].slice(0, pagesRef.current.size - MAX_CACHE_PAGES)) pagesRef.current.delete(k)
            }
          } catch (e) {
            if (e?.code === 'NOT_FOUND') return
            toast(`쪽을 그리지 못했습니다: ${errorText(e)}`)
          } finally {
            g.forEach((n) => inflight.current.delete(pageKey(version, n)))
            bump()
          }
        })
      )
    },
    [A, toast]
  )
  const wanted = useRef(new Set())
  const flushTimer = useRef(0)
  const onVisible = useCallback(
    (n) => {
      wanted.current.add(n)
      clearTimeout(flushTimer.current)
      flushTimer.current = setTimeout(() => {
        const list = [...wanted.current]
        wanted.current = new Set()
        ensurePages(list)
      }, 40)
    },
    [ensurePages]
  )
  const pageData = useCallback((n) => pagesRef.current.get(pageKey(viewRef.current, n)) || latestPage.current.get(n) || null, [])
  const sizeOf = useCallback(
    (n) => {
      const d = pageData(n) || pageData(1)
      return d ? { w: d.w, h: d.h } : DEFAULT_PAGE
    },
    [pageData]
  )
  // 보는 버전이 바뀌면(실행취소, 지난 버전 보기) 가까운 쪽부터 다시 그린다
  useEffect(() => {
    if (!viewVersion) return
    ensurePages(nearPages(curPage, pageCount, 2), viewVersion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewVersion, pageCount])

  // 보이는 폭에 맞춘 배율
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStage({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [info])
  const first = sizeOf(1)
  const scale = fit ? Math.max(0.3, Math.min(3, fitScale(fit, stage.w, stage.h, first.w * PX, first.h * PX) * PX)) : manual * PX
  const zoomPct = Math.round((scale / PX) * 100)

  // ───────────── 고치기 공통 ─────────────
  const adopt = useCallback(
    (res, prev, { record = true } = {}) => {
      const v = res.version
      setCurrent(v)
      setView(v)
      if (record) history.record(prev)
      if (res.verify?.page_count_after && res.verify.page_count_after !== pageCount) setPageCount(res.verify.page_count_after)
      const near = nearPages(curPage, res.verify?.page_count_after || pageCount, 2)
      const first = res.pages_changed?.length ? res.pages_changed : near
      ensurePages([...new Set([...first.filter((n) => Math.abs(n - curPage) <= 3), ...near])], v)
      loadBlocks(v, { force: true }).then(() => bump())
      loadOutline(v)
      bump()
    },
    [curPage, ensurePages, history, loadBlocks, loadOutline, pageCount, setCurrent, setView]
  )
  const adoptRef = useRef(adopt)
  adoptRef.current = adopt

  /** 패널, 그 자리 편집, AI 가 함께 쓰는 편집 요청(순서대로 하나씩) */
  const runEdit = useCallback(
    (ops, { note, dry_run = false } = {}) =>
      enqueue(async () => {
        if (!dry_run) {
          if (!canEditRef.current) throw new Error('보기 전용이거나 지난 버전을 보는 중이라 고칠 수 없습니다')
          setSaveState('saving')
        }
        const prev = currentRef.current
        const body = { base_version: prev, ops, source: 'user', ...(note ? { note } : {}), ...(dry_run ? { dry_run: true } : {}) }
        try {
          const res = await A.edit(body)
          if (!dry_run) {
            if (res.changed) adoptRef.current(res, prev)
            setSaveState('saved')
          }
          return { res, prev }
        } catch (e) {
          // 서버가 이유를 말하며 거절한 경우(권한, 편집 불가 구조 등)는 저장 실패가 아니다
          if (!dry_run) setSaveState(e?.status && e.status < 500 && e.status !== 429 ? 'saved' : 'error')
          if (e?.code === 'VERSION_CONFLICT') {
            await reloadAll().catch(() => {})
            setSaveState('saved')
            throw new HwpError('VERSION_CONFLICT', ERROR_KO.VERSION_CONFLICT)
          }
          throw e
        }
      }),
    [A, enqueue, reloadAll]
  )

  // 실행취소, 다시 실행, 버전 복원: 화면은 곧바로 그 버전을 보여 주고, 서버에는 새 버전으로 복원한다
  const goToVersion = useCallback(
    (target, { adoptHistory }) =>
      enqueue(async () => {
        setSaveState('saving')
        const from = currentRef.current
        setView(target)
        loadBlocks(target).then(() => bump())
        ensurePages(nearPages(curPage, pageCount, 2), target)
        try {
          const r = await A.restore(target)
          const nv = r.version ?? r.item?.version
          // 새 버전의 쪽 그림은 복원한 버전과 같다
          for (const [k, d] of [...pagesRef.current.entries()]) if (k.startsWith(`${target}:`)) pagesRef.current.set(`${nv}:${k.split(':')[1]}`, d)
          if (blocksCache.current.has(target)) blocksCache.current.set(nv, blocksCache.current.get(target))
          setCurrent(nv)
          setView(nv)
          adoptHistory?.(from, nv)
          loadOutline(nv)
          setSaveState('saved')
          bump()
          return { version: nv }
        } catch (e) {
          setView(from)
          loadBlocks(from).then(() => bump())
          setSaveState('error')
          throw e
        }
      }),
    [A, curPage, ensurePages, enqueue, loadBlocks, loadOutline, pageCount, setCurrent, setView]
  )
  const undo = useCallback(async () => {
    if (!canEditRef.current || !history.canUndo()) return
    const to = history.undo(currentRef.current)
    if (to == null) return
    try {
      await goToVersion(to, {})
    } catch (e) {
      toast(`되돌리지 못했습니다: ${errorText(e)}`)
    }
  }, [goToVersion, history, toast])
  const redo = useCallback(async () => {
    if (!canEditRef.current || !history.canRedo()) return
    const to = history.redo(currentRef.current)
    if (to == null) return
    try {
      await goToVersion(to, {})
    } catch (e) {
      toast(`다시 실행하지 못했습니다: ${errorText(e)}`)
    }
  }, [goToVersion, history, toast])
  const restoreVersion = useCallback(
    async (v) => {
      const prev = currentRef.current
      const r = await goToVersion(v, {})
      history.record(prev)
      return r
    },
    [goToVersion, history]
  )
  const previewVersion = useCallback(
    (v) => {
      const target = v == null ? currentRef.current : v
      setView(target)
      setEditing(null)
      loadBlocks(target).then(() => bump())
      ensurePages(nearPages(curPage, pageCount, 2), target)
      loadOutline(target)
    },
    [curPage, ensurePages, loadBlocks, loadOutline, pageCount, setView]
  )

  // ───────────── 선택, 이동, 편집 ─────────────
  const regionsAll = useCallback(
    (s) => {
      const out = []
      for (let n = 1; n <= pageCount; n += 1) {
        const d = pagesRef.current.get(pageKey(viewRef.current, n))
        if (!d) continue
        for (const r of regionsOf(d.regions, s)) out.push({ page: n, region: r, data: d })
      }
      return out
    },
    [pageCount]
  )
  const scrollToRegion = useCallback(
    (n, region) => {
      const el = scroller.current
      const pageEl = el?.querySelector(`.hf-page[data-page="${n}"]`)
      if (!el || !pageEl) return
      const y = pageEl.offsetTop + (region ? region.bbox.y * scale : 0)
      el.scrollTo({ top: Math.max(0, y - el.clientHeight * 0.3), behavior: 'smooth' })
    },
    [scale]
  )
  const jumpTo = useCallback(
    ({ block, cell }) => {
      if (!block && cell) block = parseCellId(cell)?.table
      if (!block) return
      const s = { block, cell: cell || null, page: blocksRef.current.get(block)?.page || null }
      const found = regionsAll(s)[0]
      if (found) {
        setSel({ ...s, page: found.page })
        scrollToRegion(found.page, found.region)
      } else {
        setSel(s)
        pendingJump.current = s
        if (s.page) {
          scrollToRegion(s.page, null)
          ensurePages([s.page, s.page + 1, s.page - 1])
        }
      }
    },
    [ensurePages, regionsAll, scrollToRegion, setSel]
  )
  // 쪽이 늦게 도착해서 영역을 이제야 알게 된 경우 이어서 이동한다
  useEffect(() => {
    const s = pendingJump.current
    if (!s) return
    const found = regionsAll(s)[0]
    if (found) {
      pendingJump.current = null
      setSel({ ...s, page: found.page })
      scrollToRegion(found.page, found.region)
    }
  })
  const goPage = useCallback(
    (n) => {
      const p = Math.max(1, Math.min(pageCount, n))
      scrollToRegion(p, null)
      ensurePages(nearPages(p, pageCount, 2))
    },
    [ensurePages, pageCount, scrollToRegion]
  )

  const onMove = useCallback((n, region) => {
    setHover((h) => (h && h.page === n && h.region?.id === region?.id ? h : region ? { page: n, region } : null))
  }, [])
  const onLeave = useCallback((n) => setHover((h) => (h && h.page === n ? null : h)), [])
  const onPick = useCallback(
    (n, region) => {
      if (editingRef.current) return
      if (!region) return setSel(null)
      setSel({ block: region.block, cell: region.cell || null, page: n })
    },
    [setSel]
  )

  const beginEdit = useCallback(
    (s) => {
      if (!canEditRef.current) {
        toast(viewRef.current !== currentRef.current ? '지난 버전을 보는 중에는 고칠 수 없습니다' : '보기 권한이라 고칠 수 없습니다')
        return
      }
      const ed = editability(blocksRef.current, s)
      if (!ed.ok) {
        toast(ed.reason)
        return
      }
      const rs = regionsAll(s).filter((x) => x.page === s.page)
      if (!rs.length) return
      const x0 = Math.min(...rs.map((x) => x.region.bbox.x))
      const y0 = Math.min(...rs.map((x) => x.region.bbox.y))
      const x1 = Math.max(...rs.map((x) => x.region.bbox.x + x.region.bbox.width))
      const y1 = Math.max(...rs.map((x) => x.region.bbox.y + x.region.bbox.height))
      const bbox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
      const text = textOfSel(blocksRef.current, s) ?? ''
      const e = { sel: s, text, orig: text, page: s.page, bbox }
      editingRef.current = e
      setEditing(e)
    },
    [regionsAll, toast]
  )
  const onEdit = useCallback(
    (n, region) => {
      if (!region) return
      const s = { block: region.block, cell: region.cell || null, page: n }
      setSel(s)
      beginEdit(s)
    },
    [beginEdit, setSel]
  )
  const cancelEdit = useCallback(() => {
    editingRef.current = null
    setEditing(null)
  }, [])
  const commitEdit = useCallback(async () => {
    const e = editingRef.current
    if (!e) return
    editingRef.current = null
    setEditing(null)
    if (e.text === e.orig) return
    const before = blocksRef.current
    let op
    try {
      op = makeEditOp(before, e.sel, e.text)
    } catch (err) {
      toast(err.message)
      return
    }
    setBlocks(applyLocalEdit(before, e.sel, e.text)) // 곧바로 새 글을 보여 주고, 서버 응답이 틀리면 되돌린다
    try {
      const { res } = await runEdit([op], { note: '직접 고침' })
      if (!res.changed) {
        setBlocks(before)
        const s = res.skipped?.[0]
        toast(s?.message || '바뀐 것이 없습니다')
      }
    } catch (err) {
      setBlocks(before)
      toast(errorText(err))
    }
  }, [runEdit, setBlocks, toast])
  const setEditText = useCallback((text) => {
    if (!editingRef.current) return
    editingRef.current = { ...editingRef.current, text }
    setEditing(editingRef.current)
  }, [])

  // 표에서 선택한 칸 아래에 행 하나 더하기
  const selTable = useMemo(() => {
    if (!sel?.cell) return null
    const p = parseCellId(sel.cell)
    const b = blocks.get(p?.table)
    return p && b?.table ? { ...p, cols: b.table.cols, block: b } : null
  }, [sel, blocks])
  const ops = info?.edit_support?.[info?.format] || null
  const canAddRow = canEdit && selTable && (!ops || ops.includes('table_add_rows'))
  const addRow = useCallback(async () => {
    if (!selTable) return
    try {
      const { res } = await runEdit([{ type: 'table_add_rows', table: selTable.table, after_row: selTable.row, rows: [Array(selTable.cols).fill('')] }], { note: '표에 행 추가' })
      toast(summarizeEdit(res))
    } catch (e) {
      toast(errorText(e))
    }
  }, [runEdit, selTable, toast])

  // ───────────── 내려받기, 이름, AI ─────────────
  const download = useCallback(
    async (format, version = viewRef.current) => {
      const blob = await A.exportBlob(format, version)
      const ext = { md: 'md', txt: 'txt', pdf: 'pdf', docx: 'docx', hwp: 'hwp', hwpx: 'hwpx' }[format] || format
      const base = String(info?.title || '문서').replace(/\.(hwpx?|docx)$/i, '').replace(/[\\/:*?"<>|]/g, '_')
      const name = `${base}.${ext}`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      return name
    },
    [A, info?.title]
  )
  const rename = async (title) => {
    try {
      await api.put(`/workspace/files/${id}`, { title })
      setInfo((f) => ({ ...f, title }))
    } catch (e) {
      toast(`이름을 바꾸지 못했습니다: ${e.message}`)
    }
  }

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
  const openAiWith = useCallback(
    (prompt) => {
      setAiOpen(true)
      setTimeout(() => {
        const ta = document.querySelector('.hf-ai textarea')
        if (!ta) return
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        set.call(ta, prompt)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.focus()
      }, 350)
    },
    [setAiOpen]
  )
  const aiLatest = useRef({})
  aiLatest.current = { undoTo: goToVersion, toast, reloadAll, history, download, restoreVersion }
  const aiTools = useMemo(
    () =>
      createHwpTools({
        api: A,
        getVersion: () => currentRef.current,
        getInfo: () => aiLatest.current.info,
        canEdit: () => canEditRef.current,
        getSelection: () => selRef.current,
        afterEdit: async (res, { prev }) => {
          adoptRef.current(res, prev)
        },
        undoTo: async (prev, expected) => {
          const L = aiLatest.current
          if (currentRef.current !== expected) {
            L.toast(`그 뒤에 고친 내용이 있어 버전 탭에서 되돌려 주세요`)
            return
          }
          const top = L.history.snapshot().undo.slice(-1)[0]
          if (top === prev) L.history.undo(expected)
          await L.undoTo(prev, {})
        },
        refresh: () => aiLatest.current.reloadAll(),
        restoreVersion: (v) => aiLatest.current.restoreVersion(v),
        confirm: (o) => confirmDialog(o),
        getSealImage: () => sealRef.current,
        download: (f, v) => aiLatest.current.download(f, v),
        createFile: hwpCreate,
        announceNewFile: (f) => setNewFile(f),
        rasterizeSvg: async (svg, w, h) => {
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
          try {
            const img = new Image()
            await new Promise((ok, no) => {
              img.onload = ok
              img.onerror = no
              img.src = url
            })
            const k = Math.min(2, 1100 / Math.max(w || img.width, h || img.height))
            const c = document.createElement('canvas')
            c.width = Math.round((w || img.width) * k)
            c.height = Math.round((h || img.height) * k)
            const g = c.getContext('2d')
            g.fillStyle = '#fff'
            g.fillRect(0, 0, c.width, c.height)
            g.drawImage(img, 0, 0, c.width, c.height)
            return c.toDataURL('image/jpeg', 0.85)
          } finally {
            URL.revokeObjectURL(url)
          }
        },
        shrinkImage: async (dataUrl) => {
          try {
            const img = new Image()
            await new Promise((ok, no) => {
              img.onload = ok
              img.onerror = no
              img.src = dataUrl
            })
            const k = Math.min(1, 1100 / Math.max(img.width, img.height))
            const c = document.createElement('canvas')
            c.width = Math.round(img.width * k)
            c.height = Math.round(img.height * k)
            const g = c.getContext('2d')
            g.fillStyle = '#fff'
            g.fillRect(0, 0, c.width, c.height)
            g.drawImage(img, 0, 0, c.width, c.height)
            return c.toDataURL('image/jpeg', 0.82)
          } catch {
            return dataUrl
          }
        },
      }),
    [A]
  )
  aiLatest.current.info = info
  const aiContext = useCallback(() => {
    const s = selRef.current
    return buildHwpContext({
      info: aiLatest.current.info,
      version: currentRef.current,
      selection: s,
      selText: s ? textOfSel(blocksRef.current, s) : null,
      page: curPageRef.current,
      pageCount: pageCountRef.current,
      canEdit: canEditServerRef.current,
      viewingOld: viewRef.current !== currentRef.current,
    })
  }, [])
  const curPageRef = useRef(1)
  curPageRef.current = curPage
  const pageCountRef = useRef(1)
  pageCountRef.current = pageCount
  const canEditServerRef = useRef(false)
  canEditServerRef.current = canEditServer

  // 키보드: ⌘Z 실행취소, ⇧⌘Z 다시, ⌘J AI, Enter 고치기, Esc 선택 해제
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'j' || e.key === 'J') && AiPanel) {
        e.preventDefault()
        setAiOpen((v) => !v)
        return
      }
      const t = e.target
      const inAi = t?.closest?.('.hf-ai') && (!('value' in t) || t.value === '')
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z') && (!isTyping(t) || inAi) && !editingRef.current) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (isTyping(t) || editingRef.current || mod) return
      if (e.key === 'Enter' && selRef.current) {
        e.preventDefault()
        beginEdit(selRef.current)
      } else if (e.key === 'Escape') {
        setSel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [beginEdit, redo, setAiOpen, setSel, undo])

  // 이 줄이 바뀌면 보던 버전이 현재가 아닐 때 선택과 편집을 닫는다
  useEffect(() => {
    if (viewingOld) cancelEdit()
  }, [viewingOld, cancelEdit])

  const sideCtx = {
    api: A, info, blocks, current, viewVersion, canEdit, jumpTo, runEdit, toast, openAiWith, previewVersion, restoreVersion, setChanged, setFlagged, seal, setSeal, download,
  }

  if (denied) return <NoAccess kind="doc" notFound={denied === 'missing'} />
  if (loadError) return <div className="hf-loading">{loadError}</div>
  if (!info) return <div className="hf-loading">불러오는 중</div>

  const pageEl = (
    <HwpPageView
      pageCount={pageCount}
      sizeOf={sizeOf}
      scale={scale}
      pageData={pageData}
      hover={hover}
      sel={sel}
      changed={changed}
      flagged={flagged || new Set()}
      editing={editing}
      editorNode={
        editing
          ? {
              page: editing.page,
              node: (
                <InPlaceEditor
                  rect={{ left: editing.bbox.x * scale, top: editing.bbox.y * scale, width: editing.bbox.width * scale, height: editing.bbox.height * scale }}
                  bbox={editing.bbox}
                  text={editing.text}
                  scale={scale}
                  busy={false}
                  onChange={setEditText}
                  onCommit={commitEdit}
                  onCancel={cancelEdit}
                />
              ),
            }
          : null
      }
      onVisible={onVisible}
      onMove={onMove}
      onLeave={onLeave}
      onPick={onPick}
      onEdit={onEdit}
      scrollRef={scroller}
      onScrollPage={setCurPage}
    />
  )

  const saveLabel = { saved: `저장됨 · v${current}`, saving: '저장 중', error: '저장 실패' }[saveState]
  const headings = outline?.headings || []
  const tablesList = outline?.tables || []
  const fieldsList = outline?.fields || []

  return (
    <div className="hf-root reading-scope">
      <div className="ed-row">
        <Link to="/workspace/hwp" aria-label="한글 홈" title="한글 홈" className="ed-icon">
          <HwpIcon size={40} />
        </Link>
        {canEditServer ? (
          <input
            defaultValue={info.title}
            key={info.title}
            aria-label="파일 이름"
            className="ed-title"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== info.title) rename(v)
              else e.target.value = info.title
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          <h1 className="ed-title !cursor-default truncate">{info.title}</h1>
        )}
        <span role="status" aria-live="polite" className={`ed-status ${saveState === 'error' ? 'hf-status-error' : ''}`}>
          <Cloud size={16} aria-hidden="true" />
          {canEditServer ? saveLabel : '보기 전용'}
        </span>
        <div className="hf-row-right">
          {AiPanel && (
            <button type="button" className={`hf-ai-btn ${aiOpen ? 'is-on' : ''}`} aria-pressed={aiOpen} onClick={() => setAiOpen((v) => !v)} title={`AI 창 (${MOD}J)`}>
              <Sparkles size={16} aria-hidden="true" /> AI
            </button>
          )}
          <button type="button" className="ed-share" onClick={() => setShareOpen(true)}>
            <ShareIcon size={16} aria-hidden="true" /> 공유
          </button>
          <AccountMenu size={40} />
        </div>
      </div>

      <div role="toolbar" aria-label="한글 도구 모음" className="hf-toolbar">
        <button type="button" className="hf-tb" onClick={undo} disabled={!canEdit || !history.canUndo()} title={`실행취소 (${MOD}Z)`} aria-label="실행취소">
          <Undo2 size={18} />
        </button>
        <button type="button" className="hf-tb" onClick={redo} disabled={!canEdit || !history.canRedo()} title={`다시 실행 (⇧${MOD}Z)`} aria-label="다시 실행">
          <Redo2 size={18} />
        </button>
        <i className="hf-sep" />
        <button type="button" className="hf-tb" onClick={() => { setFit(null); setManual(Math.max(0.4, +(scale / PX - 0.1).toFixed(2))) }} title="축소" aria-label="축소">
          <ZoomOut size={18} />
        </button>
        <span className="hf-zoom" aria-live="polite">{zoomPct}%</span>
        <button type="button" className="hf-tb" onClick={() => { setFit(null); setManual(Math.min(3, +(scale / PX + 0.1).toFixed(2))) }} title="확대" aria-label="확대">
          <ZoomIn size={18} />
        </button>
        <button type="button" className={`hf-tb${fit === 'width' ? ' is-on' : ''}`} onClick={() => setFit('width')} title="폭에 맞춤" aria-label="폭에 맞춤" aria-pressed={fit === 'width'}>
          <MoveHorizontal size={18} />
        </button>
        <button type="button" className={`hf-tb${fit === 'page' ? ' is-on' : ''}`} onClick={() => setFit('page')} title="쪽에 맞춤" aria-label="쪽에 맞춤" aria-pressed={fit === 'page'}>
          <Maximize2 size={18} />
        </button>
        <i className="hf-sep" />
        <button type="button" className="hf-tb hf-tb--text" onClick={() => sel && beginEdit(sel)} disabled={!canEdit || !sel} title="선택한 곳의 글 고치기 (Enter)">
          <Pencil size={16} /> 글 고치기
        </button>
        <button type="button" className="hf-tb hf-tb--text" onClick={addRow} disabled={!canAddRow} title={selTable ? `표 ${selTable.row + 1}행 아래에 행 추가` : '표 칸을 먼저 선택하세요'}>
          <Rows3 size={16} /> 아래에 행 추가
        </button>
        <span className="hf-pageno">
          {curPage} / {pageCount}쪽{info.render_mode === 'reflow' ? ' · 자체 조판' : ''}
        </span>
      </div>

      {viewingOld && (
        <div className="hf-banner" role="status">
          <History size={16} />
          <span>지난 버전 v{viewVersion} 을 보는 중입니다. 고칠 수 없습니다.</span>
          <button type="button" className="hf-btn hf-btn--sm" onClick={() => previewVersion(null)}>
            현재 버전으로
          </button>
          {canEditServer && (
            <button type="button" className="hf-btn hf-btn--sm hf-btn--primary" onClick={() => restoreVersion(viewVersion).then(() => toast(`v${viewVersion} 내용으로 되돌렸습니다`)).catch((e) => toast(errorText(e)))}>
              이 버전으로 복원
            </button>
          )}
        </div>
      )}

      <div className="hf-body">
        <aside className="hf-rail" aria-label="쪽과 개요">
          <div className="hf-tabs" role="tablist">
            {RAIL_TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={railTab === k} className={railTab === k ? 'is-on' : ''} onClick={() => setRailTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="hf-rail__list">
            {railTab === 'pages' &&
              Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <RailThumb key={n} n={n} on={curPage === n} data={pageData(n)} onVisible={onVisible} onGo={goPage} />
              ))}
            {railTab === 'outline' &&
              (headings.length ? (
                headings.map((h, i) => (
                  <button key={i} type="button" className="hf-outline" style={{ paddingLeft: 10 + Math.max(0, (h.level || 1) - 1) * 12 }} onClick={() => jumpTo({ block: h.block })} title={h.text}>
                    <span>{h.text}</span>
                    {h.page ? <em>{h.page}</em> : null}
                  </button>
                ))
              ) : (
                <p className="hf-empty">제목으로 인식된 줄이 없습니다.</p>
              ))}
            {railTab === 'tables' &&
              (tablesList.length ? (
                tablesList.map((t, i) => (
                  <button key={i} type="button" className="hf-outline" onClick={() => jumpTo({ block: t.block })}>
                    <span>
                      표 {i + 1}: {t.rows}행 {t.cols}열{(t.header || []).length ? ` · ${(t.header || []).filter(Boolean).slice(0, 3).join(', ')}` : ''}
                    </span>
                    {t.page ? <em>{t.page}</em> : null}
                  </button>
                ))
              ) : (
                <p className="hf-empty">표가 없습니다.</p>
              ))}
            {railTab === 'fields' &&
              (fieldsList.length ? (
                fieldsList.map((f, i) => (
                  <button key={i} type="button" className="hf-outline" onClick={() => jumpTo({ block: f.block, cell: f.cell })}>
                    <span>{f.name}</span>
                    <em>{f.empty ? '비어 있음' : '값 있음'}</em>
                  </button>
                ))
              ) : (
                <p className="hf-empty">양식 칸이 없습니다.</p>
              ))}
          </div>
        </aside>

        <main className={`hf-stage${canEdit ? '' : ' is-readonly'}`} ref={scroller} aria-label="문서 보기">
          {pageEl}
          {!canEditServer && <div className="hf-float">보기 전용입니다</div>}
        </main>

        {aiOpen && AiPanel ? (
          <div className="hf-ai">
            <Suspense fallback={<div className="hf-ai__loading">불러오는 중</div>}>
              <AiPanel
                open
                onClose={() => setAiOpen(false)}
                scope={`hwp:${id}`}
                title="한글 AI"
                systemPrompt={buildHwpSystemPrompt(getKnowledge('hwp'))}
                tools={aiTools}
                getContext={aiContext}
                quickActions={HWP_QUICK_ACTIONS}
                placeholder="문서를 어떻게 고칠까요?"
                canEdit={canEditServer}
              />
            </Suspense>
          </div>
        ) : (
          <aside className="hf-side" aria-label="도구 패널">
            <div className="hf-tabs hf-tabs--side" role="tablist">
              {SIDE_TABS.map(([k, label, Ico]) => (
                <button key={k} type="button" role="tab" aria-selected={sideTab === k} className={sideTab === k ? 'is-on' : ''} onClick={() => setSideTab(k)} title={label}>
                  <Ico size={16} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="hf-side__body">
              {sideTab === 'fields' && <FieldsPanel ctx={sideCtx} />}
              {sideTab === 'lint' && <LintPanel ctx={sideCtx} />}
              {sideTab === 'versions' && <VersionsPanel ctx={sideCtx} />}
              {sideTab === 'redact' && <RedactPanel ctx={sideCtx} />}
              {sideTab === 'export' && <ExportPanel ctx={sideCtx} />}
            </div>
          </aside>
        )}
      </div>

      {newFile && (
        <div className="hf-newfile" role="status">
          <FileText size={18} />
          <span>새 문서 "{newFile.title}" 를 만들었습니다</span>
          <a href={`/hwp/${newFile.id}`} target="_blank" rel="noreferrer" className="hf-btn hf-btn--sm hf-btn--primary">
            열기
          </a>
          <button type="button" className="hf-iconbtn" aria-label="닫기" onClick={() => setNewFile(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {shareOpen && <ShareDialog fileId={Number(id)} title={info.title} linkPath={window.location.pathname} onClose={() => { setShareOpen(false); setShareTick((t) => t + 1) }} />}
    </div>
  )
}
