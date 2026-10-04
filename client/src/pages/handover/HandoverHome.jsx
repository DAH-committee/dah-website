// /resources/handover: 자료실 안 운영위원회 인수인계 문서 입구.
// 관리자 로그인(manager 이상): 바로 문서 목록. 비로그인: 열람 비밀번호 입력 후 목록(7일 유지).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Lock, LockOpen, MessageSquareText, Plus } from 'lucide-react'
import PageBanner from '../../components/layout/PageBanner'
import Container from '../../components/layout/Container'
import { api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { useAuth } from '../../context/AuthContext'

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export default function HandoverHome() {
  useTitle('운영위원회 인수인계 문서')
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [state, setState] = useState({ loading: true })
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/handover/docs')
      setState({ loading: false, access: r.access, items: r.items })
    } catch (e) {
      setState({ loading: false, access: null, error: e.status === 401 ? null : e.message })
    }
  }, [])

  useEffect(() => {
    if (!authLoading) load()
  }, [authLoading, user, load])

  async function unlock(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await api.post('/handover/unlock', { password: pw })
      setPw('')
      await load()
    } catch (e2) {
      setErr(e2.status === 429 ? '시도 횟수 초과. 15분 후 다시 시도' : '비밀번호 불일치')
    } finally {
      setBusy(false)
    }
  }

  async function lock() {
    await api.post('/handover/lock')
    load()
  }

  async function newDoc() {
    const r = await api.post('/handover/docs', { title: '제목 없는 문서' })
    navigate(`/handover/${r.item.id}`)
  }

  return (
    <>
      <PageBanner
        titleKo="운영위원회 인수인계 문서"
        titleEn="HANDOVER"
        breadcrumb={[
          { label: '홈', to: '/' },
          { label: '자료실', to: '/resources' },
          { label: '인수인계 문서', to: '/resources/handover' },
        ]}
        nebulaX="70%"
        nebulaY="30%"
      />
      <Container as="section" className="py-section-m lg:py-section-d">
        {state.loading ? (
          <p className="text-body-m text-text-meta">확인 중</p>
        ) : !state.access ? (
          <form onSubmit={unlock} className="mx-auto flex w-full max-w-[420px] flex-col gap-16 rounded-glass border border-glass-line bg-glass-bg p-32 backdrop-blur-glass-mobile">
            <span className="inline-grid h-48 w-48 place-items-center rounded-full border border-glass-line text-text-pri">
              <Lock size={20} aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-8">
              <h2 className="text-h3-m font-bold text-text-pri md:text-h3-d">비밀번호 입력</h2>
              <p className="text-body-m text-text-sec">운영위원회 내부 문서. 관리자 로그인 상태에서는 비밀번호 없이 열람</p>
            </div>
            <label className="flex flex-col gap-8">
              <span className="sr-only">열람 비밀번호</span>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="off"
                placeholder="열람 비밀번호"
                className="h-48 rounded-sm border border-border-subtle bg-transparent px-16 text-body-m text-text-pri outline-none placeholder:text-text-meta focus:border-border-strong"
                autoFocus
              />
            </label>
            {err && <p role="alert" className="text-caption-m text-[#f28b82]">{err}</p>}
            <button
              type="submit"
              disabled={busy || !pw}
              className="h-48 rounded-sm bg-[rgb(var(--dah-purple-primary))] px-24 text-body-m font-semibold text-white transition duration-fast disabled:opacity-40"
            >
              {busy ? '확인 중' : '열기'}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-16">
            <div className="flex flex-wrap items-center justify-between gap-12">
              <p className="text-body-m text-text-sec">
                {state.access === 'member' ? `${user?.name} 님, 관리자 열람·편집 가능` : '비밀번호 열람 중: 읽기 전용, 7일 유지'}
              </p>
              <div className="flex gap-8">
                {state.access === 'member' && (
                  <button type="button" onClick={newDoc} className="inline-flex h-40 items-center gap-8 rounded-sm border border-border-subtle px-16 text-body-m text-text-pri hover:border-border-strong">
                    <Plus size={16} /> 새 문서
                  </button>
                )}
                {state.access === 'gate' && (
                  <button type="button" onClick={lock} className="inline-flex h-40 items-center gap-8 rounded-sm border border-border-subtle px-16 text-body-m text-text-pri hover:border-border-strong">
                    <LockOpen size={16} /> 잠그기
                  </button>
                )}
              </div>
            </div>
            <ul className="flex flex-col border-t border-glass-line">
              {state.items.map((d) => (
                <li key={d.id} className="border-b border-glass-line">
                  <Link to={`/handover/${d.id}`} className="group flex items-center gap-16 px-8 py-16 transition hover:bg-glass-bg">
                    <span className="inline-grid h-40 w-40 shrink-0 place-items-center rounded-sm bg-[#7A3CFF] text-white">
                      <FileText size={20} aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      <span className="truncate text-body-m font-semibold text-text-pri md:text-body-d">{d.title}</span>
                      <span className="text-caption-m text-text-meta">
                        {fmt(d.updated_at)} 수정{d.updated_by ? ` · ${d.updated_by}` : ''}
                      </span>
                    </span>
                    {d.open_comments > 0 && (
                      <span className="inline-flex items-center gap-4 text-caption-m text-text-sec">
                        <MessageSquareText size={14} aria-hidden="true" /> {d.open_comments}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Container>
    </>
  )
}
