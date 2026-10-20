// aiClient.js: 서버 /ai/* 호출, SSE 스트림 읽기, 도구를 실행하며 대화를 이어 가는 runChat. 계약은 README.md.
// 키는 이 파일 어디에도 저장하지 않는다(서버로 보내기만 한다). 대화 기록(localStorage)에도 키가 들어가지 않는다.
import { cleanToolArgs } from './aiText'
import { api, API_BASE } from '../../hooks/useApi'
import { isLocalProvider, listLocalModels, localProviderEntry, streamLocal } from './localConnector'

export const MAX_STEPS = 8
const MAX_BODY_CHARS = 480000 // 서버 한도(600KB)보다 작게 보낸다
const MAX_MESSAGES = 56
const MAX_TOOL_RESULT_CHARS = 20000

export class AiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

// ── 연결 관리 ────────────────────────────────────────────────
// 'chatgpt-local'(내 컴퓨터의 ChatGPT 연결)은 서버 목록에 없고 브라우저에서 이 컴퓨터의 연결 프로그램으로 직접 부른다(localConnector.js)
export const listProviders = async () => [...(await api.get('/ai/providers')), localProviderEntry()]
export const listModels = (provider) => (isLocalProvider(provider) ? listLocalModels() : api.get('/ai/models', { provider }))
export const testConnection = (body) => api.post('/ai/test', body)
export const connectProvider = (provider, body) => api.put(`/ai/connections/${encodeURIComponent(provider)}`, body)
export const disconnectProvider = (provider) => api.del(`/ai/connections/${encodeURIComponent(provider)}`)

export function errorText(e) {
  if (!e) return '처리하지 못했습니다'
  return e.hint && !String(e.message).includes(e.hint) ? `${e.message} (${e.hint})` : e.message || '처리하지 못했습니다'
}

// ── SSE ──────────────────────────────────────────────────────
async function* readEvents(res) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n')
        if (!data) continue
        try {
          yield JSON.parse(data)
        } catch {
          /* 깨진 조각은 건너뛴다 */
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

/** POST /ai/chat 를 열어 이벤트를 하나씩 돌려준다. 실패는 AiError 로 던진다. 중단하면 조용히 끝난다 */
export async function* streamChat(body, { signal } = {}) {
  if (isLocalProvider(body.provider)) {
    yield* streamLocal(body, { signal, makeError: (code, message, status) => new AiError(code, message, status) })
    return
  }
  let res
  try {
    res = await fetch(`${API_BASE}/ai/chat`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (e?.name === 'AbortError') return
    throw new AiError('NETWORK', '서버에 연결하지 못했습니다. 네트워크를 확인하세요.')
  }
  if (!res.ok) {
    let j = null
    try {
      j = await res.json()
    } catch {
      /* 본문 없음 */
    }
    const code = j?.code || (res.status === 401 ? 'LOGIN' : res.status === 429 ? 'RATE_LIMIT' : res.status === 413 ? 'TOO_LARGE' : 'UPSTREAM')
    throw new AiError(code, j?.error || `요청에 실패했습니다 (${res.status})`, res.status)
  }
  try {
    for await (const ev of readEvents(res)) yield ev
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) return
    throw new AiError('NETWORK', '응답이 중간에 끊겼습니다. 다시 시도하세요.')
  }
}

// ── 보내기 전 정리 ───────────────────────────────────────────
const sizeOf = (v) => {
  try {
    return JSON.stringify(v).length
  } catch {
    return Infinity
  }
}

// 도구가 이미지를 돌려주면(한글 편집기의 look_at_page 등) 마지막 도구 결과 묶음 바로 뒤에 사용자 이미지 메시지로 붙여 보낸다. 이전 차례 것은 보내지 않는다.
export function trailingToolImages(messages) {
  const imgs = []
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'tool'; i--) if (messages[i].images?.length) imgs.unshift(...messages[i].images)
  return imgs.slice(0, 3)
}

/** 서버로 보낼 모양(화면용 필드 제거). 이전 차례의 이미지는 빼서 보낸다 */
export function toWire(messages) {
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })
  const wire = messages.map((m, i) => {
    const out = { role: m.role, content: m.content ?? '' }
    if (m.role === 'user' && m.images?.length && i === lastUser) out.images = m.images
    if (m.role === 'assistant') {
      if (m.toolCalls?.length) out.toolCalls = m.toolCalls.map((t) => ({ id: t.id, name: t.name, args: t.args ?? {}, ...(t.meta !== undefined ? { meta: t.meta } : {}) }))
      if (m.meta !== undefined && m.meta !== null) out.meta = m.meta
    }
    if (m.role === 'tool') {
      out.toolCallId = m.toolCallId
      if (m.toolName) out.toolName = m.toolName
    }
    return out
  })
  const extra = trailingToolImages(messages)
  if (extra.length) wire.push({ role: 'user', content: '(도구가 가져온 이미지입니다)', images: extra })
  return wire
}

/** 크기·개수 한도를 넘으면 가장 오래된 차례(사용자 메시지부터 다음 사용자 메시지 앞까지)부터 뺀다 */
export function fitToLimits(wire) {
  let list = wire
  const dropFirstTurn = () => {
    let next = -1
    for (let i = 1; i < list.length; i++) {
      if (list[i].role === 'user') {
        next = i
        break
      }
    }
    if (next < 0) return false
    list = list.slice(next)
    return true
  }
  while ((list.length > MAX_MESSAGES || sizeOf(list) > MAX_BODY_CHARS) && dropFirstTurn());
  return list
}

const specOf = (t) => ({ name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } })

function toolMessage(call, content, extra) {
  return { role: 'tool', toolCallId: call.id, toolName: call.name, content: String(content).slice(0, MAX_TOOL_RESULT_CHARS), ...extra }
}

/**
 * 한 번의 사용자 요청을 끝까지 처리한다: 보내고 -> 글과 도구 호출을 모으고 -> 도구를 실행하고 -> 결과를 붙여 다시 보냄 (최대 8번).
 * 반환: { messages: 이어 붙인 전체 대화, error?: {code,message}, stopReason, steps, usage }
 * 콜백: onMessages(전체 대화 복사본) 글이 늘거나 도구가 끝날 때마다, onToolStart(call), onToolEnd(call, {summary, undo, error})
 */
export async function runChat({ provider, model, getSystem, system, messages, tools = [], maxTokens, signal, onMessages, onToolStart, onToolEnd, maxSteps = MAX_STEPS }) {
  const transcript = [...messages]
  const toolMap = new Map(tools.filter((t) => typeof t.run === 'function').map((t) => [t.name, t]))
  const specs = tools.map(specOf)
  let usage = null
  let error = null
  let stopReason = 'end'
  let steps = 0
  const emit = () => onMessages?.([...transcript])

  while (steps < maxSteps) {
    steps++
    const asst = { role: 'assistant', content: '' }
    transcript.push(asst)
    emit()
    let done = null
    let lastEmit = 0
    try {
      const body = { provider, model, messages: fitToLimits(toWire(transcript.slice(0, -1))), ...(specs.length ? { tools: specs } : {}) }
      const sys = typeof getSystem === 'function' ? getSystem() : system
      if (sys) body.system = sys
      if (maxTokens) body.maxTokens = maxTokens
      for await (const ev of streamChat(body, { signal })) {
        if (ev.type === 'text') {
          asst.content += ev.delta
          const now = Date.now()
          if (now - lastEmit > 40) {
            lastEmit = now
            emit()
          }
        } else if (ev.type === 'tool_call') {
          ;(asst.toolCalls ||= []).push({ id: ev.id, name: ev.name, args: ev.args ?? {}, ...(ev.meta !== undefined ? { meta: ev.meta } : {}) })
        } else if (ev.type === 'done') {
          done = ev
        } else if (ev.type === 'error') {
          throw new AiError(ev.code || 'UPSTREAM', ev.message || '오류가 발생했습니다')
        }
      }
    } catch (e) {
      error = e instanceof AiError ? { code: e.code, message: e.message } : { code: 'UPSTREAM', message: errorText(e) }
    }
    if (done?.meta !== undefined) asst.meta = done.meta
    if (done?.usage) usage = done.usage
    if (!done && !error && !signal?.aborted) error = { code: 'NETWORK', message: '응답이 중간에 끊겼습니다. 다시 시도하세요.' }

    const calls = asst.toolCalls || []
    if (!asst.content && !calls.length) transcript.pop() // 빈 답은 기록하지 않는다
    emit()
    if (signal?.aborted || error) {
      // 결과가 없는 도구 호출이 기록에 남지 않게 처리한다(다음 요청이 거절되지 않도록)
      if (calls.length) {
        for (const c of calls) transcript.push(toolMessage(c, JSON.stringify({ error: '실행하지 않았습니다' }), { ui: { skipped: true } }))
      }
      stopReason = signal?.aborted ? 'aborted' : 'error'
      emit()
      break
    }
    if (!calls.length) {
      stopReason = done?.stopReason === 'length' ? 'length' : 'end'
      break
    }

    for (const call of calls) {
      if (signal?.aborted) {
        transcript.push(toolMessage(call, JSON.stringify({ error: '사용자가 중단했습니다' }), { ui: { skipped: true } }))
        continue
      }
      onToolStart?.(call)
      const tool = toolMap.get(call.name)
      let msg
      let outcome
      if (!tool) {
        outcome = { error: '알 수 없는 작업이라 실행하지 않았습니다' }
        msg = toolMessage(call, JSON.stringify({ error: outcome.error }), { ui: { error: outcome.error } })
      } else {
        try {
          const r = (await tool.run(cleanToolArgs(call.args || {}))) || {}
          outcome = { summary: r.summary || '완료', undo: typeof r.undo === 'function' ? r.undo : undefined }
          let content
          try {
            content = JSON.stringify(r.result === undefined ? { ok: true } : r.result)
          } catch {
            content = '{"ok":true}'
          }
          const imgs = Array.isArray(r.images) ? r.images.filter((u) => typeof u === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(u)).slice(0, 3) : []
          msg = toolMessage(call, content, { ui: { summary: outcome.summary, undoable: Boolean(outcome.undo) }, ...(imgs.length ? { images: imgs } : {}) })
        } catch (e) {
          const m = e?.message || '도구 실행에 실패했습니다'
          outcome = { error: m }
          msg = toolMessage(call, JSON.stringify({ error: m }), { ui: { error: m } })
        }
      }
      transcript.push(msg)
      onToolEnd?.(call, outcome)
      emit()
    }
    if (steps >= maxSteps) stopReason = 'max_steps'
  }
  return { messages: transcript, error, stopReason, steps, usage }
}

// ── 대화 기록(브라우저 localStorage, 서버 저장 없음) ─────────
const HISTORY_PREFIX = 'dah-ai:v1:'
const HISTORY_CAP_CHARS = 180000
const HISTORY_CAP_MESSAGES = 60

export function loadHistory(scope) {
  try {
    const raw = localStorage.getItem(HISTORY_PREFIX + scope)
    const j = raw ? JSON.parse(raw) : null
    return Array.isArray(j?.messages) ? j.messages : []
  } catch {
    return []
  }
}

export function saveHistory(scope, messages) {
  try {
    // 이미지는 저장하지 않는다(용량). 키는 애초에 이 대화에 없다.
    let list = messages.slice(-HISTORY_CAP_MESSAGES).map((m) => {
      if (!m.images?.length) return m
      const { images, ...rest } = m
      return { ...rest, content: `${m.content || ''}${m.content ? ' ' : ''}[이미지 ${images.length}장]`.trim() }
    })
    // 한도를 넘으면 오래된 차례부터 지운다
    while (list.length > 2 && sizeOf(list) > HISTORY_CAP_CHARS) {
      const next = list.findIndex((m, i) => i > 0 && m.role === 'user')
      list = next < 0 ? list.slice(1) : list.slice(next)
    }
    while (list.length && list[0].role !== 'user') list = list.slice(1)
    localStorage.setItem(HISTORY_PREFIX + scope, JSON.stringify({ messages: list, savedAt: Date.now() }))
  } catch {
    /* 저장 공간이 없으면 기록하지 않는다 */
  }
}

export function clearHistory(scope) {
  try {
    localStorage.removeItem(HISTORY_PREFIX + scope)
  } catch {
    /* 무시 */
  }
}

const LAST_KEY = 'dah-ai:last'
export function loadLastChoice() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || 'null') || {}
  } catch {
    return {}
  }
}
export function saveLastChoice(choice) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ provider: choice.provider || '', model: choice.model || '' }))
  } catch {
    /* 무시 */
  }
}

/** 이미지 파일을 긴 변 1280px 이하 JPEG data URL 로 줄인다(요청 한도 600KB 안에 들어가도록 약 250KB 이하) */
export async function fileToDataUrl(file) {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('png, jpeg, webp 이미지만 붙일 수 있습니다')
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', q)
    if (url.length < 250000) return url
  }
  throw new Error('이미지가 너무 큽니다. 더 작은 이미지를 붙여 주세요')
}
