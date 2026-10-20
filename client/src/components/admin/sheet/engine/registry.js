// 함수 등록부. 각 함수는 def()로 등록한다.
// opts: ew(인수가 모두 스칼라인 원소별 함수: 배열 모드에서 자동 확장), lazy(인수를 노드로 받아 직접 계산),
//       raw(오류 인수도 그대로 받음), arr(결과가 배열일 수 있음), arrArgs(인수를 배열 모드로 계산), vol(휘발성), since, src(근거 URL)
export const FUNCS = new Map()
export const CATEGORIES = {
  math: '수학', stat: '통계', logical: '논리', info: '정보', text: '텍스트', date: '날짜/시간', lookup: '찾기/참조', array: '배열', query: '쿼리', fin: '재무', eng: '엔지니어링', op: '연산자',
}
export function def(name, cat, min, max, sig, ko, fn, opts = {}) {
  const spec = { name, cat, min, max, sig, ko, fn, ...opts }
  FUNCS.set(name, spec)
  return spec
}
export function alias(newName, oldName) {
  const s = FUNCS.get(oldName)
  FUNCS.set(newName, { ...s, name: newName, sig: s.sig.replace(oldName, newName), aliasOf: oldName })
}
export const hasFunction = (name) => FUNCS.has(String(name).toUpperCase())

export function listFunctions() {
  return [...FUNCS.values()].map((f) => ({
    name: f.name, category: f.cat, minArgs: f.min, maxArgs: f.max === Infinity ? null : f.max, signature: f.sig, summary_ko: f.ko,
    ...(f.since ? { since: f.since } : {}), ...(f.vol ? { volatile: true } : {}), ...(f.aliasOf ? { aliasOf: f.aliasOf } : {}),
  })).sort((a, b) => a.name.localeCompare(b.name))
}

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return dp[a.length][b.length]
}
/** 모르는 함수 이름에 가장 가까운 지원 함수 이름(AI 오류 복구용). 없으면 null. */
export function suggestFunction(name) {
  const u = String(name).toUpperCase()
  if (FUNCS.has(u)) return u
  const COMMON = { XLOOKUP: 'XLOOKUP', ARRAYFORMULA: 'ARRAYFORMULA', COUNTIFS: 'COUNTIFS', SUMIFS: 'SUMIFS', CONCATENATE: 'CONCATENATE', TEXTJOIN: 'TEXTJOIN', AVG: 'AVERAGE', AVERAGES: 'AVERAGE', COUNTUNIQUEIFS: 'COUNTUNIQUE', STDDEV: 'STDEV', SUBSTRING: 'MID', SUBSTR: 'MID', INDEXOF: 'MATCH', LEN2: 'LEN', LENGTH: 'LEN', TODAYDATE: 'TODAY', CONTAINS: 'REGEXMATCH', IIF: 'IF', ROUNDTO: 'ROUND', SUMPRODUCTS: 'SUMPRODUCT', DISTINCT: 'UNIQUE', COUNTDISTINCT: 'COUNTUNIQUE', NVL: 'IFERROR', ISNULL: 'ISBLANK', TRUNCATE: 'TRUNC', STRING: 'TO_TEXT', MEDIANIF: 'MEDIAN', LISTAGG: 'TEXTJOIN', STRINGAGG: 'TEXTJOIN', GROUPBY: 'QUERY', COUNTIFS_: 'COUNTIFS' }
  if (COMMON[u] && FUNCS.has(COMMON[u])) return COMMON[u]
  let best = null
  let bd = Infinity
  for (const k of FUNCS.keys()) {
    const d = lev(u, k)
    if (d < bd || (d === bd && best && k.length < best.length)) { bd = d; best = k }
  }
  const lim = Math.max(2, Math.floor(u.length / 3))
  return bd <= lim ? best : null
}
