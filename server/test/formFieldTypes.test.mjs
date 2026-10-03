// 신청 폼 질문 유형 중 선형 배율(scale)과 시간(time)의 서버 검증.
// 브라우저가 무엇을 보내든 서버가 범위와 형식을 최종 판정해야 한다.
import test from 'node:test'
import assert from 'node:assert/strict'
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL
const { validateResponse, scaleRange } = await import('../src/routes/forms.js')

const fields = [
  { id: 's', type: 'scale', required: true, label_ko: '만족도', options: [], validation: { scaleMin: 1, scaleMax: 5 } },
  { id: 't', type: 'time', required: false, label_ko: '시간', options: [], validation: {} },
]
const errorsOf = (data) => validateResponse(fields, data).map((e) => `${e.field}:${e.error}`)

test('범위 안의 점수와 올바른 시간은 통과한다', () => {
  assert.deepEqual(errorsOf({ s: '3', t: '14:30' }), [])
  assert.deepEqual(errorsOf({ s: '5', t: '00:00' }), [])
})

test('범위 밖이거나 숫자가 아닌 점수는 거절한다', () => {
  assert.deepEqual(errorsOf({ s: '6' }), ['s:scale'])
  assert.deepEqual(errorsOf({ s: '0' }), ['s:scale'])
  assert.deepEqual(errorsOf({ s: 'a' }), ['s:scale'])
  assert.deepEqual(errorsOf({ s: '2.5' }), ['s:scale'])
})

test('시간 형식이 틀리면 거절한다', () => {
  assert.deepEqual(errorsOf({ s: '3', t: '25:00' }), ['t:time'])
  assert.deepEqual(errorsOf({ s: '3', t: '9:5' }), ['t:time'])
})

test('필수 점수를 비우면 필수 오류가 난다', () => {
  assert.deepEqual(errorsOf({ t: '09:05' }), ['s:required'])
})

test('0부터 시작하는 배율과 저장값이 이상할 때의 기본값', () => {
  assert.deepEqual(scaleRange({ scaleMin: 0, scaleMax: 10 }), { min: 0, max: 10 })
  assert.deepEqual(scaleRange({ scaleMin: 7, scaleMax: 99 }), { min: 1, max: 5 })
  assert.deepEqual(scaleRange(undefined), { min: 1, max: 5 })
  const zero = [{ id: 'z', type: 'scale', required: true, label_ko: 'z', options: [], validation: { scaleMin: 0, scaleMax: 10 } }]
  assert.deepEqual(validateResponse(zero, { z: '0' }), [])
})
