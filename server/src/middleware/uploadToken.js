// src/middleware/uploadToken.js — 업로드 전용 임시 토큰
//
// 프론트는 서버를 같은 사이트 경로(/api, Vercel이 전달)로 부르는데, Vercel은 요청 본문이 4.5MB를 넘으면 거절한다.
// 사진·원본 파일 업로드는 이보다 크므로 서버로 직접 보낸다. 직접 요청은 다른 사이트라 로그인 쿠키가 안 실리는 브라우저가
// 있어서(사파리·아이폰·파이어폭스·시크릿 창), 로그인한 사람이 같은 사이트 경로로 10분짜리 업로드 토큰을 받아
// Authorization 헤더에 실어 보낸다. 토큰은 /upload 에서만 신원으로 인정된다(다른 API에는 쓸 수 없음).
import jwt from 'jsonwebtoken'
import { jwtSecret } from './auth.js'

const TTL_SEC = 10 * 60

export function signUploadToken({ staff, pub }) {
  return jwt.sign({ typ: 'upload', staff: staff || null, pub: pub || null }, jwtSecret(), { expiresIn: TTL_SEC })
}

/** 쿠키로 신원이 안 잡힌 요청에서만 Bearer 업로드 토큰을 신원으로 쓴다 */
export function uploadTokenAuth(req, res, next) {
  if (req.user || req.publicUser) return next()
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '')
  if (!m) return next()
  try {
    const p = jwt.verify(m[1], jwtSecret())
    if (p.typ === 'upload') {
      if (p.staff) req.user = { id: p.staff.id, email: p.staff.email, name: p.staff.name, role: p.staff.role }
      else if (p.pub) req.publicUser = { id: p.pub.id, email: p.pub.email, name: p.pub.name, wsOnly: Boolean(p.pub.wsOnly) }
    }
  } catch {
    /* 만료·위조 → 비로그인으로 취급 */
  }
  next()
}
