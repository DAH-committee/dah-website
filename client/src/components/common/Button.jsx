import Link from './LangLink'
import { ArrowUpRight } from 'lucide-react'

// COMPONENTS.md §1 Button — primary: bg invert / secondary: 글래스 톤(v2 스킨, 11_DESIGN_V2 5절)
// radius 6, 높이 모바일 44(h-11) 데스크탑 48, px 24. external이면 ArrowUpRight 16
// 성능 규칙: 버튼 표면은 blur 미사용(backdrop-filter 상한 3 보존) — glass bg·border 톤만
const base =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm px-24 text-body-m font-semibold transition duration-fast ease-out md:h-48 md:text-body-d'

// X2(33_PHASE18) 버튼 3위계 — 전 버튼은 이 셋 중 하나만 쓴다.
// Primary: 보라 채움 + 상단 화이트 하이라이트(inset) + 퍼플 글로우 → hover 시 글로우 강화, pressed 감광
// Secondary: 유리 패널 + hairline → hover 시 보더 보라
// Ghost: 연보라 텍스트 → hover 시 유리 배경
// 그림자는 tokens.shadow(btn/btn-hover) 경유. 포커스 링은 index.css 전역(#A286E9).
const variants = {
  primary:
    'bg-button-primary text-button-primaryText shadow-btn hover:bg-button-primaryHover hover:shadow-btn-hover active:bg-button-primaryPressed active:shadow-btn',
  secondary:
    'border border-glass-line bg-glass-bg text-text-pri shadow-glass hover:border-border-purple hover:bg-glass-strong active:opacity-90',
  ghost:
    'text-button-ghostText hover:bg-button-ghostHover active:opacity-90',
}

// arrow: external 링크의 ArrowUpRight 표시 여부(P5 기본 true).
// 라벨 자체가 목적지를 말하는 버튼(전시 사이트 등)에서만 false로 끈다.
function Button({ variant = 'primary', href, external = false, arrow = true, children, ...rest }) {
  const className = `${base} ${variants[variant] || variants.primary}`

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        {...rest}
      >
        {children}
        {arrow && <ArrowUpRight size={16} />}
      </a>
    )
  }

  if (href) {
    return (
    <Link to={href} className={className}>
      {children}
    </Link>
    )
  }

  return <button type="button" className={className} {...rest}>{children}</button>
}

export default Button
