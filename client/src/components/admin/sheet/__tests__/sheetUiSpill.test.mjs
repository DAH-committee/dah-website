// node --test client/src/components/admin/sheet/__tests__/sheetUiSpill.test.mjs
// SheetWorkspace 가 엔진을 붙이는 방식(getRaw/getBounds/sheets)을 그대로 따라 해서 펼침, 충돌, 다른 시트 참조, 옛 수식 회귀를 시험한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator } from '../formula.js'

// 시트 하나: cells[r][c] (r 은 시트 행 번호, 1 = 머리글)
function wire(sheets, activeId) {
  const byId = new Map(sheets.map((s) => [s.id, s]))
  return createEvaluator({
    getRaw: (c, r, sid) => {
      const s = byId.get(sid === undefined ? activeId : sid)
      if (!s || c < 0 || r < 1 || c >= s.cols || r > s.rows) return null
      return s.cells[`${c},${r}`] ?? ''
    },
    getBounds: (sid) => {
      const s = byId.get(sid === undefined ? activeId : sid)
      return s ? { rows: s.rows, cols: s.cols } : { rows: 0, cols: 0 }
    },
    sheets: sheets.map((s) => ({ id: s.id, name: s.label })),
    defaultSheet: activeId,
  })
}
const cells = (obj) => Object.fromEntries(Object.entries(obj).map(([ref, v]) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  return [`${m[1].charCodeAt(0) - 65},${m[2]}`, v]
}))

test('펼침: 빈 칸이 값을 돌려주고 소유자를 알려 준다', () => {
  const s1 = { id: 's1', label: '시트1', cols: 6, rows: 8, cells: cells({ A1: '이름', A2: '가', A3: '나', A4: '다', C2: '=A2:A4' }) }
  const ev = wire([s1], 's1')
  assert.equal(ev(2, 2), '가')
  assert.equal(ev(2, 3), '나')
  assert.equal(ev(2, 4), '다')
  assert.equal(ev.spillOwner('s1', { c: 2, r: 3 }).ref, 'C2')
  assert.equal(ev.spillOwner('s1', { c: 2, r: 2 }), null)
  assert.equal(ev.spillCells('s1', 'C2').length, 3)
})

test('충돌: 펼칠 칸에 값이 있으면 #REF! 와 막힘 안내, 값을 지우면 다시 펼쳐진다', () => {
  const data = cells({ A2: '가', A3: '나', A4: '다', C2: '=A2:A4', C3: '막는 값' })
  const s1 = { id: 's1', label: '시트1', cols: 6, rows: 8, cells: data }
  let ev = wire([s1], 's1')
  assert.equal(ev(2, 2), '#REF!')
  const x = ev.evaluateCell('s1', { c: 2, r: 2 })
  assert.equal(x.spillBlocked, true)
  assert.match(x.error.message, /not expanded because it would overwrite data in C3/)
  assert.equal(ev(2, 3), '막는 값')
  delete data['2,3']
  ev = wire([s1], 's1')
  assert.equal(ev(2, 3), '나')
})

test('격자 밖으로 넘치면 #REF!', () => {
  const s1 = { id: 's1', label: '시트1', cols: 3, rows: 8, cells: cells({ A2: '1', A3: '2', A4: '3', B2: '=SEQUENCE(3,3)' }) }
  const ev = wire([s1], 's1')
  assert.equal(ev(1, 2), '#REF!')
  assert.match(ev.evaluateCell('s1', { c: 1, r: 2 }).error.message, /insert more columns/)
})

test('다른 시트 참조와 시트 이름 인용', () => {
  const s1 = { id: 's1', label: '시트1', cols: 4, rows: 6, cells: cells({ A2: '서울', B2: '10', A3: '부산', B3: '5', D1: "=SUMIF('내 시트'!A2:A3,\"서울\",'내 시트'!B2:B3)" }) }
  const s2 = { id: 's2', label: '내 시트', cols: 4, rows: 6, cells: cells({ A2: '서울', B2: '7', A3: '서울', B3: '3' }) }
  const ev = wire([s1, s2], 's1')
  assert.equal(ev(3, 1), '10')
  assert.equal(wire([s1, s2], 's2')(1, 2), '7')
  const miss = wire([s1], 's1')
  assert.equal(miss(3, 1), '#REF!')
})

test('회귀: 옛 수식 22개 함수의 표시 값', () => {
  const s1 = {
    id: 's1', label: '시트1', cols: 10, rows: 6,
    cells: cells({ A2: '10', B2: '20', A3: '1,000', B3: '5', A4: '7',
      C2: '=A2+B2', D2: '=IF(C2>25,"크다","작다")', E2: '=SUM(A2:B2)', F2: '=ROUND(A2/3,2)', G2: '=A2&"원"', H2: '=COUNTIF(A2:A4,">5")', I2: '=1/0', J2: '=CONCAT("a","b")',
      C3: '=A3*B3', D3: '=AVERAGE(A2:A4)', E3: '=MAX(A2:A4)', F3: '=UPPER("abc")', G3: '=LEN("한글")', H3: '=AND(TRUE,FALSE)', I3: '=A2+"x"',
      C4: '=SUMIF(A2:A4,">5",A2:A4)', D4: '=NOT(FALSE)', E4: '=ABS(-3)', F4: '=COUNTA(A2:C4)', G4: '=C4', H4: '=OR(FALSE,TRUE)', I4: '=MIN(A2:A4)', J4: '=LOWER("ABC")', A5: '=COUNT(A2:A4)', B5: '=B5' }),
  }
  const ev = wire([s1], 's1')
  const row = (r, n) => Array.from({ length: n }, (_, c) => ev(c, r))
  assert.deepEqual(row(2, 10), ['10', '20', '30', '크다', '30', '3.33', '10원', '3', '#DIV/0!', 'ab'])
  assert.deepEqual(row(3, 9), ['1,000', '5', '5000', '339', '1000', 'ABC', '2', 'FALSE', '#VALUE!'])
  assert.deepEqual(row(4, 10), ['7', '', '1017', 'TRUE', '3', '8', '1017', 'TRUE', '7', 'abc'])
  assert.equal(ev(0, 5), '3')
  assert.equal(ev(1, 5), '#REF!')
  assert.match(ev(2, 6) + ev(0, 6), /^$/)
})

test('증분 재계산: invalidate 후 의존하는 칸만 바뀐다', () => {
  const data = cells({ A2: '1', B2: '=A2*2', C2: '=B2+1' })
  const s1 = { id: 's1', label: '시트1', cols: 4, rows: 4, cells: data }
  const ev = wire([s1], 's1')
  assert.equal(ev(2, 2), '3')
  data['0,2'] = '5'
  ev.invalidate('s1', { c: 0, r: 2 })
  assert.equal(ev(2, 2), '11')
})
