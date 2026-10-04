// annual-snapshot.mjs: 애뉴얼 리포트가 쓰는 사이트 데이터를 라이브 API에서 받아 siteSnapshot.json으로 저장한다.
// 실행: node scripts/annual-snapshot.mjs  (client 폴더에서)
// 애뉴얼 쪽은 이 스냅샷만 읽는다. 정적 data/*.js(옛 애뉴얼 출처)는 쓰지 않는다.
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const API = process.env.ANNUAL_API || 'https://dah-website-72a4.onrender.com'
const TYPES = ['professors', 'mentors', 'curriculum', 'nanodegree', 'codesharing', 'council', 'exhibitions', 'contest', 'achievement', 'club', 'lecture']
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/annual/siteSnapshot.json')

async function get(p) {
  const r = await fetch(API + p)
  if (!r.ok) throw new Error(`${p} ${r.status}`)
  return r.json()
}

const snap = { source: API, fetchedAt: new Date().toISOString() }
for (const t of TYPES) {
  const j = await get(`/content/${t}?pageSize=100`)
  snap[t] = j.items || []
}
const s = await get('/settings/public')
const st = s.settings || s
snap.settings = { about: st.about, history: st.history, exhibitionOrdinal: st.exhibitionOrdinal, exhibitionSemester: st.exhibitionSemester, exhibitionSubjects: st.exhibitionSubjects }

// 개인 연락처가 될 수 있는 필드는 남기지 않는다(교수 이메일은 사이트 공개값이라 유지)
for (const k of ['achievement', 'contest', 'club', 'lecture']) for (const it of snap[k]) delete it.created_by
await writeFile(OUT, JSON.stringify(snap, null, 1))
console.log('saved', OUT, TYPES.map((t) => `${t}:${snap[t].length}`).join(' '))
