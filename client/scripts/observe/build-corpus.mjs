// CSV(시트 내보내기) -> gsheets-observed.json
// 사용: node build-corpus.mjs <내보낸.csv> <출력.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { FIXTURE, BLOCK_ROWS, CIRCULAR, splitCases } from './layout.mjs'

function parseCsv(t) {
  const rows = []
  let row = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  return rows
}
const colN = (s) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0)

// 수식이 참조하는 고정 칸만 setup 으로 모은다(따옴표 안 글자는 무시)
function setupFor(formula) {
  const f = formula.replace(/"(?:[^"]|"")*"/g, '""')
  const need = new Set()
  for (const m of f.matchAll(/\$?\b([A-Z]{1,2})\$?(\d+)(?::\$?([A-Z]{1,2})\$?(\d+))?\b/g)) {
    const c1 = colN(m[1]), r1 = +m[2], c2 = m[3] ? colN(m[3]) : c1, r2 = m[4] ? +m[4] : r1
    for (const k of Object.keys(FIXTURE)) {
      const kc = colN(k.match(/[A-Z]+/)[0]), kr = +k.match(/\d+/)[0]
      if (kc >= Math.min(c1, c2) && kc <= Math.max(c1, c2) && kr >= Math.min(r1, r2) && kr <= Math.max(r1, r2)) need.add(k)
    }
  }
  for (const m of f.matchAll(/\b([A-Z]{1,2}):([A-Z]{1,2})\b/g)) {
    const c1 = colN(m[1]), c2 = colN(m[2])
    for (const k of Object.keys(FIXTURE)) { const kc = colN(k.match(/[A-Z]+/)[0]); if (kc >= c1 && kc <= c2) need.add(k) }
  }
  const out = {}
  for (const k of [...need].sort((a, b) => colN(a.match(/[A-Z]+/)[0]) - colN(b.match(/[A-Z]+/)[0]) || +a.match(/\d+/)[0] - +b.match(/\d+/)[0])) out[k] = FIXTURE[k]
  return out
}

const [csvPath, outPath] = process.argv.slice(2)
if (!csvPath || !outPath) { console.error('사용: node build-corpus.mjs <csv> <out.json>'); process.exit(1) }
const grid = parseCsv(readFileSync(csvPath, 'utf8'))
const { sc, ar } = splitCases()
const entries = []
let n = 0
const id = () => 'gs-' + String(++n).padStart(3, '0')
sc.forEach((c, i) => entries.push({ id: id(), formula: c[0], cell: 'H' + (i + 1), setup: setupFor(c[0]), expectedCsv: (grid[i] || [])[7] ?? '', locale: 'ko-KR', localeDependent: !!c[2], note: c[1] }))
ar.forEach((c, k) => {
  const r0 = k * BLOCK_ROWS
  const rows = []
  for (let r = r0; r < r0 + BLOCK_ROWS; r++) rows.push((grid[r] || []).slice(9, 17))
  let maxc = 0, maxr = 0
  rows.forEach((rw, i) => { rw.forEach((x, j) => { if (x !== '') { maxc = Math.max(maxc, j + 1); maxr = Math.max(maxr, i + 1) } }) })
  entries.push({ id: id(), formula: c[0], cell: 'J' + (r0 + 1), setup: setupFor(c[0]), spill: true, expected: rows.slice(0, maxr).map((rw) => rw.slice(0, maxc)), locale: 'ko-KR', localeDependent: !!c[2], note: c[1] })
})
const circ = [grid[0]?.[18], grid[1]?.[18], grid[1]?.[19]]
CIRCULAR.forEach((c, i) => entries.push({ id: id(), formula: c.formula, cell: c.cell, setup: c.setup, expectedCsv: circ[i] ?? '', locale: 'ko-KR', localeDependent: false, note: c.note }))
for (const e of entries) {
  const v = JSON.stringify(e.expected ?? e.expectedCsv)
  if (/[월화수목금토일]요일|오전|오후|\d{4}\. \d/.test(v) || /월"/.test(v)) e.localeDependent = true
}
writeFileSync(outPath, JSON.stringify({ _meta: { source: '시트 CSV 내보내기', note: '_meta 설명은 기존 gsheets-observed.json 을 참고' }, entries }, null, 1))
console.log(`항목 ${entries.length}개 -> ${outPath}`)
