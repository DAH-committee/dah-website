// EntriesSheet.jsx — 전시회 접수 관리 시트 (Y3-2, 33_PHASE18 → H1, 37_SHEET_ROADMAP → B1, 38_UI_FIX_BATCH. admin+)
// 어드민 "접수 현황 열기" → 새 탭 /admin/exhibition-entries/sheet. AdminLayout 밖 형제 라우트라
// 사이드바 없이 전체 폭을 쓴다.
//
// 표면: G4 밝은 읽기 표면(tokens.reading) — bg-reading-* / text-reading-* / border-reading-*.
// 사이트 전역 다크 테마의 명시적 예외이며, 색은 전부 CI.md HEX를 토큰 경유로만 쓴다(HEX 하드코딩 금지).
//
// 레이아웃 불변 계약(37 절대원칙 4): 컬럼 폭은 colgroup + table-layout:fixed로 고정하고,
// 넘치는 폭은 페이지가 아니라 표 래퍼 내부 가로 스크롤로 격리한다. 필터 패널(포털)·토스트(fixed)
// 어느 동작에서도 컬럼 폭과 표 위치는 움직이지 않는다.
//
// B1(38_UI_FIX_BATCH) 폭·정렬 계약: 폭 상한(max-w-container-wide)을 두지 않는다. RESPONSIVE.md
// "작업 중심(관리 화면)은 전체 너비를 쓰되 데이터 테이블은 화면을 채운다" + 3840 요구 1("좌우 여백이
// 콘텐츠 너비보다 크지 않을 것")에 해당하기 때문이다. 대신 사이트 표준 거터
// (px-gutter-m / md:px-gutter-t / lg:px-gutter-d)를 좌우 마진선으로 삼아 툴바와 표가 같은 선에 선다.
//
// B1 표 렌더 계약: 표는 항상 렌더한다. 필터에서 값을 전부 해제해도 tbody만 비고 thead·컬럼 필터는
// 남아야 재선택으로 행을 되돌릴 수 있다(조건부 렌더로 표를 통째로 언마운트하면 필터 접근 경로가 사라진다).
// filterValues는 필터 적용 전 원본(sourceRows) 기준이라 전체 해제 후에도 후보값이 남는다.
//
// B1 셀 인터랙션: 클릭은 선택만 한다. 자동 클립보드 복사는 없고, 셀 텍스트가 선택 가능(select-text)이라
// 여러 셀을 드래그해 브라우저 네이티브 복사(Cmd/Ctrl+C)로 가져간다.
//
// 기능: 컬럼 헤더 필터·정렬(G1) · 검색 · 헤더 고정 · 셀 선택 · 빈 그리드 필러 ·
//       CSV·엑셀 내려받기 · 수동 새로고침 + 20초 자동 새로고침(상시) · 하단 시트 탭 ·
//       접수자 정보 탭(사람 단위 집계 + 과목 목록).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, RefreshCw } from 'lucide-react'
import ColumnFilter from '../../components/common/ColumnFilter'
import { useToast } from '../../components/common/Toast'
import { api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'

const POLL_MS = 20000
const DEFAULT_WIDTH = 180
// B1-4: 데이터가 적어도 스프레드시트처럼 보이도록 채우는 최소 행 수.
// 표 래퍼(max-h-[70dvh])를 채우는 정도만 잡는다 — 수백 행을 렌더하지 않는다.
// AR: 고정값 20은 세로가 긴 화면에서 부족했다(실측 3840x1200에서 그리드 773px / 허용 840px
// → 아래 67px이 빈 채로 남음). 래퍼 높이를 실측해 필요한 행 수를 계산하고, 20은 하한으로만
// 쓴다. 상한 200은 4K 세로(70dvh ≈ 1512px)까지 덮으면서 렌더 폭주를 막는 안전판이다.
const MIN_ROWS = 20
const MAX_FILLER_ROWS = 200
const FALLBACK_ROW_H = 37

// fields(jsonb) 키 → 화면 라벨. 접수 폼 스키마가 자유 구조라 미등록 키는 원문 키를 그대로 쓴다.
const FIELD_LABELS = {
  subject: '과목',
  course: '과목',
  name: '이름',
  student_no: '학번',
  student_id: '학번',
  major: '전공',
  majors: '전공',
  phone: '연락처',
  contact: '연락처',
  team: '팀명',
  team_name: '팀명',
  members: '팀원',
  work_title: '작품명',
  title: '작품명',
  work_desc: '작품 설명',
  description: '작품 설명',
  // 53_DRIVE_STORAGE(전시회 확장): 원본 파일 목록(Google Drive). 표에는 파일명만 보인다.
  original_files: '원본 파일',
  note: '비고',
}

// H1-4: 컬럼 순서 — 작품명이 작품 설명보다 반드시 왼쪽에 온다. 목록에 없는 키는 첫 등장 순서대로 뒤에.
const FIELD_ORDER = [
  'name',
  'student_no',
  'student_id',
  'major',
  'majors',
  'team_name',
  'team',
  'members',
  'phone',
  'contact',
  'subject',
  'course',
  'work_title',
  'title',
  'work_desc',
  'description',
  'original_files',
  'note',
]

// 컬럼 폭(px) — table-layout:fixed의 기준. 필터·선택에도 이 값은 변하지 않는다.
const COLUMN_WIDTH = {
  id: 72,
  created_at: 150,
  updated_at: 150,
  semester_label: 110,
  entry_type: 88,
  email: 220,
  'fields.name': 120,
  'fields.student_no': 120,
  'fields.student_id': 120,
  'fields.major': 150,
  'fields.majors': 150,
  'fields.team_name': 150,
  'fields.members': 260,
  'fields.phone': 140,
  'fields.contact': 140,
  'fields.subject': 200,
  'fields.course': 200,
  'fields.work_title': 220,
  'fields.title': 220,
  'fields.work_desc': 300,
  'fields.description': 300,
  'fields.original_files': 260,
  // B1-9 접수자 정보 탭(사람 단위 집계)
  person_no: 120,
  person_major: 150,
  person_name: 120,
  person_phone: 140,
  person_subjects: 320,
}

function cellText(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(cellText).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fieldOrderIndex(key) {
  const i = FIELD_ORDER.indexOf(key)
  return i < 0 ? FIELD_ORDER.length : i
}

// ── 접수자 인적사항 추출 (H1-6) ──────────────────────────────
// 개인 접수는 fields.name/major/student_no, 팀 접수는 fields.members[]에 인적사항이 들어온다.
function membersOf(row) {
  const m = row?.fields?.members
  return Array.isArray(m) ? m : []
}

function personField(row, key) {
  const solo = cellText(row?.fields?.[key]).trim()
  if (solo) return solo
  const list = membersOf(row)
    .map((m) => cellText(m?.[key]).trim())
    .filter(Boolean)
  return list.join(', ')
}

function personName(row) {
  return personField(row, 'name') || cellText(row?.fields?.team_name)
}

// 폼 스키마가 자유 구조라 같은 뜻의 키가 두 벌 존재한다(student_no/student_id, major/majors …).
// 원문 데이터는 그대로 두고 읽을 때만 대체 키를 훑는다.
function firstPersonField(row, keys) {
  for (const key of keys) {
    const v = personField(row, key)
    if (v) return v
  }
  return ''
}

// ── 내려받기 ────────────────────────────────────────────────
// CSV: 엑셀 한글 깨짐 방지를 위해 UTF-8 BOM + CRLF.
function toCsv(columns, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [columns.map((c) => esc(c.label)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => esc(c.get(row))).join(','))
  return `﻿${lines.join('\r\n')}`
}

// 엑셀: 새 npm 의존성 금지 규칙에 따라 SpreadsheetML 2003(XML)을 직접 생성한다.
// 확장자는 .xls — Excel·Numbers·Google Sheets가 그대로 연다(진짜 .xlsx zip 패키징은 미사용).
function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toSpreadsheetML(columns, rows, sheetName = '접수 현황') {
  const cell = (v) => `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`
  const head = `<Row>${columns.map((c) => cell(c.label)).join('')}</Row>`
  const body = rows
    .map((row) => `<Row>${columns.map((c) => cell(c.get(row))).join('')}</Row>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${xmlEscape(sheetName)}"><Table>${head}${body}</Table></Worksheet>
</Workbook>`
}

function download(content, filename, mime) {
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

// ── 페이지 ──────────────────────────────────────────────────
// B1-3: 툴바 버튼은 보더 없이 배경·hover만으로 구분한다(페이지 bg-reading-bg 위의 bg-reading-subtle 칩).
const BTN =
  'inline-flex h-40 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm bg-reading-subtle px-16 text-small-m font-semibold text-reading-text transition-colors duration-fast ease-out hover:bg-reading-surface hover:text-reading-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-reading-accent'

// B1-4: 셀 구분은 헤어라인 한 겹만. 얼룩말 배경 없이 흰 면 + 그리드(스프레드시트 표준).
const CELL = 'border-b border-r border-reading-hairline p-0 align-top'

const SHEETS = [
  { value: 'entries', label: '접수 현황' },
  { value: 'people', label: '접수자 정보' },
]

function EntriesSheet() {
  useTitle('접수 관리 시트')
  const showToast = useToast()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [q, setQ] = useState('')
  const [sheet, setSheet] = useState('entries')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState(null)
  // K3-2 다중 셀 선택 — anchor(드래그 시작)·focus(현재) 셀의 {r, c} 좌표.
  // 좌표는 visibleRows·columns의 인덱스라 표 폭·위치에 영향을 주지 않는다(레이아웃 시프트 0).
  const [range, setRange] = useState(null) // { anchor: {r,c}, focus: {r,c} } | null
  const dragging = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/exhibition/entries', { page: 1, pageSize: 500 })
      setRows(res?.items || [])
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // H1-2: 자동 새로고침은 토글 없이 항상 켜진 상태(20초 폴링)
  useEffect(() => {
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // 접수 현황 컬럼 — 고정 컬럼 + fields(jsonb) 실제 키(FIELD_ORDER 순서). 이미지 컬럼은 H1-4로 삭제.
  const entryColumns = useMemo(() => {
    const dynamic = []
    const seen = new Set()
    for (const row of rows) {
      const f = row.fields && typeof row.fields === 'object' ? row.fields : {}
      for (const key of Object.keys(f)) {
        if (seen.has(key)) continue
        seen.add(key)
        dynamic.push({
          key: `fields.${key}`,
          label: FIELD_LABELS[key] || key,
          get:
            key === 'original_files'
              ? (r) =>
                  (Array.isArray(r.fields?.original_files) ? r.fields.original_files : [])
                    .map((f) => f?.name || f?.url || '')
                    .filter(Boolean)
                    .join(', ')
              : (r) => cellText(r.fields?.[key]),
          order: fieldOrderIndex(key),
        })
      }
    }
    dynamic.sort((a, b) => a.order - b.order)
    return [
      { key: 'id', label: '번호', get: (r) => String(r.id) },
      { key: 'created_at', label: '접수일시', get: (r) => formatDateTime(r.created_at) },
      { key: 'updated_at', label: '수정일시', get: (r) => formatDateTime(r.updated_at) },
      { key: 'semester_label', label: '학기', get: (r) => cellText(r.semester_label) },
      { key: 'entry_type', label: '유형', get: (r) => (r.entry_type === 'team' ? '팀' : '개인') },
      { key: 'email', label: '이메일', get: (r) => cellText(r.email) },
      ...dynamic,
    ]
  }, [rows])

  // 접수자 정보 행 (B1-9) — 접수 1건 = 1행인 원본을 "사람 단위"로 집계한다.
  // 동일인 식별 키: 이메일 1순위, 없으면 학번+이름. 원본 데이터는 변형하지 않고 뷰만 만든다.
  const peopleRows = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      const email = cellText(row.email).trim()
      const studentNo = firstPersonField(row, ['student_no', 'student_id'])
      const name = personName(row)
      const key = email ? `email:${email.toLowerCase()}` : `person:${studentNo}|${name}`
      let person = map.get(key)
      if (!person) {
        person = {
          id: key,
          studentNo,
          major: firstPersonField(row, ['major', 'majors']),
          name,
          email,
          phone: firstPersonField(row, ['phone', 'contact']),
          subjects: [],
        }
        map.set(key, person)
      }
      // 같은 사람의 접수 건마다 채워진 필드가 다를 수 있어 비어 있는 값만 보충한다.
      if (!person.studentNo) person.studentNo = studentNo
      if (!person.major) person.major = firstPersonField(row, ['major', 'majors'])
      if (!person.name) person.name = name
      if (!person.phone) person.phone = firstPersonField(row, ['phone', 'contact'])
      const subject =
        cellText(row.fields?.subject).trim() || cellText(row.fields?.course).trim()
      if (subject && !person.subjects.includes(subject)) person.subjects.push(subject)
    }
    return [...map.values()]
  }, [rows])

  // 접수자 정보 컬럼 (B1-9) — 개인정보 5필드 + 본인이 접수한 과목 목록.
  // 41_AUTH_CONTRACT: 접수자 신원은 구글 계정이다. 이메일은 구글이 확인한 로그인 계정 값을
  // 서버가 접수 행에 채우므로, 여기 이메일과 이름이 곧 계정 신원이다.
  const peopleColumns = useMemo(
    () => [
      { key: 'person_no', label: '학번', get: (r) => r.studentNo },
      { key: 'person_major', label: '전공', get: (r) => r.major },
      { key: 'person_name', label: '이름', get: (r) => r.name },
      { key: 'email', label: '이메일', get: (r) => r.email },
      { key: 'person_phone', label: '전화번호', get: (r) => r.phone },
      { key: 'person_subjects', label: '접수 과목', get: (r) => r.subjects.join(', ') },
    ],
    []
  )

  const isPeople = sheet === 'people'
  const sourceRows = isPeople ? peopleRows : rows
  const columns = isPeople ? peopleColumns : entryColumns

  const columnWidth = useCallback((col) => COLUMN_WIDTH[col.key] || DEFAULT_WIDTH, [])
  const tableWidth = useMemo(
    () => columns.reduce((sum, col) => sum + columnWidth(col), 0),
    [columns, columnWidth]
  )

  // 필터 후보값 — 그 컬럼의 고유값(구글 시트 방식).
  // 필터 적용 전 sourceRows 기준이라 "전체 해제" 후에도 후보값이 남아 되돌릴 수 있다.
  const filterValues = useMemo(() => {
    const map = {}
    for (const col of columns) {
      const set = new Set()
      for (const row of sourceRows) set.add(col.get(row))
      map[col.key] = [...set].sort((a, b) => a.localeCompare(b, 'ko'))
    }
    return map
  }, [columns, sourceRows])

  const visibleRows = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    let list = sourceRows
    for (const col of columns) {
      const picked = filters[col.key]
      if (picked instanceof Set) list = list.filter((r) => picked.has(col.get(r)))
    }
    if (keyword) {
      list = list.filter((r) => columns.some((c) => c.get(r).toLowerCase().includes(keyword)))
    }
    if (!sort) return list
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return list
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const av = col.get(a)
      const bv = col.get(b)
      const an = Number(av)
      const bn = Number(bv)
      if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) {
        return (an - bn) * dir
      }
      return av.localeCompare(bv, 'ko') * dir
    })
  }, [sourceRows, columns, filters, q, sort])

  // B1-4: 데이터가 적어도 빈 셀 그리드로 표 영역을 채운다.
  // K3-1: 래퍼가 flex-1로 남은 세로를 항상 채우므로(콘텐츠에 맞춰 줄지 않음) 실측 clientHeight를
  // 그대로 기준으로 삼는다 — 행 수가 답을 되먹이던 고정점 문제가 사라진다.
  const wrapRef = useRef(null)
  const [fitRows, setFitRows] = useState(MIN_ROWS)
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current
      if (!el) return
      const cap = el.clientHeight
      if (!Number.isFinite(cap) || cap <= 0) return
      const rowH = el.querySelector('tbody tr')?.getBoundingClientRect().height || FALLBACK_ROW_H
      const headH = el.querySelector('thead')?.getBoundingClientRect().height || rowH
      const need = Math.ceil((cap - headH) / rowH)
      setFitRows(Math.min(MAX_FILLER_ROWS, Math.max(MIN_ROWS, need)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const fillerCount = Math.max(0, fitRows - visibleRows.length)

  const sheetLabel = SHEETS.find((s) => s.value === sheet)?.label || '접수 현황'
  const stamp = new Date().toISOString().slice(0, 10)
  const exportCsv = () =>
    download(
      toCsv(columns, visibleRows),
      `${sheetLabel}-${stamp}.csv`,
      'text/csv;charset=utf-8'
    )
  const exportExcel = () =>
    download(
      toSpreadsheetML(columns, visibleRows, sheetLabel),
      `${sheetLabel}-${stamp}.xls`,
      'application/vnd.ms-excel;charset=utf-8'
    )

  // 시트를 바꾸면 컬럼 체계가 통째로 달라져 이전 시트의 필터·정렬·선택은 의미가 없다.
  const changeSheet = (next) => {
    setSheet(next)
    setFilters({})
    setSort(null)
    setRange(null)
  }

  // K3-2 선택 범위 → TSV. 선택된 사각형을 visibleRows·columns 인덱스로 잘라
  // 행은 개행, 셀은 탭으로 이어 붙인다(구글 시트 붙여넣기 계약).
  // rangeBounds는 range에서만 파생되므로 memo로 참조를 고정한다(copyRange의 안정적 의존성).
  const rangeBounds = useMemo(
    () =>
      range && {
        r0: Math.min(range.anchor.r, range.focus.r),
        r1: Math.max(range.anchor.r, range.focus.r),
        c0: Math.min(range.anchor.c, range.focus.c),
        c1: Math.max(range.anchor.c, range.focus.c),
      },
    [range]
  )
  const inRange = (r, c) =>
    rangeBounds &&
    r >= rangeBounds.r0 &&
    r <= rangeBounds.r1 &&
    c >= rangeBounds.c0 &&
    c <= rangeBounds.c1

  const copyRange = useCallback(() => {
    if (!rangeBounds) return
    const lines = []
    for (let r = rangeBounds.r0; r <= rangeBounds.r1; r += 1) {
      const row = visibleRows[r]
      if (!row) continue
      const cells = []
      for (let c = rangeBounds.c0; c <= rangeBounds.c1; c += 1) {
        cells.push(columns[c] ? columns[c].get(row) : '')
      }
      lines.push(cells.join('\t'))
    }
    const tsv = lines.join('\n')
    if (!tsv) return
    // 토스트는 포털+fixed라 표를 밀지 않는다(레이아웃 시프트 0).
    navigator.clipboard?.writeText(tsv).then(
      () => showToast('선택한 셀을 복사했습니다'),
      () => showToast('복사에 실패했습니다')
    )
  }, [rangeBounds, visibleRows, columns, showToast])

  // Cmd/Ctrl+C — 텍스트 드래그 선택이 있으면 네이티브 복사를 방해하지 않는다.
  useEffect(() => {
    const onCopy = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        if (!range) return
        if (window.getSelection && String(window.getSelection())) return
        copyRange()
      }
    }
    window.addEventListener('keydown', onCopy)
    return () => window.removeEventListener('keydown', onCopy)
  }, [range, copyRange])

  // 드래그 종료는 표 밖에서 놓아도 잡히도록 window에 건다.
  useEffect(() => {
    const stop = () => {
      dragging.current = false
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // iOS Safari 동적 툴바 대응: 100vh는 주소창·툴바 접힘/펼침에 따라 값이 바뀌어
  // 레이아웃이 흔들린다 — 뷰포트 실측값을 반영하는 100dvh로 대체
  return (
    <div className="flex h-[100dvh] flex-col bg-reading-bg text-reading-text">
      {/* K3-1: 시트 컨테이너 높이를 뷰포트(100dvh)로 잡고 표는 내부 스크롤, 탭은 하단 고정.
          폭 상한 없음 + 표준 거터. 아래 모든 블록이 같은 좌우 마진선에 선다(B1-1·2). */}
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-16 px-gutter-m py-24 md:px-gutter-t lg:px-gutter-d">
        {/* 제목 */}
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="text-h2-m font-bold text-reading-textStrong md:text-h2-d">
            접수 관리 시트
          </h1>
          {/* J2: 건수는 크게, 갱신 정보는 작은 보조 텍스트로 분리. 가운데점·마침표 나열 금지. */}
          <p className="text-body-m text-reading-text">
            총 {sourceRows.length}
            {isPeople ? '명' : '건'} 중 {visibleRows.length}
            {isPeople ? '명' : '건'} 표시
          </p>
          <p className="font-mono text-caption-m text-reading-textMeta">
            20초마다 자동 갱신
            {updatedAt ? `, 마지막 갱신 ${formatDateTime(updatedAt)}` : ''}
          </p>
        </div>

        {/* 툴바 — 검색어는 좌측 마진선, 버튼은 우측 마진선에 붙는다(B1-2) */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-8">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색어"
            aria-label="검색어"
            className="h-40 w-full min-w-0 max-w-xs rounded-sm bg-reading-surface px-12 text-small-m text-reading-text outline-none transition-colors duration-fast ease-out placeholder:text-reading-textMeta focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-reading-accent md:flex-1"
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-8">
            <button
              type="button"
              onClick={copyRange}
              disabled={!range}
              className={`${BTN} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Copy size={16} aria-hidden="true" />
              복사
            </button>
            <button type="button" onClick={load} className={BTN}>
              <RefreshCw size={16} aria-hidden="true" />
              새로고침
            </button>
            <button type="button" onClick={exportCsv} className={BTN}>
              <Download size={16} aria-hidden="true" />
              CSV
            </button>
            <button type="button" onClick={exportExcel} className={BTN}>
              <Download size={16} aria-hidden="true" />
              엑셀
            </button>
          </div>
        </div>

        {/* 상태 문구는 표를 대체하지 않고 표 위에 함께 둔다(B1-8) */}
        {error && <p className="font-mono text-caption-m text-reading-accent">{error}</p>}
        {loading && <p className="font-mono text-caption-m text-reading-textMeta">불러오는 중</p>}
        {!loading && !error && visibleRows.length === 0 && (
          <p className="font-mono text-caption-m text-reading-textMeta">
            표시할 접수 내역이 없습니다
          </p>
        )}

        {/* 시트 — 가로 넘침은 이 래퍼 내부 스크롤로 격리(페이지 가로 스크롤 0).
            표는 항상 렌더한다: 필터를 전부 해제해도 thead·컬럼 필터는 남아야 되돌릴 수 있다(B1-8). */}
        <div
          ref={wrapRef}
          className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-sm border border-reading-hairline bg-reading-surface"
        >
          {/* colgroup 폭 합계를 최소폭으로 잡아 컬럼 폭을 고정한다. 래퍼가 더 넓으면
              남는 폭만 비례 분배되고(뷰포트 변화), 필터·선택에는 반응하지 않는다.
              border-separate: border-collapse에서는 sticky thead의 보더가 스크롤 시 사라진다. */}
          <table
            className="w-full table-fixed border-separate border-spacing-0 text-small-m"
            style={{ minWidth: tableWidth }}
          >
            <colgroup>
              {columns.map((col) => (
                <col key={col.key} style={{ width: columnWidth(col) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className="sticky top-0 z-10 border-b border-r border-reading-hairline bg-reading-subtle px-12 py-8 text-left"
                  >
                    <span className="flex items-center justify-between gap-4">
                      <span className="min-w-0 truncate font-semibold text-reading-text">
                        {col.label}
                      </span>
                      <ColumnFilter
                        label={col.label}
                        values={filterValues[col.key] || []}
                        selected={filters[col.key] ?? null}
                        onChange={(next) => setFilters((prev) => ({ ...prev, [col.key]: next }))}
                        sort={sort?.key === col.key ? sort.dir : null}
                        onSortChange={(dir) => setSort(dir ? { key: col.key, dir } : null)}
                      />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, r) => (
                <tr key={row.id}>
                  {columns.map((col, c) => {
                    const value = col.get(row)
                    const on = inRange(r, c)
                    return (
                      <td key={col.key} className={CELL}>
                        {/* K3-2: 좌클릭 드래그로 여러 셀·행 범위를 선택한다. mousedown이
                            anchor, mousedown 상태에서 지나간 셀이 focus가 되어 사각형이 커진다.
                            선택은 인덱스만 바꾸므로 표 폭·위치는 불변(레이아웃 시프트 0). */}
                        <div
                          tabIndex={0}
                          title={value}
                          onMouseDown={(e) => {
                            // 텍스트 드래그(네이티브 복사)와 충돌하지 않도록 셀 선택은
                            // 기본 텍스트 선택을 막고 범위 선택으로 전환한다.
                            e.preventDefault()
                            dragging.current = true
                            setRange({ anchor: { r, c }, focus: { r, c } })
                          }}
                          onMouseEnter={() => {
                            if (dragging.current) {
                              setRange((prev) =>
                                prev ? { ...prev, focus: { r, c } } : prev
                              )
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setRange({ anchor: { r, c }, focus: { r, c } })
                            }
                          }}
                          className={`block w-full cursor-cell truncate px-12 py-8 text-left text-reading-text transition-colors duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-reading-accent ${
                            on
                              ? 'bg-reading-accent/10 outline outline-2 outline-offset-[-2px] outline-reading-accent'
                              : 'outline-none hover:bg-reading-subtle'
                          }`}
                        >
                          {value}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {/* 필러 행 — 값이 없는 빈 그리드. 선택·복사 대상이 아니라 인터랙션을 걸지 않는다. */}
              {Array.from({ length: fillerCount }, (_, i) => (
                <tr key={`filler-${i}`} aria-hidden="true">
                  {columns.map((col) => (
                    <td key={col.key} className={CELL}>
                      <div className="block w-full truncate px-12 py-8">&nbsp;</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 하단 시트 탭 (H1-6, B1-3) — 보더 없이 선택된 탭만 배경으로 떠 보인다 */}
        <div className="flex flex-wrap items-center gap-4">
          {SHEETS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => changeSheet(item.value)}
              aria-pressed={sheet === item.value}
              className={`cursor-pointer rounded-sm px-16 py-8 text-small-m font-semibold transition-colors duration-fast ease-out ${
                sheet === item.value
                  ? 'bg-reading-surface text-reading-textStrong'
                  : 'text-reading-textMeta hover:text-reading-text'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default EntriesSheet
