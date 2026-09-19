import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { pdfDefaults, presentationPdfJobs } from './presentation-pdfs.config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = resolve(__dirname, '..')
const HOST = '127.0.0.1'
const PREVIEW_PORT = Number(process.env.PRESENTATION_PDF_PREVIEW_PORT || 4175)
const DEBUG_PORT = Number(process.env.PRESENTATION_PDF_DEBUG_PORT || 9333)
const BASE_URL = `http://${HOST}:${PREVIEW_PORT}`
const selectedId = process.argv.find((arg) => arg.startsWith('--id='))?.slice(5)

if (process.argv.includes('--list')) {
  presentationPdfJobs.forEach((job) => process.stdout.write(`${job.id}\t${job.route}\t${job.output}\n`))
  process.exit(0)
}

const jobs = selectedId
  ? presentationPdfJobs.filter((job) => job.id === selectedId)
  : presentationPdfJobs

if (jobs.length === 0) {
  throw new Error(`PDF 등록표에 '${selectedId}' 자료가 없습니다.`)
}

const ids = new Set()
for (const job of jobs) {
  if (!job.id || ids.has(job.id)) throw new Error(`PDF 자료 id가 없거나 중복됩니다: ${job.id || '(비어 있음)'}`)
  if (!job.route?.startsWith('/')) throw new Error(`${job.id}: route는 /로 시작해야 합니다.`)
  if (!job.output?.endsWith('.pdf')) throw new Error(`${job.id}: output은 .pdf 경로여야 합니다.`)
  if (!Array.isArray(job.pages) || job.pages.length === 0) throw new Error(`${job.id}: pages가 비어 있습니다.`)
  ids.add(job.id)
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const chromePath = chromeCandidates.find(existsSync)
if (!chromePath) throw new Error('Chrome/Chromium을 찾지 못했습니다. CHROME_PATH를 설정해 주세요.')

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

async function waitForHttp(url, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 서버가 뜰 때까지 재시도한다.
    }
    await wait(250)
  }
  throw new Error(`${url} 응답 대기 시간이 초과되었습니다.`)
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 0
    this.pending = new Map()
    this.eventWaiters = new Map()
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.method && this.eventWaiters.has(message.method)) {
        const waiters = this.eventWaiters.get(message.method)
        this.eventWaiters.delete(message.method)
        waiters.forEach((resolveEvent) => resolveEvent(message.params))
      }
      if (!message.id || !this.pending.has(message.id)) return
      const { resolve: resolveCall, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolveCall(message.result)
    }
  }

  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolveOpen, reject) => {
      this.socket.onopen = resolveOpen
      this.socket.onerror = reject
    })
  }

  send(method, params = {}) {
    return new Promise((resolveCall, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve: resolveCall, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitForEvent(method, timeout = 15000) {
    return new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} 이벤트 대기 시간이 초과되었습니다.`)), timeout)
      const wrappedResolve = (value) => {
        clearTimeout(timer)
        resolveEvent(value)
      }
      const waiters = this.eventWaiters.get(method) || []
      waiters.push(wrappedResolve)
      this.eventWaiters.set(method, waiters)
    })
  }

  close() {
    this.socket.close()
  }
}

const profileDir = mkdtempSync(resolve(tmpdir(), 'dah-presentation-pdfs-'))
const viteBin = resolve(CLIENT_DIR, 'node_modules/vite/bin/vite.js')
const preview = spawn(process.execPath, [viteBin, 'preview', '--host', HOST, '--port', String(PREVIEW_PORT)], {
  cwd: CLIENT_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-web-security',
  '--no-first-run',
  '--no-sandbox',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDir}`,
  `--window-size=${pdfDefaults.viewport.width},${pdfDefaults.viewport.height}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), wait(3000)])
}

function pageUrl(job, page, index) {
  const url = new URL(job.route, BASE_URL)
  url.searchParams.set('preview', '1')
  url.searchParams.set('page', String(index + 1))
  if (page.query) Object.entries(page.query).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  if (page.hash) url.hash = page.hash
  return url.href
}

async function renderJob(cdp, job) {
  const viewport = job.viewport || pdfDefaults.viewport
  const pdfPage = job.page || pdfDefaults.page
  const format = job.imageFormat || pdfDefaults.imageFormat
  const quality = job.imageQuality || pdfDefaults.imageQuality
  const settleTime = job.settleTime ?? pdfDefaults.settleTime
  const outputPath = resolve(CLIENT_DIR, job.output)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const outputPdf = await PDFDocument.create()
  outputPdf.setTitle(job.title)
  outputPdf.setAuthor(job.author)
  outputPdf.setSubject(job.subject || job.title)
  outputPdf.setCreator('DAH Website PDF Engine')
  const fixedDate = new Date(job.documentDate || '2026-09-19T00:00:00Z')
  outputPdf.setCreationDate(fixedDate)
  outputPdf.setModificationDate(fixedDate)

  for (const [index, page] of job.pages.entries()) {
    const loaded = cdp.waitForEvent('Page.loadEventFired')
    await cdp.send('Page.navigate', { url: pageUrl(job, page, index) })
    await loaded
    await cdp.send('Runtime.evaluate', {
      expression: `new Promise(async (resolve) => {
        while (document.readyState !== 'complete') await new Promise((next) => setTimeout(next, 50));
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((image) => image.complete ? null : new Promise((next) => {
          image.addEventListener('load', next, { once: true });
          image.addEventListener('error', next, { once: true });
        })));
        setTimeout(resolve, ${JSON.stringify(settleTime)});
      })`,
      awaitPromise: true,
    })

    const captured = await cdp.send('Page.captureScreenshot', {
      format,
      quality: format === 'png' ? undefined : quality,
      fromSurface: true,
      captureBeyondViewport: false,
    })
    const bytes = Buffer.from(captured.data, 'base64')
    const image = format === 'png' ? await outputPdf.embedPng(bytes) : await outputPdf.embedJpg(bytes)
    const outputPage = outputPdf.addPage([pdfPage.width, pdfPage.height])
    outputPage.drawImage(image, { x: 0, y: 0, width: pdfPage.width, height: pdfPage.height })
    process.stdout.write(`\r[${job.id}] PDF 화면 생성 ${index + 1}/${job.pages.length}`)
  }

  const bytes = await outputPdf.save({ useObjectStreams: true })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, bytes)
  process.stdout.write(`\n완료: ${outputPath}\n`)
}

try {
  await Promise.all([
    waitForHttp(BASE_URL),
    waitForHttp(`http://${HOST}:${DEBUG_PORT}/json/version`),
  ])

  const targets = await fetch(`http://${HOST}:${DEBUG_PORT}/json`).then((response) => response.json())
  const target = targets.find((item) => item.type === 'page')
  if (!target) throw new Error('PDF 렌더링용 Chrome 페이지를 찾지 못했습니다.')

  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' })

  for (const job of jobs) await renderJob(cdp, job)
  cdp.close()
} finally {
  await Promise.all([stopChild(preview), stopChild(chrome)])
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
