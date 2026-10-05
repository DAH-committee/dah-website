// SheetMenuBar.jsx: 구글 시트 위쪽의 메뉴 막대(파일, 수정, 보기, 삽입, 서식, 데이터).
// 항목 모양:
//   { type: 'divider' }
//   { label, shortcut, onSelect, disabled, checked, items: [...하위 메뉴] }
// 하나를 열어 둔 상태에서 옆 메뉴 위로 마우스를 옮기면 바로 그 메뉴가 열린다. Esc와 바깥 클릭으로 닫힌다.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'

const PANEL =
  'absolute z-40 min-w-[240px] rounded-sm border border-reading-hairline bg-reading-surface py-4 shadow-[0_8px_24px_rgb(33_26_49/0.18)]'

function Items({ items, close }) {
  const [openSub, setOpenSub] = useState(null)
  return (
    <div role="menu">
      {items.map((item, i) => {
        if (item.type === 'divider') return <div key={`d${i}`} role="separator" className="my-4 border-t border-reading-hairline" />
        const hasSub = Array.isArray(item.items)
        return (
          <div key={item.label} className="relative" onMouseEnter={() => setOpenSub(hasSub ? item.label : null)}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup={hasSub || undefined}
              disabled={item.disabled}
              onClick={() => {
                if (hasSub) {
                  setOpenSub(item.label)
                  return
                }
                item.onSelect?.()
                close()
              }}
              className="flex h-40 w-full cursor-pointer items-center gap-12 px-16 text-left text-small-m text-reading-text transition-colors duration-fast ease-out hover:bg-reading-subtle focus-visible:bg-reading-subtle focus-visible:outline-none disabled:cursor-default disabled:text-reading-textMeta disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <span className="flex w-16 shrink-0 items-center justify-center text-reading-accent">{item.checked ? <Check size={16} aria-hidden="true" /> : null}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.shortcut && <span className="shrink-0 text-caption-m text-reading-textMeta">{item.shortcut}</span>}
              {hasSub && <ChevronRight size={16} className="shrink-0 text-reading-textMeta" aria-hidden="true" />}
            </button>
            {hasSub && openSub === item.label && (
              <div className={`${PANEL} left-full top-0`}>
                <Items items={item.items} close={close} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function SheetMenuBar({ menus }) {
  const [open, setOpen] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (open === null) return undefined
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(null)
    }
    const key = (e) => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={ref} role="menubar" aria-label="시트 메뉴" className="flex flex-wrap items-center gap-4 print:hidden">
      {menus.map((menu) => (
        <div key={menu.label} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === menu.label}
            onClick={() => setOpen(open === menu.label ? null : menu.label)}
            onMouseEnter={() => open !== null && setOpen(menu.label)}
            className={`h-32 cursor-pointer rounded-sm px-12 text-[14px] text-reading-text transition-colors duration-fast ease-out hover:bg-reading-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-reading-accent ${open === menu.label ? 'bg-reading-subtle' : ''}`}
          >
            {menu.label}
          </button>
          {open === menu.label && (
            <div className={`${PANEL} left-0 top-[calc(100%+4px)]`}>
              <Items items={menu.items} close={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
