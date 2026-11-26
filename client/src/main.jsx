import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 새 배포 뒤 예전 화면을 켜 둔 탭은 사라진 파일(예전 해시의 청크)을 불러오다 실패한다.
// 그때 한 번 새로고침해 새 파일 목록으로 다시 연다(30초 안에 반복되면 멈춰 무한 새로고침을 막는다).
function reloadOnceForNewDeploy() {
  try {
    const last = Number(sessionStorage.getItem('dah.reloadAt') || 0)
    if (Date.now() - last < 30000) return
    sessionStorage.setItem('dah.reloadAt', String(Date.now()))
  } catch {
    /* 저장소를 못 써도 새로고침은 한다 */
  }
  window.location.reload()
}
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadOnceForNewDeploy()
})
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message || e.reason || '')
  if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)) reloadOnceForNewDeploy()
})



// 점검 중에는 어느 주소로 들어와도 흰 화면 가운데에 점검 안내만 보인다. 점검이 끝나면 false로 돌린다
const MAINTENANCE = true

function Maintenance() {
  const wrap = { position: 'fixed', inset: 0, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', wordBreak: 'keep-all', fontFamily: "'Pretendard Variable', Pretendard, system-ui, sans-serif", color: '#111111' }
  return (
    <main style={wrap}>
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1.4, letterSpacing: '-0.02em' }}>서비스 점검 안내</h1>
        <p style={{ margin: '20px 0 0', fontSize: 17, lineHeight: 1.7, color: '#333333' }}>
          데이터베이스 이관 작업으로<br />사이트 이용이 잠시 중단됩니다.
        </p>
        <p style={{ margin: '28px 0 0', fontSize: 15, lineHeight: 1.6, color: '#555555' }}>점검 시간</p>
        <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 600, lineHeight: 1.5 }}>2026. 11. 27.(금) 08:30 ~ 11:30</p>
        <p style={{ margin: '28px 0 0', fontSize: 15, lineHeight: 1.7, color: '#555555' }}>
          이용에 불편을 드려 죄송합니다.<br />점검이 끝나면 바로 다시 이용하실 수 있습니다.
        </p>
      </div>
    </main>
  )
}

if (MAINTENANCE) document.title = '서비스 점검 안내 | 한림대학교 디지털인문예술전공'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {MAINTENANCE ? <Maintenance /> : <App />}
  </StrictMode>,
)
