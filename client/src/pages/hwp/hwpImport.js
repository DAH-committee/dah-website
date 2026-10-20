// 가져오기: kordoc 이 읽은 마크다운 → 편집기 HTML(miri docConvert.js markdownToHtml 을 Tiptap 구조에 맞게 줄였다).
// 허용한 태그만 만든다. 표는 kordoc 이 병합 칸을 HTML 표로 줄 때가 있어 칸 글만 다시 만든다(병합 정보는 유지).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inlineHtml(raw) {
  let s = esc(raw)
  s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>')
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, (m, c) => `&#${c.charCodeAt(0)};`)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt) => (alt ? `[그림: ${alt}]` : '[그림]'))
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, (m, t, u) => `<a href="${u}">${t}</a>`)
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>')
  return s
}

function cleanTableHtml(html) {
  const d = new DOMParser().parseFromString(html, 'text/html')
  const t = d.querySelector('table')
  if (!t) return ''
  const rows = [...t.querySelectorAll('tr')].map((tr, ri) => {
    const cells = [...tr.children].filter((c) => /^(TD|TH)$/.test(c.tagName)).map((c) => {
      const span = ['colspan', 'rowspan'].map((a) => { const v = parseInt(c.getAttribute(a) || '', 10); return v > 1 && v < 50 ? ` ${a}="${v}"` : '' }).join('')
      const tag = ri === 0 || c.tagName === 'TH' ? 'th' : 'td'
      return `<${tag}${span}><p>${esc(c.textContent.replace(/\s+/g, ' ').trim())}</p></${tag}>`
    })
    return `<tr>${cells.join('')}</tr>`
  })
  return `<table><tbody>${rows.join('')}</tbody></table>`
}

const splitRow = (line) => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}
const isSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('-')

export function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0
  const blank = (l) => !l || !l.trim()
  const listRe = /^(\s*)([-*+]|\d+[.)])(?:\s+(.*))?$/
  while (i < lines.length) {
    const line = lines[i]
    if (blank(line)) { i += 1; continue }
    if (/^\s*<table\b/i.test(line)) {
      const buf = []
      while (i < lines.length) { buf.push(lines[i]); if (/<\/table>/i.test(lines[i])) { i += 1; break } i += 1 }
      const t = cleanTableHtml(buf.join('\n'))
      if (t) out.push(t)
      continue
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      const lv = Math.min(4, h[1].length)
      out.push(`<h${lv}>${inlineHtml(h[2])}</h${lv}>`)
      i += 1
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const body = []
      while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) { body.push(splitRow(lines[i])); i += 1 }
      const cols = Math.max(head.length, ...body.map((r) => r.length))
      const fit = (r) => [...r, ...Array(cols - r.length).fill('')]
      out.push(`<table><tbody><tr>${fit(head).map((c) => `<th><p>${inlineHtml(c)}</p></th>`).join('')}</tr>${body.map((r) => `<tr>${fit(r).map((c) => `<td><p>${inlineHtml(c)}</p></td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (/^\s*>/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i += 1 }
      out.push(`<blockquote><p>${inlineHtml(buf.join(' '))}</p></blockquote>`)
      continue
    }
    if (listRe.test(line)) {
      const stack = []
      let html = ''
      while (i < lines.length && !blank(lines[i]) && listRe.test(lines[i])) {
        const [, sp, mark, text] = lines[i].match(listRe)
        const indent = sp.replace(/\t/g, '  ').length
        const ordered = /\d/.test(mark)
        while (stack.length && indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().ordered ? 'ol' : 'ul'}>`
        if (!stack.length || indent > stack[stack.length - 1].indent) { stack.push({ indent, ordered }); html += `<${ordered ? 'ol' : 'ul'}><li>` }
        else html += '</li><li>'
        html += `<p>${inlineHtml(text || '')}</p>`
        i += 1
      }
      while (stack.length) html += `</li></${stack.pop().ordered ? 'ol' : 'ul'}>`
      out.push(html)
      continue
    }
    const buf = []
    while (i < lines.length && !blank(lines[i]) && !/^\s{0,3}#{1,6}\s/.test(lines[i]) && !listRe.test(lines[i]) && !/^\s*<table\b/i.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isSep(lines[i + 1]))) {
      buf.push(lines[i].replace(/\s{2,}$/, '<br>').trim())
      i += 1
    }
    if (buf.length) out.push(`<p>${buf.map(inlineHtml).join(' ').replace(/&lt;br&gt;/g, '<br>')}</p>`)
  }
  return out.join('') || '<p></p>'
}

/** 한글 파일에서 가져온 글이 공문 꼴인지 보고 양식을 고른다 */
export function guessPreset(md) {
  const s = String(md || '')
  if (/수\s*신/.test(s) && /제\s*목/.test(s) && /^\s*(?:\d+\.|가\.)/m.test(s)) return '기안문'
  if (/회의록/.test(s)) return '회의록'
  if (/보도자료/.test(s)) return '보도자료'
  if (/계획/.test(s.slice(0, 200))) return '계획서'
  return '보고서'
}
