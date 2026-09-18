// HyunhoEasterEggAdmin.jsx — 주현호 owner 전용 이스터에그 발견 기록
// 공개 참가자의 연락처를 다루므로 이 화면은 서버와 클라이언트 모두 이름=주현호 owner로 제한한다.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, useApi } from '../../hooks/useApi'
import { useAuth } from '../../context/AuthContext'
import { useTitle } from '../../hooks/useTitle'
import { EmptyNote, ErrorText, GhostButton, PageHead, PrimaryButton } from '../../components/admin/FormControls'

function HyunhoEasterEggAdmin() {
  useTitle('주현호 이스터에그')
  const { user } = useAuth()
  const { data, loading, error, refetch } = useApi('/admin/easter-eggs/hyunho')
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [message, setMessage] = useState(null)

  if (user?.role !== 'owner' || user?.name !== '주현호') {
    return (
      <section className="flex flex-col gap-16">
        <PageHead title="이스터에그 기록" />
        <ErrorText>이 화면은 주현호 오너 계정에서만 볼 수 있습니다.</ErrorText>
        <Link to="/admin" className="text-body-m text-link underline underline-offset-4">대시보드로 돌아가기</Link>
      </section>
    )
  }

  const items = data?.items ?? []
  const limit = data?.limit ?? 3
  const reset = async () => {
    setResetting(true)
    setMessage(null)
    try {
      const response = await api.del('/admin/easter-eggs/hyunho/discoveries')
      setMessage(`${response.deleted}건을 초기화했습니다. 이제 다시 3명까지 참여할 수 있습니다.`)
      setConfirming(false)
      refetch()
    } catch (err) {
      setMessage(err.message)
    } finally {
      setResetting(false)
    }
  }

  return (
    <section className="flex flex-col gap-32">
      <PageHead
        title="주현호 이스터에그"
        desc={`발견자 ${items.length} / ${limit}명 · 개인정보는 이 화면에서만 열람할 수 있습니다.`}
        actions={<PrimaryButton onClick={() => setConfirming(true)} disabled={items.length === 0}>초기화</PrimaryButton>}
      />
      {message && <p role="status" className="text-small-m text-text-sec">{message}</p>}
      {error && <ErrorText>{error.message}</ErrorText>}
      {loading ? (
        <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>
      ) : items.length === 0 ? (
        <EmptyNote>아직 발견 기록이 없습니다. 공개 화면에서 주현호 이름을 빠르게 3회 클릭하면 참여 창이 열립니다.</EmptyNote>
      ) : (
        <ol className="grid gap-12 md:grid-cols-3">
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-col gap-12 rounded-glass border border-glass-line bg-glass-bg p-20">
              <p className="font-mono text-label-m uppercase tracking-label text-purple-primary">DISCOVERY {index + 1}</p>
              <dl className="flex flex-col gap-8 text-body-m">
                <div><dt className="font-mono text-caption-m text-text-meta">이름</dt><dd className="text-text-pri">{item.name}</dd></div>
                <div><dt className="font-mono text-caption-m text-text-meta">학번</dt><dd className="text-text-pri">{item.student_no}</dd></div>
                <div><dt className="font-mono text-caption-m text-text-meta">전화번호</dt><dd className="text-text-pri">{item.phone}</dd></div>
                <div><dt className="font-mono text-caption-m text-text-meta">발견 시각</dt><dd className="text-text-sec">{new Date(item.created_at).toLocaleString('ko-KR')}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      )}
      {confirming && (
        <div className="rounded-glass border border-state-error/50 bg-bg-elev p-24">
          <h3 className="text-h3-m font-bold text-text-pri">발견 기록을 초기화할까요?</h3>
          <p className="mt-8 text-body-m leading-relaxed text-text-sec">현재 기록이 모두 삭제되고, 공개 화면에서 다시 3명까지 참여할 수 있습니다.</p>
          <div className="mt-20 flex flex-wrap justify-end gap-8">
            <GhostButton disabled={resetting} onClick={() => setConfirming(false)}>취소</GhostButton>
            <PrimaryButton disabled={resetting} onClick={reset}>{resetting ? '초기화 중' : '모두 초기화'}</PrimaryButton>
          </div>
        </div>
      )}
      <Link to="/students/council" className="inline-flex w-fit items-center gap-8 text-small-m text-link underline underline-offset-4">
        운영위원회 공개 화면 열기
      </Link>
    </section>
  )
}

export default HyunhoEasterEggAdmin
