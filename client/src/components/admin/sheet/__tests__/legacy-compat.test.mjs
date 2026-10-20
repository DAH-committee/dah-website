// 기존 22개 함수 수식: 옛 엔진과 새 엔진의 표시 결과가 같은지 비교한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator as oldEv } from './legacy-formula.mjs'
import { createEvaluator as newEv, colIndexOf, fmtNum } from '../formula.js'

// 1행 머리글 + 데이터 6행, 열 A~F. SheetWorkspace와 같은 방식(범위 밖이면 null)
const grid = [
  ['이름', '부서', '금액', '수량', '메모', '합계'],
  ['김', 'A', '10', '2', 'x', '=C2*D2'],
  ['이', 'B', '20.5', '3', '', '=C3*D3'],
  ['박', 'A', '1,000', '1', 'hello world', '=C4*D4'],
  ['최', 'B', '', '4', 'abc', '=IF(C5=0,"없음",C5*D5)'],
  ['정', 'C', '40', '5', 'ABC', '=ROUND(C6/D6,2)'],
  ['강', 'A', '7', '0', '', '=C7/D7'],
]
const formulas = [
  '=1+2*3', '=(1+2)*3', '=2^3', '=-2^2', '=10/4', '=10/0', '=1&2', '="a"&"b"', '=1=1', '=1<>2', '=1<2', '=2>=3', '="a"<"b"', '=50%', '=2*50%',
  '=SUM(C2:C7)', '=SUM(C2:D3)', '=SUM(1,2,3)', '=AVERAGE(C2:C7)', '=AVERAGE(E2:E3)', '=MIN(C2:C7)', '=MAX(C2:C7)', '=MIN(E2:E3)', '=COUNT(C2:C7)', '=COUNTA(E2:E7)', '=COUNTA(C2:C7)',
  '=ROUND(3.14159,2)', '=ROUND(2.5)', '=ROUND(-2.5)', '=ABS(-3)', '=IF(C2>5,"big","small")', '=IF(C2>50,"big")', '=AND(C2>5,D2>1)', '=OR(C2>50,D2>1)', '=NOT(C2>5)',
  '=LEN(E4)', '=CONCAT(A2,B2)', '=UPPER(E4)', '=LOWER(E6)', '=SUMIF(B2:B7,"A",C2:C7)', '=SUMIF(C2:C7,">10")', '=COUNTIF(B2:B7,"A")', '=COUNTIF(C2:C7,">=20")', '=COUNTIF(E2:E7,"abc")',
  '=SUM(F2:F7)', '=F2+F3', '=F5', '=A2&B2', '=C2*D2', '=SUM(C2:C7)/COUNT(C2:C7)', '=IF(AND(C2>5,B2="A"),1,0)', '=C2+', '=FOO(1)', '=SUM(', '=SUM(C2:C7', '=1/0',
  '=AVERAGE(E2:E3)', '=SUM(A2:A3)', '=ROUND(C3/D3,1)', '=D7*100/0',
]
const mkRaw = (g) => (c, r) => { const row = g[r - 1]; if (!row) return null; const v = row[c]; return v === undefined ? null : v }
const fixed = () => new Date(2026, 8, 21, 9, 5)

test('옛 엔진과 새 엔진: 기존 함수 수식 표시 결과 동일', () => {
  const diffs = []
  for (const f of formulas) {
    const g = grid.map((r) => [...r]); g[0][6] = f // G1이 아니라 별도 칸: 8행 추가
    const g2 = grid.map((r) => [...r]); g2.push(['', '', '', '', '', '', f])
    const raw = mkRaw(g2)
    const o = oldEv(raw, fixed), n = newEv(raw, fixed)
    for (let r = 1; r <= g2.length; r++) for (let c = 0; c < 7; c++) {
      const a = o(c, r), b = n(c, r)
      if (a !== b) diffs.push(`${f} @(${c},${r}) 옛=${JSON.stringify(a)} 새=${JSON.stringify(b)}`)
    }
  }
  // 알려진 의도된 차이만 허용
  // 의도된 차이 2가지: (1) 빈 칸은 숫자 비교에서 0(구글과 같음): F5 = IF(C5=0,...), (2) ROUND는 0.5를 0에서 먼 쪽으로(-2.5 -> -3)
  const unexpected = diffs.filter((d) => !d.includes('@(5,5)') && !d.startsWith('=ROUND(-2.5) ') && !/^=F5 /.test(d))
  assert.deepEqual(unexpected, [], `\n${unexpected.slice(0, 60).join('\n')}`)
  assert.ok(diffs.length > 0)
})

test('TODAY/NOW 표시: 기본은 구글 ko-KR 형식, dateStyle iso 면 옛 엔진과 같은 문자열', () => {
  // 구글 관찰(gs-173): 함수가 만든 날짜는 "2025. 1. 1" 형식이라 기본값을 바꿨다. 옛 ISO 형식은 dateStyle: 'iso'
  const raw = mkRaw([['=TODAY()', '=NOW()']])
  const o = oldEv(raw, fixed), n = newEv({ getRaw: raw, now: fixed, dateStyle: 'iso' }), k = newEv(raw, fixed)
  assert.equal(n(0, 1), o(0, 1))
  assert.equal(n(1, 1), o(1, 1))
  assert.equal(k(0, 1), '2026. 9. 21')
  assert.equal(k(1, 1), '2026. 9. 21 오전 9:05:00')
})

test('내보내기: colIndexOf, fmtNum 호환', () => {
  assert.equal(colIndexOf('A'), 0); assert.equal(colIndexOf('AA'), 26); assert.equal(colIndexOf('ab'), 27)
  assert.equal(fmtNum(1.5), '1.5'); assert.equal(fmtNum(0.1 + 0.2), '0.3'); assert.equal(fmtNum(3), '3')
})

test('의도된 차이 확인', () => {
  const raw = mkRaw([['', '=IF(A1=0,"빈칸은0","아님")', '=ROUND(-2.5)', '=A1+1']])
  const o = oldEv(raw), n = newEv(raw)
  assert.equal(n(1, 1), '빈칸은0'); assert.equal(o(1, 1), '아님')
  assert.equal(n(2, 1), '-3'); assert.equal(o(2, 1), '-2')
})
