// ConsultationsAdmin.jsx — 상담 신청 목록 (Phase 9 K1-9, admin+)
// GET /admin/consultations + PUT /admin/consultations/:id/read (읽음 토글). 미읽음 강조.

import { useState } from 'react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import {
  EmptyNote,
  ErrorText,
  GhostButton,
  PageHead,
  Pagination,
} from '../../components/admin/FormControls'
import { alertDialog } from '../../components/common/AppDialog'

const PAGE_SIZE = 20

function ConsultationsAdmin() {
  useTitle('상담 신청 관리')
  const [page, setPage] = useState(1)
  const { data, loading, error, offline, refetch } = useApi('/admin/consultations', {
    params: { page, pageSize: PAGE_SIZE },
  })
  const items = data?.items || []
  const [busyId, setBusyId] = useState(null)

  const toggleRead = async (item) => {
    setBusyId(item.id)
    try {
      await api.put(`/admin/consultations/${item.id}/read`)
      refetch()
    } catch (err) {
      await alertDialog({ title: '오류', message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title="상담 신청"
        desc="접수된 상담 신청 목록입니다. 미읽음 항목이 강조됩니다."
        offline={offline}
      />

      {error && <ErrorText>{error.message}</ErrorText>}
      {loading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
      {!loading && !items.length && <EmptyNote>접수된 상담 신청이 없습니다</EmptyNote>}

      {items.length > 0 && (
        <ul className="flex flex-col gap-16">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex flex-col gap-12 rounded-md border p-24 ${
                item.is_read
                  ? 'border-border-subtle opacity-60'
                  : 'border-border-strong bg-bg-elev'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-8">
                <div className="flex min-w-0 flex-wrap items-center gap-12">
                  {!item.is_read && (
                    <span className="rounded-sm border border-border-strong px-8 py-4 font-mono text-label-m uppercase tracking-label text-text-pri">
                      미읽음
                    </span>
                  )}
                  <span className="text-body-m font-semibold text-text-pri md:text-body-d">
                    {item.name}
                  </span>
                  {/* S3-1: 회사명 대신 학년·전공 표시 */}
                  {[item.grade, item.main_major, item.double_major]
                    .filter(Boolean)
                    .map((v, i) => (
                      <span key={i} className="text-body-m text-text-sec md:text-body-d">
                        {v}
                      </span>
                    ))}
                </div>
                <span className="font-mono text-caption-m text-text-meta">
                  {String(item.created_at).slice(0, 16).replace('T', ' ')}
                </span>
              </div>
              {/* H2-5(37_SHEET_ROADMAP) 통합: 이메일이 필수 수집 항목이 되어 연락처와 함께 노출 */}
              <p className="font-mono text-small-m text-text-sec">
                {[item.contact, item.email].filter(Boolean).join(' · ')}
              </p>
              {item.message && (
                <p className="whitespace-pre-wrap text-body-m leading-relaxed text-text-sec">
                  {item.message}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-8">
                <span className="font-mono text-caption-m text-text-meta">
                  개인정보 수집·이용 동의: {item.agreed ? '동의함' : '동의 안 함'}
                </span>
                <GhostButton onClick={() => toggleRead(item)} disabled={busyId === item.id}>
                  {item.is_read ? '미읽음으로 변경' : '읽음 처리'}
                </GhostButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={data?.page || page}
        pageSize={PAGE_SIZE}
        total={data?.total || 0}
        onPage={setPage}
      />
    </section>
  )
}

export default ConsultationsAdmin
