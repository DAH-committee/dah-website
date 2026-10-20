// 슬라이드 AI 확장: 디자인 검사(check_deck), 자동 고침(fix_deck), 정렬(arrange_elements), 요소 추가, 배경, 전환, 글 모양.
// 모두 "발표 전체 객체 → 새 발표 객체" 순수 함수(op*)이고 createExtraSlideTools 가 Tool 로 묶는다.
// 모델 인자는 믿지 않는다: 숫자 범위, 색 형식, https 주소를 모두 검사한다.
import { SLIDE_H, SLIDE_W, imageEl, shapeEl, tableEl, resolveColor } from './deckCore.js'
import { alignEls, aabb, cloneSlide, distributeEls, intersects, maxZ, tidyEls } from './editorOps.js'
import { sanitizeImageSrc } from './sanitize.js'
import { contrast, estimateText, linesOfHtml, ptOf, slideBg, themeOf } from './slideMetrics.js'

export class ToolError extends Error {}
const fail = (msg) => {
  throw new ToolError(msg)
}
const clip = (s, n) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const TRANSITIONS = ['none', 'fade', 'slide', 'magic']
const TOKEN_RE = /^@(bg|text|accent|accent2|muted|surface)$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const TEXT_ROLES = ['title', 'subtitle', 'body', 'col1', 'col2', 'number', 'quote', 'caption']
const BODY_ROLES = new Set(['body', 'col1', 'col2', undefined, ''])
const SHAPES = ['rect', 'rounded', 'ellipse', 'triangle', 'arrow', 'line']
export const MAX_ISSUES = 80

function slideNo(deck, v, label = '슬라이드') {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v
  const total = deck.slides.length
  if (!Number.isInteger(n) || n < 1 || n > total) fail(total ? `${label} 번호는 1부터 ${total} 사이의 정수여야 합니다` : '슬라이드가 없습니다')
  return n - 1
}
const colorArg = (v, name) => {
  if (v === null) return null
  if (typeof v !== 'string') fail(`${name} 은(는) #RRGGBB 또는 @accent 같은 테마 색이어야 합니다`)
  const t = v.trim()
  if (TOKEN_RE.test(t)) return t
  if (HEX_RE.test(t)) return t.toUpperCase()
  fail(`${name} 은(는) #RRGGBB 또는 테마 색(@bg, @text, @accent, @accent2, @muted, @surface)이어야 합니다`)
  return null
}
const numArg = (v, name, lo, hi, d) => {
  if (v === undefined || v === null) return d
  const n = Number(v)
  if (!Number.isFinite(n) || n < lo || n > hi) fail(`${name} 은(는) ${lo}~${hi} 사이 숫자여야 합니다`)
  return Math.round(n)
}
const mapSlide = (deck, i, fn) => ({ ...deck, slides: deck.slides.map((s, k) => (k === i ? fn(s) : s)) })
const label = (e) => {
  const t = e.type === 'text' ? clip(linesOfHtml(e.data?.html).map((l) => l.text).join(' / '), 14) : ''
  return `${e.id}(${e.role && e.role !== 'deco' ? `${e.role} ` : ''}${e.type}${t ? ` "${t}"` : ''})`
}

// ───────────────────────── 검사 ─────────────────────────

/** 바탕 위에서 읽히는 글자색: 테마 글자색 > 흰색 > 거의 검정 순으로 4.5:1 을 넘는 것 */
export function readableColor(bg, theme) {
  const t = resolveColor('@text', theme)
  if ((contrast(t, bg) || 0) >= 4.5) return { token: '@text', hex: t }
  const w = contrast('#FFFFFF', bg) || 0
  const k = contrast('#111111', bg) || 0
  return w >= k ? { token: '#FFFFFF', hex: '#FFFFFF' } : { token: '#111111', hex: '#111111' }
}

function inlineColors(html) {
  const out = []
  for (const m of String(html || '').matchAll(/color\s*:\s*(#[0-9a-fA-F]{3,6})/g)) out.push(m[1])
  return out
}

/** 덱 전체를 검사한다. opts.slides: 검사할 슬라이드 번호들(1부터, 생략 시 전체) */
export function checkDeck(deck, opts = {}) {
  const theme = themeOf(deck)
  const issues = []
  const only = Array.isArray(opts.slides) && opts.slides.length ? new Set(opts.slides) : null
  const add = (rule, si, el, severity, message, fix, auto = false, extra = {}) =>
    issues.push({ id: `${rule}:${si + 1}:${el?.id || '-'}`, rule, slide: si + 1, ...(el && { element: el.id }), severity, message, fix, auto, ...extra })
  const byLayout = new Map()
  deck.slides.forEach((slide, si) => {
    const visible = (slide.elements || []).filter((e) => !e.hidden)
    const content = visible.filter((e) => e.role !== 'deco')
    const bg = slideBg(slide, theme)
    if (!only || only.has(si + 1)) {
      // 제목 없음
      const hasTitle = content.some((e) => e.type === 'text' && ['title', 'quote', 'number'].includes(e.role) && linesOfHtml(e.data?.html).length)
      const anyText = content.some((e) => e.type === 'text' && linesOfHtml(e.data?.html).length)
      if (!hasTitle && slide.layout !== 'blank') add('no_title', si, null, 'mid', `${si + 1}번 슬라이드에 제목이 없음${anyText ? '' : '(글도 없음)'}`, '제목을 edit_slide_text 로 채운다')
      for (const e of content) {
        const b = aabb(e)
        if (b.x < -1 || b.y < -1 || b.x + b.w > SLIDE_W + 1 || b.y + b.h > SLIDE_H + 1) add('out_of_bounds', si, e, 'high', `${label(e)} 이 슬라이드 밖으로 나감 (x ${Math.round(b.x)}, y ${Math.round(b.y)}, 끝 ${Math.round(b.x + b.w)}x${Math.round(b.y + b.h)}, 슬라이드 ${SLIDE_W}x${SLIDE_H})`, 'fix_deck 으로 안쪽으로 옮긴다', !e.locked)
        if (e.type === 'text') {
          const lines = linesOfHtml(e.data?.html)
          const role = e.role
          if (!lines.length) {
            if (TEXT_ROLES.includes(role)) add('empty_placeholder', si, e, 'mid', `${label(e)} 이 비어 있음(템플릿 자리 표시)`, '글을 채우거나 fix_deck 으로 지운다', !e.locked)
            continue
          }
          const size = Number(e.style?.size) || 36
          const est = estimateText(e)
          if (est.overflow) add('overflow', si, e, est.fits_at_fit ? 'mid' : 'high', `${label(e)} 글이 상자(높이 ${est.box_h}px)를 넘칠 것으로 추정(필요 ${est.need_h}px, ${est.lines}줄, 글자 ${ptOf(size)}pt)`, est.fits_at_fit ? `글자를 ${ptOf(est.fit_size)}pt 로 줄이면 들어감(fix_deck)` : '글을 줄이거나 상자를 키운다(fix_deck 은 상자를 아래로 늘림)', !e.locked, { fit_size_pt: ptOf(est.fit_size) })
          if (BODY_ROLES.has(role) && size < 36 && !est.overflow) add('small_text', si, e, 'mid', `${label(e)} 본문 글자가 ${ptOf(size)}pt 로 작음(권장 18pt 이상)`, '글을 줄이고 18pt 이상으로 키운다(edit_slide_text 후 style_text)', false)
          else if (size < 24) add('small_text', si, e, 'mid', `${label(e)} 글자가 ${ptOf(size)}pt 로 너무 작음(12pt 미만)`, 'style_text 로 키우거나 노트로 옮긴다')
          const listLines = lines.filter((l) => l.list).length
          if (listLines > 6) add('too_many_bullets', si, e, 'mid', `${label(e)} 목록 ${listLines}개(권장 6개 이하)`, '두 장으로 나누거나 항목을 합친다')
          // 대비
          const fill = e.style?.fill ? resolveColor(e.style.fill, theme) : null
          const base = fill && /^#/.test(fill) ? fill : bg
          const col = resolveColor(e.style?.color || '@text', theme)
          const large = size >= 48 || (e.style?.bold && size >= 38)
          const need = large ? 3 : 4.5
          const cr = contrast(col, base)
          if (cr !== null && cr < need) add('low_contrast', si, e, 'high', `${label(e)} 글자색 ${col} 와 바탕 ${base} 의 대비 ${cr.toFixed(1)}:1 (필요 ${need}:1)`, `글자색을 ${readableColor(base, theme).hex} 로 바꾼다(fix_deck)`, !e.locked, { ratio: Math.round(cr * 10) / 10 })
          else if (cr === null) { /* 알 수 없는 색 */ } else {
            for (const ic of inlineColors(e.data?.html)) {
              const r2 = contrast(ic.length === 4 ? `#${ic[1]}${ic[1]}${ic[2]}${ic[2]}${ic[3]}${ic[3]}` : ic, base)
              if (r2 !== null && r2 < need) { add('low_contrast', si, e, 'high', `${label(e)} 안의 글자색 ${ic} 대비 ${r2.toFixed(1)}:1 (필요 ${need}:1)`, '그 부분의 색을 지운다(fix_deck)', !e.locked, { inline: true }); break }
            }
          }
        } else if (e.type === 'image') {
          if (e.data?.src && !String(e.data?.alt || '').trim()) add('missing_alt', si, e, 'low', `${label(e)} 이미지에 대체 글이 없음`, '대체 글을 정해 알려 주고 사용자에게 이미지 설정에서 넣게 안내한다')
          if (!e.data?.src && ['image'].includes(e.role)) add('empty_placeholder', si, e, 'mid', `${label(e)} 이미지 자리가 비어 있음`, '이미지를 넣거나 fix_deck 으로 지운다', !e.locked)
        } else if (e.type === 'table') {
          const sz = Number(e.style?.size) || 24
          if (sz < 24) add('small_text', si, e, 'low', `${label(e)} 표 글자가 ${ptOf(sz)}pt 로 작음`, '표를 줄이거나 나눈다')
        }
      }
      // 겹침: 장식·도형 배경·묶음·잠금 제외
      const cand = content.filter((e) => e.type !== 'shape' && !e.locked)
      for (let a = 0; a < cand.length; a += 1) {
        for (let b = a + 1; b < cand.length; b += 1) {
          const A = cand[a]
          const B = cand[b]
          if (A.group && A.group === B.group) continue
          const ba = aabb(A)
          const bb = aabb(B)
          if (!intersects(ba, bb)) continue
          const ix = Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x)
          const iy = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y)
          const small = Math.min(ba.w * ba.h, bb.w * bb.h) || 1
          if ((ix * iy) / small > 0.15) add('overlap', si, A, 'mid', `${label(A)} 와 ${label(B)} 가 겹침(작은 쪽의 ${Math.round(((ix * iy) / small) * 100)}%)`, 'arrange_elements 로 정리하거나 한쪽을 옮긴다', false, { other: B.id })
        }
      }
    }
    const L = byLayout.get(slide.layout) || []
    L.push({ si, content })
    byLayout.set(slide.layout, L)
  })
  // 같은 레이아웃 사이 일관성: 제목·본문 글자 크기
  for (const [layout, list] of byLayout) {
    if (list.length < 3 || layout === 'blank') continue
    for (const role of ['title', 'body']) {
      const sizes = list.map(({ si, content }) => {
        const e = content.find((x) => x.type === 'text' && x.role === role && linesOfHtml(x.data?.html).length)
        return e ? { si, e, size: Number(e.style?.size) || 36 } : null
      }).filter(Boolean)
      if (sizes.length < 3) continue
      const freq = new Map()
      for (const s of sizes) freq.set(s.size, (freq.get(s.size) || 0) + 1)
      const [mode, cnt] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
      if (cnt < 2 || cnt === sizes.length) continue
      for (const s of sizes) {
        if (s.size === mode || (opts.slides && !opts.slides.includes(s.si + 1))) continue
        // 넘침 때문에 줄인 글자는 이미 overflow 로 다룬다
        if (issues.some((x) => x.element === s.e.id && x.rule === 'overflow')) continue
        issues.push({ id: `inconsistent_size:${s.si + 1}:${s.e.id}`, rule: 'inconsistent_size', slide: s.si + 1, element: s.e.id, severity: 'low', message: `${layout} 레이아웃 ${role} 글자가 ${s.si + 1}번만 ${ptOf(s.size)}pt (다른 ${cnt}장은 ${ptOf(mode)}pt)`, fix: `style_text 로 ${ptOf(mode)}pt 에 맞춘다`, auto: false })
      }
    }
  }
  const counts = {}
  for (const i of issues) counts[i.rule] = (counts[i.rule] || 0) + 1
  return { issues, counts }
}

// ───────────────────────── 자동 고침 ─────────────────────────

const AUTO_RULES = new Set(['overflow', 'out_of_bounds', 'low_contrast', 'empty_placeholder', 'small_text'])

export function opFixDeck(deck, args) {
  const want = args?.issues
  if (!Array.isArray(want) || !want.length) fail('issues 에 check_deck 이 준 id 목록이 필요합니다. 모두 고치려면 ["auto"] 를 주세요')
  const { issues } = checkDeck(deck)
  const all = want.length === 1 && want[0] === 'auto'
  const picked = all ? issues.filter((i) => i.auto) : issues.filter((i) => want.includes(i.id))
  const missing = all ? [] : want.filter((id) => !issues.some((i) => i.id === id))
  if (!picked.length) fail(missing.length ? `고칠 수 있는 항목이 없습니다. 이미 고쳐졌거나 id 가 바뀌었습니다. check_deck 을 다시 부르세요(없는 id: ${missing.slice(0, 3).join(', ')})` : '자동으로 고칠 항목이 없습니다')
  const theme = themeOf(deck)
  const applied = []
  const skipped = []
  let next = deck
  for (const is of picked.slice(0, 200)) {
    if (!AUTO_RULES.has(is.rule) || !is.auto) { skipped.push({ id: is.id, reason: '자동으로 고칠 수 없는 항목' }); continue }
    const si = is.slide - 1
    const s = next.slides[si]
    const e = s?.elements.find((x) => x.id === is.element)
    if (!e) { skipped.push({ id: is.id, reason: '요소를 찾지 못함' }); continue }
    let patch = null
    if (is.rule === 'overflow') {
      const est = estimateText(e)
      if (!est.overflow) continue
      if (est.fits_at_fit) patch = { style: { ...e.style, size: est.fit_size } }
      else {
        const room = Math.max(0, SLIDE_H - 20 - e.y)
        const h = Math.min(room, est.need_h)
        if (h <= e.h) { skipped.push({ id: is.id, reason: '글을 줄여야 함' }); continue }
        patch = { h, style: { ...e.style, size: est.fit_size } }
        if (estimateText({ ...e, ...patch }).overflow) skipped.push({ id: is.id, reason: '상자를 키워도 모자라 글을 줄여야 함', partial: true })
      }
    } else if (is.rule === 'out_of_bounds') {
      const w = Math.min(e.w, SLIDE_W - 40)
      const h = Math.min(e.h, SLIDE_H - 40)
      const b = aabb({ ...e, w, h })
      const dx = b.x < 0 ? -b.x : b.x + b.w > SLIDE_W ? SLIDE_W - (b.x + b.w) : 0
      const dy = b.y < 0 ? -b.y : b.y + b.h > SLIDE_H ? SLIDE_H - (b.y + b.h) : 0
      patch = { x: Math.round(e.x + dx), y: Math.round(e.y + dy), w, h }
    } else if (is.rule === 'low_contrast') {
      if (is.inline) patch = { data: { ...e.data, html: String(e.data?.html || '').replace(/;?\s*color\s*:\s*#[0-9a-fA-F]{3,6}\s*;?/g, ';') } }
      else {
        const bg = e.style?.fill ? resolveColor(e.style.fill, theme) : slideBg(s, theme)
        patch = { style: { ...e.style, color: readableColor(bg, theme).token } }
      }
    } else if (is.rule === 'empty_placeholder') {
      next = mapSlide(next, si, (sl) => ({ ...sl, elements: sl.elements.filter((x) => x.id !== e.id) }))
      applied.push(is.id)
      continue
    } else if (is.rule === 'small_text') {
      const big = { ...e, style: { ...e.style, size: 36 } }
      if (estimateText(big).overflow || e.type !== 'text' || !BODY_ROLES.has(e.role)) { skipped.push({ id: is.id, reason: '키우면 넘쳐서 글을 먼저 줄여야 함' }); continue }
      patch = { style: { ...e.style, size: 36 } }
    }
    if (patch) {
      next = mapSlide(next, si, (sl) => ({ ...sl, elements: sl.elements.map((x) => (x.id === e.id ? { ...x, ...patch } : x)) }))
      applied.push(is.id)
    }
  }
  if (!applied.length) return { noop: true, summary: '고친 것이 없습니다', result: { fixed: 0, skipped: skipped.slice(0, 10) } }
  return { deck: next, summary: `${applied.length}곳을 자동으로 고쳤습니다`, result: { fixed: applied.length, applied: applied.slice(0, 40), skipped: skipped.slice(0, 10), next: '고친 뒤 check_deck 으로 다시 검사해 남은 항목을 확인한다' } }
}

// ───────────────────────── 정렬·요소 ─────────────────────────

const ALIGN_OPS = { align_left: 'left', left: 'left', align_center_h: 'center', center_h: 'center', align_right: 'right', right: 'right', align_top: 'top', top: 'top', align_middle: 'middle', center_v: 'middle', align_bottom: 'bottom', bottom: 'bottom' }
export const ARRANGE_OPS = ['align_left', 'center_h', 'align_right', 'align_top', 'center_v', 'align_bottom', 'distribute_h', 'distribute_v', 'tidy', 'stack_row', 'stack_column']

export function opArrange(deck, args) {
  const i = slideNo(deck, args?.slide)
  const s = deck.slides[i]
  const ids = Array.isArray(args?.ids) ? args.ids.filter((x) => typeof x === 'string') : []
  if (!ids.length) fail('ids 에 요소 id 목록이 필요합니다(read_slide 에서 얻는다)')
  const have = new Set(s.elements.map((e) => e.id))
  const unknown = ids.filter((x) => !have.has(x))
  if (unknown.length) fail(`${i + 1}번 슬라이드에 없는 요소 id: ${unknown.slice(0, 4).join(', ')}. read_slide 로 id 를 다시 확인하세요`)
  const op = String(args?.op || '')
  const gap = args?.gap === undefined ? undefined : numArg(args.gap, 'gap', 0, 600, 24)
  let els = s.elements
  if (ALIGN_OPS[op]) els = alignEls(els, ids, ALIGN_OPS[op])
  else if (op === 'distribute_h' || op === 'distribute_v') {
    if (ids.length < (gap === undefined ? 3 : 2)) fail(gap === undefined ? '고르게 나누려면 요소가 3개 이상이어야 합니다. 2개면 gap 을 주세요' : '요소가 2개 이상이어야 합니다')
    els = distributeEls(els, ids, op === 'distribute_h' ? 'x' : 'y', gap)
  } else if (op === 'tidy') {
    if (ids.length < 2) fail('tidy 는 요소 2개 이상이 필요합니다')
    els = tidyEls(els, ids)
  } else if (op === 'stack_row') {
    if (ids.length < 2) fail('stack_row 는 요소 2개 이상이 필요합니다')
    els = distributeEls(alignEls(els, ids, 'top'), ids, 'x', gap ?? 24)
  } else if (op === 'stack_column') {
    if (ids.length < 2) fail('stack_column 은 요소 2개 이상이 필요합니다')
    els = distributeEls(alignEls(els, ids, 'left'), ids, 'y', gap ?? 24)
  } else fail(`op 는 ${ARRANGE_OPS.join(', ')} 중 하나여야 합니다`)
  const moved = els.filter((e, k) => e !== s.elements[k]).length
  if (!moved) return { noop: true, summary: '이미 정렬되어 있습니다', result: { moved: 0 } }
  const after = els.filter((e) => ids.includes(e.id)).map((e) => ({ id: e.id, box: [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)] }))
  return { deck: mapSlide(deck, i, (sl) => ({ ...sl, elements: els })), cur: i, summary: `요소 ${moved}개를 ${op} 로 정리했습니다`, result: { moved, boxes: after.slice(0, 20), note: ids.length === 1 && ALIGN_OPS[op] ? '요소 하나는 슬라이드 기준으로 맞춘다' : undefined } }
}

function boxArg(a, def) {
  const [dx, dy, dw, dh] = def
  const x = numArg(a.x, 'x', -SLIDE_W, SLIDE_W * 2, dx)
  const y = numArg(a.y, 'y', -SLIDE_H, SLIDE_H * 2, dy)
  const w = numArg(a.w, 'w', 8, SLIDE_W * 2, dw)
  const h = numArg(a.h, 'h', 8, SLIDE_H * 2, dh)
  return [x, y, w, h]
}
const place = (deck, i, el) => {
  const z = maxZ(deck.slides[i].elements) + 1
  const placed = { ...el, z }
  return { deck: mapSlide(deck, i, (s) => ({ ...s, elements: [...s.elements, placed] })), cur: i, id: placed.id }
}

export function opAddShape(deck, args) {
  const i = slideNo(deck, args?.slide)
  const shape = args?.shape === undefined ? 'rect' : args.shape
  if (!SHAPES.includes(shape)) fail(`shape 는 ${SHAPES.join(', ')} 중 하나여야 합니다`)
  const style = {}
  if (args.fill !== undefined) style.fill = colorArg(args.fill, 'fill')
  if (args.stroke !== undefined) { style.stroke = colorArg(args.stroke, 'stroke'); if (style.stroke) style.strokeWidth = numArg(args.stroke_width, 'stroke_width', 1, 40, 4) }
  const el = shapeEl(shape, boxArg(args, [160, 160, 400, 240]), style)
  const r = place(deck, i, el)
  return { deck: r.deck, cur: i, summary: `${i + 1}번 슬라이드에 도형을 넣었습니다`, result: { id: r.id, box: [el.x, el.y, el.w, el.h], hint: '글이 필요하면 add_slide 의 글 상자 위에 겹치지 말고 별도 텍스트로 둔다' } }
}

export function opAddImage(deck, args) {
  const i = slideNo(deck, args?.slide)
  const url = typeof args?.url === 'string' ? args.url.trim() : ''
  if (!/^https:\/\//i.test(url)) fail('url 은 https 로 시작하는 이미지 주소여야 합니다')
  const src = sanitizeImageSrc(url)
  if (!src) fail('이 이미지 주소는 쓸 수 없습니다')
  const alt = typeof args.alt === 'string' ? args.alt.slice(0, 200) : ''
  const el = imageEl(boxArg(args, [960, 200, 800, 600]), { src, alt })
  if (args.fit && ['cover', 'contain'].includes(args.fit)) el.style.fit = args.fit
  const r = place(deck, i, el)
  return { deck: r.deck, cur: i, summary: `${i + 1}번 슬라이드에 이미지를 넣었습니다`, result: { id: r.id, box: [el.x, el.y, el.w, el.h], note: alt ? undefined : 'alt(대체 글)를 주면 접근성이 좋아진다' } }
}

export function opAddTable(deck, args) {
  const i = slideNo(deck, args?.slide)
  if (!Array.isArray(args.rows) || !args.rows.length) fail('rows 는 문자열 2차원 배열이어야 합니다(첫 행은 머리글)')
  const rows = args.rows.slice(0, 20).map((r) => (Array.isArray(r) ? r.slice(0, 8).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c).slice(0, 200) : '')) : null))
  if (rows.some((r) => !r)) fail('rows 의 각 행은 문자열 배열이어야 합니다')
  const cols = Math.max(...rows.map((r) => r.length))
  const norm = rows.map((r) => Array.from({ length: cols }, (_, k) => r[k] || ''))
  const h = Math.min(800, norm.length * 80)
  const el = tableEl(norm, boxArg(args, [160, 260, 1600, h]))
  const r = place(deck, i, el)
  return { deck: r.deck, cur: i, summary: `${i + 1}번 슬라이드에 ${norm.length}x${cols} 표를 넣었습니다`, result: { id: r.id, rows: norm.length, cols, box: [el.x, el.y, el.w, el.h], note: '제목 슬라이드가 아닌 title-body 등 제목 칸이 있는 장에 넣고, 본문 칸이 비면 빈 칸은 check_deck 이 알려 준다' } }
}

export function opSetBackground(deck, args) {
  const all = args?.all_slides === true
  const idx = all ? deck.slides.map((_, k) => k) : [slideNo(deck, args?.slide)]
  let background
  if (args.image_url !== undefined) {
    const url = typeof args.image_url === 'string' ? args.image_url.trim() : ''
    if (!/^https:\/\//i.test(url) || !sanitizeImageSrc(url)) fail('image_url 은 https 이미지 주소여야 합니다')
    background = { image: sanitizeImageSrc(url), ...(args.color ? { color: colorArg(args.color, 'color') } : {}), ...(args.fit === 'contain' ? { fit: 'contain' } : {}) }
  } else if (args.color !== undefined) {
    const c = colorArg(args.color, 'color')
    background = c ? { color: c } : null
  } else fail('color(#RRGGBB 또는 @bg 같은 테마 색, null 이면 기본으로) 또는 image_url 이 필요합니다')
  const slides = deck.slides.map((s, k) => (idx.includes(k) ? { ...s, background } : s))
  const warn = background?.color && !all ? checkContrastNote(deck, slides[idx[0]]) : ''
  return { deck: { ...deck, slides }, cur: idx[0], summary: all ? '모든 슬라이드의 배경을 바꿨습니다' : `${idx[0] + 1}번 슬라이드의 배경을 바꿨습니다`, result: { changed: idx.length, note: warn || '배경을 바꾼 뒤 check_deck 으로 글자 대비를 확인한다' } }
}
function checkContrastNote(deck, slide) {
  const { issues } = checkDeck({ ...deck, slides: [slide] })
  const n = issues.filter((x) => x.rule === 'low_contrast').length
  return n ? `글자 대비가 낮은 요소 ${n}개: check_deck, fix_deck 으로 고친다` : ''
}

export function opDuplicateSlide(deck, args) {
  const i = slideNo(deck, args?.slide)
  if (deck.slides.length >= 300) fail('슬라이드는 300장까지 만들 수 있습니다')
  const copy = cloneSlide(deck.slides[i])
  const at = args.to === undefined ? i + 1 : slideNo(deck, args.to, '넣을 자리의') + (args.to > i + 1 ? 1 : 0)
  const slides = [...deck.slides]
  slides.splice(at, 0, copy)
  return { deck: { ...deck, slides }, cur: at, summary: `${i + 1}번 슬라이드를 복제했습니다`, result: { new_slide: at + 1, total: slides.length } }
}

export function opSetTransition(deck, args) {
  const t = args?.transition
  if (!TRANSITIONS.includes(t)) fail(`transition 은 ${TRANSITIONS.join(', ')} 중 하나여야 합니다`)
  const idx = args.all_slides === true ? deck.slides.map((_, k) => k) : [slideNo(deck, args.slide)]
  const slides = deck.slides.map((s, k) => (idx.includes(k) && s.transition !== t ? { ...s, transition: t } : s))
  const n = slides.filter((s, k) => s !== deck.slides[k]).length
  if (!n) return { noop: true, summary: '이미 같은 전환입니다', result: { changed: 0 } }
  return { deck: { ...deck, slides }, cur: idx[0], summary: `전환 효과 ${t}: ${n}장`, result: { changed: n } }
}

function pickEl(slide, ref, sel, i) {
  const els = slide.elements.filter((e) => e.type === 'text')
  let e
  if (typeof ref === 'string' && ref) e = els.find((x) => x.id === ref) || els.find((x) => x.role === ref)
  else e = els.find((x) => sel.includes(x.id)) || els.find((x) => x.role === 'body')
  if (!e) fail(`${i + 1}번 슬라이드에 글 상자 "${clip(String(ref ?? ''), 20)}" 이(가) 없습니다. 있는 글 상자: ${els.map((x) => `${x.id}${x.role ? `(${x.role})` : ''}`).join(', ') || '없음'}`)
  return e
}

export function opStyleText(deck, args, ctx = {}) {
  const i = slideNo(deck, args?.slide)
  const e = pickEl(deck.slides[i], args.element, ctx.sel || [], i)
  const style = { ...e.style }
  const parts = []
  if (args.size_pt !== undefined) { style.size = numArg(args.size_pt, 'size_pt', 8, 200, 18) * 2; parts.push(`${args.size_pt}pt`) }
  if (args.color !== undefined) { const c = colorArg(args.color, 'color'); if (c === null) fail('color 는 null 일 수 없습니다'); style.color = c; parts.push('색') }
  for (const k of ['bold', 'italic', 'underline']) if (args[k] !== undefined) { if (typeof args[k] !== 'boolean') fail(`${k} 는 true 또는 false`); style[k] = args[k]; parts.push(k) }
  if (args.align !== undefined) { if (!['left', 'center', 'right'].includes(args.align)) fail('align 은 left, center, right'); style.align = args.align; parts.push('정렬') }
  if (args.valign !== undefined) { if (!['top', 'middle', 'bottom'].includes(args.valign)) fail('valign 은 top, middle, bottom'); style.valign = args.valign; parts.push('세로 정렬') }
  if (!parts.length) fail('size_pt, color, bold, italic, underline, align, valign 중 하나는 필요합니다')
  if (JSON.stringify(style) === JSON.stringify(e.style)) return { noop: true, summary: '이미 같은 모양입니다', result: { changed: 0 } }
  const next = mapSlide(deck, i, (s) => ({ ...s, elements: s.elements.map((x) => (x.id === e.id ? { ...x, style: { ...style, ...(args.size_pt !== undefined ? { autofit: x.style?.autofit } : {}) } } : x)) }))
  const note = args.size_pt !== undefined && estimateText({ ...e, style }).overflow ? '키운 글이 상자를 넘칠 수 있음: check_deck 으로 확인' : undefined
  return { deck: next, cur: i, summary: `${i + 1}번 ${e.role || '글'} 모양: ${parts.join(', ')}`, result: { element: e.id, applied: parts, note } }
}

// ───────────────────────── 도구 ─────────────────────────

const S = (extra = {}) => ({ type: 'integer', minimum: 1, description: '슬라이드 번호(1부터)', ...extra })
const BOX_PROPS = { x: { type: 'integer', description: '왼쪽 위 x (슬라이드 폭 1920 기준)' }, y: { type: 'integer', description: '왼쪽 위 y (높이 1080 기준)' }, w: { type: 'integer' }, h: { type: 'integer' } }

export function createExtraSlideTools({ mutating, reading }) {
  return [
    {
      name: 'check_deck',
      description: '발표 디자인을 규칙으로 검사한다(결정적 검사, 내용 평가 아님). 슬라이드는 1920x1080px, 글자는 pt 로 말한다(18pt=36px). 규칙: overflow(글이 상자를 넘칠 추정), small_text(본문 18pt 미만, 아무 글 12pt 미만), too_many_bullets(6개 초과), low_contrast(WCAG 글자 4.5:1, 큰 글 3:1, 테마 색 해석), out_of_bounds, overlap(묶이지 않은 요소), inconsistent_size(같은 레이아웃 제목·본문 크기 다름), missing_alt, empty_placeholder(템플릿 빈 칸), no_title. 항목마다 id, rule, slide, element, severity, message, fix, auto(fix_deck 으로 자동 고침 가능). 최대 80개. "정리해줘/점검해줘/글자 작은 곳" 요청에 먼저 부르고, auto 항목은 fix_deck 으로, 나머지는 edit_slide_text, style_text, arrange_elements 로 고친다.',
      parameters: { type: 'object', properties: { slides: { type: 'array', items: S(), maxItems: 60, description: '검사할 슬라이드 번호들(생략하면 전체)' } } },
      run: reading((deck, a) => {
        if (!deck.slides.length) fail('슬라이드가 없습니다')
        const r = checkDeck(deck, { slides: Array.isArray(a.slides) ? a.slides.filter(Number.isInteger) : undefined })
        const auto = r.issues.filter((x) => x.auto).map((x) => x.id)
        return { total: r.issues.length, counts: r.counts, auto_fixable: auto.length, issues: r.issues.slice(0, MAX_ISSUES), truncated: r.issues.length > MAX_ISSUES, hint: auto.length ? 'fix_deck {issues:["auto"]} 로 auto 항목을 한 번에 고친다(되돌리기 한 번)' : undefined }
      }),
    },
    {
      name: 'fix_deck',
      description: 'check_deck 이 찾은 문제를 안전한 방법으로 한 번에 고친다(되돌리기 한 번): overflow(글자를 줄이거나 상자를 아래로 늘림), out_of_bounds(슬라이드 안으로 이동), low_contrast(테마 글자색으로), empty_placeholder(빈 자리 표시 요소 삭제), small_text(키워도 안 넘칠 때만 18pt). issues 에 check_deck 의 id 를 주거나 ["auto"] 로 auto 항목 전부. 글 내용은 바꾸지 않는다. 빈 자리 삭제가 싫으면 그 id 는 빼고 보낸다. id 는 요소 구성이 바뀌면 달라지니 오류가 나면 check_deck 을 다시 부른다.',
      parameters: { type: 'object', properties: { issues: { type: 'array', maxItems: 200, items: { type: 'string' }, description: 'check_deck 의 id 목록 또는 ["auto"]' } }, required: ['issues'] },
      run: mutating(opFixDeck),
    },
    {
      name: 'arrange_elements',
      description: `한 슬라이드의 요소를 정렬하거나 간격을 맞춘다(편집기의 정렬·분배와 같은 계산, 묶음은 한 덩어리). ids 는 read_slide 의 요소 id. op: align_left, center_h(가로 가운데), align_right, align_top, center_v(세로 가운데), align_bottom (요소 여러 개면 선택 범위의 가장자리 기준, 하나면 슬라이드 기준), distribute_h/distribute_v(3개 이상 균등 간격, gap 을 주면 2개부터 그 간격), tidy(줄을 찾아 가로·세로 간격을 같게), stack_row(윗선을 맞추고 gap 간격으로 가로 배열), stack_column(왼선을 맞추고 세로 배열). gap 은 px(기본 24). 잠긴 요소는 움직이지 않는다. 결과의 boxes 로 새 자리를 확인한다.`,
      parameters: { type: 'object', properties: { slide: S(), ids: { type: 'array', items: { type: 'string' }, maxItems: 100 }, op: { type: 'string', enum: ARRANGE_OPS }, gap: { type: 'integer', minimum: 0, maximum: 600 } }, required: ['slide', 'ids', 'op'] },
      run: mutating(opArrange),
    },
    {
      name: 'style_text',
      description: '글 상자 하나의 글 모양을 바꾼다(글 내용은 그대로). size_pt(8~200pt, 본문은 18pt 이상 권장), color(#RRGGBB 또는 @text, @accent, @muted 같은 테마 색), bold, italic, underline, align(left, center, right), valign(top, middle, bottom). element 는 요소 id 또는 역할(title, body, col1...)이고 생략하면 선택한 글 상자. 글이 상자를 넘치면 결과 note 가 알려 준다. 글 자체는 edit_slide_text.',
      parameters: { type: 'object', properties: { slide: S(), element: { type: 'string' }, size_pt: { type: 'number' }, color: { type: 'string' }, bold: { type: 'boolean' }, italic: { type: 'boolean' }, underline: { type: 'boolean' }, align: { type: 'string', enum: ['left', 'center', 'right'] }, valign: { type: 'string', enum: ['top', 'middle', 'bottom'] } }, required: ['slide'] },
      run: mutating(opStyleText),
    },
    {
      name: 'add_shape',
      description: '슬라이드에 도형을 넣는다. shape: rect, rounded, ellipse, triangle, arrow, line. fill/stroke 는 #RRGGBB 또는 테마 색(@accent 등). x,y,w,h 는 px(슬라이드 1920x1080), 생략하면 왼쪽 위쪽 기본 크기. 글이 든 도형은 지원하지 않으니 글은 글 상자에 쓴다. 장식용이며 결과의 id 를 arrange_elements 에 쓸 수 있다.',
      parameters: { type: 'object', properties: { slide: S(), shape: { type: 'string', enum: SHAPES }, fill: { type: 'string' }, stroke: { type: 'string' }, stroke_width: { type: 'integer' }, ...BOX_PROPS }, required: ['slide'] },
      run: mutating(opAddShape),
    },
    {
      name: 'add_image',
      description: '슬라이드에 이미지를 넣는다. url 은 https 주소만(http, data, 파일 경로 거부). 사용자가 준 주소나 검색으로 확인한 주소만 쓰고 주소를 지어내지 않는다. alt 는 대체 글(접근성, 꼭 쓴다). x,y,w,h px 생략하면 오른쪽 큰 칸. fit: cover(꽉 채움, 기본) 또는 contain.',
      parameters: { type: 'object', properties: { slide: S(), url: { type: 'string' }, alt: { type: 'string' }, fit: { type: 'string', enum: ['cover', 'contain'] }, ...BOX_PROPS }, required: ['slide', 'url'] },
      run: mutating(opAddImage),
    },
    {
      name: 'add_table',
      description: '슬라이드에 표를 넣는다. rows 는 문자열 2차원 배열(첫 행이 머리글, 최대 20행 8열, 칸 200자). 표 글자는 24px 기본이라 행이 많으면 작아지니 8행 안쪽을 권한다. x,y,w,h 생략하면 제목 아래 넓은 칸. 넣은 뒤 check_deck 으로 제목과 겹치는지 확인한다.',
      parameters: { type: 'object', properties: { slide: S(), rows: { type: 'array', maxItems: 20, items: { type: 'array', maxItems: 8, items: { type: 'string' } } }, ...BOX_PROPS }, required: ['slide', 'rows'] },
      run: mutating(opAddTable),
    },
    {
      name: 'set_background',
      description: '슬라이드 배경을 바꾼다. color(#RRGGBB 또는 @bg, @surface 같은 테마 색, null 이면 레이아웃 기본으로 되돌림) 또는 image_url(https). all_slides=true 면 모든 장. 배경을 바꾸면 글자 대비가 깨질 수 있으니 결과 note 를 보고 check_deck, fix_deck 으로 확인한다.',
      parameters: { type: 'object', properties: { slide: S({ description: 'all_slides 가 아니면 필요' }), all_slides: { type: 'boolean' }, color: { type: ['string', 'null'] }, image_url: { type: 'string' }, fit: { type: 'string', enum: ['cover', 'contain'] } } },
      run: mutating(opSetBackground),
    },
    {
      name: 'duplicate_slide',
      description: '슬라이드를 복제한다. 기본은 원본 바로 뒤에 넣고, to(최종 자리 번호, 1부터)를 주면 그 자리로 간다. 복제본이 현재 슬라이드가 된다.',
      parameters: { type: 'object', properties: { slide: S(), to: S({ description: '복제본이 놓일 자리(생략하면 원본 바로 뒤)' }) }, required: ['slide'] },
      run: mutating(opDuplicateSlide),
    },
    {
      name: 'set_transition',
      description: '슬라이드 전환 효과를 정한다: none, fade, slide, magic(같은 요소를 이어 움직임, 복제한 슬라이드 사이에서 효과적). slide 한 장 또는 all_slides=true 로 전체.',
      parameters: { type: 'object', properties: { slide: S({ description: 'all_slides 가 아니면 필요' }), all_slides: { type: 'boolean' }, transition: { type: 'string', enum: TRANSITIONS } }, required: ['transition'] },
      run: mutating(opSetTransition),
    },
  ]
}
