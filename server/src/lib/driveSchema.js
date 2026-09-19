// src/lib/driveSchema.js — Drive 저장소 스키마의 단일 출처 (53_DRIVE_STORAGE)
//
// 같은 DDL을 마이그레이션 스크립트(scripts/migrate-phase53-drive.mjs)와 부팅 self-heal
// (db.js ensureDriveSchema)이 함께 쓴다. 두 곳에 따로 적어두면 배포 DB와 로컬 DB가 어긋난다.
// 전부 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — 비파괴·멱등이다.
export const DRIVE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS google_drive_connections (
     id                SERIAL PRIMARY KEY,
     label             TEXT NOT NULL,
     account_email     TEXT,
     auth_mode         TEXT NOT NULL DEFAULT 'oauth',
     scope             TEXT,
     root_folder_id    TEXT,
     root_folder_name  TEXT,
     refresh_token_enc TEXT,
     script_url        TEXT,
     active            BOOLEAN NOT NULL DEFAULT TRUE,
     last_check_at     TIMESTAMPTZ,
     last_check_ok     BOOLEAN,
     last_error        TEXT DEFAULT '',
     created_by        INTEGER,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // 기존 배포에 이미 테이블이 있으면 컬럼만 더한다(비파괴).
  `ALTER TABLE google_drive_connections ADD COLUMN IF NOT EXISTS script_url TEXT`,
  `CREATE TABLE IF NOT EXISTS google_drive_folder_bindings (
     id            SERIAL PRIMARY KEY,
     connection_id INTEGER NOT NULL REFERENCES google_drive_connections(id) ON DELETE CASCADE,
     path_key      TEXT NOT NULL,
     path_labels   JSONB NOT NULL DEFAULT '[]'::jsonb,
     folder_id     TEXT NOT NULL,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_drive_binding_path
     ON google_drive_folder_bindings (connection_id, path_key)`,
  `CREATE TABLE IF NOT EXISTS form_file_uploads (
     id              SERIAL PRIMARY KEY,
     form_id         INTEGER,
     field_id        TEXT NOT NULL,
     response_id     INTEGER,
     public_user_id  INTEGER,
     submitter_email TEXT,
     idempotency_key TEXT NOT NULL,
     storage         TEXT NOT NULL,
     purpose         TEXT,
     connection_id   INTEGER,
     drive_file_id   TEXT,
     file_url        TEXT,
     folder_id       TEXT,
     original_name   TEXT,
     stored_name     TEXT,
     mime            TEXT,
     bytes           BIGINT,
     status          TEXT NOT NULL DEFAULT 'pending',
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     attached_at     TIMESTAMPTZ
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_form_file_uploads_idem
     ON form_file_uploads (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_form_file_uploads_form
     ON form_file_uploads (form_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_form_file_uploads_url
     ON form_file_uploads (file_url)`,
]
