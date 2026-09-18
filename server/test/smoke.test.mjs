// test/smoke.test.mjs — supertest 스모크 (12_BACKEND 완료 조건. DB는 mock 주입)
// 실행: server/ 안에서 `npm test` (node --test)
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { createApp } from '../src/app.js'

// SQL 텍스트 패턴 라우팅 방식의 mock db
function mockDb(handler) {
  return { query: async (text, params) => handler(text, params) ?? { rows: [] } }
}

function accessCookie(user) {
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role, type: 'access' },
    'test-secret',
    { expiresIn: '15m' }
  )
  return `dah_access=${token}`
}

test('(0) DATABASE_URL 없이 기동: /health 200, 그 외 명확한 env 에러', async () => {
  const app = createApp({ db: null }) // 주입 해제 = env 미설정 상태
  const health = await request(app).get('/health')
  assert.equal(health.status, 200)
  assert.equal(health.body.status, 'ok')

  const blocked = await request(app).get('/content/notice')
  assert.equal(blocked.status, 503)
  assert.equal(blocked.body.error, 'DATABASE_URL not configured')
  assert.ok(blocked.body.hint)
})

test('(a) 비로그인 POST /admin/content/notice → 401', async () => {
  const app = createApp({ db: mockDb(() => ({ rows: [] })) })
  const res = await request(app).post('/admin/content/notice').send({ title_ko: '테스트 공지' })
  assert.equal(res.status, 401)
})

test('(a-보강) 이스터에그 공개 현황은 개인정보 없이 인원만 제공한다', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('COUNT(*)::int AS total FROM hyunho_easter_egg_discoveries')) {
        return { rows: [{ total: 2 }] }
      }
      return { rows: [] }
    }),
  })

  const res = await request(app).get('/easter-eggs/hyunho/status')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { total: 2, limit: 3, remaining: 1, nextPosition: 3 })
  assert.equal('name' in res.body, false)
  assert.equal('phone' in res.body, false)
})

test('(a-보강) 이스터에그 개인정보 목록과 초기화는 주현호 owner만 가능하다', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('FROM hyunho_easter_egg_discoveries') && text.includes('ORDER BY created_at ASC')) {
        return { rows: [{ id: 1, name: '참여자', student_no: '20221234', phone: '010-1234-5678', created_at: '2026-09-18T00:00:00.000Z' }] }
      }
      if (text.startsWith('DELETE FROM hyunho_easter_egg_discoveries')) return { rows: [], rowCount: 1 }
      return { rows: [] }
    }),
  })

  const otherOwner = [accessCookie({ id: 1, email: 'owner@test.dev', name: '다른 관리자', role: 'owner' })]
  const denied = await request(app).get('/admin/easter-eggs/hyunho').set('Cookie', otherOwner)
  assert.equal(denied.status, 403)

  const hyunho = [accessCookie({ id: 2, email: 'hyunho@test.dev', name: '주현호', role: 'owner' })]
  const list = await request(app).get('/admin/easter-eggs/hyunho').set('Cookie', hyunho)
  assert.equal(list.status, 200)
  assert.equal(list.body.items[0].student_no, '20221234')

  const reset = await request(app).delete('/admin/easter-eggs/hyunho/discoveries').set('Cookie', hyunho)
  assert.equal(reset.status, 200)
  assert.equal(reset.body.deleted, 1)
})

test('(b) manager 토큰으로 교수진 작성 → 201', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.startsWith('INSERT INTO professors')) return { rows: [{ id: 1, name_ko: '테스트 교수' }] }
      return { rows: [] }
    }),
  })
  const res = await request(app)
    .post('/admin/content/professors')
    .set('Cookie', [accessCookie({ id: 2, email: 'manager@test.dev', name: 'M', role: 'manager' })])
    .send({ name_ko: '테스트 교수' })
  assert.equal(res.status, 201)
  assert.equal(res.body.item.name_ko, '테스트 교수')
})

test('(b-보강) manager 토큰으로 notice 작성 → 201 (권한 매트릭스 상행 확인)', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.startsWith('INSERT INTO posts')) {
        return { rows: [{ id: 10, type: 'notice', title_ko: '테스트 공지' }] }
      }
      return { rows: [] }
    }),
  })
  const res = await request(app)
    .post('/admin/content/notice')
    .set('Cookie', [accessCookie({ id: 2, email: 'manager@test.dev', name: 'M', role: 'manager' })])
    .send({ title_ko: '테스트 공지' })
  assert.equal(res.status, 201)
  assert.equal(res.body.item.id, 10)
})

test('(c) 접수 기간 밖 POST /submit/exhibition → 403 (서버 기간 검증)', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('FROM exhibition_settings')) {
        return {
          rows: [
            {
              id: 1,
              submit_open: '2020-01-01T00:00:00+09:00',
              submit_close: '2020-01-02T23:59:59+09:00',
              edit_close: '2020-01-03T23:59:59+09:00',
              header_visible: true,
              button_mode: 'header',
            },
          ],
        }
      }
      return { rows: [] }
    }),
  })
  const res = await request(app)
    .post('/submit/exhibition')
    .send({ entry_type: 'solo', email: 'student@test.dev', password: 'pw123456', fields: { name: '홍길동' } })
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'submission period closed')
})

test('(d) /auth/login 성공 → 쿠키 2개 세트 + /auth/me 200', async () => {
  const hash = await bcrypt.hash('secret123', 4)
  const userRow = { id: 1, email: 'owner@test.dev', name: 'Owner', role: 'owner', password_hash: hash, must_set_pw: false }
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('FROM users WHERE email')) return { rows: [userRow] }
      if (text.includes('FROM users WHERE id')) {
        return { rows: [{ id: 1, email: 'owner@test.dev', name: 'Owner', role: 'owner', must_set_pw: false }] }
      }
      return { rows: [] }
    }),
  })

  const login = await request(app).post('/auth/login').send({ email: 'owner@test.dev', password: 'secret123' })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.role, 'owner')

  const cookies = login.headers['set-cookie']
  assert.ok(cookies.some((c) => c.startsWith('dah_access=') && c.includes('HttpOnly')))
  assert.ok(cookies.some((c) => c.startsWith('dah_refresh=') && c.includes('HttpOnly')))

  const me = await request(app).get('/auth/me').set('Cookie', cookies.map((c) => c.split(';')[0]))
  assert.equal(me.status, 200)
  assert.equal(me.body.user.email, 'owner@test.dev')
})

test('(e) must_set_pw 계정 최초 로그인 → 그 자리에서 비번 등록 + 즉시 로그인 (병합 플로우)', async () => {
  const userRow = { id: 3, email: 'newowner@test.dev', name: 'New Owner', role: 'owner', password_hash: null, must_set_pw: true }
  let updateCall = null
  const app = createApp({
    db: mockDb((text, params) => {
      if (text.includes('FROM users WHERE email')) return { rows: [userRow] }
      if (text.startsWith('UPDATE users SET password_hash')) {
        updateCall = params
        return { rows: [{ id: 3, email: 'newowner@test.dev', name: 'New Owner', role: 'owner' }] }
      }
      return { rows: [] }
    }),
  })

  const login = await request(app)
    .post('/auth/login')
    .send({ email: 'newowner@test.dev', password: 'whateverPw1' })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.email, 'newowner@test.dev')

  // 입력한 비밀번호가 그대로(별도 검증 없이) bcrypt 해시되어 저장 요청됐는지 확인
  assert.ok(updateCall)
  const storedHash = updateCall[0]
  assert.ok(await bcrypt.compare('whateverPw1', storedHash))

  const cookies = login.headers['set-cookie']
  assert.ok(cookies.some((c) => c.startsWith('dah_access=') && c.includes('HttpOnly')))
  assert.ok(cookies.some((c) => c.startsWith('dah_refresh=') && c.includes('HttpOnly')))
})

test('(e-보강) 공개 Google 로그인은 DB에 없는 이메일을 새 public_users로 등록하지 않고 거부한다', async () => {
  const originalFetch = globalThis.fetch
  const originalClientId = process.env.GOOGLE_CLIENT_ID
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET
  const originalRedirectUri = process.env.GOOGLE_REDIRECT_URI
  const clientId = 'google-client-id'
  process.env.GOOGLE_CLIENT_ID = clientId
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret'
  process.env.GOOGLE_REDIRECT_URI = 'https://api.example.test/auth/google/callback'

  const claims = {
    sub: 'unregistered-google-sub',
    email: 'not-registered@example.com',
    email_verified: true,
    aud: clientId,
    iss: 'https://accounts.google.com',
    name: '미등록 사용자',
  }
  const idToken = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id_token: idToken }) })

  const calls = []
  const app = createApp({
    db: mockDb((text, params) => {
      calls.push({ text, params })
      if (text.includes('FROM public_users')) return { rows: [] }
      return { rows: [] }
    }),
  })
  const state = jwt.sign({ nonce: 'test-nonce', next: '/' }, 'test-secret', { expiresIn: '10m' })

  try {
    const response = await request(app).get(`/auth/google/callback?code=test-code&state=${state}`)
    assert.equal(response.status, 403)
    assert.equal(response.body.error, 'email is not registered')
    assert.ok(calls.some((call) => call.text.includes('FROM public_users')))
    assert.equal(calls.some((call) => call.text.includes('INSERT INTO public_users')), false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID
    else process.env.GOOGLE_CLIENT_ID = originalClientId
    if (originalClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET
    else process.env.GOOGLE_CLIENT_SECRET = originalClientSecret
    if (originalRedirectUri === undefined) delete process.env.GOOGLE_REDIRECT_URI
    else process.env.GOOGLE_REDIRECT_URI = originalRedirectUri
  }
})

test('(추가) 공개 GET /content/notice — KPC식 페이지네이션 형태 {items,total,page,pageSize}', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('COUNT(*)')) return { rows: [{ total: 1 }] }
      if (text.includes('FROM posts')) {
        return { rows: [{ id: 1, type: 'notice', title_ko: '공지', published: true }] }
      }
      return { rows: [] }
    }),
  })
  const res = await request(app).get('/content/notice?page=1')
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['items', 'page', 'pageSize', 'total'])
  assert.equal(res.body.total, 1)
})

test('(추가) 허용 목록 외 :type 차단 → 404', async () => {
  const app = createApp({ db: mockDb(() => ({ rows: [] })) })
  const res = await request(app).get('/content/users')
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'unknown content type')
})

// manager 이상은 전시회·행사·사이트 설정을 모두 관리한다.
const MANAGER = { id: 9, email: 'm@x.com', name: '매니저', role: 'manager' }

test('(f-보강) manager·admin 사용자 목록에는 owner 계정이 노출되지 않고 owner만 전체를 본다', async () => {
  const members = [
    { id: 1, email: 'owner@x.com', name: '오너', role: 'owner' },
    { id: 2, email: 'admin@x.com', name: '어드민', role: 'admin' },
    { id: 3, email: 'manager@x.com', name: '매니저', role: 'manager' },
  ]
  const app = createApp({
    db: mockDb((text) => {
      if (text.startsWith('SELECT id, email, name, role, must_set_pw, created_at FROM users')) {
        return { rows: text.includes("WHERE role <> 'owner'") ? members.slice(1) : members }
      }
      return { rows: [] }
    }),
  })

  const managerList = await request(app).get('/admin/users').set('Cookie', accessCookie(MANAGER))
  assert.equal(managerList.status, 200)
  assert.deepEqual(managerList.body.items.map((item) => item.role), ['admin', 'manager'])
  assert.equal(managerList.body.total, 2)

  const adminList = await request(app)
    .get('/admin/users')
    .set('Cookie', accessCookie({ id: 2, email: 'admin@x.com', name: '어드민', role: 'admin' }))
  assert.equal(adminList.status, 200)
  assert.deepEqual(adminList.body.items.map((item) => item.role), ['admin', 'manager'])

  const ownerList = await request(app)
    .get('/admin/users')
    .set('Cookie', accessCookie({ id: 1, email: 'owner@x.com', name: '오너', role: 'owner' }))
  assert.equal(ownerList.status, 200)
  assert.deepEqual(ownerList.body.items.map((item) => item.role), ['owner', 'admin', 'manager'])
})

test('(f) manager로 GET /admin/exhibition/entries → 200', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('COUNT(*)')) return { rows: [{ total: 0 }] }
      return { rows: [] }
    }),
  })
  const res = await request(app).get('/admin/exhibition/entries').set('Cookie', accessCookie(MANAGER))
  assert.equal(res.status, 200)
})

test('(g) manager로 전시회 일정·회차 저장 → 200', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('INSERT INTO site_settings')) {
        return { rows: [{ key: 'exhibitionOrdinal', value: 18 }] }
      }
      if (text.includes('UPDATE exhibition_settings')) return { rows: [{ id: 1 }] }
      return { rows: [] }
    }),
  })
  const res = await request(app)
    .put('/admin/settings')
    .set('Cookie', accessCookie(MANAGER))
    .send({ settings: { exhibitionOrdinal: 18 }, exhibition: { header_visible: true } })
  assert.equal(res.status, 200)
})

test('(h) manager로 사이트 전역 설정(contentVisibility) 저장 → 200', async () => {
  const app = createApp({
    db: mockDb((text) => {
      if (text.includes('INSERT INTO site_settings')) {
        return { rows: [{ key: 'contentVisibility', value: { notice: false } }] }
      }
      return { rows: [] }
    }),
  })
  const res = await request(app)
    .put('/admin/settings')
    .set('Cookie', accessCookie(MANAGER))
    .send({ settings: { contentVisibility: { notice: false } } })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.settings.contentVisibility, { notice: false })
})

test('(i) manager는 manager만 등록·초기화하고 사용자 삭제는 할 수 없다', async () => {
  const manager = { id: 9, email: 'm@x.com', name: '매니저', role: 'manager' }
  const app = createApp({
    db: mockDb((text, params) => {
      if (text.startsWith('INSERT INTO users')) {
        return { rows: [{ id: 10, email: params[0], name: params[1], role: params[2], must_set_pw: true }] }
      }
      if (text.startsWith('SELECT id, email, name, role, must_set_pw, created_at FROM users WHERE id')) {
        return { rows: [{ id: 10, email: 'new@x.com', name: '새 매니저', role: 'manager', must_set_pw: false }] }
      }
      if (text.startsWith('UPDATE users SET')) {
        return { rows: [{ id: 10, email: 'new@x.com', name: '새 매니저', role: 'manager', must_set_pw: true }] }
      }
      return { rows: [] }
    }),
  })
  const createManager = await request(app)
    .post('/admin/users')
    .set('Cookie', accessCookie(manager))
    .send({ email: 'new@x.com', name: '새 매니저', role: 'manager' })
  assert.equal(createManager.status, 201)

  const createAdmin = await request(app)
    .post('/admin/users')
    .set('Cookie', accessCookie(manager))
    .send({ email: 'admin@x.com', name: '새 어드민', role: 'admin' })
  assert.equal(createAdmin.status, 403)

  const resetManager = await request(app)
    .put('/admin/users/10')
    .set('Cookie', accessCookie(manager))
    .send({ reset: true })
  assert.equal(resetManager.status, 200)

  const removeManager = await request(app)
    .delete('/admin/users/10')
    .set('Cookie', accessCookie(manager))
  assert.equal(removeManager.status, 403)
})
