// DAH 요소 ↔ 일반 HTML·글자. 구글 문서, 웹 페이지, 키노트, 메일 등 "서식 있는 글"을 받는 곳에 쓴다.
import { FONTS, SLIDE_W, resolveColor } from '../deckCore.js'
import { escapeAttr, escapeText, findAll, parseHtml, textOf } from './html.js'
import { dominant, htmlToParas, normColor, parasToHtml, parasToText } from './richText.js'

const PT_PER_PX = 720 / SLIDE_W // DAH px → pt (슬라이드 폭 720pt 기준)
const r1 = (n) => Math.round(n * 10) / 10

function cssFont(v, theme) {
  let key = v || '@body'
  if (key[0] === '@') key = theme?.fonts?.[key.slice(1)] || 'sans'
  const name = FONTS[key]?.office || String(key).replace(/[^\p{L}\p{N} _-]/gu, '')
  return `'${name}', sans-serif`
}

const col = (v, theme) => {
  const c = normColor(resolveColor(v, theme))
  return c ? c.slice(0, 7) : null
}

/** 글 요소 → 인라인 서식 HTML 문단들 */
function textHtml(el, theme) {
  const s = el.style || {}
  const paras = htmlToParas(el.data?.html || '', { pxScale: 1, baseSize: s.size || 36 })
  const baseColor = col(s.color || '@text', theme) || '#111111'
  const font = cssFont(s.font, theme)
  let out = ''
  let listOpen = null
  for (const p of paras) {
    const align = p.align || s.align || 'left'
    const lh = r1((p.lineHeight || s.lineHeight || 1.4))
    const runs = p.runs
      .map((r) => {
        const st = [
          `font-family:${font}`,
          `font-size:${r1((r.size || s.size || 36) * PT_PER_PX)}pt`,
          `color:${(r.color || '').slice(0, 7) || (r.href ? '#1155CC' : baseColor)}`,
          `font-weight:${r.bold || s.bold ? 700 : 400}`,
          `font-style:${r.italic || s.italic ? 'italic' : 'normal'}`,
        ]
        const deco = [r.underline || s.underline || r.href ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ')
        st.push(`text-decoration:${deco || 'none'}`)
        let h = `<span style="${st.join(';')}">${escapeText(r.text).replace(/\u000b/g, '<br>')}</span>`
        if (r.href && /^(https?:|mailto:)/i.test(r.href)) h = `<a href="${escapeAttr(r.href)}">${h}</a>`
        return h
      })
      .join('')
    const pStyle = `text-align:${align};line-height:${lh};margin:0`
    if (p.list) {
      const tag = p.list.ordered ? 'ol' : 'ul'
      if (listOpen !== tag) {
        if (listOpen) out += `</${listOpen}>`
        out += `<${tag} style="margin:0">`
        listOpen = tag
      }
      out += `<li style="${pStyle};margin-left:${(p.list.level || 0) * 24}px">${runs}</li>`
    } else {
      if (listOpen) out += `</${listOpen}>`
      listOpen = null
      out += `<p style="${pStyle}">${runs || '<br>'}</p>`
    }
  }
  if (listOpen) out += `</${listOpen}>`
  return out
}

function absUrl(src) {
  const s = String(src || '')
  if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s
  if (/^\/(?!\/)/.test(s) && typeof location !== 'undefined') return location.origin + s
  return ''
}

const readingOrder = (els) => [...els].filter((e) => e && !e.hidden).sort((a, b) => a.y - b.y || a.x - b.x)

/** DAH 요소들 → text/html (화면 960px 폭 기준 크기) */
export function elementsToHtml(elements, deck) {
  const theme = deck?.theme
  const parts = []
  for (const el of readingOrder(elements || [])) {
    if (el.type === 'text') {
      const h = textHtml(el, theme)
      if (h) parts.push(h)
    } else if (el.type === 'image') {
      const src = absUrl(el.data?.src)
      if (src) parts.push(`<p style="margin:0"><img src="${escapeAttr(src)}" alt="${escapeAttr(el.data?.alt || '')}" width="${Math.round(el.w / 2)}" height="${Math.round(el.h / 2)}"></p>`)
    } else if (el.type === 'table') {
      const s = el.style || {}
      const line = col(s.line || '@muted', theme) || '#999999'
      const rows = (el.data?.rows || [])
        .map((r, ri) => {
          const head = el.data?.header && ri === 0
          const cells = r.map((c) => {
            const st = `border:1px solid ${line};padding:4px 8px;font-size:${r1((s.size || 24) * PT_PER_PX)}pt;${head ? `background:${col(s.headerFill || '@accent', theme)};color:${col(s.headerColor || '@bg', theme)};font-weight:700` : `color:${col(s.color || '@text', theme)}`}`
            return `<${head ? 'th' : 'td'} style="${st}">${escapeText(c)}</${head ? 'th' : 'td'}>`
          })
          return `<tr>${cells.join('')}</tr>`
        })
        .join('')
      parts.push(`<table style="border-collapse:collapse">${rows}</table>`)
    } else if (el.type === 'embed') {
      const d = el.data || {}
      if (/^https?:\/\//i.test(d.url || '')) parts.push(`<p style="margin:0"><a href="${escapeAttr(d.url)}">${escapeText(d.title || d.url)}</a></p>`)
    }
  }
  if (!parts.length) return ''
  return `<meta charset="utf-8"><div>${parts.join('')}</div>`
}

/** DAH 요소들 → text/plain */
export function elementsToText(elements) {
  const out = []
  for (const el of readingOrder(elements || [])) {
    if (el.type === 'text') {
      const paras = htmlToParas(el.data?.html || '', { pxScale: 1 })
      let n = {}
      let kind = {}
      const lines = paras.map((p) => {
        const t = p.runs.map((r) => r.text).join('').replace(/\u000b/g, '\n')
        if (!p.list) {
          n = {}
          kind = {}
          return t
        }
        const k = p.list.level || 0
        if (kind[k] !== p.list.ordered) n[k] = 0
        kind[k] = p.list.ordered
        for (const j of Object.keys(n)) if (+j > k) n[j] = 0
        n[k] = (n[k] || 0) + 1
        return '  '.repeat(k) + (p.list.ordered ? `${n[k]}. ` : '- ') + t
      })
      const t = lines.join('\n').trim()
      if (t) out.push(t)
    } else if (el.type === 'table') {
      out.push((el.data?.rows || []).map((r) => r.join('\t')).join('\n'))
    } else if (el.type === 'embed' && el.data?.url) {
      out.push(el.data.title ? `${el.data.title}\n${el.data.url}` : el.data.url)
    } else if (el.type === 'image' && el.data?.alt) {
      out.push(el.data.alt)
    }
  }
  return out.join('\n\n')
}

const DEFAULT_DARK = new Set(['#000000', '#111111', '#1F1F1F', '#202124', '#212121', '#222222', '#333333', '#0D0D0D', '#1D1C1D', '#37352F', '#24292F', '#1F2328'])

/** 바깥 HTML(구글 문서, 웹, 키노트 등) → DAH 요소들. 알아볼 것이 없으면 null */
export function htmlToElements(html, opts = {}) {
  const root = parseHtml(html)
  const text = textOf(root).replace(/\s+/g, ' ').trim()
  const imgs = findAll(root, (n) => n.tag === 'img')
    .map((n) => ({ src: n.attrs.src || '', alt: n.attrs.alt || '', w: parseInt(n.attrs.width, 10) || 0, h: parseInt(n.attrs.height, 10) || 0 }))
    .filter((i) => /^https?:\/\//i.test(i.src) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(i.src))
  const out = []
  if (!text) {
    for (const i of imgs.slice(0, 20)) {
      const k = i.w && i.h ? Math.min(1200 / i.w, 760 / i.h, 2) : 1
      const w = i.w && i.h ? Math.round(i.w * k) : 800
      const h = i.w && i.h ? Math.round(i.h * k) : 450
      out.push({ type: 'image', x: 0, y: 0, w, h, rotate: 0, style: { fit: 'cover', posX: 50, posY: 50, radius: 0 }, data: { src: i.src, alt: i.alt.slice(0, 300), placeholder: '' } })
    }
    return out.length ? out : null
  }
  const paras = htmlToParas(html, { pxScale: 2, baseSize: opts.baseSize || 36 })
  if (!paras.length) return null
  const domSize = dominant(paras, 'size') || opts.baseSize || 36
  const domColor = dominant(paras, 'color')
  const allBold = paras.every((p) => p.runs.every((r) => r.bold))
  const allItalic = paras.every((p) => p.runs.every((r) => r.italic))
  // 문서의 기본 검정 글자는 테마 글자색으로 둔다(어두운 테마에서도 보이게)
  const themed = !domColor || DEFAULT_DARK.has(domColor.slice(0, 7))
  const base = { bold: allBold, italic: allItalic, underline: false, color: domColor, size: domSize }
  const cleaned = paras.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, color: r.color && themed && DEFAULT_DARK.has(r.color.slice(0, 7)) ? null : r.color })) }))
  const html2 = parasToHtml(cleaned, themed ? { ...base, color: null } : base)
  const align = paras[0].align && paras.every((p) => (p.align || 'left') === paras[0].align) ? paras[0].align : 'left'
  const plain = parasToText(paras)
  const lines = plain.split('\n')
  const longest = Math.max(...lines.map((l) => l.length))
  const w = Math.round(Math.min(1600, Math.max(480, longest * domSize * 0.62 + 40)))
  const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * domSize * 0.62) / (w - 40))), 0)
  const h = Math.round(Math.min(960, Math.max(domSize * 1.6, wrapped * domSize * 1.4 + 32)))
  out.push({
    type: 'text', x: 0, y: 0, w, h, rotate: 0,
    style: { font: '@body', size: domSize, color: themed ? '@text' : domColor, align, valign: 'top', lineHeight: 1.4, bold: allBold, italic: allItalic, underline: false, fill: null, autofit: true },
    data: { html: html2, placeholder: '' },
  })
  return out
}
