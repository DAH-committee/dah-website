// 문서 편집기 확장(표 서식, 그림 크기·배치, 체크박스, 쪽 나눔, 위·아래 첨자, 문단 들여쓰기·간격).
// 표 칸의 배경·세로 맞춤·선·여백, 행 높이, 열 너비(colwidth, px), 표 맞춤·폭·기본 선은 모두 문서 JSON 에 속성으로 저장되고
// tiptapToIR / irToTiptap 이 IR 과 주고받는다. 속성 모양은 client/src/lib/docIR/README.md 의 "추가 제안" 참고.
import { Mark, Node, Extension, mergeAttributes } from '@tiptap/core'
import Table, { createColGroup, TableView } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TableMap, columnResizing, tableEditing } from '@tiptap/pm/tables'

const PT_PX = 4 / 3

// ── 색, 길이 읽기 ──
export function toHex(c) {
  if (!c || typeof c !== 'string') return null
  const s = c.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s.slice(1).split('').map((x) => x + x).join('')}`.toUpperCase()
  const m = s.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/)
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return null
    return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  }
  return null
}
const lenToPx = (v) => {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return null
  if (/pt$/.test(v)) return n * PT_PX
  if (/mm$/.test(v)) return (n * 96) / 25.4
  if (/cm$/.test(v)) return (n * 96) / 2.54
  if (/in$/.test(v)) return n * 96
  return n // px 또는 단위 없음
}

const SIDES = ['top', 'right', 'bottom', 'left']
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const CSS_STYLE = { solid: 'solid', dashed: 'dashed', dotted: 'dotted', double: 'double', none: 'none', 'thick-thin': 'double' }

function borderCss(side, b) {
  if (!b) return ''
  if (b.style === 'none') return `border-${side}:none;`
  return `border-${side}:${b.width ?? 0.5}pt ${CSS_STYLE[b.style] || 'solid'} ${b.color || '#000000'};`
}

function parseBorders(el) {
  const out = {}
  for (const s of SIDES) {
    const style = el.style[`border${cap(s)}Style`]
    if (!style) continue
    if (style === 'none' || style === 'hidden') { out[s] = { style: 'none', width: 0, color: '#000000' }; continue }
    const wPx = lenToPx(el.style[`border${cap(s)}Width`])
    out[s] = { style: ['solid', 'dashed', 'dotted', 'double'].includes(style) ? style : 'solid', width: wPx ? Math.round(wPx * 0.75 * 100) / 100 : 0.75, color: toHex(el.style[`border${cap(s)}Color`]) || '#000000' }
  }
  return Object.keys(out).length ? out : null
}

function parsePadding(el) {
  const p = {}
  let any = false
  for (const s of SIDES) {
    const v = lenToPx(el.style[`padding${cap(s)}`])
    if (v != null) { p[s] = Math.round(v * 100) / 100; any = true }
  }
  return any ? { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 } : null
}

const cellAttributes = (parent) => ({
  ...parent,
  colwidth: {
    default: null,
    parseHTML: (el) => {
      const cw = el.getAttribute('colwidth')
      if (cw) return cw.split(',').map((w) => parseInt(w, 10))
      // 워드·구글 문서에서 붙여 넣은 칸: style/width 속성의 폭
      if ((Number(el.getAttribute('colspan')) || 1) > 1) return null
      const w = lenToPx(el.style.width || el.getAttribute('width'))
      return w && w > 0 ? [Math.round(w)] : null
    },
  },
  background: {
    default: null,
    parseHTML: (el) => toHex(el.style.backgroundColor) || toHex(el.getAttribute('bgcolor')) || null,
    renderHTML: (a) => (a.background ? { style: `background-color:${a.background};` } : {}),
  },
  verticalAlign: {
    default: null,
    parseHTML: (el) => {
      const v = el.style.verticalAlign || el.getAttribute('valign')
      return ['top', 'middle', 'bottom'].includes(v) ? v : null
    },
    renderHTML: (a) => (a.verticalAlign ? { style: `vertical-align:${a.verticalAlign};` } : {}),
  },
  borders: {
    default: null,
    parseHTML: (el) => parseBorders(el),
    renderHTML: (a) => (a.borders ? { style: SIDES.map((s) => borderCss(s, a.borders[s])).join('') } : {}),
  },
  padding: {
    default: null,
    parseHTML: (el) => parsePadding(el),
    renderHTML: (a) => (a.padding ? { style: `padding:${a.padding.top}px ${a.padding.right}px ${a.padding.bottom}px ${a.padding.left}px;` } : {}),
  },
})

export const DocTableCell = TableCell.extend({
  addAttributes() {
    return cellAttributes(this.parent?.())
  },
})
export const DocTableHeader = TableHeader.extend({
  addAttributes() {
    return cellAttributes(this.parent?.())
  },
})

export const DocTableRow = TableRow.extend({
  addAttributes() {
    return {
      height: {
        default: null, // px, 최소 높이
        parseHTML: (el) => {
          const h = lenToPx(el.style.height || el.getAttribute('height'))
          return h && h > 0 ? Math.round(h * 100) / 100 : null
        },
        renderHTML: (a) => (a.height ? { style: `height:${a.height}px;` } : {}),
      },
      header: {
        default: false, // 쪽을 넘길 때 제목 행 반복(IR row.header)
        parseHTML: (el) => el.getAttribute('data-header') === 'true',
        renderHTML: (a) => (a.header ? { 'data-header': 'true' } : {}),
      },
    }
  },
})

// 표 화면: 열 폭, 표 맞춤·폭·기본 선을 표 요소에 반영한다
function applyTableAttrs(table, node) {
  const a = node.attrs || {}
  table.style.marginLeft = a.align === 'center' || a.align === 'right' ? 'auto' : ''
  table.style.marginRight = a.align === 'center' ? 'auto' : ''
  const b = a.borderStyle
  if (b && b.style !== 'none') table.style.setProperty('--tb-border', `${b.width ?? 0.5}pt ${CSS_STYLE[b.style] || 'solid'} ${b.color || '#000'}`)
  else if (b && b.style === 'none') table.style.setProperty('--tb-border', 'none')
  else table.style.removeProperty('--tb-border')
  if (a.width && node.firstChild && !colsFixed(node)) table.style.width = `${a.width}px`
}
function colsFixed(node) {
  const row = node.firstChild
  if (!row) return false
  for (let i = 0; i < row.childCount; i += 1) {
    const { colspan, colwidth } = row.child(i).attrs
    for (let j = 0; j < colspan; j += 1) if (!(colwidth && colwidth[j])) return false
  }
  return true
}

class DocTableView extends TableView {
  constructor(node, cellMinWidth) {
    super(node, cellMinWidth)
    applyTableAttrs(this.table, node)
  }

  update(node) {
    const ok = super.update(node)
    if (ok) applyTableAttrs(this.table, node)
    return ok
  }
}

// 열을 더하면 새 칸에는 열 너비가 없다. 아는 열 폭의 합을 그대로 두고 새 열이 같은 몫을 갖게 나머지를 줄인다(표가 쪽 밖으로 나가지 않게)
const widthKey = new PluginKey('docTableWidths')
const widthFixer = new Plugin({
  key: widthKey,
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged)) return null
    let tr = null
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'table') return true
      const map = TableMap.get(node)
      const W = map.width
      const col = Array(W).fill(null)
      let mixed = false
      let any = false
      const cells = []
      for (let r = 0; r < map.height; r += 1) {
        for (let c = 0; c < W; c += 1) {
          const cp = map.map[r * W + c]
          const cell = node.nodeAt(cp)
          const cr = map.findCell(cp)
          if (cr.top !== r || cr.left !== c) continue
          cells.push({ cp, cell, left: cr.left, right: cr.right })
          const cw = cell.attrs.colwidth
          for (let k = 0; k < cr.right - cr.left; k += 1) {
            if (cw && cw[k]) { col[cr.left + k] = col[cr.left + k] || cw[k]; any = true } else mixed = true
          }
        }
      }
      if (!any || !mixed) return false
      const known = col.filter((x) => x)
      const u = W - known.length
      if (u <= 0) {
        // 같은 열이라도 칸마다 폭이 비어 있던 경우: 이미 아는 값으로 채운다
      }
      const S = known.reduce((a, b) => a + b, 0)
      const share = S / W
      const k = (W - u) / W
      const widths = col.map((x) => Math.round((x ? x * k : share) * 100) / 100)
      tr = tr || state.tr
      for (const { cp, cell, left, right } of cells) tr.setNodeMarkup(pos + 1 + cp, null, { ...cell.attrs, colwidth: widths.slice(left, right) })
      return false
    })
    return tr
  },
})

export const DocTable = Table.extend({
  addAttributes() {
    return {
      align: {
        default: null,
        parseHTML: (el) => {
          const a = el.getAttribute('align')
          if (['left', 'center', 'right'].includes(a)) return a
          if (el.style.marginLeft === 'auto') return el.style.marginRight === 'auto' ? 'center' : 'right'
          return null
        },
        renderHTML: (a) => (a.align === 'center' ? { style: 'margin-left:auto;margin-right:auto;' } : a.align === 'right' ? { style: 'margin-left:auto;' } : {}),
      },
      width: {
        default: null, // px. 열 폭이 모두 있으면 그 합이 우선
        parseHTML: (el) => {
          const w = el.style.width || el.getAttribute('width')
          if (!w || /%$/.test(w)) return null
          const px = lenToPx(w)
          return px && px > 0 ? Math.round(px) : null
        },
        renderHTML: () => ({}),
      },
      borderStyle: {
        default: null, // { style, width(pt), color } 표 기본 선(칸 속성이 덮어씀)
        parseHTML: () => null,
        renderHTML: (a) => {
          const b = a.borderStyle
          if (!b) return {}
          return { style: `--tb-border:${b.style === 'none' ? 'none' : `${b.width ?? 0.5}pt ${CSS_STYLE[b.style] || 'solid'} ${b.color || '#000'}`};` }
        },
      },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth)
    return [
      'table',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style: tableWidth ? `width:${tableWidth};` : node.attrs.width ? `width:${node.attrs.width}px;` : `min-width:${tableMinWidth};` }),
      colgroup,
      ['tbody', 0],
    ]
  },
  // 열 너비 끌기는 편집기를 읽기 전용으로 만든 뒤 수정으로 바꿔도 동작하도록 항상 켜 둔다(읽기 전용일 때는 prosemirror-tables 가 무시한다)
  addProseMirrorPlugins() {
    return [
      widthFixer,
      columnResizing({ handleWidth: 6, cellMinWidth: 36, defaultCellMinWidth: 36, View: DocTableView, lastColumnResizable: true }),
      tableEditing({ allowTableNodeSelection: false }),
    ]
  },
})

// ── 그림: 크기, 정렬, 배치(블록 / 글자처럼 / 오른쪽 · 왼쪽에 띄우기), 설명 ──
export const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = lenToPx(el.getAttribute('width') || el.style.width)
          return w && w > 0 ? Math.round(w) : null
        },
        renderHTML: (a) => (a.width ? { width: a.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const h = lenToPx(el.getAttribute('height') || el.style.height)
          return h && h > 0 ? Math.round(h) : null
        },
        renderHTML: (a) => (a.height ? { height: a.height } : {}),
      },
      align: {
        default: 'left',
        parseHTML: (el) => el.getAttribute('data-align') || 'left',
        renderHTML: (a) => (a.align && a.align !== 'left' ? { 'data-align': a.align } : {}),
      },
      wrap: {
        default: 'block', // block | inline(글자처럼) | right | left(떠 있는 그림)
        parseHTML: (el) => el.getAttribute('data-wrap') || 'block',
        renderHTML: (a) => (a.wrap && a.wrap !== 'block' ? { 'data-wrap': a.wrap } : {}),
      },
    }
  },
})

// ── 체크박스(☐ ☑): 눌러서 바꾼다 ──
export const Checkbox = Node.create({
  name: 'checkbox',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { checked: { default: false, parseHTML: (el) => el.getAttribute('data-checked') === 'true', renderHTML: (a) => ({ 'data-checked': a.checked ? 'true' : 'false' }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-checkbox]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-checkbox': '', class: 'gd-check' }), node.attrs.checked ? '☑' : '☐']
  },
  renderText: ({ node }) => (node.attrs.checked ? '☑' : '☐'),
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span')
      dom.className = 'gd-check'
      dom.contentEditable = 'false'
      dom.setAttribute('data-checkbox', '')
      dom.setAttribute('role', 'checkbox')
      let cur = node
      const paint = () => {
        dom.textContent = cur.attrs.checked ? '☑' : '☐'
        dom.setAttribute('aria-checked', cur.attrs.checked ? 'true' : 'false')
        dom.dataset.checked = cur.attrs.checked ? 'true' : 'false'
      }
      paint()
      dom.addEventListener('mousedown', (e) => e.preventDefault())
      dom.addEventListener('click', () => {
        if (!editor.isEditable) return
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { checked: !cur.attrs.checked }))
      })
      return {
        dom,
        update(n) {
          if (n.type !== cur.type) return false
          cur = n
          paint()
          return true
        },
        ignoreMutation: () => true,
      }
    }
  },
  addCommands() {
    return {
      insertCheckbox: (checked = false) => ({ commands }) => commands.insertContent([{ type: 'checkbox', attrs: { checked } }, { type: 'text', text: ' ' }]),
    }
  },
})

// ── 쪽 나눔 ──
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'gd-pagebreak' }]
  },
  addCommands() {
    return { insertPageBreak: () => ({ commands }) => commands.insertContent({ type: 'pageBreak' }) }
  },
})

// ── 위 첨자, 아래 첨자 ──
export const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML() { return [{ tag: 'sup' }, { style: 'vertical-align', getAttrs: (v) => (v === 'super' ? null : false) }] },
  renderHTML({ HTMLAttributes }) { return ['sup', HTMLAttributes, 0] },
  addCommands() { return { toggleSuperscript: () => ({ commands }) => commands.toggleMark(this.name) } },
})
export const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML() { return [{ tag: 'sub' }, { style: 'vertical-align', getAttrs: (v) => (v === 'sub' ? null : false) }] },
  renderHTML({ HTMLAttributes }) { return ['sub', HTMLAttributes, 0] },
  addCommands() { return { toggleSubscript: () => ({ commands }) => commands.toggleMark(this.name) } },
})

// ── 문단 들여쓰기·문단 간격(pt) ──
export const ParaSpacing = Extension.create({
  name: 'paraSpacing',
  addGlobalAttributes() {
    const attr = (css, dataName, styleFn) => ({
      default: null,
      parseHTML: (el) => {
        const v = el.getAttribute(dataName)
        if (v != null) return Number(v) || null
        const px = lenToPx(el.style[css])
        return px ? Math.round(px * 0.75 * 100) / 100 : null
      },
      renderHTML: (a) => {
        const v = a[dataName === 'data-il' ? 'indentLeft' : dataName === 'data-ir' ? 'indentRight' : dataName === 'data-if' ? 'indentFirst' : dataName === 'data-sb' ? 'spaceBefore' : 'spaceAfter']
        return v ? { [dataName]: v, style: styleFn(v) } : {}
      },
    })
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indentLeft: attr('marginLeft', 'data-il', (v) => `margin-left:${v}pt;`),
          indentRight: attr('marginRight', 'data-ir', (v) => `margin-right:${v}pt;`),
          indentFirst: attr('textIndent', 'data-if', (v) => `text-indent:${v}pt;`),
          spaceBefore: attr('marginTop', 'data-sb', (v) => `margin-top:${v}pt !important;`),
          spaceAfter: attr('marginBottom', 'data-sa', (v) => `margin-bottom:${v}pt !important;`),
        },
      },
    ]
  },
})

export const DOC_EXTENSIONS = [DocTable, DocTableRow, DocTableHeader, DocTableCell, DocImage, Checkbox, PageBreak, Superscript, Subscript, ParaSpacing]
