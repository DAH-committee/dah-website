import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Link, { LangNavLink as NavLink } from '../common/LangLink'
import { CalendarCheck, ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { nav } from '../../data/nav'
import { useLang } from '../../i18n/LangContext'
import { useAuth } from '../../context/AuthContext'
import { useLoginModal } from '../../context/LoginModalContext'
import { useApi } from '../../hooks/useApi'
import useContentVisibility from '../../hooks/useContentVisibility'
import { cosmos } from '../../styles/tokens'
import Container from './Container'
import LangToggle from './LangToggle'
import logoUrl from '../../assets/logo.svg'

// 헤더 — KPC 문법. G8 IA 8메뉴, G9 fixed 포지셔닝, G14 관리 아이콘, G15 언어 전환 시프트 0.
// G9: sticky → fixed. 메가메뉴 패널은 헤더 기준 absolute top-full — 스크롤 위치와 무관하게
//     항상 헤더 바로 아래에 뜬다. 본문은 Header가 렌더하는 스페이서가 밀어낸다.
// G15: 메뉴·로그인 라벨은 KR/EN 두 라벨을 같은 칸에 겹쳐 렌더(비활성 invisible)해
//     언어 전환 시 폭이 변하지 않는다(레이아웃 시프트 0).
// 성능 규칙(11_DESIGN_V2 2절): blur 상한 3 중 헤더 1계층.
// 모바일 내비는 한 번에 한 계층만 보여주는 전용 드릴다운 메뉴다.
const SHRINK_Y = 80

// Apple 모바일 내비게이션처럼 두 개의 짧은 선이 닫기 기호로 전환되는 전용 메뉴 표식.
// 범용 햄버거 아이콘을 가져오지 않고, 현재 색과 모션 토큰만 상속한다.
function MobileMenuGlyph({ open }) {
  return (
    <span aria-hidden="true" className="relative block h-12 w-20">
      <span
        className={`absolute left-0 top-[3px] h-px w-20 bg-current transition-transform duration-base ease-out ${
          open ? 'translate-y-[3px] rotate-45' : ''
        }`}
      />
      <span
        className={`absolute bottom-[2px] left-0 h-px w-20 bg-current transition-transform duration-base ease-out ${
          open ? '-translate-y-[3px] -rotate-45' : ''
        }`}
      />
    </span>
  )
}

function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [openIndex, setOpenIndex] = useState(null) // 메가메뉴 활성 1차 메뉴 index
  const [sheetOpen, setSheetOpen] = useState(false) // 모바일 전체 메뉴
  const [openGroup, setOpenGroup] = useState(null) // 드릴다운으로 연 상위 메뉴(to)
  const sheetRef = useRef(null)
  const burgerRef = useRef(null)
  const mobileBackRef = useRef(null)
  const { lang, t } = useLang()
  // Q7: 활성 언어 라벨만 렌더 — 국문/영문 병기·숨김 span 없음(DOM 트리에도 단일)
  const navLabel = (item) => (lang === 'en' ? item.labelEn : item.label)
  const { user } = useAuth()
  const { openLogin } = useLoginModal()
  const { pathname } = useLocation()
  const headerRef = useRef(null)
  // H10: 전시회 접수 버튼 — /settings/public의 exhibition.show_button(기간 중 + 노출 허용) 판정
  const { data: pub } = useApi('/settings/public')
  const exhibitionState = pub?.exhibition
  const showSubmit = exhibitionState?.show_button === true
  const submitMode = exhibitionState?.button_mode || 'header'
  // S1(39_FORM_BUILDER): 헤더 노출을 켠 자체 폼. 서버가 공개·기간까지 판정해 내려주므로
  // 여기서는 목록 유무만 본다. 둘 이상이면 가장 최근에 수정된 하나만 띄운다.
  const { data: headerForms } = useApi('/forms')
  const formCta = headerForms?.items?.[0] ?? null

  // 스크롤 rAF 스로틀 (80px 이후 높이 72→56)
  useEffect(() => {
    let rafId = 0
    const onScroll = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        setScrolled(window.scrollY > SHRINK_Y)
        rafId = 0
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  // ESC로 메가메뉴 닫기 (키보드 접근)
  useEffect(() => {
    if (openIndex === null) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenIndex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIndex])

  // 라우트 이동 시 메가메뉴·모바일 시트 닫기
  useEffect(() => {
    setOpenIndex(null)
    setSheetOpen(false)
    setOpenGroup(null)
  }, [pathname])

  // 시트 열림: ESC 닫기 + 포커스 트랩 + body 스크롤 잠금(storage 미사용)
  useEffect(() => {
    if (!sheetOpen) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const desktopMedia = window.matchMedia('(min-width: 1024px)')
    const onDesktop = (event) => {
      if (!event.matches) return
      setSheetOpen(false)
      setOpenGroup(null)
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSheetOpen(false)
        setOpenGroup(null)
        burgerRef.current?.focus()
        return
      }
      if (e.key !== 'Tab' || !sheetRef.current) return
      // 화면 밖으로 보낸 이전 계층(inert) 안의 링크는 포커스 순회에서 제외한다.
      const sheetFocusables = Array.from(
        sheetRef.current.querySelectorAll('a[href], button:not([disabled])')
      ).filter((el) => !el.closest('[inert]'))
      const focusables = [burgerRef.current, ...sheetFocusables].filter(Boolean)
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    desktopMedia.addEventListener('change', onDesktop)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      desktopMedia.removeEventListener('change', onDesktop)
      document.body.style.overflow = prevOverflow
    }
  }, [sheetOpen])

  // 하위 화면 진입 뒤에는 뒤로 가기로, 복귀 뒤에는 첫 메뉴로 포커스를 이어준다.
  useEffect(() => {
    if (!sheetOpen) return
    window.requestAnimationFrame(() => {
      if (openGroup) mobileBackRef.current?.focus()
      else sheetRef.current?.querySelector('[data-mobile-menu-first]')?.focus()
    })
  }, [openGroup, sheetOpen])

  const close = () => setOpenIndex(null)
  const closeSheet = () => {
    setSheetOpen(false)
    setOpenGroup(null)
  }

  // 포커스가 헤더 밖으로 나가면 메가메뉴 닫기
  const onBlur = (e) => {
    if (headerRef.current && !headerRef.current.contains(e.relatedTarget)) close()
  }

  // Y3-3(33_PHASE18) 통합: visibilityKey가 붙은 하위 메뉴는 대시보드에서 해당 유형을
  // 공개로 켰을 때만 노출한다(예: 포트폴리오는 기본 비공개). 데스크탑 드롭다운과
  // 모바일 시트가 같은 목록을 쓰도록 여기서 한 번만 필터링한다.
  // 38_VISIBILITY: 공개/비공개를 헤더 전체(데스크탑 드롭다운 + 모바일 시트)에 반영한다.
  //   1) 최상위 단일 링크(공지사항·자료실)는 자기 visibilityKey로 숨긴다.
  //   2) 하위 항목은 각자의 visibilityKey로 숨긴다.
  //   3) 원래 하위가 있던 그룹인데 전부 숨겨졌으면 그룹 자체를 뺀다
  //      (그룹 대표 경로 to가 첫 하위 경로라, 놔두면 막힌 페이지로 보내게 된다).
  const { isPublic } = useContentVisibility()
  const visibleNav = nav
    .filter((item) => !item.visibilityKey || isPublic(item.visibilityKey))
    .map((item) => {
      const children = item.children.filter((child) => !child.visibilityKey || isPublic(child.visibilityKey))
      return {
        ...item,
        // 필터 후 인덱스는 원본 nav와 어긋나므로 "원래 하위가 있었는지"를 항목에 실어 나른다.
        // 대표 경로도 첫 번째 공개 하위 페이지로 맞춘다. 예: 교육과정을 끄고 코드쉐어링만
        // 켠 경우, "학사 안내"를 눌렀을 때 비공개 교육과정 URL로 가지 않게 한다.
        hadChildren: item.children.length > 0,
        to: item.children.length > 0 && children.length > 0 ? children[0].to : item.to,
        children,
      }
    })
    .filter((item) => !item.hadChildren || item.children.length > 0)
  const activeMobileGroup = visibleNav.find((item) => item.to === openGroup) ?? null

  const glassed = scrolled || openIndex !== null
  // 35_HEADER_HOVER_WHALE: 헤더 바·모바일 시트 모두 liquidGL 미적용(불변식 = 헤더는 어떤
  // 실패 모드에서도 사라지지 않는다). vendor는 타겟을 먼저 opacity:0으로 숨기고 html2canvas
  // 스냅샷이 끝난 뒤에야 되돌리는 순서라, 스냅샷이 느리거나 실패하면 통째로 안 보인다.
  // 두 표면 다 CSS 글래스(bg-glass-bg + backdrop-blur + hairline)만 쓴다 — 모바일·저성능·
  // reduced-motion 사용자가 이미 보던 표면과 동일하므로 시각 회귀도 없다.
  // liquidGL은 비핵심 표면(전시 CTA)에만 남긴다.

  return (
    <>
      {/* 35_HEADER_HOVER_WHALE: 헤더 표면은 CSS 글래스 전용(liquidGL 미적용).
          어떤 브라우저·실패 모드에서도 헤더가 사라지지 않는 것이 최우선 불변식이다. */}
      <header
        ref={headerRef}
        onMouseLeave={close}
        onBlur={onBlur}
        className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-base ease-out [will-change:backdrop-filter] ${
          glassed
            ? 'border-glass-line bg-glass-bg backdrop-blur-glass-mobile md:backdrop-blur-glass'
            : 'border-transparent bg-transparent'
        }`}
      >
      <Container
        className={`relative z-10 flex items-center justify-between transition-[height] duration-base ease-out ${
          scrolled ? 'h-header-s' : 'h-header-s lg:h-header'
        }`}
      >
        <Link
          to="/"
          onMouseEnter={close}
          className="group/logo flex min-h-11 shrink-0 items-center lg:min-h-0"
        >
          {/* 높이 28: 11_DESIGN_V2 9절 명시값. hover 시 stroke 미세 글로우 */}
          <img
            src={logoUrl}
            alt="디지털인문예술전공 홈"
            style={{ '--logo-glow': cosmos.star }}
            className="h-[28px] w-auto transition-[filter] duration-base ease-out group-hover/logo:[filter:drop-shadow(0_0_8px_var(--logo-glow))]"
          />
        </Link>

        {/* Q6: 항목 사이 고정 gap(32px)으로 균등 간격 — 글자폭이 아니라 gap 기준. 링크 px 통일 */}
        <nav aria-label={t('aria.mainMenu')} className="hidden h-full items-center gap-32 lg:flex">
          {visibleNav.map((item, i) => {
            const hasChildren = item.children.length > 0
            const isOpen = hasChildren && openIndex === i
            return (
              <div
                key={item.to}
                onMouseEnter={() => setOpenIndex(i)}
                onFocus={() => setOpenIndex(i)}
                className="relative flex h-full items-center"
              >
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  aria-expanded={hasChildren ? isOpen : undefined}
                  className={({ isActive }) =>
                    `flex h-full items-center whitespace-nowrap text-body-d transition-colors duration-fast ease-out hover:text-text-pri ${
                      isActive ? 'text-text-pri' : 'text-text-sec'
                    }`
                  }
                >
                  {navLabel(item)}
                </NavLink>
                {hasChildren && (
                  // 세로 드롭다운 — 메뉴 좌측 정렬, 위→아래 확장(grid-rows 0fr↔1fr).
                  // reduced-motion은 전역 미디어쿼리가 tailwind transition을 무효화 → 즉시 전환.
                  // absolute 요소라 부모 폭(83px)에 shrink-to-fit되므로, w-max로 콘텐츠 폭 고정 —
                  // grid 래퍼·내부 클립 래퍼 모두 w-max로 분리해야 부모 링크 폭에 안 갇힌다.
                  <div
                    className={`absolute left-0 top-full z-20 grid w-max transition-[grid-template-rows] duration-base ease-out ${
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div
                      className={`w-max overflow-hidden transition-opacity duration-fast ease-out ${
                        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
                      }`}
                    >
                      {/* 폭은 가장 긴 항목 기준(w-max) + 각 항목 nowrap → 라벨 잘림 없음 */}
                      <ul className="w-max min-w-[220px] rounded-b-md border border-glass-line bg-cosmos-depth1 py-8">
                        {item.children.map((child) => (
                          <li key={child.to}>
                            {/* 활성 언어 라벨만 한 줄로 — 국문/영문 병기 금지(언어 단일화) */}
                            <Link
                              to={child.to}
                              onClick={close}
                              className="block whitespace-nowrap px-20 py-12 text-body-d font-semibold text-text-pri transition-colors duration-fast ease-out hover:bg-glass-strong"
                            >
                              {navLabel(child)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* 36_MOBILE_HEADER: lg 미만 헤더 바는 [로고][햄버거] 2개로 고정한다.
            접수 버튼·KR/EN 토글·설정 아이콘은 전부 lg 이상에서만 렌더하고,
            모바일에서는 아래 시트 안으로 옮겼다 — 로그인·접수 노출 조합과 무관하게
            바에 들어가는 요소 수가 변하지 않으므로 겹침·넘침이 구조적으로 불가능하다. */}
        <div onMouseEnter={close} className="flex shrink-0 items-center gap-16">
          {/* H10: 접수 기간 중 헤더 접수 버튼 (button_mode=header) — 데스크탑 전용 */}
          {/* 38_UI_FIX_BATCH: CTA와 KR/EN 토글이 컨테이너 gap 16px로 붙어 보인다.
              컨테이너 gap을 키우면 나머지 유틸 쌍까지 벌어지므로 이 요소에만 우측 마진(lg:mr-8)을
              더해 그 쌍만 24px로 만든다. CTA가 hidden인 lg 미만에는 영향 없다. */}
          {showSubmit && submitMode === 'header' && (
            <Link
              to="/submit"
              className="hidden h-32 items-center gap-8 rounded-sm bg-bg-invert px-16 text-small-m font-semibold text-text-invert transition-opacity duration-fast ease-out hover:opacity-90 md:text-small-d lg:mr-8 lg:inline-flex"
            >
              <CalendarCheck size={16} aria-hidden="true" />
              {t('actions.submitExhibition')}
            </Link>
          )}
          {formCta && (
            <Link
              to={`/forms/${formCta.slug}`}
              className="hidden h-32 items-center gap-8 rounded-sm border border-border-subtle px-16 text-small-m font-semibold text-text-pri transition-colors duration-fast ease-out hover:border-border-strong md:text-small-d lg:mr-8 lg:inline-flex"
            >
              <CalendarCheck size={16} aria-hidden="true" />
              {lang === 'en' ? formCta.button_label_en : formCta.button_label_ko}
            </Link>
          )}
          {/* KR/EN 토글은 데스크탑 유틸만 — lg 미만은 시트 상단에 노출 */}
          <span className="hidden lg:block">
            <LangToggle />
          </span>
          <span aria-hidden="true" className="hidden h-16 w-px bg-border-subtle lg:block" />
          {/* G14: 로그인 상태는 관리 아이콘 버튼 하나로만 — 역할은 호버 툴팁(title). 텍스트 뱃지 금지 */}
          {user ? (
            <Link
              to="/admin"
              title={`${user.role} ${t('actions.admin')}`}
              aria-label={`${user.role} ${t('actions.admin')}`}
              /* H7.5: 아이콘 시각 여백(7px)을 상쇄해 Container 우측선에 정렬 */
              className="hidden h-32 w-32 items-center justify-center rounded-sm text-text-sec transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri lg:-mr-8 lg:flex"
            >
              <Settings size={18} aria-hidden="true" />
            </Link>
          ) : (
            // 비로그인 로그인 버튼은 데스크탑 유틸만 — lg 미만은 시트 하단에 노출
            <button
              type="button"
              onClick={openLogin}
              className="hidden cursor-pointer whitespace-nowrap text-small-m text-text-sec transition-colors duration-fast ease-out hover:text-text-pri md:text-small-d lg:block"
            >
              {t('actions.login')}
            </button>
          )}
          {/* Y1-2: 햄버거 — 우측 유틸의 마지막. lg 이상은 메가메뉴가 담당하므로 미노출 */}
          <button
            ref={burgerRef}
            type="button"
            aria-expanded={sheetOpen}
            aria-controls="dah-mobile-sheet"
            aria-label={sheetOpen ? t('aria.closeMenu') : t('aria.openMenu')}
            onClick={() => (sheetOpen ? closeSheet() : setSheetOpen(true))}
            className="-mr-8 flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri active:bg-glass-strong lg:hidden"
          >
            <MobileMenuGlyph open={sheetOpen} />
          </button>
        </div>
      </Container>

      </header>

      {/* 모바일 전체 메뉴 — 작은 아코디언 목록 대신 1차 메뉴와 2차 메뉴를 별도 화면으로 나눈다.
          한 번에 한 단계만 보여 정보 밀도를 낮추고, 뒤로 가기와 닫기를 모두 제공한다. */}
      {sheetOpen && (
        <div className="fixed inset-x-0 bottom-0 top-header-s z-40 overflow-hidden lg:hidden">
          <div
            id="dah-mobile-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('aria.mobileMenu')}
            className="mobile-menu-enter dah-scrollbar absolute inset-0 overflow-y-auto overscroll-contain border-t border-border-subtle bg-cosmos-depth0 pb-[max(24px,env(safe-area-inset-bottom))]"
          >
            <Container className="relative min-h-full py-24 md:py-32">
              <div
                inert={Boolean(activeMobileGroup)}
                className={`transition duration-base ease-out ${
                  activeMobileGroup
                    ? 'pointer-events-none absolute inset-x-gutter-m top-24 -translate-x-24 opacity-0 md:inset-x-gutter-t md:top-32'
                    : 'translate-x-0 opacity-100'
                }`}
              >
                <nav aria-label={t('aria.mobileMenu')}>
                  <ul className="flex flex-col">
                    {visibleNav.map((item, index) => {
                      const hasChildren = item.children.length > 0
                      const rowClass =
                        'group flex min-h-[56px] w-full cursor-pointer items-center justify-between gap-24 border-b border-border-subtle py-12 text-left text-h1-m font-semibold leading-tight tracking-display text-text-pri transition-colors duration-fast ease-out hover:text-purple-light active:text-purple-mid'
                      return (
                        <li key={item.to}>
                          {hasChildren ? (
                            <button
                              type="button"
                              data-mobile-menu-first={index === 0 ? 'true' : undefined}
                              onClick={() => setOpenGroup(item.to)}
                              className={rowClass}
                            >
                              <span>{navLabel(item)}</span>
                              <ChevronRight size={22} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-meta transition-transform duration-fast ease-out group-hover:translate-x-4 group-hover:text-text-pri" />
                            </button>
                          ) : (
                            <Link to={item.to} onClick={closeSheet} className={rowClass}>
                              <span>{navLabel(item)}</span>
                              <ChevronRight size={22} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-meta transition-transform duration-fast ease-out group-hover:translate-x-4 group-hover:text-text-pri" />
                            </Link>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </nav>

                <div className="mt-32 flex flex-col gap-12">
                  {showSubmit && (
                    <Link to="/submit" onClick={closeSheet} className="flex min-h-48 w-full items-center justify-center gap-8 rounded-sm bg-button-primary px-24 text-body-m font-semibold text-button-primaryText transition-colors duration-fast ease-out hover:bg-button-primaryHover active:bg-button-primaryPressed">
                      <CalendarCheck size={18} aria-hidden="true" />
                      {t('actions.submitExhibition')}
                    </Link>
                  )}
                  {formCta && (
                    <Link to={`/forms/${formCta.slug}`} onClick={closeSheet} className="flex min-h-48 w-full items-center justify-center gap-8 rounded-sm border border-border-subtle px-24 text-body-m font-semibold text-text-pri transition-colors duration-fast ease-out hover:border-border-strong active:bg-glass-strong">
                      <CalendarCheck size={18} aria-hidden="true" />
                      {lang === 'en' ? formCta.button_label_en : formCta.button_label_ko}
                    </Link>
                  )}
                </div>

                <div className="mt-32 flex min-h-11 items-center justify-between gap-16 border-t border-border-subtle pt-20">
                  <LangToggle />
                  {user ? (
                    <Link to="/admin" onClick={closeSheet} className="inline-flex min-h-11 items-center gap-8 rounded-sm px-12 text-small-m text-text-sec transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri">
                      <Settings size={18} aria-hidden="true" />
                      {t('actions.admin')}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => { closeSheet(); openLogin() }} className="min-h-11 cursor-pointer rounded-sm px-12 text-small-m text-text-sec transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri">
                      {t('actions.login')}
                    </button>
                  )}
                </div>
              </div>

              {activeMobileGroup && (
                <div className="mobile-submenu-enter">
                  <button ref={mobileBackRef} type="button" onClick={() => setOpenGroup(null)} className="-ml-12 inline-flex min-h-11 cursor-pointer items-center gap-4 rounded-sm px-12 text-small-m font-semibold text-text-sec transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri">
                    <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
                    {lang === 'en' ? 'Back' : '뒤로'}
                  </button>
                  <p className="mt-20 text-h1-m font-semibold leading-tight tracking-display text-text-pri">
                    {navLabel(activeMobileGroup)}
                  </p>
                  <nav aria-label={navLabel(activeMobileGroup)} className="mt-24">
                    <ul className="flex flex-col">
                      {activeMobileGroup.children.map((child) => (
                        <li key={child.to}>
                          <Link to={child.to} onClick={closeSheet} className="flex min-h-[52px] items-center border-b border-border-subtle py-12 text-body-l-m font-medium text-text-sec transition-colors duration-fast ease-out hover:text-text-pri active:text-purple-mid">
                            {navLabel(child)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </div>
              )}
            </Container>
          </div>
        </div>
      )}
      {/* G9: fixed 헤더가 차지하던 자리를 본문에서 확보하는 스페이서 */}
      <div aria-hidden="true" className="h-header-s lg:h-header" />
      {/* H10: 접수 버튼 플로팅 모드 (button_mode=floating) — 우하단 고정 */}
      {showSubmit && submitMode === 'floating' && (
        <Link
          to="/submit"
          className="fixed bottom-24 right-24 z-40 inline-flex h-48 items-center gap-8 rounded-sm bg-bg-invert px-24 text-body-m font-semibold text-text-invert shadow-btn transition-opacity duration-fast ease-out hover:opacity-90"
        >
          <CalendarCheck size={16} aria-hidden="true" />
          {t('actions.submitExhibition')}
        </Link>
      )}
    </>
  )
}

export default Header
