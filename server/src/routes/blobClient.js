// src/routes/blobClient.js — 큰 파일을 브라우저에서 Vercel Blob으로 바로 올리는 서명 주소 발급
//
// Vercel Functions는 요청 본문이 4.5MB를 넘으면 거절한다. 그래서 4MB가 넘는 파일은 서버를 거치지 않고
// 브라우저가 Blob으로 바로 올린다. 서버는 로그인한 사람에게만, 파일 한 개 경로에 한정된 15분짜리
// PUT 서명 주소를 만들어 준다(issueSignedToken + presignUrl, OIDC 저장소에서도 동작, @vercel/blob 2.4.0 이상).
// 기존 handleUpload(클라이언트 토큰) 방식은 읽기·쓰기 토큰이 있어야 해서 OIDC 저장소에서는 쓸 수 없다.
import { Router } from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { optionalAuth, hasRole } from '../middleware/auth.js'
import { identityOf } from '../lib/wsAccess.js'
import { blobAuth, blobEnabled } from './upload.js'
import { wrap } from './content.js'

const router = Router()

export const CLIENT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024
const URL_TTL_MS = 15 * 60 * 1000
// Blob API 버전(@vercel/blob 2.x가 보내는 값). 브라우저가 직접 PUT할 때 같은 값을 보낸다.
const BLOB_API_VERSION = '12'

// 허용 형식: 이미지·PDF·오피스·한글·압축. 형식은 확장자로 서버가 정하고, 서명 주소가 이 형식만 받는다.
const CLIENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwp: 'application/x-hwp',
  hwpx: 'application/haansofthwpx',
  zip: 'application/zip',
}

function extOf(name) {
  return path.extname(String(name || '')).replace(/^\./, '').toLowerCase()
}

router.post(
  '/blob/client-token',
  optionalAuth,
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    if (!idn.emails.length) return res.status(401).json({ error: '로그인한 뒤에 큰 파일을 올릴 수 있습니다.' })
    if (!blobEnabled()) return res.status(503).json({ error: '파일 저장소가 연결되어 있지 않습니다. 관리자에게 알려주세요.' })

    const filename = String(req.body?.filename || '')
    const size = Number(req.body?.size)
    const ext = extOf(filename)
    const contentType = CLIENT_TYPES[ext]
    if (!contentType) {
      return res.status(400).json({
        error: '이 형식의 파일은 올릴 수 없습니다. 이미지, PDF, 오피스, 한글, ZIP 파일만 올릴 수 있습니다.',
        allowed: Object.keys(CLIENT_TYPES),
      })
    }
    if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: '파일 크기를 알 수 없습니다.' })
    if (size > CLIENT_UPLOAD_MAX_BYTES) {
      return res.status(413).json({ error: '파일이 너무 큽니다. 100MB 이하만 올릴 수 있습니다.', maxBytes: CLIENT_UPLOAD_MAX_BYTES })
    }

    const sdk = await import('@vercel/blob')
    if (typeof sdk.issueSignedToken !== 'function' || typeof sdk.presignUrl !== 'function') {
      // 로컬에 오래된 SDK만 깔려 있을 때. 배포 환경은 package-lock의 2.x를 쓴다.
      return res.status(501).json({ error: '이 서버에서는 큰 파일 직접 올리기를 쓸 수 없습니다.' })
    }

    const month = new Date().toISOString().slice(0, 7)
    const pathname = `dah/uploads/${month}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
    const limits = { allowedContentTypes: [contentType], maximumSizeInBytes: CLIENT_UPLOAD_MAX_BYTES }
    const signed = await sdk.issueSignedToken({
      pathname,
      operations: ['put'],
      ...limits,
      validUntil: Date.now() + URL_TTL_MS,
      ...blobAuth(req),
    })
    const { presignedUrl } = await sdk.presignUrl(signed, {
      operation: 'put',
      pathname,
      access: 'public',
      ...limits,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    const storeId = sdk.parseStoreIdFromDelegationToken ? sdk.parseStoreIdFromDelegationToken(signed.delegationToken) : ''

    res.json({
      uploadUrl: presignedUrl,
      method: 'PUT',
      headers: {
        'content-type': contentType,
        'x-content-type': contentType,
        'x-vercel-blob-access': 'public',
        'x-api-version': BLOB_API_VERSION,
        ...(storeId ? { 'x-vercel-blob-store-id': storeId } : {}),
      },
      pathname,
      contentType,
      maxBytes: CLIENT_UPLOAD_MAX_BYTES,
      validUntil: signed.validUntil,
    })
  })
)

// 시험용 파일 정리: owner만, 이 저장소의 dah/ 아래 공개 파일만 지운다.
router.post(
  '/blob/delete',
  optionalAuth,
  wrap(async (req, res) => {
    if (!hasRole(req.user, 'owner')) return res.status(403).json({ error: 'owner만 지울 수 있습니다.' })
    if (!blobEnabled()) return res.status(503).json({ error: '파일 저장소가 연결되어 있지 않습니다.' })
    let u
    try {
      u = new URL(String(req.body?.url || ''))
    } catch {
      return res.status(400).json({ error: '주소가 올바르지 않습니다.' })
    }
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.public.blob.vercel-storage.com') || !u.pathname.startsWith('/dah/')) {
      return res.status(400).json({ error: '이 저장소의 dah/ 아래 파일만 지울 수 있습니다.' })
    }
    const { del } = await import('@vercel/blob')
    await del(u.toString(), blobAuth(req))
    res.json({ ok: true })
  })
)

export default router
