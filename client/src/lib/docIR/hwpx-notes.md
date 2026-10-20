# 한글(HWPX) 작성기·읽기 메모

`writeHwpx.js`, `readHwpx.js` 가 따르는 OWPML 구조와 그 근거, 결정 사항, 아직 검증하지 못한 곳을 적는다.
근거 표기: `r24` 한림멘토링 그룹 추천서(맥 한글 10.30, 머리말 그림·표·내어쓰기 포함), `r30/r31` 멘토 결과 보고서(맥 12.30), `r11` 회의록 서식(윈도 한글 13), `r60` GovTech 모집공고문(쪽 번호), `제안서 피드백 정리` 가로 용지, `영상콘텐츠 제작 기획서` 하이퍼링크, `1. [춘천시평생학습관]…강의계획서` 고정 줄 간격, `글로컬_수기공모전_신청서` 형광펜. 모두 이 컴퓨터의 한컴 저장본이다(version.xml 의 application 이 Hancom Office Hangul).

## 1. 쓸 때 기대는 구조와 실제 파일 근거

| 항목 | 우리가 쓰는 값 | 근거 |
|---|---|---|
| zip 순서 | mimetype(STORE) 먼저, 내용 `application/hwp+zip`, version.xml, settings.xml, META-INF/(container.xml, manifest.xml, container.rdf), Contents/(content.hpf, header.xml, section0.xml), Preview/PrvText.txt, BinData/ | r24 파일 목록과 container.xml. kordoc validate 가 첫 엔트리와 mimetype 을 확인 |
| 루트 이름공간 | 한컴이 쓰는 전체 xmlns 목록(ha, hp, hp10, hs, hc, hh, hhs, hm, hpf, dc, opf, ooxmlchart, hwpunitchar, epub, config) | r24 header.xml/section0.xml/content.hpf |
| header.xml | `hh:head version="1.31" secCnt="1"` > beginNum, refList(fontfaces 7개 언어, borderFills, charProperties, tabProperties, numberings, bullets, paraProperties, styles), compatibleDocument(HWP201X), docOption, trackchageConfig | r24(1.31, 맥 10.30). 윈도 13 은 1.5 |
| 글꼴 번호 | 언어마다 같은 글꼴 목록, id 는 0 부터. fontRef 는 hangul/hanja/japanese/user=한글 글꼴, latin/other=영문 글꼴, symbol=기호 글꼴 | r24 fontfaces, r30 fontRef(hangul 3 latin 3 other 4) |
| borderFill 번호 | **1 부터** 연속. 1=선 없음(채움 요소 없음, 쪽 테두리용), 2=선 없음+채움 none(글자/문단 기본), 3 이후는 표/칸 | r24: id 1,2 가 그 모양이고 charPr/paraPr 의 borderFillIDRef 가 모두 2 |
| charPr 자식 순서 | fontRef, ratio, spacing, relSz, offset, [italic], [bold], underline, strikeout, outline, shadow, [supscript/subscript] | r30, r18(italic), r60(supscript) |
| 형광펜 | charPr 가 아니라 `hp:t` 안 `hp:markpenBegin color="#FFFF00"/` ... `hp:markpenEnd/` | 글로컬_수기공모전_신청서 |
| paraPr | `tabPrIDRef`, `condense`, `snapToGrid`, align, heading, breakSetting, autoSpacing, **hp:switch**(case = HwpUnitChar 이름공간, hwpunit 값 / default = 2배 값), border | r24 외 5개 파일에서 case 값의 2배가 default 와 일치함을 전수 확인(불일치 0). 고정 줄 간격(FIXED)도 같은 2배(2157 / 4314) |
| 줄 나눔 | `breakNonLatinWord`: KEEP_WORD=글자 단위(한컴 기본), BREAK_WORD=어절 단위 | 한컴 저장본 대부분이 KEEP_WORD 이고, kordoc 생성기와 파서가 같은 의미로 쓴다 |
| 쪽 설정 | `hp:pagePr landscape="WIDELY|NARROWLY" width height` + `hp:margin header footer gutter left right top bottom`. A4 = 59528 x 84186. **가로 용지도 width/height 는 세로 기준 값**이고 landscape 만 NARROWLY | r24(59528x84186), `제안서 피드백 정리`(NARROWLY + 59528x84186) |
| 본문 시작 | 본문은 `top + header` 에서 시작, 끝은 `bottom + footer` 앞 | r24: 용지 84186 - top 4251 - header 2834 - footer 2834 - bottom 2834 = 본문 71433. 머리말 subList textHeight 가 header 값(2834)과 같다 |
| secPr | 첫 문단 첫 run 안. 같은 문단 둘째 run 에 머리말/꼬리말 ctrl. 첫 블록이 표여도 같은 문단 안에서 secPr run 뒤에 표 run | r24, r30(표로 시작하는 문서), 56개 파일 전수 |
| 표 | `hp:tbl`(rowCnt colCnt cellSpacing borderFillIDRef noAdjust pageBreak="CELL" repeatHeader) > sz, pos, outMargin, inMargin, tr > tc(subList, cellAddr, cellSpan, cellSz, cellMargin). 표 한 개는 `hp:run` 안, 뒤에 `<hp:t/>` | r24, r30. 병합으로 가려진 칸은 tc 를 쓰지 않음 |
| 그림 | `hp:pic` 자식 순서 offset, orgSz, curSz, flip, rotationInfo, renderingInfo, imgRect, imgClip, inMargin, imgDim, `hc:img binaryItemIDRef`, effects, sz, pos, outMargin. orgSz = 픽셀 x 75(1px=0.75pt) | r24(230x72px -> 17280x5400). 한컴 12 는 img 를 imgRect 앞에 쓰는 변형도 있어 읽을 때는 순서에 의존하지 않는다 |
| 하이퍼링크 | `hp:fieldBegin type="HYPERLINK" id fieldid="627600491"` + parameters(Command `url\:...;1;0;0;`, Path, Category …) ... `hp:fieldEnd beginIDRef` | 영상콘텐츠 제작 기획서 |
| 쪽 번호 | 문자 사이: `hp:ctrl > hp:autoNum numType="PAGE" > hp:autoNumFormat`. 위치 지정형은 `hp:pageNum pos formatType sideChar`(읽기 전용으로 처리) | pageNum: r60 등 10개 파일. autoNum PAGE: kordoc 파서가 머리말에서 처리(한컴 실물 근거) |
| 매니페스트 | `opf:item id="image1" href="BinData/image1.png" media-type isEmbeded="1"`, spine = header, section0 | r24 content.hpf |

한컴 파일 수 112개(중복 제외, 맥 10.30/12.30, 윈도 13)에서 위 구조를 읽었다. kordoc 의 생성기도 같은 골격이다.

## 2. 한글과 워드가 다른 점(README 1-10)에 대한 처리

1. **줄 간격**: percent 는 PERCENT, exactPt 는 FIXED, atLeastPt 는 AT_LEAST. 값은 hwpunit, `hp:switch` 로 이중 기록.
2. **쪽 여백/머리말**: IR 의 `marginMm.top` 은 쪽 가장자리에서 본문까지(워드 방식), `headerMm` 은 README 추가 제안(워드 담당)대로 "본문 위 여백 안쪽에 있는 머리말 띠의 높이"로 읽는다. 한글 `header = headerMm`, `top = marginMm.top - headerMm`(아래도 같다). 한글 본문은 `top + header` 에서 시작하므로 본문 시작 위치와 머리말 글자 시작 위치(`marginMm.top - headerMm`)가 워드와 같다. 머리말 내용이 headerMm 보다 길면 띠를 늘리고 위쪽 여백을 줄여 본문 시작을 지킨다. 읽을 때는 반대로 `marginMm.top = top + header`, `headerMm = header`.
3. **표**: 열 폭 colPt x 100 = cellSz width. 병합은 cellSpan. 칸 선·배경은 borderFill 로 모으고 같은 모양은 한 번만 정의한다. 이웃 칸 사이 겹치는 선은 굵은 쪽으로 맞춰 양쪽에 같은 선을 쓴다(워드의 충돌 규칙과 같다). 표 전체 선은 `tbl borderFillIDRef`. 표 높이는 행 높이 합. 행 높이는 IR heightPt, 없으면 글 길이로 어림한다(아래 4절). 한글 표는 높이가 "최소"여서 `heightRule:'exact'` 는 표현할 수 없고 atLeast 로 간다.
4. **글꼴**: IR ko 글꼴 → hangul/hanja/japanese/user, latin 글꼴 → latin/other. `opts.fontMap` 으로 이름을 바꿀 수 있고 기본 별칭은 `FONT_ALIASES`(HYHeadLine → HY헤드라인M 등). 설치되지 않은 글꼴은 한컴이 열 때 대체한다(대체 글꼴을 파일에 적지 않는다). 장평 ratio, 자간 spacing 은 `scalePct`, `spacingPct`. 언어별로 다른 값은 `run.x.hwp` 에 보존한다.
5. **항목 부호**: `list.marker` 는 글자로 앞에 쓰고(뒤에 공백 하나) 부호 폭만큼 내어쓴다(left = 폭, intent = -폭). 자동 번호는 쓰지 않는다. 읽을 때는 한글 자동 번호/글머리표(heading NUMBER/OUTLINE/BULLET)를 번호 서식대로 풀어 `list.marker` 로 낸다.
6. **체크박스**: ☐ ☑ 를 글자로 쓰고 글꼴을 `opts.checkFont`(기본 맑은 고딕) 로 맞춘다. 읽을 때 ☐ ☑ ☒ 는 `check` 런으로 나온다.
7. **그림**: 인라인은 treatAsChar=1. `figure.float` 는 treatAsChar=0, `x:right` → horzRelTo PAGE + horzAlign RIGHT, `y:top` → vertRelTo PAPER + vertOffset(기본 머리말 위치, 용지 위에서 headerMm). wrap: none → IN_FRONT_OF_TEXT, topBottom → TOP_AND_BOTTOM, square → SQUARE. 위치를 더 정확히 줄 때 `figure.x.floatOffsetPt = {x, y}`(pt).
8. **쪽 나눔**: 쪽 나눔 블록은 **다음 문단의 `pageBreak="1"`** 로 쓴다(한컴은 쪽을 나누는 문단이 새 쪽의 첫 문단). 뒤가 없으면 빈 문단에 단다.
9. (워드 전용)
10. **한컴 호환**: mimetype/version/content.hpf 순서, 참조 번호 연속성(borderFill 1부터, 나머지 0부터), 개체 id 유일, rowCnt/colCnt 일치. `__tests__/hwpx.check.mjs` 가 이를 모두 검사한다.

`hp:linesegarray` 는 쓰지 않는다. 한컴 저장본에는 항상 있지만 문단 줄 배치 캐시여서 한컴이 열 때 다시 계산한다(kordoc 생성기와 python-hwpx 류 도구도 쓰지 않는다. kordoc 렌더러는 캐시가 없으면 `reflow: true` 로 자체 조판한다).

## 3. IR 에 더한 값(모두 `x` 아래)

- `paragraph.x.breakByChar`(워드 담당과 공통 힌트): true = 글자 단위 줄 나눔(한글 `breakNonLatinWord=KEEP_WORD`, 한컴 기본), 없음 = 어절 단위(`BREAK_WORD`, 워드의 기본 `w:wordWrap` 과 같다). 편집기가 만든 IR(힌트 없음)은 한글에서도 어절 단위로 나가 워드와 줄 나눔이 같다.
- `paragraph.x.markSizePt`(워드 담당 값): 빈 문단의 줄 높이를 정하는 글자 크기. 읽을 때 한글은 빈 문단의 크기를 `runs:[{sizePt}]` 로 낸다. 쓸 때 둘 다 받는다.
- `paragraph.x.hwp = { breakLatin, lineWrap, autoEng, autoNum, condense, snap }` : 줄 나눔이 쪽 수를 바꾸므로 읽을 때 보존하고 쓸 때 되살린다(기본값과 다를 때만). `breakNonLatin` 으로 직접 지정도 가능.
- `run.x.hwp = { ratio[7], spacing[7], relSz[7]|relSzAll, offset[7]|offsetAll, kerning, fontSpace }` : 언어 그룹별 값(한글/영문/한자/일어/기타/기호/사용자 순서).
- `figure.x.floatOffsetPt = {x,y}` 와 읽을 때 `vertRelTo/horzRelTo`.
- `table.x.noAdjust`, `ir.x = { source:'hwpx', sections, skipped }`. `skipped` 는 지원하지 않는 개체 수(equation, rect, ole, chart, 각주 등, `cellFill:gradient/image`, `field:*`).

읽을 때의 규칙: 문서 기본(`defaults`)은 "바탕글" 스타일(0번)의 글자/문단 서식이다. 런과 문단에는 기본과 다른 값만 적는다. 빈 문단은 글자 크기를 `runs:[{sizePt}]` 로 남겨 줄 높이를 지킨다. 한 문단의 쪽 나눔이 구역 사이 쪽 나눔과 겹치면 하나로 합친다. 여러 구역은 쪽 나눔을 끼워 이어 붙이고 쪽 설정은 첫 구역 것을 쓴다(`x.sections`). 표의 행은 `tr` 순서를 믿는다(실제 파일에 rowAddr 가 어긋난 표가 있었다). 열 폭은 병합 없는 칸의 cellSz 로 얻고 병합 칸으로 모자란 열을 채운다.

## 4. 표 높이 어림

한컴은 열 때 표 행 높이를 다시 계산하지만 kordoc 렌더러는 cellSz 높이를 그대로 쓴다. 그래서 IR 에 heightPt 가 없으면 칸 안 글을 글자 폭(한글 1em, 영문 0.5em 안팎)으로 줄 수를 어림해 행 높이를 정하고 5% 여유를 둔다. 글꼴이 달라 줄 수가 어긋나도 한컴에서는 한컴이 다시 맞춘다.

## 5. 검증 결과(이 컴퓨터, 한컴 없음)

- 한컴 저장본 115개(중복 제외, 12MB 이하): readHwpx → writeHwpx → readHwpx 에서 표 수/행/열/병합/열 폭(0.5pt)/글 일치 115/115, kordoc validate 115/115, 깊은 검사 117/117(`hwpx.check.mjs`: 번호 참조, itemCnt, rowCnt/colCnt/격자 덮임, 개체 id, 매니페스트).
- 쪽 수(kordoc 조판, 최종 코드로 다시 잰 값): 한컴이 저장한 원본(조판 캐시 재생)과 같은 수 73/115. 나머지는 ±1~3쪽. 원본에서 조판 캐시를 지운 파일과 견주면 72/115 일치, 1쪽 차이 35, 2쪽 이상 8. 이 차이는 kordoc 의 조판이 한컴 조판과 완전히 같지 않은 영향도 섞여 있다(캐시를 지운 원본 쪽이 겹쳐 그려지는 파일이 있었다).
- 두 번째 읽기 경로: `kordoc parse` 로 표 수와 글 일치(시험 포함). python-hwpx 는 이 샌드박스에서 pip 가 막혀 설치하지 못했다.

## 6. 확인하지 못한 것(한컴 실행 불가)

- 한컴 오피스 윈도/맥에서 열어 보지 못했다. "손상 문서" 경고 여부, 글꼴 대체 결과, 쪽 수가 사람이 확인할 항목이다.
- `hp:autoNum numType="TOTAL_PAGE"`(전체 쪽수)는 한컴 저장본에서 찾지 못했다(PAGE 는 kordoc 파서가 한컴 실물 기준으로 다룬다). 안 열리면 `opts.pagesField: 'text'` 로 쓰면 숫자 1 대신 글자만 남는다.
- `date` 필드는 DATE 필드 대신 만든 날짜를 글자로 쓴다.
- `FIXED/AT_LEAST` 줄 간격의 default 값은 실제 파일(2배)대로 썼지만 AT_LEAST 는 실물을 찾지 못했다.
- 표 안 줄 바꿈 `hp:lineBreak` 는 한컴 구조 그대로이지만 kordoc 의 조판은 줄바꿈을 무시한다(렌더 확인에서 겹쳐 그려짐). 한컴에서는 정상일 것으로 본다.
- 형광펜 `markpen` 은 kordoc 렌더러가 그리지 않는다(구조는 한컴 저장본과 같다).
- 도형(rect 등), 수식, 각주, 변경 추적, 메모, 탭 설정(tabPr), 그림 효과, 글상자는 읽지 않고 `ir.x.skipped` 로 센다.

## 7. 도구 평가와 출처

- kordoc(MIT, https://github.com/chrisryugj/kordoc, 4.21.23): 골격과 검증/렌더 도구로 썼다. 코드는 복사하지 않고 생성 결과와 파서 소스(autoNum, 머리말/꼬리말, 하이퍼링크, breakSetting 의미)로 구조를 확인했다. 서버 `/hwpx/validate`, `/hwpx/render` 가 이 엔진을 부른다(변경 이력 4.18.13 → 4.21.23 에서 generate/render/validate API 호환이 깨지는 항목은 없었고, 기존 `/hwpx/generate`, `/preview` 가 그대로 동작함을 확인했다).
- 사용자 보유 skill 의 `hwpx/references/hwpx-format.md`(python-hwpx 매핑 표 포함)와 topoface/hwpx-skill 의 같은 문서를 읽었다. 구조 확인은 모두 한컴 저장본으로 했다.
- hancom-io/hwpx-owpml-model, airmang/python-hwpx, HwpForge, pypandoc-hwpx, rhwp, hwp2hwpx-python-refactor 는 **코드를 열어 보지 못했다**. python-hwpx 는 이 샌드박스에서 pip 가 동작하지 않아 설치하지 못했다. 이 도구들과 대조한 것으로 읽으면 안 된다.
