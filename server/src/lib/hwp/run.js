// 편집 실행기: 연산 목록 → 새 바이트 + 보고. 검증에 실패하면 던진다(호출자는 새 버전을 만들지 않는다).
import { Ctx, MAX_OPS, opReplaceBlock, opReplaceCell, EDIT_SUPPORT } from './edit.js'
import { opInsertParagraph, opDeleteBlock, opTableAddRows, opFillFields, opReplaceText, opApplyMarkdown, opRedact, opPlaceSeal } from './editOps.js'
import { HwpError, loadKordoc } from './kordoc.js'
import { fingerprint } from './ids.js'
import { openZip } from './xml.js'
import { renderPageCount } from './render.js'

const HANDLERS = {
  replace_block: opReplaceBlock,
  replace_cell: opReplaceCell,
  insert_paragraph_after: opInsertParagraph,
  delete_block: opDeleteBlock,
  table_add_rows: opTableAddRows,
  fill_fields: opFillFields,
  replace_text: opReplaceText,
  apply_markdown: opApplyMarkdown,
  redact: opRedact,
  place_seal: opPlaceSeal,
}
export const TIME_BUDGET_MS = 50_000

/** 바뀐 ZIP 엔트리 이름 목록과, 안 바뀐 엔트리가 바이트까지 같은지 */
export async function zipDiff(aBytes, bBytes) {
  const [a, b] = [await openZip(aBytes), await openZip(bBytes)]
  const changed = []
  const names = new Set([...Object.keys(a.files), ...Object.keys(b.files)])
  for (const n of names) {
    const fa = a.files[n], fb = b.files[n]
    if (fa?.dir || fb?.dir) continue
    if (!fa || !fb) { changed.push(n); continue }
    const [x, y] = [await fa.async('uint8array'), await fb.async('uint8array')]
    if (x.length !== y.length || Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) changed.push(n)
  }
  return changed
}

export async function runEdit({ bytes, format, ids, counter, ops, strict = false }) {
  if (!Array.isArray(ops) || !ops.length) throw new HwpError('BAD_REQUEST', '편집할 연산(ops)이 없습니다.', 400)
  if (ops.length > MAX_OPS) throw new HwpError('BAD_REQUEST', `한 번에 ${MAX_OPS}개까지 편집할 수 있습니다.`, 400)
  const ctx = new Ctx({ bytes, format, ids, counter })
  await ctx.init()
  const startDoc = ctx.doc
  const startIds = ctx.ids.slice()
  const startKeys = new Map(fingerprint(startDoc.blocks).keys.map((k, i) => [startIds[i], k]))
  const pagesBefore = await renderPageCount(bytes, format)
  const t0 = Date.now()
  for (let n = 0; n < ops.length; n++) {
    const op = ops[n] || {}
    const type = String(op.op || op.type || '')
    const h = HANDLERS[type]
    if (!h) { ctx.skip(n, type || '?', 'UNSUPPORTED', `알 수 없는 연산입니다: ${type}`); continue }
    if (Date.now() - t0 > TIME_BUDGET_MS) { ctx.skip(n, type, 'TIMEOUT', '처리 시간이 길어 남은 연산을 건너뜁니다.'); continue }
    const snap = { bytes: ctx.bytes, ids: ctx.ids, counter: ctx.counter }
    try {
      await h(ctx, op, n)
    } catch (e) {
      try { await ctx.swap(snap.bytes, snap.ids) } catch { /* 이미 원래 상태 */ }
      ctx.counter = Math.max(ctx.counter, snap.counter)
      ctx.skip(n, type, 'ERROR', `처리 중 오류가 나서 이 연산은 적용하지 않았습니다: ${String(e.message || e).slice(0, 160)}`)
    }
  }
  const changed = ctx.bytes !== bytes && Buffer.compare(Buffer.from(ctx.bytes), Buffer.from(bytes)) !== 0
  const k = ctx.k
  const result = { applied: ctx.applied, skipped: ctx.skipped, changed, bytes: ctx.bytes, ids: ctx.ids, counter: ctx.counter }
  if (strict && ctx.skipped.length) return { ...result, changed: false, bytes, ids: startIds, counter, strict_failed: true }
  if (!changed) return { ...result, verify: { ok: true, issues: [], page_count_before: pagesBefore, page_count_after: pagesBefore, changed_parts: [] }, diff_summary: { added: 0, removed: 0, modified: 0, unchanged: startDoc.blocks.length }, pages_changed: [], blocks_changed: [], block_ids_added: [], block_ids_removed: [] }
  // 최종 검증
  const issues = []
  if (format === 'hwpx') {
    // 원본에 이미 있던 구조 경고(한컴이 저장한 파일에도 드물게 있다)는 탓하지 않고, 새로 생긴 것만 실패로 본다
    const base = new Set()
    const v0 = await k.validateHwpx(bytes)
    for (const x of v0.issues || []) base.add(`${x.path ? x.path + ': ' : ''}${x.message}`)
    const v = await k.validateHwpx(ctx.bytes)
    if (!v.ok) for (const x of v.issues) { const m = `${x.path ? x.path + ': ' : ''}${x.message}`; if (!base.has(m)) issues.push(m) }
  }
  const pagesAfter = await renderPageCount(ctx.bytes, format)
  if (pagesBefore > 0 && pagesAfter === 0) issues.push('고친 뒤 쪽을 그릴 수 없습니다.')
  let changedParts = []
  if (format === 'hwpx') changedParts = await zipDiff(bytes, ctx.bytes)
  const diff = k.diffBlocks(startDoc.blocks, ctx.doc.blocks)
  const endKeys = fingerprint(ctx.doc.blocks).keys
  const blocksChanged = []
  const pagesChanged = new Set()
  ctx.ids.forEach((id, i) => {
    if (startKeys.has(id) && startKeys.get(id) !== endKeys[i]) { blocksChanged.push(id); const p = ctx.doc.blocks[i].pageNumber; if (p) pagesChanged.add(p) }
    else if (!startKeys.has(id)) { const p = ctx.doc.blocks[i].pageNumber; if (p) pagesChanged.add(p) }
  })
  const endSet = new Set(ctx.ids)
  const verify = { ok: issues.length === 0, issues, page_count_before: pagesBefore, page_count_after: pagesAfter, changed_parts: changedParts, untouched_parts_identical: format === 'hwpx' ? changedParts.every((p) => /^Contents\/section\d+\.xml$|^Preview\/|^BinData\/|^Contents\/content\.hpf$|^META-INF\/|^Contents\/header\.xml$/.test(p)) : null }
  if (!verify.ok) throw new HwpError('VERIFY_FAILED', '고친 결과의 검증에 실패해 적용하지 않았습니다.', 422, { verify, skipped: ctx.skipped })
  return {
    ...result,
    verify,
    diff_summary: diff.stats,
    pages_changed: [...pagesChanged].sort((a, b) => a - b),
    blocks_changed: blocksChanged,
    block_ids_added: ctx.ids.filter((id) => !startKeys.has(id)),
    block_ids_removed: startIds.filter((id) => !endSet.has(id)),
  }
}

export { EDIT_SUPPORT }
