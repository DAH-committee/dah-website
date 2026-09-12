// FormEditor.jsx: 폼 편집기 (39_FORM_BUILDER P1-3)
// 기본 정보 + 접수 설정 + 필드 편집기 + FormRenderer 미리보기.
//
// 폼 내용은 전부 DB(custom_forms)에 있다. 새 폼을 만들 때 코드를 고치지 않아도 되게 하는 것이
// 이 화면의 목적이다. 저장 계약은 서버(routes/forms.js)의 PUT/POST /admin/forms.
//
// 공개 토글은 화면 상태만 바꾼다. 저장 버튼을 눌러야 반영된다(P1-3).
// 네이티브 select, date, radio, checkbox 금지. 전부 공용 커스텀 컴포넌트로 그린다.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Eye, FileText, Plus, Save, Trash2 } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import FormRenderer from '../../components/forms/FormRenderer'
import { DragHandle, useDragSort } from '../../components/common/DragHandle'
import {
  DateInput,
  ErrorText,
  Field,
  GhostButton,
  Input,
  PrimaryButton,
  Select,
  TextArea,
  Toggle,
} from '../../components/admin/FormControls'

export const CATEGORY_LABEL = { event: '행사', recruit: '모집', other: '기타' }
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))

// 서버 FIELD_TYPES와 같은 순서, 같은 값 (routes/forms.js)
const TYPE_LABEL = {
  text: '한 줄 입력',
  textarea: '여러 줄 입력',
  select: '드롭다운',
  radio: '객관식',
  checkbox: '다중 선택',
  phone: '연락처',
  email: '이메일',
  studentid: '학번',
  file: '파일',
  date: '날짜',
}
const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))
const OPTION_TYPES = ['select', 'radio', 'checkbox']

const PANEL = 'form-editor-panel flex flex-col gap-16 rounded-md border p-24 md:p-32'
const QUESTION_CARD =
  'form-editor-panel flex flex-col gap-16 rounded-md border border-l-4 border-l-[#7157d9] bg-white p-24 shadow-sm'
const ICON_BTN =
  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 md:h-32 md:w-32'

// ISO 와 캘린더 입력값('YYYY-MM-DDTHH:mm', 로컬 시간대) 변환. ExhibitionAdmin과 같은 계약
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null
}

/** 필드 1개 정규화. 부분 저장된 jsonb가 와도 편집 화면이 깨지지 않게 기본값을 채운다 */
function normField(f, i) {
  return {
    id: String(f?.id ?? `f${i + 1}`),
    label_ko: f?.label_ko ?? '',
    label_en: f?.label_en ?? '',
    type: TYPE_LABEL[f?.type] ? f.type : 'text',
    required: Boolean(f?.required),
    placeholder_ko: f?.placeholder_ko ?? '',
    placeholder_en: f?.placeholder_en ?? '',
    hint_ko: f?.hint_ko ?? '',
    hint_en: f?.hint_en ?? '',
    options: Array.isArray(f?.options) ? f.options : [],
    options_en: Array.isArray(f?.options_en) ? f.options_en : [],
    validation:
      f?.validation && typeof f.validation === 'object' && !Array.isArray(f.validation)
        ? f.validation
        : {},
    order: i + 1,
  }
}

const EMPTY = {
  slug: '',
  title_ko: '',
  title_en: '',
  description_ko: '',
  description_en: '',
  category: 'event',
  fields: [],
  published: false,
  settings: {
    accept_start: '',
    accept_end: '',
    edit_end: '',
    require_google_auth: true,
    max_responses: '',
    show_button_in_header: false,
    button_label_ko: '',
    button_label_en: '',
    drive_enabled: false,
    drive_folder_id: '',
    drive_auto_folder: false,
    drive_semester: '',
    drive_course: '',
    drive_share_mode: 'restricted',
  },
}

function fromItem(item) {
  const s = item.settings || {}
  return {
    slug: item.slug || '',
    title_ko: item.title_ko || '',
    title_en: item.title_en || '',
    description_ko: item.description_ko || '',
    description_en: item.description_en || '',
    category: CATEGORY_LABEL[item.category] ? item.category : 'other',
    fields: (Array.isArray(item.fields) ? item.fields : [])
      .slice()
      .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
      .map(normField),
    published: Boolean(item.published),
    settings: {
      accept_start: toLocalInput(s.accept_start),
      accept_end: toLocalInput(s.accept_end),
      edit_end: toLocalInput(s.edit_end),
      require_google_auth: s.require_google_auth !== false,
      max_responses: s.max_responses == null ? '' : String(s.max_responses),
      show_button_in_header: Boolean(s.show_button_in_header),
      button_label_ko: s.button_label_ko || '',
      button_label_en: s.button_label_en || '',
      drive_enabled: Boolean(s.drive_enabled),
      drive_folder_id: s.drive_folder_id || '',
      drive_auto_folder: Boolean(s.drive_auto_folder),
      drive_semester: s.drive_semester || '',
      drive_course: s.drive_course || '',
      drive_share_mode: s.drive_share_mode === 'link' ? 'link' : 'restricted',
    },
  }
}

function toPayload(form) {
  const s = form.settings
  return {
    slug: form.slug.trim(),
    title_ko: form.title_ko,
    title_en: form.title_en,
    description_ko: form.description_ko,
    description_en: form.description_en,
    category: form.category,
    published: form.published,
    // 화면에 보이는 순서가 곧 저장 순서. FormRenderer는 order 오름차순으로 그린다
    fields: form.fields.map((f, i) => ({ ...f, order: i + 1 })),
    settings: {
      accept_start: fromLocalInput(s.accept_start),
      accept_end: fromLocalInput(s.accept_end),
      edit_end: fromLocalInput(s.edit_end),
      require_google_auth: s.require_google_auth,
      max_responses: s.max_responses === '' ? null : Number(s.max_responses),
      show_button_in_header: s.show_button_in_header,
      button_label_ko: s.button_label_ko,
      button_label_en: s.button_label_en,
      drive_enabled: s.drive_enabled,
      drive_folder_id: s.drive_folder_id.trim(),
      drive_auto_folder: Boolean(s.drive_auto_folder),
      drive_semester: s.drive_semester.trim(),
      drive_course: s.drive_course.trim(),
      drive_share_mode: s.drive_share_mode,
    },
  }
}

/** 보기 목록 편집. select, radio, checkbox 전용. 추가, 삭제, 순서 변경 */
function OptionsEditor({ options, onChange }) {
  const move = (from, to) => {
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {options.map((opt, i) => (
        <div key={i} className="flex min-w-0 items-center gap-8">
          <Input
            value={opt}
            onChange={(e) => onChange(options.map((o, idx) => (idx === i ? e.target.value : o)))}
            aria-label={`보기 ${i + 1}`}
          />
          <button
            type="button"
            onClick={() => move(i, i - 1)}
            disabled={i === 0}
            aria-label={`보기 ${i + 1} 위로`}
            className={ICON_BTN}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            onClick={() => move(i, i + 1)}
            disabled={i === options.length - 1}
            aria-label={`보기 ${i + 1} 아래로`}
            className={ICON_BTN}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
            aria-label={`보기 ${i + 1} 삭제`}
            className={ICON_BTN}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <div>
        <GhostButton onClick={() => onChange([...options, ''])}>
          <Plus size={16} aria-hidden="true" />
          보기 추가
        </GhostButton>
      </div>
    </div>
  )
}

/** 필드 카드 1장 */
function FieldCard({ field, index, onChange, onRemove, dragging, over, rowProps, armed, onArm }) {
  const set = (key) => (v) => onChange({ ...field, [key]: v })
  const setInput = (key) => (e) => set(key)(e.target.value)
  const max = field.validation?.maxLength
  const rp = rowProps(index)

  return (
    <li
      {...rp}
      // 핸들을 누르는 동안에만 draggable. 카드 안 입력창의 텍스트 선택을 막지 않는다
      draggable={armed}
      onDragEnd={(e) => {
        onArm(false)
        rp.onDragEnd?.(e)
      }}
      className={`${QUESTION_CARD} transition duration-fast ease-out ${dragging ? 'opacity-40' : ''} ${
        over ? 'border-border-purple' : ''
      }`}
    >
      <div className="flex items-center gap-8 border-b border-border-subtle pb-16">
        <span
          // 터치 기기에서는 useDragSort가 드래그를 아예 걸지 않는다(rp.draggable 없음).
          // 그때 draggable을 켜면 iOS가 카드 안 탭을 삼키므로 무장 자체를 하지 않는다.
          onPointerDown={() => rp.draggable && onArm(true)}
          onPointerUp={() => onArm(false)}
          onPointerCancel={() => onArm(false)}
          className="flex items-center"
        >
          <DragHandle />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-caption-m text-text-meta">
          필드 {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`필드 ${index + 1} 삭제`}
          className={ICON_BTN}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        <Field label="라벨 (국문)">
          <Input value={field.label_ko} onChange={setInput('label_ko')} />
        </Field>
        <Field label="라벨 (영문)">
          <Input value={field.label_en} onChange={setInput('label_en')} />
        </Field>
        <Field label="타입">
          <Select
            value={field.type}
            options={TYPE_OPTIONS}
            onChange={(e) => set('type')(e.target.value)}
          />
        </Field>
        <Field label="필수">
          <Toggle
            checked={field.required}
            onChange={set('required')}
            label={`필드 ${index + 1} 필수 여부`}
          />
        </Field>
        <Field label="힌트" hint="입력창 아래 안내 문구">
          <Input value={field.hint_ko} onChange={setInput('hint_ko')} />
        </Field>
        <Field label="플레이스홀더">
          <Input value={field.placeholder_ko} onChange={setInput('placeholder_ko')} />
        </Field>

        {OPTION_TYPES.includes(field.type) && (
          <div className="md:col-span-2">
            <Field label="보기">
              <OptionsEditor options={field.options} onChange={set('options')} />
            </Field>
          </div>
        )}

        {field.type === 'textarea' && (
          <Field label="최대 글자 수" hint="비우면 제한 없음">
            <Input
              type="number"
              min="1"
              value={max ?? ''}
              onChange={(e) => {
                const v = e.target.value
                const next = { ...field.validation }
                if (v === '') delete next.maxLength
                else next.maxLength = Number(v)
                set('validation')(next)
              }}
            />
          </Field>
        )}
      </div>
    </li>
  )
}

function FormEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id
  useTitle(isNew ? '폼 만들기' : '폼 수정')

  const { data, loading, error, refetch } = useApi(isNew ? null : `/admin/forms/${id}`)
  // 새 폼도 곧바로 저장할 수 있도록 내부 주소를 기본 발급한다. 제목은 상단에서 바로 편집한다.
  const [form, setForm] = useState(() =>
    isNew ? { ...EMPTY, slug: `form-${Date.now().toString(36)}` } : EMPTY
  )
  const [hydrated, setHydrated] = useState(isNew)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const canSaveForm = Boolean(form.title_ko?.trim() && form.slug?.trim())
  const [preview, setPreview] = useState(false)
  const [previewValue, setPreviewValue] = useState({})
  const [armed, setArmed] = useState(null) // 드래그 준비된 필드 index

  useEffect(() => {
    if (hydrated || !data?.item) return
    setForm(fromItem(data.item))
    setHydrated(true)
  }, [hydrated, data])

  const set = (key) => (v) => setForm((prev) => ({ ...prev, [key]: v }))
  const setInput = (key) => (e) => set(key)(e.target.value)
  const setSetting = (key) => (v) =>
    setForm((prev) => ({ ...prev, settings: { ...prev.settings, [key]: v } }))
  const setSettingInput = (key) => (e) => setSetting(key)(e.target.value)

  const setFields = (fields) => setForm((prev) => ({ ...prev, fields }))
  const addField = () =>
    setFields([...form.fields, normField({ id: `f${Date.now().toString(36)}` }, form.fields.length)])

  const { dragIndex, overIndex, rowProps } = useDragSort((from, to) => {
    const next = [...form.fields]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setFields(next)
  })

  const backTo = '/admin/forms'

  const save = async (e) => {
    e.preventDefault()
    if (!canSaveForm || busy) return
    setBusy(true)
    setSaveError(null)
    try {
      const payload = toPayload(form)
      if (isNew) await api.post('/admin/forms', payload)
      else await api.put(`/admin/forms/${id}`, payload)
      navigate(backTo)
    } catch (err) {
      setSaveError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="form-workspace isolate min-h-[100dvh] bg-[#f5f2ff] px-16 py-16 md:px-32 md:py-24">
      <header className="sticky top-0 z-20 -mx-16 mb-24 flex min-h-64 items-center justify-between gap-16 border-b border-[#ded8ef] bg-[#f5f2ff]/95 px-16 py-12 backdrop-blur md:-mx-32 md:px-32">
        <div className="flex min-w-0 items-center gap-12">
          <FileText size={22} className="shrink-0 text-[#7157d9]" aria-hidden="true" />
          <div className="min-w-0">
            <input
              aria-label="폼 제목"
              autoFocus={isNew}
              value={form.title_ko}
              onChange={setInput('title_ko')}
              placeholder="새 신청 폼"
              className="w-full min-w-0 rounded-sm border border-transparent bg-transparent px-8 py-4 text-body-l-m font-bold text-[#29253a] outline-none transition placeholder:text-[#756d88] hover:border-[#d8d1ed] focus:border-[#7157d9] focus:bg-white focus:ring-2 focus:ring-[#7157d9]/20 md:w-[min(42vw,540px)] md:text-body-l-d"
            />
            <p className="hidden text-caption-m text-[#756d88] sm:block">제목을 바로 고치고, 아래에서 질문을 추가하세요</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-8">
          <GhostButton onClick={() => setPreview((v) => !v)} aria-pressed={preview} className="border-[#d8d1ed] text-[#463d5b]">
            <Eye size={16} aria-hidden="true" />
            <span className="hidden sm:inline">미리보기</span>
          </GhostButton>
          <GhostButton onClick={() => navigate(backTo)} className="border-[#d8d1ed] text-[#463d5b]">목록</GhostButton>
          <PrimaryButton type="submit" form="form-editor" disabled={busy || !canSaveForm}>
            <Save size={16} aria-hidden="true" />
            {busy ? '저장 중' : '저장'}
          </PrimaryButton>
        </div>
      </header>

      {!isNew && !hydrated ? (
        <div className="flex flex-col items-start gap-16">
          {loading && (
            <p className="font-mono text-caption-m text-text-meta">기존 내용을 불러오는 중</p>
          )}
          {error && (
            <>
              <ErrorText>{error.message}</ErrorText>
              <GhostButton onClick={refetch}>다시 불러오기</GhostButton>
            </>
          )}
        </div>
      ) : (
        <form id="form-editor" onSubmit={save} className="mx-auto flex w-full max-w-5xl flex-col gap-24 pb-40">
          <div className={PANEL}>
            <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">폼 정보</h3>
            <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
              <Field label="제목 (영문)">
                <Input value={form.title_en} onChange={setInput('title_en')} />
              </Field>
              <Field label="주소" hint="공개 주소는 /forms/여기에-입력한-값">
                <Input
                  value={form.slug}
                  onChange={setInput('slug')}
                  placeholder="closing-2026-1"
                  required
                />
              </Field>
              <Field label="분류">
                <Select
                  value={form.category}
                  options={CATEGORY_OPTIONS}
                  onChange={(e) => set('category')(e.target.value)}
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="안내문 (국문)" hint="줄바꿈은 그대로 유지됩니다">
                  <TextArea
                    rows={8}
                    value={form.description_ko}
                    onChange={setInput('description_ko')}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="안내문 (영문)">
                  <TextArea
                    rows={5}
                    value={form.description_en}
                    onChange={setInput('description_en')}
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className={PANEL}>
            <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">접수 설정</h3>
            <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
              <Field label="접수 시작">
                <DateInput
                  withTime
                  value={form.settings.accept_start}
                  onChange={setSettingInput('accept_start')}
                />
              </Field>
              <Field label="접수 마감">
                <DateInput
                  withTime
                  value={form.settings.accept_end}
                  viewDate={form.settings.accept_start}
                  onChange={setSettingInput('accept_end')}
                />
              </Field>
              <Field label="수정 마감" hint="비우면 접수 마감과 같습니다">
                <DateInput
                  withTime
                  value={form.settings.edit_end}
                  viewDate={form.settings.accept_end}
                  onChange={setSettingInput('edit_end')}
                />
              </Field>
              <Field label="응답 상한" hint="비우면 제한 없음">
                <Input
                  type="number"
                  min="1"
                  value={form.settings.max_responses}
                  onChange={setSettingInput('max_responses')}
                />
              </Field>
              <Field label="구글 인증" hint="제출자 본인 확인에 구글 로그인을 요구합니다">
                <Toggle
                  checked={form.settings.require_google_auth}
                  onChange={setSetting('require_google_auth')}
                  label="구글 인증 요구"
                />
              </Field>
              <Field label="헤더 버튼 노출">
                <Toggle
                  checked={form.settings.show_button_in_header}
                  onChange={setSetting('show_button_in_header')}
                  label="헤더 버튼 노출"
                />
              </Field>
              <Field label="버튼 문구 (국문)">
                <Input
                  value={form.settings.button_label_ko}
                  onChange={setSettingInput('button_label_ko')}
                />
              </Field>
              <Field label="버튼 문구 (영문)">
                <Input
                  value={form.settings.button_label_en}
                  onChange={setSettingInput('button_label_en')}
                />
              </Field>
              <div className="md:col-span-2 rounded-md border border-border-subtle bg-bg-panel p-16">
                <div className="flex flex-wrap items-start justify-between gap-16">
                  <div>
                    <p className="text-small-m font-semibold text-text-pri">Google Drive 파일 업로드</p>
                    <p className="mt-4 text-caption-m leading-relaxed text-text-meta">
                      이 폼의 파일 질문만 지정한 Drive 폴더로 저장합니다. Render에 연결한 Google Drive 계정으로 업로드됩니다.
                    </p>
                  </div>
                  <Toggle checked={form.settings.drive_enabled} onChange={setSetting('drive_enabled')} label="Google Drive 업로드 사용" />
                </div>
                {form.settings.drive_enabled && (
                  <div className="mt-16 grid grid-cols-1 gap-16 md:grid-cols-2">
                    <Field label="Drive 폴더 URL 또는 ID" hint="이 폼 전용 폴더를 지정하세요">
                      <Input value={form.settings.drive_folder_id} onChange={setSettingInput('drive_folder_id')} />
                    </Field>
                    <Field label="자동 폴더 분류">
                      <Toggle checked={form.settings.drive_auto_folder} onChange={setSetting('drive_auto_folder')} label="학기·과목·폼명 폴더 자동 생성" />
                    </Field>
                    {form.settings.drive_auto_folder && (
                      <>
                        <Field label="학기" hint="예: 2026-2">
                          <Input value={form.settings.drive_semester} onChange={setSettingInput('drive_semester')} placeholder="2026-2" />
                        </Field>
                        <Field label="과목" hint="예: 디지털디자인">
                          <Input value={form.settings.drive_course} onChange={setSettingInput('drive_course')} placeholder="과목명" />
                        </Field>
                      </>
                    )}
                    <Field label="파일 공유 범위">
                      <Select
                        value={form.settings.drive_share_mode}
                        options={[
                          { value: 'restricted', label: '제한됨 — 관리자만 보기' },
                          { value: 'link', label: '링크가 있는 사용자에게 보기 허용' },
                        ]}
                        onChange={(e) => setSetting('drive_share_mode')(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-16">
            <div className="flex flex-wrap items-center justify-between gap-16 border-b border-[#ded8ef] pb-16">
              <div>
                <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">질문</h3>
                <p className="mt-4 text-small-m text-text-sec">보라색 버튼을 눌러 질문 카드를 추가합니다.</p>
              </div>
              <button
                type="button"
                onClick={addField}
                className="inline-flex h-44 items-center justify-center gap-8 rounded-full bg-[#5f43ce] px-20 text-small-m font-semibold text-white shadow-sm transition hover:bg-[#4e35b4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5f43ce]"
              >
                <Plus size={18} aria-hidden="true" />
                질문 추가
              </button>
            </div>

            <p className="font-mono text-caption-m text-text-meta">
              핸들을 끌어 순서를 바꿉니다. 바뀐 순서는 저장할 때 반영됩니다.
            </p>

            {form.fields.length === 0 && (
              <button
                type="button"
                onClick={addField}
                className="flex min-h-160 w-full flex-col items-center justify-center gap-12 rounded-md border-2 border-dashed border-[#cfc6e6] bg-white px-24 text-center text-[#51486a] transition hover:border-[#7157d9] hover:bg-[#faf8ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7157d9]"
              >
                <span className="flex h-40 w-40 items-center justify-center rounded-full bg-[#eee9ff] text-[#5f43ce]">
                  <Plus size={20} aria-hidden="true" />
                </span>
                <span className="text-body-m font-semibold">첫 질문 추가</span>
                <span className="text-caption-m text-[#756d88]">객관식, 단답형, 파일 업로드 등 필요한 질문을 만드세요</span>
              </button>
            )}

            {form.fields.length > 0 && (
              <ul className="flex flex-col gap-16">
                {form.fields.map((field, i) => (
                  <FieldCard
                    key={field.id}
                    field={field}
                    index={i}
                    dragging={dragIndex === i}
                    over={overIndex === i && dragIndex !== null && dragIndex !== i}
                    rowProps={rowProps}
                    armed={armed === i}
                    onArm={(on) => setArmed(on ? i : null)}
                    onChange={(next) =>
                      setFields(form.fields.map((f, idx) => (idx === i ? next : f)))
                    }
                    onRemove={() => setFields(form.fields.filter((_, idx) => idx !== i))}
                  />
                ))}
              </ul>
            )}
          </div>

          {preview && (
            <div className={PANEL}>
              <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">미리보기</h3>
              <p className="font-mono text-caption-m text-text-meta">
                공개 화면과 같은 렌더러입니다. 여기 입력한 값은 저장되지 않습니다.
              </p>
              <FormRenderer
                fields={form.fields}
                value={previewValue}
                onChange={(fieldId, v) => setPreviewValue((prev) => ({ ...prev, [fieldId]: v }))}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-24 border-t border-[#ded8ef] pt-24">
            {/* 토글은 화면 상태만 바꾼다. 저장을 눌러야 서버에 반영된다 */}
            <Field label="공개" hint="저장을 눌러야 반영됩니다">
              <Toggle checked={form.published} onChange={set('published')} label="공개 여부" />
            </Field>
          </div>

          <ErrorText>{saveError}</ErrorText>
          <div className="flex items-center gap-8"><GhostButton onClick={() => navigate(backTo)}>저장하지 않고 나가기</GhostButton></div>
        </form>
      )}
    </section>
  )
}

export default FormEditor
