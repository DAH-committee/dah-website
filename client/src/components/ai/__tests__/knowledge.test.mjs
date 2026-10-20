// 설명서 글 점검: 크기 상한. (Vite 없이 node 로 파일을 직접 읽는다)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
const dir = new URL('../knowledge/', import.meta.url)
for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  test(`설명서 ${f}: 6000자 이내`, () => {
    const s = readFileSync(new URL(f, dir), 'utf8')
    assert.ok(s.length <= 6000, `${f} ${s.length}자`)
  })
}
