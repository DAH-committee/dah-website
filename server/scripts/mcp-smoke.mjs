// MCP 연결 시험용 클라이언트(fetch 만 사용): OAuth(등록, PKCE, 동의, 토큰) -> 도구 목록 -> doc_get_outline, doc_fix_typos 호출
// 사용: node scripts/mcp-smoke.mjs <서버주소> <로그인쿠키값> [파일id|new]
//   예) node scripts/mcp-smoke.mjs http://mc.localhost:3261 "$(node scripts/mint-token.mjs staff 1 smmilk2378@gmail.com 주현호 owner)" new
//   쿠키값은 dah_access(스태프) 또는 COOKIE_NAME=dah_pub_access 로 게스트 토큰을 넘긴다.
// "new" 면 시험용 문서를 만들고 편집기 주소를 출력한 뒤, 그 탭이 열릴 때까지 기다린다(최대 120초). 브라우저에서 그 주소를 열어 두면 이어서 실행한다.
// 이 스크립트가 만든 문서(제목 "[mcp-smoke]")는 CLEANUP=1 이면 끝에서 휴지통이 아니라 서버 DB 에서 바로 지우지 않는다(MCP 에는 삭제 도구가 없다). 시험 뒤 직접 지운다.
import crypto from 'node:crypto'

const [, , BASE_ARG, COOKIE_VAL, FILE_ARG = 'new'] = process.argv
if (!BASE_ARG || !COOKIE_VAL) {
  console.error('사용: node scripts/mcp-smoke.mjs <서버주소> <로그인쿠키값> [파일id|new]')
  process.exit(2)
}
const BASE = BASE_ARG.replace(/\/+$/, '')
const COOKIE = `${process.env.COOKIE_NAME || 'dah_access'}=${COOKIE_VAL}`
const REDIRECT = 'http://127.0.0.1:53999/callback'
const b64 = (b) => Buffer.from(b).toString('base64url')
const log = (...a) => console.log(...a)
const ok = (cond, msg) => {
  if (!cond) {
    console.error('실패:', msg)
    process.exit(1)
  }
  log('  확인:', msg)
}

async function json(res) {
  const t = await res.text()
  try {
    return JSON.parse(t)
  } catch {
    return { _text: t }
  }
}

// 1) 메타데이터
log('1. 메타데이터')
const prm = await json(await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`))
const as = await json(await fetch(`${BASE}/.well-known/oauth-authorization-server`))
ok(prm.resource?.endsWith('/mcp'), `보호 자원 ${prm.resource}`)
ok(as.code_challenge_methods_supported?.join() === 'S256', 'PKCE S256 만')
const unauth = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' })
ok(unauth.status === 401 && /resource_metadata/.test(unauth.headers.get('www-authenticate') || ''), '토큰 없으면 401 + resource_metadata')

// 2) 등록 -> 인가 -> 토큰
log('2. OAuth')
const reg = await json(await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'mcp-smoke', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) }))
ok(reg.client_id, `클라이언트 등록 ${reg.client_id}`)
const verifier = b64(crypto.randomBytes(40))
const challenge = b64(crypto.createHash('sha256').update(verifier).digest())
const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'dah.read dah.write', state: 'smoke', resource: prm.resource })
const page = await fetch(`${as.authorization_endpoint}?${q}`, { headers: { Cookie: COOKIE }, redirect: 'manual' })
ok(page.status === 200, `동의 화면 ${page.status}`)
const html = await page.text()
const txn = /name="txn" value="([^"]+)"/.exec(html)?.[1]
ok(txn && html.includes('허용'), '동의 화면에 허용 단추')
const dec = await fetch(as.authorization_endpoint, { method: 'POST', headers: { Cookie: COOKIE, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ txn, decision: 'allow', write: '1' }), redirect: 'manual' })
ok(dec.status === 302, '허용 -> 302')
const loc = new URL(dec.headers.get('location'))
ok(loc.searchParams.get('state') === 'smoke' && loc.searchParams.get('iss') === as.issuer, 'state, iss 돌려받음')
const tok = await json(await fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: reg.client_id, code: loc.searchParams.get('code'), redirect_uri: REDIRECT, code_verifier: verifier, resource: prm.resource }) }))
ok(tok.access_token && tok.refresh_token, '액세스, 리프레시 토큰 발급')
let access = tok.access_token

let id = 0
async function rpc(method, params) {
  const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${access}`, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
  const body = await json(res)
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`)
  return body.result
}
const callTool = async (name, args) => rpc('tools/call', { name, arguments: args })

// 3) 초기화, 도구 목록
log('3. MCP')
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '1' } })
ok(init.serverInfo?.name === 'dah-workspace', `initialize ${init.protocolVersion}`)
const list = await rpc('tools/list')
const names = list.tools.map((t) => t.name)
ok(names.includes('doc_get_outline') && names.includes('doc_fix_typos') && names.includes('list_files'), `도구 ${names.length}개`)

// 4) 파일 준비
let fileId = Number(FILE_ARG)
if (FILE_ARG === 'new') {
  const created = await callTool('create_file', { kind: 'doc', title: `[mcp-smoke] ${new Date().toISOString().slice(0, 16)}` })
  ok(!created.isError, '시험 문서 만들기')
  fileId = created.structuredContent.data.id
  log(`  문서 id ${fileId}`)
  log(`  편집기 주소: ${created.structuredContent.data.editor_url}`)
}
const info = await callTool('get_file_info', { file_id: fileId })
log(`  편집기 주소(정보): ${info.structuredContent.data.editor_url}`)

// 5) 편집기 탭이 열릴 때까지 기다린다
log('4. 편집기 탭 기다리는 중 (브라우저에서 위 주소를 열어 두세요)')
const waitUntil = Date.now() + 120_000
for (;;) {
  const o = await callTool('open_in_editor', { file_id: fileId })
  if (o.structuredContent.data.tab_open) break
  if (Date.now() > waitUntil) {
    console.error('탭이 열리지 않았습니다')
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 2000))
}
log('  탭 확인')

// 6) 문서에 오타가 있는 글을 넣고 개요를 읽고 고친다
log('5. 편집 도구')
let t0 = Date.now()
const ins = await callTool('doc_insert_blocks', { file_id: fileId, after_n: 0, blocks: [{ type: 'heading', level: 1, text: '시험 문서' }, { type: 'paragraph', text: '이 문서는 오타가 잇는 문장입니다. 맞춤뻡을 고쳐 주세요.' }, { type: 'heading', level: 2, text: '둘째 제목' }, { type: 'paragraph', text: '두번째 문단도 틀린 곳이 있읍니다.' }] })
ok(!ins.isError, `doc_insert_blocks (${Date.now() - t0}ms) ${ins.structuredContent.data?.summary || ''}`)
t0 = Date.now()
const outline = await callTool('doc_get_outline', { file_id: fileId })
ok(!outline.isError && /dah_untrusted_data/.test(outline.content[0].text), `doc_get_outline (${Date.now() - t0}ms), 문서 글은 신뢰할 수 없는 데이터로 표시됨`)
log('  개요:', JSON.stringify(outline.structuredContent.data.result).slice(0, 300))
const read = await callTool('doc_read_document', { file_id: fileId })
ok(!read.isError, 'doc_read_document')
const readData = JSON.stringify(read.structuredContent.data.result)
log('  읽은 글(앞부분):', readData.slice(0, 300))
const paras = (read.structuredContent.data.result?.text || read.structuredContent.data.result?.content || '').toString()
const num = (re) => Number((new RegExp(`\\[(\\d+)\\][^\\n]*${re}`).exec(paras) || [])[1])
const n1 = num('잇는') || 2
const n2 = num('있읍니다') || 4
t0 = Date.now()
const fix = await callTool('doc_fix_typos', { file_id: fileId, fixes: [{ n: n1, text: '이 문서는 오타가 있는 문장입니다. 맞춤법을 고쳐 주세요.' }, { n: n2, text: '두 번째 문단도 틀린 곳이 있습니다.' }] })
ok(!fix.isError, `doc_fix_typos (${Date.now() - t0}ms) ${fix.structuredContent.data?.summary || fix.content[0].text.slice(0, 120)}`)

// 편집 직후 화면을 확인할 시간을 준다: HOLD_SECS 초 동안 4초마다 읽기 도구를 불러 연결을 유지한다(편집기 상단에 "외부 AI 연결 중" 이 보인다)
const hold = Number(process.env.HOLD_SECS || 0)
if (hold) {
  log(`  ${hold}초 동안 연결 유지`)
  for (const end = Date.now() + hold * 1000; Date.now() < end; ) {
    await callTool('doc_get_outline', { file_id: fileId })
    await new Promise((r) => setTimeout(r, 4000))
  }
}

// 7) 되돌리기, 확인 장치, 권한
log('6. 되돌리기와 안전장치')
const after = await callTool('doc_read_document', { file_id: fileId })
ok(/있는 문장/.test(JSON.stringify(after.structuredContent.data.result)), '편집기에 수정이 반영됨')
if (process.env.UNDO === '1') {
  const undo = await callTool('undo_last_change', { file_id: fileId })
  ok(!undo.isError, `undo_last_change ${undo.structuredContent.data?.summary || ''}`)
  const back = await callTool('doc_read_document', { file_id: fileId })
  ok(/잇는/.test(JSON.stringify(back.structuredContent.data.result)), '되돌리기로 원래 글이 돌아옴')
}
const other = await callTool('read_file_text', { file_id: 1 })
log('  남의 파일/없는 파일 읽기 ->', other.isError ? '거절됨' : '읽힘(내 파일일 수 있음)')

// 8) 리프레시 회전
log('7. 리프레시 회전')
const r1 = await json(await fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: tok.refresh_token }) }))
ok(r1.access_token && r1.refresh_token !== tok.refresh_token, '리프레시 토큰이 새로 발급됨')
const replay = await json(await fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: tok.refresh_token }) }))
ok(replay.error === 'invalid_grant', '이미 쓴 리프레시 토큰은 거절(연결 폐기)')
await fetch(as.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: r1.access_token, client_id: reg.client_id }) })
log('완료. 문서 id', fileId)
