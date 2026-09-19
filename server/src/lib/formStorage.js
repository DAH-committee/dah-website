// src/lib/formStorage.js — 파일 질문별 저장소 설정 (53_DRIVE_STORAGE)
//
// 폼 전체가 하나의 Drive 설정을 공유하던 구조를 파일 질문 단위로 내린다. 전시회 한 폼 안에서
// "웹 전시용 이미지는 Vercel Blob, 인쇄용 원본은 Google Drive"가 동시에 성립해야 하기 때문이다.
//
// 저장 위치·용도·경로 템플릿은 전부 화이트리스트다. 클라이언트가 폴더명이나 경로를 직접 보내지
// 못하게 하고, 서버가 저장된 폼 설정(custom_forms)과 DB 데이터만으로 경로를 조립한다.
//
// 레거시 호환: 예전 폼은 settings.drive_enabled / drive_folder_id / drive_semester /
// drive_course_field_id / drive_share_mode 를 폼 전역에 갖고 있다. 파일 질문에 storage가 없으면
// 그 값을 그대로 읽어 같은 동작을 유지한다(갑자기 Blob으로 바뀌어 원본이 변환되는 일을 막는다).

export const FILE_TARGETS = ['blob', 'drive']
export const FILE_PURPOSES = ['web', 'original', 'attachment']
export const SHARE_MODES = ['restricted', 'link']

export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
// Drive 원본은 인쇄용 파일을 받으니 상한이 더 크다. 서버 메모리(Render)를 고려해 기본 100MB,
// 필요하면 GOOGLE_DRIVE_MAX_UPLOAD_MB로 조정한다.
export const DRIVE_MAX_BYTES = Math.max(
  1,
  Number(process.env.GOOGLE_DRIVE_MAX_UPLOAD_MB) || 100
) * 1024 * 1024

// 업로드 허용 확장자(서버 최종 판정). 실행 계열은 아래 BLOCKED_EXTS가 항상 우선한다.
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']
export const DOC_EXTS = ['hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'pptx', 'zip']
export const ORIGINAL_EXTS = [
  ...IMAGE_EXTS,
  ...DOC_EXTS,
  'ai', 'psd', 'indd', 'eps', 'tif', 'tiff', 'svg', 'mp4', 'mov', 'wav', 'mp3', 'obj', 'fbx', 'blend',
]
export const BLOCKED_EXTS = ['exe', 'sh', 'bat', 'js', 'cmd', 'msi', 'com', 'scr', 'jar', 'app', 'dmg', 'pkg', 'vbs', 'ps1']

/**
 * 경로 템플릿 화이트리스트. build(ctx)가 폴더 단계 배열을 만든다.
 * ctx = { semester, formTitle, categoryLabel, fieldLabel, course, leafLabel }
 */
export const PATH_TEMPLATES = {
  exhibition_original: {
    label: '전시회 원본 — 학기 / 폼명 / 과목 / 원본',
    needsSemester: true,
    needsCourse: true,
    build: (ctx) => [ctx.semester, ctx.formTitle, ctx.course, ctx.leafLabel || '원본'],
  },
  course_leaf: {
    // 이번 학기 폴더(예: "26-2 전공 프로젝트 전시회")를 그대로 루트로 지정한 경우.
    // 이미 운영진이 만들어 둔 Drive 구조를 그대로 살리면서 과목 분리만 자동화한다.
    label: '과목 / 원본 (학기 폴더를 루트로 사용)',
    needsSemester: false,
    needsCourse: true,
    build: (ctx) => [ctx.course, ctx.leafLabel || '원본'],
  },
  semester_course_field: {
    label: '학기 / 과목 / 파일 질문명',
    needsSemester: true,
    needsCourse: true,
    build: (ctx) => [ctx.semester, ctx.course, ctx.fieldLabel],
  },
  semester_category_form_field: {
    label: '학기 또는 연도 / 분류 / 폼명 / 파일 질문명',
    needsSemester: true,
    needsCourse: false,
    build: (ctx) => [ctx.semester, ctx.categoryLabel, ctx.formTitle, ctx.fieldLabel],
  },
  semester_form_field: {
    label: '학기 또는 연도 / 폼명 / 파일 질문명',
    needsSemester: true,
    needsCourse: false,
    build: (ctx) => [ctx.semester, ctx.formTitle, ctx.fieldLabel],
  },
  form_field: {
    label: '폼명 / 파일 질문명',
    needsSemester: false,
    needsCourse: false,
    build: (ctx) => [ctx.formTitle, ctx.fieldLabel],
  },
  root: {
    label: '루트 폴더에 바로 저장',
    needsSemester: false,
    needsCourse: false,
    build: () => [],
  },
}

export const PATH_TEMPLATE_KEYS = Object.keys(PATH_TEMPLATES)
export const DEFAULT_PATH_TEMPLATE = 'semester_form_field'

export const CATEGORY_FOLDER_LABEL = { event: '행사', recruit: '모집', other: '기타' }

export function extOf(filename) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(filename || ''))
  return match ? match[1].toLowerCase() : ''
}

/** 학기 또는 연도 문자열 검증. '2026-2' 또는 '2026'만 통과 */
export function normalizeSemester(raw) {
  const value = String(raw || '').trim().replace(/\s*[-/]\s*/, '-')
  return /^20\d{2}(-[12])?$/.test(value) ? value : ''
}

function cleanExtList(raw) {
  if (!Array.isArray(raw)) return []
  return [...new Set(
    raw
      .map((v) => String(v || '').trim().toLowerCase().replace(/^\./, ''))
      .filter((v) => /^[a-z0-9]{1,8}$/.test(v) && !BLOCKED_EXTS.includes(v))
  )]
}

/**
 * 파일 질문 1개의 저장소 설정 정규화. 저장(관리자 PUT)과 판독(업로드) 양쪽에서 같은 함수를 쓴다.
 * @param {object} rawStorage  field.storage
 * @param {object} formSettings custom_forms.settings (레거시 폴백용)
 */
export function normalizeFileStorage(rawStorage, formSettings = {}) {
  const raw = rawStorage && typeof rawStorage === 'object' && !Array.isArray(rawStorage) ? rawStorage : null
  const legacyDrive = Boolean(formSettings?.drive_enabled)

  // 레거시 폼: 파일 질문에 storage가 없고 폼 전역 Drive 설정이 켜져 있으면 그 설정을 그대로 쓴다.
  if (!raw) {
    if (!legacyDrive) {
      return {
        target: 'blob',
        purpose: 'web',
        accept: [],
        max_bytes: null,
        connection_id: null,
        path_template: DEFAULT_PATH_TEMPLATE,
        folder_label: '',
        share_mode: 'restricted',
        legacy: false,
      }
    }
    return {
      target: 'drive',
      purpose: 'original',
      accept: [],
      max_bytes: null,
      connection_id: Number.isInteger(formSettings?.drive_connection_id) ? formSettings.drive_connection_id : null,
      path_template: formSettings?.drive_auto_folder === false ? 'root' : 'exhibition_original',
      folder_label: '',
      share_mode: formSettings?.drive_share_mode === 'link' ? 'link' : 'restricted',
      legacy: true,
    }
  }

  const target = FILE_TARGETS.includes(raw.target) ? raw.target : 'blob'
  const purpose = FILE_PURPOSES.includes(raw.purpose)
    ? raw.purpose
    : target === 'drive'
      ? 'original'
      : 'web'
  const template = PATH_TEMPLATE_KEYS.includes(raw.path_template) ? raw.path_template : DEFAULT_PATH_TEMPLATE
  const maxBytes = Number(raw.max_bytes)
  const connectionId = Number(raw.connection_id)

  return {
    target,
    purpose,
    accept: cleanExtList(raw.accept),
    max_bytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, DRIVE_MAX_BYTES) : null,
    connection_id: Number.isInteger(connectionId) && connectionId > 0 ? connectionId : null,
    path_template: target === 'drive' ? template : DEFAULT_PATH_TEMPLATE,
    folder_label: String(raw.folder_label || '').slice(0, 40),
    share_mode: SHARE_MODES.includes(raw.share_mode) ? raw.share_mode : 'restricted',
    legacy: false,
  }
}

/** 공개 폼에 내려도 되는 정보만. 폴더 ID·연결 ID는 내리지 않는다 */
export function publicFileStorage(storage) {
  const template = PATH_TEMPLATES[storage.path_template] || PATH_TEMPLATES[DEFAULT_PATH_TEMPLATE]
  return {
    target: storage.target,
    purpose: storage.purpose,
    accept: storage.accept,
    max_bytes: storage.max_bytes ?? (storage.target === 'drive' ? DRIVE_MAX_BYTES : DEFAULT_MAX_BYTES),
    requires_course: storage.target === 'drive' && template.needsCourse,
  }
}

export function maxBytesFor(storage) {
  if (storage.max_bytes) return storage.max_bytes
  return storage.target === 'drive' ? DRIVE_MAX_BYTES : DEFAULT_MAX_BYTES
}

/** 허용 확장자 목록(설정이 비어 있으면 용도별 기본값) */
export function allowedExtsFor(storage) {
  if (storage.accept.length) return storage.accept
  if (storage.purpose === 'web') return IMAGE_EXTS
  if (storage.purpose === 'original') return ORIGINAL_EXTS
  return [...IMAGE_EXTS, ...DOC_EXTS]
}

/** 웹 전시용 이미지만 WebP 최적화 대상. 원본·일반 첨부는 절대 변환하지 않는다 */
export function shouldOptimize(storage, ext, mimetype) {
  if (storage.target === 'drive') return false
  if (storage.purpose !== 'web') return false
  return IMAGE_EXTS.includes(ext) || Boolean(mimetype?.startsWith('image/'))
}

/** 폼 정의에서 과목 선택 질문을 찾는다. 설정이 없으면 라벨 추론(레거시 폼 호환) */
export function findCourseField(form) {
  const fields = Array.isArray(form?.fields) ? form.fields : []
  const configured = String(form?.settings?.drive_course_field_id || '').trim()
  if (configured) return fields.find((f) => f?.id === configured) || null
  return (
    fields.find((f) =>
      ['select', 'radio'].includes(f?.type) &&
      /과목|course|subject/i.test(`${f?.label_ko || ''} ${f?.label_en || ''}`)
    ) || null
  )
}

/**
 * 제출값에서 과목을 읽고 "저장된 보기 목록에 있는 값"만 통과시킨다.
 * 클라이언트가 임의의 과목명(=임의 폴더명)을 보내도 여기서 걸린다.
 * @returns {{ok:boolean, course?:string, reason?:string}}
 */
export function resolveCourse(form, values) {
  const field = findCourseField(form)
  if (!field) return { ok: false, reason: 'course_field_missing' }
  const raw = values?.[field.id]
  const selected = Array.isArray(raw) ? raw[0] : raw
  const course = String(selected ?? '').trim()
  if (!course) return { ok: false, reason: 'course_not_selected' }
  const options = Array.isArray(field.options) ? field.options.map((o) => String(o)) : []
  if (!options.length) return { ok: false, reason: 'course_options_missing' }
  if (!options.includes(course)) return { ok: false, reason: 'course_not_allowed' }
  return { ok: true, course, fieldId: field.id }
}

/**
 * 서버가 조립하는 폴더 경로. 클라이언트 입력은 "어떤 보기를 골랐는지"까지만 반영된다.
 * @returns {{ok:boolean, segments?:string[], reason?:string, template:string}}
 */
export function buildFolderSegments({ form, field, storage, course = '', placeholders = false }) {
  const template = PATH_TEMPLATES[storage.path_template] || PATH_TEMPLATES[DEFAULT_PATH_TEMPLATE]
  const semester = normalizeSemester(form?.settings?.drive_semester)
  if (template.needsSemester && !semester) {
    return { ok: false, reason: 'semester_missing', template: storage.path_template }
  }
  let courseName = course
  if (template.needsCourse && !courseName) {
    if (!placeholders) return { ok: false, reason: 'course_required', template: storage.path_template }
    courseName = '(과목명)'
  }
  const segments = template.build({
    semester,
    formTitle: form?.title_ko || form?.slug || '폼',
    categoryLabel: CATEGORY_FOLDER_LABEL[form?.category] || CATEGORY_FOLDER_LABEL.other,
    fieldLabel: field?.label_ko || field?.label_en || field?.id || '첨부파일',
    course: courseName,
    leafLabel: storage.folder_label,
  })
  return { ok: true, segments: segments.filter(Boolean).map(String), template: storage.path_template }
}
