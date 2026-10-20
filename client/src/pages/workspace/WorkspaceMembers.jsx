// /workspace/members: 팀 관리. 내가 속한 팀 목록, 팀 만들기, 팀 상세(팀원, 역할, 추가·빼기, 나가기, 팀 삭제).
// 누구나 팀을 만들 수 있고 만든 사람이 팀 오너가 된다. 팀원 추가는 구글 이메일로 한다(메일은 보내지 않는다.
// 그 이메일로 로그인하면 바로 팀원이다). 팀원 관리·이름 바꾸기·팀 삭제는 팀 오너만, 나가기는 누구나.
// ?team=<id> 로 특정 팀을 연다.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Crown, FolderOpen, LogOut, Pencil, Plus, Trash2, UserMinus, UserPlus, UsersRound } from 'lucide-react'
import { api } from '../../hooks/useApi'
import AccountMenu, { Avatar, useMe } from '../../components/common/AccountMenu'
import NoAccess from '../../components/common/NoAccess'
import { confirmDialog, promptDialog } from '../../components/common/AppDialog'
import './workspace.css'
import './members.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLE = { owner: '팀 오너', member: '팀원' }
const splitEmails = (v) => [...new Set(String(v || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))]
const errText = (e) => (e?.hint ? `${e.message} (${e.hint})` : e?.message || '처리하지 못했습니다')

export default function WorkspaceMembers() {
  const { me } = useMe()
  const [params, setParams] = useSearchParams()
  const selected = Number(params.get('team')) || null
  const [teams, setTeams] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [invite, setInvite] = useState('')
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState('member')
  const signedIn = Boolean(me?.user)
  const myEmail = String(me?.user?.email || '').toLowerCase()

  useEffect(() => {
    document.title = `${detail?.team?.name ? `${detail.team.name} · ` : ''}팀 관리 | 디인예 워크스페이스`
  }, [detail])

  const select = useCallback((id, replace = false) => {
    const next = new URLSearchParams(params)
    if (id) next.set('team', String(id))
    else next.delete('team')
    setParams(next, { replace })
  }, [params, setParams])

  const loadTeams = useCallback(async () => {
    try {
      const r = await api.get('/workspace/teams')
      setTeams(r.items || [])
      return r.items || []
    } catch (e) {
      setError(errText(e))
      setTeams([])
      return []
    }
  }, [])
  useEffect(() => { if (signedIn) loadTeams() }, [signedIn, loadTeams])

  // 팀을 고르지 않았으면 첫 팀을 연다
  useEffect(() => {
    if (!teams) return
    if (!selected && teams.length) select(teams[0].id, true)
    else if (selected && !teams.some((t) => t.id === selected)) select(teams[0]?.id || null, true)
  }, [teams, selected, select])

  useEffect(() => {
    if (!selected || !teams?.some((t) => t.id === selected)) { setDetail(null); return }
    let alive = true
    api.get(`/workspace/teams/${selected}`).then((r) => alive && setDetail(r)).catch((e) => alive && setError(errText(e)))
    return () => { alive = false }
  }, [selected, teams])

  if (!me) return null
  if (!signedIn) return <NoAccess kind="doc" message="팀을 만들고 관리하려면 구글 계정으로 로그인하세요." />

  const run = async (fn, after) => {
    setBusy(true)
    setError('')
    try {
      const r = await fn()
      if (r?.team) setDetail(r)
      await loadTeams()
      after?.(r)
      return r
    } catch (e) {
      setError(errText(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const create = async (e) => {
    e?.preventDefault()
    if (!name.trim()) return setError('팀 이름을 입력하세요')
    const list = splitEmails(invite)
    const bad = list.filter((v) => !EMAIL_RE.test(v))
    if (bad.length) return setError(`이메일 형식이 아닙니다: ${bad.join(', ')}`)
    await run(() => api.post('/workspace/teams', { name: name.trim(), description: desc.trim(), emails: list }), (r) => {
      setName('')
      setDesc('')
      setInvite('')
      if (r?.team) select(r.team.id)
    })
  }

  const team = detail?.team
  const isOwner = team?.my_role === 'owner'
  const add = async (e) => {
    e?.preventDefault()
    const list = splitEmails(emails)
    if (!list.length) return setError('추가할 이메일을 입력하세요')
    const bad = list.filter((v) => !EMAIL_RE.test(v))
    if (bad.length) return setError(`이메일 형식이 아닙니다: ${bad.join(', ')}`)
    await run(() => api.post(`/workspace/teams/${team.id}/members`, { emails: list, role }), () => setEmails(''))
  }
  const rename = async () => {
    const v = await promptDialog({ title: '팀 이름 바꾸기', label: '팀 이름', defaultValue: team.name, confirmLabel: '저장' })
    if (!v || !v.trim() || v.trim() === team.name) return
    run(() => api.put(`/workspace/teams/${team.id}`, { name: v.trim() }))
  }
  const editDesc = async () => {
    const v = await promptDialog({ title: '팀 설명', label: '설명 (비워 두어도 됩니다)', defaultValue: team.description || '', confirmLabel: '저장', multiline: true })
    if (v === null || v === undefined) return
    run(() => api.put(`/workspace/teams/${team.id}`, { description: v }))
  }
  const setMemberRole = (m, next) => run(() => api.put(`/workspace/teams/${team.id}/members/${encodeURIComponent(m.email)}`, { role: next }))
  const removeMember = async (m) => {
    if (!(await confirmDialog({ title: '팀원 빼기', message: `${m.name || m.email}을(를) ${team.name} 팀에서 뺄까요? 이 사람이 만든 팀 파일은 그대로 남고, 팀 액세스로만 열던 파일은 더 이상 열 수 없습니다.`, confirmLabel: '빼기' }))) return
    run(() => api.del(`/workspace/teams/${team.id}/members/${encodeURIComponent(m.email)}`))
  }
  const leave = async () => {
    if (!(await confirmDialog({ title: '팀 나가기', message: `${team.name} 팀에서 나갈까요? 내가 만든 파일은 계속 내 파일에 남고, 팀 액세스로만 열던 파일은 더 이상 열 수 없습니다.`, confirmLabel: '나가기' }))) return
    run(() => api.post(`/workspace/teams/${team.id}/leave`), () => { setDetail(null); select(null, true) })
  }
  const removeTeam = async () => {
    if (!(await confirmDialog({ title: '팀 삭제', message: `${team.name} 팀을 삭제할까요? 팀 파일은 지워지지 않고 만든 사람의 파일로 남습니다. 팀 액세스였던 파일은 제한됨(만든 사람과 이메일로 추가된 사람만)으로 바뀝니다.`, confirmLabel: '팀 삭제' }))) return
    run(() => api.del(`/workspace/teams/${team.id}`), () => { setDetail(null); select(null, true) })
  }
  const ownerCount = (detail?.members || []).filter((m) => m.role === 'owner').length

  return (
    <div className="ws">
      <header className="ws-top">
        <Link to={selected ? `/workspace/docs?team=${selected}` : '/workspace/docs'} className="ws-iconbtn ws-iconbtn--lg" aria-label="워크스페이스로"><ArrowLeft size={24} /></Link>
        <span className="ws-brand"><UsersRound size={32} color="#7a3cff" /><span>팀 관리</span></span>
        <span className="ws-top__right"><AccountMenu size={40} /></span>
      </header>

      <section className="ws-band">
        <div className="ws-wrap">
          <form className="mb-add" onSubmit={create}>
            <div className="mb-add__head"><h2>새 팀 만들기</h2></div>
            <div className="mb-add__row">
              <label className="mb-field">
                <span>팀 이름</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 기말전시 기획팀" maxLength={60} autoComplete="off" data-1p-ignore="true" />
              </label>
              <label className="mb-field">
                <span>설명</span>
                <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="선택" maxLength={300} autoComplete="off" data-1p-ignore="true" />
              </label>
              <label className="mb-field mb-field--wide">
                <span>함께할 팀원의 구글 이메일 (선택, 쉼표나 줄바꿈으로 여러 명)</span>
                <textarea rows={1} value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="name@gmail.com" autoComplete="off" data-1p-ignore="true" data-lpignore="true" />
              </label>
              <button type="submit" className="gbtn mb-add__btn" disabled={busy}><Plus size={18} /> 만들기</button>
            </div>
          </form>
        </div>
      </section>

      <section className="ws-recent">
        <div className="ws-wrap">
          {error && <p className="ws-error" role="alert" style={{ marginTop: 16 }}>{error}</p>}
          <div className="tm">
            <aside className="tm-list" aria-label="내 팀">
              <div className="ws-recent__head"><h2>내 팀 {teams ? teams.length : ''}</h2></div>
              {!teams ? (
                <p className="ws-empty">불러오는 중</p>
              ) : teams.length === 0 ? (
                <p className="ws-empty">아직 속한 팀이 없습니다. 위에서 팀을 만들거나, 팀 오너에게 내 구글 이메일을 알려 주세요.</p>
              ) : (
                teams.map((t) => (
                  <button key={t.id} type="button" className={`tm-item${t.id === selected ? ' is-on' : ''}`} onClick={() => select(t.id)}>
                    <UsersRound size={22} />
                    <span className="mb-who"><b>{t.name}</b><small>{ROLE[t.my_role]} · {t.member_count}명</small></span>
                  </button>
                ))
              )}
            </aside>

            <div className="tm-detail">
              {!team ? (
                teams?.length ? <p className="ws-empty">불러오는 중</p> : null
              ) : (
                <>
                  <div className="tm-head">
                    <div className="tm-title">
                      <h2>{team.name}</h2>
                      <p>{team.description || (isOwner ? '설명이 없습니다.' : '')}</p>
                    </div>
                    <div className="tm-acts">
                      <Link to={`/workspace/docs?team=${team.id}`} className="mb-pill"><FolderOpen size={16} /> 팀 공간 열기</Link>
                      {isOwner && <button type="button" className="ws-iconbtn" title="팀 이름 바꾸기" aria-label="팀 이름 바꾸기" onClick={rename} disabled={busy}><Pencil size={18} /></button>}
                      {isOwner && <button type="button" className="mb-ghost" onClick={editDesc} disabled={busy}>설명 고치기</button>}
                      <button type="button" className="mb-ghost" onClick={leave} disabled={busy || (isOwner && ownerCount <= 1)} title={isOwner && ownerCount <= 1 ? '마지막 팀 오너는 나갈 수 없습니다. 다른 팀원을 오너로 지정하거나 팀을 삭제하세요.' : ''}><LogOut size={16} /> 나가기</button>
                      {isOwner && <button type="button" className="mb-ghost" onClick={removeTeam} disabled={busy}><Trash2 size={16} /> 팀 삭제</button>}
                    </div>
                  </div>
                  <p className="tm-files">
                    팀 파일: 문서 {team.files?.doc || 0} · 스프레드시트 {team.files?.sheet || 0} · 설문지 {team.files?.form || 0} · 보드 {team.files?.board || 0}
                  </p>

                  {isOwner && (
                    <form className="tm-add" onSubmit={add}>
                      <label className="mb-field mb-field--wide">
                        <span>팀원 추가 (구글 이메일, 쉼표나 줄바꿈으로 여러 명)</span>
                        <textarea rows={1} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@gmail.com" autoComplete="off" data-1p-ignore="true" data-lpignore="true" />
                      </label>
                      <div className="tm-seg" role="radiogroup" aria-label="추가할 역할">
                        {['member', 'owner'].map((r) => (
                          <button key={r} type="button" role="radio" aria-checked={role === r} className={role === r ? 'is-on' : ''} onClick={() => setRole(r)}>{ROLE[r]}</button>
                        ))}
                      </div>
                      <button type="submit" className="gbtn mb-add__btn" disabled={busy}><UserPlus size={18} /> 추가</button>
                    </form>
                  )}

                  <div className="ws-recent__head"><h2>팀원 {detail.members.length}</h2></div>
                  <div className="mb-list">
                    {detail.members.map((m) => {
                      const self = m.email.toLowerCase() === myEmail
                      const lastOwner = m.role === 'owner' && ownerCount <= 1
                      return (
                        <div key={m.email} className="mb-row tm-row">
                          <Avatar name={m.name || m.email} picture={m.picture} size={40} />
                          <span className="mb-who"><b>{m.name || m.email}{self ? ' (나)' : ''}</b>{m.name && <small>{m.email}</small>}</span>
                          <span className="mb-meta">{m.joined ? '' : '아직 로그인 전'}</span>
                          <span className={`tm-role${m.role === 'owner' ? ' is-owner' : ''}`}>{m.role === 'owner' && <Crown size={14} />}{ROLE[m.role]}</span>
                          <span className="mb-acts">
                            {isOwner && (
                              m.role === 'owner'
                                ? <button type="button" className="mb-ghost" disabled={busy || lastOwner} title={lastOwner ? '팀에는 오너가 한 명 이상 있어야 합니다' : ''} onClick={() => setMemberRole(m, 'member')}>팀원으로</button>
                                : <button type="button" className="mb-ghost" disabled={busy} onClick={() => setMemberRole(m, 'owner')}>오너로 지정</button>
                            )}
                            {isOwner && !self && <button type="button" className="ws-iconbtn" aria-label={`${m.email} 빼기`} title="팀에서 빼기" disabled={busy || lastOwner} onClick={() => removeMember(m)}><UserMinus size={18} /></button>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {!isOwner && <p className="ws-empty" style={{ paddingTop: 16 }}>팀원 추가와 역할 변경은 팀 오너만 할 수 있습니다.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
