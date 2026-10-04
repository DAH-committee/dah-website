import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageFlip } from 'page-flip'
import { ChevronLeft, ChevronRight, ListTree, Maximize2, Minimize2, X } from 'lucide-react'
import Link from '../../components/common/LangLink'
import { chapters, reportMeta } from '../../data/annualReport2026'
import { pages as rawPages } from './AnnualPages'
import './annual.css'

const PAGE_RATIO = 4 / 3 // 높이 / 폭

// 책은 표지와 뒷표지가 홀로 서므로 전체 쪽수가 짝수여야 한다.
function buildPages() {
  const list = [...rawPages]
  if (list.length % 2 === 1) {
    list.splice(list.length - 1, 0, { id: 'blank', render: () => null })
  }
  return list
}

function buildToc(list) {
  return chapters.map((c) => {
    const page = list.findIndex((p) => p.chapter === c.id && p.tone === 'chapter')
    return { ...c, page }
  })
}

function pageMarkup(list, toc) {
  return list
    .map((p, i) => {
      const side = i === 0 ? 'cover' : i === list.length - 1 ? 'cover' : i % 2 === 1 ? 'left' : 'right'
      const tone = p.tone || (p.bleed ? 'bleed' : 'paper')
      const chapter = chapters.find((c) => c.id === p.chapter)
      const body = renderToStaticMarkup(<div className="ar-page__in">{p.render({ toc })}</div>)
      const folio =
        tone === 'paper' || tone === 'bleed'
          ? `<div class="ar-folio"><span>${String(i).padStart(2, '0')}</span><span>${chapter ? chapter.title : reportMeta.title}</span></div>`
          : ''
      return `<div class="ar-sheet" data-density="${p.density || 'soft'}"><div class="ar-page ar-page--${tone} ar-page--${side === 'cover' ? 'right' : side}" data-page="${i}">${body}${folio}</div></div>`
    })
    .join('')
}

export default function AnnualReport() {
  const stageRef = useRef(null)
  const areaRef = useRef(null)
  const hostRef = useRef(null)
  const flipRef = useRef(null)
  const [index, setIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const [menu, setMenu] = useState(false)
  const [full, setFull] = useState(false)

  const list = useMemo(buildPages, [])
  const toc = useMemo(() => buildToc(list), [list])
  const html = useMemo(() => pageMarkup(list, toc), [list, toc])

  // 화면 크기에 맞춰 책 크기 계산: 가로 화면은 두 쪽 펼침, 좁으면 한 쪽
  const fit = useCallback(() => {
    const area = areaRef.current
    const host = hostRef.current
    if (!area || !host) return
    const w = area.clientWidth
    const h = area.clientHeight
    // 두 쪽 펼침이 640px보다 좁아지면 한 쪽 보기로 바꾼다(PageFlip의 minWidth 320 x 2와 같은 기준)
    const spreadW = Math.min(w, (2 * h) / PAGE_RATIO)
    const portrait = spreadW < 640
    const pageW = portrait ? Math.min(w, h / PAGE_RATIO) : spreadW / 2
    const bookW = Math.floor(pageW * (portrait ? 1 : 2))
    const bookH = Math.floor(pageW * PAGE_RATIO)
    host.style.width = `${bookW}px`
    host.style.height = `${bookH}px`
    flipRef.current?.update()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = document.createElement('div')
    el.innerHTML = html
    host.appendChild(el)
    fit()
    const pf = new PageFlip(el, {
      width: 420,
      height: 560,
      size: 'stretch',
      minWidth: 320,
      maxWidth: 4000,
      minHeight: 260,
      maxHeight: 5400,
      showCover: true,
      usePortrait: true,
      drawShadow: true,
      maxShadowOpacity: 0.55,
      flippingTime: reduce ? 1 : 950,
      mobileScrollSupport: false,
      swipeDistance: 24,
      clickEventForward: true,
      showPageCorners: true,
      disableFlipByClick: false,
      autoSize: true,
      startPage: 0,
    })
    pf.loadFromHTML(el.querySelectorAll('.ar-sheet'))
    // 넘기기 전에 모든 쪽의 이미지를 미리 해독해 두어 펼칠 때 빈 칸이 보이지 않게 한다
    el.querySelectorAll('img').forEach((img) => img.decode?.().catch(() => {}))
    flipRef.current = pf
    if (import.meta.env.DEV) window.__arFlip = pf
    setTotal(pf.getPageCount())
    pf.on('flip', (e) => setIndex(e.data))
    const ro = new ResizeObserver(fit)
    ro.observe(areaRef.current)
    return () => {
      ro.disconnect()
      try {
        pf.destroy()
      } catch {
        /* 이미 정리됨 */
      }
      flipRef.current = null
      host.replaceChildren()
    }
  }, [html, fit])

  const go = useCallback((n) => {
    const pf = flipRef.current
    if (!pf) return
    const max = pf.getPageCount() - 1
    const target = Math.max(0, Math.min(max, n))
    pf.flip(target)
    setMenu(false)
  }, [])

  // 목차 링크
  useEffect(() => {
    const host = hostRef.current
    const onClick = (e) => {
      const a = e.target.closest?.('[data-goto]')
      if (!a) return
      e.preventDefault()
      go(Number(a.getAttribute('data-goto')))
    }
    host?.addEventListener('click', onClick)
    return () => host?.removeEventListener('click', onClick)
  }, [go])

  // 키보드
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') flipRef.current?.flipNext()
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') flipRef.current?.flipPrev()
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(9999)
      else if (e.key === 'Escape') setMenu(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  useEffect(() => {
    const onFs = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    const prev = document.title
    document.title = `${reportMeta.title} | ${reportMeta.org}`
    return () => {
      document.title = prev
    }
  }, [])

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else stageRef.current?.requestFullscreen?.()
  }

  const current = list[index]
  const currentChapter = chapters.find((c) => c.id === current?.chapter)
  const btn =
    'inline-flex h-11 w-11 items-center justify-center rounded-md border border-border-subtle bg-bg-panel text-text-pri transition-colors duration-fast ease-out hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:text-text-disabled'

  return (
    <div ref={stageRef} className="ar-stage flex h-dvh min-h-0 flex-col bg-bg-base text-text-pri">
      <header className="flex items-center justify-between gap-16 px-16 py-12 md:px-24">
        <div className="min-w-0">
          <p className="truncate font-mono text-caption-m text-text-meta">{reportMeta.org}</p>
          <h1 className="truncate text-small-m font-semibold text-text-pri md:text-small-d">{reportMeta.title}</h1>
        </div>
        <div className="flex items-center gap-8">
          <button type="button" className={btn} onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label="목차 열기">
            <ListTree size={18} aria-hidden="true" />
          </button>
          <button type="button" className={btn} onClick={toggleFull} aria-label={full ? '전체 화면 끝내기' : '전체 화면'}>
            {full ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
          </button>
          <Link to="/" className={btn} aria-label="사이트로 돌아가기">
            <X size={18} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center px-8 pb-8 md:px-24">
        <div ref={hostRef} className="ar-book-host" />
        {menu && (
          <div className="absolute right-16 top-0 z-20 w-[min(320px,calc(100%-32px))] rounded-md border border-border-subtle bg-bg-panel p-8 shadow-glass md:right-24">
            <ul className="m-0 list-none p-0">
              <li>
                <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-sm px-12 text-left text-small-m text-text-sec hover:bg-glass-strong hover:text-text-pri" onClick={() => go(0)}>
                  <span>표지</span>
                  <span className="font-mono text-caption-m text-text-meta">00</span>
                </button>
              </li>
              {toc.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-12 rounded-sm px-12 text-left text-small-m text-text-sec hover:bg-glass-strong hover:text-text-pri" onClick={() => go(c.page)}>
                    <span className="min-w-0 truncate">
                      <span className="mr-8 font-mono text-caption-m text-text-meta">{c.no}</span>
                      {c.title}
                    </span>
                    <span className="font-mono text-caption-m text-text-meta">{String(c.page).padStart(2, '0')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-center gap-16 px-16 pb-16 md:pb-20">
        <button type="button" className={btn} onClick={() => flipRef.current?.flipPrev()} disabled={index <= 0} aria-label="이전 쪽">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <p className="min-w-[160px] text-center font-mono text-caption-m text-text-meta" aria-live="polite">
          {currentChapter ? `${currentChapter.no} ${currentChapter.title}` : reportMeta.council}
          <span className="ml-12 text-text-sec">
            {String(index).padStart(2, '0')} / {String(Math.max(total - 1, 0)).padStart(2, '0')}
          </span>
        </p>
        <button type="button" className={btn} onClick={() => flipRef.current?.flipNext()} disabled={total > 0 && index >= total - 1} aria-label="다음 쪽">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </footer>
    </div>
  )
}
