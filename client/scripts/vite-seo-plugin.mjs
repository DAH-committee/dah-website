// scripts/vite-seo-plugin.mjs — 검색·공유 크롤러용 자료를 배포(빌드)할 때마다 자동으로 만든다.
//
// 만드는 것 두 가지
//  1) dist/seo-fallback.json : 코드에 든 기본 글(제목·설명, 전공소개 기본 문구와 연혁, CI 기본값, 트랙)
//     서버(/seo/page)가 이 파일 위에 관리자 화면에서 고친 값을 얹어 크롤러용 HTML을 만든다.
//  2) index.html 의 메인 페이지 본문 블록(<!--seo-start-->…<!--seo-end-->)
//     메인(/)은 Vercel이 index.html 파일을 그대로 내주므로 서버를 거치지 않는다. 그래서 히어로 문구, 트랙, 메뉴 링크를
//     배포 때 직접 넣는다(React가 켜지면 교체되고 화면에는 보이지 않는다).
// 둘 다 src/data 의 원본에서 읽으므로 코드의 글을 고치고 배포하면 자동으로 최신이 된다. 따로 갱신할 일이 없다.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(here, '../src/data')

// 크롤러가 따라갈 주요 메뉴. server/src/lib/seoNav.js 와 같은 목록이다
export const NAV = [
  ['/about', '전공소개'],
  ['/about/people', '교수진·멘토'],
  ['/curriculum', '교육과정'],
  ['/programs/exhibitions', '프로젝트 전시회'],
  ['/programs/contests', '공모전'],
  ['/programs/lectures', '특강'],
  ['/news', '공지사항'],
  ['/students/council', '운영위원회'],
  ['/students/clubs', '동아리'],
  ['/students/achievements', '학생 성과'],
  ['/students/careers', '졸업생 진로'],
  ['/showcase', '쇼케이스'],
  ['/resources', '자료실'],
]

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const load = (file) => import(pathToFileURL(resolve(DATA, file)).href)

async function loadSeoPages(siteUrl) {
  // seo.js 는 import.meta.env 를 쓰므로 값을 직접 넣어서 읽는다
  const src = readFileSync(resolve(DATA, 'seo.js'), 'utf8').replace(/import\.meta\.env\.VITE_SITE_URL/g, JSON.stringify(siteUrl))
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
}

export async function buildSeoAssets(siteUrl) {
  const [{ ABOUT_COPY }, { history }, { ci }, { tracks }, { hero }, seo] = await Promise.all([
    load('aboutCopy.js'),
    load('history.js'),
    load('ci.js'),
    load('tracks.js'),
    load('site.js'),
    loadSeoPages(siteUrl || 'https://dah-hallym.vercel.app'),
  ])
  const fallback = {
    generatedAt: new Date().toISOString(),
    pages: seo.PAGE_SEO,
    aboutCopy: ABOUT_COPY,
    history,
    ci,
    tracks: tracks.map((t) => ({ no: t.no, name: t.name, summary: t.summary, keywords: t.keywords })),
    hero: { eyebrow: hero.eyebrow, titleEn: hero.titleEn, subKr: hero.subKr, body: hero.body },
  }
  const nav = `<nav aria-label="주요 메뉴"><ul>${NAV.map(([p, l]) => `<li><a href="${p}">${esc(l)}</a></li>`).join('')}</ul></nav>`
  const homeBlock =
    `<main class="seo-sr" data-seo-prerender="home"><header><a href="/">한림대학교 디지털인문예술전공</a>${nav}</header>` +
    `<h1>${esc(hero.titleEn.join(' '))}</h1><p>${esc(hero.eyebrow)}</p><h2>${esc(hero.subKr)}</h2><p>${esc(hero.body)}</p>` +
    tracks.map((t) => `<section><h2>${esc(t.no)} ${esc(t.name)}</h2><p>${esc(t.summary)}</p><p>${esc((t.keywords || []).join(', '))}</p></section>`).join('') +
    `</main>`
  return { fallback, homeBlock }
}

export function seoPlugin({ siteUrl }) {
  let assets
  const get = async () => (assets ||= await buildSeoAssets(siteUrl))
  return {
    name: 'dah-seo',
    async transformIndexHtml(html) {
      const { homeBlock } = await get()
      let out = html.replace(/<!--seo-start-->[\s\S]*?<!--seo-end-->/, `<!--seo-start-->${homeBlock}<!--seo-end-->`)
      if (!out.includes('.seo-sr')) {
        out = out.replace('</head>', '  <style>.seo-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}</style>\n</head>')
      }
      return out
    },
    async generateBundle() {
      const { fallback } = await get()
      this.emitFile({ type: 'asset', fileName: 'seo-fallback.json', source: JSON.stringify(fallback) })
    },
  }
}
