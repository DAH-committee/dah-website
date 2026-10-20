# docIR: 한글(HWPX)과 워드(DOCX)가 함께 쓰는 문서 중간 모델

목표: 편집기에서 만든 문서(또는 가져온 .docx/.hwpx)를 한글과 워드 양쪽으로 내보낼 때 표, 쪽 여백, 글꼴, 줄 간격, 쪽 나눔이 틀어지지 않게 한다.
방식: 변환기 하나로 한쪽에서 다른 쪽으로 옮기지 않는다. 모든 서식을 잃지 않는 중간 모델(IR)로 모은 뒤, 형식마다 전용 작성기가 각자의 규칙에 맞게 쓴다.

```
Tiptap JSON ──tiptapToIR──┐
.docx ──readDocx──────────┼──> IR ──writeDocx──> .docx
.hwpx ──readHwpx──────────┘        └─writeHwpx──> .hwpx
```

모듈 (모두 순수 ESM, DOM 없음, 브라우저와 Node 양쪽에서 동작. 외부 의존은 jszip만 허용. 단 writeDocx 는 이미 설치된 `docx` 패키지를 써도 된다):
- `schema.js`  IR 정의, `normalizeIR(ir)` 검증·보정, 단위 변환 `U`
- `tiptapToIR.js` / `irToTiptap.js`  편집기 연결 (편집기 담당)
- `writeDocx.js`  `export async function writeDocx(ir, opts?) -> Uint8Array`  (워드 담당)
- `readDocx.js`   `export async function readDocx(bytes, opts?) -> IR`
- `writeHwpx.js`  `export async function writeHwpx(ir, opts?) -> Uint8Array`  (한글 담당)
- `readHwpx.js`   `export async function readHwpx(bytes, opts?) -> IR`
- `fixtures/*.ir.json`  시험 문서 (검증 담당)

## IR 형식

단위: 글자 크기·간격·길이는 pt, 쪽은 mm 로 적는다. 색은 `#RRGGBB`. 각 작성기가 자기 단위(hwpunit=1/7200in, dxa=1/1440in, EMU)로 바꾼다.
이미지 바이트는 `ir.assets[id] = { mime, data: Uint8Array, w, h }` (px 크기). 본문에서는 id 로만 부른다. JSON 고정본(fixtures)에서는 data 를 base64 문자열로 두고 불러올 때 바꾼다.

```
IR = {
  version: 1,
  meta: { title, author?, created? },
  page: {
    size: 'A4' | 'B5' | 'Letter' | {wMm,hMm}, orientation: 'portrait'|'landscape',
    marginMm: { top, right, bottom, left },
    headerMm?: number,   // 머리말 영역 높이(쪽 위 가장자리에서 본문 위쪽 여백 안쪽으로)
    footerMm?: number,
    gutterMm?: number, columns?: { n, gapMm }
  },
  defaults: { font: { ko, latin }, sizePt, lineSpacing: LineSpacing, color, align },
  header?: Block[], footer?: Block[],         // 모든 쪽 공통. 쪽 번호는 Run.field 'page' | 'pages'
  body: Block[],
  assets: { [id]: { mime, data, w, h } },
}

Block = Paragraph | Table | Figure | PageBreak
Paragraph = {
  t:'p', runs: Run[],
  align?: 'left'|'center'|'right'|'justify'|'distribute',
  indent?: { leftPt, rightPt, firstLinePt },    // firstLinePt 음수=내어쓰기
  spaceBeforePt?, spaceAfterPt?,
  lineSpacing?: LineSpacing,
  keepNext?, keepLines?, pageBreakBefore?, widow?,
  heading?: 1..6,                                // 개요 수준
  list?: { kind:'bullet'|'ordered'|'check', level:0..8, marker?: string }, // marker 가 있으면 그 글자를 앞에 직접 적은 것(공문 항목 부호). 자동 번호는 쓰지 않는다
  bg?: '#RRGGBB',                                // 문단 배경
}
LineSpacing = { mode:'percent'|'exactPt'|'atLeastPt', value }   // percent 는 한글 방식: 글자 크기 기준 비율(160 = 160%)
Run = {
  text?: string,
  bold?, italic?, underline?: 'single'|'double'|'dotted'|'dash', strike?, sup?, sub?,
  color?, highlight?: '#RRGGBB', sizePt?,
  font?: { ko?, latin? },                        // 없으면 defaults
  scalePct?: number,                             // 장평(100 기본)
  spacingPct?: number,                           // 자간(0 기본, 글자 크기 대비 %)
  link?: string,
  br?: true,                                     // 줄바꿈
  tab?: true,
  image?: { id, wPt, hPt, alt? },                // 글자처럼 취급(인라인) 그림
  field?: 'page'|'pages'|'date',
  check?: { checked: boolean },                  // 체크박스. 글자(☐ ☑)로 그린다
}
Figure = { t:'figure', id, wPt, hPt, align?, caption?: Paragraph, float?: null | { x:'left'|'center'|'right', y:'top'|'para', wrap:'square'|'topBottom'|'none' } }
PageBreak = { t:'pagebreak' }
Table = {
  t:'table',
  widthPt: number,                  // 표 전체 폭(고정). 쪽 본문 폭을 넘지 않게
  align?: 'left'|'center'|'right',
  colPt: number[],                  // 열 폭 (합 = widthPt)
  rows: [{
    heightPt?: number, heightRule?: 'atLeast'|'exact',
    header?: boolean,               // 쪽을 넘길 때 제목 행 반복
    cantSplit?: boolean,
    cells: [{
      colspan?: 1.., rowspan?: 1..,           // 병합. 병합으로 가려지는 칸은 cells 에 넣지 않는다(HTML 방식)
      bg?: '#RRGGBB',
      vAlign?: 'top'|'middle'|'bottom',
      padPt?: { t, r, b, l },
      border?: { top?, right?, bottom?, left?, diagDown?, diagUp? },   // Border
      blocks: Block[],                        // 칸 안 문단·표
      textDir?: 'horizontal'|'vertical',
    }],
  }],
  border?: Border,                  // 표 기본 선 (칸에서 덮어씀)
  padPt?: { t, r, b, l },           // 표 기본 칸 안 여백
}
Border = { style:'none'|'solid'|'dashed'|'dotted'|'double'|'thick-thin', widthPt, color }
```

규칙
- 병합은 HTML 의 colspan/rowspan 처럼 적고, 가려진 칸은 넣지 않는다. 작성기가 자기 형식(w:gridSpan/vMerge, hp:cellSpan)으로 바꾼다.
- 쪽 번호와 날짜는 Run.field 로만 적는다.
- 한 Run 은 서식이 같은 글 조각 하나다. 줄바꿈과 탭은 별도 Run(br/tab)으로 둔다.
- 알 수 없는 속성은 버리지 말고 `x` 객체에 넣어 둔다(왕복 시 보존용). 작성기는 모르면 무시한다.

## 한글과 워드가 달라서 작성기가 따로 처리해야 하는 것 (빠뜨리면 틀어지는 곳)

1. 줄 간격: 한글은 글자 크기 기준 비율(160% 등)이고, 워드의 "배수"는 글꼴의 줄 높이 기준이라 같은 글꼴에서도 높이가 다르다. 워드 작성기는 글꼴별 줄 높이 비율로 환산하거나 고정값(exact)을 써서 쪽 나눔이 같도록 한다.
2. 쪽 여백과 머리말: 한글은 머리말·꼬리말이 위아래 여백 안쪽에 들어가는 구조(머리말 높이 항목이 따로 있음)이고, 워드는 머리말 위치(가장자리에서의 거리)와 본문 여백이 따로이며 머리말이 길면 본문이 밀린다.
3. 표: 한글은 hwpunit, 칸 크기 cellSz, 칸 여백 cellMargin, 선·배경은 borderFill 참조. 워드는 tblGrid + tcW, 표 레이아웃을 fixed 로 고정하지 않으면 열려 있을 때 폭이 다시 계산된다. 칸 병합은 한글 cellSpan/rowSpan, 워드 gridSpan/vMerge(restart/continue).
4. 글꼴: 한글은 언어별 글꼴 그룹(한글, 영문, 한자, 기호...), 워드는 rFonts ascii/hAnsi/eastAsia/cs. 이 컴퓨터에 없는 글꼴(HY헤드라인M, 함초롬바탕 등)은 대체 글꼴 규칙이 필요하다. 장평은 한글 ratio, 워드 w:w. 자간은 한글 spacing(%), 워드 w:spacing(twips).
5. 항목 부호: 한글 자동 번호는 문서마다 정의가 달라 열 때 틀어지기 쉽다. 공문 항목 부호(1. 가. 1) 가) ○ □)는 글자로 직접 적고 내어쓰기로 정렬한다(IR paragraph.list.marker).
6. 체크박스: 글자 ☐ ☑ 는 글꼴에 따라 폭이 다르다. 양쪽 모두 같은 글꼴(MS Gothic 계열 또는 맑은 고딕 기호)을 지정한다.
7. 그림: 로고 같은 쪽 위 오른쪽 그림은 한글의 "글자처럼 취급" 해제(떠 있는 개체)와 워드의 앵커 그림(wp:anchor)이 서로 다르다. IR 은 inline 과 figure.float 만 쓴다.
8. 쪽 나눔: 같은 글이라도 글꼴 대체와 줄 간격 환산이 어긋나면 쪽 수가 달라진다. 검증은 쪽 수와 표 위치가 편집기 기준과 같은지로 한다.
9. 워드 호환: settings.xml 에 호환 모드(Word 2013+)와 문서 격자 끔, 한글 줄바꿈 규칙(`w:wordWrap`, `autoSpaceDE/DN` 끔)을 명시하지 않으면 열 때 자동 보정이 들어간다.
10. 한글 호환: 한컴이 여는 데 필요한 mimetype, version.xml, Contents/content.hpf 순서와 헤더 참조 번호(id) 연속성.

## 검증 원칙

- 모든 작성기 출력은 (a) 구조 검사(한글: kordoc validate, 워드: XML 정합 + python-docx 로 열림), (b) 그려 보기(한글: kordoc render, 워드: 브라우저 렌더), (c) 읽어 되돌려 같은지(readX → IR 비교: 표 격자, 병합, 글 순서, 쪽 설정)를 통과해야 한다.
- 이 컴퓨터에서는 워드와 한컴을 자동으로 열 수 없다(샌드박스가 막음). 실제 프로그램에서 여는 마지막 확인은 사람이 한다. 그래서 검증 담당은 사람이 열어 볼 파일 세트와 점검표를 만든다.

## 추가 제안 (편집기 담당)

- `list.x = { markerFont, markerPt, markerBold }`: 한글 모드 항목 부호의 글꼴·크기. 작성기가 부호 글자에만 적용하면 한글 양식과 같아진다. 모르면 무시.
- 목록 문단은 `list.marker` 글자를 runs 에 넣지 않는다. 작성기가 `marker + 간격`을 앞에 쓰고 `indent.firstLinePt < 0` 으로 정렬한다. 작업 목록(`kind:'check'`)은 첫 Run 이 `check` 이다.
- 일반 모드의 구분선(hr)은 아래 선만 있는 1행 1열 표(`table.x.rule = true`, 행 높이 2pt exact)로 낸다. 한글 모드의 hr 은 `pagebreak`.
- Figure 에 `alt` 문자열을 둔다(그림 설명).
- 편집기가 기본으로 쓰는 값: 본문 11pt 맑은 고딕, 줄 간격 170%, 제목 22.5/16.5/12.75/11.25pt, 표 칸 글 10.5pt, 표 기본 선 0.75pt #8A8A8A, 표 칸 여백 4.5/6.75pt. 쪽 기본은 A4, 여백 위 20 아래 25 좌우 23mm, 머리말·꼬리말 거리 10mm.
- 쪽 설정은 문서 JSON 의 `page` 필드(`content.page`)에 저장된다: `{ size, orientation, marginMm:{top,right,bottom,left}, headerMm, footerMm, pageNumbers:{on,pos}, header:{text,align,image:{src,wPt,align}|null}, footer:{...} }`.

## 추가 제안 (워드 담당, writeDocx/readDocx)

명세의 뜻은 바꾸지 않았고, 아래는 해석을 정한 곳과 `x` 에 둔 값이다.

- `page.headerMm`/`footerMm`: "본문 위(아래) 여백 안쪽에 있는 머리말(꼬리말) 띠의 높이"로 읽는다. 워드 거리 `w:header = top - max(headerMm, 머리말 내용 높이)`. 한글 작성기도 같은 해석이어야 본문 시작 위치가 같다. 다르게 읽는다면 알려 주세요.
- `Paragraph.list.marker`: marker 는 runs 에 들어 있지 않고 따로 적는다(`plainText` 가 `marker + ' ' + 본문` 으로 합침). 워드 작성기는 `marker + 공백` 을 첫 글자 런으로 쓰고, 읽는 쪽은 내어쓰기 + 문장 앞 부호를 다시 marker 로 뽑는다.
- `Figure.caption`: 워드에서는 그림 문단에 `keepNext` 가 있으면 바로 다음 문단이 캡션이다. 읽을 때 그렇게 묶는다.
- 아래 값을 `x` 에 둔다: `Paragraph.x.breakByChar`(글자 단위 줄바꿈, true 일 때만 `w:wordWrap 0`), `Paragraph.x.markSizePt`(빈 문단의 줄 높이를 정하는 문단 표시 크기), `Table.x.indPt`, `Table.x.autofit`, `Run.x.caps`, `Run.x.smallCaps`, `Cell.x.synthetic`('gridBefore'|'gridAfter': 병합이 아닌 빈 앞뒤 칸을 표 격자에 맞추려고 넣은 칸).
- 줄 간격 `percent` 는 위 문서대로 글자 크기 기준(한글 방식)이고, 워드에서는 기본적으로 고정값(exact)으로 쓴다. 읽어 올 때 워드의 auto 배수는 글꼴 줄 높이로 percent 로 되돌리고 exact 는 `exactPt` 로 돌려준다. 그래서 IR -> docx -> IR 에서 percent 가 exactPt 로 바뀔 수 있다(`lineSpacingMode:'calibrated'` 로 쓰면 percent 로 돌아온다).

## 추가 제안 (한글 담당, writeHwpx/readHwpx)

명세의 뜻은 바꾸지 않았다. 해석을 정한 곳과 `x` 에 둔 값은 `hwpx-notes.md` 에 근거와 함께 적었다.

- `page.headerMm`/`footerMm`: 워드 담당 해석(머리말 띠의 높이)과 같게 읽는다. 한글 `header = headerMm`, `top = marginMm.top - headerMm`. 읽을 때는 `marginMm.top = top + header`, `headerMm = header`.
- 한글 쪽 설정은 가로 용지도 width/height 를 세로 기준 값으로 적고 `landscape="NARROWLY"` 로 돌린다(실제 한컴 저장본 방식). IR 에서는 `orientation:'landscape'` 하나로 충분하다.
- `Paragraph.x.breakByChar` 를 워드 담당과 같은 뜻으로 쓴다(true = 글자 단위 = 한글 `KEEP_WORD`, 없음 = 어절 단위 = `BREAK_WORD`). 한글을 읽을 때 한컴 기본(글자 단위)이면 true 로 낸다.
- `Paragraph.x.markSizePt`(빈 문단 크기)를 쓸 때 받는다. 한글을 읽을 때는 빈 문단 크기를 `runs:[{sizePt}]` 로 낸다.
- 한글에만 있는 값은 `Paragraph.x.hwp = { breakLatin, lineWrap, autoEng, autoNum, condense, snap }`, `Run.x.hwp = { ratio[7], spacing[7], relSz[7], offset[7], kerning, fontSpace }`, `Figure.x.floatOffsetPt = {x,y}` 에 둔다. 모르면 무시한다.
- 쪽 나눔 블록은 한글에서 다음 문단의 `pageBreak` 로 쓰고, 읽을 때 쪽 나눔 문단은 `pagebreak` 블록 + 그 문단으로 낸다. 한글의 여러 구역은 `pagebreak` 를 끼워 한 본문으로 잇고 쪽 설정은 첫 구역 것만 쓴다(`ir.x.sections` 개수).
- 한글을 읽을 때 자동 번호/글머리표는 `list.marker` 글자로 풀고, 쪽 번호 컨트롤(`hp:pageNum`)은 꼬리말/머리말의 쪽 번호 문단(`field:'page'`)으로 바꾼다. 지원하지 않는 개체(수식, 도형, 글상자, 각주, 필드)는 버리고 `ir.x.skipped` 에 종류별 개수를 적는다.
