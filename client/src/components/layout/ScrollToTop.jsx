import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// /en 프리픽스를 무시한 정규화 경로 — 언어 전환은 "같은 페이지"로 취급 (H4.4)
const normalize = (p) => (p === '/en' ? '/' : p.startsWith('/en/') ? p.slice(3) : p)

// ROUTES.md: pathname 변경 시 최상단 이동, hash 있으면 해당 id로 스크롤
// P5-6: 라우트 전환·새로고침·창 복귀 시 무조건 최상단에서 시작.
//   - 브라우저 자동 스크롤 복원을 끔(scrollRestoration='manual')
//   - 전역 scroll-behavior:smooth(index.css)를 무시하고 즉시 이동(behavior 'instant')
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const prevRef = useRef(pathname)

  // 새로고침·뒤로가기 시 브라우저가 이전 스크롤 위치를 복원하지 않게 함(마운트 시 1회)
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = pathname
    // 앵커(hash) 이동은 항상 처리 — 같은 페이지 내 이동 포함
    if (hash) {
      // 라우트 전환 직후에는 목적 섹션이 아직 마운트되지 않을 수 있다. 한 프레임 뒤에
      // 찾기 시작해 최대 10프레임 동안 재시도하면 /curriculum#track-* 같은 내부 링크도
      // 항상 해당 트랙으로 간다. setTimeout 대신 rAF를 써 렌더 순서와 맞춘다.
      let frame = 0
      let attempts = 0
      const moveToAnchor = () => {
        const el = document.getElementById(hash.slice(1))
        if (el) {
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
          return
        }
        attempts += 1
        if (attempts < 10) frame = window.requestAnimationFrame(moveToAnchor)
      }
      frame = window.requestAnimationFrame(moveToAnchor)
      return () => window.cancelAnimationFrame(frame)
    }
    // H4.4: KR↔EN 전환(정규화 경로 동일)은 현재 스크롤 위치 유지
    if (normalize(prev) === normalize(pathname)) return
    // H7.3: 어드민 내부 이동은 콘텐츠 영역만 갱신 — 최상단 점프 금지
    if (prev.startsWith('/admin') && pathname.startsWith('/admin')) return
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash])

  return null
}

export default ScrollToTop
