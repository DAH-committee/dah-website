// LoginModal.jsx — 글래스 로그인 모달 (F9, 16_PHASE4)
// 기존 /login 페이지를 대체. 이메일/비밀번호 + 최초 온보딩(must_set_pw) 비밀번호 설정 분기.
// ESC·바깥 클릭 닫기, 포커스 트랩, 열림 시 본문 스크롤 잠금(storage 미사용).
// 어드민 폼 프리미티브(FormControls) 재사용 — 별도 테마 금지(13_CMS_SPEC).

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLoginModal } from '../../context/LoginModalContext'
import { ErrorText, Field, Input, PrimaryButton } from '../admin/FormControls'

function LoginModal() {
  const { isOpen, closeLogin } = useLoginModal()
  const { login, setupPassword } = useAuth()
  const panelRef = useRef(null)

  const [mode, setMode] = useState('login') // 'login' | 'setup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const canLogin = Boolean(email.trim() && password)
  const canSetPassword = newPassword.length >= 8 && newPassword === confirmPassword

  // 닫힘 시 폼 상태 초기화 (다음 오픈이 항상 login 단계에서 시작)
  useEffect(() => {
    if (isOpen) return
    setMode('login')
    setEmail('')
    setPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setBusy(false)
  }, [isOpen])

  // 열림 시: 스크롤 잠금 + ESC 닫기 + 포커스 트랩 + 첫 필드 포커스
  useEffect(() => {
    if (!isOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const firstInput = panelRef.current?.querySelector('input')
    firstInput?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeLogin()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled])'
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, closeLogin])

  if (!isOpen) return null

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!canLogin || busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await login(email, password)
      if (data?.must_set_pw) {
        setMode('setup')
      } else {
        closeLogin()
      }
    } catch (err) {
      setError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSetup = async (e) => {
    e.preventDefault()
    setError(null)
    if (newPassword.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    setBusy(true)
    try {
      await setupPassword(email, newPassword)
      closeLogin()
    } catch (err) {
      setError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dah-safe-inline fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto py-16 md:px-gutter-t">
      {/* 백드롭 — 클릭 시 닫힘 */}
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={closeLogin}
        className="absolute inset-0 bg-bg-base/70"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        className="dah-scrollbar relative max-h-[calc(100dvh-32px)] w-full max-w-sm overflow-y-auto rounded-glass border border-glass-line bg-cosmos-depth1/[0.96] p-24 backdrop-blur-glass md:p-32"
      >
        <button
          type="button"
          aria-label="닫기"
          onClick={closeLogin}
          className="absolute right-12 top-12 flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-text-sec transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:right-16 md:top-16 md:h-32 md:w-32"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <p className="font-mono text-label-m uppercase tracking-label text-text-meta">
          DAH ADMIN
        </p>
        <h2
          id="login-modal-title"
          className="mt-8 text-h2-m font-bold text-text-pri md:text-h2-d"
        >
          {mode === 'login' ? '로그인' : '비밀번호 설정'}
        </h2>
        <p className="mt-8 text-small-m text-text-sec md:text-small-d">
          {mode === 'login'
            ? '등록된 계정으로 로그인합니다.'
            : '최초 로그인 계정은 비밀번호 설정이 필요합니다.'}
        </p>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="mt-24 flex flex-col gap-16">
            <Field label="이메일">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            <Field label="비밀번호">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <PrimaryButton type="submit" disabled={busy || !canLogin} className="w-full">
              {busy ? '확인 중' : '로그인'}
            </PrimaryButton>
          </form>
        ) : (
          <form onSubmit={handleSetup} className="mt-24 flex flex-col gap-16">
            <Field label="이메일">
              <Input type="email" value={email} disabled readOnly />
            </Field>
            <Field label="새 비밀번호" hint="8자 이상">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="비밀번호 확인">
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <PrimaryButton type="submit" disabled={busy || !canSetPassword} className="w-full">
              {busy ? '설정 중' : '설정 후 로그인'}
            </PrimaryButton>
          </form>
        )}
      </div>
    </div>
  )
}

export default LoginModal
