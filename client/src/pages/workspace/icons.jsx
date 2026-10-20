// 워크스페이스 제품 아이콘 6종: 같은 보라색, 안쪽 모양으로만 구분(문서 줄, 시트 격자, 폼 체크 막대, 보드 메모와 연결선, 슬라이드 가로 판, 한글 ㅎ).
// 구글 아이콘을 쓰지 않고 우리 보라(#7A3CFF)로 그린다.
export const KINDS = {
  docs: { id: 'docs', name: 'DAH Docs', plural: '문서', start: '새 문서 시작', recent: '최근 문서', path: '/workspace/docs' },
  sheets: { id: 'sheets', name: 'DAH Sheet', plural: '스프레드시트', start: '새 스프레드시트 시작하기', recent: '최근 스프레드시트', path: '/workspace/sheets' },
  forms: { id: 'forms', name: 'DAH Form', plural: '설문지', start: '새 양식 시작하기', recent: '최근 설문지', path: '/workspace/forms' },
  boards: { id: 'boards', name: 'DAH Board', plural: '보드', start: '새 보드 시작하기', recent: '최근 보드', path: '/workspace/boards' },
  slides: { id: 'slides', name: 'DAH Slides', plural: '프레젠테이션', start: '새 프레젠테이션 시작하기', recent: '최근 프레젠테이션', path: '/workspace/slides' },
  hwp: { id: 'hwp', name: 'DAH 한글', plural: '한글 문서', start: '새 한글 문서 시작하기', recent: '최근 한글 문서', path: '/workspace/hwp' },
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

// 보드: 둥근 사각 판 위에 메모 두 장과 연결선(문서 3종과 달리 접힌 모서리 없이 넓은 판)
export function BoardsIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="4" y="6" width="32" height="28" rx="4" fill={PURPLE} />
      <rect x="4" y="6" width="32" height="5" rx="2.5" fill={DEEP} />
      <rect x="4" y="8.5" width="32" height="2.5" fill={DEEP} />
      <rect x="9" y="15" width="10" height="8" rx="1.5" fill="#fff" />
      <rect x="22" y="22" width="9" height="7" rx="1.5" fill="#fff" />
      <path d="M19 19h3.5a2 2 0 0 1 2 2v1" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// 슬라이드: 16:9 가로 판 위에 제목 줄, 본문 줄, 도형 하나
export function SlidesIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="4" y="8" width="32" height="24" rx="3" fill={PURPLE} />
      <path d="M33 32h-8l11-11v8a3 3 0 0 1-3 3z" fill={DEEP} />
      <rect x="9" y="13" width="13" height="3" rx="1.5" fill="#fff" />
      <rect x="9" y="19" width="17" height="2" rx="1" fill="#fff" />
      <rect x="9" y="24" width="11" height="2" rx="1" fill="#fff" />
      <circle cx="28.5" cy="15.5" r="2.5" fill="#fff" />
    </svg>
  )
}

// 한글: 문서 3종과 같은 접힌 모서리 쪽에 ㅎ 모양(짧은 가로획, 긴 가로획, 동그라미)
export function HwpIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4h14l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={PURPLE} />
      <path d="M24 4v6a2 2 0 0 0 2 2h6z" fill={DEEP} />
      <rect x="17.5" y="15.5" width="5" height="2" rx="1" fill="#fff" />
      <rect x="12.5" y="20" width="15" height="2" rx="1" fill="#fff" />
      <circle cx="20" cy="28.2" r="3.2" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  )
}

export const ICONS = { docs: DocsIcon, sheets: SheetsIcon, forms: FormsIcon, boards: BoardsIcon, slides: SlidesIcon, hwp: HwpIcon }

// ws_files.kind(doc, sheet, form, board, slide) -> 제품 아이콘, 허브 경로
export const ICON_BY_FILE_KIND = { doc: DocsIcon, sheet: SheetsIcon, form: FormsIcon, board: BoardsIcon, slide: SlidesIcon, hwp: HwpIcon }
export const HOME_BY_FILE_KIND = { doc: '/workspace/docs', sheet: '/workspace/sheets', form: '/workspace/forms', board: '/workspace/boards', slide: '/workspace/slides', hwp: '/workspace/hwp' }
