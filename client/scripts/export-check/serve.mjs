// 시험용 정적 서버(127.0.0.1, 포트 3170~3179). docx-preview 렌더 페이지와 산출 파일을 브라우저에 준다.
// 사용: node serve.mjs [--allow 폴더]...   (기본 허용: ./.out). 한 번 띄우면 계속 둔다.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.hwpx': 'application/octet-stream' }

export function startServer({ allow = [path.join(here, '.out')], ports = [3170, 3171, 3172, 3173, 3174, 3175, 3176, 3177, 3178, 3179] } = {}) {
  const nfc = (p) => p.normalize('NFC')
  const roots = allow.map((a) => nfc(path.resolve(a)))
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://x')
      let file
      if (u.pathname === '/' || u.pathname === '/render.html') file = path.join(here, 'render.html')
      else if (u.pathname.startsWith('/vendor/')) file = path.join(here, '.vendor', path.basename(u.pathname))
      else if (u.pathname.startsWith('/files/')) {
        file = path.resolve(decodeURIComponent(u.pathname.slice('/files'.length)))
        if (!roots.some((r) => nfc(file) === r || nfc(file).startsWith(r + path.sep))) { res.writeHead(403); return res.end('forbidden') }
      } else { res.writeHead(404); return res.end('not found') }
      if (!MIME[path.extname(file)]) { res.writeHead(415); return res.end('type') }
      const buf = fs.readFileSync(file)
      res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
      res.end(buf)
    } catch (e) { res.writeHead(404); res.end(String(e.message)) }
  })
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= ports.length) return reject(new Error('3170-3179 포트가 모두 사용 중'))
      server.once('error', () => tryPort(i + 1))
      server.listen(ports[i], '127.0.0.1', () => resolve({ server, port: ports[i] }))
    }
    tryPort(0)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const allow = []
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--allow') allow.push(process.argv[++i])
  const { port } = await startServer(allow.length ? { allow: [...allow, path.join(here, '.out')] } : {})
  console.log(`export-check 서버: http://127.0.0.1:${port}/render.html`)
}
