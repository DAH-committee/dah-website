import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanChatText, inlineTokens, plainEditText, cleanToolArgs, STYLE_RULES } from '../aiText.js'

const flat = (s) => inlineTokens(s).map((t) => t.v).join('')

test('굵게와 기울임은 서식으로, 짝 없는 기호는 지운다', () => {
  assert.deepEqual(inlineTokens('이것은 **중요한** 내용'), [{ t: 'text', v: '이것은 ' }, { t: 'strong', v: '중요한' }, { t: 'text', v: ' 내용' }])
  assert.deepEqual(inlineTokens('*기울임* 확인').map((t) => t.t), ['em', 'text'])
  assert.equal(flat('스트리밍 도중 **열린 굵게'), '스트리밍 도중 열린 굵게')
  assert.equal(flat('끝에 남은 **'), '끝에 남은 ')
  assert.equal(flat('__밑줄굵게__ 와 ~~취소~~'), '밑줄굵게 와 취소')
})
test('곱셈 별표와 주석 별표는 지우지 않는다', () => {
  assert.equal(flat('3*4=12 입니다'), '3*4=12 입니다')
  assert.equal(flat('2026_10_12 파일'), '2026_10_12 파일')
})
test('링크와 이미지는 글자만 남긴다', () => {
  assert.equal(flat('[한림대](https://hallym.ac.kr) 참고'), '한림대 참고')
  assert.equal(flat('![로고](https://a/b.png)'), '로고')
})
test('표, 가로줄, 인용, HTML 태그를 정리한다', () => {
  const s = cleanChatText('| 이름 | 역할 |\n|---|---|\n| 김 | 팀장 |\n\n---\n\n> 인용문<br>둘째 줄')
  assert.ok(!/[|>]|---|<br>/.test(s), s)
  assert.ok(s.includes('이름 · 역할') && s.includes('김 · 팀장') && s.includes('인용문'))
})
test('도구 호출 찌꺼기는 지운다', () => {
  const a = cleanChatText('고쳤습니다.\n<function_calls><invoke name="fix_typos"><parameter name="fixes">[]</parameter></invoke></function_calls>')
  assert.equal(a, '고쳤습니다.')
  const b = cleanChatText('먼저 읽겠습니다.\n```json\n{"name":"read_document","arguments":{"from":1}}\n```\n끝')
  assert.ok(!b.includes('read_document') && b.includes('먼저 읽겠습니다') && b.includes('끝'), b)
})
test('사용자가 코드를 요청해서 나온 일반 코드 블록은 남긴다', () => {
  const s = cleanChatText('예시입니다.\n```js\nconsole.log(1)\n```')
  assert.ok(s.includes('console.log(1)'))
})
test('문서에 들어갈 글은 표시 기호를 모두 걷는다', () => {
  assert.equal(plainEditText('## 개요\n**핵심** 내용은 `A`와 __B__ 입니다.\n> 참고'), '개요\n핵심 내용은 A와 B 입니다.\n참고')
  assert.equal(plainEditText('3*4=12 와 ※ 주석'), '3*4=12 와 ※ 주석')
  assert.equal(plainEditText('<b>굵게</b> 확인'), '굵게 확인')
})
test('도구 인자는 글만 정리하고 찾을 글과 구조 값은 그대로 둔다', () => {
  const r = cleanToolArgs({ find: '**원문**', replace: '**새 글**', edits: [{ n: 3, op: 'replace', text: '**고친** 문장', was: '**원문' }], outline: '# 제목\n- 항목', notes: [{ text: '*메모*', color: 'yellow' }] })
  assert.equal(r.find, '**원문**')
  assert.equal(r.replace, '새 글')
  assert.equal(r.edits[0].text, '고친 문장')
  assert.equal(r.edits[0].was, '**원문')
  assert.equal(r.outline, '# 제목\n- 항목')
  assert.equal(r.notes[0].text, '메모')
})
test('말투 지시에 핵심 금지 항목이 들어 있다', () => {
  for (const w of ['**', '코드', 'JSON', '이모지']) assert.ok(STYLE_RULES.includes(w), w)
})
