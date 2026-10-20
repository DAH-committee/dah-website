// jszip 로더. 서버는 jszip 을 의존성으로 두지만(package.json), 개발 PC 의 node_modules 가 다른 프로젝트로 이어져 있어
// 없을 수 있다. 그때는 KORDOC_PATH 옆에 설치된 jszip 으로 되돌아간다. docIR 복사본이 `import JSZip from 'jszip'` 대신 이 파일을 쓴다.
import { createRequire } from 'node:module'
import path from 'node:path'

async function load() {
  try {
    const m = await import('jszip')
    return m.default || m
  } catch (e) {
    const p = process.env.KORDOC_PATH
    if (!p) throw e
    const entry = /\.(c|m)?js$/.test(p) ? p : path.join(p, 'dist', 'index.js')
    const m = createRequire(entry)('jszip')
    return m.default || m
  }
}

// 불러오지 못해도 서버(다른 기능)는 떠야 한다: 쓰는 순간에만 오류를 낸다
let JSZip
try {
  JSZip = await load()
} catch (e) {
  const fail = () => Object.assign(new Error(`jszip 없음: ${e.message}`), { code: 'ENGINE', status: 503 })
  JSZip = function Missing() { throw fail() }
  JSZip.loadAsync = async () => { throw fail() }
}
export default JSZip
