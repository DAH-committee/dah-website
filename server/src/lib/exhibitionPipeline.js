// exhibitionPipeline.js: 전시회 접수 자동화.
//
// 흐름
//   1) 업로드: 원본은 사이트 저장소(Vercel Blob)에 그대로 보관하고, 이미지는 전시 사이트용 WebP와 대표색을 만든다.
//      드라이브 연결이 없거나 느려도 학생 접수는 막히지 않는다.
//   2) 제출·수정 후: 원본을 구글 드라이브로 복사한다.
//        학기 / 인쇄용 PDF / [과목] 작품명 - 대표(학번).pdf      ← PDF는 인쇄용이라 한 폴더에 모은다
//        학기 / 채점용 PNG / 과목 / 작품명 - 대표(학번).png    ← 이미지는 채점을 위해 과목별로 나눈다
//      실패하거나 연결이 없으면 queued·error로 남고, 자동 작업이 다시 보낸다.
//   3) 수정 마감 뒤: 과목별 채점기준표 구글 시트를 각 과목 PNG 폴더에 만들고, 교수님께 폴더(보기)와 시트(편집)를 공유한다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { query } from '../db.js'
import { resolveConnection, resolveRootFolderId, ensurePath, uploadToConnection, driveFor } from './driveConnections.js'
import { createGoogleSheet } from './sheetExport.js'

export const PRINT_FOLDER = '인쇄용 PDF'
export const GRADE_FOLDER = '채점용 PNG'
export const OTHER_FOLDER = '기타 원본'
export const MASTER_COURSE = '__all__'
export const RUBRIC_HEADER = ['순번', '작품명', '과목명', '대표학생(팀명)', '독창성 (25점)', '내용성 (25점)', '완성도 (25점)', '예술성/기술성 (25점)', '총점', '상']
const WEB_MAX = 2400
const LOCAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff']

export function extOf(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(String(name))
  return m ? m[1].toLowerCase() : ''
}

/** pdf | image | other */
export function fileKind(name, mime = '') {
  const ext = extOf(name)
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (IMAGE_EXTS.includes(ext) || String(mime).startsWith('image/')) return 'image'
  return 'other'
}

function hex(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}

/** 전시 사이트용 WebP(긴 변 2400px)와 대표색. 이미지가 아니거나 해석에 실패하면 null */
export async function makeWebVersion(buffer) {
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: false, failOn: 'none' })
      .rotate()
      .resize({ width: WEB_MAX, height: WEB_MAX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true })
    let keycolor = null
    try {
      const { dominant } = await sharp(data).stats()
      if (dominant) keycolor = `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`
    } catch {
      /* 대표색은 없어도 된다 */
    }
    return { buffer: data, meta: { width: info.width, height: info.height, keycolor } }
  } catch {
    return null
  }
}

/** 공개 저장소에 저장. Blob 토큰이 없으면(개발) 로컬 uploads 폴더 */
export async function storePublic(name, buffer, contentType, baseUrl = '') {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob')
    const blob = await put(`dah/${name}`, buffer, { access: 'public', contentType, token: process.env.BLOB_READ_WRITE_TOKEN })
    return blob.url
  }
  const filePath = path.join(LOCAL_DIR, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
  return `${baseUrl}/uploads/${name}`
}

export function randomPart() {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
}

// ── 접수 정보 ───────────────────────────────────────────────

/** 참가자 목록. 개인은 1명, 팀은 members */
export function peopleOf(entry) {
  const f = entry?.fields || {}
  if (entry?.entry_type === 'team' && Array.isArray(f.members) && f.members.length) {
    return f.members.map((m) => ({ name: String(m?.name || '').trim(), studentId: String(m?.student_no || '').trim(), major: String(m?.major || '').trim() }))
  }
  return [{ name: String(f.name || '').trim(), studentId: String(f.student_no || '').trim(), major: String(f.major || '').trim() }]
}

export function authorOf(entry) {
  const f = entry?.fields || {}
  if (entry?.entry_type === 'team' && String(f.team_name || '').trim()) return String(f.team_name).trim()
  return peopleOf(entry)[0]?.name || ''
}

/** 채점표의 대표학생(팀명) 칸: 26-1 채점표 형식 그대로 '대표(팀명)' */
export function representativeLabel(entry) {
  const rep = peopleOf(entry)[0]?.name || ''
  const team = entry?.entry_type === 'team' ? String(entry?.fields?.team_name || '').trim() : ''
  return team ? `${rep}(${team})` : rep
}

function cleanFileBase(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** 드라이브 파일 이름. 인쇄용 PDF는 한 폴더에 섞이므로 과목명을 앞에 붙인다 */
export function driveFileName(entry, upload, kind, index, total) {
  const f = entry?.fields || {}
  const rep = peopleOf(entry)[0] || {}
  const who = `${rep.name || '이름없음'}${rep.studentId ? `(${rep.studentId})` : ''}`
  const title = String(f.work_title || '').trim() || '제목없음'
  const base = kind === 'pdf' ? `[${f.course || '과목없음'}] ${title} - ${who}` : `${title} - ${who}`
  const ext = extOf(upload?.original_name || upload?.stored_name || '') || (kind === 'pdf' ? 'pdf' : 'png')
  return `${cleanFileBase(base)}${total > 1 ? `_${index + 1}` : ''}.${ext}`
}

export function driveSegments(entry, kind) {
  const sem = entry?.semester_label || '학기미정'
  const course = String(entry?.fields?.course || '과목없음').trim()
  if (kind === 'pdf') return [sem, PRINT_FOLDER]
  if (kind === 'image') return [sem, GRADE_FOLDER, course]
  return [sem, OTHER_FOLDER, course]
}

// ── 설정 ────────────────────────────────────────────────────

export async function exhibitionDriveConnection() {
  const { rows } = await query('SELECT drive_connection_id FROM exhibition_settings WHERE id = 1')
  const id = rows[0]?.drive_connection_id
  if (!id) return null
  try {
    const connection = await resolveConnection({ connectionId: id })
    const { rootFolderId } = resolveRootFolderId({ connection, formSettings: {} })
    if (!rootFolderId) return null
    return { connection, rootFolderId }
  } catch {
    return null
  }
}

async function fetchBuffer(url) {
  if (!url) throw new Error('원본 주소가 없습니다')
  const local = /\/uploads\/(.+)$/.exec(url)
  if (local && !process.env.BLOB_READ_WRITE_TOKEN) return fs.readFileSync(path.join(LOCAL_DIR, decodeURIComponent(local[1])))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`원본을 내려받지 못했습니다 (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

async function trashDriveFile(drive, fileId) {
  if (!fileId) return
  try {
    await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true })
  } catch {
    /* 이미 지워졌으면 그대로 둔다 */
  }
}

// ── 드라이브 복사 ───────────────────────────────────────────

/** 접수 1건의 원본을 드라이브로 보낸다. 연결이 없으면 queued로 남긴다 */
export async function syncEntryToDrive(entryId, { target: injected, drive: injectedDrive } = {}) {
  const { rows: er } = await query('SELECT * FROM exhibition_entries WHERE id = $1', [entryId])
  const entry = er[0]
  const { rows: uploads } = await query(
    `SELECT * FROM form_file_uploads
      WHERE form_id IS NULL AND field_id = 'exhibition_original' AND response_id = $1
      ORDER BY id`,
    [entryId]
  )
  const result = { synced: 0, failed: 0, trashed: 0, queued: 0 }
  if (!uploads.length) return result

  const target = injected || (await exhibitionDriveConnection())
  if (!target) {
    const { rowCount } = await query(
      `UPDATE form_file_uploads SET drive_status = 'queued', updated_at = now()
        WHERE response_id = $1 AND form_id IS NULL AND field_id = 'exhibition_original'
          AND status = 'attached' AND blob_url IS NOT NULL AND COALESCE(drive_status, 'queued') <> 'synced'`,
      [entryId]
    )
    result.queued = rowCount || 0
    return result
  }
  const drive = injectedDrive || (await driveFor(target.connection))

  // 접수에서 빠진 파일은 드라이브 사본도 휴지통으로
  for (const u of uploads.filter((x) => x.status === 'detached' && x.drive_status === 'synced')) {
    await trashDriveFile(drive, u.drive_file_id)
    await query("UPDATE form_file_uploads SET drive_status = 'trashed', updated_at = now() WHERE id = $1", [u.id])
    result.trashed++
  }
  if (!entry) return result

  // 접수에 남아 있는 파일을 원본 목록 순서대로
  const order = (entry.fields?.original_files || []).map((f) => f.url)
  const attached = uploads
    .filter((u) => u.status === 'attached' && u.blob_url)
    .sort((a, b) => order.indexOf(a.file_url) - order.indexOf(b.file_url))
  const byKind = { pdf: [], image: [], other: [] }
  for (const u of attached) byKind[u.drive_kind || fileKind(u.original_name, u.mime)].push(u)

  for (const [kind, list] of Object.entries(byKind)) {
    for (const [i, u] of list.entries()) {
      if (u.drive_status === 'synced') continue
      try {
        if (u.drive_file_id && u.drive_status === 'queued') await trashDriveFile(drive, u.drive_file_id) // 수정으로 다시 보내는 경우 예전 사본 정리
        const buffer = await fetchBuffer(u.blob_url)
        const { folderId } = await ensurePath({ connection: target.connection, rootFolderId: target.rootFolderId, segments: driveSegments(entry, kind), drive })
        const saved = await uploadToConnection({
          connection: target.connection,
          drive,
          folderId,
          buffer,
          filename: driveFileName(entry, u, kind, i, list.length),
          mimeType: u.mime || 'application/octet-stream',
          shareMode: 'restricted',
          originalName: u.original_name,
          properties: { course: entry.fields?.course || '', entry: String(entry.id), kind },
        })
        await query(
          `UPDATE form_file_uploads
              SET drive_status = 'synced', drive_error = NULL, drive_file_id = $2, drive_url = $3, folder_id = $4, drive_kind = $5, updated_at = now()
            WHERE id = $1`,
          [u.id, saved.id, saved.url, folderId, kind]
        )
        result.synced++
      } catch (err) {
        await query("UPDATE form_file_uploads SET drive_status = 'error', drive_error = $2, updated_at = now() WHERE id = $1", [u.id, String(err.message || err).slice(0, 300)])
        result.failed++
      }
    }
  }
  return result
}

/** 제출·수정 직후 호출. 이번 목록에 없는 업로드는 detached, 이름이 바뀔 수 있으니 남은 파일은 다시 보낸다 */
export async function markEntryFilesForSync(entryId, urls, { resend = false } = {}) {
  const list = [...new Set((urls || []).filter(Boolean).map(String))]
  await query(
    `UPDATE form_file_uploads SET status = 'detached', updated_at = now()
      WHERE form_id IS NULL AND field_id = 'exhibition_original' AND response_id = $1
        AND status = 'attached' AND NOT (file_url = ANY($2::text[]))`,
    [entryId, list]
  )
  await query(
    `UPDATE form_file_uploads
        SET drive_status = CASE WHEN $2 OR drive_status IS NULL OR drive_status = 'error' THEN 'queued' ELSE drive_status END,
            updated_at = now()
      WHERE form_id IS NULL AND field_id = 'exhibition_original' AND response_id = $1 AND status = 'attached' AND blob_url IS NOT NULL`,
    [entryId, Boolean(resend)]
  )
}

/** 대기·실패 건 일괄 재전송 */
export async function syncPendingAll({ limit = 50, semester = null } = {}) {
  const { rows } = await query(
    `SELECT DISTINCT u.response_id AS id
       FROM form_file_uploads u
       JOIN exhibition_entries e ON e.id = u.response_id
      WHERE u.form_id IS NULL AND u.field_id = 'exhibition_original' AND u.blob_url IS NOT NULL
        AND ((u.status = 'attached' AND COALESCE(u.drive_status, 'queued') IN ('queued', 'error'))
          OR (u.status = 'detached' AND u.drive_status = 'synced'))
        AND ($2::text IS NULL OR e.semester_label = $2)
      LIMIT $1`,
    [limit, semester]
  )
  const total = { entries: rows.length, synced: 0, failed: 0, trashed: 0, queued: 0 }
  for (const { id } of rows) {
    const r = await syncEntryToDrive(id)
    for (const k of ['synced', 'failed', 'trashed', 'queued']) total[k] += r[k]
  }
  return total
}

export async function driveStatus(semester) {
  const { rows } = await query(
    `SELECT COALESCE(u.drive_status, 'queued') AS s, count(*)::int AS n, max(u.drive_error) AS err
       FROM form_file_uploads u JOIN exhibition_entries e ON e.id = u.response_id
      WHERE u.form_id IS NULL AND u.field_id = 'exhibition_original' AND u.status = 'attached' AND u.blob_url IS NOT NULL
        AND e.semester_label = $1
      GROUP BY 1`,
    [semester]
  )
  const by = Object.fromEntries(rows.map((r) => [r.s, r]))
  const target = await exhibitionDriveConnection()
  return {
    connected: Boolean(target),
    account: target?.connection?.account_email || '',
    queued: by.queued?.n || 0,
    synced: by.synced?.n || 0,
    failed: by.error?.n || 0,
    lastError: by.error?.err || '',
  }
}

// ── 과목과 접수 묶음 ─────────────────────────────────────────

export async function subjectNames(semester) {
  const term = Number(String(semester || '').split('-')[1]) === 2 ? 2 : 1
  const { rows } = await query("SELECT value FROM site_settings WHERE key = 'exhibitionSubjects'")
  const list = Array.isArray(rows[0]?.value) ? rows[0].value : []
  return [...new Set(list.filter((s) => Number(s?.semester) === term).map((s) => String(s.name || '').trim()).filter(Boolean))]
}

export async function entriesBySemester(semester) {
  const { rows } = await query('SELECT * FROM exhibition_entries WHERE semester_label = $1 ORDER BY id', [semester])
  return rows
}

/** 과목 순서(설정 순서) → 그 외 과목 순으로 묶는다 */
export function groupByCourse(entries, order = []) {
  const map = new Map()
  for (const name of order) map.set(name, [])
  for (const e of entries) {
    const c = String(e.fields?.course || '과목없음').trim()
    if (!map.has(c)) map.set(c, [])
    map.get(c).push(e)
  }
  return [...map.entries()].filter(([, list]) => list.length)
}

// ── 채점기준표 ──────────────────────────────────────────────

/** 과목 시트: 1행 PNG 폴더 링크, 3행 머리글, 4행부터 작품. 총점은 수식 */
export function rubricValues({ course, entries, folderUrl, startNo = 1 }) {
  const rows = [['채점용 PNG 폴더', folderUrl || ''], [], RUBRIC_HEADER]
  entries.forEach((e, i) => {
    const r = rows.length + 1
    rows.push([String(startNo + i), String(e.fields?.work_title || '').trim(), course, representativeLabel(e), '', '', '', '', `=IF(COUNT(E${r}:H${r})=0,"",SUM(E${r}:H${r}))`, ''])
  })
  return rows
}

export function masterRubricValues(groups) {
  const rows = [['과목별 채점기준표는 각 과목의 채점용 PNG 폴더에 있습니다'], [], RUBRIC_HEADER]
  let no = 1
  for (const [course, list] of groups) {
    for (const e of list) {
      const r = rows.length + 1
      rows.push([String(no++), String(e.fields?.work_title || '').trim(), course, representativeLabel(e), '', '', '', '', `=IF(COUNT(E${r}:H${r})=0,"",SUM(E${r}:H${r}))`, ''])
    }
  }
  return rows
}

const folderUrlOf = (id) => (id ? `https://drive.google.com/drive/folders/${id}` : '')

export async function listRubrics(semester) {
  const { rows } = await query('SELECT * FROM exhibition_rubrics WHERE semester_label = $1 ORDER BY id DESC', [semester])
  const seen = new Set()
  return rows.filter((r) => (seen.has(r.course) ? false : seen.add(r.course)))
}

/** 과목별 채점기준표 생성. 이미 있는 과목은 force가 아니면 건너뛴다(채점 중인 시트를 덮지 않기 위해) */
export async function buildRubrics({ semester, force = false, target: injected, drive: injectedDrive } = {}) {
  const target = injected || (await exhibitionDriveConnection())
  if (!target) {
    const err = new Error('전시회 구글 드라이브가 연결되지 않았습니다. 전공 사이트 관리자 화면의 저장소 설정에서 먼저 연결해 주세요.')
    err.status = 409
    err.code = 'drive_not_connected'
    throw err
  }
  const drive = injectedDrive || (await driveFor(target.connection))
  const groups = groupByCourse(await entriesBySemester(semester), await subjectNames(semester))
  const existing = new Map((await listRubrics(semester)).map((r) => [r.course, r]))
  const created = []
  const skipped = []
  for (const [course, list] of groups) {
    if (existing.has(course) && !force) {
      skipped.push(course)
      continue
    }
    const { folderId } = await ensurePath({ connection: target.connection, rootFolderId: target.rootFolderId, segments: [semester, GRADE_FOLDER, course], drive })
    const folderUrl = folderUrlOf(folderId)
    const sheet = await createGoogleSheet({ drive, name: `${semester} ${course} 채점기준표`, values: rubricValues({ course, entries: list, folderUrl }), parentId: folderId })
    await query(
      `INSERT INTO exhibition_rubrics (semester_label, course, sheet_id, sheet_url, folder_id, folder_url, entry_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [semester, course, sheet.id, sheet.url, folderId, folderUrl, JSON.stringify(list.map((e) => e.id))]
    )
    created.push({ course, url: sheet.url, folderUrl })
  }
  let master = null
  if (groups.length && (created.length || force || !existing.has(MASTER_COURSE))) {
    const { folderId } = await ensurePath({ connection: target.connection, rootFolderId: target.rootFolderId, segments: [semester], drive })
    const sheet = await createGoogleSheet({ drive, name: `${semester} 전체 채점기준표`, values: masterRubricValues(groups), parentId: folderId })
    await query(
      `INSERT INTO exhibition_rubrics (semester_label, course, sheet_id, sheet_url, folder_id, folder_url, entry_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [semester, MASTER_COURSE, sheet.id, sheet.url, folderId, folderUrlOf(folderId), JSON.stringify(groups.flatMap(([, l]) => l.map((e) => e.id)))]
    )
    master = { url: sheet.url }
  }
  return { created, skipped, master }
}

// ── 교수님 공유 ─────────────────────────────────────────────

export async function getProfessors() {
  const { rows } = await query("SELECT value FROM site_settings WHERE key = 'exhibitionProfessors'")
  const v = rows[0]?.value
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

export function normalizeProfessors(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const [course, v] of Object.entries(input)) {
    const name = String(v?.name || '').trim().slice(0, 60)
    const emails = [...new Set((Array.isArray(v?.emails) ? v.emails : String(v?.emails || '').split(/[,\s]+/))
      .map((e) => String(e).trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 10)
    if (String(course).trim() && (name || emails.length)) out[String(course).trim()] = { name, emails }
  }
  return out
}

async function grant(drive, fileId, email, role) {
  await drive.permissions.create({
    fileId,
    requestBody: { type: 'user', role, emailAddress: email },
    sendNotificationEmail: true,
    supportsAllDrives: true,
  })
}

/** 과목 PNG 폴더는 보기, 채점기준표는 편집 권한으로 교수님께 공유. 이미 공유한 주소는 건너뛴다 */
export async function shareWithProfessors({ semester, target: injected, drive: injectedDrive } = {}) {
  const target = injected || (await exhibitionDriveConnection())
  if (!target) {
    const err = new Error('전시회 구글 드라이브가 연결되지 않았습니다.')
    err.status = 409
    throw err
  }
  const drive = injectedDrive || (await driveFor(target.connection))
  const professors = await getProfessors()
  const shared = []
  const failed = []
  for (const r of await listRubrics(semester)) {
    if (r.course === MASTER_COURSE) continue
    const emails = professors[r.course]?.emails || []
    const done = new Set(Array.isArray(r.shared_with) ? r.shared_with : [])
    const fresh = emails.filter((e) => !done.has(e))
    if (!fresh.length) continue
    const ok = []
    for (const email of fresh) {
      try {
        if (r.folder_id) await grant(drive, r.folder_id, email, 'reader')
        if (r.sheet_id) await grant(drive, r.sheet_id, email, 'writer')
        ok.push(email)
      } catch (err) {
        failed.push({ course: r.course, email, error: String(err.message || err).slice(0, 200) })
      }
    }
    if (ok.length) {
      await query('UPDATE exhibition_rubrics SET shared_with = $2, updated_at = now() WHERE id = $1', [r.id, JSON.stringify([...done, ...ok])])
      shared.push({ course: r.course, emails: ok })
    }
  }
  return { shared, failed }
}

// ── 자동 작업 ───────────────────────────────────────────────

/** 10분마다: 드라이브 재전송, 수정 마감 뒤 채점기준표 생성과 교수님 공유 */
let autoRunning = false

export async function runAutoTasks({ now = new Date() } = {}) {
  if (autoRunning) return { skipped: 'running' }
  autoRunning = true
  try {
    const out = { sync: await syncPendingAll({ limit: 30 }) }
    const { rows: st } = await query('SELECT submit_open, edit_close FROM exhibition_settings WHERE id = 1')
    const s = st[0]
    if (s?.submit_open && s?.edit_close && now > new Date(s.edit_close)) {
      const d = new Date(s.submit_open)
      const semester = `${d.getFullYear()}-${d.getMonth() + 1 >= 7 ? 2 : 1}`
      const target = await exhibitionDriveConnection()
      const status = await driveStatus(semester)
      if (target && status.queued === 0 && status.failed === 0) {
        const existing = await listRubrics(semester)
        if (!existing.length) out.rubrics = await buildRubrics({ semester, target })
        out.share = await shareWithProfessors({ semester, target })
      }
    }
    return out
  } finally {
    autoRunning = false
  }
}
