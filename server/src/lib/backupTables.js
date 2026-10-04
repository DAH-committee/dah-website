// backupTables.js: 접수 데이터를 시트로 옮기기 좋은 표로 만든다.
// 전시회 접수 1장, 신청 폼마다 1장. 값은 모두 문자열이고, 객체와 배열은 사람이 읽을 수 있게 풀어 쓴다.
const FIELD_LABELS = {
  subject: '과목', course: '과목', name: '이름', student_no: '학번', student_id: '학번', major: '전공', majors: '전공',
  phone: '연락처', contact: '연락처', team: '팀명', team_name: '팀명', members: '팀원', work_title: '작품명', title: '작품명',
  work_desc: '작품 설명', description: '작품 설명', original_files: '원본 파일', note: '비고',
}
const ORDER = ['name', 'student_no', 'student_id', 'major', 'majors', 'team_name', 'team', 'members', 'phone', 'contact', 'subject', 'course', 'work_title', 'title', 'work_desc', 'description', 'original_files', 'note']

/** 셀 값 하나를 글로 만든다 */
export function cell(value) {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(cell).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    if (typeof value.url === 'string') return value.name ? `${value.name} (${value.url})` : value.url
    return Object.entries(value).map(([k, v]) => `${k}: ${cell(v)}`).join(' / ')
  }
  return String(value)
}

const iso = (v) => (v ? new Date(v).toISOString() : '')

export function exhibitionTable(entries) {
  const keys = []
  const seen = new Set()
  for (const e of entries) for (const k of Object.keys(e.fields || {})) if (!seen.has(k)) { seen.add(k); keys.push(k) }
  const idx = (k) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i }
  keys.sort((a, b) => idx(a) - idx(b))
  const header = ['번호', '접수일시', '수정일시', '학기', '유형', '이메일', ...keys.map((k) => FIELD_LABELS[k] || k)]
  const rows = entries.map((e) => [
    e.id, iso(e.created_at), iso(e.updated_at), e.semester_label || '', e.entry_type === 'team' ? '팀' : '개인', e.email || '',
    ...keys.map((k) => cell(e.fields?.[k])),
  ].map(String))
  return { name: '전시회 접수', header, rows }
}

export function formTable(form, responses) {
  const fields = (Array.isArray(form.fields) ? form.fields : []).filter((f) => f.type !== 'section').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const header = ['번호', '제출일시', '수정일시', '구글 계정', ...fields.map((f) => f.label_ko || f.id)]
  const rows = responses.map((r) => [r.id, iso(r.submitted_at), iso(r.updated_at), r.google_email || '', ...fields.map((f) => cell(r.data?.[f.id]))].map(String))
  return { name: `폼 ${form.id} ${form.title_ko || ''}`.trim(), header, rows }
}

export function buildBackup({ entries, forms }) {
  return {
    generated_at: new Date().toISOString(),
    tables: [exhibitionTable(entries), ...forms.map((f) => formTable(f.form, f.responses))],
  }
}
