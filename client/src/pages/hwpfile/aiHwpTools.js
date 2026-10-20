// 한글 파일 편집기용 AI 도구. AiPanel 의 Tool 계약(components/ai/README.md)을 따른다.
// 핵심 규칙
// - 모델이 넘기는 인자는 믿지 않는다: 타입 확인, 숫자 제한, 모르는 필드 무시, 블록 id 형식 확인, 글은 일반 글자로만.
// - 서식을 지키는 연산(replace_block, replace_cell, replace_text, insert_paragraph_after, table_add_rows, fill_fields, redact)만 쓴다.
//   한 번의 도구 호출은 서버 편집 요청 한 번이고, 버전이 하나 생긴다. 그래서 되돌리기 한 번으로 돌아간다.
// - 읽기 결과는 작게(약 12000자), 넘치면 next_from 을 준다.
// - 개인정보 가리기 적용, 블록 삭제, 필드 11개 이상 채우기는 확인(confirmed:true)이 있어야 한다. 가리기와 삭제는 화면 확인 창도 거친다.
//
// env (편집기가 넘긴다. 시험에서는 가짜를 넣는다)
//  api            hwpApi(id) 와 같은 모양 { info, outline, blocks, fields, pages, edit, versions, restore, lint, compare, redactionSuggest, ... }
//  getVersion()   화면이 보고 있는 현재 버전
//  getInfo()      FileInfo
//  canEdit()      편집 권한
//  getSelection() { block, cell, page } | null
//  afterEdit(res, { prev, kind })  편집 성공 뒤 화면 갱신 + 실행취소 기록
//  undoTo(prevVersion, expectedVersion)  지난 버전으로 되돌리기(새 버전으로 복원)
//  refresh()      서버에서 최신 상태 다시 읽기
//  confirm({title,message,confirmLabel})  Promise<boolean>
//  getSealImage() 올려 둔 도장 이미지 data URL | null
//  download(format, version)  브라우저 내려받기
//  announceNewFile({id,title})
//  shrinkImage(dataUrl)       (선택) 이미지 줄이기
import { clampInt, cleanText, isBlockId, isCellId, parseCellId, indexBlocks, errorText, summarizeEdit, skippedBrief, lintFixFor, pairDiffs } from './hwpCore.js'
import { fixGongmunText, RULE_KO } from './gongmunRules.js'

export const MAX_READ_CHARS = 12000
const MAX_CELL_PREVIEW = 120
const MAX_OPS = 200
const FILL_CONFIRM_OVER = 10

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const clip = (s, n) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

const TYPE_CODE = { heading: 'h', paragraph: 'p', list_item: 'li', table: 'tbl', image: 'img', separator: 'sep', footnote: 'fn' }

/** 블록 하나를 모델에게 줄 작은 모양으로 */
export function compactBlock(b) {
  const o = { id: b.id, t: b.type === 'heading' ? `h${b.level || 1}` : TYPE_CODE[b.type] || b.type }
  if (b.page) o.page = b.page
  if (b.type === 'table' && b.table) {
    const { rows, cols, cells } = b.table
    o.rows = rows
    o.cols = cols
    o.grid = cells.map((row) => row.map((c) => (!c || c.covered ? null : clip(c.text, MAX_CELL_PREVIEW))))
    const merges = []
    const locked = []
    for (const row of cells) {
      for (const c of row) {
        if (!c || c.covered) continue
        if ((c.rowSpan || 1) > 1 || (c.colSpan || 1) > 1) merges.push(`r${c.row}c${c.col}:${c.rowSpan || 1}x${c.colSpan || 1}`)
        if (c.editable === false) locked.push(`r${c.row}c${c.col}`)
      }
    }
    if (merges.length) o.merges = merges
    if (locked.length) o.locked = locked
    return o
  }
  if (b.text !== undefined) o.text = clip(b.text, 1200)
  if (b.editable === 'locked') o.locked = b.reason || true
  return o
}

function lenOf(o) {
  try {
    return JSON.stringify(o).length
  } catch {
    return 0
  }
}

export function createHwpTools(env) {
  const A = () => env.api
  let blockCache = { version: null, map: null }
  let lastLint = { version: null, findings: [] }

  const need = (cond, msg) => {
    if (!cond) throw new Error(msg)
  }
  const needEdit = () => need(env.canEdit(), '보기 권한이라 문서를 고칠 수 없습니다. 고칠 내용을 글로 제안하세요')
  const str = (v, max, name) => {
    const t = cleanText(v, max)
    need(t !== null, `${name} 은(는) 글이어야 합니다`)
    return t
  }
  // 범위를 넘으면 조용히 고치지 않고 거절한다(엉뚱한 칸을 고치는 것을 막는다)
  const intArg = (v, lo, hi, name, msg) => {
    const n = Number(v)
    need(Number.isInteger(n) && n >= lo && n <= hi, msg || `${name} 은(는) ${lo} 이상 ${hi} 이하의 정수여야 합니다`)
    return n
  }
  const blockArg = (v, name = 'block') => {
    need(isBlockId(v), `${name} 은(는) 블록 번호(예: b12)여야 합니다. get_outline 이나 read_blocks 로 확인하세요`)
    return v
  }

  async function allBlocks(version = env.getVersion()) {
    if (blockCache.map && blockCache.version === version) return blockCache.map
    const list = []
    let from = 0
    let total = Infinity
    while (from < total && from < 6000) {
      const r = await A().blocks(from, from + 300, version)
      total = r.total ?? 0
      list.push(...(r.blocks || []))
      if (!r.blocks?.length) break
      from += 300
    }
    const map = indexBlocks(list)
    blockCache = { version, map }
    return map
  }
  const dropCache = () => {
    blockCache = { version: null, map: null }
  }

  /** 편집 요청 한 번. VERSION_CONFLICT 면 최신으로 다시 읽고 한 번 더 시도한다 */
  async function runEdit(ops, { note, dry_run = false, strict = false } = {}) {
    need(Array.isArray(ops) && ops.length > 0, '적용할 편집이 없습니다')
    need(ops.length <= MAX_OPS, `한 번에 ${MAX_OPS}개까지 고칠 수 있습니다`)
    const prev = env.getVersion()
    const body = { ops, source: 'ai', ...(note ? { note: clip(note, 190) } : {}), ...(dry_run ? { dry_run: true } : {}), ...(strict ? { strict: true } : {}) }
    let res
    try {
      res = await A().edit({ ...body, base_version: prev })
    } catch (e) {
      if (e?.code === 'VERSION_CONFLICT') {
        await env.refresh?.()
        dropCache()
        res = await A().edit({ ...body, base_version: env.getVersion() })
      } else if (e?.code === 'NO_VALID_OPS' && Array.isArray(e.body?.error?.skipped)) {
        // 적용할 수 있는 편집이 없었다: 이유를 모델이 읽을 수 있게 결과로 돌려준다
        res = { version: prev, changed: false, applied: [], skipped: e.body.error.skipped }
      } else {
        throw new Error(errorText(e))
      }
    }
    if (!dry_run && res.changed) {
      dropCache()
      await env.afterEdit(res, { prev, kind: 'ai' })
    }
    return { res, prev }
  }

  const editResult = (res, prev, extra = {}) => ({
    result: {
      ok: Boolean(res.changed) || res.applied?.length > 0,
      version: res.version,
      applied: (res.applied || []).slice(0, 12).map((a) => ({ type: a.type, block: a.block, ...(a.new_blocks?.length ? { new_blocks: a.new_blocks } : {}), ...(a.targets?.length ? { targets: a.targets.slice(0, 6) } : {}), before: clip(a.before, 80), after: clip(a.after, 80) })),
      applied_count: res.applied?.length || 0,
      skipped: skippedBrief(res),
      skipped_count: res.skipped?.length || 0,
      pages_changed: res.pages_changed,
      ...(res.verify && res.verify.ok === false ? { verify: { ok: false, issues: (res.verify.issues || []).slice(0, 3) } } : {}),
      ...extra,
    },
    summary: summarizeEdit(res),
    ...(res.changed && prev !== res.version ? { undo: () => env.undoTo(prev, res.version) } : {}),
  })

  const tools = []
  const add = (name, description, properties, required, run) => {
    tools.push({
      name,
      description,
      parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
      run: async (args) => {
        try {
          return await run(isObj(args) ? args : {})
        } catch (e) {
          if (e?.code) throw new Error(errorText(e))
          throw e
        }
      },
    })
  }

  // ───────────── 읽기 ─────────────

  add(
    'get_outline',
    '문서 구조를 본다: 제목 목록(블록 번호, 쪽), 표 목록, 쪽 수, 양식 칸 수, 형식(hwpx/hwp), 되는 편집 연산, 최근 버전. 문서를 다루기 전에 가장 먼저 부른다.',
    {},
    [],
    async () => {
      const v = env.getVersion()
      const [o, vs] = await Promise.all([A().outline(v), A().versions().catch(() => null)])
      const info = env.getInfo?.() || {}
      const result = {
        version: o.version,
        format: o.format || info.format,
        title: o.title || info.title,
        pages: info.page_count ?? o.metadata?.pageCount,
        edit_ops: (info.edit_support && info.edit_support[o.format || info.format]) || undefined,
        render_mode: info.render_mode,
        stats: o.stats,
        headings: (o.headings || []).slice(0, 60).map((h) => ({ block: h.block, level: h.level, text: clip(h.text, 60), page: h.page })),
        tables: (o.tables || []).slice(0, 30).map((t) => ({ block: t.block, rows: t.rows, cols: t.cols, page: t.page, header: (t.header || []).slice(0, 6).map((x) => clip(x, 20)) })),
        field_count: (o.fields || []).length,
        protected: o.protected || undefined,
        versions: vs ? (vs.items || []).slice(0, 6).map((x) => ({ version: x.version, note: clip(x.note, 40), source: x.source, at: x.created_at })) : undefined,
        hint: '블록 내용은 read_blocks({from,to}) 로 읽는다. 표 칸 번호는 표번호#r행c열 (0부터).',
      }
      return { result, summary: `구조를 읽음 (${result.pages ?? '?'}쪽)` }
    }
  )

  add(
    'read_blocks',
    '블록(문단, 제목, 목록 항목, 표)을 문서 순서로 읽는다. from 은 0부터 시작하는 순번, to 는 포함하지 않는다. 표는 grid(행 x 열 글)로 준다. 칸 번호는 "표번호#r행c열". 병합 칸은 null, merges 에 크기가 나온다. 결과가 길면 next_from 으로 이어 읽는다.',
    {
      from: { type: 'integer', description: '시작 순번(0부터). 기본 0' },
      to: { type: 'integer', description: '끝 순번(포함하지 않음). 기본 from+60, 최대 from+300' },
    },
    [],
    async (a) => {
      const from = clampInt(a.from, 0, 100000, 0)
      const to = clampInt(a.to, from + 1, from + 300, from + 60)
      const r = await A().blocks(from, to, env.getVersion())
      const out = []
      let size = 0
      let next = null
      for (const b of r.blocks || []) {
        const c = compactBlock(b)
        const n = lenOf(c)
        if (out.length && size + n > MAX_READ_CHARS) {
          next = b.index ?? from + out.length
          break
        }
        size += n
        out.push(c)
      }
      if (next === null && (r.to ?? to) < r.total && (r.blocks || []).length) next = r.to ?? to
      const result = { version: r.version, total: r.total, from, blocks: out, ...(next !== null ? { truncated: true, next_from: next } : {}) }
      return { result, summary: `${out.length}개 블록을 읽음` }
    }
  )

  add(
    'read_page',
    '한 쪽에 들어 있는 블록들의 글을 읽는다(쪽 번호는 1부터). 쪽 모양이 중요하면 look_at_page 를 쓴다.',
    { page: { type: 'integer', description: '쪽 번호(1부터)' } },
    ['page'],
    async (a) => {
      const page = clampInt(a.page, 1, 9999, 1)
      const v = env.getVersion()
      const p = await A().pages(page, page, v, { format: 'svg' })
      const pg = (p.pages || [])[0]
      need(pg, `${page}쪽이 없습니다 (전체 ${p.page_count}쪽)`)
      const map = await allBlocks(v)
      const seen = new Set()
      const out = []
      for (const r of pg.regions || []) {
        if (!r.block || seen.has(r.block)) continue
        seen.add(r.block)
        const b = map.get(r.block)
        if (b) out.push(compactBlock(b))
      }
      let size = 0
      const kept = []
      for (const c of out) {
        size += lenOf(c)
        if (kept.length && size > MAX_READ_CHARS) break
        kept.push(c)
      }
      return { result: { version: p.version, page, page_count: p.page_count, blocks: kept, ...(kept.length < out.length ? { truncated: true } : {}), warnings: p.warnings?.slice(0, 3) }, summary: `${page}쪽을 읽음` }
    }
  )

  add(
    'look_at_page',
    '한 쪽을 그림으로 본다(쪽 번호는 1부터). 이미지는 이 도구 결과 바로 뒤에 붙어 다음 답에서 볼 수 있다. 표의 모양, 정렬, 도장 자리, 글머리 부호처럼 글만으로 알 수 없는 배치를 확인할 때 쓴다. 이미지를 볼 수 없는 모델이면 read_page 를 쓴다.',
    { page: { type: 'integer', description: '쪽 번호(1부터)' } },
    ['page'],
    async (a) => {
      const page = clampInt(a.page, 1, 9999, 1)
      let p = null
      let pg = null
      try {
        p = await A().pages(page, page, env.getVersion(), { format: 'png', scale: 1.2 })
        pg = (p.pages || [])[0]
      } catch {
        /* 서버가 PNG 를 못 만드는 환경이면 쪽 그림(svg)을 브라우저에서 그림으로 바꾼다 */
      }
      let image = pg?.image || null
      if (image && env.shrinkImage) image = await env.shrinkImage(image)
      if (!image && env.rasterizeSvg) {
        p = await A().pages(page, page, env.getVersion(), { format: 'svg' })
        pg = (p.pages || [])[0]
        if (pg?.svg) image = await env.rasterizeSvg(pg.svg, pg.width, pg.height)
      }
      need(pg, `${page}쪽이 없습니다 (전체 ${p?.page_count ?? '?'}쪽)`)
      need(image, '이 쪽은 그림으로 만들 수 없습니다. read_page 로 글을 읽으세요')
      return { result: { page, page_count: p.page_count, width_pt: pg.width, height_pt: pg.height, note: '이미지가 이 결과 뒤에 붙어 있습니다. 보이지 않으면 read_page 로 글을 읽으세요.' }, summary: `${page}쪽 화면을 봄`, images: [image] }
    }
  )

  add(
    'find_in_document',
    '문서(본문과 표 칸)에서 글을 찾아 블록 번호와 앞뒤 글을 돌려준다. 최대 30곳.',
    { query: { type: 'string', description: '찾을 글(일반 글자)' }, match_case: { type: 'boolean', description: '영문 대소문자 구분. 기본 false' } },
    ['query'],
    async (a) => {
      const q = str(a.query, 200, 'query')
      need(q.length > 0, '찾을 글이 비었습니다')
      const map = await allBlocks()
      const ci = a.match_case !== true
      const needle = ci ? q.toLowerCase() : q
      const hits = []
      const test = (text) => {
        const hay = ci ? text.toLowerCase() : text
        const i = hay.indexOf(needle)
        return i < 0 ? null : clip(text.slice(Math.max(0, i - 20), i + q.length + 30), 90)
      }
      let total = 0
      for (const b of map.values()) {
        if (b.type === 'table' && b.table) {
          for (const row of b.table.cells) {
            for (const c of row) {
              if (!c || c.covered) continue
              const s = test(String(c.text ?? ''))
              if (s) {
                total += 1
                if (hits.length < 30) hits.push({ cell: c.id, page: b.page, text: s })
              }
            }
          }
        } else if (typeof b.text === 'string') {
          const s = test(b.text)
          if (s) {
            total += 1
            if (hits.length < 30) hits.push({ block: b.id, page: b.page, text: s })
          }
        }
      }
      return { result: { query: q, total, shown: hits.length, hits }, summary: total ? `${total}곳 찾음` : '찾는 글이 없음' }
    }
  )

  // ───────────── 고치기 ─────────────

  add(
    'replace_block',
    '블록 하나(문단, 제목, 목록 항목)의 글을 바꾼다. 글자 모양과 문단 서식은 그대로 둔다. 여러 블록을 한 번에 바꾸려면 edits 배열을 쓴다(최대 100개, 버전 하나로 묶임). 표 칸은 replace_cell. expect 에 지금 글의 앞부분을 넣으면 그 사이 바뀐 경우 건너뛴다.',
    {
      block: { type: 'string', description: '블록 번호(예: b12)' },
      text: { type: 'string', description: '새 글. 줄바꿈은 \\n. 항목 부호(1. 가. ○ 등)는 글에 직접 쓴다' },
      expect: { type: 'string', description: '선택. 지금 글이 이 글로 시작해야 적용' },
      edits: { type: 'array', description: '여러 블록: [{block, text, expect?}]', items: { type: 'object', properties: { block: { type: 'string' }, text: { type: 'string' }, expect: { type: 'string' } }, required: ['block', 'text'] } },
    },
    [],
    async (a) => {
      needEdit()
      const list = Array.isArray(a.edits) ? a.edits.slice(0, 100) : [{ block: a.block, text: a.text, expect: a.expect }]
      need(list.length > 0 && list.every(isObj), 'block 과 text 를 주세요')
      const ops = list.map((e) => ({
        type: 'replace_block',
        block: blockArg(e.block),
        text: str(e.text, 20000, 'text'),
        ...(typeof e.expect === 'string' && e.expect ? { expect: cleanText(e.expect, 200) } : {}),
      }))
      const { res, prev } = await runEdit(ops, { note: ops.length > 1 ? `AI: ${ops.length}개 블록 고침` : 'AI: 블록 고침' })
      return editResult(res, prev)
    }
  )

  add(
    'replace_cell',
    '표 칸의 글을 바꾼다. 칸은 cell("표번호#r행c열", 예 b20#r2c1) 또는 table+row+col(0부터)로 가리킨다. 여러 칸은 edits 배열(최대 100개)로 한 번에. 병합된 칸은 왼쪽 위 칸만 고칠 수 있다.',
    {
      cell: { type: 'string', description: '칸 번호(예: b20#r2c1)' },
      table: { type: 'string', description: '표 블록 번호' },
      row: { type: 'integer' },
      col: { type: 'integer' },
      text: { type: 'string', description: '새 글' },
      expect: { type: 'string' },
      edits: { type: 'array', description: '여러 칸: [{cell, text, expect?}]', items: { type: 'object', properties: { cell: { type: 'string' }, text: { type: 'string' }, expect: { type: 'string' } }, required: ['cell', 'text'] } },
    },
    [],
    async (a) => {
      needEdit()
      const list = Array.isArray(a.edits) ? a.edits.slice(0, 100) : [{ cell: a.cell, table: a.table, row: a.row, col: a.col, text: a.text, expect: a.expect }]
      need(list.length > 0 && list.every(isObj), 'cell 과 text 를 주세요')
      const ops = list.map((e) => {
        let p = null
        if (typeof e.cell === 'string' && e.cell) {
          need(isCellId(e.cell), 'cell 은 "표번호#r행c열"(예: b20#r2c1) 형식이어야 합니다')
          p = parseCellId(e.cell)
        } else {
          p = { table: blockArg(e.table, 'table'), row: intArg(e.row, 0, 999, 'row', 'row 와 col 은 0 이상의 정수여야 합니다'), col: intArg(e.col, 0, 999, 'col', 'row 와 col 은 0 이상의 정수여야 합니다') }
        }
        return { type: 'replace_cell', table: p.table, row: p.row, col: p.col, text: str(e.text, 5000, 'text'), ...(typeof e.expect === 'string' && e.expect ? { expect: cleanText(e.expect, 200) } : {}) }
      })
      const { res, prev } = await runEdit(ops, { note: ops.length > 1 ? `AI: ${ops.length}개 칸 고침` : 'AI: 표 칸 고침' })
      return editResult(res, prev)
    }
  )

  add(
    'replace_text',
    '찾아 바꾸기. 서식은 그대로 두고 글만 바꾼다. 기본은 문서 전체에서 모두 바꾼다. scope 로 본문(body), 표 안(tables), 한 블록(block:b12)만 정할 수 있다. .hwp 파일은 바꿀 글이 원래 글보다 같거나 짧아야 한다.',
    {
      find: { type: 'string', description: '찾을 글' },
      replace: { type: 'string', description: '바꿀 글(빈 글이면 지움)' },
      all: { type: 'boolean', description: '모두 바꿈. 기본 true' },
      scope: { type: 'string', description: "'body' | 'tables' | 'block:b12'. 생략하면 전체" },
      match_case: { type: 'boolean' },
    },
    ['find', 'replace'],
    async (a) => {
      needEdit()
      const find = str(a.find, 500, 'find')
      need(find.length > 0, '찾을 글이 비었습니다')
      const replace = str(a.replace, 2000, 'replace')
      let scope
      if (typeof a.scope === 'string' && a.scope) {
        need(a.scope === 'body' || a.scope === 'tables' || /^block:b\d{1,9}$/.test(a.scope), "scope 는 'body', 'tables', 'block:b12' 중 하나여야 합니다")
        scope = a.scope
      }
      const op = { type: 'replace_text', find, replace, ...(a.all === false ? { all: false } : {}), ...(scope ? { scope } : {}), ...(a.match_case === true ? { match_case: true } : {}) }
      const { res, prev } = await runEdit([op], { note: `AI: "${clip(find, 20)}" 바꾸기` })
      return editResult(res, prev)
    }
  )

  add(
    'insert_paragraph_after',
    '지정한 블록 바로 뒤에 새 문단을 넣는다. like 로 서식을 따라 할 블록을 정한다(기본은 앞 블록). 여러 문단은 texts 배열(순서대로, 최대 30개). .hwp 파일은 지원하지 않는다.',
    {
      block: { type: 'string', description: '이 블록 뒤에 넣는다' },
      text: { type: 'string', description: '새 문단 글' },
      texts: { type: 'array', items: { type: 'string' }, description: '여러 문단(순서대로)' },
      like: { type: 'string', description: '서식을 복제할 블록 번호' },
    },
    ['block'],
    async (a) => {
      needEdit()
      const block = blockArg(a.block)
      const like = a.like ? blockArg(a.like, 'like') : undefined
      const list = Array.isArray(a.texts) ? a.texts.slice(0, 30) : [a.text]
      need(list.length > 0 && list.every((t) => typeof t === 'string'), 'text 또는 texts 를 주세요')
      // 같은 자리 뒤에 거꾸로 넣으면 순서가 맞는다
      const ops = [...list].reverse().map((t) => ({ type: 'insert_paragraph_after', block, text: str(t, 5000, 'text'), ...(like ? { like } : {}) }))
      const { res, prev } = await runEdit(ops, { note: `AI: 문단 ${list.length}개 추가` })
      return editResult(res, prev)
    }
  )

  add(
    'delete_block',
    '블록을 지운다(문단, 표 전체 포함). 반드시 사용자에게 먼저 어느 블록을 지울지 말하고 허락을 받은 뒤 confirmed:true 로 부른다. confirmed 없이 부르면 실행하지 않는다. 되돌릴 수 있다.',
    { block: { type: 'string' }, confirmed: { type: 'boolean', description: '사용자가 지우라고 분명히 말했을 때만 true' } },
    ['block'],
    async (a) => {
      needEdit()
      const block = blockArg(a.block)
      if (a.confirmed !== true) {
        return { result: { ok: false, wrote: false, needsConfirmation: true, message: `${block} 블록을 지우려고 합니다.`, hint: '사용자에게 지울 블록을 알리고 허락을 받은 뒤 confirmed:true 로 다시 호출하세요.' }, summary: '확인이 필요해 멈춤' }
      }
      const ok = await env.confirm({ title: '블록 지우기', message: `${block} 블록을 지웁니다. 버전 기록에서 되돌릴 수 있습니다.`, confirmLabel: '지우기' })
      if (!ok) return { result: { ok: false, wrote: false, cancelled: true, message: '사용자가 취소했습니다' }, summary: '사용자가 취소' }
      const { res, prev } = await runEdit([{ type: 'delete_block', block }], { note: 'AI: 블록 지움' })
      return editResult(res, prev)
    }
  )

  add(
    'table_add_rows',
    '표에서 after_row 행 뒤에 행을 더한다(0부터, 이웃 행의 서식과 병합을 복사). rows 는 새 행들의 칸 글 배열 [[칸1, 칸2, ...], ...](최대 30행). 열 수에 맞춘다. 행을 더하면 그 아래 칸 번호가 밀리니 이어서 고칠 때는 표를 다시 읽는다. .hwp 파일은 지원하지 않는다.',
    {
      table: { type: 'string', description: '표 블록 번호' },
      after_row: { type: 'integer', description: '이 행 뒤에 추가(0부터). 맨 끝에 넣으려면 마지막 행 번호' },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '새 행들의 칸 글' },
    },
    ['table', 'after_row', 'rows'],
    async (a) => {
      needEdit()
      const table = blockArg(a.table, 'table')
      const after_row = intArg(a.after_row, 0, 9999, 'after_row', 'after_row 는 0 이상의 정수여야 합니다')
      need(Array.isArray(a.rows) && a.rows.length > 0 && a.rows.length <= 30, 'rows 는 1~30행이어야 합니다')
      const rows = a.rows.map((r) => {
        need(Array.isArray(r) && r.length <= 40, 'rows 의 각 행은 칸 글 배열이어야 합니다')
        return r.map((c) => str(String(c ?? ''), 2000, '칸 글'))
      })
      const { res, prev } = await runEdit([{ type: 'table_add_rows', table, after_row, rows }], { note: `AI: 표에 ${rows.length}행 추가` })
      return editResult(res, prev)
    }
  )

  // ───────────── 양식 ─────────────

  add(
    'list_form_fields',
    '양식 칸(누름틀, 라벨 옆 빈칸) 목록을 본다: 이름, 종류(clickhere=누름틀, label=라벨 칸), 지금 값, 비었는지, 안내문. fill_form 에 쓸 이름을 여기서 확인한다.',
    {},
    [],
    async () => {
      const r = await A().fields(env.getVersion())
      const fields = (r.fields || []).slice(0, 120).map((f) => ({ name: f.name, kind: f.kind, empty: f.empty, ...(f.value && !f.empty ? { value: clip(f.value, 40) } : {}), ...(f.hint ? { hint: clip(f.hint, 40) } : {}), block: f.cell || f.block }))
      return { result: { version: r.version, count: (r.fields || []).length, confidence: r.confidence, fields }, summary: `양식 칸 ${(r.fields || []).length}개` }
    }
  )

  add(
    'fill_form',
    '양식 칸을 채운다. values 는 {칸 이름: 값}. 항상 먼저 dry_run:true 로 어디가 어떻게 바뀔지 확인하고, 찾지 못한 이름(unmatched)을 사용자에게 알린다. 사용자가 준 값과 문서에 이미 있는 값만 쓰고, 모르는 값은 비워 두거나 묻는다. 칸이 10개를 넘으면 사용자 허락 뒤 confirmed:true 가 있어야 적용한다.',
    {
      values: { type: 'object', description: '{칸 이름: 값}. 같은 이름이 여러 곳이면 값 배열', additionalProperties: true },
      dry_run: { type: 'boolean', description: '미리보기만(문서를 바꾸지 않음). 처음에는 true' },
      confirmed: { type: 'boolean', description: '11개 이상 적용할 때 사용자 허락을 받았으면 true' },
      require_unique: { type: 'boolean', description: '같은 이름이 여러 곳이면 건너뜀' },
    },
    ['values'],
    async (a) => {
      need(isObj(a.values), 'values 는 {칸 이름: 값} 객체여야 합니다')
      const values = {}
      for (const [k, v] of Object.entries(a.values).slice(0, 200)) {
        const name = cleanText(k, 60)?.trim()
        if (!name) continue
        values[name] = Array.isArray(v) ? v.slice(0, 20).map((x) => cleanText(String(x ?? ''), 1000)) : cleanText(String(v ?? ''), 2000)
      }
      const names = Object.keys(values)
      need(names.length > 0, '채울 값이 없습니다')
      const dry = a.dry_run === true
      if (!dry) needEdit()
      const fieldsNow = await A().fields(env.getVersion()).catch(() => null)
      const known = new Set((fieldsNow?.fields || []).map((f) => f.name))
      const unmatchedPre = known.size ? names.filter((n) => !known.has(n)) : []
      const op = { type: 'fill_fields', values, ...(a.require_unique ? { require_unique: true } : {}) }
      if (!dry && names.length > FILL_CONFIRM_OVER && a.confirmed !== true) {
        return { result: { ok: false, wrote: false, needsConfirmation: true, count: names.length, message: `양식 칸 ${names.length}개를 한 번에 채우려 합니다.`, hint: 'dry_run 결과를 사용자에게 보여 주고 허락을 받은 뒤 confirmed:true 로 다시 호출하세요.' }, summary: '확인이 필요해 멈춤' }
      }
      const { res, prev } = await runEdit([op], { dry_run: dry, note: `AI: 양식 ${names.length}칸 채움` })
      const filled = new Set()
      for (const ap of res.applied || []) for (const t of ap.targets || []) if (t.name) filled.add(t.name)
      const unmatched = unmatchedPre.length ? unmatchedPre : (res.skipped || []).filter((s) => s.reason === 'NOT_FOUND').map((s) => s.message).slice(0, 10)
      if (dry) {
        return {
          result: { dry_run: true, would_apply: res.applied?.length || 0, targets: (res.applied || []).slice(0, 20).map((x) => ({ block: x.block, before: clip(x.before, 30), after: clip(x.after, 30), targets: x.targets?.slice(0, 4) })), unmatched, skipped: skippedBrief(res), next: '문제가 없으면 dry_run 없이 다시 호출해 적용하세요(11칸 이상은 사용자 허락 뒤 confirmed:true).' },
          summary: `${res.applied?.length || 0}곳 채울 예정${unmatched.length ? `, 못 찾은 칸 ${unmatched.length}` : ''}`,
        }
      }
      return editResult(res, prev, { unmatched })
    }
  )

  // ───────────── 공문 검사와 고침 ─────────────

  add(
    'check_gongmun',
    '공문서 표기법 검사(날짜, 시각, 금액, 붙임, 끝 표시, 쌍점, 문체 등)를 돌린다. 각 항목에 id(L1…), 블록 번호, 규칙, 지금 글(match), 설명용 예시(hint: 그대로 바꿔 넣는 글이 아니다), auto_fix(자동으로 고칠 수 있는지)가 있다. 자동으로 고치는 것은 fix_gongmun, 그 밖의 항목(금액 한글 병기, 끝 표시 누락, 문체 등)은 글을 읽고 replace_block 으로 고친다.',
    { include_info: { type: 'boolean', description: '참고(info) 수준도 포함. 기본 false' } },
    [],
    async (a) => {
      const r = await A().lint()
      const all = (r.findings || []).filter((f) => a.include_info === true || f.severity !== 'info')
      const map = await allBlocks().catch(() => new Map())
      const shown = all.slice(0, 40).map((f, i) => ({ ...f, id: `L${i + 1}` }))
      const findings = shown.map((f) => ({ id: f.id, block: f.cell || f.block, rule: f.rule, severity: f.severity, message: clip(f.message, 80), match: clip(f.match, 40), hint: clip(f.suggest, 40), auto_fix: Boolean(lintFixFor(f, map)) }))
      lastLint = { version: r.version, findings: shown }
      const fixable = findings.filter((f) => f.auto_fix).length
      return { result: { version: r.version, counts: r.counts, total: all.length, shown: findings.length, auto_fixable: fixable, findings, next: findings.length ? 'auto_fix 가 true 인 항목은 fix_gongmun({issue_ids:[...]}) 으로 고친다. 나머지는 글을 읽고 replace_block 으로 직접 고친다.' : '지적 없음' }, summary: all.length ? `${all.length}건 지적 (자동 고침 ${fixable})` : '지적 없음' }
    }
  )

  add(
    'fix_gongmun',
    '안전하게 자동으로 고칠 수 있는 표기 오류(날짜 형식, 시각 24시각제, 붙임·끝 표시의 2칸, 쌍점, 물결표, 항목부호 뒤 한 칸)를 한 번에 고친다. 버전 하나로 묶여 되돌리기 한 번이면 돌아간다. issue_ids 를 주면 check_gongmun 의 그 항목이 있는 블록만(auto_fix 가 true 인 것), 생략하면 문서 전체 본문에 위 규칙을 적용한다. 날짜나 숫자를 지어내지 않고 형식만 바꾼다.',
    {
      issue_ids: { type: 'array', items: { type: 'string' }, description: 'check_gongmun 의 항목 id(L1…). 생략하면 규칙 전체 적용' },
      rules: { type: 'array', items: { type: 'string' }, description: `전체 적용 때 쓸 규칙: ${Object.keys(RULE_KO).join(', ')}` },
    },
    [],
    async (a) => {
      needEdit()
      const ops = []
      const used = []
      if (Array.isArray(a.issue_ids) && a.issue_ids.length) {
        need(lastLint.findings.length > 0, '먼저 check_gongmun 으로 검사하세요')
        need(lastLint.version === env.getVersion(), '문서가 바뀌었습니다. check_gongmun 을 다시 돌리세요')
        // 서버 suggest 는 설명용 예시라 쓰지 않는다: 지적된 블록(칸)의 글에 이쪽 표기 규칙을 적용해 고친 글을 만든다
        const map = await allBlocks()
        const seen = new Set()
        for (const id of a.issue_ids.slice(0, 100)) {
          const f = lastLint.findings.find((x) => x.id === String(id))
          if (!f) continue
          const key = f.cell || f.block
          if (seen.has(key)) continue
          const op = lintFixFor(f, map)
          if (!op) continue
          seen.add(key)
          ops.push(op)
          used.push(f.rule)
        }
      } else {
        const only = Array.isArray(a.rules) && a.rules.length ? a.rules.filter((r) => RULE_KO[r]) : undefined
        const map = await allBlocks()
        for (const b of map.values()) {
          if (ops.length >= MAX_OPS - 1) break
          if (b.type === 'table' && b.table) {
            for (const row of b.table.cells) {
              for (const c of row) {
                if (!c || c.covered || c.editable === false || !c.text) continue
                const r = fixGongmunText(String(c.text), only)
                if (r.changes.length && r.text !== c.text && ops.length < MAX_OPS - 1) {
                  const p = parseCellId(c.id)
                  ops.push({ type: 'replace_cell', table: p.table, row: p.row, col: p.col, text: r.text, expect: c.text })
                  used.push(...r.changes.map((x) => x.rule))
                }
              }
            }
          } else if (typeof b.text === 'string' && b.text && b.editable !== 'locked' && (b.type === 'paragraph' || b.type === 'heading' || b.type === 'list_item')) {
            const r = fixGongmunText(b.text, only)
            if (r.changes.length && r.text !== b.text) {
              ops.push({ type: 'replace_block', block: b.id, text: r.text, expect: b.text })
              used.push(...r.changes.map((x) => x.rule))
            }
          }
        }
      }
      if (!ops.length) return { result: { ok: true, changed: false, message: '자동으로 고칠 표기 오류가 없습니다' }, summary: '고칠 곳 없음' }
      const { res, prev } = await runEdit(ops, { note: 'AI: 공문 표기 고침' })
      const byRule = {}
      for (const r of used) byRule[RULE_KO[r] || r] = (byRule[RULE_KO[r] || r] || 0) + 1
      return editResult(res, prev, { by_rule: byRule })
    }
  )

  const convertJob = (name, kind) => {
    const toGae = kind === 'gaejosik'
    add(
      name,
      toGae
        ? '문서(또는 범위)를 개조식으로 바꾸는 작업 준비. 바꿀 블록의 글을 돌려주니, 그 글을 개조식 규칙(시스템 프롬프트의 "개조식")대로 직접 고쳐 replace_block 의 edits 로 한 번에 적용한다. 이 도구는 문서를 바꾸지 않는다.'
        : '문서(또는 범위)를 줄글(서술형 문장)로 바꾸는 작업 준비. 바꿀 블록의 글을 돌려주니, 그 글을 문장으로 풀어 replace_block 의 edits 로 한 번에 적용한다. 이 도구는 문서를 바꾸지 않는다.',
      {
        scope: { type: 'string', description: "'all'(문서 전체 본문) | 'selection'(선택한 블록) | 'range'(from~to 순번). 기본 all" },
        from: { type: 'integer' },
        to: { type: 'integer' },
      },
      [],
      async (a) => {
        needEdit()
        const scope = ['all', 'selection', 'range'].includes(a.scope) ? a.scope : 'all'
        const map = await allBlocks()
        let list = [...map.values()]
        if (scope === 'selection') {
          const sel = env.getSelection?.()
          need(sel?.block, '선택한 블록이 없습니다. 블록을 눌러 선택하거나 scope 를 바꾸세요')
          list = list.filter((b) => b.id === sel.block)
        } else if (scope === 'range') {
          const from = clampInt(a.from, 0, 100000, 0)
          const to = clampInt(a.to, from + 1, from + 300, from + 60)
          list = list.filter((b) => (b.index ?? 0) >= from && (b.index ?? 0) < to)
        }
        const out = []
        let size = 0
        let truncated = false
        for (const b of list) {
          if (!(b.type === 'paragraph' || b.type === 'list_item' || b.type === 'heading') || !b.text || b.editable === 'locked') continue
          size += (b.text || '').length + 20
          if (size > MAX_READ_CHARS) {
            truncated = true
            break
          }
          out.push({ id: b.id, t: b.type === 'heading' ? `h${b.level || 1}` : b.type === 'list_item' ? 'li' : 'p', text: b.text })
        }
        return {
          result: {
            job: toGae ? 'convert_to_gaejosik' : 'convert_to_sentence',
            instruction: toGae
              ? '아래 블록의 글을 개조식으로 고쳐 replace_block({edits:[{block,text}]}) 로 한 번에 적용하세요. 제목은 그대로 두고, 본문은 명사형으로 끝내며 항목 부호 위계를 지키세요. 사실과 숫자는 그대로.'
              : '아래 블록의 글을 완결된 문장(~합니다/~한다 중 문서의 기존 말투)으로 풀어 replace_block({edits:[{block,text}]}) 로 한 번에 적용하세요. 사실과 숫자는 그대로.',
            blocks: out,
            ...(truncated ? { truncated: true, next: '범위를 나누어 scope:"range" 로 이어서 하세요' } : {}),
          },
          summary: `${out.length}개 블록 변환 준비`,
        }
      }
    )
  }
  convertJob('convert_to_gaejosik', 'gaejosik')
  convertJob('convert_to_sentence', 'sentence')

  // ───────────── 버전, 비교, 되돌리기 ─────────────

  add(
    'compare_with_version',
    '지금 문서를 지난 버전과 비교해(신구대조) 바뀐 블록을 돌려준다. version 을 생략하면 버전 목록을 준다. 변경 요약을 사용자에게 1~3줄로 정리할 때 쓴다.',
    { version: { type: 'integer', description: '비교할 지난 버전 번호' } },
    [],
    async (a) => {
      if (a.version === undefined || a.version === null) {
        const vs = await A().versions()
        return { result: { current: vs.current, versions: (vs.items || []).slice(0, 20).map((x) => ({ version: x.version, note: clip(x.note, 50), source: x.source, at: x.created_at, by: x.created_by, diff: x.diff_summary })) }, summary: '버전 목록' }
      }
      const to = intArg(a.version, 1, 100000, 'version', 'version 은 양의 정수여야 합니다')
      // 신구대조: 지난 버전(to 로 받은 번호) -> 지금. before 는 지난 버전의 글, after 는 지금 글
      const r = await A().compare(env.getVersion(), to)
      const paired = pairDiffs(r.diffs)
      const diffs = paired.slice(0, 40).map((d) => ({ type: d.type, block: d.block, ...(d.before !== undefined ? { before: clip(d.before, 100) } : {}), ...(d.after !== undefined ? { after: clip(d.after, 100) } : {}), ...(d.cells ? { cells: d.cells.slice(0, 6).map((c) => ({ r: c.row, c: c.col, before: clip(c.before, 40), after: clip(c.after, 40) })) } : {}) }))
      const n = paired.length
      return { result: { old_version: to, new_version: env.getVersion(), stats: r.stats, shown: diffs.length, total: n, diffs, note: 'before 는 지난 버전의 글, after 는 지금 글입니다. type: modified 바뀜, added 지금 새로 생김, removed 지금은 없어짐.' }, summary: `${n}곳 달라짐` }
    }
  )

  add(
    'restore_version',
    '지난 버전으로 되돌린다(새 버전으로 만들어지므로 지금 상태도 기록에 남는다). 사용자가 되돌리라고 했을 때만 쓴다.',
    { version: { type: 'integer' } },
    ['version'],
    async (a) => {
      needEdit()
      const v = intArg(a.version, 1, 100000, 'version', 'version 은 양의 정수여야 합니다')
      const prev = env.getVersion()
      const r = await env.restoreVersion(v)
      dropCache()
      return { result: { ok: true, version: r.version, restored_from: v }, summary: `v${v} 내용으로 되돌림`, undo: () => env.undoTo(prev, r.version) }
    }
  )

  // ───────────── 개인정보, 도장, 내보내기 ─────────────

  add(
    'redact_personal_info',
    '개인정보(주민등록번호, 전화번호, 이메일, 계좌 등)를 가린다. 반드시 먼저 dry_run:true(기본)로 규칙별 개수와 가려진 미리보기를 확인해 사용자에게 보여 준다. 적용은 사용자가 가리자고 확인한 다음 턴에 dry_run:false, confirmed:true 로만 한다. 화면 확인 창도 뜬다. 이미지 속 글자는 가릴 수 없다.',
    {
      rules: { type: 'array', items: { type: 'string' }, description: "가릴 규칙: 'rrn'(주민번호), 'phone', 'email' …. 생략하면 서버 기본 규칙" },
      dry_run: { type: 'boolean', description: '기본 true. false 는 적용' },
      confirmed: { type: 'boolean', description: '사용자가 적용을 확인한 다음 턴에서만 true' },
    },
    [],
    async (a) => {
      const dry = a.dry_run !== false
      const rules = Array.isArray(a.rules) ? a.rules.filter((r) => typeof r === 'string' && /^[a-z_]{2,20}$/.test(r)).slice(0, 12) : undefined
      const op = { type: 'redact', ...(rules && rules.length ? { rules } : {}) }
      if (dry) {
        const [sug, pre] = await Promise.all([A().redactionSuggest(env.getVersion()).catch(() => null), runEdit([{ ...op, dry_run: true }], { dry_run: true, note: 'AI: 개인정보 가리기 미리보기' }).catch(() => null)])
        const byRule = {}
        for (const h of sug?.hits || []) byRule[h.rule] = (byRule[h.rule] || 0) + 1
        const previews = (sug?.hits || []).slice(0, 12).map((h) => ({ block: h.cell || h.block, rule: h.rule, preview: clip(h.preview, 60) }))
        return {
          result: { dry_run: true, wrote: false, total: sug?.hits?.length ?? pre?.res?.applied?.length ?? 0, by_rule: byRule, previews, would_apply: pre?.res?.applied?.length, note: '미리보기는 가려진 모양입니다. 사용자에게 규칙별 개수를 알리고 적용할지 묻습니다. 이미지 속 글자는 가려지지 않습니다.' },
          summary: `개인정보 후보 ${sug?.hits?.length ?? 0}곳 (미리보기)`,
        }
      }
      needEdit()
      if (a.confirmed !== true) return { result: { ok: false, wrote: false, needsConfirmation: true, message: '개인정보를 가리면 문서가 바뀝니다.', hint: '미리보기를 사용자에게 보여 주고 적용하자는 답을 받은 다음 턴에 confirmed:true 로 다시 호출하세요.' }, summary: '확인이 필요해 멈춤' }
      const ok = await env.confirm({ title: '개인정보 가리기', message: '개인정보로 찾은 곳을 모두 가립니다. 버전 기록에서 되돌릴 수 있습니다.', confirmLabel: '가리기' })
      if (!ok) return { result: { ok: false, wrote: false, cancelled: true, message: '사용자가 취소했습니다' }, summary: '사용자가 취소' }
      const { res, prev } = await runEdit([op], { note: 'AI: 개인정보 가림' })
      return editResult(res, prev, { note: '이미지 속 글자는 가려지지 않았습니다. 결과를 눈으로 확인하세요.' })
    }
  )

  add(
    'place_seal',
    '도장 이미지를 anchor 글자(예: "(인)") 자리에 넣는다. 도장 이미지는 사용자가 편집기 오른쪽 "내보내기 > 도장"에서 미리 올려 둬야 한다(없으면 알려 준다). 위치는 근사치이므로 look_at_page 로 확인한다.',
    { anchor: { type: 'string', description: '도장을 찍을 자리의 글(예: "(인)")' }, width_mm: { type: 'number', description: '도장 너비(mm). 기본 20, 8~40' } },
    ['anchor'],
    async (a) => {
      needEdit()
      const image = env.getSealImage?.()
      need(image, '도장 이미지가 없습니다. 오른쪽 "내보내기" 탭의 도장에서 이미지를 먼저 올려 달라고 사용자에게 안내하세요')
      const anchor = str(a.anchor, 40, 'anchor')
      need(anchor.length > 0, 'anchor 가 비었습니다')
      const width_mm = Math.max(8, Math.min(40, Number(a.width_mm) || 20))
      const { res, prev } = await runEdit([{ type: 'place_seal', image, anchor, width_mm }], { note: `AI: ${anchor} 자리에 도장` })
      return editResult(res, prev, { note: '도장 위치는 근사치입니다. look_at_page 로 확인하세요.' })
    }
  )

  add(
    'export_file',
    '파일로 내려받는다. format: hwpx 또는 hwp(원래 형식 그대로), docx, pdf, md, txt. 브라우저가 파일을 내려받는다. 개인정보를 가린 공개용이면 가린 뒤에 부른다.',
    { format: { type: 'string', description: 'hwpx | hwp | docx | pdf | md | txt' } },
    ['format'],
    async (a) => {
      const f = String(a.format || '').toLowerCase()
      need(['hwpx', 'hwp', 'docx', 'pdf', 'md', 'txt'].includes(f), "format 은 hwpx, hwp, docx, pdf, md, txt 중 하나여야 합니다")
      const info = env.getInfo?.() || {}
      if ((f === 'hwpx' || f === 'hwp') && info.format && info.format !== f) throw new Error(`이 파일은 ${info.format} 형식이라 ${f} 로는 원본 그대로 내보낼 수 없습니다. ${info.format} 로 내려받으세요`)
      const name = await env.download(f, env.getVersion())
      return { result: { ok: true, format: f, version: env.getVersion(), file: name }, summary: `${f.toUpperCase()} 내려받기 시작` }
    }
  )

  add(
    'draft_document',
    '내장 서식으로 새 한글 문서를 만든다(지금 문서는 바뀌지 않는다). template: gian(일반기안문), gian-simple(간이기안문), 또는 markdown(preset 필요: 기안문, 보고서, 계획서, 통지, 알림, 회의록, 보도자료, 업무보고, 개조식, 방침서). values 는 누름틀 이름 -> 글. 모르는 값은 지어내지 말고 비워 둔다. 만들면 id 와 열기 주소를 준다.',
    {
      template: { type: 'string', description: "'gian' | 'gian-simple' | 'markdown'" },
      values: { type: 'object', additionalProperties: true, description: '{누름틀 이름: 글}' },
      markdown: { type: 'string', description: "template 이 'markdown' 일 때 본문(마크다운)" },
      preset: { type: 'string', description: "markdown 일 때 문서 종류" },
      title: { type: 'string', description: '파일 이름' },
    },
    ['template'],
    async (a) => {
      const template = String(a.template || '')
      need(['gian', 'gian-simple', 'markdown'].includes(template), "template 은 'gian', 'gian-simple', 'markdown' 중 하나여야 합니다")
      const body = { template }
      if (isObj(a.values)) {
        const v = {}
        for (const [k, x] of Object.entries(a.values).slice(0, 100)) {
          const name = cleanText(k, 60)?.trim()
          if (name) v[name] = cleanText(String(x ?? ''), 2000)
        }
        body.values = v
      }
      if (template === 'markdown') {
        body.markdown = str(a.markdown, 100000, 'markdown')
        need(body.markdown.length > 0, 'markdown 이 비었습니다')
        body.preset = String(a.preset || '보고서')
      }
      if (typeof a.title === 'string' && a.title.trim()) body.title = cleanText(a.title, 80).trim()
      const r = await env.createFile(body)
      const item = r.item || r
      env.announceNewFile?.({ id: item.id, title: item.title })
      return { result: { ok: true, id: item.id, title: item.title, url: `/hwp/${item.id}`, warnings: (r.warnings || []).slice(0, 3) }, summary: `새 문서 "${clip(item.title, 24)}" 만듦` }
    }
  )

  return tools
}
