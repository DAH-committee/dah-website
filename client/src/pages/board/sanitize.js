// 보드 내용 거르기: 메모 HTML, 주소(http/https만), 영상 주소, 불러온 JSON 정리.
// sanitizeUrl은 KnotPad(js/utils.js)의 규칙을 그대로 옮겼다(스킴 없는 주소는 https로 올리고 그 밖의 스킴은 버린다).
// 메모 HTML은 KnotPad의 "위험한 것만 빼기" 대신 "허용한 태그만 남기기"로 더 좁혔다. 속성은 링크 주소 하나만 남는다.

export function sanitizeUrl(u) {
  if (!u) return ''
  let c = String(u).trim()
  if (!/^https?:\/\//i.test(c)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(c)) return ''
    c = 'https://' + c
  }
  try {
    const p = new URL(c)
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : ''
  } catch {
    return ''
  }
}

/** 이미지 주소: http/https 또는 같은 사이트 경로(/uploads/...)만 */
export function sanitizeImageSrc(u) {
  const s = String(u || '').trim()
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s
  return /^https?:\/\//i.test(s) ? sanitizeUrl(s) : ''
}

export function hostnameOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const KEEP = new Set(['P', 'BR', 'DIV', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'A', 'S', 'BLOCKQUOTE'])
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'AUDIO', 'VIDEO', 'SOURCE', 'IMG', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'HEAD', 'FRAME', 'FRAMESET'])

/** 메모 HTML을 허용 목록으로 거른다. 모르는 태그는 글자만 남기고, 위험한 태그는 통째로 지운다 */
export function sanitizeMemoHtml(html) {
  if (!html) return ''
  if (typeof document === 'undefined') return String(html).replace(/<[^>]*>/g, '')
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = document.createElement('div')
  const walk = (src, dst) => {
    for (const node of [...src.childNodes]) {
      if (node.nodeType === 3) {
        dst.appendChild(document.createTextNode(node.nodeValue))
        continue
      }
      if (node.nodeType !== 1) continue
      const tag = node.tagName.toUpperCase()
      if (DROP.has(tag)) continue
      // 모르는 태그, 그리고 목록·문단을 품은 제목(편집 중 생기는 잘못된 중첩)은 껍데기만 벗긴다
      if (!KEEP.has(tag) || ((tag === 'H2' || tag === 'H3') && node.querySelector('ul, ol, p, div, h2, h3, blockquote'))) {
        walk(node, dst)
        continue
      }
      const el = document.createElement(tag === 'STRONG' ? 'b' : tag === 'EM' ? 'i' : tag.toLowerCase())
      if (tag === 'A') {
        const href = sanitizeUrl(node.getAttribute('href'))
        if (href) {
          el.setAttribute('href', href)
          el.setAttribute('target', '_blank')
          el.setAttribute('rel', 'noopener noreferrer nofollow')
        }
      }
      walk(node, el)
      dst.appendChild(el)
    }
  }
  walk(doc.body, out)
  return out.innerHTML
}

export function plainText(html) {
  if (!html) return ''
  if (typeof document === 'undefined') return String(html).replace(/<[^>]*>/g, ' ')
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

/** 유튜브·비메오 주소를 공식 임베드 주소로 바꾼다. 못 알아보면 null */
export function parseVideo(raw) {
  const url = sanitizeUrl(raw)
  if (!url) return null
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m)\./, '')
  let yt = null
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') yt = u.searchParams.get('v')
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
      if (m) yt = m[1]
    }
  }
  if (yt && /^[A-Za-z0-9_-]{6,20}$/.test(yt)) {
    const t = parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '0', 10)
    return { provider: 'youtube', id: yt, url, embed: `https://www.youtube-nocookie.com/embed/${yt}${t > 0 ? `?start=${t}` : ''}` }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(?:^|\/)(\d{6,12})(?:\/|$)/)
    if (m) return { provider: 'vimeo', id: m[1], url, embed: `https://player.vimeo.com/video/${m[1]}` }
  }
  return null
}

// ── 내용 모양(version 2) ───────────────────────────────────────────
// version 1: { version: 1, viewport?, items, connections }
// version 2: { version: 2, active?: canvasId, canvases: [{ id, name, viewport?, items, connections, comments }] }
// version 1은 캔버스 하나("캔버스 1")짜리 version 2로 옮긴다(migrateV1).
export const ITEM_TYPES = ['memo', 'keyword', 'link', 'image', 'video', 'file', 'sticky', 'shape', 'text', 'stroke', 'frame']
export const ARROWS = ['none', 'end', 'both']
export const CONN_STYLES = ['curve', 'straight', 'elbow']
export const SHAPES = ['rect', 'rounded', 'ellipse', 'diamond', 'triangle', 'arrow']
export const COLOR_IDS = ['purple', 'yellow', 'amber', 'red', 'green', 'black', 'gray']
export const FILE_KINDS = ['doc', 'sheet', 'form', 'slide', 'board']
export const LINK_KINDS = ['figma', 'notion', 'youtube', 'link']
export const MAX_ITEMS = 5000 // 모든 캔버스를 합친 항목 수
export const MAX_CANVASES = 50
export const MAX_STROKE_POINTS = 2000 // 펜 획 하나의 점 수(좌표 4000개)
export const MAX_COMMENTS = 1000 // 캔버스 하나의 댓글 수

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const posInt = (v) => {
  const n = parseInt(v, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 미리보기 임베드 주소: https이고 figma.com 주소만 iframe으로 띄운다 */
export function sanitizeEmbedUrl(u) {
  const s = sanitizeUrl(u)
  if (!s || !s.startsWith('https://')) return ''
  const host = hostnameOf(s)
  return host === 'figma.com' || host.endsWith('.figma.com') ? s : ''
}

/** 항목 하나의 data를 종류에 맞게 정리한다 */
export function cleanData(type, d = {}) {
  d = d && typeof d === 'object' ? d : {}
  if (type === 'memo') return { html: sanitizeMemoHtml(str(d.html, 100000)) }
  if (type === 'keyword') return { text: str(d.text, 200) }
  if (type === 'link') {
    const url = sanitizeUrl(d.url)
    const out = { url, title: str(d.title, 300) || hostnameOf(url) }
    if (d.description) out.description = str(d.description, 600)
    const image = sanitizeImageSrc(d.image)
    if (image) out.image = image
    if (d.siteName) out.siteName = str(d.siteName, 100)
    if (LINK_KINDS.includes(d.kind)) out.kind = d.kind
    const embed = sanitizeEmbedUrl(d.embedUrl)
    if (embed) out.embedUrl = embed
    return out
  }
  if (type === 'image') return { src: sanitizeImageSrc(d.src), alt: str(d.alt, 300) }
  if (type === 'video') {
    const v = parseVideo(d.url)
    return v ? { url: v.url, provider: v.provider, vid: v.id, title: str(d.title, 300) } : { url: '', provider: '', vid: '', title: str(d.title, 300) }
  }
  if (type === 'file') {
    const kind = FILE_KINDS.includes(d.kind) ? d.kind : 'doc'
    return { kind, fileId: posInt(d.fileId), tabId: posInt(d.tabId), title: str(d.title, 300) || '제목 없음' }
  }
  if (type === 'sticky') return { text: str(d.text, 4000) }
  if (type === 'shape') return { shape: SHAPES.includes(d.shape) ? d.shape : 'rect', text: str(d.text, 4000) }
  if (type === 'text') return { text: str(d.text, 10000), size: Math.min(Math.max(Math.round(num(d.size, 18)), 10), 160), bold: d.bold === true }
  if (type === 'frame') return { name: str(d.name, 100), order: num(d.order, 0) }
  if (type === 'stroke') {
    const pts = Array.isArray(d.points) ? d.points : []
    const out = []
    for (let i = 0; i + 1 < pts.length && out.length < MAX_STROKE_POINTS * 2; i += 2) {
      if (!Number.isFinite(pts[i]) || !Number.isFinite(pts[i + 1])) continue
      out.push(Math.round(pts[i] * 10) / 10, Math.round(pts[i + 1] * 10) / 10)
    }
    return { tool: d.tool === 'highlighter' ? 'highlighter' : 'pen', width: Math.min(Math.max(num(d.width, 3), 1), 60), points: out }
  }
  return {}
}

/** 캔버스 하나(항목·연결·댓글·화면 위치)를 정리한다. budget: 아직 더 받을 수 있는 항목 수 */
export function normalizeCanvas(raw, budget = MAX_ITEMS) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const items = []
  const seen = new Set()
  for (const it of Array.isArray(c.items) ? c.items : []) {
    if (items.length >= budget) break
    if (!it || typeof it !== 'object' || !ITEM_TYPES.includes(it.type)) continue
    const id = String(it.id ?? '').slice(0, 64)
    if (!id || seen.has(id)) continue
    const data = cleanData(it.type, it.data)
    if (it.type === 'stroke' && data.points.length < 4) continue
    seen.add(id)
    const minH = it.type === 'stroke' || it.type === 'text' ? 1 : 28
    const minW = it.type === 'stroke' ? 1 : 40
    const item = {
      id,
      type: it.type,
      x: num(it.x),
      y: num(it.y),
      w: Math.min(Math.max(num(it.w, 200), minW), 20000),
      h: Math.min(Math.max(num(it.h, 120), minH), 20000),
      color: COLOR_IDS.includes(it.color) ? it.color : null,
      z: num(it.z, items.length + 1),
      data,
    }
    if (typeof it.group === 'string' && it.group) item.group = it.group.slice(0, 64)
    if (it.locked === true) item.locked = true
    items.push(item)
  }
  const connections = []
  const cseen = new Set()
  for (const cn of Array.isArray(c.connections) ? c.connections : []) {
    if (!cn || typeof cn !== 'object') continue
    const id = String(cn.id ?? '').slice(0, 64)
    const from = String(cn.from ?? '')
    const to = String(cn.to ?? '')
    if (!id || cseen.has(id) || !seen.has(from) || !seen.has(to) || from === to) continue
    cseen.add(id)
    connections.push({
      id, from, to,
      label: str(cn.label, 200),
      arrow: ARROWS.includes(cn.arrow) ? cn.arrow : 'end',
      color: COLOR_IDS.includes(cn.color) ? cn.color : null,
      style: CONN_STYLES.includes(cn.style) ? cn.style : 'curve',
    })
  }
  const comments = []
  const mseen = new Set()
  for (const m of Array.isArray(c.comments) ? c.comments : []) {
    if (comments.length >= MAX_COMMENTS) break
    if (!m || typeof m !== 'object') continue
    const id = String(m.id ?? '').slice(0, 64)
    const itemId = String(m.itemId ?? '')
    const text = str(m.text, 2000).trim()
    if (!id || mseen.has(id) || !seen.has(itemId) || !text) continue
    mseen.add(id)
    const at = typeof m.at === 'string' && !Number.isNaN(Date.parse(m.at)) ? m.at : new Date(0).toISOString()
    comments.push({ id, itemId, author: str(m.author, 80) || '이름 없음', text, at, resolved: m.resolved === true })
  }
  const v = c.viewport
  const viewport = v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) ? { x: v.x, y: v.y, zoom: Math.min(Math.max(v.zoom, 0.1), 4) } : null
  return { ...(viewport ? { viewport } : {}), items, connections, comments }
}

/** version 1 내용을 캔버스 하나짜리 version 2로 옮긴다 */
export function migrateV1(c) {
  const src = c && typeof c === 'object' ? c : {}
  return {
    version: 2,
    active: 'cv1',
    canvases: [{ id: 'cv1', name: '캔버스 1', ...(src.viewport ? { viewport: src.viewport } : {}), items: src.items || [], connections: src.connections || [], comments: [] }],
  }
}

/** 불러온(또는 서버에서 읽은) 보드 내용을 version 2 모양으로 정리한다. 캔버스는 적어도 하나 */
export function normalizeDoc(raw) {
  let c = raw && typeof raw === 'object' ? raw : {}
  if (c.version !== 2 || !Array.isArray(c.canvases)) c = migrateV1(c)
  const canvases = []
  const seen = new Set()
  let budget = MAX_ITEMS
  for (const cv of c.canvases) {
    if (canvases.length >= MAX_CANVASES) break
    if (!cv || typeof cv !== 'object') continue
    let id = String(cv.id ?? '').slice(0, 64)
    if (!id || seen.has(id)) id = `cv${Date.now().toString(36)}${canvases.length}`
    seen.add(id)
    const clean = normalizeCanvas(cv, budget)
    budget -= clean.items.length
    canvases.push({ id, name: str(cv.name, 60).trim() || `캔버스 ${canvases.length + 1}`, ...clean })
  }
  if (!canvases.length) canvases.push({ id: 'cv1', name: '캔버스 1', items: [], connections: [], comments: [] })
  const active = canvases.some((x) => x.id === c.active) ? c.active : canvases[0].id
  return { version: 2, active, canvases }
}

/** 예전 이름(붙여넣기·JSON 가져오기에서 씀): 캔버스 하나 모양 */
export function normalizeBoard(raw) {
  return { version: 1, ...normalizeCanvas(raw) }
}
