// Vercel 진입점(Express 무설정 배포). Vercel은 이 파일이 내보내는 app을 하나의 함수로 실행한다.
// 로컬·다른 서버에서는 src/index.js(app.listen)를 쓴다.
import 'dotenv/config'
import express from 'express'
import { createApp } from './src/app.js'
import { ensureHwpSchema } from './src/lib/hwpSchema.js'
import { isConfigured, ensurePublicAuthSchema, ensureDriveSchema, ensureSheetStateSchema, ensureHandoverSchema } from './src/db.js'
import { ensureMcpSchema } from './src/lib/mcpSchema.js'

// 같은 주소의 /api 아래로 들어오므로 앞의 /api를 떼고 기존 경로(/auth, /workspace ...)로 넘긴다
const inner = createApp()
const app = express()
app.use('/api', inner)
app.use(inner)

// 함수가 처음 뜰 때 한 번만 스키마를 확인한다(멱등, 이미 있으면 아무 일도 안 함). 요청은 기다리지 않는다.
if (isConfigured()) {
  Promise.resolve()
    .then(ensurePublicAuthSchema)
    .then(ensureDriveSchema)
    .then(ensureSheetStateSchema)
    .then(ensureHandoverSchema)
    .then(ensureHwpSchema)
    .then(ensureMcpSchema)
    .catch((err) => console.error('[schema] 확인 실패(계속 진행):', err.message))
}

export default app
