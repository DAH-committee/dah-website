// src/middleware/rateLimit.js — IP 기반 rate limit (12_BACKEND.md 5절: 접수 IP당 시간 10회)
import rateLimit from 'express-rate-limit'

const HOUR = 60 * 60 * 1000

// 전시회 접수·쇼케이스 제출 등 비로그인 쓰기 경로: IP당 시간 10회
export const submitLimiter = rateLimit({
  windowMs: HOUR,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'too many requests', retryAfter: '1h' }),
})

// 전시회 접수: 학교 공용망(같은 IP에 여러 학생)을 고려해 IP당 시간 300회로 넉넉하게 두고,
// 실제 남용 방지는 로그인한 계정별 제한(exhibitionUserLimiter)이 맡는다. 접수, 수정, 작품 제출이 같은 한도를 쓴다.
export const exhibitionIpLimiter = rateLimit({
  windowMs: HOUR,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'too many requests', retryAfter: '1h' }),
})

export const exhibitionUserLimiter = rateLimit({
  windowMs: HOUR,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.publicUser?.id ?? 'anon'}`,
  handler: (req, res) => res.status(429).json({ error: 'too many requests', retryAfter: '1h' }),
})

// 비로그인 업로드: 접수 1건에 이미지 여러 장이 필요하므로 제출보다 넉넉하게 (IP당 시간 30회)
export const anonUploadLimiter = rateLimit({
  windowMs: HOUR,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'too many requests', retryAfter: '1h' }),
})
