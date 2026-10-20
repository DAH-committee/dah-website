// DAH Sheet 수식 엔진 공개 API. 계약은 README.md 참고.
import { createEngine, parseCached, mayArray, fmtNum, isFormulaRaw } from './evaluator.js'
import { parse, walk, refText, colIndexOf, colName, a1 } from './parser.js'
import { FUNCS, listFunctions, hasFunction, suggestFunction, CATEGORIES } from './registry.js'
import { GErr, isErr, summaryKo, ERROR_CODES } from './errors.js'
import { literalValue } from './coerce.js'
import { colName as _cn } from './parser.js'
import './fn/math.js'
import './fn/logical.js'
import './fn/text.js'
import './fn/date.js'
import './fn/lookup.js'
import './fn/array.js'
import './fn/query.js'
import './fn/fin.js'
import './fn/misc.js'

for (const n of ['VLOOKUP', 'HLOOKUP', 'MATCH', 'XMATCH', 'XLOOKUP']) FUNCS.get(n).liftArgs = [0]
for (const n of ['SUMIF', 'COUNTIF', 'AVERAGEIF']) FUNCS.get(n).liftArgs = [1]

export { listFunctions, hasFunction, suggestFunction, CATEGORIES, ERROR_CODES, summaryKo, colIndexOf, colName, a1, fmtNum, isFormulaRaw }

/** 수식 문자열의 구문 검사. 계산하지 않고 부작용도 없다. */
export function validateFormula(text) {
  const src = String(text ?? '').trim()
  const body = src.startsWith('=') ? src.slice(1) : src
  const out = { ok: true, functionsUsed: [], unknownFunctions: [], refs: [], arityProblems: [], suggestions: {}, mayArray: false }
  let ast
  try { ast = parse(body) } catch (e) {
    out.ok = false
    out.error = { code: '#ERROR!', message: e.message || 'Formula parse error.', summary_ko: summaryKo('#ERROR!') }
    return out
  }
  const used = new Set(), unknown = new Set(), refs = new Set()
  const lambdaNames = new Set()
  walk(ast, (n) => {
    if (n.k === 'fn' && n.name === 'LAMBDA') n.args.slice(0, -1).forEach((x) => x.u && lambdaNames.add(x.u))
    if (n.k === 'fn' && n.name === 'LET') for (let i = 0; i < n.args.length - 1; i += 2) n.args[i].u && lambdaNames.add(n.args[i].u)
  })
  walk(ast, (n) => {
    if (n.k === 'fn') {
      const spec = FUNCS.get(n.name)
      if (spec) {
        used.add(n.name)
        const c = n.args.length
        if (c < spec.min || c > spec.max) out.arityProblems.push({ name: n.name, got: c, min: spec.min, max: spec.max === Infinity ? null : spec.max })
      } else if (!lambdaNames.has(n.name)) {
        unknown.add(n.orig)
        const s = suggestFunction(n.orig)
        if (s) out.suggestions[n.orig] = s
      }
    }
    if (n.k === 'ref' || n.k === 'range') refs.add(refText(n))
  })
  out.functionsUsed = [...used]
  out.unknownFunctions = [...unknown]
  out.refs = [...refs]
  out.mayArray = mayArray(ast)
  if (unknown.size) { out.ok = false; out.error = { code: '#NAME?', message: `Unknown function: '${[...unknown][0]}'.`, summary_ko: summaryKo('#NAME?') } }
  else if (out.arityProblems.length) { const p = out.arityProblems[0]; out.ok = false; out.error = { code: '#N/A', message: `Wrong number of arguments to ${p.name}. Got ${p.got}.`, summary_ko: summaryKo('#N/A') } }
  return out
}

/**
 * 메모리 안의 간단한 시트 묶음 호스트. { sheets: { 이름: { A1: '값', ... } } } 또는 평면 { A1: '값' }.
 * 시험·dry run용.
 */
export function createMemoryHost(spec = {}, options = {}) {
  const flat = Object.values(spec).length && Object.values(spec).every((v) => v === null || typeof v !== 'object')
  const sheets = flat ? { Sheet1: spec } : spec
  const names = Object.keys(sheets).length ? Object.keys(sheets) : ['Sheet1']
  const data = new Map() // name -> Map('c,r' -> raw)
  const extent = new Map()
  const put = (name, c, r, raw) => {
    if (!data.has(name)) data.set(name, new Map())
    if (raw === null || raw === undefined || raw === '') data.get(name).delete(`${c},${r}`)
    else data.get(name).set(`${c},${r}`, typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : String(raw))
  }
  for (const n of names) for (const [ref, raw] of Object.entries(sheets[n] || {})) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(ref); if (!m) continue
    put(n, colIndexOf(m[1]), Number(m[2]), raw)
  }
  const minRows = options.minRows || 0, minCols = options.minCols || 0
  const host = {
    sheets: names.map((n) => ({ id: n, name: n })),
    defaultSheet: names[0],
    getRaw(c, r, id) {
      const name = id === undefined ? names[0] : id
      if (!data.has(name) && !names.includes(name)) return null
      const b = host.getBounds(name)
      if (r < 1 || c < 0 || r > b.rows || c >= b.cols) return null
      return data.get(name)?.get(`${c},${r}`) ?? ''
    },
    getBounds(id) {
      const name = id === undefined ? names[0] : id
      let rows = minRows, cols = minCols
      for (const k of data.get(name)?.keys() || []) { const [c, r] = k.split(',').map(Number); rows = Math.max(rows, r); cols = Math.max(cols, c + 1) }
      return { rows: Math.max(rows, 1), cols: Math.max(cols, 1) }
    },
    set(id, ref, raw) { const m = /^([A-Za-z]+)(\d+)$/.exec(ref); put(id === undefined ? names[0] : id, colIndexOf(m[1]), Number(m[2]), raw) },
  }
  return host
}

/** 수식 하나를 시트에 영향 없이 계산한다 (dry run). ctx: { cells?, sheets?, now?, sheetId? } */
export function evaluateFormulaOnce(text, ctx = {}) {
  const src = String(text ?? '')
  const data = ctx.sheets || ctx.cells || {}
  // 수식을 데이터가 없는 바깥 칸에 두고, 오른쪽·아래로 펼칠 여유를 준다
  let maxCol = 0
  const scan = (o) => { for (const k of Object.keys(o)) { const m = /^([A-Za-z]+)\d+$/.exec(k); if (m) maxCol = Math.max(maxCol, colIndexOf(m[1]) + 1) } }
  if (ctx.sheets) Object.values(ctx.sheets).forEach(scan); else scan(data)
  const tc = Math.max(maxCol + 1, 3)
  const target = `${colName(tc)}1`
  const host = createMemoryHost(data, { minRows: ctx.minRows || 2000, minCols: tc + 300 })
  host.set(undefined, target, src.startsWith('=') ? src : `=${src}`)
  const eng = createEngine({ ...host, getRaw: host.getRaw, getBounds: host.getBounds, now: ctx.now, random: ctx.random, namedRanges: ctx.namedRanges })
  return eng.evaluateCell(ctx.sheetId, target)
}

/**
 * 기존 호환 진입점. createEvaluator(getRaw, now) 는 (c, r) => 표시 문자열 함수를 돌려준다.
 * createEvaluator({ getRaw(c,r,sheetId), getBounds(sheetId), sheets, defaultSheet, now, random, namedRanges }) 는 같은 함수에 엔진 API가 붙은 함수를 돌려준다.
 */
export function createEvaluator(optsOrGetRaw, now) {
  const opts = typeof optsOrGetRaw === 'function' ? { getRaw: optsOrGetRaw, now } : { ...optsOrGetRaw }
  const eng = createEngine(opts)
  const fn = (c, r, sheetId) => eng.display(c, r, sheetId)
  Object.assign(fn, eng)
  fn.engine = eng
  return fn
}
export { createEngine }
