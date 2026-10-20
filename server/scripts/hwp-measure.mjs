// 한글 편집 엔진 서식 보존 측정. 사용: HWP_FIXTURES=<폴더> KORDOC_PATH=<kordoc> node scripts/hwp-measure.mjs [최대파일수] [--json 결과.json]
// 폴더의 *.hwpx 를 읽기만 한다(원본 수정 없음). 파일 내용은 출력하지 않고 숫자만 남긴다.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { runEdit } from '../src/lib/hwp/run.js'
import { readDoc, gridOf, unesc } from '../src/lib/hwp/model.js'
import { firstIds } from '../src/lib/hwp/service.js'
import { loadKordoc } from '../src/lib/hwp/kordoc.js'
import { renderPages } from '../src/lib/hwp/render.js'
import { openZip, readSections } from '../src/lib/hwp/xml.js'

const dir = process.env.HWP_FIXTURES
if (!dir) { console.error('HWP_FIXTURES 폴더를 지정하세요'); process.exit(1) }
const maxFiles = Number(process.argv[2]) || 40
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
const k = await loadKordoc()
const sharp = (await import('sharp')).default

const files = []
const seen = new Set()
for (const f of fs.readdirSync(dir)) {
  if (!/\.hwpx$/i.test(f)) continue
  const b = new Uint8Array(fs.readFileSync(path.join(dir, f)))
  const h = crypto.createHash('sha1').update(b).digest('hex')
  if (seen.has(h) || b.length > 6_000_000) continue
  seen.add(h)
  files.push({ f, b })
}
files.sort((a, b) => a.b.length - b.b.length)
// 한컴 조판 캐시가 있는 파일만(저장본)
const chosen = []
for (const x of files) {
  const zip = await openZip(x.b)
  const secs = await readSections(zip)
  if (secs.some((s) => s.xml.includes('linesegarray'))) chosen.push(x)
}
const step = Math.max(1, Math.floor(chosen.length / maxFiles))
const sample = chosen.filter((_, i) => i % step === 0).slice(0, maxFiles)
console.log(`고유 hwpx ${files.length}개 중 한컴 저장본 ${chosen.length}개, 측정 ${sample.length}개`)

const tok = (xml) => xml.split(/(<[^>]+>)/).filter(Boolean)
async function xmlDelta(a, b) {
  const [za, zb] = [await openZip(a), await openZip(b)]
  let changed = 0, total = 0
  for (const s of await readSections(za)) {
    const t = await zb.file(`Contents/section${s.index}.xml`)?.async('string')
    const A = tok(s.xml), B = tok(t || '')
    total += A.length
    let p = 0
    while (p < A.length && p < B.length && A[p] === B[p]) p++
    let q = 0
    while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++
    changed += Math.max(A.length - p - q, B.length - p - q)
  }
  return { changed, total }
}

async function pagePng(bytes, n, w = 700) {
  const r = await k.renderDocument(Buffer.from(bytes), { format: 'png', pages: String(n), maxWidthPx: w })
  const a = r.assets.find((x) => x.page === n)
  const { data, info } = await sharp(Buffer.from(a.data)).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, scale: a.scale, pageCount: r.scene.pages.length, scene: r.scene }
}
// 편집 영역(블록 bbox)을 뺀 나머지에서 달라진 픽셀 비율
async function pixelDiff(before, after, doc, ids, changedIds, pages) {
  let diffOut = 0, totalOut = 0, n = 0
  for (const pg of pages.slice(0, 4)) {
    let A, B
    try { A = await pagePng(before, pg); B = await pagePng(after, pg) } catch { continue }
    if (A.w !== B.w || A.h !== B.h) continue
    const rb = await renderPages(before, 'hwpx', { from: pg, to: pg, as: 'svg' }, doc.blocks, ids)
    const boxes = rb.pages[0].regions.filter((r) => r.block && changedIds.includes(r.block)).map((r) => r.bbox)
    const sc = A.scale
    const inBox = (x, y) => boxes.some((b) => x >= (b.x - 4) * sc && x <= (b.x + b.width + 4) * sc && y >= (b.y - 4) * sc && y <= (b.y + b.height + 4) * sc)
    for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
      if (boxes.length && inBox(x, y)) continue
      totalOut++
      if (Math.abs(A.data[y * A.w + x] - B.data[y * A.w + x]) > 40) diffOut++
    }
    n++
  }
  return n ? { frac: diffOut / Math.max(1, totalOut), pages: n } : null
}

function pickOps(doc, ids) {
  const picks = {}
  const bl = doc.blocks
  const pi = bl.findIndex((b, i) => (b.type === 'paragraph' || b.type === 'heading') && unesc(b.text).trim().length >= 6 && doc.caps?.[i]?.capability !== 'locked')
  if (pi >= 0) {
    const t = unesc(bl[pi].text)
    picks.replace_block = [{ op: 'replace_block', block: ids[pi], text: t.length > 20 ? t.slice(0, t.length - 3) + '(수정)' : t + ' (수정)' }]
    picks.insert_paragraph_after = [{ op: 'insert_paragraph_after', block: ids[pi], text: '새로 끼워 넣은 문단' }]
    const w = t.split(/\s+/).find((s) => s.length >= 2)
    if (w) {
      picks.replace_text_same = [{ op: 'replace_text', find: w, replace: '가'.repeat(w.length), all: false, scope: `block:${ids[pi]}` }]
      picks.replace_text_diff = [{ op: 'replace_text', find: w, replace: w + '추가', all: false, scope: `block:${ids[pi]}` }]
    }
    const di = bl.findIndex((b, i) => i > pi && (b.type === 'paragraph') && unesc(b.text).trim().length >= 3)
    if (di >= 0) picks.delete_block = [{ op: 'delete_block', block: ids[di] }]
  }
  for (let i = 0; i < bl.length; i++) {
    if (bl[i].type !== 'table') continue
    const g = gridOf(bl[i].table)
    let done = false
    for (let r = 0; r < g.length && !done; r++) for (let c = 0; c < g[r].length; c++) {
      const x = g[r][c]
      if (x.cell && unesc(x.cell.text).trim().length >= 2 && doc.caps?.[i]?.cells?.[r]?.[c]?.editable !== false && !x.cell.blocks) {
        picks.replace_cell = [{ op: 'replace_cell', table: ids[i], row: r, col: c, text: unesc(x.cell.text).trim() + ' (수정)' }]
        done = true; break
      }
    }
    if (done && bl[i].table.rows >= 2) {
      const ar = bl[i].table.rows - 1
      picks.table_add_rows = [{ op: 'table_add_rows', table: ids[i], after_row: ar, rows: [['추가 행']] }]
    }
    if (done) break
  }
  picks.redact = [{ op: 'redact' }]
  return picks
}

const stats = {}
const failures = []
const add = (op, rec) => { (stats[op] ||= []).push(rec) }
let idx = 0
for (const { f, b } of sample) {
  idx++
  const label = `f${String(idx).padStart(2, '0')}`
  let doc, ids, counter
  try {
    doc = await readDoc(b, 'hwpx')
    ;({ ids, counter } = firstIds(doc.blocks))
  } catch (e) { failures.push(`${label} read: ${e.message.slice(0, 60)}`); continue }
  const before = await xmlDelta(b, b)
  void before
  const picks = pickOps(doc, ids)
  for (const [name, ops] of Object.entries(picks)) {
    const rec = { file: label, ok: false }
    try {
      const t0 = Date.now()
      const r = await runEdit({ bytes: b, format: 'hwpx', ids, counter, ops })
      rec.ms = Date.now() - t0
      rec.applied = r.applied.length
      rec.skipped = r.skipped.map((s) => s.reason)
      if (!r.changed) { rec.ok = r.applied.some((a) => a.dry_run) ; add(name, rec); continue }
      rec.ok = true
      rec.valid = r.verify.ok
      rec.partsOnlySections = r.verify.untouched_parts_identical
      rec.pagesBefore = r.verify.page_count_before
      rec.pagesAfter = r.verify.page_count_after
      rec.pageCountSame = rec.pagesBefore === rec.pagesAfter
      const d = await xmlDelta(b, r.bytes)
      rec.xmlChanged = d.changed
      rec.xmlTotal = d.total
      const changedIds = [...new Set([...r.blocks_changed, ...r.block_ids_added])]
      const adjPages = [...new Set(doc.blocks.map((x) => x.pageNumber).filter(Boolean))]
      const pd = name === 'redact' ? null : await pixelDiff(b, r.bytes, doc, ids, changedIds.concat(ids.filter((_, i) => doc.blocks[i].pageNumber === undefined ? false : false)), (r.pages_changed.length ? r.pages_changed : [1]).slice(0, 2))
      if (pd) rec.pixelDiffOutside = pd.frac
      // 되읽기: 블록 수 변화
      const d2 = await readDoc(r.bytes, 'hwpx')
      rec.blockDelta = d2.blocks.length - doc.blocks.length
    } catch (e) {
      rec.error = String(e.message || e).slice(0, 100)
      failures.push(`${label} ${name}: ${rec.error}`)
    }
    add(name, rec)
  }
}

const pct = (x) => (x * 100).toFixed(2) + '%'
const summary = {}
for (const [op, recs] of Object.entries(stats)) {
  const tried = recs.length
  const changed = recs.filter((r) => r.valid !== undefined)
  const applied = changed.length
  const skipped = recs.filter((r) => r.valid === undefined && !r.error)
  const reasons = {}
  for (const s of skipped) for (const x of s.skipped) reasons[x] = (reasons[x] || 0) + 1
  const px = changed.filter((r) => r.pixelDiffOutside !== undefined).map((r) => r.pixelDiffOutside)
  const xmlr = changed.map((r) => r.xmlChanged / Math.max(1, r.xmlTotal))
  const fn = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  summary[op] = {
    tried, applied, skipped: skipped.length, skip_reasons: reasons, errors: recs.filter((r) => r.error).length,
    valid: changed.filter((r) => r.valid).length,
    parts_only_sections: changed.filter((r) => r.partsOnlySections).length,
    page_count_same: changed.filter((r) => r.pageCountSame).length,
    xml_changed_token_ratio_mean: fn(xmlr) === null ? null : pct(fn(xmlr)),
    xml_changed_token_ratio_max: xmlr.length ? pct(Math.max(...xmlr)) : null,
    pixel_diff_outside_mean: fn(px) === null ? null : pct(fn(px)), pixel_diff_outside_max: px.length ? pct(Math.max(...px)) : null, pixel_files: px.length,
    ms_mean: Math.round(fn(recs.filter((r) => r.ms).map((r) => r.ms)) || 0),
  }
}
console.log(JSON.stringify(summary, null, 1))
console.log('failures', failures.length, failures.slice(0, 20))
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ summary, stats, failures }, null, 1))
process.exit(0)
