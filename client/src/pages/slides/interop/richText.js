// 서식 있는 글 ↔ 문단 모델. 클립보드 형식들이 모두 이 모델을 거친다.
// 문단 { runs: [{ text, bold, italic, underline, strike, color, size, font, href }], list: null | { ordered, level }, align, lineHeight }
//   size는 DAH 좌표(1920 폭) px, color는 '#RRGGBB' 또는 null(바탕 글자색), text 안의 '\u000b'는 줄 바꿈(<br>)
import { escapeAttr, escapeText, parseHtml, parseStyle } from './html.js'

const NAMED_COLORS = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080', grey: '#808080',
  orange: '#FFA500', purple: '#800080', navy: '#000080', teal: '#008080', maroon: '#800000', silver: '#C0C0C0', lime: '#00FF00', aqua: '#00FFFF', fuchsia: '#FF00FF',
}

/** CSS 색 → '#RRGGBB'(알파가 있으면 '#RRGGBBAA'). 투명·알 수 없으면 null */
export function normColor(v) {
  if (!v) return null
  const s = String(v).trim().toLowerCase()
  if (s === 'transparent' || s === 'inherit' || s === 'currentcolor' || s === 'initial') return null
  let m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) return ('#' + m[1].split('').map((c) => c + c).join('')).toUpperCase()
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s)
  if (m) return m[2] === '00' ? null : ('#' + m[1] + (m[2] && m[2] !== 'ff' ? m[2] : '')).toUpperCase()
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s)
  if (m) {
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    if (!(a > 0)) return null
    a = Math.min(1, a)
    const hex = [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, '0')).join('')
    return ('#' + hex + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '')).toUpperCase()
  }
  return NAMED_COLORS[s] || null
}

/** CSS 길이 → pt (px는 0.75pt). em·%는 base pt 기준 */
export function cssToPt(v, basePt) {
  const m = /^([\d.]+)\s*(px|pt|em|rem|%)?$/i.exec(String(v || '').trim())
  if (!m) return null
  const n = parseFloat(m[1])
  const u = (m[2] || 'px').toLowerCase()
  if (u === 'pt') return n
  if (u === 'px') return n * 0.75
  if (u === '%') return basePt ? (basePt * n) / 100 : null
  return basePt ? basePt * n : null
}

const BLOCK = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'dt', 'dd', 'table', 'ul', 'ol', 'hr'])
const HEAD_SCALE = { h1: 1.6, h2: 1.35, h3: 1.15, h4: 1, h5: 1, h6: 1 }
const ALIGNS = new Set(['left', 'center', 'right', 'justify'])

/**
 * HTML → 문단 목록
 * opts.pxScale: CSS px 1개가 DAH px 몇 개인가. DAH 글 상자 HTML은 1, 바깥 HTML(문서·웹)은 2(=0.75pt × 8/3)
 * opts.baseSize: 바탕 글자 크기(DAH px). 제목(h1~h3) 배율과 em 계산에 쓴다
 */
export function htmlToParas(html, opts = {}) {
  const pxScale = opts.pxScale ?? 2
  const baseSize = opts.baseSize ?? 36
  const ptToDah = pxScale / 0.75
  const root = parseHtml(html)
  const paras = []
  let cur = null
  const push = () => {
    if (!cur) return
    while (cur.runs.length && /^\u000b$/.test(cur.runs[cur.runs.length - 1].text)) cur.runs.pop() // 끝의 <br>
    // 문단 앞뒤 공백 정리
    const first = cur.runs[0]
    if (first && !cur.pre) first.text = first.text.replace(/^[ \t]+/, '')
    const last = cur.runs[cur.runs.length - 1]
    if (last && !cur.pre) last.text = last.text.replace(/[ \t]+$/, '')
    cur.runs = cur.runs.filter((r) => r.text)
    if (cur.runs.length || cur.blank) paras.push({ runs: cur.runs, list: cur.list, align: cur.align, lineHeight: cur.lineHeight })
    cur = null
  }
  const start = (ctx) => {
    push()
    cur = { runs: [], list: ctx.list || null, align: ctx.align || null, lineHeight: ctx.lineHeight || null, pre: ctx.pre }
  }
  const addText = (text, st, ctx) => {
    if (!cur) start(ctx)
    let t = text
    if (!ctx.pre) t = t.replace(/[\r\n\t ]+/g, ' ')
    else t = t.replace(/\r\n?/g, '\n').replace(/\n/g, '\u000b')
    if (!t) return
    const prev = cur.runs[cur.runs.length - 1]
    if (!ctx.pre && t.startsWith(' ') && (!prev || /[ \u000b]$/.test(prev.text))) t = t.slice(1)
    if (!t) return
    const run = { text: t, bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, strike: !!st.strike, color: st.color || null, size: st.size || null, font: st.font || null, href: st.href || null }
    if (prev && sameStyle(prev, run)) prev.text += t
    else cur.runs.push(run)
  }
  const walk = (node, st, ctx) => {
    if (node.text !== undefined) {
      if (/^\s*$/.test(node.text) && (!cur || !cur.runs.length) && !ctx.pre) return
      addText(node.text, st, ctx)
      return
    }
    const tag = node.tag
    const css = parseStyle(node.attrs?.style)
    const s = { ...st }
    let c = ctx
    // 글자 서식
    if (tag === 'b' || tag === 'strong') s.bold = true
    if (/^h[1-6]$/.test(tag)) {
      s.bold = true
      if (!css['font-size'] && HEAD_SCALE[tag] > 1) s.size = Math.round((st.size || baseSize) * HEAD_SCALE[tag])
    }
    if (tag === 'i' || tag === 'em' || tag === 'cite') s.italic = true
    if (tag === 'u' || tag === 'ins') s.underline = true
    if (tag === 's' || tag === 'strike' || tag === 'del') s.strike = true
    if (tag === 'font' && node.attrs.color) s.color = normColor(node.attrs.color) || s.color
    if (tag === 'a' && node.attrs.href) s.href = node.attrs.href
    if (tag === 'code' || tag === 'kbd') s.font = s.font || 'mono'
    const fw = css['font-weight']
    if (fw) s.bold = /^(bold|bolder)$/i.test(fw) || (parseInt(fw, 10) >= 600)
    const fs = css['font-style']
    if (fs) s.italic = /italic|oblique/i.test(fs)
    const td = css['text-decoration'] || css['text-decoration-line']
    if (td) {
      if (/none/i.test(td) && tag !== 'a') {
        s.underline = false
        s.strike = false
      }
      if (/underline/i.test(td)) s.underline = true
      if (/line-through/i.test(td)) s.strike = true
    }
    if (css.color) s.color = normColor(css.color) || s.color
    if (css['font-size']) {
      const pt = cssToPt(css['font-size'], (st.size || baseSize) / ptToDah)
      if (pt) s.size = Math.round(pt * ptToDah * 10) / 10
    }
    if (css['font-family']) s.font = css['font-family'].split(',')[0].replace(/["']/g, '').trim() || s.font
    if (/^(sub|sup)$/.test(tag)) s.size = Math.round((s.size || baseSize) * 0.7)
    if (tag === 'br') {
      if (!cur) start(ctx)
      if (!cur.runs.length) cur.blank = true
      else cur.runs.push({ ...s, text: '\u000b', bold: !!s.bold, italic: !!s.italic, underline: !!s.underline, strike: !!s.strike, color: s.color || null, size: s.size || null, font: s.font || null, href: null })
      return
    }
    if (tag === 'img' || tag === 'hr') {
      if (tag === 'hr') push()
      return
    }
    const isBlock = BLOCK.has(tag)
    if (isBlock) {
      c = { ...ctx }
      const ta = (css['text-align'] || node.attrs.align || '').toLowerCase()
      if (ALIGNS.has(ta)) c.align = ta
      else if (ta === 'start') c.align = 'left'
      else if (ta === 'end') c.align = 'right'
      if (tag === 'pre' || /pre/.test(css['white-space'] || '') && tag === 'pre') c.pre = true
      const lh = css['line-height']
      if (lh && /^[\d.]+$/.test(lh)) c.lineHeight = parseFloat(lh)
      if (tag === 'ul' || tag === 'ol') {
        c.listTag = tag
        c.depth = (ctx.depth ?? -1) + 1
        c.list = null
        push()
      }
      if (tag === 'li') {
        const ordered = (ctx.listTag || 'ul') === 'ol' || /decimal|alpha|roman/.test(css['list-style-type'] || '')
        const ariaLevel = parseInt(node.attrs['aria-level'] || '', 10)
        c.list = { ordered, level: Math.max(0, Math.min(8, ariaLevel > 0 ? ariaLevel - 1 : ctx.depth ?? 0)) }
      }
      // li 안의 p는 같은 목록 항목 문단
      if (!(tag === 'p' && ctx.inLi && cur && !cur.runs.length)) start(c)
      if (tag === 'li') c.inLi = true
      else if (tag !== 'p' && tag !== 'div') c.inLi = false
    }
    for (const child of node.children || []) walk(child, s, c)
    if (isBlock) {
      push()
    }
  }
  walk(root, {}, {})
  push()
  return paras
}

function sameStyle(a, b) {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.color === b.color && a.size === b.size && a.font === b.font && a.href === b.href
}

/** 문단 → 글자만 */
export function parasToText(paras) {
  return paras.map((p) => p.runs.map((r) => r.text).join('').replace(/\u000b/g, '\n')).join('\n')
}

/**
 * 문단 → DAH 글 상자 HTML. base와 같은 서식은 적지 않는다.
 * base = { bold, italic, underline, color, size }
 */
export function parasToHtml(paras, base = {}) {
  let out = ''
  const stack = []
  const closeTop = () => {
    const t = stack.pop()
    if (t.li) out += '</li>'
    out += `</${t.tag}>`
  }
  for (const p of paras) {
    const inner = runsToHtml(p.runs, base) || (p.list ? '' : '<br>')
    if (!p.list) {
      while (stack.length) closeTop()
      out += `<p>${inner}</p>`
      continue
    }
    const L = Math.max(0, Math.min(8, p.list.level || 0))
    const tag = p.list.ordered ? 'ol' : 'ul'
    while (stack.length > L + 1) closeTop()
    if (stack.length === L + 1 && stack[L].tag !== tag) closeTop()
    if (stack.length === L + 1 && stack[L].li) {
      out += '</li>'
      stack[L].li = false
    }
    while (stack.length < L + 1) {
      out += `<${tag}>`
      stack.push({ tag, li: false })
    }
    out += `<li>${inner}`
    stack[stack.length - 1].li = true
  }
  while (stack.length) closeTop()
  return out
}

function runsToHtml(runs, base) {
  return runs
    .map((r) => {
      let h = escapeText(r.text).replace(/\u000b/g, '<br>')
      if (r.strike) h = `<s>${h}</s>`
      if (r.underline && !base.underline && !r.href) h = `<u>${h}</u>`
      if (r.italic && !base.italic) h = `<i>${h}</i>`
      if (r.bold && !base.bold) h = `<b>${h}</b>`
      const st = []
      if (r.color && r.color !== base.color) st.push(`color: ${r.color.length === 9 ? r.color.slice(0, 7) : r.color}`)
      if (r.size && Math.abs(r.size - (base.size || 0)) > 0.5) st.push(`font-size: ${Math.round(r.size)}px`)
      if (base.bold && !r.bold) st.push('font-weight: 400')
      if (base.italic && !r.italic) st.push('font-style: normal')
      if (st.length) h = `<span style="${st.join('; ')}">${h}</span>`
      if (r.href) h = `<a href="${escapeAttr(r.href)}">${h}</a>`
      return h
    })
    .join('')
}

/** 가장 많이 쓴 값(글자 수 기준) */
export function dominant(paras, key) {
  const count = new Map()
  for (const p of paras) for (const r of p.runs) count.set(r[key], (count.get(r[key]) || 0) + r.text.length)
  let best = null
  let n = -1
  for (const [k, v] of count) if (v > n) [best, n] = [k, v]
  return best
}
