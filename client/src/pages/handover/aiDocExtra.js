// 문서 AI 확장 도구: 개요, 찾기, 댓글, 서식, 쪽 설정, 한글 모드, 문서 검사, 표.
// aiDocTools.js 의 createDocTools 가 lib(공용 함수)와 h(편집 도우미)를 넘겨 불러 쓴다.
// 읽기 도구는 모두 글자 수 예산이 있다. 설명에 적어 모델이 나눠 읽게 한다.
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection, TableMap, addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, mergeCells, splitCell, toggleHeaderRow } from '@tiptap/pm/tables'

export const OUTLINE_BUDGET = 8000
export const FIND_BUDGET = 6000
const MAX_FIND = 100
const MAX_ISSUES = 60
const LONG_PARA = 600

const clampInt = (v, lo, hi, d) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const HEX = /^#[0-9a-fA-F]{6}$/
const COLOR_NAMES = { 검정: '#000000', 검은색: '#000000', 빨강: '#FF1744', 빨간색: '#FF1744', 초록: '#00B050', 초록색: '#00B050', 파랑: '#1A73E8', 파란색: '#1A73E8', 보라: '#7A3CFF', 보라색: '#7A3CFF', 노랑: '#FFEA00', 노란색: '#FFEA00', 회색: '#666666', 흰색: '#FFFFFF', black: '#000000', red: '#FF1744', green: '#00B050', blue: '#1A73E8', purple: '#7A3CFF', yellow: '#FFEA00', gray: '#666666', grey: '#666666', white: '#FFFFFF' }
export function normColor(v) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (HEX.test(t)) return t.toUpperCase()
  return COLOR_NAMES[t] || COLOR_NAMES[t.toLowerCase()] || null
}

// ───────────────────────── 문서 검사(순수) ─────────────────────────

const NUM_STYLES = [
  ['arabic-dot', /^\s*\d+\.\s/],
  ['arabic-paren', /^\s*\d+\)\s/],
  ['paren-arabic', /^\s*\(\d+\)\s/],
  ['gana-dot', /^\s*[가-하]\.\s/],
  ['roman', /^\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.\s]/],
  ['jang', /^\s*제\s*\d+\s*[장절조]/],
  ['circled', /^\s*[①-⑩]/],
  ['dotted-multi', /^\s*\d+\.\d+/],
]
const NUM_LABEL = { 'arabic-dot': '1.', 'arabic-paren': '1)', 'paren-arabic': '(1)', 'gana-dot': '가.', roman: 'Ⅰ', jang: '제1장', circled: '①', 'dotted-multi': '1.1' }
export const numStyleOf = (text) => NUM_STYLES.find(([, re]) => re.test(text))?.[0] || null

/**
 * facts: { paras:[{n,type:'heading'|'paragraph',level,text,list:bool,cell:bool,fonts:[string]}], tables:[{t,rows,cols,headerRow,firstPara}], images:[{alt,n}] }
 * 반환: { issues:[{id,rule,n,severity,message,fix}], counts }
 */
export function lintFacts(facts) {
  const issues = []
  const add = (rule, n, severity, message, fix) => issues.push({ id: `${rule}:${n ?? 0}:${issues.length}`, rule, n: n ?? null, severity, message, fix })
  const paras = facts.paras || []
  let prevLevel = 0
  const headingStyles = new Map()
  for (const p of paras) {
    const text = p.text || ''
    if (p.type === 'heading') {
      if (!text.trim()) add('empty_heading', p.n, 'high', `${p.n}번 제목이 비어 있음`, 'edit_paragraphs delete 로 지우거나 제목 글을 채운다')
      if (prevLevel && p.level > prevLevel + 1) add('heading_skip', p.n, 'mid', `${p.n}번 제목이 ${prevLevel}단계 다음에 ${p.level}단계로 건너뜀`, `apply_format 으로 heading_level ${prevLevel + 1} 로 낮춘다`)
      if (text.trim()) prevLevel = p.level
      const st = numStyleOf(text)
      if (st) headingStyles.set(st, [...(headingStyles.get(st) || []), p.n])
    }
    if (p.list && !text.trim() && !p.hasAtom) add('empty_list_item', p.n, 'mid', `${p.n}번 목록 항목이 비어 있음`, 'edit_paragraphs delete 로 지운다')
    if (/\S {2,}\S/.test(text.replace(/^\s+/, ''))) add('double_space', p.n, 'low', `${p.n}번 문단에 연속 공백`, 'replace_text 로 공백 둘을 하나로 바꾼다')
    const rep = text.match(/([!?,;:。])\1+|\.{4,}|\.\.(?!\.)/)
    if (rep) add('repeat_punct', p.n, 'low', `${p.n}번 문단에 문장부호 반복 "${rep[0]}"`, '하나로 줄이거나 말줄임표 "..."(점 셋)로 맞춘다')
    if (!p.list && !p.cell && p.type !== 'heading' && text.length > LONG_PARA) add('long_paragraph', p.n, 'low', `${p.n}번 문단이 ${text.length}자로 김`, '두세 문단으로 나누거나 목록으로 바꾼다')
    if (p.type === 'paragraph' && !p.list && !p.cell && text.length < 60) {
      const st = numStyleOf(text)
      if (st) headingStyles.set(`p:${st}`, [...(headingStyles.get(`p:${st}`) || []), p.n])
    }
  }
  const hs = [...headingStyles.keys()].filter((k) => !String(k).startsWith('p:'))
  if (hs.length > 1) {
    const first = hs.map((k) => `${NUM_LABEL[k]}(${headingStyles.get(k).slice(0, 3).join(',')}번)`).join(', ')
    add('mixed_numbering', headingStyles.get(hs[1])[0], 'mid', `제목 번호 방식이 섞임: ${first}`, '한 방식으로 통일한다(edit_paragraphs replace 로 번호 부분만 고침)')
  }
  const ps = [...headingStyles.keys()].filter((k) => String(k).startsWith('p:'))
  if (ps.length > 1) {
    const first = ps.map((k) => `${NUM_LABEL[k.slice(2)]}(${headingStyles.get(k).slice(0, 3).join(',')}번)`).join(', ')
    add('mixed_numbering', headingStyles.get(ps[1])[0], 'low', `본문 항목 번호 방식이 섞임: ${first}`, '한 방식으로 통일한다')
  }
  for (const t of facts.tables || []) {
    if (!t.headerRow) add('table_no_header', t.firstPara ?? null, 'mid', `표 t${t.t}에 머리글 행이 없음`, `table_ops {op:'toggle_header', table:${t.t}}`)
  }
  for (const im of facts.images || []) {
    if (!String(im.alt || '').trim()) add('image_no_alt', im.n ?? null, 'mid', `이미지에 대체 글이 없음${im.n ? `(${im.n}번 문단 근처)` : ''}`, '이미지 설정에서 대체 글을 적게 안내한다(AI 도구로는 못 고침)')
  }
  const fonts = new Map()
  for (const p of paras) for (const f of p.fonts || []) fonts.set(f, (fonts.get(f) || 0) + (p.text || '').length)
  if (fonts.size > 2) {
    const list = [...fonts.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}(${n}자)`)
    add('mixed_fonts', null, 'low', `글꼴이 ${fonts.size}가지 섞임: ${list.slice(0, 5).join(', ')}`, '본문은 한두 가지 글꼴로 통일한다')
  }
  const counts = {}
  for (const i of issues) counts[i.rule] = (counts[i.rule] || 0) + 1
  return { issues, counts }
}

/** 편집기 문서에서 lintFacts 입력을 뽑는다 */
export function factsFromDoc(doc, snap, lib) {
  const paras = snap.paras.map((p) => {
    const model = lib.paraModel(p.node, p.pos)
    const fonts = new Set()
    for (const c of model.chars) for (const m of c.marks || []) if (m.type.name === 'textStyle' && m.attrs.fontFamily) fonts.add(String(m.attrs.fontFamily).split(',')[0].replace(/['"]/g, '').trim())
    return { n: p.n, type: p.type === 'heading' ? 'heading' : 'paragraph', level: p.level, text: lib.toDisplay(model), list: !!p.list, cell: !!p.cell, hasAtom: model.chars.some((c) => c.atom), fonts: [...fonts] }
  })
  const tables = []
  const images = []
  let tn = 0
  const starts = snap.paras.map((p) => p.pos)
  const paraAfter = (pos) => {
    const i = starts.findIndex((s) => s >= pos)
    return i < 0 ? null : snap.paras[i].n
  }
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      tn += 1
      const first = node.firstChild
      tables.push({ t: tn, rows: node.childCount, cols: first ? first.childCount : 0, headerRow: !!first && first.childCount > 0 && first.child(0).type.name === 'tableHeader', firstPara: paraAfter(pos) })
    } else if (node.type.name === 'image') images.push({ alt: node.attrs.alt || '', n: paraAfter(pos) })
    return true
  })
  return { paras, tables, images }
}

// ───────────────────────── 개요·찾기(순수) ─────────────────────────

export function outlineOf(paras, { from = 1, to = Infinity, budget = OUTLINE_BUDGET } = {}) {
  const heads = []
  let total = 0
  let cur = null
  for (const p of paras) {
    const words = (p.text.match(/\S+/g) || []).length
    total += words
    if (p.type === 'heading') {
      cur = { n: p.n, level: p.level, text: clip(p.text.trim(), 60), words: 0, paragraphs: 0, preview: '' }
      heads.push(cur)
    } else if (cur) {
      cur.words += words
      cur.paragraphs += 1
      if (!cur.preview && p.text.trim()) cur.preview = clip(p.text.trim(), 50)
    }
  }
  const lead = paras.find((p) => p.type !== 'heading' && p.text.trim())
  const picked = heads.filter((h) => h.n >= from && h.n <= to)
  const out = []
  let used = 0
  let nextFrom = null
  for (const h of picked) {
    const s = JSON.stringify(h).length
    if (used + s > budget) { nextFrom = h.n; break }
    out.push(h)
    used += s
  }
  return { total_paragraphs: paras.length, total_words: total, headings: out, headings_total: heads.length, truncated: nextFrom !== null, next_from: nextFrom, intro_preview: heads.length && heads[0].n > 1 && lead ? clip(lead.text.trim(), 50) : undefined }
}

export function findIn(paras, { query, regex = false, max = 20, context = 24, from = 1, to = Infinity, matchCase = false }) {
  let re
  if (regex) {
    if (query.length > 200) throw new Error('정규식이 너무 깁니다(200자까지)')
    try { re = new RegExp(query, matchCase ? 'g' : 'gi') } catch { throw new Error('정규식이 올바르지 않습니다. 일반 글자 검색이면 regex 를 빼세요') }
  } else {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(esc, matchCase ? 'g' : 'gi')
  }
  const out = []
  let used = 0
  let more = false
  let count = 0
  for (const p of paras) {
    if (p.n < from || p.n > to) continue
    const text = p.text.length > 20000 ? p.text.slice(0, 20000) : p.text
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex += 1; continue }
      count += 1
      const item = { n: p.n, at: m.index, match: clip(m[0], 40), context: `${m.index > context ? '…' : ''}${text.slice(Math.max(0, m.index - context), m.index + m[0].length + context)}${m.index + m[0].length + context < text.length ? '…' : ''}` }
      const s = JSON.stringify(item).length
      if (out.length >= max || used + s > FIND_BUDGET) { more = true; break }
      out.push(item)
      used += s
    }
    if (more) break
  }
  return { matches: out, shown: out.length, more, note: more ? 'max 를 늘리거나 from/to 로 범위를 좁혀 이어서 찾는다' : undefined, total_in_scanned: more ? undefined : count }
}

// ───────────────────────── 도구 ─────────────────────────

export function createExtraDocTools(h) {
  const { env, lib, snapshot, guard, refuse, paraMap } = h
  const ed = () => env.getEditor?.()
  const needWrite = () => guard()

  const paraTexts = (snap) => snap.paras.map((p) => ({ n: p.n, type: p.type === 'heading' ? 'heading' : 'paragraph', level: p.level, text: lib.toDisplay(lib.paraModel(p.node, p.pos)) }))

  const get_outline = {
    name: 'get_outline',
    description: '문서의 제목 구조를 한눈에 본다: 제목마다 문단 번호(n), 단계(level), 글(60자), 그 제목 아래 단어 수와 문단 수(목록 항목과 표 칸 안 문단 포함), 첫 문장 앞부분. 표(t번호, 행x열, 머리글 행 여부, 첫 문단 번호)와 이미지 수도 준다. 긴 문서를 고치기 전에 먼저 부르고, 읽을 곳만 read_document 로 범위(from,to)를 정해 읽는다. 제목이 많으면 8000자 예산에서 끊고 truncated 와 next_from 을 준다(from 에 넣어 이어서). 제목이 하나도 없으면 headings 가 비니 read_document 로 읽는다.',
    parameters: { type: 'object', properties: { from: { type: 'integer', description: '이 문단 번호 이후의 제목만(기본 1)' }, to: { type: 'integer', description: '이 문단 번호까지(기본 끝)' } } },
    run: async (args = {}) => {
      const s = snapshot()
      if (!s) return refuse('편집기가 아직 준비되지 않았습니다')
      const r = outlineOf(paraTexts(s), { from: clampInt(args.from, 1, 1e9, 1), to: clampInt(args.to, 1, 1e9, Infinity) })
      const facts = factsFromDoc(s.state.doc, s, lib)
      r.tables = facts.tables.slice(0, 20).map((t) => ({ t: t.t, rows: t.rows, cols: t.cols, header_row: t.headerRow, first_paragraph: t.firstPara }))
      r.images = facts.images.length
      return { result: r, summary: `제목 ${r.headings_total}개, 문단 ${r.total_paragraphs}개, ${r.total_words}단어` }
    },
  }

  const find_in_document = {
    name: 'find_in_document',
    description: '문서에서 글을 찾아 일치한 곳마다 문단 번호(n), 문단 안 위치(at), 앞뒤 글을 준다(고치지 않음). 긴 문서에서 어디를 고칠지 찾을 때 read_document 대신 쓴다. regex=true 면 정규식(200자까지). max 기본 20, 최대 100이고 6000자 예산을 넘으면 more=true 로 끊는다. 바꾸려면 찾은 뒤 replace_text 나 edit_paragraphs 를 쓴다.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '찾을 글 또는 정규식' },
        regex: { type: 'boolean', description: 'true 면 정규식(기본 false)' },
        max: { type: 'integer', description: '최대 결과 수(기본 20, 최대 100)' },
        matchCase: { type: 'boolean' },
        from: { type: 'integer', description: '시작 문단 번호' },
        to: { type: 'integer', description: '끝 문단 번호' },
      },
      required: ['query'],
    },
    run: async (args = {}) => {
      const s = snapshot()
      if (!s) return refuse('편집기가 아직 준비되지 않았습니다')
      const q = lib.cleanStr(args.query, 500)
      if (!q) return refuse('query 가 필요합니다')
      try {
        const r = findIn(paraTexts(s), { query: q, regex: args.regex === true, max: clampInt(args.max, 1, MAX_FIND, 20), matchCase: args.matchCase === true, from: clampInt(args.from, 1, 1e9, 1), to: clampInt(args.to, 1, 1e9, Infinity) })
        return { result: r, summary: `'${clip(q, 16)}' ${r.shown}곳${r.more ? '(더 있음)' : ''}` }
      } catch (e) {
        return refuse(e.message)
      }
    },
  }

  const commentView = (c) => ({ id: c.id, anchor: c.anchor_id, author: c.author, resolved: !!c.resolved, quote: clip(String(c.quote || ''), 60), body: clip(String(c.body || ''), 300) })

  const read_comments = {
    name: 'read_comments',
    description: '문서 댓글을 읽는다: id, 앵커(같은 앵커의 댓글은 한 스레드), 작성자, 해결 여부, 인용한 글(60자), 내용(300자). 해결된 것은 resolved=true. 최대 60개. reply_comment, resolve_comment 에 쓸 id 를 여기서 얻는다. 문단 번호는 주지 않으니 위치는 quote 로 find_in_document 해서 찾는다.',
    parameters: { type: 'object', properties: { include_resolved: { type: 'boolean', description: '해결된 댓글도 포함(기본 true)' } } },
    run: async (args = {}) => {
      const all = env.getComments?.() || []
      const list = all.filter((c) => args.include_resolved !== false || !c.resolved)
      return { result: { total: list.length, comments: list.slice(0, 60).map(commentView), truncated: list.length > 60 }, summary: `댓글 ${list.length}개` }
    },
  }

  const add_comment = {
    name: 'add_comment',
    description: '검토자로서 문단 n 의 글에 댓글을 단다. quote 를 주면 그 문단 안에서 그 글(그대로 복사한 부분, 80자 안쪽)에 달리고, 생략하면 문단 처음 40자에 단다. 이미 댓글이 달린 글과 겹쳐도 된다. 댓글 내용은 지적과 제안을 한두 문장으로 쓰고, 본문은 바꾸지 않는다. 한 번에 한 개. 앞에 [AI] 표시가 붙는다. quote 가 문단에 없으면 오류이니 read_document 로 정확한 글을 다시 확인한다.',
    parameters: {
      type: 'object',
      properties: {
        n: { type: 'integer', description: '문단 번호' },
        quote: { type: 'string', description: '댓글을 달 글(그 문단에 있는 그대로)' },
        text: { type: 'string', description: '댓글 내용' },
      },
      required: ['n', 'text'],
    },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      const body = lib.cleanStr(args.text, 1500)?.trim()
      if (!body) return refuse('text 가 필요합니다')
      const snap = snapshot()
      const p = paraMap(snap).get(clampInt(args.n, 0, 1e9, -1))
      if (!p) return refuse(`${args.n}번 문단 없음(전체 ${snap.paras.length}개)`)
      const model = lib.paraModel(p.node, p.pos)
      if (!model.chars.length) return refuse(`${p.n}번 문단이 비어 있어 댓글을 달 수 없습니다`)
      const q = lib.cleanStr(args.quote ?? '', 200)?.trim()
      let a = 0
      let b = Math.min(model.chars.length, 40)
      if (q) {
        const i = model.s.indexOf(lib.stripPua(q))
        if (i < 0) return refuse(`${p.n}번 문단에 quote 글이 없습니다. read_document 로 정확한 글을 확인하세요`)
        a = i
        b = i + lib.stripPua(q).length
      }
      const from = model.chars[a].pos
      const to = model.chars[b - 1].end
      if (!env.addComment) return refuse('이 화면에서는 댓글을 달 수 없습니다')
      const r = await env.addComment({ from, to, quote: lib.toDisplay(model, a, b), body: `[AI] ${body}` })
      if (!r?.ok) return refuse(r?.error || '댓글을 달지 못했습니다')
      return { result: { ok: true, comment_id: r.id, paragraph: p.n }, summary: `${p.n}번 문단에 댓글을 달았습니다`, undo: () => env.deleteComment?.(r.id) }
    },
  }

  const reply_comment = {
    name: 'reply_comment',
    description: '기존 댓글 스레드에 답글을 단다. comment_id 는 read_comments 의 id. 해결된 스레드에도 달 수 있다. 앞에 [AI] 표시가 붙는다.',
    parameters: { type: 'object', properties: { comment_id: { type: 'integer' }, text: { type: 'string' } }, required: ['comment_id', 'text'] },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      const body = lib.cleanStr(args.text, 1500)?.trim()
      const c = (env.getComments?.() || []).find((x) => x.id === clampInt(args.comment_id, 0, 1e12, -1))
      if (!c) return refuse('comment_id 가 맞는 댓글이 없습니다. read_comments 로 id 를 다시 확인하세요')
      if (!body) return refuse('text 가 필요합니다')
      const r = await env.replyComment({ anchor_id: c.anchor_id, quote: c.quote, body: `[AI] ${body}` })
      if (!r?.ok) return refuse(r?.error || '답글을 달지 못했습니다')
      return { result: { ok: true, comment_id: r.id }, summary: '답글을 달았습니다', undo: () => env.deleteComment?.(r.id, { keepMark: true }) }
    },
  }

  const resolve_comment = {
    name: 'resolve_comment',
    description: '댓글을 해결됨으로 표시한다(resolved=false 면 다시 연다). 사용자가 해결하라고 했거나 댓글이 지적한 내용을 고친 뒤에만 쓴다. 댓글 지우기는 지원하지 않는다.',
    parameters: { type: 'object', properties: { comment_id: { type: 'integer' }, resolved: { type: 'boolean', description: '기본 true' } }, required: ['comment_id'] },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      const c = (env.getComments?.() || []).find((x) => x.id === clampInt(args.comment_id, 0, 1e12, -1))
      if (!c) return refuse('comment_id 가 맞는 댓글이 없습니다. read_comments 로 id 를 다시 확인하세요')
      const want = args.resolved !== false
      if (!!c.resolved === want) return { result: { ok: true, changed: false }, summary: want ? '이미 해결됨' : '이미 열려 있음' }
      await env.updateComment(c, { resolved: want })
      return { result: { ok: true, resolved: want }, summary: want ? '댓글을 해결 처리' : '댓글을 다시 엶', undo: () => env.updateComment(c, { resolved: !want }) }
    },
  }

  // ── 서식
  const apply_format = {
    name: 'apply_format',
    description: '문단 n 의 글 서식을 바꾼다(되돌리기 가능). 글자 범위는 quote(문단 안 그대로 복사한 글, 첫 일치) 또는 from/to(문단 글자 위치 0부터, to 는 제외)로 주고 둘 다 없으면 문단 전체. 글자 서식: bold, italic, underline(true 켜기, false 끄기), color(#RRGGBB 또는 검정/빨강/파랑/초록/보라), highlight(같은 형식 또는 null 이면 끔), size(8~72 pt). 문단 서식: heading_level(0=일반 문단, 1~4=제목), align(left, center, right, justify). 글 내용은 바꾸지 않는다. 표 칸은 set_cell_style 이 더 낫다.',
    parameters: {
      type: 'object',
      properties: {
        n: { type: 'integer', description: '문단 번호' },
        quote: { type: 'string' },
        from: { type: 'integer' },
        to: { type: 'integer' },
        bold: { type: 'boolean' }, italic: { type: 'boolean' }, underline: { type: 'boolean' },
        color: { type: 'string' }, highlight: { type: ['string', 'null'] },
        size: { type: 'number', description: 'pt, 8~72' },
        heading_level: { type: 'integer', description: '0~4' },
        align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
      },
      required: ['n'],
    },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      const snap = snapshot()
      const p = paraMap(snap).get(clampInt(args.n, 0, 1e9, -1))
      if (!p) return refuse(`${args.n}번 문단 없음(전체 ${snap.paras.length}개)`)
      const { schema } = snap.state
      const model = lib.paraModel(p.node, p.pos)
      let a = 0
      let b = model.chars.length
      if (typeof args.quote === 'string' && args.quote.trim()) {
        const q = lib.stripPua(lib.cleanStr(args.quote, 400))
        const i = model.s.indexOf(q)
        if (i < 0) return refuse(`${p.n}번 문단에 quote 글이 없습니다`)
        a = i; b = i + q.length
      } else if (args.from !== undefined || args.to !== undefined) {
        a = clampInt(args.from, 0, model.chars.length, 0)
        b = clampInt(args.to, 0, model.chars.length, model.chars.length)
        if (b <= a) return refuse('to 는 from 보다 커야 합니다')
      }
      const tr = snap.state.tr
      const done = []
      const charFrom = model.chars[a]?.pos
      const charTo = model.chars[b - 1]?.end
      const markRange = a < b && charFrom !== undefined
      const flag = (name, val) => {
        const mt = schema.marks[name]
        if (!mt || typeof val !== 'boolean' || !markRange) return
        if (val) tr.addMark(charFrom, charTo, mt.create())
        else tr.removeMark(charFrom, charTo, mt)
        done.push(`${name}${val ? '' : ' 끔'}`)
      }
      flag('bold', args.bold); flag('italic', args.italic); flag('underline', args.underline)
      if (args.color !== undefined && markRange) {
        const c = normColor(args.color)
        if (!c) return refuse('color 는 #RRGGBB 또는 색 이름(검정, 빨강, 파랑, 초록, 보라)이어야 합니다')
        if (schema.marks.textStyle) { tr.addMark(charFrom, charTo, schema.marks.textStyle.create({ ...(model.chars[a].marks.find((m) => m.type.name === 'textStyle')?.attrs || {}), color: c })); done.push('글자색') }
      }
      if (args.size !== undefined && markRange) {
        const sz = Number(args.size)
        if (!Number.isFinite(sz) || sz < 8 || sz > 72) return refuse('size 는 8~72 사이 pt 여야 합니다')
        if (schema.marks.textStyle) { tr.addMark(charFrom, charTo, schema.marks.textStyle.create({ ...(model.chars[a].marks.find((m) => m.type.name === 'textStyle')?.attrs || {}), fontSize: `${sz}pt` })); done.push('크기') }
      }
      if (args.highlight !== undefined && markRange && schema.marks.highlight) {
        if (args.highlight === null || args.highlight === false) { tr.removeMark(charFrom, charTo, schema.marks.highlight); done.push('형광펜 끔') }
        else {
          const c = normColor(args.highlight)
          if (!c) return refuse('highlight 는 #RRGGBB 또는 색 이름이어야 합니다')
          tr.addMark(charFrom, charTo, schema.marks.highlight.create({ color: c })); done.push('형광펜')
        }
      }
      if (args.heading_level !== undefined) {
        const lv = clampInt(args.heading_level, 0, 4, -1)
        if (lv < 0) return refuse('heading_level 은 0~4 여야 합니다')
        if (p.list || p.cell) return refuse('목록이나 표 칸 안의 문단은 제목으로 바꿀 수 없습니다')
        if (lv === 0 && p.type === 'heading') { tr.setNodeMarkup(p.pos, schema.nodes.paragraph, p.node.attrs); done.push('일반 문단') }
        else if (lv > 0 && schema.nodes.heading) { tr.setNodeMarkup(p.pos, schema.nodes.heading, { ...p.node.attrs, level: lv }); done.push(`제목${lv}`) }
      }
      if (args.align !== undefined) {
        if (!['left', 'center', 'right', 'justify'].includes(args.align)) return refuse('align 은 left, center, right, justify 중 하나입니다')
        tr.setNodeMarkup(p.pos, null, { ...p.node.attrs, textAlign: args.align }); done.push('정렬')
      }
      if (!done.length || !tr.docChanged) return { result: { ok: true, changed: false, hint: '바꿀 서식 인자가 없거나 이미 같습니다' }, summary: '바뀐 서식 없음' }
      return finish(snap.editor, tr, { ok: true, paragraph: p.n, applied: done }, `${p.n}번 문단 서식: ${done.join(', ')}`)
    },
  }

  // 변경을 반영하고 문서 전체 교체 방식의 되돌리기를 만든다
  function finish(editor, tr, result, summary) {
    const before = editor.state.doc
    tr.setMeta('ai-edit', true)
    editor.view.dispatch(tr)
    const after = editor.state.doc
    return {
      result,
      summary,
      undo: () => {
        const e = ed()
        if (!e || e.isDestroyed) return
        if (!e.state.doc.eq(after)) { env.notify?.('그 뒤에 문서가 바뀌어 자동으로 되돌릴 수 없습니다. ⌘Z 로 되돌려 주세요'); return }
        const t2 = e.state.tr.replaceWith(0, e.state.doc.content.size, before.content)
        e.view.dispatch(t2)
      },
    }
  }

  // ── 쪽 설정
  const SIZES = ['A4', 'A3', 'B5', 'Letter']
  const set_page_setup = {
    name: 'set_page_setup',
    description: '쪽 설정을 바꾼다(탭마다). 주지 않은 항목은 그대로. size: A4, A3, B5, Letter. orientation: portrait(세로), landscape(가로). margins_mm: {top,right,bottom,left} 각 0~60mm(일부만 줘도 됨). header_mm, footer_mm: 머리말·꼬리말 위치 0~40mm. page_numbers: {on:boolean, pos:left|center|right}. header_text, footer_text: 머리말·꼬리말 글. 현재 값을 모르면 인자 없이 불러 읽을 수 있다(바꾸지 않고 현재 값 반환). 한글 모드의 양식 쪽 여백은 양식이 정하니 꼭 필요할 때만 바꾼다.',
    parameters: {
      type: 'object',
      properties: {
        size: { type: 'string', enum: SIZES },
        orientation: { type: 'string', enum: ['portrait', 'landscape'] },
        margins_mm: { type: 'object', properties: { top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' } } },
        header_mm: { type: 'number' }, footer_mm: { type: 'number' },
        page_numbers: { type: 'object', properties: { on: { type: 'boolean' }, pos: { type: 'string', enum: ['left', 'center', 'right'] } } },
        header_text: { type: 'string' }, footer_text: { type: 'string' },
      },
    },
    run: async (args = {}) => {
      const cur = env.getPage?.()
      if (!cur) return refuse('쪽 설정을 읽을 수 없습니다')
      const keys = ['size', 'orientation', 'margins_mm', 'header_mm', 'footer_mm', 'page_numbers', 'header_text', 'footer_text']
      if (!keys.some((k) => args[k] !== undefined)) return { result: { ok: true, changed: false, page: pageBrief(cur) }, summary: '현재 쪽 설정을 읽음' }
      const bad = needWrite()
      if (bad) return refuse(bad)
      const next = JSON.parse(JSON.stringify(cur))
      if (args.size !== undefined) { if (!SIZES.includes(args.size)) return refuse(`size 는 ${SIZES.join(', ')} 중 하나입니다`); next.size = args.size }
      if (args.orientation !== undefined) { if (!['portrait', 'landscape'].includes(args.orientation)) return refuse('orientation 은 portrait 또는 landscape'); next.orientation = args.orientation }
      if (args.margins_mm !== undefined) {
        if (!isObj(args.margins_mm)) return refuse('margins_mm 은 {top,right,bottom,left} 객체입니다')
        for (const k of ['top', 'right', 'bottom', 'left']) if (args.margins_mm[k] !== undefined) {
          const v = Number(args.margins_mm[k])
          if (!Number.isFinite(v) || v < 0 || v > 60) return refuse(`margins_mm.${k} 는 0~60mm 입니다`)
          next.marginMm[k] = Math.round(v * 10) / 10
        }
      }
      for (const [k, f] of [['header_mm', 'headerMm'], ['footer_mm', 'footerMm']]) if (args[k] !== undefined) {
        const v = Number(args[k])
        if (!Number.isFinite(v) || v < 0 || v > 40) return refuse(`${k} 는 0~40mm 입니다`)
        next[f] = v
      }
      if (args.page_numbers !== undefined) {
        if (!isObj(args.page_numbers)) return refuse('page_numbers 는 {on,pos} 객체입니다')
        if (args.page_numbers.on !== undefined) next.pageNumbers.on = args.page_numbers.on === true
        if (args.page_numbers.pos !== undefined) { if (!['left', 'center', 'right'].includes(args.page_numbers.pos)) return refuse('pos 는 left, center, right'); next.pageNumbers.pos = args.page_numbers.pos }
      }
      if (args.header_text !== undefined) next.header = { ...next.header, text: lib.cleanStr(args.header_text, 200) || '' }
      if (args.footer_text !== undefined) next.footer = { ...next.footer, text: lib.cleanStr(args.footer_text, 200) || '' }
      if (JSON.stringify(next) === JSON.stringify(cur)) return { result: { ok: true, changed: false, page: pageBrief(cur) }, summary: '이미 같은 설정' }
      const prev = env.getRawPage?.() ?? null
      env.setPage(next)
      return { result: { ok: true, page: pageBrief(next) }, summary: '쪽 설정을 바꿈', undo: () => env.setPage(prev) }
    },
  }
  const pageBrief = (p) => ({ size: typeof p.size === 'object' ? `${p.size.wMm}x${p.size.hMm}mm` : p.size, orientation: p.orientation, margins_mm: p.marginMm, header_mm: p.headerMm, footer_mm: p.footerMm, page_numbers: p.pageNumbers, header_text: p.header?.text || '', footer_text: p.footer?.text || '' })

  // ── 한글(공문) 모드
  const PRESETS = ['기안문', '보고서', '계획서', '업무보고', '개조식', '통지', '알림', '회의록', '보도자료']
  const switch_mode = {
    name: 'switch_mode',
    description: '문서 모드를 바꾼다. mode "hwp" 는 한글(공문) 모드(공문서 양식, 항목 부호 자동, 개조식 규칙), "docs" 는 일반 Docs 모드. preset 은 한글 모드의 양식(기안문, 보고서, 계획서, 업무보고, 개조식, 통지, 알림, 회의록, 보도자료). 글 내용은 바뀌지 않고 보이는 방식과 쪽 설정만 달라진다. 사용자가 "공문 형식으로" 라고 하면 이 도구로 켠 뒤 run_gongmun_check 로 표기를 검사한다. 되돌리기 가능.',
    parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['docs', 'hwp'] }, preset: { type: 'string', enum: PRESETS } }, required: ['mode'] },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      if (!['docs', 'hwp'].includes(args.mode)) return refuse('mode 는 docs 또는 hwp')
      if (args.preset !== undefined && !PRESETS.includes(args.preset)) return refuse(`preset 은 ${PRESETS.join(', ')} 중 하나입니다`)
      const cur = env.getHwp()
      const patch = { mode: args.mode }
      if (args.preset) patch.preset = args.preset
      if (cur.mode === patch.mode && (!patch.preset || patch.preset === cur.preset)) return { result: { ok: true, changed: false, mode: cur.mode, preset: cur.preset }, summary: '이미 같은 모드' }
      env.updateHwp(patch)
      const nxt = { mode: patch.mode, preset: patch.preset || cur.preset }
      return {
        result: { ok: true, mode: nxt.mode, preset: nxt.preset, next: nxt.mode === 'hwp' ? 'set_gongmun_fields 로 두문(수신·제목 등)과 결문을 채우고 run_gongmun_check 로 검사한다' : undefined },
        summary: nxt.mode === 'hwp' ? `한글(공문) 모드로 바꿈(${nxt.preset})` : 'Docs 모드로 바꿈',
        undo: () => env.updateHwp({ mode: cur.mode, preset: cur.preset }),
      }
    },
  }

  const HEAD = ['org', 'to', 'via', 'title']
  const FOOT = ['sender', 'drafter', 'reviewer', 'approver', 'docNum', 'zip', 'address', 'site']
  const set_gongmun_fields = {
    name: 'set_gongmun_fields',
    description: '한글(공문) 모드의 두문·결문 칸과 자료값(변수)을 채운다. head: {org(행정기관명), to(수신), via(경유), title(제목)}, foot: {sender(발신명의), drafter, reviewer, approver, docNum(시행), zip, address, site}, vars: [{label, value, unit?}] (이름이 같은 자료값은 값만 바꾸고 없으면 새로 만든다. 본문과 두문에서 {이름} 으로 쓰면 값이 들어간다). 주지 않은 칸은 그대로. 모르는 값은 지어내지 말고 빈 채로 두거나 사용자에게 묻는다. 한글 모드가 아니면 오류이니 먼저 switch_mode.',
    parameters: {
      type: 'object',
      properties: {
        head: { type: 'object', properties: { org: { type: 'string' }, to: { type: 'string' }, via: { type: 'string' }, title: { type: 'string' } } },
        foot: { type: 'object', properties: Object.fromEntries(FOOT.map((k) => [k, { type: 'string' }])) },
        vars: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' }, unit: { type: 'string' } }, required: ['label'] } },
      },
    },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      const cur = env.getHwpFull()
      if (cur.mode !== 'hwp') return refuse('한글(공문) 모드에서만 쓸 수 있습니다. switch_mode {mode:"hwp"} 를 먼저 부르세요')
      const patch = {}
      const changed = []
      if (args.head !== undefined) {
        if (!isObj(args.head)) return refuse('head 는 객체입니다')
        patch.head = { ...cur.head }
        for (const k of HEAD) if (typeof args.head[k] === 'string') { patch.head[k] = lib.cleanStr(args.head[k], 300).replace(/\n/g, ' '); changed.push(`두문 ${k}`) }
      }
      if (args.foot !== undefined) {
        if (!isObj(args.foot)) return refuse('foot 은 객체입니다')
        patch.foot = { ...(cur.foot || {}) }
        for (const k of FOOT) if (typeof args.foot[k] === 'string') { patch.foot[k] = lib.cleanStr(args.foot[k], 300).replace(/\n/g, ' '); changed.push(`결문 ${k}`) }
      }
      if (args.vars !== undefined) {
        if (!Array.isArray(args.vars)) return refuse('vars 는 배열입니다')
        const vars = { ...(cur.vars || {}) }
        let order = Math.max(-1, ...Object.values(vars).map((v) => (Number.isFinite(v?.o) ? v.o : -1))) + 1
        for (const v of args.vars.slice(0, 40)) {
          if (!isObj(v) || typeof v.label !== 'string' || !v.label.trim()) continue
          const label = v.label.trim().slice(0, 40)
          let key = Object.keys(vars).find((k) => k === label || vars[k]?.label === label)
          const value = v.value === undefined ? vars[key]?.value ?? '' : String(v.value).slice(0, 200)
          const unit = v.unit === undefined ? vars[key]?.unit ?? '' : String(v.unit).slice(0, 10)
          if (!key) { let i = Object.keys(vars).length + 1; while (vars[`v${i}`]) i += 1; key = `v${i}`; vars[key] = { label, value, unit, o: order++ } }
          else vars[key] = { ...vars[key], label, value, unit }
          changed.push(`자료값 ${label}`)
        }
        patch.vars = vars
      }
      if (!changed.length) return { result: { ok: true, changed: false, head: cur.head, foot: cur.foot || {}, vars: Object.values(cur.vars || {}).map((v) => ({ label: v.label, value: v.value, unit: v.unit })) }, summary: '현재 칸을 읽음(바뀐 것 없음)' }
      env.updateHwp(patch)
      const prev = { head: cur.head, foot: cur.foot || {}, vars: cur.vars || {} }
      return { result: { ok: true, changed }, summary: `공문 칸 ${changed.length}개 채움`, undo: () => env.updateHwp(prev) }
    },
  }

  // ── 문서 검사
  const check_document = {
    name: 'check_document',
    description: '문서를 규칙으로 검사해 고칠 목록을 준다(AI 추측이 아닌 결정적 검사, 맞춤법은 보지 않음). 규칙: empty_heading, heading_skip, double_space, repeat_punct, mixed_numbering, long_paragraph(600자 초과), empty_list_item, table_no_header, image_no_alt, mixed_fonts. 항목마다 id, 규칙, 문단 번호(n), 심각도, 메시지, 고치는 방법(fix). 최대 60개. "문서 점검해줘", "형식 정리" 요청에 먼저 부르고, 사용자가 원하면 fix 대로 edit_paragraphs, replace_text, apply_format, table_ops 로 고친다. 고치기 전에 무엇을 고칠지 한두 줄로 알린다.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const snap = snapshot()
      if (!snap) return refuse('편집기가 아직 준비되지 않았습니다')
      const r = lintFacts(factsFromDoc(snap.state.doc, snap, lib))
      return { result: { total: r.issues.length, counts: r.counts, issues: r.issues.slice(0, MAX_ISSUES), truncated: r.issues.length > MAX_ISSUES }, summary: r.issues.length ? `점검 ${r.issues.length}건` : '점검 통과(규칙 위반 없음)' }
    },
  }

  // ── 표
  function findTable(doc, t) {
    let k = 0
    let hit = null
    doc.descendants((node, pos) => {
      if (hit) return false
      if (node.type.name === 'table') { k += 1; if (k === t) { hit = { node, pos }; return false } }
      return true
    })
    return hit
  }
  const cellPosOf = (tb, r, c) => {
    const map = TableMap.get(tb.node)
    if (r < 1 || c < 1 || r > map.height || c > map.width) return null
    return tb.pos + 1 + map.map[(r - 1) * map.width + (c - 1)]
  }
  const dispatchCmd = (editor, cmd) => {
    let ok = false
    ok = cmd(editor.state, (tr) => editor.view.dispatch(tr))
    return ok
  }
  const placeAt = (editor, cellPos, other) => {
    const doc = editor.state.doc
    const sel = other == null ? TextSelection.near(doc.resolve(cellPos + 1)) : new CellSelection(doc.resolve(cellPos), doc.resolve(other))
    editor.view.dispatch(editor.state.tr.setSelection(sel))
  }
  const intArg = (v) => clampInt(v, 1, 500, 0)

  const table_ops = {
    name: 'table_ops',
    description: '표를 편집한다(read_document 의 "표 t1 r2 c3" 위치 번호 기준, 모두 1부터). table: 표 번호. op: add_row(row 뒤에 행 추가, before=true 면 앞), add_col(col 뒤에 열 추가), delete_row, delete_col, merge(row,col 부터 row2,col2 까지 칸 합치기), split(합친 칸 나누기), toggle_header(첫 행을 머리글로 켜기·끄기), set_cell(row,col 칸의 글 바꾸기, text), fill(cells:[{row,col,text}] 여러 칸 채우기, 최대 200칸). 행·열을 더하면 번호가 밀린다. 한 번 호출에 op 하나이며 set_cell 과 fill 은 서식을 유지하며 글만 바꾼다. 새 표 만들기는 insert_blocks 의 table 블록.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'integer', description: '표 번호(문서 순서, 1부터)' },
        op: { type: 'string', enum: ['add_row', 'add_col', 'delete_row', 'delete_col', 'merge', 'split', 'toggle_header', 'set_cell', 'fill'] },
        row: { type: 'integer' }, col: { type: 'integer' }, row2: { type: 'integer' }, col2: { type: 'integer' },
        before: { type: 'boolean', description: 'add_row/add_col 을 해당 위치 앞에' },
        text: { type: 'string' },
        cells: { type: 'array', items: { type: 'object', properties: { row: { type: 'integer' }, col: { type: 'integer' }, text: { type: 'string' } }, required: ['row', 'col', 'text'] } },
      },
      required: ['table', 'op'],
    },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      const snap = snapshot()
      const editor = snap.editor
      const tb = findTable(snap.state.doc, intArg(args.table))
      if (!tb) return refuse(`${args.table}번 표가 없습니다. read_document 에서 "표 t번호" 를 확인하세요`)
      const map = TableMap.get(tb.node)
      const dim = `표는 ${map.height}행 ${map.width}열`
      const before = editor.state.doc
      const after = () => editor.state.doc
      const done = (summary, result = {}) => {
        const a = after()
        if (a.eq(before)) return { result: { ok: true, changed: false, hint: '바뀐 것이 없습니다', ...result }, summary: '바뀐 것 없음' }
        return {
          result: { ok: true, ...result, note: '표 위치 번호와 문단 번호가 바뀌었을 수 있으니 이어서 고치려면 read_document 로 다시 읽을 것' },
          summary,
          undo: () => {
            const e = ed()
            if (!e || e.isDestroyed) return
            if (!e.state.doc.eq(a)) { env.notify?.('그 뒤에 문서가 바뀌어 자동으로 되돌릴 수 없습니다. ⌘Z 로 되돌려 주세요'); return }
            e.view.dispatch(e.state.tr.replaceWith(0, e.state.doc.content.size, before.content))
          },
        }
      }
      const row = intArg(args.row)
      const col = intArg(args.col)
      const needCell = () => {
        const p = cellPosOf(tb, row, col)
        if (!p) return null
        return p
      }
      const op = args.op
      if (op === 'add_row' || op === 'delete_row') {
        const p = cellPosOf(tb, row || (op === 'add_row' ? map.height : 0), col || 1)
        if (!p) return refuse(`row 가 범위를 벗어납니다(${dim})`)
        placeAt(editor, p)
        if (op === 'delete_row' && map.height <= 1) return refuse('마지막 행은 지울 수 없습니다')
        dispatchCmd(editor, op === 'delete_row' ? deleteRow : args.before ? addRowBefore : addRowAfter)
        return done(op === 'add_row' ? '행을 추가' : '행을 삭제', { dimension: dimNow(editor, tb.pos) })
      }
      if (op === 'add_col' || op === 'delete_col') {
        const p = cellPosOf(tb, row || 1, col || (op === 'add_col' ? map.width : 0))
        if (!p) return refuse(`col 이 범위를 벗어납니다(${dim})`)
        if (op === 'delete_col' && map.width <= 1) return refuse('마지막 열은 지울 수 없습니다')
        placeAt(editor, p)
        dispatchCmd(editor, op === 'delete_col' ? deleteColumn : args.before ? addColumnBefore : addColumnAfter)
        return done(op === 'add_col' ? '열을 추가' : '열을 삭제', { dimension: dimNow(editor, tb.pos) })
      }
      if (op === 'merge') {
        const p1 = needCell()
        const p2 = cellPosOf(tb, intArg(args.row2), intArg(args.col2))
        if (!p1 || !p2) return refuse(`row,col,row2,col2 가 모두 필요하고 범위 안이어야 합니다(${dim})`)
        placeAt(editor, p1, p2)
        if (!dispatchCmd(editor, mergeCells)) return refuse('이 범위는 합칠 수 없습니다(직사각형이어야 합니다)')
        return done('칸을 합침')
      }
      if (op === 'split') {
        const p = needCell()
        if (!p) return refuse(`row,col 이 필요하고 범위 안이어야 합니다(${dim})`)
        placeAt(editor, p)
        if (!dispatchCmd(editor, splitCell)) return refuse('합쳐진 칸이 아닙니다')
        return done('칸을 나눔')
      }
      if (op === 'toggle_header') {
        placeAt(editor, cellPosOf(tb, 1, 1))
        dispatchCmd(editor, toggleHeaderRow)
        return done('머리글 행을 바꿈')
      }
      if (op === 'set_cell' || op === 'fill') {
        const list = op === 'set_cell' ? [{ row, col, text: args.text }] : Array.isArray(args.cells) ? args.cells.slice(0, 200) : []
        if (!list.length) return refuse(op === 'fill' ? 'cells 가 필요합니다' : 'row, col, text 가 필요합니다')
        const prims = []
        const errors = []
        const tbNow = findTable(editor.state.doc, intArg(args.table))
        for (const it of list) {
          const cp = cellPosOf(tbNow, intArg(it?.row), intArg(it?.col))
          const text = lib.cleanStr(it?.text, 2000)
          if (!cp || text == null) { errors.push(`칸 r${it?.row} c${it?.col} 또는 text 가 올바르지 않음(${dim})`); continue }
          const cell = editor.state.doc.nodeAt(cp)
          const first = cell?.firstChild
          if (!first || !first.isTextblock) { errors.push(`r${it.row} c${it.col}: 글 칸이 아님`); continue }
          const model = lib.paraModel(first, cp + 1)
          const plan = lib.planChange(editor.state.schema, model, 0, model.chars.length, lib.fromDisplay(text, model, 0, model.chars.length))
          prims.push(...plan.prims)
        }
        if (!prims.length) return refuse(errors[0] || '바뀐 것이 없습니다')
        const tr = editor.state.tr
        lib.applyPrims(tr, prims)
        tr.setMeta('ai-edit', true)
        editor.view.dispatch(tr)
        const r = done(`표 칸 ${list.length - errors.length}개 채움`, { errors: errors.slice(0, 5) })
        return r
      }
      return refuse('op 가 올바르지 않습니다')
    },
  }
  const dimNow = (editor, tpos) => {
    const n = editor.state.doc.nodeAt(tpos)
    if (!n || n.type.name !== 'table') return null
    const m = TableMap.get(n)
    return `${m.height}행 ${m.width}열`
  }

  const set_cell_style = {
    name: 'set_cell_style',
    description: '표 칸의 모양을 바꾼다. table(표 번호), cells:[{row,col}] 또는 row/col 하나(생략하면 표 전체 칸), background(#RRGGBB 또는 색 이름, null 이면 지움), align(left, center, right: 칸 안 글 정렬), bold(true/false: 칸 글 굵게). 머리글 행만 꾸미려면 cells 에 첫 행 칸들을 준다. 최대 200칸. 되돌리기 가능.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'integer' },
        row: { type: 'integer' }, col: { type: 'integer' },
        cells: { type: 'array', items: { type: 'object', properties: { row: { type: 'integer' }, col: { type: 'integer' } }, required: ['row', 'col'] } },
        background: { type: ['string', 'null'] },
        align: { type: 'string', enum: ['left', 'center', 'right'] },
        bold: { type: 'boolean' },
      },
      required: ['table'],
    },
    run: async (args = {}) => {
      const bad = needWrite()
      if (bad) return refuse(bad)
      const snap = snapshot()
      const editor = snap.editor
      const tb = findTable(snap.state.doc, intArg(args.table))
      if (!tb) return refuse(`${args.table}번 표가 없습니다`)
      const map = TableMap.get(tb.node)
      let list
      if (Array.isArray(args.cells)) list = args.cells.slice(0, 200).map((c) => ({ row: intArg(c?.row), col: intArg(c?.col) }))
      else if (args.row !== undefined && args.col !== undefined) list = [{ row: intArg(args.row), col: intArg(args.col) }]
      else { list = []; for (let r = 1; r <= map.height; r += 1) for (let c = 1; c <= map.width; c += 1) list.push({ row: r, col: c }) }
      let bg
      if (args.background !== undefined) {
        if (args.background === null) bg = null
        else { bg = normColor(args.background); if (!bg) return refuse('background 는 #RRGGBB 또는 색 이름(검정, 빨강, 파랑, 초록, 보라, 노랑, 회색, 흰색)') }
      }
      if (args.align !== undefined && !['left', 'center', 'right'].includes(args.align)) return refuse('align 은 left, center, right')
      const tr = editor.state.tr
      const seen = new Set()
      let n = 0
      const { schema } = editor.state
      for (const it of list) {
        const cp = cellPosOf(tb, it.row, it.col)
        if (!cp || seen.has(cp)) continue
        seen.add(cp)
        const cell = tr.doc.nodeAt(cp)
        if (!cell) continue
        if (bg !== undefined) tr.setNodeMarkup(cp, null, { ...cell.attrs, background: bg })
        cell.forEach((child, off) => {
          const pp = cp + 1 + off
          if (args.align && child.isTextblock) tr.setNodeMarkup(pp, null, { ...child.attrs, textAlign: args.align })
          if (typeof args.bold === 'boolean' && child.isTextblock && child.content.size && schema.marks.bold) {
            if (args.bold) tr.addMark(pp + 1, pp + 1 + child.content.size, schema.marks.bold.create())
            else tr.removeMark(pp + 1, pp + 1 + child.content.size, schema.marks.bold)
          }
        })
        n += 1
      }
      if (!n) return refuse(`범위를 벗어난 칸입니다(표는 ${map.height}행 ${map.width}열)`)
      if (!tr.docChanged) return { result: { ok: true, changed: false }, summary: '바뀐 것 없음' }
      return finish(editor, tr, { ok: true, cells: n }, `표 칸 ${n}개 모양을 바꿈`)
    },
  }

  return [get_outline, find_in_document, read_comments, add_comment, reply_comment, resolve_comment, apply_format, set_page_setup, switch_mode, set_gongmun_fields, check_document, table_ops, set_cell_style]
}
