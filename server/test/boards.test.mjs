// test/boards.test.mjs: DAH Board 내용 읽기·저장 API (DB는 mock 주입)
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { validateBoard, MAX_ITEMS, MAX_STROKE_COORDS, MAX_CANVASES, MAX_BYTES } from '../src/routes/boards.js'

// 권한 규칙(lib/wsAccess.js)이 바뀌어도 흔들리지 않게 "파일 소유자 = 편집자", "이메일 공유(viewer) = 보기"만 쓴다
const OWNER = { id: 1, email: 'o@example.com', name: '소유자', role: 'manager' }
const OTHER = { id: 9, email: 'v@example.com', name: '보기', role: 'manager' }
const OWNER_EMAIL = OWNER.email
const cookie = (u) => `dah_access=${jwt.sign({ sub: u.id, email: u.email, name: u.name, role: u.role, type: 'access' }, 'test-secret', { expiresIn: '15m' })}`
const fileOf = (over = {}) => ({ id: 5, kind: 'board', title: '보드', created_by: null, owner_email: OWNER_EMAIL, general_access: 'restricted', general_role: 'viewer', share_token: 't', gated: false, form_id: null, last_edit: null, hidden: false, owner_only: false, deleted_at: null, ...over })

function mockApp(file, onUpdate, shareRole = null) {
  return createApp({
    db: {
      query: async (text, params) => {
        if (text.startsWith('SELECT id, title, content, updated_at FROM ws_files')) return { rows: [{ id: 5, title: '보드', content: { version: 1, items: [], connections: [] }, updated_at: 'now' }] }
        if (text.startsWith('SELECT') && text.includes('FROM ws_files WHERE id = $1')) return { rows: file ? [file] : [] }
        if (text.startsWith('SELECT role FROM ws_shares')) return { rows: shareRole ? [{ role: shareRole }] : [] }
        if (text.startsWith('UPDATE ws_files SET content')) {
          onUpdate?.(JSON.parse(params[0]))
          return { rows: [{ id: 5, updated_at: 'now' }] }
        }
        return { rows: [] }
      },
    },
  })
}

const sample = () => ({
  version: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  items: [
    { id: 'a', type: 'memo', x: 0, y: 0, w: 200, h: 120, color: null, z: 1, data: { html: '<p>hi</p>' } },
    { id: 'b', type: 'keyword', x: 300, y: 0, w: 120, h: 40, color: 'purple', z: 2, data: { text: '키워드' } },
  ],
  connections: [{ id: 'c1', from: 'a', to: 'b', label: '', arrow: 'end', color: null }],
})

test('validateBoard: 올바른 모양은 통과, 틀린 모양은 거절', () => {
  assert.equal(validateBoard(sample()), null)
  assert.ok(validateBoard(null))
  assert.ok(validateBoard({ version: 3, items: [], connections: [] }))
  assert.ok(validateBoard({ version: 2, items: [], connections: [] }), 'version 2에는 canvases가 있어야 한다')
  assert.ok(validateBoard({ version: 1, items: {}, connections: [] }))
  const badType = sample()
  badType.items[0].type = 'script'
  assert.ok(validateBoard(badType))
  const dangling = sample()
  dangling.connections[0].to = 'zzz'
  assert.ok(validateBoard(dangling))
  const dup = sample()
  dup.items[1].id = 'a'
  assert.ok(validateBoard(dup))
  const nan = sample()
  nan.items[0].x = 'x'
  assert.ok(validateBoard(nan))
  const arrow = sample()
  arrow.connections[0].arrow = 'sideways'
  assert.ok(validateBoard(arrow))
})

test('로그인하지 않으면 제한된 보드를 열 수 없다', async () => {
  const res = await request(mockApp(fileOf())).get('/workspace/boards/5')
  assert.equal(res.status, 401)
})

test('보드가 아닌 파일이나 없는 파일은 404', async () => {
  const sheet = await request(mockApp(fileOf({ kind: 'sheet' }))).get('/workspace/boards/5').set('Cookie', cookie(OWNER))
  assert.equal(sheet.status, 404)
  const none = await request(mockApp(null)).get('/workspace/boards/5').set('Cookie', cookie(OWNER))
  assert.equal(none.status, 404)
})

test('편집자는 보드를 읽고 저장한다', async () => {
  let saved = null
  const app = mockApp(fileOf(), (c) => (saved = c))
  const get = await request(app).get('/workspace/boards/5').set('Cookie', cookie(OWNER))
  assert.equal(get.status, 200)
  assert.equal(get.body.canEdit, true)
  assert.equal(get.body.item.content.version, 1)
  const put = await request(app).put('/workspace/boards/5').set('Cookie', cookie(OWNER)).send({ content: sample() })
  assert.equal(put.status, 200)
  assert.equal(saved.items.length, 2)
})

test('모양이 틀리면 400, 항목이 너무 많으면 413', async () => {
  const app = mockApp(fileOf())
  const bad = await request(app).put('/workspace/boards/5').set('Cookie', cookie(OWNER)).send({ content: { version: 1, items: 'x', connections: [] } })
  assert.equal(bad.status, 400)
  const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ id: `i${i}`, type: 'keyword', x: 0, y: 0, w: 1, h: 1 }))
  const many = await request(app).put('/workspace/boards/5').set('Cookie', cookie(OWNER)).send({ content: { version: 1, items, connections: [] } })
  assert.equal(many.status, 413)
})

test('보기 권한만 있으면 저장할 수 없다', async () => {
  const app = mockApp(fileOf(), null, 'viewer')
  const get = await request(app).get('/workspace/boards/5').set('Cookie', cookie(OTHER))
  assert.equal(get.status, 200)
  assert.equal(get.body.canEdit, false)
  const put = await request(app).put('/workspace/boards/5').set('Cookie', cookie(OTHER)).send({ content: sample() })
  assert.equal(put.status, 403)
})

test('권한이 없는 로그인 사용자는 403', async () => {
  const res = await request(mockApp(fileOf())).get('/workspace/boards/5').set('Cookie', cookie(OTHER))
  assert.equal(res.status, 403)
})

// ── version 2: 캔버스 여러 개, 새 항목 종류, 펜 획, 댓글 ─────────────────────
const v2 = () => ({
  version: 2,
  active: 'cv1',
  canvases: [
    {
      id: 'cv1',
      name: '캔버스 1',
      viewport: { x: 0, y: 0, zoom: 1 },
      items: [
        { id: 'f', type: 'frame', x: 0, y: 0, w: 800, h: 600, color: null, z: 1, data: { name: '프레임 1', order: 1 } },
        { id: 's', type: 'sticky', x: 40, y: 40, w: 200, h: 200, color: 'yellow', z: 2, group: 'g1', data: { text: '아이디어' } },
        { id: 'h', type: 'shape', x: 300, y: 40, w: 200, h: 140, color: 'purple', z: 3, group: 'g1', locked: true, data: { shape: 'diamond', text: '결정' } },
        { id: 't', type: 'text', x: 40, y: 300, w: 260, h: 30, color: null, z: 4, data: { text: '제목', size: 20, bold: true } },
        { id: 'p', type: 'stroke', x: 0, y: 0, w: 50, h: 50, color: 'black', z: 5, data: { tool: 'pen', width: 3, points: [0, 0, 10, 10, 20, 5] } },
      ],
      connections: [{ id: 'c1', from: 's', to: 'h', label: '', arrow: 'end', color: null, style: 'elbow' }],
      comments: [{ id: 'm1', itemId: 's', author: '주현호', text: '좋아요', at: '2026-09-21T00:00:00.000Z', resolved: false }],
    },
    { id: 'cv2', name: '회고', items: [], connections: [], comments: [] },
  ],
})

test('validateBoard v2: 올바른 모양은 통과', () => {
  assert.equal(validateBoard(v2()), null)
})

test('validateBoard v1: 예전 모양도 그대로 받는다(새 항목 종류는 거절)', () => {
  assert.equal(validateBoard(sample()), null)
  const old = sample()
  old.items[0].type = 'sticky'
  assert.ok(validateBoard(old))
})

test('validateBoard v2: 틀린 모양은 거절', () => {
  const noCanvas = v2()
  noCanvas.canvases = []
  assert.ok(validateBoard(noCanvas))
  const dupCanvas = v2()
  dupCanvas.canvases[1].id = 'cv1'
  assert.ok(validateBoard(dupCanvas))
  const badActive = v2()
  badActive.active = 'zzz'
  assert.ok(validateBoard(badActive))
  const badName = v2()
  badName.canvases[0].name = 'x'.repeat(61)
  assert.ok(validateBoard(badName))
  const badStyle = v2()
  badStyle.canvases[0].connections[0].style = 'zigzag'
  assert.ok(validateBoard(badStyle))
  const badShape = v2()
  badShape.canvases[0].items[2].data.shape = 'star'
  assert.ok(validateBoard(badShape))
  const badLock = v2()
  badLock.canvases[0].items[2].locked = 'yes'
  assert.ok(validateBoard(badLock))
  const crossConn = v2()
  crossConn.canvases[1].connections.push({ id: 'cx', from: 's', to: 'h' })
  assert.ok(validateBoard(crossConn), '다른 캔버스의 항목을 잇는 연결은 거절')
})

test('validateBoard v2: 펜 획 점 수와 모양 검사', () => {
  const odd = v2()
  odd.canvases[0].items[4].data.points = [0, 0, 1]
  assert.ok(validateBoard(odd))
  const nan = v2()
  nan.canvases[0].items[4].data.points = [0, 0, 'x', 1]
  assert.ok(validateBoard(nan))
  const big = v2()
  big.canvases[0].items[4].data.points = Array.from({ length: MAX_STROKE_COORDS + 2 }, (_, i) => i)
  assert.match(validateBoard(big), /too many stroke points/)
  const ok = v2()
  ok.canvases[0].items[4].data.points = Array.from({ length: MAX_STROKE_COORDS }, (_, i) => i)
  assert.equal(validateBoard(ok), null)
})

test('validateBoard v2: 댓글 검사', () => {
  const orphan = v2()
  orphan.canvases[0].comments[0].itemId = 'nope'
  assert.ok(validateBoard(orphan))
  const empty = v2()
  empty.canvases[0].comments[0].text = '  '
  assert.ok(validateBoard(empty))
  const long = v2()
  long.canvases[0].comments[0].text = 'x'.repeat(2001)
  assert.ok(validateBoard(long))
  const badDate = v2()
  badDate.canvases[0].comments[0].at = 'yesterday'
  assert.ok(validateBoard(badDate))
})

test('validateBoard v2: 항목 수는 모든 캔버스 합계로 센다', () => {
  const half = Math.ceil((MAX_ITEMS + 1) / 2)
  const mk = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, type: 'sticky', x: 0, y: 0, w: 1, h: 1 }))
  const c = { version: 2, canvases: [{ id: 'a', name: 'a', items: mk('a', half), connections: [] }, { id: 'b', name: 'b', items: mk('b', half), connections: [] }] }
  assert.match(validateBoard(c), /too many items/)
  const many = { version: 2, canvases: Array.from({ length: MAX_CANVASES + 1 }, (_, i) => ({ id: `c${i}`, name: `${i}`, items: [], connections: [] })) }
  assert.match(validateBoard(many), /too many canvases/)
})

test('v2 저장: 편집자는 저장하고, 너무 크면 413', async () => {
  let saved = null
  const app = mockApp(fileOf(), (c) => (saved = c))
  const put = await request(app).put('/workspace/boards/5').set('Cookie', cookie(OWNER)).send({ content: v2() })
  assert.equal(put.status, 200)
  assert.equal(saved.version, 2)
  assert.equal(saved.canvases.length, 2)
  const bad = await request(app).put('/workspace/boards/5').set('Cookie', cookie(OWNER)).send({ content: { version: 2, canvases: 'x' } })
  assert.equal(bad.status, 400)
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, type: 'sticky', x: 0, y: 0, w: 1, h: 1 }))
  const tooMany = await request(app).put('/workspace/boards/5').set('Cookie', cookie(OWNER)).send({ content: { version: 2, canvases: [{ id: 'a', name: 'a', items: mk(MAX_ITEMS + 1), connections: [] }] } })
  assert.equal(tooMany.status, 413)
  assert.equal(MAX_BYTES, 4 * 1024 * 1024)
})
