// 전시회 자동화 규칙: 드라이브 폴더, 파일 이름, 채점기준표 형식, 교수님 목록, 작품 링크
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  driveFileName, driveSegments, fileKind, groupByCourse, makeWebVersion, masterRubricValues,
  normalizeProfessors, peopleOf, representativeLabel, rubricValues, RUBRIC_HEADER, PRINT_FOLDER, GRADE_FOLDER,
} from '../src/lib/exhibitionPipeline.js'
import { sanitizeLinks } from '../src/routes/submit.js'

const solo = { id: 1, semester_label: '2026-2', entry_type: 'solo', fields: { name: '주현호', student_no: '20222583', major: '디지털인문예술전공', course: 'UI 디자인', work_title: '별자리/지도' } }
const team = { id: 2, semester_label: '2026-2', entry_type: 'team', fields: { team_name: '올리브영은영', members: [{ name: '김서영', student_no: '20256603', major: 'X' }, { name: '최은영', student_no: '1', major: 'Y' }], course: '서비스 디자인', work_title: '맨즈에딧' } }

test('PDF는 인쇄용 PDF 한 폴더, 이미지는 채점용 PNG/과목', () => {
  assert.deepEqual(driveSegments(solo, 'pdf'), [PRINT_FOLDER])
  assert.deepEqual(driveSegments(solo, 'image'), [GRADE_FOLDER, 'UI 디자인'])
  assert.equal(fileKind('a.PDF'), 'pdf')
  assert.equal(fileKind('a.png'), 'image')
  assert.equal(fileKind('scan', 'image/jpeg'), 'image')
  assert.equal(fileKind('a.ai'), 'other')
})

test('드라이브 파일 이름: PDF는 과목을 앞에, 여러 장이면 _번호, 금지 문자 제거', () => {
  assert.equal(driveFileName(solo, { original_name: 'poster.pdf' }, 'pdf', 0, 1), '[UI 디자인] 별자리 지도 - 주현호(20222583).pdf')
  assert.equal(driveFileName(team, { original_name: 'p.PNG' }, 'image', 1, 2), '맨즈에딧 - 김서영(20256603)_2.png')
})

test('참가자와 대표 표기: 팀은 대표(팀명)', () => {
  assert.equal(peopleOf(team).length, 2)
  assert.equal(peopleOf(solo)[0].studentId, '20222583')
  assert.equal(representativeLabel(team), '김서영(올리브영은영)')
  assert.equal(representativeLabel(solo), '주현호')
})

test('채점기준표: 26-1 형식 머리글, 폴더 링크, 총점 수식', () => {
  const v = rubricValues({ course: 'UI 디자인', entries: [solo, solo], folderUrl: 'https://drive.google.com/drive/folders/x' })
  assert.deepEqual(v[2], RUBRIC_HEADER)
  assert.equal(v[0][1], 'https://drive.google.com/drive/folders/x')
  assert.equal(v[3][0], '1')
  assert.equal(v[3][8], '=IF(COUNT(E4:H4)=0,"",SUM(E4:H4))')
  assert.equal(v[4][8], '=IF(COUNT(E5:H5)=0,"",SUM(E5:H5))')
  const groups = groupByCourse([team, solo], ['UI 디자인', '서비스 디자인', '빈 과목'])
  assert.deepEqual(groups.map(([c]) => c), ['UI 디자인', '서비스 디자인'])
  const m = masterRubricValues(groups)
  assert.equal(m.length, 5)
  assert.equal(m[4][2], '서비스 디자인')
})

test('교수님 목록 정리와 작품 링크 검증', () => {
  const p = normalizeProfessors({ 'UI 디자인': { name: '김교수', emails: 'A@hallym.ac.kr, bad, b@x.com' }, '빈': { name: '', emails: [] } })
  assert.deepEqual(p, { 'UI 디자인': { name: '김교수', emails: ['a@hallym.ac.kr', 'b@x.com'] } })
  const l = sanitizeLinks([{ label: '', url: 'https://a.com' }, { label: 'x', url: 'javascript:alert(1)' }, { url: 'http://b.com' }, { url: 'https://c.com' }, { url: 'https://d.com' }])
  assert.equal(l.length, 3)
  assert.equal(l[0].label, '작품 링크')
})

test('WebP 변환: 긴 변 2400px 이하, 대표색 산출', async () => {
  const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#7157d9' } }).png().toBuffer()
  const v = await makeWebVersion(png)
  assert.equal(v.meta.width, 2400)
  assert.match(v.meta.keycolor, /^#[0-9a-f]{6}$/)
  assert.equal(await makeWebVersion(Buffer.from('%PDF-1.4')), null)
})
