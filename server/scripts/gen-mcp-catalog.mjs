// 편집기 AI 도구 목록(이름, 설명, 매개변수)을 MCP 서버용 JSON으로 뽑는다: node scripts/gen-mcp-catalog.mjs
// 서버는 클라이언트 코드를 실행 환경에 가져갈 수 없으므로(서비스 루트가 server/), 도구 명세만 이 파일로 복사해 둔다.
// 도구 명세가 바뀌면 이 스크립트를 다시 돌려 src/lib/mcpCatalog.json 을 커밋한다.
// 실행 자체는 열린 편집기 탭이 맡는다(client/src/components/ai/mcpRelay.js).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pages = path.resolve(here, '../../client/src/pages')
const SOURCES = [
  ['doc', 'handover/aiDocTools.js', 'createDocTools'],
  ['slide', 'slides/aiSlideTools.js', 'createSlideTools'],
  ['board', 'board/aiBoardTools.js', 'createBoardTools'],
  ['sheet', 'workspace/aiSheetTools.js', 'createSheetTools'],
  ['form', 'admin/aiFormTools.js', 'createFormTools'],
]

// 읽기만 하는 도구(편집기 상태를 바꾸지 않는다)
const READ_ONLY = new Set([
  'doc:read_document', 'doc:get_selection', 'doc:get_outline', 'doc:find_in_document', 'doc:read_comments', 'doc:check_document', 'doc:run_gongmun_check',
  'slide:read_deck', 'slide:read_slide', 'slide:check_deck',
  'board:read_canvas',
  'sheet:list_sheets', 'sheet:get_selection', 'sheet:read_sheet', 'sheet:analyze_range', 'sheet:compute', 'sheet:find_errors',
  'form:read_form', 'form:lint_form', 'form:get_response_stats', 'form:get_text_responses',
])
// 되돌리기 어렵거나 내용을 지우는 도구
const DESTRUCTIVE = new Set([
  'doc:edit_paragraphs', 'doc:replace_text', 'doc:replace_selection', 'doc:table_ops',
  'slide:delete_slide', 'slide:create_deck_from_outline',
  'board:edit_items', 'board:cluster_items',
  'sheet:write_cells', 'sheet:clear_range', 'sheet:delete_rows', 'sheet:delete_cols', 'sheet:delete_sheet', 'sheet:remove_duplicates', 'sheet:find_replace', 'sheet:split_column', 'sheet:fill_range', 'sheet:create_table',
  'form:delete_question', 'form:generate_form', 'form:edit_question',
])
// 같은 입력으로 다시 불러도 결과가 같은 도구(읽기 전용은 모두 해당)
const IDEMPOTENT = new Set(['doc:set_document_title', 'doc:set_page_setup', 'doc:apply_format', 'doc:set_cell_style', 'doc:fix_typos', 'doc:switch_mode', 'slide:set_notes', 'slide:restyle', 'slide:fix_typos', 'slide:fix_deck', 'slide:set_background', 'slide:style_text', 'slide:set_transition', 'sheet:sort_range', 'sheet:rename_sheet', 'sheet:format_range', 'form:set_form_settings', 'form:set_quiz', 'form:set_answer_key', 'form:set_branching'])

const out = { generated: 'node scripts/gen-mcp-catalog.mjs', kinds: {} }
for (const [kind, file, fn] of SOURCES) {
  const m = await import(pathToFileURL(path.join(pages, file)).href)
  const r = m[fn]({})
  const list = Array.isArray(r) ? r : r.tools
  out.kinds[kind] = list.map((t) => {
    const key = `${kind}:${t.name}`
    const ro = READ_ONLY.has(key)
    return {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} },
      readOnly: ro,
      destructive: !ro && DESTRUCTIVE.has(key),
      idempotent: ro || IDEMPOTENT.has(key),
    }
  })
}
const dest = path.resolve(here, '../src/lib/mcpCatalog.json')
fs.writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`)
const n = Object.values(out.kinds).reduce((a, b) => a + b.length, 0)
console.log(`${n}개 도구를 ${path.relative(process.cwd(), dest)} 에 썼습니다`, Object.fromEntries(Object.entries(out.kinds).map(([k, v]) => [k, v.length])))
