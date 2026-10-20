// node --test client/src/pages/slides/__tests__/aiSlideTools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSlide, newDeck } from '../deckCore.js'
import {
  compactDeck, compactSlide, createSlideTools, htmlToText, opAddSlide, opDeleteSlide, opEditText, opFixTypos, opMoveSlide, opOutline, opRestyle,
  opSetNotes, parseNewLines, retextHtml, slideTitle,
} from '../aiSlideTools.js'
import { buildSlideContext, SLIDE_QUICK_ACTIONS } from '../aiSlidePrompts.js'

const P = (t) => `<p>${t}</p>`
function deck3() {
  return newDeck('basic', [
    makeSlide('title', { title: P('분기 보고'), subtitle: P('김하나') }),
    makeSlide('title-body', { title: P('현황'), body: '<ul><li>매출 <b>증가</b></li><li>고객 만족</li></ul>', notes: '인사' }),
    makeSlide('two-col', { title: P('비교'), col1: P('왼쪽'), col2: P('오른쪽') }),
  ])
}
const el = (deck, i, role) => deck.slides[i].elements.find((e) => e.role === role)

test('htmlToText: 목록과 문단, 엔티티', () => {
  assert.equal(htmlToText('<ul><li>a &amp; b</li><li>c<ul><li>d</li></ul></li></ul>'), '- a & b\n- c\n  - d')
  assert.equal(htmlToText('<p>한 줄</p><p><br></p><p>다음</p>'), '한 줄\n\n다음')
  assert.equal(htmlToText(''), '')
})

test('parseNewLines: 불릿 해석', () => {
  assert.deepEqual(parseNewLines('\n- 가\n  - 나\n1. 다\n끝\n').map((l) => [l.text, l.list, l.level]), [['가', true, 0], ['나', true, 1], ['다', true, 0], ['끝', false, 0]])
})

test('retextHtml: 줄 수가 같으면 바뀐 줄만 고치고 서식을 남긴다', () => {
  const old = '<ul><li>매출 <b>증가</b></li><li>고객 만족</li></ul>'
  // 마지막 줄만 바뀌면 첫 줄 HTML(굵게)은 그대로
  const r2 = retextHtml(old, '- 매출 증가\n- 고객 만족도')
  assert.ok(r2.includes('<li>매출 <b>증가</b></li>'), r2)
  assert.ok(r2.includes('<li>고객 만족도</li>'))
})

test('retextHtml: 모델이 준 글의 태그는 글자로 나온다(HTML 주입 없음)', () => {
  const r = retextHtml('<p>a</p>', '<img src=x onerror=alert(1)><script>x</script>')
  assert.ok(!/<img|<script/i.test(r), r)
  assert.ok(r.includes('&lt;img'))
})

test('retextHtml: 첫 글자 서식(굵게+색)을 새 글에 입힌다', () => {
  const old = '<p><span style="color: #ff0000"><b>제목</b></span></p>'
  const r = retextHtml(old, '새 제목입니다 하나\n둘째 줄')
  assert.equal(r, '<p><span style="color: #ff0000"><b>새 제목입니다 하나</b></span></p><p><span style="color: #ff0000"><b>둘째 줄</b></span></p>')
})

test('retextHtml: 링크는 이어받지 않는다', () => {
  const r = retextHtml('<p><a href="https://a.com">링크</a></p>', '다른 글\n둘째')
  assert.ok(!r.includes('<a'), r)
})

test('retextHtml: 빈 본문에 불릿이면 목록, 제목류는 목록 만들지 않음', () => {
  assert.equal(retextHtml('', '- 가\n- 나'), '<ul><li>가</li><li>나</li></ul>')
  assert.equal(retextHtml('', '1. 가\n2. 나'), '<ol><li>가</li><li>나</li></ol>')
  assert.equal(retextHtml('<p>x</p>', '- 제목처럼', 'replace', { allowList: false }), '<p>제목처럼</p>')
})

test('retextHtml: append 는 목록 끝에 항목, 문단 뒤에 문단', () => {
  assert.equal(retextHtml('<ul><li>a</li></ul>', '- b', 'append'), '<ul><li>a</li><li>b</li></ul>')
  assert.equal(retextHtml('<p>a</p>', 'b', 'append'), '<p>a</p><p>b</p>')
  assert.equal(retextHtml('<p>a</p>', '', 'append'), '<p>a</p>')
})

test('opEditText: 역할 이름으로 바꾸고 새 객체를 돌려준다(원본 불변)', () => {
  const d = deck3()
  const before = JSON.stringify(d)
  const r = opEditText(d, { slide: 1, element: 'title', text: '새 제목' })
  assert.equal(JSON.stringify(d), before)
  assert.equal(htmlToText(el(r.deck, 0, 'title').data.html), '새 제목')
  assert.equal(r.deck.slides[1], d.slides[1])
  assert.equal(r.result.changed, 1)
})

test('opEditText: 요소 생략 시 선택 요소, 본문', () => {
  const d = deck3()
  const sel = el(d, 1, 'title').id
  const r = opEditText(d, { slide: 2, text: '고침' }, { sel: [sel] })
  assert.equal(htmlToText(el(r.deck, 1, 'title').data.html), '고침')
  const r2 = opEditText(d, { slide: 2, text: '- 가\n- 나' })
  assert.equal(htmlToText(el(r2.deck, 1, 'body').data.html), '- 가\n- 나')
})

test('opEditText: 잘못된 입력은 한국어 오류', () => {
  const d = deck3()
  assert.throws(() => opEditText(d, { slide: 0, text: 'x' }), /1부터 3/)
  assert.throws(() => opEditText(d, { slide: 4, text: 'x' }), /1부터 3/)
  assert.throws(() => opEditText(d, { slide: 1.5, text: 'x' }), /1부터 3/)
  assert.throws(() => opEditText(d, { slide: 1, text: 5 }), /글이어야/)
  assert.throws(() => opEditText(d, { slide: 1, element: 'nope', text: 'x' }), /찾지 못/)
  assert.throws(() => opEditText(d, { slide: 1, text: 'x', mode: 'zap' }), /mode/)
  assert.throws(() => opEditText(d, { slide: 1, element: 'title', text: 'x'.repeat(9000) }), /너무 깁니다/)
  const locked = deck3()
  el(locked, 0, 'title').locked = true
  assert.throws(() => opEditText(locked, { slide: 1, element: 'title', text: 'x' }), /잠겨/)
})

test('opEditText: 같은 글이면 noop', () => {
  const d = deck3()
  const r = opEditText(d, { slide: 1, element: 'title', text: '분기 보고' })
  assert.equal(r.noop, true)
})

test('opFixTypos: 여러 곳을 한 번에, 틀린 항목은 건너뛴다', () => {
  const d = deck3()
  const r = opFixTypos(d, { fixes: [{ slide: 1, element: 'title', text: '분기 보고서' }, { slide: 3, element: 'col1', text: '왼쪽입니다' }, { slide: 9, element: 'title', text: 'x' }] })
  assert.equal(r.result.changed, 2)
  assert.deepEqual(r.result.slides, [1, 3])
  assert.equal(r.result.skipped.length, 1)
  assert.equal(htmlToText(el(r.deck, 2, 'col1').data.html), '왼쪽입니다')
  assert.throws(() => opFixTypos(d, { fixes: [] }), /fixes/)
  assert.throws(() => opFixTypos(d, {}), /fixes/)
})

test('opFixTypos: 굵게가 섞인 목록의 다른 줄만 고친다', () => {
  const d = deck3()
  const r = opFixTypos(d, { fixes: [{ slide: 2, element: 'body', text: '- 매출 증가\n- 고객 만족도' }] })
  const html = el(r.deck, 1, 'body').data.html
  assert.ok(html.includes('<b>증가</b>') && html.includes('고객 만족도'), html)
})

test('opSetNotes: 바꾸기/덧붙이기', () => {
  const d = deck3()
  assert.equal(opSetNotes(d, { slide: 2, text: '새 노트' }).deck.slides[1].notes, '새 노트')
  assert.equal(opSetNotes(d, { slide: 2, text: '추가', mode: 'append' }).deck.slides[1].notes, '인사\n추가')
  assert.throws(() => opSetNotes(d, { slide: 2, text: 'x'.repeat(20001) }), /너무 깁니다/)
})

test('opAddSlide: 레이아웃별 채우기, 위치, 검증', () => {
  const d = deck3()
  const r = opAddSlide(d, { after: 1, layout: 'title-body', title: '새 장', body: ['하나', '둘', '셋'], notes: '노트' })
  assert.equal(r.deck.slides.length, 4)
  assert.equal(r.cur, 1)
  const s = r.deck.slides[1]
  assert.equal(htmlToText(s.elements.find((e) => e.role === 'body').data.html), '- 하나\n- 둘\n- 셋')
  assert.equal(s.notes, '노트')
  const end = opAddSlide(d, { layout: 'big-number', title: '매출', number: '72%', caption: '전년 대비' })
  assert.equal(end.cur, 3)
  assert.equal(htmlToText(el(end.deck, 3, 'number').data.html), '72%')
  const q = opAddSlide(d, { after: 0, layout: 'quote', quote: '인용문', body: ['말한 사람'] })
  assert.equal(q.cur, 0)
  assert.equal(htmlToText(el(q.deck, 0, 'caption').data.html), '말한 사람')
  const two = opAddSlide(d, { layout: 'two-col', title: 't', left: ['a'], right: ['b', 'c'] })
  assert.equal(htmlToText(el(two.deck, 3, 'col2').data.html), '- b\n- c')
  assert.throws(() => opAddSlide(d, { layout: 'nope' }), /layout/)
  assert.throws(() => opAddSlide(d, { layout: 'title', after: 9 }), /after/)
  assert.throws(() => opAddSlide(d, { layout: 'title', variant: 9 }), /variant/)
  assert.throws(() => opAddSlide(d, { layout: 'image-text', image_url: 'javascript:alert(1)' }), /http/)
  const img = opAddSlide(d, { layout: 'image-text', title: 'x', image_url: 'https://example.com/a.png' })
  assert.equal(el(img.deck, 3, 'image').data.src, 'https://example.com/a.png')
})

test('opAddSlide: 모델 글의 HTML 은 글자로 이스케이프', () => {
  const r = opAddSlide(deck3(), { layout: 'title', title: '<img src=x onerror=1>' })
  const html = el(r.deck, 3, 'title').data.html
  assert.ok(!html.includes('<img'))
})

test('opDeleteSlide / opMoveSlide', () => {
  const d = deck3()
  const del = opDeleteSlide(d, { slide: 2 })
  assert.equal(del.deck.slides.length, 2)
  assert.equal(del.cur, 1)
  assert.ok(del.summary.includes('2번'))
  const mv = opMoveSlide(d, { slide: 1, to: 3 })
  assert.equal(mv.deck.slides[2].id, d.slides[0].id)
  assert.equal(mv.cur, 2)
  assert.equal(opMoveSlide(d, { slide: 2, to: 2 }).noop, true)
  assert.throws(() => opMoveSlide(d, { slide: 1, to: 9 }), /번호/)
  assert.throws(() => opDeleteSlide(newDeck('basic', []), { slide: 1 }), /슬라이드가 없/)
})

test('opOutline: 해석기 재사용, 노트·이미지·숫자·인용', () => {
  const d = deck3()
  const md = '# 발표 제목\n부제\n\n## 문제\n- 하나\n- 둘\n노트: 말할 것\n\n## 72%\n설명\n\n## 그림\nhttps://example.com/a.png\n\n## 인용\n> 말씀'
  const r = opOutline(d, { outline: md, mode: 'append' })
  const made = r.deck.slides.slice(3)
  assert.equal(made.length, 5)
  assert.equal(made[0].layout, 'title')
  assert.equal(made[1].layout, 'title-body')
  assert.equal(made[1].notes, '말할 것')
  assert.equal(made[2].layout, 'big-number')
  assert.equal(made[3].layout, 'image-text')
  assert.equal(made[3].elements.find((e) => e.type === 'image').data.src, 'https://example.com/a.png')
  assert.equal(made[4].layout, 'quote')
  assert.equal(r.cur, 3)
  const rep = opOutline(d, { outline: '# 새\n## 하나', mode: 'replace', theme: 'night' })
  assert.equal(rep.deck.slides.length, 2)
  assert.equal(rep.deck.theme.id, 'night')
  assert.throws(() => opOutline(d, { outline: '# x', theme: 'neon' }), /theme/)
  assert.throws(() => opOutline(d, { outline: '   ' }), /비어/)
  assert.throws(() => opOutline(d, { outline: '# x', mode: 'x' }), /mode/)
  assert.throws(() => opOutline(d, { outline: Array.from({ length: 90 }, (_, i) => `## s${i}`).join('\n') }), /80장/)
})

test('opOutline: javascript 이미지 주소는 이미지 슬라이드가 되지 않는다', () => {
  const r = opOutline(newDeck('basic', []), { outline: '## a\njavascript:alert(1)\n![x](javascript:alert(1))' })
  for (const s of r.deck.slides) for (const e of s.elements) if (e.type === 'image') assert.ok(!/javascript/i.test(e.data.src))
})

test('opRestyle: 테마, 변형, 전체', () => {
  const d = deck3()
  const t = opRestyle(d, { theme: 'night' })
  assert.equal(t.deck.theme.id, 'night')
  assert.equal(JSON.stringify(t.deck.slides), JSON.stringify(d.slides))
  const v = opRestyle(d, { slide: 2, variant: 2 }, { cur: 0 })
  assert.equal(v.deck.slides[1].variant, 2)
  assert.equal(htmlToText(el(v.deck, 1, 'title').data.html), '현황')
  assert.equal(htmlToText(el(v.deck, 1, 'body').data.html), '- 매출 증가\n- 고객 만족')
  const all = opRestyle(d, { all_slides: true, variant: 1 })
  assert.ok(all.deck.slides.every((s) => s.variant === 1))
  const same = opRestyle(d, { theme: 'basic' })
  assert.equal(same.noop, true)
  const lay = opRestyle(d, { slide: 3, layout: 'title-body' })
  assert.equal(lay.deck.slides[2].layout, 'title-body')
  assert.throws(() => opRestyle(d, { theme: 'x' }), /theme/)
  assert.throws(() => opRestyle(d, { layout: 'x' }), /layout/)
  assert.throws(() => opRestyle(d, { variant: -1 }), /variant/)
})

test('compactDeck: 훑어보기와 자세히, 크기 제한', () => {
  const d = deck3()
  const c = compactDeck(d)
  assert.equal(c.total, 3)
  assert.equal(c.slides[1].title, '현황')
  assert.deepEqual(c.slides[1].text, ['- 매출 증가', '- 고객 만족'])
  assert.equal(c.slides[1].notes, '인사')
  const det = compactDeck(d, [2, 9, 2])
  assert.equal(det.slides.length, 1)
  assert.ok(det.slides[0].elements.every((e) => e.id && e.box.length === 4))
  const big = newDeck('basic', Array.from({ length: 200 }, (_, i) => makeSlide('title-body', { title: P(`제목 ${i}`), body: `<ul>${Array.from({ length: 6 }, (_, k) => `<li>${'가'.repeat(100)}${k}</li>`).join('')}</ul>` })))
  assert.ok(JSON.stringify(compactDeck(big)).length < 30000)
  assert.equal(slideTitle(d.slides[0]), '분기 보고')
  assert.equal(compactSlide(d.slides[1], 2).notes, '인사')
})

test('buildSlideContext', () => {
  const d = deck3()
  const sel = [el(d, 1, 'title').id]
  const t = buildSlideContext({ deck: d, cur: 1, sel })
  assert.ok(t.includes('2/3번') && t.includes('현황') && t.includes('title-body') && t.includes('노트 있음') && t.includes(sel[0]))
  assert.ok(buildSlideContext({ deck: newDeck('basic', []) }).includes('슬라이드가 없다'))
  assert.equal(SLIDE_QUICK_ACTIONS.length, 7)
})

test('createSlideTools: host 를 거쳐 한 번 적용하고 undo 를 돌려준다', async () => {
  let deck = deck3()
  const applied = []
  const host = {
    getDeck: () => deck, getCur: () => 0, getSel: () => [], canEdit: () => true, clean: (x) => x,
    apply: (next) => { const before = deck; deck = next; applied.push(next); return { before, after: next } },
    revert: (h) => { deck = h.before },
  }
  const tools = Object.fromEntries(createSlideTools(host).map((t) => [t.name, t]))
  for (const n of ['add_slide', 'create_deck_from_outline', 'delete_slide', 'edit_slide_text', 'fix_typos', 'move_slide', 'read_deck', 'read_slide', 'restyle', 'set_notes', 'check_deck', 'fix_deck', 'arrange_elements', 'style_text', 'add_shape', 'add_image', 'add_table', 'set_background', 'duplicate_slide', 'set_transition']) assert.ok(tools[n], n)
  assert.ok(Object.keys(tools).length <= 24)
  for (const t of Object.values(tools)) assert.ok(t.parameters.type === 'object' && t.description.length > 10)
  const r = await tools.fix_typos.run({ fixes: [{ slide: 1, element: 'title', text: '분기 보고서' }, { slide: 3, element: 'title', text: '비교표' }] })
  assert.equal(applied.length, 1)
  assert.equal(r.result.changed, 2)
  assert.equal(typeof r.undo, 'function')
  r.undo()
  assert.equal(htmlToText(el(deck, 0, 'title').data.html), '분기 보고')
  const bad = await tools.edit_slide_text.run({ slide: 99, text: 'x' })
  assert.equal(bad.result.ok, false)
  assert.equal(bad.undo, undefined)
  const rd = await tools.read_slide.run({ index: 2 })
  assert.equal(rd.result.title, '현황')
  const nothing = await tools.edit_slide_text.run({ slide: 1, element: 'title', text: '분기 보고' })
  assert.equal(nothing.undo, undefined)
  const ro = createSlideTools({ ...host, canEdit: () => false }).find((t) => t.name === 'set_notes')
  assert.equal((await ro.run({ slide: 1, text: 'x' })).result.ok, false)
})
