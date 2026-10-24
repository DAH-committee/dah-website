// test/seoRender.test.mjs — 크롤러용 HTML(검색·공유 미리보기)
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMeta, bodyHtml, esc, normalizePath } from '../src/lib/seoRender.js'

const SHELL = `<!doctype html><html lang="ko"><head><title>메인</title>
<meta name="description" content="메인 설명" />
<link rel="canonical" href="https://x.test/" />
<meta property="og:title" content="메인" />
<meta property="og:image" content="https://x.test/videos/hero-poster.jpg" />
<meta property="og:image:width" content="1920" />
<script type="application/ld+json">{"a":1}</script></head><body><div id="root"></div><script src="/assets/a.js"></script></body></html>`

test('(S1) 경로별 제목·설명·canonical·공유 이미지가 바뀌고 이전 이미지 크기 정보는 빠진다', () => {
  const h = applyMeta(SHELL, { title: '공모전 | 사이트', description: '설명 "따옴표"', canonical: 'https://x.test/programs/contests/1', image: 'https://x.test/p.webp', jsonLd: { z: 1 }, bodyInner: '<h1>공모전</h1>' })
  assert.match(h, /<title>공모전 \| 사이트<\/title>/)
  assert.match(h, /rel="canonical" href="https:\/\/x\.test\/programs\/contests\/1"/)
  assert.match(h, /og:image" content="https:\/\/x\.test\/p\.webp"/)
  assert.ok(!h.includes('og:image:width'))
  assert.ok(h.includes('설명 &quot;따옴표&quot;'))
  assert.ok(h.includes('"z":1') && !h.includes('"a":1'))
  assert.match(h, /<div id="root"><header>.*<main data-seo-prerender="1"><h1>공모전<\/h1><\/main><\/div>/s)
  assert.ok(h.includes('/assets/a.js'), '스크립트는 그대로 두어 브라우저는 평소처럼 앱을 그린다')
})

test('(S2) 본문 JSON은 안전한 HTML로 바뀌고 스크립트·위험 링크는 막힌다', () => {
  const body = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '제목 <b>' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '굵게', marks: [{ type: 'bold' }] }, { type: 'text', text: ' 링크', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '하나' }] }] }] },
  ] }
  const h = bodyHtml(body)
  assert.ok(h.includes('<h2>제목 &lt;b&gt;</h2>'), '본문 제목은 h2부터(페이지 h1은 하나)')
  assert.ok(h.includes('<strong>굵게</strong>'))
  assert.ok(!h.includes('javascript:'))
  assert.ok(h.includes('<ul><li><p>하나</p></li></ul>'))
  assert.equal(bodyHtml(null), '')
  assert.ok(bodyHtml('첫 문단\n\n둘째 <i>').includes('<p>둘째 &lt;i&gt;</p>'))
})

test('(S3) 경로 정규화와 이스케이프', () => {
  assert.equal(normalizePath('/news/?a=1'), '/news')
  assert.equal(normalizePath('news'), '/news')
  assert.equal(normalizePath(''), '/')
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;')
})

import { aboutHtml, ciHtml, homeHtml } from '../src/lib/seoRender.js'

const FB = {
  aboutCopy: { ko: { what: '기본 소개', whyStatement: '기본 이유', whyLead: '기본 리드', missionKr: '기본 미션', vision: [{ title: '기본 비전', desc: '기본 설명' }] } },
  history: [{ date: '2017.03.01.', text: '설립' }, { date: '2024.09.01.', text: '취임' }],
  ci: { intro: '기본 CI 소개\n\n둘째 문단', elements: [{ title: 'D', text: '열린 곡선' }], colors: [{ name: '보라', hex: '#815FD7', use: '대표색' }], slogan: '기본 슬로건' },
  tracks: [{ no: 'TRACK 01', name: '디자인 트랙', summary: '요약', keywords: ['경험', 'AI'] }],
  hero: { eyebrow: 'SINCE 2017', titleEn: ['DIGITAL ARTS', '& HUMANITIES'], subKr: '부제', body: '본문' },
}

test('(S4) 전공소개: 관리자 화면에서 저장한 문구와 연혁이 코드 기본값보다 우선한다', () => {
  const base = aboutHtml(FB, {})
  assert.ok(base.includes('기본 소개') && base.includes('기본 비전'))
  assert.ok(base.indexOf('2024.09.01.') < base.indexOf('2017.03.01.'), '연혁은 최신순')
  const edited = aboutHtml(FB, { aboutContent: { ko: { what: '관리자가 고친 소개', vision: [{ title: '새 비전', desc: '새 설명' }] } }, aboutHistory: [{ date: '2026.10.01.', text: '새 소식' }] })
  assert.ok(edited.includes('관리자가 고친 소개') && !edited.includes('기본 소개'))
  assert.ok(edited.includes('새 비전') && !edited.includes('기본 비전'))
  assert.ok(edited.includes('새 소식') && !edited.includes('설립'))
  assert.ok(edited.includes('기본 이유'), '저장하지 않은 항목은 기본값 유지')
})

test('(S5) CI: DB 값이 기본값 위에 필드 단위로 덮이고, 글은 이스케이프된다', () => {
  assert.ok(ciHtml(FB, null).includes('기본 슬로건'))
  const h = ciHtml(FB, { slogan: '<script>x</script>새 슬로건' })
  assert.ok(h.includes('&lt;script&gt;x&lt;/script&gt;새 슬로건') && !h.includes('기본 슬로건'))
  assert.ok(h.includes('열린 곡선') && h.includes('#815FD7'), '고치지 않은 항목은 기본값 유지')
})

test('(S6) 메인: 히어로와 트랙이 들어간다', () => {
  const h = homeHtml(FB)
  assert.ok(h.includes('<h1>DIGITAL ARTS &amp; HUMANITIES</h1>') && h.includes('TRACK 01 디자인 트랙') && h.includes('경험, AI'))
})
