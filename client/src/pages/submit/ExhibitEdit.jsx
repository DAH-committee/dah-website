// /submit/edit — 전시회 접수 확인과 수정, /submit/files — 작품 제출(원본 파일). 같은 화면을 mode로 나눈다.
// 수정(info)은 수정 마감까지 언제나 가능하고, 작품 파일(files)은 작품 제출 기간에만 올린다.
// /submit/edit — 전시회 접수 확인과 수정 (12_BACKEND 5절 · 41_AUTH_CONTRACT)
// 구글 로그인 → GET /submit/exhibition/mine(본인 접수 목록 + 서버 시계 기준 수정 마감 판정)
// → 1건이면 바로 수정 화면, 여러 건이면 선택 → PUT /submit/exhibition → 완료.
//
// 신원은 로그인한 구글 계정이다. 이메일+비밀번호 조회(lookup)는 폐기했다.
// 수정 마감 검증의 최종 권한은 서버다. 클라이언트 시계는 신뢰하지 않으며, mine이 돌려준
// can_edit로 UI를 잠그고 실제 저장 차단은 PUT의 403이 담당한다.
// readonly: 참가 유형·과목·이메일 — 서버가 변경을 무시하므로 클라도 자물쇠로 표시만.
import { useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import Button from '../../components/common/Button'
import {
  AccountStrip,
  HeaderCard,
  LoginCard,
  LongInput,
  MiniField,
  NoticeCard,
  PrimarySubmit,
  QuestionCard,
  ReadOnlyRow,
  RespondentPage,
  ScheduleInline,
  ShortInput,
  SubmitRow,
  TextButton,
} from '../../components/forms/respondent'
import { api, useApi } from '../../hooks/useApi'
import { exhibitionCopy } from '../../data/exhibitionCopy'
import { useTitle } from '../../hooks/useTitle'
import { usePublicAuth } from '../../hooks/usePublicAuth'
import { MemberRows, OriginalFilesField, PhoneInput } from './exhibitFormKit'
import { DESC_MAX, ENTRY_TYPE_LABEL, FIELD_IDS, collectFormErrors, formatKst, scrollToFirstError, submitErrorMessage } from './exhibitFormShared'

const EMPTY_MEMBER = { name: '', studentNo: '', major: '' }

// 접수 항목 → 수정 폼 state (수정 가능 항목만)
function toForm(entry) {
  const f = entry.fields ?? {}
  return {
    name: f.name ?? '',
    studentNo: f.student_no ?? '',
    major: f.major ?? '',
    teamName: f.team_name ?? '',
    phone: f.phone ?? '',
    workTitle: f.work_title ?? '',
    workDesc: f.work_desc ?? '',
  }
}

// 53_DRIVE_STORAGE(전시회 확장): 저장된 원본 파일 목록. 없으면 빈 배열도 없이 보존된다.
function toOriginalFiles(entry) {
  const list = entry.fields?.original_files
  return Array.isArray(list)
    ? list.filter((f) => f && typeof f.url === 'string').map((f) => ({ url: f.url, name: f.name || '' }))
    : []
}

// 접수 항목 → 팀원 행. 최소 1행 유지.
function toMembers(entry) {
  const loaded = Array.isArray(entry.fields?.members)
    ? entry.fields.members.map((m) => ({
        name: m?.name ?? '',
        studentNo: m?.student_no ?? '',
        major: m?.major ?? '',
      }))
    : []
  return loaded.length ? loaded : [{ ...EMPTY_MEMBER }]
}

/**
 * 접수 1건 수정 폼. 목록은 로그인 후 서버에서 도착하므로 초기값을 effect로 맞추지 않고
 * 호출부에서 entry.id를 key로 주어 항목이 바뀔 때 새 인스턴스가 뜨게 한다.
 * @param {object} entry     mine 응답의 접수 항목
 * @param {boolean} canEdit  서버 시계 기준 수정 가능 여부
 * @param {string} email     로그인 계정 이메일(항목에 이메일이 없을 때 표시용)
 * @param {boolean} showBack 목록으로 돌아가는 동선 노출 여부(접수 2건 이상)
 */
function EntryForm({ entry, canEdit, canSubmitFiles, mode, exhibition, email, copy, showBack, onBack, onSaved }) {
  const isFilesMode = mode === 'files'
  // 이 화면에서 저장할 수 있는지: 수정은 수정 기간, 작품 제출은 작품 제출 기간
  const canSave = isFilesMode ? canSubmitFiles : canEdit
  const [form, setForm] = useState(() => toForm(entry))
  const [members, setMembers] = useState(() => toMembers(entry))
  const [originalFiles, setOriginalFiles] = useState(() => toOriginalFiles(entry))
  const [filesUploading, setFilesUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (key) => (event) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const setValue = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }))
  const isTeam = entry.entry_type === 'team'
  // 저장 버튼은 항상 눌린다. 누르면 빠진 칸을 표시하고 가장 위 칸으로 올라간다(구글 폼 방식).
  const [attempted, setAttempted] = useState(false)
  const allErrors = collectFormErrors({
    isTeam,
    form,
    members,
    courseRequired: false,
    filesUploading,
    fileCount: originalFiles.length,
    checkInfo: !isFilesMode,
    checkFiles: isFilesMode,
  })
  const fieldErrors = attempted ? allErrors : {}

  const handleSave = async (event) => {
    event.preventDefault()
    if (busy || !canSave) return
    if (Object.keys(allErrors).length > 0) {
      setAttempted(true)
      setError(null)
      scrollToFirstError(allErrors)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (isFilesMode) {
        // 작품 제출: 원본 파일 목록만 보낸다
        await api.put('/submit/exhibition', { id: entry.id, entry_type: entry.entry_type, fields: { original_files: originalFiles } })
        onSaved()
        return
      }
      const common = {
        // 과목은 readonly — 서버가 무시하지만 원본 값을 그대로 되돌려 보낸다
        course: entry.fields?.course ?? '',
        phone: form.phone.trim(),
        work_title: form.workTitle.trim(),
        work_desc: form.workDesc.trim(),
      }
      const fields = isTeam
        ? {
            team_name: form.teamName.trim(),
            members: members.map((m) => ({
              name: m.name.trim(),
              student_no: m.studentNo.trim(),
              major: m.major.trim(),
            })),
            ...common,
          }
        : {
            name: form.name.trim(),
            student_no: form.studentNo.trim(),
            major: form.major.trim(),
            ...common,
          }
      // 소유 검증은 서버가 로그인 계정으로 한다 — 본문에 신원 정보를 싣지 않는다
      await api.put('/submit/exhibition', {
        id: entry.id,
        entry_type: entry.entry_type,
        fields,
      })
      onSaved()
    } catch (err) {
      setError(submitErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSave} className="flex min-w-0 flex-col gap-12">
      <div className="flex flex-wrap items-center justify-between gap-12 px-4">
        <p className="text-small-m font-semibold text-text-pri">{isFilesMode ? '작품 제출' : '접수 내용 수정'}</p>
        {showBack && <TextButton onClick={onBack}>목록으로</TextButton>}
      </div>

      {!isFilesMode && !canEdit && (
        <p role="alert" className="px-4 text-small-m leading-relaxed text-state-error">
          수정 마감이 지나 저장할 수 없습니다. 접수 내용 확인만 가능합니다
          {formatKst(exhibition?.edit_close) ? ` (수정 마감: ${formatKst(exhibition?.edit_close)})` : ''}.
        </p>
      )}
      {isFilesMode && !canSubmitFiles && (
        <p role="alert" className="px-4 text-small-m leading-relaxed text-state-error">
          {exhibition?.files_open && new Date() < new Date(exhibition.files_open)
            ? `작품 제출은 ${formatKst(exhibition.files_open)}부터 가능합니다.`
            : `작품 제출 기간이 끝났습니다${formatKst(exhibition?.edit_close) ? ` (마감: ${formatKst(exhibition?.edit_close)})` : ''}.`}
        </p>
      )}

      <QuestionCard>
        <dl className="flex flex-col gap-8">
          <ReadOnlyRow label="참가 유형" value={ENTRY_TYPE_LABEL[entry.entry_type] ?? entry.entry_type} />
          <ReadOnlyRow label="이메일" value={entry.email ?? email} />
          <ReadOnlyRow label="과목" value={entry.fields?.course} />
          {isFilesMode && <ReadOnlyRow label="작품명" value={entry.fields?.work_title} />}
        </dl>
      </QuestionCard>

      {!isFilesMode && (
      <QuestionCard id={FIELD_IDS.applicant} label="신청자" required error={fieldErrors.applicant}>
        {isTeam ? (
          <>
            <MiniField label="팀명" required>
              <ShortInput required value={form.teamName} onChange={set('teamName')} />
            </MiniField>
            <div className="flex flex-col gap-8">
              <span className="text-small-m text-text-meta">
                팀원 (대표자 포함) <span className="text-state-error">*</span>
              </span>
              <MemberRows members={members} onChange={setMembers} />
              <div>
                <TextButton onClick={() => setMembers((prev) => [...prev, { ...EMPTY_MEMBER }])}>
                  <span className="inline-flex items-center gap-8 text-purple-primary">
                    <Plus size={16} aria-hidden="true" />
                    팀원 추가
                  </span>
                </TextButton>
              </div>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-16 sm:grid-cols-3">
            <MiniField label="이름" required>
              <ShortInput required value={form.name} onChange={set('name')} />
            </MiniField>
            <MiniField label="학번" required>
              <ShortInput required value={form.studentNo} onChange={set('studentNo')} />
            </MiniField>
            <MiniField label="전공" required>
              <ShortInput required value={form.major} onChange={set('major')} />
            </MiniField>
          </div>
        )}
        <MiniField label="연락처" required>
          <PhoneInput value={form.phone} onChange={setValue('phone')} className="max-w-[240px]" />
        </MiniField>
      </QuestionCard>
      )}

      {isFilesMode && (
      <OriginalFilesField
        files={originalFiles}
        onChange={setOriginalFiles}
        course={entry.fields?.course}
        onUploadingChange={setFilesUploading}
        disabled={!canSubmitFiles}
        id={FIELD_IDS.files}
        fieldError={fieldErrors.files}
      />
      )}

      {!isFilesMode && (
      <QuestionCard id={FIELD_IDS.work} label="작품 정보" required error={fieldErrors.work}>
        <MiniField label="작품명" required>
          <ShortInput required value={form.workTitle} onChange={set('workTitle')} />
          {copy.workTitleHint && <span className="text-caption-m text-text-meta">{copy.workTitleHint}</span>}
        </MiniField>
        <MiniField label={`작품 설명 (최대 ${DESC_MAX}자)`} required>
          <LongInput required maxLength={DESC_MAX} value={form.workDesc} onChange={set('workDesc')} />
          <span aria-live="polite" className="text-right text-caption-m text-text-meta">
            {form.workDesc.length}/{DESC_MAX}
          </span>
        </MiniField>
      </QuestionCard>
      )}

      {error && (
        <p role="alert" className="px-4 text-small-m text-state-error">
          {error}
        </p>
      )}
      <SubmitRow>
        <PrimarySubmit busy={busy} disabled={!canSave}>
          {busy ? '저장 중' : isFilesMode ? '작품 제출' : '수정 저장'}
        </PrimarySubmit>
      </SubmitRow>
    </form>
  )
}

function ExhibitEdit({ mode = 'info' }) {
  const isFilesMode = mode === 'files'
  useTitle(isFilesMode ? '전시회 작품 제출' : '전시회 접수 확인과 수정')
  const { data: settingsRes, loading: settingsLoading } = useApi('/settings/public')
  const exhibition = settingsRes?.exhibition ?? null
  // 53: 작품명 안내 등 편집 가능한 문구는 접수 폼과 같은 DB 값을 읽는다
  const copy = exhibitionCopy(settingsRes?.settings?.exhibitionCopy, 'ko')
  // 공개 제출자 신원 — 스태프 로그인(useAuth)과 다른 신원 클래스다(41_AUTH_CONTRACT)
  const { user, loading: authLoading, logout } = usePublicAuth()
  // 본인 접수 목록. 비로그인 상태에서는 조회하지 않는다(path null)
  const {
    data: mineRes,
    loading: mineLoading,
    error: mineError,
  } = useApi(user ? '/submit/exhibition/mine' : null)

  const [selectedId, setSelectedId] = useState(null)
  const [done, setDone] = useState(false)

  const entries = Array.isArray(mineRes?.entries) ? mineRes.entries : []
  // 서버 시계 기준 수정 가능 여부 — mine 응답으로만 판단한다(클라 계산 금지)
  const canEdit = mineRes?.can_edit !== false
  const canSubmitFiles = mineRes?.can_submit_files === true
  // 접수가 1건이면 목록 단계를 건너뛰고 바로 수정 화면. 선택은 파생값이라 effect가 필요 없다.
  const selected =
    entries.find((entry) => entry.id === selectedId) ??
    (entries.length === 1 ? entries[0] : null)

  const schedule = [
    { label: '접수 시작', value: formatKst(exhibition?.submit_open) },
    { label: '접수 마감', value: formatKst(exhibition?.submit_close) },
    { label: '작품 제출 시작', value: formatKst(exhibition?.files_open) },
    { label: '수정과 작품 제출 마감', value: formatKst(exhibition?.edit_close) },
  ]

  return (
    <RespondentPage>
      <HeaderCard title={isFilesMode ? '작품 제출' : '접수 내역 확인과 수정'}>
        <ScheduleInline rows={schedule} />
      </HeaderCard>

      {(settingsLoading || authLoading) && (
        <p className="px-4 text-small-m text-text-meta" aria-live="polite">
          {settingsLoading ? '수정 가능 기간 확인 중' : '로그인 상태 확인 중'}
        </p>
      )}

      {/* 41: 로그인 전환은 제목 카드를 그대로 둔 채 이 블록만 교체되며 .page-fade로 이어진다 */}
      {!settingsLoading && !authLoading && !user && (
        <div key="guest" className="page-fade min-w-0">
          <LoginCard
            title="구글 로그인 후 확인"
            description="접수에 사용한 구글 계정으로 로그인하면 본인 접수 내역을 불러와 수정 마감 전까지 고칠 수 있습니다."
          >
            <Button variant="ghost" href="/submit">
              새로 접수하기
            </Button>
          </LoginCard>
        </div>
      )}

      {!settingsLoading && !authLoading && user && (
        <div key="account" className="page-fade flex min-w-0 flex-col gap-12">
          <AccountStrip user={user} onLogout={logout} />

          {done ? (
            <NoticeCard
              title={isFilesMode ? '작품 제출 완료' : '수정 완료'}
              actions={
                <>
                  <Button variant="secondary" href="/programs/exhibitions">
                    전시회 페이지로
                  </Button>
                  <Button variant="secondary" href="/">
                    홈으로 이동
                  </Button>
                </>
              }
            >
              {isFilesMode ? '작품 파일이 제출되었습니다.' : '접수 내용이 수정되었습니다.'}
              {formatKst(exhibition?.edit_close) ? ` ${isFilesMode ? '파일은' : '수정은'} ${formatKst(exhibition?.edit_close)}까지 바꿀 수 있습니다.` : ''}
            </NoticeCard>
          ) : mineLoading ? (
            <p className="px-4 text-small-m text-text-meta" aria-live="polite">
              접수 내역 불러오는 중
            </p>
          ) : mineError ? (
            <p role="alert" className="px-4 text-small-m text-state-error">
              {submitErrorMessage(mineError)}
            </p>
          ) : entries.length === 0 ? (
            <NoticeCard
              title="접수 내역 없음"
              actions={
                <Button variant="secondary" href="/submit">
                  새로 접수
                </Button>
              }
            >
              이 계정으로 등록된 접수 내역이 없습니다.
            </NoticeCard>
          ) : selected ? (
            <EntryForm
              copy={copy}
              key={selected.id}
              entry={selected}
              canEdit={canEdit}
              canSubmitFiles={canSubmitFiles}
              mode={mode}
              exhibition={exhibition}
              email={user.email}
              showBack={entries.length > 1}
              onBack={() => setSelectedId(null)}
              onSaved={() => setDone(true)}
            />
          ) : (
            <div className="flex flex-col gap-12">
              <p className="px-4 text-small-m font-semibold text-text-pri">접수 목록</p>
              <ul className="flex flex-col gap-12">
                {entries.map((entry) => (
                  <li key={entry.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(entry.id)}
                      className="flex w-full cursor-pointer items-center justify-between gap-16 rounded-md border border-border-subtle bg-bg-panel p-20 text-left transition-colors duration-fast ease-out hover:border-border-strong"
                    >
                      <span className="flex min-w-0 flex-col gap-4">
                        <span className="truncate text-body-m font-medium text-text-pri">{entry.fields?.work_title || '(작품명 미입력)'}</span>
                        <span className="text-small-m text-text-meta">
                          {[ENTRY_TYPE_LABEL[entry.entry_type] ?? entry.entry_type, entry.fields?.course, entry.created_at ? String(entry.created_at).slice(0, 10) : '']
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-text-meta" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </RespondentPage>
  )
}

export default ExhibitEdit
