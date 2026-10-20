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
import { ChevronLeft, ChevronRight, Heart, Star, ThumbsUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../common/Select'
import DatePicker from '../common/DatePicker'
import ImageUpload from '../admin/ImageUpload'
import { formatPhone } from '../../utils/format'
import { CheckList, LongInput, QuestionCard, RadioList, ShortInput } from './respondent'
import { OTHER_LABEL, OTHER_PREFIX, buildPages, computePath, errorText, nextAfter, ratingMaxOf, validateResponse } from './formLogic'

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

/** 보기 순서를 섞는다. 마운트마다 한 번만 정해져 답하는 중에 순서가 바뀌지 않는다 */
function useShuffled(list, on) {
  const [seed] = useState(() => Math.random())
  return useMemo(() => {
    if (!on) return list
    const keyed = list.map((v, i) => [v, Math.sin((i + 1) * 9301 + seed * 49297) * 233280 % 1])
    return keyed.sort((a, b) => a[1] - b[1]).map((x) => x[0])
  }, [list, on, seed])
}

const RATING_ICON = { star: Star, heart: Heart, thumb: ThumbsUp }

/** 별점/하트/엄지: 1~N. 선택한 값까지 채워 보인다 */
function RatingRow({ name, max, icon = 'star', value, onChange, invalid, describedBy, minLabel, maxLabel }) {
  const Icon = RATING_ICON[icon] || Star
  const cur = Number(value) || 0
  return (
    <div>
      <div role="radiogroup" aria-label="점수" aria-invalid={invalid || undefined} aria-describedby={describedBy} className="flex flex-wrap items-center gap-4">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
          const on = icon === 'thumb' ? cur === n : n <= cur
          return (
            <label key={n} className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
              <input type="radio" name={name} value={n} checked={cur === n} onChange={() => onChange(String(n))} className="peer sr-only" aria-label={`${n}점`} />
              <Icon size={28} aria-hidden="true" className={`rounded-sm transition-colors duration-fast ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus ${on ? 'fill-current text-purple-primary' : 'text-border-strong'}`} />
            </label>
          )
        })}
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between gap-12 text-caption-m text-text-meta">
          <span>{minLabel}</span>
          <span className="text-right">{maxLabel}</span>
        </div>
      )}
    </div>
  )
}

/** 객관식 격자(행마다 하나) / 체크박스 격자(행마다 여러 개). 좁은 화면에서는 가로로 밀어서 본다 */
function GridInput({ field, value, onChange, invalid }) {
  const rows = Array.isArray(field.rows) ? field.rows : []
  const cols = Array.isArray(field.columns) ? field.columns : []
  const multi = field.type === 'checkbox_grid'
  const cur = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const toggle = (row, col) => {
    if (multi) {
      const list = Array.isArray(cur[row]) ? cur[row] : []
      onChange({ ...cur, [row]: list.includes(col) ? list.filter((c) => c !== col) : [...list, col] })
    } else onChange({ ...cur, [row]: col })
  }
  const dupCols = !multi && field.validation?.noDuplicate
  return (
    <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label={field.label_ko} aria-invalid={invalid || undefined}>
      <table className="w-full min-w-max border-collapse text-small-m text-text-pri">
        <thead>
          <tr>
            <th scope="col" className="p-8 text-left font-normal"><span className="sr-only">행</span></th>
            {cols.map((c) => (
              <th key={c} scope="col" className="min-w-64 p-8 text-center font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const sel = cur[r]
            return (
              <tr key={r} className={ri % 2 === 0 ? 'bg-bg-elev' : ''}>
                <th scope="row" className="max-w-[220px] p-8 text-left font-medium">{r}</th>
                {cols.map((c) => {
                  const checked = multi ? Array.isArray(sel) && sel.includes(c) : sel === c
                  const taken = dupCols && sel !== c && Object.values(cur).includes(c)
                  return (
                    <td key={c} className="p-0 text-center">
                      <label className={`flex min-h-11 min-w-11 items-center justify-center ${taken ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                        <input type={multi ? 'checkbox' : 'radio'} name={`${field.id}-${ri}`} checked={Boolean(checked)} disabled={taken} onChange={() => toggle(r, c)} className="peer sr-only" aria-label={`${r}: ${c}`} />
                        <span aria-hidden="true" className={`flex h-20 w-20 items-center justify-center border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus peer-focus-visible:ring-offset-2 ${multi ? 'rounded-sm' : 'rounded-full'} ${checked ? 'border-purple-primary' : 'border-border-strong'} ${multi && checked ? 'bg-purple-primary' : ''}`}>
                          {checked && !multi && <span className="h-8 w-8 rounded-full bg-purple-primary" />}
                          {checked && multi && <span className="h-8 w-8 rounded-sm bg-bg-panel" />}
                        </span>
                      </label>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OtherText({ value, onChange, label }) {
  return (
    <div className="max-w-[420px] pl-32">
      <ShortInput aria-label={`${label} 기타 내용`} value={value} maxLength={190} placeholder="직접 입력" onChange={(e) => onChange(e.target.value)} />
    </div>
  )
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
  const otherOn = field.validation?.other === true && !options.includes(OTHER_LABEL)
  const shuffled = useShuffled(options, field.validation?.shuffle === true)
  const shownOptions = otherOn ? [...shuffled, OTHER_LABEL] : shuffled
  const isOther = otherOn && typeof value === 'string' && value.startsWith(OTHER_PREFIX.slice(0, 2))
  const max = Number(field.validation?.maxLength)
  const errorId = `${field.id}-error`
  const label = field.label_ko || field.label_en || field.id
  const pts = field.quiz?.points > 0 ? `${field.quiz.points}점` : ''
  const common = { label, required: field.required, hint: [pts, field.hint_ko].filter(Boolean).join(' · ') || undefined, error }
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
            <Select value={isOther ? OTHER_LABEL : str} options={shownOptions.map((o) => ({ value: o, label: o }))} placeholder="선택" aria-label={label} {...errorProps} onChange={(v) => set(v === OTHER_LABEL && otherOn ? OTHER_PREFIX : v)} disabled={isCourse && courseLocked} />
          </div>
          {isOther && <OtherText label={label} value={str.slice(OTHER_PREFIX.length)} onChange={(t) => set(OTHER_PREFIX + t)} />}
          {lockNote}
        </QuestionCard>
      )

    case 'radio':
      return (
        <QuestionCard {...common}>
          {shownOptions.length >= DROPDOWN_FROM ? (
            <div className="max-w-[320px]">
              <Select value={isOther ? OTHER_LABEL : str} options={shownOptions.map((o) => ({ value: o, label: o }))} placeholder="선택" aria-label={label} {...errorProps} onChange={(v) => set(v === OTHER_LABEL && otherOn ? OTHER_PREFIX : v)} disabled={isCourse && courseLocked} />
            </div>
          ) : (
            <RadioList name={field.id} value={isOther ? OTHER_LABEL : str} options={shownOptions.map((o) => ({ value: o, label: o }))} onChange={(v) => set(v === OTHER_LABEL && otherOn ? OTHER_PREFIX : v)} disabled={isCourse && courseLocked} invalid={Boolean(error)} />
          )}
          {isOther && <OtherText label={label} value={str.slice(OTHER_PREFIX.length)} onChange={(t) => set(OTHER_PREFIX + t)} />}
          {lockNote}
        </QuestionCard>
      )

    case 'checkbox': {
      const arr = Array.isArray(value) ? value : []
      const otherItem = arr.find((x) => String(x).startsWith(OTHER_PREFIX))
      const shown = arr.map((x) => (String(x).startsWith(OTHER_PREFIX) ? OTHER_LABEL : x))
      return (
        <QuestionCard {...common}>
          <CheckList
            name={field.id}
            options={shownOptions}
            value={shown}
            invalid={Boolean(error)}
            onChange={(next) => {
              const hadOther = shown.includes(OTHER_LABEL)
              const hasOther = next.includes(OTHER_LABEL)
              const rest = next.filter((x) => x !== OTHER_LABEL)
              set(hasOther ? [...rest, hadOther ? otherItem : OTHER_PREFIX] : rest)
            }}
          />
          {otherItem !== undefined && <OtherText label={label} value={String(otherItem).slice(OTHER_PREFIX.length)} onChange={(t) => set([...arr.filter((x) => !String(x).startsWith(OTHER_PREFIX)), OTHER_PREFIX + t])} />}
        </QuestionCard>
      )
    }

    case 'rating':
      return (
        <QuestionCard {...common}>
          <RatingRow name={field.id} max={ratingMaxOf(field.validation)} icon={field.validation?.ratingIcon} value={str} onChange={set} invalid={Boolean(error)} describedBy={error ? errorId : undefined} minLabel={field.validation?.scaleMinLabel} maxLabel={field.validation?.scaleMaxLabel} />
        </QuestionCard>
      )

    case 'radio_grid':
    case 'checkbox_grid':
      return (
        <QuestionCard {...common}>
          <GridInput field={field} value={value} onChange={set} invalid={Boolean(error)} />
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
 * @param {Object} errors  { [field.id]: '에러 문구' } (서버 검증 결과)
 * 분기: 쪽(섹션)을 넘길 때 그 쪽의 질문만 검사하고, 답에 따라 다음 쪽을 정한다(formLogic.nextAfter).
 * 거치지 않은 쪽의 질문은 검사도 저장도 하지 않는다(서버도 같은 규칙).
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
  const pages = useMemo(() => buildPages(fields), [fields])
  // 지나온 쪽 번호 목록. 마지막이 지금 쪽이다. "이전"은 지나온 길을 거꾸로 간다.
  const [stack, setStack] = useState([0])
  const [local, setLocal] = useState({})
  const pageIndex = Math.min(stack[stack.length - 1] ?? 0, Math.max(0, pages.length - 1))
  useEffect(() => setStack((cur) => (cur.every((i) => i < pages.length) ? cur : [0])), [pages.length])
  const page = pages[pageIndex] || { fields: [] }
  const next = nextAfter(pages, pageIndex, value)
  const isLast = next.kind === 'submit'
  const ahead = computePath(fields, value, pageIndex).path.length - 1
  const total = stack.length + Math.max(0, ahead)
  useEffect(() => {
    onPageChange?.({ index: stack.length - 1, total, isLast })
  }, [onPageChange, stack.length, total, isLast])

  // 서버가 돌려준 오류가 다른 쪽에 있으면 그 쪽으로 데려간다
  const errKeys = Object.keys(errors).join('|')
  const lastKeys = useRef('')
  useEffect(() => {
    if (!errKeys || errKeys === lastKeys.current) return
    lastKeys.current = errKeys
    const { path } = computePath(fields, value, 0)
    const hit = path.findIndex((p) => pages[p].fields.some((f) => errors[f.id]))
    if (hit >= 0) setStack(path.slice(0, hit + 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errKeys])

  const shown = { ...local, ...errors }
  const change = (id, v) => {
    setLocal((cur) => {
      if (!cur[id]) return cur
      const { [id]: _drop, ...rest } = cur
      return rest
    })
    onChange?.(id, v)
  }
  const goNext = () => {
    const ids = new Set(page.fields.map((f) => f.id))
    const errs = validateResponse(fields, value, { only: ids })
    if (errs.length) {
      setLocal(Object.fromEntries(errs.map((e) => [e.field, errorText(e)])))
      window.setTimeout(() => document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30)
      return
    }
    setLocal({})
    if (next.kind === 'page') setStack((cur) => [...cur, next.index])
  }

  return (
    <div className="flex min-w-0 flex-col gap-12">
      {total > 1 && (
        <div className="flex items-center gap-12 px-4" aria-label={`${total}쪽 중 ${stack.length}쪽`}>
          <span className="h-4 flex-1 overflow-hidden rounded-sm bg-bg-elev">
            <span className="block h-4 bg-purple-primary transition-[width] duration-base ease-out" style={{ width: `${(stack.length / total) * 100}%` }} />
          </span>
          <span className="text-caption-m text-text-meta">
            {stack.length} / {total}
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
          error={shown[field.id]}
          onChange={change}
          onUploadingChange={onUploadingChange}
          uploadContext={uploadContext}
          formValues={value}
          courseFieldId={courseField?.id}
          courseSelected={courseSelected}
          courseLocked={courseLocked}
        />
      ))}
      {(stack.length > 1 || !isLast) && (
        <div className="flex items-center justify-between gap-12 pt-4">
          <button type="button" onClick={() => setStack((cur) => (cur.length > 1 ? cur.slice(0, -1) : cur))} disabled={stack.length <= 1} className="inline-flex h-11 cursor-pointer items-center gap-4 rounded-sm border border-border-subtle bg-bg-panel px-16 text-small-m font-semibold text-text-pri transition-colors duration-fast ease-out hover:border-border-strong disabled:invisible">
            <ChevronLeft size={16} /> 이전
          </button>
          <button type="button" onClick={goNext} disabled={isLast} className="inline-flex h-11 cursor-pointer items-center gap-4 rounded-sm bg-button-primary px-16 text-small-m font-semibold text-button-primaryText transition-colors duration-fast ease-out hover:bg-button-primaryHover disabled:hidden">
            다음 <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

export default FormRenderer
