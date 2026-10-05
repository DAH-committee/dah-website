// EntriesSheet.jsx: 전시회 접수 관리 시트 (Y3-2, 33_PHASE18 → H1, 37_SHEET_ROADMAP → B1, 38_UI_FIX_BATCH. manager+)
// 어드민 "접수 현황 열기" → 새 탭 /admin/exhibition-entries/sheet. AdminLayout 밖 형제 라우트라
// 사이드바 없이 전체 폭을 쓴다.
//
// 화면과 동작은 구글 시트 방식의 공용 작업면(components/admin/sheet/SheetWorkspace)이 맡는다.
// 이 파일은 접수 데이터를 열과 행으로 바꾸고, 칸 수정, 행 추가, 행 삭제를 서버에 연결한다.
// 접수 정보(기간 설정)와 개인정보 초기화는 /admin/exhibition 화면에 그대로 있다.
//
// 표면: G4 밝은 읽기 표면(tokens.reading). 사이트 전역 다크 테마의 명시적 예외이며 색은 토큰 경유로만 쓴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SheetWorkspace from '../../components/admin/sheet/SheetWorkspace'
import { api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'

const POLL_MS = 20000

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
  id: 112,
  created_at: 170,
  updated_at: 170,
  semester_label: 110,
  entry_type: 104,
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


// 이 화면에서 고칠 수 없는 칸: 파일 목록과 팀원 목록은 구조가 있는 값이라 접수 폼에서만 고친다.
const READ_ONLY_FIELDS = new Set(['original_files', 'members'])

const SHEET_LABELS = { entries: '접수 현황', people: '접수자 정보' }

function EntriesSheet() {
  useTitle('접수 관리 시트')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

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

  // 20초마다 새로고침. 칸을 고치는 중에는 건너뛴다(입력 중인 값을 덮어쓰지 않게)
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
      load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // 접수 현황 열: 고정 열 + fields(jsonb)의 실제 키(FIELD_ORDER 순서)
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
          width: COLUMN_WIDTH[`fields.${key}`],
          get:
            key === 'original_files'
              ? (r) =>
                  (Array.isArray(r.fields?.original_files) ? r.fields.original_files : [])
                    .map((file) => file?.name || file?.url || '')
                    .filter(Boolean)
                    .join(', ')
              : (r) => cellText(r.fields?.[key]),
          patch: READ_ONLY_FIELDS.has(key) ? undefined : (value) => ({ fields: { [key]: value } }),
          order: fieldOrderIndex(key),
        })
      }
    }
    dynamic.sort((a, b) => a.order - b.order)
    return [
      { key: 'id', label: '번호', width: COLUMN_WIDTH.id, get: (r) => String(r.id) },
      { key: 'created_at', label: '접수일시', width: COLUMN_WIDTH.created_at, get: (r) => formatDateTime(r.created_at) },
      { key: 'updated_at', label: '수정일시', width: COLUMN_WIDTH.updated_at, get: (r) => formatDateTime(r.updated_at) },
      { key: 'semester_label', label: '학기', width: COLUMN_WIDTH.semester_label, get: (r) => cellText(r.semester_label), patch: (value) => ({ semester_label: value }) },
      { key: 'entry_type', label: '유형', width: COLUMN_WIDTH.entry_type, get: (r) => (r.entry_type === 'team' ? '팀' : '개인') },
      { key: 'email', label: '이메일', width: COLUMN_WIDTH.email, get: (r) => cellText(r.email), patch: (value) => ({ email: value }) },
      ...dynamic,
    ]
  }, [rows])

  // 접수자 정보 행 (B1-9): 접수 1건 = 1행인 원본을 "사람 단위"로 집계한다.
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
      const subject = cellText(row.fields?.subject).trim() || cellText(row.fields?.course).trim()
      if (subject && !person.subjects.includes(subject)) person.subjects.push(subject)
    }
    return [...map.values()]
  }, [rows])

  // 접수자 정보 열 (B1-9): 개인정보 5필드 + 본인이 접수한 과목 목록.
  // 41_AUTH_CONTRACT: 접수자 신원은 구글 계정이다. 이메일은 구글이 확인한 로그인 계정 값을
  // 서버가 접수 행에 채우므로, 여기 이메일과 이름이 곧 계정 신원이다.
  const peopleColumns = useMemo(
    () => [
      { key: 'person_no', label: '학번', width: COLUMN_WIDTH.person_no, get: (r) => r.studentNo },
      { key: 'person_major', label: '전공', width: COLUMN_WIDTH.person_major, get: (r) => r.major },
      { key: 'person_name', label: '이름', width: COLUMN_WIDTH.person_name, get: (r) => r.name },
      { key: 'email', label: '이메일', width: COLUMN_WIDTH.email, get: (r) => r.email },
      { key: 'person_phone', label: '전화번호', width: COLUMN_WIDTH.person_phone, get: (r) => r.phone },
      { key: 'person_subjects', label: '접수 과목', width: COLUMN_WIDTH.person_subjects, get: (r) => r.subjects.join(', ') },
    ],
    []
  )

  // 칸 수정: 서버에 저장하고 돌려받은 행으로 바꿔 끼운다
  const onEditCell = useCallback(async (row, col, value) => {
    const body = col.patch?.(value)
    if (!body) throw new Error('이 칸은 고칠 수 없습니다')
    const res = await api.put(`/admin/exhibition/entries/${row.id}`, body)
    setRows((prev) => prev.map((r) => (r.id === row.id ? res.entry : r)))
  }, [])

  const onInsertRow = useCallback(async () => {
    const res = await api.post('/admin/exhibition/entries', { semester_label: rows[0]?.semester_label || '' })
    // 새 행을 바로 목록 맨 위에 넣고 돌려준다(빈 행에 입력하면 이 행에 값이 들어간다)
    setRows((prev) => [res.entry, ...prev])
    return res.entry
  }, [rows])

  const onDeleteRows = useCallback(
    async (target) => {
      await api.post('/admin/exhibition/entries/delete', { ids: target.map((r) => r.id) })
      await load()
    },
    [load]
  )

  const sheets = useMemo(
    () => [
      { id: 'entries', label: SHEET_LABELS.entries, columns: entryColumns, rows, editable: true, allowCustom: true, unit: '건' },
      { id: 'people', label: SHEET_LABELS.people, columns: peopleColumns, rows: peopleRows, editable: false, allowCustom: false, unit: '명' },
    ],
    [entryColumns, peopleColumns, rows, peopleRows]
  )

  // DAH Sheet와 같은 "마지막으로 수정" 표시와 이동
  const [lastEdit, setLastEdit] = useState(null)
  const editTimer = useRef(null)
  useEffect(() => {
    api.get('/admin/exhibition/entries-last-edit').then((r) => setLastEdit(r.last_edit)).catch(() => {})
  }, [])
  const onCellEdited = useCallback((sheet, row, col) => {
    clearTimeout(editTimer.current)
    editTimer.current = setTimeout(() => {
      api.put('/admin/exhibition/entries-last-edit', { sheet, row: String(row), col }).then((r) => setLastEdit(r.last_edit)).catch(() => {})
    }, 900)
  }, [])

  return (
    <SheetWorkspace
      title="접수 관리 시트"
      stateKey="exhibition-entries"
      sheets={sheets}
      loading={loading}
      error={error}
      updatedAt={updatedAt ? new Date(updatedAt).toLocaleString('ko-KR') : ''}
      onRefresh={load}
      onEditCell={onEditCell}
      onInsertRow={onInsertRow}
      onDeleteRows={onDeleteRows}
      exportName="접수"
      homeHref="/workspace/sheets"
      lastEdit={lastEdit}
      onCellEdited={onCellEdited}
    />
  )
}

export default EntriesSheet
