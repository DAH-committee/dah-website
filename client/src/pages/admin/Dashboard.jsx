// Dashboard.jsx — /admin 홈 (13_CMS_SPEC 6절)
// 콘텐츠 유형별 카운트 + pending 쇼케이스 큐 + 접수 현황(기간 중) + DB 백업(owner).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, FileText } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { useAuth } from '../../context/AuthContext'
import ExportButton from '../../components/admin/ExportButton'
import {
  EmptyNote,
  ErrorText,
  GhostButton,
  PageHead,
  PrimaryButton,
  Toggle,
} from '../../components/admin/FormControls'

// 유형별 카운트 대상 — 롤 미충족 유형은 조회 자체를 생략(403 방지)
const COUNT_TARGETS = [
  { type: 'notice', label: '공지사항', to: '/admin/posts/notice', role: 'manager' },
  { type: 'resource', label: '자료실', to: '/admin/posts/resource', role: 'manager' },
  { type: 'lecture', label: '특강', to: '/admin/posts/lecture', role: 'manager' },
  { type: 'contest', label: '공모전', to: '/admin/posts/contest', role: 'manager' },
  { type: 'exhibitions', label: '프로젝트 전시회', to: '/admin/posts/exhibitions', role: 'manager' },
  { type: 'achievement', label: '학생 성과', to: '/admin/posts/achievement', role: 'manager' },
  { type: 'club', label: '동아리', to: '/admin/posts/club', role: 'manager' },
  { type: 'portfolios', label: '포트폴리오', to: '/admin/posts/portfolios', role: 'manager' },
  { type: 'showcase', label: '쇼케이스', to: '/admin/showcase', role: 'manager' },
  { type: 'professors', label: '교수진', to: '/admin/professors', role: 'manager' },
  { type: 'mentors', label: '멘토', to: '/admin/mentors', role: 'manager' },
  { type: 'curriculum', label: '교과목', to: '/admin/curriculum', role: 'manager' },
  { type: 'codesharing', label: '코드쉐어링', to: '/admin/codesharing', role: 'manager' },
  { type: 'nanodegree', label: '나노디그리', to: '/admin/nanodegree', role: 'manager' },
  { type: 'ci', label: 'CI', to: '/admin/ci', role: 'manager' },
  { type: 'council', label: '운영위원회', to: '/admin/council', role: 'manager' },
  { type: 'careers', label: '취업 현황', to: '/admin/careers', role: 'manager' },
]

const PANEL =
  'rounded-glass border border-glass-line bg-glass-bg p-24 backdrop-blur-glass-mobile'

// Y3-3(33_PHASE18): 콘텐츠 유형별 공개/비공개 기본값 — 서버(settings.js DEFAULT_VISIBILITY)와 동일.
// 비공개 유형은 공개 사이트에서 해당 섹션·메뉴가 숨는다(포트폴리오는 기본 비공개).
const DEFAULT_VISIBILITY = {
  notice: true,
  resource: true,
  lecture: true,
  contest: true,
  exhibitions: true,
  achievement: true,
  club: true,
  portfolios: false,
  showcase: true,
  professors: true,
  mentors: true,
  curriculum: true,
  codesharing: true,
  nanodegree: true,
  ci: true,
  council: true,
  careers: true,
}

function Dashboard() {
  useTitle('관리 대시보드')
  const { hasRole } = useAuth()
  const targets = COUNT_TARGETS.filter((t) => hasRole(t.role))

  const [counts, setCounts] = useState({})
  const [countError, setCountError] = useState(null)

  // Y3-3: 공개/비공개 토글 (admin+만 변경 가능 — PUT /admin/settings는 admin 게이트)
  const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY)
  const [savedVisibility, setSavedVisibility] = useState(DEFAULT_VISIBILITY)
  const [visSaving, setVisSaving] = useState(false)
  const [visSaved, setVisSaved] = useState(false)
  const [visError, setVisError] = useState(null)

  // pending 쇼케이스 큐 (13_CMS 6절)
  const pending = useApi('/admin/content/showcase', {
    params: { status: 'pending', page: 1, pageSize: 5 },
  })
  // 접수 기간 상태 (/settings/public — B1 계약)
  const settings = useApi('/settings/public')
  const exhibition = settings.data?.exhibition
  const inPeriod = Boolean(exhibition?.is_submit_period || exhibition?.is_edit_period)

  // 접수 현황 건수 — 기간 중 + manager 이상만 조회(전시회는 매니저 담당 업무)
  const entries = useApi(hasRole('manager') && inPeriod ? '/admin/exhibition/entries' : null, {
    params: { page: 1, pageSize: 1 },
  })

  useEffect(() => {
    let alive = true
    setCountError(null)
    Promise.all(
      targets.map((t) =>
        api
          .get(`/admin/content/${t.type}`, { page: 1, pageSize: 1 })
          .then((r) => [t.type, r?.total ?? 0])
          .catch(() => [t.type, null])
      )
    ).then((pairs) => {
      if (!alive) return
      const next = Object.fromEntries(pairs)
      setCounts(next)
      if (pairs.every(([, v]) => v === null)) {
        setCountError('카운트를 불러오지 못했습니다. 서버 연결을 확인하세요.')
      }
    })
    return () => {
      alive = false
    }
    // targets는 롤에서만 파생 — hasRole 변경 시 재계산
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRole])

  // 설정 응답 도착 시 저장 상태를 반영. savedVisibility는 "서버에 저장된 값"으로,
  // 초안(visibility)과 비교해 변경 여부(dirty)를 판정하는 기준이 된다.
  useEffect(() => {
    const remote = settings.data?.settings?.contentVisibility
    if (remote && typeof remote === 'object') {
      const merged = { ...DEFAULT_VISIBILITY, ...remote }
      setVisibility(merged)
      setSavedVisibility(merged)
    }
  }, [settings.data])

  // 38_VISIBILITY: 토글은 초안만 바꾸고 저장하지 않는다. 아래 "저장"을 눌러야 서버에 반영된다
  // (실수로 공개 상태가 바뀌는 것을 막고, 여러 유형을 한 번에 바꿀 수 있게 한다).
  const toggleVisibility = (type, next) => {
    setVisibility((prev) => ({ ...prev, [type]: next }))
    setVisError(null)
    setVisSaved(false)
  }

  const dirtyKeys = Object.keys(visibility).filter(
    (k) => Boolean(visibility[k]) !== Boolean(savedVisibility[k])
  )
  const isDirty = dirtyKeys.length > 0

  const saveVisibility = async () => {
    if (!isDirty || visSaving) return
    setVisSaving(true)
    setVisError(null)
    setVisSaved(false)
    try {
      await api.put('/admin/settings', { settings: { contentVisibility: visibility } })
      setSavedVisibility(visibility)
      setVisSaved(true)
      settings.refetch()
    } catch (err) {
      setVisError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setVisSaving(false)
    }
  }

  const resetVisibility = () => {
    setVisibility(savedVisibility)
    setVisError(null)
    setVisSaved(false)
  }

  const approve = async (item) => {
    try {
      await api.put(`/admin/content/showcase/${item.id}`, { status: 'published' })
      pending.refetch()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <section className="flex flex-col gap-32">
      <PageHead title="대시보드" desc="콘텐츠 현황 요약" actions={<ExportButton />} />

      {/* 운영위원회 인수인계 문서: 관리자는 비밀번호 없이 바로 연다 */}
      <div>
        <p className="font-mono text-label-m uppercase tracking-label text-text-meta">HANDOVER</p>
        <Link
          to="/handover/1"
          className="mt-16 flex items-center gap-16 rounded-glass border border-glass-line bg-glass-bg p-16 backdrop-blur-glass-mobile transition duration-fast ease-out hover:bg-glass-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <span className="inline-grid h-40 w-40 shrink-0 place-items-center rounded-sm bg-[#4285f4] text-white">
            <FileText size={20} aria-hidden="true" />
          </span>
          <span className="flex flex-col gap-4">
            <span className="text-body-m font-semibold text-text-pri">운영위원회 인수인계 문서</span>
            <span className="text-caption-m text-text-meta">연간 일정, 행사별 절차, 계정, 여백 댓글 · 자료실에서는 비밀번호 열람</span>
          </span>
        </Link>
      </div>

      {/* 유형별 카운트 */}
      <div>
        <p className="font-mono text-label-m uppercase tracking-label text-text-meta">CONTENT</p>
        <ErrorText>{countError}</ErrorText>
        <ErrorText>{visError}</ErrorText>
        <ul className="mt-16 grid grid-cols-2 gap-12 md:grid-cols-3 lg:grid-cols-5">
          {targets.map((t) => (
            <li
              key={t.type}
              className="flex flex-col rounded-glass border border-glass-line bg-glass-bg backdrop-blur-glass-mobile"
            >
              <Link
                to={t.to}
                className="flex flex-col gap-8 rounded-glass p-16 transition duration-fast ease-out hover:bg-glass-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                <span className="font-mono text-caption-m text-text-meta">{t.label}</span>
                <span className="font-display text-h1-m font-bold tracking-display text-text-pri">
                  {counts[t.type] ?? '-'}
                </span>
              </Link>
              {/* Y3-3: 공개/비공개 — 끄면 공개 사이트에서 해당 섹션·메뉴가 숨는다 */}
              {hasRole('admin') && (
                <div className="flex items-center justify-between gap-8 border-t border-border-subtle px-16 py-12">
                  <span className="font-mono text-caption-m text-text-meta">
                    {visibility[t.type] ? '공개' : '비공개'}
                  </span>
                  <Toggle
                    checked={Boolean(visibility[t.type])}
                    onChange={(v) => toggleVisibility(t.type, v)}
                    label={`${t.label} 공개 여부`}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>

        {/* 38_VISIBILITY: 토글은 초안이고, 저장을 눌러야 공개 사이트에 반영된다.
            변경이 있을 때만 활성화하고 결과를 문구로 알린다. */}
        {hasRole('admin') && (
          <div className="mt-16 flex flex-wrap items-center gap-16">
            <PrimaryButton type="button" onClick={saveVisibility} disabled={!isDirty || visSaving}>
              {visSaving ? '저장 중' : '저장'}
            </PrimaryButton>
            {isDirty && !visSaving && (
              <>
                <GhostButton onClick={resetVisibility}>되돌리기</GhostButton>
                <span className="font-mono text-caption-m text-text-meta">
                  변경 {dirtyKeys.length}건 — 저장해야 공개 사이트에 반영됩니다
                </span>
              </>
            )}
            {!isDirty && visSaved && (
              <span className="font-mono text-caption-m text-text-meta">저장했습니다</span>
            )}
          </div>
        )}
      </div>

      {/* pending 쇼케이스 큐 */}
      <div className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-16">
          <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">쇼케이스 승인 대기</h3>
          <Link
            to="/admin/showcase"
            className="font-mono text-caption-m text-text-sec underline underline-offset-4 transition duration-fast ease-out hover:text-text-pri"
          >
            큐 전체 보기
          </Link>
        </div>
        {pending.error && <ErrorText>{pending.error.message}</ErrorText>}
        {pending.loading && (
          <p className="mt-16 font-mono text-caption-m text-text-meta">불러오는 중</p>
        )}
        {!pending.loading && !(pending.data?.items || []).length && (
          <EmptyNote>대기 중인 제출물이 없습니다</EmptyNote>
        )}
        {(pending.data?.items || []).length > 0 && (
          <ul className="mt-16 flex flex-col">
            {(pending.data?.items || []).map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 items-center gap-12 border-b border-border-subtle py-12 first:border-t"
              >
                {item.main_img && (
                  <img
                    src={item.main_img}
                    alt=""
                    loading="lazy"
                    className="h-48 w-48 shrink-0 rounded-md border border-border-subtle bg-bg-elev object-cover"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-m text-text-pri">{item.title}</span>
                  <span className="block truncate font-mono text-caption-m text-text-meta">
                    {item.creator}
                    {item.topic ? ` · ${item.topic}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => approve(item)}
                  className="inline-flex cursor-pointer items-center gap-8 rounded-sm border border-glass-line bg-glass-bg px-12 py-4 font-mono text-caption-m text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  <Check size={16} aria-hidden="true" />
                  승인
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 접수 현황 — 기간 중에만 노출 (13_CMS 6절) */}
      {inPeriod && (
        <div className={PANEL}>
          <div className="flex flex-wrap items-center justify-between gap-16">
            <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">전시회 접수 현황</h3>
            {hasRole('manager') && (
              <Link
                to="/admin/exhibition"
                className="font-mono text-caption-m text-text-sec underline underline-offset-4 transition duration-fast ease-out hover:text-text-pri"
              >
                접수 목록 보기
              </Link>
            )}
          </div>
          <dl className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3">
            <div>
              <dt className="font-mono text-caption-m text-text-meta">접수 상태</dt>
              <dd className="mt-4 text-body-m text-text-pri">
                {exhibition?.is_submit_period ? '접수 기간' : '수정 기간'}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-caption-m text-text-meta">마감</dt>
              <dd className="mt-4 font-mono text-body-m text-text-pri">
                {String(
                  exhibition?.is_submit_period ? exhibition?.submit_close : exhibition?.edit_close
                ).slice(0, 10)}
              </dd>
            </div>
            {hasRole('manager') && (
              <div>
                <dt className="font-mono text-caption-m text-text-meta">누적 접수</dt>
                <dd className="mt-4 font-mono text-body-m text-text-pri">
                  {entries.data?.total ?? '-'}건
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </section>
  )
}

export default Dashboard
