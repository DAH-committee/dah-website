// 실행: cd client && node --test src/pages/slides/__tests__/aiSlideExtra.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { newDeck, makeSlide, textEl, imageEl, SLIDE_W } from '../deckCore.js'
import { checkDeck, opFixDeck, opArrange, opAddImage, opAddTable, opAddShape, opSetBackground, opDuplicateSlide, opSetTransition, opStyleText } from '../aiSlideExtra.js'
import { contrast, estimateText } from '../slideMetrics.js'
import { createSlideTools } from '../aiSlideTools.js'

const long = '가나다라마바사아자차카타파하'.repeat(12)
function deck() {
  const d = newDeck('basic', [
    makeSlide('title-body', { title: '<p>첫 장</p>', body: '<ul><li>하나</li><li>둘</li></ul>' }),
    makeSlide('title-body', { title: '<p>둘째</p>', body: `<ul>${Array.from({ length: 8 }, (_, i) => `<li>항목 ${i}</li>`).join('')}</ul>` }),
    makeSlide('title-body', { title: '<p>셋째</p>', body: `<p>${long.repeat(8)}</p>` }),
    makeSlide('title-body', { title: '', body: '' }),
  ])
  return d
}
const ids = (d, si, role) => d.slides[si].elements.find((e) => e.role === role)

test('estimateText / contrast', () => {
  const d = deck()
  const e = ids(d, 2, 'body')
  assert.ok(estimateText({ ...e, h: 120 }).overflow)
  assert.ok(contrast('#FFFFFF', '#FFFFFF') < 1.1)
  assert.ok(contrast('#111111', '#FFFFFF') > 15)
})

test('checkDeck: 규칙 감지', () => {
  const d = deck()
  const body0 = ids(d, 0, 'body')
  body0.style = { ...body0.style, size: 20 }
  const body1 = ids(d, 1, 'body')
  body1.style = { ...body1.style, color: '#FFFFFF' }
  const title0 = ids(d, 0, 'title')
  title0.x = SLIDE_W - 100
  d.slides[0].elements.push(imageEl([0, 0, 200, 200], { src: 'https://a/b.png', alt: '' }))
  d.slides[0].elements.push(textEl('body', [100, 500, 400, 100], {}, { html: '<p>겹침</p>' }))
  const r = checkDeck(d)
  const rules = Object.keys(r.counts)
  for (const x of ['small_text', 'too_many_bullets', 'low_contrast', 'out_of_bounds', 'overflow', 'empty_placeholder', 'no_title', 'missing_alt']) assert.ok(rules.includes(x), `${x} / ${rules}`)
  assert.ok(r.issues.every((i) => i.id && i.message && i.fix))
  assert.equal(checkDeck(d, { slides: [3] }).issues.every((i) => i.slide === 3), true)
})

test('opFixDeck: 한 번에 고침(원본 불변)', () => {
  const d = deck()
  ids(d, 1, 'body').style = { ...ids(d, 1, 'body').style, color: '#FFFFFF' }
  ids(d, 0, 'title').x = SLIDE_W - 100
  const snap = JSON.stringify(d)
  const before = checkDeck(d)
  const r = opFixDeck(d, { issues: ['auto'] })
  assert.equal(JSON.stringify(d), snap)
  assert.ok(r.result.fixed >= 3)
  const after = checkDeck(r.deck)
  for (const rule of ['low_contrast', 'out_of_bounds', 'empty_placeholder']) assert.ok(!after.counts[rule], rule)
  assert.ok(before.issues.length > after.issues.length)
  assert.throws(() => opFixDeck(d, { issues: [] }), /issues/)
  assert.throws(() => opFixDeck(d, { issues: ['overflow:9:zz'] }), /check_deck/)
})

test('opArrange', () => {
  const d = deck()
  const els = [textEl('', [100, 100, 200, 100], {}, { html: 'a' }), textEl('', [500, 300, 200, 100], {}, { html: 'b' }), textEl('', [1000, 600, 200, 100], {}, { html: 'c' })]
  d.slides[0].elements.push(...els)
  const r = opArrange(d, { slide: 1, ids: els.map((e) => e.id), op: 'align_left' })
  const xs = r.deck.slides[0].elements.filter((e) => els.some((x) => x.id === e.id)).map((e) => e.x)
  assert.deepEqual([...new Set(xs)], [100])
  const rr = opArrange(d, { slide: 1, ids: els.map((e) => e.id), op: 'stack_row', gap: 40 })
  const b = rr.deck.slides[0].elements.filter((e) => els.some((x) => x.id === e.id)).sort((p, q) => p.x - q.x)
  assert.equal(b[1].x - (b[0].x + b[0].w), 40)
  assert.equal(new Set(b.map((e) => e.y)).size, 1)
  assert.throws(() => opArrange(d, { slide: 1, ids: ['nope'], op: 'tidy' }), /read_slide/)
  assert.throws(() => opArrange(d, { slide: 1, ids: [els[0].id, els[1].id], op: 'distribute_h' }), /3개/)
  assert.throws(() => opArrange(d, { slide: 1, ids: [els[0].id], op: 'zzz' }), /op/)
})

test('add_image 는 https 만, add_table, add_shape, 배경, 복제, 전환, 글 모양', () => {
  const d = deck()
  assert.throws(() => opAddImage(d, { slide: 1, url: 'http://a/b.png' }), /https/)
  assert.throws(() => opAddImage(d, { slide: 1, url: 'javascript:alert(1)' }), /https/)
  assert.equal(opAddImage(d, { slide: 1, url: 'https://a/b.png', alt: '그림' }).deck.slides[0].elements.at(-1).data.alt, '그림')
  const t = opAddTable(d, { slide: 2, rows: [['이름', '값'], ['가', 1], ['나']] })
  const tbl = t.deck.slides[1].elements.at(-1)
  assert.equal(tbl.type, 'table')
  assert.deepEqual(tbl.data.rows[2], ['나', ''])
  assert.throws(() => opAddTable(d, { slide: 2, rows: 'x' }), /rows/)
  assert.throws(() => opAddShape(d, { slide: 1, shape: 'star' }), /shape/)
  assert.throws(() => opAddShape(d, { slide: 1, fill: 'red' }), /fill/)
  assert.equal(opAddShape(d, { slide: 1, shape: 'ellipse', fill: '@accent' }).deck.slides[0].elements.at(-1).data.shape, 'ellipse')
  assert.equal(opSetBackground(d, { slide: 1, color: '#112233' }).deck.slides[0].background.color, '#112233')
  assert.ok(/대비/.test(opSetBackground(d, { slide: 1, color: '#111111' }).result.note))
  assert.throws(() => opSetBackground(d, { slide: 1, color: 'blue' }), /색/)
  const dup = opDuplicateSlide(d, { slide: 1 })
  assert.equal(dup.deck.slides.length, 5)
  assert.notEqual(dup.deck.slides[1].id, d.slides[0].id)
  assert.equal(opSetTransition(d, { all_slides: true, transition: 'fade' }).deck.slides.every((s) => s.transition === 'fade'), true)
  assert.throws(() => opSetTransition(d, { slide: 1, transition: 'spin' }), /transition/)
  const st = opStyleText(d, { slide: 1, element: 'body', size_pt: 24, bold: true })
  assert.equal(ids(st.deck, 0, 'body').style.size, 48)
  assert.throws(() => opStyleText(d, { slide: 1, element: 'zzz', size_pt: 24 }), /글 상자/)
  assert.throws(() => opStyleText(d, { slide: 1, element: 'body' }), /하나는/)
})

test('createSlideTools: check_deck 과 fix_deck 은 한 번에 적용', async () => {
  let cur = deck()
  const applied = []
  const host = { getDeck: () => cur, getCur: () => 0, getSel: () => [], canEdit: () => true, apply: (next) => { applied.push(next); const h = { before: cur, after: next }; cur = next; return h }, revert: () => {} }
  const tools = Object.fromEntries(createSlideTools(host).map((t) => [t.name, t]))
  const c = await tools.check_deck.run({})
  assert.ok(c.result.total > 0 && c.result.auto_fixable > 0)
  const f = await tools.fix_deck.run({ issues: ['auto'] })
  assert.equal(applied.length, 1)
  assert.ok(f.undo)
  const rd = await tools.read_slide.run({ index: 3 })
  const body = rd.result.elements.find((e) => e.role === 'body')
  assert.ok('pt' in body && 'lines' in body)
})
