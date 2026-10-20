// routes/exhibitionSite.js: 학기별 전시회 사이트(별도 Vercel 도메인)가 쓰는 API.
//
//   GET  /exhibition-site/data?semester=2026-2      작품·과목·시상 (공개 전에는 관리자만 작품을 본다)
//   POST /exhibition-site/admin/login               관리자 로그인 → Bearer 토큰 (쿠키 없음, 다른 도메인에서 쓰기 위해)
//   PUT  /exhibition-site/admin/awards              시상 등록 (과목당 1개, 자리당 1개)
//   DELETE /exhibition-site/admin/awards/:id        시상 취소
//   그 밖에 공개 설정, 드라이브 재전송, 채점기준표, 교수님 공유
//
// 이 라우터는 앱 전역 CORS보다 먼저 붙는다. 어느 도메인에서든 읽을 수 있고, 쓰기는 Bearer 토큰으로만 한다.
import { Router } from 'express'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { jwtSecret } from '../middleware/auth.js'
import {
  authorOf,
  buildRubrics,
  driveStatus,
  entriesBySemester,
  getProfessors,
  listRubrics,
  MASTER_COURSE,
  normalizeProfessors,
  peopleOf,
  shareWithProfessors,
  subjectNames,
  syncPendingAll,
} from '../lib/exhibitionPipeline.js'
import { wrap } from './content.js'

const router = Router()
router.use(cors({ origin: true, credentials: false, allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], maxAge: 600 }))
router.use(express.json({ limit: '200kb' }))

const TOKEN_TYP = 'exhibit-admin'
const TOKEN_TTL = 12 * 60 * 60 // 시상식 당일 하루면 충분하다
const ADMIN_ROLES = ['owner', 'admin']

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

export function semesterOf(req) {
  const s = String(req.query?.semester || req.body?.semester || '').trim()
  if (!/^\d{4}-[12]$/.test(s)) throw httpError('semester는 2026-2 같은 형식이어야 합니다', 400)
  return s
}

// ── 관리자 인증 ─────────────────────────────────────────────

const loginTries = new Map()
function loginLimited(ip) {
  const now = Date.now()
  const rec = loginTries.get(ip) || { n: 0, t: now }
  if (now - rec.t > 10 * 60 * 1000) Object.assign(rec, { n: 0, t: now })
  rec.n++
  loginTries.set(ip, rec)
  return rec.n > 10
}

async function adminFromToken(req) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '')
  if (!m) return null
  try {
    const p = jwt.verify(m[1], jwtSecret())
    if (p.typ !== TOKEN_TYP) return null
    const { rows } = await query('SELECT id, email, name, role FROM users WHERE id = $1', [p.uid])
    const u = rows[0]
    return u && ADMIN_ROLES.includes(u.role) ? u : null
  } catch {
    return null
  }
}

async function requireAdmin(req, res, next) {
  try {
    const admin = await adminFromToken(req)
    if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요합니다' })
    req.admin = admin
    next()
  } catch (err) {
    next(err)
  }
}

router.post(
  '/admin/login',
  wrap(async (req, res) => {
    if (loginLimited(req.ip)) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 10분 뒤 다시 시도하세요' })
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요' })
    const { rows } = await query('SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = $1', [email])
    const u = rows[0]
    const ok = u?.password_hash ? await bcrypt.compare(password, u.password_hash) : false
    if (!ok) return res.status(401).json({ error: '이메일 또는 비밀번호가 맞지 않습니다' })
    if (!ADMIN_ROLES.includes(u.role)) return res.status(403).json({ error: '관리자(admin 이상) 계정만 로그인할 수 있습니다' })
    const token = jwt.sign({ typ: TOKEN_TYP, uid: u.id }, jwtSecret(), { expiresIn: TOKEN_TTL })
    res.json({ token, expiresIn: TOKEN_TTL, user: { name: u.name, email: u.email, role: u.role } })
  })
)

router.get('/admin/me', requireAdmin, (req, res) => {
  res.json({ user: { name: req.admin.name, email: req.admin.email, role: req.admin.role } })
})

// ── 사이트 설정 ─────────────────────────────────────────────

async function siteSettings(semester) {
  const { rows } = await query("SELECT value FROM site_settings WHERE key = 'exhibitionSite'")
  const all = rows[0]?.value && typeof rows[0].value === 'object' ? rows[0].value : {}
  return { all, mine: all[semester] || {} }
}

async function saveSiteSettings(semester, patch) {
  const { all, mine } = await siteSettings(semester)
  const next = { ...all, [semester]: { ...mine, ...patch } }
  await query(
    `INSERT INTO site_settings (key, value) VALUES ('exhibitionSite', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(next)]
  )
  return next[semester]
}

// ── 데이터 ──────────────────────────────────────────────────

async function uploadsFor(entryIds) {
  if (!entryIds.length) return []
  const { rows } = await query(
    `SELECT response_id, file_url, web_url, web_meta FROM form_file_uploads
      WHERE form_id IS NULL AND field_id = 'exhibition_original' AND status = 'attached' AND response_id = ANY($1::int[])`,
    [entryIds]
  )
  return rows
}

async function awardsFor(semester) {
  const { rows } = await query('SELECT id, rank, slot, entry_id, course FROM exhibition_awards WHERE semester_label = $1 ORDER BY rank, slot', [semester])
  return rows
}

/** 작품 목록과 과목 목록. 개인정보는 이름·학번·전공만 (이메일·연락처 제외) */
export async function buildSiteData(semester, { includeWorks }) {
  const order = await subjectNames(semester)
  const entries = await entriesBySemester(semester)
  const professors = await getProfessors()
  const counts = new Map()
  for (const e of entries) counts.set(String(e.fields?.course || '').trim(), (counts.get(String(e.fields?.course || '').trim()) || 0) + 1)
  const names = [...new Set([...order, ...counts.keys()].filter(Boolean))]
  const subjects = names.map((name) => ({ id: name, name, professor: professors[name]?.name || '', workCount: counts.get(name) || 0 }))

  const { mine } = await siteSettings(semester)
  const withWorks = subjects.filter((s) => s.workCount > 0).length
  const excellenceSlots = Number.isInteger(mine.excellenceSlots) ? mine.excellenceSlots : Math.max(0, withWorks - 1)
  const rows = await awardsFor(semester)
  const byEntry = new Map(rows.map((a) => [a.entry_id, a]))
  const item = (a) => (a ? { id: a.id, workId: String(a.entry_id), subjectId: a.course, subjectName: a.course, rank: a.rank, slot: a.slot } : null)
  const awards = {
    excellenceSlots,
    grand: item(rows.find((a) => a.rank === 'grand')),
    excellence: Array.from({ length: excellenceSlots }, (_, i) => item(rows.find((a) => a.rank === 'excellence' && a.slot === i))),
  }

  let works = []
  if (includeWorks) {
    const ups = await uploadsFor(entries.map((e) => e.id))
    const courseIndex = (c) => {
      const i = names.indexOf(c)
      return i === -1 ? 999 : i
    }
    works = entries
      .map((e) => {
        const f = e.fields || {}
        const order2 = (f.original_files || []).map((x) => x.url)
        const mine2 = ups.filter((u) => u.response_id === e.id && u.web_url).sort((a, b) => order2.indexOf(a.file_url) - order2.indexOf(b.file_url))
        const a = byEntry.get(e.id)
        return {
          id: String(e.id),
          subjectId: String(f.course || '').trim(),
          subjectName: String(f.course || '').trim(),
          title: String(f.work_title || '').trim(),
          author: authorOf(e),
          members: peopleOf(e),
          description: String(f.work_desc || '').trim(),
          links: Array.isArray(f.links) ? f.links : [],
          pages: mine2.map((u) => u.web_url),
          keycolor: mine2[0]?.web_meta?.keycolor || null,
          award: a?.rank || null,
          awardSlot: a ? a.slot : null,
        }
      })
      .sort((x, y) => courseIndex(x.subjectId) - courseIndex(y.subjectId) || Number(x.id) - Number(y.id))
  }

  const { rows: ord } = await query("SELECT value FROM site_settings WHERE key = 'exhibitionOrdinal'")
  const ordinal = Number(ord[0]?.value) || null
  return {
    semester,
    ordinal,
    title: ordinal ? `제${ordinal}회 디지털인문예술전공 프로젝트 전시회` : '디지털인문예술전공 프로젝트 전시회',
    public: Boolean(mine.public),
    subjects,
    works,
    awards,
    updatedAt: new Date().toISOString(),
  }
}

router.get(
  '/data',
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    const admin = await adminFromToken(req)
    const { mine } = await siteSettings(semester)
    const data = await buildSiteData(semester, { includeWorks: Boolean(admin) || Boolean(mine.public) })
    res.set('Cache-Control', 'no-store')
    res.json({ ...data, viewerIsAdmin: Boolean(admin) })
  })
)

// ── 시상 ────────────────────────────────────────────────────

router.put(
  '/admin/awards',
  requireAdmin,
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    const rank = req.body?.rank
    const slot = rank === 'grand' ? 0 : Number(req.body?.slot)
    const entryId = Number(req.body?.workId)
    if (!['grand', 'excellence'].includes(rank)) return res.status(400).json({ error: 'rank는 grand 또는 excellence입니다' })
    if (!Number.isInteger(entryId)) return res.status(400).json({ error: '작품을 골라 주세요' })
    const data = await buildSiteData(semester, { includeWorks: false })
    if (rank === 'excellence' && !(Number.isInteger(slot) && slot >= 0 && slot < data.awards.excellenceSlots)) {
      return res.status(400).json({ error: '우수상 자리 번호가 범위를 벗어났습니다' })
    }
    const { rows } = await query('SELECT id, fields FROM exhibition_entries WHERE id = $1 AND semester_label = $2', [entryId, semester])
    if (!rows[0]) return res.status(404).json({ error: '이 학기 작품이 아닙니다' })
    const course = String(rows[0].fields?.course || '').trim()
    const existing = await awardsFor(semester)
    if (existing.some((a) => a.rank === rank && a.slot === slot)) return res.status(409).json({ error: '이미 채워진 자리입니다. 먼저 취소하세요' })
    if (existing.some((a) => a.course === course)) return res.status(409).json({ error: `${course} 과목은 이미 수상했습니다` })
    try {
      await query(
        'INSERT INTO exhibition_awards (semester_label, rank, slot, entry_id, course, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [semester, rank, slot, entryId, course, req.admin.email]
      )
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: '같은 과목이나 자리에 이미 수상작이 있습니다' })
      throw err
    }
    res.json({ awards: (await buildSiteData(semester, { includeWorks: false })).awards })
  })
)

router.delete(
  '/admin/awards/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    await query('DELETE FROM exhibition_awards WHERE id = $1 AND semester_label = $2', [Number(req.params.id), semester])
    res.json({ awards: (await buildSiteData(semester, { includeWorks: false })).awards })
  })
)

// ── 관리 ────────────────────────────────────────────────────

router.put(
  '/admin/settings',
  requireAdmin,
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    const patch = {}
    if (typeof req.body?.public === 'boolean') patch.public = req.body.public
    if (req.body?.excellenceSlots !== undefined) {
      const n = Number(req.body.excellenceSlots)
      if (!Number.isInteger(n) || n < 0 || n > 40) return res.status(400).json({ error: '우수상 자리 수는 0~40입니다' })
      const used = (await awardsFor(semester)).filter((a) => a.rank === 'excellence' && a.slot >= n)
      if (used.length) return res.status(409).json({ error: '줄이려는 범위에 이미 수상작이 있습니다. 먼저 취소하세요' })
      patch.excellenceSlots = n
    }
    const saved = await saveSiteSettings(semester, patch)
    res.json({ settings: { public: Boolean(saved.public), excellenceSlots: saved.excellenceSlots ?? null } })
  })
)

router.get(
  '/admin/status',
  requireAdmin,
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    const data = await buildSiteData(semester, { includeWorks: false })
    const professors = await getProfessors()
    const rubrics = (await listRubrics(semester)).map((r) => ({
      course: r.course === MASTER_COURSE ? '전체' : r.course,
      url: r.sheet_url,
      folderUrl: r.folder_url,
      sharedWith: r.shared_with || [],
    }))
    res.json({
      settings: { public: data.public, excellenceSlots: data.awards.excellenceSlots },
      drive: await driveStatus(semester),
      rubrics,
      professors,
      courses: data.subjects.map((s) => s.name),
    })
  })
)

router.post(
  '/admin/drive-sync',
  requireAdmin,
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    res.json(await syncPendingAll({ limit: 200, semester }))
  })
)

router.post(
  '/admin/rubrics',
  requireAdmin,
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    res.json(await buildRubrics({ semester, force: req.body?.force === true }))
  })
)

router.put(
  '/admin/professors',
  requireAdmin,
  wrap(async (req, res) => {
    const professors = normalizeProfessors(req.body?.professors)
    await query(
      `INSERT INTO site_settings (key, value) VALUES ('exhibitionProfessors', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(professors)]
    )
    res.json({ professors })
  })
)

router.post(
  '/admin/share',
  requireAdmin,
  wrap(async (req, res) => {
    const semester = semesterOf(req)
    res.json(await shareWithProfessors({ semester }))
  })
)

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  res.status(err.status || 500).json({ error: err.status ? err.message : '서버 오류가 발생했습니다' })
})

export default router
