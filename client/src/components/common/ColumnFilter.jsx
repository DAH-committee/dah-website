import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, ListFilter, Search, X } from 'lucide-react'

// ColumnFilter.jsx — G1(37_SHEET_ROADMAP) 구글 시트식 컬럼 헤더 필터.
//
// 표 헤더의 필터 아이콘을 누르면 그 컬럼의 고유값이 체크박스 목록으로 뜨고, 원하는 값만 골라
// 필터링한다. 정렬(오름/내림)도 같은 드롭다운에서 처리한다. 네이티브 select 미사용.
//
// 레이아웃 불변 계약(37 절대원칙 4): 패널은 body 포털 + position:fixed로 띄운다. 표의 문서
// 흐름에 공간을 차지하지 않으므로 열고 닫아도 컬럼 폭·표 위치가 1px도 변하지 않는다.
//
// 표면: G4 밝은 읽기 표면(reading.*) 기준 — 이 컴포넌트의 소비처인 접수 시트가 밝은 표면이라
// 패널도 같은 표면 언어를 쓴다. 색은 전부 CI.md HEX(tokens.reading) 경유.
//
// 값 계약: selected가 null이면 "전체"(필터 없음), Set이면 그 값만 통과.
//   onChange(nextSelectedOrNull) / onSortChange('asc'|'desc'|null)
// 구글 시트처럼 체크박스를 고르는 동안에는 표가 움직이지 않고, "확인"을 누르면 한 번에 적용된다.
// "취소"나 바깥 클릭, Esc는 고른 내용을 버린다. values는 호출하는 쪽에서 다른 열 필터를 거친 값만 넘긴다.

const PANEL_MAX_H = 320
const SEARCH_THRESHOLD = 8 // 값이 이보다 많으면 검색창 노출

function ColumnFilter({
  label,
  values = [],
  selected = null,
  onChange,
  sort = null,
  onSortChange,
}) {
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const [query, setQuery] = useState('')

  // 선택 중인 값(확인을 누르기 전). 패널을 열 때 현재 적용된 선택으로 채운다.
  const [draft, setDraft] = useState(() => new Set())
  const active = selected instanceof Set && values.some((v) => !selected.has(v))
  const isChecked = useCallback((v) => draft.has(v), [draft])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return values
    return values.filter((v) => String(v).toLowerCase().includes(q))
  }, [values, query])

  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // 우측·하단 화면 밖으로 나가지 않게 보정
    const width = 240
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    const top = Math.min(r.bottom + 4, window.innerHeight - PANEL_MAX_H - 8)
    setRect({ top: Math.max(8, top), left, width })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onDocPointer = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  const toggle = (v) => {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  const openPanel = () => {
    place()
    setQuery('')
    setDraft(new Set(values.filter((v) => !(selected instanceof Set) || selected.has(v))))
  }

  // 검색어가 있으면 보이는 값만, 없으면 전체 값을 한꺼번에 고르거나 해제한다
  const selectShown = () =>
    setDraft((prev) => {
      const next = new Set(prev)
      shown.forEach((v) => next.add(v))
      return next
    })
  const clearShown = () =>
    setDraft((prev) => {
      const next = new Set(prev)
      shown.forEach((v) => next.delete(v))
      return next
    })

  const apply = () => {
    const all = values.every((v) => draft.has(v))
    onChange?.(all ? null : new Set(values.filter((v) => draft.has(v))))
    setOpen(false)
  }

  const SORT_BTN =
    'flex flex-1 cursor-pointer items-center justify-center gap-4 rounded-sm px-8 py-8 text-caption-m transition-colors duration-fast ease-out'

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} 필터·정렬`}
        onClick={() => {
          if (!open) openPanel()
          setOpen((v) => !v)
        }}
        className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors duration-fast ease-out md:h-24 md:w-24 ${
          active || sort
            ? 'bg-reading-accent text-reading-surface'
            : 'text-reading-textMeta hover:bg-reading-subtle hover:text-reading-text'
        }`}
      >
        <ListFilter size={14} aria-hidden="true" />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`${label} 필터`}
            style={{ top: rect.top, left: rect.left, width: rect.width }}
            className="fixed z-[110] flex flex-col rounded-sm border border-reading-hairline bg-reading-surface shadow-glass"
          >
            {/* 정렬 */}
            <div className="flex gap-4 border-b border-reading-hairline p-8">
              <button
                type="button"
                onClick={() => onSortChange?.(sort === 'asc' ? null : 'asc')}
                aria-pressed={sort === 'asc'}
                className={`${SORT_BTN} ${
                  sort === 'asc'
                    ? 'bg-reading-accent text-reading-surface'
                    : 'text-reading-text hover:bg-reading-subtle'
                }`}
              >
                <ArrowUp size={14} aria-hidden="true" />
                오름차순
              </button>
              <button
                type="button"
                onClick={() => onSortChange?.(sort === 'desc' ? null : 'desc')}
                aria-pressed={sort === 'desc'}
                className={`${SORT_BTN} ${
                  sort === 'desc'
                    ? 'bg-reading-accent text-reading-surface'
                    : 'text-reading-text hover:bg-reading-subtle'
                }`}
              >
                <ArrowDown size={14} aria-hidden="true" />
                내림차순
              </button>
            </div>

            {/* 검색 (값이 많을 때만) */}
            {values.length > SEARCH_THRESHOLD && (
              <div className="flex items-center gap-8 border-b border-reading-hairline px-12 py-8">
                <Search size={14} aria-hidden="true" className="shrink-0 text-reading-textMeta" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="값 검색"
                  aria-label={`${label} 값 검색`}
                  className="w-full min-w-0 bg-transparent text-caption-m text-reading-text outline-none placeholder:text-reading-textMeta"
                />
              </div>
            )}

            {/* 전체 선택·해제 */}
            <div className="flex gap-4 border-b border-reading-hairline p-8">
              <button
                type="button"
                onClick={selectShown}
                className="flex-1 cursor-pointer rounded-sm px-8 py-4 text-caption-m text-reading-accent transition-colors duration-fast ease-out hover:bg-reading-subtle"
              >
                전체 선택
              </button>
              <button
                type="button"
                onClick={clearShown}
                className="flex-1 cursor-pointer rounded-sm px-8 py-4 text-caption-m text-reading-textMeta transition-colors duration-fast ease-out hover:bg-reading-subtle"
              >
                전체 해제
              </button>
            </div>

            <p className="border-b border-reading-hairline px-12 py-4 text-caption-m text-reading-textMeta" aria-live="polite">
              {values.length}개 중 {values.filter((v) => draft.has(v)).length}개 선택
            </p>

            {/* 값 목록 */}
            <ul className="min-h-0 flex-1 overflow-y-auto p-4" style={{ maxHeight: PANEL_MAX_H - 120 }}>
              {shown.length === 0 && (
                <li className="px-12 py-8 text-caption-m text-reading-textMeta">값이 없습니다</li>
              )}
              {shown.map((v) => {
                const on = isChecked(v)
                return (
                  <li key={String(v)}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(v)}
                      className="flex w-full cursor-pointer items-center gap-8 rounded-sm px-8 py-8 text-left text-caption-m text-reading-text transition-colors duration-fast ease-out hover:bg-reading-subtle"
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-sm border ${
                          on
                            ? 'border-reading-accent bg-reading-accent text-reading-surface'
                            : 'border-reading-hairline'
                        }`}
                      >
                        {on && <Check size={12} />}
                      </span>
                      <span className="min-w-0 truncate">{String(v) || '(빈 셀)'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="flex justify-end gap-8 border-t border-reading-hairline p-8">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex cursor-pointer items-center gap-4 rounded-sm px-12 py-4 text-caption-m text-reading-textMeta transition-colors duration-fast ease-out hover:bg-reading-subtle"
              >
                <X size={12} aria-hidden="true" />
                취소
              </button>
              <button
                type="button"
                onClick={apply}
                className="flex cursor-pointer items-center gap-4 rounded-sm bg-reading-accent px-12 py-4 text-caption-m font-semibold text-reading-surface transition-opacity duration-fast ease-out hover:opacity-90"
              >
                <Check size={12} aria-hidden="true" />
                확인
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

export default ColumnFilter
