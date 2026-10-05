// 작업공간 제품 아이콘 3종: 같은 보라색, 안쪽 모양으로만 구분(문서 줄, 시트 격자, 폼 체크 막대).
// 구글 아이콘을 쓰지 않고 우리 보라(#7A3CFF)로 그린다.
export const KINDS = {
  docs: { id: 'docs', name: '디인예 독스', plural: '문서', start: '새 문서 시작', recent: '최근 문서', path: '/workspace/docs' },
  sheets: { id: 'sheets', name: '디인예 시트', plural: '스프레드시트', start: '새 스프레드시트 시작하기', recent: '최근 스프레드시트', path: '/workspace/sheets' },
  forms: { id: 'forms', name: '디인예 폼', plural: '설문지', start: '새 양식 시작하기', recent: '최근 설문지', path: '/workspace/forms' },
}

const PURPLE = '#7A3CFF'
const DEEP = '#4A12D9'

export function DocsIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={PURPLE} />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill={DEEP} />
      <rect x="13" y="18" width="14" height="2" rx="1" fill="#fff" />
      <rect x="13" y="23" width="14" height="2" rx="1" fill="#fff" />
      <rect x="13" y="28" width="9" height="2" rx="1" fill="#fff" />
    </svg>
  )
}

export function SheetsIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={PURPLE} />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill={DEEP} />
      <rect x="13" y="17" width="14" height="12" rx="1" fill="#fff" />
      <path d="M13 21h14M13 25h14M19 17v12" stroke={PURPLE} strokeWidth="1.4" />
    </svg>
  )
}

export function FormsIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={PURPLE} />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill={DEEP} />
      <circle cx="14.5" cy="19" r="1.7" fill="#fff" />
      <rect x="18" y="18" width="9" height="2" rx="1" fill="#fff" />
      <circle cx="14.5" cy="25" r="1.7" fill="#fff" />
      <rect x="18" y="24" width="9" height="2" rx="1" fill="#fff" />
      <circle cx="14.5" cy="31" r="1.7" fill="#fff" />
      <rect x="18" y="30" width="6" height="2" rx="1" fill="#fff" />
    </svg>
  )
}

export const ICONS = { docs: DocsIcon, sheets: SheetsIcon, forms: FormsIcon }
