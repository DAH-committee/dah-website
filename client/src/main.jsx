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



createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
