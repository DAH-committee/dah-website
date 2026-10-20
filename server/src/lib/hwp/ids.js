// 안정 블록 id: 직전 버전의 id 표와 새 버전의 블록 목록을 정렬(LCS: 종류+정규화 글)해서 이어받는다.
// id 는 `b<정수>`. 카운터는 파일마다 늘어나기만 하고 재사용하지 않는다.
import crypto from 'node:crypto'

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const h = (s) => crypto.createHash('sha1').update(s).digest('base64url').slice(0, 10)

/** 블록 지문: 같은 블록이면 같고, 글이 바뀌면 달라진다 */
export function blockKey(b) {
  if (b.type === 'table') {
    const cells = (b.table?.cells || []).map((r) => r.map((c) => norm(c.text)).join('\u0001')).join('\u0002')
    return `table|${b.table?.rows}x${b.table?.cols}|${h(cells)}`
  }
  return `${b.type}|${h(norm(b.text))}`
}
const shape = (b) => (b.type === 'table' ? `table|${b.table?.rows}x${b.table?.cols}` : b.type)

/**
 * @param prev  { keys:string[], shapes:string[], ids:string[] }  직전 버전 (없으면 처음)
 * @param next  { keys:string[], shapes:string[] }
 * @param counter 마지막으로 쓴 번호
 * @returns { ids, counter, kept:number, added:string[], removed:string[] }
 */
export function alignIds(prev, next, counter) {
  const n = next.keys.length
  const ids = new Array(n).fill(null)
  if (!prev || !prev.ids?.length) {
    for (let i = 0; i < n; i++) ids[i] = `b${++counter}`
    return { ids, counter, added: ids.slice(), removed: [] }
  }
  const m = prev.keys.length
  let lo = 0
  while (lo < m && lo < n && prev.keys[lo] === next.keys[lo]) { ids[lo] = prev.ids[lo]; lo++ }
  let mh = m, nh = n
  while (mh > lo && nh > lo && prev.keys[mh - 1] === next.keys[nh - 1]) { mh--; nh--; ids[nh] = prev.ids[mh] }
  // 가운데 부분 LCS (너무 크면 키 순서 대응으로 대체)
  const A = [], B = []
  for (let i = lo; i < mh; i++) A.push(i)
  for (let j = lo; j < nh; j++) B.push(j)
  const pairs = [] // [oldIdx, newIdx]
  if (A.length && B.length) {
    if (A.length * B.length <= 4_000_000) {
      const w = B.length + 1
      const dp = new Uint16Array((A.length + 1) * w)
      for (let a = A.length - 1; a >= 0; a--) {
        for (let b = B.length - 1; b >= 0; b--) {
          dp[a * w + b] = prev.keys[A[a]] === next.keys[B[b]] ? dp[(a + 1) * w + b + 1] + 1 : Math.max(dp[(a + 1) * w + b], dp[a * w + b + 1])
        }
      }
      let a = 0, b = 0
      while (a < A.length && b < B.length) {
        if (prev.keys[A[a]] === next.keys[B[b]]) { pairs.push([A[a], B[b]]); a++; b++ }
        else if (dp[(a + 1) * w + b] >= dp[a * w + b + 1]) a++
        else b++
      }
    } else {
      const pos = new Map()
      A.forEach((i) => { const l = pos.get(prev.keys[i]) || []; l.push(i); pos.set(prev.keys[i], l) })
      let last = -1
      for (const j of B) {
        const l = pos.get(next.keys[j])
        while (l && l.length && l[0] <= last) l.shift()
        if (l && l.length) { const i = l.shift(); pairs.push([i, j]); last = i }
      }
    }
  }
  for (const [i, j] of pairs) ids[j] = prev.ids[i]
  // 일치하지 않은 구간: 같은 종류끼리 순서대로 짝을 지어 id 를 이어받는다(고친 블록)
  const usedOld = new Set(pairs.map((p) => p[0]))
  const matchedOldAll = new Set()
  for (let i = 0; i < lo; i++) matchedOldAll.add(i)
  for (let i = mh; i < m; i++) matchedOldAll.add(i)
  for (const i of usedOld) matchedOldAll.add(i)
  const anchors = [[lo - 1, lo - 1], ...pairs, [mh, nh]]
  for (let k = 0; k < anchors.length - 1; k++) {
    const o0 = anchors[k][0] + 1, o1 = anchors[k + 1][0]
    const n0 = anchors[k][1] + 1, n1 = anchors[k + 1][1]
    const olds = []
    for (let i = o0; i < o1; i++) if (!matchedOldAll.has(i)) olds.push(i)
    let p = 0
    for (let j = n0; j < n1; j++) {
      if (ids[j]) continue
      // 이 위치 이후의 같은 모양(종류) 옛 블록
      let q = p
      while (q < olds.length && prev.shapes[olds[q]] !== next.shapes[j]) q++
      if (q < olds.length && (n1 - n0 <= olds.length || true)) {
        // 개수가 같은 구간이면 위치 대응, 다르면 모양이 같은 첫 블록
        ids[j] = prev.ids[olds[q]]
        matchedOldAll.add(olds[q])
        p = q + 1
      }
    }
  }
  const added = []
  for (let j = 0; j < n; j++) if (!ids[j]) { ids[j] = `b${++counter}`; added.push(ids[j]) }
  const present = new Set(ids)
  const removed = prev.ids.filter((x) => !present.has(x))
  return { ids, counter, added, removed }
}

export const fingerprint = (blocks) => ({ keys: blocks.map(blockKey), shapes: blocks.map(shape) })
