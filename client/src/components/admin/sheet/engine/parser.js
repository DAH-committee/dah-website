// 수식 구문 분석. 구글 시트 구문: 범위(A1:B3, A:A, 1:3), 시트 참조(Sheet2!A1, '내 시트'!A1), 배열 상수 {1,2;3,4}, 오류 상수 #N/A
import { GErr, eParse } from './errors.js'

export function colIndexOf(letters) {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export function colName(c) {
  let s = ''
  let n = c + 1
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}
export const a1 = (c, r) => `${colName(c)}${r}`

const ID_START = 'A-Za-z_\\u3131-\\u318E\\uAC00-\\uD7A3\\u4E00-\\u9FFF'
const ID_PART = `${ID_START}0-9.`
const CELL = '\\$?[A-Za-z]{1,3}\\$?\\d+'
const RANGE_RES = [
  new RegExp(`^(${CELL}):(\\$?[A-Za-z]{1,3})(?![A-Za-z0-9_(.$])`), // A1:A (열 끝까지)
  new RegExp(`^(${CELL})(?::(${CELL}))?(?![A-Za-z0-9_(.])`),
  new RegExp('^(\\$?[A-Za-z]{1,3}):(\\$?[A-Za-z]{1,3})(?![A-Za-z0-9_(.])'),
  new RegExp('^(\\$?\\d+):(\\$?\\d+)(?![A-Za-z0-9_(.])'),
]
const SHEET_RES = [
  /^'((?:[^']|'')+)'!/,
  new RegExp(`^([${ID_START}][${ID_PART}]*)!`),
]
const NAME_RE = new RegExp(`^[${ID_START}][${ID_PART}]*`)
const ERR_RE = /^#(?:N\/A|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|NULL!|ERROR!)/
const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/

const cellParts = (s) => {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s)
  return { c: colIndexOf(m[1]), r: Number(m[2]) }
}

export function tokenize(src) {
  const out = []
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\u00a0') { i++; continue }
    if (ch === '"') {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= n) throw eParse('Unterminated string.')
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue } break }
        s += src[j++]
      }
      out.push({ t: 'str', v: s, pos: i })
      i = j + 1
      continue
    }
    const rest = src.slice(i, i + 80)
    if (ch === '#') {
      const m = ERR_RE.exec(rest)
      if (!m) throw eParse('Unknown error literal.')
      out.push({ t: 'err', v: m[0], pos: i }); i += m[0].length; continue
    }
    // 시트 접두
    let sheet = null
    let adv = 0
    if (ch === "'" || /[A-Za-z_\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF]/.test(ch)) {
      const full = ch === "'" ? src.slice(i) : rest
      for (const re of SHEET_RES) {
        const m = re.exec(full)
        if (m) { sheet = m[1].replace(/''/g, "'"); adv = m[0].length; break }
      }
    }
    const tail = adv ? src.slice(i + adv, i + adv + 80) : rest
    let matched = false
    if (sheet !== null || /[A-Za-z$\d]/.test(ch)) {
      for (let k = 0; k < RANGE_RES.length; k++) {
        const m = RANGE_RES[k].exec(tail)
        if (!m) continue
        let node
        if (k === 0) {
          const p1 = cellParts(m[1])
          node = { t: 'range', sheet, c1: p1.c, r1: p1.r, c2: colIndexOf(m[2].replace('$', '')), r2: Infinity }
        } else if (k === 1) {
          const p1 = cellParts(m[1])
          if (m[2]) { const p2 = cellParts(m[2]); node = { t: 'range', sheet, c1: p1.c, r1: p1.r, c2: p2.c, r2: p2.r } }
          else node = { t: 'ref', sheet, c: p1.c, r: p1.r }
        } else if (k === 2) {
          node = { t: 'range', sheet, c1: colIndexOf(m[1].replace('$', '')), r1: 1, c2: colIndexOf(m[2].replace('$', '')), r2: Infinity }
        } else {
          node = { t: 'range', sheet, c1: 0, r1: Number(m[1].replace('$', '')), c2: Infinity, r2: Number(m[2].replace('$', '')) }
        }
        node.pos = i
        out.push(node)
        i += adv + m[0].length
        matched = true
        break
      }
    }
    if (matched) continue
    if (sheet !== null) throw eParse('Invalid reference after sheet name.')
    if (ch === '.' || (ch >= '0' && ch <= '9')) {
      const m = NUM_RE.exec(rest)
      if (m) { out.push({ t: 'num', v: Number(m[0]), pos: i }); i += m[0].length; continue }
    }
    const nm = NAME_RE.exec(rest.length < 80 ? rest : src.slice(i, i + 200))
    if (nm) { out.push({ t: 'name', v: nm[0], pos: i }); i += nm[0].length; continue }
    const op2 = src.slice(i, i + 2)
    if (op2 === '<>' || op2 === '<=' || op2 === '>=') { out.push({ t: 'op', v: op2, pos: i }); i += 2; continue }
    if ('+-*/^&=<>(),:%{};'.includes(ch)) { out.push({ t: 'op', v: ch, pos: i }); i += 1; continue }
    throw eParse(`Unexpected character '${ch}'.`)
  }
  return out
}

export function parse(src) {
  const tokens = tokenize(src)
  let p = 0
  const peek = () => tokens[p]
  const isOp = (v) => { const t = tokens[p]; return t && t.t === 'op' && t.v === v }
  const eat = (v) => { if (isOp(v)) { p++; return true } return false }
  const need = (v) => { if (!eat(v)) throw eParse(`Expected '${v}'.`) }

  function args() {
    const list = []
    if (eat(')')) return list
    for (;;) {
      if (isOp(',') || isOp(')')) list.push({ k: 'empty' })
      else list.push(compare())
      if (eat(',')) { if (isOp(')')) { list.push({ k: 'empty' }); p++; return list } continue }
      need(')')
      return list
    }
  }
  function primary() {
    const tk = peek()
    if (!tk) throw eParse('Unexpected end of formula.')
    p++
    let node
    switch (tk.t) {
      case 'num': node = { k: 'num', v: tk.v }; break
      case 'str': node = { k: 'str', v: tk.v }; break
      case 'err': node = { k: 'err', v: tk.v }; break
      case 'ref': node = { k: 'ref', sheet: tk.sheet, c: tk.c, r: tk.r }; break
      case 'range': node = { k: 'range', sheet: tk.sheet, c1: tk.c1, r1: tk.r1, c2: tk.c2, r2: tk.r2 }; break
      case 'name': {
        if (isOp('(')) { p++; node = { k: 'fn', name: tk.v.toUpperCase(), orig: tk.v, args: args() } }
        else {
          const u = tk.v.toUpperCase()
          if (u === 'TRUE') node = { k: 'bool', v: true }
          else if (u === 'FALSE') node = { k: 'bool', v: false }
          else node = { k: 'name', v: tk.v, u }
        }
        break
      }
      case 'op':
        if (tk.v === '(') { node = compare(); need(')'); node = { k: 'paren', a: node } }
        else if (tk.v === '{') {
          if (isOp('}')) { p++; node = { k: 'arr', rows: [] }; break }
          const rows = [[]]
          for (;;) {
            rows[rows.length - 1].push(compare())
            if (eat(',')) continue
            if (eat(';')) { rows.push([]); continue }
            need('}')
            break
          }
          const w = rows[0].length
          if (rows.some((r) => r.length !== w)) throw eParse('Array literal rows must have the same length.')
          node = { k: 'arr', rows }
        } else throw eParse(`Unexpected '${tk.v}'.`)
        break
      default: throw eParse('Unexpected token.')
    }
    // 람다 즉시 호출: LAMBDA(x,x)(1)
    while (isOp('(') && (node.k === 'fn' || node.k === 'call')) { p++; node = { k: 'call', fn: node, args: args() } }
    // 동적 범위: A1:INDEX(...) 또는 INDEX(...):INDEX(...)
    if (isOp(':') && (node.k === 'ref' || node.k === 'fn') ) {
      const nx = tokens[p + 1]
      if (nx && (nx.t === 'ref' || nx.t === 'name')) {
        p++
        const right = primary()
        node = { k: 'rangeop', a: node, b: right }
      }
    }
    return node
  }
  function unary() {
    if (eat('-')) return { k: 'neg', a: unary() }
    if (eat('+')) return { k: 'pos', a: unary() }
    let e = primary()
    while (eat('%')) e = { k: 'pct', a: e }
    return e
  }
  function power() {
    let a = unary()
    while (eat('^')) a = { k: 'bin', op: '^', a, b: unary() }
    return a
  }
  function mul() {
    let a = power()
    for (;;) {
      if (eat('*')) a = { k: 'bin', op: '*', a, b: power() }
      else if (eat('/')) a = { k: 'bin', op: '/', a, b: power() }
      else return a
    }
  }
  function add() {
    let a = mul()
    for (;;) {
      if (eat('+')) a = { k: 'bin', op: '+', a, b: mul() }
      else if (eat('-')) a = { k: 'bin', op: '-', a, b: mul() }
      else return a
    }
  }
  function concat() {
    let a = add()
    while (eat('&')) a = { k: 'bin', op: '&', a, b: add() }
    return a
  }
  function compare() {
    let a = concat()
    for (;;) {
      const tk = peek()
      if (tk && tk.t === 'op' && (tk.v === '=' || tk.v === '<>' || tk.v === '<' || tk.v === '>' || tk.v === '<=' || tk.v === '>=')) {
        p++
        a = { k: 'bin', op: tk.v, a, b: concat() }
      } else return a
    }
  }
  if (!tokens.length) throw eParse('Empty formula.')
  const tree = compare()
  if (p < tokens.length) throw eParse(`Unexpected '${tokens[p].v ?? tokens[p].t}'.`)
  return tree
}

/** 구문 트리를 훑어 함수·참조 정보를 모은다 */
export function walk(node, fn) {
  if (!node) return
  fn(node)
  switch (node.k) {
    case 'neg': case 'pos': case 'pct': case 'paren': walk(node.a, fn); break
    case 'bin': case 'rangeop': walk(node.a, fn); walk(node.b, fn); break
    case 'fn': node.args.forEach((a) => walk(a, fn)); break
    case 'call': walk(node.fn, fn); node.args.forEach((a) => walk(a, fn)); break
    case 'arr': node.rows.forEach((r) => r.forEach((a) => walk(a, fn))); break
    default:
  }
}
export function refText(n) {
  const sh = n.sheet != null ? (/^[A-Za-z0-9_]+$/.test(n.sheet) ? `${n.sheet}!` : `'${n.sheet.replace(/'/g, "''")}'!`) : ''
  if (n.k === 'ref') return `${sh}${a1(n.c, n.r)}`
  if (n.r2 === Infinity) return `${sh}${colName(n.c1)}:${colName(n.c2)}`
  if (n.c2 === Infinity) return `${sh}${n.r1}:${n.r2}`
  return `${sh}${a1(n.c1, n.r1)}:${a1(n.c2, n.r2)}`
}
export { GErr }
