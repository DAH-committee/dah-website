// test/teamsAccess.test.mjs — 작업공간 권한(팀, 한림대 계정, 링크)과 삭제 권한 단위 테스트. DB는 mock 주입.
// 실행: server/ 안에서 `node --test test/teamsAccess.test.mjs`
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setDb } from '../src/db.js'
import { GENERAL, canDeleteFile, levelFor } from '../src/lib/wsAccess.js'

// team_members: { email, team_id, role }, ws_shares: { ws_id, email, role }, ws_recent: { ws_id, email }
function install({ members = [], shares = [], recent = [] } = {}) {
  setDb({
    async query(text, params) {
      if (/FROM team_members WHERE lower\(email\) = ANY/.test(text)) {
        return { rows: members.filter((m) => params[0].includes(m.email)).map(({ team_id, role }) => ({ team_id, role })) }
      }
      if (/FROM ws_shares WHERE ws_id/.test(text)) {
        return { rows: shares.filter((s) => s.ws_id === params[0] && params[1].includes(s.email)).map(({ role }) => ({ role })) }
      }
      if (/FROM ws_recent WHERE ws_id/.test(text)) {
        return { rows: recent.filter((r) => r.ws_id === params[0] && params[1].includes(r.email)).map(() => ({ '?column?': 1 })) }
      }
      return { rows: [] }
    },
  })
}
const reqOf = (email, { staff = null, key = null } = {}) => ({
  user: staff ? { id: 1, email, name: '스태프', role: staff } : null,
  publicUser: staff ? null : email ? { id: 9, email, name: 'x' } : null,
  query: key ? { k: key } : {},
  get: () => undefined,
  cookies: {},
})
const file = (over = {}) => ({
  id: 1, kind: 'doc', owner_email: 'owner@gmail.com', general_access: 'restricted', general_role: 'viewer',
  share_token: 'tok', owner_only: false, deleted_at: null, team_id: null, gated: false, created_by: 'o', ...over,
})

test('일반 액세스 목록에 committee가 없다', () => {
  assert.deepEqual(GENERAL, ['restricted', 'team', 'major', 'public'])
})

test('팀 액세스: 팀원만 general_role을 받는다', async () => {
  install({ members: [{ email: 'm@gmail.com', team_id: 7, role: 'member' }] })
  const f = file({ team_id: 7, general_access: 'team', general_role: 'editor' })
  assert.equal(await levelFor(reqOf('m@gmail.com'), {}, f), 'editor')
  assert.equal(await levelFor(reqOf('x@gmail.com'), {}, f), null)
  assert.equal(await levelFor(reqOf('owner@gmail.com'), {}, f), 'editor')
})

test('팀 파일이라도 제한됨이면 팀원은 열 수 없다', async () => {
  install({ members: [{ email: 'm@gmail.com', team_id: 7, role: 'owner' }] })
  assert.equal(await levelFor(reqOf('m@gmail.com'), {}, file({ team_id: 7 })), null)
})

test('사이트 오너 스태프도 남의 제한됨 파일은 열 수 없다', async () => {
  install()
  assert.equal(await levelFor(reqOf('site@gmail.com', { staff: 'owner' }), {}, file()), null)
})

test('예전 committee 값은 제한됨처럼 다룬다', async () => {
  install()
  assert.equal(await levelFor(reqOf('site@gmail.com', { staff: 'manager' }), {}, file({ general_access: 'committee' })), null)
})

test('한림대 계정 액세스', async () => {
  install()
  const f = file({ general_access: 'major' })
  assert.equal(await levelFor(reqOf('s@hallym.ac.kr'), {}, f), 'viewer')
  assert.equal(await levelFor(reqOf('s@glab.hallym.ac.kr'), {}, f), 'viewer')
  assert.equal(await levelFor(reqOf('s@gmail.com'), {}, f), null)
})

test('링크 공개: 키가 맞거나 이미 링크로 연 로그인 사용자', async () => {
  install({ recent: [{ ws_id: 1, email: 'seen@gmail.com' }] })
  const f = file({ general_access: 'public' })
  assert.equal(await levelFor(reqOf(null, { key: 'tok' }), {}, f), 'viewer')
  assert.equal(await levelFor(reqOf(null, { key: 'bad' }), {}, f), null)
  assert.equal(await levelFor(reqOf('seen@gmail.com'), {}, f), 'viewer')
  assert.equal(await levelFor(reqOf('new@gmail.com'), {}, f), null)
})

test('이메일 공유와 나만 보기, 휴지통', async () => {
  install({ shares: [{ ws_id: 1, email: 's@gmail.com', role: 'editor' }] })
  assert.equal(await levelFor(reqOf('s@gmail.com'), {}, file()), 'editor')
  assert.equal(await levelFor(reqOf('s@gmail.com'), {}, file({ owner_only: true })), null)
  assert.equal(await levelFor(reqOf('owner@gmail.com'), {}, file({ owner_only: true })), 'editor')
  assert.equal(await levelFor(reqOf('owner@gmail.com'), {}, file({ deleted_at: new Date() })), null)
})

test('삭제: 소유자와 팀 오너만', () => {
  const idn = (emails, teams = []) => ({ emails, staff: null, teams: new Map(teams) })
  const f = file({ team_id: 7 })
  assert.equal(canDeleteFile(idn(['owner@gmail.com']), null, f), true)
  assert.equal(canDeleteFile(idn(['t@gmail.com'], [[7, 'owner']]), null, f), true)
  assert.equal(canDeleteFile(idn(['m@gmail.com'], [[7, 'member']]), null, f), false)
  assert.equal(canDeleteFile(idn(['t@gmail.com'], [[7, 'owner']]), null, file({ team_id: 7, owner_only: true })), false)
  assert.equal(canDeleteFile({ emails: ['site@gmail.com'], staff: { name: 'x' }, teams: new Map() }, { role: 'owner' }, file()), false)
})
