// lib/hwpxStyle.js 한글 문서(HWPX)에 편집기의 글자 모양과 문단 모양을 얹는다. (miri api/_hwpxStyle.js 이식, MIT)
// kordoc 공문서 엔진은 굵게, 기울임, 항목 부호, 표, 두문과 결문을 만들고, 글자 크기, 글자 색, 밑줄, 취소선, 형광펜(음영),
// 글꼴, 장평, 자간, 문단 정렬, 줄 간격, 쪽 나눔은 마크다운으로 넘길 수 없다. 그래서 편집기가 본문에 표지
// ⟪sN⟫글⟪/⟫(글자 모양), ⟪pN⟫(문단 모양)을 심어 보내고, 여기서 kordoc 이 만든 XML 의 그 자리를 찾아
// 원래 글자 모양(charPr)과 문단 모양(paraPr)을 복제해 바꾼 값을 새 번호로 붙인다. 표지가 있던 문단은 조판 캐시
// (linesegarray)를 지워 한글이 열 때 다시 조판하게 한다. 표지 글자 ⟪⟫ 는 kordoc 이 지우지 않는 것을 실측했다(4.18.13).

export const OPEN = '⟪'
export const CLOSE = '⟫'
const SPAN_RE = /⟪s(\d+)⟫([\s\S]*?)⟪\/⟫/g
const PARA_RE = /⟪p(\d+)⟫/g
const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']
const LANG_ATTR = ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user']
// 편집기 글꼴 목록(한글 이름 그대로 문서에 들어간다)
export const HWP_FONTS = ['함초롬바탕', '함초롬돋움', '휴먼명조', '한컴돋움', '굴림체', '굴림', '바탕', '돋움', '맑은 고딕', 'HY헤드라인M', 'HY견고딕']
const ALIGN = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFY', distribute: 'DISTRIBUTE' }
const hex = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c.toUpperCase() : null)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// 허용 값만 남긴다
export function cleanSpan(s = {}) {
  const o = {}
  if (s.b) o.b = 1
  if (s.i) o.i = 1
  if (s.u) o.u = 1
  if (s.s) o.s = 1
  const pt = Number(s.pt); if (pt >= 6 && pt <= 72) o.pt = Math.round(pt * 10) / 10
  if (hex(s.color)) o.color = hex(s.color)
  if (hex(s.bg)) o.bg = hex(s.bg)
  if (HWP_FONTS.includes(s.font)) o.font = s.font
  const r = Number(s.ratio); if (r >= 50 && r <= 200) o.ratio = Math.round(r)
  const sp = Number(s.spacing); if (sp >= -50 && sp <= 50) o.spacing = Math.round(sp)
  return o
}
export function cleanPara(p = {}) {
  const o = {}
  if (ALIGN[p.align]) o.align = ALIGN[p.align]
  const lh = Number(p.lh); if (lh >= 80 && lh <= 400) o.lh = Math.round(lh)
  if (p.pageBreak) o.pageBreak = 1
  return o
}

function ensureFont(header, face) {
  // 7개 언어 표마다 글꼴이 있으면 그 번호, 없으면 끝에 붙인다
  const ids = {}
  let h = header
  for (const lang of LANGS) {
    const re = new RegExp(`(<hh:fontface lang="${lang}" fontCnt=")(\\d+)(">)([\\s\\S]*?)(</hh:fontface>)`)
    const m = h.match(re)
    if (!m) continue
    const found = m[4].match(new RegExp(`<hh:font id="(\\d+)" face="${face.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
    if (found) { ids[lang] = found[1]; continue }
    const id = Number(m[2])
    ids[lang] = String(id)
    const font = `<hh:font id="${id}" face="${esc(face)}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`
    h = h.replace(re, `$1${id + 1}$3$4${font}$5`)
  }
  return { header: h, ids }
}

function cloneCharPr(header, baseId, style, newId) {
  const m = header.match(new RegExp(`<hh:charPr id="${baseId}"[^>]*>[\\s\\S]*?</hh:charPr>`))
  if (!m) return { header, xml: null }
  let x = m[0].replace(/^<hh:charPr id="\d+"/, `<hh:charPr id="${newId}"`)
  let h = header
  if (style.pt) x = x.replace(/ height="\d+"/, ` height="${Math.round(style.pt * 100)}"`)
  if (style.color) x = x.replace(/ textColor="[^"]*"/, ` textColor="${style.color}"`)
  if (style.bg) x = x.replace(/ shadeColor="[^"]*"/, ` shadeColor="${style.bg}"`)
  if (style.font) {
    const r = ensureFont(h, style.font); h = r.header
    x = x.replace(/<hh:fontRef [^>]*\/>/, `<hh:fontRef ${LANG_ATTR.map((a, i) => `${a}="${r.ids[LANGS[i]] ?? 0}"`).join(' ')}/>`)
  }
  if (style.ratio) x = x.replace(/<hh:ratio [^>]*\/>/, `<hh:ratio ${LANG_ATTR.map((a) => `${a}="${style.ratio}"`).join(' ')}/>`)
  if (style.spacing != null) x = x.replace(/<hh:spacing [^>]*\/>/, `<hh:spacing ${LANG_ATTR.map((a) => `${a}="${style.spacing}"`).join(' ')}/>`)
  // 꾸밈 요소는 offset 뒤에 정본 순서(italic, bold, underline, strikeout)로 둔다
  x = x.replace(/<hh:(italic|bold)\/>/g, '').replace(/<hh:underline [^>]*\/>/g, '').replace(/<hh:strikeout [^>]*\/>/g, '')
  const wasBold = /<hh:bold\/>/.test(m[0])
  const wasItalic = /<hh:italic\/>/.test(m[0])
  let deco = ''
  if (style.i || wasItalic) deco += '<hh:italic/>'
  if (style.b || wasBold) deco += '<hh:bold/>'
  if (style.u) deco += `<hh:underline type="BOTTOM" shape="SOLID" color="${style.color || '#000000'}"/>`
  if (style.s) deco += `<hh:strikeout shape="SOLID" color="${style.color || '#000000'}"/>`
  x = x.replace(/(<hh:offset [^>]*\/>)/, `$1${deco}`)
  return { header: h, xml: x }
}

function cloneParaPr(header, baseId, para, newId) {
  const m = header.match(new RegExp(`<hh:paraPr id="${baseId}"[^>]*>[\\s\\S]*?</hh:paraPr>`))
  if (!m) return null
  let x = m[0].replace(/^<hh:paraPr id="\d+"/, `<hh:paraPr id="${newId}"`)
  if (para.align) x = x.replace(/<hh:align horizontal="\w+"/, `<hh:align horizontal="${para.align}"`)
  if (para.lh) x = x.replace(/<hh:lineSpacing type="PERCENT" value="\d+"/, `<hh:lineSpacing type="PERCENT" value="${para.lh}"`)
  return x
}

function appendItems(header, tag, items) {
  if (!items.length) return header
  const re = new RegExp(`<hh:${tag} itemCnt="(\\d+)">([\\s\\S]*?)</hh:${tag}>`)
  return header.replace(re, (all, cnt, inner) => `<hh:${tag} itemCnt="${Number(cnt) + items.length}">${inner}${items.join('')}</hh:${tag}>`)
}
const maxId = (header, el) => Math.max(-1, ...[...header.matchAll(new RegExp(`<hh:${el} id="(\\d+)"`, 'g'))].map((m) => Number(m[1])))

// 마크다운 앞에서: 표지 없는 글로 돌리기(내보내기 전 검사, 미리보기 글자 수 등)
export const stripMarks = (s) => String(s || '').replace(/⟪(?:s\d+|p\d+|\/)⟫/g, '')

export async function applyHwpxStyles(JSZip, ab, { spans = {}, paras = {} } = {}) {
  const zip = await JSZip.loadAsync(ab)
  const hf = zip.file('Contents/header.xml')
  if (!hf) return { buffer: ab, applied: 0 }
  let header = await hf.async('string')
  const sectionFiles = Object.keys(zip.files).filter((f) => /^Contents\/section\d+\.xml$/.test(f)).sort()
  let nextChar = maxId(header, 'charPr') + 1
  let nextPara = maxId(header, 'paraPr') + 1
  const newChars = [], newParas = []
  const charCache = new Map(), paraCache = new Map()
  let applied = 0

  const charFor = (baseId, style) => {
    const key = `${baseId}|${JSON.stringify(style)}`
    if (charCache.has(key)) return charCache.get(key)
    const r = cloneCharPr(header, baseId, style, nextChar)
    header = r.header
    if (!r.xml) return baseId
    newChars.push(r.xml); charCache.set(key, String(nextChar)); return String(nextChar++)
  }
  const paraFor = (baseId, para) => {
    const key = `${baseId}|${JSON.stringify(para)}`
    if (paraCache.has(key)) return paraCache.get(key)
    const xml = cloneParaPr(header, baseId, para, nextPara)
    if (!xml) return baseId
    newParas.push(xml); paraCache.set(key, String(nextPara)); return String(nextPara++)
  }

  for (const f of sectionFiles) {
    let sec = await zip.file(f).async('string')
    if (!sec.includes(OPEN)) continue
    // 가장 안쪽 문단만 잡는다(표 칸 안 문단이 바깥 문단과 섞이지 않게)
    sec = sec.replace(/<hp:p ([^>]*)>((?:(?!<hp:p )[\s\S])*?)<\/hp:p>/g, (all, attrs, inner) => {
      if (!inner.includes(OPEN)) return all
      let a = attrs
      let body = inner
      // 문단 모양
      body = body.replace(PARA_RE, (_, id) => {
        const p = cleanPara(paras[id])
        if (p.align || p.lh) {
          const base = a.match(/paraPrIDRef="(\d+)"/)?.[1] || '0'
          a = a.replace(/paraPrIDRef="\d+"/, `paraPrIDRef="${paraFor(base, p)}"`)
        }
        if (p.pageBreak) a = /pageBreak="/.test(a) ? a.replace(/pageBreak="\d"/, 'pageBreak="1"') : `${a} pageBreak="1"`
        applied++
        return ''
      })
      // 글자 모양: 한 run 의 hp:t 안에서 표지를 찾아 run 을 셋으로 나눈다
      body = body.replace(/<hp:run charPrIDRef="(\d+)"([^>]*)>([\s\S]*?)<\/hp:run>/g, (run, cid, rattrs, rin) => {
        if (!rin.includes(OPEN)) return run
        const tm = rin.match(/^([\s\S]*?)<hp:t>([\s\S]*?)<\/hp:t>([\s\S]*)$/)
        if (!tm) return run.replace(/⟪(?:s\d+|\/)⟫/g, '')
        const [, pre, t, post] = tm
        const parts = []
        let last = 0
        for (const m of t.matchAll(SPAN_RE)) {
          if (m.index > last) parts.push({ cid, text: t.slice(last, m.index) })
          const st = cleanSpan(spans[m[1]])
          parts.push({ cid: Object.keys(st).length ? charFor(cid, st) : cid, text: m[2] })
          last = m.index + m[0].length
          applied++
        }
        if (last < t.length) parts.push({ cid, text: t.slice(last) })
        return parts.filter((p) => p.text).map((p, i) => `<hp:run charPrIDRef="${p.cid}"${rattrs}>${i === 0 ? pre : ''}<hp:t>${p.text.replace(/⟪(?:s\d+|\/)⟫/g, '')}</hp:t>${i === parts.length - 1 ? post : ''}</hp:run>`).join('')
      })
      // 바뀐 문단은 조판 캐시를 지운다
      body = body.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '')
      return `<hp:p ${a}>${body}</hp:p>`
    })
    sec = sec.replace(/⟪(?:s\d+|p\d+|\/)⟫/g, '')
    zip.file(f, sec)
  }
  header = appendItems(header, 'charProperties', newChars)
  header = appendItems(header, 'paraProperties', newParas)
  zip.file('Contents/header.xml', header)
  // 미리보기 글(Preview/PrvText.txt)에서도 표지를 지운다
  const prv = zip.file('Preview/PrvText.txt')
  if (prv) zip.file('Preview/PrvText.txt', stripMarks(await prv.async('string')))
  // mimetype 은 압축하지 않고 맨 앞에 둔다(OPC, HWPX 규약)
  const mt = zip.file('mimetype')
  if (mt) zip.file('mimetype', await mt.async('string'), { compression: 'STORE' })
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { buffer: out, applied }
}
