// 작은 HTML 해석기. 클립보드 HTML(구글 문서·슬라이드, 웹, DAH 글 상자)을 나무 모양으로 읽는다.
// DOM 없이 돌아가므로 node --test로 검사할 수 있다. 스크립트·스타일 내용은 버린다.
// 결과는 화면에 바로 넣지 않는다. 글자와 서식만 뽑아 쓰고, 최종 HTML은 sanitize.js로 다시 거른다.

const VOID = new Set(['br', 'img', 'meta', 'hr', 'input', 'link', 'col', 'area', 'base', 'wbr', 'source'])
const SKIP = new Set(['script', 'style', 'title', 'head', 'template', 'noscript', 'svg', 'math', 'iframe', 'object'])
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '·', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', copy: '©', reg: '®', trade: '™', times: '×' }

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    const v = NAMED[e.toLowerCase()]
    return v === undefined ? m : v
  })
}

export const escapeText = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
export const escapeAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function parseAttrs(src) {
  const attrs = {}
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return attrs
}

/** HTML 문자열 → { tag:'#root', children:[ {tag, attrs, children} | {text} ] } */
export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const s = String(html || '')
  let i = 0
  const top = () => stack[stack.length - 1]
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt < 0) {
      top().children.push({ text: decodeEntities(s.slice(i)) })
      break
    }
    if (lt > i) top().children.push({ text: decodeEntities(s.slice(i, lt)) })
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4)
      i = end < 0 ? s.length : end + 3
      continue
    }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') {
      const end = s.indexOf('>', lt)
      i = end < 0 ? s.length : end + 1
      continue
    }
    const gt = s.indexOf('>', lt)
    if (gt < 0) {
      top().children.push({ text: decodeEntities(s.slice(lt)) })
      break
    }
    const raw = s.slice(lt + 1, gt)
    i = gt + 1
    if (raw[0] === '/') {
      const name = raw.slice(1).trim().toLowerCase()
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name) {
          stack.length = k
          break
        }
      }
      continue
    }
    const m = /^([a-zA-Z][\w:-]*)([\s\S]*)$/.exec(raw)
    if (!m) {
      top().children.push({ text: '<' })
      i = lt + 1
      continue
    }
    const tag = m[1].toLowerCase()
    if (SKIP.has(tag)) {
      const close = s.toLowerCase().indexOf(`</${tag}`, i)
      if (close < 0) i = s.length
      else {
        const e2 = s.indexOf('>', close)
        i = e2 < 0 ? s.length : e2 + 1
      }
      continue
    }
    const node = { tag, attrs: parseAttrs(m[2].replace(/\/\s*$/, '')), children: [] }
    // <p> 안에서 새 블록이 열리면 앞 <p>를 닫는다(브라우저와 비슷하게)
    if (/^(p|div|ul|ol|li|h[1-6]|table|blockquote|pre)$/.test(tag) && top().tag === 'p') stack.pop()
    if (tag === 'li') {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === 'ul' || stack[k].tag === 'ol') break
        if (stack[k].tag === 'li') {
          stack.length = k
          break
        }
      }
    }
    top().children.push(node)
    if (!VOID.has(tag) && !/\/\s*$/.test(m[2])) stack.push(node)
  }
  return root
}

/** style 속성 → { 'font-weight': '700', ... } */
export function parseStyle(str) {
  const out = {}
  for (const decl of String(str || '').split(';')) {
    const k = decl.indexOf(':')
    if (k < 0) continue
    const name = decl.slice(0, k).trim().toLowerCase()
    const val = decl.slice(k + 1).trim()
    if (name && val) out[name] = val
  }
  return out
}

/** 나무 안 글자만 */
export function textOf(node) {
  if (!node) return ''
  if (node.text !== undefined) return node.text
  if (node.tag === 'br') return '\n'
  return (node.children || []).map(textOf).join('')
}

/** 조건에 맞는 노드를 모두 */
export function findAll(node, pred, out = []) {
  if (!node || node.text !== undefined) return out
  if (pred(node)) out.push(node)
  for (const c of node.children || []) findAll(c, pred, out)
  return out
}
