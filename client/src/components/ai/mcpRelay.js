// 외부 AI 앱(Claude, ChatGPT, Codex 등)이 MCP 로 이 파일을 다룰 때, 열려 있는 편집기 탭이 그 도구 호출을 대신 실행한다.
// 서버(/mcp)가 도구 호출을 대기열에 넣으면, 이 훅이 가져와 AI 창(AiPanel)이 쓰는 것과 같은 도구 목록으로 실행한다.
// 그래서 실행취소, 기록, 자동 저장, 검증이 AI 창에서 쓸 때와 똑같이 동작한다.
//
// 사용(편집기마다 한 줄):
//   const relay = useMcpRelay({ fileId, kind: 'doc', tools: aiToolList, canEdit })
//   ... 상단 줄에  {relay.badge}
// - fileId: 파일 id(ws_files.id). 없으면 아무 일도 하지 않는다.
// - tools: AiPanel 에 넘기는 것과 같은 [{ name, run }] 배열. 매 렌더 최신 값을 쓴다.
// - canEdit: 이 탭이 고칠 수 있는 상태인지(서버가 쓰기 도구를 이 값과 파일 권한으로 한 번 더 막는다).
// 동작: 10초마다 "열려 있음" 신호(presence)를 보내고, 서버가 "최근에 AI 앱이 호출했다"고 알려 주면 롱폴(최대 25초)로 작업을 받는다.
// 외부 호출이 없는 동안은 신호만 보내므로 서버 부하가 거의 없다.
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plug, Undo2 } from 'lucide-react'
import { API_BASE } from '../../hooks/useApi'
import './mcpRelay.css'

const BEAT_MS = 10_000
const OFF_KEY = 'dah-mcp-off:'

const newTabId = () => {
  const a = new Uint8Array(9)
  crypto.getRandomValues(a)
  return `tab_${Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('')}`
}
const readOff = (fileId) => {
  try {
    return sessionStorage.getItem(OFF_KEY + fileId) === '1'
  } catch {
    return false
  }
}
const writeOff = (fileId, on) => {
  try {
    if (on) sessionStorage.setItem(OFF_KEY + fileId, '1')
    else sessionStorage.removeItem(OFF_KEY + fileId)
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

/** 결과를 JSON 으로 보낼 수 있게 만든다(순환 참조, 함수, 너무 큰 값 방지) */
export function toJsonSafe(value, maxChars = 800_000) {
  try {
    const seen = new WeakSet()
    const text = JSON.stringify(value === undefined ? null : value, (k, v) => {
      if (typeof v === 'function' || typeof v === 'symbol') return undefined
      if (typeof v === 'bigint') return String(v)
      if (v && typeof v === 'object') {
        if (seen.has(v)) return undefined
        seen.add(v)
      }
      return v
    })
    if (text.length > maxChars) return { truncated: true, note: '결과가 너무 커서 보내지 못했습니다. 범위를 좁혀 다시 부르세요.' }
    return JSON.parse(text)
  } catch {
    return { note: '결과를 JSON 으로 바꾸지 못했습니다' }
  }
}

async function http(path, { method = 'GET', body, signal, keepalive } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    signal,
    keepalive,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    const err = new Error(json?.error || `요청 실패 (${res.status})`)
    err.status = res.status
    throw err
  }
  return json
}

/**
 * 편집기 탭이 외부 AI 앱의 도구 호출을 실행한다.
 * 반환: { active, paused, busy, lastSummary, canUndo, disconnect, resume, undoLast, badge }
 */
export function useMcpRelay({ fileId, kind, tools, canEdit }) {
  const toolsRef = useRef(tools)
  toolsRef.current = tools
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const kindRef = useRef(kind)
  kindRef.current = kind
  const undoStack = useRef([])
  const [paused, setPaused] = useState(() => readOff(fileId))
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastSummary, setLastSummary] = useState('')
  const [undoCount, setUndoCount] = useState(0)

  useEffect(() => {
    setPaused(readOff(fileId))
    setActive(false)
    undoStack.current = []
    setUndoCount(0)
  }, [fileId])

  // 도구 하나를 실행하고 서버에 돌려줄 결과를 만든다
  const runJob = useCallback(async (job) => {
    if (job.tool === '__undo') {
      const u = undoStack.current.pop()
      setUndoCount(undoStack.current.length)
      if (!u) return { ok: true, summary: '되돌릴 변경이 없습니다', result: { ok: true, undone: false } }
      try {
        u.undo()
        setLastSummary(`되돌림: ${u.summary || u.name}`)
        return { ok: true, summary: `되돌림: ${u.summary || u.name}`, result: { ok: true, undone: true, tool: u.name } }
      } catch (e) {
        return { ok: false, error: `되돌리지 못했습니다: ${e?.message || e}` }
      }
    }
    const tool = (toolsRef.current || []).find((t) => t.name === job.tool)
    if (!tool || typeof tool.run !== 'function') return { ok: false, error: `이 편집기에는 없는 도구입니다: ${job.tool}` }
    try {
      const out = await tool.run(job.args && typeof job.args === 'object' ? job.args : {})
      if (typeof out?.undo === 'function') {
        undoStack.current.push({ name: job.tool, summary: out.summary || '', undo: out.undo })
        if (undoStack.current.length > 30) undoStack.current.shift()
        setUndoCount(undoStack.current.length)
      }
      const summary = typeof out?.summary === 'string' ? out.summary : ''
      if (summary) setLastSummary(summary)
      return { ok: true, summary, result: toJsonSafe(out?.result) }
    } catch (e) {
      return { ok: false, error: `${e?.message || e}` }
    }
  }, [])

  useEffect(() => {
    if (!fileId || paused) return undefined
    let alive = true
    let polling = false
    let failures = 0
    const ctrl = new AbortController()
    const tabId = newTabId()
    const q = () => `file_id=${encodeURIComponent(fileId)}&tab_id=${tabId}&can_edit=${canEditRef.current ? 1 : 0}`

    async function poll() {
      if (polling) return
      polling = true
      try {
        while (alive) {
          const r = await http(`/mcp/relay/jobs?${q()}`, { signal: ctrl.signal })
          failures = 0
          if (!alive) break
          if (r.job) {
            setBusy(true)
            const out = await runJob(r.job)
            setBusy(false)
            await http(`/mcp/relay/jobs/${r.job.id}/result`, { method: 'POST', body: out, signal: ctrl.signal }).catch(() => {})
            continue
          }
          setActive(Boolean(r.active))
          if (!r.active) break
        }
      } catch (e) {
        if (e?.name !== 'AbortError') {
          failures += 1
          if (e?.status === 401 || e?.status === 404 || e?.status === 403) alive = false // 로그인이 풀렸거나 권한이 없다
        }
      } finally {
        setBusy(false)
        polling = false
      }
    }

    async function beat() {
      if (!alive) return
      try {
        const r = await http('/mcp/relay/presence', { method: 'POST', body: { file_id: fileId, tab_id: tabId, kind: kindRef.current, can_edit: Boolean(canEditRef.current) }, signal: ctrl.signal })
        failures = 0
        setActive(Boolean(r.active))
        if (r.active && !polling) poll()
      } catch (e) {
        if (e?.name === 'AbortError') return
        failures += 1
        if (e?.status === 401 || e?.status === 404 || e?.status === 403 || failures > 5) alive = false
      }
    }

    const first = setTimeout(beat, 1500)
    const timer = setInterval(beat, BEAT_MS)
    const leave = () => {
      // 탭을 닫거나 떠날 때 "열려 있음"을 바로 지운다(오래 남으면 AI 앱이 닫힌 탭에 일을 맡기고 기다린다)
      try {
        fetch(`${API_BASE}/mcp/relay/presence`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId, tab_id: tabId, leave: true }) }).catch(() => {})
      } catch {
        /* 닫는 중 */
      }
    }
    window.addEventListener('pagehide', leave)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener('pagehide', leave)
      ctrl.abort()
      leave()
    }
  }, [fileId, paused, runJob])

  const disconnect = useCallback(() => {
    writeOff(fileId, true)
    setPaused(true)
    setActive(false)
    http('/mcp/relay/disconnect', { method: 'POST', body: { file_id: fileId } }).catch(() => {})
  }, [fileId])
  const resume = useCallback(() => {
    writeOff(fileId, false)
    setPaused(false)
  }, [fileId])
  const undoLast = useCallback(() => {
    const u = undoStack.current.pop()
    setUndoCount(undoStack.current.length)
    if (!u) return
    try {
      u.undo()
      setLastSummary(`되돌림: ${u.summary || u.name}`)
    } catch {
      /* 이미 다른 변경이 겹쳤다: 편집기의 실행취소로 한 단계씩 되돌려야 한다 */
    }
  }, [])

  const badge = useMemo(() => {
    if (!fileId) return null
    if (paused) {
      return h('span', { className: 'mcp-badge is-paused', role: 'status' }, h(Plug, { size: 14, 'aria-hidden': true }), h('span', null, '외부 AI 끊김'), h('button', { type: 'button', className: 'mcp-badge__btn', onClick: resume }, '다시 연결'))
    }
    if (!active) return null
    return h(
      'span',
      { className: 'mcp-badge', role: 'status', 'aria-live': 'polite', title: lastSummary || '외부 AI 앱(Claude, ChatGPT 등)이 이 파일을 다루고 있습니다' },
      h(Plug, { size: 14, 'aria-hidden': true }),
      h('span', null, busy ? '외부 AI 작업 중' : '외부 AI 연결 중'),
      undoCount > 0 && h('button', { type: 'button', className: 'mcp-badge__btn', onClick: undoLast, title: '외부 AI 가 한 마지막 변경 되돌리기', 'aria-label': '마지막 변경 되돌리기' }, h(Undo2, { size: 13, 'aria-hidden': true })),
      h('button', { type: 'button', className: 'mcp-badge__btn', onClick: disconnect, title: '이 탭에서 외부 AI 연결 끊기' }, '끊기')
    )
  }, [fileId, paused, active, busy, undoCount, lastSummary, resume, undoLast, disconnect])

  return { active, paused, busy, lastSummary, canUndo: undoCount > 0, disconnect, resume, undoLast, badge }
}
