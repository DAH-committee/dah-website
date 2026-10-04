// AnnualRender.jsx: 책의 모든 쪽을 한 화면에 세로로 그린다. 운영진이 쪽 이미지를 다시 구울 때만 쓴다(검색 노출 없음).
// 사용: /annual-report/render?z=3 에서 각 쪽(#pg-0 ...)을 요소 단위로 캡처하고, window.__arManifest를 파일로 저장한다.
import { useEffect, useMemo, useState } from 'react'
import { pages } from './AnnualPages'
import { chapters, reportMeta } from '../../data/annualContent'
import './annualPages.css'

function buildToc() {
  return chapters.map((c) => ({ ...c, page: pages.findIndex((p) => p.ch === c.id && p.tone === 'opener') }))
}

export default function AnnualRender() {
  const zoom = Number(new URLSearchParams(window.location.search).get('z')) || 1
  const toc = useMemo(buildToc, [])
  const [only, setOnly] = useState(null) // 캡처용: 한 쪽만 왼쪽 위에 보이기

  const manifest = useMemo(
    () => ({
      count: pages.length,
      chapters: toc.map(({ id, no, en, title, page }) => ({ id, no, en, title, page })),
      pages: pages.map((p, i) => ({ i, id: p.id, ch: p.ch || null, alt: p.alt || '' })),
    }),
    [toc]
  )

  useEffect(() => {
    window.__arManifest = manifest
    window.__arShow = (i) => setOnly(i)
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    // 개발용 점검: 장 표지는 왼쪽(홀수) 쪽에, 전체는 짝수 쪽수여야 한다
    pages.forEach((p, i) => {
      if (p.tone === 'opener' && i % 2 === 0) console.warn('장 표지가 오른쪽 쪽에 놓였습니다', i, p.id)
    })
    if (pages.length % 2 !== 0) console.warn('전체 쪽수가 홀수입니다', pages.length)
    // 넘침 점검: 본문이 쪽 아래 여백(736px)을 넘으면 목록으로 남긴다
    requestAnimationFrame(() => setTimeout(() => {
      const over = []
      document.querySelectorAll('.ap-sheet--paper').forEach((el) => {
        const top = el.getBoundingClientRect().top
        const z = el.getBoundingClientRect().height / 800
        let max = 0
        el.querySelectorAll('.ap-in > *').forEach((c) => { max = Math.max(max, (c.getBoundingClientRect().bottom - top) / z) })
        if (max > 738) over.push(el.id + ':' + Math.round(max))
      })
      window.__arOver = over
    }, 1500))
    return () => meta.remove()
  }, [manifest])

  return (
    <div className="ap-render" style={only === null ? { background: '#444', padding: 20, display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' } : { background: '#fff', position: 'fixed', left: 0, top: 0 }}>
      {pages.map((p, i) => {
        const tone = p.tone || 'paper'
        const side = i === 0 || i === pages.length - 1 ? 'right' : i % 2 === 1 ? 'left' : 'right'
        const chapter = chapters.find((c) => c.id === p.ch)
        const showFolio = tone === 'paper'
        return (
          <section
            key={p.id}
            id={`pg-${i}`}
            data-page={i}
            className={`ap-sheet ap-sheet--${tone} ap-sheet--${side}`}
            style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', marginRight: 600 * (zoom - 1), marginBottom: 800 * (zoom - 1), display: only === null || only === i ? 'block' : 'none' }}
          >
            <div className="ap-in">{p.render({ toc })}</div>
            {showFolio && (
              <div className="ap-folio">
                <span>{String(i).padStart(2, '0')}</span>
                <span>{chapter ? `${chapter.en} ${chapter.title}` : reportMeta.title}</span>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
