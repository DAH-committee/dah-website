// 수식 계산 엔진 핵심: 의존 그래프, 증분 재계산, 배열 펼침(spill), 순환 참조 처리
import { GErr, isErr, eDiv0, eNA, eName, eNum, eRef, eValue, eCirc, eParse, summaryKo } from './errors.js'
import { gpow, Rng, Lambda, isRng, isMat, isLambda, N, S, B, topLeft, literalValue, compare, numToStr, parseNumberText } from './coerce.js'
import { parse, walk, a1, refText, colName } from './parser.js'
import { FUNCS } from './registry.js'
import { formatValue } from './format.js'
import { fmtDate, fmtDateTime, fmtTime, fmtDateKo, fmtTimeKo, serialFromDate } from './dates.js'

const MAX_COL = 20000
const ROW_MUL = 1000001
const keyOf = (idx, c, r) => (idx * ROW_MUL + r) * MAX_COL + c
const MAX_DIRECT_AREA = 200000
const FORMULA_FN_FMT = { TODAY: 'date', NOW: 'datetime', DATE: 'date', EDATE: 'date', EOMONTH: 'date', WORKDAY: 'date', 'WORKDAY.INTL': 'date', TO_DATE: 'date', TIME: 'time', TO_PERCENT: 'percent', TO_DOLLARS: 'dollar' }
const PASS_FMT = new Set(['IF', 'IFERROR', 'IFNA', 'ARRAYFORMULA', 'MAX', 'MIN', 'IFS', 'SWITCH', 'CHOOSE', 'LET', 'INDEX', 'SORT', 'UNIQUE', 'FILTER'])

export const isFormulaRaw = (raw) => typeof raw === 'string' && raw.length > 1 && raw.charCodeAt(0) === 61

/** 일반 서식 표시: 유효숫자 10자리, 1e15 이상·1e-9 미만은 지수 표기(관찰: 1E+15, 1.23457E+17, 0.0000001) */
export function fmtNum(n) {
  if (typeof n !== 'number') return String(n)
  if (!Number.isFinite(n)) return '#NUM!'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e15 || abs < 1e-9) {
    const [m, e] = n.toExponential(5).split('e')
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m
    return `${mant}E${e[0] === '-' ? '-' : '+'}${e.replace(/^[+-]/, '')}`
  }
  if (Number.isInteger(n)) return String(n)
  const p = Number(n.toPrecision(10))
  let t = String(p)
  if (t.includes('e')) t = p.toFixed(18).replace(/0+$/, '').replace(/\.$/, '')
  return t
}

// ── 구문 분석 캐시 ───────────────────────────────────────────
const parseCache = new Map()
export function parseCached(src) {
  let hit = parseCache.get(src)
  if (hit) return hit
  try { hit = { ast: parse(src) } } catch (e) { hit = { error: e instanceof GErr ? e : eParse() } }
  if (parseCache.size > 30000) parseCache.clear()
  parseCache.set(src, hit)
  return hit
}

/** 결과가 배열일 수 있는 수식인지(정적 판단). 펼침 후보를 미리 찾는 데 쓴다. */
export function mayArray(node) {
  switch (node.k) {
    case 'range': case 'rangeop': return true
    case 'arr': return node.rows.length > 1 || node.rows[0].length > 1
    case 'paren': return mayArray(node.a)
    case 'call': return true
    case 'name': return true
    case 'fn': {
      const f = FUNCS.get(node.name)
      if (!f) return true // 람다 변수 호출일 수 있다
      if (f.arr) return true
      if (f.pass) return node.args.some(mayArray)
      return false
    }
    case 'bin': return false
    default: return false
  }
}

/** 정적으로 알 수 있는 참조 목록 */
export function staticRefs(ast) {
  if (ast._sr) return ast._sr
  const list = []
  walk(ast, (n) => { if (n.k === 'ref' || n.k === 'range') list.push(n) })
  ast._sr = list
  return list
}

export function createEngine(opts = {}) {
  const getRawHost = opts.getRaw
  const nowFn = opts.now || (() => new Date())
  const randFn = opts.random || Math.random
  const sheetList = opts.sheets || null
  const defaultSheet = opts.defaultSheet !== undefined ? opts.defaultSheet : sheetList && sheetList.length ? sheetList[0].id : undefined
  const namedRanges = opts.namedRanges || null
  const dateStyle = opts.dateStyle || 'ko' // 'ko': 2025. 1. 1 (구글 ko-KR 기본), 'iso': 2025-01-01
  const locale = opts.locale || 'ko'

  const sheetIds = []
  const sheetIdxMap = new Map()
  const idxOf = (id) => {
    let i = sheetIdxMap.get(id)
    if (i === undefined) { i = sheetIds.length; sheetIds.push(id); sheetIdxMap.set(id, i) }
    return i
  }
  idxOf(defaultSheet)
  const resolveSheetName = (name) => {
    if (name == null) return { ok: true, id: undefined, self: true }
    if (opts.resolveSheet) { const id = opts.resolveSheet(name); return id === undefined || id === null ? { ok: false } : { ok: true, id } }
    if (sheetList) {
      const low = String(name).toLowerCase()
      const s = sheetList.find((x) => String(x.name).toLowerCase() === low) || sheetList.find((x) => String(x.id) === String(name))
      return s ? { ok: true, id: s.id } : { ok: false }
    }
    return { ok: false }
  }
  const getRaw = (idx, c, r) => getRawHost(c, r, sheetIds[idx])

  // ── 상태 ──────────────────────────────────────────────────
  const cache = new Map() // key -> entry
  const dependents = new Map() // key -> Set(key)
  const rangeDepsOf = new Map() // dkey -> Rng[]
  const rangeIndex = new Map() // (idx*MAX_COL+col) -> Set(dkey)
  const wideRange = new Set() // 열이 너무 넓은 범위 의존
  const spillAt = new Map() // key -> { owner, i, j }
  const spillerSet = new Set()
  let spillersScanned = false
  let spillersReady = false
  const pendingSpillers = new Set()
  const volatileKeys = new Set()
  const boundsCache = new Map()
  const matMemo = new Map() // 범위 -> 펼친 배열(다음 변경 때까지 재사용)
  const stack = new Set()
  let depth = 0
  let priming = false
  const stats = { evals: 0, cacheHits: 0, invalidated: 0 }

  // ── 범위 크기 ─────────────────────────────────────────────
  function bounds(idx) {
    let b = boundsCache.get(idx)
    if (b) return b
    if (opts.getBounds) {
      const x = opts.getBounds(sheetIds[idx]) || {}
      b = { rows: x.rows || 0, cols: x.cols || 0 }
    } else {
      const probe = (f) => {
        if (f(1) == null) return 0
        let hi = 1
        while (hi < 4e6 && f(hi * 2) != null) hi *= 2
        let lo = hi
        hi = hi * 2
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f(mid) != null) lo = mid; else hi = mid }
        return lo
      }
      b = { rows: probe((r) => getRaw(idx, 0, r)), cols: probe((c) => getRaw(idx, c - 1, 1)) }
    }
    boundsCache.set(idx, b)
    return b
  }
  const inGrid = (idx, c, r) => {
    if (r < 1 || c < 0) return false
    const b = bounds(idx)
    return r <= b.rows && c < b.cols
  }

  // ── 범위 의존 색인 ────────────────────────────────────────
  function registerRanges(dkey, rngs) {
    if (!rngs.length) return
    rangeDepsOf.set(dkey, rngs)
    for (const g of rngs) {
      const b = bounds(g.sheet)
      const c2 = Math.min(g.c2, Math.max(b.cols - 1, g.c1))
      if (c2 - g.c1 > 200) { wideRange.add(dkey); continue }
      for (let c = g.c1; c <= c2; c++) {
        const bk = g.sheet * MAX_COL + c
        let s = rangeIndex.get(bk)
        if (!s) { s = new Set(); rangeIndex.set(bk, s) }
        s.add(dkey)
      }
    }
  }
  function deregisterRanges(dkey) {
    const rngs = rangeDepsOf.get(dkey)
    if (!rngs) return
    rangeDepsOf.delete(dkey)
    wideRange.delete(dkey)
    for (const g of rngs) {
      const b = bounds(g.sheet)
      const c2 = Math.min(g.c2, Math.max(b.cols - 1, g.c1))
      if (c2 - g.c1 > 200) continue
      for (let c = g.c1; c <= c2; c++) { const s = rangeIndex.get(g.sheet * MAX_COL + c); if (s) s.delete(dkey) }
    }
  }

  function dropEntry(k) {
    const e = cache.get(k)
    if (!e) return null
    cache.delete(k)
    deregisterRanges(k)
    volatileKeys.delete(k)
    if (e.spillKeys) for (const sk of e.spillKeys) spillAt.delete(sk)
    stats.invalidated++
    return e
  }

  /** 키 하나가 바뀌었음을 알리고 의존하는 계산 결과를 버린다 */
  function cascade(startKeys) {
    matMemo.clear()
    const q = [...startKeys]
    const seen = new Set()
    while (q.length) {
      const k = q.pop()
      if (seen.has(k)) continue
      seen.add(k)
      const e = dropEntry(k)
      if (e && e.isSpiller) pendingSpillers.add(k)
      if (e && e.spillKeys) for (const sk of e.spillKeys) q.push(sk)
      const ownerOfK = spillAt.get(k)?.owner
      const ds = dependents.get(k)
      if (ds) for (const d of ds) if (cache.has(d) && d !== ownerOfK) q.push(d)
      const c = k % MAX_COL
      const rest = (k - c) / MAX_COL
      const r = rest % ROW_MUL
      const idx = (rest - r) / ROW_MUL
      const bucket = rangeIndex.get(idx * MAX_COL + c)
      if (bucket && bucket.size) {
        for (const d of [...bucket]) {
          if (!cache.has(d) || seen.has(d) || d === ownerOfK) continue
          const rg = rangeDepsOf.get(d)
          if (rg && rg.some((g) => g.sheet === idx && c >= g.c1 && c <= g.c2 && r >= g.r1 && r <= g.r2)) q.push(d)
        }
      }
      if (wideRange.size) {
        for (const d of [...wideRange]) {
          if (!cache.has(d) || seen.has(d) || d === ownerOfK) continue
          const rg = rangeDepsOf.get(d)
          if (rg && rg.some((g) => g.sheet === idx && c >= g.c1 && c <= g.c2 && r >= g.r1 && r <= g.r2)) q.push(d)
        }
      }
    }
  }

  // ── 칸 읽기 ──────────────────────────────────────────────
  function ensureSpillers() {
    if (spillersReady) return
    spillersReady = true
    if (!spillersScanned) {
      spillersScanned = true
      for (let idx = 0; idx < sheetIds.length; idx++) {
        const b = bounds(idx)
        for (let r = 1; r <= b.rows; r++) for (let c = 0; c < b.cols; c++) {
          const raw = getRaw(idx, c, r)
          if (isFormulaRaw(raw)) {
            const pc = parseCached(raw.slice(1))
            if (pc.ast && mayArray(pc.ast)) spillerSet.add(keyOf(idx, c, r))
          }
        }
      }
    }
    for (const k of [...spillerSet]) { if (!cache.has(k)) { const { idx, c, r } = decode(k); readCell(idx, c, r) } }
  }
  function decode(k) {
    const c = k % MAX_COL
    const rest = (k - c) / MAX_COL
    const r = rest % ROW_MUL
    return { idx: (rest - r) / ROW_MUL, c, r }
  }

  /** 칸의 유효 값(수식 결과, 펼쳐진 값 포함)을 읽는다. 의존은 호출한 쪽이 기록한다. */
  function readCell(idx, c, r) {
    if (r < 1 || c < 0) return eRef('Reference does not exist.')
    const key = keyOf(idx, c, r)
    const hit = cache.get(key)
    if (hit) { stats.cacheHits++; return hit.v }
    const raw = getRaw(idx, c, r)
    if (raw == null) return null
    if (isFormulaRaw(raw)) return evalFormulaCell(idx, c, r, key, raw).v
    if (raw === '' || raw === undefined) {
      if (!spillersReady) ensureSpillers()
      const sp = spillAt.get(key)
      if (sp) { const e = cache.get(sp.owner); if (e && e.m) return e.m[sp.i][sp.j] }
      return null
    }
    const v = literalValue(raw)
    cache.set(key, { v, lit: true })
    return v
  }

  // ── 소수 계산 ────────────────────────────────────────────
  function primeDeps(startKey) {
    // 정적 참조를 따라 의존 칸을 먼저(후위 순서로) 계산해 재귀 깊이를 줄인다
    priming = true
    try {
      const st = [{ key: startKey, it: null }]
      const visited = new Set([startKey])
      while (st.length) {
        const top = st[st.length - 1]
        if (!top.it) {
          const { idx, c, r } = decode(top.key)
          const raw = getRaw(idx, c, r)
          const list = []
          if (isFormulaRaw(raw)) {
            const pc = parseCached(raw.slice(1))
            if (pc.ast) {
              for (const n of staticRefs(pc.ast)) {
                let sidx = idx
                if (n.sheet != null) { const rs = resolveSheetName(n.sheet); if (!rs.ok) continue; sidx = idxOf(rs.id) }
                if (n.k === 'ref') list.push([sidx, n.c, n.r])
                else {
                  const b = bounds(sidx)
                  const r2 = Math.min(n.r2, b.rows), c2 = Math.min(n.c2, b.cols - 1)
                  if ((r2 - n.r1 + 1) * (c2 - n.c1 + 1) > 100000) continue
                  for (let rr = n.r1; rr <= r2; rr++) for (let cc = n.c1; cc <= c2; cc++) list.push([sidx, cc, rr])
                }
              }
            }
          }
          top.it = list
          top.i = 0
        }
        if (top.i < top.it.length) {
          const [si, cc, rr] = top.it[top.i++]
          const k = keyOf(si, cc, rr)
          if (visited.has(k) || cache.has(k)) continue
          const raw = getRaw(si, cc, rr)
          if (!isFormulaRaw(raw)) continue
          visited.add(k)
          st.push({ key: k, it: null })
        } else {
          st.pop()
          if (top.key !== startKey && !cache.has(top.key)) { const { idx, c, r } = decode(top.key); const raw = getRaw(idx, c, r); evalFormulaCell(idx, c, r, top.key, raw) }
        }
      }
    } finally { priming = false }
  }

  function hintOf(node, idx, d = 0) {
    if (d > 8) return null
    switch (node.k) {
      case 'paren': case 'pos': return hintOf(node.a, idx, d + 1)
      case 'fn': {
        if (FORMULA_FN_FMT[node.name]) return FORMULA_FN_FMT[node.name]
        if (PASS_FMT.has(node.name)) {
          for (const a of node.args) { const h = hintOf(a, idx, d + 1); if (h) return h }
        }
        return null
      }
      case 'bin': {
        if (node.op !== '+' && node.op !== '-') return null
        const ha = hintOf(node.a, idx, d + 1), hb = hintOf(node.b, idx, d + 1)
        if (node.op === '+') return ha || hb
        return ha && hb ? null : ha
      }
      case 'ref': {
        let sidx = idx
        if (node.sheet != null) { const rs = resolveSheetName(node.sheet); if (!rs.ok) return null; sidx = idxOf(rs.id) }
        const raw = getRaw(sidx, node.c, node.r)
        if (typeof raw !== 'string') return null
        if (isFormulaRaw(raw)) { const pc = parseCached(raw.slice(1)); return pc.ast ? hintOf(pc.ast, sidx, d + 1) : null }
        return rawHint(raw)
      }
      default: return null
    }
  }
  const rawHint = (raw) => {
    const t = String(raw).trim()
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(t)) return 'isodate'
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}/.test(t)) return 'isodatetime'
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return 'isotime'
    return null
  }

  function evalFormulaCell(idx, c, r, key, raw) {
    const hit = cache.get(key)
    if (hit) return hit
    if (stack.has(key)) return { v: eCirc() }
    if (depth > 120 && !priming) primeDeps(key)
    const again = cache.get(key)
    if (again) return again
    stats.evals++
    const entry = { v: null, m: null, isSpiller: false, deps: null, hint: null, ast: null }
    const pc = parseCached(raw.slice(1))
    stack.add(key)
    depth++
    const ctx = makeCtx(idx, c, r, key)
    try {
      if (pc.error) { entry.v = pc.error } else {
        entry.ast = pc.ast
        entry.isSpiller = mayArray(pc.ast)
        let val
        try { val = ev(pc.ast, ctx) } catch (e) {
          if (e instanceof GErr) val = e
          else if (e instanceof RangeError) val = eRef('Formula is too deeply nested.')
          else throw e
        }
        if (isRng(val)) val = ctx.mat(val)
        if (isLambda(val)) val = eValue('Lambda value cannot be displayed. Call it with arguments.')
        if (isMat(val)) {
          if (val.length === 1 && val[0].length === 1) val = val[0][0]
          else if (!val.length || !val[0].length) val = eRef('Array result is empty.')
        }
        if (isMat(val) && val.colHints) entry.colHints = val.colHints
        if (isMat(val)) applySpill(entry, idx, c, r, key, val, ctx)
        else entry.v = val == null ? null : val
        if (!isErr(entry.v)) entry.hint = hintOf(pc.ast, idx)
        else entry.hint = null
      }
    } finally {
      stack.delete(key)
      depth--
    }
    entry.deps = ctx.deps
    cache.set(key, entry)
    for (const d of ctx.deps) {
      let s = dependents.get(d)
      if (!s) { s = new Set(); dependents.set(d, s) }
      s.add(key)
    }
    registerRanges(key, ctx.rdeps)
    if (ctx.vol) volatileKeys.add(key)
    if (entry.isSpiller) spillerSet.add(key)
    return entry
  }

  function applySpill(entry, idx, c, r, key, m, ctx) {
    const rows = m.length, cols = m[0].length
    const b = bounds(idx)
    entry.m = m
    entry.rows = rows
    entry.cols = cols
    entry.v = m[0][0] === undefined ? null : m[0][0]
    if (isErr(entry.v) && false) return
    if (r + rows - 1 > b.rows) { entry.v = new GErr('#REF!', `Result was not automatically expanded, please insert more rows (${r + rows - 1 - b.rows}).`); entry.m = null; entry.blocked = true; return }
    if (c + cols - 1 >= b.cols) { entry.v = new GErr('#REF!', `Result was not automatically expanded, please insert more columns (${c + cols - b.cols}).`); entry.m = null; entry.blocked = true; return }
    ctx.rdeps.push(new Rng(idx, c, r, c + cols - 1, r + rows - 1))
    const keys = []
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (i === 0 && j === 0) continue
      const raw = getRaw(idx, c + j, r + i)
      const k = keyOf(idx, c + j, r + i)
      const other = spillAt.get(k)
      if ((raw != null && raw !== '') || (other && other.owner !== key)) {
        entry.v = new GErr('#REF!', `Array result was not expanded because it would overwrite data in ${a1(c + j, r + i)}.`)
        entry.m = null
        entry.blocked = true
        return
      }
      keys.push(k)
    }
    entry.spillKeys = keys
    let n = 0
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (i === 0 && j === 0) continue
      spillAt.set(keys[n++], { owner: key, i, j })
    }
    entry.region = { idx, c, r, rows, cols }
  }

  // ── 계산 문맥 ────────────────────────────────────────────
  function makeCtx(idx, c, r, key) {
    const ctx = {
      sheet: idx, c, r, key, arr: false, scope: null, deps: new Set(), rdeps: [], vol: false, engine: null,
      sheetId: sheetIds[idx],
      locale,
      rawHintAt: (sidx, cc, rr) => { const raw = getRaw(sidx, cc, rr); return typeof raw === 'string' && !isFormulaRaw(raw) ? rawHint(raw) : null },
      readRef(sidx, cc, rr) { ctx.deps.add(keyOf(sidx, cc, rr)); return readCell(sidx, cc, rr) },
      mat(v) {
        if (isRng(v)) return materialize(v, ctx)
        if (isMat(v)) return v
        return [[v]]
      },
      sc(v) {
        if (isRng(v)) { if (v.r2 > v.r1 || v.c2 > v.c1) throw eValue('Expected a single value but got a range.'); return topLeft(v, ctx) }
        return isMat(v) ? topLeft(v, ctx) : v
      },
      broadcast,
      bounds: (sidx) => bounds(sidx),
      now: () => nowFn(),
      rand: () => randFn(),
      markVolatile() { ctx.vol = true },
      call(lam, args) { return callLambda(lam, args, ctx) },
      ev: (node) => ev(node, ctx),
      evalRef: (node) => evalRef(node, ctx),
      resolveSheet: (name) => resolveSheetName(name),
      idxOf,
      sheetName: (sidx) => { const id = sheetIds[sidx]; if (sheetList) { const s = sheetList.find((x) => x.id === id); if (s) return s.name } return String(id ?? '') },
      parseRefText: (text) => parseRefText(text, ctx),
      isBlankCell: (sidx, cc, rr) => { const raw = getRaw(sidx, cc, rr); ctx.deps.add(keyOf(sidx, cc, rr)); if (isFormulaRaw(raw)) { const v = readCell(sidx, cc, rr); return v == null } return raw == null || raw === '' ? readCell(sidx, cc, rr) == null : false },
      rawOf: (sidx, cc, rr) => getRaw(sidx, cc, rr),
      hint: (node) => hintOf(node, ctx.sheet),
    }
    ctx.engine = engineApi
    return ctx
  }

  function materialize(g, ctx) {
    const b = bounds(g.sheet)
    const r1 = g.r1, c1 = g.c1
    let r2 = g.r2, c2 = g.c2
    const area = (Math.min(r2, 1e9) - r1 + 1) * (Math.min(c2, 1e9) - c1 + 1)
    if (!(area <= MAX_DIRECT_AREA && r2 !== Infinity && c2 !== Infinity)) {
      r2 = Math.min(r2, Math.max(b.rows, r1))
      c2 = Math.min(c2, Math.max(b.cols - 1, c1))
    }
    ctx.rdeps.push(g)
    const mk = `${g.sheet}:${c1}:${r1}:${c2}:${r2}`
    const memo = matMemo.get(mk)
    if (memo) return memo
    const out = []
    for (let r = r1; r <= r2; r++) {
      const row = []
      for (let c = c1; c <= c2; c++) row.push(readCell(g.sheet, c, r))
      out.push(row)
    }
    if (area <= MAX_DIRECT_AREA) matMemo.set(mk, out)
    return out
  }

  function callLambda(lam, args, ctx) {
    const saved = ctx.scope
    const scope = Object.create(lam.scope || null)
    lam.params.forEach((p, i) => { scope[p] = i < args.length ? args[i] : null })
    ctx.scope = scope
    try {
      const v = ev(lam.body, ctx)
      return v
    } finally { ctx.scope = saved }
  }

  function parseRefText(text, ctx) {
    const t = String(text).trim()
    let ast
    try { ast = parse(t) } catch { return null }
    if (ast.k === 'ref' || ast.k === 'range') return refNodeToRng(ast, ctx)
    if (ast.k === 'name' && namedRanges && namedRanges[ast.v]) return parseRefText(namedRanges[ast.v], ctx)
    return null
  }
  function refNodeToRng(n, ctx) {
    let sidx = ctx.sheet
    if (n.sheet != null) {
      const rs = resolveSheetName(n.sheet)
      if (!rs.ok) return eRef(`Unknown sheet name '${n.sheet}'.`)
      sidx = idxOf(rs.id)
    }
    if (n.k === 'ref') return new Rng(sidx, n.c, n.r, n.c, n.r)
    return new Rng(sidx, Math.min(n.c1, n.c2), Math.min(n.r1, n.r2), Math.max(n.c1, n.c2), Math.max(n.r1, n.r2))
  }
  /** 값이 아니라 참조(Rng)로 평가한다 (ROW, COLUMN, OFFSET 등용) */
  function evalRef(node, ctx) {
    if (node.k === 'ref' || node.k === 'range') return refNodeToRng(node, ctx)
    if (node.k === 'paren') return evalRef(node.a, ctx)
    const v = ev(node, ctx)
    return v
  }

  // ── 연산자 ───────────────────────────────────────────────
  const OPNAME = { '+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE', '^': 'POW' }
  function opNum(v, op, pos) {
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = v.trim() === '' ? 0 : parseNumberText(v)
      if (n === undefined) throw eValue(`Function ${OPNAME[op]} parameter ${pos} expects number values. But '${v}' is a text and cannot be coerced to a number.`)
      return n
    }
    return N(v)
  }
  function arith(op, a, b) {
    if (isErr(a)) return a
    if (isErr(b)) return b
    try {
      switch (op) {
        case '+': { const x = opNum(a, op, 1), y = opNum(b, op, 2); return fin(snap(x + y, x, y)) }
        case '-': { const x = opNum(a, op, 1), y = opNum(b, op, 2); return fin(snap(x - y, x, y)) }
        case '*': return fin(opNum(a, op, 1) * opNum(b, op, 2))
        case '/': { const x = opNum(a, op, 1), y = opNum(b, op, 2); if (y === 0) return new GErr('#DIV/0!', 'Function DIVIDE parameter 2 cannot be zero.'); return fin(x / y) }
        case '^': { const x = opNum(a, op, 1), y = opNum(b, op, 2); return gpow(x, y) }
        case '&': return S(a) + S(b)
        default: {
          const cmp = compare(a, b)
          switch (op) {
            case '=': return cmp === 0
            case '<>': return cmp !== 0
            case '<': return cmp < 0
            case '>': return cmp > 0
            case '<=': return cmp <= 0
            default: return cmp >= 0
          }
        }
      }
    } catch (e) { if (e instanceof GErr) return e; throw e }
  }
  const snap = (r, x, y) => (r !== 0 && Math.abs(r) < 1e-15 * Math.max(Math.abs(x), Math.abs(y)) ? 0 : r)
  const fin = (x) => (Number.isFinite(x) ? x : eNum('Result is not a finite number.'))

  /** 원소별 브로드캐스트. 한쪽이 1행/1열이면 늘려 맞추고, 크기가 안 맞으면 #N/A */
  function broadcast(vals, f) {
    const mats = vals.map((v) => (isMat(v) ? v : [[v]]))
    let rows = 1, cols = 1
    for (const m of mats) { rows = Math.max(rows, m.length); cols = Math.max(cols, m.length ? m[0].length : 0) }
    const out = []
    for (let i = 0; i < rows; i++) {
      const row = []
      for (let j = 0; j < cols; j++) {
        const args = []
        let bad = false
        for (const m of mats) {
          const rr = m.length === 1 ? 0 : i, cc = (m[0].length === 1) ? 0 : j
          if (rr >= m.length || cc >= m[0].length) { bad = true; break }
          args.push(m[rr][cc])
        }
        row.push(bad ? eNA('Array arguments have mismatched sizes.') : f(args))
      }
      out.push(row)
    }
    return out
  }
  const needsArr = (v, ctx) => isMat(v) || (ctx.arr && isRng(v))

  function ev(node, ctx) {
    switch (node.k) {
      case 'num': case 'str': case 'bool': return node.v
      case 'err': return new GErr(node.v)
      case 'empty': return null
      case 'paren': return ev(node.a, ctx)
      case 'ref': {
        let sidx = ctx.sheet
        if (node.sheet != null) {
          const rs = resolveSheetName(node.sheet)
          if (!rs.ok) return eRef(`Unknown sheet name '${node.sheet}'.`)
          sidx = idxOf(rs.id)
        }
        return ctx.readRef(sidx, node.c, node.r)
      }
      case 'range': return refNodeToRng(node, ctx)
      case 'rangeop': {
        const a = evalRef(node.a, ctx), b = evalRef(node.b, ctx)
        if (isErr(a)) return a
        if (isErr(b)) return b
        if (!isRng(a) || !isRng(b)) return eValue('Range operator needs references.')
        return new Rng(a.sheet, Math.min(a.c1, b.c1), Math.min(a.r1, b.r1), Math.max(a.c2, b.c2), Math.max(a.r2, b.r2))
      }
      case 'name': {
        const u = node.u
        if (ctx.scope && u in ctx.scope) return ctx.scope[u]
        if (namedRanges && namedRanges[node.v] !== undefined) {
          const g = parseRefText(namedRanges[node.v], ctx)
          if (g) return g
        }
        return new GErr('#NAME?', `Unknown range name: '${node.v}'.`)
      }
      case 'arr': {
        if (!node.rows.length || !node.rows[0].length) return eRef('Array literal is empty.')
        const blocks = node.rows.map((row) => row.map((x) => { const v = ev(x, ctx); if (isLambda(v)) throw eValue(); return isRng(v) ? ctx.mat(v) : isMat(v) ? v : [[v]] }))
        const out = []
        for (const row of blocks) {
          const h = row[0].length ? row[0].length : 0
          const hh = row[0].length
          if (row.some((b) => b.length !== row[0].length)) return eRef('Array literal parts have different heights.')
          void h; void hh
          for (let i = 0; i < row[0].length; i++) out.push(row.flatMap((b) => b[i]))
        }
        if (out.length && out.some((r) => r.length !== out[0].length)) return eRef('Array literal rows have different widths.')
        return out
      }
      case 'neg': case 'pos': case 'pct': {
        const v = ev(node.a, ctx)
        const f = (x) => {
          if (isErr(x)) return x
          try {
            if (node.k === 'pos') return typeof x === 'string' ? x : x
            const n = opNum(x, node.k === 'neg' ? '-' : '/', 1)
            return node.k === 'neg' ? -n : n / 100
          } catch (e) { if (e instanceof GErr) return e; throw e }
        }
        if (needsArr(v, ctx)) return broadcast([ctx.mat(v)], (a) => f(a[0]))
        return f(ctx.sc(v))
      }
      case 'bin': {
        const a = ev(node.a, ctx), b = ev(node.b, ctx)
        if (needsArr(a, ctx) || needsArr(b, ctx)) {
          const out = broadcast([isMat(a) || isRng(a) ? ctx.mat(a) : a, isMat(b) || isRng(b) ? ctx.mat(b) : b], (x) => arith(node.op, x[0], x[1]))
          if (node.op === '+' || node.op === '-') {
            // 날짜 칸이 섞인 열은 결과도 날짜 서식(관찰: 숫자 + 날짜 칸 = 날짜)
            const cols = out[0].length
            const colHints = (g, i) => { if (!isRng(g)) return null; const w = g.c2 - g.c1 + 1; return w === cols ? ctx.rawHintAt(g.sheet, g.c1 + i, g.r1) : w === 1 ? ctx.rawHintAt(g.sheet, g.c1, g.r1) : null }
            const hs = []
            for (let i = 0; i < cols; i++) hs.push(colHints(a, i) || (node.op === '+' ? colHints(b, i) : null))
            if (hs.some(Boolean)) out.colHints = hs
          }
          return out
        }
        return arith(node.op, ctx.sc(a), ctx.sc(b))
      }
      case 'fn': return callFn(node, ctx)
      case 'call': {
        const f = ev(node.fn, ctx)
        if (isErr(f)) return f
        if (!isLambda(f)) return eValue('Only lambda values can be called.')
        return callLambda(f, node.args.map((x) => ev(x, ctx)), ctx)
      }
      default: return eParse()
    }
  }

  function callFn(node, ctx) {
    const spec = FUNCS.get(node.name)
    if (!spec) {
      if (ctx.scope && node.name in ctx.scope && isLambda(ctx.scope[node.name])) return callLambda(ctx.scope[node.name], node.args.map((x) => ev(x, ctx)), ctx)
      return eName(node.orig)
    }
    const n = node.args.length
    if (n < spec.min || n > spec.max) {
      const exp = spec.min === spec.max ? `${spec.min} arguments` : spec.max === Infinity ? `at least ${spec.min} arguments` : `between ${spec.min} and ${spec.max} arguments`
      return eNA(`Wrong number of arguments to ${spec.name}. Expected ${exp}, but got ${n} arguments.`)
    }
    try {
      if (spec.vol) ctx.vol = true
      if (spec.lazy) return spec.fn(node.args, ctx, node)
      const savedArr = ctx.arr
      if (spec.arrArgs) ctx.arr = true
      let args
      try { args = spec.refs ? node.args.map((x) => (x.k === 'ref' ? refNodeToRng(x, ctx) : ev(x, ctx))) : node.args.map((x) => ev(x, ctx)) } finally { ctx.arr = savedArr }
      if (!spec.raw) for (const a of args) if (a instanceof GErr) return a
      if (spec.liftArgs && ctx.arr) {
        const L = spec.liftArgs
        if (L.some((i) => args[i] !== undefined && (isMat(args[i]) || (isRng(args[i]) && (args[i].r2 > args[i].r1 || args[i].c2 > args[i].c1))))) {
          const lifted = L.filter((i) => i < args.length)
          return broadcast(lifted.map((i) => (isRng(args[i]) ? ctx.mat(args[i]) : isMat(args[i]) ? args[i] : [[args[i]]])), (xs) => {
            const a2 = [...args]
            lifted.forEach((i, k) => { a2[i] = xs[k] })
            for (const x of xs) if (x instanceof GErr) return x
            try { const v = spec.fn(a2, ctx); return v === undefined ? null : (isMat(v) || isRng(v) ? ctx.sc(v) : v) } catch (e) { if (e instanceof GErr) return e; throw e }
          })
        }
      }
      if (spec.ew) {
        if (args.some((a) => needsArr(a, ctx))) {
          return broadcast(args.map((a) => (isRng(a) ? ctx.mat(a) : a)), (xs) => {
            if (!spec.raw) for (const x of xs) if (x instanceof GErr) return x
            try { const v = spec.fn(xs, ctx); return v === undefined ? null : v } catch (e) { if (e instanceof GErr) return e; throw e }
          })
        }
        args = args.map((a) => ctx.sc(a))
        if (!spec.raw) for (const a of args) if (a instanceof GErr) return a
      }
      const v = spec.fn(args, ctx)
      return v === undefined ? null : v
    } catch (e) {
      if (e instanceof GErr) return e
      throw e
    }
  }

  // ── 공개 API ─────────────────────────────────────────────
  const parseRefArg = (sheetId, ref) => {
    if (typeof ref === 'string') {
      const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim())
      if (!m) return null
      let c = 0
      for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64
      return { c: c - 1, r: Number(m[2]) }
    }
    return ref && typeof ref.c === 'number' ? ref : null
  }
  const flush = () => {
    let guard = 0
    while (pendingSpillers.size && guard++ < 6) {
      const keys = [...pendingSpillers]
      pendingSpillers.clear()
      const touched = []
      for (const k of keys) {
        const { idx, c, r } = decode(k)
        const raw = getRaw(idx, c, r)
        if (!isFormulaRaw(raw)) { spillerSet.delete(k); continue }
        const e = evalFormulaCell(idx, c, r, k, raw)
        if (e.spillKeys) touched.push(...e.spillKeys)
      }
      cascade(touched.filter((k) => !cache.has(k)).length ? touched : [])
    }
  }

  function cellInfo(sheetId, ref) {
    const p = parseRefArg(sheetId, ref)
    if (!p) return { value: null, error: { code: '#REF!', message: 'Invalid cell reference.' }, display: '#REF!' }
    const idx = idxOf(sheetId === undefined ? defaultSheet : sheetId)
    flush()
    const raw = getRaw(idx, p.c, p.r)
    const key = keyOf(idx, p.c, p.r)
    let entry = null
    if (isFormulaRaw(raw)) entry = evalFormulaCell(idx, p.c, p.r, key, raw)
    const v = entry ? entry.v : readCell(idx, p.c, p.r)
    const out = { value: v == null ? null : v, display: '', format: entry ? entry.hint : null }
    if (isErr(v)) { out.value = v.code; out.error = { code: v.code, message: v.message, summary_ko: summaryKo(v.code) } }
    if (entry && entry.m) out.spill = { rows: entry.rows, cols: entry.cols, values: entry.m.map((row) => row.map(plain)) }
    if (entry && entry.blocked) out.spillBlocked = true
    const sp = !entry && (raw === '' || raw == null) ? spillAt.get(key) : null
    if (sp) { const o = decode(sp.owner); out.spillOwner = { sheetId: sheetIds[o.idx], ref: a1(o.c, o.r), c: o.c, r: o.r } }
    if (sp && sp.owner !== undefined) { const oe = cache.get(sp.owner); if (oe && oe.colHints) out.format = oe.colHints[sp.j] || null }
    out.display = displayValue(v, out.format, raw, entry)
    return out
  }
  const plain = (v) => (isErr(v) ? v.code : v == null ? null : v)

  function displayValue(v, hint, raw, entry) {
    if (isErr(v)) return v.code
    if (v == null) return ''
    if (typeof v === 'string') return /[\ud800-\udfff]/.test(v) ? v.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '?') : v
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
    if (typeof v === 'number') {
      if (hint && typeof hint === 'object') return formatValue(v, hint.fmt)
      if (hint && Number.isFinite(v)) {
        const iso = dateStyle === 'iso'
        if (hint === 'isodate' || (hint === 'date' && iso)) return fmtDate(v)
        if (hint === 'isodatetime' || (hint === 'datetime' && iso)) return fmtDateTime(v)
        if (hint === 'isotime') return fmtTime(v)
        if (hint === 'date') return fmtDateKo(v)
        if (hint === 'datetime') return `${fmtDateKo(v)} ${fmtTimeKo(v)}`
        if (hint === 'time') return fmtTimeKo(v)
        if (hint === 'percent') return `${Math.round(v * 100)}%`
        if (hint === 'dollar') return `$${v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
      }
      return fmtNum(v)
    }
    return String(v)
  }

  /** 레거시 화면 표시 함수: (c, r) -> 문자열 */
  function displayAt(c, r, sheetId) {
    const idx = idxOf(sheetId === undefined ? defaultSheet : sheetId)
    const raw = getRaw(idx, c, r)
    if (raw == null) return ''
    if (!isFormulaRaw(raw)) {
      if (raw === '') {
        if (!spillersReady) ensureSpillers()
        const sp = spillAt.get(keyOf(idx, c, r))
        if (sp) {
          const oe = cache.get(sp.owner)
          if (oe && oe.m) return displayValue(oe.m[sp.i][sp.j], oe.colHints ? oe.colHints[sp.j] : null, '', oe)
        }
        return ''
      }
      return raw
    }
    const key = keyOf(idx, c, r)
    const e = evalFormulaCell(idx, c, r, key, raw)
    // 칸 하나만 가리키는 수식은 원본 칸의 표시 문자열을 그대로 따른다(날짜 글자 보존)
    if (e.ast && e.ast.k === 'ref' && !isErr(e.v)) {
      const sidx = e.ast.sheet != null ? (resolveSheetName(e.ast.sheet).ok ? idxOf(resolveSheetName(e.ast.sheet).id) : idx) : idx
      const rr = getRaw(sidx, e.ast.c, e.ast.r)
      if (typeof rr === 'string' && !isFormulaRaw(rr) && rr !== '' && typeof e.v !== 'string') return rr
    }
    return displayValue(e.v, e.hint, raw, e)
  }

  const engineApi = {
    evaluateCell: (sheetId, ref) => cellInfo(sheetId, ref),
    display: displayAt,
    /** 이 칸이 펼치는 영역의 모든 칸 [{c,r}] (원점 포함). 펼침이 없으면 [] */
    spillCells(sheetId, ref) {
      const info = cellInfo(sheetId, ref)
      if (!info.spill) return []
      const p = parseRefArg(sheetId, ref)
      const out = []
      for (let i = 0; i < info.spill.rows; i++) for (let j = 0; j < info.spill.cols; j++) out.push({ c: p.c + j, r: p.r + i })
      return out
    },
    /** 이 칸의 값이 어느 칸의 펼침에서 왔는지 */
    spillOwner(sheetId, ref) { const i = cellInfo(sheetId, ref); return i.spillOwner || null },
    /** 칸(들)이 바뀌었음을 알린다. ref는 'A1' | {c,r} | 'A1:B3' | [..]. 원본은 getRaw로 다시 읽는다. */
    invalidate(sheetId, ref) {
      const idx = idxOf(sheetId === undefined ? defaultSheet : sheetId)
      boundsCache.clear()
      const refs = Array.isArray(ref) ? ref : [ref]
      const ks = []
      for (const x of refs) {
        if (typeof x === 'string' && x.includes(':')) {
          const [s, e] = x.split(':').map((t) => parseRefArg(sheetId, t))
          if (s && e) for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r); r++) for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++) ks.push(keyOf(idx, c, r))
        } else {
          const p = parseRefArg(sheetId, x)
          if (p) {
            const k = keyOf(idx, p.c, p.r)
            ks.push(k)
            // 수식 칸이 추가/삭제될 때 펼침 후보 목록을 갱신
            const raw = getRaw(idx, p.c, p.r)
            if (isFormulaRaw(raw)) { const pc = parseCached(raw.slice(1)); if (pc.ast && mayArray(pc.ast)) { spillerSet.add(k); pendingSpillers.add(k) } else spillerSet.delete(k) } else spillerSet.delete(k)
          }
        }
      }
      ks.push(...volatileKeys)
      cascade(ks)
      // 펼침 소유자가 바뀌었을 수 있으므로 다시 훑게 한다
      spillersReady = false
      for (const k of spillerSet) if (!cache.has(k)) pendingSpillers.add(k)
      flush()
      spillersReady = false
      ensureSpillers()
    },
    /** 모든 계산 결과를 버린다 (호스트 데이터를 통째로 바꿨을 때) */
    refresh() {
      cache.clear(); dependents.clear(); rangeDepsOf.clear(); rangeIndex.clear(); wideRange.clear(); spillAt.clear(); spillerSet.clear()
      pendingSpillers.clear(); volatileKeys.clear(); boundsCache.clear(); matMemo.clear(); spillersScanned = false; spillersReady = false
    },
    /** 휘발성 함수(TODAY NOW RAND RANDBETWEEN)가 쓰인 칸만 다시 계산하게 한다 */
    recalcVolatile() { cascade([...volatileKeys]); spillersReady = false },
    stats: () => ({ ...stats, cached: cache.size, spillers: spillerSet.size }),
    _readCell: readCell,
    _bounds: bounds,
  }
  return engineApi
}

export { fmtNum as _fmtNum, colName, refText, serialFromDate, numToStr, B, eDiv0 }
