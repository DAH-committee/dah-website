# 구글 슬라이드 관찰 (내보내기 구조, 레이아웃)

관찰일 2026-10-12. 내 계정에 스크래치 프레젠테이션을 만들고(파일 이름은 "제목 없는 프레젠테이션"으로 남음), 로그인된 탭에서 내보내기 주소 `https://docs.google.com/presentation/d/<id>/export/pptx|pdf|txt` 를 한 번씩 받았다(pptx 32112바이트, pdf 1281바이트, txt 0바이트: 글자 없는 빈 슬라이드 한 장). pptx 는 풀어서 `ppt/presentation.xml`, `slideLayouts/*`, `slideMasters/*`, `theme/*`, `notesSlides/*` 를 읽었다. 구글 내부 스크립트는 보지 않았다. 관찰 후 휴지통으로 옮겼다.
클립보드 비공개 형식은 `client/src/pages/slides/interop/README.md` 에 이미 있어 다시 조사하지 않았다.
미확인: png 내보내기, 레이아웃 마스터 편집 UI, 테마 색 변형, 도형/표/이미지 요소의 기본 크기, 슬라이드 쇼 전환 효과.

주의: 이 관찰 중 슬라이드 탭에서 제목을 바꾸려던 키 입력이 Gemini 패널 입력으로 들어가 "다음에 대한 슬라이드 만들기 AI 관찰 슬라이드" 요청이 전송되었다. 결과 미리보기는 적용하지 않고 닫았고(내보내기는 그 전에 받음), 파일은 그대로 휴지통으로 옮겼다.

## 슬라이드 크기

- `p:sldSz cx=9144000 cy=5143500` EMU = 10인치 x 5.625인치(16:9). 노트 쪽 `p:notesSz 6858000 x 9144000`(세로 7.5 x 10인치).
- 우리 캔버스는 1920 x 1080 px 이므로 1인치 = 192px, 1pt = 2.667px 로 환산된다(10in -> 1920px).

## 기본 레이아웃 11종 (pptx 의 slideLayout 이름)

TITLE, SECTION_HEADER, TITLE_AND_BODY, TITLE_AND_TWO_COLUMNS, TITLE_ONLY, ONE_COLUMN_TEXT, MAIN_POINT, SECTION_TITLE_AND_DESCRIPTION, CAPTION_ONLY, BIG_NUMBER, BLANK.
자리 표시(placeholder)와 크기(인치, 왼쪽 위 x,y 와 너비 x 높이, 글자 크기가 레이아웃에 지정된 경우):
- TITLE: 제목 ctrTitle 0.34,0.81 9.32x2.24 (52pt), 부제 subTitle 0.34,3.10 9.32x0.87 (28pt)
- SECTION_HEADER: 제목 0.34,2.35 9.32x0.92 (36pt)
- TITLE_AND_BODY: 제목 0.34,0.49 9.32x0.63, 본문 0.34,1.26 9.32x3.74
- TITLE_AND_TWO_COLUMNS: 제목 위와 같음, 본문1 0.34,1.26 4.37x3.74, 본문2 5.28,1.26 4.37x3.74 (14pt)
- TITLE_ONLY: 제목 0.34,0.49 9.32x0.63
- ONE_COLUMN_TEXT: 제목 0.34,0.61 3.07x0.83 (24pt), 본문 0.34,1.52 3.07x3.48 (12pt)
- MAIN_POINT: 제목 0.54,0.49 6.96x4.47 (48pt)
- SECTION_TITLE_AND_DESCRIPTION: 왼쪽 반 배경(5.00x5.63), 제목 0.29,1.35 4.42x1.62 (42pt), 부제 0.29,3.07 4.42x1.35 (21pt), 본문 5.40,0.79 4.20x4.04
- CAPTION_ONLY: 캡션 0.34,4.63 6.56x0.66
- BIG_NUMBER: 제목 자리(큰 숫자) 0.34,1.21 9.32x2.15 (120pt), 본문 0.34,3.45 9.32x1.42
- 모든 레이아웃: 슬라이드 번호 자리 sldNum 9.27,5.10 0.60x0.43.
- 왼쪽 여백 0.34인치(311700 EMU)는 우리 1920px 에서 약 65px 이다.

## 마스터와 테마

- 모든 자리 표시의 본문 설정이 `normAutofit`(넘치면 글자 크기를 줄임)이다. 글 상자 안쪽 여백은 4면 모두 91425 EMU(0.1인치, 약 19px).
- 글꼴은 테마와 마스터 모두 Arial(한글은 시스템 대체). 마스터에 나타난 글자 크기 값은 28, 18, 14, 10pt(각각 어느 수준인지는 미확인).
- 테마 색(theme1.xml 에 나온 순서대로의 값, 각 값이 어느 역할인지는 순서로만 추정): 000000, FFFFFF, 158158, F3F3F3, 058DC7, 50B432, ED561B, EDEF00, 24CBE5, 64E572, 2200CC, 551A8B.
- 우리 테마(basic 등)는 흰 바탕, 거의 검은 글자, 보라 강조(#7A3CFF)로 구글 기본과 색이 다르다. 의도된 차이다(코드 주석: 구글 슬라이드 기본 테마처럼 흰 바탕, 흐린 파스텔 금지).

## 발표자 노트

- 노트는 슬라이드마다 `notesSlide` 가 있고, 슬라이드 이미지 자리(idx 2 sldImg)와 본문 자리(idx 1 body) 두 개로 이루어진다. txt 내보내기는 이 빈 슬라이드에서 0바이트였다(슬라이드 글이 없을 때). 노트가 txt 에 들어가는지는 노트를 넣어 보지 않아 미확인.

## 우리 슬라이드 편집기와 비교

- 우리 레이아웃 8종(title, title-body, two-col, section, image-text, big-number, quote, blank)과 구글 11종은 이름과 개수가 다르다. 대응: title=TITLE, title-body=TITLE_AND_BODY, two-col=TITLE_AND_TWO_COLUMNS, section=SECTION_HEADER, big-number=BIG_NUMBER, quote(구글에 직접 대응 없음, MAIN_POINT 가 가장 가까움), image-text(구글에 직접 대응 없음, SECTION_TITLE_AND_DESCRIPTION 이 가까움), blank=BLANK. 구글에만 있는 TITLE_ONLY, ONE_COLUMN_TEXT, CAPTION_ONLY 는 우리에 없다.
- pptx 내보내기/가져오기에서 구글 레이아웃 이름은 위 대응으로 바꿔 읽는 것이 자연스럽다.
- 구글은 제목 글자를 큰 크기(52, 36, 48pt)로 두고 본문은 14pt 안팎, 넘치면 자동 축소다. 우리 AI 규칙(제목 25자, 목록 3~5개, 한 줄 40자)은 구글이 정한 값이 아니라 우리 가독성 기준이다(코드 aiSlidePrompts.js).
