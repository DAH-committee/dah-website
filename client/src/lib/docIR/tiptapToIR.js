// 편집기(Tiptap JSON) -> 문서 중간 모델(IR). 순수 ESM, DOM 없음. 명세는 README.md.
//
//   const { ir, issues } = tiptapToIR(json, ctx)
//
// ctx = {
//   title,                       // 문서 제목(meta)
//   hwp,                         // content.hwp  { mode:'docs'|'hwp', preset, head, foot, vars }
//   page,                        // content.page (쪽 설정, 아래 normPage 참고)
//   preset,                      // 한글 모드 양식 정보 { key, standard, metrics }. 호출하는 쪽이 hwpDoc.js 로 채운다(JSON 을 직접 읽지 않으려고)
//   assets,                      // { [src]: { mime, data:Uint8Array, w, h } }  호출하는 쪽이 미리 받아 둔 그림 바이트
//   vars,                        // 자료값(없으면 hwp.vars)
//   chipText,                    // (attrs, vars) => 글. 자료값 칸을 현재 값으로 바꾼다(hwpVars.chipText). 없으면 칸을 '○○○' 로 둔다
//   fillTokens,                  // (s, vars) => s  두문·결문 {이름} 채우기(hwpVars.fillTokens)
// }
//
// 규칙 요약
// - 목록: 글머리/번호 목록은 list.marker 로 글자를 적은 문단이 된다(자동 번호를 쓰지 않는다). 작업 목록은 list.kind='check' + 첫 Run 이 check.
//   marker 글자는 runs 에 넣지 않는다. 작성기가 marker + 간격을 앞에 쓰고, 내어쓰기(indent.firstLinePt<0)로 정렬한다.
// - 표: 병합은 colspan/rowspan, 가려진 칸은 넣지 않는다. 열 폭은 colwidth(px)를 pt 로 바꾼 colPt, 모르는 열은 남은 폭을 나눈다.
// - 자료값(hwpVar)은 현재 값 글로, 댓글 표시는 버리고, 비밀값 칩은 "[비밀값: 이름]"(기울임, 회색)으로 낸다(기존 내보내기와 같음).
// - 구분선(hr): 한글 모드는 쪽 나눔(기존 hwpExport 와 같음), 일반 모드는 아래 선만 있는 1칸 표.
import { PAGE_SIZES_MM, U, normalizeIR, pageDims } from './schema.js'

export const PX = 0.75 // 1px = 0.75pt

// ── 쪽 설정(content.page) ───────────────────────────────────
// {
//   size: 'A4'|'B5'|'Letter'|'A3', orientation: 'portrait'|'landscape',
//   marginMm: { top, right, bottom, left }, headerMm, footerMm,
//   pageNumbers: { on:boolean, pos:'left'|'center'|'right' },
//   header: { text, align, image: { src, wPt, align } | null },
//   footer: { text, align, image: { src, wPt, align } | null },
// }
export const DEFAULT_DOC_PAGE = {
  size: 'A4',
  orientation: 'portrait',
  marginMm: { top: 20, right: 23, bottom: 25, left: 23 },
  headerMm: 10,
  footerMm: 10,
  pageNumbers: { on: false, pos: 'center' },
  header: { text: '', align: 'left', image: null },
  footer: { text: '', align: 'center', image: null },
}

export function normPage(p, presetPage) {
  const base = presetPage
    ? {
        ...DEFAULT_DOC_PAGE,
        marginMm: { top: presetPage.top, right: presetPage.right, bottom: presetPage.bottom, left: presetPage.left },
        headerMm: presetPage.header || 10,
        footerMm: presetPage.footer || 10,
      }
    : DEFAULT_DOC_PAGE
  const o = p && typeof p === 'object' ? p : {}
  const size = typeof o.size === 'object' || PAGE_SIZES_MM[o.size] ? o.size : base.size
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d)
  return {
    size,
    orientation: o.orientation === 'landscape' ? 'landscape' : 'portrait',
    marginMm: {
      top: num(o.marginMm?.top, base.marginMm.top),
      right: num(o.marginMm?.right, base.marginMm.right),
      bottom: num(o.marginMm?.bottom, base.marginMm.bottom),
      left: num(o.marginMm?.left, base.marginMm.left),
    },
    headerMm: num(o.headerMm, base.headerMm),
    footerMm: num(o.footerMm, base.footerMm),
    pageNumbers: { on: !!o.pageNumbers?.on, pos: ['left', 'center', 'right'].includes(o.pageNumbers?.pos) ? o.pageNumbers.pos : 'center' },
    header: { text: o.header?.text || '', align: o.header?.align || 'left', image: o.header?.image?.src ? o.header.image : null },
    footer: { text: o.footer?.text || '', align: o.footer?.align || 'center', image: o.footer?.image?.src ? o.footer.image : null },
  }
}

// ── 글자 모양 ───────────────────────────────────────────────
const hex = (c) => {
  if (!c || typeof c !== 'string') return null
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c.slice(1).split('').map((x) => x + x).join('')}`.toUpperCase()
  const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase() : null
}
const toPt = (v) => {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return null
  if (/px$/.test(String(v))) return Math.round(n * PX * 100) / 100
  return n // pt 또는 단위 없음(pt)
}
const fontName = (css) => {
  const first = String(css || '').split(',')[0].replace(/['"]/g, '').trim()
  return first || null
}
export const MAIN_FONT_DEFAULT = '맑은 고딕'
export const DOC_BODY_PT = 11
export const DOC_BODY_LH = 170
export const CELL_PT = 10.5
export const DOC_HEAD_PT = { 1: 22.5, 2: 16.5, 3: 12.75, 4: 11.25 }

/** 글자(text 노드)의 마크를 Run 속성으로 */
function markStyle(marks = [], base = {}) {
  const r = { ...base }
  for (const m of marks) {
    const a = m.attrs || {}
    switch (m.type) {
      case 'bold': r.bold = true; break
      case 'italic': r.italic = true; break
      case 'underline': r.underline = 'single'; break
      case 'strike': r.strike = true; break
      case 'superscript': r.sup = true; break
      case 'subscript': r.sub = true; break
      case 'code': r.font = { ko: 'Courier New', latin: 'Courier New' }; break
      case 'link': if (a.href) r.link = a.href; break
      case 'highlight': r.highlight = hex(a.color) || '#FFEA00'; break
      case 'textStyle': {
        const c = hex(a.color)
        if (c) r.color = c
        const pt = toPt(a.fontSize)
        if (pt) r.sizePt = pt
        const f = fontName(a.fontFamily)
        if (f) r.font = { ko: f, latin: f }
        if (a.ratio && Number(a.ratio) !== 100) r.scalePct = Number(a.ratio)
        if (a.spacing) r.spacingPct = Number(a.spacing)
        break
      }
      default: break // comment 등은 버린다
    }
  }
  return r
}

const sameStyle = (a, b) => {
  const ka = Object.keys(a).filter((k) => k !== 'text')
  const kb = Object.keys(b).filter((k) => k !== 'text')
  if (ka.length !== kb.length) return false
  return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

function pushRun(runs, run) {
  const last = runs[runs.length - 1]
  if (run.text != null && last && last.text != null && !last.br && !last.tab && sameStyle(last, run)) last.text += run.text
  else runs.push(run)
}

// ── 변환기 ──────────────────────────────────────────────────
export function tiptapToIR(json, ctx = {}) {
  const issues = []
  const warn = (msg, path) => issues.push({ level: 'warn', msg, path })
  const hwp = ctx.hwp || {}
  const vars = ctx.vars || hwp.vars || {}
  const hwpOn = hwp.mode === 'hwp' && ctx.preset?.metrics
  const preset = hwpOn ? ctx.preset : null
  const M = preset?.metrics
  const standard = !!preset?.standard
  const page = normPage(ctx.page, hwpOn ? M.page : null)
  const assetsIn = ctx.assets || {}
  const assets = {}
  const assetIds = new Map()
  const chipText = ctx.chipText || (() => '○○○')
  const fillTokens = ctx.fillTokens || ((s) => String(s || ''))

  const irPageBase = { size: page.size, orientation: page.orientation, marginMm: page.marginMm, headerMm: page.headerMm, footerMm: page.footerMm }
  const dims = pageDims(irPageBase)
  const bodyWPt = U.mmToPt(dims.bodyWMm)

  const defaults = hwpOn
    ? {
        font: { ko: M.body.font, latin: M.body.font },
        sizePt: M.body.pt,
        lineSpacing: { mode: 'percent', value: M.body.lineSpacing || 160 },
        color: '#000000',
        align: 'justify',
      }
    : { font: { ko: MAIN_FONT_DEFAULT, latin: MAIN_FONT_DEFAULT }, sizePt: 11, lineSpacing: { mode: 'percent', value: 170 }, color: '#000000', align: 'left' }

  function assetId(src, path) {
    if (!src) return null
    if (assetIds.has(src)) return assetIds.get(src)
    const a = assetsIn[src]
    if (!a || !a.data) {
      warn(`그림을 불러오지 못해 뺐습니다: ${String(src).slice(0, 60)}`, path)
      assetIds.set(src, null)
      return null
    }
    const id = `img${assetIds.size + 1}`
    assets[id] = { mime: a.mime, data: a.data, w: a.w, h: a.h }
    assetIds.set(src, id)
    return id
  }

  // ── 글 조각 ──
  function inline(nodes = [], base = {}, path = '') {
    const runs = []
    for (const n of nodes) {
      if (n.type === 'text') {
        const st = markStyle(n.marks, base)
        const parts = String(n.text ?? '').split('\t')
        parts.forEach((part, i) => {
          if (i > 0) pushRun(runs, { tab: true })
          if (part) pushRun(runs, { ...st, text: part })
        })
      } else if (n.type === 'hardBreak') pushRun(runs, { br: true })
      else if (n.type === 'hwpVar') {
        const t = chipText(n.attrs || {}, vars)
        if (t) pushRun(runs, { ...markStyle(n.marks, base), text: t })
      } else if (n.type === 'secret') {
        pushRun(runs, { ...base, text: `[비밀값: ${n.attrs?.label || ''}]`, italic: true, color: '#5F6368' })
      } else if (n.type === 'checkbox') pushRun(runs, { ...base, check: { checked: !!n.attrs?.checked } })
      else if (n.type === 'image') {
        const id = assetId(n.attrs?.src, path)
        if (id) {
          const sz = imageSize(n, id)
          pushRun(runs, { image: { id, wPt: sz.wPt, hPt: sz.hPt, alt: n.attrs?.alt || undefined } })
        }
      }
    }
    return runs
  }

  function imageSize(n, id) {
    const a = assets[id]
    const nat = a?.w && a?.h ? { w: a.w, h: a.h } : { w: 300, h: 200 }
    let wPx = Number(n.attrs?.width) || null
    let hPx = Number(n.attrs?.height) || null
    if (!wPx && !hPx) { wPx = nat.w; hPx = nat.h }
    else if (wPx && !hPx) hPx = (wPx * nat.h) / nat.w
    else if (!wPx && hPx) wPx = (hPx * nat.w) / nat.h
    let wPt = wPx * PX
    let hPt = hPx * PX
    const maxW = bodyWPt
    if (wPt > maxW) { hPt = (hPt * maxW) / wPt; wPt = maxW }
    return { wPt: Math.round(wPt * 10) / 10, hPt: Math.round(hPt * 10) / 10 }
  }

  // ── 문단 속성 ──
  function paraProps(node, extra = {}) {
    const p = {}
    const a = node.attrs || {}
    if (['left', 'center', 'right', 'justify'].includes(a.textAlign)) p.align = a.textAlign
    if (a.lineHeight) p.lineSpacing = { mode: 'percent', value: Number(a.lineHeight) }
    const ind = {}
    if (Number(a.indentLeft)) ind.leftPt = Number(a.indentLeft)
    if (Number(a.indentFirst)) ind.firstLinePt = Number(a.indentFirst)
    if (Number(a.indentRight)) ind.rightPt = Number(a.indentRight)
    if (Object.keys(ind).length) p.indent = { leftPt: 0, rightPt: 0, firstLinePt: 0, ...ind }
    if (Number(a.spaceBefore)) p.spaceBeforePt = Number(a.spaceBefore)
    if (Number(a.spaceAfter)) p.spaceAfterPt = Number(a.spaceAfter)
    if (a.keepNext) p.keepNext = true
    return { ...p, ...extra }
  }
  const mergeIndent = (p, leftPt, firstLinePt) => {
    p.indent = { leftPt: (p.indent?.leftPt || 0) + leftPt, rightPt: p.indent?.rightPt || 0, firstLinePt: firstLinePt ?? p.indent?.firstLinePt ?? 0 }
  }

  // ── 제목 ──
  const DOC_HEAD = { 1: { sizePt: 22.5, before: 0, after: 10.5 }, 2: { sizePt: 16.5, before: 30, after: 7.5 }, 3: { sizePt: 12.75, before: 19.5, after: 4.5 }, 4: { sizePt: 11.25, before: 13.5, after: 3 } }

  function levelBase(l) {
    if (!l) return {}
    const b = { font: { ko: l.font, latin: l.font }, sizePt: l.pt }
    if (l.bold) b.bold = true
    return b
  }

  // ── 본문 블록 ──
  function blocksOf(nodes = [], cx = {}) {
    const out = []
    // 한글 모드 항목 부호 상태(hwpDoc.walkMarks 와 같은 규칙)
    const st = cx.top && hwpOn ? { counters: Array(10).fill(0), base: 0, h2n: 0 } : null
    nodes.forEach((n, i) => {
      const path = `${cx.path || 'body'}[${i}]`
      out.push(...blockOf(n, { ...cx, st, path, first: out.length === 0 }))
    })
    return out
  }

  const bump = (st, lv) => {
    st.counters[lv] += 1
    for (let i = lv + 1; i < st.counters.length; i += 1) st.counters[i] = 0
    return markFor(M.levels[lv - 1]?.marker, st.counters[lv])
  }

  function blockOf(n, cx) {
    const t = n.type
    const st = cx.st
    switch (t) {
      case 'paragraph': {
        const runs = inline(n.content, cx.base || {}, cx.path)
        if (st && standard && runs.some((r) => r.text?.trim()) && !/^※/.test(textOfRuns(runs).trim())) { st.counters.fill(0); st.base = 0 }
        // 한글 기안문에서 손으로 쓴 '끝.' 은 아래에서 따로 붙이므로 뺀다
        if (cx.top && hwpOn && preset.key === '기안문' && textOfRuns(runs).replace(/\s/g, '') === '끝.') return []
        const p = { t: 'p', runs, ...paraProps(n) }
        if (cx.top && !cx.first && !p.spaceBeforePt && !hwpOn) p.spaceBeforePt = 4.5
        if (cx.cell && cx.cellFont) {
          // 표 칸 글자 모양은 칸 기본값으로 이미 runs 에 반영
        }
        return [p]
      }
      case 'heading': {
        const lv = Math.min(6, n.attrs?.level || 1)
        if (hwpOn) return hwpHeading(n, lv, cx)
        const h = DOC_HEAD[lv] || DOC_HEAD[4]
        const runs = inline(n.content, { bold: true, sizePt: h.sizePt, ...(cx.base || {}) }, cx.path)
        if (!runs.length) return []
        return [{ t: 'p', runs, heading: lv, keepNext: true, spaceBeforePt: cx.first ? 0 : h.before, spaceAfterPt: h.after, ...paraProps(n) }]
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return listBlocks(n, 0, cx)
      case 'blockquote': {
        const inner = blocksOf(n.content, { ...cx, top: false, st: null })
        return inner.map((b) => {
          if (b.t !== 'p') return b
          const p = { ...b, bg: hwpOn ? '#DFE6F7' : undefined }
          mergeIndent(p, 18, p.indent?.firstLinePt ?? 0)
          if (!hwpOn) p.runs = p.runs.map((r) => (r.text != null && !r.color ? { ...r, color: '#555555' } : r))
          return p
        })
      }
      case 'codeBlock': {
        const text = (n.content || []).map((c) => c.text || '').join('')
        return text.split('\n').map((line) => ({ t: 'p', runs: line ? [{ text: line, font: { ko: 'Courier New', latin: 'Courier New' }, sizePt: 10 }] : [], bg: '#F3F3F3', lineSpacing: { mode: 'percent', value: 130 } }))
      }
      case 'horizontalRule':
        if (hwpOn) return [{ t: 'pagebreak' }] // 한글 모드에서는 쪽 나눔(기존 hwpExport 와 같음)
        return [ruleTable(cx)]
      case 'pageBreak':
        return [{ t: 'pagebreak' }]
      case 'image':
        return imageBlock(n, cx)
      case 'table':
        return [tableBlock(n, cx)]
      default: {
        // 알 수 없는 노드: 안쪽 글이라도 남긴다
        if (n.content) return blocksOf(n.content, { ...cx, top: false, st: null })
        return []
      }
    }
  }

  const textOfRuns = (runs) => runs.map((r) => (r.text ?? '') + (r.check ? (r.check.checked ? '☑' : '☐') : '')).join('')

  function ruleTable(cx) {
    const w = cx.cellW || bodyWPt
    const none = { style: 'none', widthPt: 0, color: '#000000' }
    return {
      t: 'table',
      widthPt: w,
      colPt: [w],
      rows: [{ heightPt: 2, heightRule: 'exact', cells: [{ blocks: [{ t: 'p', runs: [], lineSpacing: { mode: 'exactPt', value: 2 } }], padPt: { t: 0, r: 0, b: 0, l: 0 }, border: { top: none, left: none, right: none, bottom: { style: 'solid', widthPt: 0.75, color: '#C4C7C5' } } }] }],
      border: none,
      x: { rule: true },
    }
  }

  function hwpHeading(n, lv, cx) {
    const st = cx.st
    const text = (n.content || []).map((c) => c.text || '').join('')
    if (!text.trim() && !(n.content || []).length) return []
    const align = n.attrs?.textAlign
    const mk = (l, mark, extra = {}) => {
      const hang = Math.abs(l?.intent || 0) * (l?.pt || 12)
      const p = {
        t: 'p',
        runs: inline(n.content, levelBase(l), cx.path),
        heading: Math.min(lv, 4),
        lineSpacing: { mode: 'percent', value: l?.lineSpacing || 160 },
        ...paraProps(n),
        ...extra,
      }
      if (mark) {
        p.list = { kind: 'ordered', level: 0, marker: mark, x: { markerFont: l?.markerFont || l?.font, markerPt: l?.markerPt || l?.pt, markerBold: !!l?.markerBold } }
        p.indent = { leftPt: ((l?.left || 0) * (l?.pt || 12)) + hang, rightPt: 0, firstLinePt: -hang }
      }
      if (l?.prev) p.spaceBeforePt = l.prev * l.pt
      if (l?.next) p.spaceAfterPt = l.next * l.pt
      if (align == null && l?.align) p.align = { JUSTIFY: 'justify', CENTER: 'center', RIGHT: 'right', LEFT: 'left' }[l.align] || 'left'
      return p
    }
    if (lv === 1) {
      if (st) { st.counters.fill(0); st.base = 0 }
      const p = mk(M.h1)
      p.heading = 1
      return [p]
    }
    if (lv === 2) {
      if (standard && st) { const mark = bump(st, 1); st.base = 1; return [mk(M.levels[0], mark)] }
      if (st) { st.h2n += 1; st.counters.fill(0); st.base = 0 }
      return [mk(M.h2, st ? romanOf(st.h2n) : '', { heading: 2 })]
    }
    if (lv === 3) {
      if (standard && st) { const l = st.base >= 1 ? 2 : 1; const mark = bump(st, l); st.base = l; return [mk(M.levels[l - 1], mark)] }
      if (st) st.base = 1
      return [mk(M.levels[0], M.levels[0]?.marker || '□')]
    }
    const p = mk(null)
    p.runs = inline(n.content, { bold: true }, cx.path)
    return [p]
  }

  // ── 목록 ──
  const BULLETS = ['•', '◦', '▪']
  const orderedMarker = (n, level) => {
    if (level % 3 === 0) return `${n}.`
    if (level % 3 === 1) return `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`
    return `${romanLower(n)}.`
  }

  function listBlocks(list, depth, cx) {
    const out = []
    const st = cx.st
    const level = cx.listLevel != null ? cx.listLevel + 1 : 0
    const startNum = Number(list.attrs?.start) || 1
    ;(list.content || []).forEach((item, idx) => {
      const [first, ...rest] = item.content || []
      const isTask = list.type === 'taskList'
      let marker
      let hwpLevel = null
      let hwpInfo = null
      if (hwpOn && st) {
        hwpLevel = Math.min(8, st.base + level + 1)
        hwpInfo = M.levels[hwpLevel - 1]
        marker = standard ? bump(st, hwpLevel) : hwpInfo?.marker || ''
      } else if (list.type === 'bulletList') marker = BULLETS[level % 3]
      else if (list.type === 'orderedList') marker = orderedMarker(startNum + idx, level)
      let para
      if (first && first.type === 'paragraph') {
        const base = hwpInfo ? levelBase(hwpInfo) : cx.base || {}
        let runs = inline(first.content, base, cx.path)
        if (isTask) runs = [{ ...base, check: { checked: !!item.attrs?.checked } }, { ...base, text: ' ' }, ...runs]
        para = { t: 'p', runs, ...paraProps(first) }
        if (isTask) para.list = { kind: 'check', level }
        else para.list = { kind: list.type === 'bulletList' ? 'bullet' : 'ordered', level, marker }
        if (hwpInfo) {
          const hang = Math.abs(hwpInfo.intent || 0) * hwpInfo.pt
          para.indent = { leftPt: (hwpInfo.left || 0) * hwpInfo.pt + hang, rightPt: 0, firstLinePt: -hang }
          para.lineSpacing = { mode: 'percent', value: hwpInfo.lineSpacing || 160 }
          if (hwpInfo.prev) para.spaceBeforePt = hwpInfo.prev * hwpInfo.pt
          para.align = para.align || 'justify'
          para.list.x = { markerFont: hwpInfo.markerFont || hwpInfo.font, markerPt: hwpInfo.markerPt || hwpInfo.pt, markerBold: !!hwpInfo.markerBold }
        } else {
          const hang = isTask ? 0 : 14
          para.indent = { leftPt: 18 * (level + 1) + (para.indent?.leftPt || 0), rightPt: 0, firstLinePt: -hang }
          if (isTask) para.indent.firstLinePt = 0
        }
        out.push(para)
      } else if (isTask) {
        out.push({ t: 'p', runs: [{ check: { checked: !!item.attrs?.checked } }], list: { kind: 'check', level }, indent: { leftPt: 18 * (level + 1), rightPt: 0, firstLinePt: 0 } })
      }
      for (const c of rest) {
        if (/List$/.test(c.type)) out.push(...listBlocks(c, depth + 1, { ...cx, listLevel: level }))
        else out.push(...blockOf(c, { ...cx, st: null, top: false }).map((b) => (b.t === 'p' ? { ...b, indent: { leftPt: 18 * (level + 1) + (b.indent?.leftPt || 0), rightPt: 0, firstLinePt: b.indent?.firstLinePt || 0 } } : b)))
      }
    })
    return out
  }

  // ── 그림 ──
  function imageBlock(n, cx) {
    const id = assetId(n.attrs?.src, cx.path)
    if (!id) return []
    const sz = imageSize(n, id)
    const align = ['left', 'center', 'right'].includes(n.attrs?.align) ? n.attrs.align : 'left'
    const wrap = n.attrs?.wrap || 'block'
    if (wrap === 'inline') {
      // 글자처럼 취급: 문단 안의 그림
      return [{ t: 'p', runs: [{ image: { id, wPt: sz.wPt, hPt: sz.hPt, alt: n.attrs?.alt || undefined } }], align, lineSpacing: { mode: 'percent', value: 100 } }]
    }
    const fig = { t: 'figure', id, wPt: sz.wPt, hPt: sz.hPt, align, alt: n.attrs?.alt || undefined }
    if (wrap === 'right' || wrap === 'left') fig.float = { x: wrap, y: 'top', wrap: 'square' }
    return [fig]
  }

  // ── 표 ──
  const BORDER_STYLE = { solid: 'solid', dashed: 'dashed', dotted: 'dotted', double: 'double', none: 'none', 'thick-thin': 'thick-thin' }
  const toBorder = (b) => {
    if (!b) return undefined
    const style = BORDER_STYLE[b.style] || 'solid'
    return { style, widthPt: style === 'none' ? 0 : Number(b.width ?? b.widthPt ?? 0.5), color: hex(b.color) || '#000000' }
  }

  function tableBlock(n, cx) {
    const rowsIn = n.content || []
    // 칸 위치(열 번호) 계산
    const occ = []
    const placed = rowsIn.map((r, ri) => {
      occ[ri] = occ[ri] || []
      let c = 0
      const cells = []
      for (const cell of r.content || []) {
        while (occ[ri][c]) c += 1
        const cs = Math.max(1, Number(cell.attrs?.colspan) || 1)
        const rs = Math.max(1, Number(cell.attrs?.rowspan) || 1)
        for (let rr = ri; rr < ri + rs; rr += 1) {
          occ[rr] = occ[rr] || []
          for (let cc = c; cc < c + cs; cc += 1) occ[rr][cc] = true
        }
        cells.push({ cell, c, cs, rs })
        c += cs
      }
      return { row: r, cells }
    })
    const nCols = Math.max(1, ...occ.map((o) => o.length))
    const nRows = rowsIn.length
    // rowspan 이 표 아래로 나가면 줄인다
    placed.forEach((pr, ri) => pr.cells.forEach((pc) => { if (ri + pc.rs > nRows) pc.rs = nRows - ri }))

    // 열 폭(px): colwidth 가 있는 칸에서 모은다
    const colPx = Array(nCols).fill(null)
    placed.forEach((pr) => pr.cells.forEach((pc) => {
      const cw = pc.cell.attrs?.colwidth
      if (Array.isArray(cw) && cw.length === pc.cs) cw.forEach((w, k) => { if (w > 0 && colPx[pc.c + k] == null) colPx[pc.c + k] = w })
    }))
    const avail = cx.cellW || bodyWPt
    let colPt
    const known = colPx.filter((x) => x != null)
    const tw = Number(n.attrs?.width) > 0 ? Number(n.attrs.width) * PX : null
    if (known.length === nCols) colPt = colPx.map((x) => x * PX)
    else {
      const knownSum = known.reduce((a, b) => a + b * PX, 0)
      const target = tw || Math.max(avail, knownSum + 20 * (nCols - known.length))
      const rest = Math.max(10 * (nCols - known.length), target - knownSum)
      const each = rest / Math.max(1, nCols - known.length)
      colPt = colPx.map((x) => (x != null ? x * PX : each))
    }
    let widthPt = colPt.reduce((a, b) => a + b, 0)
    if (widthPt > avail + 0.5) {
      const k = avail / widthPt
      colPt = colPt.map((x) => x * k)
      widthPt = avail
      if (!cx.cellW) warn('표 폭이 본문보다 커서 본문 폭에 맞게 줄였습니다', cx.path)
    }
    colPt = colPt.map((x) => Math.round(x * 100) / 100)
    widthPt = Math.round(colPt.reduce((a, b) => a + b, 0) * 100) / 100

    const tb = toBorder(n.attrs?.borderStyle) || { style: 'solid', widthPt: 0.75, color: '#8A8A8A' }
    const pad = n.attrs?.padding != null ? padOf(n.attrs.padding) : { t: 4.5, r: 6.75, b: 4.5, l: 6.75 }
    const rows = placed.map((pr, ri) => {
      const r = pr.row
      const row = { cells: [] }
      const h = Number(r.attrs?.height)
      if (h > 0) { row.heightPt = Math.round(h * PX * 100) / 100; row.heightRule = 'atLeast' }
      if (ri === 0 && pr.cells.length && pr.cells.every((x) => x.cell.type === 'tableHeader') && r.attrs?.header !== false) row.header = true
      if (r.attrs?.header === true) row.header = true
      row.cantSplit = true
      for (const pc of pr.cells) {
        const a = pc.cell.attrs || {}
        const isTh = pc.cell.type === 'tableHeader'
        const cellW = colPt.slice(pc.c, pc.c + pc.cs).reduce((s, x) => s + x, 0) - pad.l - pad.r
        const cellBase = hwpOn ? levelBase(isTh ? M.th : M.td) : { sizePt: 10.5, ...(isTh ? { bold: true } : {}) }
        const blocks = blocksOf(pc.cell.content, { path: `${cx.path}.r${ri}c${pc.c}`, base: cellBase, cell: true, cellW: Math.max(20, cellW), top: false })
        const cell = { colspan: pc.cs, rowspan: pc.rs, blocks }
        const bg = hex(a.background) || (isTh ? (hwpOn ? '#DFE6F7' : '#F3F3F3') : undefined)
        if (bg) cell.bg = bg
        if (['top', 'middle', 'bottom'].includes(a.verticalAlign)) cell.vAlign = a.verticalAlign
        else cell.vAlign = hwpOn ? 'middle' : 'top'
        if (a.padding != null) cell.padPt = padOf(a.padding)
        if (a.borders) {
          const b = {}
          for (const k of ['top', 'right', 'bottom', 'left']) if (a.borders[k]) b[k] = toBorder(a.borders[k])
          if (Object.keys(b).length) cell.border = b
        }
        // 칸 안 문단 기본 가운데 정렬(한글 모드 표)은 편집기 CSS 와 같게
        if (hwpOn) for (const b of cell.blocks) if (b.t === 'p' && !b.align) b.align = 'center'
        row.cells.push(cell)
      }
      return row
    })

    const grid = { t: 'table', widthPt, colPt, rows, border: tb, padPt: pad }
    if (['left', 'center', 'right'].includes(n.attrs?.align)) grid.align = n.attrs.align
    // 표를 만든 뒤 칸이 모자라면(편집기 밖에서 만든 JSON) 빈 칸으로 채운다
    padGrid(grid)
    return grid
  }

  function padOf(p) {
    if (typeof p === 'number') return { t: p * PX, r: p * PX, b: p * PX, l: p * PX }
    return { t: (p.top ?? p.t ?? 4) * PX, r: (p.right ?? p.r ?? 6) * PX, b: (p.bottom ?? p.b ?? 4) * PX, l: (p.left ?? p.l ?? 6) * PX }
  }

  function padGrid(table) {
    const nC = table.colPt.length
    const occ = table.rows.map(() => Array(nC).fill(false))
    table.rows.forEach((r, ri) => {
      let c = 0
      r.cells.forEach((cell) => {
        while (c < nC && occ[ri][c]) c += 1
        const cs = cell.colspan || 1
        const rs = cell.rowspan || 1
        for (let rr = ri; rr < Math.min(table.rows.length, ri + rs); rr += 1) for (let cc = c; cc < Math.min(nC, c + cs); cc += 1) occ[rr][cc] = true
        c += cs
      })
      while (c < nC) {
        if (!occ[ri][c]) {
          r.cells.push({ colspan: 1, rowspan: 1, blocks: [{ t: 'p', runs: [] }] })
          occ[ri][c] = true
          warn('표에 비어 있는 칸이 있어 채웠습니다', '')
        }
        c += 1
      }
    })
  }

  // ── 머리말·꼬리말 ──
  function headFootBlocks(spec, isFooter) {
    const out = []
    const align = ['left', 'center', 'right'].includes(spec.align) ? spec.align : 'left'
    if (spec.image?.src) {
      const id = assetId(spec.image.src, isFooter ? 'footer' : 'header')
      if (id) {
        const a = assets[id]
        const wPt = spec.image.wPt || Math.min(120, (a.w || 200) * PX)
        const hPt = spec.image.hPt || (a.w && a.h ? (wPt * a.h) / a.w : wPt / 3)
        out.push({ t: 'p', runs: [{ image: { id, wPt: Math.round(wPt * 10) / 10, hPt: Math.round(hPt * 10) / 10 } }], align: spec.image.align || align, lineSpacing: { mode: 'percent', value: 100 } })
      }
    }
    if (spec.text) out.push({ t: 'p', runs: [{ text: spec.text, sizePt: 9 }], align, lineSpacing: { mode: 'percent', value: 120 } })
    return out
  }

  // ── 조립 ──
  const doc = json && json.type === 'doc' ? json : { type: 'doc', content: [] }
  let body = blocksOf(doc.content || [], { top: true, path: 'body' })

  if (hwpOn && preset.key === '기안문') body = [...gianHead(), ...body, ...gianFoot()]

  function gianHead() {
    const h = hwp.head || {}
    const f = (k) => fillTokens(h[k], vars)
    const b = M.body
    const spaced = (s) => [...String(s || '')].join(' ')
    const out = []
    out.push({ t: 'p', align: 'center', runs: [{ text: f('org') || '○○○', font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' }, bold: true, sizePt: Math.round(b.pt * 1.75 * 10) / 10, spacingPct: 60 }], spaceAfterPt: 12 })
    out.push({ t: 'p', runs: [{ text: `${spaced('수신')}  ${f('to')}` }] })
    out.push({ t: 'p', runs: [{ text: `(경유)  ${f('via')}` }] })
    out.push({ t: 'p', runs: [{ text: `${spaced('제목')}  ${f('title')}`, bold: true }], spaceAfterPt: 6 })
    return out
  }
  function gianFoot() {
    const fo = Object.fromEntries(Object.entries(hwp.foot || {}).map(([k, x]) => [k, fillTokens(x, vars)]))
    const b = M.body
    const out = [{ t: 'p', runs: [{ text: '끝.' }], indent: { leftPt: b.pt * 1.4, rightPt: 0, firstLinePt: 0 }, spaceAfterPt: 10 }]
    out.push({ t: 'p', align: 'center', runs: [{ text: fo.sender || '○○○', font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' }, bold: true, sizePt: Math.round(b.pt * 1.6 * 10) / 10 }], spaceBeforePt: 6, spaceAfterPt: 10 })
    const sign = [fo.drafter, fo.reviewer, fo.approver].filter(Boolean).join('    ')
    if (sign) out.push({ t: 'p', runs: [{ text: sign, sizePt: b.pt * 0.9 }] })
    if (fo.cooperator) out.push({ t: 'p', runs: [{ text: `협조자 ${fo.cooperator}`, sizePt: b.pt * 0.9 }] })
    const l3 = [fo.docNum && `시행 ${fo.docNum}`, fo.receive && `접수 ${fo.receive}`].filter(Boolean).join('    ')
    if (l3) out.push({ t: 'p', runs: [{ text: l3, sizePt: b.pt * 0.9 }] })
    const l4 = [(fo.zip || fo.address) && `우 ${fo.zip || ''} ${fo.address || ''}`.trim(), fo.site && `/ ${fo.site}`].filter(Boolean).join('  ')
    if (l4) out.push({ t: 'p', runs: [{ text: l4, sizePt: b.pt * 0.9 }] })
    const l5 = [fo.phone && `전화 ${fo.phone}`, fo.fax && `/전송 ${fo.fax}`, fo.email && `/ ${fo.email}`, fo.disclosure && `/ ${fo.disclosure}`].filter(Boolean).join(' ')
    if (l5) out.push({ t: 'p', runs: [{ text: l5, sizePt: b.pt * 0.9 }] })
    return out
  }

  // 쪽 번호는 꼬리말에 field 로
  let footer = headFootBlocks(page.footer, true)
  if (page.pageNumbers.on) {
    footer = [...footer, { t: 'p', runs: [{ field: 'page', sizePt: 9 }], align: page.pageNumbers.pos, lineSpacing: { mode: 'percent', value: 120 } }]
  }
  const header = headFootBlocks(page.header, false)

  const irIn = {
    version: 1,
    meta: { title: ctx.title || '' },
    page: { ...irPageBase },
    defaults,
    header: header.length ? header : undefined,
    footer: footer.length ? footer : undefined,
    body: body.length ? body : [{ t: 'p', runs: [] }],
    assets,
  }
  const norm = normalizeIR(irIn)
  for (const i of norm.issues) {
    if (/표 폭\(.*본문 폭/.test(i.msg)) continue // 위에서 줄였음
    issues.push({ level: 'warn', msg: i.msg, path: i.path })
  }
  return { ir: norm.ir, issues }
}

// ── 항목 부호(hwpDoc.js 의 markFor 와 같은 규칙) ──
const GA = '가나다라마바사아자차카타파하'
const hangulSeq = (n) => {
  const i = n - 1
  const base = GA[i % 14]
  const round = Math.floor(i / 14)
  if (!round) return base
  const code = base.charCodeAt(0) - 0xac00
  const cho = Math.floor(code / 588)
  const vowels = [0, 4, 8, 13, 18, 20]
  return String.fromCharCode(0xac00 + cho * 588 + vowels[round % vowels.length] * 28)
}
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ']
const romanOf = (n) => ROMAN[n - 1] || String(n)
function romanLower(n) {
  const t = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let s = ''
  let v = n
  for (const [k, r] of t) while (v >= k) { s += r; v -= k }
  return s || 'i'
}
export function markFor(sample, n) {
  if (!sample) return ''
  if (/^\d/.test(sample) || /^\(\d/.test(sample)) return sample.replace(/\d+/, String(n))
  if (/가/.test(sample)) return sample.replace('가', hangulSeq(n))
  if (sample === '①') return n <= 20 ? String.fromCodePoint(0x245f + n) : `(${n})`
  if (sample === '㉮') return n <= 14 ? String.fromCodePoint(0x326d + n) : hangulSeq(n)
  return sample
}

/** 문서와 쪽 설정에 들어 있는 그림 주소 목록(내보내는 쪽이 미리 받아 assets 로 넘긴다) */
export function collectImageSrcs(json, page) {
  const out = new Set()
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'image' && n.attrs?.src) out.add(n.attrs.src)
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(json)
  if (page?.header?.image?.src) out.add(page.header.image.src)
  if (page?.footer?.image?.src) out.add(page.footer.image.src)
  return [...out]
}
