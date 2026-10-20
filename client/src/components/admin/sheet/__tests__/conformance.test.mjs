// 적합성 시험: __tests__/corpus/*.json 의 모든 항목을 실행한다.
// 항목: { formula, cells?: {A1: ...}, sheets?: {...}, expected, note?, source }
// expected: 숫자 | 문자열 | 불리언 | null | { error: '#N/A' } | [[...]] (배열 결과)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateFormulaOnce } from '../engine/index.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus')
const NOW = new Date(2026, 8, 21, 12, 0, 0) // 2026-09-21 12:00 (로컬)
let seq = 0
const close = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) : a === b)

function check(c) {
  const r = evaluateFormulaOnce(c.formula, { cells: c.cells, sheets: c.sheets, now: () => NOW, random: () => 0.5 })
  const exp = c.expected
  if (exp && typeof exp === 'object' && !Array.isArray(exp) && 'error' in exp) {
    assert.ok(r.error, `오류 기대, 실제 ${JSON.stringify(r.value)}`)
    assert.equal(r.error.code, exp.error)
    return
  }
  assert.ok(!r.error, `오류 없음 기대, 실제 ${r.error && r.error.code}: ${r.error && r.error.message}`)
  if (Array.isArray(exp)) {
    const got = r.spill ? r.spill.values : [[r.value]]
    assert.equal(got.length, exp.length, `행 수 ${JSON.stringify(got)}`)
    exp.forEach((row, i) => { assert.equal(got[i].length, row.length, `열 수 ${JSON.stringify(got)}`); row.forEach((v, j) => assert.ok(close(got[i][j], v), `[${i}][${j}] 기대 ${JSON.stringify(v)} 실제 ${JSON.stringify(got[i][j])}`)) })
    return
  }
  assert.ok(close(r.value, exp), `기대 ${JSON.stringify(exp)} 실제 ${JSON.stringify(r.value)}`)
}

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const cases = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  test(`corpus ${f} (${cases.length}건)`, async (t) => {
    const fails = []
    for (const c of cases) {
      seq++
      try { check(c) } catch (e) { fails.push(`${c.formula}  ::  ${e.message}`) }
    }
    if (f === 'gsheets-observed.json' && fails.length) console.log(`[관찰값 불일치 ${fails.length}건]\n${fails.join('\n')}`)
    if (fails.length) throw new Error(`\n${fails.slice(0, 40).join('\n')}${fails.length > 40 ? `\n... 외 ${fails.length - 40}건` : ''}`)
  })
}
