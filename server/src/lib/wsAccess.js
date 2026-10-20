// 문서·시트·폼·보드·슬라이드 접근 권한 (구글 독스 공유 방식) + 팀.
//
// 작업공간에는 특별한 등급이 없다. 사이트 스태프 계정도 여기서는 일반 사용자와 같다.
// (사이트 오너 역할은 /admin/* 저장소 설정에만 쓴다.)
//
// 한 파일에서 사람이 얻는 권한은 아래 중 가장 높은 것이다. (viewer < editor)
//   0. 휴지통에 있는 파일: 아무도 열 수 없다(복원 전까지)
//   1. 나만 보기(owner_only) 파일: 만든 사람만 editor, 그 밖에는 아무도 열 수 없다
//   2. 파일 소유자: editor
//   3. 파일에 이메일로 추가된 사람(ws_shares): 지정한 권한
//   4. 일반 액세스
//        restricted  제한됨: 위 2·3에 해당하는 사람만
//        team        팀: 파일이 속한 팀(ws_files.team_id)의 팀원에게 general_role
//        major       한림대 계정: 한림대 구글 계정(@hallym.ac.kr, 하위 도메인 포함)으로 로그인한 사람에게 general_role
//        public      링크가 있는 모든 사용자: 링크 키(share_token)를 가진 사람, 또는 그 링크로 이미 열어 본 로그인 사용자에게 general_role
// 예전 값 'committee'는 더 이상 쓰지 않으며 제한됨과 같게 다룬다.
import crypto from 'node:crypto'
import { query } from '../db.js'
import { hasRole } from '../middleware/auth.js'
import { optionalPublicAuth } from '../middleware/publicAuth.js'

export const RANK = { viewer: 1, editor: 2 }
export const GENERAL = ['restricted', 'team', 'major', 'public']
export const HALLYM_RE = /@(?:[a-z0-9-]+\.)*hallym\.ac\.kr$/
export const ROLES = ['viewer', 'editor']
export const TEAM_ROLES = ['owner', 'member']

export const newToken = () => crypto.randomBytes(18).toString('base64url')
const lower = (v) => String(v || '').trim().toLowerCase()
const best = (a, b) => ((RANK[a] || 0) >= (RANK[b] || 0) ? a : b)

/** 요청자의 신원(이메일 목록, 한림대 계정 여부, 내 팀과 팀 역할)을 한 번만 계산한다 */
export async function identityOf(req, res) {
  if (req._wsIdentity) return req._wsIdentity
  if (req.publicUser === undefined) await new Promise((done) => optionalPublicAuth(req, res, done))
  const emails = new Set()
  if (req.user?.email) emails.add(lower(req.user.email))
  if (req.publicUser?.email) emails.add(lower(req.publicUser.email))
  const list = [...emails]
  const teams = new Map()
  if (list.length) {
    const { rows } = await query('SELECT team_id, role FROM team_members WHERE lower(email) = ANY($1::text[])', [list])
    for (const r of rows) if (teams.get(r.team_id) !== 'owner') teams.set(r.team_id, r.role)
  }
  req._wsIdentity = {
    // 사이트 스태프 계정(인수인계 비밀값 등 사이트 기능에서만 쓴다. 작업공간 권한에는 영향 없음)
    staff: req.user && hasRole(req.user, 'manager') ? req.user : null,
    hallym: list.some((e) => HALLYM_RE.test(e)),
    guest: req.publicUser || null,
    emails: list,
    teams,
  }
  return req._wsIdentity
}

/** 이름 표시용 (수정자·댓글 작성자) */
export function authorOf(req) {
  return req.user?.name || req.publicUser?.name || req.publicUser?.email || '게스트'
}

export const FILE_COLS = 'id, kind, title, created_by, owner_email, general_access, general_role, share_token, gated, form_id, last_edit, owner_only, deleted_at, team_id'

export async function fileRow(wsId) {
  if (wsId === null || wsId === undefined) return null
  const n = parseInt(wsId, 10)
  if (!Number.isInteger(n)) return null
  const { rows } = await query(`SELECT ${FILE_COLS} FROM ws_files WHERE id = $1`, [n])
  return rows[0] || null
}

/** 이 파일의 소유자인가 */
export function isOwnerOf(id, file) {
  if (file.owner_email && id.emails.includes(lower(file.owner_email))) return true
  return Boolean(!file.owner_email && id.staff && file.created_by && id.staff.name === file.created_by)
}

/** 팀 역할: 'owner' | 'member' | null */
export function teamRoleOf(id, teamId) {
  if (teamId === null || teamId === undefined) return null
  return id.teams.get(Number(teamId)) || null
}

/** 요청자가 이 파일에서 갖는 권한: 'editor' | 'viewer' | null */
export async function levelFor(req, res, file) {
  if (!file) return null
  const id = await identityOf(req, res)
  if (file.deleted_at) return null // 휴지통에 있는 파일은 복원하기 전까지 아무도 열 수 없다
  if (file.owner_only) return file.owner_email && id.emails.includes(lower(file.owner_email)) ? 'editor' : null
  if (isOwnerOf(id, file)) return 'editor'
  let level = null
  if (id.emails.length) {
    const { rows } = await query('SELECT role FROM ws_shares WHERE ws_id = $1 AND lower(email) = ANY($2::text[])', [file.id, id.emails])
    for (const r of rows) level = best(level, r.role)
  }
  const role = ROLES.includes(file.general_role) ? file.general_role : 'viewer'
  if (file.general_access === 'team' && teamRoleOf(id, file.team_id)) level = best(level, role)
  if (file.general_access === 'major' && id.hallym) level = best(level, role)
  if (file.general_access === 'public') {
    const key = req.get?.('x-share-key') || req.query?.k
    if (key && file.share_token && key === file.share_token) level = best(level, role)
    else if (id.emails.length && level !== 'editor') {
      // 링크로 한 번 연 로그인 사용자는 다음부터 목록에서 키 없이도 연다(링크를 새로 만들면 이 기록이 지워진다)
      const seen = await query('SELECT 1 FROM ws_recent WHERE ws_id = $1 AND email = ANY($2::text[]) LIMIT 1', [file.id, id.emails])
      if (seen.rows.length) level = best(level, role)
    }
  }
  return level
}

/** 파일 id로 바로 권한을 구한다 (파일 없음 → null) */
export async function levelForId(req, res, wsId) {
  return levelFor(req, res, await fileRow(wsId))
}

/**
 * 폼(custom_forms)마다 공유 설정 행(ws_files kind=form)을 보장하고 돌려준다.
 * 행이 없는 예전 폼은 "제한됨"으로 시작한다.
 */
export async function formFile(formId, init = null) {
  const id = parseInt(formId, 10)
  if (!Number.isInteger(id)) return null
  const found = await query(`SELECT ${FILE_COLS} FROM ws_files WHERE form_id = $1`, [id])
  if (found.rows[0]) return found.rows[0]
  const form = (await query('SELECT id, title_ko FROM custom_forms WHERE id = $1', [id])).rows[0]
  if (!form) return null
  const g = { general_access: 'restricted', general_role: 'viewer', owner_email: null, created_by: null, team_id: null, ...(init || {}) }
  const { rows } = await query(
    `INSERT INTO ws_files (kind, title, form_id, general_access, general_role, owner_email, created_by, share_token, team_id)
     VALUES ('form', $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (form_id) WHERE form_id IS NOT NULL DO UPDATE SET title = EXCLUDED.title
     RETURNING ${FILE_COLS}`,
    [form.title_ko || '제목 없는 설문지', id, g.general_access, g.general_role, g.owner_email, g.created_by, newToken(), g.team_id]
  )
  return rows[0]
}

// ── 휴지통 ──────────────────────────────────────────────────
// 지운 파일은 deleted_at을 찍어 30일 보관한다(복원 가능). 30일이 지나면 영구 삭제한다.
// 폼은 사이트에 공개되어 있을 수 있어, 휴지통에 넣는 동안 응답 받기를 끄고 복원 때 원래 상태로 돌린다.
export const TRASH_DAYS = 30

/** 지울 수 있는가(휴지통으로 옮기기·복원·영구 삭제): 파일 소유자, 또는 팀 파일이면 그 팀의 오너. 나만 보기 파일은 소유자만, 인수인계 문서는 사이트 오너만 */
export function canDeleteFile(id, user, file) {
  if (file.gated && !hasRole(user, 'owner')) return false
  const mine = isOwnerOf(id, file)
  if (file.owner_only) return mine
  return mine || teamRoleOf(id, file.team_id) === 'owner'
}

/** 휴지통에서 이 파일을 다룰 수 있는가(복원·영구 삭제). 지울 수 있는 사람과 같다 */
export function canManageTrash(id, user, file) {
  return canDeleteFile(id, user, file)
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
// 종류별 영구 삭제 보조 동작(예: 한글 파일의 버전·본문 정리). 해당 모듈이 불러올 때 등록한다.
const PURGE_HOOKS = new Map()
export function registerPurgeHook(kind, fn) {
  PURGE_HOOKS.set(kind, fn)
}

export async function purgeFile(file) {
  const hook = PURGE_HOOKS.get(file.kind)
  if (hook) await hook(file.id)
  if (file.kind === 'doc') {
    await query('DELETE FROM handover_comments WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [file.id])
    await query('DELETE FROM handover_versions WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [file.id])
    await query('DELETE FROM handover_docs WHERE ws_id = $1', [file.id])
  }
  if (file.kind === 'sheet') await query('DELETE FROM admin_sheet_state WHERE key = $1', [`ws-sheet-${file.id}`])
  if (file.kind === 'form' && file.form_id) await query('DELETE FROM custom_forms WHERE id = $1', [file.form_id])
  await query('DELETE FROM ws_shares WHERE ws_id = $1', [file.id])
  await query('DELETE FROM ws_recent WHERE ws_id = $1', [file.id])
  await query('DELETE FROM ws_files WHERE id = $1', [file.id])
}

/**
 * 링크로 연 파일을 내 "최근" 목록에 남긴다(소유자는 이미 목록에 있으니 제외, 나만 보기 파일은 남기지 않음).
 * 목록은 열 수 있는 권한으로 한 번 더 걸러지므로, 권한이 사라지면 목록에서도 사라진다.
 */
export async function touchRecent(req, res, file) {
  try {
    const id = await identityOf(req, res)
    if (!id.emails.length || file.owner_only || file.deleted_at) return
    if (isOwnerOf(id, file)) return
    await query(
      `INSERT INTO ws_recent (email, ws_id, opened_at) VALUES ($1, $2, now())
       ON CONFLICT (email, ws_id) DO UPDATE SET opened_at = now()`,
      [id.emails[0], file.id]
    )
  } catch {
    /* 기록 실패는 열기를 막지 않는다 */
  }
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
