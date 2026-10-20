// 설문 AI 도구: 3섹션 분기+퀴즈 만들기, 되돌리기, 점검, 응답 집계, 개인정보 규칙.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFormTools, toolsFor, buildFormContext, lintForm, readForm, responseStats, textResponses, scrubText } from '../aiFormTools.js'
import { computePath, gradeResponse, validateDefinition, validateResponse } from '../../../components/forms/formLogic.js'

const blank = () => ({ title_ko: '', description_ko: '', fields: [], published: false, settings: { quiz: { enabled: false, release: 'immediate', released: false, show_answers: false } } })

function makeHost({ items = [], text = false, canEdit = true } = {}) {
  const st = { form: blank(), items, text, canEdit, active: null, applied: 0 }
  const host = {
    getForm: () => st.form,
    canEdit: () => st.canEdit,
    getActiveId: () => st.active,
    getItems: () => st.items.map((r) => ({ data: r.data, day: r.day })),
    textAccess: () => st.text,
    apply: (next) => {
      const normalized = { ...next, fields: next.fields.map((f, i) => ({ ...f, order: i + 1 })) }
      if (JSON.stringify(normalized) === JSON.stringify(st.form)) return null
      const before = st.form
      st.form = normalized
      st.applied += 1
      return { before, after: normalized }
    },
    revert: ({ before }) => { st.form = before },
  }
  const tools = () => Object.fromEntries(createFormTools(host).map((t) => [t.name, t]))
  return { st, host, tools }
}

test('3섹션 분기+퀴즈 설문을 generate_form 한 번으로 만들고 한 번에 되돌린다', async () => {
  const { st, tools } = makeHost()
  const T = tools()
  const r = await T.generate_form.run({
    title: '신입 부원 지식 퀴즈',
    description: '수집한 이름은 퀴즈 채점에만 쓰고 학기 말에 지웁니다.',
    sections: [
      { title: '시작', questions: [
        { type: 'radio', title: '동아리 경험이 있나요?', options: ['있음', '없음', '답하고 싶지 않음'], required: true, branch: { 있음: 3, 없음: 2 } },
      ] },
      { title: '기초 문제', after: 3, questions: [
        { type: 'radio', title: '1+1은?', options: ['1', '2'], required: true, quiz: { points: 5, correct: '2', feedback_correct: '맞아요', feedback_incorrect: '2입니다' } },
        { type: 'checkbox', title: '과일을 모두 고르세요', options: ['사과', '배', '감자'], quiz: { points: 3, correct: ['사과', '배'] } },
      ] },
      { title: '마무리', questions: [
        { type: 'rating', title: '이 퀴즈는 어땠나요?', scale: { levels: 5, icon: 'star', minLabel: '별로', maxLabel: '좋음' } },
        { type: 'radio_grid', title: '항목별 만족도', rows: ['난이도', '분량'], columns: ['낮음', '보통', '높음'], required: true },
        { type: 'textarea', title: '더 하고 싶은 말' },
      ] },
    ],
  })
  assert.equal(r.result.created_questions, 6)
  assert.equal(r.result.created_sections, 3)
  assert.equal(st.applied, 1)
  assert.ok(r.undo)
  const f = st.form
  assert.equal(f.settings.quiz.enabled, true)
  assert.equal(f.title_ko, '신입 부원 지식 퀴즈')
  assert.deepEqual(validateDefinition(f.fields, f.settings), [])
  // 분기: 있음 -> 마무리, 없음 -> 기초 문제
  assert.deepEqual(computePath(f.fields, { [f.fields[1].id]: '있음' }).path, [0, 2])
  assert.deepEqual(computePath(f.fields, { [f.fields[1].id]: '없음' }).path, [0, 1, 2])
  // 퀴즈 채점
  const q1 = f.fields.find((x) => x.label_ko === '1+1은?')
  const q2 = f.fields.find((x) => x.label_ko.startsWith('과일'))
  const start = f.fields.find((x) => x.label_ko.startsWith('동아리'))
  const g = gradeResponse(f.fields, { [start.id]: '없음', [q1.id]: '2', [q2.id]: ['배', '사과'] }, f.settings)
  assert.equal(g.score, 8)
  assert.equal(g.max, 8)
  const skipped = gradeResponse(f.fields, { [start.id]: '있음', [q1.id]: '2' }, f.settings)
  assert.equal(skipped.max, 0, '건너뛴 섹션의 정답은 점수에 들어가지 않는다')
  // 분기 질문은 자동으로 필수
  assert.equal(start.required, true)
  // 되돌리기 한 번
  r.undo()
  assert.equal(st.form.fields.length, 0)
  assert.equal(st.form.settings.quiz.enabled, false)
})

test('개별 도구: 추가, 수정, 이동, 분기, 정답, 삭제와 거절', async () => {
  const { st, tools } = makeHost()
  const T = tools()
  await T.add_question.run({ type: 'radio', title: '질문 A', options: ['예', '아니오'], required: true })
  await T.add_section.run({ title: '두 번째' })
  await T.add_question.run({ type: 'text', title: '질문 B', section: 2 })
  await T.add_section.run({ title: '세 번째', after: 'q3' })
  const ids = st.form.fields.map((x) => x.id)
  assert.deepEqual(ids, ['q1', 's2', 'q3', 's4'].map((x) => x).slice(0, 4))
  const br = await T.set_branching.run({ question_id: 'q1', option_to_section: { 예: 's4', 아니오: 'submit' } })
  assert.equal(br.result.logic.options.예, 'section:s4')
  // 뒤로 가는 분기는 거절 (두 번째 섹션 -> 첫 쪽)
  await assert.rejects(() => T.set_branching.run({ question_id: 's4', option_to_section: { '*': 's2' } }), /돌아/)
  await assert.rejects(() => T.set_branching.run({ question_id: 'q1', option_to_section: { 없는보기: 's4' } }), /없습니다/)
  await assert.rejects(() => T.set_branching.run({ question_id: 'q3', option_to_section: { x: 's4' } }), /객관식/)
  await assert.rejects(() => T.add_question.run({ type: 'radio', title: 'x' }), /options/)
  await assert.rejects(() => T.add_question.run({ type: 'file', title: 'x' }), /지원하지 않는/)
  await assert.rejects(() => T.add_question.run({ type: 'text', title: 'x', after: 'nope' }), /없습니다/)
  await assert.rejects(() => T.add_question.run({ type: 'text', title: 'x', validation: { rule: { kind: 'regex', op: 'matches', value: '(a+)+$' } } }), /rule/)
  const e = await T.edit_question.run({ id: 'q1', options: ['예', '아니오', '모름'] })
  assert.deepEqual(e.result.changed, ['보기'])
  // 보기 이름을 바꾸면 사라진 보기의 분기도 정리
  await T.edit_question.run({ id: 'q1', options: ['네', '아니오'] })
  assert.deepEqual(Object.keys(st.form.fields[0].logic.options), ['아니오'])
  await T.set_quiz.run({ enabled: true, release: 'manual' })
  await T.set_answer_key.run({ question_id: 'q1', points: 2, correct: '네' })
  await assert.rejects(() => T.set_answer_key.run({ question_id: 'q1', points: 2, correct: '없는 보기' }), /보기에 없습니다/)
  assert.equal((await T.set_answer_key.run({ question_id: 'q3', points: 1000000, correct: 'x' })).result.quiz.points, 1000)
  await T.move_question.run({ id: 'q3', after: 'start' })
  assert.equal(st.form.fields[0].id, 'q3')
  await T.set_branching.run({ question_id: 'q1', option_to_section: { 네: 's4', 아니오: 'submit' } })
  const del = await T.delete_question.run({ id: 's4' })
  assert.ok(del.result.removed_branch_refs >= 1)
  await T.set_form_settings.run({ title: '새 제목', confirmation: '감사합니다', accepting: true })
  assert.equal(st.form.published, true)
  assert.equal(st.form.settings.confirmation_ko, '감사합니다')
  // 반복 호출은 order 가 유지된다
  assert.deepEqual(st.form.fields.map((f) => f.order), st.form.fields.map((_, i) => i + 1))
})

test('보기 전용이면 바꾸기 도구는 거절한다', async () => {
  const { tools } = makeHost({ canEdit: false })
  await assert.rejects(() => tools().add_question.run({ type: 'text', title: 'x' }), /권한/)
})

test('generate_form 은 잘못된 분기를 통째로 거절하고 아무것도 바꾸지 않는다', async () => {
  const { st, tools } = makeHost()
  await assert.rejects(() => tools().generate_form.run({ sections: [
    { title: '1', questions: [{ type: 'radio', title: 'q', options: ['a', 'b'], branch: { a: 9 } }] },
    { title: '2', questions: [] },
  ] }), /범위 밖/)
  await assert.rejects(() => tools().generate_form.run({ sections: [
    { title: '1', after: 1, questions: [{ type: 'text', title: 'q' }] },
    { title: '2', questions: [{ type: 'text', title: 'r' }] },
  ] }), /돌아갑니다/)
  assert.equal(st.form.fields.length, 0)
  await assert.rejects(() => tools().generate_form.run({ sections: [{ questions: [{ type: 'text', title: 'a' }, { type: 'bad', title: 'b' }] }] }), /questions\[1\]/)
})

test('lint_form: 빈/중복 보기, 눈금 이름, 이중 질문, 유도, 긴 설문, 큰 격자, 개인정보, 퀴즈 키, 분기 되돌아감', async () => {
  const form = {
    title_ko: '설문', description_ko: '', published: false,
    settings: { quiz: { enabled: true } },
    fields: [
      { id: 'a', type: 'radio', label_ko: '당연히 만족하시죠?', options: ['예', '예', ''], required: false, validation: {}, logic: { options: { 예: 'section:s2' } } },
      { id: 'b', type: 'scale', label_ko: '만족도', options: [], validation: { scaleMin: 1, scaleMax: 5 } },
      { id: 'c', type: 'text', label_ko: '강의 내용 및 진행 방식은 어떤가요?', options: [], validation: {} },
      { id: 'd', type: 'radio_grid', label_ko: '격자', rows: Array.from({ length: 9 }, (_, i) => `r${i}`), columns: ['1', '2'], options: [], validation: {} },
      { id: 'e', type: 'phone', label_ko: '전화번호', options: [], validation: {} },
      { id: 's2', type: 'section', label_ko: '2', options: [], validation: {}, logic: { after: 'section:s2' } },
    ],
  }
  const r = lintForm(form, { responseCount: 3 })
  const codes = r.findings.map((x) => x.code)
  for (const c of ['empty_option', 'dup_option', 'scale_labels', 'double_barreled', 'leading', 'big_grid', 'personal_purpose', 'quiz_no_key', 'branch_not_required', 'has_responses', 'flow_back']) assert.ok(codes.includes(c), `missing ${c}: ${codes}`)
  assert.ok(r.findings.every((x) => typeof x.message === 'string'))
  assert.ok(r.findings.filter((x) => x.level !== 'info').every((x) => x.fix), '오류와 주의에는 고칠 방법이 있다')
  const longForm = { ...blank(), fields: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, type: 'textarea', label_ko: `긴 질문 ${i}`, options: [], validation: {} })) }
  assert.ok(lintForm(longForm).findings.some((x) => x.code === 'too_long'))
})

// ── 응답 집계와 개인정보 ──
const statsForm = () => ({
  ...blank(),
  settings: { quiz: { enabled: true, release: 'immediate' } },
  fields: [
    { id: 'name', type: 'text', label_ko: '이름', options: [], validation: {} },
    { id: 'mail', type: 'email', label_ko: '이메일', options: [], validation: {} },
    { id: 'sid', type: 'studentid', label_ko: '학번', options: [], validation: {} },
    { id: 'tel', type: 'phone', label_ko: '연락처', options: [], validation: {} },
    { id: 'file', type: 'file', label_ko: '포트폴리오', options: [], validation: {} },
    { id: 'pick', type: 'radio', label_ko: '선호', options: ['A', 'B'], validation: { other: true }, quiz: { points: 1, correct: ['A'], ignoreCase: true, numeric: false } },
    { id: 'star', type: 'rating', label_ko: '별점', options: [], validation: { ratingMax: 5 } },
    { id: 'age', type: 'text', label_ko: '나이', options: [], validation: { rule: { kind: 'number', op: 'isNumber' } } },
    { id: 'free', type: 'textarea', label_ko: '하고 싶은 말', options: [], validation: {} },
    { id: 'grid', type: 'radio_grid', label_ko: '격자', rows: ['x'], columns: ['1', '2'], options: [], validation: {} },
  ],
})
// 테스트 전용 가짜 응답: 실제 사람 데이터가 아니다
const FAKE = [
  { day: '2026-10-01', data: { name: '테스트김', mail: 'fake1@test.invalid', sid: '20260001', tel: '010-0000-0001', file: 'https://blob.test/secret-file-1.pdf', pick: 'A', star: '5', age: '20', free: '연락은 fake9@test.invalid 또는 010-1234-5678 로 주세요. 좋았어요', grid: { x: '1' }, _quiz: { score: 1, max: 1, items: { pick: { earned: 1, max: 1, correct: true } } } } },
  { day: '2026-10-01', data: { name: '테스트이', mail: 'fake2@test.invalid', sid: '20260002', tel: '010-0000-0002', file: 'https://blob.test/secret-file-2.pdf', pick: '기타: 비밀의견', star: '3', age: '30', free: '별로였어요', grid: { x: '2' }, _quiz: { score: 0, max: 1, items: { pick: { earned: 0, max: 1, correct: false } } } } },
  { day: '2026-10-02', data: { name: '테스트박', mail: 'fake3@test.invalid', sid: '20260003', tel: '010-0000-0003', pick: 'B', star: '4', age: '40', free: '', grid: { x: '2' }, _quiz: { score: 0, max: 1, items: { pick: { earned: 0, max: 1, correct: false } } } } },
]
const FORBIDDEN = ['테스트김', '테스트이', '테스트박', 'fake1@', 'fake2@', 'fake3@', 'fake9@', '20260001', '20260002', '20260003', '010-0000-000', '010-1234', 'secret-file', 'blob.test', '비밀의견', '연락은', '별로였어요', '좋았어요', '하고 싶은 말을', 'submitted_at', 'google_email', '"ip"']

test('get_response_stats: 집계만, 식별 값과 글 응답은 나오지 않는다', async () => {
  const { st, tools } = makeHost({ items: FAKE })
  st.form = statsForm()
  const r = await tools().get_response_stats.run({})
  const dump = JSON.stringify(r)
  for (const bad of FORBIDDEN) assert.ok(!dump.includes(bad), `leak: ${bad}`)
  const byId = Object.fromEntries(r.result.questions.map((q) => [q.id, q]))
  assert.deepEqual(byId.pick.counts.map((c) => [c.option, c.n]), [['A', 1], ['B', 1], ['기타', 1]])
  assert.equal(byId.star.mean, 4)
  assert.equal(byId.name.answered, 3)
  assert.equal(byId.mail.answered, 3)
  assert.equal(byId.file.answered, 2)
  assert.equal(byId.free.answered, 2)
  assert.equal(byId.age.answered, 3, '숫자 규칙이 있어도 이 도구는 글/식별 질문이 아닌 한 통계를 낸다 또는 개수')
  assert.deepEqual(r.result.by_day, [{ day: '2026-10-01', n: 2 }, { day: '2026-10-02', n: 1 }])
  assert.equal(typeof r.result.completion_rate, 'number')
  assert.equal(r.result.quiz.n, 3)
  assert.equal(r.result.quiz.mean, 0.33)
  assert.equal(r.result.quiz.questions[0].pctCorrect, 33.3)
  // 한 질문만
  const one = await tools().get_response_stats.run({ question_id: 'grid' })
  assert.equal(one.result.questions[0].rows[0].cells[1].n, 2)
  await assert.rejects(() => tools().get_response_stats.run({ question_id: 'nope' }), /없습니다/)
})

test('get_text_responses: 스위치가 꺼져 있으면 목록에도 없고 실행도 막힌다', async () => {
  const { st, host, tools } = makeHost({ items: FAKE, text: false })
  st.form = statsForm()
  const all = createFormTools(host)
  assert.ok(all.find((t) => t.name === 'get_text_responses'))
  assert.equal(toolsFor(all, { text: false }).find((t) => t.name === 'get_text_responses'), undefined)
  assert.ok(toolsFor(all, { text: true }).find((t) => t.name === 'get_text_responses'))
  await assert.rejects(() => tools().get_text_responses.run({ question_id: 'free' }), /켜지 않았습니다/)
})

test('get_text_responses: 서술형만, 이메일/전화 가림, 개인정보 질문은 거절, 30개 제한', async () => {
  const { st, tools } = makeHost({ items: FAKE, text: true })
  st.form = statsForm()
  const r = await tools().get_text_responses.run({ question_id: 'free', limit: 999 })
  const dump = JSON.stringify(r)
  assert.ok(!dump.includes('fake9@'))
  assert.ok(!dump.includes('010-1234'))
  assert.ok(dump.includes('[이메일]') && dump.includes('[전화]'))
  assert.equal(r.result.shown, 2)
  for (const id of ['name', 'mail', 'sid', 'tel', 'file', 'pick', 'star']) await assert.rejects(() => tools().get_text_responses.run({ question_id: id }), /보여 줄 수 없습니다/)
  const many = Array.from({ length: 80 }, (_, i) => ({ day: '2026-10-01', data: { free: `의견 ${i}` } }))
  assert.equal(textResponses(statsForm(), many, { question_id: 'free', limit: 100 }).shown, 30)
  assert.equal(scrubText('a@b.co 010 1234 5678 12345678901'), '[이메일] [전화] [숫자]')
})

test('read_form 은 편집기용이라 정답을 포함하고, 응답 수와 시간 추정이 있다', () => {
  const form = statsForm()
  const r = readForm(form, { responseCount: 3 })
  assert.equal(r.response_count, 3)
  assert.ok(r.estimated_minutes >= 1)
  const pick = r.sections[0].questions.find((q) => q.id === 'pick')
  assert.deepEqual(pick.quiz.correct, ['A'])
  assert.equal(r.settings.quiz.enabled, true)
})

test('컨텍스트: 선택한 질문과 현재 섹션', () => {
  const f = { ...blank(), fields: [{ id: 'q1', type: 'text', label_ko: 'A' }, { id: 's2', type: 'section', label_ko: '둘' }, { id: 'q3', type: 'text', label_ko: 'B' }] }
  const c = buildFormContext({ form: f, activeId: 'q3', responseCount: 4, dirty: true, canEdit: true })
  assert.match(c, /id q3/)
  assert.match(c, /현재 섹션 s2/)
  assert.match(c, /응답 4건/)
})

test('응답 검증이 도구가 만든 설문의 모든 새 유형과 맞물린다', async () => {
  const { st, tools } = makeHost()
  await tools().generate_form.run({ sections: [{ questions: [
    { type: 'checkbox_grid', title: '요일', rows: ['오전', '오후'], columns: ['월', '화'], required: true },
    { type: 'rating', title: '별', required: true, scale: { levels: 4 } },
    { type: 'checkbox', title: '고르기', options: ['a', 'b', 'c'], validation: { rule: { kind: 'choices', op: 'atMost', n: 2, message: '두 개까지' } } },
  ] }] })
  const f = st.form.fields
  assert.deepEqual(validateResponse(f, { [f[0].id]: { 오전: ['월'], 오후: ['화', '월'] }, [f[1].id]: '4' }), [])
  assert.equal(validateResponse(f, { [f[0].id]: { 오전: ['월'], 오후: ['화'] }, [f[1].id]: '5' })[0].error, 'rating')
  assert.equal(validateResponse(f, { [f[0].id]: { 오전: ['월'], 오후: ['화'] }, [f[1].id]: '2', [f[2].id]: ['a', 'b', 'c'] })[0].message, '두 개까지')
})
