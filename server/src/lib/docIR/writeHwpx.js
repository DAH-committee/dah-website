// docIR -> 한글(HWPX, OWPML) 작성기. 마크다운을 거치지 않고 IR 에서 바로 XML 을 쓴다.
// 순수 ESM, 브라우저와 Node 양쪽에서 동작, 외부 의존은 jszip 뿐. 구조와 속성 값은 한컴이 저장한 실제 파일(hwpx-notes.md 의 근거 표)을 따른다.
// 골격(mimetype, container, content.hpf, secPr, 표/그림 요소 순서)은 kordoc(MIT, https://github.com/chrisryugj/kordoc) 생성기와 한컴 저장본을 대조해 만들었다.
import JSZip from '../hwp/jszip.js'
import { normalizeIR, pageDims, tableGrid, U } from './schema.js'

const NS_ALL =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
const HWPUNIT_NS = 'http://www.hancom.co.kr/hwpml/2016/HwpUnitChar'

// IR 글꼴 이름 -> 한컴 글꼴 이름. 한컴 컴퓨터에 없는 글꼴은 한컴이 열 때 대체하므로 이름은 그대로 두되, 흔한 영문 이름은 한글 이름으로 바꾼다.
export const FONT_ALIASES = {
  'malgun gothic': '맑은 고딕',
  batang: '바탕',
  gulim: '굴림',
  dotum: '돋움',
  gungsuh: '궁서',
  hyheadline: 'HY헤드라인M',
  'hy headline': 'HY헤드라인M',
  'hy헤드라인m': 'HY헤드라인M',
  'hamchorom batang': '함초롬바탕',
  'hamchorom dotum': '함초롬돋움',
  'apple sd gothic neo': '맑은 고딕',
  'ms gothic': 'MS Gothic',
  arial: 'Arial',
  'times new roman': 'Times New Roman',
  calibri: 'Calibri',
}

const esc = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const hu = (pt) => Math.round(pt * 100)
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))
const hex = (c, d = '#000000') => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c.toUpperCase() : d)
const jkey = (o) => JSON.stringify(o)

// ───────────── 등록부: 같은 값이면 같은 번호 ─────────────
class Registry {
  constructor(start = 0) {
    this.map = new Map()
    this.items = []
    this.start = start
  }
  add(obj) {
    const k = jkey(obj)
    let id = this.map.get(k)
    if (id === undefined) {
      id = this.start + this.items.length
      this.map.set(k, id)
      this.items.push(obj)
    }
    return id
  }
}

// 한컴이 허용하는 선 굵기(mm) 목록. IR pt 값을 가장 가까운 값으로 맞춘다
const BORDER_MM = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]
const BORDER_STR = ['0.1 mm', '0.12 mm', '0.15 mm', '0.2 mm', '0.25 mm', '0.3 mm', '0.4 mm', '0.5 mm', '0.6 mm', '0.7 mm', '1.0 mm', '1.5 mm', '2.0 mm', '3.0 mm', '4.0 mm', '5.0 mm']
function borderWidthStr(widthPt) {
  const mm = U.ptToMm(widthPt || 0.5)
  let bi = 0
  BORDER_MM.forEach((m, i) => {
    if (Math.abs(m - mm) < Math.abs(BORDER_MM[bi] - mm)) bi = i
  })
  return BORDER_STR[bi]
}
const BORDER_TYPE = { none: 'NONE', solid: 'SOLID', dashed: 'DASH', dotted: 'DOT', double: 'DOUBLE_SLIM', 'thick-thin': 'THICK_SLIM' }

function borderXml(tag, b) {
  if (!b) return `<hh:${tag} type="NONE" width="0.1 mm" color="#000000"/>`
  return `<hh:${tag} type="${b.s}" width="${b.w}" color="${b.c}"/>`
}

// ───────────── 글자 크기 추정(표 높이 계산용. 한컴이 열 때 다시 계산하므로 근사면 충분) ─────────────
function charEm(ch) {
  const c = ch.codePointAt(0)
  if (c === 32) return 0.3
  if (c === 9) return 2
  if (c < 128) {
    if (/[0-9]/.test(ch)) return 0.58
    if (/[A-Z]/.test(ch)) return 0.68
    if (/[iljI.,:;'!|]/.test(ch)) return 0.32
    return 0.56
  }
  return 1.0
}

// 테두리 모양이 같으면 같은 번호가 되도록 키를 정규화한다(없는 선, style:none 은 모두 같은 "선 없음")
function normBf(o) {
  const side = (b) => (!b || b.style === 'none' ? null : { s: BORDER_TYPE[b.style] || 'SOLID', w: borderWidthStr(b.widthPt), c: hex(b.color) })
  const k = { n: 0, l: side(o.l), r: side(o.r), t: side(o.t), b: side(o.b), fill: o.fill && o.fill !== 'none' ? hex(o.fill) : 'none' }
  if (o.diag) k.diag = { down: !!o.diag.down, up: !!o.diag.up, line: side(o.diag.line) || { s: 'SOLID', w: '0.1 mm', c: '#000000' } }
  return k
}

// ───────────── 작성기 본체 ─────────────
class Ctx {
  constructor(ir, opts) {
    this.ir = ir
    this.opts = opts
    this.fonts = new Registry(0)
    this.borderFills = new Registry(1)
    this.bfAdd = (o) => this.borderFills.add(normBf(o))
    this.charPrs = new Registry(0)
    this.paraPrs = new Registry(0)
    this.assets = [] // { id, name, mime, data }
    this.assetIdx = new Map()
    this.seq = 1000000000
    this.fieldSeq = 1800000000
    this.page = pageGeometry(ir.page, opts)
    this.skipped = []
    // 번호 1: 선 없음(쪽 테두리·기본), 번호 2: 선 없음 + 채움 없음(글자/문단 기본). 한컴 저장본과 같은 순서
    this.borderFills.add({ n: 1 })
    this.bfAdd({})
    this.baseFontKo = this.fontName(ir.defaults.font.ko)
    this.baseFontLatin = this.fontName(ir.defaults.font.latin || ir.defaults.font.ko)
    this.baseChar = this.charKey({})
    this.baseCharId = this.charPrs.add(this.baseChar)
    this.basePara = this.paraKey({})
    this.baseParaId = this.paraPrs.add(this.basePara)
  }
  nextId() {
    return ++this.seq
  }
  fontName(n) {
    if (!n) return this.baseFontKo || '맑은 고딕'
    const k = String(n).toLowerCase()
    const map = { ...FONT_ALIASES, ...(this.opts?.fontMap || {}) }
    return map[k] || map[n] || n
  }
  fontId(name) {
    return this.fonts.add(name)
  }
  // 글자 서식 키. 같은 서식이면 같은 charPr 번호가 된다
  charKey(run, over = {}) {
    const d = this.ir.defaults
    const ko = this.fontName(over.fontKo || run.font?.ko || d.font.ko)
    const latin = this.fontName(over.fontLatin || run.font?.latin || d.font.latin || ko)
    const sym = over.fontSym ? this.fontName(over.fontSym) : ko
    const koId = this.fontId(ko)
    const latinId = this.fontId(latin)
    const symId = this.fontId(sym)
    const size = run.sizePt ?? over.sizePt ?? d.sizePt
    const ratio = clampInt(run.scalePct ?? 100, 50, 200)
    const spacing = clampInt(run.spacingPct ?? 0, -50, 50)
    return {
      h: clampInt(hu(size), 100, 100000),
      color: hex(run.color || over.color || d.color),
      f: [koId, latinId, koId, koId, latinId, symId, koId], // hangul latin hanja japanese other symbol user
      ratio,
      spacing,
      b: !!run.bold,
      i: !!run.italic,
      u: run.underline || null,
      s: !!run.strike,
      sup: !!run.sup,
      sub: !!run.sub,
      hw: run.x?.hwp || null,
    }
  }
  charId(run, over) {
    return this.charPrs.add(this.charKey(run, over))
  }
  paraKey(p, over = {}) {
    const d = this.ir.defaults
    const ind = p.indent || {}
    const ls = p.lineSpacing || over.lineSpacing || d.lineSpacing || { mode: 'percent', value: 160 }
    const bgId = p.bg ? this.bfAdd({ fill: hex(p.bg) }) : 2
    return {
      al: p.align || over.align || d.align || 'left',
      left: hu(over.leftPt ?? ind.leftPt ?? 0),
      right: hu(ind.rightPt ?? 0),
      intent: hu(over.firstLinePt ?? ind.firstLinePt ?? 0),
      prev: hu(p.spaceBeforePt ?? 0),
      next: hu(p.spaceAfterPt ?? 0),
      ls: { mode: ls.mode, value: ls.value },
      keepNext: !!p.keepNext,
      keepLines: !!p.keepLines,
      pbb: !!p.pageBreakBefore,
      widow: !!p.widow,
      bg: bgId,
      hw: p.x?.hwp || null,
      byChar: !!p.x?.breakByChar,
    }
  }
  paraId(p, over) {
    return this.paraPrs.add(this.paraKey(p, over))
  }
  asset(id) {
    if (this.assetIdx.has(id)) return this.assetIdx.get(id)
    const a = this.ir.assets?.[id]
    if (!a || !a.data) {
      this.skipped.push(`asset:${id}`)
      this.assetIdx.set(id, null)
      return null
    }
    const data = typeof a.data === 'string' ? b64ToBytes(a.data) : a.data
    const mime = a.mime || sniffMime(data)
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' }[mime]
    if (!ext) {
      this.skipped.push(`asset:${id}:${mime}`)
      this.assetIdx.set(id, null)
      return null
    }
    const n = this.assets.length + 1
    const px = (a.w && a.h) ? { w: a.w, h: a.h } : imageSize(data, mime) || { w: 100, h: 100 }
    const rec = { id, item: `image${n}`, name: `BinData/image${n}.${ext}`, mime: mime === 'image/jpg' ? 'image/jpeg' : mime, data, w: px.w, h: px.h }
    this.assets.push(rec)
    this.assetIdx.set(id, rec)
    return rec
  }
}

function b64ToBytes(s) {
  const clean = String(s).replace(/^data:[^,]*,/, '')
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'))
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function sniffMime(d) {
  if (d[0] === 0x89 && d[1] === 0x50) return 'image/png'
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg'
  if (d[0] === 0x47 && d[1] === 0x49) return 'image/gif'
  if (d[0] === 0x42 && d[1] === 0x4d) return 'image/bmp'
  return 'application/octet-stream'
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
  } catch { /* 크기를 모르면 기본값 */ }
  return null
}

// 쪽 설정: IR(쪽 가장자리 기준 본문 여백) -> 한글(위쪽 여백 + 머리말 높이가 본문 시작).
// 한컴 pagePr 에서 본문은 top+header 에서 시작하고 아래는 bottom+footer 앞에서 끝난다(실제 저장본 r24: 용지 84186 - top 4251 - header 2834 - footer 2834 - bottom 2834 = 본문 71433).
// IR.headerMm 은 README 추가 제안(워드 담당)대로 "본문 위 여백 안쪽에 있는 머리말 띠의 높이"로 읽는다: 한글 header = headerMm, 한글 top = marginMm.top - headerMm.
// 그러면 본문 시작(IR.top)과 머리말 글자가 시작하는 위치(IR.top - headerMm)가 워드와 같다. 머리말 내용이 headerMm 보다 길면 띠를 늘리고 위쪽 여백을 줄여 본문 시작을 지킨다(워드는 본문이 밀리지만 한글은 본문 시작을 고정).
function pageGeometry(page, opts = {}, content = {}) {
  const dims = pageDims(page)
  const m = page.marginMm
  const hdr = Math.max(0, Math.min(Math.max(page.headerMm ?? 10, content.headerMm || 0), m.top))
  const ftr = Math.max(0, Math.min(Math.max(page.footerMm ?? 10, content.footerMm || 0), m.bottom))
  const landscape = page.orientation === 'landscape'
  const shortSide = Math.min(dims.wMm, dims.hMm)
  const longSide = Math.max(dims.wMm, dims.hMm)
  // 흔한 용지는 한컴이 쓰는 정수 값을 그대로 쓴다(A4 는 59528 x 84186. mm 로 환산하면 84189 가 되어 한컴 저장본과 달라진다)
  const KNOWN = { '210x297': [59528, 84186], '297x420': [84186, 119055], '215.9x279.4': [61200, 79200] }
  const kn = KNOWN[`${shortSide}x${longSide}`]
  const wHU = kn ? kn[0] : U.mmToHwp(shortSide)
  const hHU = kn ? kn[1] : U.mmToHwp(longSide)
  const mHU = { left: U.mmToHwp(m.left), right: U.mmToHwp(m.right) }
  const bodyWHU = (landscape ? hHU : wHU) - mHU.left - mHU.right - U.mmToHwp(page.gutterMm || 0)
  const g = {
    // 한컴은 가로 용지도 width=짧은 변, height=긴 변으로 적고 landscape 속성으로 돌린다(실제 저장본: 제안서 피드백 정리, NARROWLY + 59528x84186)
    width: wHU,
    height: hHU,
    landscape: landscape ? 'NARROWLY' : 'WIDELY',
    top: U.mmToHwp(m.top - hdr),
    header: U.mmToHwp(hdr),
    bottom: U.mmToHwp(m.bottom - ftr),
    footer: U.mmToHwp(ftr),
    left: U.mmToHwp(m.left),
    right: U.mmToHwp(m.right),
    gutter: U.mmToHwp(page.gutterMm || 0),
    bodyWPt: U.mmToPt(dims.bodyWMm),
    bodyW: bodyWHU,
    headerH: U.mmToHwp(hdr),
    footerH: U.mmToHwp(ftr),
  }
  return g
}

// ───────────── 문단 ─────────────
const ALIGN = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFY', distribute: 'DISTRIBUTE' }

function lineSpacingXml(ls) {
  if (ls.mode === 'exactPt') return { type: 'FIXED', v: hu(ls.value) }
  if (ls.mode === 'atLeastPt') return { type: 'AT_LEAST', v: hu(ls.value) }
  return { type: 'PERCENT', v: clampInt(ls.value, 0, 500) }
}

function paraPrXml(id, k) {
  const ls = lineSpacingXml(k.ls)
  const hw = k.hw || {}
  const money = ls.type !== 'PERCENT'
  // 한컴 저장본은 문단 여백과 고정 줄 간격을 hp:switch 로 두 번 적는다. HwpUnitChar 이름공간을 아는 쪽은 hwpunit 값, 아니면 2배 값(옛 단위)을 읽는다
  const marginXml = (m) =>
    `<hh:margin><hc:intent value="${m * k.intent}" unit="HWPUNIT"/><hc:left value="${m * k.left}" unit="HWPUNIT"/><hc:right value="${m * k.right}" unit="HWPUNIT"/><hc:prev value="${m * k.prev}" unit="HWPUNIT"/><hc:next value="${m * k.next}" unit="HWPUNIT"/></hh:margin>`
  const lsXml = (m) => `<hh:lineSpacing type="${ls.type}" value="${money ? m * ls.v : ls.v}" unit="HWPUNIT"/>`
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="${hw.condense || 0}" fontLineHeight="0" snapToGrid="${hw.snap === 0 ? 0 : 1}" suppressLineNumbers="0" checked="0">` +
    `<hh:align horizontal="${ALIGN[k.al] || 'LEFT'}" vertical="BASELINE"/>` +
    `<hh:heading type="NONE" idRef="0" level="0"/>` +
    `<hh:breakSetting breakLatinWord="${hw.breakLatin || 'KEEP_WORD'}" breakNonLatinWord="${hw.breakNonLatin || (k.byChar ? 'KEEP_WORD' : 'BREAK_WORD')}" widowOrphan="${k.widow ? 1 : 0}" keepWithNext="${k.keepNext ? 1 : 0}" keepLines="${k.keepLines ? 1 : 0}" pageBreakBefore="${k.pbb ? 1 : 0}" lineWrap="${hw.lineWrap || 'BREAK'}"/>` +
    `<hh:autoSpacing eAsianEng="${hw.autoEng ? 1 : 0}" eAsianNum="${hw.autoNum ? 1 : 0}"/>` +
    `<hp:switch><hp:case hp:required-namespace="${HWPUNIT_NS}">${marginXml(1)}${lsXml(1)}</hp:case><hp:default>${marginXml(2)}${lsXml(2)}</hp:default></hp:switch>` +
    `<hh:border borderFillIDRef="${k.bg}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>` +
    `</hh:paraPr>`
  )
}

const UL_SHAPE = { single: 'SOLID', double: 'DOUBLE', dotted: 'DOT', dash: 'DASH' }
function charPrXml(id, k) {
  const [h, l, j, jp, o, s, u] = k.f
  const LG = ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user']
  const same = (n) => LG.map((g) => `${g}="${n}"`).join(' ')
  const per = (arr, n) => (Array.isArray(arr) && arr.length === 7 ? LG.map((g, i) => `${g}="${arr[i]}"`).join(' ') : same(n))
  const hw = k.hw || {}
  return (
    `<hh:charPr id="${id}" height="${k.h}" textColor="${k.color}" shadeColor="none" useFontSpace="${hw.fontSpace ? 1 : 0}" useKerning="${hw.kerning ? 1 : 0}" symMark="NONE" borderFillIDRef="2">` +
    `<hh:fontRef hangul="${h}" latin="${l}" hanja="${j}" japanese="${jp}" other="${o}" symbol="${s}" user="${u}"/>` +
    `<hh:ratio ${per(hw.ratio, k.ratio)}/>` +
    `<hh:spacing ${per(hw.spacing, k.spacing)}/>` +
    `<hh:relSz ${per(hw.relSz, hw.relSzAll ?? 100)}/>` +
    `<hh:offset ${per(hw.offset, hw.offsetAll ?? 0)}/>` +
    (k.i ? '<hh:italic/>' : '') +
    (k.b ? '<hh:bold/>' : '') +
    `<hh:underline type="${k.u ? 'BOTTOM' : 'NONE'}" shape="${UL_SHAPE[k.u] || 'SOLID'}" color="${k.color}"/>` +
    `<hh:strikeout shape="${k.s ? 'SOLID' : 'NONE'}" color="${k.color}"/>` +
    `<hh:outline type="NONE"/>` +
    `<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/>` +
    (k.sup ? '<hh:supscript/>' : '') +
    (k.sub ? '<hh:subscript/>' : '') +
    `</hh:charPr>`
  )
}

function borderFillXml(id, k) {
  if (id === 1) {
    return `<hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>${borderXml('leftBorder')}${borderXml('rightBorder')}${borderXml('topBorder')}${borderXml('bottomBorder')}<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>`
  }
  const d = k.diag
  const slash = d?.up ? 'CENTER' : 'NONE'
  const back = d?.down ? 'CENTER' : 'NONE'
  const dg = d?.line
  const fill = k.fill && k.fill !== 'none' ? `<hc:fillBrush><hc:winBrush faceColor="${k.fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : `<hc:fillBrush><hc:winBrush faceColor="none" hatchColor="#999999" alpha="0"/></hc:fillBrush>`
  return (
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    `<hh:slash type="${slash}" Crooked="0" isCounter="0"/><hh:backSlash type="${back}" Crooked="0" isCounter="0"/>` +
    borderXml('leftBorder', k.l) + borderXml('rightBorder', k.r) + borderXml('topBorder', k.t) + borderXml('bottomBorder', k.b) +
    (dg ? `<hh:diagonal type="${dg.s}" width="${dg.w}" color="${dg.c}"/>` : `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>`) +
    fill +
    `</hh:borderFill>`
  )
}

// ───────────── 본문 블록 -> XML ─────────────
function runsToXml(ctx, runs, pk) {
  // pk: { markerRun?, charOver }
  let out = ''
  let open = null // { cid, parts: [] } 서식이 같은 연속 글 조각
  const flush = () => {
    if (!open) return
    out += `<hp:run charPrIDRef="${open.cid}"><hp:t>${open.t}</hp:t></hp:run>`
    open = null
  }
  const pushText = (cid, xml, hl) => {
    if (open && (open.cid !== cid || open.hl !== hl)) flush()
    if (!open) open = { cid, t: '', hl }
    open.t += xml
  }
  let hlOpen = null
  const textXml = (s) => {
    let x = ''
    const parts = String(s).split(/(\n|\t)/)
    for (const p of parts) {
      if (p === '\n') x += '<hp:lineBreak/>'
      else if (p === '\t') x += '<hp:tab width="4000" leader="0" type="1"/>'
      else x += esc(p)
    }
    return x
  }
  for (const r of runs) {
    const over = { ...pk.charOver }
    if (r.check) {
      const cid = ctx.charId({ ...r, font: undefined }, { ...over, fontKo: ctx.opts.checkFont || '맑은 고딕', fontLatin: ctx.opts.checkFont || '맑은 고딕', fontSym: ctx.opts.checkFont || '맑은 고딕' })
      pushText(cid, r.check.checked ? '☑' : '☐', null)
      continue
    }
    const base = r.link && !r.color && !r.underline ? { ...r, color: '#0000FF', underline: 'single' } : r
    const cid = ctx.charId(base, over)
    const hl = r.highlight ? hex(r.highlight, '#FFFF00') : null
    if (r.link) {
      flush()
      const fid = ++ctx.fieldSeq
      const url = String(r.link)
      const cmd = url.replace(/[\\:;]/g, (c) => '\\' + c) + ';1;0;0;'
      out += `<hp:run charPrIDRef="${cid}"><hp:ctrl><hp:fieldBegin id="${fid}" type="HYPERLINK" name="" editable="0" dirty="1" zorder="-1" fieldid="627600491"><hp:parameters cnt="6" name=""><hp:integerParam name="Prop">0</hp:integerParam><hp:stringParam name="Command">${esc(cmd)}</hp:stringParam><hp:stringParam name="Path">${esc(url)}</hp:stringParam><hp:stringParam name="Category">HWPHYPERLINK_TYPE_URL</hp:stringParam><hp:stringParam name="TargetType">HWPHYPERLINK_TARGET_BOOKMARK</hp:stringParam><hp:stringParam name="DocOpenType">HWPHYPERLINK_JUMP_CURRENTTAB</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl></hp:run>`
      out += `<hp:run charPrIDRef="${cid}"><hp:t>${hl ? `<hp:markpenBegin color="${hl}"/>` : ''}${textXml(r.text ?? '')}${hl ? '<hp:markpenEnd/>' : ''}</hp:t></hp:run>`
      out += `<hp:run charPrIDRef="${cid}"><hp:ctrl><hp:fieldEnd beginIDRef="${fid}" fieldid="627600491"/></hp:ctrl></hp:run>`
      continue
    }
    if (r.image) {
      flush()
      const rec = ctx.asset(r.image.id)
      if (rec) out += `<hp:run charPrIDRef="${cid}">${picXml(ctx, rec, hu(r.image.wPt), hu(r.image.hPt), { inline: true }, r.image.alt)}<hp:t/></hp:run>`
      continue
    }
    if (r.field === 'pages' && ctx.opts.pagesField === 'text') {
      pushText(cid, '1', null)
      continue
    }
    if (r.field === 'page' || r.field === 'pages') {
      flush()
      out += `<hp:run charPrIDRef="${cid}"><hp:ctrl><hp:autoNum num="1" numType="${r.field === 'page' ? 'PAGE' : 'TOTAL_PAGE'}"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl></hp:run>`
      continue
    }
    if (r.field === 'date') {
      const d = new Date()
      pushText(cid, esc(`${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`), null)
      continue
    }
    let txt = ''
    if (r.text) txt += textXml(r.text)
    if (r.br) txt += '<hp:lineBreak/>'
    if (r.tab) txt += '<hp:tab width="4000" leader="0" type="1"/>'
    if (!txt) continue
    // 줄바꿈과 탭은 앞 글 조각의 같은 hp:t 안에 붙인다(한컴 저장본처럼). 서식이 달라도 앞 조각이 있으면 거기에 붙는다
    if (!r.text && open && !hl) { open.t += txt; continue }
    if (hl) txt = `<hp:markpenBegin color="${hl}"/>${txt}<hp:markpenEnd/>`
    pushText(cid, txt, hl)
  }
  flush()
  return out
}

function markerRun(ctx, p) {
  if (!p.list?.marker) return null
  const first = p.runs.find((r) => r.text || r.check || r.image)
  const base = first ? { ...first, text: undefined, link: undefined, image: undefined, check: undefined, highlight: undefined, underline: undefined, strike: undefined } : {}
  return { ...base, text: `${p.list.marker} ` }
}

// 항목 부호가 있고 내어쓰기가 없으면 부호 폭만큼 내어쓴다(워드의 hanging 과 같게). 부호가 없는 목록은 단계별로 들여쓴다
function listOver(ctx, p) {
  if (!p.list || p.indent) return {}
  const size = p.runs.find((r) => r.sizePt)?.sizePt || ctx.ir.defaults.sizePt
  if (p.list.marker) {
    const w = [...(p.list.marker + ' ')].reduce((a, ch) => a + charEm(ch), 0) * size
    return { leftPt: (p.list.level || 0) * size * 1.2 + w, firstLinePt: -w }
  }
  return { leftPt: (p.list.level || 0) * ctx.ir.defaults.sizePt * 1.5 }
}

function paragraphXml(ctx, p, o = {}) {
  const mark = markerRun(ctx, p)
  const runs = mark ? [mark, ...p.runs] : p.runs
  const over = listOver(ctx, p)
  const pid = ctx.paraId(p, { ...over, ...(o.paraOver || {}) })
  const empty = !runs.some((r) => r.text || r.br || r.tab || r.image || r.field || r.check)
  const sizeRun = p.runs.find((r) => r.sizePt)
  const markPt = sizeRun?.sizePt ?? p.x?.markSizePt
  const emptyCid = ctx.charId(markPt ? { sizePt: markPt } : {}, o.charOver || {})
  const body = runsToXml(ctx, runs, { charOver: o.charOver || {} })
  const pre = o.pre || ''
  const firstRunAttr = emptyCid
  const content = body || `<hp:run charPrIDRef="${firstRunAttr}"/>`
  return `<hp:p id="0" paraPrIDRef="${pid}" styleIDRef="${o.styleId || 0}" pageBreak="0" columnBreak="0" merged="0">${pre}${content}</hp:p>`
}

function picXml(ctx, rec, wHU, hHU, mode, alt) {
  const id = ctx.nextId()
  const w = Math.max(1, wHU)
  const h = Math.max(1, hHU)
  const ow = rec.w * 75
  const oh = rec.h * 75 // 96dpi 한 픽셀 = 0.75pt = 75 hwpunit (한컴 저장본 orgSz/그림 픽셀 수 비율 75.1)
  let pos
  let wrap = 'TOP_AND_BOTTOM'
  if (mode.inline) {
    pos = `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
  } else {
    const f = mode.float
    wrap = f.wrap === 'square' ? 'SQUARE' : f.wrap === 'topBottom' ? 'TOP_AND_BOTTOM' : 'IN_FRONT_OF_TEXT'
    const horz = { left: 'LEFT', center: 'CENTER', right: 'RIGHT' }[f.x] || 'LEFT'
    const offX = hu(mode.offsetPt?.x || 0)
    const offY = hu(mode.offsetPt?.y ?? 0)
    // y:'top' 은 용지 위 가장자리에서 머리말 위치만큼(로고가 앉는 자리), y:'para' 는 이 그림이 달린 문단 기준
    if (f.y === 'top') {
      pos = `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAGE" vertAlign="TOP" horzAlign="${horz}" vertOffset="${mode.offsetPt?.y != null ? offY : ctx.page.top}" horzOffset="${offX}"/>`
    } else {
      pos = `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="${horz}" vertOffset="${offY}" horzOffset="${offX}"/>`
    }
  }
  const sx = ow ? (w / ow).toFixed(6) : '1'
  const sy = oh ? (h / oh).toFixed(6) : '1'
  return (
    `<hp:pic id="${id}" zOrder="${id - 1000000000}" numberingType="PICTURE" textWrap="${wrap}" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id + 1}" reverse="0">` +
    `<hp:offset x="0" y="0"/><hp:orgSz width="${ow}" height="${oh}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/>` +
    `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="${sx}" e2="0" e3="0" e4="0" e5="${sy}" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${ow}" y="0"/><hc:pt2 x="${ow}" y="${oh}"/><hc:pt3 x="0" y="${oh}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${ow}" top="0" bottom="${oh}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${ow}" dimheight="${oh}"/>` +
    `<hc:img binaryItemIDRef="${rec.item}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>` +
    `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
    pos +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    (alt ? `<hp:shapeComment>${esc(alt)}</hp:shapeComment>` : '') +
    `</hp:pic>`
  )
}

// ───────────── 표 ─────────────
const DEF_PAD = { t: 1.4, r: 5.1, b: 1.4, l: 5.1 } // 한컴 표 기본 칸 여백 141/510 hwpunit
function sideWidth(b) {
  return b && b.style !== 'none' ? b.widthPt || 0.5 : 0
}

function estimateParaHeightPt(ctx, p, widthPt) {
  const size = p.runs.find((r) => r.sizePt)?.sizePt || ctx.ir.defaults.sizePt
  const ls = p.lineSpacing || ctx.ir.defaults.lineSpacing || { mode: 'percent', value: 160 }
  const lineH = ls.mode === 'percent' ? (size * ls.value) / 100 : ls.value
  const lo = listOver(ctx, p)
  const indent = (p.indent?.leftPt ?? lo.leftPt ?? 0) + (p.indent?.rightPt || 0)
  const avail = Math.max(10, (widthPt - indent) * 0.95) // 글꼴이 바뀌어도 줄이 모자라게 잡히지 않도록 5% 여유
  let lines = 1
  let x = 0
  const full = (p.list?.marker ? p.list.marker + ' ' : '') + p.runs.map((r) => (r.text || '') + (r.check ? '☐' : '') + (r.field ? '00' : '')).join('')
  for (const ch of full) {
    if (ch === '\n') { lines++; x = 0; continue }
    const w = charEm(ch) * size
    if (x + w > avail && x > 0) { lines++; x = w } else x += w
  }
  for (const r of p.runs) if (r.br) lines++
  const imgH = Math.max(0, ...p.runs.map((r) => r.image?.hPt || 0))
  return Math.max(lines * lineH, imgH) + (p.spaceBeforePt || 0) + (p.spaceAfterPt || 0)
}

function estimateBlocksHeightPt(ctx, blocks, widthPt) {
  let h = 0
  for (const b of blocks) {
    if (b.t === 'p') h += estimateParaHeightPt(ctx, b, widthPt)
    else if (b.t === 'table') h += estimateTable(ctx, b).heightPt
    else if (b.t === 'figure') h += b.hPt || 0
  }
  return h
}

// 표 한 개의 행 높이(pt)와 칸 크기를 계산한다
function estimateTable(ctx, t) {
  const g = tableGrid(t)
  const nRows = t.rows.length
  const tablePad = { ...DEF_PAD, ...(t.padPt || {}) }
  const rowH = t.rows.map((r) => r.heightPt || 0)
  const need = Array(nRows).fill(0)
  const spans = []
  t.rows.forEach((r, ri) => {
    let c = 0
    r.cells.forEach((cell) => {
      while (g.grid[ri]?.[c] && !g.grid[ri][c].anchor) c++
      const cs = cell.colspan || 1
      const rs = cell.rowspan || 1
      const w = t.colPt.slice(c, c + cs).reduce((a, x) => a + x, 0)
      const pad = { ...tablePad, ...(cell.padPt || {}) }
      const hh = estimateBlocksHeightPt(ctx, cell.blocks, Math.max(10, w - pad.l - pad.r)) + pad.t + pad.b
      if (rs === 1) need[ri] = Math.max(need[ri], hh)
      else spans.push({ ri, rs, hh })
      c += cs
    })
  })
  const rows = rowH.map((h, i) => Math.max(h || 0, need[i]) || need[i] || 14)
  for (const s of spans) {
    const have = rows.slice(s.ri, s.ri + s.rs).reduce((a, x) => a + x, 0)
    if (have < s.hh) rows[s.ri + s.rs - 1] += s.hh - have
  }
  return { rows, heightPt: rows.reduce((a, x) => a + x, 0) }
}

// 칸 사이 겹치는 선은 굵은 쪽을 쓴다(워드의 충돌 규칙과 같다). 그래야 양쪽이 같은 선으로 그려진다
function effectiveBorders(t, g) {
  const nR = g.nRows
  const nC = g.nCols
  const cellAt = (r, c) => {
    const e = g.grid[r][c]
    return t.rows[e.ri].cells[e.ki]
  }
  const get = (cell, side) => (cell.border && Object.prototype.hasOwnProperty.call(cell.border, side) ? cell.border[side] : t.border)
  const pick = (a, b) => {
    const wa = sideWidth(a)
    const wb = sideWidth(b)
    if (wa === 0 && wb === 0) return a || b
    return wb > wa ? b : a
  }
  const eff = new Map() // 'ri:ki' -> {t,r,b,l}
  for (let r = 0; r < nR; r++) {
    for (let c = 0; c < nC; c++) {
      const e = g.grid[r][c]
      if (!e.anchor) continue
      const cell = cellAt(r, c)
      const cs = cell.colspan || 1
      const rs = cell.rowspan || 1
      let top = get(cell, 'top')
      let bottom = get(cell, 'bottom')
      let left = get(cell, 'left')
      let right = get(cell, 'right')
      // 위, 아래 이웃(칸 폭 안의 모든 이웃과 견준다)
      if (r > 0) for (let k = c; k < c + cs; k++) top = pick(top, get(cellAt(r - 1, k), 'bottom'))
      if (r + rs < nR) for (let k = c; k < c + cs; k++) bottom = pick(bottom, get(cellAt(r + rs, k), 'top'))
      if (c > 0) for (let k = r; k < r + rs; k++) left = pick(left, get(cellAt(k, c - 1), 'right'))
      if (c + cs < nC) for (let k = r; k < r + rs; k++) right = pick(right, get(cellAt(k, c + cs), 'left'))
      eff.set(`${r}:${e.ki}`, { t: top, r: right, b: bottom, l: left })
    }
  }
  return eff
}

function tableXml(ctx, t, depth = 0) {
  const g = tableGrid(t)
  if (g.error) {
    ctx.skipped.push(`table:${g.error}`)
    return paragraphXml(ctx, { t: 'p', runs: [{ text: `[표를 쓸 수 없음: ${g.error}]` }] })
  }
  const est = estimateTable(ctx, t)
  const colHU = t.colPt.map(hu)
  const widthHU = colHU.reduce((a, x) => a + x, 0)
  const rowHU = est.rows.map(hu)
  const heightHU = rowHU.reduce((a, x) => a + x, 0)
  const pad = { ...DEF_PAD, ...(t.padPt || {}) }
  const eff = effectiveBorders(t, g)
  const tblBf = ctx.bfAdd({ l: t.border, r: t.border, t: t.border, b: t.border })
  const tblId = ctx.nextId()
  const hasHeader = t.rows[0]?.header
  const colAcc = [0]
  for (const w of colHU) colAcc.push(colAcc[colAcc.length - 1] + w)
  let trs = ''
  t.rows.forEach((row, ri) => {
    let tcs = ''
    row.cells.forEach((cell, ki) => {
      // 앵커 위치 찾기
      let cAddr = -1
      for (let c = 0; c < g.nCols; c++) {
        const e = g.grid[ri][c]
        if (e.anchor && e.ki === ki) { cAddr = c; break }
      }
      const cs = cell.colspan || 1
      const rs = cell.rowspan || 1
      const wHU = colAcc[cAddr + cs] - colAcc[cAddr]
      const hHU = rowHU.slice(ri, ri + rs).reduce((a, x) => a + x, 0)
      const cp = { ...pad, ...(cell.padPt || {}) }
      const e = eff.get(`${ri}:${ki}`)
      const diag = cell.border?.diagDown || cell.border?.diagUp
      const bfKey = { l: e.l, r: e.r, t: e.t, b: e.b, fill: cell.bg ? hex(cell.bg) : 'none' }
      if (diag) bfKey.diag = { down: !!cell.border.diagDown, up: !!cell.border.diagUp, line: cell.border.diagDown || cell.border.diagUp }
      const bf = ctx.bfAdd(bfKey)
      const blocks = cell.blocks?.length ? cell.blocks : [{ t: 'p', runs: [] }]
      const inner = blocksXml(ctx, blocks, { cellWidthPt: wHU / 100 - cp.l - cp.r, depth: depth + 1 }).join('')
      const va = { top: 'TOP', middle: 'CENTER', bottom: 'BOTTOM' }[cell.vAlign] || 'TOP'
      tcs +=
        `<hp:tc name="" header="${row.header ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
        `<hp:subList id="" textDirection="${cell.textDir === 'vertical' ? 'VERTICAL' : 'HORIZONTAL'}" lineWrap="BREAK" vertAlign="${va}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>` +
        `<hp:cellAddr colAddr="${cAddr}" rowAddr="${ri}"/><hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/><hp:cellSz width="${wHU}" height="${hHU}"/>` +
        `<hp:cellMargin left="${hu(cp.l)}" right="${hu(cp.r)}" top="${hu(cp.t)}" bottom="${hu(cp.b)}"/></hp:tc>`
    })
    trs += `<hp:tr>${tcs}</hp:tr>`
  })
  return (
    `<hp:tbl id="${tblId}" zOrder="${tblId - 1000000000}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${hasHeader ? 1 : 0}" rowCnt="${g.nRows}" colCnt="${g.nCols}" cellSpacing="0" borderFillIDRef="${tblBf}" noAdjust="1">` +
    `<hp:sz width="${widthHU}" widthRelTo="ABSOLUTE" height="${heightHU}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:inMargin left="${hu(pad.l)}" right="${hu(pad.r)}" top="${hu(pad.t)}" bottom="${hu(pad.b)}"/>` +
    trs +
    `</hp:tbl>`
  )
}

// 블록 목록 -> 문단 XML 조각 목록. 쪽 나눔 블록은 다음 문단의 pageBreak 속성으로 쓴다(한컴은 쪽을 나누는 문단이 새 쪽의 첫 문단).
// 뒤에 아무것도 없거나 쪽 나눔이 이어지면 빈 문단에 단다.
function blocksXml(ctx, blocks, o) {
  const parts = []
  let pending = false
  for (const b of blocks) {
    if (b.t === 'pagebreak') {
      if (pending) parts.push(blockXml(ctx, b, o))
      pending = true
      continue
    }
    let x = blockXml(ctx, b, o)
    if (pending && x) x = x.replace(/^(<hp:p [^>]*?)pageBreak="0"/, '$1pageBreak="1"')
    if (x) {
      pending = false
      parts.push(x)
    }
  }
  if (pending) parts.push(blockXml(ctx, { t: 'pagebreak' }, o))
  return parts
}

function blockXml(ctx, b, o = {}) {
  if (b.t === 'p') return paragraphXml(ctx, b, o)
  if (b.t === 'pagebreak') return `<hp:p id="0" paraPrIDRef="${ctx.baseParaId}" styleIDRef="0" pageBreak="1" columnBreak="0" merged="0"><hp:run charPrIDRef="${ctx.baseCharId}"/></hp:p>`
  if (b.t === 'table') {
    const al = b.align || 'left'
    const pid = ctx.paraPrs.add(ctx.paraKey({ align: al, lineSpacing: { mode: 'percent', value: 100 } }))
    return `<hp:p id="0" paraPrIDRef="${pid}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${ctx.baseCharId}">${tableXml(ctx, b, o.depth || 0)}<hp:t/></hp:run></hp:p>`
  }
  if (b.t === 'figure') {
    const rec = ctx.asset(b.id)
    let out = ''
    if (rec) {
      const w = hu(b.wPt)
      const h = hu(b.hPt)
      const mode = b.float ? { float: b.float, offsetPt: b.x?.floatOffsetPt } : { inline: true }
      const pid = ctx.paraPrs.add(ctx.paraKey({ align: b.float ? (ctx.ir.defaults.align || 'left') : b.align || 'center', lineSpacing: { mode: 'percent', value: 100 } }))
      out += `<hp:p id="0" paraPrIDRef="${pid}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${ctx.baseCharId}">${picXml(ctx, rec, w, h, mode, b.alt)}<hp:t/></hp:run></hp:p>`
    }
    if (b.caption) out += paragraphXml(ctx, b.caption, o)
    return out
  }
  ctx.skipped.push(`block:${b.t}`)
  return ''
}

// ───────────── 머리말, 꼬리말 ─────────────
function headerFooterXml(ctx, kind, blocks) {
  const g = ctx.page
  const h = kind === 'header' ? g.headerH : g.footerH
  const inner = blocksXml(ctx, blocks, { styleId: 1 }).join('') || paragraphXml(ctx, { t: 'p', runs: [] }, { styleId: 1 })
  return (
    `<hp:ctrl><hp:${kind} id="${kind === 'header' ? 1 : 2}" applyPageType="BOTH">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="${g.bodyW}" textHeight="${h}" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>` +
    `</hp:${kind}></hp:ctrl>`
  )
}

function secPrXml(ctx) {
  const g = ctx.page
  const cols = ctx.ir.page.columns
  return (
    `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
    `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
    `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
    `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
    `<hp:pagePr landscape="${g.landscape}" width="${g.width}" height="${g.height}" gutterType="LEFT_ONLY"><hp:margin header="${g.header}" footer="${g.footer}" gutter="${g.gutter}" left="${g.left}" right="${g.right}" top="${g.top}" bottom="${g.bottom}"/></hp:pagePr>` +
    `<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>` +
    `<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>` +
    ['BOTH', 'EVEN', 'ODD'].map((t) => `<hp:pageBorderFill type="${t}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`).join('') +
    `</hp:secPr>` +
    `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="${cols?.n || 1}" sameSz="1" sameGap="${cols?.n > 1 ? U.mmToHwp(cols.gapMm || 8) : 0}"/></hp:ctrl>`
  )
}

// ───────────── header.xml ─────────────
const FACE_LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']

function headerXml(ctx) {
  const fonts = ctx.fonts.items
  const fontface = FACE_LANGS.map(
    (l) => `<hh:fontface lang="${l}" fontCnt="${fonts.length}">${fonts.map((f, i) => `<hh:font id="${i}" face="${esc(f)}" type="TTF" isEmbedded="0"/>`).join('')}</hh:fontface>`
  ).join('')
  const bfs = ctx.borderFills.items.map((k, i) => borderFillXml(i + 1, k)).join('')
  const chars = ctx.charPrs.items.map((k, i) => charPrXml(i, k)).join('')
  const paras = ctx.paraPrs.items.map((k, i) => paraPrXml(i, k)).join('')
  const numHead = (lvl, fmt, txt) => `<hh:paraHead start="1" level="${lvl}" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="${fmt}" charPrIDRef="4294967295" checkable="${lvl >= 7 ? 1 : 0}">${txt}</hh:paraHead>`
  const numbering =
    `<hh:numbering id="1" start="0">` +
    [
      [1, 'DIGIT', '^1.'], [2, 'HANGUL_SYLLABLE', '^2.'], [3, 'DIGIT', '^3)'], [4, 'HANGUL_SYLLABLE', '^4)'], [5, 'DIGIT', '(^5)'], [6, 'HANGUL_SYLLABLE', '(^6)'],
      [7, 'CIRCLED_DIGIT', '^7'], [8, 'CIRCLED_HANGUL_SYLLABLE', '^8'],
    ].map(([l, f, t]) => numHead(l, f, t)).join('') +
    `<hh:paraHead start="1" level="9" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="HANGUL_JAMO" charPrIDRef="4294967295" checkable="0"/>` +
    `<hh:paraHead start="1" level="10" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="ROMAN_SMALL" charPrIDRef="4294967295" checkable="1"/>` +
    `</hh:numbering>`
  const styles =
    `<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="${ctx.baseParaId}" charPrIDRef="${ctx.baseCharId}" nextStyleIDRef="0" langID="1042" lockForm="0"/>` +
    `<hh:style id="1" type="PARA" name="머리말" engName="Header" paraPrIDRef="${ctx.baseParaId}" charPrIDRef="${ctx.baseCharId}" nextStyleIDRef="1" langID="1042" lockForm="0"/>`
  return (
    `${XML_DECL}<hh:head ${NS_ALL} version="1.31" secCnt="1">` +
    `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>` +
    `<hh:refList>` +
    `<hh:fontfaces itemCnt="7">${fontface}</hh:fontfaces>` +
    `<hh:borderFills itemCnt="${ctx.borderFills.items.length}">${bfs}</hh:borderFills>` +
    `<hh:charProperties itemCnt="${ctx.charPrs.items.length}">${chars}</hh:charProperties>` +
    `<hh:tabProperties itemCnt="3"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/><hh:tabPr id="1" autoTabLeft="1" autoTabRight="0"/><hh:tabPr id="2" autoTabLeft="0" autoTabRight="1"/></hh:tabProperties>` +
    `<hh:numberings itemCnt="1">${numbering}</hh:numberings>` +
    `<hh:bullets itemCnt="0"/>` +
    `<hh:paraProperties itemCnt="${ctx.paraPrs.items.length}">${paras}</hh:paraProperties>` +
    `<hh:styles itemCnt="2">${styles}</hh:styles>` +
    `</hh:refList>` +
    `<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>` +
    `<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>` +
    `<hh:trackchageConfig flags="56"/>` +
    `</hh:head>`
  )
}

function plainPreview(ir) {
  const lines = []
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.t === 'p') lines.push((b.list?.marker ? b.list.marker + ' ' : '') + b.runs.map((r) => (r.text || '') + (r.check ? (r.check.checked ? '☑' : '☐') : '')).join(''))
      else if (b.t === 'table') for (const r of b.rows) lines.push('<' + r.cells.map((c) => c.blocks.map((x) => (x.t === 'p' ? x.runs.map((y) => y.text || '').join('') : '')).join(' ')).join('><') + '>')
    }
  }
  walk(ir.body)
  return lines.join('\r\n').slice(0, 2000)
}

// ───────────── 진입점 ─────────────
export async function writeHwpx(irIn, opts = {}) {
  const { ir, issues } = normalizeIR(irIn)
  const ctx = new Ctx(ir, opts)
  {
    const bw = ctx.page.bodyWPt
    const hMm = ir.header?.length ? U.ptToMm(estimateBlocksHeightPt(ctx, ir.header.filter((b) => b.t !== 'figure' || !b.float), bw)) : 0
    const fMm = ir.footer?.length ? U.ptToMm(estimateBlocksHeightPt(ctx, ir.footer.filter((b) => b.t !== 'figure' || !b.float), bw)) : 0
    if (hMm > (ir.page.headerMm ?? 10) || fMm > (ir.page.footerMm ?? 10)) ctx.page = pageGeometry(ir.page, opts, { headerMm: hMm, footerMm: fMm })
  }

  // 본문을 먼저 만들어 등록부를 채운다
  const headerBlocks = ir.header?.length ? ir.header : null
  const footerBlocks = ir.footer?.length ? ir.footer : null
  const bodyBlocks = ir.body.length ? ir.body : [{ t: 'p', runs: [] }]
  const parts = blocksXml(ctx, bodyBlocks, {})
  if (!parts.length) parts.push(paragraphXml(ctx, { t: 'p', runs: [] }))
  const hdrXml = headerBlocks ? headerFooterXml(ctx, 'header', headerBlocks) : ''
  const ftrXml = footerBlocks ? headerFooterXml(ctx, 'footer', footerBlocks) : ''

  // 구역 속성(secPr), 머리말, 꼬리말은 첫 문단 맨 앞 run 에 들어간다. 첫 블록이 문단이면 그 문단 앞에 끼우고, 표나 그림이면 그 문단 안에서 run 을 앞에 붙인다
  const secRun = `<hp:run charPrIDRef="${ctx.baseCharId}">${secPrXml(ctx)}</hp:run>`
  const hfRun = hdrXml || ftrXml ? `<hp:run charPrIDRef="${ctx.baseCharId}">${hdrXml}${ftrXml}</hp:run>` : ''
  parts[0] = parts[0].replace(/^(<hp:p [^>]*>)/, `$1${secRun}${hfRun}`)

  const section = `${XML_DECL}<hs:sec ${NS_ALL}>${parts.join('')}</hs:sec>`
  const header = headerXml(ctx)

  const title = ir.meta?.title || ''
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const items =
    `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>` +
    ctx.assets.map((a) => `<opf:item id="${a.item}" href="${a.name}" media-type="${a.mime}" isEmbeded="1"/>`).join('') +
    `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
    `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>`
  const hpf =
    `${XML_DECL}<opf:package ${NS_ALL} version="" unique-identifier="" id="">` +
    `<opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language>` +
    `<opf:meta name="creator" content="text">${esc(ir.meta?.author || '')}</opf:meta>` +
    `<opf:meta name="CreatedDate" content="text">${esc(ir.meta?.created || now)}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta>` +
    `<opf:meta name="generator" content="text">디인예 워크스페이스 docIR</opf:meta></opf:metadata>` +
    `<opf:manifest>${items}</opf:manifest>` +
    `<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`

  const zip = new JSZip()
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' })
  zip.file(
    'version.xml',
    `${XML_DECL}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="10" xmlVersion="1.31" application="Hancom Office Hangul" appVersion="10.30.11.3422 MAC64LEDarwin_25.5.0"/>`
  )
  zip.file('settings.xml', `${XML_DECL}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`)
  zip.file(
    'META-INF/container.xml',
    `${XML_DECL}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/><ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/></ocf:rootfiles></ocf:container>`
  )
  zip.file('META-INF/manifest.xml', `${XML_DECL}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`)
  zip.file(
    'META-INF/container.rdf',
    `${XML_DECL}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description><rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>`
  )
  zip.file('Contents/content.hpf', hpf)
  zip.file('Contents/header.xml', header)
  zip.file('Contents/section0.xml', section)
  zip.file('Preview/PrvText.txt', plainPreview(ir))
  for (const a of ctx.assets) zip.file(a.name, a.data)
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/hwp+zip' })
  if (opts.report) {
    opts.report.issues = issues
    opts.report.skipped = ctx.skipped
    opts.report.counts = { fonts: ctx.fonts.items.length, charPr: ctx.charPrs.items.length, paraPr: ctx.paraPrs.items.length, borderFill: ctx.borderFills.items.length, assets: ctx.assets.length }
  }
  return out
}

export default writeHwpx
