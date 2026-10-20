// LocalConnectorSection: AI 모델 연결 창에서 "내 컴퓨터의 ChatGPT 연결"을 고르면 보이는 부분.
// 연결 프로그램(DAH Connect)의 상태 확인, 연결 코드 입력, 모델 고르기. 창 크기는 그대로 두고 이 영역 안에서만 바뀐다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { confirmDialog } from '../common/AppDialog'
import { CONNECTOR_DOWNLOAD_URL, USAGE_URL, getLocalStatus, listLocalModels, loadLocalModel, pairWithCode, saveLocalModel, unpair } from './localConnector'
import { saveLastChoice } from './aiClient'

const STATE_TEXT = {
  searching: ['확인하는 중', '내 컴퓨터의 연결 프로그램을 찾고 있습니다.'],
  not_running: ['프로그램이 켜져 있지 않음', '"연결 프로그램 시작"을 실행해 두세요. 브라우저가 "내 컴퓨터의 앱 접근"을 물으면 허용하세요.'],
  not_paired: ['연결 코드 필요', '연결 프로그램 창에 나온 6자리 코드를 아래에 입력하세요.'],
  bad_pair: ['연결 코드 다시 필요', '이 브라우저의 연결 정보가 프로그램과 맞지 않습니다. 새 코드를 입력하세요(프로그램 창에서 Enter).'],
  not_logged_in: ['ChatGPT 로그인 필요', '연결 프로그램 창에서 ChatGPT 로그인을 마치세요.'],
  reconnect: ['ChatGPT 다시 로그인 필요', '로그인이 끊겼습니다. 연결 프로그램에서 다시 로그인하세요.'],
  plan_disabled: ['요금제 사용 허용 필요', '로그인은 되었지만 요금제 사용을 허용하지 않았습니다. 연결 프로그램에서 다시 로그인해 허용하세요.'],
  ready: ['준비됨', '내 ChatGPT 요금제로 AI 요청을 보냅니다.'],
}

export default function LocalConnectorSection({ onChanged, onNote }) {
  const [status, setStatus] = useState({ state: 'searching' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState('') // '' | 'check' | 'pair' | 'del'
  const [models, setModels] = useState([])
  const [model, setModel] = useState(() => loadLocalModel())
  const alive = useRef(true)

  const check = useCallback(async () => {
    setBusy('check')
    setStatus((s) => (s.state === 'ready' ? s : { state: 'searching' }))
    const st = await getLocalStatus()
    if (!alive.current) return
    setStatus(st)
    if (st.state === 'ready') {
      try {
        const m = await listLocalModels()
        if (!alive.current) return
        setModels(m)
        const saved = loadLocalModel()
        const pick = m.some((x) => x.id === saved) ? saved : m[0]?.id || ''
        setModel(pick)
        if (pick && pick !== saved) saveLocalModel(pick)
      } catch (e) {
        onNote?.({ kind: 'err', text: e?.message || '모델 목록을 가져오지 못했습니다.' })
      }
    } else setModels([])
    setBusy('')
  }, [onNote])

  useEffect(() => {
    alive.current = true
    check()
    return () => {
      alive.current = false
    }
  }, [check])

  async function onPair() {
    setBusy('pair')
    onNote?.({ kind: '', text: '' })
    try {
      await pairWithCode(code, { port: status.port })
      setCode('')
      onNote?.({ kind: 'ok', text: '연결했습니다.' })
      await onChanged?.()
      await check()
    } catch (e) {
      onNote?.({ kind: 'err', text: e?.message || '연결하지 못했습니다.' })
      setBusy('')
    }
  }

  async function onUnpair() {
    const ok = await confirmDialog({ title: '연결 끊기', message: '이 브라우저와 연결 프로그램의 짝짓기를 지웁니다. ChatGPT 로그인은 연결 프로그램에 그대로 남습니다.', confirmLabel: '연결 끊기' })
    if (!ok) return
    setBusy('del')
    await unpair()
    setStatus({ state: 'not_paired', port: status.port })
    setModels([])
    onNote?.({ kind: 'ok', text: '연결을 끊었습니다.' })
    await onChanged?.()
    setBusy('')
  }

  const pickModel = (id) => {
    setModel(id)
    saveLocalModel(id)
    saveLastChoice({ provider: 'chatgpt-local', model: id })
    onChanged?.()
  }

  const [label, detail] = STATE_TEXT[status.state] || STATE_TEXT.not_running
  const needsCode = status.state === 'not_paired' || status.state === 'bad_pair'
  const paired = ['ready', 'not_logged_in', 'reconnect', 'plan_disabled'].includes(status.state)

  return (
    <div className="ai-local">
      <ol className="ai-local__steps">
        <li>
          연결 프로그램을 받아 실행합니다.{' '}
          <a href={CONNECTOR_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">받는 곳 / 설치 안내<ExternalLink size={13} /></a>
        </li>
        <li>열린 창에서 ChatGPT에 로그인하고 요금제 사용을 허용합니다.</li>
        <li>창에 나온 6자리 연결 코드를 여기에 입력합니다.</li>
      </ol>

      <div className="ai-local__status" role="status">
        <span className="ai-local__state"><b>{label}</b>{status.account?.email ? <span> {status.account.email}</span> : null}</span>
        <span className="ai-local__detail">{status.message || detail}</span>
        <button type="button" className="ai-iconbtn" onClick={check} disabled={Boolean(busy)} aria-label="다시 확인" title="다시 확인">
          {busy === 'check' ? <LoaderCircle size={18} className="ai-spin" /> : <RefreshCw size={18} />}
        </button>
      </div>

      {needsCode && (
        <div className="ai-row">
          <label className="ai-field ai-field--grow">
            <span>연결 코드 (6자리)</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && !busy && onPair()} inputMode="numeric" placeholder="000000" autoComplete="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" />
          </label>
          <button type="button" className="ai-btn ai-btn--primary ai-local__pairbtn" onClick={onPair} disabled={code.length !== 6 || Boolean(busy)}>
            {busy === 'pair' ? <LoaderCircle size={16} className="ai-spin" /> : null}연결
          </button>
        </div>
      )}

      {status.state === 'ready' && (
        <label className="ai-field">
          <span>모델 (내 계정에서 쓸 수 있는 것)</span>
          <select value={models.some((m) => m.id === model) ? model : ''} onChange={(e) => pickModel(e.target.value)}>
            {!model && <option value="">모델을 고르세요</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}</option>)}
          </select>
        </label>
      )}

      <p className="ai-help">
        요청은 내 ChatGPT 요금제(또는 크레딧) 사용량으로 계산됩니다. Plus는 5시간 한도를 다른 앱과 함께 씁니다.{' '}
        <a href={USAGE_URL} target="_blank" rel="noopener noreferrer">사용량 관리<ExternalLink size={13} /></a>
      </p>
      <p className="ai-help">
        이 방식에서는 최대 출력 토큰과 온도 설정을 쓰지 않습니다. 이미지와 도구는 고른 모델이 지원할 때만 됩니다. 문서 내용은 내 컴퓨터를 거쳐 ChatGPT로 가고 우리 서버에는 저장되지 않습니다.
      </p>

      {paired && (
        <div className="ai-local__foot">
          <button type="button" className="ai-btn ai-btn--ghost" onClick={onUnpair} disabled={Boolean(busy)}><Trash2 size={16} />이 브라우저 연결 끊기</button>
        </div>
      )}
    </div>
  )
}
