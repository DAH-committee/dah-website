// 문단 글(디코딩된 UTF-16 위치) ↔ XML 위치 대응. kordoc buildRangeSplices 는 엔티티(&amp; &lt; ...)나 내부 태그가 든 hp:t 에서 null 을 돌려줘
// 그때 문단 전체를 다시 쓰게 되는데(서식·줄배치 손실), 여기서는 위치 표를 직접 만들어 바뀌는 범위만 고친다.
import { esc } from './xml.js'

const ENT = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }
function decodeEntity(e) {
  const m = /^&(?:#x([0-9a-fA-F]+)|#(\d+)|(\w+));$/.exec(e)
  if (!m) return null
  if (m[1]) return String.fromCodePoint(parseInt(m[1], 16))
  if (m[2]) return String.fromCodePoint(parseInt(m[2], 10))
  return ENT[m[3]] ?? null
}

/** 문단의 글자 단위 표. units[i] = { x0, x1, t(몇 번째 hp:t), tag(내부 태그를 공백으로 바꾼 자리) } */
export function unitMap(xml, para) {
  const units = []
  para.tRanges.forEach((r, ti) => {
    if (r.selfClosing) return
    const raw = xml.slice(r.contentStart, r.contentEnd)
    let i = 0
    while (i < raw.length) {
      const c = raw[i]
      if (c === '<') {
        const end = raw.indexOf('>', i)
        if (end < 0) return
        units.push({ x0: r.contentStart + i, x1: r.contentStart + end + 1, t: ti, tag: true })
        i = end + 1
      } else if (c === '&') {
        const end = raw.indexOf(';', i)
        const d = end > 0 ? decodeEntity(raw.slice(i, end + 1)) : null
        if (d === null) { units.push({ x0: r.contentStart + i, x1: r.contentStart + i + 1, t: ti }); i++; continue }
        for (let q = 0; q < d.length; q++) units.push({ x0: r.contentStart + i, x1: r.contentStart + end + 1, t: ti, part: q, parts: d.length })
        i = end + 1
      } else {
        units.push({ x0: r.contentStart + i, x1: r.contentStart + i + 1, t: ti })
        i++
      }
    }
  })
  return units
}

/** 디코딩된 글의 [s,e) 를 rep 로 바꾸는 splice. 안 되면 null */
export function rangeSplices(xml, para, s, e, rep) {
  const units = unitMap(xml, para)
  if (units.length !== para.text.length) return null
  if (s < 0 || e > units.length || s > e) return null
  for (let i = s; i < e; i++) {
    if (units[i].tag) return null
    // 서로게이트/엔티티 한 글자의 반쪽만 건드리지 않는다
    if (units[i].parts > 1 && ((units[i].part === 0 && i + units[i].parts > e) || (units[i].part > 0 && i - units[i].part < s))) return null
  }
  const text = esc(rep)
  if (s === e) {
    if (!units.length) return null
    if (s > 0) { const u = units[s - 1]; if (u.tag) return null; return [{ start: u.x1, end: u.x1, replacement: text }] }
    return [{ start: units[0].x0, end: units[0].x0, replacement: text }]
  }
  // 걸친 hp:t 마다 구간을 모은다. 첫 구간에 rep, 나머지는 지운다
  const groups = []
  for (let i = s; i < e; i++) {
    const u = units[i]
    const g = groups[groups.length - 1]
    if (g && g.t === u.t) g.x1 = u.x1
    else groups.push({ t: u.t, x0: u.x0, x1: u.x1 })
  }
  return groups.map((g, k) => ({ start: g.x0, end: g.x1, replacement: k === 0 ? text : '' }))
}
