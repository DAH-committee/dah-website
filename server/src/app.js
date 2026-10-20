// src/app.js — Express 앱 팩토리 (테스트 주입: createApp({ db: mock }))
// 라우트 구성은 12_BACKEND.md 8절 API 계약. DATABASE_URL 미설정 시 /health(및 로컬 업로드 정적
// 서빙)만 동작하고 나머지는 명확한 JSON 에러(완료 조건).
import express from 'express'
import exhibitionSiteRouter from './routes/exhibitionSite.js'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { isConfigured, setDb } from './db.js'
import authRoutes from './routes/auth.js'
import googleAuthRoutes from './routes/googleAuth.js'
import contentRoutes from './routes/content.js'
import handoverRoutes from './routes/handover.js'
import workspaceRoutes from './routes/workspace.js'
import boardsRoutes from './routes/boards.js'
import integrationsRoutes from './routes/integrations.js'
import aiRoutes from './routes/ai.js'
import slidesRoutes from './routes/slides.js'
import adminRoutes from './routes/admin.js'
import uploadRoutes, { UPLOADS_DIR, MAX_UPLOAD_BYTES } from './routes/upload.js'
import blobClientRoutes from './routes/blobClient.js'
import submitRoutes from './routes/submit.js'
import settingsRoutes from './routes/settings.js'
import exportRoutes from './routes/export.js'
import adminExtraRoutes from './routes/adminExtra.js'
import sheetsRoutes from './routes/sheets.js'
import relayRoutes from './routes/relay.js'
import tagsRoutes from './routes/tags.js'
import consultRoutes from './routes/consult.js'
import offeringsRoutes from './routes/offerings.js'
import formsRoutes from './routes/forms.js'
import driveAdminRoutes from './routes/driveAdmin.js'
import easterEggRoutes from './routes/easterEgg.js'
import hwpxRoutes from './routes/hwpx.js'
import hwpFilesRoutes from './routes/hwpFiles.js'
import mcpRoutes from './routes/mcp.js'

export function createApp(options = {}) {
  if ('db' in options) setDb(options.db)

  const app = express()
  // 접속 경로: 브라우저 → Vercel(/api 전달) → Render 입구 → 이 서버. 프록시가 두 겹이라 2로 두어야 rate limit이 실제 접속자 IP를 본다
  // (1이면 모든 접속자가 Vercel의 IP 하나로 보여 접수 한도를 서로 나눠 쓰게 된다).
  app.set('trust proxy', 2)
  app.use(mcpRoutes) // MCP 커넥터(/mcp, /.well-known/oauth-*): 자체 CORS·본문 해석을 쓰므로 전역 설정보다 앞에 둔다. 다른 경로는 그냥 지나간다

  // 학기별 전시회 사이트(다른 도메인)용 API. 전역 CORS 화이트리스트보다 먼저 붙인다(자체 CORS, Bearer 토큰)
  app.use('/exhibition-site', exhibitionSiteRouter)

  // CORS: 프론트 도메인 화이트리스트 + 쿠키 자격증명 (httpOnly 인증 쿠키)
  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN?.split(',').map((s) => s.trim()) || true,
      credentials: true,
    })
  )
  app.use(express.json({ limit: '4.5mb' })) // Vercel 요청 본문 한도(4.5MB)와 맞춤: 큰 보드·발표 저장
  app.use(cookieParser())

  // 슬립 방지 헬스체크 (UptimeRobot 5분 간격 GET). DB 없이도 200
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'dah-server', uptime: process.uptime(), db: isConfigured() })
  })

  // Blob 토큰 없는 개발 환경의 로컬 업로드 산출물 서빙
  app.use('/uploads', express.static(UPLOADS_DIR))

  // DATABASE_URL 가드: /health 외 전 엔드포인트 (12_BACKEND 완료 조건)
  app.use((req, res, next) => {
    if (isConfigured()) return next()
    res.status(503).json({
      error: 'DATABASE_URL not configured',
      hint: 'server/.env에 DATABASE_URL(Neon Postgres)을 설정하고 scripts/schema.sql 적용 후 재기동하세요. DB 없이 동작하는 경로는 /health 뿐입니다.',
    })
  })

  app.use('/auth', authRoutes)
  // 공개 제출자 구글 로그인 (41_AUTH_CONTRACT). 스태프 라우트와 하위 경로가 겹치지 않는다.
  // authRoutes: /login, /setup-password, /logout, /me. 아래는 /google/*, /public/* 뿐이다.
  app.use('/auth', googleAuthRoutes)
  app.use('/content', contentRoutes)
  app.use('/admin/content', adminRoutes)
  app.use('/upload', uploadRoutes)
  app.use(blobClientRoutes) // POST /blob/client-token: 4MB 넘는 파일을 브라우저가 Blob으로 바로 올리는 서명 주소
  app.use('/submit', submitRoutes)
  app.use(settingsRoutes) // GET /settings/public, PUT /admin/settings
  app.use(exportRoutes) // GET /export/all
  app.use(adminExtraRoutes) // /admin/users, /admin/exhibition/entries (13_CMS 6절)
  app.use(relayRoutes) // 릴레이(Apps Script)가 가져가는 백업, 비밀키 인증
  app.use(sheetsRoutes) // 관리자 시트: 접수 칸 편집, 화면 상태, 구글 시트로 내보내기
  app.use(tagsRoutes) // GET /tags, POST /admin/tags, DELETE /admin/tags/:name (Phase 9 K1-1)
  app.use(consultRoutes) // POST /consult, GET /admin/consultations (Phase 9 K1-9)
  app.use(offeringsRoutes) // GET /offerings, /offerings/semesters, /admin/offerings (H3-3)
  app.use(formsRoutes) // 39_FORM_BUILDER: /forms/:slug, /admin/forms
  app.use(driveAdminRoutes) // 53_DRIVE_STORAGE: /admin/drive/*, /auth/google/drive/callback
  app.use(workspaceRoutes) // 작업공간 허브: 문서·시트 파일 목록, 템플릿, 시트 내용
  app.use(boardsRoutes) // DAH Board: /workspace/boards/:id 보드 내용 읽기·저장
  app.use(integrationsRoutes) // 연동: 링크 미리보기(unfurl), 피그마·노션 개인 토큰 연결과 가져오기
  app.use(aiRoutes) // AI 창: /ai/providers, /ai/connections, /ai/models, /ai/chat(SSE). 사용자 개인 API 키 방식 (계약은 client/src/components/ai/README.md)
  app.use(slidesRoutes) // DAH Slides: /workspace/slides/:id 발표 내용 읽기·저장
  app.use(handoverRoutes) // 운영위원회 인수인계 문서: 열람 비밀번호, 문서, 여백 댓글, 비밀값
  app.use(hwpxRoutes) // 한글(HWPX): /hwpx/generate, /hwpx/preview, /hwpx/parse, /hwpx/lint (계약은 routes/hwpx.js 머리말)
  app.use(hwpFilesRoutes) // 한글 파일(kind=hwp): /hwp/files/* 올리기·그리기·편집·버전 (계약은 routes/hwpFiles.README.md)
  app.use(easterEggRoutes) // 주현호 이스터에그: 공개 발견 기록 + 본인 owner 전용 관리

  app.use((req, res) => res.status(404).json({ error: 'not found' }))

  // 공통 에러 핸들러 — 항상 JSON
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'DB_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'DATABASE_URL not configured',
        hint: 'server/.env에 DATABASE_URL을 설정하세요.',
      })
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'file too large', maxBytes: MAX_UPLOAD_BYTES })
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' })
    }
    if (err.status && err.status < 500) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('[dah-server] unhandled error:', err)
    res.status(500).json({ error: 'internal server error' })
  })

  return app
}
