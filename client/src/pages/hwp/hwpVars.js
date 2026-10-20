// 자료값: 문서마다 사용자가 정하는 변수. 값은 문서 설정(content.hwp.vars)에 한 번만 두고,
// 본문의 자료값 칸(hwpVar 노드)과 두문·결문의 {이름} 자리가 모두 그 값을 보여 준다.
// 계산 칸은 다른 자료값의 이름과 숫자, + - * / ( ) 만 쓴다. 예: {예산} / {인원}
// (miri docVars.js 의 고정 자료 목록을 사용자 정의 자료로 바꿨다)

export const EMPTY = '○○○'

/** vars: { key: { label, value, unit } } → 순서 있는 목록 */
// 저장소(jsonb)는 키 순서를 지키지 않아 o(순서 번호)로 정렬한다
export const varList = (vars) =>
  Object.entries(vars || {})
    .map(([key, v], i) => ({ key, label: v?.label || key, value: v?.value ?? '', unit: v?.unit || '', o: Number.isFinite(v?.o) ? v.o : 1000 + i }))
    .sort((a, b) => a.o - b.o)
export const nextOrder = (vars) => Math.max(-1, ...Object.values(vars || {}).map((v) => (Number.isFinite(v?.o) ? v.o : -1))) + 1

export function newVarKey(vars) {
  let i = Object.keys(vars || {}).length + 1
  while (vars?.[`v${i}`]) i += 1
  return `v${i}`
}

const NUM_RE = /^\s*-?[\d,]+(\.\d+)?\s*$/
export const numOf = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '')
  if (!NUM_RE.test(s)) return NaN
  return Number(s.replace(/[,\s]/g, ''))
}

/** 보이는 글: 숫자면 천 단위 쉼표, 비어 있으면 ○○○, 단위는 뒤에 붙인다 */
export function formatValue(v) {
  if (!v) return EMPTY
  const raw = String(v.value ?? '').trim()
  if (!raw) return EMPTY
  const n = numOf(raw)
  const body = Number.isFinite(n) ? n.toLocaleString('ko-KR', { maximumFractionDigits: 10 }) : raw
  return `${body}${v.unit || ''}`
}

const findVar = (vars, name) => {
  if (!vars) return null
  if (vars[name]) return vars[name]
  return Object.values(vars).find((v) => v?.label === name) || null
}

// 사칙연산만 하는 작은 계산기(eval 을 쓰지 않는다)
function calc(src) {
  let i = 0
  const s = src.replace(/\s+/g, '')
  const num = () => {
    const m = /^\d+(\.\d+)?/.exec(s.slice(i))
    if (!m) throw new Error('수 없음')
    i += m[0].length
    return Number(m[0])
  }
  const factor = () => {
    if (s[i] === '-') { i += 1; return -factor() }
    if (s[i] === '+') { i += 1; return factor() }
    if (s[i] === '(') { i += 1; const v = expr(); if (s[i] !== ')') throw new Error('괄호'); i += 1; return v }
    return num()
  }
  const term = () => {
    let v = factor()
    while (s[i] === '*' || s[i] === '/') { const op = s[i]; i += 1; const r = factor(); v = op === '*' ? v * r : v / r }
    return v
  }
  const expr = () => {
    let v = term()
    while (s[i] === '+' || s[i] === '-') { const op = s[i]; i += 1; const r = term(); v = op === '+' ? v + r : v - r }
    return v
  }
  const v = expr()
  if (i !== s.length) throw new Error('식 오류')
  return v
}

/** 계산 칸 값. 식의 {이름} 을 자료값 숫자로 바꿔 계산한다. 빈 값이 있으면 ○○○, 식이 틀리면 '계산 불가' */
export function evalCalc(expr, vars, digits = 0) {
  let missing = false
  let bad = false
  const src = String(expr || '').replace(/\{([^{}]+)\}/g, (_, name) => {
    const v = findVar(vars, name.trim())
    if (!v) { bad = true; return '0' }
    if (!String(v.value ?? '').trim()) { missing = true; return '0' }
    const n = numOf(v.value)
    if (!Number.isFinite(n)) { bad = true; return '0' }
    return `(${n})`
  })
  if (bad || !/^[\d\s+\-*/().]+$/.test(src)) return '계산 불가'
  if (missing) return EMPTY
  try {
    const r = calc(src)
    if (!Number.isFinite(r)) return '계산 불가'
    const d = Math.max(0, Math.min(4, Number(digits) || 0))
    return r.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })
  } catch {
    return '계산 불가'
  }
}

/** 자료값 노드 attrs → 보이는 글 */
export function chipText(attrs, vars) {
  if (attrs?.calc) {
    const r = evalCalc(attrs.calc, vars, attrs.digits)
    return r === EMPTY || r === '계산 불가' ? r : `${r}${attrs.unit || ''}`
  }
  return formatValue(vars?.[attrs?.key])
}

/** 글 안의 {이름} 자리를 자료값으로 채운다(두문, 결문) */
export const fillTokens = (s, vars) =>
  String(s || '').replace(/\{([^{}]+)\}/g, (all, name) => {
    const v = findVar(vars, name.trim())
    return v ? formatValue(v) : all
  })

/** 내보내기 전: 문서 JSON 의 자료값 노드를 글로 바꾼다(앞뒤 글과 같은 글자 모양을 물려받지 않는다) */
export function resolveVars(json, vars) {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n
    if (n.type === 'hwpVar') return { type: 'text', text: chipText(n.attrs, vars), ...(n.marks ? { marks: n.marks } : {}) }
    if (Array.isArray(n.content)) return { ...n, content: n.content.map(walk) }
    return n
  }
  const { hwp, ...rest } = json || {} // eslint-disable-line no-unused-vars
  return walk(rest)
}
