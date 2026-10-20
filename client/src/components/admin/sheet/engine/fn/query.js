// QUERY 함수: Google Visualization API Query Language 부분 구현
// 근거: https://developers.google.com/chart/interactive/docs/querylanguage , https://support.google.com/docs/answer/3093343
// 지원: select where group by pivot order by limit offset label (format은 해석만 하고 값에는 적용하지 않음)
import { def } from '../registry.js'
import { GErr, eValue, eNA } from '../errors.js'
import { isRng, isMat, N, S, B, compare } from '../coerce.js'
import { colIndexOf } from '../parser.js'
import { partsFromSerial, serialFromDate, parseDateText, parseTimeText } from '../dates.js'

const KW = new Set(['select', 'where', 'group', 'pivot', 'order', 'by', 'limit', 'offset', 'label', 'format', 'options', 'asc', 'desc', 'and', 'or', 'not', 'is', 'null', 'contains', 'starts', 'ends', 'with', 'matches', 'like', 'true', 'false', 'date', 'datetime', 'timeofday', 'as'])
const AGGS = new Set(['sum', 'avg', 'count', 'min', 'max'])
const perr = (msg) => eValue(`Unable to parse query string for Function QUERY parameter 2: PARSE_ERROR: ${msg}`)

function lex(q) {
  const t = []
  let i = 0
  while (i < q.length) {
    const ch = q[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === "'" || ch === '"') {
      let j = i + 1; let s = ''
      while (j < q.length && q[j] !== ch) { if (q[j] === '\\' && j + 1 < q.length) j++; s += q[j++] }
      if (j >= q.length) throw perr('unterminated string literal')
      t.push({ t: 'str', v: s }); i = j + 1; continue
    }
    if (ch === '`') {
      const j = q.indexOf('`', i + 1); if (j < 0) throw perr('unterminated identifier')
      t.push({ t: 'qid', v: q.slice(i + 1, j) }); i = j + 1; continue
    }
    let m
    if ((m = /^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/.exec(q.slice(i)))) { t.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(q.slice(i)))) { t.push({ t: 'id', v: m[0], l: m[0].toLowerCase() }); i += m[0].length; continue }
    const two = q.slice(i, i + 2)
    if (['<=', '>=', '!=', '<>'].includes(two)) { t.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; continue }
    if ('=<>+-*/(),'.includes(ch)) { t.push({ t: 'op', v: ch }); i++; continue }
    throw perr(`unexpected character '${ch}'`)
  }
  return t
}

function parseQuery(q, ncols, headers) {
  const tk = lex(q)
  let p = 0
  const pk = () => tk[p]
  const isKw = (w) => tk[p] && tk[p].t === 'id' && tk[p].l === w
  const eatKw = (w) => { if (isKw(w)) { p++; return true } return false }
  const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v
  const eatOp = (v) => { if (isOp(v)) { p++; return true } return false }
  const needOp = (v) => { if (!eatOp(v)) throw perr(`expected '${v}'`) }

  function colRef(tok) {
    if (tok.t === 'qid') {
      const hl = headers.findIndex((h) => String(h).toLowerCase() === tok.v.toLowerCase())
      if (hl >= 0) return hl
      if (/^[A-Za-z]{1,3}$/.test(tok.v)) return checkCol(colIndexOf(tok.v))
      throw eValue(`Unable to parse query string for Function QUERY parameter 2: INVALID_COLUMN: ${tok.v}`)
    }
    const m = /^col(\d+)$/i.exec(tok.v)
    if (m) return checkCol(Number(m[1]) - 1)
    return checkCol(colIndexOf(tok.v))
  }
  function checkCol(i) {
    if (i < 0 || i >= ncols) throw eValue('Unable to parse query string for Function QUERY parameter 2: INVALID_COLUMN')
    return i
  }
  function primary() {
    const x = pk()
    if (!x) throw perr('unexpected end of query')
    if (x.t === 'num') { p++; return { t: 'lit', v: x.v } }
    if (x.t === 'str') { p++; return { t: 'lit', v: x.v } }
    if (x.t === 'qid') { p++; return { t: 'col', i: colRef(x) } }
    if (x.t === 'op' && x.v === '(') { p++; const e = orExpr(); needOp(')'); return e }
    if (x.t === 'op' && x.v === '-') { p++; return { t: 'neg', a: primary() } }
    if (x.t === 'op' && x.v === '*') throw perr('unexpected *')
    if (x.t === 'id') {
      if (x.l === 'true' || x.l === 'false') { p++; return { t: 'lit', v: x.l === 'true' } }
      if ((x.l === 'date' || x.l === 'datetime' || x.l === 'timeofday') && tk[p + 1] && tk[p + 1].t === 'str') {
        const s = tk[p + 1].v; p += 2
        if (x.l === 'timeofday') { const v = parseTimeText(s); if (v == null) throw perr('bad timeofday'); return { t: 'lit', v } }
        const v = parseDateText(s); if (v == null) throw perr('bad date literal'); return { t: 'lit', v: x.l === 'date' ? Math.floor(v) : v }
      }
      if (tk[p + 1] && tk[p + 1].t === 'op' && tk[p + 1].v === '(') {
        p += 2
        if (AGGS.has(x.l)) {
          let arg
          if (isOp('*')) throw perr("'*' is not allowed in aggregate functions")
          arg = addExpr()
          needOp(')')
          return { t: 'agg', fn: x.l, arg }
        }
        const args = []
        if (!eatOp(')')) { do { args.push(addExpr()) } while (eatOp(',')); needOp(')') }
        return { t: 'fn', name: x.l, args }
      }
      if (KW.has(x.l) && x.l !== 'date') throw perr(`unexpected keyword '${x.v}'`)
      p++
      return { t: 'col', i: colRef(x) }
    }
    throw perr('unexpected token')
  }
  function mulExpr() {
    let a = primary()
    for (;;) {
      if (isOp('*')) { p++; a = { t: 'bin', op: '*', a, b: primary() } } else if (isOp('/')) { p++; a = { t: 'bin', op: '/', a, b: primary() } } else return a
    }
  }
  function addExpr() {
    let a = mulExpr()
    for (;;) {
      if (isOp('+')) { p++; a = { t: 'bin', op: '+', a, b: mulExpr() } } else if (isOp('-')) { p++; a = { t: 'bin', op: '-', a, b: mulExpr() } } else return a
    }
  }
  function cmpExpr() {
    const a = addExpr()
    const x = pk()
    if (x && x.t === 'op' && ['=', '!=', '<', '>', '<=', '>='].includes(x.v)) { p++; return { t: 'cmp', op: x.v, a, b: addExpr() } }
    if (eatKw('is')) { const neg = eatKw('not'); if (!eatKw('null')) throw perr("expected 'null'"); return { t: 'isnull', a, neg } }
    if (eatKw('contains')) return { t: 'str', op: 'contains', a, b: addExpr() }
    if (isKw('starts')) { p++; if (!eatKw('with')) throw perr("expected 'with'"); return { t: 'str', op: 'starts', a, b: addExpr() } }
    if (isKw('ends')) { p++; if (!eatKw('with')) throw perr("expected 'with'"); return { t: 'str', op: 'ends', a, b: addExpr() } }
    if (eatKw('matches')) return { t: 'str', op: 'matches', a, b: addExpr() }
    if (eatKw('like')) return { t: 'str', op: 'like', a, b: addExpr() }
    return a
  }
  function notExpr() { if (eatKw('not')) return { t: 'not', a: notExpr() }; return cmpExpr() }
  function andExpr() { let a = notExpr(); while (eatKw('and')) a = { t: 'and', a, b: notExpr() }; return a }
  function orExpr() { let a = andExpr(); while (eatKw('or')) a = { t: 'or', a, b: andExpr() }; return a }

  const out = { select: null, where: null, group: [], pivot: [], order: [], limit: null, offset: 0, label: {}, format: {} }
  if (eatKw('select')) {
    if (eatOp('*')) out.select = '*'
    else { out.select = []; do { out.select.push(addExpr()) } while (eatOp(',')) }
  }
  if (eatKw('where')) out.where = orExpr()
  if (eatKw('group')) { if (!eatKw('by')) throw perr("expected 'by'"); do { out.group.push(addExpr()) } while (eatOp(',')) }
  if (eatKw('pivot')) { do { out.pivot.push(addExpr()) } while (eatOp(',')) }
  if (eatKw('order')) {
    if (!eatKw('by')) throw perr("expected 'by'")
    do { const e = addExpr(); const desc = eatKw('desc'); if (!desc) eatKw('asc'); out.order.push({ e, desc }) } while (eatOp(','))
  }
  if (eatKw('limit')) { const x = tk[p++]; if (!x || x.t !== 'num') throw perr('limit needs a number'); out.limit = x.v }
  if (eatKw('offset')) { const x = tk[p++]; if (!x || x.t !== 'num') throw perr('offset needs a number'); out.offset = x.v }
  if (eatKw('label')) { do { const e = addExpr(); const s = tk[p++]; if (!s || s.t !== 'str') throw perr('label needs a string'); out.label[keyOfExpr(e)] = s.v } while (eatOp(',')) }
  if (eatKw('format')) { do { const e = addExpr(); const s = tk[p++]; if (!s || s.t !== 'str') throw perr('format needs a string'); out.format[keyOfExpr(e)] = s.v } while (eatOp(',')) }
  if (eatKw('options')) { while (p < tk.length) p++ }
  if (p < tk.length) throw perr(`unexpected '${tk[p].v}'`)
  return out
}
const keyOfExpr = (e) => JSON.stringify(e)

const hasAgg = (e) => !!e && (e.t === 'agg' || (e.a && hasAgg(e.a)) || (e.b && hasAgg(e.b)) || (e.args && e.args.some(hasAgg)))

function evalExpr(e, row, grp) {
  switch (e.t) {
    case 'lit': return e.v
    case 'col': return row ? row[e.i] : null
    case 'neg': { const v = evalExpr(e.a, row, grp); return v == null ? null : -v }
    case 'bin': {
      const a = evalExpr(e.a, row, grp), b = evalExpr(e.b, row, grp)
      if (a == null || b == null) return null
      if (e.op === '+' && (typeof a === 'string' || typeof b === 'string')) throw eValue('Unable to parse query: cannot add strings.')
      if (typeof a !== 'number' || typeof b !== 'number') throw eValue('Unable to parse query: arithmetic on non-numbers.')
      switch (e.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; default: if (b === 0) throw new GErr('#DIV/0!'); return a / b }
    }
    case 'agg': return aggregate(e, grp)
    case 'fn': return scalarFn(e.name, e.args.map((x) => evalExpr(x, row, grp)))
    default: return evalBool(e, row, grp)
  }
}
function aggregate(e, grp) {
  if (e.arg.t === 'star') return e.fn === 'count' ? grp.length : null
  const vals = grp.map((r) => evalExpr(e.arg, r, null)).filter((v) => v != null)
  switch (e.fn) {
    case 'count': return vals.length
    case 'sum': { const n = vals.filter((v) => typeof v === 'number'); return n.length ? n.reduce((a, b) => a + b, 0) : null }
    case 'avg': { const n = vals.filter((v) => typeof v === 'number'); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null }
    case 'min': return vals.length ? vals.reduce((a, b) => (cmpNull(b, a) < 0 ? b : a)) : null
    default: return vals.length ? vals.reduce((a, b) => (cmpNull(b, a) > 0 ? b : a)) : null
  }
}
function scalarFn(name, a) {
  const v = a[0]
  switch (name) {
    case 'upper': return v == null ? null : String(v).toUpperCase()
    case 'lower': return v == null ? null : String(v).toLowerCase()
    case 'year': return v == null ? null : partsFromSerial(Math.floor(v)).y
    case 'month': return v == null ? null : partsFromSerial(Math.floor(v)).m - 1 // QL의 month는 0부터
    case 'day': return v == null ? null : partsFromSerial(Math.floor(v)).d
    case 'dayofweek': return v == null ? null : partsFromSerial(Math.floor(v)).dow + 1
    case 'quarter': return v == null ? null : Math.floor((partsFromSerial(Math.floor(v)).m - 1) / 3) + 1
    case 'hour': return v == null ? null : Math.floor((v - Math.floor(v)) * 24 + 1e-9)
    case 'minute': return v == null ? null : Math.floor(((v - Math.floor(v)) * 1440 + 1e-9) % 60)
    case 'second': return v == null ? null : Math.floor(((v - Math.floor(v)) * 86400 + 1e-9) % 60)
    case 'now': return serialFromDate(new Date())
    case 'todate': return v == null ? null : Math.floor(v)
    case 'datediff': return a[0] == null || a[1] == null ? null : Math.floor(a[0]) - Math.floor(a[1])
    default: throw eValue(`Unable to parse query string for Function QUERY parameter 2: unknown function '${name}'`)
  }
}
const cmpNull = (a, b) => { if (a == null || b == null) return a == null && b == null ? 0 : a == null ? -1 : 1; return compare(a, b) }
function evalBool(e, row, grp) {
  switch (e.t) {
    case 'and': return evalBool(e.a, row, grp) && evalBool(e.b, row, grp)
    case 'or': return evalBool(e.a, row, grp) || evalBool(e.b, row, grp)
    case 'not': return !evalBool(e.a, row, grp)
    case 'isnull': { const v = evalExpr(e.a, row, grp); return e.neg ? v != null : v == null }
    case 'cmp': {
      const a = evalExpr(e.a, row, grp), b = evalExpr(e.b, row, grp)
      if (a == null || b == null) return e.op === '!=' // null 은 != 에서 같지 않은 값으로 취급(관찰)
      if (typeof a !== typeof b) return e.op === '!='
      const c = typeof a === 'string' ? (a < b ? -1 : a > b ? 1 : 0) : compare(a, b)
      return { '=': c === 0, '!=': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[e.op]
    }
    case 'str': {
      const a = evalExpr(e.a, row, grp), b = evalExpr(e.b, row, grp)
      if (a == null || b == null) return false
      const x = String(a), y = String(b)
      switch (e.op) {
        case 'contains': return x.includes(y)
        case 'starts': return x.startsWith(y)
        case 'ends': return x.endsWith(y)
        case 'matches': return new RegExp(`^(?:${y})$`, 'u').test(x)
        default: return new RegExp(`^${y.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 's').test(x)
      }
    }
    default: {
      const v = evalExpr(e, row, grp)
      if (typeof v !== 'boolean') throw perr('boolean expression expected')
      return v
    }
  }
}

/** 열마다 가장 많은 종류만 남기고 나머지는 빈 값으로 본다(QUERY의 열 형식 규칙) */
function normalizeColumns(rows, ncols) {
  for (let j = 0; j < ncols; j++) {
    const cnt = { number: 0, string: 0, boolean: 0 }
    for (const r of rows) { const v = r[j]; if (v != null && !(v instanceof GErr)) cnt[typeof v]++ }
    let best = 'number', bc = -1
    for (const k of ['number', 'string', 'boolean']) if (cnt[k] > bc) { best = k; bc = cnt[k] }
    for (const r of rows) { const v = r[j]; if (v instanceof GErr) r[j] = null; else if (v != null && typeof v !== best) r[j] = null }
  }
}
function exprLabel(e, headers) {
  switch (e.t) {
    case 'col': return String(headers[e.i] ?? '')
    case 'lit': return String(e.v)
    case 'agg': return `${e.fn} ${e.arg.t === 'star' ? '*' : exprLabel(e.arg, headers)}`
    case 'neg': return `-${exprLabel(e.a, headers)}`
    case 'bin': { // 관찰: C*2 -> "product(점수2())", sum(C)/count(C) -> " quotient(sum 점수count 점수)"
      const nm = { '*': 'product', '/': 'quotient', '+': 'sum', '-': 'difference' }[e.op]
      const part = (x) => (x.t === 'lit' ? `${x.v}()` : exprLabel(x, headers))
      return `${hasAgg(e) ? ' ' : ''}${nm}(${part(e.a)}${part(e.b)})`
    }
    case 'fn': return `${e.name === 'todate' ? 'toDate' : e.name}(${e.args.map((x) => exprLabel(x, headers)).join(',')})`
    default: return ''
  }
}
const colId = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }

export function runQuery(data, queryText, headersArg, srcHints = null) {
  if (!data.length) return []
  const ncols = data[0].length
  let hn = headersArg
  if (hn == null || hn < 0) {
    // 머리글 줄 수 추정: 첫 줄에 글자가 있고 같은 열 아래쪽이 숫자인 열이 하나라도 있으면 1
    hn = 0
    if (data.length > 1) {
      for (let j = 0; j < ncols; j++) {
        if (typeof data[0][j] === 'string' && data.slice(1).some((r) => typeof r[j] === 'number')) { hn = 1; break }
      }
    }
  }
  hn = Math.min(hn, data.length)
  const headerRows = data.slice(0, hn)
  const headers = Array.from({ length: ncols }, (_, j) => headerRows.map((r) => (r[j] == null ? '' : String(r[j]))).filter(Boolean).join(' '))
  const body = data.slice(hn).filter((r) => r.some((v) => v != null)).map((r) => [...r]) // 완전히 빈 행은 버린다
  normalizeColumns(body, ncols)
  const q = parseQuery(String(queryText), ncols, headers)
  let rows = body
  if (q.where) rows = rows.filter((r) => evalBool(q.where, r, null))
  let items = q.select === '*' || q.select == null ? Array.from({ length: ncols }, (_, i) => ({ t: 'col', i })) : q.select
  const aggregated = items.some(hasAgg) || q.group.length > 0 || q.pivot.length > 0
  let outRows, outLabels
  const labelOf = (e) => q.label[keyOfExpr(e)] ?? exprLabel(e, headers)
  if (!aggregated) {
    let work = rows
    if (q.order.length) {
      work = [...rows].sort((x, y) => { for (const o of q.order) { const r = cmpNull(evalExpr(o.e, x, null), evalExpr(o.e, y, null)); if (r) return o.desc ? -r : r } return 0 })
    }
    outRows = work.map((r) => items.map((e) => evalExpr(e, r, null)))
    outLabels = items.map(labelOf)
    if (q.limit != null || q.offset) outRows = outRows.slice(q.offset, q.limit != null ? q.offset + q.limit : undefined)
  } else {
    // 묶기
    const groupKey = (r) => q.group.map((g) => { const v = evalExpr(g, r, null); return v == null ? '\u0000' : `${typeof v}:${v}` }).join('\u0001')
    const groups = new Map()
    for (const r of rows) { const k = groupKey(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) }
    if (!q.group.length && !groups.size) groups.set('', [])
    let glist = [...groups.values()]
    if (q.group.length) glist.sort((x, y) => { for (const g of q.group) { const r = cmpNull(evalExpr(g, x[0], null), evalExpr(g, y[0], null)); if (r) return r } return 0 })
    const nonAggItems = items.filter((e) => !hasAgg(e))
    if (q.pivot.length) {
      const pvKey = (r) => q.pivot.map((g) => evalExpr(g, r, null))
      const pvals = []
      const seen = new Set()
      rows.forEach((r) => { const v = pvKey(r); const k = JSON.stringify(v); if (!seen.has(k)) { seen.add(k); pvals.push(v) } })
      pvals.sort((x, y) => { for (let i = 0; i < x.length; i++) { const r = cmpNull(x[i], y[i]); if (r) return r } return 0 })
      const aggItems = items.filter(hasAgg)
      outLabels = [...nonAggItems.map(labelOf)]
      const pvTxt = (pv) => pv.map((x, k) => { if (x == null) return ''; const pe = q.pivot[k]; if (typeof x === 'number' && pe && pe.t === 'col' && srcHints && /date/.test(srcHints[pe.i] || '')) { const d = partsFromSerial(Math.floor(x)); return `${d.y}-${d.m}-${d.d}` } return String(x) }).join(', ')
      for (const pv of pvals) for (const a of aggItems) outLabels.push(aggItems.length === 1 ? pvTxt(pv) : `${pvTxt(pv)} ${labelOf(a)}`)
      outRows = glist.map((g) => {
        const base = nonAggItems.map((e) => evalExpr(e, g[0], g))
        const cells = []
        for (const pv of pvals) {
          const sub = g.filter((r) => JSON.stringify(pvKey(r)) === JSON.stringify(pv))
          for (const a of aggItems) cells.push(sub.length ? evalExpr(a, sub[0], sub) : null)
        }
        return [...base, ...cells]
      })
    } else {
      outRows = glist.map((g) => items.map((e) => evalExpr(e, g[0] ?? null, g)))
      outLabels = items.map(labelOf)
      if (q.order.length) {
        const order = q.order
        const keyed = glist.map((g, i) => ({ g, row: outRows[i] }))
        keyed.sort((x, y) => { for (const o of order) { const r = cmpNull(evalExpr(o.e, x.g[0] ?? null, x.g), evalExpr(o.e, y.g[0] ?? null, y.g)); if (r) return o.desc ? -r : r } return 0 })
        outRows = keyed.map((k) => k.row)
      }
    }
    if (q.limit != null || q.offset) outRows = outRows.slice(q.offset, q.limit != null ? q.offset + q.limit : undefined)
  }
  if (!outRows.length && hn === 0) throw eNA('QUERY returned no rows.')
  const res = hn > 0 || q.select !== null ? (hn > 0 ? [outLabels, ...outRows] : outRows.length ? outRows : [outLabels.map(() => null)]) : outRows
  // 열별 표시 서식: 원본 날짜 칸은 그대로, toDate 는 기본 날짜 서식, format 절은 서식 문자열
  if (!q.pivot.length) {
    const hintFor = (e) => {
      const f = q.format[keyOfExpr(e)]
      if (f) return { fmt: f }
      if (e.t === 'col') return srcHints ? srcHints[e.i] ?? null : null
      if (e.t === 'fn' && e.name === 'todate') return 'date'
      return null
    }
    const hs = items.map(hintFor)
    if (hs.some(Boolean)) res.colHints = hs
  }
  return res
}

def('QUERY', 'query', 2, 3, 'QUERY(데이터, 쿼리, [머리글 줄 수])', 'Google 시각화 쿼리 언어(select where group by pivot order by limit offset label)로 표를 조회', (a, ctx) => {
  const data = ctx.mat(a[0])
  const hdr = a[2] == null ? null : Math.trunc(N(a[2]))
  const g = a[0]
  let hints = null
  if (isRng(g)) { hints = []; for (let j = 0; j <= Math.min(g.c2, g.c1 + 60) - g.c1; j++) { let h = null; for (let r = g.r1 + 1; r <= Math.min(g.r2, g.r1 + 60) && !h; r++) h = ctx.rawHintAt(g.sheet, g.c1 + j, r); hints.push(h) } }
  return runQuery(data, S(ctx.sc(a[1])), hdr, hints)
}, { arr: true, refs: true })
