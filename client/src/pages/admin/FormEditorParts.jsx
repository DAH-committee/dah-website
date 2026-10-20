// FormEditorParts.jsx: 설문 편집기의 새 기능 조각(격자, 평점, 검증 규칙, 분기, 퀴즈, 요약).
// FormEditor.jsx 가 질문 카드 안에서 불러다 쓴다. 저장 형식은 components/forms/formLogic.js 머리말을 본다.
import { Plus, X } from 'lucide-react'
import { Select, Toggle } from '../../components/admin/FormControls'
import {
  CHOICE_TYPES, GRID_TYPES, OTHER_LABEL, analyzeFlow, buildPages, estimateMinutes, ratingMaxOf, scaleRange, summarizeQuestion, summarizeQuiz,
} from '../../components/forms/formLogic'

const INK = 'text-text-pri'
const SUB = 'text-text-sec'
const INPUT = `h-40 min-w-0 rounded-sm bg-bg-elev px-12 text-body-m ${INK} outline-none focus:ring-2 focus:ring-border-focus`
const ICON_BTN =
  'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-sec transition hover:bg-glass-strong hover:text-text-pri disabled:cursor-default disabled:opacity-40 md:h-32 md:w-32'
const SUBTEXT_BTN = 'flex h-40 w-fit cursor-pointer items-center gap-8 text-small-m font-semibold text-purple-light hover:underline'

export const GRADABLE = ['radio', 'select', 'checkbox', 'text', 'scale', 'rating']

function Block({ title, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-8 rounded-md bg-bg-elev p-16">
      <p className={`text-small-m font-semibold ${INK}`}>{title}</p>
      {children}
    </div>
  )
}

function SwitchLine({ title, checked, onChange, label }) {
  return (
    <div className="flex items-center justify-between gap-12">
      <span className={`text-small-m ${INK}`}>{title}</span>
      <Toggle checked={checked} onChange={onChange} label={label || title} />
    </div>
  )
}

/** 문자열 목록 편집(격자 행/열, 정답 후보) */
export function StringList({ items, onChange, label, addLabel, max = 50 }) {
  const update = (i, v) => onChange(items.map((x, idx) => (idx === i ? v : x)))
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {items.map((v, i) => (
        <div key={i} className="flex min-w-0 items-center gap-8">
          <span className={`w-20 shrink-0 text-center text-small-m ${SUB}`}>{i + 1}</span>
          <input
            value={v}
            maxLength={200}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => update(i, e.target.value)}
            className={`${INPUT} flex-1`}
          />
          <button type="button" aria-label={`${label} ${i + 1} 삭제`} onClick={() => onChange(items.filter((_, idx) => idx !== i))} className={ICON_BTN}>
            <X size={18} />
          </button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" onClick={() => onChange([...items, `${label} ${items.length + 1}`])} className={SUBTEXT_BTN}>
          <Plus size={16} aria-hidden="true" /> {addLabel || `${label} 추가`}
        </button>
      )}
    </div>
  )
}

/** 섞기, 기타 칸 */
export function OptionExtras({ field, setValidation }) {
  const v = field.validation || {}
  const hasOtherOption = (field.options || []).includes(OTHER_LABEL)
  return (
    <div className="flex flex-col gap-0">
      <SwitchLine title="보기 순서를 응답자마다 섞기" checked={v.shuffle === true} onChange={(on) => setValidation({ shuffle: on || undefined })} />
      <SwitchLine title={'"기타" 칸 추가 (직접 입력)'} checked={v.other === true} onChange={(on) => setValidation({ other: on || undefined })} label="기타 칸" />
      {v.other && hasOtherOption && <p className="text-caption-m text-state-error">보기에 이미 "기타"가 있어 저장할 수 없습니다. 둘 중 하나를 지우세요.</p>}
    </div>
  )
}

/** 사용할 수 있는 이동 대상: 이 질문보다 뒤에 있는 섹션과 설문 제출 */
export function targetsAfter(fields, index) {
  const pages = buildPages(fields)
  const out = [{ value: '', label: '다음 섹션으로' }]
  fields.forEach((f, i) => {
    if (f.type !== 'section' || i <= index) return
    const at = pages.findIndex((p) => p.section?.id === f.id)
    out.push({ value: `section:${f.id}`, label: `섹션 ${at + 1}${f.label_ko ? `: ${f.label_ko}` : ''}으로` })
  })
  out.push({ value: 'submit', label: '설문 제출' })
  return out
}

/** 답에 따라 섹션 이동 (객관식, 드롭다운) */
export function BranchingEditor({ field, targets, onChange }) {
  const map = field.logic?.options || {}
  if (targets.length <= 2) {
    return <p className={`text-small-m ${SUB}`}>답에 따라 이동하려면 이 질문 아래에 섹션을 먼저 추가하세요.</p>
  }
  const labels = [...(field.options || []), ...(field.validation?.other ? [OTHER_LABEL] : [])]
  const setOne = (opt, value) => {
    const next = { ...map }
    if (value) next[opt] = value
    else delete next[opt]
    onChange(Object.keys(next).length ? { options: next } : undefined)
  }
  return (
    <Block title="답에 따라 섹션 이동">
      <p className={`text-caption-m ${SUB}`}>같은 섹션에 분기 질문이 여럿이면 아래쪽 질문의 답이 이깁니다. 뒤쪽 섹션으로만 보낼 수 있습니다.</p>
      <div className="flex flex-col gap-8">
        {labels.map((opt) => (
          <div key={opt} className="grid grid-cols-1 items-center gap-8 md:grid-cols-[minmax(0,1fr)_260px]">
            <span className={`min-w-0 break-words text-body-m ${INK}`}>{opt || '(빈 보기)'}</span>
            <Select value={map[opt] || ''} options={targets} onChange={(e) => setOne(opt, e.target.value)} aria-label={`${opt} 선택 시 이동`} />
          </div>
        ))}
      </div>
    </Block>
  )
}

/** 섹션이 끝난 뒤 이동 */
export function SectionAfter({ field, targets, onChange }) {
  if (targets.length <= 2 && !field.logic?.after) {
    return (
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[minmax(0,1fr)_260px]">
        <span className={`text-small-m ${SUB}`}>이 섹션이 끝나면</span>
        <Select value="" options={[targets[0], targets[targets.length - 1]]} onChange={(e) => onChange(e.target.value ? { after: e.target.value } : undefined)} aria-label="섹션 뒤 이동" />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[minmax(0,1fr)_260px]">
      <span className={`text-small-m ${SUB}`}>이 섹션이 끝나면</span>
      <Select value={field.logic?.after || ''} options={targets} onChange={(e) => onChange(e.target.value ? { after: e.target.value } : undefined)} aria-label="섹션 뒤 이동" />
    </div>
  )
}

export function GridEditor({ field, onChange }) {
  const v = field.validation || {}
  const setV = (patch) => onChange({ ...field, validation: { ...v, ...patch } })
  return (
    <div className="flex flex-col gap-16">
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <p className={`text-small-m font-semibold ${INK}`}>행 (질문 문장)</p>
          <StringList items={field.rows || []} onChange={(rows) => onChange({ ...field, rows })} label="행" max={50} />
        </div>
        <div className="flex flex-col gap-4">
          <p className={`text-small-m font-semibold ${INK}`}>열 (고를 보기)</p>
          <StringList items={field.columns || []} onChange={(columns) => onChange({ ...field, columns })} label="열" max={20} />
        </div>
      </div>
      {field.type === 'radio_grid' && <SwitchLine title="열마다 한 번만 고르게 하기" checked={v.noDuplicate === true} onChange={(on) => setV({ noDuplicate: on || undefined })} />}
      <SwitchLine title="모든 행에 답해야 함 (필수일 때)" checked={v.requireEachRow !== false} onChange={(on) => setV({ requireEachRow: on ? undefined : false })} />
      {(field.rows || []).length > 8 && <p className="text-caption-m text-state-error">행이 8개를 넘으면 응답자가 지치기 쉽습니다. 나누는 것을 권합니다.</p>}
    </div>
  )
}

const ICONS = [{ value: 'star', label: '별' }, { value: 'heart', label: '하트' }, { value: 'thumb', label: '엄지' }]
const LEVELS = Array.from({ length: 8 }, (_, i) => ({ value: String(i + 3), label: `${i + 3}단계` }))
export function RatingEditor({ field, setValidation }) {
  const v = field.validation || {}
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-12">
        <div className="w-112"><Select value={String(ratingMaxOf(v))} options={LEVELS} onChange={(e) => setValidation({ ratingMax: Number(e.target.value) })} aria-label="평점 단계" /></div>
        <div className="w-112"><Select value={v.ratingIcon || 'star'} options={ICONS} onChange={(e) => setValidation({ ratingIcon: e.target.value })} aria-label="평점 모양" /></div>
      </div>
      <div className="grid grid-cols-1 gap-12 md:grid-cols-2">
        <label className={`flex items-center gap-12 text-small-m ${SUB}`}>
          <span className="w-48 shrink-0">1점 이름</span>
          <input value={v.scaleMinLabel || ''} maxLength={60} onChange={(e) => setValidation({ scaleMinLabel: e.target.value })} placeholder="예: 매우 불만족" className={`${INPUT} flex-1`} />
        </label>
        <label className={`flex items-center gap-12 text-small-m ${SUB}`}>
          <span className="w-48 shrink-0">{ratingMaxOf(v)}점 이름</span>
          <input value={v.scaleMaxLabel || ''} maxLength={60} onChange={(e) => setValidation({ scaleMaxLabel: e.target.value })} placeholder="예: 매우 만족" className={`${INPUT} flex-1`} />
        </label>
      </div>
    </div>
  )
}

// ── 검증 규칙 ──
const KINDS_TEXT = [
  { value: '', label: '규칙 없음' }, { value: 'number', label: '숫자' }, { value: 'text', label: '텍스트' },
  { value: 'length', label: '글자 수' }, { value: 'regex', label: '정규식' },
]
const KINDS_LONG = [{ value: '', label: '규칙 없음' }, { value: 'length', label: '글자 수' }, { value: 'regex', label: '정규식' }]
const OPS = {
  number: [['gt', '보다 큼'], ['gte', '이상'], ['lt', '보다 작음'], ['lte', '이하'], ['eq', '같음'], ['neq', '같지 않음'], ['between', '사이'], ['notBetween', '사이가 아님'], ['isNumber', '숫자'], ['isInteger', '정수']],
  text: [['contains', '포함'], ['notContains', '포함하지 않음'], ['email', '이메일'], ['url', '주소(URL)']],
  length: [['max', '최대 글자 수'], ['min', '최소 글자 수']],
  regex: [['matches', '일치'], ['notMatches', '일치하지 않음'], ['contains', '포함'], ['notContains', '포함하지 않음']],
  choices: [['atLeast', '최소'], ['atMost', '최대'], ['exactly', '정확히']],
}
const opOptions = (kind) => (OPS[kind] || []).map(([value, label]) => ({ value, label }))
const NEEDS_VALUE = (r) => r && !['isNumber', 'isInteger', 'email', 'url'].includes(r.op) && r.kind !== 'length' && r.kind !== 'choices'

export function RuleEditor({ field, setValidation }) {
  const rule = field.validation?.rule
  const isChoice = field.type === 'checkbox'
  const set = (patch) => setValidation({ rule: { ...(rule || {}), ...patch } })
  const kindOpts = field.type === 'text' ? KINDS_TEXT : KINDS_LONG
  if (isChoice) {
    const r = rule?.kind === 'choices' ? rule : null
    return (
      <div className="flex flex-wrap items-center gap-8 text-small-m text-text-sec">
        <div className="w-[220px]"><Select value={r ? '1' : ''} options={[{ value: '', label: '선택 개수 제한 없음' }, { value: '1', label: '선택 개수 제한' }]} onChange={(e) => setValidation({ rule: e.target.value ? { kind: 'choices', op: 'atLeast', n: 1 } : undefined })} aria-label="선택 개수 제한" /></div>
        {r && (
          <>
            <div className="w-112"><Select value={r.op} options={opOptions('choices')} onChange={(e) => set({ op: e.target.value })} aria-label="개수 조건" /></div>
            <input type="number" min="1" max="200" value={r.n ?? 1} onChange={(e) => set({ n: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} aria-label="개수" className={`${INPUT} w-80`} />
            <span>개</span>
            <input value={r.message || ''} maxLength={200} onChange={(e) => set({ message: e.target.value })} placeholder="오류 문구 (선택)" className={`${INPUT} min-w-[160px] flex-1`} />
          </>
        )}
      </div>
    )
  }
  const kind = rule?.kind || ''
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-8 text-small-m text-text-sec">
        <div className="w-128"><Select value={kind} options={kindOpts} onChange={(e) => {
          const k = e.target.value
          setValidation({ rule: k ? { kind: k, op: OPS[k][0][0], ...(k === 'length' ? { n: 100 } : { value: '' }) } : undefined })
        }} aria-label="검증 규칙 종류" /></div>
        {kind && <div className="w-160"><Select value={rule.op} options={opOptions(kind)} onChange={(e) => set({ op: e.target.value })} aria-label="검증 조건" /></div>}
        {kind === 'length' && <><input type="number" min="0" value={rule.n ?? 0} onChange={(e) => set({ n: Math.max(0, Number(e.target.value) || 0) })} aria-label="글자 수" className={`${INPUT} w-96`} /><span>자</span></>}
        {NEEDS_VALUE(rule) && <input value={rule.value ?? ''} maxLength={kind === 'regex' ? 200 : 100} onChange={(e) => set({ value: e.target.value })} placeholder={kind === 'regex' ? '예: ^[0-9]{3}$' : '값'} aria-label="기준값" className={`${INPUT} min-w-[120px] flex-1`} />}
        {kind === 'number' && ['between', 'notBetween'].includes(rule.op) && <input value={rule.value2 ?? ''} onChange={(e) => set({ value2: e.target.value })} placeholder="끝 값" aria-label="끝 값" className={`${INPUT} w-112`} />}
      </div>
      {kind && (
        <input value={rule.message || ''} maxLength={200} onChange={(e) => set({ message: e.target.value })} placeholder="맞지 않을 때 보여줄 문구 (선택)" aria-label="오류 문구" className={`${INPUT} w-full`} />
      )}
    </div>
  )
}

// ── 퀴즈 정답 ──
export function QuizKeyEditor({ field, onChange }) {
  const q = field.quiz || { points: 0, correct: [], ignoreCase: true, numeric: false }
  const set = (patch) => onChange({ ...field, quiz: { ...q, ...patch } })
  const type = field.type
  const options = type === 'scale' ? (() => { const { min, max } = scaleRange(field.validation); return Array.from({ length: max - min + 1 }, (_, i) => String(min + i)) })()
    : type === 'rating' ? Array.from({ length: ratingMaxOf(field.validation) }, (_, i) => String(i + 1))
      : field.options || []
  return (
    <Block title="정답과 배점">
      <div className="flex flex-wrap items-center gap-8 text-small-m text-text-sec">
        <input type="number" min="0" max="1000" value={q.points ?? 0} onChange={(e) => set({ points: Math.max(0, Math.min(1000, Math.trunc(Number(e.target.value) || 0))) })} aria-label="배점" className={`${INPUT} w-96`} />
        <span>점 (0점이면 채점하지 않음)</span>
      </div>
      {['radio', 'select', 'scale', 'rating'].includes(type) && (
        <div role="radiogroup" aria-label="정답" className="flex flex-col">
          {options.map((o) => {
            const on = (q.correct || []).includes(o)
            return (
              <button key={o} type="button" role="radio" aria-checked={on} onClick={() => set({ correct: [o] })} className="flex min-h-11 cursor-pointer items-center gap-12 py-4 text-left">
                <span aria-hidden="true" className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-purple-primary' : 'border-border-strong'}`}>{on && <span className="h-8 w-8 rounded-full bg-purple-primary" />}</span>
                <span className={`min-w-0 break-words text-body-m ${INK}`}>{o || '(빈 보기)'}</span>
              </button>
            )
          })}
        </div>
      )}
      {type === 'checkbox' && (
        <div role="group" aria-label="정답 (모두 맞게 골라야 정답)" className="flex flex-col">
          {options.map((o) => {
            const on = (q.correct || []).includes(o)
            return (
              <button key={o} type="button" role="checkbox" aria-checked={on} onClick={() => set({ correct: on ? q.correct.filter((x) => x !== o) : [...(q.correct || []), o] })} className="flex min-h-11 cursor-pointer items-center gap-12 py-4 text-left">
                <span aria-hidden="true" className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border-2 ${on ? 'border-purple-primary bg-purple-primary' : 'border-border-strong'}`}>{on && <span className="h-8 w-8 rounded-sm bg-bg-panel" />}</span>
                <span className={`min-w-0 break-words text-body-m ${INK}`}>{o || '(빈 보기)'}</span>
              </button>
            )
          })}
          <p className="text-caption-m text-text-sec">고른 보기와 정확히 같게 고른 응답만 정답입니다.</p>
        </div>
      )}
      {type === 'text' && (
        <div className="flex flex-col gap-8">
          <p className={`text-small-m ${SUB}`}>인정할 정답 (여러 개 가능)</p>
          <StringList items={q.correct || []} onChange={(correct) => set({ correct })} label="정답" addLabel="정답 변형 추가" max={50} />
          <SwitchLine title="대소문자 구분 없이 채점" checked={q.ignoreCase !== false} onChange={(on) => set({ ignoreCase: on })} />
          <SwitchLine title="숫자로 비교 (5와 5.0을 같게)" checked={q.numeric === true} onChange={(on) => set({ numeric: on })} />
        </div>
      )}
      <input value={q.feedback_correct || ''} maxLength={500} onChange={(e) => set({ feedback_correct: e.target.value })} placeholder="맞혔을 때 보여줄 해설 (선택)" aria-label="정답 해설" className={`${INPUT} w-full`} />
      <input value={q.feedback_incorrect || ''} maxLength={500} onChange={(e) => set({ feedback_incorrect: e.target.value })} placeholder="틀렸을 때 보여줄 해설 (선택)" aria-label="오답 해설" className={`${INPUT} w-full`} />
    </Block>
  )
}

// ── 흐름 요약 ──
export function FlowSummary({ fields }) {
  const { pages, issues } = analyzeFlow(fields)
  const lines = []
  const targetName = (t) => (t === 'submit' ? '설문 제출' : (() => { const at = pages.findIndex((p) => p.section && `section:${p.section.id}` === t); return at >= 0 ? `섹션 ${at + 1}${pages[at].section.label_ko ? ` (${pages[at].section.label_ko})` : ''}` : '(없는 섹션)' })())
  pages.forEach((p, i) => {
    for (const q of p.fields) {
      for (const [opt, t] of Object.entries(q.logic?.options || {})) lines.push(`${i + 1}쪽 "${q.label_ko || '제목 없는 질문'}": ${opt} 선택 시 ${targetName(t)}으로`)
    }
    if (p.section?.logic?.after) lines.push(`${i + 1}쪽 끝: ${targetName(p.section.logic.after)}으로`)
  })
  if (!lines.length && !issues.length) return null
  return (
    <section className="flex flex-col gap-8 rounded-md bg-bg-panel p-16 shadow-[0_1px_2px_rgb(0_0_0/0.18)]" aria-label="분기 요약">
      <p className={`text-small-m font-semibold ${INK}`}>분기 흐름</p>
      <ul className={`flex flex-col gap-4 text-small-m ${SUB}`}>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-4 text-small-m text-state-error" role="alert">{issues.map((it, i) => <li key={`${it.code}-${i}`}>{it.message}</li>)}</ul>
      )}
    </section>
  )
}

// ── 설정 탭: 퀴즈, 완료 문구 ──
const RELEASE = [
  { value: 'immediate', label: '제출 직후 바로 보여주기' },
  { value: 'manual', label: '내가 공개를 켠 뒤에 보여주기' },
  { value: 'never', label: '점수를 응답자에게 보여주지 않기' },
]
export function QuizSettings({ settings, setSetting, fields }) {
  const q = settings.quiz || { enabled: false, release: 'immediate', released: false, show_answers: false }
  const set = (patch) => setSetting('quiz')({ ...q, ...patch })
  const total = fields.reduce((a, f) => a + (f.quiz?.points > 0 ? f.quiz.points : 0), 0)
  return (
    <div className="flex flex-col gap-12">
      <SwitchLine title="퀴즈로 만들기 (정답과 점수로 자동 채점)" checked={q.enabled} onChange={(on) => set({ enabled: on })} label="퀴즈 모드" />
      {q.enabled && (
        <>
          <div className="flex flex-col gap-4">
            <p className={`text-small-m ${SUB}`}>점수 공개</p>
            <div className="max-w-[360px]"><Select value={q.release} options={RELEASE} onChange={(e) => set({ release: e.target.value })} aria-label="점수 공개 방식" /></div>
          </div>
          {q.release === 'manual' && <SwitchLine title="지금 점수 공개하기" checked={q.released === true} onChange={(on) => set({ released: on })} />}
          {q.release !== 'never' && <SwitchLine title="점수와 함께 정답 보여주기" checked={q.show_answers === true} onChange={(on) => set({ show_answers: on })} />}
          <p className={`text-small-m ${SUB}`}>배점이 있는 질문의 합계: {total}점. 질문 카드를 펼치면 정답과 배점을 정할 수 있습니다. 정답은 응답자에게 제출 전에 보이지 않습니다.</p>
        </>
      )}
    </div>
  )
}

// ── 응답 요약 ──
function Bars({ rows, unit = '명' }) {
  const top = Math.max(1, ...rows.map((r) => r.n))
  return (
    <ul className="flex flex-col gap-12">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_72px] items-center gap-12 text-small-m">
          <span className={`truncate ${INK}`}>{r.label}</span>
          <span className="h-16 rounded-sm bg-bg-elev"><span className="block h-16 rounded-sm bg-purple-primary" style={{ width: `${(r.n / top) * 100}%` }} /></span>
          <span className={`text-right ${SUB}`}>{r.n}{unit}{r.pct != null ? ` ${r.pct}%` : ''}</span>
        </li>
      ))}
    </ul>
  )
}

export function ResponseSummary({ fields, items, settings, card, typeLabel }) {
  const quiz = summarizeQuiz(fields, items, settings)
  const cards = fields.filter((f) => f.type !== 'section').map((f) => summarizeQuestion(f, items, settings)).filter((s) => s.counts || s.distribution || s.rows || s.number)
  return (
    <>
      {quiz && (
        <section className={`${card} gap-16 p-24 md:p-32`}>
          <header>
            <h3 className={`text-body-l-m font-medium md:text-body-l-d ${INK}`}>퀴즈 점수</h3>
            <p className={`mt-4 text-small-m ${SUB}`}>채점된 응답 {quiz.n}건{quiz.mean != null ? `, 평균 ${quiz.mean} / ${quiz.max}점` : ''}</p>
          </header>
          {quiz.buckets.length > 0 && <Bars rows={quiz.buckets.map((b) => ({ label: `${b.range}점`, n: b.n }))} />}
          {quiz.questions.length > 0 && (
            <>
              <p className={`text-small-m font-semibold ${INK}`}>문항별 정답률</p>
              <Bars rows={quiz.questions.map((x) => ({ label: x.title || '제목 없는 질문', n: x.pctCorrect, pct: undefined }))} unit="%" />
            </>
          )}
        </section>
      )}
      {cards.map((s) => (
        <section key={s.id} className={`${card} gap-16 p-24 md:p-32`}>
          <header>
            <h3 className={`break-words text-body-l-m font-medium md:text-body-l-d ${INK}`}>{s.title || '제목 없는 질문'}</h3>
            <p className={`mt-4 text-small-m ${SUB}`}>{typeLabel(s.type)}, 응답 {s.answered}개{s.mean != null ? `, 평균 ${s.mean}` : ''}</p>
          </header>
          {s.counts && <Bars rows={s.counts.map((c) => ({ label: c.option, n: c.n, pct: c.pct }))} />}
          {s.distribution && <Bars rows={s.distribution.map((d) => ({ label: String(d.value), n: d.n }))} />}
          {s.number && (s.number.n ? (
            <p className={`text-small-m ${INK}`}>최솟값 {s.number.min}, 최댓값 {s.number.max}, 평균 {s.number.mean}, 중앙값 {s.number.median}</p>
          ) : <p className={`text-small-m ${SUB}`}>숫자 응답이 없습니다</p>)}
          {s.rows && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-small-m">
                <thead><tr><th className="p-8 text-left" />{s.rows[0]?.cells.map((c) => <th key={c.column} className={`p-8 text-center font-medium ${INK}`}>{c.column}</th>)}</tr></thead>
                <tbody>
                  {s.rows.map((r, i) => (
                    <tr key={r.row} className={i % 2 === 0 ? 'bg-bg-elev' : ''}>
                      <th scope="row" className={`p-8 text-left font-medium ${INK}`}>{r.row}</th>
                      {r.cells.map((c) => <td key={c.column} className={`p-8 text-center ${SUB}`}>{c.n}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  )
}

export { estimateMinutes, GRID_TYPES, CHOICE_TYPES }
