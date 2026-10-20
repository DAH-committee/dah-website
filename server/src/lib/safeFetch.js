// src/lib/safeFetch.js: 사용자가 준 주소를 서버가 가져올 때 쓰는 SSRF 방어 도구 (routes/integrations.js 에서 옮김)
// http(s) 기본 포트만, DNS로 풀린 모든 IP가 공인 주소일 때만, 연결 시점에 같은 검사를 다시 하며, 리디렉션은 3번까지 매번 재검사한다.
// AI 연결(lib/ai)의 "custom" 주소도 같은 검사를 쓴다(safeRequest).
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'

// ── SSRF 방어 ───────────────────────────────────────────────
const BLOCKED = new net.BlockList()
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(a, p, 'ipv4')
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOCKED.addSubnet(a, p, 'ipv6')

export function isBlockedIp(ip) {
  const addr = String(ip).replace(/^\[|\]$/g, '').split('%')[0]
  const fam = net.isIP(addr)
  if (!fam) return true
  return BLOCKED.check(addr, fam === 6 ? 'ipv6' : 'ipv4')
}

export class UnsafeUrlError extends Error {
  constructor(message = '이 주소는 사용할 수 없습니다') {
    super(message)
    this.status = 400
    this.code = 'UNSAFE_URL'
  }
}

/** 사용자가 준 주소를 검사해 URL 객체를 돌려준다. 통과하지 못하면 UnsafeUrlError */
export function assertPublicUrl(raw) {
  let u
  try {
    u = new URL(String(raw || '').trim())
  } catch {
    throw new UnsafeUrlError('올바른 주소가 아닙니다')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('http 또는 https 주소만 사용할 수 있습니다')
  if (u.username || u.password) throw new UnsafeUrlError()
  if (u.port && u.port !== '80' && u.port !== '443') throw new UnsafeUrlError('기본 포트(80, 443)가 아닌 주소는 사용할 수 없습니다')
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new UnsafeUrlError()
  } else if (!host.includes('.') || /(^|\.)(localhost|local|internal|localdomain|lan|home\.arpa)$/.test(host)) {
    throw new UnsafeUrlError()
  }
  if (u.href.length > 2000) throw new UnsafeUrlError('주소가 너무 깁니다')
  return u
}

/** 연결하는 순간의 DNS 결과를 검사한다(DNS rebinding 방지: 검사한 주소로만 연결된다) */
export function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err)
    if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return cb(new UnsafeUrlError())
    if (options?.all) return cb(null, addrs)
    return cb(null, addrs[0].address, addrs[0].family)
  })
}

export const MAX_BYTES = 1024 * 1024
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 5000
export const UA = 'Mozilla/5.0 (compatible; DAHWorkspaceLinkPreview/1.0; +https://dah-hallym.vercel.app)'

/** 한 번 요청한다. 본문은 MAX_BYTES까지만 읽는다 */
function requestOnce(u, deadline, accept) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http
    const left = deadline - Date.now()
    if (left <= 0) return reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        agent: false,
        lookup: safeLookup,
        headers: { 'User-Agent': UA, Accept: accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ko,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' },
      },
      (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve({ status, location: String(res.headers.location), headers: res.headers, body: Buffer.alloc(0) })
        }
        let stream = res
        const enc = String(res.headers['content-encoding'] || '').toLowerCase()
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip())
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())
        const chunks = []
        let size = 0
        let done = false
        const finish = (err) => {
          if (done) return
          done = true
          clearTimeout(timer)
          if (err && !size) return reject(err)
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) })
        }
        stream.on('data', (c) => {
          size += c.length
          chunks.push(size > MAX_BYTES ? c.subarray(0, c.length - (size - MAX_BYTES)) : c)
          if (size >= MAX_BYTES) {
            size = MAX_BYTES
            finish()
            req.destroy()
          }
        })
        stream.on('end', () => finish())
        stream.on('error', (e) => finish(e))
        res.on('error', (e) => finish(e))
      }
    )
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), left)
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.end()
  })
}

/** 리디렉션(최대 3번)마다 주소를 다시 검사하며 가져온다 */
export async function safeFetch(rawUrl, { accept } = {}) {
  const deadline = Date.now() + FETCH_TIMEOUT_MS
  let u = assertPublicUrl(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await requestOnce(u, deadline, accept)
    if (r.location) {
      if (hop === MAX_REDIRECTS) throw new Error('too many redirects')
      u = assertPublicUrl(new URL(r.location, u).href)
      continue
    }
    return { ...r, url: u }
  }
  throw new Error('too many redirects')
}

/**
 * 스트리밍 가능한 POST/GET 요청 (AI 제공업체 호출용). 표준 Response 로 돌려준다.
 * https 만, 기본 포트만, 연결 시점 DNS 검사, 리디렉션은 따라가지 않는다(3xx 는 그대로 돌려주므로 호출부가 오류로 처리).
 */
export function safeRequest(rawUrl, { method = 'GET', headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = assertPublicUrl(rawUrl)
      if (u.protocol !== 'https:') throw new UnsafeUrlError('https 주소만 사용할 수 있습니다')
    } catch (e) {
      return reject(e)
    }
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const payload = body === undefined ? null : Buffer.from(body)
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method,
        agent: false,
        lookup: safeLookup,
        headers: { ...headers, 'Accept-Encoding': 'identity', ...(payload ? { 'Content-Length': payload.length } : {}) },
      },
      (res) => {
        const nobody = [204, 205, 304].includes(res.statusCode) || (res.statusCode >= 100 && res.statusCode < 200)
        const h = new Headers()
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : String(v))
        resolve(new Response(nobody ? null : Readable.toWeb(res), { status: res.statusCode || 502, headers: h }))
      }
    )
    const onAbort = () => req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    signal?.addEventListener('abort', onAbort, { once: true })
    const connectTimer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), 15000)
    req.on('response', () => clearTimeout(connectTimer))
    req.on('error', (e) => {
      clearTimeout(connectTimer)
      reject(e)
    })
    req.end(payload || undefined)
  })
}
