// src/middleware/publicAuth.js — 공개 제출자(구글 로그인) 인증 (41_GOOGLE_AUTH_PUBLIC)
//
// 스태프(owner/admin/manager) 인증과 **별개 신원 클래스**다. 쿠키 이름·JWT 클레임을 분리해
// 두 세션이 서로를 덮어쓰지 않게 한다. 같은 쿠키를 쓰면 공개 로그인이 관리자 세션을 밀어내고
// (또는 그 반대) /auth/me가 엉뚱한 신원을 반환한다.
//
// 시크릿·쿠키 속성(SameSite=None+Secure, cross-site Vercel↔Render)은 auth.js와 공유한다.
import jwt from 'jsonwebtoken'
import { jwtSecret, baseCookieOpts, cookieOpts } from './auth.js'

export const PUBLIC_ACCESS_COOKIE = 'dah_pub_access'
export const PUBLIC_REFRESH_COOKIE = 'dah_pub_refresh'

// 스태프 토큰과 구조가 같아 보여도 이 값으로 신원 클래스를 구분한다.
// 스태프 JWT에는 kind가 없으므로 공개 라우트가 스태프 토큰을 받아들이는 일이 없다.
const PUBLIC_KIND = 'public'

const ACCESS_TTL_SEC = 15 * 60
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60

// wsOnly: 한림대·초대·위원회 등록 이메일이 아닌 일반 구글 계정. DAH Docs·Sheet·Form만 쓰고 제출은 못 한다.
function payloadToPublicUser(p) {
  return { id: p.sub, email: p.email, name: p.name, wsOnly: p.ws === true }
}

function sign(user, type, ttlSec) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, ...(user.wsOnly ? { ws: true } : {}), kind: PUBLIC_KIND, type },
    jwtSecret(),
    { expiresIn: ttlSec }
  )
}

export function setPublicAuthCookies(res, user) {
  res.cookie(
    PUBLIC_ACCESS_COOKIE,
    sign(user, 'access', ACCESS_TTL_SEC),
    cookieOpts(ACCESS_TTL_SEC)
  )
  res.cookie(
    PUBLIC_REFRESH_COOKIE,
    sign(user, 'refresh', REFRESH_TTL_SEC),
    cookieOpts(REFRESH_TTL_SEC)
  )
}

export function clearPublicAuthCookies(res) {
  // 삭제 쿠키도 동일 속성이어야 cross-site에서 확실히 덮어써진다(auth.js와 동일 계약)
  res.clearCookie(PUBLIC_ACCESS_COOKIE, baseCookieOpts())
  res.clearCookie(PUBLIC_REFRESH_COOKIE, baseCookieOpts())
}

function resolvePublicUser(req, res) {
  const at = req.cookies?.[PUBLIC_ACCESS_COOKIE]
  if (at) {
    try {
      const p = jwt.verify(at, jwtSecret())
      if (p.kind === PUBLIC_KIND && p.type === 'access') return payloadToPublicUser(p)
    } catch {
      // 만료·위조 → refresh로 폴백
    }
  }
  const rt = req.cookies?.[PUBLIC_REFRESH_COOKIE]
  if (rt) {
    try {
      const p = jwt.verify(rt, jwtSecret())
      if (p.kind === PUBLIC_KIND && p.type === 'refresh') {
        const user = payloadToPublicUser(p)
        setPublicAuthCookies(res, user) // refresh 회전
        return user
      }
    } catch {
      // 무효 refresh → 비로그인 취급
    }
  }
  return null
}

export function requirePublicAuth(req, res, next) {
  const user = resolvePublicUser(req, res)
  if (!user) {
    return res.status(401).json({ error: 'google login required', loginPath: '/auth/google/login' })
  }
  req.publicUser = user
  next()
}

// 전시회·쇼케이스 제출용: 구글 로그인 + 사전 등록된(또는 한림대·초대) 계정만 통과
export function requireSubmitterAuth(req, res, next) {
  requirePublicAuth(req, res, () => {
    if (req.publicUser?.wsOnly) {
      return res.status(403).json({
        error: 'email is not registered',
        hint: '한림대 이메일(@hallym.ac.kr) 구글 계정으로 로그인하세요. 이 계정은 DAH Docs·Sheet·Form에만 쓸 수 있습니다.',
      })
    }
    next()
  })
}

// 로그인 여부만 판별 — 비로그인도 진행하되 신원이 있으면 붙인다
export function optionalPublicAuth(req, res, next) {
  req.publicUser = resolvePublicUser(req, res)
  next()
}
