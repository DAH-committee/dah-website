// DAH Sheet AI 도구. 계약서: client/src/components/ai/README.md
//
// 구성
//   createSheetTools(host): 편집기에 묶는 { tools, getContext } 를 만든다. 순수 모델 함수(sheetModel, sheetAnalyze)만 쓰고
//   DOM 은 건드리지 않는다. 화면에 닿는 일은 모두 host 가 한다.
//
// host 계약
//   getState()                       -> { sheets, nextSheet, ui, activeId }   지금 시트 전체(바꾸지 않는다)
//   applyState(next, label)          -> undo()   새 상태를 화면과 저장에 반영하고 되돌리기 함수를 돌려준다(실행취소 한 번에 묶임)
//   getSelection()                   -> { sheetId, range:{c0,c1,r0,r1}|null, active:{c,r}|null, filtered:boolean }
//   select(sheetId, g)               -> 입력한 범위를 선택해 보여 준다(선택 사항)
//   editBlock()                      -> 편집할 수 없는 이유(없으면 '')
//   engine                           -> 수식 엔진 어댑터(sheetEngine.js)
//
// 모든 칸은 A1 표기이고 1행은 머리글(열 이름), 데이터는 2행부터다. 오류 글은 모델이 호출을 고칠 수 있게 쓴다.
import {
  SheetApiError, SUPPORTED_FORMATS, UNSUPPORTED_FORMATS, addSheet, cellName, cellTextFromValue, columnsOf, deleteCols, deleteRows, deleteSheet, fail,
  fillRange, findReplace, findSheet, formatRange, insertCols, insertRows, isBlank, isFormulaText, isPlaceholderHeader, parseCell,
  rangeName, rawAt, removeDuplicates, renameSheet, resolveRange, setCells, setLayout, sortRange, splitColumn, splitSheetPrefix, usedRange, visibleRaw,
  MAX_COLS, MAX_ROWS,
} from '../../components/admin/sheet/sheetModel.js'
import { colLetter } from '../../components/admin/sheet/sheetUtils.js'
import { colIndex } from '../../components/admin/sheet/sheetFormulaRefs.js'
import { analyzeMatrix, formatAnalysis } from '../../components/admin/sheet/sheetAnalyze.js'
import { isFormulaText as isFormula } from '../../components/admin/sheet/sheetFormulaRefs.js'

export const MAX_WRITE_CELLS = 3000
const READ_DEFAULT = 600
const READ_MAX = 4000
const CELL_SHOW = 100

const clip = (s, n = CELL_SHOW) => (s.length > n ? `${s.slice(0, n)}…` : s)
const oneLine = (s) => String(s ?? '').replace(/\r?\n/g, ' ⏎ ').replace(/\t/g, ' ')

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const bool = (v) => v === true || v === 'true'

function colArg(v, label = '열') {
  if (typeof v === 'number' && Number.isInteger(v)) fail(`${label}은 숫자가 아니라 열 글자(A, B, ...)로 써 주세요`)
  const t = str(v).trim().replace(/\$/g, '')
  if (!/^[A-Za-z]{1,3}$/.test(t)) fail(`${label} "${t}" 를 읽을 수 없습니다. A, B, AA 같은 열 글자로 써 주세요`)
  const c = colIndex(t)
  if (c >= MAX_COLS) fail(`열은 ${colLetter(MAX_COLS - 1)} 까지입니다`)
  return c
}
function intArg(v, name, { min = 1, max = 100000, dflt } = {}) {
  if (v == null && dflt !== undefined) return dflt
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} 는 ${min}에서 ${max} 사이의 정수여야 합니다`)
  return n
}

/** 실패를 모델에게 보여 줄 오류로 바꾼다. 도구 코드는 SheetApiError 를 그대로 던져도 된다 */
export function describeError(e) {
  return e instanceof SheetApiError ? e.message : null
}

// ── 엔진 연동(어댑터) ─────────────────────────────────────
function newErrorSet(ev, state, sheetIds) {
  const out = new Map()
  for (const s of state.sheets) {
    if (sheetIds && !sheetIds.includes(s.id)) continue
    const u = usedRange(state, s)
    if (u.empty) continue
    for (let r = 2; r <= u.rows; r += 1) {
      for (let c = 0; c < u.cols; c += 1) {
        const info = ev.info(s.id, c, r)
        if (info.isError) out.set(`${s.id}!${cellName(c, r)}`, { sheet: s.label, ref: cellName(c, r), code: info.code })
      }
    }
  }
  return out
}

const LIKELY_CAUSE = {
  '#DIV/0!': '0 또는 빈 칸으로 나누고 있습니다. IFERROR 로 감싸거나 분모 범위를 확인하세요',
  '#N/A': '찾는 값이 조회 범위에 없거나(VLOOKUP, MATCH), 인수 개수나 범위 크기가 맞지 않습니다. 정확히 같은 글인지(공백, 대소문자) 확인하세요',
  '#NAME?': '지원하지 않는 함수 이름이거나 철자가 틀렸습니다. 지원 함수 목록에서 고르세요',
  '#REF!': '지워진 칸이나 없는 시트를 가리키거나, 순환 참조이거나, 펼침(spill) 결과가 다른 값과 겹칩니다. 결과가 펼쳐질 칸(오른쪽·아래)을 비워 두세요',
  '#VALUE!': '숫자 자리에 글이 들어 있거나 인수 종류가 맞지 않습니다. 값 칸의 형식(숫자인지 글인지)을 read_sheet 로 확인하세요',
  '#NUM!': '계산 결과가 허용 범위를 벗어났습니다',
  '#ERROR!': '수식 구문 오류입니다. 괄호 짝, 따옴표, 쉼표를 확인하세요',
}

// ── 읽기 글 만들기 ────────────────────────────────────────
function renderGrid(state, sheet, g, mode, ev, maxCells) {
  const cols = columnsOf(state, sheet)
  const width = g.c1 - g.c0 + 1
  const height = g.r1 - g.r0 + 1
  const rowsAllowed = Math.max(1, Math.floor(maxCells / Math.max(1, width)))
  const shownRows = Math.min(height, rowsAllowed)
  const lines = []
  lines.push(`\t${Array.from({ length: width }, (_, j) => colLetter(g.c0 + j)).join('\t')}`)
  for (let i = 0; i < shownRows; i += 1) {
    const r = g.r0 + i
    const cells = []
    for (let j = 0; j < width; j += 1) {
      const c = g.c0 + j
      const raw = visibleRaw(state, sheet, c, r, cols)
      const formula = isFormulaText(raw)
      const info = ev ? ev.info(sheet.id, c, r) : null
      let text
      if (mode === 'formulas' || r === 1) text = raw
      else {
        const shown = ev ? ev.display(sheet.id, c, r) : raw
        if (mode === 'both' && formula) text = `${shown} 〔${raw}〕`
        else if (mode === 'both' && info?.spillOf) text = `${shown} 〔${info.spillOf} 에서 펼쳐짐〕`
        else text = shown
      }
      cells.push(clip(oneLine(text)))
    }
    lines.push(`${r}\t${cells.join('\t')}`)
  }
  const note = shownRows < height ? `\n(잘림) ${g.r0 + shownRows}행부터 이어서 읽으려면 range 를 "${colLetter(g.c0)}${g.r0 + shownRows}:${colLetter(g.c1)}${g.r1}" 로 지정하세요` : ''
  return { text: lines.join('\n') + note, rows: shownRows, truncated: shownRows < height }
}

// ── 만들기 ────────────────────────────────────────────────
export function createSheetTools(host) {
  const engine = host.engine
  let evCache = { state: null, ev: null }
  const evaluatorFor = (state) => {
    if (evCache.state !== state) evCache = { state, ev: engine.evaluator(state) }
    return evCache.ev
  }
  /** 값이 있는 영역. 수식이 아래·오른쪽으로 펼친 결과까지 포함한다 */
  function usedWithSpill(state, s) {
    const u = usedRange(state, s)
    if (u.empty) return u
    const ev = evaluatorFor(state)
    const cols = columnsOf(state, s)
    let rows = u.rows
    let ncols = u.cols
    for (let r = 2; r <= u.rows; r += 1) {
      for (let c = 0; c < u.cols; c += 1) {
        if (!isFormula(rawAt(state, s, c, r, cols))) continue
        const info = ev.info(s.id, c, r)
        if (info.spill) {
          rows = Math.max(rows, r + info.spill.rows - 1)
          ncols = Math.max(ncols, c + info.spill.cols)
        }
      }
    }
    return { ...u, rows, cols: ncols }
  }
  const editBlocked = () => {
    const why = host.editBlock?.()
    if (why) fail(why)
  }

  /** 한 번의 쓰기를 계획하고(검사, 모의 계산) 적용한다 */
  function commitCellsRaw(sheetRef, plan, { overwrite, confirmed, allowErrors, dryRun, label, selectG, asText, post }) {
    const state = host.getState()
    const sheet = findSheet(state, sheetRef)
    const cols = columnsOf(state, sheet)
    if (plan.length > MAX_WRITE_CELLS) fail(`한 번에 ${MAX_WRITE_CELLS}칸까지 쓸 수 있습니다. 나누어 호출하세요`)
    // 1. 값과 수식을 칸 글로 바꾸고 수식을 검사한다
    const cells = []
    const problems = []
    const seen = new Set()
    for (const p of plan) {
      let raw
      let formula = false
      if (p.formula != null && p.formula !== '') {
        const f = str(p.formula).trim()
        raw = f.startsWith('=') ? f : `=${f}`
        formula = true
      } else {
        const v = p.value
        if (typeof v === 'string' && !asText && !p.asText && v.trim().startsWith('=') && v.trim().length > 1) {
          raw = v.trim()
          formula = true
        } else raw = cellTextFromValue(v, { asText: asText || p.asText })
      }
      const key = `${p.c},${p.r}`
      if (seen.has(key)) problems.push(`${cellName(p.c, p.r)} 가 두 번 들어 있습니다`)
      seen.add(key)
      if (formula && p.r === 1) problems.push(`${cellName(p.c, p.r)}: 1행은 머리글이라 수식을 넣을 수 없습니다. 수식은 2행부터 넣어 주세요`)
      if (formula) {
        const v = engine.validateFormula(raw, { sheets: state.sheets.map((s) => s.label) })
        if (!v.ok) problems.push(`${cellName(p.c, p.r)} ${raw}: ${v.message}`)
      }
      cells.push({ c: p.c, r: p.r, raw, formula })
    }
    if (problems.length) {
      return { ok: false, wrote: false, problems: problems.slice(0, 15), hint: '수식을 고친 뒤 같은 호출을 다시 하세요. 모든 칸이 쓰이지 않았습니다.' }
    }
    // 2. 덮어쓰기 검사
    const clobber = []
    for (const x of cells) {
      const cur = visibleRaw(state, sheet, x.c, x.r, cols)
      if (!isBlank(cur) && cur !== x.raw) clobber.push({ ref: cellName(x.c, x.r), now: clip(oneLine(cur), 40) })
    }
    if (clobber.length && !overwrite) {
      return {
        ok: false,
        wrote: false,
        problems: [`값이 이미 있는 칸 ${clobber.length}개를 덮어쓰게 됩니다: ${clobber.slice(0, 8).map((x) => `${x.ref}="${x.now}"`).join(', ')}${clobber.length > 8 ? ' 등' : ''}`],
        hint: '사용자가 덮어써도 된다고 말한 경우에만 overwrite:true 로 다시 호출하세요. 아니면 빈 칸을 골라 쓰거나 사용자에게 물어보세요.',
      }
    }
    if (clobber.length && overwrite && !confirmed && clobber.length > 5) {
      // 많은 칸을 덮어쓰는 호출은 사용자 확인을 거쳤다는 표시(confirmed)를 요구한다
      return { ok: false, wrote: false, problems: [`${clobber.length}칸을 덮어쓰는 큰 변경입니다`], hint: '사용자에게 먼저 확인을 받은 뒤 confirmed:true 를 함께 보내 다시 호출하세요.' }
    }
    // 3. 새 상태 만들기와 모의 계산. 결과가 격자 밖으로 펼쳐지면 행·열을 자동으로 늘려 한 번 더 계산한다
    let next = setCells(state, sheet.id, cells).state
    if (post) next = post(next)
    const evBefore = evaluatorFor(state)
    let evAfter
    let results
    let errs
    let grew = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      evAfter = engine.evaluator(next)
      const sheetAfter = findSheet(next, sheet.id)
      results = []
      errs = []
      let needRows = 0
      let needCols = 0
      for (const x of cells) {
        if (!x.formula) continue
        const info = evAfter.info(sheetAfter.id, x.c, x.r)
        const shown = evAfter.display(sheetAfter.id, x.c, x.r)
        const entry = { ref: cellName(x.c, x.r), result: clip(shown, 60) }
        if (info.spill) entry.spills_to = rangeName({ c0: x.c, r0: x.r, c1: x.c + info.spill.cols - 1, r1: x.r + info.spill.rows - 1 })
        results.push(entry)
        if (info.isError) {
          const more = /insert more (rows|columns) \((\d+)\)/.exec(info.message || '')
          if (more) {
            if (more[1] === 'rows') needRows = Math.max(needRows, Number(more[2]))
            else needCols = Math.max(needCols, Number(more[2]))
          }
          errs.push({ ref: entry.ref, formula: clip(x.raw, 120), error: info.code, cause: more ? '결과가 시트 크기를 넘습니다' : info.blocked ? '결과가 펼쳐질 칸(오른쪽·아래)에 이미 값이 있어 막혔습니다. 그 칸을 비우거나 수식을 다른 빈 영역으로 옮기세요' : LIKELY_CAUSE[info.code] || '', ...(info.message ? { message: clip(info.message, 160) } : {}) })
        }
      }
      if ((!needRows && !needCols) || attempt === 2) break
      const sh = findSheet(next, sheet.id)
      const tc = columnsOf(next, sh).length - 1 + needCols
      const tr = sh.rows.length + 1 + needRows
      try {
        next = setCells(next, sheet.id, [{ c: needCols ? tc : 0, r: needRows ? tr : 2, raw: '' }, ...(needCols && needRows ? [{ c: 0, r: tr, raw: '' }] : [])]).state
      } catch {
        break
      }
      grew = { rows: (grew?.rows || 0) + needRows, cols: (grew?.cols || 0) + needCols }
    }
    if (errs.length && !allowErrors) {
      return {
        ok: false,
        wrote: false,
        formulaErrors: errs.slice(0, 10),
        hint: '수식이 오류를 냅니다. 아무것도 쓰지 않았습니다. 원인을 고쳐 다시 호출하세요(compute 로 먼저 시험할 수 있습니다). 오류가 의도라면 allow_errors:true 를 보내세요.',
      }
    }
    if (dryRun) return { ok: true, wrote: false, dryRun: true, count: cells.length, formulas: results.slice(0, 20) }
    // 4. 적용
    const beforeErr = newErrorSet(evBefore, state)
    const afterErr = newErrorSet(evAfter, next)
    const fresh = []
    for (const [k, v] of afterErr) if (!beforeErr.has(k) && !cells.some((x) => `${sheet.id}!${cellName(x.c, x.r)}` === k)) fresh.push(v)
    const undo = host.applyState(next, label)
    if (selectG) host.select?.(sheet.id, selectG)
    const out = { ok: true, wrote: true, count: cells.length, sheet: sheet.label }
    if (results.length) out.formulas = results.slice(0, 12)
    if (results.length > 12) out.formulasNote = `수식 ${results.length}개 중 12개만 표시`
    if (errs.length) out.formulaErrors = errs.slice(0, 10)
    if (fresh.length) out.otherCellsNowInError = fresh.slice(0, 10)
    if (clobber.length) out.overwritten = clobber.length
    if (grew) out.sheetGrew = `결과가 펼쳐지도록 ${[grew.cols ? `열 ${grew.cols}개` : '', grew.rows ? `행 ${grew.rows}개` : ''].filter(Boolean).join(', ')}를 늘림`
    return { result: out, summary: `${sheet.label}: ${cells.length}칸 ${label}`, undo }
  }

  const commitCells = (...a) => {
    const r = commitCellsRaw(...a)
    return r.result ? r : { result: r, summary: r.dryRun ? '검사만 함' : '쓰지 않음: 확인 필요' }
  }

  /** 상태 한 번 바꾸고 결과를 돌려주는 공통 껍데기 */
  function mutate(label, fn) {
    editBlocked()
    const state = host.getState()
    const r = fn(state)
    if (r.state === state) return { result: { ok: true, changed: false, ...r.info }, summary: `${label}: 바뀐 것 없음` }
    const undo = host.applyState(r.state, label)
    return { result: { ok: true, ...r.info }, summary: r.summary || label, undo }
  }

  function countFilled(state, sheet, g) {
    const cols = columnsOf(state, sheet)
    let n = 0
    for (let r = g.r0; r <= g.r1; r += 1) for (let c = g.c0; c <= g.c1; c += 1) if (!isBlank(visibleRaw(state, sheet, c, r, cols))) n += 1
    return n
  }
  const needConfirm = (what, n) => ({
    result: { ok: false, wrote: false, needsConfirmation: true, message: `${what}에 값이 있는 칸이 ${n}개 있어 지우게 됩니다.`, hint: '사용자가 지워도 된다고 분명히 말했거나 방금 확인해 준 경우에만 confirmed:true 로 다시 호출하세요. 아니면 사용자에게 먼저 물어보세요.' },
    summary: '확인이 필요해 멈춤',
  })

  const sheetProp = { type: 'string', description: '시트 이름(화면에 보이는 탭 이름). 생략하면 지금 보는 시트' }
  const tools = []
  const add = (name, description, properties, required, run) => {
    tools.push({
      name,
      description,
      parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
      run: async (args) => {
        try {
          return await run(args || {})
        } catch (e) {
          const m = describeError(e)
          if (m) throw new Error(m)
          throw e
        }
      },
    })
  }

  // ── 읽기 ──
  add(
    'list_sheets',
    '모든 시트의 이름, 크기, 값이 있는 범위를 알려 준다.',
    {},
    [],
    async () => {
      const state = host.getState()
      const list = state.sheets.map((s) => {
        const u = usedWithSpill(state, s)
        return { name: s.label, active: s.id === state.activeId, usedRange: u.empty ? '(비어 있음)' : `A1:${cellName(u.cols - 1, u.rows)}`, rows: u.rows, cols: u.cols, gridSize: `${s.rows.length + 1}행 x ${columnsOf(state, s).length}열` }
      })
      return { result: { sheets: list }, summary: `시트 ${list.length}개 확인` }
    }
  )

  add(
    'get_selection',
    '사용자가 지금 선택한 범위와 칸 내용을 알려 준다. "이 칸", "선택한 부분" 같은 말은 이 도구로 확인한다.',
    { max_cells: { type: 'integer', description: '읽을 최대 칸 수(기본 200)' } },
    [],
    async ({ max_cells }) => {
      const state = host.getState()
      const sel = host.getSelection()
      const sheet = findSheet(state, sel.sheetId)
      if (!sel.range) return { result: { sheet: sheet.label, selection: null, message: '선택한 칸이 없습니다' }, summary: '선택 없음' }
      const g = sel.range
      const ev = evaluatorFor(state)
      const grid = renderGrid(state, sheet, g, 'both', ev, intArg(max_cells, 'max_cells', { min: 1, max: 1000, dflt: 200 }))
      return {
        result: { sheet: sheet.label, range: rangeName(g), active: sel.active ? cellName(sel.active.c, sel.active.r) : null, ...(sel.filtered ? { note: '정렬이나 필터가 켜져 있어 화면 줄 순서와 시트 행 번호가 다를 수 있습니다' } : {}), grid: grid.text },
        summary: `${rangeName(g)} 선택 읽음`,
      }
    }
  )

  add(
    'read_sheet',
    '시트의 칸 내용을 읽는다. 수정하기 전에 항상 먼저 읽는다. 1행은 머리글(열 이름)이다. 결과는 행 번호와 열 글자가 붙은 탭 표다. 수식 칸은 mode "both" 에서 "계산값 〔=수식〕" 으로 나온다.',
    {
      sheet: sheetProp,
      range: { type: 'string', description: 'A1 표기 범위(예: A1:F30, B:D, 5:20). 생략하면 값이 있는 전체 영역. 다른 시트는 "시트2!A1:C5"' },
      mode: { type: 'string', enum: ['values', 'formulas', 'both'], description: 'values 계산된 값(기본), formulas 수식 원문, both 둘 다' },
      max_cells: { type: 'integer', description: `최대 칸 수(기본 ${READ_DEFAULT}, 최대 ${READ_MAX}). 넘으면 잘리고 이어 읽을 범위를 알려 준다` },
    },
    [],
    async ({ sheet, range, mode, max_cells }) => {
      const state = host.getState()
      const base = findSheet(state, sheet)
      const { sheet: target, g } = resolveRange(state, base, range, { usedOf: (x) => usedWithSpill(state, x) })
      const m = ['values', 'formulas', 'both'].includes(mode) ? mode : 'values'
      const cap = intArg(max_cells, 'max_cells', { min: 1, max: READ_MAX, dflt: READ_DEFAULT })
      const ev = m === 'formulas' ? null : evaluatorFor(state)
      const grid = renderGrid(state, target, g, m, ev, cap)
      const u = usedWithSpill(state, target)
      return {
        result: { sheet: target.label, range: rangeName(g), usedRange: u.empty ? '(비어 있음)' : `A1:${cellName(u.cols - 1, u.rows)}`, mode: m, truncated: grid.truncated, grid: grid.text },
        summary: `${target.label} ${rangeName(g)} 읽음`,
      }
    }
  )

  // ── 쓰기 ──
  add(
    'write_cells',
    '칸에 값이나 수식을 쓴다. 숫자, 날짜(YYYY-MM-DD), TRUE/FALSE 는 구글 시트처럼 자동 인식한다. 수식은 쓰기 전에 문법과 계산 결과를 검사하고, 오류가 나면 아무것도 쓰지 않고 이유를 돌려준다. 값이 있는 칸은 overwrite:true 없이는 덮어쓰지 않는다. 1행은 머리글(열 이름)이라 글만 넣을 수 있다. 같은 모양의 수식을 여러 칸에 넣을 때는 fill_range 를 쓴다.',
    {
      sheet: sheetProp,
      cells: {
        type: 'array',
        description: '쓸 칸 목록',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: '칸 주소(예: B2). values 와 함께 쓰면 왼쪽 위 칸' },
            value: { description: '넣을 값(글, 숫자, 참/거짓). 빈 글 "" 이면 칸을 비운다' },
            formula: { type: 'string', description: '수식(예: =SUM(B2:B10)). value 와 함께 쓰지 않는다' },
            values: { type: 'array', description: 'ref 를 왼쪽 위로 해서 한꺼번에 쓸 2차원 배열(행 배열의 배열). "="로 시작하는 글은 수식', items: { type: 'array', items: {} } },
          },
          required: ['ref'],
        },
      },
      overwrite: { type: 'boolean', description: '값이 있는 칸을 덮어써도 되는지(사용자가 허락했을 때만 true)' },
      confirmed: { type: 'boolean', description: '5칸을 넘게 덮어쓸 때 사용자 확인을 받았다는 표시' },
      as_text: { type: 'boolean', description: 'true 면 날짜, TRUE/FALSE 로 바꾸지 않고 글 그대로 둔다(전화번호, 코드 등)' },
      dry_run: { type: 'boolean', description: 'true 면 쓰지 않고 검사와 모의 계산만 한다' },
      allow_errors: { type: 'boolean', description: '수식이 오류 값을 내도 쓸지(보통 쓰지 않는다)' },
    },
    ['cells'],
    async ({ sheet, cells, overwrite, confirmed, as_text, dry_run, allow_errors }) => {
      editBlocked()
      if (!Array.isArray(cells) || !cells.length) fail('cells 배열이 비어 있습니다. [{ref:"A2", value:"이름"}] 모양으로 보내세요')
      const plan = []
      for (const [i, x] of cells.entries()) {
        const { sheet: pre, range } = splitSheetPrefix(x?.ref)
        if (pre && sheet && pre !== sheet) fail(`cells[${i}] ref 의 시트 "${pre}" 가 sheet 인수와 다릅니다. 시트마다 따로 호출하세요`)
        const p = parseCell(range)
        if (!p) fail(`cells[${i}].ref "${x?.ref}" 는 칸 하나의 A1 주소여야 합니다(예: B2). 여러 칸은 values 2차원 배열을 쓰세요`)
        if (p.c >= MAX_COLS || p.r > MAX_ROWS + 1) fail(`${x.ref} 는 시트 범위(${colLetter(MAX_COLS - 1)}열, ${MAX_ROWS + 1}행) 밖입니다`)
        if (Array.isArray(x.values)) {
          x.values.forEach((line, i2) => {
            if (!Array.isArray(line)) fail(`cells[${i}].values 는 행 배열의 배열이어야 합니다`)
            line.forEach((v, j) => plan.push({ c: p.c + j, r: p.r + i2, value: v }))
          })
        } else plan.push({ c: p.c, r: p.r, value: x.value, formula: x.formula })
      }
      // 시트 이름이 ref 앞에 붙었으면 그 시트로
      const firstPre = splitSheetPrefix(cells[0]?.ref).sheet
      const res = commitCells(sheet || firstPre, plan, { overwrite: bool(overwrite), confirmed: bool(confirmed), allowErrors: bool(allow_errors), dryRun: bool(dry_run), asText: bool(as_text), label: '입력', selectG: boundsOf(plan) })
      return res
    }
  )

  add(
    'create_table',
    '새 표(머리글 + 데이터 행)를 한 번에 만든다. 템플릿이나 예시 데이터를 만들 때 쓴다. top_left 가 A1 이면 머리글이 시트의 열 이름(1행)이 된다. 값이 있는 칸 위에는 overwrite:true 없이 만들지 않는다.',
    {
      sheet: sheetProp,
      top_left: { type: 'string', description: '표가 시작할 칸(예: A1)' },
      headers: { type: 'array', items: { type: 'string' }, description: '머리글(열 이름) 목록' },
      rows: { type: 'array', items: { type: 'array', items: {} }, description: '데이터 행 배열. "="로 시작하는 글은 수식' },
      style: { type: 'string', enum: ['header', 'plain'], description: 'header(기본) 머리글을 굵게 + 회색 채움(A1 시작이 아닐 때), plain 서식 없음' },
      overwrite: { type: 'boolean', description: '값이 있는 칸을 덮어써도 되는지' },
      confirmed: { type: 'boolean', description: '사용자 확인을 받았다는 표시' },
    },
    ['top_left', 'headers', 'rows'],
    async ({ sheet, top_left, headers, rows, style, overwrite, confirmed }) => {
      editBlocked()
      const p = parseCell(top_left)
      if (!p) fail(`top_left "${top_left}" 는 칸 하나의 A1 주소여야 합니다(예: A1)`)
      if (!Array.isArray(headers) || !headers.length) fail('headers 배열이 필요합니다')
      if (!Array.isArray(rows)) fail('rows 는 행 배열의 배열이어야 합니다')
      if (headers.length > 50 || rows.length > 1000) fail('표는 50열, 1000행까지 만들 수 있습니다')
      const plan = []
      headers.forEach((h, j) => plan.push({ c: p.c + j, r: p.r, value: String(h), asText: true }))
      rows.forEach((line, i) => {
        if (!Array.isArray(line)) fail(`rows[${i}] 는 배열이어야 합니다`)
        line.forEach((v, j) => {
          if (j >= headers.length) fail(`rows[${i}] 가 headers(${headers.length}개)보다 깁니다`)
          plan.push({ c: p.c + j, r: p.r + 1 + i, value: v })
        })
      })
      const g = { c0: p.c, c1: p.c + headers.length - 1, r0: p.r, r1: p.r + rows.length }
      // 머리글 서식은 같은 되돌리기 단계에 묶는다(A1 에서 시작하면 1행이 이미 머리글이라 서식을 주지 않는다)
      const post = (style || 'header') === 'header' && p.r > 1 ? (st) => formatRange(st, sheet, { c0: g.c0, c1: g.c1, r0: p.r, r1: p.r }, { bold: true, fill: 'subtle' }).state : undefined
      const res = commitCells(sheet, plan, { overwrite: bool(overwrite), confirmed: bool(confirmed), label: '표 만들기', selectG: g, post })
      if (!res.undo) return res
      res.result.range = rangeName(g)
      res.summary = `${rangeName(g)} 표 만듦(${rows.length}행)`
      return res
    }
  )

  add(
    'fill_range',
    '범위를 채운다. formula_template 은 범위 왼쪽 위 칸 기준으로 쓴 수식이고 나머지 칸은 상대 참조가 자동으로 옮겨진다(예: 범위 D2:D50, 수식 "=B2*C2"). pattern 은 숫자·날짜 연속값(series), 값 반복(repeat), 첫 칸 복사(copy).',
    {
      sheet: sheetProp,
      range: { type: 'string', description: '채울 범위(예: D2:D50). 2행부터' },
      formula_template: { type: 'string', description: '왼쪽 위 칸 기준 수식(예: =B2*C2). $ 로 고정한 참조는 그대로 유지된다' },
      pattern: {
        type: 'object',
        description: '값 패턴',
        properties: {
          kind: { type: 'string', enum: ['series', 'repeat', 'copy'] },
          start: { description: 'series 시작값(숫자 또는 YYYY-MM-DD)' },
          step: { type: 'number', description: 'series 증가량(기본 1)' },
          unit: { type: 'string', enum: ['day', 'week', 'month'], description: '날짜 series 의 단위(기본 day)' },
          values: { type: 'array', items: {}, description: 'repeat 로 돌려 쓸 값' },
        },
      },
      overwrite: { type: 'boolean' },
      confirmed: { type: 'boolean' },
    },
    ['range'],
    async ({ sheet, range, formula_template, pattern, overwrite, confirmed }) => {
      editBlocked()
      const state = host.getState()
      const base = findSheet(state, sheet)
      const { sheet: target, g } = resolveRange(state, base, range, { defaultUsed: false })
      const plan = []
      let fillState = state
      // 채울 값 계산은 모델 함수에 맡기고, 쓰기는 같은 검사 길을 지나게 한다
      const r = fillRange(fillState, target.id, g, { formula_template, pattern })
      for (const x of r.cells) plan.push({ c: x.c, r: x.r, formula: isFormulaText(x.raw) ? x.raw : undefined, value: isFormulaText(x.raw) ? undefined : x.raw, asText: true })
      return commitCells(target.id, plan, { overwrite: bool(overwrite), confirmed: bool(confirmed), label: '채우기', selectG: g })
    }
  )

  add(
    'clear_range',
    '범위의 값과 수식을 지운다(서식과 칸 자체는 남는다). 값이 있는 칸을 지우므로 사용자 확인이 필요하다.',
    { sheet: sheetProp, range: { type: 'string', description: '지울 범위(2행부터. 1행 머리글은 write_cells 로 바꾼다)' }, confirmed: { type: 'boolean', description: '사용자가 지워도 된다고 확인했는지' } },
    ['range'],
    async ({ sheet, range, confirmed }) => {
      editBlocked()
      const state = host.getState()
      const { sheet: target, g } = resolveRange(state, findSheet(state, sheet), range, { defaultUsed: false })
      if (g.r0 < 2) fail('1행은 머리글(열 이름)이라 지울 수 없습니다. 2행부터 지정하세요')
      const lastR = Math.min(g.r1, target.rows.length + 1)
      if (g.r0 > lastR) return { result: { ok: true, cleared: 0 }, summary: '지울 칸 없음' }
      const gg = { ...g, r1: lastR }
      const n = countFilled(state, target, gg)
      if (n && !bool(confirmed)) return needConfirm(`${target.label} ${rangeName(gg)}`, n)
      const plan = []
      const cols = columnsOf(state, target)
      for (let r = gg.r0; r <= gg.r1; r += 1) for (let c = gg.c0; c <= Math.min(gg.c1, cols.length - 1); c += 1) if (!isBlank(rawAt(state, target, c, r, cols))) plan.push({ c, r, value: '' })
      const res = commitCells(target.id, plan, { overwrite: true, confirmed: true, label: '지우기', allowErrors: true })
      if (res.result) {
        res.summary = `${target.label} ${rangeName(gg)}: ${plan.length}칸 지움`
        res.result.cleared = plan.length
      }
      return res
    }
  )

  // ── 구조 ──
  add(
    'insert_rows',
    '행을 끼워 넣는다. at 행 번호 앞에 count 개의 빈 행이 생기고 아래 행은 밀리며, 수식 속 참조(SUM 범위 포함)는 자동으로 따라간다. 데이터 맨 아래에 추가하려면 write_cells 로 다음 빈 행에 쓰는 편이 간단하다.',
    { sheet: sheetProp, at: { type: 'integer', description: '이 행 번호 앞에 넣는다(2 이상)' }, count: { type: 'integer', description: '넣을 행 수(기본 1)' } },
    ['at'],
    async ({ sheet, at, count }) =>
      mutate('행 삽입', (state) => {
        const r = insertRows(state, sheet, intArg(at, 'at', { min: 2, max: MAX_ROWS + 2 }), intArg(count, 'count', { min: 1, max: 500, dflt: 1 }))
        return { state: r.state, info: { inserted: r.count, fixedFormulas: r.fixedFormulas }, summary: `${r.count}개 행 삽입${r.fixedFormulas ? `, 수식 ${r.fixedFormulas}개 조정` : ''}` }
      })
  )
  add(
    'insert_cols',
    '열을 끼워 넣는다. at 열 앞에 count 개의 빈 열이 생기고 오른쪽 열은 밀리며 수식 참조도 따라간다.',
    { sheet: sheetProp, at: { type: 'string', description: '이 열 글자 앞에 넣는다(예: C)' }, count: { type: 'integer', description: '넣을 열 수(기본 1)' } },
    ['at'],
    async ({ sheet, at, count }) =>
      mutate('열 삽입', (state) => {
        const r = insertCols(state, sheet, colArg(at, 'at'), intArg(count, 'count', { min: 1, max: 50, dflt: 1 }))
        return { state: r.state, info: { inserted: r.count, fixedFormulas: r.fixedFormulas }, summary: `${r.count}개 열 삽입${r.fixedFormulas ? `, 수식 ${r.fixedFormulas}개 조정` : ''}` }
      })
  )
  add(
    'delete_rows',
    '행을 지운다(내용도 함께 사라진다). 값이 있는 행이면 사용자 확인(confirmed)이 필요하다. 아래 행은 올라오고 수식 참조는 따라가며, 지워진 칸을 가리키던 수식은 #REF! 가 된다.',
    { sheet: sheetProp, from: { type: 'integer', description: '지울 첫 행 번호(2 이상)' }, count: { type: 'integer', description: '지울 행 수(기본 1)' }, confirmed: { type: 'boolean', description: '사용자 확인을 받았는지' } },
    ['from'],
    async ({ sheet, from, count, confirmed }) => {
      editBlocked()
      const state = host.getState()
      const target = findSheet(state, sheet)
      if (Number(from) === 1) fail('1행은 머리글(열 이름)이라 지울 수 없습니다. 2행부터 지정하세요')
      const f = intArg(from, 'from', { min: 2, max: MAX_ROWS + 1 })
      const n = intArg(count, 'count', { min: 1, max: 5000, dflt: 1 })
      const filled = countFilled(state, target, { c0: 0, c1: columnsOf(state, target).length - 1, r0: f, r1: Math.min(f + n - 1, target.rows.length + 1) })
      if (filled && !bool(confirmed)) return needConfirm(`${target.label} ${f}~${f + n - 1}행`, filled)
      return mutate('행 삭제', (st) => {
        const r = deleteRows(st, sheet, f, n)
        return { state: r.state, info: { deleted: r.count, fixedFormulas: r.fixedFormulas }, summary: `${r.count}개 행 삭제` }
      })
    }
  )
  add(
    'delete_cols',
    '열을 지운다(내용도 함께 사라진다). 값이 있으면 사용자 확인(confirmed)이 필요하다. 이 열을 가리키던 수식은 #REF! 가 된다.',
    { sheet: sheetProp, from: { type: 'string', description: '지울 첫 열 글자(예: D)' }, count: { type: 'integer', description: '지울 열 수(기본 1)' }, confirmed: { type: 'boolean' } },
    ['from'],
    async ({ sheet, from, count, confirmed }) => {
      editBlocked()
      const state = host.getState()
      const target = findSheet(state, sheet)
      const f = colArg(from, 'from')
      const n = intArg(count, 'count', { min: 1, max: 50, dflt: 1 })
      const filled = countFilled(state, target, { c0: f, c1: Math.min(f + n - 1, columnsOf(state, target).length - 1), r0: 1, r1: target.rows.length + 1 })
      if (filled && !bool(confirmed)) return needConfirm(`${target.label} ${colLetter(f)}열 이후 ${n}개 열`, filled)
      return mutate('열 삭제', (st) => {
        const r = deleteCols(st, sheet, f, n)
        return { state: r.state, info: { deleted: r.count, fixedFormulas: r.fixedFormulas }, summary: `${r.count}개 열 삭제` }
      })
    }
  )
  add(
    'sort_range',
    '범위를 정렬한다. 행 전체 단위로 값이 움직이고(같은 행의 수식 참조도 따라간다) 기준 열은 계산된 값으로 비교한다. 빈 칸은 항상 아래로 간다. 1행(머리글)은 정렬하지 않는다.',
    {
      sheet: sheetProp,
      range: { type: 'string', description: '정렬할 범위(예: A1:F100). 열 전체 A:F 도 가능' },
      by: { type: 'array', description: '정렬 기준(앞 기준이 우선)', items: { type: 'object', properties: { col: { type: 'string', description: '기준 열 글자' }, order: { type: 'string', enum: ['asc', 'desc'] } }, required: ['col'] } },
      has_header: { type: 'boolean', description: '범위 첫 행이 머리글인지(기본 true). 1행을 포함한 범위는 true 여야 한다' },
    },
    ['range', 'by'],
    async ({ sheet, range, by, has_header }) =>
      mutate('정렬', (state) => {
        const base = findSheet(state, sheet)
        const { sheet: target, g } = resolveRange(state, base, range, { defaultUsed: false })
        if (!Array.isArray(by) || !by.length) fail('by 에 정렬 기준을 넣어 주세요. 예: [{col:"C", order:"desc"}]')
        const keys = by.map((k) => ({ c: colArg(k?.col, '기준 열'), order: k?.order === 'desc' ? 'desc' : 'asc' }))
        const ev = evaluatorFor(state)
        const r = sortRange(state, target.id, g, keys, { hasHeader: has_header !== false, evalAt: (c, row) => ev.display(target.id, c, row) })
        return { state: r.state, info: { sorted: r.count, moved: r.moved }, summary: r.moved ? `${r.count}행 정렬` : '이미 정렬되어 있음' }
      })
  )
  add(
    'remove_duplicates',
    '중복 행을 지운다(처음 나온 행만 남기고 행 전체 삭제). 범위는 모든 열을 포함해야 한다. 지울 행이 있으면 사용자 확인(confirmed)이 필요하다. dry_run 으로 몇 행이 지워질지 먼저 볼 수 있다.',
    {
      sheet: sheetProp,
      range: { type: 'string', description: '검사할 범위(예: A1:F200). 모든 열 포함' },
      key_cols: { type: 'array', items: { type: 'string' }, description: '중복 판단에 쓸 열 글자들(생략하면 범위의 모든 열이 같아야 중복)' },
      has_header: { type: 'boolean', description: '첫 행이 머리글인지(기본 true)' },
      dry_run: { type: 'boolean' },
      confirmed: { type: 'boolean' },
    },
    ['range'],
    async ({ sheet, range, key_cols, has_header, dry_run, confirmed }) => {
      editBlocked()
      const state = host.getState()
      const { sheet: target, g } = resolveRange(state, findSheet(state, sheet), range, { defaultUsed: false })
      const ev = evaluatorFor(state)
      const opts = { keyCols: Array.isArray(key_cols) ? key_cols.map((c) => colArg(c, 'key_cols')) : undefined, hasHeader: has_header !== false, evalAt: (c, r) => ev.display(target.id, c, r) }
      const probe = removeDuplicates(state, target.id, g, opts)
      if (!probe.removed) return { result: { ok: true, removed: 0 }, summary: '중복 없음' }
      if (bool(dry_run)) return { result: { ok: true, wouldRemove: probe.removed, rows: probe.rows.slice(0, 30) }, summary: `중복 ${probe.removed}행 발견(지우지 않음)` }
      if (!bool(confirmed)) return needConfirm(`중복 ${probe.removed}행(${probe.rows.slice(0, 8).join(', ')}${probe.rows.length > 8 ? ' 등' : ''}행)`, probe.removed)
      const undo = host.applyState(probe.state, '중복 제거')
      return { result: { ok: true, removed: probe.removed, rows: probe.rows.slice(0, 30) }, summary: `중복 ${probe.removed}행 삭제`, undo }
    }
  )
  add(
    'split_column',
    '한 열의 글을 구분자로 쪼개 오른쪽에 새 열을 끼워 넣고 채운다(기존 오른쪽 열은 밀려나서 덮어쓰지 않는다). 수식이 있는 칸은 나누지 않는다.',
    {
      sheet: sheetProp,
      col: { type: 'string', description: '나눌 열 글자' },
      delimiter: { type: 'string', description: '구분자(예: "," " " "-" "/") 또는 쉼표, 공백, 탭, 세미콜론' },
      headers: { type: 'array', items: { type: 'string' }, description: '나뉜 열의 머리글(왼쪽부터, 선택)' },
    },
    ['col', 'delimiter'],
    async ({ sheet, col, delimiter, headers }) =>
      mutate('열 나누기', (state) => {
        const r = splitColumn(state, sheet, colArg(col, 'col'), { delimiter, headers })
        if (r.state === state) return { state, info: { parts: 1, message: '구분자가 들어 있는 칸이 없어 나누지 않았습니다' } }
        return { state: r.state, info: { parts: r.parts, newColumns: r.newCols, rows: r.count }, summary: `${col}열을 ${r.parts}개 열로 나눔` }
      })
  )
  add(
    'add_sheet',
    '새 시트(탭)를 추가한다.',
    { name: { type: 'string', description: '시트 이름(30자 이내, 생략하면 자동)' } },
    [],
    async ({ name }) =>
      mutate('시트 추가', (state) => {
        const r = addSheet(state, name)
        return { state: r.state, info: { sheet: r.label }, summary: `"${r.label}" 시트 추가` }
      })
  )
  add(
    'rename_sheet',
    '시트 이름을 바꾼다. 다른 시트 수식 속 이 시트 이름도 함께 바뀐다.',
    { sheet: { type: 'string', description: '지금 이름' }, name: { type: 'string', description: '새 이름(30자 이내)' } },
    ['sheet', 'name'],
    async ({ sheet, name }) =>
      mutate('시트 이름 바꾸기', (state) => {
        const r = renameSheet(state, sheet, name)
        return { state: r.state, info: { sheet: r.label }, summary: `시트 이름을 "${r.label}" 로 바꿈` }
      })
  )
  add(
    'delete_sheet',
    '시트를 통째로 지운다. 사용자 확인(confirmed)이 필요하다. 다른 시트 수식이 이 시트를 가리키면 오류가 난다.',
    { sheet: { type: 'string', description: '지울 시트 이름' }, confirmed: { type: 'boolean' } },
    ['sheet'],
    async ({ sheet, confirmed }) => {
      editBlocked()
      const state = host.getState()
      const target = findSheet(state, sheet)
      if (!bool(confirmed)) return needConfirm(`"${target.label}" 시트 전체`, usedRange(state, target).rows || 1)
      return mutate('시트 삭제', (st) => {
        const r = deleteSheet(st, sheet)
        return { state: r.state, info: { deleted: r.label }, summary: `"${r.label}" 시트 삭제` }
      })
    }
  )

  // ── 서식 ──
  add(
    'format_range',
    `범위의 서식을 바꾼다. 이 시트가 지원하는 것만 쓴다: 굵게, 글자색, 채우기색, 정렬, 글자 크기, 줄바꿈(시트 전체), 고정 열(0-2), 열 너비. 숫자 서식(통화, 퍼센트, 소수 자리), 기울임, 테두리, 병합, 조건부 서식, 데이터 확인, 차트는 지원하지 않는다. 지원하지 않는 항목은 결과의 unsupported 에 나온다.`,
    {
      sheet: sheetProp,
      range: { type: 'string', description: '서식을 줄 범위(예: A2:D2). 데이터 행(2행부터)에만 적용된다' },
      bold: { type: 'boolean' },
      color: { type: 'string', enum: ['accent', 'meta', 'error', 'none'], description: '글자색: accent 보라, meta 회색, error 빨강, none 기본' },
      fill: { type: 'string', enum: ['subtle', 'accent', 'error', 'none'], description: '채우기: subtle 회색, accent 보라, error 빨강, none 없음' },
      align: { type: 'string', enum: ['left', 'center', 'right'] },
      size: { type: 'integer', enum: [12, 13, 14, 16, 18], description: '글자 크기' },
      wrap: { type: 'boolean', description: '텍스트 줄바꿈(시트 전체에 적용)' },
      freeze_cols: { type: 'integer', enum: [0, 1, 2], description: '왼쪽 고정 열 개수(행 고정은 지원하지 않음)' },
      column_widths: { type: 'object', description: '열 글자별 너비(48-800). 예: {"A":120,"C":200}' },
    },
    [],
    async (args) => {
      const { sheet, range, freeze_cols, column_widths } = args
      const extra = Object.keys(args).filter((k) => UNSUPPORTED_FORMATS.includes(k))
      return mutate('서식', (state) => {
        let cur = state
        const info = {}
        const base = findSheet(state, sheet)
        const fmt = {}
        for (const k of ['bold', 'color', 'fill', 'align', 'size', 'wrap']) if (args[k] !== undefined) fmt[k] = args[k]
        if (Object.keys(fmt).length) {
          const { sheet: target, g } = resolveRange(cur, base, range, { defaultUsed: false })
          const r = formatRange(cur, target.id, g, fmt)
          cur = r.state
          info.cells = r.cells
          if (r.unsupported.length) info.unsupported = r.unsupported
        }
        if (freeze_cols !== undefined || column_widths) {
          const widths = {}
          for (const [k, w] of Object.entries(column_widths || {})) widths[colArg(k, '열 너비의 열')] = w
          const r = setLayout(cur, base.id, { widths: column_widths ? widths : undefined, freezeCols: freeze_cols })
          cur = r.state
          if (r.changed.length) info.widthChanged = r.changed
        }
        if (cur === state && !extra.length) fail(`적용할 서식이 없습니다. 지원: ${Object.keys(SUPPORTED_FORMATS).join(', ')}, freeze_cols, column_widths`)
        if (extra.length) info.unsupported = [...(info.unsupported || []), ...extra]
        if (info.unsupported) info.note = '이 시트에 없는 기능이라 적용하지 않았습니다. 사용자에게 알려 주세요'
        return { state: cur, info, summary: `서식 적용${info.unsupported ? ` (미지원: ${info.unsupported.join(', ')})` : ''}` }
      })
    }
  )

  add(
    'find_replace',
    '시트에서 글을 찾아 바꾼다. 기본은 수식이 아닌 칸의 글만 바꾼다(include_formulas 로 수식 글자도 바꿈). 바뀔 칸 수를 먼저 보려면 dry_run.',
    {
      sheet: sheetProp,
      find: { type: 'string' },
      replace: { type: 'string', description: '바꿀 글(빈 글이면 지움)' },
      range: { type: 'string', description: '범위(생략하면 전체)' },
      match_case: { type: 'boolean' },
      whole_cell: { type: 'boolean', description: '칸 전체가 일치할 때만' },
      include_formulas: { type: 'boolean' },
      dry_run: { type: 'boolean' },
      confirmed: { type: 'boolean', description: '50칸이 넘게 바꿀 때 사용자 확인 표시' },
    },
    ['find'],
    async ({ sheet, find, replace, range, match_case, whole_cell, include_formulas, dry_run, confirmed }) => {
      editBlocked()
      const state = host.getState()
      const target = findSheet(state, sheet)
      const r = findReplace(state, target.id, { find: str(find), replace: str(replace), range, matchCase: bool(match_case), whole: bool(whole_cell), scope: bool(include_formulas) ? 'all' : 'values' })
      if (!r.count) return { result: { ok: true, replaced: 0 }, summary: '일치하는 칸 없음' }
      if (bool(dry_run)) return { result: { ok: true, wouldReplace: r.count, cells: r.hits.slice(0, 30) }, summary: `${r.count}칸이 바뀔 예정(바꾸지 않음)` }
      if (r.count > 50 && !bool(confirmed)) return needConfirm(`${r.count}칸`, r.count)
      const undo = host.applyState(r.state, '찾아 바꾸기')
      return { result: { ok: true, replaced: r.count, cells: r.hits.slice(0, 30) }, summary: `${r.count}칸 바꿈`, undo }
    }
  )

  // ── 계산과 점검 ──
  add(
    'analyze_range',
    '범위를 코드로 분석해 열별 종류, 개수, 빈칸, 고유값, 합계, 평균, 중앙값, 최소·최대(칸 위치 포함), 많이 나온 값, 이상치, 오류, 중복 행을 돌려준다. 합계나 평균 같은 숫자는 직접 계산하지 말고 반드시 이 도구나 compute 로 구한다.',
    {
      sheet: sheetProp,
      range: { type: 'string', description: '분석할 범위(생략하면 값이 있는 전체 영역). 1행은 머리글로 본다' },
      has_header: { type: 'boolean', description: '첫 행이 머리글인지(생략하면 자동 판단. 1행부터면 머리글)' },
    },
    [],
    async ({ sheet, range, has_header }) => {
      const state = host.getState()
      const { sheet: target, g } = resolveRange(state, findSheet(state, sheet), range, { usedOf: (x) => usedWithSpill(state, x) })
      const last = Math.min(g.r1, usedWithSpill(state, target).rows || 1)
      const gg = { ...g, r1: last, c1: Math.min(g.c1, columnsOf(state, target).length - 1) }
      const ev = evaluatorFor(state)
      const matrix = []
      for (let r = gg.r0; r <= gg.r1; r += 1) {
        const line = []
        for (let c = gg.c0; c <= gg.c1; c += 1) line.push(isPlaceholderHeader(rawAt(state, target, c, r)) && r === 1 ? '' : ev.display(target.id, c, r))
        matrix.push(line)
      }
      const a = analyzeMatrix(matrix, { origin: { c: gg.c0, r: gg.r0 }, header: has_header === undefined ? (gg.r0 === 1 ? true : 'auto') : has_header === true })
      return { result: { sheet: target.label, range: rangeName(gg), analysis: formatAnalysis(a, `${target.label} ${rangeName(gg)}`) }, summary: `${rangeName(gg)} 분석(${a.rows}행)` }
    }
  )

  add(
    'compute',
    '수식 하나를 시트에 쓰지 않고 계산해서 값을 돌려준다. 합계, 평균, 비율, 날짜 계산, 조회 결과를 확인하거나 낯선 함수를 시험할 때 쓴다. 범위는 현재(또는 지정한) 시트의 칸을 가리킨다. 배열이 나오면 펼쳐질 값도 보여 준다.',
    { formula: { type: 'string', description: '"="로 시작하는 수식(예: =SUMIFS(C2:C50,A2:A50,"서울"))' }, sheet: sheetProp },
    ['formula'],
    async ({ formula, sheet }) => {
      const state = host.getState()
      const target = findSheet(state, sheet)
      const f = str(formula).trim()
      if (!f) fail('formula 가 비어 있습니다')
      const text = f.startsWith('=') ? f : `=${f}`
      const v = engine.validateFormula(text, { sheets: state.sheets.map((s) => s.label) })
      if (!v.ok) return { result: { ok: false, error: v.message, ...(v.suggestion ? { suggestion: v.suggestion } : {}) }, summary: '수식 오류' }
      const r = engine.dryRun(state, target.id, text)
      const out = { ok: !r.isError, formula: text, value: r.display }
      if (r.isError) {
        out.error = r.code
        out.cause = LIKELY_CAUSE[r.code] || ''
      }
      if (r.spill) out.spill = { size: `${r.spill.rows}행 x ${r.spill.cols}열`, preview: r.spill.preview.map((row) => row.join('\t')).join('\n'), ...(r.spill.truncated ? { note: '앞부분만 표시' } : {}) }
      if (r.message && r.isError) out.message = clip(r.message, 160)
      return { result: out, summary: r.isError ? `계산 오류 ${r.code}` : `계산: ${clip(r.display, 40)}` }
    }
  )

  add(
    'find_errors',
    '시트의 오류 값(#REF!, #N/A, #DIV/0!, #VALUE!, #NAME?, #ERROR!)이 있는 칸을 모두 찾아 칸 주소, 수식, 가능한 원인을 알려 준다.',
    { sheet: sheetProp, all_sheets: { type: 'boolean', description: 'true 면 모든 시트를 검사' } },
    [],
    async ({ sheet, all_sheets }) => {
      const state = host.getState()
      const targets = bool(all_sheets) ? state.sheets : [findSheet(state, sheet)]
      const ev = evaluatorFor(state)
      const found = []
      for (const s of targets) {
        const u = usedRange(state, s)
        const cols = columnsOf(state, s)
        for (let r = 2; r <= u.rows; r += 1) {
          for (let c = 0; c < u.cols; c += 1) {
            const info = ev.info(s.id, c, r)
            if (info.isError) found.push({ sheet: s.label, ref: cellName(c, r), formula: clip(rawAt(state, s, c, r, cols), 120), error: info.code, cause: LIKELY_CAUSE[info.code] || '' })
          }
        }
      }
      return { result: { count: found.length, errors: found.slice(0, 40), ...(found.length > 40 ? { note: '40개만 표시' } : {}) }, summary: found.length ? `오류 ${found.length}칸` : '오류 없음' }
    }
  )

  function boundsOf(plan) {
    if (!plan.length) return null
    return { c0: Math.min(...plan.map((p) => p.c)), c1: Math.max(...plan.map((p) => p.c)), r0: Math.min(...plan.map((p) => p.r)), r1: Math.max(...plan.map((p) => p.r)) }
  }

  // ── 맥락 ──
  function getContext() {
    const state = host.getState()
    const sel = host.getSelection?.()
    const sheet = state.sheets.find((s) => s.id === (sel?.sheetId || state.activeId)) || state.sheets[0]
    const u = usedWithSpill(state, sheet)
    const lines = [`[시트 맥락] 지금 보는 시트: "${sheet.label}" (시트 ${state.sheets.length}개: ${state.sheets.map((s) => `"${s.label}"`).join(', ')})`]
    if (u.empty) lines.push('값이 있는 영역: 없음(빈 시트)')
    else {
      lines.push(`값이 있는 영역: A1:${cellName(u.cols - 1, u.rows)} (${u.rows - 1}개 데이터 행, ${u.cols}개 열)`)
      const cols = columnsOf(state, sheet)
      const heads = []
      for (let c = 0; c < Math.min(u.cols, 30); c += 1) {
        const h = visibleRaw(state, sheet, c, 1, cols)
        heads.push(`${colLetter(c)}=${h === '' ? '(빈 머리글)' : h}`)
      }
      lines.push(`머리글(1행): ${heads.join(', ')}`)
    }
    if (sel?.range) lines.push(`선택: ${rangeName(sel.range)}${sel.active ? ` (활성 칸 ${cellName(sel.active.c, sel.active.r)})` : ''}${sel.filtered ? ' (정렬·필터 켜짐: 화면 줄과 시트 행 번호가 다를 수 있음)' : ''}`)
    else lines.push('선택: 없음')
    try {
      if (u.rows * u.cols > 30000) throw new Error('큰 시트는 맥락에서 오류 수를 세지 않는다')
      const ev = evaluatorFor(state)
      const errs = newErrorSet(ev, state)
      lines.push(`오류 값 칸: ${errs.size}개`)
    } catch {
      /* 엔진 오류는 맥락에서 무시 */
    }
    return lines.join('\n')
  }

  return { tools, getContext }
}

export { colArg as __colArg }
