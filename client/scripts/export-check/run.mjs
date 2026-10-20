#!/usr/bin/env node
// docIR 내보내기 검증 도구.
//   node run.mjs [fixture ...|--all] [--out 폴더] [--corpus 폴더] [--no-hwpx-render]
// 흐름: IR -> writeDocx/writeHwpx -> 구조 검사 -> readX 왕복 -> 렌더 -> 쪽·표 위치 비교 -> report.json/html
// DOCX 렌더는 Aside 브라우저(repl)에서만 가능하다: 1회차 실행이 <out>/jobs.json 을 쓰면
// browser-render.js 드라이버를 돌린 뒤 같은 명령을 다시 실행한다(렌더 결과를 읽어 비교).
// 빠진 작성기·읽기기·도구가 있어도 멈추지 않고 SKIP 으로 표시한다.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepForCompare, checkDocx, checkHwpx, svgPageGeometry, normDocxGeom, normSvgGeom, compareGeom, compareSummaries, readZip, parseXml, findAll, kidsOf, firstKid, local } from './lib.mjs'
import { renderReportHtml } from './report.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const docIR = path.resolve(here, '../../src/lib/docIR')

// ---------------------------------------------------------------- 도우미
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)
const nfc = (s) => s.normalize('NFC')
// 날짜 같은 매번 바뀌는 메타를 뺀 내용 해시: DOCX 는 word/ 아래, HWPX 는 Contents/ 아래(content.hpf 제외)
export function contentSha(bytes) {
  try {
    const z = readZip(bytes)
    const h = crypto.createHash('sha1')
    for (const n of z.names.filter((x) => (/^word\//.test(x) || /^Contents\//.test(x) || /^BinData\//.test(x)) && !/content\.hpf$/.test(x) && !x.endsWith('/')).sort()) { h.update(n); h.update(z.read(n)) }
    return h.digest('hex').slice(0, 16)
  } catch { return sha(bytes) }
}
export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 110000, cwd: opts.cwd })
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error }
}
async function tryImport(name) {
  const p = path.join(docIR, name)
  if (!fs.existsSync(p)) return null
  try { return await import(pathToFileURL(p).href + '?t=' + Date.now()) } catch (e) { return { __error: e.message } }
}
function writeIfChanged(file, bytes) {
  const b = Buffer.from(bytes)
  if (fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), b) === 0) return false // 같으면 mtime 을 유지(렌더 캐시 보존)
  fs.writeFileSync(file, b)
  return true
}
// 렌더 방식(render.html, browser-render.js)을 바꾸면 올린다: 캐시된 렌더 결과를 무효로 만든다
const RENDER_VERSION = 'r3'
const FIXED_NOW = Date.parse('2026-10-12T00:00:00Z') // 같은 입력이면 같은 DOCX 가 나오도록
const ok = (note, details) => ({ status: 'pass', note, details })
const bad = (note, details) => ({ status: 'fail', note, details })
const warn = (note, details) => ({ status: 'warn', note, details })
const skip = (note) => ({ status: 'skip', note })

export function parseArgs(argv) {
  const a = { names: [], all: false, out: path.join(here, '.out'), corpus: null, hwpxRender: true }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--all') a.all = true
    else if (t === '--out') a.out = path.resolve(argv[++i])
    else if (t === '--corpus') a.corpus = path.resolve(argv[++i])
    else if (t === '--no-hwpx-render') a.hwpxRender = false
    else if (!t.startsWith('--')) a.names.push(t)
  }
  return a
}

// DOCX 최상위 표별 제목 행 수(docx-preview 는 tblHeader 를 몰라 쪽 나눔 어림에 필요)
export function docxBreakBefore(bytes) {
  try {
    const z = readZip(bytes)
    const doc = parseXml(z.text('word/document.xml'))
    const body = firstKid(doc, 'body')
    const out = []
    body.kids.filter((k) => ['p', 'tbl'].includes(local(k.name))).forEach((k, i) => {
      if (local(k.name) !== 'p') return
      const pPr = firstKid(k, 'pPr')
      if (pPr && firstKid(pPr, 'pageBreakBefore')) out.push(i)
    })
    return out
  } catch { return [] }
}
export function docxHeaderRows(bytes) {
  try {
    const z = readZip(bytes)
    const doc = parseXml(z.text('word/document.xml'))
    const body = firstKid(doc, 'body')
    return kidsOf(body, 'tbl').map((t) => {
      let n = 0
      for (const tr of kidsOf(t, 'tr')) { const pr = firstKid(tr, 'trPr'); if (pr && firstKid(pr, 'tblHeader')) n++; else break }
      return n
    })
  } catch { return [] }
}

// ---------------------------------------------------------------- 변형 하나(원본, DOCX 산출, HWPX 산출) 처리
function renderHwpx(file, dir, enabled) {
  const out = { pages: [], geom: null, note: null }
  if (!enabled) { out.note = '--no-hwpx-render'; return out }
  const pdir = path.join(dir, 'hwpx-pages')
  const hashFile = path.join(pdir, '.hash')
  const h = contentSha(fs.readFileSync(file))
  const cached = fs.existsSync(hashFile) && fs.readFileSync(hashFile, 'utf8') === h && fs.readdirSync(pdir).some((f) => f.endsWith('.svg'))
  if (!cached) {
    fs.rmSync(pdir, { recursive: true, force: true }); fs.mkdirSync(pdir, { recursive: true })
    const r = sh('npx', ['-y', 'kordoc@^4', 'render', file, '--format', 'svg', '-d', pdir, '--silent'])
    if (r.status !== 0) { out.note = `kordoc render 실패: ${(r.stderr || r.stdout).trim().slice(0, 200)}`; return out }
    fs.writeFileSync(hashFile, h)
  }
  const svgs = fs.readdirSync(pdir).filter((f) => f.endsWith('.svg')).sort()
  if (!svgs.length) { out.note = '렌더 결과 쪽이 0개'; return out }
  try {
    out.geom = normSvgGeom(svgs.map((f) => svgPageGeometry(fs.readFileSync(path.join(pdir, f), 'utf8'))))
  } catch (e) { out.note = 'SVG 해석 실패: ' + e.message.slice(0, 120) }
  out.pages = svgs.map((f) => path.join('hwpx-pages', f))
  return out
}

function readDocxGeom(file, dir) {
  const gp = path.join(dir, 'docx-geom.json')
  if (!fs.existsSync(gp)) return { status: 'pending' }
  const g = JSON.parse(fs.readFileSync(gp, 'utf8'))
  if (g.sourceSha !== contentSha(fs.readFileSync(file)) + RENDER_VERSION) return { status: 'pending' } // 파일 내용이 바뀌었으면 다시 렌더
  if (g.error) return { status: 'error', note: g.error }
  return { status: 'ok', raw: g, geom: normDocxGeom(g), pages: (g.files || []).map((f) => f) }
}

function structDocx(bytes, file) {
  const s = checkDocx(bytes)
  const py = sh('python3', [path.join(here, 'docx_probe.py'), file])
  let probe = null
  try { probe = JSON.parse(py.stdout.trim().split('\n').pop()) } catch { probe = { opened: false, error: py.stderr.slice(0, 200) || '출력 해석 실패' } }
  return { struct: s, probe }
}

function kordocValidate(file) {
  const r = sh('npx', ['-y', 'kordoc@^4', 'validate', file])
  return { status: r.status, out: (r.stdout + r.stderr).replace(file, path.basename(file)).replace(/\s+/g, ' ').trim().slice(0, 300) }
}

// ---------------------------------------------------------------- 문서 한 건 처리
async function processItem({ id, label, dir, irBuilder, origFile, mods, opts }) {
  fs.mkdirSync(dir, { recursive: true })
  const item = { id, label, checks: {}, variants: {}, comparisons: [], info: {} }
  const C = item.checks
  const { schema, writeDocx, writeHwpx, readDocx, readHwpx } = mods
  let ir = null
  let origBytes = null
  const origExt = origFile ? path.extname(origFile).toLowerCase() : null

  // 원본(말뭉치)
  if (origFile) {
    const copy = path.join(dir, 'orig' + origExt)
    writeIfChanged(copy, fs.readFileSync(origFile))
    origBytes = fs.readFileSync(copy)
    const v = { file: path.relative(opts.out, copy), kind: 'orig', ext: origExt, size: origBytes.length }
    item.variants.orig = v
    if (origExt === '.docx') {
      const sd = structDocx(origBytes, copy)
      v.struct = { ok: sd.struct.ok, errors: sd.struct.errors.slice(0, 10), warnings: sd.struct.warnings.slice(0, 10), info: sd.struct.info }
      v.probe = sd.probe
      v.headerRows = docxHeaderRows(origBytes)
      // 워드가 마지막으로 저장할 때 센 쪽 수(app.xml)와 쪽 경계 표식: 렌더 어림을 견줄 기준값
      try {
        const z = readZip(origBytes)
        const m = /<Pages>(\d+)<\/Pages>/.exec(z.has('docProps/app.xml') ? z.text('docProps/app.xml') : '')
        v.wordPages = m ? +m[1] : null
        v.lastRenderedBreaks = (z.text('word/document.xml').match(/<w:lastRenderedPageBreak/g) || []).length
      } catch { /* 없으면 생략 */ }
    } else if (origExt === '.hwpx') {
      const sh1 = checkHwpx(origBytes)
      v.struct = { ok: sh1.ok, errors: sh1.errors.slice(0, 10), warnings: sh1.warnings.slice(0, 10), info: sh1.info }
      v.kordocValidate = kordocValidate(copy)
    }
    // 원본을 IR 로
    const reader = origExt === '.docx' ? readDocx : origExt === '.hwpx' ? readHwpx : null
    if (!reader) item.info.readNote = origExt === '.hwp' ? '바이너리 .hwp 는 readDocx/readHwpx 로 못 읽음(지원 대상 아님)' : '읽기기 없음'
    else if (reader.__error || !(origExt === '.docx' ? readDocx?.readDocx : readHwpx?.readHwpx)) item.info.readNote = '읽기기 모듈이 없음(작성 중)'
    else {
      try {
        const t0 = Date.now()
        ir = await (origExt === '.docx' ? readDocx.readDocx : readHwpx.readHwpx)(new Uint8Array(origBytes), {})
        item.info.readMs = Date.now() - t0
      } catch (e) { item.info.readNote = `${origExt} 읽기 실패: ${e.message.slice(0, 200)}`; item.info.readStack = String(e.stack || '').split('\n').slice(0, 4).join(' | ') }
    }
    if (origExt === '.hwp') {
      v.render = renderHwpx(copy, path.join(dir, 'orig-render'), opts.hwpxRender)
    }
    C['read.orig'] = ir ? ok('원본을 IR 로 읽음') : (item.info.readNote ? (/없음|지원/.test(item.info.readNote) ? skip(item.info.readNote) : bad(item.info.readNote)) : skip('읽지 않음'))
  } else {
    ir = irBuilder()
  }
  if (!ir) { item.checks['write.docx'] = skip('IR 없음'); item.checks['write.hwpx'] = skip('IR 없음') }

  // IR 정합
  let nir = null
  if (ir) {
    const n = schema.normalizeIR(ir)
    nir = n.ir
    item.info.normalizeIssues = n.issues
    item.info.summary = (() => { const s = schema.summarize(nir); return { page: s.page, paragraphs: s.paragraphs.length, tables: s.tables.length, figures: s.figures, tableDims: s.tables.map((t) => `${t.rows}x${t.cols}`) } })()
    C['ir.normalize'] = n.issues.length ? warn(`normalizeIR 문제 ${n.issues.length}건`, n.issues.map((i) => `${i.path}: ${i.msg}`)) : ok('문제 0건')
  }

  // 쓰기
  const outs = {}
  for (const [fmt, mod, fn, ext] of [['docx', writeDocx, 'writeDocx', '.docx'], ['hwpx', writeHwpx, 'writeHwpx', '.hwpx']]) {
    if (!ir) continue
    const key = `write.${fmt}`
    if (!mod || mod.__error || !mod[fn]) { C[key] = skip(mod?.__error ? `모듈 불러오기 실패: ${mod.__error.slice(0, 120)}` : '작성기 없음(작성 중)'); continue }
    try {
      const t0 = Date.now()
      const bytes = await mod[fn](ir, { now: FIXED_NOW })
      const file = path.join(dir, `${id}${ext}`)
      writeIfChanged(file, bytes)
      outs[fmt] = { file, bytes: Buffer.from(bytes), ms: Date.now() - t0 }
      C[key] = ok(`${bytes.length} bytes, ${Date.now() - t0}ms`)
    } catch (e) { C[key] = bad('쓰기 중 예외: ' + e.message.slice(0, 200), [String(e.stack || '').split('\n').slice(0, 5).join(' | ')]) }
  }

  // 구조 검사
  if (outs.docx) {
    const sd = structDocx(outs.docx.bytes, outs.docx.file)
    const s = sd.struct
    C['struct.docx'] = s.errors.length ? bad(`오류 ${s.errors.length}, 경고 ${s.warnings.length}`, [...s.errors.map((e) => `오류 ${e.path}: ${e.msg}`), ...s.warnings.map((e) => `경고 ${e.path}: ${e.msg}`)]) : s.warnings.length ? warn(`오류 0, 경고 ${s.warnings.length}`, s.warnings.map((e) => `${e.path}: ${e.msg}`)) : ok('오류 0, 경고 0')
    C['tool.pythonDocx'] = sd.probe.opened ? ok(`열림. 표 ${sd.probe.tables.length}, 구역 ${sd.probe.sections.length}`, [JSON.stringify(sd.probe)]) : bad('열리지 않음: ' + sd.probe.error)
    item.info.docxStruct = s.info
    item.info.docxProbe = sd.probe
  } else { C['struct.docx'] = skip('DOCX 없음'); C['tool.pythonDocx'] = skip('DOCX 없음') }
  if (outs.hwpx) {
    const s = checkHwpx(outs.hwpx.bytes)
    C['struct.hwpx'] = s.errors.length ? bad(`오류 ${s.errors.length}, 경고 ${s.warnings.length}`, [...s.errors.map((e) => `오류 ${e.path}: ${e.msg}`), ...s.warnings.map((e) => `경고 ${e.path}: ${e.msg}`)]) : s.warnings.length ? warn(`오류 0, 경고 ${s.warnings.length}`, s.warnings.map((e) => `${e.path}: ${e.msg}`)) : ok('오류 0, 경고 0')
    item.info.hwpxStruct = s.info
    const kv = kordocValidate(outs.hwpx.file)
    C['tool.kordocValidate'] = kv.status === 0 ? ok(kv.out) : bad(kv.out)
  } else { C['struct.hwpx'] = skip('HWPX 없음'); C['tool.kordocValidate'] = skip('HWPX 없음') }

  // 왕복
  if (nir) {
    const pa = prepForCompare(nir)
    const a = { ...schema.summarize(pa.ir), images: pa.images }
    for (const [fmt, rmod, fn] of [['docx', readDocx, 'readDocx'], ['hwpx', readHwpx, 'readHwpx']]) {
      const key = `roundtrip.${fmt}`
      if (!outs[fmt]) { C[key] = skip('파일 없음'); continue }
      if (!rmod || rmod.__error || !rmod[fn]) { C[key] = skip(rmod?.__error ? `모듈 불러오기 실패: ${rmod.__error.slice(0, 120)}` : '읽기기 없음(작성 중)'); continue }
      try {
        const back = await rmod[fn](new Uint8Array(outs[fmt].bytes), {})
        const pb = prepForCompare(schema.normalizeIR(back).ir)
        const b = { ...schema.summarize(pb.ir), images: pb.images }
        const cmp = compareSummaries(a, b)
        item.info[`roundtrip_${fmt}`] = { tables: [a.tables.length, b.tables.length], paragraphs: [a.paragraphs.length, b.paragraphs.length] }
        C[key] = cmp.pass ? ok('요약 일치(표 격자, 병합, 폭 ±0.5pt, 글, 쪽)') : bad(`${cmp.issues.length}건 다름`, cmp.issues.map((i) => `${i.path}: ${i.msg}`))
      } catch (e) { C[key] = bad('읽기 중 예외: ' + e.message.slice(0, 200), [String(e.stack || '').split('\n').slice(0, 4).join(' | ')]) }
    }
  }

  // 렌더
  const jobs = []
  const geoms = {}
  if (item.variants.orig) {
    const v = item.variants.orig
    if (origExt === '.hwpx' || origExt === '.hwp') {
      const r = origExt === '.hwpx' ? renderHwpx(path.join(dir, 'orig.hwpx'), path.join(dir, 'orig-render'), opts.hwpxRender) : v.render
      v.pages = r.pages.map((p) => path.join(path.relative(opts.out, path.join(dir, 'orig-render')), p)); v.pageCount = r.geom?.pageCount; v.renderNote = r.note
      geoms.orig = r.geom
    } else if (origExt === '.docx') {
      const odir = path.join(dir, 'orig-render')
      const r = readDocxGeom(path.join(dir, 'orig.docx'), odir)
      if (r.status === 'pending') { jobs.push({ id: `${id}/orig`, sha: contentSha(origBytes) + RENDER_VERSION, docx: path.join(dir, 'orig.docx'), outDir: odir, headerRows: v.headerRows, breakBefore: docxBreakBefore(origBytes) }); v.renderNote = '렌더 대기(브라우저 드라이버 실행 필요)' }
      else if (r.status === 'error') v.renderNote = '렌더 오류: ' + r.note
      else { geoms.orig = r.geom; v.pages = r.pages.map((p) => path.relative(opts.out, path.join(odir, p))); v.pageCount = r.geom.pageCount; v.pageCountNote = '어림' }
    }
  }
  if (outs.docx) {
    const ddir = path.join(dir, 'docx-render')
    const r = readDocxGeom(outs.docx.file, ddir)
    const v = (item.variants.docx = { file: path.relative(opts.out, outs.docx.file), kind: 'docx' })
    if (r.status === 'pending') { jobs.push({ id: `${id}/docx`, sha: contentSha(outs.docx.bytes) + RENDER_VERSION, docx: outs.docx.file, outDir: ddir, headerRows: docxHeaderRows(outs.docx.bytes), breakBefore: docxBreakBefore(outs.docx.bytes) }); v.renderNote = '렌더 대기(브라우저 드라이버 실행 필요)'; C['render.docx'] = { status: 'pending', note: '브라우저 드라이버 실행 필요' } }
    else if (r.status === 'error') { v.renderNote = '렌더 오류: ' + r.note; C['render.docx'] = bad(r.note) }
    else { geoms.docx = r.geom; v.pages = r.pages.map((p) => path.relative(opts.out, path.join(ddir, p))); v.pageCount = r.geom.pageCount; v.pageCountNote = '어림'; v.fonts = r.raw.fonts; C['render.docx'] = ok(`${r.geom.pageCount}쪽(어림), 표 ${r.geom.tables.length}`) }
  } else C['render.docx'] = skip('DOCX 없음')
  if (outs.hwpx) {
    const r = renderHwpx(outs.hwpx.file, path.join(dir, 'hwpx-render'), opts.hwpxRender)
    const v = (item.variants.hwpx = { file: path.relative(opts.out, outs.hwpx.file), kind: 'hwpx' })
    if (r.geom) {
      geoms.hwpx = r.geom
      v.pages = r.pages.map((p) => path.relative(opts.out, path.join(dir, 'hwpx-render', p))); v.pageCount = r.geom.pageCount
      C['render.hwpx'] = ok(`${r.geom.pageCount}쪽, 표 ${r.geom.tables.length}`)
    } else { v.renderNote = r.note; C['render.hwpx'] = r.note === '--no-hwpx-render' ? skip(r.note) : bad(r.note || '렌더 실패') }
  } else C['render.hwpx'] = skip('HWPX 없음')

  // 비교
  const pairs = []
  if (geoms.docx && geoms.hwpx) pairs.push(['DOCX 렌더 vs HWPX 렌더', geoms.docx, geoms.hwpx])
  // 같은 렌더러끼리(원본 docx 와 DOCX 산출은 docx-preview, 원본 hwpx 와 HWPX 산출은 kordoc)만 믿을 만하다. 나머지는 참고용
  if (geoms.orig && geoms.docx) pairs.push([`원본 렌더 vs DOCX 산출 렌더${origExt === '.docx' ? ' [같은 렌더러]' : ' [다른 렌더러, 참고]'}`, geoms.orig, geoms.docx, origExt === '.docx'])
  if (geoms.orig && geoms.hwpx) pairs.push([`원본 렌더 vs HWPX 산출 렌더${origExt !== '.docx' ? ' [같은 렌더러]' : ' [다른 렌더러, 참고]'}`, geoms.orig, geoms.hwpx, origExt !== '.docx'])
  for (const [name, a, b, same] of pairs) item.comparisons.push({ name, sameRenderer: same === true, ...compareGeom(a, b) })
  const main = item.comparisons.find((c) => c.name.startsWith('DOCX 렌더 vs')) || item.comparisons[0]
  if (main) {
    C['cross.pages'] = main.pageCount[0] === main.pageCount[1] ? ok(`쪽 수 ${main.pageCount[0]}`) : bad(`쪽 수 ${main.pageCount.join(' vs ')}`)
    C['cross.tables'] = main.pass || (main.pageCount[0] !== main.pageCount[1] && !main.tables.some((t) => t.flags.length)) ? ok(`표 ${main.tableCount.join('/')}개 허용 오차 이내`) : bad(main.issues.join('; '), main.tables.filter((t) => t.flags.length).map((t) => `표 ${t.index}: ${t.flags.join(', ')} dx0=${t.dx0} dx1=${t.dx1} dy0=${t.dy0} 높이차=${t.heightDiffPct}%`))
  } else { C['cross.pages'] = skip('양쪽 렌더가 있어야 비교'); C['cross.tables'] = skip('양쪽 렌더가 있어야 비교') }
  item.jobs = jobs
  return item
}

// ---------------------------------------------------------------- 진입점
export async function run(args) {
  const out = args.out
  fs.mkdirSync(out, { recursive: true })
  const schema = await import(pathToFileURL(path.join(docIR, 'schema.js')).href)
  const { loadFixture, listFixtures } = await import(pathToFileURL(path.join(docIR, 'fixtures/load.js')).href)
  const mods = { schema, writeDocx: await tryImport('writeDocx.js'), writeHwpx: await tryImport('writeHwpx.js'), readDocx: await tryImport('readDocx.js'), readHwpx: await tryImport('readHwpx.js') }
  const items = []
  const opts = { out, hwpxRender: args.hwpxRender }
  if (args.corpus) {
    const labels = fs.existsSync(path.join(args.corpus, 'labels.json')) ? JSON.parse(fs.readFileSync(path.join(args.corpus, 'labels.json'), 'utf8')) : {}
    const files = fs.readdirSync(args.corpus).filter((f) => /\.(docx|hwpx|hwp)$/i.test(f)).sort()
    for (const f of files) {
      const id = f.replace(/\.[^.]+$/, '')
      console.log('말뭉치', f)
      items.push(await processItem({ id: 'corpus-' + id, label: labels[f] || '', dir: path.join(out, 'corpus', id), origFile: path.join(args.corpus, f), mods, opts }))
    }
  } else {
    const names = args.all || !args.names.length ? listFixtures() : args.names
    for (const name of names) {
      console.log('시험 문서', name)
      items.push(await processItem({ id: name, label: loadFixture(name).meta.title, dir: path.join(out, name), irBuilder: () => loadFixture(name), mods, opts }))
    }
  }
  const jobs = items.flatMap((i) => i.jobs)
  const jobsFile = path.join(out, args.corpus ? 'jobs-corpus.json' : 'jobs.json')
  fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 1))
  for (const it of items) delete it.jobs
  const tools = { node: process.version, kordoc: 'npx -y kordoc@^4', writeDocx: !!mods.writeDocx && !mods.writeDocx.__error, writeHwpx: !!mods.writeHwpx && !mods.writeHwpx.__error, readDocx: !!mods.readDocx && !mods.readDocx.__error, readHwpx: !!mods.readHwpx && !mods.readHwpx.__error }
  const report = { generatedAt: new Date().toISOString(), tools, items, pendingDocxRenders: jobs.length, jobsFile }
  const rname = args.corpus ? 'report-corpus' : 'report'
  fs.writeFileSync(path.join(out, rname + '.json'), JSON.stringify(report, null, 1))
  fs.writeFileSync(path.join(out, rname + '.html'), renderReportHtml(report))
  return { report, jobsFile }
}

if (process.argv[1] && nfc(path.resolve(process.argv[1])) === nfc(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2))
  const { report, jobsFile } = await run(args)
  const sym = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP', pending: 'WAIT' }
  for (const it of report.items) {
    console.log(`\n== ${it.id} ${it.label ? '(' + it.label + ')' : ''}`)
    for (const [k, c] of Object.entries(it.checks)) console.log(`  ${sym[c.status] || c.status}  ${k.padEnd(22)} ${c.note || ''}`)
    for (const c of it.comparisons) console.log(`  -- ${c.name}: 쪽 ${c.pageCount.join(' vs ')}, 표 ${c.tableCount.join(' vs ')}${c.issues.length ? ' / ' + c.issues.join('; ') : ''}`)
  }
  if (report.pendingDocxRenders) console.log(`\nDOCX 렌더 대기 ${report.pendingDocxRenders}건: ${jobsFile}\n  repl 에서 browser-render.js 드라이버를 돌린 뒤 같은 명령을 다시 실행하세요.`)
  console.log(`\n보고서: ${path.join(args.out, args.corpus ? 'report-corpus.html' : 'report.html')}`)
}
