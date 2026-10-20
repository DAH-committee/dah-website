// 핵심 동작(HTTP 와 MCP 도구가 함께 쓴다). 권한 확인은 부르는 쪽이 이미 했다고 본다.
import { loadKordoc, HwpError } from './kordoc.js'
import { readDoc, presentBlock, unesc, gridOf } from './model.js'
import { alignIds, fingerprint } from './ids.js'
import { runEdit, EDIT_SUPPORT } from './run.js'
import { renderPages } from './render.js'
import { lintDoc, compareDocs, suggestRedaction, linearize } from './analysis.js'
import { toDocx, toTiptap } from './convert.js'
import { inspectUpload, firstIds, cacheGet, cacheSet, cacheDrop } from './service.js'
import * as store from './store.js'
import { newToken } from '../wsAccess.js'

const locks = new Map()
/** 같은 파일의 편집을 한 줄로 세운다(같은 인스턴스 안). 다른 인스턴스와의 충돌은 버전 번호(PK)가 막는다 */
export async function withFileLock(fileId, fn) {
  const prev = locks.get(fileId) || Promise.resolve()
  let release
  const mine = new Promise((r) => { release = r })
  const chain = prev.then(() => mine)
  locks.set(fileId, chain)
  await prev.catch(() => {})
  try { return await fn() } finally { release(); if (locks.get(fileId) === chain) locks.delete(fileId) }
}

export const contentOf = (file) => (file.content && typeof file.content === 'object' ? file.content : {})
export const currentVersionOf = (file) => contentOf(file).current_version || 1

export function fileInfo(file, level) {
  const c = contentOf(file)
  const fmt = c.format || 'hwpx'
  return {
    id: file.id, kind: 'hwp', title: file.title, format: fmt, size: c.size || 0, current_version: c.current_version || 1,
    page_count: c.page_count || 0, level, can_edit: level === 'editor', created_at: file.created_at, updated_at: file.updated_at,
    owner_email: file.owner_email, general_access: file.general_access, source: c.source || 'upload',
    edit_support: { hwpx: EDIT_SUPPORT.hwpx, hwp: EDIT_SUPPORT.hwp },
    render_mode: c.render_mode || 'layout',
  }
}

/** 버전 하나의 바이트·읽기 모델·id 표. 인스턴스 안 캐시 */
export async function loadVersion(file, version, req = null) {
  const v = version ? Number(version) : currentVersionOf(file)
  if (!Number.isInteger(v) || v < 1) throw new HwpError('BAD_REQUEST', '버전 번호가 올바르지 않습니다.', 400)
  const key = `${file.id}:${v}`
  let hit = cacheGet(key)
  if (hit) return hit
  const { bytes, row } = await store.readVersionBytes(file.id, v, req)
  const format = contentOf(file).format || 'hwpx'
  const doc = await readDoc(bytes, format)
  let ids = Array.isArray(row.block_ids) ? row.block_ids : []
  if (ids.length !== doc.blocks.length) {
    const a = alignIds(null, fingerprint(doc.blocks), row.id_counter || 0)
    ids = a.ids
  }
  hit = { version: v, bytes, row, doc, ids, format }
  cacheSet(key, hit)
  return hit
}

export async function outline(file, version) {
  const cur = await loadVersion(file, version)
  const { doc, ids } = cur
  const k = await loadKordoc()
  const headings = [], tables = []
  let paragraphs = 0, images = 0, chars = 0
  doc.blocks.forEach((b, i) => {
    if (b.type === 'heading') headings.push({ block: ids[i], level: b.level || 1, text: unesc(b.text), page: b.pageNumber || null })
    else if (b.type === 'table') {
      const first = (b.table.cells[0] || []).map((c) => unesc(c.text).slice(0, 40))
      tables.push({ block: ids[i], rows: b.table.rows, cols: b.table.cols, page: b.pageNumber || null, header: first })
      for (const r of b.table.cells) for (const c of r) chars += (c.text || '').length
    } else if (b.type === 'image') images++
    else { paragraphs++; chars += (b.text || '').length }
  })
  const fields = await fieldsOf(cur, k)
  const m = doc.metadata || {}
  return {
    version: cur.version, format: cur.format,
    metadata: { title: m.title || null, author: m.author || null, creator: m.creator || null, createdAt: m.createdAt || null, modifiedAt: m.modifiedAt || null, pageCount: doc.pageCount || m.pageCount || null, pageMode: doc.pageMode || null },
    headings, tables,
    stats: { blocks: doc.blocks.length, paragraphs, tables: tables.length, images, characters: chars },
    fields: fields.fields.slice(0, 200),
    has_header_footer: Boolean(doc.raw?.warnings?.some?.((w) => /머리말|꼬리말/.test(w.message || w))),
    protected: false,
  }
}

export async function blocksRange(file, version, from = 0, to = 200) {
  const cur = await loadVersion(file, version)
  const total = cur.doc.blocks.length
  const f = Math.max(0, Math.floor(Number(from) || 0))
  const t = Math.min(total, Math.max(f, Math.floor(Number(to) ?? 200)), f + 300)
  const blocks = []
  for (let i = f; i < t; i++) blocks.push(presentBlock(cur.doc.blocks[i], cur.ids[i], i, cur.doc.caps?.[i]))
  return { version: cur.version, total, from: f, to: t, blocks }
}

async function fieldsOf(cur, k) {
  const { doc, ids } = cur
  const out = []
  let confidence = null
  try {
    const f = k.extractFormFields(doc.blocks)
    confidence = f.confidence ?? null
    // 라벨 → 표 칸 위치 찾기
    const where = new Map()
    doc.blocks.forEach((b, i) => {
      if (b.type !== 'table') return
      gridOf(b.table).forEach((row, r) => row.forEach((x, c) => { if (x.cell && x.cell.text && !where.has(unesc(x.cell.text).trim())) where.set(unesc(x.cell.text).trim(), { i, r, c, x }) }))
    })
    for (const fl of f.fields || []) {
      const w = where.get(String(fl.label).trim())
      const o = { name: fl.label, kind: 'label', value: fl.value, empty: !String(fl.value || '').trim() }
      if (w) {
        o.block = ids[w.i]
        const g = gridOf(doc.blocks[w.i].table)
        let vc = w.c + w.x.cs
        while (g[w.r]?.[vc] && g[w.r][vc].covered) vc++
        if (g[w.r]?.[vc]?.cell) o.cell = `${ids[w.i]}#r${w.r}c${vc}`
      }
      out.push(o)
    }
  } catch { /* 양식이 아니면 비어 있다 */ }
  if (cur.format === 'hwpx') {
    try {
      const ch = await k.extractClickHereFields(cur.bytes.buffer.slice(cur.bytes.byteOffset, cur.bytes.byteOffset + cur.bytes.byteLength))
      for (const c of ch) out.push({ name: c.name, kind: 'clickhere', value: c.value, empty: !c.value, hint: c.placeholder || null })
    } catch { /* 누름틀 없음 */ }
  }
  return { fields: out, confidence }
}
export async function fields(file, version) {
  const cur = await loadVersion(file, version)
  const k = await loadKordoc()
  const f = await fieldsOf(cur, k)
  return { version: cur.version, ...f }
}

// ── 그리기(캐시) ───────────────────────────────────────────────
const pageCache = new Map()
let pageBytes = 0
const PAGE_CACHE_MAX_BYTES = 40 * 1024 * 1024
function pcGet(k) { const v = pageCache.get(k); if (v) { pageCache.delete(k); pageCache.set(k, v) } return v }
function pcSet(k, v) {
  const sz = (v.svg?.length || 0) + (v.image?.length || 0) + 2000
  pageCache.set(k, { ...v, _sz: sz }); pageBytes += sz
  while (pageBytes > PAGE_CACHE_MAX_BYTES && pageCache.size) { const [kk, vv] = pageCache.entries().next().value; pageCache.delete(kk); pageBytes -= vv._sz }
}
export const RENDER_LIMITS = { svg: 10, png: 6 }

export async function pages(file, { version, from = 1, to, as = 'svg', scale = 1, px = null }) {
  const cur = await loadVersion(file, version)
  const f = Math.max(1, Math.floor(Number(from) || 1))
  const t = Math.floor(Number(to) || f)
  const lim = as === 'png' ? RENDER_LIMITS.png : RENDER_LIMITS.svg
  if (t < f || t - f + 1 > lim) throw new HwpError('BAD_REQUEST', `한 번에 ${as === 'png' ? 'PNG 6쪽' : 'SVG 10쪽'}까지 그릴 수 있습니다.`, 400)
  const sc = Math.min(3, Math.max(0.5, Number(scale) || 1))
  const keys = []
  for (let n = f; n <= t; n++) keys.push(`${file.id}:${cur.version}:${n}:${as}:${px || sc}`)
  const hit = keys.map(pcGet)
  if (hit.every(Boolean)) {
    const meta = pcGet(`${file.id}:${cur.version}:meta`)
    if (meta) return { version: cur.version, page_count: meta.page_count, render_mode: meta.render_mode, warnings: meta.warnings, pages: hit.map(({ _sz, ...p }) => p) }
  }
  const r = await renderPages(cur.bytes, cur.format, { from: f, to: t, as, scale: sc, px }, cur.doc.blocks, cur.ids)
  pcSet(`${file.id}:${cur.version}:meta`, { page_count: r.page_count, render_mode: r.render_mode, warnings: r.warnings })
  r.pages.forEach((p) => pcSet(`${file.id}:${cur.version}:${p.n}:${as}:${px || sc}`, p))
  if (f > r.page_count) throw new HwpError('NOT_FOUND', `쪽 ${f} 가 없습니다(전체 ${r.page_count}쪽).`, 404)
  return { version: cur.version, page_count: r.page_count, render_mode: r.render_mode, warnings: r.warnings, pages: r.pages }
}

// ── 고치기 ────────────────────────────────────────────────────
export async function edit(file, body, { who, req }) {
  return withFileLock(file.id, async () => {
    const curV = currentVersionOf(file)
    const base = body.base_version === undefined || body.base_version === null ? null : Number(body.base_version)
    if (base !== null && base !== curV) throw new HwpError('VERSION_CONFLICT', '다른 사람이 먼저 고쳤습니다. 최신 버전을 다시 불러오세요.', 409, { current_version: curV })
    const cur = await loadVersion(file, curV, req)
    const counter = Math.max(cur.row.id_counter || 0, await store.currentCounter(file.id))
    const r = await runEdit({ bytes: cur.bytes, format: cur.format, ids: cur.ids, counter, ops: body.ops, strict: Boolean(body.strict) })
    const base_out = { applied: r.applied, skipped: r.skipped }
    if (r.strict_failed) {
      throw new HwpError('NO_VALID_OPS', '엄격 모드: 건너뛴 연산이 있어 아무것도 적용하지 않았습니다.', 422, { ...base_out, version: curV })
    }
    if (!r.changed) {
      if (r.applied.some((a) => a.dry_run)) return { version: curV, changed: false, ...base_out, verify: r.verify, dry_run: true }
      throw new HwpError('NO_VALID_OPS', '적용할 수 있는 편집이 하나도 없습니다.', 422, base_out)
    }
    const dry = Boolean(body.dry_run)
    if (dry) return { version: curV, changed: true, dry_run: true, would_create_version: curV + 1, ...base_out, verify: r.verify, pages_changed: r.pages_changed, diff_summary: r.diff_summary, blocks_changed: r.blocks_changed, block_ids_added: r.block_ids_added, block_ids_removed: r.block_ids_removed }
    const note = body.note ? String(body.note).slice(0, 200) : r.applied.map((a) => a.type).filter((v, i, s) => s.indexOf(v) === i).join(', ')
    const source = body.source === 'ai' ? 'ai' : 'user'
    const doc2 = await readDoc(r.bytes, cur.format)
    const added = await store.addVersion(file.id, { bytes: r.bytes, createdBy: who, note, source, parent: curV, diffSummary: r.diff_summary, blockIds: r.ids, counter: r.counter, pageCount: r.verify.page_count_after, expectCurrent: curV, req })
    const c = { ...contentOf(file), current_version: added.version, size: r.bytes.length, page_count: r.verify.page_count_after || contentOf(file).page_count || 0 }
    await store.setFileContent(file.id, c, { by: who })
    cacheSet(`${file.id}:${added.version}`, { version: added.version, bytes: r.bytes, row: { id_counter: r.counter }, doc: doc2, ids: r.ids, format: cur.format })
    return { version: added.version, changed: true, ...base_out, verify: r.verify, pages_changed: r.pages_changed, diff_summary: r.diff_summary, blocks_changed: r.blocks_changed, block_ids_added: r.block_ids_added, block_ids_removed: r.block_ids_removed }
  })
}

export async function restore(file, version, { who, req }) {
  return withFileLock(file.id, async () => {
    const curV = currentVersionOf(file)
    const row = await store.getVersionRow(file.id, Number(version))
    if (!row) throw new HwpError('NOT_FOUND', '그 버전을 찾을 수 없습니다.', 404)
    if (row.version === curV) throw new HwpError('BAD_REQUEST', '이미 현재 버전입니다.', 400)
    const ids = Array.isArray(row.block_ids) ? row.block_ids : []
    const counter = Math.max(row.id_counter || 0, await store.currentCounter(file.id))
    const added = await store.addVersion(file.id, { bytes: { length: row.size }, blobId: row.blob_id, sha: row.sha256, createdBy: who, note: `v${row.version} 로 되돌림`, source: 'restore', parent: curV, diffSummary: null, blockIds: ids, counter, pageCount: row.page_count, expectCurrent: curV, req })
    const c = { ...contentOf(file), current_version: added.version, size: row.size, page_count: row.page_count || contentOf(file).page_count || 0 }
    await store.setFileContent(file.id, c, { by: who })
    return { version: added.version, restored_from: row.version }
  })
}

// ── 분석 ──────────────────────────────────────────────────────
export async function lint(file, { version, numbers, styles }) {
  const cur = await loadVersion(file, version)
  return { version: cur.version, ...(await lintDoc(cur.doc.blocks, cur.ids, { numbers, styles })) }
}
export async function compare(file, { from, to }) {
  const a = await loadVersion(file, from)
  const b = await loadVersion(file, to)
  return { from: a.version, to: b.version, ...(await compareDocs(a.bytes, b.bytes, a.doc.blocks, a.ids, b.doc.blocks, b.ids)) }
}
export async function redactionSuggest(file, version) {
  const cur = await loadVersion(file, version)
  const hits = await suggestRedaction(cur.doc.blocks, cur.ids)
  return { version: cur.version, hits: hits.slice(0, 500), total: hits.length }
}

export async function exportAs(file, fmt, version) {
  const cur = await loadVersion(file, version)
  const safe = String(file.title || '문서').replace(/[\\/:*?"<>|\r\n]/g, '').trim().slice(0, 80) || '문서'
  if (fmt === cur.format) return { bytes: cur.bytes, name: `${safe}.${cur.format}`, mime: cur.format === 'hwpx' ? 'application/haansofthwpx' : 'application/x-hwp' }
  if (fmt === 'hwpx' || fmt === 'hwp') throw new HwpError('BAD_REQUEST', `이 파일은 ${cur.format.toUpperCase()} 형식입니다. HWP 와 HWPX 는 서로 바꿀 수 없습니다(서식이 깨지기 때문).`, 400)
  if (fmt === 'md') return { bytes: Buffer.from(cur.doc.markdown || '', 'utf8'), name: `${safe}.md`, mime: 'text/markdown; charset=utf-8' }
  if (fmt === 'txt') return { bytes: Buffer.from(linearize(cur.doc.blocks, cur.ids).text, 'utf8'), name: `${safe}.txt`, mime: 'text/plain; charset=utf-8' }
  if (fmt === 'docx') {
    const d = await toDocx(cur.bytes, cur.format)
    return { bytes: d.bytes, name: `${safe}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', approximate: d.approximate }
  }
  if (fmt === 'pdf') throw new HwpError('NOT_IMPLEMENTED', 'PDF 내보내기는 서버에서 아직 지원하지 않습니다. 쪽 이미지(SVG)를 브라우저 인쇄로 PDF 로 저장하세요.', 501)
  throw new HwpError('BAD_REQUEST', '내보내기 형식은 hwpx, hwp, md, txt, docx 중 하나여야 합니다.', 400)
}

export async function toDocsContent(file, version) {
  const cur = await loadVersion(file, version)
  const t = await toTiptap(cur.bytes, cur.format)
  return t
}

/** 새 파일 만들기(업로드·가져오기·템플릿 공통) */
export async function createHwpFile({ bytes, filename, title, who, ownerEmail, team, source = 'upload', pre = null, req = null }) {
  const info = pre || (await inspectUpload(bytes, filename))
  const { ids, counter } = firstIds(info.doc.blocks)
  const name = (title || String(filename || '').replace(/\.[^.]+$/, '') || '제목 없는 한글 문서').slice(0, 200)
  const content = { format: info.format, current_version: 1, size: info.bytes.length, page_count: info.pageCount, source: info.converted_from ? 'docx' : source, protected: false, render_mode: 'layout' }
  const row = await store.createFileRow({ title: name, ownerEmail, createdBy: who, shareToken: newToken(), team, content })
  try {
    await store.addVersion(row.id, { bytes: info.bytes, createdBy: who, note: '처음 올림', source: 'import', parent: null, diffSummary: null, blockIds: ids, counter, pageCount: info.pageCount, req })
  } catch (e) {
    await store.deleteFileRow(row.id)
    throw e
  }
  cacheDrop(`${row.id}:`)
  return { file: row, info }
}
