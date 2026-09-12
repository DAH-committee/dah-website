// CurriculumAdmin.jsx — 교과목 대시보드 (H3-1~H3-3, 37_SHEET_ROADMAP)
// 좌: 전체 과목 목록(과목명 바로 옆에 편집·삭제) / 우: 학기 박스(그 학기 개설 과목).
// 좌→우 드래그는 "복사"다(원본 유지). 개설 정보는 semester_offerings에만 쌓이고
// curriculum(과목 원본)은 건드리지 않는다. 학기 전환·추가는 G3 SegmentControl.
//
// 터치 기기(pointer: coarse)에서는 draggable을 아예 걸지 않는다 — iOS Safari가
// draggable 요소 안의 버튼 탭을 삼킨다(DragHandle.jsx 주석 참조). 대신 각 행의
// "추가" 버튼이 드래그와 같은 동작을 한다(터치·키보드 공용 경로).

import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { api, useApi } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import SegmentControl from '../../components/common/SegmentControl'
import { useToast } from '../../components/common/Toast'
import {
  EmptyNote,
  ErrorText,
  Field,
  GhostButton,
  Input,
  PageHead,
  PrimaryButton,
  Select,
} from '../../components/admin/FormControls'

// B1 서버 계약 track 값: common | design | ai | culture (content-config 검증)
const TRACKS = [
  { value: 'common', label: '공통기초 (로드맵 최상단 고정)' },
  { value: 'design', label: 'Design Track' },
  { value: 'ai', label: 'AI Track' },
  { value: 'culture', label: 'Enter-Culture Track' },
]

const TRACK_LABEL = { common: '공통기초', design: '디자인', ai: 'AI', culture: '엔터컬처' }

// DB 필드명 grade는 호환성을 위해 유지하고, 운영 화면에서는 학습 수준으로 표기한다.
const LEVELS = [1, 2, 3, 4].map((n) => ({ value: String(n), label: `수준 ${n}` }))
const TERMS = [
  { value: '1', label: '1학기' },
  { value: '2', label: '2학기' },
]

const ICON_BTN =
  'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-24 md:w-24'

function emptyForm() {
  return { name_ko: '', name_en: '', grade: '1', semester: '1', credit: '', track: 'common', sort: 0 }
}

function fromItem(item) {
  return {
    name_ko: item.name_ko || '',
    name_en: item.name_en || '',
    grade: String(item.grade ?? 1),
    semester: String(item.semester ?? 1),
    credit: item.credit || '',
    track: item.track || 'common',
    sort: item.sort ?? 0,
  }
}

function toPayload(form) {
  return {
    ...form,
    grade: Number(form.grade),
    semester: Number(form.semester),
    sort: form.sort === '' ? 0 : Number(form.sort),
  }
}

// 로드맵과 동일 순서: 공통기초 최상단 → 수준 → 정렬
function sortFn(a, b) {
  const commonFirst = (a.track === 'common' ? 0 : 1) - (b.track === 'common' ? 0 : 1)
  return (
    commonFirst ||
    (a.grade ?? 0) - (b.grade ?? 0) ||
    (a.sort ?? 0) - (b.sort ?? 0) ||
    (a.id ?? 0) - (b.id ?? 0)
  )
}

const semKey = (s) => `${s.year}-${s.term}`
const semLabel = (s) => `${s.year}년 ${s.term}학기`

// 기본 선택 학기 — 상반기(1~6월) 1학기, 하반기 2학기
function defaultSemester() {
  const now = new Date()
  return { year: now.getFullYear(), term: now.getMonth() + 1 >= 7 ? 2 : 1 }
}

const coarsePointer =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

function CurriculumAdmin() {
  useTitle('교과목 관리')
  const toast = useToast()

  const { data, loading, error, offline, refetch } = useApi('/admin/content/curriculum', {
    params: { page: 1, pageSize: 100 },
  })
  const courses = useMemo(() => [...(data?.items || [])].sort(sortFn), [data])

  const [editing, setEditing] = useState(null) // null | 'new' | id
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const canSaveCourse = Boolean(form?.name_ko?.trim())

  const [selected, setSelected] = useState(defaultSemester)
  const [addedSemesters, setAddedSemesters] = useState([]) // 아직 개설 과목이 없는 신규 학기
  const [newSemester, setNewSemester] = useState(null) // { year, term } 입력 중

  const { data: semData, refetch: refetchSemesters } = useApi('/offerings/semesters')
  const {
    data: offData,
    loading: offLoading,
    refetch: refetchOfferings,
  } = useApi('/offerings', { params: { year: selected.year, term: selected.term } })

  const offerings = offData?.items || []
  const offeredIds = new Set(offerings.map((o) => o.curriculum_id))

  // 서버에 개설 이력이 있는 학기 + 화면에서 추가한 학기 + 현재 선택 학기
  const semesters = useMemo(() => {
    const map = new Map()
    for (const s of [...(semData?.items || []), ...addedSemesters, selected]) {
      const year = Number(s.year)
      const term = Number(s.term)
      if (!Number.isInteger(year) || (term !== 1 && term !== 2)) continue
      map.set(`${year}-${term}`, { year, term })
    }
    return [...map.values()].sort((a, b) => b.year - a.year || b.term - a.term)
  }, [semData, addedSemesters, selected])

  const openNew = () => {
    setSaveError(null)
    setForm(emptyForm())
    setEditing('new')
  }
  const openEdit = (item) => {
    setSaveError(null)
    setForm(fromItem(item))
    setEditing(item.id)
  }
  const close = () => {
    setEditing(null)
    setForm(null)
  }

  const save = async (e) => {
    e.preventDefault()
    if (!canSaveCourse || busy) return
    setBusy(true)
    setSaveError(null)
    try {
      const payload = toPayload(form)
      if (editing === 'new') await api.post('/admin/content/curriculum', payload)
      else await api.put(`/admin/content/curriculum/${editing}`, payload)
      close()
      refetch()
      refetchOfferings()
    } catch (err) {
      setSaveError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeCourse = async (item) => {
    if (!window.confirm(`${item.name_ko} 과목을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    try {
      await api.del(`/admin/content/curriculum/${item.id}`)
      if (editing === item.id) close()
      refetch()
      refetchOfferings()
      refetchSemesters()
    } catch (err) {
      toast(err.message)
    }
  }

  // 좌 → 우 배치(복사). 같은 학기 중복은 서버 유니크 제약 + 여기서 선차단.
  const addOffering = async (course) => {
    if (!course) return
    if (offeredIds.has(course.id)) {
      toast(`${semLabel(selected)}에 이미 있는 과목입니다`)
      return
    }
    try {
      await api.post('/admin/offerings', {
        year: selected.year,
        term: selected.term,
        curriculum_id: course.id,
      })
      refetchOfferings()
      refetchSemesters()
      toast(`${course.name_ko} · ${semLabel(selected)} 개설`)
    } catch (err) {
      toast(err.status === 409 ? `${semLabel(selected)}에 이미 있는 과목입니다` : err.message)
    }
  }

  const removeOffering = async (offering) => {
    try {
      await api.del(`/admin/offerings/${offering.id}`)
      refetchOfferings()
      refetchSemesters()
      toast(`${offering.name_ko} 개설 해제`)
    } catch (err) {
      toast(err.message)
    }
  }

  // 드래그(마우스 전용). 터치는 rowProps가 빈 객체라 draggable이 걸리지 않는다.
  const [dragId, setDragId] = useState(null)
  const [dropOver, setDropOver] = useState(false)

  const dragProps = (course) => {
    if (coarsePointer) return {}
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragId(course.id)
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('text/plain', String(course.id))
      },
      onDragEnd: () => {
        setDragId(null)
        setDropOver(false)
      },
    }
  }

  const dropProps = coarsePointer
    ? {}
    : {
        onDragOver: (e) => {
          if (dragId === null) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropOver) setDropOver(true)
        },
        onDragLeave: (e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return
          setDropOver(false)
        },
        onDrop: (e) => {
          e.preventDefault()
          const id = Number(e.dataTransfer.getData('text/plain')) || dragId
          setDragId(null)
          setDropOver(false)
          addOffering(courses.find((c) => c.id === id))
        },
      }

  const commitNewSemester = () => {
    const year = Number(newSemester?.year)
    const term = Number(newSemester?.term)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      toast('연도는 2000~2100 사이 숫자로 입력하세요')
      return
    }
    const next = { year, term: term === 2 ? 2 : 1 }
    setAddedSemesters((list) =>
      list.some((s) => s.year === next.year && s.term === next.term) ? list : [...list, next]
    )
    setSelected(next)
    setNewSemester(null)
    toast(`${semLabel(next)} 선택됨`)
  }

  const formPanel = form && (
    <form
      onSubmit={save}
      className="flex w-full flex-col gap-16 rounded-glass border border-glass-line bg-glass-bg p-24 backdrop-blur-glass-mobile"
    >
      <div className="flex items-center justify-between gap-16">
        <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">
          {editing === 'new' ? '과목 추가' : '과목 수정'}
        </h3>
        <button type="button" onClick={close} aria-label="닫기" className={ICON_BTN}>
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        <Field label="과목명 (국문)">
          <Input
            value={form.name_ko}
            onChange={(e) => setForm((p) => ({ ...p, name_ko: e.target.value }))}
            required
          />
        </Field>
        <Field label="과목명 (영문)">
          <Input
            value={form.name_en}
            onChange={(e) => setForm((p) => ({ ...p, name_en: e.target.value }))}
          />
        </Field>
        <Field label="수준">
          <Select
            value={form.grade}
            options={LEVELS}
            onChange={(e) => setForm((p) => ({ ...p, grade: e.target.value }))}
          />
        </Field>
        <Field label="학기">
          <Select
            value={form.semester}
            options={TERMS}
            onChange={(e) => setForm((p) => ({ ...p, semester: e.target.value }))}
          />
        </Field>
        <Field label="학점-강의-실습">
          <Input
            value={form.credit}
            placeholder="예: 3-2-2"
            onChange={(e) => setForm((p) => ({ ...p, credit: e.target.value }))}
          />
        </Field>
        <Field label="정렬 순서">
          <Input
            type="number"
            value={form.sort}
            onChange={(e) =>
              setForm((p) => ({ ...p, sort: e.target.value === '' ? '' : Number(e.target.value) }))
            }
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="트랙">
            <Select
              value={form.track}
              options={TRACKS}
              onChange={(e) => setForm((p) => ({ ...p, track: e.target.value }))}
            />
          </Field>
        </div>
      </div>
      <ErrorText>{saveError}</ErrorText>
      <div className="flex items-center gap-8">
        <PrimaryButton type="submit" disabled={busy || !canSaveCourse}>
          {busy ? '저장 중' : '저장'}
        </PrimaryButton>
        <GhostButton onClick={close}>취소</GhostButton>
      </div>
    </form>
  )

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title="교과목"
        desc="좌측은 전체 과목(수준·트랙·학점), 우측은 학기별 개설 목록입니다. 과목을 학기 박스로 끌어 놓거나 + 버튼을 누르면 그 학기에 개설됩니다. 원본 과목은 그대로 남습니다."
        offline={offline}
        actions={
          <GhostButton onClick={openNew}>
            <Plus size={16} aria-hidden="true" />
            과목 추가
          </GhostButton>
        }
      />

      {error && <ErrorText>{error.message}</ErrorText>}
      {editing === 'new' && formPanel}

      {/* H3-1: 좌 과목 목록 / 우 학기 박스 — 데스크탑 절반씩 */}
      <div className="grid grid-cols-1 items-start gap-24 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-12">
          <h3 className="font-mono text-label-m uppercase tracking-label text-text-meta">
            전체 과목 {courses.length > 0 && `(${courses.length})`}
          </h3>
          {loading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
          {!loading && !courses.length && <EmptyNote />}
          {courses.length > 0 && (
            <ul className="flex min-w-0 flex-col">
              {courses.map((item) => {
                if (editing === item.id && form) {
                  return (
                    <li key={item.id} className="border-b border-border-subtle py-12 first:border-t">
                      {formPanel}
                    </li>
                  )
                }
                const placed = offeredIds.has(item.id)
                return (
                  <li
                    key={item.id}
                    {...(editing === null ? dragProps(item) : {})}
                    className={`flex min-w-0 items-center gap-4 border-b border-border-subtle py-8 transition duration-fast ease-out first:border-t ${
                      dragId === item.id ? 'opacity-40' : ''
                    }`}
                  >
                    {/* H3-1: 과목명 바로 옆에 편집·삭제 — 이름과 버튼 사이 간격 최소화 */}
                    <span className="min-w-0 truncate text-body-m text-text-pri md:text-body-d">
                      {item.name_ko}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      aria-label={`${item.name_ko} 수정`}
                      className={ICON_BTN}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCourse(item)}
                      aria-label={`${item.name_ko} 삭제`}
                      className={ICON_BTN}
                    >
                      <Trash2 size={14} />
                    </button>
                    <span className="ml-auto shrink-0 pl-8 font-mono text-caption-m text-text-meta">
                      수준 {item.grade} · {TRACK_LABEL[item.track] || item.track}
                      {item.credit ? ` · ${item.credit}` : ''}
                    </span>
                    {/* H3-2: 터치·키보드용 동일 동작 경로 */}
                    <button
                      type="button"
                      onClick={() => addOffering(item)}
                      disabled={placed}
                      aria-label={`${item.name_ko}을(를) ${semLabel(selected)}에 추가`}
                      className={`${ICON_BTN} disabled:cursor-default disabled:opacity-30`}
                    >
                      <Plus size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* H3-2·H3-3: 학기 박스 — 드롭 대상. 상호작용에 크기가 변하지 않게 테두리 두께 고정
            A0(38_UI_FIX_BATCH): 좌측 과목 목록이 길어도 드롭 박스가 화면에서 사라지지 않게
            sticky. 상위 그리드가 items-start라 이 열의 높이가 내용만큼이고, 조상(main·
            Container·section)에 overflow가 없어 sticky가 실제로 걸린다. top은 고정 헤더
            높이(spacing.header) + 여백 24 — AdminLayout 사이드바(top-96)와 같은 선.
            박스가 뷰포트보다 길어지면 안쪽에서만 스크롤한다(사이드바와 동일 패턴).
            z-10은 sticky 층 — 드롭다운(30)·모달(100)보다 낮다. */}
        <div
          {...dropProps}
          className={`flex min-h-[320px] min-w-0 flex-col gap-16 rounded-glass border bg-glass-bg p-24 transition-colors duration-fast ease-out lg:sticky lg:top-[calc(theme(spacing.header)+theme(spacing.24))] lg:z-10 lg:max-h-[calc(100vh-theme(spacing.128))] lg:overflow-y-auto ${
            dropOver ? 'border-border-focus' : 'border-glass-line'
          }`}
        >
          <div className="flex flex-wrap items-center gap-8">
            <SegmentControl
              mode="single"
              options={semesters.map((s) => ({ value: semKey(s), label: semLabel(s) }))}
              value={semKey(selected)}
              onChange={(v) => {
                const [year, term] = v.split('-')
                setSelected({ year: Number(year), term: Number(term) })
              }}
              aria-label="대상 학기"
            />
            <GhostButton
              onClick={() =>
                setNewSemester((prev) => (prev ? null : { year: selected.year, term: '1' }))
              }
            >
              <Plus size={16} aria-hidden="true" />
              학기 추가
            </GhostButton>
          </div>

          {newSemester && (
            <div className="flex flex-wrap items-end gap-12 rounded-md border border-border-subtle p-16">
              <div className="w-[140px]">
                <Field label="연도">
                  <Input
                    type="number"
                    value={newSemester.year}
                    onChange={(e) => setNewSemester((p) => ({ ...p, year: e.target.value }))}
                  />
                </Field>
              </div>
              <SegmentControl
                mode="segment"
                options={TERMS}
                value={String(newSemester.term)}
                onChange={(v) => setNewSemester((p) => ({ ...p, term: v }))}
                aria-label="추가할 학기"
              />
              <PrimaryButton onClick={commitNewSemester}>확인</PrimaryButton>
            </div>
          )}

          <p className="font-mono text-caption-m text-text-meta">
            {semLabel(selected)} 개설 {offerings.length}과목
            {!coarsePointer && ' · 좌측 과목을 이 박스로 끌어 놓으세요'}
          </p>

          {offLoading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
          {!offLoading && !offerings.length && (
            <p className="py-24 font-mono text-caption-m text-text-meta">
              이 학기에 개설된 과목이 없습니다
            </p>
          )}
          {offerings.length > 0 && (
            <ul className="flex min-w-0 flex-col gap-8">
              {offerings.map((o) => (
                <li
                  key={o.id}
                  className="flex min-w-0 items-center gap-8 rounded-sm border border-border-subtle bg-bg-elev px-12 py-8"
                >
                  <span className="min-w-0 truncate text-body-m text-text-pri md:text-body-d">
                    {o.name_ko}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-caption-m text-text-meta">
                    수준 {o.grade} · {TRACK_LABEL[o.track] || o.track}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOffering(o)}
                    aria-label={`${o.name_ko} 개설 해제`}
                    className={ICON_BTN}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default CurriculumAdmin
