// MCP 커넥터(사용자의 AI 앱이 우리 서비스에 연결) 전용 테이블. db.js 는 건드리지 않고 이 파일이 멱등으로 만든다.
// 서버 시작 때 server/index.js, server/src/index.js 가 ensureMcpSchema() 를 부른다(이미 있으면 아무 일도 안 한다).
// 비밀값은 한 줄도 평문으로 두지 않는다: 코드·토큰은 SHA-256 해시만, 클라이언트 비밀번호는 아예 발급하지 않는다(공개 클라이언트 + PKCE).
import { query, isConfigured } from '../db.js'

export const MCP_SCHEMA_STATEMENTS = [
  // OAuth 클라이언트(동적 등록 RFC 7591, 또는 Client ID Metadata Document 로 가져온 것)
  `CREATE TABLE IF NOT EXISTS mcp_clients (
     client_id     TEXT PRIMARY KEY,
     kind          TEXT NOT NULL DEFAULT 'dcr',
     client_name   TEXT NOT NULL DEFAULT '',
     client_uri    TEXT,
     redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_used_at  TIMESTAMPTZ
   )`,
  // 인가 코드: 60초, 한 번만. 코드 자체는 저장하지 않고 해시만 둔다
  `CREATE TABLE IF NOT EXISTS mcp_codes (
     code_hash      TEXT PRIMARY KEY,
     client_id      TEXT NOT NULL,
     user_kind      TEXT NOT NULL,
     user_id        INTEGER,
     user_email     TEXT NOT NULL,
     user_name      TEXT,
     redirect_uri   TEXT NOT NULL,
     code_challenge TEXT NOT NULL,
     scope          TEXT NOT NULL,
     resource       TEXT NOT NULL,
     expires_at     TIMESTAMPTZ NOT NULL,
     used_at        TIMESTAMPTZ,
     session_id     TEXT
   )`,
  // 연결(= 사용자가 한 번 허용한 앱 하나). 해제하면 revoked_at 이 찍히고 그 연결의 모든 토큰이 죽는다
  `CREATE TABLE IF NOT EXISTS mcp_sessions (
     id            TEXT PRIMARY KEY,
     client_id     TEXT NOT NULL,
     user_kind     TEXT NOT NULL,
     user_id       INTEGER,
     user_email    TEXT NOT NULL,
     user_name     TEXT,
     scope         TEXT NOT NULL,
     resource      TEXT NOT NULL,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_used_at  TIMESTAMPTZ,
     revoked_at    TIMESTAMPTZ,
     revoked_why   TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS mcp_sessions_user_idx ON mcp_sessions (lower(user_email)) WHERE revoked_at IS NULL',
  // 액세스 토큰(짧게, 해시만)과 리프레시 토큰(회전: 한 번 쓰면 used_at, 다시 쓰이면 재사용 감지로 연결 전체 폐기)
  `CREATE TABLE IF NOT EXISTS mcp_access_tokens (
     token_hash TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     expires_at TIMESTAMPTZ NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS mcp_access_session_idx ON mcp_access_tokens (session_id)',
  `CREATE TABLE IF NOT EXISTS mcp_refresh_tokens (
     token_hash TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     expires_at TIMESTAMPTZ NOT NULL,
     used_at    TIMESTAMPTZ
   )`,
  'CREATE INDEX IF NOT EXISTS mcp_refresh_session_idx ON mcp_refresh_tokens (session_id)',
  // 이미 허용한 (사용자, 앱) 조합: 다음 연결 때 동의 화면을 건너뛴다
  `CREATE TABLE IF NOT EXISTS mcp_grants (
     user_email TEXT NOT NULL,
     client_id  TEXT NOT NULL,
     scope      TEXT NOT NULL,
     granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (user_email, client_id)
   )`,
  // 외부 AI 앱의 도구 호출을 열린 편집기 탭으로 넘기는 대기열(서버리스라 메모리 대신 DB)
  `CREATE TABLE IF NOT EXISTS mcp_jobs (
     id         BIGSERIAL PRIMARY KEY,
     user_email TEXT NOT NULL,
     file_id    INTEGER NOT NULL,
     tool       TEXT NOT NULL,
     args       JSONB NOT NULL DEFAULT '{}'::jsonb,
     status     TEXT NOT NULL DEFAULT 'pending',
     result     JSONB,
     session_id TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     picked_at  TIMESTAMPTZ,
     done_at    TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS mcp_jobs_pending_idx ON mcp_jobs (file_id, id) WHERE status = 'pending'`,
  // 편집기 탭이 열려 있다는 신호(10초마다 갱신)
  `CREATE TABLE IF NOT EXISTS mcp_presence (
     user_email TEXT NOT NULL,
     file_id    INTEGER NOT NULL,
     tab_id     TEXT NOT NULL,
     kind       TEXT NOT NULL,
     can_edit   BOOLEAN NOT NULL DEFAULT false,
     seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (user_email, file_id, tab_id)
   )`,
  // 감사 기록: 누가, 어떤 도구를, 어느 파일에, 언제, 성공했는지. 문서 내용·인자는 남기지 않는다
  `CREATE TABLE IF NOT EXISTS mcp_audit (
     id         BIGSERIAL PRIMARY KEY,
     at         TIMESTAMPTZ NOT NULL DEFAULT now(),
     user_email TEXT NOT NULL,
     client_id  TEXT,
     session_id TEXT,
     tool       TEXT NOT NULL,
     file_id    INTEGER,
     ok         BOOLEAN NOT NULL,
     code       TEXT,
     ms         INTEGER
   )`,
  'CREATE INDEX IF NOT EXISTS mcp_audit_user_idx ON mcp_audit (lower(user_email), at DESC)',
  // 토큰당 분당 호출 한도(서버리스라 DB로 센다): 분 단위 칸 하나에 +1
  `CREATE TABLE IF NOT EXISTS mcp_rate (
     session_id TEXT NOT NULL,
     minute     BIGINT NOT NULL,
     n          INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (session_id, minute)
   )`,
]

let ensured = null

/** 멱등. 문장마다 독립 try라 한 문장이 실패해도 나머지는 진행하고, 서버 기동은 막지 않는다 */
export async function ensureMcpSchema() {
  if (!isConfigured()) return
  for (const sql of MCP_SCHEMA_STATEMENTS) {
    try {
      await query(sql)
    } catch (err) {
      console.error('[mcp-schema] 문장 실패(계속 진행):', err.message)
    }
  }
}

/** 요청 경로에서 한 번만 보장한다(콜드 스타트에서 부팅 확인이 아직 끝나지 않았을 때를 대비) */
export function ensureMcpSchemaOnce() {
  if (!ensured) ensured = ensureMcpSchema().catch((e) => { ensured = null; throw e })
  return ensured
}
