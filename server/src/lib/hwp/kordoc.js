// kordoc 동적 로더. 로컬에 설치되어 있지 않으면 KORDOC_PATH(패키지 폴더나 dist/index.js)를 따른다(routes/hwpx.js 와 같은 규칙).
// 둘 다 없으면 ENGINE 오류(서버는 그대로 뜬다).
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let p = null
export function loadKordoc() {
  if (!p) {
    const env = process.env.KORDOC_PATH
    const entry = env ? (/\.(c|m)?js$/.test(env) ? env : path.join(env, 'dist', 'index.js')) : null
    p = (entry ? import(pathToFileURL(entry).href) : import('kordoc')).catch((e) => {
      p = null
      throw new HwpError('ENGINE', `한글 엔진을 불러오지 못했습니다: ${e.message}`, 503)
    })
  }
  return p
}

export class HwpError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message)
    this.code = code
    this.status = status
    this.extra = extra
  }
}

// kordoc 의 실패 code → 계약의 오류
const CODE_MAP = {
  ENCRYPTED: [422, '열기 암호가 걸린 문서입니다. 한컴에서 암호를 풀고 저장한 뒤 올려 주세요.'],
  DRM_PROTECTED: [422, '문서 보안(DRM)이 걸려 있어 열 수 없습니다.'],
  CORRUPTED: [422, '파일이 손상되었거나 한글 문서가 아닙니다.'],
  UNSUPPORTED_FORMAT: [400, '한글(.hwp .hwpx)과 워드(.docx) 파일만 올릴 수 있습니다.'],
  ZIP_BOMB: [422, '안전하지 않은 압축 파일입니다.'],
  DECOMPRESSION_BOMB: [422, '안전하지 않은 압축 파일입니다.'],
  NO_SECTIONS: [422, '본문이 없는 한글 파일입니다.'],
  EMPTY_INPUT: [422, '빈 파일입니다.'],
  OUTPUT_TOO_LARGE: [422, '문서가 너무 커서 처리할 수 없습니다.'],
}
export function fromKordocFailure(r) {
  const code = r?.code || 'CORRUPTED'
  const m = CODE_MAP[code] || CODE_MAP.CORRUPTED
  const c = code === 'DECOMPRESSION_BOMB' ? 'ZIP_BOMB' : CODE_MAP[code] ? code : 'CORRUPTED'
  return new HwpError(c, m[1], m[0], { detail: String(r?.error || '').slice(0, 200) })
}
