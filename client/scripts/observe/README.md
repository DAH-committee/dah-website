# 관찰 도구 (구글 문서, 시트, 폼, 슬라이드 동작 기록)

목적: 구글 제품이 실제로 어떻게 동작하는지를 "내 계정 안에서 정상 사용으로" 관찰해, (1) 우리 시트 엔진의 적합성 시험 자료(corpus)와 (2) AI 설명서(`src/components/ai/knowledge/*.md`)의 근거를 만든다.
방법은 REA(Reverse Engineer Anything, https://github.com/morluto/rea, MIT)의 브라우저 분석 방식을 따른다: 화면 구조와 네트워크 사실을 관찰하고, 제품이 스스로 내려주는 문서와 내보내기 형식만 읽는다.

## 지킬 것 (범위)
- 내 계정에 만든 스크래치 파일(`[테스트] AI 관찰 ...`)만 쓴다. 다른 사람의 파일을 열지 않는다.
- 제품의 문서화된 내보내기 주소, 공개 도움말, 페이지가 정상 사용 중에 스스로 싣는 데이터(viewform 의 `FB_PUBLIC_LOAD_DATA_`)만 읽는다.
- 구글 자바스크립트를 해독하거나 코드와 로직을 베끼지 않는다. 비공개 API 를 부르지 않는다. 인증, 속도 제한을 우회하지 않는다. 요청은 수십 개 수준으로 유지한다.
- 쿠키, 토큰을 출력하지 않는다. 구글의 글, 아이콘, 로고를 제품에 복사하지 않는다.
- 끝나면 만든 파일을 모두 휴지통으로 옮기고 드라이브 휴지통에서 확인한다.

## 파일
- `sheets-cases.mjs`: 고정 데이터(A1:F20)와 수식 사례 목록(스칼라 약 520개, 배열 약 120개). 사례를 더하려면 여기에 `s('=수식', '메모')`, `a('=배열수식', '메모')` 한 줄을 넣는다.
- `layout.mjs`: 시트에 붙여 넣을 배치(스칼라는 H열, 배열은 J열 블록)를 만든다.
- `build-corpus.mjs`: 시트 CSV 내보내기를 읽어 `gsheets-observed.json` 을 만든다. `node build-corpus.mjs <csv> <out.json>`
- `run-corpus.mjs`: 우리 엔진을 corpus 와 비교해 불일치를 찍는다. `node scripts/observe/run-corpus.mjs [--json 결과.json] [--only gs-1]`
- `forms-extract.mjs`: viewform html(또는 FB_PUBLIC_LOAD_DATA_ json)에서 질문 유형 번호를 표로 찍는다.
- `aside-repl-run.js`: Aside 브라우저 REPL 에 붙여 넣는 실행 조각(스크래치 시트, 문서, 슬라이드, 폼을 만들고 내보내고 정리). node 로 실행하지 않는다.

## 순서
1. 시트: `aside-repl-run.js` 1번 블록으로 시트 만들기, 배치 붙여 넣기, CSV 받기. 그다음 `node build-corpus.mjs /tmp/gsheets-run.csv <repo>/client/src/components/admin/sheet/engine/__tests__/corpus/gsheets-observed.json`
2. 엔진 점검: `node scripts/observe/run-corpus.mjs`
3. 문서, 슬라이드: 2, 3번 블록. 내보낸 `doc.md/html/docx`, `deck.pptx` 를 열어 구조를 확인한다(docx, pptx 는 zip 이므로 `unzip -p <파일> word/document.xml` 등).
4. 폼: 4번 블록. 질문 유형을 추가하고 게시(미게시 폼은 viewform 이 403)한 뒤 `node forms-extract.mjs /tmp/viewform.html`
5. 정리: 5번 블록(휴지통, 확인).

## 만들어지는 것과 지워지는 것
- 만들어짐(구글): 시트 1, 문서 1, 슬라이드 1, 폼 1(이름 `[테스트] AI 관찰 ...`, 슬라이드와 폼은 파일 이름이 "제목 없는 ..."로 남을 수 있으니 반드시 만든 탭에서 지운다).
- 로컬 출력: `/tmp` 또는 지정한 경로의 csv, doc.*, deck.*, viewform.html, 그리고 corpus json.
- 정리 대상: 위 네 개 구글 파일(휴지통).

## 알아 둘 것
- CSV 는 "표시된 값"이다(일반 서식은 유효숫자 약 10자리). 정밀한 원값이 필요하면 `format=xlsx` 로 받는다(이번에는 쓰지 않음).
- 결과는 시트 설정(언어 대한민국, 시간대 서울)에 따라 달라지는 항목이 있다(요일, 월 이름, 날짜 해석, 정렬 순서). corpus 의 `localeDependent` 가 표시한다.
- 키 입력이 필요한 제목 바꾸기는 슬라이드, 폼에서 Gemini 입력창으로 들어갈 수 있다. 제목 칸을 locator 로 골라 `fill` 하거나 바꾸지 않는다.
- 구글 UI 가 바뀌면 `aside-repl-run.js` 의 선택자(listbox 이름 등)가 깨질 수 있다.
