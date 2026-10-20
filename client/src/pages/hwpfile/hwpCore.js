// 한글 파일 편집기의 순수 함수 모음(DOM, React, 네트워크 없음). node 로 바로 시험한다.
// 서버 계약: server/src/routes/hwpFiles.README.md (블록 id, 영역, 편집 연산, 오류 코드)

import { fixGongmunText, fixersForRule } from './gongmunRules.js'

export const MAX_EDIT_CHARS = 20000
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export const clampInt = (v, lo, hi, d) => {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return d
  return Math.max(lo, Math.min(hi, n))
}

/** 사용자나 모델이 넣은 글을 일반 글자로만 정리한다(줄바꿈은 \n 으로 통일, 제어문자 제거) */
export function cleanText(v, max = MAX_EDIT_CHARS) {
  if (typeof v !== 'string') return null
  return v.replace(/\r\n?/g, '\n').replace(CTRL, '').slice(0, max)
}

export const isBlockId = (v) => typeof v === 'string' && /^b\d{1,9}$/.test(v)
export const isCellId = (v) => typeof v === 'string' && /^b\d{1,9}#r\d{1,4}c\d{1,4}$/.test(v)

/** 'b12#r2c1' -> { table:'b12', row:2, col:1 } */
export function parseCellId(id) {
  const m = /^(b\d+)#r(\d+)c(\d+)$/.exec(String(id || ''))
  return m ? { table: m[1], row: Number(m[2]), col: Number(m[3]) } : null
}

// ───────────────────────── 쪽 영역 맞히기 ─────────────────────────

const area = (r) => Math.max(0, r.bbox.width) * Math.max(0, r.bbox.height)
const contains = (r, x, y) => x >= r.bbox.x && x <= r.bbox.x + r.bbox.width && y >= r.bbox.y && y <= r.bbox.y + r.bbox.height

/** 쪽 안 좌표(pt)에 있는 가장 안쪽 영역. block 이 없는 영역은 건너뛴다. 칸 영역이 있으면 칸을 먼저 쓴다 */
export function hitTest(regions, x, y) {
  let best = null
  for (const r of regions || []) {
    if (!r?.bbox || !r.block || !contains(r, x, y)) continue
    if (!best) {
      best = r
      continue
    }
    const rc = r.cell ? 1 : 0
    const bc = best.cell ? 1 : 0
    if (rc !== bc ? rc > bc : area(r) < area(best)) best = r
  }
  return best
}

/** 영역 -> 화면 픽셀 사각형 (scale = pt 당 px) */
export function regionRect(r, scale) {
  return { left: r.bbox.x * scale, top: r.bbox.y * scale, width: r.bbox.width * scale, height: r.bbox.height * scale }
}

/** 한 블록(또는 칸)에 속한 영역들 */
export function regionsOf(regions, sel) {
  if (!sel) return []
  return (regions || []).filter((r) => (sel.cell ? r.cell === sel.cell : r.block === sel.block && !r.cell))
}

/** 편집 상자의 글자 크기 추정(px). 영역 높이를 줄 수로 나눠서 구한다 */
export function estimateFontPx(bbox, text, scale) {
  const lines = Math.max(1, String(text || '').split('\n').length)
  const perLine = (bbox.height * scale) / lines
  // 한 줄 영역은 글자 높이에 가깝고, 여러 줄 영역은 줄 간격(보통 150~160%)이 들어 있다
  return Math.round(Math.max(10, Math.min(30, perLine / (lines > 1 ? 1.5 : 1.08))) * 10) / 10
}

// ───────────────────────── 블록 모델 ─────────────────────────

export function indexBlocks(list) {
  const m = new Map()
  for (const b of list || []) m.set(b.id, b)
  return m
}

/** 선택({block, cell?}) 에 해당하는 지금 글. 칸이면 칸 글, 아니면 블록 글. 없으면 null */
export function textOfSel(blocks, sel) {
  const b = blocks?.get(sel?.block)
  if (!b) return null
  if (sel.cell) {
    const c = findCell(b, sel.cell)
    return c && !c.covered ? String(c.text ?? '') : null
  }
  return typeof b.text === 'string' ? b.text : b.type === 'table' ? null : ''
}

export function findCell(block, cellId) {
  for (const row of block?.table?.cells || []) for (const c of row) if (c && c.id === cellId) return c
  return null
}

/** 선택이 글을 직접 고칠 수 있는 곳인가: { ok, reason } */
export function editability(blocks, sel) {
  const b = blocks?.get(sel?.block)
  if (!b) return { ok: false, reason: '이 영역은 고칠 수 없습니다' }
  if (sel.cell) {
    const c = findCell(b, sel.cell)
    if (!c || c.covered) return { ok: false, reason: '병합된 칸은 왼쪽 위 칸을 고치세요' }
    if (c.editable === false) return { ok: false, reason: c.reason || '이 칸은 고칠 수 없습니다' }
    return { ok: true }
  }
  if (b.type === 'table') return { ok: false, reason: '표는 칸을 눌러 고치세요' }
  if (b.type === 'image' || b.type === 'separator') return { ok: false, reason: '글이 없는 영역입니다' }
  if (b.editable === 'locked') return { ok: false, reason: b.reason || '이 블록은 고칠 수 없습니다' }
  return { ok: true }
}

/** 서버 편집 연산 만들기. type 이 연산 이름이다(서버 응답의 applied[].type 과 같다) */
export function makeEditOp(blocks, sel, text, { expect = true } = {}) {
  const clean = cleanText(text)
  if (clean === null) throw new Error('글이 올바르지 않습니다')
  const before = textOfSel(blocks, sel)
  if (sel.cell) {
    const p = parseCellId(sel.cell)
    if (!p) throw new Error('칸 위치를 알 수 없습니다')
    return { type: 'replace_cell', table: p.table, row: p.row, col: p.col, text: clean, ...(expect && before ? { expect: before } : {}) }
  }
  return { type: 'replace_block', block: sel.block, text: clean, ...(expect && before ? { expect: before } : {}) }
}

/** 낙관적 갱신: 글만 바꾼 새 Map 을 돌려준다(원본은 건드리지 않는다) */
export function applyLocalEdit(blocks, sel, text) {
  const b = blocks.get(sel.block)
  if (!b) return blocks
  const next = new Map(blocks)
  if (sel.cell && b.table) {
    const cells = b.table.cells.map((row) => row.map((c) => (c && c.id === sel.cell ? { ...c, text } : c)))
    next.set(b.id, { ...b, table: { ...b.table, cells } })
  } else {
    next.set(b.id, { ...b, text })
  }
  return next
}

// ───────────────────────── 버전 기록(실행취소) ─────────────────────────
// 서버 규칙: 되돌리기는 지난 버전을 "새 버전"으로 복원한다. 화면은 곧바로 지난 버전을 보여 주고, 복원은 뒤에서 한다.

export function createHistory() {
  let undo = []
  let redo = []
  return {
    /** 내가 고쳐서 새 버전이 생겼다: 고치기 전 버전을 쌓고 다시 실행 목록을 비운다 */
    record(prev) {
      if (prev == null) return
      undo.push(prev)
      if (undo.length > 100) undo.shift()
      redo = []
    },
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    /** current 에서 한 단계 뒤로. 가야 할 버전을 돌려주고 current 는 다시 실행 목록에 쌓는다 */
    undo(current) {
      const to = undo.pop()
      if (to == null) return null
      redo.push(current)
      return to
    },
    redo(current) {
      const to = redo.pop()
      if (to == null) return null
      undo.push(current)
      return to
    },
    /** 복원이 끝나서 서버가 새 버전 번호를 줬다. 쌓아 둔 번호는 그대로 둔다(내용이 같은 새 버전이므로) */
    clear() {
      undo = []
      redo = []
    },
    snapshot: () => ({ undo: [...undo], redo: [...redo] }),
  }
}

// ───────────────────────── 서버 응답 읽기 ─────────────────────────

export const SKIP_KO = {
  LOCKED: '고칠 수 없는 영역',
  STALE: '그 사이 글이 바뀜',
  NOT_FOUND: '위치를 찾지 못함',
  HWP_UNSUPPORTED: '.hwp 파일은 지원하지 않는 편집',
  UNCHANGED: '바뀐 것이 없음',
  AMBIGUOUS: '여러 곳이라 정하지 못함',
  UNSUPPORTED: '지원하지 않는 편집',
}

export const ERROR_KO = {
  LOGIN: '로그인이 필요합니다',
  FORBIDDEN: '이 파일을 고칠 권한이 없습니다',
  NOT_FOUND: '파일이나 버전을 찾을 수 없습니다',
  VERSION_CONFLICT: '다른 곳에서 먼저 고쳤습니다. 최신 내용으로 다시 불러옵니다',
  TOO_LARGE: '파일이 너무 큽니다 (25MB 이하)',
  ENCRYPTED: '열기 암호가 걸린 문서입니다. 한컴에서 암호를 풀고 저장한 뒤 올려 주세요',
  DRM_PROTECTED: '문서 보안(DRM)이 걸려 있어 열 수 없습니다',
  CORRUPTED: '파일이 손상되었거나 한글 문서가 아닙니다',
  VERIFY_FAILED: '고친 결과 검증에 실패해 적용하지 않았습니다',
  NO_VALID_OPS: '적용할 수 있는 편집이 없습니다',
  BUSY: '지금 이 파일을 처리 중입니다. 잠시 뒤 다시 시도하세요',
  TIMEOUT: '처리 시간이 너무 오래 걸립니다',
  ENGINE: '한글 엔진을 불러오지 못했습니다',
  STORAGE: '파일 저장소가 연결되어 있지 않습니다',
  UNSUPPORTED_FORMAT: '한글(.hwp .hwpx)과 워드(.docx)만 올릴 수 있습니다',
  NETWORK: '서버에 연결하지 못했습니다',
}

export function errorText(e) {
  if (!e) return '처리하지 못했습니다'
  const code = e.code
  // 적용할 수 있는 편집이 하나도 없을 때 서버가 건너뛴 이유(skipped)를 같이 준다: 그 이유를 그대로 보여 준다
  const sk = e.body?.error?.skipped
  if (code === 'NO_VALID_OPS' && Array.isArray(sk) && sk[0]) return sk[0].message || SKIP_KO[sk[0].reason] || ERROR_KO.NO_VALID_OPS
  const base = e.message && e.message !== '[object Object]' ? e.message : ''
  if (code && ERROR_KO[code] && !base) return ERROR_KO[code]
  return base || ERROR_KO[code] || '처리하지 못했습니다'
}

/** 편집 응답 -> 사용자에게 보일 한 줄 */
export function summarizeEdit(res, { dry = false } = {}) {
  const n = res?.applied?.length || 0
  const s = res?.skipped?.length || 0
  if (!n && !s) return dry ? '바뀔 곳이 없습니다' : '바뀐 곳이 없습니다'
  const head = dry ? `${n}곳이 바뀔 예정` : `${n}곳 고침`
  return s ? `${head}, ${s}곳 건너뜀` : head
}

export function skippedBrief(res, max = 5) {
  return (res?.skipped || []).slice(0, max).map((x) => ({ op: x.op, type: x.type, reason: x.reason, message: x.message || SKIP_KO[x.reason] || '' }))
}

/**
 * 신구대조 항목 정리: 서버는 같은 블록의 고침을 removed(옛 글) + added(새 글) 두 줄로 줄 수 있다.
 * 같은 블록이 이어서 나오면 한 줄(modified)로 합친다. 서버 기준은 from(옛 버전) -> to(새 버전)이다.
 */
export function pairDiffs(diffs) {
  const out = []
  const list = diffs || []
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i]
    const n = list[i + 1]
    if (d.type === 'removed' && n && n.type === 'added' && d.block && d.block === n.block) {
      out.push({ ...d, type: 'modified', before: d.before, after: n.after })
      i += 1
    } else out.push(d)
  }
  return out
}

/** 신구대조 결과에서 바뀐 블록 id 집합과 종류 */
export function changedBlocksOf(compare) {
  const map = new Map()
  for (const d of pairDiffs(compare?.diffs)) {
    if (d.block) map.set(d.block, d.type)
  }
  return map
}

/** 쪽 번호 목록 [from..to] 을 size 개씩 나눈다 */
export function chunkRange(from, to, size) {
  const out = []
  for (let a = from; a <= to; a += size) out.push([a, Math.min(to, a + size - 1)])
  return out
}

/** 연속 보기에서 화면에 가까운 쪽 번호들(앞뒤 margin 쪽 포함) */
export function nearPages(current, pageCount, margin = 1) {
  const out = []
  for (let n = Math.max(1, current - margin); n <= Math.min(pageCount, current + margin); n += 1) out.push(n)
  return out
}

/** 맞춤 배율: 폭 맞춤이면 보이는 폭에서 쪽 폭, 쪽 맞춤이면 높이도 본다. 결과는 pt 당 px */
export function fitScale(mode, viewW, viewH, pageW, pageH, pad = 48) {
  const w = Math.max(100, viewW - pad)
  const h = Math.max(100, viewH - pad)
  const byW = w / pageW
  if (mode === 'page') return Math.min(byW, h / pageH)
  return byW
}

/** 양식 칸 값 모으기: 이름 -> 값 (빈 문자열은 제외) */
export function pickFilled(values) {
  const out = {}
  for (const [k, v] of Object.entries(values || {})) {
    if (typeof k !== 'string' || !k.trim()) continue
    const val = Array.isArray(v) ? v.map((x) => cleanText(String(x), 2000)).filter((x) => x !== null && x !== '') : cleanText(String(v ?? ''), 2000)
    if (Array.isArray(val) ? val.length : val) out[k.trim()] = val
  }
  return out
}

/**
 * 공문 검사 항목 하나를 고치는 편집 연산(자동으로 고칠 수 있을 때만, 아니면 null).
 * 서버 suggest 는 설명용 예시("예) 2025. 1. 6.")라서 쓰지 않고, 그 블록(칸)의 글에 이쪽 표기 규칙을 적용해 새 글을 만든다.
 */
export function lintFixFor(f, blocks) {
  const only = fixersForRule(f?.rule)
  if (!only) return null
  const tableId = f.cell ? parseCellId(f.cell)?.table : null
  const sel = f.cell ? { block: tableId || f.block, cell: f.cell } : { block: f.block }
  const before = textOfSel(blocks, sel)
  if (!before) return null
  const fixed = fixGongmunText(before, only)
  if (fixed.text === before || !fixed.changes.length) return null
  try {
    return makeEditOp(blocks, sel, fixed.text)
  } catch {
    return null
  }
}

/** 같은 블록(칸)을 두 번 고치지 않도록 연산 모으기: 같은 대상의 여러 지적은 한 연산으로 합쳐진다 */
export function lintFixOps(findings, blocks, max = 200) {
  const seen = new Set()
  const ops = []
  for (const f of findings || []) {
    const key = f.cell || f.block
    if (!key || seen.has(key)) continue
    const op = lintFixFor(f, blocks)
    if (!op) continue
    seen.add(key)
    ops.push(op)
    if (ops.length >= max) break
  }
  return ops
}

export const SEVERITY_KO = { error: '오류', warn: '주의', info: '참고' }
export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 }
export function sortFindings(list) {
  return [...(list || [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
}

export const REDACT_RULES = [
  { id: 'rrn', label: '주민등록번호' },
  { id: 'phone', label: '전화번호' },
  { id: 'email', label: '이메일' },
  { id: 'account', label: '계좌번호' },
  { id: 'card', label: '카드번호' },
  { id: 'passport', label: '여권번호' },
  { id: 'driver', label: '운전면허번호' },
  { id: 'address', label: '주소' },
]
