// 설문 순수 로직(클라이언트 복사본): 분기 경로, 채점, 정의 검사. 서버 테스트와 같은 파일을 쓰므로 핵심만 확인한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildPages, computePath, nextAfter, gradeResponse, validateDefinition, validateResponse, expandColumns } from '../formLogic.js'

test('서버 복사본과 같은 파일이다', () => {
  const a = fs.readFileSync(new URL('../formLogic.js', import.meta.url), 'utf8')
  const b = fs.readFileSync(new URL('../../../../../server/src/lib/formLogic.js', import.meta.url), 'utf8')
  assert.equal(a, b)
})

const F = [
  { id: 'a', type: 'radio', label_ko: 'a', required: true, options: ['x', 'y', 'z'], validation: {}, logic: { options: { x: 'section:s3', y: 'submit' } } },
  { id: 's2', type: 'section', label_ko: '둘', validation: {} },
  { id: 'b', type: 'text', label_ko: 'b', required: true, options: [], validation: {} },
  { id: 's3', type: 'section', label_ko: '셋', validation: {} },
  { id: 'c', type: 'text', label_ko: 'c', required: true, options: [], validation: {} },
]
test('쪽 나누기와 경로', () => {
  assert.equal(buildPages(F).length, 3)
  assert.deepEqual(computePath(F, { a: 'x' }).path, [0, 2])
  assert.deepEqual(computePath(F, { a: 'y' }).path, [0])
  assert.deepEqual(computePath(F, { a: 'z' }).path, [0, 1, 2])
  assert.deepEqual(computePath(F, {}).path, [0, 1, 2])
  assert.deepEqual(nextAfter(buildPages(F), 1, { a: 'z' }), { kind: 'page', index: 2 })
  assert.deepEqual(nextAfter(buildPages(F), 2, {}), { kind: 'submit' })
})
test('한 쪽씩 검사(only)는 그 쪽 질문만 본다', () => {
  assert.deepEqual(validateResponse(F, { a: 'z' }, { only: new Set(['a']) }), [])
  assert.equal(validateResponse(F, {}, { only: new Set(['a']) })[0].error, 'required')
})
test('같은 섹션에 분기 질문이 둘이면 아래쪽 질문의 답이 이긴다', () => {
  const f = [
    { id: 'p', type: 'radio', label_ko: 'p', options: ['1', '2'], validation: {}, logic: { options: { 1: 'section:s2' } } },
    { id: 'q', type: 'radio', label_ko: 'q', options: ['1', '2'], validation: {}, logic: { options: { 1: 'submit' } } },
    { id: 's2', type: 'section', label_ko: '2', validation: {} },
    { id: 'r', type: 'text', label_ko: 'r', validation: {} },
  ]
  assert.deepEqual(computePath(f, { p: '1', q: '1' }).path, [0])
  assert.deepEqual(computePath(f, { p: '1', q: '2' }).path, [0, 1])
})
test('채점과 열 확장, 정의 검사', () => {
  const q = [{ id: 'k', type: 'text', label_ko: 'k', validation: {}, quiz: { points: 2, correct: ['abc'], ignoreCase: true, numeric: false } }]
  assert.equal(gradeResponse(q, { k: ' ABC ' }, { quiz: { enabled: true } }).score, 2)
  assert.equal(expandColumns([{ id: 'g', type: 'checkbox_grid', label_ko: 'g', rows: ['r1', 'r2'], columns: ['c'] }]).length, 2)
  assert.deepEqual(validateDefinition(F, {}), [])
})
