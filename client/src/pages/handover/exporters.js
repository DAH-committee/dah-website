// 인수인계 문서 내보내기: Word(.docx), PDF, Markdown(.md), 일반 텍스트(.txt), 웹페이지(.html).
// 비밀값(계정 비밀번호)은 어떤 형식에도 값이 들어가지 않고 "[비밀값: 이름]"으로만 남는다.

const safeName = (s) => String(s || '문서').replace(/[\\/:*?"<>|]+/g, ' ').trim() || '문서'

export function download(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

const absUrl = (u) => (u && u.startsWith('/') ? `${window.location.origin}${u}` : u)

// ── Markdown ───────────────────────────────────────────────
function mdInline(nodes = []) {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'secret') return `[비밀값: ${n.attrs?.label || ''}]`
      if (n.type === 'image') return `![](${absUrl(n.attrs?.src)})`
      let t = n.text || ''
      if (!t) return ''
      const marks = n.marks || []
      const has = (m) => marks.some((x) => x.type === m)
      if (has('bold')) t = `**${t}**`
      if (has('italic')) t = `*${t}*`
      if (has('strike')) t = `~~${t}~~`
      if (has('code')) t = `\`${t}\``
      const link = marks.find((x) => x.type === 'link')
      if (link) t = `[${t}](${absUrl(link.attrs.href)})`
      return t
    })
    .join('')
}

function mdBlock(node, depth = 0) {
  const pad = '  '.repeat(depth)
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(node.attrs.level)} ${mdInline(node.content)}\n`
    case 'paragraph':
      return `${pad}${mdInline(node.content)}\n`
    case 'bulletList':
      return (node.content || []).map((li) => mdItem(li, depth, '- ')).join('')
    case 'orderedList':
      return (node.content || []).map((li, i) => mdItem(li, depth, `${i + 1}. `)).join('')
    case 'taskList':
      return (node.content || []).map((li) => mdItem(li, depth, li.attrs?.checked ? '- [x] ' : '- [ ] ')).join('')
    case 'blockquote':
      return (node.content || []).map((c) => `> ${mdBlock(c)}`).join('')
    case 'horizontalRule':
      return '---\n'
    case 'codeBlock':
      return `\`\`\`\n${(node.content || []).map((c) => c.text).join('')}\n\`\`\`\n`
    case 'image':
      return `![](${absUrl(node.attrs?.src)})\n`
    case 'table': {
      const rows = (node.content || []).map((r) =>
        (r.content || []).map((c) => (c.content || []).map((p) => mdInline(p.content)).join(' ').replace(/\|/g, '\\|'))
      )
      if (!rows.length) return ''
      const head = `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n`
      return head + rows.slice(1).map((r) => `| ${r.join(' | ')} |\n`).join('')
    }
    default:
      return (node.content || []).map((c) => mdBlock(c, depth)).join('')
  }
}

function mdItem(li, depth, bullet) {
  const pad = '  '.repeat(depth)
  const [first, ...rest] = li.content || []
  let out = `${pad}${bullet}${first ? mdInline(first.content) : ''}\n`
  for (const c of rest) out += mdBlock(c, depth + 1)
  return out
}

export function toMarkdown(json, title) {
  const body = (json.content || []).map((n) => mdBlock(n)).join('\n').replace(/\n{3,}/g, '\n\n')
  return `<!-- ${title} -->\n\n${body.trim()}\n`
}

// ── 일반 텍스트 ────────────────────────────────────────────
function textOf(node) {
  if (node.type === 'text') return node.text
  if (node.type === 'secret') return `[비밀값: ${node.attrs?.label || ''}]`
  if (node.type === 'hardBreak') return '\n'
  return (node.content || []).map(textOf).join(node.type === 'tableRow' ? '\t' : '')
}

export function toPlainText(json) {
  const lines = []
  const walk = (n, prefix = '') => {
    if (['paragraph', 'heading'].includes(n.type)) return lines.push(prefix + textOf(n))
    if (n.type === 'tableRow') return lines.push((n.content || []).map(textOf).join('\t'))
    if (n.type === 'listItem' || n.type === 'taskItem') {
      const [first, ...rest] = n.content || []
      lines.push(`${prefix}${n.type === 'taskItem' ? (n.attrs?.checked ? '☑ ' : '☐ ') : '• '}${first ? textOf(first) : ''}`)
      rest.forEach((c) => walk(c, prefix + '  '))
      return null
    }
    ;(n.content || []).forEach((c) => walk(c, prefix))
    return null
  }
  walk(json)
  return lines.join('\n')
}

// ── HTML ───────────────────────────────────────────────────
export function toHtml(html, title) {
  const clean = html
    .replace(/<span[^>]*data-secret-id[^>]*data-label="([^"]*)"[^>]*>.*?<\/span>/g, '[비밀값: $1]')
    .replace(/ data-comment="[^"]*"/g, '')
    .replace(/ class="gd-cmark"/g, '')
    .replace(/src="\//g, `src="${window.location.origin}/`)
    .replace(/href="\//g, `href="${window.location.origin}/`)
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Pretendard,'Noto Sans KR',sans-serif;max-width:816px;margin:40px auto;padding:0 24px;line-height:1.7;font-size:11pt}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:6px 9px;vertical-align:top}th{background:#f3f3f3}
ul[data-type=taskList]{list-style:none;padding-left:4px}img{max-width:100%}</style></head><body>${clean}</body></html>`
}

// ── Word(.docx) ────────────────────────────────────────────
async function imageToPng(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = Math.min(img.naturalWidth, 1200)
      const h = Math.round((img.naturalHeight * w) / img.naturalWidth)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      c.toBlob(async (b) => resolve(b ? { data: await b.arrayBuffer(), w, h } : null), 'image/png')
    }
    img.onerror = () => resolve(null)
    img.src = absUrl(src)
  })
}

export async function toDocx(json, title) {
  const d = await import('docx')
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, Table, TableRow, TableCell,
    WidthType, ImageRun, AlignmentType, BorderStyle, LevelFormat,
  } = d
  const HL = { 1: HeadingLevel.TITLE, 2: HeadingLevel.HEADING_1, 3: HeadingLevel.HEADING_2, 4: HeadingLevel.HEADING_3 }
  const AL = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }
  const halfPt = (fs) => {
    const m = /([\d.]+)pt/.exec(fs || '')
    return m ? Math.round(Number(m[1]) * 2) : undefined
  }

  async function runs(nodes = []) {
    const out = []
    for (const n of nodes) {
      if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue }
      if (n.type === 'secret') { out.push(new TextRun({ text: `[비밀값: ${n.attrs?.label || ''}]`, italics: true, color: '5F6368' })); continue }
      if (n.type === 'image') {
        const png = await imageToPng(n.attrs?.src)
        if (png) out.push(new ImageRun({ type: 'png', data: png.data, transformation: { width: Math.min(600, png.w), height: Math.round((Math.min(600, png.w) * png.h) / png.w) } }))
        continue
      }
      if (n.type !== 'text') continue
      const m = Object.fromEntries((n.marks || []).map((x) => [x.type, x.attrs || true]))
      const ts = m.textStyle || {}
      const opt = {
        text: n.text,
        bold: !!m.bold,
        italics: !!m.italic,
        underline: m.underline ? {} : undefined,
        strike: !!m.strike,
        font: ts.fontFamily ? ts.fontFamily.split(',')[0].replace(/['"]/g, '').trim() : undefined,
        size: halfPt(ts.fontSize),
        color: ts.color ? ts.color.replace('#', '') : undefined,
        shading: m.highlight ? { fill: (m.highlight.color || '#FFF2CC').replace('#', '') } : undefined,
      }
      if (m.link) out.push(new ExternalHyperlink({ link: absUrl(m.link.href), children: [new TextRun({ ...opt, style: 'Hyperlink' })] }))
      else out.push(new TextRun(opt))
    }
    return out
  }

  async function blocks(node, ctx = {}) {
    const out = []
    switch (node.type) {
      case 'heading':
        out.push(new Paragraph({ heading: HL[node.attrs.level] || HeadingLevel.HEADING_3, alignment: AL[node.attrs.textAlign], children: await runs(node.content) }))
        break
      case 'paragraph':
        out.push(new Paragraph({
          alignment: AL[node.attrs?.textAlign],
          children: [...(ctx.prefix ? [new TextRun(ctx.prefix)] : []), ...(await runs(node.content))],
          bullet: ctx.bullet !== undefined ? { level: ctx.bullet } : undefined,
          numbering: ctx.number !== undefined ? { reference: 'num', level: ctx.number } : undefined,
          indent: ctx.indent ? { left: ctx.indent } : undefined,
        }))
        break
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const level = (ctx.level ?? -1) + 1
        for (const li of node.content || []) {
          const [first, ...rest] = li.content || []
          if (first) {
            const c = node.type === 'bulletList' ? { bullet: level } : node.type === 'orderedList' ? { number: level } : { prefix: li.attrs?.checked ? '☑ ' : '☐ ', indent: 360 * (level + 1) }
            out.push(...(await blocks(first, c)))
          }
          for (const r of rest) out.push(...(await blocks(r, { level })))
        }
        break
      }
      case 'horizontalRule':
        out.push(new Paragraph({ border: { bottom: { color: 'C4C7C5', space: 1, style: BorderStyle.SINGLE, size: 6 } }, children: [] }))
        break
      case 'image':
        out.push(new Paragraph({ children: await runs([node]) }))
        break
      case 'blockquote':
        for (const c of node.content || []) out.push(...(await blocks(c, { indent: 480 })))
        break
      case 'table': {
        const rows = []
        for (const r of node.content || []) {
          const cells = []
          for (const c of r.content || []) {
            const kids = []
            for (const p of c.content || []) kids.push(...(await blocks(p)))
            cells.push(new TableCell({ children: kids.length ? kids : [new Paragraph('')], shading: c.type === 'tableHeader' ? { fill: 'F3F3F3' } : undefined }))
          }
          rows.push(new TableRow({ children: cells }))
        }
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
        out.push(new Paragraph(''))
        break
      }
      default:
        for (const c of node.content || []) out.push(...(await blocks(c, ctx)))
    }
    return out
  }

  const children = []
  for (const n of json.content || []) children.push(...(await blocks(n)))
  const doc = new d.Document({
    creator: '디지털인문예술전공 운영위원회',
    title,
    styles: { default: { document: { run: { font: 'Pretendard', size: 22 } } } },
    numbering: {
      config: [{
        reference: 'num',
        levels: [0, 1, 2, 3].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })),
      }],
    },
    sections: [{ children }],
  })
  void Document
  return Packer.toBlob(doc)
}

// ── PDF ────────────────────────────────────────────────────
export async function toPdf(pageEl, title) {
  const html2pdf = (await import('html2pdf.js')).default
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;background:#fff'
  const page = document.createElement('div')
  page.className = 'gd-page gd-page--export'
  page.innerHTML = pageEl.querySelector('.ProseMirror').innerHTML
  page.querySelectorAll('[data-comment]').forEach((el) => el.removeAttribute('data-comment'))
  page.querySelectorAll('.gd-secret').forEach((el) => {
    el.replaceWith(document.createTextNode(`[비밀값: ${el.getAttribute('data-label') || el.querySelector('.gd-secret__label')?.textContent || ''}]`))
  })
  wrap.appendChild(page)
  document.body.appendChild(wrap)
  try {
    await html2pdf()
      .set({
        margin: [12, 12, 14, 12],
        filename: `${safeName(title)}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'img', 'h2', 'h3'] },
      })
      .from(page)
      .save()
  } finally {
    wrap.remove()
  }
}

export { safeName }
