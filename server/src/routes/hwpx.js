// 한글(HWPX) API. kordoc(MIT, https://github.com/chrisryugj/kordoc) 공문서 엔진으로 HWPX 를 만들고, 미리보기 SVG 를 그리고,
// HWP/HWPX/DOCX/PDF 를 읽어 마크다운으로 돌려주고, 공문서 표기법을 검사한다. 모든 경로는 로그인한 사용자만 쓴다(401).
//
// ── 계약(다른 편집기 Board, Slides 도 이 주소로 "한글로 내보내기" 를 한다) ─────────────────────────────
// POST /api/hwpx/generate   JSON (전체 2MB 이하, express.json 상한)
//   {
//     title:    string            파일 이름(확장자 없이). 기본 '문서'
//     preset:   string            양식. 기안문 | 보고서 | 계획서 | 통지 | 알림 | 회의록 | 보도자료 | 업무보고 | 개조식 | 방침서 (기본 보고서)
//     markdown: string            본문(500KB 이하). '# 제목', '## 장', '### 절(□)', '- ' 목록(들여쓰기 두 칸 = 한 단계),
//                                 GFM 파이프 표, '> 요약(보고서 요약 상자)', '![설명](이미지이름)'.
//                                 기안문·통지 계열은 '- ' 목록이 1. 가. 1) 가) 항목 부호가 된다.
//     options?: {                 kordoc 공문 옵션 가운데 허용한 키만 받는다
//       docHead?: { org, to, via, title }        기안문 두문(행정기관명, 수신, 경유, 제목)
//       docFoot?: { sender, drafter, reviewer, approver, approvers[], cooperator, recipients, docNum, receive,
//                   zip, address, site, phone, fax, email, disclosure }   기안문 결문
//       approval?: string[]       결재란 직위
//       noticeHead?, press?, bodyFont?('myeongjo'|'gothic'), bodyPt?, lineSpacing?, numbering?, cover?, toc?,
//       summary?, pageNumbers?, endMark?, bullet2?, levels?
//     },
//     spans?: { [n]: { b,i,u,s, pt, color:'#RRGGBB', bg:'#RRGGBB', font:한글글꼴, ratio:50~200, spacing:-50~50 } }
//     paras?: { [n]: { align:'left'|'center'|'right'|'justify', lh:80~400, pageBreak:1 } }
//                                 본문에 ⟪sN⟫글⟪/⟫(글자 모양), ⟪pN⟫(문단 모양) 표지를 심으면 그 자리에 적용한다(없어도 된다)
//     images?: [{ name: string, dataUrl: 'data:image/png;base64,...' }]   markdown 의 ![](name) 과 이름으로 짝지어 넣는다(최대 20장)
//   }
//   → 200 application/hwp+zip 파일(Content-Disposition 첨부). kordoc validateHwpx 를 통과한 파일만 내보낸다.
//     헤더 X-Hwpx-Valid: 1, X-Hwpx-Warnings: (URI 인코딩된 경고, 있을 때만)
//   → 400 { error: { code, message } } 입력 오류 / 401 로그인 필요 / 413 너무 큼 / 500 INVALID_HWPX / 502 KORDOC / 503 ENGINE
//
// POST /api/hwpx/preview    generate 와 같은 JSON → 200 { svg, pageCount, width, height(pt), warnings[], bytes }
//                           svg 는 쪽이 세로로 이어진 한 장이다(쪽 높이 841.89pt, 쪽 사이 간격 있음)
// POST /api/hwpx/parse      multipart/form-data, 파일 칸 이름 'file' (.hwp .hwpx .docx .pdf, 4MB 이하)
//                           → 200 { markdown, title, fileType }  (OCR 은 끈다. 스캔 PDF 는 422 EMPTY)
// POST /api/hwpx/lint       { text | markdown, preset? } → 200 { gongmun: [{ line, match, rule, severity, message, suggest }],
//                           munche: [...] }  (munche 는 보고서·계획서·개조식 양식에서만)
// POST /api/hwpx/validate   HWPX 파일 하나(multipart 칸 이름 'file', 또는 본문 그대로 application/hwp+zip, 4MB 이하)
//                           → 200 { ok, issues: [{ path?, message }], entryCount, refs: { ok, issues: string[] } }
//                           ok 는 kordoc 구조 검사(mimetype 첫 엔트리, 필수 파일, XML 정합, secCnt, 매니페스트 파일),
//                           refs 는 header.xml 에 없는 글자/문단/테두리/스타일 번호와 그림 연결을 따로 본 결과(한컴이 열 때 조용히 고치는 원인)
// POST /api/hwpx/render     같은 입력 → 200 { pageCount, width, height(pt), pages: [{ n, svg }], warnings[], stats }
//                           kordoc 조판 렌더(조판 캐시가 없으면 reflow). ?pages=1-3 로 쪽 범위를 줄일 수 있다(기본 앞 30쪽)
// GET  /api/hwpx/status     → 200 { engine: true|false }
// ─────────────────────────────────────────────────────────────────────────────────────────────
// kordoc 은 동적 import 로 불러온다. 로컬에 설치되어 있지 않으면 KORDOC_PATH(패키지 폴더나 dist/index.js)로 다른 위치를 가리킬 수 있고,
// 둘 다 없으면 503 을 돌려준다(서버는 그대로 뜬다).
import express, { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { optionalAuth } from '../middleware/auth.js'
import { identityOf } from '../lib/wsAccess.js'
import { applyHwpxStyles, stripMarks } from '../lib/hwpxStyle.js'

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } })

let kordocP = null
let zipP = null
function kordocEntry() {
  const p = process.env.KORDOC_PATH
  if (!p) return null
  return /\.(c|m)?js$/.test(p) ? p : path.join(p, 'dist', 'index.js')
}
export function loadKordoc() {
  if (!kordocP) {
    const entry = kordocEntry()
    kordocP = (entry ? import(pathToFileURL(entry).href) : import('kordoc')).catch((e) => {
      kordocP = null
      throw Object.assign(new Error(`kordoc 없음: ${e.message}`), { code: 'ENGINE' })
    })
  }
  return kordocP
}
async function loadZip() {
  if (!zipP) {
    zipP = import('jszip')
      .then((m) => m.default || m)
      .catch(() => {
        const entry = kordocEntry()
        if (!entry) throw new Error('jszip 없음')
        const m = createRequire(entry)('jszip')
        return m.default || m
      })
      .catch((e) => {
        zipP = null
        throw Object.assign(e, { code: 'ENGINE' })
      })
  }
  return zipP
}

// 로그인한 사용자만
router.use('/hwpx', optionalAuth)
router.use(
  '/hwpx',
  wrap(async (req, res, next) => {
    const idn = await identityOf(req, res)
    if (!idn.emails.length) return res.status(401).json({ error: { code: 'LOGIN', message: '로그인이 필요합니다' } })
    next()
  })
)

const ALLOWED = ['docHead', 'docFoot', 'approval', 'noticeHead', 'press', 'bodyFont', 'bodyPt', 'lineSpacing', 'numbering', 'cover', 'toc', 'summary', 'pageNumbers', 'endMark', 'bullet2', 'levels']
const PRESETS = ['기안문', '보고서', '계획서', '통지', '알림', '회의록', '보도자료', '업무보고', '개조식', '방침서']
const MAX_MD = 500 * 1024
const MAX_IMAGES = 20
const safeName = (s) => String(s || '문서').replace(/[\\/:*?"<>|\r\n]/g, '').trim().slice(0, 80) || '문서'
const small = (o, n) => (o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length <= n ? o : {})

// 문자열만 남기고 길이를 줄인다(옵션 안 중첩 객체)
function clean(v, depth = 0) {
  if (v == null) return undefined
  if (typeof v === 'string') return v.slice(0, 300)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1)).filter((x) => x !== undefined)
  if (typeof v === 'object' && depth < 3) {
    const o = {}
    for (const [k, x] of Object.entries(v).slice(0, 30)) {
      const c = clean(x, depth + 1)
      if (c !== undefined) o[k] = c
    }
    return o
  }
  return undefined
}
const pickOptions = (o) => Object.fromEntries(Object.entries(small(o, 40)).filter(([k]) => ALLOWED.includes(k)).map(([k, v]) => [k, clean(v)]))

function decodeImages(list) {
  const out = {}
  if (!Array.isArray(list)) return out
  for (const im of list.slice(0, MAX_IMAGES)) {
    const name = String(im?.name || '').slice(0, 200)
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(im?.dataUrl || ''))
    if (!name || !m) continue
    out[name] = new Uint8Array(Buffer.from(m[2], 'base64'))
  }
  return out
}

/** 요청 본문 → 검사를 통과한 HWPX 바이트 */
async function build(body) {
  const { title, markdown, preset = '보고서', options, gongmun, spans, paras, images } = body || {}
  if (typeof markdown !== 'string' || !markdown.trim()) throw Object.assign(new Error('markdown 필요'), { status: 400, code: 'BAD_INPUT' })
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MD) throw Object.assign(new Error('본문 500KB 초과'), { status: 413, code: 'TOO_LARGE' })
  const presetKey = PRESETS.includes(preset) ? preset : '보고서'
  const k = await loadKordoc()
  const JSZip = await loadZip()
  const warnings = []
  const raw = await k.markdownToHwpx(markdown, {
    gongmun: { ...pickOptions(options || gongmun), preset: k.normalizeGongmunPreset(presetKey) },
    images: decodeImages(images),
    warnings,
  })
  const styled = await applyHwpxStyles(JSZip, raw, { spans: small(spans, 5000), paras: small(paras, 5000) })
  const buf = Buffer.from(styled.buffer)
  const v = await k.validateHwpx(buf)
  if (!v.ok) {
    const msg = (v.issues || []).map((i) => i.message || String(i)).join(', ').slice(0, 300)
    throw Object.assign(new Error(`한글 문서 검사 실패: ${msg}`), { status: 500, code: 'INVALID_HWPX' })
  }
  return { k, buf, warnings, name: safeName(title), applied: styled.applied }
}

function sendError(res, e) {
  if (e.code === 'ENGINE') return fail(res, 503, 'ENGINE', '한글 변환 엔진을 불러오지 못했습니다')
  if (e.status) return fail(res, e.status, e.code || 'ERROR', e.message)
  return fail(res, 502, 'KORDOC', `한글 문서 변환 실패: ${e.message}`)
}

router.get(
  '/hwpx/status',
  wrap(async (req, res) => {
    try {
      await loadKordoc()
      res.json({ engine: true })
    } catch {
      res.json({ engine: false })
    }
  })
)

router.post(
  '/hwpx/generate',
  wrap(async (req, res) => {
    try {
      const { buf, warnings, name } = await build(req.body)
      res.setHeader('Content-Type', 'application/hwp+zip')
      res.setHeader('Content-Disposition', `attachment; filename="document.hwpx"; filename*=UTF-8''${encodeURIComponent(`${name}.hwpx`)}`)
      res.setHeader('Content-Length', String(buf.length))
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Hwpx-Valid', '1')
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Hwpx-Valid, X-Hwpx-Warnings')
      if (warnings.length) res.setHeader('X-Hwpx-Warnings', encodeURIComponent(warnings.join(' | ').slice(0, 400)))
      res.status(200).send(buf)
    } catch (e) {
      sendError(res, e)
    }
  })
)

router.post(
  '/hwpx/preview',
  wrap(async (req, res) => {
    try {
      const { k, buf, warnings } = await build(req.body)
      const r = await k.renderHwpxToSvg(buf, { reflow: true })
      res.setHeader('Cache-Control', 'no-store')
      res.json({ svg: r.svg, pageCount: r.pageCount, width: r.width, height: r.height, warnings: [...warnings, ...(r.warnings || [])].slice(0, 20), bytes: buf.length })
    } catch (e) {
      sendError(res, e)
    }
  })
)

const MAX_FILE = 4 * 1024 * 1024
const EXT = ['.hwp', '.hwpx', '.docx', '.pdf']
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } })
const MAX_OUT = 600 * 1024

router.post(
  '/hwpx/parse',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'TOO_LARGE', '파일 크기 4MB 초과')
      if (err) return fail(res, 400, 'BODY', '파일을 받지 못했습니다')
      next()
    }),
  wrap(async (req, res) => {
    const f = req.file
    if (!f || !f.buffer?.length) return fail(res, 400, 'BAD_INPUT', "파일 칸 'file' 필요")
    // multer 는 파일 이름을 latin1 로 읽는다
    const name = Buffer.from(f.originalname || '', 'latin1').toString('utf8')
    const ext = (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()
    if (!EXT.includes(ext)) return fail(res, 400, 'EXT', `확장자는 ${EXT.join(', ')} 중 하나`)
    try {
      const k = await loadKordoc()
      const r = await k.parse(f.buffer, { ocr: false })
      if (!r.success) return fail(res, 422, r.code || 'PARSE', `파일을 읽지 못했습니다: ${r.error || '알 수 없는 오류'}`)
      let markdown = stripMarks(String(r.markdown || ''))
      if (!markdown.trim()) return fail(res, 422, 'EMPTY', '읽을 수 있는 글자가 없습니다. 스캔한 이미지 파일은 지원하지 않습니다')
      if (markdown.length > MAX_OUT) markdown = markdown.slice(0, MAX_OUT)
      const heading = markdown.match(/^\s{0,3}#{1,2}\s+(.+)$/m)?.[1]?.trim()
      const title = (r.metadata?.title || '').trim() || heading || name.replace(/\.[^.]+$/, '').trim() || '가져온 문서'
      res.json({ markdown, title: title.slice(0, 120), fileType: r.fileType || ext.slice(1) })
    } catch (e) {
      sendError(res, e)
    }
  })
)

// ── HWPX 검사/렌더: 클라이언트 writeHwpx 가 만든 파일을 확인한다 ──
const RAW_TYPES = ['application/hwp+zip', 'application/octet-stream', 'application/zip', 'application/x-hwpx', 'application/vnd.hancom.hwpx']
const rawBody = express.raw({ type: RAW_TYPES, limit: MAX_FILE })
function hwpxInput(req, res, next) {
  const ct = String(req.headers['content-type'] || '')
  if (/^multipart\/form-data/i.test(ct)) {
    return upload.single('file')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'TOO_LARGE', '파일 크기 4MB 초과')
      if (err) return fail(res, 400, 'BODY', '파일을 받지 못했습니다')
      req.hwpxBuf = req.file?.buffer
      next()
    })
  }
  rawBody(req, res, (err) => {
    if (err?.type === 'entity.too.large') return fail(res, 413, 'TOO_LARGE', '파일 크기 4MB 초과')
    if (err) return fail(res, 400, 'BODY', '파일을 받지 못했습니다')
    req.hwpxBuf = Buffer.isBuffer(req.body) ? req.body : undefined
    next()
  })
}

// header.xml 에 정의된 번호와 본문에서 부른 번호를 맞춰 본다
async function checkRefs(JSZip, buf) {
  const issues = []
  const zip = await JSZip.loadAsync(buf)
  const head = await zip.file('Contents/header.xml')?.async('string')
  if (!head) return ['Contents/header.xml 없음']
  const defs = (tag) => new Set([...head.matchAll(new RegExp(`<hh:${tag} [^>]*?\\bid="(\\d+)"`, 'g'))].map((m) => m[1]))
  const sets = { charPrIDRef: defs('charPr'), paraPrIDRef: defs('paraPr'), borderFillIDRef: defs('borderFill'), styleIDRef: defs('style') }
  const secs = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n))
  const hpf = (await zip.file('Contents/content.hpf')?.async('string')) || ''
  const items = new Set([...hpf.matchAll(/<opf:item\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]))
  const texts = [head, ...(await Promise.all(secs.map((n) => zip.file(n).async('string'))))]
  const seen = new Set()
  for (const t of texts) {
    for (const [attr, set] of Object.entries(sets)) {
      for (const m of t.matchAll(new RegExp(`\\b${attr}="(\\d+)"`, 'g'))) {
        if (!set.has(m[1]) && !seen.has(attr + m[1])) {
          seen.add(attr + m[1])
          // 4294967295 는 한컴이 "없음" 으로 쓰는 값
          if (m[1] !== '4294967295') issues.push(`${attr}=${m[1]} 이(가) header.xml 에 없음`)
        }
      }
    }
    for (const m of t.matchAll(/\bbinaryItemIDRef="([^"]+)"/g)) if (!items.has(m[1]) && !seen.has('b' + m[1])) { seen.add('b' + m[1]); issues.push(`그림 ${m[1]} 이(가) content.hpf 에 없음`) }
  }
  return issues.slice(0, 50)
}

router.post(
  '/hwpx/validate',
  hwpxInput,
  wrap(async (req, res) => {
    const buf = req.hwpxBuf
    if (!buf || !buf.length) return fail(res, 400, 'BAD_INPUT', "HWPX 파일이 필요합니다(칸 이름 'file' 또는 본문)")
    try {
      const k = await loadKordoc()
      const JSZip = await loadZip()
      const v = await k.validateHwpx(buf)
      let refs = []
      try {
        refs = await checkRefs(JSZip, buf)
      } catch (e) {
        refs = [`참조 검사 실패: ${e.message}`]
      }
      res.setHeader('Cache-Control', 'no-store')
      res.json({ ok: !!v.ok, issues: v.issues || [], entryCount: v.entryCount ?? 0, refs: { ok: refs.length === 0, issues: refs } })
    } catch (e) {
      sendError(res, e)
    }
  })
)

const MAX_RENDER_PAGES = 30
router.post(
  '/hwpx/render',
  hwpxInput,
  wrap(async (req, res) => {
    const buf = req.hwpxBuf
    if (!buf || !buf.length) return fail(res, 400, 'BAD_INPUT', "HWPX 파일이 필요합니다(칸 이름 'file' 또는 본문)")
    try {
      const k = await loadKordoc()
      const range = typeof req.query.pages === 'string' && /^[\d,\-]{1,40}$/.test(req.query.pages) ? req.query.pages : null
      const pages = range || `1-${MAX_RENDER_PAGES}`
      let r
      try {
        r = await k.renderDocumentToScene(new Uint8Array(buf), { reflow: true, pages })
      } catch (e) {
        // 쪽 범위가 문서보다 클 때 등: 전체를 한 번 더 시도한다
        if (!range) r = await k.renderDocumentToScene(new Uint8Array(buf), { reflow: true })
        else throw e
      }
      const sc = r.scene
      const out = [...r.pageSvgs.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_RENDER_PAGES).map(([n, svg]) => ({ n, svg }))
      res.setHeader('Cache-Control', 'no-store')
      res.json({
        pageCount: sc.pages?.length ?? out.length,
        width: sc.pages?.[0]?.width ?? null,
        height: sc.pages?.[0]?.height ?? null,
        pages: out,
        warnings: (sc.warnings || []).map((w) => (typeof w === 'string' ? w : w.message || String(w))).slice(0, 20),
        stats: sc.stats || null,
      })
    } catch (e) {
      sendError(res, e)
    }
  })
)

router.post(
  '/hwpx/lint',
  wrap(async (req, res) => {
    const { text, markdown, preset } = req.body || {}
    const src = typeof text === 'string' ? text : markdown
    if (typeof src !== 'string' || !src.trim()) return fail(res, 400, 'BAD_INPUT', 'text 필요')
    if (src.length > 200000) return fail(res, 413, 'TOO_LARGE', '본문이 너무 깁니다')
    try {
      const k = await loadKordoc()
      const body = stripMarks(src)
      const gongmun = k.lintGongmunText(body, { document: true }).slice(0, 200)
      const munche = k.usesGaejosikMunche(String(preset || '')) ? k.lintMuncheText(body).slice(0, 200) : []
      res.json({ gongmun, munche })
    } catch (e) {
      sendError(res, e)
    }
  })
)

export default router
