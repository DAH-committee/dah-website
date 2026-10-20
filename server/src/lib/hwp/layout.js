// 줄배치 캐시(linesegarray) 다시 만들기. 글이 바뀐 문단의 캐시를 지우면 kordoc 렌더러가 그 문단만 따로 조판해 쪽 수가 늘어나는 일이 잦다(실측).
// 그래서 글 길이가 바뀐 문단은 줄바꿈을 다시 계산해(kordoc simulateWrap) 줄 수에 맞는 linesegarray 를 새로 쓰고,
// 같은 쪽의 뒤따르는 문단은 줄 높이 차이만큼 밀거나 당긴다. 한컴은 열 때 다시 조판하므로 이 값은 미리보기와 한컴 모두에서 근사값이다.
import { ownLineSeg, paraEnd } from './xml.js'

const num = (v) => Number(v)
export function parseHeader(xml) {
  const char = new Map(), para = new Map()
  for (const m of xml.matchAll(/<hh:charPr\b[^>]*?\bid="(\d+)"[^>]*?\bheight="(\d+)"[^>]*>([\s\S]*?)<\/hh:charPr>/g)) {
    const r = /<hh:ratio\b[^>]*\bhangul="(\d+)"/.exec(m[3])
    char.set(m[1], { height: num(m[2]), ratio: r ? num(r[1]) : 100 })
  }
  for (const m of xml.matchAll(/<hh:paraPr\b[^>]*?\bid="(\d+)"[^>]*>([\s\S]*?)<\/hh:paraPr>/g)) {
    const b = /<hh:breakSetting\b[^>]*\bbreakNonLatinWord="([A-Z_]+)"/.exec(m[2])
    para.set(m[1], { word: b ? b[1] === 'BREAK_WORD' : true })
  }
  return { char, para }
}

function parseSegs(slice) {
  const out = []
  for (const m of slice.matchAll(/<hp:lineseg\b([^>]*?)\/?>/g)) {
    const attrs = []
    for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) attrs.push([a[1], a[2]])
    out.push(attrs)
  }
  return out
}
const get = (seg, k) => Number(seg.find((a) => a[0] === k)?.[1] ?? 0)
const setv = (seg, k, v) => seg.map((a) => (a[0] === k ? [k, String(Math.round(v))] : a))
const emit = (segs) => `<hp:linesegarray>${segs.map((s) => `<hp:lineseg ${s.map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')}</hp:linesegarray>`

/** 문단 첫 글 런의 charPr id */
function firstCharPr(slice) {
  for (const m of slice.matchAll(/<hp:run\b[^>]*?\bcharPrIDRef="(\d+)"[^>]*?>(?!\s*<\/hp:run>)/g)) return m[1]
  return null
}

/** 문단 새 줄배치. 알 수 없으면 null. { xml:'<hp:linesegarray>..', step, oldLines, newLines } */
export function regen(xml, start, newText, hdr, k) {
  const end = paraEnd(xml, start)
  if (end < 0) return null
  const ls = ownLineSeg(xml, start, end)
  if (!ls) return null
  const old = parseSegs(xml.slice(ls.start, ls.end))
  if (!old.length) return null
  const open = /<hp:p\b[^>]*>/.exec(xml.slice(start, start + 600))?.[0] || ''
  const paraPr = /paraPrIDRef="(\d+)"/.exec(open)?.[1]
  const cp = hdr.char.get(firstCharPr(xml.slice(start, ls.start)) || '')
  if (!cp || !k?.simulateWrap) return null
  const mode = hdr.para.get(paraPr || '')?.word === false ? 'charAll' : 'keep'
  const first = get(old[0], 'horzsize'), cont = get(old[Math.min(1, old.length - 1)], 'horzsize') || first
  if (!first) return null
  let w
  try { w = k.simulateWrap(newText, first, cont, cp.height, cp.ratio, mode) } catch { return null }
  if (!w || !w.lines || w.lines > 400) return null
  const step = old.length > 1 ? get(old[1], 'vertpos') - get(old[0], 'vertpos') : get(old[0], 'vertsize') + get(old[0], 'spacing')
  const base = old[0]
  const segs = []
  for (let i = 0; i < w.lines; i++) {
    const tpl = old[Math.min(i, old.length - 1)]
    let s = setv(tpl, 'textpos', w.starts[i] ?? 0)
    s = setv(s, 'vertpos', get(base, 'vertpos') + i * step)
    segs.push(s)
  }
  return { range: ls, xml: emit(segs), step, oldLines: old.length, newLines: w.lines, bottom: get(base, 'vertpos') + w.lines * step }
}

/** 같은 목록(본문 또는 한 셀)의 뒤따르는 문단 첫 줄 위치를 dy 만큼 옮기는 splice 들. 쪽이 바뀌는 지점(위치가 거꾸로 감)에서 멈춘다 */
export function shiftFollowing(xml, afterEnd, dy) {
  if (!dy) return []
  const out = []
  const re = /<hp:p[\s>/]|<\/hp:p>|<\/hp:subList>|<\/hs:sec>/g
  re.lastIndex = afterEnd
  let depth = 0
  let m
  let prevFirst = -Infinity
  while ((m = re.exec(xml))) {
    const t = m[0]
    if (t === '</hp:p>') { depth--; continue }
    if (t === '</hp:subList>' || t === '</hs:sec>') { if (depth === 0) break; continue }
    const close = xml.indexOf('>', m.index)
    const selfClose = xml[close - 1] === '/'
    if (depth === 0) {
      const end = paraEnd(xml, m.index)
      const ls = end > 0 ? ownLineSeg(xml, m.index, end) : null
      if (ls) {
        const segs = parseSegs(xml.slice(ls.start, ls.end))
        if (segs.length) {
          const vp = get(segs[0], 'vertpos')
          if (vp < prevFirst) break // 다음 쪽
          prevFirst = vp
          out.push({ start: ls.start, end: ls.end, replacement: emit(segs.map((s) => setv(s, 'vertpos', get(s, 'vertpos') + dy))) })
        }
      }
    }
    if (!selfClose) depth++
  }
  return out
}

/** 문단 전체 높이(줄배치 기준) */
export function paraHeight(xml, start) {
  const end = paraEnd(xml, start)
  const ls = end > 0 ? ownLineSeg(xml, start, end) : null
  if (!ls) return 0
  const segs = parseSegs(xml.slice(ls.start, ls.end))
  if (!segs.length) return 0
  const last = segs[segs.length - 1]
  return get(last, 'vertpos') + get(last, 'vertsize') + get(last, 'spacing') - get(segs[0], 'vertpos')
}
export { parseSegs, emit, get, setv }

/** 옛 줄배치(old)를 틀로, 새 글의 줄바꿈에 맞는 줄배치. baseVert 가 있으면 첫 줄 위치를 그 값으로 */
export function segsFor(old, text, cp, mode, k, baseVert = null) {
  const first = get(old[0], 'horzsize'), cont = get(old[Math.min(1, old.length - 1)], 'horzsize') || first
  if (!first || !cp || !k?.simulateWrap) return null
  let w
  try { w = k.simulateWrap(text, first, cont, cp.height, cp.ratio, mode) } catch { return null }
  if (!w || !w.lines || w.lines > 400) return null
  const step = old.length > 1 ? get(old[1], 'vertpos') - get(old[0], 'vertpos') : get(old[0], 'vertsize') + get(old[0], 'spacing')
  const v0 = baseVert ?? get(old[0], 'vertpos')
  const segs = []
  for (let i = 0; i < w.lines; i++) {
    let sg = setv(old[Math.min(i, old.length - 1)], 'textpos', w.starts[i] ?? 0)
    sg = setv(sg, 'vertpos', v0 + i * step)
    segs.push(sg)
  }
  return { segs, step, lines: w.lines }
}

/** 새 문단(clone)용 줄배치: like 문단 조각의 줄배치를 틀로, host 문단 바로 아래에 둔다. { xml, height } 또는 null */
export function newParaLayout(likeSlice, hostXml, hostStart, text, hdr, k, extra = 0) {
  const ls = ownLineSeg(likeSlice, 0, likeSlice.length)
  if (!ls) return null
  const old = parseSegs(likeSlice.slice(ls.start, ls.end))
  if (!old.length) return null
  const open = /<hp:p\b[^>]*>/.exec(likeSlice)?.[0] || ''
  const paraPr = /paraPrIDRef="(\d+)"/.exec(open)?.[1]
  const cp = hdr.char.get(firstCharPr(likeSlice.slice(0, ls.start)) || '')
  const mode = hdr.para.get(paraPr || '')?.word === false ? 'charAll' : 'keep'
  const hEnd = paraEnd(hostXml, hostStart)
  const hls = hEnd > 0 ? ownLineSeg(hostXml, hostStart, hEnd) : null
  if (!hls) return null
  const hsegs = parseSegs(hostXml.slice(hls.start, hls.end))
  if (!hsegs.length) return null
  const baseVert = get(hsegs[0], 'vertpos') + paraHeight(hostXml, hostStart) + extra
  const r = segsFor(old, text, cp, mode, k, baseVert)
  if (!r) return null
  return { xml: emit(r.segs), height: r.lines * r.step }
}
