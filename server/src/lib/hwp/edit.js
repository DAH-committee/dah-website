// 편집 엔진: 연산(ops)을 현재 바이트에 하나씩 적용한다. 연산마다 다시 읽어 결과를 확인하고, 확인에 실패하면 그 연산만 되돌려 건너뛴다.
// HWPX: 섹션 XML 을 글자 범위 단위로 고친다(서식·런·줄배치 보존). 쓸 수 없는 경우만 kordoc 세션/패치로 되돌아간다.
// HWP 5.x: kordoc patchHwp(마크다운 경유)만 가능하다.
import { loadKordoc, HwpError } from './kordoc.js'
import { readDoc, gridOf, unesc, PARSE_OPTS } from './model.js'
import { alignIds, fingerprint } from './ids.js'
import { rangeSplices } from './textmap.js'
import { regen, shiftFollowing, parseHeader } from './layout.js'
import { openZip, readSections, writeZip, esc, paraEnd, ownLineSeg, topLevelParas, hostPara, attr } from './xml.js'

export const OPS = ['replace_block', 'replace_cell', 'insert_paragraph_after', 'delete_block', 'table_add_rows', 'fill_fields', 'replace_text', 'apply_markdown', 'redact', 'place_seal']
export const HWPX_ONLY = ['insert_paragraph_after', 'delete_block', 'table_add_rows', 'fill_fields', 'redact', 'place_seal']
export const EDIT_SUPPORT = { hwpx: OPS, hwp: OPS.filter((o) => !HWPX_ONLY.includes(o)) }

export const MAX_OPS = 200
export const MAX_TEXT = 200_000
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s, n = 80) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s))

class Ctx {
  constructor({ bytes, format, ids, counter }) {
    this.bytes = bytes
    this.format = format
    this.ids = ids
    this.counter = counter
    this.applied = []
    this.skipped = []
    this.changedBlocks = new Set()
    this.added = new Set()
    this.removed = new Set()
  }
  async init() {
    this.k = await loadKordoc()
    this.doc = await readDoc(this.bytes, this.format)
    if (this.ids.length !== this.doc.blocks.length) {
      // 저장된 id 표가 어긋나면 지금 블록에 맞게 다시 정렬한다
      const a = alignIds(null, fingerprint(this.doc.blocks), this.counter)
      this.ids = a.ids
      this.counter = a.counter
    }
    this.scans = null
  }
  /** 새 바이트로 갈아끼운다. ids 는 호출자가 알면 넘기고, 모르면 정렬한다 */
  async swap(newBytes, newIds = null) {
    const prevFp = fingerprint(this.doc.blocks)
    this.bytes = newBytes
    this.doc = await readDoc(newBytes, this.format)
    this.scans = null
    if (newIds && newIds.length === this.doc.blocks.length) { this.ids = newIds; return }
    const a = alignIds({ ...prevFp, ids: this.ids }, fingerprint(this.doc.blocks), this.counter)
    for (const x of a.added) this.added.add(x)
    for (const x of a.removed) this.removed.add(x)
    this.ids = a.ids
    this.counter = a.counter
  }
  idx(id) {
    const i = this.ids.indexOf(String(id))
    return i
  }
  skip(opIndex, type, reason, message, extra = {}) {
    this.skipped.push({ op: opIndex, type, reason, message, ...extra })
  }
  async sections() {
    if (!this.scans) {
      const zip = await openZip(this.bytes)
      const secs = await readSections(zip)
      this.zip = zip
      const hx = zip.file('Contents/header.xml')
      this.hdr = hx ? parseHeader(await hx.async('string')) : { char: new Map(), para: new Map() }
      this.scans = new Map()
      for (const s of secs) this.scans.set(s.index, { ...s, scan: this.k.scanSectionXml(s.xml, s.index) })
    }
    return this.scans
  }
}

// ── 위치 찾기(HWPX) ─────────────────────────────────────────────
async function locate(ctx, i) {
  const ref = ctx.doc.session?.sourceRef(i)
  if (!ref) return null
  const secs = await ctx.sections()
  const s = secs.get(ref.sectionIndex)
  if (!s) return null
  if (ref.kind === 'paragraph') {
    const para = s.scan.bodyParagraphs.find((p) => p.start === ref.xmlStart)
    return para ? { sec: s, ref, para } : { sec: s, ref }
  }
  const table = s.scan.tables.find((t) => t.start === ref.xmlStart) || s.scan.tables.find((t) => Math.abs(t.start - ref.xmlStart) < 8)
  return { sec: s, ref, table }
}

function cellOf(table, r, c) {
  if (!table) return null
  for (let ri = 0; ri < table.rows.length; ri++) {
    for (let ci = 0; ci < table.rows[ri].length; ci++) {
      const cell = table.rows[ri][ci]
      if ((cell.rowAddr ?? ri) === r && (cell.colAddr ?? ci) === c) return cell
    }
  }
  return table.cellByAnchor?.get?.(`${r},${c}`) || null
}

// ── 글자 범위 고치기 ───────────────────────────────────────────
function diffRange(oldT, newT) {
  let s = 0
  const max = Math.min(oldT.length, newT.length)
  while (s < max && oldT[s] === newT[s]) s++
  let e = 0
  while (e < max - s && oldT[oldT.length - 1 - e] === newT[newT.length - 1 - e]) e++
  // 서로게이트 쌍을 가르지 않는다
  const hi = (c) => c >= 0xd800 && c <= 0xdbff
  if (s > 0 && hi(oldT.charCodeAt(s - 1))) s--
  if (e > 0 && hi(oldT.charCodeAt(oldT.length - e - 1)) === false && oldT.charCodeAt(oldT.length - e) >= 0xdc00 && oldT.charCodeAt(oldT.length - e) <= 0xdfff) e--
  return { s, oldEnd: oldT.length - e, rep: newT.slice(s, newT.length - e) }
}

/** 한 문단의 글을 newFull 로 바꾸는 splice 들. 서식 있는 런 구조를 건드리지 않는다. 안 되면 null */
function paraSplices(ctx, xml, para, newFull, { shift = false } = {}) {
  const k = ctx.k
  const oldT = para.text
  if (oldT === newFull) return []
  const { s, oldEnd, rep } = diffRange(oldT, newFull)
  let sp = rangeSplices(xml, para, s, oldEnd, rep)
  if (!sp) {
    try { sp = k.buildRangeSplices(para, xml, s, oldEnd, rep) } catch { sp = null }
  }
  if (!sp) {
    try { sp = k.buildParagraphSplices(para, newFull, xml) } catch { sp = null }
  }
  if (!sp) return null
  if (oldT.length !== newFull.length) {
    const end = paraEnd(xml, para.start)
    const ls = end > 0 ? ownLineSeg(xml, para.start, end) : null
    if (ls) {
      // 줄바꿈을 다시 계산해 줄배치를 새로 쓴다. 못 하면 지운다(한컴이 열 때 다시 조판)
      const r = ctx.hdr ? regen(xml, para.start, newFull, ctx.hdr, k) : null
      if (r) {
        sp = sp.concat([{ start: r.range.start, end: r.range.end, replacement: r.xml }])
        if (shift) sp = sp.concat(shiftFollowing(xml, end, (r.newLines - r.oldLines) * r.step))
      } else sp = sp.concat([{ start: ls.start, end: ls.end, replacement: '' }])
    }
  }
  return sp
}

const keepEdges = (oldT, text) => {
  const lead = /^\s*/.exec(oldT)[0]
  const trail = /\s*$/.exec(oldT)[0]
  return lead + text.trim() + (oldT.trim() ? trail : '')
}

async function commitSections(ctx, changes) {
  // changes: Map<sectionIndex, newXml>
  const secs = await ctx.sections()
  const rep = {}
  for (const [si, xml] of changes) rep[secs.get(si).name] = xml
  const out = await writeZip(ctx.zip, rep)
  ctx.scans = null
  return out
}

// ── 각 연산 ───────────────────────────────────────────────────
function checkExpect(op, current) {
  if (op.expect === undefined || op.expect === null) return true
  const a = norm(op.expect), b = norm(current)
  return b === a || b.startsWith(a)
}

async function afterTextEdit(ctx, opIndex, type, newBytes, check, fallback) {
  const before = ctx.doc
  const beforeBytes = ctx.bytes
  try {
    await ctx.swap(newBytes, ctx.ids)
    if (ctx.doc.blocks.length === before.blocks.length && check(ctx.doc)) return true
  } catch { /* 되돌린다 */ }
  await ctx.swap(beforeBytes, ctx.ids)
  if (fallback) return fallback()
  return false
}

async function sessionPatch(ctx, edits) {
  const sess = await ctx.k.openHwpxDocument(ctx.bytes)
  const res = await sess.patchBlocks(edits, { verify: true })
  return res
}

async function opReplaceBlock(ctx, op, n) {
  const i = ctx.idx(op.block)
  if (i < 0) return ctx.skip(n, 'replace_block', 'NOT_FOUND', `블록 ${op.block} 를 찾을 수 없습니다.`)
  const b = ctx.doc.blocks[i]
  if (b.type === 'table') return ctx.skip(n, 'replace_block', 'UNSUPPORTED', '표는 replace_cell 로 칸을 고치세요.')
  if (b.type === 'image' || b.type === 'separator') return ctx.skip(n, 'replace_block', 'LOCKED', '이 블록은 글을 고칠 수 없습니다.')
  const cap = ctx.doc.caps?.[i]
  if (cap?.capability === 'locked') return ctx.skip(n, 'replace_block', 'LOCKED', cap.reason || '이 블록은 고칠 수 없습니다.')
  const cur = unesc(b.text)
  if (!checkExpect(op, cur)) return ctx.skip(n, 'replace_block', 'STALE', '지금 글이 예상과 달라 건너뜁니다.', { block: op.block, current: clip(cur) })
  const text = String(op.text ?? '')
  if (!text.trim()) return ctx.skip(n, 'replace_block', 'EMPTY_TEXT', '빈 글로 바꿀 수 없습니다. 문단을 지우려면 delete_block 을 쓰세요.')
  if (text.length > MAX_TEXT) return ctx.skip(n, 'replace_block', 'TOO_LARGE', '글이 너무 깁니다.')
  if (norm(cur) === norm(text)) return ctx.skip(n, 'replace_block', 'UNCHANGED', '이미 같은 글입니다.')
  const ok = ctx.format === 'hwpx' ? await hwpxReplacePara(ctx, i, text) : await hwpMdEdit(ctx, (blocks) => { blocks[i].text = text })
  if (!ok) return ctx.skip(n, 'replace_block', 'UNSUPPORTED', '이 문단은 서식을 지키면서 고칠 수 없는 구조입니다.', { block: op.block })
  ctx.changedBlocks.add(ctx.ids[i])
  ctx.applied.push({ op: n, type: 'replace_block', block: op.block, before: clip(cur), after: clip(text) })
}

async function hwpxReplacePara(ctx, i, text) {
  const loc = await locate(ctx, i)
  const want = norm(text)
  if (loc?.para) {
    const xml = loc.sec.xml
    const newFull = keepEdges(loc.para.text, text)
    const sp = paraSplices(ctx, xml, loc.para, newFull, { shift: true })
    if (sp) {
      const nx = ctx.k.applySplices(xml, sp)
      const out = await commitSections(ctx, new Map([[loc.sec.index, nx]]))
      const ok = await afterTextEdit(ctx, 0, '', out, (d) => norm(unesc(d.blocks[i].text)) === want)
      if (ok) return true
    }
  }
  // 되돌아가기: kordoc 세션(첫 런 서식으로 합침)
  const res = await sessionPatch(ctx, [{ blockIndex: i, newText: text }])
  if (!res.success || !res.data || res.applied < 1) return false
  const keep = ctx.bytes
  await ctx.swap(res.data, ctx.ids)
  if (ctx.doc.blocks.length === ctx.ids.length && norm(unesc(ctx.doc.blocks[i].text)) === want) return true
  await ctx.swap(keep, ctx.ids)
  return false
}

async function opReplaceCell(ctx, op, n) {
  let blockId = op.table, row = op.row, col = op.col
  const m = /^(b\d+)#r(\d+)c(\d+)$/.exec(String(op.cell || op.table || ''))
  if (m) { blockId = m[1]; row = parseInt(m[2], 10); col = parseInt(m[3], 10) }
  const i = ctx.idx(blockId)
  if (i < 0) return ctx.skip(n, 'replace_cell', 'NOT_FOUND', `표 ${blockId} 를 찾을 수 없습니다.`)
  const b = ctx.doc.blocks[i]
  if (b.type !== 'table') return ctx.skip(n, 'replace_cell', 'UNSUPPORTED', '표 블록이 아닙니다.')
  const g = gridOf(b.table)
  const x = g[row]?.[col]
  if (!Number.isInteger(row) || !Number.isInteger(col) || !x) return ctx.skip(n, 'replace_cell', 'NOT_FOUND', `칸 (${row}, ${col}) 가 표 범위를 벗어났습니다.`)
  if (x.covered) return ctx.skip(n, 'replace_cell', 'NOT_FOUND', `칸 (${row}, ${col}) 는 병합된 칸입니다. 시작 칸 (${x.covered[0]}, ${x.covered[1]}) 를 고치세요.`)
  if (ctx.doc.caps?.[i]?.capability === 'locked') return ctx.skip(n, 'replace_cell', 'LOCKED', ctx.doc.caps[i].reason || '이 표는 서식을 지키며 고칠 수 없습니다.')
  const cap = ctx.doc.caps?.[i]?.cells?.[row]?.[col]
  if (cap && !cap.editable) return ctx.skip(n, 'replace_cell', 'LOCKED', cap.reason || '이 칸은 고칠 수 없습니다.')
  const cur = unesc(x.cell.text)
  if (!checkExpect(op, cur)) return ctx.skip(n, 'replace_cell', 'STALE', '지금 글이 예상과 달라 건너뜁니다.', { cell: `${blockId}#r${row}c${col}`, current: clip(cur) })
  const text = String(op.text ?? '')
  if (text.length > MAX_TEXT) return ctx.skip(n, 'replace_cell', 'TOO_LARGE', '글이 너무 깁니다.')
  if (cur === text || norm(cur) === norm(text)) return ctx.skip(n, 'replace_cell', 'UNCHANGED', '이미 같은 글입니다.')
  const check = (d) => d.blocks[i].type === 'table' && norm(unesc(gridOf(d.blocks[i].table)[row]?.[col]?.cell?.text)) === norm(text)
  let ok = false
  if (ctx.format === 'hwpx') {
    if (!cur.trim() && text.trim()) {
      // 빈 칸에 처음 쓰기: kordoc 세션이 첫 런 서식을 쓴다
      ok = await hwpxCellViaSession(ctx, i, row, col, text, check)
    } else {
      ok = await hwpxReplaceCellPrecise(ctx, i, row, col, cur, text, check)
      if (!ok) ok = await hwpxCellViaSession(ctx, i, row, col, text, check)
    }
  } else {
    ok = await hwpMdEdit(ctx, (blocks) => { blocks[i].table.cells[row][col].text = text })
    if (ok && !check(ctx.doc)) ok = false
  }
  if (!ok) return ctx.skip(n, 'replace_cell', 'UNSUPPORTED', '이 칸은 서식을 지키면서 고칠 수 없는 구조입니다(줄 수가 달라졌거나 그림·중첩 표가 들어 있음).', { cell: `${blockId}#r${row}c${col}` })
  ctx.changedBlocks.add(blockId)
  ctx.applied.push({ op: n, type: 'replace_cell', block: blockId, cell: `${blockId}#r${row}c${col}`, before: clip(cur), after: clip(text) })
}

async function hwpxCellViaSession(ctx, i, row, col, text, check) {
  const res = await sessionPatch(ctx, [{ blockIndex: i, cells: [{ row, col, text }] }])
  if (!res.success || !res.data || res.applied < 1) return false
  const keep = ctx.bytes
  await ctx.swap(res.data, ctx.ids)
  if (ctx.doc.blocks.length === ctx.ids.length && check(ctx.doc)) return true
  await ctx.swap(keep, ctx.ids)
  return false
}

async function hwpxReplaceCellPrecise(ctx, i, row, col, cur, text, check) {
  const loc = await locate(ctx, i)
  const cell = cellOf(loc?.table, row, col)
  const paras = (cell?.paragraphs || []).filter((p) => p.kind === 'cell' || p.kind === 'body' || p.kind === 'draw')
  const texty = paras.filter((p) => p.text.trim())
  if (!cell || !texty.length) return false
  const lines = text.split(/\r?\n/)
  let sp = []
  const xml = loc.sec.xml
  if (texty.length === 1 && lines.length === 1) {
    const s = paraSplices(ctx, xml, texty[0], keepEdges(texty[0].text, text), { shift: true })
    if (!s) return false
    sp = s
  } else if (texty.length === lines.filter((l) => l.trim() !== '').length) {
    const ls = lines.filter((l) => l.trim() !== '')
    for (let q = 0; q < texty.length; q++) {
      const s = paraSplices(ctx, xml, texty[q], keepEdges(texty[q].text, ls[q]))
      if (!s) return false
      sp = sp.concat(s)
    }
  } else return false // 줄 수가 달라짐: 문단을 늘리거나 줄여야 해서 세션 경로에 맡긴다
  const nx = ctx.k.applySplices(xml, sp)
  const out = await commitSections(ctx, new Map([[loc.sec.index, nx]]))
  return afterTextEdit(ctx, 0, '', out, check)
}

// HWP 5.x: 블록을 고친 마크다운으로 patchHwp
async function hwpMdEdit(ctx, mutate) {
  const raw = structuredClone(ctx.doc.raw.blocks)
  mutate(raw)
  const md = ctx.k.blocksToMarkdown(raw)
  const res = await ctx.k.patchHwp(ctx.bytes, md, {})
  if (!res.success || !res.data || res.applied < 1) return false
  const keep = ctx.bytes
  await ctx.swap(res.data, ctx.ids)
  if (ctx.doc.blocks.length !== ctx.ids.length) { await ctx.swap(keep, ctx.ids); return false }
  return true
}

export { rangeSplices, Ctx, locate, cellOf, paraSplices, commitSections, keepEdges, norm, clip, checkExpect, hwpMdEdit, afterTextEdit, sessionPatch, opReplaceBlock, opReplaceCell }
