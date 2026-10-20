// 스프레드시트 수식 계산기 진입점. 실제 구현은 engine/ 아래에 있다 (구글 시트 호환 엔진, engine/README.md 참고).
// 기존 호환: createEvaluator(getRaw, now) -> (c, r) => 화면 표시 문자열, colIndexOf(letters), fmtNum(n)
export { createEvaluator, colIndexOf, fmtNum, validateFormula, evaluateFormulaOnce, listFunctions, hasFunction, suggestFunction, createMemoryHost, createEngine } from './engine/index.js'
