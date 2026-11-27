// FloatingCta.jsx: 접수 중인 전시회와 사이트에 띄운 신청 폼을 화면 오른쪽 아래 원형 버튼으로 보여준다.
// 모바일(lg 미만)은 항상 원형 버튼을 쓴다. 데스크탑은 헤더 버튼이 맡고, 전시회 접수를 플로팅으로 둔 경우만 여기서 띄운다.
// 처음 보는 버튼은 말풍선으로 한 번만 이름을 알려준다(5초 뒤 사라지고, 본 기록은 브라우저에 남긴다).
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CalendarCheck, X } from 'lucide-react'
import Link from '../common/LangLink'

const SEEN_KEY = 'dah.fabBubble.'

function seen(key) {
  try {
    return localStorage.getItem(SEEN_KEY + key) === '1'
  } catch {
    return true
  }
}
function markSeen(key) {
  try {
    localStorage.setItem(SEEN_KEY + key, '1')
  } catch {
    /* 저장소를 못 쓰면 다음에 또 보여도 된다 */
  }
}

// lg(1024px) 이상인지. 화면 폭이 바뀌면 다시 계산한다
function useWide() {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * @param {{ items: Array<{ key: string, to: string, label: string, desktop?: boolean }> }} props
 * desktop=true인 항목만 데스크탑에서도 보인다.
 */
export default function FloatingCta({ items }) {
  const { pathname } = useLocation()
  // 지금 그 신청 화면에 있으면 같은 곳으로 가는 버튼은 숨긴다
  const wide = useWide()
  // 데스크탑에서는 desktop 항목만 보인다. 보이지 않는 버튼은 말풍선 기록도 남기지 않는다
  const list = items.filter((it) => (wide ? it.desktop : true) && !pathname.replace(/^\/en(?=\/)/, '').startsWith(it.to))
  const bubbleKey = list.find((it) => !seen(it.key))?.key ?? null
  const [bubble, setBubble] = useState(null)

  useEffect(() => {
    if (!bubbleKey) return undefined
    const show = setTimeout(() => setBubble(bubbleKey), 900)
    const hide = setTimeout(() => {
      setBubble(null)
      markSeen(bubbleKey)
    }, 900 + 5000)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [bubbleKey])

  if (!list.length) return null
  const close = (key) => {
    setBubble(null)
    markSeen(key)
  }

  return (
    <div className="pointer-events-none fixed bottom-[max(20px,env(safe-area-inset-bottom))] right-[max(20px,env(safe-area-inset-right))] z-40 flex flex-col items-end gap-12">
      {list.map((it) => (
        <div key={it.key} className="pointer-events-auto relative flex items-center">
          {bubble === it.key && (
            <div role="status" className="fab-bubble absolute right-[calc(100%+12px)] top-1/2 flex -translate-y-1/2 items-center gap-4 whitespace-nowrap rounded-md bg-bg-invert py-8 pl-16 pr-8 text-small-m font-semibold text-text-invert shadow-btn">
              <Link to={it.to} onClick={() => close(it.key)} className="leading-[1.4]">
                {it.label}
              </Link>
              <button type="button" aria-label="말풍선 닫기" onClick={() => close(it.key)} className="flex h-32 w-32 cursor-pointer items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100">
                <X size={14} aria-hidden="true" />
              </button>
              <span aria-hidden="true" className="absolute -right-[6px] top-1/2 h-12 w-12 -translate-y-1/2 rotate-45 rounded-[2px] bg-bg-invert" />
            </div>
          )}
          <Link
            to={it.to}
            aria-label={it.label}
            title={it.label}
            onClick={() => markSeen(it.key)}
            className="flex h-56 w-56 items-center justify-center rounded-full bg-button-primary text-button-primaryText shadow-btn transition duration-fast ease-out hover:bg-button-primaryHover active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <CalendarCheck size={22} aria-hidden="true" />
          </Link>
        </div>
      ))}
    </div>
  )
}
