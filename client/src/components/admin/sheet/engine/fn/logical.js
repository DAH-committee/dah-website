// 논리·정보 함수. 근거: https://support.google.com/docs/table/25273 (Logical / Info 범주)
import { def } from '../registry.js'
import { GErr, isErr, eValue, eNA, eNum, ERROR_TYPE_NUM } from '../errors.js'
import { Rng, isRng, isMat, isLambda, N, S, B, compare, valuesEqual, topLeft, parseNumberText } from '../coerce.js'
import { parseDateText } from '../dates.js'
import { flat } from './util.js'

const L = 'logical', INF = 'info'
const needsArr = (v, ctx) => isMat(v) || (ctx.arr && isRng(v))
const matOr = (v, ctx) => (isRng(v) || isMat(v) ? ctx.mat(v) : [[v]])
const bcast = (vals, f) => {
  const ms = vals
  const rows = Math.max(...ms.map((m) => m.length)), cols = Math.max(...ms.map((m) => m[0].length))
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => {
    const args = []
    for (const m of ms) { const rr = m.length === 1 ? 0 : i, cc = m[0].length === 1 ? 0 : j; if (rr >= m.length || cc >= m[0].length) return eNA('Array arguments have mismatched sizes.'); args.push(m[rr][cc]) }
    return f(args)
  }))
}

def('IF', L, 2, 3, 'IF(조건, 참일 때, [거짓일 때])', '조건에 따라 값을 고름', (args, ctx) => {
  const cond = ctx.ev(args[0])
  if (isErr(cond)) return cond
  if (needsArr(cond, ctx)) {
    const t = ctx.ev(args[1]), f = args[2] ? ctx.ev(args[2]) : false
    return bcast([ctx.mat(cond), matOr(t, ctx), matOr(f, ctx)], ([c, x, y]) => { if (c instanceof GErr) return c; try { return B(c) ? x : y } catch (e) { if (e instanceof GErr) return e; throw e } })
  }
  const c = B(ctx.sc(cond))
  if (c) return args[1].k === 'empty' ? null : ctx.ev(args[1])
  return args[2] ? (args[2].k === 'empty' ? null : ctx.ev(args[2])) : false
}, { lazy: true, pass: true })
def('IFS', L, 2, Infinity, 'IFS(조건1, 값1, [조건2, 값2, ...])', '처음으로 참인 조건의 값', (args, ctx) => {
  if (args.length % 2) throw eNA('Wrong number of arguments to IFS. Expected an even number of arguments.')
  for (let i = 0; i < args.length; i += 2) {
    const c = ctx.sc(ctx.ev(args[i]))
    if (isErr(c)) return c
    if (B(c)) return ctx.ev(args[i + 1])
  }
  throw eNA('No matches found in IFS evaluation.')
}, { lazy: true, pass: true })
def('SWITCH', L, 3, Infinity, 'SWITCH(식, 값1, 결과1, ..., [기본값])', '값이 일치하는 결과를 고름', (args, ctx) => {
  const x = ctx.sc(ctx.ev(args[0]))
  if (isErr(x)) return x
  let i = 1
  for (; i + 1 < args.length; i += 2) {
    const c = ctx.sc(ctx.ev(args[i]))
    if (isErr(c)) return c
    if (valuesEqual(x, c)) return ctx.ev(args[i + 1])
  }
  if (i < args.length) return ctx.ev(args[i])
  throw eNA(`No matches found in SWITCH evaluation.`)
}, { lazy: true, pass: true })
const errFallback = (name, only) => (args, ctx) => {
  const v = ctx.ev(args[0])
  const pick = (x) => (x instanceof GErr && (!only || x.code === only))
  if (isMat(v) || (ctx.arr && isRng(v))) {
    const m = ctx.mat(v)
    if (!m.flat().some(pick)) return m
    const fb = args[1] ? ctx.ev(args[1]) : ''
    return bcast([m, matOr(fb, ctx)], ([x, f]) => (pick(x) ? f : x))
  }
  const s = ctx.sc(v)
  if (pick(s)) return args[1] ? ctx.ev(args[1]) : ''
  return v
}
def('IFERROR', L, 1, 2, 'IFERROR(값, [오류일 때 값])', '오류이면 대체 값(기본 빈 문자열)', errFallback('IFERROR'), { lazy: true, pass: true })
def('IFNA', L, 2, 2, 'IFNA(값, #N/A일 때 값)', '#N/A이면 대체 값', errFallback('IFNA', '#N/A'), { lazy: true, pass: true })
const boolArgs = (a, ctx, name) => {
  const out = []
  for (const x of a) {
    if (isRng(x) || isMat(x)) { for (const row of ctx.mat(x)) for (const v of row) { if (v instanceof GErr) throw v; if (typeof v === 'boolean') out.push(v); else if (typeof v === 'number') out.push(v !== 0) } }
    else if (x instanceof GErr) throw x
    else out.push(B(x))
  }
  if (!out.length) throw eValue(`${name} requires at least one logical value.`)
  return out
}
def('AND', L, 1, Infinity, 'AND(논리1, [논리2, ...])', '모두 참이면 TRUE', (a, ctx) => boolArgs(a, ctx, 'AND').every(Boolean), { refs: true, arrArgs: false })
def('OR', L, 1, Infinity, 'OR(논리1, [논리2, ...])', '하나라도 참이면 TRUE', (a, ctx) => boolArgs(a, ctx, 'OR').some(Boolean), { refs: true })
def('XOR', L, 1, Infinity, 'XOR(논리1, [논리2, ...])', '참이 홀수 개이면 TRUE', (a, ctx) => boolArgs(a, ctx, 'XOR').filter(Boolean).length % 2 === 1, { refs: true })
def('NOT', L, 1, 1, 'NOT(논리)', '참/거짓을 뒤집음', (a) => !B(a[0]), { ew: true })
def('TRUE', L, 0, 0, 'TRUE()', '논리값 TRUE', () => true)
def('FALSE', L, 0, 0, 'FALSE()', '논리값 FALSE', () => false)

def('ISBLANK', INF, 1, 1, 'ISBLANK(값)', '빈 칸이면 TRUE', (a) => a[0] == null, { ew: true, raw: true })
def('ISNUMBER', INF, 1, 1, 'ISNUMBER(값)', '숫자이면 TRUE', (a) => typeof a[0] === 'number', { ew: true, raw: true })
def('ISTEXT', INF, 1, 1, 'ISTEXT(값)', '텍스트이면 TRUE', (a) => typeof a[0] === 'string', { ew: true, raw: true })
def('ISNONTEXT', INF, 1, 1, 'ISNONTEXT(값)', '텍스트가 아니면 TRUE', (a) => typeof a[0] !== 'string', { ew: true, raw: true })
def('ISLOGICAL', INF, 1, 1, 'ISLOGICAL(값)', '불리언이면 TRUE', (a) => typeof a[0] === 'boolean', { ew: true, raw: true })
def('ISERROR', INF, 1, 1, 'ISERROR(값)', '오류이면 TRUE', (a) => a[0] instanceof GErr, { ew: true, raw: true })
def('ISERR', INF, 1, 1, 'ISERR(값)', '#N/A를 제외한 오류이면 TRUE', (a) => a[0] instanceof GErr && a[0].code !== '#N/A', { ew: true, raw: true })
def('ISNA', INF, 1, 1, 'ISNA(값)', '#N/A이면 TRUE', (a) => a[0] instanceof GErr && a[0].code === '#N/A', { ew: true, raw: true })
def('ISDATE', INF, 1, 1, 'ISDATE(값)', '날짜로 읽히면 TRUE', (args, ctx) => {
  const v = ctx.sc(ctx.ev(args[0]))
  if (typeof v === 'string') return parseDateText(v) != null
  if (typeof v === 'number') { const h = ctx.hint(args[0]); return /date/.test(h || '') }
  return false
}, { lazy: true })
def('ISREF', INF, 1, 1, 'ISREF(값)', '참조이면 TRUE', (args, ctx) => { const v = ctx.evalRef(args[0]); return isRng(v) }, { lazy: true })
def('ISEMAIL', INF, 1, 1, 'ISEMAIL(값)', '이메일 형식이면 TRUE', (a) => typeof a[0] === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a[0]), { ew: true })
def('ISURL', INF, 1, 1, 'ISURL(값)', 'URL 형식이면 TRUE', (a) => typeof a[0] === 'string' && /^(https?|ftp):\/\/[^\s/$.?#][^\s]*$/i.test(a[0]), { ew: true })
def('ISFORMULA', INF, 1, 1, 'ISFORMULA(참조)', '수식이 들어 있는 칸이면 TRUE', (args, ctx) => {
  const g = ctx.evalRef(args[0])
  if (!isRng(g)) throw eValue('ISFORMULA needs a reference.')
  const raw = ctx.rawOf(g.sheet, g.c1, g.r1)
  return typeof raw === 'string' && raw.length > 1 && raw[0] === '='
}, { lazy: true })
def('FORMULATEXT', INF, 1, 1, 'FORMULATEXT(참조)', '칸의 수식 원문', (args, ctx) => {
  const g = ctx.evalRef(args[0])
  if (!isRng(g)) throw eNA('FORMULATEXT needs a reference.')
  const raw = ctx.rawOf(g.sheet, g.c1, g.r1)
  if (typeof raw === 'string' && raw.length > 1 && raw[0] === '=') return raw
  throw eNA('The cell has no formula.')
}, { lazy: true })
def('N', INF, 1, 1, 'N(값)', '숫자로 변환(텍스트는 0)', (a) => (typeof a[0] === 'number' ? a[0] : typeof a[0] === 'boolean' ? (a[0] ? 1 : 0) : 0), { ew: true })
def('T', INF, 1, 1, 'T(값)', '텍스트이면 그대로, 아니면 빈 문자열', (a) => (typeof a[0] === 'string' ? a[0] : ''), { ew: true })
def('TYPE', INF, 1, 1, 'TYPE(값)', '값 종류 코드(1 숫자, 2 텍스트, 4 불리언, 16 오류, 64 배열)', (args, ctx) => {
  const v = ctx.ev(args[0])
  if (isMat(v) || (isRng(v) && (v.r2 > v.r1 || v.c2 > v.c1))) return 64
  const s = ctx.sc(v)
  if (s instanceof GErr) return 16
  return s == null || typeof s === 'number' ? 1 : typeof s === 'boolean' ? 4 : 2
}, { lazy: true })
def('ERROR.TYPE', INF, 1, 1, 'ERROR.TYPE(오류값)', '오류 종류 번호(#DIV/0!=2, #VALUE!=3, #REF!=4, #NAME?=5, #NUM!=6, #N/A=7)', (a) => {
  if (!(a[0] instanceof GErr)) throw eNA('ERROR.TYPE: value is not an error.')
  return ERROR_TYPE_NUM[a[0].code] ?? 8
}, { ew: true, raw: true })
def('NA', INF, 0, 0, 'NA()', '#N/A 오류를 만듦', () => { throw eNA('Function NA returned #N/A.') })
