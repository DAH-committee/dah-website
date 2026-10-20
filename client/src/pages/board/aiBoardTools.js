// DAH Board AI 도구. 계약서: client/src/components/ai/README.md
//
// 구성
//   순수 함수(DOM 없음, node --test 가능): compactCanvas, op* (지금 캔버스를 받아 바뀔 조각 {items, connections}을 돌려준다)
//   createBoardTools(host): 편집기에 묶는 Tool[]. 바꾸기는 편집기의 commit 한 번(실행취소 한 단계)으로 적용한다.
//
// 위치는 서버나 모델이 아니라 여기서 정한다(격자 배치). 색은 palette.js 의 진한 색 이름만 쓴다.
// 모델이 준 글은 HTML로 해석하지 않는다(스티커·글 상자는 순수 글, 메모는 escape 한 문단).
import { COLORS, COLOR_ORDER } from './palette.js'
import { boundsOf, findFreePosition, rectInside, rectsOverlap } from './geometry.js'
import { MAX_ITEMS } from './sanitize.js'
import { LAYOUT_MODES, TEMPLATE_NAMES, ToolError, opAddFrameTemplate, opCommentOnItem, opFillTemplate, opLayout, opSetItemStyle, spatialSummary } from './aiBoardExtra.js'

export const STICKY = 200
const GAP = 24
const PAD = 32
const MAX_STICKIES = 40
const MAX_BLOCKS = 20
const MAX_GROUPS = 12
const MAX_IDS = 500
const MAX_PAIRS = 40
const MAX_EDITS = 60
const READ_CAP = 26000

const fail = (msg) => {
  throw new ToolError(msg)
}

const clip = (s, n) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const plainOf = (html) => decode(String(html || '').replace(/<\/(p|li|div)>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const defaultId = (p = 'i') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

/** 항목에 든 글 */
export function itemPlain(it) {
  const d = it.data || {}
  switch (it.type) {
    case 'memo': return plainOf(d.html)
    case 'keyword': case 'sticky': case 'shape': case 'text': return String(d.text || '').replace(/\s+/g, ' ').trim()
    case 'link': return [d.title, d.description, d.url].filter(Boolean).join(' | ')
    case 'video': return [d.title, d.url].filter(Boolean).join(' | ')
    case 'image': return d.alt || ''
    case 'file': return d.title || ''
    case 'frame': return d.name || ''
    default: return ''
  }
}

const box = (e) => [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)]
export const framesIn = (items) => items.filter((i) => i.type === 'frame').sort((a, b) => (a.data?.order || 0) - (b.data?.order || 0) || a.y - b.y || a.x - b.x)

/** 항목이 든 프레임(가장 작은 것). 프레임 안은 "전부 들어 있음" 기준이라 편집기와 같다 */
export function frameOfItem(it, frames) {
  if (it.type === 'frame') return null
  let best = null
  for (const f of frames) if (rectInside(it, f) && (!best || f.w * f.h < best.w * best.h)) best = f
  return best
}

/** 캔버스 한눈에: 프레임 목록, 항목(글·종류·색·프레임·자리), 연결. 크기 제한 안에 맞춘다 */
export function compactCanvas(canvas, { frame } = {}) {
  const frames = framesIn(canvas.items)
  let target = null
  if (frame !== undefined && frame !== null && frame !== '') {
    target = findFrame(frames, frame)
  }
  const strokes = canvas.items.filter((i) => i.type === 'stroke').length
  const pool = canvas.items.filter((i) => i.type !== 'frame' && i.type !== 'stroke')
  const rows = pool
    .map((it) => ({ it, f: frameOfItem(it, frames) }))
    .filter((r) => !target || r.f?.id === target.id)
    .sort((a, b) => Math.round(a.it.y / 40) - Math.round(b.it.y / 40) || a.it.x - b.it.x)
  const head = {
    canvas: canvas.name,
    totalItems: canvas.items.length,
    ...(strokes && { strokes }),
    frames: frames.map((f) => ({ id: f.id, name: f.data?.name || '', box: box(f), count: pool.filter((i) => frameOfItem(i, frames)?.id === f.id).length })),
    ...(!target && { spatial: spatialSummary(canvas) }),
  }
  const ids = new Set(rows.map((r) => r.it.id))
  const conns = canvas.connections.filter((c) => ids.has(c.from) && ids.has(c.to)).slice(0, 100).map((c) => ({ from: c.from, to: c.to, ...(c.label && { label: clip(c.label, 40) }) }))
  for (const textMax of [200, 100, 50, 0]) {
    const list = rows.slice(0, 300).map(({ it, f }) => ({
      id: it.id,
      type: it.type,
      ...(textMax && itemPlain(it) && { text: clip(itemPlain(it), textMax) }),
      ...((it.color || it.type === 'sticky') && { color: it.color || 'yellow' }),
      ...(f && { frame: f.data?.name || f.id }),
      box: box(it),
      ...(it.locked && { locked: true }),
    }))
    const out = { ...head, items: list, ...(conns.length && { connections: conns }), ...(rows.length > 300 && { truncated: `항목 ${rows.length}개 중 300개만 보냈다. frame 이름을 정해 나눠서 읽어 주세요.` }) }
    if (JSON.stringify(out).length <= READ_CAP || !textMax) return out
  }
  return head
}

export function findFrame(frames, name) {
  if (typeof name !== 'string') fail('프레임 이름은 글이어야 합니다')
  const n = name.trim().toLowerCase()
  const f = frames.find((x) => x.id === name) || frames.find((x) => (x.data?.name || '').trim().toLowerCase() === n) || frames.find((x) => n && (x.data?.name || '').toLowerCase().includes(n))
  if (!f) fail(`프레임 "${clip(name, 30)}" 을(를) 찾지 못했습니다. 있는 프레임: ${frames.map((x) => x.data?.name || x.id).join(', ') || '없음'}`)
  return f
}

/** 색 이름 정리: 팔레트 이름, 한글 이름, 흔한 영어. 모르면 null */
export function colorName(v) {
  if (v === undefined || v === null || v === '') return undefined
  const t = String(v).trim().toLowerCase()
  if (COLOR_ORDER.includes(t)) return t
  const kor = COLOR_ORDER.find((k) => COLORS[k].name === t || COLORS[k].name === String(v).trim())
  if (kor) return kor
  const alias = { orange: 'amber', violet: 'purple', blue: 'purple', pink: 'red', black: 'black', grey: 'gray', 주황색: 'amber', 노란색: 'yellow', 빨간색: 'red', 초록색: 'green', 보라색: 'purple', 검은색: 'black', 회색: 'gray' }
  return alias[t] || null
}

/** 한 칸씩 훑으며 비어 있는 격자 칸을 찾는다. area 안쪽에서 시작하고 모자라면 아래로 계속 */
function gridSlots(count, area, occupied, cw, ch, { gap = GAP, pad = PAD, maxCols = 99 } = {}) {
  const cols = Math.max(1, Math.min(maxCols, Math.floor((area.w - pad * 2 + gap) / (cw + gap))))
  const slots = []
  for (let row = 0; slots.length < count && row < 400; row++) {
    for (let col = 0; col < cols && slots.length < count; col++) {
      const r = { x: Math.round(area.x + pad + col * (cw + gap)), y: Math.round(area.y + pad + row * (ch + gap)), w: cw, h: ch }
      if (!occupied.some((o) => rectsOverlap({ x: r.x - gap / 2, y: r.y - gap / 2, w: r.w + gap, h: r.h + gap }, o))) slots.push(r)
    }
  }
  return { slots, cols }
}

const maxZOf = (items) => items.reduce((m, i) => Math.max(m, i.z || 0), 0)

function limitCheck(ctx, add) {
  const total = ctx.totalItems ?? 0
  if (total + add > MAX_ITEMS) fail(`보드에는 항목을 ${MAX_ITEMS}개까지 둘 수 있습니다`)
}

/** 놓을 영역: 화면(near 생략 또는 'view')이나 이름으로 고른 프레임 */
function targetArea(canvas, near, ctx) {
  if (near === undefined || near === null || near === '' || near === 'view') {
    const v = ctx.view || { x: 0, y: 0, w: 1000, h: 700 }
    return { kind: 'view', rect: { x: v.x, y: v.y, w: v.w, h: v.h }, frame: null }
  }
  const f = findFrame(framesIn(canvas.items), near)
  return { kind: 'frame', rect: { x: f.x, y: f.y, w: f.w, h: f.h }, frame: f }
}

/** 이미 놓인 것 중 영역과 겹치는(프레임 안이면 그 안) 항목 상자 */
const blockers = (canvas) => canvas.items.filter((i) => i.type !== 'frame').map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))

function growFrame(items, frame, slots, ch) {
  if (!frame || !slots.length) return items
  const bottom = Math.max(...slots.map((s) => s.y + ch)) + PAD
  if (bottom <= frame.y + frame.h) return items
  return items.map((i) => (i.id === frame.id ? { ...i, h: Math.round(bottom - frame.y) } : i))
}

// ── 바꾸는 일(순수) ──────────────────────────────────────
// (canvas, args, ctx) => { items?, connections?, focus?: [id], summary, result } 또는 { noop:true, summary, result }
// ctx = { view:{x,y,w,h}(세계 좌표), totalItems, newId }

export function opAddStickies(canvas, args, ctx = {}) {
  const newId = ctx.newId || defaultId
  const list = args?.notes
  if (!Array.isArray(list) || !list.length) fail('notes 에 스티커 메모를 하나 이상 넣어 주세요')
  if (list.length > MAX_STICKIES) fail(`한 번에 ${MAX_STICKIES}장까지 만들 수 있습니다`)
  const notes = []
  const fallback = []
  for (const n of list) {
    const o = typeof n === 'string' ? { text: n } : n
    if (!o || typeof o !== 'object' || typeof o.text !== 'string') fail('notes 의 각 항목은 { text, color? } 여야 합니다')
    const text = o.text.trim().slice(0, 500)
    if (!text) continue
    let color = colorName(o.color)
    if (o.color && color === null) {
      fallback.push(String(o.color).slice(0, 20))
      color = undefined
    }
    notes.push({ text, color: color || 'yellow' })
  }
  if (!notes.length) fail('비어 있지 않은 스티커 글이 필요합니다')
  limitCheck(ctx, notes.length)
  const area = targetArea(canvas, args?.near, ctx)
  let rect = area.rect
  const maxCols = area.kind === 'view' ? 6 : 99
  if (area.kind === 'view') {
    const cols = Math.max(1, Math.min(6, Math.floor((rect.w * 0.9 + GAP) / (STICKY + GAP)), Math.ceil(Math.sqrt(notes.length * 1.6))))
    const w = cols * (STICKY + GAP) - GAP + PAD * 2
    rect = { x: rect.x + Math.max(0, (rect.w - w) / 2), y: rect.y + Math.min(rect.h * 0.05, 40), w, h: rect.h }
  }
  const { slots } = gridSlots(notes.length, rect, blockers(canvas), STICKY, STICKY, { maxCols })
  let z = maxZOf(canvas.items)
  const made = notes.map((n, i) => ({ id: newId(), type: 'sticky', x: slots[i].x, y: slots[i].y, w: STICKY, h: STICKY, color: n.color, z: ++z, data: { text: n.text } }))
  const items = growFrame([...canvas.items, ...made], area.frame, slots, STICKY)
  return {
    items,
    focus: made.map((m) => m.id),
    summary: `스티커 메모 ${made.length}장을 ${area.frame ? `"${clip(area.frame.data?.name || '프레임', 16)}" 안에 ` : ''}만들었습니다`,
    result: { added: made.map((m) => ({ id: m.id, color: m.color })), ...(fallback.length && { unknownColors: fallback, usedColor: 'yellow' }) },
  }
}

function textHeight(text, w, size) {
  const perLine = Math.max(6, Math.floor(w / (size * 0.62)))
  const lines = String(text).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
  return Math.round(lines * size * 1.45 + 8)
}

export function opAddTextBlocks(canvas, args, ctx = {}) {
  const newId = ctx.newId || defaultId
  const list = args?.blocks
  if (!Array.isArray(list) || !list.length) fail('blocks 에 글 상자를 하나 이상 넣어 주세요')
  if (list.length > MAX_BLOCKS) fail(`한 번에 ${MAX_BLOCKS}개까지 만들 수 있습니다`)
  const blocks = []
  for (const b of list) {
    const o = typeof b === 'string' ? { text: b } : b
    if (!o || typeof o !== 'object' || typeof o.text !== 'string') fail('blocks 의 각 항목은 { text, size?, bold? } 여야 합니다')
    const text = o.text.trim().slice(0, 2000)
    if (!text) continue
    let size = 20
    if (o.size !== undefined) {
      if (!Number.isFinite(o.size)) fail('size 는 숫자여야 합니다')
      size = Math.min(Math.max(Math.round(o.size), 12), 96)
    }
    blocks.push({ text, size, bold: o.bold === true })
  }
  if (!blocks.length) fail('비어 있지 않은 글이 필요합니다')
  limitCheck(ctx, blocks.length)
  const area = targetArea(canvas, args?.near, ctx)
  const w = Math.min(420, Math.max(220, Math.round(area.rect.w - PAD * 2)))
  const heights = blocks.map((b) => textHeight(b.text, w, b.size))
  const colH = heights.reduce((s, h) => s + h, 0) + (blocks.length - 1) * 16
  const start =
    area.kind === 'view'
      ? { x: Math.round(area.rect.x + Math.max(40, (area.rect.w - w) / 2)), y: Math.round(area.rect.y + Math.min(80, area.rect.h * 0.1)) }
      : { x: Math.round(area.rect.x + PAD), y: Math.round(area.rect.y + PAD) }
  const pos = findFreePosition(start.x, start.y, canvas.items.filter((i) => i.type !== 'frame'), w, colH)
  let y = pos.y
  let z = maxZOf(canvas.items)
  const made = blocks.map((b, i) => {
    const it = { id: newId(), type: 'text', x: pos.x, y, w, h: heights[i], color: null, z: ++z, data: { text: b.text, size: b.size, bold: b.bold } }
    y += heights[i] + 16
    return it
  })
  let items = [...canvas.items, ...made]
  if (area.frame) items = growFrame(items, area.frame, [{ y: pos.y + colH - 1 }], 1)
  return { items, focus: made.map((m) => m.id), summary: `글 상자 ${made.length}개를 만들었습니다`, result: { added: made.map((m) => m.id) } }
}

export function opGroupIntoFrames(canvas, args, ctx = {}) {
  const newId = ctx.newId || defaultId
  const groups = args?.groups
  if (!Array.isArray(groups) || !groups.length) fail('groups 에 묶음을 하나 이상 넣어 주세요')
  if (groups.length > MAX_GROUPS) fail(`한 번에 ${MAX_GROUPS}개 묶음까지 만들 수 있습니다`)
  const byId = new Map(canvas.items.map((i) => [i.id, i]))
  const taken = new Set()
  const skipped = []
  const parsed = []
  let idCount = 0
  for (const g of groups) {
    if (!g || typeof g !== 'object') fail('groups 의 각 항목은 { name, itemIds } 여야 합니다')
    if (typeof g.name !== 'string' || !g.name.trim()) fail('묶음 name 이 필요합니다')
    if (!Array.isArray(g.itemIds)) fail('itemIds 는 id 목록이어야 합니다')
    const members = []
    for (const id of g.itemIds) {
      idCount++
      if (idCount > MAX_IDS) fail(`항목은 한 번에 ${MAX_IDS}개까지 묶을 수 있습니다`)
      const it = typeof id === 'string' ? byId.get(id) : null
      if (!it) {
        skipped.push(String(id).slice(0, 24))
        continue
      }
      if (it.type === 'frame' || it.type === 'stroke' || it.locked || taken.has(id)) {
        skipped.push(id)
        continue
      }
      taken.add(id)
      members.push(it)
    }
    if (members.length) parsed.push({ name: g.name.trim().slice(0, 100), members })
  }
  if (!parsed.length) fail('묶을 수 있는 항목이 없습니다. read_canvas 로 id 를 확인해 주세요')
  limitCheck(ctx, parsed.length)

  // 묶음마다 격자 크기 계산
  const laid = parsed.map((g) => {
    const m = [...g.members].sort((a, b) => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x)
    const cw = Math.max(...m.map((i) => i.w))
    const ch = Math.max(...m.map((i) => i.h))
    const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(m.length))))
    const rows = Math.ceil(m.length / cols)
    return { name: g.name, m, cw, ch, cols, rows, w: cols * cw + (cols - 1) * GAP + PAD * 2, h: rows * ch + (rows - 1) * GAP + PAD * 2 }
  })
  // 흐름 배치(가로로 쌓다가 너무 넓으면 다음 줄)
  const ROW_MAX = 2600
  const FGAP = 120
  const place = (ox, oy) => {
    let x = ox
    let y = oy
    let rowH = 0
    return laid.map((g) => {
      if (x > ox && x + g.w > ox + ROW_MAX) {
        x = ox
        y += rowH + FGAP
        rowH = 0
      }
      const at = { x: Math.round(x), y: Math.round(y) }
      x += g.w + FGAP
      rowH = Math.max(rowH, g.h)
      return at
    })
  }
  const moving = new Set(taken)
  const others = canvas.items.filter((i) => !moving.has(i.id))
  const mb = boundsOf([...taken].map((id) => byId.get(id)))
  let origin = { x: Math.round(mb.x), y: Math.round(mb.y) }
  let spots = place(origin.x, origin.y)
  const overlaps = (sp) => laid.some((g, i) => others.some((o) => o.type !== 'stroke' && rectsOverlap({ x: sp[i].x - 20, y: sp[i].y - 36, w: g.w + 40, h: g.h + 56 }, o)))
  if (others.length && overlaps(spots)) {
    const ob = boundsOf(others)
    origin = { x: Math.round(ob.x + ob.w + 160), y: Math.round(ob.y) }
    spots = place(origin.x, origin.y)
  }
  const maxOrder = framesIn(canvas.items).reduce((mx, f) => Math.max(mx, f.data?.order || 0), 0)
  let z = maxZOf(canvas.items)
  const moved = new Map()
  const frames = laid.map((g, gi) => {
    const at = spots[gi]
    g.m.forEach((it, k) => {
      const col = k % g.cols
      const row = Math.floor(k / g.cols)
      moved.set(it.id, { x: Math.round(at.x + PAD + col * (g.cw + GAP)), y: Math.round(at.y + PAD + row * (g.ch + GAP)) })
    })
    return { id: newId('f'), type: 'frame', x: at.x, y: at.y, w: Math.round(g.w), h: Math.round(g.h), color: null, z: ++z, data: { name: g.name, order: maxOrder + gi + 1 } }
  })
  const items = canvas.items.map((i) => (moved.has(i.id) ? { ...i, ...moved.get(i.id) } : i)).concat(frames)
  return {
    items,
    focus: [...frames.map((f) => f.id), ...moved.keys()],
    fit: true,
    summary: `항목 ${moved.size}개를 프레임 ${frames.length}개로 묶었습니다`,
    result: { frames: frames.map((f, i) => ({ id: f.id, name: f.data.name, count: laid[i].m.length })), moved: moved.size, ...(skipped.length && { skipped: skipped.slice(0, 10) }) },
  }
}

export function opConnect(canvas, args, ctx = {}) {
  const newId = ctx.newId || defaultId
  const pairs = args?.pairs
  if (!Array.isArray(pairs) || !pairs.length) fail('pairs 에 연결할 항목 쌍을 넣어 주세요')
  if (pairs.length > MAX_PAIRS) fail(`한 번에 ${MAX_PAIRS}개까지 연결할 수 있습니다`)
  const ids = new Map(canvas.items.map((i) => [i.id, i]))
  const have = new Set(canvas.connections.map((c) => [c.from, c.to].sort().join('|')))
  const made = []
  const skipped = []
  for (const p of pairs) {
    const from = p?.from
    const to = p?.to
    const bad = typeof from !== 'string' || typeof to !== 'string' || from === to || !ids.has(from) || !ids.has(to) || ids.get(from).type === 'stroke' || ids.get(to).type === 'stroke'
    const key = bad ? '' : [from, to].sort().join('|')
    if (bad || have.has(key)) {
      skipped.push(`${String(from).slice(0, 20)}→${String(to).slice(0, 20)}`)
      continue
    }
    have.add(key)
    const label = typeof p.label === 'string' ? p.label.trim().slice(0, 100) : ''
    made.push({ id: newId('c'), from, to, label, arrow: 'end', color: null, style: 'curve' })
  }
  if (!made.length) return { noop: true, summary: '새로 연결할 것이 없습니다', result: { changed: 0, skipped: skipped.slice(0, 10) } }
  return { connections: [...canvas.connections, ...made], summary: `${made.length}쌍을 연결했습니다`, result: { connected: made.length, ...(skipped.length && { skipped: skipped.slice(0, 10) }) } }
}

export function opEditItems(canvas, args) {
  const edits = args?.edits
  if (!Array.isArray(edits) || !edits.length) fail('edits 에 고칠 항목을 넣어 주세요')
  if (edits.length > MAX_EDITS) fail(`한 번에 ${MAX_EDITS}개까지 고칠 수 있습니다`)
  const patch = new Map()
  const skipped = []
  for (const e of edits) {
    const it = typeof e?.id === 'string' ? canvas.items.find((i) => i.id === e.id) : null
    if (!it || typeof e.text !== 'string' || it.locked) {
      skipped.push(String(e?.id).slice(0, 24))
      continue
    }
    const text = e.text.slice(0, 4000)
    if (it.type === 'sticky' || it.type === 'shape' || it.type === 'text' || it.type === 'keyword') patch.set(it.id, { ...it, data: { ...it.data, text: it.type === 'keyword' ? text.replace(/\s+/g, ' ').trim().slice(0, 200) : text } })
    else if (it.type === 'frame') patch.set(it.id, { ...it, data: { ...it.data, name: text.replace(/\s+/g, ' ').trim().slice(0, 100) } })
    else if (it.type === 'memo') patch.set(it.id, { ...it, data: { ...it.data, html: text.split(/\r?\n/).map((l) => `<p>${l ? escapeHtml(l) : '<br>'}</p>`).join('') } })
    else skipped.push(it.id)
  }
  let n = 0
  const items = canvas.items.map((i) => {
    const p = patch.get(i.id)
    if (!p) return i
    if (itemPlain(p) === itemPlain(i)) return i
    n++
    return p
  })
  if (!n) return { noop: true, summary: skipped.length ? '고치지 못했습니다' : '바뀐 것이 없습니다', result: { changed: 0, ...(skipped.length && { skipped: skipped.slice(0, 10) }) } }
  return { items, focus: [...patch.keys()], summary: `항목 ${n}개의 글을 고쳤습니다`, result: { changed: n, ...(skipped.length && { skipped: skipped.slice(0, 10) }) } }
}

// ── 도구 묶음 ────────────────────────────────────────────
const COLOR_HELP = COLOR_ORDER.map((k) => `${k}(${COLORS[k].name})`).join(', ')

/**
 * host:
 *   getCanvas(), getView()(세계 좌표 {x,y,w,h}), getSel()(id 배열), canEdit(), totalItems()
 *   apply({ items?, connections?, focus, fit }) -> { before, after } | null   // finishEdit + commit(한 번 기록) + 선택·화면 이동
 *   revert({ before, after })                                                  // 마지막이 그 변경이면 편집기 실행취소, 아니면 안내
 */
export function createBoardTools(host) {
  const ctx = () => ({ view: host.getView(), totalItems: host.totalItems(), newId: defaultId, sel: host.getSel?.() || [] })
  const mutating = (op) => async (args) => {
    try {
      if (!host.canEdit()) return { result: { ok: false, error: '보기 전용이라 고칠 수 없습니다' }, summary: '보기 전용이라 고칠 수 없습니다' }
      const r = op(host.getCanvas(), args && typeof args === 'object' ? args : {}, ctx())
      if (r.noop) return { result: { ok: true, ...r.result }, summary: r.summary }
      const h = host.apply({ ...(r.items && { items: r.items }), ...(r.connections && { connections: r.connections }), ...(r.comments && { comments: r.comments }), focus: r.focus || [], fit: r.fit === true })
      if (!h) return { result: { ok: true, changed: 0 }, summary: '바뀐 것이 없습니다' }
      return { result: { ok: true, ...r.result }, summary: r.summary, undo: () => host.revert(h) }
    } catch (e) {
      if (e instanceof ToolError) return { result: { ok: false, error: e.message }, summary: `할 수 없었습니다: ${e.message}` }
      return { result: { ok: false, error: '도구를 실행하지 못했습니다' }, summary: '도구를 실행하지 못했습니다' }
    }
  }

  return [
    {
      name: 'read_canvas',
      description: '지금 캔버스를 읽는다: 프레임(id, 이름, 자리, 든 개수), spatial 요약(프레임별 내용 10개, 프레임 밖 항목 orphans, 빈 자리 empty_placeholders, 열린 댓글), 항목(id, 종류, 글, 색, 든 프레임, 자리 [x,y,w,h]), 연결. frame 이름을 주면 그 프레임 안만 읽는다(spatial 은 빠짐). 항목은 300개, 전체 약 26000자 예산이라 넘으면 글을 줄여 주고 truncated 를 알린다. 항목 id 는 다른 도구에 쓴다. 정리나 배치 전에 먼저 부른다.',
      parameters: { type: 'object', properties: { frame: { type: 'string', description: '이 프레임 안의 항목만(이름 또는 id)' } } },
      run: async (args) => {
        try {
          return { result: compactCanvas(host.getCanvas(), { frame: args?.frame }), summary: '' }
        } catch (e) {
          if (e instanceof ToolError) return { result: { ok: false, error: e.message }, summary: `읽지 못했습니다: ${e.message}` }
          return { result: { ok: false, error: '도구를 실행하지 못했습니다' }, summary: '도구를 실행하지 못했습니다' }
        }
      },
    },
    {
      name: 'add_sticky_notes',
      description: `스티커 메모를 여러 장 만든다(한 장에 짧은 생각 하나, 40자 안쪽 권장). 위치는 클라이언트가 격자로 정한다: near 를 생략하거나 "view" 면 지금 보이는 화면에, 프레임 이름을 주면 그 프레임 안 빈 칸에 놓는다. 색 이름: ${COLOR_HELP}. 생략하면 yellow.`,
      parameters: {
        type: 'object',
        properties: {
          notes: {
            type: 'array',
            maxItems: MAX_STICKIES,
            items: { type: 'object', properties: { text: { type: 'string' }, color: { type: 'string', enum: COLOR_ORDER } }, required: ['text'] },
          },
          near: { type: 'string', description: '"view"(기본) 또는 프레임 이름' },
        },
        required: ['notes'],
      },
      run: mutating(opAddStickies),
    },
    {
      name: 'add_text_blocks',
      description: '글 상자(제목·설명·메모용 글)를 여러 개 만들어 세로로 쌓아 놓는다. 위치는 near("view" 또는 프레임 이름)로 정한다.',
      parameters: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            maxItems: MAX_BLOCKS,
            items: { type: 'object', properties: { text: { type: 'string' }, size: { type: 'integer', minimum: 12, maximum: 96, description: '글자 크기(기본 20)' }, bold: { type: 'boolean' } }, required: ['text'] },
          },
          near: { type: 'string', description: '"view"(기본) 또는 프레임 이름' },
        },
        required: ['blocks'],
      },
      run: mutating(opAddTextBlocks),
    },
    {
      name: 'cluster_items',
      description: '항목을 주제별로 묶는다(옛 이름 group_into_frames). 묶음마다 프레임(이름 붙은 사각형)을 만들고 그 안에 항목을 격자로 정리해 옮긴다. itemIds 는 read_canvas 의 id. 한 항목은 한 묶음에만 들어간다. 프레임·잠긴 항목·펜 획은 옮기지 않는다.',
      parameters: {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
            maxItems: MAX_GROUPS,
            items: { type: 'object', properties: { name: { type: 'string', description: '프레임 이름(짧게)' }, itemIds: { type: 'array', items: { type: 'string' } } }, required: ['name', 'itemIds'] },
          },
        },
        required: ['groups'],
      },
      run: mutating(opGroupIntoFrames),
    },
    {
      name: 'connect_items',
      description: '항목 사이에 화살표 연결선을 긋는다. 이미 이어진 쌍은 건너뛴다.',
      parameters: {
        type: 'object',
        properties: {
          pairs: { type: 'array', maxItems: MAX_PAIRS, items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
        },
        required: ['pairs'],
      },
      run: mutating(opConnect),
    },
    {
      name: 'edit_items',
      description: '스티커·글 상자·키워드·도형·메모의 글, 프레임의 이름을 바꾼다(맞춤법·다듬기용). id 는 read_canvas 에서 얻는다. 글 전체를 새로 준다.',
      parameters: {
        type: 'object',
        properties: { edits: { type: 'array', maxItems: MAX_EDITS, items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } } },
        required: ['edits'],
      },
      run: mutating(opEditItems),
    },
    {
      name: 'layout_items',
      description: '항목들을 규칙 배치로 다시 놓는다(글은 그대로). mode: grid(격자, columns 선택), row(가로 한 줄), column(세로 한 줄), radial(첫 id 또는 center 가 가운데, 나머지는 원), timeline(가로 흐름, 위아래 번갈아). ids 를 주면 그 순서를 흐름 순서로 쓰고(row, column, timeline), 생략하면 선택한 항목을 쓴다. gap px(기본 32). 프레임, 펜 획, 잠긴 항목은 건너뛴다. 항목이 원래 프레임 밖으로 나가면 warning 으로 알린다. 주제별로 묶으려면 cluster_items 를 쓴다.',
      parameters: { type: 'object', properties: { ids: { type: 'array', maxItems: 300, items: { type: 'string' } }, mode: { type: 'string', enum: LAYOUT_MODES }, gap: { type: 'integer', minimum: 0, maximum: 400 }, columns: { type: 'integer', minimum: 1, maximum: 12 }, center: { type: 'string', description: 'radial 의 가운데 항목 id' } }, required: ['mode'] },
      run: mutating(opLayout),
    },
    {
      name: 'add_frame_template',
      description: `작업 틀을 새로 넣는다. name: ${Object.keys(TEMPLATE_NAMES).join(', ')}. 기존 내용 아래에 놓고(빈 캔버스면 화면 왼쪽 위) 화면을 맞춘다. title 을 주면 틀 위에 제목 글을 붙인다. 틀의 칸 제목(frames, labels)과 빈 스티커 수(empty_slots)를 돌려주니 이어서 fill_template 로 채운다. 이미 비슷한 틀이 있으면 사용자에게 먼저 묻는다.`,
      parameters: { type: 'object', properties: { name: { type: 'string', enum: Object.keys(TEMPLATE_NAMES) }, title: { type: 'string' } }, required: ['name'] },
      run: mutating(opAddFrameTemplate),
    },
    {
      name: 'fill_template',
      description: '틀의 칸에 글을 채운다. cells: [{label, text}] (최대 80). label 은 프레임 이름(KPT 의 "Keep 계속할 것" 은 "Keep" 만 써도 됨) 또는 칸 제목 글(여정 지도의 "행동", 페르소나의 "목표"). 여정 지도의 한 칸은 "행동/단계 1" 처럼 "행/열" 로 쓴다. 같은 label 을 여러 번 쓰면 빈 스티커를 차례로 채우고, 자리가 모자라면 새 스티커를 붙인다. 못 찾은 label 은 errors 로 알려 주며 있는 프레임과 칸 제목을 함께 준다. 스티커 한 장에 한 문장(40자 안쪽).',
      parameters: { type: 'object', properties: { cells: { type: 'array', maxItems: 80, items: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } }, required: ['label', 'text'] } } }, required: ['cells'] },
      run: mutating(opFillTemplate),
    },
    {
      name: 'set_item_style',
      description: `항목 모양을 바꾼다. ids(항목 id 목록), color(${COLOR_HELP}, 스티커·도형·글 상자·메모·프레임), size(12~96, 글 상자의 글자 크기만), bold(글 상자만). 맞지 않는 항목은 skipped 로 이유를 알려 준다. 글 내용은 edit_items.`,
      parameters: { type: 'object', properties: { ids: { type: 'array', maxItems: 300, items: { type: 'string' } }, color: { type: 'string', enum: COLOR_ORDER }, size: { type: 'integer', minimum: 12, maximum: 96 }, bold: { type: 'boolean' } }, required: ['ids'] },
      run: mutating(opSetItemStyle),
    },
    {
      name: 'add_comment_on_item',
      description: '항목에 AI 이름("AI")으로 댓글을 단다(내용은 바꾸지 않음). 검토나 질문, 제안을 남길 때 쓴다. id 는 read_canvas 의 항목 id, text 는 한두 문장. 열린 댓글은 read_canvas 의 spatial.open_comments 에서 볼 수 있다.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
      run: mutating(opCommentOnItem),
    },
  ]
}
