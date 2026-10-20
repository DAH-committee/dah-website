// 우리 수식 엔진(engine/)이 관찰 corpus(gsheets-observed.json)와 얼마나 같은지 점검한다. 파일을 고치지 않고 읽기만 한다.
// 사용: node run-corpus.mjs [--json 결과.json] [--only 접두어]   (client/ 에서 또는 이 폴더에서 실행)
// 비교는 "표시 문자열" 기준이다: 구글 CSV 의 표시값과 엔진의 ev(c, r) 를 정확히 비교한다.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../src/components/admin/sheet/engine')
const { createEvaluator } = await import(resolve(root, 'index.js'))
const corpus = JSON.parse(readFileSync(resolve(root, '__tests__/corpus/gsheets-observed.json'), 'utf8'))

const colN = (s) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
const parse = (a) => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { c: colN(m[1]), r: +m[2] } }
const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

const rows = []
let pass = 0, fail = 0, err = 0
for (const e of corpus.entries) {
  const grid = new Map()
  for (const [k, v] of Object.entries(e.setup)) { const p = parse(k); grid.set(p.c + ':' + p.r, v === true ? '=TRUE' : String(v)) }
  const at = parse(e.cell)
  grid.set(at.c + ':' + at.r, e.formula)
  const getRaw = (c, r) => (c < 0 || r < 1 || c > 40 || r > 2000 ? null : grid.get(c + ':' + r) ?? '')
  let got
  try {
    const ev = createEvaluator({ getRaw, now: () => new Date('2026-10-12T09:00:00+09:00') })
    if (e.spill) {
      got = e.expected.map((row, i) => row.map((_, j) => String(ev(at.c + j, at.r + i))))
    } else got = String(ev(at.c, at.r))
  } catch (x) { err++; rows.push({ id: e.id, formula: e.formula, status: 'throw', got: String(x.message).slice(0, 80), expected: e.expected ?? e.expectedCsv, note: e.note }); continue }
  const want = e.spill ? e.expected : e.expectedCsv
  const same = JSON.stringify(got) === JSON.stringify(want)
  if (same) pass++
  else { fail++; rows.push({ id: e.id, formula: e.formula, status: 'diff', got, expected: want, note: e.note, localeDependent: e.localeDependent }) }
}
console.log(`일치 ${pass} / 불일치 ${fail} / 예외 ${err} / 전체 ${corpus.entries.length}`)
for (const r of rows.filter((x) => !only || x.id.startsWith(only)).slice(0, 400)) console.log(`${r.id} ${r.status} ${r.formula}  기대=${JSON.stringify(r.expected)} 실제=${JSON.stringify(r.got)}  (${r.note})`)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ pass, fail, err, rows }, null, 1))
