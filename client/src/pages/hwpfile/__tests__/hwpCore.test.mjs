import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyLocalEdit, changedBlocksOf, pairDiffs, chunkRange, cleanText, createHistory, editability, errorText, estimateFontPx, findCell, fitScale, hitTest, indexBlocks, isBlockId, isCellId,
  lintFixFor, lintFixOps, makeEditOp, nearPages, parseCellId, pickFilled, regionRect, regionsOf, summarizeEdit, textOfSel,
} from '../hwpCore.js'

const R = (id, x, y, w, h, extra = {}) => ({ id, type: 'paragraph', bbox: { x, y, width: w, height: h }, ...extra })

const blocks = indexBlocks([
  { id: 'b1', index: 0, type: 'heading', level: 1, text: '제목', editable: 'text' },
  { id: 'b2', index: 1, type: 'paragraph', text: '본문 첫 줄\n둘째 줄', editable: 'text' },
  { id: 'b3', index: 2, type: 'image', editable: 'locked', reason: '그림' },
  {
    id: 'b4', index: 3, type: 'table', editable: 'cell-text',
    table: {
      rows: 2, cols: 2,
      cells: [
        [{ id: 'b4#r0c0', row: 0, col: 0, rowSpan: 1, colSpan: 2, text: '머리', editable: true }, { covered: 'b4#r0c0' }],
        [{ id: 'b4#r1c0', row: 1, col: 0, text: '가', editable: true }, { id: 'b4#r1c1', row: 1, col: 1, text: '나', editable: false, reason: '잠긴 칸' }],
      ],
    },
  },
])

test('hitTest: 가장 안쪽 영역, 칸이 표보다 먼저, block 없는 영역은 건너뜀', () => {
  const regions = [R('table', 0, 0, 200, 100, { type: 'table', block: 'b4' }), R('cell', 10, 10, 80, 30, { block: 'b4', cell: 'b4#r1c0' }), R('p', 0, 120, 200, 20, { block: 'b2' }), R('deco', 0, 0, 500, 500)]
  assert.equal(hitTest(regions, 20, 20).cell, 'b4#r1c0')
  assert.equal(hitTest(regions, 150, 80).id, 'table')
  assert.equal(hitTest(regions, 50, 130).block, 'b2')
  assert.equal(hitTest(regions, 300, 300), null)
  assert.equal(hitTest([], 1, 1), null)
  assert.equal(hitTest(undefined, 1, 1), null)
})

test('hitTest: 겹치면 더 작은 영역', () => {
  const regions = [R('big', 0, 0, 100, 100, { block: 'b1' }), R('small', 10, 10, 20, 20, { block: 'b2' })]
  assert.equal(hitTest(regions, 15, 15).id, 'small')
})

test('regionRect / regionsOf', () => {
  assert.deepEqual(regionRect(R('a', 10, 20, 30, 40), 2), { left: 20, top: 40, width: 60, height: 80 })
  const rs = [R('a', 0, 0, 1, 1, { block: 'b2' }), R('b', 0, 0, 1, 1, { block: 'b4', cell: 'b4#r1c0' }), R('c', 0, 0, 1, 1, { block: 'b4' })]
  assert.equal(regionsOf(rs, { block: 'b2' }).length, 1)
  assert.equal(regionsOf(rs, { block: 'b4', cell: 'b4#r1c0' })[0].id, 'b')
  assert.equal(regionsOf(rs, { block: 'b4' })[0].id, 'c')
  assert.deepEqual(regionsOf(rs, null), [])
})

test('id 형식 검사와 칸 id 풀이', () => {
  assert.ok(isBlockId('b12'))
  assert.ok(!isBlockId('12'))
  assert.ok(!isBlockId('b12#r1c1'))
  assert.ok(isCellId('b12#r2c1'))
  assert.ok(!isCellId('b12'))
  assert.deepEqual(parseCellId('b12#r2c1'), { table: 'b12', row: 2, col: 1 })
  assert.equal(parseCellId('x'), null)
})

test('cleanText: 줄바꿈 통일, 제어문자 제거, 길이 제한, 비문자열 거부', () => {
  assert.equal(cleanText('a\r\nb\rc\u0007d'), 'a\nb\ncd')
  assert.equal(cleanText('abcdef', 3), 'abc')
  assert.equal(cleanText(12), null)
  assert.equal(cleanText(null), null)
})

test('textOfSel / findCell / editability', () => {
  assert.equal(textOfSel(blocks, { block: 'b2' }), '본문 첫 줄\n둘째 줄')
  assert.equal(textOfSel(blocks, { block: 'b4', cell: 'b4#r1c0' }), '가')
  assert.equal(textOfSel(blocks, { block: 'b4' }), null)
  assert.equal(textOfSel(blocks, { block: 'zz' }), null)
  assert.equal(findCell(blocks.get('b4'), 'b4#r0c0').text, '머리')
  assert.equal(findCell(blocks.get('b4'), 'nope'), null)
  assert.ok(editability(blocks, { block: 'b2' }).ok)
  assert.ok(editability(blocks, { block: 'b4', cell: 'b4#r1c0' }).ok)
  assert.equal(editability(blocks, { block: 'b4', cell: 'b4#r1c1' }).reason, '잠긴 칸')
  assert.match(editability(blocks, { block: 'b4' }).reason, /칸/)
  assert.ok(!editability(blocks, { block: 'b3' }).ok)
  assert.ok(!editability(blocks, { block: 'nope' }).ok)
})

test('makeEditOp: 블록은 replace_block, 칸은 replace_cell, expect 는 지금 글', () => {
  assert.deepEqual(makeEditOp(blocks, { block: 'b2' }, '새 글'), { type: 'replace_block', block: 'b2', text: '새 글', expect: '본문 첫 줄\n둘째 줄' })
  assert.deepEqual(makeEditOp(blocks, { block: 'b4', cell: 'b4#r1c0' }, '다'), { type: 'replace_cell', table: 'b4', row: 1, col: 0, text: '다', expect: '가' })
  assert.equal('expect' in makeEditOp(blocks, { block: 'b2' }, 'x', { expect: false }), false)
  assert.throws(() => makeEditOp(blocks, { block: 'b2' }, 5))
  assert.equal(makeEditOp(blocks, { block: 'b2' }, 'a\r\nb').text, 'a\nb')
})

test('applyLocalEdit: 원본 Map 은 그대로, 칸만 바뀜', () => {
  const next = applyLocalEdit(blocks, { block: 'b4', cell: 'b4#r1c0' }, '새')
  assert.equal(findCell(next.get('b4'), 'b4#r1c0').text, '새')
  assert.equal(findCell(blocks.get('b4'), 'b4#r1c0').text, '가')
  assert.equal(findCell(next.get('b4'), 'b4#r1c1').text, '나')
  const n2 = applyLocalEdit(blocks, { block: 'b2' }, 'z')
  assert.equal(n2.get('b2').text, 'z')
  assert.equal(blocks.get('b2').text, '본문 첫 줄\n둘째 줄')
  assert.equal(applyLocalEdit(blocks, { block: 'nope' }, 'x'), blocks)
})

test('버전 기록: 고치면 쌓고 다시 실행은 비움', () => {
  const h = createHistory()
  assert.ok(!h.canUndo() && !h.canRedo())
  h.record(1) // 1 -> 2
  h.record(2) // 2 -> 3
  assert.ok(h.canUndo())
  assert.equal(h.undo(3), 2) // 화면은 v2 로. 현재 3 은 다시 실행에
  assert.ok(h.canRedo())
  assert.equal(h.undo(4), 1) // 복원으로 만든 v4 에서 한 번 더
  assert.equal(h.redo(5), 4)
  h.record(7)
  assert.ok(!h.canRedo())
  assert.equal(h.undo(8), 7)
  assert.equal(h.undo(9), 5)
})

test('버전 기록: 비었을 때와 null', () => {
  const h = createHistory()
  assert.equal(h.undo(1), null)
  assert.equal(h.redo(1), null)
  h.record(null)
  assert.ok(!h.canUndo())
  h.clear()
  assert.deepEqual(h.snapshot(), { undo: [], redo: [] })
})

test('summarizeEdit / errorText', () => {
  assert.equal(summarizeEdit({ applied: [{}, {}], skipped: [{}] }), '2곳 고침, 1곳 건너뜀')
  assert.equal(summarizeEdit({ applied: [{}], skipped: [] }, { dry: true }), '1곳이 바뀔 예정')
  assert.equal(summarizeEdit({}), '바뀐 곳이 없습니다')
  assert.equal(errorText({ code: 'VERSION_CONFLICT', message: '' }), '다른 곳에서 먼저 고쳤습니다. 최신 내용으로 다시 불러옵니다')
  assert.equal(errorText({ message: '직접 메시지' }), '직접 메시지')
  assert.equal(errorText({ message: '[object Object]', code: 'ENCRYPTED' }).includes('암호'), true)
  assert.equal(errorText(null), '처리하지 못했습니다')
})

test('changedBlocksOf / chunkRange / nearPages / fitScale', () => {
  const m = changedBlocksOf({ diffs: [{ type: 'modified', block: 'b1' }, { type: 'added', block: 'b9' }, { type: 'modified' }] })
  assert.equal(m.size, 2)
  assert.equal(m.get('b9'), 'added')
  assert.deepEqual(chunkRange(1, 7, 3), [[1, 3], [4, 6], [7, 7]])
  assert.deepEqual(nearPages(1, 5, 1), [1, 2])
  assert.deepEqual(nearPages(5, 5, 2), [3, 4, 5])
  assert.equal(fitScale('width', 800, 600, 400, 800, 0), 2)
  assert.equal(fitScale('page', 800, 600, 400, 800, 0), 0.75)
})

test('estimateFontPx: 줄 수에 따라 줄고 10~30 안', () => {
  const one = estimateFontPx({ height: 20 }, '한 줄', 1.333)
  const three = estimateFontPx({ height: 20 }, '가\n나\n다', 1.333)
  assert.ok(one >= three)
  assert.ok(one >= 10 && one <= 30)
  assert.equal(estimateFontPx({ height: 1000 }, 'a', 2), 30)
})

test('pickFilled: 빈 값 제외, 배열 정리, 길이 제한', () => {
  assert.deepEqual(pickFilled({ 성명: ' 홍길동', 주소: '', 연락처: ['010', '', '02'] }), { 성명: ' 홍길동', 연락처: ['010', '02'] })
  assert.deepEqual(pickFilled(null), {})
})

test('lintFixFor: 서버 suggest(설명용 예시)는 쓰지 않고 이쪽 규칙으로 고친 글을 만든다', () => {
  const bl = indexBlocks([
    { id: 'b1', type: 'paragraph', text: '기한: 2026.09.01 까지' },
    { id: 'b2', type: 'paragraph', text: '이미 맞는 글' },
    { id: 'b3', type: 'table', table: { rows: 1, cols: 1, cells: [[{ id: 'b3#r0c0', row: 0, col: 0, text: '일시 : 2026.9.1', editable: true }]] } },
  ])
  const f = { block: 'b1', rule: 'DATE_NO_SPACE', match: '2026.09.01', suggest: '예) 2025. 1. 6.' }
  assert.deepEqual(lintFixFor(f, bl), { type: 'replace_block', block: 'b1', text: '기한: 2026. 9. 1. 까지', expect: '기한: 2026.09.01 까지' })
  assert.equal(lintFixFor({ block: 'b2', rule: 'DATE_NO_SPACE' }, bl), null, '고칠 것이 없으면 null')
  assert.equal(lintFixFor({ block: 'b1', rule: 'MONEY_NO_HANGUL' }, bl), null, '자동으로 못 고치는 규칙은 null')
  assert.equal(lintFixFor({ block: 'b9', rule: 'DATE_NO_SPACE' }, bl), null)
  assert.equal(lintFixFor(null, bl), null)
  const c = lintFixFor({ block: 'b3', cell: 'b3#r0c0', rule: 'COLON_SPACE' }, bl)
  assert.deepEqual(c, { type: 'replace_cell', table: 'b3', row: 0, col: 0, text: '일시: 2026.9.1', expect: '일시 : 2026.9.1' })
  assert.equal(lintFixOps([f, { ...f, rule: 'DATE_ZERO_PAD' }, { block: 'b3', cell: 'b3#r0c0', rule: 'COLON_SPACE' }], bl).length, 2, '같은 블록은 한 번만')
})

test('pairDiffs: 같은 블록의 removed+added 는 modified 한 줄로', () => {
  const p = pairDiffs([{ type: 'removed', block: 'b1', before: '옛', after: null }, { type: 'added', block: 'b1', before: null, after: '새' }, { type: 'added', block: 'b2', after: 'x' }, { type: 'removed', block: 'b3', before: 'y' }])
  assert.deepEqual(p.map((d) => d.type), ['modified', 'added', 'removed'])
  assert.deepEqual([p[0].before, p[0].after], ['옛', '새'])
  assert.deepEqual(pairDiffs(null), [])
})
