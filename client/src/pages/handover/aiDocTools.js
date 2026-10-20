// 문서 편집기용 AI 도구. AiPanel 의 Tool 계약(components/ai/README.md)을 따른다.
// 핵심 규칙
// - 모델이 넘기는 인자는 믿지 않는다: 타입 확인, 숫자 제한, 모르는 필드 무시, 글은 항상 일반 글자로만 넣는다(HTML 해석 없음).
// - 문단 번호는 "글이 있는 블록(문단, 제목)"을 문서 순서대로 1부터 센다. 목록 항목과 표 칸 안의 문단도 한 개씩 센다.
// - 고칠 때는 글자 단위 최소 차이만 바꾼다. 바뀌지 않은 글자는 서식(굵게, 링크, 댓글 표시)을 그대로 가진다.
// - 한 번의 도구 호출은 트랜잭션 하나다. 그래서 편집기의 실행취소(⌘Z) 한 번으로 돌아간다.
// - 비밀값, 자료값, 체크박스 같은 글자 아닌 조각(atom)은 글 고치기로 지워지거나 옮겨지지 않는다.
import { closeHistory, undoDepth } from '@tiptap/pm/history'
import { createExtraDocTools } from './aiDocExtra.js'

export const MAX_READ_CHARS = 30000
const MAX_TEXT = 20000
const MAX_EDITS = 500
const MAX_REPLACE = 1000
const PUA0 = 0xe000

const isAtomCh = (c) => c >= '\uE000' && c <= '\uF8FF'
const stripPua = (s) => s.replace(/[\uE000-\uF8FF]/g, '')
const clampInt = (v, lo, hi, d) => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return d
  return Math.max(lo, Math.min(hi, n))
}
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const cleanStr = (v, max = MAX_TEXT) => {
  if (typeof v !== 'string') return null
  return v.replace(/\r\n?/g, '\n').replace(CTRL, '').slice(0, max)
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

// ───────────────────────── 문단 모델 ─────────────────────────

export function tokenOf(node) {
  const t = node.type.name
  if (t === 'checkbox') return node.attrs.checked ? '☑' : '☐'
  if (t === 'secret') return `⟦비밀값:${node.attrs.label || ''}⟧`
  if (t === 'hwpVar') return `⟦자료값:${node.attrs.key || node.attrs.calc || ''}⟧`
  if (t === 'image') return '⟦이미지⟧'
  return `⟦${t}⟧`
}

/** 글이 있는 블록 하나를 글자 배열로 푼다. 글자 아닌 조각은 사설 영역 글자 하나로 센다. */
export function paraModel(node, nodePos) {
  const chars = []
  let atomN = 0
  node.forEach((child, offset) => {
    const p = nodePos + 1 + offset
    if (child.isText) {
      for (let i = 0; i < child.text.length; i += 1) chars.push({ ch: child.text[i], pos: p + i, end: p + i + 1, marks: child.marks })
    } else if (child.type.name === 'hardBreak') {
      chars.push({ ch: '\n', pos: p, end: p + child.nodeSize, marks: child.marks, hb: true })
    } else {
      chars.push({ ch: String.fromCharCode(PUA0 + (atomN % 6000)), pos: p, end: p + child.nodeSize, marks: child.marks, atom: child })
      atomN += 1
    }
  })
  return { chars, s: chars.map((c) => c.ch).join(''), nodePos, node, hasSecret: chars.some((c) => c.atom?.type.name === 'secret') }
}

export function toDisplay(model, a = 0, b = model.chars.length) {
  let out = ''
  for (let i = a; i < b; i += 1) {
    const c = model.chars[i]
    out += c.atom ? tokenOf(c.atom) : c.ch
  }
  return out
}

/** 모델이 보낸 글(표시용 토큰 포함)을 내부 글자열로 바꾼다. 범위 안 조각만 토큰으로 되살린다. */
export function fromDisplay(text, model, a, b) {
  const unused = []
  for (let i = a; i < b; i += 1) {
    const c = model.chars[i]
    if (c.atom) unused.push({ ch: c.ch, token: tokenOf(c.atom), box: c.atom.type.name === 'checkbox' })
  }
  let t = text
  if (unused.length) {
    const toks = [...new Set(unused.map((u) => u.token))]
    if (unused.some((u) => u.box)) toks.push('☐', '☑')
    toks.sort((x, y) => y.length - x.length)
    const re = new RegExp(toks.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    t = t.replace(re, (tok) => {
      let i = unused.findIndex((u) => u.token === tok)
      if (i < 0 && (tok === '☐' || tok === '☑')) i = unused.findIndex((u) => u.box)
      if (i < 0) return tok.startsWith('⟦') ? '' : tok
      const ch = unused[i].ch
      unused.splice(i, 1)
      return ch
    })
  }
  // 남은 토큰(조각이 없는 곳에 쓴 것)은 지운다
  t = t.replace(/⟦[^⟧]{0,80}⟧/g, '')
  return t
}

// ───────────────────────── 최소 차이 ─────────────────────────

/** a 를 b 로 바꾸는 최소 차이. [{a0,a1,b0,b1}] (a[a0:a1] 을 b[b0:b1] 로). 사이 한 글자 같은 구간은 한 덩어리로 합친다. */
export function diffHunks(a, b) {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1
  let q = 0
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q += 1
  const am = a.slice(p, a.length - q)
  const bm = b.slice(p, b.length - q)
  if (!am && !bm) return []
  const whole = [{ a0: p, a1: p + am.length, b0: p, b1: p + bm.length }]
  if (!am || !bm) return whole
  const n = am.length
  const m = bm.length
  if (n * m > 4_000_000) return whole
  const w = m + 1
  const L = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
    }
  }
  // 앞에서부터 따라가며 같음/지움/넣음 줄을 만든다
  const ops = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) { ops.push('='); i += 1; j += 1 }
    else if (j < m && (i === n || L[i * w + j + 1] >= L[(i + 1) * w + j])) { ops.push('+'); j += 1 }
    else { ops.push('-'); i += 1 }
  }
  const hunks = []
  let ai = 0
  let bi = 0
  let cur = null
  for (const op of ops) {
    if (op === '=') { ai += 1; bi += 1; continue }
    if (!cur || ai - cur.a1 > 1) { cur = { a0: ai, a1: ai, b0: bi, b1: bi }; hunks.push(cur) }
    if (op === '-') ai += 1
    else bi += 1
    cur.a1 = ai
    cur.b1 = bi
  }
  return hunks.map((h) => ({ a0: h.a0 + p, a1: h.a1 + p, b0: h.b0 + p, b1: h.b1 + p }))
}

/** 글자 아닌 조각은 지우지도 옮기지도 않게 덩어리를 쪼갠다. 결과: [{a0,a1,ins}] */
export function protectAtoms(hunks, a, b) {
  const out = []
  for (const h of hunks) {
    const del = a.slice(h.a0, h.a1)
    const ins = stripPua(b.slice(h.b0, h.b1))
    if (!/[\uE000-\uF8FF]/.test(del)) {
      if (del || ins) out.push({ a0: h.a0, a1: h.a1, ins })
      continue
    }
    let start = h.a0
    let first = true
    for (let i = h.a0; i <= h.a1; i += 1) {
      if (i === h.a1 || isAtomCh(a[i])) {
        if (i > start || (first && ins)) out.push({ a0: start, a1: i, ins: first ? ins : '' })
        if (i > start || (first && ins)) first = false
        start = i + 1
      }
    }
  }
  return out
}

// ───────────────────────── 문단 목록 ─────────────────────────

const LIST_KO = { bulletList: '글머리', orderedList: '번호', taskList: '체크' }
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])
const ITEM_TYPES = new Set(['listItem', 'taskItem'])
const CELL_TYPES = new Set(['tableCell', 'tableHeader'])

/** 문서를 순서대로 훑는다. 글 블록은 번호를 받고, 이미지·쪽 나눔 등은 번호 없이 줄만 남긴다. */
export function walkDoc(doc, hwpMarks) {
  const entries = []
  const paras = []
  const tables = new Map()
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (!node.isTextblock) {
      if (name === 'image') entries.push({ misc: '[이미지]' })
      else if (name === 'pageBreak') entries.push({ misc: '[쪽 나눔]' })
      else if (name === 'horizontalRule') entries.push({ misc: '[가로줄]' })
      return true
    }
    const $p = doc.resolve(pos)
    let cell = null
    let list = null
    let listDepth = 0
    for (let d = $p.depth; d >= 1; d -= 1) {
      const an = $p.node(d)
      const t = an.type.name
      if (!cell && CELL_TYPES.has(t) && d >= 3) {
        const tPos = $p.before(d - 2)
        if (!tables.has(tPos)) tables.set(tPos, tables.size + 1)
        cell = { t: tables.get(tPos), r: $p.index(d - 2) + 1, c: $p.index(d - 1) + 1, header: t === 'tableHeader' }
      }
      if (LIST_TYPES.has(t)) listDepth += 1
      if (!list && ITEM_TYPES.has(t)) {
        list = { kind: $p.node(d - 1).type.name, first: $p.index(d) === 0, checked: t === 'taskItem' ? !!an.attrs.checked : null, itemDepth: d }
      }
    }
    const n = paras.length + 1
    const p = {
      n, pos, end: pos + node.nodeSize, node, type: name, level: name === 'heading' ? node.attrs.level : 0,
      cell, list: list ? { ...list, depth: listDepth } : null, mark: hwpMarks?.get?.(pos) || '',
    }
    paras.push(p)
    entries.push({ para: p })
    return false
  })
  return { entries, paras }
}

function markerOf(p) {
  const m = []
  if (p.type === 'heading') m.push(`제목${p.level}`)
  if (p.type === 'codeBlock') m.push('코드')
  if (p.list) {
    if (p.list.first) m.push(`${LIST_KO[p.list.kind] || '목록'}${p.list.depth > 1 ? ` ${p.list.depth}단` : ''}${p.list.checked ? ' 체크됨' : ''}`)
    else m.push('항목 이어짐')
  }
  if (p.cell) m.push(`표 t${p.cell.t} r${p.cell.r} c${p.cell.c}${p.cell.header ? ' 머리글' : ''}`)
  if (p.mark) m.push(`부호 ${p.mark}`)
  return m.length ? `(${m.join(', ')}) ` : ''
}

// ───────────────────────── 쓰기 계획 ─────────────────────────

function inlineNodes(schema, text, marks = []) {
  const out = []
  const hb = schema.nodes.hardBreak
  text.split('\n').forEach((line, i) => {
    if (i > 0) out.push(hb ? hb.create(null, null, marks) : schema.text(' ', marks))
    if (line) out.push(schema.text(line, marks))
  })
  return out
}

function insertionMarks(model, i) {
  const left = i > 0 ? model.chars[i - 1] : null
  const right = i < model.chars.length ? model.chars[i] : null
  if (left && right) {
    const lm = left.marks
    return lm.filter((m) => right.marks.some((r) => r.eq(m)))
  }
  const one = left || right
  if (!one) return []
  return one.marks.filter((m) => m.type.name !== 'comment' && m.type.name !== 'link')
}

/** 한 문단의 글자 범위 [aFrom,aTo) 를 newInternal 로 바꾸는 계획. 반환: { prims, hunks:[{a0,a1,ins,before,after}] } */
export function planChange(schema, model, aFrom, aTo, newInternal) {
  const a = model.s.slice(aFrom, aTo)
  const hunks = protectAtoms(diffHunks(a, newInternal), a, newInternal)
  const prims = []
  const info = []
  for (const h of hunks) {
    const i0 = aFrom + h.a0
    const i1 = aFrom + h.a1
    let from
    let to
    let marks
    if (i1 > i0) {
      from = model.chars[i0].pos
      to = model.chars[i1 - 1].end
      marks = model.chars[i0].marks
    } else {
      from = i0 < model.chars.length ? model.chars[i0].pos : model.chars.length ? model.chars[model.chars.length - 1].end : model.nodePos + 1
      to = from
      marks = insertionMarks(model, i0)
    }
    prims.push({ from, to, nodes: h.ins ? inlineNodes(schema, h.ins, marks) : [] })
    info.push({ before: toDisplay(model, i0, i1), after: h.ins, at: i0 })
  }
  return { prims, hunks: info }
}

export function applyPrims(tr, prims) {
  const sorted = [...prims].sort((x, y) => y.from - x.from || y.to - x.to)
  for (const p of sorted) {
    if (p.nodes && p.nodes.length) tr.replaceWith(p.from, p.to, p.nodes)
    else if (p.to > p.from) tr.delete(p.from, p.to)
  }
  return tr
}

function makeBlock(schema, text) {
  return schema.nodes.paragraph.create(null, text ? inlineNodes(schema, text) : [])
}

/** 문단 뒤에 새 문단(들)을 넣는 계획. 목록 항목이면 새 항목, 표 칸이면 칸 안 문단 */
function planInsertAfter(doc, p, lines) {
  const schema = doc.type.schema
  const $p = doc.resolve(p.pos)
  const paras = lines.map((l) => makeBlock(schema, l))
  if (p.list) {
    const d = p.list.itemDepth
    const item = $p.node(d)
    const nodes = paras.map((pg) => item.type.create(item.type.name === 'taskItem' ? { checked: false } : null, pg))
    return { from: $p.after(d), to: $p.after(d), nodes }
  }
  return { from: p.end, to: p.end, nodes: paras }
}

/** 문단 하나를 지우는 계획. 구조를 깨는 경우는 글만 비운다. 반환 null 이면 불가(이유 포함) */
function planDelete(doc, p, model) {
  if (model.hasSecret) return { error: '비밀값이 들어 있는 문단은 직접 지워 주세요' }
  const $p = doc.resolve(p.pos)
  const clear = () => {
    const dels = []
    let start = -1
    let last = -1
    model.chars.forEach((c) => {
      if (c.atom && !c.hb) {
        if (start >= 0) dels.push({ from: start, to: last, nodes: [] })
        start = -1
      } else {
        if (start < 0) start = c.pos
        last = c.end
      }
    })
    if (start >= 0) dels.push({ from: start, to: last, nodes: [] })
    return { prims: dels, cleared: true }
  }
  const parent = $p.parent
  if (CELL_TYPES.has(parent.type.name) && parent.childCount === 1) return clear()
  if (p.list) {
    const d = p.list.itemDepth
    const item = $p.node(d)
    if (item.childCount > 1) return clear()
    const list = $p.node(d - 1)
    if (list.childCount === 1) {
      const lp = $p.node(d - 2)
      if (ITEM_TYPES.has(lp.type.name) && lp.childCount === 1) return clear()
      if (d - 2 === 0 && doc.childCount === 1) return clear()
      return { prims: [{ from: $p.before(d - 1), to: $p.after(d - 1), nodes: [] }] }
    }
    return { prims: [{ from: $p.before(d), to: $p.after(d), nodes: [] }] }
  }
  if (parent === doc && doc.childCount === 1) return clear()
  if (parent.childCount === 1 && !parent.type.spec.isolating) return clear()
  return { prims: [{ from: p.pos, to: p.end, nodes: [] }] }
}

// ───────────────────────── 블록 만들기 ─────────────────────────

function cellNode(schema, header, text) {
  const type = header ? schema.nodes.tableHeader : schema.nodes.tableCell
  const para = schema.nodes.paragraph.create(null, text ? inlineNodes(schema, cleanStr(text, 2000) || '') : [])
  return type.create(null, para)
}

const BLOCK_TYPES = ['paragraph', 'heading', 'bullet', 'numbered', 'checklist', 'table']
const LIST_OF = { bullet: ['bulletList', 'listItem'], numbered: ['orderedList', 'listItem'], checklist: ['taskList', 'taskItem'] }

/** 모델이 준 블록 목록을 편집기 노드로 만든다. 같은 종류 목록 블록은 한 목록으로 묶고, depth 로 중첩한다. */
export function buildBlocks(schema, blocks) {
  const nodes = []
  const errors = []
  let i = 0
  const mkItem = (kind, text) => {
    const [, itemName] = LIST_OF[kind]
    const para = schema.nodes.paragraph.create(null, text ? inlineNodes(schema, text) : [])
    return schema.nodes[itemName].create(itemName === 'taskItem' ? { checked: false } : null, para)
  }
  const mkList = (kind, items) => schema.nodes[LIST_OF[kind][0]].create(null, items)
  while (i < blocks.length) {
    const b = blocks[i]
    const type = b.type
    if (LIST_OF[type]) {
      // 같은 종류가 이어지는 구간을 한 목록으로
      const run = []
      while (i < blocks.length && blocks[i].type === type) { run.push(blocks[i]); i += 1 }
      const root = { kind: type, items: [] }
      const stack = [root]
      for (const r of run) {
        const depth = clampInt(r.depth, 0, 3, 0)
        while (stack.length - 1 > depth) stack.pop()
        while (stack.length - 1 < depth) {
          const parent = stack[stack.length - 1]
          const lastItem = parent.items[parent.items.length - 1]
          if (!lastItem) break
          const sub = { kind: type, items: [] }
          lastItem.subs.push(sub)
          stack.push(sub)
        }
        stack[stack.length - 1].items.push({ text: r.text || '', subs: [] })
      }
      const build = (lvl) => mkList(lvl.kind, lvl.items.map((it) => {
        const item = mkItem(lvl.kind, it.text)
        if (!it.subs.length) return item
        return item.type.create(item.attrs, [item.firstChild, ...it.subs.map(build)])
      }))
      nodes.push(build(root))
      continue
    }
    i += 1
    if (type === 'table') {
      const rowsIn = Array.isArray(b.rows) ? b.rows.slice(0, 60) : []
      const rows = rowsIn.map((r) => (Array.isArray(r) ? r.slice(0, 12).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')) : [])).filter((r) => r.length)
      if (!rows.length) { errors.push('표에 rows 가 없습니다'); continue }
      const cols = Math.max(...rows.map((r) => r.length))
      const trs = rows.map((r, ri) => schema.nodes.tableRow.create(null, Array.from({ length: cols }, (_, ci) => cellNode(schema, ri === 0, r[ci] || ''))))
      nodes.push(schema.nodes.table.create(null, trs))
    } else if (type === 'heading') {
      nodes.push(schema.nodes.heading.create({ level: clampInt(b.level, 1, 4, 2) }, b.text ? inlineNodes(schema, b.text) : []))
    } else {
      nodes.push(schema.nodes.paragraph.create(null, b.text ? inlineNodes(schema, b.text) : []))
    }
  }
  return { nodes, errors }
}

export function cleanBlocks(raw) {
  const out = []
  const errors = []
  if (!Array.isArray(raw) || !raw.length) return { blocks: out, errors: ['blocks 가 비어 있습니다'] }
  raw.slice(0, 200).forEach((b, k) => {
    if (!isObj(b) || !BLOCK_TYPES.includes(b.type)) { errors.push(`블록 ${k + 1}: type 이 올바르지 않습니다`); return }
    const text = b.text == null ? '' : cleanStr(String(b.text))
    out.push({ type: b.type, text: stripPua(text || ''), level: b.level, depth: b.depth, rows: b.rows })
  })
  return { blocks: out, errors }
}

// ───────────────────────── 도구 묶음 ─────────────────────────

const short = (s, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s)

/**
 * env: {
 *   getEditor(): Editor | null,
 *   editBlock(): string          '' 이면 고칠 수 있음, 아니면 거절 이유(한국어)
 *   getHwp(): { mode, preset }
 *   getTabTitle(): string, getTitle(): string, setTitle(t): Promise<void>
 *   hwpMarks(doc): Map<pos, mark> | null     한글 모드 항목 부호
 *   runLint(): Promise<Array<{line,match,rule,severity,message,suggest}>>
 *   commentCount(): number
 *   notify(msg): void
 * }
 */
export function createDocTools(env) {
  const ed = () => env.getEditor?.()
  const snapshot = () => {
    const editor = ed()
    if (!editor || editor.isDestroyed) return null
    const marks = env.getHwp?.().mode === 'hwp' ? env.hwpMarks?.(editor.state.doc) : null
    return { editor, state: editor.state, ...walkDoc(editor.state.doc, marks) }
  }
  const refuse = (msg) => ({ result: { ok: false, error: msg }, summary: msg })
  const guard = () => {
    const editor = ed()
    if (!editor || editor.isDestroyed) return '편집기가 아직 준비되지 않았습니다'
    const why = env.editBlock?.()
    if (why) return why
    if (!editor.isEditable) return '지금은 문서를 고칠 수 없습니다'
    return ''
  }

  // 트랜잭션 하나로 적용하고, 실행취소 함수를 만든다
  function commit(editor, prims, label) {
    const before = editor.state.doc
    const tr = editor.state.tr
    closeHistory(tr)
    applyPrims(tr, prims)
    if (!tr.docChanged) return null
    tr.setMeta('ai-edit', label || true)
    const inv = tr.steps.map((s, i) => s.invert(tr.docs[i]))
    editor.view.dispatch(tr)
    const after = editor.state.doc
    const depth = undoDepth(editor.state)
    let done = false
    const undo = () => {
      if (done) return
      const e = ed()
      if (!e || e.isDestroyed) return
      const why = env.editBlock?.()
      if (why) { env.notify?.(why); return }
      if (!e.state.doc.eq(after)) {
        env.notify?.('그 뒤에 문서가 바뀌어 자동으로 되돌릴 수 없습니다. 편집기에서 ⌘Z 로 되돌려 주세요')
        return
      }
      done = true
      if (undoDepth(e.state) === depth && e.commands.undo()) {
        if (e.state.doc.eq(before)) return
        e.commands.redo() // 다른 걸 되돌렸다면 제자리로 두고 아래 방법을 쓴다
      }
      const t2 = e.state.tr
      closeHistory(t2)
      for (let i = inv.length - 1; i >= 0; i -= 1) t2.step(inv[i])
      e.view.dispatch(t2)
    }
    return { undo, before, after }
  }

  function paraMap(snap) {
    const m = new Map()
    snap.paras.forEach((p) => m.set(p.n, p))
    return m
  }

  // ── 읽기
  const read_document = {
    name: 'read_document',
    description: '현재 탭 문서를 문단 번호와 함께 읽는다. 각 줄은 "[번호] (종류) 글" 형식이고, 종류는 제목, 글머리, 번호, 체크, 표 위치(t표 r행 c열) 등이다. 한글 모드에서는 항목 부호도 보인다. ⟦…⟧ 와 ☐ ☑ 는 글이 아닌 조각(비밀값, 자료값, 체크박스)이라 그대로 두어야 한다. 한 번에 약 30000자까지만 주고(예산), 넘으면 truncated=true 와 next_from 을 주니 from=next_from 으로 이어 읽는다. 긴 문서는 먼저 get_outline 으로 구조를 보고 필요한 범위(from,to)만 읽는다.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'integer', description: '시작 문단 번호(생략하면 1)' },
        to: { type: 'integer', description: '끝 문단 번호(생략하면 끝까지)' },
      },
    },
    run: async (args = {}) => {
      const s = snapshot()
      if (!s) return refuse('편집기가 아직 준비되지 않았습니다')
      const total = s.paras.length
      const from = clampInt(args.from, 1, Math.max(1, total), 1)
      const to = clampInt(args.to, from, Math.max(from, total), total)
      const lines = []
      let used = 0
      let lastN = from - 1
      let truncated = false
      let started = false
      for (const e of s.entries) {
        if (e.para) {
          if (e.para.n < from) continue
          if (e.para.n > to) break
          started = true
          const model = paraModel(e.para.node, e.para.pos)
          const line = `[${e.para.n}] ${markerOf(e.para)}${toDisplay(model)}`
          if (used + line.length + 1 > MAX_READ_CHARS) { truncated = true; break }
          lines.push(line)
          used += line.length + 1
          lastN = e.para.n
        } else if (started) {
          lines.push(e.misc)
          used += e.misc.length + 1
        }
      }
      return {
        result: { total_paragraphs: total, from, to: lastN, truncated, next_from: truncated ? lastN + 1 : null, text: lines.join('\n') },
        summary: truncated ? `문서 ${from}~${lastN}번 문단을 읽음(이어 읽기 필요)` : `문서 ${total}개 문단 중 ${from}~${lastN}번을 읽음`,
      }
    },
  }

  function selectionSegments(snap) {
    const st = snap.state
    const ranges = st.selection.ranges.map((r) => [r.$from.pos, r.$to.pos])
    const segs = []
    const empty = st.selection.empty
    for (const p of snap.paras) {
      const model = paraModel(p.node, p.pos)
      let i0 = -1
      let i1 = -1
      model.chars.forEach((c, i) => {
        if (ranges.some(([f, t]) => c.pos >= f && c.end <= t)) { if (i0 < 0) i0 = i; i1 = i + 1 }
      })
      if (i0 >= 0) segs.push({ p, model, i0, i1 })
      else if (empty) {
        const f = ranges[0][0]
        if (f >= p.pos + 1 && f <= p.end - 1) segs.push({ p, model, i0: model.chars.filter((c) => c.pos < f).length, i1: model.chars.filter((c) => c.pos < f).length, cursor: true })
      }
    }
    return segs
  }

  const get_selection = {
    name: 'get_selection',
    description: '사용자가 편집기에서 선택한 글과 그 글이 속한 문단 번호를 돌려준다. 선택이 없으면 커서가 있는 문단 번호만 준다.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const s = snapshot()
      if (!s) return refuse('편집기가 아직 준비되지 않았습니다')
      const segs = selectionSegments(s)
      if (s.state.selection.empty) {
        const c = segs[0]
        return { result: { empty: true, cursor_paragraph: c ? c.p.n : null, text: '' }, summary: '선택한 글 없음' }
      }
      let text = segs.map((g) => toDisplay(g.model, g.i0, g.i1)).join('\n')
      let cut = false
      if (text.length > 20000) { text = text.slice(0, 20000); cut = true }
      const ns = segs.map((g) => g.p.n)
      return {
        result: { empty: false, text, from_paragraph: ns[0] ?? null, to_paragraph: ns[ns.length - 1] ?? null, paragraphs: ns.slice(0, 100), truncated: cut },
        summary: `선택한 글 ${text.length}자를 읽음`,
      }
    },
  }

  // ── 쓰기 공통: 문단 번호 목록에 대한 변경 모음
  function collectParaChange(snap, p, newDisplay, reg, opts = {}) {
    const model = paraModel(p.node, p.pos)
    const newInt = fromDisplay(newDisplay, model, 0, model.chars.length)
    const plan = planChange(snap.state.schema, model, 0, model.chars.length, newInt)
    if (opts.maxRatio) {
      const a = model.s.length
      const b = newInt.length
      const changed = plan.hunks.reduce((n, h) => n + h.before.length + h.after.length, 0)
      if (Math.max(a, b) > 8 && changed / Math.max(a, b) > opts.maxRatio) return { skipped: '많이 바뀌어 맞춤법 고치기 범위를 넘음' }
    }
    reg.prims.push(...plan.prims)
    return { hunks: plan.hunks, model }
  }

  const replace_selection = {
    name: 'replace_selection',
    description: '사용자가 선택한 글을 새 글로 바꾼다. 선택이 없으면 커서 위치에 넣는다. 서식(굵게, 링크 등)은 바뀌지 않은 글자에 그대로 남는다. 선택이 여러 문단이면 줄바꿈(\\n)으로 문단별 새 글을 준다. 비밀값·체크박스 같은 조각은 유지된다.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '선택 영역을 대신할 새 글(일반 글자만, HTML 아님)' } },
      required: ['text'],
    },
    run: async (args = {}) => {
      const bad = guard()
      if (bad) return refuse(bad)
      const text = cleanStr(args.text)
      if (text == null) return refuse('text 가 필요합니다')
      const snap = snapshot()
      const sel = snap.state.selection
      if (sel.ranges.length > 1) return refuse('표 칸 여러 개를 선택한 상태는 지원하지 않습니다. 문단 번호로 edit_paragraphs 를 써 주세요')
      const segs = selectionSegments(snap)
      if (!segs.length) return refuse('글이 있는 곳을 선택해 주세요')
      const reg = { prims: [] }
      let hunks = 0
      let lines
      if (segs.length === 1) lines = [text]
      else {
        lines = text.split('\n')
        if (lines.length !== segs.length) {
          const f = lines.filter((l) => l.trim())
          if (f.length === segs.length) lines = f
        }
        if (lines.length > segs.length) lines = [...lines.slice(0, segs.length - 1), lines.slice(segs.length - 1).join('\n')]
        while (lines.length < segs.length) lines.push('')
      }
      segs.forEach((g, k) => {
        const newInt = fromDisplay(lines[k], g.model, g.i0, g.i1)
        const plan = planChange(snap.state.schema, g.model, g.i0, g.i1, newInt)
        reg.prims.push(...plan.prims)
        hunks += plan.hunks.length
      })
      const done = commit(snap.editor, reg.prims, 'replace_selection')
      if (!done) return { result: { ok: true, changed: false }, summary: '바뀐 곳 없음' }
      return { result: { ok: true, changed: true, paragraphs: segs.map((g) => g.p.n) }, summary: segs.length > 1 ? `${segs.length}개 문단 선택 영역을 바꿈` : '선택한 글을 바꿈', undo: done.undo }
    },
  }

  const replace_text = {
    name: 'replace_text',
    description: '문서에서 글을 찾아 바꾼다(일반 글자 검색, 정규식 아님). 한 문단 안에서 이어진 글만 찾는다. 바꾼 개수를 돌려준다. 같은 표현을 문서 전체에서 통일할 때 쓴다.',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string', description: '찾을 글' },
        replace: { type: 'string', description: '바꿀 글(빈 문자열이면 지움)' },
        all: { type: 'boolean', description: 'true(기본)이면 모두, false 이면 첫 번째만' },
        matchCase: { type: 'boolean', description: '영문 대소문자 구분(기본 false)' },
      },
      required: ['find', 'replace'],
    },
    run: async (args = {}) => {
      const bad = guard()
      if (bad) return refuse(bad)
      const find = cleanStr(args.find, 2000)
      const rep = cleanStr(args.replace, MAX_TEXT)
      if (!find) return refuse('find 가 필요합니다')
      if (rep == null) return refuse('replace 가 필요합니다')
      const all = args.all !== false
      const mc = args.matchCase === true
      const snap = snapshot()
      const schema = snap.state.schema
      const needle = stripPua(find)
      const hay = (s) => (mc ? s : s.toLowerCase())
      const nd = hay(needle)
      const prims = []
      const where = []
      let count = 0
      outer: for (const p of snap.paras) {
        const model = paraModel(p.node, p.pos)
        const h = hay(model.s)
        if (h.length !== model.s.length) continue
        let from = 0
        let hit = 0
        while (count < MAX_REPLACE) {
          const i = h.indexOf(nd, from)
          if (i < 0) break
          const plan = planChange(schema, model, i, i + nd.length, stripPua(rep))
          prims.push(...plan.prims)
          count += 1
          hit += 1
          from = i + nd.length
          if (!all) { where.push(p.n); break outer }
        }
        if (hit) where.push(p.n)
        if (count >= MAX_REPLACE) break
      }
      if (!count) return { result: { ok: true, replaced: 0 }, summary: `'${short(find, 20)}' 을(를) 찾지 못함` }
      const done = commit(snap.editor, prims, 'replace_text')
      return {
        result: { ok: true, replaced: count, paragraphs: where.slice(0, 50), note: count >= MAX_REPLACE ? `최대 ${MAX_REPLACE}곳까지만 바꿈` : undefined },
        summary: `${count}곳 바꿈`,
        undo: done?.undo,
      }
    },
  }

  const edit_paragraphs = {
    name: 'edit_paragraphs',
    description: '문단 번호로 문단을 고친다. op 는 replace(문단 글 전체를 새 글로 교체, 바뀐 글자만 고쳐지고 서식은 남음), insert_after(그 문단 뒤에 새 문단 추가, 줄바꿈마다 문단 하나), delete(문단 지움). 표나 이미지는 건드리지 않는다. 번호는 직전 read_document 기준이며, insert_after 와 delete 뒤에는 번호가 밀리므로 다시 읽는다. 한 번 호출 안의 번호는 모두 호출 전 기준이다.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: `최대 ${MAX_EDITS}개`,
          items: {
            type: 'object',
            properties: {
              n: { type: 'integer', description: '문단 번호' },
              op: { type: 'string', enum: ['replace', 'insert_after', 'delete'] },
              text: { type: 'string', description: 'replace, insert_after 에 필요한 새 글(일반 글자만)' },
              was: { type: 'string', description: '고치기 전 문단의 앞부분 몇 글자(선택, 번호가 어긋났는지 확인용)' },
            },
            required: ['n', 'op'],
          },
        },
      },
      required: ['edits'],
    },
    run: async (args = {}) => {
      const bad = guard()
      if (bad) return refuse(bad)
      if (!Array.isArray(args.edits) || !args.edits.length) return refuse('edits 가 비어 있습니다')
      const snap = snapshot()
      const map = paraMap(snap)
      const errors = []
      const reg = { prims: [] }
      const used = new Map() // n -> 'edit' | 'delete'
      const inserts = new Map() // n -> lines
      let replaced = 0
      let inserted = 0
      let deleted = 0
      let hunkCount = 0
      for (const raw of args.edits.slice(0, MAX_EDITS)) {
        if (!isObj(raw)) { errors.push('edit 형식이 올바르지 않음'); continue }
        const n = clampInt(raw.n, 0, 1e9, -1)
        const p = map.get(n)
        const op = raw.op
        if (!p) { errors.push(`${raw.n}번 문단 없음(전체 ${snap.paras.length}개)`); continue }
        if (!['replace', 'insert_after', 'delete'].includes(op)) { errors.push(`${n}번: op 가 올바르지 않음`); continue }
        const model = paraModel(p.node, p.pos)
        const was = cleanStr(raw.was ?? '', 200)
        if (was && !toDisplay(model).replace(/\s+/g, '').startsWith(was.replace(/\s+/g, '').slice(0, 12))) {
          errors.push(`${n}번: was 와 문단 앞부분이 달라 건너뜀(번호가 밀렸는지 확인)`)
          continue
        }
        if (op === 'insert_after') {
          const t = cleanStr(raw.text)
          if (t == null) { errors.push(`${n}번: text 가 필요`); continue }
          if (used.get(n) === 'delete') { errors.push(`${n}번: delete 와 insert_after 를 함께 쓸 수 없음`); continue }
          inserts.set(n, [...(inserts.get(n) || []), ...stripPua(t).split('\n')])
          continue
        }
        if (used.has(n)) { errors.push(`${n}번: 한 번에 하나만 할 수 있음`); continue }
        if (op === 'replace') {
          const t = cleanStr(raw.text)
          if (t == null) { errors.push(`${n}번: text 가 필요`); continue }
          const r = collectParaChange(snap, p, t, reg)
          used.set(n, 'edit')
          if (r.hunks.length) { replaced += 1; hunkCount += r.hunks.length }
        } else {
          if (inserts.has(n)) { errors.push(`${n}번: delete 와 insert_after 를 함께 쓸 수 없음`); continue }
          const d = planDelete(snap.state.doc, p, model)
          if (d.error) { errors.push(`${n}번: ${d.error}`); continue }
          reg.prims.push(...d.prims)
          used.set(n, 'delete')
          deleted += 1
        }
      }
      for (const [n, lines] of inserts) {
        const p = map.get(n)
        reg.prims.push(planInsertAfter(snap.state.doc, p, lines))
        inserted += lines.length
      }
      const done = reg.prims.length ? commit(snap.editor, reg.prims, 'edit_paragraphs') : null
      const parts = []
      if (replaced) parts.push(`${replaced}개 문단 고침`)
      if (inserted) parts.push(`${inserted}개 문단 추가`)
      if (deleted) parts.push(`${deleted}개 문단 삭제`)
      const summary = parts.length ? parts.join(', ') : errors.length ? `적용 안 됨: ${errors[0]}` : '바뀐 곳 없음'
      return {
        result: { ok: !!done, replaced, inserted, deleted, errors: errors.slice(0, 10), paragraph_count: walkDoc(ed().state.doc).paras.length, note: inserted || deleted ? '문단 번호가 바뀌었으니 이어서 고치려면 read_document 로 다시 읽을 것' : undefined },
        summary,
        undo: done?.undo,
      }
    },
  }

  const fix_typos = {
    name: 'fix_typos',
    description: '맞춤법, 띄어쓰기, 오타를 고친 문단을 한 번에 적용한다(되돌리기 1회). 먼저 read_document 로 읽고, 고칠 곳이 있는 문단만 "고친 문단 전체 글"로 넘긴다. 어휘, 문체, 어순을 바꾸는 다시 쓰기는 하지 않는다(많이 바뀐 문단은 건너뛴다). 바뀐 글자만 최소로 고쳐지고 서식, 링크, 댓글 표시는 남는다.',
    parameters: {
      type: 'object',
      properties: {
        fixes: {
          type: 'array',
          description: `최대 ${MAX_EDITS}개`,
          items: {
            type: 'object',
            properties: {
              n: { type: 'integer', description: '문단 번호' },
              text: { type: 'string', description: '맞춤법을 고친 문단 전체 글' },
            },
            required: ['n', 'text'],
          },
        },
      },
      required: ['fixes'],
    },
    run: async (args = {}) => {
      const bad = guard()
      if (bad) return refuse(bad)
      if (!Array.isArray(args.fixes) || !args.fixes.length) return refuse('fixes 가 비어 있습니다')
      const snap = snapshot()
      const map = paraMap(snap)
      const reg = { prims: [] }
      const changes = []
      const skipped = []
      const errors = []
      const seen = new Set()
      let paras = 0
      let spots = 0
      for (const raw of args.fixes.slice(0, MAX_EDITS)) {
        if (!isObj(raw)) { errors.push('fix 형식이 올바르지 않음'); continue }
        const n = clampInt(raw.n, 0, 1e9, -1)
        const p = map.get(n)
        const t = cleanStr(raw.text)
        if (!p) { errors.push(`${raw.n}번 문단 없음`); continue }
        if (t == null) { errors.push(`${n}번: text 가 필요`); continue }
        if (seen.has(n)) { errors.push(`${n}번 중복`); continue }
        seen.add(n)
        const r = collectParaChange(snap, p, t, reg, { maxRatio: 0.6 })
        if (r.skipped) { skipped.push({ n, reason: r.skipped }); continue }
        if (!r.hunks.length) continue
        paras += 1
        spots += r.hunks.length
        for (const h of r.hunks) if (changes.length < 40) changes.push({ n, before: short(h.before, 30), after: short(h.after, 30) })
      }
      const done = reg.prims.length ? commit(snap.editor, reg.prims, 'fix_typos') : null
      const summary = done ? `${paras}개 문단, ${spots}곳 고침` : skipped.length ? `건너뜀 ${skipped.length}개(많이 바뀜)` : '고칠 곳 없음'
      return { result: { ok: true, paragraphs_changed: paras, spots_changed: spots, changes, skipped, errors: errors.slice(0, 10) }, summary, undo: done?.undo }
    },
  }

  const insert_blocks = {
    name: 'insert_blocks',
    description: '문서에 새 블록(문단, 제목, 글머리/번호/체크 목록, 표)을 넣는다. after_n 문단 뒤(그 문단을 품은 목록이나 표가 있으면 그 뒤)에 넣고, 생략하면 커서 위치 블록 뒤에 넣는다(빈 문서의 빈 문단은 대체). after_n 이 0 이면 문서 맨 앞. 같은 종류 목록 블록이 이어지면 한 목록이 되고 depth(0~3)로 중첩한다. 표는 rows(문자열 2차원 배열)를 주고 첫 행은 머리글이 된다. 한글 모드 항목 부호는 목록 구조에서 자동으로 붙으므로 text 에 부호 문자를 쓰지 않는다.',
    parameters: {
      type: 'object',
      properties: {
        after_n: { type: 'integer', description: '이 번호의 문단 뒤에 넣는다(0 이면 맨 앞, 생략하면 커서 뒤)' },
        blocks: {
          type: 'array',
          description: '최대 200개',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: BLOCK_TYPES },
              text: { type: 'string', description: 'paragraph, heading, 목록 항목의 글' },
              level: { type: 'integer', description: 'heading 단계 1~4(기본 2)' },
              depth: { type: 'integer', description: '목록 중첩 0~3' },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table 의 행들(첫 행은 머리글)' },
            },
            required: ['type'],
          },
        },
      },
      required: ['blocks'],
    },
    run: async (args = {}) => {
      const bad = guard()
      if (bad) return refuse(bad)
      const { blocks, errors } = cleanBlocks(args.blocks)
      if (!blocks.length) return refuse(errors[0] || 'blocks 가 필요합니다')
      const snap = snapshot()
      const { doc } = snap.state
      const built = buildBlocks(snap.state.schema, blocks)
      if (!built.nodes.length) return refuse(built.errors[0] || '넣을 블록이 없습니다')
      let from
      let to
      const hasN = args.after_n !== undefined && args.after_n !== null
      if (hasN && clampInt(args.after_n, 0, 1e9, -1) === 0) { from = 0; to = 0 }
      else {
        let p
        if (hasN) {
          p = paraMap(snap).get(clampInt(args.after_n, 0, 1e9, -1))
          if (!p) return refuse(`${args.after_n}번 문단이 없습니다(전체 ${snap.paras.length}개)`)
        } else {
          const head = snap.state.selection.head
          p = snap.paras.find((q) => head >= q.pos && head <= q.end) || snap.paras[snap.paras.length - 1]
        }
        const $p = p ? doc.resolve(p.pos) : null
        if (!$p) { from = doc.content.size; to = from } else {
          const top = $p.index(0)
          let start = 0
          for (let i = 0; i < top; i += 1) start += doc.child(i).nodeSize
          const topNode = doc.child(top)
          from = start + topNode.nodeSize
          to = from
          const emptyTop = topNode.type.name === 'paragraph' && topNode.content.size === 0
          if (emptyTop && (!hasN || top === doc.childCount - 1)) { from = start; to = from + topNode.nodeSize }
        }
      }
      const nodes = [...built.nodes]
      if (to === doc.content.size || from === doc.content.size) {
        if (nodes[nodes.length - 1].type.name === 'table') nodes.push(snap.state.schema.nodes.paragraph.create())
      }
      const done = commit(snap.editor, [{ from, to, nodes }], 'insert_blocks')
      if (!done) return refuse('넣지 못했습니다')
      const counts = blocks.reduce((m, b) => ({ ...m, [b.type]: (m[b.type] || 0) + 1 }), {})
      return {
        result: { ok: true, inserted_blocks: built.nodes.length, by_type: counts, errors: [...errors, ...built.errors].slice(0, 10), note: '문단 번호가 바뀌었으니 이어서 고치려면 read_document 로 다시 읽을 것' },
        summary: `블록 ${built.nodes.length}개 넣음${counts.table ? `(표 ${counts.table})` : ''}`,
        undo: done.undo,
      }
    },
  }

  const set_document_title = {
    name: 'set_document_title',
    description: '문서 제목(파일 이름, 모든 탭 공통)을 바꾼다. 80자 이내.',
    parameters: { type: 'object', properties: { title: { type: 'string', description: '새 제목' } }, required: ['title'] },
    run: async (args = {}) => {
      const why = env.editBlock?.()
      if (why) return refuse(why)
      const t = cleanStr(args.title, 80)?.replace(/\n/g, ' ').trim()
      if (!t) return refuse('title 이 필요합니다')
      const old = env.getTitle?.() || ''
      if (old === t) return { result: { ok: true, changed: false }, summary: '제목이 이미 같음' }
      await env.setTitle(t)
      return {
        result: { ok: true, title: t },
        summary: `제목을 '${short(t, 24)}' 로 바꿈`,
        undo: () => { env.setTitle(old).catch(() => env.notify?.('제목을 되돌리지 못했습니다')) },
      }
    },
  }

  const run_gongmun_check = {
    name: 'run_gongmun_check',
    description: '한글(공문) 모드 문서의 공문서 표기와 개조식 문체를 서버 검사기로 검사한다. 문제마다 문단 번호(n), 규칙, 원문(match), 제안(suggest)을 준다. 고치는 일은 이 결과를 보고 edit_paragraphs 로 한다.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const hwp = env.getHwp?.() || {}
      if (hwp.mode !== 'hwp') return refuse('한글 모드에서만 공문 검사를 할 수 있습니다')
      const snap = snapshot()
      if (!snap) return refuse('편집기가 아직 준비되지 않았습니다')
      let items
      try {
        items = await env.runLint()
      } catch (e) {
        return refuse(`공문 검사 실패: ${e?.message || '서버 오류'}`)
      }
      const flat = snap.paras.map((p) => ({ n: p.n, t: paraModel(p.node, p.pos).s }))
      const issues = (items || []).slice(0, 80).map((it) => {
        const needle = String(it.match || '').replace(/^[-*>#\s]+/, '').replace(/[*_\\]/g, '').slice(0, 30)
        const hit = needle ? flat.find((f) => f.t.includes(needle)) : null
        return { n: hit?.n ?? null, rule: it.rule, severity: it.severity, message: it.message, match: short(String(it.match || ''), 60), suggest: it.suggest ? short(String(it.suggest), 100) : undefined }
      })
      return { result: { preset: hwp.preset, count: (items || []).length, issues }, summary: issues.length ? `공문 검사 ${(items || []).length}건` : '공문 검사 통과(지적 없음)' }
    },
  }

  const lib = { paraModel, toDisplay, fromDisplay, planChange, applyPrims, cleanStr, stripPua, clampInt, walkDoc }
  const extra = createExtraDocTools({ env, lib, snapshot, guard, refuse, commit, paraMap })
  const tools = [read_document, get_selection, replace_selection, replace_text, edit_paragraphs, fix_typos, insert_blocks, set_document_title, run_gongmun_check, ...extra].filter(Boolean)

  // 지금 보이는 상태(짧게)
  function getContext() {
    const snap = snapshot()
    if (!snap) return ''
    const hwp = env.getHwp?.() || {}
    const lines = []
    lines.push(`현재 탭: ${env.getTabTitle?.() || '제목 없음'}(문서 제목: ${env.getTitle?.() || ''})`)
    lines.push(`모드: ${hwp.mode === 'hwp' ? `한글(공문) 모드, 양식 ${hwp.preset}` : 'Docs 모드'}`)
    lines.push(`문단 수: ${snap.paras.length}, 댓글: ${env.commentCount?.() ? `${env.commentCount()}개 있음` : '없음'}`)
    const why = env.editBlock?.()
    lines.push(why ? `편집: 불가(${why})` : '편집: 가능')
    const head = snap.state.selection.head
    const cur = snap.paras.find((q) => head >= q.pos && head <= q.end)
    if (cur) lines.push(`커서 문단: ${cur.n}`)
    if (!snap.state.selection.empty) {
      const segs = selectionSegments(snap)
      let text = segs.map((g) => toDisplay(g.model, g.i0, g.i1)).join('\n')
      const total = text.length
      if (total > 2000) text = `${text.slice(0, 2000)}…(${total}자 중 앞부분)`
      const ns = segs.map((g) => g.p.n)
      if (ns.length) lines.push(`선택: 문단 ${ns[0]}${ns.length > 1 ? `~${ns[ns.length - 1]}` : ''}, ${total}자`)
      lines.push(`선택한 글:\n${text}`)
    } else lines.push('선택한 글: 없음')
    return lines.join('\n')
  }

  return { tools, getContext, snapshot }
}

