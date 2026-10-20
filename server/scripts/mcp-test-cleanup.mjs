// MCP 시험이 중간에 끊겼을 때 남은 시험용 행을 지운다: node scripts/mcp-test-cleanup.mjs
// 지우는 대상: 이메일이 @mcp-test.invalid 인 계정과 그 연결·토큰·작업, 제목이 "[mcp-test]" 또는 "[mcp-smoke]" 로 시작하는 파일,
//   이름이 mcp-smoke 인 연결(scripts/mcp-smoke.mjs 가 만든 것)
import 'dotenv/config'
import { query } from '../src/db.js'
const smokeClients = (await query("SELECT client_id FROM mcp_clients WHERE client_name = 'mcp-smoke'")).rows.map((r) => r.client_id)
const smokeSessions = (await query('SELECT id, user_email FROM mcp_sessions WHERE client_id = ANY($1)', [smokeClients])).rows
const smokeEmails = [...new Set(smokeSessions.map((r) => r.user_email))]
const users = (await query("SELECT id, email FROM public_users WHERE email LIKE '%@mcp-test.invalid'")).rows
const emails = users.map((u) => u.email)
const files = (await query("SELECT id, form_id FROM ws_files WHERE title LIKE '[mcp-test]%' OR title LIKE '[mcp-smoke]%' OR lower(owner_email) LIKE '%@mcp-test.invalid'")).rows
const ids = files.map((f) => f.id)
const sids = smokeSessions.map((r) => r.id)
const run = async (label, sql, p) => { const r = await query(sql, p); if (r.rowCount) console.log(label, r.rowCount) }
await run('smoke audit', 'DELETE FROM mcp_audit WHERE client_id = ANY($1)', [smokeClients])
await run('smoke rate', 'DELETE FROM mcp_rate WHERE session_id = ANY($1)', [sids])
await run('smoke access', 'DELETE FROM mcp_access_tokens WHERE session_id = ANY($1)', [sids])
await run('smoke refresh', 'DELETE FROM mcp_refresh_tokens WHERE session_id = ANY($1)', [sids])
await run('smoke sessions', 'DELETE FROM mcp_sessions WHERE id = ANY($1)', [sids])
await run('smoke codes', 'DELETE FROM mcp_codes WHERE client_id = ANY($1)', [smokeClients])
await run('smoke grants', 'DELETE FROM mcp_grants WHERE client_id = ANY($1)', [smokeClients])
await run('smoke clients', 'DELETE FROM mcp_clients WHERE client_id = ANY($1)', [smokeClients])
void smokeEmails
await run('jobs', 'DELETE FROM mcp_jobs WHERE user_email = ANY($1) OR file_id = ANY($2)', [emails, ids])
await run('presence', "DELETE FROM mcp_presence WHERE user_email = ANY($1) OR file_id = ANY($2) OR seen_at < now() - interval '10 minutes'", [emails, ids])
await run('audit', 'DELETE FROM mcp_audit WHERE user_email = ANY($1)', [emails])
await run('rate', 'DELETE FROM mcp_rate WHERE session_id IN (SELECT id FROM mcp_sessions WHERE user_email = ANY($1))', [emails])
await run('access', 'DELETE FROM mcp_access_tokens WHERE session_id IN (SELECT id FROM mcp_sessions WHERE user_email = ANY($1))', [emails])
await run('refresh', 'DELETE FROM mcp_refresh_tokens WHERE session_id IN (SELECT id FROM mcp_sessions WHERE user_email = ANY($1))', [emails])
const cids = (await query('SELECT DISTINCT client_id FROM mcp_sessions WHERE user_email = ANY($1)', [emails])).rows.map((r) => r.client_id)
await run('sessions', 'DELETE FROM mcp_sessions WHERE user_email = ANY($1)', [emails])
await run('codes', 'DELETE FROM mcp_codes WHERE user_email = ANY($1)', [emails])
await run('grants', 'DELETE FROM mcp_grants WHERE user_email = ANY($1)', [emails])
await run('clients(session)', 'DELETE FROM mcp_clients WHERE client_id = ANY($1)', [cids])
await run('clients(test)', "DELETE FROM mcp_clients WHERE client_name IN ('시험 앱', 'script x /script 시험 앱', '시험 CIMD 앱') OR client_id LIKE 'https://cimd.mcp-test.example/%'")
await run('forms', 'DELETE FROM custom_forms WHERE id = ANY($1)', [files.map((f) => f.form_id).filter(Boolean)])
await run('docs', 'DELETE FROM handover_docs WHERE ws_id = ANY($1)', [ids])
await run('shares', 'DELETE FROM ws_shares WHERE ws_id = ANY($1)', [ids])
await run('recent', 'DELETE FROM ws_recent WHERE ws_id = ANY($1)', [ids])
await run('files', 'DELETE FROM ws_files WHERE id = ANY($1)', [ids])
await run('users', 'DELETE FROM public_users WHERE id = ANY($1)', [users.map((u) => u.id)])
console.log('정리 완료')
process.exit(0)
