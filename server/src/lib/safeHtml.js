// lib/safeHtml.js: 허용 목록 방식 HTML 정리 (외부에서 가져온 HTML을 문서에 넣기 전에 쓴다).
// 새 의존성 없이 토큰 단위로 다시 쓴다. 허용하지 않은 태그는 벗기고(안의 글은 남김), script/style 등은 내용까지 지운다.
// 속성은 a[href], img[src, alt], 할 일 목록의 data-type·data-checked만 남기고, 주소는 http(s)만 허용한다. 이벤트 속성, style, class는 모두 버린다.

const ALLOWED = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
  'a', 'img', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
])
const VOID = new Set(['br', 'hr', 'img'])
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title'])
// 태그 이름 정리: b→strong, i→em, strike/del→s, h4→h3(편집기가 제목 3단계까지)
const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', h4: 'h3' }

const escText = (t) => t.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (t) => String(t).replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function decodeEntities(v) {
  return String(v)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** http(s) 주소만 통과. 제어 문자와 공백을 지운 뒤 검사하므로 "java\tscript:" 같은 우회도 막힌다 */
export function safeUrl(v) {
  // eslint-disable-next-line no-control-regex
  const u = decodeEntities(v).replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
  return /^https?:\/\//i.test(u) && u.length <= 4000 ? u : null
}

function attrsOf(src) {
  const out = {}
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

export function sanitizeHtml(input) {
  const html = String(input ?? '')
  const out = []
  const stack = []
  let skip = null // script 같은 태그 안은 닫힐 때까지 건너뛴다
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<[^>]*>|[^<]+|</g
  let m
  while ((m = re.exec(html))) {
    const tok = m[0]
    if (tok.startsWith('<!--')) continue
    if (!m[1]) {
      if (skip) continue
      if (tok[0] === '<') continue // 짝 없는 꺾쇠, 선언문 등은 버린다
      out.push(escText(tok))
      continue
    }
    const name = m[1].toLowerCase()
    const closing = tok[1] === '/'
    if (skip) {
      if (closing && name === skip) skip = null
      continue
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !tok.endsWith('/>')) skip = name
      continue
    }
    if (!ALLOWED.has(name)) continue // 태그만 벗기고 안의 글은 둔다
    const tag = RENAME[name] || name
    if (closing) {
      if (VOID.has(tag)) continue
      const at = stack.lastIndexOf(tag)
      if (at < 0) continue
      while (stack.length > at) out.push(`</${stack.pop()}>`)
      continue
    }
    const attrs = attrsOf(m[2] || '')
    if (tag === 'a') {
      const href = safeUrl(attrs.href || '')
      if (!href) continue // 주소가 없는 링크는 글만 남긴다
      out.push(`<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`)
      stack.push('a')
    } else if (tag === 'img') {
      const src = safeUrl(attrs.src || '')
      if (src) out.push(`<img src="${escAttr(src)}"${attrs.alt ? ` alt="${escAttr(decodeEntities(attrs.alt).slice(0, 300))}"` : ''}>`)
    } else if (VOID.has(tag)) {
      out.push(`<${tag}>`)
    } else if (tag === 'ul' && attrs['data-type'] === 'taskList') {
      // Tiptap 할 일 목록(편집기가 읽는 형식)만 허용한다
      out.push('<ul data-type="taskList">')
      stack.push('ul')
    } else if (tag === 'li' && attrs['data-type'] === 'taskItem') {
      out.push(`<li data-type="taskItem" data-checked="${attrs['data-checked'] === 'true' ? 'true' : 'false'}">`)
      stack.push('li')
    } else {
      out.push(`<${tag}>`)
      stack.push(tag)
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`)
  return out.join('').trim()
}
