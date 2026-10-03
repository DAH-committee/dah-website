// test/sheets.test.mjs: 관리자 시트 편집 API와 구글 시트 내보내기 (DB는 mock 주입)
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { createGoogleSheet, normalizeValues, toCsv } from '../src/lib/sheetExport.js'
import { cleanFieldPatch } from '../src/routes/sheets.js'

const MANAGER = { id: 7, email: 'm@example.com', name: '운영', role: 'manager' }
const cookie = (u) =>
  `dah_access=${jwt.sign({ sub: u.id, email: u.email, name: u.name, role: u.role, type: 'access' }, 'test-secret', { expiresIn: '15m' })}`
const mockDb = (handler) => ({ query: async (text, params) => handler(text, params) ?? { rows: [] } })

test('로그인하지 않으면 접수 칸을 고칠 수 없다', async () => {
  const app = createApp({ db: mockDb(() => ({ rows: [] })) })
  const res = await request(app).put('/admin/exhibition/entries/1').send({ fields: { name: 'x' } })
  assert.equal(res.status, 401)
})

test('접수 칸 고치기: 허용한 칸만 얕게 합치고 SQL에는 JSON으로 넘긴다', async () => {
  let seen = null
  const app = createApp({
    db: mockDb((text, params) => {
      if (text.startsWith('UPDATE exhibition_entries')) {
        seen = params
        return { rows: [{ id: 3, fields: { name: '김철수' }, email: 'a@b.c' }] }
      }
    }),
  })
  const res = await request(app).put('/admin/exhibition/entries/3').set('Cookie', cookie(MANAGER)).send({ fields: { name: '김철수' }, email: ' A@B.C ' })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(seen[0]), { name: '김철수' })
  assert.equal(seen[1], 'a@b.c')
  assert.equal(seen[3], 3)
})

test('파일 목록, 팀원 목록, 객체 값, 이상한 키는 이 화면에서 고칠 수 없다', () => {
  assert.ok(cleanFieldPatch({ original_files: [] }).error)
  assert.ok(cleanFieldPatch({ members: [] }).error)
  assert.ok(cleanFieldPatch({ name: { a: 1 } }).error)
  assert.ok(cleanFieldPatch({ 'a b; drop': 'x' }).error)
  assert.ok(cleanFieldPatch({ memo: 'x'.repeat(5000) }).error)
  assert.deepEqual(cleanFieldPatch({ work_title: '작품', n: 3, ok: true }).value, { work_title: '작품', n: '3', ok: 'true' })
})

test('고칠 내용이 없으면 400, 없는 접수는 404', async () => {
  const app = createApp({ db: mockDb(() => ({ rows: [] })) })
  const empty = await request(app).put('/admin/exhibition/entries/3').set('Cookie', cookie(MANAGER)).send({})
  assert.equal(empty.status, 400)
  const missing = await request(app).put('/admin/exhibition/entries/3').set('Cookie', cookie(MANAGER)).send({ fields: { name: 'x' } })
  assert.equal(missing.status, 404)
})

test('접수 삭제: ids 필수, 200건 상한, 중복 제거', async () => {
  let ids = null
  const app = createApp({ db: mockDb((text, params) => { if (text.startsWith('DELETE FROM exhibition_entries')) { ids = params[0]; return { rows: [], rowCount: 2 } } }) })
  const none = await request(app).post('/admin/exhibition/entries/delete').set('Cookie', cookie(MANAGER)).send({})
  assert.equal(none.status, 400)
  const many = await request(app).post('/admin/exhibition/entries/delete').set('Cookie', cookie(MANAGER)).send({ ids: Array.from({ length: 201 }, (_, i) => i + 1) })
  assert.equal(many.status, 400)
  const ok = await request(app).post('/admin/exhibition/entries/delete').set('Cookie', cookie(MANAGER)).send({ ids: [4, 4, 5] })
  assert.equal(ok.status, 200)
  assert.deepEqual(ids, [4, 5])
  assert.equal(ok.body.deleted, 2)
})

test('시트 화면 상태 저장과 읽기', async () => {
  let saved = null
  const app = createApp({
    db: mockDb((text, params) => {
      if (text.includes('INSERT INTO admin_sheet_state')) saved = JSON.parse(params[1])
      if (text.startsWith('SELECT value, updated_at FROM admin_sheet_state')) return { rows: [{ value: saved, updated_at: 'now' }] }
    }),
  })
  const put = await request(app).put('/admin/sheets/entries/state').set('Cookie', cookie(MANAGER)).send({ state: { widths: { id: 90 } } })
  assert.equal(put.status, 200)
  const get = await request(app).get('/admin/sheets/entries/state').set('Cookie', cookie(MANAGER))
  assert.deepEqual(get.body.state, { widths: { id: 90 } })
  const bad = await request(app).put('/admin/sheets/Bad Key/state').set('Cookie', cookie(MANAGER)).send({ state: {} })
  assert.equal(bad.status, 400)
  const notObj = await request(app).put('/admin/sheets/entries/state').set('Cookie', cookie(MANAGER)).send({ state: [1] })
  assert.equal(notObj.status, 400)
})

test('내보내기 값 정규화와 CSV', () => {
  assert.deepEqual(normalizeValues([['a', 1], ['b']]), [['a', '1'], ['b', '']])
  assert.throws(() => normalizeValues([]))
  assert.equal(toCsv([['a"b', 'c']]), '"a""b","c"')
  assert.throws(() => normalizeValues([Array(1000).fill('x'), ...Array(300).fill(Array(1000).fill('x'))]), /크기/)
})

test('구글 시트 만들기: Apps Script 방식은 createSheet를, 로그인 방식은 CSV 변환 업로드를 쓴다', async () => {
  const viaRelay = await createGoogleSheet({
    drive: { createSheet: async ({ name, values, parentId }) => ({ id: 'S1', url: `https://docs.google.com/spreadsheets/d/S1/edit#${name}${values.length}${parentId}` }) },
    name: '접수/현황', values: [['a'], ['b']], parentId: 'P',
  })
  assert.equal(viaRelay.id, 'S1')
  assert.match(viaRelay.url, /접수 현황2P/)

  let sent = null
  const viaApi = await createGoogleSheet({
    drive: { files: { create: async (arg) => { sent = arg; return { data: { id: 'S2', webViewLink: 'https://docs.google.com/spreadsheets/d/S2/edit' } } } } },
    name: '시트', values: [['x', 'y']],
  })
  assert.equal(viaApi.id, 'S2')
  assert.equal(sent.requestBody.mimeType, 'application/vnd.google-apps.spreadsheet')
  assert.equal(sent.media.mimeType, 'text/csv')
})
