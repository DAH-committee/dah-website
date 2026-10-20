// DAH Slides 공통 핵심: 테마, 레이아웃(디자인 변형 포함), 새 발표 템플릿, 글(개요)로 발표 만들기.
// 이 파일은 server/src/lib/slideTemplates.js와 글자 하나까지 같은 사본이다(서버가 템플릿으로 새 발표를 만들 때 쓴다).
// 한쪽을 고치면 다른 쪽에도 그대로 복사한다. server/test/slides.test.mjs가 두 파일이 같은지 검사한다.
// DOM과 React를 쓰지 않는 순수 함수만 둔다.
//
// 색과 글꼴은 테마 토큰으로 적을 수 있다. '@bg' '@text' '@accent' '@accent2' '@muted' '@surface', 글꼴 '@heading' '@body'.
// 테마를 바꾸면 토큰을 쓴 요소가 함께 바뀐다. 사용자가 직접 고른 색('#rrggbb')은 그대로 남는다.

export const SLIDE_W = 1920
export const SLIDE_H = 1080

export const FONTS = {
  sans: { id: 'sans', name: '프리텐다드', css: "Pretendard, 'Pretendard Variable', -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif", office: 'Pretendard' },
  serif: { id: 'serif', name: '명조', css: "'Noto Serif KR', 'Nanum Myeongjo', AppleMyungjo, Batang, serif", office: 'Noto Serif KR' },
  gothic: { id: 'gothic', name: '고딕', css: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif", office: 'Malgun Gothic' },
  mono: { id: 'mono', name: '고정폭', css: "'D2Coding', ui-monospace, Menlo, Consolas, monospace", office: 'D2Coding' },
}

// 첫 테마가 기본이다. 구글 슬라이드의 기본 테마처럼 흰 바탕, 거의 검은 글자, 강조색은 제목 줄·도형에만 조금 쓴다.
// 흐린 파스텔 색은 쓰지 않는다. 보조 글자는 중간 회색(#6B6B6B 근처)이다. 어두운 테마는 고를 수 있지만 기본이 아니다.
export const THEMES = [
  { id: 'basic', name: '기본', fonts: { heading: 'sans', body: 'sans' }, colors: { bg: '#FFFFFF', text: '#111111', accent: '#7A3CFF', accent2: '#1A1A1A', muted: '#6B6B6B', surface: '#F2F2F2' } },
  { id: 'editorial', name: '지면', fonts: { heading: 'serif', body: 'sans' }, colors: { bg: '#FFFFFF', text: '#1A1A1A', accent: '#D93025', accent2: '#111111', muted: '#6B6B6B', surface: '#EFEFEF' } },
  { id: 'slate', name: '차분', fonts: { heading: 'sans', body: 'sans' }, colors: { bg: '#FFFFFF', text: '#1A1A1A', accent: '#1A73E8', accent2: '#0B8043', muted: '#6B6B6B', surface: '#F1F3F4' } },
  { id: 'mono', name: '흑백', fonts: { heading: 'sans', body: 'sans' }, colors: { bg: '#FFFFFF', text: '#111111', accent: '#111111', accent2: '#7A3CFF', muted: '#6B6B6B', surface: '#EDEDED' } },
  { id: 'night', name: '밤', fonts: { heading: 'sans', body: 'sans' }, colors: { bg: '#111111', text: '#FFFFFF', accent: '#9D6BFF', accent2: '#FFFFFF', muted: '#9A9A9A', surface: '#242424' } },
  { id: 'violet', name: '보라 밤', fonts: { heading: 'sans', body: 'sans' }, colors: { bg: '#170D2E', text: '#FFFFFF', accent: '#9D6BFF', accent2: '#FFFFFF', muted: '#9A96A6', surface: '#251944' } },
  { id: 'forest', name: '숲', fonts: { heading: 'sans', body: 'sans' }, colors: { bg: '#0E2A20', text: '#FFFFFF', accent: '#2FD08A', accent2: '#FFFFFF', muted: '#9AA5A0', surface: '#17402F' } },
]

export const COLOR_TOKENS = ['bg', 'text', 'accent', 'accent2', 'muted', 'surface']
export const TOKEN_NAMES = { bg: '배경', text: '글자', accent: '강조', accent2: '보조 강조', muted: '보조 글자', surface: '면' }

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

/** 테마를 저장용 모양으로 복사한다 */
export function themeCopy(id) {
  const t = themeById(id)
  return { id: t.id, name: t.name, fonts: { ...t.fonts }, colors: { ...t.colors } }
}

/** 색 토큰('@accent')을 실제 색으로 */
export function resolveColor(v, theme) {
  if (!v) return v
  if (typeof v === 'string' && v[0] === '@') return theme?.colors?.[v.slice(1)] || THEMES[0].colors[v.slice(1)] || '#111111'
  return v
}

/** 글꼴 값('@heading', 'serif', 임의 글꼴 이름)을 CSS font-family로 */
export function resolveFont(v, theme) {
  let key = v || '@body'
  if (key[0] === '@') key = theme?.fonts?.[key.slice(1)] || 'sans'
  if (FONTS[key]) return FONTS[key].css
  const safe = String(key).replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60)
  return safe ? `'${safe}', ${FONTS.sans.css}` : FONTS.sans.css
}

/** 내보내기(PPTX)용 글꼴 이름 */
export function officeFont(v, theme) {
  let key = v || '@body'
  if (key[0] === '@') key = theme?.fonts?.[key.slice(1)] || 'sans'
  if (FONTS[key]) return FONTS[key].office
  return String(key).replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'Pretendard'
}

let seq = 0
export function nid(p = 'e') {
  seq = (seq + 1) % 1679616
  return p + Date.now().toString(36).slice(-5) + seq.toString(36) + Math.random().toString(36).slice(2, 6)
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** 줄마다 문단 하나 */
export const paraHtml = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .map((l) => `<p>${l ? escapeHtml(l) : '<br>'}</p>`)
    .join('')

/** 목록 항목 [{text, level}] → <ul> (level 1은 바로 앞 항목 안쪽 목록) */
export function listHtml(items, ordered = false) {
  const tag = ordered ? 'ol' : 'ul'
  let out = `<${tag}>`
  let inner = false
  items.forEach((it, i) => {
    const lvl = i === 0 ? 0 : Math.min(it.level || 0, 1)
    if (lvl === 1 && !inner) {
      out = out.replace(/<\/li>$/, '') + `<${tag}>`
      inner = true
    } else if (lvl === 0 && inner) {
      out += `</${tag}></li>`
      inner = false
    }
    out += `<li>${escapeHtml(it.text)}</li>`
  })
  if (inner) out += `</${tag}></li>`
  return out + `</${tag}>`
}

// ── 요소 만들기 ─────────────────────────────────────────
const TEXT_DEFAULT = { font: '@body', size: 36, color: '@text', align: 'left', valign: 'top', lineHeight: 1.4, bold: false, italic: false, underline: false, fill: null, autofit: true }

export function textEl(role, box, style = {}, data = {}) {
  return { id: nid('e'), type: 'text', role: role || undefined, x: box[0], y: box[1], w: box[2], h: box[3], rotate: 0, z: 0, locked: false, style: { ...TEXT_DEFAULT, ...style }, data: { html: '', placeholder: '', ...data } }
}

export function shapeEl(shape, box, style = {}, role) {
  return { id: nid('e'), type: 'shape', role: role || undefined, x: box[0], y: box[1], w: box[2], h: box[3], rotate: 0, z: 0, locked: false, style: { fill: '@accent', stroke: null, strokeWidth: 0, radius: 24, ...style }, data: { shape } }
}

export function imageEl(box, data = {}, style = {}, role) {
  return { id: nid('e'), type: 'image', role: role || undefined, x: box[0], y: box[1], w: box[2], h: box[3], rotate: 0, z: 0, locked: false, style: { fit: 'cover', posX: 50, posY: 50, radius: 0, ...style }, data: { src: '', alt: '', placeholder: '이미지를 넣으세요', ...data } }
}

export function tableEl(rows, box, style = {}, role) {
  return {
    id: nid('e'), type: 'table', role: role || undefined, x: box[0], y: box[1], w: box[2], h: box[3], rotate: 0, z: 0, locked: false,
    style: { font: '@body', size: 24, color: '@text', headerFill: '@accent', headerColor: '@bg', line: '@muted', fill: null, ...style },
    data: { rows, header: true },
  }
}

// ── 레이아웃 ────────────────────────────────────────────
// 각 레이아웃은 역할(role)마다 상자를 정한다. 변형(variant)은 같은 역할을 다른 자리·색으로 놓는다("디자인 바꾸기").
// box: [x, y, w, h], s: 스타일 덮어쓰기. deco: 장식 요소(역할 'deco', 변형을 바꾸면 새로 만든다).
const TITLE_S = { font: '@heading', bold: true, lineHeight: 1.2 }
const KINDS = {
  title: 'text', subtitle: 'text', body: 'text', col1: 'text', col2: 'text', number: 'text', quote: 'text', caption: 'text', image: 'image',
}

export const LAYOUTS = [
  {
    id: 'title', name: '제목',
    ph: { title: '발표 제목', subtitle: '부제목, 이름, 날짜' },
    variants: [
      { boxes: { title: { box: [120, 330, 1680, 260], s: { ...TITLE_S, size: 104, valign: 'bottom' } }, subtitle: { box: [120, 640, 1680, 140], s: { size: 40, color: '@muted' } } }, deco: [['rect', [120, 290, 160, 16], { fill: '@accent', radius: 0 }]] },
      { boxes: { title: { box: [160, 300, 1600, 280], s: { ...TITLE_S, size: 110, align: 'center', valign: 'bottom' } }, subtitle: { box: [160, 640, 1600, 140], s: { size: 40, color: '@muted', align: 'center' } } }, deco: [['rect', [900, 606, 120, 10], { fill: '@accent', radius: 5 }]] },
      { bg: '@accent', boxes: { title: { box: [120, 300, 1680, 300], s: { ...TITLE_S, size: 110, valign: 'bottom', color: '@bg' } }, subtitle: { box: [120, 650, 1680, 140], s: { size: 40, color: '@bg' } } }, deco: [] },
    ],
  },
  {
    id: 'title-body', name: '제목+본문',
    ph: { title: '제목', body: '내용을 입력하세요' },
    variants: [
      { boxes: { title: { box: [120, 80, 1680, 160], s: { ...TITLE_S, size: 64, valign: 'bottom' } }, body: { box: [120, 280, 1680, 700], s: { size: 36, lineHeight: 1.55 } } }, deco: [] },
      { boxes: { title: { box: [120, 140, 560, 800], s: { ...TITLE_S, size: 64 } }, body: { box: [780, 140, 1020, 800], s: { size: 34, lineHeight: 1.6 } } }, deco: [['rect', [120, 100, 96, 12], { fill: '@accent', radius: 0 }]] },
      { boxes: { title: { box: [120, 70, 1680, 190], s: { ...TITLE_S, size: 64, valign: 'bottom' } }, body: { box: [120, 330, 1680, 670], s: { size: 36, lineHeight: 1.55 } } }, deco: [['rect', [120, 282, 1680, 4], { fill: '@accent', radius: 0 }]] },
    ],
  },
  {
    id: 'two-col', name: '두 단',
    ph: { title: '제목', col1: '왼쪽 내용', col2: '오른쪽 내용' },
    variants: [
      { boxes: { title: { box: [120, 80, 1680, 160], s: { ...TITLE_S, size: 64, valign: 'bottom' } }, col1: { box: [120, 290, 800, 690], s: { size: 34, lineHeight: 1.55 } }, col2: { box: [1000, 290, 800, 690], s: { size: 34, lineHeight: 1.55 } } }, deco: [] },
      { boxes: { title: { box: [120, 70, 1680, 160], s: { ...TITLE_S, size: 64, valign: 'bottom' } }, col1: { box: [160, 320, 740, 620], s: { size: 32, lineHeight: 1.55 } }, col2: { box: [1020, 320, 740, 620], s: { size: 32, lineHeight: 1.55 } } }, deco: [['rect', [120, 280, 820, 700], { fill: '@surface', radius: 24 }], ['rect', [980, 280, 820, 700], { fill: '@surface', radius: 24 }]] },
      { bg: '@surface', boxes: { title: { box: [120, 80, 1680, 160], s: { ...TITLE_S, size: 64, valign: 'bottom' } }, col1: { box: [120, 320, 800, 660], s: { size: 34, lineHeight: 1.55 } }, col2: { box: [1000, 320, 800, 660], s: { size: 34, lineHeight: 1.55 } } }, deco: [['rect', [120, 270, 800, 10], { fill: '@accent', radius: 0 }], ['rect', [1000, 270, 800, 10], { fill: '@accent2', radius: 0 }]] },
    ],
  },
  {
    id: 'section', name: '섹션 구분',
    ph: { title: '섹션 제목', subtitle: '짧은 설명' },
    variants: [
      { boxes: { title: { box: [120, 360, 1680, 260], s: { ...TITLE_S, size: 100, valign: 'bottom' } }, subtitle: { box: [120, 660, 1680, 120], s: { size: 38, color: '@muted' } } }, deco: [['rect', [120, 320, 160, 16], { fill: '@accent', radius: 0 }]] },
      { boxes: { title: { box: [780, 360, 1020, 280], s: { ...TITLE_S, size: 90, valign: 'bottom' } }, subtitle: { box: [780, 680, 1020, 140], s: { size: 36, color: '@muted' } } }, deco: [['rect', [640, 360, 16, 460], { fill: '@accent', radius: 0 }]] },
      { bg: '@text', boxes: { title: { box: [160, 380, 1600, 260], s: { ...TITLE_S, size: 100, align: 'center', valign: 'bottom', color: '@bg' } }, subtitle: { box: [160, 680, 1600, 120], s: { size: 38, align: 'center', color: '@bg' } } }, deco: [] },
      { bg: '@accent', boxes: { title: { box: [120, 360, 1680, 260], s: { ...TITLE_S, size: 100, valign: 'bottom', color: '@bg' } }, subtitle: { box: [120, 660, 1680, 120], s: { size: 38, color: '@bg' } } }, deco: [] },
    ],
  },
  {
    id: 'image-text', name: '이미지+글',
    ph: { title: '제목', body: '이미지 설명', image: '이미지를 넣으세요' },
    variants: [
      { boxes: { image: { box: [0, 0, 960, 1080] }, title: { box: [1060, 140, 740, 260], s: { ...TITLE_S, size: 60, valign: 'bottom' } }, body: { box: [1060, 440, 740, 540], s: { size: 32, lineHeight: 1.55 } } }, deco: [] },
      { boxes: { image: { box: [960, 0, 960, 1080] }, title: { box: [120, 140, 740, 260], s: { ...TITLE_S, size: 60, valign: 'bottom' } }, body: { box: [120, 440, 740, 540], s: { size: 32, lineHeight: 1.55 } } }, deco: [] },
      { boxes: { image: { box: [120, 100, 1680, 580], s: { radius: 24 } }, title: { box: [120, 720, 1680, 110], s: { ...TITLE_S, size: 52 } }, body: { box: [120, 840, 1680, 160], s: { size: 30, color: '@muted' } } }, deco: [] },
    ],
  },
  {
    id: 'big-number', name: '큰 숫자',
    ph: { title: '무엇의 숫자인지', number: '00%', caption: '숫자의 뜻과 출처' },
    variants: [
      { boxes: { title: { box: [120, 100, 1680, 100], s: { size: 34, color: '@muted' } }, number: { box: [120, 220, 1680, 440], s: { ...TITLE_S, size: 280, color: '@accent', valign: 'bottom', lineHeight: 1 } }, caption: { box: [120, 720, 1680, 240], s: { size: 44, lineHeight: 1.45 } } }, deco: [] },
      { boxes: { title: { box: [160, 120, 1600, 100], s: { size: 34, color: '@muted', align: 'center' } }, number: { box: [160, 240, 1600, 440], s: { ...TITLE_S, size: 300, color: '@accent', align: 'center', valign: 'bottom', lineHeight: 1 } }, caption: { box: [260, 730, 1400, 220], s: { size: 44, align: 'center', lineHeight: 1.45 } } }, deco: [] },
      { bg: '@accent', boxes: { title: { box: [160, 120, 1600, 100], s: { size: 34, color: '@bg', align: 'center' } }, number: { box: [160, 240, 1600, 440], s: { ...TITLE_S, size: 300, color: '@bg', align: 'center', valign: 'bottom', lineHeight: 1 } }, caption: { box: [260, 730, 1400, 220], s: { size: 44, color: '@bg', align: 'center', lineHeight: 1.45 } } }, deco: [] },
    ],
  },
  {
    id: 'quote', name: '인용',
    ph: { quote: '인용할 문장', caption: '말한 사람, 출처' },
    variants: [
      { boxes: { quote: { box: [260, 260, 1440, 460], s: { font: '@heading', size: 60, lineHeight: 1.4, bold: true } }, caption: { box: [260, 760, 1440, 100], s: { size: 32, color: '@muted' } } }, deco: [['quote', [120, 150, 200, 240], { color: '@accent' }]] },
      { bg: '@surface', boxes: { quote: { box: [200, 280, 1520, 420], s: { font: '@heading', size: 64, lineHeight: 1.4, bold: true, align: 'center', valign: 'middle' } }, caption: { box: [200, 740, 1520, 100], s: { size: 32, color: '@muted', align: 'center' } } }, deco: [['rect', [900, 220, 120, 10], { fill: '@accent', radius: 5 }]] },
    ],
  },
  {
    id: 'blank', name: '빈 화면',
    ph: {},
    variants: [{ boxes: {}, deco: [] }, { bg: '@surface', boxes: {}, deco: [] }],
  },
]

export const layoutById = (id) => LAYOUTS.find((l) => l.id === id) || LAYOUTS[LAYOUTS.length - 1]

function decoEls(deco) {
  return (deco || []).map(([kind, box, s]) => {
    if (kind === 'quote') {
      const el = textEl('deco', box, { font: 'serif', size: 300, bold: true, color: s.color, lineHeight: 1, autofit: false })
      el.data.html = '<p>“</p>'
      return el
    }
    return shapeEl(kind, box, s, 'deco')
  })
}

/** 레이아웃으로 새 슬라이드. content: {title, subtitle, body(html), ...} 역할별 HTML 또는 이미지 주소 */
export function makeSlide(layoutId = 'title-body', content = {}, variant = 0, extra = {}) {
  const L = layoutById(layoutId)
  const v = L.variants[variant % L.variants.length]
  const els = [...decoEls(v.deco)]
  for (const [role, spec] of Object.entries(v.boxes)) {
    const kind = KINDS[role]
    let el
    if (kind === 'image') {
      el = imageEl(spec.box, { src: content.image || '', alt: content.imageAlt || '', placeholder: L.ph[role] || '이미지를 넣으세요' }, spec.s || {}, role)
    } else {
      el = textEl(role, spec.box, spec.s || {}, { html: content[role] || '', placeholder: L.ph[role] || '' })
    }
    els.push(el)
  }
  if (Array.isArray(content.extra)) els.push(...content.extra)
  els.forEach((e, i) => (e.z = i + 1))
  return {
    id: nid('s'), layout: L.id, variant: variant % L.variants.length, background: v.bg ? { color: v.bg } : null,
    notes: content.notes || '', hidden: false, transition: 'none', elements: els, ...extra,
  }
}

/**
 * 같은 레이아웃의 다른 변형(또는 다른 레이아웃)으로 바꾼다. 역할이 있는 요소는 내용을 지키고 자리·모양만 옮긴다.
 * 역할이 없는(사용자가 더한) 요소는 그대로 둔다. 장식은 새 변형의 장식으로 바꾼다.
 */
export function applyLayout(slide, layoutId, variant = 0) {
  const L = layoutById(layoutId)
  const v = L.variants[((variant % L.variants.length) + L.variants.length) % L.variants.length]
  const byRole = new Map()
  const free = []
  for (const e of slide.elements) {
    if (e.role === 'deco') continue
    if (e.role && !byRole.has(e.role)) byRole.set(e.role, e)
    else free.push(e)
  }
  // 레이아웃끼리 비슷한 역할은 서로 옮겨 준다(본문 ↔ 왼쪽 단 ↔ 인용 ↔ 설명)
  const ALIASES = { body: ['col1', 'caption', 'quote', 'subtitle'], col1: ['body'], col2: ['caption'], quote: ['body', 'title'], caption: ['body', 'subtitle', 'col2'], subtitle: ['caption', 'body'], number: ['title'], title: ['quote', 'number'] }
  const used = new Set()
  const out = [...decoEls(v.deco)]
  for (const [role, spec] of Object.entries(v.boxes)) {
    let src = byRole.get(role)
    if (!src || used.has(src)) src = (ALIASES[role] || []).map((r) => byRole.get(r)).find((e) => e && !used.has(e) && !v.boxes[e.role])
    const kind = KINDS[role]
    if (src && src.type === kind) {
      used.add(src)
      const base = kind === 'image' ? { fit: 'cover', posX: 50, posY: 50, radius: 0 } : { ...TEXT_DEFAULT }
      const keep = kind === 'image' ? { fit: src.style.fit, posX: src.style.posX, posY: src.style.posY } : {}
      out.push({ ...src, role, x: spec.box[0], y: spec.box[1], w: spec.box[2], h: spec.box[3], rotate: 0, style: { ...base, ...(spec.s || {}), ...keep }, data: { ...src.data, placeholder: L.ph[role] || src.data.placeholder || '' } })
    } else if (kind === 'image') {
      out.push(imageEl(spec.box, { placeholder: L.ph[role] }, spec.s || {}, role))
    } else {
      out.push(textEl(role, spec.box, spec.s || {}, { placeholder: L.ph[role] || '' }))
    }
  }
  // 새 레이아웃에 자리가 없는 역할 요소: 내용이 있으면 역할 없이 남기고, 비어 있으면 버린다
  for (const e of byRole.values()) {
    if (used.has(e)) continue
    const empty = e.type === 'text' ? !String(e.data?.html || '').replace(/<[^>]*>/g, '').trim() : e.type === 'image' ? !e.data?.src : false
    if (!empty) free.push({ ...e, role: undefined })
  }
  out.push(...free)
  out.forEach((e, i) => (e.z = i + 1))
  return { ...slide, layout: L.id, variant: L.variants.indexOf(v), background: v.bg ? { color: v.bg } : slide.background?.image ? slide.background : null, elements: out }
}

/**
 * 매직 무브 짝 찾기: 앞 슬라이드(from)와 다음 슬라이드(to)에서 같은 mid(없으면 같은 id)를 가진 요소끼리 잇는다.
 * 요소마다 한 번만 짝이 된다. 반환: [[fromEl, toEl], ...]. 짝이 없는 요소는 사라지거나(앞) 나타난다(뒤).
 */
export function magicMatches(from, to) {
  const pairs = []
  const used = new Set()
  const fromEls = (from?.elements || []).filter((e) => !e.hidden)
  const byMid = new Map()
  const byId = new Map()
  for (const e of fromEls) {
    if (e.mid && !byMid.has(e.mid)) byMid.set(e.mid, e)
    byId.set(e.id, e)
  }
  for (const e of to?.elements || []) {
    if (e.hidden) continue
    let m = e.mid ? byMid.get(e.mid) : null
    if (!m || used.has(m)) m = byId.get(e.id)
    if (m && !used.has(m) && m.type === e.type && (!m.mid || !e.mid || m.mid === e.mid)) {
      used.add(m)
      pairs.push([m, e])
    }
  }
  return pairs
}

export function newDeck(themeId = 'basic', slides) {
  return { version: 1, theme: themeCopy(themeId), size: { w: SLIDE_W, h: SLIDE_H }, slides: slides || [makeSlide('title')] }
}

// ── 새 발표 템플릿 ───────────────────────────────────────
// 자리 표시 문장(placeholder)은 편집 화면에서만 보이고 발표·내보내기에는 나오지 않는다. 사실을 지어 넣지 않는다.
const H = (t) => `<p>${escapeHtml(t)}</p>`
const PH = (slide, role, text) => {
  const el = slide.elements.find((e) => e.role === role)
  if (el) el.data.placeholder = text
  return slide
}
const withTable = (slide, rows, box = [120, 290, 1680, 680]) => {
  const t = tableEl(rows, box)
  t.z = slide.elements.length + 1
  slide.elements = slide.elements.filter((e) => e.role !== 'body')
  slide.elements.push(t)
  return slide
}
const emptyRows = (head, n) => [head, ...Array.from({ length: n }, () => head.map(() => ''))]

export const SLIDE_TEMPLATE_META = [
  { id: 'blank', name: '빈 발표', sub: '제목 슬라이드 하나' },
  { id: 'assignment', name: '과제 발표', sub: '개요, 조사, 결과, 배운 점' },
  { id: 'pitch', name: '프로젝트 피치', sub: '문제, 해결, 근거, 일정' },
  { id: 'ux-research', name: 'UX 리서치 결과', sub: '인터뷰, 페르소나, 여정 지도' },
  { id: 'portfolio', name: '포트폴리오', sub: '소개와 프로젝트' },
  { id: 'club', name: '동아리·행사 소개', sub: '소개, 활동, 일정, 참여 방법' },
  { id: 'seminar', name: '학회·세미나 발표', sub: '배경, 방법, 결과, 논의' },
]

const BUILDERS = {
  blank: () => newDeck('basic', [makeSlide('title')]),
  assignment: () =>
    newDeck('basic', [
      PH(PH(makeSlide('title'), 'title', '과제 제목'), 'subtitle', '과목명, 이름, 제출일'),
      PH(makeSlide('title-body', { title: H('과제 개요') }), 'body', '과제가 요구한 것과 내가 정한 범위를 적습니다'),
      PH(makeSlide('title-body', { title: H('조사 내용') }, 1), 'body', '찾아본 자료와 핵심 내용을 목록으로 정리합니다'),
      PH(makeSlide('image-text', { title: H('결과물') }), 'body', '결과물 사진이나 화면을 넣고 설명합니다'),
      PH(PH(makeSlide('two-col', { title: H('배운 점과 아쉬운 점') }, 1), 'col1', '배운 점'), 'col2', '아쉬운 점과 다음에 바꿀 것'),
      PH(makeSlide('title-body', { title: H('참고 자료') }), 'body', '저자, 제목, 출처, 날짜'),
    ]),
  pitch: () =>
    newDeck('basic', [
      PH(PH(makeSlide('title'), 'title', '프로젝트 이름'), 'subtitle', '한 문장 소개, 팀 이름'),
      PH(makeSlide('title-body', { title: H('문제') }), 'body', '누가 언제 어떤 불편을 겪는지 씁니다'),
      PH(PH(PH(makeSlide('big-number'), 'title', '문제의 크기를 보여 주는 숫자'), 'number', '00%'), 'caption', '숫자의 뜻과 출처(기관, 연도)'),
      PH(makeSlide('title-body', { title: H('해결') }, 1), 'body', '우리가 만드는 것과 쓰는 장면을 씁니다'),
      PH(PH(makeSlide('two-col', { title: H('기존 방식과 우리 방식') }, 1), 'col1', '지금 쓰는 방법과 한계'), 'col2', '우리 방법이 바꾸는 점'),
      PH(makeSlide('title-body', { title: H('근거') }), 'body', '인터뷰, 설문, 시험 결과 등 직접 확인한 근거와 출처'),
      withTable(makeSlide('title-body', { title: H('일정') }), emptyRows(['단계', '기간', '할 일', '담당'], 4)),
      PH(makeSlide('title-body', { title: H('팀') }, 2), 'body', '이름, 역할, 맡은 일'),
      PH(PH(makeSlide('section', { title: H('감사합니다') }), 'title', '감사합니다'), 'subtitle', '연락처'),
    ]),
  'ux-research': () =>
    newDeck('basic', [
      PH(PH(makeSlide('title', {}, 1), 'title', '리서치 제목'), 'subtitle', '기간, 참여자 수, 팀 이름'),
      PH(PH(makeSlide('two-col', { title: H('연구 질문과 방법') }), 'col1', '알고 싶었던 질문'), 'col2', '방법(인터뷰, 관찰, 설문)과 진행 방식'),
      withTable(makeSlide('title-body', { title: H('인터뷰 참여자') }), emptyRows(['참여자', '특징', '핵심 발언'], 5)),
      PH(PH(makeSlide('quote'), 'quote', '인터뷰에서 들은 말을 그대로 옮깁니다'), 'caption', '참여자 번호, 상황'),
      PH(PH(makeSlide('image-text', { title: H('페르소나') }, 1), 'body', '이름, 상황, 목표, 불편, 하는 행동'), 'image', '페르소나 이미지'),
      withTable(makeSlide('title-body', { title: H('여정 지도') }, 0), [['', '단계 1', '단계 2', '단계 3', '단계 4'], ['행동', '', '', '', ''], ['생각', '', '', '', ''], ['감정', '', '', '', ''], ['기회', '', '', '', '']]),
      PH(makeSlide('title-body', { title: H('인사이트') }, 2), 'body', '관찰에서 얻은 해석을 근거와 함께 적습니다'),
      PH(makeSlide('title-body', { title: H('다음 단계') }), 'body', '확인할 것, 만들 것, 날짜'),
    ]),
  portfolio: () =>
    newDeck('basic', [
      PH(PH(makeSlide('title', {}, 1), 'title', '이름'), 'subtitle', '전공, 관심 분야, 연락처'),
      PH(PH(makeSlide('image-text', { title: H('소개') }), 'body', '나를 소개하는 짧은 글'), 'image', '프로필 사진'),
      PH(PH(makeSlide('section', {}, 1), 'title', '프로젝트 1'), 'subtitle', '기간, 역할, 도구'),
      PH(makeSlide('image-text', { title: H('결과물') }, 2), 'body', '무엇을 만들었고 무엇을 맡았는지'),
      PH(PH(makeSlide('two-col', { title: H('과정') }, 1), 'col1', '문제와 조사'), 'col2', '시안과 결정'),
      PH(PH(makeSlide('section', {}, 1), 'title', '프로젝트 2'), 'subtitle', '기간, 역할, 도구'),
      PH(makeSlide('image-text', { title: H('결과물') }, 1), 'body', '무엇을 만들었고 무엇을 맡았는지'),
      PH(makeSlide('title-body', { title: H('연락처') }), 'body', '이메일, 포트폴리오 주소'),
    ]),
  club: () =>
    newDeck('basic', [
      PH(PH(makeSlide('title'), 'title', '동아리 또는 행사 이름'), 'subtitle', '한 줄 소개'),
      PH(makeSlide('title-body', { title: H('우리는') }, 1), 'body', '언제 만들어졌고 무엇을 하는지'),
      PH(PH(makeSlide('two-col', { title: H('활동') }, 1), 'col1', '정기 활동'), 'col2', '행사와 결과물'),
      PH(makeSlide('image-text', { title: H('지난 활동') }), 'body', '사진과 설명'),
      withTable(makeSlide('title-body', { title: H('일정') }), emptyRows(['날짜', '장소', '내용'], 4)),
      PH(makeSlide('title-body', { title: H('함께하기') }, 2), 'body', '모집 기간, 신청 방법, 문의처'),
    ]),
  seminar: () =>
    newDeck('editorial', [
      PH(PH(makeSlide('title', {}, 1), 'title', '발표 제목'), 'subtitle', '발표자, 소속, 학회 이름, 날짜'),
      PH(makeSlide('title-body', { title: H('발표 순서') }), 'body', '배경, 선행 연구, 방법, 결과, 논의'),
      PH(PH(makeSlide('section'), 'title', '배경'), 'subtitle', '연구를 시작한 이유'),
      PH(makeSlide('title-body', { title: H('선행 연구') }), 'body', '저자(연도), 핵심 주장'),
      PH(makeSlide('title-body', { title: H('연구 방법') }, 1), 'body', '자료, 대상, 분석 방법'),
      PH(makeSlide('image-text', { title: H('결과') }, 2), 'body', '그림이나 표와 설명'),
      PH(makeSlide('title-body', { title: H('논의') }), 'body', '해석, 한계, 이후 연구'),
      PH(makeSlide('title-body', { title: H('참고 문헌') }), 'body', '인용한 자료 목록'),
      PH(PH(makeSlide('section'), 'title', '질의응답'), 'subtitle', '연락처'),
    ]),
}

/** 서버용: id → () => content */
export const SLIDE_TEMPLATES = Object.fromEntries(Object.entries(BUILDERS).map(([k, fn]) => [k, () => fn()]))

/** 화면용: [{id, name, sub, build}] */
export const SLIDE_TEMPLATE_LIST = SLIDE_TEMPLATE_META.map((m) => ({ ...m, build: SLIDE_TEMPLATES[m.id] }))

// ── 글로 만들기: 개요(마크다운 비슷한 글) → 슬라이드 ───────────────
// 규칙: 맨 앞 # → 제목 슬라이드(다음 문단은 부제목), 그 뒤 # → 섹션 구분, ## → 새 슬라이드 제목,
// - * 1. → 목록, > → 인용 슬라이드, 이미지 주소나 ![설명](주소) → 이미지 슬라이드, --- → 슬라이드 나누기,
// "노트:"로 시작하는 줄 → 발표자 노트, 제목이 숫자(예: 72%, 1,200명)뿐이면 큰 숫자 슬라이드.
// 본문이 길면(목록 7줄 또는 글자 420자 초과) 다음 슬라이드로 나누고 제목 뒤에 "(계속)"을 붙인다.
const IMG_RE = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$|^(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?\S*)?|https?:\/\/(?:images\.unsplash\.com|i\.imgur\.com|[\w-]+\.public\.blob\.vercel-storage\.com)\/\S+)$/i
const NUM_RE = /^[~약]?\s*[+-]?[\d.,]+\s*(%|배|명|개|원|만|억|천|위|점|시간|분|초|일|년|x|X|k|K|M)?\+?$/
const MAX_LINES = 7
const MAX_CHARS = 420

export function outlineToSlides(text, opts = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let cur = null
  const push = () => {
    if (cur) blocks.push(cur)
    cur = null
  }
  const start = (kind, title) => {
    push()
    cur = { kind, title, items: [], paras: [], notes: [], images: [], quote: null }
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const t = line.trim()
    if (!t) continue
    let m
    if ((m = t.match(/^#\s+(.+)/))) {
      start(blocks.length === 0 && !cur ? 'title' : 'section', m[1])
      continue
    }
    if ((m = t.match(/^#{2,6}\s+(.+)/))) {
      start('slide', m[1])
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      push()
      continue
    }
    if (!cur) start('slide', '')
    if ((m = t.match(/^(노트|메모|notes?)\s*[:：]\s*(.*)$/i))) {
      cur.notes.push(m[2])
      continue
    }
    if ((m = t.match(IMG_RE))) {
      cur.images.push({ src: m[2] || m[3], alt: m[1] || '' })
      continue
    }
    if ((m = t.match(/^>\s?(.*)/))) {
      cur.quote = cur.quote ? `${cur.quote}\n${m[1]}` : m[1]
      continue
    }
    if ((m = line.match(/^(\s*)([-*+•]|\d+[.)])\s+(.+)/))) {
      const indent = m[1].replace(/\t/g, '  ').length
      cur.items.push({ text: m[3], level: indent >= 2 ? 1 : 0, ordered: /\d/.test(m[2]) })
      continue
    }
    if (cur.kind === 'title' && !cur.paras.length && !cur.items.length) cur.sub = cur.sub ? `${cur.sub}\n${t}` : t
    else cur.paras.push(t)
  }
  push()

  const slides = []
  const notesOf = (b) => b.notes.join('\n')
  for (const b of blocks) {
    if (b.kind === 'title') {
      slides.push(makeSlide('title', { title: paraHtml(b.title), subtitle: b.sub ? paraHtml(b.sub) : '', notes: notesOf(b) }))
      if (b.paras.length || b.items.length) slides.push(...bodySlides({ ...b, title: b.title }, ''))
      continue
    }
    if (b.kind === 'section') {
      const sub = b.paras.length && !b.items.length && b.paras.join(' ').length < 120 ? b.paras.join('\n') : ''
      slides.push(makeSlide('section', { title: paraHtml(b.title), subtitle: sub ? paraHtml(sub) : '', notes: notesOf(b) }))
      if (!sub && (b.paras.length || b.items.length)) slides.push(...bodySlides(b, notesOf(b)).map((s) => s))
      continue
    }
    if (b.quote && !b.items.length && !b.images.length) {
      slides.push(makeSlide('quote', { quote: paraHtml(b.quote), caption: b.paras.length ? paraHtml(b.paras.join('\n')) : b.title ? paraHtml(b.title) : '', notes: notesOf(b) }))
      continue
    }
    if (b.title && NUM_RE.test(b.title.trim()) && !b.images.length) {
      const cap = [...b.paras, ...b.items.map((i) => i.text)].join('\n')
      slides.push(makeSlide('big-number', { number: paraHtml(b.title.trim()), caption: cap ? paraHtml(cap) : '', notes: notesOf(b) }))
      continue
    }
    if (b.quote) b.paras.unshift(`“${b.quote}”`)
    if (b.images.length) {
      b.images.forEach((img, i) => {
        const body = i === 0 ? [...b.paras.map((p) => `<p>${escapeHtml(p)}</p>`), b.items.length ? listHtml(b.items, b.items[0].ordered) : ''].join('') : ''
        slides.push(makeSlide('image-text', { title: paraHtml(i === 0 ? b.title : `${b.title} (${i + 1})`), body: body || (img.alt ? paraHtml(img.alt) : ''), image: img.src, imageAlt: img.alt, notes: i === 0 ? notesOf(b) : '' }, slides.length % 2))
      })
      continue
    }
    slides.push(...bodySlides(b, notesOf(b)))
  }
  if (!slides.length) slides.push(makeSlide('title'))
  if (opts.alternate !== false) {
    // 본문 슬라이드가 줄줄이 같은 모양이 되지 않게 변형을 번갈아 준다
    let n = 0
    for (let i = 0; i < slides.length; i++) {
      if (slides[i].layout === 'title-body' && n++ % 3 === 2) slides[i] = applyLayout(slides[i], 'title-body', 2)
    }
  }
  return slides
}

function bodySlides(b, notes) {
  // 문단과 목록을 순서대로 조각 내어 한 슬라이드에 MAX_LINES줄, MAX_CHARS자까지 담는다
  const units = [...b.paras.map((p) => ({ type: 'p', text: p, level: 0 })), ...b.items.map((i) => ({ type: i.ordered ? 'ol' : 'ul', text: i.text, level: i.level }))]
  const pages = []
  let page = []
  let chars = 0
  for (const u of units) {
    const len = u.text.length
    if (page.length && (page.length >= MAX_LINES || chars + len > MAX_CHARS)) {
      pages.push(page)
      page = []
      chars = 0
    }
    page.push(u)
    chars += len
  }
  if (page.length) pages.push(page)
  if (!pages.length) pages.push([])
  return pages.map((pg, i) => {
    let html = ''
    let run = []
    const flush = () => {
      if (run.length) html += listHtml(run, run[0].type === 'ol')
      run = []
    }
    for (const u of pg) {
      if (u.type === 'p') {
        flush()
        html += `<p>${escapeHtml(u.text)}</p>`
      } else {
        if (run.length && run[0].type !== u.type) flush()
        run.push(u)
      }
    }
    flush()
    const title = i === 0 ? b.title : `${b.title} (계속)`
    return makeSlide('title-body', { title: title ? paraHtml(title) : '', body: html, notes: i === 0 ? notes : '' })
  })
}
