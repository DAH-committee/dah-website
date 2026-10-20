// AiSettingsDialog: "AI 모델" 연결 창. 제공업체·키·모델을 고르고 연결 테스트 후 저장한다.
// 키는 서버로만 보내고(저장은 서버가 암호화) 이 창은 저장된 키의 끝 4자리 힌트만 보여 준다. 크기는 고정이라 내용이 바뀌어도 창이 움직이지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, KeyRound, LoaderCircle, Trash2, X } from 'lucide-react'
import { confirmDialog } from '../common/AppDialog'
import { connectProvider, disconnectProvider, errorText, listModels, listProviders, loadLastChoice, saveLastChoice, testConnection } from './aiClient'
import LocalConnectorSection from './LocalConnectorSection'
import { isLocalProvider } from './localConnector'
import './ai.css'

const MANUAL = '__manual__'

export default function AiSettingsDialog({ open, onClose, initialProvider, onChanged }) {
  const [providers, setProviders] = useState(null)
  const [sel, setSel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [models, setModels] = useState([])
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState('') // '' | 'test' | 'save' | 'del'
  const [note, setNote] = useState({ kind: '', text: '' })
  const keyRef = useRef(null)
  const selRef = useRef('')
  const initialRef = useRef(initialProvider)
  initialRef.current = initialProvider
  const provider = providers?.find((p) => p.id === sel) || null

  const applyProvider = useCallback((list, id) => {
    const p = list.find((x) => x.id === id)
    selRef.current = id
    setSel(id)
    setApiKey('')
    setBaseUrl(p?.baseUrl || '')
    setModel(p?.model || '')
    setMaxTokens(p?.maxTokens ? String(p.maxTokens) : '')
    setModels([])
    setManual(false)
    setNote({ kind: '', text: '' })
    if (p?.connected) {
      listModels(id)
        .then((m) => {
          if (selRef.current === id && Array.isArray(m)) setModels(m)
        })
        .catch(() => {})
    }
  }, [])

  const reload = useCallback(async () => {
    const list = await listProviders()
    setProviders(list)
    return list
  }, [])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setProviders(null)
    listProviders()
      .then((list) => {
        if (!alive) return
        setProviders(list)
        const last = loadLastChoice().provider
        // ChatGPT 구독 OAuth를 먼저 제안한다. OpenAI API 키 연결은 별도 제공자로 유지한다.
        const pick = [last === 'chatgpt-local' ? last : null, 'chatgpt-local', initialRef.current, last, list.find((p) => p.connected && p.id !== 'mock')?.id, 'anthropic'].find((id) => id && list.some((p) => p.id === id))
        applyProvider(list, pick || list[0]?.id)
        setTimeout(() => keyRef.current?.focus(), 30)
      })
      .catch((e) => alive && setNote({ kind: 'err', text: errorText(e) }))
    return () => {
      alive = false
    }
  }, [open, applyProvider])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.app-dialog')) {
        e.stopPropagation()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const isLocal = isLocalProvider(sel)
  const connected = Boolean(provider?.connected)
  const noKey = provider?.id === 'mock'
  const typed = apiKey.trim()
  const urlOk = !provider?.needsBaseUrl || baseUrl.trim()
  const canTest = !busy && provider && urlOk && (noKey || typed || connected)
  const canSave = !busy && provider && urlOk && !noKey && (typed || connected)
  const tokensNum = maxTokens.trim() === '' ? null : Number(maxTokens)
  const tokensBad = tokensNum !== null && !(Number.isInteger(tokensNum) && tokensNum >= 16 && tokensNum <= 64000)

  async function onTest() {
    setBusy('test')
    setNote({ kind: '', text: '' })
    try {
      const r = await testConnection({ provider: sel, ...(typed ? { apiKey: typed } : {}), ...(provider.allowBaseUrl ? { baseUrl: baseUrl.trim() } : {}) })
      if (selRef.current !== sel) return
      setModels(r.models || [])
      if (!model && r.suggested) setModel(r.suggested)
      setNote({ kind: 'ok', text: r.unverified ? '연결했습니다. 이 서버는 모델 목록을 주지 않아 모델 이름을 직접 입력하세요.' : `연결을 확인했습니다. 모델 ${r.models?.length ?? 0}개를 불러왔습니다.` })
      if (r.unverified || !r.models?.length) setManual(true)
    } catch (e) {
      setNote({ kind: 'err', text: errorText(e) })
    } finally {
      setBusy('')
    }
  }

  async function onSave() {
    if (tokensBad) return setNote({ kind: 'err', text: '최대 출력 토큰은 16에서 64000 사이 숫자로 입력하세요.' })
    setBusy('save')
    setNote({ kind: '', text: '' })
    try {
      const r = await connectProvider(sel, { ...(typed ? { apiKey: typed } : {}), model: model.trim(), maxTokens: tokensNum, ...(provider.allowBaseUrl ? { baseUrl: baseUrl.trim() } : {}) })
      const list = await reload()
      if (selRef.current !== sel) return
      setApiKey('')
      setModel(r.model || model)
      if (r.models?.length) setModels(r.models)
      else if (!models.length) listModels(sel).then((m) => selRef.current === sel && setModels(m)).catch(() => {})
      setNote({ kind: 'ok', text: '저장했습니다.' })
      saveLastChoice({ provider: sel, model: r.model || model })
      onChanged?.(list, sel)
    } catch (e) {
      setNote({ kind: 'err', text: errorText(e) })
    } finally {
      setBusy('')
    }
  }

  async function onDisconnect() {
    const ok = await confirmDialog({ title: `${provider.name} 연결 끊기`, message: '서버에 저장된 키를 지웁니다. 다시 쓰려면 키를 새로 입력해야 합니다.', confirmLabel: '연결 끊기' })
    if (!ok) return
    setBusy('del')
    try {
      await disconnectProvider(sel)
      const list = await reload()
      applyProvider(list, sel)
      onChanged?.(list, sel)
      setNote({ kind: 'ok', text: '연결을 끊었습니다.' })
    } catch (e) {
      setNote({ kind: 'err', text: errorText(e) })
    } finally {
      setBusy('')
    }
  }

  const inList = models.some((m) => m.id === model)
  const showText = manual || !models.length || (Boolean(model) && !inList)

  return createPortal(
    <div className="ai-modal" role="presentation">
      <button type="button" className="ai-modal__backdrop" aria-label="닫기" tabIndex={-1} onClick={onClose} />
      <div className="ai-dialog" role="dialog" aria-modal="true" aria-label="AI 모델">
        <header className="ai-dialog__head">
          <h2>AI 모델</h2>
          <button type="button" className="ai-iconbtn" onClick={onClose} aria-label="닫기"><X size={20} /></button>
        </header>

        {!providers ? (
          <p className="ai-dialog__loading">{note.kind === 'err' ? note.text : '불러오는 중'}</p>
        ) : (
          <div className="ai-dialog__body">
            <div className="ai-row ai-row--top">
              <label className="ai-field ai-field--grow">
                <span>제공업체</span>
                <select value={sel} onChange={(e) => applyProvider(providers, e.target.value)} disabled={Boolean(busy)}>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.connected && p.id !== 'mock' ? ' (연결됨)' : ''}</option>)}
                </select>
              </label>
              <span className={`ai-chip${connected ? ' is-on' : ''}`}><i />{connected ? '연결됨' : '미연결'}</span>
            </div>

            {isLocal ? (
              <LocalConnectorSection
                onNote={setNote}
                onChanged={async () => {
                  const list = await reload()
                  onChanged?.(list, sel)
                }}
              />
            ) : (
              <>
            <p className="ai-help">
              {provider?.keyHelp}
              {provider?.keyUrl && (
                <> <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">키 받는 곳<ExternalLink size={13} /></a></>
              )}
            </p>

            {provider?.allowBaseUrl && (
              <label className="ai-field">
                <span>{provider.needsBaseUrl ? '주소 (https)' : '주소 (선택)'}</span>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.needsBaseUrl ? 'https://서버/v1' : '비워 두면 기본 주소'} autoComplete="off" spellCheck="false" />
              </label>
            )}

            {!noKey ? (
              <label className="ai-field">
                <span>API 키{connected && provider?.keyHint ? ` (저장됨 ${provider.keyHint})` : ''}</span>
                <span className="ai-field__input">
                  <KeyRound size={16} />
                  <input
                    ref={keyRef}
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={connected ? '새 키를 넣으면 바꿉니다' : '키를 붙여 넣으세요'}
                    autoComplete="off"
                    spellCheck="false"
                    data-1p-ignore="true"
                    data-lpignore="true"
                  />
                </span>
              </label>
            ) : null}

            <div className="ai-row">
              <label className="ai-field ai-field--grow">
                <span>모델</span>
                {!showText ? (
                  <select value={inList ? model : ''} onChange={(e) => (e.target.value === MANUAL ? setManual(true) : setModel(e.target.value))}>
                    {!model && <option value="">모델을 고르세요</option>}
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}</option>)}
                    <option value={MANUAL}>직접 입력…</option>
                  </select>
                ) : (
                  <span className="ai-field__input ai-field__input--plain">
                    <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={models.length ? '모델 이름' : '연결 테스트로 목록을 불러오거나 직접 입력'} autoComplete="off" spellCheck="false" />
                    {models.length > 0 && <button type="button" className="ai-linkbtn" onClick={() => { setManual(false); if (!inList) setModel('') }}>목록</button>}
                  </span>
                )}
              </label>
              <label className="ai-field ai-field--tokens">
                <span>최대 출력 토큰</span>
                <input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="자동" />
              </label>
            </div>

              </>
            )}

            <p className={`ai-note${note.kind ? ` is-${note.kind}` : ''}`} role={note.kind === 'err' ? 'alert' : 'status'}>{note.text}</p>
          </div>
        )}

        <footer className="ai-dialog__foot">
          {isLocal ? <span /> : connected && !noKey ? (
            <button type="button" className="ai-btn ai-btn--ghost" onClick={onDisconnect} disabled={Boolean(busy)}><Trash2 size={16} />연결 끊기</button>
          ) : <span />}
          <span className="ai-dialog__actions">
            {isLocal ? <button type="button" className="ai-btn ai-btn--ghost" onClick={onClose}>닫기</button> : <button type="button" className="ai-btn ai-btn--ghost" onClick={onTest} disabled={!canTest}>{busy === 'test' ? <LoaderCircle size={16} className="ai-spin" /> : null}연결 테스트</button>}
            {!noKey && !isLocal && <button type="button" className="ai-btn ai-btn--primary" onClick={onSave} disabled={!canSave || tokensBad}>{busy === 'save' ? <LoaderCircle size={16} className="ai-spin" /> : null}저장</button>}
          </span>
        </footer>
      </div>
    </div>,
    document.body
  )
}
