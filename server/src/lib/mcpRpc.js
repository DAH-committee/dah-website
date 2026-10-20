// MCP JSON-RPC 2.0 처리 (Streamable HTTP, 서버리스: 세션을 만들지 않는다).
//
// 두 세대를 함께 받는다("dual-era" 서버, 규격: modelcontextprotocol.io/specification/2026-07-28/basic/versioning).
//   - 옛 방식(2025-03-26, 2025-06-18, 2025-11-25): initialize 핸드셰이크. Claude, ChatGPT 가 지금 이 방식으로 접속한다.
//     Mcp-Session-Id 는 만들지 않는다(서버가 세션을 두지 않아도 되는 것이 규격에 허용된다). 들어온 Mcp-Session-Id 는 무시한다.
//   - 새 방식(2026-07-28, 최신): 핸드셰이크 없이 요청마다 _meta 에 protocolVersion. server/discover, resultType, tools/list 의 ttlMs·cacheScope.
// 호출 단위로 상태가 없으므로 어느 서버리스 인스턴스가 받아도 같은 결과가 나온다.
import { SERVER_INSTRUCTIONS, toolSpecs, callTool, RpcError, InsufficientScope, toolCount } from './mcpTools.js'

export const MODERN = '2026-07-28'
export const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
export const SUPPORTED = [MODERN, ...LEGACY]
export const SERVER_INFO = { name: 'dah-workspace', title: '디인예 워크스페이스', version: '1.0.0' }

export const E = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  HEADER_MISMATCH: -32020, // MCP 2026-07-28: 헤더와 본문이 다름
  UNSUPPORTED_VERSION: -32022,
}

const rpcErr = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } })
const META_VER = 'io.modelcontextprotocol/protocolVersion'

/** 이 요청이 새 방식인가: 본문 _meta 의 protocolVersion 이 새 판이거나 헤더가 새 판 */
function eraOf(msg, headers) {
  const v = msg?.params?._meta?.[META_VER]
  const h = headers['mcp-protocol-version']
  return v === MODERN || h === MODERN
}

/**
 * 한 메시지를 처리한다. 반환: JSON-RPC 응답 객체, 알림이면 null.
 * ctx: callTool 에 넘기는 환경({req, session, scopes, base})
 */
async function handleOne(ctx, msg, headers) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { response: rpcErr(null, E.INVALID_REQUEST, '요청 형식이 올바르지 않습니다') }
  if (msg.jsonrpc !== '2.0') return { response: rpcErr(msg.id, E.INVALID_REQUEST, 'jsonrpc 는 "2.0" 이어야 합니다') }
  if (typeof msg.method !== 'string') {
    // 클라이언트가 보낸 응답(result/error)은 받아서 버린다(이 서버는 클라이언트에 요청하지 않는다)
    return msg.result !== undefined || msg.error !== undefined ? { response: null } : { response: rpcErr(msg.id, E.INVALID_REQUEST, 'method 가 없습니다') }
  }
  if (msg.id === undefined) return { response: null } // 알림(notifications/initialized, cancelled 등): 처리할 것 없음
  const { id, method } = msg
  const modern = eraOf(msg, headers)
  const done = (result) => ({ response: { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result } : result } })

  if (modern) {
    // 새 방식 검증: 헤더와 본문이 어긋나면 400(-32020). 모르는 판이면 -32022
    const bodyVer = msg.params?._meta?.[META_VER]
    const hv = headers['mcp-protocol-version']
    if (hv && bodyVer && hv !== bodyVer) return { response: rpcErr(id, E.HEADER_MISMATCH, 'MCP-Protocol-Version 헤더와 본문 _meta 의 protocolVersion 이 다릅니다'), status: 400 }
    const mm = headers['mcp-method']
    if (mm !== undefined && mm !== method) return { response: rpcErr(id, E.HEADER_MISMATCH, `Mcp-Method 헤더(${mm})와 본문 method(${method})가 다릅니다`), status: 400 }
    if (method === 'tools/call') {
      const mn = headers['mcp-name']
      if (mn !== undefined && !/^=\?base64\?/.test(mn) && mn !== msg.params?.name) return { response: rpcErr(id, E.HEADER_MISMATCH, 'Mcp-Name 헤더가 본문 name 과 다릅니다'), status: 400 }
    }
  }
  const asked = msg.params?._meta?.[META_VER] || headers['mcp-protocol-version']
  if (asked && !SUPPORTED.includes(asked) && method !== 'initialize') {
    return { response: rpcErr(id, E.UNSUPPORTED_VERSION, '지원하지 않는 프로토콜 버전입니다', { supported: SUPPORTED, requested: asked }), status: 400 }
  }

  switch (method) {
    case 'initialize': {
      const want = msg.params?.protocolVersion
      const version = LEGACY.includes(want) ? want : LEGACY[0]
      return { response: { jsonrpc: '2.0', id, result: { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS } } }
    }
    case 'ping':
      return { response: { jsonrpc: '2.0', id, result: {} } }
    case 'server/discover':
      return done({ supportedVersions: SUPPORTED, capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO }, instructions: SERVER_INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: 'public' })
    case 'tools/list':
      return done({ tools: toolSpecs(ctx.scopes), ...(modern ? { ttlMs: 60_000, cacheScope: 'private' } : {}) })
    case 'tools/call': {
      const p = msg.params
      if (!p || typeof p.name !== 'string') return { response: rpcErr(id, E.INVALID_PARAMS, 'params.name 이 필요합니다') }
      const started = Date.now()
      try {
        const res = await callTool(ctx, p.name, p.arguments)
        return { ...done(res), tool: p.name, audit: res._audit || null, ok: !res.isError, code: res.structuredContent?.code || null, ms: Date.now() - started }
      } catch (e) {
        if (e instanceof InsufficientScope) return { scopeError: e.scope, tool: p.name, ok: false, code: 'insufficient_scope', ms: Date.now() - started, response: rpcErr(id, E.INVALID_REQUEST, e.message) }
        if (e instanceof RpcError) return { response: rpcErr(id, e.rpcCode, e.message, e.data), tool: p.name, ok: false, code: 'invalid_params', ms: Date.now() - started }
        console.error('[mcp] tools/call 오류', p.name, e)
        return { response: rpcErr(id, E.INTERNAL, '서버 오류'), tool: p.name, ok: false, code: 'internal', ms: Date.now() - started }
      }
    }
    // 선언하지 않은 기능이지만 일부 클라이언트가 그냥 부르므로 빈 목록으로 답한다
    case 'resources/list': return done({ resources: [] })
    case 'resources/templates/list': return done({ resourceTemplates: [] })
    case 'prompts/list': return done({ prompts: [] })
    case 'logging/setLevel': return done({})
    default:
      return { response: rpcErr(id, E.METHOD_NOT_FOUND, `지원하지 않는 메서드입니다: ${String(method).slice(0, 80)}`), status: modern ? 404 : undefined }
  }
}

/**
 * 본문 하나(요청 하나, 또는 옛 규격의 배열)를 처리한다.
 * 반환: { status, body|null, calls:[{tool, ok, code, ms, audit}], scopeError? }
 */
export async function handleRpc(ctx, body, headers) {
  const calls = []
  const take = (r) => {
    if (r.tool) calls.push({ tool: r.tool, ok: r.ok, code: r.code, ms: r.ms, audit: r.audit || null })
    return r
  }
  if (Array.isArray(body)) {
    if (!body.length) return { status: 400, body: rpcErr(null, E.INVALID_REQUEST, '빈 배열입니다'), calls }
    if (body.length > 20) return { status: 400, body: rpcErr(null, E.INVALID_REQUEST, '한 번에 보낼 수 있는 요청은 20개입니다'), calls }
    const out = []
    for (const m of body) {
      const r = take(await handleOne(ctx, m, headers))
      if (r.scopeError) return { status: 403, scopeError: r.scopeError, body: r.response, calls }
      if (r.response) out.push(r.response)
    }
    return out.length ? { status: 200, body: out, calls } : { status: 202, body: null, calls }
  }
  const r = take(await handleOne(ctx, body, headers))
  if (r.scopeError) return { status: 403, scopeError: r.scopeError, body: r.response, calls }
  if (!r.response) return { status: 202, body: null, calls }
  return { status: r.status || (r.response.error && r.response.error.code === E.INVALID_REQUEST ? 400 : 200), body: r.response, calls }
}
export { toolCount }
