// 읽기 전용 분석: 표기법 검사(lint), 신구대조(compare), 내보내기, 개인정보 후보.
import { loadKordoc } from './kordoc.js'
import { gridOf, unesc } from './model.js'

/** 블록을 줄 단위 글로 펴고, 줄 번호 → (블록, 칸) 대응표를 만든다 */
export function linearize(blocks, ids) {
  const lines = []
  const map = []
  blocks.forEach((b, i) => {
    if (b.type === 'table') {
      gridOf(b.table).forEach((row, r) => row.forEach((x, c) => {
        if (!x.cell) return
        for (const ln of unesc(x.cell.text).split('\n')) { lines.push(ln); map.push({ block: ids[i], cell: `${ids[i]}#r${r}c${c}` }) }
      }))
    } else if (b.type !== 'image' && b.type !== 'separator') {
      for (const ln of unesc(b.text).split('\n')) { lines.push(ln); map.push({ block: ids[i] }) }
    }
  })
  return { text: lines.join('\n'), map }
}

export async function lintDoc(blocks, ids, { numbers = false, styles = false } = {}) {
  const k = await loadKordoc()
  const { text, map } = linearize(blocks, ids)
  const found = k.lintGongmunText(text, { document: true, parsed: true })
  const findings = found.map((f) => ({
    ...(map[f.line - 1] || {}),
    rule: f.rule,
    severity: f.severity === 'error' ? 'error' : 'warn',
    message: f.message,
    match: f.match,
    suggest: f.suggest || null,
    line: f.line,
  }))
  const counts = { error: 0, warn: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  const notes = []
  if (numbers) notes.push('numbers: 본문과 표의 수치 대조는 kordoc CLI 전용이라 서버 API 에서는 아직 지원하지 않습니다.')
  if (styles) notes.push('styles: 단계별 서식 편차 검사는 kordoc CLI 전용이라 서버 API 에서는 아직 지원하지 않습니다.')
  return { findings, counts, notes }
}

const brief = (b) => (b ? (b.type === 'table' ? `표 ${b.table.rows}x${b.table.cols}` : unesc(b.text).slice(0, 200)) : null)

/** 두 버전의 블록을 대조한다 */
export async function compareDocs(bytesA, bytesB, blocksA, idsA, blocksB, idsB) {
  const k = await loadKordoc()
  const d = k.diffBlocks(blocksA, blocksB)
  const idxA = new Map(blocksA.map((b, i) => [b, i]))
  const idxB = new Map(blocksB.map((b, i) => [b, i]))
  const diffs = d.diffs.filter((x) => x.type !== 'unchanged').map((x) => {
    const o = { type: x.type }
    const ia = x.before ? idxA.get(x.before) : undefined
    const ib = x.after ? idxB.get(x.after) : undefined
    if (ib !== undefined) o.block = idsB[ib]
    else if (ia !== undefined) o.block = idsA[ia]
    if (ib !== undefined && ia !== undefined && idsA[ia] !== idsB[ib]) o.block_before = idsA[ia]
    o.before = brief(x.before)
    o.after = brief(x.after)
    if (x.cellDiffs) {
      o.cells = []
      x.cellDiffs.forEach((row, r) => row.forEach((c, ci) => { if (c.type !== 'unchanged') o.cells.push({ row: r, col: ci, type: c.type, before: c.before ?? null, after: c.after ?? null }) }))
    }
    if (x.similarity !== undefined) o.similarity = Math.round(x.similarity * 100) / 100
    return o
  })
  return { stats: d.stats, diffs }
}

export async function suggestRedaction(blocks, ids) {
  const k = await loadKordoc()
  const hits = []
  blocks.forEach((b, i) => {
    const each = (text, cell) => {
      const r = k.redactText(unesc(text), {})
      for (const h of r.hits) hits.push({ block: ids[i], ...(cell ? { cell } : {}), rule: h.rule, preview: h.masked })
    }
    if (b.type === 'table') gridOf(b.table).forEach((row, r) => row.forEach((x, c) => { if (x.cell?.text) each(x.cell.text, `${ids[i]}#r${r}c${c}`) }))
    else if (b.text) each(b.text)
  })
  return hits
}
