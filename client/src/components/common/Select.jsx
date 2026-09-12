import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

// Select.jsx — X5(33_PHASE18) 네이티브 <select> 전면 대체 공용 드롭다운.
//
// 왜: 맥·브라우저 기본 select UI가 우리 다크·글래스 시스템과 충돌한다(밝은 네이티브 팝업).
// 검색 없는 단순형. 유리 패널·키보드 접근·포커스 링 전부 우리 토큰.
//
// 접근성: role="listbox" + aria-activedescendant. 키보드 ↑↓/Home/End/Enter/Space/ESC/타이핑 점프.
// 패널은 포털(body)로 띄워 부모 overflow·스택 컨텍스트에 잘리지 않는다.
// 모션(apple-design 1·14절): 열림은 duration-fast 전환, reduced-motion은 index.css 전역이 무효화.

const FIELD =
  'flex w-full cursor-pointer items-center justify-between gap-8 rounded-md border border-border-subtle bg-bg-panel px-16 py-12 text-left text-body-m text-text-pri outline-none transition duration-fast ease-out hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-bg-elev disabled:text-text-disabled aria-[invalid=true]:border-state-error'

function Select({
  options = [],
  value,
  onChange,
  placeholder = '선택',
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  className = '',
}) {
  const reactId = useId()
  const listId = `${id || reactId}-listbox`
  const btnRef = useRef(null)
  const listRef = useRef(null)
  const typeaheadRef = useRef({ buf: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const selectedIndex = options.findIndex((o) => o.value === value)
  const [activeIndex, setActiveIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex)

  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom + 4, left: r.left, width: r.width, bottom: r.top })
  }, [])

  const openList = useCallback(() => {
    if (disabled) return
    place()
    setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex)
    setOpen(true)
  }, [disabled, place, selectedIndex])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }, [])

  const commit = useCallback(
    (index) => {
      const opt = options[index]
      if (!opt || opt.disabled) return
      onChange?.(opt.value)
      close()
    },
    [options, onChange, close]
  )

  // 열려 있는 동안 스크롤·리사이즈 추종 + 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return undefined
    const onDocPointer = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (listRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointer)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  // 활성 항목을 패널 안으로 스크롤
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const move = (delta) => {
    if (!options.length) return
    let next = activeIndex
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length
      if (!options[next]?.disabled) break
    }
    setActiveIndex(next)
  }

  const onKeyDown = (e) => {
    if (disabled) return
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(activeIndex)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key.length === 1) {
      // 타이핑 점프 — 1초 내 연속 입력은 누적 검색
      const now = Date.now()
      const t = typeaheadRef.current
      t.buf = now - t.at > 1000 ? e.key : t.buf + e.key
      t.at = now
      const q = t.buf.toLowerCase()
      const hit = options.findIndex(
        (o) => !o.disabled && String(o.label).toLowerCase().startsWith(q)
      )
      if (hit >= 0) setActiveIndex(hit)
    }
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-errormessage={ariaErrorMessage}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`${FIELD} ${className}`.trim()}
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-text-meta'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-icon transition-transform duration-fast ease-out ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={`${listId}-${activeIndex}`}
            style={{ top: rect.top, left: rect.left, width: rect.width }}
            className="fixed z-[110] max-h-[280px] overflow-y-auto rounded-md border border-glass-line bg-cosmos-depth1/[0.98] p-4 shadow-glass backdrop-blur-glass"
          >
            {options.length === 0 && (
              <li className="px-12 py-8 font-mono text-caption-m text-text-meta">
                선택할 항목이 없습니다
              </li>
            )}
            {options.map((opt, i) => {
              const isSelected = opt.value === value
              return (
                <li
                  key={opt.value}
                  id={`${listId}-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  onPointerEnter={() => !opt.disabled && setActiveIndex(i)}
                  onClick={() => commit(i)}
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-8 rounded-sm px-12 py-8 text-body-m transition-colors duration-fast ease-out ${
                    opt.disabled
                      ? 'cursor-default text-text-disabled'
                  : i === activeIndex
                    ? 'bg-glass-strong text-text-pri'
                    : 'text-text-sec hover:bg-glass-strong hover:text-text-pri'
                  }`}
                >
                  <span className="min-w-0 truncate">{opt.label}</span>
                  {isSelected && (
                    <Check size={16} aria-hidden="true" className="shrink-0 text-icon-active" />
                  )}
                </li>
              )
            })}
          </ul>,
          document.body
        )}
    </>
  )
}

export default Select
