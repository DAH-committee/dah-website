// StorageDriveAdmin.jsx — 관리 → 저장소 → Google Drive (53_DRIVE_STORAGE)
//
// 기준: 개발을 모르는 운영진이 설명 없이도 할 일을 끝낼 수 있어야 한다.
// 화면에 보이는 말은 전부 일상어로 쓴다(토큰, 루트, 릴레이 같은 용어와 가운뎃점, 줄표 금지).
//   1) 지금 정상인지 맨 위에서 확인  2) 잘 연결됐는지 확인  3) 시험 파일 올려보기
//   4) 계정을 바꿔야 할 때만 맨 아래 '새 계정으로 연결하기'를 연다.
// 로그인 정보는 화면에 오지 않는다. 서버가 암호화해 보관하고 여기서는 연결 상태만 본다.

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
const KEY = 'text-small-m font-bold text-text-meta'

const CONNECT_ERROR = {
  consent_cancelled: '구글 화면에서 연결을 취소하셨습니다. 다시 시도해 주세요.',
  invalid_state: '연결 시간이 지났습니다. 처음부터 다시 시도해 주세요.',
  missing_code: '구글에서 확인 정보를 보내지 않았습니다. 다시 시도해 주세요.',
  token_exchange_failed: '구글과 연결하는 과정에서 문제가 생겼습니다. 개발 담당에게 알려 주세요.',
  no_refresh_token:
    '이 계정은 이미 이 사이트를 허용한 적이 있어 새로 연결되지 않습니다. 구글 계정의 보안 설정에서 이 사이트의 접근 권한을 삭제한 뒤 다시 시도해 주세요.',
}

function formatDate(value) {
  if (!value) return '기록 없음'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '기록 없음'
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
  const [nameInput, setNameInput] = useState(connection.label || '')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [forms, setForms] = useState(null)
  const [checkResult, setCheckResult] = useState(null)

  useEffect(() => {
    setRootInput(connection.root_folder_id || '')
  }, [connection.root_folder_id])

  useEffect(() => {
    setNameInput(connection.label || '')
  }, [connection.label])

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
      onMessage('저장 폴더를 바꿨습니다.')
      onChanged()
    })

  const saveName = () =>
    run('name', async () => {
      await api.put(`/admin/drive/connections/${connection.id}`, { label: nameInput.trim() })
      onMessage('이름을 바꿨습니다.')
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
      onMessage(`"${res.root?.name || newFolderName}" 폴더를 만들고 저장 폴더로 정했습니다.`)
      onChanged()
    })

  const testUpload = () =>
    run('test', async () => {
      const res = await api.post('/admin/drive/test-upload', { connection_id: connection.id })
      onMessage(
        `시험 파일을 올렸습니다. 파일 이름은 ${res.file?.name}이고 ${res.folder_name} 폴더에 들어갔습니다. 자동으로 지우지 않으니 필요 없으면 직접 지우세요.`
      )
    })

  const loadForms = () =>
    run('forms', async () => {
      const res = await api.get(`/admin/drive/connections/${connection.id}/forms`)
      setForms(res.items || [])
    })

  const disconnect = () =>
    run('disconnect', async () => {
      if (!window.confirm('연결을 끊으면 이 사이트가 이 계정으로 파일을 보낼 수 없게 됩니다. 드라이브에 이미 있는 파일은 지워지지 않습니다. 계속할까요?')) return
      await api.del(`/admin/drive/connections/${connection.id}`)
      onMessage('연결을 끊었습니다. 드라이브에 있는 파일은 그대로입니다.')
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
              {connection.account_email ? `${connection.account_email} 계정` : '계정 이메일을 아직 확인하지 못했습니다'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-8">
          <StatusPill ok={connection.active}>{connection.active ? '사용 중' : '쓰지 않는 중'}</StatusPill>
          <StatusPill ok={connection.has_token}>{connection.has_token ? '로그인 정보 저장됨' : '로그인 정보 없음'}</StatusPill>
          <StatusPill ok={connection.last_check_ok}>
            {connection.last_check_ok === null ? '확인 전' : connection.last_check_ok ? '확인 결과 정상' : '확인 결과 문제 있음'}
          </StatusPill>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <p className={ROW}>
          <span className={KEY}>저장 폴더</span>
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
            <span className="text-state-error">아직 정하지 않았습니다</span>
          )}
        </p>
        <p className={ROW}>
          <span className={KEY}>마지막으로 확인한 때</span>
          {formatDate(connection.last_check_at)}
        </p>
        <p className={ROW}>
          <span className={KEY}>연결한 날</span>
          {formatDate(connection.created_at)}
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
            {checkResult.ok ? '정상입니다. 파일을 보낼 수 있습니다.' : '문제가 있습니다. 아래를 확인해 주세요.'}
            {checkResult.account?.email ? ` (${checkResult.account.email} 계정)` : ''}
          </p>
          {checkResult.root && (
            <p className="mt-4">
              저장 폴더는 {checkResult.root.name || '이름 없음'}입니다. {checkResult.root.ok ? '파일을 넣을 수 있습니다.' : checkResult.root.message}
            </p>
          )}
          {checkResult.account?.quota && (
            <p className="mt-4 text-small-m text-text-meta">
              드라이브 사용량은 {formatBytes(checkResult.account.quota.usage)}입니다
              {checkResult.account.quota.limit ? ` (전체 ${formatBytes(checkResult.account.quota.limit)} 중)` : ' (용량 제한 없음)'}
            </p>
          )}
          {!checkResult.ok && (
            <ul className="mt-8 list-disc pl-20 text-small-m">
              <li>저장 폴더를 이 계정에 '편집자'로 공유한 뒤 다시 확인해 보세요.</li>
              <li>그래도 안 되면 아래에서 저장 폴더를 바꾸거나 새로 만드세요.</li>
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-8 border-t border-border-subtle pt-16">
        <GhostButton onClick={check} disabled={Boolean(busy)}>
          <RefreshCw size={16} aria-hidden="true" />
          {busy === 'check' ? '확인 중' : '잘 연결됐는지 확인'}
        </GhostButton>
        <GhostButton onClick={testUpload} disabled={Boolean(busy) || !connection.root_folder_id}>
          <UploadCloud size={16} aria-hidden="true" />
          {busy === 'test' ? '올리는 중' : '시험 파일 올려보기'}
        </GhostButton>
        <GhostButton onClick={loadForms} disabled={Boolean(busy)}>
          <Link2 size={16} aria-hidden="true" />
          이 보관함을 쓰는 신청 폼 보기
        </GhostButton>
        {isOwner && !connection.is_env && (
          <>
            <GhostButton onClick={toggleActive} disabled={Boolean(busy)}>
              {connection.active ? '잠시 쓰지 않기' : '다시 쓰기'}
            </GhostButton>
            <GhostButton onClick={disconnect} disabled={Boolean(busy)}>
              <Unplug size={16} aria-hidden="true" />
              연결 끊기
            </GhostButton>
          </>
        )}
      </div>

      {forms && (
        <div className="rounded-sm border border-border-subtle bg-bg-elev p-12">
          <p className="text-small-m font-bold text-text-meta">이 보관함에 파일을 보내는 신청 폼</p>
          {forms.length === 0 ? (
            <p className="mt-8 text-small-m text-text-meta">아직 없습니다. 신청 폼의 파일 질문에서 저장 위치를 구글 드라이브로 고르면 여기에 나타납니다.</p>
          ) : (
            <ul className="mt-8 flex flex-col gap-4 text-small-m text-text-sec">
              {forms.map((form) => (
                <li key={form.id}>
                  {form.title_ko} ({form.published ? '공개 중' : '아직 비공개'})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isOwner && !connection.is_env && (
        <div className="flex flex-col gap-16 border-t border-border-subtle pt-16">
          <div className="grid grid-cols-1 items-end gap-12 md:grid-cols-[1fr_auto]">
            <Field label="이 연결의 이름" hint="알아보기 쉬운 이름으로 바꿔 두세요. 예: 2027 운영위원장 드라이브">
              <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
            </Field>
            <GhostButton onClick={saveName} disabled={Boolean(busy) || !nameInput.trim() || nameInput.trim() === connection.label}>
              {busy === 'name' ? '저장 중' : '이름 바꾸기'}
            </GhostButton>
          </div>

          <div className="grid grid-cols-1 items-end gap-12 md:grid-cols-[1fr_auto]">
            <Field label="저장 폴더 바꾸기" hint="바꾸고 싶은 구글 드라이브 폴더의 주소를 붙여 넣으세요. 저장하기 전에 사이트가 그 폴더에 접근할 수 있는지 자동으로 확인합니다.">
              <Input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
            </Field>
            <GhostButton onClick={saveRoot} disabled={Boolean(busy)}>
              {busy === 'root' ? '확인 중' : '이 폴더로 바꾸기'}
            </GhostButton>
          </div>

          <div className="grid grid-cols-1 items-end gap-12 md:grid-cols-[1fr_auto_auto]">
            <Field label="새 저장 폴더 만들기" hint="내 드라이브 맨 위에 새 폴더를 만듭니다. 먼저 '만들어질 모습 보기'를 눌러 확인하세요.">
              <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="2027 한림대학교 디지털인문예술전공" />
            </Field>
            <GhostButton onClick={previewFolder} disabled={Boolean(busy) || !newFolderName.trim()}>
              만들어질 모습 보기
            </GhostButton>
            <PrimaryButton onClick={createFolder} disabled={Boolean(busy) || !newFolderName.trim() || !preview}>
              <FolderPlus size={16} aria-hidden="true" />
              확인했으니 만들기
            </PrimaryButton>
          </div>

          {preview && (
            <div className="rounded-sm border border-border-purple bg-glass-bg p-12 font-mono text-caption-m text-text-sec">
              <p className="text-text-pri">이렇게 만들어집니다</p>
              {preview.map((step) => (
                <p key={step.name}>
                  내 드라이브 / {step.name} {step.missing ? '(새로 만듭니다)' : '(이미 있어서 그대로 씁니다)'}
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
      ? '목록에서 지우고 드라이브의 파일도 휴지통으로 옮깁니다. 계속할까요?'
      : '목록에서만 지웁니다. 드라이브의 파일은 그대로 남습니다. 계속할까요?'
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
          <h3 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">제출이 끝나지 않은 파일</h3>
          <p className="text-small-m text-text-sec">
            파일은 올라왔지만 신청서 제출까지 마치지 않은 경우입니다. 자동으로 지우지 않으니 필요 없는 것은 직접 지워 주세요.
          </p>
        </div>
        <GhostButton onClick={refetch}>
          <RefreshCw size={16} aria-hidden="true" />
          새로 고침
        </GhostButton>
      </header>
      {loading && <p className="text-small-m text-text-meta">불러오는 중입니다</p>}
      <ErrorText>{error?.message}</ErrorText>
      {!loading && items.length === 0 && <EmptyNote>제출이 끝나지 않은 파일이 없습니다</EmptyNote>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-8">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-12 rounded-sm border border-border-subtle bg-bg-elev p-12"
            >
              <div className="min-w-0">
                <p className="truncate text-body-m text-text-pri">{row.original_name || row.stored_name}</p>
                <p className="text-small-m text-text-meta">
                  {[row.form_title || '어느 폼인지 알 수 없음', formatBytes(row.bytes), formatDate(row.created_at), row.submitter_email || '제출자를 알 수 없음'].join(', ')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-8">
                {row.file_url && (
                  <a
                    href={row.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-4 text-small-m text-text-sec underline underline-offset-4 hover:text-text-pri"
                  >
                    파일 보기 <ExternalLink size={13} aria-hidden="true" />
                  </a>
                )}
                {isOwner && (
                  <>
                    <GhostButton onClick={() => remove(row, false)} disabled={busy === row.id}>
                      목록에서만 지우기
                    </GhostButton>
                    <GhostButton onClick={() => remove(row, true)} disabled={busy === row.id}>
                      <Trash2 size={16} aria-hidden="true" />
                      파일도 휴지통으로
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

/**
 * 새 계정 연결 카드(Apps Script 방식).
 * 구글 클라우드 설정 없이 연결하는 길이다. 신청자는 계속 사이트 폼을 쓰고
 * 구글 쪽 스크립트는 화면 없이 파일만 받는다. 계정을 바꿀 때만 쓰므로 접어서 둔다.
 */
function AppsScriptConnect({ ready, onDone }) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.post('/admin/drive/connections/apps-script', {
        label,
        script_url: url.trim(),
        secret: secret.trim(),
        root_folder_id: root.trim(),
      })
      setResult(res.check)
      setSecret('')
      onDone(
        res.check?.ok
          ? `새 계정을 연결했습니다. 파일이 저장될 계정은 ${res.check?.account?.email || '확인 중'}입니다.`
          : '연결은 만들었지만 확인에 실패했습니다. 아래 안내를 따라 점검해 주세요.'
      )
    } catch (err) {
      setError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className={`${CARD} group`}>
      <summary className="cursor-pointer list-none">
        <h3 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">새 계정으로 연결하기</h3>
        <p className="mt-4 text-small-m text-text-sec">
          파일을 모을 구글 계정을 바꿀 때만 엽니다. 평소에는 열 필요가 없습니다. 눌러서 펼쳐 보세요.
        </p>
      </summary>

      <div className="mt-16 flex flex-col gap-16">
        <p className="text-small-m text-text-sec">
          신청자는 지금처럼 사이트의 신청 폼을 그대로 쓰고, 파일만 새 계정의 드라이브로 모이게 하는 방법입니다.
          처음 한 번만 하면 되고, 어렵다면 개발 담당과 함께 진행하세요.
        </p>

        <ol className="list-decimal pl-20 text-small-m leading-[1.8] text-text-sec">
          <li>파일을 모을 구글 계정으로 로그인한 뒤 script.google.com에 들어가 '새 프로젝트'를 만듭니다.</li>
          <li>
            개발 담당에게 받은 연결용 코드를 붙여 넣습니다. 코드 파일은 <code className="font-mono">server/scripts/apps-script/drive-relay.gs</code>에 있습니다.
            맨 위의 비밀번호 칸을 32글자 이상의 아무 글자로 바꿉니다.
          </li>
          <li>화면 오른쪽 위의 '배포'를 누르고 '새 배포'를 고릅니다. 종류는 '웹 앱', 실행 사용자는 '나', 접근 권한은 <strong>'모든 사용자'</strong>로 정하고 배포합니다.</li>
          <li>배포가 끝나면 <code className="font-mono">/exec</code>로 끝나는 주소가 나옵니다. 그 주소와 2번에서 정한 비밀번호를 아래 칸에 넣고 '새 계정 연결하기'를 누릅니다.</li>
        </ol>

        <div className="grid grid-cols-1 gap-12 md:grid-cols-2">
          <Field label="연결 이름" hint="나중에 알아보기 쉬운 이름. 예: 2027 운영위원장 드라이브">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027 운영위원장 드라이브" />
          </Field>
          <Field label="저장 폴더 주소" hint="지금 몰라도 됩니다. 비워 두면 연결한 뒤에 정할 수 있습니다">
            <Input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
          </Field>
          <Field label="연결 주소" hint="배포 후 나온, /exec로 끝나는 주소">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" />
          </Field>
          <Field label="연결 비밀번호" hint="코드 맨 위에 적은 비밀번호와 똑같이 입력하세요. 저장한 뒤에는 다시 보이지 않습니다">
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-8">
          <PrimaryButton onClick={submit} disabled={busy || !ready || !url.trim() || secret.trim().length < 16}>
            <Link2 size={16} aria-hidden="true" />
            {busy ? '확인 중' : '새 계정 연결하기'}
          </PrimaryButton>
          {!ready && (
            <span className="text-small-m text-state-error">
              서버 설정이 아직 끝나지 않아 연결할 수 없습니다. 개발 담당에게 알려 주세요.
            </span>
          )}
        </div>

        {result && (
          <div className="rounded-sm border border-border-subtle bg-bg-elev p-12 text-small-m text-text-sec">
            <p className="font-semibold text-text-pri">{result.ok ? '정상입니다. 파일을 보낼 수 있습니다.' : '문제가 있습니다. 아래를 확인해 주세요.'}</p>
            {result.account?.email && <p className="mt-4">파일이 저장될 계정은 {result.account.email}입니다.</p>}
            {result.root && (
              <p className="mt-4">
                저장 폴더는 {result.root.name || '이름 없음'}입니다. {result.root.ok ? '파일을 넣을 수 있습니다.' : result.root.message}
              </p>
            )}
            {!result.ok && (
              <ul className="mt-8 list-disc pl-20">
                <li>배포할 때 접근 권한을 '모든 사용자'로 했는지 확인하세요.</li>
                <li>코드에 적은 비밀번호와 여기에 입력한 비밀번호가 똑같은지 확인하세요.</li>
                <li>코드를 고쳤다면 '새 배포'를 다시 만들어야 고친 내용이 적용됩니다.</li>
              </ul>
            )}
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </details>
  )
}

/** 맨 위 한눈에 보기. 설명을 읽기 전에 지금 정상인지부터 알려준다. */
function StatusSummary({ connections, loading }) {
  if (loading) return null
  const active = connections.filter((c) => c.active)
  const working = active.find((c) => c.last_check_ok)
  const tone = working ? 'border-state-success/40 bg-state-success/5' : 'border-state-error/40 bg-state-error/5'
  const headTone = working ? 'text-state-success' : 'text-state-error'

  let head = '연결된 드라이브가 없습니다'
  let body = '아래 맨 끝의 ‘새 계정으로 연결하기’를 열어 파일을 모을 구글 계정을 연결해 주세요.'
  if (working) {
    head = '정상입니다'
    body = `지금 신청자가 올리는 파일은 ${working.account_email || '연결된'} 계정의 ‘${working.root_folder_name || '저장 폴더'}’ 폴더로 모입니다.`
  } else if (active.length > 0) {
    head = '확인이 필요합니다'
    body = '연결은 되어 있지만 마지막 확인에서 정상으로 나오지 않았습니다. 아래 카드에서 ‘잘 연결됐는지 확인’을 눌러 보세요.'
  }

  return (
    <div className={`rounded-md border p-20 ${tone}`}>
      <p className={`text-body-l-m font-bold md:text-body-l-d ${headTone}`}>{head}</p>
      <p className="mt-8 text-body-m leading-[1.7] text-text-sec md:text-body-d">{body}</p>
    </div>
  )
}

function StorageDriveAdmin() {
  useTitle('파일 보관함 (구글 드라이브)')
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

  // 구글 로그인 화면에서 돌아온 결과를 한 번만 읽고 주소에서 지운다.
  useEffect(() => {
    if (params.get('drive') === 'connected') {
      setMessage('구글 계정을 연결했습니다. 아래에서 저장 폴더를 정하고 ‘잘 연결됐는지 확인’을 눌러 주세요.')
      setParams({}, { replace: true })
      refetch()
    }
    const err = params.get('drive_error')
    if (err) {
      setConnectError(CONNECT_ERROR[err] || `연결에 실패했습니다 (${err}). 개발 담당에게 알려 주세요.`)
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

  // 구글 로그인 방식은 서버 설정이 끝난 경우에만 보여준다. 안 보이는 것이 정상이다.
  const oauthReady = Boolean(config.oauth_app_ready && config.encryption_ready)

  return (
    <section className="flex min-w-0 flex-col gap-24">
      <PageHead
        title="파일 보관함 (구글 드라이브)"
        desc="참가자가 올린 작품 파일이 어느 구글 드라이브에 쌓이는지 확인하고 바꾸는 곳입니다. 코드를 고칠 필요는 없습니다."
        actions={
          isOwner && oauthReady ? (
            <div className="flex flex-wrap items-end gap-8">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="연결 이름 (예: 2027 운영위원장 드라이브)"
                aria-label="연결 이름"
                className="md:w-[280px]"
              />
              <PrimaryButton onClick={connect} disabled={busy}>
                <HardDrive size={16} aria-hidden="true" />
                {busy ? '이동 중' : '구글 계정으로 연결하기'}
              </PrimaryButton>
            </div>
          ) : null
        }
      />

      <StatusSummary connections={connections} loading={loading} />

      {message && (
        <p className="flex items-start gap-8 rounded-sm border border-state-success/40 bg-state-success/5 p-12 text-small-m text-state-success">
          <Check size={16} className="mt-2 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
      <ErrorText>{connectError}</ErrorText>

      {!isOwner && (
        <p className="rounded-sm border border-border-subtle bg-bg-elev p-12 text-small-m text-text-sec">
          드라이브 계정을 연결하거나 끊는 일은 대표 관리자만 할 수 있습니다. 운영 관리자는 신청 폼을 만들 때 이미 연결된 드라이브를 골라 쓸 수 있습니다.
        </p>
      )}

      {loading && <p className="text-small-m text-text-meta">연결 상태를 확인하고 있습니다</p>}
      <ErrorText>{error?.message}</ErrorText>

      {!loading && connections.length === 0 && (
        <EmptyNote>연결된 구글 드라이브가 없습니다. 맨 아래에서 계정을 연결해 주세요.</EmptyNote>
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

      <section className={CARD}>
        <h3 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">신청 폼의 파일이 이 드라이브로 모이게 하려면</h3>
        <p className="text-body-m leading-[1.7] text-text-sec md:text-body-d">
          폼은 저절로 드라이브로 보내지 않습니다. 신청 폼을 만들 때 파일 질문마다 저장 위치를 <strong>구글 드라이브</strong>로 직접 골라야 합니다.
          고르지 않으면 파일은 웹 전시용 임시 저장소로 들어가고, 이 보관함에는 쌓이지 않습니다.
          드라이브 계정이 하나만 연결되어 있으면 어느 계정인지는 따로 고르지 않아도 그 계정으로 모입니다.
        </p>
      </section>

      <PendingUploads isOwner={isOwner} />

      {isOwner && <AppsScriptConnect ready={Boolean(config.apps_script_ready)} onDone={(msg) => { setMessage(msg); refetch() }} />}

      <section className={CARD}>
        <h3 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">담당자가 바뀔 때 할 일</h3>
        <ol className="list-decimal pl-20 text-body-m leading-[1.8] text-text-sec md:text-body-d">
          <li>새 담당자가 대표 관리자 계정으로 이 사이트에 로그인합니다.</li>
          <li>파일을 모을 구글 계정을 정합니다. 예전 폴더를 계속 쓰려면 이전 담당자가 그 폴더를 새 계정에 ‘편집자’로 공유해 줍니다.</li>
          <li>맨 아래 ‘새 계정으로 연결하기’를 펼쳐 안내대로 연결합니다.</li>
          <li>‘잘 연결됐는지 확인’과 ‘시험 파일 올려보기’를 눌러 파일이 실제로 들어오는지 봅니다. 시험 파일은 지우지 않으니 필요 없으면 드라이브에서 직접 지우세요.</li>
          <li>신청 폼의 파일 질문에서 저장 위치를 구글 드라이브로 고르고, 화면에 나오는 ‘예상 저장 경로’가 맞는지 본 뒤 공개합니다.</li>
          <li>이전 계정은 ‘연결 끊기’로 정리합니다. 드라이브에 이미 있는 파일은 지워지지 않습니다.</li>
        </ol>
      </section>
    </section>
  )
}

export default StorageDriveAdmin
