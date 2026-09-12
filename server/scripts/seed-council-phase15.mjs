// scripts/seed-council-phase15.mjs — 운영위원회 전면 재시드 (29_PHASE15 T1)
// 절대 원칙: council_SOURCE.md의 국문 원문(기수 타이틀·소개·부서·멤버·소속·학번)을 토씨 하나
// 바꾸지 않는다. .md를 직접 파싱해 KR을 만들고, 영문(titleEn·introEn·멤버 nameEn)은 기존
// data/council.js(검수 완료분)에서 재사용, 소속 EN·부서 EN은 매핑으로 생성.
//   - 기존 council 전부 삭제 후 이 파일 기준으로만 재생성(배포 Neon). 업로드된 logo_url·has_bg는 보존.
//   - client/src/data/council.js(정적 폴백)도 동일 파싱으로 재생성.
//   - 시드 후 2026·2023·2019 세 기수 문자 대조.
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SOURCE = path.join(ROOT, 'docs/client/council_SOURCE.md')
const OUT = path.join(ROOT, 'client/src/data/council.js')

if (!process.env.DATABASE_URL) {
  console.error('[seed-council] DATABASE_URL이 없습니다.')
  process.exit(1)
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
})

// 부서(역할) 영문
const ROLE_EN = {
  위원장: 'Chair', 부위원장: 'Vice Chair',
  학회장: 'President', 부학회장: 'Vice President',
  회장: 'President', 부회장: 'Vice President',
  전시: 'Exhibition', 대외: 'External Affairs', 홍보: 'PR', 기획: 'Planning', 디자인: 'Design',
  총괄: 'Coordination', 기획팀: 'Planning Team', 홍보팀: 'PR Team',
  기획국장: 'Planning Director', 총무국장: 'General Affairs Director', 홍보국장: 'PR Director',
  기획부장: 'Planning Manager', 기획부: 'Planning', 홍보부: 'PR', 웹전시부: 'Web Exhibition',
}
// 소속 EN — 이미 영문(Digital Arts & Humanities)은 그대로, 국문 학과만 매핑. 학번 보존.
const DEPT_EN = {
  사회학과: 'Sociology', 광고홍보: 'Advertising & PR', 경영학과: 'Business Administration',
  디지털미디어콘텐츠: 'Digital Media Contents', 디지털인문예술: 'Digital Arts & Humanities',
  디지털인문예술전공: 'Digital Arts & Humanities',
}
function majorsEnOf(majors) {
  if (!majors) return null
  if (/^Digital Arts & Humanities/.test(majors)) return majors
  const num = (majors.match(/\d+$/) || [''])[0]
  const prefix = majors.slice(0, majors.length - num.length).trim()
  const en = DEPT_EN[prefix] || prefix
  return num ? `${en} ${num}` : en
}

function parseSource(text) {
  const lines = text.split(/\r?\n/)
  const terms = []
  let cur = null
  for (const raw of lines) {
    const hm = /^##\s+(.+?)\s*$/.exec(raw)
    if (hm) {
      cur = { title: hm[1], intro: null, members: [] }
      const year = parseInt(hm[1], 10)
      cur.year = year
      cur.name = hm[1].replace(/^\d+\s+/, '') // 연도 제외 기수명
      terms.push(cur)
      continue
    }
    if (!cur) continue
    const im = /^소개:\s*(.*)$/.exec(raw)
    if (im) { cur.intro = im[1]; continue }
    const rm = /^([^:]+):\s*(.+)$/.exec(raw)
    if (rm) {
      const role = rm[1].trim()
      for (const chunk of rm[2].split(',')) {
        const s = chunk.trim()
        if (!s) continue
        const pm = /^(.+?)\((.+)\)$/.exec(s)
        cur.members.push(
          pm ? { role, name: pm[1].trim(), majors: pm[2].trim() } : { role, name: s, majors: null }
        )
      }
    }
  }
  return terms
}

async function main() {
  const { councils: prev } = await import(pathToFileURL(OUT).href)
  const titleEnByYear = {}
  const introEnByYear = {}
  const nameEnByName = {}
  for (const c of prev) {
    if (c.titleEn) titleEnByYear[c.year] = c.titleEn
    if (c.introEn) introEnByYear[c.year] = c.introEn
    for (const m of c.members || []) if (m.nameEn) nameEnByName[m.name] = m.nameEn
  }

  const terms = parseSource(fs.readFileSync(SOURCE, 'utf8'))
  const missingNameEn = new Set()
  for (const term of terms) {
    term.titleEn = titleEnByYear[term.year] || `${term.year} ${term.name}`
    term.introEn = introEnByYear[term.year] || null
    for (const m of term.members) {
      m.roleEn = ROLE_EN[m.role] || m.role
      m.nameEn = nameEnByName[m.name] || null
      m.majorsEn = majorsEnOf(m.majors)
      if (!m.nameEn) missingNameEn.add(m.name)
    }
  }
  console.log(`[seed-council] 파싱 ${terms.length}기수, 멤버 ${terms.reduce((n, t) => n + t.members.length, 0)}명`)
  if (missingNameEn.size) console.log('  ✗ nameEn 없음:', [...missingNameEn].join(', '))

  const client = await pool.connect()
  try {
    // 업로드된 로고·배경 보존 (year_label 기준)
    const existing = await client.query('SELECT year_label, logo_url, has_bg FROM council')
    const logoByYear = {}
    for (const r of existing.rows) logoByYear[String(r.year_label)] = { logo_url: r.logo_url, has_bg: r.has_bg }

    await client.query('BEGIN')
    await client.query('DELETE FROM council')
    for (let i = 0; i < terms.length; i += 1) {
      const t = terms[i]
      const keep = logoByYear[String(t.year)] || {}
      const members = t.members.map((m) => {
        const o = { role: m.role, name: m.name, roleEn: m.roleEn, nameEn: m.nameEn }
        if (m.majors) { o.majors = m.majors; o.majorsEn = m.majorsEn }
        return o
      })
      await client.query(
        `INSERT INTO council (name, intro, members, year_label, sort, logo_url, has_bg)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
        [t.name, t.intro, JSON.stringify(members), String(t.year), i, keep.logo_url ?? null, keep.has_bg ?? false]
      )
    }
    await client.query('COMMIT')
    console.log(`[seed-council] DB 재시드 완료 (${terms.length}기수)`)

    // 정적 폴백 재생성
    const header = `/**
 * council.js — 운영위원회·역대 학생회 (client/docs/council_SOURCE.md 원문 그대로, 자동 생성)
 * seed-council-phase15.mjs가 소스를 파싱해 재생성한다. 손으로 편집하지 말 것.
 * councils: 2026(현 LUCID) 맨 앞 → 2017. title=연도 제외 기수명, titleEn=연도 포함 영문.
 *   members: [{ role, name, majors?, roleEn, nameEn, majorsEn? }]. 국문은 원문 그대로.
 */
export const councils = [
`
    const body = terms
      .map((t) => {
        const members = t.members.map((m) => {
          const o = { role: m.role, name: m.name, roleEn: m.roleEn, nameEn: m.nameEn }
          if (m.majors) { o.majors = m.majors; o.majorsEn = m.majorsEn }
          return o
        })
        return '  ' + JSON.stringify({
          year: t.year, title: t.name, titleEn: t.titleEn,
          intro: t.intro, introEn: t.introEn, members,
        }) + ','
      })
      .join('\n')
    fs.writeFileSync(OUT, header + body + '\n]\n', 'utf8')
    console.log('[seed-council] 정적 폴백 재생성:', path.relative(ROOT, OUT))

    // 문자 대조 2026·2023·2019
    const check = await client.query(
      "SELECT year_label, name, intro, members FROM council ORDER BY sort"
    )
    const byYear = {}
    for (const r of check.rows) byYear[r.year_label] = r
    let ok = true
    for (const y of ['2026', '2023', '2019']) {
      const src = terms.find((t) => String(t.year) === y)
      const db = byYear[y]
      const introMatch = (db.intro ?? null) === (src.intro ?? null)
      const memberMatch =
        db.members.length === src.members.length &&
        db.members.every((m, k) => m.name === src.members[k].name &&
          m.role === src.members[k].role && (m.majors ?? null) === (src.members[k].majors ?? null))
      ok = ok && introMatch && memberMatch
      console.log(`[대조 ${y}] intro ${introMatch ? '✓' : '✗'} / members(${db.members.length}) ${memberMatch ? '✓' : '✗'}`)
    }
    console.log(ok ? '[seed-council] 문자 대조 3기수 전부 일치 ✓' : '[seed-council] 대조 불일치 ✗')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[seed-council] 실패:', err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}
main()
