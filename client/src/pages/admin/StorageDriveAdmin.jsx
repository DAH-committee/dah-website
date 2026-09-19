// StorageDriveAdmin.jsx — 관리 → 저장소 → Google Drive (53_DRIVE_STORAGE)
//
// 다음 운영진이 설명 없이도 할 일을 끝낼 수 있어야 한다는 것이 이 화면의 기준이다.
//   1) 내 Google 계정 연결  2) 루트 폴더 지정  3) 연결 점검  4) 테스트 파일 업로드
// 토큰은 화면에 오지 않는다. 서버가 암호화해 보관하고, 여기서는 연결 상태만 본다.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FolderPlus,
  HardDrive,
  Link2,
  RefreshCw,
  Trash2,
  Unplug,
  UploadCloud,
} from 'lucide-react'
import { api, useApi } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import { useAuth } from '../../context/AuthContext'
import {
  EmptyNote,
  ErrorText,
  Field,
  GhostButton,
  Input,
  PageHead,
  PrimaryButton,
} from '../../components/admin/FormControls'
import GoogleDriveIcon from '../../components/common/GoogleDriveIcon'

const CARD = 'flex min-w-0 flex-col gap-16 rounded-md border border-border-subtle bg-bg-panel p-24'
const ROW = 'flex flex-wrap items-baseline gap-8 text-body-m text-text-sec md:text-body-d'
const KEY = 'font-mono text-caption-m uppercase tracking-label text-text-meta'

const CONNECT_ERROR = {
  consent_cancelled: 'Google 동의 화면에서 취소되었습니다. 다시 시도하세요.',
  invalid_state: '연결 요청이 만료되었습니다. 처음부터 다시 시도하세요.',
  missing_code: 'Google이 인증 코드를 보내지 않았습니다. 다시 시도하세요.',
  token_exchange_failed: 'Google 토큰 교환이 실패했습니다. 클라이언트 ID·시크릿과 리디렉션 URI를 확인하세요.',
  no_refresh_token:
    '이 계정은 이미 이 앱을 승인해 새 토큰이 발급되지 않았습니다. Google 계정 → 보안 → 서드파티 액세스에서 접근 권한을 삭제한 뒤 다시 연결하세요.',
}

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatBytes(bytes) {
  const n = Number(bytes || 0)
  if (!n) return '0B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)}${units[i]}`
}

function StatusPill({ ok, children }) {
  const tone = ok === null || ok === undefined
    ? 'border-border-subtle text-text-meta'
    : ok
      ? 'border-state-success text-state-success'
      : 'border-state-error text-state-error'
  return (
    <span className={`inline-flex items-center gap-4 rounded-sm border px-12 py-4 font-mono text-caption-m ${tone}`}>
      {children}
    </span>
  )
}

/** 연결 카드 1장 — 계정·권한·루트 폴더·점검 결과와 버튼 */
function ConnectionCard({ connection, isOwner, onChanged, onMessage }) {
  const [busy, setBusy] = useState('')
  const [rootInput, setRootInput] = useState(connection.root_folder_id || '')
  const [newFolderName, setNewFolderName] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [forms, setForms] = useState(null)
  const [checkResult, setCheckResult] = useState(null)

  useEffect(() => {
    setRootInput(connection.root_folder_id || '')
  }, [connection.root_folder_id])

  const run = async (key, fn) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy('')
    }
  }

  const check = () =>
    run('check', async () => {
      const res = await api.post(`/admin/drive/connections/${connection.id}/check`, {})
      setCheckResult(res)
      onChanged()
    })

  const saveRoot = () =>
    run('root', async () => {
      await api.put(`/admin/drive/connections/${connection.id}`, { root_folder_id: rootInput })
      onMessage('루트 폴더를 저장했습니다.')
      onChanged()
    })

  const previewFolder = () =>
    run('preview', async () => {
      const res = await api.post(`/admin/drive/connections/${connection.id}/root-folder`, {
        name: newFolderName,
        dry_run: true,
      })
      setPreview(res.preview || [])
    })

  const createFolder = () =>
    run('create', async () => {
      const res = await api.post(`/admin/drive/connections/${connection.id}/root-folder`, {
        name: newFolderName,
      })
      setPreview(null)
      setNewFolderName('')
      onMessage(`루트 폴더 "${res.root?.name || newFolderName}"를 만들고 이 연결에 지정했습니다.`)
      onChanged()
    })

  const testUpload = () =>
    run('test', async () => {
      const res = await api.post('/admin/drive/test-upload', { connection_id: connection.id })
      onMessage(
        `테스트 파일을 올렸습니다: ${res.file?.name} (${res.folder_name} 폴더). 자동 삭제하지 않습니다.`
      )
    })

  const loadForms = () =>
    run('forms', async () => {
      const res = await api.get(`/admin/drive/connections/${connection.id}/forms`)
      setForms(res.items || [])
    })

  const disconnect = () =>
    run('disconnect', async () => {
      if (!window.confirm('이 연결을 해제하면 저장된 토큰이 폐기됩니다. Drive 안의 파일은 삭제되지 않습니다. 계속할까요?')) return
      await api.del(`/admin/drive/connections/${connection.id}`)
      onMessage('연결을 해제했습니다. Drive 파일은 그대로 있습니다.')
      onChanged()
    })

  const toggleActive = () =>
    run('active', async () => {
      await api.put(`/admin/drive/connections/${connection.id}`, { active: !connection.active })
      onChanged()
    })

  return (
    <article className={CARD}>
      <header className="flex flex-wrap items-start justify-between gap-12 border-b border-border-subtle pb-16">
        <div className="flex min-w-0 items-start gap-12">
          <GoogleDriveIcon />
          <div className="min-w-0">
            <h3 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">{connection.label}</h3>
            <p className="font-mono text-caption-m text-text-meta">
              {connection.account_email || '계정 이메일 미확인'} · {connection.is_env ? '환경변수' : 'OAuth 연결'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-8">
          <StatusPill ok={connection.active}>{connection.active ? '활성' : '비활성'}</StatusPill>
          <StatusPill ok={connection.has_token}>{connection.has_token ? '토큰 보관 중' : '토큰 없음'}</StatusPill>
          <StatusPill ok={connection.last_check_ok}>
            점검 {connection.last_check_ok === null ? '미실행' : connection.last_check_ok ? '정상' : '실패'}
          </StatusPill>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <p className={ROW}>
          <span className={KEY}>루트 폴더</span>
          {connection.root_folder_id ? (
            <a
              href={connection.root_folder_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-4 underline underline-offset-4 hover:text-text-pri"
            >
              {connection.root_folder_name || connection.root_folder_id}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : (
            <span className="text-state-error">미지정</span>
          )}
        </p>
        <p className={ROW}>
          <span className={KEY}>최근 점검</span>
          {formatDate(connection.last_check_at)}
        </p>
        <p className={ROW}>
          <span className={KEY}>연결 시각</span>
          {formatDate(connection.created_at)}
        </p>
        <p className={ROW}>
          <span className={KEY}>권한 범위</span>
          <span className="break-all font-mono text-caption-m">{connection.scope || '—'}</span>
        </p>
      </div>

      {connection.last_error && (
        <p className="flex items-start gap-8 rounded-sm border border-state-error/40 bg-state-error/5 p-12 text-small-m text-state-error">
          <AlertTriangle size={16} className="mt-2 shrink-0" aria-hidden="true" />
          {connection.last_error}
        </p>
      )}

      {checkResult && (
        <div className="rounded-sm border border-border-subtle bg-bg-elev p-12 text-small-m text-text-sec">
          <p className="font-semibold text-text-pri">
            {checkResult.ok ? '점검 정상' : '점검 실패'}
            {checkResult.account?.email ? ` · ${checkResult.account.email}` : ''}
          </p>
          {checkResult.root && (
            <p className="mt-4">
              루트 폴더: {checkResult.root.name || '—'} ({checkResult.root.ok ? '쓰기 가능' : checkResult.root.message})
            </p>
          )}
          {checkResult.account?.quota && (
            <p className="mt-4 font-mono text-caption-m text-text-meta">
              저장용량 {formatBytes(checkResult.account.quota.usage)} 사용
              {checkResult.account.quota.limit ? ` / ${formatBytes(checkResult.account.quota.limit)}` : ' (무제한)'}
            </p>
          )}
          {!checkResult.ok && (
            <ul className="mt-8 list-disc pl-20 text-small-m">
              <li>이 계정에 폴더를 편집자로 공유한 뒤 다시 점검하세요.</li>
              <li>또는 아래에서 새 루트 폴더를 지정하거나 새로 만드세요.</li>
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-8 border-t border-border-subtle pt-16">
        <GhostButton onClick={check} disabled={Boolean(busy)}>
          <RefreshCw size={16} aria-hidden="true" />
          {busy === 'check' ? '점검 중' : '연결 점검'}
        </GhostButton>
        <GhostButton onClick={testUpload} disabled={Boolean(busy) || !connection.root_folder_id}>
          <UploadCloud size={16} aria-hidden="true" />
          {busy === 'test' ? '업로드 중' : '테스트 파일 업로드'}
        </GhostButton>
        <GhostButton onClick={loadForms} disabled={Boolean(busy)}>
          <Link2 size={16} aria-hidden="true" />
          사용 중인 폼 보기
        </GhostButton>
        {isOwner && !connection.is_env && (
          <>
            <GhostButton onClick={toggleActive} disabled={Boolean(busy)}>
              {connection.active ? '비활성으로' : '활성으로'}
            </GhostButton>
            <GhostButton onClick={disconnect} disabled={Boolean(busy)}>
              <Unplug size={16} aria-hidden="true" />
              연결 해제
            </GhostButton>
          </>
        )}
      </div>

      {forms && (
        <div className="rounded-sm border border-border-subtle bg-bg-elev p-12">
          <p className="font-mono text-caption-m uppercase tracking-label text-text-meta">이 연결을 사용하는 폼</p>
          {forms.length === 0 ? (
            <p className="mt-8 text-small-m text-text-meta">아직 없습니다.</p>
          ) : (
            <ul className="mt-8 flex flex-col gap-4 text-small-m text-text-sec">
              {forms.map((form) => (
                <li key={form.id}>
                  {form.title_ko} · /forms/{form.slug} {form.published ? '(공개)' : '(비공개)'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isOwner && !connection.is_env && (
        <div className="flex flex-col gap-16 border-t border-border-subtle pt-16">
          <div className="grid grid-cols-1 items-end gap-12 md:grid-cols-[1fr_auto]">
            <Field label="루트 폴더 다시 지정" hint="Drive 폴더 URL 또는 ID를 붙여 넣습니다. 저장 전에 접근 권한을 서버가 확인합니다.">
              <Input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
            </Field>
            <GhostButton onClick={saveRoot} disabled={Boolean(busy)}>
              {busy === 'root' ? '확인 중' : '폴더 다시 선택'}
            </GhostButton>
          </div>

          <div className="grid grid-cols-1 items-end gap-12 md:grid-cols-[1fr_auto_auto]">
            <Field label="새 루트 폴더 만들기" hint="내 드라이브 최상단에 만듭니다. 만들기 전에 미리보기로 확인하세요.">
              <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="2027 한림대학교 디지털인문예술전공" />
            </Field>
            <GhostButton onClick={previewFolder} disabled={Boolean(busy) || !newFolderName.trim()}>
              구조 미리보기
            </GhostButton>
            <PrimaryButton onClick={createFolder} disabled={Boolean(busy) || !newFolderName.trim() || !preview}>
              <FolderPlus size={16} aria-hidden="true" />
              확인 후 생성
            </PrimaryButton>
          </div>

          {preview && (
            <div className="rounded-sm border border-border-purple bg-glass-bg p-12 font-mono text-caption-m text-text-sec">
              <p className="text-text-pri">만들 구조</p>
              {preview.map((step) => (
                <p key={step.name}>
                  내 드라이브 / {step.name} {step.missing ? '(새로 만듭니다)' : '(이미 있어 재사용합니다)'}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <ErrorText>{error}</ErrorText>
    </article>
  )
}

/** 미연결 업로드 — 제출되지 않은 파일. 자동 삭제하지 않고 관리자 확인으로만 지운다 */
function PendingUploads({ isOwner }) {
  const { data, loading, error, refetch } = useApi('/admin/drive/uploads', { params: { status: 'pending' } })
  const [busy, setBusy] = useState(0)
  const items = data?.items ?? []

  const remove = async (row, purge) => {
    const label = purge
      ? '기록을 지우고 Drive 파일도 휴지통으로 옮깁니다. 계속할까요?'
      : '기록만 삭제 표시합니다. Drive 파일은 그대로 남습니다. 계속할까요?'
    if (!window.confirm(label)) return
    setBusy(row.id)
    try {
      await api.del(`/admin/drive/uploads/${row.id}${purge ? '?purge=true' : ''}`)
      refetch()
    } finally {
      setBusy(0)
    }
  }

  return (
    <section className={CARD}>
      <header className="flex flex-wrap items-center justify-between gap-12">
        <div>
          <h3 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">미연결 업로드</h3>
          <p className="text-small-m text-text-sec">
            파일은 올렸지만 폼 제출로 이어지지 않은 기록입니다. 자동 삭제하지 않습니다.
          </p>
        </div>
        <GhostButton onClick={refetch}>
          <RefreshCw size={16} aria-hidden="true" />
          새로 고침
        </GhostButton>
      </header>
      {loading && <p className="font-mono text-caption-m text-text-meta">불러오는 중</p>}
      <ErrorText>{error?.message}</ErrorText>
      {!loading && items.length === 0 && <EmptyNote>미연결 업로드가 없습니다</EmptyNote>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-8">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-12 rounded-sm border border-border-subtle bg-bg-elev p-12"
            >
              <div className="min-w-0">
                <p className="truncate text-body-m text-text-pri">{row.original_name || row.stored_name}</p>
                <p className="font-mono text-caption-m text-text-meta">
                  {row.form_title || '폼 미확인'} · {row.field_id} · {row.storage} · {formatBytes(row.bytes)} ·{' '}
                  {formatDate(row.created_at)} · {row.submitter_email || '제출자 미확인'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-8">
                {row.file_url && (
                  <a
                    href={row.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-4 font-mono text-caption-m text-text-sec underline underline-offset-4 hover:text-text-pri"
                  >
                    파일 보기 <ExternalLink size={13} aria-hidden="true" />
                  </a>
                )}
                {isOwner && (
                  <>
                    <GhostButton onClick={() => remove(row, false)} disabled={busy === row.id}>
                      기록만 삭제
                    </GhostButton>
                    <GhostButton onClick={() => remove(row, true)} disabled={busy === row.id}>
                      <Trash2 size={16} aria-hidden="true" />
                      파일까지 휴지통
                    </GhostButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StorageDriveAdmin() {
  useTitle('저장소 · Google Drive')
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const [params, setParams] = useSearchParams()
  const { data, loading, error, refetch } = useApi('/admin/drive/status')
  const [message, setMessage] = useState(null)
  const [connectError, setConnectError] = useState(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const connections = data?.connections ?? []
  const config = data?.config ?? {}

  // OAuth 콜백이 되돌려준 결과를 한 번만 읽고 쿼리에서 지운다.
  useEffect(() => {
    if (params.get('drive') === 'connected') {
      setMessage('Google 계정을 연결했습니다. 아래에서 루트 폴더를 지정하고 연결 점검을 눌러 확인하세요.')
      setParams({}, { replace: true })
      refetch()
    }
    const err = params.get('drive_error')
    if (err) {
      setConnectError(CONNECT_ERROR[err] || `연결에 실패했습니다 (${err}).`)
      setParams({}, { replace: true })
    }
  }, [params, setParams, refetch])

  const connect = async () => {
    setBusy(true)
    setConnectError(null)
    try {
      const res = await api.post('/admin/drive/connect-url', { label })
      window.location.assign(res.url)
    } catch (err) {
      setConnectError(err.hint ? `${err.message} (${err.hint})` : err.message)
      setBusy(false)
    }
  }

  // 서버 설정이 빠져 있으면 연결 버튼을 눌러도 실패한다 — 먼저 무엇이 없는지 알려준다.
  const blockers = []
  if (!config.oauth_app_ready) {
    blockers.push('Render 환경변수 GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET / GOOGLE_DRIVE_REDIRECT_URI가 필요합니다.')
  }
  if (!config.encryption_ready) {
    blockers.push('Render 환경변수 DRIVE_TOKEN_ENC_KEY(32바이트 랜덤값 base64)가 필요합니다.')
  }

  return (
    <section className="flex min-w-0 flex-col gap-24">
      <PageHead
        title="저장소 · Google Drive"
        desc="전시회 원본·인쇄용 파일을 받을 Google 계정과 폴더를 여기서 관리합니다. 코드 수정은 필요하지 않습니다."
        actions={
          isOwner ? (
            <div className="flex flex-wrap items-end gap-8">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="연결 이름 (예: 2027 운영위원장 Drive)"
                aria-label="연결 이름"
                className="md:w-[280px]"
              />
              <PrimaryButton onClick={connect} disabled={busy || blockers.length > 0}>
                <HardDrive size={16} aria-hidden="true" />
                {busy ? '이동 중' : '새 Google 계정 연결'}
              </PrimaryButton>
            </div>
          ) : null
        }
      />

      {message && (
        <p className="flex items-start gap-8 rounded-sm border border-state-success/40 bg-state-success/5 p-12 text-small-m text-state-success">
          <Check size={16} className="mt-2 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
      <ErrorText>{connectError}</ErrorText>

      {blockers.length > 0 && (
        <div className="rounded-md border border-state-error/40 bg-state-error/5 p-16">
          <p className="text-body-m font-semibold text-state-error">연결을 시작하기 전에 서버 설정이 필요합니다</p>
          <ul className="mt-8 list-disc pl-20 text-small-m text-text-sec">
            {blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-8 font-mono text-caption-m text-text-meta">
            Google Cloud Console에 등록할 리디렉션 URI: {config.redirect_uri || '(GOOGLE_DRIVE_REDIRECT_URI 미설정)'}
          </p>
        </div>
      )}

      {!isOwner && (
        <p className="rounded-sm border border-border-subtle bg-bg-elev p-12 text-small-m text-text-sec">
          Drive 계정 연결·해제는 owner 권한만 가능합니다. manager는 폼 편집기에서 이미 연결된 Drive를 선택할 수 있습니다.
        </p>
      )}

      {loading && <p className="font-mono text-caption-m text-text-meta">연결 상태 확인 중</p>}
      <ErrorText>{error?.message}</ErrorText>

      {!loading && connections.length === 0 && (
        <EmptyNote>연결된 Google Drive 계정이 없습니다. 위에서 계정을 연결하세요.</EmptyNote>
      )}

      <div className="flex flex-col gap-16">
        {connections.map((connection) => (
          <ConnectionCard
            key={`${connection.id}-${connection.account_email}`}
            connection={connection}
            isOwner={isOwner}
            onChanged={refetch}
            onMessage={setMessage}
          />
        ))}
      </div>

      <PendingUploads isOwner={isOwner} />

      <section className={CARD}>
        <h3 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">인수인계 순서</h3>
        <ol className="list-decimal pl-20 text-body-m text-text-sec md:text-body-d">
          <li>owner 계정으로 로그인해 “새 Google 계정 연결”을 누르고 본인 Google 계정으로 동의합니다.</li>
          <li>기존 폴더를 계속 쓸 경우: 이전 담당자가 새 계정을 그 폴더의 편집자로 공유한 뒤 “연결 점검”을 누릅니다.</li>
          <li>새로 시작할 경우: “새 루트 폴더 만들기”에서 이름을 적고 구조 미리보기 → 확인 후 생성을 누릅니다.</li>
          <li>“테스트 파일 업로드”로 _DAH_INTEGRATION_TEST 폴더에 파일이 들어오는지 확인합니다.</li>
          <li>폼 편집기의 파일 질문에서 이 연결을 선택하고 예상 경로를 확인한 뒤 공개합니다.</li>
          <li>이전 연결은 “연결 해제”로 토큰만 폐기합니다. Drive 안의 파일은 지워지지 않습니다.</li>
        </ol>
      </section>
    </section>
  )
}

export default StorageDriveAdmin
