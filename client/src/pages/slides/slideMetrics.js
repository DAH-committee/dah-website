// 슬라이드 글 상자 맞춤 추정과 색 대비 계산(순수 함수, DOM 없음).
// 슬라이드는 1920x1080 px 이고 글자 크기는 px 로 저장된다. 13.33 인치 폭이라 1pt = 2px (18pt = 36px).
import { THEMES, resolveColor } from './deckCore.js'

export const PX_PER_PT = 2
export const ptOf = (px) => Math.round(((Number(px) || 0) / PX_PER_PT) * 10) / 10

const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** 글 상자 HTML → [{text, list, level}] (문단·목록 항목 하나가 한 줄) */
export function linesOfHtml(html) {
  const src = String(html || '').replace(/<(p|div)\b[^>]*>/gi, '').replace(/<\/(p|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  const out = []
  const re = /<(\/?)(ul|ol|li)\b[^>]*>|([^<]+)|<[^>]*>/gi
  let depth = 0
  let list = false
  let buf = ''
  const flush = () => {
    for (const part of decode(buf).split('\n')) if (part.trim()) out.push({ text: part.trim(), list, level: Math.max(0, Math.min(depth - 1, 1)) })
    buf = ''
  }
  let m
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) { buf += m[3]; continue }
    if (!m[2]) continue
    const tag = m[2].toLowerCase()
    const close = m[1] === '/'
    if (tag === 'li') {
      flush()
      list = !close
    } else {
      flush()
      depth += close ? -1 : 1
      list = false
    }
  }
  flush()
  return out
}

const isWide = (c) => /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c)
export function textWidth(t, size) {
  let w = 0
  for (const c of t) w += isWide(c) ? size : c === ' ' ? size * 0.3 : /[A-Z0-9]/.test(c) ? size * 0.62 : size * 0.52
  return w
}

/** 글 상자에 글이 들어가는지 추정한다. 반환: { lines, items, need_h, box_h, overflow, fit_size, fits_at_fit } */
export function estimateText(el) {
  const size = Number(el.style?.size) || 36
  const lh = Number(el.style?.lineHeight) || 1.4
  const lines = linesOfHtml(el.data?.html)
  const calc = (sz) => {
    let n = 0
    let h = 0
    for (const l of lines) {
      const indent = l.list ? sz * (0.9 + 0.9 * (l.level || 0)) : 0
      const avail = Math.max(sz, (el.w || 0) - 24 - indent)
      const k = Math.max(1, Math.ceil(textWidth(l.text, sz) / avail))
      n += k
      h += k * sz * lh + sz * 0.25
    }
    return { n, h: h + 16 }
  }
  const cur = calc(size)
  const over = lines.length > 0 && cur.h > (el.h || 0) * 1.02
  let fit = size
  if (over) while (fit > 20 && calc(fit).h > (el.h || 0)) fit -= 2
  return { lines: cur.n, items: lines.length, need_h: Math.round(cur.h), box_h: Math.round(el.h || 0), overflow: over, fit_size: over ? fit : size, fits_at_fit: !over || calc(fit).h <= (el.h || 0) * 1.02 }
}

// ── 색 대비(WCAG 2.x)
export function hexToRgb(h) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim())
  if (!m) return null
  let x = m[1]
  if (x.length === 3) x = x.split('').map((c) => c + c).join('')
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
}
const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
export const luminance = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
export function contrast(a, b) {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return null
  const la = luminance(ra)
  const lb = luminance(rb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function themeOf(deck) {
  return deck?.theme?.colors ? deck.theme : THEMES[0]
}
/** 슬라이드 배경색(실제 색) */
export function slideBg(slide, theme) {
  const c = resolveColor(slide?.background?.color || '@bg', theme)
  return hexToRgb(c) ? c : resolveColor('@bg', theme)
}
