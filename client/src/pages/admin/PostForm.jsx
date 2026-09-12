// PostForm.jsx — /admin/posts/:type/new·:id/edit 공용 작성 폼 (13_CMS_SPEC 1절 편집 매트릭스)
// 템플릿: t1 게시글형(제목 ko/en+태그+본문) / t2 포스터형(+포스터·일정·외부 URL) /
// exhibition T2 확장(전시회 테이블) / achievement 성좌 전용 필드 / portfolio 진로 그리드.
// 성과(achievement)는 posts로 저장: body={desc,descEn,year,awardees,awardeesEn}, tag=연도 (B1 계약).

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Paperclip, Plus, Trash2, X } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import RichEditor from '../../components/editor/RichEditor'
import ImageUpload from '../../components/admin/ImageUpload'
import {
  EmptyNote,
  ErrorText,
  Field,
  GhostButton,
  Input,
  PageHead,
  PrimaryButton,
  TextArea,
  Toggle,
  DateInput,
  Select,
} from '../../components/admin/FormControls'
import { POST_TYPES } from './postTypes'
import { exhibitionFullTitle } from '../../data/exhibitionTitle'
import {
  CONTEST_CATEGORY,
  CONTEST_CATEGORY_OPTIONS,
} from '../../data/contestCategory'

const ICON_BTN =
  'flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-32 md:w-32'

// '' → null 정규화 — PG date·url 컬럼에 빈 문자열 삽입 방지
const nul = (v) => (v === '' || v === undefined ? null : v)
const dateOf = (v) => (v ? String(v).slice(0, 10) : '')

// R1: 발행 게이트 안내 — enRequired 유형은 영문 제목 없이 발행 불가(임시저장은 허용)
const EN_GATE_MSG = '영문 제목을 입력해야 발행할 수 있습니다. 임시저장은 영문 없이도 가능합니다.'

/** 태그 선택·관리 — 공용 태그 저장소 (GET /tags, K1-1). 칩 클릭 선택 + 인라인 생성·삭제 */
function TagField({ value, onChange }) {
  const { data, refetch } = useApi('/tags')
  const tags = data?.items || []
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/admin/tags', { name: trimmed })
      onChange(trimmed)
      setName('')
      refetch()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeTag = async (tag) => {
    if (
      !window.confirm(
        `"${tag}" 태그를 삭제하시겠습니까? 이 태그가 지정된 게시물의 태그가 해제됩니다.`
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      await api.del(`/admin/tags/${encodeURIComponent(tag)}`)
      if (value === tag) onChange('')
      refetch()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-8">
          {tags.map((tag) => (
            <li
              key={tag}
              className={`inline-flex items-center overflow-hidden rounded-sm border transition duration-fast ease-out ${
                value === tag
                  ? 'border-bg-invert bg-bg-invert'
                  : 'border-border-subtle bg-transparent hover:border-border-strong'
              }`}
            >
              <button
                type="button"
                onClick={() => onChange(value === tag ? '' : tag)}
                aria-pressed={value === tag}
                className={`cursor-pointer py-4 pl-12 pr-8 text-small-m transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus ${
                  value === tag ? 'text-text-invert' : 'text-text-sec hover:text-text-pri'
                }`}
              >
                {tag}
              </button>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={busy}
                aria-label={`${tag} 태그 삭제`}
                className={`cursor-pointer py-4 pr-8 transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 ${
                  value === tag ? 'text-text-invert' : 'text-text-meta hover:text-text-pri'
                }`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-caption-m text-text-meta">
          등록된 태그가 없습니다. 새 태그를 생성하세요.
        </p>
      )}
      <div className="flex items-center gap-8">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              create()
            }
          }}
          placeholder="새 태그 이름"
          aria-label="새 태그 이름"
        />
        <GhostButton onClick={create} disabled={busy || !name.trim()}>
          <Plus size={16} aria-hidden="true" />
          생성
        </GhostButton>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

/** 첨부 목록 — 문서 첨부 attachments jsonb [{ name, url }] (K1-3: gallery와 분리) */
function AttachmentsField({ value = [], onChange, onUploadingChange }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    onUploadingChange?.(true)
    try {
      const res = await api.upload(file, { usage: 'general' })
      if (!res?.url) throw new Error('업로드 응답에 url이 없습니다.')
      onChange([...value, { name: file.name, url: res.url }])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      onUploadingChange?.(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {value.map((file, i) => (
        <div key={`${file.url}-${i}`} className="flex min-w-0 items-center gap-8">
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-8 truncate font-mono text-small-m text-text-sec underline underline-offset-4 hover:text-text-pri"
          >
            <Paperclip size={16} aria-hidden="true" />
            <span className="truncate">{file.name || file.url.split('/').pop()}</span>
          </a>
          <button
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            aria-label="첨부 제거"
            className={ICON_BTN}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <div>
        <GhostButton onClick={() => inputRef.current && inputRef.current.click()} disabled={busy}>
          <Plus size={16} aria-hidden="true" />
          {busy ? '업로드 중' : '첨부 추가'}
        </GhostButton>
      </div>
      <ErrorText>{error}</ErrorText>
      <input
        ref={inputRef}
        type="file"
        accept=".hwp,.hwpx,.pdf,.docx,.xlsx,.pptx,.zip,.jpg,.jpeg,.png,.webp,.gif"
        onChange={handleFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}

/** 이미지 갤러리 — gallery jsonb [url] (이미지 URL 문자열 배열, K1-3 데이터 계약) */
function GalleryField({ value = [], onChange, usage = 'exhibition', onUploadingChange }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    onUploadingChange?.(true)
    try {
      const res = await api.upload(file, { usage })
      if (!res?.url) throw new Error('업로드 응답에 url이 없습니다.')
      onChange([...value, res.url])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      onUploadingChange?.(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-8">
          {value.map((url, i) => (
            <li key={`${url}-${i}`} className="relative">
              <img
                src={url}
                alt={`갤러리 이미지 ${i + 1}`}
                loading="lazy"
                className="h-64 w-64 rounded-md border border-border-subtle bg-bg-elev object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                aria-label={`갤러리 이미지 ${i + 1} 제거`}
                className="absolute -right-8 -top-8 flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm border border-glass-line bg-glass-bg text-text-sec backdrop-blur-glass-mobile transition duration-fast ease-out hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-24 md:w-24"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <GhostButton onClick={() => inputRef.current && inputRef.current.click()} disabled={busy}>
          <Plus size={16} aria-hidden="true" />
          {busy ? '업로드 중' : '이미지 추가'}
        </GhostButton>
      </div>
      <ErrorText>{error}</ErrorText>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}

// ── 템플릿별 폼 상태 ↔ 페이로드 매핑 ─────────────────────────────

function emptyForm(template, type) {
  switch (template) {
    case 'achievement':
      return {
        title_ko: '',
        title_en: '',
        desc: '',
        descEn: '',
        awardees: '',
        awardeesEn: '',
        year: '',
        external_url: '',
        published: true,
      }
    case 'exhibition':
      return {
        title: '',
        title_en: '', // R1: 전시명 영문
        ordinal: '', // N1-2: 회차. full_title은 exhibitionFullTitle(ordinal)로 파생
        semester_label: '',
        poster_url: '',
        site_url: '',
        intro: '',
        intro_en: '', // R1: 소개 영문
        body: null,
        body_en: null, // R1: 전시 상세 영문 리치 본문
        gallery: [],
        start_date: '', // N1-3: 개최일 = 시작일 (held_at 제거)
        end_date: '',
        is_featured: false,
        cta_show: true, // Q2: 상단 고정 시 CTA 버튼 노출·텍스트·링크
        cta_label: '',
        cta_url: '',
        published: true,
      }
    case 'portfolio':
      return { student_no: '', name: '', majors: '', link: '', sort: 0 }
    default: {
      // t1 · t2 공용 (posts). gallery = 이미지 URL 배열, attachments = [{name,url}] 문서 (K1-3 분리)
      const base = {
        title_ko: '',
        title_en: '',
        tag: '',
        body: null,
        body_en: null, // R1: 영문 본문(국문과 분리). contest는 미사용
        poster_url: '',
        external_url: '',
        event_start: '',
        event_end: '',
        gallery: [],
        attachments: [],
        published: true,
        pinned: false,
        has_bg: false, // M1-1: 동아리 로고 배경 프레임
      }
      // 51_CONTEST_SPLIT: 공모전은 회차 하나가 곧 게시글 — 학기·기간·주최를 행이 직접 갖는다
      if (type === 'contest') {
        base.host = ''
        base.semester_label = ''
        base.period = ''
        base.category = ''
        base.category_etc = ''
      }
      // Y3-5(33_PHASE18): 동아리 공식 사이트 URL — 상세 페이지 링크 버튼
      if (type === 'club') base.site_url = ''
      return base
    }
  }
}

function fromItem(template, item, type) {
  const base = emptyForm(template, type)
  switch (template) {
    case 'achievement':
      return {
        ...base,
        title_ko: item.title_ko || '',
        title_en: item.title_en || '',
        desc: item.body?.desc || '',
        descEn: item.body?.descEn || '',
        awardees: item.body?.awardees || '',
        awardeesEn: item.body?.awardeesEn || '',
        year: item.body?.year ?? item.tag ?? '',
        external_url: item.external_url || '',
        published: Boolean(item.published),
      }
    case 'exhibition':
      return {
        ...base,
        title: item.title || '',
        title_en: item.title_en || '', // R1
        ordinal: item.ordinal ?? '',
        semester_label: item.semester_label || '',
        poster_url: item.poster_url || '',
        site_url: item.site_url || '',
        intro: item.intro || '',
        intro_en: item.intro_en || '', // R1
        body: item.body || null,
        body_en: item.body_en || null, // R1
        gallery: Array.isArray(item.gallery) ? item.gallery : [],
        start_date: dateOf(item.start_date),
        end_date: dateOf(item.end_date),
        is_featured: Boolean(item.is_featured),
        cta_show: item.cta_show !== false,
        cta_label: item.cta_label || '',
        cta_url: item.cta_url || '',
        published: Boolean(item.published),
      }
    case 'portfolio':
      return {
        ...base,
        student_no: item.student_no || '',
        name: item.name || '',
        majors: item.majors || '',
        link: item.link || '',
        sort: item.sort ?? 0,
      }
    default: {
      const next = {
        ...base,
        title_ko: item.title_ko || '',
        title_en: item.title_en || '',
        tag: item.tag || '',
        body: item.body || null,
        body_en: item.body_en || null, // R1: 영문 본문
        poster_url: item.poster_url || '',
        external_url: item.external_url || '',
        event_start: dateOf(item.event_start),
        event_end: dateOf(item.event_end),
        // K1-3: gallery는 이미지 URL 문자열만 (과거 gallery에 저장된 [{name,url}] 첨부는 제외)
        gallery: Array.isArray(item.gallery)
          ? item.gallery.filter((g) => typeof g === 'string')
          : [],
        attachments: Array.isArray(item.attachments) ? item.attachments : [],
        published: Boolean(item.published),
        pinned: Boolean(item.pinned),
        has_bg: Boolean(item.has_bg),
      }
      // 51_CONTEST_SPLIT: 공모전 프리필. host는 컬럼이 원본이고, 분리 이전 묶음 post가
      // 남아 있을 경우를 대비해 body.host(문자열·배열)도 폴백으로 읽는다.
      if (type === 'contest') {
        const hostRaw = item.host ?? item.body?.host
        next.host = Array.isArray(hostRaw) ? hostRaw.join('\n') : hostRaw || ''
        next.semester_label = item.semester_label || ''
        next.period = item.period || ''
        next.category = item.category || ''
        next.category_etc = item.category_etc || ''
      }
      // Y3-5: 동아리 사이트 URL (레거시 external_url 폴백)
      if (type === 'club') next.site_url = item.site_url || item.external_url || ''
      return next
    }
  }
}

function toPayload(template, config, form, type) {
  switch (template) {
    case 'achievement': {
      const year = form.year === '' ? null : Number(form.year)
      return {
        title_ko: form.title_ko,
        title_en: nul(form.title_en),
        tag: year === null ? null : String(year),
        body: {
          desc: form.desc,
          descEn: form.descEn,
          year,
          awardees: form.awardees,
          awardeesEn: form.awardeesEn,
        },
        external_url: nul(form.external_url),
        published: form.published,
      }
    }
    case 'exhibition':
      return {
        title: form.title,
        title_en: nul(form.title_en), // R1: 전시명 영문
        ordinal: form.ordinal === '' ? null : Number(form.ordinal),
        semester_label: nul(form.semester_label),
        poster_url: nul(form.poster_url),
        site_url: nul(form.site_url),
        intro: nul(form.intro),
        intro_en: nul(form.intro_en), // R1: 소개 영문
        body: form.body,
        body_en: form.body_en, // R1: 전시 상세 영문 리치 본문
        gallery: form.gallery,
        start_date: nul(form.start_date),
        end_date: nul(form.end_date),
        is_featured: form.is_featured,
        // Q2: 상단 고정일 때만 CTA 저장(끄면 값 비움)
        cta_show: form.is_featured ? form.cta_show : false,
        cta_label: form.is_featured ? nul(form.cta_label) : null,
        cta_url: form.is_featured ? nul(form.cta_url) : null,
        published: form.published,
      }
    case 'portfolio':
      return {
        student_no: nul(form.student_no),
        name: form.name,
        majors: nul(form.majors),
        link: nul(form.link),
        sort: form.sort === '' ? 0 : Number(form.sort),
      }
    default: {
      const payload = {
        title_ko: form.title_ko,
        title_en: nul(form.title_en),
        tag: nul(form.tag),
        body: form.body,
        // K1-3: gallery = 이미지 URL 배열 (전 유형), attachments = [{name,url}] 문서 첨부
        gallery: form.gallery,
        published: form.published,
        pinned: form.pinned,
        has_bg: form.has_bg, // M1-1: 동아리 로고 배경 프레임 (기타 유형은 기본 false)
      }
      // R1: EN 본문 — contest는 리치 본문을 쓰지 않는다
      if (type !== 'contest') payload.body_en = form.body_en
      if (template === 't2') {
        payload.poster_url = nul(form.poster_url)
        payload.external_url = nul(form.external_url)
        payload.event_start = nul(form.event_start)
        payload.event_end = nul(form.event_end)
      }
      // Q3: 동아리 로고(poster_url) 저장. Y3-5: 사이트 URL(site_url)
      if (type === 'club') {
        payload.poster_url = nul(form.poster_url)
        payload.site_url = nul(form.site_url)
      }
      // 51_CONTEST_SPLIT: 공모전은 전용 컬럼에 저장한다(body는 쓰지 않는다)
      if (type === 'contest') {
        payload.body = null
        payload.semester_label = nul(form.semester_label)
        payload.period = nul(form.period)
        payload.host = nul(form.host)
        payload.category = nul(form.category)
        // 직접 입력값은 '기타'일 때만 의미가 있다 — 다른 종류로 바꾸면 비운다
        payload.category_etc =
          form.category === CONTEST_CATEGORY.ETC ? nul(form.category_etc) : null
      }
      if (config.attachments) payload.attachments = form.attachments
      return payload
    }
  }
}

// ── 페이지 ─────────────────────────────────────────────────────

function PostForm() {
  const { type, id } = useParams()
  const navigate = useNavigate()
  const config = POST_TYPES[type]
  const template = config?.template || 't1'
  const isNew = !id
  useTitle(config ? `${config.label} ${isNew ? '작성' : '수정'}` : '콘텐츠 관리')

  const { data, loading, error, refetch } = useApi(
    config && !isNew ? `/admin/content/${type}/${id}` : null
  )
  const [form, setForm] = useState(() => emptyForm(template, type))
  const [hydrated, setHydrated] = useState(isNew)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0) // 진행 중 업로드 수 — 0보다 크면 저장 차단
  const [saveError, setSaveError] = useState(null)
  const onUploadingChange = (active) =>
    setUploading((n) => Math.max(0, n + (active ? 1 : -1)))

  // 편집 모드 — 단건 도착 시 1회 주입
  useEffect(() => {
    if (hydrated || !data?.item) return
    setForm(fromItem(template, data.item, type))
    setHydrated(true)
  }, [hydrated, data, template, type])

  if (!config) return <EmptyNote>알 수 없는 콘텐츠 유형입니다</EmptyNote>

  const set = (key) => (v) => setForm((prev) => ({ ...prev, [key]: v }))
  const setInput = (key) => (e) => set(key)(e.target.value)

  // 전시 기간: 시작일을 고르면 종료일이 비었거나 시작일보다 이르던 경우 시작일로 맞춘다.
  // 'YYYY-MM-DD' 고정 폭이라 문자열 비교가 곧 날짜 비교다.
  const setStartDate = (e) => {
    const start = e.target.value
    setForm((prev) => ({
      ...prev,
      start_date: start,
      end_date: start && (!prev.end_date || prev.end_date < start) ? start : prev.end_date,
    }))
  }
  const backTo = `/admin/posts/${type}`

  // R1/U2-2: 발행 게이트 — enRequired 유형은 영문 제목 필수. achievement는 발행 시
  // 국·영문 본문과 수상자(국·영)까지 모두 필수(게시 끄면 임시저장 허용). 누락 필드는 안내에 나열.
  const isEmptyVal = (v) => !String(v ?? '').trim()
  let missingFields = []
  if (form.published) {
    if (template === 'achievement') {
      missingFields = [
        ['수상명', form.title_ko],
        ['영문 수상명', form.title_en],
        ['국문 본문', form.desc],
        ['영문 본문', form.descEn],
        ['수상자 (국문)', form.awardees],
        ['수상자 (영문)', form.awardeesEn],
      ]
        .filter(([, v]) => isEmptyVal(v))
        .map(([label]) => label)
    } else if (config.enRequired && isEmptyVal(form.title_en)) {
      missingFields = ['영문 제목']
    }
  }
  const enGateBlocked = missingFields.length > 0
  const gateMsg =
    template === 'achievement'
      ? `발행하려면 다음을 입력하세요: ${missingFields.join(', ')}`
      : EN_GATE_MSG
  const isPosts = template === 't1' || template === 't2' || template === 'achievement'
  // 새 콘텐츠의 기본 상태에서는 제목/이름이 없으면 저장할 수 없다. 다만 선택형 설정값은
  // 비워 저장하는 것이 유효한 편집이므로 이 게이트에 넣지 않는다.
  const requiredIdentityComplete = isPosts
    ? !isEmptyVal(form.title_ko)
    : template === 'exhibition'
      ? !isEmptyVal(form.title)
      : template === 'portfolio'
        ? !isEmptyVal(form.name)
        : true
  const canSave =
    requiredIdentityComplete && !busy && uploading === 0 && (isNew || hydrated) && !enGateBlocked

  const save = async (e) => {
    e.preventDefault()
    if (!canSave) return
    // R1/U2-2: 발행 게이트 — 필수 필드 미입력 시 게시 차단(게시 끄면 임시저장 가능)
    if (enGateBlocked) {
      setSaveError(gateMsg)
      return
    }
    setBusy(true)
    setSaveError(null)
    try {
      const payload = toPayload(template, config, form, type)
      if (isNew) await api.post(`/admin/content/${type}`, payload)
      else await api.put(`/admin/content/${type}/${id}`, payload)
      navigate(backTo)
    } catch (err) {
      setSaveError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title={`${config.label} ${isNew ? '작성' : '수정'}`}
        actions={<GhostButton onClick={() => navigate(backTo)}>목록</GhostButton>}
      />

      {/* G3: 수정 모드는 기존 값이 채워진 뒤에만 폼 렌더 — 빈 폼 노출·빈 값 저장 방지 */}
      {!isNew && !hydrated ? (
        <div className="flex flex-col items-start gap-16">
          {loading && (
            <p className="font-mono text-caption-m text-text-meta">
              기존 내용을 불러오는 중
            </p>
          )}
          {error && (
            <>
              <ErrorText>{error.message}</ErrorText>
              <GhostButton onClick={refetch}>다시 불러오기</GhostButton>
            </>
          )}
        </div>
      ) : (
      <form onSubmit={save} className="flex flex-col gap-24">
        <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
          {/* 제목 — posts 계열 ko/en, 전시회·포트폴리오는 테이블 컬럼 */}
          {isPosts && (
            <>
              <Field label={template === 'achievement' ? '수상명' : '제목 (국문)'}>
                <Input value={form.title_ko} onChange={setInput('title_ko')} required />
              </Field>
              <Field label="제목 (영문)" hint="비우면 영문 페이지에 Korean only 뱃지">
                <Input value={form.title_en} onChange={setInput('title_en')} />
              </Field>
            </>
          )}

          {template === 't1' && config.tags && (
            <div className="md:col-span-2">
              <Field label="태그" hint="클릭해 선택, 다시 클릭해 해제합니다">
                <TagField value={form.tag} onChange={set('tag')} />
              </Field>
            </div>
          )}

          {/* Q3: 동아리 로고 업로드 — poster_url. 투명 PNG는 아래 "배경" 토글과 함께 사용 */}
          {type === 'club' && (
            <>
              <div className="md:col-span-2">
                <Field label="로고" hint="투명 PNG면 아래 배경 토글을 켜세요">
                  <ImageUpload
                    value={form.poster_url}
                    onChange={set('poster_url')}
                    usage="poster"
                    onUploadingChange={onUploadingChange}
                  />
                </Field>
              </div>
              {/* Y3-5: 동아리 사이트 — 상세 페이지 로고 아래 "웹사이트" 버튼(새 탭) */}
              <div className="md:col-span-2">
                <Field label="사이트 URL" hint="상세 페이지에 새 탭 링크 버튼으로 노출됩니다">
                  <Input type="url" value={form.site_url} onChange={setInput('site_url')} />
                </Field>
              </div>
            </>
          )}

          {template === 't2' && (
            <>
              <Field label="일정 시작">
                <DateInput value={form.event_start} onChange={setInput('event_start')} />
              </Field>
              <Field label="일정 종료">
                <DateInput value={form.event_end} onChange={setInput('event_end')} />
              </Field>
              <Field
                label={type === 'contest' ? '전시 사이트 URL' : '외부 접수 URL'}
                hint={type === 'contest' ? '새 탭으로 전시 사이트를 엽니다' : undefined}
              >
                <Input type="url" value={form.external_url} onChange={setInput('external_url')} />
              </Field>
              <div className="md:col-span-2">
                <Field label="포스터">
                  <ImageUpload
                    value={form.poster_url}
                    onChange={set('poster_url')}
                    usage="poster"
                    onUploadingChange={onUploadingChange}
                  />
                </Field>
              </div>
            </>
          )}

          {/* 51_CONTEST_SPLIT: 공모전 전용 — 주최·학기·기간. 회차 리피터는 폐지됐다 */}
          {type === 'contest' && (
            <>
              <div className="md:col-span-2">
                <Field label="주최" hint="여러 줄 입력 가능">
                  <TextArea rows={3} value={form.host} onChange={setInput('host')} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="종류" hint="공개 페이지에서 이 종류끼리 한 섹션으로 묶입니다">
                  <Select
                    value={form.category}
                    options={CONTEST_CATEGORY_OPTIONS}
                    placeholder="종류 선택"
                    onChange={(e) => set('category')(e.target.value)}
                  />
                </Field>
              </div>
              {form.category === CONTEST_CATEGORY.ETC && (
                <div className="md:col-span-2">
                  <Field label="종류 직접 입력" hint="기타를 고른 경우에만 사용합니다">
                    <Input
                      value={form.category_etc}
                      onChange={setInput('category_etc')}
                    />
                  </Field>
                </div>
              )}
              <Field label="학기 라벨" hint="예: 2026-1. 목록 정렬 기준">
                <Input value={form.semester_label} onChange={setInput('semester_label')} />
              </Field>
              <Field label="기간" hint="예: 2026-03-02 ~ 2026-03-20">
                <Input value={form.period} onChange={setInput('period')} />
              </Field>
            </>
          )}

          {template === 'achievement' && (
            <>
              <div className="md:col-span-2">
                <Field label="국문 본문">
                  <TextArea rows={5} value={form.desc} onChange={setInput('desc')} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="영문 본문" hint="비우면 영문 페이지에 국문 본문 렌더">
                  <TextArea rows={5} value={form.descEn} onChange={setInput('descEn')} />
                </Field>
              </div>
              <Field label="수상자 (국문)" hint="쉼표로 구분">
                <Input value={form.awardees} onChange={setInput('awardees')} />
              </Field>
              <Field label="수상자 (영문)" hint="쉼표로 구분">
                <Input value={form.awardeesEn} onChange={setInput('awardeesEn')} />
              </Field>
              <Field label="연도" hint="성좌 태그로 사용됩니다">
                <Input
                  type="number"
                  value={form.year}
                  onChange={(e) => set('year')(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
              <Field label="대회 URL">
                <Input type="url" value={form.external_url} onChange={setInput('external_url')} />
              </Field>
            </>
          )}

          {template === 'exhibition' && (
            <>
              <Field label="전시명">
                <Input value={form.title} onChange={setInput('title')} required />
              </Field>
              <Field label="전시명 (영문)" hint="비우면 영문 페이지에 Korean only 뱃지">
                <Input value={form.title_en} onChange={setInput('title_en')} />
              </Field>
              {/* N1-2: 회차(정수). 전체 전시명은 exhibitionFullTitle로 자동 파생(DB 미저장) */}
              <Field
                label="회차"
                hint={
                  exhibitionFullTitle(form.ordinal) ||
                  '숫자만 입력 (예: 8). 전체 전시명이 자동 생성됩니다'
                }
              >
                <Input
                  type="number"
                  min="1"
                  value={form.ordinal}
                  onChange={(e) => set('ordinal')(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
              <Field label="학기 라벨" hint="예: 2026-2">
                <Input value={form.semester_label} onChange={setInput('semester_label')} />
              </Field>
              {/* M1-2: 전시 기간. N1-3: 시작일 = 개최일. 시작일·종료일은 한 줄에 나란히 둔다 */}
              <Field label="시작일" hint="개최일">
                <DateInput value={form.start_date} onChange={setStartDate} />
              </Field>
              <Field label="종료일">
                {/* 종료일이 비어 있으면 시작일 달에서 열린다(viewDate) */}
                <DateInput
                  value={form.end_date}
                  viewDate={form.start_date}
                  onChange={setInput('end_date')}
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="전시 사이트 URL">
                  <Input type="url" value={form.site_url} onChange={setInput('site_url')} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="소개">
                  <TextArea rows={3} value={form.intro} onChange={setInput('intro')} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="소개 (영문)">
                  <TextArea rows={3} value={form.intro_en} onChange={setInput('intro_en')} />
                </Field>
              </div>
              {/* 전시회 소개(리치)·소개 영문(리치)은 렌더하지 않는다. body·body_en 컬럼과
                  프리필·저장 경로는 그대로 두므로 기존 값은 보존되고 다시 노출만 하면 복구된다. */}
              <div className="md:col-span-2">
                <Field label="포스터">
                  <ImageUpload
                    value={form.poster_url}
                    onChange={set('poster_url')}
                    usage="poster"
                    onUploadingChange={onUploadingChange}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="갤러리">
                  <GalleryField
                    value={form.gallery}
                    onChange={set('gallery')}
                    onUploadingChange={onUploadingChange}
                  />
                </Field>
              </div>
              {/* Q2: 상단 고정을 켜면 CTA 버튼 입력 노출(표시 여부·텍스트·링크). 끄면 숨김 */}
              {form.is_featured && (
                <div className="flex flex-col gap-16 rounded-md border border-border-subtle p-16 md:col-span-2">
                  <div className="flex flex-wrap items-center gap-24">
                    <Field label="버튼 표시">
                      <Toggle
                        checked={form.cta_show}
                        onChange={set('cta_show')}
                        label="CTA 버튼 표시"
                      />
                    </Field>
                  </div>
                  {form.cta_show && (
                    <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
                      <Field label="버튼 텍스트" hint="비우면 전체 전시명이 라벨로 쓰입니다">
                        <Input value={form.cta_label} onChange={setInput('cta_label')} />
                      </Field>
                      <Field label="버튼 링크" hint="비우면 전시 사이트 또는 상세로 이동">
                        <Input type="url" value={form.cta_url} onChange={setInput('cta_url')} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {template === 'portfolio' && (
            <>
              <Field label="이름">
                <Input value={form.name} onChange={setInput('name')} required />
              </Field>
              <Field label="학번">
                <Input value={form.student_no} onChange={setInput('student_no')} />
              </Field>
              <Field label="전공 조합">
                <Input value={form.majors} onChange={setInput('majors')} />
              </Field>
              <Field label="포트폴리오 링크">
                <Input type="url" value={form.link} onChange={setInput('link')} />
              </Field>
              <Field label="정렬 순서">
                <Input
                  type="number"
                  value={form.sort}
                  onChange={(e) => set('sort')(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
            </>
          )}

          {/* K1-3: 본문과 분리된 이미지 섹션 — 상세 갤러리용 (전 posts 유형) */}
          {(template === 't1' || template === 't2') && (
            <div className="md:col-span-2">
              <Field label="이미지" hint="상세 페이지 갤러리에 표시됩니다">
                <GalleryField
                  value={form.gallery}
                  onChange={set('gallery')}
                  usage="general"
                  onUploadingChange={onUploadingChange}
                />
              </Field>
            </div>
          )}

          {config.attachments && (
            <div className="md:col-span-2">
              <Field label="첨부 파일">
                <AttachmentsField
                  value={form.attachments}
                  onChange={set('attachments')}
                  onUploadingChange={onUploadingChange}
                />
              </Field>
            </div>
          )}
        </div>

        {/* 본문 — T1·T2. 전시회·공모전 템플릿은 여기 해당 없음 */}
        {/* 성과는 전용 필드만(게시판 렌더 금지), 포트폴리오는 링크형 */}
        {(template === 't1' || (template === 't2' && type !== 'contest')) && (
          <Field label="본문">
            <RichEditor value={form.body} onChange={set('body')} />
          </Field>
        )}

        {/* R1: EN 본문 — 국문과 분리. 비우면 영문 페이지에서 국문 폴백 */}
        {(template === 't1' || (template === 't2' && type !== 'contest')) && (
          <Field label="본문 (영문)" hint="비우면 영문 페이지에 국문 본문 렌더">
            <RichEditor value={form.body_en} onChange={set('body_en')} />
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-24 border-t border-border-subtle pt-24">
          {template !== 'portfolio' && (
            <Field
              label="게시"
              hint={
                template === 'achievement'
                  ? '발행하려면 국·영문 본문과 수상자(국·영)를 모두 입력하세요'
                  : config.enRequired
                    ? '발행하려면 영문 제목이 필요합니다'
                    : undefined
              }
            >
              <Toggle checked={form.published} onChange={set('published')} label="게시 여부" />
            </Field>
          )}
          {isPosts && template !== 'achievement' && (
            <Field label="상단 고정">
              <Toggle checked={form.pinned} onChange={set('pinned')} label="상단 고정" />
            </Field>
          )}
          {/* M1-2: 전시회 상단 고정 */}
          {template === 'exhibition' && (
            <Field label="상단 고정">
              <Toggle checked={form.is_featured} onChange={set('is_featured')} label="상단 고정" />
            </Field>
          )}
          {/* M1-1: 동아리 로고 배경 프레임 */}
          {type === 'club' && (
            <Field label="배경">
              <Toggle checked={form.has_bg} onChange={set('has_bg')} label="배경 표시" />
            </Field>
          )}
        </div>

        <ErrorText>{saveError || (enGateBlocked ? gateMsg : null)}</ErrorText>
        <div className="flex items-center gap-8">
          <PrimaryButton
            type="submit"
            disabled={!canSave}
          >
            {busy ? '저장 중' : uploading > 0 ? '업로드 완료 대기' : '저장'}
          </PrimaryButton>
          <GhostButton onClick={() => navigate(backTo)}>취소</GhostButton>
        </div>
      </form>
      )}
    </section>
  )
}

export default PostForm
