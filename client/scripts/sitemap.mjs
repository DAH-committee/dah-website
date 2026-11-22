// sitemap.mjs — sitemap.xml·robots.txt 빌드 시 생성 (40_SITEMAP)
// public/ 파일은 Vite가 dist/로 그대로 복사만 하므로(HTML 템플릿 치환 미적용) —
// 이 스크립트가 vite build 직전에 실제 도메인으로 두 파일을 직접 써서 public/에 둔다.
// 실행: package.json "build" 스크립트가 vite build 전에 자동 호출한다(수동 실행도 가능).
//
// 도메인: VITE_SITE_URL 환경변수(37_OG와 동일 키, vite.config.js와 동일 폴백 규칙)로
// 관리한다. 미설정 시 실제 배포 도메인(https://dah-hallym.vercel.app, 사용자 확정값)으로
// 폴백해 최소한 정확한 URL이 나가도록 한다.
//
// 공개 상세 콘텐츠도 사이트맵에 포함한다. 게시물의 제목·본문은 페이지에서 API로 렌더하므로,
// 목록 URL을 명시해 검색엔진이 전시·공지·공모전 등의 개별 페이지를 발견할 수 있게 한다.
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = resolve(__dirname, '..')
const FALLBACK_SITE_URL = 'https://dah-hallym.vercel.app'

const env = loadEnv(process.env.NODE_ENV || 'production', CLIENT_DIR, '')
const SITE_URL = (env.VITE_SITE_URL || FALLBACK_SITE_URL).trim().replace(/\/+$/, '')

if (!env.VITE_SITE_URL) {
  console.warn(
    `[sitemap] VITE_SITE_URL 미설정 — 폴백 도메인(${FALLBACK_SITE_URL})으로 생성합니다. ` +
      '실제 배포 도메인이 다르면 Vercel 환경변수에 VITE_SITE_URL을 설정하세요.'
  )
}

// changefreq·priority는 SEO 관례상 참고값(검색엔진이 강제로 따르진 않음) — 갱신 빈도
// 체감에 맞춰 대략적으로만 구분한다.
const PAGES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/about', changefreq: 'monthly', priority: '0.8' },
  { path: '/about/people', changefreq: 'monthly', priority: '0.6' },
  { path: '/about/ci', changefreq: 'yearly', priority: '0.4' },
  { path: '/curriculum', changefreq: 'monthly', priority: '0.8' },
  { path: '/curriculum/codesharing', changefreq: 'monthly', priority: '0.6' },
  { path: '/curriculum/nanodegree', changefreq: 'monthly', priority: '0.6' },
  { path: '/programs/exhibitions', changefreq: 'weekly', priority: '0.8' },
  { path: '/programs/contests', changefreq: 'weekly', priority: '0.7' },
  { path: '/programs/lectures', changefreq: 'weekly', priority: '0.7' },
  { path: '/students/council', changefreq: 'yearly', priority: '0.5' },
  { path: '/students/clubs', changefreq: 'monthly', priority: '0.6' },
  { path: '/students/achievements', changefreq: 'monthly', priority: '0.6' },
  { path: '/students/careers', changefreq: 'monthly', priority: '0.6' },
  { path: '/showcase', changefreq: 'weekly', priority: '0.6' },
  { path: '/news', changefreq: 'daily', priority: '0.8' },
  { path: '/resources', changefreq: 'monthly', priority: '0.6' },
  { path: '/resources/annual-report-2026', changefreq: 'yearly', priority: '0.5' },
  { path: '/annual-report', changefreq: 'yearly', priority: '0.5' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
]

// 38_VISIBILITY: 대시보드에서 비공개로 둔 콘텐츠 유형은 사이트맵에서도 빼야 한다
// (검색엔진에 색인되면 메뉴에서 숨긴 의미가 없다). 가시성은 런타임 DB 값이라 빌드 시점에
// 공개 설정 API를 한 번 조회한다. 서버가 슬립·다운이면 조회에 실패할 수 있는데,
// 그때는 "전부 공개"로 간주해 기존 동작을 유지한다(빌드를 깨뜨리지 않는다).
const PAGE_VISIBILITY = {
  '/about/people': ['professors', 'mentors'],
  '/curriculum': ['curriculum'],
  '/programs/exhibitions': ['exhibitions'],
  '/programs/contests': ['contest'],
  '/programs/lectures': ['lecture'],
  '/students/council': ['council'],
  '/students/clubs': ['club'],
  '/students/achievements': ['achievement'],
  '/students/careers': ['careers', 'portfolios'],
  '/showcase': ['showcase'],
  '/news': ['notice'],
  '/resources': ['resource'],
}

// type은 공개 API의 content-config 키, path는 App.jsx의 실제 상세 라우트다.
// 학생 성과는 현재 목록 내 확장 UI이고 별도 상세 라우트가 없으므로 넣지 않는다.
const DYNAMIC_ROUTES = [
  { type: 'notice', path: '/news' },
  { type: 'exhibitions', path: '/programs/exhibitions' },
  { type: 'contest', path: '/programs/contests' },
  { type: 'lecture', path: '/programs/lectures' },
  { type: 'resource', path: '/resources' },
  { type: 'club', path: '/students/clubs' },
  { type: 'showcase', path: '/showcase' },
]

async function fetchVisibility() {
  const api = (env.VITE_API_URL || '').trim().replace(/\/+$/, '')
  if (!api) return null
  try {
    const res = await fetch(`${api}/settings/public`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()
    const v = json?.settings?.contentVisibility
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

const visibility = await fetchVisibility()
if (!visibility) {
  console.warn('[sitemap] 공개 설정을 불러오지 못했습니다(서버 슬립·미설정 가능) — 전 페이지를 포함합니다.')
}
const isPublicType = (type) => !visibility || visibility[type] !== false
const visiblePages = PAGES.filter((p) => {
  const types = PAGE_VISIBILITY[p.path]
  return !types || types.some(isPublicType)
})
const droppedPages = PAGES.filter((p) => !visiblePages.includes(p))
if (droppedPages.length > 0) {
  console.log(`[sitemap] 비공개 유형 ${droppedPages.length}개 경로 제외: ` + droppedPages.map((p) => p.path).join(', '))
}

async function fetchDynamicPages() {
  const api = (env.VITE_API_URL || '').trim().replace(/\/+$/, '')
  if (!api) {
    console.warn('[sitemap] VITE_API_URL 미설정 — 동적 상세 URL은 생성하지 않습니다.')
    return []
  }

  const eligible = DYNAMIC_ROUTES.filter((route) => isPublicType(route.type))
  const results = await Promise.all(
    eligible.map(async (route) => {
      try {
        const res = await fetch(`${api}/content/${route.type}?pageSize=100`, {
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const items = Array.isArray(json?.items) ? json.items : []
        return items
          .filter((item) => Number.isInteger(Number(item?.id)))
          .map((item) => ({
            path: `${route.path}/${item.id}`,
            // 서버가 관리하는 수정 시각만 lastmod로 쓴다. 임의 날짜를 만들지 않는다.
            lastmod: (item.updated_at || item.created_at || '').slice(0, 10) || null,
          }))
      } catch (err) {
        console.warn(`[sitemap] ${route.type} 상세 URL을 불러오지 못했습니다: ${err.message}`)
        return []
      }
    })
  )
  return results.flat()
}

const dynamicPages = await fetchDynamicPages()

const urls = [...visiblePages, ...dynamicPages].map(
  (p) =>
    `  <url>\n` +
    `    <loc>${SITE_URL}${p.path}</loc>\n` +
    (p.lastmod ? `    <lastmod>${p.lastmod}</lastmod>\n` : '') +
    (p.changefreq ? `    <changefreq>${p.changefreq}</changefreq>\n` : '') +
    (p.priority ? `    <priority>${p.priority}</priority>\n` : '') +
    `  </url>`
).join('\n')

const sitemapXml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  `${urls}\n` +
  '</urlset>\n'

const robotsTxt =
  'User-agent: *\n' +
  'Allow: /\n' +
  'Disallow: /admin\n' +
  '\n' +
  `Sitemap: ${SITE_URL}/sitemap.xml\n`

writeFileSync(resolve(CLIENT_DIR, 'public/sitemap.xml'), sitemapXml)
writeFileSync(resolve(CLIENT_DIR, 'public/robots.txt'), robotsTxt)

console.log(`[sitemap] public/sitemap.xml 생성 완료 (${visiblePages.length + dynamicPages.length}개 URL, SITE_URL=${SITE_URL})`)
console.log('[sitemap] public/robots.txt 생성 완료')
