// 한글 모드 작업 창: 글자·문단, 자료값, 문서 정보, 공문 검사
import { useEffect, useState } from 'react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, IndentDecrease, IndentIncrease, List, Plus, Trash2, X, Variable, Calculator, CheckCircle2 } from 'lucide-react'
import { HWP_FONTS, HWP_SIZES, LINE_SPACINGS, PRESETS, RATIOS, SPACINGS, fontCss, hwpFontOf, metricsOf } from './hwpDoc'
import { chipText, newVarKey, nextOrder, varList } from './hwpVars'

const TABS = [
  { key: 'char', label: '글자·문단' },
  { key: 'vars', label: '자료값' },
  { key: 'info', label: '문서 정보' },
  { key: 'lint', label: '공문 검사' },
]

const HEAD_FIELDS = [
  ['org', '행정기관명'],
  ['to', '수신'],
  ['via', '경유'],
  ['title', '제목'],
]
const FOOT_FIELDS = [
  ['sender', '발신명의'],
  ['drafter', '기안자'],
  ['reviewer', '검토자'],
  ['approver', '결재권자'],
  ['docNum', '시행(문서번호)'],
  ['zip', '우편번호'],
  ['address', '주소'],
  ['site', '홈페이지'],
  ['phone', '전화'],
  ['fax', '전송'],
  ['email', '이메일'],
  ['disclosure', '공개 구분'],
]

const PRESS_FIELDS = [
  ['release', '보도 시점'],
  ['dept', '담당 부서'],
  ['manager', '담당자'],
  ['phone', '연락처'],
]

function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="hw-field">
      <span>{label}</span>
      <input value={value ?? ''} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Pick({ label, value, options, onChange, disabled, render }) {
  return (
    <label className="hw-field hw-field--pick">
      <span>{label}</span>
      <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {value !== '' && value != null && !options.includes(String(value)) ? <option value={value}>{value}</option> : null}
        {options.map((o) => <option key={o} value={o}>{render ? render(o) : o}</option>)}
      </select>
    </label>
  )
}

export default function HwpPane({ editor, settings, update, editing, tab, setTab, focusVar, onClose, lint, onLint, onJump }) {
  const [calc, setCalc] = useState({ expr: '', unit: '', digits: 0 })
  const [, tick] = useState(0)
  useEffect(() => {
    if (!editor) return undefined
    const h = () => tick((v) => v + 1)
    editor.on('selectionUpdate', h)
    editor.on('transaction', h)
    return () => {
      editor.off('selectionUpdate', h)
      editor.off('transaction', h)
    }
  }, [editor])

  const vars = settings.vars || {}
  const list = varList(vars)
  const ts = editor?.getAttributes('textStyle') || {}
  const body = metricsOf(settings.preset).body
  const font = hwpFontOf(ts.fontFamily) || body.font
  const size = ts.fontSize ? String(parseFloat(ts.fontSize)) : String(body.pt)
  const block = editor?.isActive('heading') ? 'heading' : 'paragraph'
  const lh = editor?.getAttributes(block).lineHeight || body.lineSpacing
  const align = ['center', 'right', 'justify', 'left'].find((a) => editor?.isActive({ textAlign: a })) || ''

  const setVar = (key, patch) => update({ vars: { ...vars, [key]: { ...vars[key], ...patch } } })
  const addVar = () => {
    const key = newVarKey(vars)
    update({ vars: { ...vars, [key]: { label: `자료값 ${list.length + 1}`, value: '', unit: '', o: nextOrder(vars) } } })
  }
  const removeVar = (key) => {
    const next = { ...vars }
    delete next[key]
    update({ vars: next })
  }
  const insertVar = (key) => editor.chain().focus().insertContent({ type: 'hwpVar', attrs: { key } }).run()
  const insertCalc = () => {
    if (!calc.expr.trim()) return
    editor.chain().focus().insertContent({ type: 'hwpVar', attrs: { calc: calc.expr.trim(), unit: calc.unit, digits: Number(calc.digits) || 0 } }).run()
    setCalc({ expr: '', unit: '', digits: 0 })
  }

  return (
    <aside className="hw-pane" aria-label="작업 창">
      <div className="hw-pane__head">
        <h2>작업 창</h2>
        <button type="button" className="gd-icon-btn" aria-label="작업 창 닫기" title="작업 창 닫기" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="hw-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="hw-pane__body">
        {tab === 'char' && (
          <>
            <section>
              <h3>글자 모양</h3>
              <Pick label="글꼴" value={font} options={HWP_FONTS} disabled={!editing} onChange={(v) => editor.chain().focus().setFontFamily(fontCss(v)).run()} />
              <Pick label="크기(pt)" value={size} options={HWP_SIZES.map(String)} disabled={!editing} onChange={(v) => editor.chain().focus().setMark('textStyle', { fontSize: `${v}pt` }).run()} />
              <Pick label="장평(%)" value={String(ts.ratio || 100)} options={RATIOS.map(String)} disabled={!editing} onChange={(v) => editor.chain().focus().setMark('textStyle', { ratio: Number(v) === 100 ? null : Number(v) }).run()} />
              <Pick label="자간(%)" value={String(ts.spacing || 0)} options={SPACINGS.map(String)} disabled={!editing} onChange={(v) => editor.chain().focus().setMark('textStyle', { spacing: Number(v) || null }).run()} />
            </section>
            <section>
              <h3>문단 모양</h3>
              <Pick label="줄 간격(%)" value={lh ? String(lh) : ''} options={LINE_SPACINGS.map(String)} disabled={!editing}
                onChange={(v) => editor.chain().focus().updateAttributes('paragraph', { lineHeight: Number(v) }).updateAttributes('heading', { lineHeight: Number(v) }).run()} />
              <div className="hw-row">
                {[['left', AlignLeft, '왼쪽'], ['center', AlignCenter, '가운데'], ['right', AlignRight, '오른쪽'], ['justify', AlignJustify, '양쪽']].map(([a, I, l]) => (
                  <button key={a} type="button" className={`hw-ib${align === a ? ' is-on' : ''}`} disabled={!editing} title={`${l} 정렬`} aria-label={`${l} 정렬`} onClick={() => editor.chain().focus().setTextAlign(a).run()}><I size={18} /></button>
                ))}
              </div>
              <div className="hw-row">
                <button type="button" className={`hw-ib${editor?.isActive('bulletList') ? ' is-on' : ''}`} disabled={!editing} title="항목 부호" aria-label="항목 부호" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={18} /></button>
                <button type="button" className="hw-ib" disabled={!editing} title="한 단계 위로" aria-label="한 단계 위로" onClick={() => editor.chain().focus().liftListItem('listItem').run()}><IndentDecrease size={18} /></button>
                <button type="button" className="hw-ib" disabled={!editing} title="한 단계 아래로" aria-label="한 단계 아래로" onClick={() => editor.chain().focus().sinkListItem('listItem').run()}><IndentIncrease size={18} /></button>
              </div>
              <p className="hw-note">항목 부호는 양식에 맞춰 자동으로 붙습니다. 기안문은 1. 가. 1) 가), 보고서는 □ ㅇ - ㆍ 순서입니다.</p>
            </section>
          </>
        )}

        {tab === 'vars' && (
          <>
            <p className="hw-note">값을 한 번 고치면 문서 안 같은 자료값이 모두 바뀝니다. 두문과 결문에는 {'{이름}'}으로 씁니다.</p>
            {list.length === 0 && <p className="hw-empty">아직 자료값이 없습니다.</p>}
            {list.map((v) => (
              <div key={v.key} className={`hw-var-card${focusVar === v.key ? ' is-focus' : ''}`}>
                <div className="hw-var-card__top">
                  <input className="hw-var-card__label" value={v.label} disabled={!editing} aria-label="자료값 이름" onChange={(e) => setVar(v.key, { label: e.target.value })} />
                  <button type="button" className="hw-ib" disabled={!editing} title="본문에 넣기" aria-label="본문에 넣기" onClick={() => insertVar(v.key)}><Plus size={16} /></button>
                  <button type="button" className="hw-ib" disabled={!editing} title="자료값 삭제" aria-label="자료값 삭제" onClick={() => removeVar(v.key)}><Trash2 size={16} /></button>
                </div>
                <div className="hw-var-card__vals">
                  <input value={v.value} placeholder="○○○" disabled={!editing} aria-label="값" onChange={(e) => setVar(v.key, { value: e.target.value })} />
                  <input className="unit" value={v.unit} placeholder="단위" disabled={!editing} aria-label="단위" onChange={(e) => setVar(v.key, { unit: e.target.value })} />
                </div>
                <span className="hw-var-card__show">{chipText({ key: v.key }, vars)}</span>
              </div>
            ))}
            <button type="button" className="hw-btn" disabled={!editing} onClick={addVar}><Variable size={16} /> 자료값 추가</button>
            <section>
              <h3>계산 넣기</h3>
              <label className="hw-field">
                <span>식</span>
                <input value={calc.expr} disabled={!editing} placeholder="{예산} / {인원}" onChange={(e) => setCalc((c) => ({ ...c, expr: e.target.value }))} />
              </label>
              <div className="hw-row">
                <label className="hw-field hw-field--half"><span>단위</span><input value={calc.unit} disabled={!editing} onChange={(e) => setCalc((c) => ({ ...c, unit: e.target.value }))} /></label>
                <label className="hw-field hw-field--half"><span>소수 자리</span>
                  <select value={calc.digits} disabled={!editing} onChange={(e) => setCalc((c) => ({ ...c, digits: e.target.value }))}>{[0, 1, 2].map((d) => <option key={d} value={d}>{d}</option>)}</select>
                </label>
              </div>
              {calc.expr.trim() && <p className="hw-note">미리 보기: {chipText({ calc: calc.expr, unit: calc.unit, digits: calc.digits }, vars)}</p>}
              <button type="button" className="hw-btn" disabled={!editing || !calc.expr.trim()} onClick={insertCalc}><Calculator size={16} /> 본문에 계산 넣기</button>
              <p className="hw-note">자료값 이름을 중괄호로 감싸고 + - * / ( ) 와 숫자만 씁니다.</p>
            </section>
          </>
        )}

        {tab === 'info' && (
          <>
            <section>
              <h3>양식</h3>
              <Pick label="문서 양식" value={settings.preset} options={PRESETS.map((p) => p.key)} render={(k) => PRESETS.find((p) => p.key === k)?.label || k} disabled={!editing} onChange={(v) => update({ preset: v })} />
              <label className="hw-check">
                <input type="checkbox" checked={settings.pageNumbers !== false} disabled={!editing} onChange={(e) => update({ pageNumbers: e.target.checked })} />
                쪽 번호 넣기
              </label>
            </section>
            {settings.preset === '기안문' ? (
              <>
                <section>
                  <h3>두문</h3>
                  {HEAD_FIELDS.map(([k, l]) => <Field key={k} label={l} value={settings.head?.[k]} disabled={!editing} onChange={(v) => update({ head: { ...settings.head, [k]: v } })} />)}
                </section>
                <section>
                  <h3>결문</h3>
                  {FOOT_FIELDS.map(([k, l]) => <Field key={k} label={l} value={settings.foot?.[k]} disabled={!editing} onChange={(v) => update({ foot: { ...settings.foot, [k]: v } })} />)}
                </section>
                <p className="hw-note">{'{자료값 이름}'}을 쓰면 그 값이 들어갑니다. 끝. 표시는 본문 끝에 자동으로 붙습니다.</p>
              </>
            ) : settings.preset === '보도자료' ? (
              <section>
                <h3>보도자료 머리</h3>
                {PRESS_FIELDS.map(([k, l]) => <Field key={k} label={l} value={settings.press?.[k]} disabled={!editing} onChange={(v) => update({ press: { ...settings.press, [k]: v } })} />)}
                <p className="hw-note">{'{자료값 이름}'}을 쓰면 그 값이 들어갑니다.</p>
              </section>
            ) : (
              <p className="hw-note">두문과 결문은 기안문 양식에서 씁니다.</p>
            )}
          </>
        )}

        {tab === 'lint' && (
          <>
            <p className="hw-note">날짜, 시간, 금액 표기와 개조식 문체를 행정업무운영 편람 규칙으로 검사합니다.</p>
            <button type="button" className="hw-btn hw-btn--primary" onClick={onLint} disabled={lint?.loading}><CheckCircle2 size={16} /> {lint?.loading ? '검사 중' : '검사하기'}</button>
            {lint?.error && <p className="hw-err">{lint.error}</p>}
            {lint?.items && lint.items.length === 0 && <p className="hw-ok">고칠 곳이 없습니다.</p>}
            {lint?.items?.map((it, i) => (
              <button key={i} type="button" className="hw-issue" onClick={() => onJump(it.match)}>
                <span className={`hw-sev hw-sev--${it.severity}`}>{it.severity === 'error' ? '고침' : '권고'}</span>
                <span className="hw-issue__msg">{it.message}</span>
                <span className="hw-issue__match">{it.match}</span>
                {it.suggest && <span className="hw-issue__sug">{it.suggest}</span>}
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
