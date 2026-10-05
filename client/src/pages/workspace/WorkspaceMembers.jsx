// /workspace/members: DAH Docs·Sheet·Form 운영위원회 구성원 관리(사이트 관리자 전용).
// 사이트 계정과 별개로 구글 이메일을 등록하면, 그 이메일로 구글 로그인한 사람은 작업공간에서
// "운영위원회 및 교수진" 권한(운영위원회 공유 파일 열람, 삭제, 비공개 전환)을 얻는다. 사이트 관리 대시보드 권한은 없다.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { api } from '../../hooks/useApi'
import AccountMenu, { Avatar, useMe } from '../../components/common/AccountMenu'
import NoAccess from '../../components/common/NoAccess'
import { alertDialog, confirmDialog, promptDialog } from '../../components/common/AppDialog'
import './workspace.css'
import './members.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLE = { owner: '오너', admin: '관리자', manager: '운영위원회 및 교수진' }
const when = (v) => (v ? new Date(v).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export default function WorkspaceMembers() {
  const { me } = useMe()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [emails, setEmails] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { document.title = '운영위원회 구성원 | 디지털인문예술전공' }, [])

  const load = useCallback(async () => {
    try {
      setData(await api.get('/workspace/members'))
      setError('')
    } catch (e) {
      setError(e.hint || e.message)
    }
  }, [])
  useEffect(() => { if (me?.admin) load() }, [me?.admin, load])

  if (!me) return null
  if (!me.admin) return <NoAccess kind="doc" message="운영위원회 구성원 관리는 사이트 관리자(관리자·오너) 계정만 열 수 있습니다." />

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      setData(await fn())
      return true
    } catch (e) {
      setError(e.hint ? `${e.message} (${e.hint})` : e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (e) => {
    e?.preventDefault()
    const list = [...new Set(emails.split(/[\s,;]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))]
    if (!list.length) return setError('이메일을 입력하세요')
    const bad = list.filter((v) => !EMAIL_RE.test(v))
    if (bad.length) return setError(`이메일 형식이 아닙니다: ${bad.join(', ')}`)
    if (await run(() => api.post('/workspace/members', { emails: list, name: list.length === 1 ? name : '', note }))) {
      setEmails('')
      setName('')
      setNote('')
    }
  }
  const quickAdd = (p) => run(() => api.post('/workspace/members', { emails: [p.email], name: p.name || '' }))
  const edit = async (m) => {
    const nm = await promptDialog({ title: '이름 바꾸기', label: '이름', defaultValue: m.name || m.google_name || '', confirmLabel: '저장' })
    if (nm === null || nm === undefined) return
    const nt = await promptDialog({ title: '메모', label: '역할·기수 등 (비워 두어도 됩니다)', defaultValue: m.note || '', confirmLabel: '저장' })
    if (nt === null || nt === undefined) return
    run(() => api.put(`/workspace/members/${m.id}`, { name: nm, note: nt }))
  }
  const remove = async (m) => {
    if (!(await confirmDialog({ title: '구성원 삭제', message: `${m.email}을(를) 운영위원회 구성원에서 뺄까요? 이 사람이 만든 파일과 이메일로 공유받은 파일은 그대로 열 수 있습니다.`, confirmLabel: '삭제' }))) return
    run(() => api.del(`/workspace/members/${m.id}`))
  }
  const help = () =>
    alertDialog({
      title: '운영위원회 구성원',
      message:
        '여기에 등록한 구글 이메일로 로그인한 사람은 DAH Docs·Sheet·Form에서 운영위원회 및 교수진과 같은 권한을 받습니다.\n- "운영위원회 및 교수진" 공유 파일 열람·편집\n- 파일 삭제, 비공개 전환\n사이트 관리 대시보드에는 들어갈 수 없습니다. 대시보드 계정은 관리 대시보드의 계정 관리에서 만듭니다.',
    })

  return (
    <div className="ws">
      <header className="ws-top">
        <Link to="/workspace/docs" className="ws-iconbtn ws-iconbtn--lg" aria-label="작업공간으로"><ArrowLeft size={24} /></Link>
        <span className="ws-brand"><UsersRound size={32} color="#7a3cff" /><span>운영위원회 구성원</span></span>
        <span className="ws-top__right"><AccountMenu size={40} /></span>
      </header>

      <section className="ws-band">
        <div className="ws-wrap">
          <form className="mb-add" onSubmit={add}>
            <div className="mb-add__head">
              <h2>구성원 추가</h2>
              <button type="button" className="mb-link" onClick={help}>권한 안내</button>
            </div>
            <div className="mb-add__row">
              <label className="mb-field mb-field--wide">
                <span>구글 이메일 (여러 개는 쉼표나 줄바꿈으로)</span>
                <textarea rows={1} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@gmail.com" autoComplete="off" data-1p-ignore="true" data-lpignore="true" />
              </label>
              <label className="mb-field">
                <span>이름</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="한 명일 때만" autoComplete="off" data-1p-ignore="true" />
              </label>
              <label className="mb-field">
                <span>메모</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 2027 운영위원" autoComplete="off" data-1p-ignore="true" />
              </label>
              <button type="submit" className="gbtn mb-add__btn" disabled={busy}><UserPlus size={18} /> 추가</button>
            </div>
            {error && <p className="ws-error" role="alert">{error}</p>}
          </form>
        </div>
      </section>

      <section className="ws-recent">
        <div className="ws-wrap">
          <div className="ws-recent__head"><h2>등록된 구성원 {data ? data.members.length : ''}</h2></div>
          {!data ? (
            <p className="ws-empty">불러오는 중</p>
          ) : data.members.length === 0 ? (
            <p className="ws-empty">아직 등록된 구성원이 없습니다. 위에서 구글 이메일을 추가하세요.</p>
          ) : (
            <div className="mb-list">
              {data.members.map((m) => (
                <div key={m.id} className="mb-row">
                  <Avatar name={m.name || m.google_name || m.email} picture={m.picture} size={40} />
                  <span className="mb-who"><b>{m.name || m.google_name || m.email}</b><small>{m.email}</small></span>
                  <span className="mb-note">{m.note || ''}</span>
                  <span className="mb-meta">{m.last_login_at ? `최근 로그인 ${when(m.last_login_at)}` : '아직 로그인 안 함'}</span>
                  <span className="mb-acts">
                    <button type="button" className="ws-iconbtn" aria-label="이름·메모 바꾸기" title="이름·메모 바꾸기" onClick={() => edit(m)}><Pencil size={18} /></button>
                    <button type="button" className="ws-iconbtn" aria-label="삭제" title="구성원에서 빼기" onClick={() => remove(m)}><Trash2 size={18} /></button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {data && data.recent.length > 0 && (
            <>
              <div className="ws-recent__head"><h2>최근 로그인한 구글 계정</h2></div>
              <div className="mb-list">
                {data.recent.map((p) => (
                  <div key={p.email} className="mb-row">
                    <Avatar name={p.name || p.email} picture={p.picture} size={40} />
                    <span className="mb-who"><b>{p.name || p.email}</b><small>{p.email}</small></span>
                    <span className="mb-note" />
                    <span className="mb-meta">{p.last_login_at ? when(p.last_login_at) : ''}</span>
                    <span className="mb-acts"><button type="button" className="mb-pill" disabled={busy} onClick={() => quickAdd(p)}>구성원으로 등록</button></span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data && (
            <>
              <div className="ws-recent__head"><h2>사이트 계정 (자동으로 운영위원회 및 교수진)</h2></div>
              <div className="mb-list">
                {data.staff.map((u) => (
                  <div key={u.id} className="mb-row">
                    <Avatar name={u.name} picture={u.picture} size={40} />
                    <span className="mb-who"><b>{u.name}</b><small>{u.email}</small></span>
                    <span className="mb-note">{ROLE[u.role] || u.role}</span>
                    <span className="mb-meta" />
                    <span className="mb-acts" />
                  </div>
                ))}
              </div>
              <p className="ws-empty" style={{ paddingTop: 16 }}>사이트 계정은 <Link to="/admin" className="mb-link">관리 대시보드</Link>에서 관리합니다.</p>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
