// EntityCrud.jsx — 필드 정의 기반 공용 CRUD 패널 (13_CMS_SPEC 1절 매트릭스)
// 교수진·멘토단·교과목·운영위·진로 어드민이 공유. API: /admin/content/:type (B1 계약).

import { useState } from 'react'
import { ArrowUpDown, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { DragHandle, useDragSort } from '../common/DragHandle'
import ImageUpload from './ImageUpload'
import {
  DateInput,
  EmptyNote,
  ErrorText,
  Field,
  GhostButton,
  Input,
  PageHead,
  PrimaryButton,
  Select,
  TextArea,
  Toggle,
} from './FormControls'

const ICON_BTN =
  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 md:h-32 md:w-32'

function emptyForm(fields) {
  const form = {}
  for (const f of fields) {
    if (f.kind === 'toggle') form[f.key] = f.default ?? true
    else if (f.kind === 'number') form[f.key] = f.default ?? 0
    else if (f.kind === 'pairs') form[f.key] = []
    else form[f.key] = f.default ?? ''
  }
  return form
}

function pickForm(fields, item) {
  const form = {}
  for (const f of fields) {
    let v = item[f.key] ?? emptyForm([f])[f.key]
    // J2: 시드가 넣은 객체형 jsonb(예: professors.links {website,...})가 pairs 필드로 들어오면
    // value.map 크래시로 편집 화면이 빈 화면이 됨 — 배열이 아니면 안전 배열로 강제
    if (f.kind === 'pairs' && !Array.isArray(v)) v = []
    form[f.key] = v
  }
  return form
}

function PairsField({ field, value = [], onChange }) {
  // J2: 비배열 방어 — 렌더 크래시 방지
  const rows = Array.isArray(value) ? value : []
  const keys = field.pairKeys || [
    { key: 'name', label: '이름' },
    { key: 'role', label: '역할' },
  ]
  const setRow = (i, k, v) => {
    const next = rows.map((row, idx) => (idx === i ? { ...row, [k]: v } : row))
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-8">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-8">
          {keys.map((k) => (
            <Input
              key={k.key}
              value={row[k.key] || ''}
              onChange={(e) => setRow(i, k.key, e.target.value)}
              placeholder={k.label}
              aria-label={`${field.label} ${k.label}`}
            />
          ))}
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            aria-label="항목 제거"
            className={ICON_BTN}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <GhostButton onClick={() => onChange([...rows, {}])}>
        <Plus size={16} aria-hidden="true" />
        항목 추가
      </GhostButton>
    </div>
  )
}

function FieldControl({ field, value, onChange, onUploadingChange }) {
  switch (field.kind) {
    case 'textarea':
      return (
        <TextArea
          value={value ?? ''}
          rows={field.rows || 4}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'select':
      return (
        <Select
          value={value ?? ''}
          options={field.options || []}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      )
    case 'toggle':
      return <Toggle checked={Boolean(value)} onChange={onChange} label={field.label} />
    case 'image':
      return (
        <ImageUpload
          value={value || ''}
          onChange={onChange}
          usage={field.usage}
          onUploadingChange={onUploadingChange}
        />
      )
    case 'file':
      return (
        <ImageUpload
          value={value || ''}
          onChange={onChange}
          accept={field.accept}
          preview={false}
          usage={field.usage}
          onUploadingChange={onUploadingChange}
        />
      )
    case 'pairs':
      return <PairsField field={field} value={value || []} onChange={onChange} />
    case 'date':
      // X5: 네이티브 date 입력 폐기 → 공용 캘린더(값 계약 'YYYY-MM-DD' 동일)
      return <DateInput value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    default:
      return (
        <Input
          type={field.kind === 'url' ? 'url' : field.kind === 'email' ? 'email' : 'text'}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/**
 * EntityCrud — 리스트 + 인라인 폼 CRUD.
 * @param {{
 *   type: string, title: string, desc?: string,
 *   fields: Array, display: Function, // display(item) → { title, meta, thumb? }
 *   toPayload?: Function, fromItem?: Function, sortFn?: Function,
 *   orderable?: boolean, headExtra?: import('react').ReactNode
 * }} props
 */
function EntityCrud({
  type,
  title,
  desc,
  fields,
  display,
  toPayload,
  fromItem,
  sortFn,
  orderable = true,
  headExtra,
}) {
  const { data, loading, error, offline, refetch } = useApi(`/admin/content/${type}`, {
    params: { page: 1, pageSize: 100 },
  })
  const [editing, setEditing] = useState(null) // null | 'new' | id
  // 정렬은 모드일 때만. 핸들 상시 노출을 없애고 사이트 전역 정렬 UX(정렬 버튼 토글)에 맞춘다.
  const [sorting, setSorting] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0) // 진행 중 업로드 수 — 0보다 크면 저장 차단
  const [saveError, setSaveError] = useState(null)
  const onUploadingChange = (active) =>
    setUploading((n) => Math.max(0, n + (active ? 1 : -1)))

  const raw = data?.items || (Array.isArray(data) ? data : [])
  const items = [...raw].sort(
    sortFn || ((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)))
  )

  const openNew = () => {
    setSaveError(null)
    setForm(emptyForm(fields))
    setEditing('new')
  }
  const openEdit = (item) => {
    setSaveError(null)
    setForm(fromItem ? fromItem(item) : pickForm(fields, item))
    setEditing(item.id)
  }
  const close = () => {
    setEditing(null)
    setForm(null)
    setUploading(0)
  }

  const save = async (e) => {
    e.preventDefault()
    if (uploading > 0) return // 업로드 완료 전 저장 차단 — 빈 URL 저장 방지
    setBusy(true)
    setSaveError(null)
    try {
      const payload = toPayload ? toPayload(form) : form
      if (editing === 'new') await api.post(`/admin/content/${type}`, payload)
      else await api.put(`/admin/content/${type}/${editing}`, payload)
      close()
      refetch()
    } catch (err) {
      setSaveError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item) => {
    if (!window.confirm('삭제하시겠습니까? 되돌릴 수 없습니다.')) return
    try {
      await api.del(`/admin/content/${type}/${item.id}`)
      if (editing === item.id) close()
      refetch()
    } catch (err) {
      window.alert(err.message)
    }
  }

  // C3(22_PHASE10): 공용 useDragSort — 드롭 시 재정렬 후 값이 달라진 행만 순차 PUT
  const reorder = async (from, to) => {
    if (from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    try {
      for (const [i, it] of next.entries()) {
        if (it.sort !== i) await api.put(`/admin/content/${type}/${it.id}`, { sort: i })
      }
    } catch (err) {
      window.alert(err.message)
    }
    refetch()
  }
  const { dragIndex, overIndex, rowProps } = useDragSort(reorder)

  // K1-6: 공용 폼 패널 — '추가'는 목록 상단, '수정'은 해당 행 자리에서 렌더
  const formPanel = form && (
    <form
      onSubmit={save}
      className="flex w-full flex-col gap-16 rounded-glass border border-glass-line bg-glass-bg p-24 backdrop-blur-glass-mobile"
    >
      <div className="flex items-center justify-between gap-16">
        <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">
          {editing === 'new' ? '항목 추가' : '항목 수정'}
        </h3>
        <button type="button" onClick={close} aria-label="닫기" className={ICON_BTN}>
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={f.span2 ? 'md:col-span-2' : ''}>
            <Field label={f.label} hint={f.hint}>
              <FieldControl
                field={f}
                value={form[f.key]}
                onChange={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
                onUploadingChange={onUploadingChange}
              />
            </Field>
          </div>
        ))}
      </div>
      <ErrorText>{saveError}</ErrorText>
      <div className="flex items-center gap-8">
        <PrimaryButton type="submit" disabled={busy || uploading > 0}>
          {busy ? '저장 중' : uploading > 0 ? '업로드 완료 대기' : '저장'}
        </PrimaryButton>
        <GhostButton onClick={close}>취소</GhostButton>
      </div>
    </form>
  )

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title={title}
        desc={desc}
        offline={offline}
        actions={
          <>
            {headExtra}
            {orderable && (
              <GhostButton onClick={() => setSorting((v) => !v)} aria-pressed={sorting}>
                <ArrowUpDown size={16} aria-hidden="true" />
                {sorting ? '정렬 완료' : '정렬'}
              </GhostButton>
            )}
            <GhostButton onClick={openNew}>
              <Plus size={16} aria-hidden="true" />
              추가
            </GhostButton>
          </>
        }
      />

      {sorting && (
        <p className="font-mono text-caption-m text-text-meta">
          핸들을 끌어 순서를 바꿉니다. 바뀐 순서는 바로 저장됩니다.
        </p>
      )}

      {error && <ErrorText>{error.message}</ErrorText>}
      {loading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
      {!loading && !items.length && <EmptyNote />}

      {editing === 'new' && formPanel}

      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((item, i) => {
            // K1-6: 수정 중인 행은 그 자리에서 폼으로 교체 — 목록이 밀리지 않는다
            if (editing === item.id && form) {
              return (
                <li key={item.id} className="border-b border-border-subtle py-12 first:border-t">
                  {formPanel}
                </li>
              )
            }
            const d = display(item)
            const draggable = orderable && sorting && editing === null
            return (
              <li
                key={item.id}
                {...(draggable ? rowProps(i) : {})}
                className={`flex min-w-0 items-center gap-12 border-b border-border-subtle py-12 transition duration-fast ease-out first:border-t ${
                  dragIndex === i ? 'opacity-40' : ''
                } ${overIndex === i && dragIndex !== null && dragIndex !== i ? 'bg-glass-bg' : ''}`}
              >
                {draggable && <DragHandle />}
                {d.thumb && (
                  <img
                    src={d.thumb}
                    alt=""
                    loading="lazy"
                    className="h-48 w-48 shrink-0 rounded-md border border-border-subtle bg-bg-elev object-cover grayscale"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-m text-text-pri md:text-body-d">
                    {d.title}
                  </span>
                  {d.meta && (
                    <span className="block truncate font-mono text-caption-m text-text-meta">
                      {d.meta}
                    </span>
                  )}
                </span>
                {'active' in item && (
                  <span className="font-mono text-caption-m text-text-meta">
                    {item.active ? '표시' : '숨김'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  aria-label="수정"
                  className={ICON_BTN}
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  aria-label="삭제"
                  className={ICON_BTN}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default EntityCrud
