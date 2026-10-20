// DAH Slides AI 도구. 계약서: client/src/components/ai/README.md
//
// 구성
//   순수 함수(DOM 없음, node --test 가능): 글 읽기(htmlLines), 글 바꾸기(retextHtml), 발표 요약(compactDeck 등),
//     op* 함수(발표 전체 객체를 받아 새 발표 객체를 돌려준다. 입력은 믿지 않고 모두 검사한다)
//   createSlideTools(host): 편집기에 묶는 Tool[] 을 만든다. 바꾸기는 편집기의 commit(실행취소 기록 한 번)을 거친다.
//
// 슬라이드 번호는 모델에게 1부터 센다(사람 말과 같게). 요소는 id 또는 역할(title, body ...)로 가리킨다.
// 모델이 준 글은 HTML로 해석하지 않는다. 글자는 escapeHtml 로 거르고, 서식 태그는 기존 글 상자에서만 이어받는다.
// 주소(이미지)는 http/https 만 쓴다(sanitizeImageSrc).
import { LAYOUTS, THEMES, applyLayout, escapeHtml, layoutById, makeSlide, outlineToSlides, themeById, themeCopy } from './deckCore.js'
import { sanitizeImageSrc, sanitizeRich } from './sanitize.js'
import { ToolError, createExtraSlideTools } from './aiSlideExtra.js'
import { estimateText, ptOf } from './slideMetrics.js'

export const MAX_TEXT = 8000
export const MAX_NOTES = 20000
export const MAX_SLIDES = 300
const MAX_OUTLINE = 30000
const MAX_OUTLINE_SLIDES = 80
const MAX_FIXES = 120
const READ_CAP = 26000

const fail = (msg) => {
  throw new ToolError(msg)
}

// ── 글 읽기 ─────────────────────────────────────────────
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const stripTags = (s) => decode(String(s).replace(/<[^>]*>/g, ''))

/** 글 상자 HTML → [{text, list, level}] (문단·목록 항목 하나가 한 줄) */
export function htmlLines(html) {
  const out = []
  let cur = null
  let depth = 0
  const open = (list, level) => {
    cur = { text: '', list, level }
    out.push(cur)
  }
  const re = /<(\/?)([a-z0-9]+)\b[^>]*>|([^<]+)/gi
  let m
  const src = String(html || '')
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) {
      if (!cur) open(false, 0)
      cur.text += decode(m[3])
      continue
    }
    const close = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      depth += close ? -1 : 1
      if (close) cur = null
    } else if (tag === 'li') {
      if (close) cur = null
      else open(true, Math.max(0, Math.min(depth - 1, 1)))
    } else if (tag === 'p' || tag === 'div') {
      if (close) cur = null
      else open(false, 0)
    } else if (tag === 'br') {
      if (!cur) open(false, 0)
      else if (cur.text !== '') {
        const prev = cur
        open(prev.list, prev.level)
      }
    }
  }
  while (out.length && !out[out.length - 1].text.trim()) out.pop()
  return out
}

/** 글 상자 → 모델에게 보일 글(목록은 "- ", 안쪽 목록은 두 칸 들여쓰기) */
export function htmlToText(html) {
  return htmlLines(html)
    .map((l) => (l.list ? `${'  '.repeat(l.level)}- ` : '') + l.text)
    .join('\n')
}

// ── 글 바꾸기(서식 유지) ───────────────────────────────────
const INLINE = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'font', 'sub', 'sup'])
const BULLET = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/

/** 모델이 준 글 → [{text, list, level, ordered}] */
export function parseNewLines(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = lines.map((raw) => {
    const m = raw.match(BULLET)
    if (m) return { text: m[3].trim(), list: true, level: m[1].replace(/\t/g, '  ').length >= 2 ? 1 : 0, ordered: /\d/.test(m[2]) }
    return { text: raw.trim(), list: false, level: 0, ordered: false }
  })
  while (out.length && !out[0].text) out.shift()
  while (out.length && !out[out.length - 1].text) out.pop()
  return out
}

/** 글 속 첫 글자가 입은 서식 태그(span, b, i ...)를 찾는다. 링크(a)는 이어받지 않는다 */
export function firstRunWrap(html) {
  const stack = []
  const re = /<(\/?)([a-z0-9]+)\b([^>]*)>|([^<]+)/gi
  let m
  const src = String(html || '')
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) {
      if (m[4].replace(/&nbsp;/g, ' ').trim()) break
      continue
    }
    const tag = m[2].toLowerCase()
    if (!INLINE.has(tag)) continue
    if (m[1] === '/') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.splice(i, 1)
          break
        }
      }
    } else if (!/\/\s*$/.test(m[3])) stack.push({ tag, open: m[0] })
  }
  return { open: stack.map((s) => s.open).join(''), close: stack.map((s) => `</${s.tag}>`).reverse().join('') }
}

const wrapText = (w, t) => (t ? `${w.open}${escapeHtml(t)}${w.close}` : '')

function buildItems(lines, w, tag) {
  let out = `<${tag}>`
  let inner = false
  let first = true
  for (const l of lines) {
    if (!l.text) continue
    const lvl = first ? 0 : l.level
    first = false
    if (lvl === 1 && !inner) {
      out = out.replace(/<\/li>$/, '') + `<${tag}>`
      inner = true
    } else if (lvl === 0 && inner) {
      out += `</${tag}></li>`
      inner = false
    }
    out += `<li>${wrapText(w, l.text)}</li>`
  }
  if (inner) out += `</${tag}></li>`
  return `${out}</${tag}>`
}

function buildHtml(lines, w, { asList = false, ordered = false, allowList = true } = {}) {
  if (!lines.length) return ''
  if (asList) return buildItems(lines, w, ordered ? 'ol' : 'ul')
  let html = ''
  let run = []
  const flush = () => {
    if (run.length) html += buildItems(run, w, run[0].ordered ? 'ol' : 'ul')
    run = []
  }
  for (const l of lines) {
    if (l.list && allowList) {
      if (run.length && run[0].ordered !== l.ordered) flush()
      run.push(l)
    } else {
      flush()
      html += `<p>${l.text ? wrapText(w, l.text) : '<br>'}</p>`
    }
  }
  flush()
  return html
}

/** 줄 수가 같으면 바뀐 줄만 고친다(안에 섞인 굵게·색·링크가 남는다). 맞지 않으면 null */
function blockwise(old, lines) {
  if (/<li\b[^>]*>(?:(?!<\/li>)[\s\S])*<(ul|ol)\b/i.test(old)) return null
  const blocks = [...old.matchAll(/<(p|li|div)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
  if (!blocks.length) return null
  let n = blocks.length
  const plain = (b) => stripTags(b[2].replace(/<br\s*\/?>/gi, '')).trim()
  while (n > 0 && !plain(blocks[n - 1])) n--
  if (n !== lines.length) return null
  for (let i = 0; i < n; i++) {
    const inner = blocks[i][2]
    if (/<br\b/i.test(inner) && plain(blocks[i])) return null
    if ((blocks[i][1].toLowerCase() === 'li') !== lines[i].list) return null
    if (/<(p|div|ul|ol)\b/i.test(inner)) return null
  }
  let k = 0
  let changed = false
  const html = old.replace(/<(p|li|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (all, tag, attrs, inner) => {
    const i = k++
    if (i >= n) return all
    const want = lines[i].text
    if (plain(blocks[i]) === want) return all
    changed = true
    const body = /<[a-z]/i.test(inner) ? wrapText(firstRunWrap(inner), want) : escapeHtml(want)
    return `<${tag}${attrs}>${body || '<br>'}</${tag}>`
  })
  return changed ? html : old
}

/**
 * 글 상자 HTML 을 새 글로 바꾼다.
 * replace: 줄 수가 같으면 바뀐 줄만, 아니면 처음 글자의 서식을 입혀 새로 만든다. append: 뒤에 덧붙인다.
 * allowList=false 면 "- " 를 목록으로 만들지 않고 문단으로 둔다(제목·부제목 등).
 */
export function retextHtml(oldHtml, newText, mode = 'replace', { allowList = true } = {}) {
  const old = String(oldHtml || '')
  const lines = parseNewLines(newText)
  const oldEmpty = !htmlLines(old).some((l) => l.text.trim())
  const isList = /<(ul|ol)\b/i.test(old)
  const ordered = /<ol\b/i.test(old) && !/<ul\b/i.test(old)
  const w = firstRunWrap(old)
  if (mode === 'append' && !oldEmpty) {
    if (!lines.length) return old
    if (isList && allowList) {
      const tag = ordered ? 'ol' : 'ul'
      const at = old.toLowerCase().lastIndexOf(`</${tag}>`)
      if (at >= 0) {
        const added = buildItems(lines, w, tag).slice(`<${tag}>`.length, -`</${tag}>`.length)
        return old.slice(0, at) + added + old.slice(at)
      }
    }
    return old + buildHtml(lines, w, { allowList, asList: false })
  }
  if (!oldEmpty) {
    const bw = blockwise(old, lines)
    if (bw !== null) return bw
  }
  const asList = allowList && (isList || (lines.length > 0 && lines.every((l) => l.list)))
  return buildHtml(lines, w, { asList, ordered: asList && (ordered || (!isList && lines[0]?.ordered)), allowList })
}

// ── 발표 읽기(작게) ──────────────────────────────────────
const TITLE_ROLES = ['title', 'quote', 'number']
const LIST_ROLES = new Set(['body', 'col1', 'col2', undefined, ''])
const TEXT_ROLES = ['title', 'subtitle', 'body', 'col1', 'col2', 'number', 'quote', 'caption']

const clip = (s, n) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export function slideTitle(slide) {
  const els = (slide?.elements || []).filter((e) => e.type === 'text' && !e.hidden)
  for (const r of TITLE_ROLES) {
    const e = els.find((x) => x.role === r)
    if (e) {
      const t = htmlToText(e.data?.html).replace(/\s+/g, ' ').trim()
      if (t) return t
    }
  }
  const first = [...els].sort((a, b) => a.y - b.y || a.x - b.x).find((e) => htmlToText(e.data?.html).trim())
  return first ? htmlToText(first.data.html).replace(/\s+/g, ' ').trim() : ''
}

export function briefText(el, max = 300) {
  return clip(htmlToText(el.data?.html).replace(/\n/g, ' / '), max)
}

export function elementLabel(e) {
  const kind = { text: '글', shape: '도형', image: '이미지', table: '표', embed: '링크 카드' }[e.type] || e.type
  return `${e.id} (${kind}${e.role && e.role !== 'deco' ? `, ${e.role}` : ''})`
}

const box = (e) => [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)]

function elementDetail(e, textMax) {
  const base = { id: e.id, type: e.type, ...(e.role && { role: e.role }), box: box(e), ...(e.locked && { locked: true }), ...(e.hidden && { hidden: true }) }
  if (e.type === 'text') {
    const est = estimateText(e)
    return { ...base, text: clip(htmlToText(e.data?.html), textMax), size: e.style?.size, pt: ptOf(e.style?.size), lines: est.lines, ...(est.overflow && { overflow: true, fit_pt: ptOf(est.fit_size) }) }
  }
  if (e.type === 'table') return { ...base, pt: ptOf(e.style?.size), rows: (e.data?.rows || []).slice(0, 12).map((r) => r.map((c) => clip(c, 40))) }
  if (e.type === 'image') return { ...base, alt: clip(e.data?.alt, 80), hasImage: Boolean(e.data?.src) }
  if (e.type === 'table') return { ...base, rows: (e.data?.rows || []).slice(0, 12).map((r) => r.map((c) => clip(c, 40))) }
  if (e.type === 'embed') return { ...base, url: clip(e.data?.url, 120), title: clip(e.data?.title, 80) }
  if (e.type === 'shape') return { ...base, shape: e.data?.shape }
  return base
}

/** 한 장의 자세한 모습(요소 id·종류·자리 포함) */
export function compactSlide(slide, n, { textMax = 600, notesMax = 1500 } = {}) {
  const els = [...(slide.elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0))
  const shown = els.filter((e) => e.role !== 'deco')
  return {
    n,
    layout: slide.layout,
    variant: slide.variant || 0,
    ...(slide.hidden && { hidden: true }),
    title: slideTitle(slide),
    elements: shown.map((e) => elementDetail(e, textMax)),
    notes: clip(slide.notes, notesMax),
  }
}

/** 전체 훑어보기(요소 id 없이 제목·본문 줄만). 슬라이드가 많으면 줄여서 크기 제한 안에 맞춘다 */
export function briefSlide(slide, n, { lines = 8, lineMax = 110 } = {}) {
  const texts = (slide.elements || [])
    .filter((e) => e.type === 'text' && e.role !== 'deco' && !e.hidden)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const title = slideTitle(slide)
  const body = []
  for (const e of texts) {
    for (const l of htmlToText(e.data?.html).split('\n')) {
      const t = l.trim()
      if (t && t.replace(/^-\s*/, '') !== title) body.push(clip(l.replace(/\s+$/, ''), lineMax))
    }
  }
  const notes = String(slide.notes || '').trim()
  return {
    n,
    layout: slide.layout,
    variant: slide.variant || 0,
    ...(slide.hidden && { hidden: true }),
    title,
    text: body.slice(0, lines),
    ...(body.length > lines && { moreLines: body.length - lines }),
    ...(notes && { notes: clip(notes.replace(/\s+/g, ' '), 80), notesChars: notes.length }),
    ...(texts.length < (slide.elements || []).filter((e) => e.role !== 'deco').length && { hasNonText: true }),
  }
}

export function compactDeck(deck, slides) {
  const total = deck.slides.length
  const head = { total, theme: { id: deck.theme?.id, name: deck.theme?.name }, layouts: LAYOUTS.map((l) => l.id) }
  if (Array.isArray(slides) && slides.length) {
    const nums = [...new Set(slides.map((x) => Math.trunc(Number(x))).filter((x) => x >= 1 && x <= total))].slice(0, 12)
    const out = []
    let size = 0
    for (const n of nums) {
      const c = compactSlide(deck.slides[n - 1], n)
      size += JSON.stringify(c).length
      if (size > READ_CAP && out.length) return { ...head, slides: out, truncated: `크기 제한으로 ${n}번부터 생략. 나눠서 다시 읽어 주세요.` }
      out.push(c)
    }
    return { ...head, slides: out }
  }
  for (const [lines, lineMax] of [[8, 110], [4, 80], [2, 60], [0, 40]]) {
    const out = deck.slides.map((s, i) => briefSlide(s, i + 1, { lines, lineMax }))
    if (JSON.stringify(out).length <= READ_CAP) return { ...head, slides: out, hint: '요소 id 와 자리는 read_slide 또는 read_deck({slides:[번호]})로 읽는다.' }
  }
  const out = deck.slides.slice(0, 120).map((s, i) => ({ n: i + 1, layout: s.layout, title: clip(slideTitle(s), 40) }))
  return { ...head, slides: out, truncated: '슬라이드가 많아 제목만 보냈다. 번호를 골라 다시 읽어 주세요.' }
}

// ── 검사 도우미 ──────────────────────────────────────────
function slideNo(deck, v, label = '슬라이드') {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v
  const total = deck.slides.length
  if (!Number.isInteger(n) || n < 1 || n > total) fail(total ? `${label} 번호는 1부터 ${total} 사이의 정수여야 합니다` : '슬라이드가 없습니다. add_slide 나 create_deck_from_outline 으로 먼저 만들어 주세요')
  return n - 1
}

function pickStr(v, name, max, { required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) fail(`${name} 이(가) 필요합니다`)
    return undefined
  }
  if (typeof v !== 'string') fail(`${name} 은(는) 글이어야 합니다`)
  if (v.length > max) fail(`${name} 이(가) 너무 깁니다(${max}자까지)`)
  return v
}

function strList(v, name, maxItems = 20, maxLen = 400) {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') v = v.split(/\r?\n/)
  if (!Array.isArray(v)) fail(`${name} 은(는) 글 목록이어야 합니다`)
  return v.slice(0, maxItems).map((x) => {
    if (typeof x !== 'string') fail(`${name} 의 항목은 글이어야 합니다`)
    return x.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').slice(0, maxLen).trim()
  }).filter(Boolean)
}

/** 요소 찾기: id, 역할 이름, 없으면 선택한 글 상자, 아니면 본문 */
function resolveEl(slide, ref, sel = []) {
  const els = slide.elements || []
  const texts = els.filter((e) => e.type === 'text' && e.role !== 'deco')
  const list = () => texts.map((e) => `${e.id}${e.role ? `(${e.role})` : ''}`).join(', ') || '글 상자가 없습니다'
  let el = null
  if (ref === undefined || ref === null || ref === '') {
    el = texts.find((e) => sel.includes(e.id)) || TEXT_ROLES.map((r) => texts.find((e) => e.role === r && r !== 'title')).find(Boolean) || (texts.length === 1 ? texts[0] : null)
    if (!el) fail(`element 를 정해 주세요. 이 슬라이드의 글 상자: ${list()}`)
  } else {
    if (typeof ref !== 'string') fail('element 는 요소 id 또는 역할 이름(글)이어야 합니다')
    el = els.find((e) => e.id === ref && e.role !== 'deco') || texts.find((e) => e.role === ref)
    if (!el) fail(`요소 "${clip(ref, 30)}" 을(를) 이 슬라이드에서 찾지 못했습니다. 글 상자: ${list()}`)
  }
  if (el.type !== 'text') fail(`요소 ${el.id} 은(는) 글 상자가 아니라 편집할 수 없습니다`)
  if (el.locked) fail(`요소 ${el.id} 은(는) 잠겨 있어 고칠 수 없습니다`)
  return el
}

const replaceSlide = (deck, i, next) => ({ ...deck, slides: deck.slides.map((s, k) => (k === i ? next : s)) })
const mapEl = (slide, id, fn) => ({ ...slide, elements: slide.elements.map((e) => (e.id === id ? fn(e) : e)) })

function newTextHtml(el, text, mode, clean) {
  const allowList = LIST_ROLES.has(el.role)
  return clean(retextHtml(el.data?.html || '', text, mode, { allowList }))
}

// ── 바꾸는 일(순수) ──────────────────────────────────────
// 모두 (deck, args, ctx) => { deck, cur?, summary, result } 또는 { noop:true, summary, result }
// ctx = { cur(0부터), sel: [요소 id], clean(html) }
const identity = (x) => x

export function opEditText(deck, args, ctx = {}) {
  const clean = ctx.clean || identity
  const i = slideNo(deck, args?.slide)
  const text = pickStr(args?.text, 'text', MAX_TEXT, { required: true })
  const mode = args?.mode === undefined ? 'replace' : args.mode
  if (mode !== 'replace' && mode !== 'append') fail('mode 는 replace 또는 append 여야 합니다')
  const el = resolveEl(deck.slides[i], args?.element, ctx.sel || [])
  const html = newTextHtml(el, text, mode, clean)
  if (html === (el.data?.html || '')) return { noop: true, summary: '바뀐 것이 없습니다', result: { changed: 0 } }
  const next = replaceSlide(deck, i, mapEl(deck.slides[i], el.id, (e) => ({ ...e, data: { ...e.data, html } })))
  return { deck: next, cur: i, summary: `${i + 1}번 슬라이드 글을 ${mode === 'append' ? '덧붙였습니다' : '고쳤습니다'}`, result: { changed: 1, slide: i + 1, element: el.id, now: clip(htmlToText(html), 300) } }
}

export function opFixTypos(deck, args, ctx = {}) {
  const clean = ctx.clean || identity
  const fixes = args?.fixes
  if (!Array.isArray(fixes) || !fixes.length) fail('fixes 에 고칠 글 상자를 하나 이상 넣어 주세요')
  if (fixes.length > MAX_FIXES) fail(`한 번에 ${MAX_FIXES}곳까지 고칠 수 있습니다`)
  let slides = deck.slides
  let changed = 0
  const skipped = []
  const touched = new Set()
  for (const f of fixes) {
    try {
      const cur = { ...deck, slides }
      const i = slideNo(cur, f?.slide)
      const text = pickStr(f?.text, 'text', MAX_TEXT, { required: true })
      const el = resolveEl(slides[i], f?.element, [])
      const html = newTextHtml(el, text, 'replace', clean)
      if (html === (el.data?.html || '')) continue
      slides = slides.map((s, k) => (k === i ? mapEl(s, el.id, (e) => ({ ...e, data: { ...e.data, html } })) : s))
      changed++
      touched.add(i + 1)
    } catch (e) {
      if (!(e instanceof ToolError)) throw e
      skipped.push(`${f?.slide ?? '?'}번 ${clip(String(f?.element ?? ''), 20)}: ${e.message}`)
    }
  }
  if (!changed) return { noop: true, summary: skipped.length ? `고치지 못했습니다: ${skipped[0]}` : '고칠 곳이 없습니다', result: { changed: 0, skipped: skipped.slice(0, 8) } }
  return { deck: { ...deck, slides }, summary: `맞춤법 ${changed}곳을 고쳤습니다`, result: { changed, slides: [...touched].sort((a, b) => a - b), ...(skipped.length && { skipped: skipped.slice(0, 8) }) } }
}

export function opSetNotes(deck, args) {
  const i = slideNo(deck, args?.slide)
  const text = pickStr(args?.text, 'text', MAX_NOTES, { required: true })
  const mode = args?.mode === undefined ? 'replace' : args.mode
  if (mode !== 'replace' && mode !== 'append') fail('mode 는 replace 또는 append 여야 합니다')
  const oldNotes = String(deck.slides[i].notes || '')
  const notes = (mode === 'append' && oldNotes.trim() ? `${oldNotes.replace(/\s+$/, '')}\n${text}` : text).slice(0, MAX_NOTES)
  if (notes === oldNotes) return { noop: true, summary: '바뀐 것이 없습니다', result: { changed: 0 } }
  return { deck: replaceSlide(deck, i, { ...deck.slides[i], notes }), cur: i, summary: `${i + 1}번 슬라이드 발표자 노트를 ${oldNotes.trim() && mode === 'replace' ? '바꿨습니다' : '썼습니다'}`, result: { changed: 1, slide: i + 1, chars: notes.length } }
}

const para = (lines) => lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')
const bullets = (lines) => (lines.length > 1 ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : para(lines))

/** 레이아웃별로 모델이 준 글을 역할(title, body ...)에 나눠 담는다 */
export function slideContent(layout, a) {
  const title = pickStr(a.title, 'title', 400)?.trim()
  const subtitle = pickStr(a.subtitle, 'subtitle', 400)?.trim()
  const body = strList(a.body, 'body')
  const left = strList(a.left, 'left')
  const right = strList(a.right, 'right')
  const number = pickStr(a.number, 'number', 40)?.trim()
  const caption = pickStr(a.caption, 'caption', 600)?.trim()
  const quote = pickStr(a.quote, 'quote', 800)?.trim()
  const notes = pickStr(a.notes, 'notes', MAX_NOTES)
  const out = { notes: notes || '' }
  const one = (arr) => (arr && arr.length ? para([arr.join(' ')]) : '')
  switch (layout) {
    case 'title':
    case 'section':
      if (title) out.title = para([title])
      if (subtitle || body?.length) out.subtitle = subtitle ? para([subtitle]) : para(body)
      break
    case 'title-body':
      if (title) out.title = para([title])
      if (body?.length) out.body = bullets(body)
      break
    case 'two-col':
      if (title) out.title = para([title])
      if ((left || body)?.length) out.col1 = bullets(left || body)
      if (right?.length) out.col2 = bullets(right)
      break
    case 'image-text': {
      if (title) out.title = para([title])
      if (body?.length) out.body = bullets(body)
      const src = pickStr(a.image_url, 'image_url', 2000)
      if (src) {
        const safe = /^https?:\/\//i.test(src.trim()) ? sanitizeImageSrc(src.trim()) : ''
        if (!safe) fail('image_url 은 http 또는 https 주소여야 합니다')
        out.image = safe
      }
      break
    }
    case 'big-number':
      if (title) out.title = para([title])
      if (number) out.number = para([number])
      if (caption || body?.length) out.caption = caption ? para([caption]) : one(body)
      break
    case 'quote':
      if (quote || title) out.quote = para([quote || title])
      if (caption || body?.length) out.caption = caption ? para([caption]) : para([body[0]])
      break
    default:
      break
  }
  return out
}

export function opAddSlide(deck, args) {
  const a = args || {}
  const layout = typeof a.layout === 'string' && LAYOUTS.some((l) => l.id === a.layout) ? a.layout : a.layout === undefined ? 'title-body' : fail(`layout 은 ${LAYOUTS.map((l) => l.id).join(', ')} 중 하나여야 합니다`)
  if (deck.slides.length >= MAX_SLIDES) fail(`슬라이드는 ${MAX_SLIDES}장까지 만들 수 있습니다`)
  const L = layoutById(layout)
  let variant = 0
  if (a.variant !== undefined) {
    if (!Number.isInteger(a.variant) || a.variant < 0 || a.variant >= L.variants.length) fail(`${layout} 의 variant 는 0부터 ${L.variants.length - 1} 사이여야 합니다`)
    variant = a.variant
  }
  const total = deck.slides.length
  let at = total
  if (a.after !== undefined && a.after !== null) {
    if (!Number.isInteger(a.after) || a.after < 0 || a.after > total) fail(`after 는 0부터 ${total} 사이(0은 맨 앞)여야 합니다`)
    at = a.after
  }
  const slide = makeSlide(layout, slideContent(layout, a), variant)
  const slides = deck.slides.slice()
  slides.splice(at, 0, slide)
  return { deck: { ...deck, slides }, cur: at, summary: `${at + 1}번 자리에 ${L.name} 슬라이드를 더했습니다`, result: { added: at + 1, layout, total: slides.length } }
}

export function opDeleteSlide(deck, args) {
  const i = slideNo(deck, args?.slide)
  const title = slideTitle(deck.slides[i])
  const slides = deck.slides.filter((_, k) => k !== i)
  return { deck: { ...deck, slides }, cur: Math.max(0, Math.min(i, slides.length - 1)), summary: `${i + 1}번 슬라이드${title ? ` "${clip(title, 20)}"` : ''}를 지웠습니다`, result: { deleted: i + 1, title: clip(title, 60), total: slides.length } }
}

export function opMoveSlide(deck, args) {
  const from = slideNo(deck, args?.slide)
  const to = slideNo(deck, args?.to, '이동할 자리의')
  if (from === to) return { noop: true, summary: '이미 그 자리입니다', result: { changed: 0 } }
  const slides = deck.slides.slice()
  const [s] = slides.splice(from, 1)
  slides.splice(to, 0, s)
  return { deck: { ...deck, slides }, cur: to, summary: `${from + 1}번 슬라이드를 ${to + 1}번 자리로 옮겼습니다`, result: { from: from + 1, to: to + 1 } }
}

/** 이미지 칸의 주소를 다시 거른다(개요 해석기가 http/https 만 통과시키지만 한 번 더) */
function safeImages(slide) {
  return { ...slide, elements: slide.elements.map((e) => (e.type === 'image' && e.data?.src ? { ...e, data: { ...e.data, src: sanitizeImageSrc(e.data.src) } } : e)) }
}

export function opOutline(deck, args) {
  const outline = pickStr(args?.outline, 'outline', MAX_OUTLINE, { required: true })
  if (!outline.trim()) fail('outline 이 비어 있습니다')
  const mode = args?.mode === undefined ? 'append' : args.mode
  if (mode !== 'append' && mode !== 'replace') fail('mode 는 append 또는 replace 여야 합니다')
  let theme = deck.theme
  if (args?.theme !== undefined && args.theme !== null && args.theme !== '') {
    if (typeof args.theme !== 'string' || !THEMES.some((t) => t.id === args.theme)) fail(`theme 은 ${THEMES.map((t) => t.id).join(', ')} 중 하나여야 합니다`)
    theme = args.theme === deck.theme?.id ? deck.theme : themeCopy(args.theme)
  }
  const made = outlineToSlides(outline).map(safeImages)
  if (made.length > MAX_OUTLINE_SLIDES) fail(`한 번에 ${MAX_OUTLINE_SLIDES}장까지 만들 수 있습니다(지금 ${made.length}장). 나눠서 만들어 주세요`)
  const base = mode === 'replace' ? [] : deck.slides
  if (base.length + made.length > MAX_SLIDES) fail(`슬라이드는 ${MAX_SLIDES}장까지 만들 수 있습니다`)
  const slides = [...base, ...made]
  return { deck: { ...deck, theme, slides }, cur: base.length, summary: `${mode === 'replace' ? '전체를 바꿔' : '뒤에 더해'} 슬라이드 ${made.length}장을 만들었습니다`, result: { created: made.length, mode, total: slides.length, firstNew: base.length + 1 } }
}

export function opRestyle(deck, args, ctx = {}) {
  const a = args || {}
  let next = deck
  const parts = []
  if (a.theme !== undefined && a.theme !== null && a.theme !== '') {
    if (typeof a.theme !== 'string' || !THEMES.some((t) => t.id === a.theme)) fail(`theme 은 ${THEMES.map((t) => t.id).join(', ')} 중 하나여야 합니다`)
    if (a.theme !== deck.theme?.id || themeById(a.theme).colors.accent !== deck.theme?.colors?.accent) {
      next = { ...next, theme: themeCopy(a.theme) }
      parts.push(`테마를 ${themeById(a.theme).name}(으)로 바꿨습니다`)
    }
  }
  const wantsLayout = a.layout !== undefined || a.variant !== undefined
  let cur = ctx.cur ?? 0
  if (wantsLayout) {
    if (a.layout !== undefined && !LAYOUTS.some((l) => l.id === a.layout)) fail(`layout 은 ${LAYOUTS.map((l) => l.id).join(', ')} 중 하나여야 합니다`)
    if (a.variant !== undefined && (!Number.isInteger(a.variant) || a.variant < 0 || a.variant > 9)) fail('variant 는 0 이상의 정수여야 합니다')
    let idx
    if (a.all_slides === true) idx = next.slides.map((_, k) => k)
    else {
      const i = a.slide === undefined ? Math.min(ctx.cur ?? 0, next.slides.length - 1) : slideNo(next, a.slide)
      if (i < 0) fail('슬라이드가 없습니다')
      idx = [i]
      cur = i
    }
    let n = 0
    const slides = next.slides.map((s, k) => {
      if (!idx.includes(k)) return s
      const layout = a.layout || s.layout
      const L = layoutById(layout)
      const variant = a.variant !== undefined ? a.variant % L.variants.length : layout === s.layout ? s.variant || 0 : 0
      if (layout === s.layout && variant === (s.variant || 0)) return s
      n++
      return applyLayout(s, layout, variant)
    })
    if (n) {
      next = { ...next, slides }
      parts.push(`${n}장의 레이아웃을 바꿨습니다`)
    }
  }
  if (!parts.length) return { noop: true, summary: '바뀐 것이 없습니다', result: { changed: 0 } }
  return { deck: next, cur, summary: parts.join(', '), result: { changed: parts } }
}

// ── 도구 묶음 ────────────────────────────────────────────
const LAYOUT_HELP = LAYOUTS.map((l) => `${l.id}(${l.name}, 변형 0~${l.variants.length - 1}${Object.keys(l.ph).length ? `, 칸: ${Object.keys(l.ph).join('/')}` : ''})`).join('; ')
const THEME_IDS = THEMES.map((t) => t.id)
const THEME_HELP = THEMES.map((t) => `${t.id}(${t.name})`).join(', ')

const S = (extra = {}) => ({ type: 'integer', minimum: 1, description: '슬라이드 번호(1부터)', ...extra })

/**
 * host:
 *   getDeck(), getCur()(0부터), getSel()(요소 id 배열), canEdit()
 *   apply(nextDeck, { cur }) -> { before, after } | null   // finishEdit + commit(한 번 기록) + 이동. 바뀐 게 없으면 null
 *   revert({ before, after }) -> void                      // 마지막이 그 변경이면 편집기 실행취소, 아니면 안내
 *   clean?(html)                                            // 기본 sanitizeRich
 */
export function createSlideTools(host) {
  const clean = host.clean || sanitizeRich
  const ctx = () => ({ cur: host.getCur(), sel: host.getSel(), clean })
  const readOnlyErr = () => ({ result: { ok: false, error: '보기 전용이라 고칠 수 없습니다' }, summary: '보기 전용이라 고칠 수 없습니다' })

  const mutating = (op) => async (args) => {
    try {
      if (!host.canEdit()) return readOnlyErr()
      const r = op(host.getDeck(), args && typeof args === 'object' ? args : {}, ctx())
      if (r.noop) return { result: { ok: true, ...r.result }, summary: r.summary }
      const h = host.apply(r.deck, { cur: r.cur })
      if (!h) return { result: { ok: true, changed: 0 }, summary: '바뀐 것이 없습니다' }
      return { result: { ok: true, ...r.result }, summary: r.summary, undo: () => host.revert(h) }
    } catch (e) {
      if (e instanceof ToolError) return { result: { ok: false, error: e.message }, summary: `할 수 없었습니다: ${e.message}` }
      return { result: { ok: false, error: '도구를 실행하지 못했습니다' }, summary: '도구를 실행하지 못했습니다' }
    }
  }
  const reading = (fn) => async (args) => {
    try {
      return { result: fn(host.getDeck(), args && typeof args === 'object' ? args : {}), summary: '' }
    } catch (e) {
      if (e instanceof ToolError) return { result: { ok: false, error: e.message }, summary: `읽지 못했습니다: ${e.message}` }
      return { result: { ok: false, error: '도구를 실행하지 못했습니다' }, summary: '도구를 실행하지 못했습니다' }
    }
  }

  const reading0 = reading
  return [
    {
      name: 'read_deck',
      description: '발표 전체를 읽는다. slides 를 생략하면 모든 슬라이드의 번호, 레이아웃, 제목, 본문 줄, 발표자 노트 앞부분을 훑어 준다. slides 에 번호를 주면 그 슬라이드(최대 12장)의 요소 id, 종류, 역할, 자리, 글 전체와 노트를 자세히 준다. 글 요소마다 box [x,y,w,h](슬라이드 1920x1080px), size(px)와 pt(=px/2), 추정 줄 수 lines, 넘치면 overflow=true 와 fit_pt 를 준다. 전체 훑어보기는 26000자 예산이라 많으면 줄여서 준다. 슬라이드 번호는 1부터.',
      parameters: { type: 'object', properties: { slides: { type: 'array', items: S(), maxItems: 12, description: '자세히 볼 슬라이드 번호들(생략하면 전체 훑어보기)' } } },
      run: reading((deck, a) => {
        if (!deck.slides.length) return { total: 0, slides: [], hint: '슬라이드가 없다' }
        if (a.slides !== undefined && !Array.isArray(a.slides)) fail('slides 는 번호 목록이어야 합니다')
        return compactDeck(deck, a.slides)
      }),
    },
    {
      name: 'read_slide',
      description: '슬라이드 한 장을 자세히 읽는다: 레이아웃, 변형, 요소 id·종류·역할·자리·글 전체, 발표자 노트 전체.',
      parameters: { type: 'object', properties: { index: S({ description: '읽을 슬라이드 번호(1부터)' }) }, required: ['index'] },
      run: reading((deck, a) => {
        const i = slideNo(deck, a.index)
        return { total: deck.slides.length, ...compactSlide(deck.slides[i], i + 1, { textMax: 3000, notesMax: 6000 }) }
      }),
    },
    {
      name: 'edit_slide_text',
      description: '글 상자 하나의 글을 바꾸거나 덧붙인다. element 는 요소 id 또는 역할(title, subtitle, body, col1, col2, number, quote, caption). 생략하면 선택한 글 상자나 본문. 줄마다 한 문단이고 목록은 줄 앞에 "- "를 붙인다. 글자 서식(굵게, 색 등)은 첫 글자 것을 이어받는다. HTML 을 쓰지 않는다.',
      parameters: {
        type: 'object',
        properties: {
          slide: S(),
          element: { type: 'string', description: '요소 id 또는 역할 이름' },
          text: { type: 'string', description: '새 글(줄바꿈으로 문단 나눔, 목록은 "- ")' },
          mode: { type: 'string', enum: ['replace', 'append'], description: 'replace(바꾸기, 기본) 또는 append(뒤에 덧붙이기)' },
        },
        required: ['slide', 'text'],
      },
      run: mutating(opEditText),
    },
    {
      name: 'set_notes',
      description: '슬라이드의 발표자 노트를 쓴다(기본은 바꾸기). 자세한 설명과 말할 내용을 여기에 넣는다.',
      parameters: {
        type: 'object',
        properties: { slide: S(), text: { type: 'string', description: '노트 글' }, mode: { type: 'string', enum: ['replace', 'append'] } },
        required: ['slide', 'text'],
      },
      run: mutating(opSetNotes),
    },
    {
      name: 'add_slide',
      description: `새 슬라이드를 레이아웃으로 만든다. 레이아웃: ${LAYOUT_HELP}. after 는 몇 번 슬라이드 뒤에 넣을지(0은 맨 앞, 생략하면 맨 뒤). 칸에 맞는 글만 넣는다: title/section 은 title+subtitle, title-body 는 title+body(목록), two-col 은 title+left+right, image-text 는 title+body+image_url, big-number 는 title+number+caption, quote 는 quote+caption.`,
      parameters: {
        type: 'object',
        properties: {
          after: { type: 'integer', minimum: 0, description: '이 번호 뒤에 넣는다(0은 맨 앞, 생략하면 맨 뒤)' },
          layout: { type: 'string', enum: LAYOUTS.map((l) => l.id) },
          variant: { type: 'integer', minimum: 0, description: '디자인 변형 번호(0부터, 생략하면 0)' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          body: { type: 'array', items: { type: 'string' }, description: '본문 줄들(3~5개 권장)' },
          left: { type: 'array', items: { type: 'string' }, description: 'two-col 왼쪽 줄들' },
          right: { type: 'array', items: { type: 'string' }, description: 'two-col 오른쪽 줄들' },
          number: { type: 'string', description: 'big-number 의 숫자(주어진 값만)' },
          caption: { type: 'string' },
          quote: { type: 'string' },
          image_url: { type: 'string', description: 'http 또는 https 이미지 주소' },
          notes: { type: 'string', description: '발표자 노트' },
        },
        required: ['layout'],
      },
      run: mutating(opAddSlide),
    },
    {
      name: 'delete_slide',
      description: '슬라이드 한 장을 지운다. 사용자가 분명히 요청했을 때만 쓴다. 화면에 되돌리기 버튼이 나온다.',
      parameters: { type: 'object', properties: { slide: S() }, required: ['slide'] },
      run: mutating(opDeleteSlide),
    },
    {
      name: 'move_slide',
      description: '슬라이드를 다른 자리로 옮긴다(번호는 1부터). 사용자가 요청했을 때만 쓴다.',
      parameters: { type: 'object', properties: { slide: S({ description: '옮길 슬라이드 번호' }), to: S({ description: '옮길 자리 번호' }) }, required: ['slide', 'to'] },
      run: mutating(opMoveSlide),
    },
    {
      name: 'create_deck_from_outline',
      description: '"글로 만들기"와 같은 해석기로 개요 글에서 슬라이드를 만든다. 규칙: 맨 앞 "# 제목"은 제목 슬라이드(다음 줄은 부제목), 이후 "# 제목"은 섹션 구분, "## 제목"은 새 슬라이드, "- 항목"은 목록, "> 인용"은 인용 슬라이드, 이미지 주소(http/https)는 이미지 슬라이드, "---"는 나누기, "노트: 내용"은 발표자 노트, 제목이 숫자뿐이면(예: ## 72%) 큰 숫자 슬라이드. 긴 목록은 자동으로 다음 장으로 나눈다. mode 가 replace 면 지금 슬라이드를 모두 대체한다(사용자가 요청할 때만).',
      parameters: {
        type: 'object',
        properties: {
          outline: { type: 'string', description: '개요 글(마크다운 비슷한 규칙)' },
          mode: { type: 'string', enum: ['append', 'replace'], description: 'append(뒤에 더하기, 기본) 또는 replace(전체 바꾸기)' },
          theme: { type: 'string', enum: THEME_IDS, description: `테마(${THEME_HELP}). 생략하면 지금 테마 유지` },
        },
        required: ['outline'],
      },
      run: mutating(opOutline),
    },
    {
      name: 'restyle',
      description: '테마나 레이아웃 변형을 바꾼다. theme 을 주면 발표 전체 테마가 바뀐다. layout/variant 는 slide 한 장(생략하면 지금 슬라이드)이나 all_slides=true 로 모든 장에 적용한다. 글 내용은 그대로 두고 자리와 모양만 바뀐다.',
      parameters: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: THEME_IDS, description: THEME_HELP },
          slide: S({ description: 'layout/variant 를 적용할 슬라이드 번호(생략하면 지금 슬라이드)' }),
          all_slides: { type: 'boolean', description: 'true 면 모든 슬라이드에 variant/layout 적용' },
          layout: { type: 'string', enum: LAYOUTS.map((l) => l.id) },
          variant: { type: 'integer', minimum: 0, description: '변형 번호(레이아웃마다 개수가 다르면 나머지로 맞춘다)' },
        },
      },
      run: mutating(opRestyle),
    },
    {
      name: 'fix_typos',
      description: '맞춤법·띄어쓰기·오타를 여러 글 상자에 한 번에 고친다(되돌리기 한 번). fixes 의 각 항목은 슬라이드 번호, 요소 id(또는 역할), 고친 글 상자의 글 전체. 줄 수와 순서는 그대로 두고 틀린 부분만 고친 글을 준다.',
      parameters: {
        type: 'object',
        properties: {
          fixes: {
            type: 'array',
            maxItems: MAX_FIXES,
            items: {
              type: 'object',
              properties: { slide: S(), element: { type: 'string', description: '요소 id 또는 역할' }, text: { type: 'string', description: '고친 글 전체' } },
              required: ['slide', 'element', 'text'],
            },
          },
        },
        required: ['fixes'],
      },
      run: mutating(opFixTypos),
    },
    ...createExtraSlideTools({ mutating, reading: reading0 }),
  ]
}
