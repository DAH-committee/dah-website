# docx 쓰기/읽기 메모 (writeDocx.js, readDocx.js, docxShared.js)

IR 규칙은 README.md 가 기준이다. 여기에는 워드 쪽에서 정한 값, 그 근거, 검증하지 못한 것만 적는다.

## 파일

- `writeDocx.js`  `writeDocx(ir, opts) -> Uint8Array`. `docx` 패키지를 쓰지 않고 jszip 으로 OOXML 을 직접 쓴다. 이유: 칸 대각선(tl2br/tr2bl), 요소 순서, 칸 테두리 충돌 정리, 글꼴 표 대체 항목, 앵커 그림, 콘텐츠 컨트롤을 한 곳에서 통제하려고. 결과는 ECMA-376 Transitional XSD 검증을 통과한다(아래).
- `readDocx.js`  `readDocx(bytes, opts) -> IR`. 외부 의존 없이 DOM 없는 XML 파서(`parseXml`)를 자체 포함. 스타일 상속(docDefaults, 문단 스타일 사슬, 글자 스타일, 직접 서식), 번호 목록(자동 번호를 글자 marker 로), 테마 글꼴, 필드(PAGE/NUMPAGES/DATE), 체크박스 SDT, 앵커/인라인 그림, VML 그림, 머리말/꼬리말, 쪽 설정을 읽는다.
- `docxShared.js`  두 모듈이 같이 쓰는 글꼴 표(FONT_DB), 줄 간격 환산식, XML 도우미.
- `__tests__/docx.test.mjs`, `docxFixtures.mjs`, `validate_docx.py`  시험. 실행: `cd client && node --test src/lib/docIR/__tests__/docx.test.mjs`

옵션 (writeDocx): `onIssue`, `lineSpacingMode`('hybrid' 기본 | 'calibrated' | 'exact' | 'multiple'), `contentControls`(체크박스를 w14:checkbox 콘텐츠 컨트롤로), `checkFont`(기본 MS Gothic), `breakByChar`, `kinsoku`, `fallbackKo`, `now`.
옵션 (readDocx): `onIssue`, `unknownLineK`(줄 높이를 모르는 글꼴의 비율, 기본 1.15).

## 줄 간격 환산 (README 8번 항목 1)

한글의 percent 는 글자 크기 기준이다: 줄 피치 = 글자 크기 x percent/100.
워드 `auto` 는 글꼴 줄 높이 기준이다: 줄 피치 = 글자 크기 x lineK x (w:line / 240).

환산: `w:line = 240 x (percent/100) / lineK` (`percentToAutoLine`). 읽을 때는 역변환(`autoLineToPercent`).

lineK 는 글꼴 파일에서 잰다. 식: `(winAscent + winDescent + 바깥 줄 간격) / unitsPerEm`, 바깥 줄 간격 = `max(0, hhea.lineGap - ((winAscent + winDescent) - (hhea.ascender - hhea.descender)))` (GDI 의 tmExternalLeading 정의). 측정 파일은 `Microsoft Word.app/Contents/Resources/DFonts` 와 `Hancom Office HWP.app/.../TTF`, 시스템 글꼴.

| 글꼴 | 영문 이름 | lineK | 출처 | 비고 |
|---|---|---|---|---|
| 맑은 고딕 | Malgun Gothic | 1.3301 | 측정(malgun.ttf: win 2229+495, upem 2048) | 워드 기본 탑재 |
| 바탕, 바탕체, 궁서, 굴림, 굴림체, 돋움, 돋움체 | Batang 등 | 1.1484 | 측정(batang.ttc, gulim.ttc: 879+145, gap 152, upem 1024) | 워드 기본 탑재 |
| MS Gothic | MS Gothic | 1.0 | 측정(msgothic.ttc) | 체크박스 글꼴 |
| HY헤드라인M | HYHeadLine Medium | 1.1484 | 측정(H2HDRM.TTF) | 없을 수 있음 -> altName 맑은 고딕 |
| HY견고딕, HY견명조 | HYGothic-Extra 등 | 1.1484 | 측정(HYGTRE, HYMJRE) | 없을 수 있음 |
| 휴먼명조, 휴먼고딕, 한컴바탕, 한컴돋움 | | 1.1484 | 측정(HMKMM, HMKMG, HBatang, HDotum) | 없을 수 있음 -> 바탕/돋움 |
| 함초롬바탕, 함초롬돋움 | HCR Batang/Dotum | 1.1484 | 추정: 이 컴퓨터에 파일이 없어 한컴 계열 값을 적용 | 없을 수 있음 -> 바탕/돋움 |
| Arial | | 1.1499 | 측정(arial.ttf) | |
| Times New Roman | | 1.1499 | 측정(시스템 Times New Roman.ttf, hhea.lineGap 87). 워드 번들본(times.ttf)은 lineGap 0 이라 1.1074 로 나옴: 두 파일이 다르다 | 1.15 채택 |
| Calibri | | 1.2207 | 측정 | |
| Cambria, Consolas | | 1.1724, 1.1709 | 측정 | |

기본 모드 `hybrid`: 글자만 든 문단은 `exact`(고정값 = 글자 크기 x percent/100). 이유: auto 는 대체 글꼴로 바뀌면 줄 높이가 바뀌어(맑은 고딕 1.33 대 바탕 1.15) 쪽 나눔이 어긋난다. exact 는 글꼴과 상관없이 같은 피치다. 그림, 위/아래 첨자가 든 문단은 잘림을 피하려고 보정된 `auto` 배수(글꼴을 모르면 atLeast). `calibrated` 는 항상 보정 배수.
`multiple` 은 percent 를 그대로 배수로 쓰는 한컴 docx 내보내기 방식이다. 이 컴퓨터의 실제 한림멘토링 보고서 docx 가 이 방식(`w:line="384" auto` = 160%)이다. 맑은 고딕에서 이 방식은 160% 가 1.6 x 1.33 = 213% 로 늘어난다(시험에 계산이 있음).
읽을 때는 워드 그대로의 값을 percent 로 돌려준다(auto 384, 함초롬바탕 -> 184%). exact 는 exactPt 로 돌려준다.

## 머리말과 본문 시작 위치 (README 8번 항목 2)

IR `headerMm` 은 "본문 위쪽 여백 안쪽에 들어 있는 머리말 띠 높이"로 읽는다. 워드는 `본문 시작 = max(pgMar.top, header + 머리말 내용 높이)` 이다.

`w:header = max(0, top - max(headerMm, 머리말 내용 추정 높이))`

머리말이 띠 안이면 `w:header = top - headerMm`, 넘치면 머리말을 위로 끌어올려 본문이 밀리지 않게 한다. 위 여백 자체보다 크면 밀림을 피할 수 없어 `onIssue({path:'header'})` 를 낸다. 꼬리말은 대칭(`w:footer`, 아래쪽). 내용 높이 추정은 문단 피치 x (1 + br 수) + 그림 높이 + 표 행 높이 이고, 자동 줄바꿈은 세지 못한다. 읽을 때는 `headerMm = top - w:header` (본문 밀림은 알 수 없음).
책등은 `w:gutter`(왼쪽), 단은 `w:cols`. docGrid 는 쓰지 않는다.

## 표

- `tblLayout fixed`, `tblW dxa`, `tblGrid` 는 누적 반올림(합이 표 폭과 같다), `tcW` = 걸친 열 폭 합, `gridSpan`/`vMerge restart|continue`, 병합 칸이 아닌 칸은 항상 문단으로 끝남.
- 표 위치: `tblInd 0`, `jc` 로 정렬. 호환 모드 15 에서는 표 바깥 테두리가 본문 왼쪽 여백선에 놓인다고 가정한다(2013 이후 배치). 실제 워드로 열어 확인하지 못함.
- 테두리: 같은 변을 두 칸이 서로 다르게 지정하면 워드가 임의로 고르므로, 작성기가 변 격자를 만들어 충돌을 풀고(선 있는 쪽, 둘 다면 굵은 쪽) 모든 칸에 네 변을 명시한다. 병합 칸의 안쪽 변은 nil, 아래 변은 마지막 행의 이어지는 칸(vMerge continue)이 가진다.
- 칸 안 여백: 표 기본 `tblCellMar`(padPt 가 없으면 한글 기본 1.4/5.1pt), 칸별 `tcMar`.
- 행: `trHeight`(hRule atLeast|exact), `tblHeader`, `cantSplit`. 칸 끝은 반드시 문단, 표 바로 뒤나 표와 표 사이에는 높이 1pt 문단(둘이 붙으면 워드가 한 표로 합침). 읽을 때 이 간격 문단은 걷어낸다.

## 글꼴과 한글 조판

- rFonts: ascii=latin, hAnsi=latin, eastAsia=ko, cs=latin. 한글 이름 그대로 파일에 둔다. 글자가 ASCII 밖이면 `w:hint="eastAsia"`(▪ ※ 같은 모호한 기호가 한글 글꼴로 나오게).
- fontTable: 알려진 글꼴은 panose/charset(한국어 0x81)/family/pitch 를 적고, 없을 수 있는 글꼴(한컴, HY, 휴먼)에는 `altName`. 모르는 글꼴이 한글 이름이면 `altName` 을 맑은 고딕(명조/바탕 계열 이름이면 바탕)으로. 실제 맥 워드가 저장한 보고서 docx 의 fontTable 값(HY헤드라인M panose 02030600000101010101, charset 81)을 따랐다. 맥 워드에서 이 이름이 열리는 것은 그 파일로 확인됨(HY헤드라인M, 스크린샷의 HYHeadLine).
- settings.xml: `compatibilityMode 15`, 호환 항목은 위 실제 파일의 설정과 같게(useFELayout 등), `defaultTabStop 800`, `characterSpacingControl doNotCompress`.
- Normal 스타일: `widowControl 0`, `autoSpaceDE 0`, `autoSpaceDN 0`, `snapToGrid 0`. docGrid 없음. 문단 `x.breakByChar` 가 true 일 때만 `wordWrap 0`(글자 단위 줄바꿈: 실제 보고서에서 "만든/다." 처럼 어절 가운데서 끊기는 것이 이 설정과 같다). 기본은 어절 단위. `opts.kinsoku=false` 면 `kinsoku 0`.
- 장평은 `w:w`, 자간은 `w:spacing` = `spacingPct/100 x 글자 크기 x 20` twips. 글자 크기는 반 pt 단위(`w:sz`), 10.5pt = 21.
- 형광펜: IR 색이 워드 16색과 정확히 같으면 `w:highlight`, 아니면 `w:shd`(clear, fill).

## 체크박스, 항목 부호, 그림

- ☐ ☑ 는 MS Gothic 글자 런(`w:hint eastAsia`). 이유: MS Gothic 은 ☐ ☑ ☒ ▪ ▢ 를 모두 가진다(cmap 으로 확인). 맑은 고딕은 ☐ ☑ ▪ 가 없어 대체 글꼴로 넘어간다. `opts.contentControls` 면 `w14:checkbox`(checkedState 2611, uncheckedState 2610, font MS Gothic).
- 항목 부호는 `list.marker` + 공백을 글자로 쓰고 내어쓰기(`w:left`+`w:hanging`)로 정렬. 자동 번호(numPr)는 쓰지 않는다. indent 가 없으면 부호 폭을 추정해 내어쓰기를 계산한다(부호 폭 근사: 숫자·마침표 0.55em, 공백 0.35em, 그 밖 1em). marker 없는 ordered 는 같은 수준 연속 번호를 붙인다.
- 읽을 때: 번호 목록(abstractNum)을 펼쳐 marker 글자로(decimal, 가나다, ㄱㄴㄷ, 로마자, ①, 불릿 글꼴의 사설 영역 기호 -> ▪ • ➢ 등). numPr 이 없어도 내어쓰기 + 문장 앞 부호 모양이면 list.marker 로 뽑는다.
- 인라인 그림은 `wp:inline`, EMU = pt x 12700. figure.float 는 `wp:anchor`(positionH margin align left|center|right, positionV margin top 또는 paragraph 0, wrapSquare|TopAndBottom|None). 앵커는 높이 1pt exact 문단에 둔다(흐름에 줄을 더하지 않으려고). PNG/JPEG/GIF/BMP 만 받는다. SVG 는 경고하고 건너뛴다(PNG 로 바꿔 넣어야 함).
- 그림만 든 문단은 읽을 때 Figure 로, `keepNext` 가 있으면 다음 문단이 캡션이다(워드 캡션 삽입과 작성기 규칙이 같다).
- 쪽 나눔: 다음 문단에 `pageBreakBefore`, 다음이 표/그림이면 높이 1pt 문단에 pageBreakBefore. 쪽 나눔 문단을 따로 두면 쪽 끝에서 빈 쪽이 생기기 때문.

## 읽기에서 알아 둘 것

- 한글에서 저장한 docx 는 표 안에 제목이 들어 있고(제목 표) 칸마다 pBdr none 이 있다. 그대로 읽는다.
- `.docx` 확장자인 구형 한글/워드 파일(OLE, D0CF11E0)은 분명한 오류를 낸다(프로젝트 폴더에서 실제로 하나 만남).
- 표 폭이 본문 폭을 넘는 문서(실제 보고서: 표 498.9pt, 본문 481.9pt)는 그대로 읽고 IR 정규화가 경고한다.
- 여러 구역은 마지막 구역의 쪽 설정만, 첫 쪽 다른 머리말은 무시하고 경고한다. 떠 있는 표(tblpPr), 텍스트 상자, 도형, 각주, 변경 추적(삭제 텍스트 제외 삽입만), 수식은 읽지 않는다.
- 표 스타일의 조건부 서식(첫 행, 줄무늬)은 적용하지 않는다. 표 스타일의 기본 테두리와 칸 여백만 반영한다.

## 검증 (이 컴퓨터에서 한 것)

1. 구조: XML 정합, 관계 대상과 r:id, 콘텐츠 타입, 요소 순서 표(`ORDER`), docPr 고유, tblGrid 합 = tcW 합.
2. XSD: ECMA-376 Transitional XSD(ISO/IEC 29500-4:2016)를 lxml 로 적용. 받은 곳: github.com/ComposioHQ/awesome-claude-skills 의 `document-skills/docx/ooxml/schemas/ISO-IEC29500-4_2016`(Anthropic docx 스킬이 쓰는 같은 스키마 묶음). 저장소에는 넣지 않고(2MB) `DOCX_XSD_DIR` 환경 변수나 기본 경로에서 찾고 없으면 건너뛴다. w14 등 확장 요소와 속성은 검사 전에 걷어낸다. 음성 대조(pPr 안 순서를 뒤집은 파일은 실패)도 시험에 있다. 실제 워드가 저장한 보고서 docx 도 같은 검사를 통과해 검사기가 실제 파일을 거짓 양성으로 막지 않음을 확인했다.
3. python-docx 1.2.0 으로 열어 표, 열 폭, 쪽 크기, 구역을 확인.
4. 렌더: docx-preview 0.3.5 로 그려 봄(근사). 병합, 폭, 바탕색, 형광펜, 쪽 크기, 로고 위치는 맞다. 대각선, 쪽 나눔, 줄바꿈은 그 렌더러가 못 그리거나 근사다.
5. 왕복: IR -> docx -> IR 의 summarize(글 순서, 표 격자, 병합, 칸 배경, 폭 0.5pt, 쪽) 일치. 프로젝트 폴더의 실제 docx 40개(표 552개)를 읽고, 다시 쓰고, 다시 읽어 표 수와 문단 수가 같음.

## 검증하지 못한 것

- 실제 워드(맥/윈도우)와 한컴에서 열기: 샌드박스가 막는다. "복구 프롬프트가 없다"는 XSD 검증과 python-docx 열림으로 추정한 것이고 확정이 아니다. 특히 w14 요소(콘텐츠 컨트롤)는 XSD 에서 검사 대상이 아니다.
- 줄 높이: lineK 는 글꼴 파일에서 잰 값이고, 실제 워드의 줄 배치(exact 일 때 글자가 줄 안 위/아래 어디에 놓이는지, 맥과 윈도우 차이)는 확인하지 못했다. 함초롬 계열은 측정 파일이 없다.
- 표 왼쪽 가장자리가 호환 모드 15 에서 본문 여백선과 맞는다는 가정, 문단 앞 간격이 쪽 맨 위에서 억제되는 워드 동작(한글은 유지)의 차이.
- 맥 워드에 HY헤드라인M 이 있는 것은 사용자 파일로 확인했지만, 윈도우에서 한컴 글꼴이 없을 때 altName 이 실제로 쓰이는지는 확인하지 못했다.

## 평가한 도구

- 사용: python-docx(열림 검증), docx-preview(렌더), ECMA-376 Transitional XSD(구조 검증, 위 출처), jszip.
- 설치된 `docx`(dolanmiu/docx 9.8.1): 쓰기에 쓰지 않았다. 대각선 칸 테두리, 요소 순서 통제, 앵커 위치, altName 글꼴 표, 변 충돌 정리를 한 곳에서 하기에는 직접 쓰는 편이 간단했다.
- 검토만 한 것(코드는 읽지 않음, 이유): docxtemplater(템플릿 채우기용이라 IR 쓰기에 맞지 않음), html-to-docx(HTML 입력 변환기라 표 격자 통제가 약함). 검색에서 본 다른 XSD 묶음(UseJunior/safe-docx, t-yuki/ooxml-xsd, eigenpal/docx-editor)은 같은 ECMA 스키마라 하나만 썼다.
