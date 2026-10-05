// 문서·시트 접근 권한 (구글 독스 공유 방식).
//
// 신원 두 가지를 함께 본다.
//   - 스태프: 이메일·비밀번호 또는 구글로 로그인한 운영위원회·교수진 계정(dah_access 쿠키, manager 이상)
//   - 게스트: 구글로 로그인한 일반 계정(dah_pub_access 쿠키). 파일에 이메일로 추가된 사람
//
// 한 파일에서 사람이 얻는 권한은 아래 중 가장 높은 것이다. (viewer < editor)
//   1. 사이트 admin·owner 계정과 파일 소유자: editor
//   2. 파일에 이메일로 추가된 사람(ws_shares): 지정한 권한
//   3. 일반 액세스
//        restricted  제한됨: 위 1·2에 해당하는 사람만
//        committee   운영위원회 및 교수진: 스태프(manager 이상) 전원에게 general_role
//        public      전체 공개: 스태프 전원 + 링크(share_token)를 가진 모든 사람에게 general_role
import crypto from 'node:crypto'
import { query } from '../db.js'
import { hasRole } from '../middleware/auth.js'
import { optionalPublicAuth } from '../middleware/publicAuth.js'

export const RANK = { viewer: 1, editor: 2 }
export const GENERAL = ['restricted', 'committee', 'public']
export const ROLES = ['viewer', 'editor']

export const newToken = () => crypto.randomBytes(18).toString('base64url')
const lower = (v) => String(v || '').trim().toLowerCase()
const best = (a, b) => ((RANK[a] || 0) >= (RANK[b] || 0) ? a : b)

/** 요청자의 신원(스태프 사용자, 게스트, 이메일 목록)을 한 번만 계산한다 */
export async function identityOf(req, res) {
  if (req._wsIdentity) return req._wsIdentity
  if (req.publicUser === undefined) await new Promise((done) => optionalPublicAuth(req, res, done))
  const staff = req.user && hasRole(req.user, 'manager') ? req.user : null
  const emails = new Set()
  if (req.user?.email) emails.add(lower(req.user.email))
  if (req.publicUser?.email) emails.add(lower(req.publicUser.email))
  req._wsIdentity = {
    staff,
    guest: req.publicUser || null,
    emails: [...emails],
    isSite: Boolean(req.user && hasRole(req.user, 'admin')),
  }
  return req._wsIdentity
}

/** 이름 표시용 (수정자·댓글 작성자) */
export function authorOf(req) {
  return req.user?.name || req.publicUser?.name || req.publicUser?.email || '게스트'
}

export async function fileRow(wsId) {
  if (wsId === null || wsId === undefined) return null
  const { rows } = await query(
    'SELECT id, kind, title, created_by, owner_email, general_access, general_role, share_token, gated FROM ws_files WHERE id = $1',
    [wsId]
  )
  return rows[0] || null
}

/** 요청자가 이 파일에서 갖는 권한: 'editor' | 'viewer' | null */
export async function levelFor(req, res, file) {
  if (!file) return null
  const id = await identityOf(req, res)
  let level = null
  if (id.isSite) return 'editor'
  // 소유자: 이메일이 같거나, 예전 파일은 만든 사람 이름이 같을 때
  if (file.owner_email && id.emails.includes(lower(file.owner_email))) return 'editor'
  if (!file.owner_email && id.staff && file.created_by && id.staff.name === file.created_by) return 'editor'
  if (id.emails.length) {
    const { rows } = await query('SELECT role FROM ws_shares WHERE ws_id = $1 AND lower(email) = ANY($2::text[])', [file.id, id.emails])
    for (const r of rows) level = best(level, r.role)
  }
  const role = ROLES.includes(file.general_role) ? file.general_role : 'viewer'
  if (file.general_access === 'committee' && id.staff) level = best(level, role)
  if (file.general_access === 'public') {
    if (id.staff) level = best(level, role)
    else {
      const key = req.get?.('x-share-key') || req.query?.k
      if (key && file.share_token && key === file.share_token) level = best(level, role)
    }
  }
  return level
}

/** 파일 id로 바로 권한을 구한다 (파일 없음 → null) */
export async function levelForId(req, res, wsId) {
  return levelFor(req, res, await fileRow(wsId))
}

/** 허브 목록용: 스태프가 볼 수 있는 파일인지 */
export function listVisibleSql() {
  return `(
    $1::boolean
    OR lower(f.owner_email) = ANY($2::text[])
    OR (f.owner_email IS NULL AND f.created_by = $3)
    OR EXISTS (SELECT 1 FROM ws_shares s WHERE s.ws_id = f.id AND lower(s.email) = ANY($2::text[]))
    OR f.general_access IN ('committee', 'public')
  )`
}
