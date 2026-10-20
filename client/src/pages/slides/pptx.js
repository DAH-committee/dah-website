// PPTX 내보내기: OOXML(PresentationML)을 직접 써서 jszip으로 묶는다.
// 글 상자(문단, 굵게·기울임·밑줄·색, 목록, 정렬, 줄 간격), 도형(사각형, 둥근 사각형, 타원, 삼각형, 화살표, 선),
// 이미지(채우기 자르기), 표, 배경(색, 이미지), 숨긴 슬라이드, 전환(페이드, 밀기), 발표자 노트를 옮긴다.
// 아이콘과 링크 카드는 그림으로 옮긴다(rasterize 콜백). 등장 효과는 옮기지 않는다.
// 글 속 링크는 <a:hlinkClick r:id>와 슬라이드 rels의 외부 링크(TargetMode="External")로, 링크 카드는 그림 전체 링크로 옮긴다.
// 그라데이션 채우기, 그림자, 투명도, 점선, 자간, 대문자 변환, 그림 원·둥근 자르기, 문단 간격도 옮긴다.
// 매직 무브는 PowerPoint 모핑(p159:morph, 못 읽는 프로그램은 페이드)으로, mid가 있는 요소는 이름을 '!!mid'로 써서 모핑이 같은 요소로 잇게 한다.
import JSZip from 'jszip'
import { SLIDE_H, SLIDE_W, officeFont, resolveColor } from './deckCore'
import { sanitizeRich } from './sanitize'

const EMU = 6350 // 슬라이드 1px(1920 기준) = 12192000 / 1920
const E = (px) => Math.round(px * EMU)
const SZ = (px) => Math.max(100, Math.round(px * 50)) // 글자 크기: 1px = 0.5pt, 단위 1/100pt
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// eslint-disable-next-line no-control-regex
const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 색 → {hex, alpha} (없거나 투명이면 null) */
export function parseColor(c) {
  if (!c || c === 'transparent' || c === 'none') return null
  let m = String(c).trim().match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('')
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { hex: h.slice(0, 6).toUpperCase(), alpha }
  }
  m = String(c).match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i)
  if (m) {
    const hex = [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('').toUpperCase()
    let alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]
    if (!(alpha >= 0)) alpha = 1
    return alpha <= 0 ? null : { hex, alpha }
  }
  return null
}

function clrXml(c, mul = 1) {
  const p = parseColor(c)
  if (!p) return ''
  const a = p.alpha * (mul ?? 1)
  return `<a:srgbClr val="${p.hex}">${a < 0.999 ? `<a:alpha val="${Math.max(0, Math.round(a * 100000))}"/>` : ''}</a:srgbClr>`
}

function fillXml(c, mul = 1) {
  const p = parseColor(c)
  if (!p) return '<a:noFill/>'
  return `<a:solidFill>${clrXml(c, mul)}</a:solidFill>`
}

/** 요소 채우기: 단색 또는 선형 그라데이션(CSS 각도 → OOXML 각도: 0deg=위쪽 방향 = OOXML 270도) */
export function elementFillXml(s, theme, mul = 1) {
  if ((s.fillType === 'linear' || s.fillType === 'gradient') && s.gradient) {
    const from = resolveColor(s.gradient.from || '@accent', theme)
    const to = resolveColor(s.gradient.to || '@accent2', theme)
    if (parseColor(from) && parseColor(to)) {
      const ang = ((((s.gradient.angle ?? 90) - 90) % 360) + 360) % 360
      return `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0">${clrXml(from, mul)}</a:gs><a:gs pos="100000">${clrXml(to, mul)}</a:gs></a:gsLst><a:lin ang="${Math.round(ang * 60000)}" scaled="0"/></a:gradFill>`
    }
  }
  return fillXml(s.fill ? resolveColor(s.fill, theme) : null, mul)
}

/** 그림자 {x, y, blur, color} → <a:effectLst> */
export function shadowXml(sh, theme) {
  if (!sh) return ''
  const c = resolveColor(sh.color || '#00000040', theme)
  if (!parseColor(c)) return ''
  const x0 = sh.x || 0
  const y0 = sh.y || 0
  const dist = Math.round(Math.hypot(x0, y0) * EMU)
  const dir = Math.round(((((Math.atan2(y0, x0) * 180) / Math.PI) % 360) + 360) % 360 * 60000)
  return `<a:effectLst><a:outerShdw blurRad="${E(Math.max(0, sh.blur || 0))}" dist="${dist}" dir="${dir}" algn="ctr" rotWithShape="0">${clrXml(c)}</a:outerShdw></a:effectLst>`
}

const dashXml = (st) => (st === 'dashed' ? '<a:prstDash val="dash"/>' : st === 'dotted' ? '<a:prstDash val="sysDot"/>' : '')

const xfrm = (el, tag = 'a:xfrm') =>
  `<${tag}${el.rotate ? ` rot="${Math.round((((el.rotate % 360) + 360) % 360) * 60000)}"` : ''}><a:off x="${E(el.x)}" y="${E(el.y)}"/><a:ext cx="${E(Math.max(1, el.w))}" cy="${E(Math.max(1, el.h))}"/></${tag}>`

// ── 글 HTML → 문단 ───────────────────────────────────────
function runsFromHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${sanitizeRich(html)}</body>`, 'text/html')
  const paras = []
  let cur = null
  const newPara = (list, level) => {
    cur = { runs: [], list, level }
    paras.push(cur)
  }
  const walk = (node, fmt, list, level) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\s+/g, ' ')
        if (!t) continue
        if (!cur) newPara(list, level)
        cur.runs.push({ text: t, ...fmt })
        continue
      }
      if (n.nodeType !== 1) continue
      const tag = n.tagName
      const f = { ...fmt }
      if (tag === 'B' || tag === 'STRONG') f.b = true
      if (tag === 'I' || tag === 'EM') f.i = true
      if (tag === 'U') f.u = true
      if (tag === 'S') f.s = true
      if (tag === 'FONT' && n.getAttribute('color')) f.color = n.getAttribute('color')
      if (n.style) {
        if (n.style.color) f.color = n.style.color
        if (n.style.fontWeight === 'bold' || +n.style.fontWeight >= 600) f.b = true
        if (n.style.fontStyle === 'italic') f.i = true
        if (/underline/.test(n.style.textDecoration || n.style.textDecorationLine || '')) f.u = true
        const fs = n.style.fontSize
        if (fs && fs.endsWith('px')) f.px = parseFloat(fs)
      }
      if (tag === 'A') f.href = n.getAttribute('href')
      if (tag === 'BR') {
        if (!cur) newPara(list, level)
        cur.runs.push({ br: true })
        continue
      }
      if (tag === 'UL' || tag === 'OL') {
        const lv = list ? level + 1 : 0
        cur = null
        walk(n, f, tag === 'OL' ? 'ol' : 'ul', lv)
        cur = null
        continue
      }
      if (tag === 'LI') {
        newPara(list || 'ul', level)
        walk(n, f, list, level)
        cur = null
        continue
      }
      if (tag === 'P' || tag === 'DIV') {
        newPara(list, level)
        walk(n, f, list, level)
        cur = null
        continue
      }
      walk(n, f, list, level)
    }
  }
  walk(doc.body, {}, null, 0)
  return paras.filter((p, i) => p.runs.length || i < paras.length - 1 || paras.length === 1)
}

function rPr(run, base, theme) {
  const px = run.px || base.size
  const color = run.color || base.color
  const font = base.font
  const spc = base.tracking ? ` spc="${Math.round(base.tracking * px * 50)}"` : ''
  const cap = base.textTransform === 'uppercase' ? ' cap="all"' : ''
  const href = run.href && base.link ? base.link(run.href) : null
  const attrs = `lang="ko-KR" altLang="en-US" sz="${SZ(px)}"${run.b || base.bold ? ' b="1"' : ''}${run.i || base.italic ? ' i="1"' : ''}${run.u || base.underline || href ? ' u="sng"' : ''}${run.s ? ' strike="sngStrike"' : ''}${spc}${cap} dirty="0"`
  const fx = base.textShadow ? shadowXml(base.textShadow, theme) : ''
  return `<a:rPr ${attrs}>${fillXml(color, base.opacity)}${fx}<a:latin typeface="${x(font)}"/><a:ea typeface="${x(font)}"/>${href ? `<a:hlinkClick r:id="${href}"/>` : ''}</a:rPr>`
}

const lower = (t, base) => (base.textTransform === 'lowercase' ? String(t).toLowerCase() : base.textTransform === 'capitalize' ? String(t).replace(/(^|\s)(\p{L})/gu, (m, a, c) => a + c.toUpperCase()) : t)

function textBodyXml(html, base, theme, opts = {}) {
  const paras = runsFromHtml(html)
  const algn = { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[base.align] || 'l'
  const ln = Math.round(((base.lineHeight || 1.4) / 1.2) * 100000)
  const counters = {}
  const ps = (paras.length ? paras : [{ runs: [] }]).map((p) => {
    let bu = '<a:buNone/>'
    let mar = ''
    if (p.list) {
      const lv = Math.min(p.level || 0, 4)
      const step = base.size * 1.3
      mar = `${lv ? ` lvl="${lv}"` : ''} marL="${E(step * (lv + 1))}" indent="${E(-step * 0.9)}"`
      if (p.list === 'ol') {
        counters[lv] = (counters[lv] || 0) + 1
        bu = `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${lv ? 'alphaLcPeriod' : 'arabicPeriod'}"/>`
      } else bu = `<a:buFont typeface="Arial"/><a:buChar char="${lv ? '–' : '•'}"/>`
    }
    const runs = p.runs
      .map((r) => (r.br ? '<a:br><a:rPr lang="ko-KR"/></a:br>' : `<a:r>${rPr(r, base, theme)}<a:t>${x(lower(r.text, base))}</a:t></a:r>`))
      .join('')
    const aft = base.paraSpacing ? `<a:spcAft><a:spcPts val="${Math.round(base.paraSpacing * 50)}"/></a:spcAft>` : ''
    return `<a:p><a:pPr algn="${algn}"${mar}><a:lnSpc><a:spcPct val="${ln}"/></a:lnSpc>${aft}${bu}</a:pPr>${runs}<a:endParaRPr lang="ko-KR" sz="${SZ(base.size)}" dirty="0"/></a:p>`
  })
  const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[base.valign] || 't'
  const ins = E(base.pad ?? 8)
  const fit = opts.fontScale && opts.fontScale < 0.995 ? `<a:normAutofit fontScale="${Math.round(opts.fontScale * 100000)}" lnSpcReduction="0"/>` : '<a:noAutofit/>'
  return `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0">${fit}</a:bodyPr><a:lstStyle/>${ps.join('')}</p:txBody>`
}

// ── 그림 바이트 ─────────────────────────────────────────
async function blobToPng(blob) {
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  c.getContext('2d').drawImage(bmp, 0, 0)
  const out = await new Promise((r) => c.toBlob(r, 'image/png'))
  return { blob: out, w: bmp.width, h: bmp.height }
}

async function loadImage(src) {
  const res = await fetch(src, { mode: 'cors', credentials: src.startsWith('/') ? 'include' : 'omit' })
  if (!res.ok) throw new Error(`image ${res.status}`)
  const blob = await res.blob()
  const type = (blob.type || '').toLowerCase()
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/gif') {
    const bmp = await createImageBitmap(blob).catch(() => null)
    return { blob, ext: type === 'image/png' ? 'png' : type === 'image/gif' ? 'gif' : 'jpeg', w: bmp?.width || 0, h: bmp?.height || 0 }
  }
  const png = await blobToPng(blob)
  return { blob: png.blob, ext: 'png', w: png.w, h: png.h }
}

function dataUrlToBlob(u) {
  const [head, b64] = u.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// ── 고정 부품 ───────────────────────────────────────────
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'

function themeXml(theme, name = 'DAH') {
  const c = (k, d) => parseColor(resolveColor(`@${k}`, theme))?.hex || d
  const head = officeFont('@heading', theme)
  const body = officeFont('@body', theme)
  const fillTriple = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${x(name)}"><a:themeElements>
<a:clrScheme name="${x(name)}"><a:dk1><a:srgbClr val="${c('text', '111111')}"/></a:dk1><a:lt1><a:srgbClr val="${c('bg', 'FFFFFF')}"/></a:lt1><a:dk2><a:srgbClr val="${c('muted', '5F6368')}"/></a:dk2><a:lt2><a:srgbClr val="${c('surface', 'F1F1F1')}"/></a:lt2><a:accent1><a:srgbClr val="${c('accent', '7A3CFF')}"/></a:accent1><a:accent2><a:srgbClr val="${c('accent2', 'FFB300')}"/></a:accent2><a:accent3><a:srgbClr val="FF1744"/></a:accent3><a:accent4><a:srgbClr val="00E676"/></a:accent4><a:accent5><a:srgbClr val="FFEA00"/></a:accent5><a:accent6><a:srgbClr val="6200EA"/></a:accent6><a:hlink><a:srgbClr val="7A3CFF"/></a:hlink><a:folHlink><a:srgbClr val="6200EA"/></a:folHlink></a:clrScheme>
<a:fontScheme name="${x(name)}"><a:majorFont><a:latin typeface="${x(head)}"/><a:ea typeface="${x(head)}"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${x(body)}"/><a:ea typeface="${x(body)}"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="${x(name)}"><a:fillStyleLst>${fillTriple}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fillTriple}</a:bgFillStyleLst></a:fmtScheme>
</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}

const PRST = { rect: 'rect', rounded: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', arrow: 'rightArrow' }

/**
 * 발표 → PPTX Blob.
 * opts.fitOf(elId) → 자동 맞춤 배율(없으면 1), opts.rasterize(elId) → Promise<dataUrl|null> (아이콘·링크 카드),
 * opts.onProgress(i, n)
 */
export async function buildPptx(deck, { title = '발표', fitOf, rasterize, onProgress } = {}) {
  const zip = new JSZip()
  const put = zip.file.bind(zip)
  zip.file = (name, data, o) => put(name, data, { createFolders: false, ...(o || {}) })
  const theme = deck.theme
  const slides = deck.slides
  const n = slides.length
  const media = []
  let mediaSeq = 0
  const skipped = { images: 0 }

  const ct = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="gif" ContentType="image/gif"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>',
    '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>',
    '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ]

  for (let si = 0; si < n; si++) {
    onProgress?.(si, n)
    const slide = slides[si]
    const num = si + 1
    const rels = [`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`]
    let rid = 1
    const addRel = (type, target, external = false) => {
      rid += 1
      rels.push(`<Relationship Id="rId${rid}" Type="${REL}/${type}" Target="${x(target)}"${external ? ' TargetMode="External"' : ''}/>`)
      return `rId${rid}`
    }
    const links = new Map()
    const linkRel = (href) => {
      if (!links.has(href)) links.set(href, addRel('hyperlink', href, true))
      return links.get(href)
    }
    const addMedia = (blob, ext) => {
      mediaSeq += 1
      const name = `image${mediaSeq}.${ext}`
      media.push({ name, blob })
      return addRel('image', `../media/${name}`)
    }
    let shapeId = 1
    const parts = []

    // 배경
    let bg = ''
    if (slide.background?.image) {
      try {
        const im = await loadImage(slide.background.image)
        const r = addMedia(im.blob, im.ext)
        bg = `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${r}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`
      } catch {
        skipped.images += 1
      }
    }
    if (!bg) bg = `<p:bg><p:bgPr>${fillXml(resolveColor(slide.background?.color || '@bg', theme))}<a:effectLst/></p:bgPr></p:bg>`

    const els = [...slide.elements].sort((a, b) => (a.z || 0) - (b.z || 0))
    for (const el of els) {
      shapeId += 1
      const id = shapeId
      const s = el.style || {}
      const d = el.data || {}
      const name = el.mid ? `!!${el.mid}` : el.name || `${el.type} ${el.id || id}`
      const op = typeof s.opacity === 'number' ? Math.max(0, Math.min(1, s.opacity)) : 1
      const fx = shadowXml(s.shadow, theme)
      if (el.hidden) continue
      const picXml = (rEmbed, box, crop = '', link = '') => {
        const rad = s.mask === 'rounded' ? Math.max(s.radius || 0, Math.min(box.w, box.h) * 0.12) : s.radius || 0
        const geom = s.mask === 'circle' ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' : `<a:prstGeom prst="${rad ? 'roundRect' : 'rect'}"><a:avLst>${rad ? `<a:gd name="adj" fmla="val ${Math.min(50000, Math.round((rad / Math.max(1, Math.min(box.w, box.h))) * 100000))}"/>` : ''}</a:avLst></a:prstGeom>`
        const blipFx = [op < 0.999 ? `<a:alphaModFix amt="${Math.round(op * 100000)}"/>` : '', (s.brightness ?? 100) !== 100 || (s.contrast ?? 100) !== 100 ? `<a:lum bright="${Math.round(((s.brightness ?? 100) - 100) * 1000)}" contrast="${Math.round(((s.contrast ?? 100) - 100) * 1000)}"/>` : ''].join('')
        return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${x(name)}" descr="${x(d.alt || d.title || '')}">${link}</p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rEmbed}">${blipFx}</a:blip>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(box)}${geom}${fx}</p:spPr></p:pic>`
      }

      if (el.type === 'text') {
        const plain = String(d.html || '').replace(/<[^>]*>/g, '').trim()
        if (!plain && !s.fill) continue
        const filled = !!(s.fill || ((s.fillType === 'linear' || s.fillType === 'gradient') && s.gradient))
        const base = {
          size: s.size || 36, color: resolveColor(s.color || '@text', theme), font: officeFont(s.font || '@body', theme), bold: s.bold, italic: s.italic, underline: s.underline, align: s.align, valign: s.valign, lineHeight: s.lineHeight, pad: s.pad,
          tracking: s.tracking, textTransform: s.textTransform, paraSpacing: s.paraSpacing, opacity: op, textShadow: s.textShadow || (!filled && s.shadow) || null, link: linkRel,
        }
        const fill = filled ? elementFillXml(s, theme, op) : '<a:noFill/>'
        const geom = filled && (s.radius ?? 12) ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round(((s.radius ?? 12) / Math.max(1, Math.min(el.w, el.h))) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        parts.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}${geom}${fill}<a:ln><a:noFill/></a:ln>${filled ? fx : ''}</p:spPr>${textBodyXml(d.html, base, theme, { fontScale: fitOf?.(el.id, si) })}</p:sp>`)
      } else if (el.type === 'shape' && d.shape === 'line') {
        const c = resolveColor(s.stroke || s.fill || '@text', theme)
        const cy = el.y + el.h / 2
        parts.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm({ ...el, y: cy, h: 0 }).replace(/cy="\d+"/, 'cy="0"')}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${E(s.strokeWidth || 6)}" cap="rnd">${fillXml(c, op)}${dashXml(s.strokeStyle)}${s.arrowEnd ? '<a:tailEnd type="triangle"/>' : ''}</a:ln>${fx}</p:spPr></p:cxnSp>`)
      } else if (el.type === 'shape' && PRST[d.shape || 'rect']) {
        const prst = PRST[d.shape || 'rect']
        const r = d.shape === 'rounded' ? s.radius ?? 24 : 0
        const av = prst === 'roundRect' ? `<a:gd name="adj" fmla="val ${Math.min(50000, Math.round((r / Math.max(1, Math.min(el.w, el.h))) * 100000))}"/>` : ''
        const line = s.stroke ? `<a:ln w="${E(s.strokeWidth || 4)}">${fillXml(resolveColor(s.stroke, theme), op)}${dashXml(s.strokeStyle)}</a:ln>` : '<a:ln><a:noFill/></a:ln>'
        parts.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="${prst}"><a:avLst>${av}</a:avLst></a:prstGeom>${elementFillXml(s, theme, op)}${line}${fx}</p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR" dirty="0"/></a:p></p:txBody></p:sp>`)
      } else if (el.type === 'image') {
        if (!d.src) continue
        try {
          const im = await loadImage(d.src)
          const r = addMedia(im.blob, im.ext)
          let crop = ''
          let box = el
          const fit = s.fit || 'cover'
          if (im.w && im.h && fit !== 'fill') {
            const px = (s.posX ?? 50) / 100
            const py = (s.posY ?? 50) / 100
            if (fit === 'cover') {
              const k = Math.max(el.w / im.w, el.h / im.h)
              const dw = im.w * k
              const dh = im.h * k
              const ox = dw - el.w
              const oy = dh - el.h
              const pct = (v, total) => Math.round((v / total) * 100000)
              if (ox > 0.5 || oy > 0.5) crop = `<a:srcRect l="${pct(ox * px, dw)}" t="${pct(oy * py, dh)}" r="${pct(ox * (1 - px), dw)}" b="${pct(oy * (1 - py), dh)}"/>`
            } else {
              const k = Math.min(el.w / im.w, el.h / im.h)
              const dw = im.w * k
              const dh = im.h * k
              box = { ...el, x: el.x + (el.w - dw) * px, y: el.y + (el.h - dh) * py, w: dw, h: dh }
            }
          }
          parts.push(picXml(r, box, crop))
        } catch {
          skipped.images += 1
        }
      } else if (el.type === 'table') {
        const rows = d.rows?.length ? d.rows : [['']]
        const cols = Math.max(...rows.map((r) => r.length))
        const colW = Math.floor(E(el.w) / cols)
        const rowH = Math.floor(E(el.h) / rows.length)
        const fsz = s.size || 24
        const font = officeFont(s.font || '@body', theme)
        const line = resolveColor(s.line || '@muted', theme)
        const lnX = (t) => `<a:${t} w="12700">${fillXml(line)}</a:${t}>`
        const trs = rows
          .map((r, ri) => {
            const head = d.header !== false && ri === 0
            const color = resolveColor(head ? s.headerColor || '@bg' : s.color || '@text', theme)
            const tcs = Array.from({ length: cols }, (_, ci) => {
              const text = String(r[ci] ?? '')
              const ps = text
                .split('\n')
                .map((t) => `<a:p>${t ? `<a:r><a:rPr lang="ko-KR" sz="${SZ(fsz)}"${head ? ' b="1"' : ''} dirty="0">${fillXml(color)}<a:latin typeface="${x(font)}"/><a:ea typeface="${x(font)}"/></a:rPr><a:t>${x(t)}</a:t></a:r>` : ''}<a:endParaRPr lang="ko-KR" sz="${SZ(fsz)}" dirty="0"/></a:p>`)
                .join('')
              const fill = head ? fillXml(resolveColor(s.headerFill || '@accent', theme)) : s.fill ? fillXml(resolveColor(s.fill, theme)) : '<a:noFill/>'
              return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${ps}</a:txBody><a:tcPr marL="${E(16)}" marR="${E(16)}" marT="${E(10)}" marB="${E(10)}" anchor="ctr">${lnX('lnL')}${lnX('lnR')}${lnX('lnT')}${lnX('lnB')}${fill}</a:tcPr></a:tc>`
            }).join('')
            return `<a:tr h="${rowH}">${tcs}</a:tr>`
          })
          .join('')
        parts.push(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm({ ...el, rotate: 0 }, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${d.header !== false ? 1 : 0}" bandRow="0"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`)
      } else if (el.type === 'shape' || el.type === 'embed') {
        // 아이콘, 링크 카드: 그림으로
        const url = rasterize ? await rasterize(el.id, si).catch(() => null) : null
        if (!url && el.type === 'embed' && d.url) {
          // 그림으로 못 옮긴 링크 카드: 제목과 주소를 링크 글 상자로
          const r = linkRel(d.url)
          const t = x(d.title || d.url)
          const sub = d.title ? `<a:p><a:r><a:rPr lang="ko-KR" sz="${SZ(22)}" u="sng" dirty="0">${fillXml(resolveColor('@muted', theme))}<a:hlinkClick r:id="${r}"/></a:rPr><a:t>${x(d.url)}</a:t></a:r></a:p>` : ''
          parts.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)}"><a:hlinkClick r:id="${r}"/></p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${fillXml(resolveColor('@surface', theme))}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${E(24)}" tIns="${E(24)}" rIns="${E(24)}" bIns="${E(24)}" anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" sz="${SZ(32)}" b="1" dirty="0">${fillXml(resolveColor('@text', theme))}<a:hlinkClick r:id="${r}"/></a:rPr><a:t>${t}</a:t></a:r></a:p>${sub}</p:txBody></p:sp>`)
          continue
        }
        if (!url) continue
        const r = addMedia(dataUrlToBlob(url), 'png')
        const link = el.type === 'embed' && d.url ? `<a:hlinkClick r:id="${linkRel(d.url)}"/>` : ''
        parts.push(picXml(r, el, '', link))
      }
    }

    // 노트
    const notesRel = addRel('notesSlide', `../notesSlides/notesSlide${num}.xml`)
    void notesRel
    const transition =
      slide.transition === 'fade'
        ? '<p:transition spd="med"><p:fade/></p:transition>'
        : slide.transition === 'slide'
          ? '<p:transition spd="med"><p:push dir="l"/></p:transition>'
          : slide.transition === 'magic'
            ? '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition spd="slow"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>'
            : ''
    zip.file(`ppt/slides/slide${num}.xml`, `${HEAD}<p:sld ${NS}${slide.hidden ? ' show="0"' : ''}><p:cSld>${bg}<p:spTree>${GRP}${parts.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}</p:sld>`)
    zip.file(`ppt/slides/_rels/slide${num}.xml.rels`, `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`)
    const noteParas = String(slide.notes || '')
      .split(/\r?\n/)
      .map((l) => `<a:p>${l ? `<a:r><a:rPr lang="ko-KR" dirty="0"/><a:t>${x(l)}</a:t></a:r>` : ''}<a:endParaRPr lang="ko-KR" dirty="0"/></a:p>`)
      .join('')
    zip.file(
      `ppt/notesSlides/notesSlide${num}.xml`,
      `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${noteParas}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
    )
    zip.file(`ppt/notesSlides/_rels/notesSlide${num}.xml.rels`, `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="${REL}/slide" Target="../slides/slide${num}.xml"/></Relationships>`)
    ct.push(`<Override PartName="/ppt/slides/slide${num}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    ct.push(`<Override PartName="/ppt/notesSlides/notesSlide${num}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`)
  }

  for (const m of media) zip.file(`ppt/media/${m.name}`, m.blob)

  // 프레젠테이션
  const presRels = [`<Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`]
  const sldIds = []
  for (let i = 1; i <= n; i++) {
    presRels.push(`<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i}.xml"/>`)
    sldIds.push(`<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`)
  }
  const k = n + 2
  presRels.push(`<Relationship Id="rId${k}" Type="${REL}/notesMaster" Target="notesMasters/notesMaster1.xml"/>`)
  presRels.push(`<Relationship Id="rId${k + 1}" Type="${REL}/presProps" Target="presProps.xml"/>`)
  presRels.push(`<Relationship Id="rId${k + 2}" Type="${REL}/viewProps" Target="viewProps.xml"/>`)
  presRels.push(`<Relationship Id="rId${k + 3}" Type="${REL}/theme" Target="theme/theme1.xml"/>`)
  presRels.push(`<Relationship Id="rId${k + 4}" Type="${REL}/tableStyles" Target="tableStyles.xml"/>`)
  zip.file('ppt/presentation.xml', `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId${k}"/></p:notesMasterIdLst>${n ? `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>` : ''}<p:sldSz cx="${E(SLIDE_W)}" cy="${E(SLIDE_H)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join('')}</Relationships>`)
  zip.file('ppt/presProps.xml', `${HEAD}<p:presentationPr ${NS}/>`)
  zip.file('ppt/viewProps.xml', `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`)
  zip.file('ppt/tableStyles.xml', `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)
  zip.file('ppt/theme/theme1.xml', themeXml(theme, theme?.name || 'DAH'))
  zip.file('ppt/theme/theme2.xml', themeXml(theme, 'Notes'))
  const txStyles = '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr lang="ko-KR"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr lang="ko-KR"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr lang="ko-KR"/></a:lvl1pPr></p:otherStyle></p:txStyles>'
  zip.file('ppt/slideMasters/slideMaster1.xml', `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}</p:spTree></p:cSld>${CLRMAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>${txStyles}</p:sldMaster>`)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`)
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="빈 화면"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`)
  zip.file(
    'ppt/notesMasters/notesMaster1.xml',
    `${HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></p:txBody></p:sp></p:spTree></p:cSld>${CLRMAP}<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`
  )
  zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/theme" Target="../theme/theme2.xml"/></Relationships>`)

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  zip.file('docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>DAH Slides</dc:creator><cp:lastModifiedBy>DAH Slides</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  zip.file('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DAH Slides</Application><Slides>${n}</Slides><Notes>${n}</Notes><HiddenSlides>${slides.filter((s) => s.hidden).length}</HiddenSlides><PresentationFormat>와이드스크린</PresentationFormat></Properties>`)
  zip.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`)
  zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${ct.join('')}</Types>`)

  onProgress?.(n, n)
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' })
  return { blob, skipped }
}
