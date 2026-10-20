# AI 창 (문서·발표·보드 옆 AI): 계약서

목표: 사용자마다 자기 AI 계정의 키를 연결해서(우리가 비용을 내지 않는다) 문서 옆 AI 창에 말하면 문장을 고치고 오타를 잡고 발표까지 다듬어 준다.
왜 키 방식인가(2026-10-12 확인한 공식 문서):
- Claude: 서드파티 앱에서 Claude.ai 구독 로그인을 제공하는 것을 Anthropic 이 허용하지 않는다(code.claude.com/docs/en/legal-and-compliance, support.claude.com 로그인 문서). 개인 API 키만 쓴다.
- ChatGPT: "ChatGPT로 로그인해서 내 플랜으로 쓰기"(Sign in with ChatGPT)는 오픈소스·로컬 앱은 바로 쓸 수 있고, 서버에 올린 앱은 OpenAI 신청서(interest form) 승인이 필요하다. 승인되면 adapter 하나를 더하면 되도록 `authType` 필드를 둔다(지금은 모두 'apikey').
- Gemini: 구독을 서드파티 앱에서 쓰는 공식 방법이 없다. AI Studio 무료 API 키(aistudio.google.com/app/apikey)를 쓴다.

## 구성
```
client/src/components/ai/
  aiClient.js        서버 /ai/* 호출, 스트림 읽기 (담당 S)
  AiPanel.jsx        공용 채팅 창 (담당 S)
  AiSettingsDialog.jsx  제공업체·키·모델 연결 창 (담당 S)
  ai.css
server/src/routes/ai.js            /ai/* (담당 S)
server/src/lib/ai/*.js             제공업체별 어댑터 (담당 S)
client/src/pages/handover/aiDocTools.js   문서용 도구 (담당 D)
client/src/pages/slides/aiSlideTools.js, client/src/pages/board/aiBoardTools.js  (담당 P)
```

## 서버 API (모두 로그인 필수, 키는 서버에서만 쓰고 화면으로 돌려주지 않는다)
- `GET  /ai/providers` -> `[{ id, name, authType:'apikey', keyUrl, keyHelp, connected:boolean, keyHint:'…ab12'|null, model:string|null, maxTokens:number|null, baseUrl?:string, needsBaseUrl:boolean, allowBaseUrl:boolean }]` (`models` 는 목록에 없다: 모델은 항상 `/ai/models` 로 불러온다)
  제공업체 id: `anthropic`(Claude), `openai`(OpenAI), `gemini`(Gemini), `deepseek`, `kimi`, `qwen`, `glm`, `custom`(OpenAI 호환 주소 직접 입력). 공식 주소·모델 목록 경로·헤더는 각 문서에서 확인해 쓴다.
- `PUT  /ai/connections/:provider` body `{ apiKey?, model?, baseUrl?, maxTokens? }` -> 키를 한 번 시험 호출(모델 목록)로 확인한 뒤 `secretBox` 로 봉인해 `ws_connections`(provider 칼럼 값 `ai:<id>`, 키 힌트·모델·주소는 `meta`)에 저장. 이미 연결돼 있으면 `apiKey` 없이 `model`/`maxTokens` 만 바꿔 저장할 수 있다(시험 호출 없음). 응답 `{ provider, connected, keyHint, model, maxTokens, baseUrl?, models, suggested, unverified }`. 실패는 한국어 `{ error, code }` (`BAD_KEY`, `UNSAFE_URL`, `BAD_REQUEST`, `RATE_LIMIT`, `UPSTREAM`, `NO_SECRET_BOX`).
- `POST /ai/test` body `{ provider, apiKey?, baseUrl? }` -> 저장하지 않고 키만 확인: `{ ok, models:[{id,name}], suggested, unverified }`. `apiKey` 를 생략하면 저장된 키를 쓴다. 설정 창의 "연결 테스트" 버튼이 쓴다.
- `DELETE /ai/connections/:provider`
- `GET  /ai/models?provider=` -> `[{id,name}]` (저장된 키로 제공업체에서 가져옴, 5분 메모리 캐시). 모델 목록은 어디에도 박아 두지 않는다. 기본 모델 "추천"(`suggested`)만 불러온 목록에서 고른다.
- `POST /ai/chat` (SSE, `text/event-stream`) body:
  ```
  { provider, model, system?: string, messages: Msg[], tools?: ToolSpec[], maxTokens?: number, temperature?: number }
  Msg = { role:'user'|'assistant'|'tool', content:string,
          images?: string[],                       // data URL (png/jpeg/webp), 사용자 메시지에만
          toolCalls?: [{ id, name, args:object }], // assistant 가 도구를 불렀을 때
          toolCallId?: string, toolName?: string,  // role 'tool' 결과
          meta?: any }                             // 제공업체가 되돌려 받아야 하는 값. 클라이언트는 그대로 보관만 한다
  // toolCalls[i] 에도 `meta` 가 올 수 있다(tool_call 이벤트의 meta 를 그대로 붙인다: Gemini 생각 서명 등). assistant 메시지의 `meta` 는 done 이벤트의 meta 다.
  ToolSpec = { name, description, parameters: JSONSchema }
  ```
  응답 이벤트(각 줄 `data: {json}`):
  `{type:'text', delta}` | `{type:'tool_call', id, name, args, meta?}` | `{type:'done', stopReason:'end'|'tool_use'|'length'|'error', usage?:{inputTokens,outputTokens}, meta?}` | `{type:'error', code, message}`
  연결이 열린 뒤에는 모든 실패가 `error` 이벤트(마지막)로 온다. 연결이 열리기 전 실패(로그인 `401 LOGIN`, 연결 안 됨 `409 NOT_CONNECTED`/`BAD_KEY`, 입력 오류 `400 BAD_REQUEST`, 본문 600KB 초과 `413 TOO_LARGE`, 분당 한도 `429 RATE_LIMIT`)는 일반 JSON `{ error, code }` 다. 클라이언트(`aiClient.streamChat`)가 둘을 같은 `AiError` 로 합친다. 스트림 중간에 `: ping` 주석 줄이 올 수 있다(무시).
  서버 제한: 사용자당 분당 20회, 본문 600KB, 메시지 60개, 도구 24개. 프롬프트·응답은 서버에 저장하거나 기록하지 않는다. 연결 안 됨 `NOT_CONNECTED`, 키 거절 `BAD_KEY`, 한도 `RATE_LIMIT`, 기타 `UPSTREAM`.
  도구 실행은 클라이언트 몫이다: 모델이 tool_call 을 주면 클라이언트가 실행하고 role 'tool' 메시지를 붙여 다시 `/ai/chat` 을 부른다(패널이 반복을 맡는다, 최대 8회).

## 시험용 제공업체 mock (D·P 가 도구를 시험할 때)
`AI_MOCK=1` 로 서버를 띄운 때만 `GET /ai/providers` 에 `mock` 이 나오고(키 필요 없음, 항상 연결됨, 모델 `mock-1`·`mock-2`) `/ai/chat` 에서 쓸 수 있다. 운영(`NODE_ENV=production`)에서는 환경변수가 켜져 있어도 목록에도 요청에도 나오지 않는다.
- 마지막 사용자 메시지가 `/mock ` 로 시작하고 뒤가 JSON 이면 그 이벤트를 그대로(이벤트 사이 15ms, `delayMs` 로 조절) 흘려 보낸다:
  `/mock {"events":[{"type":"text","delta":"고칩니다. "},{"type":"tool_call","name":"replace_text","args":{"find":"잇","replace":"있"}}]}`
  `tool_call` 이 하나라도 있으면 `done.stopReason` 은 `tool_use`(id 는 없으면 만들어 준다). `"error":{"code":"BAD_KEY","message":"…"}` 를 넣으면 이벤트를 보낸 뒤 오류 이벤트로 끝난다.
- 마지막 메시지가 도구 결과(role `tool`)면 `도구 결과를 받았습니다: <앞 80자>` 로 답한다(도구를 더 부르지 않는다). 그 밖에는 `에코: <내용>` (이미지가 있으면 `(이미지 N장)` 도 붙인다).
- 한 번에 도구 여러 개를 시험하려면 `events` 에 `tool_call` 을 여러 개 넣는다. 패널은 순서대로 실행하고 결과를 한꺼번에 붙여 다시 보낸다.
- 패널 화면 시험: 서버 `cd server && AI_MOCK=1 PORT=3201 CLIENT_ORIGIN=http://localhost:5601 node src/index.js`, 클라이언트 `VITE_API_URL=http://localhost:3201 npx vite --port 5601`. 패널 아래의 제공업체 선택에서 `Mock(시험)` 을 고른다.

## 공용 패널 (담당 S가 만든다, D·P 가 가져다 쓴다)
```jsx
<AiPanel
  open onClose
  scope="doc:<fileId>"            // 대화 기록 저장 키(브라우저 localStorage 만, 서버 저장 없음)
  title="문서 AI"
  systemPrompt={string}            // 편집기별 역할 설명(한국어)
  tools={Tool[]}                   // 아래
  getContext={() => string}        // 매 전송 때 불러, 지금 보이는 상태(선택 글, 쪽 번호 등)를 짧은 글로 돌려줌. 패널이 시스템 프롬프트 뒤에 붙인다
  quickActions={[{ label, prompt }]}   // 입력창 위 한 줄 버튼
  placeholder canEdit                // canEdit=false 면 도구 실행 대신 제안만 하게 안내하고 도구 목록을 보내지 않는다
/>
Tool = {
  name, description, parameters: JSONSchema,
  run: async (args) => ({ result: any,        // 모델에게 돌려줄 값(작게)
                          summary: string,    // 사용자에게 보일 한 줄("3곳 고침")
                          undo?: () => void }) // 있으면 패널이 "되돌리기" 버튼을 보인다
}
```
패널 동작: 제공업체 미연결이면 연결 창(AiSettingsDialog)으로 안내; 제공업체·모델 선택(마지막 선택 기억); 스트리밍 표시; 중단 버튼; 도구 호출 카드(이름, 요약, 되돌리기); 대화 지우기; 이미지 첨부(붙여넣기 포함, 선택); 오류는 한국어로 표시하고 키 문제면 설정 열기 버튼; 개인정보 안내 한 줄("현재 문서 내용이 내가 연결한 AI 제공업체로 전송됩니다").
패널 UI 규칙은 아래 '디자인 규칙'.

## 클라이언트 도우미 (aiClient.js)
패널이 쓰는 함수이고, 패널 없이 쓸 일은 거의 없다.
- `listProviders()`, `listModels(provider)`, `testConnection(body)`, `connectProvider(provider, body)`, `disconnectProvider(provider)`
- `streamChat(body, { signal })` async generator: 계약의 이벤트를 하나씩 돌려준다. 실패는 `AiError(code, message)` 를 던진다. 중단하면 조용히 끝난다.
- `runChat({ provider, model, getSystem|system, messages, tools, maxTokens, signal, onMessages, onToolStart, onToolEnd })` -> `{ messages, error?, stopReason, steps, usage }`. 보내고, 글과 도구 호출을 모으고, `tools[i].run(args)` 를 실행하고, role `tool` 메시지를 붙여 다시 보내는 일을 최대 8번 한다(`stopReason` 이 `max_steps` 면 한도에서 멈춘 것). `run` 이 던진 오류는 모델에게 `{error}` 로 돌려준다. 보낼 때는 `run` 을 뺀 ToolSpec 만, 이전 차례의 이미지는 빼고, 본문이 480KB·메시지 56개를 넘으면 오래된 차례부터 뺀다.
- 대화 기록은 `loadHistory(scope)`/`saveHistory(scope, messages)`/`clearHistory(scope)` (localStorage `dah-ai:v1:<scope>`, 이미지·키 저장 안 함, 약 180KB·60개 한도).

## 편집기별 도구 가이드 (D·P 가 구현)
- 문서: `read_document`(전체 또는 범위, 문단 번호 포함), `get_selection`, `replace_selection`, `replace_text`(찾아 바꾸기, 여러 곳), `edit_paragraphs`(문단 번호로 교체/삽입/삭제), `fix_typos`(전체 맞춤법·띄어쓰기를 문단 단위 변경안으로 만들어 한 번에 적용, 되돌리기 1회), `insert_table`, 공문 검사(`/api/hwpx/lint` 호출 결과 반영), `set_document_title`. 편집은 항상 `undo` 를 돌려준다(Tiptap 한 번의 트랜잭션으로 묶어 에디터의 실행취소로도 되돌려짐).
- 발표: `read_deck`, `read_slide`, `edit_slide_text`, `add_slide`(레이아웃 지정), `create_deck_from_outline`(기존 "글로 만들기" 해석기 재사용), `set_notes`, `restyle`(테마·레이아웃 변경), `shorten_text`.
- 보드: `read_canvas`, `add_sticky_notes`(여러 장, 위치는 서버가 아니라 클라이언트가 격자로 배치), `group_by_theme`, `summarize_canvas`.

## 디자인 규칙 (사용자가 엄격하다)
밝은 바탕; 카드·패널에 테두리선·옆줄 금지(채움 또는 그림자 `0 1px 4px rgba(0,0,0,.22)`); 연한(파스텔) 색 금지: 채도 높은 색과 무채색만(보라 #7A3CFF, hover #6200ea, 노랑 #FFEA00/#FFB300, 빨강 #FF1744, 초록 #00E676, 회색); 선택·활성은 회색 #e2e2e2 + 보라 아이콘; 브라우저 기본 alert/confirm/prompt 금지(`client/src/components/common/AppDialog.jsx`); 모달은 크기가 바뀌지 않게; 이모지·em dash 금지; 한국어 짧게; lucide-react 아이콘; 제공업체 로고 이미지는 쓰지 않는다(글자 이름만).

## 외부 AI 앱(MCP)으로 편집기 쓰기
사용자의 Claude, ChatGPT, Codex, Gemini CLI 같은 공식 앱이 우리 서버의 MCP 커넥터(`/mcp`)에 접속해 같은 도구를 부른다. AI 계정 정보는 우리가 받지 않는다(앱이 우리에게 접속한다).
- 서버: `server/src/routes/mcp.js`(OAuth 2.1 + JSON-RPC), `server/src/lib/mcpTools.js`(도구 등록부), `server/src/lib/mcpRelay.js`(탭 릴레이), 편집기 도구 명세는 `server/src/lib/mcpCatalog.json`.
- 편집기 도구의 이름·설명·매개변수를 바꾸거나 새 도구를 만들면 `cd server && node scripts/gen-mcp-catalog.mjs` 로 카탈로그를 다시 뽑아 커밋한다(서버는 클라이언트 코드를 가져갈 수 없어 명세만 복사해 둔다).
- 편집기에서는 AiPanel 에 넘기는 것과 같은 도구 배열로 훅 한 줄을 부른다: `const relay = useMcpRelay({ fileId, kind, tools, canEdit })` 그리고 상단 줄에 `{relay.badge}`. 외부 AI 앱이 부르는 도구는 이 도구 배열의 `run` 으로 실행되므로 실행취소, 자동 저장, 확인 장치가 AI 창과 똑같다. `run` 이 돌려주는 `undo` 는 훅이 기억해 "마지막 변경 되돌리기"(`undo_last_change`)에 쓴다.
- 새 파일 종류의 서버 실행 도구(예: 한글 파일)는 `registerServerTools(kind, tools)` 한 번 호출로 붙인다.
- 지우기·덮어쓰기는 도구가 `needsConfirmation` 결과를 돌려주거나(시트), `mcpTools.js` 의 `CONFIRM_GATES` 에 적어 `confirmed:true` 없이는 편집기로 보내지 않는다.
