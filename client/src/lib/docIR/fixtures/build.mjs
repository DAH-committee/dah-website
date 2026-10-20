// 시험 문서(IR JSON) 생성기. 실행: node build.mjs  -> *.ir.json 을 같은 폴더에 쓴다.
// 이미지는 assets/*.png 를 base64 로 박는다. 실제 개인정보는 넣지 않는다(이름·연락처는 자리표시).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeIR } from '../schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const png = (name) => {
  const buf = fs.readFileSync(path.join(here, 'assets', name))
  // PNG 헤더에서 px 크기를 읽는다(IHDR: 16~23 바이트)
  return { mime: 'image/png', data: buf.toString('base64'), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

// ---------- 작은 도우미 ----------
const R = (text, o = {}) => ({ text, ...o })
const P = (runs, p = {}) => ({ t: 'p', runs: typeof runs === 'string' ? [R(runs)] : runs, ...p })
const B = (style = 'solid', widthPt = 0.5, color = '#000000') => ({ style, widthPt, color })
const ALL = (b) => ({ top: b, right: b, bottom: b, left: b })
const THIN = B()
const cell = (blocks, o = {}) => ({ blocks: Array.isArray(blocks) ? blocks : [blocks], ...o })
const textRuns = (text, r = {}) => text.split('\n').flatMap((seg, i) => (i === 0 ? [R(seg, r)] : [{ br: true }, R(seg, r)]))
const tc = (text, o = {}, p = {}, r = {}) => cell(P(textRuns(text, r), p), o)
const row = (cells, o = {}) => ({ cells, ...o })
const table = (colPt, rows, o = {}) => ({ t: 'table', widthPt: colPt.reduce((a, c) => a + c, 0), colPt, rows, border: THIN, padPt: { t: 2, r: 5.4, b: 2, l: 5.4 }, ...o })
const defaults = (o = {}) => ({ font: { ko: '맑은 고딕', latin: '맑은 고딕' }, sizePt: 10, lineSpacing: { mode: 'percent', value: 160 }, color: '#000000', align: 'left', ...o })
const finish = (ir) => {
  const { issues } = normalizeIR(ir)
  if (issues.length) throw new Error(`${ir.meta.title}: normalizeIR 문제 ${JSON.stringify(issues)}`)
  return ir
}

// ---------- a. 멘토링 보고서(화면 캡처 복제) ----------
function mentoring() {
  const HEAD = '#C5CCEB'
  const LABEL = '#DFE4F3'
  const hl = { highlight: '#FFFFFF' } // 캡처의 라벨 글자 뒤 흰 바탕
  const lab = (t, o = {}) => cell(P([R(t, hl)], { align: 'center' }), { bg: LABEL, vAlign: 'middle', ...o })
  const val = (t, o = {}, p = {}) => cell(P([R(t)], p), { vAlign: 'middle', ...o })
  const bullets = (arr, ls = 220) => arr.map((t) => P([R(t)], { align: 'justify', list: { kind: 'bullet', level: 0, marker: '▪' }, lineSpacing: { mode: 'percent', value: ls } }))
  const section = (title, n) => row([cell(P([R('□ ' + title, hl)]), { colspan: n, bg: HEAD, vAlign: 'middle' })], { heightPt: 29.5, heightRule: 'atLeast' })

  const t1 = table([85.6, 178.4, 77.2, 158.7], [
    section('멘토링 그룹 정보', 4),
    row([lab('학과(전공)'), val('디지털인문예술전공'), lab('교과목명'), val('서비스디자인')], { heightPt: 31, heightRule: 'atLeast' }),
    row([lab('그룹명'), val('온새마루 1기', { colspan: 3 })], { heightPt: 32, heightRule: 'atLeast' }),
    row([
      lab('활동 목표'),
      cell(bullets(['멘티 3명이 AI 개발 도구 Antigravity IDE와 Node.js를 각자 컴퓨터에 설치한다.', '설치를 마쳐 3주차의 IDE 화면 구성과 첫 작업 요청을 시작할 수 있는 상태를 만든다.']), { colspan: 3, vAlign: 'middle' }),
    ]),
  ])

  const longBullets = [
    '온라인(ZOOM)으로 진행했다. 학습 계획서 1주차 항목 가운데 사전 평가 이후 남은 개발 환경 설치를 이 주에 진행했다.',
    'Node.js 설치 후 터미널에서 버전을 확인하고, 패키지 관리자가 동작하는지 한 줄 명령으로 점검했다.',
    'Antigravity IDE를 내려받아 로그인과 작업 폴더 열기까지 화면을 공유하며 함께 따라 했다.',
    '설치 중 막힌 단계는 오류 문구를 그대로 복사해 검색하는 방법으로 해결 경로를 연습했다.',
    '멘티별 컴퓨터 환경(운영체제, 저장 공간)이 달라 설치 경로 안내를 따로 했다.',
    '활동 시간 안에 세 멘티 모두 IDE 첫 화면을 띄웠고, 폴더 열기까지 확인했다.',
    '설치가 끝난 뒤에는 각자 터미널을 열어 현재 위치를 확인하는 명령과 폴더를 만드는 명령을 한 번씩 입력해 보며 명령어 입력 방식에 익숙해지도록 했다.',
    '멘티들이 서로의 화면을 보며 같은 오류가 났을 때 해결한 방법을 공유했고, 멘토는 공통으로 막히는 단계만 정리해 다음 활동 자료에 넣기로 했다.',
    '마지막 30분에는 3주차 활동 전에 준비할 내용을 함께 정하고, 각자 해 올 과제를 한 줄로 말해 서로 확인했다.',
    '활동 내용은 활동 직후 공유 문서에 정리해 멘티 전원이 볼 수 있게 했다.',
  ]
  const nextBullets = [
    '3주차에는 IDE의 화면 구성(파일 목록, 편집 영역, 터미널)을 익히고 첫 작업 요청을 보낸다.',
    '요청문을 쓰는 방법을 짧은 예시 두 개로 연습하고, 결과를 서로 읽어 본다.',
    '설치가 끝나지 않은 멘티가 있으면 시간 전에 따로 만나 먼저 마친다.',
  ]
  const issueBullets = [
    '일부 멘티의 컴퓨터에서 설치 파일 내려받기가 오래 걸려 진행이 지연되었다.',
    '다음 주부터는 활동 전날 설치 파일을 미리 내려받도록 안내한다.',
  ]

  const t2 = table([84, 114.3, 128.9, 99.7, 72.8], [
    section('멘토링 활동 내용', 5),
    row([lab('멘토링 일시'), val('2026년 10월 7일(수), 20:00~23:00(3시간) ※ 주차 당 3시간 이상 활동', { colspan: 4 })], { heightPt: 36, heightRule: 'atLeast' }),
    row([
      lab('활동 방법'),
      cell(P([R('', { check: { checked: true } }), R(' 온라인(ZOOM)')]), { vAlign: 'middle' }),
      cell(P([R('', { check: { checked: false } }), R(' 오프라인')]), { vAlign: 'middle' }),
      lab('(멘티)출석 인원'),
      cell(P([R('3명 중 3명', { highlight: '#FFFF00' })]), { vAlign: 'middle' }),
    ], { heightPt: 36, heightRule: 'atLeast' }),
    row([lab('구분'), cell(P([R('세부 내용', hl)], { align: 'center' }), { colspan: 4, bg: LABEL, vAlign: 'middle' })], { heightPt: 31, heightRule: 'atLeast' }),
    row([cell(P([R('활동 내용')], { align: 'center' }), { bg: LABEL, vAlign: 'middle' }), cell(bullets(longBullets), { colspan: 4 })]),
    row([cell(P([R('차주 계획')], { align: 'center' }), { bg: LABEL, vAlign: 'middle' }), cell(bullets(nextBullets), { colspan: 4 })]),
    row([cell(P([R('특이 사항')], { align: 'center' }), { bg: LABEL, vAlign: 'middle' }), cell(bullets(issueBullets), { colspan: 4 })]),
  ])

  const gap = () => P([R('')], { lineSpacing: { mode: 'percent', value: 100 } })
  const t3 = table([84, 415.9], [
    section('멘토링 운영 의견', 2),
    row([lab('운영 의견'), cell(bullets(['활동 시간이 3시간으로 길어 중간 휴식 시간을 정해 두면 집중이 더 잘 유지된다.', '온라인 활동에서는 화면 공유 순서를 미리 정해 두면 시간이 줄어든다.']), { vAlign: 'middle' })]),
    row([lab('건의 사항'), cell(bullets(['설치 안내 문서를 활동 전날 미리 받아 볼 수 있으면 좋겠다.']), { vAlign: 'middle' })]),
  ])
  return finish({
    version: 1,
    meta: { created: '2026-10-12T00:00:00Z', title: '한림멘토링 활동 보고서(캡처 복제)' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 15, right: 16.5, bottom: 15, left: 16.5 }, headerMm: 8, footerMm: 8 },
    defaults: defaults({ sizePt: 10, lineSpacing: { mode: 'percent', value: 160 } }),
    body: [
      { t: 'figure', id: 'logo', wPt: 78.6, hPt: 26.2, align: 'right', caption: undefined },
      P([R('2026-2학기 한림멘토링 ( 2 )주차 활동 보고서', { font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' }, sizePt: 20 })], { align: 'center', spaceBeforePt: 10, spaceAfterPt: 10 }),
      gap(),
      t1,
      gap(),
      t2,
      gap(),
      t3,
    ],
    assets: { logo: png('logo.png') },
  })
}

// ---------- b. 공문 기안문 ----------
function gian() {
  const FONT = { ko: '맑은 고딕', latin: '맑은 고딕' }
  // 항목 부호: 글자로 직접 적고 내어쓰기로 정렬. 수준별 들여쓰기(pt)와 부호 폭
  const lv = [
    { left: 0, hang: 14 },
    { left: 14, hang: 14 },
    { left: 28, hang: 16 },
    { left: 44, hang: 16 },
  ]
  const item = (level, marker, text) => P([R(text)], {
    align: 'justify',
    indent: { leftPt: lv[level].left + lv[level].hang, rightPt: 0, firstLinePt: -lv[level].hang },
    list: { kind: 'ordered', level, marker },
    lineSpacing: { mode: 'percent', value: 160 },
  })
  const cen = (t, sz, o = {}, p = {}) => P([R(t, { sizePt: sz, ...o })], { align: 'center', ...p })
  const key = (t, extra = {}) => P([R(t)], { lineSpacing: { mode: 'percent', value: 160 }, ...extra })

  const approval = table([48, 64, 64, 64], [
    row([tc('구분', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('기안자', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('검토자', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('결재권자', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' })], { heightPt: 20, heightRule: 'atLeast' }),
    row([tc('직위(직급)', { vAlign: 'middle' }, { align: 'center' }, { sizePt: 9 }), tc('조교', { vAlign: 'middle' }, { align: 'center' }), tc('교수', { vAlign: 'middle' }, { align: 'center' }), tc('학과장', { vAlign: 'middle' }, { align: 'center' })], { heightPt: 22, heightRule: 'atLeast' }),
    row([tc('서명', { vAlign: 'middle' }, { align: 'center' }, { sizePt: 9 }), tc('', {}), tc('', {}), tc('', {})], { heightPt: 42, heightRule: 'exact' }),
    row([tc('결재일자', { vAlign: 'middle' }, { align: 'center' }, { sizePt: 9 }), tc('2026. 10. 12.', { vAlign: 'middle' }, { align: 'center' }, { sizePt: 8 }), tc('', {}), tc('', {})], { heightPt: 20, heightRule: 'atLeast' }),
  ], { align: 'right' })

  const foot = table([62, 150, 62, 207], [
    row([tc('협조자', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('', {}), tc('시행', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('디지털인문예술전공-0000 (2026. 10. 12.)', { vAlign: 'middle' })], { heightPt: 24, heightRule: 'atLeast' }),
    row([tc('우', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('00000 강원특별자치도 춘천시 한림대학길 1', { vAlign: 'middle', colspan: 3 })], { heightPt: 24, heightRule: 'atLeast' }),
    row([tc('전화', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('033-000-0000', { vAlign: 'middle' }), tc('전자우편', { bg: '#EEEEEE', vAlign: 'middle' }, { align: 'center' }), tc('example@example.ac.kr / 공개(대국민 공개)', { vAlign: 'middle' })], { heightPt: 24, heightRule: 'atLeast' }),
  ])

  return finish({
    version: 1,
    meta: { created: '2026-10-12T00:00:00Z', title: '기안문(공문) 시험' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 20, right: 20, bottom: 15, left: 20 }, headerMm: 10, footerMm: 10 },
    defaults: defaults({ font: FONT, sizePt: 11, lineSpacing: { mode: 'percent', value: 160 } }),
    body: [
      cen('디지털인문예술전공', 22, { bold: true, font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' } }, { spaceAfterPt: 8 }),
      key('수신  내부결재', { spaceAfterPt: 2 }),
      key('(경유)', { spaceAfterPt: 2 }),
      P([R('제목  ', { bold: true }), R('2026-2학기 한림멘토링 활동비 지출 및 활동 보고서 제출 건', { bold: true })], { spaceAfterPt: 10, lineSpacing: { mode: 'percent', value: 160 } }),
      item(0, '1.', '관련: 한림멘토링 운영 계획(2026. 9. 14.)과 한림대학교 학생 학습 지원 규정 제12조에 따른 사항입니다.'),
      item(0, '2.', '위 관련 근거에 따라 2026-2학기 한림멘토링 2주차 활동 결과를 다음과 같이 보고하오니 검토하여 주시기 바랍니다.'),
      item(1, '가.', '활동 일시: 2026. 10. 7.(수) 20:00 ~ 23:00(3시간), 온라인(ZOOM)'),
      item(1, '나.', '참여 인원: 멘토 1명, 멘티 3명(전원 출석). 활동 내용은 개발 환경 설치와 첫 화면 구성 확인으로, 설치 도중 막힌 단계는 오류 문구 검색과 화면 공유로 해결하였습니다.'),
      item(2, '1)', '설치 대상: Node.js, 코드 편집 도구.'),
      item(2, '2)', '확인 항목: 버전 확인, 작업 폴더 열기, 첫 실행.'),
      item(3, '가)', '버전 확인은 터미널에서 한 줄 명령으로 수행함.'),
      item(3, '나)', '설치 경로 안내는 컴퓨터 환경별로 따로 진행함.'),
      item(1, '다.', '다음 활동: 2026. 10. 14.(수) 20:00, 화면 구성과 첫 작업 요청 연습.'),
      item(0, '3.', '위 사항에 관한 증빙은 붙임 파일로 제출하며, 추가 서류가 필요한 경우 안내하여 주시기 바랍니다.'),
      P([R('붙임  1. 2주차 활동 보고서 1부.'), { text: '', br: true }, R('       2. 활동 사진 1부.  끝.')], { spaceBeforePt: 8, spaceAfterPt: 18, lineSpacing: { mode: 'percent', value: 160 }, indent: { leftPt: 0, rightPt: 0, firstLinePt: 0 } }),
      cen('디지털인문예술전공 학과장', 20, { bold: true, font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' } }, { spaceBeforePt: 14, spaceAfterPt: 12 }),
      approval,
      P([R('')], { lineSpacing: { mode: 'percent', value: 100 } }),
      foot,
    ],
    assets: {},
  })
}

// ---------- c. 계획서 ----------
function planReport() {
  const bl = (level, t, kind = 'bullet') => P([R(t)], { align: 'justify', list: { kind, level }, indent: { leftPt: 14 + level * 14, rightPt: 0, firstLinePt: -12 }, lineSpacing: { mode: 'percent', value: 150 } })
  const h = (t) => P([R(t, { bold: true, sizePt: 13 })], { heading: 2, spaceBeforePt: 14, spaceAfterPt: 4, keepNext: true, bg: '#E9EEFB' })
  // 예산표: 항목 / 산출 내역(단가, 수량, 횟수) / 금액
  const rows = [
    ['교육 자료 인쇄', 4000, 30, 1],
    ['간식비(활동 당)', 3000, 15, 4],
    ['외부 강사 사례', 150000, 1, 2],
    ['소모품(필기구, 메모지)', 1500, 20, 1],
  ]
  const fmt = (n) => n.toLocaleString('en-US')
  const right = { align: 'right' }
  const sum = rows.reduce((a, [, u, q, t]) => a + u * q * t, 0)
  const budget = table([40, 158, 76, 56, 56, 96], [
    row([tc('구분', { rowspan: 2, bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true }), tc('항목', { rowspan: 2, bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true }), tc('산출 내역', { colspan: 3, bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true }), tc('금액(원)', { rowspan: 2, bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true })], { header: true, heightPt: 22, heightRule: 'atLeast' }),
    row([tc('단가(원)', { bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true }), tc('수량', { bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true }), tc('횟수', { bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true })], { header: true, heightPt: 22, heightRule: 'atLeast' }),
    ...rows.map(([name, u, q, t], i) => row([
      ...(i === 0 ? [tc('운영비', { rowspan: rows.length, vAlign: 'middle' }, { align: 'center' })] : []),
      tc(name, { vAlign: 'middle' }),
      tc(fmt(u), { vAlign: 'middle' }, right),
      tc(String(q), { vAlign: 'middle' }, right),
      tc(String(t), { vAlign: 'middle' }, right),
      tc(fmt(u * q * t), { vAlign: 'middle' }, right),
    ], { heightPt: 22, heightRule: 'atLeast', cantSplit: true })),
    row([tc('합계', { colspan: 5, bg: '#F1F3FA', vAlign: 'middle' }, { align: 'center' }, { bold: true }), tc(fmt(sum), { bg: '#F1F3FA', vAlign: 'middle' }, right, { bold: true })], { heightPt: 24, heightRule: 'atLeast', cantSplit: true }),
  ])
  const info = table([90, 391.9], [
    row([tc('사업명', { bg: '#EEF1FA', vAlign: 'middle' }, { align: 'center' }), tc('2026-2학기 디지털인문예술전공 학습 커뮤니티 운영', { vAlign: 'middle' })], { heightPt: 26, heightRule: 'atLeast' }),
    row([tc('기간', { bg: '#EEF1FA', vAlign: 'middle' }, { align: 'center' }), tc('2026. 9. 14. ~ 2026. 12. 14.', { vAlign: 'middle' })], { heightPt: 26, heightRule: 'atLeast' }),
    row([tc('목적', { bg: '#EEF1FA', vAlign: 'middle' }, { align: 'center' }), tc('학년 간 학습 격차를 줄이고, 학과 구성원이 함께 쓰는 도구와 자료를 만든다.', { vAlign: 'middle' }, { align: 'justify' })], { heightPt: 26, heightRule: 'atLeast' }),
  ])
  return finish({
    version: 1,
    meta: { created: '2026-10-12T00:00:00Z', title: '계획서 시험' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 20, right: 20, bottom: 18, left: 20 }, headerMm: 10, footerMm: 10 },
    defaults: defaults({ sizePt: 10.5, lineSpacing: { mode: 'percent', value: 150 } }),
    footer: [P([R('- '), { field: 'page' }, R(' -')], { align: 'center', lineSpacing: { mode: 'percent', value: 100 } })],
    body: [
      P([R('학습 커뮤니티 운영 계획서', { sizePt: 22, bold: true, font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' } })], { align: 'center', spaceAfterPt: 14, heading: 1 }),
      info,
      h('1. 추진 배경'),
      bl(0, '학과 구성원이 학기 중 자료를 찾고 서로 묻는 경로가 흩어져 있어 한곳에 모을 필요가 있다.'),
      bl(1, '신입생이 과제 양식과 제출 방법을 알아내는 데 걸리는 시간을 줄인다.'),
      bl(2, '양식은 한글과 워드 양쪽으로 내려받을 수 있게 한다.'),
      bl(2, '쪽 수와 표 모양이 편집기와 같은지 확인한다.'),
      bl(1, '선배의 경험을 정리해 다음 학기에 이어 쓴다.'),
      h('2. 추진 내용'),
      bl(0, '정기 활동: 주 1회 3시간 이상, 온라인 또는 오프라인.'),
      bl(1, '활동 보고서는 활동 다음 날까지 작성한다.'),
      bl(0, '자료 정리: 활동마다 쓴 도구와 설치 순서를 문서로 남긴다.'),
      bl(1, '문서는 공용 저장소에 올린다.'),
      bl(0, '결과 공유: 학기 말 발표에서 활동 사례를 소개한다.'),
      { t: 'figure', id: 'fig1', wPt: 240, hPt: 150, align: 'center', caption: P([R('그림 1. 활동 단계별 참여 인원(자리표시)', { sizePt: 9 })], { align: 'center', spaceAfterPt: 6 }) },
      h('3. 소요 예산'),
      P([R('아래 표의 산출 내역은 단가 x 수량 x 횟수이며, 금액은 그 곱이다.', { sizePt: 9.5 })], { spaceAfterPt: 4 }),
      budget,
      h('4. 기대 효과'),
      bl(0, '구성원이 같은 양식과 같은 순서로 문서를 만들어 검토 시간이 줄어든다.'),
      bl(0, '활동 기록이 남아 다음 학기의 계획을 짜는 근거가 된다.'),
    ],
    assets: { fig1: png('figure.png') },
  })
}

// ---------- d. 표 시험 ----------
function tableTorture() {
  const W = 481.9 // A4, 좌우 20mm
  const caption = (t) => P([R(t, { bold: true, sizePt: 10 })], { spaceBeforePt: 10, spaceAfterPt: 4, keepNext: true })
  const c = (t, o = {}) => tc(t, { vAlign: 'middle', ...o }, { align: 'center', lineSpacing: { mode: 'percent', value: 130 } })
  const cols6 = [80.3, 80.3, 80.3, 80.3, 80.3, 80.4]
  // 1) 병합 모양 모음
  const merges = table(cols6, [
    row([c('가로 2칸', { colspan: 2, bg: '#FFF3BF' }), c('가로 3칸', { colspan: 3, bg: '#D3F9D8' }), c('A1')], { heightPt: 24, heightRule: 'atLeast' }),
    row([c('세로 3칸', { rowspan: 3, bg: '#FFE3E3' }), c('B1'), c('2x2 병합', { colspan: 2, rowspan: 2, bg: '#D0EBFF' }), c('B4'), c('B5')], { heightPt: 24, heightRule: 'atLeast' }),
    row([c('C1'), c('C4'), c('C5')], { heightPt: 24, heightRule: 'atLeast' }),
    row([c('D1'), c('3x2 병합', { colspan: 3, rowspan: 2, bg: '#E5DBFF' }), c('D5')], { heightPt: 24, heightRule: 'atLeast' }),
    row([c('세로 2칸', { rowspan: 2, bg: '#FFF3BF' }), c('E1'), c('E5')], { heightPt: 24, heightRule: 'atLeast' }),
    row([c('F1'), c('가로 4칸', { colspan: 4, bg: '#D3F9D8' })], { heightPt: 24, heightRule: 'atLeast' }),
  ])
  // 2) 칸별 선 모양
  const bd = (o) => ({ border: o, vAlign: 'middle' })
  const borders = table([96.4, 96.4, 96.4, 96.4, 96.3], [
    row([
      c('선 없음', bd(ALL(B('none', 0)))),
      c('이중선', bd(ALL(B('double', 2.25, '#000000')))),
      c('파선', bd(ALL(B('dashed', 1, '#C92A2A')))),
      c('점선', bd(ALL(B('dotted', 1, '#1864AB')))),
      c('굵은 선', bd(ALL(B('solid', 3, '#2B8A3E')))),
    ], { heightPt: 36, heightRule: 'atLeast' }),
    row([
      c('위만 굵게', bd({ top: B('solid', 3), right: THIN, bottom: THIN, left: THIN })),
      c('아래만 이중', bd({ top: THIN, right: THIN, bottom: B('double', 2.25), left: THIN })),
      c('왼쪽 없음', bd({ top: THIN, right: THIN, bottom: THIN, left: B('none', 0) })),
      c('오른쪽 파선', bd({ top: THIN, right: B('dashed', 1.5, '#E8590C'), bottom: THIN, left: THIN })),
      c('굵고 가는 선', bd(ALL(B('thick-thin', 3, '#000000')))),
    ], { heightPt: 36, heightRule: 'atLeast' }),
    row([
      c('대각선 \\', { border: { ...ALL(THIN), diagDown: B('solid', 0.75) }, vAlign: 'middle' }),
      c('대각선 /', { border: { ...ALL(THIN), diagUp: B('solid', 0.75) }, vAlign: 'middle' }),
      c('X 대각선', { border: { ...ALL(THIN), diagDown: B('solid', 0.75), diagUp: B('solid', 0.75) }, vAlign: 'middle' }),
      c('색 대각선', { border: { ...ALL(THIN), diagDown: B('dashed', 1, '#C92A2A') }, vAlign: 'middle' }),
      c('배경+선', { bg: '#FFF9DB', border: ALL(B('solid', 1.5, '#E67700')), vAlign: 'middle' }),
    ], { heightPt: 36, heightRule: 'atLeast' }),
  ])
  // 3) 세로쓰기와 칸 정렬
  const vert = table([36, 148.6, 148.6, 148.7], [
    row([cell(P([R('세로 글')], { align: 'center' }), { rowspan: 3, textDir: 'vertical', bg: '#EDF2FF', vAlign: 'middle' }), c('위 정렬', { vAlign: 'top' }), c('가운데 정렬'), c('아래 정렬', { vAlign: 'bottom' })], { heightPt: 54, heightRule: 'exact' }),
    row([c('여백 크게', { padPt: { t: 10, r: 20, b: 10, l: 20 }, bg: '#F8F9FA' }), c('한 칸에 두 줄\n두 번째 줄'), tc('오른쪽 정렬', { vAlign: 'middle' }, { align: 'right' })], { heightPt: 40, heightRule: 'atLeast' }),
    row([cell(P([R('세로쓰기 칸')], { align: 'center' }), { textDir: 'vertical', vAlign: 'middle' }), c('exact 높이 18pt, 글이 넘침: 이 칸의 글은 정해진 높이보다 길어서 한글과 워드가 다르게 잘라낼 수 있다.'), c('')], { heightPt: 18, heightRule: 'exact' }),
  ])
  // 4) 중첩 표
  const inner = table([70, 70, 70], [
    row([c('안 1', { bg: '#E7F5FF' }), c('안 2', { bg: '#E7F5FF' }), c('안 3', { bg: '#E7F5FF' })], { heightPt: 20, heightRule: 'atLeast' }),
    row([c('안 4', { colspan: 2 }), c('안 5')], { heightPt: 20, heightRule: 'atLeast' }),
  ], { padPt: { t: 1, r: 3, b: 1, l: 3 } })
  const nested = table([120, 361.9], [
    row([c('중첩 표가 든 칸', { bg: '#F1F3F5' }), cell([P([R('바깥 칸의 글 앞')]), inner, P([R('바깥 칸의 글 뒤')])], { vAlign: 'middle' })], { heightPt: 40, heightRule: 'atLeast' }),
    row([c('일반 칸'), c('중첩 표 아래 행: 중첩 표가 있어도 바깥 열 폭은 그대로여야 한다.')], { heightPt: 28, heightRule: 'atLeast' }),
  ])
  // 5) 한 쪽보다 큰 표. 제목 2행 반복, 행 쪼개짐 금지, 쪽 경계를 넘는 세로 병합
  const tallCols = [60, 90, 100, 231.9]
  const tallRows = [
    row([c('묶음', { rowspan: 2, bg: '#DDE3F5' }), c('식별', { colspan: 2, bg: '#DDE3F5' }), c('설명', { rowspan: 2, bg: '#DDE3F5' })], { header: true, heightPt: 22, heightRule: 'atLeast' }),
    row([c('번호', { bg: '#DDE3F5' }), c('이름', { bg: '#DDE3F5' })], { header: true, heightPt: 22, heightRule: 'atLeast' }),
  ]
  const lorem = '이 행은 여러 줄이 되도록 일부러 긴 설명을 넣는다. 한 행이 쪽 경계에서 반으로 갈라지지 않아야 하며, 제목 행이 다음 쪽 위에 다시 나와야 한다.'
  for (let i = 1; i <= 64; i++) {
    const spanStart = i === 24 // 쪽 경계 근처에서 5행짜리 세로 병합을 시작
    const covered = i > 24 && i < 29
    const cells = []
    if (spanStart) cells.push(c('쪽 경계를 가로지르는 5행 병합', { rowspan: 5, bg: '#FFF3BF' }))
    else if (!covered) cells.push(c(`묶음 ${Math.ceil(i / 8)}`))
    cells.push(c(String(i)), c(`항목 ${i}`), tc(i % 5 === 0 ? lorem : `행 ${i} 설명`, { vAlign: 'middle' }, { align: 'justify', lineSpacing: { mode: 'percent', value: 130 } }))
    tallRows.push(row(cells, { cantSplit: true, heightPt: 22, heightRule: 'atLeast' }))
  }
  const tall = table(tallCols, tallRows)
  return finish({
    version: 1,
    meta: { created: '2026-10-12T00:00:00Z', title: '표 시험(병합, 선, 중첩, 쪽 넘김)' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 20, right: 20, bottom: 15, left: 20 }, headerMm: 10, footerMm: 10 },
    defaults: defaults({ sizePt: 10, lineSpacing: { mode: 'percent', value: 130 } }),
    footer: [P([R('- '), { field: 'page' }, R(' / '), { field: 'pages' }, R(' -')], { align: 'center', lineSpacing: { mode: 'percent', value: 100 } })],
    body: [
      P([R('표 시험 문서', { sizePt: 18, bold: true })], { align: 'center', spaceAfterPt: 6 }),
      caption('1. 병합 모양 모음(가로, 세로, 2x2, 3x2)'),
      merges,
      caption('2. 칸별 선 모양과 대각선'),
      borders,
      caption('3. 세로쓰기, 정렬, 여백, 고정 높이'),
      vert,
      caption('4. 중첩 표'),
      nested,
      { t: 'p', runs: [R('아래 표는 새 쪽에서 시작한다. 제목 두 행이 반복되고, 5행짜리 세로 병합이 쪽 경계를 가로지른다.')], pageBreakBefore: true, spaceAfterPt: 6, keepNext: true },
      tall,
    ],
    assets: {},
  })
}

// ---------- e. 글꼴과 문단 ----------
function typography(landscape = false) {
  const KO_LONG = '디지털인문예술전공은 인문학의 질문을 디지털 도구와 예술적 표현으로 풀어내는 학과이다. 학생들은 글과 이미지, 소리, 코드를 함께 다루며 문화 자료를 새로운 방식으로 읽고 만든다. 이 문단은 줄 바꿈과 양쪽 맞춤, 줄 간격이 한글과 워드에서 같은 위치에서 끊기는지 확인하려고 일부러 길게 적었다.'
  const sec = (t) => P([R(t, { bold: true, sizePt: 12 })], { heading: 2, spaceBeforePt: 12, spaceAfterPt: 4, keepNext: true, bg: '#EEF1FA' })
  const sample = (label, runOpts, pOpts = {}) => P([R(label + ': ', { bold: true, sizePt: 9 }), R('가나다라마바사 ABC abc 123 한글과 English', runOpts)], pOpts)
  const body = []
  body.push(P([R('글꼴과 문단 시험 문서', { sizePt: 20, font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' } })], { align: 'center', spaceAfterPt: 8 }))

  if (!landscape) {
    body.push(sec('1. 글꼴'))
    for (const [ko, latin] of [['HY헤드라인M', 'HY헤드라인M'], ['함초롬바탕', 'Times New Roman'], ['맑은 고딕', '맑은 고딕'], ['굴림', 'Arial'], ['Times New Roman', 'Times New Roman']]) {
      body.push(sample(ko, { font: { ko, latin }, sizePt: 12 }))
    }
    body.push(sec('2. 장평(90, 100, 110)과 자간(-5, 0, +5)'))
    for (const sc of [90, 100, 110]) body.push(sample(`장평 ${sc}%`, { scalePct: sc }))
    for (const sp of [-5, 0, 5]) body.push(sample(`자간 ${sp}%`, { spacingPct: sp }))
    body.push(sec('3. 줄 간격(130, 160, 200%, 고정 18pt)과 맞춤'))
    for (const [lbl, ls] of [['130%', { mode: 'percent', value: 130 }], ['160%', { mode: 'percent', value: 160 }], ['200%', { mode: 'percent', value: 200 }], ['고정 18pt', { mode: 'exactPt', value: 18 }]]) {
      body.push(P([R(`[${lbl}] ` + KO_LONG)], { align: 'justify', lineSpacing: ls, spaceAfterPt: 4, indent: { leftPt: 0, rightPt: 0, firstLinePt: 10 } }))
    }
    for (const al of ['left', 'center', 'right', 'justify', 'distribute']) body.push(P([R(`맞춤 ${al}: 가나다라마바사 아자차카타파하`)], { align: al }))
    body.push(sec('4. 첨자, 강조, 밑줄, 형광펜, 취소선'))
    body.push(P([R('E=mc'), R('2', { sup: true }), R(' 그리고 H'), R('2', { sub: true }), R('O. '), R('굵게 ', { bold: true }), R('기울임 ', { italic: true }), R('굵은 기울임 ', { bold: true, italic: true }), R('취소선 ', { strike: true }), R('색 글자 ', { color: '#C92A2A' }), R('노란 형광펜 ', { highlight: '#FFFF00' }), R('하늘 형광펜', { highlight: '#A5D8FF' })]))
    body.push(P([R('한 줄 ', { underline: 'single' }), R('두 줄 ', { underline: 'double' }), R('점선 ', { underline: 'dotted' }), R('파선 ', { underline: 'dash' }), R('밑줄 모양 네 가지')]))
    body.push(sec('5. 탭, 하이퍼링크, 체크박스'))
    body.push(P([R('항목'), { tab: true }, R('값'), { tab: true }, R('비고')]))
    body.push(P([R('이름'), { tab: true }, R('디지털인문예술'), { tab: true }, R('탭 간격 확인')]))
    body.push(P([R('링크: '), R('한림대학교 누리집', { link: 'https://www.hallym.ac.kr', underline: 'single', color: '#1864AB' })]))
    body.push(P([R('', { check: { checked: true } }), R(' 확인함   '), R('', { check: { checked: false } }), R(' 확인 전   '), R('', { check: { checked: true } }), R(' 온라인(ZOOM)   '), R('', { check: { checked: false } }), R(' 오프라인')]))
    body.push(sec('6. 긴 한국어 문단(줄 바꿈 위치)'))
    body.push(P([R(KO_LONG + ' ' + KO_LONG)], { align: 'justify', indent: { leftPt: 0, rightPt: 0, firstLinePt: 10 } }))
    body.push(P([R('낱말 중간에서 끊기지 않는지 보기 위한 긴 영문 URL: https://example.com/a/very/long/path/that/keeps/going/and/going/and/going/index.html?query=1&another=two')], { align: 'justify' }))
  } else {
    body.push(sec('가로 쪽: 줄 간격과 맞춤'))
    body.push(P([R(KO_LONG + ' ' + KO_LONG)], { align: 'justify', lineSpacing: { mode: 'percent', value: 160 }, indent: { leftPt: 0, rightPt: 0, firstLinePt: 10 } }))
    body.push(P([R('쪽 번호 오른쪽 맞춤 확인'), { tab: true }, R('표는 아래')]))
    body.push(table([121, 121, 121, 121, 121, 121], [
      row([tc('가로 쪽 표', { colspan: 6, bg: '#DDE3F5', vAlign: 'middle' }, { align: 'center' }, { bold: true })], { heightPt: 24, heightRule: 'atLeast', header: true }),
      row(['A', 'B', 'C', 'D', 'E', 'F'].map((x) => tc(x, { vAlign: 'middle' }, { align: 'center' })), { heightPt: 24, heightRule: 'atLeast' }),
    ]))
  }
  return finish({
    version: 1,
    meta: { title: landscape ? '글꼴과 문단 시험(가로 쪽)' : '글꼴과 문단 시험' },
    page: { size: 'A4', orientation: landscape ? 'landscape' : 'portrait', marginMm: { top: 20, right: 20, bottom: 18, left: 20 }, headerMm: 10, footerMm: 10 },
    defaults: defaults({ sizePt: 10.5, lineSpacing: { mode: 'percent', value: 160 } }),
    header: [P([R('글꼴과 문단 시험 머리말', { sizePt: 9, color: '#555555' })], { align: 'right', lineSpacing: { mode: 'percent', value: 100 } })],
    footer: [P([R('- '), { field: 'page' }, R(' -')], { align: 'center', lineSpacing: { mode: 'percent', value: 100 } })],
    body,
    assets: {},
  })
}

const out = {
  'mentoring-report': mentoring(),
  gian: gian(),
  'plan-report': planReport(),
  'table-torture': tableTorture(),
  typography: typography(false),
  'typography-landscape': typography(true),
}
for (const [name, ir] of Object.entries(out)) {
  fs.writeFileSync(path.join(here, `${name}.ir.json`), JSON.stringify(ir, (k, v) => (v === undefined ? undefined : v), 1))
  console.log(name, fs.statSync(path.join(here, `${name}.ir.json`)).size, 'bytes')
}
