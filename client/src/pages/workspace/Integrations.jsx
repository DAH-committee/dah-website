// /workspace/integrations: 연동. 피그마와 노션을 내 개인 토큰으로 연결한다.
// 토큰은 서버가 암호화해 보관하며 화면으로 다시 내려보내지 않는다. 연결하면 서버가 한 번 확인한 뒤 저장한다.
//   피그마: 슬라이드·보드에서 피그마 프레임을 이미지로 가져오고, 링크 미리보기에 파일 이름이 나온다.
//   노션: DAH Docs 홈의 "Notion에서 가져오기"로 페이지를 문서로 가져온다(연동에 공유한 페이지만).
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Link2, Plug, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../hooks/useApi'
import AccountMenu, { useMe } from '../../components/common/AccountMenu'
import NoAccess from '../../components/common/NoAccess'
import { confirmDialog } from '../../components/common/AppDialog'
import AiSettingsDialog from '../../components/ai/AiSettingsDialog'
import { listProviders } from '../../components/ai/aiClient'
import './workspace.css'
import './members.css'
import './mcpConnect.css'

const PROVIDERS = [
  {
    id: 'figma',
    name: 'Figma',
    lead: '피그마 프레임을 슬라이드와 보드에 이미지로 가져오고, 피그마 링크에 파일 이름과 썸네일을 보여 줍니다.',
    label: '개인 액세스 토큰',
    placeholder: 'figd_…',
    steps: [
      '피그마 설정의 보안 탭에서 개인 액세스 토큰을 새로 만듭니다.',
      '권한에서 파일 콘텐츠 읽기(file_content:read)를 켭니다. 사용자 정보 읽기(current_user:read)도 켜면 연결된 계정 이름이 표시됩니다.',
      '만든 토큰을 아래에 붙여 넣고 연결합니다.',
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    lead: '노션 페이지를 DAH Docs 문서로 가져옵니다. 연동에 공유한 페이지만 읽을 수 있습니다.',
    label: '내부 연동 토큰',
    placeholder: 'ntn_…',
    steps: [
      '노션 설정의 연결 메뉴에서 연동 개발 또는 관리로 이동해 내부 연동(Internal integration)을 만들고, 기능에서 콘텐츠 읽기를 켭니다.',
      '가져올 노션 페이지 오른쪽 위 ⋯ 메뉴의 연결에서 만든 연동을 추가합니다. 연동에 공유되지 않은 페이지는 읽을 수 없습니다.',
      '연동의 토큰을 아래에 붙여 넣고 연결합니다.',
    ],
  },
]

const errText = (e) => (e?.hint ? `${e.message} (${e.hint})` : e?.message || '처리하지 못했습니다')

function Card({ spec, state, onChanged }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connected = Boolean(state?.connected)
  const who = [state?.meta?.name, state?.meta?.workspace].filter(Boolean).join(' · ')

  async function connect(e) {
    e.preventDefault()
    if (!token.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api.put(`/integrations/connections/${spec.id}`, { token: token.trim() })
      setToken('')
      await onChanged()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }
  async function disconnect() {
    if (!(await confirmDialog({ title: `${spec.name} 연결 끊기`, message: `서버에 저장된 ${spec.name} 토큰을 지웁니다. 다시 쓰려면 토큰을 새로 연결해야 합니다.`, confirmLabel: '연결 끊기' }))) return
    setBusy(true)
    setError('')
    try {
      await api.del(`/integrations/connections/${spec.id}`)
      await onChanged()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ig-card" aria-label={spec.name}>
      <div className="ig-card__head">
        <h2>{spec.name}</h2>
        <span className={`ig-status${connected ? ' is-on' : ''}`}><i />{connected ? `연결됨${who ? ` · ${who}` : ''}` : '연결되지 않음'}</span>
      </div>
      <p className="ig-lead">{spec.lead}</p>
      {!connected && (
        <ol className="ig-steps">
          {spec.steps.map((t) => <li key={t}>{t}</li>)}
        </ol>
      )}
      {error && <p className="ws-error" role="alert">{error}</p>}
      <form className="ig-form" onSubmit={connect}>
        <label className="mb-field mb-field--wide">
          <span>{connected ? `${spec.label} 바꾸기` : spec.label}</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={spec.placeholder}
            autoComplete="off"
            spellCheck="false"
            data-1p-ignore="true"
            data-lpignore="true"
          />
        </label>
        <button type="submit" className="mb-pill ig-btn" disabled={busy || !token.trim()}><Link2 size={16} />{connected ? '다시 연결' : '연결'}</button>
        {connected && <button type="button" className="mb-ghost ig-btn" onClick={disconnect} disabled={busy}><Trash2 size={16} />연결 끊기</button>}
      </form>
    </section>
  )
}

// AI 모델: 문서·발표·보드 옆 AI 창이 쓰는 내 AI 계정(API 키). 연결과 모델 선택은 같은 설정 창(AiSettingsDialog)에서 한다.
function AiCard() {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(false)
  const load = useCallback(() => listProviders().then(setList).catch(() => setList([])), [])
  useEffect(() => {
    load()
  }, [load])
  const on = (list || []).filter((p) => p.connected && p.id !== 'mock')
  return (
    <section className="ig-card" aria-label="AI 모델">
      <div className="ig-card__head">
        <h2>AI 모델</h2>
        <span className={`ig-status${on.length ? ' is-on' : ''}`}><i />{on.length ? `연결됨 · ${on.length}곳` : '연결되지 않음'}</span>
      </div>
      <p className="ig-lead">문서·시트·발표·보드 AI는 내 ChatGPT 구독 OAuth 연결 또는 Claude·OpenAI·Gemini API 키를 사용할 수 있습니다. ChatGPT 구독 연결은 내 컴퓨터의 연결 프로그램에서 로그인하고, API 키는 각 제공업체가 별도로 청구합니다.</p>
      {on.length > 0 && (
        <ul className="ai-connected">
          {on.map((p) => <li key={p.id}><b>{p.name}</b><span>{p.model || '모델 미지정'}</span></li>)}
        </ul>
      )}
      <div className="ig-form">
        <button type="button" className="mb-pill ig-btn" onClick={() => setOpen(true)}><Sparkles size={16} />AI 모델 설정</button>
      </div>
      <AiSettingsDialog open={open} onClose={() => setOpen(false)} onChanged={(l) => setList(l)} />
    </section>
  )
}

// AI 앱 연결(MCP): 내 Claude, ChatGPT, Codex, Gemini CLI 같은 AI 앱이 이 워크스페이스에 접속해 파일을 읽고 고치게 한다.
// 사용 요금은 내 AI 구독이 내고, 이 서비스는 AI 계정 정보를 받지 않는다(앱이 이 서비스로 접속한다).
const MCP_APPS = [
  {
    id: 'claude',
    name: 'Claude (웹, 데스크톱, 모바일)',
    steps: [
      'Claude의 Customize > Connectors 로 이동합니다.',
      '+ Add > Add custom connector 를 누릅니다. Team, Enterprise 요금제는 소유자가 조직 설정 > Connectors 에서 Add > Custom > Web 으로 먼저 추가해야 합니다.',
      '이름에 "디인예 워크스페이스", 주소에 위 커넥터 주소를 붙여 넣고 Continue 를 누릅니다.',
      'Authentication 은 Sign in now, OAuth client 는 기본값(Claude’s published identity)으로 두고 Add 를 누릅니다.',
      '열리는 창에서 구글 계정으로 로그인하고 허용을 누릅니다. 대화창의 + > Connectors 에서 커넥터를 켭니다.',
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    code: 'claude mcp add --transport http dah {URL}',
    steps: ['터미널에서 위 명령을 실행합니다.', 'Claude Code 안에서 /mcp 를 열어 dah 를 고르고 인증(Authenticate)을 눌러 구글 로그인과 허용을 마칩니다.'],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    steps: [
      'ChatGPT 웹에서 개발자 모드(developer mode)를 켭니다. Business, Enterprise/Edu 요금제는 관리자가 워크스페이스 설정에서 켭니다.',
      '설정의 Apps > Create 에서 이름과 위 커넥터 주소를 넣고, 인증은 OAuth 로 고릅니다.',
      '열리는 창에서 구글 로그인 후 허용을 누릅니다.',
      'Pro 요금제는 읽기 권한(read/fetch)만 연결할 수 있다고 안내되어 있어, 파일을 고치는 도구는 쓰지 못할 수 있습니다.',
    ],
  },
  {
    id: 'codex',
    name: 'Codex (CLI, ChatGPT 데스크톱 앱)',
    code: 'codex mcp add dah --url {URL}\ncodex mcp login dah',
    steps: ['터미널에서 위 두 줄을 차례로 실행합니다. 열리는 브라우저에서 구글 로그인 후 허용을 누릅니다.', 'ChatGPT 데스크톱 앱은 설정 > MCP servers > Add server 에서 Streamable HTTP 로 주소를 넣고 Authenticate 를 누릅니다.'],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    code: 'gemini mcp add --scope user --transport http dah {URL}',
    steps: ['터미널에서 위 명령을 실행합니다.', 'Gemini CLI 안에서 /mcp auth dah 를 실행해 구글 로그인과 허용을 마칩니다.'],
  },
]

const ago = (t) => {
  if (!t) return '아직 쓰지 않음'
  const s = Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 1000))
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`
  return new Date(t).toLocaleDateString('ko-KR')
}

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      /* 클립보드를 쓸 수 없는 환경 */
    }
  }
  return (
    <button type="button" className="mb-ghost ig-btn mcp-copy" onClick={copy} aria-label={label}>
      {done ? <Check size={16} /> : <Copy size={16} />}
      {done ? '복사됨' : '복사'}
    </button>
  )
}

function McpCard() {
  const [info, setInfo] = useState(null)
  const [items, setItems] = useState(null)
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const [i, c, a] = await Promise.all([api.get('/mcp/info'), api.get('/mcp/connections'), api.get('/mcp/audit', { limit: 8 })])
      setInfo(i)
      setItems(c.items || [])
      setLog(a.items || [])
    } catch (e) {
      setItems([])
      setError(errText(e))
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  const url = info?.url || `${window.location.origin}/mcp`

  async function revoke(it) {
    if (!(await confirmDialog({ title: `${it.name} 연결 해제`, message: '이 AI 앱은 더 이상 내 파일을 읽거나 고칠 수 없습니다. 다시 쓰려면 앱에서 연결을 새로 해야 합니다.', confirmLabel: '해제' }))) return
    setBusy(it.id)
    setError('')
    try {
      await api.del(`/mcp/connections/${it.id}`)
      await load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="ig-card ig-card--wide" aria-label="AI 앱 연결(MCP)">
      <div className="ig-card__head">
        <h2>AI 앱 연결(MCP)</h2>
        <span className={`ig-status${items?.length ? ' is-on' : ''}`}><i />{items?.length ? `연결됨 · ${items.length}곳` : '연결되지 않음'}</span>
      </div>
      <p className="ig-lead">내가 쓰는 Claude, ChatGPT, Codex, Gemini CLI 같은 AI 앱에서 이 워크스페이스의 문서, 시트, 발표, 보드, 설문을 읽고 고치게 합니다. 사용 요금은 각 AI 앱의 내 구독이 내며, 이 서비스는 AI 계정 정보를 받지 않습니다. 앱은 내가 열 수 있는 파일만 다루고, 공유 설정 변경과 영구 삭제는 할 수 없습니다.</p>
      <div className="mcp-url">
        <div><span className="mcp-url__label">커넥터 주소</span><code>{url}</code></div>
        <CopyBtn text={url} label="커넥터 주소 복사" />
      </div>
      <p className="ig-lead">파일을 고치려면 그 파일의 편집기 탭을 열어 두어야 합니다. AI 앱이 일을 시키면 열려 있는 탭이 실행하고, 탭 위쪽에 "외부 AI 연결 중" 표시가 나옵니다. 읽기는 탭 없이도 됩니다.</p>
      {error && <p className="ws-error" role="alert">{error}</p>}
      {items === null ? (
        <p className="ws-empty">불러오는 중</p>
      ) : (
        <>
          <h3 className="mcp-h">연결된 AI 앱</h3>
          {items.length === 0 ? (
            <p className="ig-lead">아직 연결된 앱이 없습니다. 아래 방법으로 앱에서 연결하면 여기에 나타납니다.</p>
          ) : (
            <ul className="mcp-apps">
              {items.map((it) => (
                <li key={it.id}>
                  <span className="mcp-apps__main"><b>{it.name}</b><small>{it.host ? `${it.host} · ` : ''}{it.can_write ? '읽기와 수정' : '읽기만'} · 마지막 사용 {ago(it.last_used_at)}</small></span>
                  <button type="button" className="mb-ghost ig-btn" disabled={busy === it.id} onClick={() => revoke(it)}><Trash2 size={16} />해제</button>
                </li>
              ))}
            </ul>
          )}
          {log.length > 0 && (
            <details className="mcp-log">
              <summary>최근 활동 {log.length}건</summary>
              <ul>
                {log.map((r, i) => <li key={i}><span>{new Date(r.at).toLocaleString('ko-KR')}</span><span>{r.client_name || '앱'}</span><code>{r.tool}</code><span>{r.ok ? '성공' : '실패'}</span></li>)}
              </ul>
              <small>도구 이름과 시각만 기록하며 파일 내용은 저장하지 않습니다.</small>
            </details>
          )}
        </>
      )}
      <h3 className="mcp-h">연결 방법</h3>
      <div className="mcp-guides">
        {MCP_APPS.map((a) => (
          <details key={a.id} className="mcp-guide">
            <summary><Plug size={16} />{a.name}</summary>
            {a.code && (
              <div className="mcp-code">
                <pre>{a.code.replaceAll('{URL}', url)}</pre>
                <CopyBtn text={a.code.replaceAll('{URL}', url)} label={`${a.name} 명령 복사`} />
              </div>
            )}
            <ol className="ig-steps">{a.steps.map((t) => <li key={t}>{t}</li>)}</ol>
          </details>
        ))}
      </div>
      <p className="mcp-foot">메뉴 이름은 각 앱의 공식 안내(2026년 10월 확인)를 따릅니다. 앱이 업데이트되면 이름이 바뀔 수 있습니다.</p>
    </section>
  )
}

export default function Integrations() {
  const { me } = useMe()
  const [items, setItems] = useState(null)
  const [secure, setSecure] = useState(true)
  const [error, setError] = useState('')
  const signedIn = Boolean(me?.user)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/integrations/connections')
      setItems(r.items || [])
      setSecure(r.secure_storage !== false)
    } catch (e) {
      setItems([])
      setError(errText(e))
    }
  }, [])
  useEffect(() => {
    document.title = '연동 | 디인예 워크스페이스'
  }, [])
  useEffect(() => {
    if (signedIn) load()
  }, [signedIn, load])

  if (!me) return null
  if (!signedIn) return <NoAccess kind="doc" message="연동을 연결하려면 구글 계정으로 로그인하세요." />

  const by = Object.fromEntries((items || []).map((x) => [x.provider, x]))
  return (
    <div className="ws">
      <header className="ws-top">
        <Link to="/workspace/docs" className="ws-iconbtn ws-iconbtn--lg" aria-label="워크스페이스로"><ArrowLeft size={24} /></Link>
        <span className="ws-brand"><Link2 size={32} /><span>연동</span></span>
        <span className="ws-top__right"><AccountMenu size={40} /></span>
      </header>
      <section className="ws-band">
        <div className="ws-wrap ig">
          <p className="ig-intro">연결한 토큰은 내 계정에만 쓰이고 서버에 암호화해 저장됩니다. 화면에는 다시 보여 주지 않으며, 언제든 연결을 끊을 수 있습니다.</p>
          {!secure && <p className="ws-error" role="alert">서버에 토큰을 안전하게 보관할 설정이 없어 지금은 연결할 수 없습니다. 관리자에게 알려 주세요.</p>}
          {error && <p className="ws-error" role="alert">{error}</p>}
          {items === null ? (
            <p className="ws-empty">불러오는 중</p>
          ) : (
            <div className="ig-grid">
              {PROVIDERS.map((p) => <Card key={p.id} spec={p} state={by[p.id]} onChanged={load} />)}
              <AiCard />
              <McpCard />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
