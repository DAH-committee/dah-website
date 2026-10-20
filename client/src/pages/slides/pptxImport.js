// PPTX 가져오기: PowerPoint, Keynote, 구글 슬라이드가 내보낸 .pptx를 DAH Slides 내용 모양(SlidesEditor.jsx 맨 위 설명)으로 바꾼다.
//   const { slides, theme, skipped } = await importPptx(file, { uploadImage: async (blob, name) => url })
//   file: File | Blob | ArrayBuffer | Uint8Array. uploadImage가 없으면 작은 그림만 data: 주소로 넣는다(600KB까지).
//   opts.useTokens(기본 true): 테마 색(schemeClr)을 '@accent' 같은 토큰으로 둔다. 가져온 theme을 쓰지 않고
//   지금 발표에 슬라이드만 끼워 넣을 때는 false로 두면 원래 색 그대로 들어온다.
//
// 옮기는 것: 슬라이드 크기와 순서(1920x1080에 맞추고 4:3은 좌우 여백), 숨긴 슬라이드, 배경(색, 그라데이션은 첫 색, 그림),
//   글 상자(문단, 굵게·기울임·밑줄·취소선, 크기, 색, 글꼴, 링크, 글머리표·번호 목록과 수준, 정렬, 줄 간격, 세로 맞춤, 여백),
//   도형(사각형, 둥근 사각형, 타원, 삼각형, 오른쪽 화살표, 선·연결선과 화살촉, 채우기·그라데이션·선·점선·그림자·회전),
//   그림(자르기는 비슷한 위치로, 원·둥근 자르기, 투명도), 표(칸 글자, 머리 행, 머리 색), 묶음(chOff/chExt 변환, 회전),
//   자리 표시자(xfrm이 없으면 슬라이드 레이아웃→마스터에서 위치·글 모양을 찾는다), 레이아웃·마스터의 장식 도형,
//   테마 색(schemeClr + lumMod/lumOff/tint/shade/alpha)과 글꼴, 발표자 노트, 전환(페이드, 밀기, 모핑→매직 무브),
//   이름이 '!!'로 시작하는 요소(PowerPoint 모핑 짝)는 mid로.
// 건너뛰는 것(skipped에 개수): 차트, SmartArt, 동영상·소리, 브라우저가 못 그리는 그림(EMF·WMF·TIFF), 알 수 없는 모양,
//   OLE 개체, 애니메이션, 잉크. 글이 있는 알 수 없는 모양은 글 상자로 남기고 모양만 건너뛴다.
//
// DOMParser를 쓰지 않고 아래의 작은 XML 해석기를 쓴다. 그래서 브라우저와 Node(node --test)에서 똑같이 돈다.
import JSZip from 'jszip'
import { FONTS, SLIDE_H, SLIDE_W, escapeHtml, nid } from './deckCore.js'

// ── 작은 XML 해석기 ─────────────────────────────────────
// OOXML은 잘 짜인 XML이라 DTD 없이 태그·속성·글자·CDATA만 읽으면 된다. 노드: { n: 로컬 이름, q: 원래 이름, a: 속성, c: 자식(노드 또는 글자) }
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
          const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
          try {
            return String.fromCodePoint(cp)
          } catch {
            return ''
          }
        }
        return ENT[e] ?? m
      })
const local = (q) => {
  const i = q.indexOf(':')
  return i < 0 ? q : q.slice(i + 1)
}

export function parseXml(src) {
  const text = String(src || '')
  const root = { n: '#root', q: '#root', a: {}, c: [] }
  const stack = [root]
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.c.push(m[1])
    else if (m[2] !== undefined) {
      const name = local(m[2])
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].n === name) {
          stack.length = i
          break
        }
      }
    } else if (m[3] !== undefined) {
      const a = {}
      if (m[4]) {
        let am
        attrRe.lastIndex = 0
        while ((am = attrRe.exec(m[4]))) a[am[1]] = decode(am[2] ?? am[3] ?? '')
      }
      const node = { n: local(m[3]), q: m[3], a, c: [] }
      top.c.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined) {
      if (top.n === 't' || /\S/.test(m[6])) top.c.push(decode(m[6]))
    }
  }
  return root
}

const isNode = (x) => x && typeof x === 'object'
export const kids = (node, name) => (node ? node.c.filter((k) => isNode(k) && (!name || k.n === name)) : [])
export const kid = (node, name) => (node ? node.c.find((k) => isNode(k) && k.n === name) || null : null)
/** 경로로 찾기: path('spPr', 'xfrm') */
export const path = (node, ...names) => names.reduce((n, nm) => (n ? kid(n, nm) : null), node)
export function findAll(node, name, out = []) {
  if (!node) return out
  for (const k of node.c) {
    if (!isNode(k)) continue
    if (k.n === name) out.push(k)
    findAll(k, name, out)
  }
  return out
}
export const textOf = (node) => (!node ? '' : node.c.map((k) => (isNode(k) ? textOf(k) : k)).join(''))
const attr = (node, k, d) => (node && node.a[k] !== undefined ? node.a[k] : d)
const inum = (node, k, d) => {
  const v = attr(node, k)
  if (v === undefined || v === '') return d
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : d
}
const on = (v) => v === '1' || v === 'true' || v === 'on'

// ── 색 ──────────────────────────────────────────────────
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
const PRST_CLR = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080', navy: '000080', silver: 'C0C0C0' }

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (mx + mn) / 2
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}
function hslToRgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t) => {
    t = ((t % 1) + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

/** 색 노드(srgbClr, schemeClr, ...) → { hex: 'RRGGBB', alpha, scheme?: 이름(수정자가 없을 때만) } */
function readColorNode(cn, ctx) {
  if (!cn) return null
  let hex = null
  let scheme = null
  if (cn.n === 'srgbClr') hex = String(attr(cn, 'val', '')).toUpperCase()
  else if (cn.n === 'sysClr') hex = String(attr(cn, 'lastClr', attr(cn, 'val') === 'window' ? 'FFFFFF' : '000000')).toUpperCase()
  else if (cn.n === 'prstClr') hex = PRST_CLR[attr(cn, 'val')] || '000000'
  else if (cn.n === 'scrgbClr') hex = ['r', 'g', 'b'].map((k) => hex2((inum(cn, k, 0) / 100000) * 255)).join('').toUpperCase()
  else if (cn.n === 'hslClr') hex = hslToRgb(inum(cn, 'hue', 0) / 21600000, inum(cn, 'sat', 0) / 100000, inum(cn, 'lum', 0) / 100000).map(hex2).join('').toUpperCase()
  else if (cn.n === 'schemeClr') {
    let v = attr(cn, 'val')
    if (v === 'phClr') return ctx.phClr ? applyMods(ctx.phClr, cn) : null
    const mapped = ctx.clrMap?.[v] || v
    scheme = v
    hex = ctx.colors?.[mapped] || null
  }
  if (!hex || !/^[0-9A-F]{6}$/.test(hex)) return null
  const mods = kids(cn)
  const base = { hex, alpha: 1, scheme: mods.length ? null : scheme }
  return mods.length ? applyMods(base, cn) : base
}

function applyMods(c, cn) {
  let r = parseInt(c.hex.slice(0, 2), 16)
  let g = parseInt(c.hex.slice(2, 4), 16)
  let b = parseInt(c.hex.slice(4, 6), 16)
  let alpha = c.alpha ?? 1
  for (const m of kids(cn)) {
    const v = inum(m, 'val', 100000) / 100000
    if (m.n === 'alpha') alpha = v
    else if (m.n === 'alphaMod') alpha *= v
    else if (m.n === 'tint') [r, g, b] = [r, g, b].map((x) => x + (255 - x) * (1 - v))
    else if (m.n === 'shade') [r, g, b] = [r, g, b].map((x) => x * v)
    else if (m.n === 'lumMod' || m.n === 'lumOff' || m.n === 'satMod') {
      const [h, s, l] = rgbToHsl(r, g, b)
      const nl = m.n === 'lumMod' ? l * v : m.n === 'lumOff' ? l + v : l
      const ns = m.n === 'satMod' ? Math.min(1, s * v) : s
      ;[r, g, b] = hslToRgb(h, ns, Math.max(0, Math.min(1, nl)))
    } else if (m.n === 'inv') [r, g, b] = [255 - r, 255 - g, 255 - b]
    else if (m.n === 'gray') r = g = b = 0.3 * r + 0.59 * g + 0.11 * b
  }
  return { hex: (hex2(r) + hex2(g) + hex2(b)).toUpperCase(), alpha, scheme: null }
}

const COLOR_NODES = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']
const colorChild = (node) => (node ? node.c.find((k) => isNode(k) && COLOR_NODES.includes(k.n)) : null)
const SCHEME_TOKEN = { tx1: '@text', dk1: '@text', bg1: '@bg', lt1: '@bg', accent1: '@accent', accent2: '@accent2', bg2: '@surface', lt2: '@surface' }

/** 읽은 색 → 저장 값('#RRGGBB', '#RRGGBBAA', '@token') */
function colorValue(c, ctx) {
  if (!c) return null
  if (c.alpha <= 0.001) return null
  if (c.scheme && ctx.useTokens && SCHEME_TOKEN[c.scheme] && c.alpha >= 0.999) return SCHEME_TOKEN[c.scheme]
  return `#${c.hex}${c.alpha < 0.999 ? hex2(c.alpha * 255).toUpperCase() : ''}`
}
const solidColor = (fillNode, ctx) => colorValue(readColorNode(colorChild(fillNode), ctx), ctx)

// ── 묶음 변환 ───────────────────────────────────────────
// 변환: EMU 점 → 슬라이드 EMU 점. sx, sy: 누적 배율, rot: 누적 회전(도)
const IDENTITY = { map: (x, y) => [x, y], sx: 1, sy: 1, rot: 0 }

function readXfrm(x) {
  if (!x) return null
  const off = kid(x, 'off')
  const ext = kid(x, 'ext')
  if (!off || !ext) return null
  return {
    x: inum(off, 'x', 0), y: inum(off, 'y', 0), w: inum(ext, 'cx', 0), h: inum(ext, 'cy', 0),
    rot: inum(x, 'rot', 0) / 60000, flipH: on(attr(x, 'flipH')), flipV: on(attr(x, 'flipV')),
    chOff: kid(x, 'chOff'), chExt: kid(x, 'chExt'),
  }
}

function groupTransform(parent, xf) {
  if (!xf) return parent
  const chx = inum(xf.chOff, 'x', xf.x)
  const chy = inum(xf.chOff, 'y', xf.y)
  const chw = inum(xf.chExt, 'cx', xf.w) || 1
  const chh = inum(xf.chExt, 'cy', xf.h) || 1
  const sx = xf.w / chw || 1
  const sy = xf.h / chh || 1
  const cx = xf.x + xf.w / 2
  const cy = xf.y + xf.h / 2
  const t = (xf.rot * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  return {
    map: (px, py) => {
      let qx = xf.x + (px - chx) * sx
      let qy = xf.y + (py - chy) * sy
      if (xf.rot) {
        const dx = qx - cx
        const dy = qy - cy
        qx = cx + dx * cos - dy * sin
        qy = cy + dx * sin + dy * cos
      }
      return parent.map(qx, qy)
    },
    sx: parent.sx * sx,
    sy: parent.sy * sy,
    rot: parent.rot + xf.rot,
  }
}

// ── 문단·글자 속성 ──────────────────────────────────────
function readRPr(r, ctx) {
  if (!r) return {}
  const o = {}
  if (r.a.sz) o.sz = inum(r, 'sz', 1800)
  if (r.a.b !== undefined) o.b = on(r.a.b)
  if (r.a.i !== undefined) o.i = on(r.a.i)
  if (r.a.u !== undefined) o.u = r.a.u !== 'none'
  if (r.a.strike !== undefined) o.s = r.a.strike !== 'noStrike'
  if (r.a.cap !== undefined) o.cap = r.a.cap
  if (r.a.spc !== undefined) o.spc = inum(r, 'spc', 0)
  if (r.a.baseline !== undefined) o.baseline = inum(r, 'baseline', 0)
  const sf = kid(r, 'solidFill')
  if (sf) o.color = solidColor(sf, ctx)
  else if (kid(r, 'gradFill')) o.color = colorValue(readColorNode(colorChild(path(r, 'gradFill', 'gsLst', 'gs')), ctx), ctx)
  else if (kid(r, 'noFill')) o.color = null
  const latin = kid(r, 'latin') || kid(r, 'ea')
  if (latin && attr(latin, 'typeface')) o.font = attr(latin, 'typeface')
  const ea = kid(r, 'ea')
  if (ea && attr(ea, 'typeface') && !o.font) o.font = attr(ea, 'typeface')
  const hl = kid(r, 'hlinkClick')
  if (hl) {
    const rid = attr(hl, 'r:id') ?? attr(hl, 'id')
    const target = rid ? ctx.rels?.[rid] : null
    if (target && target.external) o.href = target.target
  }
  return o
}

function readPPr(p, ctx) {
  if (!p) return {}
  const o = {}
  if (p.a.algn) o.algn = p.a.algn
  if (p.a.marL !== undefined) o.marL = inum(p, 'marL', 0)
  if (p.a.indent !== undefined) o.indent = inum(p, 'indent', 0)
  if (kid(p, 'buNone')) o.bullet = { type: 'none' }
  else if (kid(p, 'buAutoNum')) o.bullet = { type: 'num', scheme: attr(kid(p, 'buAutoNum'), 'type', 'arabicPeriod') }
  else if (kid(p, 'buChar')) o.bullet = { type: 'char', char: attr(kid(p, 'buChar'), 'char', '•') }
  else if (kid(p, 'buBlip')) o.bullet = { type: 'char', char: '•' }
  const pct = path(p, 'lnSpc', 'spcPct')
  if (pct) o.lnSpc = inum(pct, 'val', 100000) / 100000
  const pts = path(p, 'lnSpc', 'spcPts')
  if (pts) o.lnPts = inum(pts, 'val', 0) / 100
  const aft = path(p, 'spcAft', 'spcPts')
  if (aft) o.spcAft = inum(aft, 'val', 0) / 100
  const bef = path(p, 'spcBef', 'spcPts')
  if (bef) o.spcBef = inum(bef, 'val', 0) / 100
  const def = kid(p, 'defRPr')
  if (def) o.rpr = readRPr(def, ctx)
  return o
}

const mergeP = (a, b) => ({ ...a, ...b, rpr: { ...(a.rpr || {}), ...(b.rpr || {}) } })

/** lstStyle 비슷한 노드(lvl1pPr..lvl9pPr) → 수준별 속성 */
function readLevels(node, ctx) {
  const out = []
  if (!node) return out
  for (let i = 0; i < 9; i++) {
    const l = kid(node, `lvl${i + 1}pPr`)
    out[i] = l ? readPPr(l, ctx) : null
  }
  return out
}

// ── 꾸러미(zip) 읽기 ────────────────────────────────────
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1)
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (dirOf(base) + target).split('/')
  const out = []
  for (const s of parts) {
    if (s === '..') out.pop()
    else if (s !== '.' && s !== '') out.push(s)
  }
  return out.join('/')
}
const relsPathOf = (p) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }

function bytesToDataUrl(bytes, mime) {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  const b64 = typeof btoa === 'function' ? btoa(bin) : globalThis.Buffer.from(bytes).toString('base64')
  return `data:${mime};base64,${b64}`
}

class Pkg {
  constructor(zip) {
    this.zip = zip
    this.xmlCache = new Map()
    this.relCache = new Map()
  }
  has(p) {
    return !!this.zip.file(p)
  }
  async xml(p) {
    if (!p) return null
    if (!this.xmlCache.has(p)) {
      const f = this.zip.file(p)
      this.xmlCache.set(p, f ? f.async('string').then(parseXml) : Promise.resolve(null))
    }
    return this.xmlCache.get(p)
  }
  /** rels → { rId: { target(절대 경로 또는 외부 주소), type, external } } */
  async rels(p) {
    if (!this.relCache.has(p)) {
      this.relCache.set(
        p,
        this.xml(relsPathOf(p)).then((doc) => {
          const out = {}
          for (const r of findAll(doc, 'Relationship')) {
            const external = attr(r, 'TargetMode') === 'External'
            const t = attr(r, 'Target', '')
            out[attr(r, 'Id')] = { target: external ? t : resolvePath(p, t), type: String(attr(r, 'Type', '')).split('/').pop(), external }
          }
          return out
        })
      )
    }
    return this.relCache.get(p)
  }
  async relOfType(p, type) {
    const rels = await this.rels(p)
    return Object.values(rels).find((r) => r.type === type)?.target || null
  }
}

// ── 테마 ────────────────────────────────────────────────
function readTheme(doc) {
  const colors = {}
  const cs = findAll(doc, 'clrScheme')[0]
  if (cs) {
    for (const k of kids(cs)) {
      const c = readColorNode(colorChild(k), { colors: {} })
      if (c) colors[k.n] = c.hex
    }
  }
  const fontOf = (nm) => {
    const f = findAll(doc, nm)[0]
    const latin = attr(kid(f, 'latin'), 'typeface', '')
    const ea = attr(kid(f, 'ea'), 'typeface', '')
    return latin || ea || ''
  }
  const fmt = findAll(doc, 'fmtScheme')[0]
  const lnWidths = kids(kid(fmt, 'lnStyleLst'), 'ln').map((l) => inum(l, 'w', 9525))
  return { colors, major: fontOf('majorFont'), minor: fontOf('minorFont'), lnWidths }
}

function readClrMap(node) {
  if (!node) return null
  const m = {}
  for (const [k, v] of Object.entries(node.a)) m[k] = v
  return m
}

const mix = (a, b, t) => {
  const p = (h, i) => parseInt(h.slice(i, i + 2), 16)
  return `#${[0, 2, 4].map((i) => hex2(p(a, i) * (1 - t) + p(b, i) * t)).join('').toUpperCase()}`
}

function deckTheme(th, clrMap) {
  const c = (k) => th.colors[clrMap?.[k] || k]
  const bg = c('bg1') || 'FFFFFF'
  const text = c('tx1') || '111111'
  const fontKey = (name) => {
    if (!name) return 'sans'
    const f = Object.values(FONTS).find((x) => x.office === name)
    return f ? f.id : name
  }
  return {
    id: 'pptx',
    name: '가져온 테마',
    fonts: { heading: fontKey(th.major), body: fontKey(th.minor) },
    colors: {
      bg: `#${bg}`, text: `#${text}`, accent: `#${th.colors.accent1 || '7A3CFF'}`, accent2: `#${th.colors.accent2 || text}`,
      muted: mix(text, bg, 0.42), surface: `#${c('bg2') || mix(bg, text, 0.06).slice(1)}`,
    },
  }
}

// ── 자리 표시자 ─────────────────────────────────────────
const phOf = (sp) => {
  const nv = kid(sp, 'nvSpPr') || kid(sp, 'nvPicPr') || kid(sp, 'nvGraphicFramePr') || kid(sp, 'nvCxnSpPr')
  return path(nv, 'nvPr', 'ph')
}
const phType = (ph) => attr(ph, 'type', 'body')
const TITLE_T = ['title', 'ctrTitle']
function samePh(a, b, strictIdx) {
  const ta = phType(a)
  const tb = phType(b)
  const ia = attr(a, 'idx')
  const ib = attr(b, 'idx')
  if (strictIdx && ia !== undefined && ib !== undefined && ia === ib) return true
  if (TITLE_T.includes(ta) && TITLE_T.includes(tb)) return true
  if (ta === tb && (ta !== 'body' && ta !== 'obj' ? true : !strictIdx || ia === undefined || ib === undefined)) return true
  return false
}
function findPh(tree, ph, strictIdx) {
  if (!tree || !ph) return null
  const list = findAll(tree, 'sp').concat(findAll(tree, 'pic'))
  const withPh = list.map((s) => [s, phOf(s)]).filter(([, p]) => p)
  const idx = attr(ph, 'idx')
  if (strictIdx && idx !== undefined) {
    const hit = withPh.find(([, p]) => attr(p, 'idx') === idx)
    if (hit) return hit[0]
  }
  const t = phType(ph)
  let hit = withPh.find(([, p]) => samePh(ph, p, false) && phType(p) === t)
  if (!hit && TITLE_T.includes(t)) hit = withPh.find(([, p]) => TITLE_T.includes(phType(p)))
  if (!hit && ['body', 'obj', 'subTitle'].includes(t)) hit = withPh.find(([, p]) => phType(p) === 'body')
  return hit ? hit[0] : null
}
const txStyleKey = (ph) => (!ph ? null : TITLE_T.includes(phType(ph)) ? 'titleStyle' : ['body', 'subTitle', 'obj'].includes(phType(ph)) ? 'bodyStyle' : 'otherStyle')
const ROLE_OF = { title: 'title', ctrTitle: 'title', subTitle: 'subtitle', body: 'body', obj: 'body' }

// ── 글 → HTML ───────────────────────────────────────────
function runCss(r, base, ctx) {
  const css = []
  if (r.color !== undefined && r.color !== base.color && r.color) css.push(`color: ${ctx.cssColor(r.color)}`)
  if (r.px && Math.abs(r.px - base.size) > 0.6) css.push(`font-size: ${Math.round(r.px * 10) / 10}px`)
  return css.join('; ')
}
function runHtml(r, base, ctx) {
  let t = escapeHtml(r.cap === 'all' ? r.text.toUpperCase() : r.text)
  if (!t) return ''
  if (r.s) t = `<s>${t}</s>`
  if (r.u && !base.underline && !r.href) t = `<u>${t}</u>`
  if (r.i && !base.italic) t = `<i>${t}</i>`
  if (r.b && !base.bold) t = `<b>${t}</b>`
  const css = runCss(r, base, ctx)
  if (css) t = `<span style="${css}">${t}</span>`
  if (r.href) t = `<a href="${escapeHtml(r.href)}">${t}</a>`
  return t
}

/**
 * txBody → { html, style } (style: 대표 크기·색·글꼴·정렬·줄 간격). levels: 상속 수준별 속성(이미 합친 것)
 */
function textBody(tx, levels, ctx, scaleFont) {
  const paras = []
  const fontScale = inum(path(tx, 'bodyPr', 'normAutofit'), 'fontScale', 100000) / 100000
  const lst = readLevels(kid(tx, 'lstStyle'), ctx)
  for (const p of kids(tx, 'p')) {
    const pPrNode = kid(p, 'pPr')
    const lvl = Math.min(8, inum(pPrNode, 'lvl', 0))
    let props = levels[lvl] || {}
    if (lst[lvl]) props = mergeP(props, lst[lvl])
    props = mergeP(props, readPPr(pPrNode, ctx))
    const runs = []
    for (const k of kids(p)) {
      if (k.n === 'r' || k.n === 'fld') {
        const rp = { ...(props.rpr || {}), ...readRPr(kid(k, 'rPr'), ctx) }
        const text = textOf(kid(k, 't'))
        if (!text) continue
        runs.push({ text, b: !!rp.b, i: !!rp.i, u: !!rp.u, s: !!rp.s, cap: rp.cap, spc: rp.spc ? rp.spc / (rp.sz || 1800) : 0, color: rp.color, font: rp.font, href: rp.href, px: ((rp.sz || 1800) / 100) * scaleFont * fontScale })
      } else if (k.n === 'br') runs.push({ br: true })
    }
    const endSz = inum(kid(p, 'endParaRPr'), 'sz', props.rpr?.sz || 1800)
    paras.push({ props, lvl, runs, endPx: (endSz / 100) * scaleFont * fontScale })
  }
  // 대표 값: 글자 수가 가장 많은 값
  const tally = (get) => {
    const m = new Map()
    for (const p of paras) for (const r of p.runs) if (!r.br) m.set(get(r), (m.get(get(r)) || 0) + r.text.length)
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  const all = paras.flatMap((p) => p.runs.filter((r) => !r.br))
  const size = tally((r) => Math.round(r.px * 10) / 10) || paras[0]?.endPx || 36
  const color = tally((r) => r.color ?? null)
  const font = tally((r) => r.font || '')
  const style = {
    size: Math.round(size * 10) / 10,
    color: color ?? '@text',
    font: ctx.fontValue(font),
    bold: all.length > 0 && all.every((r) => r.b),
    italic: all.length > 0 && all.every((r) => r.i),
    underline: all.length > 0 && all.every((r) => r.u && !r.href),
    align: { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[paras[0]?.props.algn] || 'left',
    lineHeight: paras[0]?.props.lnSpc ? Math.max(0.8, Math.round(paras[0].props.lnSpc * 1.2 * 100) / 100) : 1.2,
  }
  // 모든 글자가 대문자 변환이면 글 상자 속성으로, 자간이 모두 같으면 em 단위 자간으로
  if (all.length && all.every((r) => r.cap === 'all')) {
    style.textTransform = 'uppercase'
    all.forEach((r) => (r.cap = undefined))
  }
  if (all.length && all[0].spc && all.every((r) => Math.abs(r.spc - all[0].spc) < 0.001)) style.tracking = Math.round(all[0].spc * 1000) / 1000
  if (paras[0]?.props.spcAft) style.paraSpacing = Math.round(paras[0].props.spcAft * 12700 * ctx.k)
  const base = { size: style.size, color: style.color, bold: style.bold, italic: style.italic, underline: style.underline }
  // HTML: 글머리표 있는 문단은 목록으로, 수준이 깊으면 안쪽 목록으로
  let html = ''
  const stack = [] // [{tag, lvl}]
  const closeTo = (lvl) => {
    while (stack.length && stack[stack.length - 1].lvl > lvl) html += `</li></${stack.pop().tag}>`
  }
  for (const p of paras) {
    const inner = p.runs.map((r) => (r.br ? '<br>' : runHtml(r, base, ctx))).join('') || '<br>'
    const b = p.props.bullet
    const listed = b && b.type !== 'none' && p.runs.some((r) => !r.br && r.text.trim())
    const alignCss = p.props.algn && p.props.algn !== paras[0]?.props.algn ? ` style="text-align: ${{ l: 'left', ctr: 'center', r: 'right', just: 'justify' }[p.props.algn] || 'left'}"` : ''
    if (!listed) {
      closeTo(-2)
      html += `<p${alignCss}>${inner}</p>`
      continue
    }
    const tag = b.type === 'num' ? 'ol' : 'ul'
    const top = stack[stack.length - 1]
    if (top && top.lvl === p.lvl && top.tag === tag) html += `</li><li>${inner}`
    else if (top && top.lvl < p.lvl) {
      stack.push({ tag, lvl: p.lvl })
      html += `<${tag}><li>${inner}`
    } else {
      closeTo(p.lvl)
      const t2 = stack[stack.length - 1]
      if (t2 && t2.lvl === p.lvl && t2.tag === tag) html += `</li><li>${inner}`
      else {
        if (t2 && t2.lvl === p.lvl) html += `</li></${stack.pop().tag}>`
        stack.push({ tag, lvl: p.lvl })
        html += `<${tag}><li>${inner}`
      }
    }
  }
  closeTo(-2)
  const plain = all.map((r) => r.text).join('').trim()
  return { html: plain ? html : '', style, plain }
}

// ── 모양 ────────────────────────────────────────────────
const GEOM = { rect: 'rect', roundRect: 'rounded', ellipse: 'ellipse', triangle: 'triangle', rightArrow: 'arrow', line: 'line', straightConnector1: 'line', bentConnector2: 'line', bentConnector3: 'line', curvedConnector3: 'line', snip1Rect: 'rect', flowChartProcess: 'rect', flowChartAlternateProcess: 'rounded', flowChartConnector: 'ellipse', isoscelesTriangle: 'triangle' }

// 방향만 다른 화살표: 오른쪽 화살표를 돌려서 쓴다(90도, 270도면 너비·높이를 바꾼다)
const GEOM_ROT = { leftArrow: 180, upArrow: 270, downArrow: 90 }

function readFill(spPr, ctx, styleNode) {
  if (!spPr) spPr = { c: [], a: {} }
  if (kid(spPr, 'noFill')) return { fill: null }
  const sf = kid(spPr, 'solidFill')
  if (sf) return { fill: solidColor(sf, ctx) }
  const gf = kid(spPr, 'gradFill')
  if (gf) {
    const stops = kids(kid(gf, 'gsLst'), 'gs').sort((a, b) => inum(a, 'pos', 0) - inum(b, 'pos', 0))
    const from = stops.length ? solidColor(stops[0], ctx) : null
    const to = stops.length ? solidColor(stops[stops.length - 1], ctx) : null
    const ang = inum(kid(gf, 'lin'), 'ang', 0) / 60000
    if (from && to) return { fill: from, fillType: 'linear', gradient: { from, to, angle: Math.round((ang + 90) % 360) } }
    return { fill: from || to }
  }
  const pf = kid(spPr, 'pattFill')
  if (pf) return { fill: solidColor(kid(pf, 'fgClr'), ctx) }
  if (kid(spPr, 'blipFill')) return { blip: kid(spPr, 'blipFill') }
  const ref = path(styleNode, 'fillRef')
  if (ref && inum(ref, 'idx', 0) > 0) return { fill: solidColor(ref, ctx) }
  return { fill: undefined }
}

function readLine(spPr, ctx, styleNode) {
  const ln = kid(spPr, 'ln')
  const ref = path(styleNode, 'lnRef')
  if (ln && kid(ln, 'noFill')) return { stroke: null }
  let stroke = ln ? solidColor(kid(ln, 'solidFill'), ctx) : null
  let w = ln && ln.a.w ? inum(ln, 'w', 12700) : null
  if (!stroke && ln && kid(ln, 'gradFill')) stroke = solidColor(path(ln, 'gradFill', 'gsLst', 'gs'), ctx)
  if (!stroke && ref && inum(ref, 'idx', 0) > 0) {
    stroke = solidColor(ref, ctx)
    if (w == null) w = ctx.lnWidths?.[inum(ref, 'idx', 1) - 1] || 12700
  }
  if (!stroke) return { stroke: null }
  const dash = attr(kid(ln, 'prstDash'), 'val')
  return {
    stroke,
    strokeWidth: Math.max(1, Math.round((w ?? 12700) * ctx.k * 10) / 10),
    strokeStyle: !dash || dash === 'solid' ? undefined : /dot/i.test(dash) && !/dash/i.test(dash) ? 'dotted' : 'dashed',
    head: attr(kid(ln, 'headEnd'), 'type'),
    tail: attr(kid(ln, 'tailEnd'), 'type'),
  }
}

function readShadow(spPr, ctx) {
  const sh = path(spPr, 'effectLst', 'outerShdw')
  if (!sh) return undefined
  const c = solidColor(sh, { ...ctx, useTokens: false })
  if (!c) return undefined
  const dist = inum(sh, 'dist', 0) * ctx.k
  const dir = (inum(sh, 'dir', 0) / 60000) * (Math.PI / 180)
  return { x: Math.round(Math.cos(dir) * dist), y: Math.round(Math.sin(dir) * dist), blur: Math.round(inum(sh, 'blurRad', 0) * ctx.k), color: c.length === 7 ? `${c}66` : c }
}

// ── 본체 ────────────────────────────────────────────────
async function toBytes(file) {
  if (file instanceof Uint8Array) return file
  if (file instanceof ArrayBuffer) return new Uint8Array(file)
  if (file && typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  throw new Error('PPTX 파일을 읽을 수 없습니다')
}

export async function importPptx(file, opts = {}) {
  const { uploadImage, useTokens = true, onProgress } = opts
  let zip
  try {
    zip = await JSZip.loadAsync(await toBytes(file))
  } catch {
    throw new Error('PPTX 파일이 아니거나 손상되었습니다')
  }
  const pkg = new Pkg(zip)
  const skipped = { charts: 0, smartart: 0, media: 0, images: 0, shapes: 0, ole: 0, animations: 0, ink: 0, other: 0 }

  // 프레젠테이션
  const rootRels = await pkg.rels('')
  const presPath = Object.values(rootRels).find((r) => r.type === 'officeDocument')?.target || 'ppt/presentation.xml'
  const pres = await pkg.xml(presPath)
  if (!pres) throw new Error('PPTX 파일에 프레젠테이션이 없습니다')
  const presEl = kid(pres, 'presentation')
  const sz = kid(presEl, 'sldSz')
  const cx = inum(sz, 'cx', 12192000)
  const cy = inum(sz, 'cy', 6858000)
  const k = Math.min(SLIDE_W / cx, SLIDE_H / cy)
  const ox = (SLIDE_W - cx * k) / 2
  const oy = (SLIDE_H - cy * k) / 2
  const presRels = await pkg.rels(presPath)
  const slidePaths = kids(kid(presEl, 'sldIdLst'), 'sldId')
    .map((s) => presRels[attr(s, 'r:id') ?? attr(s, 'id')]?.target)
    .filter(Boolean)
  const defaultStyleNode = kid(presEl, 'defaultTextStyle')

  // 테마는 첫 마스터 기준
  const firstMaster = Object.values(presRels).find((r) => r.type === 'slideMaster')?.target
  const themePath = (firstMaster && (await pkg.relOfType(firstMaster, 'theme'))) || Object.values(presRels).find((r) => r.type === 'theme')?.target
  const th = readTheme(await pkg.xml(themePath))
  const masterDoc0 = firstMaster ? await pkg.xml(firstMaster) : null
  const clrMap0 = readClrMap(findAll(masterDoc0, 'clrMap')[0]) || { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }
  const theme = deckTheme(th, clrMap0)

  const fontValue = (name) => {
    if (!name) return '@body'
    if (name === '+mn-lt' || name === '+mn-ea' || name === th.minor) return '@body'
    if (name === '+mj-lt' || name === '+mj-ea' || name === th.major) return '@heading'
    const f = Object.values(FONTS).find((x) => x.office === name)
    return f ? f.id : name
  }
  const cssColor = (v) => (v && v[0] === '@' ? theme.colors[v.slice(1)] || '#111111' : v)

  // 그림 올리기(같은 파일은 한 번만)
  const uploads = new Map()
  const imageUrl = async (partPath) => {
    if (!partPath) return ''
    if (uploads.has(partPath)) return uploads.get(partPath)
    const job = (async () => {
      const f = zip.file(partPath)
      if (!f) return ''
      const ext = partPath.split('.').pop().toLowerCase()
      const mime = MIME[ext]
      if (!mime) {
        skipped.images += 1
        return ''
      }
      const bytes = await f.async('uint8array')
      const name = partPath.split('/').pop()
      if (uploadImage) {
        try {
          const blob = new Blob([bytes], { type: mime })
          return (await uploadImage(blob, name)) || ''
        } catch {
          skipped.images += 1
          return ''
        }
      }
      if (bytes.length > 440000 || mime === 'image/svg+xml' || mime === 'image/bmp') {
        skipped.images += 1
        return ''
      }
      return bytesToDataUrl(bytes, mime)
    })()
    uploads.set(partPath, job)
    return job
  }

  const slides = []
  let morphPrev = false
  for (let si = 0; si < slidePaths.length; si++) {
    onProgress?.(si, slidePaths.length)
    const sp = slidePaths[si]
    const doc = await pkg.xml(sp)
    const sld = kid(doc, 'sld')
    if (!sld) continue
    const rels = await pkg.rels(sp)
    const layoutPath = Object.values(rels).find((r) => r.type === 'slideLayout')?.target
    const layoutDoc = layoutPath ? await pkg.xml(layoutPath) : null
    const layoutRels = layoutPath ? await pkg.rels(layoutPath) : {}
    const masterPath = layoutPath ? await pkg.relOfType(layoutPath, 'slideMaster') : firstMaster
    const masterDoc = masterPath ? await pkg.xml(masterPath) : null
    const masterRels = masterPath ? await pkg.rels(masterPath) : {}
    const masterEl = kid(masterDoc, 'sldMaster')
    const layoutEl = kid(layoutDoc, 'sldLayout')
    const mThemePath = masterPath ? await pkg.relOfType(masterPath, 'theme') : null
    const mth = mThemePath && mThemePath !== themePath ? readTheme(await pkg.xml(mThemePath)) : th
    let clrMap = readClrMap(kid(masterEl, 'clrMap')) || clrMap0
    const ovr = path(layoutEl, 'clrMapOvr', 'overrideClrMapping') || null
    if (ovr) clrMap = readClrMap(ovr)
    const sOvr = path(sld, 'clrMapOvr', 'overrideClrMapping')
    if (sOvr) clrMap = readClrMap(sOvr)
    const baseCtx = { rels, colors: mth.colors, clrMap, useTokens: useTokens && mth === th, k, lnWidths: mth.lnWidths, cssColor, fontValue }
    const txStyles = kid(masterEl, 'txStyles')
    const defLv = readLevels(defaultStyleNode, baseCtx)
    const levelsCache = {}
    // 상속 사슬의 앞부분: 프레젠테이션 기본 글 모양 → 마스터 글 모양(제목·본문·기타)
    const txLevels = (key) => {
      const ck = key || '-'
      if (!levelsCache[ck]) {
        const ts = key ? readLevels(kid(txStyles, key), baseCtx) : []
        levelsCache[ck] = Array.from({ length: 9 }, (_, i) => [defLv[i], ts[i]].reduce((a, c) => (c ? mergeP(a, c) : a), {}))
      }
      return levelsCache[ck]
    }

    const elements = []
    let z = 0
    let curName = ''
    const push = (el) => {
      z += 1
      el.z = z
      el._name = curName
      elements.push(el)
    }
    const box = (xf, T) => {
      const [cxp, cyp] = T.map(xf.x + xf.w / 2, xf.y + xf.h / 2)
      const w = xf.w * T.sx * k
      const h = xf.h * T.sy * k
      return { x: ox + cxp * k - w / 2, y: oy + cyp * k - h / 2, w, h, rotate: ((((xf.rot + T.rot) % 360) + 360) % 360) || 0 }
    }
    const round = (b) => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.max(1, Math.round(b.w * 10) / 10), h: Math.max(1, Math.round(b.h * 10) / 10), rotate: Math.round(b.rotate * 100) / 100 })
    const nameInfo = (nv) => {
      const c = kid(nv, 'cNvPr')
      const name = attr(c, 'name', '')
      const out = {}
      curName = name
      if (name.startsWith('!!')) out.mid = name.slice(2, 66)
      out.descr = attr(c, 'descr', '')
      out.rawName = name
      out.hidden = on(attr(c, 'hidden'))
      const hl = kid(c, 'hlinkClick')
      return { ...out, hl }
    }

    // 도형 하나(sp, cxnSp). src: 'slide' | 'layout' | 'master'
    const shapeNode = async (node, T, ctx, src, groupId) => {
      const nv = kid(node, 'nvSpPr') || kid(node, 'nvCxnSpPr')
      const info = nameInfo(nv)
      if (info.hidden) return
      const ph = phOf(node)
      if (ph && src !== 'slide') return // 레이아웃·마스터의 자리 표시자는 슬라이드에 그리지 않는다
      const spPr = kid(node, 'spPr')
      let xf = readXfrm(kid(spPr, 'xfrm'))
      let layoutPh = null
      let masterPh = null
      if (ph) {
        layoutPh = findPh(path(layoutEl, 'cSld', 'spTree'), ph, true)
        const mph = layoutPh ? phOf(layoutPh) : ph
        masterPh = findPh(path(masterEl, 'cSld', 'spTree'), mph, false)
        if (!xf) xf = readXfrm(path(layoutPh, 'spPr', 'xfrm')) || readXfrm(path(masterPh, 'spPr', 'xfrm'))
      }
      if (!xf) {
        skipped.other += 1
        return
      }
      const styleNode = kid(node, 'style')
      const geomName = attr(path(spPr, 'prstGeom'), 'prst') || (kid(spPr, 'custGeom') ? 'custom' : ph || kid(kid(nv, 'cNvSpPr'), 'txBox') ? 'rect' : node.n === 'cxnSp' ? 'line' : 'rect')
      let geom = GEOM[geomName] || (GEOM_ROT[geomName] !== undefined ? 'arrow' : undefined)
      const extraRot = GEOM_ROT[geomName] || 0
      let fillInfo = readFill(spPr, ctx, styleNode)
      if (fillInfo.fill === undefined && ph) fillInfo = readFill(path(layoutPh, 'spPr'), ctx) || fillInfo
      if (fillInfo.fill === undefined && ph) fillInfo = readFill(path(masterPh, 'spPr'), ctx) || fillInfo
      const line = readLine(spPr, ctx, styleNode)
      const shadow = readShadow(spPr, ctx)
      const b = round(box(xf, T))
      if (extraRot) {
        if (extraRot % 180) [b.x, b.y, b.w, b.h] = [b.x + (b.w - b.h) / 2, b.y + (b.h - b.w) / 2, b.h, b.w]
        b.rotate = (b.rotate + extraRot) % 360
      }
      const flipH = xf.flipH
      const flipV = xf.flipV

      // 선
      if (geom === 'line') {
        if (!line.stroke) return
        const x1 = flipH ? b.x + b.w : b.x
        const y1 = flipV ? b.y + b.h : b.y
        const x2 = flipH ? b.x : b.x + b.w
        const y2 = flipV ? b.y : b.y + b.h
        let ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + (b.rotate || 0)
        const arrowTail = line.tail && line.tail !== 'none'
        const arrowHead = line.head && line.head !== 'none'
        if (arrowHead && !arrowTail) ang += 180
        const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1))
        const thick = Math.max(20, line.strokeWidth * 3)
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        push({
          id: nid('e'), type: 'shape', x: Math.round((mx - len / 2) * 10) / 10, y: Math.round((my - thick / 2) * 10) / 10, w: Math.round(len * 10) / 10, h: thick,
          rotate: Math.round((((ang % 360) + 360) % 360) * 100) / 100, z: 0, locked: false, group: groupId, mid: info.mid, role: src === 'slide' ? undefined : 'deco',
          style: { fill: null, stroke: line.stroke, strokeWidth: line.strokeWidth, strokeStyle: line.strokeStyle, arrowEnd: arrowTail || arrowHead || undefined, shadow },
          data: { shape: 'line' },
        })
        return
      }

      // 그림 채우기 도형 → 그림
      if (fillInfo.blip) {
        const rid = attr(kid(fillInfo.blip, 'blip'), 'r:embed')
        const relMap = src === 'slide' ? rels : src === 'layout' ? layoutRels : masterRels
        const url = await imageUrl(relMap[rid]?.target)
        if (url) push({ id: nid('e'), type: 'image', ...b, z: 0, locked: false, group: groupId, mid: info.mid, role: src === 'slide' ? undefined : 'deco', style: { fit: 'cover', posX: 50, posY: 50, radius: 0, mask: geom === 'ellipse' ? 'circle' : undefined }, data: { src: url, alt: info.descr || '', placeholder: '' } })
        fillInfo = { fill: null }
      }

      // 글
      const tx = kid(node, 'txBody')
      let text = null
      if (tx) {
        const key = ph ? txStyleKey(ph) : null
        let levels = txLevels(key)
        const fontRef = path(styleNode, 'fontRef')
        if (!ph && fontRef && colorChild(fontRef)) {
          const fc = solidColor(fontRef, ctx)
          levels = levels.map((l) => mergeP(l || {}, { rpr: { color: fc } }))
        }
        const lsM = readLevels(path(masterPh, 'txBody', 'lstStyle'), ctx)
        const lsL = readLevels(path(layoutPh, 'txBody', 'lstStyle'), ctx)
        levels = Array.from({ length: 9 }, (_, i) => [levels[i], lsM[i], lsL[i]].reduce((a, c) => (c ? mergeP(a, c) : a), {}))
        text = textBody(tx, levels, ctx, 12700 * k)
        const bp = kid(tx, 'bodyPr')
        const bpL = path(layoutPh, 'txBody', 'bodyPr')
        const bpM = path(masterPh, 'txBody', 'bodyPr')
        const anchor = attr(bp, 'anchor') || attr(bpL, 'anchor') || attr(bpM, 'anchor') || 't'
        text.style.valign = { t: 'top', ctr: 'middle', b: 'bottom' }[anchor] || 'top'
        const lIns = inum(bp, 'lIns', inum(bpL, 'lIns', inum(bpM, 'lIns', 91440)))
        text.style.pad = Math.round(lIns * k)
        text.placeholder = ph ? textOf(path(layoutPh, 'txBody')).trim().slice(0, 200) : ''
      }
      const hasText = text && (text.html || ph)

      const filled = fillInfo.fill || fillInfo.fillType
      const shapeStyle = { fill: fillInfo.fill || null, fillType: fillInfo.fillType, gradient: fillInfo.gradient, stroke: line.stroke || null, strokeWidth: line.stroke ? line.strokeWidth : 0, strokeStyle: line.strokeStyle, shadow }
      const adj = attr(path(spPr, 'prstGeom', 'avLst', 'gd'), 'fmla', '')
      const adjV = /val\s+(-?\d+)/.exec(adj)
      const radius = Math.round((adjV ? +adjV[1] : 16667) / 100000 * Math.min(b.w, b.h))

      if (!geom) {
        if (hasText) skipped.shapes += 1
        else {
          skipped.shapes += 1
          return
        }
      }
      const role = ph ? ROLE_OF[phType(ph)] : src === 'slide' ? undefined : 'deco'
      if (hasText && (geom === 'rect' || geom === 'rounded' || !geom) && !line.stroke) {
        // 글 상자 하나(채우기는 글 상자 배경)
        push({
          id: nid('e'), type: 'text', role, ...b, z: 0, locked: false, group: groupId, mid: info.mid,
          style: { ...text.style, autofit: true, fill: filled ? fillInfo.fill || null : null, fillType: fillInfo.fillType, gradient: fillInfo.gradient, radius: geom === 'rounded' ? radius : 0, shadow, flip: undefined },
          data: { html: text.html, placeholder: text.placeholder || '' },
        })
        return
      }
      if (geom && (filled || line.stroke)) {
        push({ id: nid('e'), type: 'shape', role: src === 'slide' ? undefined : 'deco', ...b, z: 0, locked: false, group: hasText ? groupId || nid('g') : groupId, mid: info.mid, style: { ...shapeStyle, radius: geom === 'rounded' ? radius : 0 }, data: { shape: geom } })
      }
      if (hasText) {
        const g = elements[elements.length - 1]
        push({ id: nid('e'), type: 'text', role, ...b, z: 0, locked: false, group: g && g.x === b.x && g.y === b.y && g.type === 'shape' ? g.group : groupId, mid: info.mid && filled ? `${info.mid}-t` : info.mid, style: { ...text.style, autofit: true, fill: null }, data: { html: text.html, placeholder: text.placeholder || '' } })
      }
    }

    const picNode = async (node, T, ctx, src, groupId) => {
      const nv = kid(node, 'nvPicPr')
      const info = nameInfo(nv)
      if (info.hidden) return
      if (path(nv, 'nvPr', 'videoFile') || path(nv, 'nvPr', 'audioFile') || findAll(nv, 'media').length) skipped.media += 1
      const ph = phOf(node)
      const spPr = kid(node, 'spPr')
      let xf = readXfrm(kid(spPr, 'xfrm'))
      if (!xf && ph) {
        const lp = findPh(path(layoutEl, 'cSld', 'spTree'), ph, true)
        xf = readXfrm(path(lp, 'spPr', 'xfrm')) || readXfrm(path(findPh(path(masterEl, 'cSld', 'spTree'), lp ? phOf(lp) : ph, false), 'spPr', 'xfrm'))
      }
      if (!xf) {
        skipped.other += 1
        return
      }
      const bf = kid(node, 'blipFill')
      const blip = kid(bf, 'blip')
      const rid = attr(blip, 'r:embed') ?? attr(blip, 'embed')
      const relMap = src === 'slide' ? rels : src === 'layout' ? layoutRels : masterRels
      const target = relMap[rid]?.target
      if (!target) {
        if (attr(blip, 'r:link')) skipped.images += 1
        return
      }
      const url = await imageUrl(target)
      if (!url) return
      const b = round(box(xf, T))
      const sr = kid(bf, 'srcRect')
      const l = inum(sr, 'l', 0)
      const t = inum(sr, 't', 0)
      const r = inum(sr, 'r', 0)
      const bt = inum(sr, 'b', 0)
      const cropped = l || t || r || bt
      const geomName = attr(path(spPr, 'prstGeom'), 'prst')
      const amt = inum(kid(blip, 'alphaModFix'), 'amt', 100000) / 100000
      const style = {
        fit: cropped ? 'cover' : 'fill',
        posX: l + r > 0 ? Math.round((l / (l + r)) * 100) : 50,
        posY: t + bt > 0 ? Math.round((t / (t + bt)) * 100) : 50,
        radius: 0,
        mask: geomName === 'ellipse' ? 'circle' : geomName === 'roundRect' ? 'rounded' : undefined,
        opacity: amt < 0.999 ? Math.round(amt * 100) / 100 : undefined,
        shadow: readShadow(spPr, ctx),
      }
      const line = readLine(spPr, ctx)
      push({ id: nid('e'), type: 'image', role: src === 'slide' ? undefined : 'deco', ...b, z: 0, locked: false, group: groupId, mid: info.mid, style, data: { src: url, alt: info.descr || '', placeholder: '' } })
      if (line.stroke) push({ id: nid('e'), type: 'shape', ...b, z: 0, locked: false, group: groupId, style: { fill: null, stroke: line.stroke, strokeWidth: line.strokeWidth, strokeStyle: line.strokeStyle, radius: 0 }, data: { shape: geomName === 'ellipse' ? 'ellipse' : 'rect' } })
    }

    const frameNode = async (node, T, ctx, src, groupId) => {
      const xf = readXfrm(kid(node, 'xfrm'))
      const gd = path(node, 'graphic', 'graphicData')
      const uri = attr(gd, 'uri', '')
      const tbl = kid(gd, 'tbl')
      if (!tbl) {
        if (/chart/.test(uri)) skipped.charts += 1
        else if (/diagram/.test(uri)) skipped.smartart += 1
        else if (/ole/.test(uri)) {
          // OLE 개체: 미리보기 그림이 있으면 그림으로
          const pic = findAll(gd, 'pic')[0]
          if (pic && xf) {
            const bpic = { ...pic, c: [...pic.c.filter((c) => !isNode(c) || c.n !== 'spPr'), { n: 'spPr', q: 'p:spPr', a: {}, c: [{ n: 'xfrm', q: 'a:xfrm', a: {}, c: [{ n: 'off', a: { x: String(xf.x), y: String(xf.y) }, c: [] }, { n: 'ext', a: { cx: String(xf.w), cy: String(xf.h) }, c: [] }] }] }] }
            await picNode(bpic, T, ctx, src, groupId)
          } else skipped.ole += 1
        } else skipped.other += 1
        return
      }
      if (!xf) return
      const b = round(box(xf, T))
      const rowsN = kids(tbl, 'tr')
      const rows = rowsN.slice(0, 60).map((tr) =>
        kids(tr, 'tc')
          .slice(0, 30)
          .map((tc) => (on(attr(tc, 'hMerge')) || on(attr(tc, 'vMerge')) ? '' : kids(kid(tc, 'txBody'), 'p').map((p) => findAll(p, 't').map(textOf).join('')).join('\n')))
      )
      const width = Math.max(1, ...rows.map((r) => r.length))
      rows.forEach((r) => {
        while (r.length < width) r.push('')
      })
      const tblPr = kid(tbl, 'tblPr')
      const header = on(attr(tblPr, 'firstRow'))
      const firstRun = findAll(tbl, 'rPr').find((r) => r.a.sz)
      const size = firstRun ? Math.round((inum(firstRun, 'sz', 1800) / 100) * 12700 * k * 10) / 10 : 24
      const cellFill = (ri) => {
        const tc = kids(rowsN[ri], 'tc')[0]
        const tcPr = kid(tc, 'tcPr')
        return kid(tcPr, 'solidFill') ? solidColor(kid(tcPr, 'solidFill'), ctx) : null
      }
      const cellColor = (ri) => {
        const rp = findAll(kids(rowsN[ri], 'tc')[0], 'rPr').find((r) => kid(r, 'solidFill'))
        return rp ? solidColor(kid(rp, 'solidFill'), ctx) : null
      }
      const lnNode = findAll(tbl, 'lnB')[0] || findAll(tbl, 'lnT')[0]
      const lineC = lnNode && kid(lnNode, 'solidFill') ? solidColor(kid(lnNode, 'solidFill'), ctx) : '@muted'
      const style = {
        font: '@body', size, color: (rowsN.length > 1 ? cellColor(1) : null) || '@text',
        headerFill: header ? cellFill(0) || '@accent' : null, headerColor: header ? cellColor(0) || '@bg' : null,
        line: lineC, fill: rowsN.length > 1 ? cellFill(1) : null,
      }
      push({ id: nid('e'), type: 'table', role: undefined, ...b, rotate: 0, z: 0, locked: false, group: groupId, style, data: { rows: rows.length ? rows : [['']], header } })
    }

    const walk = async (tree, T, ctx, src, groupId) => {
      for (const node of kids(tree)) {
        let n = node
        if (n.n === 'AlternateContent') {
          const fb = kid(n, 'Fallback')
          const ch = kid(n, 'Choice')
          n = kids(fb)[0] || kids(ch)[0]
          if (!n) continue
        }
        if (n.n === 'sp' || n.n === 'cxnSp') await shapeNode(n, T, ctx, src, groupId)
        else if (n.n === 'pic') await picNode(n, T, ctx, src, groupId)
        else if (n.n === 'graphicFrame') await frameNode(n, T, ctx, src, groupId)
        else if (n.n === 'grpSp') {
          const gx = readXfrm(path(n, 'grpSpPr', 'xfrm'))
          if (on(attr(path(n, 'nvGrpSpPr', 'cNvPr'), 'hidden'))) continue
          await walk(n, groupTransform(T, gx), ctx, src, groupId || nid('g'))
        } else if (n.n === 'contentPart') skipped.ink += 1
      }
    }

    // 배경: 슬라이드 → 레이아웃 → 마스터
    let background = null
    const bgOf = async (el, relMap) => {
      const bg = path(el, 'cSld', 'bg')
      if (!bg) return undefined
      const bgPr = kid(bg, 'bgPr')
      if (bgPr) {
        const f = readFill(bgPr, baseCtx)
        if (f.blip) {
          const url = await imageUrl(relMap[attr(kid(f.blip, 'blip'), 'r:embed')]?.target)
          return url ? { image: url, color: null } : null
        }
        if (f.fill) return { color: f.fill }
        return null
      }
      const ref = kid(bg, 'bgRef')
      if (ref) {
        const c = solidColor(ref, baseCtx)
        const idx = inum(ref, 'idx', 0)
        if (idx >= 1001) {
          // 테마의 배경 채우기 목록. 단색이면 그 색, 그림이면 첫 그림
          const fill = kids(findAll(await pkg.xml(mThemePath || themePath), 'bgFillStyleLst')[0])[idx - 1001]
          if (fill && fill.n === 'gradFill') {
            const gs = path(fill, 'gsLst', 'gs')
            const cc = solidColor(gs, { ...baseCtx, phClr: readColorNode(colorChild(ref), baseCtx) })
            if (cc) return { color: cc }
          }
        }
        return c ? { color: c } : null
      }
      return undefined
    }
    for (const [el, rm] of [[sld, rels], [layoutEl, layoutRels], [masterEl, masterRels]]) {
      const b = await bgOf(el, rm)
      if (b !== undefined) {
        background = b
        break
      }
    }
    if (background && !background.image && (background.color === '@bg' || background.color === theme.colors.bg)) background = null
    if (background && !background.color) delete background.color

    // 레이아웃·마스터의 장식 도형(자리 표시자 아닌 것)
    const showMaster = (el) => attr(kid(el, 'cSld') ? el : null, 'showMasterSp') !== '0'
    if (showMaster(sld)) {
      if (showMaster(layoutEl) && masterEl) await walk(path(masterEl, 'cSld', 'spTree'), IDENTITY, baseCtx, 'master')
      if (layoutEl) await walk(path(layoutEl, 'cSld', 'spTree'), IDENTITY, baseCtx, 'layout')
    }
    await walk(path(sld, 'cSld', 'spTree'), IDENTITY, baseCtx, 'slide')

    // 발표자 노트
    let notes = ''
    const notesPath = Object.values(rels).find((r) => r.type === 'notesSlide')?.target
    if (notesPath) {
      const nd = await pkg.xml(notesPath)
      const body = findAll(nd, 'sp').find((s) => {
        const p = phOf(s)
        return p && phType(p) === 'body'
      })
      if (body) notes = kids(kid(body, 'txBody'), 'p').map((p) => findAll(p, 't').map(textOf).join('')).join('\n').trim()
    }

    // 전환
    let transition = 'none'
    const trNodes = findAll(sld, 'transition')
    const isMorph = trNodes.some((t) => kid(t, 'morph'))
    if (isMorph) transition = 'magic'
    else {
      const tr = trNodes[trNodes.length - 1]
      if (tr) {
        const kind = kids(tr)[0]?.n
        if (kind === 'fade' || kind === 'dissolve') transition = 'fade'
        else if (['push', 'wipe', 'cover', 'pull', 'split', 'slide', 'reveal'].includes(kind)) transition = 'slide'
        else if (kind) transition = 'fade'
      }
    }
    if (findAll(sld, 'timing').some((t) => findAll(t, 'par').length > 1)) skipped.animations += 1

    // 모핑 슬라이드와 그 앞 슬라이드: 이름이 같은 요소를 mid로 잇는다(PowerPoint 모핑은 이름으로 짝을 찾는다)
    if (isMorph && slides.length) {
      const prevEls = slides[slides.length - 1].elements
      const used = new Set()
      for (const e of elements) {
        if (e.mid || !e._name) continue
        const m = prevEls.find((p) => !used.has(p) && p._name === e._name && p.type === e.type)
        if (!m) continue
        used.add(m)
        const mid = m.mid || `m-${e._name}`.slice(0, 64)
        m.mid = mid
        e.mid = mid
      }
    }
    morphPrev = isMorph

    for (const e of elements) {
      for (const key of ['group', 'mid', 'role']) if (e[key] === undefined) delete e[key]
      for (const [sk, sv] of Object.entries(e.style)) if (sv === undefined) delete e.style[sk]
    }
    slides.push({ id: nid('s'), layout: 'blank', variant: 0, background, notes: notes.slice(0, 20000), hidden: attr(sld, 'show') === '0', transition, elements: elements.slice(0, 400) })
  }
  for (const sl of slides) for (const e of sl.elements) delete e._name
  void morphPrev
  onProgress?.(slidePaths.length, slidePaths.length)
  for (const key of Object.keys(skipped)) if (!skipped[key]) delete skipped[key]
  return { slides: useTokens ? slides : bakeThemeColors(slides, theme), theme, skipped, source: { width: cx, height: cy, slides: slidePaths.length } }
}

/**
 * 테마 토큰('@accent' 등)을 실제 색으로 굽는다. 가져온 테마를 쓰지 않고 지금 발표 뒤에 붙일 때 원래 색을 지키려면 쓴다.
 * slides는 바꾸지 않고 새 배열을 돌려준다.
 */
export function bakeThemeColors(slides, theme) {
  const c = (v) => (typeof v === 'string' && v[0] === '@' && theme?.colors?.[v.slice(1)] ? theme.colors[v.slice(1)] : v)
  const fixHtml = (h) => String(h || '').replace(/color:\s*@(\w+)/g, (m, k) => `color: ${theme?.colors?.[k] || '#111111'}`)
  return (slides || []).map((s) => ({
    ...s,
    background: s.background ? { ...s.background, color: c(s.background.color) } : s.background,
    elements: s.elements.map((e) => {
      const st = { ...e.style }
      for (const k of ['color', 'fill', 'stroke', 'headerFill', 'headerColor', 'line']) if (k in st) st[k] = c(st[k])
      if (st.gradient) st.gradient = { ...st.gradient, from: c(st.gradient.from), to: c(st.gradient.to) }
      return { ...e, style: st, data: e.type === 'text' ? { ...e.data, html: fixHtml(e.data.html) } : e.data }
    }),
  }))
}

/** 건너뛴 것 요약(한국어). 없으면 '' */
export function skippedSummary(skipped) {
  const NAMES = { charts: '차트', smartart: 'SmartArt', media: '동영상·소리', images: '그림', shapes: '모양', ole: '개체', animations: '애니메이션이 있는 슬라이드', ink: '잉크', other: '기타' }
  return Object.entries(skipped || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${NAMES[k] || k} ${v}개`)
    .join(', ')
}
