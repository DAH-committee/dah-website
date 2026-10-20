// lib/ai/sse.js: 제공업체의 text/event-stream 응답을 {event, data} 로 읽는다.
import { AiError } from './errors.js'

const MAX_STREAM_BYTES = 12 * 1024 * 1024

export async function* parseSse(res) {
  if (!res.body) return
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let total = 0
  const take = function* (final) {
    buf = buf.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n')
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0 || (final && buf.trim())) {
      const raw = idx >= 0 ? buf.slice(0, idx) : buf
      buf = idx >= 0 ? buf.slice(idx + 2) : ''
      let event = ''
      const data = []
      for (const line of raw.split('\n')) {
        if (!line || line.startsWith(':')) continue
        const c = line.indexOf(':')
        const field = c < 0 ? line : line.slice(0, c)
        const value = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length || event) yield { event, data: data.join('\n') }
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_STREAM_BYTES) throw new AiError('UPSTREAM', '응답이 너무 깁니다.')
      buf += dec.decode(value, { stream: true })
      yield* take(false)
    }
    buf += dec.decode()
    yield* take(true)
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function parseJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
