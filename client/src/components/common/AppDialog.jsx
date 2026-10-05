// 사이트 공용 대화상자. 브라우저 기본 confirm·alert·prompt 대신 이 모달만 쓴다.
// 모양은 LoginModal과 같은 디자인 시스템 토큰(글래스 패널, 토큰 버튼)이고,
// 밝은 작업면(문서·시트·설문지·작업공간) 위에서는 읽기 표면(reading) 토큰으로 바뀐다.
//
//   const ok = await confirmDialog({ message: '삭제할까요?', confirmLabel: '삭제' })
//   const name = await promptDialog({ title: '이름 바꾸기', label: '새 이름', defaultValue: '...' })   // 취소하면 null
//   await alertDialog({ message: '저장하지 못했습니다' })
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'

let queue = []
let listeners = new Set()
let seq = 0

const emit = () => listeners.forEach((l) => l())
const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = () => queue

function open(spec) {
  return new Promise((resolve) => {
    const light = typeof document !== 'undefined' && Boolean(document.querySelector('.reading-scope, .gd, .ws'))
    queue = [...queue, { ...spec, id: ++seq, light, resolve }]
    emit()
  })
}

function close(id, value) {
  const item = queue.find((q) => q.id === id)
  if (!item) return
  queue = queue.filter((q) => q.id !== id)
  emit()
  item.resolve(value)
}

export const confirmDialog = (opts = {}) => open({ type: 'confirm', ...(typeof opts === 'string' ? { message: opts } : opts) })
export const alertDialog = (opts = {}) => open({ type: 'alert', ...(typeof opts === 'string' ? { message: opts } : opts) })
export const promptDialog = (opts = {}) => open({ type: 'prompt', ...(typeof opts === 'string' ? { label: opts } : opts) })

const BTN = 'inline-flex h-40 cursor-pointer items-center justify-center rounded-full px-24 text-small-m font-semibold transition duration-fast ease-out'

function Panel({ item }) {
  const { id, type, title, message, label, defaultValue = '', multiline = false, placeholder = '', tone = 'default', light } = item
  const confirmLabel = item.confirmLabel || (type === 'alert' ? '확인' : '확인')
  const cancelLabel = item.cancelLabel || '취소'
  const [value, setValue] = useState(defaultValue)
  const ref = useRef(null)
  const done = (v) => close(id, v)
  const cancelValue = type === 'prompt' ? null : false
  const okValue = type === 'prompt' ? value : type === 'alert' ? undefined : true

  useEffect(() => {
    const el = ref.current
    el?.querySelector('input, textarea')?.focus()
    if (!el?.querySelector('input, textarea')) el?.querySelector('[data-ok]')?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        done(type === 'alert' ? undefined : cancelValue)
      } else if (e.key === 'Enter' && !(multiline && e.target.tagName === 'TEXTAREA') && !e.isComposing) {
        e.preventDefault()
        done(okValue)
      } else if (e.key === 'Tab') {
        const f = el?.querySelectorAll('button:not([disabled]), input, textarea')
        if (!f?.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className={`${light ? 'reading-scope' : ''} app-dialog fixed inset-0 z-[300] flex items-center justify-center px-16`} role="presentation">
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={() => done(type === 'alert' ? undefined : cancelValue)} className={`app-dialog__backdrop absolute inset-0 cursor-default ${light ? 'bg-black/45' : 'bg-bg-base/70'}`} />
      <div
        ref={ref}
        role={type === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={title || message || label}
        className={`app-dialog__panel relative w-full max-w-[400px] rounded-glass bg-cosmos-depth1/[0.97] p-24 shadow-glass backdrop-blur-glass ${light ? 'shadow-[0_8px_32px_rgb(0_0_0/0.28)]' : 'border border-glass-line'}`}
      >
        <button type="button" aria-label="닫기" onClick={() => done(type === 'alert' ? undefined : cancelValue)} className="absolute right-12 top-12 flex h-40 w-40 cursor-pointer items-center justify-center rounded-full text-text-sec transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri">
          <X size={18} aria-hidden="true" />
        </button>
        {title && <h2 className="pr-40 text-body-l-m font-bold text-text-pri">{title}</h2>}
        {message && <p className={`${title ? 'mt-12' : 'pr-32'} whitespace-pre-line break-keep text-body-m leading-relaxed text-text-sec`}>{message}</p>}
        {type === 'prompt' && (
          <label className="mt-16 flex flex-col gap-8">
            {label && <span className="text-small-m font-semibold text-text-sec">{label}</span>}
            {multiline ? (
              <textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="w-full resize-y rounded-sm bg-bg-elev px-12 py-8 text-body-m text-text-pri outline-none focus:outline focus:outline-2 focus:outline-purple-primary" />
            ) : (
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="h-44 w-full rounded-sm bg-bg-elev px-12 text-body-m text-text-pri outline-none focus:outline focus:outline-2 focus:outline-purple-primary" />
            )}
          </label>
        )}
        <div className="mt-24 flex items-center justify-end gap-8">
          {type !== 'alert' && (
            <button type="button" onClick={() => done(cancelValue)} className={`${BTN} text-text-sec hover:bg-glass-strong`}>{cancelLabel}</button>
          )}
          <button
            type="button"
            data-ok
            onClick={() => done(okValue)}
            className={`${BTN} bg-button-primary text-button-primaryText hover:bg-button-primaryHover`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DialogHost() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot)
  const top = items[items.length - 1]
  if (!top) return null
  return <Panel key={top.id} item={top} />
}
