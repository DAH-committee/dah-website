// scripts/migrate-exhibit-auto.mjs: 전시회 자동화(원본 보관, WebP, 드라이브 정리, 실시간 시상, 채점기준표). 멱등.
// 실행: server/ 안에서 `node scripts/migrate-exhibit-auto.mjs`. 서버 배포보다 먼저 실행한다.
//
// 1) form_file_uploads: blob_url(원본 보관), web_url·web_meta(전시 사이트용 WebP와 대표색),
//    drive_status·drive_error·drive_url·drive_kind(제출 후 드라이브 복사 상태)
// 2) exhibition_awards: 실시간 시상. 학기마다 과목당 1개, 최우수상 1자리
// 3) exhibition_rubrics: 과목별 채점기준표 시트와 공유 기록
import 'dotenv/config'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

if (!process.env.DATABASE_URL) {
  console.error('[migrate-exhibit-auto] DATABASE_URL이 없습니다.')
  process.exit(1)
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
})

export const STATEMENTS = [
  'ALTER TABLE form_file_uploads ADD COLUMN IF NOT EXISTS blob_url TEXT',
  'ALTER TABLE form_file_uploads ADD COLUMN IF NOT EXISTS web_url TEXT',
  'ALTER TABLE form_file_uploads ADD COLUMN IF NOT EXISTS web_meta JSONB',
  'ALTER TABLE form_file_uploads ADD COLUMN IF NOT EXISTS drive_status TEXT',
  'ALTER TABLE form_file_uploads ADD COLUMN IF NOT EXISTS drive_error TEXT',
  'ALTER TABLE form_file_uploads ADD COLUMN IF NOT EXISTS drive_url TEXT',
  'ALTER TABLE form_file_uploads ADD COLUMN IF NOT EXISTS drive_kind TEXT',
  'CREATE INDEX IF NOT EXISTS idx_form_file_uploads_drive ON form_file_uploads (drive_status) WHERE drive_status IS NOT NULL',
  `CREATE TABLE IF NOT EXISTS exhibition_awards (
     id             SERIAL PRIMARY KEY,
     semester_label TEXT NOT NULL,
     rank           TEXT NOT NULL CHECK (rank IN ('grand','excellence')),
     slot           INTEGER NOT NULL DEFAULT 0,
     entry_id       INTEGER NOT NULL,
     course         TEXT NOT NULL,
     created_by     TEXT,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_exhibition_awards_course ON exhibition_awards (semester_label, course)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_exhibition_awards_slot ON exhibition_awards (semester_label, rank, slot)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_exhibition_awards_entry ON exhibition_awards (semester_label, entry_id)',
  `CREATE TABLE IF NOT EXISTS exhibition_rubrics (
     id             SERIAL PRIMARY KEY,
     semester_label TEXT NOT NULL,
     course         TEXT NOT NULL,
     sheet_id       TEXT,
     sheet_url      TEXT,
     folder_id      TEXT,
     folder_url     TEXT,
     entry_ids      JSONB NOT NULL DEFAULT '[]',
     shared_with    JSONB NOT NULL DEFAULT '[]',
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_exhibition_rubrics_sem ON exhibition_rubrics (semester_label, course)',
]

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const s of STATEMENTS) await client.query(s)
    await client.query('COMMIT')
    console.log('[migrate-exhibit-auto] 완료')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[migrate-exhibit-auto] 실패:', err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}
if (fileURLToPath(import.meta.url) === process.argv[1]) main()
