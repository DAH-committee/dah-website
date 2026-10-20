// DAH Form AI 도구. 계약서: client/src/components/ai/README.md
//
// 구성
//   순수 함수(DOM 없음, node --test 가능): form 객체({title_ko, description_ko, fields, settings, published})를 받아 새 form 을 돌려주는 op*,
//     읽기(readForm), 점검(lintForm), 집계(responseStats), 응답 글 읽기(textResponses)
//   createFormTools(host): 편집기에 묶는 Tool[] 을 만든다. 바꾸기는 host.apply 한 번(= 되돌리기 한 단계)이다.
//
// 지키는 규칙
//   - 모델 인자는 믿지 않는다: 타입 확인, 길이/개수 제한, 허용 목록 밖 값은 거절하고 form 은 그대로 둔다.
//   - 질문 id 는 짧고 안정적이다(기존 id 그대로, 새 질문은 q1, q2 ... 섹션은 s1, s2 ...).
//   - 응답 개인정보: host.getItems() 는 이미 {data, day} 만 준다(계정, 시각 제거). 이 파일은 식별 값(연락처, 이메일, 학번, 파일, 이름 질문)을 어떤 도구로도 내보내지 않는다.
//     응답 글은 get_text_responses 로만, 사용자가 켠 스위치가 있을 때만 나가고 이메일/전화/학번 모양은 가린다.
import {
  CHOICE_TYPES, FIELD_TYPES, GRID_TYPES, LIMITS, OTHER_LABEL, analyzeFlow, buildPages, checkRegexSafe, cleanQuiz, cleanSettingsQuiz, cleanValidation,
  estimateMinutes, ratingMaxOf, scaleRange, summarizeQuestion, summarizeQuiz, validateDefinition, visibleIds,
} from '../../components/forms/formLogic.js'

class ToolError extends Error {}
const fail = (m) => {
  throw new ToolError(m)
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const cleanStr = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\r\n?/g, '\n').replace(CTRL, '').trim().slice(0, max) : null)
const clampInt = (v, lo, hi, d) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

export const AI_TYPES = FIELD_TYPES.filter((t) => t !== 'section' && t !== 'file')
const OPTION_TYPES = ['select', 'radio', 'checkbox']
const MAX_AI_OPTIONS = 100
const PERSONAL_TYPES = ['phone', 'email', 'studentid', 'file']
const PERSONAL_LABEL = /이름|성명|name|전화|연락처|휴대|핸드폰|이메일|e-?mail|학번|주민|생년|생일|주소|계좌/i

// ───────────────────────── 보조 ─────────────────────────

export function nextId(fields, prefix) {
  const used = new Set(fields.map((f) => f.id))
  let n = fields.length + 1
  while (used.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}
const findIdx = (fields, id) => fields.findIndex((f) => f.id === id)
const need = (fields, id, what = '질문') => {
  const i = findIdx(fields, typeof id === 'string' ? id : '')
  if (i < 0) fail(`${what} id "${String(id).slice(0, 40)}" 가 없습니다. read_form 으로 id 를 확인하세요`)
  return i
}
const withFields = (form, fields) => ({ ...form, fields })

/** 섹션 참조(id 또는 쪽 번호)를 섹션 필드 id 로 */
export function resolveSection(fields, ref) {
  if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref))) {
    const pages = buildPages(fields)
    const p = pages[Number(ref) - 1]
    if (!p?.section) fail(`${ref}쪽에는 섹션이 없습니다(첫 쪽이거나 범위 밖)`)
    return p.section.id
  }
  const f = fields.find((x) => x.id === ref && x.type === 'section')
  if (!f) fail(`섹션 "${String(ref).slice(0, 40)}" 를 찾지 못했습니다`)
  return f.id
}
function targetOf(fields, v) {
  if (v === 'submit' || v === '제출') return 'submit'
  if (v == null || v === 'next' || v === '' || v === '다음') return null
  return `section:${resolveSection(fields, v)}`
}

const baseField = (id, type) => ({
  id, label_ko: '', label_en: '', type, required: false, placeholder_ko: '', placeholder_en: '', hint_ko: '', hint_en: '',
  options: [], options_en: [], validation: {}, order: 0,
})

function cleanOptions(v, label = '보기') {
  if (!Array.isArray(v)) fail(`${label} 는 문자열 배열이어야 합니다`)
  const out = []
  for (const x of v.slice(0, MAX_AI_OPTIONS)) {
    const s = cleanStr(x, LIMITS.optionLen)
    if (s) out.push(s)
  }
  if (new Set(out).size !== out.length) fail(`${label} 에 같은 이름이 겹칩니다`)
  return out
}

function applyValidation(type, current, patch) {
  if (patch == null) return current
  if (!isObj(patch)) fail('validation 은 객체여야 합니다')
  // 허용 키만 통과시키고 값은 cleanValidation 이 다듬는다
  const allowed = ['rule', 'shuffle', 'other', 'noDuplicate', 'requireEachRow', 'maxLength', 'ratingMax', 'ratingIcon']
  const merged = { ...current }
  for (const k of allowed) {
    if (patch[k] === undefined) continue
    if (patch[k] === null) delete merged[k]
    else merged[k] = patch[k]
  }
  const clean = cleanValidation({ ...current, ...merged }, type)
  const out = { ...clean }
  // 예전 눈금 키는 보존
  for (const k of ['scaleMin', 'scaleMax', 'scaleMinLabel', 'scaleMaxLabel']) if (current[k] !== undefined && out[k] === undefined) out[k] = current[k]
  if (merged.rule && !clean.rule) fail('validation.rule 형식이 맞지 않습니다(kind, op 확인)')
  if (clean.rule?.kind === 'regex') {
    const bad = checkRegexSafe(clean.rule.value)
    if (bad) fail(`validation.rule 정규식을 쓸 수 없습니다: ${bad}`)
  }
  return out
}

function applyScale(f, scale) {
  if (scale == null) return f
  if (!isObj(scale)) fail('scale 은 객체여야 합니다')
  const v = { ...f.validation }
  if (f.type === 'scale') {
    if (scale.min !== undefined) v.scaleMin = Number(scale.min) === 0 ? 0 : 1
    if (scale.max !== undefined) v.scaleMax = clampInt(scale.max, 2, 10, 5)
  }
  if (f.type === 'rating') {
    if (scale.levels !== undefined) v.ratingMax = clampInt(scale.levels, 3, 10, 5)
    if (scale.max !== undefined && scale.levels === undefined) v.ratingMax = clampInt(scale.max, 3, 10, 5)
    if (scale.icon !== undefined) v.ratingIcon = ['star', 'heart', 'thumb'].includes(scale.icon) ? scale.icon : 'star'
  }
  if (scale.minLabel !== undefined) v.scaleMinLabel = cleanStr(scale.minLabel, 60) ?? ''
  if (scale.maxLabel !== undefined) v.scaleMaxLabel = cleanStr(scale.maxLabel, 60) ?? ''
  if (!['scale', 'rating'].includes(f.type)) fail('scale 은 선형 배율/평점 질문에만 쓸 수 있습니다')
  return { ...f, validation: v }
}

/** 질문 하나를 만든다(스펙 검증 포함). 위치는 호출한 쪽이 정한다 */
export function buildQuestion(fields, spec, id) {
  if (!isObj(spec)) fail('질문 정의가 객체가 아닙니다')
  const type = spec.type
  if (!AI_TYPES.includes(type)) fail(`지원하지 않는 유형 "${String(type).slice(0, 30)}". 쓸 수 있는 유형: ${AI_TYPES.join(', ')}`)
  const title = cleanStr(spec.title, LIMITS.label)
  if (!title) fail('질문 제목(title)이 필요합니다')
  let f = { ...baseField(id, type), label_ko: title, required: spec.required === true }
  const desc = cleanStr(spec.description, LIMITS.hint)
  if (desc) f.hint_ko = desc
  if (OPTION_TYPES.includes(type)) {
    f.options = cleanOptions(spec.options ?? fail(`${type} 질문에는 options 가 필요합니다`))
    if (!f.options.length) fail('options 가 비어 있습니다')
  } else if (spec.options !== undefined && spec.options !== null) fail(`${type} 질문에는 options 를 쓸 수 없습니다`)
  if (GRID_TYPES.includes(type)) {
    f.rows = cleanOptions(spec.rows ?? fail('격자에는 rows 가 필요합니다'), '행')
    f.columns = cleanOptions(spec.columns ?? fail('격자에는 columns 가 필요합니다'), '열')
    if (!f.rows.length || !f.columns.length) fail('rows 와 columns 가 비어 있습니다')
    if (f.rows.length > LIMITS.rows || f.columns.length > LIMITS.columns) fail('행은 50개, 열은 20개까지입니다')
  }
  if (type === 'scale') f.validation = { scaleMin: 1, scaleMax: 5, scaleMinLabel: '', scaleMaxLabel: '' }
  if (type === 'rating') f.validation = { ratingMax: 5, ratingIcon: 'star' }
  f = applyScale(f, spec.scale)
  f.validation = applyValidation(type, f.validation, spec.validation)
  return f
}

function insertIndex(fields, { after, section } = {}) {
  if (after != null && after !== '') {
    if (after === 'start') return 0
    return need(fields, after, '위치 기준') + 1
  }
  if (section != null && section !== '') {
    const sid = resolveSection(fields, section)
    const at = findIdx(fields, sid)
    let end = fields.length
    for (let i = at + 1; i < fields.length; i += 1) if (fields[i].type === 'section') { end = i; break }
    return end
  }
  return fields.length
}

/** 분기 점검: 이전에 없던 되돌아가기/없는 섹션 문제가 생기면 거절한다 */
function guardFlow(beforeFields, afterFields) {
  const key = (it) => `${it.code}:${it.message}`
  const had = new Set(analyzeFlow(beforeFields).issues.map(key))
  const added = analyzeFlow(afterFields).issues.filter((it) => (it.code === 'back' || it.code === 'missing') && !had.has(key(it)))
  if (added.length) fail(`이 변경은 분기를 망가뜨립니다: ${added[0].message}`)
}
function flowWarnings(fields) {
  return analyzeFlow(fields).issues.filter((it) => it.code === 'unreachable').map((it) => it.message)
}
/** 섹션이 사라지거나 보기 이름이 바뀐 뒤 남은 분기 참조 정리 */
function pruneLogic(fields) {
  const sections = new Set(fields.filter((f) => f.type === 'section').map((f) => `section:${f.id}`))
  let removed = 0
  const out = fields.map((f) => {
    if (!f.logic) return f
    const keep = (t) => t === 'submit' || sections.has(t)
    if (f.type === 'section') {
      if (f.logic.after && !keep(f.logic.after)) {
        removed += 1
        const { logic: _l, ...rest } = f
        return rest
      }
      return f
    }
    const opts = {}
    for (const [k, t] of Object.entries(f.logic.options || {})) {
      if (keep(t) && ((f.options || []).includes(k) || (k === OTHER_LABEL && f.validation?.other))) opts[k] = t
      else removed += 1
    }
    if (!Object.keys(opts).length) {
      const { logic: _l, ...rest } = f
      return rest
    }
    return { ...f, logic: { options: opts } }
  })
  return { fields: out, removed }
}

// ───────────────────────── 읽기 ─────────────────────────

export function compactQuestion(f) {
  const q = { id: f.id, type: f.type, title: f.label_ko || '', required: f.required === true }
  if (f.hint_ko) q.description = f.hint_ko
  if (OPTION_TYPES.includes(f.type)) q.options = f.options || []
  if (GRID_TYPES.includes(f.type)) {
    q.rows = f.rows || []
    q.columns = f.columns || []
  }
  const v = f.validation || {}
  if (f.type === 'scale') {
    const { min, max } = scaleRange(v)
    q.scale = { min, max, minLabel: v.scaleMinLabel || '', maxLabel: v.scaleMaxLabel || '' }
  }
  if (f.type === 'rating') q.rating = { levels: ratingMaxOf(v), icon: v.ratingIcon || 'star', minLabel: v.scaleMinLabel || '', maxLabel: v.scaleMaxLabel || '' }
  const val = {}
  for (const k of ['rule', 'shuffle', 'other', 'noDuplicate', 'requireEachRow', 'maxLength']) if (v[k] !== undefined) val[k] = v[k]
  if (Object.keys(val).length) q.validation = val
  if (f.logic?.options) q.logic = f.logic.options
  if (f.quiz) q.quiz = f.quiz
  return q
}

export function readForm(form, { responseCount = 0, selectedId = null } = {}) {
  const pages = buildPages(form.fields)
  const s = form.settings || {}
  return {
    title: form.title_ko || '',
    description: form.description_ko || '',
    settings: {
      accepting: form.published === true,
      confirmation: s.confirmation_ko || '',
      quiz: cleanSettingsQuiz(s.quiz),
      max_responses: s.max_responses === '' || s.max_responses == null ? null : Number(s.max_responses),
      google_login_required: s.require_google_auth !== false,
    },
    estimated_minutes: estimateMinutes(form.fields),
    question_count: form.fields.filter((f) => f.type !== 'section').length,
    selected: selectedId,
    sections: pages.map((p, i) => ({
      number: i + 1,
      id: p.section?.id || 'start',
      title: p.section?.label_ko || (p.section ? '' : '(첫 쪽)'),
      ...(p.section?.hint_ko ? { description: p.section.hint_ko } : {}),
      ...(p.section?.logic?.after ? { after: p.section.logic.after } : {}),
      questions: p.fields.map(compactQuestion),
    })),
    response_count: responseCount,
  }
}

// ───────────────────────── 바꾸기 (순수 함수: form -> { form, result, summary }) ─────────────────────────

export function opAddQuestion(form, a) {
  if (!isObj(a)) fail('인자가 필요합니다')
  const id = nextId(form.fields, 'q')
  const f = buildQuestion(form.fields, a, id)
  const at = insertIndex(form.fields, { after: a.after, section: a.section })
  const fields = [...form.fields]
  fields.splice(at, 0, f)
  return { form: withFields(form, fields), result: { id, index: at }, summary: `질문 추가: ${f.label_ko.slice(0, 24)}` }
}

export function opEditQuestion(form, a) {
  if (!isObj(a)) fail('인자가 필요합니다')
  const i = need(form.fields, a.id)
  let f = { ...form.fields[i] }
  if (f.type === 'section') fail('섹션은 add_section/set_branching 으로 다룹니다. 섹션 제목은 set_section 대신 delete 후 다시 추가하세요')
  const changed = []
  if (a.type !== undefined && a.type !== f.type) {
    if (!AI_TYPES.includes(a.type)) fail(`지원하지 않는 유형 "${String(a.type).slice(0, 30)}"`)
    const old = f.type
    f.type = a.type
    f.validation = a.type === 'scale' ? { scaleMin: 1, scaleMax: 5, scaleMinLabel: '', scaleMaxLabel: '' } : a.type === 'rating' ? { ratingMax: 5, ratingIcon: 'star' } : {}
    if (OPTION_TYPES.includes(a.type) && !f.options?.length) f.options = []
    if (!OPTION_TYPES.includes(a.type)) f.options = []
    if (GRID_TYPES.includes(a.type)) {
      f.rows = f.rows?.length ? f.rows : ['행 1']
      f.columns = f.columns?.length ? f.columns : ['열 1', '열 2']
    } else {
      delete f.rows
      delete f.columns
    }
    if (!CHOICE_TYPES.includes(a.type)) delete f.logic
    delete f.quiz
    changed.push(`유형 ${old} -> ${a.type}`)
  }
  if (a.title !== undefined) {
    const t = cleanStr(a.title, LIMITS.label)
    if (!t) fail('title 이 비어 있습니다')
    f.label_ko = t
    changed.push('제목')
  }
  if (a.description !== undefined) {
    f.hint_ko = cleanStr(a.description, LIMITS.hint) ?? ''
    changed.push('설명')
  }
  if (a.required !== undefined) {
    f.required = a.required === true
    changed.push('필수')
  }
  if (a.options !== undefined) {
    if (!OPTION_TYPES.includes(f.type)) fail('이 유형에는 options 가 없습니다')
    f.options = cleanOptions(a.options)
    if (!f.options.length) fail('options 가 비어 있습니다')
    changed.push('보기')
  } else if (OPTION_TYPES.includes(f.type) && !f.options.length) fail('선택형 질문에는 options 가 필요합니다. options 를 함께 주세요')
  if (a.rows !== undefined || a.columns !== undefined) {
    if (!GRID_TYPES.includes(f.type)) fail('rows/columns 는 격자 질문에만 쓸 수 있습니다')
    if (a.rows !== undefined) f.rows = cleanOptions(a.rows, '행')
    if (a.columns !== undefined) f.columns = cleanOptions(a.columns, '열')
    if (!f.rows.length || !f.columns.length) fail('rows 와 columns 가 비어 있습니다')
    changed.push('행/열')
  }
  if (a.scale !== undefined) {
    f = applyScale(f, a.scale)
    changed.push('눈금')
  }
  if (a.validation !== undefined) {
    f.validation = applyValidation(f.type, f.validation || {}, a.validation)
    changed.push('검증')
  }
  if (!changed.length) fail('바꿀 항목이 없습니다')
  // 보기가 바뀌면 남은 분기와 정답에서 사라진 보기를 정리한다
  if (f.logic?.options) {
    const opts = Object.fromEntries(Object.entries(f.logic.options).filter(([k]) => (f.options || []).includes(k) || (k === OTHER_LABEL && f.validation?.other)))
    if (Object.keys(opts).length) f.logic = { options: opts }
    else delete f.logic
  }
  if (f.quiz && OPTION_TYPES.includes(f.type)) f.quiz = { ...f.quiz, correct: (f.quiz.correct || []).filter((c) => f.options.includes(c)) }
  const fields = form.fields.map((x, idx) => (idx === i ? f : x))
  return { form: withFields(form, fields), result: { id: f.id, changed }, summary: `질문 고침: ${f.label_ko.slice(0, 24)}` }
}

export function opDeleteQuestion(form, a) {
  const i = need(form.fields, a?.id, '질문/섹션')
  const f = form.fields[i]
  const rest = form.fields.filter((_, idx) => idx !== i)
  const { fields, removed } = pruneLogic(rest)
  return {
    form: withFields(form, fields),
    result: { deleted: f.id, kind: f.type === 'section' ? 'section' : 'question', removed_branch_refs: removed },
    summary: `${f.type === 'section' ? '섹션' : '질문'} 삭제: ${(f.label_ko || f.id).slice(0, 24)}`,
  }
}

export function opMoveQuestion(form, a) {
  const i = need(form.fields, a?.id)
  if (form.fields[i].type === 'section') fail('섹션은 옮길 수 없습니다. 질문만 옮길 수 있습니다')
  const rest = form.fields.filter((_, idx) => idx !== i)
  const at = a.after === 'start' ? 0 : need(rest, a.after, '위치 기준') + 1
  if (a.after === a.id) fail('자기 자신 뒤로는 옮길 수 없습니다')
  const fields = [...rest]
  fields.splice(at, 0, form.fields[i])
  guardFlow(form.fields, fields)
  return { form: withFields(form, fields), result: { id: a.id, index: at, warnings: flowWarnings(fields) }, summary: `질문 이동: ${(form.fields[i].label_ko || a.id).slice(0, 24)}` }
}

export function opAddSection(form, a) {
  const title = cleanStr(a?.title, LIMITS.label)
  if (!title) fail('섹션 title 이 필요합니다')
  if (form.fields.filter((f) => f.type === 'section').length >= LIMITS.sections) fail(`섹션은 ${LIMITS.sections}개까지입니다`)
  const id = nextId(form.fields, 's')
  const sec = { ...baseField(id, 'section'), label_ko: title, hint_ko: cleanStr(a.description, LIMITS.hint) ?? '' }
  const at = a.after != null && a.after !== '' ? (a.after === 'start' ? 0 : need(form.fields, a.after, '위치 기준') + 1) : form.fields.length
  const fields = [...form.fields]
  fields.splice(at, 0, sec)
  guardFlow(form.fields, fields)
  return { form: withFields(form, fields), result: { id, number: buildPages(fields).findIndex((p) => p.section?.id === id) + 1 }, summary: `섹션 추가: ${title.slice(0, 24)}` }
}

export function opSetBranching(form, a) {
  if (!isObj(a)) fail('인자가 필요합니다')
  const i = need(form.fields, a.question_id, '질문/섹션')
  const f = form.fields[i]
  if (!isObj(a.option_to_section)) fail('option_to_section 은 {보기: 섹션 id | 쪽 번호 | "submit" | "next"} 객체여야 합니다')
  const entries = Object.entries(a.option_to_section).slice(0, LIMITS.options + 1)
  let next
  const warnings = []
  if (f.type === 'section') {
    const t = targetOf(form.fields, a.option_to_section['*'] ?? a.option_to_section.after)
    const { logic: _l, ...rest } = f
    next = t ? { ...rest, logic: { after: t } } : rest
  } else {
    if (!CHOICE_TYPES.includes(f.type)) fail('분기는 객관식/드롭다운 질문에만 걸 수 있습니다')
    const opts = {}
    for (const [opt, ref] of entries) {
      if (!(f.options || []).includes(opt) && !(opt === OTHER_LABEL && f.validation?.other)) fail(`보기 "${opt.slice(0, 40)}" 가 이 질문에 없습니다`)
      const t = targetOf(form.fields, ref)
      if (t) opts[opt] = t
    }
    const { logic: _l, ...rest } = f
    next = Object.keys(opts).length ? { ...rest, logic: { options: opts } } : rest
    if (!f.required && Object.keys(opts).length) warnings.push('이 질문이 필수가 아니면 답하지 않은 응답자는 분기를 타지 않고 다음 섹션으로 갑니다. required 를 켜는 것을 권합니다')
  }
  const fields = form.fields.map((x, idx) => (idx === i ? next : x))
  guardFlow(form.fields, fields)
  return {
    form: withFields(form, fields),
    result: { question_id: f.id, logic: next.logic ?? null, warnings: [...warnings, ...flowWarnings(fields)] },
    summary: `분기 ${next.logic ? '설정' : '해제'}: ${(f.label_ko || f.id).slice(0, 24)}`,
  }
}

export function opSetQuiz(form, a) {
  if (!isObj(a)) fail('인자가 필요합니다')
  const cur = cleanSettingsQuiz(form.settings?.quiz)
  const next = { ...cur }
  if (a.enabled !== undefined) next.enabled = a.enabled === true
  if (a.release !== undefined) {
    if (!['immediate', 'manual', 'never'].includes(a.release)) fail('release 는 immediate | manual | never 입니다')
    next.release = a.release
  }
  if (a.released !== undefined) next.released = a.released === true
  if (a.show_answers !== undefined) next.show_answers = a.show_answers === true
  return {
    form: { ...form, settings: { ...form.settings, quiz: next } },
    result: { quiz: next },
    summary: next.enabled ? '퀴즈 모드 켬' : '퀴즈 모드 끔',
  }
}

export function opSetAnswerKey(form, a) {
  if (!isObj(a)) fail('인자가 필요합니다')
  const i = need(form.fields, a.question_id)
  const f = form.fields[i]
  if (!['radio', 'select', 'checkbox', 'text', 'scale', 'rating'].includes(f.type)) fail('이 유형은 채점할 수 없습니다(객관식, 드롭다운, 체크박스, 단답형, 눈금, 평점만)')
  const points = clampInt(a.points, 0, LIMITS.points, NaN)
  if (!Number.isFinite(points)) fail('points 는 0~1000 정수여야 합니다')
  const raw = Array.isArray(a.correct) ? a.correct : a.correct == null ? [] : [a.correct]
  const correct = raw.slice(0, LIMITS.keys).map((x) => cleanStr(x, LIMITS.optionLen)).filter((x) => x !== null && x !== '')
  if (points > 0 && !correct.length) fail('correct(정답)이 필요합니다')
  if (['radio', 'select'].includes(f.type) && correct.length !== 1 && points > 0) fail('단일 선택 질문의 정답은 하나입니다')
  if (OPTION_TYPES.includes(f.type) && correct.some((c) => !(f.options || []).includes(c))) fail('정답이 보기에 없습니다. 보기 글자를 그대로 쓰세요')
  if (f.type === 'scale' || f.type === 'rating') {
    const { min, max } = f.type === 'rating' ? { min: 1, max: ratingMaxOf(f.validation) } : scaleRange(f.validation)
    if (correct.some((c) => !/^\d+$/.test(c) || Number(c) < min || Number(c) > max)) fail(`정답은 ${min}~${max} 정수여야 합니다`)
  }
  const fb = isObj(a.feedback) ? a.feedback : {}
  const quiz = cleanQuiz({
    points, correct,
    ignoreCase: a.ignore_case !== false,
    numeric: a.numeric === true,
    feedback_correct: a.feedback_correct ?? fb.correct,
    feedback_incorrect: a.feedback_incorrect ?? fb.incorrect,
  })
  const fields = form.fields.map((x, idx) => {
    if (idx !== i) return x
    if (!quiz) {
      const { quiz: _q, ...rest } = x
      return rest
    }
    return { ...x, quiz }
  })
  const warnings = form.settings?.quiz?.enabled ? [] : ['퀴즈 모드가 꺼져 있어 채점되지 않습니다. set_quiz 로 켜세요']
  return { form: withFields(form, fields), result: { question_id: f.id, quiz: quiz ?? null, warnings }, summary: `정답 설정: ${(f.label_ko || f.id).slice(0, 24)} (${points}점)` }
}

export function opSetSettings(form, a) {
  if (!isObj(a)) fail('인자가 필요합니다')
  const next = { ...form, settings: { ...form.settings } }
  const changed = []
  if (a.title !== undefined) {
    const t = cleanStr(a.title, 200)
    if (!t) fail('title 이 비어 있습니다')
    next.title_ko = t
    changed.push('제목')
  }
  if (a.description !== undefined) {
    next.description_ko = cleanStr(a.description, 4000) ?? ''
    changed.push('설명')
  }
  if (a.confirmation !== undefined) {
    next.settings.confirmation_ko = cleanStr(a.confirmation, 1000) ?? ''
    changed.push('완료 문구')
  }
  if (a.accepting !== undefined) {
    next.published = a.accepting === true
    changed.push(next.published ? '응답 받기 켬' : '응답 받기 끔')
  }
  if (!changed.length) fail('바꿀 항목이 없습니다')
  return { form: next, result: { changed, note: '저장 버튼을 눌러야 서버에 반영됩니다' }, summary: `설정 변경: ${changed.join(', ')}` }
}

/** 한 번에 여러 섹션과 질문을 만든다. 분기 대상 섹션은 이 호출 안의 번호(1부터)로 가리킨다 */
export function opGenerate(form, a) {
  if (!isObj(a) || !Array.isArray(a.sections) || !a.sections.length) fail('sections 배열이 필요합니다')
  if (a.sections.length > 20) fail('한 번에 섹션 20개까지 만들 수 있습니다')
  const replace = a.mode === 'replace'
  let fields = replace ? [] : [...form.fields]
  const startLen = fields.length
  const single = a.sections.length === 1 && !cleanStr(a.sections[0]?.title, 10)
  const secIds = []
  let total = 0
  // 1차: 섹션과 질문 만들기
  const planned = []
  for (const [si, sp] of a.sections.entries()) {
    if (!isObj(sp)) fail(`sections[${si}] 가 객체가 아닙니다`)
    if (!Array.isArray(sp.questions)) fail(`sections[${si}].questions 배열이 필요합니다`)
    if (sp.questions.length > 40) fail(`섹션당 질문은 40개까지입니다(sections[${si}])`)
    total += sp.questions.length
    if (total > 150) fail('한 번에 질문 150개까지 만들 수 있습니다')
    let sid = null
    if (!single) {
      sid = nextId([...fields, ...planned.map((p) => p.f)], 's')
      const sec = { ...baseField(sid, 'section'), label_ko: cleanStr(sp.title, LIMITS.label) || `섹션 ${si + 1}`, hint_ko: cleanStr(sp.description, LIMITS.hint) ?? '' }
      planned.push({ f: sec, sp, si, kind: 'section' })
    }
    secIds.push(sid)
    for (const [qi, qs] of sp.questions.entries()) {
      const id = nextId([...fields, ...planned.map((p) => p.f)], 'q')
      let f
      try {
        f = buildQuestion([], qs, id)
      } catch (e) {
        throw new ToolError(`sections[${si}].questions[${qi}]: ${e.message}`)
      }
      planned.push({ f, qs, si, qi, kind: 'question' })
    }
  }
  fields = [...fields, ...planned.map((p) => p.f)]
  // 2차: 분기와 정답
  const refSec = (v) => {
    if (v === 'submit') return 'submit'
    if (v == null || v === 'next') return null
    const n = Number(v)
    if (!Number.isInteger(n) || n < 1 || n > secIds.length || !secIds[n - 1]) fail(`분기 대상 섹션 번호 "${String(v).slice(0, 20)}" 가 범위 밖입니다(1~${secIds.length}, 섹션이 둘 이상일 때만 분기 가능)`)
    return `section:${secIds[n - 1]}`
  }
  fields = fields.map((f) => {
    const p = planned.find((x) => x.f.id === f.id)
    if (!p) return f
    let out = f
    if (p.kind === 'section' && p.sp.after != null) {
      const t = refSec(p.sp.after)
      if (t) out = { ...out, logic: { after: t } }
    }
    if (p.kind === 'question') {
      if (p.qs.branch != null) {
        if (!isObj(p.qs.branch)) fail('branch 는 {보기: 섹션 번호 | "submit"} 객체여야 합니다')
        if (!CHOICE_TYPES.includes(f.type)) fail(`분기는 객관식/드롭다운만 가능합니다: "${f.label_ko.slice(0, 24)}"`)
        const opts = {}
        for (const [opt, ref] of Object.entries(p.qs.branch)) {
          if (!f.options.includes(opt) && !(opt === OTHER_LABEL && f.validation?.other)) fail(`분기 보기 "${opt.slice(0, 30)}" 가 "${f.label_ko.slice(0, 24)}" 에 없습니다`)
          const t = refSec(ref)
          if (t) opts[opt] = t
        }
        if (Object.keys(opts).length) out = { ...out, logic: { options: opts }, required: true }
      }
      if (p.qs.quiz != null) {
        if (!isObj(p.qs.quiz)) fail('quiz 는 객체여야 합니다')
        const tmp = opSetAnswerKey({ ...form, fields }, { ...p.qs.quiz, question_id: f.id })
        out = { ...out, quiz: tmp.form.fields.find((x) => x.id === f.id).quiz }
      }
    }
    return out
  })
  const hasQuiz = planned.some((p) => p.kind === 'question' && p.qs.quiz != null)
  fields = fields.map((f, i) => ({ ...f, order: i + 1 }))
  const nextForm = {
    ...form,
    title_ko: a.title !== undefined ? cleanStr(a.title, 200) || form.title_ko : form.title_ko,
    description_ko: a.description !== undefined ? cleanStr(a.description, 4000) ?? '' : form.description_ko,
    fields,
    settings: hasQuiz ? { ...form.settings, quiz: { ...cleanSettingsQuiz(form.settings?.quiz), enabled: true } } : form.settings,
  }
  const issues = validateDefinition(fields, nextForm.settings).filter((it) => /돌아갑니다|없는 섹션|겹칩니다|정규식|정답/.test(it.message))
  if (issues.length) fail(`만든 내용에 문제가 있어 적용하지 않았습니다: ${issues[0].message}`)
  const qn = planned.filter((p) => p.kind === 'question').length
  return {
    form: nextForm,
    result: {
      created_questions: qn,
      created_sections: planned.filter((p) => p.kind === 'section').length,
      mode: replace ? 'replace' : 'append',
      first_new_index: startLen,
      quiz_enabled: nextForm.settings?.quiz?.enabled === true,
      ids: planned.map((p) => p.f.id),
      warnings: flowWarnings(fields),
    },
    summary: `설문 생성: 질문 ${qn}개${planned.some((p) => p.kind === 'section') ? `, 섹션 ${planned.filter((p) => p.kind === 'section').length}개` : ''}`,
  }
}

// ───────────────────────── 점검 ─────────────────────────

const LEADING = /(당연히|분명히?|확실히|누구나|물론|훌륭한|형편없|최악|최고의|대단한|아주 좋은|문제없|~?하지 않습니까|않으십니까|않나요\?|아니십니까)/
const DOUBLE_BARREL = /(\s(및|그리고|혹은|또는)\s|\band\b)/i

export function lintForm(form, { responseCount = 0 } = {}) {
  const out = []
  const add = (id, level, code, message, fix) => out.push({ id: id ?? null, level, code, message, ...(fix ? { fix } : {}) })
  const qs = form.fields.filter((f) => f.type !== 'section')
  const mins = estimateMinutes(form.fields)
  if (!qs.length) add(null, 'error', 'empty', '질문이 없습니다', '질문을 추가하세요')
  if (mins > 10) add(null, 'warn', 'too_long', `예상 소요 시간이 약 ${mins}분입니다. 10분을 넘으면 중도 이탈이 늘어납니다`, '꼭 필요한 질문만 남기거나 섹션으로 나누고 선택 질문을 늘리세요')
  else if (qs.length > 25) add(null, 'warn', 'many_questions', `질문이 ${qs.length}개입니다`, '핵심 질문 위주로 줄이세요')
  if (responseCount > 0) add(null, 'info', 'has_responses', `이미 응답이 ${responseCount}건 있습니다. 질문이나 보기를 바꾸면 기존 응답과 어긋날 수 있습니다`)
  const intro = `${form.title_ko || ''} ${form.description_ko || ''}`
  const hasPurpose = /(목적|용도|수집|이용|활용|보관|파기|개인정보|동의)/.test(intro)
  let personalMissing = false
  const flowIssues = analyzeFlow(form.fields).issues
  const seenTitles = new Map()
  for (const f of qs) {
    const t = f.label_ko || ''
    const name = t.slice(0, 30) || f.id
    if (!t.trim()) add(f.id, 'error', 'no_title', '질문 제목이 비어 있습니다', '제목을 쓰세요')
    if (t && seenTitles.has(t)) add(f.id, 'warn', 'dup_title', `"${name}" 와 같은 제목의 질문이 있습니다 (${seenTitles.get(t)})`, '하나로 합치거나 제목을 구분하세요')
    else seenTitles.set(t, f.id)
    if (OPTION_TYPES.includes(f.type)) {
      const opts = f.options || []
      if (opts.some((o) => !String(o).trim())) add(f.id, 'error', 'empty_option', `"${name}" 에 빈 보기가 있습니다`, '빈 보기를 지우세요')
      if (new Set(opts.map((o) => String(o).trim())).size !== opts.length) add(f.id, 'error', 'dup_option', `"${name}" 에 같은 이름의 보기가 있습니다`, '겹치는 보기를 합치세요')
      if (opts.length < 2 && !f.validation?.other) add(f.id, 'warn', 'few_options', `"${name}" 의 보기가 ${opts.length}개뿐입니다`, '보기를 2개 이상 두세요')
      if (opts.length > 7 && f.type === 'radio') add(f.id, 'info', 'many_options', `"${name}" 의 보기가 ${opts.length}개입니다. 드롭다운이 더 보기 좋습니다`, '유형을 드롭다운으로 바꾸거나 묶으세요')
      if (f.type === 'checkbox' && !f.required && opts.length > 0 && !opts.some((o) => /해당 없음|없음|모름/.test(o)) && !f.validation?.other) add(f.id, 'info', 'no_optout', `"${name}" 에 "해당 없음" 같은 선택지가 없습니다`, '해당 없음 보기를 추가하세요')
    }
    if (f.type === 'scale') {
      const v = f.validation || {}
      if (!v.scaleMinLabel || !v.scaleMaxLabel) add(f.id, 'warn', 'scale_labels', `"${name}" 눈금의 양 끝 이름이 비어 있습니다`, 'scale.minLabel 과 maxLabel 을 채우세요 (예: 전혀 그렇지 않다 / 매우 그렇다)')
    }
    if (f.type === 'rating' && !(f.validation?.scaleMinLabel && f.validation?.scaleMaxLabel)) add(f.id, 'info', 'rating_labels', `"${name}" 평점의 양 끝 이름이 없습니다`, 'scale.minLabel 과 maxLabel 을 채우세요')
    if (GRID_TYPES.includes(f.type)) {
      if ((f.rows || []).length > 8) add(f.id, 'warn', 'big_grid', `"${name}" 격자의 행이 ${(f.rows || []).length}개입니다 (8개 초과)`, '행을 8개 이하로 줄이거나 격자를 둘로 나누세요')
      if (!(f.rows || []).length || !(f.columns || []).length) add(f.id, 'error', 'grid_empty', `"${name}" 격자의 행 또는 열이 비어 있습니다`, '행과 열을 채우세요')
    }
    if (t && DOUBLE_BARREL.test(t)) {
      add(f.id, 'info', 'double_barreled', `"${name}" 은 한 질문에 두 가지를 묻는 것처럼 보입니다`, '질문을 둘로 나누세요 (질문 하나에는 생각 하나)')
    }
    if (LEADING.test(t) || LEADING.test(f.hint_ko || '')) add(f.id, 'warn', 'leading', `"${name}" 에 답을 유도하는 말이 있을 수 있습니다`, '평가어나 단정하는 말을 빼고 중립적으로 다시 쓰세요')
    const personal = PERSONAL_TYPES.includes(f.type) || (['text', 'textarea'].includes(f.type) && PERSONAL_LABEL.test(t))
    if (personal && !hasPurpose && !f.hint_ko) personalMissing = true
    if (personal && f.required === false && f.type === 'studentid') { /* 선택 학번은 문제 없음 */ }
    if (f.required && f.type === 'textarea') add(f.id, 'info', 'required_long', `"${name}" 은 필수 서술형입니다. 응답을 포기하게 만들 수 있습니다`, '꼭 필요하지 않다면 선택으로 바꾸세요')
    if (form.settings?.quiz?.enabled && ['radio', 'select', 'checkbox', 'text', 'scale', 'rating'].includes(f.type) && !(f.quiz?.points > 0 && f.quiz?.correct?.length)) {
      add(f.id, 'warn', 'quiz_no_key', `퀴즈인데 "${name}" 에 정답이나 배점이 없습니다`, 'set_answer_key 로 정답과 배점을 정하세요')
    }
    if (f.quiz?.points > 0 && !(form.settings?.quiz?.enabled)) add(f.id, 'warn', 'key_without_quiz', `"${name}" 에 정답이 있지만 퀴즈 모드가 꺼져 있습니다`, 'set_quiz 로 퀴즈 모드를 켜세요')
    if (f.quiz?.points > 0 && OPTION_TYPES.includes(f.type) && (f.quiz.correct || []).some((c) => !(f.options || []).includes(c))) add(f.id, 'error', 'bad_key', `"${name}" 의 정답이 보기에 없습니다`, '정답을 보기 글자와 맞추세요')
    if (f.logic?.options && !f.required) add(f.id, 'warn', 'branch_not_required', `"${name}" 에 분기가 있지만 필수가 아닙니다. 답하지 않으면 분기를 건너뜁니다`, 'required 를 켜세요')
  }
  if (personalMissing) add(null, 'warn', 'personal_purpose', '이름, 연락처, 학번 같은 개인정보를 받지만 수집 목적과 보관 기간 안내가 없습니다', '폼 설명이나 해당 질문 설명에 용도와 보관 기간을 한 줄로 적고, 꼭 필요한 항목만 받으세요')
  for (const it of flowIssues) add(it.id, it.code === 'unreachable' ? 'warn' : 'error', `flow_${it.code}`, it.message, it.code === 'back' ? '분기 대상을 뒤쪽 섹션이나 "제출"로 바꾸세요' : '분기를 고치세요')
  const order = { error: 0, warn: 1, info: 2 }
  out.sort((a, b) => order[a.level] - order[b.level])
  return { estimated_minutes: mins, question_count: qs.length, findings: out.slice(0, 40), counts: { error: out.filter((x) => x.level === 'error').length, warn: out.filter((x) => x.level === 'warn').length, info: out.filter((x) => x.level === 'info').length } }
}

// ───────────────────────── 응답 집계 (개인정보 규칙) ─────────────────────────

/** 이 질문의 응답을 모델에게 글로 보여 줄 수 있는가: 단답/서술형이고 식별 정보 질문이 아닐 때만 */
export function isShareableText(f) {
  if (!f || !['text', 'textarea'].includes(f.type)) return false
  if (PERSONAL_LABEL.test(f.label_ko || '')) return false
  return true
}
const isIdentifying = (f) => PERSONAL_TYPES.includes(f.type) || (['text', 'textarea'].includes(f.type) && PERSONAL_LABEL.test(f.label_ko || ''))

const dayKey = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)

/**
 * 집계만 돌려준다. 이름/이메일/연락처/학번/파일/IP/정확한 시각은 입력에도 출력에도 없다.
 * @param {Array<{data:object, day?:string}>} items  host 가 data 와 날짜(YYYY-MM-DD)만 넘긴다
 */
export function responseStats(form, items, { question_id: qid } = {}) {
  const list = Array.isArray(items) ? items : []
  const total = list.length
  const reachCount = list.map((r) => visibleIds(form.fields, r?.data || {}))
  const questions = form.fields.filter((f) => f.type !== 'section')
  const pick = qid ? questions.filter((f) => f.id === qid) : questions
  if (qid && !pick.length) fail(`질문 id "${String(qid).slice(0, 40)}" 가 없습니다`)
  const stats = pick.map((f) => {
    if (isIdentifying(f) || ['text', 'textarea'].includes(f.type) || f.type === 'date' || f.type === 'time') {
      // 식별 정보와 글 응답은 응답 수만 낸다
      const answered = list.filter((r) => {
        const v = r?.data?.[f.id]
        return v != null && v !== ''
      }).length
      return { id: f.id, type: f.type, title: f.label_ko, answered, skipped: total - answered, note: isIdentifying(f) ? '개인정보 질문이라 개수만 제공합니다' : '글 응답은 개수만 제공합니다' }
    }
    return summarizeQuestion(f, list, form.settings)
  })
  const out = { response_count: total, questions: stats }
  if (!qid) {
    const days = new Map()
    for (const r of list) {
      const d = dayKey(r?.day)
      if (d) days.set(d, (days.get(d) || 0) + 1)
    }
    out.by_day = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-30).map(([day, n]) => ({ day, n }))
    // 완료율: 응답마다 "거친 질문 중 답한 비율"의 평균
    let sum = 0
    let counted = 0
    list.forEach((r, i) => {
      const ids = [...reachCount[i]]
      if (!ids.length) return
      const done = ids.filter((id) => {
        const v = r?.data?.[id]
        return Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : v != null && v !== ''
      }).length
      sum += done / ids.length
      counted += 1
    })
    out.completion_rate = counted ? Math.round((sum / counted) * 1000) / 10 : null
    const quiz = summarizeQuiz(form.fields, list, form.settings)
    if (quiz) out.quiz = quiz
  }
  return out
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE = /(?:\+?82[-\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g
const LONGNUM = /\b\d{7,}\b/g
const URL_ = /https?:\/\/\S+/g
export function scrubText(s) {
  return String(s).replace(EMAIL, '[이메일]').replace(URL_, '[주소]').replace(PHONE, '[전화]').replace(LONGNUM, '[숫자]')
}

export function textResponses(form, items, { question_id: qid, limit } = {}) {
  const f = form.fields.find((x) => x.id === qid)
  if (!f) fail(`질문 id "${String(qid).slice(0, 40)}" 가 없습니다`)
  if (!isShareableText(f)) fail('이 질문의 응답은 AI에게 보여 줄 수 없습니다 (단답/서술형만, 이름·연락처 같은 개인정보 질문은 제외)')
  const n = clampInt(limit, 1, 30, 20)
  const vals = (Array.isArray(items) ? items : []).map((r) => r?.data?.[qid]).filter((v) => typeof v === 'string' && v.trim())
  // 제출 순서를 알 수 없게 섞는다(결정적: 글자 기준 정렬)
  const picked = [...vals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, n).map((v) => scrubText(v).slice(0, 300))
  return { question_id: qid, total_answers: vals.length, shown: picked.length, answers: picked, note: '이메일, 전화, 긴 숫자, 주소는 가렸습니다' }
}

// ───────────────────────── Tool 묶음 ─────────────────────────

const typeEnum = AI_TYPES
const optionsSchema = { type: 'array', items: { type: 'string' }, description: '보기 글자 목록 (객관식, 드롭다운, 체크박스는 필수)' }
const specProps = {
  type: { type: 'string', enum: typeEnum, description: 'text 단답, textarea 서술, radio 객관식, select 드롭다운, checkbox 다중선택, scale 선형배율, rating 평점, radio_grid 객관식격자, checkbox_grid 체크박스격자, date, time, phone, email, studentid' },
  title: { type: 'string', description: '질문 문장' },
  description: { type: 'string', description: '질문 아래 안내문(선택)' },
  required: { type: 'boolean' },
  options: optionsSchema,
  rows: { type: 'array', items: { type: 'string' }, description: '격자의 행' },
  columns: { type: 'array', items: { type: 'string' }, description: '격자의 열' },
  scale: { type: 'object', description: 'scale: {min:0|1, max:2..10, minLabel, maxLabel}. rating: {levels:3..10, icon:"star"|"heart"|"thumb", minLabel, maxLabel}', properties: { min: { type: 'integer' }, max: { type: 'integer' }, levels: { type: 'integer' }, icon: { type: 'string' }, minLabel: { type: 'string' }, maxLabel: { type: 'string' } } },
  validation: { type: 'object', description: '{rule:{kind:"number"|"text"|"length"|"regex"|"choices", op, value, value2, n, message}, shuffle, other, noDuplicate, requireEachRow, maxLength}. number op: gt gte lt lte eq neq between notBetween isNumber isInteger. text op: contains notContains email url. length op: max min (n). regex op: matches notMatches contains notContains. choices(체크박스) op: atLeast atMost exactly (n)' },
}

export function createFormTools(host) {
  const mutate = (label, op) => async (args) => {
    if (!host.canEdit()) throw new Error('이 설문을 고칠 권한이 없습니다(보기 전용)')
    let res
    try {
      res = op(host.getForm(), args || {})
    } catch (e) {
      if (e instanceof ToolError) throw new Error(e.message)
      throw e
    }
    const applied = host.apply(res.form, { focus: res.result?.id })
    if (!applied) return { result: { ...res.result, note: '바뀐 내용이 없습니다' }, summary: '바뀐 내용 없음' }
    return {
      result: { ok: true, ...res.result, note: '저장 전입니다. 사용자가 저장을 눌러야 서버에 반영됩니다' },
      summary: `${res.summary}`,
      undo: () => host.revert(applied),
    }
  }
  const readOnly = (fn) => async (args) => {
    const out = fn(host.getForm(), args || {})
    return { result: out.result, summary: out.summary }
  }
  const respCount = () => host.getItems().length

  const tools = [
    {
      name: 'read_form',
      description: '현재 설문 전체를 읽는다: 제목, 설명, 섹션별 질문(id, 유형, 필수, 보기, 격자, 눈금, 검증, 분기, 퀴즈 정답), 설정, 응답 수. 작업 전에 항상 먼저 부른다.',
      parameters: { type: 'object', properties: {} },
      run: async () => ({ result: readForm(host.getForm(), { responseCount: respCount(), selectedId: host.getActiveId?.() ?? null }), summary: '설문 읽음' }),
    },
    {
      name: 'add_question',
      description: '질문 하나를 추가한다. 위치: after(질문 또는 섹션 id, "start"는 맨 앞) 또는 section(그 섹션 끝). 둘 다 없으면 맨 뒤.',
      parameters: { type: 'object', properties: { ...specProps, after: { type: 'string' }, section: { type: 'string', description: '섹션 id 또는 쪽 번호' } }, required: ['type', 'title'] },
      run: mutate('add_question', opAddQuestion),
    },
    {
      name: 'edit_question',
      description: '질문을 고친다. 주지 않은 항목은 그대로. options 는 전체 목록으로 바꾼다. 유형을 바꾸면 분기와 정답이 초기화된다.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, ...specProps }, required: ['id'] },
      run: mutate('edit_question', opEditQuestion),
    },
    {
      name: 'delete_question',
      description: '질문 또는 섹션을 지운다(섹션을 지우면 그 안의 질문은 앞 섹션으로 합쳐진다). 그 섹션을 가리키던 분기는 함께 풀린다.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: mutate('delete_question', opDeleteQuestion),
    },
    {
      name: 'move_question',
      description: '질문을 after 로 지정한 질문/섹션 바로 뒤로 옮긴다("start"는 맨 앞). 섹션은 옮길 수 없다. 분기를 망가뜨리면 거절한다.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, after: { type: 'string' } }, required: ['id', 'after'] },
      run: mutate('move_question', opMoveQuestion),
    },
    {
      name: 'add_section',
      description: '섹션(쪽 나누기)을 추가한다. after 로 지정한 질문 바로 뒤부터 새 섹션이 시작된다. 없으면 맨 뒤.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, after: { type: 'string' } }, required: ['title'] },
      run: mutate('add_section', opAddSection),
    },
    {
      name: 'set_branching',
      description: '답에 따라 섹션 이동을 건다. question_id 가 객관식/드롭다운이면 option_to_section = {보기 글자: 섹션 id 또는 쪽 번호 또는 "submit"(제출) 또는 "next"(기본)}. question_id 가 섹션 id 이면 {"*": 대상}으로 "이 섹션 끝난 뒤" 이동을 건다. 이전 설정을 통째로 바꾼다. 뒤쪽 섹션으로만 보낼 수 있다.',
      parameters: { type: 'object', properties: { question_id: { type: 'string' }, option_to_section: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['question_id', 'option_to_section'] },
      run: mutate('set_branching', opSetBranching),
    },
    {
      name: 'set_quiz',
      description: '퀴즈 모드를 켜고 끄고 점수 공개 방식을 정한다. release: immediate(제출 직후) | manual(관리자가 공개를 켠 뒤) | never.',
      parameters: { type: 'object', properties: { enabled: { type: 'boolean' }, release: { type: 'string', enum: ['immediate', 'manual', 'never'] }, released: { type: 'boolean' }, show_answers: { type: 'boolean' } }, required: ['enabled'] },
      run: mutate('set_quiz', opSetQuiz),
    },
    {
      name: 'set_answer_key',
      description: '질문의 정답과 배점을 정한다. 객관식/드롭다운/눈금/평점은 정답 하나, 체크박스는 정답 집합(정확히 같아야 정답), 단답형은 인정할 답 목록. points 0 이면 채점 안 함. 정답은 응답자에게 제출 전에 보이지 않는다.',
      parameters: { type: 'object', properties: { question_id: { type: 'string' }, points: { type: 'integer' }, correct: { description: '문자열 또는 문자열 배열(숫자 가능)' }, feedback: { type: 'object', properties: { correct: { type: 'string' }, incorrect: { type: 'string' } } }, ignore_case: { type: 'boolean' }, numeric: { type: 'boolean' } }, required: ['question_id', 'points', 'correct'] },
      run: mutate('set_answer_key', opSetAnswerKey),
    },
    {
      name: 'set_form_settings',
      description: '제목, 설명, 완료 문구(confirmation), 응답 받기(accepting) 를 바꾼다. accepting 은 사용자가 요청했을 때만 켠다.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, confirmation: { type: 'string' }, accepting: { type: 'boolean' } } },
      run: mutate('set_form_settings', opSetSettings),
    },
    {
      name: 'generate_form',
      description: '섹션과 질문을 한 번에 만든다(되돌리기 한 번). 질문 항목은 add_question 과 같은 필드 + branch({보기: 섹션 번호|"submit"}, 이 호출의 sections 순서가 번호) + quiz({points, correct, feedback_correct, feedback_incorrect}). 섹션이 하나뿐이고 title 이 없으면 섹션 머리 없이 질문만 넣는다. mode: append(기본) | replace(기존 내용을 모두 지움, 사용자가 원할 때만).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' }, description: { type: 'string' }, mode: { type: 'string', enum: ['append', 'replace'] },
          sections: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, after: { type: 'string', description: '이 섹션 끝난 뒤 이동: 섹션 번호 또는 "submit"' }, questions: { type: 'array', items: { type: 'object', properties: { ...specProps, branch: { type: 'object', additionalProperties: { type: 'string' } }, quiz: { type: 'object' } }, required: ['type', 'title'] } } }, required: ['questions'] } },
        },
        required: ['sections'],
      },
      run: mutate('generate_form', opGenerate),
    },
    {
      name: 'lint_form',
      description: '설문을 결정적 규칙으로 점검한다: 빈/중복 보기, 눈금 이름 없음, 한 질문에 두 가지, 유도 문구, 너무 긴 설문, 큰 격자, 개인정보 목적 안내, 퀴즈 정답 누락, 분기 되돌아감/막다른 길. 고칠 방법(fix)이 함께 온다.',
      parameters: { type: 'object', properties: {} },
      run: readOnly((form) => {
        const r = lintForm(form, { responseCount: respCount() })
        return { result: r, summary: `점검: 오류 ${r.counts.error}, 주의 ${r.counts.warn}, 참고 ${r.counts.info}` }
      }),
    },
    {
      name: 'get_response_stats',
      description: '응답을 집계해서 본다(개인정보 없음): 보기별 개수와 비율, 평점/눈금 분포와 평균, 격자 칸 개수, 숫자 통계, 퀴즈 점수 분포와 문항별 정답률, 날짜별 응답 수, 완료율. 글 응답은 개수만 나온다. question_id 를 주면 그 질문만.',
      parameters: { type: 'object', properties: { question_id: { type: 'string' } } },
      run: readOnly((form, a) => {
        const r = responseStats(form, host.getItems(), a)
        return { result: r, summary: `응답 ${r.response_count}건 집계` }
      }),
    },
  ]
  {
    tools.push({
      name: 'get_text_responses',
      description: '단답/서술형 질문의 응답 글을 읽는다(최대 30개, 순서 섞임, 이메일·전화 가림). 사용자가 "응답 글을 AI에게 보여 주기"를 켠 때만 쓸 수 있다. 이름·연락처 같은 개인정보 질문은 읽을 수 없다.',
      parameters: { type: 'object', properties: { question_id: { type: 'string' }, limit: { type: 'integer', description: '1~30' } }, required: ['question_id'] },
      run: readOnly((form, a) => {
        // 목록에서 빼는 것과 별개로, 스위치가 꺼져 있으면 실행도 막는다
        if (!host.textAccess?.()) fail('사용자가 "응답 글을 AI에게 보여 주기"를 켜지 않았습니다')
        const r = textResponses(form, host.getItems(), a)
        return { result: r, summary: `응답 글 ${r.shown}개 읽음` }
      }),
    })
  }
  return tools
}

/** 모델에게 내보낼 도구 목록: 응답 글 도구는 스위치가 켜졌을 때만 */
export function toolsFor(tools, { text }) {
  return text ? tools : tools.filter((t) => t.name !== 'get_text_responses')
}

export function buildFormContext({ form, activeId, responseCount, dirty, canEdit }) {
  const pages = buildPages(form.fields)
  const idx = form.fields.findIndex((f) => f.id === activeId)
  let sec = null
  if (idx >= 0) {
    for (let i = idx; i >= 0; i -= 1) if (form.fields[i].type === 'section') { sec = form.fields[i]; break }
  }
  const qn = form.fields.filter((f) => f.type !== 'section').length
  const lines = [
    `설문 "${form.title_ko || '제목 없음'}": 질문 ${qn}개, 섹션 ${Math.max(0, pages.length - (pages[0]?.section ? 0 : 1))}개, 응답 ${responseCount}건`,
    `상태: ${form.published ? '응답 받는 중' : '응답 받지 않음'}, ${dirty ? '저장 전 변경 있음' : '저장됨'}, 퀴즈 ${form.settings?.quiz?.enabled ? '켜짐' : '꺼짐'}`,
  ]
  if (activeId && activeId !== 'header' && idx >= 0) {
    const f = form.fields[idx]
    lines.push(`선택한 ${f.type === 'section' ? '섹션' : '질문'}: id ${f.id} "${(f.label_ko || '').slice(0, 40)}"${sec && sec.id !== f.id ? `, 현재 섹션 ${sec.id} "${(sec.label_ko || '').slice(0, 30)}"` : ''}`)
  } else lines.push('선택한 질문: 없음')
  if (!canEdit) lines.push('보기 전용: 도구로 고칠 수 없다. 제안만 한다')
  return lines.join('\n')
}
