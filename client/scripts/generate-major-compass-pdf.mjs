import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = resolve(__dirname, '..')
const OUTPUT = resolve(process.env.MAJOR_COMPASS_PDF_OUTPUT || resolve(CLIENT_DIR, 'public/downloads/2026-major-compass.pdf'))
const HOST = '127.0.0.1'
const PREVIEW_PORT = Number(process.env.MAJOR_COMPASS_PREVIEW_PORT || 4175)
const DEBUG_PORT = Number(process.env.MAJOR_COMPASS_DEBUG_PORT || 9333)
const BASE_URL = `http://${HOST}:${PREVIEW_PORT}`

const slides = [
  ['cover', 1],
  ['about', 3],
  ['curriculum', 4],
  ['codesharing', 2],
  ['nanodegree', 5],
  ['faculty', 2],
  ['exhibitions', 2],
  ['contests', 2],
  ['achievements', 1],
  ['careers', 1],
  ['council', 1],
  ['clubs', 2],
  ['closing', 1],
]

const pages = slides.flatMap(([id, steps]) =>
  Array.from({ length: steps }, (_, step) => ({ id, step }))
)

const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const chromePath = chromeCandidates.find(existsSync)
if (!chromePath) {
  throw new Error('Chrome/Chromium을 찾지 못했습니다. CHROME_PATH를 설정해 주세요.')
}

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

const profileDir = mkdtempSync(resolve(tmpdir(), 'dah-major-compass-pdf-'))
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
  '--window-size=1920,1080',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), wait(3000)])
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' })

  const outputPdf = await PDFDocument.create()
  outputPdf.setTitle('2026 자유전공학부 전공 나침반 발표 자료')
  outputPdf.setAuthor('한림대학교 디지털인문예술전공')
  outputPdf.setSubject('디지털인문예술전공 소개 발표 자료')
  outputPdf.setCreator('DAH Website')
  outputPdf.setCreationDate(new Date('2026-09-19T00:00:00Z'))
  outputPdf.setModificationDate(new Date('2026-09-19T00:00:00Z'))

  for (const [index, page] of pages.entries()) {
    const suffix = page.step > 0 ? `:${page.step + 1}` : ''
    const url = `${BASE_URL}/major-compass?preview=1&page=${index + 1}#${page.id}${suffix}`
    const loaded = cdp.waitForEvent('Page.loadEventFired')
    await cdp.send('Page.navigate', { url })
    await loaded
    await cdp.send('Runtime.evaluate', {
      expression: `new Promise(async (resolve) => {
        while (document.readyState !== 'complete') await new Promise((next) => setTimeout(next, 50));
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((image) => image.complete ? null : new Promise((next) => {
          image.addEventListener('load', next, { once: true });
          image.addEventListener('error', next, { once: true });
        })));
        setTimeout(resolve, 900);
      })`,
      awaitPromise: true,
    })

    const captured = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 93,
      fromSurface: true,
      captureBeyondViewport: false,
    })
    const image = await outputPdf.embedJpg(Buffer.from(captured.data, 'base64'))
    const outputPage = outputPdf.addPage([1440, 810])
    outputPage.drawImage(image, { x: 0, y: 0, width: 1440, height: 810 })
    process.stdout.write(`\rPDF 화면 생성 ${index + 1}/${pages.length}`)
  }

  cdp.close()
  const bytes = await outputPdf.save({ useObjectStreams: true })
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, bytes)
  process.stdout.write(`\n완료: ${OUTPUT}\n`)
} finally {
  await Promise.all([stopChild(preview), stopChild(chrome)])
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
