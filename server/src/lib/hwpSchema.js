// 한글 파일(kind='hwp') 저장 스키마. 멱등. server/index.js, server/src/index.js 가 시작할 때 부르고,
// 라우트도 첫 요청에서 한 번 부른다(함수가 막 뜬 직후 요청 대비).
import { query } from '../db.js'

const STATEMENTS = [
  // 파일마다 무작위 키(secretBox 로 봉인) + 블록 id 카운터
  `CREATE TABLE IF NOT EXISTS hwp_keys (
     file_id    INTEGER PRIMARY KEY REFERENCES ws_files(id) ON DELETE CASCADE,
     sealed_key TEXT NOT NULL,
     id_counter INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // 암호화된 바이트. 8MB 이하는 data(bytea), 그 이상은 암호문을 Blob 에 두고 blob_url 만 둔다. 같은 내용은 sha256 으로 하나만 둔다.
  `CREATE TABLE IF NOT EXISTS hwp_blobs (
     id         SERIAL PRIMARY KEY,
     file_id    INTEGER NOT NULL REFERENCES ws_files(id) ON DELETE CASCADE,
     sha256     TEXT NOT NULL,
     size       INTEGER NOT NULL,
     data       BYTEA,
     blob_url   TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS hwp_blobs_file_idx ON hwp_blobs (file_id, sha256)',
  `CREATE TABLE IF NOT EXISTS hwp_versions (
     file_id        INTEGER NOT NULL REFERENCES ws_files(id) ON DELETE CASCADE,
     version        INTEGER NOT NULL,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     created_by     TEXT,
     note           TEXT,
     source         TEXT NOT NULL DEFAULT 'user',
     size           INTEGER NOT NULL,
     sha256         TEXT NOT NULL,
     blob_id        INTEGER NOT NULL REFERENCES hwp_blobs(id),
     parent_version INTEGER,
     diff_summary   JSONB,
     block_ids      JSONB,
     id_counter     INTEGER NOT NULL DEFAULT 0,
     page_count     INTEGER,
     starred        BOOLEAN NOT NULL DEFAULT false,
     PRIMARY KEY (file_id, version)
   )`,
]

let ready = null
export function ensureHwpSchema() {
  if (!ready) {
    ready = (async () => {
      for (const s of STATEMENTS) await query(s)
    })().catch((e) => {
      ready = null
      throw e
    })
  }
  return ready
}
export const resetHwpSchemaForTest = () => { ready = null }
