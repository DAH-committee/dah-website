import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { LoginModalProvider } from './context/LoginModalContext'
import { LangProvider } from './i18n/LangContext'
import CosmosBackground from './components/cosmos/CosmosBackground'
import { ToastProvider } from './components/common/Toast'
import VisibilityGate from './components/content/VisibilityGate'
import Analytics from './components/Analytics'
import ScrollToTop from './components/layout/ScrollToTop'
import Header from './components/layout/Header'
import Footer from './components/layout/Footer'
import LoginModal from './components/auth/LoginModal'

import Home from './pages/Home'
import About from './pages/About'
import People from './pages/People'
import Curriculum from './pages/Curriculum'
import CodeSharing from './pages/CodeSharing'
import Nanodegree from './pages/Nanodegree'
import Exhibitions from './pages/programs/Exhibitions'
import ExhibitionDetail from './pages/programs/ExhibitionDetail'
import Contests from './pages/programs/Contests'
import ContestDetail from './pages/programs/ContestDetail'
import Lectures from './pages/programs/Lectures'
import LectureDetail from './pages/programs/LectureDetail'
import Council from './pages/students/Council'
import Clubs from './pages/students/Clubs'
import ClubDetail from './pages/students/ClubDetail'
import StudentsAchievements from './pages/students/Achievements'
import StudentsCareers from './pages/students/Careers'
import Portfolios from './pages/students/Portfolios'
import ShowcaseGrid from './pages/showcase/ShowcaseGrid'
import ShowcaseDetail from './pages/showcase/ShowcaseDetail'
import ShowcaseSubmit from './pages/showcase/ShowcaseSubmit'
import ExhibitSubmit from './pages/submit/ExhibitSubmit'
import ExhibitEdit from './pages/submit/ExhibitEdit'
import FormPage from './pages/forms/FormPage'
import News from './pages/News'
import NewsDetail from './pages/NewsDetail'
import Resources from './pages/Resources'
import ResourceDetail from './pages/ResourceDetail'
import CI from './pages/CI'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import MajorCompassExperience from './pages/MajorCompassExperience'
import NotFound from './pages/NotFound'

// 어드민(Tiptap 포함)은 코드 분할 — 공개 방문자는 다운로드하지 않는다
const AdminRoutes = lazy(() => import('./pages/AdminRoutes'))

// K2-9: 페이지 전환 크로스페이드 — 정규화 경로(/en 프리픽스 제외) 키로 재마운트 →
// .page-fade(opacity 0→1, translate 금지). reduced-motion은 index.css 전역 미디어쿼리가 무효화.
// T2(29_PHASE15): 언어 토글(/about↔/en/about)은 정규화 경로가 같아 key 불변 → 재마운트·재애니메이션
//   없음. 같은 컴포넌트 인스턴스가 유지되고 useLang 텍스트만 갱신된다(등장 애니메이션 재실행 금지).
const normalizePath = (p) => (p === '/en' ? '/' : p.startsWith('/en/') ? p.slice(3) : p)

// X6(33_PHASE18) 어드민 사이드바 상태 유지 [근본원인]:
// 이 래퍼의 key가 pathname이라 어드민 내부 이동(/admin/posts/notice → /admin/settings)마다
// AdminRoutes·AdminLayout까지 통째로 재마운트됐다 → 사이드바가 새로 그려지며 내부 스크롤 위치
// 소실 + 페이드 재생("화면 초기화"). 어드민은 하나의 셸이므로 key를 '/admin'으로 고정해
// 셸(사이드바)은 유지하고 <Outlet /> 콘텐츠만 교체한다. 공개 경로는 기존 동작 유지.
const fadeKey = (p) => {
  const n = normalizePath(p)
  return n.startsWith('/admin') ? '/admin' : n
}

function PageFade({ children }) {
  const { pathname } = useLocation()
  return (
    <div key={fadeKey(pathname)} className="page-fade">
      {children}
    </div>
  )
}

// 시트·폼 편집기는 작업용 캔버스다. 공개 사이트의 헤더/푸터를 같이 렌더하면
// 100dvh 계산과 하단 탭 고정이 어긋나므로, 이 경로만 앱 크롬 밖에서 연다.
function AppChrome({ children }) {
  const { pathname } = useLocation()
  // 자료실에서 진입하지만 전공 나침반 자체는 독립 프레젠테이션 화면이다.
  // 사이트 헤더·푸터·상세 본문 틀을 겹치지 않게 해 슬라이드 구조만 남긴다.
  if (/^(?:\/en)?\/major-compass$/.test(pathname)) return children
  const workSurface = /^\/admin\/(?:exhibition-entries\/sheet|forms\/(?:new|[^/]+\/(?:edit|responses\/sheet)))$/.test(pathname)

  return (
    <>
      {!workSurface && <Header />}
      <main className="relative">
        <PageFade>{children}</PageFade>
      </main>
      {!workSurface && <Footer />}
    </>
  )
}

// 공개 콘텐츠 라우트 — ko 원본과 /en 미러 1:1 (14_ROUTES_V2).
// 접수·제출·로그인 플로우는 국문만(v2 스코프)이라 미러에서 제외.
const PUBLIC_ROUTES = [
  { path: '/', element: <Home /> },
  { path: '/about', element: <About /> },
  { path: '/about/people', element: <People /> },
  { path: '/about/ci', element: <CI /> },
  { path: '/curriculum', element: <Curriculum /> },
  { path: '/curriculum/codesharing', element: <CodeSharing /> },
  { path: '/curriculum/nanodegree', element: <Nanodegree /> },
  { path: '/programs/exhibitions', element: <Exhibitions /> },
  { path: '/programs/exhibitions/:id', element: <ExhibitionDetail /> },
  { path: '/programs/contests', element: <Contests /> },
  { path: '/programs/contests/:id', element: <ContestDetail /> },
  // 51_CONTEST_SPLIT: 회차가 곧 게시글이 되어 회차 상세 라우트는 폐지. 공유된 옛 URL이
  // 404로 죽지 않게 목록으로 돌려보낸다(회차 id가 바뀌어 개별 매핑은 불가능하다).
  { path: '/programs/contests/:id/:edition', element: <Navigate to="/programs/contests" replace /> },
  { path: '/programs/lectures', element: <Lectures /> },
  { path: '/programs/lectures/:id', element: <LectureDetail /> },
  { path: '/students/council', element: <Council /> },
  { path: '/students/clubs', element: <Clubs /> },
  { path: '/students/clubs/:id', element: <ClubDetail /> },
  { path: '/students/achievements', element: <StudentsAchievements /> },
  { path: '/students/careers', element: <StudentsCareers /> },
  { path: '/students/portfolios', element: <Portfolios /> },
  { path: '/showcase', element: <ShowcaseGrid /> },
  { path: '/showcase/:id', element: <ShowcaseDetail /> },
  { path: '/news', element: <News /> },
  { path: '/news/:id', element: <NewsDetail /> },
  { path: '/resources', element: <Resources /> },
  { path: '/major-compass', element: <MajorCompassExperience /> },
  { path: '/resources/:id', element: <ResourceDetail /> },
  { path: '/privacy', element: <Privacy /> },
  { path: '/terms', element: <Terms /> },
]

function App() {
  return (
    <BrowserRouter>
      <LangProvider>
        <AuthProvider>
          <LoginModalProvider>
          {/* G2(37_SHEET_ROADMAP): 논-시프트 토스트 — 어드민 시트 포함 전 라우트에서 useToast() 사용 */}
          <ToastProvider>
          <Analytics />
          <CosmosBackground />
          <ScrollToTop />
          <AppChrome>
            <Routes>
              {/* 38_VISIBILITY: 비공개 유형은 직접 URL로도 못 들어오게 VisibilityGate로 감싼다.
                  게이트는 제어 대상 경로만 판정하고(그 외 통과), 로그인 관리자는 예외로 통과시킨다. */}
              {PUBLIC_ROUTES.map(({ path, element }) => (
                <Route
                  key={path}
                  path={path}
                  element={<VisibilityGate>{element}</VisibilityGate>}
                />
              ))}
              {/* /en 미러 — LangContext가 프리픽스를 감지해 영문 라벨 렌더 */}
              {PUBLIC_ROUTES.map(({ path, element }) => (
                <Route
                  key={`/en${path}`}
                  path={path === '/' ? '/en' : `/en${path}`}
                  element={<VisibilityGate>{element}</VisibilityGate>}
                />
              ))}

              {/* 제출·접수 플로우 (국문만, 폼 문안 원문 보존) — 상담은 위 PUBLIC_ROUTES로 이동 */}
              <Route path="/showcase/submit" element={<ShowcaseSubmit />} />
              <Route path="/submit" element={<ExhibitSubmit />} />
              <Route path="/submit/edit" element={<ExhibitEdit />} />
              {/* 39_FORM_BUILDER P2: 자체 폼(공개). 제목·안내문·필드는 전부 DB */}
              <Route path="/forms/:slug" element={<FormPage />} />

              {/* 관리 (지연 로드, 라우트별 RequireRole은 AdminRoutes 내부) */}
              <Route
                path="/admin/*"
                element={
                  <Suspense
                    fallback={
                      <p className="px-gutter-m py-section-m font-mono text-caption-m text-text-meta">
                        로딩 중
                      </p>
                    }
                  >
                    <AdminRoutes />
                  </Suspense>
                }
              />

              {/* v1 경로 리다이렉트 (IA v2 이관) */}
              <Route path="/tracks" element={<Navigate to="/curriculum" replace />} />
              <Route path="/people" element={<Navigate to="/about/people" replace />} />
              <Route path="/achievements" element={<Navigate to="/students/achievements" replace />} />
              <Route path="/careers" element={<Navigate to="/students/careers" replace />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppChrome>
          <LoginModal />
          </ToastProvider>
          </LoginModalProvider>
        </AuthProvider>
      </LangProvider>
    </BrowserRouter>
  )
}

export default App
