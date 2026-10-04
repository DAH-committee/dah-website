// FormRenderer.jsx: 폼 정의(fields)를 구글 폼 응답 화면으로 그리는 공용 렌더러 (39_FORM_BUILDER F3)
//
// 폼 정의는 DB에 있고 이 컴포넌트는 그것을 그리기만 한다. 새 폼을 만들 때 코드를 고칠 일이 없어야
// 한다는 것이 이 파일의 존재 이유다. 질문 하나가 카드 하나이고, 화면 모양은 respondent.jsx가 정한다.
// 반드시 .reading-scope 안에서 그려야 한다(RespondentPage 또는 편집기 미리보기).
//
// 선택지가 일곱 개를 넘는 객관식은 드롭다운으로 그린다. 값은 같은 문자열이라 서버와 응답 표는 그대로다.
//
// 값 계약: value는 { [field.id]: 값 } 객체. checkbox만 배열, 나머지는 문자열.
// 검증은 서버가 최종 권한이며 여기서는 인라인 안내만 담당한다.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Select from '../common/Select'
import DatePicker from '../common/DatePicker'
import ImageUpload from '../admin/ImageUpload'
import { formatPhone } from '../../utils/format'
import { CheckList, LongInput, QuestionCard, RadioList, ShortInput } from './respondent'

const COURSE_LOCK_NOTE =
  '이미 업로드한 파일이 있어 과목을 바꿀 수 없습니다. 바꾸려면 올린 파일을 먼저 제거하고, 이미 제출했다면 운영진에게 파일 이동을 요청하세요.'
const DROPDOWN_FROM = 8

/** 선형 배율: 숫자 위, 동그라미 아래 한 줄. 양 끝 이름이 있으면 양옆에 둔다 */
function ScaleRow({ name, min, max, value, onChange, minLabel, maxLabel, invalid = false, describedBy }) {
  const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <div role="radiogroup" aria-invalid={invalid || undefined} aria-describedby={describedBy} className="overflow-x-auto">
      <div className="flex min-w-fit items-end justify-between gap-12 sm:justify-start sm:gap-24">
        {minLabel && <span className="hidden max-w-[96px] pb-8 text-small-m text-text-meta sm:block">{minLabel}</span>}
        {nums.map((n) => {
          const checked = String(value) === String(n)
          return (
            <label key={n} className="flex min-w-32 cursor-pointer flex-col items-center gap-8">
              <span className="text-small-m text-text-sec">{n}</span>
              <input type="radio" name={name} value={n} checked={checked} onChange={() => onChange(String(n))} className="peer sr-only" />
              <span
                aria-hidden="true"
                className={`flex h-24 w-24 items-center justify-center rounded-full border-2 transition-colors duration-fast ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus peer-focus-visible:ring-offset-2 ${checked ? 'border-purple-primary' : 'border-border-strong'}`}
              >
                {checked && <span className="h-12 w-12 rounded-full bg-purple-primary" />}
              </span>
            </label>
          )
        })}
        {maxLabel && <span className="hidden max-w-[96px] pb-8 text-small-m text-text-meta sm:block">{maxLabel}</span>}
      </div>
      {(minLabel || maxLabel) && (
        <div className="mt-8 flex justify-between gap-12 text-caption-m text-text-meta sm:hidden">
          <span>{minLabel}</span>
          <span className="text-right">{maxLabel}</span>
        </div>
      )}
    </div>
  )
}

/** 시간 입력 보조: 숫자만 받아 14:30 모양으로 맞춘다 */
function formatTime(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d
}

function Counter({ length, max }) {
  return (
    <p className={`text-right text-caption-m ${length > max ? 'text-state-error' : 'text-text-meta'}`}>
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
  const label = field.label_ko || field.label_en || field.id
  const common = { label, required: field.required, hint: field.hint_ko, error }
  const errorProps = error ? { 'aria-invalid': 'true', 'aria-describedby': errorId } : {}
  const isCourse = field.id === courseFieldId
  const lockNote = isCourse && courseLocked ? <p className="text-small-m text-text-meta">{COURSE_LOCK_NOTE}</p> : null

  switch (field.type) {
    case 'textarea':
      return (
        <QuestionCard {...common}>
          <LongInput aria-label={label} value={str} required={field.required} {...errorProps} placeholder="내 답변" onChange={(e) => set(e.target.value)} />
          {Number.isFinite(max) && <Counter length={str.length} max={max} />}
        </QuestionCard>
      )

    case 'select':
      return (
        <QuestionCard {...common}>
          <div className="max-w-[320px]">
            <Select value={str} options={options.map((o) => ({ value: o, label: o }))} placeholder="선택" aria-label={label} {...errorProps} onChange={(e) => set(e.target.value)} disabled={isCourse && courseLocked} />
          </div>
          {lockNote}
        </QuestionCard>
      )

    case 'radio':
      return (
        <QuestionCard {...common}>
          {options.length >= DROPDOWN_FROM ? (
            <div className="max-w-[320px]">
              <Select value={str} options={options.map((o) => ({ value: o, label: o }))} placeholder="선택" aria-label={label} {...errorProps} onChange={(e) => set(e.target.value)} disabled={isCourse && courseLocked} />
            </div>
          ) : (
            <RadioList name={field.id} value={str} options={options.map((o) => ({ value: o, label: o }))} onChange={set} disabled={isCourse && courseLocked} invalid={Boolean(error)} />
          )}
          {lockNote}
        </QuestionCard>
      )

    case 'checkbox':
      return (
        <QuestionCard {...common}>
          <CheckList name={field.id} options={options} value={value} onChange={set} invalid={Boolean(error)} />
        </QuestionCard>
      )

    case 'phone':
      return (
        <QuestionCard {...common}>
          <ShortInput aria-label={label} type="tel" inputMode="numeric" value={str} required={field.required} {...errorProps} placeholder="010-0000-0000" onChange={(e) => set(formatPhone(e.target.value))} />
        </QuestionCard>
      )

    case 'email':
      return (
        <QuestionCard {...common}>
          <ShortInput aria-label={label} type="email" value={str} required={field.required} {...errorProps} placeholder="내 답변" onChange={(e) => set(e.target.value)} />
        </QuestionCard>
      )

    case 'studentid':
      return (
        <QuestionCard {...common}>
          <ShortInput aria-label={label} inputMode="numeric" maxLength={8} value={str} required={field.required} {...errorProps} placeholder="학번 8자리" onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        </QuestionCard>
      )

    case 'date':
      return (
        <QuestionCard {...common}>
          <div className="max-w-[320px]">
            <DatePicker value={str} onChange={set} aria-label={label} {...errorProps} />
          </div>
        </QuestionCard>
      )

    case 'time':
      return (
        <QuestionCard {...common}>
          <ShortInput aria-label={label} inputMode="numeric" maxLength={5} value={str} required={field.required} {...errorProps} placeholder="14:30" className="max-w-[160px]" onChange={(e) => set(formatTime(e.target.value))} />
        </QuestionCard>
      )

    case 'scale': {
      const lo = Number(field.validation?.scaleMin) === 0 ? 0 : 1
      const hiRaw = Number(field.validation?.scaleMax)
      const hi = Number.isInteger(hiRaw) && hiRaw >= 2 && hiRaw <= 10 ? hiRaw : 5
      return (
        <QuestionCard {...common}>
          <ScaleRow name={field.id} min={lo} max={hi} value={str} onChange={set} minLabel={field.validation?.scaleMinLabel} maxLabel={field.validation?.scaleMaxLabel} invalid={Boolean(error)} describedBy={error ? errorId : undefined} />
        </QuestionCard>
      )
    }

    case 'file': {
      // 53_DRIVE_STORAGE: 저장 위치·허용 확장자·상한은 질문마다 다르다. 서버가 내려준 값만 신뢰한다.
      const storage = field.storage || {}
      const isDrive = storage.target === 'drive'
      const requiresCourse = Boolean(storage.requires_course)
      const accept =
        Array.isArray(storage.accept) && storage.accept.length
          ? storage.accept.map((ext) => `.${ext}`).join(',')
          : isDrive
            ? 'image/*,.pdf,.ai,.eps,.psd,.tif,.tiff,.svg,.zip,.hwp,.hwpx,.docx,.xlsx,.pptx,.mp4,.mov'
            : storage.purpose === 'attachment'
              ? 'image/*,.pdf,.hwp,.hwpx,.docx,.xlsx,.pptx,.zip'
              : 'image/*'
      const maxMb = storage.max_bytes ? Math.round(storage.max_bytes / (1024 * 1024)) : null
      const note = isDrive
        ? `${requiresCourse ? '선택한 과목 폴더에 ' : ''}원본 그대로 Google Drive에 저장됩니다.${maxMb ? ` 최대 ${maxMb}MB.` : ''}${requiresCourse ? ' 파일을 올린 뒤에는 과목을 바꿀 수 없습니다.' : ''}`
        : `사이트 표시용으로 최적화해 저장됩니다.${maxMb ? ` 최대 ${maxMb}MB.` : ''}`
      return (
        <QuestionCard {...common}>
          <ImageUpload
            value={str}
            onChange={set}
            usage="general"
            preview={false}
            accept={accept}
            buttonLabel="파일 추가"
            onUploadingChange={onUploadingChange}
            formSlug={uploadContext?.formSlug}
            fieldId={field.id}
            driveEnabled={isDrive}
            formValues={formValues}
            uploadDisabled={requiresCourse && !courseSelected}
            disabledMessage="먼저 참가 과목을 선택하면 파일을 업로드할 수 있습니다."
            noteText={note}
          />
        </QuestionCard>
      )
    }

    case 'section':
      return null

    default:
      return (
        <QuestionCard {...common}>
          <ShortInput aria-label={label} value={str} required={field.required} {...errorProps} maxLength={Number.isFinite(max) ? max : undefined} placeholder="내 답변" onChange={(e) => set(e.target.value)} />
        </QuestionCard>
      )
  }
}

/**
 * @param {Array} fields   폼 정의(order 오름차순으로 그린다)
 * @param {Object} value   { [field.id]: 값 }
 * @param {Function} onChange (fieldId, value) => void
 * @param {Object} errors  { [field.id]: '에러 문구' }
 */
function FormRenderer({ fields = [], value = {}, onChange, errors = {}, onUploadingChange, uploadContext, onPageChange }) {
  const ordered = [...(Array.isArray(fields) ? fields : [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const configuredCourseFieldId = String(uploadContext?.courseFieldId || '').trim()
  const courseField = configuredCourseFieldId
    ? ordered.find((field) => field.id === configuredCourseFieldId)
    : ordered.find((field) => /과목|course|subject/i.test(`${field?.label_ko || ''} ${field?.label_en || ''}`))
  const courseSelected = courseField ? Boolean(value[courseField.id]) : false
  // 과목 폴더가 필요한 파일 질문에 이미 업로드가 있으면 과목을 바꾸지 못하게 잠근다
  // (바꾸면 이미 올라간 파일이 다른 과목 폴더에 남는다).
  const courseLocked = ordered.some((field) => field.type === 'file' && field.storage?.requires_course && Boolean(value[field.id]))
  const pages = useMemo(() => {
    const result = [{ section: null, fields: [] }]
    for (const field of ordered) {
      if (field.type === 'section') result.push({ section: field, fields: [] })
      else result[result.length - 1].fields.push(field)
    }
    return result.filter((page) => page.section || page.fields.length)
  }, [ordered])
  const [pageIndex, setPageIndex] = useState(0)
  useEffect(() => setPageIndex((current) => Math.min(current, Math.max(0, pages.length - 1))), [pages.length])
  const page = pages[pageIndex] || { fields: [] }
  useEffect(() => {
    onPageChange?.({ index: pageIndex, total: pages.length, isLast: pageIndex === pages.length - 1 })
  }, [onPageChange, pageIndex, pages.length])

  return (
    <div className="flex min-w-0 flex-col gap-12">
      {pages.length > 1 && (
        <div className="flex items-center gap-12 px-4" aria-label={`${pages.length}쪽 중 ${pageIndex + 1}쪽`}>
          <span className="h-4 flex-1 overflow-hidden rounded-sm bg-bg-elev">
            <span className="block h-4 bg-purple-primary transition-[width] duration-base ease-out" style={{ width: `${((pageIndex + 1) / pages.length) * 100}%` }} />
          </span>
          <span className="text-caption-m text-text-meta">
            {pageIndex + 1} / {pages.length}
          </span>
        </div>
      )}
      {page.section && (
        <section className="overflow-hidden rounded-md border border-border-subtle border-t-8 border-t-purple-primary bg-bg-panel">
          <div className="flex flex-col gap-8 p-20 md:p-24">
            <h2 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">{page.section.label_ko || '새 섹션'}</h2>
            {page.section.hint_ko && <p className="whitespace-pre-line text-small-m text-text-sec">{page.section.hint_ko}</p>}
          </div>
        </section>
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
        <div className="flex items-center justify-between gap-12 pt-4">
          <button type="button" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0} className="inline-flex h-11 cursor-pointer items-center gap-4 rounded-sm border border-border-subtle bg-bg-panel px-16 text-small-m font-semibold text-text-pri transition-colors duration-fast ease-out hover:border-border-strong disabled:invisible">
            <ChevronLeft size={16} /> 이전
          </button>
          <button type="button" onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))} disabled={pageIndex === pages.length - 1} className="inline-flex h-11 cursor-pointer items-center gap-4 rounded-sm bg-button-primary px-16 text-small-m font-semibold text-button-primaryText transition-colors duration-fast ease-out hover:bg-button-primaryHover disabled:hidden">
            다음 <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

export default FormRenderer
