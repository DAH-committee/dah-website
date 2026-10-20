// DAH Board API: 무한 캔버스 보드(ws_files kind='board')의 내용 읽기·저장.
// 권한은 문서·시트와 같은 공유 설정(lib/wsAccess.js)을 따른다. 읽기는 보기 권한, 저장은 편집 권한.
// 내용은 ws_files.content에 그대로 둔다.
//   version 2 (지금): { version: 2, active?: canvasId,
//     canvases: [{ id, name, viewport?: {x, y, zoom},
//       items: [{ id, type, x, y, w, h, color, z, group?, locked?, data }],
//       connections: [{ id, from, to, label, arrow: 'none'|'end'|'both', color, style?: 'curve'|'straight'|'elbow' }],
//       comments?: [{ id, itemId, author, text, at, resolved }] }] }
//   version 1 (예전): { version: 1, viewport?, items, connections }. 그대로 받아 두고, 화면에서 열 때 캔버스 하나짜리 version 2로 옮긴다.
// 메모 HTML과 주소는 화면에서 그릴 때 다시 거른다(client/src/pages/board/sanitize.js). 서버는 모양과 크기만 검사한다.
// 크기: 모든 캔버스 합계 항목 5000개, JSON 4MB. Vercel 함수 요청 본문은 4.5MB까지라 그 아래로 둔다
// (app.js의 express.json 한도가 이보다 작으면 그 한도에서 먼저 413이 난다).
import { Router } from 'express'
import { query } from '../db.js'
import { optionalAuth } from '../middleware/auth.js'
import { fileRow, levelFor, touchRecent } from '../lib/wsAccess.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const pid = (req) => parseInt(req.params.id, 10)

export const MAX_ITEMS = 5000 // 모든 캔버스 합계
export const MAX_CONNECTIONS = 10000 // 모든 캔버스 합계
export const MAX_CANVASES = 50
export const MAX_COMMENTS = 1000 // 캔버스 하나
export const MAX_STROKE_COORDS = 4000 // 펜 획 하나의 좌표 수(점 2000개)
export const MAX_BYTES = 4 * 1024 * 1024
export const ITEM_TYPES = ['memo', 'keyword', 'link', 'image', 'video', 'file', 'sticky', 'shape', 'text', 'stroke', 'frame']
export const V1_ITEM_TYPES = ['memo', 'keyword', 'link', 'image', 'video', 'file']
export const ARROWS = ['none', 'end', 'both']
export const CONN_STYLES = ['curve', 'straight', 'elbow']
export const SHAPES = ['rect', 'rounded', 'ellipse', 'diamond', 'triangle', 'arrow']

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const idOk = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64) || (Number.isInteger(v) && v >= 0)
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const shortStr = (v, n) => v === undefined || v === null || (typeof v === 'string' && v.length <= n)

function checkViewport(v) {
  if (v === undefined || v === null) return null
  if (typeof v !== 'object' || !num(v.x) || !num(v.y) || !num(v.zoom)) return 'viewport must be {x, y, zoom}'
  return null
}

function checkItem(it, types) {
  if (!isObj(it)) return 'item must be an object'
  if (!idOk(it.id)) return 'item.id required'
  if (!types.includes(it.type)) return `item.type must be one of ${types.join(', ')}`
  if (!num(it.x) || !num(it.y) || !num(it.w) || !num(it.h)) return 'item.x, y, w, h must be numbers'
  if (it.w <= 0 || it.h <= 0 || it.w > 20000 || it.h > 20000) return 'item size out of range'
  if (it.data !== undefined && !isObj(it.data)) return 'item.data must be an object'
  if (!shortStr(it.group, 64)) return 'item.group must be a short string'
  if (it.locked !== undefined && typeof it.locked !== 'boolean') return 'item.locked must be boolean'
  const d = it.data || {}
  if (it.type === 'stroke') {
    if (!Array.isArray(d.points) || d.points.length < 2 || d.points.length % 2) return 'stroke.points must be [x, y, ...]'
    if (d.points.length > MAX_STROKE_COORDS) return `too many stroke points (max ${MAX_STROKE_COORDS / 2})`
    for (const p of d.points) if (!num(p)) return 'stroke.points must be numbers'
    if (d.tool !== undefined && d.tool !== 'pen' && d.tool !== 'highlighter') return 'stroke.tool must be pen or highlighter'
  }
  if (it.type === 'shape' && d.shape !== undefined && !SHAPES.includes(d.shape)) return `shape.shape must be one of ${SHAPES.join(', ')}`
  if ((it.type === 'sticky' || it.type === 'shape') && !shortStr(d.text, 4000)) return 'text too long'
  if (it.type === 'text' && !shortStr(d.text, 10000)) return 'text too long'
  if (it.type === 'frame' && !shortStr(d.name, 100)) return 'frame.name too long'
  return null
}

/** 캔버스 하나(항목·연결·댓글). 반환: 오류 문장 또는 null */
function checkCanvas(cv, types, counts) {
  if (!Array.isArray(cv.items) || !Array.isArray(cv.connections)) return 'items, connections required'
  counts.items += cv.items.length
  counts.connections += cv.connections.length
  if (counts.items > MAX_ITEMS) return `too many items (max ${MAX_ITEMS})`
  if (counts.connections > MAX_CONNECTIONS) return `too many connections (max ${MAX_CONNECTIONS})`
  const vbad = checkViewport(cv.viewport)
  if (vbad) return vbad
  const ids = new Set()
  for (const it of cv.items) {
    const bad = checkItem(it, types)
    if (bad) return bad
    if (ids.has(String(it.id))) return 'duplicate item id'
    ids.add(String(it.id))
  }
  const cids = new Set()
  for (const cn of cv.connections) {
    if (!isObj(cn)) return 'connection must be an object'
    if (!idOk(cn.id) || cids.has(String(cn.id))) return 'connection.id required and unique'
    cids.add(String(cn.id))
    if (!ids.has(String(cn.from)) || !ids.has(String(cn.to))) return 'connection must point to existing items'
    if (cn.arrow !== undefined && !ARROWS.includes(cn.arrow)) return `connection.arrow must be one of ${ARROWS.join(', ')}`
    if (cn.style !== undefined && !CONN_STYLES.includes(cn.style)) return `connection.style must be one of ${CONN_STYLES.join(', ')}`
    if (!shortStr(cn.label, 200)) return 'connection.label must be a short string'
  }
  if (cv.comments !== undefined) {
    if (!Array.isArray(cv.comments)) return 'comments must be an array'
    if (cv.comments.length > MAX_COMMENTS) return `too many comments (max ${MAX_COMMENTS})`
    const mids = new Set()
    for (const m of cv.comments) {
      if (!isObj(m)) return 'comment must be an object'
      if (!idOk(m.id) || mids.has(String(m.id))) return 'comment.id required and unique'
      mids.add(String(m.id))
      if (!ids.has(String(m.itemId))) return 'comment must point to an existing item'
      if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 2000) return 'comment.text must be 1-2000 chars'
      if (!shortStr(m.author, 80)) return 'comment.author too long'
      if (m.at !== undefined && (typeof m.at !== 'string' || Number.isNaN(Date.parse(m.at)))) return 'comment.at must be a date string'
      if (m.resolved !== undefined && typeof m.resolved !== 'boolean') return 'comment.resolved must be boolean'
    }
  }
  return null
}

/** 보드 내용 모양 검사(version 1, 2). 문제가 있으면 오류 문장, 없으면 null */
export function validateBoard(c) {
  if (!isObj(c)) return 'content must be an object'
  const counts = { items: 0, connections: 0 }
  if (c.version === 1) {
    if (!Array.isArray(c.items) || !Array.isArray(c.connections)) return 'content.items, connections required'
    return checkCanvas(c, V1_ITEM_TYPES, counts)
  }
  if (c.version !== 2) return 'content.version must be 1 or 2'
  if (!Array.isArray(c.canvases) || !c.canvases.length) return 'content.canvases must be a non-empty array'
  if (c.canvases.length > MAX_CANVASES) return `too many canvases (max ${MAX_CANVASES})`
  const cvIds = new Set()
  for (const cv of c.canvases) {
    if (!isObj(cv)) return 'canvas must be an object'
    if (!idOk(cv.id) || cvIds.has(String(cv.id))) return 'canvas.id required and unique'
    cvIds.add(String(cv.id))
    if (typeof cv.name !== 'string' || cv.name.length > 60) return 'canvas.name must be a short string'
    const bad = checkCanvas(cv, ITEM_TYPES, counts)
    if (bad) return bad
  }
  if (c.active !== undefined && c.active !== null && !cvIds.has(String(c.active))) return 'content.active must be a canvas id'
  return null
}

router.use('/workspace/boards', optionalAuth)

/** 보드 파일을 찾고 권한을 확인한다. 응답을 이미 보냈으면 null */
async function loadBoard(req, res, need = 'viewer') {
  const file = await fileRow(pid(req))
  if (!file || file.kind !== 'board') {
    res.status(404).json({ error: 'not found' })
    return null
  }
  const level = await levelFor(req, res, file)
  if (!level) {
    res.status(req.user || req.publicUser ? 403 : 401).json({ error: 'not allowed' })
    return null
  }
  if (need === 'editor' && level !== 'editor') {
    res.status(403).json({ error: 'editor only' })
    return null
  }
  req.fileLevel = level
  return file
}

router.get(
  '/workspace/boards/:id',
  wrap(async (req, res) => {
    const file = await loadBoard(req, res)
    if (!file) return
    await touchRecent(req, res, file)
    const { rows } = await query('SELECT id, title, content, updated_at FROM ws_files WHERE id = $1', [file.id])
    if (req.fileLevel === 'editor') await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [file.id])
    const item = rows[0]
    if (item && (!item.content || typeof item.content !== 'object')) item.content = { version: 2, canvases: [{ id: 'cv1', name: '캔버스 1', items: [], connections: [], comments: [] }] }
    res.json({ item, level: req.fileLevel, canEdit: req.fileLevel === 'editor', last_edit: file.last_edit || null })
  })
)

router.put(
  '/workspace/boards/:id',
  wrap(async (req, res) => {
    const file = await loadBoard(req, res, 'editor')
    if (!file) return
    const c = req.body?.content
    const bad = validateBoard(c)
    if (bad) return res.status(bad.startsWith('too many') ? 413 : 400).json({ error: bad })
    const text = JSON.stringify(c)
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return res.status(413).json({ error: 'board too large (max 4MB)' })
    const { rows } = await query('UPDATE ws_files SET content = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING id, updated_at', [text, file.id])
    res.json({ item: rows[0] })
  })
)

export default router
