// AnnualReport.jsx: 2026 디지털 애뉴얼 리포트 책 화면. 미리 구운 쪽 이미지를 StPageFlip 캔버스로 넘긴다.
// 텍스트는 이미지에 들어 있으므로 접근성 대체 문구는 목차 패널과 쪽 목록(sr-only)으로 제공한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageFlip } from 'page-flip'
import { manifest } from './annualManifest'
import links from './annualLinks.json'
import './annualReport.css'

const RATIO = 4 / 3 // 높이 / 너비
const src = (i) => `/images/annual-2026/pages/p-${String(i).padStart(2, '0')}.webp`

export default function AnnualReport() {
  const stageRef = useRef(null)
  const bookRef = useRef(null)
  const flipRef = useRef(null)
  const [cur, setCur] = useState(0)
  const [ready, setReady] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [loaded, setLoaded] = useState(0)
  const total = manifest.count

  useEffect(() => {
    document.title = '2026 디지털 애뉴얼 리포트 | 디지털인문예술전공'
  }, [])

  // 책 크기: 화면 안에 들어가는 가장 큰 쪽
  const measure = useCallback(() => {
    const el = stageRef.current
    if (!el) return null
    const w = el.clientWidth
    const h = el.clientHeight
    const single = w < 720
    const pad = single ? 8 : 24
    let pw = single ? w - pad * 2 : (w - pad * 2) / 2
    let ph = pw * RATIO
    if (ph > h - pad * 2) {
      ph = h - pad * 2
      pw = ph / RATIO
    }
    return { pw: Math.floor(pw), ph: Math.floor(ph), single }
  }, [])

  const [dims, setDims] = useState(null)
  const curRef = useRef(0)
  curRef.current = cur

  useEffect(() => {
    setDims(measure())
    let t
    const on = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const m = measure()
        setDims((d) => (d && m && d.pw === m.pw && d.ph === m.ph ? d : m))
      }, 200)
    }
    window.addEventListener('resize', on)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', on)
    }
  }, [measure])

  // 이미지 미리 받기: 앞쪽부터 여섯 줄로 받아 넘김이 끊기지 않게 한다
  useEffect(() => {
    let alive = true
    let done = 0
    const load = (i) => {
      if (!alive || i >= total) return
      const im = new Image()
      im.decoding = 'async'
      im.onload = im.onerror = () => {
        done += 1
        setLoaded(done)
        load(i + 6)
      }
      im.src = src(i)
    }
    for (let k = 0; k < 6; k += 1) load(k)
    return () => {
      alive = false
    }
  }, [total])

  useEffect(() => {
    if (!dims || !bookRef.current) return undefined
    const host = bookRef.current
    // StPageFlip 캔버스는 CSS 픽셀 해상도라 레티나에서 흐려진다. 배율(k)만큼 크게 그리고 CSS로 줄여 선명하게 한다.
    const k = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)))
    const sw = stageRef.current.clientWidth
    const sh = stageRef.current.clientHeight
    const node = document.createElement('div')
    node.style.cssText = `width:${sw * k}px;height:${sh * k}px;transform:scale(${1 / k});transform-origin:0 0;position:absolute;left:0;top:0`
    host.appendChild(node)
    const flip = new PageFlip(node, {
      width: dims.pw * k,
      height: dims.ph * k,
      size: 'fixed',
      minWidth: 120,
      maxShadowOpacity: 0.45,
      showCover: true,
      usePortrait: true,
      mobileScrollSupport: false,
      drawShadow: true,
      flippingTime: 820,
      swipeDistance: 24 * k,
      clickEventForward: false,
      disableFlipByClick: true, // 쪽을 누르면 쪽 안 링크로 가고, 모서리 끌기와 화살표로 넘긴다
      autoSize: false,
      startPage: curRef.current,
    })
    flipRef.current = flip
    flip.loadFromImages(Array.from({ length: total }, (_, i) => src(i)))
    try {
      // 흰 바탕 칠하기를 지우기로 바꿔 책 바깥은 사이트 배경이 보이게 한다
      flip.render.clear = function clearTransparent() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      }
      // 축소한 캔버스의 포인터 좌표를 원래 배율로 되돌린다
      flip.ui.getMousePos = (x, y) => {
        const r = node.getBoundingClientRect()
        return { x: (x - r.left) * k, y: (y - r.top) * k }
      }
    } catch {
      /* 내부 구조가 바뀐 경우 기본 동작 유지 */
    }
    flip.on('flip', (e) => setCur(e.data))
    setReady(true)
    return () => {
      try {
        flip.destroy()
      } catch {
        /* 이미 해제됨 */
      }
      flipRef.current = null
      node.remove()
    }
  }, [dims, total])

  const go = useCallback((i) => {
    const f = flipRef.current
    if (!f) return
    const n = Math.max(0, Math.min(total - 1, i))
    // 목차, 링크, 슬라이더 이동은 넘김 애니메이션 없이 바로 해당 쪽을 펼친다
    f.turnToPage(n)
    setCur(n)
  }, [total])
  // 쪽 안 링크: 누른 자리가 링크 영역이면 이동하고, 아니면 누른 쪽 방향으로 한 쪽 넘긴다
  const hit = useCallback((clientX, clientY) => {
    const f = flipRef.current
    const stage = bookRef.current
    if (!f || !stage || !dims) return null
    const k = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)))
    const node = stage.firstChild
    const r = node.getBoundingClientRect()
    const x = (clientX - r.left) * k
    const y = (clientY - r.top) * k
    const b = f.getBoundsRect()
    const idx = f.getCurrentPageIndex()
    const lastIdx = total - 1
    let left
    let right
    if (dims.single) {
      left = idx
      right = null
    } else if (idx === 0) {
      left = null
      right = 0
    } else {
      left = idx % 2 === 1 ? idx : idx - 1
      right = left + 1 <= lastIdx ? left + 1 : null
    }
    const pageW = b.pageWidth
    const spreadLeft = b.left
    const place = (pi, px) => {
      const fx = (x - px) / pageW
      const fy = (y - b.top) / b.height
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
      return { page: pi, fx, fy }
    }
    let at = null
    if (dims.single) at = place(left, b.left)
    else {
      if (left !== null) at = place(left, spreadLeft)
      if (!at && right !== null) at = place(right, spreadLeft + pageW)
    }
    return at
  }, [dims, total])

  const linkAt = useCallback((at) => {
    if (!at) return null
    const list = links[String(at.page)] || []
    // 항목 링크(작은 영역)를 쪽 제목보다 먼저 찾는다: 면적이 작은 것 우선
    return list
      .filter((l) => at.fx >= l.x && at.fx <= l.x + l.w && at.fy >= l.y && at.fy <= l.y + l.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0] || null
  }, [])

  const downRef = useRef(null)
  const onStageDown = (e) => {
    downRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }
  const onStageMove = (e) => {
    const el = stageRef.current
    if (!el) return
    el.style.cursor = linkAt(hit(e.clientX, e.clientY)) ? 'pointer' : ''
  }
  const onStageUp = (e) => {
    const d = downRef.current
    downRef.current = null
    if (!d) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || Date.now() - d.t > 600) return // 끌기는 넘김
    if (e.target.closest?.('.ar-arrow')) return
    const at = hit(e.clientX, e.clientY)
    const l = linkAt(at)
    if (l) {
      if (typeof l.goto === 'number') go(l.goto)
      else if (l.href) {
        if (l.href.startsWith('http')) window.open(l.href, '_blank', 'noopener,noreferrer')
        else window.open(l.href, '_blank', 'noopener')
      }
    }
  }

  // 링크 위에서 누르면 쪽 넘김 라이브러리(모서리 클릭 넘김)가 반응하지 않게 이벤트를 먼저 가로챈다
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const guard = (e) => {
      const pt = e.changedTouches ? e.changedTouches[0] : e
      if (e.target.closest?.('.ar-arrow')) return
      if (linkAt(hit(pt.clientX, pt.clientY))) e.stopPropagation()
    }
    const types = ['mousedown', 'mouseup', 'touchstart', 'touchend']
    types.forEach((t) => el.addEventListener(t, guard, true))
    return () => types.forEach((t) => el.removeEventListener(t, guard, true))
  }, [hit, linkAt])

  const prev = useCallback(() => flipRef.current?.flipPrev('bottom'), [])
  const next = useCallback(() => flipRef.current?.flipNext('bottom'), [])

  useEffect(() => {
    const on = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') next()
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(total - 1)
      else if (e.key === 'Escape') setTocOpen(false)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [next, prev, go, total])

  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const chapter = useMemo(() => {
    let c = null
    manifest.chapters.forEach((x) => {
      if (cur >= x.page) c = x
    })
    return c
  }, [cur])

  const label = cur === 0 ? '표지' : cur >= total - 1 ? '뒤표지' : `${cur} / ${total - 2}`
  const pct = Math.round(((cur + 1) / total) * 100)

  return (
    <div className="ar-root" data-full={full || undefined}>
      <header className="ar-bar">
        <a className="ar-bar__brand" href="/" aria-label="전공 웹사이트로 돌아가기">
          <span>DAH</span>
          <b>2026 Digital Annual Report</b>
        </a>
        <div className="ar-bar__right">
          <span className="ar-bar__chap">{chapter ? `${chapter.no} ${chapter.title}` : ''}</span>
          <button type="button" className="ar-btn" onClick={() => setTocOpen((v) => !v)} aria-expanded={tocOpen}>
            목차
          </button>
          <button type="button" className="ar-btn" onClick={toggleFull} aria-pressed={full}>
            {full ? '전체 화면 끄기' : '전체 화면'}
          </button>
        </div>
      </header>

      <main className="ar-stage" ref={stageRef} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp}>
        <div className="ar-book" ref={bookRef} />
        {!ready && <p className="ar-loading">불러오는 중</p>}
        <button type="button" className="ar-arrow ar-arrow--l" onClick={prev} aria-label="이전 쪽" disabled={cur === 0}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button type="button" className="ar-arrow ar-arrow--r" onClick={next} aria-label="다음 쪽" disabled={cur >= total - 1}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </main>

      <footer className="ar-foot">
        <span className="ar-foot__label">{label}</span>
        <input
          className="ar-range"
          type="range"
          min={0}
          max={total - 1}
          value={cur}
          onChange={(e) => go(Number(e.target.value))}
          aria-label="쪽 이동"
          style={{ '--p': `${pct}%` }}
        />
        <span className="ar-foot__hint">{loaded < total ? `이미지 ${loaded}/${total}` : '← → 키로 넘기기'}</span>
      </footer>

      {tocOpen && (
        <div className="ar-toc" role="dialog" aria-label="목차">
          <button type="button" className="ar-toc__scrim" onClick={() => setTocOpen(false)} aria-label="목차 닫기" />
          <nav className="ar-toc__panel">
            <h2>목차</h2>
            <ol>
              <li>
                <button type="button" onClick={() => { go(0); setTocOpen(false) }}><span>00</span>표지</button>
              </li>
              <li>
                <button type="button" onClick={() => { go(1); setTocOpen(false) }}><span>00</span>발간사</button>
              </li>
              {manifest.chapters.map((c) => (
                <li key={c.id} data-on={chapter?.id === c.id || undefined}>
                  <button type="button" onClick={() => { go(c.page); setTocOpen(false) }}>
                    <span>{c.no}</span>
                    <b>{c.title}</b>
                    <i>{c.page}</i>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      )}

      <ol className="sr-only">
        {manifest.alts.map((a, i) => (
          <li key={i}>
            {a}
            {(links[String(i)] || [])
              .filter((l) => l.href)
              .map((l, k) => (
                <a key={k} href={l.href}>
                  {l.label || l.href}
                </a>
              ))}
          </li>
        ))}
      </ol>
    </div>
  )
}
