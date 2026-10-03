// sheetExport.js: 관리자 시트의 표를 연결된 구글 드라이브 안에 새 구글 시트로 만든다.
// 연결 방식에 따라 길이 다르다.
//   Apps Script 릴레이: 릴레이의 createSheet 동작을 부른다(릴레이를 새로 배포해야 생긴다).
//   구글 로그인 연결: Drive API에 CSV를 올리면서 구글 시트로 변환한다(drive.file 범위로 충분하다).
// 어느 쪽이든 만들어진 시트는 연결된 계정의 드라이브에 생기고, 열람 주소를 돌려준다.
import { Readable } from 'node:stream'

export const MAX_EXPORT_CELLS = 200_000

function httpError(message, status, code) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

/** 2차원 배열을 정규화한다. 모든 값은 문자열로, 길이는 열 수로 맞춘다 */
export function normalizeValues(values) {
  if (!Array.isArray(values) || !values.length) throw httpError('내보낼 표가 비어 있습니다.', 400, 'sheet_empty')
  const rows = values.map((row) => (Array.isArray(row) ? row.map((v) => (v == null ? '' : String(v))) : []))
  const width = Math.max(...rows.map((r) => r.length))
  if (!width) throw httpError('내보낼 표가 비어 있습니다.', 400, 'sheet_empty')
  if (rows.length * width > MAX_EXPORT_CELLS) {
    throw httpError('한 번에 내보낼 수 있는 크기를 넘었습니다. 필터로 줄인 뒤 다시 시도해 주세요.', 413, 'sheet_too_large')
  }
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')])
}

export function toCsv(values) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`
  return values.map((row) => row.map(esc).join(',')).join('\r\n')
}

function cleanName(raw) {
  const name = String(raw || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 120)
  return name || '접수 현황'
}

/**
 * @param {object} drive driveFor(connection)가 돌려준 클라이언트
 * @returns {Promise<{id:string, url:string}>}
 */
export async function createGoogleSheet({ drive, name, values, parentId = '' }) {
  const rows = normalizeValues(values)
  const title = cleanName(name)
  if (typeof drive.createSheet === 'function') {
    const data = await drive.createSheet({ name: title, values: rows, parentId })
    if (!data?.id) throw httpError('구글 시트를 만들지 못했습니다.', 502, 'sheet_create_failed')
    return { id: data.id, url: data.url || `https://docs.google.com/spreadsheets/d/${data.id}/edit` }
  }
  const res = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    media: { mimeType: 'text/csv', body: Readable.from([`\uFEFF${toCsv(rows)}`]) },
    fields: 'id, webViewLink',
  })
  const id = res?.data?.id
  if (!id) throw httpError('구글 시트를 만들지 못했습니다.', 502, 'sheet_create_failed')
  return { id, url: res.data.webViewLink || `https://docs.google.com/spreadsheets/d/${id}/edit` }
}
