// SheetWorkspace.jsx: 구글 시트와 같은 모양과 동작의 관리자 시트.
//
// 구글 시트를 직접 열어 확인한 구조를 그대로 옮겼다.
//   제목 줄 → 메뉴 막대(파일, 수정, 보기, 삽입, 서식, 데이터) → 도구 모음 → 수식 입력줄(칸 이름 + 내용)
//   → 열 글자(A, B, C) 줄 + 머리글 줄 + 행 번호 → 아래쪽 시트 탭과 선택 요약.
//
// 칸을 고치면 곧바로 서버에 저장되고(onEditCell), 열 너비, 숨긴 열, 서식, 메모 열 같은 화면 상태는
// 잠시 모아서 서버에 저장한다(/admin/sheets/:key/state). 그래서 다른 기기에서 열어도 같은 모양이다.
//
// 레이아웃 불변 계약(37 절대원칙 4): 열 폭은 colgroup + table-layout:fixed로 고정하고, 넘치는 폭은
// 표 래퍼 안쪽 가로 스크롤로 가둔다. 필터 패널과 토스트는 표를 움직이지 않는다.
// 간격은 토큰 스케일만 쓰고, 색은 reading 토큰과 state 토큰만 쓴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Filter, Maximize, PaintBucket, Plus, Printer,
  Redo2, RefreshCw, Search, Sheet as SheetIcon, Trash2, Undo2, WrapText, X,
} from 'lucide-react'
import ColumnFilter from '../../common/ColumnFilter'
import { useToast } from '../../common/Toast'
import { api } from '../../../hooks/useApi'
import { Link } from 'react-router-dom'
import { SheetsIcon } from '../../../pages/workspace/icons'
import SheetMenuBar from './SheetMenuBar'
import {
  ALIGN_CLASS, FILL_COLORS, FONT_SIZES, TEXT_COLORS, ZOOMS, a1, colLetter, download, normalizeSheetUi,
  numericSum, parseTsv, rangeName, toCsv, toSpreadsheetML, toTsv,
} from './sheetUtils'

const DEFAULT_WIDTH = 180
const ROWNUM_W = 46
const LETTER_H = 24
const MIN_ROWS = 20
const MAX_FILLER_ROWS = 200
const FALLBACK_ROW_H = 24
const SAVE_DELAY_MS = 900

const CELL_LINE = 'border-b border-r border-reading-hairline'
const TB_BTN =
  'flex h-32 w-32 shrink-0 cursor-pointer items-center justify-center rounded-sm text-reading-text transition-colors duration-fast ease-out hover:bg-reading-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-reading-accent disabled:cursor-default disabled:text-reading-textMeta disabled:opacity-50 disabled:hover:bg-transparent aria-pressed:bg-reading-subtle aria-pressed:text-reading-accent'
const INPUT_CLS =
  'h-40 w-full min-w-0 rounded-sm border border-reading-hairline bg-reading-surface px-12 text-small-m text-reading-text outline-none focus:border-reading-accent'
const DIALOG_BTN =
  'inline-flex h-40 cursor-pointer items-center justify-center gap-8 rounded-sm bg-reading-subtle px-16 text-small-m font-semibold text-reading-text transition-colors duration-fast ease-out hover:bg-reading-hairline disabled:cursor-default disabled:opacity-50'
const DIALOG_PRIMARY =
  'inline-flex h-40 cursor-pointer items-center justify-center gap-8 rounded-sm bg-reading-accent px-16 text-small-m font-semibold text-reading-bg transition-colors duration-fast ease-out hover:bg-reading-accentStrong disabled:cursor-default disabled:opacity-50'

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function Divider() {
  return <span aria-hidden="true" className="mx-4 h-16 w-px shrink-0 bg-reading-hairline" />
}

/** 작은 팝업(색 고르기, 확대 비율). 바깥을 누르면 닫힌다 */
function Pop({ label, trigger, children, wide = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const key = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} title={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${TB_BTN} ${wide ? '!w-auto whitespace-nowrap px-8' : ''}`}>
        {trigger}
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-40 rounded-sm border border-reading-hairline bg-reading-surface p-8 shadow-[0_8px_24px_rgb(33_26_49/0.18)]">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function Dialog({ title, onClose, children, footer }) {
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-reading-text/40 px-16 py-80" onMouseDown={onClose}>
      <div className="w-full max-w-[480px] rounded-md border border-reading-hairline bg-reading-bg text-reading-text" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-12 border-b border-reading-hairline px-24 py-16">
          <h2 className="text-body-l-m font-bold text-reading-textStrong md:text-body-l-d">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className={TB_BTN}>
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-16 px-24 py-20">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-8 border-t border-reading-hairline px-24 py-16">{footer}</div>}
      </div>
    </div>
  )
}

export default function SheetWorkspace({
  title,
  stateKey,
  sheets,
  loading,
  error,
  updatedAt,
  onRefresh,
  onEditCell,
  onInsertRow,
  onDeleteRows,
  exportName = '접수 현황',
  homeHref,
  onRenameFile,
}) {
  const showToast = useToast()
  const [sheetId, setSheetId] = useState(sheets[0]?.id)
  const sheet = sheets.find((s) => s.id === sheetId) || sheets[0]
  const rowId = (row) => String(row.id)

  // ── 화면 상태(서버에 저장) ─────────────────────────────────
  const [allUi, setAllUi] = useState({})
  const [uiLoaded, setUiLoaded] = useState(false)
  const [saveState, setSaveState] = useState('saved') // saved | dirty | saving | error
  const dirtyRef = useRef(false)
  const ui = useMemo(() => normalizeSheetUi(allUi[sheet.id]), [allUi, sheet.id])

  useEffect(() => {
    let alive = true
    api
      .get(`/admin/sheets/${stateKey}/state`)
      .then((res) => {
        if (alive && res?.state && typeof res.state === 'object') setAllUi(res.state)
      })
      .catch(() => {})
      .finally(() => alive && setUiLoaded(true))
    return () => {
      alive = false
    }
  }, [stateKey])

  const setUi = useCallback(
    (patch) => {
      setAllUi((prev) => {
        const cur = normalizeSheetUi(prev[sheet.id])
        const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }
        return { ...prev, [sheet.id]: next }
      })
      dirtyRef.current = true
      setSaveState('dirty')
    },
    [sheet.id]
  )

  useEffect(() => {
    if (!uiLoaded || saveState !== 'dirty') return undefined
    const t = setTimeout(async () => {
      setSaveState('saving')
      try {
        await api.put(`/admin/sheets/${stateKey}/state`, { state: allUi })
        dirtyRef.current = false
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [allUi, saveState, uiLoaded, stateKey])

  // ── 열과 행 ────────────────────────────────────────────────
  const allCols = useMemo(() => {
    const custom = sheet.allowCustom
      ? ui.customCols.map((c) => ({
          key: c.key,
          label: c.label,
          custom: true,
          get: (row) => String(ui.customValues[rowId(row)]?.[c.key] ?? ''),
        }))
      : []
    return [...sheet.columns, ...custom]
  }, [sheet.columns, sheet.allowCustom, ui.customCols, ui.customValues])
  const columns = useMemo(() => allCols.filter((c) => !ui.hidden.includes(c.key)), [allCols, ui.hidden])
  const letterOf = useCallback((col) => colLetter(allCols.findIndex((c) => c.key === col.key)), [allCols])
  const widthOf = useCallback((col) => ui.widths[col.key] || col.width || DEFAULT_WIDTH, [ui.widths])
  const tableWidth = useMemo(() => columns.reduce((sum, c) => sum + widthOf(c), 0), [columns, widthOf])

  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState(null)

  const filterValues = useMemo(() => {
    const map = {}
    for (const col of columns) {
      const set = new Set()
      for (const row of sheet.rows) set.add(col.get(row))
      map[col.key] = [...set].sort((a, b) => a.localeCompare(b, 'ko'))
    }
    return map
  }, [columns, sheet.rows])

  const visibleRows = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    let list = sheet.rows
    for (const col of columns) {
      const picked = filters[col.key]
      if (picked instanceof Set) list = list.filter((r) => picked.has(col.get(r)))
    }
    if (keyword) list = list.filter((r) => columns.some((c) => c.get(r).toLowerCase().includes(keyword)))
    if (!sort) return list
    const col = allCols.find((c) => c.key === sort.key)
    if (!col) return list
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const av = col.get(a)
      const bv = col.get(b)
      const an = Number(av)
      const bn = Number(bv)
      if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir
      return av.localeCompare(bv, 'ko') * dir
    })
  }, [sheet.rows, columns, allCols, filters, q, sort])

  // 자주 쓰는 최신 값은 ref에 둔다(되돌리기 같은 비동기 동작이 오래된 값을 쥐지 않게)
  const latest = useRef({})
  latest.current = { rows: sheet.rows, allCols, ui, setUi }

  // ── 선택, 편집 ─────────────────────────────────────────────
  const [dialog, setDialog] = useState(null) // { type:'text', ... } | { type:'find' } | { type:'export' }
  const [sel, setSel] = useState(null) // { anchor:{r,c}, focus:{r,c} }
  const [editing, setEditingState] = useState(null) // { r, c, value, orig }
  // 확정과 흐림(blur)이 거의 동시에 와도 한 번만 저장하도록 ref에도 둔다
  const editingRef = useRef(null)
  const setEditing = (v) => {
    editingRef.current = v
    setEditingState(v)
  }
  const gridRef = useRef(null)
  // 선택한 칸 안에 늘 들어 있는 입력칸. 키 입력(한글 조합 포함)을 받아 편집 모드로 바꾼다
  const proxyRef = useRef(null)
  const dragging = useRef(false)

  const bounds = useMemo(
    () =>
      sel && {
        r0: Math.min(sel.anchor.r, sel.focus.r),
        r1: Math.max(sel.anchor.r, sel.focus.r),
        c0: Math.min(sel.anchor.c, sel.focus.c),
        c1: Math.max(sel.anchor.c, sel.focus.c),
      },
    [sel]
  )
  const inRange = (r, c) => bounds && r >= bounds.r0 && r <= bounds.r1 && c >= bounds.c0 && c <= bounds.c1
  const active = sel?.anchor
  const activeRow = active ? visibleRows[active.r] : null
  const activeCol = active ? columns[active.c] : null
  const activeValue = activeRow && activeCol ? activeCol.get(activeRow) : ''
  const fmtKey = (row, col) => `${rowId(row)}|${col.key}`

  const canEdit = (col) => Boolean(col && sheet.editable && (col.custom || (col.patch && onEditCell)))

  // ── 되돌리기 / 다시 실행 ───────────────────────────────────
  const hist = useRef({ undo: [], redo: [] })
  const [, bump] = useState(0)
  const pushHistory = (entry) => {
    hist.current.undo.push(entry)
    if (hist.current.undo.length > 100) hist.current.undo.shift()
    hist.current.redo = []
    bump((n) => n + 1)
  }
  const undo = async () => {
    const e = hist.current.undo.pop()
    if (!e) return
    try {
      await e.undo()
      hist.current.redo.push(e)
    } catch (err) {
      showToast(err.message || '되돌리지 못했습니다')
    }
    bump((n) => n + 1)
  }
  const redo = async () => {
    const e = hist.current.redo.pop()
    if (!e) return
    try {
      await e.redo()
      hist.current.undo.push(e)
    } catch (err) {
      showToast(err.message || '다시 실행하지 못했습니다')
    }
    bump((n) => n + 1)
  }

  // 칸 값을 실제로 바꾼다. 접수 칸은 서버에, 메모 열은 화면 상태에 쓴다.
  const writeCell = useCallback(
    async (id, colKey, value) => {
      const { rows, allCols: cols, setUi: update } = latest.current
      const col = cols.find((c) => c.key === colKey)
      const row = rows.find((r) => rowId(r) === id)
      if (!col || !row) throw new Error('칸을 찾을 수 없습니다')
      if (col.custom) {
        update((cur) => ({ ...cur, customValues: { ...cur.customValues, [id]: { ...(cur.customValues[id] || {}), [colKey]: value } } }))
      } else {
        await onEditCell(row, col, value)
      }
    },
    [onEditCell]
  )

  /** 여러 칸을 한 번에 바꾸고 되돌리기 한 줄로 묶는다. changes: [{row, col, value}] */
  const applyChanges = async (changes, label) => {
    const done = []
    for (const ch of changes) {
      const before = ch.col.get(ch.row)
      if (before === ch.value) continue
      try {
        await writeCell(rowId(ch.row), ch.col.key, ch.value)
        done.push({ id: rowId(ch.row), key: ch.col.key, before, after: ch.value })
      } catch (err) {
        showToast(err.hint ? `${err.message} (${err.hint})` : err.message || '저장하지 못했습니다')
        break
      }
    }
    if (done.length) {
      pushHistory({
        label,
        undo: async () => {
          for (const d of [...done].reverse()) await writeCell(d.id, d.key, d.before)
        },
        redo: async () => {
          for (const d of done) await writeCell(d.id, d.key, d.after)
        },
      })
    }
    return done.length
  }

  const startEdit = (r, c, initial) => {
    const row = visibleRows[r]
    const col = columns[c]
    if (!col) return
    // 빈 행: 여기에 입력하면 새 접수가 만들어진다(구글 시트에서 빈 줄에 쓰는 것과 같은 동작)
    if (!row) {
      if (!sheet.editable || !onInsertRow || !(col.custom || col.patch)) {
        showToast('이 칸은 고칠 수 없습니다')
        return
      }
      setEditing({ r, c, value: initial ?? '', orig: '', filler: true })
      return
    }
    if (!canEdit(col)) {
      showToast('이 칸은 고칠 수 없습니다')
      return
    }
    const orig = col.get(row)
    setEditing({ r, c, value: initial ?? orig, orig })
  }

  const focusGrid = () => (proxyRef.current || gridRef.current)?.focus({ preventScroll: true })

  const select = (r, c, extend = false) => {
    const nr = clamp(r, 0, Math.max(0, visibleRows.length + fillerCount - 1))
    const nc = clamp(c, 0, Math.max(0, columns.length - 1))
    setSel((prev) => (extend && prev ? { anchor: prev.anchor, focus: { r: nr, c: nc } } : { anchor: { r: nr, c: nc }, focus: { r: nr, c: nc } }))
  }

  const commitEdit = async (dr = 0, dc = 0, { move = true } = {}) => {
    const cur = editingRef.current
    if (!cur) return
    setEditing(null)
    const row = visibleRows[cur.r]
    const col = columns[cur.c]
    if (cur.filler) {
      if (move) {
        select(cur.r + dr, cur.c + dc)
        focusGrid()
      }
      if (!col || !cur.value.trim()) return
      try {
        const entry = await onInsertRow()
        if (col.custom) {
          latest.current.setUi((ui0) => ({ ...ui0, customValues: { ...ui0.customValues, [String(entry.id)]: { ...(ui0.customValues[String(entry.id)] || {}), [col.key]: cur.value } } }))
        } else {
          await onEditCell(entry, col, cur.value)
        }
        select(0, cur.c)
      } catch (err) {
        showToast(err.hint ? `${err.message} (${err.hint})` : err.message || '저장하지 못했습니다')
      }
      return
    }
    if (move) {
      select(cur.r + dr, cur.c + dc)
      focusGrid()
    }
    if (row && col && cur.value !== cur.orig) await applyChanges([{ row, col, value: cur.value }], '칸 수정')
  }
  const cancelEdit = () => {
    setEditing(null)
    focusGrid()
  }

  // 선택한 칸이 바뀌거나 편집이 시작되면 그 칸의 입력칸이 키보드를 받는다(대화상자가 열려 있으면 건드리지 않는다)
  useEffect(() => {
    if (!active || dialog) return
    const el = proxyRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (editing) el.setSelectionRange(el.value.length, el.value.length)
  }, [active?.r, active?.c, editing?.r, editing?.c, dialog]) // eslint-disable-line react-hooks/exhaustive-deps

  // 선택한 칸을 화면 안으로
  useEffect(() => {
    if (!active) return
    gridRef.current?.querySelector(`[data-cell="${active.r}-${active.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active?.r, active?.c]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 복사, 잘라내기, 붙여넣기, 지우기 ───────────────────────
  const selectionMatrix = () => {
    if (!bounds) return []
    const out = []
    for (let r = bounds.r0; r <= bounds.r1; r += 1) {
      const row = visibleRows[r]
      if (!row) continue
      const line = []
      for (let c = bounds.c0; c <= bounds.c1; c += 1) line.push(columns[c] ? columns[c].get(row) : '')
      out.push(line)
    }
    return out
  }
  const clearSelection = async () => {
    if (!bounds) return
    const changes = []
    for (let r = bounds.r0; r <= bounds.r1; r += 1)
      for (let c = bounds.c0; c <= bounds.c1; c += 1)
        if (visibleRows[r] && canEdit(columns[c])) changes.push({ row: visibleRows[r], col: columns[c], value: '' })
    if (!changes.length) return showToast('지울 수 있는 칸이 없습니다')
    await applyChanges(changes, '지우기')
  }
  const copyText = () => toTsv(selectionMatrix())
  const copyToClipboard = async () => {
    if (!bounds) return
    try {
      await navigator.clipboard.writeText(copyText())
      showToast('선택한 칸을 복사했습니다')
    } catch {
      showToast('복사하지 못했습니다')
    }
  }
  const pasteMatrix = async (matrix) => {
    if (!active || !matrix.length) return
    const changes = []
    let skipped = 0
    matrix.forEach((line, i) =>
      line.forEach((value, j) => {
        const row = visibleRows[active.r + i]
        const col = columns[active.c + j]
        if (!row || !col) return
        if (canEdit(col)) changes.push({ row, col, value })
        else skipped += 1
      })
    )
    const n = await applyChanges(changes, '붙여넣기')
    showToast(`${n}칸을 붙여넣었습니다${skipped ? `. 고칠 수 없는 ${skipped}칸은 건너뛰었습니다` : ''}`)
  }
  const pasteFromClipboard = async () => {
    try {
      pasteMatrix(parseTsv(await navigator.clipboard.readText()))
    } catch {
      showToast('붙여넣으려면 키보드 ⌘V 또는 Ctrl+V를 눌러 주세요')
    }
  }

  // ── 서식 ───────────────────────────────────────────────────
  const formatTargets = () => {
    if (!bounds) return []
    const keys = []
    for (let r = bounds.r0; r <= bounds.r1; r += 1)
      for (let c = bounds.c0; c <= bounds.c1; c += 1) if (visibleRows[r] && columns[c]) keys.push(fmtKey(visibleRows[r], columns[c]))
    return keys
  }
  const applyFormat = (patchOf) => {
    const keys = formatTargets()
    if (!keys.length) return showToast('먼저 칸을 선택해 주세요')
    const before = ui.formats
    const next = { ...before }
    for (const k of keys) {
      const merged = { ...(next[k] || {}), ...patchOf(next[k] || {}) }
      for (const f of Object.keys(merged)) if (merged[f] === '' || merged[f] === false || merged[f] == null) delete merged[f]
      if (Object.keys(merged).length) next[k] = merged
      else delete next[k]
    }
    setUi((cur) => ({ ...cur, formats: next }))
    pushHistory({
      label: '서식',
      undo: async () => latest.current.setUi((cur) => ({ ...cur, formats: before })),
      redo: async () => latest.current.setUi((cur) => ({ ...cur, formats: next })),
    })
  }
  const allHave = (field, value) => {
    const keys = formatTargets()
    return keys.length > 0 && keys.every((k) => (value === undefined ? Boolean(ui.formats[k]?.[field]) : ui.formats[k]?.[field] === value))
  }
  const toggleBold = () => applyFormat(() => ({ b: !allHave('b') }))
  const clearFormat = () => {
    const keys = formatTargets()
    if (!keys.length) return showToast('먼저 칸을 선택해 주세요')
    const before = ui.formats
    const next = { ...before }
    for (const k of keys) delete next[k]
    setUi((cur) => ({ ...cur, formats: next }))
    pushHistory({ label: '서식 지우기', undo: async () => latest.current.setUi((c) => ({ ...c, formats: before })), redo: async () => latest.current.setUi((c) => ({ ...c, formats: next })) })
  }

  // ── 행, 열 ─────────────────────────────────────────────────
  const selectedRows = () => (bounds ? visibleRows.slice(bounds.r0, bounds.r1 + 1) : [])
  const deleteSelectedRows = async () => {
    const rows = selectedRows()
    if (!rows.length) return showToast('지울 행을 선택해 주세요')
    if (!window.confirm(`선택한 ${rows.length}개 행을 삭제할까요? 접수 내용이 지워지고 되돌릴 수 없습니다.`)) return
    try {
      await onDeleteRows(rows)
      setSel(null)
      showToast(`${rows.length}개 행을 삭제했습니다`)
    } catch (err) {
      showToast(err.message || '삭제하지 못했습니다')
    }
  }
  const insertRow = async () => {
    try {
      await onInsertRow()
      select(0, 0)
      showToast('빈 접수 행을 추가했습니다')
    } catch (err) {
      showToast(err.message || '행을 추가하지 못했습니다')
    }
  }
  const deleteCustomColumns = () => {
    if (!bounds) return showToast('먼저 열을 선택해 주세요')
    const keys = columns.slice(bounds.c0, bounds.c1 + 1).filter((c) => c.custom).map((c) => c.key)
    if (!keys.length) return showToast('선택한 열에 삭제할 메모 열이 없습니다')
    if (!window.confirm(`메모 열 ${keys.length}개를 삭제할까요? 열에 적은 내용도 함께 지워집니다.`)) return
    setUi((cur) => ({
      ...cur,
      customCols: cur.customCols.filter((c) => !keys.includes(c.key)),
      customValues: Object.fromEntries(
        Object.entries(cur.customValues).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)))])
      ),
    }))
    setSel(null)
  }
  const hideSelectedColumns = () => {
    if (!bounds) return showToast('먼저 열을 선택해 주세요')
    const keys = columns.slice(bounds.c0, bounds.c1 + 1).map((c) => c.key)
    if (keys.length >= columns.length) return showToast('모든 열을 숨길 수는 없습니다')
    setUi((cur) => ({ ...cur, hidden: [...new Set([...cur.hidden, ...keys])] }))
    setSel(null)
  }

  // ── 대화상자 ───────────────────────────────────────────────
  const askText = (opts) => setDialog({ type: 'text', ...opts })
  const addCustomColumn = () =>
    askText({
      title: '메모 열 추가',
      label: '열 이름',
      value: '',
      okLabel: '추가',
      onOk: (value) => {
        const label = value.trim()
        if (!label) return
        setUi((cur) => ({ ...cur, customCols: [...cur.customCols, { key: `custom:${Date.now().toString(36)}`, label: label.slice(0, 40) }] }))
      },
    })
  const addNote = () => {
    if (!activeRow || !activeCol) return showToast('먼저 칸을 선택해 주세요')
    const k = fmtKey(activeRow, activeCol)
    askText({
      title: `${a1(active.r, active.c)} 메모`,
      label: '메모 내용 (비우면 메모가 삭제됩니다)',
      value: ui.notes[k] || '',
      okLabel: '저장',
      multiline: true,
      onOk: (value) =>
        setUi((cur) => {
          const notes = { ...cur.notes }
          if (value.trim()) notes[k] = value.trim().slice(0, 500)
          else delete notes[k]
          return { ...cur, notes }
        }),
    })
  }

  // ── 찾기와 바꾸기 ──────────────────────────────────────────
  const [find, setFind] = useState({ text: '', replace: '', matchCase: false })
  const matches = useMemo(() => {
    const needle = find.matchCase ? find.text : find.text.toLowerCase()
    if (!needle) return []
    const out = []
    visibleRows.forEach((row, r) =>
      columns.forEach((col, c) => {
        const v = find.matchCase ? col.get(row) : col.get(row).toLowerCase()
        if (v.includes(needle)) out.push({ r, c })
      })
    )
    return out
  }, [find.text, find.matchCase, visibleRows, columns])
  const matchSet = useMemo(() => new Set(matches.map((m) => `${m.r}-${m.c}`)), [matches])
  const goMatch = (dir) => {
    if (!matches.length) return
    const at = active ? matches.findIndex((m) => m.r === active.r && m.c === active.c) : -1
    const next = matches[(at + dir + matches.length) % matches.length]
    select(next.r, next.c)
  }
  const replaceText = (value) => {
    const re = new RegExp(find.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), find.matchCase ? 'g' : 'gi')
    return value.replace(re, () => find.replace)
  }
  const replaceCurrent = async () => {
    if (!active || !activeRow || !canEdit(activeCol) || !matchSet.has(`${active.r}-${active.c}`)) return goMatch(1)
    await applyChanges([{ row: activeRow, col: activeCol, value: replaceText(activeValue) }], '바꾸기')
    goMatch(1)
  }
  const replaceAll = async () => {
    const changes = matches
      .filter((m) => canEdit(columns[m.c]))
      .map((m) => ({ row: visibleRows[m.r], col: columns[m.c], value: replaceText(columns[m.c].get(visibleRows[m.r])) }))
    const n = await applyChanges(changes, '모두 바꾸기')
    showToast(`${n}칸을 바꿨습니다`)
  }

  // ── 내려받기, 구글 시트로 내보내기 ─────────────────────────
  const tableMatrix = () => [columns.map((c) => c.label), ...visibleRows.map((row) => columns.map((c) => c.get(row)))]
  const stamp = new Date().toISOString().slice(0, 10)
  const fileBase = `${exportName}-${sheet.label}-${stamp}`
  const exportFile = (kind) => {
    const m = tableMatrix()
    if (kind === 'csv') download(toCsv(m), `${fileBase}.csv`, 'text/csv;charset=utf-8')
    if (kind === 'tsv') download(toTsv(m), `${fileBase}.tsv`, 'text/tab-separated-values;charset=utf-8')
    if (kind === 'xls') download(toSpreadsheetML(m, sheet.label), `${fileBase}.xls`, 'application/vnd.ms-excel;charset=utf-8')
  }

  // ── 키보드 ─────────────────────────────────────────────────
  const onGridKeyDown = (e) => {
    if (editing) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key
    if (mod && !e.shiftKey && (k === 'z' || k === 'Z')) return e.preventDefault(), undo()
    if (mod && (k === 'y' || k === 'Y' || (e.shiftKey && (k === 'z' || k === 'Z')))) return e.preventDefault(), redo()
    if (mod && (k === 'f' || k === 'F')) return e.preventDefault(), setDialog({ type: 'find' })
    if (mod && (k === 'b' || k === 'B')) return e.preventDefault(), toggleBold()
    if (mod && (k === 'a' || k === 'A')) {
      e.preventDefault()
      return setSel({ anchor: { r: 0, c: 0 }, focus: { r: Math.max(0, visibleRows.length - 1), c: Math.max(0, columns.length - 1) } })
    }
    if (mod) return
    if (!active) {
      if (k.startsWith('Arrow')) {
        e.preventDefault()
        select(0, 0)
      }
      return
    }
    const ext = e.shiftKey
    if (k === 'ArrowDown') return e.preventDefault(), select((ext ? sel.focus.r : active.r) + 1, ext ? sel.focus.c : active.c, ext)
    if (k === 'ArrowUp') return e.preventDefault(), select((ext ? sel.focus.r : active.r) - 1, ext ? sel.focus.c : active.c, ext)
    if (k === 'ArrowRight') return e.preventDefault(), select(ext ? sel.focus.r : active.r, (ext ? sel.focus.c : active.c) + 1, ext)
    if (k === 'ArrowLeft') return e.preventDefault(), select(ext ? sel.focus.r : active.r, (ext ? sel.focus.c : active.c) - 1, ext)
    if (k === 'Tab') return e.preventDefault(), select(active.r, active.c + (ext ? -1 : 1))
    if (k === 'Enter' || k === 'F2') return e.preventDefault(), startEdit(active.r, active.c)
    if (k === 'Delete' || k === 'Backspace') return e.preventDefault(), clearSelection()
    if (k === 'Escape') return setSel(null)
    // 글자 키는 막지 않는다. 입력칸이 받아서 onChange에서 편집 모드로 바뀐다(한글 조합도 끊기지 않는다)
  }

  // 드래그 선택은 표 밖에서 놓아도 끝나도록 window에 건다
  useEffect(() => {
    const stop = () => {
      dragging.current = false
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // 열 너비 끌기
  const startResize = (e, col) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(col)
    const zoom = ui.zoom / 100
    const move = (ev) => {
      const w = clamp(Math.round(startW + (ev.clientX - startX) / zoom), 48, 800)
      setUi((cur) => ({ ...cur, widths: { ...cur.widths, [col.key]: w } }))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // 빈 칸 채우기(스프레드시트처럼 보이게)
  const wrapRef = useRef(null)
  const [fitRows, setFitRows] = useState(MIN_ROWS)
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current
      if (!el) return
      const cap = el.clientHeight
      if (!Number.isFinite(cap) || cap <= 0) return
      const rowH = (el.querySelector('tbody tr')?.getBoundingClientRect().height || FALLBACK_ROW_H) / (ui.zoom / 100)
      const need = Math.ceil(cap / (ui.zoom / 100) / rowH)
      setFitRows(Math.min(MAX_FILLER_ROWS, Math.max(MIN_ROWS, need)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ui.zoom])
  const fillerCount = Math.max(0, fitRows - visibleRows.length)

  const changeSheet = (id) => {
    setSheetId(id)
    setFilters({})
    setSort(null)
    setSel(null)
    setEditing(null)
    hist.current = { undo: [], redo: [] }
  }

  // 정렬과 필터를 메뉴에서도 쓸 수 있게 선택 열 기준으로 연결
  const sortActiveColumn = (dir) => {
    if (!activeCol) return showToast('먼저 열을 선택해 주세요')
    setSort(dir ? { key: activeCol.key, dir } : null)
  }

  const unit = sheet.unit || '건'
  const summarySum = useMemo(() => {
    if (!bounds) return null
    const flat = selectionMatrix().flat()
    return flat.length > 1 ? numericSum(flat) : null
  }, [bounds, visibleRows, columns]) // eslint-disable-line react-hooks/exhaustive-deps
  const selectedCount = bounds ? (bounds.r1 - bounds.r0 + 1) * (bounds.c1 - bounds.c0 + 1) : 0

  const frozenLeft = useMemo(() => {
    const offsets = []
    let x = ROWNUM_W
    columns.forEach((c) => {
      offsets.push(x)
      x += widthOf(c)
    })
    return offsets
  }, [columns, widthOf])

  // ── 메뉴 ───────────────────────────────────────────────────
  const hasSel = Boolean(bounds)
  const menus = [
    {
      label: '파일',
      items: [
        { label: '새로고침', onSelect: onRefresh },
        { type: 'divider' },
        {
          label: '다운로드',
          items: [
            { label: 'CSV (.csv)', onSelect: () => exportFile('csv') },
            { label: '탭으로 구분된 값 (.tsv)', onSelect: () => exportFile('tsv') },
            { label: '엑셀 (.xls)', onSelect: () => exportFile('xls') },
          ],
        },
        { label: '구글 시트로 내보내기', onSelect: () => setDialog({ type: 'export' }) },
        { type: 'divider' },
        { label: '인쇄', shortcut: '⌘P', onSelect: () => window.print() },
      ],
    },
    {
      label: '수정',
      items: [
        { label: '실행취소', shortcut: '⌘Z', onSelect: undo, disabled: !hist.current.undo.length },
        { label: '재실행', shortcut: '⌘Y', onSelect: redo, disabled: !hist.current.redo.length },
        { type: 'divider' },
        { label: '복사', shortcut: '⌘C', onSelect: copyToClipboard, disabled: !hasSel },
        { label: '붙여넣기', shortcut: '⌘V', onSelect: pasteFromClipboard, disabled: !hasSel || !sheet.editable },
        { type: 'divider' },
        {
          label: '삭제',
          items: [
            { label: '셀 내용 지우기', shortcut: 'Delete', onSelect: clearSelection, disabled: !hasSel || !sheet.editable },
            { label: '선택한 행 삭제', onSelect: deleteSelectedRows, disabled: !hasSel || !onDeleteRows },
            { label: '선택한 메모 열 삭제', onSelect: deleteCustomColumns, disabled: !hasSel || !sheet.allowCustom },
          ],
        },
        { type: 'divider' },
        { label: '찾기 및 바꾸기', shortcut: '⌘F', onSelect: () => setDialog({ type: 'find' }) },
      ],
    },
    {
      label: '보기',
      items: [
        { label: '눈금선', checked: ui.grid, onSelect: () => setUi({ grid: !ui.grid }) },
        { label: '텍스트 줄바꿈', checked: ui.wrap, onSelect: () => setUi({ wrap: !ui.wrap }) },
        { type: 'divider' },
        {
          label: '고정',
          items: [
            { label: '고정 안 함', checked: ui.freezeCols === 0, onSelect: () => setUi({ freezeCols: 0 }) },
            { label: '열 1개', checked: ui.freezeCols === 1, onSelect: () => setUi({ freezeCols: 1 }) },
            { label: '열 2개', checked: ui.freezeCols === 2, onSelect: () => setUi({ freezeCols: 2 }) },
          ],
        },
        {
          label: '숨긴 열',
          items: ui.hidden.length
            ? [
                ...ui.hidden.map((key) => ({
                  label: `${allCols.find((c) => c.key === key)?.label || key} 보이기`,
                  onSelect: () => setUi((cur) => ({ ...cur, hidden: cur.hidden.filter((h) => h !== key) })),
                })),
                { type: 'divider' },
                { label: '모든 열 보이기', onSelect: () => setUi({ hidden: [] }) },
              ]
            : [{ label: '숨긴 열 없음', disabled: true }],
        },
        { type: 'divider' },
        { label: '확대/축소', items: ZOOMS.map((z) => ({ label: `${z}%`, checked: ui.zoom === z, onSelect: () => setUi({ zoom: z }) })) },
        { label: '전체 화면', onSelect: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) },
      ],
    },
    {
      label: '삽입',
      items: [
        { label: '행 추가 (빈 접수)', onSelect: insertRow, disabled: !onInsertRow || !sheet.editable },
        { label: '메모 열 추가', onSelect: addCustomColumn, disabled: !sheet.allowCustom },
        { type: 'divider' },
        { label: '메모', onSelect: addNote, disabled: !hasSel },
      ],
    },
    {
      label: '서식',
      items: [
        { label: '굵게', shortcut: '⌘B', onSelect: toggleBold, disabled: !hasSel },
        { type: 'divider' },
        { label: '텍스트 색', items: TEXT_COLORS.map((t) => ({ label: t.label, onSelect: () => applyFormat(() => ({ color: t.key })) })) },
        { label: '채우기 색', items: FILL_COLORS.map((t) => ({ label: t.label, onSelect: () => applyFormat(() => ({ fill: t.key })) })) },
        { label: '정렬', items: [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].map(([v, l]) => ({ label: l, onSelect: () => applyFormat(() => ({ align: v })) })) },
        { label: '글꼴 크기', items: FONT_SIZES.map((s) => ({ label: `${s}`, onSelect: () => applyFormat(() => ({ size: s })) })) },
        { type: 'divider' },
        { label: '서식 지우기', shortcut: '⌘\\', onSelect: clearFormat, disabled: !hasSel },
      ],
    },
    {
      label: '데이터',
      items: [
        { label: '선택한 열 A→Z 정렬', onSelect: () => sortActiveColumn('asc'), disabled: !hasSel },
        { label: '선택한 열 Z→A 정렬', onSelect: () => sortActiveColumn('desc'), disabled: !hasSel },
        { label: '정렬 해제', onSelect: () => sortActiveColumn(null), disabled: !sort },
        { type: 'divider' },
        { label: '필터 사용', checked: ui.filtersOn, onSelect: () => { if (ui.filtersOn) setFilters({}); setUi({ filtersOn: !ui.filtersOn }) } },
        { label: '필터 모두 해제', onSelect: () => setFilters({}), disabled: !Object.keys(filters).length },
        { type: 'divider' },
        { label: '선택한 열 숨기기', onSelect: hideSelectedColumns, disabled: !hasSel },
      ],
    },
  ]

  const saveLabel = { saved: '저장됨', dirty: '저장 대기', saving: '저장 중', error: '저장 실패' }[saveState]

  return (
    <div className="flex h-[100dvh] flex-col bg-reading-bg text-reading-text print:block print:h-auto">
      {/* 제목 줄: 저장 상태, 마지막 갱신, 건수를 각각 따로 둔다 */}
      <div className="flex flex-wrap items-end justify-between gap-12 px-gutter-m pt-16 md:px-gutter-t lg:px-gutter-d print:px-0">
        <div className="flex min-w-0 items-center gap-12">
          {homeHref && (
            <Link to={homeHref} aria-label="스프레드시트 홈" title="스프레드시트 홈" className="inline-flex shrink-0 print:hidden"><SheetsIcon size={40} /></Link>
          )}
          {onRenameFile ? (
            <input
              defaultValue={title}
              key={title}
              aria-label="파일 이름"
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== title) onRenameFile(v)
                else e.target.value = title
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              style={{ width: `${Math.max(10, title.length * 1.15 + 2)}ch` }}
              className="max-w-[60vw] truncate rounded-sm bg-transparent px-6 text-h3-m font-bold text-reading-textStrong outline-none hover:bg-reading-subtle focus:bg-reading-surface md:text-h3-d"
            />
          ) : (
            <h1 className="truncate text-h3-m font-bold text-reading-textStrong md:text-h3-d">{title}</h1>
          )}
          <span
            role="status"
            aria-live="polite"
            className={`inline-flex h-24 shrink-0 items-center rounded-sm px-8 text-caption-m font-semibold print:hidden ${
              saveState === 'error' ? 'bg-state-error/10 text-state-error' : 'bg-reading-subtle text-reading-text'
            }`}
          >
            {saveLabel}
          </span>
        </div>
        <div className="flex flex-col items-end gap-4 print:hidden">
          <p className="text-small-m text-reading-text">
            총 {sheet.rows.length}
            {unit} 중 {visibleRows.length}
            {unit} 표시
          </p>
          {updatedAt && <p className="text-caption-m text-reading-textMeta">마지막 갱신 {updatedAt}</p>}
        </div>
      </div>

      <div className="px-gutter-m pt-8 md:px-gutter-t lg:px-gutter-d print:hidden">
        <SheetMenuBar menus={menus} />
      </div>

      {/* 도구 모음 */}
      <div role="toolbar" aria-label="시트 도구 모음" className="mx-gutter-m mt-4 flex flex-wrap items-center gap-4 rounded-md bg-reading-subtle px-8 py-4 md:mx-gutter-t lg:mx-gutter-d print:hidden">
        <button type="button" aria-label="실행취소" title="실행취소 (⌘Z)" onClick={undo} disabled={!hist.current.undo.length} className={TB_BTN}><Undo2 size={18} /></button>
        <button type="button" aria-label="재실행" title="재실행 (⌘Y)" onClick={redo} disabled={!hist.current.redo.length} className={TB_BTN}><Redo2 size={18} /></button>
        <button type="button" aria-label="인쇄" title="인쇄" onClick={() => window.print()} className={TB_BTN}><Printer size={18} /></button>
        <button type="button" aria-label="새로고침" title="새로고침" onClick={onRefresh} className={TB_BTN}><RefreshCw size={18} /></button>
        <Divider />
        <Pop wide label={`확대/축소 ${ui.zoom}%`} trigger={<span className="text-small-m font-semibold">{ui.zoom}%</span>}>
          {(close) => (
            <div className="flex flex-col">
              {ZOOMS.map((z) => (
                <button key={z} type="button" onClick={() => { setUi({ zoom: z }); close() }} className={`h-32 cursor-pointer rounded-sm px-16 text-left text-small-m hover:bg-reading-subtle ${ui.zoom === z ? 'font-bold text-reading-accent' : ''}`}>{z}%</button>
              ))}
            </div>
          )}
        </Pop>
        <Divider />
        <Pop label="글꼴 크기" trigger={<span className="text-small-m font-semibold">Aa</span>}>
          {(close) => (
            <div className="flex flex-col">
              {FONT_SIZES.map((s) => (
                <button key={s} type="button" onClick={() => { applyFormat(() => ({ size: s })); close() }} className="h-32 cursor-pointer rounded-sm px-16 text-left text-small-m hover:bg-reading-subtle">{s}</button>
              ))}
            </div>
          )}
        </Pop>
        <button type="button" aria-label="굵게" title="굵게 (⌘B)" aria-pressed={allHave('b')} onClick={toggleBold} className={TB_BTN}><Bold size={18} /></button>
        <Pop label="텍스트 색" trigger={<Baseline size={18} />}>
          {(close) => (
            <div className="flex gap-8">
              {TEXT_COLORS.map((t) => (
                <button key={t.key || 'none'} type="button" aria-label={t.label} title={t.label} onClick={() => { applyFormat(() => ({ color: t.key })); close() }} className={`h-24 w-24 cursor-pointer rounded-full ${t.swatch}`} />
              ))}
            </div>
          )}
        </Pop>
        <Pop label="채우기 색" trigger={<PaintBucket size={18} />}>
          {(close) => (
            <div className="flex gap-8">
              {FILL_COLORS.map((t) => (
                <button key={t.key || 'none'} type="button" aria-label={t.label} title={t.label} onClick={() => { applyFormat(() => ({ fill: t.key })); close() }} className={`h-24 w-24 cursor-pointer rounded-full ${t.swatch}`} />
              ))}
            </div>
          )}
        </Pop>
        <Divider />
        <button type="button" aria-label="왼쪽 맞춤" title="왼쪽 맞춤" aria-pressed={allHave('align', 'left')} onClick={() => applyFormat(() => ({ align: 'left' }))} className={TB_BTN}><AlignLeft size={18} /></button>
        <button type="button" aria-label="가운데 맞춤" title="가운데 맞춤" aria-pressed={allHave('align', 'center')} onClick={() => applyFormat(() => ({ align: 'center' }))} className={TB_BTN}><AlignCenter size={18} /></button>
        <button type="button" aria-label="오른쪽 맞춤" title="오른쪽 맞춤" aria-pressed={allHave('align', 'right')} onClick={() => applyFormat(() => ({ align: 'right' }))} className={TB_BTN}><AlignRight size={18} /></button>
        <button type="button" aria-label="텍스트 줄바꿈" title="텍스트 줄바꿈" aria-pressed={ui.wrap} onClick={() => setUi({ wrap: !ui.wrap })} className={TB_BTN}><WrapText size={18} /></button>
        <Divider />
        <button type="button" aria-label="필터" title="필터 사용" aria-pressed={ui.filtersOn} onClick={() => { if (ui.filtersOn) setFilters({}); setUi({ filtersOn: !ui.filtersOn }) }} className={TB_BTN}><Filter size={18} /></button>
        <button type="button" aria-label="찾기 및 바꾸기" title="찾기 및 바꾸기 (⌘F)" onClick={() => setDialog({ type: 'find' })} className={TB_BTN}><Search size={18} /></button>
        <button type="button" aria-label="행 추가" title="행 추가 (빈 접수)" onClick={insertRow} disabled={!onInsertRow || !sheet.editable} className={TB_BTN}><Plus size={18} /></button>
        <button type="button" aria-label="선택한 행 삭제" title="선택한 행 삭제" onClick={deleteSelectedRows} disabled={!hasSel || !onDeleteRows} className={TB_BTN}><Trash2 size={18} /></button>
        <Divider />
        <button type="button" aria-label="구글 시트로 내보내기" title="구글 시트로 내보내기" onClick={() => setDialog({ type: 'export' })} className={TB_BTN}><SheetIcon size={18} /></button>
        <button type="button" aria-label="전체 화면" title="전체 화면" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())} className={TB_BTN}><Maximize size={18} /></button>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="검색"
          aria-label="검색"
          className="ml-auto h-32 w-full max-w-[200px] min-w-0 rounded-sm !bg-reading-surface px-12 text-small-m text-reading-text outline-none placeholder:text-reading-textMeta focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-reading-accent"
        />
      </div>

      {/* 수식 입력줄 */}
      <div className="mx-gutter-m mt-4 flex items-center gap-8 md:mx-gutter-t lg:mx-gutter-d print:hidden">
        <div aria-label="칸 이름" className="flex h-32 w-[96px] shrink-0 items-center justify-center rounded-sm bg-reading-subtle text-small-m font-semibold text-reading-textStrong">
          {bounds ? rangeName(bounds) : ''}
        </div>
        <span aria-hidden="true" className="shrink-0 text-small-m font-semibold italic text-reading-textMeta">fx</span>
        <input
          aria-label="칸 내용"
          value={editing ? editing.value : activeValue}
          readOnly={!editing && !(activeCol && canEdit(activeCol))}
          disabled={!active}
          onFocus={() => {
            if (!editing && active && canEdit(activeCol)) startEdit(active.r, active.c)
          }}
          onChange={(e) => editing && setEditing({ ...editing, value: e.target.value })}
          onKeyDown={(e) => {
            if (!editing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit(1, 0)
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelEdit()
            }
          }}
          className="h-32 min-w-0 flex-1 rounded-sm !bg-reading-surface px-12 text-small-m !text-reading-text outline-none focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-reading-accent disabled:!bg-reading-subtle"
        />
      </div>

      {error && <p className="px-gutter-m pt-8 text-caption-m text-state-error md:px-gutter-t lg:px-gutter-d">{error}</p>}

      {/* 표 */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col px-gutter-m md:px-gutter-t lg:px-gutter-d print:px-0">
        <div ref={wrapRef} className="min-h-0 w-full min-w-0 flex-1 overflow-auto border border-reading-hairline bg-reading-surface print:overflow-visible">
          <div
            ref={gridRef}
            tabIndex={0}
            role="grid"
            aria-label={`${sheet.label} 표`}
            aria-rowcount={visibleRows.length + 1}
            aria-colcount={columns.length}
            onKeyDown={onGridKeyDown}
            onCopy={(e) => {
              if (editing || !bounds) return
              e.preventDefault()
              e.clipboardData.setData('text/plain', copyText())
              showToast('선택한 칸을 복사했습니다')
            }}
            onCut={(e) => {
              if (editing || !bounds) return
              e.preventDefault()
              e.clipboardData.setData('text/plain', copyText())
              clearSelection()
            }}
            onPaste={(e) => {
              if (editing || !active) return
              e.preventDefault()
              pasteMatrix(parseTsv(e.clipboardData.getData('text')))
            }}
            className="outline-none"
            style={{ zoom: ui.zoom / 100, width: 'fit-content', minWidth: '100%' }}
          >
            <table className="w-full table-fixed border-separate border-spacing-0 text-small-m" style={{ minWidth: tableWidth + ROWNUM_W }}>
              <colgroup>
                <col style={{ width: ROWNUM_W }} />
                {columns.map((col) => (
                  <col key={col.key} style={{ width: widthOf(col) }} />
                ))}
              </colgroup>
              <thead>
                {/* 열 글자 줄: A, B, C. 누르면 열 전체가 선택된다 */}
                <tr>
                  <th
                    scope="col"
                    aria-label="전체 선택"
                    onClick={() => { setSel({ anchor: { r: 0, c: 0 }, focus: { r: Math.max(0, visibleRows.length - 1), c: Math.max(0, columns.length - 1) } }); focusGrid() }}
                    className={`sticky left-0 top-0 z-30 cursor-pointer bg-reading-subtle ${CELL_LINE}`}
                    style={{ height: LETTER_H }}
                  />
                  {columns.map((col, c) => (
                    <th
                      key={col.key}
                      scope="col"
                      onClick={(e) => {
                        const last = Math.max(0, visibleRows.length - 1)
                        setSel(e.shiftKey && sel ? { anchor: { r: 0, c: sel.anchor.c }, focus: { r: last, c } } : { anchor: { r: 0, c }, focus: { r: last, c } })
                        focusGrid()
                      }}
                      className={`sticky top-0 cursor-pointer select-none bg-reading-subtle text-center text-caption-m font-semibold ${CELL_LINE} ${bounds && c >= bounds.c0 && c <= bounds.c1 ? 'text-reading-accent' : 'text-reading-textMeta'} ${c < ui.freezeCols ? 'z-30' : 'z-20'}`}
                      style={{ height: LETTER_H, ...(c < ui.freezeCols ? { left: frozenLeft[c] } : {}) }}
                    >
                      {letterOf(col)}
                    </th>
                  ))}
                </tr>
                {/* 머리글 줄(1행): 이름, 필터, 너비 끌기 */}
                <tr>
                  <th scope="col" className={`sticky left-0 z-30 bg-reading-subtle text-center text-caption-m text-reading-textMeta ${CELL_LINE}`} style={{ top: LETTER_H }}>1</th>
                  {columns.map((col, c) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={`relative bg-reading-subtle px-6 py-[3px] text-left text-[13px] ${CELL_LINE} ${c < ui.freezeCols ? 'z-30' : 'z-20'} sticky`}
                      style={{ top: LETTER_H, ...(c < ui.freezeCols ? { left: frozenLeft[c] } : {}) }}
                    >
                      <span className="flex items-center justify-between gap-4">
                        <span className="min-w-0 truncate font-semibold text-reading-textStrong">{col.label}</span>
                        {ui.filtersOn && (
                          <ColumnFilter
                            label={col.label}
                            values={filterValues[col.key] || []}
                            selected={filters[col.key] ?? null}
                            onChange={(next) => setFilters((prev) => ({ ...prev, [col.key]: next }))}
                            sort={sort?.key === col.key ? sort.dir : null}
                            onSortChange={(dir) => setSort(dir ? { key: col.key, dir } : null)}
                          />
                        )}
                      </span>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`${col.label} 열 너비 조절`}
                        onMouseDown={(e) => startResize(e, col)}
                        onDoubleClick={() => setUi((cur) => { const w = { ...cur.widths }; delete w[col.key]; return { ...cur, widths: w } })}
                        className="absolute right-0 top-0 h-full w-4 cursor-col-resize hover:bg-reading-accent"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...visibleRows, ...Array.from({ length: fillerCount }, () => null)].map((row, r) => (
                  <tr key={row ? rowId(row) : `filler-${r}`}>
                    <th
                      scope="row"
                      onClick={(e) => {
                        const last = Math.max(0, columns.length - 1)
                        setSel(e.shiftKey && sel ? { anchor: { r: sel.anchor.r, c: 0 }, focus: { r, c: last } } : { anchor: { r, c: 0 }, focus: { r, c: last } })
                        focusGrid()
                      }}
                      className={`sticky left-0 z-10 cursor-pointer select-none bg-reading-subtle text-center text-caption-m font-normal ${CELL_LINE} ${bounds && r >= bounds.r0 && r <= bounds.r1 ? 'text-reading-accent' : 'text-reading-textMeta'}`}
                    >
                      {r + 2}
                    </th>
                    {columns.map((col, c) => {
                      const value = row ? col.get(row) : ''
                      const on = inRange(r, c)
                      const isActive = active && active.r === r && active.c === c
                      const isEditing = editing && editing.r === r && editing.c === c
                      const f = (row && ui.formats[fmtKey(row, col)]) || {}
                      const note = row ? ui.notes[fmtKey(row, col)] : undefined
                      const fill = FILL_COLORS.find((x) => x.key === f.fill)?.cls || ''
                      const color = TEXT_COLORS.find((x) => x.key === f.color)?.cls || ''
                      const frozen = c < ui.freezeCols
                      // 범위 선택: 안쪽은 진한 보라 바탕, 바깥 가장자리에는 2px 선(구글 시트와 같은 방식)
                      const rangeEdge =
                        on && !(bounds.r0 === bounds.r1 && bounds.c0 === bounds.c1)
                          ? [
                              r === bounds.r0 && 'inset 0 2px 0 0 rgb(var(--dah-reading-accent))',
                              r === bounds.r1 && 'inset 0 -2px 0 0 rgb(var(--dah-reading-accent))',
                              c === bounds.c0 && 'inset 2px 0 0 0 rgb(var(--dah-reading-accent))',
                              c === bounds.c1 && 'inset -2px 0 0 0 rgb(var(--dah-reading-accent))',
                            ].filter(Boolean).join(', ')
                          : ''
                      return (
                        <td
                          key={col.key}
                          data-cell={`${r}-${c}`}
                          role="gridcell"
                          aria-selected={on || undefined}
                          className={`relative p-0 align-top ${ui.grid ? CELL_LINE : 'border-b border-r border-transparent'} ${frozen ? 'sticky z-10 bg-reading-surface' : ''} ${fill}`}
                          style={frozen ? { left: frozenLeft[c] } : undefined}
                        >
                          {isActive && (
                            <input
                              ref={proxyRef}
                              aria-label={`${a1(r, c)} ${isEditing ? '입력' : '선택한 칸'}`}
                              value={isEditing ? editing.value : ''}
                              autoComplete="off"
                              onChange={(e) => {
                                if (isEditing) setEditing({ ...editing, value: e.target.value })
                                else if (e.target.value) startEdit(r, c, e.target.value)
                              }}
                              onBlur={() => commitEdit(0, 0, { move: false })}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (isEditing) {
                                  if (e.nativeEvent.isComposing) return
                                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(1, 0) }
                                  else if (e.key === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1) }
                                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                                  return
                                }
                                onGridKeyDown(e)
                              }}
                              className={
                                isEditing
                                  ? 'absolute inset-0 z-[1] block h-full w-full bg-reading-surface px-6 py-[2px] text-[13px] text-reading-text outline outline-2 outline-offset-[-2px] outline-reading-accent'
                                  : 'pointer-events-none absolute inset-0 block h-full w-full opacity-0'
                              }
                              style={isEditing && f.size ? { fontSize: f.size } : undefined}
                            />
                          )}
                          <div
                            title={note ? `메모: ${note}` : value}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              if (editingRef.current) commitEdit(0, 0, { move: false })
                              focusGrid()
                              dragging.current = true
                              if (e.shiftKey && sel) setSel({ anchor: sel.anchor, focus: { r, c } })
                              else setSel({ anchor: { r, c }, focus: { r, c } })
                            }}
                            onMouseEnter={() => dragging.current && setSel((prev) => (prev ? { ...prev, focus: { r, c } } : prev))}
                            onDoubleClick={() => startEdit(r, c)}
                            className={`relative block min-h-[24px] w-full cursor-cell px-6 py-[2px] text-[13px] leading-[20px] ${ALIGN_CLASS[f.align] || 'text-left'} ${f.b ? 'font-bold' : ''} ${color || 'text-reading-text'} ${ui.wrap ? 'whitespace-pre-wrap break-words' : 'truncate'} ${
                              isActive
                                ? 'outline outline-2 outline-offset-[-2px] outline-reading-accent'
                                : on
                                  ? 'bg-reading-accent/20'
                                  : matchSet.has(`${r}-${c}`)
                                    ? 'bg-reading-accent/10'
                                    : 'hover:bg-reading-subtle/60'
                            }`}
                            style={{ ...(f.size ? { fontSize: f.size } : {}), ...(rangeEdge ? { boxShadow: rangeEdge } : {}) }}
                          >
                            {value}
                            {note && <span aria-hidden="true" className="absolute right-0 top-0 h-8 w-8 bg-reading-accent" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {loading && <p className="pt-4 text-caption-m text-reading-textMeta">불러오는 중</p>}
      </div>

      {/* 아래: 시트 탭 + 선택 요약 */}
      <div className="flex flex-wrap items-center justify-between gap-8 px-gutter-m py-8 md:px-gutter-t lg:px-gutter-d print:hidden">
        <div className="flex flex-wrap items-center gap-4">
          {sheets.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeSheet(item.id)}
              aria-pressed={sheet.id === item.id}
              className={`h-32 cursor-pointer rounded-sm px-16 text-small-m font-semibold transition-colors duration-fast ease-out ${sheet.id === item.id ? 'bg-reading-surface text-reading-accent' : 'text-reading-textMeta hover:bg-reading-subtle hover:text-reading-text'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-caption-m text-reading-textMeta" aria-live="polite">
          {selectedCount > 1 ? `선택한 칸 ${selectedCount}개` : ''}
          {summarySum !== null ? `, 합계 ${summarySum.toLocaleString('ko-KR')}` : ''}
          {!sheet.editable ? (selectedCount > 1 ? ', ' : '') + '읽기 전용 시트' : ''}
        </p>
      </div>

      {dialog?.type === 'text' && <TextDialog dialog={dialog} onClose={() => setDialog(null)} />}
      {dialog?.type === 'find' && (
        <Dialog
          title="찾기 및 바꾸기"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className={DIALOG_BTN} onClick={() => goMatch(-1)} disabled={!matches.length}>이전</button>
              <button type="button" className={DIALOG_BTN} onClick={() => goMatch(1)} disabled={!matches.length}>다음</button>
              <button type="button" className={DIALOG_BTN} onClick={replaceCurrent} disabled={!matches.length || !sheet.editable}>바꾸기</button>
              <button type="button" className={DIALOG_PRIMARY} onClick={replaceAll} disabled={!matches.length || !sheet.editable}>모두 바꾸기</button>
            </>
          }
        >
          <label className="flex flex-col gap-8 text-small-m font-semibold">
            찾기
            <input autoFocus value={find.text} onChange={(e) => setFind({ ...find, text: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && goMatch(1)} className={INPUT_CLS} />
          </label>
          <label className="flex flex-col gap-8 text-small-m font-semibold">
            바꿀 내용
            <input value={find.replace} onChange={(e) => setFind({ ...find, replace: e.target.value })} className={INPUT_CLS} />
          </label>
          <label className="flex items-center gap-8 text-small-m">
            <input type="checkbox" checked={find.matchCase} onChange={(e) => setFind({ ...find, matchCase: e.target.checked })} />
            대소문자 구분
          </label>
          <p className="text-small-m text-reading-textMeta" aria-live="polite">{find.text ? `${matches.length}개 일치` : ''}</p>
        </Dialog>
      )}
      {dialog?.type === 'export' && (
        <ExportDialog
          onClose={() => setDialog(null)}
          matrix={tableMatrix}
          name={`${exportName} ${sheet.label} ${stamp}`}
          showToast={showToast}
        />
      )}
    </div>
  )
}

function TextDialog({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.value || '')
  const submit = () => {
    dialog.onOk(value)
    onClose()
  }
  return (
    <Dialog
      title={dialog.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={DIALOG_BTN} onClick={onClose}>취소</button>
          <button type="button" className={DIALOG_PRIMARY} onClick={submit}>{dialog.okLabel || '확인'}</button>
        </>
      }
    >
      <label className="flex flex-col gap-8 text-small-m font-semibold">
        {dialog.label}
        {dialog.multiline ? (
          <textarea autoFocus rows={4} value={value} onChange={(e) => setValue(e.target.value)} className={`${INPUT_CLS} h-auto py-8`} />
        ) : (
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} className={INPUT_CLS} />
        )}
      </label>
    </Dialog>
  )
}

/** 구글 시트로 내보내기. 연결된 드라이브에 바로 만들고, 안 되면 복사 후 새 시트 열기로 넘어간다 */
function ExportDialog({ onClose, matrix, name, showToast }) {
  const [state, setState] = useState({ phase: 'idle' }) // idle | running | done | failed
  const run = async () => {
    setState({ phase: 'running' })
    try {
      const res = await api.post('/admin/sheets/export-google', { name, values: matrix() })
      setState({ phase: 'done', url: res.sheet?.url, account: res.account_email })
    } catch (err) {
      setState({ phase: 'failed', message: err.message || '내보내지 못했습니다' })
    }
  }
  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(matrix()))
      showToast('표를 복사했습니다. 새 시트에서 A1을 누르고 붙여넣어 주세요')
    } catch {
      showToast('복사하지 못했습니다. 다운로드한 CSV 파일을 구글 시트로 가져와 주세요')
    }
    window.open('https://sheets.new', '_blank', 'noopener')
  }
  return (
    <Dialog
      title="구글 시트로 내보내기"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={DIALOG_BTN} onClick={onClose}>닫기</button>
          {state.phase === 'done' ? (
            <a href={state.url} target="_blank" rel="noopener noreferrer" className={DIALOG_PRIMARY}>구글 시트 열기</a>
          ) : (
            <button type="button" className={DIALOG_PRIMARY} onClick={run} disabled={state.phase === 'running'}>
              {state.phase === 'running' ? '만드는 중' : '드라이브에 만들기'}
            </button>
          )}
        </>
      }
    >
      {state.phase === 'done' && (
        <p className="text-small-m font-semibold text-reading-accent">
          구글 시트를 만들었습니다{state.account ? `. 저장 계정: ${state.account}` : ''}
        </p>
      )}
      {state.phase === 'failed' && (
        <div className="flex flex-col gap-12">
          <p className="text-small-m text-state-error">{state.message}</p>
          <div>
            <button type="button" className={DIALOG_BTN} onClick={copyAndOpen}>표 복사하고 새 구글 시트 열기</button>
          </div>
        </div>
      )}
      {state.phase === 'idle' && (
        <div>
          <button type="button" className={DIALOG_BTN} onClick={copyAndOpen}>표 복사하고 새 구글 시트 열기</button>
        </div>
      )}
    </Dialog>
  )
}
