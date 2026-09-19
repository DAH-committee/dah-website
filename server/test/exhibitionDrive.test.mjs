// test/exhibitionDrive.test.mjs — 전시회 접수 원본 파일 → Google Drive (53_DRIVE_STORAGE 확장)
//
// 전시회 접수(exhibition_entries)는 custom_forms와 별개 시스템이다. 원본 업로드는
// context='exhibition-original'로 /upload에 들어오고, exhibition_settings.drive_connection_id
// 하나가 저장소를 결정한다. 과목은 site_settings.exhibitionSubjects 목록으로 서버가 검증한다.
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
process.env.DRIVE_TOKEN_ENC_KEY = Buffer.alloc(32, 3).toString('base64')
// OAuth 앱 등록 정보(가짜) — credentialsFor()가 이 값들을 먼저 확인한 뒤에야 주입된
// Drive 클라이언트 팩토리로 넘어간다. 실제 네트워크 호출은 fakeDrive가 대신한다.
process.env.GOOGLE_DRIVE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_DRIVE_REDIRECT_URI = 'http://localhost:4000/auth/google/drive/callback'
delete process.env.DATABASE_URL
delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN

import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { setDriveClientFactory, resetDriveClientFactory } from '../src/lib/googleDrive.js'
import { seal } from '../src/lib/secretBox.js'

function fakeDrive() {
  let seq = 0
  const nodes = new Map([
    ['ROOT', { id: 'ROOT', name: '26-2 전공 프로젝트 전시회', mimeType: 'application/vnd.google-apps.folder', parents: [], trashed: false, createdTime: '2020' }],
  ])
  return {
    nodes,
    calls: { create: 0 },
    files: {
      list: async ({ q }) => {
        const parent = /'([^']+)' in parents/.exec(q)?.[1]
        const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'")
        const files = [...nodes.values()].filter((n) => !n.trashed && n.parents.includes(parent) && n.name === name)
        return { data: { files: files.map(({ id, name: n, createdTime }) => ({ id, name: n, createdTime })) } }
      },
      create: async ({ requestBody, media }) => {
        this?.calls
        seq += 1
        const id = `id-${seq}`
        const node = {
          id,
          name: requestBody.name,
          mimeType: requestBody.mimeType || media?.mimeType || 'f',
          parents: requestBody.parents || [],
          trashed: false,
          createdTime: `2026-${seq}`,
        }
        nodes.set(id, node)
        return { data: { id, name: node.name, mimeType: node.mimeType, size: undefined, webViewLink: `https://drive.google.com/file/d/${id}/view` } }
      },
      get: async ({ fileId }) => {
        const node = nodes.get(fileId)
        if (!node) {
          const err = new Error('not found')
          err.status = 404
          throw err
        }
        return { data: { id: node.id, name: node.name, mimeType: node.mimeType, trashed: false, capabilities: { canAddChildren: true } } }
      },
    },
    permissions: { create: async () => ({ data: {} }) },
  }
}

const CONNECTION = {
  id: 5,
  label: '2026 전시회 Drive',
  account_email: 'smmilk2378@gmail.com',
  auth_mode: 'oauth',
  scope: 'https://www.googleapis.com/auth/drive',
  root_folder_id: 'ROOT',
  root_folder_name: '26-2 전공 프로젝트 전시회',
  active: true,
  last_check_ok: true,
  has_token: true,
  refresh_token_enc: seal('token'),
}

function makeDb({ subjects = ['디자인씽킹', 'UX 디자인'], connectionId = 5, entries = [] } = {}) {
  const state = {
    entries: [...entries],
    bindings: [],
    uploads: [],
    seq: { entry: entries.length, upload: 0, binding: 0 },
  }
  state.query = async (text, params = []) => {
    const q = String(text).replace(/\s+/g, ' ').trim()
    if (q.includes("key = 'exhibitionSubjects'")) {
      return { rows: [{ value: subjects.map((name) => ({ name, semester: 2 })) }] }
    }
    if (q.includes('FROM exhibition_settings WHERE id = 1') && q.includes('drive_connection_id')) {
      return { rows: [{ drive_connection_id: connectionId }] }
    }
    if (q.includes('FROM google_drive_connections WHERE id')) {
      if (String(params[0]) !== String(CONNECTION.id)) return { rows: [] }
      // 실제 Postgres는 SELECT에 나열한 컬럼만 돌려준다. /admin/exhibition/drive는
      // refresh_token_enc를 고르지 않으므로, 그 경우엔 그 컬럼을 빼고 돌려준다.
      if (!q.includes('refresh_token_enc')) {
        const { refresh_token_enc, ...rest } = CONNECTION
        return { rows: [rest] }
      }
      return { rows: [CONNECTION] }
    }
    if (q.includes('FROM google_drive_connections ORDER BY')) return { rows: [CONNECTION] }
    if (q.includes('FROM google_drive_folder_bindings WHERE connection_id')) {
      return { rows: state.bindings.filter((b) => b.connection_id === params[0] && b.path_key === params[1]) }
    }
    if (q.startsWith('INSERT INTO google_drive_folder_bindings')) {
      const [connectionId2, pathKey, folderId] = params
      if (!state.bindings.some((b) => b.connection_id === connectionId2 && b.path_key === pathKey)) {
        state.seq.binding += 1
        state.bindings.push({ id: state.seq.binding, connection_id: connectionId2, path_key: pathKey, folder_id: folderId })
      }
      return { rows: [] }
    }
    if (q.includes('FROM form_file_uploads WHERE idempotency_key')) {
      return { rows: state.uploads.filter((u) => u.idempotency_key === params[0]) }
    }
    if (q.startsWith('INSERT INTO form_file_uploads')) {
      state.seq.upload += 1
      const row = {
        id: state.seq.upload,
        form_id: params[0],
        field_id: params[1],
        public_user_id: params[2],
        submitter_email: params[3],
        idempotency_key: params[4],
        storage: params[5],
        purpose: params[6],
        connection_id: params[7],
        drive_file_id: params[8],
        file_url: params[9],
        folder_id: params[10],
        original_name: params[11],
        stored_name: params[12],
        mime: params[13],
        bytes: params[14],
        status: 'pending',
        response_id: null,
      }
      state.uploads.push(row)
      return { rows: [row] }
    }
    if (q.includes("SET status = 'attached'") && q.includes('field_id = ')) {
      const [entryId, urls, userId, email] = params
      let rowCount = 0
      for (const row of state.uploads) {
        if (row.form_id !== null || row.field_id !== 'exhibition_original' || row.status !== 'pending') continue
        if (!urls.includes(row.file_url)) continue
        if (userId != null && row.public_user_id != null && row.public_user_id !== userId) continue
        if (email != null && row.submitter_email != null && row.submitter_email !== email) continue
        row.status = 'attached'
        row.response_id = entryId
        rowCount += 1
      }
      return { rows: [], rowCount }
    }
    if (q.startsWith('INSERT INTO exhibition_entries')) {
      state.seq.entry += 1
      const row = {
        id: state.seq.entry,
        semester_label: params[0],
        entry_type: params[1],
        fields: JSON.parse(params[2]),
        email: params[3],
        images: JSON.parse(params[4]),
        public_user_id: params[5],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      state.entries.push(row)
      return { rows: [row] }
    }
    if (q.includes('FROM exhibition_settings WHERE id = 1') && !q.includes('drive_connection_id')) {
      return { rows: [{ submit_open: '2026-01-01T00:00:00.000Z', submit_close: '2030-01-01T00:00:00.000Z', edit_close: '2030-01-01T00:00:00.000Z' }] }
    }
    if (q.startsWith('DELETE FROM exhibition_entries')) {
      const n = state.entries.length
      state.entries = []
      return { rows: [], rowCount: n }
    }
    return { rows: [] }
  }
  return state
}

function publicCookie(email = 'student@dah.test', id = 42) {
  const token = jwt.sign({ sub: id, email, name: '학생', kind: 'public', type: 'access' }, 'test-secret', { expiresIn: '15m' })
  return `dah_pub_access=${token}`
}
function staffCookie(role, id = 1) {
  const token = jwt.sign({ sub: id, email: `${role}@dah.test`, role, type: 'access' }, 'test-secret', { expiresIn: '15m' })
  return `dah_access=${token}`
}

const useDrive = (client) => {
  setDriveClientFactory(() => client)
  return () => resetDriveClientFactory()
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

test('(E1) 저장된 과목 목록 안의 값만 원본 업로드 경로가 된다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const bad = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('context', 'exhibition-original')
    .field('course', '../../탈출')
    .attach('file', PNG, 'work.png')
  assert.equal(bad.status, 422)
  assert.equal(drive.calls.create, 0)

  const good = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('context', 'exhibition-original')
    .field('course', '디자인씽킹')
    .attach('file', PNG, '작품 원본.png')
  assert.equal(good.status, 201)
  assert.deepEqual(good.body.path, ['디자인씽킹', '원본'])
  assert.equal(good.body.type, 'image/png')
  assert.equal(good.body.bytes, PNG.length) // 원본 무변환
  restore()
})

test('(E2) 저장소가 지정되지 않으면 409로 막힌다', async () => {
  const db = makeDb({ connectionId: null })
  const restore = useDrive(fakeDrive())
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('context', 'exhibition-original')
    .field('course', '디자인씽킹')
    .attach('file', PNG, 'a.png')
  assert.equal(res.status, 409)
  assert.equal(res.body.error.includes('저장소'), true)
})

test('(E3) 비로그인은 원본을 올릴 수 없다', async () => {
  const db = makeDb()
  const restore = useDrive(fakeDrive())
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/upload')
    .field('context', 'exhibition-original')
    .field('course', '디자인씽킹')
    .attach('file', PNG, 'a.png')
  assert.equal(res.status, 401)
  restore()
})

test('(E4) 접수 제출 시 업로드가 pending에서 attached로 바뀐다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const up = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('context', 'exhibition-original')
    .field('course', '디자인씽킹')
    .attach('file', PNG, '작품.png')
  assert.equal(db.uploads[0].status, 'pending')

  const submitted = await request(app)
    .post('/submit/exhibition')
    .set('Cookie', publicCookie())
    .send({
      entry_type: 'solo',
      fields: {
        name: '학생',
        student_no: '20260001',
        major: '디지털인문예술',
        phone: '010-1234-5678',
        course: '디자인씽킹',
        work_title: '작품명',
        work_desc: '설명',
        original_files: [{ url: up.body.url, name: '작품.png' }],
      },
    })
  assert.equal(submitted.status, 201)
  assert.equal(db.uploads[0].status, 'attached')
  assert.equal(db.uploads[0].response_id, submitted.body.entry.id)
  assert.deepEqual(submitted.body.entry.fields.original_files, [{ url: up.body.url, name: '작품.png' }])
  restore()
})

test('(E5) 제출 시 과목 임의값은 400으로 거부된다', async () => {
  const db = makeDb()
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/submit/exhibition')
    .set('Cookie', publicCookie())
    .send({ entry_type: 'solo', fields: { course: '없는과목', work_title: 't', work_desc: 'd' } })
  assert.equal(res.status, 400)
})

test('(E6) owner만 접수 전체 삭제를 할 수 있다', async () => {
  const db = makeDb({ entries: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] })
  const app = createApp({ db: { query: db.query } })

  const managerTry = await request(app).delete('/admin/exhibition/entries').set('Cookie', staffCookie('manager'))
  assert.equal(managerTry.status, 403)

  const ownerTry = await request(app).delete('/admin/exhibition/entries').set('Cookie', staffCookie('owner', 2))
  assert.equal(ownerTry.status, 200)
  assert.equal(ownerTry.body.deleted, 4)
  assert.equal(db.entries.length, 0)
})

test('(E7) GET /settings/public에는 drive_connection_id가 노출되지 않는다', async () => {
  const db = makeDb()
  const app = createApp({ db: { query: db.query } })
  const res = await request(app).get('/settings/public')
  assert.equal(res.status, 200)
  assert.equal(JSON.stringify(res.body).includes('drive_connection_id'), false)
})

test('(E8) 관리자 전용 GET /admin/exhibition/drive는 연결 정보를 보여준다', async () => {
  const db = makeDb()
  const app = createApp({ db: { query: db.query } })
  const anon = await request(app).get('/admin/exhibition/drive')
  assert.equal(anon.status, 401)
  const res = await request(app).get('/admin/exhibition/drive').set('Cookie', staffCookie('manager'))
  assert.equal(res.status, 200)
  assert.equal(res.body.connection_id, 5)
  assert.equal(res.body.connection.account_email, 'smmilk2378@gmail.com')
  assert.equal(JSON.stringify(res.body).includes('refresh_token_enc'), false)
})

test('(E9) 같은 원본을 다시 올려도 idempotent 하게 처리된다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const send = () =>
    request(app)
      .post('/upload')
      .set('Cookie', publicCookie())
      .field('context', 'exhibition-original')
      .field('course', '디자인씽킹')
      .attach('file', PNG, '작품.png')
  const first = await send()
  const second = await send()
  assert.equal(first.status, 201)
  assert.equal(second.status, 200)
  assert.equal(second.body.idempotent, true)
  assert.equal(db.uploads.length, 1)
  restore()
})
