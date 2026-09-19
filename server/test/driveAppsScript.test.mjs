// test/driveAppsScript.test.mjs — Apps Script 릴레이 모드 (53_DRIVE_STORAGE)
//
// GCP OAuth 클라이언트 없이 Drive에 저장하는 경로를 검증한다. Apps Script 웹앱은 fetch 주입으로
// 대신하고, 상위 로직(폴더 find-or-create·원본 무변환·재시도·비밀키 비노출)이 그대로 성립하는지 본다.
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
process.env.DRIVE_TOKEN_ENC_KEY = Buffer.alloc(32, 9).toString('base64')
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createAppsScriptDriveClient, isAppsScriptUrl } from '../src/lib/appsScriptDrive.js'
import { ensureFolderPath, probeFolder, uploadFile } from '../src/lib/googleDrive.js'

const URL_OK = 'https://script.google.com/macros/s/AKfycbxDAHtestdeployid123/exec'

/** Apps Script 웹앱 대역. drive-relay.gs의 응답 형태를 그대로 흉내낸다 */
function fakeRelay({ secret = 'shared-secret-1234567890', roots = ['ROOT'], fail = null } = {}) {
  let seq = 0
  const nodes = new Map()
  for (const id of roots) {
    nodes.set(id, { id, name: `root-${id}`, mimeType: 'application/vnd.google-apps.folder', parents: [], trashed: false, createdTime: '2020-01-01T00:00:00.000Z', bytes: null })
  }
  const calls = []
  const reply = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  })

  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url, action: body.action, secretSeen: body.secret })
    if (body.secret !== secret) return reply({ error: '비밀키가 일치하지 않습니다.', status: 401 })
    const forced = fail?.(body.action, calls)
    if (forced) return forced

    switch (body.action) {
      case 'about':
        return reply({ user: { emailAddress: 'smmilk2378@gmail.com', displayName: '주현호' }, storageQuota: { limit: '1000', usage: '1' } })
      case 'list': {
        const files = [...nodes.values()]
          .filter((n) => !n.trashed && n.parents.includes(body.parentId) && n.name === body.name && n.mimeType === 'application/vnd.google-apps.folder')
          .map(({ id, name, createdTime }) => ({ id, name, createdTime }))
        return reply({ files })
      }
      case 'createFolder': {
        seq += 1
        const id = `f-${seq}`
        nodes.set(id, { id, name: body.name, mimeType: 'application/vnd.google-apps.folder', parents: [body.parentId], trashed: false, createdTime: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), bytes: null })
        return reply({ id, name: body.name, createdTime: nodes.get(id).createdTime })
      }
      case 'upload': {
        seq += 1
        const id = `u-${seq}`
        const bytes = Buffer.from(body.dataBase64, 'base64')
        nodes.set(id, { id, name: body.name, mimeType: body.mimeType, parents: [body.parentId], trashed: false, createdTime: new Date().toISOString(), bytes, description: body.description })
        return reply({ id, name: body.name, mimeType: body.mimeType, size: String(bytes.length), webViewLink: `https://drive.google.com/file/d/${id}/view` })
      }
      case 'get': {
        const node = nodes.get(body.fileId)
        if (!node) return reply({ error: 'No item with the given ID could be found.', status: 404 })
        return reply({
          id: node.id,
          name: node.name,
          mimeType: node.mimeType,
          trashed: node.trashed,
          webViewLink: `https://drive.google.com/drive/folders/${node.id}`,
          capabilities: { canAddChildren: node.mimeType === 'application/vnd.google-apps.folder', canEdit: true },
        })
      }
      case 'share':
        return reply({ ok: true, id: body.fileId })
      case 'trash': {
        const node = nodes.get(body.fileId)
        if (node) node.trashed = true
        return reply({ ok: true, id: body.fileId })
      }
      default:
        return reply({ error: `알 수 없는 action입니다: ${body.action}`, status: 400 })
    }
  }

  return { fetchImpl, nodes, calls, secret }
}

test('(A1) 배포 주소 형식만 통과한다', () => {
  assert.equal(isAppsScriptUrl(URL_OK), true)
  assert.equal(isAppsScriptUrl('https://script.google.com/macros/s/abc/dev'), false)
  assert.equal(isAppsScriptUrl('https://evil.example.com/exec'), false)
  assert.equal(isAppsScriptUrl(''), false)
  assert.throws(() => createAppsScriptDriveClient({ url: 'https://evil.example.com/exec', secret: 'x'.repeat(20) }), /형식이 아닙니다/)
})

test('(A2) 폴더 경로를 만들고 두 번째 호출은 재사용한다', async () => {
  const relay = fakeRelay()
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: relay.secret, fetchImpl: relay.fetchImpl })

  const first = await ensureFolderPath(drive, {
    rootFolderId: 'ROOT',
    segments: ['2026-2', '전공 프로젝트 전시회', '디자인씽킹', '원본'],
  })
  assert.equal(first.steps.length, 4)
  assert.ok(first.steps.every((s) => s.id && s.created))

  const createdCount = relay.calls.filter((c) => c.action === 'createFolder').length
  const second = await ensureFolderPath(drive, {
    rootFolderId: 'ROOT',
    segments: ['2026-2', '전공 프로젝트 전시회', '디자인씽킹', '원본'],
  })
  assert.equal(second.folderId, first.folderId)
  assert.equal(relay.calls.filter((c) => c.action === 'createFolder').length, createdCount)
})

test('(A3) 원본 바이트·MIME·파일명이 변형 없이 전달된다', async () => {
  const relay = fakeRelay()
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: relay.secret, fetchImpl: relay.fetchImpl })
  const { folderId } = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['원본'] })
  const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250, 251, 252])

  const saved = await uploadFile(drive, {
    folderId,
    buffer: original,
    filename: '작품 원본_ab12cd34.png',
    mimeType: 'image/png',
    originalName: '작품 원본.png',
    shareMode: 'restricted',
    properties: { formSlug: 'exhibition-2026-2' },
  })

  assert.equal(saved.type, 'image/png')
  assert.equal(saved.bytes, original.length)
  assert.equal(saved.name, '작품 원본_ab12cd34.png')
  const stored = [...relay.nodes.values()].find((n) => n.id === saved.id)
  assert.equal(Buffer.compare(stored.bytes, original), 0) // 바이트 동일 = 변환 없음
  assert.match(stored.description, /원본 파일명: 작품 원본\.png/)
  // 제한 공유가 기본이므로 share 호출이 없어야 한다
  assert.equal(relay.calls.some((c) => c.action === 'share'), false)
})

test('(A4) 링크 공개를 고른 파일만 share를 호출한다', async () => {
  const relay = fakeRelay()
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: relay.secret, fetchImpl: relay.fetchImpl })
  const { folderId } = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['공개'] })
  await uploadFile(drive, { folderId, buffer: Buffer.from('x'), filename: 'a.txt', mimeType: 'text/plain', shareMode: 'link' })
  assert.equal(relay.calls.filter((c) => c.action === 'share').length, 1)
})

test('(A5) 루트 폴더가 없으면 404로 판정해 다른 폴더에 쓰지 않는다', async () => {
  const relay = fakeRelay({ roots: [] })
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: relay.secret, fetchImpl: relay.fetchImpl })
  const probe = await probeFolder(drive, 'ROOT')
  assert.equal(probe.ok, false)
  assert.equal(probe.reason, 'not_found')
})

test('(A6) 비밀키가 틀리면 401로 거부된다', async () => {
  const relay = fakeRelay()
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: 'wrong-secret-0000000000', fetchImpl: relay.fetchImpl })
  await assert.rejects(() => ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['x'] }), (err) => err.status === 401)
})

test('(A7) 로그인 HTML이 오면 배포 접근 권한 문제로 안내한다', async () => {
  const htmlFetch = async () => ({ ok: true, status: 200, text: async () => '<html>Sign in</html>' })
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: 'shared-secret-1234567890', fetchImpl: htmlFetch })
  await assert.rejects(
    () => probeFolder(drive, 'ROOT').then((p) => { if (!p.ok) throw Object.assign(new Error(p.message), { status: 502 }) }),
    /JSON|접근|모든 사용자/
  )
})

test('(A8) 일시적 5xx는 재시도 후 성공한다', async () => {
  let thrown = false
  const relay = fakeRelay({
    fail: (action) => {
      if (action === 'createFolder' && !thrown) {
        thrown = true
        return { ok: false, status: 503, text: async () => JSON.stringify({ error: '일시 오류', status: 503 }) }
      }
      return null
    },
  })
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: relay.secret, fetchImpl: relay.fetchImpl })
  const result = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['2026-2'] })
  assert.ok(result.folderId)
  assert.ok(thrown)
})

test('(A9) 상한을 넘는 파일은 Drive까지 가지 않고 413으로 막는다', async () => {
  const relay = fakeRelay()
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: relay.secret, fetchImpl: relay.fetchImpl })
  const { folderId } = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['원본'] })
  const uploadsBefore = relay.calls.filter((c) => c.action === 'upload').length
  const big = Buffer.alloc(31 * 1024 * 1024, 7) // 기본 상한 30MB 초과
  await assert.rejects(
    () => uploadFile(drive, { folderId, buffer: big, filename: 'big.zip', mimeType: 'application/zip' }),
    (err) => err.status === 413
  )
  assert.equal(relay.calls.filter((c) => c.action === 'upload').length, uploadsBefore)
})

test('(A10) 스트림으로 들어온 본문도 그대로 base64로 옮긴다', async () => {
  const relay = fakeRelay()
  const drive = createAppsScriptDriveClient({ url: URL_OK, secret: relay.secret, fetchImpl: relay.fetchImpl })
  const { folderId } = await ensureFolderPath(drive, { rootFolderId: 'ROOT', segments: ['원본'] })
  const payload = Buffer.from('한글 본문 테스트 0123', 'utf8')
  const res = await drive.files.create({
    requestBody: { name: 'stream.txt', parents: [folderId] },
    media: { mimeType: 'text/plain', body: Readable.from(payload) },
  })
  const stored = relay.nodes.get(res.data.id)
  assert.equal(Buffer.compare(stored.bytes, payload), 0)
})

test('(A11) 관리 API 응답에 Apps Script 비밀키가 들어가지 않는다', async () => {
  const request = (await import('supertest')).default
  const jwt = (await import('jsonwebtoken')).default
  const { createApp } = await import('../src/app.js')
  const { seal } = await import('../src/lib/secretBox.js')

  const SECRET = 'apps-script-secret-abcdefghijk'
  const row = {
    id: 7,
    label: '2026 전시회 Drive (Apps Script)',
    account_email: 'smmilk2378@gmail.com',
    auth_mode: 'apps-script',
    scope: 'apps-script-relay',
    root_folder_id: 'ROOT',
    root_folder_name: '26-2 전공 프로젝트 전시회',
    script_url: URL_OK,
    active: true,
    last_check_at: null,
    last_check_ok: true,
    last_error: '',
    created_at: null,
    updated_at: null,
    has_token: true,
    refresh_token_enc: seal(SECRET),
  }
  const db = {
    query: async (text) => {
      const q = String(text).replace(/\s+/g, ' ').trim()
      if (q.includes('FROM google_drive_connections ORDER BY')) {
        const { refresh_token_enc, ...rest } = row
        return { rows: [{ ...rest, has_token: Boolean(refresh_token_enc) }] }
      }
      if (q.includes("COUNT(*)::int AS n FROM form_file_uploads")) return { rows: [{ n: 0 }] }
      return { rows: [] }
    },
  }
  const app = createApp({ db })
  const cookie = `dah_access=${jwt.sign({ sub: 1, email: 'owner@dah.test', role: 'owner', type: 'access' }, 'test-secret', { expiresIn: '15m' })}`
  const res = await request(app).get('/admin/drive/status').set('Cookie', cookie)

  assert.equal(res.status, 200)
  const body = JSON.stringify(res.body)
  assert.equal(body.includes(SECRET), false)
  assert.equal(body.includes('refresh_token_enc'), false)
  assert.equal(res.body.connections[0].script_url, URL_OK) // 주소는 보여준다
  assert.equal(res.body.connections[0].mode_label, 'Apps Script 릴레이')
  assert.equal(res.body.config.apps_script_ready, true)
})
