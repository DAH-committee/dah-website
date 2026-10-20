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

import { EXHIBIT_AUTO_SCHEMA as STATEMENTS } from '../src/lib/exhibitionPipeline.js'

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
