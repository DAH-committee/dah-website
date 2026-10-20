// AI 도구 인자 처리와 편집 연산 모양 시험(서버는 가짜). 자연어 품질이 아니라 도구 배관만 시험한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHwpTools, compactBlock, MAX_READ_CHARS } from '../aiHwpTools.js'

function makeEnv(over = {}) {
  const calls = []
  let version = 7
  const doc = [
    { id: 'b1', index: 0, type: 'heading', level: 1, text: '2026년 행사 계획', page: 1 },
    { id: 'b2', index: 1, type: 'paragraph', text: '일시 : 2026.09.01 오후 3시 20분', page: 1 },
    { id: 'b3', index: 2, type: 'paragraph', text: '붙임 계획서 1부. 끝.', page: 1 },
    {
      id: 'b4', index: 3, type: 'table', page: 1,
      table: { rows: 2, cols: 2, cells: [[{ id: 'b4#r0c0', row: 0, col: 0, text: '구분', editable: true }, { id: 'b4#r0c1', row: 0, col: 1, text: '금액', editable: true }], [{ id: 'b4#r1c0', row: 1, col: 0, text: '2월', editable: true }, { id: 'b4#r1c1', row: 1, col: 1, text: '10,000', editable: true }]] },
    },
  ]
  const api = {
    blocks: async (from, to) => ({ version, total: doc.length, from, to: Math.min(to, doc.length), blocks: doc.slice(from, to) }),
    outline: async () => ({ version, format: 'hwpx', title: '시험', metadata: { pageCount: 2 }, headings: [{ block: 'b1', level: 1, text: '2026년 행사 계획', page: 1 }], tables: [{ block: 'b4', rows: 2, cols: 2, page: 1, header: ['구분', '금액'] }], stats: { blocks: 4 }, fields: [] }),
    versions: async () => ({ current: version, items: [{ version: 7, note: '', source: 'user', created_at: 'x' }, { version: 6, note: 'AI: 고침', source: 'ai', created_at: 'y' }] }),
    fields: async () => ({ version, confidence: 0.9, fields: [{ name: '성명', kind: 'label', empty: true, cell: 'b4#r1c0' }, { name: '연락처', kind: 'clickhere', empty: true, hint: '입력' }] }),
    pages: async (from, to, v, o) => ({ version, page_count: 2, pages: [{ n: from, width: 595, height: 842, image: 'data:image/png;base64,AAAA', svg: '<svg/>', regions: [{ id: 'r1', block: 'b1', bbox: { x: 0, y: 0, width: 1, height: 1 } }, { id: 'r2', block: 'b4', bbox: { x: 0, y: 0, width: 1, height: 1 } }], _fmt: o?.format }] }),
    edit: async (body) => {
      calls.push(body)
      if (over.conflictOnce && !over.conflicted) {
        over.conflicted = true
        const e = new Error('충돌')
        e.code = 'VERSION_CONFLICT'
        throw e
      }
      if (body.dry_run) return { version, changed: false, applied: body.ops.map((o, i) => ({ op: i, type: o.type, block: o.block, before: '가', after: '나', targets: [{ name: '성명' }] })), skipped: [] }
      version += 1
      return { version, changed: true, applied: body.ops.map((o, i) => ({ op: i, type: o.type, block: o.block, before: '가', after: '나' })), skipped: over.skipped || [], pages_changed: [1], verify: { ok: true } }
    },
    lint: async () => ({ version, counts: { error: 1, warn: 1, info: 0 }, findings: [{ block: 'b2', rule: 'DATE_NO_SPACE', severity: 'error', message: '날짜 표기', match: '2026.09.01', suggest: '예) 2025. 1. 6.' }, { block: 'b3', rule: 'END_MARK_SPACE', severity: 'warn', message: '끝 표시', match: '1부. 끝.', suggest: '예) 주시기 바랍니다.  끝.' }, { block: 'b1', rule: 'STYLE', severity: 'info', message: '참고' }] }),
    compare: async (to, from) => ({ from, to, stats: { modified: 1, added: 0, removed: 0, unchanged: 3 }, diffs: [{ type: 'removed', block: 'b2', before: '가', after: null }, { type: 'added', block: 'b2', before: null, after: '나' }] }),
    redactionSuggest: async () => ({ hits: [{ block: 'b2', rule: 'phone', preview: '010-****-1234' }] }),
    ...(over.api || {}),
  }
  const log = { afterEdit: [], confirms: [], downloads: [], restores: [], created: [], undos: [] }
  const env = {
    api,
    getVersion: () => version,
    getInfo: () => ({ format: 'hwpx', title: '시험', page_count: 2, render_mode: 'layout', edit_support: { hwpx: ['replace_block', 'table_add_rows'] } }),
    canEdit: () => over.canEdit !== false,
    getSelection: () => over.selection ?? null,
    afterEdit: async (res, o) => log.afterEdit.push({ res, o }),
    undoTo: async (prev, exp) => log.undos.push([prev, exp]),
    refresh: async () => {},
    confirm: async (o) => {
      log.confirms.push(o)
      return over.confirmAnswer !== false
    },
    getSealImage: () => over.seal ?? null,
    download: async (f, v) => {
      log.downloads.push([f, v])
      return `시험.${f}`
    },
    restoreVersion: async (v) => {
      log.restores.push(v)
      version += 1
      return { version }
    },
    createFile: async (body) => {
      log.created.push(body)
      return { item: { id: 99, title: body.title || '새 문서' }, warnings: [] }
    },
    announceNewFile: () => {},
  }
  return { env, calls, log, tools: createHwpTools(env), doc }
}
const T = (tools, name) => tools.find((t) => t.name === name)

test('도구 목록: 이름 중복 없음, 서버 한도(24개) 이내, 모두 스키마와 run 이 있음', () => {
  const { tools } = makeEnv()
  const names = tools.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(names.length <= 24, `도구 ${names.length}개`)
  for (const n of ['get_outline', 'read_blocks', 'read_page', 'look_at_page', 'find_in_document', 'replace_block', 'replace_cell', 'replace_text', 'insert_paragraph_after', 'delete_block', 'table_add_rows', 'list_form_fields', 'fill_form', 'check_gongmun', 'fix_gongmun', 'convert_to_gaejosik', 'convert_to_sentence', 'compare_with_version', 'redact_personal_info', 'place_seal', 'export_file', 'restore_version', 'draft_document']) assert.ok(names.includes(n), n)
  for (const t of tools) {
    assert.equal(t.parameters.type, 'object')
    assert.equal(typeof t.run, 'function')
    assert.ok(t.description.length > 10)
  }
})

test('get_outline: 구조, 최근 버전 포함', async () => {
  const { tools } = makeEnv()
  const r = await T(tools, 'get_outline').run({})
  assert.equal(r.result.pages, 2)
  assert.equal(r.result.headings[0].block, 'b1')
  assert.equal(r.result.versions.length, 2)
  assert.deepEqual(r.result.edit_ops, ['replace_block', 'table_add_rows'])
})

test('read_blocks: 표는 grid, 구간 인자 보정', async () => {
  const { tools } = makeEnv()
  const r = await T(tools, 'read_blocks').run({ from: -5, to: 'x' })
  assert.equal(r.result.blocks.length, 4)
  const tbl = r.result.blocks.find((b) => b.t === 'tbl')
  assert.deepEqual(tbl.grid, [['구분', '금액'], ['2월', '10,000']])
  assert.equal(r.result.truncated, undefined)
})

test('read_blocks: 글자 예산을 넘으면 truncated 와 next_from', async () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ id: `b${i + 1}`, index: i, type: 'paragraph', text: '가'.repeat(1000) }))
  const { tools } = makeEnv({ api: { blocks: async (from, to) => ({ version: 7, total: 40, from, to, blocks: big.slice(from, to) }) } })
  const r = await T(tools, 'read_blocks').run({ from: 0, to: 40 })
  assert.equal(r.result.truncated, true)
  assert.ok(r.result.blocks.length < 40)
  assert.equal(r.result.next_from, r.result.blocks.length)
  assert.ok(JSON.stringify(r.result).length < MAX_READ_CHARS + 2000)
})

test('compactBlock: 병합과 잠긴 칸 표시', () => {
  const c = compactBlock({ id: 'b9', type: 'table', table: { rows: 1, cols: 2, cells: [[{ id: 'b9#r0c0', row: 0, col: 0, rowSpan: 1, colSpan: 2, text: 'a', editable: false }, { covered: 'b9#r0c0' }]] } })
  assert.deepEqual(c.grid, [['a', null]])
  assert.deepEqual(c.merges, ['r0c0:1x2'])
  assert.deepEqual(c.locked, ['r0c0'])
})

test('read_page: 영역의 블록 글을 순서대로, 중복 없이', async () => {
  const { tools } = makeEnv()
  const r = await T(tools, 'read_page').run({ page: 1 })
  assert.deepEqual(r.result.blocks.map((b) => b.id), ['b1', 'b4'])
})

test('look_at_page: 이미지는 result 가 아니라 images 로', async () => {
  const { tools, env } = makeEnv()
  const r = await T(tools, 'look_at_page').run({ page: 1 })
  assert.deepEqual(r.images, ['data:image/png;base64,AAAA'])
  assert.equal(JSON.stringify(r.result).includes('base64'), false)
  env.shrinkImage = async () => 'data:image/jpeg;base64,BBBB'
  const r2 = await createHwpTools(env).find((t) => t.name === 'look_at_page').run({ page: 1 })
  assert.deepEqual(r2.images, ['data:image/jpeg;base64,BBBB'])
})

test('find_in_document: 본문과 표 칸, 대소문자', async () => {
  const { tools } = makeEnv()
  const r = await T(tools, 'find_in_document').run({ query: '2월' })
  assert.equal(r.result.total, 1)
  assert.equal(r.result.hits[0].cell, 'b4#r1c0')
  const r2 = await T(tools, 'find_in_document').run({ query: '붙임' })
  assert.equal(r2.result.hits[0].block, 'b3')
  await assert.rejects(() => T(tools, 'find_in_document').run({ query: 5 }))
})

test('replace_block: 단일, 배치, 잘못된 id 거부, 되돌리기', async () => {
  const { tools, calls, log } = makeEnv()
  const r = await T(tools, 'replace_block').run({ block: 'b2', text: '새 글', expect: '일시' })
  assert.deepEqual(calls[0].ops, [{ type: 'replace_block', block: 'b2', text: '새 글', expect: '일시' }])
  assert.equal(calls[0].source, 'ai')
  assert.equal(calls[0].base_version, 7)
  assert.equal(r.result.applied_count, 1)
  assert.equal(log.afterEdit.length, 1)
  r.undo()
  assert.deepEqual(log.undos[0], [7, 8])
  await T(tools, 'replace_block').run({ edits: [{ block: 'b1', text: 'a' }, { block: 'b2', text: 'b' }] })
  assert.equal(calls[1].ops.length, 2)
  await assert.rejects(() => T(tools, 'replace_block').run({ block: '12', text: 'x' }), /블록 번호/)
  await assert.rejects(() => T(tools, 'replace_block').run({ block: 'b1', text: 5 }), /글이어야/)
  await assert.rejects(() => T(tools, 'replace_block').run({}))
})

test('replace_block: 보기 전용이면 서버를 부르지 않음', async () => {
  const { tools, calls } = makeEnv({ canEdit: false })
  await assert.rejects(() => T(tools, 'replace_block').run({ block: 'b1', text: 'x' }), /보기 권한/)
  assert.equal(calls.length, 0)
})

test('replace_cell: cell, table+row+col, 배치', async () => {
  const { tools, calls } = makeEnv()
  await T(tools, 'replace_cell').run({ cell: 'b4#r1c1', text: '20,000' })
  assert.deepEqual(calls[0].ops[0], { type: 'replace_cell', table: 'b4', row: 1, col: 1, text: '20,000' })
  await T(tools, 'replace_cell').run({ table: 'b4', row: 0, col: 0, text: 'x' })
  assert.equal(calls[1].ops[0].col, 0)
  await T(tools, 'replace_cell').run({ edits: [{ cell: 'b4#r0c0', text: 'a' }, { cell: 'b4#r0c1', text: 'b' }] })
  assert.equal(calls[2].ops.length, 2)
  await assert.rejects(() => T(tools, 'replace_cell').run({ cell: 'b4-1-1', text: 'x' }), /형식/)
  await assert.rejects(() => T(tools, 'replace_cell').run({ table: 'b4', row: -1, col: 0, text: 'x' }), /0 이상/)
})

test('replace_text: scope 검증', async () => {
  const { tools, calls } = makeEnv()
  await T(tools, 'replace_text').run({ find: '가', replace: '나', scope: 'block:b2', all: false })
  assert.deepEqual(calls[0].ops[0], { type: 'replace_text', find: '가', replace: '나', all: false, scope: 'block:b2' })
  await assert.rejects(() => T(tools, 'replace_text').run({ find: '가', replace: '나', scope: 'everything' }), /scope/)
  await assert.rejects(() => T(tools, 'replace_text').run({ find: '', replace: '나' }), /비었/)
})

test('insert_paragraph_after: 여러 문단은 같은 자리 뒤에 거꾸로 넣어 순서가 맞게', async () => {
  const { tools, calls } = makeEnv()
  await T(tools, 'insert_paragraph_after').run({ block: 'b2', texts: ['첫째', '둘째', '셋째'], like: 'b2' })
  assert.deepEqual(calls[0].ops.map((o) => o.text), ['셋째', '둘째', '첫째'])
  assert.ok(calls[0].ops.every((o) => o.block === 'b2' && o.like === 'b2'))
})

test('delete_block: 확인 없이는 실행하지 않고, 확인되면 화면 확인 창을 거친다', async () => {
  const { tools, calls, log } = makeEnv()
  const r = await T(tools, 'delete_block').run({ block: 'b3' })
  assert.equal(r.result.needsConfirmation, true)
  assert.equal(calls.length, 0)
  const ok = await T(tools, 'delete_block').run({ block: 'b3', confirmed: true })
  assert.equal(log.confirms.length, 1)
  assert.equal(calls[0].ops[0].type, 'delete_block')
  assert.equal(ok.result.applied_count, 1)
})

test('delete_block: 사용자가 창에서 취소하면 실행하지 않음', async () => {
  const { tools, calls } = makeEnv({ confirmAnswer: false })
  const r = await T(tools, 'delete_block').run({ block: 'b3', confirmed: true })
  assert.equal(r.result.cancelled, true)
  assert.equal(calls.length, 0)
})

test('table_add_rows: 인자 보정과 제한', async () => {
  const { tools, calls } = makeEnv()
  await T(tools, 'table_add_rows').run({ table: 'b4', after_row: 1, rows: [['3월', 5]] })
  assert.deepEqual(calls[0].ops[0], { type: 'table_add_rows', table: 'b4', after_row: 1, rows: [['3월', '5']] })
  await assert.rejects(() => T(tools, 'table_add_rows').run({ table: 'b4', after_row: 1, rows: [] }), /1~30행/)
  await assert.rejects(() => T(tools, 'table_add_rows').run({ table: 'b4', after_row: -2, rows: [['a']] }), /0 이상/)
  await assert.rejects(() => T(tools, 'table_add_rows').run({ table: 'b4', after_row: 1, rows: ['a'] }), /배열/)
})

test('fill_form: dry_run 먼저(문서 안 바뀜), 못 찾은 이름 보고, 11칸 이상은 확인 필요', async () => {
  const { tools, calls, log } = makeEnv()
  const d = await T(tools, 'fill_form').run({ values: { 성명: '홍길동', 없는칸: 'x' }, dry_run: true })
  assert.equal(calls[0].dry_run, true)
  assert.deepEqual(d.result.unmatched, ['없는칸'])
  assert.equal(log.afterEdit.length, 0)
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`칸${i}`, 'v']))
  const g = await T(tools, 'fill_form').run({ values: many })
  assert.equal(g.result.needsConfirmation, true)
  assert.equal(calls.length, 1)
  const ok = await T(tools, 'fill_form').run({ values: many, confirmed: true })
  assert.equal(calls.length, 2)
  assert.ok(ok.result.applied_count >= 1)
  await assert.rejects(() => T(tools, 'fill_form').run({ values: [] }), /객체/)
  await assert.rejects(() => T(tools, 'fill_form').run({ values: {} }), /없습니다/)
})

test('list_form_fields', async () => {
  const { tools } = makeEnv()
  const r = await T(tools, 'list_form_fields').run({})
  assert.deepEqual(r.result.fields.map((f) => f.name), ['성명', '연락처'])
})

test('check_gongmun 후 fix_gongmun(issue_ids): 한 번의 편집 요청, 정보 수준은 기본 제외', async () => {
  const { tools, calls } = makeEnv()
  const c = await T(tools, 'check_gongmun').run({})
  assert.equal(c.result.total, 2)
  assert.deepEqual(c.result.findings.map((f) => f.id), ['L1', 'L2'])
  assert.ok(c.result.findings.every((f) => f.auto_fix === true))
  assert.equal(c.result.findings[0].hint, '예) 2025. 1. 6.', '서버 예시는 hint 로만 보여 준다')
  const r = await T(tools, 'fix_gongmun').run({ issue_ids: ['L1', 'L2', 'L9'] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ops.length, 2)
  // 서버 suggest("예) 2025. 1. 6.")가 아니라 이쪽 규칙으로 고친 글이 들어간다
  assert.deepEqual(calls[0].ops[0], { type: 'replace_block', block: 'b2', text: '일시: 2026. 9. 1. 오후 3시 20분'.replace('일시:', '일시 :'), expect: '일시 : 2026.09.01 오후 3시 20분' })
  assert.equal(JSON.stringify(calls[0].ops).includes('예)'), false)
  assert.equal(r.result.applied_count, 2)
})

test('fix_gongmun(issue_ids): 검사 없이는 거부, 문서가 바뀐 뒤에도 거부', async () => {
  const { tools } = makeEnv()
  await assert.rejects(() => T(tools, 'fix_gongmun').run({ issue_ids: ['L1'] }), /check_gongmun/)
  await T(tools, 'check_gongmun').run({})
  await T(tools, 'replace_block').run({ block: 'b1', text: '다른 글' }) // 버전이 올라감
  await assert.rejects(() => T(tools, 'fix_gongmun').run({ issue_ids: ['L1'] }), /바뀌었습니다/)
})

test('fix_gongmun(전체): 본문과 표 칸을 규칙으로 고치고 한 번의 요청으로 묶음', async () => {
  const { tools, calls } = makeEnv()
  const r = await T(tools, 'fix_gongmun').run({})
  assert.equal(calls.length, 1)
  const b2 = calls[0].ops.find((o) => o.block === 'b2')
  assert.equal(b2.text, '일시: 2026. 9. 1. 15:20')
  assert.equal(b2.expect, '일시 : 2026.09.01 오후 3시 20분')
  const b3 = calls[0].ops.find((o) => o.block === 'b3')
  assert.equal(b3.text, '붙임  계획서 1부.  끝.')
  assert.ok(r.result.by_rule['날짜 표기(월·일의 0 빼기, 온점)'] >= 1)
})

test('fix_gongmun: 고칠 곳이 없으면 서버를 부르지 않음', async () => {
  const { tools, calls } = makeEnv({ api: { blocks: async () => ({ version: 7, total: 1, blocks: [{ id: 'b1', index: 0, type: 'paragraph', text: '이미 맞는 글.' }] }) } })
  const r = await T(tools, 'fix_gongmun').run({})
  assert.equal(r.result.changed, false)
  assert.equal(calls.length, 0)
})

test('convert_to_gaejosik: 문서를 바꾸지 않고 작업 지시와 블록 글을 돌려줌', async () => {
  const { tools, calls } = makeEnv()
  const r = await T(tools, 'convert_to_gaejosik').run({ scope: 'all' })
  assert.equal(calls.length, 0)
  assert.equal(r.result.job, 'convert_to_gaejosik')
  assert.ok(r.result.blocks.some((b) => b.id === 'b2'))
  assert.ok(!r.result.blocks.some((b) => b.id === 'b4'))
  assert.match(r.result.instruction, /replace_block/)
})

test('convert_to_sentence: selection 범위는 선택 블록만, 선택이 없으면 오류', async () => {
  const { tools } = makeEnv({ selection: { block: 'b3' } })
  const r = await T(tools, 'convert_to_sentence').run({ scope: 'selection' })
  assert.deepEqual(r.result.blocks.map((b) => b.id), ['b3'])
  const none = makeEnv()
  await assert.rejects(() => T(none.tools, 'convert_to_sentence').run({ scope: 'selection' }), /선택한 블록/)
})

test('compare_with_version: 버전 없이 부르면 목록', async () => {
  const { tools } = makeEnv()
  const l = await T(tools, 'compare_with_version').run({})
  assert.equal(l.result.versions.length, 2)
  const c = await T(tools, 'compare_with_version').run({ version: 6 })
  assert.equal(c.result.diffs.length, 1, '같은 블록의 removed+added 는 한 줄로 합친다')
  assert.deepEqual([c.result.diffs[0].type, c.result.diffs[0].before, c.result.diffs[0].after], ['modified', '가', '나'])
  assert.equal(c.result.old_version, 6)
  await assert.rejects(() => T(tools, 'compare_with_version').run({ version: 'x' }), /양의 정수/)
})

test('redact_personal_info: 기본은 미리보기(문서 안 바뀜, 원문 미전달), 적용은 confirmed 와 확인 창 필요', async () => {
  const { tools, calls, log } = makeEnv()
  const d = await T(tools, 'redact_personal_info').run({ rules: ['phone', 'bad rule!'] })
  assert.equal(d.result.dry_run, true)
  assert.equal(d.result.wrote, false)
  assert.equal(d.result.by_rule.phone, 1)
  assert.equal(JSON.stringify(d.result).includes('"before"'), false)
  assert.equal(log.afterEdit.length, 0)
  assert.deepEqual(calls[0].ops[0].rules, ['phone'])
  const gate = await T(tools, 'redact_personal_info').run({ dry_run: false })
  assert.equal(gate.result.needsConfirmation, true)
  assert.equal(log.afterEdit.length, 0)
  const ok = await T(tools, 'redact_personal_info').run({ dry_run: false, confirmed: true })
  assert.equal(log.confirms.length, 1)
  assert.equal(ok.result.applied_count, 1)
})

test('redact_personal_info: 화면 확인 창에서 취소하면 적용하지 않음', async () => {
  const { tools, log } = makeEnv({ confirmAnswer: false })
  const r = await T(tools, 'redact_personal_info').run({ dry_run: false, confirmed: true })
  assert.equal(r.result.cancelled, true)
  assert.equal(log.afterEdit.length, 0)
})

test('place_seal: 도장 이미지가 없으면 안내', async () => {
  const { tools } = makeEnv()
  await assert.rejects(() => T(tools, 'place_seal').run({ anchor: '(인)' }), /도장 이미지가 없습니다/)
  const w = makeEnv({ seal: 'data:image/png;base64,ZZ' })
  const r = await T(w.tools, 'place_seal').run({ anchor: '(인)', width_mm: 99 })
  assert.equal(w.calls[0].ops[0].width_mm, 40)
  assert.equal(r.result.applied_count, 1)
})

test('export_file: 형식 검증, 형식 불일치 거부', async () => {
  const { tools, log } = makeEnv()
  const r = await T(tools, 'export_file').run({ format: 'DOCX' })
  assert.deepEqual(log.downloads[0], ['docx', 7])
  assert.equal(r.result.file, '시험.docx')
  await assert.rejects(() => T(tools, 'export_file').run({ format: 'exe' }), /format/)
  await assert.rejects(() => T(tools, 'export_file').run({ format: 'hwp' }), /원본 그대로/)
})

test('restore_version / draft_document', async () => {
  const { tools, log } = makeEnv()
  const r = await T(tools, 'restore_version').run({ version: 5 })
  assert.deepEqual(log.restores, [5])
  assert.equal(r.result.restored_from, 5)
  assert.equal(typeof r.undo, 'function')
  await assert.rejects(() => T(tools, 'restore_version').run({ version: 0 }), /양의 정수/)
  const d = await T(tools, 'draft_document').run({ template: 'gian', values: { 수신: '○○○' }, title: '기안' })
  assert.deepEqual(log.created[0], { template: 'gian', values: { 수신: '○○○' }, title: '기안' })
  assert.equal(d.result.url, '/hwp/99')
  await assert.rejects(() => T(tools, 'draft_document').run({ template: 'x' }), /template/)
  await assert.rejects(() => T(tools, 'draft_document').run({ template: 'markdown' }), /글이어야|markdown/)
})

test('버전 충돌이면 새로고침 후 한 번 다시 시도', async () => {
  const { tools, calls } = makeEnv({ conflictOnce: true })
  const r = await T(tools, 'replace_block').run({ block: 'b1', text: '제목' })
  assert.equal(calls.length, 2)
  assert.equal(r.result.applied_count, 1)
})

test('건너뛴 연산이 있으면 이유를 돌려줌', async () => {
  const { tools } = makeEnv({ skipped: [{ op: 1, type: 'insert_paragraph_after', reason: 'HWP_UNSUPPORTED' }] })
  const r = await T(tools, 'replace_block').run({ block: 'b1', text: 'x' })
  assert.equal(r.result.skipped[0].reason, 'HWP_UNSUPPORTED')
  assert.match(r.result.skipped[0].message, /hwp/)
  assert.match(r.summary, /건너뜀/)
})
