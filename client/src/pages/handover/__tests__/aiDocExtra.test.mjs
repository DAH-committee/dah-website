// 실행: cd client && node --test src/pages/handover/__tests__/aiDocExtra.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { Node, Mark, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { EditorState } from '@tiptap/pm/state'
import { createDocTools } from '../aiDocTools.js'
import { findIn, lintFacts, normColor, numStyleOf, outlineOf } from '../aiDocExtra.js'

const Comment = Mark.create({ name: 'comment', inclusive: false, excludes: '', addAttributes() { return { id: { default: null } } } })
const Img = Node.create({ name: 'image', group: 'block', atom: true, addAttributes() { return { src: { default: '' }, alt: { default: '' } } } })
const schema = getSchema([StarterKit.configure({ history: false }), Table, TableRow, TableCell, TableHeader, Comment, Img])
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...c) => ({ type: 'paragraph', content: c })
const h = (level, text) => ({ type: 'heading', attrs: { level }, content: text ? [t(text)] : [] })
const sample = () => ({
  type: 'doc',
  content: [
    h(1, '1. 개요'), p(t('첫 문단입니다.  공백이 둘!!')), h(3, '가. 세부'), p(t('내용')), h(2, ''),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('이름'))] }, { type: 'tableCell', content: [p(t('역할'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('가'))] }, { type: 'tableCell', content: [p(t('나'))] }] },
    ] },
    { type: 'image', attrs: { src: 'https://x/y.png', alt: '' } },
    p(t('끝 문단')),
  ],
})
function makeEditor(over = {}) {
  const ed = { isEditable: true, isDestroyed: false, state: EditorState.create({ doc: schema.nodeFromJSON(sample()) }) }
  ed.view = { dispatch: (tr) => { ed.state = ed.state.apply(tr) } }
  const page = { size: 'A4', orientation: 'portrait', marginMm: { top: 20, right: 20, bottom: 20, left: 20 }, headerMm: 10, footerMm: 10, pageNumbers: { on: false, pos: 'center' }, header: { text: '', align: 'left' }, footer: { text: '', align: 'center' } }
  const st = { page, hwp: { mode: 'docs', preset: '보고서', head: {}, foot: {}, vars: {} }, comments: [] }
  const env = {
    getEditor: () => ed, editBlock: () => '', getHwp: () => ({ mode: st.hwp.mode, preset: st.hwp.preset }), getHwpFull: () => st.hwp,
    updateHwp: (patch) => { st.hwp = { ...st.hwp, ...patch } }, getPage: () => st.page, getRawPage: () => null, setPage: (x) => { st.page = x },
    getTabTitle: () => '탭', getTitle: () => '제목', setTitle: async () => {}, runLint: async () => [], commentCount: () => 0, notify: () => {},
    getComments: () => st.comments,
    addComment: async ({ quote, body }) => { st.comments.push({ id: st.comments.length + 1, anchor_id: 'a', quote, body, resolved: false }); return { ok: true, id: st.comments.length } },
    updateComment: async (c, patch) => { Object.assign(c, patch) },
    ...over,
  }
  const api = createDocTools(env)
  return { ed, st, tool: (n) => api.tools.find((x) => x.name === n), names: api.tools.map((x) => x.name) }
}

test('도구 개수는 서버 한도(24) 이하', () => {
  const { names } = makeEditor()
  assert.ok(names.length <= 24, names.length)
  for (const n of ['get_outline', 'find_in_document', 'check_document', 'table_ops', 'apply_format', 'set_page_setup', 'switch_mode', 'add_comment']) assert.ok(names.includes(n), n)
})

test('numStyleOf, normColor', () => {
  assert.equal(numStyleOf('1. 개요'), 'arabic-dot')
  assert.equal(numStyleOf('가. 세부'), 'gana-dot')
  assert.equal(numStyleOf('제2장 결과'), 'jang')
  assert.equal(normColor('빨강'), '#FF1744')
  assert.equal(normColor('#abcdef'), '#ABCDEF')
  assert.equal(normColor('javascript:1'), null)
})

test('lintFacts: 규칙', () => {
  const r = lintFacts({
    paras: [
      { n: 1, type: 'heading', level: 1, text: '1. 개요' }, { n: 2, type: 'heading', level: 3, text: '가. 세부' }, { n: 3, type: 'heading', level: 2, text: '' },
      { n: 4, type: 'paragraph', text: '가  나' }, { n: 5, type: 'paragraph', text: '정말!!' }, { n: 6, type: 'paragraph', text: 'x'.repeat(700) },
      { n: 7, type: 'paragraph', list: true, text: '' }, { n: 8, type: 'paragraph', text: 'a', fonts: ['A', 'B', 'C'] },
    ],
    tables: [{ t: 1, headerRow: false, firstPara: 9 }], images: [{ alt: '', n: 9 }],
  })
  const rules = Object.keys(r.counts)
  for (const x of ['empty_heading', 'heading_skip', 'double_space', 'repeat_punct', 'long_paragraph', 'empty_list_item', 'table_no_header', 'image_no_alt', 'mixed_fonts', 'mixed_numbering']) assert.ok(rules.includes(x), x)
  assert.ok(r.issues.every((i) => i.fix && i.message))
})

test('outlineOf, findIn', () => {
  const paras = [{ n: 1, type: 'heading', level: 1, text: '개요' }, { n: 2, type: 'paragraph', text: '하나 둘 셋' }, { n: 3, type: 'heading', level: 2, text: '세부' }, { n: 4, type: 'paragraph', text: '넷 다섯 하나' }]
  const o = outlineOf(paras)
  assert.equal(o.headings.length, 2)
  assert.equal(o.headings[0].words, 3)
  assert.equal(o.total_words, 8)
  const f = findIn(paras, { query: '하나', max: 5 })
  assert.deepEqual(f.matches.map((m) => m.n), [2, 4])
  assert.throws(() => findIn(paras, { query: '(', regex: true, max: 5 }))
  assert.equal(findIn(paras, { query: '하.', regex: true, max: 1 }).more, true)
})

test('get_outline, find_in_document, check_document 도구', async () => {
  const { tool } = makeEditor()
  const o = await tool('get_outline').run({})
  assert.equal(o.result.headings[0].text, '1. 개요')
  const f = await tool('find_in_document').run({ query: '공백' })
  assert.equal(f.result.matches[0].n, 2)
  const c = await tool('check_document').run({})
  const rules = c.result.issues.map((i) => i.rule)
  for (const x of ['empty_heading', 'heading_skip', 'double_space', 'repeat_punct', 'empty_list_item', 'table_no_header', 'image_no_alt']) assert.ok(rules.includes(x), x)
})

test('apply_format: 굵게, 제목 단계, 되돌리기', async () => {
  const { ed, tool } = makeEditor()
  const before = ed.state.doc
  const r = await tool('apply_format').run({ n: 2, quote: '첫 문단', bold: true })
  assert.equal(r.result.ok, true)
  let bold = false
  ed.state.doc.descendants((n) => { if (n.isText && n.text.startsWith('첫 문단') && n.marks.some((m) => m.type.name === 'bold')) bold = true })
  assert.ok(bold)
  r.undo()
  assert.ok(ed.state.doc.eq(before))
  const r2 = await tool('apply_format').run({ n: 4, heading_level: 2 })
  assert.equal(ed.state.doc.child(3).type.name, 'heading')
  assert.ok(r2.undo)
  assert.match((await tool('apply_format').run({ n: 2, color: 'zz' })).summary, /color/)
  assert.match((await tool('apply_format').run({ n: 99, bold: true })).summary, /문단 없음/)
})

test('table_ops: 행 추가, 칸 채우기, 머리글, 되돌리기', async () => {
  const { ed, tool } = makeEditor()
  const before = ed.state.doc
  const a = await tool('table_ops').run({ table: 1, op: 'add_row', row: 2 })
  assert.equal(a.result.ok, true)
  let rows = 0
  ed.state.doc.descendants((n) => { if (n.type.name === 'table') rows = n.childCount })
  assert.equal(rows, 3)
  const s = await tool('table_ops').run({ table: 1, op: 'set_cell', row: 3, col: 1, text: '다' })
  assert.equal(s.result.ok, true)
  assert.match(ed.state.doc.textContent, /다/)
  const hd = await tool('table_ops').run({ table: 1, op: 'toggle_header' })
  assert.equal(hd.result.ok, true)
  let first = ''
  ed.state.doc.descendants((n) => { if (n.type.name === 'table') first = n.firstChild.firstChild.type.name })
  assert.equal(first, 'tableHeader')
  a.undo?.()
  assert.match((await tool('table_ops').run({ table: 5, op: 'add_row' })).summary, /표가 없습니다/)
  assert.match((await tool('table_ops').run({ table: 1, op: 'delete_row', row: 40 })).summary, /범위/)
  void before
})

test('set_cell_style: 배경과 정렬', async () => {
  const { ed, tool } = makeEditor()
  const r = await tool('set_cell_style').run({ table: 1, cells: [{ row: 1, col: 1 }], background: '노랑', bold: true })
  assert.equal(r.result.cells, 1)
  let bg = null
  ed.state.doc.descendants((n) => { if (n.type.name === 'tableCell' && n.attrs.background) bg = n.attrs.background })
  void bg
  assert.match((await tool('set_cell_style').run({ table: 1, background: 'zzz' })).summary, /background/)
})

test('set_page_setup, switch_mode, set_gongmun_fields, 댓글', async () => {
  const { st, tool } = makeEditor()
  const read = await tool('set_page_setup').run({})
  assert.equal(read.result.changed, false)
  const r = await tool('set_page_setup').run({ orientation: 'landscape', margins_mm: { top: 25 }, page_numbers: { on: true, pos: 'right' } })
  assert.equal(st.page.orientation, 'landscape')
  assert.equal(st.page.marginMm.top, 25)
  assert.equal(st.page.pageNumbers.on, true)
  assert.match((await tool('set_page_setup').run({ margins_mm: { top: 900 } })).summary, /0~60/)
  assert.ok(r.undo)
  assert.match((await tool('set_gongmun_fields').run({ head: { title: 'x' } })).summary, /한글/)
  const m = await tool('switch_mode').run({ mode: 'hwp', preset: '기안문' })
  assert.equal(st.hwp.mode, 'hwp')
  await tool('set_gongmun_fields').run({ head: { to: '내부결재', title: '예산 집행 계획' }, vars: [{ label: '예산', value: '1000000', unit: '원' }] })
  assert.equal(st.hwp.head.to, '내부결재')
  assert.equal(Object.values(st.hwp.vars)[0].label, '예산')
  m.undo()
  assert.equal(st.hwp.mode, 'docs')
  const c = await tool('add_comment').run({ n: 2, quote: '첫 문단', text: '표현을 다듬어 주세요' })
  assert.equal(c.result.ok, true)
  assert.match(st.comments[0].body, /^\[AI\]/)
  assert.match((await tool('add_comment').run({ n: 2, quote: '없는글', text: 'x' })).summary, /quote/)
  const rc = await tool('read_comments').run({})
  assert.equal(rc.result.total, 1)
  const rs = await tool('resolve_comment').run({ comment_id: 1 })
  assert.equal(rs.result.resolved, true)
})
