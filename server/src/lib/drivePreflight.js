// src/lib/drivePreflight.js — 공개 전 사전 검사와 경로 미리보기 (53_DRIVE_STORAGE)
//
// "공개했더니 제출은 되는데 파일이 어디에도 안 들어가는" 상황을 막는 층이다. 폼을 공개 저장할 때와
// 관리자가 버튼을 누를 때 같은 함수를 돌려, 같은 문구를 보여준다.
//
// shallow(기본): 저장된 설정만 본다 — 연결 선택, 과목 질문, 학기, 저장 위치.
// deep: Drive에 실제로 물어본다 — 루트 접근 권한, 폴더 존재 여부.
import { query } from '../db.js'
import {
  PATH_TEMPLATES,
  DEFAULT_PATH_TEMPLATE,
  normalizeFileStorage,
  normalizeSemester,
  buildFolderSegments,
  findCourseField,
} from './formStorage.js'
import { driveFor, ensurePath, resolveConnection, resolveRootFolderId, sanitizeConnection } from './driveConnections.js'
import { probeFolder } from './googleDrive.js'

export function fileFieldsOf(form) {
  const fields = Array.isArray(form?.fields) ? form.fields : []
  return fields.filter((field) => field?.type === 'file')
}

async function offeringCount(semester) {
  const match = /^(20\d{2})-([12])$/.exec(normalizeSemester(semester))
  if (!match) return null
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM semester_offerings WHERE year = $1 AND term = $2',
    [Number(match[1]), Number(match[2])]
  )
  return rows[0]?.n ?? 0
}

/**
 * 폼 1개의 Drive 설정 점검 + 예상 경로 계산.
 * @param {object} form custom_forms 행
 * @param {{deep?:boolean, drive?:object}} [options] deep이면 Drive에 실제 조회
 * @returns {{ok:boolean, issues:Array, plans:Array, connection:object|null}}
 */
export async function preflightForm(form, { deep = false, drive: injectedDrive } = {}) {
  const issues = []
  const plans = []
  const settings = form?.settings || {}
  const files = fileFieldsOf(form)
  const driveFields = files
    .map((field) => ({ field, storage: normalizeFileStorage(field.storage, settings) }))
    .filter((entry) => entry.storage.target === 'drive')

  for (const field of files) {
    if (!field.storage && !settings.drive_enabled) {
      issues.push({
        code: 'field_storage_missing',
        field_id: field.id,
        message: `파일 질문의 저장 위치가 설정되지 않았습니다. (${field.label_ko || field.id})`,
      })
    }
  }

  if (!driveFields.length) {
    return { ok: issues.length === 0, issues, plans, connection: null }
  }

  // 연결 프로필 — 파일 질문에 지정된 값이 우선, 없으면 폼 설정, 없으면 단일 활성 연결/환경변수
  const explicitIds = [...new Set(driveFields.map((entry) => entry.storage.connection_id).filter(Boolean))]
  const fallbackId = Number(settings.drive_connection_id) || null
  let connection = null
  try {
    connection = await resolveConnection({
      connectionId: explicitIds.length === 1 ? explicitIds[0] : fallbackId,
      requireActive: true,
    })
  } catch (err) {
    issues.push({ code: err.code || 'connection_none', message: err.message })
  }

  const { rootFolderId, source } = resolveRootFolderId({ connection, formSettings: settings })
  if (connection && !rootFolderId) {
    issues.push({
      code: 'root_missing',
      message: '루트 폴더가 지정되지 않았습니다. 관리 → 저장소 → Google Drive에서 루트 폴더를 선택하세요.',
    })
  }

  let drive = injectedDrive || null
  let rootProbe = null
  if (deep && connection && rootFolderId) {
    try {
      drive = drive || (await driveFor(connection))
      rootProbe = await probeFolder(drive, rootFolderId)
      if (!rootProbe.ok) {
        issues.push({
          code: 'root_not_accessible',
          message: `루트 폴더 접근 권한이 없습니다. ${rootProbe.message || ''}`.trim(),
        })
      }
    } catch (err) {
      issues.push({ code: 'drive_error', message: err.message || 'Drive 점검에 실패했습니다.' })
    }
  }

  for (const { field, storage } of driveFields) {
    const template = PATH_TEMPLATES[storage.path_template] || PATH_TEMPLATES[DEFAULT_PATH_TEMPLATE]
    const semester = normalizeSemester(settings.drive_semester)
    if (template.needsSemester && !semester) {
      issues.push({
        code: 'semester_missing',
        field_id: field.id,
        message: '학기(예: 2026-2)를 입력해야 저장 경로가 만들어집니다.',
      })
    }
    if (template.needsCourse) {
      const courseField = findCourseField(form)
      if (!courseField) {
        issues.push({
          code: 'course_field_missing',
          field_id: field.id,
          message: '과목 선택 질문이 지정되지 않았습니다.',
        })
      } else if (!Array.isArray(courseField.options) || !courseField.options.length) {
        issues.push({
          code: 'course_options_missing',
          field_id: courseField.id,
          message: `${semester || '해당 학기'} 개설 과목이 없습니다. 과목 선택 질문에 개설 과목을 불러오세요.`,
        })
      } else if (semester) {
        const count = await offeringCount(semester)
        if (count === 0) {
          issues.push({
            code: 'offerings_empty',
            field_id: courseField.id,
            message: `${semester} 개설 과목이 없습니다. 관리 → 교과목에서 학기별 개설 과목을 먼저 등록하세요.`,
          })
        }
      }
    }

    const built = buildFolderSegments({ form, field, storage, placeholders: true })
    const plan = {
      field_id: field.id,
      field_label: field.label_ko || field.id,
      target: storage.target,
      purpose: storage.purpose,
      share_mode: storage.share_mode,
      path_template: storage.path_template,
      template_label: template.label,
      segments: built.segments || [],
      root_folder_id: rootFolderId,
      root_source: source,
      steps: [],
      ready: false,
    }

    if (deep && drive && rootProbe?.ok && built.ok) {
      try {
        // 과목이 필요한 경로는 과목명 자리를 비우고 상위 단계까지만 점검한다(과목 폴더는 제출 시 생성).
        const checkable = template.needsCourse
          ? built.segments.slice(0, built.segments.findIndex((s) => s === '(과목명)'))
          : built.segments
        const result = await ensurePath({
          connection,
          rootFolderId,
          segments: checkable,
          dryRun: true,
          drive,
        })
        plan.steps = result.steps
        plan.ready = Boolean(result.folderId)
        plan.duplicates = result.duplicates
      } catch (err) {
        issues.push({ code: err.code || 'drive_error', field_id: field.id, message: err.message })
      }
    }
    plans.push(plan)
  }

  return {
    ok: issues.length === 0,
    issues,
    plans,
    connection: connection ? sanitizeConnection(connection) : null,
    root: rootProbe,
  }
}
