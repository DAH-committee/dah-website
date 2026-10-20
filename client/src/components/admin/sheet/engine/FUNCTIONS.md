# 지원 함수 목록 (자동 생성)

생성: `node engine/gen-functions.mjs` · 지원 함수 305개 (별칭 포함). AI 프롬프트에는 이 표의 이름과 인수 순서를 그대로 쓴다.

인수 표기: `[ ]`는 생략 가능, `...`는 반복 가능. 휘발성(매번 다시 계산) 함수는 이름 뒤에 `*`.

## 수학 (69)

근거: https://support.google.com/docs/table/25273 (Math 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| ABS | `ABS(값)` | 절댓값 |
| ACOS | `ACOS(값)` | 아크코사인 |
| ACOSH | `ACOSH(값)` | 역쌍곡코사인 |
| ACOT | `ACOT(값)` | 아크코탄젠트 |
| ARABIC | `ARABIC(로마 숫자)` | 로마 숫자를 숫자로 |
| ASIN | `ASIN(값)` | 아크사인 |
| ASINH | `ASINH(값)` | 역쌍곡사인 |
| ATAN | `ATAN(값)` | 아크탄젠트 |
| ATAN2 | `ATAN2(x, y)` | 두 좌표의 아크탄젠트 |
| ATANH | `ATANH(값)` | 역쌍곡탄젠트 |
| BASE | `BASE(수, 진법, [최소 자릿수])` | 수를 n진법 텍스트로 |
| CEILING | `CEILING(값, [배수])` | 배수로 올림 |
| CEILING.MATH | `CEILING.MATH(값, [배수], [모드])` | 배수로 올림(음수는 모드에 따라) |
| COMBIN | `COMBIN(n, k)` | 조합 수 |
| COS | `COS(값)` | 코사인 |
| COSH | `COSH(값)` | 쌍곡코사인 |
| COT | `COT(값)` | 코탄젠트 |
| CSC | `CSC(값)` | 코시컨트 |
| DECIMAL | `DECIMAL(텍스트, 진법)` | n진법 텍스트를 10진수로 |
| DEGREES | `DEGREES(라디안)` | 라디안을 도로 |
| EVEN | `EVEN(값)` | 0에서 먼 쪽 가장 가까운 짝수 |
| EXP | `EXP(값)` | e의 거듭제곱 |
| FACT | `FACT(값)` | 계승(n!) |
| FLOOR | `FLOOR(값, [배수])` | 배수로 내림 |
| FLOOR.MATH | `FLOOR.MATH(값, [배수], [모드])` | 배수로 내림(음수는 모드에 따라) |
| GCD | `GCD(값1, ...)` | 최대공약수 |
| INT | `INT(값)` | 가장 가까운 작은 정수로 내림 |
| ISEVEN | `ISEVEN(값)` | 짝수이면 TRUE |
| ISODD | `ISODD(값)` | 홀수이면 TRUE |
| LCM | `LCM(값1, ...)` | 최소공배수 |
| LN | `LN(값)` | 자연로그 |
| LOG | `LOG(값, [밑])` | 로그(밑 기본값 10) |
| LOG10 | `LOG10(값)` | 상용로그 |
| MMULT | `행렬곱 MMULT(행렬1, 행렬2)` | 두 행렬의 곱 |
| MOD | `MOD(나눠질 수, 나누는 수)` | 나머지(나누는 수와 같은 부호) |
| MROUND | `MROUND(값, 배수)` | 가장 가까운 배수로 반올림 |
| MULTINOMIAL | `MULTINOMIAL(값1, ...)` | 다항 계수 |
| ODD | `ODD(값)` | 0에서 먼 쪽 가장 가까운 홀수 |
| PERMUT | `PERMUT(n, k)` | 순열 수 |
| PI | `PI()` | 원주율 |
| POWER | `POWER(밑, 지수)` | 거듭제곱 |
| PRODUCT | `PRODUCT(값1, [값2, ...])` | 숫자의 곱 |
| QUOTIENT | `QUOTIENT(나눠질 수, 나누는 수)` | 나눗셈의 정수 몫 |
| RADIANS | `RADIANS(도)` | 도를 라디안으로 |
| RAND* | `RAND()` | 0 이상 1 미만 난수 |
| RANDARRAY* | `RANDARRAY([행], [열], [최소], [최대], [정수?])` | 난수 배열 |
| RANDBETWEEN* | `RANDBETWEEN(하한, 상한)` | 두 정수 사이 난수(양 끝 포함) |
| ROMAN | `ROMAN(숫자)` | 로마 숫자 텍스트 |
| ROUND | `ROUND(값, [자릿수])` | 반올림(0.5는 0에서 먼 쪽) |
| ROUNDDOWN | `ROUNDDOWN(값, [자릿수])` | 0에 가까운 쪽으로 내림 |
| ROUNDUP | `ROUNDUP(값, [자릿수])` | 0에서 먼 쪽으로 올림 |
| SEC | `SEC(값)` | 시컨트 |
| SIGN | `SIGN(값)` | 부호(-1, 0, 1) |
| SIN | `SIN(값)` | 사인 |
| SINH | `SINH(값)` | 쌍곡사인 |
| SQRT | `SQRT(값)` | 제곱근 |
| SQRTPI | `SQRTPI(값)` | PI 곱의 제곱근 |
| SUBTOTAL | `SUBTOTAL(함수코드, 범위1, ...)` | 코드로 고른 집계(1-11, 101-111) |
| SUM | `SUM(값1, [값2, ...])` | 숫자의 합계 |
| SUMIF | `SUMIF(범위, 조건, [합계범위])` | 조건에 맞는 칸의 합 |
| SUMIFS | `SUMIFS(합계범위, 조건범위1, 조건1, ...)` | 여러 조건을 모두 만족하는 칸의 합 |
| SUMPRODUCT | `SUMPRODUCT(배열1, [배열2, ...])` | 같은 위치 값끼리 곱해 모두 더함 |
| SUMSQ | `SUMSQ(값1, [값2, ...])` | 제곱의 합 |
| SUMX2MY2 | `SUMX2MY2(배열x, 배열y)` | x제곱 빼기 y제곱의 합 |
| SUMX2PY2 | `SUMX2PY2(배열x, 배열y)` | x제곱 더하기 y제곱의 합 |
| SUMXMY2 | `SUMXMY2(배열x, 배열y)` | (x-y) 제곱의 합 |
| TAN | `TAN(값)` | 탄젠트 |
| TANH | `TANH(값)` | 쌍곡탄젠트 |
| TRUNC | `TRUNC(값, [자릿수])` | 소수 자릿수에서 잘라냄 |

## 연산자 함수 (14)

근거: https://support.google.com/docs/table/25273 (Operator 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| ADD | `ADD(값1, 값2)` | 더하기(+) |
| DIVIDE | `DIVIDE(값1, 값2)` | 나누기(/) |
| EQ | `EQ(값1, 값2)` | 같다(=) |
| GT | `GT(값1, 값2)` | 크다(>) |
| GTE | `GTE(값1, 값2)` | 크거나 같다(>=) |
| LT | `LT(값1, 값2)` | 작다(<) |
| LTE | `LTE(값1, 값2)` | 작거나 같다(<=) |
| MINUS | `MINUS(값1, 값2)` | 빼기(-) |
| MULTIPLY | `MULTIPLY(값1, 값2)` | 곱하기(*) |
| NE | `NE(값1, 값2)` | 다르다(<>) |
| POW | `POW(밑, 지수)` | 거듭제곱(^), POWER와 같음 |
| UMINUS | `UMINUS(값)` | 부호 바꾸기(-) |
| UNARY_PERCENT | `UNARY_PERCENT(값)` | 백분율(%) |
| UPLUS | `UPLUS(값)` | 단항 플러스(+) |

## 찾기/참조 (15)

근거: https://support.google.com/docs/table/25273 (Lookup 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| ADDRESS | `ADDRESS(행, 열, [절대/상대=1], [A1 형식=TRUE], [시트 이름])` | 행·열 번호로 주소 텍스트 만들기 |
| CHOOSE | `CHOOSE(번호, 값1, 값2, ...)` | n번째 값을 고름 |
| COLUMN | `COLUMN([참조])` | 열 번호(A=1) |
| COLUMNS | `COLUMNS(범위)` | 범위의 열 수 |
| HLOOKUP | `HLOOKUP(찾을 값, 범위, 행 번호, [정렬됨=TRUE])` | 범위 첫 행에서 찾아 같은 열의 n번째 행 값을 돌려줌 |
| INDEX | `INDEX(참조, [행], [열])` | 범위의 n행 m열 값(0이면 전체 행/열) |
| INDIRECT | `INDIRECT(참조 텍스트, [A1 형식=TRUE])` | 텍스트로 된 주소를 참조로 바꿈 |
| LOOKUP | `LOOKUP(찾을 값, 찾을 범위, [결과 범위])` | 정렬된 한 줄에서 이하 최대 값을 찾아 결과를 돌려줌 |
| MATCH | `MATCH(찾을 값, 범위, [유형=1])` | 범위 안 위치 번호(유형 0=정확, 1=이하 최대, -1=이상 최소) |
| OFFSET | `OFFSET(시작 참조, 행 이동, 열 이동, [높이], [너비])` | 참조에서 떨어진 위치의 범위 |
| ROW | `ROW([참조])` | 행 번호 |
| ROWS | `ROWS(범위)` | 범위의 행 수 |
| VLOOKUP | `VLOOKUP(찾을 값, 범위, 열 번호, [정렬됨=TRUE])` | 범위 첫 열에서 찾아 같은 행의 n번째 열 값을 돌려줌(마지막 인수는 보통 FALSE) |
| XLOOKUP | `XLOOKUP(찾을 값, 찾을 범위, 결과 범위, [없을 때 값], [일치 모드=0], [검색 모드=1])` | 한 줄에서 찾아 결과 범위의 같은 위치 값을 돌려줌 |
| XMATCH | `XMATCH(찾을 값, 범위, [일치 모드=0], [검색 모드=1])` | 위치 번호(일치 0 정확, -1 이하, 1 이상, 2 와일드카드) |

## 논리 (12)

근거: https://support.google.com/docs/table/25273 (Logical 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| AND | `AND(논리1, [논리2, ...])` | 모두 참이면 TRUE |
| FALSE | `FALSE()` | 논리값 FALSE |
| IF | `IF(조건, 참일 때, [거짓일 때])` | 조건에 따라 값을 고름 |
| IFERROR | `IFERROR(값, [오류일 때 값])` | 오류이면 대체 값(기본 빈 문자열) |
| IFNA | `IFNA(값, #N/A일 때 값)` | #N/A이면 대체 값 |
| IFS | `IFS(조건1, 값1, [조건2, 값2, ...])` | 처음으로 참인 조건의 값 |
| ISBETWEEN | `ISBETWEEN(값, 하한, 상한, [하한 포함=TRUE], [상한 포함=TRUE])` | 값이 두 수 사이이면 TRUE |
| NOT | `NOT(논리)` | 참/거짓을 뒤집음 |
| OR | `OR(논리1, [논리2, ...])` | 하나라도 참이면 TRUE |
| SWITCH | `SWITCH(식, 값1, 결과1, ..., [기본값])` | 값이 일치하는 결과를 고름 |
| TRUE | `TRUE()` | 논리값 TRUE |
| XOR | `XOR(논리1, [논리2, ...])` | 참이 홀수 개이면 TRUE |

## 배열 (26)

근거: https://support.google.com/docs/table/25273 (Array, Filter 범주), LAMBDA 계열: https://support.google.com/docs/answer/12508718

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| ARRAY_CONSTRAIN | `ARRAY_CONSTRAIN(배열, 행 수, 열 수)` | 배열을 앞쪽 n행 m열로 자름 |
| ARRAYFORMULA | `ARRAYFORMULA(수식)` | 안쪽 수식을 배열 모드로 계산해 결과를 펼침 |
| BYCOL | `BYCOL(배열, LAMBDA(열))` | 열마다 람다 적용(한 행 결과) |
| BYROW | `BYROW(배열, LAMBDA(행))` | 행마다 람다 적용(한 열 결과) |
| CHOOSECOLS | `CHOOSECOLS(배열, 열1, ...)` | 지정한 열만 골라냄 |
| CHOOSEROWS | `CHOOSEROWS(배열, 행1, ...)` | 지정한 행만 골라냄 |
| FILTER | `FILTER(범위, 조건1, [조건2, ...])` | 조건이 참인 행(또는 열)만 남김 |
| FLATTEN | `FLATTEN(범위1, ...)` | 여러 범위를 한 열로 펼침 |
| HSTACK | `HSTACK(범위1, ...)` | 가로로 이어붙임(모자라면 #N/A) |
| LAMBDA | `LAMBDA(이름1, ..., 식)` | 이름 있는 매개변수를 쓰는 함수 값 |
| LET | `LET(이름1, 값1, ..., 식)` | 식 안에서 쓸 이름 정의 |
| MAKEARRAY | `MAKEARRAY(행, 열, LAMBDA(행, 열))` | 행·열 번호로 값을 만드는 배열 |
| MAP | `MAP(배열1, [배열2, ...], LAMBDA)` | 각 원소에 람다를 적용한 같은 크기의 배열 |
| MUNIT | `MUNIT(크기)` | 단위 행렬 |
| REDUCE | `REDUCE(초기값, 배열, LAMBDA(누적, 값, ...))` | 배열을 하나의 값으로 누적 |
| SCAN | `SCAN(초기값, 배열, LAMBDA(누적, 값, ...))` | 누적 과정을 모두 담은 같은 크기 배열 |
| SEQUENCE | `SEQUENCE(행, [열=1], [시작=1], [증가=1])` | 연속 숫자 배열 |
| SORT | `SORT(범위, 정렬 열, 오름차순?, [정렬 열2, 오름차순2, ...])` | 열 기준으로 행 정렬(빈 칸은 맨 뒤) |
| SORTN | `SORTN(범위, [n], [동점 처리], [정렬 열], [오름차순], ...)` | 정렬 후 앞의 n행(동점 처리 0=n행까지 1=동점 포함 2=중복 제거 3=동점 중복 제거) |
| TOCOL | `TOCOL(배열, [무시 0~3], [열 우선?])` | 한 열로 펼침(무시: 1 빈 칸, 2 오류, 3 둘 다) |
| TOROW | `TOROW(배열, [무시 0~3], [열 우선?])` | 한 행으로 펼침 |
| TRANSPOSE | `TRANSPOSE(배열)` | 행과 열 바꾸기 |
| UNIQUE | `UNIQUE(범위, [열 기준?], [한 번만 나온 것만?])` | 중복 행 제거(텍스트는 대소문자 구분, 빈 칸과 ""는 다른 값) |
| VSTACK | `VSTACK(범위1, ...)` | 세로로 이어붙임(모자라면 #N/A) |
| WRAPCOLS | `WRAPCOLS(벡터, 행 수, [채울 값])` | 한 줄을 n개씩 끊어 열로 |
| WRAPROWS | `WRAPROWS(벡터, 열 수, [채울 값])` | 한 줄을 n개씩 끊어 행으로 |

## 텍스트 (42)

근거: https://support.google.com/docs/table/25273 (Text 범주), TEXT 서식: https://support.google.com/docs/answer/3094139

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| ARRAYTOTEXT | `ARRAYTOTEXT(배열, [형식])` | 배열을 텍스트로(0 간단, 1 엄격) |
| CHAR | `CHAR(숫자)` | 유니코드 번호의 문자 |
| CLEAN | `CLEAN(텍스트)` | 인쇄되지 않는 문자 제거 |
| CODE | `CODE(텍스트)` | 첫 글자의 유니코드 번호 |
| CONCAT | `CONCAT(값1, 값2)` | 두 값 이어붙이기 |
| CONCATENATE | `CONCATENATE(텍스트1, [텍스트2, ...])` | 텍스트 이어붙이기(범위는 모든 칸을 이어붙임, ARRAYFORMULA 안에서는 원소별) |
| DOLLAR | `DOLLAR(숫자, [소수 자릿수])` | $ 표시 통화 텍스트 |
| EXACT | `EXACT(텍스트1, 텍스트2)` | 대소문자까지 같으면 TRUE |
| FIND | `FIND(찾을 글, 텍스트, [시작])` | 대소문자 구분해 위치 찾기 |
| FIXED | `FIXED(숫자, [소수 자릿수], [쉼표 생략?])` | 고정 소수 자릿수 텍스트 |
| HYPERLINK | `HYPERLINK(URL, [표시 텍스트])` | 링크(표시 텍스트 또는 URL 값을 돌려줌) |
| JOIN | `JOIN(구분자, 값1, ...)` | 구분자로 값/배열 잇기 |
| LEFT | `LEFT(텍스트, [개수])` | 왼쪽에서 n글자(기본 1) |
| LEFTB | `LEFTB(텍스트, [바이트 수])` | 왼쪽에서 n바이트 |
| LEN | `LEN(텍스트)` | 글자 수(UTF-16 코드 단위). 날짜 칸은 표시 문자열 길이 |
| LENB | `LENB(텍스트)` | 바이트 수(한글 2바이트) |
| LOWER | `LOWER(텍스트)` | 소문자로 |
| MID | `MID(텍스트, 시작, 길이)` | 가운데 부분 추출(시작은 1부터) |
| MIDB | `MIDB(텍스트, 시작, 바이트 수)` | 가운데 n바이트 |
| NUMBERVALUE | `NUMBERVALUE(텍스트, [소수점 기호], [그룹 기호])` | 지정한 기호로 텍스트를 숫자로 |
| PROPER | `PROPER(텍스트)` | 단어 첫 글자만 대문자로 |
| REGEXEXTRACT | `REGEXEXTRACT(텍스트, 정규식)` | 정규식에 처음 일치한 부분(캡처 그룹이 있으면 그룹) |
| REGEXMATCH | `REGEXMATCH(텍스트, 정규식)` | 정규식에 부분 일치하면 TRUE |
| REGEXREPLACE | `REGEXREPLACE(텍스트, 정규식, 바꿀 글)` | 정규식에 일치하는 모든 부분 바꾸기 |
| REPLACE | `REPLACE(텍스트, 위치, 길이, 새 글)` | 지정 위치의 글자 교체 |
| REPT | `REPT(텍스트, 횟수)` | 텍스트 반복 |
| RIGHT | `RIGHT(텍스트, [개수])` | 오른쪽에서 n글자(기본 1) |
| RIGHTB | `RIGHTB(텍스트, [바이트 수])` | 오른쪽에서 n바이트 |
| SEARCH | `SEARCH(찾을 글, 텍스트, [시작])` | 대소문자 무시, 와일드카드(? *) 사용 위치 찾기 |
| SPLIT | `SPLIT(텍스트, 구분자, [각 글자로 나눔?], [빈 값 제거?])` | 구분자로 나눠 가로 배열로 |
| SUBSTITUTE | `SUBSTITUTE(텍스트, 찾을 글, 바꿀 글, [몇 번째])` | 글자 바꾸기(대소문자 구분) |
| TEXT | `TEXT(값, 서식)` | 서식 문자열에 맞춰 텍스트로 변환 |
| TEXTJOIN | `TEXTJOIN(구분자, 빈 칸 무시?, 텍스트1, ...)` | 구분자로 여러 텍스트 잇기 |
| TO_DOLLARS | `TO_DOLLARS(값)` | 숫자를 통화 값으로(값 자체는 유지) |
| TO_PERCENT | `TO_PERCENT(값)` | 숫자를 퍼센트 값으로(값 자체는 유지) |
| TO_PURE_NUMBER | `TO_PURE_NUMBER(값)` | 서식을 뗀 숫자 |
| TO_TEXT | `TO_TEXT(값)` | 값을 텍스트로 |
| TRIM | `TRIM(텍스트)` | 앞뒤 공백 제거, 가운데 연속 공백은 하나로 |
| UNICHAR | `UNICHAR(숫자)` | 유니코드 번호의 문자 |
| UNICODE | `UNICODE(텍스트)` | 첫 글자의 유니코드 번호 |
| UPPER | `UPPER(텍스트)` | 대문자로 |
| VALUE | `VALUE(텍스트)` | 숫자·날짜·퍼센트 텍스트를 숫자로 |

## 통계 (54)

근거: https://support.google.com/docs/table/25273 (Statistical 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| AVEDEV | `AVEDEV(값1, ...)` | 평균 절대 편차 |
| AVERAGE | `AVERAGE(값1, [값2, ...])` | 숫자의 평균 |
| AVERAGEA | `AVERAGEA(값1, [값2, ...])` | 텍스트는 0, TRUE는 1로 보는 평균 |
| AVERAGEIF | `AVERAGEIF(범위, 조건, [평균범위])` | 조건에 맞는 칸의 평균 |
| AVERAGEIFS | `AVERAGEIFS(평균범위, 조건범위1, 조건1, ...)` | 여러 조건을 만족하는 칸의 평균 |
| CORREL | `CORREL(데이터y, 데이터x)` | 상관계수 |
| COUNT | `COUNT(값1, [값2, ...])` | 숫자 개수 |
| COUNTA | `COUNTA(값1, [값2, ...])` | 비어 있지 않은 칸 개수 |
| COUNTBLANK | `COUNTBLANK(범위1, ...)` | 빈 칸(빈 문자열 포함) 개수 |
| COUNTIF | `COUNTIF(범위, 조건)` | 조건에 맞는 칸 개수 |
| COUNTIFS | `COUNTIFS(조건범위1, 조건1, ...)` | 여러 조건을 모두 만족하는 칸 개수 |
| COUNTUNIQUE | `COUNTUNIQUE(값1, ...)` | 중복 없는 값 개수 |
| COVAR | `COVAR(데이터y, 데이터x)` | 모집단 공분산 |
| DEVSQ | `DEVSQ(값1, ...)` | 편차 제곱합 |
| FORECAST | `FORECAST(x, 데이터y, 데이터x)` | 선형 회귀 예측값 |
| FORECAST.LINEAR | `FORECAST.LINEAR(x, 데이터y, 데이터x)` | 선형 회귀 예측값 (FORECAST와 같음) |
| FREQUENCY | `FREQUENCY(데이터, 구간)` | 구간별 빈도 배열 |
| GEOMEAN | `GEOMEAN(값1, ...)` | 기하평균 |
| INTERCEPT | `INTERCEPT(데이터y, 데이터x)` | 회귀직선 절편 |
| LARGE | `LARGE(데이터, n)` | n번째로 큰 값 |
| MAX | `MAX(값1, [값2, ...])` | 최댓값 |
| MAXA | `MAXA(값1, [값2, ...])` | 텍스트는 0으로 보는 최댓값 |
| MAXIFS | `MAXIFS(범위, 조건범위1, 조건1, ...)` | 조건을 만족하는 칸의 최댓값 |
| MEDIAN | `MEDIAN(값1, ...)` | 중앙값 |
| MIN | `MIN(값1, [값2, ...])` | 최솟값 |
| MINA | `MINA(값1, [값2, ...])` | 텍스트는 0으로 보는 최솟값 |
| MINIFS | `MINIFS(범위, 조건범위1, 조건1, ...)` | 조건을 만족하는 칸의 최솟값 |
| MODE | `MODE(값1, ...)` | 최빈값(동률이면 먼저 나온 값) |
| MODE.SNGL | `MODE.SNGL(값1, ...)` | 최빈값(동률이면 먼저 나온 값) (MODE와 같음) |
| NORM.DIST | `NORM.DIST(x, 평균, 표준편차, [누적?=TRUE])` | 정규분포 |
| NORM.S.DIST | `NORM.S.DIST(z, [누적?=TRUE])` | 표준정규분포 |
| NORMSDIST | `NORMSDIST(z)` | 표준정규 누적분포 |
| PERCENTILE | `PERCENTILE(데이터, 백분위)` | 백분위수(0~1, 선형 보간) |
| PERCENTILE.INC | `PERCENTILE.INC(데이터, 백분위)` | 백분위수(0~1, 선형 보간) (PERCENTILE와 같음) |
| PERCENTRANK | `PERCENTRANK(데이터, 값, [유효숫자=3])` | 데이터 안에서의 백분위 순위 |
| QUARTILE | `QUARTILE(데이터, 사분위)` | 사분위수(0~4) |
| QUARTILE.INC | `QUARTILE.INC(데이터, 사분위)` | 사분위수(0~4) (QUARTILE와 같음) |
| RANK | `RANK(값, 데이터, [오름차순?])` | 데이터 안에서의 순위(동순위는 같은 값) |
| RANK.EQ | `RANK.EQ(값, 데이터, [오름차순?])` | 데이터 안에서의 순위(동순위는 같은 값) (RANK와 같음) |
| RSQ | `RSQ(데이터y, 데이터x)` | 결정계수 R^2 |
| SKEW | `SKEW(값1, ...)` | 표본 왜도 |
| SLOPE | `SLOPE(데이터y, 데이터x)` | 회귀직선 기울기 |
| SMALL | `SMALL(데이터, n)` | n번째로 작은 값 |
| STANDARDIZE | `STANDARDIZE(x, 평균, 표준편차)` | 표준화 값 |
| STDEV | `STDEV(값1, ...)` | 표본 표준편차 |
| STDEV.P | `STDEV.P(값1, ...)` | 모집단 표준편차 (STDEVP와 같음) |
| STDEV.S | `STDEV.S(값1, ...)` | 표본 표준편차 (STDEV와 같음) |
| STDEVP | `STDEVP(값1, ...)` | 모집단 표준편차 |
| TRIMMEAN | `TRIMMEAN(데이터, 제외 비율)` | 양 끝을 잘라낸 평균 |
| VAR | `VAR(값1, ...)` | 표본 분산 |
| VAR.P | `VAR.P(값1, ...)` | 모집단 분산 (VARP와 같음) |
| VAR.S | `VAR.S(값1, ...)` | 표본 분산 (VAR와 같음) |
| VARA | `VARA(값1, ...)` | 표본 분산(텍스트 0) |
| VARP | `VARP(값1, ...)` | 모집단 분산 |

## 엔지니어링 (14)

근거: https://support.google.com/docs/table/25273 (Engineering 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| BIN2DEC | `BIN2DEC(수, [자릿수])` | BIN진수를 DEC진수로 |
| BITAND | `BITAND(값1, 값2)` | 비트 AND |
| BITLSHIFT | `BITLSHIFT(값, 이동량)` | 비트 왼쪽 이동 |
| BITOR | `BITOR(값1, 값2)` | 비트 OR |
| BITRSHIFT | `BITRSHIFT(값, 이동량)` | 비트 오른쪽 이동 |
| BITXOR | `BITXOR(값1, 값2)` | 비트 XOR |
| CONVERT | `CONVERT(값, 원래 단위, 바꿀 단위)` | 단위 변환(길이 질량 시간 부피 넓이 일부, 온도 C F K) |
| DEC2BIN | `DEC2BIN(수, [자릿수])` | DEC진수를 BIN진수로 |
| DEC2HEX | `DEC2HEX(수, [자릿수])` | DEC진수를 HEX진수로 |
| DEC2OCT | `DEC2OCT(수, [자릿수])` | DEC진수를 OCT진수로 |
| DELTA | `DELTA(값1, [값2=0])` | 두 수가 같으면 1 |
| GESTEP | `GESTEP(값, [기준=0])` | 값이 기준 이상이면 1 |
| HEX2DEC | `HEX2DEC(수, [자릿수])` | HEX진수를 DEC진수로 |
| OCT2DEC | `OCT2DEC(수, [자릿수])` | OCT진수를 DEC진수로 |

## 날짜/시간 (27)

근거: https://support.google.com/docs/table/25273 (Date 범주), 일련번호: https://support.google.com/docs/answer/3092991

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| DATE | `DATE(년, 월, 일)` | 년·월·일로 날짜 만들기 |
| DATEDIF | `DATEDIF(시작일, 종료일, 단위)` | 두 날짜의 차이(Y M D MD YM YD) |
| DATEVALUE | `DATEVALUE(텍스트)` | 날짜 텍스트를 일련번호로 |
| DAY | `DAY(날짜)` | 일 |
| DAYS | `DAYS(끝, 시작)` | 두 날짜 사이 일수 |
| DAYS360 | `DAYS360(시작일, 종료일, [유럽식?])` | 30일/월 기준 일수 |
| EDATE | `EDATE(시작일, 개월 수)` | 개월을 더한 날짜 |
| EOMONTH | `EOMONTH(시작일, 개월 수)` | 개월을 더한 달의 마지막 날 |
| EPOCHTODATE | `EPOCHTODATE(타임스탬프, [단위])` | 유닉스 시간을 날짜·시각으로(단위 1=초 2=밀리초 3=마이크로초) |
| HOUR | `HOUR(시간)` | 시 |
| ISOWEEKNUM | `ISOWEEKNUM(날짜)` | ISO 주 번호 |
| MINUTE | `MINUTE(시간)` | 분 |
| MONTH | `MONTH(날짜)` | 월 |
| NETWORKDAYS | `NETWORKDAYS(시작일, 종료일, [휴일])` | 토·일을 뺀 근무일 수 |
| NETWORKDAYS.INTL | `NETWORKDAYS.INTL(시작일, 종료일, [주말], [휴일])` | 주말 규칙을 지정한 근무일 수 |
| NOW* | `NOW()` | 지금 날짜와 시각(휘발성) |
| SECOND | `SECOND(시간)` | 초 |
| TIME | `TIME(시, 분, 초)` | 시·분·초로 하루 중 비율 만들기 |
| TIMEVALUE | `TIMEVALUE(텍스트)` | 시간 텍스트를 하루 중 비율(0~1)로 |
| TO_DATE | `TO_DATE(값)` | 숫자를 날짜로(표시 서식이 날짜) |
| TODAY* | `TODAY()` | 오늘 날짜(휘발성) |
| WEEKDAY | `WEEKDAY(날짜, [유형])` | 요일 번호(유형 1: 일=1, 2: 월=1, 3: 월=0, 11~17) |
| WEEKNUM | `WEEKNUM(날짜, [유형])` | 주 번호(유형 1: 일요일 시작, 2: 월요일 시작, 11~17, 21: ISO) |
| WORKDAY | `WORKDAY(시작일, 일수, [휴일])` | 근무일 기준 n일 뒤 날짜 |
| WORKDAY.INTL | `WORKDAY.INTL(시작일, 일수, [주말], [휴일])` | 주말 규칙을 지정한 n 근무일 뒤 날짜 |
| YEAR | `YEAR(날짜)` | 연도 |
| YEARFRAC | `YEARFRAC(시작일, 종료일, [기준])` | 두 날짜 사이 연 단위 비율(기준 0~4) |

## 재무 (12)

근거: https://support.google.com/docs/table/25273 (Financial 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| EFFECT | `EFFECT(명목이율, 연 복리 횟수)` | 실효 연이율 |
| FV | `FV(이율, 기간 수, 납입액, [현재가치=0], [납입시점=0])` | 미래가치 |
| IPMT | `IPMT(이율, 기간, 기간 수, 현재가치, [미래가치=0], [납입시점=0])` | 특정 기간의 이자 납입액 |
| IRR | `IRR(현금흐름, [추정값=0.1])` | 내부수익률 |
| NOMINAL | `NOMINAL(실효이율, 연 복리 횟수)` | 명목 연이율 |
| NPER | `NPER(이율, 납입액, 현재가치, [미래가치=0], [납입시점=0])` | 납입 횟수 |
| NPV | `NPV(할인율, 현금흐름1, ...)` | 순현재가치(첫 현금흐름은 1기말) |
| PMT | `PMT(이율, 기간 수, 현재가치, [미래가치=0], [납입시점=0])` | 정기 납입액 |
| PPMT | `PPMT(이율, 기간, 기간 수, 현재가치, [미래가치=0], [납입시점=0])` | 특정 기간의 원금 납입액 |
| PV | `PV(이율, 기간 수, 납입액, [미래가치=0], [납입시점=0])` | 현재가치 |
| RATE | `RATE(기간 수, 납입액, 현재가치, [미래가치=0], [납입시점=0], [추정값=0.1])` | 기간당 이율 |
| SLN | `SLN(취득가, 잔존가, 내용연수)` | 정액법 감가상각 |

## 정보 (19)

근거: https://support.google.com/docs/table/25273 (Info 범주)

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| ERROR.TYPE | `ERROR.TYPE(오류값)` | 오류 종류 번호(#DIV/0!=2, #VALUE!=3, #REF!=4, #NAME?=5, #NUM!=6, #N/A=7) |
| FORMULATEXT | `FORMULATEXT(참조)` | 칸의 수식 원문 |
| ISBLANK | `ISBLANK(값)` | 빈 칸이면 TRUE |
| ISDATE | `ISDATE(값)` | 날짜로 읽히면 TRUE |
| ISEMAIL | `ISEMAIL(값)` | 이메일 형식이면 TRUE |
| ISERR | `ISERR(값)` | #N/A를 제외한 오류이면 TRUE |
| ISERROR | `ISERROR(값)` | 오류이면 TRUE |
| ISFORMULA | `ISFORMULA(참조)` | 수식이 들어 있는 칸이면 TRUE |
| ISLOGICAL | `ISLOGICAL(값)` | 불리언이면 TRUE |
| ISNA | `ISNA(값)` | #N/A이면 TRUE |
| ISNONTEXT | `ISNONTEXT(값)` | 텍스트가 아니면 TRUE |
| ISNUMBER | `ISNUMBER(값)` | 숫자이면 TRUE |
| ISREF | `ISREF(값)` | 참조이면 TRUE |
| ISTEXT | `ISTEXT(값)` | 텍스트이면 TRUE |
| ISURL | `ISURL(값)` | URL 형식이면 TRUE |
| N | `N(값)` | 숫자로 변환(텍스트는 0) |
| NA | `NA()` | #N/A 오류를 만듦 |
| T | `T(값)` | 텍스트이면 그대로, 아니면 빈 문자열 |
| TYPE | `TYPE(값)` | 값 종류 코드(1 숫자, 2 텍스트, 4 불리언, 16 오류, 64 배열) |

## 쿼리 (1)

근거: https://developers.google.com/chart/interactive/docs/querylanguage , https://support.google.com/docs/answer/3093343

| 함수 | 형식 | 설명 |
| --- | --- | --- |
| QUERY | `QUERY(데이터, 쿼리, [머리글 줄 수])` | Google 시각화 쿼리 언어(select where group by pivot order by limit offset label)로 표를 조회 |

## 지원하지 않는 구글 함수 (대표 목록, 사용하면 #NAME?)

- 외부 데이터/네트워크: IMPORTRANGE IMPORTDATA IMPORTHTML IMPORTXML IMPORTFEED GOOGLEFINANCE GOOGLETRANSLATE DETECTLANGUAGE STOCKHISTORY
- 시각화·셀 부가 요소: SPARKLINE IMAGE CELL INFO GETPIVOTDATA
- 데이터베이스 함수: DAVERAGE DCOUNT DCOUNTA DGET DMAX DMIN DPRODUCT DSTDEV DSTDEVP DSUM DVAR DVARP
- 행렬·회귀: MDETERM MINVERSE LINEST LOGEST TREND GROWTH
- 통계 분포·검정: BETADIST BETAINV BINOMDIST CHIDIST CHIINV CHITEST CRITBINOM EXPONDIST FDIST FINV FTEST GAMMADIST GAMMAINV HYPGEOMDIST LOGNORMDIST NORMINV NORMSINV POISSON TDIST TINV TTEST WEIBULL ZTEST CONFIDENCE KURT STEYX PROB
- 재무 일부: ACCRINT ACCRINTM AMORLINC COUPDAYBS COUPDAYS COUPDAYSNC COUPNCD COUPNUM COUPPCD CUMIPMT CUMPRINC DB DDB DISC DOLLARDE DOLLARFR DURATION INTRATE ISPMT MDURATION MIRR ODDFPRICE PRICE PRICEDISC PRICEMAT RECEIVED SYD TBILLEQ TBILLPRICE TBILLYIELD VDB XIRR XNPV YIELD YIELDDISC YIELDMAT
- 복소수·특수함수: COMPLEX IMABS IMAGINARY IMARGUMENT IMCONJUGATE IMCOS IMDIV IMEXP IMLN IMPOWER IMPRODUCT IMREAL IMSIN IMSQRT IMSUB IMSUM ERF ERFC BESSELI BESSELJ BESSELK BESSELY
- 텍스트 일부: ASC JIS LEFTB RIGHTB MIDB LENB FINDB SEARCHB REPLACEB
- 그 밖: ISOMITTED(LAMBDA 선택 인수) 이름 있는 함수(Named functions) 사용자 정의 함수(Apps Script)

전체 구글 목록은 https://support.google.com/docs/table/25273 . 위에 없는 함수는 `hasFunction(이름)`으로 확인한다.

## 구글과 의도적으로 다르게 두었거나 아직 관찰로 확인하지 못한 동작

- 관찰 기준: 2026-10-12 구글 시트(ko-KR, 서울 시간대)에서 얻은 643건(`engine/__tests__/corpus/gsheets-observed.json`)과 비교해 634건 일치. 남은 9건은 아래 "남은 불일치" 참고. 실행: `node __tests__/observed-runner.mjs`(null 설정값을 빈 칸으로 두고 고정 데이터 전체를 깐 실행기).
- ARRAYFORMULA 밖에서 여러 칸 범위를 연산자·원소별 함수·IF 조건에 쓰면 #VALUE!(관찰). 범위 하나만 쓴 `=B1:B3`은 펼치지만 관찰은 #VALUE!였고 "의심 항목"이라 따르지 않았다. 함수가 만든 배열(SEQUENCE, FILTER 등)은 어디서나 원소별 계산.
- 빈 칸은 숫자 0, 빈 문자열 "", FALSE처럼 행동하고 ISBLANK만 TRUE. `=""` 수식 결과는 빈 칸이 아니다(COUNTA가 센다, COUNTIF(범위,"=")는 세지 않고 ""는 둘 다 센다).
- 비교와 산술: 0.1+0.2=0.3은 TRUE(유효숫자 15자리 허용오차), 덧셈·뺄셈의 거의 0인 결과는 0, `0^0`=1, `(-8)^(1/3)`=-2(홀수 근만 실수), 숫자로 읽히는 텍스트는 IF 조건에서 #VALUE!, 빈 문자열 조건은 FALSE.
- 일반 서식 표시는 유효숫자 10자리, 1E15 이상·1E-9 미만은 지수 표기(`1E+15`, `1.23457E+17`). 텍스트로 합칠 때는 15자리.
- 날짜 표시(ko-KR): 함수가 만든 날짜는 `2025. 1. 1`, NOW는 `2026. 10. 12 오전 9:00:00`, 시간은 `오전 9:00:00`. ISO 글자(`2024-01-05`)로 입력한 칸과 그 칸에서 `+ -`로 파생한 값, 그 칸을 고르는 SORT/FILTER/UNIQUE/QUERY 결과 열은 입력 형식을 유지한다. `createEvaluator({dateStyle:"iso"})`면 함수 날짜도 ISO로 표시. DATEVALUE·TIMEVALUE는 숫자로 표시. 로캘 변경은 `locale:"en"`(TEXT의 월·요일·AM/PM 영어).
- TEXT 서식(ko-KR 관찰): 요일 `월요일`/`월`, 월 `1월`(mmm, mmmm 동일), `AM/PM`은 `오전/오후`, `a/p`는 `오`, `aaa`·`aaaa`·`q`는 서식이 아니라 글자 그대로, 따옴표 없는 `e`가 들어가면 #VALUE!, `@`는 값 그대로(숫자는 텍스트로), 분수 `# ?/?`·`?/?`·`# ?/8` 지원(0.5 -> `1/2`), 소수 15자리 이후는 0으로 채움, `[$-409]` 같은 로캘 태그는 무시. 조건 구간(`[>100]`)과 색상은 무시.
- 오류 종류(관찰): INDEX·CHOOSE 범위 밖 #NUM!(의심 항목이나 지시에 따라 채택), MID 시작 0 #NUM!, CHAR(0) #NUM!, SEQUENCE(0) #NUM!, VLOOKUP 열 번호 초과 #REF!, XLOOKUP 찾는 범위가 2열이면 #N/A, FILTER 조건 길이 불일치 #N/A, SPLIT("",...) #VALUE!.
- COUNTIF류: 조건 `""`는 빈 칸과 ""를 모두, `"="`는 진짜 빈 칸만, `"<>"`는 ="" 도 센다. 날짜 m/d/yyyy 문자열은 날짜로 해석하지 않는다(ko-KR). `2024. 2. 29`는 날짜. SUMIF의 합계 범위는 조건 범위 크기로 맞춘다. SUMPRODUCT는 숫자 텍스트를 숫자로 본다.
- SORT·UNIQUE·FILTER: SORT는 인수 하나(`SORT(범위)`)도 되고 완전히 빈 행은 결과에서 빠진다. UNIQUE는 대소문자를 구분하고 빈 칸과 ""를 따로 센다. 텍스트 정렬은 ko-KR 근사(기호 < 이모지 < 숫자 < 한글 < 로마자, 대소문자 무시)이다. 룩업 함수의 첫 인수와 SUMIF/COUNTIF의 조건은 ARRAYFORMULA 안에서 배열이면 원소별로 계산한다. 배열 상수는 범위를 포함해 가로·세로로 이어붙이고 높이·너비가 다르면 #REF!.
- QUERY(관찰): 열 머리글은 집계 `sum 점수`, 식 `product(점수2())`, 나눗셈 ` quotient(sum 점수count 점수)`, 스칼라 함수 `upper(부서)`, `toDate(날짜)`, `dayofweek(날짜)`. `count(*)`는 #VALUE!. `where C != 92`는 빈 값도 포함. `format C '0.0'`은 표시에 적용(80.0). pivot 날짜 머리글은 `2024-1-5`. 열 형식이 섞이면 다수결 형식만 남김. 완전히 빈 입력 행은 버린다. `limit` 다음에 `offset`만 허용.
- 바이트 함수 LENB·LEFTB·RIGHTB·MIDB는 ASCII가 아닌 글자를 모두 2바이트로 센다(관찰: `LENB("한글a")`=5). 짝이 깨진 서로게이트는 `?`로 표시(`LEFT("😀abc",1)`).
- LEN은 ISO 날짜 칸을 가리키면 표시 문자열 길이 10을 돌려준다(관찰). VALUE(날짜 칸)는 일련번호.
- 열 전체 참조(`A:A`)는 시트의 현재 행 수까지다. `getBounds`의 rows가 기준이므로 구글의 시트 크기(관찰 시트 1723행)와 같아지려면 호스트가 같은 행 수를 알려 주면 된다.
- 정규식은 JS 엔진이라 구글(RE2)이 거부하는 전방탐색·`\p{Hangul}`·잘못된 패턴의 오류 종류가 다르다. 관찰에서 REGEXMATCH(12,"1")이 #VALUE!였으나 "의심 항목"이라 숫자 입력을 허용한다. 바꿀 글의 `\2`는 숫자 `2` 글자(관찰), 그룹 참조는 `$2`.
- YEARFRAC 기준 1(실제/실제)은 여러 해에 걸칠 때 연평균 일수로 나눈다. 관찰값(531/365로 보이는 1.454794521)과 달라 불일치로 남아 있다.
- UNIQUE·SORT 외 MATCH의 텍스트 비교도 같은 ko-KR 근사 정렬을 쓴다. LEN·LEFT·MID·FIND는 UTF-16 코드 단위(관찰: `LEN("😀")`=2).
- 순환 참조는 구글처럼 순환에 속한 모든 칸이 #REF!. 이름 있는 범위는 `namedRanges` 옵션으로만, 이름 있는 함수는 없다. R1C1은 ADDRESS의 네 번째 인수로만 출력하고 INDIRECT는 지원하지 않는다.
- 단항 마이너스는 `^`보다 먼저 묶인다(`-2^2 = 4`, 구글 확인 전). 배열 상수 구분자는 쉼표(열)와 세미콜론(행).
- 날짜 입력 해석: `2024-01-05`, `2024/1/5`, `2024. 2. 29`, `2024년 2월 29일`, `2024-01-05 13:20`, `13:20`, `1,234`, `50%`, `₩1,000`, TRUE/FALSE. 미국식 `2/29/2024`는 날짜가 아니다(ko-KR).
## 관찰 대비 남은 불일치 (9건, 643건 중 634건 일치)

- 의심 항목이라 따르지 않음 (8건): gs-029 COUNTIF "~~x" (관찰 0, 우리 1), gs-487 REGEXMATCH(12,"1") #VALUE!, gs-499 REGEXEXTRACT(12345,..) #VALUE!, gs-507 REGEXREPLACE(12345,..) #VALUE!, gs-489 \p{Hangul} #REF!, gs-491 잘못된 패턴 #REF!, gs-492 전방탐색 #REF!, gs-576 `=B1:B3` 단독 범위 #VALUE!.
- 원인 미확인 (1건): gs-325 YEARFRAC 기준 1 (관찰 1.454794521 = 532일 / 365.667, 우리는 연평균 365.33).
- 하네스 차이: 원본 `scripts/observe/run-corpus.mjs`는 setup의 null을 문자열 "null"로 칸에 넣고 고정 데이터 전체를 깔지 않아 OFFSET/INDIRECT/열 전체/빈 칸 사례가 엔진 밖 이유로 어긋난다. `__tests__/observed-runner.mjs`가 이를 고친 실행기다.
