// 한글 파일 저장: 암호화 + 버전. 모든 SQL 은 이 파일 안에 있다(시험은 /*hwp:이름*/ 표지로 가짜 DB 를 붙인다).
import crypto from 'node:crypto'
import { query } from '../../db.js'
import { newFileKey, openFileKey, encryptBytes, decryptBytes, sha256 } from './crypto.js'
import { ensureHwpSchema } from '../hwpSchema.js'
import { HwpError } from './kordoc.js'

export const INLINE_MAX = 8 * 1024 * 1024
export const MAX_VERSIONS = 50

// Vercel Blob(공개 저장소)에는 암호문만 둔다. 시험에서는 어댑터를 바꿔 끼운다.
let blobAdapter = null
export function setBlobAdapter(a) { blobAdapter = a }
async function adapter() {
  if (blobAdapter) return blobAdapter
  const up = await import('../../routes/upload.js')
  if (!up.blobEnabled()) return null
  return {
    async put(pathname, body, req) {
      const { put } = await import('@vercel/blob')
      const r = await put(pathname, body, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: false, allowOverwrite: true, ...up.blobAuth(req) })
      return r.url
    },
    async get(url) {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`blob ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    },
    async del(url, req) {
      const { del } = await import('@vercel/blob')
      await del(url, up.blobAuth(req))
    },
  }
}

const lower = (v) => String(v || '').trim().toLowerCase()

export async function createFileRow({ title, ownerEmail, createdBy, shareToken, team, content }) {
  await ensureHwpSchema()
  const access = team ? 'team' : 'restricted'
  const role = team ? 'editor' : 'viewer'
  const { rows } = await query(
    `/*hwp:createFile*/ INSERT INTO ws_files (kind, title, template, content, created_by, owner_email, share_token, team_id, general_access, general_role)
     VALUES ('hwp', $1, 'upload', $2::jsonb, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [title, JSON.stringify(content), createdBy, lower(ownerEmail), shareToken, team, access, role]
  )
  return rows[0]
}

async function fileKey(fileId, { create = false } = {}) {
  const { rows } = await query('/*hwp:getKey*/ SELECT sealed_key, id_counter FROM hwp_keys WHERE file_id = $1', [fileId])
  if (rows[0]) {
    const key = openFileKey(rows[0].sealed_key)
    if (!key) throw new HwpError('STORAGE', '파일 암호 키를 열 수 없습니다. 서버 암호화 키(DRIVE_TOKEN_ENC_KEY)가 바뀌었는지 확인하세요.', 503)
    return { key, counter: rows[0].id_counter }
  }
  if (!create) throw new HwpError('NOT_FOUND', '파일 키를 찾을 수 없습니다.', 404)
  const k = newFileKey()
  if (!k.sealed) throw new HwpError('STORAGE', '서버 암호화 키(DRIVE_TOKEN_ENC_KEY)가 설정되지 않았습니다.', 503)
  await query('/*hwp:insertKey*/ INSERT INTO hwp_keys (file_id, sealed_key) VALUES ($1, $2)', [fileId, k.sealed])
  return { key: k.raw, counter: 0 }
}

async function putBlob(fileId, key, bytes, req) {
  const sha = sha256(bytes)
  const dup = await query('/*hwp:findBlob*/ SELECT id FROM hwp_blobs WHERE file_id = $1 AND sha256 = $2 LIMIT 1', [fileId, sha])
  if (dup.rows[0]) return { blobId: dup.rows[0].id, sha, size: bytes.length }
  const enc = encryptBytes(key, Buffer.from(bytes))
  let data = null, url = null
  if (enc.length > INLINE_MAX) {
    const a = await adapter()
    if (!a) throw new HwpError('STORAGE', '파일 저장소가 연결되어 있지 않아 8MB 넘는 파일을 둘 수 없습니다.', 503)
    url = await a.put(`dah/hwp/${fileId}/${sha.slice(0, 32)}-${crypto.randomBytes(4).toString('hex')}.bin`, enc, req)
  } else data = enc
  const { rows } = await query('/*hwp:insertBlob*/ INSERT INTO hwp_blobs (file_id, sha256, size, data, blob_url) VALUES ($1, $2, $3, $4, $5) RETURNING id', [fileId, sha, bytes.length, data, url])
  return { blobId: rows[0].id, sha, size: bytes.length }
}

/** 새 버전을 만든다. 호출자가 base(현재 버전)를 넘기면 그와 다를 때 VERSION_CONFLICT. */
export async function addVersion(fileId, { bytes, createdBy, note, source = 'user', parent = null, diffSummary = null, blockIds, counter, pageCount = null, contentPatch = {}, blobId = null, sha = null, expectCurrent = null, req = null }) {
  await ensureHwpSchema()
  const { key } = await fileKey(fileId, { create: true })
  const b = blobId ? { blobId, sha, size: bytes?.length } : await putBlob(fileId, key, bytes, req)
  const cur = (await query('/*hwp:maxVersion*/ SELECT COALESCE(MAX(version), 0) AS v FROM hwp_versions WHERE file_id = $1', [fileId])).rows[0].v
  if (expectCurrent !== null && cur !== expectCurrent) throw new HwpError('VERSION_CONFLICT', '다른 사람이 먼저 고쳤습니다. 최신 버전을 다시 불러오세요.', 409, { current_version: cur })
  const version = cur + 1
  try {
    await query(
      `/*hwp:insertVersion*/ INSERT INTO hwp_versions (file_id, version, created_by, note, source, size, sha256, blob_id, parent_version, diff_summary, block_ids, id_counter, page_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
      [fileId, version, createdBy || null, note ? String(note).slice(0, 200) : null, source, b.size, b.sha, b.blobId, parent, diffSummary ? JSON.stringify(diffSummary) : null, JSON.stringify(blockIds), counter, pageCount]
    )
  } catch (e) {
    if (e.code === '23505') throw new HwpError('VERSION_CONFLICT', '다른 사람이 먼저 고쳤습니다. 최신 버전을 다시 불러오세요.', 409, { current_version: cur + 1 })
    throw e
  }
  await query('/*hwp:setCounter*/ UPDATE hwp_keys SET id_counter = $2 WHERE file_id = $1', [fileId, counter])
  await prune(fileId, version, req)
  return { version, size: b.size, sha256: b.sha, blobId: b.blobId }
}

export async function setFileContent(fileId, content, { title = null, by = null } = {}) {
  await query(
    `/*hwp:updateFile*/ UPDATE ws_files SET content = $2::jsonb, title = COALESCE($3, title), updated_at = now(), last_edit = $4::jsonb WHERE id = $1`,
    [fileId, JSON.stringify(content), title, by ? JSON.stringify({ by, at: new Date().toISOString() }) : null]
  )
}

export async function getVersionRow(fileId, version) {
  const { rows } = await query('/*hwp:getVersion*/ SELECT file_id, version, created_at, created_by, note, source, size, sha256, blob_id, parent_version, diff_summary, block_ids, id_counter, page_count, starred FROM hwp_versions WHERE file_id = $1 AND version = $2', [fileId, version])
  return rows[0] || null
}

export async function listVersions(fileId) {
  const { rows } = await query('/*hwp:listVersions*/ SELECT version, created_at, created_by, note, source, size, parent_version, diff_summary, page_count, starred FROM hwp_versions WHERE file_id = $1 ORDER BY version DESC', [fileId])
  return rows
}

export async function readVersionBytes(fileId, version, req = null) {
  const v = await getVersionRow(fileId, version)
  if (!v) throw new HwpError('NOT_FOUND', '그 버전을 찾을 수 없습니다.', 404)
  const { key } = await fileKey(fileId)
  const b = (await query('/*hwp:getBlob*/ SELECT data, blob_url FROM hwp_blobs WHERE id = $1 AND file_id = $2', [v.blob_id, fileId])).rows[0]
  if (!b) throw new HwpError('NOT_FOUND', '파일 내용을 찾을 수 없습니다.', 404)
  let enc = b.data
  if (!enc && b.blob_url) { const a = await adapter(); enc = await a.get(b.blob_url) }
  try {
    return { bytes: new Uint8Array(decryptBytes(key, enc)), row: v }
  } catch {
    throw new HwpError('STORAGE', '파일 내용을 복호화하지 못했습니다(손상되었거나 키가 다릅니다).', 500)
  }
}

export async function currentCounter(fileId) {
  const { rows } = await query('/*hwp:getKey*/ SELECT sealed_key, id_counter FROM hwp_keys WHERE file_id = $1', [fileId])
  return rows[0]?.id_counter ?? 0
}

export async function starVersion(fileId, version, starred) {
  const { rowCount } = await query('/*hwp:star*/ UPDATE hwp_versions SET starred = $3 WHERE file_id = $1 AND version = $2', [fileId, version, Boolean(starred)])
  return rowCount > 0
}

/** 오래된 별표 없는 버전부터 지운다(현재 버전·별표 버전은 지우지 않는다). 아무도 안 쓰는 바이트는 함께 지운다 */
async function prune(fileId, current, req) {
  const { rows } = await query('/*hwp:pruneList*/ SELECT version, starred FROM hwp_versions WHERE file_id = $1 ORDER BY version ASC', [fileId])
  let excess = rows.length - MAX_VERSIONS
  if (excess <= 0) return
  const drop = []
  for (const r of rows) {
    if (excess <= 0) break
    if (r.starred || r.version === current) continue
    drop.push(r.version)
    excess--
  }
  if (!drop.length) return
  await query('/*hwp:pruneDelete*/ DELETE FROM hwp_versions WHERE file_id = $1 AND version = ANY($2::int[])', [fileId, drop])
  await sweepBlobs(fileId, req)
}

async function sweepBlobs(fileId, req) {
  const { rows } = await query('/*hwp:orphanBlobs*/ DELETE FROM hwp_blobs b WHERE b.file_id = $1 AND NOT EXISTS (SELECT 1 FROM hwp_versions v WHERE v.blob_id = b.id) RETURNING b.blob_url', [fileId])
  const urls = rows.map((r) => r.blob_url).filter(Boolean)
  if (urls.length) {
    const a = await adapter().catch(() => null)
    for (const u of urls) await a?.del(u, req).catch(() => {})
  }
}

/** 영구 삭제 때: Blob 의 암호문을 지운다. 행은 FK cascade 가 지우지만 여기서도 지워 둔다. */
export async function purgeHwpFile(fileId) {
  const { rows } = await query('/*hwp:blobUrls*/ SELECT blob_url FROM hwp_blobs WHERE file_id = $1 AND blob_url IS NOT NULL', [fileId]).catch(() => ({ rows: [] }))
  const a = rows.length ? await adapter().catch(() => null) : null
  for (const r of rows) await a?.del(r.blob_url, null).catch(() => {})
  await query('/*hwp:purgeVersions*/ DELETE FROM hwp_versions WHERE file_id = $1', [fileId]).catch(() => {})
  await query('/*hwp:purgeBlobs*/ DELETE FROM hwp_blobs WHERE file_id = $1', [fileId]).catch(() => {})
  await query('/*hwp:purgeKey*/ DELETE FROM hwp_keys WHERE file_id = $1', [fileId]).catch(() => {})
}

export async function deleteFileRow(fileId) {
  await purgeHwpFile(fileId)
  await query('/*hwp:deleteFile*/ DELETE FROM ws_files WHERE id = $1 AND kind = \'hwp\'', [fileId]).catch(() => {})
}
