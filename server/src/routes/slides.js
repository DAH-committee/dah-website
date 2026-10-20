// DAH Slides API: 발표 자료(ws_files kind='slide')의 내용 읽기·저장.
// 권한은 문서·시트·보드와 같은 공유 설정(lib/wsAccess.js)을 따른다. 읽기는 보기 권한, 저장은 편집 권한.
// 내용은 ws_files.content에 그대로 둔다(모양은 client/src/pages/slides/SlidesEditor.jsx 맨 위 설명).
//   { version: 1, theme: {id, name, fonts:{heading, body}, colors:{bg, text, accent, accent2, muted, surface}},
//     size: {w: 1920, h: 1080},
//     slides: [{ id, layout, variant, background, notes, hidden, transition, stacks?, elements: [{ id, type, x, y, w, h, rotate, z, locked, style, data, anim, name?, hidden?, mid? }] }] }
//   transition: 'none'|'fade'|'slide'|'magic'. mid: 매직 무브에서 앞뒤 슬라이드의 같은 요소를 잇는 이름(문자열 64자까지).
//   stacks: { [묶음 id]: { dir: 'row'|'column', gap, pad, align: 'start'|'center'|'end', frame?: 배경 도형 id } } (100개까지)
// 글 HTML과 주소는 화면에서 그릴 때 다시 거른다(client/src/pages/slides/sanitize.js). 서버는 모양과 크기만 검사한다.
import { Router } from 'express'
import { query } from '../db.js'
import { optionalAuth } from '../middleware/auth.js'
import { fileRow, levelFor, touchRecent } from '../lib/wsAccess.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const pid = (req) => parseInt(req.params.id, 10)

export const MAX_SLIDES = 300
export const MAX_ELEMENTS = 400 // 슬라이드 하나에 담을 수 있는 요소 수
export const MAX_BYTES = 3 * 1024 * 1024
export const ELEMENT_TYPES = ['text', 'shape', 'image', 'table', 'embed']
export const TRANSITIONS = ['none', 'fade', 'slide', 'magic'] // magic: 매직 무브(같은 mid 요소가 자리를 옮겨 간다)

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const idOk = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64

/** 발표 내용 모양 검사. 문제가 있으면 오류 문장, 없으면 null */
export function validateSlides(c) {
  if (!obj(c)) return 'content must be an object'
  if (c.version !== 1) return 'content.version must be 1'
  if (!Array.isArray(c.slides)) return 'content.slides required'
  if (c.slides.length > MAX_SLIDES) return `too many slides (max ${MAX_SLIDES})`
  if (c.theme !== undefined && c.theme !== null && !obj(c.theme)) return 'content.theme must be an object'
  if (c.theme?.colors !== undefined && !obj(c.theme.colors)) return 'content.theme.colors must be an object'
  if (c.size !== undefined && c.size !== null && (!obj(c.size) || !num(c.size.w) || !num(c.size.h))) return 'content.size must be {w, h}'
  const sids = new Set()
  for (const s of c.slides) {
    if (!obj(s)) return 'slide must be an object'
    if (!idOk(s.id)) return 'slide.id required'
    if (sids.has(s.id)) return 'duplicate slide id'
    sids.add(s.id)
    if (!Array.isArray(s.elements)) return 'slide.elements must be an array'
    if (s.elements.length > MAX_ELEMENTS) return `too many elements on a slide (max ${MAX_ELEMENTS})`
    if (s.notes !== undefined && s.notes !== null && (typeof s.notes !== 'string' || s.notes.length > 20000)) return 'slide.notes must be a string'
    if (s.transition !== undefined && s.transition !== null && !TRANSITIONS.includes(s.transition)) return `slide.transition must be one of ${TRANSITIONS.join(', ')}`
    if (s.background !== undefined && s.background !== null && !obj(s.background)) return 'slide.background must be an object'
    if (s.stacks !== undefined && s.stacks !== null) {
      if (!obj(s.stacks)) return 'slide.stacks must be an object'
      const keys = Object.keys(s.stacks)
      if (keys.length > 100) return 'slide.stacks has more than 100 entries'
      for (const k of keys) {
        const st = s.stacks[k]
        if (k.length > 64 || !obj(st)) return 'slide.stacks entries must be objects'
        if (st.dir !== undefined && !['row', 'column'].includes(st.dir)) return 'stack.dir must be row or column'
        if (st.align !== undefined && !['start', 'center', 'end'].includes(st.align)) return 'stack.align must be start, center or end'
        if ((st.gap !== undefined && !num(st.gap)) || (st.pad !== undefined && !num(st.pad))) return 'stack.gap and stack.pad must be numbers'
        if (st.frame !== undefined && st.frame !== null && (typeof st.frame !== 'string' || st.frame.length > 64)) return 'stack.frame must be an element id (max 64)'
      }
    }
    const eids = new Set()
    for (const e of s.elements) {
      if (!obj(e)) return 'element must be an object'
      if (!idOk(e.id)) return 'element.id required'
      if (eids.has(e.id)) return 'duplicate element id'
      eids.add(e.id)
      if (!ELEMENT_TYPES.includes(e.type)) return `element.type must be one of ${ELEMENT_TYPES.join(', ')}`
      if (!num(e.x) || !num(e.y) || !num(e.w) || !num(e.h)) return 'element.x, y, w, h must be numbers'
      if (e.w < 0 || e.h < 0 || e.w > 20000 || e.h > 20000 || Math.abs(e.x) > 20000 || Math.abs(e.y) > 20000) return 'element size out of range'
      if (e.rotate !== undefined && e.rotate !== null && !num(e.rotate)) return 'element.rotate must be a number'
      if (e.mid !== undefined && e.mid !== null && (typeof e.mid !== 'string' || e.mid.length > 64)) return 'element.mid must be a string (max 64)'
      if (e.name !== undefined && e.name !== null && (typeof e.name !== 'string' || e.name.length > 80)) return 'element.name must be a string (max 80)'
      if (e.hidden !== undefined && e.hidden !== null && typeof e.hidden !== 'boolean') return 'element.hidden must be a boolean'
      if (e.style !== undefined && e.style !== null && !obj(e.style)) return 'element.style must be an object'
      if (e.data !== undefined && e.data !== null && !obj(e.data)) return 'element.data must be an object'
      if (e.type === 'table') {
        const rows = e.data?.rows
        if (!Array.isArray(rows) || rows.length > 60 || rows.some((r) => !Array.isArray(r) || r.length > 30)) return 'table.rows must be a 2D array (max 60x30)'
      }
    }
  }
  return null
}

router.use('/workspace/slides', optionalAuth)

/** 발표 파일을 찾고 권한을 확인한다. 응답을 이미 보냈으면 null */
async function loadDeck(req, res, need = 'viewer') {
  const file = await fileRow(pid(req))
  if (!file || file.kind !== 'slide') {
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
  '/workspace/slides/:id',
  wrap(async (req, res) => {
    const file = await loadDeck(req, res)
    if (!file) return
    await touchRecent(req, res, file)
    const { rows } = await query('SELECT id, title, content, updated_at FROM ws_files WHERE id = $1', [file.id])
    if (req.fileLevel === 'editor') await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [file.id])
    const item = rows[0]
    if (item && (!item.content || typeof item.content !== 'object' || !Array.isArray(item.content.slides))) item.content = { version: 1, slides: [] }
    res.json({ item, level: req.fileLevel, canEdit: req.fileLevel === 'editor', last_edit: file.last_edit || null })
  })
)

router.put(
  '/workspace/slides/:id',
  wrap(async (req, res) => {
    const file = await loadDeck(req, res, 'editor')
    if (!file) return
    const c = req.body?.content
    const bad = validateSlides(c)
    if (bad) return res.status(bad.startsWith('too many') ? 413 : 400).json({ error: bad })
    const text = JSON.stringify(c)
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return res.status(413).json({ error: 'deck too large (max 3MB)' })
    const { rows } = await query('UPDATE ws_files SET content = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING id, updated_at', [text, file.id])
    res.json({ item: rows[0] })
  })
)

export default router
