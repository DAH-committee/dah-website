// 연속 쪽 보기: 서버가 그린 쪽 그림(<img>)을 세로로 늘어놓고, 그 위에 투명한 눌림 층을 얹는다.
// 눌림 층: 마우스를 올리면 영역 테두리(보라 1px), 누르면 블록/표 칸 선택, 두 번 누르거나 Enter 로 그 자리에서 글 고치기.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hitTest, regionRect, regionsOf, estimateFontPx } from './hwpCore'

/** 쪽 하나. 보이면 onVisible(n) 으로 그림을 요청한다 */
function Page({ n, data, w, h, scale, hover, sel, changed, flagged, editing, onVisible, onMove, onLeave, onPick, onEdit, editor }) {
  const box = useRef(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      onVisible(n)
      return undefined
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onVisible(n), { rootMargin: '900px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [n, onVisible])

  const pt = (e) => {
    const r = box.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }
  const regions = data?.regions || []
  const hoverHere = hover && hover.page === n ? hover.region : null
  const selRegions = sel && sel.page === n ? regionsOf(regions, sel) : []
  const pw = w * scale
  const ph = h * scale
  return (
    <div className="hf-page" data-page={n} ref={box} style={{ width: pw, height: ph }}>
      {data?.url ? <img src={data.url} alt={`${n}쪽`} draggable={false} width={pw} height={ph} /> : <div className="hf-page__wait">{n}쪽 불러오는 중</div>}
      <div
        className="hf-hit"
        onMouseMove={(e) => {
          if (!data) return
          const p = pt(e)
          onMove(n, hitTest(regions, p.x, p.y))
        }}
        onMouseLeave={() => onLeave(n)}
        onClick={(e) => {
          if (!data) return
          const p = pt(e)
          onPick(n, hitTest(regions, p.x, p.y))
        }}
        onDoubleClick={(e) => {
          if (!data) return
          const p = pt(e)
          onEdit(n, hitTest(regions, p.x, p.y))
        }}
      >
        {changed.size > 0 &&
          regions
            .filter((r) => r.block && !r.cell && changed.has(r.block))
            .map((r) => <i key={`c${r.id}`} className={`hf-mark hf-mark--${changed.get(r.block)}`} style={regionRect(r, scale)} />)}
        {flagged.size > 0 &&
          regions
            .filter((r) => r.block && !r.cell && flagged.has(r.block))
            .map((r) => <i key={`f${r.id}`} className="hf-mark hf-mark--flag" style={regionRect(r, scale)} />)}
        {hoverHere && !editing && <i className="hf-hover" style={regionRect(hoverHere, scale)} />}
        {selRegions.map((r) => (
          <i key={`s${r.id}`} className="hf-selbox" style={regionRect(r, scale)} />
        ))}
      </div>
      {editor && editor.page === n && editor.node}
    </div>
  )
}

/** 그 자리 편집 상자: 영역 위에 떠서 원래 글자 크기에 가깝게 보인다 */
export function InPlaceEditor({ rect, text, scale, bbox, onChange, onCommit, onCancel, busy }) {
  const ta = useRef(null)
  const done = useRef(false)
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.max(rect.height, el.scrollHeight)}px`
  }, [text, rect.height])
  const font = estimateFontPx(bbox, text, scale)
  return (
    <textarea
      ref={ta}
      className="hf-editor"
      aria-label="글 고치기"
      value={text}
      disabled={busy}
      spellCheck={false}
      style={{ left: rect.left - 4, top: rect.top - 3, width: Math.max(rect.width + 8, 90), minHeight: rect.height + 6, fontSize: font, lineHeight: 1.45 }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          done.current = true
          onCancel()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          done.current = true
          onCommit()
        }
        e.stopPropagation()
      }}
      onBlur={() => {
        if (done.current) return
        done.current = true
        onCommit()
      }}
    />
  )
}

export default function HwpPageView({ pageCount, sizeOf, scale, pageData, hover, sel, changed, flagged, editing, editorNode, onVisible, onMove, onLeave, onPick, onEdit, scrollRef, onScrollPage }) {
  const raf = useRef(0)
  const [, tick] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const onScroll = () => {
      cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(() => {
        const mid = el.getBoundingClientRect().top + el.clientHeight * 0.35
        let best = 1
        for (const p of el.querySelectorAll('.hf-page')) {
          const r = p.getBoundingClientRect()
          if (r.top <= mid) best = Number(p.dataset.page)
          else break
        }
        onScrollPage(best)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    tick((x) => x + 1)
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf.current)
    }
  }, [scrollRef, onScrollPage, pageCount, scale])
  const pages = []
  for (let n = 1; n <= pageCount; n += 1) {
    const sz = sizeOf(n)
    pages.push(
      <Page
        key={n}
        n={n}
        data={pageData(n)}
        w={sz.w}
        h={sz.h}
        scale={scale}
        hover={hover}
        sel={sel}
        changed={changed}
        flagged={flagged}
        editing={Boolean(editing)}
        editor={editorNode}
        onVisible={onVisible}
        onMove={onMove}
        onLeave={onLeave}
        onPick={onPick}
        onEdit={onEdit}
      />
    )
  }
  return <div className="hf-pages">{pages}</div>
}
