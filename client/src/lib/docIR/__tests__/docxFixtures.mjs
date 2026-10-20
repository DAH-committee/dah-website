// docx 시험용 IR 만들기. 한림멘토링 활동 보고서(스크린샷)를 본뜬 문서가 핵심 시험 대상이다.
import zlib from 'node:zlib'

function crc32(buf) {
  let c; let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
// 단색 가로줄 무늬 PNG (로고 대용)
export function makePng(w, h, rgb = [0x3a, 0x8f, 0xb7]) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      const stripe = (y >> 2) % 2
      raw[o] = stripe ? 255 : rgb[0]; raw[o + 1] = stripe ? 255 : rgb[1]; raw[o + 2] = stripe ? 255 : rgb[2]
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

const BORDER = { style: 'solid', widthPt: 0.375, color: '#000000' }
const HEAD_BG = '#C0CDEF'
const LABEL_BG = '#E0E6F6'
const NONE = { style: 'none', widthPt: 0, color: '#000000' }

const t = (text, o = {}) => ({ text, ...o })
const p = (runs, o = {}) => ({ t: 'p', runs: Array.isArray(runs) ? runs : [runs], ...o })
const FONT = { ko: '한림체 Regular', latin: '한림체 Regular' }

function label(text, o = {}) {
  return { bg: LABEL_BG, vAlign: 'middle', blocks: [p(t(text), { align: 'center' })], ...o }
}
function value(blocks, o = {}) {
  return { vAlign: 'middle', blocks: Array.isArray(blocks) ? blocks : [p(t(blocks))], ...o }
}
function headRow(text) {
  return { heightPt: 27, cells: [{ colspan: 4, bg: HEAD_BG, vAlign: 'middle', padPt: { t: 3.4, r: 5.65, b: 3.4, l: 5.65 }, blocks: [p([t('▢'), t(' ' + text)])] }] }
}
function bullet(text, o = {}) {
  return p(t(text), { align: 'justify', list: { kind: 'bullet', level: 0, marker: '▪' }, indent: { leftPt: 10, firstLinePt: -10 }, lineSpacing: { mode: 'percent', value: 160 }, ...o })
}

// 스크린샷 보고서 복제: A4 세로, 위 오른쪽 로고(떠 있는 그림), 가운데 제목, 병합 제목 칸, 4칸 행, 항목 부호, 체크박스, 노란 형광펜, 쪽 번호 꼬리말
export function buildReportIR() {
  const logo = makePng(120, 36)
  const colPt = [85, 178.4, 77, 141.5] // 합 481.9 = A4 본문 폭(170mm)
  const table1 = {
    t: 'table', widthPt: 481.9, colPt, border: BORDER, padPt: { t: 1.4, r: 5.1, b: 1.4, l: 5.1 },
    rows: [
      headRow('멘토링 그룹 정보'),
      { heightPt: 28, cells: [label('학과(전공)'), value('디지털인문예술전공'), label('교과목명'), value('서비스디자인')] },
      { heightPt: 28, cells: [label('그룹명'), value('온새마루 1기', { colspan: 3 })] },
      {
        cells: [
          label('활동 목표'),
          value([
            bullet('멘티 3명이 AI 개발 도구 Antigravity IDE와 Node.js를 각자 컴퓨터에 설치한다.'),
            bullet('설치를 마쳐 3주차의 IDE 화면 구성과 첫 작업 요청을 시작할 수 있는 상태를 만든다.'),
          ], { colspan: 3 }),
        ],
      },
    ],
  }
  const table2 = {
    t: 'table', widthPt: 481.9, colPt, border: BORDER,
    rows: [
      headRow('멘토링 활동 내용'),
      { heightPt: 36, cells: [label('멘토링 일시'), value('2026년 10월 7일(수), 20:00~23:00(3시간) ※ 주차 당 3시간 이상 활동', { colspan: 3 })] },
      {
        heightPt: 36,
        cells: [
          label('활동 방법'),
          value([p([{ check: { checked: true } }, t(' 온라인(ZOOM)')])]),
          label('(멘티)출석 인원'),
          value([p([t('3명 중 3명', { highlight: '#FFFF00' }), t('  '), { check: { checked: false } }, t(' 오프라인')])]),
        ],
      },
      { cells: [label('구분', { rowspan: 2 }), label('세부 내용', { colspan: 3, bg: LABEL_BG })] },
      { cells: [value([bullet('온라인(ZOOM)으로 진행했다. 학습 계획서 1주차 항목 가운데 사전 평가 이후 남은 개발 환경 설치를 이 주에 진행했다.')], { colspan: 3 })] },
    ],
  }
  return {
    version: 1,
    meta: { title: '2026-2학기 한림멘토링 2주차 활동 보고서', author: '온새마루 1기' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 25, right: 20, bottom: 30, left: 20 }, headerMm: 10, footerMm: 15 },
    defaults: { font: FONT, sizePt: 10, lineSpacing: { mode: 'percent', value: 160 }, color: '#000000', align: 'left' },
    header: [p(t('한림대학교 디지털인문예술전공', { sizePt: 8, color: '#666666' }), { align: 'right', lineSpacing: { mode: 'percent', value: 120 } })],
    footer: [p([t('- '), { field: 'page' }, t(' / '), { field: 'pages' }, t(' -')], { align: 'center', lineSpacing: { mode: 'percent', value: 120 } })],
    body: [
      { t: 'figure', id: 'logo', wPt: 78, hPt: 23.4, alt: '한림대학교 로고', float: { x: 'right', y: 'top', wrap: 'square' } },
      p(t('2026-2학기 한림멘토링 ( 2 )주차 활동 보고서', { font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' }, sizePt: 15 }), { align: 'center', spaceBeforePt: 24, spaceAfterPt: 12, lineSpacing: { mode: 'percent', value: 130 }, heading: 1 }),
      table1,
      p([], {}),
      table2,
    ],
    assets: { logo: { mime: 'image/png', data: logo, w: 120, h: 36 } },
  }
}

// 기능 모음: 쪽 나눔, 링크, 탭, 위/아래 첨자, 서로 다른 줄 간격, 큰 글씨, 인라인 그림, 쪽 나눔, 중첩 표, 대각선, 세로 글
export function buildFeatureIR() {
  const img = makePng(60, 40, [0xc0, 0x40, 0x40])
  return {
    version: 1,
    meta: { title: '기능 시험', author: 'docIR' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 20, right: 20, bottom: 20, left: 20 }, headerMm: 10, footerMm: 10 },
    defaults: { font: { ko: '맑은 고딕', latin: 'Arial' }, sizePt: 10, lineSpacing: { mode: 'percent', value: 160 }, color: '#222222', align: 'justify' },
    body: [
      p([t('기능 시험 제목', { bold: true, sizePt: 18, font: { ko: '함초롬돋움', latin: 'Arial' } })], { heading: 1, align: 'center' }),
      p([t('굵게', { bold: true }), t(' 기울임', { italic: true }), t(' 밑줄', { underline: 'double' }), t(' 취소선', { strike: true }), t(' 색', { color: '#C00000' }), t(' 위첨자', { sup: true }), t(' 아래첨자', { sub: true }), t(' 장평80 자간-5', { scalePct: 80, spacingPct: -5 }), t(' 링크', { link: 'https://example.com/a?b=1&c=2' }), { tab: true }, t('탭 뒤'), { br: true }, t('줄바꿈 뒤')]),
      p(t('고정 간격 18pt'), { lineSpacing: { mode: 'exactPt', value: 18 } }),
      p(t('최소 간격 20pt'), { lineSpacing: { mode: 'atLeastPt', value: 20 } }),
      p(t('바탕체 120%', { font: { ko: '바탕', latin: 'Times New Roman' } }), { lineSpacing: { mode: 'percent', value: 120 } }),
      p([t('인라인 그림 '), { image: { id: 'im', wPt: 45, hPt: 30, alt: '빨간 그림' } }, t(' 뒤 글')]),
      p(t('첫째 항목'), { list: { kind: 'ordered', level: 0, marker: '1.' } }),
      p(t('둘째 수준 항목, 줄이 길어지면 내어쓰기로 정렬되어야 한다. 줄이 길어지면 내어쓰기로 정렬되어야 한다.'), { list: { kind: 'ordered', level: 1, marker: '가.' } }),
      p([{ check: { checked: true } }, t(' 확인함 '), { check: { checked: false } }, t(' 미확인')]),
      { t: 'pagebreak' },
      p(t('쪽 나눔 뒤 문단'), { keepNext: true }),
      {
        t: 'table', widthPt: 300, colPt: [100, 100, 100], align: 'center', border: { style: 'solid', widthPt: 0.5, color: '#444444' },
        rows: [
          { header: true, cantSplit: true, cells: [{ bg: '#DDDDDD', blocks: [p(t('A'))] }, { bg: '#DDDDDD', blocks: [p(t('B'))] }, { bg: '#DDDDDD', blocks: [p(t('C'))] }] },
          { heightPt: 40, heightRule: 'exact', cells: [{ rowspan: 2, vAlign: 'bottom', blocks: [p(t('세로 병합'))] }, { colspan: 2, border: { diagDown: { style: 'solid', widthPt: 0.5, color: '#FF0000' } }, blocks: [p(t('가로 병합 + 대각선'))] }] },
          { cells: [{ vAlign: 'middle', textDir: 'vertical', blocks: [p(t('세로글'))] }, { blocks: [p(t('중첩 표')), { t: 'table', widthPt: 60, colPt: [30, 30], border: BORDER, rows: [{ cells: [{ blocks: [p(t('x'))] }, { blocks: [p(t('y'))] }] }] }] }] },
        ],
      },
      {
        t: 'table', widthPt: 200, colPt: [100, 100], rows: [{ cells: [{ bg: '#FFF2CC', border: { bottom: { style: 'double', widthPt: 1.5, color: '#000000' } }, blocks: [p(t('표 둘'))] }, { padPt: { t: 6, r: 2, b: 6, l: 2 }, blocks: [p(t('여백 지정'))] }] }],
      },
      p(t('끝 문단'), { widow: true, pageBreakBefore: true }),
      { t: 'figure', id: 'im', wPt: 90, hPt: 60, align: 'center', alt: '가운데 그림', caption: p(t('그림 1. 캡션'), { align: 'center' }) },
    ],
    assets: { im: { mime: 'image/png', data: img, w: 60, h: 40 } },
  }
}
