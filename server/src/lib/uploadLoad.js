// uploadLoad.js: 마감 직전처럼 업로드가 몰릴 때 서버가 쓰러지지 않게 하는 입장 관리.
// 원칙은 하나다. 학생이 올리는 원본(PNG, PDF)을 받는 일이 가장 먼저이고, 웹 전시용 변환이나 드라이브 정리는
// 업로드가 잠잠할 때 뒤에서 한다. 업로드 본문은 multer가 메모리에 통째로 올리므로, 동시에 받는 본문 크기의 합에
// 상한을 둔다. 상한을 넘는 요청은 거절하지 않고 앞사람이 끝날 때까지 줄을 세운다.

const MB = 1024 * 1024
// 무료 서버(512MB)에서 파일 하나는 받는 동안 크기의 서너 배 메모리를 쓴다. 동시에 받는 본문 합계는 40MB,
// 동시 업로드는 3개까지로 두고 나머지는 먼저 온 순서대로 기다린다. 현재 메모리가 높으면 더 기다린다.
const BUDGET = (Number(process.env.UPLOAD_INFLIGHT_MB) || 40) * MB // 동시에 메모리에 올릴 본문 합계
const MAX_CONCURRENT = Number(process.env.UPLOAD_MAX_CONCURRENT) || 3
const MEM_LIMIT = (Number(process.env.UPLOAD_MEM_LIMIT_MB) || 380) * MB // 이 값을 넘기지 않게 받는다(서버 한계 512MB)
// Render 프록시는 100초 안에 응답이 없으면 끊으므로 그 안에서 기다리고, 넘으면 화면이 알아서 다시 시도한다
const MAX_WAIT_MS = Number(process.env.UPLOAD_QUEUE_WAIT_MS) || 85_000
const UNKNOWN_SIZE = 20 * MB // content-length가 없을 때 잡는 크기

let inflightBytes = 0
let inflightCount = 0
const waiters = []

/** 지금 본문을 받고 있거나 처리 중인 업로드 수. 뒤로 미루는 작업이 양보 여부를 정할 때 쓴다 */
export function activeUploads() {
  return inflightCount + waiters.length
}

function fits(need) {
  if (inflightCount === 0) return true // 혼자일 때는 항상 들어간다(영영 못 들어가는 일 없음)
  if (inflightCount >= MAX_CONCURRENT || inflightBytes + need > BUDGET) return false
  return process.memoryUsage.rss() + need * 3 <= MEM_LIMIT
}

function drain() {
  while (waiters.length && fits(waiters[0].need)) {
    const w = waiters.shift()
    inflightBytes += w.need
    inflightCount++
    clearTimeout(w.timer)
    w.go()
  }
}

/** 업로드 라우트 맨 앞에 둔다. multer가 본문을 읽기 전에 자리를 얻어야 메모리 상한이 지켜진다 */
export function admitUpload(req, res, next) {
  // 줄에 서기 전 도착 시각. 마감 판정은 이 시각으로 한다(줄을 기다리다 자정을 넘겨도 늦은 것이 아니다)
  req.arrivedAt = new Date()
  const declared = Number(req.headers['content-length']) || 0
  const need = Math.min(declared || UNKNOWN_SIZE, BUDGET)
  let held = false
  const release = () => {
    if (!held) return
    held = false
    inflightBytes -= need
    inflightCount--
    drain()
  }
  const go = () => {
    held = true
    res.once('close', release)
    next()
  }
  if (fits(need) && waiters.length === 0) {
    inflightBytes += need
    inflightCount++
    return go()
  }
  const w = { need, go }
  w.timer = setTimeout(() => {
    const i = waiters.indexOf(w)
    if (i >= 0) waiters.splice(i, 1)
    res.set('Retry-After', '10')
    res.status(503).json({ error: '지금 업로드가 몰려 있습니다. 잠시 뒤 같은 파일을 다시 올려 주세요.', code: 'upload_busy' })
  }, MAX_WAIT_MS)
  req.once('close', () => {
    const i = waiters.indexOf(w)
    if (i >= 0) {
      waiters.splice(i, 1)
      clearTimeout(w.timer)
    }
  })
  waiters.push(w)
  ensureTicker()
}

// 메모리 여유는 업로드가 끝날 때만 바뀌는 게 아니어서, 기다리는 사람이 있으면 1초마다 다시 본다
let ticker = null
function ensureTicker() {
  if (ticker) return
  ticker = setInterval(() => {
    drain()
    if (!waiters.length) {
      clearInterval(ticker)
      ticker = null
    }
  }, 1000)
  ticker.unref?.()
}

/** 줄 상태(관리용). 지금 받는 수, 기다리는 수, 서버 메모리 */
export function uploadQueueState() {
  return { active: inflightCount, waiting: waiters.length, inflightMB: Math.round(inflightBytes / MB), rssMB: Math.round(process.memoryUsage.rss() / MB) }
}
