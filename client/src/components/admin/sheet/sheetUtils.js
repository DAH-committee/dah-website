// sheetUtils.js: 관리자 시트(구글 시트 방식)가 쓰는 순수 함수와 상수.
// 화면 상태 모양, 열 글자(A, B, ... AA), 표 복사와 붙여넣기(TSV), 내려받기 형식이 여기에 모여 있다.

/** 0부터 시작하는 열 번호를 A, B, ... Z, AA 로 바꾼다 */
export function colLetter(index) {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const m = (n - 1) % 26
    out = String.fromCharCode(65 + m) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** 셀 주소. 1행은 머리글이라 데이터 첫 행(r=0)은 2행이다. 예: (0, 0) -> A2 */
export function a1(r, c) {
  return `${colLetter(c)}${r + 2}`
}

/** 선택 범위 이름. 한 칸이면 A1, 여러 칸이면 A1:C3 */
export function rangeName(b) {
  if (!b) return ''
  const one = a1(b.r0, b.c0)
  return b.r0 === b.r1 && b.c0 === b.c1 ? one : `${one}:${a1(b.r1, b.c1)}`
}

/** 2차원 배열 -> 탭으로 나눈 글. 구글 시트와 엑셀에 그대로 붙여넣을 수 있다 */
export function toTsv(matrix) {
  const cell = (v) => {
    const s = String(v ?? '')
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return matrix.map((row) => row.map(cell).join('\t')).join('\n')
}

/** 탭으로 나눈 글 -> 2차원 배열. 따옴표로 감싼 칸 안의 줄바꿈과 탭을 지킨다 */
export function parseTsv(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === '\t') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** CSV. 엑셀에서 한글이 깨지지 않게 UTF-8 BOM과 CRLF를 쓴다 */
export function toCsv(matrix) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return `\uFEFF${matrix.map((row) => row.map(esc).join(',')).join('\r\n')}`
}

const xml = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 엑셀. 새 패키지 없이 SpreadsheetML(XML)로 만든다. 엑셀과 구글 시트가 그대로 연다 */
export function toSpreadsheetML(matrix, sheetName = '시트1') {
  const cell = (v) => `<Cell><Data ss:Type="String">${xml(v)}</Data></Cell>`
  const body = matrix.map((row) => `<Row>${row.map(cell).join('')}</Row>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${xml(sheetName).slice(0, 31)}"><Table>${body}</Table></Worksheet>
</Workbook>`
}

export function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 서식 색. 값은 이름만 저장하고 실제 색은 디자인 시스템 토큰 클래스로 칠한다.
// (Tailwind가 클래스를 찾을 수 있게 문자열을 통째로 적어 둔다)
export const TEXT_COLORS = [
  { key: '', label: '기본', swatch: 'bg-reading-text', cls: '' },
  { key: 'accent', label: '보라', swatch: 'bg-reading-accent', cls: 'text-reading-accent' },
  { key: 'meta', label: '회색', swatch: 'bg-reading-textMeta', cls: 'text-reading-textMeta' },
  { key: 'error', label: '빨강', swatch: 'bg-state-error', cls: 'text-state-error' },
]
export const FILL_COLORS = [
  { key: '', label: '없음', swatch: 'bg-reading-surface border border-reading-hairline', cls: '' },
  { key: 'subtle', label: '연한 회색', swatch: 'bg-reading-subtle', cls: 'bg-reading-subtle' },
  { key: 'accent', label: '연한 보라', swatch: 'bg-reading-accent/20', cls: 'bg-reading-accent/10' },
  { key: 'error', label: '연한 빨강', swatch: 'bg-state-error/20', cls: 'bg-state-error/10' },
]
export const FONT_SIZES = [12, 13, 14, 16, 18]
export const ZOOMS = [75, 90, 100, 125, 150]
export const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' }

/** 시트 하나의 기본 화면 상태 */
export function defaultSheetUi() {
  return {
    widths: {},
    hidden: [],
    freezeCols: 0,
    grid: true,
    wrap: false,
    zoom: 100,
    filtersOn: true,
    formats: {},
    customCols: [],
    customValues: {},
    notes: {},
  }
}

/** 서버에서 읽은 상태를 안전한 모양으로 맞춘다. 저장된 값이 깨져 있어도 화면이 죽지 않는다 */
export function normalizeSheetUi(raw) {
  const base = defaultSheetUi()
  if (!raw || typeof raw !== 'object') return base
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  const zoom = Number(raw.zoom)
  return {
    widths: Object.fromEntries(
      Object.entries(obj(raw.widths)).filter(([, w]) => Number.isFinite(Number(w))).map(([k, w]) => [k, Math.min(800, Math.max(48, Number(w)))])
    ),
    hidden: Array.isArray(raw.hidden) ? raw.hidden.map(String) : [],
    freezeCols: [0, 1, 2].includes(Number(raw.freezeCols)) ? Number(raw.freezeCols) : 0,
    grid: raw.grid !== false,
    wrap: raw.wrap === true,
    zoom: ZOOMS.includes(zoom) ? zoom : 100,
    filtersOn: raw.filtersOn !== false,
    formats: obj(raw.formats),
    customCols: Array.isArray(raw.customCols)
      ? raw.customCols.filter((c) => c && typeof c.key === 'string' && typeof c.label === 'string').map((c) => ({ key: c.key, label: c.label }))
      : [],
    customValues: obj(raw.customValues),
    notes: obj(raw.notes),
  }
}

/** 선택한 칸들이 모두 숫자면 합계를, 아니면 null을 돌려준다(구글 시트 아래쪽 요약) */
export function numericSum(values) {
  let sum = 0
  let count = 0
  for (const v of values) {
    const t = String(v ?? '').replace(/,/g, '').trim()
    if (t === '') continue
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    sum += n
    count += 1
  }
  return count ? sum : null
}
