// 작업공간 템플릿: 문서(Tiptap JSON)와 시트(열 + 행). 문체는 명사형 정보 전달.
// 문서 템플릿은 새 문서의 첫 탭 내용으로, 시트 템플릿은 새 시트의 내용으로 들어간다.

const t = (text) => ({ type: 'text', text })
const bold = (text) => ({ type: 'text', text, marks: [{ type: 'bold' }] })
const p = (...parts) => ({ type: 'paragraph', attrs: { textAlign: null }, content: parts.map((x) => (typeof x === 'string' ? t(x) : x)).filter((x) => x.text !== '') })
const empty = () => ({ type: 'paragraph', attrs: { textAlign: null } })
const h = (level, text) => ({ type: 'heading', attrs: { textAlign: null, level }, content: [t(text)] })
const li = (...parts) => ({ type: 'listItem', content: [p(...parts)] })
const ul = (...items) => ({ type: 'bulletList', content: items.map((x) => (Array.isArray(x) ? li(...x) : li(x))) })
const task = (...items) => ({ type: 'taskList', content: items.map((x) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(x)] })) })
const cell = (text, header = false) => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(text)] })
const table = (head, rows) => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((x) => cell(x, true)) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((x) => cell(x)) })),
  ],
})
const doc = (...content) => ({ type: 'doc', content })

// 템플릿 근거(구조만 옮김, 실제 개인정보 값은 없음)
// - 운영위원회 자료: 개강·종강총회 방명록(hwp), 참여자 명단(hwp), 2026-1 기말전시 기획안(pdf), 포스터 공모전 요강(CON:NECT, pdf),
//   출품자 명단·파일명 지시서(xlsx), 근로일지 기록카드(hwp), 멘토 결과 보고서(hwpx)
// - 한림대학교 학생지원팀 「행사 결과 보고서」 양식(2025. 4. 14. 공개, hallym.ac.kr)
// - 행정안전부 「행정업무운영편람」 회의록·계획서 구성
// - 공모전 공고 구성: 세종대 Creative Sejong IDEA 공모전 안내, 개인정보 동의 문구 구성: 명지대·한양대 공개 동의서
const blankRows = (n) => Array.from({ length: n }, () => [])

export const DOC_TEMPLATES = {
  blank: () => doc(empty()),
  // 기획안: 운영위원회 기말전시 기획안의 "개요 → 기획 의도 → 실행 방안(프로그램별 4단) → 공간 → 홍보 → 물품 → 일정 → 명단" 구조
  plan: () =>
    doc(
      h(1, '행사·전시 기획안'),
      table(['항목', '내용'], [['행사명', ''], ['슬로건', ''], ['일시', ''], ['장소', ''], ['대상', ''], ['주관', '디지털인문예술전공 운영위원회']]),
      h(2, '1. 기획 의도 및 목적'),
      h(3, '1) 기획 의도'),
      ul(''),
      h(3, '2) 주제'),
      ul(''),
      h(3, '3) 콘셉트'),
      ul(''),
      h(2, '2. 실행 방안'),
      h(3, '1) 현장 프로그램'),
      table(['프로그램', '기획 의도', '세부 내용', '진행 방식', '필요 물품'], [['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']]),
      h(3, '2) 공간 구성'),
      table(['프로그램', '장소'], [['', ''], ['', '']]),
      h(3, '3) 홍보 방안'),
      ul(['온라인: '], ['오프라인: ']),
      h(2, '3. 필요 물품 및 예산'),
      table(['구분', '물품', '단가', '수량', '금액', '비고'], [['', '', '', '', '', ''], ['', '', '', '', '', ''], ['합계', '', '', '', '', '']]),
      h(2, '4. 추진 일정'),
      table(['기간', '할 일', '담당'], [['', '준비', ''], ['', '시행', ''], ['', '결과 보고', '']]),
      h(2, '5. 운영 인원'),
      table(['No.', '전공', '학번', '이름', '역할'], [['1', '', '', '', ''], ['2', '', '', '', ''], ['3', '', '', '', '']])
    ),
  // 결과 보고서: 한림대학교 학생지원팀 「행사 결과 보고서」 양식 구성
  report: () =>
    doc(
      h(1, '행사 결과 보고서'),
      table(['항목', '내용'], [['행사명', ''], ['일시', ''], ['장소', ''], ['참석 인원', ''], ['행사 추진 목적', '']]),
      h(2, '1. 주요 행사 내용'),
      ul('', ''),
      h(2, '2. 행사 효과'),
      ul('', ''),
      h(2, '3. 행사 현장 사진'),
      p('사진을 넣을 자리(삽입 메뉴 > 이미지)'),
      h(2, '4. 정산'),
      table(['항목', '예산', '집행', '비고'], [['', '', '', ''], ['', '', '', ''], ['합계', '', '', '']]),
      h(2, '첨부 서류'),
      ul(['행사 현장 사진(본문 기재)'], ['영수증 사본'], ['참석자 명단']),
      h(2, '참여자 명단'),
      table(['순번', '학과', '이름', '학번'], Array.from({ length: 10 }, (_, k) => [String(k + 1), '', '', '']))
    ),
  // 회의록: 행정업무운영편람 회의록 구성(회의 개요, 참석자, 상정 안건, 논의 내용, 결정 사항, 기타)
  minutes: () =>
    doc(
      h(1, '회의록'),
      h(2, '1. 회의 개요'),
      table(['항목', '내용'], [['회의명', ''], ['일시', ''], ['장소', ''], ['주재', ''], ['기록', '']]),
      h(2, '2. 참석자'),
      ul(['참석: '], ['불참: ']),
      h(2, '3. 상정 안건'),
      ul(['제1호: '], ['제2호: ']),
      h(2, '4. 논의 내용'),
      h(3, '제1호 안건'),
      ul(''),
      h(3, '제2호 안건'),
      ul(''),
      h(2, '5. 결정 사항'),
      table(['결정 내용', '담당', '기한'], [['', '', ''], ['', '', '']]),
      h(2, '6. 기타'),
      ul(['다음 회의: '])
    ),
  // 공모전 공고: 운영위원회 포스터 공모전 요강(CON:NECT)과 대학 공모전 안내의 공통 구성
  contest: () =>
    doc(
      h(1, '공모전 안내'),
      table(['항목', '내용'], [['공모전명', ''], ['접수 기간', ''], ['참가 대상', '한림대학교 재학생(개인 또는 팀)'], ['주최', '디지털인문예술전공 운영위원회']]),
      h(2, '1. 공모 주제'),
      p(''),
      h(2, '2. 출품 양식'),
      ul(['규격: '], ['파일 형식: '], ['필수 기재: 작품명, 작품 소개'], ['생성형 AI 활용 시 사용 도구와 활용 내용 기재']),
      h(2, '3. 시상 내용'),
      table(['구분', '인원', '상금', '비고'], [['최우수상', '', '', ''], ['우수상', '', '', ''], ['장려상', '', '', '']]),
      h(2, '4. 세부 일정'),
      table(['일정', '날짜'], [['접수', ''], ['심사', ''], ['결과 발표', ''], ['전시·시상', '']]),
      h(2, '5. 출품 방법'),
      ul(['접수처: '], ['제출 서류: 작품 파일, 개인정보 수집·이용 동의'], ['파일명: 학번_이름_작품명']),
      h(2, '6. 유의 사항'),
      ul(['타인의 저작물을 무단으로 사용한 작품은 심사에서 제외'], ['수상작은 전시와 홍보에 사용될 수 있음']),
      h(2, '7. 문의'),
      p('')
    ),
  // 방명록: 운영위원회 개강·종강총회 방명록 hwp(일시·장소 + 순번·학과·학번·성명·서명)
  guestbook: () =>
    doc(
      h(1, '방명록'),
      table(['항목', '내용'], [['행사명', ''], ['일시', ''], ['장소', '']]),
      table(['순번', '학과', '학번', '성명', '서명'], Array.from({ length: 25 }, (_, k) => [String(k + 1), '', '', '', '']))
    ),
}

const cols = (labels, width = 140) => labels.map((label, i) => ({ key: `c${i}`, label, width }))
const rowsOf = (labels, data, blank = 30) => {
  const rows = data.map((r, i) => ({ id: i + 1, cells: Object.fromEntries(r.map((v, j) => [`c${j}`, v]).filter(([, v]) => v !== '' && v !== undefined)) }))
  while (rows.length < blank) rows.push({ id: rows.length + 1, cells: {} })
  return rows
}
const sized = (labels, widths) => labels.map((label, i) => ({ key: `c${i}`, label, width: widths[i] || 140 }))

const TEN = ['열 1', '열 2', '열 3', '열 4', '열 5', '열 6', '열 7', '열 8', '열 9', '열 10']

export const SHEET_TEMPLATES = {
  blank: () => ({ columns: cols(TEN), rows: rowsOf(TEN, [], 50), nextId: 51 }),
  // 참여자 명단·방명록: 개강·종강총회 방명록 hwp와 한림대 행사 결과 보고서의 참여자 명단
  participants: () => {
    const L = ['순번', '학과', '학번', '성명', '참석 확인', '비고']
    return { columns: sized(L, [72, 170, 120, 120, 110, 180]), rows: rowsOf(L, Array.from({ length: 50 }, (_, k) => [String(k + 1)]), 50), nextId: 51 }
  },
  // 예산·물품 집행: 기획안의 필요 물품 내역(구분·물품·단가·비고) + 결과 보고서 정산. 금액 = 단가 × 수량
  budget: () => {
    const L = ['구분', '물품', '단가', '수량', '금액', '구입처', '영수증', '비고']
    const t = { columns: sized(L, [110, 200, 110, 80, 120, 140, 100, 160]), rows: rowsOf(L, [], 40), nextId: 41 }
    t.rows.forEach((r, i) => { r.cells.c4 = `=IF(C${i + 2}="","",C${i + 2}*D${i + 2})` })
    return t
  },
  // 출품작 심사채점표: 운영위원회 「2026-1 기말 프로젝트 전시회 출품작 심사채점표」(구글 시트)와 같은 구성.
  // 탭 1 채점표(순번·작품명·과목명·대표학생(팀명)·독창성·내용성·완성도·예술성/기술성 각 25점·총점·상),
  // 탭 2 심사 항목 설명(항목·배점·설명, 출품작 폴더 링크). 학기마다 과목명과 이름만 바꿔 쓴다. 총점은 네 점수의 합.
  judging: () => {
    const L = ['순번', '작품명', '과목명', '대표학생(팀명)', '독창성 (25점)', '내용성 (25점)', '완성도 (25점)', '예술성/기술성 (25점)', '총점', '상']
    const rows = rowsOf(L, Array.from({ length: 50 }, (_, k) => [String(k + 1)]), 50)
    rows.forEach((r, k) => { r.cells.c8 = `=IF(COUNT(E${k + 2}:H${k + 2})=0,"",SUM(E${k + 2}:H${k + 2}))` })
    const C = ['심사 항목', '배점', '설명']
    const criteria = [
      ['독창성', '25점', '얼마나 신선하고 새로운가?'],
      ['내용성', '25점', '전달하고자 하는 내용이나 메시지가 확실하고 잘 전달되는가?'],
      ['완성도', '25점', '품질적 측면에서 작품 수준이 어떠한가?'],
      ['예술성/기술성', '25점', '작품 내용에 따라: 예술적 가치가 얼마나 되는가? 또는 최근 기술 등을 잘 반영하고 있는가?'],
      ['', '', ''],
      ['출품작 폴더', '', '(출품작 구글 드라이브 폴더 링크를 붙여 넣기)'],
    ]
    return {
      sheets: [
        { id: 'main', label: '채점표', columns: sized(L, [104, 340, 190, 190, 160, 160, 160, 210, 100, 100]), rows, nextId: 51 },
        { id: 's2', label: '심사 항목 설명', columns: sized(C, [140, 90, 620]), rows: rowsOf(C, criteria, 20), nextId: 21 },
      ],
      nextSheet: 3,
    }
  },
  // 근무 기록: 근로장학생 근로일지 기록카드 hwp(연-월-일·요일·근무내용·근무시간)
  worklog: () => {
    const L = ['연-월-일', '요일', '근무자', '학번', '근무 내용', '시작', '종료', '근무 시간', '확인']
    return { columns: sized(L, [120, 70, 110, 120, 240, 90, 90, 100, 90]), rows: rowsOf(L, [], 40), nextId: 41 }
  },
  // 전시 제출물·파일명 관리: 전시회 파일명 지시서 xlsx(ID·과목·작품명·팀명·저장할 파일명)
  files: () => {
    const L = ['ID', '과목', '작품명', '팀명·개인명', '저장할 파일명', '추가 페이지 파일명', '제출 확인', '비고']
    return { columns: sized(L, [80, 170, 180, 150, 180, 180, 100, 160]), rows: rowsOf(L, [], 60), nextId: 61 }
  },
}

export const DOC_TEMPLATE_META = [
  { id: 'blank', name: '빈 문서', sub: '' },
  { id: 'plan', name: '행사·전시 기획안', sub: '기획 의도, 실행 방안, 예산' },
  { id: 'report', name: '행사 결과 보고서', sub: '한림대 학생지원팀 양식' },
  { id: 'minutes', name: '회의록', sub: '안건, 논의, 결정 사항' },
  { id: 'contest', name: '공모전 안내', sub: '주제, 시상, 출품 방법' },
  { id: 'guestbook', name: '방명록', sub: '학과, 학번, 성명, 서명' },
]

export const SHEET_TEMPLATE_META = [
  { id: 'blank', name: '빈 스프레드시트', sub: '' },
  { id: 'participants', name: '참여자 명단', sub: '순번, 학과, 학번, 참석' },
  { id: 'budget', name: '예산·물품 집행', sub: '단가 × 수량 자동 계산' },
  { id: 'judging', name: '출품작 심사채점표', sub: '나만 보기, 총점 자동', ownerOnly: true, siteOwnerOnly: true },
  { id: 'worklog', name: '근무 기록', sub: '날짜, 내용, 시간' },
  { id: 'files', name: '전시 제출물 관리', sub: '과목, 작품, 파일명' },
]
