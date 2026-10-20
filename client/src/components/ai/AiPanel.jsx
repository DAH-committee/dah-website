// AiPanel: 문서·발표·보드 옆에 붙는 AI 채팅 창(너비 360px). 계약은 README.md.
// 모델이 보낸 글은 아래 작은 렌더러로만 그린다(문단, 굵게, 목록, 코드). HTML 로 해석하지 않는다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Eraser, ImagePlus, LoaderCircle, Settings2, Sparkles, Square, TriangleAlert, Undo2, ArrowUp, Wrench, X } from 'lucide-react'
import { confirmDialog } from '../common/AppDialog'
import AiSettingsDialog from './AiSettingsDialog'
import { MAX_STEPS, clearHistory, errorText, fileToDataUrl, listModels, listProviders, loadHistory, loadLastChoice, runChat, saveHistory, saveLastChoice } from './aiClient'
import { STYLE_RULES, cleanChatText, inlineTokens } from './aiText'
import { LOCAL_ERROR_CODES, USAGE_URL, isLocalProvider } from './localConnector'
import './ai.css'

// ── 작은 마크다운 렌더러 ─────────────────────────────────────
function Inline({ text }) {
  return inlineTokens(text).map((o, i) => {
    if (o.t === 'code') return <code key={i}>{o.v}</code>
    if (o.t === 'strong') return <strong key={i}>{o.v}</strong>
    if (o.t === 'em') return <em key={i}>{o.v}</em>
    return o.v
  })
}

function parseBlocks(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let para = []
  let list = null
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', lines: para })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      flushPara()
      flushList()
      const code = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      blocks.push({ t: 'code', text: code.join('\n') })
      continue
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (!list || list.t !== kind) {
        flushList()
        list = { t: kind, items: [] }
      }
      list.items.push((ul || ol)[1])
      continue
    }
    flushList()
    const h = /^#{1,4}\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      blocks.push({ t: 'h', text: h[1] })
    } else if (!line.trim()) flushPara()
    else para.push(line)
  }
  flushPara()
  flushList()
  return blocks
}

function Markdown({ text }) {
  const blocks = useMemo(() => parseBlocks(cleanChatText(text)), [text])
  return (
    <div className="ai-md">
      {blocks.map((b, i) => {
        if (b.t === 'code') return <pre key={i}><code>{b.text}</code></pre>
        if (b.t === 'h') return <p key={i} className="ai-md__h"><Inline text={b.text} /></p>
        if (b.t === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>
        if (b.t === 'ol') return <ol key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <span key={j}>{j > 0 && <br />}<Inline text={l} /></span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

const BASE_PROMPT = `너는 문서, 발표, 보드를 옆에서 돕는 한국어 AI다. 짧고 정확하게 답한다. ${STYLE_RULES}`
const WITH_TOOLS = ' 내용을 고치기 전에 해당 부분을 도구로 먼저 읽고, 고친 뒤에는 무엇을 바꿨는지 한두 문장으로 알린다.'
const NO_TOOLS = ' 지금은 보기 권한이라 도구가 없다. 고칠 문장은 제안으로만 보여 준다.'

// 화면에는 영어 도구 이름 대신 한국어 작업 이름을 보인다
const TOOL_LABELS = {
  read_document: '문서 읽기', get_selection: '선택한 글 확인', replace_selection: '선택한 글 바꾸기', replace_text: '찾아 바꾸기',
  edit_paragraphs: '문단 고치기', fix_typos: '맞춤법 고치기', insert_blocks: '내용 넣기', set_document_title: '제목 바꾸기', run_gongmun_check: '공문 형식 검사',
  read_deck: '발표 읽기', read_slide: '슬라이드 읽기', edit_slide_text: '슬라이드 글 고치기', set_notes: '발표자 노트 쓰기', add_slide: '슬라이드 추가',
  delete_slide: '슬라이드 삭제', move_slide: '슬라이드 옮기기', create_deck_from_outline: '글로 발표 만들기', restyle: '디자인 바꾸기',
  read_canvas: '보드 읽기', add_sticky_notes: '스티커 메모 추가', add_text_blocks: '글 상자 추가', group_into_frames: '주제별로 묶기', connect_items: '연결선 추가', edit_items: '글 고치기',
}
const toolLabel = (name) => TOOL_LABELS[name] || '작업'

function ToolCard({ call, result, running, undoable, undone, onUndo }) {
  const err = result?.ui?.error
  const skipped = result?.ui?.skipped
  let state = 'run'
  if (result) state = err ? 'err' : skipped ? 'skip' : 'ok'
  else if (!running) state = 'skip'
  const label = state === 'run' ? '실행 중' : state === 'err' ? err : state === 'skip' ? '실행하지 않음' : undone ? '되돌렸습니다' : result?.ui?.summary || '완료'
  return (
    <div className={`ai-tool is-${state}`}>
      <span className="ai-tool__icon">{state === 'run' ? <LoaderCircle size={15} className="ai-spin" /> : state === 'err' ? <TriangleAlert size={15} /> : state === 'ok' ? <Check size={15} /> : <Wrench size={15} />}</span>
      <span className="ai-tool__text"><b>{toolLabel(call.name)}</b><span>{label}</span></span>
      {state === 'ok' && undoable && !undone && <button type="button" className="ai-tool__undo" onClick={onUndo}><Undo2 size={14} />되돌리기</button>}
    </div>
  )
}

export default function AiPanel({ open, onClose, scope = 'default', title = 'AI', systemPrompt = '', tools = [], getContext, quickActions = [], placeholder = 'AI에게 요청하세요', canEdit = true }) {
  const [providers, setProviders] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [choice, setChoice] = useState(() => loadLastChoice())
  const [models, setModels] = useState([])
  const [messages, setMessages] = useState(() => loadHistory(scope))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState([])
  const [settings, setSettings] = useState(false)
  const [runningIds, setRunningIds] = useState(() => new Set())
  const [, bump] = useState(0)
  const abortRef = useRef(null)
  const undoRef = useRef(new Map())
  const listRef = useRef(null)
  const stickRef = useRef(true)
  const fileRef = useRef(null)
  const taRef = useRef(null)
  const scopeRef = useRef(scope)
  const toolsRef = useRef(tools)
  const ctxRef = useRef(getContext)
  toolsRef.current = tools
  ctxRef.current = getContext

  // 범위(문서)가 바뀌면 그 문서의 대화를 불러온다
  useEffect(() => {
    scopeRef.current = scope
    abortRef.current?.abort()
    undoRef.current = new Map()
    setMessages(loadHistory(scope))
    setError(null)
    setNotice('')
    setBusy(false)
  }, [scope])
  useEffect(() => () => abortRef.current?.abort(), [])

  const reloadProviders = useCallback(async () => {
    try {
      const list = await listProviders()
      setProviders(list)
      setLoadError('')
      return list
    } catch (e) {
      setLoadError(e?.status === 401 ? '로그인한 뒤에 쓸 수 있습니다.' : errorText(e))
      setProviders([])
      return []
    }
  }, [])
  useEffect(() => {
    if (open && providers === null) reloadProviders()
  }, [open, providers, reloadProviders])

  const connected = useMemo(() => (providers || []).filter((p) => p.connected), [providers])
  const provider = connected.find((p) => p.id === choice.provider) || connected.find((p) => p.id !== 'mock') || connected[0] || null
  const providerId = provider?.id || ''
  const model = (provider && choice.provider === provider.id && choice.model) || provider?.model || models[0]?.id || ''

  useEffect(() => {
    if (!providerId) return undefined
    let alive = true
    setModels([])
    listModels(providerId)
      .then((m) => alive && Array.isArray(m) && setModels(m))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [providerId])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, error, notice, open])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft, open])

  const results = useMemo(() => {
    const map = new Map()
    for (const m of messages) if (m.role === 'tool') map.set(m.toolCallId, m)
    return map
  }, [messages])

  const persist = useCallback((list) => saveHistory(scopeRef.current, list), [])

  const selectProvider = (id) => {
    const next = { provider: id, model: '' }
    setChoice(next)
    saveLastChoice(next)
  }
  const selectModel = (id) => {
    const next = { provider: providerId, model: id }
    setChoice(next)
    saveLastChoice(next)
  }

  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    setNotice('')
    try {
      const urls = []
      for (const f of list.slice(0, 3 - images.length)) urls.push(await fileToDataUrl(f))
      setImages((prev) => [...prev, ...urls].slice(0, 3))
    } catch (e) {
      setNotice(e?.message || '이미지를 붙이지 못했습니다')
    }
  }
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean)
    if (files.length) {
      e.preventDefault()
      addFiles(files)
    }
  }

  async function send(text) {
    const content = String(text ?? draft).trim()
    if ((!content && !images.length) || busy || !provider) return
    const user = { role: 'user', content: content || '(이미지)', ...(images.length ? { images } : {}) }
    const history = [...messages, user]
    setMessages(history)
    setDraft('')
    setImages([])
    setError(null)
    setNotice('')
    setBusy(true)
    stickRef.current = true
    const ac = new AbortController()
    abortRef.current = ac
    const editable = canEdit !== false
    const toolList = editable ? toolsRef.current : []
    const r = await runChat({
      provider: providerId,
      model,
      messages: history,
      tools: toolList,
      maxTokens: provider.maxTokens || undefined,
      signal: ac.signal,
      getSystem: () => {
        let ctx = ''
        try {
          ctx = ctxRef.current?.() || ''
        } catch {
          ctx = ''
        }
        return [BASE_PROMPT + (editable && toolList.length ? WITH_TOOLS : '') + (editable ? '' : NO_TOOLS), systemPrompt, ctx && `[지금 화면]\n${ctx}`].filter(Boolean).join('\n\n')
      },
      onMessages: (list) => {
        if (scopeRef.current === scope) setMessages(list)
      },
      onToolStart: (call) => {
        setRunningIds((s) => new Set(s).add(call.id))
        stickRef.current = true
      },
      onToolEnd: (call, outcome) => {
        if (outcome?.undo) undoRef.current.set(call.id, outcome.undo)
        setRunningIds((s) => {
          const n = new Set(s)
          n.delete(call.id)
          return n
        })
      },
    })
    persist(r.messages)
    if (scopeRef.current === scope) {
      setMessages(r.messages)
      setBusy(false)
      setRunningIds(new Set())
      if (r.error) setError(r.error)
      else if (r.stopReason === 'length') setNotice('답이 길어 중간에 멈췄습니다. 이어서 요청하거나 설정에서 최대 출력 토큰을 늘리세요.')
      else if (r.stopReason === 'max_steps') setNotice(`도구를 ${MAX_STEPS}번 호출한 뒤 멈췄습니다. 이어서 요청하세요.`)
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  async function clearAll() {
    if (busy) stop()
    if (messages.length) {
      const ok = await confirmDialog({ title: '대화 지우기', message: '이 문서에서 나눈 AI 대화를 이 브라우저에서 지웁니다.', confirmLabel: '지우기' })
      if (!ok) return
    }
    clearHistory(scope)
    undoRef.current = new Map()
    setMessages([])
    setError(null)
    setNotice('')
  }

  function undo(callId) {
    const fn = undoRef.current.get(callId)
    if (!fn) return
    try {
      fn()
    } catch (e) {
      setNotice(`되돌리지 못했습니다: ${e?.message || ''}`)
      return
    }
    undoRef.current.delete(callId)
    setMessages((prev) => {
      const next = prev.map((m) => (m.role === 'tool' && m.toolCallId === callId ? { ...m, ui: { ...m.ui, undone: true } } : m))
      persist(next)
      return next
    })
    bump((n) => n + 1)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const onScroll = (e) => {
    const el = e.currentTarget
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  if (!open) return null
  const needConnect = providers !== null && !connected.length
  const visible = messages.filter((m) => m.role !== 'tool')
  const keyIssue = error && (error.code === 'BAD_KEY' || error.code === 'NOT_CONNECTED' || LOCAL_ERROR_CODES.includes(error.code))
  const isLocal = isLocalProvider(providerId)
  const canSend = !busy && provider && (draft.trim() || images.length)

  return (
    <aside className="ai-panel" aria-label={title}>
      <header className="ai-panel__head">
        <Sparkles size={18} className="ai-panel__logo" />
        <h2>{title}</h2>
        <span className="ai-panel__tools">
          <button type="button" className="ai-iconbtn" onClick={clearAll} aria-label="대화 지우기" title="대화 지우기"><Eraser size={18} /></button>
          <button type="button" className="ai-iconbtn" onClick={() => setSettings(true)} aria-label="AI 모델 설정" title="AI 모델 설정"><Settings2 size={18} /></button>
          {onClose && <button type="button" className="ai-iconbtn" onClick={onClose} aria-label="닫기" title="닫기"><X size={18} /></button>}
        </span>
      </header>

      <div className="ai-panel__list" ref={listRef} onScroll={onScroll}>
        {providers === null && !loadError ? <p className="ai-empty">불러오는 중</p> : null}
        {loadError && <p className="ai-empty">{loadError}</p>}
        {needConnect && !loadError && (
          <div className="ai-connect">
            <p><b>AI를 연결하세요</b></p>
            <p>Claude, OpenAI, Gemini 중 쓰는 곳의 API 키를 연결하면 이 창에서 문서를 고치고 다듬을 수 있습니다. 비용은 내 계정으로 청구됩니다. ChatGPT 요금제를 쓰려면 내 컴퓨터의 연결 프로그램을 설치해 연결하세요.</p>
            <button type="button" className="ai-btn ai-btn--primary" onClick={() => setSettings(true)}>AI 연결하기</button>
          </div>
        )}
        {!needConnect && !visible.length && !loadError && providers !== null && (
          <p className="ai-empty">{canEdit === false ? '보기 권한이라 문서를 직접 고치지 않고 제안만 합니다.' : '문장을 고치거나 오타를 잡아 달라고 요청해 보세요.'}</p>
        )}
        {visible.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg--${m.role}`}>
            {m.role === 'user' ? (
              <div className="ai-bubble ai-bubble--user">
                {m.images?.length > 0 && <div className="ai-bubble__imgs">{m.images.map((u, k) => <img key={k} src={u} alt="첨부 이미지" />)}</div>}
                <span>{m.content}</span>
              </div>
            ) : (
              <>
                {m.content ? <div className="ai-bubble ai-bubble--ai"><Markdown text={m.content} /></div> : null}
                {(m.toolCalls || []).map((c) => (
                  <ToolCard key={c.id} call={c} result={results.get(c.id)} running={runningIds.has(c.id) || busy} undoable={undoRef.current.has(c.id)} undone={Boolean(results.get(c.id)?.ui?.undone)} onUndo={() => undo(c.id)} />
                ))}
              </>
            )}
          </div>
        ))}
        {busy && !runningIds.size && visible[visible.length - 1]?.role !== 'assistant' && <p className="ai-typing"><LoaderCircle size={14} className="ai-spin" />생각하는 중</p>}
        {error && (
          <div className="ai-error" role="alert">
            <TriangleAlert size={16} />
            <span>{error.message}</span>
            {(keyIssue || error.code === 'UNSAFE_URL') && <button type="button" className="ai-btn ai-btn--ghost ai-btn--sm" onClick={() => setSettings(true)}>설정 열기</button>}
            {error.code === 'PLAN_LIMIT' && <a className="ai-btn ai-btn--primary ai-btn--sm" href={USAGE_URL} target="_blank" rel="noopener noreferrer">사용량 관리</a>}
          </div>
        )}
        {notice && <p className="ai-notice" role="status">{notice}</p>}
      </div>

      <div className="ai-panel__foot">
        {quickActions.length > 0 && (
          <div className="ai-chips">
            {quickActions.map((q) => (
              <button key={q.label} type="button" className="ai-quick" disabled={busy || !provider} onClick={() => send(q.prompt)}>{q.label}</button>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="ai-thumbs">
            {images.map((u, k) => (
              <span key={k} className="ai-thumb"><img src={u} alt="첨부 이미지" /><button type="button" aria-label="이미지 빼기" onClick={() => setImages((p) => p.filter((_, j) => j !== k))}><X size={12} /></button></span>
            ))}
          </div>
        )}
        <div className="ai-input">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={provider ? placeholder : 'AI를 먼저 연결하세요'}
            disabled={!provider}
            aria-label="AI에게 보낼 메시지"
          />
          <button type="button" className="ai-iconbtn" onClick={() => fileRef.current?.click()} disabled={!provider || images.length >= 3} aria-label="이미지 첨부" title="이미지 첨부"><ImagePlus size={18} /></button>
          {busy ? (
            <button type="button" className="ai-send is-stop" onClick={stop} aria-label="중단" title="중단"><Square size={14} /></button>
          ) : (
            <button type="button" className="ai-send" onClick={() => send()} disabled={!canSend} aria-label="보내기" title="보내기 (Enter)"><ArrowUp size={18} /></button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </div>
        <div className="ai-switch">
          {provider ? (
            <>
              <select value={providerId} onChange={(e) => selectProvider(e.target.value)} aria-label="제공업체" disabled={busy}>
                {connected.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={model} onChange={(e) => selectModel(e.target.value)} aria-label="모델" disabled={busy}>
                {!models.some((m) => m.id === model) && <option value={model}>{model || '모델'}</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
              </select>
            </>
          ) : <span className="ai-switch__none">연결된 AI 없음</span>}
        </div>
        {isLocal && <p className="ai-privacy ai-privacy--plan">ChatGPT 요금제 사용 중 · <a href={USAGE_URL} target="_blank" rel="noopener noreferrer">사용량 관리</a></p>}
        <p className="ai-privacy">{isLocal ? '현재 문서 내용이 내 컴퓨터의 연결 프로그램을 거쳐 ChatGPT로 전송됩니다(우리 서버에는 저장되지 않습니다)' : '현재 문서 내용이 내가 연결한 AI 제공업체로 전송됩니다'}</p>
      </div>

      <AiSettingsDialog
        open={settings}
        onClose={() => setSettings(false)}
        initialProvider={providerId}
        onChanged={(list, id) => {
          setProviders(list)
          const p = list.find((x) => x.id === id)
          if (p?.connected) {
            const next = { provider: id, model: p.model || '' }
            setChoice(next)
            saveLastChoice(next)
            setError(null)
          }
        }}
      />
    </aside>
  )
}
