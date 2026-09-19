// src/routes/adminExtra.js — 8절 계약 외 확장 (13_CMS_SPEC.md 6절 어드민 대시보드)
// 사용자 관리(manager+): 화면은 모두 열되 역할별 대상 범위는 다르다.
// manager·admin에게는 owner 계정의 존재 자체를 노출하지 않는다.
// manager: manager만 등록·초기화, 삭제 불가 / admin: manager·admin 등록·초기화·삭제 / owner: 전체.
// 접수 현황(admin+): GET /admin/exhibition/entries — exhibition_entries 목록 (pw_hash 제외).
import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { wrap } from './content.js'

const router = Router()

const ROLES = ['manager', 'admin', 'owner']
const USER_COLS = 'id, email, name, role, must_set_pw, created_at'

function manageableRoles(user) {
  if (user.role === 'owner') return ROLES
  if (user.role === 'admin') return ['manager', 'admin']
  return ['manager']
}

function canManageRole(user, role) {
  return manageableRoles(user).includes(role)
}

router.get(
  '/admin/users',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    // 교수님·운영 인력이 쓰는 admin/manager 계정에는 owner 계정의 이름·이메일·개수까지
    // 전달하지 않는다. 클라이언트 필터만으로는 API 응답에서 노출될 수 있으므로 DB에서 차단한다.
    const ownerOnly = req.user.role === 'owner'
    const { rows } = await query(
      `SELECT ${USER_COLS} FROM users${ownerOnly ? '' : " WHERE role <> 'owner'"} ORDER BY id ASC`,
      []
    )
    res.json({ items: rows, total: rows.length })
  })
)

router.post(
  '/admin/users',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const name = String(req.body?.name || '').trim()
    const role = req.body?.role
    if (!email || !name) return res.status(400).json({ error: 'email and name required' })
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid role', allowed: ROLES })
    if (!canManageRole(req.user, role)) {
      return res.status(403).json({ error: 'cannot create this role', allowed: manageableRoles(req.user) })
    }
    try {
      const { rows } = await query(
        `INSERT INTO users (email, name, role, must_set_pw) VALUES ($1, $2, $3, TRUE)
         RETURNING ${USER_COLS}`,
        [email, name, role]
      )
      res.status(201).json({ item: rows[0] })
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'email already registered' })
      throw err
    }
  })
)

// 이름·롤 변경 + 리셋 플래그(reset: true → must_set_pw=TRUE, password_hash=NULL)
router.put(
  '/admin/users/:id',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' })
    const { name, role, reset } = req.body || {}
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: 'invalid role', allowed: ROLES })
    }
    // 자기 계정 롤 강등·리셋 방지 — owner 부재 상태 차단
    if (id === req.user.id && (role !== undefined || reset)) {
      return res.status(400).json({ error: 'cannot change own role or reset own password' })
    }

    const targetRes = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id])
    const target = targetRes.rows[0]
    if (!target) return res.status(404).json({ error: 'not found' })
    if (!canManageRole(req.user, target.role)) {
      return res.status(403).json({ error: 'cannot manage this user' })
    }
    if (role !== undefined && !canManageRole(req.user, role)) {
      return res.status(403).json({ error: 'cannot assign this role', allowed: manageableRoles(req.user) })
    }

    const sets = []
    const params = []
    if (name !== undefined) {
      params.push(String(name).trim())
      sets.push(`name = $${params.length}`)
    }
    if (role !== undefined) {
      params.push(role)
      sets.push(`role = $${params.length}`)
    }
    if (reset) sets.push('must_set_pw = TRUE', 'password_hash = NULL')
    if (sets.length === 0) return res.status(400).json({ error: 'empty body' })

    params.push(id)
    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${USER_COLS}`,
      params
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.delete(
  '/admin/users/:id',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' })
    if (id === req.user.id) return res.status(400).json({ error: 'cannot delete own account' })
    if (req.user.role === 'manager') return res.status(403).json({ error: 'managers cannot delete users' })
    const targetRes = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id])
    const target = targetRes.rows[0]
    if (!target) return res.status(404).json({ error: 'not found' })
    if (!canManageRole(req.user, target.role)) {
      return res.status(403).json({ error: 'cannot delete this user' })
    }
    const { rows } = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true, id: rows[0].id })
  })
)

// 전시회 접수 현황 목록 — 어드민 대시보드·/admin/exhibition (pw_hash 제외)
// 12_BACKEND 2절이 manager를 "관리 학생(전시회 담당 등)"으로 정의하므로 전시회 업무는 manager+.
router.get(
  '/admin/exhibition/entries',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const p = Math.max(1, parseInt(req.query.page, 10) || 1)
    // Y3-2(33_PHASE18): 접수 관리 시트가 전량을 한 화면에서 정렬·검색하므로 상한 500
    const ps = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50))
    const countRes = await query('SELECT COUNT(*)::int AS total FROM exhibition_entries', [])
    const { rows } = await query(
      `SELECT id, semester_label, entry_type, fields, email, images, created_at, updated_at
       FROM exhibition_entries ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [ps, (p - 1) * ps]
    )
    res.json({ items: rows, total: countRes.rows[0]?.total ?? 0, page: p, pageSize: ps })
  })
)

// 전시회 접수 전체 삭제 — 테스트 데이터 초기화용. owner만 허용하고, 업로드 기록(form_file_uploads)은
// 지우지 않는다(Drive 안의 실제 파일은 별도 확인 없이 지우지 않는다는 원칙과 같다).
router.delete(
  '/admin/exhibition/entries',
  requireAuth,
  requireRole('owner'),
  wrap(async (req, res) => {
    const result = await query('DELETE FROM exhibition_entries', [])
    res.json({ ok: true, deleted: result.rowCount ?? 0 })
  })
)

export default router
