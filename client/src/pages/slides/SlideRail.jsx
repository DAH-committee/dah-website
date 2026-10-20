// 왼쪽 슬라이드 목록: 썸네일, 끌어서 순서 바꾸기, 오른쪽 클릭 메뉴(복제, 삭제, 숨기기, 위·아래로).
import { memo, useEffect, useRef, useState } from 'react'
import { Copy, EyeOff, Eye, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import SlideView from './SlideView'

const THUMB_W = 160
const Thumb = memo(function Thumb({ slide, theme }) {
  return <SlideView slide={slide} theme={theme} scale={THUMB_W / 1920} mode="thumb" />
})

export default function SlideRail({ slides, theme, cur, canEdit, onPick, onMove, onDuplicate, onDelete, onToggleHidden, railRef }) {
  const [drag, setDrag] = useState(null) // {from, over}
  const [menu, setMenu] = useState(null) // {i, x, y}
  const list = useRef(null)

  useEffect(() => {
    const el = list.current?.querySelector(`[data-idx="${cur}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cur])

  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const act = (fn) => (e) => {
    e.stopPropagation()
    fn()
    setMenu(null)
  }

  return (
    <nav className="sl-rail" aria-label="슬라이드 목록" ref={railRef} tabIndex={-1}>
      <ol ref={list} className="sl-rail__list">
        {slides.map((s, i) => (
          <li
            key={s.id}
            data-idx={i}
            className={`sl-thumb ${i === cur ? 'is-current' : ''} ${s.hidden ? 'is-hidden' : ''} ${drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'is-drop-after' : 'is-drop-before') : ''}`}
            draggable={canEdit}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/x-dah-slide', String(i))
              setDrag({ from: i, over: i })
            }}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              if (drag.over !== i) setDrag({ ...drag, over: i })
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag && drag.from !== i) onMove(drag.from, i)
              setDrag(null)
            }}
            onDragEnd={() => setDrag(null)}
            onContextMenu={(e) => {
              if (!canEdit) return
              e.preventDefault()
              onPick(i)
              setMenu({ i, x: e.clientX, y: e.clientY })
            }}
          >
            <span className="sl-thumb__num">{i + 1}</span>
            <button type="button" className="sl-thumb__btn" onClick={() => onPick(i)} aria-label={`슬라이드 ${i + 1}${s.hidden ? ' (건너뜀)' : ''}`} aria-current={i === cur ? 'true' : undefined}>
              <Thumb slide={s} theme={theme} />
              {s.hidden && (
                <span className="sl-thumb__hidden" title="발표에서 건너뜀">
                  <EyeOff size={14} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
      {menu && (
        <div className="sl-menu" style={{ left: menu.x, top: menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={act(() => onDuplicate(menu.i))}>
            <Copy size={16} /> 복제
          </button>
          <button type="button" role="menuitem" onClick={act(() => onToggleHidden(menu.i))}>
            {slides[menu.i]?.hidden ? <Eye size={16} /> : <EyeOff size={16} />} {slides[menu.i]?.hidden ? '건너뛰기 해제' : '발표에서 건너뛰기'}
          </button>
          <button type="button" role="menuitem" disabled={menu.i === 0} onClick={act(() => onMove(menu.i, menu.i - 1))}>
            <ArrowUp size={16} /> 위로
          </button>
          <button type="button" role="menuitem" disabled={menu.i === slides.length - 1} onClick={act(() => onMove(menu.i, menu.i + 1))}>
            <ArrowDown size={16} /> 아래로
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={act(() => onDelete(menu.i))}>
            <Trash2 size={16} /> 삭제
          </button>
        </div>
      )}
    </nav>
  )
}
