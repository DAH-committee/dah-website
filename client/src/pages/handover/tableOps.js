// 표 편집 보조: 선택한 칸(또는 칸 하나, 선택이 없으면 표 전체)에 서식을 준다.
// 칸 선은 맞닿은 이웃 칸의 반대쪽 선도 함께 바꾼다(border-collapse 에서 이웃 선이 이기지 않게, 워드·한글에서도 같은 모양이 되게).
import { CellSelection, isInTable, selectedRect } from '@tiptap/pm/tables'

const OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const DELTA = { top: [-1, 0], bottom: [1, 0], left: [0, -1], right: [0, 1] }
export const NONE_BORDER = { style: 'none', width: 0, color: '#000000' }

export const inTable = (state) => isInTable(state)

function ctx(state) {
  if (!isInTable(state)) return null
  const r = selectedRect(state)
  const multi = state.selection instanceof CellSelection
  return { ...r, multi, W: r.map.width, H: r.map.height }
}

/** 툴바가 보여 줄 현재 상태 */
export function tableInfo(editor) {
  const c = ctx(editor.state)
  if (!c) return null
  const { table, tableStart, map, left, top } = c
  const cellPos = map.map[top * c.W + left]
  const cell = table.nodeAt(cellPos)
  const row = table.child(top)
  return {
    tablePos: tableStart - 1,
    tableAttrs: table.attrs,
    cellAttrs: cell?.attrs || {},
    rowAttrs: row.attrs,
    rows: c.H,
    cols: c.W,
    multi: c.multi,
    headerRow: row.childCount > 0 && row.child(0).type.name === 'tableHeader',
  }
}

function eachTarget(editor, fn) {
  const c = ctx(editor.state)
  if (!c) return false
  const rect = c.multi ? c : { left: 0, top: 0, right: c.W, bottom: c.H }
  const tr = editor.state.tr
  fn({ ...c, rect, tr })
  editor.view.dispatch(tr)
  return true
}

/** 선택 칸(선택이 칸 하나면 그 칸)에 속성 지정 */
export function setCellProps(editor, props) {
  const c = ctx(editor.state)
  if (!c) return false
  const rect = c.multi ? c : { left: c.left, top: c.top, right: c.left + 1, bottom: c.top + 1 }
  const tr = editor.state.tr
  const seen = new Set()
  for (const pos of c.map.cellsInRect(rect)) {
    if (seen.has(pos)) continue
    seen.add(pos)
    const node = c.table.nodeAt(pos)
    tr.setNodeMarkup(c.tableStart + pos, null, { ...node.attrs, ...props })
  }
  editor.view.dispatch(tr)
  return true
}

/** 선 적용. mode: all | none | outer | inner | header-bottom | top | bottom | left | right. 선택이 없으면 표 전체 */
export function applyBorders(editor, mode, spec) {
  return eachTarget(editor, ({ table, tableStart, map, rect, tr, W, H }) => {
    const updates = new Map()
    const val = mode === 'none' ? NONE_BORDER : spec
    const getB = (pos) => {
      if (!updates.has(pos)) updates.set(pos, { ...(table.nodeAt(pos)?.attrs.borders || {}) })
      return updates.get(pos)
    }
    const setEdge = (r, c, side, v) => {
      if (r < 0 || c < 0 || r >= H || c >= W) return
      const pos = map.map[r * W + c]
      const cr = map.findCell(pos)
      const real = (side === 'top' && r === cr.top) || (side === 'bottom' && r === cr.bottom - 1) || (side === 'left' && c === cr.left) || (side === 'right' && c === cr.right - 1)
      if (!real) return
      getB(pos)[side] = v
    }
    const edge = (r, c, side, v) => {
      setEdge(r, c, side, v)
      const [dr, dc] = DELTA[side]
      setEdge(r + dr, c + dc, OPP[side], v)
    }
    for (let r = rect.top; r < rect.bottom; r += 1) {
      for (let c = rect.left; c < rect.right; c += 1) {
        const isTop = r === rect.top
        const isBottom = r === rect.bottom - 1
        const isLeft = c === rect.left
        const isRight = c === rect.right - 1
        if (mode === 'all' || mode === 'none') {
          for (const s of ['top', 'right', 'bottom', 'left']) edge(r, c, s, val)
        } else if (mode === 'outer') {
          if (isTop) edge(r, c, 'top', val)
          if (isBottom) edge(r, c, 'bottom', val)
          if (isLeft) edge(r, c, 'left', val)
          if (isRight) edge(r, c, 'right', val)
        } else if (mode === 'inner') {
          if (!isBottom) edge(r, c, 'bottom', val)
          if (!isRight) edge(r, c, 'right', val)
        } else if (mode === 'header-bottom') {
          if (isTop) edge(r, c, 'bottom', val)
        } else if (['top', 'bottom', 'left', 'right'].includes(mode)) {
          if ((mode === 'top' && isTop) || (mode === 'bottom' && isBottom) || (mode === 'left' && isLeft) || (mode === 'right' && isRight)) edge(r, c, mode, val)
        }
      }
    }
    for (const [pos, b] of updates) {
      const node = table.nodeAt(pos)
      tr.setNodeMarkup(tableStart + pos, null, { ...node.attrs, borders: Object.keys(b).length ? b : null })
    }
  })
}

/** 선택한 행(없으면 현재 행)의 최소 높이(px). 0 이면 해제 */
export function setRowHeight(editor, px) {
  const c = ctx(editor.state)
  if (!c) return false
  const rect = c.multi ? c : { top: c.top, bottom: c.top + 1 }
  const tr = editor.state.tr
  c.table.forEach((row, off, i) => {
    if (i >= rect.top && i < rect.bottom) tr.setNodeMarkup(c.tableStart + off, null, { ...row.attrs, height: px > 0 ? px : null })
  })
  editor.view.dispatch(tr)
  return true
}

/** 현재 행을 반복되는 제목 행으로 표시(쪽을 넘길 때) */
export function setRowRepeat(editor, on) {
  const c = ctx(editor.state)
  if (!c) return false
  const tr = editor.state.tr
  c.table.forEach((row, off, i) => {
    if (i === c.top) tr.setNodeMarkup(c.tableStart + off, null, { ...row.attrs, header: !!on })
  })
  editor.view.dispatch(tr)
  return true
}

export function setTableAttrs(editor, patch) {
  const c = ctx(editor.state)
  if (!c) return false
  const tr = editor.state.tr
  tr.setNodeMarkup(c.tableStart - 1, null, { ...c.table.attrs, ...patch })
  editor.view.dispatch(tr)
  return true
}

/** 열 너비를 모두 같게. totalPx 가 없으면 지금 화면 폭 */
export function distributeColumns(editor, totalPx) {
  const c = ctx(editor.state)
  if (!c) return false
  let total = totalPx
  if (!total) {
    const dom = editor.view.nodeDOM(c.tableStart - 1)
    const t = dom?.querySelector ? dom.querySelector('table') : dom
    total = t?.offsetWidth || editor.view.dom.clientWidth || 600
  }
  const each = Math.max(36, Math.floor(total / c.W))
  const tr = editor.state.tr
  c.table.descendants((node, off) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      tr.setNodeMarkup(c.tableStart + off, null, { ...node.attrs, colwidth: Array(node.attrs.colspan || 1).fill(each) })
      return false
    }
    return true
  })
  tr.setNodeMarkup(c.tableStart - 1, null, { ...c.table.attrs, width: null })
  editor.view.dispatch(tr)
  return true
}

/** 새 표: 열 너비를 처음부터 px 로 고정해 열 끌기가 안정적이게 한다 */
export function insertTableFixed(editor, rows, cols, withHeaderRow = false) {
  const ok = editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run()
  if (!ok) return false
  const w = Math.max(200, (editor.view.dom.clientWidth || 640) - 2)
  distributeColumns(editor, w)
  return true
}
