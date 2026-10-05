import crypto from 'node:crypto'
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

// 관리자 시트의 화면 상태(열 너비, 숨긴 열, 서식, 메모 열)를 저장하는 표. 부팅 때 멱등 보장한다.
export async function ensureSheetStateSchema() {
  const impl = injected || pool
  if (!impl) return
  try {
    await impl.query(`CREATE TABLE IF NOT EXISTS admin_sheet_state (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  } catch (err) {
    console.error('[schema] ensureSheetStateSchema 실패(계속 진행):', err.message)
  }
}

// 운영위원회 인수인계 문서: 문서, 여백 댓글, 비밀값, 열람 비밀번호 해시. 부팅 때 멱등 보장한다.
export const HANDOVER_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS handover_settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS handover_docs (
     id           SERIAL PRIMARY KEY,
     title        TEXT NOT NULL,
     content      JSONB,
     content_html TEXT,
     sort         INTEGER NOT NULL DEFAULT 0,
     updated_by   TEXT,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS handover_comments (
     id         SERIAL PRIMARY KEY,
     doc_id     INTEGER NOT NULL,
     anchor_id  TEXT NOT NULL,
     side       TEXT NOT NULL DEFAULT 'right',
     quote      TEXT,
     body       TEXT NOT NULL DEFAULT '',
     images     JSONB NOT NULL DEFAULT '[]'::jsonb,
     author     TEXT,
     author_id  INTEGER,
     resolved   BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS handover_comments_doc_idx ON handover_comments (doc_id)',
  `CREATE TABLE IF NOT EXISTS ws_files (
     id         SERIAL PRIMARY KEY,
     kind       TEXT NOT NULL,
     title      TEXT NOT NULL DEFAULT '제목 없음',
     content    JSONB,
     template   TEXT,
     gated      BOOLEAN NOT NULL DEFAULT false,
     created_by TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     opened_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'ALTER TABLE handover_docs ADD COLUMN IF NOT EXISTS ws_id INTEGER',
  'CREATE INDEX IF NOT EXISTS handover_docs_ws_idx ON handover_docs (ws_id)',
  `CREATE TABLE IF NOT EXISTS handover_versions (
     id         SERIAL PRIMARY KEY,
     doc_id     INTEGER NOT NULL,
     title      TEXT,
     name       TEXT,
     content    JSONB NOT NULL,
     author     TEXT,
     kind       TEXT NOT NULL DEFAULT 'edit',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS handover_versions_doc_idx ON handover_versions (doc_id, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS handover_secrets (
     id         SERIAL PRIMARY KEY,
     label      TEXT NOT NULL,
     value      TEXT NOT NULL,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // 공유 설정(구글 독스 방식): 일반 액세스(제한됨 / 운영위원회 및 교수진 / 전체 공개)와 사람별 권한
  "ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS general_access TEXT NOT NULL DEFAULT 'restricted'",
  "ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS general_role TEXT NOT NULL DEFAULT 'viewer'",
  'ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS share_token TEXT',
  'ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS owner_email TEXT',
  `CREATE TABLE IF NOT EXISTS ws_shares (
     id         SERIAL PRIMARY KEY,
     ws_id      INTEGER NOT NULL,
     email      TEXT NOT NULL,
     role       TEXT NOT NULL DEFAULT 'viewer',
     added_by   TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (ws_id, email)
   )`,
  'CREATE INDEX IF NOT EXISTS ws_shares_email_idx ON ws_shares (lower(email))',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT',
  // 디인예 폼도 같은 공유 설정을 쓰도록 폼마다 ws_files(kind=form) 행을 하나 둔다
  'ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS form_id INTEGER',
  // 마지막으로 수정한 사람·시각·위치(문서 문단, 시트 칸, 폼 질문). "마지막으로 수정"을 누르면 그 위치로 이동한다
  'ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS last_edit JSONB',
  'CREATE UNIQUE INDEX IF NOT EXISTS ws_files_form_idx ON ws_files (form_id) WHERE form_id IS NOT NULL',
  'ALTER TABLE custom_forms ALTER COLUMN created_by DROP NOT NULL',
  'ALTER TABLE public_users ADD COLUMN IF NOT EXISTS picture TEXT',
  // 한림대·초대·위원회 등록 이메일이 아닌 구글 계정도 DAH Docs·Sheet·Form에는 로그인할 수 있다.
  // 이런 계정은 ws_only=true로 표시해 전시회·쇼케이스 제출(사전 등록 필요)에는 쓰지 못하게 한다.
  'ALTER TABLE public_users ADD COLUMN IF NOT EXISTS ws_only BOOLEAN NOT NULL DEFAULT false',
  // 비공개: 공유받지 않은 사람의 목록에서 아예 숨긴다(잠긴 카드도 보이지 않음). 운영위원회 및 교수진이 켜고 끈다.
  'ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false',
  // 나만 보기: 만든 사람만 열 수 있고 공유도 할 수 없다(사이트 관리자도 열 수 없음). 심사채점표가 이 상태로 만들어진다.
  'ALTER TABLE ws_files ADD COLUMN IF NOT EXISTS owner_only BOOLEAN NOT NULL DEFAULT false',
  // 사이트 계정과 별개인 DAH Docs·Sheet·Form 운영위원회 구성원(구글 이메일). 사이트 관리자가 등록한다.
  `CREATE TABLE IF NOT EXISTS ws_members (
     id         SERIAL PRIMARY KEY,
     email      TEXT NOT NULL,
     name       TEXT,
     note       TEXT,
     added_by   TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS ws_members_email_idx ON ws_members (lower(email))',
]

export async function ensureHandoverSchema() {
  const impl = injected || pool
  if (!impl) return
  for (const sql of HANDOVER_SCHEMA_STATEMENTS) {
    try {
      await impl.query(sql)
    } catch (err) {
      console.error('[schema] ensureHandoverSchema 문장 실패(계속 진행):', err.message)
    }
  }
  // 문서에 묶이지 않은 기존 탭은 '열람 비밀번호 문서' 하나로 묶는다(멱등)
  try {
    const orphan = await impl.query('SELECT 1 FROM handover_docs WHERE ws_id IS NULL LIMIT 1')
    if (orphan.rows.length) {
      let g = (await impl.query("SELECT id FROM ws_files WHERE kind = 'doc' AND gated = true ORDER BY id LIMIT 1")).rows[0]
      if (!g) {
        const t = (await impl.query("SELECT value FROM handover_settings WHERE key = 'doc_title'")).rows[0]?.value || '운영위원회 인수인계 문서'
        g = (await impl.query("INSERT INTO ws_files (kind, title, gated, created_by) VALUES ('doc', $1, true, '주현호') RETURNING id", [t])).rows[0]
      }
      await impl.query('UPDATE handover_docs SET ws_id = $1 WHERE ws_id IS NULL', [g.id])
    }
  } catch (err) {
    console.error('[schema] 인수인계 문서 묶기 실패(계속 진행):', err.message)
  }
  // 공유 설정 첫 적용: 예전 '열람 비밀번호 문서'는 운영위원회 및 교수진이 편집하는 문서로 옮기고, 소유자 이메일을 채운다.
  try {
    await impl.query("UPDATE ws_files SET general_access = 'committee', general_role = 'editor' WHERE gated = true AND share_token IS NULL")
    await impl.query('UPDATE ws_files f SET owner_email = lower(u.email) FROM users u WHERE f.owner_email IS NULL AND f.created_by IS NOT NULL AND u.name = f.created_by')
    const missing = await impl.query('SELECT id FROM ws_files WHERE share_token IS NULL')
    for (const r of missing.rows) {
      await impl.query('UPDATE ws_files SET share_token = $1 WHERE id = $2', [crypto.randomBytes(18).toString('base64url'), r.id])
    }
  } catch (err) {
    console.error('[schema] 공유 설정 초기화 실패(계속 진행):', err.message)
  }
  // 1회 이관(2026-10-05): 공개 전까지 만들어진 문서·시트·폼은 모두 "운영위원회 및 교수진 / 편집자"로 둔다.
  // 이후 새로 만드는 파일은 "제한됨"(만든 사람만)으로 시작하고, 공유는 각자 공유 버튼으로 정한다.
  try {
    const done = (await impl.query("SELECT 1 FROM handover_settings WHERE key = 'ws_committee_migrated'")).rows[0]
    if (!done) {
      const forms = await impl.query('SELECT f.id, f.title_ko FROM custom_forms f WHERE NOT EXISTS (SELECT 1 FROM ws_files w WHERE w.form_id = f.id)')
      for (const f of forms.rows) {
        await impl.query(
          "INSERT INTO ws_files (kind, title, form_id, general_access, general_role, share_token) VALUES ('form', $1, $2, 'committee', 'editor', $3) ON CONFLICT DO NOTHING",
          [f.title_ko || '제목 없는 설문지', f.id, crypto.randomBytes(18).toString('base64url')]
        )
      }
      const r = await impl.query("UPDATE ws_files SET general_access = 'committee', general_role = 'editor'")
      await impl.query("INSERT INTO handover_settings (key, value, updated_at) VALUES ('ws_committee_migrated', now()::text, now()) ON CONFLICT (key) DO NOTHING")
      console.log(`[schema] 기존 문서·시트·폼 ${r.rowCount}개를 운영위원회 및 교수진 전용으로 이관`)
    }
  } catch (err) {
    console.error('[schema] 운영위원회 전용 이관 실패(계속 진행):', err.message)
  }
}
