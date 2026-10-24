// scripts/build-seo-static.mjs — 크롤러용 고정 페이지 데이터(src/data/seoStatic.json) 만들기
//
// 합치는 것: ① client/src/data/seo.js 의 PAGE_SEO(제목·설명·구조화 데이터)  ② 화면에서 뽑은 본문 스냅샷(JSON)
// 스냅샷은 실제 화면(main)에 보이는 글을 단순 HTML로 뽑은 것이다: { "/about": { "html": "..." }, ... }
// 소개·교육과정처럼 코드에 들어 있는 글이 바뀌면 스냅샷을 다시 뽑아 이 스크립트를 실행한다.
//   node scripts/build-seo-static.mjs <스냅샷.json>
// 관리자 화면에서 고치는 글(공지, 전시, 공모전, 교수진, 교육과정, 운영위원회, 학생 성과 등)은 서버가 DB에서 바로 읽으므로
// 스냅샷을 다시 만들 필요가 없다. 코드에 본문이 든 페이지(메인, 전공소개, CI, 개인정보, 약관)를 코드로 바꿨을 때만 다시 만든다.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { NAV } from '../src/lib/seoNav.js'

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

// 메인 페이지(/)는 Vercel이 index.html 파일을 그대로 내주므로 크롤러 전용 전달이 적용되지 않는다.
// 그래서 메인 본문과 주요 메뉴 링크를 index.html의 #root 안(React가 켜지면 바로 교체됨)에 직접 넣는다.
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const nav = `<nav aria-label="주요 메뉴"><ul>${NAV.map(([p, l]) => `<li><a href="${p}">${esc(l)}</a></li>`).join('')}</ul></nav>`
const home = out['/']?.html || ''
const block = `<!--seo-start--><main class="seo-sr" data-seo-prerender="home"><header><a href="/">한림대학교 디지털인문예술전공</a>${nav}</header>${home.replace(/(href|src)="https:\/\/dah-hallym\.vercel\.app\//g, '$1="/')}</main><!--seo-end-->`
const indexPath = resolve(here, '../../client/index.html')
let idx = readFileSync(indexPath, 'utf8')
if (/<div id="root">[\s\S]*?<\/div>\s*<script type="module"/.test(idx)) {
  idx = idx.replace(/<div id="root">[\s\S]*?<\/div>(\s*<script type="module")/, (_, tail) => `<div id="root">${block}</div>${tail}`)
  if (!idx.includes('.seo-sr')) {
    idx = idx.replace('</head>', '  <style>.seo-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}</style>\n</head>')
  }
  writeFileSync(indexPath, idx)
  console.log('client/index.html 메인 본문 블록 갱신:', block.length, '자')
}
