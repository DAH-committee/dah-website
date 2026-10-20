// sheetEngine.js: AI 도구가 수식 엔진(engine/, 계약은 engine/README.md)을 부르는 얇은 어댑터.
// 엔진 API 가 바뀌어도 도구 코드는 그대로 두려고 사이에 둔다.
//
// 어댑터 모양(도구가 쓰는 것)
//   listFunctions()                      -> [{ name, category, minArgs, maxArgs, signature, summary_ko }]
//   validateFormula(text)                -> { ok:true } | { ok:false, message, unknown?:string[], suggestion?:string }
//   evaluator(state)                     -> { display(sheetId,c,r), info(sheetId,c,r) -> { isError, code, message?, blocked?, spill?:{rows,cols}, spillOf? } }
//                                           c 는 0부터 세는 열, r 은 시트 행 번호(1 = 머리글)
//   dryRun(state, sheetId, formula)      -> { display, isError, code, message?, spill?: {rows, cols, preview} }   (시트에 쓰지 않고 한 번 계산)
//
// mod: engine/index.js 또는 formula.js 가 내보내는 { createEvaluator, validateFormula, listFunctions }
import { columnsOf, rawAt } from './sheetModel.js'

const SPILL_PREVIEW = 8

export function makeEngine(mod) {
  const fnSpecs = new Map(mod.listFunctions().map((f) => [f.name, f]))

  /** 상태 전체를 읽는 엔진 한 벌을 만든다. extra: { sheetId, c, r, raw, padRows, padCols } 칸 하나를 덧씌운다(모의 계산용) */
  function build(state, extra) {
    const byId = new Map(state.sheets.map((s) => [s.id, s]))
    const colsCache = new Map()
    const colsOf = (s) => {
      if (!colsCache.has(s.id)) colsCache.set(s.id, columnsOf(state, s))
      return colsCache.get(s.id)
    }
    const defaultSheet = state.activeId && byId.has(state.activeId) ? state.activeId : state.sheets[0]?.id
    const dims = (s) => ({ rows: s.rows.length + 1 + (extra && extra.sheetId === s.id ? extra.padRows : 0), cols: colsOf(s).length + (extra && extra.sheetId === s.id ? extra.padCols : 0) })
    return mod.createEvaluator({
      getRaw: (c, r, sid) => {
        const s = byId.get(sid === undefined ? defaultSheet : sid)
        if (!s) return null
        if (extra && extra.sheetId === s.id && c === extra.c && r === extra.r) return extra.raw
        const d = dims(s)
        if (c < 0 || r < 1 || r > d.rows || c >= d.cols) return null
        if (c >= colsOf(s).length || r > s.rows.length + 1) return ''
        return rawAt(state, s, c, r, colsOf(s))
      },
      getBounds: (sid) => {
        const s = byId.get(sid === undefined ? defaultSheet : sid)
        return s ? dims(s) : { rows: 0, cols: 0 }
      },
      sheets: state.sheets.map((s) => ({ id: s.id, name: s.label })),
      defaultSheet,
    })
  }

  const infoOf = (ev, sid, c, r) => {
    const x = ev.evaluateCell(sid, { c, r })
    const out = { isError: Boolean(x.error), code: x.error ? x.error.code : null }
    if (x.error) out.message = x.error.message
    if (x.spillBlocked) out.blocked = true
    if (x.spill) out.spill = { rows: x.spill.rows, cols: x.spill.cols }
    if (x.spillOwner) out.spillOf = x.spillOwner.ref
    return out
  }

  return {
    name: 'engine',
    listFunctions: () => mod.listFunctions(),
    validateFormula(text) {
      const v = mod.validateFormula(text)
      if (v.ok) return { ok: true, mayArray: v.mayArray, functions: v.functionsUsed }
      if (v.unknownFunctions?.length) {
        const parts = v.unknownFunctions.map((n) => {
          const s = v.suggestions?.[n]
          return s ? `${n} (비슷한 함수: ${s}${fnSpecs.get(s) ? `, 사용법 ${fnSpecs.get(s).signature}` : ''})` : n
        })
        return { ok: false, unknown: v.unknownFunctions, suggestion: v.suggestions?.[v.unknownFunctions[0]], message: `지원하지 않는 함수: ${parts.join(', ')}. 지원 함수 목록에 있는 이름으로 고치세요` }
      }
      if (v.arityProblems?.length) {
        const p = v.arityProblems[0]
        const spec = fnSpecs.get(p.name)
        const need = p.max == null ? `${p.min}개 이상` : p.min === p.max ? `${p.min}개` : `${p.min}~${p.max}개`
        return { ok: false, message: `${p.name} 인수가 ${p.got}개입니다. ${need} 필요합니다${spec ? ` (사용법 ${spec.signature})` : ''}` }
      }
      return { ok: false, message: `${v.error?.summary_ko || '수식 구문 오류다.'} ${v.error?.message || ''}`.trim() + ' 괄호, 따옴표, 쉼표를 확인하세요' }
    },
    evaluator(state) {
      const ev = build(state)
      return {
        display: (sid, c, r) => ev(c, r, sid) ?? '',
        info: (sid, c, r) => infoOf(ev, sid, c, r),
      }
    },
    dryRun(state, sheetId, formula) {
      const sheet = state.sheets.find((s) => s.id === sheetId) || state.sheets[0]
      const cols = columnsOf(state, sheet).length
      // 데이터 오른쪽의 빈 열 맨 위 칸에 수식을 임시로 두고 계산한다(펼침 여유를 위해 격자를 넉넉히 늘린다)
      const extra = { sheetId: sheet.id, c: cols, r: 1, raw: formula, padRows: 1000, padCols: 60 }
      const ev = build({ ...state, activeId: sheet.id }, extra)
      const x = ev.evaluateCell(sheet.id, { c: cols, r: 1 })
      const out = { display: ev(cols, 1, sheet.id) ?? '', isError: Boolean(x.error), code: x.error ? x.error.code : null }
      if (x.error) out.message = x.error.message
      if (x.spill) {
        const preview = x.spill.values.slice(0, SPILL_PREVIEW).map((row) => row.slice(0, SPILL_PREVIEW).map((v) => (v == null ? '' : String(v))))
        out.spill = { rows: x.spill.rows, cols: x.spill.cols, preview, truncated: x.spill.rows > SPILL_PREVIEW || x.spill.cols > SPILL_PREVIEW }
      }
      return out
    },
  }
}
