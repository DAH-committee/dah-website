// 편집 계산(순수 함수): 경계 상자, 맞춤 선(스냅), 정렬·분배, 겹침 순서, 묶기, 복제, 목록 바꾸기.
import { SLIDE_H, SLIDE_W, nid } from './deckCore.js'

/** 회전을 반영한 화면 위 경계 상자 */
export function aabb(e) {
  const r = ((e.rotate || 0) * Math.PI) / 180
  if (!r) return { x: e.x, y: e.y, w: e.w, h: e.h }
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  const w = e.w * c + e.h * s
  const h = e.w * s + e.h * c
  return { x: e.x + e.w / 2 - w / 2, y: e.y + e.h / 2 - h / 2, w, h }
}

export function unionBox(els) {
  if (!els.length) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const e of els) {
    const b = aabb(e)
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.w)
    y2 = Math.max(y2, b.y + b.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * 끌기 맞춤: 움직이는 상자(box)의 왼쪽·가운데·오른쪽(위·가운데·아래)이 다른 요소나 슬라이드의 선에 가까우면 붙인다.
 * 반환: { dx, dy, guides: [{axis:'x'|'y', pos}] }
 */
export function snapBox(box, others, threshold) {
  const xs = [0, SLIDE_W / 2, SLIDE_W]
  const ys = [0, SLIDE_H / 2, SLIDE_H]
  for (const o of others) {
    const b = aabb(o)
    xs.push(b.x, b.x + b.w / 2, b.x + b.w)
    ys.push(b.y, b.y + b.h / 2, b.y + b.h)
  }
  const best = (edges, cands) => {
    let hit = null
    for (const e of edges) {
      for (const c of cands) {
        const d = c - e
        if (Math.abs(d) <= threshold && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, pos: c }
      }
    }
    return hit
  }
  const hx = best([box.x, box.x + box.w / 2, box.x + box.w], xs)
  const hy = best([box.y, box.y + box.h / 2, box.y + box.h], ys)
  const guides = []
  const dx = hx ? hx.d : 0
  const dy = hy ? hy.d : 0
  // 붙은 뒤 맞닿는 모든 선을 보여 준다
  const nb = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }
  if (hx) for (const e of [nb.x, nb.x + nb.w / 2, nb.x + nb.w]) if (xs.some((c) => Math.abs(c - e) < 0.5)) guides.push({ axis: 'x', pos: e })
  if (hy) for (const e of [nb.y, nb.y + nb.h / 2, nb.y + nb.h]) if (ys.some((c) => Math.abs(c - e) < 0.5)) guides.push({ axis: 'y', pos: e })
  return { dx, dy, guides }
}

/** 한 값(경계선 하나)을 맞춤 */
export function snapValue(v, cands, threshold) {
  let hit = null
  for (const c of cands) if (Math.abs(c - v) <= threshold && (!hit || Math.abs(c - v) < Math.abs(hit - v))) hit = c
  return hit
}

export function edgeCandidates(others, axis) {
  const out = axis === 'x' ? [0, SLIDE_W / 2, SLIDE_W] : [0, SLIDE_H / 2, SLIDE_H]
  for (const o of others) {
    const b = aabb(o)
    if (axis === 'x') out.push(b.x, b.x + b.w / 2, b.x + b.w)
    else out.push(b.y, b.y + b.h / 2, b.y + b.h)
  }
  return out
}

/**
 * 정렬 단위: 통째로 고른 묶음은 한 덩어리, 나머지는 요소 하나씩.
 * 반환: [{ ids: [...], box }]
 */
export function selectionUnits(els, ids) {
  const sel = els.filter((e) => ids.includes(e.id) && !e.locked && !e.hidden)
  const units = []
  const seen = new Set()
  for (const e of sel) {
    if (seen.has(e.id)) continue
    if (e.group) {
      const members = els.filter((x) => x.group === e.group)
      if (members.every((m) => ids.includes(m.id))) {
        const mine = members.filter((m) => !m.locked && !m.hidden)
        mine.forEach((m) => seen.add(m.id))
        units.push({ ids: mine.map((m) => m.id), box: unionBox(mine) })
        continue
      }
    }
    seen.add(e.id)
    units.push({ ids: [e.id], box: aabb(e) })
  }
  return units
}

function moveUnits(els, moves) {
  const d = new Map()
  for (const [u, dx, dy] of moves) for (const id of u.ids) d.set(id, [dx, dy])
  return els.map((e) => (d.has(e.id) ? { ...e, x: Math.round(e.x + d.get(e.id)[0]), y: Math.round(e.y + d.get(e.id)[1]) } : e))
}

/** 정렬: 덩어리가 하나면 슬라이드에, 여럿이면 선택 범위에 맞춘다 */
export function alignEls(els, ids, how) {
  const units = selectionUnits(els, ids)
  if (!units.length) return els
  const ref = units.length === 1 ? { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } : unionBox(units.map((u) => u.box))
  return moveUnits(
    els,
    units.map((u) => {
      const b = u.box
      let dx = 0
      let dy = 0
      if (how === 'left') dx = ref.x - b.x
      if (how === 'center') dx = ref.x + ref.w / 2 - (b.x + b.w / 2)
      if (how === 'right') dx = ref.x + ref.w - (b.x + b.w)
      if (how === 'top') dy = ref.y - b.y
      if (how === 'middle') dy = ref.y + ref.h / 2 - (b.y + b.h / 2)
      if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h)
      return [u, dx, dy]
    })
  )
}

/** 같은 간격으로 분배(덩어리 셋 이상). gap을 주면 그 간격으로 늘어놓는다(둘 이상) */
export function distributeEls(els, ids, axis, gap) {
  const units = selectionUnits(els, ids)
  if (units.length < (gap === undefined ? 3 : 2)) return els
  const key = axis === 'x' ? 'x' : 'y'
  const size = axis === 'x' ? 'w' : 'h'
  const sorted = [...units].sort((a, b) => a.box[key] - b.box[key] || a.box[size] - b.box[size])
  const first = sorted[0].box
  const last = sorted[sorted.length - 1].box
  const total = sorted.reduce((s, u) => s + u.box[size], 0)
  const g = gap === undefined ? (last[key] + last[size] - first[key] - total) / (sorted.length - 1) : gap
  let p = first[key]
  const moves = []
  for (const u of sorted) {
    const d = p - u.box[key]
    moves.push([u, key === 'x' ? d : 0, key === 'y' ? d : 0])
    p += u.box[size] + g
  }
  return moveUnits(els, moves)
}

/** 고른 덩어리 사이 간격: 같으면 숫자, 다르면 null. axis는 퍼진 쪽 */
export function selectionGap(els, ids) {
  const units = selectionUnits(els, ids)
  if (units.length < 2) return { axis: null, gap: null }
  const all = unionBox(units.map((u) => u.box))
  const spanX = units.reduce((s, u) => s + u.box.w, 0)
  const spanY = units.reduce((s, u) => s + u.box.h, 0)
  const axis = all.w - spanX >= all.h - spanY ? 'x' : 'y'
  const key = axis
  const size = axis === 'x' ? 'w' : 'h'
  const sorted = [...units].sort((a, b) => a.box[key] - b.box[key])
  const gaps = []
  for (let i = 1; i < sorted.length; i++) gaps.push(Math.round(sorted[i].box[key] - (sorted[i - 1].box[key] + sorted[i - 1].box[size])))
  const same = gaps.every((g) => Math.abs(g - gaps[0]) <= 1)
  return { axis, gap: same ? gaps[0] : null }
}

/** 간격 정리: 줄(행)을 찾아 줄마다 같은 간격으로, 줄 사이도 같은 간격으로 */
export function tidyEls(els, ids) {
  const units = selectionUnits(els, ids)
  if (units.length < 2) return els
  const byY = [...units].sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2))
  const rows = []
  for (const u of byY) {
    const r = rows[rows.length - 1]
    const cy = u.box.y + u.box.h / 2
    if (r && cy <= r.y2) {
      r.items.push(u)
      r.y2 = Math.max(r.y2, u.box.y + u.box.h)
    } else rows.push({ items: [u], y1: u.box.y, y2: u.box.y + u.box.h })
  }
  const avgGap = (list, key, size) => {
    if (list.length < 2) return 0
    const s = [...list].sort((a, b) => a[key] - b[key])
    let t = 0
    for (let i = 1; i < s.length; i++) t += Math.max(0, s[i][key] - (s[i - 1][key] + s[i - 1][size]))
    return Math.round(t / (s.length - 1))
  }
  const rowGaps = rows.map((r) => avgGap(r.items.map((u) => u.box), 'x', 'w')).filter((g, i) => rows[i].items.length > 1)
  const gx = rowGaps.length ? Math.round(rowGaps.reduce((a, b) => a + b, 0) / rowGaps.length) : 0
  const rowBoxes = rows.map((r) => ({ y: Math.min(...r.items.map((u) => u.box.y)), h: Math.max(...r.items.map((u) => u.box.y + u.box.h)) - Math.min(...r.items.map((u) => u.box.y)) }))
  const gy = rows.length > 1 ? avgGap(rowBoxes, 'y', 'h') : 0
  const left = Math.min(...units.map((u) => u.box.x))
  const moves = []
  let y = rowBoxes[0].y
  rows.forEach((r, ri) => {
    let x = left
    for (const u of [...r.items].sort((a, b) => a.box.x - b.box.x)) {
      moves.push([u, x - u.box.x, y - u.box.y])
      x += u.box.w + gx
    }
    y += rowBoxes[ri].h + gy
  })
  return moveUnits(els, moves)
}

/** 겹침 순서: 'front' | 'back' | 'forward' | 'backward' */
export function reorderZ(els, ids, how) {
  const sorted = [...els].sort((a, b) => (a.z || 0) - (b.z || 0))
  const isSel = (e) => ids.includes(e.id)
  let out
  if (how === 'front') out = [...sorted.filter((e) => !isSel(e)), ...sorted.filter(isSel)]
  else if (how === 'back') out = [...sorted.filter(isSel), ...sorted.filter((e) => !isSel(e))]
  else {
    out = [...sorted]
    if (how === 'forward') {
      for (let i = out.length - 2; i >= 0; i--) if (isSel(out[i]) && !isSel(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]]
    } else {
      for (let i = 1; i < out.length; i++) if (isSel(out[i]) && !isSel(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]]
    }
  }
  const z = new Map(out.map((e, i) => [e.id, i + 1]))
  return els.map((e) => ({ ...e, z: z.get(e.id) }))
}

export const maxZ = (els) => els.reduce((m, e) => Math.max(m, e.z || 0), 0)

/** 요소 복제: 새 id, 묶음 id도 새로(같은 묶음끼리는 유지) */
export function cloneEls(list, dx = 0, dy = 0, zBase = 0, keep = false) {
  const groups = new Map()
  return list.map((e, i) => {
    let group = e.group
    if (group) {
      if (!groups.has(group)) groups.set(group, nid('g'))
      group = groups.get(group)
    }
    return { ...JSON.parse(JSON.stringify(e)), id: nid('e'), group, x: e.x + dx, y: e.y + dy, z: zBase + i + 1, role: keep || e.role === 'deco' ? e.role : undefined, locked: keep ? e.locked : false, mid: undefined }
  })
}

/** 슬라이드 복제. 요소마다 mid(짝 표시)를 남겨 발표의 매직 무브가 같은 요소를 이어 움직이게 한다 */
export function cloneSlide(s) {
  const src = [...s.elements].sort((a, b) => (a.z || 0) - (b.z || 0))
  const groupMap = new Map()
  const els = cloneEls(src, 0, 0, 0, true).map((e, i) => {
    if (src[i].group) groupMap.set(src[i].group, e.group)
    return { ...e, mid: src[i].mid || src[i].id }
  })
  const out = { ...JSON.parse(JSON.stringify(s)), id: nid('s'), elements: els }
  if (s.stacks) out.stacks = Object.fromEntries(Object.entries(s.stacks).filter(([g]) => groupMap.has(g)).map(([g, v]) => [groupMap.get(g), { ...v, frame: v.frame ? els[src.findIndex((e) => e.id === v.frame)]?.id : undefined }]))
  return out
}

/** 상자 전체를 목록으로 바꾸거나(같은 목록이면) 문단으로 되돌린다 */
export function toggleListHtml(html, kind) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html')
  const body = doc.body
  const lists = body.querySelectorAll('ul, ol')
  const top = [...body.children]
  const allList = top.length > 0 && top.every((n) => n.tagName === 'UL' || n.tagName === 'OL')
  if (allList && top.every((n) => n.tagName.toLowerCase() === kind)) {
    // 목록 → 문단
    const lis = [...body.querySelectorAll('li')]
    return lis.map((li) => `<p>${[...li.childNodes].filter((n) => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map((n) => (n.nodeType === 1 ? n.outerHTML : n.textContent)).join('') || '<br>'}</p>`).join('')
  }
  if (allList || lists.length) {
    // 다른 종류 목록 → 바꾸기
    for (const l of [...lists]) {
      const n = doc.createElement(kind)
      n.innerHTML = l.innerHTML
      l.replaceWith(n)
    }
    if (allList) return body.innerHTML
  }
  // 문단 → 목록
  const items = []
  for (const n of [...body.childNodes]) {
    if (n.nodeType === 3) {
      if (n.textContent.trim()) items.push(n.textContent)
    } else if (n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName)) items.push(null, n.outerHTML)
    else if (n.nodeType === 1) items.push(n.innerHTML)
  }
  let out = ''
  let open = false
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it === null) {
      if (open) out += `</${kind}>`
      open = false
      out += items[++i]
      continue
    }
    if (!open) {
      out += `<${kind}>`
      open = true
    }
    out += `<li>${it}</li>`
  }
  if (open) out += `</${kind}>`
  return out || `<${kind}><li><br></li></${kind}>`
}

/** 유튜브·피그마 주소에서 임베드 주소를 바로 만든다(미리보기 서버가 없을 때 대신) */
export function guessEmbed(url) {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\./, '')
    let id = ''
    if (h === 'youtu.be') id = u.pathname.slice(1)
    else if (/(^|\.)youtube\.com$/.test(h)) id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1] || ''
    if (id && /^[\w-]{6,20}$/.test(id)) return { kind: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, siteName: 'YouTube' }
    if (/(^|\.)figma\.com$/.test(h) && /^\/(file|design|proto|board|slides)\//.test(u.pathname)) return { kind: 'figma', embedUrl: `https://www.figma.com/embed?embed_host=dah-workspace&url=${encodeURIComponent(url)}`, siteName: 'Figma' }
    if (/(^|\.)notion\.(so|site)$/.test(h)) return { kind: 'notion', siteName: 'Notion' }
  } catch {
    return null
  }
  return null
}

// ── 똑똑한 맞춤선(끌기) ─────────────────────────────────
// 반환 guides: { kind:'line', axis, pos, from, to } (보라 대신 빨강 선, 붙은 물체 사이만)
//            { kind:'gap', axis, from, to, at, label }   (간격 표시: axis 'x'면 가로 간격)
const overlap1 = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1)

function gapsAlong(others, box, axis) {
  // box와 수직 방향으로 겹치는 이웃들(같은 줄)
  const k = axis
  const sz = axis === 'x' ? 'w' : 'h'
  const pk = axis === 'x' ? 'y' : 'x'
  const psz = axis === 'x' ? 'h' : 'w'
  const row = others.filter((o) => overlap1(o[pk], o[pk] + o[psz], box[pk], box[pk] + box[psz]) > 0)
  const sorted = [...row].sort((a, b) => a[k] - b[k])
  const pairs = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]
      const b = sorted[j]
      const g = b[k] - (a[k] + a[sz])
      if (g <= 0) continue
      // 사이에 다른 물체가 없을 때만
      if (sorted.some((c, m) => m !== i && m !== j && c[k] >= a[k] + a[sz] && c[k] + c[sz] <= b[k])) continue
      pairs.push({ a, b, g })
    }
  }
  return { row: sorted, pairs }
}

/**
 * 옮기는 상자를 슬라이드·다른 요소의 선과 같은 간격에 붙인다.
 * others: 다른 요소들의 경계 상자 목록. 반환 { dx, dy, guides }
 */
export function smartSnap(box, otherEls, threshold, { snap = true } = {}) {
  const others = otherEls.map((o) => (o.w !== undefined && o.id === undefined ? o : aabb(o)))
  const slideBox = { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }
  let dx = 0
  let dy = 0
  if (snap) {
    for (const axis of ['x', 'y']) {
      const sz = axis === 'x' ? 'w' : 'h'
      const cands = []
      for (const o of [slideBox, ...others]) cands.push(o[axis], o[axis] + o[sz] / 2, o[axis] + o[sz])
      const edges = [box[axis], box[axis] + box[sz] / 2, box[axis] + box[sz]]
      let hit = null
      for (const e of edges) for (const c of cands) {
        const d = c - e
        if (Math.abs(d) <= threshold && (!hit || Math.abs(d) < Math.abs(hit))) hit = d
      }
      // 같은 간격 후보
      const { row, pairs } = gapsAlong(others, box, axis)
      const before = row.filter((o) => o[axis] + o[sz] <= box[axis] + box[sz] / 2).sort((a, b) => b[axis] + b[sz] - (a[axis] + a[sz]))[0]
      const after = row.filter((o) => o[axis] >= box[axis] + box[sz] / 2).sort((a, b) => a[axis] - b[axis])[0]
      const eq = []
      if (before && after) eq.push((before[axis] + before[sz] + after[axis] - box[sz]) / 2)
      for (const p of pairs) {
        if (before) eq.push(before[axis] + before[sz] + p.g)
        if (after) eq.push(after[axis] - p.g - box[sz])
      }
      for (const pos of eq) {
        const d = pos - box[axis]
        if (Math.abs(d) <= threshold && (hit === null || Math.abs(d) < Math.abs(hit) - 0.01)) hit = d
      }
      if (hit !== null) {
        if (axis === 'x') dx = hit
        else dy = hit
      }
    }
  }
  const nb = { x: Math.round(box.x + dx), y: Math.round(box.y + dy), w: box.w, h: box.h }
  return { dx: nb.x - box.x, dy: nb.y - box.y, guides: guidesFor(nb, others, slideBox) }
}

/** 놓인 상자 기준으로 보여 줄 선·간격 표시 */
export function guidesFor(nb, others, slideBox = { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }) {
  const guides = []
  for (const axis of ['x', 'y']) {
    const sz = axis === 'x' ? 'w' : 'h'
    const pk = axis === 'x' ? 'y' : 'x'
    const psz = axis === 'x' ? 'h' : 'w'
    for (const e of [nb[axis], nb[axis] + nb[sz] / 2, nb[axis] + nb[sz]]) {
      const hits = [slideBox, ...others].filter((o) => [o[axis], o[axis] + o[sz] / 2, o[axis] + o[sz]].some((c) => Math.abs(c - e) < 0.5))
      if (!hits.length) continue
      const from = Math.min(nb[pk], ...hits.map((o) => o[pk]))
      const to = Math.max(nb[pk] + nb[psz], ...hits.map((o) => o[pk] + o[psz]))
      const onlySlide = hits.length === 1 && hits[0] === slideBox
      guides.push({ kind: 'line', axis, pos: e, from: onlySlide ? 0 : from, to: onlySlide ? (axis === 'x' ? SLIDE_H : SLIDE_W) : to })
    }
    // 간격: 바로 옆 이웃과의 거리, 같은 간격이 있으면 모두 표시
    const { row, pairs } = gapsAlong(others, nb, axis)
    const before = row.filter((o) => o[axis] + o[sz] <= nb[axis]).sort((a, b) => b[axis] + b[sz] - (a[axis] + a[sz]))[0]
    const after = row.filter((o) => o[axis] >= nb[axis] + nb[sz]).sort((a, b) => a[axis] - b[axis])[0]
    const mine = []
    if (before) mine.push({ a: before, b: nb, g: nb[axis] - (before[axis] + before[sz]) })
    if (after) mine.push({ a: nb, b: after, g: after[axis] - (nb[axis] + nb[sz]) })
    const eqVals = new Set()
    for (const m of mine) {
      if (pairs.some((p) => Math.abs(p.g - m.g) < 0.5) || (mine.length === 2 && Math.abs(mine[0].g - mine[1].g) < 0.5)) eqVals.add(Math.round(m.g))
    }
    const all = [...mine.map((m) => ({ ...m, mine: true })), ...pairs.filter((p) => eqVals.has(Math.round(p.g)))]
    for (const m of all) {
      if (m.g <= 0) continue
      const eqOn = eqVals.has(Math.round(m.g))
      if (!eqOn && !m.mine) continue
      const lo = Math.max(m.a[pk], m.b[pk])
      const hi = Math.min(m.a[pk] + m.a[psz], m.b[pk] + m.b[psz])
      const at = hi > lo ? (lo + hi) / 2 : (m.a[pk] + m.a[psz] / 2 + m.b[pk] + m.b[psz] / 2) / 2
      guides.push({ kind: 'gap', axis, from: m.a[axis] + m.a[sz], to: m.b[axis], at, label: Math.round(m.g), equal: eqOn })
    }
  }
  return guides
}

/** 크기 조절 맞춤: 움직이는 변 하나를 다른 선에 붙인다 */
export function snapEdge(v, axis, otherEls, threshold) {
  return snapValue(v, edgeCandidates(otherEls, axis), threshold)
}

/** Alt 재기: 상자 a(선택)에서 상자 b(가리킨 것, 없으면 슬라이드)까지 거리 */
export function measureBetween(a, b) {
  const out = []
  const inside = b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h
  const ainb = a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h
  const cy = a.y + a.h / 2
  const cx = a.x + a.w / 2
  if (inside || ainb) {
    const [o, i] = inside ? [b, a] : [a, b]
    const icx = i.x + i.w / 2
    const icy = i.y + i.h / 2
    out.push({ axis: 'x', from: o.x, to: i.x, at: icy }, { axis: 'x', from: i.x + i.w, to: o.x + o.w, at: icy })
    out.push({ axis: 'y', from: o.y, to: i.y, at: icx }, { axis: 'y', from: i.y + i.h, to: o.y + o.h, at: icx })
  } else {
    if (b.x >= a.x + a.w) out.push({ axis: 'x', from: a.x + a.w, to: b.x, at: cy })
    else if (b.x + b.w <= a.x) out.push({ axis: 'x', from: b.x + b.w, to: a.x, at: cy })
    if (b.y >= a.y + a.h) out.push({ axis: 'y', from: a.y + a.h, to: b.y, at: cx })
    else if (b.y + b.h <= a.y) out.push({ axis: 'y', from: b.y + b.h, to: a.y, at: cx })
    // 겹치면 가까운 변끼리
    if (!out.length) {
      out.push({ axis: 'x', from: Math.min(a.x, b.x), to: Math.max(a.x, b.x), at: cy })
      out.push({ axis: 'y', from: Math.min(a.y, b.y), to: Math.max(a.y, b.y), at: cx })
    }
  }
  return out.filter((m) => Math.abs(m.to - m.from) >= 1).map((m) => ({ ...m, kind: 'gap', label: Math.round(Math.abs(m.to - m.from)), equal: false }))
}

/** 점 아래 요소들(위에 있는 것부터). 회전도 따진다 */
export function hitStack(els, p) {
  const out = []
  for (const e of els) {
    if (e.hidden) continue
    const cx = e.x + e.w / 2
    const cy = e.y + e.h / 2
    const r = (-(e.rotate || 0) * Math.PI) / 180
    const lx = (p.x - cx) * Math.cos(r) - (p.y - cy) * Math.sin(r)
    const ly = (p.x - cx) * Math.sin(r) + (p.y - cy) * Math.cos(r)
    const slack = e.type === 'shape' && e.data?.shape === 'line' ? Math.max(0, 12 - e.h / 2) : 0
    if (Math.abs(lx) <= e.w / 2 && Math.abs(ly) <= e.h / 2 + slack) out.push(e)
  }
  return out.sort((a, b) => (b.z || 0) - (a.z || 0))
}

/** 투명한 도형(채우기 없음) 아래 글은 글을 먼저 고른다 */
export function pickTop(stack) {
  if (!stack.length) return null
  const see = (e) => !(e.type === 'shape' && !e.style?.fill && !['line', 'icon'].includes(e.data?.shape))
  return stack.find(see) || stack[0]
}

/** 여러 요소를 경계 상자 비율로 함께 늘이고 줄인다 */
export function scaleEls(list, from, to) {
  const kx = from.w ? to.w / from.w : 1
  const ky = from.h ? to.h / from.h : 1
  return list.map((e) => {
    const cx = e.x + e.w / 2
    const cy = e.y + e.h / 2
    const ncx = to.x + (cx - from.x) * kx
    const ncy = to.y + (cy - from.y) * ky
    const r = Math.abs(Math.sin(((e.rotate || 0) * Math.PI) / 180))
    // 회전한 요소는 짧은 쪽 비율로 크기만 바꾼다
    const w = Math.max(4, r > 0.01 ? e.w * Math.min(kx, ky) : e.w * kx)
    const h = Math.max(4, r > 0.01 ? e.h * Math.min(kx, ky) : e.h * ky)
    return { ...e, x: Math.round(ncx - w / 2), y: Math.round(ncy - h / 2), w: Math.round(w), h: Math.round(h) }
  })
}

// ── 자동 배치(스택) ──────────────────────────────────────
// slide.stacks[groupId] = { dir: 'row'|'column', gap, pad, align: 'start'|'center'|'end', frame?: 배경 요소 id }
export function reflowStack(elements, gid, cfg) {
  const members = elements.filter((e) => e.group === gid && !e.hidden)
  const frame = cfg.frame ? members.find((e) => e.id === cfg.frame) : null
  const kids = members.filter((e) => e !== frame)
  if (!kids.length) return elements
  const row = cfg.dir === 'row'
  const k = row ? 'x' : 'y'
  const pk = row ? 'y' : 'x'
  const sz = row ? 'w' : 'h'
  const psz = row ? 'h' : 'w'
  const pad = Math.max(0, cfg.pad || 0)
  const gap = cfg.gap || 0
  const sorted = [...kids].sort((a, b) => a[k] + a[sz] / 2 - (b[k] + b[sz] / 2))
  const u = unionBox(kids)
  const origin = frame ? { x: frame.x + pad, y: frame.y + pad } : { x: u.x, y: u.y }
  const cross = Math.max(...kids.map((e) => e[psz]))
  const pos = new Map()
  let p = origin[k]
  for (const e of sorted) {
    let c = origin[pk]
    if (cfg.align === 'center') c += (cross - e[psz]) / 2
    if (cfg.align === 'end') c += cross - e[psz]
    pos.set(e.id, { [k]: Math.round(p), [pk]: Math.round(c) })
    p += e[sz] + gap
  }
  const main = p - gap - origin[k]
  return elements.map((e) => {
    if (pos.has(e.id)) {
      const n = pos.get(e.id)
      return e.x === n.x && e.y === n.y ? e : { ...e, ...n }
    }
    if (frame && e.id === frame.id) {
      const w = Math.round(row ? main + pad * 2 : cross + pad * 2)
      const h = Math.round(row ? cross + pad * 2 : main + pad * 2)
      return e.w === w && e.h === h ? e : { ...e, w, h }
    }
    return e
  })
}

export function applyStacks(slide) {
  if (!slide?.stacks) return slide
  let els = slide.elements
  const live = {}
  for (const [g, cfg] of Object.entries(slide.stacks)) {
    if (!els.some((e) => e.group === g)) continue
    live[g] = cfg
    els = reflowStack(els, g, cfg)
  }
  const keys = Object.keys(live)
  const stacks = keys.length ? (keys.length === Object.keys(slide.stacks).length ? slide.stacks : live) : undefined
  if (els === slide.elements && stacks === slide.stacks) return slide
  return { ...slide, elements: els, stacks }
}

// ── 붙여넣은 HTML(문서 도구, 웹) 정리 ────────────────────────
// 링크, 굵게·기울임·밑줄, 목록, 문단만 남긴다. 글자 색·크기는 상자 서식을 따르게 지운다.
export function cleanPastedHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
  const body = doc.body
  body.querySelectorAll('meta, style, script, title, link, head, colgroup').forEach((n) => n.remove())
  const wrap = (n, tag) => {
    const w = doc.createElement(tag)
    while (n.firstChild) w.appendChild(n.firstChild)
    n.appendChild(w)
  }
  const unwrap = (n) => n.replaceWith(...n.childNodes)
  for (const n of [...body.querySelectorAll('*')]) {
    const st = (n.getAttribute('style') || '').toLowerCase()
    const tag = n.tagName
    // 구글 문서는 전체를 font-weight:normal인 <b>로 감싼다
    if ((tag === 'B' || tag === 'STRONG') && /font-weight:\s*(normal|400)/.test(st)) {
      unwrap(n)
      continue
    }
    if (tag === 'SPAN' || tag === 'FONT' || tag === 'A' || tag === 'P' || tag === 'LI') {
      if (/font-weight:\s*(bold|[6-9]00)/.test(st)) wrap(n, 'b')
      if (/font-style:\s*italic/.test(st)) wrap(n, 'i')
      if (/text-decoration[^;]*underline/.test(st) && tag !== 'A') wrap(n, 'u')
      if (/text-decoration[^;]*line-through/.test(st)) wrap(n, 's')
    }
    if (/^H[1-6]$/.test(tag)) {
      const p = doc.createElement('p')
      const b = doc.createElement('b')
      while (n.firstChild) b.appendChild(n.firstChild)
      p.appendChild(b)
      n.replaceWith(p)
    }
  }
  for (const n of [...body.querySelectorAll('[style], [class], [id], [dir], [color], [face], [size]')]) {
    for (const a of ['style', 'class', 'id', 'dir', 'color', 'face', 'size']) n.removeAttribute(a)
  }
  // 목록 안 문단은 풀기
  body.querySelectorAll('li > p').forEach((p) => unwrap(p))
  return body.innerHTML.replace(/<!--[\s\S]*?-->/g, '').trim()
}

/** 발표에 쓰인 '#RRGGBB' 색(많이 쓴 순) */
export function deckColors(deck, limit = 14) {
  const count = new Map()
  const add = (v) => {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) count.set(v.toUpperCase(), (count.get(v.toUpperCase()) || 0) + 1)
  }
  for (const s of deck?.slides || []) {
    add(s.background?.color)
    for (const e of s.elements) {
      const st = e.style || {}
      for (const k of ['fill', 'stroke', 'color', 'headerFill', 'headerColor', 'line']) add(st[k])
      add(st.gradient?.from)
      add(st.gradient?.to)
      add(st.shadow?.color?.slice?.(0, 7))
      const m = String(e.data?.html || '').match(/#[0-9a-f]{6}/gi)
      if (m) m.forEach(add)
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c)
}

/** 요소 이름(레이어 목록) */
export function elementName(e) {
  if (e.name) return e.name
  if (e.type === 'text') {
    const t = String(e.data?.html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
    return t.slice(0, 40) || e.data?.placeholder || '텍스트'
  }
  if (e.type === 'shape') return { rect: '사각형', rounded: '둥근 사각형', ellipse: '타원', triangle: '삼각형', arrow: '화살표', line: '선', icon: '아이콘' }[e.data?.shape] || '도형'
  if (e.type === 'image') return e.data?.alt || '이미지'
  if (e.type === 'table') return '표'
  if (e.type === 'embed') return e.data?.title || '링크 카드'
  return '요소'
}
