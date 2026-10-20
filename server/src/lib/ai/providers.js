// lib/ai/providers.js: 제공업체 목록, 주소 만들기, 호출 도구
// 모델 목록은 두지 않는다(항상 제공업체에서 불러온다). 각 제공업체의 기본 모델 "추천"은 어댑터가 불러온 목록에서 고른다.
import anthropic from './anthropic.js'
import openai from './openai.js'
import gemini from './gemini.js'
import compat from './compat.js'
import mock from './mock.js'
import { AiError } from './errors.js'
import { UnsafeUrlError, assertPublicUrl, safeRequest } from '../safeFetch.js'

// 서버 제공자는 API 키를 받는다. ChatGPT 요금제 OAuth는 별도 로컬 공급자(chatgpt-local)가 브라우저에서 연결 프로그램으로 직접 호출한다.
export const PROVIDERS = [
  { id: 'anthropic', name: 'Claude', adapter: anthropic, authType: 'apikey', origin: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', keyHelp: 'Anthropic Console에서 API 키를 만들고 결제 수단을 등록하세요. Claude.ai 구독 로그인은 외부 앱에서 쓸 수 없습니다.' },
  { id: 'openai', name: 'OpenAI API 키', adapter: openai, authType: 'apikey', origin: 'https://api.openai.com', keyUrl: 'https://platform.openai.com/api-keys', keyHelp: 'OpenAI Platform에서 API 키를 만드세요. ChatGPT 구독과는 별도로 API 요금이 청구됩니다.' },
  { id: 'gemini', name: 'Gemini', adapter: gemini, authType: 'apikey', origin: 'https://generativelanguage.googleapis.com', keyUrl: 'https://aistudio.google.com/app/apikey', keyHelp: 'Google AI Studio에서 무료 API 키를 받을 수 있습니다(무료 한도 안에서 사용).' },
  { id: 'deepseek', name: 'DeepSeek', adapter: compat, authType: 'apikey', origin: 'https://api.deepseek.com', basePath: '', prefer: [/^deepseek-chat$/], keyUrl: 'https://platform.deepseek.com/api_keys', keyHelp: 'DeepSeek 플랫폼에서 API 키를 만들고 잔액을 충전하세요.' },
  { id: 'kimi', name: 'Kimi', adapter: compat, authType: 'apikey', origin: 'https://api.moonshot.ai', basePath: '/v1', prefer: [/^kimi-k\d+(\.\d+)?$/, /^kimi-/], keyUrl: 'https://platform.kimi.ai/console/api-keys', keyHelp: 'Kimi API 플랫폼의 API Keys에서 키를 만드세요(해외 주소 api.moonshot.ai).' },
  { id: 'qwen', name: 'Qwen', adapter: compat, authType: 'apikey', origin: 'https://dashscope-intl.aliyuncs.com', basePath: '/compatible-mode/v1', hostSuffix: '.aliyuncs.com', prefer: [/^qwen-plus$/, /^qwen\d*-plus$/, /^qwen/], keyUrl: 'https://modelstudio.console.alibabacloud.com/model/settings/api-key', keyHelp: 'Alibaba Model Studio(싱가포르)에서 키를 만드세요. 키는 만든 지역에서만 동작합니다. 작업공간 주소를 쓰는 계정은 주소 칸에 넣으세요.' },
  { id: 'glm', name: 'GLM', adapter: compat, authType: 'apikey', origin: 'https://api.z.ai', basePath: '/api/paas/v4', usage: false, extraBody: { thinking: { type: 'disabled' } }, prefer: [/^glm-\d+(\.\d+)?$/, /^glm-/], keyUrl: 'https://z.ai/manage-apikey/apikey-list', keyHelp: 'Z.ai에서 API 키를 만드세요(Zhipu 글로벌 서비스).' },
  { id: 'custom', name: 'OpenAI 호환', adapter: compat, authType: 'apikey', userBase: true, keyUrl: null, keyHelp: 'OpenAI 호환 주소(https, 예: https://서버/v1)와 그 서비스의 키를 입력하세요. 내부망·로컬 주소는 쓸 수 없습니다.' },
]

export const MOCK = { id: 'mock', name: 'Mock(시험)', adapter: mock, authType: 'none', keyUrl: null, keyHelp: '시험용 가짜 제공업체입니다.', noKey: true }

export const mockEnabled = () => process.env.AI_MOCK === '1' && process.env.NODE_ENV !== 'production'

export function listDefs() {
  return mockEnabled() ? [...PROVIDERS, MOCK] : PROVIDERS
}
export function getDef(id) {
  const found = PROVIDERS.find((p) => p.id === id)
  if (found) return found
  return id === 'mock' && mockEnabled() ? MOCK : null
}

const overrideOrigin = (id) => {
  if (process.env.NODE_ENV === 'production') return null
  const v = process.env[`AI_BASE_OVERRIDE_${id.toUpperCase()}`]
  return v ? new URL(v).origin : null
}

/** 사용자가 넣은 기준 주소를 검사해 정리한다(custom 은 필수, qwen 은 aliyuncs.com 만). 통과하지 못하면 AiError(400) */
export function normalizeBaseUrl(def, raw) {
  const text = String(raw || '').trim()
  if (!text) {
    if (def.userBase) throw new AiError('BAD_REQUEST', 'OpenAI 호환 주소를 입력하세요. 예: https://서버/v1', 400)
    return ''
  }
  if (!def.userBase && !def.hostSuffix) return ''
  let u
  try {
    u = assertPublicUrl(text)
  } catch (e) {
    if (e instanceof UnsafeUrlError || e.code === 'UNSAFE_URL') throw new AiError('UNSAFE_URL', e.message === '이 주소는 사용할 수 없습니다' ? '이 주소는 사용할 수 없습니다. 공개된 https 주소만 연결할 수 있습니다.' : e.message, 400)
    throw e
  }
  if (u.protocol !== 'https:') throw new AiError('UNSAFE_URL', 'https 주소만 연결할 수 있습니다.', 400)
  if (u.search || u.hash) throw new AiError('UNSAFE_URL', '주소에 물음표(?)나 #를 넣을 수 없습니다.', 400)
  if (def.hostSuffix && !u.hostname.toLowerCase().endsWith(def.hostSuffix)) throw new AiError('UNSAFE_URL', `이 제공업체는 ${def.hostSuffix} 주소만 쓸 수 있습니다.`, 400)
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

/**
 * 어댑터에 넘기는 호출 문맥. call(path, init) 는 표준 Response 를 돌려준다.
 * 미리 정해 둔 공식 주소는 fetch(리디렉션 금지), 사용자가 준 주소(custom, qwen 작업공간)는 DNS 검사 요청(safeRequest)을 쓴다.
 * 시험에서만 AI_BASE_OVERRIDE_<ID>=http://127.0.0.1:포트 로 주소의 출처(origin)를 바꾼다(운영에서는 무시).
 */
export function makeCtx(def, conn, { apiKey, model, signal, maxTokens, temperature, system, messages, tools }) {
  const override = overrideOrigin(def.id)
  const userBase = conn?.baseUrl || ''
  let base
  if (userBase) {
    const u = new URL(userBase)
    base = override ? `${override}${u.pathname.replace(/\/+$/, '')}` : userBase
  } else {
    base = `${override || def.origin}${def.basePath || ''}`
  }
  const viaSafe = Boolean(userBase) && !override
  const call = async (path, init) => {
    const url = `${base}${path}`
    try {
      return viaSafe ? await safeRequest(url, init) : await fetch(url, { ...init, redirect: 'error' })
    } catch (e) {
      if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || init?.signal?.aborted) throw e
      if (e instanceof UnsafeUrlError || e?.code === 'UNSAFE_URL') throw new AiError('UNSAFE_URL', '이 주소는 사용할 수 없습니다. 공개된 https 주소만 연결할 수 있습니다.', 400)
      throw new AiError('UPSTREAM', '제공업체에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.', 502)
    }
  }
  return { def, apiKey, model, signal, maxTokens, temperature, system, messages, tools, call }
}
