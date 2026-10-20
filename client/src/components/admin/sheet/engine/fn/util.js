import { GErr, isErr, eValue, eNum, eNA } from '../errors.js'
import { isRng, isMat, N, S, B, parseNumberText, compare, flatten } from '../coerce.js'

/** 집계 함수용 숫자 모으기. 범위/배열 안의 텍스트·불리언·빈 칸은 무시, 직접 인수는 변환한다. */
export function collectNums(args, ctx, { boolsInRange = false } = {}) {
  const out = []
  for (const a of args) {
    if (isRng(a) || isMat(a)) {
      const m = ctx.mat(a)
      for (const row of m) for (const v of row) {
        if (typeof v === 'number') out.push(v)
        else if (v instanceof GErr) throw v
        else if (boolsInRange && typeof v === 'boolean') out.push(v ? 1 : 0)
      }
    } else if (a instanceof GErr) throw a
    else if (a == null) continue
    else out.push(N(a))
  }
  return out
}
/** *A 계열: 텍스트는 0, TRUE는 1 (범위 안에서도) */
export function collectNumsA(args, ctx) {
  const out = []
  for (const a of args) {
    if (isRng(a) || isMat(a)) {
      for (const row of ctx.mat(a)) for (const v of row) {
        if (v instanceof GErr) throw v
        if (typeof v === 'number') out.push(v)
        else if (typeof v === 'boolean') out.push(v ? 1 : 0)
        else if (typeof v === 'string') out.push(0)
      }
    } else if (a instanceof GErr) throw a
    else if (a != null) out.push(typeof a === 'string' ? (parseNumberText(a) ?? 0) : N(a))
  }
  return out
}
export const mat = (v, ctx) => ctx.mat(v)
/** 범위/배열을 평탄한 값 배열로 */
export const flat = (v, ctx) => flatten(ctx.mat(v))
export const numFlat = (v, ctx) => flat(v, ctx).filter((x) => typeof x === 'number')
/** 같은 크기의 범위 인수를 평탄하게 */
export function sameShape(ms, name) {
  const r = ms[0].length, c = ms[0][0]?.length ?? 0
  for (const m of ms) if (m.length !== r || (m[0]?.length ?? 0) !== c) throw eValue(`Function ${name} expects ranges of the same size.`)
}
export const optNum = (v, d) => (v == null ? d : N(v))
export const optBool = (v, d) => (v == null ? d : B(v))
export const chk = (cond, msg) => { if (!cond) throw eNum(msg) }
export { GErr, isErr, eValue, eNum, eNA, isRng, isMat, N, S, B, compare }
