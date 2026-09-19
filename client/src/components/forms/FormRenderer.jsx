// FormRenderer.jsx: 폼 정의(fields)를 입력 UI로 그리는 공용 렌더러 (39_FORM_BUILDER F3)
//
// 폼 정의는 DB에 있고 이 컴포넌트는 그것을 그리기만 한다. 새 폼을 만들 때 코드를 고칠 일이 없어야
// 한다는 것이 이 파일의 존재 이유다.
//
// 네이티브 UI 금지 계약: select·date·radio·checkbox 전부 커스텀 컴포넌트로 그린다.
//   select → common/Select, date → common/DatePicker, radio → common/RadioCards,
//   checkbox → 아래 CheckboxGroup(실제 input은 sr-only로 남겨 키보드·폼 시맨틱 보존)
//
// 값 계약: value는 { [field.id]: 값 } 객체. checkbox만 배열, 나머지는 문자열.
// 검증은 서버가 최종 권한이며 여기서는 인라인 안내만 담당한다.
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Select from '../common/Select'
import DatePicker from '../common/DatePicker'
import RadioCards from '../common/RadioCards'
import ImageUpload from '../admin/ImageUpload'
import { formatPhone } from '../../utils/format'
import { inputCls, labelCls } from '../../pages/submit/exhibitFormShared'


const COURSE_LOCK_NOTE =
  '이미 업로드한 파일이 있어 과목을 바꿀 수 없습니다. 바꾸려면 올린 파일을 먼저 제거하고, 이미 제출했다면 운영진에게 파일 이동을 요청하세요.'

/** 다중 선택. 네이티브 체크박스 대신 카드형이고 실제 input은 sr-only로 남긴다 */
function CheckboxGroup({ name, options, value = [], onChange, invalid = false, describedBy }) {
  const selected = Array.isArray(value) ? value : []
  const toggle = (opt) =>
    onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt])

  return (
    <div
      role="group"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className="grid grid-cols-1 gap-12 sm:grid-cols-2"
    >
      {options.map((opt) => {
        const checked = selected.includes(opt)
        return (
          <label
            key={opt}
            className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-12 rounded-md border p-16 transition duration-fast ease-out has-[:focus-visible]:border-border-focus has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-border-focus ${
              checked
                ? 'border-border-purple bg-glass-strong'
                : invalid
                  ? 'border-state-error bg-bg-panel hover:border-border-strong'
                  : 'border-border-subtle bg-bg-panel hover:border-border-strong'
            }`}
          >
            <input
              type="checkbox"
              name={name}
              value={opt}
              checked={checked}
              onChange={() => toggle(opt)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-sm border transition duration-fast ease-out ${
                checked ? 'border-transparent bg-purple-primary text-text-invert' : 'border-border-strong peer-focus-visible:border-border-focus'
              }`}
            >
              {checked && <Check size={16} />}
            </span>
            <span className="min-w-0 text-body-m text-text-pri">{opt}</span>
          </label>
        )
      })}
    </div>
  )
}

/** 라벨 + 필수 표시 + 힌트 + 인라인 에러 래퍼 */
function FieldShell({ field, error, errorId, children, as: Tag = 'label' }) {
  const label = field.label_ko || field.label_en || field.id
  return (
    <Tag className="flex min-w-0 flex-col gap-8">
      <span className="flex items-baseline gap-8">
        <span className={labelCls}>{label}</span>
        {field.required && <span className="font-mono text-caption-m text-text-meta">(필수)</span>}
      </span>
      {children}
      {field.hint_ko && <p className="text-caption-m text-text-meta">{field.hint_ko}</p>}
      {error && <p id={errorId} role="alert" className="text-caption-m text-state-error">{error}</p>}
    </Tag>
  )
}

/** 글자 수 카운터. maxLength가 있는 textarea에만 붙는다 */
function Counter({ length, max }) {
  return (
    <p className={`text-right font-mono text-caption-m ${length > max ? 'text-state-error' : 'text-text-meta'}`}>
      {length} / {max}
    </p>
  )
}

function FormField({
  field,
  value,
  error,
  onChange,
  onUploadingChange,
  uploadContext,
  formValues,
  courseFieldId,
  courseSelected,
  courseLocked,
}) {
  const set = (v) => onChange(field.id, v)
  const str = value == null ? '' : String(value)
  const options = Array.isArray(field.options) ? field.options : []
  const max = Number(field.validation?.maxLength)
  const errorId = `${field.id}-error`
  const errorProps = error
    ? { 'aria-invalid': 'true', 'aria-describedby': errorId, 'aria-errormessage': errorId }
    : {}

  switch (field.type) {
    case 'textarea':
      return (
        <FieldShell field={field} error={error} errorId={errorId}>
          <textarea
            rows={5}
            value={str}
            required={field.required}
            {...errorProps}
            placeholder={field.placeholder_ko || undefined}
            onChange={set}
            className={`${inputCls} resize-y`}
          />
          {Number.isFinite(max) && <Counter length={str.length} max={max} />}
        </FieldShell>
      )

    case 'select':
      return (
        <FieldShell field={field} error={error} errorId={errorId} as="div">
          <Select
            value={str}
            options={options.map((o) => ({ value: o, label: o }))}
            placeholder={field.placeholder_ko || '선택'}
            aria-label={field.label_ko}
            {...errorProps}
            onChange={(e) => set(e.target.value)}
            disabled={field.id === courseFieldId && courseLocked}
          />
          {field.id === courseFieldId && courseLocked && (
            <p className="text-caption-m text-[#8a6a1c]">{COURSE_LOCK_NOTE}</p>
          )}
        </FieldShell>
      )

    case 'radio':
      return (
        <FieldShell field={field} error={error} errorId={errorId} as="div">
          <RadioCards
            name={field.id}
            value={str}
            options={options.map((o) => ({ value: o, label: o }))}
            onChange={set}
            columns={options.some((o) => o.length > 24) ? 1 : 2}
            disabled={field.id === courseFieldId && courseLocked}
            {...errorProps}
          />
          {field.id === courseFieldId && courseLocked && (
            <p className="text-caption-m text-[#8a6a1c]">{COURSE_LOCK_NOTE}</p>
          )}
        </FieldShell>
      )

    case 'checkbox':
      return (
        <FieldShell field={field} error={error} errorId={errorId} as="div">
          <CheckboxGroup name={field.id} options={options} value={value} onChange={set} invalid={Boolean(error)} describedBy={error ? errorId : undefined} />
        </FieldShell>
      )

    case 'phone':
      return (
        <FieldShell field={field} error={error} errorId={errorId}>
          <input
            type="tel"
            inputMode="numeric"
            value={str}
            required={field.required}
            {...errorProps}
            placeholder={field.placeholder_ko || '010-1234-5678'}
            onChange={(e) => set(formatPhone(e.target.value))}
            className={inputCls}
          />
        </FieldShell>
      )

    case 'email':
      return (
        <FieldShell field={field} error={error} errorId={errorId}>
          <input
            type="email"
            value={str}
            required={field.required}
            {...errorProps}
            placeholder={field.placeholder_ko || undefined}
            onChange={(e) => set(e.target.value)}
            className={inputCls}
          />
        </FieldShell>
      )

    case 'studentid':
      return (
        <FieldShell field={field} error={error} errorId={errorId}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={str}
            required={field.required}
            {...errorProps}
            placeholder={field.placeholder_ko || undefined}
            // 숫자만 남긴다. 8자리 검증은 서버가 최종 판정한다
            onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 8))}
            className={inputCls}
          />
        </FieldShell>
      )

    case 'date':
      return (
        <FieldShell field={field} error={error} errorId={errorId} as="div">
          <DatePicker value={str} onChange={set} aria-label={field.label_ko} {...errorProps} />
        </FieldShell>
      )

    case 'file': {
      // 53_DRIVE_STORAGE: 저장 위치·허용 확장자·상한은 질문마다 다르다. 서버가 내려준 값만 신뢰한다.
      const storage = field.storage || {}
      const isDrive = storage.target === 'drive'
      const requiresCourse = Boolean(storage.requires_course)
      const accept = Array.isArray(storage.accept) && storage.accept.length
        ? storage.accept.map((ext) => `.${ext}`).join(',')
        : isDrive
          ? 'image/*,.pdf,.ai,.eps,.psd,.tif,.tiff,.svg,.zip,.hwp,.hwpx,.docx,.xlsx,.pptx,.mp4,.mov'
          : storage.purpose === 'attachment'
            ? 'image/*,.pdf,.hwp,.hwpx,.docx,.xlsx,.pptx,.zip'
            : 'image/*'
      const maxMb = storage.max_bytes ? Math.round(storage.max_bytes / (1024 * 1024)) : null
      const note = isDrive
        ? `${requiresCourse ? '선택한 과목 폴더에 ' : ''}원본 그대로 Google Drive에 저장됩니다.${
            maxMb ? ` 최대 ${maxMb}MB.` : ''
          }${requiresCourse ? ' 파일을 올린 뒤에는 과목을 바꿀 수 없습니다.' : ''}`
        : `사이트 표시용으로 최적화해 저장됩니다.${maxMb ? ` 최대 ${maxMb}MB.` : ''}`
      return (
        <FieldShell field={field} error={error} errorId={errorId} as="div">
          <ImageUpload
            value={str}
            onChange={set}
            usage="general"
            preview={false}
            accept={accept}
            buttonLabel="파일 선택"
            onUploadingChange={onUploadingChange}
            formSlug={uploadContext?.formSlug}
            fieldId={field.id}
            driveEnabled={isDrive}
            formValues={formValues}
            uploadDisabled={requiresCourse && !courseSelected}
            disabledMessage="먼저 참가 과목을 선택하면 파일을 업로드할 수 있습니다."
            noteText={note}
          />
        </FieldShell>
      )
    }

    case 'section':
      return null

    default:
      return (
        <FieldShell field={field} error={error} errorId={errorId}>
          <input
            type="text"
            value={str}
            required={field.required}
            {...errorProps}
            maxLength={Number.isFinite(max) ? max : undefined}
            placeholder={field.placeholder_ko || undefined}
            onChange={(e) => set(e.target.value)}
            className={inputCls}
          />
        </FieldShell>
      )
  }
}

/**
 * @param {Array} fields   폼 정의 배열(order 오름차순으로 그린다)
 * @param {Object} value   { [field.id]: 값 }
 * @param {Function} onChange (fieldId, value) => void
 * @param {Object} errors  { [field.id]: '에러 문구' }
 */
function FormRenderer({ fields = [], value = {}, onChange, errors = {}, onUploadingChange, uploadContext, onPageChange }) {
  const ordered = [...(Array.isArray(fields) ? fields : [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  )
  const configuredCourseFieldId = String(uploadContext?.courseFieldId || '').trim()
  const courseField = configuredCourseFieldId
    ? ordered.find((field) => field.id === configuredCourseFieldId)
    : ordered.find((field) => /과목|course|subject/i.test(`${field?.label_ko || ''} ${field?.label_en || ''}`))
  const courseSelected = courseField ? Boolean(value[courseField.id]) : false
  // 과목 폴더가 필요한 파일 질문에 이미 업로드가 있으면 과목을 바꾸지 못하게 잠근다
  // (바꾸면 이미 올라간 파일이 다른 과목 폴더에 남는다).
  const courseLocked = ordered.some(
    (field) => field.type === 'file' && field.storage?.requires_course && Boolean(value[field.id])
  )
  const pages = useMemo(() => {
    const result = [{ section: null, fields: [] }]
    for (const field of ordered) {
      if (field.type === 'section') result.push({ section: field, fields: [] })
      else result[result.length - 1].fields.push(field)
    }
    return result.filter((page) => page.section || page.fields.length)
  }, [fields])
  const [pageIndex, setPageIndex] = useState(0)
  useEffect(() => setPageIndex((current) => Math.min(current, Math.max(0, pages.length - 1))), [pages.length])
  const page = pages[pageIndex] || { fields: [] }
  useEffect(() => {
    onPageChange?.({ index: pageIndex, total: pages.length, isLast: pageIndex === pages.length - 1 })
  }, [onPageChange, pageIndex, pages.length])

  return (
    <div className="flex min-w-0 flex-col gap-24">
      {page.section && (
        <div className="border-t-4 border-[#7157d9] bg-[#f5f2ff] px-20 py-16">
          <p className="text-body-l-m font-bold text-[#29253a] md:text-body-l-d">{page.section.label_ko || '새 섹션'}</p>
          {page.section.hint_ko && <p className="mt-4 text-small-m text-[#625a77]">{page.section.hint_ko}</p>}
        </div>
      )}
      {page.fields.map((field) => (
        <FormField
          key={field.id}
          field={field}
          value={value[field.id]}
          error={errors[field.id]}
          onChange={onChange}
          onUploadingChange={onUploadingChange}
          uploadContext={uploadContext}
          formValues={value}
          courseFieldId={courseField?.id}
          courseSelected={courseSelected}
          courseLocked={courseLocked}
        />
      ))}
      {pages.length > 1 && (
        <div className="flex items-center justify-between gap-12 border-t border-border-subtle pt-20">
          <button type="button" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0} className="inline-flex h-44 items-center gap-4 rounded-sm border border-border-subtle px-12 text-small-m font-semibold disabled:opacity-40">
            <ChevronLeft size={16} /> 이전
          </button>
          <span className="text-caption-m text-text-meta">{pageIndex + 1} / {pages.length}</span>
          <button type="button" onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))} disabled={pageIndex === pages.length - 1} className="inline-flex h-44 items-center gap-4 rounded-sm bg-purple-primary px-12 text-small-m font-semibold text-text-invert disabled:opacity-40">
            다음 <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

export default FormRenderer
