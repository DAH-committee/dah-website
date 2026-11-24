// 마감 직전 몰림: 마감 전에 업로드를 시작한 사람만 마감 뒤 유예 시간(기본 60분) 안에 이어서 받는다
process.env.NODE_ENV = 'test'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setDb } from '../src/db.js'
import { inDeadlineGrace, GRACE_MS } from '../src/lib/exhibitionPipeline.js'

const close = new Date('2026-11-24T15:00:00Z')
function dbWith(startedAt) {
  return { query: async (text, params) => {
    if (!/exhibit_upload_attempts/.test(text)) return { rows: [] }
    return { rows: startedAt && startedAt <= params[2] ? [{ '?column?': 1 }] : [] }
  } }
}
const user = { id: 7, email: 'a@b.c' }

test('마감 전에 시작했고 유예 안이면 받는다', async () => {
  setDb(dbWith(new Date('2026-11-24T14:59:30Z')))
  assert.equal(await inDeadlineGrace(user, close, new Date('2026-11-24T15:10:00Z')), true)
})
test('마감 뒤에 처음 시작했으면 받지 않는다', async () => {
  setDb(dbWith(new Date('2026-11-24T15:00:30Z')))
  assert.equal(await inDeadlineGrace(user, close, new Date('2026-11-24T15:10:00Z')), false)
})
test('유예 시간이 지나면 받지 않는다', async () => {
  setDb(dbWith(new Date('2026-11-24T14:59:30Z')))
  assert.equal(await inDeadlineGrace(user, close, new Date(close.getTime() + GRACE_MS + 1000)), false)
})
test('마감 전에는 유예가 아니라 정상 기간이다', async () => {
  setDb(dbWith(new Date('2026-11-24T14:00:00Z')))
  assert.equal(await inDeadlineGrace(user, close, new Date('2026-11-24T14:30:00Z')), false)
})
