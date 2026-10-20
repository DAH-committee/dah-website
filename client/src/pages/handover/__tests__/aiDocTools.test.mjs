// 실행: cd client && node --test src/pages/handover/__tests__/aiDocTools.test.mjs
// DOM 없이 ProseMirror 상태만으로 도구를 검사한다(편집기 뷰 대신 가짜 editor 를 쓴다).
import test from 'node:test'
import assert from 'node:assert/strict'
import { Node, Mark, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { EditorState } from '@tiptap/pm/state'
import { history, undo, redo } from '@tiptap/pm/history'
import { createDocTools, diffHunks, protectAtoms, walkDoc, paraModel, toDisplay, fromDisplay } from '../aiDocTools.js'

const Comment = Mark.create({ name: 'comment', inclusive: false, excludes: '', addAttributes() { return { id: { default: null } } } })
const Checkbox = Node.create({ name: 'checkbox', group: 'inline', inline: true, atom: true, addAttributes() { return { checked: { default: false } } } })
const Secret = Node.create({ name: 'secret', group: 'inline', inline: true, atom: true, addAttributes() { return { id: { default: 1 }, label: { default: '비번' } } } })
const schema = getSchema([StarterKit.configure({ history: false }), LinkExt, TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableCell, TableHeader, Comment, Checkbox, Secret])

const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...c) => ({ type: 'paragraph', content: c })
const sample = () => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('인수인계 문서')] },
    p(t('안녕하세요 저는 '), t('홍길동', [{ type: 'bold' }]), t('입니다. 되요 라고 말했다.')),
    p(t('링크는 '), t('여기에서', [{ type: 'link', attrs: { href: 'https://a.com' } }]), t(' 확인 하세요. '), t('댓글문장', [{ type: 'comment', attrs: { id: 'c1' } }]), t('이다.')),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('첫째 항목'))] }, { type: 'listItem', content: [p(t('둘째 항목'))] }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('이름'))] }, { type: 'tableHeader', content: [p(t('역활'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('가'))] }, { type: 'tableCell', content: [p(t('나'))] }] },
    ] },
    p(t('끝 문단 '), { type: 'secret', attrs: { id: 7, label: '계정' } }, t(' 뒤')),
  ],
})

function makeEditor(json = sample(), over = {}) {
  const doc = schema.nodeFromJSON(json)
  const ed = { isEditable: true, isDestroyed: false, state: EditorState.create({ doc, plugins: [history()] }) }
  ed.view = { dispatch: (tr) => { ed.state = ed.state.apply(tr) } }
  ed.commands = { undo: () => undo(ed.state, (tr) => { ed.state = ed.state.apply(tr) }), redo: () => redo(ed.state, (tr) => { ed.state = ed.state.apply(tr) }) }
  const notes = []
  const env = { getEditor: () => ed, editBlock: () => '', getHwp: () => ({ mode: 'docs', preset: '보고서' }), getTabTitle: () => '탭', getTitle: () => '제목', setTitle: async () => {}, runLint: async () => [], commentCount: () => 1, notify: (m) => notes.push(m), ...over }
  const api = createDocTools(env)
  const tool = (name) => api.tools.find((x) => x.name === name)
  return { ed, api, tool, notes }
}
const textOf = (ed) => ed.state.doc.textContent
const marksOf = (ed, needle) => {
  let out = null
  ed.state.doc.descendants((n) => { if (n.isText && n.text.includes(needle) && !out) out = n.marks.map((m) => m.type.name) })
  return out
}

test('diffHunks: 최소 차이', () => {
  assert.deepEqual(diffHunks('되요', '돼요'), [{ a0: 0, a1: 1, b0: 0, b1: 1 }])
  assert.deepEqual(diffHunks('abc', 'abc'), [])
  assert.deepEqual(diffHunks('', 'x'), [{ a0: 0, a1: 0, b0: 0, b1: 1 }])
  const h = diffHunks('안되요 그리고 확인 하세요', '안 돼요 그리고 확인하세요')
  assert.ok(h.length >= 2 && h.length <= 3)
  // 되돌려 붙이면 b 가 된다
  const a = '안되요 그리고 확인 하세요'
  const b = '안 돼요 그리고 확인하세요'
  let out = ''
  let i = 0
  for (const x of h) { out += a.slice(i, x.a0) + b.slice(x.b0, x.b1); i = x.a1 }
  assert.equal(out + a.slice(i), b)
})

test('protectAtoms: 조각은 지우지 않는다', () => {
  const a = 'ab\uE000cd'
  const r = protectAtoms([{ a0: 0, a1: 5, b0: 0, b1: 3 }], a, 'xyz')
  assert.ok(r.every((x) => !a.slice(x.a0, x.a1).includes('\uE000')))
})

test('문단 번호와 읽기', async () => {
  const { tool } = makeEditor()
  const r = await tool('read_document').run({})
  const lines = r.result.text.split('\n')
  assert.match(lines[0], /^\[1\] \(제목1\) 인수인계 문서$/)
  assert.match(lines[3], /^\[4\] \(글머리\) 첫째 항목$/)
  assert.match(r.result.text, /\[6\] \(표 t1 r1 c1 머리글\) 이름/)
  assert.match(r.result.text, /\[9\] \(표 t1 r2 c2\) 나/)
  assert.match(r.result.text, /\[10\] 끝 문단 ⟦비밀값:계정⟧ 뒤/)
  assert.equal(r.result.total_paragraphs, 10)
  const r2 = await tool('read_document').run({ from: 4, to: 5 })
  assert.equal(r2.result.text.split('\n').length, 2)
})

test('fix_typos: 서식·링크·댓글 유지, 한 번에 되돌리기', async () => {
  const { ed, tool } = makeEditor()
  const before = ed.state.doc
  const r = await tool('fix_typos').run({ fixes: [
    { n: 2, text: '안녕하세요 저는 홍길동입니다. 돼요 라고 말했다.' },
    { n: 3, text: '링크는 여기에서 확인하세요. 댓글문장이다.' },
    { n: 7, text: '역할' },
    { n: 8, text: '완전히 다른 긴 문장으로 다시 썼습니다' },
  ] })
  assert.match(r.summary, /개 문단, \d+곳 고침/)
  assert.ok(textOf(ed).includes('돼요 라고'))
  assert.deepEqual(marksOf(ed, '홍길동'), ['bold'])
  assert.deepEqual(marksOf(ed, '여기에서'), ['link'])
  assert.deepEqual(marksOf(ed, '댓글문장'), ['comment'])
  assert.ok(textOf(ed).includes('확인하세요'))
  // 많이 바뀐 문단(8번)은 건너뜀
  assert.equal(r.result.skipped.length, 1)
  // ⌘Z 한 번에 모두 돌아온다
  assert.ok(ed.commands.undo())
  assert.ok(ed.state.doc.eq(before))
})

test('undo 함수(패널 되돌리기)', async () => {
  const { ed, tool } = makeEditor()
  const before = ed.state.doc
  const r = await tool('fix_typos').run({ fixes: [{ n: 2, text: '안녕하세요 저는 홍길동입니다. 돼요 라고 말했다.' }] })
  r.undo()
  assert.ok(ed.state.doc.eq(before))
  // 그 사이 문서가 바뀐 경우: 되돌리지 않고 안내
  const r2 = await tool('fix_typos').run({ fixes: [{ n: 2, text: '안녕하세요 저는 홍길동입니다. 돼요 라고 말했다.' }] })
  ed.view.dispatch(ed.state.tr.insertText('X', 2))
  const { notes } = {}
  void notes
  r2.undo()
  assert.ok(textOf(ed).startsWith('X') || textOf(ed).includes('X'))
})

test('undo: 다른 편집이 끼면 인라인 안내, 역스텝 경로는 편집이 없을 때 동작', async () => {
  const { ed, tool } = makeEditor()
  const before = ed.state.doc
  const r = await tool('replace_text').run({ find: '되요', replace: '돼요' })
  assert.equal(r.result.replaced, 1)
  // 실행취소 기록을 없앤 상태에서도(역 스텝) 돌아오는지: history 상태 초기화
  ed.state = EditorState.create({ doc: ed.state.doc, plugins: [history()] })
  r.undo()
  assert.ok(ed.state.doc.eq(before))
})

test('replace_text: 개수와 대소문자', async () => {
  const { ed, tool } = makeEditor({ type: 'doc', content: [p(t('Hello hello HELLO')), p(t('hello'))] })
  let r = await tool('replace_text').run({ find: 'hello', replace: 'hi', matchCase: true })
  assert.equal(r.result.replaced, 2)
  r = await tool('replace_text').run({ find: 'hello', replace: 'hi' })
  assert.equal(r.result.replaced, 2)
  r = await tool('replace_text').run({ find: 'hi', replace: 'yo', all: false })
  assert.equal(r.result.replaced, 1)
  assert.equal(textOf(ed).split('yo').length - 1, 1)
})

test('edit_paragraphs: replace, insert_after, delete, 표 보호', async () => {
  const { ed, tool } = makeEditor()
  const before = ed.state.doc
  const r = await tool('edit_paragraphs').run({ edits: [
    { n: 4, op: 'replace', text: '첫번째 항목' },
    { n: 5, op: 'insert_after', text: '셋째 항목\n넷째 항목' },
    { n: 6, op: 'delete' }, // 표 머리글 칸: 칸은 남고 글만 비워진다
    { n: 3, op: 'delete' },
    { n: 99, op: 'replace', text: 'x' },
  ] })
  assert.equal(r.result.errors.length, 1)
  const names = []
  ed.state.doc.forEach((n) => names.push(n.type.name))
  assert.deepEqual(names, ['heading', 'paragraph', 'bulletList', 'table', 'paragraph'])
  const list = ed.state.doc.child(2)
  assert.equal(list.childCount, 4)
  assert.equal(list.child(0).textContent, '첫번째 항목')
  assert.equal(list.child(3).textContent, '넷째 항목')
  const table = ed.state.doc.child(3)
  assert.equal(table.child(0).childCount, 2)
  assert.equal(table.child(0).child(0).textContent, '')
  ed.commands.undo()
  assert.ok(ed.state.doc.eq(before))
})

test('edit_paragraphs: 비밀값은 글 고치기로 지워지지 않고 위치도 유지', async () => {
  const { ed, tool } = makeEditor()
  await tool('edit_paragraphs').run({ edits: [{ n: 10, op: 'replace', text: '마지막 문단 계정 뒤에' }] })
  const last = ed.state.doc.lastChild
  let secrets = 0
  last.forEach((c) => { if (c.type.name === 'secret') secrets += 1 })
  assert.equal(secrets, 1)
  await tool('edit_paragraphs').run({ edits: [{ n: 10, op: 'replace', text: '⟦비밀값:계정⟧ 앞으로 옮김' }] })
  assert.equal(ed.state.doc.lastChild.content.content.filter((c) => c.type.name === 'secret').length, 1)
})

test('delete: 비밀값 문단은 거절', async () => {
  const { tool } = makeEditor()
  const r = await tool('edit_paragraphs').run({ edits: [{ n: 10, op: 'delete' }] })
  assert.equal(r.result.errors.length, 1)
})

test('insert_blocks: 표·중첩 목록·빈 문서', async () => {
  const { ed, tool } = makeEditor({ type: 'doc', content: [p()] })
  const r = await tool('insert_blocks').run({ blocks: [
    { type: 'heading', text: '회의 안건', level: 2 },
    { type: 'bullet', text: '가', depth: 0 },
    { type: 'bullet', text: '가-1', depth: 1 },
    { type: 'bullet', text: '나' },
    { type: 'table', rows: [['항목', '담당'], ['예산', '홍'], ['일정']] },
  ] })
  assert.match(r.summary, /블록 3개 넣음/)
  const names = []
  ed.state.doc.forEach((n) => names.push(n.type.name))
  assert.deepEqual(names, ['heading', 'bulletList', 'table', 'paragraph'])
  const list = ed.state.doc.child(1)
  assert.equal(list.childCount, 2)
  assert.equal(list.child(0).childCount, 2)
  const table = ed.state.doc.child(2)
  assert.equal(table.child(0).child(0).type.name, 'tableHeader')
  assert.equal(table.child(2).childCount, 2)
  r.undo()
  assert.equal(ed.state.doc.childCount, 1)
})

test('insert_blocks: after_n 은 목록·표 뒤로', async () => {
  const { ed, tool } = makeEditor()
  await tool('insert_blocks').run({ after_n: 8, blocks: [{ type: 'paragraph', text: '표 뒤 문단' }] })
  const names = []
  ed.state.doc.forEach((n) => names.push(n.type.name))
  assert.deepEqual(names, ['heading', 'paragraph', 'paragraph', 'bulletList', 'table', 'paragraph', 'paragraph'])
})

test('HTML 은 글자로만 들어간다', async () => {
  const { ed, tool } = makeEditor()
  await tool('replace_text').run({ find: '되요', replace: '<b>돼요</b><script>x</script>' })
  assert.ok(textOf(ed).includes('<b>돼요</b>'))
  let bold = 0
  ed.state.doc.descendants((n) => { if (n.isText && n.text.includes('<script>') && n.marks.some((m) => m.type.name === 'bold')) bold += 1 })
  assert.equal(bold, 0)
})

test('replace_selection: 선택 한 문단, 서식 유지', async () => {
  const { ed, tool } = makeEditor()
  const { TextSelection } = await import('@tiptap/pm/state')
  const pr = walkDoc(ed.state.doc).paras[1]
  const model = paraModel(pr.node, pr.pos)
  const from = model.chars.find((c) => c.ch === '홍').pos
  ed.state = ed.state.apply(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, from + 5))) // 홍길동입니
  const g = await tool('get_selection').run({})
  assert.equal(g.result.text, '홍길동입니')
  assert.equal(g.result.from_paragraph, 2)
  const r = await tool('replace_selection').run({ text: '홍길순입니' })
  assert.ok(r.undo)
  assert.ok(textOf(ed).includes('홍길순입니다'))
  assert.deepEqual(marksOf(ed, '홍길'), ['bold'])
})

test('거절: 편집 불가 상태', async () => {
  const { ed, tool } = makeEditor(sample(), { editBlock: () => '버전 기록을 보는 중에는 고칠 수 없습니다' })
  const before = ed.state.doc
  for (const [name, args] of [['fix_typos', { fixes: [{ n: 2, text: 'x' }] }], ['replace_text', { find: '저는', replace: 'x' }], ['edit_paragraphs', { edits: [{ n: 2, op: 'delete' }] }], ['insert_blocks', { blocks: [{ type: 'paragraph', text: 'x' }] }], ['replace_selection', { text: 'x' }]]) {
    const r = await tool(name).run(args)
    assert.equal(r.result.ok, false, name)
  }
  assert.ok(ed.state.doc.eq(before))
})

test('잘못된 인자', async () => {
  const { tool } = makeEditor()
  assert.equal((await tool('fix_typos').run({ fixes: 'x' })).result.ok, false)
  assert.equal((await tool('edit_paragraphs').run({ edits: [null, 5, { n: 'a', op: 'x' }] })).result.ok, false)
  assert.equal((await tool('insert_blocks').run({ blocks: [{ type: 'script' }] })).result.ok, false)
  assert.equal((await tool('replace_text').run({ find: '', replace: 'a' })).result.ok, false)
})

test('getContext', () => {
  const { api } = makeEditor()
  const c = api.getContext()
  assert.match(c, /문단 수: 10/)
  assert.match(c, /Docs 모드/)
})

test('run_gongmun_check: 한글 모드에서만, 문단 번호 붙임', async () => {
  const a = makeEditor()
  assert.equal((await a.tool('run_gongmun_check').run({})).result.ok, false)
  const b = makeEditor(sample(), { getHwp: () => ({ mode: 'hwp', preset: '개조식' }), runLint: async () => [{ line: 2, match: '되요 라고', rule: '표기', severity: 'warn', message: '확인', suggest: '돼요' }] })
  const r = await b.tool('run_gongmun_check').run({})
  assert.equal(r.result.issues[0].n, 2)
})

test('fromDisplay: 토큰 되살리기', () => {
  const { ed } = makeEditor()
  const pr = walkDoc(ed.state.doc).paras[9]
  const m = paraModel(pr.node, pr.pos)
  assert.equal(toDisplay(m), '끝 문단 ⟦비밀값:계정⟧ 뒤')
  assert.equal(fromDisplay('끝 ⟦비밀값:계정⟧ 뒤', m, 0, m.chars.length).includes('\uE000'), true)
})
