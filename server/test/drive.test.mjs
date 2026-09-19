// test/drive.test.mjs — Google Drive 저장소 연동 (53_DRIVE_STORAGE)
//
// Drive 클라이언트는 setDriveClientFactory()로 가짜를 주입하고, DB는 SQL 패턴 라우팅 mock을 쓴다.
// 네트워크·실계정 없이 폴더 생성·재사용·동시 요청·권한 거부·재시도·멱등·원본 무변환·권한 분리를 검증한다.
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
process.env.DRIVE_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.GOOGLE_DRIVE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_DRIVE_REDIRECT_URI = 'http://localhost:4000/auth/google/drive/callback'
delete process.env.DATABASE_URL
delete process.env.BLOB_READ_WRITE_TOKEN
delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN

import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { createApp } from '../src/app.js'
import {
  ensureFolderPath,
  probeFolder,
  sanitizeFolderName,
  setDriveClientFactory,
  resetDriveClientFactory,
  withDriveRetry,
} from '../src/lib/googleDrive.js'
import { ensurePath } from '../src/lib/driveConnections.js'
import { seal } from '../src/lib/secretBox.js'
import { normalizeFileStorage, resolveCourse } from '../src/lib/formStorage.js'

// ── 가짜 Drive ─────────────────────────────────────────────

/**
 * 폴더·파일을 메모리에 담는 Drive v3 호환 가짜 클라이언트.
 * @param {{roots?:string[], fail?:Function}} options roots: 존재하는 루트 폴더 ID 목록
 */
function fakeDrive({ roots = ['ROOT'], fail = null } = {}) {
  let seq = 0
  const nodes = new Map()
  for (const id of roots) {
    nodes.set(id, { id, name: `root-${id}`, mimeType: 'application/vnd.google-apps.folder', parents: [], trashed: false, createdTime: '2020-01-01T00:00:00.000Z' })
  }
  const calls = { list: 0, create: 0, get: 0, permission: 0, about: 0 }
  const maybeFail = (op) => {
    const err = fail?.(op, calls)
    if (err) throw err
  }

  const client = {
    calls,
    nodes,
    about: {
      get: async () => {
        calls.about += 1
        maybeFail('about')
        return { data: { user: { emailAddress: 'smmilk2378@gmail.com', displayName: '주현호' }, storageQuota: { limit: '1000', usage: '1' } } }
      },
    },
    files: {
      list: async ({ q }) => {
        calls.list += 1
        maybeFail('list')
        const parent = /'([^']+)' in parents/.exec(q)?.[1]
        const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'")
        const files = [...nodes.values()]
          .filter((n) => !n.trashed && n.parents.includes(parent) && n.name === name && n.mimeType === 'application/vnd.google-apps.folder')
          .sort((a, b) => a.createdTime.localeCompare(b.createdTime))
        return { data: { files: files.map(({ id, name: n, createdTime }) => ({ id, name: n, createdTime })) } }
      },
      create: async ({ requestBody, media }) => {
        calls.create += 1
        maybeFail('create')
        seq += 1
        const id = `id-${seq}`
        const node = {
          id,
          name: requestBody.name,
          mimeType: requestBody.mimeType || media?.mimeType || 'application/octet-stream',
          parents: requestBody.parents || [],
          trashed: false,
          createdTime: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
          appProperties: requestBody.appProperties || {},
          description: requestBody.description || '',
          bytes: media ? 0 : undefined,
          media,
        }
        nodes.set(id, node)
        return { data: { id, name: node.name, mimeType: node.mimeType, size: undefined, createdTime: node.createdTime, webViewLink: `https://drive.google.com/file/d/${id}/view` } }
      },
      get: async ({ fileId }) => {
        calls.get += 1
        maybeFail('get')
        const node = nodes.get(fileId)
        if (!node) {
          const err = new Error('File not found')
          err.status = 404
          throw err
        }
        return {
          data: {
            id: node.id,
            name: node.name,
            mimeType: node.mimeType,
            trashed: node.trashed,
            driveId: null,
            webViewLink: `https://drive.google.com/drive/folders/${node.id}`,
            capabilities: { canAddChildren: true, canEdit: true },
          },
        }
      },
      update: async ({ fileId, requestBody }) => {
        const node = nodes.get(fileId)
        if (node && requestBody?.trashed) node.trashed = true
        return { data: { id: fileId } }
      },
    },
    permissions: {
      create: async () => {
        calls.permission += 1
        return { data: { id: 'perm' } }
      },
    },
  }
  return client
}

function useDrive(client) {
  setDriveClientFactory(() => client)
  return () => resetDriveClientFactory()
}

// ── 가짜 DB ────────────────────────────────────────────────

const CONNECTION = {
  id: 1,
  label: '2026 주현호 개인 Drive',
  account_email: 'smmilk2378@gmail.com',
  auth_mode: 'oauth',
  scope: 'https://www.googleapis.com/auth/drive',
  root_folder_id: 'ROOT',
  root_folder_name: '2026 한림대학교 디지털인문예술전공',
  active: true,
  last_check_at: null,
  last_check_ok: true,
  last_error: '',
  created_at: '2026-09-20T00:00:00.000Z',
  updated_at: '2026-09-20T00:00:00.000Z',
  has_token: true,
  refresh_token_enc: seal('super-secret-refresh-token'),
}

function driveForm(overrides = {}) {
  return {
    id: 10,
    slug: 'exhibition-2026-2',
    title_ko: '전공 프로젝트 전시회',
    title_en: '',
    description_ko: '',
    category: 'event',
    published: true,
    fields: [
      { id: 'course', type: 'select', label_ko: '참가 과목', required: true, options: ['디자인씽킹', '데이터시각화'], order: 1 },
      {
        id: 'origin',
        type: 'file',
        label_ko: '원본 파일',
        required: true,
        order: 2,
        storage: {
          target: 'drive',
          purpose: 'original',
          accept: [],
          max_bytes: null,
          connection_id: 1,
          path_template: 'exhibition_original',
          folder_label: '원본',
          share_mode: 'restricted',
        },
      },
      {
        id: 'web',
        type: 'file',
        label_ko: '웹 전시용 이미지',
        required: false,
        order: 3,
        storage: {
          target: 'blob',
          purpose: 'web',
          accept: [],
          max_bytes: null,
          connection_id: null,
          path_template: 'semester_form_field',
          folder_label: '',
          share_mode: 'restricted',
        },
      },
    ],
    settings: {
      accept_start: '2026-01-01T00:00:00.000Z',
      accept_end: '2030-01-01T00:00:00.000Z',
      require_google_auth: true,
      drive_semester: '2026-2',
      drive_course_field_id: 'course',
    },
    ...overrides,
  }
}

/** 예전 폼: 파일 질문에 storage가 없고 폼 전역 Drive 설정만 있는 상태 */
function legacyForm() {
  return {
    id: 11,
    slug: 'legacy-exhibition',
    title_ko: '전공 프로젝트 전시회',
    category: 'event',
    published: true,
    fields: [
      { id: 'course', type: 'select', label_ko: '참가 과목', options: ['디자인씽킹'], order: 1 },
      { id: 'file1', type: 'file', label_ko: '작품 원본', order: 2 },
    ],
    settings: {
      accept_start: '2026-01-01T00:00:00.000Z',
      accept_end: '2030-01-01T00:00:00.000Z',
      require_google_auth: true,
      drive_enabled: true,
      drive_folder_id: 'ROOT',
      drive_auto_folder: true,
      drive_semester: '2026-2',
      drive_course_field_id: 'course',
      drive_share_mode: 'restricted',
      drive_connection_id: 1,
    },
  }
}

// CONNECTION은 모듈 수준 객체다. 테스트마다 복제해 서로의 상태를 오염시키지 않는다.
function makeDb({ forms = [driveForm()], connections = [{ ...CONNECTION }], offerings = 3 } = {}) {
  const state = { forms, connections, bindings: [], uploads: [], responses: [], offerings, seq: { upload: 0, response: 0, binding: 0 } }
  const pub = (row) => {
    const { refresh_token_enc, ...rest } = row
    return { ...rest, has_token: Boolean(refresh_token_enc) }
  }

  state.query = async (text, params = []) => {
    const q = String(text).replace(/\s+/g, ' ').trim()

    if (q.includes('FROM custom_forms WHERE slug')) {
      return { rows: state.forms.filter((f) => f.slug === params[0]) }
    }
    if (q.includes('FROM custom_forms WHERE id')) {
      return { rows: state.forms.filter((f) => String(f.id) === String(params[0])) }
    }
    if (q.includes('FROM custom_forms ORDER BY')) return { rows: state.forms }

    if (q.includes('FROM google_drive_connections WHERE id')) {
      const row = state.connections.find((c) => String(c.id) === String(params[0]))
      return { rows: row ? [row] : [] }
    }
    if (q.includes('FROM google_drive_connections ORDER BY')) {
      return { rows: state.connections.map(pub) }
    }
    if (q.startsWith('UPDATE google_drive_connections')) {
      const row = state.connections.find((c) => String(c.id) === String(params[params.length - 1]))
      if (!row) return { rows: [] }
      if (q.includes('refresh_token_enc = NULL')) {
        row.refresh_token_enc = null
        row.active = false
      }
      if (q.includes('last_check_at = now()')) {
        row.last_check_at = new Date().toISOString()
        row.last_check_ok = params[0]
        row.last_error = params[1]
      }
      return { rows: [pub(row)] }
    }

    if (q.includes('FROM google_drive_folder_bindings WHERE connection_id')) {
      return { rows: state.bindings.filter((b) => b.connection_id === params[0] && b.path_key === params[1]) }
    }
    if (q.startsWith('INSERT INTO google_drive_folder_bindings')) {
      const [connectionId, pathKey, folderId] = params
      if (!state.bindings.some((b) => b.connection_id === connectionId && b.path_key === pathKey)) {
        state.seq.binding += 1
        state.bindings.push({ id: state.seq.binding, connection_id: connectionId, path_key: pathKey, folder_id: folderId })
      }
      return { rows: [] }
    }
    if (q.startsWith('DELETE FROM google_drive_folder_bindings')) {
      state.bindings = state.bindings.filter((b) => String(b.id) !== String(params[0]))
      return { rows: [], rowCount: 1 }
    }

    if (q.includes('FROM form_file_uploads WHERE idempotency_key')) {
      return { rows: state.uploads.filter((u) => u.idempotency_key === params[0]) }
    }
    if (q.includes('FROM form_file_uploads WHERE id')) {
      return { rows: state.uploads.filter((u) => String(u.id) === String(params[0])) }
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
        created_at: new Date().toISOString(),
        attached_at: null,
      }
      state.uploads.push(row)
      return { rows: [row] }
    }
    if (q.includes("SET status = 'attached'")) {
      const [responseId, formId, urls, userId, email] = params
      let rowCount = 0
      for (const row of state.uploads) {
        if (row.form_id !== formId || row.status !== 'pending') continue
        if (!urls.includes(row.file_url)) continue
        if (userId != null && row.public_user_id != null && row.public_user_id !== userId) continue
        if (email != null && row.submitter_email != null && row.submitter_email !== email) continue
        row.status = 'attached'
        row.response_id = responseId
        row.attached_at = new Date().toISOString()
        rowCount += 1
      }
      return { rows: [], rowCount }
    }
    if (q.includes("SET status = 'deleted'")) {
      const row = state.uploads.find((u) => String(u.id) === String(params[0]))
      if (row) row.status = 'deleted'
      return { rows: row ? [row] : [] }
    }
    if (q.includes('FROM form_file_uploads u')) {
      return { rows: state.uploads.filter((u) => params[0] === 'all' || u.status === params[0]) }
    }
    if (q.includes("COUNT(*)::int AS n FROM form_file_uploads")) {
      return { rows: [{ n: state.uploads.filter((u) => u.status === 'pending').length }] }
    }

    if (q.includes('FROM semester_offerings')) return { rows: [{ n: state.offerings }] }

    if (q.startsWith('INSERT INTO custom_form_responses')) {
      state.seq.response += 1
      const row = {
        id: state.seq.response,
        form_id: params[0],
        data: JSON.parse(params[1]),
        google_email: params[3],
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      state.responses.push(row)
      return { rows: [row] }
    }
    if (q.includes('COUNT(*)::int AS n FROM custom_form_responses')) {
      return { rows: [{ n: state.responses.length }] }
    }

    return { rows: [] }
  }
  return state
}

function staffCookie(role, id = 1) {
  const token = jwt.sign(
    { sub: id, email: `${role}@dah.test`, name: role, role, type: 'access' },
    'test-secret',
    { expiresIn: '15m' }
  )
  return `dah_access=${token}`
}

function publicCookie(email = 'student@dah.test', id = 99) {
  const token = jwt.sign(
    { sub: id, email, name: '학생', kind: 'public', type: 'access' },
    'test-secret',
    { expiresIn: '15m' }
  )
  return `dah_pub_access=${token}`
}

const PNG = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#7157d9' } })
  .png()
  .toBuffer()

// ── 폴더 경로 ──────────────────────────────────────────────

test('(1) 없는 폴더는 자동 생성되고 경로 단계가 모두 기록된다', async () => {
  const drive = fakeDrive()
  const result = await ensureFolderPath(drive, {
    rootFolderId: 'ROOT',
    segments: ['2026-2', '전공 프로젝트 전시회', '디자인씽킹', '원본'],
  })
  assert.equal(result.steps.length, 4)
  assert.ok(result.steps.every((s) => s.id))
  assert.ok(result.steps.every((s) => s.created))
  assert.ok(result.folderId)
})

test('(2) 이미 있는 폴더는 재사용한다 (두 번 호출해도 새 폴더를 만들지 않는다)', async () => {
  const drive = fakeDrive()
  const first = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['2026-2', '원본'] })
  const createdAfterFirst = drive.calls.create
  const second = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['2026-2', '원본'] })
  assert.equal(second.folderId, first.folderId)
  assert.equal(drive.calls.create, createdAfterFirst)
})

test('(3) 같은 경로를 동시에 요청해도 하나의 폴더로 수렴한다', async () => {
  const drive = fakeDrive()
  const [a, b] = await Promise.all([
    ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['2026-2', '전공 프로젝트 전시회'] }),
    ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['2026-2', '전공 프로젝트 전시회'] }),
  ])
  assert.equal(a.folderId, b.folderId)
})

test('(3-보강) 폴더명에서 경로 문자·상위 경로·제어문자를 제거한다', () => {
  assert.equal(sanitizeFolderName('../../etc/passwd'), '. etc passwd')
  assert.equal(sanitizeFolderName('디자인\u0000씽킹/2026'), '디자인 씽킹 2026')
  assert.equal(sanitizeFolderName('  정상 폴더명  '), '정상 폴더명')
})

test('(4) 루트 폴더 접근이 거부되면 다른 폴더에 올리지 않고 409로 막는다', async () => {
  const drive = fakeDrive({ roots: [] })
  const probe = await probeFolder(drive, 'ROOT')
  assert.equal(probe.ok, false)
  assert.equal(probe.reason, 'not_found')

  const db = makeDb()
  const { setDb } = await import('../src/db.js')
  setDb(db)
  const restore = useDrive(drive)
  await assert.rejects(
    () => ensurePath({ connection: CONNECTION, rootFolderId: 'ROOT', segments: ['2026-2'] }),
    (err) => err.status === 409 && err.code === 'root_not_found'
  )
  restore()
  setDb(null)
})

test('(5) 계정을 바꿔 예전 루트에 접근 못 하면 업로드가 409로 거부된다', async () => {
  const db = makeDb()
  const drive = fakeDrive({ roots: ['OTHER-ROOT'] }) // 새 계정: 예전 루트(ROOT)가 없다
  const restore = useDrive(drive)
  const app = createApp({ db: db.query ? { query: db.query } : db })
  const res = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'origin')
    .field('formValues', JSON.stringify({ course: '디자인씽킹' }))
    .attach('file', PNG, 'poster.png')
  assert.equal(res.status, 409)
  assert.match(res.body.error, /접근할 수 없습니다|찾을 수 없습니다/)
  restore()
})

// ── 재시도 ─────────────────────────────────────────────────

test('(6) 429는 지수 백오프로 재시도한다', async () => {
  let attempts = 0
  const result = await withDriveRetry(
    async () => {
      attempts += 1
      if (attempts < 3) {
        const err = new Error('rate limit')
        err.status = 429
        throw err
      }
      return 'ok'
    },
    { retries: 4, baseMs: 1 }
  )
  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
})

test('(7) 5xx도 재시도하고, 4xx는 즉시 실패한다', async () => {
  let fiveHundred = 0
  const ok = await withDriveRetry(
    async () => {
      fiveHundred += 1
      if (fiveHundred < 2) {
        const err = new Error('backend error')
        err.status = 503
        throw err
      }
      return 'done'
    },
    { retries: 3, baseMs: 1 }
  )
  assert.equal(ok, 'done')

  let forbidden = 0
  await assert.rejects(
    () =>
      withDriveRetry(
        async () => {
          forbidden += 1
          const err = new Error('forbidden')
          err.status = 403
          throw err
        },
        { retries: 3, baseMs: 1 }
      ),
    /forbidden/
  )
  assert.equal(forbidden, 1)
})

test('(7-보강) 폴더 생성 중 429가 나도 재시도 후 성공한다', async () => {
  let thrown = false
  const drive = fakeDrive({
    fail: (op) => {
      if (op === 'create' && !thrown) {
        thrown = true
        const err = new Error('rate limit')
        err.status = 429
        return err
      }
      return null
    },
  })
  const result = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['2026-2'] })
  assert.ok(result.folderId)
  assert.ok(thrown)
})

// ── 업로드 ─────────────────────────────────────────────────

test('(8) 같은 파일을 다시 올려도 Drive에 파일이 두 개 생기지 않는다 (idempotency)', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const send = () =>
    request(app)
      .post('/upload')
      .set('Cookie', publicCookie())
      .field('formSlug', 'exhibition-2026-2')
      .field('fieldId', 'origin')
      .field('formValues', JSON.stringify({ course: '디자인씽킹' }))
      .attach('file', PNG, 'poster.png')

  const first = await send()
  assert.equal(first.status, 201)
  const second = await send()
  assert.equal(second.status, 200)
  assert.equal(second.body.idempotent, true)
  assert.equal(second.body.url, first.body.url)
  assert.equal(db.uploads.length, 1)
  restore()
})

test('(9) 과목 보기 목록에 없는 값은 폴더로 쓰이지 않고 422로 막힌다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'origin')
    .field('formValues', JSON.stringify({ course: '../../탈출폴더' }))
    .attach('file', PNG, 'poster.png')
  assert.equal(res.status, 422)
  assert.equal(db.uploads.length, 0)
  assert.equal(drive.calls.create, 0)
  restore()

  // 순수 함수 수준에서도 같은 판정
  const form = driveForm()
  assert.equal(resolveCourse(form, { course: '디자인씽킹' }).ok, true)
  assert.equal(resolveCourse(form, { course: '임의 과목' }).reason, 'course_not_allowed')
  assert.equal(resolveCourse(form, {}).reason, 'course_not_selected')
})

test('(10) Drive 원본은 WebP로 변환되지 않고 확장자·MIME·바이트가 보존된다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'origin')
    .field('formValues', JSON.stringify({ course: '디자인씽킹' }))
    .attach('file', PNG, '작품 원본.png')

  assert.equal(res.status, 201)
  assert.equal(res.body.format, 'png')
  assert.equal(res.body.type, 'image/png')
  assert.equal(res.body.bytes, PNG.length)
  assert.match(res.body.stored_name, /\.png$/)
  assert.equal(res.body.name, '작품 원본.png') // 원본 파일명은 기록으로 보존
  assert.deepEqual(res.body.path, ['2026-2', '전공 프로젝트 전시회', '디자인씽킹', '원본'])
  restore()
})

test('(11) 웹 전시용(Blob) 이미지만 WebP로 최적화된다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'web')
    .attach('file', PNG, 'thumb.png')

  assert.equal(res.status, 201)
  assert.equal(res.body.format, 'webp')
  assert.equal(res.body.type, 'image/webp')
  assert.notEqual(res.body.bytes, PNG.length)
  assert.equal(res.body.storage, 'local') // Blob 토큰이 없는 테스트 환경의 폴백
  assert.equal(drive.calls.create, 0) // Drive는 건드리지 않는다
  restore()
})

test('(12) 실행 파일과 허용 밖 확장자는 서버가 차단한다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const exe = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'origin')
    .field('formValues', JSON.stringify({ course: '디자인씽킹' }))
    .attach('file', Buffer.from('MZ'), 'virus.exe')
  assert.equal(exe.status, 400)

  const weird = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'web')
    .attach('file', Buffer.from('hello'), 'notes.txt')
  assert.equal(weird.status, 400)
  assert.equal(drive.calls.create, 0)
  restore()
})

test('(13) 폼 제출 시 pending 업로드가 attached로 바뀐다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const uploaded = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'origin')
    .field('formValues', JSON.stringify({ course: '디자인씽킹' }))
    .attach('file', PNG, 'poster.png')
  assert.equal(db.uploads[0].status, 'pending')

  const submitted = await request(app)
    .post('/forms/exhibition-2026-2/submit')
    .set('Cookie', publicCookie())
    .send({ data: { course: '디자인씽킹', origin: uploaded.body.url } })
  assert.equal(submitted.status, 201)
  assert.equal(db.uploads[0].status, 'attached')
  assert.equal(db.uploads[0].response_id, submitted.body.response.id)
  restore()
})

test('(14) 제출되지 않은 업로드는 pending으로 남고 자동 삭제되지 않는다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'exhibition-2026-2')
    .field('fieldId', 'origin')
    .field('formValues', JSON.stringify({ course: '디자인씽킹' }))
    .attach('file', PNG, 'orphan.png')

  const list = await request(app).get('/admin/drive/uploads?status=pending').set('Cookie', staffCookie('manager'))
  assert.equal(list.status, 200)
  assert.equal(list.body.items.length, 1)
  assert.equal(list.body.items[0].status, 'pending')
  assert.equal(db.uploads[0].status, 'pending')
  restore()
})

// ── 기존 폼 호환 ───────────────────────────────────────────

test('(15) storage가 없는 예전 폼은 폼 전역 Drive 설정을 그대로 따른다', async () => {
  const db = makeDb({ forms: [legacyForm()] })
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/upload')
    .set('Cookie', publicCookie())
    .field('formSlug', 'legacy-exhibition')
    .field('fieldId', 'file1')
    .field('formValues', JSON.stringify({ course: '디자인씽킹' }))
    .attach('file', PNG, 'legacy.png')

  assert.equal(res.status, 201)
  assert.equal(res.body.storage, 'google-drive')
  assert.equal(res.body.format, 'png') // 원본 보존
  assert.deepEqual(res.body.path, ['2026-2', '전공 프로젝트 전시회', '디자인씽킹', '원본'])
  restore()

  // 정규화 함수 수준 확인
  const legacy = normalizeFileStorage(undefined, legacyForm().settings)
  assert.equal(legacy.target, 'drive')
  assert.equal(legacy.purpose, 'original')
  assert.equal(legacy.path_template, 'exhibition_original')
  const plain = normalizeFileStorage(undefined, {})
  assert.equal(plain.target, 'blob')
})

// ── 권한·비밀값 ────────────────────────────────────────────

test('(16) Drive 연결 설정은 owner 전용이고 manager는 선택만 할 수 있다', async () => {
  const db = makeDb()
  const app = createApp({ db: { query: db.query } })

  const managerStatus = await request(app).get('/admin/drive/status').set('Cookie', staffCookie('manager'))
  assert.equal(managerStatus.status, 200)

  const managerConnect = await request(app)
    .post('/admin/drive/connect-url')
    .set('Cookie', staffCookie('manager'))
    .send({ label: '시도' })
  assert.equal(managerConnect.status, 403)

  const managerDelete = await request(app)
    .delete('/admin/drive/connections/1')
    .set('Cookie', staffCookie('manager'))
  assert.equal(managerDelete.status, 403)

  const ownerConnect = await request(app)
    .post('/admin/drive/connect-url')
    .set('Cookie', staffCookie('owner', 2))
    .send({ label: '2027 운영위원장 Drive' })
  assert.equal(ownerConnect.status, 200)
  assert.match(ownerConnect.body.url, /accounts\.google\.com/)

  const anon = await request(app).get('/admin/drive/status')
  assert.equal(anon.status, 401)
})

test('(17) 어떤 응답에도 refresh token과 암호문이 나오지 않는다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const status = await request(app).get('/admin/drive/status').set('Cookie', staffCookie('owner', 2))
  const check = await request(app)
    .post('/admin/drive/connections/1/check')
    .set('Cookie', staffCookie('owner', 2))
    .send({})
  const bodies = JSON.stringify([status.body, check.body])
  assert.equal(bodies.includes('super-secret-refresh-token'), false)
  assert.equal(bodies.includes(CONNECTION.refresh_token_enc), false)
  assert.equal(bodies.includes('refresh_token_enc'), false)
  assert.equal(status.body.connections[0].has_token, true)
  restore()
})

test('(18) 연결 해제는 토큰만 폐기하고 Drive 파일은 지우지 않는다', async () => {
  const db = makeDb()
  const app = createApp({ db: { query: db.query } })
  const res = await request(app).delete('/admin/drive/connections/1').set('Cookie', staffCookie('owner', 2))
  assert.equal(res.status, 200)
  assert.equal(res.body.files_kept, true)
  assert.equal(db.connections[0].refresh_token_enc, null)
  assert.equal(db.connections[0].active, false)
})

// ── 미리보기·준비·공개 사전검사 ──────────────────────────────

test('(19) 폴더 구조 미리보기는 폴더를 만들지 않고 누락 단계를 알려준다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/admin/drive/preview')
    .set('Cookie', staffCookie('manager'))
    .send({ form_id: 10, deep: true })

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  const originPlan = res.body.plans.find((p) => p.field_id === 'origin')
  assert.deepEqual(originPlan.segments, ['2026-2', '전공 프로젝트 전시회', '(과목명)', '원본'])
  assert.equal(drive.calls.create, 0) // 미리보기는 생성하지 않는다
  restore()
})

test('(20) 누락 폴더 준비는 실제로 만들고, 다시 눌러도 같은 폴더를 쓴다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const body = { form_id: 10, field_id: 'origin', course: '디자인씽킹' }
  const first = await request(app).post('/admin/drive/prepare').set('Cookie', staffCookie('manager')).send(body)
  assert.equal(first.status, 201)
  assert.ok(first.body.folder_id)

  const second = await request(app).post('/admin/drive/prepare').set('Cookie', staffCookie('manager')).send(body)
  assert.equal(second.body.folder_id, first.body.folder_id)
  assert.equal(second.body.cached, true) // DB 바인딩 캐시 사용
  restore()
})

test('(21) 개설 과목이 없으면 공개 저장이 막히고 해결 문구를 돌려준다', async () => {
  const noCourseForm = driveForm()
  noCourseForm.fields = noCourseForm.fields.map((f) => (f.id === 'course' ? { ...f, options: [] } : f))
  const db = makeDb({ forms: [noCourseForm], offerings: 0 })
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })

  const res = await request(app)
    .put('/admin/forms/10')
    .set('Cookie', staffCookie('manager'))
    .send({ published: true, fields: noCourseForm.fields, settings: noCourseForm.settings })

  assert.equal(res.status, 422)
  assert.ok(res.body.issues.some((i) => i.code === 'course_options_missing' || i.code === 'offerings_empty'))
  restore()
})

test('(22) 공개 폼 응답에는 폴더 ID·연결 ID·공유 설정이 들어 있지 않다', async () => {
  const db = makeDb({ forms: [legacyForm()] })
  const app = createApp({ db: { query: db.query } })
  const res = await request(app).get('/forms/legacy-exhibition')
  assert.equal(res.status, 200)
  const body = JSON.stringify(res.body)
  assert.equal(body.includes('ROOT'), false)
  assert.equal(res.body.form.settings.drive_folder_id, undefined)
  assert.equal(res.body.form.settings.drive_connection_id, undefined)
  assert.equal(res.body.form.settings.drive_enabled, true) // 아이콘 표시용 플래그는 유지
})

test('(23) 테스트 업로드는 _DAH_INTEGRATION_TEST 폴더에만 파일을 만든다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/admin/drive/test-upload')
    .set('Cookie', staffCookie('manager'))
    .send({ connection_id: 1 })

  assert.equal(res.status, 201)
  assert.equal(res.body.folder_name, '_DAH_INTEGRATION_TEST')
  const folder = drive.nodes.get(res.body.folder_id)
  assert.equal(folder.name, '_DAH_INTEGRATION_TEST')
  assert.equal(folder.parents[0], 'ROOT')
  restore()
})

test('(24) 과목을 지정하지 않은 준비는 과목 위 단계까지만 만든다', async () => {
  const db = makeDb()
  const drive = fakeDrive()
  const restore = useDrive(drive)
  const app = createApp({ db: { query: db.query } })
  const res = await request(app)
    .post('/admin/drive/prepare')
    .set('Cookie', staffCookie('manager'))
    .send({ form_id: 10, field_id: 'origin' })

  assert.equal(res.status, 201)
  assert.deepEqual(res.body.segments, ['2026-2', '전공 프로젝트 전시회'])
  assert.deepEqual(res.body.planned_segments, ['2026-2', '전공 프로젝트 전시회', '(과목명)', '원본'])
  // 과목 폴더는 만들지 않는다 — 제출 시점에 선택한 과목으로 생긴다
  assert.equal([...drive.nodes.values()].some((n) => n.name === '(과목명)'), false)
  restore()
})

test('(25) 이름이 같은 폴더가 이미 두 개면 가장 먼저 만들어진 폴더를 쓴다', async () => {
  const drive = fakeDrive()
  // 과거에 중복 생성된 상태를 재현한다
  await drive.files.create({ requestBody: { name: '2026-2', mimeType: 'application/vnd.google-apps.folder', parents: ['ROOT'] } })
  await drive.files.create({ requestBody: { name: '2026-2', mimeType: 'application/vnd.google-apps.folder', parents: ['ROOT'] } })
  const result = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['2026-2'] })
  assert.equal(result.folderId, 'id-1')
  assert.equal(result.duplicates.length, 1)
  assert.deepEqual(result.duplicates[0].ids, ['id-1', 'id-2'])
})
