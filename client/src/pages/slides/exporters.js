// 내보내기: 화면 밖에 1920x1080으로 그린 슬라이드를 html2canvas로 찍어 PDF·PNG·한글(HWPX)로 만든다. PPTX는 pptx.js.
import { API_BASE } from '../../hooks/useApi'
import { plainText } from './sanitize'

export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const safeName = (s) => String(s || '발표').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || '발표'

async function waitImages(node) {
  const imgs = [...node.querySelectorAll('img')]
  await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 6000) }))))
  if (document.fonts?.ready) await document.fonts.ready
}

/** 슬라이드 노드(.sl-slide, 1920x1080) → canvas */
export async function capture(node, scale = 1) {
  const { default: html2canvas } = await import('html2canvas')
  await waitImages(node)
  return html2canvas(node, { scale, useCORS: true, backgroundColor: null, logging: false, width: 1920, height: 1080, windowWidth: 1920, windowHeight: 1080, x: 0, y: 0, scrollX: 0, scrollY: 0 })
}

export async function exportPdf(nodes, title, onProgress) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1920, 1080], hotfixes: ['px_scaling'], compress: true })
  for (let i = 0; i < nodes.length; i++) {
    onProgress?.(i, nodes.length)
    const c = await capture(nodes[i], 1)
    if (i > 0) pdf.addPage([1920, 1080], 'landscape')
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 1920, 1080, undefined, 'FAST')
  }
  download(pdf.output('blob'), `${safeName(title)}.pdf`)
}

export async function exportPng(node, name) {
  const c = await capture(node, 1)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  download(blob, `${safeName(name)}.png`)
}

/** 요소 하나를 그림으로(아이콘·링크 카드 → PPTX). 배경은 투명 */
export async function rasterizeNode(node, scale = 2) {
  if (!node) return null
  const svg = node.querySelector(':scope > svg')
  if (svg && node.classList.contains('sl-el--shape')) {
    // 아이콘: SVG를 그대로 그림으로
    const w = node.offsetWidth
    const h = node.offsetHeight
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', w * scale)
    clone.setAttribute('height', h * scale)
    clone.removeAttribute('style')
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
    const img = new Image()
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url })
    const c = document.createElement('canvas')
    c.width = w * scale
    c.height = h * scale
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  }
  const { default: html2canvas } = await import('html2canvas')
  const prev = node.style.transform
  node.style.transform = 'none'
  try {
    const c = await html2canvas(node, { scale, useCORS: true, backgroundColor: null, logging: false })
    return c.toDataURL('image/png')
  } finally {
    node.style.transform = prev
  }
}

function titleOf(slide) {
  const t = slide.elements.find((e) => e.role === 'title' && e.type === 'text') || slide.elements.find((e) => e.type === 'text' && e.role !== 'deco')
  return t ? plainText(t.data?.html).split('\n')[0].slice(0, 80) : ''
}

/**
 * 한글(HWPX): 슬라이드마다 그림 한 장 + 발표자 노트. 서버 상한(전체 2MB, 그림 20장)에 맞춰 크기를 줄인다.
 * 반환: { ok: true } | { ok: false, status, message }
 */
export async function exportHwpx(nodes, slides, title, onProgress) {
  const MAX_IMAGES = 20
  const images = []
  let width = 960
  let quality = 0.78
  const md = [`# ${title}`, '']
  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i, slides.length)
    const s = slides[i]
    const t = titleOf(s)
    md.push(`## ${i + 1}. ${t || `슬라이드 ${i + 1}`}`, '')
    if (i < MAX_IMAGES) {
      const c = await capture(nodes[i], width / 1920)
      let url = c.toDataURL('image/jpeg', quality)
      const used = images.reduce((a, b) => a + b.dataUrl.length, 0)
      const left = Math.max(1, Math.min(MAX_IMAGES, slides.length) - i)
      if (used + url.length * left > 1_600_000) {
        // 남은 장수까지 2MB 안에 들도록 줄인다
        width = Math.max(560, Math.round(width * 0.8))
        quality = Math.max(0.55, quality - 0.08)
        const c2 = await capture(nodes[i], width / 1920)
        url = c2.toDataURL('image/jpeg', quality)
      }
      const name = `slide-${i + 1}.jpg`
      images.push({ name, dataUrl: url })
      md.push(`![슬라이드 ${i + 1}](${name})`, '')
    } else {
      const text = s.elements.filter((e) => e.type === 'text' && e.role !== 'deco').map((e) => plainText(e.data?.html)).filter(Boolean).join('\n')
      if (text) md.push(...text.split('\n').map((l) => `- ${l}`), '')
    }
    const notes = String(s.notes || '').trim()
    if (notes) md.push('> 발표자 노트', '', ...notes.split(/\r?\n/).filter(Boolean).map((l) => `- ${l}`), '')
  }
  onProgress?.(slides.length, slides.length)
  let res
  try {
    res = await fetch(`${API_BASE}/hwpx/generate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: safeName(title), preset: '보고서', markdown: md.join('\n'), images }),
    })
  } catch {
    return { ok: false, status: 0, message: '서버에 연결하지 못했습니다.' }
  }
  if (res.status === 404) return { ok: false, status: 404, message: '한글 내보내기는 아직 준비 중입니다. PDF나 PPTX로 내보내 주세요.' }
  if (res.status === 401) return { ok: false, status: 401, message: '한글로 내보내려면 로그인하세요.' }
  if (res.status === 413) return { ok: false, status: 413, message: '슬라이드가 많아 한글 파일로 만들지 못했습니다. 슬라이드를 나누어 내보내 주세요.' }
  if (!res.ok) {
    let msg = ''
    try {
      const j = await res.json()
      msg = j?.error?.message || j?.error || ''
    } catch {
      msg = ''
    }
    return { ok: false, status: res.status, message: `한글 파일을 만들지 못했습니다. ${msg}`.trim() }
  }
  download(await res.blob(), `${safeName(title)}.hwpx`)
  return { ok: true, truncated: slides.length > MAX_IMAGES }
}
