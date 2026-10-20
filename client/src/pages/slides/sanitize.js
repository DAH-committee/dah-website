// DAH Slides 내용 거르기: 글 상자 HTML(허용 태그만, style은 색·배경색·글자 크기만), 주소(http/https만, 글 속 링크는 mailto도), 불러온 JSON 정리.
// 글 속 링크(<a href>)는 남긴다. http, https, mailto만 두고 javascript:, data: 같은 주소는 링크만 지우고 글자는 남긴다.
// 남긴 링크에는 target="_blank" rel="noopener noreferrer"를 붙인다(발표 중 누르면 새 탭).
import DOMPurify from 'dompurify'
import { SLIDE_H, SLIDE_W, THEMES, themeCopy } from './deckCore.js'

export function sanitizeUrl(u) {
  if (!u) return ''
  let c = String(u).trim()
  if (!/^https?:\/\//i.test(c)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(c)) return ''
    if (!/^[\w-]+(\.[\w-]+)+/.test(c)) return ''
    c = 'https://' + c
  }
  try {
    const p = new URL(c)
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : ''
  } catch {
    return ''
  }
}

/** 글 속 링크 주소: http, https, mailto. 그 밖의 스킴(javascript:, data:, vbscript: ...)은 '' */
export function sanitizeHref(u) {
  const c = String(u ?? '').trim()
  if (!c) return ''
  if (/^mailto:/i.test(c)) {
    const rest = c.slice(7)
    if (!rest || /[<>"\s]/.test(rest) || rest.length > 400) return ''
    return 'mailto:' + rest
  }
  return sanitizeUrl(c)
}

/** 이미지 주소: http/https, 같은 사이트 경로(/uploads/...), 또는 붙여넣은 작은 그림(data:image) */
export function sanitizeImageSrc(u) {
  const s = String(u || '').trim()
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(s) && s.length < 600000) return s
  return /^https?:\/\//i.test(s) ? sanitizeUrl(s) : ''
}

/** 퍼그마·유튜브 등 임베드 주소: https만, 알려진 곳만 */
export function sanitizeEmbedUrl(u) {
  const s = sanitizeUrl(u)
  if (!s || !s.startsWith('https://')) return ''
  try {
    const h = new URL(s).hostname.replace(/^www\./, '')
    return /(^|\.)(youtube\.com|youtube-nocookie\.com|figma\.com|player\.vimeo\.com|notion\.site)$/.test(h) ? s : ''
  } catch {
    return ''
  }
}

export function hostnameOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const ALLOWED_TAGS = ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'font']
const STYLE_KEEP = /^(color|background-color|font-size|font-weight|font-style|text-decoration|text-decoration-line)$/i
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i

let hooked = false
function hook() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'style') {
      const keep = []
      for (const decl of String(data.attrValue).split(';')) {
        const i = decl.indexOf(':')
        if (i < 0) continue
        const k = decl.slice(0, i).trim().toLowerCase()
        const v = decl.slice(i + 1).trim()
        if (!STYLE_KEEP.test(k) || /url\(|expression|javascript/i.test(v)) continue
        if ((k === 'color' || k === 'background-color') && !COLOR_RE.test(v)) continue
        if (k === 'font-size' && !/^\d{1,3}(\.\d+)?(px|em|%)$/.test(v)) continue
        keep.push(`${k}: ${v}`)
      }
      data.attrValue = keep.join('; ')
      if (!keep.length) data.keepAttr = false
    }
    if (data.attrName === 'color' && !COLOR_RE.test(String(data.attrValue))) data.keepAttr = false
    if (data.attrName === 'href') {
      const safe = sanitizeHref(data.attrValue)
      if (!safe) data.keepAttr = false
      else data.attrValue = safe
    }
  })
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      if (!node.getAttribute('href')) {
        node.removeAttribute('target')
        node.removeAttribute('rel')
        return
      }
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

/** 글 상자 HTML 거르기 */
export function sanitizeRich(html) {
  if (!html) return ''
  if (typeof window === 'undefined') return String(html).replace(/<[^>]*>/g, '')
  hook()
  return DOMPurify.sanitize(String(html), { ALLOWED_TAGS, ALLOWED_ATTR: ['style', 'href', 'target', 'rel', 'color'], KEEP_CONTENT: true })
}

export function plainText(html) {
  if (!html) return ''
  if (typeof document === 'undefined') return String(html).replace(/<[^>]*>/g, ' ')
  const d = document.createElement('div')
  d.innerHTML = sanitizeRich(html)
  d.querySelectorAll('p, li, div, br').forEach((n) => n.insertAdjacentText('afterend', '\n'))
  return d.textContent.replace(/\n{2,}/g, '\n').trim()
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const COLOR_OK = (v) => typeof v === 'string' && (/^@(bg|text|accent|accent2|muted|surface)$/.test(v) || /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\([\d\s.,%]+\)$/i.test(v) || v === 'transparent')
const color = (v, d = null) => (COLOR_OK(v) ? v : d)

function cleanTheme(t) {
  const base = themeCopy(t?.id && THEMES.some((x) => x.id === t.id) ? t.id : 'basic')
  if (!t || typeof t !== 'object') return base
  const colors = { ...base.colors }
  for (const k of Object.keys(colors)) if (t.colors && /^#[0-9a-f]{3,8}$/i.test(t.colors[k] || '')) colors[k] = t.colors[k]
  const font = (v, d) => (typeof v === 'string' && v.length <= 60 ? v.replace(/[^\p{L}\p{N} _-]/gu, '') || d : d)
  return { id: str(t.id, 40) || base.id, name: str(t.name, 40) || base.name, fonts: { heading: font(t.fonts?.heading, base.fonts.heading), body: font(t.fonts?.body, base.fonts.body) }, colors }
}

const STYLE_ENUMS = {
  fillType: ['solid', 'linear', 'radial', 'gradient', 'none'],
  strokeStyle: ['solid', 'dashed', 'dotted'],
  mask: ['circle', 'rounded', 'none'],
  sizing: ['auto-w', 'auto-h', 'fixed'],
  textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'],
  fit: ['cover', 'contain', 'fill'],
  align: ['left', 'center', 'right', 'justify'],
  valign: ['top', 'middle', 'bottom'],
}
const shadowOf = (v) => (v && typeof v === 'object' ? { x: num(v.x, 0), y: num(v.y, 0), blur: Math.max(0, num(v.blur, 0)), color: color(v.color, '#00000040') } : undefined)

/** 요소 style: 알려진 키는 모양을 검사하고, 그 밖의 키(숫자·짧은 글·참거짓)는 그대로 둔다 */
function cleanStyle(src) {
  const s = {}
  if (!src || typeof src !== 'object') return s
  for (const [k, v] of Object.entries(src)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (['color', 'fill', 'stroke', 'headerFill', 'headerColor', 'line'].includes(k)) s[k] = color(v)
    else if (k === 'gradient') s[k] = v && typeof v === 'object' ? { from: color(v.from, '@accent'), to: color(v.to, '@accent2'), angle: num(v.angle, 90) } : undefined
    else if (k === 'shadow' || k === 'textShadow') s[k] = v ? shadowOf(v) : null
    else if (STYLE_ENUMS[k]) s[k] = STYLE_ENUMS[k].includes(v) ? v : undefined
    else if (typeof v === 'number') s[k] = Number.isFinite(v) ? v : undefined
    else if (typeof v === 'boolean' || v === null) s[k] = v
    else if (typeof v === 'string') s[k] = /url\(|expression|javascript:/i.test(v) ? undefined : v.slice(0, 80)
  }
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k]
  return s
}

function cleanStacks(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out = {}
  for (const [k, st] of Object.entries(v).slice(0, 100)) {
    if (!st || typeof st !== 'object' || k.length > 64) continue
    out[k] = { dir: st.dir === 'column' ? 'column' : 'row', gap: num(st.gap, 24), pad: num(st.pad, 0), align: ['start', 'center', 'end'].includes(st.align) ? st.align : 'start' }
    if (typeof st.frame === 'string' && st.frame && st.frame.length <= 64) out[k].frame = st.frame // 자동 배치 배경 도형 id
  }
  return Object.keys(out).length ? out : undefined
}

export const TRANSITIONS = ['none', 'fade', 'slide', 'magic']

function cleanElement(e, i) {
  if (!e || typeof e !== 'object') return null
  const type = ['text', 'shape', 'image', 'table', 'embed'].includes(e.type) ? e.type : null
  if (!type) return null
  const s = cleanStyle(e.style)
  const d = e.data && typeof e.data === 'object' ? { ...e.data } : {}
  if (type === 'text') d.html = sanitizeRich(d.html)
  if (type === 'image') d.src = sanitizeImageSrc(d.src)
  if (type === 'embed') {
    d.url = sanitizeUrl(d.url)
    d.image = sanitizeImageSrc(d.image)
    d.embedUrl = sanitizeEmbedUrl(d.embedUrl)
    for (const k of ['title', 'description', 'siteName']) d[k] = str(d[k], 400)
  }
  if (type === 'table') d.rows = Array.isArray(d.rows) ? d.rows.slice(0, 60).map((r) => (Array.isArray(r) ? r.slice(0, 30).map((c) => str(String(c ?? ''), 2000)) : [''])) : [['']]
  if (typeof d.placeholder === 'string') d.placeholder = d.placeholder.slice(0, 200)
  return {
    id: str(String(e.id || ''), 64) || `e${i}${Math.random().toString(36).slice(2, 7)}`,
    type, role: typeof e.role === 'string' ? e.role.slice(0, 20) : undefined,
    x: num(e.x, 0), y: num(e.y, 0), w: Math.max(1, num(e.w, 100)), h: Math.max(1, num(e.h, 100)),
    rotate: num(e.rotate, 0), z: num(e.z, i + 1), locked: e.locked === true,
    group: typeof e.group === 'string' ? e.group.slice(0, 64) : undefined,
    name: typeof e.name === 'string' && e.name ? e.name.slice(0, 80) : undefined,
    hidden: e.hidden === true ? true : undefined,
    mid: typeof e.mid === 'string' && e.mid ? e.mid.slice(0, 64) : undefined,
    style: s, data: d,
    anim: e.anim && typeof e.anim === 'object' && ['fade', 'rise', 'zoom'].includes(e.anim.type) ? { type: e.anim.type, order: num(e.anim.order, 1) } : undefined,
  }
}

/** 불러온(또는 붙여넣은) 발표 내용을 안전한 모양으로 */
export function normalizeDeck(c) {
  const src = c && typeof c === 'object' ? c : {}
  const seen = new Set()
  const slides = (Array.isArray(src.slides) ? src.slides : []).slice(0, 300).map((s, si) => {
    let id = str(String(s?.id || ''), 64) || `s${si}${Math.random().toString(36).slice(2, 7)}`
    if (seen.has(id)) id = `${id.slice(0, 50)}${Math.random().toString(36).slice(2, 7)}`
    seen.add(id)
    const eseen = new Set()
    const elements = (Array.isArray(s?.elements) ? s.elements : []).map(cleanElement).filter(Boolean).map((e) => {
      if (eseen.has(e.id)) e.id = `${e.id.slice(0, 50)}${Math.random().toString(36).slice(2, 7)}`
      eseen.add(e.id)
      return e
    })
    const bg = s?.background && typeof s.background === 'object' ? { color: color(s.background.color), image: sanitizeImageSrc(s.background.image) || undefined, fit: s.background.fit === 'contain' ? 'contain' : undefined } : null
    if (bg && !bg.fit) delete bg.fit
    return {
      id, layout: str(s?.layout, 30) || 'blank', variant: num(s?.variant, 0),
      background: bg && (bg.color || bg.image) ? bg : null,
      notes: str(s?.notes, 20000), hidden: s?.hidden === true,
      transition: TRANSITIONS.includes(s?.transition) ? s.transition : 'none',
      ...(cleanStacks(s?.stacks) ? { stacks: cleanStacks(s.stacks) } : {}),
      elements,
    }
  })
  return { version: 1, theme: cleanTheme(src.theme), size: { w: SLIDE_W, h: SLIDE_H }, slides }
}
