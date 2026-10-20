# DAH Sheet 수식 엔진 (engine/) 계약

구글 시트 호환 수식 엔진. 순수 ESM, DOM 없음, Node와 브라우저에서 동일하게 동작, 외부 의존성 없음.
진입점은 `../formula.js`(기존 호환)와 `./index.js`(전체 API).

## 좌표 규칙

- 열 `c`는 0부터(A=0), 행 `r`은 1부터. `getRaw(c, r, sheetId)`가 `null`을 돌려주면 "격자 밖".
- 빈 칸은 `''` 또는 `null`이 아닌 `''`로 돌려준다(격자 안). 격자 밖만 `null`.
- 관찰 기준: `engine/__tests__/corpus/gsheets-observed.json`(구글 시트 ko-KR 실측 643건). 실행기 `__tests__/observed-runner.mjs`, 점수와 남은 불일치는 `FUNCTIONS.md` 하단.
- 현재 SheetWorkspace 연결: 1행은 머리글, 데이터는 2행부터. 엔진은 1행도 평범한 칸으로 본다.

## 1. 기존 호환 (SheetWorkspace가 쓰는 방식, 변경 없음)

```js
import { createEvaluator, colIndexOf, fmtNum } from './formula'
const evaluate = createEvaluator((c, r) => rawString | null, now?)   // -> (c, r) => 화면 표시 문자열
evaluate(c, r)
```

- 수식이 아닌 칸은 원본 문자열 그대로, 수식 칸은 계산 결과를 문자열로, 오류는 `#N/A` 같은 코드 문자열.
- 날짜 함수(TODAY, NOW, DATE, EDATE, EOMONTH, WORKDAY, TIME 등)가 최상위인 수식은 구글 ko-KR처럼 `2026. 9. 21`, `2026. 9. 21 오후 12:00:00`, `오후 12:00:00`로 표시한다. 옛 ISO 표시가 필요하면 `createEvaluator({ getRaw, dateStyle: 'iso' })`. ISO 글자로 입력한 날짜 칸에서 파생한 값은 ISO를 유지한다. 그 밖의 날짜 계산 결과는 숫자(일련번호)다. `locale: 'en'`으로 TEXT의 월·요일·AM/PM을 영어로 바꿀 수 있다.
- 배열 결과(펼침)는 빈 칸의 표시 함수 `evaluate(c, r)`가 자동으로 펼쳐진 값을 돌려준다. 단 getRaw가 빈 칸을 `''`(격자 안)으로 돌려줘야 한다.

## 2. 확장 API

```js
const ev = createEvaluator({
  getRaw(c, r, sheetId) {},      // 필수. 원본 문자열 또는 null(격자 밖)
  getBounds(sheetId) {},         // 선택. { rows, cols }. 없으면 getRaw로 탐색
  sheets: [{ id, name }],        // 선택. 'Sheet2!A1', "'내 시트'!A1" 해석용
  defaultSheet: id,              // 선택
  namedRanges: { 이름: 'Sheet1!A1:B3' },  // 선택
  now: () => new Date(),         // 선택. 시험·고정용
  random: Math.random,           // 선택
})
ev(c, r, sheetId?)               // 표시 문자열 (위와 같음)
ev.evaluateCell(sheetId, 'B2' | {c, r})
// -> { value, display, format, error?, spill?, spillBlocked?, spillOwner? }
//    value: number | string | boolean | null (오류면 '#N/A' 같은 코드 문자열)
//    error: { code, message(구글 영문 메시지), summary_ko }
//    spill: { rows, cols, values: any[][] }   // 이 칸이 원점이고 결과가 2칸 이상일 때. values[0][0]이 이 칸의 값
//    spillBlocked: true                       // 펼침이 막혀 value가 #REF!일 때
//    spillOwner: { sheetId, ref, c, r }       // 이 칸은 비어 있고 다른 칸 수식이 펼친 값일 때
//    format: 'date' | 'datetime' | 'time' | null   // 표시 서식 힌트
ev.spillCells(sheetId, 'B2')      // -> [{c, r}, ...] 이 칸 수식이 차지하는 영역(원점 포함). 없으면 []
ev.spillOwner(sheetId, 'C3')      // -> 소유자 정보 | null
ev.invalidate(sheetId, 'B2' | {c, r} | 'A1:C9' | [..])   // 호스트 데이터를 바꾼 뒤 호출. 의존하는 칸만 다시 계산
ev.refresh()                      // 전부 버림
ev.recalcVolatile()               // TODAY NOW RAND RANDBETWEEN 을 쓴 칸만 다시 계산
ev.stats()                        // { evals, cacheHits, invalidated, cached, spillers }
```

### UI(SA)가 펼침을 그리는 방법

1. 화면의 칸 (c, r)마다 `ev(c, r)` 또는 `ev.evaluateCell(sheetId, ref)` 호출. 펼쳐진 칸은 원본이 비어 있어도 값을 돌려준다.
2. 원점 칸 `evaluateCell(...).spill`이 있으면 `spillCells`로 영역을 얻어 시각적으로 표시(예: 옅은 배경).
3. 막힘: 원점 칸의 `error.code === '#REF!'`이고 `spillBlocked === true`이면 메시지 `Array result was not expanded because it would overwrite data in X.`를 그대로 보여 준다. 칸 편집 후 `invalidate`를 부르면 자동으로 다시 펼치거나 다시 막힌다.
4. 격자 밖으로 넘치면 `#REF!` `Result was not automatically expanded, please insert more rows (N).`

## 3. 정보·검증 API

```js
import { listFunctions, hasFunction, suggestFunction, validateFormula, evaluateFormulaOnce } from './engine/index.js'
listFunctions()        // [{ name, category, minArgs, maxArgs|null, signature, summary_ko, volatile?, aliasOf? }]
hasFunction('xlookup') // true
suggestFunction('SUMM')// 'SUM' (가까운 지원 함수 이름 또는 null)
validateFormula('=SUMIFS(A:A,B:B,">1")')
// -> { ok, error?, functionsUsed, unknownFunctions, refs, arityProblems, suggestions, mayArray }
//    ok=false: 구문 오류, 모르는 함수, 인수 개수 불일치. 계산하지 않고 부작용 없음.
evaluateFormulaOnce('=SUM(A1:A3)', { cells: { A1: '1', A2: '2' }, now })  // dry run. 시트를 건드리지 않음
// -> evaluateCell과 같은 모양 { value, display, error?, spill? }
```

`ctx.sheets: { 'Sheet1': { A1: '..' }, 'Sheet2': {...} }` 로 여러 시트를 줄 수 있다.

## 4. 오류 값 (구글과 같은 코드)

| 코드 | 쓰임 |
| --- | --- |
| `#DIV/0!` | 0으로 나눔 |
| `#N/A` | 못 찾음, 인수 개수 오류, 크기 안 맞는 배열 |
| `#NAME?` | 모르는 함수·이름 (`Unknown function: 'X'.`) |
| `#NUM!` | 숫자 범위 오류 |
| `#REF!` | 잘못된 참조, 순환 참조(`Circular dependency detected...`), 펼침 막힘 |
| `#VALUE!` | 값 형식 불일치 |
| `#ERROR!` | 구문 오류 |

옛 엔진의 `#CIRC!`는 구글처럼 `#REF!`로 바뀌었다.

## 5. 의미 규칙 요약 (구글과 다르게 둔 부분은 FUNCTIONS.md 하단 참고)

- 연산자: `+ - * / ^ & = <> < > <= >=`, 단항 `+ -`, 후위 `%`. 우선순위는 `% > ^ > * / > + - > & > 비교`, 단항 마이너스는 `^`보다 먼저 묶인다(`-2^2 = 4`).
- 비교: 숫자 < 텍스트 < 불리언, 텍스트는 대소문자 무시, 빈 칸은 상대 종류의 0 / "" / FALSE.
- 칸 입력 해석(구글과 같게): `1,234`, `50%`, `2026-01-05`, `2026-01-05 13:20`, `13:20`, `₩1,000`, `TRUE`, `FALSE` 는 숫자·불리언으로 읽는다. 앞에 `'` 를 붙이면 텍스트. 날짜는 1899-12-30 기준 일련번호.
- 배열: 여러 칸 범위 참조를 일반 수식의 연산자·원소별 함수·IF 조건에 쓰면 `#VALUE!`(관찰)이고, `ARRAYFORMULA`(또는 SUMPRODUCT, FILTER, SORT 등의 인수) 안에서는 원소별로 계산된다. 칸 하나만 가리키는 범위는 그 칸으로 취급. 함수가 만든 배열(`SEQUENCE` 등)은 어디서나 원소별로 계산된다. 크기가 다른 배열은 1행/1열만 늘려 맞추고 나머지는 `#N/A`.
- 펼침: 결과가 2칸 이상이면 오른쪽·아래 빈 칸으로 펼친다. 값이 있는 칸에 닿으면 `#REF!`.
- 휘발성: `TODAY NOW RAND RANDBETWEEN RANDARRAY`. `ev.invalidate(...)` 때 이 함수를 쓴 칸은 항상 다시 계산한다. `OFFSET`, `INDIRECT`는 참조를 계산 중에 기록하므로 따로 휘발성으로 두지 않아도 대상이 바뀌면 다시 계산된다.
- 증분 재계산: 칸 단위 의존 그래프(단일 칸 + 범위 열 색인). `invalidate` 한 번에 해당 칸에서 도달 가능한 칸만 버리고, 읽을 때 다시 계산한다.
- 깊은 사슬: 재귀 깊이가 120을 넘으면 정적 참조를 따라 의존 칸부터 반복 계산해 호출 스택 초과를 막는다.

## 6. 파일

- `index.js` 공개 API · `evaluator.js` 의존 그래프·펼침·연산자 · `parser.js` 구문 분석 · `registry.js` 함수 등록부
- `coerce.js` 형 변환·비교·조건 판별 · `dates.js` 일련번호 · `format.js` TEXT 서식 · `errors.js` 오류
- `fn/*.js` 함수 구현(math, logical, text, date, lookup, array, query, fin)
- `FUNCTIONS.md` 지원 함수 목록(생성물: `node engine/gen-functions.mjs`)

## 7. 시험

- `cd client && node --test src/components/admin/sheet/__tests__/*.test.mjs`
- `__tests__/conformance.test.mjs` : `__tests__/corpus/*.json` 전부 실행. 항목 `{ formula, cells?, sheets?, expected, note?, source }`. `gsheets-observed.json`(LB가 추가)이 있으면 같이 실행하고 불일치를 콘솔에 따로 출력한다.
- `__tests__/engine.test.mjs` : 펼침, 충돌, 증분 재계산, 순환, 휘발성, 다른 시트, 검증 API, 성능.
- `__tests__/legacy-compat.test.mjs` : `legacy-formula.mjs`(옛 엔진 사본)와 표시 결과 비교. 허용한 차이는 2가지(빈 칸 = 0 비교, ROUND 0.5 처리).
