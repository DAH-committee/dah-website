// 시트 오류 값. 구글 시트와 같은 코드와 영어 메시지를 쓰고, 한국어 요약은 summaryKo로 따로 준다.
export class GErr {
  constructor(code, message) {
    this.code = code
    this.message = message || DEFAULT_MSG[code] || ''
  }
  toString() { return this.code }
}
export const isErr = (v) => v instanceof GErr

const DEFAULT_MSG = {
  '#DIV/0!': 'Evaluation of function DIVIDE caused a divide by zero error.',
  '#N/A': 'Value not available.',
  '#NAME?': 'Unknown name.',
  '#NUM!': 'Numeric value is invalid.',
  '#REF!': 'Reference does not exist.',
  '#VALUE!': 'Wrong value type.',
  '#ERROR!': 'Formula parse error.',
}
export const SUMMARY_KO = {
  '#DIV/0!': '0으로 나눌 수 없다.',
  '#N/A': '찾는 값이 없거나 인수 개수가 맞지 않다.',
  '#NAME?': '알 수 없는 함수나 이름이다.',
  '#NUM!': '숫자 값이 허용 범위를 벗어났다.',
  '#REF!': '참조가 없거나 순환 참조이거나 결과 배열을 펼칠 수 없다.',
  '#VALUE!': '값의 종류가 맞지 않다.',
  '#ERROR!': '수식 구문 오류다.',
}
export const summaryKo = (code) => SUMMARY_KO[code] || '알 수 없는 오류다.'

export const ERROR_CODES = Object.keys(SUMMARY_KO)

export const eDiv0 = (fn) => new GErr('#DIV/0!', fn ? `Evaluation of function ${fn} caused a divide by zero error.` : undefined)
export const eNA = (msg) => new GErr('#N/A', msg)
export const eName = (name) => new GErr('#NAME?', name ? `Unknown function: '${name}'.` : undefined)
export const eNum = (msg) => new GErr('#NUM!', msg)
export const eRef = (msg) => new GErr('#REF!', msg)
export const eValue = (msg) => new GErr('#VALUE!', msg)
export const eParse = (msg) => new GErr('#ERROR!', msg || 'Formula parse error.')
export const eCirc = () => new GErr('#REF!', 'Circular dependency detected. To resolve with iterative calculation, see File > Settings.')

/** ERROR.TYPE 번호 (구글 문서 기준) */
export const ERROR_TYPE_NUM = { '#NULL!': 1, '#DIV/0!': 2, '#VALUE!': 3, '#REF!': 4, '#NAME?': 5, '#NUM!': 6, '#N/A': 7, '#ERROR!': 8 }
