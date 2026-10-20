// node --test src/lib/docIR/__tests__/docx.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { writeDocx, computeLineSpec } from '../writeDocx.js'
import { readDocx, parseXml } from '../readDocx.js'
import { summarize, normalizeIR, U } from '../schema.js'
import { FONT_DB, lineHeightK, percentToAutoLine } from '../docxShared.js'
import { buildReportIR, buildFeatureIR } from './docxFixtures.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = process.env.DOCX_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'docx-test-'))
const XSD_DIR = process.env.DOCX_XSD_DIR || '/Users/juhyunho/.aside/u/0/sessions/2026-09-21_Q9ydVDXUUAhCXvXu/tmp/xsd/ISO-IEC29500-4_2016'

async function build(ir, opts = {}) {
  const issues = []
  const bytes = await writeDocx(ir, { ...opts, onIssue: (i) => issues.push(i) })
  return { bytes, issues }
}
async function unzip(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const files = {}
  for (const n of Object.keys(zip.files)) if (!zip.files[n].dir) files[n] = await zip.file(n).async('uint8array')
  return files
}
const txt = (u8) => new TextDecoder().decode(u8)

// ---- OOXML 자식 순서 표 (ECMA-376 Part 1 의 xsd:sequence 순서) ----
const ORDER = {
  'w:pPr': ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange'],
  'w:rPr': ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'],
  'w:tcPr': ['w:cnfStyle', 'w:tcW', 'w:gridSpan', 'w:hMerge', 'w:vMerge', 'w:tcBorders', 'w:shd', 'w:noWrap', 'w:tcMar', 'w:textDirection', 'w:tcFitText', 'w:vAlign', 'w:hideMark'],
  'w:tblPr': ['w:tblStyle', 'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblStyleRowBandSize', 'w:tblStyleColBandSize', 'w:tblW', 'w:jc', 'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders', 'w:shd', 'w:tblLayout', 'w:tblCellMar', 'w:tblLook', 'w:tblCaption', 'w:tblDescription'],
  'w:tcBorders': ['w:top', 'w:start', 'w:left', 'w:bottom', 'w:end', 'w:right', 'w:insideH', 'w:insideV', 'w:tl2br', 'w:tr2bl'],
  'w:tblBorders': ['w:top', 'w:start', 'w:left', 'w:bottom', 'w:end', 'w:right', 'w:insideH', 'w:insideV'],
  'w:tcMar': ['w:top', 'w:start', 'w:left', 'w:bottom', 'w:end', 'w:right'],
  'w:tblCellMar': ['w:top', 'w:start', 'w:left', 'w:bottom', 'w:end', 'w:right'],
  'w:sectPr': ['w:headerReference', 'w:footerReference', 'w:footnotePr', 'w:endnotePr', 'w:type', 'w:pgSz', 'w:pgMar', 'w:paperSrc', 'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols', 'w:formProt', 'w:vAlign', 'w:noEndnote', 'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter', 'w:docGrid'],
  'w:font': ['w:altName', 'w:panose1', 'w:charset', 'w:family', 'w:notTrueType', 'w:pitch', 'w:sig', 'w:embedRegular', 'w:embedBold', 'w:embedItalic', 'w:embedBoldItalic'],
  'w:style': ['w:name', 'w:aliases', 'w:basedOn', 'w:next', 'w:link', 'w:autoRedefine', 'w:hidden', 'w:uiPriority', 'w:semiHidden', 'w:unhideWhenUsed', 'w:qFormat', 'w:locked', 'w:personal', 'w:personalCompose', 'w:personalReply', 'w:rsid', 'w:pPr', 'w:rPr', 'w:tblPr', 'w:trPr', 'w:tcPr', 'w:tblStylePr'],
  'w:settings': ['w:zoom', 'w:defaultTabStop', 'w:characterSpacingControl', 'w:compat', 'w:themeFontLang', 'w:decimalSymbol', 'w:listSeparator'],
  'wp:anchor': ['wp:simplePos', 'wp:positionH', 'wp:positionV', 'wp:extent', 'wp:effectExtent', 'wp:wrapNone', 'wp:wrapSquare', 'wp:wrapTight', 'wp:wrapThrough', 'wp:wrapTopAndBottom', 'wp:docPr', 'wp:cNvGraphicFramePr', 'a:graphic'],
  'wp:inline': ['wp:extent', 'wp:effectExtent', 'wp:docPr', 'wp:cNvGraphicFramePr', 'a:graphic'],
}
function checkOrder(node, where, errors) {
  const ord = ORDER[node.name]
  if (ord) {
    let last = -1
    for (const c of node.children) {
      const i = ord.indexOf(c.name)
      if (i < 0) { errors.push(`${where}: <${node.name}> 안에 알 수 없는 자식 <${c.name}>`); continue }
      if (i < last) errors.push(`${where}: <${node.name}> 자식 순서 오류 <${c.name}>`)
      last = Math.max(last, i)
    }
  }
  for (const c of node.children) checkOrder(c, where, errors)
}
const walk = (n, fn) => { fn(n); for (const c of n.children) walk(c, fn) }
const find = (n, name, out = []) => { walk(n, (x) => { if (x.name === name) out.push(x) }); return out }

test('구조: 필수 부품, 관계 대상, 콘텐츠 타입, XML 정합, 자식 순서, 고유 id', async () => {
  for (const [name, ir] of [['report', buildReportIR()], ['feature', buildFeatureIR()]]) {
    const { bytes, issues } = await build(ir)
    fs.writeFileSync(path.join(OUT, `${name}.docx`), bytes)
    assert.deepEqual(issues, [], `${name}: 쓰기 중 경고 없음`)
    const files = await unzip(bytes)
    for (const need of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/fontTable.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']) assert.ok(files[need], `${name}: ${need} 있음`)
    // 모든 XML 이 파싱된다
    const trees = {}
    for (const [n, u8] of Object.entries(files)) if (/\.(xml|rels)$/.test(n)) trees[n] = parseXml(txt(u8))
    // 콘텐츠 타입
    const ct = trees['[Content_Types].xml']
    const defaults = new Set(ct.children.filter((c) => c.name === 'ct:Default').map((c) => c.attrs.Extension))
    const overrides = new Set(ct.children.filter((c) => c.name === 'ct:Override').map((c) => c.attrs.PartName))
    for (const n of Object.keys(files)) { if (n === '[Content_Types].xml') continue; const ext = n.split('.').pop(); assert.ok(overrides.has('/' + n) || defaults.has(ext), `${name}: 콘텐츠 타입 없음 ${n}`) }
    // 관계 대상이 실제로 있고, 문서 안의 r:id 가 모두 정의되어 있다
    for (const [n, tree] of Object.entries(trees)) {
      if (!n.endsWith('.rels')) continue
      const base = n.replace('_rels/', '').replace(/\.rels$/, '')
      const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : ''
      for (const r of tree.children) {
        if (r.attrs.TargetMode === 'External') continue
        const target = r.attrs.Target.startsWith('/') ? r.attrs.Target.slice(1) : path.posix.normalize(dir + r.attrs.Target)
        assert.ok(files[target], `${name}: 관계 대상 없음 ${n} -> ${target}`)
      }
    }
    for (const part of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']) {
      if (!trees[part]) continue
      const relFile = trees[part.replace('word/', 'word/_rels/') + '.rels']
      const ids = new Set((relFile?.children || []).map((r) => r.attrs.Id))
      walk(trees[part], (x) => { for (const k of ['r:id', 'r:embed']) if (x.attrs[k]) assert.ok(ids.has(x.attrs[k]), `${name}: ${part} ${k}=${x.attrs[k]} 관계 없음`) })
    }
    // 자식 순서
    const errors = []
    for (const [n, tree] of Object.entries(trees)) if (n.startsWith('word/') && !n.includes('_rels')) checkOrder(tree, n, errors)
    assert.deepEqual(errors, [], `${name}: 요소 순서`)
    // docPr id 고유
    const ids = []
    for (const n of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']) if (trees[n]) find(trees[n], 'wp:docPr').forEach((d) => ids.push(d.attrs.id))
    assert.equal(new Set(ids).size, ids.length, `${name}: docPr id 고유`)
  }
})

test('표: 고정 배치, tblGrid 와 tcW 합 일치, 병합이 격자와 맞음, 한글 칸 병합이 gridSpan/vMerge 로', async () => {
  const { bytes } = await build(buildReportIR())
  const doc = parseXml(txt((await unzip(bytes))['word/document.xml']))
  const tbls = find(doc, 'w:tbl')
  assert.equal(tbls.length, 2)
  for (const t of tbls) {
    const pr = t.children.find((c) => c.name === 'w:tblPr')
    assert.equal(pr.children.find((c) => c.name === 'w:tblLayout').attrs['w:type'], 'fixed')
    const grid = t.children.find((c) => c.name === 'w:tblGrid').children.map((g) => +g.attrs['w:w'])
    const tblW = +pr.children.find((c) => c.name === 'w:tblW').attrs['w:w']
    assert.equal(grid.reduce((a, b) => a + b, 0), tblW)
    for (const tr of t.children.filter((c) => c.name === 'w:tr')) {
      let cols = 0; let wsum = 0
      for (const tc of tr.children.filter((c) => c.name === 'w:tc')) {
        const tcPr = tc.children.find((c) => c.name === 'w:tcPr')
        const gs = +(tcPr.children.find((c) => c.name === 'w:gridSpan')?.attrs['w:val'] || 1)
        const w = +tcPr.children.find((c) => c.name === 'w:tcW').attrs['w:w']
        assert.equal(w, grid.slice(cols, cols + gs).reduce((a, b) => a + b, 0), 'tcW = 걸친 열 폭 합')
        cols += gs; wsum += w
        assert.equal(tc.children[tc.children.length - 1].name, 'w:p', '칸은 문단으로 끝남')
      }
      assert.equal(cols, grid.length, '행이 모든 열을 덮음')
      assert.equal(wsum, tblW)
    }
  }
  // 두 번째 표: 구분 칸이 vMerge restart/continue
  const merges = find(tbls[1], 'w:vMerge').map((m) => m.attrs['w:val'] || 'continue')
  assert.deepEqual(merges, ['restart', 'continue'])
  // 머리 행은 gridSpan 4 + 파란 회색 바탕
  const firstCell = find(tbls[0], 'w:tc')[0]
  const shd = find(firstCell, 'w:shd')[0]
  assert.equal(shd.attrs['w:fill'], 'C0CDEF'); assert.equal(shd.attrs['w:val'], 'clear')
  assert.equal(find(firstCell, 'w:gridSpan')[0].attrs['w:val'], '4')
})

test('줄 간격: 글꼴 보정 배수와 exact 모두 한글 줄 피치(글자 크기 x 비율)와 같다', () => {
  const ir = normalizeIR({ body: [] }).ir
  const fonts = ['맑은 고딕', '바탕', '굴림', '돋움', 'MS Gothic', 'HY헤드라인M', 'HY견고딕', '함초롬바탕', '함초롬돋움', '휴먼명조', 'Arial', 'Times New Roman', 'Calibri']
  for (const f of fonts) for (const pct of [100, 130, 160, 200]) for (const size of [9, 10, 11, 15]) {
    const p = { t: 'p', runs: [{ text: '가나다', sizePt: size, font: { ko: f, latin: f } }], lineSpacing: { mode: 'percent', value: pct } }
    const want = (size * pct) / 100
    const ex = computeLineSpec(p, ir, {})
    assert.equal(ex.rule, 'exact'); assert.ok(Math.abs(ex.line / 20 - want) <= 0.03, `${f} exact ${pct}% ${size}pt`)
    const ca = computeLineSpec(p, ir, { lineSpacingMode: 'calibrated' })
    assert.equal(ca.rule, 'auto')
    const k = lineHeightK(f)
    const pitch = size * k * (ca.line / 240)
    assert.ok(Math.abs(pitch - want) / want < 0.003, `${f} calibrated ${pct}% ${size}pt: ${pitch} vs ${want}`)
  }
  // 맑은 고딕에서 한컴 방식(배수 그대로)은 160% 가 213% 가 되어 쪽이 밀린다: 증거
  const k = lineHeightK('맑은 고딕')
  assert.ok(Math.abs(1.6 * k - 2.128) < 0.01)
  assert.equal(percentToAutoLine(160, k), 289)
  // 그림이 든 문단은 auto, 알 수 없는 글꼴 + calibrated 는 atLeast 로 물러남
  const withImg = { t: 'p', runs: [{ text: '글', sizePt: 10 }, { image: { id: 'x', wPt: 10, hPt: 10 } }], lineSpacing: { mode: 'percent', value: 160 } }
  assert.equal(computeLineSpec(withImg, ir, {}).rule, 'auto')
  const unk = { t: 'p', runs: [{ text: '글', sizePt: 10, font: { ko: '없는글꼴', latin: '없는글꼴' } }], lineSpacing: { mode: 'percent', value: 160 } }
  assert.equal(computeLineSpec(unk, ir, { lineSpacingMode: 'calibrated' }).rule, 'atLeast')
  assert.equal(computeLineSpec({ t: 'p', runs: [{ text: 'a' }], lineSpacing: { mode: 'exactPt', value: 18 } }, ir, {}).line, 360)
})

test('글꼴 표: 측정값이 있고 한컴 글꼴은 fontTable 에 대체 글꼴이 적힌다', async () => {
  assert.ok(FONT_DB.length >= 20)
  assert.ok(Math.abs(lineHeightK('Malgun Gothic') - 1.3301) < 1e-3)
  assert.equal(lineHeightK('HYHeadLine Medium'), lineHeightK('HY헤드라인M'))
  const { bytes } = await build(buildReportIR())
  const files = await unzip(bytes)
  const ft = parseXml(txt(files['word/fontTable.xml']))
  const byName = Object.fromEntries(find(ft, 'w:font').map((f) => [f.attrs['w:name'], f]))
  assert.equal(find(byName['HY헤드라인M'], 'w:altName')[0].attrs['w:val'], '맑은 고딕')
  assert.equal(find(byName['HY헤드라인M'], 'w:charset')[0].attrs['w:val'], '81')
  assert.ok(byName['MS Gothic'] && !find(byName['MS Gothic'], 'w:altName').length)
  assert.ok(byName['한림체 Regular'], '모르는 글꼴도 이름을 그대로 둠')
  assert.equal(find(byName['한림체 Regular'], 'w:altName')[0].attrs['w:val'], '맑은 고딕')
  const doc = txt(files['word/document.xml'])
  assert.match(doc, /w:eastAsia="HY헤드라인M"/)
  assert.match(doc, /<w:sz w:val="30"\/>/)
})

test('쪽 설정: pgSz/pgMar, 머리말 거리 공식, 본문 시작 위치', async () => {
  const ir = buildReportIR()
  const { bytes } = await build(ir)
  const doc = parseXml(txt((await unzip(bytes))['word/document.xml']))
  const sect = find(doc, 'w:sectPr')[0]
  const sz = find(sect, 'w:pgSz')[0].attrs; const mar = find(sect, 'w:pgMar')[0].attrs
  assert.equal(+sz['w:w'], 11906); assert.equal(+sz['w:h'], 16838)
  assert.equal(+mar['w:top'], 1417); assert.equal(+mar['w:bottom'], 1701); assert.equal(+mar['w:left'], 1134)
  // headerMm=10 이고 머리말 한 줄(8pt x 120% = 9.6pt) 이므로 header 거리 = top - 10mm
  assert.equal(+mar['w:header'], U.ptToDxa(U.mmToPt(25) - U.mmToPt(10)))
  assert.equal(+mar['w:footer'], U.ptToDxa(U.mmToPt(30) - U.mmToPt(15)))
  // 머리말이 띠보다 크면 머리말을 위로 올려 본문이 밀리지 않게 한다 (header 거리 = top - 내용 높이)
  const big = buildReportIR()
  big.header = [{ t: 'p', runs: [{ text: '큰 머리말', sizePt: 20 }], lineSpacing: { mode: 'exactPt', value: 40 } }] // 40pt = 14.1mm > 10mm
  const b2 = await build(big)
  const m2 = find(parseXml(txt((await unzip(b2.bytes))['word/document.xml'])), 'w:pgMar')[0].attrs
  assert.equal(+m2['w:header'], U.ptToDxa(U.mmToPt(25) - 40))
  assert.ok(+m2['w:header'] + 40 * 20 <= +m2['w:top'] + 1, '머리말 끝이 본문 시작을 넘지 않음')
  // 위 여백보다 크면 경고
  big.header = [{ t: 'p', runs: [{ text: 'x' }], lineSpacing: { mode: 'exactPt', value: 100 } }]
  const b3 = await build(big)
  assert.ok(b3.issues.some((i) => i.path === 'header'))
  // 가로 + 책등
  const land = buildReportIR(); land.page.orientation = 'landscape'; land.page.gutterMm = 5
  const b4 = await build(land)
  const s4 = find(parseXml(txt((await unzip(b4.bytes))['word/document.xml'])), 'w:sectPr')[0]
  assert.equal(find(s4, 'w:pgSz')[0].attrs['w:orient'], 'landscape'); assert.equal(+find(s4, 'w:pgSz')[0].attrs['w:w'], 16838)
  assert.equal(+find(s4, 'w:pgMar')[0].attrs['w:gutter'], U.mmToDxa(5))
})

test('한글 조판 설정: 호환 모드 15, 격자 없음, 영문숫자 자동 간격 끔, 외톨이줄 끔', async () => {
  const { bytes } = await build(buildReportIR())
  const files = await unzip(bytes)
  const settings = txt(files['word/settings.xml'])
  assert.match(settings, /compatibilityMode"[^>]*w:val="15"/)
  assert.match(settings, /w:defaultTabStop w:val="800"/)
  const doc = txt(files['word/document.xml'])
  assert.ok(!doc.includes('docGrid'))
  const styles = txt(files['word/styles.xml'])
  assert.match(styles, /<w:autoSpaceDE w:val="0"\/><w:autoSpaceDN w:val="0"\/><w:snapToGrid w:val="0"\/>/)
  assert.match(styles, /<w:widowControl w:val="0"\/>/)
  assert.match(styles, /w:eastAsia="ko-KR"/)
  // 글자 단위 줄바꿈은 x.breakByChar 일 때만
  const ir = buildReportIR(); ir.body[1].x = { breakByChar: true }
  const d2 = txt((await unzip((await build(ir)).bytes))['word/document.xml'])
  assert.equal((d2.match(/<w:wordWrap w:val="0"\/>/g) || []).length, 1)
  assert.ok(!doc.includes('wordWrap'))
  // 항목 부호는 글자로: 자동 번호 없음
  assert.ok(!doc.includes('w:numPr'))
  assert.match(doc, /<w:t xml:space="preserve">▪ <\/w:t>/)
  assert.match(doc, /w:hanging="200"/)
})

test('체크박스, 형광펜, 링크, 필드, 그림: 요소와 값', async () => {
  const { bytes } = await build(buildReportIR())
  const files = await unzip(bytes)
  const doc = txt(files['word/document.xml'])
  assert.match(doc, /<w:t>☑<\/w:t>/); assert.match(doc, /<w:t>☐<\/w:t>/)
  assert.match(doc, /w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:cs="MS Gothic" w:hint="eastAsia"/)
  assert.match(doc, /<w:highlight w:val="yellow"\/>/)
  const footer = txt(files['word/footer1.xml'])
  assert.match(footer, /PAGE/); assert.match(footer, /NUMPAGES/)
  assert.equal((footer.match(/fldCharType="begin"/g) || []).length, 2)
  // 로고: 앵커 그림, 오른쪽, 78pt = 990600 EMU
  const tree = parseXml(doc)
  const anc = find(tree, 'wp:anchor')[0]
  assert.equal(find(anc, 'wp:positionH')[0].children[0].text, 'right')
  assert.equal(find(anc, 'wp:extent')[0].attrs.cx, String(78 * 12700))
  assert.equal(find(anc, 'wp:docPr')[0].attrs.descr, '한림대학교 로고')
  assert.equal(find(anc, 'wp:docPr')[0].attrs.id, '1')
  assert.ok(files['word/media/image1.png'])
  // 기능 문서
  const f = await build(buildFeatureIR())
  const ff = await unzip(f.bytes)
  const fdoc = txt(ff['word/document.xml'])
  assert.match(fdoc, /<w:hyperlink r:id="rId\d+" w:history="1">/)
  const rels = txt(ff['word/_rels/document.xml.rels'])
  assert.match(rels, /Target="https:\/\/example\.com\/a\?b=1&amp;c=2" TargetMode="External"/)
  assert.match(fdoc, /<wp:inline distT="0"/)
  assert.match(fdoc, /<w:tab\/>/); assert.match(fdoc, /<w:br\/>/)
  assert.match(fdoc, /<w:pageBreakBefore\/>/)
  assert.match(fdoc, /<w:tl2br w:val="single"/)
  assert.match(fdoc, /<w:textDirection w:val="tbRlV"\/>/)
  assert.match(fdoc, /<w:tblHeader\/>/); assert.match(fdoc, /<w:cantSplit\/>/)
  assert.match(fdoc, /w:hRule="exact"/)
  assert.match(fdoc, /w:vertAlign w:val="superscript"|<w:vertAlign w:val="superscript"\/>/)
  assert.match(fdoc, /<w:w w:val="80"\/>/)
  assert.match(fdoc, /<w:spacing w:val="-10"\/>/) // 자간 -5% x 10pt = -0.5pt = -10 twips
  // 콘텐츠 컨트롤 옵션
  const cc = await build(buildFeatureIR(), { contentControls: true })
  const cdoc = txt((await unzip(cc.bytes))['word/document.xml'])
  assert.match(cdoc, /<w14:checkbox>/); assert.match(cdoc, /w14:checkedState w14:val="2611" w14:font="MS Gothic"/)
  const back = await readDocx(cc.bytes)
  const checks = back.body.flatMap((b) => (b.t === 'p' ? b.runs.filter((r) => r.check) : []))
  assert.deepEqual(checks.map((c) => c.check.checked), [true, false])
})

test('지원하지 않는 이미지(SVG)는 건너뛰고 경고하며 문서는 열린다', async () => {
  const ir = buildFeatureIR()
  ir.assets.im = { mime: 'image/svg+xml', data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), w: 10, h: 10 }
  const { bytes, issues } = await build(ir)
  assert.ok(issues.some((i) => /SVG|svg|지원하지 않는 이미지/.test(i.msg)))
  const files = await unzip(bytes)
  assert.ok(files['word/document.xml'])
})

function sameSummary(a, b, label) {
  assert.deepEqual(b.paragraphs, a.paragraphs, `${label}: 글 순서`)
  assert.equal(b.figures, a.figures, `${label}: 그림 수`)
  assert.equal(b.tables.length, a.tables.length, `${label}: 표 수`)
  for (let i = 0; i < a.tables.length; i++) {
    const x = a.tables[i]; const y = b.tables[i]
    assert.equal(y.rows, x.rows); assert.equal(y.cols, x.cols)
    assert.ok(Math.abs(y.widthPt - x.widthPt) <= 0.5, `${label}: 표 폭 ${y.widthPt} vs ${x.widthPt}`)
    x.colPt.forEach((w, k) => assert.ok(Math.abs(y.colPt[k] - w) <= 0.5, `${label}: 열 폭 ${k}`))
    assert.deepEqual(y.merges, x.merges, `${label}: 병합`)
    assert.deepEqual(y.bgs, x.bgs, `${label}: 칸 배경`)
  }
  assert.ok(Math.abs(a.page.wMm - b.page.wMm) < 0.1 && Math.abs(a.page.hMm - b.page.hMm) < 0.1, `${label}: 쪽 크기`)
  for (const k of ['top', 'right', 'bottom', 'left']) assert.ok(Math.abs(a.page.margin[k] - b.page.margin[k]) < 0.05, `${label}: 여백 ${k}`)
}

test('왕복: IR -> writeDocx -> readDocx 가 summarize 를 보존한다 (보고서, 기능 문서)', async () => {
  for (const [name, ir] of [['report', buildReportIR()], ['feature', buildFeatureIR()]]) {
    const { bytes } = await build(ir)
    const back = await readDocx(bytes)
    sameSummary(summarize(normalizeIR(ir).ir), summarize(back), name)
    // 세부: 체크, 형광펜, 링크, 항목 부호, 머리말/꼬리말 필드
    if (name === 'report') {
      const runs = (bl) => bl.flatMap((b) => (b.t === 'p' ? b.runs : b.t === 'table' ? b.rows.flatMap((r) => r.cells.flatMap((c) => runs(c.blocks))) : []))
      const all = runs(back.body)
      assert.ok(all.some((r) => r.highlight === '#FFFF00' && r.text === '3명 중 3명'))
      assert.deepEqual(all.filter((r) => r.check).map((r) => r.check.checked), [true, false])
      assert.deepEqual(back.footer[0].runs.filter((r) => r.field).map((r) => r.field), ['page', 'pages'])
      assert.equal(back.body[0].t, 'figure'); assert.deepEqual(back.body[0].float, { x: 'right', y: 'top', wrap: 'square' })
      assert.ok(Math.abs(back.body[0].wPt - 78) < 0.2)
      assert.ok(Math.abs(back.page.headerMm - 10) < 0.05); assert.ok(Math.abs(back.page.footerMm - 15) < 0.05)
      const title = back.body[1]
      assert.equal(title.runs[0].font.ko, 'HY헤드라인M'); assert.equal(title.runs[0].sizePt, 15); assert.equal(title.align, 'center')
      const bl = back.body[2].rows[3].cells[1].blocks[0]
      assert.deepEqual(bl.list, { kind: 'bullet', level: 0, marker: '▪' }); assert.equal(bl.align, 'justify')
      assert.ok(Math.abs(bl.indent.firstLinePt + 10) < 0.1)
      assert.equal(bl.lineSpacing.mode, 'exactPt') // 한글 160% x 10pt = 16pt 고정 (hybrid)
      assert.equal(bl.lineSpacing.value, 16)
      assert.equal(back.body[2].border.style, 'solid')
    } else {
      const runs = back.body.filter((b) => b.t === 'p').flatMap((b) => b.runs)
      assert.ok(runs.some((r) => r.link === 'https://example.com/a?b=1&c=2'))
      assert.ok(runs.some((r) => r.sup) && runs.some((r) => r.sub))
      assert.ok(runs.some((r) => r.scalePct === 80 && r.spacingPct === -5))
      assert.ok(runs.some((r) => r.underline === 'double') && runs.some((r) => r.strike))
      assert.equal(back.body[0].heading, 1)
    }
  }
})

test('왕복(글꼴 보정 배수 모드): percent 가 보존된다', async () => {
  const ir = buildReportIR()
  ir.defaults.font = { ko: '맑은 고딕', latin: '맑은 고딕' } // 줄 높이를 아는 글꼴
  const { bytes } = await build(ir, { lineSpacingMode: 'calibrated' })
  const back = await readDocx(bytes)
  const bl = back.body[2].rows[3].cells[1].blocks[0]
  assert.equal(bl.lineSpacing.mode, 'percent')
  assert.equal(bl.lineSpacing.value, 160)
})

test('테두리 왕복: 표 기본선과 칸별 선(이중선, 대각선)', async () => {
  const back = await readDocx((await build(buildFeatureIR())).bytes)
  const tables = back.body.filter((b) => b.t === 'table')
  assert.equal(tables[0].border.style, 'solid'); assert.equal(tables[0].border.color, '#444444'); assert.equal(tables[0].align, 'center')
  const diag = tables[0].rows[1].cells[1]
  assert.equal(diag.border.diagDown.color, '#FF0000')
  const dbl = tables[1].rows[0].cells[0]
  assert.equal(dbl.border.bottom.style, 'double')
  assert.equal(tables[1].rows[0].cells[1].padPt.t, 6)
  assert.equal(tables[0].rows[0].header, true); assert.equal(tables[0].rows[0].cantSplit, true)
  assert.equal(tables[0].rows[1].heightRule, 'exact'); assert.equal(tables[0].rows[1].heightPt, 40)
  assert.equal(tables[0].rows[2].cells[0].textDir, 'vertical')
  assert.equal(tables[0].rows[2].cells[1].blocks[1].t, 'table')
})

test('python-docx 가 열고 표, 병합, 구역을 읽는다', { skip: !hasPythonDocx() }, async () => {
  for (const name of ['report', 'feature']) {
    const f = path.join(OUT, `${name}.docx`)
    if (!fs.existsSync(f)) fs.writeFileSync(f, (await build(name === 'report' ? buildReportIR() : buildFeatureIR())).bytes)
    const out = execFileSync('python3', ['-c', `
import docx, json, sys
d = docx.Document(sys.argv[1])
s = d.sections[0]
print(json.dumps({'sections': len(d.sections), 'w': round(s.page_width.mm,1), 'h': round(s.page_height.mm,1), 'tables': [[len(t.rows), len(t.columns)] for t in d.tables], 'cols': [[round(c.width.pt,1) for c in t.columns] for t in d.tables]}))
`, f]).toString()
    const j = JSON.parse(out)
    assert.equal(j.sections, 1); assert.equal(j.w, 210); assert.equal(j.h, 297)
    if (name === 'report') { assert.deepEqual(j.tables, [[4, 4], [5, 4]]); assert.deepEqual(j.cols[0], [85, 178.4, 77, 141.5]) }
    else assert.deepEqual(j.tables, [[3, 3], [1, 2]])
  }
})
function hasPythonDocx() { try { execFileSync('python3', ['-c', 'import docx']); return true } catch { return false } }
function hasXsd() { try { return fs.existsSync(path.join(XSD_DIR, 'wml.xsd')) && (execFileSync('python3', ['-c', 'import lxml']), true) } catch { return false } }

test('ECMA-376 Transitional XSD 검증 (XSD 가 있을 때)', { skip: !hasXsd() }, async () => {
  const run = (f) => { try { return { ok: true, out: execFileSync('python3', [path.join(here, 'validate_docx.py'), f, XSD_DIR]).toString() } } catch (e) { return { ok: false, out: String(e.stdout || e.message) } } }
  for (const [name, ir, opts] of [['report', buildReportIR(), {}], ['feature', buildFeatureIR(), {}], ['feature-cc', buildFeatureIR(), { contentControls: true }], ['report-cal', buildReportIR(), { lineSpacingMode: 'calibrated' }]]) {
    const f = path.join(OUT, `${name}.xsd.docx`)
    fs.writeFileSync(f, (await build(ir, opts)).bytes)
    const r = run(f)
    assert.ok(r.ok, `${name} XSD 오류:\n${r.out}`)
  }
  // 음성 대조: pPr 안의 jc 와 spacing 순서를 바꾸면 검증이 실패해야 한다
  const bytes = (await build(buildReportIR())).bytes
  const zip = await JSZip.loadAsync(bytes)
  let x = await zip.file('word/document.xml').async('string')
  x = x.replace(/(<w:spacing [^>]*\/>)(<w:jc w:val="center"\/>)/, '$2$1')
  zip.file('word/document.xml', x)
  const bad = path.join(OUT, 'neg.docx')
  fs.writeFileSync(bad, await zip.generateAsync({ type: 'uint8array' }))
  assert.equal(run(bad).ok, false, '순서가 틀린 파일은 XSD 검증을 통과하면 안 됨')
})

// 실제 문서 읽기: 사용자 폴더에 있는 docx 를 읽어 본다 (없으면 건너뜀)
const REAL_ROOT = process.env.DOCX_REAL_DIR || '/Users/juhyunho/Desktop/00. 26-2학기'
test('실제 docx 읽기: 예외 없이 IR 로 바뀌고 정규화를 통과한다', { skip: !fs.existsSync(REAL_ROOT), timeout: 110000 }, async () => {
  const files = []
  const walkDir = (d, depth = 0) => {
    if (depth > 5 || files.length >= 40) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('~$') || e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walkDir(p, depth + 1)
      else if (e.name.endsWith('.docx') && files.length < 40) files.push(p)
    }
  }
  walkDir(REAL_ROOT)
  let tables = 0; let paras = 0
  const fails = []
  for (const f of files) {
    try {
      const buf = fs.readFileSync(f)
      if (buf[0] !== 0x50) { // 확장자만 docx 인 구형 파일: 읽기가 분명한 오류를 낸다
        await assert.rejects(() => readDocx(buf), /docx|zip/)
        continue
      }
      const ir = await readDocx(buf)
      const s = summarize(ir)
      tables += s.tables.length; paras += s.paragraphs.length
      assert.ok(s.page.wMm > 100)
      for (const t of s.tables) assert.ok(!t.error, `${path.basename(f)}: ${t.error}`)
      // 읽은 문서를 다시 쓰고 다시 읽어도 구조가 같다
      const again = await readDocx(await writeDocx(ir))
      const s2 = summarize(again)
      assert.equal(s2.tables.length, s.tables.length, `${path.basename(f)}: 표 수`)
      assert.equal(s2.paragraphs.length, s.paragraphs.length, `${path.basename(f)}: 문단 수`)
    } catch (e) { fails.push(`${path.basename(f)}: ${e.message}`) }
  }
  console.log(`# 실제 docx ${files.length}개 읽음, 표 ${tables}, 문단 ${paras}`)
  assert.deepEqual(fails, [])
})
