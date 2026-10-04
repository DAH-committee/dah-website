// src/routes/relay.js: 릴레이(Apps Script)가 가져가는 백업 자료.
//   GET /relay/backup   헤더 X-Relay-Secret이 활성 릴레이 연결의 비밀키와 같을 때만 응답한다.
// 개인정보가 들어 있으므로 비밀키가 없거나 틀리면 존재 여부도 알려주지 않고 404로 돌려보낸다.
import { Router } from 'express'
import { query } from '../db.js'
import { wrap } from './content.js'
import { relaySecrets, secretMatches } from '../lib/relayTransport.js'
import { buildBackup } from '../lib/backupTables.js'

const router = Router()

router.get(
  '/relay/backup',
  wrap(async (req, res) => {
    const secrets = await relaySecrets()
    if (!secretMatches(req.get('x-relay-secret'), secrets)) return res.status(404).json({ error: 'not found' })
    const { rows: entries } = await query(
      `SELECT id, semester_label, entry_type, fields, email, created_at, updated_at FROM exhibition_entries ORDER BY id ASC`
    )
    const { rows: forms } = await query('SELECT id, slug, title_ko, fields FROM custom_forms ORDER BY id ASC')
    const withResponses = []
    for (const form of forms) {
      const { rows } = await query(
        `SELECT id, data, google_email, submitted_at, updated_at FROM custom_form_responses WHERE form_id = $1 ORDER BY id ASC`,
        [form.id]
      )
      withResponses.push({ form, responses: rows })
    }
    res.json(buildBackup({ entries, forms: withResponses }))
  })
)

export default router
