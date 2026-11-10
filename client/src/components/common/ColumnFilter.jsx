import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ListFilter, Search } from 'lucide-react'

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

const PANEL_MAX_H = 440

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
    const width = 280
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
            {/* 정렬: 구글 시트처럼 한 줄씩 */}
            <div className="flex flex-col border-b border-reading-hairline py-4">
              {[
                ['asc', '정렬, 오름차순'],
                ['desc', '정렬, 내림차순'],
              ].map(([dir, text]) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => onSortChange?.(sort === dir ? null : dir)}
                  aria-pressed={sort === dir}
                  className={`flex w-full cursor-pointer items-center gap-8 px-16 py-8 text-left text-caption-m transition-colors duration-fast ease-out hover:bg-reading-subtle ${
                    sort === dir ? 'font-semibold text-reading-accent' : 'text-reading-text'
                  }`}
                >
                  {sort === dir ? <Check size={12} aria-hidden="true" /> : <span className="w-12" aria-hidden="true" />}
                  {text}
                </button>
              ))}
            </div>

            {/* 값별 필터링 */}
            <p className="px-16 pt-8 text-caption-m font-semibold text-reading-text">값별 필터링</p>
            <div className="flex items-center justify-between gap-8 px-16 py-8 text-caption-m">
              <span className="flex items-center gap-4">
                <button type="button" onClick={selectShown} className="cursor-pointer text-reading-accent underline underline-offset-2">
                  {shown.length}개 모두 선택
                </button>
                <span className="text-reading-textMeta" aria-hidden="true">-</span>
                <button type="button" onClick={clearShown} className="cursor-pointer text-reading-accent underline underline-offset-2">
                  지우기
                </button>
              </span>
              <span className="text-reading-textMeta" aria-live="polite">
                {values.filter((v) => draft.has(v)).length}개 표시 중
              </span>
            </div>

            {/* 검색 */}
            <div className="mx-16 mb-8 flex items-center gap-8 rounded-sm border border-reading-hairline px-8 py-4">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={`${label} 값 검색`}
                className="w-full min-w-0 bg-transparent text-caption-m text-reading-text outline-none"
              />
              <Search size={14} aria-hidden="true" className="shrink-0 text-reading-textMeta" />
            </div>

            {/* 값 목록: 체크한 값에만 체크 표시 */}
            <ul className="min-h-0 flex-1 overflow-y-auto px-8" style={{ maxHeight: PANEL_MAX_H - 120 }}>
              {shown.length === 0 && (
                <li className="px-8 py-8 text-caption-m text-reading-textMeta">값이 없습니다</li>
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
                      <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center text-reading-accent">
                        {on && <Check size={14} />}
                      </span>
                      <span className="min-w-0 truncate">{String(v) || '(빈 셀)'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="flex justify-end gap-8 border-t border-reading-hairline p-12">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-sm border border-reading-hairline px-16 py-8 text-caption-m text-reading-text transition-colors duration-fast ease-out hover:bg-reading-subtle"
              >
                취소
              </button>
              <button
                type="button"
                onClick={apply}
                className="cursor-pointer rounded-sm bg-reading-accent px-16 py-8 text-caption-m font-semibold text-reading-surface transition-opacity duration-fast ease-out hover:opacity-90"
              >
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
