// HWPX(ZIP+XML) 낮은 층 도구: 섹션 XML 읽기·쓰기, 문단 범위 찾기, 안전한 ZIP 다시 쓰기.
import JSZip from './jszip.js'

export const secName = (i) => `Contents/section${i}.xml`
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function openZip(bytes) {
  return JSZip.loadAsync(bytes)
}

export async function readSections(zip) {
  const names = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
  const out = []
  for (const n of names) out.push({ name: n, index: parseInt(n.match(/\d+/)[0], 10), xml: await zip.file(n).async('string') })
  return out
}

/** 바뀐 엔트리만 바꿔 넣고 다시 묶는다. mimetype 은 첫 엔트리, 압축 없음. 나머지 엔트리는 그대로 */
export async function writeZip(zip, replaced) {
  for (const [name, data] of Object.entries(replaced)) {
    zip.file(name, data, { compression: name === 'mimetype' ? 'STORE' : 'DEFLATE', createFolders: false })
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/hwp+zip', platform: 'UNIX' })
}

/** xml[start] 에서 여는 <hp:p ...> 의 짝 닫는 태그 끝(포함) 위치. 못 찾으면 -1 */
export function paraEnd(xml, start) {
  const re = /<hp:p[\s>/]|<\/hp:p>/g
  re.lastIndex = start
  let depth = 0
  let m
  while ((m = re.exec(xml))) {
    if (m[0] === '</hp:p>') {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else {
      // 자기닫힘 <hp:p .../>
      const close = xml.indexOf('>', m.index)
      if (xml[close - 1] === '/') {
        if (depth === 0) return close + 1
        continue
      }
      depth++
    }
  }
  return -1
}

/** 문단 요소 [start,end) 안에서 이 문단 직속 linesegarray 범위 (표 안 문단의 것은 제외). 없으면 null */
export function ownLineSeg(xml, start, end) {
  const re = /<hp:p[\s>/]|<\/hp:p>|<hp:linesegarray[\s>/]/g
  re.lastIndex = start
  let depth = 0
  let m
  while ((m = re.exec(xml)) && m.index < end) {
    const t = m[0]
    if (t === '</hp:p>') depth--
    else if (t.startsWith('<hp:linesegarray')) {
      if (depth === 1) {
        const open = xml.indexOf('>', m.index)
        if (xml[open - 1] === '/') return { start: m.index, end: open + 1 }
        const close = xml.indexOf('</hp:linesegarray>', open)
        if (close < 0) return null
        return { start: m.index, end: close + '</hp:linesegarray>'.length }
      }
    } else {
      const close = xml.indexOf('>', m.index)
      if (xml[close - 1] !== '/') depth++
    }
  }
  return null
}

/** 섹션 직속(최상위) 문단 시작 위치들: <hs:sec> 의 자식 hp:p */
export function topLevelParas(xml) {
  const out = []
  const re = /<hp:p[\s>/]|<\/hp:p>/g
  let depth = 0
  let m
  while ((m = re.exec(xml))) {
    if (m[0] === '</hp:p>') { depth--; continue }
    const close = xml.indexOf('>', m.index)
    const selfClose = xml[close - 1] === '/'
    if (depth === 0) out.push({ start: m.index, end: selfClose ? close + 1 : -1 })
    if (!selfClose) depth++
  }
  // 끝 위치 채우기
  for (const p of out) if (p.end < 0) p.end = paraEnd(xml, p.start)
  return out
}

/** 위치 pos 를 품은 최상위 문단 */
export function hostPara(xml, pos, tops = topLevelParas(xml)) {
  for (const p of tops) if (pos >= p.start && pos < p.end) return p
  return null
}

/** 속성값 읽기 */
export function attr(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? m[1] : null
}
