// 한글(HWPX) 작성기/읽기 시험.  실행: cd client && node --test src/lib/docIR/__tests__/hwpx.test.mjs
// kordoc 검증/렌더 시험은 KORDOC_PATH(kordoc 패키지 폴더) 또는 설치된 kordoc 이 있을 때만 돈다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { writeHwpx } from '../writeHwpx.js'
import { readHwpx, parseXml } from '../readHwpx.js'
import { summarize, normalizeIR } from '../schema.js'
import { checkHwpx } from './hwpx.check.mjs'
import { mentoringReportIR, simpleIR, makePng } from './hwpx.fixtures.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const kids = (n, name) => n.c.filter((x) => typeof x !== 'string' && (!name || x.n === name))
const find = (n, name, out = []) => {
  if (!n || typeof n === 'string') return out
  if (n.n === name) out.push(n)
  n.c.forEach((c) => find(c, name, out))
  return out
}
async function unzipXml(bytes, name) {
  const z = await JSZip.loadAsync(bytes)
  return parseXml(await z.file(name).async('string'))
}
async function loadKordoc() {
  try {
    const p = process.env.KORDOC_PATH
    if (p) return await import(pathToFileURL(/\.(c|m)?js$/.test(p) ? p : path.join(p, 'dist', 'index.js')).href)
    return await import('kordoc')
  } catch {
    return null
  }
}

test('패키지 골격: mimetype 이 첫 엔트리이고 압축하지 않는다', async () => {
  const out = await writeHwpx(simpleIR())
  assert.equal(String.fromCharCode(...out.slice(30, 38)), 'mimetype')
  assert.equal(out[8] | (out[9] << 8), 0, 'mimetype 은 STORE(0)')
  const z = await JSZip.loadAsync(out)
  for (const n of ['version.xml', 'settings.xml', 'META-INF/container.xml', 'META-INF/manifest.xml', 'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml']) assert.ok(z.file(n), n)
  const r = await checkHwpx(out)
  assert.deepEqual(r.issues, [])
})

test('한림멘토링 보고서 모양: 깊은 검사 통과, 표 병합과 폭이 IR 과 같다', async () => {
  const ir = mentoringReportIR()
  const out = await writeHwpx(ir)
  const r = await checkHwpx(out)
  assert.deepEqual(r.issues, [])
  assert.equal(r.tables, 2)
  const sec = await unzipXml(out, 'Contents/section0.xml')
  const tbls = find(sec, 'tbl')
  assert.equal(tbls.length, 2)
  // 첫 표: 4열 4행, 제목 칸 colSpan=4, 열 폭 85/178/77/159pt -> hwpunit 8500/17800/7700/15900
  const t0 = tbls[0]
  assert.equal(t0.a.colCnt, '4')
  assert.equal(t0.a.rowCnt, '4')
  const row1 = kids(kids(t0, 'tr')[1], 'tc').map((tc) => Number(kids(tc, 'cellSz')[0].a.width))
  assert.deepEqual(row1, [8500, 17800, 7700, 15900])
  const span0 = kids(kids(kids(t0, 'tr')[0], 'tc')[0], 'cellSpan')[0].a
  assert.equal(span0.colSpan, '4')
  // 둘째 표: 세로 병합(rowSpan=2)
  const spans = find(tbls[1], 'cellSpan').map((s) => `${s.a.colSpan}x${s.a.rowSpan}`)
  assert.ok(spans.includes('1x2'))
  // 칸 배경색이 borderFill 로 가고 같은 서식은 한 번만 정의된다
  const head = await unzipXml(out, 'Contents/header.xml')
  const bfs = find(head, 'borderFill')
  const fills = bfs.map((b) => find(b, 'winBrush')[0]?.a.faceColor).filter((c) => c && c !== 'none')
  assert.ok(fills.includes('#C2CAE8') && fills.includes('#E0E4F3'))
  const strip = (n) => (typeof n === 'string' ? n : { n: n.n, a: n.a, c: n.c.map(strip) })
  const sig = bfs.map((b) => JSON.stringify(b.c.map(strip)))
  assert.equal(new Set(sig).size, sig.length, 'borderFill 중복 없음')
})

test('쪽 설정: A4 세로 여백은 머리말 위치로 나뉜다(본문 시작 = top + header)', async () => {
  const ir = mentoringReportIR() // top 28, headerMm 12(머리말 띠 높이), bottom 20, footerMm 12, left 20, right 14
  const out = await writeHwpx(ir)
  const sec = await unzipXml(out, 'Contents/section0.xml')
  const pp = find(sec, 'pagePr')[0]
  assert.equal(pp.a.landscape, 'WIDELY')
  assert.equal(pp.a.width, '59528')
  assert.equal(pp.a.height, '84186')
  const m = find(pp, 'margin')[0].a
  const mm = (h) => (Number(h) * 25.4) / 7200
  assert.ok(Math.abs(mm(m.header) - 12) < 0.05, '머리말 띠 높이 = headerMm')
  assert.ok(Math.abs(mm(m.top) + mm(m.header) - 28) < 0.05, '본문 시작이 IR 위 여백과 같다')
  assert.ok(Math.abs(mm(m.bottom) + mm(m.footer) - 20) < 0.05)
  assert.ok(Math.abs(mm(m.left) - 20) < 0.05 && Math.abs(mm(m.right) - 14) < 0.05)
  // 가로 용지는 width/height 를 그대로 두고 landscape=NARROWLY (한컴 저장본 방식)
  const land = await writeHwpx({ ...simpleIR(), page: { size: 'A4', orientation: 'landscape', marginMm: { top: 20, right: 20, bottom: 20, left: 20 } } })
  const pl = find(await unzipXml(land, 'Contents/section0.xml'), 'pagePr')[0]
  assert.equal(pl.a.landscape, 'NARROWLY')
  assert.equal(pl.a.width, '59528')
  assert.equal(pl.a.height, '84186')
  const back = await readHwpx(land)
  assert.equal(back.page.orientation, 'landscape')
  assert.equal(back.page.size, 'A4')
})

test('문단 서식: 내어쓰기와 줄 간격은 hp:switch 의 두 단위(hwpunit, 2배)로 적는다', async () => {
  const ir = simpleIR()
  ir.body = [{ t: 'p', runs: [{ text: '가 항목' }], indent: { leftPt: 20, rightPt: 0, firstLinePt: -10 }, lineSpacing: { mode: 'exactPt', value: 18 }, align: 'justify' }]
  const out = await writeHwpx(ir)
  const head = await unzipXml(out, 'Contents/header.xml')
  const pp = find(head, 'paraPr').find((p) => find(p, 'align')[0].a.horizontal === 'JUSTIFY' && find(p, 'case').length)
  const cs = find(pp, 'case')[0]
  const df = find(pp, 'default')[0]
  const v = (n, t) => Number(find(n, t)[0].a.value)
  assert.equal(v(cs, 'left'), 2000)
  assert.equal(v(cs, 'intent'), -1000)
  assert.equal(v(df, 'left'), 4000)
  assert.equal(v(df, 'intent'), -2000)
  assert.equal(find(cs, 'lineSpacing')[0].a.type, 'FIXED')
  assert.equal(find(cs, 'lineSpacing')[0].a.value, '1800')
  assert.equal(find(df, 'lineSpacing')[0].a.value, '3600')
  const back = await readHwpx(out)
  assert.deepEqual(back.body[0].indent, { leftPt: 20, rightPt: 0, firstLinePt: -10 })
  assert.deepEqual(back.body[0].lineSpacing, { mode: 'exactPt', value: 18 })
})

test('글자 서식: 굵게·기울임·밑줄·장평·자간·형광펜·체크박스·쪽 번호·하이퍼링크·떠 있는 그림', async () => {
  const ir = mentoringReportIR()
  ir.body.push({ t: 'p', runs: [{ text: '장평', scalePct: 90, spacingPct: -5, bold: true, italic: true, underline: 'double', strike: true, color: '#C00000' }] })
  const out = await writeHwpx(ir)
  const sec = await unzipXml(out, 'Contents/section0.xml')
  assert.ok(find(sec, 'markpenBegin').some((m) => m.a.color === '#FFFF00'), '형광펜')
  assert.ok(find(sec, 'autoNum').some((a) => a.a.numType === 'PAGE'), '쪽 번호')
  assert.ok(find(sec, 'autoNum').some((a) => a.a.numType === 'TOTAL_PAGE'), '전체 쪽수')
  const fb = find(sec, 'fieldBegin')[0]
  assert.equal(fb.a.type, 'HYPERLINK')
  assert.ok(find(fb, 'stringParam').some((p) => p.a.name === 'Path' && p.c.join('') === 'https://www.hallym.ac.kr'))
  const pic = find(sec, 'pic')[0]
  const pos = find(pic, 'pos')[0].a
  assert.equal(pos.treatAsChar, '0')
  assert.equal(pos.horzAlign, 'RIGHT')
  assert.equal(pos.vertRelTo, 'PAPER')
  assert.equal(pic.a.textWrap, 'IN_FRONT_OF_TEXT')
  const head = await unzipXml(out, 'Contents/header.xml')
  const cp = find(head, 'charPr').find((c) => find(c, 'ratio')[0].a.hangul === '90')
  assert.ok(cp && find(cp, 'spacing')[0].a.hangul === '-5')
  assert.ok(find(cp, 'bold').length && find(cp, 'italic').length)
  assert.equal(find(cp, 'underline')[0].a.shape, 'DOUBLE')
  assert.equal(find(cp, 'strikeout')[0].a.shape, 'SOLID')
  // 체크 글자는 지정한 글꼴(기본 맑은 고딕)의 charPr 를 쓴다
  const fonts = find(head, 'fontface').find((f) => f.a.lang === 'SYMBOL')
  assert.ok(find(fonts, 'font').some((f) => f.a.face === '맑은 고딕'))
  const r = await checkHwpx(out)
  assert.deepEqual(r.issues, [])
})

test('왕복: IR -> writeHwpx -> readHwpx 가 요약(표 격자·병합·폭·배경·글·쪽)을 지킨다', async () => {
  const ir = mentoringReportIR()
  const before = summarize(normalizeIR(ir).ir)
  const out = await writeHwpx(ir)
  const back = await readHwpx(out)
  const after = summarize(back)
  assert.equal(after.tables.length, before.tables.length)
  after.tables.forEach((t, i) => {
    const b = before.tables[i]
    assert.equal(t.cols, b.cols)
    assert.equal(t.rows, b.rows)
    assert.ok(Math.abs(t.widthPt - b.widthPt) <= 0.5, `폭 ${t.widthPt} vs ${b.widthPt}`)
    t.colPt.forEach((w, k) => assert.ok(Math.abs(w - b.colPt[k]) <= 0.5, `열 ${k}: ${w} vs ${b.colPt[k]}`))
    assert.deepEqual(t.merges, b.merges)
    assert.deepEqual(t.bgs.map((x) => x.toUpperCase()), b.bgs.map((x) => x.toUpperCase()))
    assert.equal(t.error, undefined)
  })
  assert.deepEqual(after.paragraphs, before.paragraphs)
  for (const k of ['top', 'right', 'bottom', 'left']) assert.ok(Math.abs(after.page.margin[k] - before.page.margin[k]) <= 0.1, `여백 ${k}`)
  assert.equal(after.figures, before.figures + 0, '그림 수')
  assert.equal(back.page.headerMm, 12, '머리말 띠 높이')
  assert.equal(back.page.marginMm.top, 28)
  assert.ok(back.footer?.length, '꼬리말')
  assert.ok(Object.keys(back.assets).length === 1)
  const row = back.body.find((b) => b.t === 'table').rows[1]
  assert.equal(row.cells[0].bg, '#E0E4F3')
  // 체크박스는 check 런으로, 형광펜은 highlight 로 돌아온다
  const flat = JSON.stringify(back.body)
  assert.ok(flat.includes('"check":{"checked":true}'))
  assert.ok(flat.includes('"highlight":"#FFFF00"'))
})

test('쪽 나눔은 다음 문단의 pageBreak 로 쓰고 읽을 때 다시 쪽 나눔 블록이 된다', async () => {
  const out = await writeHwpx(simpleIR())
  const sec = await unzipXml(out, 'Contents/section0.xml')
  const ps = find(sec, 'p')
  assert.ok(ps.some((p) => p.a.pageBreak === '1'))
  const back = await readHwpx(out)
  assert.deepEqual(back.body.map((b) => b.t), ['p', 'p', 'pagebreak', 'p'])
})

test('특수 글자: XML 예약 문자는 이스케이프하고 제어 문자는 뺀다, 줄바꿈과 탭은 요소로 쓴다', async () => {
  const ir = simpleIR()
  ir.body = [{ t: 'p', runs: [{ text: 'A & B < C > "D" \u0007\u0000 끝' }, { br: true }, { text: '둘째', }, { tab: true }, { text: '탭 뒤' }] }]
  const out = await writeHwpx(ir)
  const z = await JSZip.loadAsync(out)
  const xml = await z.file('Contents/section0.xml').async('string')
  assert.ok(xml.includes('A &amp; B &lt; C &gt; &quot;D&quot;'))
  assert.ok(!/[\u0000-\u0008]/.test(xml))
  assert.ok(xml.includes('<hp:lineBreak/>') && xml.includes('<hp:tab '))
  const back = await readHwpx(out)
  const runs = back.body[0].runs
  assert.equal(runs[0].text.startsWith('A & B < C > "D"'), true)
  assert.ok(runs.some((r) => r.br))
  assert.ok(runs.some((r) => r.tab))
})

test('표 선: 칸 사이 겹치는 선은 굵은 쪽으로 맞추고 대각선은 slash 로 쓴다', async () => {
  const ir = simpleIR()
  const thick = { style: 'solid', widthPt: 2, color: '#FF0000' }
  ir.body = [
    {
      t: 'table', widthPt: 200, colPt: [100, 100], border: { style: 'solid', widthPt: 0.5, color: '#000000' },
      rows: [{ cells: [{ blocks: [{ t: 'p', runs: [{ text: 'a' }] }], border: { right: thick, diagDown: { style: 'solid', widthPt: 0.5, color: '#000000' } } }, { blocks: [{ t: 'p', runs: [{ text: 'b' }] }] }] }],
    },
  ]
  const out = await writeHwpx(ir)
  const head = await unzipXml(out, 'Contents/header.xml')
  const sec = await unzipXml(out, 'Contents/section0.xml')
  const tcs = find(sec, 'tc')
  const bfOf = (tc) => find(head, 'borderFill').find((b) => b.a.id === tc.a.borderFillIDRef)
  const rightOfA = find(bfOf(tcs[0]), 'rightBorder')[0].a
  const leftOfB = find(bfOf(tcs[1]), 'leftBorder')[0].a
  assert.equal(rightOfA.color, '#FF0000')
  assert.equal(leftOfB.color, '#FF0000', '이웃 칸의 왼쪽 선도 같은 선')
  assert.equal(find(bfOf(tcs[0]), 'backSlash')[0].a.type, 'CENTER')
  const back = await readHwpx(out)
  const cell = back.body.find((b) => b.t === 'table').rows[0].cells[0]
  assert.ok(cell.border.diagDown)
})

test('그림: BinData 와 매니페스트, 원본 크기(orgSz)와 표시 크기(curSz)', async () => {
  const ir = simpleIR()
  ir.assets = { a: { mime: 'image/png', data: makePng(40, 20), w: 40, h: 20 } }
  ir.body = [{ t: 'figure', id: 'a', wPt: 100, hPt: 50, align: 'center' }, { t: 'p', runs: [{ text: '글 ' }, { image: { id: 'a', wPt: 20, hPt: 10 } }] }]
  const out = await writeHwpx(ir)
  const z = await JSZip.loadAsync(out)
  assert.ok(z.file('BinData/image1.png'))
  const hpf = await z.file('Contents/content.hpf').async('string')
  assert.ok(hpf.includes('<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>'))
  const sec = parseXml(await z.file('Contents/section0.xml').async('string'))
  const pics = find(sec, 'pic')
  assert.equal(pics.length, 2)
  assert.deepEqual([find(pics[0], 'curSz')[0].a.width, find(pics[0], 'curSz')[0].a.height], ['10000', '5000'])
  assert.equal(find(pics[0], 'orgSz')[0].a.width, '3000')
  const back = await readHwpx(out)
  assert.equal(back.body[0].t, 'figure')
  assert.equal(back.body[0].wPt, 100)
  assert.equal(back.body[1].runs.some((r) => r.image), true)
  assert.deepEqual([...back.assets.img1.data.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47])
})

test('머리말과 꼬리말: 위·아래 여백 안쪽에 들어가고 텍스트 폭이 본문 폭이다', async () => {
  const ir = simpleIR()
  ir.header = [{ t: 'p', runs: [{ text: '머리말 글' }], align: 'right' }]
  ir.footer = [{ t: 'p', runs: [{ field: 'page' }], align: 'center' }]
  const out = await writeHwpx(ir)
  const sec = await unzipXml(out, 'Contents/section0.xml')
  const hd = find(sec, 'header')[0]
  const ft = find(sec, 'footer')[0]
  assert.equal(hd.a.applyPageType, 'BOTH')
  const sl = find(hd, 'subList')[0].a
  assert.equal(sl.textWidth, String(59528 - 2 * 5669))
  assert.ok(Number(sl.textHeight) > 0)
  assert.ok(find(ft, 'autoNum').length)
  const back = await readHwpx(out)
  assert.equal(back.header[0].runs[0].text, '머리말 글')
  assert.deepEqual(back.footer[0].runs, [{ field: 'page' }])
})

test('쪽 번호 컨트롤(hp:pageNum)은 꼬리말 쪽 번호 문단으로 읽는다', async () => {
  const out = await writeHwpx(simpleIR())
  const z = await JSZip.loadAsync(out)
  let xml = await z.file('Contents/section0.xml').async('string')
  xml = xml.replace('</hp:run>', '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl></hp:run>')
  z.file('Contents/section0.xml', xml)
  const back = await readHwpx(await z.generateAsync({ type: 'uint8array' }))
  assert.equal(back.footer.length, 1)
  assert.deepEqual(back.footer[0].runs.map((r) => r.text ?? r.field), ['- ', 'page', ' -'])
})

test('한글 줄 나눔 설정: 글자 단위는 x.breakByChar, 어절 단위는 힌트 없음, 영문 자동 간격은 x.hwp 로 보존된다', async () => {
  const ir = simpleIR()
  ir.body = [
    { t: 'p', runs: [{ text: '글자 단위' }], x: { breakByChar: true, hwp: { autoEng: 1, condense: 20 } } },
    { t: 'p', runs: [{ text: '어절 단위' }], align: 'right' },
  ]
  const out = await writeHwpx(ir)
  const head = await (await JSZip.loadAsync(out)).file('Contents/header.xml').async('string')
  assert.ok(head.includes('breakNonLatinWord="KEEP_WORD"'), '글자 단위')
  assert.ok(head.includes('breakNonLatinWord="BREAK_WORD"'), '어절 단위(워드 기본과 같게)')
  assert.ok(head.includes('eAsianEng="1"') && head.includes('condense="20"'))
  const back = await readHwpx(out)
  assert.equal(back.body[0].x.breakByChar, true)
  assert.deepEqual(back.body[0].x.hwp, { autoEng: 1, condense: 20 })
  assert.equal(back.body[1].x, undefined)
  // 한 번 더 써도 같다
  const again = await readHwpx(await writeHwpx(back))
  assert.equal(again.body[0].x.breakByChar, true)
  assert.equal(again.body[1].x, undefined)
})

test('한컴 저장본 읽기: 병합 표, 내어쓰기, 쪽 설정, 그림, 번호 매기기 (저장소의 템플릿 hwpx 와 환경변수 HWPX_REAL_DIR 의 파일)', async () => {
  const dirs = [path.resolve(here, '../../../../public/templates')]
  if (process.env.HWPX_REAL_DIR) dirs.push(process.env.HWPX_REAL_DIR)
  const files = dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.hwpx')).map((f) => path.join(d, f)) : [])).slice(0, 40)
  assert.ok(files.length > 0, '시험할 hwpx 가 있어야 한다')
  for (const f of files) {
    const bytes = new Uint8Array(fs.readFileSync(f))
    const ir = await readHwpx(bytes)
    const s0 = summarize(ir)
    assert.ok(s0.tables.every((t) => !t.error), `${f}: 표 격자 오류`)
    const out = await writeHwpx(ir)
    const chk = await checkHwpx(out)
    assert.deepEqual(chk.issues, [], `${f}: 깊은 검사`)
    const s1 = summarize(await readHwpx(out))
    assert.deepEqual(s1.tables.map((t) => [t.cols, t.rows, t.merges]), s0.tables.map((t) => [t.cols, t.rows, t.merges]), `${f}: 표 모양`)
    s1.tables.forEach((t, i) => t.colPt.forEach((w, k) => assert.ok(Math.abs(w - s0.tables[i].colPt[k]) <= 0.5, `${f}: 열 폭`)))
    assert.deepEqual(s1.paragraphs, s0.paragraphs, `${f}: 글`)
  }
})

test('kordoc 검증과 렌더(설치되어 있을 때): 구조 검증 통과, 쪽 수와 표 수가 IR 과 같다', async (t) => {
  const k = await loadKordoc()
  if (!k) return t.skip('kordoc 없음(KORDOC_PATH 로 지정)')
  const ir = mentoringReportIR()
  const out = await writeHwpx(ir)
  const v = await k.validateHwpx(out)
  assert.equal(v.ok, true, JSON.stringify(v.issues))
  const r = await k.renderHwpxToSvg(out, { reflow: true })
  assert.equal(r.pageCount, 1)
  assert.equal(r.stats.tables, 2)
  assert.equal(r.stats.images, 1)
  // 두 번째 읽기 경로: kordoc parse 가 같은 표 수와 글을 얻는다
  const p = await k.parse(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength))
  assert.equal(p.success, true)
  assert.ok(p.markdown.includes('온새마루 1기'))
  assert.equal(p.blocks.filter((b) => b.type === 'table').length, 2)
})
