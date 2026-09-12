// src/routes/upload.js — 이미지·문서 업로드 (12_BACKEND.md 0·1·6절, Phase 9 K1-2 형식 확대)
// 이미지: multer 메모리 → sharp WebP 변환(원본 폐기) → Vercel Blob.
// 문서(hwp·hwpx·pdf·docx·xlsx·pptx·zip): sharp 파이프라인 우회 → 원본 그대로 Blob/로컬 저장.
// 판정: 확장자+mimetype 병행, 확장자 블록리스트(exe·sh·bat·js·cmd·msi) 우선. 용량 상한 20MB.
// 리사이즈(이미지): 기본 최장변 1600 / usage=poster 2400 / usage=showcase 1920x1080(16:9 강제).
// 역할·용도별 제한: 비로그인은 showcase·exhibition 용도(이미지)만 허용 + rate limit. 문서는 로그인 필요.
// BLOB_READ_WRITE_TOKEN 미설정 시 로컬 폴백: server/uploads/ 저장 (개발용 — 프로덕션에서는 반드시 Blob).
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
import { uploadToGoogleDrive, ensureDriveFolderPath } from '../lib/googleDrive.js'
import { wrap } from './content.js'

const router = Router()

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const PUBLIC_USAGES = ['showcase', 'exhibition'] // 비로그인 허용 용도 (쇼케이스 제출·전시회 접수)
const WEBP_QUALITY = 82

// 확장자 화이트리스트 (K1-2). 이미지는 WebP 파이프, 문서는 원본 그대로.
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
const DOC_EXTS = ['hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'pptx', 'zip']
// 실행 계열 블록리스트 — 화이트리스트·mimetype 판정보다 우선
const BLOCKED_EXTS = ['exe', 'sh', 'bat', 'js', 'cmd', 'msi']

// 저장 시 Content-Type (브라우저 mimetype이 비거나 octet-stream일 때 폴백)
const DOC_CONTENT_TYPES = {
  hwp: 'application/x-hwp',
  hwpx: 'application/haansofthwpx',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
}

function extOf(filename) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(filename || ''))
  return m ? m[1].toLowerCase() : ''
}

export const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = extOf(file.originalname)
    // 1) 블록리스트 우선 — mimetype이 무엇이든 차단
    if (BLOCKED_EXTS.includes(ext)) {
      const err = new Error(`blocked file type: .${ext}`)
      err.status = 400
      return cb(err)
    }
    // 2) 확장자 화이트리스트
    if (IMAGE_EXTS.includes(ext) || DOC_EXTS.includes(ext)) return cb(null, true)
    // 3) mimetype 병행 — 확장자가 불명확한 이미지(heic 등)는 sharp 파이프로 수용
    if (file.mimetype?.startsWith('image/')) return cb(null, true)
    const err = new Error(
      `unsupported file type — allowed: ${[...IMAGE_EXTS, ...DOC_EXTS].join(', ')}`
    )
    err.status = 400
    cb(err)
  },
})

// 비로그인 요청에만 업로드 rate limit 적용
function anonLimit(req, res, next) {
  if (req.user || req.publicUser) return next()
  return anonUploadLimiter(req, res, next)
}

function folderIdFrom(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/\/folders\/([A-Za-z0-9_-]+)/)
  const id = match?.[1] || raw
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : ''
}

async function formDriveTarget(req) {
  const slug = String(req.body?.formSlug || '').trim()
  const fieldId = String(req.body?.fieldId || '').trim()
  if (!slug && !fieldId) return null
  if (!slug || !fieldId) {
    const err = new Error('formSlug and fieldId are required for form uploads')
    err.status = 400
    throw err
  }
  if (!req.publicUser) {
    const err = new Error('google login required')
    err.status = 401
    throw err
  }
  const { rows } = await query('SELECT title_ko, fields, settings, published FROM custom_forms WHERE slug = $1', [slug])
  const form = rows[0]
  if (!form?.published) {
    const err = new Error('form not found')
    err.status = 404
    throw err
  }
  if (!Array.isArray(form.fields) || !form.fields.some((field) => field?.id === fieldId && field?.type === 'file')) {
    const err = new Error('invalid form file field')
    err.status = 400
    throw err
  }
  const rootFolderId = folderIdFrom(form.settings?.drive_folder_id)
  const auto = form.settings?.drive_auto_folder === true
  let course = form.settings?.drive_course
  if (auto) {
    try {
      const values = JSON.parse(String(req.body?.formValues || '{}'))
      const fields = JSON.parse(String(req.body?.formFields || '[]'))
      const courseField = Array.isArray(fields) && fields.find((f) => /과목|course|subject/i.test(`${f?.label_ko || ''} ${f?.label_en || ''}`))
      const selected = courseField ? values?.[courseField.id] : ''
      if (Array.isArray(selected)) course = selected.join(', ')
      else if (selected) course = String(selected)
    } catch { /* 폼 값이 없으면 관리자 설정으로 폴백 */ }
  }
  const names = [form.settings?.drive_semester, course, form.title_ko]
  const folderId = auto && rootFolderId
    ? await ensureDriveFolderPath({ rootFolderId, names })
    : rootFolderId
  if (!form.settings?.drive_enabled || !folderId) {
    const err = new Error('이 폼의 Google Drive 업로드가 아직 설정되지 않았습니다.')
    err.status = 409
    throw err
  }
  return { folderId, shareMode: form.settings?.drive_share_mode === 'link' ? 'link' : 'restricted' }
}

router.post(
  '/',
  optionalAuth,
  optionalPublicAuth,
  anonLimit,
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file field required (multipart/form-data)' })
    const usage = String(req.body?.usage || req.query.usage || 'general')
    const driveTarget = await formDriveTarget(req)
    if (!req.user && !driveTarget && !PUBLIC_USAGES.includes(usage)) {
      return res.status(403).json({ error: 'login required for this upload usage', allowed: PUBLIC_USAGES })
    }

    // ── 문서 분기: 이미지가 아니면 sharp 우회, 원본 그대로 저장 ──
    // 이미지 판정: 확장자 우선, 확장자 불명 시 mimetype 병행 (K1-2)
    const srcExt = extOf(req.file.originalname)
    const isImage =
      IMAGE_EXTS.includes(srcExt) ||
      (!DOC_EXTS.includes(srcExt) && req.file.mimetype?.startsWith('image/'))
    if (!isImage) {
      // 문서는 로그인 필요 (비로그인 공개 용도는 이미지 제출 전용)
      if (!req.user && !driveTarget) {
        return res.status(403).json({ error: 'login required for document uploads' })
      }
      const ext = DOC_EXTS.includes(srcExt) ? srcExt : 'bin'
      const contentType =
        DOC_CONTENT_TYPES[ext] ||
        (req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
          ? req.file.mimetype
          : 'application/octet-stream')
      const buf = req.file.buffer
      const name = `document/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
      const originalName = req.file.originalname || `document.${ext}`

      if (driveTarget) {
        const saved = await uploadToGoogleDrive({ folderId: driveTarget.folderId, buffer: buf, filename: originalName, mimeType: contentType, shareMode: driveTarget.shareMode })
        return res.status(201).json({ ...saved, format: ext })
      }

      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const { put } = await import('@vercel/blob')
        const blob = await put(`dah/${name}`, buf, {
          access: 'public',
          contentType,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        })
        return res.status(201).json({
          url: blob.url, name: originalName, type: contentType, bytes: buf.length, format: ext, storage: 'blob',
        })
      }

      const filePath = path.join(UPLOADS_DIR, name)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, buf)
      const url = `${req.protocol}://${req.get('host')}/uploads/${name}`
      return res.status(201).json({
        url, name: originalName, type: contentType, bytes: buf.length, format: ext, storage: 'local',
      })
    }

    // WebP 변환 + 리사이즈 (원본 버퍼는 저장하지 않음 = 원본 폐기)
    let pipeline = sharp(req.file.buffer).rotate()
    if (usage === 'showcase') {
      pipeline = pipeline.resize(1920, 1080, { fit: 'cover', position: 'centre' }) // 16:9 통일
    } else {
      const maxDim = usage === 'poster' ? 2400 : 1600
      pipeline = pipeline.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    }
    const buf = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer()

    const name = `${usage}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`

    if (driveTarget) {
      const original = path.basename(req.file.originalname || 'image').replace(/\.[^.]+$/, '') || 'image'
      const saved = await uploadToGoogleDrive({ folderId: driveTarget.folderId, buffer: buf, filename: `${original}.webp`, mimeType: 'image/webp', shareMode: driveTarget.shareMode })
      return res.status(201).json({ ...saved, format: 'webp' })
    }

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob')
      const blob = await put(`dah/${name}`, buf, {
        access: 'public',
        contentType: 'image/webp',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })
      return res.status(201).json({ url: blob.url, bytes: buf.length, format: 'webp', storage: 'blob' })
    }

    // ── 로컬 폴백 (개발용) ──
    // BLOB_READ_WRITE_TOKEN이 없으면 server/uploads/에 저장하고 정적 URL 반환.
    // Render 등 임시 파일시스템에서는 재배포 시 사라지므로 프로덕션 사용 금지.
    const filePath = path.join(UPLOADS_DIR, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, buf)
    const url = `${req.protocol}://${req.get('host')}/uploads/${name}`
    res.status(201).json({ url, bytes: buf.length, format: 'webp', storage: 'local' })
  })
)

export default router
