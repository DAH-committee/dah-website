// 응답자용 viewform 페이지(html) 또는 FB_PUBLIC_LOAD_DATA_ 배열(json)에서 질문 목록을 요약해 찍는다.
// 사용: node forms-extract.mjs <viewform.html | data.json>
// 구글이 응답자 화면에 싣는 구조 데이터를 읽기만 한다(스크립트 해독 없음).
import { readFileSync } from 'node:fs'

const p = process.argv[2]
if (!p) { console.error('사용: node forms-extract.mjs <viewform.html|data.json>'); process.exit(1) }
const raw = readFileSync(p, 'utf8')
let data
if (raw.trim().startsWith('[')) data = JSON.parse(raw)
else {
  const m = raw.match(/FB_PUBLIC_LOAD_DATA_ = (\[[\s\S]*?\]);\s*<\/script>/)
  if (!m) { console.error('FB_PUBLIC_LOAD_DATA_ 를 찾지 못했다(게시되지 않은 폼은 403 이다)'); process.exit(2) }
  data = JSON.parse(m[1])
}
// 관찰된 유형 번호(2026-10-12). 모르는 번호는 "미확인"으로 찍는다.
const TYPE = { 0: '단답형', 1: '장문형', 2: '객관식', 3: '드롭다운', 4: '체크박스', 5: '선형 배율', 7: '그리드', 9: '날짜', 10: '시간', 18: '등급' }
const items = data?.[1]?.[1] || []
console.log(`제목: ${data?.[1]?.[8] ?? '(없음)'}  항목 ${items.length}개`)
items.forEach((it, i) => {
  const [id, title, desc, type, detail] = it
  const d = Array.isArray(detail) ? detail[0] : null
  const opts = d?.[1]?.map((o) => o?.[0]).filter((x) => x != null) || []
  const grid = type === 7 ? (d?.[11]?.[0] === 1 ? '(체크박스 그리드)' : '(객관식 그리드)') : ''
  console.log(`${i + 1}. [${type}] ${TYPE[type] ?? '미확인'}${grid} "${title ?? ''}" 필수=${d?.[2] ? 1 : 0} 보기=${JSON.stringify(opts)}${d?.[3] ? ' 행/라벨=' + JSON.stringify(d[3]) : ''}`)
})
