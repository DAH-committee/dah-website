// 공유 대화상자(구글 독스 방식): 사람 추가(이메일), 액세스 권한이 있는 사용자, 일반 액세스, 링크 복사.
// 일반 액세스: 제한됨 / 운영위원회 및 교수진 / 전체 공개, 각각 뷰어 또는 편집자 권한.
// 사이트 디자인 시스템 모달(AppDialog)과 같은 패널 토큰을 쓰고, 밝은 작업면에서는 reading 토큰으로 바뀐다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Globe, Link as LinkIcon, Lock, Users, X } from 'lucide-react'
import { api } from '../../hooks/useApi'
import { Avatar } from './AccountMenu'
import { alertDialog } from './AppDialog'
import './shareDialog.css'

const ROLE_LABEL = { viewer: '뷰어', editor: '편집자' }
const GENERAL = [
  { id: 'restricted', label: '제한됨', desc: '추가된 사용자만 열 수 있습니다', Icon: Lock },
  { id: 'committee', label: '운영위원회 및 교수진', desc: '운영위원회·교수진 계정으로 로그인한 사용자는 누구나 열 수 있습니다', Icon: Users },
  { id: 'public', label: '전체 공개', desc: '링크가 있는 인터넷 사용자는 누구나 열 수 있습니다', Icon: Globe },
]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Menu({ value, options, onChange, disabled = false, align = 'right', wide = false, label }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const list = useRef(null)

  // 목록은 body에 띄워서(고정 위치) 모달 안에서 잘리거나 스크롤을 만들지 않게 한다
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const w = wide ? 340 : 190
    const h = list.current?.offsetHeight || 0
    const left = align === 'right' ? Math.max(8, r.right - Math.max(w, list.current?.offsetWidth || w)) : Math.min(r.left, window.innerWidth - w - 8)
    const below = r.bottom + 4
    const top = h && below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below
    setPos({ top, left })
  }, [open, align, wide])

  useEffect(() => {
    if (!open) return undefined
    const down = (e) => {
      if (btn.current?.contains(e.target) || list.current?.contains(e.target)) return
      setOpen(false)
    }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [open])

  const cur = options.find((o) => o.id === value)
  return (
    <div className={`sh-menu ${wide ? 'sh-menu--wide' : ''}`}>
      <button ref={btn} type="button" className="sh-menu__btn" disabled={disabled} onClick={() => { setPos(null); setOpen((v) => !v) }} aria-haspopup="listbox" aria-expanded={open} aria-label={label}>
        <span>{cur?.label}</span>
        {!disabled && <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {open &&
        createPortal(
          <div ref={list} className="sh-menu__list" role="listbox" style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden', minWidth: wide ? 340 : 190 }}>
            {options.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected={o.id === value} className={`sh-menu__opt ${o.danger ? 'is-danger' : ''}`} onClick={() => { setOpen(false); onChange(o.id) }}>
                <span className="sh-menu__check">{o.id === value ? <Check size={16} aria-hidden="true" /> : null}</span>
                <span>{o.label}{o.desc && <small>{o.desc}</small>}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}

export default function ShareDialog({ fileId, title, linkPath, onClose, onChanged }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [chips, setChips] = useState([])
  const [text, setText] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const panel = useRef(null)
  const light = typeof document !== 'undefined' && Boolean(document.querySelector('.reading-scope, .gd, .ws'))

  const load = useCallback(async () => {
    try {
      setState(await api.get(`/workspace/files/${fileId}/share`))
    } catch (e) {
      setError(e.message)
    }
  }, [fileId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  useEffect(() => { panel.current?.querySelector('input')?.focus() }, [state === null])

  const canEdit = state?.level === 'editor'
  const apply = async (fn) => {
    setBusy(true)
    setError('')
    try {
      const next = await fn()
      if (next?.general_access) setState((s) => ({ ...s, ...next }))
      else await load()
      onChanged?.()
    } catch (e) {
      setError(e.hint ? `${e.message} (${e.hint})` : e.message)
    } finally {
      setBusy(false)
    }
  }

  const pushChips = (raw) => {
    const parts = String(raw).split(/[\s,;]+/).map((v) => v.trim().toLowerCase()).filter(Boolean)
    if (!parts.length) return false
    const ok = parts.filter((p) => EMAIL_RE.test(p))
    if (ok.length !== parts.length) setError('이메일 주소 형식이 올바르지 않습니다')
    else setError('')
    setChips((c) => [...new Set([...c, ...ok])])
    return ok.length === parts.length
  }
  const onKey = (e) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === ';') && text.trim()) {
      e.preventDefault()
      if (pushChips(text)) setText('')
    } else if (e.key === 'Backspace' && !text && chips.length) setChips((c) => c.slice(0, -1))
  }
  const addPeople = () => {
    const list = [...chips]
    if (text.trim()) {
      const extra = text.split(/[\s,;]+/).filter(Boolean).map((v) => v.toLowerCase())
      if (extra.some((x) => !EMAIL_RE.test(x))) return setError('이메일 주소 형식이 올바르지 않습니다')
      list.push(...extra)
    }
    if (!list.length) return
    apply(async () => {
      const r = await api.post(`/workspace/files/${fileId}/share/people`, { emails: [...new Set(list)], role })
      setChips([])
      setText('')
      return r
    })
  }

  const link = () => {
    const url = new URL(linkPath || window.location.pathname, window.location.origin)
    if (state?.general_access === 'public' && state.share_token) url.searchParams.set('k', state.share_token)
    return url.toString()
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      await alertDialog({ title: '링크 복사', message: link() })
    }
  }

  const g = GENERAL.find((x) => x.id === state?.general_access) || GENERAL[0]
  const adding = chips.length > 0 || text.trim().length > 0

  return createPortal(
    <div className={`${light ? 'reading-scope' : ''} share fixed inset-0 z-[300] flex items-center justify-center px-16`} role="presentation">
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={onClose} className={`app-dialog__backdrop absolute inset-0 cursor-default ${light ? 'bg-black/45' : 'bg-bg-base/70'}`} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={`${title} 공유`} className={`share__panel ${state !== null || error ? 'app-dialog__panel' : 'share__panel--wait'}`}>
        <div className="share__head">
          <h2 title={title}>“{title}” 공유</h2>
          <button type="button" className="share__x" onClick={onClose} aria-label="닫기"><X size={20} aria-hidden="true" /></button>
        </div>

        {state === null && error && <p className="share__err">{error}</p>}

        {state && (
          <>
            {canEdit && (
              <div className="share__add">
                <div className={`share__field ${adding ? 'is-on' : ''}`}>
                  {chips.map((c) => (
                    <span key={c} className="share__chip">
                      {c}
                      <button type="button" aria-label={`${c} 제거`} onClick={() => setChips((l) => l.filter((x) => x !== c))}><X size={14} aria-hidden="true" /></button>
                    </span>
                  ))}
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onKey}
                    onBlur={() => text.trim() && pushChips(text) && setText('')}
                    onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); pushChips(t) } }}
                    placeholder={chips.length ? '' : '이메일 주소로 사용자 추가 (구글 이메일도 가능)'}
                    aria-label="이메일 주소로 사용자 추가"
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                    inputMode="email"
                  />
                </div>
                {adding && (
                  <div className="share__addbar">
                    <Menu value={role} options={[{ id: 'viewer', label: '뷰어' }, { id: 'editor', label: '편집자' }]} onChange={setRole} align="left" label="추가할 사용자의 권한" />
                    <span className="share__spacer" />
                    <button type="button" className="share__btn" onClick={() => { setChips([]); setText(''); setError('') }}>취소</button>
                    <button type="button" className="share__btn share__btn--on" disabled={busy} onClick={addPeople}>추가</button>
                  </div>
                )}
              </div>
            )}

            <h3 className="share__sub">액세스 권한이 있는 사용자</h3>
            <ul className="share__people">
              <li>
                <Avatar name={state.owner.name} picture={state.owner.picture} size={36} />
                <span className="share__who"><b>{state.owner.name || state.owner.email || '소유자'}</b><small>{state.owner.email || ''}</small></span>
                <span className="share__role">소유자</span>
              </li>
              {state.people.map((p) => (
                <li key={p.id}>
                  <Avatar name={p.name || p.email} picture={p.picture} size={36} />
                  <span className="share__who"><b>{p.name || p.email}</b>{p.name && <small>{p.email}</small>}</span>
                  {canEdit ? (
                    <Menu
                      value={p.role}
                      disabled={busy}
                      label={`${p.email} 권한`}
                      options={[{ id: 'viewer', label: '뷰어' }, { id: 'editor', label: '편집자' }, { id: 'remove', label: '액세스 삭제', danger: true }]}
                      onChange={(v) => apply(() => (v === 'remove' ? api.del(`/workspace/files/${fileId}/share/people/${p.id}`) : api.put(`/workspace/files/${fileId}/share/people/${p.id}`, { role: v })))}
                    />
                  ) : (
                    <span className="share__role">{ROLE_LABEL[p.role]}</span>
                  )}
                </li>
              ))}
            </ul>

            <h3 className="share__sub">일반 액세스</h3>
            <div className="share__general">
              <span className={`share__gico share__gico--${g.id}`}><g.Icon size={20} aria-hidden="true" /></span>
              <div className="share__gtext">
                {canEdit ? (
                  <Menu
                    wide
                    value={g.id}
                    align="left"
                    label="일반 액세스"
                    options={GENERAL.map((o) => ({ id: o.id, label: o.label, desc: o.desc }))}
                    onChange={(v) => apply(() => api.put(`/workspace/files/${fileId}/share`, { general_access: v }))}
                  />
                ) : (
                  <b className="share__gname">{g.label}</b>
                )}
                <small>{g.desc}</small>
              </div>
              {g.id !== 'restricted' && (
                canEdit ? (
                  <Menu
                    value={state.general_role}
                    label="일반 액세스 권한"
                    options={[{ id: 'viewer', label: '뷰어' }, { id: 'editor', label: '편집자' }]}
                    onChange={(v) => apply(() => api.put(`/workspace/files/${fileId}/share`, { general_role: v }))}
                  />
                ) : (
                  <span className="share__role">{ROLE_LABEL[state.general_role]}</span>
                )
              )}
            </div>
            {g.id === 'public' && state.general_role === 'editor' && (
              <p className="share__warn">링크가 있는 사람은 로그인 없이 문서를 고칠 수 있습니다. 링크를 아는 사람에게만 전달하세요.</p>
            )}

            {error && <p className="share__err" role="alert">{error}</p>}

            <div className="share__foot">
              <button type="button" className="share__btn share__btn--ghost" onClick={copy}>
                {copied ? <Check size={16} aria-hidden="true" /> : <LinkIcon size={16} aria-hidden="true" />}
                {copied ? '링크를 복사했습니다' : '링크 복사'}
              </button>
              {canEdit && g.id === 'public' && (
                <button
                  type="button"
                  className="share__btn share__btn--text"
                  onClick={() => apply(() => api.put(`/workspace/files/${fileId}/share`, { reset_link: true }))}
                  title="지금까지 공유한 링크를 더 이상 쓸 수 없게 하고 새 링크를 만듭니다"
                >
                  링크 새로 만들기
                </button>
              )}
              <span className="share__spacer" />
              <button type="button" className="share__btn share__btn--on" onClick={onClose}>완료</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
