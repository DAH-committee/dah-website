// uploadLoad.js: 마감 직전처럼 업로드가 몰릴 때 서버가 쓰러지지 않게 하는 입장 관리.
// 원칙은 하나다. 학생이 올리는 원본(PNG, PDF)을 받는 일이 가장 먼저이고, 웹 전시용 변환이나 드라이브 정리는
// 업로드가 잠잠할 때 뒤에서 한다. 업로드 본문은 multer가 메모리에 통째로 올리므로, 동시에 받는 본문 크기의 합에
// 상한을 둔다. 상한을 넘는 요청은 거절하지 않고 앞사람이 끝날 때까지 줄을 세운다.

const MB = 1024 * 1024
const BUDGET = (Number(process.env.UPLOAD_INFLIGHT_MB) || 240) * MB // 동시에 메모리에 올릴 본문 합계
const MAX_WAIT_MS = Number(process.env.UPLOAD_QUEUE_WAIT_MS) || 50_000 // 이보다 오래 기다리면 다시 시도 안내
const UNKNOWN_SIZE = 20 * MB // content-length가 없을 때 잡는 크기

let inflightBytes = 0
let inflightCount = 0
const waiters = []

/** 지금 본문을 받고 있거나 처리 중인 업로드 수. 뒤로 미루는 작업이 양보 여부를 정할 때 쓴다 */
export function activeUploads() {
  return inflightCount + waiters.length
}

function fits(need) {
  return inflightCount === 0 || inflightBytes + need <= BUDGET
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
}
