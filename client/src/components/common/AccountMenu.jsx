// 계정 아바타와 계정 메뉴(구글 방식): 문서·시트·설문지·작업공간 어디서나 오른쪽 위에 같은 모양으로 둔다.
// 아바타는 기본이 보라 원에 이름 첫 글자이고, 구글로 로그인한 계정은 구글 프로필 사진을 쓴다.
// 메뉴에서 로그아웃하거나 다른 구글 계정으로 바꿀 수 있다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, Plus, UserRound, LayoutDashboard } from 'lucide-react'
import { API_BASE, api } from '../../hooks/useApi'
import { useLoginModal } from '../../context/LoginModalContext'
import './accountMenu.css'

export const AVATAR_PURPLE = '#7A3CFF'

/** 구글 로그인으로 이동(로그인 뒤 현재 화면으로 돌아온다) */
export function startGoogleLogin(hint) {
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
  window.location.href = `${API_BASE}/auth/google/login?next=${next}${hint ? `&hint=${encodeURIComponent(hint)}` : ''}`
}

/** 구글 로고(4색) 대신 쓰는 단색 G 표시 */
export function GoogleG({ size = 18 }) {
  return <span className="acct-g" style={{ width: size, height: size, fontSize: Math.round(size * 0.75) }} aria-hidden="true">G</span>
}
const STORE = 'dah.accounts'

let cache = { at: 0, me: undefined, pending: null }

/** 현재 계정: { user: {name,email,role,kind,picture}|null, staff } */
export function useMe() {
  const [me, setMe] = useState(cache.me)
  const load = useCallback(async (force = false) => {
    if (!force && cache.me !== undefined && Date.now() - cache.at < 20000) return setMe(cache.me)
    if (!cache.pending || force) {
      cache.pending = api.get('/workspace/me').catch(() => ({ user: null, staff: false })).then((r) => {
        cache = { at: Date.now(), me: r, pending: null }
        return r
      })
    }
    setMe(await cache.pending)
  }, [])
  useEffect(() => { load() }, [load])
  return { me, reload: () => load(true) }
}

function remembered() {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]') } catch { return [] }
}
function remember(user) {
  if (!user?.email) return
  const list = [user, ...remembered().filter((a) => a.email !== user.email)].slice(0, 5)
  try { localStorage.setItem(STORE, JSON.stringify(list.map((a) => ({ email: a.email, name: a.name, picture: a.picture || null, kind: a.kind })))) } catch { /* 저장 불가 환경 */ }
}

export function Avatar({ name, picture, size = 40, className = '' }) {
  const [broken, setBroken] = useState(false)
  const initial = (name || '?').trim().slice(0, 1)
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42), background: AVATAR_PURPLE }
  if (picture && !broken) {
    return <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`acct-avatar ${className}`} style={{ ...style, objectFit: 'cover' }} />
  }
  return <span className={`acct-avatar ${className}`} style={style} aria-hidden="true">{name ? initial : <UserRound size={Math.round(size * 0.55)} />}</span>
}

export default function AccountMenu({ size = 40, className = '' }) {
  const { me } = useMe()
  const { openLogin } = useLoginModal()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const user = me?.user || null

  useEffect(() => { if (user) remember(user) }, [user])
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  const googleLogin = startGoogleLogin
  const signOut = async () => {
    await Promise.allSettled([api.post('/auth/logout'), api.post('/auth/public/logout')])
    cache = { at: 0, me: undefined, pending: null }
  }
  const logout = async () => { await signOut(); window.location.reload() }
  const switchTo = async (acct) => {
    await signOut()
    if (acct.kind === 'staff' && !/@(gmail|googlemail)\.com$/i.test(acct.email)) { window.location.reload(); openLogin(); return }
    googleLogin(acct.email)
  }
  const others = remembered().filter((a) => a.email !== user?.email)

  return (
    <div ref={ref} className={`acct ${className}`}>
      {me && !user ? (
        <button type="button" className="acct-login" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} style={{ height: size }}>
          로그인
        </button>
      ) : (
        <button type="button" className="acct-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} aria-label={user ? `${user.name} 계정` : '로그인'} title={user ? `${user.name}\n${user.email}` : '로그인'}>
          <Avatar name={user?.name} picture={user?.picture} size={size} />
        </button>
      )}
      {open && (
        <div className="acct-pop" role="dialog" aria-label="계정">
          {user ? (
            <>
              <p className="acct-pop__email">{user.email}</p>
              <div className="acct-pop__me">
                <Avatar name={user.name} picture={user.picture} size={72} />
                <h3>안녕하세요, {user.name}님!</h3>
                <p>{user.kind === 'staff' ? (user.role === 'owner' ? '오너' : user.role === 'admin' ? '관리자' : '운영위원회 및 교수진') : '초대받은 사용자'}</p>
                {user.kind === 'staff' && (
                  <a className="acct-pill" href="/admin"><LayoutDashboard size={16} aria-hidden="true" /> 관리 대시보드</a>
                )}
              </div>
              <div className="acct-pop__list">
                {others.map((a) => (
                  <button key={a.email} type="button" className="acct-row" onClick={() => switchTo(a)}>
                    <Avatar name={a.name} picture={a.picture} size={32} />
                    <span><b>{a.name}</b><small>{a.email}</small></span>
                  </button>
                ))}
                <button type="button" className="acct-row" onClick={() => googleLogin()}>
                  <span className="acct-row__ico"><Plus size={18} aria-hidden="true" /></span>
                  <span><b>다른 계정 추가</b></span>
                </button>
                <button type="button" className="acct-row" onClick={logout}>
                  <span className="acct-row__ico"><LogOut size={18} aria-hidden="true" /></span>
                  <span><b>로그아웃</b></span>
                </button>
              </div>
            </>
          ) : (
            <div className="acct-pop__me">
              <Avatar size={72} />
              <h3>로그인하지 않았습니다</h3>
              <p>구글 계정이나 운영위원회 계정으로 로그인하세요.</p>
              <button type="button" className="acct-pill acct-pill--on" onClick={() => googleLogin()}><GoogleG /> 구글 계정으로 로그인</button>
              <button type="button" className="acct-pill" onClick={() => { setOpen(false); openLogin() }}>운영위원회 계정으로 로그인</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
