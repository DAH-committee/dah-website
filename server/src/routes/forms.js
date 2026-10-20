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
import { optionalAuth } from '../middleware/auth.js'
import { canDeleteFile, canManageTrash, daysLeft, formFile, identityOf, isOwnerOf, levelFor, purgeExpired, teamRoleOf, touchRecent, trashFile } from '../lib/wsAccess.js'
import { requirePublicAuth, optionalPublicAuth } from '../middleware/publicAuth.js'
import { submitLimiter } from '../middleware/rateLimit.js'
import { wrap } from './content.js'
import { normalizeFileStorage, publicFileStorage } from '../lib/formStorage.js'
import { attachUploads } from '../lib/driveConnections.js'
import { preflightForm } from '../lib/drivePreflight.js'
import { sendFormConfirmation } from '../lib/mailer.js'
import {
  FIELD_TYPES, LIMITS, cleanSettingsQuiz, expandColumns, cellValue, gradeResponse, normalizeExtras,
  pickData, resultForResponder, scoreVisible, quizOn, validateDefinition, validateResponse, scaleRange,
} from '../lib/formLogic.js'

export { validateResponse, scaleRange, pickData }

const router = Router()

// 디인예 폼 권한: 공유 설정(lib/wsAccess.js)으로 판단한다. need = 'viewer' | 'editor'
const formGuard = (need = 'viewer') => [
  optionalAuth,
  wrap(async (req, res, next) => {
    const file = await formFile(req.params.id)
    if (!file) return res.status(404).json({ error: 'not found' })
    const level = await levelFor(req, res, file)
    if (!level) return res.status(req.user || req.publicUser ? 403 : 401).json({ error: 'not allowed' })
    if (need === 'editor' && level !== 'editor') return res.status(403).json({ error: 'editor only' })
    req.formWs = file
    req.formLevel = level
    next()
  }),
]
const signedIn = [
  optionalAuth,
  wrap(async (req, res, next) => {
    const idn = await identityOf(req, res)
    if (!idn.emails.length) return res.status(401).json({ error: 'login required', hint: '구글 계정으로 로그인하세요.' })
    req.wsIdentity = idn
    next()
  }),
]

const CATEGORIES = ['event', 'recruit', 'other']


function asArray(v) {
  return Array.isArray(v) ? v : []
}

/** 필드 목록 정규화 — 저장 시 타입·순서를 정리하고 알 수 없는 키는 버린다 */
export function normalizeFields(raw) {
  return asArray(raw).slice(0, LIMITS.fields).map((f, i) => ({
    // 53_DRIVE_STORAGE: 파일 질문의 저장소 설정. 화이트리스트를 통과한 모양만 저장한다.
    // 설정이 없는 예전 폼은 storage 키를 만들지 않고 남긴다 — 폼 전역 Drive 설정을 그대로
    // 해석하는 런타임 폴백(normalizeFileStorage)이 살아 있어야 기존 폼이 그대로 동작한다.
    ...(f?.type === 'file' && f?.storage && typeof f.storage === 'object'
      ? { storage: normalizeFileStorage(f.storage, {}) }
      : {}),
    id: String(f?.id ?? `f${i + 1}`),
    label_ko: String(f?.label_ko ?? '').slice(0, LIMITS.label),
    label_en: f?.label_en ? String(f.label_en) : '',
    type: FIELD_TYPES.includes(f?.type) ? f.type : 'text',
    required: Boolean(f?.required),
    placeholder_ko: f?.placeholder_ko ? String(f.placeholder_ko) : '',
    placeholder_en: f?.placeholder_en ? String(f.placeholder_en) : '',
    hint_ko: f?.hint_ko ? String(f.hint_ko).slice(0, LIMITS.hint) : '',
    hint_en: f?.hint_en ? String(f.hint_en) : '',
    options: asArray(f?.options).slice(0, LIMITS.options).map((o) => String(o).slice(0, LIMITS.optionLen)),
    options_en: asArray(f?.options_en).map((o) => String(o)),
    // 새 기능 키(격자 행·열, 분기, 퀴즈 정답, 검증 규칙)는 허용 목록으로만 통과시킨다
    ...(() => {
      const x = normalizeExtras({ ...f, type: FIELD_TYPES.includes(f?.type) ? f.type : 'text' })
      const base = f?.validation && typeof f.validation === 'object' && !Array.isArray(f.validation) ? f.validation : {}
      // 예전 검증 키(maxLength, scale*)는 정리된 값으로 덮고, 알 수 없는 예전 키는 그대로 둔다
      const { rule: _r, shuffle: _s, other: _o, ratingMax: _m, ratingIcon: _i, noDuplicate: _n, requireEachRow: _q, ...legacy } = base
      return { ...x, validation: { ...legacy, ...x.validation } }
    })(),
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
 * 공개 폼 응답. 파일 질문은 "어디에 저장되는지"까지만 알려준다 —
 * 폴더 ID·연결 프로필 ID·공유 설정은 내리지 않는다(클라이언트가 경로를 조작할 여지를 없앤다).
 */
export function publicForm(row) {
  const settings = row.settings || {}
  const fields = asArray(row.fields).map((field) => {
    // 정답·해설은 제출 전에 절대 내려보내지 않는다. 배점만 보여 준다.
    const { quiz, ...rest } = field || {}
    const open = quiz?.points > 0 ? { ...rest, quiz: { points: quiz.points } } : rest
    if (open?.type !== 'file') return open
    const storage = normalizeFileStorage(open.storage, settings)
    return { ...open, storage: publicFileStorage(storage) }
  })
  const driveFields = fields.filter((f) => f?.type === 'file' && f?.storage?.target === 'drive')
  return {
    id: row.id,
    slug: row.slug,
    title_ko: row.title_ko,
    title_en: row.title_en,
    description_ko: row.description_ko,
    description_en: row.description_en,
    category: row.category,
    fields,
    settings: {
      ...settings,
      quiz: quizOn(settings) ? { enabled: true } : undefined,
      // 레거시 플래그 유지: 예전 클라이언트가 이 값으로 Drive 아이콘을 그린다
      drive_enabled: driveFields.length > 0,
      drive_auto_folder: driveFields.some((f) => f.storage.requires_course),
      drive_folder_id: undefined,
      drive_share_mode: undefined,
      drive_connection_id: undefined,
    },
    published: row.published,
  }
}

/** 응답자에게 돌려줄 응답 행: 점수(_quiz)는 공개 설정일 때만 */
export function responderRow(row, form) {
  if (!row) return row
  const { _quiz, ...data } = row.data || {}
  return { ...row, data: scoreVisible(form.settings) && _quiz ? { ...data, _quiz } : data }
}

/** 채점해 저장용 data 에 점수를 얹는다(클라이언트가 보낸 _quiz 는 pickData 가 이미 버린다) */
export function withScore(form, data) {
  const graded = gradeResponse(form.fields, data, form.settings)
  return { graded, data: graded ? { ...data, _quiz: graded } : data }
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

/** 제출된 값 중 파일 질문의 URL들 — pending 업로드를 attached로 바꿀 대상 */
function fileUrlsIn(fields, data) {
  const out = []
  for (const field of asArray(fields)) {
    if (field?.type !== 'file') continue
    const value = data?.[field.id]
    if (Array.isArray(value)) out.push(...value.map(String))
    else if (value) out.push(String(value))
  }
  return out
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
    const scored = withScore(form, pickData(form.fields, req.body?.data))

    const { rows } = await query(
      `INSERT INTO custom_form_responses (form_id, data, public_user_id, google_email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, form_id, data, google_email, submitted_at, updated_at`,
      [
        form.id,
        JSON.stringify(scored.data),
        req.publicUser?.id ?? null,
        req.publicUser?.email ?? null,
      ]
    )
    // 53_DRIVE_STORAGE: 폼 제출 전엔 파일이 pending으로 남아 있다. 생산된 응답에 실제로 담힌
    // 파일만 attached로 바꾼다. 버려진 업로드는 "미연결 업로드"로 살아남고 자동 삭제는 없다.
    try {
      await attachUploads({
        formId: form.id,
        responseId: rows[0].id,
        urls: fileUrlsIn(form.fields, rows[0].data),
        publicUserId: req.publicUser?.id ?? null,
        email: req.publicUser?.email ?? null,
      })
    } catch (err) {
      console.error('[forms] 업로드 상태 전환 실패(제출은 정상):', err.message)
    }
    // 확인 메일은 제출과 독립이다. 실패하거나 연결이 없어도 제출 응답은 성공한다.
    sendFormConfirmation({ form, response: rows[0] }).catch((err) =>
      console.error('[forms] 제출 확인 메일 실패:', err.message)
    )
    res.status(201).json({
      response: responderRow(rows[0], form),
      quiz: resultForResponder(form.fields, scored.graded, form.settings),
      confirmation_ko: form.settings?.confirmation_ko || '',
    })
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
    res.json({ responses: rows.map((r) => responderRow(r, form)), window: windowState(form.settings) })
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

    const scored = withScore(form, pickData(form.fields, req.body?.data))
    const { rows } = await query(
      `UPDATE custom_form_responses
       SET data = $1, public_user_id = COALESCE(public_user_id, $2), updated_at = now()
       WHERE id = $3
       RETURNING id, form_id, data, google_email, submitted_at, updated_at`,
      [JSON.stringify(scored.data), req.publicUser.id, id]
    )
    try {
      await attachUploads({
        formId: form.id,
        responseId: rows[0].id,
        urls: fileUrlsIn(form.fields, rows[0].data),
        publicUserId: req.publicUser?.id ?? null,
        email: req.publicUser?.email ?? null,
      })
    } catch (err) {
      console.error('[forms] 업로드 상태 전환 실패(수정은 정상):', err.message)
    }
    res.json({ response: responderRow(rows[0], form), quiz: resultForResponder(form.fields, scored.graded, form.settings) })
  })
)

// ── 어드민 ──────────────────────────────────────────────────

const FORM_COLUMNS = [
  'slug', 'title_ko', 'title_en', 'description_ko', 'description_en',
  'category', 'fields', 'settings', 'published',
]

/** 설정 JSON: 예전 키는 그대로 두고 새 키(퀴즈, 완료 문구)만 정리한다 */
function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  if (s.quiz !== undefined) s.quiz = cleanSettingsQuiz(s.quiz)
  if (s.confirmation_ko !== undefined) s.confirmation_ko = String(s.confirmation_ko ?? '').slice(0, 1000)
  return s
}

/** 새 기능(분기, 퀴즈, 격자, 규칙) 정의 검사. 문제가 있으면 한국어 목록을 돌려준다 */
function definitionIssues(body, existing) {
  if (body.fields === undefined && body.settings === undefined) return []
  const fields = body.fields !== undefined ? normalizeFields(body.fields) : asArray(existing?.fields)
  const settings = body.settings !== undefined ? normalizeSettings(body.settings) : existing?.settings || {}
  return validateDefinition(fields, settings)
}

function pickFormBody(body) {
  const data = {}
  for (const col of FORM_COLUMNS) {
    if (body[col] === undefined) continue
    if (col === 'fields') data.fields = JSON.stringify(normalizeFields(body.fields))
    else if (col === 'settings') data.settings = JSON.stringify(normalizeSettings(body.settings))
    else if (col === 'category') data.category = CATEGORIES.includes(body.category) ? body.category : 'other'
    else data[col] = body[col]
  }
  return data
}

// 목록: 내 목록(내가 만든 폼, 이메일로 공유받은 폼, 링크로 열어 본 폼) 또는 ?team=<id> 팀 목록(그 팀 폼 중 열 수 있는 것, 팀원만).
// ?trash=1 은 휴지통(지울 수 있는 폼만). 열 수 없는 폼은 이름도 보이지 않는다.
router.get(
  '/admin/forms',
  optionalAuth,
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    if (!idn.emails.length) return res.json({ items: [], total: 0 })
    const trash = req.query.trash === '1'
    let team = null
    if (req.query.team !== undefined) {
      team = parseInt(req.query.team, 10)
      if (!Number.isInteger(team) || team <= 0) return res.status(400).json({ error: 'invalid team' })
      if (!teamRoleOf(idn, team)) return res.status(403).json({ error: '팀원만 볼 수 있습니다' })
    }
    await purgeExpired().catch(() => {})
    const { rows } = await query(
      `SELECT f.*, (SELECT COUNT(*)::int FROM custom_form_responses r WHERE r.form_id = f.id) AS response_count
       FROM custom_forms f ORDER BY f.created_at DESC, f.id DESC`
    )
    const recent = new Set((await query('SELECT ws_id FROM ws_recent WHERE email = ANY($1::text[])', [idn.emails])).rows.map((r) => r.ws_id))
    const items = []
    for (const f of rows) {
      const ws = await formFile(f.id)
      if (Boolean(ws.deleted_at) !== trash) continue
      if (team && ws.team_id !== team) continue
      const probe = { ...ws, deleted_at: null }
      if (trash && !canManageTrash(idn, req.user, probe)) continue
      const level = await levelFor(req, res, probe)
      if (!level) continue
      if (!team) {
        const mine = isOwnerOf(idn, ws)
        const shared = (await query('SELECT 1 FROM ws_shares WHERE ws_id = $1 AND lower(email) = ANY($2::text[]) LIMIT 1', [ws.id, idn.emails])).rows[0]
        const opened = !trash && recent.has(ws.id)
        if (!mine && !shared && !opened) continue
      }
      items.push({
        ...f, ws_id: ws.id, my_role: level, mine: isOwnerOf(idn, ws), team_id: ws.team_id, can_delete: canDeleteFile(idn, req.user, probe),
        ...(trash ? { trashed: true, days_left: daysLeft(ws.deleted_at) } : {}),
      })
    }
    res.json({ items, total: items.length, team })
  })
)

router.get(
  '/admin/forms/:id',
  ...formGuard('viewer'),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    await touchRecent(req, res, req.formWs)
    res.json({ item: { ...rows[0], ws_id: req.formWs.id }, level: req.formLevel, canEdit: req.formLevel === 'editor', last_edit: req.formWs.last_edit || null })
  })
)

/**
 * 공개 사전검사. Drive 설정이 어주간한 폼이 공개되는 것을 막는다 — 제출은 들어오는데
 * 파일은 어느 폴더에도 없는 상황이 제일 위험하다. 관리자에겐 해결법이 등록된 문구로 돌려준다.
 * @returns {null|{issues:Array}} null이면 통과
 */
async function publishPreflight(body, existing) {
  const published = body.published === undefined ? existing?.published : Boolean(body.published)
  if (!published) return null
  const form = {
    id: existing?.id ?? null,
    slug: body.slug ?? existing?.slug ?? '',
    title_ko: body.title_ko ?? existing?.title_ko ?? '',
    category: body.category ?? existing?.category ?? 'other',
    fields: body.fields !== undefined ? normalizeFields(body.fields) : asArray(existing?.fields),
    settings: body.settings !== undefined ? (body.settings ?? {}) : (existing?.settings ?? {}),
  }
  let result = null
  try {
    result = await preflightForm(form, { deep: true })
  } catch (err) {
    // 사전검사 자신이 토해도 저장을 막지는 않는다(Drive 장어로 폼 편집이 마버리지 않도록).
    console.error('[forms] 공개 사전검사 오류:', err.message)
    return null
  }
  return result.ok ? null : result
}

router.post(
  '/admin/forms',
  ...signedIn,
  wrap(async (req, res) => {
    const data = pickFormBody(req.body || {})
    if (!data.slug || !data.title_ko) {
      return res.status(400).json({ error: 'slug and title_ko required' })
    }
    const defIssues = definitionIssues(req.body || {}, null)
    if (defIssues.length) return res.status(400).json({ error: defIssues[0].message, issues: defIssues })
    // team_id(선택): 내가 속한 팀에만 만들 수 있다
    let team = null
    if (req.body?.team_id !== undefined && req.body?.team_id !== null && req.body?.team_id !== '') {
      team = parseInt(req.body.team_id, 10)
      if (!Number.isInteger(team) || !teamRoleOf(req.wsIdentity, team)) return res.status(403).json({ error: '내가 속한 팀에만 만들 수 있습니다' })
    }
    const blocked = await publishPreflight(req.body || {}, null)
    if (blocked) {
      return res.status(422).json({
        error: '파일 저장소 설정을 마쳐야 공개할 수 있습니다.',
        issues: blocked.issues,
      })
    }
    const cols = Object.keys(data)
    const { rows } = await query(
      `INSERT INTO custom_forms (${cols.join(', ')}, created_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
       RETURNING *`,
      [...cols.map((c) => data[c]), req.user?.id ?? null]
    )
    // 만든 사람이 소유자. 새 폼은 "제한됨"으로 시작한다(구글 폼과 같음). 팀 공간에서 만들면 팀원 모두 편집자로 시작한다.
    const owner = String(req.user?.email || req.publicUser?.email || '').toLowerCase() || null
    const ws = await formFile(rows[0].id, {
      general_access: team ? 'team' : 'restricted',
      general_role: team ? 'editor' : 'viewer',
      owner_email: owner,
      created_by: req.user?.name || req.publicUser?.name || owner,
      team_id: team,
    })
    res.status(201).json({ item: { ...rows[0], ws_id: ws.id } })
  })
)

router.put(
  '/admin/forms/:id',
  ...formGuard('editor'),
  wrap(async (req, res) => {
    const data = pickFormBody(req.body || {})
    const cols = Object.keys(data)
    if (!cols.length) return res.status(400).json({ error: 'empty body' })
    const { rows: current } = await query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id])
    const defIssues = definitionIssues(req.body || {}, current[0] || null)
    if (defIssues.length) return res.status(400).json({ error: defIssues[0].message, issues: defIssues })
    // 편집 권한이 있으면 누구나 공개할 수 있다(파일 질문이 있어도 같다). 저장소 설정이 덜 되어 파일을 잃을 수 있을 때만 아래 사전검사가 막는다.
    const blocked = await publishPreflight(req.body || {}, current[0] || null)
    if (blocked) {
      return res.status(422).json({
        error: '파일 저장소 설정을 마쳐야 공개할 수 있습니다.',
        issues: blocked.issues,
      })
    }
    const { rows } = await query(
      `UPDATE custom_forms SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
       WHERE id = $${cols.length + 1} RETURNING *`,
      [...cols.map((c) => data[c]), req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    if (data.title_ko) await query('UPDATE ws_files SET title = $1, updated_at = now() WHERE form_id = $2', [data.title_ko, rows[0].id])
    res.json({ item: rows[0] })
  })
)

// 삭제: 휴지통으로 옮긴다(30일 보관, 복원 가능). 폼 소유자, 팀 폼이면 그 팀의 오너도 할 수 있다.
// 휴지통에 있는 동안은 응답 받기가 꺼지고, 복원하면 원래 상태로 돌아온다. 복원·영구 삭제는 /workspace/files/:wsId/restore, /permanent.
router.delete(
  '/admin/forms/:id',
  ...formGuard('viewer'),
  wrap(async (req, res) => {
    const idn = await identityOf(req, res)
    if (!canDeleteFile(idn, req.user, req.formWs)) return res.status(403).json({ error: '설문지를 만든 사람이나 팀 오너만 삭제할 수 있습니다' })
    await trashFile(req.formWs, req.user?.name || req.publicUser?.name || req.publicUser?.email)
    res.json({ ok: true, trashed: true, days: 30 })
  })
)

router.get(
  '/admin/forms/:id/responses',
  ...formGuard('viewer'),
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
  ...formGuard('editor'),
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
  ...formGuard('viewer'),
  wrap(async (req, res) => {
    const { rows: formRows } = await query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id])
    const form = formRows[0]
    if (!form) return res.status(404).json({ error: 'not found' })
    const { rows } = await query(
      `SELECT id, data, google_email, submitted_at FROM custom_form_responses
       WHERE form_id = $1 ORDER BY submitted_at DESC, id DESC`,
      [form.id]
    )
    const cols = expandColumns(form.fields)
    const quiz = quizOn(form.settings)
    const header = ['번호', '제출 계정', '제출 시각', ...cols.map((c) => c.label), ...(quiz ? ['점수', '만점'] : [])]
    const lines = [header.map(csvCell).join(',')]
    rows.forEach((r, i) => {
      lines.push(
        [
          i + 1,
          r.google_email ?? '',
          r.submitted_at ? new Date(r.submitted_at).toISOString() : '',
          ...cols.map((c) => cellValue(c, r.data)),
          ...(quiz ? [r.data?._quiz?.score ?? '', r.data?._quiz?.max ?? ''] : []),
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
