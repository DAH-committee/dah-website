// /auth/finish: 구글 로그인 마무리 화면.
// 서버가 구글 확인을 끝내고 2분짜리 1회용 전달표(h)와 돌아갈 주소(next)를 붙여 여기로 보낸다.
// 여기서 같은 사이트 경로(/api)로 전달표를 내면 서버가 그 응답으로 로그인 쿠키를 심는다.
// 쿠키가 이 사이트의 쿠키(제1자)가 되어, 사파리·아이폰·파이어폭스·시크릿 창에서도 로그인이 유지된다.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../hooks/useApi'

export default function AuthFinish() {
  const [error, setError] = useState('')

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const h = q.get('h')
    const next = q.get('next') || '/workspace/docs'
    const safe = /^\/($|[^/\\])/.test(next) ? next : '/workspace/docs'
    if (!h) {
      setError('로그인 확인 정보가 없습니다. 다시 로그인하세요.')
      return
    }
    // 주소창에서 전달표를 바로 지운다(뒤로 가기·기록에 남지 않게)
    window.history.replaceState(null, '', '/auth/finish')
    api
      .post('/auth/google/finish', { h })
      .then(() => window.location.replace(safe))
      .catch((e) => setError(e.hint || e.message || '로그인을 마치지 못했습니다. 다시 시도하세요.'))
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'grid', placeItems: 'center', background: '#fff', color: '#1f1f1f', fontFamily: "'Pretendard Variable', Pretendard, sans-serif", textAlign: 'center', padding: 24 }}>
      {error ? (
        <div>
          <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>로그인하지 못했습니다</p>
          <p style={{ margin: '0 0 20px', color: '#5f6368' }}>{error}</p>
          <Link to="/workspace/docs" style={{ display: 'inline-block', padding: '12px 24px', borderRadius: 24, background: '#7a3cff', color: '#fff', fontWeight: 600, textDecoration: 'none' }}>작업공간으로</Link>
        </div>
      ) : (
        <p style={{ fontSize: 16, color: '#5f6368' }}>로그인하는 중입니다</p>
      )}
    </div>
  )
}
