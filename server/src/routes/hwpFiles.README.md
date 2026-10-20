# 한글 파일(hwp) API 계약

파일 종류 `hwp` (ws_files.kind = 'hwp'). 원본 .hwp / .hwpx 의 서식을 그대로 두고 읽고, 그리고, 고치고, 버전으로 남기고, 내려받는다.
엔진은 kordoc(MIT) 위에 얹은 서버 코드(`server/src/lib/hwp/**`)이고, 이 문서가 클라이언트와 MCP 가 맞춰 쓰는 계약이다. 코드가 바뀌면 이 문서를 같이 고친다.

- 브라우저 주소는 `/api/hwp/...` (Vercel 이 `/api` 를 떼고 서버에 넘긴다). 아래 경로는 서버 기준(`/hwp/...`).
- 로그인 필요(401 `LOGIN`). 파일 권한은 다른 파일과 같다(`levelFor`: viewer / editor, 휴지통·나만 보기·팀·링크 공유 동일). 읽기는 viewer, 쓰기(edit, restore, star)는 editor.
- 오류 본문은 항상 `{ "error": { "code", "message": "한국어", ...추가 } }`.
- AI 호출은 서버가 하지 않는다. 파일 바이트는 우리 인프라 밖으로 나가지 않는다.

## 0. 목록·정보·만들기

| 용도 | 호출 |
|---|---|
| 내 목록 / 팀 / 휴지통 | `GET /hwp/files[?team=<id>][&trash=1]` → `{ items: FileInfo[] }` (허브 카드용. `format`,`size`,`page_count`,`current_version` 포함). 기존 `GET /workspace/files?kind=hwp` 도 되지만 기본 필드만 온다 |
| 이름 바꾸기·삭제·복원·공유·팀 | 기존 `/workspace/files/:id/*` 그대로 (영구 삭제 시 버전·바이트·키도 지운다: `registerPurgeHook('hwp')`) |
| 파일 정보 | `GET /hwp/files/:id` → `{ item: FileInfo, last_edit }` |
| 새 파일 | 아래 3가지 (`POST /workspace/files` 는 hwp 를 만들지 못한다) |

`FileInfo = { id, kind:'hwp', title, format:'hwpx'|'hwp', size, current_version, page_count, level:'viewer'|'editor', can_edit, created_at, updated_at, owner_email, general_access, source:'upload'|'docx'|'template'|'markdown', edit_support:{hwpx:[op...], hwp:[op...]}, render_mode:'layout' }`
`ws_files.content` = `{ format, current_version, size, page_count, source, protected:false, render_mode }` (제목은 `ws_files.title`). 바이트는 content 에 없다.

### POST /hwp/files — 업로드 (multipart, 칸 이름 `file`, 4MB 이하)
`.hwpx .hwp .docx`. 필드 `title?`, `team_id?`. → 201 `{ item: FileInfo, warnings: string[], converted_from?: 'docx' }`.
`.docx` 는 HWPX 로 바꿔 저장한다(원본 docx 는 보관하지 않음, 경고에 알림). HWPX 구조 경고(원본에 이미 있던 것)는 `warnings` 로 알리고 거부하지 않는다.

### POST /hwp/files/import — 큰 파일 (JSON)
4MB 넘는 파일: `POST /blob/client-token {filename,size}` 로 서명 주소를 받아 브라우저가 Blob 에 PUT 한 뒤 `{ blob_url, filename, title?, team_id? }`. `blob_url` 은 `https://*.public.blob.vercel-storage.com/dah/uploads/...` 만 허용. 서버가 읽어 암호화 저장한 뒤 **임시 공개 파일을 지운다**. 25MB 초과 413 `TOO_LARGE`.

### POST /hwp/files/create — 처음부터
`{ template, values?, markdown?, preset?, options?, title?, team_id? }`
- `template:'gian'` 일반기안문 / `'gian-simple'` 간이기안문 (`values`: 누름틀 이름 → 문자열)
- `template:'markdown'` + `markdown`(500KB 이하) + `preset`(`기안문|보고서|계획서|통지|알림|회의록|보도자료|업무보고|개조식|방침서`) + `options?`(`/api/hwpx/generate` 의 공문 옵션 허용 키)
- `GET /hwp/templates` → `{ items:[{ id, name, fields?:[{name,hint}], presets? }] }`
→ 201 `{ item, warnings }`.

## 1. 읽기 모델 (AI 와 화면이 함께 쓴다)

모든 읽기에 `?version=<n>` (기본 현재). 응답에는 항상 `version`.

### GET /hwp/files/:id/outline
```
{ version, format, metadata:{title,author,creator,createdAt,modifiedAt,pageCount,pageMode:'layout'|'section'},
  headings:[{block,level,text,page}], tables:[{block,rows,cols,page,header:[첫 행 글]}],
  stats:{blocks,paragraphs,tables,images,characters}, fields:[Field], has_header_footer, protected:false }
```

### GET /hwp/files/:id/blocks?from=0&to=200
`from`/`to`: 문서 순서 0부터(`to` 미포함), 한 번에 300블록까지.
```
{ version, total, from, to, blocks:[Block] }
Block = { id:'b12', index, type:'heading'|'paragraph'|'list'|'table'|'image'|'separator',
          level?, text?, page?, style?, editable:'text'|'cell-text'|'locked', reason?,
          table?:{ rows, cols, has_header, cells:[[Cell]] } }
Cell  = { id:'b12#r2c1', row, col, text, rowSpan?, colSpan?, header?, editable:bool, reason?, nested_table? }
      | { id, row, col, covered:'b12#r2c1' }     // 병합으로 덮인 칸은 시작 칸을 가리킨다
```
표는 `keep` 추출이라 원본 표 구조와 1:1 이다. 중첩 표는 부모 칸 `text` 에 평탄화되어 있고 `nested_table:true` 로 표시된다(칸 단위 편집 불가일 수 있음). `editable:'locked'` 는 kordoc 이 소스맵을 믿을 수 없다고 판정한 블록이다(편집 시 `LOCKED`).

### 블록 id (안정성)
- 형식 `b<정수>`. 파일마다 늘어나는 카운터(`hwp_keys.id_counter`)로 새 블록에만 새 번호를 주고 재사용하지 않는다.
- 첫 버전은 문서 순서로 `b1..bn`. 이후 버전은 직전 버전의 id 표(`hwp_versions.block_ids`)와 새 블록 목록을 **정렬(LCS, 종류+정규화 글 지문)** 해서 같은 블록·고친 블록은 id 를 잇고, 새 블록만 새 id, 사라진 블록의 id 는 없어진다.
- `replace_block / replace_cell / table_add_rows / replace_text / redact / place_seal` 은 다른 블록 id 를 바꾸지 않는다. `insert_paragraph_after` 는 새 id 를 `applied[].new_blocks` 로 돌려준다. `fill_fields` 는 빈 칸이 채워져 글 블록이 새로 생길 수 있다(`block_ids_added`). `apply_markdown` 은 정렬에 의존한다.
- 표 칸 id `b12#r2c1` = 표 id + 격자 좌표. 행을 더하면 아래 행 좌표가 밀리니 표를 다시 읽는다.
- 되돌리기는 새 버전을 만들고 되돌린 버전의 id 표를 그대로 쓴다.

### GET /hwp/files/:id/fields
```
{ version, confidence, fields:[ { name, kind:'label'|'clickhere', value, empty, block?, cell?, hint? } ] }
```
`label`: 표의 라벨-값 칸(`cell` 이 값 칸). `clickhere`: 누름틀(HWPX), `hint` 가 안내문.

## 2. 그리기

### GET /hwp/files/:id/pages?from=1&to=3&format=svg|png&scale=1
쪽 1부터. 한 번에 SVG 10쪽, PNG 6쪽. (파일, 버전, 쪽, 형식, 배율)별 서버 메모리 캐시.
```
{ version, page_count, render_mode:'layout'|'reflow', warnings:[...],
  pages:[ { n, width, height /*pt*/, svg? | image?:'data:image/png;base64,..', image_width?, image_height?, regions:[Region] } ] }
Region = { id:'table-000017', type:'paragraph'|'table'|'image'|'shape'|'equation', bbox:{x,y,width,height} /*이 쪽 좌상단 원점, pt*/,
           block?:'b12', cell?:'b12#r2c1', parent?:'table-000017' }
```
- 바이너리: `GET /hwp/files/:id/pages/:n.svg`, `/pages/:n.png?scale=`, `/thumbs/:n.png`(너비 240px). `?version=` 이 있으면 `Cache-Control: private, max-age=31536000, immutable`.
- 영역→블록 대응은 최선 추정이다. 표는 원본 표 id 로 정확히 맞고, 본문 문단은 영역 수와 블록 수가 같을 때(또는 쪽별로 같을 때) 순서로 맞춘다(실측: 한컴 저장본 중 약 80%). 못 맞춘 영역은 `block` 이 없으니, 클릭 처리는 `block` 이 있는 가장 안쪽 영역을 쓰고 없으면 블록의 `page` 로 대신한다. 표 칸(`cell`)은 칸 안 문단 수가 맞을 때만 붙는다.
- 한컴 조판 캐시를 그대로 그린다. 편집된 문단은 줄바꿈을 다시 계산해 캐시를 새로 써 두므로 미리보기가 거의 같지만, 줄 수가 달라진 곳의 쪽 배치는 한컴이 열 때 다시 계산한 결과와 다를 수 있다. 수식은 그리지 않고(경고), 머리말·꼬리말·각주는 아직 그리지 않는다.

## 3. 고치기

### POST /hwp/files/:id/edit
```
{ base_version?:7, strict?:false, dry_run?:false, note?:'..', source?:'user'|'ai', ops:[Op,...] }   // ops 200개까지
```
`base_version` 이 현재와 다르면 409 `VERSION_CONFLICT`(`current_version` 포함). 없으면 현재 버전에 적용(블록 id 가 안정적이므로 보통 안전). 연산 구분 필드는 `op` (`type` 도 받는다). `expect` 는 지금 글이 이 문자열로 시작해야 한다는 사전 조건(다르면 `STALE`).

| op | 필드 | HWPX | HWP 5.x |
|---|---|---|---|
| `replace_block` | `block, text, expect?` | O (바뀐 글자 범위만 고침: 런·서식 보존) | O (kordoc patchHwp) |
| `replace_cell` | `cell:'b12#r2c1'` 또는 `table,row,col`, `text, expect?` | O | O |
| `insert_paragraph_after` | `block, text, like?` (글자만 있는 이웃 문단의 서식을 복제, 줄 나눔 = 여러 문단) | O | X |
| `delete_block` | `block, expect?` | O | X |
| `table_add_rows` | `table, after_row, rows:[[칸...]]` (이웃 행 서식·병합 복제, 가로지르는 세로 병합이면 거부) | O | X |
| `fill_fields` | `values:{이름:값|값[]}, formats?, require_unique?, dry_run?` | O | X |
| `replace_text` | `find, replace, all?=true, scope?:'body'|'tables'|'body+tables'(기본)|'block:<id>', match_case?=true` | O (런 보존) | O |
| `apply_markdown` | `markdown` (keep 추출을 고친 전체) | O (문단 추가·삭제는 건너뜀) | O |
| `redact` | `rules?, mask_char?='●', dry_run?` (본문·표·머리말·꼬리말·각주, 미리보기 글·그림) | O | X |
| `place_seal` | `image:'data:image/png;base64,..', anchor:'(인)', width_mm?, mode?, occurrence?` | O | X |

HWP 에서 안 되는 연산은 `skipped[].reason='HWP_UNSUPPORTED'`. 빈 글로 바꾸기는 `EMPTY_TEXT`(지우려면 `delete_block`).
응답 200:
```
{ version, changed, dry_run?, would_create_version?,
  applied:[ { op:<순번>, type, block?, cell?, before?, after?, new_blocks?, ... } ],
  skipped:[ { op, type, reason:'NOT_FOUND'|'STALE'|'LOCKED'|'UNSUPPORTED'|'HWP_UNSUPPORTED'|'UNCHANGED'|'EMPTY_TEXT'|'TOO_LARGE'|'AMBIGUOUS'|'VERIFY'|'TIMEOUT'|'ERROR'|'BAD_REQUEST', message } ],
  verify:{ ok, issues, page_count_before, page_count_after, changed_parts:[바뀐 ZIP 엔트리], untouched_parts_identical },
  pages_changed:[n..], diff_summary:{added,removed,modified,unchanged}, blocks_changed:[id], block_ids_added:[id], block_ids_removed:[id] }
```
- 연산마다 결과를 다시 읽어 확인하고, 실패한 연산만 되돌려 `skipped` 로 알린다(`VERIFY`).
- 모두 건너뛰면 422 `NO_VALID_OPS`(`skipped`,`applied` 포함). `strict:true` 이고 하나라도 건너뛰면 아무것도 적용하지 않고 같은 코드로 422.
- 마지막에 `validateHwpx`(원본에 없던 문제만 실패로 봄)와 그리기 검사. 실패하면 422 `VERIFY_FAILED`(`verify`)이고 새 버전은 없다.
- `dry_run:true` 는 같은 계산을 하고 저장하지 않는다. `fill_fields`/`redact` 는 연산 자체의 `dry_run` 도 있다(바이트를 안 바꾸고 대상만 보고: `applied[].targets` / `report`, 원문 없이 마스킹된 미리보기만).

### 버전
- `GET /hwp/files/:id/versions` → `{ current, items:[{version,created_at,created_by,note,size,source:'import'|'user'|'ai'|'restore',starred,parent_version,diff_summary,page_count}] }`
- `POST /hwp/files/:id/versions/:v/restore` → `{ version, restored_from }` (새 버전, 바이트는 복사하지 않고 같은 암호문을 가리킨다)
- `POST /hwp/files/:id/versions/:v/star {starred}` — 별표 버전은 정리되지 않는다
- `GET /hwp/files/:id/versions/:v/download`
- 가져오기·편집·되돌리기마다 새 버전. 파일당 50개, 넘으면 별표 없는 가장 오래된 것부터 지운다(현재·별표는 유지, 쓰이지 않는 바이트는 함께 지움).

## 4. 분석·내보내기

- `GET /hwp/files/:id/lint` → `{ version, findings:[{block,cell?,rule,severity:'error'|'warn',message,match,suggest,line}], counts, notes }` (kordoc 표기법 규칙 + 문서 단위 검사). `numbers`/`styles` 검사는 서버 API 에서 아직 안 되고 `notes` 로 알린다.
- `GET /hwp/files/:id/compare?to=<v>[&from=<v=현재>]` → `{ from, to, stats, diffs:[{type,block,block_before?,before,after,cells?:[{row,col,type,before,after}],similarity?}] }`
- `GET /hwp/files/:id/export?format=hwpx|hwp|md|txt|docx[&version=]` — `hwpx`/`hwp` 는 원래 형식 그대로만(다른 쪽은 400), `docx` 는 IR 변환(HWP 5.x 는 내용만 옮겨 근사, 헤더 `X-Hwp-Approximate:1`). `pdf` 는 501 `NOT_IMPLEMENTED`(서버에 Chromium 없음: 클라이언트가 SVG 쪽을 브라우저 인쇄로).
- `POST /hwp/files/:id/convert-to-docs {team_id?}` → 201 `{ item:{id,kind:'doc',title,first_tab}, warnings }` (DAH 문서 새로 만듦)
- `GET /hwp/files/:id/redaction-suggest` → `{ version, total, hits:[{block,cell?,rule,preview(마스킹됨)}] }`

## 5. 오류 코드

| HTTP | code | 뜻 |
|---|---|---|
| 400 | `BAD_REQUEST` / `UNSUPPORTED_FORMAT` | 요청 모양 / 한글·워드만 올릴 수 있음 |
| 401 | `LOGIN` | 로그인 필요 |
| 403 | `FORBIDDEN` | 열람·편집 권한 없음 |
| 404 | `NOT_FOUND` | 파일·버전·쪽 없음 |
| 409 | `VERSION_CONFLICT` | 다른 사람이 먼저 고침(`current_version`) |
| 413 | `TOO_LARGE` | 25MB 초과(직접 업로드는 4MB) |
| 422 | `ENCRYPTED` | 열기 암호 문서: 한컴에서 암호를 풀고 저장해 올려야 함(서버는 암호를 받지 않는다) |
| 422 | `DRM_PROTECTED` / `CORRUPTED` / `ZIP_BOMB` | DRM / 손상·위험한 경로 / 압축 폭탄·엔트리 폭주 |
| 422 | `NO_VALID_OPS` / `VERIFY_FAILED` | 적용할 것이 없음(strict 포함) / 검증 실패 |
| 429 | (예약) `BUSY` | |
| 501 | `NOT_IMPLEMENTED` | pdf 내보내기 |
| 503 | `ENGINE` / `STORAGE` | kordoc 없음 / 저장소·암호화 키(DRIVE_TOKEN_ENC_KEY) 없음 |

## 6. 한도

| 항목 | 값 |
|---|---|
| 파일 | 25MB (직접 업로드 4MB, 그 이상은 blob 직접 업로드 + import) |
| ZIP | 엔트리 5000개, 풀린 크기 300MB (+ kordoc 압축 폭탄 방어), `..`·절대 경로 거부 |
| 편집 한 번 | 연산 200개, 글 20만자, 처리 50초(넘으면 남은 연산 `TIMEOUT`) |
| 블록 읽기 | 300블록 |
| 그리기 | SVG 10쪽, PNG 6쪽, 배율 0.5~3 |
| 버전 | 50개 |

## 7. 저장과 개인정보

- 모든 바이트는 AES-256-GCM 암호문으로만 저장한다. 파일마다 무작위 32바이트 키, 그 키는 `secretBox`(`DRIVE_TOKEN_ENC_KEY`)로 봉인해 `hwp_keys` 에 둔다.
- 암호문이 8MB 이하면 Postgres `hwp_blobs.data`(bytea), 넘으면 Vercel Blob(공개 저장소지만 암호문)에 두고 URL 만 DB 에. 같은 내용은 sha256 으로 하나만 저장.
- 서버는 AI 를 부르지 않는다. 버전마다 `created_by`(이름)·`source`·`note` 가 남는다(AI 도구는 `AI(이름)`).
- 테이블: `hwp_keys`, `hwp_blobs`, `hwp_versions` (모두 `ws_files(id) ON DELETE CASCADE`). 스키마는 `lib/hwpSchema.js` 가 멱등으로 만든다.

## 8. MCP

`lib/hwp/tools.js` 의 `hwpServerTools()` / `registerHwpTools()` 가 `registerServerTools('hwp', ...)` 로 등록한다(도구 이름 `hwp_read_outline`, `hwp_read_blocks`, `hwp_read_fields`, `hwp_edit`, `hwp_lint`, `hwp_compare`, `hwp_list_versions`, `hwp_restore_version`, `hwp_redaction_suggest`). 라우트 모듈을 불러올 때 자동 등록된다.
