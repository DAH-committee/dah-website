// formLogic.js: 설문(DAH Form)의 순수 로직. 서버와 클라이언트가 같은 파일을 쓴다.
//   서버: server/src/lib/formLogic.js   클라이언트: client/src/components/forms/formLogic.js (똑같이 복사본, 테스트가 같은지 확인한다)
// DOM, Node 전용 API, 외부 패키지 없음. 검증의 최종 권한은 서버이고 클라이언트는 편의용으로 같은 함수를 쓴다.
//
// 스키마(모두 additive: 예전 폼은 이 키가 없어도 그대로 동작한다)
//   field.type        예전 13종 + 'radio_grid' | 'checkbox_grid' | 'rating'
//   field.rows        string[]  격자 행(질문 문장). 최대 50
//   field.columns     string[]  격자 열(보기). 최대 20
//   field.logic       radio/select: { options: { [보기]: 'submit' | 'section:<섹션id>' } }   section: { after: 'submit' | 'section:<섹션id>' }
//                     기본값(다음 섹션으로)은 저장하지 않는다. 분기는 앞쪽 섹션으로만 갈 수 없다(뒤로만): 반복과 막다른 길이 구조상 생기지 않는다.
//   field.quiz        { points, correct:string[], ignoreCase, numeric, feedback_correct, feedback_incorrect }  (공개 JSON에는 points 만 나간다)
//   field.validation  { maxLength, scaleMin, scaleMax, scaleMinLabel, scaleMaxLabel,
//                       rule:{ kind:'number'|'text'|'length'|'regex'|'choices', op, value, value2, n, message },
//                       shuffle:boolean, other:boolean, ratingMax:3..10, ratingIcon:'star'|'heart'|'thumb',
//                       noDuplicate:boolean (radio_grid 열마다 한 번만), requireEachRow:boolean }
//   settings.quiz     { enabled, release:'immediate'|'manual'|'never', released:boolean, show_answers:boolean }
//   settings.confirmation_ko  제출 완료 문구
// 응답 값
//   radio/select/rating/scale 문자열, checkbox 문자열 배열, radio_grid { [행]: 열 }, checkbox_grid { [행]: 열[] }
//   "기타" 입력: `기타: 내용` 한 줄 문자열. 퀴즈 점수는 서버가 계산해 data._quiz 에 넣는다.

export const BASE_TYPES = [
  'text', 'textarea', 'select', 'radio', 'checkbox',
  'phone', 'email', 'studentid', 'file', 'date', 'time', 'scale', 'section',
]
export const FIELD_TYPES = [...BASE_TYPES, 'radio_grid', 'checkbox_grid', 'rating']
export const GRID_TYPES = ['radio_grid', 'checkbox_grid']
export const CHOICE_TYPES = ['select', 'radio']
export const LIMITS = {
  fields: 300, options: 200, optionLen: 200, rows: 50, columns: 20, text: 20000, label: 500, hint: 2000,
  regexLen: 200, regexInput: 2000, sections: 75, other: 200, keys: 50, feedback: 500, points: 1000, choicesN: 200,
}
export const OTHER_LABEL = '기타'
export const OTHER_PREFIX = '기타: '

const asArray = (v) => (Array.isArray(v) ? v : [])
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const clip = (v, max) => (v == null ? '' : String(v)).slice(0, max)
const intIn = (v, lo, hi, d) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/
const toNum = (s) => (NUM_RE.test(String(s).trim()) ? Number(String(s).trim()) : NaN)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i

// ───────────────────────── 정규화 (저장 시 서버가, 편집기가 불러올 때 클라이언트가) ─────────────────────────

const TARGET_RE = /^section:[A-Za-z0-9_.-]{1,64}$/
export function cleanTarget(t) {
  if (t === 'submit') return 'submit'
  if (typeof t === 'string' && TARGET_RE.test(t)) return t
  return null
}

export function cleanStrings(v, maxN, maxLen) {
  const out = []
  for (const x of asArray(v)) {
    if (out.length >= maxN) break
    if (typeof x === 'string' || typeof x === 'number') out.push(clip(x, maxLen))
  }
  return out
}

export function cleanRule(r) {
  if (!isObj(r)) return null
  const kind = ['number', 'text', 'length', 'regex', 'choices'].includes(r.kind) ? r.kind : null
  if (!kind) return null
  const OPS = {
    number: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between', 'notBetween', 'isNumber', 'isInteger'],
    text: ['contains', 'notContains', 'email', 'url'],
    length: ['max', 'min'],
    regex: ['matches', 'notMatches', 'contains', 'notContains'],
    choices: ['atLeast', 'atMost', 'exactly'],
  }
  if (!OPS[kind].includes(r.op)) return null
  const out = { kind, op: r.op, message: clip(r.message, 200) }
  if (kind === 'choices') out.n = intIn(r.n, 1, LIMITS.choicesN, 1)
  else if (kind === 'length') out.n = intIn(r.n ?? r.value, 0, LIMITS.text, 0)
  else {
    out.value = clip(r.value, kind === 'regex' ? LIMITS.regexLen : 200)
    if (r.value2 != null) out.value2 = clip(r.value2, 200)
  }
  return out
}

export function cleanValidation(v, type) {
  const src = isObj(v) ? v : {}
  const out = {}
  // 예전 키는 그대로 통과(타입 안정화만)
  if (src.maxLength != null && Number.isFinite(Number(src.maxLength))) out.maxLength = intIn(src.maxLength, 1, LIMITS.text, LIMITS.text)
  if (src.scaleMin != null) out.scaleMin = Number(src.scaleMin) === 0 ? 0 : 1
  if (src.scaleMax != null) out.scaleMax = intIn(src.scaleMax, 2, 10, 5)
  if (src.scaleMinLabel != null) out.scaleMinLabel = clip(src.scaleMinLabel, 60)
  if (src.scaleMaxLabel != null) out.scaleMaxLabel = clip(src.scaleMaxLabel, 60)
  const rule = cleanRule(src.rule)
  if (rule) out.rule = rule
  if (src.shuffle === true) out.shuffle = true
  if (src.other === true && (type === 'radio' || type === 'checkbox' || type === 'select')) out.other = true
  if (type === 'rating') {
    out.ratingMax = intIn(src.ratingMax, 3, 10, 5)
    out.ratingIcon = ['star', 'heart', 'thumb'].includes(src.ratingIcon) ? src.ratingIcon : 'star'
    if (src.scaleMinLabel != null) out.scaleMinLabel = clip(src.scaleMinLabel, 60)
    if (src.scaleMaxLabel != null) out.scaleMaxLabel = clip(src.scaleMaxLabel, 60)
  }
  if (GRID_TYPES.includes(type)) {
    if (src.noDuplicate === true && type === 'radio_grid') out.noDuplicate = true
    if (src.requireEachRow === false) out.requireEachRow = false
  }
  return out
}

export function cleanLogic(f) {
  if (!isObj(f?.logic)) return null
  if (f.type === 'section') {
    const after = cleanTarget(f.logic.after)
    return after ? { after } : null
  }
  if (CHOICE_TYPES.includes(f.type) && isObj(f.logic.options)) {
    const opts = {}
    const known = new Set(asArray(f.options).map(String))
    let n = 0
    for (const [k, t] of Object.entries(f.logic.options)) {
      if (n >= LIMITS.options) break
      const target = cleanTarget(t)
      if (!target) continue
      if (!known.has(k) && k !== OTHER_LABEL) continue
      opts[clip(k, LIMITS.optionLen)] = target
      n += 1
    }
    return Object.keys(opts).length ? { options: opts } : null
  }
  return null
}

export function cleanQuiz(q) {
  if (!isObj(q)) return null
  const points = intIn(q.points, 0, LIMITS.points, 0)
  const correct = cleanStrings(typeof q.correct === 'string' ? [q.correct] : q.correct, LIMITS.keys, LIMITS.optionLen)
  const out = { points, correct, ignoreCase: q.ignoreCase !== false, numeric: q.numeric === true }
  if (q.feedback_correct) out.feedback_correct = clip(q.feedback_correct, LIMITS.feedback)
  if (q.feedback_incorrect) out.feedback_incorrect = clip(q.feedback_incorrect, LIMITS.feedback)
  if (!points && !correct.length && !out.feedback_correct && !out.feedback_incorrect) return null
  return out
}

export function cleanSettingsQuiz(q) {
  const src = isObj(q) ? q : {}
  return {
    enabled: src.enabled === true,
    release: ['immediate', 'manual', 'never'].includes(src.release) ? src.release : 'immediate',
    released: src.released === true,
    show_answers: src.show_answers === true,
  }
}

/** 새 기능 키만 정리한다. 예전 키 처리는 서버 normalizeFields 가 그대로 한다 */
export function normalizeExtras(f) {
  const type = FIELD_TYPES.includes(f?.type) ? f.type : 'text'
  const out = { validation: cleanValidation(f?.validation, type) }
  if (GRID_TYPES.includes(type)) {
    out.rows = cleanStrings(f?.rows, LIMITS.rows, LIMITS.optionLen)
    out.columns = cleanStrings(f?.columns, LIMITS.columns, LIMITS.optionLen)
  }
  const logic = cleanLogic({ ...f, type })
  if (logic) out.logic = logic
  const quiz = type === 'section' ? null : cleanQuiz(f?.quiz)
  if (quiz) out.quiz = quiz
  return out
}

// ───────────────────────── 쪽(섹션) 구조와 분기 ─────────────────────────

const byOrder = (fields) => asArray(fields).map((f, i) => [f, i]).sort((a, b) => (a[0]?.order ?? a[1]) - (b[0]?.order ?? b[1]) || a[1] - b[1]).map((x) => x[0])

/** 질문을 쪽으로 나눈다. 첫 섹션 앞의 질문은 이름 없는 첫 쪽. 비어 있고 섹션도 없는 쪽은 뺀다 */
export function buildPages(fields) {
  const pages = [{ section: null, fields: [] }]
  for (const f of byOrder(fields)) {
    if (!f) continue
    if (f.type === 'section') pages.push({ section: f, fields: [] })
    else pages[pages.length - 1].fields.push(f)
  }
  return pages.filter((p) => p.section || p.fields.length)
}

function answerKey(q, data) {
  const v = data?.[q.id]
  if (v == null) return ''
  const s = String(v)
  // 기타 입력은 기타 보기의 분기를 따른다
  return s.startsWith(OTHER_PREFIX) ? OTHER_LABEL : s
}

/**
 * 한 쪽을 끝낸 뒤 갈 곳. 같은 쪽에 분기 질문이 여럿이면 아래쪽 질문의 답이 이긴다.
 * @returns {{kind:'next'|'submit'|'page', index?:number}}
 */
export function nextAfter(pages, idx, data) {
  const page = pages[idx]
  if (!page) return { kind: 'submit' }
  let target = null
  for (const q of page.fields) {
    if (!CHOICE_TYPES.includes(q.type)) continue
    const t = cleanTarget(q.logic?.options?.[answerKey(q, data)])
    if (t) target = t
  }
  if (!target) target = cleanTarget(page.section?.logic?.after)
  if (target === 'submit') return { kind: 'submit' }
  if (target) {
    const at = pages.findIndex((p) => p.section && `section:${p.section.id}` === target)
    if (at > idx) return { kind: 'page', index: at }
    // 없는 섹션이거나 뒤로 가는 분기는 따르지 않는다(저장 검사가 막지만 서버는 한 번 더 지킨다)
  }
  return idx + 1 < pages.length ? { kind: 'page', index: idx + 1 } : { kind: 'submit' }
}

/** 지금 답으로 거치게 될 쪽 번호 목록(0부터). from 쪽부터 센다 */
export function computePath(fields, data, from = 0) {
  const pages = buildPages(fields)
  const path = []
  let idx = from
  let guard = 0
  while (idx >= 0 && idx < pages.length && guard++ <= pages.length) {
    path.push(idx)
    const nx = nextAfter(pages, idx, data)
    if (nx.kind === 'page') idx = nx.index
    else break
  }
  return { pages, path }
}

/** 거치게 되는 질문 id 집합(섹션 제외) */
export function visibleIds(fields, data) {
  const { pages, path } = computePath(fields, data)
  const ids = new Set()
  for (const p of path) for (const f of pages[p].fields) ids.add(f.id)
  return ids
}

/** 어느 답으로도 닿을 수 없는 쪽과 저장 때 막아야 할 분기 문제를 찾는다 */
export function analyzeFlow(fields) {
  const pages = buildPages(fields)
  const issues = []
  const idxOf = new Map(pages.filter((p) => p.section).map((p, _i) => [`section:${p.section.id}`, pages.indexOf(p)]))
  const edges = pages.map(() => new Set())
  const label = (i) => pages[i].section?.label_ko || `${i + 1}쪽`
  pages.forEach((p, i) => {
    const check = (t, where) => {
      const c = cleanTarget(t)
      if (!c || c === 'submit') return c
      const at = idxOf.get(c)
      if (at === undefined) issues.push({ id: where.id, code: 'missing', message: `"${where.label}"의 분기가 없는 섹션을 가리킵니다` })
      else if (at <= i) issues.push({ id: where.id, code: 'back', message: `"${where.label}"의 분기가 앞쪽이나 같은 섹션(${label(at)})으로 돌아갑니다. 분기는 뒤쪽 섹션으로만 보낼 수 있습니다` })
      return at !== undefined && at > i ? c : null
    }
    const afterT = check(p.section?.logic?.after, { id: p.section?.id, label: p.section?.label_ko || label(i) })
    let hasQuestionLogic = false
    let allCovered = true
    for (const q of p.fields) {
      if (!CHOICE_TYPES.includes(q.type)) continue
      const map = isObj(q.logic?.options) ? q.logic.options : {}
      const opts = [...asArray(q.options)]
      let covered = 0
      for (const o of opts) {
        const t = check(map[o], { id: q.id, label: q.label_ko || q.id })
        if (t) {
          covered += 1
          hasQuestionLogic = true
          edges[i].add(t === 'submit' ? -1 : idxOf.get(t))
        }
      }
      if (covered < opts.length || q.validation?.other) allCovered = false
    }
    const fallback = afterT || null
    if (fallback) edges[i].add(fallback === 'submit' ? -1 : idxOf.get(fallback))
    // 기본 경로(다음 섹션)는 분기가 닿지 않는 답이 있거나 분기 질문이 없으면 열려 있다
    if (!fallback && (!hasQuestionLogic || !allCovered) && i + 1 < pages.length) edges[i].add(i + 1)
    if (!fallback && !hasQuestionLogic && i + 1 >= pages.length) edges[i].add(-1)
  })
  const seen = new Set([0])
  const stack = [0]
  while (stack.length) {
    const i = stack.pop()
    for (const j of edges[i] || []) if (j >= 0 && !seen.has(j)) { seen.add(j); stack.push(j) }
  }
  const unreachable = pages.map((_, i) => i).filter((i) => !seen.has(i))
  for (const i of unreachable) issues.push({ id: pages[i].section?.id, code: 'unreachable', message: `"${label(i)}"에는 어떤 답으로도 갈 수 없습니다` })
  return { pages, issues, unreachable }
}

// ───────────────────────── 검증 ─────────────────────────

export const ERROR_TEXT = {
  required: '필수 항목입니다',
  phone: '010-0000-0000 형식으로 입력해 주세요',
  email: '이메일 주소 형식으로 입력해 주세요',
  studentid: '학번 8자리 숫자로 입력해 주세요',
  date: '날짜를 선택해 주세요',
  time: '시간을 14:30처럼 입력해 주세요',
  scale: '점수를 골라 주세요',
  rating: '점수를 골라 주세요',
  option: '보기 중에서 선택해 주세요',
  other: '기타 내용을 입력해 주세요',
  grid: '모든 행에 답해 주세요',
  gridDuplicate: '같은 열을 두 번 고를 수 없습니다',
  type: '입력 형식이 맞지 않습니다',
  tooMany: '선택이 너무 많습니다',
  rule: '입력을 확인해 주세요',
}
export function errorText(item) {
  if (!item) return ''
  if (item.error === 'maxLength') return `${item.max}자 이내로 입력해 주세요`
  if (item.error === 'rule' && item.message) return item.message
  return ERROR_TEXT[item.error] ?? '입력을 확인해 주세요'
}

/** 정규식 규칙 문자열이 안전한가: 길이, 문법, 역참조·중첩 반복(재앙적 백트래킹 후보) 거절 */
export function checkRegexSafe(pattern) {
  const p = String(pattern ?? '')
  if (!p || p.length > LIMITS.regexLen) return '정규식은 1~200자여야 합니다'
  if (/\\[1-9]|\\k</.test(p)) return '역참조는 쓸 수 없습니다'
  if (/\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)\s*[+*{]/.test(p)) return '반복 안에 반복이 있는 식은 쓸 수 없습니다'
  if (/\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*{]/.test(p)) return '반복되는 묶음 안에 "또는"(|)은 쓸 수 없습니다'
  try {
    new RegExp(p, 'u')
  } catch {
    return '정규식 문법이 맞지 않습니다'
  }
  return null
}

function ruleFails(rule, f, value) {
  const { kind, op } = rule
  const s = String(value)
  if (kind === 'number') {
    const n = toNum(s)
    if (op === 'isNumber') return !Number.isFinite(n)
    if (!Number.isFinite(n)) return true
    if (op === 'isInteger') return !Number.isInteger(n)
    const a = toNum(rule.value)
    const b = toNum(rule.value2)
    if (op === 'gt') return !(n > a)
    if (op === 'gte') return !(n >= a)
    if (op === 'lt') return !(n < a)
    if (op === 'lte') return !(n <= a)
    if (op === 'eq') return !(n === a)
    if (op === 'neq') return !(n !== a)
    if (op === 'between') return !(n >= Math.min(a, b) && n <= Math.max(a, b))
    if (op === 'notBetween') return n >= Math.min(a, b) && n <= Math.max(a, b)
    return false
  }
  if (kind === 'text') {
    if (op === 'email') return !EMAIL_RE.test(s)
    if (op === 'url') return !URL_RE.test(s)
    if (op === 'contains') return !s.includes(rule.value ?? '')
    if (op === 'notContains') return s.includes(rule.value ?? '')
  }
  if (kind === 'length') {
    const n = Number(rule.n) || 0
    return op === 'max' ? s.length > n : s.length < n
  }
  if (kind === 'regex') {
    if (checkRegexSafe(rule.value)) return true
    if (s.length > LIMITS.regexInput) return op === 'matches' || op === 'contains'
    const body = op === 'matches' || op === 'notMatches' ? `^(?:${rule.value})$` : rule.value
    let hit = false
    try { hit = new RegExp(body, 'u').test(s) } catch { return true }
    return op === 'matches' || op === 'contains' ? !hit : hit
  }
  return false
}

function pushRule(errors, f, rule, value) {
  if (!rule) return
  if (ruleFails(rule, f, value)) errors.push({ field: f.id, error: 'rule', message: rule.message || undefined, label: f.label_ko })
}

const isOtherVal = (v) => typeof v === 'string' && /^기타: \S.{0,199}$/s.test(v) && v.length <= OTHER_PREFIX.length + LIMITS.other
const optionOk = (f, v) => asArray(f.options).map(String).includes(v) || (f.validation?.other === true && isOtherVal(v))
export function ratingMaxOf(validation) {
  return intIn(validation?.ratingMax, 3, 10, 5)
}
export function scaleRange(validation) {
  const lo = Number(validation?.scaleMin)
  const hi = Number(validation?.scaleMax)
  return { min: lo === 0 ? 0 : 1, max: Number.isInteger(hi) && hi >= 2 && hi <= 10 ? hi : 5 }
}

const PHONE_RE = /^010-\d{4}-\d{4}$/
const STUDENT_ID_RE = /^\d{8}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 응답 검증. 거치게 되는 쪽의 질문만 검사한다(건너뛴 쪽은 필수여도 묻지 않는다).
 * @param {Array} fields
 * @param {object} data
 * @param {{only?: Set<string>}} [opts] only: 이 id 의 질문만 검사(클라이언트가 한 쪽씩 검사할 때)
 */
export function validateResponse(fields, data, opts = {}) {
  const errors = []
  const body = isObj(data) ? data : {}
  const reach = visibleIds(fields, body)
  for (const f of asArray(fields)) {
    if (!f || f.type === 'section') continue
    if (!reach.has(f.id)) continue
    if (opts.only && !opts.only.has(f.id)) continue
    const raw = body[f.id]
    const v = f.validation || {}

    if (GRID_TYPES.includes(f.type)) {
      errors.push(...validateGrid(f, raw))
      continue
    }

    const isCheckbox = f.type === 'checkbox'
    if (isCheckbox && raw != null && !Array.isArray(raw)) {
      errors.push({ field: f.id, error: 'type', label: f.label_ko })
      continue
    }
    if (!isCheckbox && raw != null && typeof raw !== 'string' && typeof raw !== 'number') {
      errors.push({ field: f.id, error: 'type', label: f.label_ko })
      continue
    }
    const value = isCheckbox ? asArray(raw) : raw == null ? '' : String(raw).trim()
    const empty = isCheckbox ? value.length === 0 : value === ''

    if (f.required && empty) {
      errors.push({ field: f.id, error: 'required', label: f.label_ko })
      continue
    }
    if (empty) continue

    if (isCheckbox) {
      if (value.length > LIMITS.options + 1 || value.some((x) => typeof x !== 'string')) {
        errors.push({ field: f.id, error: 'tooMany', label: f.label_ko })
        continue
      }
      if (new Set(value).size !== value.length) {
        errors.push({ field: f.id, error: 'option', label: f.label_ko })
        continue
      }
      const bad = value.filter((x) => !optionOk(f, x))
      if (bad.length) {
        errors.push({ field: f.id, error: v.other && bad.some((x) => String(x).startsWith('기타')) ? 'other' : 'option', label: f.label_ko })
        continue
      }
      if (value.filter((x) => String(x).startsWith(OTHER_PREFIX) && !asArray(f.options).includes(x)).length > 1) {
        errors.push({ field: f.id, error: 'option', label: f.label_ko })
        continue
      }
      if (v.rule?.kind === 'choices') {
        const n = v.rule.n
        const ok = v.rule.op === 'atLeast' ? value.length >= n : v.rule.op === 'atMost' ? value.length <= n : value.length === n
        if (!ok) errors.push({ field: f.id, error: 'rule', message: v.rule.message || undefined, label: f.label_ko })
      }
      continue
    }

    if (value.length > LIMITS.text) {
      errors.push({ field: f.id, error: 'maxLength', max: LIMITS.text, label: f.label_ko })
      continue
    }
    const max = Number(v.maxLength)
    if (Number.isFinite(max) && value.length > max) {
      errors.push({ field: f.id, error: 'maxLength', max, label: f.label_ko })
    }
    if (f.type === 'phone' && !PHONE_RE.test(value)) errors.push({ field: f.id, error: 'phone', label: f.label_ko })
    if (f.type === 'email' && !EMAIL_RE.test(value)) errors.push({ field: f.id, error: 'email', label: f.label_ko })
    if (f.type === 'studentid' && !STUDENT_ID_RE.test(value)) errors.push({ field: f.id, error: 'studentid', label: f.label_ko })
    if (f.type === 'date' && !DATE_RE.test(value)) errors.push({ field: f.id, error: 'date', label: f.label_ko })
    if (f.type === 'time' && !TIME_RE.test(value)) errors.push({ field: f.id, error: 'time', label: f.label_ko })
    if (f.type === 'scale') {
      const { min, max: hi } = scaleRange(v)
      const n = Number(value)
      if (!Number.isInteger(n) || n < min || n > hi) errors.push({ field: f.id, error: 'scale', label: f.label_ko })
    }
    if (f.type === 'rating') {
      const n = Number(value)
      if (!/^\d+$/.test(value) || n < 1 || n > ratingMaxOf(v)) errors.push({ field: f.id, error: 'rating', label: f.label_ko })
    }
    if (['select', 'radio'].includes(f.type)) {
      const opts = asArray(f.options)
      if (opts.length || v.other) {
        if (!optionOk(f, value)) errors.push({ field: f.id, error: v.other && value.startsWith('기타') ? 'other' : 'option', label: f.label_ko })
      }
    }
    if ((f.type === 'text' || f.type === 'textarea') && v.rule) {
      const k = v.rule.kind
      const allowed = f.type === 'text' ? ['number', 'text', 'length', 'regex'] : ['length', 'regex']
      if (allowed.includes(k)) pushRule(errors, f, v.rule, value)
    }
  }
  return errors
}

function validateGrid(f, raw) {
  const errors = []
  const rows = asArray(f.rows).map(String)
  const cols = asArray(f.columns).map(String)
  const multi = f.type === 'checkbox_grid'
  const must = f.required && f.validation?.requireEachRow !== false
  if (raw != null && !isObj(raw)) return [{ field: f.id, error: 'type', label: f.label_ko }]
  const body = raw || {}
  if (Object.keys(body).length > LIMITS.rows) return [{ field: f.id, error: 'tooMany', label: f.label_ko }]
  for (const k of Object.keys(body)) if (!rows.includes(k)) return [{ field: f.id, error: 'option', label: f.label_ko }]
  let answered = 0
  const used = new Set()
  for (const r of rows) {
    const v = body[r]
    if (multi) {
      if (v != null && !Array.isArray(v)) return [{ field: f.id, error: 'type', label: f.label_ko }]
      const list = asArray(v)
      if (list.length > cols.length || list.some((x) => typeof x !== 'string' || !cols.includes(x)) || new Set(list).size !== list.length) {
        return [{ field: f.id, error: 'option', label: f.label_ko }]
      }
      if (list.length) answered += 1
    } else {
      if (v != null && typeof v !== 'string') return [{ field: f.id, error: 'type', label: f.label_ko }]
      if (v != null && v !== '') {
        if (!cols.includes(v)) return [{ field: f.id, error: 'option', label: f.label_ko }]
        answered += 1
        if (f.validation?.noDuplicate) {
          if (used.has(v)) errors.push({ field: f.id, error: 'gridDuplicate', label: f.label_ko })
          used.add(v)
        }
      }
    }
  }
  if (f.required && answered === 0) return [{ field: f.id, error: 'required', label: f.label_ko }]
  if (must && answered < rows.length) errors.push({ field: f.id, error: 'grid', label: f.label_ko })
  return errors
}

/** 정의에 없는 키를 버리고 거치는 쪽의 질문만 남긴다. 건너뛴 쪽의 질문은 값 없이 둔다(저장 안 함) */
export function pickData(fields, data) {
  const body = isObj(data) ? data : {}
  const reach = visibleIds(fields, body)
  const out = {}
  for (const f of asArray(fields)) {
    if (!f || f.type === 'section' || !reach.has(f.id)) continue
    const v = body[f.id]
    if (v === undefined) continue
    if (f.type === 'checkbox') out[f.id] = asArray(v).map(String)
    else if (f.type === 'checkbox_grid') {
      const o = {}
      for (const r of asArray(f.rows)) if (isObj(v) && Array.isArray(v[r])) o[r] = v[r].map(String)
      out[f.id] = o
    } else if (f.type === 'radio_grid') {
      const o = {}
      for (const r of asArray(f.rows)) if (isObj(v) && typeof v[r] === 'string' && v[r]) o[r] = v[r]
      out[f.id] = o
    } else out[f.id] = v
  }
  return out
}

// ───────────────────────── 퀴즈 채점 ─────────────────────────

export const quizOn = (settings) => settings?.quiz?.enabled === true

const norm = (s, ic) => {
  const t = String(s ?? '').trim().replace(/\s+/g, ' ')
  return ic ? t.toLowerCase() : t
}

export function isCorrectAnswer(f, raw) {
  const q = f.quiz
  if (!q || !q.correct?.length) return false
  const ic = q.ignoreCase !== false
  if (f.type === 'checkbox') {
    const got = [...new Set(asArray(raw).map((x) => norm(x, false)))].sort()
    const want = [...new Set(q.correct.map((x) => norm(x, false)))].sort()
    return got.length === want.length && got.every((x, i) => x === want[i])
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') return false
  const v = String(raw).trim()
  if (v === '') return false
  if (v.startsWith(OTHER_PREFIX)) return false
  if (q.numeric) {
    const n = toNum(v)
    return Number.isFinite(n) && q.correct.some((c) => toNum(c) === n)
  }
  if (f.type === 'radio' || f.type === 'select' || f.type === 'rating' || f.type === 'scale') return q.correct.some((c) => norm(c, false) === norm(v, false))
  return q.correct.some((c) => norm(c, ic) === norm(v, ic))
}

/**
 * 채점. 퀴즈가 꺼져 있으면 null. 거치게 된 질문만 점수에 들어간다.
 * @returns {{score:number,max:number,items:Object<string,{earned:number,max:number,correct:boolean}>}|null}
 */
export function gradeResponse(fields, data, settings) {
  if (!quizOn(settings)) return null
  const body = isObj(data) ? data : {}
  const reach = visibleIds(fields, body)
  const items = {}
  let score = 0
  let max = 0
  for (const f of asArray(fields)) {
    if (!f || f.type === 'section' || !reach.has(f.id)) continue
    const q = f.quiz
    if (!q || !(q.points > 0) || !q.correct?.length) continue
    const ok = isCorrectAnswer(f, body[f.id])
    items[f.id] = { earned: ok ? q.points : 0, max: q.points, correct: ok }
    max += q.points
    if (ok) score += q.points
  }
  return { score, max, items }
}

/** 응답자에게 점수를 보여 줘도 되는가 */
export function scoreVisible(settings) {
  const q = settings?.quiz
  if (!q?.enabled) return false
  return q.release === 'immediate' || (q.release === 'manual' && q.released === true)
}

/** 응답자에게 보낼 채점 결과(정답은 show_answers 일 때만) */
export function resultForResponder(fields, graded, settings) {
  if (!graded || !scoreVisible(settings)) return null
  const showAns = settings.quiz?.show_answers === true
  const rows = []
  for (const f of asArray(fields)) {
    const it = graded.items[f.id]
    if (!it) continue
    const q = f.quiz || {}
    rows.push({
      id: f.id,
      label: f.label_ko,
      correct: it.correct,
      earned: it.earned,
      max: it.max,
      feedback: it.correct ? q.feedback_correct || '' : q.feedback_incorrect || '',
      ...(showAns ? { answer: q.correct } : {}),
    })
  }
  return { score: graded.score, max: graded.max, items: rows }
}

// ───────────────────────── 저장 전 정의 검사 (한국어 메시지) ─────────────────────────

/** 편집기와 서버가 저장 전에 부르는 검사. 막아야 할 문제만 돌려준다 */
export function validateDefinition(fields, settings) {
  const issues = []
  const list = asArray(fields)
  if (list.length > LIMITS.fields) issues.push({ id: null, message: `질문은 ${LIMITS.fields}개까지 만들 수 있습니다` })
  if (list.filter((f) => f?.type === 'section').length > LIMITS.sections) issues.push({ id: null, message: `섹션은 ${LIMITS.sections}개까지 만들 수 있습니다` })
  const seen = new Set()
  for (const f of list) {
    const name = f?.label_ko || f?.id || '제목 없는 질문'
    if (seen.has(f?.id)) issues.push({ id: f?.id, message: `"${name}": 같은 id 가 두 번 쓰였습니다` })
    seen.add(f?.id)
    const v = f?.validation || {}
    if (v.rule?.kind === 'regex') {
      const bad = checkRegexSafe(v.rule.value)
      if (bad) issues.push({ id: f.id, message: `"${name}": ${bad}` })
    }
    if (v.rule?.kind === 'number' && ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between', 'notBetween'].includes(v.rule.op)) {
      if (!Number.isFinite(toNum(v.rule.value))) issues.push({ id: f.id, message: `"${name}": 숫자 조건의 기준값이 숫자가 아닙니다` })
      if (['between', 'notBetween'].includes(v.rule.op) && !Number.isFinite(toNum(v.rule.value2))) issues.push({ id: f.id, message: `"${name}": 숫자 조건의 두 번째 값이 숫자가 아닙니다` })
    }
    if (GRID_TYPES.includes(f?.type)) {
      const rows = asArray(f.rows)
      const cols = asArray(f.columns)
      if (!rows.length || !cols.length) issues.push({ id: f.id, message: `"${name}": 격자에는 행과 열이 1개 이상 필요합니다` })
      if (new Set(rows).size !== rows.length || new Set(cols).size !== cols.length) issues.push({ id: f.id, message: `"${name}": 행끼리, 열끼리 이름이 겹칩니다` })
      if (f.validation?.noDuplicate && rows.length > cols.length) issues.push({ id: f.id, message: `"${name}": 열마다 한 번만 고르게 하려면 열이 행 수 이상이어야 합니다` })
    }
    if (CHOICE_TYPES.includes(f?.type) || f?.type === 'checkbox') {
      const opts = asArray(f.options)
      if (v.other && opts.includes(OTHER_LABEL)) issues.push({ id: f.id, message: `"${name}": 보기에 이미 "기타"가 있어 기타 칸을 켤 수 없습니다` })
    }
    if (f?.quiz?.points > 0 && settings?.quiz?.enabled) {
      const correct = asArray(f.quiz.correct)
      if (!correct.length) issues.push({ id: f.id, message: `"${name}": 점수는 있는데 정답이 없습니다` })
      else if (['radio', 'select', 'checkbox'].includes(f.type)) {
        const opts = asArray(f.options)
        if (correct.some((c) => !opts.includes(c))) issues.push({ id: f.id, message: `"${name}": 정답이 보기에 없습니다` })
      }
    }
  }
  for (const it of analyzeFlow(list).issues) issues.push({ id: it.id ?? null, message: it.message })
  return issues
}

// ───────────────────────── 응답 시트 열과 요약 ─────────────────────────

/** 응답 표/CSV 의 열. 격자는 행마다 한 열 */
export function expandColumns(fields) {
  const cols = []
  for (const f of asArray(fields)) {
    if (!f || f.type === 'section') continue
    if (GRID_TYPES.includes(f.type)) {
      for (const r of asArray(f.rows)) cols.push({ key: `${f.id}::${r}`, label: `${f.label_ko} [${r}]`, field: f, row: r })
    } else cols.push({ key: f.id, label: f.label_ko, field: f, row: null })
  }
  return cols
}

export function cellValue(col, data) {
  const v = data?.[col.field.id]
  if (col.row == null) return v
  const cell = isObj(v) ? v[col.row] : undefined
  return Array.isArray(cell) ? cell.join(', ') : cell ?? ''
}

function pct(n, total) {
  return total ? Math.round((n / total) * 1000) / 10 : 0
}

/**
 * 집계만 만든다(개인 식별 값은 만들지 않는다). 화면 요약과 AI 도구가 같이 쓴다.
 * 문자 응답(text, textarea 등)과 식별 정보(연락처, 이메일, 학번, 파일)는 응답 수만 돌려준다.
 * @param {Array} fields
 * @param {Array<{data:object}>} items
 * @param {object} settings
 */
export function summarizeQuestion(f, items, settings) {
  const total = items.length
  const vals = items.map((r) => r?.data?.[f.id])
  const answered = vals.filter((v) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : v != null && v !== '')).length
  const base = { id: f.id, type: f.type, title: f.label_ko, answered, skipped: total - answered }
  const opts = asArray(f.options)
  if (f.type === 'radio' || f.type === 'select' || f.type === 'checkbox') {
    const m = new Map(opts.map((o) => [o, 0]))
    let other = 0
    for (const v of vals) {
      for (const x of asArray(Array.isArray(v) ? v : v == null || v === '' ? [] : [v])) {
        const s = String(x)
        if (m.has(s)) m.set(s, m.get(s) + 1)
        else other += 1
      }
    }
    const counts = [...m.entries()].map(([option, n]) => ({ option, n, pct: pct(n, answered) }))
    if (other) counts.push({ option: OTHER_LABEL, n: other, pct: pct(other, answered) })
    return { ...base, counts }
  }
  if (f.type === 'scale' || f.type === 'rating') {
    const { min, max } = f.type === 'rating' ? { min: 1, max: ratingMaxOf(f.validation) } : scaleRange(f.validation)
    const dist = []
    let sum = 0
    let n = 0
    for (let k = min; k <= max; k += 1) dist.push({ value: k, n: 0 })
    for (const v of vals) {
      const num = Number(v)
      if (v == null || v === '' || !Number.isInteger(num) || num < min || num > max) continue
      dist[num - min].n += 1
      sum += num
      n += 1
    }
    return { ...base, distribution: dist, mean: n ? Math.round((sum / n) * 100) / 100 : null }
  }
  if (GRID_TYPES.includes(f.type)) {
    const rows = asArray(f.rows).map((row) => {
      const cells = asArray(f.columns).map((column) => ({ column, n: 0 }))
      let respondents = 0
      for (const v of vals) {
        const cell = isObj(v) ? v[row] : undefined
        const list = Array.isArray(cell) ? cell : cell ? [cell] : []
        if (list.length) respondents += 1
        for (const c of list) {
          const hit = cells.find((x) => x.column === c)
          if (hit) hit.n += 1
        }
      }
      return { row, respondents, cells }
    })
    return { ...base, rows }
  }
  // 숫자 규칙이 걸린 단답은 통계만 낸다(값 목록은 내지 않는다)
  if (f.type === 'text' && (f.validation?.rule?.kind === 'number' || f.quiz?.numeric)) {
    const nums = vals.map((v) => (v == null || v === '' ? NaN : toNum(v))).filter(Number.isFinite).sort((a, b) => a - b)
    if (nums.length) {
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length
      const mid = Math.floor(nums.length / 2)
      const median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
      return { ...base, number: { n: nums.length, min: nums[0], max: nums[nums.length - 1], mean: Math.round(mean * 100) / 100, median } }
    }
    return { ...base, number: { n: 0 } }
  }
  return base
}

export function summarizeQuiz(fields, items, settings) {
  if (!quizOn(settings)) return null
  const scores = []
  const perQ = new Map()
  let maxScore = 0
  for (const r of items) {
    const g = r?.data?._quiz
    if (!isObj(g) || typeof g.score !== 'number') continue
    scores.push(g.score)
    maxScore = Math.max(maxScore, Number(g.max) || 0)
    for (const [id, it] of Object.entries(isObj(g.items) ? g.items : {})) {
      const e = perQ.get(id) || { n: 0, ok: 0 }
      e.n += 1
      if (it?.correct) e.ok += 1
      perQ.set(id, e)
    }
  }
  const mean = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null
  const buckets = []
  if (maxScore > 0) {
    for (let b = 0; b < 5; b += 1) {
      const lo = (maxScore * b) / 5
      const hi = (maxScore * (b + 1)) / 5
      buckets.push({ range: `${Math.round(lo)}~${Math.round(hi)}`, n: scores.filter((s) => (b === 4 ? s >= lo && s <= hi : s >= lo && s < hi)).length })
    }
  }
  const questions = asArray(fields)
    .filter((f) => perQ.has(f.id))
    .map((f) => ({ id: f.id, title: f.label_ko, graded: perQ.get(f.id).n, correct: perQ.get(f.id).ok, pctCorrect: pct(perQ.get(f.id).ok, perQ.get(f.id).n) }))
  return { n: scores.length, mean, max: maxScore, buckets, questions }
}

export function estimateMinutes(fields) {
  let sec = 0
  for (const f of asArray(fields)) {
    if (!f || f.type === 'section') continue
    if (f.type === 'textarea') sec += 60
    else if (f.type === 'text') sec += 20
    else if (GRID_TYPES.includes(f.type)) sec += 8 * Math.max(1, asArray(f.rows).length)
    else if (f.type === 'file') sec += 45
    else sec += 10
  }
  return Math.max(1, Math.round(sec / 60))
}
