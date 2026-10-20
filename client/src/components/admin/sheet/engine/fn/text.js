// 텍스트 함수. 근거: https://support.google.com/docs/table/25273 (Text 범주). 길이·위치는 UTF-16 코드 단위(구글과 같다고 알려짐, 미검증).
import { def, alias } from '../registry.js'
import { GErr, eValue, eNA, eNum } from '../errors.js'
import { isRng, isMat, N, S, B, I, parseNumberText, wildcardToRegex, numToStr, flatten } from '../coerce.js'
import { formatValue } from '../format.js'
import { flat } from './util.js'

const T = 'text'

/** RE2 문법 일부를 JS 정규식으로 옮긴다 */
export function toJsRegex(pat, extraFlags = '') {
  let flags = extraFlags
  let p = pat
  const m = /^\(\?([imsU]+)\)/.exec(p)
  if (m) { p = p.slice(m[0].length); for (const f of m[1]) if (f === 'i' || f === 'm' || f === 's') flags += f }
  p = p.replace(/\(\?P</g, '(?<').replace(/\\z/g, '$').replace(/\\A/g, '^').replace(/\[\[:alpha:\]\]/g, '[a-zA-Z]').replace(/\[\[:digit:\]\]/g, '[0-9]')
  flags = [...new Set(flags)].join('')
  try { return new RegExp(p, `${flags}u`) } catch { /* u 플래그가 안 되는 패턴은 아래에서 다시 시도 */ }
  try { return new RegExp(p, flags) } catch { throw eValue(`Invalid regular expression: '${pat}'.`) }
}

def('LEN', T, 1, 1, 'LEN(텍스트)', '글자 수(UTF-16 코드 단위). 날짜 칸은 표시 문자열 길이', (args, ctx) => {
  const n = args[0]
  const v = ctx.ev(n)
  if (v instanceof GErr) return v
  if (n.k === 'ref' && typeof v === 'number') { const h = ctx.hint(n); if (h === 'isodate') return 10 }
  if (isMat(v) || (ctx.arr && isRng(v))) return ctx.broadcast([ctx.mat(v)], ([x]) => { try { return S(x).length } catch (e) { if (e instanceof GErr) return e; throw e } })
  return S(ctx.sc(v)).length
}, { lazy: true })
def('LEFT', T, 1, 2, 'LEFT(텍스트, [개수])', '왼쪽에서 n글자(기본 1)', (a) => { const n = a[1] == null ? 1 : Math.trunc(N(a[1])); if (n < 0) throw eValue('Function LEFT parameter 2 value is negative. It should be positive or zero.'); return S(a[0]).slice(0, n) }, { ew: true })
def('RIGHT', T, 1, 2, 'RIGHT(텍스트, [개수])', '오른쪽에서 n글자(기본 1)', (a) => { const n = a[1] == null ? 1 : Math.trunc(N(a[1])); if (n < 0) throw eValue('Function RIGHT parameter 2 value is negative. It should be positive or zero.'); const s = S(a[0]); return n === 0 ? '' : s.slice(-n) }, { ew: true })
def('MID', T, 3, 3, 'MID(텍스트, 시작, 길이)', '가운데 부분 추출(시작은 1부터)', (a) => { const st = Math.trunc(N(a[1])), n = Math.trunc(N(a[2])); if (st < 1) throw eNum('Function MID parameter 2 value is invalid. It should be greater than or equal to 1.'); if (n < 0) throw eValue('Function MID parameter 3 value is negative.'); return S(a[0]).substr(st - 1, n) }, { ew: true })
def('FIND', T, 2, 3, 'FIND(찾을 글, 텍스트, [시작])', '대소문자 구분해 위치 찾기', (a) => {
  const needle = S(a[0]), hay = S(a[1]); const st = a[2] == null ? 1 : Math.trunc(N(a[2]))
  if (st < 1 || st > hay.length + 1) throw eValue('Function FIND parameter 3 value is out of range.')
  const i = hay.indexOf(needle, st - 1)
  if (i < 0) throw eValue(`Function FIND parameter 1 value '${needle}' was not found in the text.`)
  return i + 1
}, { ew: true })
def('SEARCH', T, 2, 3, 'SEARCH(찾을 글, 텍스트, [시작])', '대소문자 무시, 와일드카드(? *) 사용 위치 찾기', (a) => {
  const needle = S(a[0]), hay = S(a[1]); const st = a[2] == null ? 1 : Math.trunc(N(a[2]))
  if (st < 1 || st > hay.length + 1) throw eValue('Function SEARCH parameter 3 value is out of range.')
  const re = wildcardToRegex(needle, 'i')
  const src = re.source.slice(1, -1)
  const m = new RegExp(src, 'i').exec(hay.slice(st - 1))
  if (!m) throw eValue(`Did not find text '${needle}' in SEARCH evaluation.`)
  return m.index + st
}, { ew: true })
def('SUBSTITUTE', T, 3, 4, 'SUBSTITUTE(텍스트, 찾을 글, 바꿀 글, [몇 번째])', '글자 바꾸기(대소문자 구분)', (a) => {
  const s = S(a[0]), f = S(a[1]), r = S(a[2])
  if (f === '') return s
  if (a[3] == null) return s.split(f).join(r)
  const n = Math.trunc(N(a[3])); if (n < 1) throw eValue('Function SUBSTITUTE parameter 4 must be at least 1.')
  let idx = -1, from = 0
  for (let k = 0; k < n; k++) { idx = s.indexOf(f, from); if (idx < 0) return s; from = idx + f.length }
  return s.slice(0, idx) + r + s.slice(idx + f.length)
}, { ew: true })
def('REPLACE', T, 4, 4, 'REPLACE(텍스트, 위치, 길이, 새 글)', '지정 위치의 글자 교체', (a) => { const s = S(a[0]); const p = Math.trunc(N(a[1])), n = Math.trunc(N(a[2])); if (p < 1 || n < 0) throw eValue('REPLACE: invalid position or length.'); return s.slice(0, p - 1) + S(a[3]) + s.slice(p - 1 + n) }, { ew: true })
def('TRIM', T, 1, 1, 'TRIM(텍스트)', '앞뒤 공백 제거, 가운데 연속 공백은 하나로', (a) => S(a[0]).replace(/ +/g, ' ').replace(/^ | $/g, ''), { ew: true })
def('CLEAN', T, 1, 1, 'CLEAN(텍스트)', '인쇄되지 않는 문자 제거', (a) => S(a[0]).replace(/[\u0000-\u001f]/g, ''), { ew: true })
def('UPPER', T, 1, 1, 'UPPER(텍스트)', '대문자로', (a) => S(a[0]).toUpperCase(), { ew: true })
def('LOWER', T, 1, 1, 'LOWER(텍스트)', '소문자로', (a) => S(a[0]).toLowerCase(), { ew: true })
def('PROPER', T, 1, 1, 'PROPER(텍스트)', '단어 첫 글자만 대문자로', (a) => S(a[0]).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()), { ew: true })
def('REPT', T, 2, 2, 'REPT(텍스트, 횟수)', '텍스트 반복', (a) => { const n = Math.trunc(N(a[1])); if (n < 0) throw eValue('REPT: negative count.'); if (S(a[0]).length * n > 1e6) throw eValue('REPT: result too long.'); return S(a[0]).repeat(n) }, { ew: true })
def('CHAR', T, 1, 1, 'CHAR(숫자)', '유니코드 번호의 문자', (a) => { const n = Math.trunc(N(a[0])); if (n < 1 || n > 1114111) throw eNum('CHAR: out of range.'); return String.fromCodePoint(n) }, { ew: true })
def('UNICHAR', T, 1, 1, 'UNICHAR(숫자)', '유니코드 번호의 문자', (a) => { const n = Math.trunc(N(a[0])); if (n < 1 || n > 1114111) throw eValue('UNICHAR: out of range.'); return String.fromCodePoint(n) }, { ew: true })
def('CODE', T, 1, 1, 'CODE(텍스트)', '첫 글자의 유니코드 번호', (a) => { const s = S(a[0]); if (!s) throw eValue('CODE: empty text.'); return s.codePointAt(0) }, { ew: true })
def('UNICODE', T, 1, 1, 'UNICODE(텍스트)', '첫 글자의 유니코드 번호', (a) => { const s = S(a[0]); if (!s) throw eValue('UNICODE: empty text.'); return s.codePointAt(0) }, { ew: true })
def('EXACT', T, 2, 2, 'EXACT(텍스트1, 텍스트2)', '대소문자까지 같으면 TRUE', (a) => S(a[0]) === S(a[1]), { ew: true })
def('CONCATENATE', T, 1, Infinity, 'CONCATENATE(텍스트1, [텍스트2, ...])', '텍스트 이어붙이기(범위는 모든 칸을 이어붙임, ARRAYFORMULA 안에서는 원소별)', (a, ctx) => {
  const arr = a.some((x) => isRng(x) || isMat(x))
  if (arr && ctx.arr) return ctx.broadcast(a.map((x) => (isRng(x) ? ctx.mat(x) : x)), (xs) => { try { return xs.map(S).join('') } catch (e) { if (e instanceof GErr) return e; throw e } })
  return a.flatMap((x) => (isRng(x) || isMat(x) ? flat(x, ctx) : [x])).map(S).join('')
})
def('CONCAT', T, 2, 2, 'CONCAT(값1, 값2)', '두 값 이어붙이기', (a) => S(a[0]) + S(a[1]), { ew: true })
def('TEXT', T, 2, 2, 'TEXT(값, 서식)', '서식 문자열에 맞춰 텍스트로 변환', (a, ctx) => {
  let v = a[0]
  if (typeof v === 'string') { const n = parseNumberText(v); if (n !== undefined) v = n }
  if (v == null) v = 0
  return formatValue(v, S(a[1]), ctx.locale === 'en' || ctx.locale === 'en-US' ? 'en' : 'ko')
}, { ew: true })
def('VALUE', T, 1, 1, 'VALUE(텍스트)', '숫자·날짜·퍼센트 텍스트를 숫자로', (a) => {
  if (typeof a[0] === 'number') return a[0]
  const s = S(a[0]); if (s.trim() === '') return 0
  const n = parseNumberText(s); if (n === undefined) throw eValue(`Function VALUE parameter 1 expects number values. But '${s}' is a text and cannot be coerced to a number.`); return n
}, { ew: true })
def('NUMBERVALUE', T, 1, 3, 'NUMBERVALUE(텍스트, [소수점 기호], [그룹 기호])', '지정한 기호로 텍스트를 숫자로', (a) => {
  const dec = a[1] == null ? '.' : S(a[1]), grp = a[2] == null ? ',' : S(a[2])
  let s = S(a[0]).replace(/\s/g, '')
  if (s === '') return 0
  let pct = 0
  while (s.endsWith('%')) { pct++; s = s.slice(0, -1) }
  s = s.split(grp).join('')
  if (dec !== '.') s = s.split(dec).join('.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) throw eValue('NUMBERVALUE: not a number.')
  return Number(s) / 100 ** pct
}, { ew: true })
def('TO_TEXT', T, 1, 1, 'TO_TEXT(값)', '값을 텍스트로', (a) => S(a[0]), { ew: true })
def('FIXED', T, 1, 3, 'FIXED(숫자, [소수 자릿수], [쉼표 생략?])', '고정 소수 자릿수 텍스트', (a) => { const d = a[1] == null ? 2 : Math.trunc(N(a[1])); const noC = a[2] != null && B(a[2]); return formatValue(N(a[0]), `${noC ? '' : '#,##'}0${d > 0 ? `.${'0'.repeat(d)}` : ''}`) }, { ew: true })
def('DOLLAR', T, 1, 2, 'DOLLAR(숫자, [소수 자릿수])', '$ 표시 통화 텍스트', (a) => { const d = a[1] == null ? 2 : Math.trunc(N(a[1])); return formatValue(N(a[0]), `$#,##0${d > 0 ? `.${'0'.repeat(d)}` : ''};-$#,##0${d > 0 ? `.${'0'.repeat(d)}` : ''}`) }, { ew: true })

def('TEXTJOIN', T, 3, Infinity, 'TEXTJOIN(구분자, 빈 칸 무시?, 텍스트1, ...)', '구분자로 여러 텍스트 잇기', (a, ctx) => {
  const delim = a[0]
  const ds = isRng(delim) || isMat(delim) ? flat(delim, ctx).map(S) : [S(delim)]
  const ign = B(ctx.sc(a[1]))
  const items = []
  for (const x of a.slice(2)) for (const v of (isRng(x) || isMat(x) ? flat(x, ctx) : [x])) { if (v instanceof GErr) throw v; if (ign && (v == null || v === '')) continue; items.push(S(v)) }
  return items.join(ds[0])
}, { refs: true, raw: true })
def('JOIN', T, 2, Infinity, 'JOIN(구분자, 값1, ...)', '구분자로 값/배열 잇기', (a, ctx) => {
  const d = S(ctx.sc(a[0]))
  const items = []
  for (const x of a.slice(1)) for (const v of (isRng(x) || isMat(x) ? flat(x, ctx) : [x])) { if (v instanceof GErr) throw v; items.push(S(v)) }
  return items.join(d)
}, { refs: true, raw: true })
def('SPLIT', T, 2, 4, 'SPLIT(텍스트, 구분자, [각 글자로 나눔?], [빈 값 제거?])', '구분자로 나눠 가로 배열로', (a, ctx) => {
  const each = a[2] == null ? true : B(a[2]), rm = a[3] == null ? true : B(a[3])
  const delim = S(a[1])
  if (delim === '') throw eValue('SPLIT: delimiter is empty.')
  if (!(isRng(a[0]) || isMat(a[0])) && S(a[0]) === '') throw eValue('SPLIT: text is empty.')
  const one = (t) => {
    const s = S(t)
    let parts
    if (each) { const set = new Set(delim.split('')); parts = []; let cur = ''; for (const ch of s) { if (set.has(ch)) { parts.push(cur); cur = '' } else cur += ch } parts.push(cur) }
    else parts = s.split(delim)
    if (rm) parts = parts.filter((x) => x !== '')
    return parts.length ? parts : ['']
  }
  const m = isRng(a[0]) || isMat(a[0]) ? ctx.mat(a[0]) : null
  if (!m) return [one(a[0])]
  const rows = m.map((row) => one(row[0]))
  const w = Math.max(...rows.map((r) => r.length))
  return rows.map((r) => [...r, ...new Array(w - r.length).fill('')])
}, { arr: true })
def('ARRAYTOTEXT', T, 1, 2, 'ARRAYTOTEXT(배열, [형식])', '배열을 텍스트로(0 간단, 1 엄격)', (a, ctx) => {
  const strict = a[1] != null && N(a[1]) === 1
  const m = ctx.mat(a[0])
  const cell = (v) => (strict && typeof v === 'string' ? `"${v}"` : v instanceof GErr ? v.code : S(v))
  if (!strict) return flatten(m).map(cell).join(', ')
  return `{${m.map((r) => r.map(cell).join(',')).join(';')}}`
}, { refs: true, raw: true })

// ── 정규식 ──────────────────────────────────────────────
def('REGEXMATCH', T, 2, 2, 'REGEXMATCH(텍스트, 정규식)', '정규식에 부분 일치하면 TRUE', (a) => toJsRegex(S(a[1])).test(S(a[0])), { ew: true })
def('REGEXEXTRACT', T, 2, 3, 'REGEXEXTRACT(텍스트, 정규식)', '정규식에 처음 일치한 부분(캡처 그룹이 있으면 그룹)', (a) => {
  const re = toJsRegex(S(a[1])); const m = re.exec(S(a[0]))
  if (!m) throw eNA(`Did not find match for REGEXEXTRACT parameter 2 '${S(a[1])}'.`)
  if (m.length === 1) return m[0]
  if (m.length === 2) return m[1] ?? ''
  return [m.slice(1).map((x) => x ?? '')]
}, { ew: true, arr: true })
def('REGEXREPLACE', T, 3, 3, 'REGEXREPLACE(텍스트, 정규식, 바꿀 글)', '정규식에 일치하는 모든 부분 바꾸기', (a) => {
  const re = toJsRegex(S(a[1]), 'g')
  // 바꿀 글: $1 은 그룹, 백슬래시는 다음 글자를 그대로(구글 관찰: \\2 는 숫자 2 글자)
  const rep = S(a[2]).replace(/\\(.)/gs, (m, ch) => (ch === '$' ? '$$$$' : ch))
  return S(a[0]).replace(re, rep)
}, { ew: true })

// 바이트 단위 함수: 한글 등 ASCII가 아닌 글자는 2바이트로 센다(관찰: LENB("한글a") = 5)
const bw = (ch) => (ch.codePointAt(0) < 0x80 ? 1 : 2)
const byteSlice = (s, start, len) => { let pos = 0, out = ''; for (const ch of s) { const w = bw(ch); if (pos >= start && pos + w <= start + len) out += ch; pos += w; if (pos >= start + len) break } return out }
def('LENB', T, 1, 1, 'LENB(텍스트)', '바이트 수(한글 2바이트)', (a) => [...S(a[0])].reduce((n, ch) => n + bw(ch), 0), { ew: true })
def('LEFTB', T, 1, 2, 'LEFTB(텍스트, [바이트 수])', '왼쪽에서 n바이트', (a) => byteSlice(S(a[0]), 0, a[1] == null ? 1 : Math.trunc(N(a[1]))), { ew: true })
def('RIGHTB', T, 1, 2, 'RIGHTB(텍스트, [바이트 수])', '오른쪽에서 n바이트', (a) => { const s = S(a[0]); const tot = [...s].reduce((n, ch) => n + bw(ch), 0); const n = a[1] == null ? 1 : Math.trunc(N(a[1])); return byteSlice(s, Math.max(0, tot - n), n) }, { ew: true })
def('MIDB', T, 3, 3, 'MIDB(텍스트, 시작, 바이트 수)', '가운데 n바이트', (a) => byteSlice(S(a[0]), Math.trunc(N(a[1])) - 1, Math.trunc(N(a[2]))), { ew: true })
