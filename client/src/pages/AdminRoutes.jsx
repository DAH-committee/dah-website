// /admin/* 서브트리 — React.lazy 분할 로드용 래퍼 (Tiptap 포함 어드민 번들을 공개 페이지와 분리)
import { Routes, Route } from 'react-router-dom'
import { RequireRole } from '../context/AuthContext'
import { ADMIN_ROUTES, ADMIN_FULLSCREEN_ROUTES, AdminLayout } from './admin/index'

function AdminRoutes() {
  return (
    <Routes>
      {/* Y3-2(33_PHASE18): 전체화면 라우트는 AdminLayout 밖 형제로 둔다(사이드바 없는 시트) */}
      {ADMIN_FULLSCREEN_ROUTES.map(({ path, Component, role }) => (
        <Route
          key={path}
          path={path}
          element={
            <RequireRole role={role}>
              <div className="reading-scope min-h-screen bg-bg-base text-text-pri">
                <Component />
              </div>
            </RequireRole>
          }
        />
      ))}
      <Route path="/" element={<AdminLayout />}>
        {ADMIN_ROUTES.map(({ path, index, Component, role }) => (
          <Route
            key={path || 'index'}
            index={index}
            path={path}
            element={
              role === 'manager' ? (
                <Component />
              ) : (
                <RequireRole role={role}>
                  <Component />
                </RequireRole>
              )
            }
          />
        ))}
      </Route>
    </Routes>
  )
}

export default AdminRoutes
