// 보드 기하 계산: 연결선 곡선, 곡선 위의 점과 기울기, 화면 확대·이동, 영역 겹침 검사.
// 곡선 알고리즘(getCurveGeometry, bezierPoint, bezierTangent, bezierArcMidpoint)은 KnotPad(js/utils.js,
// js/connections.js)의 계산을 그대로 옮겼다. 연결 방향(위·아래·왼쪽·오른쪽)은 우리 보드에서 두 항목의 위치로 자동으로 고른다.

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const HANDLE_DIRS = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const LEGACY_MIN_HANDLE = 50
const LEGACY_MAX_HANDLE = 150
const LEGACY_HANDLE_RATIO = 0.4
const SHORT_DIST_THRESHOLD = 100
const BLEND_RANGE = 50

/** 두 점 사이 3차 베지어 제어점 (KnotPad getCurveGeometry) */
export function getCurveGeometry(x1, y1, x2, y2, fromHandle = null, toHandle = null) {
  const dx = x2 - x1
  const dy = y2 - y1
  const distSq = dx * dx + dy * dy
  if (distSq < 1) return { p0: { x: x1, y: y1 }, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, p3: { x: x2, y: y2 }, isLine: true }
  const dist = Math.sqrt(distSq)
  const dirX = dx / dist
  const dirY = dy / dist
  const fromDir = HANDLE_DIRS[fromHandle] || { x: dx >= 0 ? 1 : -1, y: 0 }
  const toDir = HANDLE_DIRS[toHandle] || { x: dx >= 0 ? -1 : 1, y: 0 }
  const fromDot = fromDir.x * dirX + fromDir.y * dirY
  const toDot = toDir.x * -dirX + toDir.y * -dirY
  const base = Math.max(LEGACY_MIN_HANDLE, Math.min(dist * LEGACY_HANDLE_RATIO, LEGACY_MAX_HANDLE))
  const fromAlign = Math.max(0.5, (1 + fromDot) * 0.5)
  const toAlign = Math.max(0.5, (1 + toDot) * 0.5)
  let fromLen = base * (0.7 + fromAlign * 0.6)
  let toLen = base * (0.7 + toAlign * 0.6)
  if (dist < SHORT_DIST_THRESHOLD) {
    const blendStart = SHORT_DIST_THRESHOLD - BLEND_RANGE
    const strength = dist <= blendStart ? 1 : (SHORT_DIST_THRESHOLD - dist) / BLEND_RANGE
    const maxSafe = dist * 0.8
    const total = fromLen + toLen
    if (total > maxSafe) {
      const scale = 1 - strength * (1 - maxSafe / total)
      fromLen *= scale
      toLen *= scale
    }
  }
  let cp1x = x1 + fromDir.x * fromLen
  let cp1y = y1 + fromDir.y * fromLen
  let cp2x = x2 + toDir.x * toLen
  let cp2y = y2 + toDir.y * toLen
  if (fromDot < 0) {
    const b = Math.min(0.35, -fromDot * 0.35)
    cp1x += dirX * dist * b
    cp1y += dirY * dist * b
    if (fromDot < -0.5) {
      const px = -fromDir.y
      const py = fromDir.x
      const s = px * dirX + py * dirY >= 0 ? 1 : -1
      cp1x += px * s * dist * 0.1
      cp1y += py * s * dist * 0.1
    }
  }
  if (toDot < 0) {
    const b = Math.min(0.35, -toDot * 0.35)
    cp2x -= dirX * dist * b
    cp2y -= dirY * dist * b
    if (toDot < -0.5) {
      const px = -toDir.y
      const py = toDir.x
      const s = px * -dirX + py * -dirY >= 0 ? 1 : -1
      cp2x += px * s * dist * 0.1
      cp2y += py * s * dist * 0.1
    }
  }
  return { p0: { x: x1, y: y1 }, p1: { x: cp1x, y: cp1y }, p2: { x: cp2x, y: cp2y }, p3: { x: x2, y: y2 }, isLine: false }
}

export function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
}

export function bezierTangent(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const dx = 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x)
  const dy = 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
  return Math.atan2(dy, dx)
}

/** 곡선 길이의 절반 지점 (KnotPad bezierArcMidpoint): 라벨 위치 */
export function bezierArcMidpoint(p0, p1, p2, p3) {
  const n = 32
  const pts = [p0]
  const lens = []
  let total = 0
  for (let i = 1; i <= n; i++) {
    const p = bezierPoint(p0, p1, p2, p3, i / n)
    const l = Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)
    pts.push(p)
    lens.push(l)
    total += l
  }
  const target = total / 2
  let run = 0
  for (let i = 0; i < lens.length; i++) {
    if (run + lens[i] >= target) {
      const r = lens[i] === 0 ? 0 : (target - run) / lens[i]
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * r, y: pts[i].y + (pts[i + 1].y - pts[i].y) * r }
    }
    run += lens[i]
  }
  return p3
}

export function handlePos(item, side) {
  const { x, y, w, h } = item
  if (side === 'top') return { x: x + w / 2, y }
  if (side === 'bottom') return { x: x + w / 2, y: y + h }
  if (side === 'left') return { x, y: y + h / 2 }
  return { x: x + w, y: y + h / 2 }
}

/** 두 항목이 마주 보는 면을 고른다 */
export function pickSides(a, b) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  if (Math.abs(dx) * (a.h + b.h) >= Math.abs(dy) * (a.w + b.w)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/** 점에서 가장 가까운 면 (끌어서 연결하는 중 임시 선) */
export function sideToward(a, pt) {
  return pickSides(a, { x: pt.x, y: pt.y, w: 0, h: 0 })[0]
}

const pathOf = (g) => (g.isLine ? `M${g.p0.x} ${g.p0.y} L${g.p3.x} ${g.p3.y}` : `M${g.p0.x} ${g.p0.y} C${g.p1.x} ${g.p1.y}, ${g.p2.x} ${g.p2.y}, ${g.p3.x} ${g.p3.y}`)

function arrowHead(tip, angle, size = 14) {
  const b1 = angle + Math.PI * 0.85
  const b2 = angle - Math.PI * 0.85
  return `${tip.x},${tip.y} ${tip.x + size * 0.8 * Math.cos(b1)},${tip.y + size * 0.8 * Math.sin(b1)} ${tip.x + size * 0.8 * Math.cos(b2)},${tip.y + size * 0.8 * Math.sin(b2)}`
}

/** 연결선 그리기 정보: 경로, 라벨 위치, 화살표 다각형. style: curve(곡선) | straight(직선) | elbow(꺾은선) */
export function connectionShape(a, b, arrow = 'none', style = 'curve') {
  const [fs, ts] = pickSides(a, b)
  const f = handlePos(a, fs)
  const t = handlePos(b, ts)
  if (style === 'straight' || style === 'elbow') {
    let pts
    if (style === 'straight') pts = [f, t]
    else if (fs === 'left' || fs === 'right') {
      const mx = (f.x + t.x) / 2
      pts = [f, { x: mx, y: f.y }, { x: mx, y: t.y }, t]
    } else {
      const my = (f.y + t.y) / 2
      pts = [f, { x: f.x, y: my }, { x: t.x, y: my }, t]
    }
    const heads = []
    const ang = (p, q) => Math.atan2(q.y - p.y, q.x - p.x)
    const n = pts.length
    if (arrow === 'end' || arrow === 'both') heads.push(arrowHead(t, ang(pts[n - 2], pts[n - 1])))
    if (arrow === 'both') heads.push(arrowHead(f, ang(pts[1], pts[0])))
    const mid = n === 2 ? { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 } : { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 }
    return { d: 'M' + pts.map((p) => `${p.x} ${p.y}`).join(' L'), mid, heads }
  }
  const g = getCurveGeometry(f.x, f.y, t.x, t.y, fs, ts)
  const mid = g.isLine ? { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 } : bezierArcMidpoint(g.p0, g.p1, g.p2, g.p3)
  const heads = []
  if (!g.isLine && (arrow === 'end' || arrow === 'both')) heads.push(arrowHead(g.p3, bezierTangent(g.p0, g.p1, g.p2, g.p3, 1)))
  if (!g.isLine && arrow === 'both') heads.push(arrowHead(g.p0, bezierTangent(g.p0, g.p1, g.p2, g.p3, 0) + Math.PI))
  return { d: pathOf(g), mid, heads }
}

/** 끌어서 연결하는 중의 임시 곡선 */
export function draftPath(a, pt) {
  const fs = sideToward(a, pt)
  const f = handlePos(a, fs)
  return pathOf(getCurveGeometry(f.x, f.y, pt.x, pt.y, fs, null))
}

// ── 화면 확대·이동 (KnotPad viewport.js setZoom의 기준점 고정 공식) ─────────────
/** 화면 좌표 (cx, cy)를 고정한 채 배율을 바꾼다 */
export function zoomAt(vp, nextZoom, cx, cy) {
  const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  return { x: cx - (cx - vp.x) * (z / vp.zoom), y: cy - (cy - vp.y) * (z / vp.zoom), zoom: z }
}

export const toWorld = (vp, sx, sy) => ({ x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom })

export function boundsOf(items) {
  if (!items.length) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const i of items) {
    x1 = Math.min(x1, i.x)
    y1 = Math.min(y1, i.y)
    x2 = Math.max(x2, i.x + i.w)
    y2 = Math.max(y2, i.y + i.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** 모든 항목이 보이게 맞춘다 (KnotPad fitToScreen) */
export function fitViewport(items, width, height, pad = 80) {
  const b = boundsOf(items)
  if (!b) return { x: width / 2, y: height / 2, zoom: 1 }
  const zoom = clamp(Math.min((width - pad * 2) / Math.max(b.w, 1), (height - pad * 2) / Math.max(b.h, 1), 1.5), MIN_ZOOM, MAX_ZOOM)
  return { x: width / 2 - (b.x + b.w / 2) * zoom, y: height / 2 - (b.y + b.h / 2) * zoom, zoom }
}

export const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export function normRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/** 겹치지 않는 자리: 원하는 자리부터 바깥으로 고리를 넓혀 가며 빈 곳을 찾는다
 *  (KnotPad findFreePosition은 같은 자리 겹침만 피했는데, 크기까지 보도록 넓혔다) */
export function findFreePosition(x, y, items, w = 0, h = 0, gap = 24) {
  const free = (px, py) => !items.some((i) => rectsOverlap({ x: px - gap / 2, y: py - gap / 2, w: w + gap, h: h + gap }, i))
  if (free(x, y)) return { x, y }
  const step = Math.max(40, Math.min(w, h) / 2)
  for (let ring = 1; ring <= 24; ring++) {
    const n = ring * 8
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const px = Math.round(x + Math.cos(a) * ring * step)
      const py = Math.round(y + Math.sin(a) * ring * step)
      if (free(px, py)) return { x: px, y: py }
    }
  }
  return { x: x + 24, y: y + 24 }
}

// ── 펜·지우개 ────────────────────────────────────────────
/** 점에서 선분까지 거리 */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 펜 획(항목 기준 상대 좌표 [x,y,x,y...])이 세계 좌표 점에서 r 안에 있는가 */
export function strokeHit(item, wx, wy, r) {
  const p = item.data.points
  const lx = wx - item.x
  const ly = wy - item.y
  const rr = r + (item.data.width || 3) / 2
  if (lx < -rr || ly < -rr || lx > item.w + rr || ly > item.h + rr) return false
  for (let i = 0; i + 3 < p.length; i += 2) if (distToSegment(lx, ly, p[i], p[i + 1], p[i + 2], p[i + 3]) <= rr) return true
  return false
}

/** 세계 좌표 점 목록 → 상자와 상대 좌표. 가까운 점은 줄인다 */
export function strokeFromPoints(points, width) {
  const pts = []
  let last = null
  for (const p of points) {
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.5) continue
    pts.push(p)
    last = p
  }
  if (pts.length === 1) pts.push({ x: pts[0].x + 0.5, y: pts[0].y + 0.5 })
  const pad = width / 2 + 1
  const x1 = Math.min(...pts.map((p) => p.x)) - pad
  const y1 = Math.min(...pts.map((p) => p.y)) - pad
  const x2 = Math.max(...pts.map((p) => p.x)) + pad
  const y2 = Math.max(...pts.map((p) => p.y)) + pad
  const flat = []
  for (const p of pts) flat.push(Math.round((p.x - x1) * 10) / 10, Math.round((p.y - y1) * 10) / 10)
  return { x: Math.round(x1 * 10) / 10, y: Math.round(y1 * 10) / 10, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1), points: flat }
}

/** 상대 좌표 점 목록 → 부드러운 SVG 경로(중점 이차 곡선) */
export function strokePath(p) {
  if (p.length < 4) return ''
  let d = `M${p[0]} ${p[1]}`
  if (p.length === 4) return d + ` L${p[2]} ${p[3]}`
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2
    const my = (p[i + 1] + p[i + 3]) / 2
    d += ` Q${p[i]} ${p[i + 1]} ${mx} ${my}`
  }
  const n = p.length
  return d + ` L${p[n - 2]} ${p[n - 1]}`
}

// ── 맞추기(격자·정렬 안내선) ─────────────────────────────
/** 움직이는 상자(box)를 다른 항목의 가장자리·가운데에 붙인다. 반환: {dx, dy, guides:[{x1,y1,x2,y2}]} */
export function smartSnap(box, others, threshold) {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w]
  const ys = [box.y, box.y + box.h / 2, box.y + box.h]
  let bestX = null
  let bestY = null
  for (const o of others) {
    const oxs = [o.x, o.x + o.w / 2, o.x + o.w]
    const oys = [o.y, o.y + o.h / 2, o.y + o.h]
    for (const a of xs) for (const b of oxs) {
      const d = b - a
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b, o }
    }
    for (const a of ys) for (const b of oys) {
      const d = b - a
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b, o }
    }
  }
  const guides = []
  const nb = { x: box.x + (bestX?.d || 0), y: box.y + (bestY?.d || 0), w: box.w, h: box.h }
  if (bestX) {
    const o = bestX.o
    guides.push({ x1: bestX.at, y1: Math.min(nb.y, o.y) - 16, x2: bestX.at, y2: Math.max(nb.y + nb.h, o.y + o.h) + 16 })
  }
  if (bestY) {
    const o = bestY.o
    guides.push({ x1: Math.min(nb.x, o.x) - 16, y1: bestY.at, x2: Math.max(nb.x + nb.w, o.x + o.w) + 16, y2: bestY.at })
  }
  return { dx: bestX?.d || 0, dy: bestY?.d || 0, guides }
}

/** 정렬: kind = left|hcenter|right|top|vcenter|bottom|hdist|vdist. 반환: Map(id → {x, y}) */
export function alignItems(items, kind) {
  const out = new Map()
  if (items.length < 2) return out
  const b = boundsOf(items)
  if (kind === 'hdist' || kind === 'vdist') {
    if (items.length < 3) return out
    const horiz = kind === 'hdist'
    const sorted = [...items].sort((p, q) => (horiz ? p.x - q.x : p.y - q.y))
    const total = sorted.reduce((s, i) => s + (horiz ? i.w : i.h), 0)
    const gap = ((horiz ? b.w : b.h) - total) / (sorted.length - 1)
    let cur = horiz ? b.x : b.y
    for (const i of sorted) {
      out.set(i.id, horiz ? { x: Math.round(cur), y: i.y } : { x: i.x, y: Math.round(cur) })
      cur += (horiz ? i.w : i.h) + gap
    }
    return out
  }
  for (const i of items) {
    let { x, y } = i
    if (kind === 'left') x = b.x
    if (kind === 'hcenter') x = b.x + b.w / 2 - i.w / 2
    if (kind === 'right') x = b.x + b.w - i.w
    if (kind === 'top') y = b.y
    if (kind === 'vcenter') y = b.y + b.h / 2 - i.h / 2
    if (kind === 'bottom') y = b.y + b.h - i.h
    out.set(i.id, { x: Math.round(x), y: Math.round(y) })
  }
  return out
}

/** 상자 a가 상자 b 안에 완전히 들어 있는가 */
export const rectInside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
