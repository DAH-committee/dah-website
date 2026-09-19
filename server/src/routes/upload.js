// src/routes/upload.js — 업로드 단일 진입점 (12_BACKEND 0·1·6절 + 53_DRIVE_STORAGE)
//
// 두 갈래가 있다.
//   1) 폼 업로드 (formSlug + fieldId): 저장 위치·용도·허용 확장자·상한·폴더 경로를 전부 서버가
//      저장된 폼 정의에서 읽어 결정한다. 클라이언트는 "어떤 폼의 어떤 질문인가"만 말한다.
//   2) 그 밖의 업로드 (어드민 이미지 등): 기존 동작 유지 — 이미지는 WebP 변환 후 Blob.
//
// 핵심 규칙
//   · 웹 전시용(purpose=web, target=blob) 이미지만 리사이즈·WebP 최적화한다.
//   · 원본·인쇄용(purpose=original)과 Drive로 가는 모든 파일은 바이트·확장자·MIME을 그대로 보존한다.
//   · 확장자 블록리스트가 mimetype 판정보다 항상 우선한다.
//   · 업로드마다 idempotency key를 남겨, 같은 요청을 재시도해도 파일이 두 개 생기지 않는다.
//   · 업로드 기록은 pending으로 남고 폼 제출 시 attached로 바뀐다(자동 삭제 없음).
import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { optionalAuth } from '../middleware/auth.js'
import { optionalPublicAuth } from '../middleware/publicAuth.js'
import { anonUploadLimiter } from '../middleware/rateLimit.js'
import { query } from '../db.js'
import {
  DEFAULT_MAX_BYTES,
  DRIVE_MAX_BYTES,
  BLOCKED_EXTS,
  DOC_EXTS,
  IMAGE_EXTS,
  ORIGINAL_EXTS,
  PATH_TEMPLATES,
  allowedExtsFor,
  buildFolderSegments,
  extOf,
  maxBytesFor,
  normalizeFileStorage,
  resolveCourse,
  shouldOptimize,
} from '../lib/formStorage.js'
import {
  ensurePath,
  findUploadByKey,
  insertUpload,
  resolveConnection,
  resolveRootFolderId,
  uploadToConnection,
} from '../lib/driveConnections.js'
import { wrap } from './content.js'

const router = Router()

export const MAX_UPLOAD_BYTES = DEFAULT_MAX_BYTES
const PUBLIC_USAGES = ['showcase', 'exhibition'] // 비로그인 허용 용도 (쇼케이스 제출·전시회 접수)
const WEBP_QUALITY = 82

// 저장 시 Content-Type (브라우저 mimetype이 비거나 octet-stream일 때 폴백)
const DOC_CONTENT_TYPES = {
  hwp: 'application/x-hwp',
  hwpx: 'application/haansofthwpx',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  ai: 'application/postscript',
  eps: 'application/postscript',
  psd: 'image/vnd.adobe.photoshop',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
}

export const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')

const upload = multer({
  storage: multer.memoryStorage(),
  // 상한은 질문별 설정에서 다시 좁힌다. multer 단계는 Drive 원본 상한(가장 큰 값)까지 허용한다.
  limits: { fileSize: Math.max(DRIVE_MAX_BYTES, DEFAULT_MAX_BYTES) },
  fileFilter: (req, file, cb) => {
    const ext = extOf(file.originalname)
    // 실행 계열은 mimetype이 무엇이든 즉시 차단
    if (BLOCKED_EXTS.includes(ext)) {
      const err = new Error(`blocked file type: .${ext}`)
      err.status = 400
      return cb(err)
    }
    cb(null, true)
  },
})

// 비로그인 요청에만 업로드 rate limit 적용
function anonLimit(req, res, next) {
  if (req.user || req.publicUser) return next()
  return anonUploadLimiter(req, res, next)
}

function contentTypeFor(ext, mimetype) {
  if (mimetype && mimetype !== 'application/octet-stream') return mimetype
  return DOC_CONTENT_TYPES[ext] || 'application/octet-stream'
}

/**
 * 한글 파일명 복원. multer(busboy)는 multipart 파일명을 latin1로 드리므로 받아서
 * '생산자토로.png'가 깨진 문자로 들어온다. 원본 파일명을 그대로 보존하는 것이 이 라우트의
 * 약속이니, utf8로 다시 읽어 한글·CJK가 나오면 그 결과를 컴다.
 */
function decodeOriginalName(raw) {
  const name = String(raw || '')
  if (!/[\u0080-\u00ff]/.test(name)) return name
  try {
    const repaired = Buffer.from(name, 'latin1').toString('utf8')
    if (!repaired.includes('\ufffd') && /[\uac00-\ud7a3\u3130-\u318f\u4e00-\u9fff\u3040-\u30ff]/.test(repaired)) {
      return repaired
    }
  } catch {
    // 복원 실패 — 원문 유지
  }
  return name
}

function sanitizeBaseName(filename) {
  const base = path.basename(String(filename || 'file')).replace(/\.[^.]+$/, '')
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return (clean || 'file').slice(0, 60)
}

function httpError(message, status, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

// ── 전시회 원본 업로드 ──────────────────────────────────────
// custom_forms(행사 설정)와 별개인 전용 접수 시스템(exhibition_entries)이 쓰는 경로다.
// context='exhibition-original'로 들어오면 여기서 처리하고, 저장소는 exhibition_settings의
// 단일 Drive 연결이다(폼별 저장소 설정과 달리 폼이 하나뿐이라 선택지도 하나다).
async function resolveExhibitionCourse(course) {
  const { rows } = await query("SELECT value FROM site_settings WHERE key = 'exhibitionSubjects'", [])
  const raw = rows[0]?.value
  const names = (Array.isArray(raw) ? raw : [])
    .map((s) => String(s?.name ?? '').trim())
    .filter(Boolean)
  // 과목 목록을 아직 등록하지 않은 학교라면(자유 입력 폴백) 값만 있으면 통과시킨다.
  if (!names.length) return Boolean(String(course || '').trim())
  return names.includes(String(course || '').trim())
}

function exhibitionUploadKey({ email, course, buffer, originalname }) {
  const hash = crypto.createHash('sha256')
  hash.update('exhibition-original')
  hash.update(String(email || 'anon'))
  hash.update(String(course || ''))
  hash.update(String(originalname || ''))
  hash.update(String(buffer.length))
  hash.update(buffer)
  return `x:${hash.digest('hex')}`
}

async function handleExhibitionUpload(req, res) {
  if (!req.publicUser) throw httpError('google login required', 401)
  const course = String(req.body?.course || '').trim()
  if (!course) throw httpError('먼저 참가 과목을 선택해야 파일을 업로드할 수 있습니다.', 422, { code: 'course_not_selected' })
  const courseOk = await resolveExhibitionCourse(course)
  if (!courseOk) {
    throw httpError('선택한 과목이 등록된 과목 목록에 없습니다. 다시 선택해 주세요.', 422, { code: 'course_not_allowed' })
  }

  const { rows } = await query('SELECT drive_connection_id FROM exhibition_settings WHERE id = 1', [])
  const connectionId = rows[0]?.drive_connection_id
  if (!connectionId) {
    throw httpError(
      '전시회 원본 저장소가 아직 설정되지 않았습니다. 관리자에게 알려주세요.',
      409,
      { code: 'connection_none' }
    )
  }

  const ext = extOf(req.file.originalname)
  if (BLOCKED_EXTS.includes(ext)) throw httpError(`blocked file type: .${ext}`, 400)
  const mimeLooksImage = Boolean(req.file.mimetype?.startsWith('image/'))
  if (ext && !ORIGINAL_EXTS.includes(ext) && !mimeLooksImage) {
    throw httpError(`허용되지 않은 파일 형식입니다. 허용: ${ORIGINAL_EXTS.join(', ')}`, 400)
  }
  if (req.file.size > DRIVE_MAX_BYTES) {
    throw httpError(`파일이 너무 큽니다. 최대 ${Math.round(DRIVE_MAX_BYTES / (1024 * 1024))}MB`, 413)
  }

  const key = exhibitionUploadKey({ email: req.publicUser.email, course, buffer: req.file.buffer, originalname: req.file.originalname })
  const existing = await findUploadByKey(key)
  if (existing && existing.status !== 'deleted') {
    return res.status(200).json({ ...uploadResponse(existing), idempotent: true })
  }

  const connection = await resolveConnection({ connectionId })
  const { rootFolderId } = resolveRootFolderId({ connection, formSettings: {} })
  if (!rootFolderId) {
    throw httpError('전시회 원본 저장소의 루트 폴더가 지정되지 않았습니다. 관리자에게 알려주세요.', 409, { code: 'root_missing' })
  }
  const { folderId } = await ensurePath({ connection, rootFolderId, segments: [course, '원본'] })

  const originalName = decodeOriginalName(path.basename(req.file.originalname || 'file'))
  const contentType = contentTypeFor(ext, req.file.mimetype)
  const storedName = `${sanitizeBaseName(originalName)}_${crypto.randomUUID().slice(0, 8)}.${ext || 'bin'}`

  const saved = await uploadToConnection({
    connection,
    folderId,
    buffer: req.file.buffer,
    filename: storedName,
    mimeType: contentType,
    shareMode: 'restricted', // 전시회 원본은 기본적으로 제한됨(학생 개인정보 포함)
    originalName,
    properties: { course, submitter: req.publicUser.email },
  })

  const row = await insertUpload({
    formId: null,
    fieldId: 'exhibition_original',
    publicUserId: req.publicUser.id,
    submitterEmail: req.publicUser.email,
    idempotencyKey: key,
    storage: 'google-drive',
    purpose: 'original',
    connectionId: connection.id || null,
    driveFileId: saved.id,
    fileUrl: saved.url,
    folderId,
    originalName,
    storedName: saved.name,
    mime: saved.type,
    bytes: saved.bytes,
  })
  return res.status(201).json({ ...uploadResponse(row), format: ext, path: [course, '원본'] })
}

// ── 폼 업로드 ──────────────────────────────────────────────

/**
 * 폼 컨텍스트 해석. 여기서 통과한 값만 저장 경로 계산에 쓰인다.
 * @returns {null|{form:object, field:object, storage:object, course:string}}
 */
async function resolveFormUpload(req) {
  const slug = String(req.body?.formSlug || '').trim()
  const fieldId = String(req.body?.fieldId || '').trim()
  if (!slug && !fieldId) return null
  if (!slug || !fieldId) throw httpError('formSlug and fieldId are required for form uploads', 400)

  const { rows } = await query(
    'SELECT id, slug, title_ko, category, fields, settings, published FROM custom_forms WHERE slug = $1',
    [slug]
  )
  const form = rows[0]
  if (!form?.published) throw httpError('form not found', 404)

  const fields = Array.isArray(form.fields) ? form.fields : []
  const field = fields.find((f) => f?.id === fieldId && f?.type === 'file')
  if (!field) throw httpError('invalid form file field', 400)

  // 로그인 정책은 폼 설정을 따른다(제출과 같은 기준).
  if (form.settings?.require_google_auth !== false && !req.publicUser) {
    throw httpError('google login required', 401)
  }

  const storage = normalizeFileStorage(field.storage, form.settings || {})
  const template = PATH_TEMPLATES[storage.path_template]

  let course = ''
  if (storage.target === 'drive' && template?.needsCourse) {
    let values = {}
    try {
      values = JSON.parse(String(req.body?.formValues || '{}'))
    } catch {
      values = {}
    }
    const resolved = resolveCourse(form, values)
    if (!resolved.ok) {
      const messages = {
        course_field_missing: '이 폼에 과목 선택 질문이 지정되지 않았습니다. 관리자에게 알려주세요.',
        course_not_selected: '먼저 참가 과목을 선택해야 파일을 업로드할 수 있습니다.',
        course_options_missing: '과목 보기 목록이 비어 있습니다. 관리자에게 알려주세요.',
        course_not_allowed: '선택한 과목이 이 폼의 과목 목록에 없습니다. 다시 선택해 주세요.',
      }
      throw httpError(messages[resolved.reason] || '과목 확인에 실패했습니다.', 422, { reason: resolved.reason })
    }
    course = resolved.course
  }

  return { form, field, storage, course }
}

/** 확장자·MIME·용량 서버 검증. 클라이언트 accept 속성은 편의일 뿐 신뢰하지 않는다 */
function validateFile(file, storage) {
  const ext = extOf(file.originalname)
  if (BLOCKED_EXTS.includes(ext)) throw httpError(`blocked file type: .${ext}`, 400)

  const allowed = allowedExtsFor(storage)
  const mimeLooksImage = Boolean(file.mimetype?.startsWith('image/'))
  const extOk = ext ? allowed.includes(ext) : false
  if (!extOk && !(mimeLooksImage && allowed.some((e) => IMAGE_EXTS.includes(e)))) {
    throw httpError(`허용되지 않은 파일 형식입니다. 허용: ${allowed.join(', ')}`, 400, { allowed })
  }

  const max = maxBytesFor(storage)
  if (file.size > max) {
    throw httpError(`파일이 너무 큽니다. 최대 ${Math.round(max / (1024 * 1024))}MB`, 413, { maxBytes: max })
  }
  return { ext: ext || (mimeLooksImage ? 'jpg' : 'bin') }
}

/** 같은 파일을 같은 질문에 다시 올리는 재시도를 한 파일로 수렴시키는 키 */
function idempotencyKeyFor({ req, form, field, buffer }) {
  const provided = String(req.body?.idempotency_key || req.get('Idempotency-Key') || '').trim()
  if (provided) return `c:${provided.slice(0, 120)}`
  const hash = crypto.createHash('sha256')
  hash.update(String(form.id))
  hash.update(String(field.id))
  hash.update(String(req.publicUser?.id ?? req.user?.id ?? 'anon'))
  hash.update(String(req.file.originalname || ''))
  hash.update(String(buffer.length))
  hash.update(buffer)
  return `h:${hash.digest('hex')}`
}

function uploadResponse(row) {
  return {
    url: row.file_url,
    name: row.original_name,
    stored_name: row.stored_name,
    type: row.mime,
    bytes: Number(row.bytes || 0),
    storage: row.storage,
    purpose: row.purpose,
    upload_id: row.id,
    drive_file_id: row.drive_file_id || undefined,
  }
}

async function handleFormUpload(req, res, ctx) {
  const { form, field, storage, course } = ctx
  const { ext } = validateFile(req.file, storage)
  const key = idempotencyKeyFor({ req, form, field, buffer: req.file.buffer })

  // 같은 키가 이미 있으면 새 파일을 만들지 않고 이전 결과를 그대로 돌려준다.
  const existing = await findUploadByKey(key)
  if (existing && existing.status !== 'deleted') {
    return res.status(200).json({ ...uploadResponse(existing), idempotent: true })
  }

  const optimize = shouldOptimize(storage, ext, req.file.mimetype)
  let buffer = req.file.buffer
  let outExt = ext
  let contentType = contentTypeFor(ext, req.file.mimetype)

  if (optimize) {
    // 웹 전시용만 변환한다. 원본·Drive 경로는 이 분기에 들어오지 않는다.
    buffer = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()
    outExt = 'webp'
    contentType = 'image/webp'
  }

  const originalName = decodeOriginalName(path.basename(req.file.originalname || `file.${outExt}`))
  const shortId = crypto.randomUUID().slice(0, 8)
  const storedName = `${sanitizeBaseName(originalName)}_${shortId}.${outExt}`

  if (storage.target === 'drive') {
    const connection = await resolveConnection({
      connectionId: storage.connection_id ?? (Number(form.settings?.drive_connection_id) || null),
    })
    const { rootFolderId } = resolveRootFolderId({ connection, formSettings: form.settings || {} })
    if (!rootFolderId) {
      throw httpError(
        '이 폼의 Google Drive 루트 폴더가 지정되지 않았습니다. 관리 → 저장소 → Google Drive에서 루트 폴더를 선택하세요.',
        409,
        { code: 'root_missing' }
      )
    }
    const built = buildFolderSegments({ form, field, storage, course })
    if (!built.ok) {
      throw httpError('저장 경로를 만들 수 없습니다. 관리자에게 알려주세요.', 422, { reason: built.reason })
    }
    const { folderId } = await ensurePath({ connection, rootFolderId, segments: built.segments })
    const saved = await uploadToConnection({
      connection,
      folderId,
      buffer,
      filename: storedName,
      mimeType: contentType,
      shareMode: storage.share_mode,
      originalName,
      properties: {
        formSlug: form.slug,
        fieldId: field.id,
        purpose: storage.purpose,
        submitter: req.publicUser?.email || req.user?.email || '',
        course: course || '',
      },
    })

    const row = await insertUpload({
      formId: form.id,
      fieldId: field.id,
      publicUserId: req.publicUser?.id ?? null,
      submitterEmail: req.publicUser?.email ?? req.user?.email ?? null,
      idempotencyKey: key,
      storage: 'google-drive',
      purpose: storage.purpose,
      connectionId: connection.id || null,
      driveFileId: saved.id,
      fileUrl: saved.url,
      folderId,
      originalName,
      storedName: saved.name,
      mime: saved.type,
      bytes: saved.bytes,
    })
    return res.status(201).json({
      ...uploadResponse(row),
      format: outExt,
      folder_id: folderId,
      path: built.segments,
    })
  }

  // ── Vercel Blob (웹 전시용·일반 첨부) ──
  const blobPath = `dah/forms/${form.slug}/${field.id}/${Date.now()}-${shortId}.${outExt}`
  let fileUrl = ''
  let storageKind = 'blob'
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob')
    const blob = await put(blobPath, buffer, {
      access: 'public',
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    fileUrl = blob.url
  } else {
    // 로컬 폴백(개발용). Render의 임시 파일시스템에서는 재배포 시 사라진다.
    const filePath = path.join(UPLOADS_DIR, blobPath.replace(/^dah\//, ''))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, buffer)
    fileUrl = `${req.protocol}://${req.get('host')}/uploads/${blobPath.replace(/^dah\//, '')}`
    storageKind = 'local'
  }

  const row = await insertUpload({
    formId: form.id,
    fieldId: field.id,
    publicUserId: req.publicUser?.id ?? null,
    submitterEmail: req.publicUser?.email ?? req.user?.email ?? null,
    idempotencyKey: key,
    storage: storageKind,
    purpose: storage.purpose,
    connectionId: null,
    driveFileId: null,
    fileUrl,
    folderId: null,
    originalName,
    storedName,
    mime: contentType,
    bytes: buffer.length,
  })
  return res.status(201).json({ ...uploadResponse(row), format: outExt })
}

// ── 그 밖의 업로드 (어드민 이미지·문서) ──────────────────────

async function handleGeneralUpload(req, res) {
  const usage = String(req.body?.usage || req.query.usage || 'general')
  if (!req.user && !PUBLIC_USAGES.includes(usage)) {
    return res.status(403).json({ error: 'login required for this upload usage', allowed: PUBLIC_USAGES })
  }
  if (req.file.size > DEFAULT_MAX_BYTES) {
    return res.status(413).json({ error: 'file too large', maxBytes: DEFAULT_MAX_BYTES })
  }

  const srcExt = extOf(req.file.originalname)
  const isImage =
    IMAGE_EXTS.includes(srcExt) ||
    (!DOC_EXTS.includes(srcExt) && req.file.mimetype?.startsWith('image/'))

  if (!isImage) {
    if (!DOC_EXTS.includes(srcExt)) {
      return res.status(400).json({
        error: `unsupported file type — allowed: ${[...IMAGE_EXTS, ...DOC_EXTS].join(', ')}`,
      })
    }
    if (!req.user) return res.status(403).json({ error: 'login required for document uploads' })
    const contentType = contentTypeFor(srcExt, req.file.mimetype)
    const buf = req.file.buffer
    const name = `document/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${srcExt}`
    const originalName = req.file.originalname || `document.${srcExt}`

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob')
      const blob = await put(`dah/${name}`, buf, {
        access: 'public',
        contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })
      return res.status(201).json({
        url: blob.url, name: originalName, type: contentType, bytes: buf.length, format: srcExt, storage: 'blob',
      })
    }
    const filePath = path.join(UPLOADS_DIR, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, buf)
    return res.status(201).json({
      url: `${req.protocol}://${req.get('host')}/uploads/${name}`,
      name: originalName, type: contentType, bytes: buf.length, format: srcExt, storage: 'local',
    })
  }

  // 이미지: WebP 변환 + 리사이즈 (사이트 표시용이므로 원본은 보관하지 않는다)
  let pipeline = sharp(req.file.buffer).rotate()
  if (usage === 'showcase') {
    pipeline = pipeline.resize(1920, 1080, { fit: 'cover', position: 'centre' })
  } else {
    const maxDim = usage === 'poster' ? 2400 : 1600
    pipeline = pipeline.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
  }
  const buf = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer()
  const name = `${usage}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob')
    const blob = await put(`dah/${name}`, buf, {
      access: 'public',
      contentType: 'image/webp',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    return res.status(201).json({ url: blob.url, bytes: buf.length, format: 'webp', storage: 'blob' })
  }

  const filePath = path.join(UPLOADS_DIR, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buf)
  return res.status(201).json({
    url: `${req.protocol}://${req.get('host')}/uploads/${name}`,
    bytes: buf.length, format: 'webp', storage: 'local',
  })
}

router.post(
  '/',
  optionalAuth,
  optionalPublicAuth,
  anonLimit,
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file field required (multipart/form-data)' })
    if (req.body?.context === 'exhibition-original') return handleExhibitionUpload(req, res)
    const ctx = await resolveFormUpload(req)
    if (ctx) return handleFormUpload(req, res, ctx)
    return handleGeneralUpload(req, res)
  })
)

export default router
