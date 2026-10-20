// 자연어 시험 사례 파일의 모양 점검(내용 판정은 사람이나 블라인드 판정기가 한다)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const j = JSON.parse(readFileSync(new URL('./nl-cases.json', import.meta.url), 'utf8'))
test('nl-cases.json: 30건, id 연속, 요청과 통과·실패 기준이 모두 있음, 고정 문서(fixture)가 정의됨', () => {
  assert.equal(j.cases.length, 30)
  assert.deepEqual(j.cases.map((c) => c.id), Array.from({ length: 30 }, (_, i) => i + 1))
  for (const c of j.cases) {
    assert.ok(c.request && c.request.length > 3, `#${c.id} request`)
    assert.ok(Array.isArray(c.pass) && c.pass.length > 0, `#${c.id} pass`)
    assert.ok(Array.isArray(c.fail) && c.fail.length > 0, `#${c.id} fail`)
    assert.ok(Array.isArray(c.expect_tools), `#${c.id} expect_tools`)
    assert.ok(j.fixtures[c.fixture], `#${c.id} fixture ${c.fixture}`)
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(JSON.stringify(c)), `#${c.id} 이모지 금지`)
    assert.ok(!JSON.stringify(c).includes('—'), `#${c.id} em dash 금지`)
  }
})
