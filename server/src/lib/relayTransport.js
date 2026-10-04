// relayTransport.js: 연결된 Apps Script 릴레이를 사이트의 "공용 발송과 백업 창구"로 쓴다.
// 릴레이는 위원회가 정한 구글 계정으로 돌아가므로, 계정이 바뀌면 관리 화면에서 연결만 갈아 끼우면 된다.
//   메일: 서버가 릴레이의 sendMail을 부른다(그 계정의 MailApp 하루 한도를 쓴다).
//   백업: 릴레이가 하루 한 번 /relay/backup을 불러 가져간다. 인증은 릴레이와 사이트가 나눠 가진 비밀키다.
import crypto from 'node:crypto'
import { listConnectionRows, getConnectionRow, driveFor } from './driveConnections.js'
import { open } from './secretBox.js'

/** 활성 Apps Script 연결 행(비밀키 포함). 이 밖으로 평문 비밀키를 내보내지 않는다 */
export async function activeRelayRows() {
  const rows = await listConnectionRows()
  const out = []
  for (const r of rows) {
    if (r.active === false || r.auth_mode !== 'apps-script') continue
    const full = await getConnectionRow(r.id)
    if (full) out.push(full)
  }
  return out
}

/** 활성 릴레이 연결들의 평문 비밀키 목록 */
export async function relaySecrets() {
  const rows = await activeRelayRows()
  return rows.map((r) => open(r.refresh_token_enc)).filter(Boolean)
}

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest()

/** 시간차 공격을 피하려고 해시끼리 비교한다 */
export function secretMatches(provided, secrets) {
  if (!provided || !secrets.length) return false
  const p = digest(provided)
  let ok = false
  for (const s of secrets) if (crypto.timingSafeEqual(p, digest(s))) ok = true
  return ok
}

/**
 * 릴레이로 메일 1통을 보낸다. 연결이 없거나 릴레이가 구버전이거나 하루 한도를 다 쓰면 false.
 * 어떤 경우에도 던지지 않는다(접수 응답을 깨뜨리지 않기 위해). 사유는 로그로만 남긴다.
 */
export async function sendViaRelay({ to, subject, text, name = '한림대학교 디지털인문예술전공' }) {
  if (!to) return false
  try {
    const rows = await activeRelayRows()
    if (!rows.length) return false
    const drive = await driveFor(rows[0])
    if (typeof drive.sendMail !== 'function') return false
    const res = await drive.sendMail({ to, subject, body: text, name })
    if (res?.skipped) {
      console.warn(`[mail] 릴레이가 발송을 건너뛰었습니다: ${res.skipped}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[mail] 릴레이 발송 실패:', err.message)
    return false
  }
}
