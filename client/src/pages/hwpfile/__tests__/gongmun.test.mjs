// 공문 표기 자동 고침: 근거(편람, 영 제7조, 시행규칙 제2조·제4조)의 예시 그대로를 시험 값으로 쓴다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixAttachment, fixColon, fixDates, fixEndMark, fixGongmunText, fixKoreanDates, fixMarkerSpace, fixTilde, fixTimes, looksNarrative } from '../gongmunRules.js'

test('날짜: 편람 예시 2021.12.12. -> 2021. 12. 12., 1985.09.06. -> 1985. 9. 6.', () => {
  assert.equal(fixDates('2021.12.12.').text, '2021. 12. 12.')
  assert.equal(fixDates('1985.09.06.').text, '1985. 9. 6.')
  assert.equal(fixDates('기한은 2026.09.01 까지').text, '기한은 2026. 9. 1. 까지')
  assert.equal(fixDates('2026-09-01').text, '2026. 9. 1.')
  assert.equal(fixDates('2026. 9. 1.').changes.length, 0)
  assert.equal(fixDates('버전 1234.56.78').text, '버전 1234.56.78')
})

test('날짜: 연월일 글자 표기를 온점으로', () => {
  assert.equal(fixKoreanDates('2026년 9월 1일 개최').text, '2026. 9. 1. 개최')
  assert.equal(fixKoreanDates('2026년09월01일').text, '2026. 9. 1.')
})

test('시각: 편람 예시 오후 3시 20분 -> 15:20, 오전 7시 9분 -> 07:09', () => {
  assert.equal(fixTimes('오후 3시 20분').text, '15:20')
  assert.equal(fixTimes('오전 7시 9분').text, '07:09')
  assert.equal(fixTimes('오후 2시').text, '14:00')
  assert.equal(fixTimes('회의는 14시 30분에').text, '회의는 14:30에')
  assert.equal(fixTimes('3시간 동안').text, '3시간 동안')
  assert.equal(fixTimes('오전 12시 5분').text, '00:05')
})

test('붙임: 뒤 2칸 (붙임∨∨계획서 1부.)', () => {
  assert.equal(fixAttachment('붙임 계획서 1부.').text, '붙임  계획서 1부.')
  assert.equal(fixAttachment('붙임계획서 1부.').text, '붙임  계획서 1부.')
  assert.equal(fixAttachment('붙임: 계획서 1부.').text, '붙임  계획서 1부.')
  assert.equal(fixAttachment('붙임  계획서 1부.').changes.length, 0)
  assert.equal(fixAttachment('붙임 1. 서식 1부.').text, '붙임  1. 서식 1부.')
})

test('끝 표시: 마지막 글자에서 한 글자(2타) 띄우고 끝.', () => {
  assert.equal(fixEndMark('주시기 바랍니다. 끝.').text, '주시기 바랍니다.  끝.')
  assert.equal(fixEndMark('주시기 바랍니다.끝.').text, '주시기 바랍니다.  끝.')
  assert.equal(fixEndMark('주시기 바랍니다.     끝.').text, '주시기 바랍니다.  끝.')
  assert.equal(fixEndMark('주시기 바랍니다.  끝.').changes.length, 0)
  assert.equal(fixEndMark('끝 내용이 있다').changes.length, 0)
})

test('쌍점: 원장 : 김갑동 -> 원장: 김갑동. 시각은 건드리지 않음', () => {
  assert.equal(fixColon('원장 : 김갑동').text, '원장: 김갑동')
  assert.equal(fixColon('일시 : 2026. 9. 1.').text, '일시: 2026. 9. 1.')
  assert.equal(fixColon('15:20 출발').text, '15:20 출발')
  assert.equal(fixColon('원장: 김갑동').changes.length, 0)
})

test('물결표: 4. 23. ~ 6. 15. -> 4. 23.~6. 15.', () => {
  assert.equal(fixTilde('4. 23. ~ 6. 15.').text, '4. 23.~6. 15.')
  assert.equal(fixTilde('4. 23.~6. 15.').changes.length, 0)
  assert.equal(fixTilde('약 3 ~ 5개').changes.length, 0)
})

test('항목부호 뒤 한 칸', () => {
  assert.equal(fixMarkerSpace('1.개요').text, '1. 개요')
  assert.equal(fixMarkerSpace('  가.세부').text, '  가. 세부')
  assert.equal(fixMarkerSpace('1)항목').text, '1) 항목')
  assert.equal(fixMarkerSpace('(1)항목').text, '(1) 항목')
  assert.equal(fixMarkerSpace('1. 개요').changes.length, 0)
  assert.equal(fixMarkerSpace('2026. 9. 1.').changes.length, 0)
})

test('여러 규칙 한꺼번에, 줄 단위(m 플래그)', () => {
  const src = '1.행사 안내\n일시 : 2026.09.01 오후 3시 20분\n붙임 계획서 1부. 끝.'
  const r = fixGongmunText(src)
  assert.equal(r.text, '1. 행사 안내\n일시: 2026. 9. 1. 15:20\n붙임  계획서 1부.  끝.')
  assert.ok(r.changes.length >= 5)
  assert.equal(fixGongmunText(r.text).changes.length, 0, '두 번째 실행은 아무것도 바꾸지 않는다(멱등)')
  assert.equal(fixGongmunText('2026.09.01', ['colon']).text, '2026.09.01')
})

test('개조식 점검', () => {
  assert.ok(looksNarrative('행사를 개최합니다.'))
  assert.ok(!looksNarrative('행사 개최 예정'))
  assert.ok(!looksNarrative('추진 현황 점검함'))
})
