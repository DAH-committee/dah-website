// routes/easterEgg.js — 주현호 이스터에그 발견 기록
//
// 공개 제출은 한 라운드에 최대 3건이다. 개인정보는 공개 API에서 절대 반환하지 않고,
// 주현호 이름의 owner 계정만 전용 관리 API로 열람·초기화할 수 있다.
import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { submitLimiter } from '../middleware/rateLimit.js'
import { wrap } from './content.js'

const router = Router()
const LIMIT = 3
const LOCK_KEY = 26091803
let schemaPromise = null

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = query(`
      CREATE TABLE IF NOT EXISTS hyunho_easter_egg_discoveries (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        student_no TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  return schemaPromise
}

function text(value, max = 80) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function validStudentNo(value) {
  return /^[0-9]{6,16}$/.test(value)
}

function validPhone(value) {
  return /^[0-9+() -]{8,24}$/.test(value)
}

// owner 권한만으로는 부족하다. 이 페이지는 요청대로 주현호 본인 owner 계정에만 보인다.
function requireHyunhoOwner(req, res, next) {
  if (req.user?.role !== 'owner' || text(req.user?.name, 50) !== '주현호') {
    return res.status(403).json({ error: 'hyunho owner access required' })
  }
  return next()
}

router.get(
  '/easter-eggs/hyunho/status',
  wrap(async (req, res) => {
    await ensureSchema()
    const { rows } = await query('SELECT COUNT(*)::int AS total FROM hyunho_easter_egg_discoveries')
    const total = Math.min(LIMIT, rows[0]?.total ?? 0)
    res.json({ total, limit: LIMIT, remaining: Math.max(0, LIMIT - total), nextPosition: total + 1 })
  })
)

router.post(
  '/easter-eggs/hyunho/discoveries',
  submitLimiter,
  wrap(async (req, res) => {
    await ensureSchema()
    const name = text(req.body?.name, 50)
    const studentNo = text(req.body?.student_no, 16)
    const phone = text(req.body?.phone, 24)
    if (!name || !validStudentNo(studentNo) || !validPhone(phone)) {
      return res.status(400).json({ error: 'valid name, student_no, and phone are required' })
    }
    if (req.body?.privacy_agreed !== true) {
      return res.status(400).json({ error: 'privacy agreement is required' })
    }

    // 한 SQL 문장 안에서 advisory lock을 획득한다. 동시에 눌러도 최대 3명만 기록되고,
    // 반환 position은 실제 저장 순서와 항상 일치한다.
    const { rows } = await query(
      `WITH lock AS (SELECT pg_advisory_xact_lock($1)),
            existing AS (
              SELECT COUNT(*)::int AS total
              FROM hyunho_easter_egg_discoveries, lock
            ),
            created AS (
              INSERT INTO hyunho_easter_egg_discoveries (name, student_no, phone)
              SELECT $2, $3, $4 FROM existing WHERE total < $5
              RETURNING id, created_at
            )
       SELECT created.id, created.created_at, existing.total + 1 AS position
       FROM created, existing`,
      [LOCK_KEY, name, studentNo, phone, LIMIT]
    )
    if (!rows[0]) {
      return res.status(409).json({ error: 'discovery limit reached', limit: LIMIT })
    }
    return res.status(201).json({ discovery: rows[0], limit: LIMIT, remaining: LIMIT - rows[0].position })
  })
)

router.get(
  '/admin/easter-eggs/hyunho',
  requireAuth,
  requireRole('owner'),
  requireHyunhoOwner,
  wrap(async (req, res) => {
    await ensureSchema()
    const { rows } = await query(
      `SELECT id, name, student_no, phone, created_at
       FROM hyunho_easter_egg_discoveries
       ORDER BY created_at ASC, id ASC`
    )
    res.json({ items: rows, total: rows.length, limit: LIMIT })
  })
)

router.delete(
  '/admin/easter-eggs/hyunho/discoveries',
  requireAuth,
  requireRole('owner'),
  requireHyunhoOwner,
  wrap(async (req, res) => {
    await ensureSchema()
    const result = await query('DELETE FROM hyunho_easter_egg_discoveries')
    res.json({ ok: true, deleted: result.rowCount ?? 0, limit: LIMIT })
  })
)

export default router
