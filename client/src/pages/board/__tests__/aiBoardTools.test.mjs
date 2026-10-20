// node --test client/src/pages/board/__tests__/aiBoardTools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rectsOverlap, rectInside } from '../geometry.js'
import { COLOR_ORDER } from '../palette.js'
import {
  colorName, compactCanvas, createBoardTools, itemPlain, opAddStickies, opAddTextBlocks, opConnect, opEditItems, opGroupIntoFrames,
} from '../aiBoardTools.js'
import { buildBoardContext, BOARD_QUICK_ACTIONS } from '../aiBoardPrompts.js'

let n = 0
const newId = (p = 'i') => `${p}${++n}`
const sticky = (id, x, y, text, color = 'yellow') => ({ id, type: 'sticky', x, y, w: 200, h: 200, color, z: 1, data: { text } })
const canvas = (items = [], connections = []) => ({ id: 'cv', name: '캔버스 1', items, connections, comments: [] })
const ctx = (extra = {}) => ({ view: { x: 0, y: 0, w: 1200, h: 800 }, totalItems: 0, newId, ...extra })
const frame = (id, x, y, w, h, name, order = 1) => ({ id, type: 'frame', x, y, w, h, color: null, z: 0, data: { name, order } })
const noOverlap = (list) => list.every((a, i) => list.every((b, j) => i === j || !rectsOverlap(a, b)))

test('colorName: 팔레트·한글·별칭, 모르면 null, 없으면 undefined', () => {
  assert.equal(colorName('purple'), 'purple')
  assert.equal(colorName('노랑'), 'yellow')
  assert.equal(colorName('Orange'), 'amber')
  assert.equal(colorName('#ffccdd'), null)
  assert.equal(colorName('pink pastel'), null)
  assert.equal(colorName(undefined), undefined)
})

test('opAddStickies: 화면 격자 배치, 겹치지 않고 화면 안에서 시작', () => {
  const c = canvas([sticky('a', 40, 40, 'old')])
  const r = opAddStickies(c, { notes: Array.from({ length: 8 }, (_, i) => ({ text: `생각 ${i}`, color: COLOR_ORDER[i % 3] })) }, ctx())
  const made = r.items.filter((i) => i.id !== 'a')
  assert.equal(made.length, 8)
  assert.ok(made.every((m) => m.type === 'sticky' && m.w === 200 && COLOR_ORDER.includes(m.color)))
  assert.ok(noOverlap(r.items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))))
  assert.ok(made.every((m) => m.x >= 0 && m.x + m.w <= 1200))
  assert.equal(r.focus.length, 8)
  assert.ok(r.items.find((i) => i.id === 'a') === c.items[0])
  assert.ok(new Set(made.map((m) => m.z)).size === 8)
})

test('opAddStickies: 프레임 안에 놓고 모자라면 프레임을 키운다', () => {
  const f = frame('f1', 1000, 1000, 500, 300, '문제')
  const c = canvas([f])
  const r = opAddStickies(c, { notes: Array.from({ length: 6 }, (_, i) => ({ text: `n${i}` })), near: '문제' }, ctx())
  const made = r.items.filter((i) => i.type === 'sticky')
  const nf = r.items.find((i) => i.id === 'f1')
  assert.ok(nf.h > 300)
  assert.ok(made.every((m) => rectInside(m, nf)), JSON.stringify(made.map((m) => [m.x, m.y])))
  assert.ok(noOverlap(made))
  assert.throws(() => opAddStickies(c, { notes: [{ text: 'a' }], near: '없는 프레임' }, ctx()), /찾지 못/)
})

test('opAddStickies: 알 수 없는 색은 노랑으로, 검증 오류', () => {
  const r = opAddStickies(canvas(), { notes: [{ text: 'a', color: '#ffccdd' }, 'b'] }, ctx())
  assert.ok(r.items.every((i) => i.color === 'yellow'))
  assert.deepEqual(r.result.unknownColors, ['#ffccdd'])
  assert.throws(() => opAddStickies(canvas(), { notes: [] }, ctx()), /notes/)
  assert.throws(() => opAddStickies(canvas(), { notes: [{ text: 5 }] }, ctx()), /text/)
  assert.throws(() => opAddStickies(canvas(), { notes: Array.from({ length: 41 }, () => 'x') }, ctx()), /40장/)
  assert.throws(() => opAddStickies(canvas(), { notes: [{ text: '   ' }] }, ctx()), /비어/)
  assert.throws(() => opAddStickies(canvas(), { notes: [{ text: 'a' }] }, ctx({ totalItems: 5000 })), /5000/)
})

test('opAddStickies: 글은 그대로 저장(HTML 해석 없음), 500자 제한', () => {
  const r = opAddStickies(canvas(), { notes: [{ text: '<img src=x onerror=1>' + 'a'.repeat(600) }] }, ctx())
  assert.equal(r.items[0].data.text.length, 500)
  assert.equal(typeof r.items[0].data.text, 'string')
})

test('opAddTextBlocks: 세로로 쌓기, 크기 범위', () => {
  const r = opAddTextBlocks(canvas([sticky('a', 100, 100, 'x')]), { blocks: [{ text: '제목', size: 40, bold: true }, '설명 글입니다', { text: 'z', size: 500 }] }, ctx())
  const made = r.items.filter((i) => i.type === 'text')
  assert.equal(made.length, 3)
  assert.equal(made[2].data.size, 96)
  assert.ok(made[0].y < made[1].y && made[1].y < made[2].y)
  assert.ok(noOverlap(r.items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))))
  assert.throws(() => opAddTextBlocks(canvas(), { blocks: [{ text: 'a', size: 'x' }] }, ctx()), /size/)
})

test('opGroupIntoFrames: 프레임 안에 격자로 들어가고 순서·이름·중복 처리', () => {
  const items = Array.from({ length: 6 }, (_, i) => sticky(`s${i}`, 50 + i * 30, 50 + i * 10, `t${i}`))
  const locked = { ...sticky('L', 900, 900, 'lock'), locked: true }
  const c = canvas([...items, locked])
  const r = opGroupIntoFrames(c, { groups: [{ name: '가', itemIds: ['s0', 's1', 's2', 'zz'] }, { name: '나', itemIds: ['s2', 's3', 's4', 's5', 'L'] }] }, ctx())
  const frames = r.items.filter((i) => i.type === 'frame')
  assert.equal(frames.length, 2)
  assert.deepEqual(frames.map((f) => f.data.name), ['가', '나'])
  assert.deepEqual(frames.map((f) => f.data.order), [1, 2])
  assert.ok(noOverlap(frames))
  for (const [k, ids] of [['가', ['s0', 's1', 's2']], ['나', ['s3', 's4', 's5']]]) {
    const f = frames.find((x) => x.data.name === k)
    for (const id of ids) assert.ok(rectInside(r.items.find((i) => i.id === id), f), `${id} in ${k}`)
  }
  const inner = r.items.filter((i) => i.type === 'sticky' && i.id !== 'L')
  assert.ok(noOverlap(inner.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))))
  assert.equal(r.items.find((i) => i.id === 'L').x, 900)
  assert.deepEqual(r.result.skipped.sort(), ['L', 's2', 'zz'])
  assert.equal(r.result.moved, 6)
  assert.equal(r.items.length, c.items.length + 2)
  assert.throws(() => opGroupIntoFrames(c, { groups: [{ name: 'x', itemIds: ['nope'] }] }, ctx()), /없습니다/)
  assert.throws(() => opGroupIntoFrames(c, { groups: [{ name: '', itemIds: ['s0'] }] }, ctx()), /name/)
  assert.throws(() => opGroupIntoFrames(c, { groups: [] }, ctx()), /groups/)
})

test('opGroupIntoFrames: 묶지 않은 항목과 겹치면 오른쪽으로 비켜서 놓는다', () => {
  const c = canvas([sticky('a', 0, 0, 'a'), sticky('b', 300, 0, 'b'), sticky('other', 0, 260, 'o'), sticky('far', 2000, 0, 'far')])
  const r = opGroupIntoFrames(c, { groups: [{ name: 'g', itemIds: ['a', 'b'] }] }, ctx())
  const f = r.items.find((i) => i.type === 'frame')
  const others = r.items.filter((i) => ['other', 'far'].includes(i.id))
  assert.ok(others.every((o) => !rectsOverlap(f, o)))
})

test('opConnect: 중복·자기 자신·없는 id 건너뜀', () => {
  const c = canvas([sticky('a', 0, 0, 'a'), sticky('b', 300, 0, 'b'), sticky('c', 600, 0, 'c')], [{ id: 'x', from: 'a', to: 'b', label: '', arrow: 'end', color: null, style: 'curve' }])
  const r = opConnect(c, { pairs: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'c', label: '다음' }, { from: 'a', to: 'a' }, { from: 'a', to: 'nope' }] }, ctx())
  assert.equal(r.connections.length, 2)
  assert.deepEqual(r.connections[1], { id: r.connections[1].id, from: 'b', to: 'c', label: '다음', arrow: 'end', color: null, style: 'curve' })
  assert.equal(r.result.skipped.length, 4)
  assert.equal(opConnect(c, { pairs: [{ from: 'a', to: 'b' }] }, ctx()).noop, true)
  assert.throws(() => opConnect(c, { pairs: [] }, ctx()), /pairs/)
})

test('opEditItems: 글 종류별로 고치고 HTML 은 escape', () => {
  const memo = { id: 'm', type: 'memo', x: 0, y: 0, w: 240, h: 160, color: null, z: 1, data: { html: '<p>옛</p>' } }
  const link = { id: 'l', type: 'link', x: 0, y: 300, w: 300, h: 128, color: null, z: 1, data: { url: 'https://a.com', title: 't' } }
  const c = canvas([sticky('s', 0, 0, '옛 글'), memo, link, frame('f', 0, 500, 300, 300, '프레임')])
  const r = opEditItems(c, { edits: [{ id: 's', text: '새 글' }, { id: 'm', text: '<b>x</b>\n둘' }, { id: 'l', text: 'no' }, { id: 'f', text: '이름' }, { id: 'zz', text: 'x' }] })
  assert.equal(r.items.find((i) => i.id === 's').data.text, '새 글')
  assert.equal(r.items.find((i) => i.id === 'm').data.html, '<p>&lt;b&gt;x&lt;/b&gt;</p><p>둘</p>')
  assert.equal(r.items.find((i) => i.id === 'f').data.name, '이름')
  assert.equal(r.items.find((i) => i.id === 'l'), link)
  assert.equal(r.result.changed, 3)
  assert.equal(opEditItems(c, { edits: [{ id: 's', text: '옛 글' }] }).noop, true)
})

test('compactCanvas: 프레임 소속·정렬·크기 제한', () => {
  const f = frame('f1', 0, 0, 500, 500, '문제')
  const c = canvas([f, sticky('in', 50, 50, '안쪽'), sticky('out', 900, 50, '바깥', 'red'), { id: 'p', type: 'stroke', x: 0, y: 0, w: 5, h: 5, data: {} }])
  const out = compactCanvas(c)
  assert.equal(out.frames[0].count, 1)
  assert.equal(out.items.find((i) => i.id === 'in').frame, '문제')
  assert.equal(out.items.find((i) => i.id === 'out').frame, undefined)
  assert.equal(out.strokes, 1)
  assert.equal(compactCanvas(c, { frame: '문제' }).items.length, 1)
  assert.throws(() => compactCanvas(c, { frame: '없음' }), /찾지 못/)
  const big = canvas(Array.from({ length: 900 }, (_, i) => sticky(`s${i}`, (i % 30) * 220, Math.floor(i / 30) * 220, '가'.repeat(300))))
  const bo = compactCanvas(big)
  assert.ok(JSON.stringify(bo).length < 30000)
  assert.ok(bo.truncated)
  assert.equal(itemPlain(c.items[1]), '안쪽')
})

test('buildBoardContext', () => {
  const c = canvas([frame('f1', 0, 0, 500, 500, '문제'), sticky('in', 50, 50, '안쪽')])
  const t = buildBoardContext({ canvas: c, sel: ['in'], view: { x: 0, y: 0, w: 1000, h: 800 } })
  assert.ok(t.includes('항목 1개') && t.includes('문제') && t.includes('in (sticky): 안쪽') && t.includes('보이는 항목 1개'))
  assert.equal(BOARD_QUICK_ACTIONS.length, 5)
})

test('createBoardTools: host 연결, undo, 오류', async () => {
  let cv = canvas([sticky('a', 0, 0, '하나')])
  const calls = []
  const host = {
    getCanvas: () => cv, getView: () => ({ x: 0, y: 0, w: 1000, h: 700 }), getSel: () => [], canEdit: () => true, totalItems: () => cv.items.length,
    apply: (patch) => { const before = cv; cv = { ...cv, ...patch }; calls.push(patch); return { before, after: cv } },
    revert: (h) => { cv = h.before },
  }
  const tools = Object.fromEntries(createBoardTools(host).map((t) => [t.name, t]))
  for (const n of ['read_canvas', 'add_sticky_notes', 'add_text_blocks', 'cluster_items', 'connect_items', 'edit_items', 'layout_items', 'add_frame_template', 'fill_template', 'set_item_style', 'add_comment_on_item']) assert.ok(tools[n], n)
  const r = await tools.add_sticky_notes.run({ notes: [{ text: '둘' }, { text: '셋', color: 'red' }] })
  assert.equal(cv.items.length, 3)
  assert.equal(calls.length, 1)
  r.undo()
  assert.equal(cv.items.length, 1)
  const bad = await tools.add_sticky_notes.run({ notes: 'x' })
  assert.equal(bad.result.ok, false)
  assert.equal(bad.undo, undefined)
  const rd = await tools.read_canvas.run({})
  assert.equal(rd.result.items.length, 1)
  const ro = createBoardTools({ ...host, canEdit: () => false }).find((t) => t.name === 'edit_items')
  assert.equal((await ro.run({ edits: [] })).result.ok, false)
})
