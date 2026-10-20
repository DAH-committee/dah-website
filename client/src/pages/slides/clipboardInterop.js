// 외부 앱(구글 슬라이드, 키노트, 구글 문서, 웹)과 주고받는 클립보드.
// 계약
// - writeExternalClipboard(dataTransfer, ctx): copy/cut 이벤트 안에서 동기로 호출. 외부 앱용 형식을 더 싣고 true/false 반환.
//   ctx = { elements, slide, deck } (elements는 선택된 요소, 좌표는 1920x1080 기준)
//   싣는 형식: 구글 슬라이드 고유 형식(편집 가능한 도형·글 상자·그림으로 붙는다), text/html(서식·링크), text/plain
//   편집기 자체 형식(application/x-dah-slides+json)은 편집기가 싣는다. 여기서는 건드리지 않는다.
// - readExternalClipboard(dataTransfer, ctx): paste 이벤트 안에서 동기로 호출. 외부 앱 형식을 읽어
//   { elements, source: 'gslides'|'html'|'rtf', positioned } 또는 null 반환.
//   positioned가 true면 원래 슬라이드 자리(1920x1080 환산)를 그대로 쓸 수 있다. false면 편집기가 자리를 정한다.
//   elements에는 id·z가 없다. 묶음(group) 값은 붙여 넣을 때 새 값으로 바꿔 쓴다.
// - copySelectionAsImage(ctx): 선택을 PNG로 클립보드에 쓰는 비동기 함수(메뉴 "이미지로 복사"). ctx.node = 슬라이드 DOM(.sl-slide 또는 그 조상)
// 조사 기록과 형식 설명: interop/README.md
import { GSLIDES_TYPE, decodeGSlides, encodeGSlides } from './interop/gslides.js'
import { elementsToHtml, elementsToText, htmlToElements } from './interop/htmlio.js'
import { rtfToHtml } from './interop/rtf.js'
import { sanitizeImageSrc, sanitizeRich } from './sanitize'

export const DAH_CLIP_TYPE = 'application/x-dah-slides+json'
export { GSLIDES_TYPE }

/** 복사할 외부 형식을 만든다(이벤트 없이도 쓸 수 있게). { [type]: string } */
export function buildExternalPayload({ elements, deck } = {}, opts = {}) {
  const out = {}
  const els = (elements || []).filter(Boolean)
  if (!els.length) return out
  if (opts.native !== false) {
    try {
      const g = encodeGSlides(els, deck, opts)
      if (g) out[GSLIDES_TYPE] = g
    } catch {
      /* 구글 형식을 못 만들면 HTML만 싣는다 */
    }
  }
  try {
    const html = elementsToHtml(els, deck)
    if (html) out['text/html'] = html
  } catch {
    /* 무시 */
  }
  try {
    const txt = elementsToText(els)
    if (txt) out['text/plain'] = txt
  } catch {
    /* 무시 */
  }
  return out
}

export function writeExternalClipboard(dataTransfer, ctx = {}) {
  if (!dataTransfer || typeof dataTransfer.setData !== 'function') return false
  const payload = buildExternalPayload(ctx, ctx.options)
  let n = 0
  for (const [type, value] of Object.entries(payload)) {
    try {
      dataTransfer.setData(type, value)
      n++
    } catch {
      /* 일부 형식을 못 실어도 나머지는 싣는다 */
    }
  }
  return n > 0
}

function finish(el) {
  const base = { rotate: 0, locked: false, ...el }
  if (base.type === 'text') base.data = { ...base.data, html: sanitizeRich(base.data?.html || ''), placeholder: '' }
  if (base.type === 'image') {
    const src = sanitizeImageSrc(base.data?.src)
    if (!src) return null
    base.data = { ...base.data, src }
  }
  for (const k of ['x', 'y', 'w', 'h', 'rotate']) base[k] = Number.isFinite(base[k]) ? base[k] : 0
  base.w = Math.max(1, base.w)
  base.h = Math.max(1, base.h)
  return base
}

const safeGet = (dt, t) => {
  try {
    return dt.getData(t) || ''
  } catch {
    return ''
  }
}

export function readExternalClipboard(dataTransfer, ctx = {}) {
  if (!dataTransfer) return null
  const types = [...(dataTransfer.types || [])]
  if (types.includes(DAH_CLIP_TYPE)) return null // 편집기 자체 형식이 먼저
  // 1) 구글 슬라이드(또는 구글 그림) 도형
  if (types.includes(GSLIDES_TYPE)) {
    const els = decodeGSlides(safeGet(dataTransfer, GSLIDES_TYPE))
    const list = (els || []).map(finish).filter(Boolean)
    if (list.length) return { elements: list, source: 'gslides', positioned: true }
  }
  const plain = safeGet(dataTransfer, 'text/plain').trim()
  // 주소 하나만 복사했으면 편집기가 링크 카드·그림으로 만든다
  if (/^https?:\/\/\S+$/i.test(plain) && !/\s/.test(plain)) return null
  const baseSize = ctx.baseSize || 36
  // 2) 서식 있는 HTML(구글 문서, 슬라이드 글 일부, 웹, 메일)
  if (types.includes('text/html')) {
    const html = safeGet(dataTransfer, 'text/html')
    if (html) {
      const els = htmlToElements(html, { baseSize })
      const list = (els || []).map(finish).filter(Boolean)
      if (list.length) return { elements: list, source: 'html', positioned: false }
    }
  }
  // 3) RTF(키노트·페이지스·텍스트 편집기)
  if (types.includes('text/rtf')) {
    const html = rtfToHtml(safeGet(dataTransfer, 'text/rtf'))
    if (html) {
      const list = (htmlToElements(html, { baseSize }) || []).map(finish).filter(Boolean)
      if (list.length) return { elements: list, source: 'rtf', positioned: false }
    }
  }
  return null
}

// ── 이미지로 복사 ───────────────────────────────────────

function unionBox(elements) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const e of elements) {
    const r = ((e.rotate || 0) * Math.PI) / 180
    const c = Math.abs(Math.cos(r))
    const s = Math.abs(Math.sin(r))
    const w = e.w * c + e.h * s
    const h = e.w * s + e.h * c
    const cx = e.x + e.w / 2
    const cy = e.y + e.h / 2
    x0 = Math.min(x0, cx - w / 2)
    y0 = Math.min(y0, cy - h / 2)
    x1 = Math.max(x1, cx + w / 2)
    y1 = Math.max(y1, cy + h / 2)
  }
  const pad = 8
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2), h: Math.ceil(y1 - y0 + pad * 2) }
}

async function renderPng({ elements, node }) {
  const slideNode = node?.classList?.contains('sl-slide') ? node : node?.querySelector?.('.sl-slide')
  if (!slideNode) throw new Error('no slide node')
  const ids = new Set(elements.map((e) => e.id))
  const box = unionBox(elements)
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-20000px;top:0;width:1920px;height:1080px;overflow:hidden;pointer-events:none;'
  const clone = slideNode.cloneNode(true)
  clone.style.transform = 'none'
  clone.style.background = 'transparent'
  clone.style.backgroundImage = 'none'
  for (const child of [...clone.children]) {
    const id = child.getAttribute('data-el')
    if (!id || !ids.has(id)) child.remove()
  }
  holder.appendChild(clone)
  document.body.appendChild(holder)
  try {
    const { default: html2canvas } = await import('html2canvas')
    const scale = Math.max(1, Math.min(3, 3000 / Math.max(box.w, box.h)))
    const full = await html2canvas(clone, { scale, useCORS: true, backgroundColor: null, logging: false, width: 1920, height: 1080, windowWidth: 1920, windowHeight: 1080 })
    const k = full.width / 1920
    const out = document.createElement('canvas')
    const bx = Math.max(0, box.x)
    const by = Math.max(0, box.y)
    const bw = Math.min(1920 - bx, box.w)
    const bh = Math.min(1080 - by, box.h)
    out.width = Math.max(1, Math.round(bw * k))
    out.height = Math.max(1, Math.round(bh * k))
    out.getContext('2d').drawImage(full, bx * k, by * k, bw * k, bh * k, 0, 0, out.width, out.height)
    return await new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'))
  } finally {
    holder.remove()
  }
}

/**
 * 선택을 PNG로 클립보드에 쓴다. 키노트·피그마·메신저처럼 그림만 받는 곳에 붙여 넣을 때 쓴다.
 * 사용자 동작(클릭·단축키) 안에서 바로 불러야 한다. 그림은 약속(Promise)으로 넘겨 사용자 동작이 끊기지 않게 한다.
 * withHtml이 true면 HTML도 싣는다(구글 슬라이드는 HTML이 있으면 그림보다 HTML을 먼저 쓴다).
 */
export async function copySelectionAsImage({ elements, deck, node, withHtml = false } = {}) {
  const els = (elements || []).filter(Boolean)
  if (!els.length || typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
  try {
    const png = renderPng({ elements: els, node })
    const item = { 'image/png': png }
    if (withHtml) {
      const html = elementsToHtml(els, deck)
      if (html) item['text/html'] = new Blob([html], { type: 'text/html' })
    }
    await navigator.clipboard.write([new ClipboardItem(item)])
    return true
  } catch {
    return false
  }
}
