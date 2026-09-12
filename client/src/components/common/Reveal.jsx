import { useReveal } from '../../hooks/useReveal'

// 공용 Reveal — 초기 opacity-0 translate-y-24(24px), 발동 시 transition 해제
// reduced-motion 처리는 useReveal(즉시 revealed) + index.css 전역 transition 제거로 커버
function Reveal({ delay = 0, as: Tag = 'div', className = '', children }) {
  const { ref, revealed } = useReveal()

  return (
    <Tag
      ref={ref}
      className={`transition duration-reveal ease-out ${
        revealed ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0'
      } ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}

export default Reveal
