// 보드 내보내기: 캔버스·프레임을 그림으로 찍고(html2canvas) PNG, PDF(jspdf), 한글(HWPX, 서버 변환), DAH Slides로 보낸다.
// 그림은 화면의 캔버스(.bd-stage)를 복제한 문서에서 찍는다. 복제본에서 화면 위치를 찍을 영역으로 옮기고 떠 있는 도구는 숨긴다.
// 영상·임베드(iframe)는 그림에 담기지 않아 회색 자리로 바꾼다.
import { API_BASE, api } from '../../hooks/useApi'
import { plainText } from './sanitize'
import { boundsOf, rectInside } from './geometry'

const MAX_SIDE = 8000

/** 영역(세계 좌표)을 캔버스로 찍는다 */
export async function captureRegion(stageEl, rect, { scale = 2, background = '#ffffff' } = {}) {
  const { default: html2canvas } = await import('html2canvas')
  const w = Math.max(1, Math.ceil(rect.w))
  const h = Math.max(1, Math.ceil(rect.h))
  const s = Math.min(scale, MAX_SIDE / Math.max(w, h))
  return html2canvas(stageEl, {
    backgroundColor: background,
    scale: s,
    useCORS: true,
    logging: false,
    width: w,
    height: h,
    x: 0,
    y: 0,
    scrollX: 0,
    scrollY: 0,
    windowWidth: w,
    windowHeight: h,
    onclone: (doc) => {
      const st = doc.querySelector('.bd-stage')
      if (!st) return
      Object.assign(st.style, { position: 'fixed', left: '0px', top: '0px', width: `${w}px`, height: `${h}px`, flex: 'none', background: background, backgroundImage: 'none', zIndex: '99999' })
      const world = st.querySelector('.bd-world')
      if (world) world.style.transform = `translate(${-rect.x}px, ${-rect.y}px) scale(1)`
      st.querySelectorAll('.bd-floating, .bd-handle, .bd-resize, .bd-cpin, .bd-lock, .bd-marquee, .bd-guide, .bd-mini, .bd-empty-hint').forEach((n) => n.remove())
      st.querySelectorAll('.bd-empty').forEach((n) => (n.textContent = ''))
      st.querySelectorAll('.bd-frame__label').forEach((n) => Object.assign(n.style, { transform: 'none', maxWidth: 'none' }))
      st.querySelectorAll('.is-selected, .is-hit, .is-hit-current').forEach((n) => n.classList.remove('is-selected', 'is-hit', 'is-hit-current'))
      st.querySelectorAll('iframe').forEach((f) => {
        const ph = doc.createElement('div')
        ph.className = 'bd-iframe-ph'
        ph.textContent = '미리보기는 보드에서 볼 수 있습니다'
        f.replaceWith(ph)
      })
    },
  })
}

export const safeName = (s) => String(s || '보드').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)

export function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const toBlob = (canvas, type = 'image/png', q) => new Promise((res) => canvas.toBlob((b) => res(b), type, q))

/** 프레임을 발표 순서로 */
export function framesOf(items) {
  return items.filter((i) => i.type === 'frame').sort((a, b) => (a.data.order || 0) - (b.data.order || 0) || a.y - b.y || a.x - b.x)
}

/** 찍을 영역 목록: 선택한 프레임, 아니면 모든 프레임, 아니면 캔버스 전체 */
export function regionsOf(items, { frameId = null, preferFrames = true } = {}) {
  if (frameId) {
    const f = items.find((i) => i.id === frameId)
    return f ? [{ name: f.data.name || '프레임', rect: f, frame: f }] : []
  }
  const frames = preferFrames ? framesOf(items) : []
  if (frames.length) return frames.map((f, i) => ({ name: f.data.name || `프레임 ${i + 1}`, rect: f, frame: f }))
  const b = boundsOf(items)
  if (!b) return []
  const pad = 40
  return [{ name: '캔버스', rect: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, frame: null }]
}

export async function exportPng(stageEl, region, title) {
  const canvas = await captureRegion(stageEl, region.rect, { scale: 2 })
  const blob = await toBlob(canvas)
  download(blob, `${safeName(title)}${region.frame ? `_${safeName(region.name)}` : ''}.png`)
}

export async function exportPdf(stageEl, regions, title) {
  const { jsPDF } = await import('jspdf')
  let pdf = null
  for (const r of regions) {
    const canvas = await captureRegion(stageEl, r.rect, { scale: 2 })
    const wpt = r.rect.w * 0.75
    const hpt = r.rect.h * 0.75
    const orient = wpt >= hpt ? 'landscape' : 'portrait'
    if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [wpt, hpt], compress: true })
    else pdf.addPage([wpt, hpt], orient)
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, wpt, hpt)
  }
  if (pdf) download(pdf.output('blob'), `${safeName(title)}.pdf`)
}

/** 항목 글자(한글 문서 목록에 쓰는 한 줄) */
export function itemLine(it) {
  const d = it.data || {}
  if (it.type === 'memo') return plainText(d.html)
  if (it.type === 'sticky' || it.type === 'shape' || it.type === 'text' || it.type === 'keyword') return (d.text || '').replace(/\s+/g, ' ').trim()
  if (it.type === 'link') return d.title && d.url ? `${d.title} (${d.url})` : d.url || ''
  if (it.type === 'video') return d.url || ''
  if (it.type === 'file') return d.title ? `${d.title} (우리 파일)` : ''
  if (it.type === 'image') return d.alt ? `그림: ${d.alt}` : ''
  return ''
}

const byReading = (a, b) => a.y - b.y || a.x - b.x

/** 캔버스 글을 마크다운으로: 프레임마다 그림 한 장과 글 목록, 프레임 밖 글은 따로 */
export function canvasMarkdown(canvas, images) {
  const out = [`## ${canvas.name}`, '']
  const frames = framesOf(canvas.items)
  const used = new Set()
  const lines = (list) => list.sort(byReading).map(itemLine).filter(Boolean).map((t) => `- ${t.replace(/\n/g, ' ')}`)
  for (const f of frames) {
    out.push(`### ${f.data.name || '프레임'}`, '')
    const img = images.find((x) => x.frameId === f.id)
    if (img) out.push(`![${f.data.name || '프레임'}](${img.name})`, '')
    const inside = canvas.items.filter((i) => i.type !== 'frame' && i.type !== 'stroke' && rectInside(i, f))
    inside.forEach((i) => used.add(i.id))
    const ls = lines(inside)
    if (ls.length) out.push(...ls, '')
  }
  const rest = canvas.items.filter((i) => i.type !== 'frame' && i.type !== 'stroke' && !used.has(i.id))
  if (!frames.length) {
    const img = images.find((x) => x.frameId === null)
    if (img) out.push(`![${canvas.name}](${img.name})`, '')
  }
  const ls = lines(rest)
  if (ls.length) out.push(frames.length ? '### 프레임 밖' : '', ...ls, '')
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}

export class ExportError extends Error {}

/** 캔버스를 JPEG 데이터 주소로. 글자 수가 budget을 넘으면 줄여서 다시 만든다 */
function jpegWithin(canvas, budget) {
  let url = canvas.toDataURL('image/jpeg', 0.85)
  let src = canvas
  for (let i = 0; i < 4 && url.length > budget; i++) {
    const f = Math.max(0.35, Math.sqrt(budget / url.length) * 0.92)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(src.width * f))
    c.height = Math.max(1, Math.round(src.height * f))
    const g = c.getContext('2d')
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(src, 0, 0, c.width, c.height)
    src = c
    url = c.toDataURL('image/jpeg', 0.8)
  }
  return url
}

const HWPX_MAX_IMAGES = 20 // 서버 계약: 그림 20장까지
const HWPX_IMAGE_BUDGET = 1600000 // 요청 전체 2MB(express.json 상한) 안에 들도록 그림 글자 수 합계

/** 한글(HWPX): 그림 + 글 목록을 서버(POST /hwpx/generate)로 보내 파일을 받는다 */
export async function exportHwpx(stageEl, canvas, title, regions) {
  const images = []
  let n = 0
  const list = regions.slice(0, HWPX_MAX_IMAGES)
  const each = Math.floor(HWPX_IMAGE_BUDGET / Math.max(1, list.length))
  for (const r of list) {
    const shot = await captureRegion(stageEl, r.rect, { scale: Math.min(1.5, 1800 / Math.max(r.rect.w, r.rect.h, 1)) })
    images.push({ name: `board-${++n}.jpg`, dataUrl: jpegWithin(shot, each), frameId: r.frame ? r.frame.id : null })
  }
  const markdown = `# ${title}\n\n${canvasMarkdown(canvas, images)}`
  const body = JSON.stringify({ title, preset: '보고서', markdown, images: images.map(({ name, dataUrl }) => ({ name, dataUrl })) })
  let res
  try {
    res = await fetch(`${API_BASE}/hwpx/generate`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body })
  } catch {
    throw new ExportError('서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요')
  }
  if (res.status === 404) throw new ExportError('한글 내보내기를 아직 쓸 수 없습니다. PNG나 PDF로 내보내 주세요')
  if (res.status === 413) throw new ExportError('그림이 너무 커서 보내지 못했습니다. 프레임 하나를 골라 내보내 주세요')
  if (res.status === 401 || res.status === 403) throw new ExportError('로그인하면 한글 파일로 내보낼 수 있습니다')
  if (res.status === 503) throw new ExportError('한글 변환 엔진이 아직 준비되지 않았습니다. PNG나 PDF로 내보내 주세요')
  if (!res.ok) {
    let msg = ''
    try {
      const j = await res.json()
      msg = typeof j?.error === 'string' ? j.error : j?.error?.message || ''
    } catch {
      /* 본문 없음 */
    }
    throw new ExportError(`한글 파일을 만들지 못했습니다 (${res.status}${msg ? `, ${msg}` : ''})`)
  }
  download(await res.blob(), `${safeName(title)}.hwpx`)
}

/** 보드를 발표로: 프레임마다 그림을 올리고 DAH Slides 파일을 만든다. 반환: 새 파일 id */
export async function boardToSlides(stageEl, frames, title, onStep) {
  const slides = []
  let i = 0
  for (const f of frames) {
    onStep?.(++i, frames.length)
    const shot = await captureRegion(stageEl, f, { scale: Math.min(2, 1920 / Math.max(f.w, 1)) * 1 })
    const blob = await toBlob(shot)
    const file = new File([blob], `${safeName(f.data.name || `frame-${i}`)}.png`, { type: 'image/png' })
    const up = await api.upload(file, { usage: 'general' })
    if (!up?.url) throw new ExportError('그림을 올리지 못했습니다')
    // 1920x1080 안에 비율을 지켜 가운데 놓는다
    const s = Math.min(1920 / f.w, 1080 / f.h)
    const w = Math.round(f.w * s)
    const h = Math.round(f.h * s)
    slides.push({
      id: `s${Date.now().toString(36)}${i}`,
      layout: 'blank',
      background: { color: '#ffffff' },
      notes: f.data.name || '',
      elements: [{ id: `e${Date.now().toString(36)}${i}`, type: 'image', x: Math.round((1920 - w) / 2), y: Math.round((1080 - h) / 2), w, h, z: 1, data: { src: up.url } }],
    })
  }
  let created
  try {
    created = await api.post('/workspace/files', { kind: 'slide', template: 'blank' })
  } catch (e) {
    if (e.status === 400 || e.status === 404) throw new ExportError('DAH Slides를 아직 쓸 수 없습니다')
    throw e
  }
  const id = created?.item?.id
  if (!id) throw new ExportError('DAH Slides를 아직 쓸 수 없습니다')
  try {
    await api.put(`/workspace/files/${id}`, { title })
  } catch {
    /* 이름은 나중에 바꿀 수 있다 */
  }
  try {
    await api.put(`/workspace/slides/${id}`, { content: { version: 1, size: { w: 1920, h: 1080 }, theme: {}, slides } })
  } catch (e) {
    if (e.status === 404) throw new ExportError('DAH Slides를 아직 쓸 수 없습니다')
    throw e
  }
  return id
}
