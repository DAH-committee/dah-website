// DAH API 서버 진입점. 앱 구성은 src/app.js(createApp), DB는 src/db.js. 12_BACKEND.md 참조.
import 'dotenv/config'
import { createApp } from './app.js'
import { isConfigured, ensurePublicAuthSchema, ensureDriveSchema } from './db.js'

const PORT = process.env.PORT || 4000
const app = createApp()

app.listen(PORT, async () => {
  console.log(`[dah-server] listening on :${PORT}`)
  if (!isConfigured()) {
    console.warn('[dah-server] DATABASE_URL 미설정 — /health만 동작합니다. server/.env를 확인하세요.')
    return
  }
  // 41_AUTH_CONTRACT: 공개 로그인 스키마(public_users 등) 부팅 시 멱등 보장 — 재배포로 자가 복구.
  await ensurePublicAuthSchema()
  console.log('[dah-server] public auth 스키마 확인 완료')
  // 53_DRIVE_STORAGE: Drive 연결 프로필·업로드 기록 스키마도 재배포만으로 자가 복구한다.
  await ensureDriveSchema()
  console.log('[dah-server] google drive 저장소 스키마 확인 완료')
})
