#!/usr/bin/env node
// 사람이 워드와 한글에서 열어 볼 시험 파일 묶음을 만든다.
//   node make-kit.mjs [--out 폴더]
// 기본 출력: Aside 세션 artifacts/export-kit (환경변수 EXPORT_KIT_DIR 로도 지정). 5 MB 미만.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const docIR = path.resolve(here, '../../src/lib/docIR')
const DEFAULT_OUT = '/Users/juhyunho/.aside/u/0/sessions/2026-09-21_Q9ydVDXUUAhCXvXu/artifacts/export-kit'
const FIXED_NOW = Date.parse('2026-10-12T00:00:00Z')

// 시험 문서별 이름과 눈으로 볼 점
export const KIT_ITEMS = [
  { n: '01', slug: '멘토링보고서', fixture: 'mentoring-report', title: '한림멘토링 활동 보고서(화면 캡처 복제)', look: [
    '위 오른쪽에 로고 그림이 있고 제목(HY헤드라인M 계열)이 가운데에 있다',
    '"□ 멘토링 그룹 정보" 파란 음영 머리 행이 표 전체 폭으로 합쳐져 있다',
    '학과(전공), 교과목명, 그룹명 같은 라벨 칸에 연한 파란 음영이 있다',
    '"☑ 온라인(ZOOM)"은 체크됨, "☐ 오프라인"은 빈 칸으로 보인다',
    '"3명 중 3명"에 노란 형광펜이 있다',
    '"▪" 글머리와 양쪽 맞춤 글, 넉넉한 줄 간격이 유지된다',
    '두 쪽 이상으로 이어지고, 표 선이 얇은 검은 선이다'] },
  { n: '02', slug: '공문기안문', fixture: 'gian', title: '공문 기안문(두문, 본문, 결문, 결재란)', look: [
    '1. 가. 1) 가) 항목이 내어쓰기로 정렬되고 줄바꿈 뒤 글이 부호 뒤 글자에 맞춰진다',
    '붙임 줄과 "끝." 이 맞게 나온다',
    '오른쪽의 결재란 표(기안자, 검토자, 결재권자)가 한 줄에 깨지지 않고 있다',
    '결문 표(협조자, 시행, 우편번호, 전화, 전자우편)가 본문 폭에 맞는다'] },
  { n: '03', slug: '계획서', fixture: 'plan-report', title: '계획서(예산표, 중첩 글머리, 그림, 쪽 번호)', look: [
    '예산표의 "산출 내역" 머리 칸이 세 칸을 합쳐 놓았고 "구분/항목/금액(원)" 은 위아래로 합쳐져 있다',
    '숫자 칸이 오른쪽 정렬이고 합계 행이 맨 아래에 있다',
    '글머리 기호가 3단계까지 들여쓰기된다',
    '그림 밑에 "그림 1." 설명이 가운데로 있다',
    '쪽 아래 가운데에 "- 1 -" 형태의 쪽 번호가 있다'] },
  { n: '04', slug: '표시험', fixture: 'table-torture', title: '표 시험(병합, 선 모양, 대각선, 세로쓰기, 중첩, 긴 표)', look: [
    '병합 모음 표의 색칠된 병합 칸들이 서로 겹치거나 비지 않는다',
    '선 모양 표에서 이중선, 파선, 점선, 굵은 선, 선 없음이 각각 보인다',
    '대각선 칸에 \\, /, X 선이 보인다',
    '세로쓰기 칸의 글이 세로로 서 있다',
    '중첩 표가 바깥 칸 안에 들어 있다',
    '마지막 긴 표가 여러 쪽에 걸치고, 제목 두 줄이 쪽마다 반복되며, 행이 쪽 경계에서 반으로 갈라지지 않는다',
    '"쪽 경계를 가로지르는 5행 병합" 칸이 쪽이 바뀌어도 맞게 이어진다'] },
  { n: '05', slug: '글꼴문단', fixture: 'typography', title: '글꼴과 문단 서식', look: [
    '글꼴 5종이 각각 다르게 보이는지(없는 글꼴이면 대체되었다는 안내가 뜨는지)',
    '장평 90/100/110, 자간 -5/0/+5 가 눈에 보이게 다르다',
    '줄 간격 130/160/200%와 고정 18pt 문단의 줄 높이가 차례로 커진다',
    '맞춤(왼쪽, 가운데, 오른쪽, 양쪽, 배분)이 줄마다 다르다',
    '위첨자, 아래첨자, 형광펜, 취소선, 밑줄 네 가지가 보인다',
    '하이퍼링크가 파랗고 밑줄이 있다',
    '☑ ☐ 체크박스 글자 폭이 같다',
    '머리말(오른쪽)과 쪽 번호(가운데)가 있다'] },
  { n: '06', slug: '글꼴문단-가로쪽', fixture: 'typography-landscape', title: '가로 방향 쪽', look: [
    '쪽이 가로 방향으로 열린다',
    '표가 쪽 폭에 맞고 잘리지 않는다'] },
]

function reportEstimates(reportPath) {
  try {
    const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    return Object.fromEntries(r.items.map((i) => [i.id, { docx: i.variants?.docx?.pageCount ?? null, hwpx: i.variants?.hwpx?.pageCount ?? null }]))
  } catch { return {} }
}

export function readmeMd(items, est = {}) {
  const lines = []
  lines.push('# 내보내기 확인 키트 (워드 / 한글)')
  lines.push('')
  lines.push('목적: 편집기에서 내보낸 .docx(워드)와 .hwpx(한글)가 열 때 깨지지 않는지 사람 눈으로 확인한다. 프로그램으로는 워드와 한컴을 직접 열 수 없어서 이 마지막 확인은 사람이 해야 한다. 소요 시간은 약 5분이다.')
  lines.push('')
  lines.push('## 준비')
  lines.push('')
  lines.push('1. 이 폴더의 파일을 바탕화면 등에 복사한다. 원본은 건드리지 않는다.')
  lines.push('2. 각 번호마다 `.docx` 는 Word에서, `.hwpx` 는 한글(한컴오피스)에서 연다.')
  lines.push('3. 표시 없이 열리면 성공이고, "복구하시겠습니까?" 같은 안내가 뜨면 아래 표에 적는다.')
  lines.push('')
  lines.push('## 파일')
  lines.push('')
  lines.push('| 번호 | 파일 | 내용 | 자체 렌더 예상 쪽 수 (DOCX / HWPX) |')
  lines.push('|---|---|---|---|')
  for (const it of items) {
    const e = est[it.fixture] || {}
    lines.push(`| ${it.n} | ${it.n}-${it.slug}.docx / .hwpx | ${it.title} | ${e.docx ?? '?'} / ${e.hwpx ?? '?'} |`)
  }
  lines.push('')
  lines.push('예상 쪽 수는 우리가 브라우저와 kordoc 으로 그려 본 어림값이다. 실제 워드와 한글의 쪽 수는 이것과 다를 수 있고, 그 차이를 알아내는 것이 이 확인의 목적이다. 특히 긴 표가 있는 04번은 kordoc 이 표를 쪽 사이에서 나누지 못해 실제보다 적게 나온다.')
  lines.push('')
  lines.push('## 5분 점검표 (모든 파일 공통)')
  lines.push('')
  lines.push('각 파일을 열 때마다 아래를 본다.')
  lines.push('')
  lines.push('1. 열 때 오류나 복구 안내가 없는가')
  lines.push('2. 쪽 수가 몇 쪽인가 (아래 결과표에 적는다)')
  lines.push('3. 합쳐진 머리 행과 병합 칸이 맞게 합쳐져 있는가')
  lines.push('4. 음영(칸 배경색)이 맞는가')
  lines.push('5. 로고와 그림 위치가 맞는가(01번 오른쪽 위, 03번 가운데)')
  lines.push('6. 줄 간격이 너무 좁거나 넓지 않은가')
  lines.push('7. 글꼴이 다른 글꼴로 바뀌었다는 안내가 뜨는가. 뜬다면 어떤 글꼴인가')
  lines.push('8. ☑ ☐ 체크박스 글자가 제대로 나오는가(네모로 깨지지 않는가)')
  lines.push('9. 쪽 번호가 나오는가(03, 05번은 "- 1 -", 04번은 "- 1 / 전체 쪽 수 -")')
  lines.push('10. 인쇄 미리보기와 화면 모양이 같은가')
  lines.push('')
  lines.push('## 파일별로 특히 볼 점')
  lines.push('')
  for (const it of items) {
    lines.push(`### ${it.n} ${it.title}`)
    lines.push('')
    for (const l of it.look) lines.push(`- ${l}`)
    lines.push('')
  }
  lines.push('## 결과 적는 표')
  lines.push('')
  lines.push('칸에는 O(문제 없음), X(문제 있음), 숫자(쪽 수)를 적고, 문제가 있으면 오른쪽 메모 칸에 한 줄로 적는다.')
  lines.push('')
  lines.push('| 번호 | 프로그램 | 열림(오류 없음) | 쪽 수 | 병합 머리 행 | 음영 | 로고/그림 | 줄 간격 | 글꼴 대체 안내 | 체크박스 | 쪽 번호 | 인쇄 미리보기 같음 | 메모 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const it of items) {
    lines.push(`| ${it.n} | Word | | | | | | | | | | | |`)
    lines.push(`| ${it.n} | 한글 | | | | | | | | | | | |`)
  }
  lines.push('')
  lines.push('결과를 어떻게 보내는지는 `how-to-report.md` 에 있다.')
  lines.push('')
  return lines.join('\n')
}

export function howToReportMd(items) {
  return `# 확인 결과 보내는 방법

## 1. 결과표
README.md 아래쪽 결과표를 채워서 그대로 알려 준다. 메모 한 줄이면 충분하다.

## 2. 문제가 있을 때만 화면 캡처
문제가 있는 파일에 한해 아래 화면을 캡처한다. macOS는 Shift+Command+4 로 영역을 잡고, 한글과 Word 창을 각각 캡처한다.

- 열 때 뜬 오류나 복구 안내 창 (전체 화면)
- 문제가 보이는 쪽 한 장 (해당 쪽 전체가 보이게)
- 쪽 수가 예상과 다르면 첫 쪽과 마지막 쪽, 그리고 창 아래의 "쪽 수" 표시

## 3. 꼭 보내 주었으면 하는 캡처
${items.map((it) => `- ${it.n}-${it.slug}: Word 와 한글 각각 1쪽(그리고 2쪽이 있으면 2쪽). ${it.n === '04' ? '긴 표가 쪽을 넘어가는 지점 한 장 포함.' : ''}`.trim()).join('\n')}

## 4. 같이 알려 주면 좋은 것
- Word 버전과 한글 버전(한컴오피스 2020, 2022, 2024 등)과 운영체제
- 글꼴 대체 안내가 떴다면 안내 문구 그대로 (예: "HY헤드라인M 글꼴이 없어 다른 글꼴로 바꿨습니다")
- 파일을 다른 곳에서 열었는지(메일 첨부 등) 여부

## 5. 보내지 않아도 되는 것
- 이 키트의 문서는 시험용 가짜 내용이라 그대로 보내도 되지만, 보낼 필요는 없다. 결과표와 캡처면 충분하다.
- 실제 업무 문서는 보내지 않는다.

## 파일 다시 만들기
\`\`\`
cd client && node scripts/export-check/make-kit.mjs
\`\`\`
`
}

export async function makeKit(outDir = process.env.EXPORT_KIT_DIR || DEFAULT_OUT) {
  fs.mkdirSync(outDir, { recursive: true })
  const { loadFixture } = await import(pathToFileURL(path.join(docIR, 'fixtures/load.js')).href)
  const wd = await import(pathToFileURL(path.join(docIR, 'writeDocx.js')).href).catch(() => null)
  const wh = await import(pathToFileURL(path.join(docIR, 'writeHwpx.js')).href).catch(() => null)
  const written = []
  const problems = []
  for (const it of KIT_ITEMS) {
    const ir = loadFixture(it.fixture)
    for (const [ext, mod, fn] of [['docx', wd, 'writeDocx'], ['hwpx', wh, 'writeHwpx']]) {
      const file = path.join(outDir, `${it.n}-${it.slug}.${ext}`)
      if (!mod?.[fn]) { problems.push(`${it.n}.${ext}: 작성기 없음`); continue }
      try { const b = await mod[fn](ir, { now: FIXED_NOW }); fs.writeFileSync(file, b); written.push({ file, size: b.length }) } catch (e) { problems.push(`${it.n}.${ext}: ${e.message}`) }
    }
  }
  const est = reportEstimates(path.join(here, '.out', 'report.json'))
  fs.writeFileSync(path.join(outDir, 'README.md'), readmeMd(KIT_ITEMS, est))
  fs.writeFileSync(path.join(outDir, 'how-to-report.md'), howToReportMd(KIT_ITEMS))
  const total = fs.readdirSync(outDir).reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0)
  return { outDir, written, problems, totalBytes: total }
}

if (process.argv[1] && path.resolve(process.argv[1]).normalize('NFC') === fileURLToPath(import.meta.url).normalize('NFC')) {
  let out
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--out') out = path.resolve(process.argv[++i])
  const r = await makeKit(out)
  console.log(`키트: ${r.outDir}`)
  for (const w of r.written) console.log(`  ${path.basename(w.file)}  ${w.size} bytes`)
  if (r.problems.length) console.log('문제:', r.problems.join('; '))
  console.log(`합계 ${(r.totalBytes / 1024).toFixed(1)} KB`)
  if (r.totalBytes > 5 * 1024 * 1024) { console.error('5 MB 초과'); process.exit(1) }
}
