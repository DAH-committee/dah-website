// node --test client/src/pages/board/__tests__/aiBoardExtra.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rectsOverlap } from '../geometry.js'
import { compactCanvas, createBoardTools } from '../aiBoardTools.js'
import { opAddFrameTemplate, opCommentOnItem, opFillTemplate, opLayout, opSetItemStyle, spatialSummary } from '../aiBoardExtra.js'

let n = 0
const newId = (p = 'i') => `${p}x${++n}`
const sticky = (id, x, y, text, color = 'yellow') => ({ id, type: 'sticky', x, y, w: 200, h: 200, color, z: 1, data: { text } })
const canvas = (items = []) => ({ id: 'cv', name: '캔버스', items, connections: [], comments: [] })
const ctx = (e = {}) => ({ view: { x: 0, y: 0, w: 1200, h: 800 }, totalItems: 0, newId, ...e })
const noOverlap = (l) => l.every((a, i) => l.every((b, j) => i === j || !rectsOverlap(a, b)))

test('opLayout: grid, row, column, radial, timeline', () => {
  const items = Array.from({ length: 6 }, (_, i) => sticky(`s${i}`, i * 30, i * 10, `메모 ${i}`))
  const c = canvas(items)
  const ids = items.map((i) => i.id)
  for (const mode of ['grid', 'row', 'column', 'radial', 'timeline']) {
    const r = opLayout(c, { ids, mode }, ctx())
    assert.ok(r.items.length === 6, mode)
    assert.ok(noOverlap(r.items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))), `겹침 ${mode}`)
    assert.equal(r.fit, true)
  }
  const row = opLayout(c, { ids, mode: 'row', gap: 10 }, ctx())
  assert.equal(new Set(row.items.map((i) => i.y)).size, 1)
  assert.equal(row.items[1].x - (row.items[0].x + 200), 10)
  assert.throws(() => opLayout(c, { ids: ['s0'], mode: 'grid' }, ctx()), /2개/)
  assert.throws(() => opLayout(c, { ids: ['s0', 'zz'], mode: 'grid' }, ctx()), /read_canvas/)
  assert.throws(() => opLayout(c, { ids, mode: 'spiral' }, ctx()), /mode/)
  assert.ok(opLayout(c, { mode: 'column' }, ctx({ sel: ids.slice(0, 3) })).items)
})

test('add_frame_template + fill_template: KPT', () => {
  const c = canvas([sticky('a', 0, 0, '기존')])
  const t = opAddFrameTemplate(c, { name: 'KPT', title: '3주차 회고' }, ctx())
  assert.equal(t.result.frames.length, 3)
  assert.ok(t.items.some((i) => i.type === 'text' && i.data.text === '3주차 회고'))
  assert.ok(t.items.filter((i) => i.type === 'frame').every((f) => f.y > 100))
  const c2 = { ...c, items: t.items, connections: t.connections }
  const f = opFillTemplate(c2, { cells: [{ label: 'Keep', text: '매일 스탠드업' }, { label: 'Keep', text: '코드 리뷰' }, { label: 'Problem', text: '일정 지연' }, { label: 'Try', text: '문서화' }, { label: '없는칸', text: 'x' }] }, ctx())
  assert.equal(f.result.filled, 4)
  assert.match(f.result.errors[0], /프레임/)
  const frames = f.items.filter((i) => i.type === 'frame')
  const keep = frames.find((x) => x.data.name.startsWith('Keep'))
  const inKeep = f.items.filter((i) => i.type === 'sticky' && i.x >= keep.x && i.x + i.w <= keep.x + keep.w && i.y >= keep.y && i.y + i.h <= keep.y + keep.h).map((i) => i.data.text)
  assert.ok(inKeep.includes('매일 스탠드업') && inKeep.includes('코드 리뷰'))
  assert.throws(() => opAddFrameTemplate(c, { name: 'swot' }, ctx()), /name/)
})

test('fill_template: 여정 지도 행/열, 페르소나 칸 제목', () => {
  const j = opAddFrameTemplate(canvas(), { name: 'journey' }, ctx())
  const c = { ...canvas(), items: j.items, connections: j.connections }
  const f = opFillTemplate(c, { cells: [{ label: '행동/단계 2', text: '앱을 연다' }, { label: '감정', text: '불안' }] }, ctx())
  assert.equal(f.result.filled, 2)
  const filled = f.items.filter((i) => i.type === 'sticky' && ['앱을 연다', '불안'].includes(i.data.text))
  assert.equal(filled.length, 2)
  const stage2 = f.items.find((i) => i.data?.text === '단계 2')
  const act = filled.find((i) => i.data.text === '앱을 연다')
  assert.ok(Math.abs(act.x - stage2.x) < 130)
  const p = opAddFrameTemplate(canvas(), { name: 'persona' }, ctx())
  const pf = opFillTemplate({ ...canvas(), items: p.items }, { cells: [{ label: '목표', text: '졸업 작품을 끝낸다' }] }, ctx())
  assert.equal(pf.result.filled, 1)
})

test('set_item_style, comment, spatialSummary, read_canvas', async () => {
  const text = { id: 't1', type: 'text', x: 0, y: 400, w: 300, h: 40, z: 1, data: { text: '제목', size: 20 } }
  const c = canvas([sticky('a', 0, 0, '하나'), sticky('b', 300, 0, ''), text, { id: 'f', type: 'frame', x: -50, y: -50, w: 600, h: 300, z: 0, data: { name: '묶음', order: 1 } }])
  const r = opSetItemStyle(c, { ids: ['a', 't1'], color: '빨강', size: 40, bold: true })
  assert.equal(r.items.find((i) => i.id === 'a').color, 'red')
  assert.equal(r.items.find((i) => i.id === 't1').data.size, 40)
  assert.ok(r.result.skipped.some((s) => s.id === 'a'))
  assert.throws(() => opSetItemStyle(c, { ids: ['a'], color: '#fcc' }), /color/)
  assert.throws(() => opSetItemStyle(c, { ids: ['a'], size: 5 }), /size/)
  const cm = opCommentOnItem(c, { id: 'a', text: '중복 아닌가요?' }, ctx())
  assert.equal(cm.comments[0].author, 'AI')
  assert.throws(() => opCommentOnItem(c, { id: 'zz', text: 'x' }, ctx()), /read_canvas/)
  const sp = spatialSummary(c)
  assert.equal(sp.frames[0].count, 2)
  assert.equal(sp.frames[0].empty_slots, 1)
  assert.equal(sp.orphans.count, 1)
  assert.ok(compactCanvas(c).spatial)
  assert.equal(compactCanvas(c, { frame: '묶음' }).spatial, undefined)
  let cur = c
  const host = { getCanvas: () => cur, getView: () => ({ x: 0, y: 0, w: 1000, h: 700 }), getSel: () => ['a', 'b'], canEdit: () => true, totalItems: () => 4, apply: (p) => { cur = { ...cur, ...p }; return { before: c, after: cur } }, revert: () => {} }
  const tools = Object.fromEntries(createBoardTools(host).map((x) => [x.name, x]))
  const lr = await tools.layout_items.run({ mode: 'row' })
  assert.ok(lr.undo && lr.result.ok)
  const ac = await tools.add_comment_on_item.run({ id: 'b', text: '채워 주세요' })
  assert.equal(cur.comments.length, 1)
  assert.ok(ac.result.ok)
})

test('opLayout: 다른 항목과 겹치면 오른쪽 빈 곳으로', () => {
  const a = sticky('a', 0, 0, 'a'); const b = sticky('b', 600, 0, 'b'); const c = sticky('c', 220, 300, 'c'); const d = sticky('d', 100, 100, 'd')
  const r = opLayout(canvas([a, b, c, d]), { ids: ['a', 'b'], mode: 'column' }, ctx())
  const moved = r.items.filter((i) => ['a', 'b'].includes(i.id))
  const rest = r.items.filter((i) => ['c', 'd'].includes(i.id))
  assert.ok(noOverlap([...moved, ...rest].map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))))
  assert.ok(r.result.relocated)
})
