// 구글 슬라이드 클립보드 형식(application/x-vnd.google-docs-drawings-object+wrapped) 읽기·쓰기.
// 2026-10 실제 슬라이드에서 복사한 내용을 붙잡아 확인한 모양(조사 기록은 interop/README.md).
//
// 겉 포장: JSON { data: "<JSON 문자열>" } (슬라이드는 dih, edi, edrk, dct 등도 싣지만 붙여 넣을 때 없어도 된다)
// data: { resolved: [명령...], unresolved: [명령...], autotext_content: {} }
// 명령
//   [3, id, 모양 종류, [a, b, c, d, tx, ty], [속성 키, 값, ...], 쪽 id]   도형 만들기
//   [15, id, null, 위치, "글자"]                                           글자 넣기(문단 구분 \n, 줄 바꿈 \u000b)
//   [17, id, null, 시작, 끝, [], [속성 키, 값, ...]]                       글자·문단 서식(문단 서식은 문단 끝 \n 자리 한 칸)
//   [41, id, null, 목록 id, [단계, [속성...], [], ...]]                    목록 정의
// 단위: 1 = 25 EMU = 1/508 pt. 슬라이드(16:9) 폭 365760, 높이 205740. DAH 1px(1920 폭) = 190.5
// 도형 기본 크기 120000 x 120000(3,000,000 EMU)에 변환 행렬을 곱한다. 그림은 속성 8·9(원래 크기)에 곱한다.
// 모양 종류: 108 글 상자, 6 직사각형, 7 둥근 직사각형, 8 타원, 98 삼각형, 72 오른쪽 화살표, 153 선, 3 그림
// 도형 속성: 0 조절값(둥근 모서리 반지름, min(w,h) 대비 1/100000), 14 채우기 종류(0 없음, 1 단색), 15 채우기 색, 16 채우기 불투명도(0~1),
//   18 테두리 종류(0 없음, 1 실선), 19 테두리 색, 22 테두리 두께, 29 선 끝 화살표(5 속이 찬 화살표), 44 세로 정렬(0 위, 1 가운데, 2 아래),
//   39 그림 주소, 8·9 그림 원래 크기(px)
// 글자 속성: 0 굵게, 1 기울임, 2 밑줄, 20 취소선, 4 색, 5 글꼴, 6 크기(pt), 8 링크 주소
// 문단 속성: 12 정렬(1 왼쪽, 2 가운데, 3 오른쪽, 4 양쪽), 11 줄 간격(%), 25 목록 단계, 27 목록 id, 13 들여쓰기(pt), 28 첫 줄 들여쓰기(pt)
import { FONTS, SLIDE_H, SLIDE_W, resolveColor } from '../deckCore.js'
import { htmlToParas, normColor, parasToHtml, dominant } from './richText.js'

export const GSLIDES_TYPE = 'application/x-vnd.google-docs-drawings-object+wrapped'
export const U = 365760 / SLIDE_W // 190.5
const BASE = 120000
const PT_PER_PX = 720 / SLIDE_W // 0.375
const KIND = { textbox: 108, rect: 6, rounded: 7, ellipse: 8, triangle: 98, arrow: 72, line: 153, image: 3 }
const KIND_NAME = { 6: 'rect', 7: 'rounded', 8: 'ellipse', 98: 'triangle', 72: 'arrow' }
const ALIGN_CODE = { left: 1, center: 2, right: 3, justify: 4 }
const ALIGN_NAME = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify' }
const VALIGN_CODE = { top: 0, middle: 1, bottom: 2 }
const VALIGN_NAME = ['top', 'middle', 'bottom']
const LINE_KINDS = new Set([153, 154, 155, 156, 157, 158, 159, 160])

// 구글 슬라이드에서 바로 쓸 수 있는 글꼴로 바꾼다(프리텐다드는 구글 글꼴에 없다)
const GFONT = { sans: 'Noto Sans KR', serif: 'Noto Serif KR', gothic: 'Nanum Gothic', mono: 'Nanum Gothic Coding' }
const FROM_GFONT = { 'noto sans kr': 'sans', 'noto serif kr': 'serif', 'nanum gothic': 'gothic', 'nanum gothic coding': 'mono', 'nanum myeongjo': 'serif' }

export function slidesFont(v, theme) {
  let key = v || '@body'
  if (key[0] === '@') key = theme?.fonts?.[key.slice(1)] || 'sans'
  if (GFONT[key]) return GFONT[key]
  if (FONTS[key]) return FONTS[key].office
  return String(key).replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || GFONT.sans
}
function dahFont(name) {
  if (!name) return null
  const k = String(name).toLowerCase()
  if (FROM_GFONT[k]) return FROM_GFONT[k]
  if (k === 'pretendard') return 'sans'
  if (/^(arial|helvetica|roboto|inter)$/.test(k)) return null // 바탕 글꼴로 둔다
  return String(name).replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || null
}

const hex6 = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c) ? c.slice(0, 7).toUpperCase() : null)
const alphaOf = (c) => (typeof c === 'string' && /^#[0-9a-f]{8}$/i.test(c) ? parseInt(c.slice(7, 9), 16) / 255 : 1)
const color = (v, theme) => normColor(resolveColor(v, theme))
const r4 = (n) => Math.round(n * 10000) / 10000

/** 상자(DAH px)와 회전(도) → 변환 행렬. bw·bh는 도형의 기본 크기(단위) */
export function transformFor(x, y, w, h, deg = 0, bw = BASE, bh = BASE) {
  const sx = (Math.max(w, 0.5) * U) / bw
  const sy = (Math.max(h, 0) * U) / bh
  const r = ((deg || 0) * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const a = sx * cos
  const b = sx * sin
  const c = -sy * sin
  const d = sy * cos
  const cx = (x + w / 2) * U
  const cy = (y + h / 2) * U
  return [r4(a), r4(b), r4(c), r4(d), Math.round(cx - (a * bw) / 2 - (c * bh) / 2), Math.round(cy - (b * bw) / 2 - (d * bh) / 2)]
}

/** 변환 행렬 → { x, y, w, h, rotate } (DAH px) */
export function boxFrom(t, bw = BASE, bh = BASE) {
  const [a, b, c, d, e, f] = t
  const sx = Math.hypot(a, b)
  const sy = Math.hypot(c, d)
  const w = (sx * bw) / U
  const h = (sy * bh) / U
  const cx = (e + (a * bw) / 2 + (c * bh) / 2) / U
  const cy = (f + (b * bw) / 2 + (d * bh) / 2) / U
  let rot = (Math.atan2(b, a) * 180) / Math.PI
  if (Math.abs(rot) < 0.01) rot = 0
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h), rotate: Math.round(rot * 100) / 100 }
}

// ── DAH → 구글 슬라이드 ─────────────────────────────────────

function textCommands(id, el, theme, cmds) {
  const s = el.style || {}
  const base = {
    bold: !!s.bold, italic: !!s.italic, underline: !!s.underline,
    color: color(s.color || '@text', theme) || '#111111', size: s.size || 36, font: slidesFont(s.font || '@body', theme),
  }
  const paras = htmlToParas(el.data?.html || '', { pxScale: 1, baseSize: base.size })
  if (!paras.length) return
  let text = ''
  const runs = []
  const paraEnds = []
  paras.forEach((p, i) => {
    for (const r of p.runs) {
      runs.push({ start: text.length, end: text.length + r.text.length, r })
      text += r.text
    }
    paraEnds.push({ at: text.length, p })
    if (i < paras.length - 1) text += '\n'
  })
  if (!text.replace(/\s/g, '')) return
  cmds.push([15, id, null, 0, text])
  const lists = {}
  const listId = (ordered) => {
    const k = ordered ? 'o' : 'u'
    if (!lists[k]) {
      lists[k] = `${id}_${k}`
      const levels = []
      for (let L = 0; L < 3; L++) {
        levels.push(L, ordered ? [17, [10, 13, 15][L], 25, 0, 36, `%${L}.`] : [17, 9, 25, 0, 36, `%${L}`, 37, ['●', '○', '■'][L]], [])
      }
      cmds.push([41, id, null, lists[k], levels])
    }
    return lists[k]
  }
  const lh = s.lineHeight || 1.4
  for (const { at, p } of paraEnds) {
    const props = [12, ALIGN_CODE[p.align || s.align] || 1, 11, Math.round((Math.max(0.6, p.lineHeight || lh) / 1.2) * 100)]
    if (p.list) {
      const L = Math.min(2, p.list.level || 0)
      props.push(25, L, 27, listId(p.list.ordered), 13, 36 * (L + 1), 28, 18 + 36 * L)
    }
    cmds.push([17, id, null, at, at + 1, [], props])
  }
  for (const { start, end, r } of runs) {
    if (end <= start) continue
    const sz = r.size || base.size
    const props = []
    if (r.bold || base.bold) props.push(0, 1)
    if (r.italic || base.italic) props.push(1, 1)
    if (r.underline || base.underline || r.href) props.push(2, 1)
    if (r.strike) props.push(20, 1)
    props.push(4, hex6(r.color) || (r.href ? '#1155CC' : base.color))
    props.push(5, r.font ? slidesFont(r.font, theme) : base.font)
    props.push(6, Math.round(sz * PT_PER_PX * 10) / 10)
    if (r.href && /^(https?:|mailto:)/i.test(r.href)) props.push(8, r.href)
    cmds.push([17, id, null, start, end, [], props])
  }
}

function fillProps(c, opacity = 1) {
  if (!c) return [14, 0]
  const out = [14, 1, 15, hex6(c)]
  const a = alphaOf(c) * (opacity ?? 1)
  if (a < 0.999) out.push(16, r4(a))
  return out
}

function absUrl(src) {
  const s = String(src || '')
  if (/^https?:\/\//i.test(s)) return s
  if (/^\/(?!\/)/.test(s) && typeof location !== 'undefined') return location.origin + s
  return ''
}

/** DAH 요소 하나 → 명령 목록 */
function encodeElement(el, theme, id, cmds, opts) {
  const s = el.style || {}
  const rot = el.rotate || 0
  const box = (bw, bh) => transformFor(el.x, el.y, el.w, el.h, rot, bw, bh)
  const op = s.opacity ?? 1
  if (el.type === 'text') {
    const fill = color(s.fill, theme)
    const radius = fill ? Math.min(s.radius ?? 0, el.w / 2, el.h / 2) : 0
    const kind = radius > 0 ? KIND.rounded : KIND.textbox
    const props = [...fillProps(fill, op), 18, 0, 44, VALIGN_CODE[s.valign] ?? 0]
    if (radius > 0) props.unshift(0, Math.round((radius / Math.min(el.w, el.h)) * 100000))
    cmds.push([3, id, kind, box(), props, 'p'])
    textCommands(id, el, theme, cmds)
    return true
  }
  if (el.type === 'shape') {
    const shape = el.data?.shape || 'rect'
    const fill = color(s.fillType === 'linear' && s.gradient ? s.gradient.from || '@accent' : s.fill, theme)
    const stroke = color(s.stroke, theme)
    const sw = s.stroke ? s.strokeWidth || 4 : 0
    if (shape === 'line') {
      const lc = color(s.stroke || s.fill || '@text', theme) || '#111111'
      const lw = s.strokeWidth || 6
      // 선은 상자 가운데 가로줄. 기본 도형(0,0)→(B,B) 대각선을 높이 0으로 눌러 가로선으로 만든다
      const t = transformFor(el.x, el.y + el.h / 2, el.w, 0, rot)
      cmds.push([3, id, KIND.line, t, [14, 0, 18, 1, 19, hex6(lc), 22, Math.round(lw * U), ...(s.arrowEnd ? [29, 5] : [])], 'p'])
      return true
    }
    if (shape === 'icon') {
      if (!opts.iconImage?.[el.id]) return false
      cmds.push([3, id, KIND.image, transformFor(el.x, el.y, el.w, el.h, rot, el.w, el.h), [39, opts.iconImage[el.id], 8, el.w, 9, el.h], 'p'])
      return true
    }
    const kind = KIND[shape] || KIND.rect
    const radius = shape === 'rounded' ? s.radius ?? 24 : shape === 'rect' ? s.radius || 0 : 0
    const props = [...fillProps(fill, op)]
    if (stroke && sw) props.push(18, 1, 19, hex6(stroke), 22, Math.round(sw * U))
    else props.push(18, 0)
    let k = kind
    if ((shape === 'rect' || shape === 'rounded') && radius > 0) {
      k = KIND.rounded
      props.unshift(0, Math.max(0, Math.min(50000, Math.round((radius / Math.max(1, Math.min(el.w, el.h))) * 100000))))
    } else if (shape === 'rounded') k = KIND.rect
    cmds.push([3, id, k, box(), props, 'p'])
    return true
  }
  if (el.type === 'image') {
    const src = absUrl(el.data?.src)
    if (!src) return false
    // 그림 기본 크기를 상자 크기(px)로 두고 배율은 U. 슬라이드가 주소에서 그림을 받아 온다
    cmds.push([3, id, KIND.image, transformFor(el.x, el.y, el.w, el.h, rot, el.w, el.h), [39, src, 8, Math.round(el.w), 9, Math.round(el.h)], 'p'])
    return true
  }
  if (el.type === 'table') {
    // 표는 칸마다 글 상자(테두리·머리글 채우기)로 나눠 넣는다
    const rows = el.data?.rows || []
    const nr = rows.length
    const nc = Math.max(1, ...rows.map((r) => r.length))
    if (!nr) return false
    const cw = el.w / nc
    const ch = el.h / nr
    const line = color(s.line || '@muted', theme)
    rows.forEach((row, ri) => {
      for (let ci = 0; ci < nc; ci++) {
        const head = el.data?.header && ri === 0
        const cid = `${id}_${ri}_${ci}`
        const cell = {
          x: el.x + ci * cw, y: el.y + ri * ch, w: cw, h: ch,
          style: { size: s.size || 24, color: head ? s.headerColor || '@bg' : s.color || '@text', font: s.font || '@body', bold: head, valign: 'middle', lineHeight: 1.2 },
          data: { html: `<p>${String(row[ci] ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</p>` },
        }
        const fill = head ? color(s.headerFill || '@accent', theme) : color(s.fill, theme)
        const props = [...fillProps(fill), 44, 1]
        if (line) props.push(18, 1, 19, hex6(line), 22, Math.round(2 * U))
        cmds.push([3, cid, KIND.textbox, transformFor(cell.x, cell.y, cell.w, cell.h), props, 'p'])
        textCommands(cid, cell, theme, cmds)
      }
    })
    return true
  }
  if (el.type === 'embed') {
    const d = el.data || {}
    const url = /^https?:\/\//i.test(d.url || '') ? d.url : ''
    const title = d.title || d.siteName || url || '링크'
    const html = `<p><b>${escapeHtml(title)}</b></p>${url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` : ''}`
    cmds.push([3, id, KIND.rect, box(), [...fillProps(color('@surface', theme)), 18, 0, 44, 1], 'p'])
    textCommands(id, { ...el, style: { size: 28, color: '@text', font: '@body', lineHeight: 1.3 }, data: { html } }, theme, cmds)
    return true
  }
  return false
}
const escapeHtml = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * DAH 요소들 → 클립보드 문자열(GSLIDES_TYPE). 넣을 수 있는 요소가 없으면 null
 * opts.iconImage: { [요소 id]: https 그림 주소 } 아이콘을 그림으로 넣고 싶을 때
 */
export function encodeGSlides(elements, deck, opts = {}) {
  const theme = deck?.theme
  const cmds = []
  const tag = Math.random().toString(36).slice(2, 8)
  let n = 0
  const sorted = [...(elements || [])].filter((e) => e && !e.hidden).sort((a, b) => (a.z || 0) - (b.z || 0))
  sorted.forEach((el, i) => {
    if (encodeElement(el, theme, `dah_${tag}_${i}`, cmds, opts)) n++
  })
  if (!n) return null
  const data = { resolved: cmds, unresolved: cmds, autotext_content: {}, did_remove_empty_picture_placeholders: false, copy_source_supports_inheritance_via_master: false }
  return JSON.stringify({ data: JSON.stringify(data) })
}

// ── 구글 슬라이드 → DAH ─────────────────────────────────────

function propsMap(arr) {
  const m = new Map()
  if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) m.set(arr[i], arr[i + 1])
  return m
}

/** 클립보드 문자열 → 명령 목록(resolved). 알 수 없으면 null */
export function parseGSlides(str) {
  try {
    const outer = typeof str === 'string' ? JSON.parse(str) : str
    const data = typeof outer?.data === 'string' ? JSON.parse(outer.data) : outer?.data
    const cmds = Array.isArray(data?.resolved) ? data.resolved : Array.isArray(data?.unresolved) ? data.unresolved : null
    return cmds && cmds.length ? cmds : null
  } catch {
    return null
  }
}

function buildObjects(cmds) {
  const objs = new Map()
  const order = []
  for (const c of cmds) {
    if (!Array.isArray(c)) continue
    const [op, id] = c
    if (op === 3) {
      if (!objs.has(id)) order.push(id)
      objs.set(id, { id, kind: c[2], t: c[3], props: propsMap(c[4]), text: '', chars: [], paras: new Map(), lists: new Map() })
      continue
    }
    const o = objs.get(id)
    if (!o) continue
    if (op === 15 && typeof c[4] === 'string') {
      const at = Math.max(0, Math.min(o.text.length, c[3] || 0))
      o.text = o.text.slice(0, at) + c[4] + o.text.slice(at)
      o.chars.splice(at, 0, ...Array.from({ length: c[4].length }, () => new Map()))
    } else if (op === 17) {
      const [, , , start, end, , props] = c
      const pm = propsMap(props)
      // 문단 속성(12, 11, 25, 27...)은 문단 끝 칸에 붙는다
      for (let i = start; i < end; i++) {
        const isEnd = i >= o.text.length || o.text[i] === '\n'
        for (const [k, v] of pm) {
          if ([11, 12, 13, 25, 27, 28].includes(k)) {
            if (isEnd) {
              const p = o.paras.get(i) || new Map()
              p.set(k, v)
              o.paras.set(i, p)
            }
          } else if (i < o.chars.length) o.chars[i].set(k, v)
        }
      }
    } else if (op === 41) {
      const levels = c[4] || []
      const lv = new Map()
      for (let i = 0; i + 1 < levels.length; i += 3) lv.set(levels[i], propsMap(levels[i + 1]))
      o.lists.set(c[3], lv)
    }
  }
  return order.map((id) => objs.get(id))
}

function objParas(o) {
  const paras = []
  let cur = { runs: [], start: 0 }
  const flush = (endIdx) => {
    const pp = o.paras.get(endIdx) || new Map()
    let list = null
    if (pp.has(27) && pp.get(27)) {
      const level = pp.get(25) || 0
      const lv = o.lists.get(pp.get(27))?.get(level)
      const glyphType = lv?.get(17)
      const fmt = String(lv?.get(36) || '')
      list = { ordered: glyphType !== undefined ? glyphType !== 9 && !lv?.has(37) : /\./.test(fmt), level }
    }
    const lhPct = pp.get(11)
    paras.push({ runs: cur.runs, list, align: ALIGN_NAME[pp.get(12)] || null, lineHeight: lhPct ? Math.round((lhPct / 100) * 1.2 * 100) / 100 : null })
    cur = { runs: [] }
  }
  for (let i = 0; i < o.text.length; i++) {
    const ch = o.text[i]
    if (ch === '\n') {
      flush(i)
      continue
    }
    const m = o.chars[i] || new Map()
    const run = {
      text: ch,
      bold: m.get(0) === 1 || m.get(0) === true,
      italic: m.get(1) === 1 || m.get(1) === true,
      underline: (m.get(2) === 1 || m.get(2) === true) && !m.get(8),
      strike: m.get(20) === 1 || m.get(20) === true,
      color: m.get(8) ? null : hex6(m.get(4)), // 링크 글자색은 DAH 링크 색을 쓴다
      size: typeof m.get(6) === 'number' ? Math.round((m.get(6) / PT_PER_PX) * 10) / 10 : null,
      font: dahFont(m.get(5)),
      href: typeof m.get(8) === 'string' ? m.get(8) : typeof m.get(8)?.[1] === 'string' ? m.get(8)[1] : null,
    }
    const prev = cur.runs[cur.runs.length - 1]
    if (prev && ['bold', 'italic', 'underline', 'strike', 'color', 'size', 'font', 'href'].every((k) => prev[k] === run[k])) prev.text += ch
    else cur.runs.push(run)
  }
  flush(o.text.length)
  return paras
}

/** 문단 → DAH 글 요소 */
function textElement(o, box, paras, extra = {}) {
  const size = dominant(paras, 'size') || 36
  const col = dominant(paras, 'color') || '@text'
  const allBold = paras.every((p) => p.runs.every((r) => r.bold)) && paras.some((p) => p.runs.length)
  const allItalic = paras.every((p) => p.runs.every((r) => r.italic)) && paras.some((p) => p.runs.length)
  const font = dominant(paras, 'font')
  const align = paras[0]?.align || extra.align || 'left'
  const lineHeight = paras.find((p) => p.lineHeight)?.lineHeight || 1.2
  const base = { bold: allBold, italic: allItalic, underline: false, color: col, size }
  const html = parasToHtml(paras.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, font: null })) })), base)
  return {
    type: 'text', ...box,
    style: { font: font || '@body', size, color: col, align, valign: extra.valign || 'top', lineHeight, bold: allBold, italic: allItalic, underline: false, fill: extra.fill || null, radius: extra.radius || 0, autofit: false, ...(extra.opacity !== undefined ? { opacity: extra.opacity } : {}) },
    data: { html, placeholder: '' },
  }
}

/** 클립보드 문자열 → DAH 요소들(좌표는 1920x1080, id 없음). 알 수 없으면 null */
export function decodeGSlides(str) {
  const cmds = parseGSlides(str)
  if (!cmds) return null
  const out = []
  let g = 0
  for (const o of buildObjects(cmds)) {
    if (!Array.isArray(o.t) || o.t.length < 6) continue
    const p = o.props
    const fillOn = p.get(14) !== 0
    const fill = fillOn ? hex6(p.get(15)) : null
    const fillA = typeof p.get(16) === 'number' ? p.get(16) : 1
    const fillC = fill && fillA < 0.999 ? fill + Math.round(fillA * 255).toString(16).padStart(2, '0').toUpperCase() : fill
    const strokeOn = p.get(18) !== 0 && p.has(19)
    const stroke = strokeOn ? hex6(p.get(19)) : null
    const sw = typeof p.get(22) === 'number' ? Math.max(1, Math.round(p.get(22) / U)) : 2
    const valign = VALIGN_NAME[p.get(44)] || null
    if (o.kind === KIND.image) {
      const bw = p.get(8) || 100
      const bh = p.get(9) || 100
      const src = typeof p.get(39) === 'string' && /^https?:\/\//i.test(p.get(39)) ? p.get(39) : ''
      if (!src) continue
      out.push({ type: 'image', ...boxFrom(o.t, bw, bh), style: { fit: 'fill', posX: 50, posY: 50, radius: 0 }, data: { src, alt: '', placeholder: '' } })
      continue
    }
    if (LINE_KINDS.has(o.kind)) {
      const [a, b, c, d, e, f] = o.t
      const x0 = e / U
      const y0 = f / U
      const x1 = (a * BASE + c * BASE + e) / U
      const y1 = (b * BASE + d * BASE + f) / U
      const len = Math.max(2, Math.hypot(x1 - x0, y1 - y0))
      const lw = sw
      const h = Math.max(lw * 3, 20)
      const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
      out.push({
        type: 'shape', x: Math.round((x0 + x1) / 2 - len / 2), y: Math.round((y0 + y1) / 2 - h / 2), w: Math.round(len), h: Math.round(h), rotate: Math.round(ang * 100) / 100,
        style: { fill: null, stroke: stroke || '#111111', strokeWidth: lw, radius: 0, arrowEnd: !!p.get(29) }, data: { shape: 'line' },
      })
      continue
    }
    const box = boxFrom(o.t)
    const paras = o.text ? objParas(o) : []
    const hasText = paras.some((pp) => pp.runs.some((r) => r.text.trim()))
    if (o.kind === KIND.textbox || (!KIND_NAME[o.kind] && hasText && !stroke)) {
      if (!hasText && !fill) continue
      out.push(textElement(o, box, paras, { fill: fillC, valign: valign || 'top' }))
      continue
    }
    const shape = KIND_NAME[o.kind] || 'rect'
    const adj = typeof p.get(0) === 'number' ? p.get(0) : 16667
    const radius = shape === 'rounded' ? Math.round((Math.min(box.w, box.h) * adj) / 100000) : 0
    const shapeEl = { type: 'shape', ...box, style: { fill: fill ? fillC : null, stroke, strokeWidth: stroke ? sw : 0, radius }, data: { shape } }
    if (!hasText) {
      out.push(shapeEl)
      continue
    }
    if ((shape === 'rect' || shape === 'rounded') && !stroke) {
      // 테두리 없는 사각형 + 글 → 채우기 있는 글 상자 하나
      out.push(textElement(o, box, paras, { fill: fillC, radius, valign: valign || 'middle' }))
      continue
    }
    // 도형 + 글 → 도형과 글 상자를 묶음으로
    const group = `gs${Date.now().toString(36)}${g++}`
    out.push({ ...shapeEl, group })
    out.push({ ...textElement(o, box, paras, { valign: valign || 'middle' }), group })
  }
  return out.length ? out : null
}

export const SLIDE_SIZE = { w: SLIDE_W, h: SLIDE_H }
