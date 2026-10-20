// 발표 모드: 전체 화면, 키보드·클릭 넘기기, 전환 효과, 요소 등장 효과, 발표자 보기(새 창: 노트, 타이머, 다음 슬라이드).
// 숨긴 슬라이드는 건너뛴다. 키: → ↓ 스페이스 PageDown Enter 다음, ← ↑ PageUp Backspace 이전, Home End, B 검은 화면, Esc 끝내기.
// 글 속 링크와 링크 카드는 누르면 새 탭에서 열리고 슬라이드는 넘어가지 않는다.
// 매직 무브(transition 'magic'): 앞뒤 슬라이드에서 mid(없으면 id)가 같은 요소는 자리·크기·회전·투명도가 600ms 동안 옮겨 가고,
// 짝이 없는 요소는 사라지거나 나타난다(FLIP, CSS transform). 앞으로 갈 때는 들어오는 슬라이드의 전환을, 뒤로 갈 때는 떠나는 슬라이드의 전환을 본다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, MonitorPlay, RotateCcw, X } from 'lucide-react'
import SlideView from './SlideView'
import { SLIDE_H, SLIDE_W, magicMatches, resolveColor } from './deckCore'

const stepsOf = (slide) => [...new Set((slide?.elements || []).filter((e) => e.anim).map((e) => e.anim.order || 1))].sort((a, b) => a - b)

function useFitScale(win, pad = 0) {
  const get = () => Math.min((win.innerWidth - pad) / SLIDE_W, (win.innerHeight - pad) / SLIDE_H)
  const [s, setS] = useState(get)
  useEffect(() => {
    const h = () => setS(get())
    win.addEventListener('resize', h)
    return () => win.removeEventListener('resize', h)
  }, [win]) // eslint-disable-line react-hooks/exhaustive-deps
  return s
}

const MAGIC_MS = 600
const MAGIC_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const isShown = (el, step) => !el.anim || step === undefined || (el.anim.order || 1) <= step

/** 매직 무브 계획: 짝(보이는 요소끼리), 앞 슬라이드에서 사라질 요소 */
function magicPlan(from, fromStep, to, toStep) {
  const pairs = magicMatches(from, to).filter(([a, b]) => isShown(a, fromStep) && isShown(b, toStep))
  const gone = new Set(pairs.map(([a]) => a.id))
  const leaving = { ...from, background: { color: 'transparent' }, elements: from.elements.filter((e) => !gone.has(e.id)) }
  return { pairs, leaving }
}

const fmt = (ms) => {
  const t = Math.floor(ms / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
}

function PresenterView({ slides, theme, idx, step, steps, onGo, onNext, onPrev, startedAt, onReset, win }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const [size, setSize] = useState({ w: win.innerWidth, h: win.innerHeight })
  useEffect(() => {
    const h = () => setSize({ w: win.innerWidth, h: win.innerHeight })
    win.addEventListener('resize', h)
    return () => win.removeEventListener('resize', h)
  }, [win])
  const cur = slides[idx]
  const next = slides[idx + 1]
  const mainW = Math.max(320, size.w * 0.58)
  const sideW = Math.max(220, size.w * 0.3)
  return (
    <div className="sl-presenter">
      <div className="sl-presenter__top">
        <span className="sl-presenter__timer">{fmt(now - startedAt)}</span>
        <button type="button" className="sl-pbtn" onClick={onReset} title="타이머 다시 시작">
          <RotateCcw size={16} /> 다시
        </button>
        <span className="sl-presenter__count">
          {idx + 1} / {slides.length}
          {steps.length > 0 && ` (효과 ${step}/${steps.length})`}
        </span>
        <span className="sl-presenter__clock">{new Date(now).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="sl-presenter__main">
        <div>
          <div className="sl-presenter__label">지금</div>
          <SlideView slide={cur} theme={theme} scale={mainW / SLIDE_W} mode="present" animStep={step} />
          <div className="sl-presenter__nav">
            <button type="button" className="sl-pbtn" onClick={onPrev}>
              <ChevronLeft size={18} /> 이전
            </button>
            <button type="button" className="sl-pbtn sl-pbtn--main" onClick={onNext}>
              다음 <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="sl-presenter__side">
          <div className="sl-presenter__label">다음</div>
          {next ? (
            <button type="button" className="sl-presenter__next" onClick={() => onGo(idx + 1)}>
              <SlideView slide={next} theme={theme} scale={sideW / SLIDE_W} mode="thumb" />
            </button>
          ) : (
            <div className="sl-presenter__end" style={{ width: sideW, height: (sideW * 9) / 16 }}>
              마지막 슬라이드
            </div>
          )}
          <div className="sl-presenter__label">발표자 노트</div>
          <div className="sl-presenter__notes">{cur?.notes?.trim() ? cur.notes : '노트가 없습니다'}</div>
        </div>
      </div>
    </div>
  )
}

export default function Present({ deck, startIndex = 0, presenter = false, onExit, onPresenterBlocked }) {
  const theme = deck.theme
  const slides = useMemo(() => deck.slides.filter((s) => !s.hidden), [deck.slides])
  const firstIdx = useMemo(() => {
    const target = deck.slides[startIndex]
    if (!target) return 0
    if (!target.hidden) return Math.max(0, slides.indexOf(target))
    const after = deck.slides.slice(startIndex).find((s) => !s.hidden)
    return after ? slides.indexOf(after) : Math.max(0, slides.length - 1)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(firstIdx)
  const [step, setStep] = useState(0)
  const [black, setBlack] = useState(false)
  const [dir, setDir] = useState(1)
  const [pwin, setPwin] = useState(null)
  const [startedAt, setStartedAt] = useState(Date.now())
  const [idle, setIdle] = useState(false)
  const [magic, setMagic] = useState(null) // { from, fromStep, toId }
  const root = useRef(null)
  const newRef = useRef(null)
  const oldRef = useRef(null)
  const wasFull = useRef(false)
  const scale = useFitScale(window)
  const cur = slides[idx]
  const steps = useMemo(() => stepsOf(cur), [cur])

  const go = useCallback(
    (i, toEnd = false) => {
      const n = Math.max(0, Math.min(slides.length - 1, i))
      const from = slides[idx]
      const to = slides[n]
      const useMagic = Math.abs(n - idx) === 1 && from && to && (n > idx ? to.transition === 'magic' : from.transition === 'magic') && !reduceMotion()
      setMagic(useMagic ? { from, fromStep: step, toId: to.id } : null)
      setDir(n >= idx ? 1 : -1)
      setIdx(n)
      setStep(toEnd ? stepsOf(slides[n]).length : 0)
      setBlack(false)
    },
    [idx, slides, step]
  )
  const next = useCallback(() => {
    if (black) return setBlack(false)
    if (step < steps.length) return setStep(step + 1)
    if (idx < slides.length - 1) go(idx + 1)
  }, [black, step, steps.length, idx, slides.length, go])
  const prev = useCallback(() => {
    if (black) return setBlack(false)
    if (step > 0) return setStep(step - 1)
    if (idx > 0) go(idx - 1, true)
  }, [black, step, idx, go])

  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    onExit?.()
  }, [onExit])

  // 전체 화면
  useEffect(() => {
    const el = root.current
    if (el?.requestFullscreen && !presenter) el.requestFullscreen().then(() => (wasFull.current = true)).catch(() => {})
    const h = () => {
      if (!document.fullscreenElement && wasFull.current) onExit?.()
    }
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 키보드 (본 창과 발표자 창 모두)
  const onKey = useCallback(
    (e) => {
      const k = e.key
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n', 'N'].includes(k)) {
        e.preventDefault()
        next()
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) {
        e.preventDefault()
        prev()
      } else if (k === 'Home') go(0)
      else if (k === 'End') go(slides.length - 1, true)
      else if (k === 'b' || k === 'B' || k === '.') setBlack((v) => !v)
      else if (k === 'Escape') exit()
    },
    [next, prev, go, slides.length, exit]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    pwin?.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      pwin?.removeEventListener('keydown', onKey)
    }
  }, [onKey, pwin])

  // 마우스가 멈추면 조작 막대를 숨긴다
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), 2200)
    const h = () => {
      setIdle(false)
      clearTimeout(t)
      t = setTimeout(() => setIdle(true), 2200)
    }
    window.addEventListener('pointermove', h)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointermove', h)
    }
  }, [])

  // 발표자 보기 창
  const openPresenter = useCallback(() => {
    if (pwin && !pwin.closed) {
      pwin.focus()
      return
    }
    const w = window.open('', 'dah-slides-presenter', 'width=1200,height=760')
    if (!w) {
      onPresenterBlocked?.()
      return
    }
    w.document.title = '발표자 보기'
    w.document.head.innerHTML = ''
    for (const n of document.querySelectorAll('link[rel="stylesheet"], style')) w.document.head.appendChild(n.cloneNode(true))
    w.document.body.innerHTML = '<div id="sl-presenter-root"></div>'
    w.document.body.style.margin = '0'
    w.addEventListener('beforeunload', () => setPwin(null))
    setPwin(w)
    setStartedAt(Date.now())
  }, [pwin, onPresenterBlocked])
  useEffect(() => {
    if (presenter) openPresenter()
    return () => {
      // 발표를 끝내면 발표자 창도 닫는다
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => pwin && !pwin.closed && pwin.close(), [pwin])

  // 매직 무브: 새 슬라이드가 그려진 직후, 짝 요소를 앞 슬라이드 자리에서 출발시킨다
  const plan = useMemo(() => (magic && cur && magic.toId === cur.id ? magicPlan(magic.from, magic.fromStep, cur, step) : null), [magic, cur]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!plan) return
    const stage = newRef.current
    if (!stage) return
    const anims = []
    const opts = { duration: MAGIC_MS, easing: MAGIC_EASE }
    const nodeOf = (root, id) => root?.querySelector(`[data-el="${CSS.escape(id)}"]`)
    const matched = new Set()
    for (const [a, b] of plan.pairs) {
      const node = nodeOf(stage, b.id)
      if (!node || !node.animate) continue
      matched.add(b.id)
      const dx = a.x + a.w / 2 - (b.x + b.w / 2)
      const dy = a.y + a.h / 2 - (b.y + b.h / 2)
      const sx = a.w / Math.max(1, b.w)
      const sy = a.h / Math.max(1, b.h)
      const oa = a.style?.opacity ?? 1
      const ob = b.style?.opacity ?? 1
      anims.push(
        node.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) rotate(${a.rotate || 0}deg) scale(${sx}, ${sy})`, opacity: a.type === 'image' ? 1 : oa },
            { transform: `translate(0px, 0px) rotate(${b.rotate || 0}deg) scale(1, 1)`, opacity: b.type === 'image' ? 1 : ob },
          ],
          opts
        )
      )
    }
    // 짝이 없는 새 요소는 나타난다
    for (const node of stage.querySelectorAll('[data-el]')) {
      if (matched.has(node.dataset.el) || !node.animate) continue
      const to = getComputedStyle(node).opacity
      if (+to === 0) continue
      anims.push(node.animate([{ opacity: 0 }, { opacity: to }], opts))
    }
    // 배경색이 다르면 색을 옮겨 간다
    const fromBg = resolveColor(magic.from.background?.color || '@bg', theme)
    const toBg = resolveColor(cur.background?.color || '@bg', theme)
    if (fromBg !== toBg && stage.animate) anims.push(stage.animate([{ backgroundColor: fromBg }, { backgroundColor: toBg }], opts))
    // 짝이 없는 앞 요소는 사라진다
    if (oldRef.current?.animate) anims.push(oldRef.current.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, fill: 'forwards' }))
    const t = setTimeout(() => setMagic(null), MAGIC_MS + 40)
    return () => {
      clearTimeout(t)
      anims.forEach((x) => x.cancel())
    }
  }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps

  // 링크는 새 탭에서 열고 슬라이드를 넘기지 않는다
  const openLink = (e) => {
    const a = e.target.closest?.('a[href]')
    if (!a) return false
    const href = a.getAttribute('href') || ''
    e.preventDefault()
    e.stopPropagation()
    if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
    return true
  }

  if (!cur) {
    return (
      <div ref={root} className="sl-present" onClick={exit}>
        <div className="sl-present__empty">보여 줄 슬라이드가 없습니다. 숨긴 슬라이드를 다시 보이게 하세요.</div>
      </div>
    )
  }

  const presenterRoot = pwin && !pwin.closed ? pwin.document.getElementById('sl-presenter-root') : null

  return (
    <div
      ref={root}
      className={`sl-present ${idle ? 'is-idle' : ''}`}
      onClick={(e) => {
        if (openLink(e)) return
        if (e.target.closest('a, iframe, button, .sl-present__bar')) return
        next()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        prev()
      }}
    >
      <style>{'.sl-present .sl-text a[href], .sl-present a.sl-embed { cursor: pointer; } .sl-magic-old { position: absolute; left: 0; top: 0; pointer-events: none; }'}</style>
      <div key={cur.id} className={`sl-present__stage sl-tr-${plan ? 'none' : cur.transition === 'magic' ? 'fade' : cur.transition || 'none'} ${dir < 0 ? 'is-back' : ''}`} style={{ position: 'relative' }}>
        <SlideView slide={cur} theme={theme} scale={scale} mode="present" animStep={step} innerRef={newRef} />
        {plan && (
          <div className="sl-magic-old" ref={oldRef} aria-hidden="true">
            <SlideView slide={plan.leaving} theme={theme} scale={scale} mode="present" animStep={magic.fromStep} />
          </div>
        )}
      </div>
      {black && <div className="sl-present__black" />}
      <div className="sl-present__bar" role="toolbar" aria-label="발표 조작">
        <button type="button" onClick={prev} aria-label="이전">
          <ChevronLeft size={20} />
        </button>
        <span>
          {idx + 1} / {slides.length}
        </span>
        <button type="button" onClick={next} aria-label="다음">
          <ChevronRight size={20} />
        </button>
        <button type="button" onClick={openPresenter} aria-label="발표자 보기" title="발표자 보기(새 창)">
          <MonitorPlay size={18} />
        </button>
        <button type="button" onClick={exit} aria-label="발표 끝내기" title="발표 끝내기 (Esc)">
          <X size={18} />
        </button>
      </div>
      {presenterRoot &&
        createPortal(
          <PresenterView slides={slides} theme={theme} idx={idx} step={step} steps={steps} onGo={go} onNext={next} onPrev={prev} startedAt={startedAt} onReset={() => setStartedAt(Date.now())} win={pwin} />,
          presenterRoot
        )}
    </div>
  )
}
