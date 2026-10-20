// AI 글 정리. 모델이 습관처럼 붙이는 마크다운 기호(**, *, __, ~~, #, >, |표|, ---, [글](주소), <br> 등)와
// 도구 호출 찌꺼기(<function_calls>, {"name":..., "arguments":...})를 걷어낸다. 순수 함수만 둔다(DOM 없음).

const TOOL_TAGS = /<\s*(function_calls?|antml:[a-z_]+|tool_calls?|tool_use|invoke|parameter|thinking|analysis)\b[\s\S]*?<\s*\/\s*\1[^>]*>/gi
const LONE_TOOL_TAG = /<\/?\s*(function_calls?|antml:[a-z_]+|tool_calls?|tool_use|invoke|parameter|thinking|analysis)\b[^>]*>/gi

// 도구 호출처럼 보이는 JSON 덩어리인가
function looksLikeToolJson(s) {
  const t = s.trim()
  if (!/^[\[{]/.test(t)) return false
  return /"(name|tool|function)"\s*:/.test(t) && /"(arguments|args|input|parameters)"\s*:/.test(t)
}

/** 화면에 보여 줄 답변 글 정리. 블록 구조(제목, 목록, 코드 블록)는 남기고 찌꺼기 기호만 정리한다. */
export function cleanChatText(src) {
  let s = String(src ?? '').replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, '')
  s = s.replace(TOOL_TAGS, '').replace(LONE_TOOL_TAG, '')
  // 코드 블록 밖과 안을 나눠 처리한다
  const parts = s.split(/(^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$)/m)
  const out = parts.map((p, i) => {
    if (i % 2 === 1) {
      const inner = p.replace(/^\s*```[^\n]*\n/, '').replace(/\n\s*```\s*$/, '')
      return looksLikeToolJson(inner) ? '' : p
    }
    return cleanProse(p)
  })
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}

function cleanProse(p) {
  const lines = p.split('\n')
  const res = []
  for (let line of lines) {
    // 표: 구분선은 버리고 칸은 가운뎃점으로 이어 한 줄로
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^[\s|:\-]+$/.test(line)) continue
      line = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' · ')
    }
    // 가로줄
    if (/^\s*([-*_]\s*){3,}$/.test(line)) continue
    // 인용
    line = line.replace(/^\s*>+\s?/, '')
    // HTML 줄바꿈과 태그
    line = line.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/gi, '')
    res.push(line)
  }
  return res.join('\n')
}

/** 한 줄 안의 서식 표시를 조각으로 나눈다. t: 'text' | 'strong' | 'em' | 'code' */
export function inlineTokens(text) {
  let s = String(text ?? '')
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)\s]*\)/g, '$1')
  const out = []
  // 굵게/기울임/코드가 짝이 맞는 것만 서식으로 바꾼다
  const re = /`([^`\n]+)`|\*\*([^*\n][^\n]*?[^*\s]|[^*\s])\*\*|__([^_\n][^\n]*?[^_\s]|[^_\s])__|(?<![\w*])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?[^_\s]|[^_\s])_(?![\w_])|~~([^~\n]+)~~/g
  let last = 0
  let m
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'strong', v: m[2] })
    else if (m[3] !== undefined) out.push({ t: 'strong', v: m[3] })
    else if (m[4] !== undefined) out.push({ t: 'em', v: m[4] })
    else if (m[5] !== undefined) out.push({ t: 'em', v: m[5] })
    else out.push({ t: 'text', v: m[6] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  // 짝이 안 맞아 남은 기호(스트리밍 도중 포함)는 지운다
  return out.map((o) => (o.t === 'text' ? { t: 'text', v: o.v.replace(/\*\*+|__+|~~+|(?<=\s|^)\*(?=\S)|(?<=\S)\*(?=\s|$)|`+/g, '') } : o)).filter((o) => o.v !== '')
}

/** 문서·발표·보드에 실제로 들어갈 글 정리. 마크다운 표시는 모두 걷고 글만 남긴다. */
export function plainEditText(src) {
  let s = String(src ?? '').replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, '')
  s = s.replace(TOOL_TAGS, '').replace(LONE_TOOL_TAG, '')
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/gi, '')
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)\s]*\)/g, '$1')
  s = s
    .split('\n')
    .map((l) => l.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*>+\s?/, ''))
    .filter((l) => !/^\s*([-*_]\s*){3,}$/.test(l))
    .join('\n')
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/__([^_\n]+?)__/g, '$1').replace(/~~([^~\n]+?)~~/g, '$1')
  s = s.replace(/(?<![\w*])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?![\w*])/g, '$1')
  s = s.replace(/`([^`\n]+)`/g, '$1')
  return s.replace(/\*\*+|__+|~~+/g, '').replace(/[ \t]+$/gm, '').trim()
}

// 문서 안 글을 그대로 찾거나 구조를 가리키는 값은 건드리지 않는다
const KEEP_KEYS = new Set(['find', 'was', 'outline', 'id', 'ids', 'itemIds', 'from', 'to', 'element', 'layout', 'variant', 'theme', 'near', 'frame', 'image_url', 'url', 'mode', 'scope', 'op', 'type', 'color', 'size', 'provider', 'model', 'target', 'role'])

/** 도구에 넘기기 전에 모델이 보낸 인자 속 글에서 마크다운 표시를 걷는다 */
export function cleanToolArgs(value, key = '') {
  if (typeof value === 'string') return KEEP_KEYS.has(key) ? value : plainEditText(value)
  if (Array.isArray(value)) return value.map((v) => cleanToolArgs(v, key))
  if (value && typeof value === 'object') {
    const o = {}
    for (const [k, v] of Object.entries(value)) o[k] = cleanToolArgs(v, k)
    return o
  }
  return value
}

/** 모델에게 주는 말투 지시(모든 편집기 공통) */
export const STYLE_RULES =
  '답변은 평문 한국어로 쓴다. 굵게나 기울임 표시(**, *, __), 제목 표시(#), 인용(>), 표(|), 가로줄(---), 코드 표시(`)를 쓰지 않는다. ' +
  '목록이 필요하면 줄 앞에 "- " 또는 "1. "만 쓴다. 코드, JSON, 도구 이름, 내부 번호와 id는 답변에 적지 않는다. ' +
  '문서나 발표에 넣을 글도 표시 기호 없이 글자만 쓴다. 이모지는 쓰지 않는다. 사용자가 코드를 달라고 한 경우에만 코드를 쓴다.'
