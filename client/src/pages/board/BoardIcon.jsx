// DAH Board 제품 아이콘: 다른 작업공간 아이콘과 같은 보라 문서 모양에 안쪽은 이어진 점 세 개.
const PURPLE = '#7A3CFF'
const DEEP = '#4A12D9'

export default function BoardIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={PURPLE} />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill={DEEP} />
      <path d="M15 21l10-1M15 21l7 9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="11.5" y="18" width="6" height="6" rx="1.5" fill="#fff" />
      <circle cx="25.5" cy="20" r="3" fill="#fff" />
      <rect x="19.5" y="27.5" width="6" height="5" rx="2.5" fill="#fff" />
    </svg>
  )
}
