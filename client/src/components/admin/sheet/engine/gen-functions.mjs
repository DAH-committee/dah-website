// FUNCTIONS.md 생성: node engine/gen-functions.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFunctions, CATEGORIES } from './index.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fns = listFunctions()
const SRC = {
  math: ['수학', 'https://support.google.com/docs/table/25273 (Math 범주)'],
  stat: ['통계', 'https://support.google.com/docs/table/25273 (Statistical 범주)'],
  logical: ['논리', 'https://support.google.com/docs/table/25273 (Logical 범주)'],
  info: ['정보', 'https://support.google.com/docs/table/25273 (Info 범주)'],
  text: ['텍스트', 'https://support.google.com/docs/table/25273 (Text 범주), TEXT 서식: https://support.google.com/docs/answer/3094139'],
  date: ['날짜/시간', 'https://support.google.com/docs/table/25273 (Date 범주), 일련번호: https://support.google.com/docs/answer/3092991'],
  lookup: ['찾기/참조', 'https://support.google.com/docs/table/25273 (Lookup 범주)'],
  array: ['배열', 'https://support.google.com/docs/table/25273 (Array, Filter 범주), LAMBDA 계열: https://support.google.com/docs/answer/12508718'],
  query: ['쿼리', 'https://developers.google.com/chart/interactive/docs/querylanguage , https://support.google.com/docs/answer/3093343'],
  fin: ['재무', 'https://support.google.com/docs/table/25273 (Financial 범주)'],
  eng: ['엔지니어링', 'https://support.google.com/docs/table/25273 (Engineering 범주)'],
  op: ['연산자 함수', 'https://support.google.com/docs/table/25273 (Operator 범주)'],
}
const NOT_SUPPORTED = {
  '외부 데이터/네트워크': 'IMPORTRANGE IMPORTDATA IMPORTHTML IMPORTXML IMPORTFEED GOOGLEFINANCE GOOGLETRANSLATE DETECTLANGUAGE STOCKHISTORY',
  '시각화·셀 부가 요소': 'SPARKLINE IMAGE CELL INFO GETPIVOTDATA',
  '데이터베이스 함수': 'DAVERAGE DCOUNT DCOUNTA DGET DMAX DMIN DPRODUCT DSTDEV DSTDEVP DSUM DVAR DVARP',
  '행렬·회귀': 'MDETERM MINVERSE LINEST LOGEST TREND GROWTH',
  '통계 분포·검정': 'BETADIST BETAINV BINOMDIST CHIDIST CHIINV CHITEST CRITBINOM EXPONDIST FDIST FINV FTEST GAMMADIST GAMMAINV HYPGEOMDIST LOGNORMDIST NORMINV NORMSINV POISSON TDIST TINV TTEST WEIBULL ZTEST CONFIDENCE KURT STEYX PROB',
  '재무 일부': 'ACCRINT ACCRINTM AMORLINC COUPDAYBS COUPDAYS COUPDAYSNC COUPNCD COUPNUM COUPPCD CUMIPMT CUMPRINC DB DDB DISC DOLLARDE DOLLARFR DURATION INTRATE ISPMT MDURATION MIRR ODDFPRICE PRICE PRICEDISC PRICEMAT RECEIVED SYD TBILLEQ TBILLPRICE TBILLYIELD VDB XIRR XNPV YIELD YIELDDISC YIELDMAT',
  '복소수·특수함수': 'COMPLEX IMABS IMAGINARY IMARGUMENT IMCONJUGATE IMCOS IMDIV IMEXP IMLN IMPOWER IMPRODUCT IMREAL IMSIN IMSQRT IMSUB IMSUM ERF ERFC BESSELI BESSELJ BESSELK BESSELY',
  '텍스트 일부': 'ASC JIS LEFTB RIGHTB MIDB LENB FINDB SEARCHB REPLACEB',
  '그 밖': 'ISOMITTED(LAMBDA 선택 인수) 이름 있는 함수(Named functions) 사용자 정의 함수(Apps Script)',
}
const byCat = new Map()
for (const f of fns) { if (!byCat.has(f.category)) byCat.set(f.category, []); byCat.get(f.category).push(f) }
let md = `# 지원 함수 목록 (자동 생성)\n\n생성: \`node engine/gen-functions.mjs\` · 지원 함수 ${fns.length}개 (별칭 포함). AI 프롬프트에는 이 표의 이름과 인수 순서를 그대로 쓴다.\n\n`
md += `인수 표기: \`[ ]\`는 생략 가능, \`...\`는 반복 가능. 휘발성(매번 다시 계산) 함수는 이름 뒤에 \`*\`.\n\n`
for (const [cat, list] of byCat) {
  const [ko, src] = SRC[cat] || [cat, '']
  md += `## ${ko} (${list.length})\n\n근거: ${src}\n\n| 함수 | 형식 | 설명 |\n| --- | --- | --- |\n`
  for (const f of list) md += `| ${f.name}${f.volatile ? '*' : ''} | \`${f.signature}\` | ${f.summary_ko}${f.aliasOf ? ` (${f.aliasOf}와 같음)` : ''} |\n`
  md += '\n'
}
md += `## 지원하지 않는 구글 함수 (대표 목록, 사용하면 #NAME?)\n\n`
for (const [k, v] of Object.entries(NOT_SUPPORTED)) md += `- ${k}: ${v}\n`
md += `\n전체 구글 목록은 https://support.google.com/docs/table/25273 . 위에 없는 함수는 \`hasFunction(이름)\`으로 확인한다.\n\n`
md += `## 구글과 의도적으로 다르게 두었거나 아직 관찰로 확인하지 못한 동작\n\n`
md += [
  '관찰 기준: 2026-10-12 구글 시트(ko-KR, 서울 시간대)에서 얻은 643건(`engine/__tests__/corpus/gsheets-observed.json`)과 비교해 634건 일치. 남은 9건은 아래 "남은 불일치" 참고. 실행: `node __tests__/observed-runner.mjs`(null 설정값을 빈 칸으로 두고 고정 데이터 전체를 깐 실행기).',
  'ARRAYFORMULA 밖에서 여러 칸 범위를 연산자·원소별 함수·IF 조건에 쓰면 #VALUE!(관찰). 범위 하나만 쓴 `=B1:B3`은 펼치지만 관찰은 #VALUE!였고 "의심 항목"이라 따르지 않았다. 함수가 만든 배열(SEQUENCE, FILTER 등)은 어디서나 원소별 계산.',
  '빈 칸은 숫자 0, 빈 문자열 "", FALSE처럼 행동하고 ISBLANK만 TRUE. `=""` 수식 결과는 빈 칸이 아니다(COUNTA가 센다, COUNTIF(범위,"=")는 세지 않고 ""는 둘 다 센다).',
  '비교와 산술: 0.1+0.2=0.3은 TRUE(유효숫자 15자리 허용오차), 덧셈·뺄셈의 거의 0인 결과는 0, `0^0`=1, `(-8)^(1/3)`=-2(홀수 근만 실수), 숫자로 읽히는 텍스트는 IF 조건에서 #VALUE!, 빈 문자열 조건은 FALSE.',
  '일반 서식 표시는 유효숫자 10자리, 1E15 이상·1E-9 미만은 지수 표기(`1E+15`, `1.23457E+17`). 텍스트로 합칠 때는 15자리.',
  '날짜 표시(ko-KR): 함수가 만든 날짜는 `2025. 1. 1`, NOW는 `2026. 10. 12 오전 9:00:00`, 시간은 `오전 9:00:00`. ISO 글자(`2024-01-05`)로 입력한 칸과 그 칸에서 `+ -`로 파생한 값, 그 칸을 고르는 SORT/FILTER/UNIQUE/QUERY 결과 열은 입력 형식을 유지한다. `createEvaluator({dateStyle:"iso"})`면 함수 날짜도 ISO로 표시. DATEVALUE·TIMEVALUE는 숫자로 표시. 로캘 변경은 `locale:"en"`(TEXT의 월·요일·AM/PM 영어).',
  'TEXT 서식(ko-KR 관찰): 요일 `월요일`/`월`, 월 `1월`(mmm, mmmm 동일), `AM/PM`은 `오전/오후`, `a/p`는 `오`, `aaa`·`aaaa`·`q`는 서식이 아니라 글자 그대로, 따옴표 없는 `e`가 들어가면 #VALUE!, `@`는 값 그대로(숫자는 텍스트로), 분수 `# ?/?`·`?/?`·`# ?/8` 지원(0.5 -> `1/2`), 소수 15자리 이후는 0으로 채움, `[$-409]` 같은 로캘 태그는 무시. 조건 구간(`[>100]`)과 색상은 무시.',
  '오류 종류(관찰): INDEX·CHOOSE 범위 밖 #NUM!(의심 항목이나 지시에 따라 채택), MID 시작 0 #NUM!, CHAR(0) #NUM!, SEQUENCE(0) #NUM!, VLOOKUP 열 번호 초과 #REF!, XLOOKUP 찾는 범위가 2열이면 #N/A, FILTER 조건 길이 불일치 #N/A, SPLIT("",...) #VALUE!.',
  'COUNTIF류: 조건 `""`는 빈 칸과 ""를 모두, `"="`는 진짜 빈 칸만, `"<>"`는 ="" 도 센다. 날짜 m/d/yyyy 문자열은 날짜로 해석하지 않는다(ko-KR). `2024. 2. 29`는 날짜. SUMIF의 합계 범위는 조건 범위 크기로 맞춘다. SUMPRODUCT는 숫자 텍스트를 숫자로 본다.',
  'SORT·UNIQUE·FILTER: SORT는 인수 하나(`SORT(범위)`)도 되고 완전히 빈 행은 결과에서 빠진다. UNIQUE는 대소문자를 구분하고 빈 칸과 ""를 따로 센다. 텍스트 정렬은 ko-KR 근사(기호 < 이모지 < 숫자 < 한글 < 로마자, 대소문자 무시)이다. 룩업 함수의 첫 인수와 SUMIF/COUNTIF의 조건은 ARRAYFORMULA 안에서 배열이면 원소별로 계산한다. 배열 상수는 범위를 포함해 가로·세로로 이어붙이고 높이·너비가 다르면 #REF!.',
  'QUERY(관찰): 열 머리글은 집계 `sum 점수`, 식 `product(점수2())`, 나눗셈 ` quotient(sum 점수count 점수)`, 스칼라 함수 `upper(부서)`, `toDate(날짜)`, `dayofweek(날짜)`. `count(*)`는 #VALUE!. `where C != 92`는 빈 값도 포함. `format C \'0.0\'`은 표시에 적용(80.0). pivot 날짜 머리글은 `2024-1-5`. 열 형식이 섞이면 다수결 형식만 남김. 완전히 빈 입력 행은 버린다. `limit` 다음에 `offset`만 허용.',
  '바이트 함수 LENB·LEFTB·RIGHTB·MIDB는 ASCII가 아닌 글자를 모두 2바이트로 센다(관찰: `LENB("한글a")`=5). 짝이 깨진 서로게이트는 `?`로 표시(`LEFT("😀abc",1)`).',
  'LEN은 ISO 날짜 칸을 가리키면 표시 문자열 길이 10을 돌려준다(관찰). VALUE(날짜 칸)는 일련번호.',
  '열 전체 참조(`A:A`)는 시트의 현재 행 수까지다. `getBounds`의 rows가 기준이므로 구글의 시트 크기(관찰 시트 1723행)와 같아지려면 호스트가 같은 행 수를 알려 주면 된다.',
  '정규식은 JS 엔진이라 구글(RE2)이 거부하는 전방탐색·`\\p{Hangul}`·잘못된 패턴의 오류 종류가 다르다. 관찰에서 REGEXMATCH(12,"1")이 #VALUE!였으나 "의심 항목"이라 숫자 입력을 허용한다. 바꿀 글의 `\\2`는 숫자 `2` 글자(관찰), 그룹 참조는 `$2`.',
  'YEARFRAC 기준 1(실제/실제)은 여러 해에 걸칠 때 연평균 일수로 나눈다. 관찰값(531/365로 보이는 1.454794521)과 달라 불일치로 남아 있다.',
  'UNIQUE·SORT 외 MATCH의 텍스트 비교도 같은 ko-KR 근사 정렬을 쓴다. LEN·LEFT·MID·FIND는 UTF-16 코드 단위(관찰: `LEN("😀")`=2).',
  '순환 참조는 구글처럼 순환에 속한 모든 칸이 #REF!. 이름 있는 범위는 `namedRanges` 옵션으로만, 이름 있는 함수는 없다. R1C1은 ADDRESS의 네 번째 인수로만 출력하고 INDIRECT는 지원하지 않는다.',
  '단항 마이너스는 `^`보다 먼저 묶인다(`-2^2 = 4`, 구글 확인 전). 배열 상수 구분자는 쉼표(열)와 세미콜론(행).',
  '날짜 입력 해석: `2024-01-05`, `2024/1/5`, `2024. 2. 29`, `2024년 2월 29일`, `2024-01-05 13:20`, `13:20`, `1,234`, `50%`, `₩1,000`, TRUE/FALSE. 미국식 `2/29/2024`는 날짜가 아니다(ko-KR).',
].map((x) => `- ${x}`).join('\n')
md += `
## 관찰 대비 남은 불일치 (9건, 643건 중 634건 일치)

- 의심 항목이라 따르지 않음 (8건): gs-029 COUNTIF "~~x" (관찰 0, 우리 1), gs-487 REGEXMATCH(12,"1") #VALUE!, gs-499 REGEXEXTRACT(12345,..) #VALUE!, gs-507 REGEXREPLACE(12345,..) #VALUE!, gs-489 \\p{Hangul} #REF!, gs-491 잘못된 패턴 #REF!, gs-492 전방탐색 #REF!, gs-576 \`=B1:B3\` 단독 범위 #VALUE!.
- 원인 미확인 (1건): gs-325 YEARFRAC 기준 1 (관찰 1.454794521 = 532일 / 365.667, 우리는 연평균 365.33).
- 하네스 차이: 원본 \`scripts/observe/run-corpus.mjs\`는 setup의 null을 문자열 "null"로 칸에 넣고 고정 데이터 전체를 깔지 않아 OFFSET/INDIRECT/열 전체/빈 칸 사례가 엔진 밖 이유로 어긋난다. \`__tests__/observed-runner.mjs\`가 이를 고친 실행기다.
`
fs.writeFileSync(path.join(dir, 'FUNCTIONS.md'), md)
console.log(`FUNCTIONS.md: ${fns.length}개`)
