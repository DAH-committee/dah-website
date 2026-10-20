// .docx -> IR. 워드, 구글 문서, 페이지스, 한글에서 저장한 docx 를 읽는다. 순수 ESM(브라우저/Node), 의존: jszip 만.
// 규칙과 근거는 docx-notes.md.
import JSZip from '../hwp/jszip.js'
import { normalizeIR, U } from './schema.js'
import { canonFontName, lineHeightK, autoLineToPercent, HIGHLIGHT_HEX } from './docxShared.js'

// ================= XML 파서 (DOM 없이) =================
const NS_CANON = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': 'wp',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://schemas.microsoft.com/office/word/2010/wordml': 'w14',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'urn:schemas-microsoft-com:vml': 'v',
  'urn:schemas-microsoft-com:office:office': 'o',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape': 'wps',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
  'http://schemas.openxmlformats.org/package/2006/content-types': 'ct',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/terms/': 'dcterms',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unent = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  return ENT[e] ?? m
}))

// 반환: { name, attrs, children, text }. 이름과 속성 접두사는 위 표의 대표 접두사로 바꾼다.
export function parseXml(src) {
  if (typeof src !== 'string') src = new TextDecoder('utf-8').decode(src)
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)
  let i = 0
  const n = src.length
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [{ node: root, ns: {} }]
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    if (lt > i) { const t = src.slice(i, lt); if (stack.length > 1) stack[stack.length - 1].node.text += unent(t) }
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); stack[stack.length - 1].node.text += src.slice(lt + 9, e); i = e + 3; continue }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') { i = src.indexOf('>', lt) + 1; continue }
    if (src[lt + 1] === '/') { stack.pop(); i = src.indexOf('>', lt) + 1; continue }
    // 시작 태그: 속성 읽기
    let j = lt + 1
    while (j < n && !/[\s/>]/.test(src[j])) j++
    const rawName = src.slice(lt + 1, j)
    const rawAttrs = []
    let selfClose = false
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++
      if (src[j] === '/') { selfClose = true; j++; continue }
      if (src[j] === '>') { j++; break }
      let k = j
      while (k < n && src[k] !== '=' && !/[\s/>]/.test(src[k])) k++
      const an = src.slice(j, k)
      j = k
      while (/\s/.test(src[j])) j++
      if (src[j] !== '=') { rawAttrs.push([an, '']); continue }
      j++
      while (/\s/.test(src[j])) j++
      const q = src[j]
      const e = src.indexOf(q, j + 1)
      rawAttrs.push([an, unent(src.slice(j + 1, e))])
      j = e + 1
    }
    i = j
    const parentNs = stack[stack.length - 1].ns
    let ns = parentNs
    for (const [an, av] of rawAttrs) if (an === 'xmlns' || an.startsWith('xmlns:')) { if (ns === parentNs) ns = { ...parentNs }; ns[an === 'xmlns' ? '' : an.slice(6)] = av }
    const canon = (qn, isAttr) => {
      const c = qn.indexOf(':')
      if (c < 0) return isAttr ? qn : (ns[''] && NS_CANON[ns['']] ? NS_CANON[ns['']] + ':' + qn : qn)
      const pfx = qn.slice(0, c)
      if (pfx === 'xml' || pfx === 'xmlns') return qn
      const uri = ns[pfx]
      return (uri && NS_CANON[uri] ? NS_CANON[uri] : pfx) + ':' + qn.slice(c + 1)
    }
    const attrs = {}
    for (const [an, av] of rawAttrs) { if (an === 'xmlns' || an.startsWith('xmlns:')) continue; attrs[canon(an, true)] = av }
    const node = { name: canon(rawName, false), attrs, children: [], text: '' }
    stack[stack.length - 1].node.children.push(node)
    if (!selfClose) stack.push({ node, ns })
  }
  return root.children[0]
}

const ch = (n, name) => n?.children.find((c) => c.name === name)
const chs = (n, name) => (n ? n.children.filter((c) => c.name === name) : [])
const av = (n, a) => n?.attrs[a]
const wv = (n) => n?.attrs['w:val']
const num = (v) => (v === undefined || v === '' ? undefined : Number(v))
const onoff = (n) => { if (!n) return undefined; const v = n.attrs['w:val']; return v === undefined ? true : !['0', 'false', 'off'].includes(v) }

// ================= 이미지 크기 =================
function imageInfo(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { mime: 'image/png', w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { mime: 'image/gif', w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) return { mime: 'image/bmp', w: b[18] | (b[19] << 8) | (b[20] << 16), h: Math.abs((b[22] | (b[23] << 8) | (b[24] << 16)) << 0) }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
    return { mime: 'image/jpeg', w: 0, h: 0 }
  }
  return null
}

// ================= 스타일/번호/테마 =================
const PPR_KEYS_NESTED = ['ind', 'spacing']
function mergeProps(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    if (v === undefined) continue
    if (PPR_KEYS_NESTED.includes(k) || k === 'rFonts' || k === 'shd') out[k] = { ...(base?.[k] || {}), ...v }
    else out[k] = v
  }
  return out
}

function decodeRPr(n) {
  const o = {}
  if (!n) return o
  const f = ch(n, 'w:rFonts')
  if (f) {
    o.rFonts = {}
    for (const k of ['ascii', 'hAnsi', 'eastAsia', 'cs', 'asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'csTheme', 'hint']) if (av(f, 'w:' + k) !== undefined) o.rFonts[k] = av(f, 'w:' + k)
  }
  const rs = ch(n, 'w:rStyle'); if (rs) o.rStyle = wv(rs)
  for (const k of ['b', 'i', 'strike', 'dstrike', 'caps', 'smallCaps', 'vanish', 'noProof']) { const e = ch(n, 'w:' + k); if (e) o[k] = onoff(e) }
  const col = ch(n, 'w:color'); if (col) o.color = wv(col)
  const sz = ch(n, 'w:sz'); if (sz) o.sz = num(wv(sz))
  const sp = ch(n, 'w:spacing'); if (sp) o.charSpacing = num(wv(sp))
  const w = ch(n, 'w:w'); if (w) o.w = num(wv(w))
  const hl = ch(n, 'w:highlight'); if (hl) o.highlight = wv(hl)
  const u = ch(n, 'w:u'); if (u) o.u = wv(u)
  const shd = ch(n, 'w:shd'); if (shd) o.shd = { val: av(shd, 'w:val'), fill: av(shd, 'w:fill'), color: av(shd, 'w:color') }
  const va = ch(n, 'w:vertAlign'); if (va) o.vertAlign = wv(va)
  const lang = ch(n, 'w:lang'); if (lang) o.lang = { val: av(lang, 'w:val'), eastAsia: av(lang, 'w:eastAsia') }
  return o
}

function decodePPr(n) {
  const o = {}
  if (!n) return o
  const jc = ch(n, 'w:jc'); if (jc) o.jc = wv(jc)
  const ind = ch(n, 'w:ind')
  if (ind) {
    o.ind = {}
    const g = (k) => num(av(ind, 'w:' + k))
    for (const [k, to] of [['left', 'left'], ['start', 'left'], ['right', 'right'], ['end', 'right'], ['firstLine', 'firstLine'], ['hanging', 'hanging'], ['leftChars', 'leftChars'], ['startChars', 'leftChars'], ['firstLineChars', 'firstLineChars'], ['hangingChars', 'hangingChars']]) { const v = g(k); if (v !== undefined) o.ind[to] = v }
  }
  const sp = ch(n, 'w:spacing')
  if (sp) {
    o.spacing = {}
    for (const k of ['before', 'after', 'line', 'beforeLines', 'afterLines']) { const v = num(av(sp, 'w:' + k)); if (v !== undefined) o.spacing[k] = v }
    if (av(sp, 'w:lineRule')) o.spacing.lineRule = av(sp, 'w:lineRule')
    if (onoff({ attrs: { 'w:val': av(sp, 'w:beforeAutospacing') } }) && av(sp, 'w:beforeAutospacing') !== undefined) o.spacing.beforeAuto = true
    if (onoff({ attrs: { 'w:val': av(sp, 'w:afterAutospacing') } }) && av(sp, 'w:afterAutospacing') !== undefined) o.spacing.afterAuto = true
  }
  for (const k of ['keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'wordWrap', 'contextualSpacing', 'kinsoku']) { const e = ch(n, 'w:' + k); if (e) o[k] = onoff(e) }
  const ol = ch(n, 'w:outlineLvl'); if (ol) o.outlineLvl = num(wv(ol))
  const np = ch(n, 'w:numPr'); if (np) o.numPr = { numId: wv(ch(np, 'w:numId')), ilvl: wv(ch(np, 'w:ilvl')) }
  const ps = ch(n, 'w:pStyle'); if (ps) o.pStyle = wv(ps)
  const shd = ch(n, 'w:shd'); if (shd) o.shd = { val: av(shd, 'w:val'), fill: av(shd, 'w:fill'), color: av(shd, 'w:color') }
  const rp = ch(n, 'w:rPr'); if (rp) o.markRPr = decodeRPr(rp)
  return o
}

function parseStyles(root) {
  const st = { defaults: { p: {}, r: {} }, byId: {}, defaultPara: null, defaultTable: null, defaultChar: null }
  if (!root) return st
  const dd = ch(root, 'w:docDefaults')
  if (dd) {
    st.defaults.r = decodeRPr(ch(ch(dd, 'w:rPrDefault'), 'w:rPr'))
    st.defaults.p = decodePPr(ch(ch(dd, 'w:pPrDefault'), 'w:pPr'))
  }
  for (const s of chs(root, 'w:style')) {
    const id = av(s, 'w:styleId')
    const o = { id, type: av(s, 'w:type'), name: wv(ch(s, 'w:name')), basedOn: wv(ch(s, 'w:basedOn')), p: decodePPr(ch(s, 'w:pPr')), r: decodeRPr(ch(s, 'w:rPr')), tblPr: ch(s, 'w:tblPr'), tcPr: ch(s, 'w:tcPr') }
    st.byId[id] = o
    if (av(s, 'w:default') === '1' || av(s, 'w:default') === 'true') { if (o.type === 'paragraph') st.defaultPara = id; if (o.type === 'table') st.defaultTable = id; if (o.type === 'character') st.defaultChar = id }
  }
  return st
}

function styleChain(st, id) {
  const out = []; const seen = new Set()
  while (id && st.byId[id] && !seen.has(id)) { seen.add(id); out.unshift(st.byId[id]); id = st.byId[id].basedOn }
  return out
}

function parseTheme(root) {
  const t = { major: {}, minor: {} }
  if (!root) return t
  const fs = ch(ch(ch(root, 'a:themeElements'), 'a:fontScheme'), 'a:minorFont')
  const mj = ch(ch(ch(root, 'a:themeElements'), 'a:fontScheme'), 'a:majorFont')
  for (const [k, f] of [['minor', fs], ['major', mj]]) {
    if (!f) continue
    t[k].latin = av(ch(f, 'a:latin'), 'typeface')
    t[k].ea = av(ch(f, 'a:ea'), 'typeface') || chs(f, 'a:font').find((x) => av(x, 'script') === 'Hang')?.attrs.typeface
  }
  return t
}

function parseNumbering(root) {
  const nb = { abs: {}, nums: {} }
  if (!root) return nb
  for (const a of chs(root, 'w:abstractNum')) {
    const lv = {}
    for (const l of chs(a, 'w:lvl')) {
      lv[av(l, 'w:ilvl')] = { start: num(wv(ch(l, 'w:start'))) ?? 1, fmt: wv(ch(l, 'w:numFmt')) || 'decimal', text: wv(ch(l, 'w:lvlText')) ?? '', p: decodePPr(ch(l, 'w:pPr')), r: decodeRPr(ch(l, 'w:rPr')), suff: wv(ch(l, 'w:suff')) || 'tab', pStyle: wv(ch(l, 'w:pStyle')), isLgl: !!ch(l, 'w:isLgl') }
    }
    nb.abs[av(a, 'w:abstractNumId')] = { lv, link: wv(ch(a, 'w:numStyleLink')) }
  }
  for (const nn of chs(root, 'w:num')) {
    const o = { abs: wv(ch(nn, 'w:abstractNumId')), over: {} }
    for (const ov of chs(nn, 'w:lvlOverride')) { const l = ch(ov, 'w:lvl'); const s = ch(ov, 'w:startOverride'); o.over[av(ov, 'w:ilvl')] = { start: num(wv(s)), lvl: l ? { start: num(wv(ch(l, 'w:start'))), fmt: wv(ch(l, 'w:numFmt')), text: wv(ch(l, 'w:lvlText')) } : null } }
    nb.nums[av(nn, 'w:numId')] = o
  }
  return nb
}

const GANADA = '가나다라마바사아자차카타파하'
const CHOSUNG = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'
const KO_NUM = '영일이삼사오육칠팔구'
function roman(n, lower) { const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v } return lower ? s.toLowerCase() : s }
function fmtNum(n, fmt) {
  switch (fmt) {
    case 'decimal': return String(n)
    case 'decimalZero': return String(n).padStart(2, '0')
    case 'upperRoman': return roman(n, false)
    case 'lowerRoman': return roman(n, true)
    case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1)
    case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1)
    case 'ganada': return GANADA[(n - 1) % GANADA.length]
    case 'chosung': return CHOSUNG[(n - 1) % CHOSUNG.length]
    case 'decimalEnclosedCircle': case 'decimalEnclosedCircleChinese': return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n)
    case 'koreanDigital': case 'koreanCounting': return String(n).split('').map((d) => KO_NUM[+d]).join('')
    case 'bullet': return ''
    default: return String(n)
  }
}
const BULLET_MAP = { '\uF0B7': '•', '\uF0A7': '▪', '\uF0D8': '➢', '\uF0FC': '✓', '\uF06E': '■', '\uF076': '❖', '\uF0A8': '□', '\uF0E0': '➔', '\uF09F': '•', '\uF0B2': '○', '\uF06C': '●', '\uF0A1': '○' }
const mapBullet = (t) => (t.length === 1 && BULLET_MAP[t]) || (t === 'o' ? '○' : t) || '•'

const SYM_MAP = { 'F0A8': '☐', 'F0FE': '☑', 'F0FD': '☒', 'F0A7': '▪', 'F06E': '■', 'F0FC': '✓', 'F0B7': '•', 'F0D8': '➢', 'F0E0': '➔' }

// ================= 본 변환 =================
export async function readDocx(bytes, opts = {}) {
  const issues = []
  const issue = (path, msg) => { issues.push({ path, msg }); opts.onIssue?.({ path, msg }) }
  const head = bytes instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)) ? bytes : new Uint8Array(bytes)
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) throw new Error('이 파일은 .docx 가 아니라 구형 한글(.hwp)이나 워드(.doc) 형식입니다. 새 형식(.docx, .hwpx)으로 저장한 뒤 열어 주세요.')
  if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new Error('.docx 파일(zip)이 아닙니다.')
  const zip = await JSZip.loadAsync(bytes)
  const text = async (p) => { const f = zip.file(p); return f ? f.async('string') : null }
  const relsOf = async (partPath) => {
    const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1)
    const rp = dir + '_rels/' + partPath.slice(dir.length) + '.rels'
    const x = await text(rp)
    const map = {}
    if (x) for (const r of chs(parseXml(x), 'rel:Relationship')) { const t = av(r, 'Target'); map[av(r, 'Id')] = { type: av(r, 'Type'), target: av(r, 'TargetMode') === 'External' ? t : resolvePath(dir, t), external: av(r, 'TargetMode') === 'External' } }
    return map
  }
  const resolvePath = (dir, t) => {
    if (t.startsWith('/')) return t.slice(1)
    const parts = (dir + t).split('/'); const out = []
    for (const s of parts) { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s) }
    return out.join('/')
  }
  const rootRels = parseXml(await text('_rels/.rels'))
  const mainRel = chs(rootRels, 'rel:Relationship').find((r) => /officeDocument$/.test(av(r, 'Type')))
  const mainPath = mainRel ? resolvePath('', av(mainRel, 'Target')) : 'word/document.xml'
  const doc = parseXml(await text(mainPath))
  const docRels = await relsOf(mainPath)
  const relByType = (re) => Object.values(docRels).find((r) => re.test(r.type))
  const styles = parseStyles(await (async () => { const r = relByType(/\/styles$/); const x = r ? await text(r.target) : null; return x ? parseXml(x) : null })())
  const numbering = parseNumbering(await (async () => { const r = relByType(/\/numbering$/); const x = r ? await text(r.target) : null; return x ? parseXml(x) : null })())
  const theme = parseTheme(await (async () => { const r = relByType(/\/theme$/); const x = r ? await text(r.target) : null; return x ? parseXml(x) : null })())
  const settings = await (async () => { const r = relByType(/\/settings$/); const x = r ? await text(r.target) : null; return x ? parseXml(x) : null })()
  void settings

  const assets = {}
  const assetByPath = new Map()
  let assetN = 0
  const numCounters = {} // numId -> 수준별 현재 번호

  // ---- 글꼴 해석 ----
  const themeFont = (ref, kind) => {
    const t = ref.startsWith('major') ? theme.major : theme.minor
    if (kind === 'ea') return t.ea || '맑은 고딕'
    return t.latin
  }
  const fontsOf = (rf) => {
    if (!rf) return {}
    const ascii = rf.ascii || (rf.asciiTheme ? themeFont(rf.asciiTheme, 'latin') : undefined) || rf.hAnsi || (rf.hAnsiTheme ? themeFont(rf.hAnsiTheme, 'latin') : undefined)
    const ea = rf.eastAsia || (rf.eastAsiaTheme ? themeFont(rf.eastAsiaTheme, 'ea') : undefined)
    return { ascii, ea }
  }

  // ---- 효과적 서식 ----
  const baseRun = () => mergeProps({}, styles.defaults.r)
  const effRun = (pStyleId, rStyleId, direct, extraBase) => {
    let r = baseRun()
    if (extraBase) r = mergeProps(r, extraBase)
    for (const s of styleChain(styles, pStyleId || styles.defaultPara)) r = mergeProps(r, s.r)
    for (const s of styleChain(styles, rStyleId)) r = mergeProps(r, s.r)
    return mergeProps(r, direct)
  }
  const effPara = (pStyleId, direct, numLvlP) => {
    let p = mergeProps({}, styles.defaults.p)
    for (const s of styleChain(styles, pStyleId || styles.defaultPara)) p = mergeProps(p, s.p)
    if (numLvlP) p = mergeProps(p, numLvlP)
    return mergeProps(p, direct)
  }

  // ---- IR 기본값 ----
  const normalStyleId = styles.defaultPara
  const dRun = effRun(normalStyleId, null, {})
  const dPara = effPara(normalStyleId, {})
  const dFonts = fontsOf(dRun.rFonts)
  const defaultsKo = canonFontName(dFonts.ea || '맑은 고딕')
  const defaultsLatin = canonFontName(dFonts.ascii || dFonts.ea || '맑은 고딕')
  const defaultSizePt = (dRun.sz ?? 20) / 2
  const defaultColor = colorHex(dRun.color) || '#000000'
  const defaultAlign = mapJc(dPara.jc) || 'left'
  const lineOf = (pp, sizePt, fontName) => {
    const sp = pp.spacing || {}
    const line = sp.line ?? 240
    const rule = sp.lineRule || 'auto'
    if (rule === 'exact') return { mode: 'exactPt', value: round1(line / 20) }
    if (rule === 'atLeast') return { mode: 'atLeastPt', value: round1(line / 20) }
    const k = lineHeightK(fontName) || opts.unknownLineK || 1.15
    return { mode: 'percent', value: Math.round(autoLineToPercent(line, k)) }
  }
  const defaults = { font: { ko: defaultsKo, latin: defaultsLatin }, sizePt: defaultSizePt, lineSpacing: lineOf(dPara, defaultSizePt, defaultsKo), color: defaultColor, align: defaultAlign }

  // ---- 번호 목록 ----
  const markerFor = (numPr, level0) => {
    const num0 = numbering.nums[numPr.numId]
    if (!num0) return null
    let abs = numbering.abs[num0.abs]
    if (abs?.link) { /* numStyleLink: 드문 경우, 생략 */ }
    if (!abs) return null
    const ilvl = Number(numPr.ilvl ?? level0 ?? 0)
    const lv = { ...(abs.lv[ilvl] || {}) }
    const ov = num0.over[ilvl]
    if (ov?.lvl) { if (ov.lvl.fmt) lv.fmt = ov.lvl.fmt; if (ov.lvl.text !== undefined && ov.lvl.text !== null) lv.text = ov.lvl.text; if (ov.lvl.start !== undefined) lv.start = ov.lvl.start }
    if (!lv.fmt) return null
    const cnt = (numCounters[numPr.numId] = numCounters[numPr.numId] || [])
    // 수준 ilvl 번호 증가, 더 깊은 수준은 초기화
    cnt.length = Math.max(cnt.length, ilvl + 1)
    for (let i = ilvl + 1; i < cnt.length; i++) cnt[i] = undefined
    cnt[ilvl] = cnt[ilvl] === undefined ? (ov?.start ?? lv.start ?? 1) : cnt[ilvl] + 1
    if (lv.fmt === 'bullet') return { kind: 'bullet', level: ilvl, marker: mapBullet(lv.text), lv }
    if (lv.fmt === 'none') return { kind: 'ordered', level: ilvl, marker: '', lv }
    let t = lv.text || `%${ilvl + 1}.`
    t = t.replace(/%([1-9])/g, (m, d) => {
      const li = Number(d) - 1
      const l2 = abs.lv[li]
      const n = cnt[li] ?? (l2?.start ?? 1)
      return fmtNum(n, l2?.fmt || lv.fmt)
    })
    return { kind: 'ordered', level: ilvl, marker: t, lv }
  }

  // ---- 이미지 ----
  const addAsset = async (relId, rels) => {
    const rel = rels[relId]
    if (!rel) return null
    if (assetByPath.has(rel.target)) return assetByPath.get(rel.target)
    const f = zip.file(rel.target)
    if (!f) { issue(rel.target, '이미지 파일이 없음'); return null }
    const data = new Uint8Array(await f.async('uint8array'))
    const info = imageInfo(data)
    if (!info) { issue(rel.target, `지원하지 않는 이미지 형식(${rel.target.split('.').pop()}): PNG/JPEG/GIF/BMP 만 읽음`); assetByPath.set(rel.target, null); return null }
    const id = 'img' + ++assetN
    assets[id] = { mime: info.mime, data, w: info.w, h: info.h }
    assetByPath.set(rel.target, id)
    return id
  }

  // ---- 문단 ----
  const ctxState = { sectPrs: [] }

  async function convertBlocks(parent, rels, bodyWPt, path) {
    const blocks = []
    for (const n of parent.children) {
      if (n.name === 'w:p') {
        const got = await convertParagraph(n, rels, bodyWPt, `${path}/p`)
        blocks.push(...got)
      } else if (n.name === 'w:tbl') {
        blocks.push(await convertTable(n, rels, bodyWPt, `${path}/tbl`))
      } else if (n.name === 'w:sdt') {
        const c = ch(n, 'w:sdtContent')
        if (c) blocks.push(...(await convertBlocks(c, rels, bodyWPt, path)))
      } else if (n.name === 'mc:AlternateContent') {
        const c = ch(n, 'mc:Choice'); if (c) blocks.push(...(await convertBlocks(c, rels, bodyWPt, path)))
      }
    }
    return cleanBlocks(blocks)
  }

  // 작성기가 넣은 1pt 짜리 간격 문단(표 사이, 표 뒤, 쪽 나눔 전)을 걷어낸다
  function cleanBlocks(blocks) {
    const out = []
    for (const b of blocks) {
      if (b.t === 'p' && b.x?.spacer && !b.runs.length) {
        if (b.pageBreakBefore) { out.push({ t: 'pagebreak' }); continue }
        if (out[out.length - 1]?.t === 'table') continue
      }
      out.push(b)
    }
    for (const b of out) if (b.x) { delete b.x.spacer; if (!Object.keys(b.x).length) delete b.x }
    // 그림 하나만 든 문단은 Figure 로 (keepNext 가 있으면 다음 문단은 캡션: 워드 캡션 삽입 규칙과 작성기 규칙이 같음)
    const res = []
    for (let i = 0; i < out.length; i++) {
      const b = out[i]
      if (b.t === 'p' && b.runs.length === 1 && b.runs[0].image && !b.list) {
        const im = b.runs[0].image
        const f = { t: 'figure', id: im.id, wPt: im.wPt, hPt: im.hPt, ...(im.alt ? { alt: im.alt } : {}), ...(b.align && b.align !== defaults.align ? { align: b.align } : {}) }
        const nx = out[i + 1]
        if (b.keepNext && nx && nx.t === 'p' && nx.runs.length && !nx.list) { f.caption = nx; i++ }
        res.push(f)
      } else res.push(b)
    }
    return res
  }

  async function convertParagraph(pNode, rels, bodyWPt, path) {
    const out = []
    const pPrN = ch(pNode, 'w:pPr')
    const direct = decodePPr(pPrN)
    if (pPrN && ch(pPrN, 'w:sectPr')) ctxState.sectPrs.push(ch(pPrN, 'w:sectPr'))
    let numInfo = null
    const styleP = effPara(direct.pStyle, {})
    const numPrRaw = direct.numPr || styleP.numPr
    let numLvlP = null
    if (numPrRaw && numPrRaw.numId && numPrRaw.numId !== '0') {
      numInfo = markerFor({ numId: numPrRaw.numId, ilvl: direct.numPr?.ilvl ?? numPrRaw.ilvl ?? 0 }, 0)
      if (numInfo?.lv?.p) numLvlP = numInfo.lv.p
    }
    const pp = effPara(direct.pStyle, direct, numLvlP)
    // ---- 런 수집 ----
    const toks = []
    const pStyleRun = effRun(direct.pStyle, null, {})
    void pStyleRun
    const anchors = []
    const walk = async (nodes, linkUrl) => {
      for (const n of nodes) {
        switch (n.name) {
          case 'w:r': await runTokens(n, linkUrl); break
          case 'w:hyperlink': {
            const rid = av(n, 'r:id')
            const url = rid && rels[rid] ? rels[rid].target + (av(n, 'w:anchor') ? '' : '') : (av(n, 'w:anchor') ? '#' + av(n, 'w:anchor') : undefined)
            await walk(n.children, url || linkUrl)
            break
          }
          case 'w:fldSimple': {
            const instr = av(n, 'w:instr') || ''
            const f = fieldKind(instr)
            if (f) toks.push({ k: 'field', field: f, rPr: decodeRPr(ch(ch(n, 'w:r'), 'w:rPr')), rStyle: null })
            else await walk(n.children, linkUrl)
            break
          }
          case 'w:sdt': {
            const sp = ch(n, 'w:sdtPr'); const cb = sp ? ch(sp, 'w14:checkbox') : null
            const c = ch(n, 'w:sdtContent')
            if (cb) {
              const cv = ch(cb, 'w14:checked')?.attrs['w14:val']; const on = cv === '1' || cv === 'true'
              const r0 = c && (ch(c, 'w:r') || ch(ch(c, 'w:sdtContent'), 'w:r'))
              toks.push({ k: 'check', checked: on, rPr: decodeRPr(ch(r0, 'w:rPr')), rStyle: wv(ch(ch(r0, 'w:rPr'), 'w:rStyle')) })
            } else if (c) await walk(c.children, linkUrl)
            break
          }
          case 'w:smartTag': case 'w:ins': case 'w:customXml': case 'w:moveTo': case 'w:dir': case 'w:bdo': await walk(n.children, linkUrl); break
          case 'mc:AlternateContent': { const c = ch(n, 'mc:Choice'); if (c) await walk(c.children, linkUrl); break }
          default: break
        }
      }
    }
    const runTokens = async (r, linkUrl) => {
      const rPr = decodeRPr(ch(r, 'w:rPr'))
      const base = { rPr, link: linkUrl }
      for (const c of r.children) {
        switch (c.name) {
          case 'w:t': if (c.text) toks.push({ k: 'text', text: c.text, ...base }); break
          case 'w:tab': toks.push({ k: 'tab', ...base }); break
          case 'w:br': { const t = av(c, 'w:type'); if (t === 'page') toks.push({ k: 'pagebreak' }); else toks.push({ k: 'br', ...base }); break }
          case 'w:cr': toks.push({ k: 'br', ...base }); break
          case 'w:noBreakHyphen': toks.push({ k: 'text', text: '-', ...base }); break
          case 'w:sym': { const code = (av(c, 'w:char') || '').toUpperCase(); const g = SYM_MAP[code] || String.fromCodePoint(parseInt(code, 16) || 63); toks.push({ k: 'text', text: g, ...base }); break }
          case 'w:fldChar': toks.push({ k: 'fld', type: av(c, 'w:fldCharType') }); break
          case 'w:instrText': toks.push({ k: 'instr', text: c.text }); break
          case 'w:drawing': await drawingTokens(c, base); break
          case 'w:pict': await pictTokens(c, base); break
          case 'mc:AlternateContent': { const cc = ch(c, 'mc:Choice'); if (cc) for (const d of cc.children) if (d.name === 'w:drawing') await drawingTokens(d, base); break }
          default: break
        }
      }
    }
    const drawingTokens = async (dr, base) => {
      const inl = ch(dr, 'wp:inline'); const anc = ch(dr, 'wp:anchor')
      const host = inl || anc
      if (!host) return
      const ext = ch(host, 'wp:extent')
      const wPt = U.emuToPt(num(av(ext, 'cx')) || 0); const hPt = U.emuToPt(num(av(ext, 'cy')) || 0)
      const docPr = ch(host, 'wp:docPr')
      const alt = av(docPr, 'descr') || av(docPr, 'title') || ''
      const blip = findDesc(host, 'a:blip')
      if (!blip) { issue(path, '그림이 아닌 도형(텍스트 상자 등)은 읽지 않음'); return }
      const id = await addAsset(av(blip, 'r:embed') || av(blip, 'r:link'), rels)
      if (!id) return
      if (inl) toks.push({ k: 'image', image: { id, wPt: round1(wPt), hPt: round1(hPt), ...(alt ? { alt } : {}) }, ...base })
      else {
        const ph = ch(host, 'wp:positionH'); const pv = ch(host, 'wp:positionV')
        const hx = wv0(ch(ph, 'wp:align'))
        let x = hx === 'left' || hx === 'right' || hx === 'center' ? hx : null
        if (!x) { const off = num(ch(ph, 'wp:posOffset')?.text) || 0; const rel = av(ph, 'relativeFrom'); const refW = rel === 'page' ? 595.3 : bodyWPt; x = U.emuToPt(off) + wPt / 2 > refW / 2 + 20 ? 'right' : U.emuToPt(off) + wPt / 2 < refW / 2 - 20 ? 'left' : 'center' }
        const y = av(pv, 'relativeFrom') === 'paragraph' ? 'para' : 'top'
        const wrap = ch(host, 'wp:wrapTopAndBottom') ? 'topBottom' : ch(host, 'wp:wrapNone') ? 'none' : 'square'
        anchors.push({ t: 'figure', id, wPt: round1(wPt), hPt: round1(hPt), ...(alt ? { alt } : {}), float: { x, y, wrap } })
      }
    }
    const pictTokens = async (pict, base) => {
      const im = findDesc(pict, 'v:imagedata')
      if (!im) return
      const id = await addAsset(av(im, 'r:id'), rels)
      if (!id) return
      const shape = findDesc(pict, 'v:shape')
      const style = av(shape, 'style') || ''
      const gw = /width:([\d.]+)(pt|px)/.exec(style); const gh = /height:([\d.]+)(pt|px)/.exec(style)
      const toPt = (m, d) => (m ? (m[2] === 'px' ? U.pxToPt(+m[1]) : +m[1]) : d)
      toks.push({ k: 'image', image: { id, wPt: round1(toPt(gw, assets[id].w * 0.75)), hPt: round1(toPt(gh, assets[id].h * 0.75)) }, ...base })
    }
    await walk(pNode.children, undefined)

    // ---- 필드(복합) 정리: begin..instr..separate..결과..end ----
    const flat = []
    let fl = null
    const fstack = []
    for (const t of toks) {
      if (t.k === 'fld') {
        if (t.type === 'begin') { fl = { instr: '', phase: 'instr' }; fstack.push(fl) }
        else if (t.type === 'separate' && fl) fl.phase = 'result'
        else if (t.type === 'end' && fl) {
          const kind = fieldKind(fl.instr)
          if (kind) flat.push({ k: 'field', field: kind, rPr: fl.rPr || {} })
          fstack.pop(); fl = fstack[fstack.length - 1] || null
        }
        continue
      }
      if (fl && t.k === 'instr') { fl.instr += t.text; continue }
      if (fl && fl.phase === 'instr') continue
      if (fl && fl.phase === 'result') {
        const kind = fieldKind(fl.instr)
        if (kind) { if (!fl.rPr && t.rPr) fl.rPr = t.rPr; continue } // PAGE 등은 결과 글자를 버리고 필드 하나로
        const hl = /^\s*HYPERLINK\s+"?([^"\s]+)"?/i.exec(fl.instr)
        if (hl) t.link = hl[1]
      }
      flat.push(t)
    }
    // ---- 런 만들기 ----
    const rStyleFor = (rPr) => (/^hyperlink$/i.test(styles.byId[rPr?.rStyle]?.name || '') ? null : rPr?.rStyle)
    const runs = []
    const sizes = []
    let hasHangul = false
    let curPB = false
    let pbBefore = false
    const result = []
    const pushPara = (isLast) => {
      const merged = mergeRuns(runs.splice(0))
      result.push({ runs: merged, last: isLast })
    }
    const mkRun = (t, extra) => {
      const eff = effRun(direct.pStyle, rStyleFor(t.rPr), t.rPr || {}, numInfo && !runs.length && false ? numInfo.lv?.r : undefined)
      const r = {}
      const fo = fontsOf(eff.rFonts)
      const ko = canonFontName(fo.ea || dFonts.ea || '맑은 고딕'); const latin = canonFontName(fo.ascii || dFonts.ascii || ko)
      const font = {}
      if (ko !== defaults.font.ko) font.ko = ko
      if (latin !== defaults.font.latin) font.latin = latin
      if (eff.b) r.bold = true
      if (eff.i) r.italic = true
      const u = eff.u
      if (u && u !== 'none') r.underline = u === 'double' ? 'double' : u.startsWith('dotted') ? 'dotted' : u.includes('dash') || u.includes('Dash') ? 'dash' : 'single'
      if (eff.strike || eff.dstrike) r.strike = true
      if (eff.vertAlign === 'superscript') r.sup = true
      if (eff.vertAlign === 'subscript') r.sub = true
      const col = colorHex(eff.color)
      if (col && col !== defaults.color) r.color = col
      const sz = (eff.sz ?? 20) / 2
      if (sz !== defaults.sizePt) r.sizePt = sz
      if (eff.highlight && eff.highlight !== 'none') r.highlight = HIGHLIGHT_HEX[eff.highlight] || undefined
      else if (eff.shd && eff.shd.fill && eff.shd.fill !== 'auto' && eff.shd.val !== 'nil') r.highlight = '#' + eff.shd.fill.toUpperCase()
      if (eff.charSpacing) r.spacingPct = Math.round(((eff.charSpacing / 20) / sz) * 1000) / 10
      if (eff.w && eff.w !== 100) r.scalePct = eff.w
      if (Object.keys(font).length) r.font = font
      if (t.link) r.link = t.link
      if (eff.caps) (r.x = r.x || {}).caps = true
      if (eff.smallCaps) (r.x = r.x || {}).smallCaps = true
      Object.assign(r, extra)
      return { r, eff, sz, ko, latin }
    }
    for (const t of flat) {
      if (t.k === 'pagebreak') {
        if (!runs.length && !result.length && !curPB) pbBefore = true
        else { pushPara(false); result.push({ pagebreak: true }) }
        continue
      }
      if (t.k === 'text') {
        const { eff } = mkRun(t, {})
        if (eff.vanish) continue
        // ☐ ☑ ☒ 글자를 체크 런으로 뽑는다
        const parts = t.text.split(/([☐☑☒])/)
        for (const s of parts) {
          if (!s) continue
          if (/^[☐☑☒]$/.test(s)) { const { r, sz } = mkRun(t, {}); delete r.font; r.check = { checked: s !== '☐' }; runs.push(r); sizes.push(sz) }
          else { const { r, sz, ko } = mkRun(t, { text: s }); runs.push(r); sizes.push(sz); if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/.test(s)) hasHangul = true; void ko }
        }
      } else if (t.k === 'tab') { const { r } = mkRun(t, { tab: true }); runs.push(r) }
      else if (t.k === 'br') { const { r } = mkRun(t, { br: true }); runs.push(r) }
      else if (t.k === 'image') { runs.push({ image: t.image }) }
      else if (t.k === 'field') { const { r, sz } = mkRun(t, { field: t.field }); runs.push(r); sizes.push(sz) }
      else if (t.k === 'check') { const { r, sz } = mkRun(t, {}); delete r.font; r.check = { checked: t.checked }; runs.push(r); sizes.push(sz) }
    }
    pushPara(true)
    void curPB
    // ---- 문단 속성 ----
    const eff0 = effRun(direct.pStyle, null, direct.markRPr || {})
    const markSz = (eff0.sz ?? 20) / 2
    const maxSz = sizes.length ? Math.max(...sizes) : markSz
    const fo0 = fontsOf(eff0.rFonts)
    const lineFont = hasHangul || !fo0.ascii ? canonFontName(fo0.ea || dFonts.ea) : canonFontName(fo0.ascii)
    const paraProps = () => {
      const p = { t: 'p' }
      const al = mapJc(pp.jc) || 'left'
      if (al !== defaults.align) p.align = al
      const ind = {}
      const sizeForChars = maxSz
      const L = pp.ind?.left ?? (pp.ind?.leftChars != null ? (pp.ind.leftChars / 100) * sizeForChars * 20 : undefined)
      const R = pp.ind?.right
      let F
      if (pp.ind?.hanging != null) F = -pp.ind.hanging
      else if (pp.ind?.hangingChars != null) F = -(pp.ind.hangingChars / 100) * sizeForChars * 20
      else if (pp.ind?.firstLine != null) F = pp.ind.firstLine
      else if (pp.ind?.firstLineChars != null) F = (pp.ind.firstLineChars / 100) * sizeForChars * 20
      if (L) ind.leftPt = round1(L / 20)
      if (R) ind.rightPt = round1(R / 20)
      if (F) ind.firstLinePt = round1(F / 20)
      if (Object.keys(ind).length) p.indent = ind
      const sp = pp.spacing || {}
      let before = sp.before; let after = sp.after
      if (sp.beforeAuto) before = 280; if (sp.afterAuto) after = 280
      if (before == null && sp.beforeLines) before = (sp.beforeLines / 100) * maxSz * 20
      if (after == null && sp.afterLines) after = (sp.afterLines / 100) * maxSz * 20
      if (before) p.spaceBeforePt = round1(before / 20)
      if (after) p.spaceAfterPt = round1(after / 20)
      const ls = lineOf(pp, maxSz, lineFont)
      if (ls.mode !== defaults.lineSpacing.mode || ls.value !== defaults.lineSpacing.value) p.lineSpacing = ls
      if (pp.keepNext) p.keepNext = true
      if (pp.keepLines) p.keepLines = true
      if (pp.widowControl !== false) p.widow = true
      if (pp.wordWrap === false) (p.x = p.x || {}).breakByChar = true
      if (pp.outlineLvl != null && pp.outlineLvl < 6) p.heading = pp.outlineLvl + 1
      else { const sn = styles.byId[direct.pStyle]?.name || ''; const m = /^heading (\d)$/i.exec(sn); if (m) p.heading = +m[1] }
      const bg = pp.shd && pp.shd.fill && pp.shd.fill !== 'auto' ? '#' + pp.shd.fill.toUpperCase() : null
      if (bg) p.bg = bg
      if (numInfo && numInfo.marker !== undefined) p.list = { kind: numInfo.kind, level: numInfo.level, marker: numInfo.marker }
      return p
    }
    for (const seg of result) {
      if (seg.pagebreak) { out.push({ t: 'pagebreak' }); continue }
      const p = paraProps()
      p.runs = seg.runs
      if (out.length === 0 && pbBefore) p.pageBreakBefore = true
      else if (pp.pageBreakBefore && out.length === 0) p.pageBreakBefore = true
      // 직접 쓴 항목 부호 인식: 내어쓰기 + 문장 앞 부호
      if (!p.list) detectMarker(p)
      if (!seg.runs.length && markSz !== defaults.sizePt) (p.x = p.x || {}).markSizePt = markSz
      // 작성기가 넣은 1pt 간격 문단 표시
      const sp = pp.spacing || {}
      if (!seg.runs.length && sp.lineRule === 'exact' && (sp.line || 0) <= 30) (p.x = p.x || {}).spacer = true
      out.push(p)
    }
    // 앵커 그림은 문단 앞에 Figure 로. 앵커만 있는 문단(작성기의 닻 문단)은 버린다.
    if (anchors.length) {
      const only = out.length === 1 && out[0].t === 'p' && !out[0].runs.length
      const figs = anchors
      if (only) return [...figs]
      return [...figs, ...out]
    }
    // 끝에 남은 빈 문단 하나만 있는 결과는 그대로 둔다
    return out
  }

  const MARKER_RE = /^([▪▫▸►●○◦•‣∙·ㆍ※■□◆◇▶▷\-–—]|\(?\d{1,3}[.)]|\(?[가-하][.)]|[①-⑳]|[ⅰ-ⅹ][.)]?)(?:\s+|\t)/
  function detectMarker(p) {
    if (!(p.indent && p.indent.firstLinePt < 0)) return
    const first = p.runs[0]
    if (!first || !first.text) return
    const m = MARKER_RE.exec(first.text)
    if (!m) return
    const marker = m[1]
    first.text = first.text.slice(m[0].length)
    if (!first.text) p.runs.shift()
    const kind = /^\(?\d|^\(?[가-하]|^[①-⑳ⅰ-ⅹ]/.test(marker) ? 'ordered' : 'bullet'
    p.list = { kind, level: 0, marker }
  }

  function mergeRuns(runs) {
    const out = []
    for (const r of runs) {
      const prev = out[out.length - 1]
      if (prev && prev.text !== undefined && r.text !== undefined && !prev.br && !prev.tab && !r.br && !r.tab && sameFmt(prev, r)) { prev.text += r.text; continue }
      out.push(r)
    }
    return out
  }
  const sameFmt = (a, b) => { const { text: _a, ...x } = a; const { text: _b, ...y } = b; void _a; void _b; return JSON.stringify(x) === JSON.stringify(y) }

  // ---- 표 ----
  async function convertTable(tblN, rels, bodyWPt, path) {
    const tblPr = ch(tblN, 'w:tblPr')
    const styleId = wv(ch(tblPr, 'w:tblStyle')) || styles.defaultTable
    const chain = styleChain(styles, styleId)
    const styleTblPr = chain.map((s) => s.tblPr).filter(Boolean)
    const getBorders = () => {
      const res = {}
      const apply = (bn) => { if (!bn) return; for (const e of bn.children) res[e.name.slice(2)] = decodeBorder(e) }
      for (const sp of styleTblPr) apply(ch(sp, 'w:tblBorders'))
      apply(ch(tblPr, 'w:tblBorders'))
      return res
    }
    const tbl = getBorders()
    const getCellMar = () => {
      let m = { top: 0, left: 108, bottom: 0, right: 108 }
      const ap = (cm) => { if (!cm) return; for (const e of cm.children) { const k = e.name.slice(2).replace('start', 'left').replace('end', 'right'); m[k] = num(av(e, 'w:w')) } }
      for (const sp of styleTblPr) ap(ch(sp, 'w:tblCellMar'))
      ap(ch(tblPr, 'w:tblCellMar'))
      return m
    }
    const cm = getCellMar()
    if (ch(tblPr, 'w:tblpPr')) issue(path, '떠 있는 표(tblpPr)는 일반 표로 읽음')
    let grid = chs(ch(tblN, 'w:tblGrid'), 'w:gridCol').map((g) => (num(av(g, 'w:w')) || 0) / 20)
    const rowsN = chs(tblN, 'w:tr')
    if (!grid.length || grid.every((x) => !x)) {
      const first = rowsN[0]
      grid = chs(first, 'w:tc').flatMap((tc) => { const gs = num(wv(ch(ch(tc, 'w:tcPr'), 'w:gridSpan'))) || 1; const w = (num(av(ch(ch(tc, 'w:tcPr'), 'w:tcW'), 'w:w')) || 0) / 20 / gs; return Array(gs).fill(w) })
    }
    const nCols = grid.length
    const rows = []
    const open = {} // 열 시작 -> { cell, rowIdx } (vMerge 진행 중)
    const pieces = [] // 칸 조각별 명시 테두리(병합 칸은 행마다 조각)
    for (let ri = 0; ri < rowsN.length; ri++) {
      const rn = rowsN[ri]
      const trPr = ch(rn, 'w:trPr')
      const row = { cells: [] }
      const th = ch(trPr, 'w:trHeight')
      if (th && num(av(th, 'w:val'))) { row.heightPt = round1(num(av(th, 'w:val')) / 20); if (av(th, 'w:hRule') === 'exact') row.heightRule = 'exact' }
      if (ch(trPr, 'w:tblHeader') && onoff(ch(trPr, 'w:tblHeader')) !== false) row.header = true
      if (ch(trPr, 'w:cantSplit') && onoff(ch(trPr, 'w:cantSplit')) !== false) row.cantSplit = true
      let col = num(wv(ch(trPr, 'w:gridBefore'))) || 0
      if (col > 0) row.cells.push({ colspan: col, blocks: [{ t: 'p', runs: [] }], border: { top: NONE, right: NONE, bottom: NONE, left: NONE }, x: { synthetic: 'gridBefore' }, _col: 0 })
      for (const tc of chs(rn, 'w:tc')) {
        const tcPr = ch(tc, 'w:tcPr')
        const cs = num(wv(ch(tcPr, 'w:gridSpan'))) || 1
        const vm = ch(tcPr, 'w:vMerge')
        if (vm && (wv(vm) === undefined || wv(vm) === 'continue')) {
          const o = open[col]
          if (o) { o.cell.rowspan = (o.cell.rowspan || 1) + 1; o.endRow = ri }
          const cb = ch(tcPr, 'w:tcBorders')
          if (cb) { const bd = {}; for (const e of cb.children) bd[e.name.slice(2)] = decodeBorder(e); pieces.push({ ri, col, cs, bd, anchor: false }) }
          col += cs
          continue
        }
        const cell = { _col: col, _row: ri }
        if (cs > 1) cell.colspan = cs
        if (vm && wv(vm) === 'restart') { cell.rowspan = 1; open[col] = { cell, startRow: ri, endRow: ri } } else delete open[col]
        const shd = ch(tcPr, 'w:shd')
        if (shd) {
          const fill = av(shd, 'w:fill'); const v = av(shd, 'w:val')
          if (fill && fill !== 'auto') cell.bg = '#' + fill.toUpperCase()
          else if (v === 'solid' && av(shd, 'w:color') && av(shd, 'w:color') !== 'auto') cell.bg = '#' + av(shd, 'w:color').toUpperCase()
        }
        const va = wv(ch(tcPr, 'w:vAlign'))
        if (va === 'center') cell.vAlign = 'middle'; else if (va === 'bottom') cell.vAlign = 'bottom'
        const tcm = ch(tcPr, 'w:tcMar')
        if (tcm) {
          const g = (k, k2) => num(av(ch(tcm, 'w:' + k) || ch(tcm, 'w:' + k2), 'w:w')) ?? cm[k === 'start' ? 'left' : k === 'end' ? 'right' : k]
          cell.padPt = { t: round1(g('top') / 20), r: round1(g('right', 'end') / 20), b: round1(g('bottom') / 20), l: round1(g('left', 'start') / 20) }
        }
        const td = wv(ch(tcPr, 'w:textDirection'))
        if (td && /^(tbRl|tbRlV|tbLrV|btLr)/.test(td)) cell.textDir = 'vertical'
        const tcb = ch(tcPr, 'w:tcBorders')
        if (tcb) { cell._bd = {}; for (const e of tcb.children) cell._bd[e.name.slice(2)] = decodeBorder(e); pieces.push({ ri, col, cs, bd: cell._bd, anchor: true }) }
        const tw = (num(av(ch(tcPr, 'w:tcW'), 'w:w')) || 0)
        cell._tw = tw
        cell.blocks = await convertBlocks(tc, rels, (grid.slice(col, col + cs).reduce((a, b) => a + b, 0)) || bodyWPt, `${path}/r${ri}c${col}`)
        if (!cell.blocks.length) cell.blocks = [{ t: 'p', runs: [] }]
        row.cells.push(cell)
        col += cs
      }
      const after = num(wv(ch(trPr, 'w:gridAfter'))) || 0
      if (after > 0) row.cells.push({ colspan: after, blocks: [{ t: 'p', runs: [] }], border: { top: NONE, right: NONE, bottom: NONE, left: NONE }, x: { synthetic: 'gridAfter' }, _col: nCols - after })
      // vMerge 가 이 행에서 끊긴 열 정리
      for (const k of Object.keys(open)) if (open[k].endRow < ri && !rn.children.some((x) => x.name === 'w:tc' && false)) { if (open[k].endRow < ri) delete open[k] }
      rows.push(row)
    }
    // ---- 테두리 결정 (변 격자) ----
    const nRows = rows.length
    const hE = Array.from({ length: nRows + 1 }, () => Array(nCols).fill(undefined))
    const vE = Array.from({ length: nRows }, () => Array(nCols + 1).fill(undefined))
    const pick = (a, b) => { if (!a) return b; if (!b) return a; if (a.style === 'none') return b; if (b.style === 'none') return a; return (b.widthPt || 0) > (a.widthPt || 0) ? b : a }
    for (const pc of pieces) {
      const bd = pc.bd; if (!bd) continue
      const top = bd.top; const bottom = bd.bottom; const left = bd.left || bd.start; const right = bd.right || bd.end
      for (let k = 0; k < pc.cs; k++) { if (top && pc.anchor) hE[pc.ri][pc.col + k] = pick(hE[pc.ri][pc.col + k], top); if (bottom) hE[pc.ri + 1][pc.col + k] = pick(hE[pc.ri + 1][pc.col + k], bottom) }
      if (left) vE[pc.ri][pc.col] = pick(vE[pc.ri][pc.col], left)
      if (right) vE[pc.ri][pc.col + pc.cs] = pick(vE[pc.ri][pc.col + pc.cs], right)
    }
    const tblDefault = (r, c, dir) => {
      // dir: 'h'(수평선, 행 경계) | 'v'(수직선, 열 경계). 바깥/안쪽 구분
      if (dir === 'h') return r === 0 ? tbl.top : r === nRows ? tbl.bottom : tbl.insideH
      return c === 0 ? tbl.left || tbl.start : c === nCols ? tbl.right || tbl.end : tbl.insideV
    }
    const eh = (r, c) => hE[r][c] ?? tblDefault(r, c, 'h')
    const ev = (r, c) => vE[r][c] ?? tblDefault(r, c, 'v')
    // 표 기본선: 모든 변이 같을 때만
    const allSides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => tbl[k])
    let tableBorder
    const defined = allSides.filter(Boolean)
    if (defined.length === 6 && defined.every((b) => sameBorder(b, defined[0])) && defined[0].style !== 'none') tableBorder = defined[0]
    const eq = (a, b) => sameBorder(a || NONE, b || NONE)
    for (let ri = 0; ri < nRows; ri++) for (const c of rows[ri].cells) {
      const cs = c.colspan || 1; const rs = c.rowspan || 1
      if (c.x?.synthetic) { delete c._bd; continue }
      const sides = { top: eh(ri, c._col), bottom: eh(ri + rs, c._col), left: ev(ri, c._col), right: ev(ri, c._col + cs) }
      const bd = {}
      for (const [s, v] of Object.entries(sides)) {
        const want = v || NONE
        const dflt = tableBorder || NONE
        if (!eq(want, dflt)) bd[s] = want.style === 'none' ? { style: 'none', widthPt: 0, color: '#000000' } : want
      }
      const dg = c._bd
      if (dg?.tl2br && dg.tl2br.style !== 'none') bd.diagDown = dg.tl2br
      if (dg?.tr2bl && dg.tr2bl.style !== 'none') bd.diagUp = dg.tr2bl
      if (Object.keys(bd).length) c.border = bd
      delete c._bd
    }
    for (const r of rows) for (const c of r.cells) { delete c._col; delete c._row; delete c._tw }
    for (const r of rows) for (const c of r.cells) { if (c.rowspan === 1) delete c.rowspan; if (c.x && !Object.keys(c.x).length) delete c.x }
    const widthPt = round1(grid.reduce((a, b) => a + b, 0))
    const jc = wv(ch(tblPr, 'w:jc'))
    const t = { t: 'table', widthPt, colPt: grid.map(round1), rows }
    const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : undefined
    if (align) t.align = align
    if (tableBorder) t.border = tableBorder
    t.padPt = { t: round1(cm.top / 20), r: round1(cm.right / 20), b: round1(cm.bottom / 20), l: round1(cm.left / 20) }
    const ind = ch(tblPr, 'w:tblInd'); if (ind && num(av(ind, 'w:w'))) t.x = { indPt: round1(num(av(ind, 'w:w')) / 20) }
    if (av(ch(tblPr, 'w:tblLayout'), 'w:type') !== 'fixed') (t.x = t.x || {}).autofit = true
    return t
  }

  // ---- 본문, 머리말, 꼬리말 ----
  const body = ch(doc, 'w:body')
  // 쪽 설정은 본문 마지막 sectPr
  const preSect = []
  ctxState.sectPrs = preSect
  const bodyChildrenSect = ch(body, 'w:sectPr')
  const sectDefaultPage = bodyChildrenSect
  const pgSz = ch(sectDefaultPage, 'w:pgSz')
  const pgMar = ch(sectDefaultPage, 'w:pgMar')
  const wTw = num(av(pgSz, 'w:w')) || 11906; const hTw = num(av(pgSz, 'w:h')) || 16838
  const wMm = (wTw / 1440) * 25.4; const hMm = (hTw / 1440) * 25.4
  const orient = av(pgSz, 'w:orient') === 'landscape' || wTw > hTw ? 'landscape' : 'portrait'
  const pmm = (k, d) => ((num(av(pgMar, 'w:' + k)) ?? d) / 1440) * 25.4
  const topMm = Math.abs(pmm('top', 1440)); const botMm = Math.abs(pmm('bottom', 1440))
  const near = (a, b) => Math.abs(a - b) < 1
  const sdims = { lo: Math.min(wMm, hMm), hi: Math.max(wMm, hMm) }
  const size = near(sdims.lo, 210) && near(sdims.hi, 297) ? 'A4' : near(sdims.lo, 176) && near(sdims.hi, 250) ? 'B5' : near(sdims.lo, 215.9) && near(sdims.hi, 279.4) ? 'Letter' : near(sdims.lo, 297) && near(sdims.hi, 420) ? 'A3' : { wMm: round2(sdims.lo), hMm: round2(sdims.hi) }
  const page = {
    size, orientation: orient,
    marginMm: { top: round2(topMm), right: round2(pmm('right', 1440)), bottom: round2(botMm), left: round2(pmm('left', 1440)) },
    headerMm: round2(Math.max(0, topMm - pmm('header', 720))), footerMm: round2(Math.max(0, botMm - pmm('footer', 720))),
  }
  const gut = pmm('gutter', 0); if (gut > 0) page.gutterMm = round2(gut)
  const cols = ch(sectDefaultPage, 'w:cols'); const ncol = num(av(cols, 'w:num'))
  if (ncol > 1) page.columns = { n: ncol, gapMm: round2(((num(av(cols, 'w:space')) || 720) / 1440) * 25.4) }
  const bodyWPt = ((orient === 'landscape' ? Math.max(wTw, hTw) : Math.min(wTw, hTw)) - (num(av(pgMar, 'w:left')) || 1440) - (num(av(pgMar, 'w:right')) || 1440) - (num(av(pgMar, 'w:gutter')) || 0)) / 20

  const bodyBlocks = await convertBlocks(body, docRels, bodyWPt, 'body')
  const allSects = [...preSect, bodyChildrenSect].filter(Boolean)
  if (preSect.length) issue('sectPr', `구역이 ${allSects.length}개: 쪽 설정은 마지막 구역만 읽음`)
  // 머리말/꼬리말: 마지막으로 정의된 default 참조
  let hdrRef = null; let ftrRef = null
  for (const s of allSects) {
    for (const hr of chs(s, 'w:headerReference')) if (av(hr, 'w:type') === 'default') hdrRef = av(hr, 'r:id')
    for (const fr of chs(s, 'w:footerReference')) if (av(fr, 'w:type') === 'default') ftrRef = av(fr, 'r:id')
    if (ch(s, 'w:titlePg')) issue('sectPr', '첫 쪽 다른 머리말은 읽지 않음(공통 머리말만)')
  }
  const readHf = async (rid, tag) => {
    const rel = docRels[rid]
    if (!rel) return undefined
    const x = await text(rel.target)
    if (!x) return undefined
    const rels = await relsOf(rel.target)
    const root = parseXml(x)
    const saved = ctxState.sectPrs; ctxState.sectPrs = []
    const blocks = await convertBlocks(root, rels, bodyWPt, tag)
    ctxState.sectPrs = saved
    const nonEmpty = blocks.some((b) => b.t !== 'p' || b.runs.length)
    return nonEmpty ? blocks : undefined
  }
  const header = hdrRef ? await readHf(hdrRef, 'header') : undefined
  const footer = ftrRef ? await readHf(ftrRef, 'footer') : undefined

  // 메타
  const meta = { title: '' }
  const coreRel = Object.values(await (async () => { const m = {}; for (const r of chs(rootRels, 'rel:Relationship')) m[av(r, 'Id')] = { type: av(r, 'Type'), target: resolvePath('', av(r, 'Target')) }; return m })()).find((r) => /core-properties$/.test(r.type))
  if (coreRel) {
    const cx = await text(coreRel.target)
    if (cx) { const c = parseXml(cx); meta.title = ch(c, 'dc:title')?.text || ''; const a = ch(c, 'dc:creator')?.text; if (a) meta.author = a; const cr = ch(c, 'dcterms:created')?.text; if (cr) meta.created = cr }
  }

  const ir = { version: 1, meta, page, defaults, ...(header ? { header } : {}), ...(footer ? { footer } : {}), body: bodyBlocks, assets }
  // 끝 문단 정리: 본문이 표로 끝난 뒤의 빈 간격 문단 제거는 cleanBlocks 에서 처리됨
  const norm = normalizeIR(ir)
  for (const i of norm.issues) opts.onIssue?.(i)
  return ir
}

// ---- 도우미 ----
const NONE = { style: 'none', widthPt: 0, color: '#000000' }
function decodeBorder(e) {
  const v = av(e, 'w:val')
  if (!v || v === 'nil' || v === 'none') return { ...NONE }
  const sz = num(av(e, 'w:sz')) || 4
  const style = v === 'dashed' || v === 'dashSmallGap' || v === 'dashDotStroked' ? 'dashed' : v === 'dotted' || v === 'dotDash' || v === 'dotDotDash' ? 'dotted' : v === 'double' ? 'double' : /^thickThin|^thinThick/.test(v) ? 'thick-thin' : 'solid'
  const c = av(e, 'w:color')
  return { style, widthPt: Math.round((sz / 8) * 100) / 100, color: c && c !== 'auto' ? '#' + c.toUpperCase() : '#000000' }
}
const sameBorder = (a, b) => a.style === b.style && Math.abs((a.widthPt || 0) - (b.widthPt || 0)) < 0.05 && (a.style === 'none' || a.color === b.color)
function colorHex(c) { return c && c !== 'auto' && /^[0-9a-fA-F]{6}$/.test(c) ? '#' + c.toUpperCase() : null }
function mapJc(j) { return j === 'both' || j === 'justify' ? 'justify' : j === 'center' ? 'center' : j === 'right' || j === 'end' ? 'right' : j === 'distribute' ? 'distribute' : j === 'left' || j === 'start' ? 'left' : undefined }
function fieldKind(instr) { const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES|DATE|TIME|SAVEDATE|CREATEDATE)\b/i.exec(instr || ''); if (!m) return null; const k = m[1].toUpperCase(); return k === 'PAGE' ? 'page' : k === 'NUMPAGES' || k === 'SECTIONPAGES' ? 'pages' : 'date' }
const round1 = (x) => Math.round(x * 10) / 10
const round2 = (x) => Math.round(x * 100) / 100
const wv0 = (n) => n?.text?.trim()
function findDesc(n, name) { if (!n) return null; for (const c of n.children) { if (c.name === name) return c; const f = findDesc(c, name); if (f) return f } return null }
