// src/routes/submit.js: 공개 제출 (12_BACKEND.md 5, 6절 + 41_AUTH_CONTRACT)
// 제출자 신원은 구글 로그인(requirePublicAuth)으로 확인한다. 비밀번호 방식은 폐지했고
// 이메일은 본문이 아니라 로그인 계정에서 서버가 채운다(본문의 email, password는 무시).
// 전시회 접수: POST/PUT /submit/exhibition (기간은 서버 시계로 검증, readonly 필드 보호)
// 본인 접수 목록: GET /submit/exhibition/mine (구 POST /exhibition/list, /exhibition/lookup 대체)
// 쇼케이스: POST /submit/showcase, PUT /submit/showcase/:id (status pending)
import { Router } from 'express'
import { query } from '../db.js'
import { requirePublicAuth } from '../middleware/publicAuth.js'
import { submitLimiter } from '../middleware/rateLimit.js'
import { sendExhibitionConfirmation } from '../lib/mailer.js'
import { attachExhibitionUploads } from '../lib/driveConnections.js'
import { wrap } from './content.js'

const router = Router()

const MAX_ENTRY_IMAGES = 5 // 접수 1건당 이미지 개수 상한 (용량은 /upload에서 제한)
const MAX_SHOWCASE_SUB_IMGS = 2

// 전시회 접수 readonly 보호 대상 (12_BACKEND 5절: 참가 유형·과목·이메일은 수정 불가)
const READONLY_TOP = ['entry_type', 'email']
const READONLY_FIELD_KEYS = ['entry_type', 'entryType', 'email', 'subject', 'course']

async function getExhibitionSettings() {
  const { rows } = await query('SELECT * FROM exhibition_settings WHERE id = 1')
  return rows[0] || null
}

function within(now, from, to) {
  if (!from || !to) return false
  return now >= new Date(from) && now <= new Date(to)
}

// submit_open 기준 학기 라벨 산출 (예: 2026-11 → '2026-2')
function semesterLabelFrom(settings) {
  if (!settings?.submit_open) return null
  const d = new Date(settings.submit_open)
  return `${d.getFullYear()}-${d.getMonth() + 1 >= 7 ? 2 : 1}`
}

function stripSensitive(row) {
  if (!row) return row
  const { pw_hash, edit_pw_hash, ...rest } = row
  return rest
}

function validImages(images) {
  return (
    images === undefined ||
    (Array.isArray(images) && images.length <= MAX_ENTRY_IMAGES && images.every((u) => typeof u === 'string'))
  )
}

const MAX_ORIGINAL_FILES = 10

// 53_DRIVE_STORAGE(전시회 확장): 원본 파일 목록 형태 검증. url·name만 받고 나머지는 무시한다
// (폴더 ID·연결 ID 같은 값을 클라이언트가 직접 보내도 서버는 밑지 않는다).
function validOriginalFiles(files) {
  return (
    files === undefined ||
    (Array.isArray(files) &&
      files.length <= MAX_ORIGINAL_FILES &&
      files.every((f) => f && typeof f.url === 'string' && f.url.trim()))
  )
}

function sanitizeOriginalFiles(files) {
  if (!Array.isArray(files)) return undefined
  return files
    .filter((f) => f && typeof f.url === 'string' && f.url.trim())
    .slice(0, MAX_ORIGINAL_FILES)
    .map((f) => ({ url: String(f.url).trim(), name: String(f.name || '').slice(0, 200) }))
}

/**
 * 과목 값 서버 검증 — 저장된 과목 목록(site_settings.exhibitionSubjects)에 있는 값만 통과시킨다.
 * 목록이 비어 있는 학기(자유 입력 폴백)는 검증을 건너뛴다.
 */
async function validCourse(course) {
  const value = String(course || '').trim()
  if (!value) return true // 필수 여부는 클라이언트 canSubmit이 막는다 — 여기선 형식만 본다
  const { rows } = await query("SELECT value FROM site_settings WHERE key = 'exhibitionSubjects'", [])
  const raw = rows[0]?.value
  const names = (Array.isArray(raw) ? raw : [])
    .map((s) => String(s?.name ?? '').trim())
    .filter(Boolean)
  if (!names.length) return true
  return names.includes(value)
}

// 접수, 수정 기간 게이트. 통과한 설정 행은 핸들러가 재조회하지 않도록 req에 실어 보낸다.
// 기간 판정을 로그인 게이트보다 앞에 두는 이유: 이미 마감된 접수인데 구글 동의부터
// 요구하면 사용자가 로그인을 마친 뒤에야 마감 사실을 알게 된다.
function requireWindow(kind) {
  const isEdit = kind === 'edit'
  return wrap(async (req, res, next) => {
    const settings = await getExhibitionSettings()
    const now = new Date()
    // 수정은 edit_close까지 허용 (submit_close 이후부터 edit_close 사이에도 가능)
    const close = isEdit ? settings?.edit_close : settings?.submit_close
    if (!settings || !within(now, settings.submit_open, close)) {
      return res.status(403).json({
        error: isEdit ? 'edit period closed' : 'submission period closed',
        schedule: settings
          ? isEdit
            ? { submit_open: settings.submit_open, edit_close: settings.edit_close }
            : { submit_open: settings.submit_open, submit_close: settings.submit_close }
          : null,
      })
    }
    req.exhibitionSettings = settings
    next()
  })
}

// 접수 소유 검증. public_user_id가 있으면 그것만 본다.
// 구글 로그인 이전 접수에는 소유자가 없으므로 이메일이 같으면 본인으로 인정하고 그 자리에서
// public_user_id를 백필한다. 이 승계가 없으면 기존 접수자가 자기 접수에 접근할 수 없다.
// 사용자 원문 데이터(fields, images, email)는 건드리지 않는다.
async function ownsEntry(entry, user) {
  if (entry.public_user_id != null) return Number(entry.public_user_id) === Number(user.id)
  if (String(entry.email || '').toLowerCase() !== String(user.email).toLowerCase()) return false
  await query(
    'UPDATE exhibition_entries SET public_user_id = $1 WHERE id = $2 AND public_user_id IS NULL',
    [user.id, entry.id]
  )
  entry.public_user_id = user.id
  return true
}

// ── 전시회 접수 ──────────────────────────────────────────────

router.post(
  '/exhibition',
  submitLimiter,
  requireWindow('submit'),
  requirePublicAuth,
  wrap(async (req, res) => {
    const { entry_type, fields, images } = req.body || {}
    if (!['solo', 'team'].includes(entry_type)) return res.status(400).json({ error: 'entry_type must be solo or team' })
    if (fields !== undefined && (typeof fields !== 'object' || fields === null || Array.isArray(fields))) {
      return res.status(400).json({ error: 'fields must be an object' })
    }
    if (!validImages(images)) {
      return res.status(400).json({ error: `images must be an array of at most ${MAX_ENTRY_IMAGES} urls` })
    }
    if (!validOriginalFiles(fields?.original_files)) {
      return res.status(400).json({ error: `original_files must be an array of at most ${MAX_ORIGINAL_FILES} items` })
    }
    // 임의 과목명이 곷 폴더명이 되는 것을 막는다 — 저장된 과목 목록 외의 값은 거부한다.
    if (fields?.course !== undefined && !(await validCourse(fields.course))) {
      return res.status(400).json({ error: 'course must be one of the registered subjects' })
    }

    const mergedFields = fields ? { ...fields, original_files: sanitizeOriginalFiles(fields.original_files) } : fields
    const { rows } = await query(
      `INSERT INTO exhibition_entries (semester_label, entry_type, fields, email, images, public_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, semester_label, entry_type, fields, email, images, created_at, updated_at`,
      [
        semesterLabelFrom(req.exhibitionSettings),
        entry_type,
        mergedFields ? JSON.stringify(mergedFields) : null,
        String(req.publicUser.email).trim().toLowerCase(),
        images ? JSON.stringify(images) : JSON.stringify([]),
        req.publicUser.id,
      ]
    )
    const entry = rows[0]

    // 업로드 당시 pending으로 남은 원본 파일을 이 접수 건으로 확정한다. 제출되지 않은 업로드는
    // 그대로 pending으로 남아 관리 화면에서 보인다(자동 삭제 없음).
    try {
      await attachExhibitionUploads({
        entryId: entry.id,
        urls: (mergedFields?.original_files || []).map((f) => f.url),
        publicUserId: req.publicUser.id,
        email: req.publicUser.email,
      })
    } catch (err) {
      console.error('[submit/exhibition] 업로드 상태 전환 실패(접수는 정상):', err.message)
    }

    // 확인 메일은 접수와 독립. 실패해도 접수 응답은 성공하고 SMTP 미설정이면 조용히 스킵된다.
    sendExhibitionConfirmation(entry).catch((err) =>
      console.error('[submit/exhibition] 접수 확인 메일 실패:', err.message)
    )

    res.status(201).json({ entry })
  })
)

router.put(
  '/exhibition',
  submitLimiter,
  requireWindow('edit'),
  requirePublicAuth,
  wrap(async (req, res) => {
    const { id, fields, images } = req.body || {}
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'entry id required' })
    if (!validImages(images)) {
      return res.status(400).json({ error: `images must be an array of at most ${MAX_ENTRY_IMAGES} urls` })
    }
    if (!validOriginalFiles(fields?.original_files)) {
      return res.status(400).json({ error: `original_files must be an array of at most ${MAX_ORIGINAL_FILES} items` })
    }

    const { rows } = await query('SELECT * FROM exhibition_entries WHERE id = $1', [id])
    const entry = rows[0]
    if (!entry) return res.status(404).json({ error: 'entry not found' })
    if (!(await ownsEntry(entry, req.publicUser))) {
      return res.status(403).json({ error: 'not your entry' })
    }

    // readonly 필드 보호: 참가 유형·과목·이메일은 PUT에서 무시하고 로그 (12_BACKEND 5절)
    const ignoredTop = READONLY_TOP.filter((k) => req.body[k] !== undefined && req.body[k] !== entry[k])
    let mergedFields = entry.fields || {}
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
      const incoming = { ...fields }
      const ignoredFieldKeys = []
      for (const key of READONLY_FIELD_KEYS) {
        if (key in incoming) {
          ignoredFieldKeys.push(key)
          delete incoming[key]
        }
      }
      if (ignoredTop.length > 0 || ignoredFieldKeys.length > 0) {
        console.warn(
          `[submit/exhibition] entry ${entry.id}: readonly 필드 수정 시도 무시 —`,
          [...ignoredTop, ...ignoredFieldKeys.map((k) => `fields.${k}`)].join(', ')
        )
      }
      // readonly 키는 기존 값 유지
      mergedFields = { ...mergedFields, ...incoming }
      for (const key of READONLY_FIELD_KEYS) {
        if (entry.fields && key in entry.fields) mergedFields[key] = entry.fields[key]
      }
    }
    if (fields?.original_files !== undefined) {
      mergedFields.original_files = sanitizeOriginalFiles(fields.original_files)
    }

    const updated = await query(
      `UPDATE exhibition_entries
       SET fields = $1, images = COALESCE($2, images), updated_at = now()
       WHERE id = $3
       RETURNING id, semester_label, entry_type, fields, email, images, created_at, updated_at`,
      [JSON.stringify(mergedFields), images ? JSON.stringify(images) : null, entry.id]
    )
    try {
      await attachExhibitionUploads({
        entryId: entry.id,
        urls: (mergedFields.original_files || []).map((f) => f.url),
        publicUserId: req.publicUser.id,
        email: req.publicUser.email,
      })
    } catch (err) {
      console.error('[submit/exhibition] 업로드 상태 전환 실패(수정은 정상):', err.message)
    }
    res.json({ entry: updated.rows[0] })
  })
)

// 본인 접수 목록 (41_AUTH_CONTRACT). 수정 마감 판정(can_edit)은 서버 시계로 함께 내려주지만
// 실제 저장 차단의 최종 권한은 PUT /submit/exhibition의 403이다.
router.get(
  '/exhibition/mine',
  requirePublicAuth,
  wrap(async (req, res) => {
    const user = req.publicUser
    const email = String(user.email).trim().toLowerCase()
    const { rows } = await query(
      `SELECT * FROM exhibition_entries
       WHERE public_user_id = $1 OR (public_user_id IS NULL AND email = $2)
       ORDER BY created_at DESC`,
      [user.id, email]
    )

    // 이메일로 찾은 옛 접수는 여기서 소유자를 확정해 둔다 (승계)
    const legacyIds = rows.filter((r) => r.public_user_id == null).map((r) => r.id)
    if (legacyIds.length > 0) {
      await query(
        'UPDATE exhibition_entries SET public_user_id = $1 WHERE id = ANY($2::int[]) AND public_user_id IS NULL',
        [user.id, legacyIds]
      )
    }

    const settings = await getExhibitionSettings()
    const now = new Date()
    res.json({
      entries: rows.map(stripSensitive),
      can_edit: Boolean(settings) && within(now, settings.submit_open, settings.edit_close),
      edit_close: settings?.edit_close ?? null,
      submit_close: settings?.submit_close ?? null,
    })
  })
)

// ── 쇼케이스 제출 ──────────────────────────────────────────────

const SHOWCASE_FIELDS = ['title', 'topic', 'creator', 'description', 'tools', 'link', 'main_img', 'sub_imgs', 'semester_label']

function validateShowcaseBody(body, { creating }) {
  if (creating) {
    if (!body.title) return 'title required'
    if (!body.creator) return 'creator required'
    if (!body.main_img) return 'main_img required'
  }
  if (body.tools !== undefined && !Array.isArray(body.tools)) return 'tools must be an array'
  if (body.sub_imgs !== undefined) {
    if (!Array.isArray(body.sub_imgs) || body.sub_imgs.length > MAX_SHOWCASE_SUB_IMGS) {
      return `sub_imgs must be an array of at most ${MAX_SHOWCASE_SUB_IMGS} urls`
    }
  }
  return null
}

router.post(
  '/showcase',
  submitLimiter,
  requirePublicAuth,
  wrap(async (req, res) => {
    const body = req.body || {}
    const invalid = validateShowcaseBody(body, { creating: true })
    if (invalid) return res.status(400).json({ error: invalid })

    const { rows } = await query(
      `INSERT INTO showcase (title, topic, creator, description, tools, link, main_img, sub_imgs, semester_label, public_user_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING id, title, topic, creator, description, tools, link, main_img, sub_imgs, semester_label, status, created_at`,
      [
        body.title,
        body.topic ?? null,
        body.creator,
        body.description ?? null,
        JSON.stringify(body.tools ?? []),
        body.link ?? null,
        body.main_img,
        JSON.stringify(body.sub_imgs ?? []),
        body.semester_label ?? null,
        req.publicUser.id,
      ]
    )
    res.status(201).json({ item: rows[0] })
  })
)

router.put(
  '/showcase/:id',
  submitLimiter,
  requirePublicAuth,
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' })
    const body = req.body || {}
    const invalid = validateShowcaseBody(body, { creating: false })
    if (invalid) return res.status(400).json({ error: invalid })

    const { rows } = await query('SELECT * FROM showcase WHERE id = $1', [id])
    const item = rows[0]
    if (!item) return res.status(404).json({ error: 'not found' })
    // 쇼케이스에는 이메일 컬럼이 없어 전시회 접수 같은 이메일 승계가 불가능하다.
    // 구글 로그인 이전 제출(public_user_id 없음)은 어드민 경로로만 수정한다.
    if (item.public_user_id == null || Number(item.public_user_id) !== Number(req.publicUser.id)) {
      return res.status(403).json({ error: 'not your submission' })
    }

    const sets = []
    const params = []
    for (const col of SHOWCASE_FIELDS) {
      if (body[col] === undefined) continue
      params.push(['tools', 'sub_imgs'].includes(col) ? JSON.stringify(body[col]) : body[col])
      sets.push(`${col} = $${params.length}`)
    }
    if (sets.length === 0) return res.status(400).json({ error: 'empty body' })
    // published 상태에서 수정하면 재승인 큐로 회수 (반달 방지)
    if (item.status === 'published') sets.push(`status = 'pending'`)

    params.push(id)
    const updated = await query(
      `UPDATE showcase SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, title, topic, creator, description, tools, link, main_img, sub_imgs, semester_label, status, created_at`,
      params
    )
    res.json({ item: updated.rows[0], requeued: item.status === 'published' })
  })
)

export default router
