// 관찰 corpus(gsheets-observed.json)를 엔진에 돌리는 실행기. scripts/observe/run-corpus.mjs 와 같은 비교(표시 문자열 정확 일치)이되,
// setup 값이 null 이면 "빈 칸"으로 둔다(원본 하네스는 String(null) = "null" 글자를 칸에 넣는다).
// 사용: node __tests__/observed-runner.mjs [--only gs-5]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createEvaluator } from '../engine/index.js'
import { FIXTURE } from '../../../../../scripts/observe/sheets-cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(resolve(here, '../engine/__tests__/corpus/gsheets-observed.json'), 'utf8'))
const colN = (s) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
const parse = (a) => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { c: colN(m[1]), r: +m[2] } }

export function runObserved({ rows = 1723 } = {}) {
  const out = []
  for (const e of corpus.entries) {
    const grid = new Map()
    // 관찰 시트에는 항상 고정 데이터 전체(A1:F20)가 있었다. setup 은 직접 참조한 칸만 담아서 OFFSET/INDIRECT/열 전체 참조가 모자라므로 전체를 깐다.
    for (const [k, v] of Object.entries({ ...FIXTURE, ...e.setup })) { const p = parse(k); grid.set(`${p.c}:${p.r}`, v === null ? '' : v === true ? '=TRUE' : String(v)) }
    const at = parse(e.cell)
    grid.set(`${at.c}:${at.r}`, e.formula)
    const getRaw = (c, r) => (c < 0 || r < 1 || c > 40 || r > rows ? null : grid.get(`${c}:${r}`) ?? '')
    let got
    try {
      const ev = createEvaluator({ getRaw, getBounds: () => ({ rows, cols: 41 }), now: () => new Date('2026-10-12T09:00:00+09:00') })
      got = e.spill ? e.expected.map((row, i) => row.map((_, j) => String(ev(at.c + j, at.r + i)))) : String(ev(at.c, at.r))
    } catch (x) { got = `THROW ${x.message}` }
    const want = e.spill ? e.expected : e.expectedCsv
    out.push({ id: e.id, formula: e.formula, note: e.note, got, want, ok: JSON.stringify(got) === JSON.stringify(want) })
  }
  return out
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
  const rs = runObserved({ rows: process.argv.includes('--rows') ? +process.argv[process.argv.indexOf('--rows') + 1] : 1723 })
  console.log(`일치 ${rs.filter((r) => r.ok).length} / 불일치 ${rs.filter((r) => !r.ok).length} / 전체 ${rs.length}`)
  for (const r of rs.filter((x) => !x.ok && (!only || x.id.startsWith(only)))) console.log(`${r.id} ${r.formula}  기대=${JSON.stringify(r.want).slice(0, 200)} 실제=${JSON.stringify(r.got).slice(0, 200)}  (${r.note})`)
}
