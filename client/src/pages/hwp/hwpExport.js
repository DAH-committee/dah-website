// 문서(Tiptap JSON) → 한글(HWPX) 요청 본문. 서버 /api/hwpx/generate 계약(server/src/routes/hwpx.js 머리말)을 따른다.
// 굵게와 기울임은 마크다운으로, 그 밖의 글자 모양(크기, 색, 밑줄, 취소선, 형광펜, 한글 글꼴, 장평, 자간)은 ⟪sN⟫글⟪/⟫ 표지와 spans 로,
// 문단 모양(정렬, 줄 간격, 쪽 나눔)은 ⟪pN⟫ 표지와 paras 로 보낸다. 자료값은 지금 값의 글로 바뀌어 들어간다.
import { API_BASE } from '../../hooks/useApi'
import { hwpFontOf, isStandard } from './hwpDoc'
import { fillTokens, resolveVars } from './hwpVars'

const hex = (c) => {
  if (!c) return null
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c.slice(1).split('').map((x) => x + x).join('')}`.toUpperCase()
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase() : null
}
const toPt = (v) => {
  if (!v) return null
  const n = parseFloat(v)
  if (/pt$/.test(v)) return n
  if (/px$/.test(v)) return Math.round(((n * 72) / 96) * 10) / 10
  return Number.isFinite(n) ? n : null
}
const mdEsc = (s, inTable) => {
  let t = String(s).replace(/⟪|⟫/g, '').replace(/([\\*_`~])/g, '\\$1')
  if (inTable) t = t.replace(/\|/g, '\\|')
  return t
}
const keyOf = (st) => JSON.stringify(Object.keys(st).sort().map((k) => [k, st[k]]))

function styleOf(marks = []) {
  const st = {}
  for (const m of marks) {
    if (m.type === 'bold') st.b = 1
    else if (m.type === 'italic') st.i = 1
    else if (m.type === 'underline') st.u = 1
    else if (m.type === 'strike') st.s = 1
    else if (m.type === 'highlight') { const c = hex(m.attrs?.color || '#FFEA00'); if (c) st.bg = c }
    else if (m.type === 'textStyle') {
      const a = m.attrs || {}
      const c = hex(a.color); if (c && c !== '#000000') st.color = c
      const pt = toPt(a.fontSize); if (pt) st.pt = pt
      const f = hwpFontOf(a.fontFamily); if (f) st.font = f
      if (a.ratio && Number(a.ratio) !== 100) st.ratio = Number(a.ratio)
      if (a.spacing) st.spacing = Number(a.spacing)
    }
  }
  return st
}

export function toHwpxPayload(json, settings) {
  const vars = settings?.vars || {}
  const doc = resolveVars(json, vars)
  const preset = settings?.preset || '보고서'
  const standard = isStandard(preset)
  const spans = {}
  const paras = {}
  const images = []
  let sn = 0
  let pn = 0
  let pageBreak = false

  const inline = (nodes = [], inTable = false) => {
    const runs = []
    for (const n of nodes) {
      if (n.type === 'text') runs.push({ text: n.text || '', st: styleOf(n.marks) })
      else if (n.type === 'hardBreak') runs.push({ text: ' ', st: {} })
      else if (n.type === 'secret') runs.push({ text: `[비밀값: ${n.attrs?.label || ''}]`, st: {} })
    }
    const merged = []
    for (const r of runs) {
      const last = merged[merged.length - 1]
      if (last && keyOf(last.st) === keyOf(r.st)) last.text += r.text
      else merged.push({ ...r })
    }
    let md = ''
    for (const r of merged) {
      const text = r.text.replace(/\s+/g, ' ')
      if (!text) continue
      const extra = Object.keys(r.st).filter((k) => k !== 'b' && k !== 'i')
      if (extra.length) {
        sn += 1
        spans[sn] = r.st
        md += `⟪s${sn}⟫${mdEsc(text, inTable)}⟪/⟫`
        continue
      }
      const lead = text.match(/^\s*/)[0]
      const tail = text.match(/\s*$/)[0]
      const core = text.trim()
      if (!core) { md += text; continue }
      const w = r.st.b && r.st.i ? '***' : r.st.b ? '**' : r.st.i ? '*' : ''
      md += `${lead}${w}${mdEsc(core, inTable)}${w}${tail}`
    }
    return md.trim()
  }
  const paraMark = (node) => {
    const p = {}
    const a = node.attrs?.textAlign
    if (a && ['left', 'center', 'right', 'justify'].includes(a)) p.align = a
    if (node.attrs?.lineHeight) p.lh = Number(node.attrs.lineHeight)
    if (pageBreak) { p.pageBreak = 1; pageBreak = false }
    if (!Object.keys(p).length) return ''
    pn += 1
    paras[pn] = p
    return `⟪p${pn}⟫`
  }
  const textOfBlock = (n, inTable) => {
    if (n.type === 'paragraph' || n.type === 'heading') return inline(n.content, inTable)
    return (n.content || []).map((c) => textOfBlock(c, inTable)).filter(Boolean).join(' ')
  }

  const blocks = [] // { md, list }
  let base = 0 // 기안문 계열: 목록이 들어갈 단계(마지막 장·절 제목 아래)
  const listLines = (list, depth, out) => {
    for (const item of list.content || []) {
      const [first, ...rest] = item.content || []
      const check = list.type === 'taskList' ? (item.attrs?.checked ? '☑ ' : '☐ ') : ''
      const lv = standard ? base + depth : depth
      const text = first?.type === 'paragraph' ? `${paraMark(first)}${check}${inline(first.content)}` : check
      out.push(`${'  '.repeat(Math.max(0, lv - 1))}- ${text || ' '}`)
      for (const c of rest) {
        if (/List$/.test(c.type)) listLines(c, depth + 1, out)
        else if (c.type === 'paragraph') {
          const t = inline(c.content)
          if (t) out.push(`${'  '.repeat(Math.max(0, lv))}- ${t}`)
        }
      }
    }
  }
  const imageRef = (src, alt = '') => {
    if (!src) return ''
    const name = `img${images.length + 1}`
    images.push({ name, src })
    return `![${mdEsc(alt || '그림')}](${name})`
  }

  for (const n of doc.content || []) {
    const t = n.type
    if (t === 'horizontalRule') { pageBreak = true; continue }
    if (t === 'heading') {
      const lv = n.attrs?.level
      const text = inline(n.content)
      if (!text) continue
      if (lv === 1) { base = 0; blocks.push({ md: `# ${paraMark(n)}${text}` }); continue }
      if (lv === 2) {
        if (standard) { base = 1; blocks.push({ md: `- ${paraMark(n)}${text}`, list: true }) }
        else blocks.push({ md: `## ${paraMark(n)}${text}` })
        continue
      }
      if (lv === 3) {
        if (standard) { const l = base >= 1 ? 2 : 1; base = l; blocks.push({ md: `${'  '.repeat(l - 1)}- ${paraMark(n)}${text}`, list: true }) }
        else blocks.push({ md: `### ${paraMark(n)}${text}` })
        continue
      }
      blocks.push({ md: `${paraMark(n)}**${text.replace(/\*\*/g, '')}**` })
      continue
    }
    if (t === 'paragraph') {
      const text = inline(n.content)
      if (!text) continue
      // 끝 표시는 kordoc 이 양식에 맞게 붙인다(기안문). 손으로 쓴 '끝.' 문단은 빼서 두 번 찍히지 않게 한다
      if (preset === '기안문' && text.replace(/\s/g, '') === '끝.') continue
      if (standard && !/^※/.test(text)) base = 0
      blocks.push({ md: `${paraMark(n)}${text}` })
      continue
    }
    if (t === 'bulletList' || t === 'orderedList' || t === 'taskList') {
      const out = []
      listLines(n, 1, out)
      if (out.length) blocks.push({ md: out.join('\n'), list: true })
      continue
    }
    if (t === 'blockquote') {
      const text = textOfBlock(n)
      if (text) blocks.push({ md: `> ${text}` })
      continue
    }
    if (t === 'table') {
      const rows = (n.content || []).map((r) => (r.content || []).map((c) => (c.content || []).map((p) => textOfBlock(p, true)).filter(Boolean).join(' ') || ' '))
      if (!rows.length) continue
      const cols = Math.max(...rows.map((r) => r.length))
      const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? ' ').join(' | ')} |`
      blocks.push({ md: [line(rows[0]), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') })
      continue
    }
    if (t === 'image') {
      const ref = imageRef(n.attrs?.src, n.attrs?.alt)
      if (ref) blocks.push({ md: ref })
      continue
    }
    if (t === 'codeBlock') {
      const text = (n.content || []).map((c) => c.text || '').join('')
      if (text.trim()) blocks.push({ md: text.split('\n').map((l) => mdEsc(l)).join('\n\n') })
      continue
    }
    const text = textOfBlock(n)
    if (text) blocks.push({ md: text })
  }
  // 목록끼리(기안문의 장 제목 항목과 그 아래 목록)는 빈 줄 없이 이어 하나의 목록으로 만든다
  let md = ''
  blocks.forEach((b, i) => {
    if (i > 0) md += b.list && blocks[i - 1].list ? '\n' : '\n\n'
    md += b.md
  })
  if (!md.trim()) md = ' '
  return { markdown: `${md.trim()}\n`, spans, paras, images }
}

/** 문서 설정 → kordoc 공문 옵션(두문, 결문은 {이름} 자리를 자료값으로 채운다) */
export function gongmunOptions(settings) {
  const s = settings || {}
  const vars = s.vars || {}
  const o = {}
  if (s.preset === '기안문') {
    const h = s.head || {}
    o.docHead = Object.fromEntries(['org', 'to', 'via', 'title'].map((k) => [k, fillTokens(h[k], vars)]).filter(([, v]) => v))
    const f = s.foot || {}
    const foot = Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, fillTokens(v, vars)]))
    if (Object.keys(foot).length) o.docFoot = foot
  }
  if (s.preset === '보도자료' && s.press) {
    const f = (k) => fillTokens(s.press[k], vars)
    o.press = { release: f('release'), contact: { dept: f('dept'), manager: f('manager'), phone: f('phone') } }
  }
  if (s.pageNumbers != null) o.pageNumbers = !!s.pageNumbers
  return o
}

// 이미지: 같은 주소에서 받아 긴 변 1400px 이하 JPEG 로 줄여 넣는다(요청 2MB 상한). 못 받으면 빼고 알린다.
async function toDataUrl(src) {
  const res = await fetch(src, { credentials: src.startsWith('/') ? 'include' : 'omit' })
  if (!res.ok) throw new Error(String(res.status))
  const blob = await res.blob()
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * scale))
  c.height = Math.max(1, Math.round(bmp.height * scale))
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85)
}

/** 서버로 보낼 본문 전체 */
export async function buildRequest(json, settings, title) {
  const p = toHwpxPayload(json, settings)
  const images = []
  let dropped = 0
  let budget = 1.5 * 1024 * 1024
  for (const im of p.images) {
    try {
      const dataUrl = await toDataUrl(im.src)
      if (dataUrl.length > budget) { dropped += 1; continue }
      budget -= dataUrl.length
      images.push({ name: im.name, dataUrl })
    } catch {
      dropped += 1
    }
  }
  return { body: { title, preset: settings?.preset || '보고서', markdown: p.markdown, options: gongmunOptions(settings), spans: p.spans, paras: p.paras, images }, dropped }
}

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    let msg = `요청 실패 (${res.status})`
    try { const j = await res.json(); msg = j?.error?.message || j?.error || msg } catch { /* 본문 없음 */ }
    if (res.status === 413) msg = '문서가 너무 큽니다. 그림 수를 줄여 주세요'
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return res
}

export async function generateHwpx(body) {
  const res = await post('/hwpx/generate', body)
  return { blob: await res.blob(), warnings: decodeURIComponent(res.headers.get('X-Hwpx-Warnings') || '') }
}
export async function previewHwpx(body) {
  return (await post('/hwpx/preview', body)).json()
}
export async function lintHwp(text, preset) {
  return (await post('/hwpx/lint', { text, preset })).json()
}
export async function parseHwpFile(file) {
  const fd = new FormData()
  fd.append('file', file, file.name)
  const res = await fetch(`${API_BASE}/hwpx/parse`, { method: 'POST', credentials: 'include', body: fd })
  const j = await res.json().catch(() => null)
  if (!res.ok) throw new Error(j?.error?.message || `가져오기 실패 (${res.status})`)
  return j
}

// 미리보기 SVG 는 쪽이 세로로 이어진 한 장이다. 쪽마다 viewBox 를 잘라 A4 한 장씩으로 나눈다(miri hwpPages.js)
export function splitPages(svgText, { pageCount = 1, width, height } = {}) {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = parsed.documentElement
  const vb = (svg.getAttribute('viewBox') || `0 0 ${width} ${height}`).split(/[\s,]+/).map(Number)
  const W = width || vb[2]
  const H = 841.89
  const n = Math.max(1, pageCount)
  const gap = n > 1 ? (vb[3] - n * H) / (n - 1) : 0
  const inner = svg.innerHTML
  return Array.from({ length: n }, (_, i) => {
    const y = vb[1] + i * (H + gap)
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb[0]} ${y} ${W} ${H}" width="794" height="1123"><style>text{white-space:pre}</style><rect x="${vb[0]}" y="${y}" width="${W}" height="${H}" fill="#fff"/>${inner}</svg>`
  })
}
