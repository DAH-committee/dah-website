// HWPX 깊은 검사: kordoc validate 가 보지 않는 참조 번호, 표 격자, 항목 수, 그림 연결을 본다.
// 한컴이 조용히 고치거나 손상 문서로 여기는 흔한 원인(없는 borderFill 번호, rowCnt/colCnt 불일치 등)을 미리 잡는다.
import JSZip from 'jszip'
import { parseXml } from '../readHwpx.js'

const kids = (n, name) => (n ? n.c.filter((x) => typeof x !== 'string' && (!name || x.n === name)) : [])
const kid = (n, name) => kids(n, name)[0]
function all(n, name, out = []) {
  if (!n || typeof n === 'string') return out
  if (n.n === name) out.push(n)
  for (const c of n.c) all(c, name, out)
  return out
}

export async function checkHwpx(bytes) {
  const issues = []
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  const first = Object.keys(zip.files)[0]
  if (first !== 'mimetype') issues.push(`첫 엔트리가 mimetype 이 아님: ${first}`)
  const mt = await zip.file('mimetype').async('string')
  if (mt !== 'application/hwp+zip') issues.push(`mimetype 내용: ${mt}`)
  const head = parseXml(await zip.file('Contents/header.xml').async('string'))
  const h = kid(head, 'head')
  const ref = kid(h, 'refList')
  const ids = (parent, child) => new Set(kids(kid(ref, parent), child).map((x) => x.a.id))
  const sets = {
    charPr: ids('charProperties', 'charPr'),
    paraPr: ids('paraProperties', 'paraPr'),
    borderFill: ids('borderFills', 'borderFill'),
    style: ids('styles', 'style'),
    tabPr: ids('tabProperties', 'tabPr'),
    numbering: ids('numberings', 'numbering'),
  }
  // 목록 항목 수와 번호 연속성
  const countAttr = { fontfaces: 'fontface', borderFills: 'borderFill', charProperties: 'charPr', tabProperties: 'tabPr', numberings: 'numbering', paraProperties: 'paraPr', styles: 'style' }
  for (const [p, c] of Object.entries(countAttr)) {
    const el = kid(ref, p)
    if (!el) { issues.push(`refList/${p} 없음`); continue }
    const n = kids(el, c).length
    if (String(n) !== el.a.itemCnt) issues.push(`${p} itemCnt=${el.a.itemCnt} 인데 실제 ${n}`)
  }
  for (const [name, set] of Object.entries(sets)) {
    const arr = [...set].map(Number).sort((a, b) => a - b)
    const base = name === 'borderFill' ? 1 : 0
    if (name !== 'numbering' && name !== 'style' && arr.some((v, i) => v !== i + base)) issues.push(`${name} 번호가 연속이 아님: ${arr.slice(0, 8)}...`)
  }
  const fontIds = {}
  for (const ff of kids(kid(ref, 'fontfaces'), 'fontface')) fontIds[ff.a.lang] = new Set(kids(ff, 'font').map((f) => f.a.id))
  for (const cp of kids(kid(ref, 'charProperties'), 'charPr')) {
    const fr = kid(cp, 'fontRef')
    for (const [lang, id] of Object.entries(fr.a)) {
      const L = { hangul: 'HANGUL', latin: 'LATIN', hanja: 'HANJA', japanese: 'JAPANESE', other: 'OTHER', symbol: 'SYMBOL', user: 'USER' }[lang]
      if (!fontIds[L]?.has(id)) issues.push(`charPr ${cp.a.id}: ${lang} 글꼴 ${id} 없음`)
    }
    if (!sets.borderFill.has(cp.a.borderFillIDRef)) issues.push(`charPr ${cp.a.id}: borderFill ${cp.a.borderFillIDRef} 없음`)
  }
  for (const pp of kids(kid(ref, 'paraProperties'), 'paraPr')) {
    const b = all(pp, 'border')[0]
    if (b && !sets.borderFill.has(b.a.borderFillIDRef)) issues.push(`paraPr ${pp.a.id}: borderFill ${b.a.borderFillIDRef} 없음`)
    if (!sets.tabPr.has(pp.a.tabPrIDRef)) issues.push(`paraPr ${pp.a.id}: tabPr 없음`)
  }
  for (const st of kids(kid(ref, 'styles'), 'style')) {
    if (!sets.paraPr.has(st.a.paraPrIDRef) || !sets.charPr.has(st.a.charPrIDRef)) issues.push(`style ${st.a.id}: 참조 번호 없음`)
  }
  // 매니페스트
  const hpf = parseXml(await zip.file('Contents/content.hpf').async('string'))
  const items = {}
  for (const it of all(hpf, 'item')) items[it.a.id] = it.a.href
  for (const [id, href] of Object.entries(items)) if (!zip.file(href)) issues.push(`매니페스트 ${id} -> ${href} 파일 없음`)
  const secCnt = Number(h.a.secCnt)
  const secs = names.filter((n) => /^Contents\/section\d+\.xml$/.test(n))
  if (secCnt !== secs.length) issues.push(`secCnt=${secCnt} 실제 ${secs.length}`)
  // 본문
  const objIds = new Set()
  let tables = 0
  for (const sp of secs) {
    const sec = parseXml(await zip.file(sp).async('string'))
    for (const p of all(sec, 'p')) {
      if (p.a.paraPrIDRef !== undefined && !sets.paraPr.has(p.a.paraPrIDRef)) issues.push(`p: paraPr ${p.a.paraPrIDRef} 없음`)
      if (p.a.styleIDRef !== undefined && !sets.style.has(p.a.styleIDRef)) issues.push(`p: style ${p.a.styleIDRef} 없음`)
    }
    for (const r of all(sec, 'run')) if (r.a.charPrIDRef !== undefined && !sets.charPr.has(r.a.charPrIDRef)) issues.push(`run: charPr ${r.a.charPrIDRef} 없음`)
    for (const e of all(sec, 'tc')) if (!sets.borderFill.has(e.a.borderFillIDRef)) issues.push(`tc: borderFill ${e.a.borderFillIDRef} 없음`)
    for (const t of all(sec, 'tbl')) {
      tables++
      if (!sets.borderFill.has(t.a.borderFillIDRef)) issues.push(`tbl: borderFill ${t.a.borderFillIDRef} 없음`)
      if (objIds.has(t.a.id)) issues.push(`개체 id 중복 ${t.a.id}`)
      objIds.add(t.a.id)
      const trs = kids(t, 'tr')
      const rowCnt = Number(t.a.rowCnt)
      const colCnt = Number(t.a.colCnt)
      if (trs.length !== rowCnt) issues.push(`tbl ${t.a.id}: rowCnt=${rowCnt} 인데 tr ${trs.length}`)
      const cover = Array.from({ length: rowCnt }, () => Array(colCnt).fill(0))
      let maxCol = 0
      const sz = kid(t, 'sz').a
      const w0 = kids(trs[0], 'tc').reduce((a, c) => a + Number(kid(c, 'cellSz').a.width), 0)
      if (Math.abs(w0 - Number(sz.width)) > 2) issues.push(`tbl ${t.a.id}: 첫 행 칸 폭 합 ${w0} != sz.width ${sz.width}`)
      trs.forEach((tr, ri) => {
        for (const tc of kids(tr, 'tc')) {
          const a = kid(tc, 'cellAddr').a
          const sp2 = kid(tc, 'cellSpan').a
          const c0 = Number(a.colAddr)
          const r0 = Number(a.rowAddr)
          if (r0 !== ri) issues.push(`tbl ${t.a.id}: rowAddr ${r0} != tr 순서 ${ri}`)
          for (let rr = r0; rr < r0 + Number(sp2.rowSpan); rr++) for (let cc = c0; cc < c0 + Number(sp2.colSpan); cc++) {
            if (rr >= rowCnt || cc >= colCnt) { issues.push(`tbl ${t.a.id}: 칸이 표 밖으로 나감 (${cc},${rr})`); continue }
            cover[rr][cc]++
          }
          maxCol = Math.max(maxCol, c0 + Number(sp2.colSpan))
          const sl = kid(tc, 'subList')
          if (!sl || !kids(sl, 'p').length) issues.push(`tbl ${t.a.id}: 칸에 문단 없음`)
        }
      })
      cover.forEach((row, rr) => row.forEach((v, cc) => { if (v !== 1) issues.push(`tbl ${t.a.id}: (${cc},${rr}) 덮임 ${v}회`) }))
    }
    for (const pic of all(sec, 'pic')) {
      const img = all(pic, 'img')[0]
      const id = img?.a.binaryItemIDRef
      if (!items[id]) issues.push(`pic: binaryItemIDRef ${id} 가 매니페스트에 없음`)
      if (objIds.has(pic.a.id)) issues.push(`개체 id 중복 ${pic.a.id}`)
      objIds.add(pic.a.id)
    }
  }
  return { ok: issues.length === 0, issues, tables }
}
