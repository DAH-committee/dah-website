// test/hwpFiles.test.mjs: 한글 파일(kind=hwp) 엔진·저장·API (DB 는 메모리 가짜). kordoc 이 없으면 엔진 시험은 건너뛴다.
// 개인 파일 시험: HWP_FIXTURES=<hwpx 폴더> 를 주면 그 파일들로 서식 보존 시험을 더 돌린다(원본 수정 없음, 내용 출력 없음).
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
process.env.DRIVE_TOKEN_ENC_KEY = process.env.DRIVE_TOKEN_ENC_KEY || 'test-key-for-hwp-files-0123456789abcdef'
delete process.env.DATABASE_URL

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { resetHwpSchemaForTest } from '../src/lib/hwpSchema.js'
import { purgeFile } from '../src/lib/wsAccess.js'
import { setBlobAdapter } from '../src/lib/hwp/store.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const TPL = path.join(here, '../../client/public/templates')

let K = null
try { K = await (await import('../src/lib/hwp/kordoc.js')).loadKordoc() } catch { K = null }
const skip = K ? false : 'kordoc 이 설치되어 있지 않음(KORDOC_PATH 로 지정)'

const OWNER = { id: 1, email: 'o@example.com', name: '소유자', role: 'manager' }
const OTHER = { id: 9, email: 'x@example.com', name: '남', role: 'manager' }
const VIEWER = { id: 8, email: 'v@example.com', name: '보기', role: 'manager' }
const cookie = (u) => `dah_access=${jwt.sign({ sub: u.id, email: u.email, name: u.name, role: u.role, type: 'access' }, 'test-secret', { expiresIn: '15m' })}`

// ── 메모리 가짜 DB: /*hwp:...*/ 표지와 wsAccess 가 쓰는 질의만 흉내 낸다 ──
function fakeDb() {
  const st = { files: [], keys: new Map(), blobs: [], versions: [], seq: 1, blobSeq: 1, shares: [] }
  const db = {
    st,
    async query(text, p = []) {
      const t = String(text)
      const tag = /\/\*hwp:(\w+)\*\//.exec(t)?.[1]
      const rows = (r) => ({ rows: r, rowCount: r.length })
      if (/^\s*(CREATE|ALTER)/i.test(t)) return rows([])
      if (tag === 'createFile') {
        const f = { id: st.seq++, kind: 'hwp', title: p[0], content: JSON.parse(p[1]), created_by: p[2], owner_email: p[3], share_token: p[4], team_id: p[5], general_access: p[6], general_role: p[7], gated: false, form_id: null, last_edit: null, owner_only: false, deleted_at: null, created_at: new Date(), updated_at: new Date() }
        st.files.push(f)
        return rows([f])
      }
      if (t.includes('FROM ws_files WHERE id = $1') && t.startsWith('SELECT id, kind')) return rows(st.files.filter((f) => f.id === Number(p[0])))
      if (t.startsWith('SELECT content, created_at, updated_at FROM ws_files')) return rows(st.files.filter((f) => f.id === Number(p[0])).map((f) => ({ content: f.content, created_at: f.created_at, updated_at: f.updated_at })))
      if (tag === 'updateFile') { const f = st.files.find((x) => x.id === p[0]); f.content = JSON.parse(p[1]); if (p[2]) f.title = p[2]; f.updated_at = new Date(); return rows([]) }
      if (t.includes('FROM ws_files f') && t.includes('f.kind = $1')) return rows(st.files.filter((f) => f.kind === 'hwp' && !f.deleted_at && p[1] !== true && p[2].includes(String(f.owner_email))))
      if (t.startsWith('SELECT team_id, role FROM team_members')) return rows([])
      if (t.startsWith('SELECT role FROM ws_shares')) return rows(st.shares.filter((s) => s.ws_id === p[0] && p[1].includes(s.email)).map((s) => ({ role: s.role })))
      if (t.startsWith('UPDATE ws_files SET opened_at') || t.includes('INTO ws_recent')) return rows([])
      if (tag === 'getKey') { const k = st.keys.get(p[0]); return rows(k ? [{ sealed_key: k.sealed_key, id_counter: k.id_counter }] : []) }
      if (tag === 'insertKey') { st.keys.set(p[0], { sealed_key: p[1], id_counter: 0 }); return rows([]) }
      if (tag === 'setCounter') { const k = st.keys.get(p[0]); if (k) k.id_counter = p[1]; return rows([]) }
      if (tag === 'findBlob') return rows(st.blobs.filter((b) => b.file_id === p[0] && b.sha256 === p[1]).slice(0, 1).map((b) => ({ id: b.id })))
      if (tag === 'insertBlob') { const b = { id: st.blobSeq++, file_id: p[0], sha256: p[1], size: p[2], data: p[3], blob_url: p[4] }; st.blobs.push(b); return rows([{ id: b.id }]) }
      if (tag === 'getBlob') return rows(st.blobs.filter((b) => b.id === p[0] && b.file_id === p[1]).map((b) => ({ data: b.data, blob_url: b.blob_url })))
      if (tag === 'maxVersion') return rows([{ v: Math.max(0, ...st.versions.filter((v) => v.file_id === p[0]).map((v) => v.version)) }])
      if (tag === 'insertVersion') {
        if (st.versions.some((v) => v.file_id === p[0] && v.version === p[1])) { const e = new Error('dup'); e.code = '23505'; throw e }
        st.versions.push({ file_id: p[0], version: p[1], created_at: new Date(), created_by: p[2], note: p[3], source: p[4], size: p[5], sha256: p[6], blob_id: p[7], parent_version: p[8], diff_summary: p[9] ? JSON.parse(p[9]) : null, block_ids: JSON.parse(p[10]), id_counter: p[11], page_count: p[12], starred: false })
        return rows([])
      }
      if (tag === 'getVersion') return rows(st.versions.filter((v) => v.file_id === p[0] && v.version === p[1]))
      if (tag === 'listVersions') return rows(st.versions.filter((v) => v.file_id === p[0]).sort((a, b) => b.version - a.version))
      if (tag === 'pruneList') return rows(st.versions.filter((v) => v.file_id === p[0]).sort((a, b) => a.version - b.version).map((v) => ({ version: v.version, starred: v.starred })))
      if (tag === 'pruneDelete') { st.versions = st.versions.filter((v) => !(v.file_id === p[0] && p[1].includes(v.version))); return rows([]) }
      if (tag === 'orphanBlobs') {
        const gone = st.blobs.filter((b) => b.file_id === p[0] && !st.versions.some((v) => v.blob_id === b.id))
        st.blobs = st.blobs.filter((b) => !gone.includes(b))
        return rows(gone.map((b) => ({ blob_url: b.blob_url })))
      }
      if (tag === 'star') { const v = st.versions.find((x) => x.file_id === p[0] && x.version === p[1]); if (v) v.starred = p[2]; return rows(v ? [v] : []) }
      if (tag === 'blobUrls') return rows(st.blobs.filter((b) => b.file_id === p[0] && b.blob_url).map((b) => ({ blob_url: b.blob_url })))
      if (tag === 'purgeVersions') { st.versions = st.versions.filter((v) => v.file_id !== p[0]); return rows([]) }
      if (tag === 'purgeBlobs') { st.blobs = st.blobs.filter((b) => b.file_id !== p[0]); return rows([]) }
      if (tag === 'purgeKey') { st.keys.delete(p[0]); return rows([]) }
      if (tag === 'deleteFile') { st.files = st.files.filter((f) => f.id !== p[0]); return rows([]) }
      if (t.startsWith('DELETE FROM ws_shares') || t.startsWith('DELETE FROM ws_recent')) return rows([])
      if (t.startsWith('DELETE FROM ws_files WHERE id')) { st.files = st.files.filter((f) => f.id !== p[0]); return rows([]) }
      return rows([])
    },
  }
  return db
}

let db, app
function fresh() {
  db = fakeDb()
  resetHwpSchemaForTest()
  app = createApp({ db })
}
const tpl = (n) => new Uint8Array(fs.readFileSync(path.join(TPL, n)))
const up = (u, bytes, name = 'a.hwpx', extra = {}) => {
  let r = request(app).post('/hwp/files').set('Cookie', cookie(u))
  r = r.attach('file', Buffer.from(bytes), { filename: name })
  for (const [k, v] of Object.entries(extra)) r = r.field(k, v)
  return r
}
const api = (m, u, p, body) => { let r = request(app)[m](p).set('Cookie', cookie(u)); if (body !== undefined) r = r.send(body); return r }

describe('안정 블록 id', () => {
  test('정렬: 고친 블록은 id 를 잇고 끼운 블록만 새 id', async () => {
    const { alignIds } = await import('../src/lib/hwp/ids.js')
    const mk = (a) => ({ keys: a.map((x) => x[0]), shapes: a.map((x) => x[1]) })
    const base = alignIds(null, mk([['p|a', 'p'], ['p|b', 'p'], ['t|1', 't'], ['p|c', 'p']]), 0)
    assert.deepEqual(base.ids, ['b1', 'b2', 'b3', 'b4'])
    const prev = { ...mk([['p|a', 'p'], ['p|b', 'p'], ['t|1', 't'], ['p|c', 'p']]), ids: base.ids }
    assert.deepEqual(alignIds(prev, mk([['p|a', 'p'], ['p|B', 'p'], ['t|1', 't'], ['p|c', 'p']]), 4).ids, ['b1', 'b2', 'b3', 'b4'])
    assert.deepEqual(alignIds(prev, mk([['p|a', 'p'], ['p|b', 'p'], ['p|new', 'p'], ['t|1', 't'], ['p|c', 'p']]), 4).ids, ['b1', 'b2', 'b5', 'b3', 'b4'])
    assert.deepEqual(alignIds(prev, mk([['p|a', 'p'], ['t|1', 't'], ['p|c', 'p']]), 4).ids, ['b1', 'b3', 'b4'])
  })
})

describe('글 위치 표(textmap)', () => {
  test('엔티티와 내부 태그가 든 hp:t 에서도 바뀌는 범위만 고친다', async () => {
    const { rangeSplices } = await import('../src/lib/hwp/textmap.js')
    const xml = '<hp:p><hp:run><hp:t>A&amp;B <hp:tab/>가나다</hp:t></hp:run><hp:run><hp:t>라마</hp:t></hp:run></hp:p>'
    const c1 = xml.indexOf('A&amp;'), e1 = xml.indexOf('</hp:t>')
    const c2 = xml.lastIndexOf('<hp:t>') + 6, e2 = xml.lastIndexOf('</hp:t>')
    const para = { text: 'A&B  가나다라마', tRanges: [{ contentStart: c1, contentEnd: e1 }, { contentStart: c2, contentEnd: e2 }] }
    const run = (s, e, rep) => { const sp = rangeSplices(xml, para, s, e, rep); return sp && sp.reduceRight((x, q) => x.slice(0, q.start) + q.replacement + x.slice(q.end), xml) }
    assert.equal(run(5, 8, '<가>'), '<hp:p><hp:run><hp:t>A&amp;B <hp:tab/>&lt;가&gt;</hp:t></hp:run><hp:run><hp:t>라마</hp:t></hp:run></hp:p>')
    assert.equal(run(7, 9, 'X'), '<hp:p><hp:run><hp:t>A&amp;B <hp:tab/>가나X</hp:t></hp:run><hp:run><hp:t>마</hp:t></hp:run></hp:p>')
    assert.equal(rangeSplices(xml, para, 3, 6, 'x'), null, '내부 태그가 걸치면 null')
    assert.equal(run(1, 2, 'AND'), '<hp:p><hp:run><hp:t>AANDB <hp:tab/>가나다</hp:t></hp:run><hp:run><hp:t>라마</hp:t></hp:run></hp:p>')
  })
})

describe('docIR 복사본', () => {
  test('client 의 docIR 과 같다(jszip 불러오는 줄만 다름)', () => {
    const cdir = path.join(here, '../../client/src/lib/docIR')
    for (const f of ['schema', 'docxShared', 'readDocx', 'writeDocx', 'writeHwpx', 'readHwpx', 'irToTiptap', 'tiptapToIR']) {
      const a = fs.readFileSync(path.join(cdir, `${f}.js`), 'utf8')
      const b = fs.readFileSync(path.join(here, `../src/lib/docIR/${f}.js`), 'utf8').replace("import JSZip from '../hwp/jszip.js'", "import JSZip from 'jszip'")
      assert.equal(b, a, `${f}.js`)
    }
  })
})

describe('엔진 (kordoc)', { skip }, () => {
  before(fresh)

  test('템플릿 HWPX 가져오기 → 읽기 모델·그리기', async () => {
    const { inspectUpload, firstIds } = await import('../src/lib/hwp/service.js')
    const { presentBlock } = await import('../src/lib/hwp/model.js')
    const { renderPages } = await import('../src/lib/hwp/render.js')
    const bytes = tpl('dah-report.hwpx')
    const info = await inspectUpload(bytes, 'dah-report.hwpx')
    assert.equal(info.format, 'hwpx')
    assert.ok(info.doc.blocks.length > 3)
    const { ids } = firstIds(info.doc.blocks)
    assert.equal(ids[0], 'b1')
    const tb = info.doc.blocks.findIndex((b) => b.type === 'table')
    if (tb >= 0) {
      const pb = presentBlock(info.doc.blocks[tb], ids[tb], tb, info.doc.caps?.[tb])
      assert.ok(pb.table.cells[0][0].id.startsWith(`${ids[tb]}#r0c0`))
    }
    const r = await renderPages(bytes, 'hwpx', { from: 1, to: 1, as: 'svg' }, info.doc.blocks, ids)
    assert.ok(r.page_count >= 1)
    assert.ok(r.pages[0].svg.includes('<svg'))
    assert.ok(r.pages[0].width > 100)
  })

  test('연산: 서식 보존 — 바뀐 ZIP 엔트리는 섹션 XML 뿐, validateHwpx 통과, 쪽 수 같음', async () => {
    const { inspectUpload, firstIds } = await import('../src/lib/hwp/service.js')
    const { runEdit } = await import('../src/lib/hwp/run.js')
    const { gridOf, unesc } = await import('../src/lib/hwp/model.js')
    for (const name of ['dah-report.hwpx', 'dah-plan.hwpx', 'dah-minutes.hwpx']) {
      const bytes = tpl(name)
      const info = await inspectUpload(bytes, name)
      const { ids, counter } = firstIds(info.doc.blocks)
      const pi = info.doc.blocks.findIndex((b, i) => (b.type === 'paragraph' || b.type === 'heading') && (b.text || '').length >= 4 && info.doc.caps?.[i]?.capability === 'text')
      assert.ok(pi >= 0, name)
      const text = unesc(info.doc.blocks[pi].text)
      const r = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'replace_block', block: ids[pi], text: text + ' 수정' }] })
      assert.equal(r.changed, true, name)
      assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped))
      assert.equal(r.verify.ok, true)
      assert.deepEqual(r.verify.changed_parts.filter((p) => !/^Contents\/section\d+\.xml$/.test(p)), [], '섹션 XML 외 엔트리는 그대로')
      assert.equal(r.verify.page_count_before, r.verify.page_count_after)
      assert.deepEqual(r.block_ids_added, [])
      assert.equal(r.ids.length, ids.length)
      // 삽입·삭제
      const r2 = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'insert_paragraph_after', block: ids[pi], text: '새 문단입니다.' }] })
      assert.equal(r2.changed, true, JSON.stringify(r2.skipped))
      assert.equal(r2.block_ids_added.length, 1)
      assert.equal(r2.ids.length, ids.length + 1)
      assert.equal(r2.ids[pi + 1], r2.block_ids_added[0])
      const r3 = await runEdit({ bytes: r2.bytes, format: 'hwpx', ids: r2.ids, counter: r2.counter, ops: [{ op: 'delete_block', block: r2.block_ids_added[0] }] })
      assert.equal(r3.changed, true)
      assert.deepEqual(r3.ids, ids)
      // 표 칸
      const ti = info.doc.blocks.findIndex((b, i) => b.type === 'table' && info.doc.caps?.[i]?.capability === 'cell-text')
      if (ti >= 0) {
        const g = gridOf(info.doc.blocks[ti].table)
        let target = null
        for (let rr = 0; rr < g.length && !target; rr++) for (let c = 0; c < g[rr].length; c++) if (g[rr][c].cell && (g[rr][c].cell.text || '').trim()) { target = [rr, c]; break }
        const r4 = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'replace_cell', cell: `${ids[ti]}#r${target[0]}c${target[1]}`, text: '칸 수정' }] })
        assert.equal(r4.changed, true, JSON.stringify(r4.skipped))
        assert.equal(r4.verify.ok, true)
      }
    }
  })

  test('연산: 기대 글(expect)이 다르면 STALE, 없는 id 는 NOT_FOUND, 잘못된 연산은 건너뜀', async () => {
    const { inspectUpload, firstIds } = await import('../src/lib/hwp/service.js')
    const { runEdit } = await import('../src/lib/hwp/run.js')
    const bytes = tpl('dah-report.hwpx')
    const info = await inspectUpload(bytes, 'x.hwpx')
    const { ids, counter } = firstIds(info.doc.blocks)
    const pi = info.doc.blocks.findIndex((b, i) => b.type === 'paragraph' && (b.text || '').length > 3 && info.doc.caps?.[i]?.capability === 'text')
    const r = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'replace_block', block: ids[pi], text: 'x', expect: '전혀 다른 글' }, { op: 'replace_block', block: 'b99999', text: 'x' }, { op: 'nope' }, { op: 'delete_block', block: ids[pi], expect: '아님' }] })
    assert.deepEqual(r.skipped.map((s) => s.reason), ['STALE', 'NOT_FOUND', 'UNSUPPORTED', 'STALE'])
    assert.equal(r.changed, false)
  })

  test('replace_text: 같은 글 여러 곳, 범위, 서식 런 보존', async () => {
    const { inspectUpload, firstIds } = await import('../src/lib/hwp/service.js')
    const { runEdit } = await import('../src/lib/hwp/run.js')
    const k = K
    const hwpx = await k.markdownToHwpx('# 제목\n\n동아리 모집 안내입니다. 동아리 활동은 즐겁다.\n\n| 이름 | 비고 |\n| --- | --- |\n| 동아리 대표 | 확인 |', { gongmun: { preset: '보고서' } })
    const bytes = new Uint8Array(hwpx)
    const info = await inspectUpload(bytes, 'g.hwpx')
    const { ids, counter } = firstIds(info.doc.blocks)
    const r = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'replace_text', find: '동아리', replace: '학회' }] })
    assert.equal(r.changed, true, JSON.stringify(r.skipped))
    assert.equal(r.applied[0].replaced, 3)
    const { readDoc } = await import('../src/lib/hwp/model.js')
    const d = await readDoc(r.bytes, 'hwpx')
    assert.ok(!JSON.stringify(d.raw.markdown).includes('동아리'))
    assert.ok(d.raw.markdown.includes('학회'))
    const r2 = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'replace_text', find: '동아리', replace: '학회', scope: 'tables' }] })
    assert.equal(r2.applied[0].replaced, 1)
  })

  test('fill_fields: 기안문 누름틀 채우기 + 시험 적용(dry_run)', async () => {
    const { buildFromTemplate, inspectUpload, firstIds } = await import('../src/lib/hwp/service.js')
    const { runEdit } = await import('../src/lib/hwp/run.js')
    const t = await buildFromTemplate({ template: 'gian', values: {} })
    const info = await inspectUpload(t.bytes, 'g.hwpx')
    const { ids, counter } = firstIds(info.doc.blocks)
    const r = await runEdit({ bytes: t.bytes, format: 'hwpx', ids, counter, ops: [{ op: 'fill_fields', values: { 제목: '시험 제목', 행정기관명: '디지털인문예술전공' } }] })
    assert.equal(r.changed, true, JSON.stringify(r.skipped))
    assert.equal(r.applied[0].filled, 2)
    assert.equal(r.verify.ok, true)
    const { readDoc } = await import('../src/lib/hwp/model.js')
    assert.ok((await readDoc(r.bytes, 'hwpx')).raw.markdown.includes('시험 제목'))
  })

  test('redact: 시험 적용은 마스킹된 미리보기만, 적용은 같은 길이로 가림', async () => {
    const { inspectUpload, firstIds } = await import('../src/lib/hwp/service.js')
    const { runEdit } = await import('../src/lib/hwp/run.js')
    const hwpx = await K.markdownToHwpx('# 신청서\n\n연락처 010-1234-5678 입니다.\n\n이메일 test.user@example.com')
    const bytes = new Uint8Array(hwpx)
    const info = await inspectUpload(bytes, 'r.hwpx')
    const { ids, counter } = firstIds(info.doc.blocks)
    const dry = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'redact', dry_run: true }] })
    assert.equal(dry.changed, false)
    assert.ok(dry.applied[0].hits >= 2)
    assert.ok(!JSON.stringify(dry.applied[0]).includes('1234-5678'), '원문이 보고서에 없다')
    const r = await runEdit({ bytes, format: 'hwpx', ids, counter, ops: [{ op: 'redact' }] })
    assert.equal(r.changed, true)
    const { readDoc } = await import('../src/lib/hwp/model.js')
    const md = (await readDoc(r.bytes, 'hwpx')).raw.markdown
    assert.ok(!md.includes('1234-5678') && !md.includes('test.user@example.com'))
  })

  test('악성 입력: 경로 이동, 엔트리 폭주, 압축 폭탄, XXE, 깨진 파일, 잘못된 형식', async () => {
    const { inspectUpload, LIMITS } = await import('../src/lib/hwp/service.js')
    const JSZip = (await import('../src/lib/hwp/jszip.js')).default
    const base = await JSZip.loadAsync(tpl('dah-report.hwpx'))
    const withEntry = async (name, data) => { const z = await JSZip.loadAsync(tpl('dah-report.hwpx')); z.file(name, data); return new Uint8Array(await z.generateAsync({ type: 'uint8array' })) }
    await assert.rejects(inspectUpload(await withEntry('../../evil.txt', 'x'), 'a.hwpx'), (e) => e.code === 'CORRUPTED')
    // 엔트리 수
    const many = await JSZip.loadAsync(tpl('dah-report.hwpx'))
    for (let i = 0; i < LIMITS.MAX_ENTRIES + 5; i++) many.file(`BinData/e${i}.txt`, 'a')
    await assert.rejects(inspectUpload(new Uint8Array(await many.generateAsync({ type: 'uint8array' })), 'a.hwpx'), (e) => e.code === 'ZIP_BOMB')
    // 풀린 크기 한도(한도를 잠깐 낮춰서)
    const keep = LIMITS.MAX_UNPACKED
    LIMITS.MAX_UNPACKED = 200_000
    try {
      await assert.rejects(inspectUpload(await withEntry('BinData/big.bin', Buffer.alloc(600_000, 0)), 'a.hwpx'), (e) => e.code === 'ZIP_BOMB')
    } finally { LIMITS.MAX_UNPACKED = keep }
    // XXE: 외부 엔티티가 본문으로 새지 않는다
    const sec = await base.file('Contents/section0.xml').async('string')
    const xxe = sec.replace('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>', '').replace(/^\uFEFF?/, '')
    const evil = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/hosts">]>${xxe.replace('<hp:t>', '<hp:t>&x;')}`
    const zx = await JSZip.loadAsync(tpl('dah-report.hwpx'))
    zx.file('Contents/section0.xml', evil)
    let leaked = false
    try {
      const info = await inspectUpload(new Uint8Array(await zx.generateAsync({ type: 'uint8array' })), 'x.hwpx')
      leaked = /localhost|127\.0\.0\.1/.test(JSON.stringify(info.doc.raw.markdown))
    } catch { /* 거부해도 안전 */ }
    assert.equal(leaked, false)
    // 깨진 파일, 잘못된 형식
    await assert.rejects(inspectUpload(new Uint8Array(Buffer.from('PK\x03\x04garbage-not-a-zip')), 'a.hwpx'), (e) => ['CORRUPTED', 'UNSUPPORTED_FORMAT'].includes(e.code))
    await assert.rejects(inspectUpload(new Uint8Array(Buffer.from('hello world, plain text')), 'a.txt'), (e) => e.code === 'UNSUPPORTED_FORMAT')
    await assert.rejects(inspectUpload(new Uint8Array(0), 'a.hwpx'), (e) => e.code === 'CORRUPTED')
    await assert.rejects(inspectUpload(new Uint8Array(26 * 1024 * 1024), 'a.hwpx'), (e) => e.code === 'TOO_LARGE')
  })
})

describe('API (가짜 DB)', { skip }, () => {
  before(fresh)
  let fid

  test('로그인 필요 / 지원하지 않는 형식', async () => {
    fresh()
    assert.equal((await request(app).get('/hwp/files')).status, 401)
    const bad = await up(OWNER, Buffer.from('not a doc'), 'a.txt')
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'UNSUPPORTED_FORMAT')
    const big = await up(OWNER, Buffer.alloc(4 * 1024 * 1024 + 10, 1), 'a.hwpx')
    assert.equal(big.status, 413)
    assert.equal(big.body.error.code, 'TOO_LARGE')
  })

  test('올리기 → 정보·개요·블록·쪽(영역)·암호화 저장', async () => {
    fresh()
    const r = await up(OWNER, tpl('dah-report.hwpx'), 'dah-report.hwpx', { title: '시험 보고서' })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    fid = r.body.item.id
    assert.equal(r.body.item.format, 'hwpx')
    assert.equal(r.body.item.current_version, 1)
    assert.equal(r.body.item.title, '시험 보고서')
    // 저장된 바이트는 평문이 아니다
    const blob = db.st.blobs[0].data
    assert.ok(blob && !Buffer.from(blob).subarray(28, 40).equals(Buffer.from(tpl('dah-report.hwpx')).subarray(0, 12)), '암호문')
    assert.notEqual(Buffer.from(blob).subarray(0, 2).toString(), 'PK')
    const info = await api('get', OWNER, `/hwp/files/${fid}`)
    assert.equal(info.body.item.can_edit, true)
    const ol = await api('get', OWNER, `/hwp/files/${fid}/outline`)
    assert.equal(ol.status, 200)
    assert.ok(ol.body.stats.blocks > 3)
    const bl = await api('get', OWNER, `/hwp/files/${fid}/blocks?from=0&to=5`)
    assert.equal(bl.body.blocks[0].id, 'b1')
    assert.ok(bl.body.total >= 5)
    const pg = await api('get', OWNER, `/hwp/files/${fid}/pages?from=1&to=1`)
    assert.equal(pg.status, 200)
    assert.ok(pg.body.pages[0].svg.includes('<svg'))
    assert.ok(Array.isArray(pg.body.pages[0].regions))
    const svg = await api('get', OWNER, `/hwp/files/${fid}/pages/1.svg`)
    assert.equal(svg.status, 200)
    assert.match(svg.headers['content-type'], /svg/)
    const png = await request(app).get(`/hwp/files/${fid}/pages/1.png`).set('Cookie', cookie(OWNER)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
    assert.equal(png.status, 200)
    assert.equal(png.body.subarray(1, 4).toString(), 'PNG')
  })

  test('권한: 남은 403, 보기 권한은 읽기만', async () => {
    assert.equal((await api('get', OTHER, `/hwp/files/${fid}/outline`)).status, 403)
    db.st.shares.push({ ws_id: fid, email: VIEWER.email, role: 'viewer' })
    assert.equal((await api('get', VIEWER, `/hwp/files/${fid}/outline`)).status, 200)
    const e = await api('post', VIEWER, `/hwp/files/${fid}/edit`, { ops: [{ op: 'replace_block', block: 'b1', text: 'x' }] })
    assert.equal(e.status, 403)
    assert.equal(e.body.error.code, 'FORBIDDEN')
    assert.equal((await api('post', VIEWER, `/hwp/files/${fid}/versions/1/restore`, {})).status, 403)
    db.st.shares.length = 0
    assert.equal((await api('get', OTHER, '/hwp/files/9999/outline')).status, 404)
  })

  test('고치기: 새 버전, 충돌 409, 시험 적용, 되돌리기, 별표, 신구대조, 표기법, 내보내기', async () => {
    const bl = await api('get', OWNER, `/hwp/files/${fid}/blocks?from=0&to=300`)
    const p = bl.body.blocks.find((b) => b.type === 'paragraph' && b.text && b.text.length > 3)
    const orig = p.text
    const dry = await api('post', OWNER, `/hwp/files/${fid}/edit`, { dry_run: true, ops: [{ op: 'replace_block', block: p.id, text: orig + ' (시험)' }] })
    assert.equal(dry.status, 200, JSON.stringify(dry.body))
    assert.equal(dry.body.dry_run, true)
    assert.equal(db.st.versions.length, 1, '시험 적용은 버전을 만들지 않는다')
    const e = await api('post', OWNER, `/hwp/files/${fid}/edit`, { base_version: 1, note: '고침', ops: [{ op: 'replace_block', block: p.id, text: orig + ' (수정)', expect: orig.slice(0, 3) }] })
    assert.equal(e.status, 200, JSON.stringify(e.body))
    assert.equal(e.body.version, 2)
    assert.equal(e.body.verify.ok, true)
    assert.deepEqual(e.body.blocks_changed, [p.id])
    assert.equal(db.st.files[0].content.current_version, 2)
    const stale = await api('post', OWNER, `/hwp/files/${fid}/edit`, { base_version: 1, ops: [{ op: 'replace_block', block: p.id, text: 'x' }] })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT')
    assert.equal(stale.body.error.current_version, 2)
    const none = await api('post', OWNER, `/hwp/files/${fid}/edit`, { ops: [{ op: 'replace_block', block: 'b99999', text: 'x' }] })
    assert.equal(none.status, 422)
    assert.equal(none.body.error.code, 'NO_VALID_OPS')
    assert.equal(none.body.error.skipped[0].reason, 'NOT_FOUND')
    const cur = await api('get', OWNER, `/hwp/files/${fid}/blocks?from=0&to=300`)
    assert.equal(cur.body.blocks.find((b) => b.id === p.id).text, orig + ' (수정)')
    const old = await api('get', OWNER, `/hwp/files/${fid}/blocks?from=0&to=300&version=1`)
    assert.equal(old.body.blocks.find((b) => b.id === p.id).text, orig)
    const cmp = await api('get', OWNER, `/hwp/files/${fid}/compare?from=1&to=2`)
    assert.equal(cmp.body.stats.modified, 1)
    assert.equal(cmp.body.diffs[0].block, p.id)
    assert.equal((await api('get', OWNER, `/hwp/files/${fid}/lint`)).status, 200)
    const rs = await api('post', OWNER, `/hwp/files/${fid}/versions/1/restore`, {})
    assert.equal(rs.body.version, 3)
    const after = await api('get', OWNER, `/hwp/files/${fid}/blocks?from=0&to=300`)
    assert.equal(after.body.blocks.find((b) => b.id === p.id).text, orig)
    assert.equal(db.st.blobs.length, 2, '되돌리기는 기존 바이트를 가리킨다(복사하지 않음)')
    const vs = await api('get', OWNER, `/hwp/files/${fid}/versions`)
    assert.deepEqual(vs.body.items.map((v) => v.version), [3, 2, 1])
    assert.equal(vs.body.items[0].source, 'restore')
    assert.equal(vs.body.items[1].created_by, '소유자')
    assert.equal((await api('post', OWNER, `/hwp/files/${fid}/versions/1/star`, { starred: true })).body.starred, true)
    const dl = await request(app).get(`/hwp/files/${fid}/export?format=hwpx`).set('Cookie', cookie(OWNER)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
    assert.equal(dl.status, 200)
    assert.equal(dl.body.subarray(0, 2).toString(), 'PK')
    assert.match(dl.headers['content-disposition'], /attachment/)
    const md = await api('get', OWNER, `/hwp/files/${fid}/export?format=md`)
    assert.equal(md.status, 200)
    const dx = await request(app).get(`/hwp/files/${fid}/export?format=docx`).set('Cookie', cookie(OWNER)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
    assert.equal(dx.status, 200)
    assert.equal(dx.body.subarray(0, 2).toString(), 'PK')
    assert.equal((await api('get', OWNER, `/hwp/files/${fid}/export?format=pdf`)).status, 501)
  })

  test('버전은 50개까지: 별표·현재 버전은 지키고 오래된 것부터 정리', async () => {
    fresh()
    const r = await up(OWNER, tpl('dah-report.hwpx'))
    const id = r.body.item.id
    await api('post', OWNER, `/hwp/files/${id}/versions/1/star`, { starred: true })
    // v1 ↔ 새 버전을 왔다 갔다 하며 버전만 늘린다
    const bl = await api('get', OWNER, `/hwp/files/${id}/blocks?from=0&to=300`)
    const p = bl.body.blocks.find((b) => b.type === 'paragraph' && b.text && b.text.length > 3)
    const e = await api('post', OWNER, `/hwp/files/${id}/edit`, { ops: [{ op: 'replace_block', block: p.id, text: p.text + ' 2' }] })
    assert.equal(e.body.version, 2)
    for (let i = 0; i < 55; i++) {
      const cur = (await api('get', OWNER, `/hwp/files/${id}`)).body.item.current_version
      const rr = await api('post', OWNER, `/hwp/files/${id}/versions/${cur === 1 ? 2 : 1}/restore`, {})
      assert.equal(rr.status, 200, JSON.stringify(rr.body))
    }
    const vs = await api('get', OWNER, `/hwp/files/${id}/versions`)
    assert.equal(vs.body.items.length, 50)
    assert.ok(vs.body.items.some((v) => v.version === 1 && v.starred), '별표 버전 보존')
    assert.equal(vs.body.items[0].version, vs.body.current)
    assert.ok(!vs.body.items.some((v) => v.version === 2), '별표 없는 가장 오래된 것은 정리됨')
    assert.equal(db.st.blobs.length, 1, '쓰이지 않는 바이트(v2)는 정리되고 쓰이는 것만 남는다')
  })

  test('영구 삭제 훅: 버전·바이트·키가 지워진다', async () => {
    fresh()
    const r = await up(OWNER, tpl('dah-plan.hwpx'))
    const id = r.body.item.id
    await api('post', OWNER, `/hwp/files/${id}/edit`, { ops: [{ op: 'replace_text', find: '계획', replace: '플랜' }] })
    assert.ok(db.st.versions.length >= 1 && db.st.blobs.length >= 1 && db.st.keys.size === 1)
    await purgeFile({ id, kind: 'hwp' })
    assert.equal(db.st.versions.length, 0)
    assert.equal(db.st.blobs.length, 0)
    assert.equal(db.st.keys.size, 0)
  })

  test('8MB 넘는 암호문은 Blob 어댑터로, 삭제 때 함께 지움', async () => {
    fresh()
    const store = new Map()
    const dels = []
    setBlobAdapter({ put: async (p, body) => { const u = `https://x.public.blob.vercel-storage.com/${p}`; store.set(u, Buffer.from(body)); return u }, get: async (u) => store.get(u), del: async (u) => { dels.push(u); store.delete(u) } })
    try {
      const { addVersion, readVersionBytes, purgeHwpFile, createFileRow } = await import('../src/lib/hwp/store.js')
      const f = await createFileRow({ title: 't', ownerEmail: OWNER.email, createdBy: '소유자', shareToken: 'x', team: null, content: { format: 'hwpx', current_version: 1 } })
      const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251)
      const v = await addVersion(f.id, { bytes: big, createdBy: 'a', blockIds: [], counter: 0 })
      assert.equal(db.st.blobs[0].data, null)
      assert.ok(db.st.blobs[0].blob_url)
      assert.notDeepEqual(Buffer.from(store.get(db.st.blobs[0].blob_url)).subarray(28, 60), Buffer.from(big.subarray(0, 32)), 'Blob 에는 암호문만')
      const back = await readVersionBytes(f.id, v.version)
      assert.equal(Buffer.compare(Buffer.from(back.bytes), Buffer.from(big)), 0)
      await purgeHwpFile(f.id)
      assert.equal(dels.length, 1)
    } finally { setBlobAdapter(null) }
  })

  test('만들기: 기안문 템플릿·마크다운, 워드 변환, 템플릿 목록', async () => {
    fresh()
    const t = await api('get', OWNER, '/hwp/templates')
    assert.equal(t.status, 200)
    assert.ok(t.body.items.find((x) => x.id === 'gian').fields.length >= 20)
    const g = await api('post', OWNER, '/hwp/files/create', { template: 'gian-simple', values: { 제목: '내부결재' }, title: '기안' })
    assert.equal(g.status, 201, JSON.stringify(g.body))
    const m = await api('post', OWNER, '/hwp/files/create', { template: 'markdown', preset: '보고서', markdown: '# 제목\n\n본문입니다.' })
    assert.equal(m.status, 201, JSON.stringify(m.body))
    assert.equal((await api('post', OWNER, '/hwp/files/create', { template: 'nope' })).status, 400)
    const { writeDocx } = await import('../src/lib/docIR/writeDocx.js')
    const docx = await writeDocx({ version: 1, meta: { title: 't' }, page: { size: 'A4', orientation: 'portrait', marginMm: { top: 20, right: 20, bottom: 20, left: 20 } }, defaults: { font: { ko: '맑은 고딕', latin: 'Calibri' }, sizePt: 10, lineSpacing: { mode: 'percent', value: 160 } }, body: [{ t: 'p', runs: [{ text: '워드에서 온 문단입니다.' }] }], assets: {} })
    const w = await up(OWNER, docx, 'x.docx')
    assert.equal(w.status, 201, JSON.stringify(w.body))
    assert.equal(w.body.converted_from, 'docx')
    assert.equal(w.body.item.format, 'hwpx')
    const list = await api('get', OWNER, '/hwp/files')
    assert.equal(list.status, 200)
    assert.equal(list.body.items.length, 3)
  })

  test('MCP 도구 묶음', async () => {
    const { hwpServerTools } = await import('../src/lib/hwp/tools.js')
    const tools = hwpServerTools()
    const names = tools.map((t) => t.name)
    for (const n of ['read_outline', 'read_blocks', 'edit', 'lint', 'compare', 'restore_version']) assert.ok(names.includes(n), n)
    for (const t of tools) { assert.equal(typeof t.run, 'function'); assert.ok(t.description.length > 20) }
    assert.equal(tools.find((t) => t.name === 'edit').readOnly, undefined)
    const { registerHwpTools } = await import('../src/lib/hwp/tools.js')
    const m = await import('../src/lib/mcpTools.js')
    assert.equal(await registerHwpTools(), true)
    assert.ok(m.registeredFileKinds().includes('hwp'))
    assert.deepEqual(m.toolDef('hwp_edit').inputSchema.required, ['file_id', 'ops'])
    assert.equal(m.toolDef('hwp_read_outline').readOnly, true)
  })
})

// ── 개인 파일(선택): 서식 보존 수치 ──
const FIX = process.env.HWP_FIXTURES
describe('실제 한컴 저장본 (HWP_FIXTURES)', { skip: !FIX || !fs.existsSync(FIX || '') ? 'HWP_FIXTURES 폴더 없음' : skip }, () => {
  test('편집 연산이 서식을 보존한다(읽기 전용 복사본, 내용 출력 없음)', async () => {
    const { runEdit } = await import('../src/lib/hwp/run.js')
    const { readDoc, unesc } = await import('../src/lib/hwp/model.js')
    const { firstIds } = await import('../src/lib/hwp/service.js')
    const crypto = await import('node:crypto')
    const seen = new Set()
    let n = 0, bad = 0
    for (const f of fs.readdirSync(FIX).filter((x) => /\.hwpx$/i.test(x))) {
      const b = new Uint8Array(fs.readFileSync(path.join(FIX, f)))
      const h = crypto.createHash('sha1').update(b).digest('hex')
      if (seen.has(h) || b.length > 3_000_000) continue
      seen.add(h)
      if (n >= 12) break
      let doc
      try { doc = await readDoc(b, 'hwpx') } catch { continue }
      const { ids, counter } = firstIds(doc.blocks)
      const pi = doc.blocks.findIndex((x, i) => x.type === 'paragraph' && unesc(x.text).length >= 6 && doc.caps?.[i]?.capability !== 'locked')
      if (pi < 0) continue
      n++
      const r = await runEdit({ bytes: b, format: 'hwpx', ids, counter, ops: [{ op: 'replace_block', block: ids[pi], text: unesc(doc.blocks[pi].text) + ' (수정)' }] })
      if (!r.changed || !r.verify.ok || r.verify.changed_parts.some((p) => !/^Contents\/section\d+\.xml$/.test(p))) bad++
    }
    assert.ok(n > 0)
    assert.equal(bad, 0)
  })
})
