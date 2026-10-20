// export-check 공용 도구: zip 읽기, 작은 XML 파서, DOCX/HWPX 구조 검사, SVG 쪽 기하 추출, 비교 함수.
// 외부 의존 없음(node 내장만). 단위 시험은 src/lib/docIR/__tests__/fixtures.test.mjs.
import zlib from 'node:zlib'

// ---------------------------------------------------------------- zip
// 중앙 디렉터리를 읽어 항목 목록(순서, 압축 방식 포함)과 내용을 돌려준다.
export function readZip(bytes) {
  const buf = Buffer.from(bytes)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('zip 끝 레코드가 없음(zip 이 아님)')
  const n = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('중앙 디렉터리 손상')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32)
    const flags = buf.readUInt16LE(p + 8)
    const off = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'utf8')
    entries.push({ name, method, csize, usize, off, order: k })
    p += 46 + nameLen + extraLen + cmtLen
  }
  const read = (e) => {
    const lh = e.off
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`지역 헤더 손상: ${e.name}`)
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28)
    const raw = buf.slice(start, start + e.csize)
    return e.method === 0 ? raw : zlib.inflateRawSync(raw)
  }
  const map = new Map(entries.map((e) => [e.name, e]))
  return { entries, has: (n) => map.has(n), entry: (n) => map.get(n), read: (n) => read(map.get(n)), text: (n) => read(map.get(n)).toString('utf8'), names: entries.map((e) => e.name) }
}

// ---------------------------------------------------------------- XML
const ENT = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/
// 정합성만 보는 작은 파서. 닫는 태그 불일치, 속성 따옴표, 이스케이프 안 된 & 와 < 를 오류로 본다.
export function parseXml(src) {
  let s = String(src)
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)/gy
  const root = { name: '#root', attrs: {}, kids: [], text: '', parent: null }
  let cur = root
  let m
  let last = 0
  const lineAt = (i) => s.slice(0, i).split('\n').length
  while (last < s.length) {
    re.lastIndex = last
    m = re.exec(s)
    if (!m) throw new Error(`XML 오류: ${lineAt(last)}행 근처 해석 불가: ${JSON.stringify(s.slice(last, last + 40))}`)
    last = re.lastIndex
    if (m[1] !== undefined) {
      if (cur.name !== m[1]) throw new Error(`XML 오류: ${lineAt(last)}행 닫는 태그 </${m[1]}> 가 <${cur.name}> 와 안 맞음`)
      cur = cur.parent
    } else if (m[2] !== undefined) {
      const attrs = {}
      const ar = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let a
      while ((a = ar.exec(m[3] || ''))) {
        if (a[1] in attrs) throw new Error(`XML 오류: ${lineAt(last)}행 <${m[2]}> 속성 ${a[1]} 중복`)
        const v = a[2] ?? a[3]
        if (ENT.test(v)) throw new Error(`XML 오류: ${lineAt(last)}행 속성값에 이스케이프 안 된 &`)
        attrs[a[1]] = v
      }
      const node = { name: m[2], attrs, kids: [], text: '', parent: cur }
      cur.kids.push(node)
      if (!m[4]) cur = node
    } else if (m[5] !== undefined) {
      if (ENT.test(m[5])) throw new Error(`XML 오류: ${lineAt(last)}행 본문에 이스케이프 안 된 &`)
      cur.text += m[5]
    }
  }
  if (cur !== root) throw new Error(`XML 오류: <${cur.name}> 가 닫히지 않음`)
  if (root.kids.length !== 1) throw new Error(`XML 오류: 루트 요소가 ${root.kids.length}개`)
  return root.kids[0]
}
export const local = (name) => name.replace(/^.*:/, '')
export function* walk(node) {
  yield node
  for (const k of node.kids) yield* walk(k)
}
export const kidsOf = (n, ln) => n.kids.filter((k) => local(k.name) === ln)
export const firstKid = (n, ln) => n.kids.find((k) => local(k.name) === ln)
export const attr = (n, ln) => { if (!n) return undefined; for (const k of Object.keys(n.attrs)) if (local(k) === ln) return n.attrs[k]; return undefined }
export function findAll(node, ln) { const out = []; for (const n of walk(node)) if (local(n.name) === ln) out.push(n); return out }

// ---------------------------------------------------------------- DOCX 자식 요소 순서(ECMA-376 Transitional wml.xsd)
export const DOCX_ORDER = {
  // CT_PPr: PPrBase 순서 뒤에 rPr, sectPr, pPrChange
  pPr: ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'],
  // CT_RPr 는 transitional 에서 순서 없는 choice 이지만 워드는 이 순서로 쓴다(어긋나면 경고)
  rPr: ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange'],
  tcPr: ['cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark', 'headers', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange'],
  tcBorders: ['top', 'start', 'left', 'bottom', 'end', 'right', 'insideH', 'insideV', 'tl2br', 'tr2bl'],
  tblPr: ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription', 'tblPrChange'],
  tblBorders: ['top', 'start', 'left', 'bottom', 'end', 'right', 'insideH', 'insideV'],
  tblCellMar: ['top', 'start', 'left', 'bottom', 'end', 'right'],
  tcMar: ['top', 'start', 'left', 'bottom', 'end', 'right'],
  pBdr: ['top', 'left', 'bottom', 'right', 'between', 'bar'],
  sectPr: ['headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type', 'pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType', 'cols', 'formProt', 'vAlign', 'noEndnote', 'titlePg', 'textDirection', 'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange'],
  // CT_TrPrBase 는 순서 없는 choice(뒤에 ins, del, trPrChange). 알려진 이름인지만 본다
  trPr: null,
}
const TRPR_KNOWN = ['cnfStyle', 'divId', 'gridBefore', 'gridAfter', 'wBefore', 'wAfter', 'cantSplit', 'trHeight', 'tblHeader', 'tblCellSpacing', 'jc', 'hidden', 'ins', 'del', 'trPrChange']
// 정확히 순서를 어기면 워드가 "내용에 문제가 있다" 며 복구를 요구하는 요소들(rPr 는 경고)
const STRICT_ORDER = new Set(['pPr', 'tcPr', 'tcBorders', 'tblPr', 'tblBorders', 'tblCellMar', 'tcMar', 'pBdr', 'sectPr'])

// 순서 검사. 같은 이름이 headerReference 처럼 여러 번 나오는 것은 허용(순서 표 안 같은 위치로 취급)
export function checkChildOrder(node, tag, order, path) {
  const issues = []
  const idx = (n) => order.indexOf(local(n.name))
  let prev = -1, prevName = ''
  for (const k of node.kids) {
    const ln = local(k.name)
    if (!ln || k.name.startsWith('mc:') || ln === 'AlternateContent') continue
    const i = idx(k)
    if (i < 0) { issues.push({ sev: STRICT_ORDER.has(tag) ? 'error' : 'warn', path, msg: `<w:${tag}> 안에 알 수 없는 자식 <${k.name}>` }); continue }
    if (i < prev) issues.push({ sev: STRICT_ORDER.has(tag) ? 'error' : 'warn', path, msg: `<w:${tag}> 자식 순서 어긋남: <${k.name}> 가 <${prevName}> 뒤에 옴(스키마상 앞이어야 함)` })
    else { prev = i; prevName = k.name }
  }
  return issues
}

const REL_NS_ATTRS = new Set(['id', 'embed', 'link', 'pict'])

// ---------------------------------------------------------------- DOCX 검사
export function checkDocx(bytes) {
  const errors = [], warnings = []
  const info = { parts: 0, paragraphs: 0, tables: 0, merges: { gridSpan: 0, vMergeRestart: 0, vMergeContinue: 0 }, sections: [], drawings: 0, images: 0, fonts: [] }
  const E = (path, msg) => errors.push({ path, msg })
  const W = (path, msg) => warnings.push({ path, msg })
  let zip
  try { zip = readZip(bytes) } catch (e) { return { ok: false, errors: [{ path: 'zip', msg: e.message }], warnings, info } }
  info.parts = zip.names.length
  for (const req of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) if (!zip.has(req)) E(req, '필수 부품 없음')
  if (errors.length) return { ok: false, errors, warnings, info }
  if (zip.names[0] !== '[Content_Types].xml') W('zip', `첫 항목이 [Content_Types].xml 이 아님(${zip.names[0]}). 워드는 허용하지만 일부 도구가 까다로움`)

  // 모든 XML 정합성
  const docs = {}
  for (const n of zip.names) {
    if (!/\.(xml|rels)$/.test(n)) continue
    try { docs[n] = parseXml(zip.text(n)) } catch (e) { E(n, e.message) }
  }
  if (errors.length) return { ok: false, errors, warnings, info }

  // 콘텐츠 형식
  const ct = docs['[Content_Types].xml']
  const defaults = new Set(kidsOf(ct, 'Default').map((d) => (d.attrs.Extension || '').toLowerCase()))
  const overrides = new Set(kidsOf(ct, 'Override').map((o) => (o.attrs.PartName || '').replace(/^\//, '')))
  for (const o of overrides) if (!zip.has(o)) E('[Content_Types].xml', `Override 대상 부품이 없음: ${o}`)
  for (const n of zip.names) {
    if (n === '[Content_Types].xml' || n.endsWith('/')) continue
    const ext = (n.split('.').pop() || '').toLowerCase()
    if (!overrides.has(n) && !defaults.has(ext)) E('[Content_Types].xml', `콘텐츠 형식 없음(Default/Override): ${n}`)
  }
  const docCt = kidsOf(ct, 'Override').find((o) => o.attrs.PartName === '/word/document.xml')
  if (!docCt || !/wordprocessingml\.document\.main\+xml/.test(docCt.attrs.ContentType)) E('[Content_Types].xml', 'word/document.xml 의 콘텐츠 형식이 document.main+xml 이 아님')

  // 관계
  const relsOf = {}
  for (const n of Object.keys(docs)) {
    if (!n.endsWith('.rels')) continue
    const baseDir = n.replace(/_rels\/[^/]*\.rels$/, '')
    const ids = new Set()
    for (const r of kidsOf(docs[n], 'Relationship')) {
      if (ids.has(r.attrs.Id)) E(n, `관계 Id 중복: ${r.attrs.Id}`)
      ids.add(r.attrs.Id)
      if (r.attrs.TargetMode === 'External') continue
      let t = r.attrs.Target || ''
      t = t.startsWith('/') ? t.slice(1) : normPath(baseDir + t)
      if (!zip.has(t)) E(n, `관계 대상이 없음: ${r.attrs.Target} (${r.attrs.Id})`)
    }
    relsOf[n] = ids
  }
  const mainRels = relsOf['word/_rels/document.xml.rels'] || new Set()

  // 본문 구조
  const doc = docs['word/document.xml']
  const body = firstKid(doc, 'body')
  if (!body) E('word/document.xml', 'w:body 없음')
  else {
    const last = body.kids[body.kids.length - 1]
    if (!last || local(last.name) !== 'sectPr') W('word/document.xml', 'w:body 의 마지막 자식이 w:sectPr 가 아님(쪽 설정 누락)')
  }
  // 모든 부품에서 순서 검사
  const partNames = Object.keys(docs).filter((n) => n.startsWith('word/') && !n.includes('_rels'))
  for (const pn of partNames) {
    for (const node of walk(docs[pn])) {
      const ln = local(node.name)
      if (DOCX_ORDER[ln]) for (const i of checkChildOrder(node, ln, DOCX_ORDER[ln], pn)) (i.sev === 'error' ? errors : warnings).push({ path: i.path, msg: i.msg })
      if (ln === 'trPr') for (const k of node.kids) if (!TRPR_KNOWN.includes(local(k.name))) E(pn, `<w:trPr> 안에 알 수 없는 자식 <${k.name}>`)
    }
  }
  // 관계 참조
  for (const pn of partNames) {
    const relName = `word/_rels/${pn.split('/').pop()}.rels`
    const ids = pn === 'word/document.xml' ? mainRels : relsOf[relName] || new Set()
    for (const node of walk(docs[pn])) for (const [k, v] of Object.entries(node.attrs)) {
      if (/^r:/.test(k) && REL_NS_ATTRS.has(local(k)) && v && !ids.has(v)) E(pn, `관계 참조 ${k}="${v}" 가 ${relName} 에 없음`)
    }
  }
  // 스타일·번호 참조
  const styles = docs['word/styles.xml']
  const styleIds = new Set(styles ? findAll(styles, 'style').map((s) => attr(s, 'styleId')) : [])
  const numbering = docs['word/numbering.xml']
  const numIds = new Set(numbering ? findAll(numbering, 'num').map((s) => attr(s, 'numId')) : [])
  const fonts = new Set()
  const docPrIds = new Map()
  for (const pn of partNames) {
    for (const node of walk(docs[pn])) {
      const ln = local(node.name)
      if (['pStyle', 'rStyle', 'tblStyle'].includes(ln)) { const v = attr(node, 'val'); if (v && !styleIds.has(v)) W(pn, `${ln} 가 가리키는 스타일 ${v} 이 styles.xml 에 없음`) }
      if (ln === 'numId') { const v = attr(node, 'val'); if (v && v !== '0' && !numIds.has(v)) E(pn, `numId ${v} 가 numbering.xml 에 없음`) }
      if (ln === 'rFonts') for (const a of ['ascii', 'hAnsi', 'eastAsia', 'cs']) if (attr(node, a)) fonts.add(attr(node, a))
      if (ln === 'docPr') { const id = attr(node, 'id'); docPrIds.set(id, (docPrIds.get(id) || 0) + 1) }
    }
  }
  for (const [id, n] of docPrIds) if (n > 1) E('word/document.xml', `그림 id(wp:docPr) ${id} 중복 ${n}회: 워드가 복구를 요구할 수 있음`)
  info.fonts = [...fonts]

  // 표
  const tcLastIsP = []
  for (const tbl of findAll(doc, 'tbl')) {
    info.tables++
    const tblPr = firstKid(tbl, 'tblPr'), grid = firstKid(tbl, 'tblGrid')
    if (!tblPr) W('tbl', 'w:tblPr 없음')
    if (!grid) { E('tbl', 'w:tblGrid 없음'); continue }
    const gridCols = kidsOf(grid, 'gridCol').map((g) => +attr(g, 'w'))
    const layout = attr(firstKid(tblPr || { kids: [] }, 'tblLayout'), 'type')
    if (layout !== 'fixed') W('tbl', `w:tblLayout fixed 가 아님(${layout || '없음'}): 열려 있을 때 열 폭이 다시 계산됨`)
    const tblW = firstKid(tblPr || { kids: [] }, 'tblW')
    if (tblW && attr(tblW, 'type') === 'dxa') {
      const sum = gridCols.reduce((a, c) => a + c, 0)
      if (Math.abs(sum - +attr(tblW, 'w')) > 20) W('tbl', `tblW(${attr(tblW, 'w')})와 tblGrid 합(${sum}) 차이`)
    }
    const colOpen = new Array(gridCols.length).fill(false) // vMerge 가 열려 있는 열
    kidsOf(tbl, 'tr').forEach((tr, ri) => {
      const trPr = firstKid(tr, 'trPr')
      let col = 0
      const gb = trPr && firstKid(trPr, 'gridBefore') ? +attr(firstKid(trPr, 'gridBefore'), 'val') : 0
      col += gb
      const cells = kidsOf(tr, 'tc')
      const nowOpen = new Array(gridCols.length).fill(false)
      for (const tc of cells) {
        const tcPr = firstKid(tc, 'tcPr')
        const gs = tcPr && firstKid(tcPr, 'gridSpan') ? +attr(firstKid(tcPr, 'gridSpan'), 'val') : 1
        const vm = tcPr && firstKid(tcPr, 'vMerge')
        if (gs > 1) info.merges.gridSpan++
        if (vm) {
          const v = attr(vm, 'val')
          if (v === 'restart') { info.merges.vMergeRestart++; for (let c = col; c < col + gs; c++) nowOpen[c] = true }
          else { info.merges.vMergeContinue++; for (let c = col; c < col + gs; c++) { if (!colOpen[c]) E('tbl', `행 ${ri} 열 ${c}: vMerge continue 인데 위에 restart 가 없음`); nowOpen[c] = true } }
        }
        const lastK = tc.kids[tc.kids.length - 1]
        if (!lastK || !['p', 'tbl'].includes(local(lastK.name))) E('tbl', `행 ${ri}: w:tc 에 문단이 없음`)
        else if (local(lastK.name) === 'tbl') E('tbl', `행 ${ri}: w:tc 의 마지막이 표임(워드는 칸 끝에 문단이 있어야 함)`)
        if (tcPr && tc.kids[0] !== tcPr) E('tbl', `행 ${ri}: w:tcPr 가 w:tc 의 첫 자식이 아님`)
        const w = tcPr && firstKid(tcPr, 'tcW') ? +attr(firstKid(tcPr, 'tcW'), 'w') : null
        if (w != null && attr(firstKid(tcPr, 'tcW'), 'type') === 'dxa') {
          const exp = gridCols.slice(col, col + gs).reduce((a, c) => a + c, 0)
          if (Math.abs(exp - w) > 20) W('tbl', `행 ${ri} 열 ${col}: tcW(${w})와 격자 폭(${exp}) 차이`)
        }
        col += gs
      }
      const ga = trPr && firstKid(trPr, 'gridAfter') ? +attr(firstKid(trPr, 'gridAfter'), 'val') : 0
      if (col + ga !== gridCols.length) E('tbl', `행 ${ri}: 칸이 차지하는 열 수(${col + ga})가 tblGrid 열 수(${gridCols.length})와 다름`)
      for (let c = 0; c < colOpen.length; c++) colOpen[c] = nowOpen[c]
    })
  }
  info.paragraphs = findAll(doc, 'p').length
  info.drawings = findAll(doc, 'drawing').length
  info.images = findAll(doc, 'blip').length
  // 쪽 설정
  for (const sp of findAll(doc, 'sectPr')) {
    const pgSz = firstKid(sp, 'pgSz'), pgMar = firstKid(sp, 'pgMar')
    if (!pgSz) E('sectPr', 'w:pgSz 없음')
    if (!pgMar) E('sectPr', 'w:pgMar 없음')
    else for (const a of ['top', 'right', 'bottom', 'left', 'header', 'footer', 'gutter']) if (attr(pgMar, a) == null) W('sectPr', `w:pgMar 에 ${a} 없음`)
    info.sections.push({ wPt: pgSz ? +attr(pgSz, 'w') / 20 : null, hPt: pgSz ? +attr(pgSz, 'h') / 20 : null, orient: attr(pgSz, 'orient') || 'portrait', marginPt: pgMar ? Object.fromEntries(['top', 'right', 'bottom', 'left', 'header', 'footer'].map((a) => [a, +attr(pgMar, a) / 20])) : null, docGrid: attr(firstKid(sp, 'docGrid') || { attrs: {} }, 'type') || null, hasFooter: kidsOf(sp, 'footerReference').length > 0, hasHeader: kidsOf(sp, 'headerReference').length > 0 })
  }
  // 호환 설정(README 9)
  const settings = docs['word/settings.xml']
  if (!settings) W('word/settings.xml', 'settings.xml 없음: 호환 모드 지정 불가')
  else {
    const cm = findAll(settings, 'compatSetting').find((c) => attr(c, 'name') === 'compatibilityMode')
    if (!cm) W('word/settings.xml', 'compatibilityMode 없음: 워드가 호환 모드(구버전)로 열어 자동 보정이 들어갈 수 있음')
    else if (+attr(cm, 'val') < 15) W('word/settings.xml', `compatibilityMode=${attr(cm, 'val')} (15 미만)`)
    info.compatibilityMode = cm ? +attr(cm, 'val') : null
  }
  const dd = styles && firstKid(styles, 'docDefaults')
  // 기본 단락 스타일(Normal)과 docDefaults 의 pPr 를 겹쳐 본다(스타일이 우선)
  const defStyle = styles && findAll(styles, 'style').find((x) => attr(x, 'type') === 'paragraph' && attr(x, 'default') === '1')
  const ppdDefaults = dd && firstKid(dd, 'pPrDefault') && firstKid(firstKid(dd, 'pPrDefault'), 'pPr')
  const ppdStyle = defStyle && firstKid(defStyle, 'pPr')
  const pick = (ln) => { const v = ppdStyle && firstKid(ppdStyle, ln) ? firstKid(ppdStyle, ln) : ppdDefaults && firstKid(ppdDefaults, ln); return v ? { attrs: v.attrs } : undefined }
  const ppd = ppdStyle || ppdDefaults ? { kids: ['autoSpaceDE', 'autoSpaceDN', 'wordWrap'].map((ln) => { const v = pick(ln); return v ? { name: 'w:' + ln, attrs: v.attrs, kids: [] } : null }).filter(Boolean) } : null
  info.autoSpace = ppd ? { autoSpaceDE: attr(firstKid(ppd, 'autoSpaceDE') || { attrs: {} }, 'val') ?? null, autoSpaceDN: attr(firstKid(ppd, 'autoSpaceDN') || { attrs: {} }, 'val') ?? null, wordWrap: attr(firstKid(ppd, 'wordWrap') || { attrs: {} }, 'val') ?? null } : null
  if (!info.autoSpace || (info.autoSpace.autoSpaceDE !== '0' && info.autoSpace.autoSpaceDE !== 'false')) W('word/styles.xml', '기본 문단 스타일(또는 docDefaults)에 autoSpaceDE 끔이 없음: 한글과 영문 사이에 간격이 자동으로 들어갈 수 있음')
  if (info.sections.some((s) => s.docGrid && s.docGrid !== 'default')) W('sectPr', `docGrid type=${info.sections.find((s) => s.docGrid).docGrid}: 문서 격자가 켜져 있으면 줄 간격이 격자에 맞춰짐`)
  return { ok: errors.length === 0, errors, warnings, info }
}

function normPath(p) {
  const out = []
  for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s) }
  return out.join('/')
}

// ---------------------------------------------------------------- HWPX 검사
export function checkHwpx(bytes) {
  const errors = [], warnings = []
  const info = { parts: 0, paragraphs: 0, tables: 0, tableList: [], pageMm: null, fontfaces: {}, ids: {}, pics: 0 }
  const E = (path, msg) => errors.push({ path, msg })
  const W = (path, msg) => warnings.push({ path, msg })
  let zip
  try { zip = readZip(bytes) } catch (e) { return { ok: false, errors: [{ path: 'zip', msg: e.message }], warnings, info } }
  info.parts = zip.names.length
  // mimetype
  if (zip.names[0] !== 'mimetype') E('zip', `첫 항목이 mimetype 이 아님(${zip.names[0]})`)
  else {
    const e = zip.entry('mimetype')
    if (e.method !== 0) E('zip', 'mimetype 이 압축되어 있음(저장(stored)이어야 함)')
    const t = zip.text('mimetype')
    if (t.trim() !== 'application/hwp+zip') E('mimetype', `내용이 application/hwp+zip 이 아님: ${JSON.stringify(t.slice(0, 40))}`)
  }
  for (const req of ['META-INF/container.xml', 'Contents/content.hpf', 'Contents/header.xml']) if (!zip.has(req)) E(req, '필수 부품 없음')
  for (const rec of ['version.xml', 'settings.xml']) if (!zip.has(rec)) W(rec, '한컴 저장본에는 있는 부품이 없음(kordoc validate 는 통과해도 한컴이 어떻게 여는지는 사람이 확인)')
  if (errors.some((x) => x.path !== 'zip' && x.path !== 'mimetype')) return { ok: false, errors, warnings, info }
  const docs = {}
  for (const n of zip.names) {
    if (!/\.(xml|hpf|rdf)$/.test(n) || n.startsWith('BinData/')) continue
    try { docs[n] = parseXml(zip.text(n)) } catch (e) { E(n, e.message) }
  }
  if (errors.some((x) => /XML 오류/.test(x.msg))) return { ok: false, errors, warnings, info }
  // 컨테이너와 매니페스트
  const pkgItems = new Map()
  const hpf = docs['Contents/content.hpf']
  for (const it of findAll(hpf, 'item')) pkgItems.set(it.attrs.id, it.attrs.href)
  for (const [id, href] of pkgItems) if (href && !/^https?:/.test(href) && !zip.has(href) && !zip.has('Contents/' + href)) E('Contents/content.hpf', `manifest 항목 ${id} 의 대상 ${href} 가 zip 에 없음`)
  const spine = findAll(hpf, 'itemref').map((r) => r.attrs.idref)
  for (const id of spine) if (!pkgItems.has(id)) E('Contents/content.hpf', `spine 이 가리키는 id ${id} 가 manifest 에 없음`)
  const sections = zip.names.filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort()
  if (!sections.length) E('Contents', 'section*.xml 이 없음')
  // header.xml 의 id 집합
  const header = docs['Contents/header.xml']
  const refList = firstKid(header, 'refList') || header
  const sets = { borderFill: new Set(), charPr: new Set(), paraPr: new Set(), style: new Set(), tabPr: new Set(), numbering: new Set(), bullet: new Set() }
  const containers = [['borderFills', 'borderFill'], ['charProperties', 'charPr'], ['paraProperties', 'paraPr'], ['styles', 'style'], ['tabProperties', 'tabPr'], ['numberings', 'numbering'], ['bullets', 'bullet']]
  for (const [cn, itemName] of containers) {
    const c = findAll(header, cn)[0]
    if (!c) continue
    const items = kidsOf(c, itemName)
    const ids = items.map((i) => i.attrs.id)
    info.ids[itemName] = ids.length
    if (c.attrs.itemCnt != null && +c.attrs.itemCnt !== items.length) W('Contents/header.xml', `<${cn}> itemCnt=${c.attrs.itemCnt} 인데 실제 ${items.length}개`)
    const seen = new Set()
    for (const id of ids) { if (seen.has(id)) E('Contents/header.xml', `${itemName} id ${id} 중복`); seen.add(id); sets[itemName].add(id) }
    const nums = ids.map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
    if (nums.length && nums.some((v, i) => v !== nums[0] + i)) W('Contents/header.xml', `${itemName} id 가 연속이 아님(${nums.slice(0, 8).join(',')}...)`)
  }
  // 글꼴
  for (const ff of findAll(header, 'fontface')) info.fontfaces[ff.attrs.lang] = kidsOf(ff, 'font').length
  // 모든 부품에서 참조 해석
  const refMap = [['borderFillIDRef', 'borderFill'], ['charPrIDRef', 'charPr'], ['paraPrIDRef', 'paraPr'], ['styleIDRef', 'style'], ['tabPrIDRef', 'tabPr']]
  const refParts = ['Contents/header.xml', ...sections]
  for (const pn of refParts) {
    if (!docs[pn]) continue
    for (const node of walk(docs[pn])) {
      for (const [an, set] of refMap) {
        const v = node.attrs[an]
        if (v === undefined || v === '4294967295') continue // 0xFFFFFFFF 는 "지정 안 함" 표시(한컴 저장본도 씀)
        // 0 은 "없음"일 수 있는 항목(tabPrIDRef 등)이라도 header 에 있어야 하는 것만 오류
        if (!sets[set].has(v)) { if (an === 'tabPrIDRef' && !sets.tabPr.size) continue; E(pn, `<${node.name}> ${an}="${v}" 가 header.xml 의 ${set} 에 없음`) }
      }
      if (local(node.name) === 'fontRef') for (const [lang, v] of Object.entries(node.attrs)) {
        const key = { hangul: 'HANGUL', latin: 'LATIN', hanja: 'HANJA', japanese: 'JAPANESE', other: 'OTHER', symbol: 'SYMBOL', user: 'USER' }[lang]
        if (key && info.fontfaces[key] != null && +v >= info.fontfaces[key]) E(pn, `fontRef ${lang}="${v}" 가 ${key} 글꼴 수(${info.fontfaces[key]})를 넘음`)
      }
      if (local(node.name) === 'heading' && node.attrs.type && node.attrs.type !== 'NONE' && node.attrs.idRef != null) {
        const set = node.attrs.type === 'BULLET' ? sets.bullet : sets.numbering
        if (node.attrs.idRef !== '0' && !set.has(node.attrs.idRef)) E(pn, `heading ${node.attrs.type} idRef=${node.attrs.idRef} 가 header 에 없음`)
      }
    }
  }
  // 본문
  for (const sn of sections) {
    const sec = docs[sn]
    if (!sec) continue
    info.paragraphs += findAll(sec, 'p').length
    for (const pic of findAll(sec, 'pic')) {
      info.pics++
      for (const img of findAll(pic, 'img')) {
        const ref = img.attrs.binaryItemIDRef
        if (ref && !pkgItems.has(ref)) E(sn, `그림 binaryItemIDRef="${ref}" 가 manifest 에 없음`)
      }
    }
    // landscape 속성: WIDELY=세로, NARROWLY=가로(한컴 표기)
    const secPr = findAll(sec, 'secPr')[0]
    const pagePr = secPr && findAll(secPr, 'pagePr')[0]
    if (!pagePr) W(sn, 'hp:pagePr 없음')
    else {
      const mar = findAll(pagePr, 'margin')[0]
      const u = (v) => Math.round(((+v * 25.4) / 7200) * 100) / 100
      info.pageMm = { wMm: u(pagePr.attrs.width), hMm: u(pagePr.attrs.height), landscape: pagePr.attrs.landscape === 'NARROWLY', margin: mar ? Object.fromEntries(Object.entries(mar.attrs).map(([k, v]) => [k, u(v)])) : null }
    }
    // 표 격자
    findAll(sec, 'tbl').forEach((tbl, ti) => {
      info.tables++
      const path = `${sn} tbl#${ti}`
      const rowCnt = +tbl.attrs.rowCnt, colCnt = +tbl.attrs.colCnt
      const trs = kidsOf(tbl, 'tr')
      if (trs.length !== rowCnt) E(path, `rowCnt=${rowCnt} 인데 hp:tr 은 ${trs.length}개`)
      const occ = Array.from({ length: Math.max(rowCnt, trs.length) }, () => Array(colCnt).fill(0))
      const colW = Array(colCnt).fill(null)
      let cellCount = 0
      trs.forEach((tr, ri) => {
        for (const tc of kidsOf(tr, 'tc')) {
          cellCount++
          const addr = firstKid(tc, 'cellAddr'), span = firstKid(tc, 'cellSpan'), sz = firstKid(tc, 'cellSz')
          if (!addr || !span || !sz) { E(path, `행 ${ri}: tc 에 cellAddr/cellSpan/cellSz 중 빠진 것이 있음`); continue }
          const ca = +addr.attrs.colAddr, ra = +addr.attrs.rowAddr, cs = +span.attrs.colSpan, rs = +span.attrs.rowSpan
          if (ra !== ri && !(rs > 1)) W(path, `행 ${ri}: cellAddr rowAddr=${ra} 가 tr 순서와 다름`)
          if (ca + cs > colCnt || ra + rs > occ.length) { E(path, `행 ${ri} 열 ${ca}: 병합(${cs}x${rs})이 표 밖(${colCnt}열 ${occ.length}행)으로 나감`); continue }
          for (let r = ra; r < ra + rs; r++) for (let c = ca; c < ca + cs; c++) occ[r][c]++
          if (cs === 1 && colW[ca] == null) colW[ca] = +sz.attrs.width
          if (!firstKid(tc, 'subList')) E(path, `행 ${ri} 열 ${ca}: hp:subList 없음(칸 안 문단)`)
        }
      })
      for (let r = 0; r < occ.length; r++) for (let c = 0; c < colCnt; c++) {
        if (occ[r][c] === 0) E(path, `행 ${r} 열 ${c}: 어느 칸에도 덮이지 않음(구멍)`)
        else if (occ[r][c] > 1) E(path, `행 ${r} 열 ${c}: 칸 ${occ[r][c]}개가 겹침`)
      }
      const sz = firstKid(tbl, 'sz')
      const known = colW.filter((x) => x != null)
      if (sz && known.length === colCnt) {
        const sum = known.reduce((a, c) => a + c, 0)
        if (Math.abs(sum - +sz.attrs.width) > 8) W(path, `hp:sz width(${sz.attrs.width})와 열 폭 합(${sum}) 차이 ${sum - sz.attrs.width}`)
      }
      info.tableList.push({ path, rows: rowCnt, cols: colCnt, cells: cellCount, widthPt: sz ? +sz.attrs.width / 100 : null, colPt: colW.map((x) => (x == null ? null : Math.round(x) / 100)) })
    })
  }
  return { ok: errors.length === 0, errors, warnings, info }
}

// ---------------------------------------------------------------- SVG(kordoc render) 쪽 기하
const r1 = (n) => Math.round(n * 10) / 10
export function clusterVals(vals, tol = 1) {
  const s = [...vals].sort((a, b) => a - b)
  const out = []
  for (const v of s) {
    const o = out[out.length - 1]
    if (o && v - o.max <= tol) { o.max = v; o.sum += v; o.n++ } else out.push({ max: v, sum: v, n: 1 })
  }
  return out.map((o) => r1(o.sum / o.n))
}

// svg 한 쪽 문자열 -> { wPt, hPt, tables:[{x0,x1,y0,y1,colEdges,nested}] }  (pt 단위, 쪽 왼쪽 위 기준)
export function svgPageGeometry(svgText) {
  const root = parseXml(svgText)
  const vb = (root.attrs.viewBox || '0 0 0 0').split(/\s+/).map(Number)
  const tables = []
  const visit = (node, depth) => {
    const isTable = node.attrs['data-kordoc-type'] === 'table'
    if (isTable) {
      const xs = [], ys = [], vx = []
      const collect = (n, top) => {
        if (n !== node && n.attrs['data-kordoc-type'] === 'table') return // 중첩 표는 따로
        const ln = local(n.name)
        if (ln === 'line') {
          const x1 = +n.attrs.x1, x2 = +n.attrs.x2, y1 = +n.attrs.y1, y2 = +n.attrs.y2
          xs.push(x1, x2); ys.push(y1, y2)
          if (Math.abs(x1 - x2) < 0.05) vx.push(x1)
        } else if (ln === 'rect') {
          const x = +n.attrs.x, y = +n.attrs.y, w = +n.attrs.width, h = +n.attrs.height
          if (!(w > vb[2] * 0.98 && h > vb[3] * 0.98)) { xs.push(x, x + w); ys.push(y, y + h); vx.push(x, x + w) }
        } else if (ln === 'image') {
          const x = +n.attrs.x, y = +n.attrs.y, w = +n.attrs.width, h = +n.attrs.height
          if (!Number.isNaN(x + y + w + h)) { /* 그림은 표 범위에 넣지 않음 */ }
        }
        for (const k of n.kids) collect(k, false)
      }
      collect(node, true)
      if (xs.length) tables.push({ id: node.attrs['data-kordoc-id'], x0: r1(Math.min(...xs)), x1: r1(Math.max(...xs)), y0: r1(Math.min(...ys)), y1: r1(Math.max(...ys)), colEdges: clusterVals(vx, 1.2), nested: depth > 0 })
    }
    for (const k of node.kids) visit(k, depth + (isTable ? 1 : 0))
  }
  visit(root, 0)
  return { wPt: vb[2], hPt: vb[3], tables }
}

// ---------------------------------------------------------------- 쪽 기하 정규화와 비교
// DOCX(브라우저 렌더 geom) -> 공통 형식. 표마다 조각(쪽, y0, y1)을 가진다.
export function normDocxGeom(g) {
  if (!g || g.error) return null
  const pg0 = g.sections[0] || { wPt: 595.3, hPt: 841.9 }
  return {
    source: 'docx-preview(어림 쪽 나눔)',
    pageCount: g.pageCount,
    pageWPt: pg0.wPt,
    pageHPt: pg0.hPt,
    tables: g.tables.filter((t) => t.rows > 0).map((t, i) => ({
      index: i,
      x0: t.x0, x1: t.x1,
      frags: t.frags,
      colEdges: t.colEdges.filter((e) => e >= -0.5 && e <= pg0.wPt + 0.5),
      nested: false,
    })),
  }
}
// HWPX(SVG 쪽 목록) -> 공통 형식. 쪽마다 최상위 표 조각을 이어 붙인다.
export function normSvgGeom(pages) {
  if (!pages || !pages.length) return null
  const tables = []
  pages.forEach((pg, pi) => {
    for (const t of pg.tables) {
      if (t.nested) continue
      tables.push({ page: pi, ...t })
    }
  })
  // 같은 표가 쪽을 넘어 이어지는지는 kordoc id 로 알 수 있으면 합친다(id 가 같으면 한 표)
  const byId = new Map()
  const out = []
  for (const t of tables) {
    const key = t.id
    if (key && byId.has(key)) { byId.get(key).frags.push({ page: t.page, y0: t.y0, y1: t.y1 }); continue }
    const o = { index: out.length, x0: t.x0, x1: t.x1, frags: [{ page: t.page, y0: t.y0, y1: t.y1 }], colEdges: t.colEdges, nested: false }
    out.push(o); if (key) byId.set(key, o)
  }
  return { source: 'kordoc render(svg)', pageCount: pages.length, pageWPt: pages[0].wPt, pageHPt: pages[0].hPt, tables: out }
}

// 두 정규화 기하를 견준다. 모든 수치를 쪽 크기 대비 비율로 보고한다.
export function compareGeom(a, b, tol = {}) {
  const T = { x: 0.006, y: 0.02, heightPct: 5, edge: 0.006, ...tol }
  const issues = []
  const out = { pageCount: [a.pageCount, b.pageCount], tableCount: [a.tables.length, b.tables.length], tables: [], pass: true }
  if (a.pageCount !== b.pageCount) { issues.push(`쪽 수 다름: ${a.source}=${a.pageCount}, ${b.source}=${b.pageCount}`); }
  if (a.tables.length !== b.tables.length) issues.push(`표 수 다름: ${a.tables.length} vs ${b.tables.length}`)
  const n = Math.min(a.tables.length, b.tables.length)
  for (let i = 0; i < n; i++) {
    const ta = a.tables[i], tb = b.tables[i]
    const fa = ta.frags[0], fb = tb.frags[0]
    const hA = ta.frags.reduce((s, f) => s + (f.y1 - f.y0), 0), hB = tb.frags.reduce((s, f) => s + (f.y1 - f.y0), 0)
    const dx0 = (ta.x0 - tb.x0) / a.pageWPt, dx1 = (ta.x1 - tb.x1) / a.pageWPt
    const dy0 = (fa.y0 - fb.y0) / a.pageHPt
    const hPct = hB ? ((hA - hB) / hB) * 100 : 0
    // 열 경계: A 의 각 경계에 가장 가까운 B 경계와의 거리
    let edgeMax = null, edgeMean = null
    if (ta.colEdges.length && tb.colEdges.length) {
      const ds = ta.colEdges.map((e) => Math.min(...tb.colEdges.map((f) => Math.abs(e - f))) / a.pageWPt)
      edgeMax = Math.max(...ds); edgeMean = ds.reduce((s, x) => s + x, 0) / ds.length
    }
    const row = {
      index: i,
      startPage: [fa.page + 1, fb.page + 1],
      endPage: [ta.frags[ta.frags.length - 1].page + 1, tb.frags[tb.frags.length - 1].page + 1],
      x0Frac: [+(ta.x0 / a.pageWPt).toFixed(4), +(tb.x0 / b.pageWPt).toFixed(4)],
      x1Frac: [+(ta.x1 / a.pageWPt).toFixed(4), +(tb.x1 / b.pageWPt).toFixed(4)],
      dx0: +dx0.toFixed(4), dx1: +dx1.toFixed(4), dy0: +dy0.toFixed(4),
      heightPt: [Math.round(hA), Math.round(hB)], heightDiffPct: +hPct.toFixed(1),
      colEdges: [ta.colEdges.length, tb.colEdges.length], edgeMax: edgeMax == null ? null : +edgeMax.toFixed(4), edgeMean: edgeMean == null ? null : +edgeMean.toFixed(4),
    }
    row.flags = []
    if (Math.abs(dx0) > T.x || Math.abs(dx1) > T.x) row.flags.push('가로 위치/폭')
    if (row.startPage[0] === row.startPage[1] && Math.abs(dy0) > T.y) row.flags.push('세로 위치')
    if (row.startPage[0] !== row.startPage[1]) row.flags.push('시작 쪽')
    if (row.endPage[0] !== row.endPage[1]) row.flags.push('끝 쪽')
    if (Math.abs(hPct) > T.heightPct) row.flags.push('표 높이')
    if (edgeMax != null && edgeMax > T.edge) row.flags.push('열 경계')
    out.tables.push(row)
  }
  const bad = out.tables.filter((t) => t.flags.length)
  if (bad.length) issues.push(`${bad.length}/${n}개 표가 허용 오차 밖: ` + bad.slice(0, 6).map((t) => `#${t.index}(${t.flags.join(',')})`).join(' '))
  out.issues = issues
  out.pass = issues.length === 0
  out.tolerance = T
  return out
}

// ---------------------------------------------------------------- IR 왕복 비교(summarize 결과끼리)
// 왕복하면 figure(본문 그림 블록)가 "그림이 든 문단 + 설명 문단"으로 바뀌어 읽히는 일이 흔하다. 견주기 전에 양쪽을 같은 모양으로 편다:
// figure 는 설명 문단(있으면)으로 바꾸고, 그림 수(figure + 글자처럼 취급한 그림)를 센다.
export function prepForCompare(ir) {
  let images = 0
  const fix = (blocks) => blocks.flatMap((b) => {
    if (b.t === 'figure') { images++; return b.caption ? [b.caption] : [] }
    if (b.t === 'p') { for (const r of b.runs || []) if (r.image) images++; return [b] }
    if (b.t === 'table') return [{ ...b, rows: b.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, blocks: fix(c.blocks || []) })) })) }]
    return [b]
  })
  const body = fix(ir.body || [])
  return { ir: { ...ir, body }, images }
}
const squash = (s) => String(s).replace(/[\s\u00a0]+/g, '').replace(/[☑✔☒]/g, '☑')
export function compareSummaries(a, b, tol = {}) {
  const T = { ptTol: 0.5, mmTol: 0.5, ...tol }
  const issues = []
  const push = (path, msg) => issues.push({ path, msg })
  // 쪽
  for (const k of ['wMm', 'hMm', 'bodyWMm']) if (Math.abs(a.page[k] - b.page[k]) > T.mmTol) push(`page.${k}`, `${a.page[k].toFixed(1)} vs ${b.page[k].toFixed(1)} mm`)
  for (const k of ['top', 'right', 'bottom', 'left']) if (Math.abs(a.page.margin[k] - b.page.margin[k]) > T.mmTol) push(`page.margin.${k}`, `${a.page.margin[k]} vs ${(+b.page.margin[k]).toFixed(1)} mm`)
  // 글(빈 문단과 공백 무시)
  const pa = a.paragraphs.map(squash).filter(Boolean), pb = b.paragraphs.map(squash).filter(Boolean)
  if (pa.length !== pb.length) push('paragraphs', `비어 있지 않은 문단 수 ${pa.length} vs ${pb.length}`)
  let shown = 0
  for (let i = 0; i < Math.min(pa.length, pb.length) && shown < 5; i++) if (pa[i] !== pb[i]) { push(`paragraphs[${i}]`, `다름: ${JSON.stringify(pa[i].slice(0, 30))} vs ${JSON.stringify(pb[i].slice(0, 30))}`); shown++ }
  // 표
  if (a.tables.length !== b.tables.length) push('tables', `표 수 ${a.tables.length} vs ${b.tables.length}`)
  for (let i = 0; i < Math.min(a.tables.length, b.tables.length); i++) {
    const x = a.tables[i], y = b.tables[i]
    const p = `tables[${i}]`
    if (x.rows !== y.rows || x.cols !== y.cols) push(p, `행x열 ${x.rows}x${x.cols} vs ${y.rows}x${y.cols}`)
    if (Math.abs(x.widthPt - y.widthPt) > T.ptTol) push(p, `표 폭 ${x.widthPt} vs ${y.widthPt}pt`)
    if (x.cols === y.cols) x.colPt.forEach((w, c) => { if (Math.abs(w - y.colPt[c]) > T.ptTol) push(`${p}.col${c}`, `열 폭 ${w} vs ${y.colPt[c]}pt`) })
    if (x.merges.join(',') !== y.merges.join(',')) push(p, `병합 ${x.merges.slice(0, 6).join(' ')} vs ${y.merges.slice(0, 6).join(' ')}`)
    const bgx = x.bgs.map((v) => (v || '').toUpperCase()), bgy = y.bgs.map((v) => (v || '').toUpperCase())
    if (bgx.length === bgy.length) { const d = bgx.filter((v, k) => v !== bgy[k]).length; if (d) push(p, `칸 배경색 ${d}개 다름`) }
    if (y.error) push(p, `읽은 표 격자 오류: ${y.error}`)
  }
  if (a.images != null && b.images != null) { if (a.images !== b.images) push('images', `그림 수 ${a.images} vs ${b.images}`) } else if (a.figures !== b.figures) push('figures', `그림 수 ${a.figures} vs ${b.figures}`)
  return { pass: issues.length === 0, issues }
}
