// Aside REPL 에서 쓰는 관찰 실행기(조각 모음). 이 파일은 node 로 실행하지 않는다.
// REPL 에 아래 블록을 순서대로 붙여 넣는다. 구글에 만드는 파일은 모두 "[테스트] AI 관찰 ..." 이름이고, 끝에 휴지통으로 옮긴다.
// 계정: ?authuser=<메일> 로 지정(googleAccounts.print() 로 확인). 쿠키, 토큰은 출력하지 않는다.

// ── 1. 시트 수식 관찰 (643건, 요청 수십 개) ──────────────────────────
// const ACCT = 'smmilk2378@gmail.com'
// const t = await openTab(`https://docs.google.com/spreadsheets/create?authuser=${ACCT}`)
// const SID = t.url().match(/spreadsheets\/d\/([^/]+)/)[1]
// await t.locator('input.docs-title-input').click(); await t.keyboard.press('Meta+A'); await t.keyboard.type('[테스트] AI 관찰 수식'); await t.keyboard.press('Enter')
// // 배치 만들기: scripts/observe/layout.mjs 의 buildMatrix() 결과를 JSON 으로 저장해 둔 파일을 읽는다.
// //   node -e "import('./layout.mjs').then(m=>require('fs').writeFileSync('/tmp/matrix.json',JSON.stringify(m.buildMatrix().matrix)))"
// const matrix = JSON.parse(await fs.readFile('/tmp/matrix.json','utf8'))
// await googleSheets.connect(`https://docs.google.com/spreadsheets/d/${SID}/edit?authuser=${ACCT}`)
// await googleSheets.writeMatrix('A1', matrix)
// await googleSheets.writeMatrix('S1', [['=S1+1']]); await googleSheets.writeMatrix('S2', [['=T2','=S2']])   // 순환 사례
// await sleep(5000)
// const r = await fetch(`https://docs.google.com/spreadsheets/d/${SID}/export?format=csv&gid=0&authuser=${ACCT}`)
// await fs.writeFile('/tmp/gsheets-run.csv', await r.text())
// //   그다음 터미널: node build-corpus.mjs /tmp/gsheets-run.csv gsheets-observed.json

// ── 2. 문서: HTML 을 붙여 넣고 내보내기 형식 비교 ───────────────────
// const d = await openTab(`https://docs.google.com/document/create?authuser=${ACCT}`)
// const DOCID = d.url().match(/document\/d\/([^/]+)/)[1]
// await d.mouse.click(600, 500)
// await d.evaluate(async (h) => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([h], { type: 'text/html' }) })]) }, '<h1>제목</h1><ul><li>가</li></ul>')
// await d.keyboard.press('Meta+v')
// for (const f of ['html','txt','md','docx','odt']) {
//   const x = await fetch(`https://docs.google.com/document/d/${DOCID}/export?format=${f}&authuser=${ACCT}`)
//   await fs.writeFile(`/tmp/doc.${f}`, Buffer.from(await x.arrayBuffer()))
// }

// ── 3. 슬라이드: pptx 내보내기 후 레이아웃 확인 ──────────────────────
// const s = await openTab(`https://docs.google.com/presentation/create?authuser=${ACCT}`)
// const SLID = s.url().match(/presentation\/d\/([^/]+)/)[1]
// 주의: 슬라이드 탭에서 제목 칸을 locator 로 고르지 않고 키를 치면 입력이 Gemini 패널로 간다. 제목은 바꾸지 않는다.
// for (const f of ['pptx','pdf','txt']) {
//   const x = await fetch(`https://docs.google.com/presentation/d/${SLID}/export/${f}?authuser=${ACCT}`)
//   await fs.writeFile(`/tmp/deck.${f}`, Buffer.from(await x.arrayBuffer()))
// }
// //   터미널: unzip -p /tmp/deck.pptx ppt/slideLayouts/slideLayout3.xml | head -c 3000

// ── 4. 폼: 질문 유형 추가, 게시, viewform 구조 읽기 ──────────────────
// const f = await openTab(`https://docs.google.com/forms/u/0/create?authuser=${ACCT}`)
// const FORMID = f.url().match(/forms\/d\/([^/]+)/)[1]
// // 제목은 locator('설문지 제목 textbox').fill(...) 로 넣는다(키 입력은 Gemini 대화창을 열 수 있다).
// for (const ty of ['단답형','장문형','체크박스','드롭다운','선형 배율','등급','객관식 그리드','체크박스 그리드','날짜','시간']) {
//   await f.getByRole('button', { name: '질문 추가' }).click()
//   await f.getByRole('listbox', { name: '질문 유형' }).last().click()
//   await f.getByRole('option', { name: ty, exact: true }).last().click()
// }
// // 게시(게시 버튼 -> 대화상자 -> 게시)한 뒤에만 viewform 을 받을 수 있다(미게시는 403).
// const v = await fetch(`https://docs.google.com/forms/d/${FORMID}/viewform?authuser=${ACCT}`)
// await fs.writeFile('/tmp/viewform.html', await v.text())
// //   터미널: node forms-extract.mjs /tmp/viewform.html

// ── 5. 정리: 만든 파일을 모두 휴지통으로 ─────────────────────────────
// 시트, 문서: 탭에서 #docs-file-menu 클릭 -> "휴지통으로 이동". 슬라이드: 파일 메뉴 항목이 비활성일 수 있어 드라이브에서 지운다.
// 폼: 더보기 -> "휴지통으로 이동". 마지막에 https://drive.google.com/drive/u/0/trash 에서 네 개가 있는지 확인한다.
