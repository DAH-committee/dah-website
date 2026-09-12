// FormResponsesSheet.jsx: 자체 폼 응답 관리 시트 (39_FORM_BUILDER P3. admin+)
// 어드민 폼 목록 "응답 보기" → 새 탭 /admin/forms/:id/responses/sheet.
// AdminLayout 밖 형제 라우트라 사이드바 없이 전체 폭을 쓴다.
//
// EntriesSheet(접수 관리 시트)와 같은 표면과 계약을 그대로 따른다.
//   표면: G4 밝은 읽기 표면(tokens.reading)은 bg-reading-* / text-reading-* / border-reading-*.
//         사이트 전역 다크 테마의 명시적 예외이며 색은 CI.md HEX를 토큰 경유로만 쓴다.
//   레이아웃 불변 계약: 컬럼 폭은 colgroup + table-layout:fixed로 고정하고, 넘치는 폭은
//         페이지가 아니라 표 래퍼 내부 가로 스크롤로 격리한다(페이지 가로 스크롤 0).
//   표 렌더 계약: 표는 항상 렌더한다. 필터를 전부 해제해도 thead와 컬럼 필터는 남아야 되돌릴 수 있다.
//   셀 인터랙션: 좌클릭 드래그로 범위를 선택하고 복사 버튼 또는 Cmd/Ctrl+C로 TSV 복사.
//
// P3-2 컬럼 자동 생성: 컬럼은 form.fields에서 만든다(label_ko가 헤더, field.id가 키).
// 편집기에서 필드를 추가하거나 삭제하면 시트 컬럼도 코드 수정 없이 따라간다. checkbox 응답은
// 배열이라 표시할 때만 이어 붙인다(원본 데이터는 그대로 둔다).
//
// 41_AUTH_CONTRACT: 제출자 신원은 구글 계정이다. 비밀번호 방식은 폐지됐으므로 초기화 기능은 없다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Copy, Download, RefreshCw, Rows3, Trash2 } from 'lucide-react'
import ColumnFilter from '../../components/common/ColumnFilter'
import { useToast } from '../../components/common/Toast'
import { API_BASE, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'

const POLL_MS = 20000
const DEFAULT_WIDTH = 180
const MIN_ROWS = 20
const MAX_FILLER_ROWS = 200
const FALLBACK_ROW_H = 37

// 타입별 컬럼 폭(px). table-layout:fixed의 기준. 긴 답변(textarea)만 넓게 잡는다.
const TYPE_WIDTH = {
  textarea: 320,
  file: 220,
  email: 220,
  checkbox: 240,
  radio: 200,
  select: 180,
  phone: 140,
  studentid: 120,
  date: 130,
}

// 인적사항 탭에 담을 필드는 타입으로 판별하고, 이름은 타입이 없어 라벨로 본다.
const IDENTITY_TYPES = ['studentid', 'phone', 'email']
const NAME_LABEL_RE = /이름|성명|name/i

function isIdentityField(field) {
  if (IDENTITY_TYPES.includes(field.type)) return true
  return field.type === 'text' && NAME_LABEL_RE.test(field.label_ko || '')
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

// 툴바 버튼은 보더 없이 배경과 hover만으로 구분한다(페이지 bg-reading-bg 위의 bg-reading-subtle 칩).
const BTN =
  'inline-flex h-40 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm bg-reading-subtle px-16 text-small-m font-semibold text-reading-text transition-colors duration-fast ease-out hover:bg-reading-surface hover:text-reading-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-reading-accent'

const CELL = 'border-b border-r border-reading-hairline p-0 align-top'

const SHEETS = [
  { value: 'all', label: '응답 전체' },
  { value: 'identity', label: '응답자 인적사항' },
]

function FormResponsesSheet() {
  const { id } = useParams()
  const showToast = useToast()

  const [form, setForm] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [q, setQ] = useState('')
  const [sheet, setSheet] = useState('all')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState(null)
  // 긴 응답(자기소개, 지원 동기)은 한 줄로는 안 읽힌다. 행 확장은 셀을 줄바꿈 표시로 바꾼다.
  const [expanded, setExpanded] = useState(false)
  const [range, setRange] = useState(null) // { anchor: {r,c}, focus: {r,c} } | null
  const dragging = useRef(false)

  useTitle(form?.title_ko ? `${form.title_ko} 응답` : '폼 응답 시트')

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/forms/${id}/responses`)
      setForm(res?.form || null)
      // 번호는 받은 순서(최신순)로 매긴다. 서버 CSV 내보내기와 같은 기준.
      setRows((res?.items || []).map((r, i) => ({ ...r, seq: i + 1 })))
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  const resetResponses = async () => {
    const name = form?.title_ko || '이 폼'
    if (!window.confirm(`"${name}"의 응답 ${rows.length}건을 모두 지울까요?\n다른 행사·폼의 응답은 바뀌지 않으며, 이 작업은 되돌릴 수 없습니다.`)) return
    try {
      const result = await api.del(`/admin/forms/${id}/responses`)
      showToast(`${result.deleted ?? rows.length}건을 초기화했습니다`)
      await load()
    } catch (err) {
      showToast(err.message || '응답 초기화에 실패했습니다')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  // 자동 새로고침은 토글 없이 항상 켜진 상태(20초 폴링)
  useEffect(() => {
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // P3-2: 컬럼은 폼 정의에서 자동 생성한다. 필드가 바뀌면 이 memo가 다시 돌아 컬럼이 따라간다.
  const fields = useMemo(() => {
    const list = Array.isArray(form?.fields) ? form.fields : []
    return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, [form])

  const allColumns = useMemo(() => {
    const base = [
      { key: 'seq', label: '번호', width: 72, get: (r) => String(r.seq) },
      { key: 'google_email', label: '제출 계정', width: 220, get: (r) => cellText(r.google_email) },
      {
        key: 'submitted_at',
        label: '제출 시각',
        width: 150,
        get: (r) => formatDateTime(r.submitted_at),
      },
    ]
    return [
      ...base,
      ...fields.map((f) => ({
        key: `data.${f.id}`,
        label: f.label_ko || f.id,
        width: TYPE_WIDTH[f.type] || DEFAULT_WIDTH,
        // checkbox 응답은 배열이라 cellText가 표시용으로만 이어 붙인다.
        get: (r) => cellText(r.data?.[f.id]),
      })),
    ]
  }, [fields])

  // 인적사항 탭은 같은 행을 신원 컬럼만 잘라 본다(별도 집계 없음).
  const identityColumns = useMemo(() => {
    const keys = new Set(fields.filter(isIdentityField).map((f) => `data.${f.id}`))
    return allColumns.filter((c) => c.key === 'seq' || c.key === 'google_email' || keys.has(c.key))
  }, [allColumns, fields])

  const columns = sheet === 'identity' ? identityColumns : allColumns

  const tableWidth = useMemo(
    () => columns.reduce((sum, col) => sum + (col.width || DEFAULT_WIDTH), 0),
    [columns]
  )

  // 필터 후보값은 그 컬럼의 고유값(구글 시트 방식).
  // 필터 적용 전 rows 기준이라 "전체 해제" 후에도 후보값이 남아 되돌릴 수 있다.
  const filterValues = useMemo(() => {
    const map = {}
    for (const col of columns) {
      const set = new Set()
      for (const row of rows) set.add(col.get(row))
      map[col.key] = [...set].sort((a, b) => a.localeCompare(b, 'ko'))
    }
    return map
  }, [columns, rows])

  const visibleRows = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    let list = rows
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
  }, [rows, columns, filters, q, sort])

  // 데이터가 적어도 빈 셀 그리드로 표 영역을 채운다. 래퍼가 flex-1로 남은 세로를 항상 채우므로
  // 실측 clientHeight를 기준으로 필요한 행 수를 계산한다.
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

  // 행을 펼치면 행 높이가 제각각이라 빈 그리드로 채우지 않는다.
  const fillerCount = expanded ? 0 : Math.max(0, fitRows - visibleRows.length)

  // 내보내기는 서버 CSV(UTF-8 BOM)를 그대로 받는다. 브라우저에서 CSV를 다시 만들지 않는다.
  // 어드민 쿠키가 필요해 링크 대신 credentials 'include' fetch로 받아 내려받는다
  // (프로덕션은 cross-site 쿠키라 링크 방식이 브라우저 설정에 좌우된다).
  const exportCsv = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/forms/${id}/responses/export`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${form?.slug || `form-${id}`}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      showToast('CSV 내려받기에 실패했습니다')
    }
  }

  // 시트를 바꾸면 컬럼 체계가 달라져 이전 시트의 필터와 정렬, 선택은 의미가 없다.
  const changeSheet = (next) => {
    setSheet(next)
    setFilters({})
    setSort(null)
    setRange(null)
  }

  // 선택 범위 → TSV. 선택된 사각형을 visibleRows와 columns 인덱스로 잘라
  // 행은 개행, 셀은 탭으로 이어 붙인다(구글 시트 붙여넣기 계약).
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

  // Cmd/Ctrl+C는 텍스트 드래그 선택이 있으면 네이티브 복사를 방해하지 않는다.
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

  return (
    <div className="flex h-[100dvh] flex-col bg-reading-bg text-reading-text">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-16 px-gutter-m py-24 md:px-gutter-t lg:px-gutter-d">
        {/* 제목: 폼 제목이 곧 시트 제목이다(하드코딩 없음) */}
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="text-h2-m font-bold text-reading-textStrong md:text-h2-d">
            {form?.title_ko || '폼 응답'}
          </h1>
          <p className="text-body-m text-reading-text">
            총 {rows.length}건 중 {visibleRows.length}건 표시
          </p>
          <p className="font-mono text-caption-m text-reading-textMeta">
            20초마다 자동 갱신
            {updatedAt ? `, 마지막 갱신 ${formatDateTime(updatedAt)}` : ''}
          </p>
        </div>

        {/* 툴바: 검색어는 좌측 마진선, 버튼은 우측 마진선에 붙는다 */}
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
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-pressed={expanded}
              className={BTN}
            >
              <Rows3 size={16} aria-hidden="true" />
              {expanded ? '행 접기' : '행 펼치기'}
            </button>
            <button type="button" onClick={load} className={BTN}>
              <RefreshCw size={16} aria-hidden="true" />
              새로고침
            </button>
            <button type="button" onClick={exportCsv} className={BTN}>
              <Download size={16} aria-hidden="true" />
              CSV
            </button>
            <button type="button" onClick={resetResponses} disabled={!rows.length} className={`${BTN} text-state-error disabled:cursor-not-allowed disabled:opacity-50`}>
              <Trash2 size={16} aria-hidden="true" />
              이 폼 응답 초기화
            </button>
          </div>
        </div>

        {/* 상태 문구는 표를 대체하지 않고 표 위에 함께 둔다 */}
        {error && <p className="font-mono text-caption-m text-reading-accent">{error}</p>}
        {loading && <p className="font-mono text-caption-m text-reading-textMeta">불러오는 중</p>}
        {!loading && !error && visibleRows.length === 0 && (
          <p className="font-mono text-caption-m text-reading-textMeta">표시할 응답이 없습니다</p>
        )}

        {/* 시트: 가로 넘침은 이 래퍼 내부 스크롤로 격리(페이지 가로 스크롤 0).
            표는 항상 렌더한다: 필터를 전부 해제해도 thead와 컬럼 필터는 남아야 되돌릴 수 있다. */}
        <div
          ref={wrapRef}
          className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-sm border border-reading-hairline bg-reading-surface"
        >
          <table
            className="w-full table-fixed border-separate border-spacing-0 text-small-m"
            style={{ minWidth: tableWidth }}
          >
            <colgroup>
              {columns.map((col) => (
                <col key={col.key} style={{ width: col.width || DEFAULT_WIDTH }} />
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
                        {/* 좌클릭 드래그로 여러 셀과 행 범위를 선택한다. mousedown이 anchor,
                            지나간 셀이 focus가 되어 사각형이 커진다. 선택은 인덱스만 바꾸므로
                            표 폭과 위치는 불변(레이아웃 시프트 0). */}
                        <div
                          tabIndex={0}
                          title={value}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            dragging.current = true
                            setRange({ anchor: { r, c }, focus: { r, c } })
                          }}
                          onMouseEnter={() => {
                            if (dragging.current) {
                              setRange((prev) => (prev ? { ...prev, focus: { r, c } } : prev))
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setRange({ anchor: { r, c }, focus: { r, c } })
                            }
                          }}
                          className={`block w-full cursor-cell px-12 py-8 text-left text-reading-text transition-colors duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-reading-accent ${
                            expanded ? 'whitespace-pre-wrap break-words' : 'truncate'
                          } ${
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
              {/* 필러 행은 값이 없는 빈 그리드. 선택과 복사 대상이 아니라 인터랙션을 걸지 않는다. */}
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

        {/* 하단 시트 탭: 보더 없이 선택된 탭만 배경으로 떠 보인다 */}
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

export default FormResponsesSheet
