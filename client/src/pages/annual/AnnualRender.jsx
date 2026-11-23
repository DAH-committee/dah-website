// AnnualRender.jsx: 책의 모든 쪽을 한 화면에 세로로 그린다. 운영진이 쪽 이미지를 다시 구울 때만 쓴다(검색 노출 없음).
// 사용: /annual-report/render?z=3 에서 각 쪽(#pg-0 ...)을 요소 단위로 캡처하고, window.__arManifest를 파일로 저장한다.
import { useEffect, useMemo, useState } from 'react'
import { pages } from './AnnualPages'
import { chapters, reportMeta, pageLinks } from '../../data/annualContent'
import snap from './siteSnapshot.json'
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
    // 누르면 이동하는 영역 모으기: 굽기 직전에 한 번 호출해 쪽별 {x,y,w,h(쪽 너비와 높이에 대한 비율), href 또는 goto}를 돌려준다
    window.__arLinks = () => {
      const exId = Object.fromEntries(snap.exhibitions.map((e) => [e.semester_label, e.id]))
      const chPage = Object.fromEntries(toc.map((c) => [c.id, c.page]))
      const out = {}
      document.querySelectorAll('.ap-sheet').forEach((sh) => {
        const i = Number(sh.dataset.page)
        const pid = sh.dataset.pid
        if (sh.classList.contains('ap-sheet--cover') || pid === 'back') return
        const b = sh.getBoundingClientRect()
        const list = []
        const pageUrl = (pageLinks.find(([re]) => re.test(pid)) || [])[1]
        const add = (el, link, label) => {
          const r = el.getBoundingClientRect()
          if (r.width < 4 || r.height < 4) return
          const pad = 3 * (b.width / 600)
          const x = Math.max(0, r.left - b.left - pad) / b.width
          const y = Math.max(0, r.top - b.top - pad) / b.height
          const w = Math.min(b.width, r.width + pad * 2) / b.width
          const h = Math.min(b.height, r.height + pad * 2) / b.height
          list.push({ x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4), ...link, label: (label || '').replace(/\s+/g, ' ').trim().slice(0, 40) })
        }
        // 항목별 링크(먼저 놓아야 쪽 제목보다 위에 온다)
        if (pid === 'toc') sh.querySelectorAll('.ap-toc li[data-goto]').forEach((el) => add(el, { goto: Number(el.dataset.goto) }, el.innerText))
        if (pid === 'ex-archive') sh.querySelectorAll('.ap-cell').forEach((el) => { const k = el.querySelector('figcaption')?.innerText.trim(); if (exId[k]) add(el, { href: `/programs/exhibitions/${exId[k]}` }, `전시회 ${k}`) })
        if (/^fac-/.test(pid)) sh.querySelectorAll('.ap-roster article, .ap-prof').forEach((el) => add(el, { href: '/about/people' }, el.innerText))
        if (/^ex-award/.test(pid)) sh.querySelectorAll('.ap-aw, .ap-awone').forEach((el) => add(el, { href: 'https://26-1-dah-exhibition.vercel.app/' }, el.querySelector('h3')?.innerText))
        if (/^ct-/.test(pid) && pageUrl) sh.querySelectorAll('.ap-aw, .ap-awone').forEach((el) => add(el, { href: pageUrl }, el.querySelector('h3')?.innerText))
        if (pid === 'clubs') sh.querySelectorAll('.ap-clubs > *').forEach((el, k) => add(el, { href: `/students/clubs/${25 + k}` }, el.innerText))
        if (/^ach-/.test(pid)) sh.querySelectorAll('.ap-ach li').forEach((el) => add(el, { href: '/students/achievements' }, el.querySelector('strong')?.innerText))
        // 쪽 제목
        const title = sh.querySelector('.ap-title')
        if (title && pageUrl) add(title, pageUrl.startsWith('http') || pageUrl.startsWith('/') ? { href: pageUrl } : {}, title.innerText)
        // 쪽 아래: 장 이름은 그 장 첫 쪽으로, 쪽수는 목차로
        sh.querySelectorAll('.ap-folio [data-goto]').forEach((el) => add(el, { goto: 2 }, '목차'))
        sh.querySelectorAll('.ap-folio [data-goto-ch]').forEach((el) => add(el, { goto: chPage[el.dataset.gotoCh] }, el.innerText))
        if (list.length) out[i] = list
      })
      return out
    }
    // 쪽 크기 맞춤: 내용이 쪽의 절반 정도만 차는 글 쪽은 글자와 간격을 함께 키워 쪽 높이를 채운다(굽기 전에 한 번 호출)
    window.__arFit = (cap = 1.3, minGain = 1.08) => {
      const out = []
      document.querySelectorAll('.ap-sheet--paper').forEach((el) => {
        const inn = el.querySelector('.ap-in')
        if (!inn) return
        const kids = Array.from(inn.children).filter((c) => getComputedStyle(c).position !== 'absolute')
        kids.forEach((c) => { c.style.zoom = '' })
        inn.style.gap = ''
        const base = el.getBoundingClientRect()
        const z = base.height / 800
        const bottom = () => kids.reduce((m, c) => Math.max(m, (c.getBoundingClientRect().bottom - base.top) / z), 0)
        const wide = () => kids.some((c) => c.scrollWidth > c.clientWidth + 1 || Array.from(c.querySelectorAll('table,img')).some((t) => t.getBoundingClientRect().right > base.right - 20 * z))
        const h = bottom() - 44
        if (h <= 0) return
        let sc = Math.min(cap, Math.floor((696 / h) * 50) / 50)
        if (sc < minGain) return
        const apply = (v) => { kids.forEach((c) => { c.style.zoom = String(v) }); inn.style.gap = `${Math.round(16 * v)}px` }
        apply(sc)
        while (sc > 1 && (bottom() > 740 || wide())) { sc = Math.round((sc - 0.04) * 100) / 100; apply(sc) }
        if (sc <= 1) { kids.forEach((c) => { c.style.zoom = '' }); inn.style.gap = ''; return }
        out.push(el.id + ':' + sc)
      })
      window.__arFitted = out
      return out
    }
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
    <div className="ap-render" style={only === null ? { background: '#444', padding: 20, display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' } : { background: '#fff', position: 'absolute', left: 0, top: 0 }}>
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
            data-pid={p.id}
            className={`ap-sheet ap-sheet--${tone} ap-sheet--${side}`}
            style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', marginRight: 600 * (zoom - 1), marginBottom: 800 * (zoom - 1), display: only === null || only === i ? 'block' : 'none' }}
          >
            <div className="ap-in">{p.render({ toc })}</div>
            {showFolio && (
              <div className="ap-folio">
                <span data-goto="2">{String(i).padStart(2, '0')}</span>
                <span data-goto-ch={chapter ? chapter.id : undefined}>{chapter ? `${chapter.en} ${chapter.title}` : reportMeta.title}</span>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
