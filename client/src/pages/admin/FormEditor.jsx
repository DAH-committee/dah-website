// FormEditor.jsx: 신청 폼 편집기 (39_FORM_BUILDER P1-3)
// 구글 폼과 같은 구조: 위쪽 탭(질문 / 응답 / 설정), 질문은 선택한 카드 1장만 펼침,
// 질문 카드 아래 줄에 복제, 삭제, 필수, 더보기. 비개발자가 설명 없이 쓸 수 있는 말로 쓴다.
//
// 폼 내용은 전부 DB(custom_forms)에 있다. 새 폼을 만들 때 코드를 고치지 않아도 되게 하는 것이
// 이 화면의 목적이다. 저장 계약은 서버(routes/forms.js)의 PUT/POST /admin/forms.
//
// 공개 토글은 화면 상태만 바꾼다. 저장 버튼을 눌러야 반영된다(P1-3). 저장하지 않은 변경이 있으면 위쪽에 알린다.
// 네이티브 select, date, radio, checkbox 금지. 전부 공용 커스텀 컴포넌트로 그린다.

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowUp, Calendar, Check, ChevronDown, ChevronDownCircle, ChevronUp,
  CircleDot, Clock, Copy, Download, EllipsisVertical, Eye, FileText, GraduationCap, Link as LinkIcon, Mail,
  Phone, Plus, PlusCircle, Rows3, Save, SlidersHorizontal, SquareCheck, Table2, Text, TextCursorInput,
  Trash2, Upload, UploadCloud, X,
} from 'lucide-react'
import { API_BASE, useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import FormRenderer from '../../components/forms/FormRenderer'
import GoogleDriveIcon from '../../components/common/GoogleDriveIcon'
import { DragHandle, useDragSort } from '../../components/common/DragHandle'
import { formStatus } from './formStatus'
import {
  DateInput,
  ErrorText,
  Field,
  GhostButton,
  Input,
  PrimaryButton,
  Select,
  Toggle,
} from '../../components/admin/FormControls'

export const CATEGORY_LABEL = { event: '행사', recruit: '모집', other: '기타' }
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))

// 서버 FIELD_TYPES와 같은 순서, 같은 값 (routes/forms.js)
const TYPE_LABEL = {
  text: '단답형',
  textarea: '서술형',
  select: '드롭다운',
  radio: '객관식',
  checkbox: '다중 선택',
  phone: '연락처',
  email: '이메일',
  studentid: '학번',
  file: '파일',
  date: '날짜',
  time: '시간',
  scale: '선형 배율',
  section: '섹션',
}
const OPTION_TYPES = ['select', 'radio', 'checkbox']

// 53_DRIVE_STORAGE: 파일 질문별 저장소. 값은 서버 lib/formStorage.js와 같은 화이트리스트다.
const STORAGE_TARGETS = [
  { value: 'blob', label: '웹 전시용 임시 저장소 (사이트에 보여줄 이미지)' },
  { value: 'drive', label: '구글 드라이브 (원본, 인쇄용 파일)' },
]
const STORAGE_PURPOSES = [
  { value: 'web', label: '웹 전시용: 사이트에 맞게 크기를 줄여 저장' },
  { value: 'original', label: '원본, 인쇄용: 올린 그대로 보관' },
  { value: 'attachment', label: '일반 제출 서류: 올린 그대로 보관' },
]
const SHARE_MODES = [
  { value: 'restricted', label: '제한: 폴더를 공유받은 사람만 볼 수 있음' },
  { value: 'link', label: '링크를 아는 사람은 누구나 볼 수 있음' },
]
const DEFAULT_TEMPLATES = [
  { value: 'exhibition_original', label: '전시회 원본 — 학기 / 폼명 / 과목 / 원본', needs_course: true, needs_semester: true },
  { value: 'course_leaf', label: '과목 / 원본 (학기 폴더를 저장 폴더로 정했을 때)', needs_course: true, needs_semester: false },
  { value: 'semester_course_field', label: '학기 / 과목 / 파일 질문명', needs_course: true, needs_semester: true },
  { value: 'semester_category_form_field', label: '학기 또는 연도 / 분류 / 폼명 / 파일 질문명', needs_course: false, needs_semester: true },
  { value: 'semester_form_field', label: '학기 또는 연도 / 폼명 / 파일 질문명', needs_course: false, needs_semester: true },
  { value: 'form_field', label: '폼명 / 파일 질문명', needs_course: false, needs_semester: false },
  { value: 'root', label: '저장 폴더에 바로 넣기', needs_course: false, needs_semester: false },
]
// 서버와 같은 순서로 단계를 조립해 관리자가 저장 전에 경로를 눈으로 토다
const PATH_PREVIEW = {
  exhibition_original: (c) => [c.semester, c.formTitle, c.course, c.leaf || '원본'],
  course_leaf: (c) => [c.course, c.leaf || '원본'],
  semester_course_field: (c) => [c.semester, c.course, c.fieldLabel],
  semester_category_form_field: (c) => [c.semester, c.categoryLabel, c.formTitle, c.fieldLabel],
  semester_form_field: (c) => [c.semester, c.formTitle, c.fieldLabel],
  form_field: (c) => [c.formTitle, c.fieldLabel],
  root: () => [],
}
const DEFAULT_STORAGE = {
  target: 'blob',
  purpose: 'web',
  accept: [],
  max_bytes: null,
  connection_id: null,
  path_template: 'semester_form_field',
  folder_label: '',
  share_mode: 'restricted',
}

/** 예전 폼(폼 전역 Drive 설정)을 질문 단위 설정으로 읽어오기 — 저장 전에도 화면이 사실을 보이게 한다 */
function normStorage(raw, formSettings = {}) {
  if (raw && typeof raw === 'object') {
    return {
      ...DEFAULT_STORAGE,
      ...raw,
      accept: Array.isArray(raw.accept) ? raw.accept : [],
      connection_id: raw.connection_id ?? null,
      max_bytes: raw.max_bytes ?? null,
    }
  }
  if (formSettings?.drive_enabled) {
    return {
      ...DEFAULT_STORAGE,
      target: 'drive',
      purpose: 'original',
      path_template: formSettings.drive_auto_folder === false ? 'root' : 'exhibition_original',
      share_mode: formSettings.drive_share_mode === 'link' ? 'link' : 'restricted',
      connection_id: formSettings.drive_connection_id ?? null,
    }
  }
  return { ...DEFAULT_STORAGE }
}

const CARD = 'flex flex-col rounded-md border border-border-subtle bg-bg-panel'
const TEXT_BTN =
  'inline-flex h-11 cursor-pointer items-center gap-8 rounded-sm px-12 text-small-m font-semibold text-text-sec transition hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent'
const ICON_BTN =
  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 md:h-32 md:w-32'

// ISO 와 캘린더 입력값('YYYY-MM-DDTHH:mm', 로컬 시간대) 변환. ExhibitionAdmin과 같은 계약
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

/** 필드 1개 정규화. 부분 저장된 jsonb가 와도 편집 화면이 깨지지 않게 기본값을 채운다 */
function normField(f, i, formSettings = {}) {
  return {
    // 파일 질문은 저장소 설정을 자기 카드에 가진다(폼 전역 설정 공유 종료).
    ...(f?.type === 'file' ? { storage: normStorage(f?.storage, formSettings) } : {}),
    id: String(f?.id ?? `f${i + 1}`),
    label_ko: f?.label_ko ?? '',
    label_en: f?.label_en ?? '',
    type: TYPE_LABEL[f?.type] ? f.type : 'text',
    required: Boolean(f?.required),
    placeholder_ko: f?.placeholder_ko ?? '',
    placeholder_en: f?.placeholder_en ?? '',
    hint_ko: f?.hint_ko ?? '',
    hint_en: f?.hint_en ?? '',
    options: Array.isArray(f?.options) ? f.options : [],
    options_en: Array.isArray(f?.options_en) ? f.options_en : [],
    validation:
      f?.validation && typeof f.validation === 'object' && !Array.isArray(f.validation)
        ? f.validation
        : {},
    order: i + 1,
  }
}

const EMPTY = {
  slug: '',
  title_ko: '',
  title_en: '',
  description_ko: '',
  description_en: '',
  category: 'event',
  fields: [],
  published: false,
  settings: {
    accept_start: '',
    accept_end: '',
    edit_end: '',
    require_google_auth: true,
    max_responses: '',
    show_button_in_header: false,
    button_label_ko: '',
    button_label_en: '',
    drive_enabled: false,
    drive_folder_id: '',
    drive_auto_folder: true,
    drive_semester: '',
    drive_course_field_id: '',
    drive_share_mode: 'restricted',
    drive_connection_id: '',
  },
}

function fromItem(item) {
  const s = item.settings || {}
  return {
    slug: item.slug || '',
    title_ko: item.title_ko || '',
    title_en: item.title_en || '',
    description_ko: item.description_ko || '',
    description_en: item.description_en || '',
    category: CATEGORY_LABEL[item.category] ? item.category : 'other',
    fields: (Array.isArray(item.fields) ? item.fields : [])
      .slice()
      .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
      .map((field, i) => normField(field, i, s)),
    published: Boolean(item.published),
    settings: {
      accept_start: toLocalInput(s.accept_start),
      accept_end: toLocalInput(s.accept_end),
      edit_end: toLocalInput(s.edit_end),
      require_google_auth: s.require_google_auth !== false,
      max_responses: s.max_responses == null ? '' : String(s.max_responses),
      show_button_in_header: Boolean(s.show_button_in_header),
      button_label_ko: s.button_label_ko || '',
      button_label_en: s.button_label_en || '',
      drive_enabled: Boolean(s.drive_enabled),
      drive_folder_id: s.drive_folder_id || '',
      drive_auto_folder: Boolean(s.drive_auto_folder),
      drive_semester: s.drive_semester || '',
      drive_course_field_id: s.drive_course_field_id || '',
      drive_share_mode: s.drive_share_mode === 'link' ? 'link' : 'restricted',
      drive_connection_id: s.drive_connection_id == null ? '' : String(s.drive_connection_id),
    },
  }
}

function toPayload(form) {
  const s = form.settings
  return {
    slug: form.slug.trim(),
    title_ko: form.title_ko,
    title_en: form.title_en,
    description_ko: form.description_ko,
    description_en: form.description_en,
    category: form.category,
    published: form.published,
    // 화면에 보이는 순서가 곧 저장 순서. FormRenderer는 order 오름차순으로 그린다
    fields: form.fields.map((f, i) => ({ ...f, order: i + 1 })),
    settings: {
      accept_start: fromLocalInput(s.accept_start),
      accept_end: fromLocalInput(s.accept_end),
      edit_end: fromLocalInput(s.edit_end),
      require_google_auth: s.require_google_auth,
      max_responses: s.max_responses === '' ? null : Number(s.max_responses),
      show_button_in_header: s.show_button_in_header,
      button_label_ko: s.button_label_ko,
      button_label_en: s.button_label_en,
      // 53_DRIVE_STORAGE: 저장 위치는 질문 카드가 결정한다. 폼 전역 플래그는 질문 설정에서 파생시휴다
      drive_enabled: form.fields.some((f) => f.type === 'file' && f.storage?.target === 'drive'),
      drive_folder_id: (s.drive_folder_id || '').trim(),
      drive_auto_folder: form.fields.some(
        (f) => f.type === 'file' && f.storage?.target === 'drive' && f.storage?.path_template !== 'root'
      ),
      drive_semester: (s.drive_semester || '').trim(),
      drive_course_field_id: s.drive_course_field_id,
      drive_share_mode: s.drive_share_mode,
      drive_connection_id: s.drive_connection_id === '' ? null : Number(s.drive_connection_id),
    },
  }
}

/**
 * 파일 질문 1개의 저장소 카드 (53_DRIVE_STORAGE).
 * 저장 위치·용도·허용 확장자·용량·폴더 경로를 이 질문에만 적용한다. 전시회 한 폼 안에서
 * "웹 전시용은 Blob, 인쇄용 원본은 Drive"가 동시에 성립해야 하므로 폼 전역 설정을 쓰지 않는다.
 */
function FileStorageCard({
  field,
  storage,
  onStorage,
  settings,
  setSetting,
  setSettingInput,
  courseFieldOptions,
  loadSemesterCourses,
  loadingCourses,
  courseError,
  connections,
  templates,
  formTitle,
  category,
  formId,
  onPrepare,
  preparing,
  prepareResult,
}) {
  const set = (key) => (value) => onStorage({ ...storage, [key]: value })
  const isDrive = storage.target === 'drive'
  const template = templates.find((t) => t.value === storage.path_template) || templates[0]
  const driveOptions = connections
    .filter((c) => c.active && c.has_token)
    .map((c) => ({ value: String(c.id), label: `${c.label}${c.account_email ? ` (${c.account_email})` : ''}` }))
  const selected = connections.find((c) => String(c.id) === String(storage.connection_id ?? settings.drive_connection_id))
  const build = PATH_PREVIEW[storage.path_template] || PATH_PREVIEW.semester_form_field
  const segments = build({
    semester: (settings.drive_semester || '').trim() || '(학기)',
    formTitle: formTitle || '(폼명)',
    categoryLabel: CATEGORY_LABEL[category] || '기타',
    fieldLabel: field.label_ko || field.id,
    course: '(선택한 과목)',
    leaf: storage.folder_label,
  }).filter(Boolean)
  const rootLabel = selected?.root_folder_name || selected?.root_folder_id || '(저장 폴더를 아직 정하지 않았습니다)'

  return (
    <div className="overflow-hidden rounded-md border border-border-subtle bg-bg-elev">
      <div className="flex flex-wrap items-center justify-between gap-12 border-b border-border-subtle bg-bg-panel px-16 py-12">
        <div className="flex items-center gap-8">
          {isDrive ? <GoogleDriveIcon size={19} /> : <UploadCloud size={19} className="text-purple-light" />}
          <div>
            <p className="text-small-m font-bold text-text-pri">이 파일 질문의 저장 위치</p>
            <p className="text-caption-m text-text-sec">
              {isDrive ? '구글 드라이브: 올린 원본을 그대로 보관합니다.' : '웹 전시용 임시 저장소: 사이트에 보여주기 좋게 줄여서 보관합니다. 드라이브에는 쌓이지 않습니다.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-12 p-16 md:grid-cols-2">
        <Field label="파일이 저장될 곳" hint="원본을 받으려면 구글 드라이브로 바꿔야 합니다">
          <Select
           
            value={storage.target}
            options={STORAGE_TARGETS}
            onChange={(e) => {
              const target = e.target.value
              onStorage({
                ...storage,
                target,
                purpose: target === 'drive' ? 'original' : 'web',
                path_template: target === 'drive' ? (storage.path_template || 'exhibition_original') : storage.path_template,
              })
            }}
          />
        </Field>
        <Field label="파일의 쓰임">
          <Select value={storage.purpose} options={STORAGE_PURPOSES} onChange={(e) => set('purpose')(e.target.value)} />
        </Field>
        <Field label="올릴 수 있는 파일 종류" hint="비워 두면 기본값을 씁니다. 여러 개는 쉼표로 나눕니다">
          <Input
            value={(storage.accept || []).join(', ')}
            onChange={(e) =>
              set('accept')(
                e.target.value
                  .split(',')
                  .map((v) => v.trim().replace(/^\./, '').toLowerCase())
                  .filter(Boolean)
              )
            }
            placeholder="jpg, png, pdf, ai"
          />
        </Field>
        <Field label="최대 용량 (MB)" hint={isDrive ? '비워 두면 100MB까지' : '비워 두면 20MB까지'}>
          <Input
            type="number"
            min="1"
            value={storage.max_bytes ? Math.round(storage.max_bytes / (1024 * 1024)) : ''}
            onChange={(e) => set('max_bytes')(e.target.value === '' ? null : Number(e.target.value) * 1024 * 1024)}
          />
        </Field>

        {isDrive && (
          <>
            <Field label="파일을 모을 드라이브" hint={driveOptions.length ? '관리 메뉴의 파일 보관함에서 연결한 계정입니다' : '연결된 드라이브가 없습니다'}>
              <Select
               
                value={storage.connection_id == null ? '' : String(storage.connection_id)}
                options={driveOptions}
                placeholder={driveOptions.length ? '드라이브 고르기' : '연결된 드라이브가 없습니다'}
                onChange={(e) => set('connection_id')(e.target.value === '' ? null : Number(e.target.value))}
                disabled={!driveOptions.length}
              />
            </Field>
            <Field label="폴더를 나누는 방식">
              <Select
               
                value={storage.path_template}
                options={templates.map((t) => ({ value: t.value, label: t.label }))}
                onChange={(e) => set('path_template')(e.target.value)}
              />
            </Field>
            <Field label="맨 안쪽 폴더 이름" hint="비워 두면 “원본”이라는 이름이 됩니다">
              <Input value={storage.folder_label} onChange={(e) => set('folder_label')(e.target.value)} placeholder="원본" />
            </Field>
            <Field label="파일 공개 범위" hint="학생 제출물과 원본은 ‘제한’을 권장합니다">
              <Select value={storage.share_mode} options={SHARE_MODES} onChange={(e) => set('share_mode')(e.target.value)} />
            </Field>
            <Field label="학기 또는 연도" hint="이 폼 전체에 똑같이 적용됩니다. 예: 2026-2">
              <Input value={settings.drive_semester} onChange={setSettingInput('drive_semester')} placeholder="2026-2" />
            </Field>
            <Field label="과목을 고르는 질문" hint="이 질문에서 고른 과목 이름으로 폴더가 나뉩니다">
              <Select
               
                value={settings.drive_course_field_id}
                options={courseFieldOptions}
                placeholder={courseFieldOptions.length ? '질문 고르기' : '객관식이나 드롭다운 질문을 먼저 만들어 주세요'}
                onChange={(e) => setSetting('drive_course_field_id')(e.target.value)}
                disabled={!courseFieldOptions.length}
              />
            </Field>

            <div className="md:col-span-2 flex flex-col gap-8 rounded-sm bg-glass-bg px-12 py-8">
              <p className="font-mono text-caption-m text-text-sec">
                예상 저장 경로: {rootLabel} / {segments.join(' / ') || '(루트에 바로 저장)'}
              </p>
              {!selected && (
                <p className="text-caption-m text-state-error">연결된 드라이브가 없습니다. 관리 메뉴의 ‘파일 보관함 (구글 드라이브)’에서 먼저 연결해 주세요.</p>
              )}
              {selected && !selected.root_folder_id && (
                <p className="text-caption-m text-state-error">저장 폴더가 정해지지 않았거나 접근할 수 없습니다. ‘파일 보관함 (구글 드라이브)’에서 저장 폴더를 정해 주세요.</p>
              )}
              {template?.needs_semester && !(settings.drive_semester || '').trim() && (
                <p className="text-caption-m text-state-error">학기를 입력해야 폴더가 만들어집니다.</p>
              )}
              {template?.needs_course && !settings.drive_course_field_id && (
                <p className="text-caption-m text-state-error">과목을 고르는 질문을 정해 주세요.</p>
              )}
              <div className="flex flex-wrap items-center gap-8">
                <GhostButton
                  type="button"
                  onClick={loadSemesterCourses}
                  disabled={loadingCourses || !settings.drive_course_field_id}
                  className="h-40 border-border-subtle bg-bg-panel px-12 text-small-m text-purple-light"
                >
                  {loadingCourses ? '불러오는 중' : '개설된 과목 가져오기'}
                </GhostButton>
                <GhostButton
                  type="button"
                  onClick={() => onPrepare(field.id, false)}
                  disabled={preparing || !formId}
                  className="h-40 border-border-subtle bg-bg-panel px-12 text-small-m text-purple-light"
                  title={formId ? '' : '폼을 먼저 저장하세요'}
                >
                  폴더가 어떻게 만들어질지 보기
                </GhostButton>
                <GhostButton
                  type="button"
                  onClick={() => onPrepare(field.id, true)}
                  disabled={preparing || !formId}
                  className="h-40 border-border-subtle bg-bg-panel px-12 text-small-m text-purple-light"
                >
                  필요한 폴더 미리 만들기
                </GhostButton>
              </div>
              {prepareResult && (
                <div className="font-mono text-caption-m text-text-sec">
                  {prepareResult.error ? (
                    <p className="text-state-error">{prepareResult.error}</p>
                  ) : (
                    <>
                      {(prepareResult.steps || []).map((step, i) => (
                        <p key={`${step.name}-${i}`}>
                          {step.name}{' '}
                          {step.missing ? '(폴더가 아직 없습니다)' : step.created ? '(새로 만들었습니다)' : '(이미 있어서 그대로 씁니다)'}
                        </p>
                      ))}
                      {prepareResult.folder_url && (
                        <a href={prepareResult.folder_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                          만들어진 폴더 열기
                        </a>
                      )}
                    </>
                  )}
                </div>
              )}
              {courseError && <p className="text-caption-m text-state-error">{courseError}</p>}
            </div>
          </>
        )}

        {!isDrive && (
          <p className="md:col-span-2 rounded-sm bg-glass-bg px-12 py-8 text-caption-m text-text-sec">
            웹 전시용 이미지는 사이트에서 바로 보여줄 수 있게 크기를 줄여 저장합니다. 원본 파일이 필요하면 저장될 곳을
            구글 드라이브로 바꿔 주세요.
          </p>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 화면 부품. 구글 폼의 구조를 그대로 따른다.
//   위: 폼 이름 + 탭(질문 / 응답 / 설정) + 저장
//   질문 탭: 제목 카드, 질문 카드(선택한 1장만 펼침), 오른쪽 추가 도구
//   질문 카드 아래 줄: 복제, 삭제, 필수, 더보기
// 간격은 토큰 스케일(4, 8, 12, 16, 20, 24, 32, 40, 48 ...)만 쓴다. 10, 28, 36, 44는 스케일 밖이라 금지.
// ──────────────────────────────────────────────────────────────────────────

const INK = 'text-text-pri'
const SUB = 'text-text-sec'
const LINE = 'border-border-subtle'

// 질문 유형 정보. 이름은 비개발자가 한 번에 알아보는 말로, 설명은 한 줄 예시로 쓴다.
const TYPE_META = {
  text: { label: '단답형', desc: '이름처럼 짧은 한 줄 답', icon: TextCursorInput },
  textarea: { label: '서술형', desc: '소감, 지원 동기처럼 긴 글', icon: AlignLeft },
  radio: { label: '객관식', desc: '보기 중 하나만 고르기', icon: CircleDot },
  checkbox: { label: '체크박스', desc: '보기 중 여러 개 고르기', icon: SquareCheck },
  select: { label: '드롭다운', desc: '목록을 펼쳐서 하나 고르기', icon: ChevronDownCircle },
  phone: { label: '연락처', desc: '010-0000-0000 형식만 입력 가능', icon: Phone },
  email: { label: '이메일', desc: '이메일 주소 형식만 입력 가능', icon: Mail },
  studentid: { label: '학번', desc: '숫자 8자리만 입력 가능', icon: GraduationCap },
  file: { label: '파일 올리기', desc: '이미지, PDF 같은 파일 받기', icon: Upload },
  scale: { label: '선형 배율', desc: '1점부터 5점처럼 점수 매기기', icon: SlidersHorizontal },
  date: { label: '날짜', desc: '달력에서 날짜 고르기', icon: Calendar },
  time: { label: '시간', desc: '14:30처럼 시각 입력', icon: Clock },
}
// 드롭다운 안에서 줄로 나누는 묶음
const TYPE_GROUPS = [
  ['text', 'textarea'],
  ['radio', 'checkbox', 'select'],
  ['phone', 'email', 'studentid'],
  ['file'],
  ['scale'],
  ['date', 'time'],
]

/** 새 질문의 기본값. 객관식은 보기 1개를 미리 넣어 바로 입력할 수 있게 한다 */
function defaultsFor(type) {
  return {
    options: OPTION_TYPES.includes(type) ? ['옵션 1'] : [],
    validation: type === 'scale' ? { scaleMin: 1, scaleMax: 5, scaleMinLabel: '', scaleMaxLabel: '' } : {},
  }
}

/** 질문 유형 고르기. 아이콘과 한 줄 설명이 붙은 팝업이다 */
function TypeMenu({ value, onChange, label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const key = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const meta = TYPE_META[value] || TYPE_META.text
  const Icon = meta.icon
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-48 w-full cursor-pointer items-center gap-12 rounded-sm border ${LINE} bg-bg-panel px-16 text-left text-body-m ${INK} transition hover:bg-glass-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus`}
      >
        <Icon size={18} className={`shrink-0 ${SUB}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{meta.label}</span>
        <ChevronDown size={16} className={SUB} aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-label="질문 유형" className={`absolute right-0 top-[calc(100%+4px)] z-40 max-h-[420px] w-[min(340px,86vw)] overflow-y-auto rounded-sm border ${LINE} bg-bg-panel py-8 shadow-card-glow`}>
          {TYPE_GROUPS.map((group, gi) => (
            <div key={group.join('-')} className={gi ? `mt-8 border-t border-border-subtle pt-8` : ''}>
              {group.map((t) => {
                const m = TYPE_META[t]
                const I = m.icon
                return (
                  <button
                    key={t}
                    type="button"
                    role="option"
                    aria-selected={t === value}
                    onClick={() => {
                      onChange(t)
                      setOpen(false)
                    }}
                    className={`flex w-full cursor-pointer items-center gap-12 px-16 py-8 text-left transition hover:bg-glass-strong ${t === value ? 'bg-glass-strong' : ''}`}
                  >
                    <I size={18} className={`shrink-0 ${t === value ? 'text-purple-light' : SUB}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className={`block text-body-m ${INK}`}>{m.label}</span>
                      <span className={`block text-caption-m ${SUB}`}>{m.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 더보기(점 세 개) 메뉴. 질문 카드 아래 줄에 붙는다 */
function MoreMenu({ items, label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const key = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={ICON_BTN}>
        <EllipsisVertical size={18} />
      </button>
      {open && (
        <div role="menu" className={`absolute bottom-[calc(100%+4px)] right-0 z-40 w-[220px] rounded-sm border ${LINE} bg-bg-panel py-8 shadow-card-glow`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onClick()
                setOpen(false)
              }}
              className={`flex w-full cursor-pointer items-center gap-12 px-16 py-8 text-left text-body-m ${INK} transition hover:bg-glass-strong disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 보기 목록. 줄마다 동그라미 또는 네모 표시가 붙고, 여러 줄을 붙여넣으면 줄마다 보기가 된다 */
function OptionList({ type, options, onChange }) {
  const refs = useRef([])
  const marker = (i) =>
    type === 'radio' ? (
      <span aria-hidden="true" className="h-20 w-20 shrink-0 rounded-full border-2 border-border-strong" />
    ) : type === 'checkbox' ? (
      <span aria-hidden="true" className="h-20 w-20 shrink-0 rounded-sm border-2 border-border-strong" />
    ) : (
      <span aria-hidden="true" className={`w-20 shrink-0 text-center text-small-m ${SUB}`}>{i + 1}</span>
    )
  const update = (i, v) => onChange(options.map((o, idx) => (idx === i ? v : o)))
  const move = (from, to) => {
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }
  const onPaste = (i, e) => {
    const text = e.clipboardData?.getData('text') || ''
    if (!/[\r\n]/.test(text)) return
    e.preventDefault()
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return
    const next = [...options]
    next.splice(i, 1, ...lines)
    onChange(next)
  }
  const add = () => {
    onChange([...options, `옵션 ${options.length + 1}`])
    window.setTimeout(() => refs.current[options.length]?.select(), 30)
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {options.map((opt, i) => (
        <div key={i} className="group/opt flex min-w-0 items-center gap-12">
          {marker(i)}
          <input
            ref={(el) => {
              refs.current[i] = el
            }}
            value={opt}
            onChange={(e) => update(i, e.target.value)}
            onPaste={(e) => onPaste(i, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const next = [...options]
                next.splice(i + 1, 0, '')
                onChange(next)
                window.setTimeout(() => refs.current[i + 1]?.focus(), 30)
              }
            }}
            aria-label={`보기 ${i + 1}`}
            className={`h-40 min-w-0 flex-1 !rounded-none !border-0 !border-b !bg-transparent px-0 text-body-m ${INK} outline-none transition hover:!border-border-strong focus:!border-b-2 focus:!border-purple-primary focus:ring-0`}
          />
          <span className="flex shrink-0 items-center md:opacity-0 md:transition md:group-focus-within/opt:opacity-100 md:group-hover/opt:opacity-100">
            <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`보기 ${i + 1} 위로`} className={ICON_BTN}>
              <ChevronUp size={16} />
            </button>
            <button type="button" onClick={() => move(i, i + 1)} disabled={i === options.length - 1} aria-label={`보기 ${i + 1} 아래로`} className={ICON_BTN}>
              <ChevronDown size={16} />
            </button>
          </span>
          <button type="button" onClick={() => onChange(options.filter((_, idx) => idx !== i))} aria-label={`보기 ${i + 1} 삭제`} className={ICON_BTN}>
            <X size={18} />
          </button>
        </div>
      ))}
      <div className="flex min-w-0 items-center gap-12">
        {marker(options.length)}
        <button type="button" onClick={add} className={`h-40 cursor-pointer text-left text-body-m ${SUB} transition hover:text-purple-light`}>
          옵션 추가
        </button>
      </div>
    </div>
  )
}

/** 선택하지 않은 질문 카드에 보이는 응답 모양 미리보기 */
function FieldPreview({ field }) {
  const opts = Array.isArray(field.options) ? field.options : []
  const line = (text, wide = false) => (
    <div className={`border-b border-dotted border-border-strong pb-4 text-body-m ${SUB} ${wide ? 'w-full' : 'w-[min(100%,420px)]'}`}>{text}</div>
  )
  switch (field.type) {
    case 'textarea':
      return line('서술형 텍스트', true)
    case 'radio':
    case 'checkbox':
      return (
        <div className="flex flex-col gap-8">
          {opts.length === 0 && <p className={`text-body-m ${SUB}`}>보기가 없습니다</p>}
          {opts.slice(0, 6).map((o, i) => (
            <div key={`${o}-${i}`} className={`flex items-center gap-12 text-body-m ${INK}`}>
              <span aria-hidden="true" className={`h-20 w-20 shrink-0 border-2 border-border-strong ${field.type === 'radio' ? 'rounded-full' : 'rounded-sm'}`} />
              <span className="min-w-0 break-words">{o || '(빈 보기)'}</span>
            </div>
          ))}
          {opts.length > 6 && <p className={`text-caption-m ${SUB}`}>외 {opts.length - 6}개</p>}
        </div>
      )
    case 'select':
      return (
        <div className="flex flex-col gap-4">
          {opts.slice(0, 4).map((o, i) => (
            <p key={`${o}-${i}`} className={`text-body-m ${INK}`}>{i + 1}. {o || '(빈 보기)'}</p>
          ))}
          {opts.length > 4 && <p className={`text-caption-m ${SUB}`}>외 {opts.length - 4}개</p>}
        </div>
      )
    case 'file':
      return (
        <span className={`inline-flex h-40 items-center gap-8 rounded-sm border ${LINE} px-16 text-body-m text-purple-light`}>
          <Upload size={16} aria-hidden="true" /> 파일 추가
        </span>
      )
    case 'scale': {
      const { min, max } = scaleBounds(field.validation)
      const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i)
      return (
        <div className="flex flex-wrap items-center gap-12 text-body-m">
          {field.validation?.scaleMinLabel && <span className={SUB}>{field.validation.scaleMinLabel}</span>}
          {nums.map((n) => (
            <span key={n} className="flex flex-col items-center gap-4">
              <span className={INK}>{n}</span>
              <span aria-hidden="true" className="h-20 w-20 rounded-full border-2 border-border-strong" />
            </span>
          ))}
          {field.validation?.scaleMaxLabel && <span className={SUB}>{field.validation.scaleMaxLabel}</span>}
        </div>
      )
    }
    case 'date':
      return line('연도-월-일')
    case 'time':
      return line('시 : 분')
    case 'phone':
      return line('010-0000-0000')
    case 'email':
      return line('이메일 주소')
    case 'studentid':
      return line('학번 8자리')
    default:
      return line('단답형 텍스트')
  }
}

function scaleBounds(validation) {
  const lo = Number(validation?.scaleMin) === 0 ? 0 : 1
  const hiRaw = Number(validation?.scaleMax)
  const hi = Number.isInteger(hiRaw) && hiRaw >= 2 && hiRaw <= 10 ? hiRaw : 5
  return { min: lo, max: hi }
}

const SCALE_FROM = [{ value: '0', label: '0' }, { value: '1', label: '1' }]
const SCALE_TO = Array.from({ length: 9 }, (_, i) => ({ value: String(i + 2), label: String(i + 2) }))

/** 질문 카드 한 장. 선택하면 펼쳐지고 나머지는 접힌 미리보기로 보인다 */
function QuestionCard({
  field, index, total, active, onActivate, onChange, onRemove, onDuplicate, onMove,
  dragging, over, rowProps, armed, onArm, driveProps,
}) {
  const [showHint, setShowHint] = useState(Boolean(field.hint_ko))
  const set = (key) => (v) => onChange({ ...field, [key]: v })
  const rp = rowProps(index)
  const meta = TYPE_META[field.type] || TYPE_META.text
  const max = field.validation?.maxLength
  const setValidation = (patch) => onChange({ ...field, validation: { ...field.validation, ...patch } })
  const changeType = (type) => {
    const base = defaultsFor(type)
    const next = { ...field, type }
    if (OPTION_TYPES.includes(type) && !field.options.length) next.options = base.options
    if (type === 'scale') next.validation = { ...base.validation, ...field.validation }
    if (type === 'file') next.storage = normStorage(field.storage, driveProps.settings)
    onChange(next)
  }
  const { min: sMin, max: sMax } = scaleBounds(field.validation)

  return (
    <div
      {...rp}
      data-card-id={field.id}
      // 핸들을 누르는 동안에만 draggable. 카드 안 입력창의 텍스트 선택을 막지 않는다
      draggable={armed}
      onDragEnd={(e) => {
        onArm(false)
        rp.onDragEnd?.(e)
      }}
      onClick={() => !active && onActivate()}
      className={`${CARD} group relative transition duration-fast ease-out ${active ? 'border-l-[6px] border-l-purple-primary' : 'cursor-pointer hover:shadow-md'} ${dragging ? 'opacity-40' : ''} ${over ? '!border-purple-primary' : ''}`}
    >
      <span
        onPointerDown={() => rp.draggable && onArm(true)}
        onPointerUp={() => onArm(false)}
        onPointerCancel={() => onArm(false)}
        aria-label={`질문 ${index + 1} 순서 바꾸기. 끌어서 옮깁니다`}
        title="끌어서 순서 바꾸기"
        className={`absolute left-1/2 top-4 z-10 flex -translate-x-1/2 rotate-90 cursor-grab touch-none text-text-meta transition active:cursor-grabbing ${active ? '' : 'md:opacity-0 md:group-hover:opacity-100'}`}
      >
        <DragHandle />
      </span>

      {!active ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={`질문 ${index + 1} 펼쳐서 고치기`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onActivate()
            }
          }}
          className="flex min-w-0 flex-col gap-12 p-24 outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <div className="flex items-start justify-between gap-12">
            <p className={`min-w-0 break-words text-body-l-m font-medium md:text-body-l-d ${field.label_ko ? INK : 'text-text-meta'}`}>
              {field.label_ko || '제목 없는 질문'}
              {field.required && <span className="ml-4 text-state-error" aria-label="필수">*</span>}
            </p>
            <span className={`shrink-0 rounded-full bg-bg-elev px-12 py-4 text-caption-m ${SUB}`}>{meta.label}</span>
          </div>
          {field.hint_ko && <p className={`whitespace-pre-wrap text-small-m ${SUB}`}>{field.hint_ko}</p>}
          <FieldPreview field={field} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-20 p-24 pt-32">
          <div className="grid grid-cols-1 items-start gap-16 md:grid-cols-[minmax(0,1fr)_260px]">
            <input
              aria-label={`질문 ${index + 1} 제목`}
              value={field.label_ko}
              onChange={(e) => set('label_ko')(e.target.value)}
              placeholder="질문 제목"
              autoFocus={!field.label_ko}
              className={`h-48 w-full !rounded-none !border-0 !border-b !border-border-strong !bg-bg-elev px-16 text-body-l-m ${INK} outline-none transition focus:!border-b-2 focus:!border-purple-primary focus:ring-0 md:text-body-l-d`}
            />
            <TypeMenu value={field.type} onChange={changeType} label={`질문 ${index + 1} 유형 바꾸기. 지금은 ${meta.label}`} />
          </div>

          {showHint ? (
            <div className="flex items-center gap-8">
              <input
                aria-label={`질문 ${index + 1} 설명`}
                value={field.hint_ko}
                onChange={(e) => set('hint_ko')(e.target.value)}
                placeholder="설명"
                className={`h-40 min-w-0 flex-1 !rounded-none !border-0 !border-b !bg-transparent px-0 text-body-m ${INK} outline-none transition hover:!border-border-strong focus:!border-b-2 focus:!border-purple-primary focus:ring-0`}
              />
              <button type="button" onClick={() => { set('hint_ko')(''); setShowHint(false) }} aria-label="설명 지우기" className={ICON_BTN}>
                <X size={18} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowHint(true)} className="-mt-8 flex h-40 w-fit cursor-pointer items-center gap-8 text-small-m font-semibold text-purple-light hover:underline">
              <Plus size={16} aria-hidden="true" /> 설명 추가
            </button>
          )}

          {OPTION_TYPES.includes(field.type) && <OptionList type={field.type} options={field.options} onChange={set('options')} />}

          {(field.type === 'text' || field.type === 'textarea') && (
            <div className="flex flex-col gap-12">
              <FieldPreview field={field} />
              <label className="flex flex-wrap items-center gap-8 text-small-m text-text-sec">
                글자 수 제한
                <input
                  type="number"
                  min="1"
                  value={max ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    const next = { ...field.validation }
                    if (v === '') delete next.maxLength
                    else next.maxLength = Number(v)
                    set('validation')(next)
                  }}
                  placeholder="없음"
                  className={`h-40 w-96 rounded-sm border ${LINE} bg-bg-elev px-12 text-body-m ${INK}`}
                />
                자 이하
              </label>
            </div>
          )}

          {['phone', 'email', 'studentid', 'date', 'time'].includes(field.type) && (
            <div className="flex flex-col gap-8">
              <FieldPreview field={field} />
            </div>
          )}

          {field.type === 'scale' && (
            <div className="flex flex-col gap-16">
              <div className="flex flex-wrap items-center gap-12 text-body-m text-text-sec">
                <div className="w-80"><Select value={String(sMin)} options={SCALE_FROM} onChange={(e) => setValidation({ scaleMin: Number(e.target.value) })} aria-label="시작 숫자" /></div>
                <span>부터</span>
                <div className="w-80"><Select value={String(sMax)} options={SCALE_TO} onChange={(e) => setValidation({ scaleMax: Number(e.target.value) })} aria-label="끝 숫자" /></div>
                <span>까지</span>
              </div>
              <div className="grid grid-cols-1 gap-12 md:grid-cols-2">
                <label className="flex items-center gap-12 text-small-m text-text-sec">
                  <span className="w-48 shrink-0">{sMin}점 이름</span>
                  <input value={field.validation?.scaleMinLabel || ''} onChange={(e) => setValidation({ scaleMinLabel: e.target.value })} placeholder="이름" className={`h-40 min-w-0 flex-1 rounded-sm border ${LINE} bg-bg-elev px-12 text-body-m ${INK}`} />
                </label>
                <label className="flex items-center gap-12 text-small-m text-text-sec">
                  <span className="w-48 shrink-0">{sMax}점 이름</span>
                  <input value={field.validation?.scaleMaxLabel || ''} onChange={(e) => setValidation({ scaleMaxLabel: e.target.value })} placeholder="이름" className={`h-40 min-w-0 flex-1 rounded-sm border ${LINE} bg-bg-elev px-12 text-body-m ${INK}`} />
                </label>
              </div>
              <FieldPreview field={field} />
            </div>
          )}

          {field.type === 'file' && <FileStorageCard field={field} storage={field.storage || DEFAULT_STORAGE} onStorage={set('storage')} {...driveProps} />}

          <div className={`flex flex-wrap items-center justify-end gap-4 border-t border-border-subtle pt-16`}>
            <button type="button" onClick={onDuplicate} className={TEXT_BTN}>
              <Copy size={18} aria-hidden="true" /> 복제
            </button>
            <button type="button" onClick={onRemove} className={TEXT_BTN}>
              <Trash2 size={18} aria-hidden="true" /> 삭제
            </button>
            <span className="mx-8 h-24 w-px bg-bg-elev" aria-hidden="true" />
            <span className={`text-small-m font-medium ${INK}`}>필수 질문</span>
            <Toggle checked={field.required} onChange={set('required')} label={`질문 ${index + 1} 필수 여부`} />
            <MoreMenu
              label={`질문 ${index + 1} 더보기`}
              items={[
                { label: '위로 옮기기', icon: <ArrowUp size={16} aria-hidden="true" />, onClick: () => onMove(-1), disabled: index === 0 },
                { label: '아래로 옮기기', icon: <ArrowDown size={16} aria-hidden="true" />, onClick: () => onMove(1), disabled: index === total - 1 },
                { label: showHint ? '설명 숨기기' : '설명 추가', icon: <Text size={16} aria-hidden="true" />, onClick: () => setShowHint((v) => !v) },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** 섹션(페이지 나누기) 카드 */
function SectionCard({ field, index, pageNo, active, onActivate, onChange, onRemove, onMove, total, dragging, over, rowProps, armed, onArm }) {
  const rp = rowProps(index)
  return (
    <div
      {...rp}
      data-card-id={field.id}
      draggable={armed}
      onDragEnd={(e) => {
        onArm(false)
        rp.onDragEnd?.(e)
      }}
      onClick={() => !active && onActivate()}
      className={`group relative mt-16 ${dragging ? 'opacity-40' : ''}`}
    >
      <span className="absolute -top-0 left-0 z-10 rounded-t-md bg-purple-deep px-16 py-8 text-small-m font-semibold text-button-primaryText">
        {pageNo}페이지 시작
      </span>
      <div className={`${CARD} ${active ? 'border-l-[6px] border-l-purple-primary' : ''} mt-32 rounded-tl-none border-t-8 border-t-purple-deep ${over ? '!border-purple-primary' : ''}`}>
        <span
          onPointerDown={() => rp.draggable && onArm(true)}
          onPointerUp={() => onArm(false)}
          onPointerCancel={() => onArm(false)}
          aria-label={`페이지 나누기 ${pageNo} 순서 바꾸기`}
          className="absolute left-1/2 top-12 z-10 flex -translate-x-1/2 rotate-90 cursor-grab touch-none text-text-meta active:cursor-grabbing"
        >
          <DragHandle />
        </span>
        <div className="flex flex-col gap-12 p-24 pt-32">
          <input
            aria-label={`${pageNo}페이지 제목`}
            value={field.label_ko}
            onChange={(e) => onChange({ ...field, label_ko: e.target.value })}
            placeholder="페이지 제목"
            className={`h-48 w-full !rounded-none !border-0 !border-b !border-border-strong !bg-bg-elev px-16 text-body-l-m ${INK} outline-none transition focus:!border-b-2 focus:!border-purple-primary focus:ring-0 md:text-body-l-d`}
          />
          <input
            aria-label={`${pageNo}페이지 설명`}
            value={field.hint_ko}
            onChange={(e) => onChange({ ...field, hint_ko: e.target.value })}
            placeholder="페이지 설명"
            className={`h-40 w-full !rounded-none !border-0 !border-b !bg-transparent px-0 text-body-m ${INK} outline-none transition hover:!border-border-strong focus:!border-b-2 focus:!border-purple-primary focus:ring-0`}
          />
          <div className="flex flex-wrap items-center justify-end gap-4 border-t border-border-subtle pt-16">
            <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={TEXT_BTN}>
              <ArrowUp size={18} aria-hidden="true" /> 위로
            </button>
            <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={TEXT_BTN}>
              <ArrowDown size={18} aria-hidden="true" /> 아래로
            </button>
            <button type="button" onClick={onRemove} className={TEXT_BTN}>
              <Trash2 size={18} aria-hidden="true" /> 삭제
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 오른쪽(좁은 화면에서는 카드 아래) 추가 도구. 글자가 붙어 있어서 아이콘 뜻을 몰라도 된다 */
function AddToolbar({ onAdd }) {
  const btn = `flex h-48 w-full cursor-pointer items-center gap-12 rounded-sm px-16 text-left text-small-m font-semibold ${INK} transition hover:bg-glass-strong hover:text-purple-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus`
  return (
    <div role="toolbar" aria-label="질문 추가 도구" className={`mt-12 flex flex-col rounded-md border ${LINE} bg-bg-panel p-4 shadow-card-glow sm:flex-row lg:absolute lg:-right-[176px] lg:top-0 lg:mt-0 lg:w-[160px] lg:flex-col`}>
      <button type="button" onClick={() => onAdd('radio')} className={btn}>
        <PlusCircle size={20} className="shrink-0 text-purple-light" aria-hidden="true" /> 질문 추가
      </button>
      <button type="button" onClick={() => onAdd('file')} className={btn}>
        <Upload size={20} className="shrink-0 text-purple-light" aria-hidden="true" /> 파일 질문 추가
      </button>
      <button type="button" onClick={() => onAdd('section')} className={btn}>
        <Rows3 size={20} className="shrink-0 text-purple-light" aria-hidden="true" /> 페이지 나누기
      </button>
    </div>
  )
}

const TAB_LABEL = { questions: '질문', responses: '응답', settings: '설정' }

const STATUS_TONE = {
  ok: 'border-state-success text-state-success',
  warn: 'border-state-error text-state-error',
  info: 'border-border-purple text-text-pri',
  muted: 'border-border-subtle text-text-meta',
}

/** 설정 탭의 한 묶음 */
function SettingGroup({ title, children }) {
  return (
    <section className={`${CARD} gap-20 p-24 md:p-32`}>
      <h3 className={`text-body-l-m font-bold md:text-body-l-d ${INK}`}>{title}</h3>
      {children}
    </section>
  )
}

/** 켜고 끄는 설정 한 줄 */
function SwitchRow({ title, checked, onChange, label }) {
  return (
    <div className="flex items-center justify-between gap-16">
      <p className={`text-body-m font-semibold ${INK}`}>{title}</p>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function SettingsTab({ form, set, setSetting, setSettingInput, publicUrl, onCopy, copied }) {
  const s = form.settings
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <div className="flex flex-col gap-16">
      <SettingGroup title="공개">
        <SwitchRow title={form.published ? '공개' : '비공개'} checked={form.published} onChange={set('published')} label="공개 여부" />
      </SettingGroup>

      <SettingGroup title="접수 기간">
        <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
          <Field label="접수 시작">
            <DateInput withTime value={s.accept_start} onChange={setSettingInput('accept_start')} />
          </Field>
          <Field label="접수 마감">
            <DateInput withTime value={s.accept_end} viewDate={s.accept_start} onChange={setSettingInput('accept_end')} />
          </Field>
          <Field label="수정 기한">
            <DateInput withTime value={s.edit_end} viewDate={s.accept_end} onChange={setSettingInput('edit_end')} />
          </Field>
          <Field label="최대 응답 수">
            <Input type="number" min="1" value={s.max_responses} onChange={setSettingInput('max_responses')} placeholder="제한 없음" />
          </Field>
        </div>
      </SettingGroup>

      <SettingGroup title="응답자">
        <SwitchRow title="구글 로그인 후 제출" checked={s.require_google_auth} onChange={setSetting('require_google_auth')} label="구글 로그인 필요 여부" />
      </SettingGroup>

      <SettingGroup title="사이트 표시">
        <SwitchRow title="상단 신청 버튼" checked={s.show_button_in_header} onChange={setSetting('show_button_in_header')} label="상단 버튼 표시 여부" />
        <Field label="버튼 글자">
          <Input value={s.button_label_ko} onChange={setSettingInput('button_label_ko')} placeholder="신청하기" />
        </Field>
      </SettingGroup>

      <SettingGroup title="주소와 분류">
        <Field label="신청 페이지 주소">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-stretch">
            <div className={`flex min-w-0 flex-1 items-center overflow-hidden rounded-md border ${LINE} bg-bg-panel`}>
              <span className={`hidden shrink-0 bg-bg-elev px-12 py-12 text-small-m ${SUB} sm:block`}>{origin}/forms/</span>
              <input
                value={form.slug}
                onChange={(e) => set('slug')(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="closing-2026-2"
                aria-label="신청 페이지 주소"
                className={`!rounded-none !border-0 min-w-0 flex-1 bg-transparent px-12 py-12 text-body-m ${INK} outline-none`}
              />
            </div>
            <GhostButton onClick={onCopy} disabled={!form.slug} className="shrink-0">
              {copied ? <Check size={16} aria-hidden="true" /> : <LinkIcon size={16} aria-hidden="true" />}
              {copied ? '복사됨' : '주소 복사'}
            </GhostButton>
          </div>
          {publicUrl && <span className={`break-all text-caption-m ${SUB}`}>{publicUrl}</span>}
        </Field>
        <Field label="분류">
          <div className="max-w-[320px]">
            <Select value={form.category} options={CATEGORY_OPTIONS} onChange={(e) => set('category')(e.target.value)} />
          </div>
        </Field>
      </SettingGroup>
    </div>
  )
}

/** 응답 탭: 개수와 문항별 요약. 자세한 표는 응답 시트에서 본다 */
function ResponsesTab({ formId, fields, resp }) {
  const { data, loading, error } = resp
  const [busy, setBusy] = useState(false)
  const [dlError, setDlError] = useState(null)
  const items = data?.items || []

  const download = async () => {
    setBusy(true)
    setDlError(null)
    try {
      const res = await fetch(`${API_BASE}/admin/forms/${formId}/responses/export`, { credentials: 'include' })
      if (!res.ok) throw new Error(`내려받지 못했습니다 (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `form-${formId}-responses.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDlError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!formId) {
    return (
      <div className={`${CARD} p-32 text-center`}>
        <p className={`text-body-l-m font-bold ${INK}`}>저장 후 응답을 볼 수 있습니다</p>
      </div>
    )
  }

  const summarizable = fields.filter((f) => ['radio', 'select', 'checkbox', 'scale'].includes(f.type))
  const countsFor = (f) => {
    const map = new Map()
    for (const r of items) {
      const v = r.data?.[f.id]
      const list = Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)]
      for (const x of list) map.set(x, (map.get(x) || 0) + 1)
    }
    const order = f.type === 'scale'
      ? (() => { const { min, max } = scaleBounds(f.validation); return Array.from({ length: max - min + 1 }, (_, i) => String(min + i)) })()
      : f.options
    return order.map((label) => ({ label, n: map.get(label) || 0 }))
  }

  return (
    <div className="flex flex-col gap-16">
      <section className={`${CARD} gap-16 p-24 md:p-32`}>
        <div className="flex flex-wrap items-center justify-between gap-16">
          <div>
            <p className={`text-small-m ${SUB}`}>응답</p>
            <p className={`text-h2-m font-bold md:text-h2-d ${INK}`}>{loading ? '불러오는 중' : `${items.length}건`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-8">
            <a href={`/admin/forms/${formId}/responses/sheet`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-8 rounded-sm bg-purple-primary px-24 text-body-m font-semibold text-button-primaryText transition hover:bg-purple-deep">
              <Table2 size={16} aria-hidden="true" /> 표로 보기
            </a>
            <GhostButton onClick={download} disabled={busy || !items.length} className="border-border-subtle text-text-pri">
              <Download size={16} aria-hidden="true" /> {busy ? '내려받는 중' : '엑셀용 파일 받기'}
            </GhostButton>
          </div>
        </div>
        <ErrorText>{dlError || error?.message}</ErrorText>
      </section>

      {!loading && items.length === 0 && (
        <div className={`${CARD} p-32 text-center`}>
          <p className={`text-body-l-m font-bold ${INK}`}>응답 없음</p>
        </div>
      )}

      {items.length > 0 &&
        summarizable.map((f) => {
          const rows = countsFor(f)
          const top = Math.max(1, ...rows.map((r) => r.n))
          return (
            <section key={f.id} className={`${CARD} gap-16 p-24 md:p-32`}>
              <header>
                <h3 className={`break-words text-body-l-m font-medium md:text-body-l-d ${INK}`}>{f.label_ko || '제목 없는 질문'}</h3>
                <p className={`mt-4 text-small-m ${SUB}`}>{TYPE_META[f.type]?.label}, 응답 {rows.reduce((a, r) => a + r.n, 0)}개</p>
              </header>
              <ul className="flex flex-col gap-12">
                {rows.map((r) => (
                  <li key={r.label} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_56px] items-center gap-12 text-small-m">
                    <span className={`truncate ${INK}`}>{r.label}</span>
                    <span className="h-16 rounded-sm bg-bg-elev">
                      <span className="block h-16 rounded-sm bg-purple-primary" style={{ width: `${(r.n / top) * 100}%` }} />
                    </span>
                    <span className={`text-right ${SUB}`}>{r.n}명</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
    </div>
  )
}

function FormEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isNew = !id
  useTitle(isNew ? '신청 폼 만들기' : '신청 폼 고치기')

  const { data, loading, error, refetch } = useApi(isNew ? null : `/admin/forms/${id}`)
  // 새 폼도 곧바로 저장할 수 있도록 내부 주소를 기본 발급한다. 제목은 질문 탭 맨 위에서 바로 편집한다.
  const [form, setForm] = useState(() =>
    isNew ? { ...EMPTY, slug: `form-${Date.now().toString(36)}` } : EMPTY
  )
  const [hydrated, setHydrated] = useState(isNew)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [courseLoadError, setCourseLoadError] = useState(null)
  const [loadingCourses, setLoadingCourses] = useState(false)
  const [preview, setPreview] = useState(false)
  const [previewValue, setPreviewValue] = useState({})
  const [tab, setTab] = useState('questions')
  const [activeId, setActiveId] = useState('header')
  const [armed, setArmed] = useState(null) // 드래그 준비된 필드 index
  const [copied, setCopied] = useState(false)
  const [savedAt, setSavedAt] = useState(location.state?.justSaved ? new Date() : null)
  // 53_DRIVE_STORAGE: 연결 프로필·경로 템플릿은 서버가 단일 원본이다. 화면은 그것을 그린다.
  const { data: driveStatus } = useApi('/admin/drive/status')
  const resp = useApi(isNew ? null : `/admin/forms/${id}/responses`)
  const [saveIssues, setSaveIssues] = useState([])
  const [preparing, setPreparing] = useState(false)
  const [prepareResults, setPrepareResults] = useState({})
  // 저장된 시점의 내용. 지금 내용과 다르면 "저장하지 않은 변경"으로 알린다.
  const savedSnap = useRef(isNew ? JSON.stringify({ ...EMPTY, slug: '' }) : '')

  useEffect(() => {
    if (hydrated || !data?.item) return
    const next = fromItem(data.item)
    setForm(next)
    savedSnap.current = JSON.stringify(next)
    setHydrated(true)
  }, [hydrated, data])

  const canSaveForm = Boolean(form.title_ko?.trim() && form.slug?.trim())
  const dirty = hydrated && (isNew ? form.title_ko !== '' || form.fields.length > 0 : JSON.stringify(form) !== savedSnap.current)

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const set = (key) => (v) => setForm((prev) => ({ ...prev, [key]: v }))
  const setInput = (key) => (e) => set(key)(e.target.value)
  const setSetting = (key) => (v) =>
    setForm((prev) => ({ ...prev, settings: { ...prev.settings, [key]: v } }))
  const setSettingInput = (key) => (e) => setSetting(key)(e.target.value)

  const setFields = (fields) => setForm((prev) => ({ ...prev, fields }))
  const courseFieldOptions = form.fields
    .filter((field) => ['select', 'radio'].includes(field.type))
    .map((field) => ({ value: field.id, label: field.label_ko || field.label_en || field.id }))

  // 지금 선택한 카드 바로 아래에 새 질문을 넣고 그 카드를 펼친다(구글 폼과 같은 동작)
  const addField = (type = 'radio') => {
    const at = form.fields.findIndex((f) => f.id === activeId)
    const insertAt = at < 0 ? form.fields.length : at + 1
    const fresh = normField(
      { id: `f${Date.now().toString(36)}`, type, ...defaultsFor(type) },
      insertAt,
      form.settings
    )
    const next = [...form.fields]
    next.splice(insertAt, 0, fresh)
    setFields(next)
    setActiveId(fresh.id)
    window.setTimeout(() => {
      document.querySelector(`[data-card-id="${fresh.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
  }

  const moveField = (from, delta) => {
    const to = from + delta
    if (to < 0 || to >= form.fields.length) return
    const next = [...form.fields]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setFields(next)
  }

  /**
   * 폴더 구조 미리보기(create=false)와 누락 폴더 준비(create=true).
   * 같은 경로를 여러 번 눌러도 서버가 find-or-create로 같은 폴더를 돌려준다.
   */
  const runPrepare = async (fieldId, create) => {
    if (!id) {
      setPrepareResults((prev) => ({ ...prev, [fieldId]: { error: '폼을 한 번 저장한 뒤에 폴더를 점검할 수 있습니다.' } }))
      return
    }
    setPreparing(true)
    try {
      if (create) {
        const res = await api.post('/admin/drive/prepare', { form_id: Number(id), field_id: fieldId })
        setPrepareResults((prev) => ({ ...prev, [fieldId]: res }))
      } else {
        const res = await api.post('/admin/drive/preview', { form_id: Number(id), deep: true })
        const plan = (res.plans || []).find((p) => p.field_id === fieldId)
        setPrepareResults((prev) => ({
          ...prev,
          [fieldId]: plan
            ? {
                steps: plan.steps?.length
                  ? plan.steps
                  : (plan.segments || []).map((name) => ({ name, missing: !plan.ready })),
              }
            : { error: '이 질문의 경로 정보를 받지 못했습니다.' },
        }))
        setSaveIssues(Array.isArray(res.issues) ? res.issues : [])
      }
    } catch (err) {
      setPrepareResults((prev) => ({ ...prev, [fieldId]: { error: err.message } }))
    } finally {
      setPreparing(false)
    }
  }

  const publicUrl = form.slug ? `${window.location.origin}/forms/${form.slug}` : ''
  const copyPublicUrl = async () => {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setSaveError('주소를 복사하지 못했습니다')
    }
  }

  // 개설 교과목은 학기별 관리 화면의 단일 원본(semester_offerings)을 그대로 읽는다.
  // 따라서 매 학기 전시 폼을 만들 때 과목명을 다시 적거나 이전 학기 목록을 복사하지 않는다.
  const loadSemesterCourses = async () => {
    const match = String(form.settings.drive_semester || '').trim().match(/^(20\d{2})\s*[-/]\s*([12])$/)
    const fieldId = form.settings.drive_course_field_id
    if (!match) {
      setCourseLoadError('학기를 2026-2처럼 입력한 뒤 불러오세요.')
      return
    }
    if (!fieldId) {
      setCourseLoadError('먼저 위에서 “과목 선택 질문”을 지정하세요.')
      return
    }
    setLoadingCourses(true)
    setCourseLoadError(null)
    try {
      const data = await api.get('/offerings', { year: match[1], term: match[2] })
      const options = (data.items || []).map((item) => String(item.name_ko || '').trim()).filter(Boolean)
      if (!options.length) throw new Error(`${form.settings.drive_semester}에 등록된 개설 과목이 없습니다.`)
      setFields(form.fields.map((field) => field.id === fieldId ? { ...field, options } : field))
    } catch (err) {
      setCourseLoadError(err.message || '개설 과목을 불러오지 못했습니다.')
    } finally {
      setLoadingCourses(false)
    }
  }

  const { dragIndex, overIndex, rowProps } = useDragSort((from, to) => {
    const next = [...form.fields]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setFields(next)
  })

  const backTo = '/admin/forms'
  const leave = () => {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 나갈까요?')) return
    navigate(backTo)
  }

  const save = async (e) => {
    e?.preventDefault()
    if (busy) return
    if (!canSaveForm) {
      setSaveError('폼 제목이 필요합니다')
      setTab('questions')
      setActiveId('header')
      return
    }
    setBusy(true)
    setSaveError(null)
    setSaveIssues([])
    try {
      const payload = toPayload(form)
      if (isNew) {
        const res = await api.post('/admin/forms', payload)
        navigate(`/admin/forms/${res.item.id}/edit`, { replace: true, state: { justSaved: true } })
        return
      }
      await api.put(`/admin/forms/${id}`, payload)
      savedSnap.current = JSON.stringify(form)
      setSavedAt(new Date())
    } catch (err) {
      setSaveError(err.hint ? `${err.message} (${err.hint})` : err.message)
      // 공개 사전검사 실패(422)는 해결법이 담긴 목록을 함께 돌려주므로 그대로 보여준다.
      setSaveIssues(Array.isArray(err.body?.issues) ? err.body.issues : [])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        document.getElementById('form-editor')?.requestSubmit()
      }
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPreview(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const status = formStatus(form.published, {
    accept_start: fromLocalInput(form.settings.accept_start),
    accept_end: fromLocalInput(form.settings.accept_end),
  })
  const responseCount = resp.data?.total
  let pageNo = 1

  const driveProps = {
    settings: form.settings,
    setSetting,
    setSettingInput,
    courseFieldOptions,
    loadSemesterCourses,
    loadingCourses,
    courseError: courseLoadError,
    connections: driveStatus?.connections ?? [],
    templates: driveStatus?.templates ?? DEFAULT_TEMPLATES,
    formTitle: form.title_ko,
    category: form.category,
    formId: id ? Number(id) : null,
    onPrepare: runPrepare,
    preparing,
  }

  return (
    <section className="isolate min-h-[100dvh] bg-bg-base pb-80 text-text-pri">
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg-panel">
        <div className="flex min-h-64 flex-wrap items-center justify-between gap-12 px-16 py-8 md:px-24">
          <div className="flex min-w-0 items-center gap-12">
            <button type="button" onClick={leave} className="flex h-11 shrink-0 cursor-pointer items-center gap-8 rounded-sm px-12 text-body-m font-semibold text-text-sec transition hover:bg-glass-strong" aria-label="신청 폼 목록으로 돌아가기">
              <ArrowLeft size={18} aria-hidden="true" /> <span className="hidden sm:inline">목록</span>
            </button>
            <FileText size={24} className="shrink-0 text-purple-light" aria-hidden="true" />
            <p className={`min-w-0 max-w-[420px] truncate text-body-l-m font-medium ${form.title_ko ? INK : 'text-text-meta'}`}>{form.title_ko || '제목 없는 폼'}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-8">
            <span aria-live="polite" className={`hidden text-small-m lg:block ${dirty ? 'font-semibold text-purple-light' : SUB}`}>
              {busy ? '저장 중' : dirty ? '저장 전' : savedAt ? '저장됨' : ''}
            </span>
            <button type="button" onClick={() => setTab('settings')} className={`h-32 cursor-pointer rounded-sm border bg-transparent px-12 text-small-m font-semibold ${STATUS_TONE[status.tone]}`} title="공개 설정으로 이동">
              {status.label}
            </button>
            <GhostButton onClick={() => setPreview(true)} className="border-border-subtle text-text-sec">
              <Eye size={16} aria-hidden="true" />
              <span className="hidden sm:inline">미리보기</span>
            </GhostButton>
            <GhostButton onClick={copyPublicUrl} disabled={!form.slug} className="border-border-subtle text-text-sec" title="신청 페이지 주소 복사">
              {copied ? <Check size={16} aria-hidden="true" /> : <LinkIcon size={16} aria-hidden="true" />}
              <span className="hidden md:inline">{copied ? '복사됨' : '주소 복사'}</span>
            </GhostButton>
            <PrimaryButton type="submit" form="form-editor" disabled={busy || (!dirty && !isNew)}>
              <Save size={16} aria-hidden="true" />
              {busy ? '저장 중' : '저장'}
            </PrimaryButton>
          </div>
        </div>
        <div role="tablist" aria-label="폼 편집 구역" className="flex justify-center gap-8 px-16">
          {Object.entries(TAB_LABEL).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`h-48 cursor-pointer border-b-[3px] px-16 text-body-m font-semibold transition ${tab === key ? 'border-purple-primary text-purple-light' : 'border-transparent text-text-sec hover:bg-glass-strong'}`}
            >
              {label}
              {key === 'responses' && typeof responseCount === 'number' && (
                <span className="ml-8 rounded-full bg-glass-strong px-8 py-4 text-caption-m text-button-primaryText">{responseCount}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      {!isNew && !hydrated ? (
        <div className="flex flex-col items-start gap-16 p-24">
          {loading && <p className={`text-small-m ${SUB}`}>기존 내용을 불러오는 중</p>}
          {error && (
            <>
              <ErrorText>{error.message}</ErrorText>
              <GhostButton onClick={refetch}>다시 불러오기</GhostButton>
            </>
          )}
        </div>
      ) : (
        <form id="form-editor" onSubmit={save} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault() }} className="mx-auto mt-24 flex w-full max-w-[770px] flex-col gap-16 px-16 md:px-0">
          {tab === 'questions' && (
            <>
              <div data-card-id="header" className="relative">
                {/* 클릭 처리는 카드에만 건다. 추가 도구까지 감싸면 도구를 눌렀을 때 클릭이 위로 올라와 방금 만든 질문 대신 제목 카드가 다시 선택된다 */}
                <div onClick={() => setActiveId('header')} className={`${CARD} gap-16 border-t-[10px] border-t-purple-primary p-24 md:p-32 ${activeId === 'header' ? 'border-l-[6px] border-l-purple-primary' : ''}`}>
                  <input
                    aria-label="폼 제목"
                    autoFocus={isNew}
                    value={form.title_ko}
                    onChange={setInput('title_ko')}
                    placeholder="폼 제목"
                    className={`w-full !rounded-none !border-0 !border-b !border-border-subtle !bg-transparent px-0 pb-8 text-h2-m font-bold ${INK} outline-none transition focus:!border-b-2 focus:!border-purple-primary focus:ring-0 md:text-h2-d`}
                  />
                  <textarea
                    aria-label="폼 안내문"
                    rows={4}
                    value={form.description_ko}
                    onChange={setInput('description_ko')}
                    placeholder="폼 설명"
                    className={`w-full resize-y !rounded-none !border-0 !border-b !border-border-subtle !bg-transparent px-0 pb-8 text-body-m ${INK} outline-none transition focus:!border-b-2 focus:!border-purple-primary focus:ring-0`}
                  />
                </div>
                {activeId === 'header' && <AddToolbar onAdd={addField} />}
              </div>

              {form.fields.length === 0 && (
                <button
                  type="button"
                  onClick={() => addField('radio')}
                  className={`flex min-h-160 w-full cursor-pointer flex-col items-center justify-center gap-12 rounded-md border-2 border-dashed border-border-purple bg-bg-panel px-24 text-center ${INK} transition hover:border-purple-primary hover:bg-glass-bg`}
                >
                  <span className="flex h-40 w-40 items-center justify-center rounded-full bg-glass-bg text-purple-light">
                    <Plus size={20} aria-hidden="true" />
                  </span>
                  <span className="text-body-m font-semibold">첫 질문 추가</span>
                  <span className={`text-small-m ${SUB}`}>이름, 학번, 참석 여부처럼 받고 싶은 내용을 하나씩 만듭니다</span>
                </button>
              )}

              <ul className="flex flex-col gap-16">
                {form.fields.map((field, i) => {
                  const common = {
                    field,
                    index: i,
                    total: form.fields.length,
                    active: activeId === field.id,
                    onActivate: () => setActiveId(field.id),
                    onChange: (next) => setFields(form.fields.map((f, idx) => (idx === i ? next : f))),
                    onRemove: () => {
                      setFields(form.fields.filter((_, idx) => idx !== i))
                      setActiveId('header')
                    },
                    onMove: (d) => moveField(i, d),
                    dragging: dragIndex === i,
                    over: overIndex === i && dragIndex !== null && dragIndex !== i,
                    rowProps,
                    armed: armed === i,
                    onArm: (on) => setArmed(on ? i : null),
                  }
                  const toolbar = activeId === field.id ? <AddToolbar onAdd={addField} /> : null
                  if (field.type === 'section') {
                    pageNo += 1
                    return (
                      <li key={field.id} className="relative list-none">
                        <SectionCard {...common} pageNo={pageNo} />
                        {toolbar}
                      </li>
                    )
                  }
                  return (
                    <li key={field.id} className="relative list-none">
                      <QuestionCard
                        {...common}
                        onDuplicate={() => {
                          const copy = normField({ ...field, id: `f${Date.now().toString(36)}` }, i + 1, form.settings)
                          const next = [...form.fields]
                          next.splice(i + 1, 0, copy)
                          setFields(next)
                          setActiveId(copy.id)
                        }}
                        driveProps={{ ...driveProps, prepareResult: prepareResults[field.id] }}
                      />
                      {toolbar}
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {tab === 'responses' && <ResponsesTab formId={id ? Number(id) : null} fields={form.fields} resp={resp} />}

          {tab === 'settings' && (
            <SettingsTab
              form={form}
              set={set}
              setSetting={setSetting}
              setSettingInput={setSettingInput}
              publicUrl={publicUrl}
              onCopy={copyPublicUrl}
              copied={copied}
            />
          )}

          <ErrorText>{saveError}</ErrorText>
          {saveIssues.length > 0 && (
            <ul className="flex flex-col gap-4 rounded-sm border border-state-error/40 bg-bg-elev p-12 text-small-m text-state-error">
              {saveIssues.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </form>
      )}

      {preview && (
        <div role="dialog" aria-modal="true" aria-label="미리보기" className="fixed inset-0 z-[60] overflow-y-auto bg-bg-base/70 p-16 md:p-32" onMouseDown={() => setPreview(false)}>
          <div className="mx-auto min-h-full w-full max-w-3xl rounded-md bg-bg-base shadow-card-glow" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-12 rounded-t-md border-b border-border-subtle bg-bg-panel px-20 py-12">
              <div className="min-w-0">
                <p className={`text-body-m font-bold ${INK}`}>미리보기</p>
              </div>
              <button type="button" className={ICON_BTN} onClick={() => setPreview(false)} aria-label="미리보기 닫기"><X size={18} /></button>
            </div>
            <div className="p-16 md:p-32">
              <div className="rounded-md border-t-[10px] border-purple-primary bg-bg-panel p-24 shadow-sm md:p-32">
                <h2 className={`text-h2-m font-bold ${INK}`}>{form.title_ko || '제목 없는 폼'}</h2>
                {form.description_ko && <p className={`mt-12 whitespace-pre-wrap text-body-m leading-relaxed ${SUB}`}>{form.description_ko}</p>}
                <div className="mt-24">
                  <FormRenderer fields={form.fields} value={previewValue} onChange={(fieldId, v) => setPreviewValue((prev) => ({ ...prev, [fieldId]: v }))} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default FormEditor
