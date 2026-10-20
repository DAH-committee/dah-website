// test/platform.test.mjs — 연동(unfurl SSRF 방어, 서비스 판별), HTML 정리, 노션 변환, 슬라이드 미리보기, 비공개 개념 제거. DB 없이 돈다.
// 실행: server/ 안에서 `node --test test/platform.test.mjs`
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILE_COLS } from '../src/lib/wsAccess.js'
import { sanitizeHtml, safeUrl } from '../src/lib/safeHtml.js'
import { assertPublicUrl, isBlockedIp, figmaEmbedUrls, _internal } from '../src/routes/integrations.js'
import { slidePreview } from '../src/routes/workspace.js'

test('비공개(hidden) 열은 더 이상 읽지 않는다', () => {
  assert.ok(!/\bhidden\b/.test(FILE_COLS))
  assert.ok(/owner_only/.test(FILE_COLS)) // 나만 보기는 남아 있다
})

test('isBlockedIp: 사설·루프백·링크로컬은 막고 공인 주소는 통과', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1']) {
    assert.equal(isBlockedIp(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '172.66.147.243', '146.75.48.81', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedIp(ip), false, ip) // 공인 주소가 막히면 모든 링크 미리보기가 죽는다
  }
})

test('assertPublicUrl: http(s) 기본 포트의 공개 호스트만', () => {
  assert.equal(assertPublicUrl('https://example.com/a?b=1').hostname, 'example.com')
  for (const bad of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://2130706433/', 'http://0x7f.1/', 'http://example.com:8080/', 'http://user:pw@example.com/', 'http://metadata/', 'http://foo.internal/', '']) {
    assert.throws(() => assertPublicUrl(bad), (e) => e.code === 'UNSAFE_URL' && e.status === 400, bad)
  }
})

test('서비스 판별: 유튜브, 비메오, 피그마, 노션', () => {
  const u = (s) => new URL(s)
  assert.equal(_internal.youtubeId(u('https://www.youtube.com/watch?v=dQw4w9WgXcQ')), 'dQw4w9WgXcQ')
  assert.equal(_internal.youtubeId(u('https://youtu.be/dQw4w9WgXcQ?t=5')), 'dQw4w9WgXcQ')
  assert.equal(_internal.youtubeId(u('https://www.youtube.com/shorts/abcDEF12345')), 'abcDEF12345')
  assert.equal(_internal.youtubeId(u('https://evil-youtube.com/watch?v=dQw4w9WgXcQ')), null)
  assert.deepEqual(_internal.vimeoInfo(u('https://vimeo.com/76979871')), { id: '76979871', hash: '' })
  assert.equal(_internal.vimeoInfo(u('https://player.vimeo.com/video/76979871'))?.id, '76979871')
  assert.equal(_internal.figmaInfo(u('https://www.figma.com/design/abcdefghij1234567890AB/My-File?node-id=1-2')).key, 'abcdefghij1234567890AB')
  assert.equal(_internal.figmaInfo(u('https://evilfigma.com/design/abcdefghij1234567890AB/x')), null)
  assert.equal(_internal.figmaInfo(u('https://www.figma.com/community/file/1035203688168086460/x')).type, 'community')
})

test('피그마 임베드 주소: Embed Kit 2.0 형식, 프로토타입은 1.0 형식', () => {
  const d = new URL('https://www.figma.com/design/abcdefghij1234567890AB/My-File?node-id=1-2')
  const r = figmaEmbedUrls(d, _internal.figmaInfo(d))
  assert.equal(r.embedUrl, 'https://embed.figma.com/design/abcdefghij1234567890AB?embed-host=dah-workspace&node-id=1-2')
  assert.match(r.embedUrlLegacy, /^https:\/\/www\.figma\.com\/embed\?embed_host=dah-workspace&url=/)
  const p = new URL('https://www.figma.com/proto/abcdefghij1234567890AB/Flow')
  assert.match(figmaEmbedUrls(p, _internal.figmaInfo(p)).embedUrl, /^https:\/\/www\.figma\.com\/embed\?/)
})

test('parseMeta: og 태그와 title, 엔티티', () => {
  const { meta, title } = _internal.parseMeta('<html><head><title>제목 &amp; 다른</title><meta property="og:title" content="OG &quot;제목&quot;"><meta name="description" content=\'설명\'><meta property=og:image content=/a.png></head>')
  assert.equal(meta['og:title'], 'OG &quot;제목&quot;')
  assert.equal(meta.description, '설명')
  assert.equal(meta['og:image'], '/a.png')
  assert.equal(title, '제목 &amp; 다른')
})

test('sanitizeHtml: 스크립트·이벤트·위험한 주소를 없앤다', () => {
  assert.equal(sanitizeHtml('<p onclick="x()">a<script>alert(1)</script></p>'), '<p>a</p>')
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), 'x')
  assert.equal(sanitizeHtml('<a href="jav&#x09;ascript:alert(1)">x</a>'), 'x')
  assert.equal(safeUrl('data:text/html,<script>'), null)
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>'), '')
  assert.match(sanitizeHtml('<a href="https://ok.com/?a=1&b=2" onmouseover=x>ok</a>'), /^<a href="https:\/\/ok\.com\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>$/)
  assert.equal(sanitizeHtml('<iframe src="//e.com"></iframe><style>p{}</style><div style="x">글</div>'), '글')
  assert.equal(sanitizeHtml('<h4>t</h4><p>열린 <b>굵게'), '<h3>t</h3><p>열린 <strong>굵게</strong></p>')
  assert.equal(sanitizeHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="true">할 일</li></ul>'), '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">할 일</li></ul>')
})

test('노션 주소에서 페이지 id를 읽는다', () => {
  const id = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'
  assert.equal(_internal.notionPageId(`https://www.notion.so/ws/Title-${id}?pvs=4`), id)
  assert.equal(_internal.notionPageId(`https://team.notion.site/Title-${id}`), id)
  assert.equal(_internal.notionPageId('https://www.notion.so/1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'), '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d')
  assert.equal(_internal.notionPageId(`https://example.com/Title-${id}`), null)
})

test('노션 블록 변환: 목록 묶기, 서식 이스케이프, 표', async () => {
  const rt = (t, a = {}, href = null) => ({ plain_text: t, annotations: a, href })
  const blocks = [
    { id: '1', type: 'heading_2', has_children: false, heading_2: { rich_text: [rt('<제목>')] } },
    { id: '2', type: 'paragraph', has_children: false, paragraph: { rich_text: [rt('굵게', { bold: true }), rt('링크', {}, 'https://a.com'), rt('나쁜', {}, 'javascript:alert(1)')] } },
    { id: '3', type: 'bulleted_list_item', has_children: false, bulleted_list_item: { rich_text: [rt('가')] } },
    { id: '4', type: 'bulleted_list_item', has_children: false, bulleted_list_item: { rich_text: [rt('나')] } },
    { id: '5', type: 'to_do', has_children: false, to_do: { rich_text: [rt('끝')], checked: true } },
    { id: '6', type: 'code', has_children: false, code: { rich_text: [rt('a < b')] } },
    { id: '7', type: 'unsupported', has_children: false, unsupported: {} },
  ]
  const ctx = { requests: 0, maxRequests: 10, blocks: 0, maxBlocks: 100, truncated: false, hostedImages: 0 }
  const html = await _internal.renderBlocks('t', blocks, ctx, 0)
  assert.equal(html, '<h2>&lt;제목&gt;</h2><p><strong>굵게</strong><a href="https://a.com">링크</a>나쁜</p><ul><li>가</li><li>나</li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true">끝</li></ul><pre><code>a &lt; b</code></pre>')
})

test('슬라이드 미리보기: 제목 글, 테마 색 토큰, 빈 제목은 파일 제목', () => {
  const colors = { bg: '#7A3CFF', text: '#FFFFFF', accent: '#FFEA00' }
  const slide = { background: { color: '@accent' }, elements: [
    { type: 'shape', role: 'deco' },
    { type: 'text', role: 'title', style: { size: 100, color: '@bg' }, data: { html: '<p>우리 <b>발표</b></p>' } },
    { type: 'text', role: 'subtitle', style: { size: 40 }, data: { html: '<p>부제</p>' } },
  ] }
  assert.deepEqual(slidePreview(slide, '파일', colors), { title: '우리 발표', bg: '#FFEA00', fg: '#7A3CFF' })
  const empty = { background: null, elements: [{ type: 'text', role: 'title', style: { color: '@bg' }, data: { html: '' } }] }
  assert.deepEqual(slidePreview(empty, '파일 제목', colors), { title: '파일 제목', bg: '#7A3CFF', fg: '#7A3CFF' })
  assert.deepEqual(slidePreview(null, '제목'), { title: '제목', bg: '#ffffff', fg: '#111111' })
  assert.equal(slidePreview({ background: { color: 'url(javascript:1)' }, elements: [] }, 'x').bg, '#ffffff')
})
