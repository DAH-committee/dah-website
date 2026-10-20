// 한글 모드 엔진(편집 화면 쪽). miri(같은 팀, MIT) hwpDoc.js 를 Tiptap 문서 구조에 맞게 옮겼다.
// 양식별 값(쪽 여백, 글꼴, 글자 크기, 장평, 줄 간격, 항목 부호와 단계별 들여쓰기)은 kordoc 이 만드는 HWPX 를 풀어 잰
// hwpMetrics.json 에서 읽는다. 화면, 미리보기, 내보낸 파일이 같은 문단 모양을 쓰게 하기 위해서다.
// 항목 부호는 kordoc 과 같은 규칙으로 매긴다: 단계별 번호, 상위 단계가 바뀌면 하위 번호 초기화, 항목 사이에 일반 문단이 끼면 처음부터.
import METRICS from './hwpMetrics.json'

export const PRESETS = [
  { key: '기안문', label: '기안문(일반 기안)', numbering: 'standard', head: true },
  { key: '보고서', label: '보고서', numbering: 'report' },
  { key: '계획서', label: '계획서', numbering: 'report' },
  { key: '업무보고', label: '업무보고', numbering: 'report' },
  { key: '개조식', label: '개조식 보고서', numbering: 'report' },
  { key: '통지', label: '통지, 안내', numbering: 'standard' },
  { key: '알림', label: '공고, 알림', numbering: 'standard' },
  { key: '회의록', label: '회의록', numbering: 'standard' },
  { key: '보도자료', label: '보도자료', numbering: 'report' },
]
export const presetOf = (key) => PRESETS.find((p) => p.key === key) || PRESETS[1]
export const metricsOf = (key) => METRICS.presets[key] || METRICS.presets['보고서']
export const isStandard = (key) => presetOf(key).numbering === 'standard'

// 한글 글꼴 이름과 화면 대체 글꼴. 문서에는 앞 이름이 들어가고, 이 컴퓨터에 그 글꼴이 없으면 뒤 글꼴로 보인다
const FONT_CSS = {
  함초롬바탕: "'함초롬바탕','HCR Batang','Noto Serif KR',serif",
  함초롬돋움: "'함초롬돋움','HCR Dotum','Noto Sans KR',sans-serif",
  휴먼명조: "'휴먼명조','HumanMyeongjo','Noto Serif KR',serif",
  한컴돋움: "'한컴돋움','HancomDotum','Noto Sans KR',sans-serif",
  굴림체: "'굴림체','GulimChe','Nanum Gothic','Noto Sans KR',monospace",
  굴림: "'굴림','Gulim','Noto Sans KR',sans-serif",
  바탕: "'바탕','Batang','Noto Serif KR',serif",
  돋움: "'돋움','Dotum','Noto Sans KR',sans-serif",
  '맑은 고딕': "'맑은 고딕','Malgun Gothic','Noto Sans KR',sans-serif",
  HY헤드라인M: "'HY헤드라인M','HYHeadLine-Medium','Noto Sans KR',sans-serif",
  HY견고딕: "'HY견고딕','HYGothic-Extra','Noto Sans KR',sans-serif",
}
export const HWP_FONTS = Object.keys(FONT_CSS)
export const fontCss = (name) => FONT_CSS[name] || FONT_CSS.함초롬바탕
/** 편집기 글꼴 값(CSS)에서 한글 글꼴 이름을 꺼낸다. 한글 글꼴이 아니면 null */
export function hwpFontOf(css) {
  const first = String(css || '').split(',')[0].replace(/['"]/g, '').trim()
  return HWP_FONTS.includes(first) ? first : null
}
const HEAVY = { HY헤드라인M: 700, HY견고딕: 800 }
export const HWP_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30, 32]
export const LINE_SPACINGS = [100, 130, 145, 150, 160, 170, 180, 190, 200]
export const RATIOS = [80, 85, 90, 95, 100, 105, 110, 120]
export const SPACINGS = [-10, -8, -5, -3, 0, 3, 5, 10]

// 항목 부호 매기기(kordoc 과 같은 순서)
const GA = '가나다라마바사아자차카타파하'
const hangulSeq = (n) => {
  const i = n - 1
  const base = GA[i % 14]
  const round = Math.floor(i / 14)
  if (!round) return base
  const code = base.charCodeAt(0) - 0xac00
  const cho = Math.floor(code / 588)
  const vowels = [0, 4, 8, 13, 18, 20]
  return String.fromCharCode(0xac00 + cho * 588 + vowels[round % vowels.length] * 28)
}
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ']
export function markFor(sample, n) {
  if (!sample) return ''
  if (/^\d/.test(sample) || /^\(\d/.test(sample)) return sample.replace(/\d+/, String(n))
  if (/가/.test(sample)) return sample.replace('가', hangulSeq(n))
  if (sample === '①') return n <= 20 ? String.fromCodePoint(0x245f + n) : `(${n})`
  if (sample === '㉮') return n <= 14 ? String.fromCodePoint(0x326d + n) : hangulSeq(n)
  return sample
}
export const romanOf = (n) => ROMAN[n - 1] || String(n)

/**
 * 문서(ProseMirror doc)의 맨 위 블록을 훑어 항목 부호를 매긴다. 화면 장식(HwpMarks)과 내보내기가 같은 규칙을 쓴다.
 * visit(kind, node, pos, info) 로 알려 준다. kind: 'h2' | 'h3' | 'item'(목록 항목의 첫 문단)
 * 기안문 계열(standard): 장 제목(h2)이 1단계, 절 제목(h3)이 그 아래 단계, 목록은 마지막 제목 아래로 이어진다.
 * 보고서 계열(report): 장 제목은 Ⅰ Ⅱ 띠, 절 제목은 □, 목록은 □ 아래면 ㅇ - ㆍ, 아니면 □ 부터.
 */
export function walkMarks(doc, presetKey, visit) {
  const m = metricsOf(presetKey)
  const standard = isStandard(presetKey)
  const counters = Array(10).fill(0)
  let base = 0
  let h2n = 0
  const bump = (lv) => {
    counters[lv] += 1
    for (let i = lv + 1; i < counters.length; i += 1) counters[i] = 0
    return markFor(m.levels[lv - 1]?.marker, counters[lv])
  }
  const walkList = (list, listPos, depth) => {
    list.forEach((item, off) => {
      const itemPos = listPos + 1 + off
      const lv = Math.min(8, base + depth)
      const mark = standard ? bump(lv) : m.levels[lv - 1]?.marker || ''
      item.forEach((child, coff) => {
        const cpos = itemPos + 1 + coff
        if (coff === 0 && child.type.name === 'paragraph') visit('item', child, cpos, { lv, mark })
        else if (/List$/.test(child.type.name)) walkList(child, cpos, depth + 1)
      })
    })
  }
  doc.forEach((node, pos) => {
    const t = node.type.name
    if (t === 'heading') {
      const level = node.attrs.level
      if (level === 1) { counters.fill(0); base = 0; return }
      if (level === 2) {
        if (standard) { visit('h2', node, pos, { lv: 1, mark: bump(1) }); base = 1 }
        else { h2n += 1; counters.fill(0); base = 0; visit('h2', node, pos, { lv: 0, mark: romanOf(h2n), band: true }) }
        return
      }
      if (level === 3) {
        if (standard) { const lv = base >= 1 ? 2 : 1; visit('h3', node, pos, { lv, mark: bump(lv) }); base = lv }
        else { visit('h3', node, pos, { lv: 1, mark: m.levels[0]?.marker || '□' }); base = 1 }
        return
      }
      return
    }
    if (t === 'bulletList' || t === 'orderedList' || t === 'taskList') { walkList(node, pos, 1); return }
    // 일반 문단이 끼면 kordoc 은 번호를 처음부터 다시 매긴다(표, 쪽 나눔은 이어짐)
    if (t === 'paragraph' && node.textContent.trim() && !/^※/.test(node.textContent.trim()) && standard) { counters.fill(0); base = 0 }
  })
}

const r3 = (v) => Math.round(v * 1000) / 1000
const ls = (o) => r3(((o?.ratio ?? 100) - 100) / 200 + (o?.spacing ?? 0) / 100) // 장평은 자간으로 근사
const al = (a) => ({ JUSTIFY: 'justify', CENTER: 'center', RIGHT: 'right', LEFT: 'left', DISTRIBUTE: 'justify' }[a] || 'justify')
const fontRule = (o) => (o ? `font-family:${fontCss(o.font)};font-size:${o.pt}pt;font-weight:${o.bold ? 700 : HEAVY[o.font] || 400};letter-spacing:${ls(o)}em;` : '')

/** 양식에 맞는 한글 모드 CSS. S 는 쪽(.gd-page) 선택자 */
export function hwpCss(presetKey, S = '.hw-on .gd-page') {
  const m = metricsOf(presetKey)
  const b = m.body
  const p = m.page
  const P = `${S} .ProseMirror`
  const std = isStandard(presetKey)
  const level = (sel, l) => {
    if (!l) return ''
    const hang = Math.abs(l.intent || 0)
    const markerPt = l.markerPt || l.pt
    return `${sel}{${fontRule(l)}padding-left:${r3((l.left || 0) + hang)}em;text-indent:-${hang}em;line-height:${(l.lineSpacing || b.lineSpacing) / 100};text-align:${al(l.align)};margin:${l.prev || 0}em 0 ${l.next || 0}em !important;}
${sel}::before{content:attr(data-mark);display:inline-block;min-width:${hang}em;text-indent:0;font-family:${fontCss(l.markerFont || l.font)};font-size:${markerPt}pt;font-weight:${l.markerBold ? 700 : HEAVY[l.markerFont] || 400};}`
  }
  const lv = m.levels.map((l, i) => level(`${P} p.hm-item[data-lv="${i + 1}"]`, l)).join('\n')
  const head = (sel, o, extra = '') => (o ? `${sel}{${fontRule(o)}text-align:${al(o.align)};line-height:${(o.lineSpacing || 160) / 100};margin:${o.prev || 0}em 0 ${Math.max(o.next || 0, 0.3)}em !important;padding:0;border:0;${extra}}` : '')
  const h2 = std
    ? [1, 2].map((k) => level(`${P} h2.hm-h[data-lv="${k}"], ${P} h3.hm-h[data-lv="${k}"]`, m.levels[k - 1])).join('\n')
    : `${head(`${P} h2`, m.h2, 'display:flex;align-items:center;gap:.5em;border-bottom:1px solid #000 !important;padding-bottom:.1em !important;')}
${P} h2:not(:first-child){margin-top:.9em !important;}
${P} h2.hm-h::before{content:attr(data-mark);display:inline-grid;place-items:center;min-width:1.6em;padding:0 .2em;color:#fff;background:#0f2f5c;font-size:.9em;}
${level(`${P} h3.hm-h`, m.levels[0])}`
  return `
${S}{box-sizing:border-box;width:var(--pg-w,${p.width}mm);padding:var(--pg-pad,${p.top}mm ${p.right}mm ${p.bottom}mm ${p.left}mm);min-height:var(--pg-h,${p.height}mm);}
${P}{${fontRule(b)}line-height:${b.lineSpacing / 100};color:#000;word-break:keep-all;}
${P} > * + *{margin-top:0;}
${P} p{margin:0;text-align:${al(b.align)};}
${head(`${P} h1`, m.h1)}
${h2}
${P} h4{${fontRule(b)}font-weight:700;margin:.3em 0 !important;}
${P} ul,${P} ol{list-style:none !important;padding:0 !important;margin:0 !important;}
${P} li{margin:0 !important;}
${P} li::marker{content:'';}
${lv}
${P} blockquote{margin:.4em 0;padding:.4em .8em;border:1px solid #000;background:#dfe6f7;font-weight:700;}
${P} blockquote p:first-child::before{content:'○ ';}
${P} table{border-collapse:collapse;width:100%;margin:.4em 0;border:1.5px solid #000;table-layout:fixed;}
${P} th,${P} td{border:1px solid #000;padding:2px 6px;text-align:center;vertical-align:middle;line-height:1.3;}
${P} th{${fontRule(m.th)}background:#dfe6f7;border-bottom:3px double #000;}
${P} td{${fontRule(m.td)}}
${P} td p,${P} th p{text-align:center;}
${P} hr{border:0;border-top:1px dashed #6d7882;margin:.6em 0;}
${S} .hw-frame{font-family:${fontCss(b.font)};font-size:${b.pt}pt;line-height:1.6;color:#000;cursor:pointer;user-select:none;}
${S} .hw-gian-head .org{text-align:center;font-family:${fontCss('HY헤드라인M')};font-weight:700;font-size:${r3(b.pt * 1.75)}pt;letter-spacing:.6em;margin:.2em 0 1.2em;padding-left:.6em;}
${S} .hw-gian-head .row{display:flex;}
${S} .hw-gian-head .row b{font-weight:400;min-width:5.6em;letter-spacing:.35em;}
${S} .hw-gian-head .row.title{border-bottom:1px solid #000;padding-bottom:.2em;margin-bottom:.4em;}
${S} .hw-gian-foot .end{padding-left:1.4em;margin:.2em 0 1em;}
${S} .hw-gian-foot .sender{text-align:center;font-family:${fontCss('HY헤드라인M')};font-weight:700;font-size:${r3(b.pt * 1.6)}pt;margin:.6em 0 1em;}
${S} .hw-gian-foot .bar{height:.9em;background:#cdd1d5;margin-bottom:.3em;}
${S} .hw-gian-foot .line{display:flex;flex-wrap:wrap;gap:0 1.6em;font-size:.9em;}
${S} .hw-gian-foot .line.sign{gap:0 2.4em;padding-left:1em;}
`
}

export const pageOf = (presetKey) => metricsOf(presetKey).page

/** 새 한글 설정 */
export function defaultHwp(over = {}) {
  return { mode: 'docs', preset: '보고서', head: { org: '', to: '', via: '', title: '' }, foot: {}, vars: {}, ...over }
}
export function normHwp(h) {
  const d = defaultHwp()
  if (!h || typeof h !== 'object') return d
  return {
    ...d,
    ...h,
    mode: h.mode === 'hwp' ? 'hwp' : 'docs',
    preset: PRESETS.some((p) => p.key === h.preset) ? h.preset : d.preset,
    head: { ...d.head, ...(h.head || {}) },
    foot: { ...(h.foot || {}) },
    vars: h.vars && typeof h.vars === 'object' ? h.vars : {},
  }
}
