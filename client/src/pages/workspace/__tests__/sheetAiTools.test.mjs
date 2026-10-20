// node --test client/src/pages/workspace/__tests__/sheetAiTools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSheetTools } from '../aiSheetTools.js'
import { QUICK_ACTIONS, buildSystemPrompt, compactFunctionList } from '../aiSheetPrompts.js'
import * as formulaEngine from '../../../components/admin/sheet/formula.js'
import { makeEngine } from '../../../components/admin/sheet/sheetEngine.js'
import { matrixOf } from '../../../components/admin/sheet/sheetModel.js'

const blank = (id, label, cols = 6, rows = 12) => ({
  id,
  label,
  columns: Array.from({ length: cols }, (_, i) => ({ key: `c${i}`, label: `열 ${i + 1}`, width: 140 })),
  rows: Array.from({ length: rows }, (_, i) => ({ id: i + 1, cells: {} })),
  nextId: rows + 1,
})

function makeHost(engineOverride) {
  const box = { state: { sheets: [blank('s1', '시트1'), blank('s2', '시트2')], nextSheet: 3, ui: {}, activeId: 's1' }, history: [], selection: null, canEdit: true }
  const host = {
    engine: engineOverride || makeEngine(formulaEngine),
    getState: () => box.state,
    getSelection: () => box.selection || { sheetId: box.state.activeId, range: null, active: null, filtered: false },
    select: (sid, g) => { box.selected = { sid, g } },
    editBlock: () => (box.canEdit ? '' : '보기 전용'),
    applyState: (next, label) => {
      const before = box.state
      box.state = { ...next, activeId: next.activeId || before.activeId }
      const entry = { label, before }
      box.history.push(entry)
      return () => { box.state = entry.before }
    },
  }
  const t = createSheetTools(host)
  const byName = Object.fromEntries(t.tools.map((x) => [x.name, x]))
  const call = (name, args) => byName[name].run(args)
  return { box, host, tools: t, call, byName }
}
const grid = (box, range = 'A1:F6', sheet = 0) => {
  const s = box.state.sheets[sheet]
  const { parseRange } = globalThis.__M
  return matrixOf(box.state, s, parseRange(range))
}
globalThis.__M = await import('../../../components/admin/sheet/sheetModel.js')

async function seed(h) {
  await h.call('write_cells', {
    cells: [
      { ref: 'A1', value: '지역' },
      { ref: 'B1', value: '품목' },
      { ref: 'C1', value: '금액' },
      { ref: 'A2', values: [['서울', '사과', 1000], ['부산', '배', 2500], ['서울', '배', 1500], ['대구', '사과', 700], ['부산', '사과', 3300]] },
    ],
  })
}

test('도구 이름과 개수(서버 한도 24개 이하), 스키마 모양', () => {
  const { tools } = makeHost()
  const names = tools.tools.map((x) => x.name)
  assert.ok(names.length <= 24, `도구가 ${names.length}개`)
  for (const n of ['read_sheet', 'list_sheets', 'get_selection', 'write_cells', 'fill_range', 'insert_rows', 'insert_cols', 'delete_rows', 'delete_cols', 'sort_range', 'add_sheet', 'rename_sheet', 'format_range', 'find_replace', 'remove_duplicates', 'split_column', 'analyze_range', 'compute', 'find_errors', 'create_table']) assert.ok(names.includes(n), n)
  for (const t of tools.tools) {
    assert.equal(t.parameters.type, 'object')
    assert.equal(typeof t.run, 'function')
    assert.ok(t.description.length > 10)
  }
  assert.equal(new Set(names).size, names.length)
})

test('write_cells: 값 형식 추론(숫자, 날짜, 불리언), 머리글, 2차원 values', async () => {
  const h = makeHost()
  const r = await h.call('write_cells', { cells: [{ ref: 'A1', value: '이름' }, { ref: 'A2', values: [['가', 10, '2026.9.21', true, '010-1234', "'007"]] }] })
  assert.equal(r.result.wrote, true)
  assert.equal(r.summary, '시트1: 7칸 입력')
  assert.deepEqual(grid(h.box, 'A1:F2')[1], ['가', '10', '2026-09-21', 'TRUE', '010-1234', '007'])
  assert.equal(h.box.state.sheets[0].columns[0].label, '이름')
  assert.ok(r.undo)
  r.undo()
  assert.equal(grid(h.box, 'A1:B2')[1][0], '')
})

test('write_cells: 값이 있는 칸은 overwrite 없이는 거부, 허락하면 쓴다', async () => {
  const h = makeHost()
  await h.call('write_cells', { cells: [{ ref: 'A2', value: '원래' }] })
  const r = await h.call('write_cells', { cells: [{ ref: 'A2', value: '새로' }] })
  assert.equal(r.result.wrote, false)
  assert.match(r.result.problems[0], /원래/)
  assert.equal(grid(h.box, 'A2:A2')[0][0], '원래')
  const r2 = await h.call('write_cells', { cells: [{ ref: 'A2', value: '새로' }], overwrite: true })
  assert.equal(r2.result.wrote, true)
  assert.equal(grid(h.box, 'A2:A2')[0][0], '새로')
})

test('write_cells: 모르는 함수는 거부하고 안내(복구 경로), 고친 수식은 통과', async () => {
  const h = makeHost()
  await seed(h)
  const bad = await h.call('write_cells', { cells: [{ ref: 'D2', formula: '=VLOOKUPX(A2,A2:C6,3,0)' }] })
  assert.equal(bad.result.wrote, false)
  assert.match(bad.result.problems[0], /VLOOKUPX/)
  assert.match(bad.result.hint, /고친 뒤/)
  assert.equal(grid(h.box, 'D2:D2')[0][0], '')
  const good = await h.call('write_cells', { cells: [{ ref: 'D2', formula: '=SUM(C2:C6)' }] })
  assert.equal(good.result.wrote, true)
  assert.equal(good.result.formulas[0].result, '9000')
})

test('write_cells: 계산 결과가 오류면 쓰기 전에 알리고 쓰지 않는다', async () => {
  const h = makeHost()
  await seed(h)
  const r = await h.call('write_cells', { cells: [{ ref: 'E2', formula: '=C2/0' }] })
  assert.equal(r.result.wrote, false)
  assert.equal(r.result.formulaErrors[0].error, '#DIV/0!')
  assert.match(r.result.formulaErrors[0].cause, /나누/)
  assert.equal(grid(h.box, 'E2:E2')[0][0], '')
  const ok = await h.call('write_cells', { cells: [{ ref: 'E2', formula: '=C2/0' }], allow_errors: true })
  assert.equal(ok.result.wrote, true)
})

test('write_cells: 1행에는 수식 불가, 잘못된 ref, 보기 전용', async () => {
  const h = makeHost()
  const a = await h.call('write_cells', { cells: [{ ref: 'A1', formula: '=1+1' }] })
  assert.equal(a.result.wrote, false)
  assert.match(a.result.problems[0], /머리글/)
  await assert.rejects(() => h.call('write_cells', { cells: [{ ref: 'A1:B2', value: 1 }] }), /칸 하나/)
  h.box.canEdit = false
  await assert.rejects(() => h.call('write_cells', { cells: [{ ref: 'A2', value: 1 }] }), /보기 전용/)
})

test('fill_range: 상대 참조를 옮겨 채우고 한 번에 되돌려진다', async () => {
  const h = makeHost()
  await seed(h)
  const r = await h.call('fill_range', { range: 'D2:D6', formula_template: '=C2*2' })
  assert.equal(r.result.wrote, true)
  assert.deepEqual(grid(h.box, 'D1:D6').map((x) => x[0]), ['열 4'.replace('열 4', ''), '=C2*2', '=C3*2', '=C4*2', '=C5*2', '=C6*2'])
  assert.equal(h.box.history.length, 2)
  r.undo()
  assert.equal(grid(h.box, 'D2:D2')[0][0], '')
  const s = await h.call('fill_range', { range: 'E2:E4', pattern: { kind: 'series', start: '2026-09-01', step: 1, unit: 'week' } })
  assert.deepEqual(grid(h.box, 'E2:E4').map((x) => x[0]), ['2026-09-01', '2026-09-08', '2026-09-15'])
})

test('read_sheet: 머리글 열 글자, 행 번호, 수식 표시, 잘림 안내', async () => {
  const h = makeHost()
  await seed(h)
  await h.call('write_cells', { cells: [{ ref: 'D2', formula: '=C2*2' }] })
  const r = await h.call('read_sheet', { range: 'A1:D3', mode: 'both' })
  const lines = r.result.grid.split('\n')
  assert.equal(lines[0], '\tA\tB\tC\tD')
  assert.equal(lines[1], '1\t지역\t품목\t금액\t')
  assert.equal(lines[2], '2\t서울\t사과\t1000\t2000 〔=C2*2〕')
  const t = await h.call('read_sheet', { range: 'A1:D6', max_cells: 8 })
  assert.equal(t.result.truncated, true)
  assert.match(t.result.grid, /A3:D6/)
  await assert.rejects(() => h.call('read_sheet', { range: 'ZZZZ' }), /읽을 수 없습니다/)
  await assert.rejects(() => h.call('read_sheet', { sheet: '없는시트' }), /있는 시트/)
})

test('analyze_range: 합계 평균 중앙값 최대는 직접 계산과 같다', async () => {
  const h = makeHost()
  await seed(h)
  const r = await h.call('analyze_range', { range: 'A1:C6' })
  const vals = [1000, 2500, 1500, 700, 3300]
  const sum = vals.reduce((a, b) => a + b, 0)
  assert.match(r.result.analysis, new RegExp(`합계 ${sum}`))
  assert.match(r.result.analysis, new RegExp(`평균 ${sum / vals.length}`))
  assert.match(r.result.analysis, /중앙값 1500/)
  assert.match(r.result.analysis, /최대 3300\(C6\)/)
  assert.match(r.result.analysis, /최소 700\(C5\)/)
  assert.match(r.result.analysis, /A "지역": text \| 값 5 \| 고유 3/)
  assert.match(r.result.analysis, /서울\(2\)/)
})

test('compute: 쓰지 않고 계산, 오류 원인', async () => {
  const h = makeHost()
  await seed(h)
  const r = await h.call('compute', { formula: '=SUM(C2:C6)/COUNT(C2:C6)' })
  assert.equal(r.result.value, '1800')
  assert.equal(grid(h.box, 'D1:D3')[1][0], '')
  const e = await h.call('compute', { formula: '=C2/0' })
  assert.equal(e.result.ok, false)
  assert.equal(e.result.error, '#DIV/0!')
  const u = await h.call('compute', { formula: '=FOOBAR(1)' })
  assert.equal(u.result.ok, false)
})

test('insert_rows / delete_rows: 수식 범위가 따라가고, 값이 있으면 확인을 요구한다', async () => {
  const h = makeHost()
  await seed(h)
  await h.call('write_cells', { cells: [{ ref: 'C8', formula: '=SUM(C2:C6)' }] })
  const ins = await h.call('insert_rows', { at: 4, count: 2 })
  assert.equal(ins.result.fixedFormulas, 1)
  assert.equal(grid(h.box, 'C10:C10')[0][0], '=SUM(C2:C8)')
  ins.undo()
  assert.equal(grid(h.box, 'C8:C8')[0][0], '=SUM(C2:C6)')
  const del = await h.call('delete_rows', { from: 3, count: 1 })
  assert.equal(del.result.needsConfirmation, true)
  assert.equal(grid(h.box, 'A3:A3')[0][0], '부산')
  const del2 = await h.call('delete_rows', { from: 3, count: 1, confirmed: true })
  assert.equal(del2.result.deleted, 1)
  assert.equal(grid(h.box, 'C7:C7')[0][0], '=SUM(C2:C5)')
  await assert.rejects(() => h.call('delete_rows', { from: 1 }), /머리글/)
})

test('sort_range: 계산값 기준 정렬, 머리글 유지, 되돌리기', async () => {
  const h = makeHost()
  await seed(h)
  const r = await h.call('sort_range', { range: 'A1:C6', by: [{ col: 'C', order: 'desc' }] })
  assert.equal(r.result.moved, true)
  assert.deepEqual(grid(h.box, 'C1:C6').map((x) => x[0]), ['금액', '3300', '2500', '1500', '1000', '700'])
  r.undo()
  assert.deepEqual(grid(h.box, 'C2:C3').map((x) => x[0]), ['1000', '2500'])
  await assert.rejects(() => h.call('sort_range', { range: 'A1:C6', by: [{ col: 'C' }], has_header: false }), /머리글/)
})

test('find_replace, remove_duplicates, split_column', async () => {
  const h = makeHost()
  await seed(h)
  const d = await h.call('find_replace', { find: '서울', replace: '서울시', dry_run: true })
  assert.equal(d.result.wouldReplace, 2)
  const f = await h.call('find_replace', { find: '서울', replace: '서울시' })
  assert.equal(f.result.replaced, 2)
  assert.equal(grid(h.box, 'A2:A2')[0][0], '서울시')
  await h.call('write_cells', { cells: [{ ref: 'A7', values: [['서울시', '사과', 1000]] }] })
  const dd = await h.call('remove_duplicates', { range: 'A1:C7', dry_run: true })
  assert.equal(dd.result.wouldRemove, 1)
  const need = await h.call('remove_duplicates', { range: 'A1:C7' })
  assert.equal(need.result.needsConfirmation, true)
  const rm = await h.call('remove_duplicates', { range: 'A1:C7', confirmed: true })
  assert.equal(rm.result.removed, 1)
  await h.call('write_cells', { cells: [{ ref: 'E2', values: [['김,철수'], ['이,영희']] }] })
  const sp = await h.call('split_column', { col: 'E', delimiter: ',', headers: ['성', '이름'] })
  assert.equal(sp.result.parts, 2)
  assert.deepEqual(grid(h.box, 'E1:F3'), [['성', '이름'], ['김', '철수'], ['이', '영희']])
})

test('format_range: 지원 서식만 적용하고 미지원은 알린다', async () => {
  const h = makeHost()
  await seed(h)
  const r = await h.call('format_range', { range: 'A2:C3', bold: true, fill: 'subtle', number_format: '#,##0', italic: true })
  assert.equal(r.result.cells, 6)
  assert.deepEqual(r.result.unsupported.sort(), ['italic', 'number_format'])
  assert.equal(Object.keys(h.box.state.ui.s1.formats).length, 6)
  await assert.rejects(() => h.call('format_range', { range: 'A2:C3', color: 'hotpink' }), /color/)
  const un = await h.call('format_range', { italic: true })
  assert.equal(un.result.changed, false)
  assert.deepEqual(un.result.unsupported, ['italic'])
  await assert.rejects(() => h.call('format_range', {}), /적용할 서식이 없습니다/)
  const w = await h.call('format_range', { freeze_cols: 1, column_widths: { B: 220 } })
  assert.equal(h.box.state.ui.s1.freezeCols, 1)
  assert.ok(w.undo)
})

test('create_table, add_sheet, rename_sheet(수식 속 이름 갱신), delete_sheet 확인', async () => {
  const h = makeHost()
  const t = await h.call('create_table', { top_left: 'A1', headers: ['항목', '수량', '단가', '합계'], rows: [['펜', 3, 500, '=B2*C2'], ['노트', 2, 1200, '=B3*C3']] })
  assert.equal(t.result.ok, true)
  assert.deepEqual(grid(h.box, 'A1:D3')[2], ['노트', '2', '1200', '=B3*C3'])
  const a = await h.call('add_sheet', { name: '집계' })
  assert.match(a.summary, /집계/)
  await assert.rejects(() => h.call('add_sheet', { name: '집계' }), /이미/)
  const d = await h.call('delete_sheet', { sheet: '집계' })
  assert.equal(d.result.needsConfirmation, true)
  const d2 = await h.call('delete_sheet', { sheet: '집계', confirmed: true })
  assert.equal(h.box.state.sheets.length, 2)
  d2.undo()
  assert.equal(h.box.state.sheets.length, 3)
})

test('find_errors / get_selection / list_sheets / getContext', async () => {
  const h = makeHost()
  await seed(h)
  await h.call('write_cells', { cells: [{ ref: 'E2', formula: '=C2/0' }, { ref: 'E3', formula: '=SUM(C2:C6)' }], allow_errors: true })
  const e = await h.call('find_errors', {})
  assert.equal(e.result.count, 1)
  assert.equal(e.result.errors[0].ref, 'E2')
  h.box.selection = { sheetId: 's1', range: { c0: 0, c1: 2, r0: 2, r1: 3 }, active: { c: 0, r: 2 }, filtered: false }
  const s = await h.call('get_selection', {})
  assert.equal(s.result.range, 'A2:C3')
  const l = await h.call('list_sheets', {})
  assert.equal(l.result.sheets.length, 2)
  assert.equal(l.result.sheets[0].usedRange, 'A1:E6')
  const ctx = h.tools.getContext()
  assert.match(ctx, /"시트1"/)
  assert.match(ctx, /A1:E6/)
  assert.match(ctx, /선택: A2:C3/)
  assert.match(ctx, /오류 값 칸: 1개/)
})

test('시스템 프롬프트: 지원 함수 목록 주입, 지식 포함, 빠른 실행 6개', () => {
  const fns = [{ name: 'SUM', category: 'math' }, { name: 'AVERAGE', category: 'stat' }, { name: 'FILTER', category: 'array' }]
  const p = buildSystemPrompt({ functions: fns, knowledge: '시트는 이렇게 동작한다. 1행은 머리글이고 데이터는 2행부터다. 수식은 지원 함수 목록에 있는 것만 쓴다.' })
  assert.match(p, /수학: SUM/)
  assert.match(p, /배열: FILTER/)
  assert.match(p, /시트는 이렇게 동작한다/)
  assert.match(p, /analyze_range/)
  assert.equal(compactFunctionList(fns).split('\n').length, 3)
  assert.deepEqual(QUICK_ACTIONS.map((q) => q.label), ['수식 만들기', '오류 찾기', '데이터 정리', '표 만들기', '요약 통계', '수식 설명'])
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(p) && !p.includes('—'))
})

test('엔진: SUMIFS, VLOOKUP 결과를 쓰기 전에 보여 준다', async () => {
  const h = makeHost()
  await seed(h)
  const sm = await h.call('write_cells', { cells: [{ ref: 'F2', formula: '=SUMIFS(C2:C6,A2:A6,"서울",B2:B6,"사과")' }, { ref: 'F3', formula: '=VLOOKUP("대구",A2:C6,3,FALSE)' }] })
  assert.equal(sm.result.wrote, true)
  assert.deepEqual(sm.result.formulas.map((x) => x.result), ['1000', '700'])
  const miss = await h.call('write_cells', { cells: [{ ref: 'F4', formula: '=VLOOKUP("광주",A2:C6,3,FALSE)' }] })
  assert.equal(miss.result.wrote, false)
  assert.equal(miss.result.formulaErrors[0].error, '#N/A')
  assert.equal(grid(h.box, 'F4:F4')[0][0], '')
})

test('엔진 복구 경로: VLOOKUPX 는 VLOOKUP 제안, 인수 개수 안내, 고치면 통과', async () => {
  const h = makeHost()
  await seed(h)
  const a = await h.call('write_cells', { cells: [{ ref: 'F2', formula: '=VLOOKUPX("대구",A2:C6,3,FALSE)' }] })
  assert.equal(a.result.wrote, false)
  assert.match(a.result.problems[0], /비슷한 함수: VLOOKUP/)
  const b = await h.call('write_cells', { cells: [{ ref: 'F2', formula: '=VLOOKUP("대구",A2:C6)' }] })
  assert.match(b.result.problems[0], /인수가 2개/)
  const c = await h.call('write_cells', { cells: [{ ref: 'F2', formula: '=VLOOKUP("대구",A2:C6,3,FALSE)' }] })
  assert.equal(c.result.wrote, true)
})

test('엔진: FILTER 펼침을 쓰고 읽고, 충돌하면 쓰기 전에 막힘을 알린다', async () => {
  const h = makeHost()
  await seed(h)
  const f = await h.call('write_cells', { cells: [{ ref: 'F2', formula: '=FILTER(A2:C6,A2:A6="서울")' }] })
  assert.equal(f.result.wrote, true)
  assert.equal(f.result.formulas[0].spills_to, 'F2:H3')
  const r = await h.call('read_sheet', { range: 'F1:H4', mode: 'both' })
  assert.match(r.result.grid, /2\t.*서울.*사과.*1000/)
  assert.match(r.result.grid, /G2 .*F2 에서 펼쳐짐|F2 에서 펼쳐짐/)
  assert.match(r.result.usedRange, /H6|H/)
  // 충돌: 펼쳐질 칸에 값이 있는 상태에서 새로 쓰기
  const h2 = makeHost()
  await seed(h2)
  await h2.call('write_cells', { cells: [{ ref: 'G3', value: '막는 값' }] })
  const blocked = await h2.call('write_cells', { cells: [{ ref: 'F2', formula: '=FILTER(A2:C6,A2:A6="서울")' }] })
  assert.equal(blocked.result.wrote, false)
  assert.equal(blocked.result.formulaErrors[0].error, '#REF!')
  assert.match(blocked.result.formulaErrors[0].cause, /펼쳐질 칸/)
  // 이미 펼쳐진 뒤에 그 자리에 쓰면 다른 칸이 오류가 된다는 경고
  const w = await h.call('write_cells', { cells: [{ ref: 'G3', value: '방해' }], overwrite: true })
  assert.equal(w.result.wrote, true)
  assert.equal(w.result.otherCellsNowInError[0].ref, 'F2')
})

test('compute: 배열 결과 미리보기와 날짜 함수', async () => {
  const h = makeHost()
  await seed(h)
  const r = await h.call('compute', { formula: '=UNIQUE(A2:A6)' })
  assert.equal(r.result.ok, true)
  assert.equal(r.result.spill.size, '3행 x 1열')
  assert.equal(r.result.spill.preview.split('\n')[0], '서울')
  const q = await h.call('compute', { formula: '=QUERY(A1:C6,"select A, sum(C) group by A")' })
  assert.equal(q.result.ok, true)
})

test('create_table: 머리글 서식까지 되돌리기 한 단계, 서식 한도 안내', async () => {
  const h = makeHost()
  const before = h.box.history.length
  const t = await h.call('create_table', { top_left: 'A5', headers: ['이름', '값'], rows: [['가', 1], ['나', 2]] })
  assert.equal(h.box.history.length, before + 1)
  assert.equal(Object.keys(h.box.state.ui.s1.formats).length, 2)
  t.undo()
  assert.equal(grid(h.box, 'A5:B5')[0][0], '')
  assert.equal(h.box.state.ui.s1, undefined)
  const plain = await h.call('create_table', { top_left: 'A1', headers: ['이름', '값'], rows: [['가', 1]] })
  assert.equal(plain.result.ok, true)
  assert.equal(h.box.state.ui.s1, undefined)
  const dup = await h.call('create_table', { top_left: 'A1', headers: ['x'], rows: [['덮']] })
  assert.equal(dup.result.wrote, false)
})

test('시스템 프롬프트: 설명서가 자리표시뿐이면 넣지 않는다', () => {
  const p = buildSystemPrompt({ functions: [{ name: 'SUM', category: 'math' }], knowledge: '# sheets 사용 설명서\n\n(작성 예정)' })
  assert.ok(!p.includes('작성 예정'))
  assert.ok(!p.includes('이 프로그램의 사용 설명서'))
})
