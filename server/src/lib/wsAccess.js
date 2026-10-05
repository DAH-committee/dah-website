// 문서·시트 접근 권한 (구글 독스 공유 방식).
//
// 신원 세 가지를 함께 본다.
//   - 스태프: 이메일·비밀번호 또는 구글로 로그인한 운영위원회·교수진 사이트 계정(dah_access 쿠키, manager 이상)
//   - 위원회 구성원: 사이트 계정은 없지만 관리자가 DAH Docs·Sheet·Form 구성원으로 등록한 구글 이메일(ws_members)
//   - 게스트: 구글로 로그인한 일반 계정(dah_pub_access 쿠키)
// 스태프와 위원회 구성원을 합쳐 "운영위원회 및 교수진"(committee)이라 부른다.
//
// 한 파일에서 사람이 얻는 권한은 아래 중 가장 높은 것이다. (viewer < editor)
//   0. 나만 보기(owner_only) 파일: 만든 사람만 editor, 그 밖에는 아무도 열 수 없다(사이트 관리자 포함)
//   1. 사이트 admin·owner 계정과 파일 소유자: editor
//   2. 파일에 이메일로 추가된 사람(ws_shares): 지정한 권한
//   3. 일반 액세스
//        restricted  제한됨: 위 1·2에 해당하는 사람만
//        committee   운영위원회 및 교수진: committee 전원에게 general_role
//        major       디지털인문예술전공: committee + 한림대 구글 계정(@hallym.ac.kr, 하위 도메인 포함)으로 로그인한 사람에게 general_role
//        public      전체 공개: committee 전원 + 링크(share_token)를 가진 모든 사람에게 general_role
import crypto from 'node:crypto'
import { query } from '../db.js'
import { hasRole } from '../middleware/auth.js'
import { optionalPublicAuth } from '../middleware/publicAuth.js'

export const RANK = { viewer: 1, editor: 2 }
export const GENERAL = ['restricted', 'committee', 'major', 'public']
export const HALLYM_RE = /@(?:[a-z0-9-]+\.)*hallym\.ac\.kr$/
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
  const list = [...emails]
  const member = list.length
    ? (await query('SELECT id, email, name FROM ws_members WHERE lower(email) = ANY($1::text[]) LIMIT 1', [list])).rows[0] || null
    : null
  req._wsIdentity = {
    staff,
    member,
    committee: Boolean(staff || member),
    hallym: list.some((e) => HALLYM_RE.test(e)),
    guest: req.publicUser || null,
    emails: list,
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
    'SELECT id, kind, title, created_by, owner_email, general_access, general_role, share_token, gated, form_id, last_edit, hidden, owner_only, deleted_at FROM ws_files WHERE id = $1',
    [wsId]
  )
  return rows[0] || null
}

/** 요청자가 이 파일에서 갖는 권한: 'editor' | 'viewer' | null */
export async function levelFor(req, res, file) {
  if (!file) return null
  const id = await identityOf(req, res)
  let level = null
  if (file.deleted_at) return null // 휴지통에 있는 파일은 복원하기 전까지 아무도 열 수 없다
  if (file.owner_only) return file.owner_email && id.emails.includes(lower(file.owner_email)) ? 'editor' : null
  if (id.isSite) return 'editor'
  // 소유자: 이메일이 같거나, 예전 파일은 만든 사람 이름이 같을 때
  if (file.owner_email && id.emails.includes(lower(file.owner_email))) return 'editor'
  if (!file.owner_email && id.staff && file.created_by && id.staff.name === file.created_by) return 'editor'
  if (id.emails.length) {
    const { rows } = await query('SELECT role FROM ws_shares WHERE ws_id = $1 AND lower(email) = ANY($2::text[])', [file.id, id.emails])
    for (const r of rows) level = best(level, r.role)
  }
  const role = ROLES.includes(file.general_role) ? file.general_role : 'viewer'
  if (file.general_access === 'committee' && id.committee) level = best(level, role)
  if (file.general_access === 'major' && (id.committee || id.hallym)) level = best(level, role)
  if (file.general_access === 'public') {
    if (id.committee) level = best(level, role)
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

/** 운영위원회 및 교수진(스태프 또는 등록된 위원회 구성원)만 통과. 삭제·비공개 전환에 쓴다 */
export function committeeOnly(req, res, next) {
  identityOf(req, res)
    .then((id) => {
      if (!id.committee) return res.status(id.emails.length ? 403 : 401).json({ error: 'committee only', hint: '운영위원회 및 교수진만 할 수 있습니다.' })
      next()
    })
    .catch(next)
}

/**
 * 폼(custom_forms)마다 공유 설정 행(ws_files kind=form)을 보장하고 돌려준다.
 * 예전 폼은 "운영위원회 및 교수진 / 편집자"로 시작한다(지금까지 스태프만 다루던 것과 같은 범위).
 */
export async function formFile(formId, init = null) {
  const id = parseInt(formId, 10)
  if (!Number.isInteger(id)) return null
  const found = await query(
    'SELECT id, kind, title, created_by, owner_email, general_access, general_role, share_token, gated, form_id, last_edit, hidden, owner_only, deleted_at FROM ws_files WHERE form_id = $1',
    [id]
  )
  if (found.rows[0]) return found.rows[0]
  const form = (await query('SELECT id, title_ko FROM custom_forms WHERE id = $1', [id])).rows[0]
  if (!form) return null
  const g = init || { general_access: 'committee', general_role: 'editor', owner_email: null, created_by: null }
  const { rows } = await query(
    `INSERT INTO ws_files (kind, title, form_id, general_access, general_role, owner_email, created_by, share_token)
     VALUES ('form', $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (form_id) WHERE form_id IS NOT NULL DO UPDATE SET title = EXCLUDED.title
     RETURNING id, kind, title, created_by, owner_email, general_access, general_role, share_token, gated, form_id, last_edit, hidden, owner_only, deleted_at`,
    [form.title_ko || '제목 없는 설문지', id, g.general_access, g.general_role, g.owner_email, g.created_by, newToken()]
  )
  return rows[0]
}

// ── 휴지통 ──────────────────────────────────────────────────
// 지운 파일은 deleted_at을 찍어 30일 보관한다(복원 가능). 30일이 지나면 영구 삭제한다.
// 폼은 사이트에 공개되어 있을 수 있어, 휴지통에 넣는 동안 응답 받기를 끄고 복원 때 원래 상태로 돌린다.
export const TRASH_DAYS = 30

/** 이 파일의 소유자인가 */
export function isOwnerOf(id, file) {
  if (file.owner_email && id.emails.includes(lower(file.owner_email))) return true
  return Boolean(!file.owner_email && id.staff && file.created_by && id.staff.name === file.created_by)
}

/** 지울 수 있는가: 소유자 본인, 또는 운영위원회 및 교수진. 나만 보기 파일은 소유자만, 인수인계 문서는 오너만 */
export function canDeleteFile(id, user, file) {
  if (file.gated && !hasRole(user, 'owner')) return false
  const mine = isOwnerOf(id, file)
  if (file.owner_only) return mine
  return mine || id.committee
}

/** 휴지통 목록에서 이 파일을 다룰 수 있는가(복원·영구 삭제): 지울 수 있는 사람 중 원래 목록에서 보이던 범위 */
export function canManageTrash(id, user, file, shared = false) {
  if (!canDeleteFile(id, user, file)) return false
  if (isOwnerOf(id, file) || shared) return true
  return ['committee', 'major', 'public'].includes(file.general_access) && id.committee
}

export function daysLeft(deletedAt) {
  const end = new Date(deletedAt).getTime() + TRASH_DAYS * 86400000
  return Math.max(0, Math.ceil((end - Date.now()) / 86400000))
}

export async function trashFile(file, byName) {
  let meta = null
  if (file.kind === 'form' && file.form_id) {
    const f = (await query('SELECT published FROM custom_forms WHERE id = $1', [file.form_id])).rows[0]
    meta = { published: Boolean(f?.published) }
    await query('UPDATE custom_forms SET published = false WHERE id = $1', [file.form_id])
  }
  await query('UPDATE ws_files SET deleted_at = now(), deleted_by = $2, trash_meta = $3::jsonb WHERE id = $1', [file.id, byName || null, meta ? JSON.stringify(meta) : null])
}

export async function restoreFile(file) {
  if (file.kind === 'form' && file.form_id) {
    const meta = (await query('SELECT trash_meta FROM ws_files WHERE id = $1', [file.id])).rows[0]?.trash_meta
    if (meta?.published) await query('UPDATE custom_forms SET published = true WHERE id = $1', [file.form_id])
  }
  await query('UPDATE ws_files SET deleted_at = NULL, deleted_by = NULL, trash_meta = NULL WHERE id = $1', [file.id])
}

/** 영구 삭제(되돌릴 수 없음) */
export async function purgeFile(file) {
  if (file.kind === 'doc') {
    await query('DELETE FROM handover_comments WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [file.id])
    await query('DELETE FROM handover_versions WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [file.id])
    await query('DELETE FROM handover_docs WHERE ws_id = $1', [file.id])
  }
  if (file.kind === 'sheet') await query('DELETE FROM admin_sheet_state WHERE key = $1', [`ws-sheet-${file.id}`])
  if (file.kind === 'form' && file.form_id) await query('DELETE FROM custom_forms WHERE id = $1', [file.form_id])
  await query('DELETE FROM ws_shares WHERE ws_id = $1', [file.id])
  await query('DELETE FROM ws_files WHERE id = $1', [file.id])
}

let lastPurge = 0
/** 30일이 지난 휴지통 파일을 영구 삭제한다. 서버가 잠들어도 되도록 목록을 읽을 때 10분에 한 번 돌린다 */
export async function purgeExpired(force = false) {
  if (!force && Date.now() - lastPurge < 10 * 60 * 1000) return 0
  lastPurge = Date.now()
  const { rows } = await query("SELECT id, kind, form_id FROM ws_files WHERE deleted_at IS NOT NULL AND deleted_at < now() - ($1 || ' days')::interval", [String(TRASH_DAYS)])
  for (const r of rows) await purgeFile(r)
  return rows.length
}
