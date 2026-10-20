// 문서 · 시트 · 폼 · 보드 · 슬라이드 · 한글 전환 토글: 알약 모양, 세그먼트 6개(아이콘).
// 순서는 기존 4종 뒤에 새 제품을 붙인다(자리 이동으로 손에 익은 위치가 바뀌지 않게).
// 워크스페이스 홈 상단에서 쓴다. 현재 위치의 세그먼트가 채워진다. 팀 공간(?team=)을 보고 있으면 같은 팀 공간으로 옮긴다.
import { Link, useLocation } from 'react-router-dom'
import { FileText, FileType, ListChecks, Presentation, StickyNote, Table2 } from 'lucide-react'
import './workspaceToggle.css'

const seg = 'flex h-32 w-32 items-center justify-center rounded-full transition-colors duration-fast ease-out lg:h-20 lg:w-24'
const ITEMS = [
  { id: 'docs', label: 'DAH Docs', to: '/workspace/docs', Icon: FileText },
  { id: 'sheets', label: 'DAH Sheet', to: '/workspace/sheets', Icon: Table2 },
  { id: 'forms', label: 'DAH Form', to: '/workspace/forms', Icon: ListChecks },
  { id: 'boards', label: 'DAH Board', to: '/workspace/boards', Icon: StickyNote },
  { id: 'slides', label: 'DAH Slides', to: '/workspace/slides', Icon: Presentation },
  { id: 'hwp', label: 'DAH 한글', to: '/workspace/hwp', Icon: FileType },
]

export function currentKind(pathname) {
  if (/^\/(?:workspace\/sheets|sheets\/|admin\/exhibition-entries|admin\/forms\/[^/]+\/responses)/.test(pathname)) return 'sheets'
  if (/^\/(?:workspace\/forms|admin\/forms)/.test(pathname)) return 'forms'
  if (/^\/(?:workspace\/boards|boards\/)/.test(pathname)) return 'boards'
  if (/^\/(?:workspace\/slides|slides\/)/.test(pathname)) return 'slides'
  if (/^\/(?:workspace\/hwp|hwp\/)/.test(pathname)) return 'hwp'
  if (/^\/(?:workspace\/docs|docs\/|handover\/|workspace$)/.test(pathname)) return 'docs'
  return null
}

export default function WorkspaceToggle({ className = '', light = false }) {
  const { pathname, search } = useLocation()
  const cur = currentKind(pathname)
  const team = /^\/workspace\//.test(pathname) ? new URLSearchParams(search).get('team') : null
  const hrefOf = (to) => (team ? `${to}?team=${encodeURIComponent(team)}` : to)
  if (light) {
    return (
      <div role="group" aria-label="DAH Docs, Sheet, Form, Board, Slides, 한글" className={`wst-light ${className}`}>
        {ITEMS.map(({ id, label, to, Icon }) => (
          <Link key={id} to={hrefOf(to)} title={label} aria-label={label} aria-current={cur === id ? 'page' : undefined}>
            <Icon size={17} aria-hidden="true" />
          </Link>
        ))}
      </div>
    )
  }
  return (
    <div
      role="group"
      aria-label="DAH Docs, Sheet, Form, Board, Slides, 한글"
      className={`inline-flex min-h-11 items-center gap-4 rounded-full border border-glass-line bg-glass-bg p-4 lg:min-h-0 ${className}`}
    >
      {ITEMS.map(({ id, label, to, Icon }) => (
        <Link
          key={id}
          to={hrefOf(to)}
          title={label}
          aria-label={label}
          aria-current={cur === id ? 'page' : undefined}
          className={`${seg} ${cur === id ? 'bg-text-pri text-bg-base' : 'text-text-meta hover:text-text-pri'}`}
        >
          <Icon size={14} aria-hidden="true" />
        </Link>
      ))}
    </div>
  )
}
