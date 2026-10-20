// IR -> .docx (Word 최적화). 순수 ESM, 브라우저/Node 양쪽. 의존: jszip 만.
// `docx` 패키지는 쓰지 않는다: 칸 대각선, 요소 순서, 대체 글꼴, 앵커 그림, 콘텐츠 컨트롤을 직접 통제하려고 OOXML 을 손으로 쓴다.
// 규칙과 근거는 docx-notes.md.
import JSZip from '../hwp/jszip.js'
import { normalizeIR, U, pageDims, tableGrid } from './schema.js'
import {
  esc, cleanText, hex6, HIGHLIGHT_HEX, fontInfo, lineHeightK, percentToAutoLine, DEFAULT_CHECK_FONT,
} from './docxShared.js'

const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]/
const NON_ASCII_RE = /[^\u0000-\u007F]/

const ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'both', distribute: 'distribute' }
const UNDERLINE = { single: 'single', double: 'double', dotted: 'dotted', dash: 'dash' }
const BORDER_STYLE = { solid: 'single', dashed: 'dashed', dotted: 'dotted', double: 'double', 'thick-thin': 'thickThinSmallGap' }
const V_ALIGN = { top: 'top', middle: 'center', bottom: 'bottom' }

// ---- 줄 간격 계산 (공개: 시험과 문서화용) ----
// 한 문단의 줄 간격을 워드 값으로 바꾼다. 돌려주는 pitchPt 는 한글에서 기대하는 줄 피치(글자 크기 x 비율)다.
//   hybrid(기본): 글자만 있는 문단은 exact(고정값), 그림·위첨자 섞인 문단은 글꼴 보정한 auto 배수
//   calibrated : 항상 auto 배수 = 240 * (percent/100) / lineK   (lineK = 글꼴 한 줄 높이 비율, docxShared.FONT_DB)
//   exact      : 항상 exact
//   multiple   : percent 를 그대로 배수로 (한컴 docx 내보내기 방식, 비교용. 글꼴마다 줄 높이가 달라진다)
export function computeLineSpec(p, ir, opts = {}) {
  const d = ir.defaults
  const ls = p.lineSpacing || d.lineSpacing || { mode: 'percent', value: 160 }
  const info = paragraphFontInfo(p, ir)
  const S = info.maxSizePt
  if (ls.mode === 'exactPt') return { line: U.ptToDxa(ls.value), rule: 'exact', pitchPt: ls.value, mode: 'exactPt' }
  if (ls.mode === 'atLeastPt') return { line: U.ptToDxa(ls.value), rule: 'atLeast', pitchPt: ls.value, mode: 'atLeastPt' }
  const pct = ls.value
  const T = (S * pct) / 100
  const mode = opts.lineSpacingMode || 'hybrid'
  const k = info.lineK // 문단에서 쓰는 글꼴 중 가장 큰 한 줄 높이 비율, 모르는 글꼴이 있으면 null
  const imageOnly = info.hasImage && !info.hasText
  if (imageOnly) return { line: 240, rule: 'auto', pitchPt: null, mode: 'imageSingle' }
  if (mode === 'multiple') return { line: Math.round((240 * pct) / 100), rule: 'auto', pitchPt: T, mode }
  const wantAuto = mode === 'calibrated' || (mode === 'hybrid' && (info.hasImage || info.hasScript))
  if (wantAuto) {
    if (k) return { line: percentToAutoLine(pct, k), rule: 'auto', pitchPt: T, mode: 'calibrated', k }
    return { line: U.ptToDxa(T), rule: 'atLeast', pitchPt: T, mode: 'atLeastFallback' }
  }
  return { line: U.ptToDxa(T), rule: 'exact', pitchPt: T, mode: 'exact' }
}

function effFonts(run, ir) {
  const d = ir.defaults.font
  return { ko: run.font?.ko || d.ko, latin: run.font?.latin || d.latin }
}

function paragraphFontInfo(p, ir) {
  const dSize = ir.defaults.sizePt
  let maxSize = 0
  let lineK = 0
  let unknown = false
  let hasImage = false
  let hasText = false
  let hasScript = false
  const used = new Set()
  for (const r of p.runs || []) {
    if (r.image) { hasImage = true; continue }
    const txt = r.text || (r.check ? '☐' : r.field ? '1' : '')
    if (!txt && !r.br && !r.tab) continue
    hasText = true
    const sz = r.sizePt || dSize
    if (sz > maxSize) maxSize = sz
    if (r.sup || r.sub) hasScript = true
    const f = effFonts(r, ir)
    const fk = r.check ? DEFAULT_CHECK_FONT : (HANGUL_RE.test(txt) ? f.ko : /[\u0000-\u007F]/.test(txt) && !NON_ASCII_RE.test(txt) ? f.latin : f.ko)
    used.add(fk)
  }
  if (!maxSize) maxSize = p.x?.markSizePt || dSize
  // 문단 표시(문단 끝 기호)의 글꼴도 줄 높이에 든다: 기본 한글 글꼴
  if (!used.size) used.add(ir.defaults.font.ko)
  for (const name of used) {
    const k = lineHeightK(name)
    if (!k) unknown = true
    else if (k > lineK) lineK = k
  }
  return { maxSizePt: maxSize, lineK: unknown ? null : lineK, hasImage, hasText, hasScript, fonts: [...used] }
}

// ---- 쓰기 맥락 ----
class Part {
  constructor(name) { this.name = name; this.rels = []; this.n = 0 }
  addRel(type, target, external = false) {
    const id = 'rId' + (++this.n)
    this.rels.push({ id, type, target, external })
    return id
  }
}
const REL = {
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  fontTable: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp' }

function sniffMime(data) {
  if (!data || data.length < 4) return null
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif'
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp'
  return null
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data
  if (typeof data === 'string') {
    const b = data.replace(/^data:[^,]*,/, '')
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b, 'base64'))
    const s = atob(b); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out
  }
  if (data && data.buffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return null
}

export async function writeDocx(irIn, opts = {}) {
  const { ir, issues } = normalizeIR(irIn)
  const onIssue = (m) => { issues.push(m) }
  const ctx = {
    ir, opts, issue: (path, msg) => { onIssue({ path, msg }) },
    fonts: new Map(), // 이름 -> 순서
    media: new Map(), // asset id -> { file, mime, bytes }
    docPrId: 0,
    anchorN: 0,
    sdtId: 100,
  }
  ctx.useFont = (name) => { if (name && !ctx.fonts.has(name)) ctx.fonts.set(name, ctx.fonts.size) }
  ctx.useFont(ir.defaults.font.ko); ctx.useFont(ir.defaults.font.latin); ctx.useFont(DEFAULT_CHECK_FONT)

  const docPart = new Part('document')
  docPart.addRel(REL.styles, 'styles.xml')
  docPart.addRel(REL.settings, 'settings.xml')
  docPart.addRel(REL.fontTable, 'fontTable.xml')

  const pg = ir.page
  const dims = pageDims(pg)
  const bodyWPt = U.mmToPt(dims.bodyWMm)

  // 머리말/꼬리말
  let hdr = null; let ftr = null
  if (ir.header?.length) {
    const part = new Part('header1')
    const xml = rootXml('hdr', blocksXml(ir.header, ctx, part, { kind: 'hf', hf: 'header', bodyWPt }, 'header'))
    hdr = { part, xml, rId: docPart.addRel(REL.header, 'header1.xml'), heightPt: estimateBlocksPt(ir.header, ir, opts) }
  }
  if (ir.footer?.length) {
    const part = new Part('footer1')
    const xml = rootXml('ftr', blocksXml(ir.footer, ctx, part, { kind: 'hf', hf: 'footer', bodyWPt }, 'footer'))
    ftr = { part, xml, rId: docPart.addRel(REL.footer, 'footer1.xml'), heightPt: estimateBlocksPt(ir.footer, ir, opts) }
  }

  // 본문
  const bodyInner = blocksXml(ir.body, ctx, docPart, { kind: 'body', bodyWPt }, 'body')
  const sect = sectPrXml(ir, dims, hdr, ftr, ctx)
  const docXml = rootXml('document', bodyInner + sect, true)

  const zip = new JSZip()
  const parts = ['/word/document.xml', '/word/styles.xml', '/word/settings.xml', '/word/fontTable.xml']
  const overrides = {
    '/word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    '/word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
    '/word/settings.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    '/word/fontTable.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
    '/docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
    '/docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  }
  if (hdr) overrides['/word/header1.xml'] = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
  if (ftr) overrides['/word/footer1.xml'] = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'
  void parts
  const exts = new Set()
  for (const m of ctx.media.values()) exts.add(m.ext)
  const ctXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    [...exts].map((e) => `<Default Extension="${e}" ContentType="${e === 'jpeg' ? 'image/jpeg' : 'image/' + e}"/>`).join('') +
    Object.entries(overrides).map(([k, v]) => `<Override PartName="${k}" ContentType="${v}"/>`).join('') + '</Types>'
  zip.file('[Content_Types].xml', ctXml)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`)
  zip.file('docProps/core.xml', coreXml(ir, opts))
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>docIR</Application><AppVersion>1.0</AppVersion></Properties>`)
  zip.file('word/document.xml', docXml)
  zip.file('word/styles.xml', stylesXml(ir, opts))
  zip.file('word/settings.xml', settingsXml(opts))
  zip.file('word/fontTable.xml', fontTableXml(ctx, opts))
  if (hdr) { zip.file('word/header1.xml', hdr.xml); zip.file('word/_rels/header1.xml.rels', relsXml(hdr.part)) }
  if (ftr) { zip.file('word/footer1.xml', ftr.xml); zip.file('word/_rels/footer1.xml.rels', relsXml(ftr.part)) }
  zip.file('word/_rels/document.xml.rels', relsXml(docPart))
  for (const m of ctx.media.values()) zip.file('word/media/' + m.file, m.bytes)

  if (opts.onIssue) for (const i of issues) opts.onIssue(i)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

function relsXml(part) {
  // 그림 관계는 문서/머리말/꼬리말 각자 가진다. 미디어 파일은 공용 word/media 라서 target 이 같다.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    part.rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') + '</Relationships>'
}

function rootXml(tag, inner) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14">${tag === 'document' ? `<w:body>${inner}</w:body>` : inner}</w:${tag}>`
}

function coreXml(ir, opts) {
  const created = ir.meta.created ? new Date(ir.meta.created) : new Date(opts.now || Date.now())
  const iso = (isNaN(created) ? new Date() : created).toISOString().replace(/\.\d+Z$/, 'Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(cleanText(ir.meta.title || ''))}</dc:title><dc:creator>${esc(cleanText(ir.meta.author || ''))}</dc:creator><cp:lastModifiedBy>${esc(cleanText(ir.meta.author || ''))}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`
}

// ---- 쪽 설정 ----
// 머리말 규칙(문서화): IR 의 headerMm 은 "본문 위쪽 여백 안쪽에 있는 머리말 띠의 높이"로 읽는다.
//   워드: 본문 시작 = max(pgMar.top, header + 머리말 내용 높이)
//   w:header(쪽 위 가장자리에서 머리말까지 거리) = max(0, top - max(headerMm, 머리말 내용 추정 높이))
//   => 머리말 내용이 headerMm 이내면 본문은 IR 의 top 에서 시작, 넘치면 머리말을 위로 끌어올려 본문이 밀리지 않게 하고(가장자리 0 까지), 그래도 모자라면 issue.
function sectPrXml(ir, dims, hdr, ftr, ctx) {
  const pg = ir.page
  const m = pg.marginMm
  const topPt = U.mmToPt(m.top); const botPt = U.mmToPt(m.bottom)
  let headerDist = Math.max(0, topPt - Math.max(U.mmToPt(pg.headerMm ?? 0), hdr ? hdr.heightPt : 0))
  let footerDist = Math.max(0, botPt - Math.max(U.mmToPt(pg.footerMm ?? 0), ftr ? ftr.heightPt : 0))
  if (hdr && hdr.heightPt > topPt) ctx.issue('header', `머리말 높이(${hdr.heightPt.toFixed(1)}pt)가 위 여백(${topPt.toFixed(1)}pt)보다 커서 워드에서 본문이 아래로 밀립니다`)
  if (ftr && ftr.heightPt > botPt) ctx.issue('footer', `꼬리말 높이(${ftr.heightPt.toFixed(1)}pt)가 아래 여백(${botPt.toFixed(1)}pt)보다 커서 워드에서 본문이 위로 밀립니다`)
  const land = pg.orientation === 'landscape'
  const w = U.mmToDxa(dims.wMm); const h = U.mmToDxa(dims.hMm)
  const cols = pg.columns && pg.columns.n > 1 ? `<w:cols w:num="${pg.columns.n}" w:space="${U.mmToDxa(pg.columns.gapMm || 5)}"/>` : ''
  return `<w:sectPr>${hdr ? `<w:headerReference w:type="default" r:id="${hdr.rId}"/>` : ''}${ftr ? `<w:footerReference w:type="default" r:id="${ftr.rId}"/>` : ''}` +
    `<w:pgSz w:w="${w}" w:h="${h}"${land ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${U.mmToDxa(m.top)}" w:right="${U.mmToDxa(m.right)}" w:bottom="${U.mmToDxa(m.bottom)}" w:left="${U.mmToDxa(m.left)}" w:header="${U.ptToDxa(headerDist)}" w:footer="${U.ptToDxa(footerDist)}" w:gutter="${U.mmToDxa(pg.gutterMm || 0)}"/>${cols}</w:sectPr>`
}

// 머리말/꼬리말 내용 높이 추정(pt). 줄 수는 br 개수로만 센다(자동 줄바꿈은 못 센다).
function estimateBlocksPt(blocks, ir, opts) {
  let sum = 0
  for (const b of blocks) {
    if (b.t === 'p') {
      const spec = computeLineSpec(b, ir, opts)
      const info = paragraphFontInfo(b, ir)
      let pitch = spec.pitchPt || info.maxSizePt * (info.lineK || 1.2)
      const lines = 1 + (b.runs || []).filter((r) => r.br).length
      let imgH = 0
      for (const r of b.runs || []) if (r.image) imgH = Math.max(imgH, r.image.hPt)
      sum += Math.max(pitch * lines, imgH) + (b.spaceBeforePt || 0) + (b.spaceAfterPt || 0)
    } else if (b.t === 'table') {
      for (const r of b.rows) {
        let rh = r.heightPt || 0
        if (!rh) rh = ir.defaults.sizePt * 1.6 + 3
        sum += rh
      }
    } else if (b.t === 'figure') {
      if (!b.float) sum += b.hPt
    }
  }
  return sum
}

// ---- styles / settings / fontTable ----
function rFontsAttr(ko, latin, hint) {
  return `<w:rFonts w:ascii="${esc(latin)}" w:eastAsia="${esc(ko)}" w:hAnsi="${esc(latin)}" w:cs="${esc(latin)}"${hint ? ' w:hint="eastAsia"' : ''}/>`
}

function stylesXml(ir, opts) {
  const d = ir.defaults
  const jc = d.align && d.align !== 'left' ? `<w:jc w:val="${ALIGN[d.align] || 'left'}"/>` : ''
  const color = hex6(d.color)
  const sz = Math.round(d.sizePt * 2)
  const heading = (n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${n - 1}"/></w:pPr></w:style>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${rFontsAttr(d.font.ko, d.font.latin, false)}${color && color !== '000000' ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${jc}</w:pPr></w:pPrDefault></w:docDefaults>` +
    // Normal: 한글 공문 기본(쪽 격자 없음, 영문·숫자 자동 간격 끔, 외톨이줄 보호 끔)
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:snapToGrid w:val="0"/></w:pPr></w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
    `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
    `<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
    [1, 2, 3, 4, 5, 6].map(heading).join('') +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/></w:style>` +
    `</w:styles>`
}

function settingsXml(opts) {
  // 호환 항목은 실제 워드(맥)가 저장한 한림멘토링 보고서 docx 의 설정을 따른다 (docx-notes.md 참고)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:zoom w:percent="100"/><w:defaultTabStop w:val="800"/><w:characterSpacingControl w:val="doNotCompress"/>` +
    `<w:compat><w:spaceForUL/><w:balanceSingleByteDoubleByteWidth/><w:doNotLeaveBackslashAlone/><w:ulTrailSpace/><w:doNotExpandShiftReturn/><w:useFELayout/>` +
    `<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>` +
    `<w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>` +
    `<w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>` +
    `<w:compatSetting w:name="doNotFlipMirrorIndents" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>` +
    `<w:compatSetting w:name="differentiateMultirowTableHeaders" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat>` +
    `<w:themeFontLang w:val="en-US" w:eastAsia="ko-KR"/><w:decimalSymbol w:val="."/><w:listSeparator w:val=","/></w:settings>`
}

function guessFallback(name) {
  if (/명조|바탕|Myeongjo|Batang|Serif|Roman/i.test(name)) return '바탕'
  return '맑은 고딕'
}

function fontTableXml(ctx, opts) {
  const out = []
  for (const name of ctx.fonts.keys()) {
    const f = fontInfo(name)
    if (f) {
      const alt = f.fallback || f.alt
      out.push(`<w:font w:name="${esc(name)}">${!f.safe && alt ? `<w:altName w:val="${esc(alt)}"/>` : ''}<w:panose1 w:val="${f.panose}"/><w:charset w:val="${f.charset}"/><w:family w:val="${f.family}"/><w:pitch w:val="${f.pitch || 'variable'}"/></w:font>`)
    } else {
      const ko = HANGUL_RE.test(name)
      out.push(`<w:font w:name="${esc(name)}">${ko ? `<w:altName w:val="${esc(opts.fallbackKo || guessFallback(name))}"/>` : ''}<w:charset w:val="${ko ? '81' : '00'}"/><w:family w:val="auto"/><w:pitch w:val="default"/></w:font>`)
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${out.join('')}</w:fonts>`
}

// ---- 블록 ----
function spacerP(extra = '') {
  // 표 사이/표 뒤의 빈 문단: 높이 1pt (exact)
  return `<w:p><w:pPr>${extra}<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`
}

function blocksXml(blocks, ctx, part, env, path) {
  const out = []
  let pendingBreak = false
  const counters = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.t === 'pagebreak') { pendingBreak = true; continue }
    if (b.t === 'p') {
      out.push(paragraphXml(b, ctx, part, env, { pageBreakBefore: pendingBreak, counters }))
      pendingBreak = false
    } else if (b.t === 'table') {
      if (pendingBreak) { out.push(spacerP('<w:pageBreakBefore/>')); pendingBreak = false }
      if (out.length && out[out.length - 1].startsWith('<w:tbl>')) out.push(spacerP())
      out.push(tableXml(b, ctx, part, env, `${path}[${i}]`))
    } else if (b.t === 'figure') {
      out.push(figureXml(b, ctx, part, env, pendingBreak))
      pendingBreak = false
      if (b.caption) out.push(paragraphXml(b.caption, ctx, part, env, { counters }))
    }
  }
  if (env.kind === 'cell' || env.kind === 'body' || env.kind === 'hf') {
    // 칸과 본문, 머리말은 반드시 문단으로 끝나야 한다 (표로 끝나면 워드가 복구를 요구한다)
    if (!out.length || out[out.length - 1].startsWith('<w:tbl>')) out.push(spacerP())
  }
  return out.join('')
}

// ---- 글꼴/글자 ----
function runPr(r, ctx, extra = {}) {
  const d = ctx.ir.defaults
  const ko = r.font?.ko; const latin = r.font?.latin
  const parts = []
  const txt = r.text || ''
  if (extra.rStyle) parts.push(`<w:rStyle w:val="${extra.rStyle}"/>`)
  const needFonts = ko || latin
  if (needFonts) {
    const kk = ko || d.font.ko; const ll = latin || d.font.latin
    ctx.useFont(kk); ctx.useFont(ll)
    parts.push(rFontsAttr(kk, ll, NON_ASCII_RE.test(txt) || extra.hint))
  } else if (NON_ASCII_RE.test(txt) || extra.hint) {
    parts.push(`<w:rFonts w:hint="eastAsia"/>`)
  }
  if (r.bold) parts.push('<w:b/><w:bCs/>')
  if (r.italic) parts.push('<w:i/><w:iCs/>')
  if (r.strike) parts.push('<w:strike/>')
  const col = hex6(r.color)
  if (col) parts.push(`<w:color w:val="${col}"/>`)
  const size = r.sizePt || d.sizePt
  if (r.spacingPct) parts.push(`<w:spacing w:val="${Math.round((r.spacingPct / 100) * size * 20)}"/>`)
  if (r.scalePct && r.scalePct !== 100) parts.push(`<w:w w:val="${Math.min(600, Math.max(1, Math.round(r.scalePct)))}"/>`)
  if (r.sizePt && r.sizePt !== d.sizePt) parts.push(`<w:sz w:val="${Math.round(r.sizePt * 2)}"/><w:szCs w:val="${Math.round(r.sizePt * 2)}"/>`)
  let shdFill = null
  if (r.highlight) {
    const hx = '#' + (hex6(r.highlight) || 'FFFF00')
    const named = Object.entries(HIGHLIGHT_HEX).find(([, v]) => v === hx)
    if (named) parts.push(`<w:highlight w:val="${named[0]}"/>`)
    else shdFill = hx.slice(1)
  }
  if (r.underline) parts.push(`<w:u w:val="${UNDERLINE[r.underline] || 'single'}"/>`)
  if (shdFill) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shdFill}"/>`)
  if (r.sup) parts.push('<w:vertAlign w:val="superscript"/>')
  else if (r.sub) parts.push('<w:vertAlign w:val="subscript"/>')
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : ''
}

function textRuns(r, ctx) {
  // 텍스트 + 탭/줄바꿈을 한 w:r 안에
  const rpr = runPr(r, ctx)
  const bits = []
  const txt = cleanText(r.text || '')
  if (txt) {
    const segs = txt.split(/(\n|\t)/)
    for (const s of segs) {
      if (s === '\n') bits.push('<w:br/>')
      else if (s === '\t') bits.push('<w:tab/>')
      else if (s) bits.push(`<w:t xml:space="preserve">${esc(s)}</w:t>`)
    }
  }
  if (r.br) bits.push('<w:br/>')
  if (r.tab) bits.push('<w:tab/>')
  if (!bits.length) return ''
  return `<w:r>${rpr}${bits.join('')}</w:r>`
}

function fieldRuns(r, ctx) {
  const rpr = runPr({ ...r, text: '' }, ctx)
  const instr = r.field === 'page' ? ' PAGE ' : r.field === 'pages' ? ' NUMPAGES ' : ' DATE \\@ "yyyy-MM-dd" '
  const cached = r.field === 'date' ? new Date(ctx.opts.now || Date.now()).toISOString().slice(0, 10) : '1'
  return `<w:r>${rpr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rpr}<w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r>${rpr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr}<w:t>${cached}</w:t></w:r><w:r>${rpr}<w:fldChar w:fldCharType="end"/></w:r>`
}

function checkRun(r, ctx) {
  const checked = !!r.check.checked
  const glyph = checked ? '☑' : '☐'
  const font = ctx.opts.checkFont || DEFAULT_CHECK_FONT
  ctx.useFont(font)
  const base = { ...r, text: glyph, font: { ko: font, latin: font } }
  const rpr = runPr(base, ctx, { hint: true })
  if (ctx.opts.contentControls) {
    const id = ++ctx.sdtId
    return `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/><w14:checkedState w14:val="2611" w14:font="${esc(font)}"/><w14:uncheckedState w14:val="2610" w14:font="${esc(font)}"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r>${rpr}<w:t>${glyph}</w:t></w:r></w:sdtContent></w:sdt>`
  }
  return `<w:r>${rpr}<w:t>${glyph}</w:t></w:r>`
}

function mediaFor(id, ctx) {
  if (ctx.media.has(id)) return ctx.media.get(id)
  const a = ctx.ir.assets[id]
  if (!a) { ctx.issue(`asset ${id}`, '이미지 자산을 찾을 수 없음'); return null }
  const bytes = toBytes(a.data)
  if (!bytes) { ctx.issue(`asset ${id}`, '이미지 바이트가 없음'); return null }
  const mime = sniffMime(bytes) || a.mime
  if (!MIME_EXT[mime]) { ctx.issue(`asset ${id}`, `지원하지 않는 이미지 형식(${mime}): 워드에는 PNG/JPEG/GIF 로 바꿔 넣어야 함`); return null }
  const ext = MIME_EXT[mime]
  const m = { file: `image${ctx.media.size + 1}.${ext}`, ext, mime, bytes }
  ctx.media.set(id, m)
  return m
}

function drawingXml(m, rId, wPt, hPt, alt, ctx, float) {
  const cx = U.ptToEmu(wPt); const cy = U.ptToEmu(hPt)
  const id = ++ctx.docPrId
  const name = `그림 ${id}`
  const graphic = `<wp:docPr id="${id}" name="${esc(name)}" descr="${esc(cleanText(alt || ''))}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(m.file)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`
  if (!float) return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${graphic}</wp:inline></w:drawing>`
  const hAlign = float.x === 'left' ? 'left' : float.x === 'center' ? 'center' : 'right'
  const posV = float.y === 'para' ? `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` : `<wp:positionV relativeFrom="margin"><wp:align>top</wp:align></wp:positionV>`
  const wrap = float.wrap === 'none' ? '<wp:wrapNone/>' : float.wrap === 'topBottom' ? '<wp:wrapTopAndBottom/>' : '<wp:wrapSquare wrapText="bothSides"/>'
  const rel = 251658240 + ++ctx.anchorN
  return `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${rel}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>${hAlign}</wp:align></wp:positionH>${posV}<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}${graphic}</wp:anchor></w:drawing>`
}

function imageRel(part, m) {
  part.imgRel = part.imgRel || new Map()
  if (!part.imgRel.has(m.file)) part.imgRel.set(m.file, part.addRel(REL.image, 'media/' + m.file))
  return part.imgRel.get(m.file)
}

function imageRun(r, ctx, part) {
  const m = mediaFor(r.image.id, ctx)
  if (!m) return ''
  const rId = imageRel(part, m)
  return `<w:r><w:rPr><w:noProof/></w:rPr>${drawingXml(m, rId, r.image.wPt, r.image.hPt, r.image.alt, ctx, null)}</w:r>`
}

// ---- 문단 ----
function markerWidthPt(marker, size) {
  let w = 0
  for (const ch of marker + ' ') {
    if (ch === ' ') w += size * 0.35
    else if (/[0-9.)\]]/.test(ch)) w += size * 0.55
    else w += size * 1.0
  }
  return w
}

function listMarker(p, counters) {
  const l = p.list
  if (!l) return null
  if (l.marker) return l.marker
  const level = l.level || 0
  if (l.kind === 'bullet') return ['•', '◦', '▪'][level % 3]
  if (l.kind === 'check') return '☐'
  // ordered: 같은 수준의 연속 번호
  counters.length = Math.min(counters.length, level + 1)
  counters[level] = (counters[level] || 0) + 1
  const n = counters[level]
  if (level === 0) return `${n}.`
  if (level === 1) return `${'가나다라마바사아자차카타파하'[(n - 1) % 14]}.`
  return `${n})`
}

function paragraphXml(p, ctx, part, env, extra = {}) {
  const ir = ctx.ir
  const d = ir.defaults
  const pPr = []
  if (p.heading && p.heading >= 1 && p.heading <= 6) pPr.push(`<w:pStyle w:val="Heading${p.heading}"/>`)
  else if (env.kind === 'hf') pPr.push(`<w:pStyle w:val="${env.hf === 'footer' ? 'Footer' : 'Header'}"/>`)
  if (p.keepNext) pPr.push('<w:keepNext/>')
  if (p.keepLines) pPr.push('<w:keepLines/>')
  if (p.pageBreakBefore || extra.pageBreakBefore) pPr.push('<w:pageBreakBefore/>')
  pPr.push(`<w:widowControl w:val="${p.widow ? 1 : 0}"/>`)
  if (p.bg && hex6(p.bg)) pPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex6(p.bg)}"/>`)
  if (ctx.opts.kinsoku === false) pPr.push('<w:kinsoku w:val="0"/>')
  const breakByChar = p.x?.breakByChar ?? ctx.opts.breakByChar ?? false
  if (breakByChar) pPr.push('<w:wordWrap w:val="0"/>')
  // 줄 간격
  const spec = computeLineSpec(p, ir, ctx.opts)
  const before = p.spaceBeforePt ? U.ptToDxa(p.spaceBeforePt) : 0
  const after = p.spaceAfterPt ? U.ptToDxa(p.spaceAfterPt) : 0
  pPr.push(`<w:spacing w:before="${before}" w:after="${after}" w:line="${spec.line}" w:lineRule="${spec.rule}"/>`)
  // 들여쓰기 + 항목 부호
  if (!p.list && extra.counters) extra.counters.length = 0
  const marker = p.list ? listMarker(p, extra.counters || []) : null
  let left = p.indent?.leftPt ?? null
  let first = p.indent?.firstLinePt ?? null
  const size0 = (p.runs.find((r) => r.sizePt)?.sizePt) || d.sizePt
  if (marker && left == null && first == null) {
    const hang = markerWidthPt(marker, size0)
    left = (p.list.level || 0) * size0 * 1.5 + hang
    first = -hang
  }
  if (left != null || p.indent?.rightPt != null || first != null) {
    const at = []
    if (left != null) at.push(`w:left="${U.ptToDxa(left)}"`)
    if (p.indent?.rightPt != null) at.push(`w:right="${U.ptToDxa(p.indent.rightPt)}"`)
    if (first != null && first < 0) at.push(`w:hanging="${U.ptToDxa(-first)}"`)
    else if (first) at.push(`w:firstLine="${U.ptToDxa(first)}"`)
    if (at.length) pPr.push(`<w:ind ${at.join(' ')}/>`)
  }
  const align = p.align || d.align
  if (align && align !== d.align) pPr.push(`<w:jc w:val="${ALIGN[align] || 'left'}"/>`)
  // 문단 표시 서식: 마지막 글자 서식(빈 문단이면 x.markSizePt)
  const lastRun = [...p.runs].reverse().find((r) => !r.image && (r.text || r.check))
  const markSz = lastRun?.sizePt || p.x?.markSizePt
  const markFont = lastRun?.font
  const rp = []
  if (markFont && (markFont.ko || markFont.latin)) { const kk = markFont.ko || d.font.ko; const ll = markFont.latin || d.font.latin; ctx.useFont(kk); ctx.useFont(ll); rp.push(rFontsAttr(kk, ll, false)) }
  if (markSz && markSz !== d.sizePt) rp.push(`<w:sz w:val="${Math.round(markSz * 2)}"/><w:szCs w:val="${Math.round(markSz * 2)}"/>`)
  if (rp.length) pPr.push(`<w:rPr>${rp.join('')}</w:rPr>`)

  // 내용
  const body = []
  if (marker) {
    const first0 = p.runs.find((r) => !r.image && !r.field) || {}
    const isGlyph = /^[☐☑☒▢]$/.test(marker)
    const mrun = { ...first0, text: marker + ' ', link: undefined, br: undefined, tab: undefined, image: undefined, highlight: first0.highlight }
    if (isGlyph) { mrun.font = { ko: ctx.opts.checkFont || DEFAULT_CHECK_FONT, latin: ctx.opts.checkFont || DEFAULT_CHECK_FONT }; ctx.useFont(mrun.font.ko) }
    body.push(textRuns(mrun, ctx))
  }
  let i = 0
  while (i < p.runs.length) {
    const r = p.runs[i]
    if (r.link) {
      let j = i; const group = []
      while (j < p.runs.length && p.runs[j].link === r.link) { group.push(p.runs[j]); j++ }
      const rId = part.addRel(REL.hyperlink, r.link, true)
      const inner = group.map((g) => runXml({ ...g, _hyper: true }, ctx, part)).join('')
      body.push(`<w:hyperlink r:id="${rId}" w:history="1">${inner}</w:hyperlink>`)
      i = j
    } else { body.push(runXml(r, ctx, part)); i++ }
  }
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${body.join('')}</w:p>`
}

function runXml(r, ctx, part) {
  if (r.image) return imageRun(r, ctx, part)
  if (r.field) return fieldRuns(r, ctx)
  if (r.check) return checkRun(r, ctx)
  if (r._hyper) {
    const base = { ...r }
    const pr = runPr(base, ctx, { rStyle: !r.color && !r.underline ? 'Hyperlink' : null })
    const bits = []
    const txt = cleanText(r.text || '')
    if (txt) bits.push(`<w:t xml:space="preserve">${esc(txt)}</w:t>`)
    if (r.br) bits.push('<w:br/>')
    return bits.length ? `<w:r>${pr}${bits.join('')}</w:r>` : ''
  }
  return textRuns(r, ctx)
}

// ---- 그림(블록) ----
function figureXml(f, ctx, part, env, pageBreakBefore) {
  const m = mediaFor(f.id, ctx)
  if (!m) return ''
  const rId = imageRel(part, m)
  const pb = pageBreakBefore ? '<w:pageBreakBefore/>' : ''
  if (f.float) {
    // 떠 있는 그림은 높이 1pt 짜리 닻 문단 안에 둔다 (문단 흐름에 줄을 더하지 않으려고)
    const dr = drawingXml(m, rId, f.wPt, f.hPt, f.alt, ctx, f.float)
    return `<w:p><w:pPr>${pb}<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:noProof/></w:rPr>${dr}</w:r></w:p>`
  }
  const jc = f.align && f.align !== 'left' ? `<w:jc w:val="${ALIGN[f.align]}"/>` : ''
  return `<w:p><w:pPr>${f.caption ? '<w:keepNext/>' : ''}${pb}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${jc}</w:pPr><w:r><w:rPr><w:noProof/></w:rPr>${drawingXml(m, rId, f.wPt, f.hPt, f.alt, ctx, null)}</w:r></w:p>`
}

// ---- 표 ----
function borderXml(tag, b) {
  if (!b || b.style === 'none') return `<w:${tag} w:val="nil"/>`
  const sz = Math.min(96, Math.max(2, Math.round((b.widthPt || 0.5) * 8)))
  return `<w:${tag} w:val="${BORDER_STYLE[b.style] || 'single'}" w:sz="${sz}" w:space="0" w:color="${hex6(b.color) || 'auto'}"/>`
}
const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null)
function pickBorder(a, b) {
  // 같은 변에 서로 다른 선이 지정되면: 선이 있는 쪽, 둘 다 있으면 굵은 쪽
  if (!a) return b
  if (!b) return a
  if (a.style === 'none') return b
  if (b.style === 'none') return a
  return (b.widthPt || 0) > (a.widthPt || 0) ? b : a
}

function tableXml(t, ctx, part, env, path) {
  const g = tableGrid(t)
  if (g.error) { ctx.issue(path, `표 병합 오류: ${g.error}`) }
  const nCols = t.colPt.length; const nRows = t.rows.length
  // 열 폭(dxa): 누적 반올림으로 합이 표 폭과 같게
  const xs = [0]; let cum = 0
  for (const w of t.colPt) { cum += w; xs.push(Math.round(cum * 20)) }
  const colDxa = t.colPt.map((_, i) => xs[i + 1] - xs[i])
  const spanW = (c, cs) => xs[c + cs] - xs[c]
  const tblW = xs[nCols]

  // 변 격자: hE[r][c] 는 r-1 행과 r 행 사이(c 열), vE[r][c] 는 c-1 열과 c 열 사이(r 행)
  const hE = Array.from({ length: nRows + 1 }, () => Array(nCols).fill(undefined))
  const vE = Array.from({ length: nRows }, () => Array(nCols + 1).fill(undefined))
  const tb = t.border
  const anchors = []
  if (!g.error) {
    for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) { const x = g.grid[r][c]; if (x.anchor) anchors.push({ r, c, cell: t.rows[x.ri].cells[x.ki] }) }
  }
  const setE = (arr, i, j, b) => { arr[i][j] = pickBorder(arr[i][j], b) }
  for (const { r, c, cell } of anchors) {
    const cs = cell.colspan || 1; const rs = cell.rowspan || 1; const bd = cell.border || {}
    for (let k = 0; k < cs; k++) { if (bd.top) setE(hE, r, c + k, bd.top); if (bd.bottom) setE(hE, r + rs, c + k, bd.bottom) }
    for (let k = 0; k < rs; k++) { if (bd.left) setE(vE, r + k, c, bd.left); if (bd.right) setE(vE, r + k, c + cs, bd.right) }
  }
  const dflt = (outer) => (tb && tb.style !== 'none' ? tb : null)
  const eh = (r, c) => hE[r][c] ?? dflt()
  const ev = (r, c) => vE[r][c] ?? dflt()
  const anyBorder = !!tb || anchors.some(({ cell }) => cell.border && Object.keys(cell.border).length)

  const pad = t.padPt || { t: 1.4, r: 5.1, b: 1.4, l: 5.1 }
  const jc = t.align && t.align !== 'left' ? `<w:jc w:val="${ALIGN[t.align]}"/>` : ''
  const tblPr = `<w:tblPr><w:tblW w:w="${tblW}" w:type="dxa"/>${jc}<w:tblInd w:w="0" w:type="dxa"/>` +
    (tb ? `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => borderXml(s, tb)).join('')}</w:tblBorders>` : '') +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${U.ptToDxa(pad.t)}" w:type="dxa"/><w:left w:w="${U.ptToDxa(pad.l)}" w:type="dxa"/><w:bottom w:w="${U.ptToDxa(pad.b)}" w:type="dxa"/><w:right w:w="${U.ptToDxa(pad.r)}" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>`
  const tblGrid = `<w:tblGrid>${colDxa.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`

  const rowsXml = []
  for (let r = 0; r < nRows; r++) {
    const row = t.rows[r]
    const trPr = []
    if (row.cantSplit) trPr.push('<w:cantSplit/>')
    if (row.heightPt) trPr.push(`<w:trHeight w:val="${U.ptToDxa(row.heightPt)}" w:hRule="${row.heightRule === 'exact' ? 'exact' : 'atLeast'}"/>`)
    if (row.header) trPr.push('<w:tblHeader/>')
    const cells = []
    if (g.error) { // 병합이 틀린 표: 칸을 순서대로 한 줄에 놓는다(문서가 열리게)
      let c = 0
      for (const cell of row.cells) { const cs = Math.min(cell.colspan || 1, nCols - c); if (cs < 1) break; cells.push(cellXml(cell, spanW(c, cs), cs, null, null, null, ctx, part, env, `${path}.r${r}`)); c += cs }
      while (c < nCols) { cells.push(`<w:tc><w:tcPr><w:tcW w:w="${colDxa[c]}" w:type="dxa"/></w:tcPr>${spacerP()}</w:tc>`); c++ }
      rowsXml.push(`<w:tr>${trPr.length ? `<w:trPr>${trPr.join('')}</w:trPr>` : ''}${cells.join('')}</w:tr>`)
      continue
    }
    let c = 0
    while (c < nCols) {
      const x = g.grid[r][c]
      const anchor = t.rows[x.ri].cells[x.ki]
      const cs = anchor.colspan || 1; const rs = anchor.rowspan || 1
      const isAnchor = x.anchor
      // 이 칸 둘레 선 (병합 칸 안쪽 변은 없음)
      const edges = anyBorder ? {
        top: r === x.r ? eh(r, c) : null,
        bottom: r === x.r + rs - 1 ? eh(r + 1, c) : null,
        left: ev(r, c),
        right: ev(r, c + cs),
      } : null
      cells.push(cellXml(anchor, spanW(c, cs), cs, isAnchor ? (rs > 1 ? 'restart' : null) : 'continue', edges, isAnchor, ctx, part, env, `${path}.r${x.r}c${x.c}`))
      c += cs
    }
    rowsXml.push(`<w:tr>${trPr.length ? `<w:trPr>${trPr.join('')}</w:trPr>` : ''}${cells.join('')}</w:tr>`)
  }
  return `<w:tbl>${tblPr}${tblGrid}${rowsXml.join('')}</w:tbl>`
}

function cellXml(cell, wDxa, cs, vmerge, edges, isAnchor, ctx, part, env, path) {
  const pr = [`<w:tcW w:w="${wDxa}" w:type="dxa"/>`]
  if (cs > 1) pr.push(`<w:gridSpan w:val="${cs}"/>`)
  if (vmerge === 'restart') pr.push('<w:vMerge w:val="restart"/>')
  else if (vmerge === 'continue') pr.push('<w:vMerge/>')
  const bd = cell.border || {}
  if (edges) {
    const bs = []
    // 순서: top, left, bottom, right, (insideH, insideV), tl2br, tr2bl
    bs.push(borderXml('top', edges.top)); bs.push(borderXml('left', edges.left)); bs.push(borderXml('bottom', edges.bottom)); bs.push(borderXml('right', edges.right))
    if (isAnchor && bd.diagDown) bs.push(borderXml('tl2br', bd.diagDown))
    if (isAnchor && bd.diagUp) bs.push(borderXml('tr2bl', bd.diagUp))
    pr.push(`<w:tcBorders>${bs.join('')}</w:tcBorders>`)
  } else if (bd.diagDown || bd.diagUp) {
    const bs = []
    if (bd.diagDown) bs.push(borderXml('tl2br', bd.diagDown)); if (bd.diagUp) bs.push(borderXml('tr2bl', bd.diagUp))
    pr.push(`<w:tcBorders>${bs.join('')}</w:tcBorders>`)
  }
  const bg = hex6(cell.bg)
  if (bg) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>`)
  if (cell.padPt) {
    const p = cell.padPt
    pr.push(`<w:tcMar><w:top w:w="${U.ptToDxa(p.t)}" w:type="dxa"/><w:left w:w="${U.ptToDxa(p.l)}" w:type="dxa"/><w:bottom w:w="${U.ptToDxa(p.b)}" w:type="dxa"/><w:right w:w="${U.ptToDxa(p.r)}" w:type="dxa"/></w:tcMar>`)
  }
  if (cell.textDir === 'vertical') pr.push('<w:textDirection w:val="tbRlV"/>')
  if (cell.vAlign && cell.vAlign !== 'top') pr.push(`<w:vAlign w:val="${V_ALIGN[cell.vAlign] || 'top'}"/>`)
  const inner = vmerge === 'continue' ? spacerP() : blocksXml(cell.blocks, ctx, part, { ...env, kind: 'cell', bodyWPt: wDxa / 20 }, path)
  return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${inner}</w:tc>`
}
