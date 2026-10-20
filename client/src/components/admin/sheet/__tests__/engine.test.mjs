// 엔진 동작 시험: 펼침, 충돌, 증분 재계산, 순환, 휘발성, 검증 API, 성능
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, createMemoryHost, validateFormula, evaluateFormulaOnce, listFunctions, hasFunction, suggestFunction } from '../engine/index.js'

const NOW = () => new Date(2026, 8, 21, 12, 0, 0)
function setup(cells, opts = {}) {
  const host = createMemoryHost(cells, { minRows: opts.rows || 12, minCols: opts.cols || 6 })
  const ev = createEvaluator({ getRaw: host.getRaw, getBounds: host.getBounds, sheets: host.sheets, defaultSheet: host.defaultSheet, now: NOW, random: opts.random })
  return { host, ev, set(ref, raw) { host.set(undefined, ref, raw); ev.invalidate(undefined, ref) } }
}

test('펼침: SEQUENCE가 아래 빈 칸으로 펼쳐지고 spillCells·spillOwner가 맞다', () => {
  const { ev } = setup({ A1: '=SEQUENCE(3,2)' })
  const info = ev.evaluateCell(undefined, 'A1')
  assert.deepEqual(info.spill, { rows: 3, cols: 2, values: [[1, 2], [3, 4], [5, 6]] })
  assert.equal(ev.evaluateCell(undefined, 'B3').value, 6)
  assert.equal(ev.evaluateCell(undefined, 'B3').spillOwner.ref, 'A1')
  assert.equal(ev.spillCells(undefined, 'A1').length, 6)
  assert.equal(ev(1, 2), '4') // 표시 함수도 펼친 값을 돌려준다 (B2)
})
test('펼침 충돌: 값이 있는 칸에 닿으면 #REF!와 구글 메시지, 값을 지우면 자동 복구', () => {
  const t = setup({ A1: '=SEQUENCE(3)', A3: 'x' })
  const info = t.ev.evaluateCell(undefined, 'A1')
  assert.equal(info.error.code, '#REF!')
  assert.match(info.error.message, /Array result was not expanded because it would overwrite data in A3/)
  assert.equal(info.spillBlocked, true)
  t.set('A3', '')
  const again = t.ev.evaluateCell(undefined, 'A1')
  assert.equal(again.error, undefined)
  assert.equal(t.ev.evaluateCell(undefined, 'A3').value, 3)
})
test('펼침이 다른 수식의 참조에 반영된다 (SUM이 펼친 칸을 읽음)', () => {
  const t = setup({ A1: '=SEQUENCE(3)', C1: '=SUM(A1:A3)' })
  assert.equal(t.ev.evaluateCell(undefined, 'C1').value, 6)
  t.set('A1', '=SEQUENCE(4)') // 한 칸 더 펼침
  assert.equal(t.ev.evaluateCell(undefined, 'C1').value, 6)
  t.set('C1', '=SUM(A1:A4)')
  assert.equal(t.ev.evaluateCell(undefined, 'C1').value, 10)
})
test('격자 밖으로 넘치면 행을 늘리라는 #REF!', () => {
  const t = setup({ A1: '=SEQUENCE(50)' }, { rows: 10 })
  const info = t.ev.evaluateCell(undefined, 'A1')
  assert.equal(info.error.code, '#REF!')
  assert.match(info.error.message, /insert more rows/)
})
test('증분 재계산: 바뀐 칸에 의존하는 칸만 다시 계산한다', () => {
  const t = setup({ A1: '1', A2: '=A1+1', A3: '=A2+1', B1: '=SUM(C1:C3)', C1: '5', D1: '=C1*2' })
  assert.equal(t.ev.evaluateCell(undefined, 'A3').value, 3)
  assert.equal(t.ev.evaluateCell(undefined, 'D1').value, 10)
  const before = t.ev.stats().evals
  t.set('A1', '10')
  assert.equal(t.ev.evaluateCell(undefined, 'A3').value, 12)
  assert.equal(t.ev.stats().evals - before, 2, 'A2, A3만 다시 계산')
  assert.equal(t.ev.evaluateCell(undefined, 'D1').value, 10)
  t.set('C2', '7') // SUM(C1:C3) 범위 안 빈 칸 변경
  assert.equal(t.ev.evaluateCell(undefined, 'B1').value, 12)
})
test('순환 참조: 구글처럼 #REF! (순환 의존성 메시지)', () => {
  const t = setup({ A1: '=B1+1', B1: '=A1+1', C1: '=C1' })
  for (const r of ['A1', 'B1', 'C1']) {
    const i = t.ev.evaluateCell(undefined, r)
    assert.equal(i.error.code, '#REF!', r)
    assert.match(i.error.message, /Circular dependency detected/)
  }
  t.set('B1', '5')
  assert.equal(t.ev.evaluateCell(undefined, 'A1').value, 6)
})
test('휘발성: recalcVolatile이 TODAY·RAND 칸을 다시 계산한다', () => {
  let n = 0
  const t = setup({ A1: '=RAND()', B1: '=A1*2' }, { random: () => ++n / 10 })
  assert.equal(t.ev.evaluateCell(undefined, 'A1').value, 0.1)
  assert.equal(t.ev.evaluateCell(undefined, 'B1').value, 0.2)
  assert.equal(t.ev.evaluateCell(undefined, 'A1').value, 0.1, '재계산 전에는 그대로')
  t.ev.recalcVolatile()
  assert.equal(t.ev.evaluateCell(undefined, 'A1').value, 0.2)
  assert.equal(t.ev.evaluateCell(undefined, 'B1').value, 0.4)
})
test('다른 시트 참조와 INDIRECT/OFFSET 의존 추적', () => {
  const host = createMemoryHost({ 'Sheet1': { A1: '=Sheet2!A1+1', B1: '=INDIRECT("A"&C1)', C1: '2', A2: '7', D1: '=OFFSET(A1,1,0)' }, '내 시트': {}, Sheet2: { A1: '5' } })
  const ev = createEvaluator({ getRaw: host.getRaw, getBounds: host.getBounds, sheets: host.sheets, defaultSheet: host.defaultSheet })
  assert.equal(ev.evaluateCell('Sheet1', 'A1').value, 6)
  assert.equal(ev.evaluateCell('Sheet1', 'B1').value, 7)
  assert.equal(ev.evaluateCell('Sheet1', 'D1').value, 7)
  host.set('Sheet2', 'A1', '10'); ev.invalidate('Sheet2', 'A1')
  assert.equal(ev.evaluateCell('Sheet1', 'A1').value, 11)
  host.set('Sheet1', 'C1', '1'); ev.invalidate('Sheet1', 'C1')
  assert.equal(ev.evaluateCell('Sheet1', 'B1').value, 11)
})
test('날짜 서식 힌트: TODAY()는 날짜 문자열, TODAY()+7도 날짜, 날짜 빼기는 숫자', () => {
  const t = setup({ A1: '=TODAY()', A2: '=TODAY()+7', A3: '=TODAY()-DATE(2026,9,1)', A4: '=NOW()', B1: '2026-01-05', B2: '=B1', B3: '=B1+1' })
  // 관찰(ko-KR): 함수가 만든 날짜는 'yyyy. m. d', ISO 글자로 입력한 날짜 칸에서 파생한 값은 ISO 유지
  assert.equal(t.ev(0, 1), '2026. 9. 21'); assert.equal(t.ev(0, 2), '2026. 9. 28'); assert.equal(t.ev(0, 3), '20'); assert.equal(t.ev(0, 4), '2026. 9. 21 오후 12:00:00')
  assert.equal(t.ev(1, 2), '2026-01-05'); assert.equal(t.ev(1, 3), '2026-01-06')
})
test('dateStyle iso 옵션: 옛 엔진과 같은 ISO 표시', () => {
  const host = createMemoryHost({ A1: '=TODAY()', A2: '=NOW()' }, { minRows: 4, minCols: 2 })
  const ev = createEvaluator({ getRaw: host.getRaw, getBounds: host.getBounds, now: NOW, dateStyle: 'iso' })
  assert.equal(ev(0, 1), '2026-09-21'); assert.equal(ev(0, 2), '2026-09-21 12:00')
})
test('validateFormula: 파싱만, 함수·참조 목록, 모르는 함수와 제안', () => {
  const v = validateFormula('=SUMIFS(Sheet2!A:A,B2:B10,">1")+VLOOKUP(1,C1:D5,2,FALSE)')
  assert.equal(v.ok, true)
  assert.deepEqual(v.functionsUsed.sort(), ['SUMIFS', 'VLOOKUP'])
  assert.deepEqual(v.refs.sort(), ['B2:B10', 'C1:D5', 'Sheet2!A:A'].sort())
  const bad = validateFormula('=SUMM(A1)+XLOKUP(1,A:A,B:B)')
  assert.equal(bad.ok, false); assert.deepEqual(bad.unknownFunctions.sort(), ['SUMM', 'XLOKUP']); assert.equal(bad.suggestions.SUMM, 'SUM'); assert.equal(bad.suggestions.XLOKUP, 'XLOOKUP')
  assert.equal(validateFormula('=SUM(1,').ok, false); assert.equal(validateFormula('=SUM(1,').error.code, '#ERROR!')
  assert.equal(validateFormula('=ABS(1,2)').ok, false)
  assert.equal(validateFormula('=LAMBDA(x,x)(1)+LET(a,1,a)').ok, true)
  assert.equal(validateFormula('=ARRAYFORMULA(A1:A3)').mayArray, true)
})
test('함수 목록·존재 확인·이름 제안', () => {
  const l = listFunctions()
  assert.ok(l.length >= 250, `함수 ${l.length}개`)
  for (const f of l) { assert.ok(f.name && f.category && f.signature && f.summary_ko, f.name); assert.ok(f.minArgs >= 0) }
  assert.ok(hasFunction('vlookup') && hasFunction('QUERY') && !hasFunction('FOOBAR'))
  assert.equal(suggestFunction('COUNTIFFS'), 'COUNTIFS'); assert.equal(suggestFunction('AVG'), 'AVERAGE'); assert.equal(suggestFunction('ZZZZZZZZZ'), null)
})
test('evaluateFormulaOnce는 부작용이 없고 오류 메시지를 영어 원문과 한국어 요약으로 준다', () => {
  const cells = { A1: '1' }
  const r = evaluateFormulaOnce('=1/0', { cells })
  assert.equal(r.error.code, '#DIV/0!'); assert.ok(r.error.summary_ko); assert.deepEqual(cells, { A1: '1' })
  assert.equal(evaluateFormulaOnce('SUM(A1,2)', { cells }).value, 3)
})

// ── 성능 ────────────────────────────────────────────────
test('성능: 2만 칸 사슬 + 합계, 한 칸 수정 후 재계산이 1초 미만', () => {
  const N = 20000
  const cells = new Map()
  const raw = (c, r) => (r < 1 || r > N || c < 0 || c > 3 ? null : cells.get(`${c},${r}`) ?? '')
  cells.set('0,1', '1')
  for (let r = 2; r <= N; r++) cells.set(`0,${r}`, `=A${r - 1}+1`)
  for (let r = 1; r <= N; r++) cells.set(`1,${r}`, `=A${r}*2`)
  cells.set('2,1', `=SUM(B1:B${N})`)
  const ev = createEvaluator({ getRaw: raw, getBounds: () => ({ rows: N, cols: 4 }) })
  let t0 = performance.now()
  assert.equal(ev.evaluateCell(undefined, `A${N}`).value, N)
  const sum = ev.evaluateCell(undefined, 'C1').value
  assert.equal(sum, N * (N + 1))
  const full = performance.now() - t0
  t0 = performance.now()
  cells.set('0,1', '2'); ev.invalidate(undefined, 'A1')
  const last = ev.evaluateCell(undefined, `A${N}`).value
  const sum2 = ev.evaluateCell(undefined, 'C1').value
  const inc = performance.now() - t0
  assert.equal(last, N + 1); assert.equal(sum2, N * (N + 1) + 2 * N)
  console.log(`[벤치] 2만 칸 사슬+합계 최초 ${full.toFixed(0)}ms, A1 수정 후 전체 재계산 ${inc.toFixed(0)}ms`)
  assert.ok(inc < 1000, `증분 재계산 ${inc}ms`)
})
test('성능: 화면 표시 함수로 2만 칸 일괄 조회(레거시 방식)', () => {
  const N = 20000
  const raw = (c, r) => (r < 1 || r > N || c < 0 || c > 1 ? null : c === 0 ? (r === 1 ? '1' : `=A${r - 1}+1`) : `=A${r}*2`)
  const ev = createEvaluator(raw)
  const t0 = performance.now()
  for (let r = 1; r <= N; r++) { ev(0, r); ev(1, r) }
  const ms = performance.now() - t0
  assert.equal(ev(1, N), String(N * 2))
  console.log(`[벤치] 레거시 방식 4만 칸 조회 ${ms.toFixed(0)}ms`)
  assert.ok(ms < 1500, `${ms}ms`)
})
test('성능: 깊은 사슬을 거꾸로 조회해도 스택이 넘치지 않는다', () => {
  const N = 20000
  const raw = (c, r) => (r < 1 || r > N || c !== 0 ? null : r === 1 ? '1' : `=A${r - 1}+1`)
  const ev = createEvaluator(raw)
  assert.equal(ev(0, N), String(N))
})
test('성능: VLOOKUP 5천 개 x 5천 행', () => {
  const N = 5000
  const raw = (c, r) => (r < 1 || r > N || c < 0 || c > 3 ? null : c === 0 ? String(r) : c === 1 ? `v${r}` : c === 2 ? `=VLOOKUP(A${r},A1:B${N},2,FALSE)` : '')
  const ev = createEvaluator({ getRaw: raw, getBounds: () => ({ rows: N, cols: 4 }) })
  const t0 = performance.now()
  for (let r = 1; r <= N; r++) ev(2, r)
  const ms = performance.now() - t0
  assert.equal(ev(2, N), `v${N}`)
  console.log(`[벤치] VLOOKUP 5천x5천 ${ms.toFixed(0)}ms`)
  assert.ok(ms < 2000)
})
