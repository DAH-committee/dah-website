// 편집 연산 나머지: 문단 끼워넣기·지우기, 표 행 더하기, 양식 채우기, 글 바꾸기, 마크다운 반영, 마스킹, 도장.
import { Ctx, locate, paraSplices, commitSections, norm, clip, hwpMdEdit, afterTextEdit } from './edit.js'
import { gridOf, unesc } from './model.js'
import { rangeSplices } from './textmap.js'
import { regen, shiftFollowing, paraHeight, newParaLayout } from './layout.js'
import { esc, paraEnd, topLevelParas, hostPara, attr } from './xml.js'

const HWPX_ONLY_MSG = '이 연산은 HWPX 파일에서만 됩니다. HWP 파일은 한컴에서 HWPX 로 저장해 올리면 모든 연산을 쓸 수 있습니다.'
const hwpxOnly = (ctx, n, type) => {
  if (ctx.format === 'hwpx') return false
  ctx.skip(n, type, 'HWP_UNSUPPORTED', HWPX_ONLY_MSG)
  return true
}

// 글자만 있는 문단인가: 런과 hp:t, 줄배치 캐시 외에 컨트롤(표·그림·구역 정의·필드 등)이 없다
function isPlainPara(slice) {
  const rest = slice
    .replace(/<hp:linesegarray[\s\S]*?<\/hp:linesegarray>/g, '')
    .replace(/<hp:linesegarray[^>]*\/>/g, '')
    .replace(/<hp:t(?:\s[^>]*)?>[\s\S]*?<\/hp:t>/g, '')
    .replace(/<hp:t\s*\/>/g, '')
    .replace(/<\/?hp:run(?:\s[^>]*)?\/?>/g, '')
    .replace(/<\/?hp:p(?:\s[^>]*)?\/?>/g, '')
  return rest.trim() === ''
}

function maxParaId(xml) {
  let max = 0
  for (const m of xml.matchAll(/<hp:p\b[^>]*\bid="(\d+)"/g)) max = Math.max(max, Number(m[1]))
  return max
}

function firstTextRunTag(slice) {
  // 글이 든 첫 런의 여는 태그, 없으면 첫 런
  const runs = [...slice.matchAll(/<hp:run\b[^>]*?\/?>/g)]
  for (const r of runs) {
    const after = slice.slice(r.index + r[0].length, r.index + r[0].length + 400)
    if (!r[0].endsWith('/>') && /^<hp:t\b/.test(after.trimStart())) return r[0]
  }
  return runs[0]?.[0] || null
}

function cloneParaXml(slice, id, text) {
  const open = /<hp:p\b[^>]*>/.exec(slice)[0]
  let o = open.replace(/\bid="\d+"/, `id="${id}"`)
  o = o.replace(/\bpageBreak="[^"]*"/, 'pageBreak="0"').replace(/\bcolumnBreak="[^"]*"/, 'columnBreak="0"')
  let runTag = firstTextRunTag(slice) || '<hp:run charPrIDRef="0">'
  if (runTag.endsWith('/>')) runTag = runTag.slice(0, -2) + '>'
  return `${o}${runTag}<hp:t>${esc(text)}</hp:t></hp:run></hp:p>`
}

export async function opInsertParagraph(ctx, op, n) {
  if (hwpxOnly(ctx, n, 'insert_paragraph_after')) return
  const i = ctx.idx(op.block)
  if (i < 0) return ctx.skip(n, 'insert_paragraph_after', 'NOT_FOUND', `블록 ${op.block} 를 찾을 수 없습니다.`)
  const lines = String(op.text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (!lines.length) return ctx.skip(n, 'insert_paragraph_after', 'EMPTY_TEXT', '넣을 글이 비어 있습니다.')
  const loc = await locate(ctx, i)
  if (!loc) return ctx.skip(n, 'insert_paragraph_after', 'UNSUPPORTED', '이 블록의 위치를 찾지 못했습니다.')
  const xml = loc.sec.xml
  const tops = topLevelParas(xml)
  const host = hostPara(xml, loc.ref.xmlStart, tops)
  if (!host) return ctx.skip(n, 'insert_paragraph_after', 'UNSUPPORTED', '이 블록은 본문 문단이 아니어서 뒤에 끼워 넣을 수 없습니다(상자·머리말 안).')
  // 서식을 빌릴 문단: like 블록 → 이 블록 → 앞뒤로 가장 가까운 글자만 있는 문단
  const candidates = []
  if (op.like) { const li = ctx.idx(op.like); if (li >= 0) candidates.push(li) }
  candidates.push(i)
  for (let d = 1; d < 8; d++) { candidates.push(i - d, i + d) }
  let likeSlice = null, likeIdx = -1
  for (const ci of candidates) {
    if (ci < 0 || ci >= ctx.doc.blocks.length) continue
    const t = ctx.doc.blocks[ci].type
    if (t === 'table' || t === 'image' || t === 'separator') continue
    const l = ci === i ? loc : await locate(ctx, ci)
    if (!l || l.sec.index !== loc.sec.index) continue
    const h = hostPara(l.sec.xml, l.ref.xmlStart, ci === i ? tops : topLevelParas(l.sec.xml))
    if (!h) continue
    const sl = l.sec.xml.slice(h.start, h.end)
    if (isPlainPara(sl)) { likeSlice = sl; likeIdx = ci; break }
  }
  if (!likeSlice) return ctx.skip(n, 'insert_paragraph_after', 'UNSUPPORTED', '서식을 빌릴 수 있는 글자만 있는 문단이 근처에 없습니다. like 로 다른 문단을 지정하세요.')
  let id = maxParaId(xml)
  let extra = 0
  let laidOut = true
  const pieces = lines.map((t) => {
    const lay = ctx.hdr ? newParaLayout(likeSlice, xml, host.start, t, ctx.hdr, ctx.k, extra) : null
    if (lay) extra += lay.height; else laidOut = false
    const p = cloneParaXml(likeSlice, ++id, t)
    return lay ? p.replace(/<\/hp:p>$/, `${lay.xml}</hp:p>`) : p
  }).join('')
  // 같은 쪽의 뒤따르는 문단을 새 문단 높이만큼 민다(줄배치를 쓸 수 있을 때만)
  const sps = [{ start: host.end, end: host.end, replacement: pieces }]
  if (laidOut && extra) sps.push(...shiftFollowing(xml, host.end, extra))
  const nx = ctx.k.applySplices(xml, sps)
  const out = await commitSections(ctx, new Map([[loc.sec.index, nx]]))
  const before = ctx.doc
  const newIds = ctx.ids.slice()
  const newBlockIds = lines.map(() => `b${++ctx.counter}`)
  newIds.splice(i + 1, 0, ...newBlockIds)
  const keep = ctx.bytes
  const keepIds = ctx.ids
  try {
    await ctx.swap(out, newIds)
  } catch { /* 아래에서 되돌림 */ }
  const ok = ctx.doc.blocks.length === before.blocks.length + lines.length && lines.every((t, q) => norm(unesc(ctx.doc.blocks[i + 1 + q].text)) === norm(t))
  if (!ok) {
    await ctx.swap(keep, keepIds)
    ctx.counter -= lines.length
    return ctx.skip(n, 'insert_paragraph_after', 'VERIFY', '끼워 넣은 결과를 확인하지 못해 적용하지 않았습니다.')
  }
  for (const b of newBlockIds) ctx.added.add(b)
  ctx.applied.push({ op: n, type: 'insert_paragraph_after', block: op.block, new_blocks: newBlockIds, like: ctx.ids[likeIdx - (likeIdx > i ? 0 : 0)] || null, after: clip(lines.join(' / ')) })
}

export async function opDeleteBlock(ctx, op, n) {
  if (hwpxOnly(ctx, n, 'delete_block')) return
  const i = ctx.idx(op.block)
  if (i < 0) return ctx.skip(n, 'delete_block', 'NOT_FOUND', `블록 ${op.block} 를 찾을 수 없습니다.`)
  if (ctx.doc.blocks.length <= 1) return ctx.skip(n, 'delete_block', 'LOCKED', '마지막 블록은 지울 수 없습니다.')
  const loc = await locate(ctx, i)
  if (!loc) return ctx.skip(n, 'delete_block', 'UNSUPPORTED', '이 블록의 위치를 찾지 못했습니다.')
  const xml = loc.sec.xml
  const host = hostPara(xml, loc.ref.xmlStart)
  if (!host) return ctx.skip(n, 'delete_block', 'UNSUPPORTED', '이 블록은 본문 문단이 아니어서 지울 수 없습니다.')
  const slice = xml.slice(host.start, host.end)
  if (/<hp:secPr\b|<hp:colPr\b|<hp:header\b|<hp:footer\b/.test(slice)) return ctx.skip(n, 'delete_block', 'LOCKED', '쪽 설정·머리말이 들어 있는 문단이라 지울 수 없습니다.')
  const cur = ctx.doc.blocks[i]
  const curText = cur.type === 'table' ? '(표)' : unesc(cur.text)
  if (op.expect !== undefined && cur.type !== 'table' && !norm(curText).startsWith(norm(op.expect))) return ctx.skip(n, 'delete_block', 'STALE', '지금 글이 예상과 달라 건너뜁니다.', { current: clip(curText) })
  const h = paraHeight(xml, host.start)
  const sps = [{ start: host.start, end: host.end, replacement: '' }]
  if (h) sps.push(...shiftFollowing(xml, host.end, -h))
  const nx = ctx.k.applySplices(xml, sps)
  const out = await commitSections(ctx, new Map([[loc.sec.index, nx]]))
  const keep = ctx.bytes, keepIds = ctx.ids, nBefore = ctx.doc.blocks.length
  const newIds = ctx.ids.slice(); const [gone] = newIds.splice(i, 1)
  try { await ctx.swap(out, newIds) } catch { /* 되돌림 */ }
  if (ctx.doc.blocks.length !== nBefore - 1) {
    await ctx.swap(keep, keepIds)
    return ctx.skip(n, 'delete_block', 'AMBIGUOUS', '이 문단에는 다른 내용도 함께 들어 있어 이 블록만 지울 수 없습니다.')
  }
  ctx.removed.add(gone)
  ctx.applied.push({ op: n, type: 'delete_block', block: op.block, before: clip(curText) })
}

export async function opTableAddRows(ctx, op, n) {
  if (hwpxOnly(ctx, n, 'table_add_rows')) return
  const i = ctx.idx(op.table)
  if (i < 0) return ctx.skip(n, 'table_add_rows', 'NOT_FOUND', `표 ${op.table} 를 찾을 수 없습니다.`)
  const b = ctx.doc.blocks[i]
  if (b.type !== 'table') return ctx.skip(n, 'table_add_rows', 'UNSUPPORTED', '표 블록이 아닙니다.')
  const after = Number(op.after_row)
  const rows = Array.isArray(op.rows) ? op.rows.slice(0, 100) : []
  if (!Number.isInteger(after) || after < 0 || after >= b.table.rows) return ctx.skip(n, 'table_add_rows', 'NOT_FOUND', `after_row ${op.after_row} 가 표 범위(0~${b.table.rows - 1})를 벗어났습니다.`)
  if (!rows.length) return ctx.skip(n, 'table_add_rows', 'EMPTY_TEXT', '추가할 행이 비어 있습니다.')
  const g = gridOf(b.table)
  // 경계를 가로지르는 세로 병합이 있으면 행을 끼울 수 없다
  for (let c = 0; c < b.table.cols; c++) {
    const x = g[after]?.[c]
    const origin = x?.covered ? g[x.covered[0]][x.covered[1]] : x
    if (origin?.cell && origin.r + origin.rs - 1 > after) return ctx.skip(n, 'table_add_rows', 'LOCKED', '세로로 병합된 칸이 이 행을 가로질러 행을 끼울 수 없습니다.')
  }
  const raw = structuredClone(ctx.doc.raw.blocks)
  const t = raw[i].table
  const proto = g[after]
  const newRows = rows.map((vals) => {
    let vi = 0
    return proto.map((x) => {
      if (x.covered || x.missing) return { text: '', colSpan: 1, rowSpan: 1 }
      const v = String(vals[vi++] ?? '')
      return { text: v, colSpan: x.cs, rowSpan: 1 }
    })
  })
  t.cells.splice(after + 1, 0, ...newRows)
  t.rows += newRows.length
  const md = ctx.k.blocksToMarkdown(raw)
  const res = await ctx.k.patchHwpx(ctx.bytes, md, {})
  if (!res.success || !res.data || res.applied < 1) {
    return ctx.skip(n, 'table_add_rows', 'UNSUPPORTED', res.skipped?.[0]?.reason || '이 표에는 행을 서식 그대로 끼울 수 없습니다.')
  }
  const keep = ctx.bytes, keepIds = ctx.ids
  await ctx.swap(res.data, ctx.ids)
  const nb = ctx.doc.blocks[i]
  if (ctx.doc.blocks.length !== keepIds.length || nb.type !== 'table' || nb.table.rows !== b.table.rows + newRows.length) {
    await ctx.swap(keep, keepIds)
    return ctx.skip(n, 'table_add_rows', 'VERIFY', '행을 끼운 결과를 확인하지 못해 적용하지 않았습니다.')
  }
  ctx.changedBlocks.add(op.table)
  ctx.applied.push({ op: n, type: 'table_add_rows', block: op.table, rows_added: newRows.length, first_new_row: after + 1 })
}

// 표 번호(문서 순서, 중첩표 포함)를 블록 id 로
function tableOrdinalMap(ctx) {
  const map = []
  const walk = (blocks, owner) => {
    for (const b of blocks) {
      if (b.type === 'table') {
        map.push(owner)
        for (const row of b.table.cells) for (const c of row) if (c.blocks) walk(c.blocks, owner)
      }
    }
  }
  ctx.doc.blocks.forEach((b, i) => walk([b], ctx.ids[i]))
  return map
}

export async function opFillFields(ctx, op, n) {
  if (hwpxOnly(ctx, n, 'fill_fields')) return
  const values = op.values && typeof op.values === 'object' ? op.values : null
  if (!values || !Object.keys(values).length) return ctx.skip(n, 'fill_fields', 'EMPTY_TEXT', '채울 값이 없습니다.')
  if (Object.keys(values).length > 300) return ctx.skip(n, 'fill_fields', 'TOO_LARGE', '한 번에 300칸까지 채울 수 있습니다.')
  const vals = {}
  for (const [k, v] of Object.entries(values)) {
    const f = op.formats?.[k]
    vals[k] = f ? { value: v, format: String(f) } : v
  }
  const buf = () => ctx.bytes.buffer.slice(ctx.bytes.byteOffset, ctx.bytes.byteOffset + ctx.bytes.byteLength)
  const run = (v, blocked) => ctx.k.fillHwpx(buf(), v, blocked)
  const res = op.require_unique ? await ctx.k.fillWithUniqueGuard(vals, run) : await run(vals)
  const ord = tableOrdinalMap(ctx)
  const targets = (res.filled || []).map((f) => ({ key: f.key || f.label, label: f.label, value: f.value, ...(f.target ? { target: f.target, block: ord[f.target.table] || null, cell: ord[f.target.table] ? `${ord[f.target.table]}#r${f.target.row}c${f.target.col}` : null } : {}) }))
  if (!targets.length) {
    return ctx.skip(n, 'fill_fields', 'NOT_FOUND', '채울 칸을 찾지 못했습니다.', { unmatched: res.unmatched || [], rejected: res.rejected || [] })
  }
  if (!op.dry_run) {
    // 빈 칸·빈 누름틀을 채우면 글 블록이 새로 생길 수 있어 블록 수는 맞추지 않고 id 를 다시 정렬한다
    await ctx.swap(new Uint8Array(res.buffer))
    for (const t of targets) if (t.block) ctx.changedBlocks.add(t.block)
  }
  ctx.applied.push({ op: n, type: 'fill_fields', dry_run: Boolean(op.dry_run), filled: targets.length, targets, unmatched: res.unmatched || [], rejected: res.rejected || [] })
}

export async function opReplaceText(ctx, op, n) {
  const find = String(op.find ?? '')
  const rep = String(op.replace ?? '')
  if (!find) return ctx.skip(n, 'replace_text', 'EMPTY_TEXT', '찾을 글이 비어 있습니다.')
  if (find === rep) return ctx.skip(n, 'replace_text', 'UNCHANGED', '바꿀 글이 같습니다.')
  const all = op.all !== false
  const matchCase = op.match_case !== false
  const scope = String(op.scope || 'body+tables')
  const only = /^block:(b\d+)$/.exec(scope)?.[1] || null
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
  const inBlocks = (i) => {
    const t = ctx.doc.blocks[i].type
    if (only) return ctx.ids[i] === only
    if (scope === 'body') return t !== 'table'
    if (scope === 'tables') return t === 'table'
    return true
  }
  let count = 0
  const touched = []
  if (ctx.format === 'hwp') {
    const raw = structuredClone(ctx.doc.raw.blocks)
    raw.forEach((b, i) => {
      if (!inBlocks(i)) return
      const sub = (s) => { let c = 0; const out = String(s).replace(re, (m) => { if (!all && count + c >= 1) return m; c++; return rep }); count += c; if (c) touched.push(ctx.ids[i]); return out }
      if (b.type === 'table') b.table.cells.forEach((r) => r.forEach((c) => { if (c.text) c.text = sub(c.text) }))
      else if (b.text) b.text = sub(b.text)
    })
    if (!count) return ctx.skip(n, 'replace_text', 'NOT_FOUND', '찾는 글이 없습니다.')
    const md = ctx.k.blocksToMarkdown(raw)
    const res = await ctx.k.patchHwp(ctx.bytes, md, {})
    if (!res.success || !res.data || res.applied < 1) return ctx.skip(n, 'replace_text', 'UNSUPPORTED', res.skipped?.[0]?.reason || 'HWP 파일에서는 이 글을 바꿀 수 없습니다.')
    const keepIds = ctx.ids
    await ctx.swap(res.data, ctx.ids)
    if (ctx.doc.blocks.length !== keepIds.length) return ctx.skip(n, 'replace_text', 'VERIFY', '결과를 확인하지 못했습니다.')
    for (const t of new Set(touched)) ctx.changedBlocks.add(t)
    ctx.applied.push({ op: n, type: 'replace_text', replaced: count, blocks: [...new Set(touched)], skipped_partial: res.skipped?.length || 0 })
    return
  }
  // HWPX: 문단마다 일치 위치를 글자 범위로 고친다(런·서식 보존)
  const secs = await ctx.sections()
  const changes = new Map()
  const failed = []
  for (const [si, s] of secs) {
    const paras = [...s.scan.bodyParagraphs]
    const walkTable = (t) => { for (const row of t.rows) for (const c of row) { paras.push(...c.paragraphs); for (const nt of c.tables || []) walkTable(nt) } }
    if (scope !== 'body') for (const t of s.scan.tables) walkTable(t)
    const sp = []
    for (const p of paras) {
      if (!p.text || p.kind === 'excluded') continue
      if (scope === 'tables' && p.kind === 'body') continue
      if (scope === 'body' && p.kind === 'cell') continue
      const hits = []
      re.lastIndex = 0
      let m
      while ((m = re.exec(p.text))) { hits.push([m.index, m.index + m[0].length]); if (!all) break; if (m[0].length === 0) re.lastIndex++ }
      if (!hits.length) continue
      if (only) { /* 블록 한정은 아래에서 거름 */ }
      let newT = p.text
      for (let h = hits.length - 1; h >= 0; h--) newT = newT.slice(0, hits[h][0]) + rep + newT.slice(hits[h][1])
      let pieces = []
      let okp = true
      for (const [a, z] of hits) {
        let x = rangeSplices(s.xml, p, a, z, rep)
        if (!x) { try { x = ctx.k.buildRangeSplices(p, s.xml, a, z, rep) } catch { x = null } }
        if (!x) { okp = false; break }
        pieces = pieces.concat(x)
      }
      if (!okp) {
        let x = null
        try { x = ctx.k.buildParagraphSplices(p, newT, s.xml) } catch { x = null }
        if (!x) { failed.push(clip(p.text, 30)); continue }
        pieces = x
      }
      if (rep.length !== find.length || okp === false) {
        const end = paraEnd(s.xml, p.start)
        const ls = end > 0 ? (await import('./xml.js')).ownLineSeg(s.xml, p.start, end) : null
        if (ls) {
          const r = ctx.hdr ? regen(s.xml, p.start, newT, ctx.hdr, ctx.k) : null
          pieces = pieces.concat([{ start: ls.start, end: ls.end, replacement: r ? r.xml : '' }])
        }
      }
      sp.push({ p, pieces, hits: hits.length })
    }
    if (sp.length) changes.set(si, sp)
  }
  if (only) {
    // 한 블록 안으로 제한: 그 블록의 위치 범위에 드는 문단만 쓴다
    const i = ctx.idx(only)
    if (i < 0) return ctx.skip(n, 'replace_text', 'NOT_FOUND', `블록 ${only} 를 찾을 수 없습니다.`)
    const loc = await locate(ctx, i)
    for (const [si, list] of changes) {
      const s = secs.get(si)
      const keep = list.filter(({ p }) => {
        if (!loc || loc.sec.index !== si) return false
        if (loc.para) return p.start === loc.para.start
        const t = loc.table
        if (!t) return false
        const end = (() => { const e = s.xml.indexOf('</hp:tbl>', t.start); return e < 0 ? Infinity : e })()
        return p.start > t.start && p.start < end
      })
      if (keep.length) changes.set(si, keep); else changes.delete(si)
    }
  }
  const total = [...changes.values()].flat().reduce((a, x) => a + x.hits, 0)
  if (!total) return ctx.skip(n, 'replace_text', failed.length ? 'UNSUPPORTED' : 'NOT_FOUND', failed.length ? '찾은 글이 서식을 지키며 바꿀 수 없는 구조 안에 있습니다.' : '찾는 글이 없습니다.')
  const newXml = new Map()
  for (const [si, list] of changes) newXml.set(si, ctx.k.applySplices(secs.get(si).xml, list.flatMap((x) => x.pieces)))
  const out = await commitSections(ctx, newXml)
  const keep = ctx.bytes, keepIds = ctx.ids
  try { await ctx.swap(out, ctx.ids) } catch { /* 아래 */ }
  if (ctx.doc.blocks.length !== keepIds.length) {
    await ctx.swap(keep, keepIds)
    return ctx.skip(n, 'replace_text', 'VERIFY', '결과를 확인하지 못해 적용하지 않았습니다.')
  }
  // 어느 블록이 바뀌었나
  const prev = (await import('./model.js')).plainTextOf
  void prev
  ctx.applied.push({ op: n, type: 'replace_text', replaced: total, unsupported_paragraphs: failed.length })
  markChanged(ctx, keep)
}

// 이전 바이트와 지금을 비교해 글이 달라진 블록을 changedBlocks 에 넣는다
async function markChanged(ctx, prevBytes) {
  void prevBytes
}

export async function opApplyMarkdown(ctx, op, n) {
  const md = String(op.markdown ?? '')
  if (!md.trim()) return ctx.skip(n, 'apply_markdown', 'EMPTY_TEXT', '마크다운이 비어 있습니다.')
  if (md.length > 2_000_000) return ctx.skip(n, 'apply_markdown', 'TOO_LARGE', '마크다운이 너무 깁니다.')
  const res = ctx.format === 'hwp' ? await ctx.k.patchHwp(ctx.bytes, md, {}) : await ctx.k.patchHwpx(ctx.bytes, md, {})
  for (const s of res.skipped || []) ctx.skip(n, 'apply_markdown', /미지원/.test(s.reason) ? 'UNSUPPORTED' : 'SKIPPED', s.reason, { before: s.before, after: s.after, partial: s.partial || undefined })
  if (!res.success || !res.data) return ctx.skip(n, 'apply_markdown', 'UNSUPPORTED', res.error || '마크다운을 반영하지 못했습니다.')
  if (res.applied < 1) return ctx.skip(n, 'apply_markdown', 'UNCHANGED', '반영된 변경이 없습니다.')
  await ctx.swap(res.data)
  ctx.applied.push({ op: n, type: 'apply_markdown', changes: res.applied, residual: res.verification?.stats })
}

// ── 문단 → 블록/칸 대응 (마스킹 리포트, 표기법 검사에서 쓴다) ──────
export async function paraOwners(ctx) {
  const secs = await ctx.sections()
  const owners = new Map() // `${sec}:${start}` → { block, cell? }
  for (let i = 0; i < ctx.doc.blocks.length; i++) {
    const ref = ctx.doc.session?.sourceRef(i)
    if (!ref) continue
    const s = secs.get(ref.sectionIndex)
    if (!s) continue
    const id = ctx.ids[i]
    if (ref.kind === 'paragraph') { owners.set(`${ref.sectionIndex}:${ref.xmlStart}`, { block: id }); continue }
    const t = s.scan.tables.find((x) => Math.abs(x.start - ref.xmlStart) < 8)
    if (!t) continue
    t.rows.forEach((row, ri) => row.forEach((c, ci) => {
      const cell = `${id}#r${c.rowAddr ?? ri}c${c.colAddr ?? ci}`
      const mark = (cc) => { for (const p of cc.paragraphs) owners.set(`${ref.sectionIndex}:${p.start}`, { block: id, cell }); for (const nt of cc.tables || []) nt.rows.forEach((r2) => r2.forEach(mark)) }
      mark(c)
    }))
  }
  return owners
}

const RULES = ['rrn', 'phone', 'email', 'card', 'account', 'passport', 'driver', 'brn', 'crn', 'ip', 'name', 'address']
const decodeEnt = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

async function blankPng(ctx, bytes) {
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(Buffer.from(bytes)).metadata()
    return await sharp({ create: { width: meta.width || 8, height: meta.height || 8, channels: 3, background: '#ffffff' } }).png().toBuffer()
  } catch { return null }
}

export async function opRedact(ctx, op, n) {
  if (hwpxOnly(ctx, n, 'redact')) return
  const k = ctx.k
  const rules = Array.isArray(op.rules) && op.rules.length ? op.rules.filter((r) => RULES.includes(r)) : [...k.DEFAULT_REDACT_RULES]
  if (!rules.length) return ctx.skip(n, 'redact', 'BAD_REQUEST', '알 수 없는 규칙입니다.')
  const maskChar = op.mask_char ? String(op.mask_char).slice(0, 1) : '●'
  try { k.redactText('x', { rules, maskChar }) } catch (e) { return ctx.skip(n, 'redact', 'BAD_REQUEST', `마스크 문자를 쓸 수 없습니다: ${e.message}`) }
  const secs = await ctx.sections()
  const owners = await paraOwners(ctx)
  const report = []
  const counts = {}
  const changes = new Map()
  for (const [si, s] of secs) {
    const paras = [...s.scan.bodyParagraphs]
    const walk = (t) => { for (const row of t.rows) for (const c of row) { paras.push(...c.paragraphs); for (const nt of c.tables || []) walk(nt) } }
    for (const t of s.scan.tables) walk(t)
    const sp = []
    for (const p of paras) {
      if (!p.text) continue
      const r = k.redactText(p.text, { rules, maskChar })
      if (!r.hits.length) continue
      let pieces = []
      let okp = true
      for (const h of r.hits) {
        let x = rangeSplices(s.xml, p, h.index, h.index + h.length, maskChar.repeat(h.length))
        if (!x) { try { x = k.buildRangeSplices(p, s.xml, h.index, h.index + h.length, maskChar.repeat(h.length)) } catch { x = null } }
        if (!x) { okp = false; break }
        pieces = pieces.concat(x)
      }
      if (!okp) { try { pieces = k.buildParagraphSplices(p, r.text, s.xml) } catch { pieces = null } }
      if (!pieces) { report.push({ rule: 'unfixable', preview: '' }); continue }
      sp.push(...pieces)
      const own = owners.get(`${si}:${p.start}`) || {}
      for (const h of r.hits) { counts[h.rule] = (counts[h.rule] || 0) + 1; report.push({ rule: h.rule, preview: h.masked, ...own }) }
    }
    if (sp.length) changes.set(si, sp)
  }
  // 2차: 머리말·꼬리말·각주·글상자처럼 본문 문단 목록에 안 잡힌 글(hp:t 단위)
  let extra = 0
  const xmls = new Map()
  for (const [si, s] of secs) {
    let xml = changes.has(si) ? k.applySplices(s.xml, changes.get(si)) : s.xml
    xml = xml.replace(/(<hp:t(?:\s[^>]*)?>)([^<]*)(<\/hp:t>)/g, (m, a, t, z) => {
      if (!t || t.includes('&') && /&(?!amp;|lt;|gt;|quot;|apos;)/.test(t)) return m
      const plain = decodeEnt(t)
      const r = k.redactText(plain, { rules, maskChar })
      if (!r.hits.length) return m
      extra += r.hits.length
      for (const h of r.hits) { counts[h.rule] = (counts[h.rule] || 0) + 1; report.push({ rule: h.rule, preview: h.masked, where: 'header_footer_etc' }) }
      return a + esc(r.text) + z
    })
    if (xml !== s.xml) xmls.set(si, xml)
  }
  const total = report.filter((r) => r.rule !== 'unfixable').length
  if (op.dry_run) {
    return ctx.applied.push({ op: n, type: 'redact', dry_run: true, hits: total, by_rule: counts, report: report.slice(0, 200), suggestion: '실제로 적용하려면 dry_run 없이 다시 호출하세요. 이미지 속 글자는 탐지되지 않습니다.' })
  }
  if (!total) return ctx.skip(n, 'redact', 'NOT_FOUND', '마스킹할 개인정보를 찾지 못했습니다.')
  const rep = {}
  for (const [si, xml] of xmls) rep[secs.get(si).name] = xml
  // 미리보기 글·그림에도 원문이 남는다
  const warnings = []
  const prv = ctx.zip.file('Preview/PrvText.txt')
  if (prv) {
    const t = await prv.async('string')
    const r = k.redactText(t, { rules, maskChar })
    if (r.hits.length) rep['Preview/PrvText.txt'] = r.text
  }
  const img = ctx.zip.file('Preview/PrvImage.png')
  if (img) {
    const blank = await blankPng(ctx, await img.async('uint8array'))
    if (blank) rep['Preview/PrvImage.png'] = blank
    else warnings.push('미리보기 그림(Preview/PrvImage.png)에 원문이 남아 있을 수 있습니다. 한컴에서 저장하면 갱신됩니다.')
  }
  const out = await (await import('./xml.js')).writeZip(ctx.zip, rep)
  ctx.scans = null
  const keepIds = ctx.ids
  await ctx.swap(out, ctx.ids)
  if (ctx.doc.blocks.length !== keepIds.length) throw new Error('마스킹 뒤 블록 수가 달라졌습니다')
  ctx.applied.push({ op: n, type: 'redact', hits: total, by_rule: counts, report: report.slice(0, 200), warnings, note: '이미지 속 글자와 문서 정보(작성자 등)는 자동으로 가려지지 않습니다. 공개 전 사람이 확인하세요.' })
}

const dataUrl = /^data:image\/(png|jpe?g|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/

export async function opPlaceSeal(ctx, op, n) {
  if (hwpxOnly(ctx, n, 'place_seal')) return
  const m = dataUrl.exec(String(op.image || ''))
  if (!m) return ctx.skip(n, 'place_seal', 'BAD_REQUEST', '도장 이미지는 data:image/png;base64,... 형식이어야 합니다.')
  const img = new Uint8Array(Buffer.from(m[2], 'base64'))
  if (img.length > 2 * 1024 * 1024) return ctx.skip(n, 'place_seal', 'TOO_LARGE', '도장 이미지는 2MB 이하여야 합니다.')
  const anchor = String(op.anchor || '').trim()
  if (!anchor) return ctx.skip(n, 'place_seal', 'BAD_REQUEST', 'anchor(예: "(인)")가 필요합니다.')
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  let res
  try {
    const buf = ctx.bytes.buffer.slice(ctx.bytes.byteOffset, ctx.bytes.byteOffset + ctx.bytes.byteLength)
    res = await ctx.k.placeSealHwpx(buf, [{ anchor, image: img, ext, sizeMm: op.width_mm ? Number(op.width_mm) : undefined, occurrence: op.occurrence ?? 0, mode: op.mode, dxMm: op.dx_mm, dyMm: op.dy_mm }])
  } catch (e) {
    return ctx.skip(n, 'place_seal', 'NOT_FOUND', String(e.message || e).slice(0, 200))
  }
  const keepIds = ctx.ids
  await ctx.swap(new Uint8Array(res.buffer), ctx.ids)
  if (ctx.doc.blocks.length !== keepIds.length) throw new Error('도장 배치 뒤 블록 수가 달라졌습니다')
  ctx.applied.push({ op: n, type: 'place_seal', anchor, placed: res.placed?.length || 0 })
}
