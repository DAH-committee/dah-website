// node --test client/src/lib/docIR/__tests__/tiptap.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tiptapToIR, normPage } from '../tiptapToIR.js'
import { irToTiptap } from '../irToTiptap.js'
import { tableGrid, summarize, walkBlocks, normalizeIR } from '../schema.js'

const txt = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...c) => ({ type: 'paragraph', content: c })
const cell = (content, attrs = {}) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content })
const row = (cells, attrs) => ({ type: 'tableRow', ...(attrs ? { attrs } : {}), content: cells })

// 보고서 꼴 표: 첫 행 4칸 병합 + 색, 라벨/값 칸, 가로 병합, 세로 병합
const HEAD_BG = '#C0C9E8'
const LABEL_BG = '#E0E6F5'
const reportDoc = () => ({
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [txt('2026-2학기 한림멘토링 (2)주차 활동 보고서', [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '15pt', fontFamily: "'HY헤드라인M'" } }])] },
    {
      type: 'table',
      attrs: { align: null, width: null, borderStyle: { style: 'solid', width: 0.75, color: '#000000' } },
      content: [
        row([cell([p({ type: 'checkbox', attrs: { checked: false } }, txt(' 멘토링 그룹 정보'))], { colspan: 4, colwidth: [100, 200, 100, 200], background: HEAD_BG })], { height: 40 }),
        row([
          cell([p(txt('학과(전공)'))], { colwidth: [100], background: LABEL_BG, verticalAlign: 'middle' }),
          cell([p(txt('디지털인문예술전공'))], { colwidth: [200] }),
          cell([p(txt('교과목명'))], { colwidth: [100], background: LABEL_BG }),
          cell([p(txt('서비스디자인'))], { colwidth: [200] }),
        ]),
        row([
          cell([p(txt('그룹명'))], { colwidth: [100], background: LABEL_BG }),
          cell([p(txt('온새마루 1기'))], { colspan: 3, colwidth: [200, 100, 200] }),
        ]),
        row([
          cell([p(txt('활동 목표'))], { colwidth: [100], rowspan: 2, background: LABEL_BG, verticalAlign: 'middle' }),
          cell([{ type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('멘티 3명이 AI 개발 도구를 설치한다.'))] }, { type: 'listItem', content: [p(txt('3주차 작업 요청을 시작한다.'))] }] }], { colspan: 3, colwidth: [200, 100, 200], borders: { bottom: { style: 'double', width: 1.5, color: '#FF1744' } } }),
        ]),
        row([cell([p(txt('3명 중 3명', [{ type: 'highlight', attrs: { color: '#FFEA00' } }]))], { colspan: 3, colwidth: [200, 100, 200] })]),
      ],
    },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(txt('온라인(ZOOM)'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(txt('오프라인'))] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p(txt('첫째'))] }, { type: 'listItem', content: [p(txt('둘째'))] }] },
  ],
})

test('병합·음영 표가 IR 표 격자로 변환된다', () => {
  const { ir } = tiptapToIR(reportDoc(), { title: 't' })
  const table = ir.body.find((b) => b.t === 'table')
  assert.ok(table)
  const g = tableGrid(table)
  assert.equal(g.error, undefined)
  assert.equal(g.nCols, 4)
  assert.equal(g.nRows, 5)
  assert.deepEqual(table.colPt.map((x) => Math.round(x)), [75, 150, 75, 150])
  assert.equal(Math.round(table.colPt.reduce((a, b) => a + b, 0)), Math.round(table.widthPt))
  assert.equal(table.rows[0].cells[0].colspan, 4)
  assert.equal(table.rows[0].cells[0].bg, HEAD_BG)
  assert.equal(table.rows[0].heightPt, 30)
  assert.equal(table.rows[3].cells[0].rowspan, 2)
  assert.equal(table.rows[3].cells[0].vAlign, 'middle')
  assert.equal(table.rows[3].cells[1].border.bottom.style, 'double')
  assert.equal(table.rows[4].cells.length, 1) // 세로 병합으로 가려진 칸은 넣지 않는다
  // 체크 Run
  assert.equal(table.rows[0].cells[0].blocks[0].runs[0].check.checked, false)
})

test('목록은 글자 부호와 작업 목록 check 로 바뀐다', () => {
  const { ir } = tiptapToIR(reportDoc(), {})
  const ps = []
  walkBlocks(ir.body, (b) => b.t === 'p' && ps.push(b))
  const bullet = ps.find((x) => x.list?.kind === 'bullet')
  assert.equal(bullet.list.marker, '•')
  assert.ok(bullet.indent.firstLinePt < 0)
  const task = ps.filter((x) => x.list?.kind === 'check')
  assert.equal(task.length, 2)
  assert.equal(task[0].runs[0].check.checked, true)
  const ord = ps.filter((x) => x.list?.kind === 'ordered')
  assert.deepEqual(ord.map((x) => x.list.marker), ['1.', '2.'])
})

test('열 폭이 없는 기존 문서 표는 본문 폭을 나눠 가진다', () => {
  const json = { type: 'doc', content: [{ type: 'table', content: [row([cell([p(txt('가'))]), cell([p(txt('나'))]), cell([p(txt('다'))])])] }] }
  const { ir } = tiptapToIR(json, {})
  const t = ir.body[0]
  assert.equal(t.colPt.length, 3)
  assert.ok(Math.abs(t.colPt[0] - t.colPt[1]) < 0.01)
  assert.equal(tableGrid(t).error, undefined)
})

test('본문보다 넓은 표는 줄이고 알린다', () => {
  const json = { type: 'doc', content: [{ type: 'table', content: [row([cell([p(txt('가'))], { colwidth: [900] })])] }] }
  const { ir, issues } = tiptapToIR(json, {})
  assert.ok(issues.some((i) => /표 폭이 본문보다/.test(i.msg)))
  assert.ok(ir.body[0].widthPt <= 595.28 - 2 * 23 * 2.8346 + 1)
})

test('표 칸이 모자라면 채워서 격자가 맞는다', () => {
  const json = { type: 'doc', content: [{ type: 'table', content: [row([cell([p(txt('가'))], { colwidth: [100] }), cell([p(txt('나'))], { colwidth: [100] })]), row([cell([p(txt('다'))], { colwidth: [100] })])] }] }
  const { ir } = tiptapToIR(json, {})
  assert.equal(tableGrid(ir.body[0]).error, undefined)
})

test('왕복: Tiptap -> IR -> Tiptap -> IR 이 같다', () => {
  const a = tiptapToIR(reportDoc(), { title: 't' }).ir
  const back = irToTiptap(a)
  const b = tiptapToIR(back, { title: 't', page: back.page }).ir
  assert.deepEqual(summarize(b), summarize(a))
  assert.deepEqual(JSON.parse(JSON.stringify(b.body)), JSON.parse(JSON.stringify(a.body)))
})

test('왕복 결과의 표 속성이 편집기 속성으로 남는다', () => {
  const a = tiptapToIR(reportDoc(), {}).ir
  const back = irToTiptap(a)
  const t = back.content.find((n) => n.type === 'table')
  const c0 = t.content[0].content[0]
  assert.equal(c0.attrs.colspan, 4)
  assert.equal(c0.attrs.background, HEAD_BG)
  assert.deepEqual(c0.attrs.colwidth, [100, 200, 100, 200])
  assert.equal(t.content[0].attrs.height, 40)
  assert.equal(t.content[3].content[0].attrs.rowspan, 2)
  const lists = back.content.filter((n) => /List$/.test(n.type)).map((n) => n.type)
  assert.deepEqual(lists, ['taskList', 'orderedList'])
})

test('쪽 설정: 용지·여백·쪽 번호가 IR 과 왕복한다', () => {
  const page = { size: 'B5', orientation: 'landscape', marginMm: { top: 15, right: 12, bottom: 18, left: 12 }, headerMm: 8, footerMm: 9, pageNumbers: { on: true, pos: 'right' }, header: { text: '머리말', align: 'right', image: null }, footer: { text: '', align: 'center', image: null } }
  const { ir } = tiptapToIR({ type: 'doc', content: [p(txt('x'))] }, { page })
  assert.equal(ir.page.size, 'B5')
  assert.equal(ir.page.orientation, 'landscape')
  assert.deepEqual(ir.page.marginMm, { top: 15, right: 12, bottom: 18, left: 12 })
  assert.equal(ir.footer[0].runs[0].field, 'page')
  assert.equal(ir.footer[0].align, 'right')
  assert.equal(ir.header[0].runs[0].text, '머리말')
  const back = irToTiptap(ir)
  assert.deepEqual(back.page.marginMm, page.marginMm)
  assert.equal(back.page.pageNumbers.on, true)
  assert.equal(back.page.pageNumbers.pos, 'right')
  assert.equal(back.page.header.text, '머리말')
  assert.equal(back.page.header.align, 'right')
  assert.deepEqual(normPage(back.page), back.page)
})

test('마크: 글꼴·크기·색·형광펜·장평·자간·링크·위아래첨자', () => {
  const json = { type: 'doc', content: [p(txt('가', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'link', attrs: { href: 'https://a.b' } }, { type: 'textStyle', attrs: { color: '#FF1744', fontSize: '14pt', fontFamily: "'Nanum Gothic'", ratio: 90, spacing: -5 } }]), txt('2', [{ type: 'superscript' }, { type: 'comment', attrs: { id: 'x' } }]))] }
  const r = tiptapToIR(json, {}).ir.body[0].runs
  assert.equal(r[0].bold, true)
  assert.equal(r[0].link, 'https://a.b')
  assert.equal(r[0].color, '#FF1744')
  assert.equal(r[0].sizePt, 14)
  assert.deepEqual(r[0].font, { ko: 'Nanum Gothic', latin: 'Nanum Gothic' })
  assert.equal(r[0].scalePct, 90)
  assert.equal(r[0].spacingPct, -5)
  assert.equal(r[1].sup, true)
  assert.equal(r[1].bold, undefined) // 댓글 표시는 버린다
})

test('자료값 칸은 현재 값 글로, 비밀값은 표시 글로', () => {
  const json = { type: 'doc', content: [p(txt('예산 '), { type: 'hwpVar', attrs: { key: 'a' } }, { type: 'secret', attrs: { id: 1, label: '비번' } })] }
  const { ir } = tiptapToIR(json, { chipText: () => '1,000원' })
  const t = ir.body[0].runs.map((x) => x.text).join('')
  assert.equal(t, '예산 1,000원[비밀값: 비번]')
})

test('이미지: 크기·정렬·떠 있는 로고', () => {
  const assets = { '/u/a.png': { mime: 'image/png', data: new Uint8Array([1, 2, 3]), w: 400, h: 100 } }
  const json = { type: 'doc', content: [{ type: 'image', attrs: { src: '/u/a.png', width: 200, align: 'right', wrap: 'right' } }, { type: 'image', attrs: { src: '/u/missing.png' } }] }
  const { ir, issues } = tiptapToIR(json, { assets })
  assert.equal(ir.body[0].t, 'figure')
  assert.equal(ir.body[0].wPt, 150)
  assert.equal(ir.body[0].hPt, 37.5)
  assert.deepEqual(ir.body[0].float, { x: 'right', y: 'top', wrap: 'square' })
  assert.ok(issues.some((i) => /그림/.test(i.msg)))
  const back = irToTiptap(ir, { assetSrc: { img1: '/u/a.png' } })
  assert.equal(back.content[0].attrs.wrap, 'right')
  assert.equal(back.content[0].attrs.width, 200)
})

test('한글 모드 기안문: 공문 항목 부호가 글자로 들어간다', () => {
  const metrics = JSON.parse(readFileSync(new URL('../../../pages/hwp/hwpMetrics.json', import.meta.url), 'utf8')).presets['기안문']
  const preset = { key: '기안문', standard: true, metrics }
  const json = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [txt('관련')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('항목 하나'))] }, { type: 'listItem', content: [p(txt('항목 둘')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('세부'))] }] }] }] },
    ],
  }
  const { ir } = tiptapToIR(json, { hwp: { mode: 'hwp', preset: '기안문', head: { org: '기관', to: '수신처', title: '제목' }, foot: {}, vars: {} }, preset })
  const marks = []
  walkBlocks(ir.body, (b) => b.t === 'p' && b.list?.marker && marks.push(b.list.marker))
  assert.deepEqual(marks, ['1.', '가.', '나.', '1)'])
  assert.equal(ir.body[0].runs[0].text, '기관')
  assert.equal(ir.body[ir.body.length - 1].runs.length > 0, true)
  assert.equal(ir.defaults.font.ko, metrics.body.font)
})

test('한글 모드 보고서: 장 제목 Ⅰ, 절 제목 □, 목록 ㅇ -', () => {
  const metrics = JSON.parse(readFileSync(new URL('../../../pages/hwp/hwpMetrics.json', import.meta.url), 'utf8')).presets['보고서']
  const preset = { key: '보고서', standard: false, metrics }
  const json = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [txt('개요')] },
      { type: 'heading', attrs: { level: 3 }, content: [txt('배경')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('내용')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(txt('세부'))] }] }] }] },
    ],
  }
  const { ir } = tiptapToIR(json, { hwp: { mode: 'hwp', preset: '보고서', vars: {} }, preset })
  const marks = []
  walkBlocks(ir.body, (b) => b.t === 'p' && b.list?.marker && marks.push(b.list.marker))
  assert.deepEqual(marks, ['Ⅰ', '□', 'ㅇ', '-'])
})

test('쪽 나눔과 구분선', () => {
  const json = { type: 'doc', content: [p(txt('a')), { type: 'pageBreak' }, { type: 'horizontalRule' }, p(txt('b'))] }
  const { ir } = tiptapToIR(json, {})
  assert.equal(ir.body[1].t, 'pagebreak')
  assert.equal(ir.body[2].t, 'table') // 일반 모드의 구분선은 아래 선만 있는 표
  assert.equal(tableGrid(ir.body[2]).error, undefined)
  const back = irToTiptap(ir)
  assert.deepEqual(back.content.map((n) => n.type), ['paragraph', 'pageBreak', 'horizontalRule', 'paragraph'])
})

test('normalizeIR 를 통과한 IR 은 오류가 없다', () => {
  const { ir } = tiptapToIR(reportDoc(), {})
  const { issues } = normalizeIR(ir)
  assert.deepEqual(issues, [])
})

// 회귀: 한글·워드 왕복에서 머리말 그림이 독립 그림 블록으로 올라와도 쪽 설정의 머리말 그림으로 돌아온다
test('머리말 그림은 한글과 워드 왕복 뒤에도 남는다', async () => {
  const fs = await import('node:fs')
  const { writeHwpx } = await import('../writeHwpx.js')
  const { readHwpx } = await import('../readHwpx.js')
  const { writeDocx } = await import('../writeDocx.js')
  const { readDocx } = await import('../readDocx.js')
  const { irToTiptap } = await import('../irToTiptap.js')
  const png = fs.readFileSync(new URL('../fixtures/assets/logo.png', import.meta.url))
  const ir = {
    version: 1, meta: { title: 't' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 25, right: 23, bottom: 20, left: 23 }, headerMm: 10, footerMm: 10 },
    defaults: { font: { ko: '맑은 고딕', latin: '맑은 고딕' }, sizePt: 10, lineSpacing: { mode: 'percent', value: 160 }, color: '#000000', align: 'left' },
    header: [{ t: 'p', align: 'right', runs: [{ image: { id: 'logo', wPt: 100, hPt: 30 } }] }],
    body: [{ t: 'p', runs: [{ text: '본문' }] }],
    assets: { logo: { mime: 'image/png', data: new Uint8Array(png), w: 200, h: 60 } },
  }
  for (const [write, read] of [[writeHwpx, readHwpx], [writeDocx, readDocx]]) {
    const out = irToTiptap(await read(await write(ir)))
    assert.ok(out.page?.header?.image?.src, '머리말 그림이 사라짐')
  }
})
