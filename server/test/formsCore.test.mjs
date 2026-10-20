// DAH Form 코어: 새 질문 유형, 검증 규칙, 분기, 퀴즈 채점, 정답 유출 방지, 악의적 입력.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL
const forms = await import('../src/routes/forms.js')
const L = await import('../src/lib/formLogic.js')
const { validateResponse, publicForm, normalizeFields, withScore, responderRow } = forms
const codes = (errs) => errs.map((e) => `${e.field}:${e.error}`)
const norm = (arr) => normalizeFields(arr)

test('서버와 클라이언트 formLogic 복사본이 같다', () => {
  const a = fs.readFileSync(new URL('../src/lib/formLogic.js', import.meta.url), 'utf8')
  const b = fs.readFileSync(new URL('../../client/src/components/forms/formLogic.js', import.meta.url), 'utf8')
  assert.equal(a, b)
})

test('저장 정규화: 새 유형 통과, 모르는 유형은 text, 허용 목록 밖 키는 버린다', () => {
  const [g, r, x] = norm([
    { id: 'g', type: 'radio_grid', label_ko: '격자', rows: ['a', 'b'], columns: ['1', '2'], evil: 1, validation: { noDuplicate: true, junk: 1, rule: { kind: 'zzz' } } },
    { id: 'r', type: 'rating', label_ko: '별점', validation: { ratingMax: 99, ratingIcon: 'poop' } },
    { id: 'x', type: 'hax', label_ko: 'x' },
  ])
  assert.deepEqual(g.rows, ['a', 'b'])
  assert.equal(g.validation.noDuplicate, true)
  assert.equal(g.validation.rule, undefined)
  assert.equal(g.evil, undefined)
  assert.equal(r.validation.ratingMax, 10)
  assert.equal(r.validation.ratingIcon, 'star')
  assert.equal(x.type, 'text')
})

test('저장 정규화: 오버사이즈 배열은 자른다', () => {
  const [f] = norm([{ id: 'c', type: 'checkbox', label_ko: 'c', options: Array.from({ length: 5000 }, (_, i) => `o${i}`) }])
  assert.equal(f.options.length, L.LIMITS.options)
  const [g] = norm([{ id: 'g', type: 'checkbox_grid', label_ko: 'g', rows: Array.from({ length: 999 }, (_, i) => `r${i}`), columns: Array.from({ length: 999 }, (_, i) => `c${i}`) }])
  assert.equal(g.rows.length, L.LIMITS.rows)
  assert.equal(g.columns.length, L.LIMITS.columns)
})

test('radio_grid: 필수면 모든 행, 열마다 한 번만', () => {
  const f = norm([{ id: 'g', type: 'radio_grid', required: true, label_ko: '격자', rows: ['A', 'B', 'C'], columns: ['좋음', '보통', '나쁨'], validation: { noDuplicate: true } }])
  assert.deepEqual(codes(validateResponse(f, { g: { A: '좋음', B: '보통', C: '나쁨' } })), [])
  assert.deepEqual(codes(validateResponse(f, { g: { A: '좋음', B: '보통' } })), ['g:grid'])
  assert.deepEqual(codes(validateResponse(f, { g: { A: '좋음', B: '좋음', C: '나쁨' } })), ['g:gridDuplicate'])
  assert.deepEqual(codes(validateResponse(f, {})), ['g:required'])
  assert.deepEqual(codes(validateResponse(f, { g: { A: '없는열', B: '보통', C: '나쁨' } })), ['g:option'])
  assert.deepEqual(codes(validateResponse(f, { g: { Z: '좋음' } })), ['g:option'])
  assert.deepEqual(codes(validateResponse(f, { g: 'oops' })), ['g:type'])
  assert.deepEqual(codes(validateResponse(f, { g: { A: ['좋음'], B: '보통', C: '나쁨' } })), ['g:type'])
})

test('radio_grid: 선택이면 일부 행만 답해도 통과', () => {
  const f = norm([{ id: 'g', type: 'radio_grid', required: false, label_ko: '격자', rows: ['A', 'B'], columns: ['1', '2'] }])
  assert.deepEqual(validateResponse(f, { g: { A: '1' } }), [])
  assert.deepEqual(validateResponse(f, {}), [])
})

test('checkbox_grid: 행마다 여러 열, 중복·범위 밖 거절', () => {
  const f = norm([{ id: 'g', type: 'checkbox_grid', required: true, label_ko: '격자', rows: ['A', 'B'], columns: ['x', 'y', 'z'] }])
  assert.deepEqual(validateResponse(f, { g: { A: ['x', 'y'], B: ['z'] } }), [])
  assert.deepEqual(codes(validateResponse(f, { g: { A: ['x'] } })), ['g:grid'])
  assert.deepEqual(codes(validateResponse(f, { g: { A: ['x', 'x'], B: ['z'] } })), ['g:option'])
  assert.deepEqual(codes(validateResponse(f, { g: { A: ['q'], B: ['z'] } })), ['g:option'])
  assert.deepEqual(codes(validateResponse(f, { g: { A: 'x', B: ['z'] } })), ['g:type'])
  const big = Array.from({ length: 5000 }, () => 'x')
  assert.deepEqual(codes(validateResponse(f, { g: { A: big, B: ['z'] } })), ['g:option'])
})

test('rating: 범위와 정수', () => {
  const f = norm([{ id: 'r', type: 'rating', required: true, label_ko: '별점', validation: { ratingMax: 5 } }])
  assert.deepEqual(validateResponse(f, { r: '5' }), [])
  assert.deepEqual(codes(validateResponse(f, { r: '6' })), ['r:rating'])
  assert.deepEqual(codes(validateResponse(f, { r: '0' })), ['r:rating'])
  assert.deepEqual(codes(validateResponse(f, { r: '2.5' })), ['r:rating'])
  assert.deepEqual(codes(validateResponse(f, { r: '1e1' })), ['r:rating'])
})

const textField = (rule, type = 'text') => norm([{ id: 't', type, required: false, label_ko: '답', validation: { rule } }])
test('숫자 규칙: 크다 작다 사이 같다 숫자 정수', () => {
  const ok = (rule, v) => validateResponse(textField(rule), { t: v }).length === 0
  assert.ok(ok({ kind: 'number', op: 'gt', value: '10' }, '11'))
  assert.ok(!ok({ kind: 'number', op: 'gt', value: '10' }, '10'))
  assert.ok(ok({ kind: 'number', op: 'gte', value: '10' }, '10'))
  assert.ok(ok({ kind: 'number', op: 'lt', value: '10' }, '9.5'))
  assert.ok(ok({ kind: 'number', op: 'lte', value: '10' }, '10'))
  assert.ok(ok({ kind: 'number', op: 'between', value: '1', value2: '5' }, '3'))
  assert.ok(!ok({ kind: 'number', op: 'between', value: '1', value2: '5' }, '6'))
  assert.ok(ok({ kind: 'number', op: 'notBetween', value: '1', value2: '5' }, '6'))
  assert.ok(!ok({ kind: 'number', op: 'notBetween', value: '1', value2: '5' }, '3'))
  assert.ok(ok({ kind: 'number', op: 'eq', value: '7' }, '7'))
  assert.ok(ok({ kind: 'number', op: 'neq', value: '7' }, '8'))
  assert.ok(ok({ kind: 'number', op: 'isNumber' }, '-3.14'))
  assert.ok(!ok({ kind: 'number', op: 'isNumber' }, 'abc'))
  assert.ok(!ok({ kind: 'number', op: 'isNumber' }, '0x10'))
  assert.ok(ok({ kind: 'number', op: 'isInteger' }, '42'))
  assert.ok(!ok({ kind: 'number', op: 'isInteger' }, '4.2'))
  assert.ok(!ok({ kind: 'number', op: 'gt', value: '1' }, 'NaN'))
})

test('텍스트·길이·정규식 규칙과 사용자 지정 오류 문구', () => {
  const run = (rule, v, type) => validateResponse(textField(rule, type), { t: v })
  assert.equal(run({ kind: 'text', op: 'contains', value: '@hallym' }, 'a@hallym.ac.kr').length, 0)
  assert.equal(run({ kind: 'text', op: 'notContains', value: '욕' }, '욕설').length, 1)
  assert.equal(run({ kind: 'text', op: 'email' }, 'a@b.co').length, 0)
  assert.equal(run({ kind: 'text', op: 'email' }, 'nope').length, 1)
  assert.equal(run({ kind: 'text', op: 'url' }, 'https://dah.example/x').length, 0)
  assert.equal(run({ kind: 'text', op: 'url' }, 'javascript:alert(1)').length, 1)
  assert.equal(run({ kind: 'length', op: 'min', n: 5 }, 'abc', 'textarea').length, 1)
  assert.equal(run({ kind: 'length', op: 'max', n: 5 }, 'abcdef', 'textarea').length, 1)
  assert.equal(run({ kind: 'regex', op: 'matches', value: '\\d{3}' }, '123').length, 0)
  assert.equal(run({ kind: 'regex', op: 'matches', value: '\\d{3}' }, '1234').length, 1)
  assert.equal(run({ kind: 'regex', op: 'contains', value: '\\d{3}' }, 'a1234').length, 0)
  assert.equal(run({ kind: 'regex', op: 'notContains', value: 'foo' }, 'foobar').length, 1)
  assert.equal(run({ kind: 'regex', op: 'notMatches', value: 'foo' }, 'bar').length, 0)
  const e = run({ kind: 'regex', op: 'matches', value: '[a-z]+', message: '영문 소문자만 쓰세요' }, 'ABC')
  assert.equal(e[0].message, '영문 소문자만 쓰세요')
  assert.equal(L.errorText(e[0]), '영문 소문자만 쓰세요')
  // 서술형에는 숫자·텍스트 규칙이 적용되지 않는다(Google 과 같음)
  assert.equal(run({ kind: 'number', op: 'gt', value: '10' }, '1', 'textarea').length, 0)
})

test('정규식 재앙적 백트래킹 후보와 역참조는 저장도 실행도 막는다', () => {
  for (const bad of ['(a+)+$', '(a|aa)+$', '(.*)*x', '(a)\\1', 'x'.repeat(201), '[']) assert.ok(L.checkRegexSafe(bad), bad)
  assert.equal(L.checkRegexSafe('^\\d{2,4}-[a-z]+$'), null)
  const f = textField({ kind: 'regex', op: 'matches', value: '(a+)+$' })
  // 정규화를 거치지 않은 저장값이 들어와도 실행하지 않고 거절한다
  assert.equal(validateResponse(f, { t: 'a'.repeat(40) + '!' }).length, 1)
  const t0 = Date.now()
  validateResponse(f, { t: 'a'.repeat(40) + '!' })
  assert.ok(Date.now() - t0 < 100)
  const issues = L.validateDefinition(f, {})
  assert.ok(issues.some((i) => /반복/.test(i.message)))
})

test('체크박스: 최소·최대·정확히 N개', () => {
  const mk = (op, n) => norm([{ id: 'c', type: 'checkbox', label_ko: 'c', options: ['a', 'b', 'c', 'd'], validation: { rule: { kind: 'choices', op, n, message: 'N개 선택' } } }])
  assert.equal(validateResponse(mk('atLeast', 2), { c: ['a'] }).length, 1)
  assert.equal(validateResponse(mk('atLeast', 2), { c: ['a', 'b'] }).length, 0)
  assert.equal(validateResponse(mk('atMost', 2), { c: ['a', 'b', 'c'] }).length, 1)
  assert.equal(validateResponse(mk('exactly', 2), { c: ['a', 'b', 'c'] }).length, 1)
  assert.equal(validateResponse(mk('exactly', 2), { c: ['c', 'd'] }).length, 0)
  assert.equal(validateResponse(mk('exactly', 2), { c: ['a', 'a'] })[0].error, 'option')
  assert.equal(validateResponse(mk('exactly', 2), { c: 'a' })[0].error, 'type')
  assert.equal(validateResponse(mk('exactly', 2), { c: [{ x: 1 }, 'a'] })[0].error, 'tooMany')
})

test('"기타" 입력: 켠 질문만 받고 비어 있으면 거절', () => {
  const on = norm([{ id: 'r', type: 'radio', required: true, label_ko: 'r', options: ['가', '나'], validation: { other: true } }])
  assert.equal(validateResponse(on, { r: '기타: 다른 의견' }).length, 0)
  assert.equal(validateResponse(on, { r: '기타: ' })[0].error, 'other')
  assert.equal(validateResponse(on, { r: '기타' })[0].error, 'other')
  const off = norm([{ id: 'r', type: 'radio', required: true, label_ko: 'r', options: ['가', '나'] }])
  assert.equal(validateResponse(off, { r: '기타: 다른 의견' })[0].error, 'option')
  const cb = norm([{ id: 'c', type: 'checkbox', label_ko: 'c', options: ['가'], validation: { other: true } }])
  assert.equal(validateResponse(cb, { c: ['가', '기타: 뭔가'] }).length, 0)
  assert.equal(validateResponse(cb, { c: ['기타: a', '기타: b'] }).length, 1)
})

// ── 분기 ──
const branchForm = () => norm([
  { id: 'q1', type: 'radio', required: true, label_ko: '소속', options: ['학생', '교직원', '그만'], logic: { options: { 교직원: 'section:s3', 그만: 'submit' } } },
  { id: 's2', type: 'section', label_ko: '학생 질문' },
  { id: 'q2', type: 'text', required: true, label_ko: '학번 아님 학년' },
  { id: 's3', type: 'section', label_ko: '공통' },
  { id: 'q3', type: 'text', required: true, label_ko: '의견' },
])
test('분기: 건너뛴 섹션의 필수 질문은 묻지 않고 저장하지 않는다', () => {
  const f = branchForm()
  assert.deepEqual(codes(validateResponse(f, { q1: '교직원', q3: 'ok' })), [])
  assert.deepEqual(codes(validateResponse(f, { q1: '학생', q3: 'ok' })), ['q2:required'])
  assert.deepEqual(codes(validateResponse(f, { q1: '그만' })), [])
  assert.deepEqual(L.pickData(f, { q1: '교직원', q2: '조작', q3: 'ok' }), { q1: '교직원', q3: 'ok' })
  assert.deepEqual(L.pickData(f, { q1: '그만', q2: 'x', q3: 'y' }), { q1: '그만' })
})
test('분기: 경로 계산과 진행', () => {
  const f = branchForm()
  assert.deepEqual(L.computePath(f, { q1: '학생' }).path, [0, 1, 2])
  assert.deepEqual(L.computePath(f, { q1: '교직원' }).path, [0, 2])
  assert.deepEqual(L.computePath(f, { q1: '그만' }).path, [0])
  assert.deepEqual(L.nextAfter(L.buildPages(f), 0, { q1: '그만' }), { kind: 'submit' })
})
test('분기: 섹션 끝 이동과 기본값, 뒤로 가는 분기는 따르지 않고 저장 검사가 막는다', () => {
  const f = norm([
    { id: 'a', type: 'text', label_ko: 'a' },
    { id: 's2', type: 'section', label_ko: '2', logic: { after: 'section:s4' } },
    { id: 'b', type: 'text', label_ko: 'b' },
    { id: 's3', type: 'section', label_ko: '3' },
    { id: 'c', type: 'text', label_ko: 'c' },
    { id: 's4', type: 'section', label_ko: '4', logic: { after: 'section:s2' } },
    { id: 'd', type: 'text', label_ko: 'd' },
  ])
  assert.deepEqual(L.computePath(f, {}).path, [0, 1, 3])
  const issues = L.validateDefinition(f, {})
  assert.ok(issues.some((i) => /돌아갑니다/.test(i.message)), JSON.stringify(issues))
  assert.ok(issues.some((i) => /갈 수 없습니다/.test(i.message)))
  // 반복이 있어도 서버 경로 계산은 끝난다
  assert.ok(L.computePath(f, {}).path.length <= 4)
})
test('분기: 없는 섹션을 가리키는 분기는 정규화에서 걸러지지 않고 저장 검사가 막는다', () => {
  const f = norm([
    { id: 'q', type: 'radio', label_ko: 'q', options: ['a', 'b'], logic: { options: { a: 'section:nope' } } },
    { id: 's2', type: 'section', label_ko: '2' },
  ])
  assert.ok(L.validateDefinition(f, {}).some((i) => /없는 섹션/.test(i.message)))
  assert.equal(L.validateDefinition(branchForm(), {}).length, 0)
})
test('분기: 서술형 등 다른 유형에 붙은 logic 은 버린다', () => {
  const [f] = norm([{ id: 't', type: 'text', label_ko: 't', logic: { options: { a: 'submit' } } }])
  assert.equal(f.logic, undefined)
})

// ── 퀴즈 ──
const quizSettings = { quiz: { enabled: true, release: 'immediate', released: false, show_answers: false } }
const quizFields = () => norm([
  { id: 'q1', type: 'radio', label_ko: '수도는', options: ['서울', '부산'], quiz: { points: 5, correct: ['서울'], feedback_correct: '맞아요', feedback_incorrect: '서울입니다' } },
  { id: 'q2', type: 'checkbox', label_ko: '과일', options: ['사과', '배', '감자'], quiz: { points: 3, correct: ['사과', '배'] } },
  { id: 'q3', type: 'text', label_ko: '영어로 사과', quiz: { points: 2, correct: ['Apple', 'apple pie'], ignoreCase: true } },
  { id: 'q4', type: 'text', label_ko: '2+3', quiz: { points: 4, correct: ['5'], numeric: true } },
  { id: 'q5', type: 'text', label_ko: '대소문자 구분', quiz: { points: 1, correct: ['ABC'], ignoreCase: false } },
])
test('채점: 단일·복수·단답(변형·대소문자)·숫자', () => {
  const f = quizFields()
  const g = L.gradeResponse(f, { q1: '서울', q2: ['배', '사과'], q3: ' APPLE ', q4: '5.0', q5: 'abc' }, quizSettings)
  assert.equal(g.max, 15)
  assert.equal(g.score, 14)
  assert.equal(g.items.q5.correct, false)
  const g2 = L.gradeResponse(f, { q1: '부산', q2: ['사과'], q3: 'pear', q4: 'five' }, quizSettings)
  assert.equal(g2.score, 0)
  assert.equal(L.gradeResponse(f, {}, { quiz: { enabled: false } }), null)
  assert.equal(L.gradeResponse(f, {}, {}), null)
})
test('채점: 기타 입력은 정답이 될 수 없고 점수는 건너뛴 쪽을 세지 않는다', () => {
  const f = norm([
    { id: 'q1', type: 'radio', label_ko: 'q', options: ['예', '아니오'], validation: { other: true }, quiz: { points: 2, correct: ['예'] }, logic: { options: { 아니오: 'submit' } } },
    { id: 's2', type: 'section', label_ko: '2' },
    { id: 'q2', type: 'text', label_ko: 'x', quiz: { points: 7, correct: ['x'] } },
  ])
  assert.equal(L.gradeResponse(f, { q1: '기타: 예' }, quizSettings).score, 0)
  assert.equal(L.gradeResponse(f, { q1: '아니오', q2: 'x' }, quizSettings).max, 2)
})
test('점수 조작: 클라이언트가 보낸 _quiz 와 점수 필드는 저장되지 않는다', () => {
  const f = quizFields()
  const picked = L.pickData(f, { q1: '부산', _quiz: { score: 15, max: 15 }, score: 99 })
  assert.equal(picked._quiz, undefined)
  const { data } = withScore({ fields: f, settings: quizSettings }, picked)
  assert.equal(data._quiz.score, 0)
})
test('공개 JSON 은 정답·해설을 싣지 않는다 (배점만)', () => {
  const row = { id: 1, slug: 's', title_ko: 't', published: true, fields: quizFields(), settings: { ...quizSettings, secret_note: 'x' } }
  const pub = publicForm(row)
  const dump = JSON.stringify(pub)
  for (const leak of ['서울입니다', '맞아요', 'correct', 'feedback', 'ignoreCase', 'numeric', 'apple pie']) assert.ok(!dump.includes(leak), `leak: ${leak}`)
  assert.deepEqual(pub.fields[0].quiz, { points: 5 })
  assert.deepEqual(pub.settings.quiz, { enabled: true })
  // 퀴즈가 아니면 settings.quiz 도 없다
  assert.equal(publicForm({ ...row, settings: {} }).settings.quiz, undefined)
})
test('응답자 결과: 공개 방식별로 점수 노출 여부와 정답 공개', () => {
  const f = quizFields()
  const g = L.gradeResponse(f, { q1: '서울' }, quizSettings)
  const imm = L.resultForResponder(f, g, quizSettings)
  assert.equal(imm.score, 5)
  assert.equal(imm.items[0].feedback, '맞아요')
  assert.equal(imm.items[0].answer, undefined)
  const withAns = L.resultForResponder(f, g, { quiz: { ...quizSettings.quiz, show_answers: true } })
  assert.deepEqual(withAns.items[0].answer, ['서울'])
  assert.equal(L.resultForResponder(f, g, { quiz: { ...quizSettings.quiz, release: 'never' } }), null)
  assert.equal(L.resultForResponder(f, g, { quiz: { ...quizSettings.quiz, release: 'manual' } }), null)
  assert.ok(L.resultForResponder(f, g, { quiz: { ...quizSettings.quiz, release: 'manual', released: true } }))
  const row = { data: { q1: '서울', _quiz: g } }
  assert.equal(responderRow(row, { settings: { quiz: { ...quizSettings.quiz, release: 'never' } } }).data._quiz, undefined)
  assert.ok(responderRow(row, { settings: quizSettings }).data._quiz)
})
test('퀴즈 정의 검사: 정답 없음·정답이 보기에 없음', () => {
  const f = norm([
    { id: 'a', type: 'radio', label_ko: 'a', options: ['x'], quiz: { points: 1, correct: [] } },
    { id: 'b', type: 'radio', label_ko: 'b', options: ['x'], quiz: { points: 1, correct: ['y'] } },
  ])
  const m = L.validateDefinition(f, quizSettings).map((i) => i.message)
  assert.ok(m.some((x) => /정답이 없습니다/.test(x)))
  assert.ok(m.some((x) => /보기에 없습니다/.test(x)))
})

test('악의적 페이로드: 타입 오류, 거대한 값, 프로토타입 키, 건너뛴 쪽 답', () => {
  const f = branchForm()
  assert.ok(validateResponse(f, null).length > 0)
  assert.ok(validateResponse(f, []).length > 0)
  assert.deepEqual(codes(validateResponse(f, { q1: { $ne: 1 }, q3: 'x' })), ['q1:type', 'q2:required'])
  assert.deepEqual(codes(validateResponse(f, { q1: '교직원', q3: 'x'.repeat(30000) })), ['q3:maxLength'])
  const picked = L.pickData(f, JSON.parse('{"__proto__":{"admin":true},"q1":"교직원","q3":"x","constructor":1}'))
  assert.deepEqual(Object.keys(picked).sort(), ['q1', 'q3'])
  assert.equal({}.admin, undefined)
})

test('응답 열: 격자는 행마다 한 열, 체크박스 격자는 쉼표로 합친다', () => {
  const f = norm([
    { id: 'g', type: 'radio_grid', label_ko: '만족', rows: ['강의', '과제'], columns: ['상', '하'] },
    { id: 'h', type: 'checkbox_grid', label_ko: '요일', rows: ['오전'], columns: ['월', '화'] },
    { id: 't', type: 'text', label_ko: '의견' },
  ])
  const cols = L.expandColumns(f)
  assert.deepEqual(cols.map((c) => c.label), ['만족 [강의]', '만족 [과제]', '요일 [오전]', '의견'])
  const data = { g: { 강의: '상' }, h: { 오전: ['월', '화'] }, t: '굿' }
  assert.deepEqual(cols.map((c) => L.cellValue(c, data)), ['상', '', '월, 화', '굿'])
})

test('요약: 집계만 만들고 문자 응답은 개수만', () => {
  const f = norm([
    { id: 'r', type: 'radio', label_ko: 'r', options: ['a', 'b'] },
    { id: 'g', type: 'radio_grid', label_ko: 'g', rows: ['x'], columns: ['1', '2'] },
    { id: 's', type: 'rating', label_ko: 's', validation: { ratingMax: 3 } },
    { id: 't', type: 'text', label_ko: '이름' },
    { id: 'n', type: 'text', label_ko: '나이', validation: { rule: { kind: 'number', op: 'isNumber' } } },
  ])
  const items = [
    { data: { r: 'a', g: { x: '1' }, s: '3', t: '홍길동', n: '20' } },
    { data: { r: 'a', g: { x: '2' }, s: '1', t: '김철수', n: '30' } },
    { data: { r: 'b', t: '이영희', n: '40' } },
  ]
  const sum = f.map((q) => L.summarizeQuestion(q, items, {}))
  assert.deepEqual(sum[0].counts, [{ option: 'a', n: 2, pct: 66.7 }, { option: 'b', n: 1, pct: 33.3 }])
  assert.equal(sum[1].rows[0].cells[0].n, 1)
  assert.equal(sum[2].mean, 2)
  assert.equal(sum[3].answered, 3)
  assert.equal(JSON.stringify(sum[3]).includes('홍길동'), false)
  assert.equal(sum[4].number.mean, 30)
})
