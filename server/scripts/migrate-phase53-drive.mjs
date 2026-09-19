// scripts/migrate-phase53-drive.mjs — Google Drive 연결 프로필·폴더 바인딩·업로드 기록 (53_DRIVE_STORAGE)
//
// 추가만 한다(DROP 없음). 기존 폼 설정은 지우지 않고, 파일 질문에 storage가 없을 때만 폼 전역
// Drive 설정을 질문 단위 설정으로 복사한다(호환 계층). 여러 번 실행해도 결과는 같다.
//
// 실행: server/ 안에서 `node scripts/migrate-phase53-drive.mjs`
import 'dotenv/config'
import pg from 'pg'
import { DRIVE_SCHEMA_STATEMENTS } from '../src/lib/driveSchema.js'

if (!process.env.DATABASE_URL) {
  console.error('[migrate-53] DATABASE_URL이 없습니다. server/.env를 확인하세요.')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
})

/** 폼 전역 Drive 설정 → 파일 질문 storage (이미 storage가 있으면 건드리지 않는다) */
function backfillFields(form) {
  const settings = form.settings || {}
  const fields = Array.isArray(form.fields) ? form.fields : []
  if (!settings.drive_enabled) return null
  let changed = false
  const next = fields.map((field) => {
    if (field?.type !== 'file') return field
    if (field.storage && typeof field.storage === 'object') return field
    changed = true
    return {
      ...field,
      storage: {
        target: 'drive',
        purpose: 'original',
        accept: [],
        max_bytes: null,
        connection_id: null,
        path_template: settings.drive_auto_folder === false ? 'root' : 'exhibition_original',
        folder_label: '',
        share_mode: settings.drive_share_mode === 'link' ? 'link' : 'restricted',
      },
    }
  })
  return changed ? next : null
}

async function main() {
  const client = await pool.connect()
  try {
    for (const sql of DRIVE_SCHEMA_STATEMENTS) {
      await client.query(sql)
    }
    console.log('[migrate-53] google_drive_connections / google_drive_folder_bindings / form_file_uploads 확인')

    const { rows } = await client.query('SELECT id, slug, fields, settings FROM custom_forms')
    let touched = 0
    for (const form of rows) {
      const next = backfillFields(form)
      if (!next) continue
      await client.query('UPDATE custom_forms SET fields = $1, updated_at = now() WHERE id = $2', [
        JSON.stringify(next),
        form.id,
      ])
      touched += 1
      console.log(`[migrate-53] 파일 질문 저장소 설정 백필: ${form.slug}`)
    }
    console.log(`[migrate-53] 백필 완료 — 폼 ${touched}건`)
    console.log('[migrate-53] 완료')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[migrate-53] 실패:', err)
  process.exit(1)
})
