// 문서 · 시트 · 폼 전환 토글: 헤더의 KR/EN 버튼과 같은 알약 모양, 세그먼트 3개(아이콘).
// 누구에게나 보인다(디인예 독스·시트·폼은 공개 서비스). 현재 위치의 세그먼트가 채워진다.
import { Link, useLocation } from 'react-router-dom'
import { FileText, ListChecks, Table2 } from 'lucide-react'
import './workspaceToggle.css'

const seg = 'flex h-32 w-32 items-center justify-center rounded-full transition-colors duration-fast ease-out lg:h-20 lg:w-24'
const ITEMS = [
  { id: 'docs', label: '디인예 독스', to: '/workspace/docs', Icon: FileText },
  { id: 'sheets', label: '디인예 시트', to: '/workspace/sheets', Icon: Table2 },
  { id: 'forms', label: '디인예 폼', to: '/workspace/forms', Icon: ListChecks },
]

export function currentKind(pathname) {
  if (/^\/(?:workspace\/sheets|sheets\/|admin\/exhibition-entries|admin\/forms\/[^/]+\/responses)/.test(pathname)) return 'sheets'
  if (/^\/(?:workspace\/forms|admin\/forms)/.test(pathname)) return 'forms'
  if (/^\/(?:workspace\/docs|docs\/|handover\/|workspace$)/.test(pathname)) return 'docs'
  return null
}

export default function WorkspaceToggle({ className = '', light = false }) {
  const { pathname } = useLocation()
  const cur = currentKind(pathname)
  if (light) {
    return (
      <div role="group" aria-label="디인예 독스, 시트, 폼" className={`wst-light ${className}`}>
        {ITEMS.map(({ id, label, to, Icon }) => (
          <Link key={id} to={to} title={label} aria-label={label} aria-current={cur === id ? 'page' : undefined}>
            <Icon size={17} aria-hidden="true" />
          </Link>
        ))}
      </div>
    )
  }
  return (
    <div
      role="group"
      aria-label="디인예 독스, 시트, 폼"
      className={`inline-flex min-h-11 items-center gap-4 rounded-full border border-glass-line bg-glass-bg p-4 lg:min-h-0 ${className}`}
    >
      {ITEMS.map(({ id, label, to, Icon }) => (
        <Link
          key={id}
          to={to}
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
