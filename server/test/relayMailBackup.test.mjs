// test/relayMailBackup.test.mjs: 릴레이 메일 발송과 백업 API (DB는 mock, 릴레이는 가짜)
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
process.env.DRIVE_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
delete process.env.DATABASE_URL
delete process.env.SMTP_HOST

import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { seal } from '../src/lib/secretBox.js'
import { setDriveClientFactory, resetDriveClientFactory } from '../src/lib/googleDrive.js'
import { secretMatches } from '../src/lib/relayTransport.js'
import { cell, exhibitionTable, formTable } from '../src/lib/backupTables.js'
import { sendFormConfirmation, sendMail } from '../src/lib/mailer.js'
import { setDb } from '../src/db.js'

const SECRET = 'a'.repeat(40)
const relayRow = { id: 5, active: true, auth_mode: 'apps-script', script_url: 'https://script.google.com/macros/s/AKfycbx/exec', refresh_token_enc: seal(SECRET) }
const mockDb = (extra) => ({
  query: async (text, params) => {
    if (text.includes('FROM google_drive_connections') && text.includes('ORDER BY')) return { rows: [relayRow] }
    if (text.includes('FROM google_drive_connections')) return { rows: [relayRow] }
    return (extra && extra(text, params)) || { rows: [] }
  },
})

test('비밀키 비교는 맞는 값만 통과한다', () => {
  assert.equal(secretMatches(SECRET, [SECRET]), true)
  assert.equal(secretMatches('x', [SECRET]), false)
  assert.equal(secretMatches('', [SECRET]), false)
  assert.equal(secretMatches(SECRET, []), false)
})

test('백업 API: 비밀키가 없거나 틀리면 404, 맞으면 표를 돌려준다', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('FROM exhibition_entries')) return { rows: [{ id: 1, semester_label: '2026-2', entry_type: 'team', email: 'a@b.c', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', fields: { name: '김', work_title: '작품', original_files: [{ name: 'a.pdf', url: 'https://x/a.pdf' }] } }] }
      if (text.includes('FROM custom_forms')) return { rows: [{ id: 2, slug: 's', title_ko: '종강 총회', fields: [{ id: 'f1', label_ko: '이름', type: 'text', order: 1 }] }] }
      if (text.includes('FROM custom_form_responses')) return { rows: [{ id: 9, data: { f1: '홍길동' }, google_email: 'h@g.c', submitted_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }] }
    }),
  })
  assert.equal((await request(app).get('/relay/backup')).status, 404)
  assert.equal((await request(app).get('/relay/backup').set('X-Relay-Secret', 'wrong')).status, 404)
  const ok = await request(app).get('/relay/backup').set('X-Relay-Secret', SECRET)
  assert.equal(ok.status, 200)
  assert.equal(ok.body.tables.length, 2)
  assert.equal(ok.body.tables[0].name, '전시회 접수')
  assert.deepEqual(ok.body.tables[0].header.slice(0, 7), ['번호', '접수일시', '수정일시', '학기', '유형', '이메일', '이름'])
  assert.match(ok.body.tables[0].rows[0].join('|'), /a\.pdf \(https:\/\/x\/a\.pdf\)/)
  assert.deepEqual(ok.body.tables[1].rows[0].slice(3), ['h@g.c', '홍길동'])
  assert.equal(ok.body.tables[1].name, '폼 2 종강 총회')
})

test('표 변환: 객체와 배열을 읽을 수 있는 글로 푼다', () => {
  assert.equal(cell([{ name: 'a' }, 'b']), 'name: a, b')
  assert.equal(cell(null), '')
  assert.equal(exhibitionTable([]).rows.length, 0)
  assert.equal(formTable({ id: 1, title_ko: '제목', fields: [{ id: 's', type: 'section', label_ko: '섹션' }] }, []).header.length, 4)
})

test('확인 메일: SMTP가 없으면 연결된 릴레이로 보낸다', async () => {
  setDb(mockDb())
  let sent = null
  setDriveClientFactory(async () => ({ sendMail: async (p) => { sent = p; return { ok: true } } }))
  try {
    const ok = await sendFormConfirmation({
      form: { title_ko: '종강 총회', slug: 'closing', fields: [{ id: 'f1', label_ko: '이름', type: 'text' }, { id: 'f2', label_ko: '서류', type: 'file' }], settings: {} },
      response: { google_email: 'h@g.c', data: { f1: '홍길동', f2: 'https://x/y.pdf' } },
    })
    assert.equal(ok, true)
    assert.equal(sent.to, 'h@g.c')
    assert.match(sent.subject, /제출 완료: 종강 총회/)
    assert.match(sent.body, /이름: 홍길동/)
    assert.match(sent.body, /서류: 파일 제출됨/)
    assert.doesNotMatch(sent.body, /https:\/\/x\/y\.pdf/)
    assert.match(sent.body, /\/forms\/closing\?mode=edit/)
  } finally {
    resetDriveClientFactory()
    setDb(null)
  }
})

test('확인 메일: 폼에서 끄면 보내지 않고, 릴레이가 한도를 다 쓰면 false', async () => {
  setDb(mockDb())
  let calls = 0
  setDriveClientFactory(async () => ({ sendMail: async () => { calls += 1; return { skipped: 'quota' } } }))
  try {
    const off = await sendFormConfirmation({ form: { title_ko: 't', slug: 's', fields: [], settings: { confirmation_mail: false } }, response: { google_email: 'h@g.c', data: {} } })
    assert.equal(off, false)
    assert.equal(calls, 0)
    assert.equal(await sendMail({ to: 'h@g.c', subject: 's', text: 't' }), false)
    assert.equal(calls, 1)
  } finally {
    resetDriveClientFactory()
    setDb(null)
  }
})
