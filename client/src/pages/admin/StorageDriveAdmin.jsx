// StorageDriveAdmin.jsx — 관리 > 파일 보관함 (구글 드라이브)
//
// 기준: 개발을 모르는 운영진이 설명 없이도 끝낼 수 있는 화면.
//   1) 위계: 현재 상태(가장 크게) > 설정 변경, 신청 폼 연결, 미제출 파일 > 담당자 교체, 새 계정 연결(접힘)
//   2) 문장: 제목, 항목명, 안내는 명사형으로 짧게. 기술 용어, 가운뎃점, 줄표 금지.
//   3) 정렬: 입력칸과 버튼은 같은 높이의 한 줄. 설명은 줄 아래. 위험한 버튼은 접힌 '연결 관리' 안.
// 로그인 정보는 화면에 오지 않는다. 서버가 암호화해 보관하고 여기서는 연결 상태만 본다.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  ChevronDown,
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
  ErrorText,
  Field,
  GhostButton,
  Input,
  PageHead,
  PrimaryButton,
} from '../../components/admin/FormControls'
import GoogleDriveIcon from '../../components/common/GoogleDriveIcon'

const CARD = 'flex min-w-0 flex-col gap-24 rounded-md border border-border-subtle bg-bg-panel p-24 md:p-32'
const H3 = 'text-body-l-m font-bold text-text-pri md:text-body-l-d'
const NOTE = 'text-small-m leading-[1.7] text-text-sec'
const TERM = 'text-small-m font-bold text-text-meta'
const DANGER_BTN = '!border-state-error/50 !text-state-error hover:!border-state-error'

const CONNECT_ERROR = {
  consent_cancelled: '구글 화면에서 연결 취소. 다시 시도해 주세요.',
  invalid_state: '연결 시간 초과. 처음부터 다시 시도해 주세요.',
  missing_code: '구글의 확인 정보 미수신. 다시 시도해 주세요.',
  token_exchange_failed: '구글 연결 과정 오류. 개발 담당에게 문의해 주세요.',
  no_refresh_token:
    '이미 허용한 적이 있는 계정이라 새 연결 불가. 구글 계정의 보안 설정에서 이 사이트의 접근 권한을 삭제한 뒤 다시 시도해 주세요.',
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
    <span className={`inline-flex h-32 items-center rounded-sm border px-12 text-small-m font-bold ${tone}`}>
      {children}
    </span>
  )
}

/** 항목명과 값을 한 쌍으로 보여주는 한 칸 */
function Item({ term, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dt className={TERM}>{term}</dt>
      <dd className="min-w-0 break-words text-body-m font-semibold text-text-pri md:text-body-d">{children}</dd>
    </div>
  )
}

/**
 * 입력칸과 버튼이 한 줄에 같은 높이로 놓이는 한 행.
 * 설명(hint)은 줄 아래에 둔다. Field처럼 설명을 입력칸과 같은 칸에 넣으면
 * 옆 버튼이 입력칸이 아니라 입력칸과 설명의 가운데 높이에 맞춰져 어긋난다.
 */
function InlineField({ label, hint, action, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <span className="text-body-m font-bold text-text-pri">{label}</span>
      <div className="flex flex-col gap-12 sm:flex-row sm:items-stretch">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-wrap items-stretch gap-8 [&>button]:h-auto [&>button]:min-h-11 [&>button]:w-full sm:[&>button]:w-auto">{action}</div>
      </div>
      {hint && <p className={NOTE}>{hint}</p>}
    </div>
  )
}

/** 접었다 펴는 구역. 자주 쓰지 않는 설정은 여기에 둔다. */
function Fold({ title, note, children, className = '' }) {
  return (
    <details className={`group rounded-md border border-border-subtle bg-bg-panel ${className}`.trim()}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-16 p-24 md:px-32">
        <span className="min-w-0">
          <span className={`block ${H3}`}>{title}</span>
          {note && <span className={`mt-4 block ${NOTE}`}>{note}</span>}
        </span>
        <ChevronDown size={20} aria-hidden="true" className="shrink-0 text-text-meta transition-transform duration-fast group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-24 border-t border-border-subtle p-24 md:p-32">{children}</div>
    </details>
  )
}

/** 연결 카드 1장: 현재 상태가 가장 크고, 설정 변경과 연결 관리는 접어 둔다. */
function ConnectionCard({ connection, isOwner, onChanged, onMessage }) {
  const [busy, setBusy] = useState('')
  const [rootInput, setRootInput] = useState(connection.root_folder_id || '')
  const [nameInput, setNameInput] = useState(connection.label || '')
  const [newFolderName, setNewFolderName] = useState('')
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

  const saveName = () =>
    run('name', async () => {
      await api.put(`/admin/drive/connections/${connection.id}`, { label: nameInput.trim() })
      onMessage('이름 변경 완료')
      onChanged()
    })

  const saveRoot = () =>
    run('root', async () => {
      await api.put(`/admin/drive/connections/${connection.id}`, { root_folder_id: rootInput })
      onMessage('저장 폴더 변경 완료')
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
      onMessage(`새 저장 폴더 생성 완료: ${res.root?.name || newFolderName}`)
      onChanged()
    })

  const testUpload = () =>
    run('test', async () => {
      const res = await api.post('/admin/drive/test-upload', { connection_id: connection.id })
      onMessage(
        `시험 파일 업로드 완료: ${res.file?.name} (${res.folder_name} 폴더). 자동 삭제 없음, 필요 없으면 드라이브에서 직접 삭제`
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
      onMessage('연결 끊기 완료. 드라이브의 파일은 그대로 유지')
      onChanged()
    })

  const toggleActive = () =>
    run('active', async () => {
      await api.put(`/admin/drive/connections/${connection.id}`, { active: !connection.active })
      onChanged()
    })

  const working = connection.last_check_ok === true && connection.active
  const statusLabel = !connection.active
    ? '사용 중지'
    : connection.last_check_ok === null
      ? '확인 전'
      : connection.last_check_ok
        ? '정상'
        : '문제 있음'

  return (
    <article className={`${CARD} border-border-purple`}>
      <header className="flex flex-wrap items-start justify-between gap-16">
        <div className="flex min-w-0 items-start gap-12">
          <GoogleDriveIcon />
          <div className="min-w-0">
            <h3 className={H3}>{connection.label}</h3>
            <p className="mt-4 text-small-m text-text-meta">
              {connection.account_email ? `${connection.account_email} 계정` : '계정 이메일 확인 전'}
            </p>
          </div>
        </div>
        <StatusPill ok={connection.active ? connection.last_check_ok : null}>{statusLabel}</StatusPill>
      </header>

      <div>
        <p className={`text-h3-m font-bold md:text-h3-d ${working ? 'text-state-success' : 'text-text-pri'}`}>
          {working ? '파일 수신 가능' : connection.active ? '확인 필요' : '파일 수신 중지'}
        </p>
        <dl className="mt-16 grid grid-cols-1 gap-x-32 gap-y-16 md:grid-cols-2">
          <Item term="저장 폴더">
            {connection.root_folder_id ? (
              <a
                href={connection.root_folder_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-4 underline underline-offset-4 hover:text-text-meta"
              >
                {connection.root_folder_name || connection.root_folder_id}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              <span className="text-state-error">미지정</span>
            )}
          </Item>
          <Item term="저장 계정">{connection.account_email || '확인 전'}</Item>
          <Item term="마지막 확인">{formatDate(connection.last_check_at)}</Item>
          <Item term="연결일">{formatDate(connection.created_at)}</Item>
        </dl>
      </div>

      {connection.last_error && (
        <p className="flex items-start gap-8 rounded-sm border border-state-error/40 bg-state-error/5 p-12 text-small-m text-state-error">
          <AlertTriangle size={16} className="mt-2 shrink-0" aria-hidden="true" />
          {connection.last_error}
        </p>
      )}

      {checkResult && (
        <div className="rounded-sm border border-border-subtle bg-bg-elev p-16">
          <p className={`text-body-m font-bold ${checkResult.ok ? 'text-state-success' : 'text-state-error'}`}>
            {checkResult.ok ? '확인 결과 정상: 파일 수신 가능' : '확인 결과 문제 발견: 아래 항목 점검'}
          </p>
          <dl className="mt-12 grid grid-cols-1 gap-x-32 gap-y-12 md:grid-cols-2">
            {checkResult.account?.email && <Item term="저장 계정">{checkResult.account.email}</Item>}
            {checkResult.root && (
              <Item term="저장 폴더">
                {checkResult.root.name || '이름 없음'} ({checkResult.root.ok ? '쓰기 가능' : checkResult.root.message})
              </Item>
            )}
            {checkResult.account?.quota && (
              <Item term="드라이브 사용량">
                {formatBytes(checkResult.account.quota.usage)}
                {checkResult.account.quota.limit ? ` / ${formatBytes(checkResult.account.quota.limit)}` : ' (제한 없음)'}
              </Item>
            )}
          </dl>
          {!checkResult.ok && (
            <ul className="mt-12 list-disc pl-20 text-small-m leading-[1.8] text-text-sec">
              <li>저장 폴더를 이 계정에 ‘편집자’로 공유한 뒤 재확인</li>
              <li>해결되지 않으면 아래 ‘설정 변경’에서 저장 폴더 변경 또는 새 폴더 생성</li>
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-12">
        <PrimaryButton onClick={check} disabled={Boolean(busy)}>
          <RefreshCw size={16} aria-hidden="true" />
          {busy === 'check' ? '확인 중' : '연결 확인'}
        </PrimaryButton>
        <GhostButton onClick={testUpload} disabled={Boolean(busy) || !connection.root_folder_id}>
          <UploadCloud size={16} aria-hidden="true" />
          {busy === 'test' ? '업로드 중' : '시험 파일 업로드'}
        </GhostButton>
        <GhostButton onClick={loadForms} disabled={Boolean(busy)}>
          <Link2 size={16} aria-hidden="true" />
          연결된 신청 폼 보기
        </GhostButton>
      </div>

      {forms && (
        <div className="rounded-sm border border-border-subtle bg-bg-elev p-16">
          <p className="text-body-m font-bold text-text-pri">이 드라이브를 쓰는 신청 폼</p>
          {forms.length === 0 ? (
            <p className={`mt-8 ${NOTE}`}>해당 폼 없음. 신청 폼의 파일 질문에서 저장 위치를 ‘구글 드라이브’로 선택하면 표시</p>
          ) : (
            <ul className="mt-8 flex flex-col gap-4 text-small-m text-text-sec">
              {forms.map((form) => (
                <li key={form.id}>
                  {form.title_ko} ({form.published ? '공개 중' : '비공개'})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isOwner && !connection.is_env && (
        <details className="group border-t border-border-subtle pt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-16">
            <span>
              <span className="block text-body-m font-bold text-text-pri">설정 변경</span>
              <span className={`mt-4 block ${NOTE}`}>이름, 저장 폴더, 연결 관리</span>
            </span>
            <ChevronDown size={20} aria-hidden="true" className="shrink-0 text-text-meta transition-transform duration-fast group-open:rotate-180" />
          </summary>

          <div className="mt-24 flex flex-col gap-32">
            <InlineField
              label="연결 이름"
              hint="알아보기 쉬운 이름. 예: 2027 운영위원장 드라이브"
              action={
                <GhostButton onClick={saveName} disabled={Boolean(busy) || !nameInput.trim() || nameInput.trim() === connection.label}>
                  {busy === 'name' ? '저장 중' : '이름 변경'}
                </GhostButton>
              }
            >
              <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
            </InlineField>

            <InlineField
              label="저장 폴더 변경"
              hint="구글 드라이브 폴더 주소 붙여넣기. 변경 전 접근 가능 여부 자동 확인"
              action={
                <GhostButton onClick={saveRoot} disabled={Boolean(busy)}>
                  {busy === 'root' ? '확인 중' : '이 폴더로 변경'}
                </GhostButton>
              }
            >
              <Input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
            </InlineField>

            <div className="flex flex-col gap-12">
              <InlineField
                label="새 저장 폴더 생성"
                hint="내 드라이브 맨 위에 새 폴더 생성. ‘미리보기’로 먼저 확인"
                action={
                  <GhostButton onClick={previewFolder} disabled={Boolean(busy) || !newFolderName.trim()}>
                    미리보기
                  </GhostButton>
                }
              >
                <Input value={newFolderName} onChange={(e) => { setNewFolderName(e.target.value); setPreview(null) }} placeholder="2027 한림대학교 디지털인문예술전공" />
              </InlineField>

              {preview && (
                <div className="flex flex-col gap-12 rounded-sm border border-border-purple bg-glass-bg p-16">
                  <div>
                    <p className="text-body-m font-bold text-text-pri">생성 예정 폴더</p>
                    <ul className="mt-8 text-small-m leading-[1.8] text-text-sec">
                      {preview.map((step) => (
                        <li key={step.name}>
                          내 드라이브 / {step.name} ({step.missing ? '새로 생성' : '기존 폴더 사용'})
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <PrimaryButton onClick={createFolder} disabled={Boolean(busy)}>
                      <FolderPlus size={16} aria-hidden="true" />
                      {busy === 'create' ? '생성 중' : '확인 후 생성'}
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-12 border-t border-border-subtle pt-24">
              <span className="text-body-m font-bold text-text-pri">연결 관리</span>
              <div className="flex flex-wrap items-center gap-12">
                <GhostButton onClick={toggleActive} disabled={Boolean(busy)}>
                  {connection.active ? '사용 중지' : '사용 재개'}
                </GhostButton>
                <GhostButton onClick={disconnect} disabled={Boolean(busy)} className={DANGER_BTN}>
                  <Unplug size={16} aria-hidden="true" />
                  연결 끊기
                </GhostButton>
              </div>
              <p className={NOTE}>사용 중지: 파일 수신만 일시 중단. 연결 끊기: 로그인 정보 삭제, 드라이브의 파일은 유지</p>
            </div>
          </div>
        </details>
      )}

      <ErrorText>{error}</ErrorText>
    </article>
  )
}

/** 신청 폼과 이 드라이브의 관계. 폼은 저절로 드라이브로 보내지 않는다는 점을 표로 보여준다. */
function FormLinkGuide() {
  return (
    <section className={CARD}>
      <h3 className={H3}>신청 폼 연결 방식</h3>
      <dl className="grid grid-cols-1 gap-y-16 md:grid-cols-[180px_1fr] md:gap-x-32">
        <dt className={TERM}>전시회 접수</dt>
        <dd className="text-body-m text-text-pri md:text-body-d">전시회 설정에서 선택한 드라이브에 자동 저장</dd>
        <dt className={TERM}>일반 신청 폼</dt>
        <dd className="text-body-m text-text-pri md:text-body-d">
          파일 질문마다 저장 위치를 <strong>‘구글 드라이브’</strong>로 직접 선택해야 저장
          <span className={`mt-4 block ${NOTE}`}>미선택 시 웹 전시용 임시 저장소로 이동, 이 보관함에는 미저장</span>
        </dd>
        <dt className={TERM}>드라이브 선택</dt>
        <dd className="text-body-m text-text-pri md:text-body-d">연결이 1개이면 자동 선택</dd>
      </dl>
    </section>
  )
}

/** 제출 미완료 파일: 자동 삭제하지 않고 관리자 확인으로만 지운다 */
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
      <header className="flex flex-wrap items-start justify-between gap-16">
        <div>
          <h3 className={H3}>제출 미완료 파일</h3>
          <p className={`mt-4 ${NOTE}`}>업로드 후 신청서를 제출하지 않은 파일. 자동 삭제 없음, 필요 없으면 직접 삭제</p>
        </div>
        <GhostButton onClick={refetch}>
          <RefreshCw size={16} aria-hidden="true" />
          새로고침
        </GhostButton>
      </header>
      {loading && <p className={NOTE}>불러오는 중</p>}
      <ErrorText>{error?.message}</ErrorText>
      {!loading && items.length === 0 && <p className="text-body-m font-semibold text-text-meta">해당 파일 없음</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-8">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-12 rounded-sm border border-border-subtle bg-bg-elev p-16"
            >
              <div className="min-w-0">
                <p className="truncate text-body-m font-semibold text-text-pri">{row.original_name || row.stored_name}</p>
                <p className={`mt-4 ${NOTE}`}>
                  {[row.form_title || '폼 불명', formatBytes(row.bytes), formatDate(row.created_at), row.submitter_email || '제출자 불명'].join(', ')}
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
                      목록에서만 삭제
                    </GhostButton>
                    <GhostButton onClick={() => remove(row, true)} disabled={busy === row.id} className={DANGER_BTN}>
                      <Trash2 size={16} aria-hidden="true" />
                      파일도 휴지통
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

/** 새 계정 연결(Apps Script 방식). 계정을 바꿀 때만 쓰므로 접어 둔다. */
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
          ? `새 계정 연결 완료. 저장 계정: ${res.check?.account?.email || '확인 중'}`
          : '연결 생성 완료, 확인 실패. 아래 항목 점검'
      )
    } catch (err) {
      setError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Fold title="새 계정 연결" note="파일 수신 계정을 바꿀 때만 사용. 평소에는 열지 않아도 됨">
      <ol className="list-decimal pl-20 text-body-m leading-[1.9] text-text-sec">
        <li>파일 수신 계정으로 script.google.com 접속, ‘새 프로젝트’ 생성</li>
        <li>
          연결용 코드 붙여넣기 (파일: <code className="font-mono text-small-m">server/scripts/apps-script/drive-relay.gs</code>)
          <span className={`block ${NOTE}`}>코드 맨 위 비밀번호를 32자 이상의 임의 문자로 변경</span>
        </li>
        <li>
          ‘배포’ 에서 ‘새 배포’ 선택
          <span className={`block ${NOTE}`}>종류 ‘웹 앱’, 실행 사용자 ‘나’, 접근 권한 ‘모든 사용자’</span>
        </li>
        <li>
          배포 후 표시되는 <code className="font-mono text-small-m">/exec</code> 주소와 2번의 비밀번호를 아래에 입력
        </li>
      </ol>
      <p className={NOTE}>처음 한 번만 필요한 작업. 어려우면 개발 담당과 함께 진행</p>

      <div className="grid grid-cols-1 gap-x-24 gap-y-20 md:grid-cols-2">
        <Field label="연결 이름" hint="예: 2027 운영위원장 드라이브">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027 운영위원장 드라이브" />
        </Field>
        <Field label="저장 폴더 주소" hint="미입력 가능, 연결 후 지정">
          <Input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
        </Field>
        <Field label="연결 주소" hint="배포 후 표시된 /exec 주소">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" />
        </Field>
        <Field label="연결 비밀번호" hint="코드 맨 위 비밀번호와 동일하게 입력, 저장 후 재표시 없음">
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-12">
        <PrimaryButton onClick={submit} disabled={busy || !ready || !url.trim() || secret.trim().length < 16}>
          <Link2 size={16} aria-hidden="true" />
          {busy ? '확인 중' : '새 계정 연결'}
        </PrimaryButton>
        {!ready && <span className="text-small-m text-state-error">서버 설정 미완료로 연결 불가. 개발 담당에게 문의</span>}
      </div>

      {result && (
        <div className="rounded-sm border border-border-subtle bg-bg-elev p-16">
          <p className={`text-body-m font-bold ${result.ok ? 'text-state-success' : 'text-state-error'}`}>
            {result.ok ? '확인 결과 정상: 파일 수신 가능' : '확인 결과 문제 발견: 아래 항목 점검'}
          </p>
          <dl className="mt-12 grid grid-cols-1 gap-x-32 gap-y-12 md:grid-cols-2">
            {result.account?.email && <Item term="저장 계정">{result.account.email}</Item>}
            {result.root && (
              <Item term="저장 폴더">
                {result.root.name || '이름 없음'} ({result.root.ok ? '쓰기 가능' : result.root.message})
              </Item>
            )}
          </dl>
          {!result.ok && (
            <ul className="mt-12 list-disc pl-20 text-small-m leading-[1.8] text-text-sec">
              <li>배포 접근 권한이 ‘모든 사용자’인지 여부</li>
              <li>코드의 비밀번호와 입력한 비밀번호의 일치 여부</li>
              <li>코드 수정 후 ‘새 배포’ 재생성 여부 (미생성 시 수정 내용 미적용)</li>
            </ul>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Fold>
  )
}

/** 연결이 없거나 이상할 때만 맨 위에 띄우는 알림. 정상일 때는 카드 안의 상태로 충분하다. */
function ProblemNotice({ connections, loading }) {
  if (loading) return null
  const active = connections.filter((c) => c.active)
  if (active.some((c) => c.last_check_ok)) return null
  const none = active.length === 0
  return (
    <div className="flex items-start gap-12 rounded-md border border-state-error/40 bg-state-error/5 p-20">
      <AlertTriangle size={20} className="mt-2 shrink-0 text-state-error" aria-hidden="true" />
      <div>
        <p className="text-body-l-m font-bold text-state-error md:text-body-l-d">{none ? '연결된 드라이브 없음' : '확인 필요'}</p>
        <p className={`mt-4 ${NOTE}`}>
          {none
            ? '맨 아래 ‘새 계정 연결’에서 파일 수신 계정 연결'
            : '마지막 확인에서 정상 결과 없음. 아래 카드의 ‘연결 확인’ 실행'}
        </p>
      </div>
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
      setMessage('구글 계정 연결 완료. 저장 폴더 지정 후 ‘연결 확인’ 실행')
      setParams({}, { replace: true })
      refetch()
    }
    const err = params.get('drive_error')
    if (err) {
      setConnectError(CONNECT_ERROR[err] || `연결 실패 (${err}). 개발 담당에게 문의해 주세요.`)
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

  // 구글 로그인 방식은 서버 설정이 끝난 경우에만 보인다. 안 보이는 것이 정상이다.
  const oauthReady = Boolean(config.oauth_app_ready && config.encryption_ready)

  return (
    <section className="flex min-w-0 flex-col gap-24">
      <PageHead
        title="파일 보관함 (구글 드라이브)"
        desc="참가자 업로드 작품 파일의 저장 위치 확인과 변경"
        actions={
          isOwner && oauthReady ? (
            <div className="flex flex-wrap items-center gap-8">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="연결 이름 (예: 2027 운영위원장 드라이브)"
                aria-label="연결 이름"
                className="md:w-[280px]"
              />
              <PrimaryButton onClick={connect} disabled={busy}>
                <HardDrive size={16} aria-hidden="true" />
                {busy ? '이동 중' : '구글 계정으로 연결'}
              </PrimaryButton>
            </div>
          ) : null
        }
      />

      {message && (
        <p className="flex items-start gap-8 rounded-sm border border-state-success/40 bg-state-success/5 p-16 text-body-m font-semibold text-state-success">
          <Check size={18} className="mt-2 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
      <ErrorText>{connectError}</ErrorText>

      <ProblemNotice connections={connections} loading={loading} />

      {!isOwner && (
        <p className="rounded-sm border border-border-subtle bg-bg-elev p-16 text-small-m text-text-sec">
          계정 연결과 연결 끊기: 대표 관리자 전용. 운영 관리자는 신청 폼 제작 시 연결된 드라이브 선택 가능
        </p>
      )}

      {loading && <p className={NOTE}>연결 상태 확인 중</p>}
      <ErrorText>{error?.message}</ErrorText>

      <div className="flex flex-col gap-24">
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

      <FormLinkGuide />
      <PendingUploads isOwner={isOwner} />

      <Fold title="담당자 교체 절차" note="운영진이 바뀔 때 순서대로 진행">
        <ol className="list-decimal pl-20 text-body-m leading-[1.9] text-text-sec">
          <li>새 담당자의 대표 관리자 계정 로그인</li>
          <li>
            파일 수신 계정 결정
            <span className={`block ${NOTE}`}>기존 폴더 계속 사용 시, 이전 담당자가 폴더를 새 계정에 ‘편집자’ 권한으로 공유</span>
          </li>
          <li>맨 아래 ‘새 계정 연결’ 진행</li>
          <li>
            동작 확인
            <span className={`block ${NOTE}`}>‘연결 확인’ 후 ‘시험 파일 업로드’. 시험 파일은 자동 삭제 없음, 드라이브에서 직접 삭제</span>
          </li>
          <li>신청 폼 설정 확인: 파일 질문의 저장 위치 ‘구글 드라이브’ 선택, ‘예상 저장 경로’ 확인 후 공개</li>
          <li>이전 계정 정리: ‘설정 변경’의 ‘연결 끊기’ (드라이브의 파일은 유지)</li>
        </ol>
      </Fold>

      {isOwner && <AppsScriptConnect ready={Boolean(config.apps_script_ready)} onDone={(msg) => { setMessage(msg); refetch() }} />}
    </section>
  )
}

export default StorageDriveAdmin
