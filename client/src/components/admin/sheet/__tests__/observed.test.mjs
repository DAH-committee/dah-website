// 구글 시트 실측(gsheets-observed.json) 대비 점수 고정. 새로 어긋나는 항목이 생기면 실패한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runObserved } from './observed-runner.mjs'

// 의심 항목(관찰 쪽 붙여넣기 아티팩트 가능성)과 원인 미확인 항목만 허용
const KNOWN = new Set(['gs-029', 'gs-325', 'gs-487', 'gs-489', 'gs-491', 'gs-492', 'gs-499', 'gs-507', 'gs-576'])
test('관찰 corpus: 알려진 9건 외에는 모두 일치', () => {
  const rs = runObserved()
  const bad = rs.filter((r) => !r.ok && !KNOWN.has(r.id))
  assert.deepEqual(bad.map((r) => `${r.id} ${r.formula} 기대=${JSON.stringify(r.want)} 실제=${JSON.stringify(r.got)}`), [])
  assert.ok(rs.filter((r) => r.ok).length >= 634)
})
