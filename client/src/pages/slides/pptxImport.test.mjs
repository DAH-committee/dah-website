// node --test client/src/pages/slides/pptxImport.test.mjs
// PPTX 가져오기와 발표 내용 모양 검사. pptxImport.js는 DOMParser 대신 자체 XML 해석기를 쓰므로 Node에서 그대로 돈다.
// 시험용 PPTX는 이 파일 안에서 jszip으로 직접 만든다(자리 표시자 상속, 테마 색, 링크, 목록 수준, 묶음, 표, 그림 자르기, 노트, 숨김, 모핑, 4:3).
// 실제 파일로도 돌려 보려면: PPTX_SAMPLES=/폴더 node --test ... (폴더 안의 .pptx를 모두 읽어 모양 검사만 한다)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { importPptx, parseXml, kid, textOf, bakeThemeColors, skippedSummary } from './pptxImport.js'
import { magicMatches, SLIDE_W, SLIDE_H } from './deckCore.js'
import { normalizeDeck, sanitizeHref } from './sanitize.js'

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target, ext]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${ext ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
// 1x1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

async function fixture() {
  const z = new JSZip()
  z.file('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]))
  // 4:3 (9144000 x 6858000) → 1440x1080, 좌우 240px 여백
  z.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`)
  z.file('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'slide', 'slides/slide2.xml'], ['rId9', 'theme', 'theme/theme1.xml']]))
  z.file('ppt/theme/theme1.xml', `<a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="T"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="7A3CFF"/></a:accent1><a:accent2><a:srgbClr val="00A3A3"/></a:accent2></a:clrScheme><a:fontScheme name="T"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`)
  z.file('ppt/slideMasters/slideMaster1.xml', `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Logo bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="6629400"/><a:ext cx="9144000" cy="228600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle></p:txStyles></p:sldMaster>`)
  z.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme1.xml'], ['rId2', 'slideLayout', '../slideLayouts/slideLayout1.xml']]))
  z.file('ppt/slideLayouts/slideLayout1.xml', `<p:sldLayout ${NS}><p:cSld><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Click to add text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`)
  z.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
  // 슬라이드 1: xfrm 없는 제목·본문 자리 표시자, 링크, 목록 수준, 묶음, 표, 그림 자르기, 노트
  z.file(
    'ppt/slides/slide1.xml',
    `<p:sld ${NS}><p:cSld><p:spTree>${GRP}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="!!hero"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="ko-KR"/><a:t>제목 &amp; 상속</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:r><a:t>첫 항목</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>안쪽</a:t></a:r></a:p><a:p><a:r><a:rPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill><a:hlinkClick r:id="rId5"/></a:rPr><a:t>링크</a:t></a:r><a:r><a:rPr><a:hlinkClick r:id="rId6"/></a:rPr><a:t>나쁜 링크</a:t></a:r></a:p><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>목록 아님</a:t></a:r></a:p></p:txBody></p:sp>
<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="457200"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="E"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr></p:sp>
<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipV="1"><a:off x="457200" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>
</p:grpSp>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="5029200"/><a:ext cx="4572000" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="2286000"/><a:gridCol w="2286000"/></a:tblGrid><a:tr h="457200"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1400"/><a:t>머리</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="7A3CFF"/></a:solidFill></a:tcPr></a:tc><a:tc gridSpan="1"><a:txBody><a:bodyPr/><a:p><a:r><a:t>둘</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr><a:tr h="457200"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>가</a:t></a:r></a:p><a:p><a:r><a:t>나</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p><a:r><a:t>숨김</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
<p:pic><p:nvPicPr><p:cNvPr id="8" name="P" descr="고양이"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/><a:srcRect l="20000" r="0"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="5400000"><a:off x="6400800" y="4572000"/><a:ext cx="1828800" cy="1828800"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr></p:pic>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="C"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  )
  z.file('ppt/slides/_rels/slide1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId4', 'image', '../media/image1.png'], ['rId5', 'hyperlink', 'https://example.com/a?b=1&amp;c=2', true], ['rId6', 'hyperlink', 'javascript:alert(1)', true], ['rId7', 'notesSlide', '../notesSlides/notesSlide1.xml']]))
  z.file('ppt/media/image1.png', PNG)
  z.file('ppt/notesSlides/notesSlide1.xml', `<p:notes ${NS}><p:cSld><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="N"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>노트 한 줄</a:t></a:r></a:p><a:p><a:r><a:t>둘째 줄</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`)
  // 슬라이드 2: 숨김, 배경색, 모핑, 같은 이름 '!!hero'
  z.file(
    'ppt/slides/slide2.xml',
    `<p:sld ${NS} show="0"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:bgPr></p:bg><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="!!hero"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000" i="1"><a:latin typeface="Courier"/></a:rPr><a:t>옮겨 간 제목</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition spd="slow"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent></p:sld>`
  )
  z.file('ppt/slides/_rels/slide2.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]))
  return z.generateAsync({ type: 'uint8array' })
}

test('parseXml: 이름공간, 엔터티, CDATA, 빈 태그', () => {
  const d = parseXml('<?xml version="1.0"?><a:root xmlns:a="x"><a:t xml:space="preserve"> A &amp; B &#xAC00;&#44032; </a:t><a:e v="&quot;q&quot;"/><![CDATA[<raw>]]></a:root>')
  const root = kid(d, 'root')
  assert.equal(textOf(kid(root, 't')), ' A & B 가가 ')
  assert.equal(kid(root, 'e').a.v, '"q"')
  assert.ok(root.c.includes('<raw>'))
})

test('importPptx: 자리 표시자 상속, 테마 색, 링크, 목록, 묶음, 표, 그림, 노트, 숨김, 모핑', async () => {
  const uploads = []
  const res = await importPptx(await fixture(), { uploadImage: async (blob, name) => (uploads.push([blob.type, name, blob.size]), `/uploads/${name}`) })
  const { slides, theme, skipped } = res
  assert.equal(slides.length, 2)
  assert.equal(theme.colors.bg, '#FFFFFF')
  assert.equal(theme.colors.accent, '#7A3CFF')
  assert.equal(theme.fonts.heading, 'Georgia')
  assert.equal(skipped.charts, 1)
  assert.match(skippedSummary(skipped), /차트 1개/)

  const s1 = slides[0]
  // 마스터 장식 도형(자리 표시자 아님)은 맨 아래에 장식으로 들어온다
  const bar = s1.elements[0]
  assert.equal(bar.role, 'deco')
  assert.equal(bar.style.fill, '@accent')
  assert.equal(bar.x, 240) // 4:3 여백
  // 제목: xfrm이 없어 마스터 자리에서 위치를 찾고, 마스터 제목 스타일(가운데, 굵게, tx2 색, 제목 글꼴)을 받는다
  const title = s1.elements.find((e) => e.role === 'title')
  assert.ok(title)
  assert.equal(title.mid, 'hero')
  assert.equal(Math.round(title.x), 240 + 72)
  assert.equal(title.style.align, 'center')
  assert.equal(title.style.bold, true)
  assert.equal(title.style.color, '#1F2937')
  assert.equal(title.style.font, '@heading')
  assert.equal(title.style.size, 88) // 44pt, 4:3에서 1pt = 2px
  assert.match(title.data.html, /제목 &amp; 상속/)
  // 본문: 레이아웃 자리(idx=1), 마스터 본문 글머리표, 수준, 링크, 위험한 링크는 걸러질 주소로 남는다
  const body = s1.elements.find((e) => e.role === 'body')
  assert.equal(body.style.valign, 'middle')
  assert.equal(body.data.placeholder, 'Click to add text')
  assert.match(body.data.html, /^<ul><li>첫 항목<ul><li><span style="font-size: 48px">안쪽<\/span><\/li><\/ul><\/li><li>/)
  assert.match(body.data.html, /<a href="https:\/\/example.com\/a\?b=1&amp;c=2"><span style="color: #32009E">링크<\/span><\/a>/)
  assert.match(body.data.html, /<a href="javascript:alert\(1\)">나쁜 링크<\/a>/) // 화면과 저장 때 sanitizeRich가 href를 지운다
  assert.match(body.data.html, /<\/ul><p>목록 아님<\/p>$/)
  // 묶음: chExt가 ext의 절반이라 자식은 두 배로 커진다
  const ell = s1.elements.find((e) => e.data.shape === 'ellipse')
  assert.equal(ell.x, 240 + 144)
  assert.equal(ell.w, 144)
  assert.equal(ell.style.fill, '#FF000080')
  assert.equal(ell.style.strokeStyle, 'dashed')
  assert.ok(ell.group)
  const line = s1.elements.find((e) => e.data.shape === 'line')
  assert.equal(line.group, ell.group)
  assert.equal(line.style.arrowEnd, true)
  assert.equal(Math.round(line.rotate), 315) // flipV: 왼쪽 아래 → 오른쪽 위
  // 표
  const table = s1.elements.find((e) => e.type === 'table')
  assert.deepEqual(table.data.rows, [['머리', '둘'], ['가\n나', '']])
  assert.equal(table.data.header, true)
  assert.equal(table.style.headerFill, '#7A3CFF')
  assert.equal(table.style.size, 28)
  // 그림: 자르기 → cover, 원 → mask, 회전, 업로드 한 번
  const pic = s1.elements.find((e) => e.type === 'image')
  assert.equal(pic.data.src, '/uploads/image1.png')
  assert.equal(pic.data.alt, '고양이')
  assert.equal(pic.style.fit, 'cover')
  assert.equal(pic.style.posX, 100)
  assert.equal(pic.style.mask, 'circle')
  assert.equal(pic.rotate, 90)
  assert.deepEqual(uploads, [['image/png', 'image1.png', PNG.length]])
  assert.equal(s1.notes, '노트 한 줄\n둘째 줄')
  assert.equal(s1.hidden, false)

  const s2 = slides[1]
  assert.equal(s2.hidden, true)
  assert.equal(s2.transition, 'magic')
  assert.deepEqual(s2.background, { color: '#112233' })
  const t2 = s2.elements.find((e) => e.type === 'text')
  assert.equal(t2.mid, 'hero')
  assert.equal(t2.style.font, 'Courier')
  assert.equal(t2.style.italic, true)
  // 매직 무브 짝
  // 짝: '!!hero' 제목, 그리고 모핑 슬라이드라 이름이 같은 마스터 장식 막대('Logo bar')
  const pairs = magicMatches(s1, s2)
  assert.equal(pairs.length, 2)
  assert.ok(pairs.some(([a, b]) => a.id === title.id && b.id === t2.id))
  assert.ok(pairs.some(([a]) => a.id === bar.id))

  // 저장 모양 검사를 통과하고 새 필드가 남는다
  const deck = normalizeDeck({ version: 1, theme, slides })
  assert.equal(deck.slides.length, 2)
  assert.equal(deck.slides[1].transition, 'magic')
  assert.equal(deck.slides[1].elements.find((e) => e.type === 'text').mid, 'hero')
  assert.equal(deck.theme.colors.accent, '#7A3CFF')
  for (const s of deck.slides) for (const e of s.elements) assert.ok(e.x > -SLIDE_W && e.y > -SLIDE_H && e.w > 0 && e.h > 0)
})

test('importPptx: useTokens=false와 bakeThemeColors는 토큰 없이 원래 색을 쓴다', async () => {
  const buf = await fixture()
  const a = await importPptx(buf, { useTokens: false })
  const json = JSON.stringify(a.slides)
  assert.ok(!/"@(bg|text|accent|accent2|surface)"/.test(json))
  const b = await importPptx(buf)
  const baked = bakeThemeColors(b.slides, b.theme)
  assert.ok(!/"@(bg|text|accent|accent2|surface)"/.test(JSON.stringify(baked)))
  assert.equal(baked[0].elements[0].style.fill, '#7A3CFF')
  // uploadImage 없이: 작은 그림은 data: 주소
  assert.match(a.slides[0].elements.find((e) => e.type === 'image').data.src, /^data:image\/png;base64,/)
})

test('importPptx: PPTX가 아니면 한국어 오류', async () => {
  await assert.rejects(() => importPptx(new Uint8Array([1, 2, 3])), /PPTX/)
})

test('normalizeDeck: 매직 무브, mid·name·hidden, stacks, 새 style 키, 배경 맞춤을 지킨다', () => {
  const src = {
    version: 1,
    slides: [
      {
        id: 's1', transition: 'magic', background: { color: '#FFFFFF', fit: 'contain', image: '/uploads/a.png' },
        stacks: { g1: { dir: 'column', gap: 12, pad: 4, align: 'center', frame: 'e0' }, g2: { dir: 'row', frame: 5 }, bad: 'x' },
        elements: [
          {
            id: 'e1', type: 'shape', x: 1, y: 2, w: 3, h: 4, mid: 'm1', name: '배지', hidden: true, group: 'g1',
            style: { fill: '@accent', fillType: 'linear', gradient: { from: '#7A3CFF', to: '@bg', angle: 45 }, shadow: { x: 0, y: 8, blur: 24, color: '#00000040' }, blur: 2, strokeStyle: 'dashed', mask: 'circle', brightness: 110, contrast: 90, tracking: 0.05, paraSpacing: 12, textTransform: 'uppercase', textShadow: { x: 1, y: 1, blur: 2, color: '@text' }, sizing: 'auto-h', evil: 'url(javascript:x)' },
            data: { shape: 'rect' },
          },
        ],
      },
    ],
  }
  const d = normalizeDeck(src)
  const s = d.slides[0]
  assert.equal(s.transition, 'magic')
  assert.deepEqual(s.background, { color: '#FFFFFF', image: '/uploads/a.png', fit: 'contain' })
  assert.deepEqual(s.stacks, { g1: { dir: 'column', gap: 12, pad: 4, align: 'center', frame: 'e0' }, g2: { dir: 'row', gap: 24, pad: 0, align: 'start' } })
  const e = s.elements[0]
  assert.equal(e.mid, 'm1')
  assert.equal(e.name, '배지')
  assert.equal(e.hidden, true)
  const st = e.style
  assert.deepEqual(st.gradient, { from: '#7A3CFF', to: '@bg', angle: 45 })
  assert.deepEqual(st.shadow, { x: 0, y: 8, blur: 24, color: '#00000040' })
  assert.deepEqual(st.textShadow, { x: 1, y: 1, blur: 2, color: '@text' })
  for (const k of ['fillType', 'blur', 'strokeStyle', 'mask', 'brightness', 'contrast', 'tracking', 'paraSpacing', 'textTransform', 'sizing']) assert.equal(st[k], src.slides[0].elements[0].style[k], k)
  assert.equal(st.evil, undefined)
  const bad = normalizeDeck({ slides: [{ id: 's', transition: 'spin', elements: [{ id: 'e', type: 'text', x: 0, y: 0, w: 1, h: 1, mid: 5, style: { strokeStyle: 'wavy', gradient: { from: 'red;x', to: '#fff' } } }] }] })
  assert.equal(bad.slides[0].transition, 'none')
  assert.equal(bad.slides[0].elements[0].mid, undefined)
  assert.equal(bad.slides[0].elements[0].style.strokeStyle, undefined)
  assert.equal(bad.slides[0].elements[0].style.gradient.from, '@accent')
})

test('sanitizeHref: http, https, mailto만', () => {
  assert.equal(sanitizeHref('https://a.com/x'), 'https://a.com/x')
  assert.equal(sanitizeHref('mailto:me@a.com'), 'mailto:me@a.com')
  assert.equal(sanitizeHref('javascript:alert(1)'), '')
  assert.equal(sanitizeHref(' JaVaScRiPt:alert(1)'), '')
  assert.equal(sanitizeHref('data:text/html,<b>'), '')
  assert.equal(sanitizeHref('example.com'), 'https://example.com/')
})

const SAMPLES = process.env.PPTX_SAMPLES
test('실제 PPTX 파일(PPTX_SAMPLES 폴더)', { skip: !SAMPLES }, async () => {
  for (const f of fs.readdirSync(SAMPLES).filter((n) => n.endsWith('.pptx'))) {
    const res = await importPptx(fs.readFileSync(path.join(SAMPLES, f)), { uploadImage: async (b, n) => `/uploads/${n}` })
    assert.ok(res.slides.length > 0, f)
    const deck = normalizeDeck({ version: 1, theme: res.theme, slides: res.slides })
    assert.equal(deck.slides.length, res.slides.length, f)
    const n = res.slides.reduce((a, s) => a + s.elements.length, 0)
    console.log(`${f}: 슬라이드 ${res.slides.length}, 요소 ${n}, 건너뜀 ${skippedSummary(res.skipped) || '없음'}`)
  }
})
