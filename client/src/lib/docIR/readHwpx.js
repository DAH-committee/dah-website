// 한글(HWPX, OWPML) -> docIR 읽기. 한컴이 저장한 실제 파일(맥 10.30/12.30, 윈도 13)에서 확인한 구조를 따른다. 자세한 근거는 hwpx-notes.md.
// 순수 ESM, 브라우저와 Node 양쪽에서 동작, 외부 의존은 jszip 뿐(XML 은 아래 작은 해석기로 읽는다: Node 에는 DOMParser 가 없다).
import JSZip from 'jszip'
import { U } from './schema.js'

// ───────────── 작은 XML 해석기 ─────────────
// 노드: { n: 로컬 이름, a: 속성, c: 자식(노드 또는 글자 문자열) }
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
        if (e[0] === '#') {
          const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
          try { return String.fromCodePoint(cp) } catch { return '' }
        }
        return ENT[e] ?? m
      })

export function parseXml(src) {
  const root = { n: '#root', a: {}, c: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let last = 0
  let m
  while ((m = re.exec(src))) {
    if (m.index > last) {
      const t = src.slice(last, m.index)
      if (t) stack[stack.length - 1].c.push(decode(t))
    }
    last = re.lastIndex
    if (m[1] !== undefined && m[0].startsWith('<![CDATA[')) {
      stack[stack.length - 1].c.push(m[1])
      continue
    }
    if (!m[3]) continue // 주석, 선언
    const name = m[3].includes(':') ? m[3].slice(m[3].indexOf(':') + 1) : m[3]
    if (m[2] === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }
    const a = {}
    const attrRe = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let am
    while ((am = attrRe.exec(m[4]))) {
      const k = am[1].includes(':') ? am[1].slice(am[1].indexOf(':') + 1) : am[1]
      a[k] = decode(am[2] ?? am[3] ?? '')
    }
    const node = { n: name, a, c: [] }
    stack[stack.length - 1].c.push(node)
    if (!m[5]) stack.push(node)
  }
  if (last < src.length) {
    const t = src.slice(last)
    if (t.trim()) stack[stack.length - 1].c.push(decode(t))
  }
  return root
}
const kids = (n, name) => (n ? n.c.filter((x) => typeof x !== 'string' && (!name || x.n === name)) : [])
const kid = (n, name) => (n ? n.c.find((x) => typeof x !== 'string' && x.n === name) : undefined)
const textOf = (n) => (n ? n.c.map((x) => (typeof x === 'string' ? x : textOf(x))).join('') : '')
const num = (v, d = 0) => {
  const x = parseFloat(v)
  return Number.isFinite(x) ? x : d
}
function find(n, name, out = []) {
  if (!n || typeof n === 'string') return out
  if (n.n === name) out.push(n)
  for (const c of n.c) find(c, name, out)
  return out
}

// ───────────── 도우미 ─────────────
const NUM_FMT = {
  DIGIT: (n) => String(n),
  CIRCLED_DIGIT: (n) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n)),
  HANGUL_SYLLABLE: (n) => '가나다라마바사아자차카타파하'[(n - 1) % 14] || String(n),
  CIRCLED_HANGUL_SYLLABLE: (n) => (n >= 1 && n <= 14 ? String.fromCodePoint(0x326e + n - 1) : String(n)),
  HANGUL_JAMO: (n) => 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'[(n - 1) % 14] || String(n),
  ROMAN_SMALL: (n) => roman(n).toLowerCase(),
  ROMAN_CAPITAL: (n) => roman(n),
  LATIN_SMALL: (n) => String.fromCharCode(96 + (((n - 1) % 26) + 1)),
  LATIN_CAPITAL: (n) => String.fromCharCode(64 + (((n - 1) % 26) + 1)),
  CIRCLED_LATIN_SMALL: (n) => String.fromCodePoint(0x24d0 + ((n - 1) % 26)),
  CIRCLED_LATIN_CAPITAL: (n) => String.fromCodePoint(0x24b6 + ((n - 1) % 26)),
}
function roman(n) {
  const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let s = ''
  for (const [v, r] of t) while (n >= v) { s += r; n -= v }
  return s
}

const mmOf = (h) => U.ptToMm(h / 100)
const ptOf = (h) => h / 100
const round1 = (x) => Math.round(x * 10) / 10

function sniffMime(d) {
  if (d[0] === 0x89 && d[1] === 0x50) return 'image/png'
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg'
  if (d[0] === 0x47 && d[1] === 0x49) return 'image/gif'
  if (d[0] === 0x42 && d[1] === 0x4d) return 'image/bmp'
  return null
}
function imageSize(d, mime) {
  try {
    if (mime === 'image/png') return { w: ((d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19]) >>> 0, h: ((d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23]) >>> 0 }
    if (mime === 'image/gif') return { w: d[6] | (d[7] << 8), h: d[8] | (d[9] << 8) }
    if (mime === 'image/bmp') return { w: d[18] | (d[19] << 8) | (d[20] << 16), h: Math.abs(d[22] | (d[23] << 8) | (d[24] << 16)) }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i < d.length) {
        if (d[i] !== 0xff) { i++; continue }
        const m = d[i + 1]
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (d[i + 5] << 8) | d[i + 6], w: (d[i + 7] << 8) | d[i + 8] }
        i += 2 + ((d[i + 2] << 8) | d[i + 3])
      }
    }
  } catch { /* 모르면 null */ }
  return null
}

// ───────────── 머리말 파일 해석 ─────────────
function readHead(head) {
  const out = { fonts: {}, borderFills: {}, charPrs: {}, paraPrs: {}, numberings: {}, bullets: {}, styles: {} }
  const ref = kid(head, 'refList')
  if (!ref) return out
  for (const ff of kids(kid(ref, 'fontfaces'), 'fontface')) {
    const lang = (ff.a.lang || '').toLowerCase()
    out.fonts[lang] = {}
    for (const f of kids(ff, 'font')) out.fonts[lang][f.a.id] = f.a.face
  }
  for (const bf of kids(kid(ref, 'borderFills'), 'borderFill')) {
    const side = (n) => {
      const e = kid(bf, n)
      if (!e) return null
      const type = e.a.type || 'NONE'
      return { type, widthMm: num((e.a.width || '0.1').replace(/mm/, '')), color: e.a.color || '#000000' }
    }
    const brush = kid(kid(bf, 'fillBrush'), 'winBrush')
    const grad = kid(kid(bf, 'fillBrush'), 'gradation')
    const img = kid(kid(bf, 'fillBrush'), 'imgBrush')
    out.borderFills[bf.a.id] = {
      l: side('leftBorder'), r: side('rightBorder'), t: side('topBorder'), b: side('bottomBorder'), diag: side('diagonal'),
      slash: kid(bf, 'slash')?.a.type || 'NONE', backSlash: kid(bf, 'backSlash')?.a.type || 'NONE',
      fill: brush && brush.a.faceColor && brush.a.faceColor !== 'none' ? brush.a.faceColor : null,
      complexFill: !!(grad || img),
    }
  }
  for (const cp of kids(kid(ref, 'charProperties'), 'charPr')) {
    const g = (n) => kid(cp, n)?.a || {}
    const ul = kid(cp, 'underline')
    const st = kid(cp, 'strikeout')
    out.charPrs[cp.a.id] = {
      h: num(cp.a.height, 1000),
      color: cp.a.textColor || '#000000',
      shade: cp.a.shadeColor && cp.a.shadeColor !== 'none' ? cp.a.shadeColor : null,
      font: g('fontRef'),
      ratio: g('ratio'),
      spacing: g('spacing'),
      relSz: g('relSz'),
      offset: g('offset'),
      useKerning: cp.a.useKerning === '1',
      useFontSpace: cp.a.useFontSpace === '1',
      bold: !!kid(cp, 'bold'),
      italic: !!kid(cp, 'italic'),
      underline: ul && ul.a.type && ul.a.type !== 'NONE' ? ul.a.shape || 'SOLID' : null,
      strike: st && st.a.shape && st.a.shape !== 'NONE' ? true : false,
      sup: !!kid(cp, 'supscript'),
      sub: !!kid(cp, 'subscript'),
    }
  }
  const pickCase = (pp) => {
    // hp:switch 가 있으면 HwpUnitChar(hwpunit) 쪽인 case 를 읽는다. default 는 옛 단위(2배)라서 case 가 없을 때만 절반으로 쓴다
    const sw = kid(pp, 'switch')
    if (!sw) return { src: pp, half: false }
    const cs = kid(sw, 'case')
    if (cs) return { src: cs, half: false }
    return { src: kid(sw, 'default') || sw, half: true }
  }
  for (const pp of kids(kid(ref, 'paraProperties'), 'paraPr')) {
    const { src, half } = pickCase(pp)
    const mar = kid(src, 'margin') || kid(pp, 'margin')
    const mv = (n) => {
      const e = kid(mar, n)
      const v = num(e?.a.value)
      return half ? v / 2 : v
    }
    const ls = kid(src, 'lineSpacing') || kid(pp, 'lineSpacing')
    const lsv = num(ls?.a.value, 160)
    const bs = kid(pp, 'breakSetting')?.a || {}
    const hd = kid(pp, 'heading')?.a || {}
    out.paraPrs[pp.a.id] = {
      align: kid(pp, 'align')?.a.horizontal || 'JUSTIFY',
      intent: mv('intent'), left: mv('left'), right: mv('right'), prev: mv('prev'), next: mv('next'),
      ls: { type: ls?.a.type || 'PERCENT', value: ls?.a.type && ls.a.type !== 'PERCENT' && half ? lsv / 2 : lsv },
      keepNext: bs.keepWithNext === '1', keepLines: bs.keepLines === '1', pbb: bs.pageBreakBefore === '1', widow: bs.widowOrphan === '1',
      heading: { type: hd.type || 'NONE', idRef: hd.idRef, level: num(hd.level) },
      border: kid(pp, 'border')?.a.borderFillIDRef,
      bs, auto: kid(pp, 'autoSpacing')?.a || {}, condense: num(pp.a.condense), snap: pp.a.snapToGrid,
    }
  }
  for (const nb of kids(kid(ref, 'numberings'), 'numbering')) {
    const heads = {}
    for (const ph of kids(nb, 'paraHead')) heads[num(ph.a.level)] = { start: num(ph.a.start, 1), fmt: ph.a.numFormat || 'DIGIT', text: textOf(ph) }
    out.numberings[nb.a.id] = { heads, start: num(nb.a.start, 0) }
  }
  for (const b of kids(kid(ref, 'bullets'), 'bullet')) out.bullets[b.a.id] = { char: b.a.char || '•' }
  for (const st of kids(kid(ref, 'styles'), 'style')) out.styles[st.a.id] = { name: st.a.name, para: st.a.paraPrIDRef, char: st.a.charPrIDRef, type: st.a.type }
  return out
}

// ───────────── 본문 읽기 ─────────────
class Reader {
  constructor(head, files, opts) {
    this.h = head
    this.files = files // { 'BinData/image1.png': Uint8Array } + manifest
    this.opts = opts
    this.assets = {}
    this.assetByItem = {}
    this.skipped = {}
    this.counters = {}
    this.header = null
    this.footer = null
    this.pageNums = []
    this.page = null
    this.defaults = null
  }
  skip(k) {
    this.skipped[k] = (this.skipped[k] || 0) + 1
  }
  font(lang, id) {
    return this.h.fonts[lang]?.[id]
  }
  // 글자 서식 -> Run 속성(문서 기본과 다른 값만)
  runProps(cid) {
    const c = this.h.charPrs[cid]
    if (!c) return {}
    const d = this.defaults
    const o = {}
    if (c.bold) o.bold = true
    if (c.italic) o.italic = true
    if (c.underline) o.underline = { SOLID: 'single', DOUBLE: 'double', DOUBLE_SLIM: 'double', DOT: 'dotted', DASH: 'dash', LONG_DASH: 'dash' }[c.underline] || 'single'
    if (c.strike) o.strike = true
    if (c.sup) o.sup = true
    if (c.sub) o.sub = true
    if (c.color && c.color.toUpperCase() !== d.color) o.color = c.color.toUpperCase()
    if (c.shade && c.shade.toUpperCase() !== '#FFFFFF') o.highlight = c.shade.toUpperCase()
    const size = c.h / 100
    if (Math.abs(size - d.sizePt) > 0.01) o.sizePt = size
    const ko = this.font('hangul', c.font.hangul)
    const latin = this.font('latin', c.font.latin)
    const f = {}
    if (ko && ko !== d.font.ko) f.ko = ko
    if (latin && latin !== d.font.latin) f.latin = latin
    if (Object.keys(f).length) o.font = f
    const ratio = num(c.ratio.hangul, 100)
    if (ratio !== 100) o.scalePct = ratio
    const sp = num(c.spacing.hangul, 0)
    if (sp !== 0) o.spacingPct = sp
    // 언어별로 다른 장평·자간·상대 크기·위치는 x.hwp 에 보존한다
    const hw = {}
    const diff = (obj, base, key) => {
      const langs = ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user']
      const vals = langs.map((l) => num(obj[l], base))
      if (vals.some((v) => v !== vals[0])) hw[key] = vals
    }
    diff(c.ratio, 100, 'ratio')
    diff(c.spacing, 0, 'spacing')
    diff(c.relSz, 100, 'relSz')
    diff(c.offset, 0, 'offset')
    if (num(c.relSz.hangul, 100) !== 100 && !hw.relSz) hw.relSzAll = num(c.relSz.hangul, 100)
    if (num(c.offset.hangul, 0) !== 0 && !hw.offset) hw.offsetAll = num(c.offset.hangul, 0)
    if (c.useKerning) hw.kerning = 1
    if (c.useFontSpace) hw.fontSpace = 1
    if (Object.keys(hw).length) o.x = { hwp: hw }
    return o
  }
  paraProps(pid, extra = {}) {
    const p = this.h.paraPrs[pid]
    if (!p) return {}
    const d = this.defaults
    const o = {}
    const al = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFY: 'justify', DISTRIBUTE: 'distribute', DISTRIBUTE_SPACE: 'distribute' }[p.align] || 'left'
    if (al !== d.align || extra.forceAlign) o.align = al
    if (p.left || p.right || p.intent) o.indent = { leftPt: round1(ptOf(p.left)), rightPt: round1(ptOf(p.right)), firstLinePt: round1(ptOf(p.intent)) }
    if (p.prev) o.spaceBeforePt = round1(ptOf(p.prev))
    if (p.next) o.spaceAfterPt = round1(ptOf(p.next))
    const ls = p.ls.type === 'PERCENT' ? { mode: 'percent', value: p.ls.value } : p.ls.type === 'FIXED' ? { mode: 'exactPt', value: ptOf(p.ls.value) } : p.ls.type === 'AT_LEAST' ? { mode: 'atLeastPt', value: ptOf(p.ls.value) } : { mode: 'percent', value: 100 }
    if (ls.mode !== d.lineSpacing.mode || Math.abs(ls.value - d.lineSpacing.value) > 0.01) o.lineSpacing = ls
    if (p.keepNext) o.keepNext = true
    if (p.keepLines) o.keepLines = true
    if (p.pbb) o.pageBreakBefore = true
    if (p.widow) o.widow = true
    if (p.heading.type === 'OUTLINE') o.heading = Math.min(6, p.heading.level + 1)
    // 한글에만 있는 줄 나눔 설정: 글자(KEEP_WORD, 한컴 기본)/어절(BREAK_WORD) 단위, 영문 자동 간격, 줄 맞춤 줄임(condense)은 쪽 수에 영향을 주므로 x.hwp 에 보존한다
    const hw = {}
    if (p.bs.breakLatinWord && p.bs.breakLatinWord !== 'KEEP_WORD') hw.breakLatin = p.bs.breakLatinWord
    if (p.bs.lineWrap && p.bs.lineWrap !== 'BREAK') hw.lineWrap = p.bs.lineWrap
    if (p.auto.eAsianEng === '1') hw.autoEng = 1
    if (p.auto.eAsianNum === '1') hw.autoNum = 1
    if (p.condense) hw.condense = p.condense
    if (p.snap === '0') hw.snap = 0
    const x = {}
    if (Object.keys(hw).length) x.hwp = hw
    // 한글의 "글자 단위"(KEEP_WORD, 한컴 기본)는 공통 힌트 breakByChar 로, "어절 단위"(BREAK_WORD)는 힌트 없음으로 적는다(워드 담당 README 추가 제안과 같은 뜻)
    if (p.bs.breakNonLatinWord === 'KEEP_WORD' || !p.bs.breakNonLatinWord) x.breakByChar = true
    if (Object.keys(x).length) o.x = x
    const bf = p.border && this.h.borderFills[p.border]
    if (bf?.fill) o.bg = bf.fill.toUpperCase()
    return o
  }
  // 자동 번호/글머리 -> 글자 부호(IR 규칙: 자동 번호를 쓰지 않는다)
  autoMarker(pid) {
    const p = this.h.paraPrs[pid]
    if (!p) return null
    const hd = p.heading
    if (hd.type === 'BULLET') {
      const b = this.h.bullets[hd.idRef]
      return b ? { kind: 'bullet', level: hd.level, marker: b.char } : null
    }
    if (hd.type === 'NUMBER' || hd.type === 'OUTLINE') {
      const nb = this.h.numberings[hd.idRef] || (hd.type === 'OUTLINE' ? this.h.numberings[this.outlineId] || this.h.numberings['1'] : null)
      if (!nb) return null
      const key = hd.idRef
      const cnt = (this.counters[key] ||= [])
      const lvl = hd.level + 1
      const head = nb.heads[lvl]
      if (!head) return null
      cnt[lvl] = cnt[lvl] == null ? head.start : cnt[lvl] + 1
      for (let k = lvl + 1; k <= 10; k++) cnt[k] = null
      if (!head.text) return null
      const text = head.text.replace(/\^(\d+)/g, (m, n) => {
        const h2 = nb.heads[+n]
        const v = cnt[+n] ?? h2?.start ?? 1
        return (NUM_FMT[h2?.fmt] || NUM_FMT.DIGIT)(v)
      })
      return { kind: 'ordered', level: hd.level, marker: text }
    }
    return null
  }

  // 그림 -> asset id
  asset(itemId) {
    if (this.assetByItem[itemId]) return this.assetByItem[itemId]
    const f = this.files.items[itemId]
    if (!f || !this.files.data[f.href]) return null
    const data = this.files.data[f.href]
    const mime = f.mime && f.mime.startsWith('image/') ? f.mime : sniffMime(data) || 'application/octet-stream'
    const px = imageSize(data, sniffMime(data) || mime) || { w: 100, h: 100 }
    const id = `img${Object.keys(this.assets).length + 1}`
    this.assets[id] = { mime, data, w: px.w, h: px.h }
    this.assetByItem[itemId] = id
    return id
  }

  // ── 문단 하나 -> 블록 목록 ──
  paragraph(p, ctxDef = {}) {
    const blocks = []
    const pid = p.a.paraPrIDRef
    const marker = this.autoMarker(pid)
    const base = this.paraProps(pid)
    let runs = []
    let objs = 0 // 문단 안 개체(그림 등) 수
    let hasText = false
    let link = null
    let hl = null
    const flushPara = (force) => {
      const props = { ...base }
      if (marker && !props.list) props.list = marker
      let rs = runs.filter(Boolean)
      if (!rs.length && !force) return
      if (!rs.length) {
        // 빈 문단도 줄 높이를 지키려고 글자 크기를 남긴다
        const first = kid(p, 'run')
        const cp = this.h.charPrs[first?.a.charPrIDRef ?? p.a.charPrIDRef]
        rs = cp && Math.abs(cp.h / 100 - this.defaults.sizePt) > 0.01 ? [{ sizePt: cp.h / 100 }] : []
      }
      blocks.push({ t: 'p', runs: rs, ...props })
      runs = []
    }
    const pushText = (text, cid) => {
      if (!text) return
      const props = this.runProps(cid)
      if (link) props.link = link
      if (hl) props.highlight = hl
      // 체크 글자는 check 로 분리한다(IR 규칙)
      const parts = text.split(/([\u2610\u2611\u2612])/)
      for (const part of parts) {
        if (!part) continue
        if (part === '\u2610' || part === '\u2611' || part === '\u2612') {
          const { bold, italic, color, sizePt } = props
          runs.push({ check: { checked: part !== '\u2610' }, ...(sizePt ? { sizePt } : {}), ...(color ? { color } : {}), ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) })
        } else {
          const last = runs[runs.length - 1]
          // 서식이 같은 이웃 글 조각은 합친다
          if (last && last.text !== undefined && !last.br && !last.tab && !last.check && sameProps(last, props)) last.text += part
          else runs.push({ text: part, ...props })
        }
      }
      hasText = true
    }
    const pushSpecial = (o) => runs.push(o)

    const walkT = (t, cid) => {
      for (const ch of t.c) {
        if (typeof ch === 'string') pushText(ch, cid)
        else if (ch.n === 'tab') pushSpecial({ tab: true, ...(link ? { link } : {}) })
        else if (ch.n === 'lineBreak') pushSpecial({ br: true })
        else if (ch.n === 'fwSpace' || ch.n === 'nbSpace') pushText(' ', cid)
        else if (ch.n === 'hyphen') pushText('-', cid)
        else if (ch.n === 'markpenBegin') hl = (ch.a.color || '#FFFF00').toUpperCase()
        else if (ch.n === 'markpenEnd') hl = null
        else if (ch.n === 'insertBegin' || ch.n === 'insertEnd' || ch.n === 'deleteEnd') continue
        else if (ch.n === 'deleteBegin') this.skip('deleteBegin')
      }
    }

    for (const run of p.c) {
      if (typeof run === 'string' || run.n !== 'run') continue
      const cid = run.a.charPrIDRef
      for (const ch of run.c) {
        if (typeof ch === 'string') continue
        switch (ch.n) {
          case 't': walkT(ch, cid); break
          case 'secPr': this.readSecPr(ch); break
          case 'ctrl': {
            for (const k of ch.c) {
              if (typeof k === 'string') continue
              if (k.n === 'secPr') this.readSecPr(k)
              else if (k.n === 'header' || k.n === 'footer') this.readHeaderFooter(k)
              else if (k.n === 'fieldBegin') {
                if (k.a.type === 'HYPERLINK') link = this.linkOf(k)
                else this.skip(`field:${k.a.type}`)
              } else if (k.n === 'fieldEnd') link = null
              else if (k.n === 'autoNum') {
                const t = k.a.numType
                if (t === 'PAGE') runs.push({ field: 'page' })
                else if (t === 'TOTAL_PAGE') runs.push({ field: 'pages' })
                else {
                  const f = kid(k, 'autoNumFormat')
                  pushText(`${f?.a.prefixChar || ''}${k.a.num || ''}${f?.a.suffixChar || ''}`, cid)
                }
              } else if (k.n === 'pageNum') this.pageNums.push(k.a)
              else if (k.n === 'colPr') {
                const cnt = num(k.a.colCount, 1)
                if (cnt > 1 && this.page) this.page.columns = { n: cnt, gapMm: round1(mmOf(num(k.a.sameGap))) }
              } else if (['newNum', 'pageHiding', 'pageNumCtrl', 'bookmark', 'indexmark'].includes(k.n)) continue
              else if (k.n === 'footNote' || k.n === 'endNote') this.skip(k.n)
              else this.skip(`ctrl:${k.n}`)
            }
            break
          }
          case 'tbl': {
            // 문단 안의 표는 문단 앞뒤로 갈라 블록으로 낸다
            flushPara(false)
            const tb = this.table(ch, p)
            if (tb) blocks.push(tb)
            objs++
            break
          }
          case 'pic': {
            const r = this.picture(ch, p)
            if (!r) { this.skip('pic'); break }
            if (r.floating) {
              flushPara(false)
              blocks.push(r.figure)
              objs++
            } else if (r.inline) {
              runs.push({ image: r.inline })
              objs++
            }
            break
          }
          case 'equation': this.skip('equation'); break
          case 'rect': case 'ellipse': case 'line': case 'arc': case 'polygon': case 'curve': case 'connectLine': case 'container': case 'ole': case 'chart': case 'video': case 'textart': case 'compose': case 'dutmal':
            this.skip(ch.n)
            break
          default:
            break
        }
      }
    }
    // 그림만 있는 문단 -> Figure(글자처럼 취급) 로 바꾼다
    const onlyInline = runs.length === 1 && runs[0].image && !hasText
    if (onlyInline) {
      const im = runs[0].image
      blocks.push({ t: 'figure', id: im.id, wPt: im.wPt, hPt: im.hPt, ...(base.align ? { align: base.align } : {}) })
      runs = []
    }
    const startedWithBlock = blocks.length > 0
    // 개체만 들어 있고 글이 없는 문단은 문단 자리를 남기지 않는다(표 앞뒤의 빈 줄과 구분하려고 글자가 없는 경우만)
    if (runs.length || (!objs && !startedWithBlock)) flushPara(true)
    if (p.a.pageBreak === '1' && blocks.length) blocks.unshift({ t: 'pagebreak' })
    // 문단 속 hp:t 가 없고 개체도 없으면 빈 문단이다
    return blocks
  }

  linkOf(fb) {
    const params = find(fb, 'stringParam')
    const path = params.find((x) => x.a.name === 'Path')
    if (path) return textOf(path)
    const cmd = params.find((x) => x.a.name === 'Command')
    if (cmd) return textOf(cmd).replace(/;\d+;\d+;\d+;?$/, '').replace(/\\(.)/g, '$1')
    return null
  }

  readSecPr(sp) {
    if (this.page) return
    const pp = kid(sp, 'pagePr')
    const mg = kid(pp, 'margin')?.a || {}
    const w = num(pp?.a.width, 59528)
    const h = num(pp?.a.height, 84186)
    const landscape = pp?.a.landscape === 'NARROWLY'
    const wMm = mmOf(w)
    const hMm = mmOf(h)
    const near = (a, b) => Math.abs(a - b) < 1.5
    let size
    const s = Math.min(wMm, hMm)
    const l = Math.max(wMm, hMm)
    if (near(s, 210) && near(l, 297)) size = 'A4'
    else if (near(s, 176) && near(l, 250)) size = 'B5'
    else if (near(s, 215.9) && near(l, 279.4)) size = 'Letter'
    else if (near(s, 297) && near(l, 420)) size = 'A3'
    else size = { wMm: round1(s), hMm: round1(l) }
    const top = num(mg.top)
    const hd = num(mg.header)
    const bottom = num(mg.bottom)
    const ft = num(mg.footer)
    this.page = {
      size,
      orientation: landscape ? 'landscape' : 'portrait',
      // 한글은 본문이 (위쪽 여백 + 머리말 높이) 에서 시작한다. IR 은 쪽 가장자리에서 본문까지(워드 방식)이므로 더해 준다. headerMm 은 머리말 띠 높이
      marginMm: { top: round1(mmOf(top + hd)), right: round1(mmOf(num(mg.right))), bottom: round1(mmOf(bottom + ft)), left: round1(mmOf(num(mg.left))) },
      headerMm: round1(mmOf(hd)), // 머리말 띠 높이(워드 담당 README 해석)
      footerMm: round1(mmOf(ft)),
    }
    const gut = num(mg.gutter)
    if (gut) this.page.gutterMm = round1(mmOf(gut))
    this.outlineId = sp.a.outlineShapeIDRef
  }

  readHeaderFooter(k) {
    const apply = k.a.applyPageType || 'BOTH'
    const target = k.n === 'header' ? 'header' : 'footer'
    if (this[target]) {
      if (apply !== 'BOTH') this.skip(`${target}:${apply}`)
      return
    }
    const sl = kid(k, 'subList')
    const blocks = this.subList(sl)
    if (blocks.length) this[target] = blocks
    if (apply !== 'BOTH') this.skip(`${target}:${apply}-only`)
  }

  subList(sl) {
    const out = []
    if (!sl) return out
    for (const p of kids(sl, 'p')) out.push(...this.paragraph(p, {}))
    return out
  }

  picture(pic, hostP) {
    const img = kid(pic, 'img')
    const itemId = img?.a.binaryItemIDRef
    const id = itemId && this.asset(itemId)
    if (!id) return null
    const sz = kid(pic, 'sz')?.a || {}
    const cur = kid(pic, 'curSz')?.a || {}
    const w = num(sz.width) || num(cur.width)
    const h = num(sz.height) || num(cur.height)
    const pos = kid(pic, 'pos')?.a || {}
    const alt = textOf(kid(pic, 'shapeComment')) || undefined
    const inline = pos.treatAsChar === '1'
    if (inline) return { inline: { id, wPt: round1(ptOf(w)), hPt: round1(ptOf(h)), ...(alt ? { alt } : {}) } }
    const wrapAttr = pic.a.textWrap
    const wrap = wrapAttr === 'SQUARE' || wrapAttr === 'TIGHT' || wrapAttr === 'THROUGH' ? 'square' : wrapAttr === 'TOP_AND_BOTTOM' ? 'topBottom' : 'none'
    const x = { LEFT: 'left', CENTER: 'center', RIGHT: 'right' }[pos.horzAlign] || 'left'
    const y = pos.vertRelTo === 'PAPER' || pos.vertRelTo === 'PAGE' ? 'top' : 'para'
    const fig = { t: 'figure', id, wPt: round1(ptOf(w)), hPt: round1(ptOf(h)), float: { x, y, wrap } }
    const offX = num(pos.horzOffset)
    const offY = num(pos.vertOffset)
    if (offX || offY) fig.x = { floatOffsetPt: { x: round1(ptOf(offX)), y: round1(ptOf(offY)) }, vertRelTo: pos.vertRelTo, horzRelTo: pos.horzRelTo }
    return { floating: true, figure: fig }
  }

  borderOf(side) {
    if (!side || side.type === 'NONE') return { style: 'none', widthPt: 0, color: '#000000' }
    const style = { SOLID: 'solid', DASH: 'dashed', LONG_DASH: 'dashed', DOT: 'dotted', DASH_DOT: 'dashed', DASH_DOT_DOT: 'dashed', DOUBLE_SLIM: 'double', SLIM_THICK: 'thick-thin', THICK_SLIM: 'thick-thin', SLIM_THICK_SLIM: 'double' }[side.type] || 'solid'
    return { style, widthPt: round1(U.mmToPt(side.widthMm) * 100) / 100, color: (side.color || '#000000').toUpperCase() }
  }

  table(tbl, hostP) {
    const rowCnt = num(tbl.a.rowCnt)
    const colCnt = num(tbl.a.colCnt)
    const tcs = []
    const trs = kids(tbl, 'tr')
    trs.forEach((tr, ri) => {
      for (const tc of kids(tr, 'tc')) {
        const addr = kid(tc, 'cellAddr')?.a || {}
        const span = kid(tc, 'cellSpan')?.a || {}
        const csz = kid(tc, 'cellSz')?.a || {}
        const mar = kid(tc, 'cellMargin')?.a
        tcs.push({
          tc,
          c: num(addr.colAddr),
          r: ri, // 한컴 저장본에 rowAddr 가 어긋난 표가 있어(실제 파일에서 확인) tr 순서를 믿는다
          cs: Math.max(1, num(span.colSpan, 1)),
          rs: Math.max(1, num(span.rowSpan, 1)),
          w: num(csz.width),
          h: num(csz.height),
          mar: tc.a.hasMargin === '1' && mar ? mar : null,
        })
      }
    })
    if (!tcs.length) return null
    const nCols = Math.max(colCnt, ...tcs.map((x) => x.c + x.cs))
    const nRows = Math.max(rowCnt, ...tcs.map((x) => x.r + x.rs))
    // 열 폭: 병합 없는 칸에서 먼저 얻고, 병합 칸으로 모자란 열을 채운다
    const colW = Array(nCols).fill(null)
    for (const x of tcs) if (x.cs === 1 && x.w > 0 && colW[x.c] == null) colW[x.c] = x.w
    for (let pass = 0; pass < nCols; pass++) {
      let changed = false
      for (const x of tcs) {
        if (x.cs < 2) continue
        const idx = Array.from({ length: x.cs }, (_, i) => x.c + i)
        const unk = idx.filter((i) => colW[i] == null)
        if (unk.length === 1) {
          colW[unk[0]] = Math.max(0, x.w - idx.filter((i) => colW[i] != null).reduce((a, i) => a + colW[i], 0))
          changed = true
        }
      }
      if (!changed) break
    }
    const still = colW.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0)
    if (still.length) {
      const total = num(kid(tbl, 'sz')?.a.width) || tcs.filter((x) => x.r === tcs[0].r).reduce((a, x) => a + x.w, 0)
      const known = colW.reduce((a, v) => a + (v || 0), 0)
      const each = Math.max(0, total - known) / still.length
      for (const i of still) colW[i] = each
    }
    const szW = num(kid(tbl, 'sz')?.a.width)
    let sum = colW.reduce((a, v) => a + v, 0)
    if (szW > 0 && Math.abs(sum - szW) > 100) {
      const f = szW / sum
      for (let i = 0; i < nCols; i++) colW[i] *= f
      sum = szW
    }
    const colPt = colW.map((v) => round1(ptOf(v)))
    const widthPt = round1(colPt.reduce((a, v) => a + v, 0))

    const inM = kid(tbl, 'inMargin')?.a
    const tablePad = inM ? { t: round1(ptOf(num(inM.top))), r: round1(ptOf(num(inM.right))), b: round1(ptOf(num(inM.bottom))), l: round1(ptOf(num(inM.left))) } : undefined

    // 칸 선: 가장 흔한 선을 표 기본 선으로 두고 다른 것만 칸에 적는다
    const bfOf = (tc) => this.h.borderFills[tc.a.borderFillIDRef] || null
    const sideKey = (b) => JSON.stringify(b)
    const freq = new Map()
    const cellBorders = new Map()
    for (const x of tcs) {
      const bf = bfOf(x.tc)
      const bs = { top: this.borderOf(bf?.t), right: this.borderOf(bf?.r), bottom: this.borderOf(bf?.b), left: this.borderOf(bf?.l) }
      cellBorders.set(x, bs)
      for (const s of Object.values(bs)) freq.set(sideKey(s), (freq.get(sideKey(s)) || 0) + 1)
    }
    let modeKey = null
    let modeN = 0
    for (const [k, n] of freq) if (n > modeN) { modeKey = k; modeN = n }
    const tblBorder = modeKey ? JSON.parse(modeKey) : { style: 'none', widthPt: 0, color: '#000000' }

    // 행 높이
    const rowH = Array(nRows).fill(0)
    for (const x of tcs) if (x.rs === 1) rowH[x.r] = Math.max(rowH[x.r], x.h)
    const rows = Array.from({ length: nRows }, () => ({ cells: [] }))
    tcs.sort((a, b) => a.r - b.r || a.c - b.c)
    for (const x of tcs) {
      const bf = bfOf(x.tc)
      const bs = cellBorders.get(x)
      const cell = { blocks: [] }
      if (x.cs > 1) cell.colspan = x.cs
      if (x.rs > 1) cell.rowspan = x.rs
      if (bf?.fill) cell.bg = bf.fill.toUpperCase()
      else if (bf?.complexFill) this.skip('cellFill:gradient/image')
      const sl = kid(x.tc, 'subList')
      const va = sl?.a.vertAlign
      cell.vAlign = va === 'CENTER' ? 'middle' : va === 'BOTTOM' ? 'bottom' : 'top'
      if (sl?.a.textDirection === 'VERTICAL') cell.textDir = 'vertical'
      if (x.mar) {
        const pad = { t: round1(ptOf(num(x.mar.top))), r: round1(ptOf(num(x.mar.right))), b: round1(ptOf(num(x.mar.bottom))), l: round1(ptOf(num(x.mar.left))) }
        if (!tablePad || pad.t !== tablePad.t || pad.r !== tablePad.r || pad.b !== tablePad.b || pad.l !== tablePad.l) cell.padPt = pad
      }
      const border = {}
      for (const [s, b] of Object.entries(bs)) if (sideKey(b) !== sideKey(tblBorder)) border[s] = b
      if (bf?.backSlash && bf.backSlash !== 'NONE') border.diagDown = this.borderOf(bf.diag)
      if (bf?.slash && bf.slash !== 'NONE') border.diagUp = this.borderOf(bf.diag)
      if (Object.keys(border).length) cell.border = border
      for (const p of kids(sl, 'p')) cell.blocks.push(...this.paragraph(p, {}))
      if (!cell.blocks.length) cell.blocks.push({ t: 'p', runs: [] })
      rows[x.r].cells.push(cell)
      if (tbl.a.repeatHeader === '1' && x.tc.a.header === '1' && x.r === 0) rows[0].header = true
    }
    rows.forEach((r, i) => {
      if (rowH[i] > 0) r.heightPt = round1(ptOf(rowH[i]))
    })
    const t = { t: 'table', widthPt, colPt, rows, border: tblBorder }
    if (tablePad) t.padPt = tablePad
    // 표 정렬: 글자처럼 취급이면 둘러싼 문단의 정렬, 아니면 개체 위치 속성
    const pos = kid(tbl, 'pos')?.a || {}
    if (pos.treatAsChar === '1') {
      const hp = this.h.paraPrs[hostP?.a.paraPrIDRef]
      const al = hp && { CENTER: 'center', RIGHT: 'right' }[hp.align]
      if (al) t.align = al
    } else {
      const al = { CENTER: 'center', RIGHT: 'right' }[pos.horzAlign]
      if (al) t.align = al
    }
    if (tbl.a.noAdjust) t.x = { noAdjust: tbl.a.noAdjust === '1' }
    return t
  }
}

function sameProps(a, b) {
  const ka = Object.keys(a).filter((k) => k !== 'text')
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

// 쪽 번호 컨트롤(hp:pageNum)을 머리말/꼬리말의 쪽 번호 문단으로 바꾼다
function pageNumParagraph(a) {
  const side = a.sideChar && a.sideChar !== ' ' ? a.sideChar : ''
  const runs = []
  if (side) runs.push({ text: `${side} ` })
  runs.push({ field: 'page' })
  if (side) runs.push({ text: ` ${side}` })
  const pos = a.pos || 'BOTTOM_CENTER'
  const align = pos.endsWith('LEFT') ? 'left' : pos.endsWith('RIGHT') ? 'right' : 'center'
  return { target: pos.startsWith('TOP') ? 'header' : 'footer', p: { t: 'p', runs, align, lineSpacing: { mode: 'percent', value: 100 } } }
}

// ───────────── 진입점 ─────────────
export async function readHwpx(bytes, opts = {}) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  const read = async (n) => zip.file(n)?.async('string')
  const hpfPath = names.find((n) => /(^|\/)content\.hpf$/i.test(n)) || 'Contents/content.hpf'
  const hpfXml = await read(hpfPath)
  if (!hpfXml) throw new Error('content.hpf 가 없습니다. 한글(HWPX) 파일이 아닙니다')
  const hpf = parseXml(hpfXml)
  const pkg = kid(hpf, 'package')
  const items = {}
  for (const it of find(pkg, 'item')) items[it.a.id] = { href: it.a.href, mime: it['a']['media-type'] }
  const spine = find(pkg, 'itemref').map((x) => x.a.idref)
  const sectionIds = spine.filter((id) => /section/i.test(items[id]?.href || '') || /section/i.test(id))
  const secPaths = (sectionIds.length ? sectionIds.map((id) => items[id].href) : names.filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort())
  const headerPath = items.header?.href || names.find((n) => /header\.xml$/i.test(n)) || 'Contents/header.xml'
  const headXml = await read(headerPath)
  if (!headXml) throw new Error('header.xml 이 없습니다')
  const head = readHead(kid(parseXml(headXml), 'head'))

  const data = {}
  for (const id of Object.keys(items)) {
    const href = items[id].href
    if (href && /^BinData\//.test(href) && zip.file(href)) data[href] = await zip.file(href).async('uint8array')
  }
  const rd = new Reader(head, { items, data }, opts)

  // 문서 기본: 바탕글 스타일(0 번)
  const st0 = head.styles['0'] || Object.values(head.styles)[0]
  const c0 = head.charPrs[st0?.char ?? '0'] || Object.values(head.charPrs)[0] || { h: 1000, color: '#000000', font: {} }
  const p0 = head.paraPrs[st0?.para ?? '0'] || Object.values(head.paraPrs)[0]
  const ko = head.fonts.hangul?.[c0.font.hangul] || '함초롬바탕'
  const latin = head.fonts.latin?.[c0.font.latin] || ko
  const ls0 = p0?.ls?.type === 'PERCENT' ? { mode: 'percent', value: p0.ls.value } : { mode: 'percent', value: 160 }
  rd.defaults = {
    font: { ko, latin },
    sizePt: c0.h / 100,
    lineSpacing: ls0,
    color: (c0.color || '#000000').toUpperCase(),
    align: { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFY: 'justify', DISTRIBUTE: 'distribute' }[p0?.align] || 'left',
  }

  const body = []
  let first = true
  const sectionsTotal = secPaths.length
  for (const path of secPaths) {
    const xml = await read(path)
    if (!xml) continue
    const sec = kid(parseXml(xml), 'sec')
    if (!sec) continue
    if (!first) body.push({ t: 'pagebreak' })
    for (const p of kids(sec, 'p')) body.push(...rd.paragraph(p))
    first = false
  }
  // 구역 사이 쪽 나눔과 문단의 쪽 나눔이 겹치면 하나로 본다
  for (let i = body.length - 1; i > 0; i--) if (body[i].t === 'pagebreak' && body[i - 1].t === 'pagebreak') body.splice(i, 1)
  // 머리말 쪽 번호 컨트롤
  let header = rd.header
  let footer = rd.footer
  for (const a of rd.pageNums) {
    const { target, p } = pageNumParagraph(a)
    if (target === 'header') header = [...(header || []), p]
    else footer = [...(footer || []), p]
  }
  const title = textOf(find(pkg, 'title')[0]) || ''
  const metas = find(pkg, 'meta')
  const creator = textOf(metas.find((m) => m.a.name === 'creator')) || undefined
  const page = rd.page || { size: 'A4', orientation: 'portrait', marginMm: { top: 20, right: 20, bottom: 15, left: 20 } }
  const ir = {
    version: 1,
    meta: { title, ...(creator ? { author: creator } : {}) },
    page,
    defaults: rd.defaults,
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    body,
    assets: rd.assets,
    x: { source: 'hwpx', sections: sectionsTotal, skipped: rd.skipped },
  }
  return ir
}

export default readHwpx
