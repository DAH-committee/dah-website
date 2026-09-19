// AdminLayout.jsx — 어드민 공통 골격 (13_CMS_SPEC 6절, 14_ROUTES_V2 가드)
// RequireRole(manager) 래핑 + 글래스 사이드 네비 + <Outlet />.
// J1: 콘텐츠 영역을 공용 Container 정렬로 통일 + 사이드바는 독립 스크롤
//     (sticky, 뷰포트 높이 기준 overflow-y-auto — 길어져도 콘텐츠와 따로 스크롤).
// J2: ErrorBoundary — 렌더 크래시 시 빈 화면 대신 오류 안내를 표시한다.

import { Component, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import PageBanner from '../layout/PageBanner'
import Container from '../layout/Container'
import { GhostButton, PrimaryButton } from './FormControls'
import { RequireRole, useAuth } from '../../context/AuthContext'

// 38_UI_FIX_BATCH: 그룹 순서·묶음을 공개 헤더 IA(data/nav.js)와 일치시킨다.
// About / 학사 안내 / 학과 행사 / 학생 활동 / 공지사항 / 자료실 순서와 각 그룹 하위 순서를 그대로 옮겼다.
// 권한은 항목 단위로 유지한다 — 그룹을 IA로 다시 묶으면서 예전 그룹 role을 그대로 물려주면
// 접근 범위가 바뀌므로, 각 항목이 원래 속했던 그룹의 role을 그대로 들고 간다(값 변경 0건).
// 상단 계정 영역(OWNER) 바로 아래 순서: 사용자 → 대시보드 → 전시회 설정·사이트 설정·상담(SYSTEM).
// 시스템·오너 전용(전시회 설정·사이트 설정·상담·사용자)은 IA에 없으므로 별도 그룹으로 둔다.
const NAV_GROUPS = [
  {
    label: 'OWNER',
    items: [{ to: '/admin/easter-egg/hyunho', label: '주현호 이스터에그', role: 'owner', hyunhoOnly: true }],
  },
  {
    label: 'USERS',
    items: [{ to: '/admin/users', label: '사용자', role: 'manager' }],
  },
  {
    label: 'DASHBOARD',
    items: [{ to: '/admin', label: '대시보드', end: true, role: 'manager' }],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/admin/exhibition', label: '전시회 설정', role: 'manager' },
      { to: '/admin/forms', label: '행사 설정', role: 'manager' },
      { to: '/admin/settings', label: '사이트 설정', role: 'manager' },
      { to: '/admin/storage/drive', label: '저장소 · Google Drive', role: 'manager' },
    ],
  },
  {
    label: 'ABOUT',
    items: [
      { to: '/admin/about', label: '전공 소개·연혁', role: 'manager' },
      { to: '/admin/professors', label: '교수진', role: 'manager' },
      { to: '/admin/mentors', label: '멘토', role: 'manager' },
      { to: '/admin/ci', label: 'CI', role: 'manager' },
    ],
  },
  {
    label: 'ACADEMICS',
    items: [
      { to: '/admin/curriculum', label: '교과목', role: 'manager' },
      { to: '/admin/codesharing', label: '코드쉐어링', role: 'manager' },
      { to: '/admin/nanodegree', label: '나노디그리', role: 'manager' },
    ],
  },
  {
    label: 'EVENTS',
    items: [
      { to: '/admin/posts/exhibitions', label: '프로젝트 전시회', role: 'manager' },
      { to: '/admin/posts/contest', label: '공모전', role: 'manager' },
      { to: '/admin/posts/lecture', label: '특강', role: 'manager' },
    ],
  },
  {
    label: 'STUDENT LIFE',
    items: [
      { to: '/admin/council', label: '운영위원회', role: 'manager' },
      { to: '/admin/posts/club', label: '동아리', role: 'manager' },
      { to: '/admin/posts/achievement', label: '학생 성과', role: 'manager' },
      { to: '/admin/showcase', label: '웹&앱 쇼케이스', role: 'manager' },
      { to: '/admin/careers', label: '취업 현황', role: 'manager' },
      { to: '/admin/posts/portfolios', label: '포트폴리오', role: 'manager' },
    ],
  },
  {
    label: 'NOTICES',
    items: [{ to: '/admin/posts/notice', label: '공지사항', role: 'manager' }],
  },
  {
    label: 'RESOURCES',
    items: [{ to: '/admin/posts/resource', label: '자료실', role: 'manager' }],
  },
]

const navLinkClass = ({ isActive }) =>
  `flex min-h-11 items-center rounded-md px-12 py-8 text-body-m transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
    isActive
      ? 'bg-glass-strong text-text-pri'
      : 'text-text-sec hover:bg-glass-strong hover:text-text-pri'
  }`

// J2: 어드민 렌더 크래시 안전망 — 빈 화면 금지, 오류 원인 노출
class AdminErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-start gap-16 rounded-md border border-border-subtle bg-bg-elev p-24">
          <h2 className="text-h3-m font-bold text-text-pri md:text-h3-d">
            화면 렌더 중 오류가 발생했습니다
          </h2>
          <p className="font-mono text-caption-m text-state-error">
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="cursor-pointer rounded-sm border border-border-subtle px-16 py-8 text-small-m text-text-pri transition duration-fast ease-out hover:border-border-strong"
          >
            다시 시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// 로그아웃 확인 모달 — 즉시 로그아웃 방지. LoginModal과 동일 글래스 패턴(백드롭·ESC 닫기).
// 브라우저 네이티브 다이얼로그(window.confirm) 금지. 포커스 트랩은 요구 안 함(ESC·백드롭만).
function LogoutConfirm({ onCancel, onConfirm }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.querySelector('button')?.focus()
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [onCancel])

  // U2-1: 포털로 document.body에 렌더 — AdminNav 내부 중첩 스택 컨텍스트 탈출.
  // z-[100]으로 헤더(z-50)·콘텐츠 위에 확실히 올린다.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-gutter-m">
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 bg-bg-base/70"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
        className="relative w-full max-w-sm rounded-glass border border-glass-line bg-cosmos-depth1/[0.96] p-24 backdrop-blur-glass md:p-32"
      >
        <h2 id="logout-confirm-title" className="text-h3-m font-bold text-text-pri md:text-h3-d">
          로그아웃 하시겠습니까?
        </h2>
        <div className="mt-24 flex justify-end gap-8">
          <GhostButton onClick={onCancel}>취소</GhostButton>
          <PrimaryButton onClick={onConfirm}>확인</PrimaryButton>
        </div>
      </div>
    </div>,
    document.body
  )
}

function AdminNav() {
  const { user, logout, hasRole } = useAuth()
  const [confirmOpen, setConfirmOpen] = useState(false)

  // 항목 단위 권한 필터 — 볼 수 있는 항목이 하나도 없는 그룹은 제목까지 감춘다
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasRole(item.role) && (!item.hyunhoOnly || user?.name === '주현호')),
  })).filter((group) => group.items.length > 0)

  return (
    <>
      <nav
        aria-label="관리 메뉴"
        className="flex flex-col gap-24 rounded-glass border border-glass-line bg-glass-bg p-16 backdrop-blur-glass-mobile"
      >
        <div className="flex items-center justify-between gap-8 border-b border-border-subtle pb-16">
          <span className="min-w-0">
            <span className="block truncate text-body-m font-semibold text-text-pri">
              {user?.name}
            </span>
            <span className="block font-mono text-caption-m uppercase tracking-label text-text-meta">
              {user?.role}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            aria-label="로그아웃"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-32 md:w-32"
          >
            <LogOut size={16} />
          </button>
        </div>

        {visibleGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-8">
            <p className="font-mono text-label-m uppercase tracking-label text-text-meta">
              {group.label}
            </p>
            <ul className="flex flex-wrap gap-4 lg:flex-col">
              {group.items.map((item) => (
                <li key={item.to} className="min-w-0">
                  <NavLink to={item.to} end={item.end} className={navLinkClass}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {confirmOpen && (
        <LogoutConfirm
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false)
            logout()
          }}
        />
      )}
    </>
  )
}

function AdminLayout() {
  return (
    <RequireRole role="manager">
      <PageBanner titleKo="관리" titleEn="ADMIN" nebulaX="76%" nebulaY="18%" />
      {/* J1: 공용 Container 정렬 — 공개 페이지와 좌우선 일치 */}
      <Container className="pb-section-m pt-page-start-m md:pt-page-start-d lg:grid lg:grid-cols-[240px,minmax(0,1fr)] lg:items-start lg:gap-32">
        {/* J1: 사이드바 독립 스크롤 — 뷰포트 기준 sticky + 내부 overflow */}
        <aside
          className="dah-scrollbar mb-32 rounded-md outline-none transition-shadow duration-fast focus-visible:ring-2 focus-visible:ring-border-focus lg:sticky lg:top-96 lg:mb-0 lg:max-h-[calc(100vh-theme(spacing.128))] lg:overflow-y-auto"
          tabIndex={0}
          aria-label="관리 메뉴, 위아래 화살표 키 또는 스크롤로 이동"
        >
          <AdminNav />
        </aside>
        <main className="min-w-0">
          <AdminErrorBoundary>
            <Outlet />
          </AdminErrorBoundary>
        </main>
      </Container>
    </RequireRole>
  )
}

export default AdminLayout
