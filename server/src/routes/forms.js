// src/routes/forms.js — 자체 폼 시스템 (39_FORM_BUILDER F2)
//
// 공개:  GET  /forms/:slug                     폼 정의(응답 제외)
//        POST /forms/:slug/submit              응답 제출 (구글 로그인 + 기간 + 필드 검증)
//        GET  /forms/:slug/mine                본인 응답 조회
//        PUT  /forms/:slug/responses/:id       본인 응답 수정 (수정 기간 검증)
// 어드민: GET/POST /admin/forms, PUT/DELETE /admin/forms/:id,
//        GET /admin/forms/:id/responses, GET /admin/forms/:id/responses/export
//
// 본인 확인은 구글 로그인(public_users)이다 — 41_GOOGLE_AUTH_PUBLIC이 공개 제출자
// 비밀번호 방식을 폐지했으므로 39_FORM_BUILDER 원안의 edit_password_hash·비밀번호 초기화는
// 쓰지 않는다. 소유 판정은 public_user_id, 레거시 대비로 google_email도 함께 본다.
//
// 검증은 서버가 최종 권한이다. 클라이언트 검증은 사용자 편의일 뿐 신뢰하지 않는다.
import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { requirePublicAuth, optionalPublicAuth } from '../middleware/publicAuth.js'
import { submitLimiter } from '../middleware/rateLimit.js'
import { wrap } from './content.js'

const router = Router()

const FIELD_TYPES = [
  'text', 'textarea', 'select', 'radio', 'checkbox',
  'phone', 'email', 'studentid', 'file', 'date',
]
const CATEGORIES = ['event', 'recruit', 'other']

const PHONE_RE = /^010-\d{4}-\d{4}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STUDENT_ID_RE = /^\d{8}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function asArray(v) {
  return Array.isArray(v) ? v : []
}

/** 필드 목록 정규화 — 저장 시 타입·순서를 정리하고 알 수 없는 키는 버린다 */
function normalizeFields(raw) {
  return asArray(raw).map((f, i) => ({
    id: String(f?.id ?? `f${i + 1}`),
    label_ko: String(f?.label_ko ?? ''),
    label_en: f?.label_en ? String(f.label_en) : '',
    type: FIELD_TYPES.includes(f?.type) ? f.type : 'text',
    required: Boolean(f?.required),
    placeholder_ko: f?.placeholder_ko ? String(f.placeholder_ko) : '',
    placeholder_en: f?.placeholder_en ? String(f.placeholder_en) : '',
    hint_ko: f?.hint_ko ? String(f.hint_ko) : '',
    hint_en: f?.hint_en ? String(f.hint_en) : '',
    options: asArray(f?.options).map((o) => String(o)),
    options_en: asArray(f?.options_en).map((o) => String(o)),
    validation:
      f?.validation && typeof f.validation === 'object' && !Array.isArray(f.validation)
        ? f.validation
        : {},
    order: Number.isFinite(Number(f?.order)) ? Number(f.order) : i + 1,
  }))
}

function within(now, from, to) {
  if (!from || !to) return false
  return now >= new Date(from) && now <= new Date(to)
}

/** 제출·수정 가능 여부 — 서버 시계 기준. 클라 시계는 신뢰하지 않는다 */
function windowState(settings) {
  const s = settings || {}
  const now = new Date()
  return {
    can_submit: within(now, s.accept_start, s.accept_end),
    can_edit: within(now, s.accept_start, s.edit_end || s.accept_end),
    accept_start: s.accept_start ?? null,
    accept_end: s.accept_end ?? null,
    edit_end: s.edit_end ?? null,
  }
}

/**
 * 응답 값 검증 — 필드 정의 기준. 위반 목록을 배열로 돌려준다(빈 배열이면 통과).
 * checkbox는 배열, 그 외는 문자열로 다룬다.
 */
export function validateResponse(fields, data) {
  const errors = []
  const body = data && typeof data === 'object' && !Array.isArray(data) ? data : {}

  for (const f of asArray(fields)) {
    const raw = body[f.id]
    const isCheckbox = f.type === 'checkbox'
    const value = isCheckbox ? asArray(raw) : raw == null ? '' : String(raw).trim()
    const empty = isCheckbox ? value.length === 0 : value === ''

    if (f.required && empty) {
      errors.push({ field: f.id, error: 'required', label: f.label_ko })
      continue
    }
    if (empty) continue

    const max = Number(f.validation?.maxLength)
    if (Number.isFinite(max) && !isCheckbox && value.length > max) {
      errors.push({ field: f.id, error: 'maxLength', max, label: f.label_ko })
    }
    if (f.type === 'phone' && !PHONE_RE.test(value)) {
      errors.push({ field: f.id, error: 'phone', label: f.label_ko })
    }
    if (f.type === 'email' && !EMAIL_RE.test(value)) {
      errors.push({ field: f.id, error: 'email', label: f.label_ko })
    }
    if (f.type === 'studentid' && !STUDENT_ID_RE.test(value)) {
      errors.push({ field: f.id, error: 'studentid', label: f.label_ko })
    }
    if (f.type === 'date' && !DATE_RE.test(value)) {
      errors.push({ field: f.id, error: 'date', label: f.label_ko })
    }
    // 선택지형은 정의된 보기 안의 값만 받는다 — 임의 값 주입 차단
    if (['select', 'radio'].includes(f.type) && f.options.length && !f.options.includes(value)) {
      errors.push({ field: f.id, error: 'option', label: f.label_ko })
    }
    if (isCheckbox && f.options.length) {
      const bad = value.filter((v) => !f.options.includes(String(v)))
      if (bad.length) errors.push({ field: f.id, error: 'option', label: f.label_ko })
    }
  }
  return errors
}

/** 정의에 없는 키를 버리고 필드 순서대로 정리 — 임의 컬럼 주입 차단 */
function pickData(fields, data) {
  const body = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const out = {}
  for (const f of asArray(fields)) {
    if (body[f.id] === undefined) continue
    out[f.id] = f.type === 'checkbox' ? asArray(body[f.id]).map(String) : body[f.id]
  }
  return out
}

function publicForm(row) {
  const settings = row.settings || {}
  return {
    id: row.id,
    slug: row.slug,
    title_ko: row.title_ko,
    title_en: row.title_en,
    description_ko: row.description_ko,
    description_en: row.description_en,
    category: row.category,
    fields: row.fields,
    settings: {
      ...settings,
      drive_enabled: Boolean(settings.drive_enabled && settings.drive_folder_id),
      drive_folder_id: undefined,
      drive_share_mode: undefined,
    },
    published: row.published,
  }
}

/**
 * 조건부 구글 로그인 게이트 — settings.require_google_auth가 false인 폼은 로그인 없이 받는다.
 * 어드민 편집기에 있는 스위치가 실제로 동작해야 하므로 무조건 requirePublicAuth를 걸지 않는다.
 * 조회·수정(/mine, PUT)은 신원으로 본인을 찾는 동작이라 언제나 로그인이 필요하다.
 */
function googleGate(req, res, next) {
  optionalPublicAuth(req, res, () => {
    if (req.publicUser) return next()
    if (req.formRequiresAuth === false) return next()
    res.status(401).json({ error: 'google login required', loginPath: '/auth/google/login' })
  })
}

async function findBySlug(slug) {
  const { rows } = await query('SELECT * FROM custom_forms WHERE slug = $1', [slug])
  return rows[0] || null
}

// ── 공개 ────────────────────────────────────────────────────

// 헤더 버튼 연동용 — 공개 상태이고 헤더 노출을 켠 폼만. 정의 전체는 내리지 않는다.
router.get(
  '/forms',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT slug, title_ko, title_en, settings FROM custom_forms
       WHERE published = TRUE AND COALESCE((settings->>'show_button_in_header')::boolean, FALSE) = TRUE
       ORDER BY updated_at DESC, id DESC`
    )
    const now = new Date()
    // 접수 기간이 지난 폼의 버튼은 헤더에서 내린다
    const items = rows
      .filter((r) => within(now, r.settings?.accept_start, r.settings?.accept_end))
      .map((r) => ({
        slug: r.slug,
        title_ko: r.title_ko,
        title_en: r.title_en,
        button_label_ko: r.settings?.button_label_ko || r.title_ko,
        button_label_en: r.settings?.button_label_en || r.title_en || r.title_ko,
      }))
    res.json({ items })
  })
)

router.get(
  '/forms/:slug',
  wrap(async (req, res) => {
    const form = await findBySlug(req.params.slug)
    if (!form || !form.published) return res.status(404).json({ error: 'form not found' })
    res.json({ form: publicForm(form), window: windowState(form.settings) })
  })
)

router.post(
  '/forms/:slug/submit',
  submitLimiter,
  // 폼 설정을 먼저 읽어야 로그인 필요 여부를 알 수 있다 — 게이트 앞에 폼을 붙인다
  wrap(async (req, res, next) => {
    const form = await findBySlug(req.params.slug)
    if (!form || !form.published) return res.status(404).json({ error: 'form not found' })
    req.form = form
    req.formRequiresAuth = form.settings?.require_google_auth !== false
    next()
  }),
  googleGate,
  wrap(async (req, res) => {
    const form = req.form

    const state = windowState(form.settings)
    if (!state.can_submit) {
      return res.status(403).json({ error: 'submission period closed', window: state })
    }

    const max = Number(form.settings?.max_responses)
    if (Number.isFinite(max) && max > 0) {
      const { rows } = await query(
        'SELECT COUNT(*)::int AS n FROM custom_form_responses WHERE form_id = $1',
        [form.id]
      )
      if (rows[0].n >= max) return res.status(403).json({ error: 'response limit reached' })
    }

    const errors = validateResponse(form.fields, req.body?.data)
    if (errors.length) return res.status(400).json({ error: 'validation failed', errors })

    const { rows } = await query(
      `INSERT INTO custom_form_responses (form_id, data, public_user_id, google_email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, form_id, data, google_email, submitted_at, updated_at`,
      [
        form.id,
        JSON.stringify(pickData(form.fields, req.body?.data)),
        req.publicUser?.id ?? null,
        req.publicUser?.email ?? null,
      ]
    )
    res.status(201).json({ response: rows[0] })
  })
)

router.get(
  '/forms/:slug/mine',
  requirePublicAuth,
  wrap(async (req, res) => {
    const form = await findBySlug(req.params.slug)
    if (!form || !form.published) return res.status(404).json({ error: 'form not found' })
    const { rows } = await query(
      `SELECT id, form_id, data, google_email, submitted_at, updated_at
       FROM custom_form_responses
       WHERE form_id = $1 AND (public_user_id = $2 OR google_email = $3)
       ORDER BY submitted_at DESC`,
      [form.id, req.publicUser.id, req.publicUser.email]
    )
    res.json({ responses: rows, window: windowState(form.settings) })
  })
)

router.put(
  '/forms/:slug/responses/:id',
  submitLimiter,
  requirePublicAuth,
  wrap(async (req, res) => {
    const form = await findBySlug(req.params.slug)
    if (!form || !form.published) return res.status(404).json({ error: 'form not found' })

    const state = windowState(form.settings)
    if (!state.can_edit) return res.status(403).json({ error: 'edit period closed', window: state })

    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' })

    const { rows: found } = await query(
      'SELECT * FROM custom_form_responses WHERE id = $1 AND form_id = $2',
      [id, form.id]
    )
    const row = found[0]
    if (!row) return res.status(404).json({ error: 'response not found' })

    const owns =
      row.public_user_id === req.publicUser.id ||
      (row.google_email && row.google_email === req.publicUser.email)
    if (!owns) return res.status(403).json({ error: 'not your response' })

    const errors = validateResponse(form.fields, req.body?.data)
    if (errors.length) return res.status(400).json({ error: 'validation failed', errors })

    const { rows } = await query(
      `UPDATE custom_form_responses
       SET data = $1, public_user_id = COALESCE(public_user_id, $2), updated_at = now()
       WHERE id = $3
       RETURNING id, form_id, data, google_email, submitted_at, updated_at`,
      [JSON.stringify(pickData(form.fields, req.body?.data)), req.publicUser.id, id]
    )
    res.json({ response: rows[0] })
  })
)

// ── 어드민 ──────────────────────────────────────────────────

const FORM_COLUMNS = [
  'slug', 'title_ko', 'title_en', 'description_ko', 'description_en',
  'category', 'fields', 'settings', 'published',
]

function pickFormBody(body) {
  const data = {}
  for (const col of FORM_COLUMNS) {
    if (body[col] === undefined) continue
    if (col === 'fields') data.fields = JSON.stringify(normalizeFields(body.fields))
    else if (col === 'settings') data.settings = JSON.stringify(body.settings ?? {})
    else if (col === 'category') data.category = CATEGORIES.includes(body.category) ? body.category : 'other'
    else data[col] = body[col]
  }
  return data
}

router.get(
  '/admin/forms',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT f.*, (SELECT COUNT(*)::int FROM custom_form_responses r WHERE r.form_id = f.id) AS response_count
       FROM custom_forms f ORDER BY f.created_at DESC, f.id DESC`
    )
    res.json({ items: rows, total: rows.length })
  })
)

router.get(
  '/admin/forms/:id',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.post(
  '/admin/forms',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const data = pickFormBody(req.body || {})
    if (!data.slug || !data.title_ko) {
      return res.status(400).json({ error: 'slug and title_ko required' })
    }
    const cols = Object.keys(data)
    const { rows } = await query(
      `INSERT INTO custom_forms (${cols.join(', ')}, created_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
       RETURNING *`,
      [...cols.map((c) => data[c]), req.user.id]
    )
    res.status(201).json({ item: rows[0] })
  })
)

router.put(
  '/admin/forms/:id',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const data = pickFormBody(req.body || {})
    const cols = Object.keys(data)
    if (!cols.length) return res.status(400).json({ error: 'empty body' })
    const { rows } = await query(
      `UPDATE custom_forms SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
       WHERE id = $${cols.length + 1} RETURNING *`,
      [...cols.map((c) => data[c]), req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.delete(
  '/admin/forms/:id',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM custom_forms WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true })
  })
)

router.get(
  '/admin/forms/:id/responses',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { rows: formRows } = await query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id])
    const form = formRows[0]
    if (!form) return res.status(404).json({ error: 'not found' })
    const { rows } = await query(
      `SELECT id, data, google_email, submitted_at, updated_at
       FROM custom_form_responses WHERE form_id = $1 ORDER BY submitted_at DESC, id DESC`,
      [form.id]
    )
    // 시트 컬럼은 폼 정의에서 자동 생성한다 — 필드가 바뀌면 시트도 따라간다
    res.json({ form: publicForm(form), items: rows, total: rows.length })
  })
)

// 한 행사(폼)의 응답만 초기화한다. 다른 전시·모집 폼의 응답은 form_id가 달라 절대 섞이거나
// 삭제되지 않는다. 관리자 화면에서 제목과 건수를 다시 확인한 뒤 호출한다.
router.delete(
  '/admin/forms/:id/responses',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT id, title_ko FROM custom_forms WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    const result = await query('DELETE FROM custom_form_responses WHERE form_id = $1', [req.params.id])
    res.json({ ok: true, deleted: result.rowCount ?? 0, form: rows[0] })
  })
)

/** CSV 셀 이스케이프 — 쉼표·따옴표·줄바꿈이 있으면 감싼다 */
function csvCell(v) {
  const s = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

router.get(
  '/admin/forms/:id/responses/export',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { rows: formRows } = await query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id])
    const form = formRows[0]
    if (!form) return res.status(404).json({ error: 'not found' })
    const { rows } = await query(
      `SELECT id, data, google_email, submitted_at FROM custom_form_responses
       WHERE form_id = $1 ORDER BY submitted_at DESC, id DESC`,
      [form.id]
    )
    const fields = asArray(form.fields)
    const header = ['번호', '제출 계정', '제출 시각', ...fields.map((f) => f.label_ko)]
    const lines = [header.map(csvCell).join(',')]
    rows.forEach((r, i) => {
      lines.push(
        [
          i + 1,
          r.google_email ?? '',
          r.submitted_at ? new Date(r.submitted_at).toISOString() : '',
          ...fields.map((f) => r.data?.[f.id]),
        ]
          .map(csvCell)
          .join(',')
      )
    })
    // 엑셀이 UTF-8을 인식하도록 BOM을 붙인다
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="form-${form.slug}.csv"`)
    res.send(`﻿${lines.join('\n')}`)
  })
)

export default router
