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

export const DOC_TEMPLATES = {
  blank: () => doc(empty()),
  minutes: () =>
    doc(
      h(1, '회의록'),
      table(['항목', '내용'], [['일시', ''], ['장소', ''], ['참석', ''], ['불참', ''], ['작성', '']]),
      h(2, '안건'),
      ul('', ''),
      h(2, '논의 내용'),
      ul('', ''),
      h(2, '결정 사항'),
      task('', ''),
      h(2, '다음 회의'),
      p('일시: '),
      p('준비물: ')
    ),
  plan: () =>
    doc(
      h(1, '행사 기획안'),
      table(['항목', '내용'], [['행사명', ''], ['일시', ''], ['장소', ''], ['대상', ''], ['담당', '']]),
      h(2, '목적'),
      p(''),
      h(2, '진행 순서'),
      table(['시간', '내용', '담당'], [['', '', ''], ['', '', '']]),
      h(2, '역할 분담'),
      table(['역할', '담당', '비고'], [['총괄', '', ''], ['홍보', '', ''], ['촬영', '', '']]),
      h(2, '예산'),
      table(['항목', '금액', '산출 근거'], [['', '', ''], ['합계', '', '']]),
      h(2, '홍보 계획'),
      ul('', '')
    ),
  notice: () =>
    doc(
      h(1, '공지문'),
      p('안녕하세요. 디지털인문예술전공 운영위원회 LUCID입니다.'),
      empty(),
      h(2, '일정'),
      ul(['일시: '], ['장소: '], ['대상: ']),
      h(2, '내용'),
      p(''),
      h(2, '신청 방법'),
      p(''),
      h(2, '문의'),
      p('인스타그램 @hallym_lucid')
    ),
  report: () =>
    doc(
      h(1, '결과 보고서'),
      table(['항목', '내용'], [['행사명', ''], ['일시', ''], ['장소', ''], ['참여 인원', ''], ['작성', '']]),
      h(2, '진행 내용'),
      ul('', ''),
      h(2, '결과'),
      p(''),
      h(2, '정산'),
      table(['항목', '예산', '집행', '비고'], [['', '', '', ''], ['합계', '', '', '']]),
      h(2, '현장 사진'),
      p(''),
      h(2, '개선할 점'),
      ul('', '')
    ),
  handover: () =>
    doc(
      h(1, '인수인계 문서'),
      p(bold('작성'), ': '),
      h(2, '1. 업무 개요'),
      ul('', ''),
      h(2, '2. 연간 일정'),
      table(['시기', '할 일', '담당'], [['', '', ''], ['', '', '']]),
      h(2, '3. 계정과 링크'),
      table(['구분', '주소·계정', '비고'], [['', '', ''], ['', '', '']]),
      h(2, '4. 주의사항'),
      ul('', ''),
      h(2, '5. 인계 체크리스트'),
      task('', '', '')
    ),
}

const cols = (labels, width = 140) => labels.map((label, i) => ({ key: `c${i}`, label, width }))
const rowsOf = (labels, data, blank = 30) => {
  const rows = data.map((r, i) => ({ id: i + 1, cells: Object.fromEntries(r.map((v, j) => [`c${j}`, v])) }))
  while (rows.length < blank) rows.push({ id: rows.length + 1, cells: {} })
  return rows
}

const TEN = ['열 1', '열 2', '열 3', '열 4', '열 5', '열 6', '열 7', '열 8', '열 9', '열 10']

export const SHEET_TEMPLATES = {
  blank: () => ({ columns: cols(TEN), rows: rowsOf(TEN, [], 50), nextId: 51 }),
  todo: () => {
    const L = ['할 일', '담당', '기한', '상태', '비고']
    return { columns: cols(L, 160), rows: rowsOf(L, [['', '', '', '진행 전', '']], 30), nextId: 31 }
  },
  budget: () => {
    const L = ['날짜', '항목', '구분', '예산', '집행', '잔액', '영수증', '비고']
    return { columns: cols(L, 130), rows: rowsOf(L, [], 40), nextId: 41 }
  },
  attendance: () => {
    const L = ['이름', '학번', '전공', '참석', '비고']
    return { columns: cols(L, 140), rows: rowsOf(L, [], 60), nextId: 61 }
  },
  shift: () => {
    const L = ['날짜', '시간', '구역', '근무자', '교대자', '비고']
    return { columns: cols(L, 140), rows: rowsOf(L, [], 30), nextId: 31 }
  },
  calendar: () => {
    const L = ['월', '화', '수', '목', '금', '토', '일']
    return { columns: cols(L, 150), rows: rowsOf(L, [], 30), nextId: 31 }
  },
}

export const DOC_TEMPLATE_META = [
  { id: 'blank', name: '빈 문서', sub: '' },
  { id: 'minutes', name: '회의록', sub: '안건과 결정 사항' },
  { id: 'plan', name: '행사 기획안', sub: '일정, 역할, 예산' },
  { id: 'notice', name: '공지문', sub: '일정과 신청 방법' },
  { id: 'report', name: '결과 보고서', sub: '진행, 정산, 사진' },
  { id: 'handover', name: '인수인계 문서', sub: '연간 일정과 계정' },
]

export const SHEET_TEMPLATE_META = [
  { id: 'blank', name: '빈 스프레드시트', sub: '' },
  { id: 'todo', name: '할 일 목록', sub: '담당, 기한, 상태' },
  { id: 'budget', name: '예산 정산', sub: '예산, 집행, 잔액' },
  { id: 'attendance', name: '출석부', sub: '이름, 학번, 참석' },
  { id: 'shift', name: '근무표', sub: '날짜, 구역, 근무자' },
  { id: 'calendar', name: '주간 일정', sub: '요일별 칸' },
]
