// 그리기: kordoc renderDocument(조판 캐시 재생 / 없으면 reflow)로 쪽 SVG·PNG 와 영역(region)을 만들고, 영역을 블록·칸 id 로 잇는다.
import { loadKordoc } from './kordoc.js'
import { gridOf } from './model.js'

export async function renderPageCount(bytes, format) {
  try {
    const k = await loadKordoc()
    const r = await k.renderDocumentToScene(Buffer.from(bytes), { pages: '1' })
    return r.scene.pages.length
  } catch {
    return 0
  }
}

const rng = (a, b) => `${a}-${b}`

/** 쪽 범위 [from,to] (1부터) 그리기 → { page_count, pages:[{n,width,height,svg|image,regions}], warnings, render_mode } */
export async function renderPages(bytes, format, { from = 1, to = from, as = 'svg', scale = 1 }, blocks, ids) {
  const k = await loadKordoc()
  const buf = Buffer.from(bytes)
  const sel = rng(from, to)
  let scene, svgs = new Map(), pngs = new Map()
  if (as === 'png') {
    const maxWidthPx = Math.round(Math.min(3, Math.max(0.5, scale)) * 794)
    const r = await k.renderDocument(buf, { format: 'png', pages: sel, maxWidthPx })
    scene = r.scene
    for (const a of r.assets) if (a.page) pngs.set(a.page, a)
  } else {
    const r = await k.renderDocumentToScene(buf, { pages: sel })
    scene = r.scene
    svgs = r.pageSvgs
  }
  const regions = mapRegions(scene, blocks, ids)
  const pages = []
  for (const p of scene.pages) {
    if (p.page < from || p.page > to) continue
    const o = { n: p.page, width: p.width, height: p.height, regions: regions.filter((r) => r.bbox.page === p.page).map(({ bbox, ...r }) => ({ ...r, bbox: { x: round(bbox.x), y: round(bbox.y), width: round(bbox.width), height: round(bbox.height) } })) }
    if (as === 'png') {
      const a = pngs.get(p.page)
      if (a) { o.image = `data:image/png;base64,${Buffer.from(a.data).toString('base64')}`; o.image_width = a.width; o.image_height = a.height }
    } else {
      o.svg = svgs.get(p.page) || null
    }
    pages.push(o)
  }
  return { page_count: scene.pages.length, pages, warnings: scene.warnings || [], render_mode: renderMode(blocks, scene), stats: scene.stats }
}
const round = (v) => Math.round(v * 100) / 100

function renderMode(blocks, scene) {
  return scene.warnings?.some((w) => /reflow|조판 캐시/.test(w)) ? 'reflow' : 'layout'
}

/** 영역→블록 대응. 맞추지 못한 영역은 block 이 없다 */
export function mapRegions(scene, blocks, ids) {
  const out = []
  const tops = scene.regions.filter((r) => !r.parentId)
  const kids = new Map()
  for (const r of scene.regions) if (r.parentId) { const l = kids.get(r.parentId) || []; l.push(r); kids.set(r.parentId, l) }
  const tableIdx = [], textIdx = [], imageIdx = []
  blocks.forEach((b, i) => {
    if (b.type === 'table') tableIdx.push(i)
    else if (b.type === 'image') imageIdx.push(i)
    else if (b.type !== 'separator') textIdx.push(i)
  })
  const bySource = new Map()
  for (const i of tableIdx) if (blocks[i].table?.sourceId) bySource.set(String(blocks[i].table.sourceId), i)
  const tTop = tops.filter((r) => r.type === 'table')
  const pTop = tops.filter((r) => r.type === 'paragraph')
  const iTop = tops.filter((r) => r.type === 'image')
  const tableMapBySrc = tTop.every((r) => r.sourceId && bySource.has(String(r.sourceId)))
  const textExact = pTop.length === textIdx.length
  const blockOf = new Map() // region id → block index
  tTop.forEach((r, k) => {
    const i = tableMapBySrc || (r.sourceId && bySource.has(String(r.sourceId))) ? bySource.get(String(r.sourceId)) : tTop.length === tableIdx.length ? tableIdx[k] : undefined
    if (i !== undefined) blockOf.set(r.id, i)
  })
  if (textExact) pTop.forEach((r, k) => blockOf.set(r.id, textIdx[k]))
  else {
    // 개수가 안 맞으면 쪽별로 맞춰 본다(같은 쪽의 영역 수 = 그 쪽에서 시작하는 블록 수일 때만)
    const rp = new Map(), bp = new Map()
    for (const r of pTop) { const l = rp.get(r.page) || []; l.push(r); rp.set(r.page, l) }
    for (const i of textIdx) { const pg = blocks[i].pageNumber; if (!pg) continue; const l = bp.get(pg) || []; l.push(i); bp.set(pg, l) }
    for (const [pg, rs] of rp) { const bs = bp.get(pg); if (bs && bs.length === rs.length) rs.forEach((r, k) => blockOf.set(r.id, bs[k])) }
  }
  if (iTop.length === imageIdx.length) iTop.forEach((r, k) => blockOf.set(r.id, imageIdx[k]))
  const cellOfRegion = new Map()
  for (const r of tTop) {
    const bi = blockOf.get(r.id)
    if (bi === undefined) continue
    const g = gridOf(blocks[bi].table)
    const cells = []
    g.forEach((row, ri) => row.forEach((x, ci) => { if (x.cell) cells.push({ ri, ci, n: String(x.cell.text || '').split('\n').filter((l) => l.trim()).length }) }))
    const kp = (kids.get(r.id) || []).filter((q) => q.type === 'paragraph')
    const need = cells.reduce((a, c) => a + c.n, 0)
    if (kp.length === need) {
      let q = 0
      for (const c of cells) for (let t = 0; t < c.n; t++) cellOfRegion.set(kp[q++].id, `${ids[bi]}#r${c.ri}c${c.ci}`)
    }
  }
  for (const r of scene.regions) {
    const parent = r.parentId ? scene.regions.find((x) => x.id === r.parentId) : null
    const topId = parent && !parent.parentId ? parent.id : r.parentId ? null : r.id
    let bi = blockOf.get(r.id)
    if (bi === undefined && r.parentId) bi = blockOf.get(topId)
    for (const b of r.regions) {
      const o = { id: r.id, type: r.type, bbox: b }
      if (bi !== undefined) o.block = ids[bi]
      const cell = cellOfRegion.get(r.id)
      if (cell) o.cell = cell
      if (r.parentId) o.parent = r.parentId
      out.push(o)
    }
  }
  return out
}
