// AnnualReport.jsx: 2026 디지털 애뉴얼 리포트 책 화면. 미리 구운 쪽 이미지를 StPageFlip 캔버스로 넘긴다.
// 텍스트는 이미지에 들어 있으므로 접근성 대체 문구는 목차 패널과 쪽 목록(sr-only)으로 제공한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageFlip } from 'page-flip'
import { manifest } from './annualManifest'
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
    const node = document.createElement('div')
    node.style.cssText = 'width:100%;height:100%'
    host.appendChild(node)
    const flip = new PageFlip(node, {
      width: dims.pw,
      height: dims.ph,
      size: 'fixed',
      minWidth: 120,
      maxShadowOpacity: 0.45,
      showCover: true,
      usePortrait: true,
      mobileScrollSupport: false,
      drawShadow: true,
      flippingTime: 820,
      swipeDistance: 24,
      clickEventForward: false,
      autoSize: false,
      startPage: curRef.current,
    })
    flipRef.current = flip
    flip.loadFromImages(Array.from({ length: total }, (_, i) => src(i)))
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
    f.flip(n)
  }, [total])
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

      <main className="ar-stage" ref={stageRef}>
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
          <li key={i}>{a}</li>
        ))}
      </ol>
    </div>
  )
}
