// src/routes/settings.js — 설정 (12_BACKEND.md 8절)
// GET /settings/public — site_settings 전체 + 전시회 접수 노출 상태 계산 (히어로 버튼, 접수 버튼)
// PUT /admin/settings — manager+. site_settings upsert + exhibition_settings 갱신
import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { wrap } from './content.js'

const router = Router()

const EXHIBITION_COLS = ['submit_open', 'submit_close', 'edit_close', 'form_schema', 'header_visible', 'button_mode', 'drive_connection_id']

// Y3-1(33_PHASE18): 접수 폼 과목 목록. site_settings.exhibitionSubjects에 저장한다.
// 형태: [{ name: 'UX디자인', semester: 1 }] — semester는 1|2(학기 구분). 잘못된 값은 걸러낸다.
export function normalizeSubjects(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((s) => ({
      name: String(s?.name ?? '').trim(),
      semester: Number(s?.semester) === 2 ? 2 : 1,
    }))
    .filter((s) => s.name !== '')
}

// H2-2(37_SHEET_ROADMAP): 전시회 회차(ordinal). site_settings.exhibitionOrdinal에 저장한다.
// full_title("제N회 디지털인문예술전공 프로젝트 전시회") 조합은 클라이언트
// data/exhibitionTitle.js가 담당하므로 서버는 회차 숫자만 보관한다. 양의 정수 외에는 null.
export function normalizeOrdinal(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

// H2-4(37_SHEET_ROADMAP): 현재 접수 대상 학기(1|2). site_settings.exhibitionSemester.
// 접수 폼이 이 학기의 과목을 기본으로 노출한다. 잘못된 값은 1학기로 되돌린다.
export function normalizeSemester(value) {
  return Number(value) === 2 ? 2 : 1
}

// Y3-3(33_PHASE18): 콘텐츠 유형별 공개/비공개.
// site_settings.contentVisibility에 저장하고 GET /settings/public이 기본값과 병합해 내려준다.
// 포트폴리오는 기본 비공개 — 공개로 전환하면 공개 메뉴("학생 활동 > 포트폴리오")가 나타난다.
export const DEFAULT_VISIBILITY = {
  notice: true,
  resource: true,
  lecture: true,
  contest: true,
  exhibitions: true,
  achievement: true,
  club: true,
  portfolios: false,
  showcase: true,
  professors: true,
  mentors: true,
  curriculum: true,
  codesharing: true,
  nanodegree: true,
  ci: true,
  council: true,
  careers: true,
}

export function normalizeVisibility(value) {
  const next = { ...DEFAULT_VISIBILITY }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(DEFAULT_VISIBILITY)) {
      if (value[key] !== undefined) next[key] = value[key] === true
    }
  }
  return next
}

function computeExhibitionState(row, subjects = [], ordinal = null, currentSemester = 1) {
  if (!row) return null
  const now = new Date()
  const isSubmitPeriod =
    Boolean(row.submit_open && row.submit_close) &&
    now >= new Date(row.submit_open) &&
    now <= new Date(row.submit_close)
  const isEditPeriod =
    Boolean(row.submit_open && row.edit_close) &&
    now >= new Date(row.submit_open) &&
    now <= new Date(row.edit_close)
  return {
    submit_open: row.submit_open,
    submit_close: row.submit_close,
    edit_close: row.edit_close,
    header_visible: row.header_visible,
    button_mode: row.button_mode,
    // Y3-1: 접수 폼(Y2-4-8)이 읽는 과목 목록. settings.exhibitionSubjects와 동일 값이며
    // 접수 플로우가 exhibition 블록 하나만 보고 렌더할 수 있도록 여기에도 실어 보낸다.
    subjects,
    // H2-2·H2-4: 접수 안내/접수 폼이 읽는 회차와 현재 접수 대상 학기.
    // 값의 원본은 site_settings지만, 접수 플로우가 exhibition 블록 하나만 보고 렌더하도록 함께 싣는다.
    ordinal,
    current_semester: currentSemester,
    is_submit_period: isSubmitPeriod,
    is_edit_period: isEditPeriod,
    // J3: 노출 여부는 오직 설정 스위치가 결정 — 기간 검증은 제출 시점 서버(403)에서만
    show_button: row.header_visible === true,
  }
}

router.get(
  '/settings/public',
  wrap(async (req, res) => {
    const [settingsRes, exRes] = await Promise.all([
      query('SELECT key, value FROM site_settings', []),
      query('SELECT * FROM exhibition_settings WHERE id = 1', []),
    ])
    const settings = Object.fromEntries(settingsRes.rows.map((r) => [r.key, r.value]))
    const subjects = normalizeSubjects(settings.exhibitionSubjects)
    const ordinal = normalizeOrdinal(settings.exhibitionOrdinal)
    const semester = normalizeSemester(settings.exhibitionSemester)
    settings.exhibitionSubjects = subjects
    settings.exhibitionOrdinal = ordinal
    settings.exhibitionSemester = semester
    settings.contentVisibility = normalizeVisibility(settings.contentVisibility)
    res.json({
      settings,
      exhibition: computeExhibitionState(exRes.rows[0], subjects, ordinal, semester),
    })
  })
)

// 53_DRIVE_STORAGE(전시회 확장): 지금 연결된 Drive 프로필. GET /settings/public은 공개이라 connection_id를
// 내려보내지 않으므로, 관리자 화면 전용으로 따로 둔다.
router.get(
  '/admin/exhibition/drive',
  requireAuth,
  requireRole('manager'),
  wrap(async (req, res) => {
    const { rows } = await query('SELECT drive_connection_id FROM exhibition_settings WHERE id = 1', [])
    const connectionId = rows[0]?.drive_connection_id ?? null
    let connection = null
    if (connectionId) {
      const { rows: conn } = await query(
        'SELECT id, label, account_email, root_folder_id, root_folder_name, active FROM google_drive_connections WHERE id = $1',
        [connectionId]
      )
      connection = conn[0] || null
    }
    res.json({ connection_id: connectionId, connection })
  })
)

router.put(
  '/admin/settings',
  requireAuth,
  // 관리자 정책: manager와 admin은 모든 시스템 설정을 함께 관리한다.
  // owner만 사용자 전체·백업처럼 소유자 범위의 기능을 추가로 가진다.
  requireRole('manager'),
  wrap(async (req, res) => {
    const { settings, exhibition } = req.body || {}
    const result = { settings: {}, exhibition: null }

    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      for (const [key, raw] of Object.entries(settings)) {
        // Y3-1·Y3-3·H2-2·H2-4: 과목·공개·회차·학기는 저장 시점에 정규화(허용 키·타입만 통과)
        const value =
          key === 'exhibitionSubjects'
            ? normalizeSubjects(raw)
            : key === 'contentVisibility'
              ? normalizeVisibility(raw)
              : key === 'exhibitionOrdinal'
                ? normalizeOrdinal(raw)
                : key === 'exhibitionSemester'
                  ? normalizeSemester(raw)
                  : raw
        const { rows } = await query(
          `INSERT INTO site_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
           RETURNING key, value`,
          [key, value === null ? null : JSON.stringify(value)]
        )
        result.settings[rows[0].key] = rows[0].value
      }
    }

    if (exhibition && typeof exhibition === 'object' && !Array.isArray(exhibition)) {
      if (exhibition.button_mode !== undefined && !['header', 'floating'].includes(exhibition.button_mode)) {
        return res.status(400).json({ error: 'button_mode must be header or floating' })
      }
      const cols = EXHIBITION_COLS.filter((c) => exhibition[c] !== undefined)
      if (cols.length > 0) {
        const sets = cols.map((c, i) => `${c} = $${i + 1}`)
        const params = cols.map((c) =>
          c === 'form_schema' && exhibition[c] !== null ? JSON.stringify(exhibition[c]) : exhibition[c]
        )
        const { rows } = await query(
          `UPDATE exhibition_settings SET ${sets.join(', ')} WHERE id = 1 RETURNING *`,
          params
        )
        result.exhibition = computeExhibitionState(rows[0])
      }
    }

    res.json(result)
  })
)

export default router
