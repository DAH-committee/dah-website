// 보드 AI 확장: 배치(layout_items), 틀 넣기(add_frame_template), 틀 채우기(fill_template), 스타일, 댓글, 공간 요약.
// 모두 "지금 캔버스 → 바뀔 조각" 순수 함수(op*)다. 위치와 크기는 모델이 아니라 여기서 정한다.
import { boundsOf } from './geometry.js'
import { buildTemplate, TEMPLATES } from './templates.js'
import { MAX_ITEMS } from './sanitize.js'
import { colorName, frameOfItem, framesIn, itemPlain, STICKY } from './aiBoardTools.js'
import { COLOR_ORDER } from './palette.js'

export class ToolError extends Error {}
const fail = (msg) => {
  throw new ToolError(msg)
}
const clip = (s, n) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const defaultId = (p = 'i') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const SKIP = new Set(['frame', 'stroke'])
const PLACEHOLDERS = new Set(['', '내용 적기', '할 일 적기', '아이디어', '일정', '항목', '이해관계자'])
const isPlaceholder = (it) => it.type === 'sticky' && PLACEHOLDERS.has(String(it.data?.text || '').trim())

export const TEMPLATE_NAMES = { KPT: 'kpt', journey: 'journey', persona: 'persona', stakeholder: 'stakeholder', matrix2x2: 'matrix', kanban: 'kanban', brainstorm: 'brainstorm', mindmap: 'mindmap', weekly: 'weekly' }
export const LAYOUT_MODES = ['grid', 'row', 'column', 'radial', 'timeline']

// ───────────────────────── 공간 요약 ─────────────────────────

/** 프레임별 내용, 프레임 밖 항목(orphan), 비어 있는 자리, 열린 댓글을 작게 요약한다 */
export function spatialSummary(canvas) {
  const frames = framesIn(canvas.items)
  const pool = canvas.items.filter((i) => !SKIP.has(i.type))
  const orphans = []
  const per = new Map(frames.map((f) => [f.id, []]))
  for (const it of pool) {
    const f = frameOfItem(it, frames)
    if (f) per.get(f.id).push(it)
    else orphans.push(it)
  }
  const b = boundsOf(canvas.items.filter((i) => i.type !== 'stroke'))
  const placeholders = pool.filter(isPlaceholder)
  const labelOf = (it) => clip(itemPlain(it), 28)
  return {
    bounds: b ? [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)] : null,
    frames: frames.map((f) => {
      const inside = per.get(f.id)
      const filled = inside.filter((i) => !isPlaceholder(i))
      return { id: f.id, name: f.data?.name || '', box: [Math.round(f.x), Math.round(f.y), Math.round(f.w), Math.round(f.h)], count: inside.length, empty_slots: inside.length - filled.length, contents: filled.slice(0, 10).map((i) => ({ id: i.id, type: i.type, text: labelOf(i) })), more: Math.max(0, filled.length - 10) }
    }),
    // 프레임이 없으면 전부가 프레임 밖이라 목록이 items 와 겹친다: 개수만 준다
    orphans: frames.length ? { count: orphans.length, items: orphans.slice(0, 15).map((i) => ({ id: i.id, type: i.type, text: labelOf(i), at: [Math.round(i.x), Math.round(i.y)] })), more: Math.max(0, orphans.length - 15) } : { count: orphans.length, note: '프레임이 없어 모두 프레임 밖(목록은 items)' },
    empty_placeholders: placeholders.length,
    open_comments: (canvas.comments || []).filter((c) => !c.resolved).slice(0, 15).map((c) => ({ id: c.id, item: c.itemId, author: c.author, text: clip(c.text, 80) })),
  }
}

// ───────────────────────── 배치 ─────────────────────────

export function opLayout(canvas, args, ctx = {}) {
  const mode = args?.mode
  if (!LAYOUT_MODES.includes(mode)) fail(`mode 는 ${LAYOUT_MODES.join(', ')} 중 하나여야 합니다`)
  let ids = Array.isArray(args?.ids) ? args.ids.filter((x) => typeof x === 'string') : []
  if (!ids.length) ids = ctx.sel || []
  if (!ids.length) fail('ids(항목 id 목록)가 필요합니다. 선택한 항목도 없습니다. read_canvas 로 id 를 얻으세요')
  if (ids.length > 300) fail('한 번에 300개까지 배치할 수 있습니다')
  const gap = args?.gap === undefined ? 32 : Math.round(Number(args.gap))
  if (!Number.isFinite(gap) || gap < 0 || gap > 400) fail('gap 은 0~400 px 숫자입니다')
  const byId = new Map(canvas.items.map((i) => [i.id, i]))
  const unknown = ids.filter((x) => !byId.has(x))
  if (unknown.length) fail(`없는 항목 id: ${unknown.slice(0, 4).join(', ')}. read_canvas 로 다시 확인하세요`)
  const list = [...new Set(ids)].map((x) => byId.get(x)).filter((i) => !SKIP.has(i.type) && !i.locked)
  if (list.length < 2) fail('배치할 항목이 2개 이상 필요합니다(프레임, 펜 획, 잠긴 항목은 제외)')
  const given = Array.isArray(args.ids) && args.ids.length
  const base = boundsOf(list)
  const cw = Math.max(...list.map((i) => i.w))
  const ch = Math.max(...list.map((i) => i.h))
  const pos = new Map()
  const reading = [...list].sort((a, b) => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x)
  if (mode === 'grid') {
    const cols = args.columns ? Math.max(1, Math.min(12, Math.round(Number(args.columns)))) : Math.max(1, Math.ceil(Math.sqrt(list.length * (ch / cw) * 1.5)))
    reading.forEach((it, k) => pos.set(it.id, [base.x + (k % cols) * (cw + gap), base.y + Math.floor(k / cols) * (ch + gap)]))
  } else if (mode === 'row') {
    let x = base.x
    for (const it of given ? list : [...list].sort((a, b) => a.x - b.x)) { pos.set(it.id, [x, base.y]); x += it.w + gap }
  } else if (mode === 'column') {
    let y = base.y
    for (const it of given ? list : [...list].sort((a, b) => a.y - b.y)) { pos.set(it.id, [base.x, y]); y += it.h + gap }
  } else if (mode === 'radial') {
    const centerId = typeof args.center === 'string' && list.some((i) => i.id === args.center) ? args.center : list[0].id
    const center = list.find((i) => i.id === centerId)
    const others = list.filter((i) => i.id !== centerId)
    const cx = base.x + base.w / 2
    const cy = base.y + base.h / 2
    const r = Math.max(cw + gap + 80, (others.length * (cw + gap)) / (2 * Math.PI) + Math.max(center.w, center.h) / 2 + gap)
    pos.set(center.id, [cx - center.w / 2, cy - center.h / 2])
    others.forEach((it, k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / others.length
      pos.set(it.id, [cx + r * Math.cos(a) - it.w / 2, cy + r * Math.sin(a) - it.h / 2])
    })
  } else {
    const order = given ? list : [...list].sort((a, b) => a.x - b.x)
    let x = base.x
    const midY = base.y + base.h / 2
    order.forEach((it, k) => {
      pos.set(it.id, [x, k % 2 === 0 ? midY - it.h - gap / 2 : midY + gap / 2])
      x += it.w + gap
    })
  }
  // 다른 항목과 겹치면 묶음 전체를 다른 항목들 오른쪽 빈 곳으로 옮긴다
  const others = canvas.items.filter((i) => !pos.has(i.id) && i.type !== 'frame' && i.type !== 'stroke')
  const rects = list.map((i) => ({ x: pos.get(i.id)[0], y: pos.get(i.id)[1], w: i.w, h: i.h }))
  let relocated = false
  if (others.length && rects.some((r) => others.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y))) {
    const ob = boundsOf(others)
    const nb = boundsOf(rects)
    const dx = ob.x + ob.w + 80 - nb.x
    const dy = ob.y - nb.y
    for (const [k, v] of pos) pos.set(k, [v[0] + dx, v[1] + dy])
    relocated = true
  }
  const items = canvas.items.map((i) => {
    const p = pos.get(i.id)
    if (!p) return i
    const nx = Math.round(p[0])
    const ny = Math.round(p[1])
    return nx === i.x && ny === i.y ? i : { ...i, x: nx, y: ny }
  })
  const moved = items.filter((it, k) => it !== canvas.items[k]).length
  if (!moved) return { noop: true, summary: '이미 그 배치입니다', result: { moved: 0 } }
  const frames = framesIn(canvas.items)
  const leftFrame = list.filter((i) => frameOfItem(i, frames)).filter((i) => { const n = items.find((x) => x.id === i.id); return frameOfItem(n, frames)?.id !== frameOfItem(i, frames)?.id }).length
  const after = boundsOf(items.filter((i) => pos.has(i.id)))
  return {
    items, focus: [...pos.keys()], fit: true,
    summary: `항목 ${moved}개를 ${mode} 로 배치했습니다`,
    result: { moved, mode, area: [Math.round(after.x), Math.round(after.y), Math.round(after.w), Math.round(after.h)], ...(relocated && { relocated: '다른 항목과 겹쳐 오른쪽 빈 곳으로 옮겼다' }), ...(leftFrame && { warning: `${leftFrame}개가 원래 프레임 밖으로 나갔다. 프레임이 필요하면 cluster_items 로 다시 묶는다` }), note: mode === 'radial' ? `가운데 항목: ${list.find((i) => i.id === (args.center || list[0].id))?.id}` : undefined },
  }
}

// ───────────────────────── 틀 ─────────────────────────

export function opAddFrameTemplate(canvas, args, ctx = {}) {
  const key = TEMPLATE_NAMES[args?.name]
  if (!key) fail(`name 은 ${Object.keys(TEMPLATE_NAMES).join(', ')} 중 하나여야 합니다`)
  const built = buildTemplate(key)
  if (!built.items.length) fail('빈 틀입니다')
  if ((ctx.totalItems ?? 0) + built.items.length + 1 > MAX_ITEMS) fail(`보드에는 항목을 ${MAX_ITEMS}개까지 둘 수 있습니다`)
  const tb = boundsOf(built.items)
  const existing = canvas.items.filter((i) => i.type !== 'stroke')
  const eb = boundsOf(existing)
  const v = ctx.view || { x: 0, y: 0, w: 1000, h: 700 }
  const ox = Math.round((eb ? eb.x : v.x + 40) - tb.x)
  const oy = Math.round((eb ? eb.y + eb.h + 140 : v.y + 40) - tb.y + (args.title ? 60 : 0))
  let z = canvas.items.reduce((m, i) => Math.max(m, i.z || 0), 0)
  const made = built.items.map((i) => ({ ...i, id: (ctx.newId || defaultId)(), x: i.x + ox, y: i.y + oy, z: ++z }))
  const idMap = new Map(built.items.map((i, k) => [i.id, made[k].id]))
  const conns = built.connections.map((c) => ({ ...c, id: (ctx.newId || defaultId)('c'), from: idMap.get(c.from), to: idMap.get(c.to) })).filter((c) => c.from && c.to)
  let title = null
  const title0 = typeof args.title === 'string' ? args.title.trim().slice(0, 100) : ''
  if (title0) title = { id: (ctx.newId || defaultId)(), type: 'text', x: Math.round(tb.x + ox), y: Math.round(tb.y + oy - 60), w: 900, h: 44, color: null, z: ++z, data: { text: title0, size: 32, bold: true } }
  const items = [...canvas.items, ...made, ...(title ? [title] : [])]
  const frames = made.filter((m) => m.type === 'frame').map((f) => f.data?.name)
  const labels = made.filter((m) => m.type === 'text').map((m) => m.data?.text).filter(Boolean).slice(0, 14)
  const slots = made.filter(isPlaceholder).length
  return {
    items, connections: [...canvas.connections, ...conns], focus: [...made.map((m) => m.id), ...(title ? [title.id] : [])], fit: true,
    summary: `${TEMPLATES.find((t) => t.id === key)?.name || key} 틀을 넣었습니다`,
    result: { template: args.name, items: made.length, frames, labels, empty_slots: slots, next: '내용은 fill_template 에 label(프레임 이름 또는 칸 제목)과 text 로 채운다. 칸이 모자라면 같은 label 을 반복해도 새 스티커가 붙는다' },
  }
}

const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()
const centerOf = (i) => [i.x + i.w / 2, i.y + i.h / 2]

/** 라벨 하나에 해당하는 영역: { frame?, anchors? } */
function resolveLabel(canvas, label) {
  const frames = framesIn(canvas.items)
  const n = norm(label)
  const f = frames.find((x) => norm(x.data?.name) === n) || frames.find((x) => n && norm(x.data?.name).includes(n))
  if (f) return { kind: 'frame', frame: f }
  const labels = canvas.items.filter((i) => (i.type === 'text' || i.type === 'shape') && itemPlain(i))
  const hit = labels.find((i) => norm(itemPlain(i)) === n) || labels.find((i) => n && norm(itemPlain(i)).includes(n))
  if (hit) return { kind: 'label', item: hit }
  return null
}

export function opFillTemplate(canvas, args, ctx = {}) {
  const cells = args?.cells
  if (!Array.isArray(cells) || !cells.length) fail('cells 에 { label, text } 를 하나 이상 넣어 주세요')
  if (cells.length > 80) fail('한 번에 80칸까지 채울 수 있습니다')
  let items = canvas.items
  const filledIds = []
  const created = []
  const errors = []
  const used = new Set()
  let z = items.reduce((m, i) => Math.max(m, i.z || 0), 0)
  const labelsHelp = () => {
    const fr = framesIn(items).map((f) => f.data?.name).filter(Boolean)
    const tx = items.filter((i) => i.type === 'text' && itemPlain(i)).map((i) => itemPlain(i)).slice(0, 12)
    return `프레임: ${fr.join(', ') || '없음'} / 칸 제목: ${tx.join(', ') || '없음'}`
  }
  for (const c of cells.slice(0, 80)) {
    if (!c || typeof c.label !== 'string' || typeof c.text !== 'string' || !c.text.trim()) { errors.push('label, text 가 모두 필요'); continue }
    const text = c.text.trim().slice(0, 500)
    const [rowLabel, colLabel] = c.label.split('/').map((s) => s.trim())
    const target = resolveLabel({ ...canvas, items }, rowLabel)
    if (!target) { errors.push(`"${clip(c.label, 24)}" 칸을 찾지 못함. ${labelsHelp()}`); continue }
    const stickies = items.filter((i) => i.type === 'sticky' && !used.has(i.id))
    let slot = null
    if (target.kind === 'frame') {
      const f = target.frame
      slot = stickies.filter((s) => isPlaceholder(s) && s.x >= f.x && s.y >= f.y && s.x + s.w <= f.x + f.w && s.y + s.h <= f.y + f.h).sort((a, b) => a.y - b.y || a.x - b.x)[0]
    } else {
      const [lx, ly] = centerOf(target.item)
      let want = null
      if (colLabel) {
        const col = resolveLabel({ ...canvas, items }, colLabel)
        if (col?.kind === 'label') want = centerOf(col.item)
      }
      const cand = stickies.filter((s) => isPlaceholder(s) && (s.x + s.w / 2 >= lx - 40 || s.y + s.h / 2 >= ly - 40))
      cand.sort((a, b) => {
        const da = want ? Math.abs(centerOf(a)[1] - ly) + Math.abs(centerOf(a)[0] - want[0]) : Math.hypot(centerOf(a)[0] - lx, centerOf(a)[1] - ly)
        const db = want ? Math.abs(centerOf(b)[1] - ly) + Math.abs(centerOf(b)[0] - want[0]) : Math.hypot(centerOf(b)[0] - lx, centerOf(b)[1] - ly)
        return da - db
      })
      slot = cand[0]
      // 한 줄 안(같은 행)이나 근처가 아니면 엉뚱한 칸이니 거른다
      if (slot && !want && Math.hypot(centerOf(slot)[0] - lx, centerOf(slot)[1] - ly) > 520) slot = null
    }
    if (slot) {
      used.add(slot.id)
      items = items.map((i) => (i.id === slot.id ? { ...i, data: { ...i.data, text } } : i))
      filledIds.push(slot.id)
      continue
    }
    // 빈 자리가 없으면 새 스티커를 근처에 붙인다
    const anchor = target.kind === 'frame' ? target.frame : target.item
    const siblings = items.filter((i) => i.type === 'sticky' && (target.kind === 'frame' ? i.x >= anchor.x && i.y >= anchor.y && i.x + i.w <= anchor.x + anchor.w && i.y + i.h <= anchor.y + anchor.h : Math.hypot(centerOf(i)[0] - centerOf(anchor)[0], centerOf(i)[1] - centerOf(anchor)[1]) < 520))
    const color = siblings[0]?.color || 'yellow'
    const size = siblings[0]?.w || STICKY
    const placed = findSpot(items, target.kind === 'frame' ? anchor : { x: anchor.x, y: anchor.y + anchor.h + 12, w: 440, h: 600 }, size)
    if (!placed) { errors.push(`"${clip(c.label, 24)}" 칸에 놓을 빈 자리가 없음`); continue }
    const st = { id: (ctx.newId || defaultId)(), type: 'sticky', x: placed.x, y: placed.y, w: size, h: size, color, z: ++z, data: { text } }
    items = [...items, st]
    created.push(st.id)
    filledIds.push(st.id)
    used.add(st.id)
  }
  if (!filledIds.length) fail(errors[0] || '채운 칸이 없습니다')
  return { items, focus: filledIds, summary: `${filledIds.length}칸을 채웠습니다`, result: { filled: filledIds.length - created.length, added_new: created.length, errors: errors.slice(0, 6), next: errors.length ? 'errors 의 label 을 고쳐 다시 보낸다' : undefined } }
}

function findSpot(items, area, size) {
  const gap = 16
  const others = items.filter((i) => i.type !== 'frame' && i.type !== 'stroke')
  const cols = Math.max(1, Math.floor((area.w - gap) / (size + gap)))
  for (let row = 0; row < 60; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const r = { x: Math.round(area.x + gap + col * (size + gap)), y: Math.round(area.y + gap + row * (size + gap)), w: size, h: size }
      if (!others.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)) return r
    }
  }
  return null
}

// ───────────────────────── 스타일·댓글 ─────────────────────────

export function opSetItemStyle(canvas, args) {
  const ids = Array.isArray(args?.ids) ? args.ids.filter((x) => typeof x === 'string') : []
  if (!ids.length) fail('ids 가 필요합니다')
  if (ids.length > 300) fail('한 번에 300개까지 바꿀 수 있습니다')
  let color
  if (args.color !== undefined) {
    color = colorName(args.color)
    if (color === null || color === undefined) fail(`color 는 ${COLOR_ORDER.join(', ')} 중 하나여야 합니다(한글 이름도 됨)`)
  }
  let size
  if (args.size !== undefined) {
    size = Math.round(Number(args.size))
    if (!Number.isFinite(size) || size < 12 || size > 96) fail('size 는 12~96 입니다(글 상자의 글자 크기)')
  }
  if (args.bold !== undefined && typeof args.bold !== 'boolean') fail('bold 는 true 또는 false')
  if (color === undefined && size === undefined && args.bold === undefined) fail('color, size, bold 중 하나는 필요합니다')
  const want = new Set(ids)
  let changed = 0
  const skipped = []
  const items = canvas.items.map((i) => {
    if (!want.has(i.id)) return i
    if (i.locked || i.type === 'stroke') { skipped.push({ id: i.id, why: '잠김 또는 펜 획' }); return i }
    let n = { ...i, data: { ...i.data } }
    if (color !== undefined) { if (['sticky', 'shape', 'keyword', 'memo', 'frame', 'text'].includes(i.type)) n.color = color; else skipped.push({ id: i.id, why: `${i.type} 는 색이 없음` }) }
    if (size !== undefined) { if (i.type === 'text') n.data.size = size; else skipped.push({ id: i.id, why: 'size 는 글 상자(text)만' }) }
    if (args.bold !== undefined) { if (i.type === 'text') n.data.bold = args.bold; else skipped.push({ id: i.id, why: 'bold 는 글 상자(text)만' }) }
    if (JSON.stringify(n) === JSON.stringify(i)) return i
    changed += 1
    return n
  })
  const missing = ids.filter((x) => !canvas.items.some((i) => i.id === x))
  if (!changed) return { noop: true, summary: '바뀐 것이 없습니다', result: { changed: 0, skipped: skipped.slice(0, 8), missing: missing.slice(0, 4) } }
  return { items, focus: ids, summary: `항목 ${changed}개 모양을 바꿨습니다`, result: { changed, skipped: skipped.slice(0, 8), missing: missing.slice(0, 4) } }
}

export function opCommentOnItem(canvas, args, ctx = {}) {
  const id = typeof args?.id === 'string' ? args.id : ''
  const it = canvas.items.find((i) => i.id === id)
  if (!it) fail(`항목 ${clip(id, 20)} 을(를) 찾지 못했습니다. read_canvas 로 id 를 확인하세요`)
  const text = typeof args.text === 'string' ? args.text.trim().slice(0, 1000) : ''
  if (!text) fail('text 가 필요합니다')
  const c = { id: (ctx.newId || defaultId)('m'), itemId: id, author: 'AI', text, at: new Date().toISOString(), resolved: false }
  return { comments: [...(canvas.comments || []), c], focus: [id], summary: '항목에 댓글을 달았습니다', result: { comment_id: c.id, item: id } }
}
