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

    // 비밀번호를 아직 정하지 않은 계정(관리자가 이메일만 등록한 계정): 처음 로그인할 때 입력한 값을
    // 그대로 이 계정의 비밀번호로 정하고 바로 로그인시킨다. 구글 로그인은 필요 없다.
    // 등록만 해 두고 오래 방치하면 이메일을 아는 다른 사람이 먼저 정할 수 있으므로, 등록 뒤 바로 본인에게 알린다.
    if (user.must_set_pw || !user.password_hash) {
      // 오너 계정은 이 방식에서 제외한다. 이메일만 아는 사람이 오너 권한을 가져가지 못하게 구글 로그인으로만 처음 들어온다.
      if (user.role === 'owner') {
        return res.status(403).json({
          error: 'password not set',
          code: 'google_first',
          hint: '오너 계정은 처음 로그인을 이 이메일의 구글 계정으로 해 주세요.',
        })
      }
      if (String(password).length < MIN_PW_LENGTH) {
        return res.status(400).json({
          error: 'first password too short',
          code: 'first_password',
          hint: `처음 로그인입니다. 앞으로 쓸 비밀번호를 ${MIN_PW_LENGTH}자 이상으로 입력하세요. 지금 입력한 값이 이 계정의 비밀번호가 됩니다.`,
        })
      }
      const hash = await bcrypt.hash(String(password), 10)
      const updated = await query(
        'UPDATE users SET password_hash = $1, must_set_pw = FALSE WHERE id = $2 RETURNING id, email, name, role',
        [hash, user.id]
      )
      setAuthCookies(res, updated.rows[0])
      return res.json({ user: publicUser(updated.rows[0]), first_login: true })
    }

    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) return res.status(401).json({ error: 'invalid credentials' })

    setAuthCookies(res, user)
    res.json({ user: publicUser(user) })
  })
)

// 비밀번호 설정: 이미 로그인한 본인(구글 로그인으로 이메일 확인됨)만 자기 계정에 정할 수 있다.
router.post(
  '/setup-password',
  requireAuth,
  wrap(async (req, res) => {
    const email = normEmail(req.body?.email || req.user.email)
    const password = req.body?.password
    if (!password) return res.status(400).json({ error: 'password required' })
    if (email !== normEmail(req.user.email)) return res.status(403).json({ error: '본인 계정의 비밀번호만 정할 수 있습니다' })
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
