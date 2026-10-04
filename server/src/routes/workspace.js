// 작업공간 허브 API: 문서·시트 파일 목록, 템플릿으로 새로 만들기, 이름 바꾸기, 삭제, 시트 내용 저장.
// 폼은 기존 /admin/forms를 그대로 쓴다. 모든 경로는 manager 이상.
import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole, hasRole } from '../middleware/auth.js'
import { DOC_TEMPLATES, SHEET_TEMPLATES, DOC_TEMPLATE_META, SHEET_TEMPLATE_META } from '../lib/workspaceTemplates.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const guard = [requireAuth, requireRole('manager')]
const KINDS = ['doc', 'sheet']

// 문서 썸네일용 앞부분 글: Tiptap JSON에서 글자만 모은다
function excerpt(json, limit = 520) {
  const out = []
  let n = 0
  const walk = (node) => {
    if (n >= limit || !node) return
    if (node.type === 'text') {
      out.push(node.text)
      n += node.text.length
      return
    }
    if (node.type === 'secret') return
    ;(node.content || []).forEach(walk)
    if (['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type)) out.push('\n')
  }
  walk(json)
  return out.join('').replace(/\n{2,}/g, '\n').trim().slice(0, limit)
}

router.get(
  '/workspace/templates',
  ...guard,
  wrap(async (req, res) => {
    res.json({ doc: DOC_TEMPLATE_META, sheet: SHEET_TEMPLATE_META })
  })
)

router.get(
  '/workspace/files',
  ...guard,
  wrap(async (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'doc'
    const { rows } = await query(
      `SELECT f.id, f.kind, f.title, f.gated, f.created_by, f.created_at, f.opened_at,
              GREATEST(f.updated_at, COALESCE((SELECT MAX(d.updated_at) FROM handover_docs d WHERE d.ws_id = f.id), f.updated_at)) AS updated_at,
              (SELECT d.id FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_tab,
              (SELECT d.content FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_content,
              (SELECT d.content_html FROM handover_docs d WHERE d.ws_id = f.id ORDER BY d.sort, d.id LIMIT 1) AS first_html,
              CASE WHEN f.kind = 'sheet' THEN f.content END AS sheet_content
         FROM ws_files f WHERE f.kind = $1 ORDER BY f.opened_at DESC, f.id DESC`,
      [kind]
    )
    const items = rows.map((r) => {
      const { first_content: fc, first_html: fh, sheet_content: sc, ...rest } = r
      if (r.kind === 'doc') return { ...rest, excerpt: fc ? excerpt(fc) : String(fh || '').replace(/<\/(p|h[1-6]|li|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim().slice(0, 520) }
      const preview = (sc?.rows || []).slice(0, 8).map((row) => (sc.columns || []).slice(0, 6).map((c) => String(row.cells?.[c.key] ?? '')))
      return { ...rest, head: (sc?.columns || []).slice(0, 6).map((c) => c.label), preview }
    })
    res.json({ items })
  })
)

router.post(
  '/workspace/files',
  ...guard,
  wrap(async (req, res) => {
    const kind = req.body?.kind
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be doc or sheet' })
    const tpl = String(req.body?.template || 'blank')
    const name = (kind === 'doc' ? DOC_TEMPLATE_META : SHEET_TEMPLATE_META).find((m) => m.id === tpl)
    const title = String(req.body?.title || (tpl === 'blank' ? (kind === 'doc' ? '제목 없는 문서' : '제목 없는 스프레드시트') : name?.name || '제목 없음')).slice(0, 200)
    if (kind === 'doc') {
      const build = DOC_TEMPLATES[tpl] || DOC_TEMPLATES.blank
      const { rows } = await query(
        "INSERT INTO ws_files (kind, title, template, created_by) VALUES ('doc', $1, $2, $3) RETURNING *",
        [title, tpl, req.user.name]
      )
      const f = rows[0]
      const tab = await query(
        `INSERT INTO handover_docs (title, content, content_html, sort, updated_by, ws_id)
         VALUES ('탭 1', $1::jsonb, '<p></p>', 0, $2, $3) RETURNING id`,
        [JSON.stringify(build()), req.user.name, f.id]
      )
      return res.status(201).json({ item: { ...f, first_tab: tab.rows[0].id } })
    }
    const build = SHEET_TEMPLATES[tpl] || SHEET_TEMPLATES.blank
    const { rows } = await query(
      "INSERT INTO ws_files (kind, title, template, content, created_by) VALUES ('sheet', $1, $2, $3::jsonb, $4) RETURNING *",
      [title, tpl, JSON.stringify(build()), req.user.name]
    )
    res.status(201).json({ item: rows[0] })
  })
)

router.put(
  '/workspace/files/:id',
  ...guard,
  wrap(async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 200)
    if (!title) return res.status(400).json({ error: 'title required' })
    const { rows } = await query('UPDATE ws_files SET title = $1, updated_at = now() WHERE id = $2 RETURNING id, title', [title, parseInt(req.params.id, 10)])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

router.post(
  '/workspace/files/:id/open',
  ...guard,
  wrap(async (req, res) => {
    await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [parseInt(req.params.id, 10)])
    res.json({ ok: true })
  })
)

router.delete(
  '/workspace/files/:id',
  ...guard,
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10)
    const f = (await query('SELECT id, kind, gated FROM ws_files WHERE id = $1', [id])).rows[0]
    if (!f) return res.status(404).json({ error: 'not found' })
    if (f.gated && !hasRole(req.user, 'owner')) return res.status(403).json({ error: '비밀번호 문서는 오너만 삭제 가능' })
    if (f.kind === 'doc') {
      await query('DELETE FROM handover_comments WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [id])
      await query('DELETE FROM handover_versions WHERE doc_id IN (SELECT id FROM handover_docs WHERE ws_id = $1)', [id])
      await query('DELETE FROM handover_docs WHERE ws_id = $1', [id])
    }
    await query('DELETE FROM ws_files WHERE id = $1', [id])
    res.json({ ok: true })
  })
)

// 시트 내용
router.get(
  '/workspace/sheets/:id',
  ...guard,
  wrap(async (req, res) => {
    const { rows } = await query("SELECT id, title, content, updated_at FROM ws_files WHERE id = $1 AND kind = 'sheet'", [parseInt(req.params.id, 10)])
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    await query('UPDATE ws_files SET opened_at = now() WHERE id = $1', [rows[0].id])
    res.json({ item: rows[0] })
  })
)

router.put(
  '/workspace/sheets/:id',
  ...guard,
  wrap(async (req, res) => {
    const c = req.body?.content
    if (!c || !Array.isArray(c.columns) || !Array.isArray(c.rows)) return res.status(400).json({ error: 'content.columns, content.rows required' })
    if (c.rows.length > 5000 || c.columns.length > 200) return res.status(413).json({ error: 'too large' })
    const { rows } = await query(
      "UPDATE ws_files SET content = $1::jsonb, updated_at = now() WHERE id = $2 AND kind = 'sheet' RETURNING id, updated_at",
      [JSON.stringify(c), parseInt(req.params.id, 10)]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.json({ item: rows[0] })
  })
)

export default router
