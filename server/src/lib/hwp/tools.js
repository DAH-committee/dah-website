// 한글 파일 서버 도구 묶음(MCP). mcpTools.registerServerTools('hwp', hwpServerTools()) 로 등록하면 이름이 hwp_<name> 이 된다.
// 권한(읽기/편집자)·감사·"문서 글은 데이터" 표시는 등록부가 처리한다. 여기서는 동작만 한다.
import * as core from './core.js'
import * as store from './store.js'
import { authorOf, fileRow } from '../wsAccess.js'
import { HwpError } from './kordoc.js'

const loadWithContent = async (file) => {
  const { query } = await import('../../db.js')
  const r = (await query('SELECT content, created_at, updated_at FROM ws_files WHERE id = $1', [file.id])).rows[0] || {}
  return { ...file, content: r.content, created_at: r.created_at, updated_at: r.updated_at }
}
const ver = { type: 'integer', description: '버전 번호(생략하면 현재). / version (default current)' }
const OPS_HELP = 'ops 는 [{op:"replace_block",block:"b3",text:"..."}, {op:"replace_cell",cell:"b5#r2c1",text:"..."}, {op:"insert_paragraph_after",block:"b3",text:"...",like:"b2"}, {op:"delete_block",block:"b9"}, {op:"table_add_rows",table:"b5",after_row:3,rows:[["a","b"]]}, {op:"fill_fields",values:{"성명":"홍길동"},dry_run:true}, {op:"replace_text",find:"A",replace:"B",all:true,scope:"body|tables|block:b3"}, {op:"apply_markdown",markdown:"..."}, {op:"redact",rules:["rrn","phone"],dry_run:true}, {op:"place_seal",image:"data:image/png;base64,..",anchor:"(인)"}]. 블록 id 는 hwp_read_blocks 가 알려 준 것을 쓴다. 고치기 전에 expect(지금 글의 앞부분)를 주면 문서가 바뀌었을 때 안전하게 건너뛴다. HWP(5.x) 파일은 insert/delete/table_add_rows/fill_fields/redact/place_seal 을 지원하지 않는다.'

const wrap = (fn) => async (args, ctx) => {
  try {
    const file = await loadWithContent(ctx.file)
    const out = await fn(args, { ...ctx, file })
    return out
  } catch (e) {
    if (e instanceof HwpError) return { result: { ok: false, error: { code: e.code, message: e.message, ...e.extra } }, summary: `실패: ${e.message}` }
    throw e
  }
}

export function hwpServerTools() {
  return [
    {
      name: 'read_outline', readOnly: true,
      description: '한글 파일의 개요: 제목(heading)·표 목록·양식 칸·메타데이터·글자 수. 문서를 처음 볼 때 먼저 부른다. / Outline of a HWP/HWPX file.',
      parameters: { type: 'object', properties: { version: ver } },
      run: wrap(async (a, { file }) => { const r = await core.outline(file, a.version); return { result: r, summary: `블록 ${r.stats.blocks}개, 표 ${r.stats.tables}개` } }),
    },
    {
      name: 'read_blocks', readOnly: true,
      description: '한글 파일의 블록(문단·표)을 안정 id 와 함께 읽는다. 표는 칸 id(b5#r2c1)가 붙은 격자. from/to 는 0부터, 한 번에 300블록까지. / Read blocks with stable ids.',
      parameters: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' }, version: ver } },
      run: wrap(async (a, { file }) => { const r = await core.blocksRange(file, a.version, a.from ?? 0, a.to ?? 120); return { result: r, summary: `${r.blocks.length}블록 (${r.from}~${r.to} / 전체 ${r.total})` } }),
    },
    {
      name: 'read_fields', readOnly: true,
      description: '양식 칸 목록(라벨-값 칸과 누름틀). fill_fields 로 채우기 전에 쓴다. / Form fields.',
      parameters: { type: 'object', properties: { version: ver } },
      run: wrap(async (a, { file }) => { const r = await core.fields(file, a.version); return { result: r, summary: `칸 ${r.fields.length}개` } }),
    },
    {
      name: 'edit',
      description: `한글 파일을 원래 서식을 지키며 고친다. 고칠 때마다 새 버전이 생긴다. dry_run:true 로 먼저 확인할 수 있다. ${OPS_HELP}`,
      parameters: {
        type: 'object',
        properties: {
          ops: { type: 'array', maxItems: 200, items: { type: 'object' }, description: '편집 연산 목록' },
          dry_run: { type: 'boolean' }, strict: { type: 'boolean' }, base_version: { type: 'integer' }, note: { type: 'string' },
        },
        required: ['ops'],
      },
      run: wrap(async (a, { file, req }) => {
        const r = await core.edit(file, { ...a, source: 'ai' }, { who: `AI(${authorOf(req)})`, req })
        return { result: r, summary: `${r.dry_run ? '시험 적용' : `버전 ${r.version}`}: 적용 ${r.applied.length}, 건너뜀 ${r.skipped.length}` }
      }),
    },
    {
      name: 'lint', readOnly: true,
      description: '공문서 표기법 검사(27규칙). 결과마다 block/cell 위치가 있다. / Gongmun style lint.',
      parameters: { type: 'object', properties: { version: ver } },
      run: wrap(async (a, { file }) => { const r = await core.lint(file, { version: a.version }); return { result: r, summary: `오류 ${r.counts.error}, 경고 ${r.counts.warn}` } }),
    },
    {
      name: 'compare', readOnly: true,
      description: '두 버전의 신구대조(블록·표 칸 단위). to 만 주면 현재 버전과 비교. / Diff two versions.',
      parameters: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } }, required: ['to'] },
      run: wrap(async (a, { file }) => { const r = await core.compare(file, { from: a.from, to: a.to }); return { result: r, summary: `변경 ${r.stats.modified + r.stats.added + r.stats.removed}건` } }),
    },
    {
      name: 'list_versions', readOnly: true,
      description: '버전 목록(누가 언제 무엇을 바꿨는지). / Version history.',
      parameters: { type: 'object', properties: {} },
      run: wrap(async (a, { file }) => { const rows = await store.listVersions(file.id); return { result: { current: core.currentVersionOf(file), items: rows }, summary: `버전 ${rows.length}개` } }),
    },
    {
      name: 'restore_version',
      description: '지난 버전으로 되돌린다(새 버전이 만들어진다). / Restore an old version as a new version.',
      parameters: { type: 'object', properties: { version: { type: 'integer' } }, required: ['version'] },
      run: wrap(async (a, { file, req }) => { const r = await core.restore(file, a.version, { who: `AI(${authorOf(req)})`, req }); return { result: r, summary: `버전 ${r.version} (v${r.restored_from} 에서 되돌림)` } }),
    },
    {
      name: 'redaction_suggest', readOnly: true,
      description: '개인정보 후보 위치(마스킹된 미리보기만). 실제 가리기는 edit 의 redact 연산. / PII candidates.',
      parameters: { type: 'object', properties: { version: ver } },
      run: wrap(async (a, { file }) => { const r = await core.redactionSuggest(file, a.version); return { result: r, summary: `후보 ${r.total}건` } }),
    },
  ]
}

let registered = false
export async function registerHwpTools() {
  if (registered) return true
  try {
    const m = await import('../mcpTools.js')
    if (typeof m.registerServerTools !== 'function') return false
    m.registerServerTools('hwp', hwpServerTools())
    registered = true
    return true
  } catch {
    return false
  }
}
void fileRow
