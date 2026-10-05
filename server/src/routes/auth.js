// src/routes/auth.js — 인증 (12_BACKEND.md 3절·8절)
// POST /auth/login | POST /auth/setup-password(온보딩) | POST /auth/logout | GET /auth/me
// owner가 이메일+롤 사전 등록 → 대상자 첫 로그인 시 must_set_pw 상태 → setup-password로 첫 비번 설정.
import { Router } from 'express'
import bcrypt from 'bcrypt'
import { query } from '../db.js'
import { requireAuth, setAuthCookies, clearAuthCookies } from '../middleware/auth.js'
import { wrap } from './content.js'

const router = Router()
const MIN_PW_LENGTH = 8

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role }
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase()
}

router.post(
  '/login',
  wrap(async (req, res) => {
    const email = normEmail(req.body?.email)
    const password = req.body?.password
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })

    const { rows } = await query(
      'SELECT id, email, name, role, password_hash, must_set_pw FROM users WHERE email = $1',
      [email]
    )
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'invalid credentials' })

    // 온보딩: 비밀번호 미설정 상태 → 입력값을 그대로 최초 비번으로 등록 후 즉시 로그인
    if (user.must_set_pw || !user.password_hash) {
      const hash = await bcrypt.hash(String(password), 10)
      const updated = await query(
        'UPDATE users SET password_hash = $1, must_set_pw = FALSE WHERE id = $2 RETURNING id, email, name, role',
        [hash, user.id]
      )
      setAuthCookies(res, updated.rows[0])
      return res.json({ user: publicUser(updated.rows[0]) })
    }

    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) return res.status(401).json({ error: 'invalid credentials' })

    setAuthCookies(res, user)
    res.json({ user: publicUser(user) })
  })
)

router.post(
  '/setup-password',
  wrap(async (req, res) => {
    const email = normEmail(req.body?.email)
    const password = req.body?.password
    if (!email || !password) return res.status(400).json({ error: 'email and password required' })
    if (String(password).length < MIN_PW_LENGTH) {
      return res.status(400).json({ error: `password must be at least ${MIN_PW_LENGTH} characters` })
    }

    const { rows } = await query(
      'SELECT id, email, name, role, must_set_pw FROM users WHERE email = $1',
      [email]
    )
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'user not found' })
    if (!user.must_set_pw) return res.status(409).json({ error: 'password already set' })

    const hash = await bcrypt.hash(String(password), 10)
    const updated = await query(
      'UPDATE users SET password_hash = $1, must_set_pw = FALSE WHERE id = $2 RETURNING id, email, name, role',
      [hash, user.id]
    )
    setAuthCookies(res, updated.rows[0])
    res.json({ user: publicUser(updated.rows[0]) })
  })
)

router.post('/logout', (req, res) => {
  clearAuthCookies(res)
  res.json({ ok: true })
})

router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT id, email, name, role, must_set_pw, picture FROM users WHERE id = $1',
      [req.user.id]
    )
    if (!rows[0]) return res.status(401).json({ error: 'user not found' })
    res.json({ user: rows[0] })
  })
)

export default router
