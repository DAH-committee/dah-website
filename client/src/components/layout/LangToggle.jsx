import { Link, useLocation } from 'react-router-dom'
import { useLang } from '../../i18n/LangContext'

// 13_CMS_SPEC 5절 LangToggle — 우측 유틸 KR/EN 전환
// P5-8: 텍스트 링크 → 스위치(토글) UI. KR·EN 두 세그먼트를 나란히 노출하고 현재 언어를 채워 강조.
//   클릭 시 /en 미러 ↔ 국문 원본으로 이동. 접근성: role="switch" + aria-checked(en일 때 true).
// B4 계약: useLang() → { lang: 'ko'|'en', switchHref(pathname) }
const seg = 'flex h-32 items-center rounded-full px-8 font-mono text-label-m uppercase tracking-label transition-colors duration-fast ease-out md:text-label-d lg:h-20'

function LangToggle() {
  const { lang, switchHref } = useLang()
  const { pathname } = useLocation()
  const isEn = lang === 'en'

  return (
    <Link
      to={switchHref(pathname)}
      role="switch"
      aria-checked={isEn}
      aria-label={isEn ? '한국어로 전환' : 'Switch to English'}
      className="inline-flex min-h-11 items-center gap-4 rounded-full border border-glass-line bg-glass-bg p-4 lg:min-h-0"
    >
      <span className={`${seg} ${!isEn ? 'bg-text-pri text-bg-base' : 'text-text-meta'}`}>
        KR
      </span>
      <span className={`${seg} ${isEn ? 'bg-text-pri text-bg-base' : 'text-text-meta'}`}>
        EN
      </span>
    </Link>
  )
}

export default LangToggle
