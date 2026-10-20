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
      table(['항목', '내용'], [['행사명', ''], ['슬로건', ''], ['일시', ''], ['장소', ''], ['대상', ''], ['주관', '']]),
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

// ── 한글 모드 공문 양식(행정업무운영 편람 구성). 사실 값은 넣지 않고 ○○○ 자리와 자료값(변수)만 둔다.
// 자료값은 문서 설정(content.hwp.vars)에 한 번 두고, 본문의 hwpVar 칸과 두문·결문의 {이름} 자리가 같은 값을 쓴다.
const V = (key) => ({ type: 'hwpVar', attrs: { key, calc: null, digits: 0, unit: '' } })
const C = (calc, unit = '', digits = 0) => ({ type: 'hwpVar', attrs: { key: null, calc, digits, unit } })
const hp = (...parts) => ({ type: 'paragraph', attrs: { textAlign: null }, content: parts.map((x) => (typeof x === 'string' ? t(x) : x)).filter((x) => x.type !== 'text' || x.text !== '') })
const hh = (level, ...parts) => ({ type: 'heading', attrs: { textAlign: null, level }, content: hp(...parts).content })
// 목록: 항목은 [글 조각들] 또는 { p: [글 조각들], sub: [하위 항목] }
const hli = (it) => (Array.isArray(it) ? { type: 'listItem', content: [hp(...it)] } : { type: 'listItem', content: [hp(...it.p), hul(...it.sub)] })
const hul = (...items) => ({ type: 'bulletList', content: items.map(hli) })
const quote = (...parts) => ({ type: 'blockquote', content: [hp(...parts)] })
const hcell = (parts, header = false) => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [hp(...(Array.isArray(parts) ? parts : [parts]))] })
const htable = (head, rows) => ({ type: 'table', content: [{ type: 'tableRow', content: head.map((x) => hcell(x, true)) }, ...rows.map((r) => ({ type: 'tableRow', content: r.map((x) => hcell(x)) }))] })
const vars = (...list) => Object.fromEntries(list.map(([key, label, unit = ''], o) => [key, { label, value: '', unit, o }]))
const hwpDoc = (hwp, ...content) => ({ type: 'doc', content, hwp: { mode: 'hwp', head: {}, foot: {}, ...hwp } })

export const HWP_DOC_TEMPLATES = {
  // 기안문: 두문(행정기관명·수신·경유·제목) + 본문(1. 가. 1) 항목) + 결문(발신명의·결재선·시행·연락처)
  gian: () =>
    hwpDoc(
      {
        preset: '기안문',
        vars: vars(['org', '기관명'], ['dept', '부서명'], ['title', '제목'], ['date', '일시'], ['place', '장소'], ['people', '인원', '명'], ['budget', '예산', '원']),
        head: { org: '{기관명}', to: '수신자 참조', via: '', title: '{제목}' },
        foot: { sender: '{기관명}장', drafter: '기안자 ○○○', reviewer: '검토자 ○○○', approver: '결재권자 ○○○', docNum: '{부서명}-○○○', disclosure: '공개' },
      },
      hul(
        ['관련: ', V('dept'), '-○○○(○○○○. ○. ○.)'],
        {
          p: ['○○○ 운영을 위하여 다음과 같이 시행하고자 합니다.'],
          sub: [
            ['일시: ', V('date')],
            ['장소: ', V('place')],
            ['대상: ○○○ ', V('people')],
            ['소요 예산: ', V('budget'), '(1인당 ', C('{예산} / {인원}', '원'), ')'],
            ['세부 내용: 붙임 참조'],
          ],
        }
      ),
      hp('붙임  ○○○ 계획 1부.')
    ),
  // 보고서: 제목, 요약(보고 목적 한 문장), 장(Ⅰ) / 절(□) / 항목(ㅇ - ㆍ)
  hreport: () =>
    hwpDoc(
      { preset: '보고서', vars: vars(['title', '제목'], ['dept', '부서명'], ['start', '시작일'], ['end', '종료일'], ['people', '인원', '명'], ['budget', '예산', '원']) },
      hh(1, V('title'), ' 추진 현황 보고'),
      quote(V('title'), ' 추진 현황과 향후 계획을 보고하고자 함'),
      hh(2, '추진 배경'),
      hul({ p: ['○○○ 관련 ○○○ 필요'], sub: [['○○○']] }),
      hh(2, '추진 현황'),
      hh(3, '사업 개요'),
      hul(['기간: ', V('start'), ' ~ ', V('end')], ['대상: ○○○ ', V('people')], ['예산: ', V('budget'), '(1인당 ', C('{예산} / {인원}', '원'), ')']),
      hh(3, '주요 실적'),
      hul({ p: ['○○○ 실시(○. ○.)'], sub: [['○○○']] }),
      hh(2, '향후 계획'),
      hul(['○○○ 추진(○월 중)'], ['○○○ 결과 보고(○월 중)'])
    ),
  // 계획서: 목적, 개요, 세부 계획, 소요 예산(단가 × 인원 계산), 일정, 행정 사항
  hplan: () =>
    hwpDoc(
      { preset: '계획서', vars: vars(['name', '사업명'], ['org', '기관명'], ['start', '시작일'], ['end', '종료일'], ['place', '장소'], ['people', '인원', '명'], ['unit', '1인당 단가', '원']) },
      hh(1, V('name'), ' 추진 계획'),
      quote(V('name'), ' 추진을 위한 세부 계획을 수립하고자 함'),
      hh(2, '추진 목적'),
      hul(['○○○ 위한 ○○○ 마련']),
      hh(2, '추진 개요'),
      hul(['기간: ', V('start'), ' ~ ', V('end')], ['장소: ', V('place')], ['대상: ○○○ ', V('people')], ['주관: ', V('org')]),
      hh(2, '세부 추진 계획'),
      hh(3, '준비'),
      hul(['○○○(담당: ○○○)']),
      hh(3, '운영'),
      hul(['○○○(담당: ○○○)']),
      hh(2, '소요 예산'),
      htable(['구분', '산출 근거', '금액'], [['○○○', [V('unit'), ' × ', V('people')], [C('{1인당 단가} * {인원}', '원')]], ['합계', '', [C('{1인당 단가} * {인원}', '원')]]]),
      hh(2, '추진 일정'),
      htable(['구분', '기간', '비고'], [['준비', '○. ○. ~ ○. ○.', ''], ['운영', '○. ○. ~ ○. ○.', ''], ['결과 보고', '○. ○.', '']]),
      hh(2, '행정 사항'),
      hul(['○○○'])
    ),
  // 결과보고서: 개요, 결과, 예산 집행(집행률 계산), 개선 사항, 향후 조치
  hresult: () =>
    hwpDoc(
      { preset: '보고서', vars: vars(['name', '사업명'], ['start', '시작일'], ['end', '종료일'], ['place', '장소'], ['plan', '계획 인원', '명'], ['actual', '참여 인원', '명'], ['budget', '예산', '원'], ['spent', '집행액', '원']) },
      hh(1, V('name'), ' 결과 보고'),
      quote(V('name'), ' 추진 결과를 보고하고자 함'),
      hh(2, '추진 개요'),
      hul(['기간: ', V('start'), ' ~ ', V('end')], ['장소: ', V('place')], ['참여: ', V('actual'), '(계획 ', V('plan'), ' 대비 ', C('{참여 인원} / {계획 인원} * 100', '%', 1), ')']),
      hh(2, '추진 결과'),
      hh(3, '주요 내용'),
      hul(['○○○']),
      hh(3, '성과'),
      hul(['○○○']),
      hh(2, '예산 집행'),
      htable(['구분', '예산', '집행액', '집행률'], [['계', [V('budget')], [V('spent')], [C('{집행액} / {예산} * 100', '%', 1)]]]),
      hh(2, '개선 사항'),
      hul(['○○○']),
      hh(2, '향후 조치'),
      hul(['○○○'])
    ),
  // 회의록(공문 항목 부호): 회의 개요 표, 안건, 논의 내용, 결정 사항, 향후 일정
  hminutes: () =>
    hwpDoc(
      { preset: '회의록', vars: vars(['name', '회의명'], ['when', '일시'], ['place', '장소'], ['people', '참석 인원', '명'], ['next', '다음 회의']) },
      hh(1, V('name'), ' 회의록'),
      htable(['구분', '내용'], [['일시', [V('when')]], ['장소', [V('place')]], ['참석자', ['○○○ 등 ', V('people')]], ['작성자', '○○○']]),
      hh(2, '안건'),
      hul(['제1호 안건: ○○○'], ['제2호 안건: ○○○']),
      hh(2, '논의 내용'),
      hul({ p: ['제1호 안건'], sub: [['○○○']] }, { p: ['제2호 안건'], sub: [['○○○']] }),
      hh(2, '결정 사항'),
      hul(['○○○(담당: ○○○, 기한: ○. ○.)']),
      hh(2, '향후 일정'),
      hul(['다음 회의: ', V('next')])
    ),
  // 통지(공문): 관련, 안내 사항(일시·장소·대상·신청), 문의
  hnotice: () =>
    hwpDoc(
      { preset: '통지', vars: vars(['title', '제목'], ['when', '일시'], ['place', '장소'], ['due', '신청 기한'], ['dept', '담당 부서'], ['tel', '연락처']) },
      hh(1, V('title'), ' 안내'),
      hul(
        ['관련: ○○○'],
        { p: ['○○○을 다음과 같이 안내합니다.'], sub: [['일시: ', V('when')], ['장소: ', V('place')], ['대상: ○○○'], ['신청 방법: ○○○(', V('due'), '까지)']] },
        ['문의: ', V('dept'), '(', V('tel'), ')']
      )
    ),
  // 보도자료: 머리(보도 시점, 담당), 제목, 요지(□), 본문
  hpress: () =>
    hwpDoc(
      {
        preset: '보도자료',
        vars: vars(['org', '기관명'], ['title', '제목'], ['release', '보도 시점'], ['dept', '담당 부서'], ['manager', '담당자'], ['tel', '연락처']),
        press: { release: '{보도 시점}', dept: '{담당 부서}', manager: '{담당자}', phone: '{연락처}' },
      },
      hh(1, V('title')),
      hul({ p: ['○○○ 기간 ○○○ 대상 ○○○ 운영'], sub: [['○○○']] }),
      hp(V('org'), '은 ○○○을 ○○○한다고 밝혔다.'),
      hp('○○○'),
      hp('붙임  사진 ○매.')
    ),
  // 업무보고: 일반 현황, 주요 업무 추진 상황, 현안 및 건의 사항
  hbiz: () =>
    hwpDoc(
      { preset: '업무보고', vars: vars(['dept', '부서명'], ['people', '인원', '명'], ['date', '보고일']) },
      hh(1, V('dept'), ' 주요 업무 보고'),
      hh(2, '일반 현황'),
      hul(['조직: ○○○'], ['인원: ', V('people')]),
      hh(2, '주요 업무 추진 상황'),
      hh(3, '○○○ 사업'),
      hul(['추진 실적: ○○○'], ['향후 계획: ○○○']),
      hh(2, '현안 및 건의 사항'),
      hul(['○○○'])
    ),
}
Object.assign(DOC_TEMPLATES, HWP_DOC_TEMPLATES)

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
  { id: 'gian', name: '기안문', sub: '한글 양식, 두문과 결문', hwp: true },
  { id: 'hreport', name: '보고서', sub: '한글 양식, 요약과 항목', hwp: true },
  { id: 'hplan', name: '계획서', sub: '한글 양식, 예산 자동 계산', hwp: true },
  { id: 'hresult', name: '결과보고서', sub: '한글 양식, 집행률 자동 계산', hwp: true },
  { id: 'hminutes', name: '회의록(한글)', sub: '한글 양식, 안건과 결정 사항', hwp: true },
  { id: 'hnotice', name: '통지(공문)', sub: '한글 양식, 안내 사항', hwp: true },
  { id: 'hpress', name: '보도자료', sub: '한글 양식, 보도 시점과 담당', hwp: true },
  { id: 'hbiz', name: '업무보고', sub: '한글 양식, 현황과 현안', hwp: true },
]

export const SHEET_TEMPLATE_META = [
  { id: 'blank', name: '빈 스프레드시트', sub: '' },
  { id: 'participants', name: '참여자 명단', sub: '순번, 학과, 학번, 참석' },
  { id: 'budget', name: '예산·물품 집행', sub: '단가 × 수량 자동 계산' },
  { id: 'judging', name: '출품작 심사채점표', sub: '나만 보기, 총점 자동', ownerOnly: true },
  { id: 'worklog', name: '근무 기록', sub: '날짜, 내용, 시간' },
  { id: 'files', name: '전시 제출물 관리', sub: '과목, 작품, 파일명' },
]
