// 시트 관찰 배치 규칙(실행기와 corpus 생성기가 같이 쓴다).
// 스칼라 수식은 H열 1행부터 한 줄에 하나, 배열(스필) 수식은 J열에서 BLOCK_ROWS 행 간격으로 놓는다.
// 노트에 "스필"이 들어간 스칼라는 배열 쪽으로 옮긴다. 마지막에 순환 사례 하나를 덧붙인다.
import { FIXTURE, SCALARS, ARRAYS, BLOCK_ROWS } from './sheets-cases.mjs'

export function splitCases() {
  const sc = []
  const ar = [...ARRAYS]
  for (const c of SCALARS) (c[1].includes('스필') ? ar : sc).push(c)
  sc.push(['=SUM(H:H)', '순환: 자기 열 전체를 합산', false])
  return { sc, ar }
}

const colIdx = (c) => c.charCodeAt(0) - 65

/** 시트에 붙여 넣을 2차원 배열(A1부터, 열 A~J) */
export function buildMatrix() {
  const { sc, ar } = splitCases()
  const rows = Math.max(sc.length, ar.length * BLOCK_ROWS) + 1
  const mat = Array.from({ length: rows }, () => Array(10).fill(''))
  for (const [k, v] of Object.entries(FIXTURE)) {
    mat[Number(k.slice(1)) - 1][colIdx(k[0])] = v === null ? '' : v === true ? '=TRUE' : v
  }
  sc.forEach((c, i) => { mat[i][7] = c[0] })
  ar.forEach((c, k) => { mat[k * BLOCK_ROWS][9] = c[0] })
  return { matrix: mat, sc, ar }
}
// 순환 참조 사례는 S1, S2:T2 에 따로 붙인다.
export const CIRCULAR = [
  { cell: 'S1', formula: '=S1+1', setup: {}, note: '순환: 자기 참조' },
  { cell: 'S2', formula: '=T2', setup: { T2: '=S2' }, note: '순환: 두 셀 상호 참조(S2)' },
  { cell: 'T2', formula: '=S2', setup: { S2: '=T2' }, note: '순환: 두 셀 상호 참조(T2)' },
]
export { FIXTURE, BLOCK_ROWS }
