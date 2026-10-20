// 문서 중간 모델(IR) -> 편집기(Tiptap JSON). 순수 ESM, DOM 없음. 가져오기(.docx/.hwpx)와 왕복 시험에 쓴다.
//
//   const json = irToTiptap(ir, opts)   // { type:'doc', content:[...], page:{...content.page} }
//
// opts = {
//   assetSrc: { [assetId]: url },   // 그림을 이미 올려 둔 주소(없으면 data URL)
//   issues: [],                      // 변환하며 알게 된 일(그림이 글 사이에 있어 따로 뗀 것 등)을 모은다
// }
// 규칙
// - list.marker 가 글머리(•, ○, ㅇ, - ...)이거나 숫자(1. 1) (1))면 실제 목록으로, 그 밖의 부호(가. ① Ⅰ)는 글자로 앞에 적는다.
// - 첫 Run 이 check 인 list.kind='check' 문단은 작업 목록 항목, 목록 밖의 check Run 은 인라인 체크박스.
// - 그림은 편집기에서 블록이다. 글 사이에 낀 그림은 앞뒤 글을 나눠서 그림 블록으로 만든다.
// - 표: 열 폭은 colwidth(px), 병합은 colspan/rowspan, 행의 header 는 TableRow.header 로 남긴다.
import { normalizeIR } from './schema.js'
import { CELL_PT, DOC_BODY_LH, DOC_BODY_PT, DOC_HEAD_PT, MAIN_FONT_DEFAULT, normPage } from './tiptapToIR.js'

const PX_PER_PT = 4 / 3
const r2 = (v) => Math.round(v * 100) / 100
const BULLET_SET = /^[•◦▪▫●○■□◆◇·ㆍ\-–—*※ㅇ▶►✓■◼]$/

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  return btoa(s)
}

export function irToTiptap(irIn, opts = {}) {
  const { ir } = normalizeIR(irIn)
  const note = (msg) => opts.issues?.push({ level: 'info', msg })
  const def = ir.defaults
  const defSize = def.sizePt || DOC_BODY_PT
  const defFont = def.font?.ko || MAIN_FONT_DEFAULT
  const defLH = def.lineSpacing?.mode === 'percent' ? def.lineSpacing.value : DOC_BODY_LH

  const srcOf = (id) => {
    if (opts.assetSrc?.[id]) return opts.assetSrc[id]
    const a = ir.assets?.[id]
    if (!a) return null
    const data = typeof a.data === 'string' ? a.data : bytesToBase64(a.data)
    return `data:${a.mime || 'image/png'};base64,${data}`
  }

  // ── 글 ──
  function marksOf(r, ctx) {
    const marks = []
    if (r.bold && !ctx.dropBold) marks.push({ type: 'bold' })
    if (r.italic) marks.push({ type: 'italic' })
    if (r.underline) marks.push({ type: 'underline' })
    if (r.strike) marks.push({ type: 'strike' })
    if (r.sup) marks.push({ type: 'superscript' })
    if (r.sub) marks.push({ type: 'subscript' })
    if (r.link) marks.push({ type: 'link', attrs: { href: r.link, target: '_blank', rel: 'noreferrer', class: null } })
    if (r.highlight) marks.push({ type: 'highlight', attrs: { color: r.highlight } })
    const ts = {}
    if (r.color && r.color.toUpperCase() !== '#000000') ts.color = r.color
    const size = r.sizePt ?? (ctx.fallbackSize !== ctx.editorSize ? ctx.fallbackSize : null)
    if (size && Math.abs(size - ctx.editorSize) > 0.01) ts.fontSize = `${r2(size)}pt`
    const fam = r.font?.ko || r.font?.latin || (defFont !== MAIN_FONT_DEFAULT ? defFont : null)
    if (fam && fam !== MAIN_FONT_DEFAULT) ts.fontFamily = /\s/.test(fam) ? `'${fam}'` : fam
    if (r.scalePct && r.scalePct !== 100) ts.ratio = r.scalePct
    if (r.spacingPct) ts.spacing = r.spacingPct
    if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: ts })
    return marks
  }

  // 한 문단의 Run 들을 [인라인 노드 | {image}] 열로
  function inlineNodes(runs = [], ctx) {
    const out = []
    for (const r of runs) {
      if (r.br) out.push({ type: 'hardBreak' })
      else if (r.tab) out.push({ type: 'text', text: '\t' })
      else if (r.check) out.push({ type: 'checkbox', attrs: { checked: !!r.check.checked } })
      else if (r.image) out.push({ __image: r.image })
      else if (r.field) out.push({ type: 'text', text: r.field === 'page' ? '‹쪽›' : r.field === 'pages' ? '‹전체 쪽›' : '‹날짜›' })
      else if (r.text) {
        const m = marksOf(r, ctx)
        out.push(m.length ? { type: 'text', text: r.text, marks: m } : { type: 'text', text: r.text })
      }
    }
    return out
  }

  function paraAttrs(p, ctx) {
    const a = {}
    if (p.align && p.align !== def.align) a.textAlign = p.align === 'distribute' ? 'justify' : p.align
    else if (p.align && (def.align === 'justify' || def.align === 'center')) a.textAlign = p.align
    const ls = p.lineSpacing
    if (ls) {
      let pct = null
      if (ls.mode === 'percent') pct = ls.value
      else pct = Math.round((ls.value / (ctx.fallbackSize || defSize)) * 100)
      if (pct && Math.abs(pct - DOC_BODY_LH) > 0.5) a.lineHeight = Math.round(pct)
    } else if (defLH && Math.abs(defLH - DOC_BODY_LH) > 0.5 && !ctx.noDefLH) a.lineHeight = Math.round(defLH)
    if (!ctx.inList && p.indent) {
      if (p.indent.leftPt) a.indentLeft = r2(p.indent.leftPt)
      if (p.indent.firstLinePt) a.indentFirst = r2(p.indent.firstLinePt)
      if (p.indent.rightPt) a.indentRight = r2(p.indent.rightPt)
    }
    if (p.spaceBeforePt) a.spaceBefore = r2(p.spaceBeforePt)
    if (p.spaceAfterPt) a.spaceAfter = r2(p.spaceAfterPt)
    return a
  }

  function imageNode(im, p, extra = {}) {
    const src = srcOf(im.id)
    if (!src) return null
    return {
      type: 'image',
      attrs: { src, alt: im.alt || null, title: null, width: Math.round(im.wPt * PX_PER_PT), height: Math.round(im.hPt * PX_PER_PT), align: p?.align === 'center' || p?.align === 'right' ? p.align : 'left', wrap: 'inline', ...extra },
    }
  }

  // ── 블록 ──
  function paragraphBlocks(p, ctx) {
    const isHead = p.heading && p.heading >= 1
    const cctx = { ...ctx }
    if (isHead) { cctx.dropBold = true; cctx.editorSize = DOC_HEAD_PT[Math.min(4, p.heading)] || DOC_BODY_PT; cctx.fallbackSize = defSize === DOC_BODY_PT ? cctx.editorSize : defSize }
    else { cctx.editorSize = ctx.cell ? CELL_PT : DOC_BODY_PT; cctx.fallbackSize = defSize }
    // 제목: 기본 크기와 같은 sizePt 는 편집기 기본이므로 뺀다
    const runs = isHead ? p.runs.map((r) => (r.sizePt && Math.abs(r.sizePt - cctx.editorSize) < 0.01 ? { ...r, sizePt: undefined } : r)) : p.runs
    if (ctx.cell && !isHead) cctx.fallbackSize = defSize === DOC_BODY_PT ? CELL_PT : defSize
    const nodes = inlineNodes(runs, cctx)
    const attrs = paraAttrs(p, cctx)
    const hasImg = nodes.some((n) => n.__image)
    const out = []
    const mk = (content) => {
      const textual = content.length ? { content } : {}
      if (isHead) return { type: 'heading', attrs: { level: Math.min(4, p.heading), ...attrs }, ...textual }
      return { type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), ...textual }
    }
    if (!hasImg) return [mk(nodes)]
    // 글 사이에 그림이 낀 문단
    let buf = []
    const flush = () => { if (buf.length) { out.push(mk(buf)); buf = [] } }
    for (const n of nodes) {
      if (n.__image) {
        flush()
        const img = imageNode(n.__image, p)
        if (img) out.push(img)
        if (nodes.some((m) => !m.__image && m.type === 'text' && m.text.trim())) note('글 사이에 있던 그림을 별도 줄로 떼어 넣었습니다')
      } else buf.push(n)
    }
    flush()
    return out
  }

  function markerKind(p) {
    const l = p.list
    if (!l) return null
    if (l.kind === 'check') return 'task'
    if (l.marker == null || l.marker === '') return l.kind === 'ordered' ? 'ordered' : l.kind === 'bullet' ? 'bullet' : null
    if (BULLET_SET.test(l.marker)) return 'bullet'
    const m = /^\(?(\d+)[.)]$/.exec(l.marker)
    if (m) return 'ordered'
    return 'literal'
  }

  function blocksOut(blocks, ctx = {}) {
    const out = []
    let stack = [] // { kind, node, level }
    const closeAll = () => { stack = [] }
    const place = (kind, level, item, startNum) => {
      while (stack.length && stack[stack.length - 1].level > level) stack.pop()
      let top = stack[stack.length - 1]
      if (top && top.level === level) {
        if (top.kind === kind) { top.node.content.push(item); return }
        stack.pop()
        top = stack[stack.length - 1]
      }
      const node = { type: kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList', content: [item] }
      if (kind === 'ordered' && startNum && startNum !== 1) node.attrs = { start: startNum }
      if (top) top.node.content[top.node.content.length - 1].content.push(node)
      else out.push(node)
      stack.push({ kind, node, level })
    }

    for (const b of blocks) {
      if (b.t === 'p' && b.list) {
        const kind = markerKind(b)
        if (kind && kind !== 'literal') {
          const cctx = { ...ctx, inList: true }
          const level = Math.min(b.list.level || 0, 8)
          let p = b
          let checked = false
          if (kind === 'task') {
            const [first, ...rest] = p.runs
            checked = !!first?.check?.checked
            const stripped = first?.check ? rest : p.runs
            if (stripped[0]?.text === ' ') stripped.shift()
            else if (stripped[0]?.text?.startsWith(' ')) stripped[0] = { ...stripped[0], text: stripped[0].text.slice(1) }
            p = { ...p, runs: stripped }
          }
          const para = paragraphBlocks(p, cctx).filter((x) => x.type === 'paragraph' || x.type === 'heading')
          const first = para[0] || { type: 'paragraph' }
          const lead = first.type === 'heading' ? { type: 'paragraph', ...(first.content ? { content: first.content } : {}) } : first
          const item = { type: kind === 'task' ? 'taskItem' : 'listItem', ...(kind === 'task' ? { attrs: { checked } } : {}), content: [lead] }
          const numM = /^\(?(\d+)[.)]$/.exec(b.list.marker || '')
          place(kind, level, item, numM ? Number(numM[1]) : 1)
          continue
        }
      }
      closeAll()
      out.push(...blockOut(b, ctx))
    }
    return out
  }

  function blockOut(b, ctx) {
    if (b.t === 'p') {
      if (b.list && markerKind(b) === 'literal') {
        const lead = { type: 'text', text: `${b.list.marker} ` }
        const base = paragraphBlocks({ ...b, list: undefined }, ctx)
        if (base[0]?.content) base[0].content.unshift(lead)
        else if (base[0]) base[0].content = [lead]
        return base
      }
      return paragraphBlocks(b, ctx)
    }
    if (b.t === 'pagebreak') return [{ type: 'pageBreak' }]
    if (b.t === 'figure') {
      const src = srcOf(b.id)
      if (!src) return []
      const float = b.float?.x === 'right' ? 'right' : b.float?.x === 'left' ? 'left' : null
      const img = { type: 'image', attrs: { src, alt: b.alt || null, title: null, width: Math.round(b.wPt * PX_PER_PT), height: Math.round(b.hPt * PX_PER_PT), align: b.align || 'left', wrap: float || 'block' } }
      const out = [img]
      if (b.caption) out.push(...paragraphBlocks({ ...b.caption, align: b.caption.align || 'center' }, ctx))
      return out
    }
    if (b.t === 'table') return [tableOut(b, ctx)]
    return []
  }

  const borderOut = (bd) => (bd ? { style: bd.style, width: r2(bd.widthPt), color: bd.color } : undefined)
  const padOutPx = (p) => (p ? { top: r2(p.t * PX_PER_PT), right: r2(p.r * PX_PER_PT), bottom: r2(p.b * PX_PER_PT), left: r2(p.l * PX_PER_PT) } : null)

  function tableOut(t, ctx) {
    if (t.x?.rule) return { type: 'horizontalRule' }
    const colPx = t.colPt.map((x) => r2(x * PX_PER_PT))
    let col = 0
    const rowsOut = []
    const occ = t.rows.map(() => Array(t.colPt.length).fill(false))
    t.rows.forEach((r, ri) => {
      let c = 0
      const cells = []
      for (const cell of r.cells) {
        while (c < colPx.length && occ[ri][c]) c += 1
        const cs = cell.colspan || 1
        const rs = cell.rowspan || 1
        for (let rr = ri; rr < Math.min(t.rows.length, ri + rs); rr += 1) for (let cc = c; cc < Math.min(colPx.length, c + cs); cc += 1) occ[rr][cc] = true
        const attrs = {
          colspan: cs,
          rowspan: rs,
          colwidth: colPx.slice(c, c + cs),
          background: cell.bg || null,
          verticalAlign: cell.vAlign || null,
          borders: null,
          padding: padOutPx(cell.padPt),
        }
        if (cell.border) {
          const b = {}
          for (const k of ['top', 'right', 'bottom', 'left']) if (cell.border[k]) b[k] = borderOut(cell.border[k])
          if (Object.keys(b).length) attrs.borders = b
        }
        const content = blocksOut(cell.blocks, { ...ctx, cell: true })
        cells.push({ type: 'tableCell', attrs, content: content.length ? content : [{ type: 'paragraph' }] })
        c += cs
      }
      const rowAttrs = {}
      if (r.heightPt) rowAttrs.height = r2(r.heightPt * PX_PER_PT)
      if (r.header) rowAttrs.header = true
      rowsOut.push({ type: 'tableRow', ...(Object.keys(rowAttrs).length ? { attrs: rowAttrs } : {}), content: cells })
      col += 1
    })
    void col
    const attrs = { width: r2(t.widthPt * PX_PER_PT), align: t.align || null, borderStyle: borderOut(t.border) || null, padding: padOutPx(t.padPt) }
    return { type: 'table', attrs, content: rowsOut }
  }

  // ── 머리말·꼬리말 → 쪽 설정 ──
  function headFoot(blocks) {
    const spec = { text: '', align: 'left', image: null }
    let pageNo = null
    for (const b of blocks || []) {
      // 한글·워드에서 읽은 머리말 그림은 독립 그림 블록(figure)으로 올라올 수 있다
      if (b.t === 'figure') {
        const src = !spec.image ? srcOf(b.id) : null
        if (src) spec.image = { src, wPt: b.wPt, hPt: b.hPt, align: b.align || 'left' }
        continue
      }
      if (b.t !== 'p') continue
      const im = b.runs.find((r) => r.image)
      const fld = b.runs.find((r) => r.field === 'page')
      if (fld) { pageNo = { on: true, pos: ['left', 'center', 'right'].includes(b.align) ? b.align : 'center' }; continue }
      if (im && !spec.image) {
        const src = srcOf(im.image.id)
        if (src) spec.image = { src, wPt: im.image.wPt, hPt: im.image.hPt, align: b.align || 'left' }
        continue
      }
      const text = b.runs.map((r) => r.text || '').join('').trim()
      if (text && !spec.text) { spec.text = text; spec.align = b.align || 'left' }
    }
    return { spec, pageNo }
  }

  const body = blocksOut(ir.body, {})
  const h = headFoot(ir.header)
  const f = headFoot(ir.footer)
  const pg = ir.page
  const page = normPage({
    size: pg.size,
    orientation: pg.orientation,
    marginMm: pg.marginMm,
    headerMm: pg.headerMm,
    footerMm: pg.footerMm,
    pageNumbers: f.pageNo || h.pageNo || { on: false, pos: 'center' },
    header: h.spec,
    footer: f.spec,
  })
  return { type: 'doc', content: body.length ? body : [{ type: 'paragraph' }], page }
}
