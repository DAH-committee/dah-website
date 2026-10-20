// 한글 작성기/읽기 시험용 IR 만들기. 한림멘토링 활동 보고서(워드) 모양을 IR 로 옮긴 것이다.
import zlib from 'node:zlib'

function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
// 단색 가로 줄무늬 PNG(로고 대용). 외부 파일 없이 만든다
export function makePng(w, h, rgb = [40, 120, 160]) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      const stripe = Math.floor(y / 6) % 2 === 0
      raw[o] = stripe ? rgb[0] : 255
      raw[o + 1] = stripe ? rgb[1] : 255
      raw[o + 2] = stripe ? rgb[2] : 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  return new Uint8Array(png)
}

const thin = { style: 'solid', widthPt: 0.5, color: '#000000' }
const HEAD_BG = '#C2CAE8'
const LABEL_BG = '#E0E4F3'

const run = (text, o = {}) => ({ text, ...o })
const P = (runs, o = {}) => ({ t: 'p', runs: typeof runs === 'string' ? [run(runs)] : runs, ...o })
const cell = (blocks, o = {}) => ({ blocks: typeof blocks === 'string' ? [P(blocks)] : blocks, vAlign: 'middle', ...o })
const label = (text, o = {}) => cell([P(text, { align: 'center' })], { bg: LABEL_BG, ...o })
const bullets = (lines) => lines.map((l) => P(l, { align: 'justify', list: { kind: 'bullet', level: 0, marker: '▪' } }))

// 한림멘토링 활동 보고서와 같은 모양(IR 명세 README 의 규칙을 따른다)
export function mentoringReportIR() {
  const logo = makePng(230, 72)
  return {
    version: 1,
    meta: { title: '2026-2학기 한림멘토링 2주차 활동 보고서', author: '주현호' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 28, right: 14, bottom: 20, left: 20 }, headerMm: 12, footerMm: 12 },
    defaults: { font: { ko: '맑은 고딕', latin: '맑은 고딕' }, sizePt: 10, lineSpacing: { mode: 'percent', value: 160 }, color: '#000000', align: 'left' },
    footer: [P([{ field: 'page' }, { text: ' / ' }, { field: 'pages' }], { align: 'center', lineSpacing: { mode: 'percent', value: 100 } })],
    body: [
      { t: 'figure', id: 'logo', wPt: 115, hPt: 36, float: { x: 'right', y: 'top', wrap: 'none' } },
      P([run('2026-2학기 한림멘토링 [ 2 ]주차 활동 보고서', { bold: true, sizePt: 22, font: { ko: 'HY헤드라인M', latin: 'HY헤드라인M' } })], { align: 'center', lineSpacing: { mode: 'percent', value: 130 }, spaceBeforePt: 24 }),
      P('', {}),
      {
        t: 'table',
        widthPt: 499,
        colPt: [85, 178, 77, 159],
        border: thin,
        padPt: { t: 2, r: 5, b: 2, l: 5 },
        rows: [
          { cells: [cell([P([run('☐ ', { }), run('멘토링 그룹 정보', { bold: true })])], { colspan: 4, bg: HEAD_BG })] },
          { cells: [label('학과(전공)'), cell('디지털인문예술전공'), label('교과목명'), cell('서비스디자인')] },
          { cells: [label('그룹명'), cell('온새마루 1기', { colspan: 3 })] },
          {
            cells: [
              label('활동 목표'),
              cell(bullets(['멘티 3명이 AI 개발 도구 Antigravity IDE와 Node.js를 각자 컴퓨터에 설치한다.', '설치를 마쳐 3주차의 IDE 화면 구성과 첫 작업 요청을 시작할 수 있는 상태를 만든다.']), { colspan: 3, vAlign: 'top' }),
            ],
          },
        ],
      },
      P('', {}),
      {
        t: 'table',
        widthPt: 499,
        colPt: [84, 114, 128, 99, 74],
        border: thin,
        padPt: { t: 2, r: 5, b: 2, l: 5 },
        rows: [
          { cells: [cell([P([run('☐ ', {}), run('멘토링 활동 내용', { bold: true })])], { colspan: 5, bg: HEAD_BG })] },
          { cells: [label('멘토링 일시'), cell('2026년 10월 7일(수), 20:00~23:00(3시간) ※ 주차 당 3시간 이상 활동', { colspan: 4 })] },
          {
            cells: [
              label('활동 방법'),
              cell([P([{ check: { checked: true } }, run(' 온라인(ZOOM)')])]),
              cell([P([{ check: { checked: false } }, run(' 오프라인')])]),
              label('(멘티)출석 인원'),
              cell([P([run('3명 중 3명', { highlight: '#FFFF00' })])]),
            ],
          },
          { cells: [label('구분'), cell([P('세부 내용', { align: 'center' })], { colspan: 4, bg: LABEL_BG })] },
          {
            heightPt: 60,
            cells: [
              label('활동 내용', { rowspan: 2 }),
              cell(bullets(['온라인(ZOOM)으로 진행했다. 학습 계획서 1주차 항목 가운데 사전 평가 이후 남은 개발 환경 설치를 이 주에 진행했다.']), { colspan: 4, vAlign: 'top' }),
            ],
          },
          { cells: [cell(bullets(['다음 주에는 IDE 화면 구성과 첫 작업 요청 방법을 함께 익힌다.']), { colspan: 4, vAlign: 'top' })] },
        ],
      },
      P([run('※ 활동 사진 자료는 별도 첨부', { italic: true, sizePt: 9 }), { br: true }, run('문의: '), run('hallym.ac.kr', { link: 'https://www.hallym.ac.kr' })], { align: 'right', spaceBeforePt: 6 }),
    ],
    assets: { logo: { mime: 'image/png', data: logo, w: 230, h: 72 } },
  }
}

export function simpleIR() {
  return {
    version: 1,
    meta: { title: '간단 문서' },
    page: { size: 'A4', orientation: 'portrait', marginMm: { top: 25, right: 20, bottom: 20, left: 20 } },
    defaults: { font: { ko: '맑은 고딕', latin: '맑은 고딕' }, sizePt: 11, lineSpacing: { mode: 'percent', value: 160 }, color: '#000000', align: 'left' },
    body: [
      P([run('제목입니다', { bold: true, sizePt: 18 })], { align: 'center' }),
      P('본문 문단입니다. 한글 줄 간격은 글자 크기 기준 160퍼센트이다.', { align: 'justify' }),
      { t: 'pagebreak' },
      P([run('둘째 쪽의 문장.', { color: '#C00000', underline: 'single' })]),
    ],
    assets: {},
  }
}
