// 운영위원회 인수인계 문서 시드.
// 사용: node scripts/seed-handover.mjs            (문서가 없을 때만 생성, 비파괴)
//       node scripts/seed-handover.mjs --replace  (2026 시드 문서 본문·시드 댓글 교체, 사용자 댓글 유지)
// 비밀값 원문은 scripts/handover/secrets.local.json (gitignore)에서만 읽는다.
// 열람 비밀번호는 HANDOVER_GATE_PASSWORD 환경변수 또는 secrets.local.json의 gate 값으로 처음 한 번만 설정.
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import pg from 'pg'
import { HANDOVER_SCHEMA_STATEMENTS } from '../src/db.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, 'handover')
const replace = process.argv.includes('--replace')
const TITLE = '2026 운영위원회 인수인계 문서'
const SEED_AUTHOR = '주현호'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = (t, p) => pool.query(t, p)

const secretsPath = path.join(dir, 'secrets.local.json')
const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf8')) : {}
const LABELS = { 'gmail-pw': '공식 Gmail 비밀번호', 'insta-pw': '인스타그램 비밀번호' }

for (const sql of HANDOVER_SCHEMA_STATEMENTS) await q(sql)

// 열람 비밀번호: 없을 때만
const gate = process.env.HANDOVER_GATE_PASSWORD || secrets.gate
const { rows: g } = await q("SELECT 1 FROM handover_settings WHERE key = 'gate_hash'")
if (!g.length && gate) {
  await q("INSERT INTO handover_settings (key, value) VALUES ('gate_hash', $1)", [await bcrypt.hash(gate, 10)])
  console.log('gate password set')
}

// 비밀값: 키별로 한 번만 생성, 이미 있으면 값 유지
const secretIds = {}
for (const key of Object.keys(LABELS)) {
  const { rows } = await q('SELECT value FROM handover_settings WHERE key = $1', [`secret:${key}`])
  if (rows[0]) {
    secretIds[key] = Number(rows[0].value)
    continue
  }
  const value = secrets[key] || '미입력'
  const ins = await q('INSERT INTO handover_secrets (label, value, updated_by) VALUES ($1, $2, $3) RETURNING id', [LABELS[key], value, SEED_AUTHOR])
  secretIds[key] = ins.rows[0].id
  await q('INSERT INTO handover_settings (key, value) VALUES ($1, $2)', [`secret:${key}`, String(ins.rows[0].id)])
  console.log('secret created', key)
}

let html = fs.readFileSync(path.join(dir, 'handover-2026.html'), 'utf8')
html = html.replace(/data-secret="([a-z-]+)"/g, (m, key) => `data-secret-id="${secretIds[key] ?? ''}"`)

const { rows: existing } = await q('SELECT id FROM handover_docs WHERE title = $1 ORDER BY id LIMIT 1', [TITLE])
let docId = existing[0]?.id
if (!docId) {
  const ins = await q('INSERT INTO handover_docs (title, content_html, sort, updated_by) VALUES ($1, $2, 0, $3) RETURNING id', [TITLE, html, SEED_AUTHOR])
  docId = ins.rows[0].id
  console.log('doc created', docId)
} else if (replace) {
  await q('UPDATE handover_docs SET content_html = $1, content = NULL, updated_at = now(), updated_by = $2 WHERE id = $3', [html, SEED_AUTHOR, docId])
  console.log('doc replaced', docId)
} else {
  console.log('doc exists, skip content', docId)
}

const comments = JSON.parse(fs.readFileSync(path.join(dir, 'handover-2026.comments.json'), 'utf8'))
const { rows: seeded } = await q("SELECT COUNT(*)::int AS n FROM handover_comments WHERE doc_id = $1 AND author_id IS NULL", [docId])
if (seeded[0].n === 0 || replace) {
  if (replace) await q('DELETE FROM handover_comments WHERE doc_id = $1 AND author_id IS NULL', [docId])
  let i = 0
  for (const c of comments) {
    await q(
      `INSERT INTO handover_comments (doc_id, anchor_id, side, body, images, author, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, now() + ($7 || ' seconds')::interval)`,
      [docId, c.anchor, c.side, c.body, JSON.stringify(c.images.map((url) => ({ url, caption: '' }))), SEED_AUTHOR, String(i++)]
    )
  }
  console.log('comments seeded', comments.length)
}

await pool.end()
