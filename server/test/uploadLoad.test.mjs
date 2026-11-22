// 업로드가 몰릴 때: 동시에 메모리에 올리는 본문 크기에 상한을 두고, 넘는 요청은 거절하지 않고 줄을 세운다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

process.env.UPLOAD_INFLIGHT_MB = '1'
process.env.UPLOAD_QUEUE_WAIT_MS = '300'
const { admitUpload, activeUploads } = await import('../src/lib/uploadLoad.js')

const MB = 1024 * 1024
function fake(size) {
  const req = Object.assign(new EventEmitter(), { headers: { 'content-length': String(size) } })
  const res = Object.assign(new EventEmitter(), {
    code: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this },
    status(c) { this.code = c; return this },
    json(b) { this.body = b; return this },
  })
  let admitted = false
  admitUpload(req, res, () => { admitted = true })
  return { req, res, admitted: () => admitted }
}

test('상한 안이면 바로 들어가고, 넘으면 앞사람이 끝날 때까지 기다린다', async () => {
  const a = fake(0.7 * MB)
  const b = fake(0.7 * MB)
  assert.equal(a.admitted(), true)
  assert.equal(b.admitted(), false)
  assert.equal(activeUploads(), 2) // 처리 중 1 + 대기 1
  a.res.emit('close') // 앞사람 끝
  assert.equal(b.admitted(), true)
  b.res.emit('close')
  assert.equal(activeUploads(), 0)
})

test('상한보다 큰 요청도 혼자서는 들어간다(영영 못 들어가는 일이 없다)', () => {
  const big = fake(10 * MB)
  assert.equal(big.admitted(), true)
  big.res.emit('close')
  assert.equal(activeUploads(), 0)
})

test('줄에서 기다리다 연결을 끊으면 자리를 비운다', () => {
  const a = fake(0.9 * MB)
  const b = fake(0.9 * MB)
  assert.equal(b.admitted(), false)
  b.req.emit('close')
  a.res.emit('close')
  assert.equal(b.admitted(), false) // 끊긴 요청은 들어오지 않는다
  assert.equal(activeUploads(), 0)
})

test('너무 오래 기다리면 503과 다시 시도 안내를 돌려준다', async () => {
  const a = fake(0.9 * MB)
  const b = fake(0.9 * MB)
  await new Promise((r) => setTimeout(r, 450))
  assert.equal(b.res.code, 503)
  assert.equal(b.res.body.code, 'upload_busy')
  assert.equal(b.res.headers['Retry-After'], '10')
  a.res.emit('close')
  assert.equal(activeUploads(), 0)
})
