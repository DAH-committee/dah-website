// index.js — 어드민 라우트 → 컴포넌트 매핑 (14_ROUTES_V2 관리 라우트, BR 조립용)
// 전부 AdminLayout(자체 RequireRole manager 래핑) 하위. role은 라우트별 최소 롤 —
// manager 초과 라우트는 BR이 <RequireRole role={route.role}> 로 감싼다.
//
// 조립 예 (App.jsx, BR):
//   <Route path="/admin" element={<AdminLayout />}>
//     {ADMIN_ROUTES.map(({ path, index, Component, role }) => (
//       <Route
//         key={path || 'index'}
//         index={index}
//         path={path}
//         element={role === 'manager' ? <Component /> : (
//           <RequireRole role={role}><Component /></RequireRole>
//         )}
//       />
//     ))}
//   </Route>

import AdminLayout from '../../components/admin/AdminLayout'
import Dashboard from './Dashboard'
import PostList from './PostList'
import PostForm from './PostForm'
import ShowcaseQueue from './ShowcaseQueue'
import ProfessorsAdmin from './ProfessorsAdmin'
import MentorsAdmin from './MentorsAdmin'
import CurriculumAdmin from './CurriculumAdmin'
import CodeSharingAdmin from './CodeSharingAdmin'
import NanodegreeAdmin from './NanodegreeAdmin'
import CIAdmin from './CIAdmin'
import CouncilAdmin from './CouncilAdmin'
import CareersAdmin from './CareersAdmin'
import ExhibitionAdmin from './ExhibitionAdmin'
import EntriesSheet from './EntriesSheet'
import FormsAdmin from './FormsAdmin'
import FormEditor from './FormEditor'
import FormResponsesSheet from './FormResponsesSheet'
import SettingsAdmin from './SettingsAdmin'
import UsersAdmin from './UsersAdmin'
import AboutAdmin from './AboutAdmin'

export { AdminLayout }

/** @type {Array<{ path?: string, index?: boolean, Component: Function, role: 'manager'|'admin'|'owner' }>} */
export const ADMIN_ROUTES = [
  { index: true, Component: Dashboard, role: 'manager' },
  { path: 'posts/:type', Component: PostList, role: 'manager' },
  { path: 'posts/:type/new', Component: PostForm, role: 'manager' },
  { path: 'posts/:type/:id/edit', Component: PostForm, role: 'manager' },
  { path: 'showcase', Component: ShowcaseQueue, role: 'manager' },
  { path: 'professors', Component: ProfessorsAdmin, role: 'manager' },
  { path: 'mentors', Component: MentorsAdmin, role: 'manager' },
  { path: 'curriculum', Component: CurriculumAdmin, role: 'manager' },
  { path: 'codesharing', Component: CodeSharingAdmin, role: 'manager' },
  { path: 'nanodegree', Component: NanodegreeAdmin, role: 'manager' },
  { path: 'ci', Component: CIAdmin, role: 'manager' },
  { path: 'council', Component: CouncilAdmin, role: 'manager' },
  { path: 'careers', Component: CareersAdmin, role: 'manager' },
  { path: 'exhibition', Component: ExhibitionAdmin, role: 'manager' },
  { path: 'forms', Component: FormsAdmin, role: 'manager' },
  { path: 'settings', Component: SettingsAdmin, role: 'manager' },
  { path: 'about', Component: AboutAdmin, role: 'manager' },
  { path: 'users', Component: UsersAdmin, role: 'manager' },
]

/**
 * Y3-2(33_PHASE18): AdminLayout 밖(형제 라우트)에서 전체화면으로 여는 관리 화면.
 * 사이드바·PageBanner 없이 화면 전체를 쓰는 시트가 필요해 레이아웃 하위에 두지 않는다.
 * @type {Array<{ path: string, Component: Function, role: 'manager'|'admin'|'owner' }>}
 */
export const ADMIN_FULLSCREEN_ROUTES = [
  { path: 'exhibition-entries/sheet', Component: EntriesSheet, role: 'manager' },
  { path: 'forms/new', Component: FormEditor, role: 'manager' },
  { path: 'forms/:id/edit', Component: FormEditor, role: 'manager' },
  { path: 'forms/:id/responses/sheet', Component: FormResponsesSheet, role: 'manager' },
]
