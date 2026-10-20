// read_file_text 용: 파일 내용을 서버에서 JSON 으로 읽어 AI 가 읽기 좋은 짧은 글로 만든다(예산 안에서).
// 열린 편집기 탭이 없어도 동작한다. 편집기 도구(doc_read_document 등)와 달리 화면 상태(선택 영역, 현재 탭)는 모른다.
// 비밀값(handover 의 secret 노드)은 읽지 않는다: ⟦비밀값⟧ 으로만 보인다.
import { query } from '../db.js'

export const DEFAULT_BUDGET = 20000
export const MAX_BUDGET = 60000

const clampInt = (v, lo, hi, d) => {
  const n = Number.parseInt(v, 10)
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const plainHtml = (v) => String(v || '').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim()

/** 줄 목록을 예산 안에서 자른다. 잘렸으면 next 가 다음 시작 번호 */
function pack(lines, budget) {
  const out = []
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    n += lines[i].length + 1
    if (n > budget && out.length) return { text: out.join('\n'), truncated: true, next: i }
    out.push(lines[i])
  }
  return { text: out.join('\n'), truncated: false, next: null }
}

// ── 문서(Tiptap JSON) ───────────────────────────────────────
function textOf(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'secret') return '⟦비밀값⟧'
  if (node.type === 'hardBreak') return '\n'
  return (node.content || []).map(textOf).join('')
}
export function docParagraphs(json) {
  const out = []
  let tableNo = 0
  const walk = (node, ctx = {}) => {
    if (!node) return
    switch (node.type) {
      case 'heading': out.push({ kind: `제목${node.attrs?.level || 1}`, text: textOf(node) }); return
      case 'paragraph': out.push({ kind: ctx.kind || '문단', text: textOf(node) }); return
      case 'codeBlock': out.push({ kind: '코드', text: textOf(node) }); return
      case 'blockquote': (node.content || []).forEach((c) => walk(c, { kind: '인용' })); return
      case 'bulletList': (node.content || []).forEach((c) => walk(c, { kind: '글머리' })); return
      case 'orderedList': (node.content || []).forEach((c) => walk(c, { kind: '번호' })); return
      case 'taskList': (node.content || []).forEach((c) => walk(c, { kind: '체크' })); return
      case 'listItem':
      case 'taskItem': (node.content || []).forEach((c) => walk(c, ctx)); return
      case 'table': {
        tableNo += 1
        const t = tableNo
        ;(node.content || []).forEach((row, ri) => (row.content || []).forEach((cell, ci) => (cell.content || []).forEach((c) => walk(c, { kind: `표 t${t} r${ri + 1} c${ci + 1}` }))))
        return
      }
      case 'secret': out.push({ kind: '문단', text: '⟦비밀값⟧' }); return
      default: (node.content || []).forEach((c) => walk(c, ctx))
    }
  }
  ;(json?.content || []).forEach((c) => walk(c))
  return out
}

async function readDoc(file, a, budget) {
  const { rows } = await query('SELECT id, title, content, content_html FROM handover_docs WHERE ws_id = $1 ORDER BY sort, id', [file.id])
  if (!rows.length) return { text: '(내용 없음)', meta: { tabs: [] } }
  const tabs = rows.map((r, i) => ({ tab: i + 1, title: r.title }))
  const want = clampInt(a.tab, 1, rows.length, 1)
  const row = rows[want - 1]
  const paras = row.content ? docParagraphs(row.content) : plainHtml(row.content_html).split('\n').map((t) => ({ kind: '문단', text: t }))
  const from = clampInt(a.from, 1, Math.max(1, paras.length), 1)
  const to = clampInt(a.to, from, Math.max(from, paras.length), paras.length)
  const lines = paras.slice(from - 1, to).map((p, i) => `[${from + i}] (${p.kind}) ${p.text}`)
  const r = pack(lines, budget)
  return {
    text: r.text,
    meta: { tab: want, tab_title: row.title, tabs, paragraphs: paras.length, from, to: r.truncated ? from + r.next - 1 : to, truncated: r.truncated, next_from: r.truncated ? from + r.next : null },
  }
}

// ── 시트 ────────────────────────────────────────────────────
const colLetter = (i) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
async function readSheet(file, a, budget) {
  const { rows } = await query('SELECT content FROM ws_files WHERE id = $1', [file.id])
  const c = rows[0]?.content
  const sheets = Array.isArray(c?.sheets) ? c.sheets : c && Array.isArray(c.columns) ? [{ name: '시트1', ...c }] : []
  if (!sheets.length) return { text: '(내용 없음)', meta: { sheets: [] } }
  const names = sheets.map((s, i) => s.name || s.title || `시트${i + 1}`)
  let idx = 0
  if (a.sheet) {
    const f = names.findIndex((n) => n === String(a.sheet))
    if (f < 0) return { error: `시트 "${a.sheet}" 를 찾을 수 없습니다. 있는 시트: ${names.join(', ')}` }
    idx = f
  }
  const s = sheets[idx]
  const cols = s.columns || []
  const all = s.rows || []
  const from = clampInt(a.from_row, 1, Math.max(1, all.length + 1), 1) // 1 = 머리글, 2 부터 데이터
  const to = clampInt(a.to_row, from, Math.max(from, all.length + 1), all.length + 1)
  const lines = [`열: ${cols.map((col, i) => `${colLetter(i)}=${col.label || col.key}`).join(' | ')}`]
  const body = []
  for (let r = from; r <= to; r++) {
    if (r === 1) { body.push(`1\t${cols.map((col) => String(col.label ?? '')).join('\t')}`); continue }
    const row = all[r - 2]
    if (!row) break
    body.push(`${r}\t${cols.map((col) => String(row.cells?.[col.key] ?? '').replace(/[\t\n]/g, ' ')).join('\t')}`)
  }
  const r = pack(body, budget - lines[0].length)
  lines.push(r.text)
  return {
    text: lines.join('\n'),
    meta: { sheet: names[idx], sheets: names, rows: all.length + 1, columns: cols.length, from_row: from, truncated: r.truncated, next_from_row: r.truncated ? from + r.next : null, note: '수식 칸은 계산 결과가 아니라 입력한 식(=...)이 보입니다. 계산 결과는 sheet_read_sheet 로 봅니다(편집기 탭 필요).' },
  }
}

// ── 발표 ────────────────────────────────────────────────────
async function readSlides(file, a, budget) {
  const { rows } = await query('SELECT content FROM ws_files WHERE id = $1', [file.id])
  const slides = Array.isArray(rows[0]?.content?.slides) ? rows[0].content.slides : []
  if (!slides.length) return { text: '(슬라이드 없음)', meta: { slides: 0 } }
  const from = clampInt(a.from, 1, slides.length, 1)
  const to = clampInt(a.to, from, slides.length, slides.length)
  const lines = []
  for (let i = from - 1; i < to; i++) {
    const s = slides[i]
    lines.push(`── 슬라이드 ${i + 1} (${s.layout || 'blank'})`)
    for (const el of s.elements || []) {
      const t = plainHtml(el?.data?.html ?? el?.data?.text ?? el?.text ?? '')
      if (t) lines.push(`  [${el.role || el.type || 'text'}] ${t.replace(/\n/g, ' / ').slice(0, 400)}`)
      else if (el?.type === 'image') lines.push('  [이미지]')
      else if (el?.type === 'table') lines.push('  [표]')
    }
    if (s.notes) lines.push(`  노트: ${String(s.notes).slice(0, 600)}`)
  }
  const r = pack(lines, budget)
  return { text: r.text, meta: { slides: slides.length, from, to, truncated: r.truncated } }
}

// ── 보드 ────────────────────────────────────────────────────
async function readBoard(file, a, budget) {
  const { rows } = await query('SELECT content FROM ws_files WHERE id = $1', [file.id])
  const c = rows[0]?.content || {}
  const canvases = Array.isArray(c.canvases) ? c.canvases : [{ name: '캔버스 1', items: c.items || [], connections: c.connections || [] }]
  const idx = clampInt(a.canvas, 1, canvases.length, 1) - 1
  const cv = canvases[idx]
  const items = cv.items || []
  const lines = [`캔버스 ${idx + 1}/${canvases.length} ${cv.name || ''} (항목 ${items.length}, 연결 ${(cv.connections || []).length})`]
  for (const it of items) {
    if (it.type === 'stroke') continue
    const t = plainHtml(it.data?.html ?? it.data?.text ?? it.data?.title ?? it.data?.name ?? '')
    lines.push(`${it.id} ${it.type} (${Math.round(it.x)},${Math.round(it.y)}) ${t.replace(/\n/g, ' / ').slice(0, 200)}`)
  }
  for (const k of cv.connections || []) lines.push(`연결 ${k.from} -> ${k.to}${k.label ? ` "${k.label}"` : ''}`)
  const r = pack(lines, budget)
  return { text: r.text, meta: { canvases: canvases.length, canvas: idx + 1, items: items.length, truncated: r.truncated } }
}

// ── 설문(폼) ────────────────────────────────────────────────
async function readForm(file, a, budget) {
  const { rows } = await query('SELECT id, slug, title_ko, description_ko, fields, settings, published FROM custom_forms WHERE id = $1', [file.form_id])
  const f = rows[0]
  if (!f) return { error: '설문을 찾을 수 없습니다' }
  const n = (await query('SELECT COUNT(*)::int AS n FROM custom_form_responses WHERE form_id = $1', [f.id])).rows[0]?.n || 0
  const lines = [`설문: ${f.title_ko}${f.published ? ' (공개 중)' : ' (비공개)'} 응답 ${n}건`]
  if (f.description_ko) lines.push(`설명: ${String(f.description_ko).slice(0, 400)}`)
  for (const q of Array.isArray(f.fields) ? f.fields : []) {
    const opts = Array.isArray(q.options) && q.options.length ? ` 보기: ${q.options.map((o) => (typeof o === 'string' ? o : o?.label_ko || o?.label || o?.value || '')).join(' | ')}` : ''
    lines.push(`[${q.id}] ${q.type}${q.required ? ' 필수' : ''} ${q.label_ko || ''}${opts}`.slice(0, 600))
  }
  const r = pack(lines, budget)
  return { text: r.text, meta: { fields: (f.fields || []).length, responses: n, truncated: r.truncated, note: '응답 내용은 form_get_text_responses, form_get_response_stats 로 봅니다(편집기 탭 필요).' } }
}

const READERS = { doc: readDoc, sheet: readSheet, slide: readSlides, board: readBoard, form: readForm }
export const READABLE_KINDS = Object.keys(READERS)

/** 파일 종류별 서버 읽기. 반환: { text, meta } 또는 { error } */
export async function readFileText(file, args = {}) {
  const read = READERS[file.kind]
  if (!read) return { error: `${file.kind} 종류는 read_file_text 로 읽을 수 없습니다. 그 종류의 전용 도구를 쓰세요` }
  const budget = clampInt(args.max_chars, 1000, MAX_BUDGET, DEFAULT_BUDGET)
  return read(file, args, budget)
}
