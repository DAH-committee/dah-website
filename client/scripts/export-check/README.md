# export-check: docIR 내보내기 검증 도구

한글(HWPX)과 워드(DOCX) 작성기가 같은 IR 에서 틀어짐 없이 파일을 만드는지 확인한다.
시험 문서는 `src/lib/docIR/fixtures/*.ir.json`, 도구는 이 폴더.

## 쓰는 법

```
cd client
node scripts/export-check/run.mjs --all                 # 시험 문서 전부
node scripts/export-check/run.mjs gian table-torture    # 골라서
node scripts/export-check/run.mjs --all --out /tmp/x    # 출력 폴더 지정(기본 scripts/export-check/.out)
node scripts/export-check/run.mjs --corpus <폴더>       # 실제 .docx/.hwpx 모음(원본 -> IR -> 두 작성기 -> 비교)
node scripts/export-check/make-kit.mjs                  # 사람이 열어 볼 파일 묶음(artifacts/export-kit)
node --test src/lib/docIR/__tests__/fixtures.test.mjs   # 시험 문서와 도구 단위 시험
```

각 문서마다 하는 일: 쓰기 -> 구조 검사 -> 읽어 되돌려 요약 비교 -> 렌더 -> 쪽 수와 표 위치 비교 -> `report.html`, `report.json`.
작성기나 읽기기, 도구가 없으면 멈추지 않고 SKIP 으로 표시한다.

## DOCX 렌더(브라우저 필요)

DOCX 를 그리는 `docx-preview` 는 브라우저에서만 돈다. 그래서 2단계로 한다.

1. `node scripts/export-check/serve.mjs` (포트 3170~3179 중 첫 빈 곳. 출력 폴더가 `.out` 밖이면 `--allow 폴더`). 한 번 띄워 두면 된다.
   `.vendor/` 에 `docx-preview.min.js` 와 `jszip.min.js` 가 있어야 한다(커밋하지 않음). 없으면 jsdelivr 에서 받는다:
   `curl -sL https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js -o .vendor/docx-preview.min.js`
   `curl -sL https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js -o .vendor/jszip.min.js`
2. `run.mjs` 를 한 번 돌리면 `<out>/jobs.json`(말뭉치는 `jobs-corpus.json`)이 생긴다. Aside repl 에서:
   ```js
   await page.goto('http://127.0.0.1:3170/render.html')
   const drive = new Function((await fs.readFile('<export-check>/browser-render.js', 'utf8')) + '; return driveDocxRender')()
   await drive({ page, fs, jobsFile: '<out>/jobs.json', port: 3170 })
   ```
   그런 다음 `run.mjs` 를 다시 돌리면 렌더 결과(쪽 그림, 표 위치)를 읽어 비교한다. 내용 해시가 같으면 다시 그리지 않는다.

## 한계 (보고서에도 같은 말이 적힌다)

- DOCX 렌더는 `docx-preview` 이고 자동 쪽 나눔이 없어 본문 블록 높이로 쪽을 어림한다. 워드와 같다는 보증이 아니다. 대각선 테두리, 세로쓰기, 파선·점선 구분은 docx-preview 가 못 그린다.
- HWPX 렌더는 kordoc 의 순수 TS 조판이다. 표를 쪽 사이에서 나누지 못해 긴 표가 있으면 쪽 수가 적게 나온다. 한컴과 같다는 보증이 아니다.
- 워드와 한컴을 직접 여는 확인은 샌드박스에서 불가능해서 `make-kit.mjs` 의 점검표로 사람이 한다.

## 파일

| 파일 | 역할 |
|---|---|
| `run.mjs` | 진입점(시험 문서와 말뭉치) |
| `lib.mjs` | zip/XML 읽기, DOCX·HWPX 구조 검사(ECMA-376 순서표 포함), SVG 기하, 비교 함수 |
| `docx_probe.py` | python-docx 로 열어 표·병합·구역 보고 |
| `render.html`, `browser-render.js`, `serve.mjs` | DOCX 브라우저 렌더 |
| `report.mjs` | report.html |
| `make-kit.mjs` | 사람이 확인할 파일 묶음과 점검표 |
