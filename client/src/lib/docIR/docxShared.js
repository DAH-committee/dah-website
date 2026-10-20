// writeDocx / readDocx 가 함께 쓰는 값: 글꼴 표(대체 글꼴, 줄 높이 비율), XML 도우미, 단위.
// 순수 ESM, DOM 없음. 값의 출처와 측정 방법은 docx-notes.md 에 있다.

// 글꼴별 "워드 한 줄 높이 / 글자 크기" 비율 (lineK).
// 측정: 글꼴 파일의 hhea/OS2 표에서 (winAscent + winDescent + 바깥 줄 간격) / unitsPerEm.
//   바깥 줄 간격 = max(0, hhea.lineGap - ((winAscent + winDescent) - (hhea.ascender - hhea.descender)))
// 측정 파일: Microsoft Word.app/Contents/Resources/DFonts (malgun, batang, gulim, msgothic, arial, times, Calibri),
//           Hancom Office HWP.app/.../TTF (H2HDRM=HY헤드라인M, HYGTRE=HY견고딕, HMKMM=휴먼명조, HBatang=한컴바탕).
// measured:false 는 이 컴퓨터에서 파일을 못 찾아 같은 계열 값으로 추정한 것.
export const FONT_DB = [
  // 한국어 기본 글꼴 (워드가 Windows/Mac 모두 가진다)
  { names: ['맑은 고딕', 'Malgun Gothic'], canon: '맑은 고딕', en: 'Malgun Gothic', lineK: 1.3301, family: 'swiss', panose: '020B0503020000020004', charset: '81', safe: true, measured: true },
  { names: ['바탕', 'Batang'], canon: '바탕', en: 'Batang', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: true, measured: true },
  { names: ['바탕체', 'BatangChe'], canon: '바탕체', en: 'BatangChe', lineK: 1.1484, family: 'modern', panose: '02030609000101010101', charset: '81', pitch: 'fixed', safe: true, measured: true },
  { names: ['굴림', 'Gulim'], canon: '굴림', en: 'Gulim', lineK: 1.1484, family: 'swiss', panose: '020B0600000101010101', charset: '81', safe: true, measured: true },
  { names: ['굴림체', 'GulimChe'], canon: '굴림체', en: 'GulimChe', lineK: 1.1484, family: 'modern', panose: '020B0609000101010101', charset: '81', pitch: 'fixed', safe: true, measured: true },
  { names: ['돋움', 'Dotum'], canon: '돋움', en: 'Dotum', lineK: 1.1484, family: 'swiss', panose: '020B0600000101010101', charset: '81', safe: true, measured: true },
  { names: ['돋움체', 'DotumChe'], canon: '돋움체', en: 'DotumChe', lineK: 1.1484, family: 'modern', panose: '020B0609000101010101', charset: '81', pitch: 'fixed', safe: true, measured: true },
  { names: ['궁서', 'Gungsuh'], canon: '궁서', en: 'Gungsuh', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: true, measured: true },
  { names: ['MS Gothic', 'ＭＳ ゴシック'], canon: 'MS Gothic', en: 'MS Gothic', lineK: 1.0, family: 'modern', panose: '020B0609070205080204', charset: '80', pitch: 'fixed', safe: true, measured: true },
  // 한컴 글꼴 (워드에 없을 수 있다: altName 으로 대체를 유도)
  { names: ['함초롬바탕', 'HCR Batang', 'HamChoRom Batang'], canon: '함초롬바탕', en: 'HCR Batang', alt: '바탕', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: false, measured: false },
  { names: ['함초롬돋움', 'HCR Dotum', 'HamChoRom Dotum'], canon: '함초롬돋움', en: 'HCR Dotum', alt: '돋움', lineK: 1.1484, family: 'swiss', panose: '020B0600000101010101', charset: '81', safe: false, measured: false },
  { names: ['HY헤드라인M', 'HYHeadLine Medium', 'HYHeadLine M', 'HYHeadLine-Medium', 'HYHeadLine', 'HYHeadLineM'], canon: 'HY헤드라인M', en: 'HYHeadLine Medium', alt: 'HYHeadLine Medium', fallback: '맑은 고딕', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: false, measured: true },
  { names: ['HY견고딕', 'HYGothic-Extra', 'HYgtrE'], canon: 'HY견고딕', en: 'HYGothic-Extra', alt: 'HYGothic-Extra', fallback: '맑은 고딕', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: false, measured: true },
  { names: ['HY견명조', 'HYMyeongJo-Extra', 'HYmjrE'], canon: 'HY견명조', en: 'HYMyeongJo-Extra', alt: 'HYMyeongJo-Extra', fallback: '바탕', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: false, measured: true },
  { names: ['휴먼명조', 'HumanMyeongjo'], canon: '휴먼명조', en: 'HumanMyeongjo', alt: '바탕', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: false, measured: true },
  { names: ['휴먼고딕', 'HumanGothic'], canon: '휴먼고딕', en: 'HumanGothic', alt: '맑은 고딕', lineK: 1.1484, family: 'swiss', panose: '020B0600000101010101', charset: '81', safe: false, measured: true },
  { names: ['한컴바탕', 'Haansoft Batang'], canon: '한컴바탕', en: 'Haansoft Batang', alt: '바탕', lineK: 1.1484, family: 'roman', panose: '02030600000101010101', charset: '81', safe: false, measured: true },
  { names: ['한컴돋움', 'Haansoft Dotum'], canon: '한컴돋움', en: 'Haansoft Dotum', alt: '돋움', lineK: 1.1484, family: 'swiss', panose: '020B0600000101010101', charset: '81', safe: false, measured: true },
  // 영문 글꼴
  { names: ['Arial'], canon: 'Arial', en: 'Arial', lineK: 1.1499, family: 'swiss', panose: '020B0604020202020204', charset: '00', safe: true, measured: true },
  { names: ['Times New Roman'], canon: 'Times New Roman', en: 'Times New Roman', lineK: 1.1499, family: 'roman', panose: '02020603050405020304', charset: '00', safe: true, measured: true },
  { names: ['Calibri'], canon: 'Calibri', en: 'Calibri', lineK: 1.2207, family: 'swiss', panose: '020F0502020204030204', charset: '00', safe: true, measured: true },
  { names: ['Cambria'], canon: 'Cambria', en: 'Cambria', lineK: 1.1724, family: 'roman', panose: '02040503050406030204', charset: '00', safe: true, measured: true },
  { names: ['Consolas'], canon: 'Consolas', en: 'Consolas', lineK: 1.1709, family: 'modern', panose: '020B0609020204030204', charset: '00', pitch: 'fixed', safe: true, measured: true },
]

const NAME_INDEX = new Map()
for (const f of FONT_DB) for (const n of f.names) NAME_INDEX.set(n.toLowerCase().replace(/\s+/g, ''), f)

export function fontInfo(name) {
  if (!name) return null
  return NAME_INDEX.get(String(name).toLowerCase().replace(/\s+/g, '')) || null
}

// 읽을 때: 파일 속 글꼴 이름(영문/별칭)을 IR 에서 쓰는 이름으로. 모르면 그대로.
export function canonFontName(name) {
  const f = fontInfo(name)
  return f ? f.canon : name
}

// 한 줄 높이 비율. 모르는 글꼴은 null (호출 쪽에서 exact 로 돌린다)
export function lineHeightK(name) {
  const f = fontInfo(name)
  return f ? f.lineK : null
}

export const DEFAULT_CHECK_FONT = 'MS Gothic'

// 쓰기: percent(한글 방식) 줄 간격을 워드 auto 배수(w:line, 240=1줄)로.
//   한글 줄 피치 = size * percent/100,  워드 auto 피치 = size * lineK * (w:line/240)
//   => w:line = 240 * percent/100 / lineK
export function percentToAutoLine(percent, lineK) {
  return Math.max(1, Math.round((240 * percent) / 100 / lineK))
}
// 읽을 때 역변환: w:line(auto) -> percent
export function autoLineToPercent(wLine, lineK) {
  return Math.round(((wLine / 240) * lineK * 100) * 10) / 10
}

// ---- XML 도우미 ----
export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
// XML 1.0 에서 쓸 수 없는 제어 문자를 제거
export function cleanText(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
}

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
}

// 워드 형광펜 16색 (이름 -> hex). IR highlight 는 임의 색이라 정확히 같을 때만 w:highlight, 아니면 w:shd.
export const HIGHLIGHT_HEX = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000',
  darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF',
}

export function hex6(c) {
  if (!c) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(c).trim())
  if (m) return m[1].toUpperCase()
  const m3 = /^#?([0-9a-fA-F]{3})$/.exec(String(c).trim())
  if (m3) return m3[1].split('').map((x) => x + x).join('').toUpperCase()
  return null
}
