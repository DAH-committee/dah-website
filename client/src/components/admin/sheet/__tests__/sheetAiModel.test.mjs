// node --test client/src/components/admin/sheet/__tests__/sheetAiModel.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../sheetModel.js'
import { mapRefs, renameSheetInFormula, shiftForStructure, translateFormula } from '../sheetFormulaRefs.js'
import { analyzeMatrix, classify } from '../sheetAnalyze.js'

const blank = (id, label, cols = 4, rows = 6) => ({
  id,
  label,
  columns: Array.from({ length: cols }, (_, i) => ({ key: `c${i}`, label: `열 ${i + 1}`, width: 140 })),
  rows: Array.from({ length: rows }, (_, i) => ({ id: i + 1, cells: {} })),
  nextId: rows + 1,
})
const mk = () => ({ sheets: [blank('s1', '시트1'), blank('s2', '내 시트')], nextSheet: 3, ui: {}, activeId: 's1' })

test('A1 해석: 칸, 범위, 열 범위, 행 범위, 열린 끝, 시트 접두', () => {
  assert.deepEqual(M.parseCell('b7'), { c: 1, r: 7 })
  assert.equal(M.parseCell('A0'), null)
  assert.equal(M.parseCell('A'), null)
  assert.deepEqual(M.parseRange('C3:A1'), { c0: 0, c1: 2, r0: 1, r1: 3 })
  assert.deepEqual(M.parseRange('A2:B'), { c0: 0, c1: 1, r0: 2, r1: null })
  assert.deepEqual(M.parseRange('B:D'), { c0: 1, c1: 3, r0: 1, r1: null })
  assert.deepEqual(M.parseRange('3:9'), { c0: 0, c1: null, r0: 3, r1: 9 })
  assert.equal(M.parseRange('hello'), null)
  assert.deepEqual(M.splitSheetPrefix("'내 시트'!A1:B2"), { sheet: '내 시트', range: 'A1:B2' })
  assert.deepEqual(M.splitSheetPrefix('시트2!A1'), { sheet: '시트2', range: 'A1' })
  assert.deepEqual(M.splitSheetPrefix('A1:B2'), { sheet: null, range: 'A1:B2' })
  assert.equal(M.cellName(27, 5), 'AB5')
})

test('수식 참조 옮기기: 상대, 절대, 문자열 안은 그대로, 함수 이름은 건드리지 않음', () => {
  assert.equal(translateFormula('=B2*$C$1+SUM(D2:D9)', 3, 1), '=C5*$C$1+SUM(E5:E12)')
  assert.equal(translateFormula('=IF(A1="A1",LOG10(B2),0)', 1, 0), '=IF(A2="A1",LOG10(B3),0)')
  assert.equal(translateFormula('=A1', -1, 0), '=#REF!')
  assert.equal(translateFormula("='내 시트'!A1+시트2!B2", 1, 1), "='내 시트'!B2+시트2!C3")
})

test('행·열 삽입 삭제에 따른 참조 조정', () => {
  const ins = (f, o) => shiftForStructure(f, '시트1', '시트1', o)
  assert.equal(ins('=SUM(B2:B6)', { axis: 'row', at: 4, count: 2, op: 'insert' }), '=SUM(B2:B8)')
  assert.equal(ins('=B7', { axis: 'row', at: 4, count: 1, op: 'insert' }), '=B8')
  assert.equal(ins('=B3', { axis: 'row', at: 4, count: 1, op: 'insert' }), '=B3')
  assert.equal(ins('=SUM(B2:B6)', { axis: 'row', at: 3, count: 2, op: 'delete' }), '=SUM(B2:B4)')
  assert.equal(ins('=B3', { axis: 'row', at: 3, count: 1, op: 'delete' }), '=#REF!')
  assert.equal(ins('=SUM(B3:B4)', { axis: 'row', at: 3, count: 2, op: 'delete' }), '=SUM(#REF!)')
  assert.equal(ins('=C2+SUM(B:B)', { axis: 'col', at: 1, count: 1, op: 'insert' }), '=D2+SUM(C:C)')
  assert.equal(ins('=C2', { axis: 'col', at: 2, count: 1, op: 'delete' }), '=#REF!')
  // 다른 시트의 수식: 참조 시트가 일치할 때만
  assert.equal(shiftForStructure('=시트1!B5+B5', '시트2', '시트1', { axis: 'row', at: 3, count: 1, op: 'insert' }), '=시트1!B6+B5')
  assert.equal(renameSheetInFormula("='내 시트'!A1+시트1!A1", '내 시트', '집계'), '=집계!A1+시트1!A1')
  assert.equal(mapRefs('="x A1"&A1', () => undefined), '="x A1"&A1')
})

test('setCells: 열·행 자동 확장, 머리글 규칙, 한도', () => {
  let st = mk()
  st = M.setCells(st, null, [{ c: 6, r: 9, raw: 'x' }]).state
  assert.equal(st.sheets[0].columns.length, 7)
  assert.equal(st.sheets[0].rows.length, 8)
  assert.equal(M.rawAt(st, st.sheets[0], 6, 9), 'x')
  assert.throws(() => M.setCells(st, null, [{ c: 0, r: 1, raw: '=1+1' }]), /머리글/)
  assert.throws(() => M.setCells(st, null, [{ c: 300, r: 2, raw: 'x' }]), /열/)
  assert.equal(M.isPlaceholderHeader('열 3'), true)
  assert.equal(M.usedRange(mk(), mk().sheets[0]).empty, true)
  assert.equal(M.usedRange(st, st.sheets[0]).rows, 9)
})

test('값 해석: 날짜, 불리언, 숫자, 퍼센트', () => {
  assert.equal(M.cellTextFromValue('2026년 9월 21일'), '2026-09-21')
  assert.equal(M.cellTextFromValue('2026/2/30'), '2026/2/30')
  assert.equal(M.cellTextFromValue('2026-09-21', { asText: true }), '2026-09-21')
  assert.equal(M.cellTextFromValue('true'), 'TRUE')
  assert.equal(M.cellTextFromValue(12.50), '12.5')
  assert.equal(M.cellTextFromValue(null), '')
  assert.throws(() => M.cellTextFromValue({ a: 1 }), /value/)
  assert.throws(() => M.cellTextFromValue(Infinity), /숫자/)
  assert.equal(M.parseNumberText('12%'), 0.12)
  assert.equal(M.parseNumberText('1,234.5'), 1234.5)
  assert.equal(M.parseNumberText('1,2345'), null)
  assert.equal(M.parseNumberText('₩3,000'), 3000)
})

test('sortRange: 숫자 < 글, 빈칸은 항상 아래, 같은 행 수식 따라감', () => {
  let st = mk()
  st = M.setCells(st, null, [
    { c: 0, r: 2, raw: '10' }, { c: 0, r: 3, raw: '' }, { c: 0, r: 4, raw: '2' }, { c: 0, r: 5, raw: '가' },
    { c: 1, r: 2, raw: '=A2*2' }, { c: 1, r: 4, raw: '=A4*2' },
  ]).state
  const asc = M.sortRange(st, null, { c0: 0, c1: 1, r0: 1, r1: 5 }, [{ c: 0, order: 'asc' }], { hasHeader: true })
  assert.deepEqual(M.matrixOf(asc.state, asc.state.sheets[0], { c0: 0, c1: 1, r0: 2, r1: 5 }), [['2', '=A2*2'], ['10', '=A3*2'], ['가', ''], ['', '']])
  const desc = M.sortRange(st, null, { c0: 0, c1: 1, r0: 2, r1: 5 }, [{ c: 0, order: 'desc' }], {})
  assert.equal(M.rawAt(desc.state, desc.state.sheets[0], 0, 2), '가')
  assert.equal(M.rawAt(desc.state, desc.state.sheets[0], 0, 5), '')
})

test('행 삽입 삭제: 서식과 칸 값이 행에 붙어 따라가고, 열 삭제는 서식을 정리', () => {
  let st = mk()
  st = M.setCells(st, null, [{ c: 0, r: 3, raw: 'A' }, { c: 1, r: 3, raw: 'B' }]).state
  st = M.formatRange(st, null, { c0: 0, c1: 0, r0: 3, r1: 3 }, { bold: true }).state
  const ins = M.insertRows(st, null, 2, 1)
  const row = ins.state.sheets[0].rows[2]
  assert.equal(row.cells.c0, 'A')
  assert.ok(ins.state.ui.s1.formats[`${row.id}|c0`].b)
  const dc = M.deleteCols(ins.state, null, 0, 1)
  assert.deepEqual(Object.keys(dc.state.ui.s1.formats), [])
  assert.equal(dc.state.sheets[0].columns.length, 3)
  assert.throws(() => M.deleteCols(st, null, 0, 9), /열 범위/)
})

test('시트 추가 이름 바꾸기 삭제 규칙', () => {
  let st = mk()
  st = M.setCells(st, 's2', [{ c: 0, r: 2, raw: "=시트1!A2+'내 시트'!B2" }]).state
  const r = M.renameSheet(st, '내 시트', '집계')
  assert.equal(r.label, '집계')
  assert.equal(M.rawAt(r.state, r.state.sheets[1], 0, 2), '=시트1!A2+집계!B2')
  assert.throws(() => M.renameSheet(st, '시트1', '내 시트'), /이미/)
  assert.throws(() => M.renameSheet(st, '시트1', 'a!b'), /쓸 수 없/)
  const d = M.deleteSheet(st, 's2')
  assert.equal(d.state.sheets.length, 1)
  assert.throws(() => M.deleteSheet(d.state, 's1'), /하나뿐/)
  assert.throws(() => M.findSheet(st, '없음'), /있는 시트/)
  assert.equal(M.addSheet(mk()).label, '시트3')
})

test('analyzeMatrix: 직접 계산과 일치, 이상치, 형식 섞임, 중복', () => {
  const rows = [['이름', '점수', '날짜']]
  const scores = [10, 12, 11, 13, 12, 11, 400]
  scores.forEach((s, i) => rows.push([`사람${i % 3}`, String(s), `2026-09-${String(i + 1).padStart(2, '0')}`]))
  rows.push(['사람0', '12', '2026-09-02'])
  rows.push(['', '', ''])
  const a = analyzeMatrix(rows, { origin: { c: 0, r: 1 }, header: true })
  const sc = a.columnsInfo[1]
  const all = [...scores, 12]
  const sum = all.reduce((x, y) => x + y, 0)
  assert.equal(sc.numeric.sum, sum)
  assert.equal(sc.numeric.mean, Number((sum / all.length).toPrecision(12)))
  assert.equal(sc.numeric.max, 400)
  assert.equal(sc.numeric.maxAt, 'B8')
  assert.equal(sc.numeric.median, 12)
  assert.deepEqual(sc.outliers, [{ at: 'B8', value: 400 }])
  assert.equal(a.columnsInfo[2].type, 'date')
  assert.equal(a.columnsInfo[2].dates.earliest, '2026-09-01')
  assert.equal(a.blankRows, 1)
  assert.equal(a.columnsInfo[0].distinct, 3)
  const mixed = analyzeMatrix([['a'], ['1'], ['x'], ['2'], ['y']], { header: false })
  assert.equal(mixed.columnsInfo[0].type, 'mixed')
  assert.equal(classify('#REF!').t, 'error')
  assert.equal(classify('12%').pct, true)
  assert.equal(analyzeMatrix([['이름', '값'], ['a', '1'], ['b', '2']], { header: 'auto' }).header, true)
})
