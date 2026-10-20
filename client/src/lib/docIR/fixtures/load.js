// 시험 문서 불러오기(Node 전용). base64 로 적힌 이미지 바이트를 Uint8Array 로 되돌린다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const FIXTURE_NAMES = ['mentoring-report', 'gian', 'plan-report', 'table-torture', 'typography', 'typography-landscape']

export function listFixtures() {
  return fs.readdirSync(here).filter((f) => f.endsWith('.ir.json')).map((f) => f.replace(/\.ir\.json$/, '')).sort()
}

export function reviveIR(json) {
  const ir = typeof json === 'string' ? JSON.parse(json) : json
  for (const a of Object.values(ir.assets || {})) {
    if (typeof a.data === 'string') a.data = new Uint8Array(Buffer.from(a.data, 'base64'))
  }
  return ir
}

// 이미지 바이트를 base64 문자열로 바꾼 JSON 용 복사본
export function freezeIR(ir) {
  return JSON.parse(JSON.stringify(ir, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v)))
}

export function fixturePath(name) {
  return path.join(here, `${name}.ir.json`)
}

export function loadFixture(name) {
  const p = fixturePath(name)
  if (!fs.existsSync(p)) throw new Error(`시험 문서 없음: ${name} (있는 것: ${listFixtures().join(', ')})`)
  return reviveIR(fs.readFileSync(p, 'utf8'))
}
