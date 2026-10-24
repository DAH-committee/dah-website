// scripts/build-seo-static.mjs — 크롤러용 고정 페이지 데이터(src/data/seoStatic.json) 만들기
//
// 합치는 것: ① client/src/data/seo.js 의 PAGE_SEO(제목·설명·구조화 데이터)  ② 화면에서 뽑은 본문 스냅샷(JSON)
// 스냅샷은 실제 화면(main)에 보이는 글을 단순 HTML로 뽑은 것이다: { "/about": { "html": "..." }, ... }
// 소개·교육과정처럼 코드에 들어 있는 글이 바뀌면 스냅샷을 다시 뽑아 이 스크립트를 실행한다.
//   node scripts/build-seo-static.mjs <스냅샷.json>
// 공지·전시·공모전 같은 DB 글은 이 파일이 필요 없다(서버가 DB에서 바로 읽는다).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../client/src/data/seo.js'), 'utf8').replace(/import\.meta\.env\.VITE_SITE_URL/g, "'https://dah-hallym.vercel.app'")
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
const snapsFile = process.argv[2]
const snaps = snapsFile ? JSON.parse(readFileSync(snapsFile, 'utf8')) : {}

// 화면 레이아웃용 div는 의미가 없고 중첩이 어긋나기 쉬우므로 걷어 낸다(제목, 문단, 목록, 표만 남긴다)
const clean = (html = '') => html.replace(/<\/div>/g, ' ').replace(/<div>/g, '').replace(/<p>\s*<\/p>/g, '').replace(/\s{2,}/g, ' ').trim()

const out = {}
for (const [path, seo] of Object.entries(mod.PAGE_SEO)) {
  out[path] = { title: seo.title, description: seo.description, ...(seo.jsonLd ? { jsonLd: seo.jsonLd } : {}), html: clean(snaps[path]?.html) }
}
// PAGE_SEO에 없는 고정 페이지(개인정보, 약관 등)는 스냅샷의 화면 제목을 쓴다
for (const [path, s] of Object.entries(snaps)) {
  if (!out[path]) out[path] = { title: s.pageTitle || mod.SITE_NAME, description: '', html: clean(s.html) }
  if (!out[path].html) out[path].html = clean(s.html)
}
writeFileSync(resolve(here, '../src/data/seoStatic.json'), JSON.stringify(out))
console.log('seoStatic.json:', Object.keys(out).length, '개 경로,', Object.values(out).filter((v) => v.html).length, '개에 본문')
