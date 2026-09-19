// ExhibitionAdmin.jsx — 전시회 접수 시스템 관리 (12_BACKEND 5절, admin+)
// 일정(exhibition_settings: submit_open·submit_close·edit_close) 편집 + 접수 현황 요약(건수·시트 바로가기).
// Y3-1(33_PHASE18): 접수 버튼 노출 스위치를 이 화면에서도 직접 조작하고(기존에는 사이트 설정
// 안에만 있었다), 접수 폼이 읽는 과목 목록(1·2학기)을 여기서 관리한다.
// 과목 목록 저장 위치: site_settings.exhibitionSubjects → GET /settings/public에
// settings.exhibitionSubjects · exhibition.subjects 두 경로로 노출된다.

import { useEffect, useState } from 'react'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import SegmentControl from '../../components/common/SegmentControl'
import { exhibitionFullTitle } from '../../data/exhibitionTitle'
import { EXHIBITION_COPY_DEFAULT } from '../../data/exhibitionCopy'
import {
  ErrorText,
  Field,
  GhostButton,
  Input,
  PageHead,
  PrimaryButton,
  Select,
  TextArea,
  Toggle,
  DateInput,
} from '../../components/admin/FormControls'
import { useAuth } from '../../context/AuthContext'

// ISO ↔ datetime-local 변환 (로컬 시간대 기준 편집, 저장 시 ISO)
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null
}

const PANEL =
  'flex flex-col gap-16 rounded-glass border border-glass-line bg-glass-bg p-24 backdrop-blur-glass-mobile'

function ExhibitionAdmin() {
  useTitle('전시회 설정')
  const settings = useApi('/settings/public')
  // 요약 카드는 건수만 쓴다 — 상세 열람은 전용 시트(/admin/exhibition-entries/sheet).
  // total은 서버가 전체 COUNT로 계산하므로 페이지 크기와 무관하다.
  const entries = useApi('/admin/exhibition/entries', { params: { page: 1, pageSize: 1 } })

  const [form, setForm] = useState({ submit_open: '', submit_close: '', edit_close: '' })
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(false)

  // Y3-1: 접수 버튼 노출 + 과목 목록
  const [headerVisible, setHeaderVisible] = useState(true)
  const [buttonMode, setButtonMode] = useState('header')
  // 53: 접수 안내 문구(온보딩·폼). 값이 비면 공개 화면이 기본값으로 떨어진다.
  const [copy, setCopy] = useState(EXHIBITION_COPY_DEFAULT.ko)
  const [copyBusy, setCopyBusy] = useState(false)
  const [copySaved, setCopySaved] = useState(false)
  const [copyError, setCopyError] = useState(null)
  const [subjects, setSubjects] = useState([])
  const [buttonBusy, setButtonBusy] = useState(false)
  const [buttonSaved, setButtonSaved] = useState(false)
  const [buttonError, setButtonError] = useState(null)
  const [subjectBusy, setSubjectBusy] = useState(false)
  const [subjectSaved, setSubjectSaved] = useState(false)
  const [subjectError, setSubjectError] = useState(null)

  // H2-2·H2-4: 회차(ordinal) + 현재 접수 대상 학기. 접수 안내·접수 폼이 이 값을 읽는다.
  const [ordinal, setOrdinal] = useState('')
  const [semester, setSemester] = useState(1)
  const [roundBusy, setRoundBusy] = useState(false)
  const [roundSaved, setRoundSaved] = useState(false)
  const [roundError, setRoundError] = useState(null)

  // 53_DRIVE_STORAGE(전시회 확장): 원본 파일을 보낼 Drive 연결. 연결 목록은 저장소 화면이
  // 관리하고, 여기서는 "이 전시회 접수가 어떤 연결을 쓰는가"만 고른다.
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const driveStatus = useApi('/admin/drive/status')
  const driveSetting = useApi('/admin/exhibition/drive')
  const [driveConnectionId, setDriveConnectionId] = useState('')
  const [driveHydrated, setDriveHydrated] = useState(false)
  const [driveBusy, setDriveBusy] = useState(false)
  const [driveSaved, setDriveSaved] = useState(false)
  const [driveError, setDriveError] = useState(null)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearMessage, setClearMessage] = useState(null)

  useEffect(() => {
    if (driveHydrated || !driveSetting.data) return
    setDriveConnectionId(
      driveSetting.data.connection_id == null ? '' : String(driveSetting.data.connection_id)
    )
    setDriveHydrated(true)
  }, [driveHydrated, driveSetting.data])

  const saveDrive = async (e) => {
    e.preventDefault()
    setDriveBusy(true)
    setDriveError(null)
    try {
      await api.put('/admin/settings', {
        exhibition: {
          drive_connection_id: driveConnectionId === '' ? null : Number(driveConnectionId),
        },
      })
      setDriveSaved(true)
      driveSetting.refetch()
    } catch (err) {
      setDriveError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setDriveBusy(false)
    }
  }

  // 테스트 접수 초기화 — owner 전용. Drive 안의 파일은 지우지 않는다(업로드 기록도 남는다).
  const clearEntries = async () => {
    if (!window.confirm('접수 내역을 전부 삭제합니다. Drive에 올라간 파일은 지워지지 않습니다. 계속할까요?')) return
    setClearBusy(true)
    setClearMessage(null)
    try {
      const res = await api.del('/admin/exhibition/entries')
      setClearMessage(`접수 ${res.deleted}건을 삭제했습니다. Drive 파일은 그대로 있습니다.`)
      entries.refetch()
    } catch (err) {
      setClearMessage(err.message)
    } finally {
      setClearBusy(false)
    }
  }

  const exhibition = settings.data?.exhibition

  useEffect(() => {
    if (hydrated || !settings.data) return
    if (exhibition) {
      setForm({
        submit_open: toLocalInput(exhibition.submit_open),
        submit_close: toLocalInput(exhibition.submit_close),
        edit_close: toLocalInput(exhibition.edit_close),
      })
      setHeaderVisible(exhibition.header_visible !== false)
      setButtonMode(exhibition.button_mode || 'header')
    }
    const remote = settings.data.settings?.exhibitionSubjects
    // 53: 저장된 안내 문구가 있으면 채우고, 없으면 기본값(코드 원문) 그대로 둔다
    const savedCopy = settings.data?.settings?.exhibitionCopy?.ko
    if (savedCopy) setCopy({ ...EXHIBITION_COPY_DEFAULT.ko, ...savedCopy })
    setSubjects(
      Array.isArray(remote)
        ? remote.map((s) => ({ name: s?.name || '', semester: Number(s?.semester) === 2 ? 2 : 1 }))
        : []
    )
    const remoteOrdinal = Number(settings.data.settings?.exhibitionOrdinal)
    setOrdinal(Number.isInteger(remoteOrdinal) && remoteOrdinal > 0 ? String(remoteOrdinal) : '')
    setSemester(Number(settings.data.settings?.exhibitionSemester) === 2 ? 2 : 1)
    setHydrated(true)
  }, [hydrated, settings.data, exhibition])

  const addSubject = (semester) => {
    setSubjectSaved(false)
    setSubjects((prev) => [...prev, { name: '', semester }])
  }
  const setSubjectName = (index, name) => {
    setSubjectSaved(false)
    setSubjects((prev) => prev.map((s, i) => (i === index ? { ...s, name } : s)))
  }
  const removeSubject = (index) => {
    setSubjectSaved(false)
    setSubjects((prev) => prev.filter((_, i) => i !== index))
  }

  // H2-2·H2-4: 회차·학기 저장. 회차를 비우면 null로 지워 회차 없는 문구로 되돌린다.
  const saveRound = async (e) => {
    e.preventDefault()
    const n = Number(ordinal)
    if (ordinal.trim() !== '' && !(Number.isInteger(n) && n > 0)) {
      setRoundError('회차는 1 이상의 정수로 입력해 주세요')
      return
    }
    setRoundBusy(true)
    setRoundError(null)
    try {
      await api.put('/admin/settings', {
        settings: {
          exhibitionOrdinal: ordinal.trim() === '' ? null : n,
          exhibitionSemester: semester,
        },
      })
      setRoundSaved(true)
      settings.refetch()
    } catch (err) {
      setRoundError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setRoundBusy(false)
    }
  }

  const saveButton = async (e) => {
    e.preventDefault()
    setButtonBusy(true)
    setButtonError(null)
    try {
      await api.put('/admin/settings', {
        exhibition: { header_visible: headerVisible, button_mode: buttonMode },
      })
      setButtonSaved(true)
      settings.refetch()
    } catch (err) {
      setButtonError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setButtonBusy(false)
    }
  }

  // 줄 단위 입력을 배열로, 배열을 줄 단위 문자열로 — 절차·유의사항은 항목 수가 유동적이다
  const linesToArray = (text) =>
    String(text ?? '')
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v !== '')
  const stepsToText = (steps) =>
    (steps ?? []).map((st) => `${st.title} | ${st.desc}`).join('\n')
  const textToSteps = (text) =>
    linesToArray(text).map((line) => {
      const [title, ...rest] = line.split('|')
      return { title: title.trim(), desc: rest.join('|').trim() }
    })

  const saveCopy = async (e) => {
    e.preventDefault()
    setCopyBusy(true)
    setCopyError(null)
    try {
      await api.put('/admin/settings', { settings: { exhibitionCopy: { ko: copy } } })
      setCopySaved(true)
      settings.refetch()
    } catch (err) {
      setCopyError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setCopyBusy(false)
    }
  }

  const saveSubjects = async (e) => {
    e.preventDefault()
    setSubjectBusy(true)
    setSubjectError(null)
    try {
      const next = subjects
        .map((s) => ({ name: s.name.trim(), semester: s.semester }))
        .filter((s) => s.name !== '')
      await api.put('/admin/settings', { settings: { exhibitionSubjects: next } })
      setSubjects(next)
      setSubjectSaved(true)
      settings.refetch()
    } catch (err) {
      setSubjectError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setSubjectBusy(false)
    }
  }

  const set = (key) => (e) => {
    setSaved(false)
    setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setSaveError(null)
    try {
      await api.put('/admin/settings', {
        exhibition: {
          submit_open: fromLocalInput(form.submit_open),
          submit_close: fromLocalInput(form.submit_close),
          edit_close: fromLocalInput(form.edit_close),
        },
      })
      setSaved(true)
      settings.refetch()
    } catch (err) {
      setSaveError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  const total = entries.data?.total ?? 0

  return (
    <section className="flex flex-col gap-32">
      <PageHead
        title="전시회 설정"
        desc="접수 일정과 접수 현황을 관리합니다. 기간 검증은 서버 기준입니다."
      />

      {/* 일정 편집 */}
      <form
        onSubmit={save}
        className="flex flex-col gap-16 rounded-glass border border-glass-line bg-glass-bg p-24 backdrop-blur-glass-mobile"
      >
        <div className="flex flex-wrap items-center gap-12">
          <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">접수 일정</h3>
          {exhibition && (
            <span className="inline-flex items-center rounded-sm border border-glass-line bg-glass-bg px-12 py-4 font-mono text-caption-m text-text-meta">
              {exhibition.is_submit_period
                ? '접수 기간'
                : exhibition.is_edit_period
                  ? '수정 기간'
                  : '기간 외'}
            </span>
          )}
        </div>
        {settings.error && <ErrorText>{settings.error.message}</ErrorText>}
        <div className="grid grid-cols-1 gap-16 md:grid-cols-3">
          <Field label="접수 시작">
            <DateInput withTime value={form.submit_open} onChange={set('submit_open')} />
          </Field>
          <Field label="접수 마감" hint="이후 신규 접수 차단">
            <DateInput withTime value={form.submit_close} onChange={set('submit_close')} />
          </Field>
          <Field label="수정 마감" hint="이후 신규·수정 전면 차단">
            <DateInput withTime value={form.edit_close} onChange={set('edit_close')} />
          </Field>
        </div>
        <ErrorText>{saveError}</ErrorText>
        {saved && <p className="font-mono text-caption-m text-text-meta">저장 완료</p>}
        <div>
          <PrimaryButton type="submit" disabled={busy || !hydrated}>
            {busy ? '저장 중' : '일정 저장'}
          </PrimaryButton>
        </div>
      </form>

      {/* 접수 현황 요약 — 건수 + 전용 시트 바로가기. 사람별 상세는 시트에서 본다 */}
      <div className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-16">
          <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">접수 현황</h3>
          {/* Y3-2: 전용 관리 시트 — 새 탭으로 전체화면 열람 */}
          <a
            href="/admin/exhibition-entries/sheet"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border border-border-subtle px-24 text-body-m font-semibold text-text-pri transition duration-fast ease-out hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <ExternalLink size={16} aria-hidden="true" />
            접수 현황 바로가기
          </a>
        </div>
        {entries.error && <ErrorText>{entries.error.message}</ErrorText>}
        <p className="font-mono text-caption-m text-text-meta">
          {entries.loading ? '불러오는 중' : `현재 접수 ${total}건`}
        </p>
        {isOwner && (
          <div className="flex flex-wrap items-center gap-12 border-t border-glass-line pt-16">
            <GhostButton onClick={clearEntries} disabled={clearBusy || total === 0}>
              <Trash2 size={16} aria-hidden="true" />
              {clearBusy ? '삭제 중' : '접수 내역 전체 삭제'}
            </GhostButton>
            <span className="text-caption-m text-text-meta">
              테스트 접수를 정리할 때 씁니다. Drive에 올라간 파일은 지워지지 않습니다.
            </span>
          </div>
        )}
        {clearMessage && (
          <p className="font-mono text-caption-m text-text-meta">{clearMessage}</p>
        )}
      </div>

      {/* 53_DRIVE_STORAGE(전시회 확장): 접수 원본 파일이 저장될 Google Drive 연결 */}
      <form onSubmit={saveDrive} className={PANEL}>
        <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">원본 파일 저장소</h3>
        <p className="text-small-m text-text-sec">
          접수자가 올린 작품 원본이 저장될 Google Drive 계정입니다. 폴더는 선택한 연결의 루트 아래
          <span className="font-mono"> 과목명 / 원본 </span>
          순서로 자동 생성되고, 원본은 변환 없이 그대로 보관됩니다. 연결 추가·점검은
          <a href="/admin/storage/drive" className="underline underline-offset-4"> 저장소 · Google Drive </a>
          화면에서 합니다.
        </p>
        <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
          <Field
            label="Drive 연결"
            hint={
              driveSetting.data?.connection
                ? `현재: ${driveSetting.data.connection.root_folder_name || driveSetting.data.connection.root_folder_id || '루트 폴더 미지정'}`
                : '연결을 고르지 않으면 접수자가 원본 파일을 올릴 수 없습니다'
            }
          >
            <Select
              value={driveConnectionId}
              onChange={(e) => {
                setDriveSaved(false)
                setDriveConnectionId(e.target.value)
              }}
              placeholder="연결 선택 안 함"
              options={(driveStatus.data?.connections ?? [])
                .filter((c) => c.active && c.has_token)
                .map((c) => ({
                  value: String(c.id),
                  label: `${c.label}${c.account_email ? ` · ${c.account_email}` : ''}`,
                }))}
            />
          </Field>
        </div>
        <ErrorText>{driveError}</ErrorText>
        {driveSaved && <p className="font-mono text-caption-m text-text-meta">저장 완료</p>}
        <div>
          <PrimaryButton type="submit" disabled={driveBusy || !driveHydrated}>
            {driveBusy ? '저장 중' : '저장소 저장'}
          </PrimaryButton>
        </div>
      </form>

      {/* H2-2·H2-4: 회차·접수 대상 학기 — 접수 안내 제목과 접수 폼 과목 기본 학기가 이 값을 읽는다 */}
      <form onSubmit={saveRound} className={PANEL}>
        <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">회차·접수 대상 학기</h3>
        <p className="text-small-m text-text-sec">
          회차를 지정하면 접수 안내·접수 폼 제목이 「제N회 디지털인문예술전공 프로젝트 전시회」로
          표시됩니다. 접수 대상 학기의 과목이 접수 폼에 기본으로 나타납니다.
        </p>
        <div className="flex flex-wrap items-start gap-24">
          <div className="w-160">
            <Field
              label="회차"
              hint={
                exhibitionFullTitle(ordinal) ||
                '비워 두면 회차 없이 「디지털인문예술전공 프로젝트 전시회」로 표시됩니다'
              }
            >
              <Input
                value={ordinal}
                onChange={(e) => {
                  setRoundSaved(false)
                  setOrdinal(e.target.value.replace(/\D/g, ''))
                }}
                inputMode="numeric"
                placeholder="18"
                aria-label="전시회 회차"
              />
            </Field>
          </div>
          <div className="flex min-w-0 flex-col gap-8">
            <span className="font-mono text-label-m uppercase tracking-label text-text-meta">
              접수 대상 학기
            </span>
            <SegmentControl
              mode="segment"
              options={[
                { value: 1, label: '1학기' },
                { value: 2, label: '2학기' },
              ]}
              value={semester}
              onChange={(v) => {
                setRoundSaved(false)
                setSemester(v)
              }}
              aria-label="현재 접수 대상 학기"
            />
          </div>
        </div>
        <ErrorText>{roundError}</ErrorText>
        {roundSaved && <p className="font-mono text-caption-m text-text-meta">저장 완료</p>}
        <div>
          <PrimaryButton type="submit" disabled={roundBusy || !hydrated}>
            {roundBusy ? '저장 중' : '회차·학기 저장'}
          </PrimaryButton>
        </div>
      </form>

      {/* 53: 접수 안내 문구 — 온보딩·접수 폼이 이 값을 읽는다. 비우면 기본 문구로 표시된다 */}
      <form onSubmit={saveCopy} className={PANEL}>
        <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">접수 안내 문구</h3>
        <p className="text-small-m text-text-sec">
          공개 접수 페이지의 온보딩과 접수 폼에 그대로 나갑니다. 비워 두면 기본 문구가 표시됩니다.
        </p>
        <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
          <Field label="온보딩 라벨" hint="제목 위 작은 문구">
            <Input
              value={copy.onboardingEyebrow}
              onChange={(e) => setCopy((p) => ({ ...p, onboardingEyebrow: e.target.value }))}
            />
          </Field>
          <Field label="시작 버튼 라벨">
            <Input
              value={copy.startLabel}
              onChange={(e) => setCopy((p) => ({ ...p, startLabel: e.target.value }))}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="온보딩 안내 본문" hint="접수 대상·범위 등. 줄바꿈이 그대로 보입니다">
              <TextArea
                rows={3}
                value={copy.onboardingLead}
                onChange={(e) => setCopy((p) => ({ ...p, onboardingLead: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="절차 패널 제목">
            <Input
              value={copy.stepsTitle}
              onChange={(e) => setCopy((p) => ({ ...p, stepsTitle: e.target.value }))}
            />
          </Field>
          <Field label="유의사항 패널 제목">
            <Input
              value={copy.notesTitle}
              onChange={(e) => setCopy((p) => ({ ...p, notesTitle: e.target.value }))}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="접수 절차" hint="한 줄에 한 단계. 형식은 제목 | 설명. 번호는 자동으로 붙습니다">
              <TextArea
                rows={4}
                value={stepsToText(copy.steps)}
                onChange={(e) => setCopy((p) => ({ ...p, steps: textToSteps(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="유의사항" hint="한 줄에 한 항목">
              <TextArea
                rows={6}
                value={(copy.notes ?? []).join('\n')}
                onChange={(e) => setCopy((p) => ({ ...p, notes: linesToArray(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="작품명 안내 문구" hint="접수 폼의 작품명 입력 아래에 표시됩니다">
              <Input
                value={copy.workTitleHint}
                onChange={(e) => setCopy((p) => ({ ...p, workTitleHint: e.target.value }))}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="작품 설명 안내 문구" hint="작품 설명 입력칸의 placeholder">
              <Input
                value={copy.workDescPlaceholder}
                onChange={(e) => setCopy((p) => ({ ...p, workDescPlaceholder: e.target.value }))}
              />
            </Field>
          </div>
        </div>
        <ErrorText>{copyError}</ErrorText>
        {copySaved && <p className="font-mono text-caption-m text-text-meta">저장 완료</p>}
        <div>
          <PrimaryButton type="submit" disabled={copyBusy}>
            {copyBusy ? '저장 중' : '안내 문구 저장'}
          </PrimaryButton>
        </div>
      </form>

      {/* Y3-1: 과목 관리 — 접수 폼의 과목 선택지가 이 목록을 읽는다 */}
      <form onSubmit={saveSubjects} className={PANEL}>
        <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">과목 관리</h3>
        <p className="text-small-m text-text-sec">
          학기별 과목 목록입니다. 접수 폼의 과목 선택지로 그대로 쓰입니다. 예: UX디자인,
          디지털디자인1
        </p>
        <div className="grid grid-cols-1 gap-24 md:grid-cols-2">
          {[1, 2].map((semester) => {
            const rows = subjects
              .map((s, index) => ({ s, index }))
              .filter(({ s }) => s.semester === semester)
            return (
              <div key={semester} className="flex flex-col gap-12">
                <p className="font-mono text-label-m uppercase tracking-label text-text-meta">
                  {semester}학기 과목
                </p>
                {rows.length === 0 && (
                  <p className="font-mono text-caption-m text-text-meta">등록된 과목이 없습니다</p>
                )}
                {rows.map(({ s, index }) => (
                  <div key={index} className="flex min-w-0 items-center gap-8">
                    <Input
                      value={s.name}
                      onChange={(e) => setSubjectName(index, e.target.value)}
                      placeholder="과목명"
                      aria-label={`${semester}학기 과목명`}
                    />
                    <button
                      type="button"
                      onClick={() => removeSubject(index)}
                      aria-label="과목 삭제"
                      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-32 md:w-32"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <div>
                  <GhostButton onClick={() => addSubject(semester)}>
                    <Plus size={16} aria-hidden="true" />
                    과목 추가
                  </GhostButton>
                </div>
              </div>
            )
          })}
        </div>
        <ErrorText>{subjectError}</ErrorText>
        {subjectSaved && <p className="font-mono text-caption-m text-text-meta">저장 완료</p>}
        <div>
          <PrimaryButton type="submit" disabled={subjectBusy || !hydrated}>
            {subjectBusy ? '저장 중' : '과목 저장'}
          </PrimaryButton>
        </div>
      </form>

      {/* Y3-1: 접수 버튼 노출 — 히어로 편집이 아니라 이 화면에서 바로 켜고 끈다 */}
      <form onSubmit={saveButton} className={PANEL}>
        <h3 className="text-h3-m font-bold text-text-pri md:text-h3-d">접수 버튼 노출</h3>
        <p className="text-small-m text-text-sec">
          스위치를 켜면 전시회 페이지와 헤더에 접수 버튼이 노출됩니다. 기간 검증은 제출 시점에
          서버가 적용합니다.
        </p>
        <div className="flex flex-wrap items-start gap-24">
          <Field label="노출 허용">
            <Toggle
              checked={headerVisible}
              onChange={(v) => {
                setButtonSaved(false)
                setHeaderVisible(v)
              }}
              label="접수 버튼 노출 허용"
            />
          </Field>
          <div className="flex min-w-0 flex-col gap-8">
            <span className="font-mono text-label-m uppercase tracking-label text-text-meta">
              위치
            </span>
            {/* 옆 컨트롤과 같은 w-160 폭. flex-1로 두 옵션 버튼 폭을 서로 같게 맞춘다 */}
            <SegmentControl
              mode="segment"
              options={[
                { value: 'header', label: '헤더' },
                { value: 'floating', label: '플로팅' },
              ]}
              value={buttonMode}
              onChange={(v) => {
                setButtonSaved(false)
                setButtonMode(v)
              }}
              aria-label="접수 버튼 위치"
              className="w-160 [&>button]:flex-1"
            />
          </div>
        </div>
        <ErrorText>{buttonError}</ErrorText>
        {buttonSaved && <p className="font-mono text-caption-m text-text-meta">저장 완료</p>}
        <div>
          <PrimaryButton type="submit" disabled={buttonBusy || !hydrated}>
            {buttonBusy ? '저장 중' : '노출 설정 저장'}
          </PrimaryButton>
        </div>
      </form>
    </section>
  )
}

export default ExhibitionAdmin
