// src/db.js — pg Pool 래퍼 (12_BACKEND.md 완료 조건: DATABASE_URL 없이도 기동).
// DATABASE_URL이 없으면 풀을 만들지 않고 isConfigured()가 false — app.js의 가드가
// /health 외 요청에 명확한 JSON 에러를 반환한다.
// 테스트는 setDb(mock)으로 query 구현을 교체한다 (스모크 테스트 DB 모킹).
import pg from 'pg'
import { DRIVE_SCHEMA_STATEMENTS } from './lib/driveSchema.js'

let pool = null
let injected = null // 테스트 주입용 { query(text, params) }

if (process.env.DATABASE_URL) {
  const url = process.env.DATABASE_URL
  pool = new pg.Pool({
    connectionString: url,
    // Neon 등 원격 Postgres는 SSL 필수. 로컬(localhost)만 평문 허용
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 5,
  })
}

export function isConfigured() {
  return Boolean(injected || pool)
}

// 테스트에서 mock 주입 (null 전달 시 해제 → env 미설정 상태 재현)
export function setDb(mock) {
  injected = mock
}

export async function query(text, params) {
  const impl = injected || pool
  if (!impl) {
    const err = new Error('DATABASE_URL not configured')
    err.code = 'DB_NOT_CONFIGURED'
    throw err
  }
  return impl.query(text, params)
}

// 41_AUTH_CONTRACT: 공개(구글) 로그인이 의존하는 스키마를 부팅 시 멱등 보장한다.
// 서버는 schema.sql·migrate-*.mjs를 부팅에 실행하지 않는다 — 그래서 migrate-phase41이
// 배포 DB에 안 돌면 콜백이 "relation public_users does not exist"(42P01)로 죽었다.
// 이 auth-critical 조각만 self-heal 한다(전부 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS —
// 비파괴·멱등). migrate-phase41.mjs와 동일 내용이라 재배포만으로 배포 DB가 스스로 낫는다.
// 문장마다 독립 try — 한 문장이 실패해도(권한·선행 테이블 부재) 나머지는 진행하고,
// 서버 기동 자체는 막지 않는다(읽기·/health는 계속 동작).
export async function ensurePublicAuthSchema() {
  const impl = injected || pool
  if (!impl) return
  const statements = [
    `CREATE TABLE IF NOT EXISTS public_users (
       id            SERIAL PRIMARY KEY,
       google_sub    TEXT UNIQUE NOT NULL,
       email         TEXT NOT NULL,
       name          TEXT,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
       last_login_at TIMESTAMPTZ
     )`,
    'ALTER TABLE exhibition_entries ADD COLUMN IF NOT EXISTS public_user_id INTEGER',
    'ALTER TABLE showcase ADD COLUMN IF NOT EXISTS public_user_id INTEGER',
    'ALTER TABLE exhibition_entries ALTER COLUMN pw_hash DROP NOT NULL',
  ]
  for (const sql of statements) {
    try {
      await impl.query(sql)
    } catch (err) {
      console.error('[schema] ensurePublicAuthSchema 문장 실패(계속 진행):', err.message)
    }
  }
}

// 53_DRIVE_STORAGE: Google Drive 연결 프로필·폴더 바인딩·업로드 기록 스키마를 부팅 시 보장한다.
// 관리자가 Render 셸에서 마이그레이션을 돌리지 못하는 상황(운영진 교체 직후)에도 재배포만으로
// 저장소 화면이 살아나야 하므로 ensurePublicAuthSchema와 같은 self-heal 규칙을 따른다.
// DDL 본문은 lib/driveSchema.js 하나에만 있다(마이그레이션 스크립트와 공유).
export async function ensureDriveSchema() {
  const impl = injected || pool
  if (!impl) return
  for (const sql of DRIVE_SCHEMA_STATEMENTS) {
    try {
      await impl.query(sql)
    } catch (err) {
      console.error('[schema] ensureDriveSchema 문장 실패(계속 진행):', err.message)
    }
  }
}
