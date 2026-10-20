// 외부 AI 앱의 도구 호출을 사용자의 "열린 편집기 탭"으로 넘기는 DB 대기열.
//
// 왜 DB인가: 서버가 Vercel 서버리스 함수라 요청마다 다른 인스턴스가 받을 수 있다. 메모리 큐는 쓸 수 없다.
// 흐름:
//   1. 편집기 탭이 열려 있는 동안 10초마다 POST /mcp/relay/presence (파일 id, 탭 id)로 "열려 있음"을 알린다.
//   2. 외부 AI 앱이 도구를 부르면(tools/call) 서버가 mcp_jobs 에 작업을 넣고 최대 약 50초 기다린다.
//   3. 탭이 GET /mcp/relay/jobs (최대 25초 롱폴)로 작업을 가져가 AI 창과 같은 도구 목록으로 실행하고
//      POST /mcp/relay/jobs/:id/result 로 결과를 돌려준다. 서버가 그 결과를 AI 앱에 돌려준다.
// 탭이 없으면 즉시 오류("열린 편집기 탭이 없습니다")로 끝낸다. 탭이 작업을 가져간 뒤 사라지면 대기 시간이 끝나는 때 오류가 된다.
import { query } from '../db.js'

export const PRESENCE_TTL_SEC = 60
export const JOB_WAIT_MS = Number(process.env.MCP_RELAY_WAIT_MS) || 50_000
export const JOB_FRESH_SEC = 120 // 이보다 오래 가져가지 않은 작업은 버린다
export const ACTIVE_WINDOW_SEC = 600 // 최근 10분 안에 AI 앱이 부른 연결이 있으면 탭이 롱폴을 한다
const MAX_RESULT_BYTES = 900_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lower = (e) => String(e || '').trim().toLowerCase()

export async function touchPresence(emails, fileId, tabId, kind, canEdit) {
  for (const e of emails.map(lower).slice(0, 3)) {
    await query(
      `INSERT INTO mcp_presence (user_email, file_id, tab_id, kind, can_edit, seen_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_email, file_id, tab_id) DO UPDATE SET seen_at = now(), kind = EXCLUDED.kind, can_edit = EXCLUDED.can_edit`,
      [e, fileId, String(tabId).slice(0, 64), kind, Boolean(canEdit)]
    )
  }
  if (Math.random() < 0.05) query("DELETE FROM mcp_presence WHERE seen_at < now() - interval '1 day'").catch(() => {})
}

export async function dropPresence(emails, fileId, tabId = null) {
  await query('DELETE FROM mcp_presence WHERE user_email = ANY($1::text[]) AND file_id = $2 AND ($3::text IS NULL OR tab_id = $3)', [emails.map(lower), fileId, tabId])
}

/** 이 사용자가 이 파일을 열어 둔 탭이 있는가(최근 TTL 안에 신호가 있는 탭) */
export async function presenceOf(email, fileId) {
  const { rows } = await query(
    `SELECT count(*)::int AS tabs, coalesce(bool_or(can_edit), false) AS can_edit
       FROM mcp_presence WHERE user_email = $1 AND file_id = $2 AND seen_at > now() - ($3 || ' seconds')::interval`,
    [lower(email), fileId, String(PRESENCE_TTL_SEC)]
  )
  return { open: rows[0].tabs > 0, tabs: rows[0].tabs, canEdit: rows[0].can_edit }
}

/** 탭이 롱폴을 계속해야 하는가: 최근에 AI 앱이 이 사용자의 연결로 호출했거나, 대기 중인 작업이 있다 */
export async function relayActive(emails, fileId) {
  const em = emails.map(lower)
  const s = await query(
    `SELECT 1 FROM mcp_sessions WHERE lower(user_email) = ANY($1::text[]) AND revoked_at IS NULL AND last_used_at > now() - ($2 || ' seconds')::interval LIMIT 1`,
    [em, String(ACTIVE_WINDOW_SEC)]
  )
  if (s.rows[0]) return true
  const j = await query("SELECT 1 FROM mcp_jobs WHERE user_email = ANY($1::text[]) AND file_id = $2 AND status = 'pending' LIMIT 1", [em, fileId])
  return Boolean(j.rows[0])
}

/** 탭이 작업 하나를 가져간다(여러 탭이 동시에 물어도 한 작업은 한 탭만 받는다) */
export async function claimJob(emails, fileId) {
  const { rows } = await query(
    `UPDATE mcp_jobs SET status = 'picked', picked_at = now()
      WHERE id = (SELECT id FROM mcp_jobs
                   WHERE file_id = $2 AND user_email = ANY($1::text[]) AND status = 'pending' AND created_at > now() - ($3 || ' seconds')::interval
                   ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, tool, args`,
    [emails.map(lower), fileId, String(JOB_FRESH_SEC)]
  )
  return rows[0] || null
}

/** 탭이 결과를 돌려준다. 가져간 사용자의 작업만 완료할 수 있다 */
export async function completeJob(emails, id, payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const out = {
    ok: body.ok !== false,
    summary: typeof body.summary === 'string' ? body.summary.slice(0, 2000) : '',
    result: body.result === undefined ? null : body.result,
    error: typeof body.error === 'string' ? body.error.slice(0, 2000) : undefined,
  }
  let json = JSON.stringify(out)
  if (json.length > MAX_RESULT_BYTES) {
    out.result = { truncated: true, note: '결과가 너무 커서 잘랐습니다. 범위를 좁혀 다시 부르세요.' }
    json = JSON.stringify(out)
  }
  const { rowCount } = await query(
    `UPDATE mcp_jobs SET status = $3, result = $4::jsonb, done_at = now() WHERE id = $1 AND user_email = ANY($2::text[]) AND status = 'picked'`,
    [id, emails.map(lower), out.ok ? 'done' : 'failed', json]
  )
  return rowCount > 0
}

/** 사용자가 탭에서 "끊기"를 눌렀다: 기다리던 작업을 모두 실패 처리하고 신호를 지운다 */
export async function cancelPending(emails, fileId, why) {
  await query(
    `UPDATE mcp_jobs SET status = 'failed', done_at = now(), result = $3::jsonb WHERE file_id = $2 AND user_email = ANY($1::text[]) AND status IN ('pending', 'picked')`,
    [emails.map(lower), fileId, JSON.stringify({ ok: false, error: why })]
  )
}

/**
 * 작업을 넣고 결과를 기다린다. 반환:
 *   { ok:true, summary, result } | { ok:false, error } | { timeout:true, picked:boolean }
 */
export async function enqueueAndWait({ email, fileId, tool, args, sessionId, waitMs = JOB_WAIT_MS }) {
  const ins = await query(
    `INSERT INTO mcp_jobs (user_email, file_id, tool, args, session_id) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [lower(email), fileId, tool, JSON.stringify(args || {}), sessionId || null]
  )
  const id = ins.rows[0].id
  const deadline = Date.now() + waitMs
  let n = 0
  while (Date.now() < deadline) {
    const { rows } = await query('SELECT status, result FROM mcp_jobs WHERE id = $1', [id])
    const r = rows[0]
    if (r && (r.status === 'done' || r.status === 'failed')) {
      const res = r.result || {}
      return res.ok === false || r.status === 'failed' ? { ok: false, error: res.error || '편집기에서 실행하지 못했습니다' } : { ok: true, summary: res.summary || '', result: res.result }
    }
    await sleep(n++ < 6 ? 150 : 350)
  }
  const { rows } = await query("UPDATE mcp_jobs SET status = 'expired', done_at = now() WHERE id = $1 AND status IN ('pending', 'picked') RETURNING picked_at", [id])
  return { timeout: true, picked: Boolean(rows[0]?.picked_at) }
}
