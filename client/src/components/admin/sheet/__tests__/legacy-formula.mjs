// 스프레드시트 수식 계산기. 칸 값이 "="로 시작하면 수식으로 보고 계산한다.
// 지원: 숫자, 문자열("..."), 칸 참조(A1), 범위(A1:B3), 사칙연산(+ - * / ^), 이어붙이기(&), 비교(= <> < > <= >=), 괄호,
// 함수 SUM AVERAGE MIN MAX COUNT COUNTA ROUND ABS IF AND OR NOT LEN CONCAT UPPER LOWER SUMIF COUNTIF TODAY NOW
// 참조 기준: 1행은 머리글, 데이터는 2행부터. 열 글자는 숨김 열을 포함한 열 순서.

const ERR = (code) => ({ err: code })
const isErr = (v) => v && typeof v === 'object' && 'err' in v
const isRange = (v) => v && typeof v === 'object' && v.range

export function colIndexOf(letters) {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function tokenize(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i += 1; continue }
    if (ch === '"') {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== '"') { s += src[j]; j += 1 }
      if (j >= src.length) throw ERR('#ERROR!')
      out.push({ t: 'str', v: s })
      i = j + 1
      continue
    }
    const num = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i))
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    const ref = /^\$?([A-Za-z]{1,3})\$?(\d+)(?![A-Za-z0-9(])/.exec(src.slice(i))
    if (ref) { out.push({ t: 'ref', c: colIndexOf(ref[1]), r: Number(ref[2]) }); i += ref[0].length; continue }
    const name = /^[A-Za-z\uAC00-\uD7A3_][A-Za-z0-9\uAC00-\uD7A3_.]*/.exec(src.slice(i))
    if (name) { out.push({ t: 'name', v: name[0].toUpperCase() }); i += name[0].length; continue }
    const op2 = src.slice(i, i + 2)
    if (['<>', '<=', '>='].includes(op2)) { out.push({ t: 'op', v: op2 }); i += 2; continue }
    if ('+-*/^&=<>(),:%'.includes(ch)) { out.push({ t: 'op', v: ch }); i += 1; continue }
    throw ERR('#ERROR!')
  }
  return out
}

/** 수식 문자열을 구문 트리로 만든다 */
function parse(tokens) {
  let p = 0
  const peek = () => tokens[p]
  const eat = (v) => { if (peek() && peek().t === 'op' && peek().v === v) { p += 1; return true } return false }

  const primary = () => {
    const tk = peek()
    if (!tk) throw ERR('#ERROR!')
    if (tk.t === 'num') { p += 1; return { k: 'num', v: tk.v } }
    if (tk.t === 'str') { p += 1; return { k: 'str', v: tk.v } }
    if (tk.t === 'ref') {
      p += 1
      if (eat(':')) {
        const t2 = peek()
        if (!t2 || t2.t !== 'ref') throw ERR('#ERROR!')
        p += 1
        return { k: 'range', c1: tk.c, r1: tk.r, c2: t2.c, r2: t2.r }
      }
      return { k: 'ref', c: tk.c, r: tk.r }
    }
    if (tk.t === 'name') {
      p += 1
      if (eat('(')) {
        const args = []
        if (!eat(')')) {
          do { args.push(compare()) } while (eat(','))
          if (!eat(')')) throw ERR('#ERROR!')
        }
        return { k: 'fn', name: tk.v, args }
      }
      if (tk.v === 'TRUE') return { k: 'num', v: true }
      if (tk.v === 'FALSE') return { k: 'num', v: false }
      throw ERR('#NAME?')
    }
    if (tk.t === 'op' && tk.v === '(') {
      p += 1
      const e = compare()
      if (!eat(')')) throw ERR('#ERROR!')
      return e
    }
    throw ERR('#ERROR!')
  }
  const unary = () => {
    if (eat('-')) return { k: 'neg', a: unary() }
    if (eat('+')) return unary()
    let e = primary()
    while (eat('%')) e = { k: 'bin', op: '/', a: e, b: { k: 'num', v: 100 } }
    return e
  }
  const power = () => {
    let a = unary()
    while (eat('^')) a = { k: 'bin', op: '^', a, b: unary() }
    return a
  }
  const mul = () => {
    let a = power()
    for (;;) {
      if (eat('*')) a = { k: 'bin', op: '*', a, b: power() }
      else if (eat('/')) a = { k: 'bin', op: '/', a, b: power() }
      else return a
    }
  }
  const add = () => {
    let a = mul()
    for (;;) {
      if (eat('+')) a = { k: 'bin', op: '+', a, b: mul() }
      else if (eat('-')) a = { k: 'bin', op: '-', a, b: mul() }
      else return a
    }
  }
  const concat = () => {
    let a = add()
    while (eat('&')) a = { k: 'bin', op: '&', a, b: add() }
    return a
  }
  function compare() {
    let a = concat()
    for (;;) {
      const tk = peek()
      if (tk && tk.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(tk.v)) {
        p += 1
        a = { k: 'bin', op: tk.v, a, b: concat() }
      } else return a
    }
  }
  const tree = compare()
  if (p < tokens.length) throw ERR('#ERROR!')
  return tree
}

const toNum = (v) => {
  if (isErr(v)) throw v
  if (v === '' || v == null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(/,/g, '').trim())
  if (Number.isNaN(n)) throw ERR('#VALUE!')
  return n
}
const toStr = (v) => {
  if (isErr(v)) throw v
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return fmtNum(v)
  return String(v)
}
const toBool = (v) => {
  if (isErr(v)) throw v
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = String(v ?? '').trim().toUpperCase()
  if (s === 'TRUE') return true
  if (s === 'FALSE' || s === '') return false
  const n = Number(s)
  if (!Number.isNaN(n)) return n !== 0
  throw ERR('#VALUE!')
}
export function fmtNum(n) {
  if (!Number.isFinite(n)) return n > 0 ? '#NUM!' : n < 0 ? '#NUM!' : '#NUM!'
  return String(Number(n.toPrecision(12)))
}

/**
 * 시트 하나의 수식을 계산하는 함수를 만든다.
 * getRaw(c, r): 0부터 세는 열 번호 c, 시트 행 번호 r(1은 머리글, 2부터 데이터)의 원본 문자열을 돌려준다. 범위 밖이면 null.
 * 반환값 display(c, r): 화면에 보일 문자열(수식이 아니면 원본 그대로).
 */
export function createEvaluator(getRaw, now = () => new Date()) {
  const cache = new Map()
  const stack = new Set()

  const cellValue = (c, r) => {
    const key = `${c},${r}`
    if (cache.has(key)) return cache.get(key)
    const raw = getRaw(c, r)
    if (raw == null) return ''
    let val
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      if (stack.has(key)) return ERR('#CIRC!')
      stack.add(key)
      try {
        val = evalTree(parse(tokenize(raw.slice(1))))
        if (isRange(val)) val = ERR('#VALUE!')
      } catch (e) {
        val = isErr(e) ? e : ERR('#ERROR!')
      } finally {
        stack.delete(key)
      }
    } else if (raw !== '' && !Number.isNaN(Number(String(raw).replace(/,/g, ''))) && /^-?[\d,]*\.?\d+$/.test(String(raw).trim())) {
      val = Number(String(raw).replace(/,/g, ''))
    } else {
      val = raw
    }
    cache.set(key, val)
    return val
  }

  const rangeValues = (n) => {
    const out = []
    const [c1, c2] = [Math.min(n.c1, n.c2), Math.max(n.c1, n.c2)]
    const [r1, r2] = [Math.min(n.r1, n.r2), Math.max(n.r1, n.r2)]
    for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) { const raw = getRaw(c, r); if (raw != null) out.push(cellValue(c, r)) }
    return out
  }

  const flat = (args) => {
    const out = []
    for (const a of args) {
      if (isRange(a)) out.push(...a.values)
      else out.push(a)
    }
    return out
  }
  const nums = (args, { strict = false } = {}) => {
    const out = []
    for (const a of args) {
      if (isRange(a)) {
        for (const v of a.values) {
          if (isErr(v)) throw v
          if (typeof v === 'number') out.push(v)
          else if (typeof v === 'boolean') continue
        }
      } else {
        if (isErr(a)) throw a
        if (typeof a === 'number') out.push(a)
        else if (typeof a === 'boolean') out.push(a ? 1 : 0)
        else if (strict || String(a).trim() !== '') out.push(toNum(a))
      }
    }
    return out
  }

  const matchCriteria = (cell, crit) => {
    let op = '='
    let target = crit
    if (typeof crit === 'string') {
      const m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(crit)
      if (m) { op = m[1]; target = m[2] }
    }
    const tn = typeof target === 'number' ? target : target !== '' && !Number.isNaN(Number(target)) ? Number(target) : null
    const cn = typeof cell === 'number' ? cell : cell !== '' && !Number.isNaN(Number(cell)) ? Number(cell) : null
    if (tn !== null && cn !== null) {
      return { '=': cn === tn, '<>': cn !== tn, '<': cn < tn, '>': cn > tn, '<=': cn <= tn, '>=': cn >= tn }[op]
    }
    const a = String(cell ?? '').toLowerCase()
    const b = String(target ?? '').toLowerCase()
    if (op === '=') return a === b
    if (op === '<>') return a !== b
    return false
  }

  const FN = {
    SUM: (a) => nums(a).reduce((x, y) => x + y, 0),
    AVERAGE: (a) => { const n = nums(a); if (!n.length) throw ERR('#DIV/0!'); return n.reduce((x, y) => x + y, 0) / n.length },
    MIN: (a) => { const n = nums(a); return n.length ? Math.min(...n) : 0 },
    MAX: (a) => { const n = nums(a); return n.length ? Math.max(...n) : 0 },
    COUNT: (a) => flat(a).filter((v) => typeof v === 'number').length,
    COUNTA: (a) => flat(a).filter((v) => v !== '' && v != null).length,
    ROUND: (a) => { const n = toNum(a[0]); const d = a[1] === undefined ? 0 : toNum(a[1]); const m = 10 ** d; return Math.round(n * m) / m },
    ABS: (a) => Math.abs(toNum(a[0])),
    IF: (a) => { if (a.length < 2) throw ERR('#ERROR!'); return toBool(a[0]) ? a[1] : a[2] === undefined ? false : a[2] },
    AND: (a) => flat(a).every((v) => toBool(v)),
    OR: (a) => flat(a).some((v) => toBool(v)),
    NOT: (a) => !toBool(a[0]),
    LEN: (a) => toStr(a[0]).length,
    CONCAT: (a) => flat(a).map(toStr).join(''),
    UPPER: (a) => toStr(a[0]).toUpperCase(),
    LOWER: (a) => toStr(a[0]).toLowerCase(),
    SUMIF: (a) => {
      if (!isRange(a[0])) throw ERR('#VALUE!')
      const sumR = isRange(a[2]) ? a[2].values : a[0].values
      let s = 0
      a[0].values.forEach((v, i) => { if (matchCriteria(v, a[1]) && typeof sumR[i] === 'number') s += sumR[i] })
      return s
    },
    COUNTIF: (a) => {
      if (!isRange(a[0])) throw ERR('#VALUE!')
      return a[0].values.filter((v) => matchCriteria(v, a[1])).length
    },
    TODAY: () => { const d = now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` },
    NOW: () => { const d = now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` },
  }

  const evalTree = (n) => {
    switch (n.k) {
      case 'num': case 'str': return n.v
      case 'ref': return n.r < 1 || n.c < 0 ? ERR('#REF!') : getRaw(n.c, n.r) == null ? '' : cellValue(n.c, n.r)
      case 'range': return { range: true, values: rangeValues(n) }
      case 'neg': return -toNum(evalTree(n.a))
      case 'fn': {
        const f = FN[n.name]
        if (!f) throw ERR('#NAME?')
        // IF는 고른 쪽만 계산하면 되지만 단순함을 위해 모두 계산한다(오류 전파는 선택된 값 기준)
        if (n.name === 'IF') {
          const cond = toBool(evalTree(n.args[0]))
          const pick = cond ? n.args[1] : n.args[2]
          if (!pick) return cond ? '' : false
          const v = evalTree(pick)
          if (isErr(v)) throw v
          return isRange(v) ? ERR('#VALUE!') : v
        }
        return f(n.args.map(evalTree))
      }
      case 'bin': {
        const a = evalTree(n.a)
        const b = evalTree(n.b)
        if (isErr(a)) throw a
        if (isErr(b)) throw b
        if (isRange(a) || isRange(b)) throw ERR('#VALUE!')
        switch (n.op) {
          case '+': return toNum(a) + toNum(b)
          case '-': return toNum(a) - toNum(b)
          case '*': return toNum(a) * toNum(b)
          case '/': { const d = toNum(b); if (d === 0) throw ERR('#DIV/0!'); return toNum(a) / d }
          case '^': return toNum(a) ** toNum(b)
          case '&': return toStr(a) + toStr(b)
          default: {
            const bothNum = typeof a !== 'string' && typeof b !== 'string'
            const x = bothNum ? toNum(a) : toStr(a).toLowerCase()
            const y = bothNum ? toNum(b) : toStr(b).toLowerCase()
            return { '=': x === y, '<>': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[n.op]
          }
        }
      }
      default: throw ERR('#ERROR!')
    }
  }

  return (c, r) => {
    const raw = getRaw(c, r)
    if (raw == null) return ''
    if (!(typeof raw === 'string' && raw.startsWith('=') && raw.length > 1)) return raw
    const v = cellValue(c, r)
    if (isErr(v)) return v.err
    return toStr(v)
  }
}
