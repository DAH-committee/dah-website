// node --test client/src/pages/slides/interop/clipboard.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { decodeGSlides, encodeGSlides, transformFor, boxFrom, GSLIDES_TYPE, U } from './gslides.js'
import { htmlToParas, parasToHtml, normColor } from './richText.js'
import { htmlToElements, elementsToHtml, elementsToText } from './htmlio.js'
import { rtfToHtml } from './rtf.js'

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'))
const deck = { theme: { id: 'basic', fonts: { heading: 'sans', body: 'sans' }, colors: { bg: '#FFFFFF', text: '#111111', accent: '#7A3CFF', accent2: '#FFB300', muted: '#5F6368', surface: '#F1F1F1' } } }

test('단위: DAH 1px = 190.5', () => assert.equal(U, 190.5))

test('변환 행렬 왕복(회전 포함)', () => {
  const t = transformFor(100, 80, 700, 300, 15)
  assert.deepEqual(boxFrom(t), { x: 100, y: 80, w: 700, h: 300, rotate: 15 })
})

test('슬라이드 글 상자 → 글 요소(굵게·색·링크)', () => {
  const [el] = decodeGSlides(fx('gslides-textbox')[GSLIDES_TYPE])
  assert.equal(el.type, 'text')
  assert.equal(el.style.size, 48) // 18pt
  assert.match(el.data.html, /<b>Bold<\/b>/)
  assert.match(el.data.html, /<a href="https:\/\/example.com\/dah">link<\/a>/)
  assert.match(el.data.html, /color: #FF0000/)
})

test('슬라이드 도형+목록 → 도형과 글 묶음', () => {
  const els = decodeGSlides(fx('gslides-shape-list')[GSLIDES_TYPE])
  assert.equal(els.length, 2)
  assert.equal(els[0].data.shape, 'rounded')
  assert.equal(els[0].style.fill, '#FF0000')
  assert.equal(els[0].style.stroke, '#0000FF')
  assert.equal(els[0].style.strokeWidth, 8) // 4px(슬라이드) = 8px(DAH)
  assert.equal(els[0].group, els[1].group)
  assert.equal(els[1].data.html, '<p>Line one</p><ul><li>Item A</li><li>Item <s>B</s></li></ul>')
})

test('슬라이드 그림 → 그림 요소', () => {
  const [el] = decodeGSlides(fx('gslides-image')[GSLIDES_TYPE])
  assert.equal(el.type, 'image')
  assert.equal(el.w, 192)
  assert.match(el.data.src, /^https:\/\/www.gstatic.com\//)
})

test('번호 목록 + 회전 + 채우기', () => {
  const [el] = decodeGSlides(fx('gslides-numbered')[GSLIDES_TYPE])
  assert.equal(el.rotate, 15)
  assert.equal(el.style.fill, '#FFEA00')
  assert.match(el.data.html, /^<ol>/)
})

test('DAH → 슬라이드 → DAH 왕복', () => {
  const src = [
    { id: 'a', type: 'text', x: 120, y: 100, w: 900, h: 200, rotate: 0, z: 1, style: { font: '@heading', size: 72, color: '@accent', align: 'center', valign: 'middle', lineHeight: 1.2, bold: true }, data: { html: '<p>제목 <a href="https://dah.kr/x">링크</a></p><ul><li>하나</li><li><i>둘</i></li></ul>' } },
    { id: 'b', type: 'shape', x: 1100, y: 500, w: 400, h: 300, rotate: 30, z: 2, style: { fill: '@accent2', stroke: '#111111', strokeWidth: 6, radius: 40 }, data: { shape: 'rounded' } },
    { id: 'c', type: 'shape', x: 100, y: 800, w: 600, h: 40, rotate: 0, z: 3, style: { stroke: '#FF1744', strokeWidth: 6, arrowEnd: true }, data: { shape: 'line' } },
    { id: 'd', type: 'image', x: 1300, y: 80, w: 480, h: 270, rotate: 0, z: 4, style: {}, data: { src: 'https://example.com/a.png' } },
    { id: 'e', type: 'shape', x: 800, y: 800, w: 200, h: 200, rotate: 0, z: 5, style: { fill: '#00E67680' }, data: { shape: 'ellipse' } },
  ]
  const str = encodeGSlides(src, deck)
  const cmds = JSON.parse(JSON.parse(str).data).resolved
  assert.ok(cmds.find((c) => c[0] === 3 && c[2] === 108))
  const back = decodeGSlides(str)
  const t = back.find((e) => e.type === 'text')
  assert.equal(t.style.size, 72)
  assert.equal(t.style.color, '#7A3CFF')
  assert.equal(t.style.align, 'center')
  assert.equal(t.style.valign, 'middle')
  assert.equal(t.style.bold, true)
  assert.match(t.data.html, /<a href="https:\/\/dah.kr\/x">링크<\/a>/)
  assert.match(t.data.html, /<ul><li>하나<\/li><li><i>둘<\/i><\/li><\/ul>/)
  const sh = back.find((e) => e.data?.shape === 'rounded')
  assert.deepEqual([sh.x, sh.y, sh.w, sh.h, sh.rotate], [1100, 500, 400, 300, 30])
  assert.equal(sh.style.fill, '#FFB300')
  assert.equal(sh.style.radius, 40)
  const ln = back.find((e) => e.data?.shape === 'line')
  assert.equal(ln.w, 600)
  assert.equal(ln.style.arrowEnd, true)
  assert.equal(Math.round(ln.y + ln.h / 2), 820)
  const im = back.find((e) => e.type === 'image')
  assert.deepEqual([im.x, im.y, im.w, im.h], [1300, 80, 480, 270])
  const el = back.find((e) => e.data?.shape === 'ellipse')
  assert.equal(el.style.fill, '#00E67680')
})

test('구글 문서 HTML → 글 요소(겉 <b font-weight:normal>은 굵게 아님)', () => {
  const docs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;">보통 </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;">굵게</span><a href="https://www.google.com/" style="text-decoration:none;"><span style="font-size:11pt;color:#1155cc;text-decoration:underline;">링크</span></a></p><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;color:#000000;">항목</span></p></li></ul></b>'
  const [el] = htmlToElements(docs)
  assert.equal(el.style.color, '@text')
  assert.equal(el.style.bold, false)
  assert.equal(el.style.size, 29.3)
  assert.equal(el.data.html, '<p>보통 <b>굵게</b><a href="https://www.google.com/"><span style="color: #1155CC">링크</span></a></p><ul><li>항목</li></ul>')
})

test('웹 HTML: 제목·기울임·번호 목록', () => {
  const [el] = htmlToElements('<h2>소제목</h2><p>본문 <em>강조</em></p><ol><li>첫째</li><li>둘째<ol><li>안쪽</li></ol></li></ol>')
  assert.equal(el.data.html, '<p><span style="font-size: 49px"><b>소제목</b></span></p><p>본문 <i>강조</i></p><ol><li>첫째</li><li>둘째<ol><li>안쪽</li></ol></li></ol>')
})

test('그림만 있는 HTML → 그림 요소', () => {
  const els = htmlToElements('<img src="https://example.com/x.png" width="400" height="200">')
  assert.equal(els[0].type, 'image')
  assert.equal(els[0].w, 800)
})

test('DAH → HTML·글자', () => {
  const els = [{ type: 'text', x: 0, y: 0, w: 100, h: 100, style: { size: 48, color: '@text', bold: false }, data: { html: '<p>안녕 <a href="https://a.b/">링크</a></p><ol><li>하나</li></ol>' } }]
  const html = elementsToHtml(els, deck)
  assert.match(html, /<a href="https:\/\/a.b\/">/)
  assert.match(html, /font-size:18pt/)
  assert.equal(elementsToText(els), '안녕 링크\n1. 하나')
})

test('색 정리', () => {
  assert.equal(normColor('rgb(255, 0, 0)'), '#FF0000')
  assert.equal(normColor('rgba(0,0,0,0)'), null)
  assert.equal(normColor('#abc'), '#AABBCC')
})

test('RTF(키노트) → HTML', () => {
  const rtf = '{\\rtf1\\ansi\\ansicpg949\\cocoartf2761{\\fonttbl\\f0\\fnil AppleSDGothicNeo;}{\\colortbl;\\red255\\green255\\blue255;\\red255\\green0\\blue0;}\\pard\\qc\\f0\\fs48 \\cf2 \\b \\uc0\\u54620 \\u44544 \\b0  plain\\par {\\field{\\*\\fldinst{HYPERLINK "https://ex.com/"}}{\\fldrslt link}}}'
  const html = rtfToHtml(rtf)
  assert.match(html, /한글/)
  assert.match(html, /<a href="https:\/\/ex.com\/">/)
  const [el] = htmlToElements(html)
  assert.match(el.data.html, /<b>한글<\/b>/)
  assert.equal(el.style.align, 'center')
})
