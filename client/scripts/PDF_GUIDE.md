# 웹 자료 PDF 자동 생성

이 사이트의 발표·전시·안내 웹 자료는 하나의 공통 엔진으로 PDF를 만듭니다. 화면은 1920×1080으로 촬영되고, PDF의 각 쪽은 16:9로 저장됩니다.

## 새 웹 자료를 PDF로 추가하는 법

1. `presentation-pdfs.config.mjs`의 `presentationPdfJobs`에 자료 설정을 하나 추가합니다.
2. `route`에 웹 자료 주소, `output`에 다운로드 PDF 경로를 적습니다.
3. `pages`에 출력할 화면의 순서를 적습니다. 한 슬라이드의 여러 상태도 각각 PDF 한 쪽으로 저장할 수 있습니다.
4. 자료 상세 페이지의 다운로드 버튼을 `output`의 주소에 연결합니다.

```js
{
  id: 'new-material',
  route: '/new-material',
  output: 'public/downloads/new-material.pdf',
  title: '새 웹 자료',
  author: '한림대학교 디지털인문예술전공',
  pages: [
    { hash: 'cover' },
    { hash: 'section-1' },
    { hash: 'section-2:2' },
  ],
}
```

## 생성과 자동 갱신

- `npm run pdf`: 등록된 모든 PDF를 새로 만듭니다.
- `npm run pdf -- --id=new-material`: 특정 자료만 만듭니다.
- `npm run pdf:list`: 현재 PDF 자동 생성에 등록된 자료를 보여줍니다.
- `main` 업데이트 시, 그리고 6시간마다 모든 PDF가 자동으로 다시 만들어집니다. 관리자가 사이트 내용만 바꾸어도 다음 자동 갱신에 반영됩니다.

## 작업 규칙

- PDF로 남길 화면은 주소로 바로 열 수 있는 상태여야 합니다.
- `preview=1`일 때 버튼·포인터·페이지 이동 UI는 숨기고 발표 본문만 1920×1080에 맞게 보이게 합니다.
- 외부 이미지와 웹폰트가 모두 로드된 뒤 촬영하므로, 파일 주소는 항상 HTTPS로 접근 가능해야 합니다.
- 실행 후 PDF 쪽 수·16:9 크기·표지·중간 섹션·마지막 화면을 눈으로 확인합니다.
