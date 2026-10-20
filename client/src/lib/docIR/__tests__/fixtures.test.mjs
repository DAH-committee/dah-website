// 시험 문서(fixtures)와 export-check 도구 함수 시험.  cd client && node --test src/lib/docIR/__tests__/fixtures.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { normalizeIR, tableGrid, walkBlocks, summarize } from '../schema.js'
import { loadFixture, listFixtures, FIXTURE_NAMES, freezeIR, reviveIR } from '../fixtures/load.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const docIR = path.resolve(here, '..')
const ec = path.resolve(here, '../../../../scripts/export-check')
const lib = await import(pathToFileURL(path.join(ec, 'lib.mjs')).href)
const run = await import(pathToFileURL(path.join(ec, 'run.mjs')).href)
const report = await import(pathToFileURL(path.join(ec, 'report.mjs')).href)
const kit = await import(pathToFileURL(path.join(ec, 'make-kit.mjs')).href)
const opt = async (f) => (fs.existsSync(path.join(docIR, f)) ? import(pathToFileURL(path.join(docIR, f)).href).catch(() => null) : null)
const wd = await opt('writeDocx.js')
const wh = await opt('writeHwpx.js')

// ---------------------------------------------------------------- fixtures
test('시험 문서 6종이 있다', () => {
  assert.deepEqual(listFixtures(), [...FIXTURE_NAMES].sort())
  for (const n of ['mentoring-report', 'gian', 'plan-report', 'table-torture', 'typography']) assert.ok(listFixtures().includes(n), n)
})

for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}: normalizeIR 문제 0건, 표 격자 정상`, () => {
    const ir = loadFixture(name)
    const { issues, ir: n } = normalizeIR(ir)
    assert.deepEqual(issues, [])
    walkBlocks(n.body, (b) => { if (b.t === 'table') assert.equal(tableGrid(b).error, undefined) })
    for (const [id, a] of Object.entries(ir.assets)) { assert.ok(a.data instanceof Uint8Array, id); assert.ok(a.w > 0 && a.h > 0); assert.equal(a.mime, 'image/png'); assert.equal(Buffer.from(a.data).subarray(1, 4).toString(), 'PNG') }
    // 본문의 그림 id 가 모두 assets 에 있다
    walkBlocks(ir.body, (b) => { if (b.t === 'figure') assert.ok(ir.assets[b.id], b.id); if (b.t === 'p') for (const r of b.runs) if (r.image) assert.ok(ir.assets[r.image.id]) })
    assert.ok(Buffer.byteLength(JSON.stringify(freezeIR(ir))) < 400 * 1024, '시험 문서가 너무 큼')
  })
}

test('loadFixture: 없는 이름은 안내 오류, base64 는 Uint8Array 로 복원', () => {
  assert.throws(() => loadFixture('nope'), /시험 문서 없음/)
  const ir = loadFixture('mentoring-report')
  assert.ok(ir.assets.logo.data instanceof Uint8Array)
  const frozen = freezeIR(ir)
  assert.equal(typeof frozen.assets.logo.data, 'string')
  assert.deepEqual(Array.from(reviveIR(frozen).assets.logo.data.slice(0, 8)), Array.from(ir.assets.logo.data.slice(0, 8)))
})

test('mentoring-report: 캡처의 특징(병합 머리 행, 음영, 체크박스, 노란 형광펜, ▪ 글머리)을 가진다', () => {
  const ir = loadFixture('mentoring-report')
  const tables = ir.body.filter((b) => b.t === 'table')
  assert.ok(tables.length >= 2)
  assert.ok(tables[0].rows[0].cells[0].colspan === 4 && tables[0].rows[0].cells[0].bg)
  const texts = summarize(normalizeIR(ir).ir).paragraphs.join('\n')
  for (const t of ['□ 멘토링 그룹 정보', '학과(전공)', '교과목명', '그룹명', '활동 목표', '멘토링 일시', '활동 방법', '(멘티)출석 인원', '구분', '세부 내용', '3명 중 3명', '온라인(ZOOM)', '오프라인']) assert.ok(texts.includes(t), t)
  let checked = 0, unchecked = 0, yellow = 0, bullets = 0
  walkBlocks(ir.body, (b) => { if (b.t === 'p') { if (b.list?.marker === '▪') bullets++; for (const r of b.runs) { if (r.check?.checked === true) checked++; if (r.check?.checked === false) unchecked++; if (r.highlight === '#FFFF00') yellow++ } } })
  assert.equal(checked, 1); assert.equal(unchecked, 1); assert.equal(yellow, 1); assert.ok(bullets >= 6)
  const logo = ir.body.find((b) => b.t === 'figure')
  assert.equal(logo.align, 'right')
  assert.equal(ir.page.size, 'A4')
  assert.ok(ir.body.some((b) => b.t === 'p' && b.runs.some((r) => r.font?.ko === 'HY헤드라인M')))
})

test('gian: 항목 부호 1. 가. 1) 가) 가 글자로 있고 내어쓰기(음수 첫 줄)를 쓴다, 결재란 표', () => {
  const ir = loadFixture('gian')
  const markers = ir.body.filter((b) => b.t === 'p' && b.list?.marker).map((b) => b.list.marker)
  for (const m of ['1.', '가.', '1)', '가)']) assert.ok(markers.includes(m), m)
  assert.ok(ir.body.filter((b) => b.t === 'p' && b.list?.marker).every((b) => b.indent.firstLinePt < 0))
  assert.ok(summarize(normalizeIR(ir).ir).paragraphs.some((p) => p.startsWith('붙임')))
  assert.ok(ir.body.some((b) => b.t === 'table' && b.align === 'right'))
})

test('plan-report: 예산표 합계가 항목 곱의 합과 같고, 쪽 번호 필드와 그림 설명이 있다', () => {
  const ir = loadFixture('plan-report')
  const budget = ir.body.filter((b) => b.t === 'table')[1]
  const cellText = (c) => c.blocks.map((b) => b.runs.map((r) => r.text).join('')).join('')
  const num = (s) => Number(s.replace(/,/g, ''))
  const rows = budget.rows.slice(2)
  const data = rows.slice(0, -1)
  let sum = 0
  for (const r of data) { const t = r.cells.map(cellText); const n = t.slice(-4); sum += num(n[3]); assert.equal(num(n[0]) * num(n[1]) * num(n[2]), num(n[3])) }
  assert.equal(num(cellText(rows.at(-1).cells.at(-1))), sum)
  assert.ok(budget.rows[0].header && budget.rows[1].header)
  assert.ok(ir.footer[0].runs.some((r) => r.field === 'page'))
  assert.ok(ir.body.some((b) => b.t === 'figure' && b.caption))
  assert.ok(ir.body.some((b) => b.t === 'p' && b.list?.level === 2))
})

test('table-torture: 병합 모양, 선 모양, 대각선, 세로쓰기, 중첩, 높이 규칙, 제목 반복, 쪽 경계 병합이 모두 있다', () => {
  const ir = loadFixture('table-torture')
  const tables = []
  walkBlocks(ir.body, (b, p) => { if (b.t === 'table') tables.push({ b, nested: p.includes('.r') }) })
  const cells = tables.flatMap(({ b }) => b.rows.flatMap((r) => r.cells))
  assert.ok(cells.some((c) => c.colspan > 1 && c.rowspan > 1), '2x2 이상 병합')
  assert.ok(cells.some((c) => c.colspan > 1 && !(c.rowspan > 1)) && cells.some((c) => c.rowspan > 1 && !(c.colspan > 1)))
  const styles = new Set(cells.flatMap((c) => Object.values(c.border || {}).map((x) => x.style)))
  for (const s of ['none', 'double', 'dashed', 'dotted', 'thick-thin', 'solid']) assert.ok(styles.has(s), s)
  assert.ok(cells.some((c) => c.border?.diagDown) && cells.some((c) => c.border?.diagUp))
  assert.ok(cells.some((c) => c.textDir === 'vertical'))
  assert.ok(tables.some((t) => t.nested))
  const rules = new Set(tables.flatMap(({ b }) => b.rows.map((r) => r.heightRule)))
  assert.ok(rules.has('exact') && rules.has('atLeast'))
  const tall = tables.map((t) => t.b).sort((a, b) => b.rows.length - a.rows.length)[0]
  assert.ok(tall.rows.length > 60 && tall.rows[0].header && tall.rows[1].header && tall.rows.slice(2).every((r) => r.cantSplit))
  // 세로 병합이 쪽 경계 근처(25~29번째 줄)에 걸쳐 있다
  const spanAt = tall.rows.findIndex((r) => r.cells.some((c) => c.rowspan === 5))
  assert.ok(spanAt > 20 && spanAt < 40)
})

test('typography: 글꼴 5종, 장평/자간, 줄 간격 4종, 맞춤 5종, 첨자, 밑줄 4종, 탭, 링크, 체크박스; 가로 쪽 변형', () => {
  const ir = loadFixture('typography')
  const runs = []
  const ps = []
  walkBlocks(ir.body, (b) => { if (b.t === 'p') { ps.push(b); runs.push(...b.runs) } })
  const fonts = new Set(runs.map((r) => r.font?.ko).filter(Boolean))
  for (const f of ['HY헤드라인M', '함초롬바탕', '맑은 고딕', '굴림', 'Times New Roman']) assert.ok(fonts.has(f), f)
  assert.deepEqual([...new Set(runs.map((r) => r.scalePct).filter(Boolean))].sort((a, b) => a - b), [90, 100, 110])
  assert.deepEqual([...new Set(runs.map((r) => r.spacingPct).filter((x) => x !== undefined))].sort((a, b) => a - b), [-5, 0, 5])
  const ls = new Set(ps.map((p) => p.lineSpacing && `${p.lineSpacing.mode}:${p.lineSpacing.value}`).filter(Boolean))
  for (const s of ['percent:130', 'percent:160', 'percent:200', 'exactPt:18']) assert.ok(ls.has(s), s)
  assert.deepEqual([...new Set(ps.map((p) => p.align).filter(Boolean))].sort(), ['center', 'distribute', 'justify', 'left', 'right'])
  assert.ok(runs.some((r) => r.sup) && runs.some((r) => r.sub) && runs.some((r) => r.highlight) && runs.some((r) => r.tab) && runs.some((r) => r.link) && runs.some((r) => r.check))
  assert.deepEqual([...new Set(runs.map((r) => r.underline).filter(Boolean))].sort(), ['dash', 'dotted', 'double', 'single'])
  assert.equal(loadFixture('typography-landscape').page.orientation, 'landscape')
})

// ---------------------------------------------------------------- lib: zip, xml
async function zipOf(files, store = []) {
  const z = new JSZip()
  for (const [n, c] of Object.entries(files)) z.file(n, c, { compression: store.includes(n) ? 'STORE' : 'DEFLATE', createFolders: false })
  return new Uint8Array(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}

test('readZip: 항목 순서, 압축 방식, 내용', async () => {
  const bytes = await zipOf({ mimetype: 'application/hwp+zip', 'a/b.xml': '<x/>' }, ['mimetype'])
  const z = lib.readZip(bytes)
  assert.deepEqual(z.names, ['mimetype', 'a/b.xml'])
  assert.equal(z.entry('mimetype').method, 0)
  assert.equal(z.entry('a/b.xml').method, 8)
  assert.equal(z.text('a/b.xml'), '<x/>')
  assert.throws(() => lib.readZip(new Uint8Array([1, 2, 3, 4])), /zip/)
})

test('parseXml: 정상은 트리, 깨진 XML 은 오류', () => {
  const n = lib.parseXml('<?xml version="1.0"?><a:r xmlns:a="u" id="1"><a:b x="&amp;">텍스트 &lt;</a:b><c/><!-- 주석 --></a:r>')
  assert.equal(n.name, 'a:r'); assert.equal(n.kids.length, 2); assert.equal(n.kids[0].attrs.x, '&amp;')
  for (const bad of ['<a><b></a></b>', '<a>', '<a x=1/>', '<a>& </a>', '<a/><b/>', '<a x="1" x="2"/>', '<a><</a>']) assert.throws(() => lib.parseXml(bad), /XML 오류/, bad)
})

test('checkChildOrder: ECMA 순서를 어기면 잡는다', () => {
  const ok = lib.parseXml('<w:pPr><w:pStyle/><w:keepNext/><w:spacing/><w:ind/><w:jc/></w:pPr>')
  assert.deepEqual(lib.checkChildOrder(ok, 'pPr', lib.DOCX_ORDER.pPr, 'x'), [])
  const bad = lib.parseXml('<w:pPr><w:jc/><w:spacing/></w:pPr>')
  const i = lib.checkChildOrder(bad, 'pPr', lib.DOCX_ORDER.pPr, 'x')
  assert.equal(i.length, 1); assert.equal(i[0].sev, 'error')
  const rbad = lib.parseXml('<w:rPr><w:sz/><w:b/></w:rPr>')
  assert.equal(lib.checkChildOrder(rbad, 'rPr', lib.DOCX_ORDER.rPr, 'x')[0].sev, 'warn')
  const unk = lib.parseXml('<w:tcPr><w:tcW/><w:bogus/></w:tcPr>')
  assert.equal(lib.checkChildOrder(unk, 'tcPr', lib.DOCX_ORDER.tcPr, 'x')[0].sev, 'error')
  // 스키마 순서 표 자체가 중복 없이 일관된지
  for (const [k, v] of Object.entries(lib.DOCX_ORDER)) if (v) assert.equal(new Set(v).size, v.length, k)
})

// ---------------------------------------------------------------- DOCX 검사
const MIN_DOC = {
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/_rels/document.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
}
const docXml = (body) => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`

test('checkDocx: 최소 문서 통과, 순서 오류·관계 누락·표 격자 오류·빈 칸 문단 없음을 잡는다', async () => {
  const good = lib.checkDocx(await zipOf({ ...MIN_DOC, 'word/document.xml': docXml('<w:p><w:pPr><w:jc w:val="left"/></w:pPr></w:p>') }))
  assert.equal(good.errors.length, 0, JSON.stringify(good.errors))
  assert.equal(good.info.sections[0].wPt, 595.3)
  const order = lib.checkDocx(await zipOf({ ...MIN_DOC, 'word/document.xml': docXml('<w:p><w:pPr><w:jc w:val="left"/><w:keepNext/></w:pPr></w:p>') }))
  assert.ok(order.errors.some((e) => /순서/.test(e.msg)))
  const rel = lib.checkDocx(await zipOf({ ...MIN_DOC, 'word/document.xml': docXml('<w:p><w:r><w:drawing><a:blip xmlns:a="x" r:embed="rId9"/></w:drawing></w:r></w:p>') }))
  assert.ok(rel.errors.some((e) => /rId9/.test(e.msg)))
  const tbl = (cells) => `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`
  const cell = (inner) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${inner}</w:tc>`
  const badGrid = lib.checkDocx(await zipOf({ ...MIN_DOC, 'word/document.xml': docXml(tbl(cell('<w:p/>'))) }))
  assert.ok(badGrid.errors.some((e) => /열 수/.test(e.msg)))
  const noP = lib.checkDocx(await zipOf({ ...MIN_DOC, 'word/document.xml': docXml(tbl(cell('<w:p/>') + cell(''))) }))
  assert.ok(noP.errors.some((e) => /문단이 없음/.test(e.msg)))
  const badV = lib.checkDocx(await zipOf({ ...MIN_DOC, 'word/document.xml': docXml(tbl(`<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:vMerge/></w:tcPr><w:p/></w:tc>` + cell('<w:p/>'))) }))
  assert.ok(badV.errors.some((e) => /vMerge/.test(e.msg)))
  const notZip = lib.checkDocx(new Uint8Array([1, 2, 3]))
  assert.equal(notZip.ok, false)
})

test('checkDocx: writeDocx 산출물에 오류가 없다(작성기가 있을 때)', { skip: !wd?.writeDocx }, async () => {
  for (const name of FIXTURE_NAMES) {
    const r = lib.checkDocx(await wd.writeDocx(loadFixture(name), { now: 0 }))
    assert.deepEqual(r.errors, [], `${name}: ${JSON.stringify(r.errors.slice(0, 3))}`)
  }
})

// ---------------------------------------------------------------- HWPX 검사
test('checkHwpx: writeHwpx 산출물에 오류가 없고 표 정보가 읽힌다(작성기가 있을 때)', { skip: !wh?.writeHwpx }, async () => {
  for (const name of FIXTURE_NAMES) {
    const r = lib.checkHwpx(await wh.writeHwpx(loadFixture(name), {}))
    assert.deepEqual(r.errors, [], `${name}: ${JSON.stringify(r.errors.slice(0, 3))}`)
    const nTables = []
    walkBlocks(loadFixture(name).body, (b) => { if (b.t === 'table') nTables.push(b) })
    assert.equal(r.info.tables, nTables.length, name)
  }
})

test('checkHwpx: mimetype 순서·압축, 참조 id, 표 격자 오류를 잡는다', async () => {
  const header = (extra = '') => `<hh:head xmlns:hh="h"><hh:refList><hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="x"/></hh:fontface></hh:fontfaces><hh:borderFills itemCnt="1"><hh:borderFill id="0"/></hh:borderFills><hh:charProperties itemCnt="1"><hh:charPr id="0"><hh:fontRef hangul="0"/></hh:charPr></hh:charProperties><hh:paraProperties itemCnt="1"><hh:paraPr id="0"/></hh:paraProperties><hh:styles itemCnt="1"><hh:style id="0" paraPrIDRef="0" charPrIDRef="0"/></hh:styles></hh:refList>${extra}</hh:head>`
  const tc = (c, r, cs, rs) => `<hp:tc borderFillIDRef="0"><hp:subList><hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"/></hp:p></hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/><hp:cellSz width="1000" height="100"/></hp:tc>`
  const sec = (tbl) => `<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">${tbl}</hp:run></hp:p></hs:sec>`
  const files = (secXml, extra = {}) => ({ mimetype: 'application/hwp+zip', 'META-INF/container.xml': '<c/>', 'Contents/content.hpf': '<opf:package xmlns:opf="o"><opf:manifest><opf:item id="header" href="Contents/header.xml"/><opf:item id="section0" href="Contents/section0.xml"/></opf:manifest><opf:spine><opf:itemref idref="header"/><opf:itemref idref="section0"/></opf:spine></opf:package>', 'Contents/header.xml': header(), 'Contents/section0.xml': secXml, ...extra })
  const goodTbl = '<hp:tbl rowCnt="1" colCnt="2"><hp:sz width="2000" height="100"/><hp:tr>' + tc(0, 0, 1, 1) + tc(1, 0, 1, 1) + '</hp:tr></hp:tbl>'
  const good = lib.checkHwpx(await zipOf(files(sec(goodTbl)), ['mimetype']))
  assert.deepEqual(good.errors, [])
  assert.equal(good.info.tableList[0].colPt[0], 10)
  const deflated = lib.checkHwpx(await zipOf(files(sec(goodTbl))))
  assert.ok(deflated.errors.some((e) => /압축/.test(e.msg)))
  const badRef = lib.checkHwpx(await zipOf(files(sec(goodTbl).replace('charPrIDRef="0"', 'charPrIDRef="9"')), ['mimetype']))
  assert.ok(badRef.errors.some((e) => /charPrIDRef="9"/.test(e.msg)))
  const hole = lib.checkHwpx(await zipOf(files(sec('<hp:tbl rowCnt="1" colCnt="2"><hp:sz width="2000" height="100"/><hp:tr>' + tc(0, 0, 1, 1) + '</hp:tr></hp:tbl>')), ['mimetype']))
  assert.ok(hole.errors.some((e) => /구멍/.test(e.msg)))
  const overlap = lib.checkHwpx(await zipOf(files(sec('<hp:tbl rowCnt="1" colCnt="2"><hp:sz width="2000" height="100"/><hp:tr>' + tc(0, 0, 2, 1) + tc(1, 0, 1, 1) + '</hp:tr></hp:tbl>')), ['mimetype']))
  assert.ok(overlap.errors.some((e) => /겹침/.test(e.msg)))
  const rowCnt = lib.checkHwpx(await zipOf(files(sec(goodTbl.replace('rowCnt="1"', 'rowCnt="2"'))), ['mimetype']))
  assert.ok(rowCnt.errors.some((e) => /rowCnt/.test(e.msg)))
  const sentinel = lib.checkHwpx(await zipOf({ ...files(sec(goodTbl)), 'Contents/header.xml': header('<hh:paraHead charPrIDRef="4294967295"/>') }, ['mimetype']))
  assert.deepEqual(sentinel.errors, [])
})

// ---------------------------------------------------------------- SVG 기하, 비교
test('svgPageGeometry: 표 상자와 열 경계를 읽는다(중첩 표는 nested)', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595.28 841.89"><g data-kordoc-id="table-1" data-kordoc-type="table"><line x1="50" y1="100" x2="500" y2="100"/><line x1="50" y1="150" x2="500" y2="150"/><line x1="50" y1="100" x2="50" y2="150"/><line x1="200" y1="100" x2="200" y2="150"/><line x1="500" y1="100" x2="500" y2="150"/><g data-kordoc-id="table-2" data-kordoc-type="table"><line x1="60" y1="110" x2="190" y2="110"/></g></g></svg>`
  const g = lib.svgPageGeometry(svg)
  assert.equal(g.wPt, 595.28)
  assert.equal(g.tables.length, 2)
  const outer = g.tables.find((t) => t.id === 'table-1')
  assert.deepEqual([outer.x0, outer.x1, outer.y0, outer.y1], [50, 500, 100, 150])
  assert.deepEqual(outer.colEdges, [50, 200, 500])
  assert.equal(outer.nested, false)
  assert.equal(g.tables.find((t) => t.id === 'table-2').nested, true)
})

test('compareGeom: 같은 기하는 통과, 어긋남은 항목별로 표시', () => {
  const mk = (x0, x1, y0, y1, page = 0, edges = [50, 300, 545]) => ({ source: 's', pageCount: 1, pageWPt: 595, pageHPt: 842, tables: [{ index: 0, x0, x1, frags: [{ page, y0, y1 }], colEdges: edges }] })
  const a = mk(50, 545, 100, 300)
  assert.equal(lib.compareGeom(a, mk(50, 545, 100, 300)).pass, true)
  const c = lib.compareGeom(a, mk(60, 545, 130, 360, 0, [50, 330, 545]))
  assert.equal(c.pass, false)
  assert.deepEqual(c.tables[0].flags.sort(), ['가로 위치/폭', '세로 위치', '열 경계', '표 높이'].sort())
  assert.ok(Math.abs(c.tables[0].dx0 - -10 / 595) < 1e-3)
  const d = lib.compareGeom({ ...a, pageCount: 2 }, mk(50, 545, 100, 300))
  assert.deepEqual(d.pageCount, [2, 1]); assert.equal(d.pass, false)
  assert.equal(lib.compareGeom(a, { ...a, tables: [] }).pass, false)
})

test('normDocxGeom / normSvgGeom: 공통 형식으로 바꾼다', () => {
  const d = lib.normDocxGeom({ pageCount: 2, sections: [{ wPt: 595.3, hPt: 841.9 }], tables: [{ rows: 2, x0: 50, x1: 500, frags: [{ page: 0, y0: 10, y1: 20 }], colEdges: [-200, 50, 500] }] })
  assert.deepEqual(d.tables[0].colEdges, [50, 500])
  const s = lib.normSvgGeom([{ wPt: 595, hPt: 842, tables: [{ id: 't1', x0: 1, x1: 2, y0: 3, y1: 4, colEdges: [], nested: false }, { id: 'n', nested: true, x0: 0, x1: 0, y0: 0, y1: 0, colEdges: [] }] }, { wPt: 595, hPt: 842, tables: [{ id: 't1', x0: 1, x1: 2, y0: 0, y1: 5, colEdges: [], nested: false }] }])
  assert.equal(s.tables.length, 1); assert.equal(s.tables[0].frags.length, 2); assert.equal(s.pageCount, 2)
  assert.equal(lib.normDocxGeom({ error: 'x' }), null)
})

test('compareSummaries: 표 격자, 병합, 열 폭 ±0.5pt, 글, 쪽 설정', () => {
  const ir = normalizeIR(loadFixture('table-torture')).ir
  const a = summarize(ir)
  assert.equal(lib.compareSummaries(a, summarize(ir)).pass, true)
  const b = JSON.parse(JSON.stringify(a))
  b.tables[0].colPt[0] += 0.4
  assert.equal(lib.compareSummaries(a, b).pass, true, '0.4pt 는 허용')
  b.tables[0].colPt[0] += 0.4
  assert.equal(lib.compareSummaries(a, b).pass, false, '0.8pt 는 위반')
  const c = JSON.parse(JSON.stringify(a)); c.tables[0].merges.pop()
  assert.ok(lib.compareSummaries(a, c).issues.some((i) => /병합/.test(i.msg)))
  const d = JSON.parse(JSON.stringify(a)); d.paragraphs[2] = '다른 글'
  assert.ok(lib.compareSummaries(a, d).issues.some((i) => /paragraphs/.test(i.path)))
  const e = JSON.parse(JSON.stringify(a)); e.page.margin.left += 2
  assert.ok(lib.compareSummaries(a, e).issues.some((i) => /margin\.left/.test(i.path)))
  const f = JSON.parse(JSON.stringify(a)); f.tables.pop()
  assert.ok(lib.compareSummaries(a, f).issues.some((i) => i.path === 'tables'))
  // 공백과 체크 글자 차이는 무시
  const g = { ...a, paragraphs: a.paragraphs.map((p) => p.replace(/ /g, '')) }
  assert.equal(lib.compareSummaries(a, g).pass, true)
})

test('prepForCompare: figure 를 설명 문단으로 펴고 그림 수를 센다', () => {
  const ir = normalizeIR(loadFixture('plan-report')).ir
  const p = lib.prepForCompare(ir)
  assert.equal(p.images, 1)
  assert.ok(!p.ir.body.some((b) => b.t === 'figure'))
  assert.ok(summarize(p.ir).paragraphs.some((t) => t.startsWith('그림 1.')))
  const m = lib.prepForCompare(normalizeIR(loadFixture('mentoring-report')).ir)
  assert.equal(m.images, 1)
})

test('clusterVals', () => {
  assert.deepEqual(lib.clusterVals([10, 10.5, 30, 29.8, 100], 1), [10.3, 29.9, 100])
})

// ---------------------------------------------------------------- run.mjs 도우미
test('parseArgs', () => {
  const a = run.parseArgs(['gian', '--out', '/tmp/x', '--no-hwpx-render'])
  assert.deepEqual(a.names, ['gian']); assert.equal(a.out, '/tmp/x'); assert.equal(a.hwpxRender, false); assert.equal(a.all, false)
  assert.equal(run.parseArgs(['--all']).all, true)
  assert.equal(run.parseArgs(['--corpus', '/tmp/c']).corpus, '/tmp/c')
})

test('docxHeaderRows / docxBreakBefore: 제목 행 수와 쪽 나눔 앞 문단 위치', async () => {
  const tr = (h) => `<w:tr>${h ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc><w:p/></w:tc></w:tr>`
  const body = `<w:p/><w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>${tr(true)}${tr(true)}${tr(false)}</w:tbl>`
  const bytes = await zipOf({ ...MIN_DOC, 'word/document.xml': docXml(body) })
  assert.deepEqual(run.docxHeaderRows(bytes), [2])
  assert.deepEqual(run.docxBreakBefore(bytes), [1])
  assert.deepEqual(run.docxHeaderRows(new Uint8Array([1])), [])
})

test('contentSha: 날짜 같은 메타만 다르면 같은 해시', async () => {
  const a = await zipOf({ ...MIN_DOC, 'word/document.xml': docXml('<w:p/>'), 'docProps/core.xml': '<a>1</a>' })
  const b = await zipOf({ ...MIN_DOC, 'word/document.xml': docXml('<w:p/>'), 'docProps/core.xml': '<a>2</a>' })
  const c = await zipOf({ ...MIN_DOC, 'word/document.xml': docXml('<w:p><w:r/></w:p>'), 'docProps/core.xml': '<a>1</a>' })
  assert.equal(run.contentSha(a), run.contentSha(b))
  assert.notEqual(run.contentSha(a), run.contentSha(c))
})

test('renderReportHtml: 표와 상태 배지를 만든다', () => {
  const html = report.renderReportHtml({ generatedAt: 'x', tools: {}, items: [{ id: 'gian', label: 'L', checks: { 'write.docx': { status: 'pass', note: 'ok' }, 'cross.pages': { status: 'fail', note: 'n', details: ['쪽 1 vs 2'] } }, variants: { docx: { pages: ['a.png'], pageCount: 1 } }, comparisons: [{ name: 'A vs B', pageCount: [1, 2], tableCount: [1, 1], pass: false, issues: [], tables: [{ index: 0, startPage: [1, 1], endPage: [1, 2], x0Frac: [0, 0], x1Frac: [1, 1], dx0: 0, dx1: 0, dy0: 0, heightPt: [1, 2], heightDiffPct: 5, colEdges: [2, 2], edgeMax: 0.01, flags: ['표 높이'] }] }] }] })
  assert.match(html, /PASS/); assert.match(html, /FAIL/); assert.match(html, /a\.png/); assert.match(html, /쪽 1 vs 2/); assert.match(html, /표 높이/)
})

// ---------------------------------------------------------------- 키트
test('키트: 문서 6종 x 2형식, README 에 점검표와 결과표, 5MB 미만', async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'kit-'))
  const r = await kit.makeKit(tmp)
  const files = fs.readdirSync(tmp)
  assert.ok(files.includes('README.md') && files.includes('how-to-report.md'))
  if (wd?.writeDocx && wh?.writeHwpx) {
    assert.equal(r.problems.length, 0, r.problems.join(';'))
    assert.ok(files.includes('01-멘토링보고서.docx') && files.includes('01-멘토링보고서.hwpx'))
    assert.equal(files.filter((f) => /\.(docx|hwpx)$/.test(f)).length, 12)
  }
  assert.ok(r.totalBytes < 5 * 1024 * 1024)
  const readme = fs.readFileSync(path.join(tmp, 'README.md'), 'utf8')
  for (const w of ['복구', '쪽 수', '병합', '음영', '로고', '줄 간격', '글꼴', '체크박스', '쪽 번호', '인쇄 미리보기', '결과 적는 표', 'Word', '한글']) assert.ok(readme.includes(w), w)
  assert.match(fs.readFileSync(path.join(tmp, 'how-to-report.md'), 'utf8'), /캡처/)
  fs.rmSync(tmp, { recursive: true, force: true })
})
