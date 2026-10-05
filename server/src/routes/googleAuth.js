// src/routes/googleAuth.js: 공개 제출자 구글 로그인 (41_AUTH_CONTRACT)
//
// 스태프 인증(routes/auth.js)과 경로, 쿠키, 테이블이 모두 분리된 신원 클래스다.
//   GET  /auth/google/login?next=&hint=  state 쿠키 발급 후 구글 동의 화면으로 302
//   GET  /auth/google/callback     state 대조, code 교환, id_token 검증, public_users 생성(일반 계정은 ws_only),
//                                  공개 쿠키 발급 후 CLIENT_ORIGIN + next 로 복귀
//   GET  /auth/public/me           로그인된 구글 계정 (비로그인 401)
//   POST /auth/public/logout       공개 쿠키 삭제
//
// 신규 의존성 없이 authorization code 플로우를 직접 구현한다. id_token은 TLS 위 서버 대 서버
// 응답이라 중간자가 끼어들 수 없으므로 서명 검증 대신 aud, iss, email_verified만 확인한다.
import { Router } from 'express'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { jwtSecret, baseCookieOpts, cookieOpts, setAuthCookies } from '../middleware/auth.js'
import {
  requirePublicAuth,
  setPublicAuthCookies,
  clearPublicAuthCookies,
} from '../middleware/publicAuth.js'
import { wrap } from './content.js'

const router = Router()

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const VALID_ISS = ['accounts.google.com', 'https://accounts.google.com']

// CSRF용 1회성 state. 랜덤 nonce와 복귀 경로를 담은 단기 서명 JWT다.
// 이 JWT를 구글 state 파라미터로 왕복시켜(콜백이 쿠키에 의존하지 않게) 검증한다.
// 쿠키(dah_oauth_state)는 정상 브라우저의 추가 바인딩용으로만 함께 심는다(선택적 대조).
// 프론트(vercel.app)와 API(onrender.com)가 서로 다른 사이트라, cross-site SameSite=None 쿠키는
// Safari ITP·서드파티 쿠키 차단에서 유실될 수 있다 — 쿠키에만 의존하면 "invalid oauth state"가 난다.
const STATE_COOKIE = 'dah_oauth_state'
const STATE_TTL_SEC = 10 * 60

const NOT_CONFIGURED = {
  error: 'google oauth not configured',
  hint: '서버 환경변수 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI를 설정한 뒤 재기동하세요. 구글 클라우드 콘솔의 승인된 리디렉션 URI가 GOOGLE_REDIRECT_URI와 완전히 같아야 합니다.',
}

function oauthConfig() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) return null
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
  }
}

// CLIENT_ORIGIN은 CORS 화이트리스트라 쉼표 목록일 수 있다. 복귀는 첫 오리진 기준.
function clientOrigin() {
  const first = process.env.CLIENT_ORIGIN?.split(',')[0]?.trim()
  return (first || 'http://localhost:5173').replace(/\/+$/, '')
}

// 오픈 리다이렉트 차단: CLIENT_ORIGIN 기준 경로만 허용한다.
// 외부 URL, 프로토콜 상대 경로(//evil.com), 역슬래시 우회(/\evil.com), 헤더 개행 주입은 '/'로 폴백.
function safeNext(raw) {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!/^\/($|[^/\\])/.test(v)) return '/'
  if (/[\u0000-\u001f\u007f]/.test(v)) return '/' // Location 헤더 개행 주입 차단
  return v
}

// id_token은 서명 검증 없이 페이로드만 읽는다(위 파일 주석의 근거). base64url 디코드 실패는 null.
function decodeIdToken(idToken) {
  const parts = String(idToken || '').split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

router.get('/google/login', (req, res) => {
  const cfg = oauthConfig()
  if (!cfg) return res.status(503).json(NOT_CONFIGURED)

  const nonce = crypto.randomBytes(16).toString('hex')
  const state = jwt.sign({ nonce, next: safeNext(req.query.next) }, jwtSecret(), {
    expiresIn: STATE_TTL_SEC,
  })
  res.cookie(STATE_COOKIE, state, cookieOpts(STATE_TTL_SEC))

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state, // 서명 JWT 자체를 왕복(쿠키 유실돼도 콜백 성립). ~208B라 구글 state 한도 내.
    access_type: 'online',
    prompt: 'select_account',
  })
  const hint = String(req.query.hint || '').trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) params.set('login_hint', hint)
  res.redirect(`${AUTH_ENDPOINT}?${params.toString()}`)
})

router.get(
  '/google/callback',
  wrap(async (req, res) => {
    const cfg = oauthConfig()
    if (!cfg) return res.status(503).json(NOT_CONFIGURED)

    const stateCookie = req.cookies?.[STATE_COOKIE]
    res.clearCookie(STATE_COOKIE, baseCookieOpts()) // 1회용이므로 성패와 무관하게 즉시 폐기

    // 실패하면 JSON 대신 로그인하려던 화면으로 돌아가 안내 문구를 띄운다(?login_error=)
    let nextPath = '/workspace/docs'
    try {
      nextPath = safeNext(jwt.decode(String(req.query.state || ''))?.next) || nextPath
    } catch {
      /* state 해석 불가 → 기본 화면 */
    }
    const fail = (msg) => {
      const sep = nextPath.includes('?') ? '&' : '?'
      return res.redirect(`${clientOrigin()}${nextPath}${sep}login_error=${encodeURIComponent(msg)}`)
    }

    if (req.query.error) return fail('구글 로그인이 취소되었습니다. 다시 시도하세요.')

    // 1순위: 구글이 되돌려준 state(서명 JWT)를 검증한다. 쿠키 없이도 성립한다.
    //   서명(HMAC jwtSecret)이 위조를, 만료(10분)가 재사용을 막는다.
    let statePayload = null
    try {
      statePayload = jwt.verify(String(req.query.state || ''), jwtSecret())
    } catch {
      statePayload = null
    }
    if (!statePayload) return fail('로그인 요청이 만료되었습니다. 처음부터 다시 시도하세요.')
    // 2순위(선택): 쿠키가 도착한 정상 브라우저는 nonce 일치까지 확인(추가 CSRF 바인딩).
    //   쿠키가 유실된 브라우저(Safari ITP·서드파티 차단)는 위 서명 검증만으로 통과시킨다.
    if (stateCookie) {
      try {
        const cookiePayload = jwt.verify(String(stateCookie), jwtSecret())
        if (cookiePayload.nonce !== statePayload.nonce) return fail('로그인 요청이 다른 창에서 시작되었습니다. 처음부터 다시 시도하세요.')
      } catch {
        // 쿠키 만료·손상 — 쿼리 state 서명이 유효하므로 진행
      }
    }

    const code = String(req.query.code || '')
    if (!code) return fail('구글 로그인이 완료되지 않았습니다. 다시 시도하세요.')

    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) {
      console.error('[auth/google] 토큰 교환 실패:', tokenRes.status, await tokenRes.text())
      return fail('구글 로그인 확인에 실패했습니다. 잠시 뒤 다시 시도하세요.')
    }

    const claims = decodeIdToken((await tokenRes.json()).id_token)
    if (!claims || claims.aud !== cfg.clientId || !VALID_ISS.includes(claims.iss)) return fail('구글 로그인 확인에 실패했습니다. 다시 시도하세요.')
    if (!claims.sub || !claims.email || claims.email_verified !== true) return fail('이메일 인증이 끝난 구글 계정으로 로그인하세요.')

    const googleSub = String(claims.sub)
    const email = String(claims.email).trim().toLowerCase()
    const picture = typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture : null

    // 1) 운영위원회·교수진(스태프) 계정과 같은 이메일이면 스태프로 로그인한다(프로필 사진을 함께 저장).
    const staff = (await query('SELECT id, email, name, role, must_set_pw FROM users WHERE lower(email) = $1', [email])).rows[0]
    let staffIn = false
    if (staff && !staff.must_set_pw) {
      await query('UPDATE users SET picture = $1 WHERE id = $2', [picture, staff.id])
      setAuthCookies(res, staff)
      staffIn = true
    }

    // 2) 게스트: 구글 계정이면 누구나 DAH Docs·Sheet·Form에 로그인한다(목록에는 자기 파일과 공유받은 파일만 나온다).
    //    전시회·쇼케이스 제출은 지금처럼 한림대 이메일(@hallym.ac.kr, 하위 도메인 포함), 관리자가 미리 등록한 이메일,
    //    문서에 초대된 이메일, 운영위원회 구성원 이메일만 할 수 있다. 그 밖의 계정은 ws_only=true로 표시한다.
    const hallym = /@(?:[a-z0-9-]+\.)*hallym\.ac\.kr$/.test(email) // hallym.ac.kr, glab.hallym.ac.kr 등
    const known = Boolean(
      hallym ||
        (await query('SELECT 1 FROM ws_shares WHERE lower(email) = $1 LIMIT 1', [email])).rows[0] ||
        (await query('SELECT 1 FROM ws_members WHERE lower(email) = $1 LIMIT 1', [email])).rows[0]
    )
    let user = (await query('SELECT id, google_sub, email, name, ws_only FROM public_users WHERE lower(email) = $1', [email])).rows[0]
    if (!user) {
      user = (
        await query(
          `INSERT INTO public_users (google_sub, email, name, ws_only) VALUES ($1, $2, $3, $4)
           ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email
           RETURNING id, google_sub, email, name, ws_only`,
          [googleSub, email, claims.name || null, !known]
        )
      ).rows[0]
    }
    if (user.google_sub !== googleSub) {
      if (staffIn) return res.redirect(`${clientOrigin()}${safeNext(statePayload.next)}`)
      return fail('이 이메일은 다른 구글 계정으로 이미 등록되어 있습니다. 운영위원회에 문의하세요.')
    }

    // 나중에 초대·구성원 등록이 되면 제출 제한을 푼다(반대로 다시 걸지는 않는다)
    const { rows } = await query(
      `UPDATE public_users SET name = $1, picture = $2, last_login_at = now(), ws_only = ws_only AND $4
       WHERE id = $3
       RETURNING id, email, name, ws_only`,
      [claims.name || user.name || null, picture, user.id, !known]
    )
    setPublicAuthCookies(res, { ...rows[0], wsOnly: rows[0].ws_only })
    res.redirect(`${clientOrigin()}${safeNext(statePayload.next)}`)
  })
)

router.get('/public/me', requirePublicAuth, wrap(async (req, res) => {
  const row = (await query('SELECT picture FROM public_users WHERE id = $1', [req.publicUser.id])).rows[0]
  res.json({ user: { ...req.publicUser, picture: row?.picture || null } })
}))

router.post('/public/logout', (req, res) => {
  clearPublicAuthCookies(res)
  res.json({ ok: true })
})

export default router
