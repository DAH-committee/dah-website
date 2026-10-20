// 오른쪽 패널 다섯 개: 양식 필드, 공문 검사, 버전(신구대조), 개인정보, 내보내기(도장 포함).
// 모두 편집기가 넘긴 ctx 로만 서버와 편집기 상태를 건드린다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Download, Eye, History, LoaderCircle, RotateCcw, ScanSearch, ShieldCheck, Sparkles, Star, Stamp, Wand2 } from 'lucide-react'
import { confirmDialog } from '../../components/common/AppDialog'
import { REDACT_RULES, SEVERITY_KO, errorText, lintFixFor, lintFixOps, pairDiffs, pickFilled, sortFindings, summarizeEdit } from './hwpCore'

const SOURCE_KO = { user: '직접', ai: 'AI', restore: '복원', import: '가져옴' }
const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}. ${d.getDate()}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Empty({ children }) {
  return <p className="hf-empty">{children}</p>
}
function Busy({ children = '불러오는 중' }) {
  return (
    <p className="hf-empty">
      <LoaderCircle size={14} className="hf-spin" /> {children}
    </p>
  )
}

// ───────────────────────── 양식 필드 ─────────────────────────
export function FieldsPanel({ ctx }) {
  const { api, viewVersion, canEdit, jumpTo } = ctx
  const [fields, setFields] = useState(null)
  const [err, setErr] = useState('')
  const [vals, setVals] = useState({})
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    setFields(null)
    setPreview(null)
    api
      .fields(viewVersion)
      .then((r) => live && setFields(r))
      .catch((e) => live && setErr(errorText(e)))
    return () => {
      live = false
    }
  }, [api, viewVersion])
  const filled = useMemo(() => pickFilled(vals), [vals])
  const n = Object.keys(filled).length
  async function dry() {
    setBusy(true)
    setErr('')
    try {
      const { res } = await ctx.runEdit([{ type: 'fill_fields', values: filled }], { dry_run: true })
      setPreview(res)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function apply() {
    setBusy(true)
    setErr('')
    try {
      const { res } = await ctx.runEdit([{ type: 'fill_fields', values: filled }], { note: `양식 ${n}칸 채움` })
      ctx.toast(summarizeEdit(res))
      setPreview(null)
      setVals({})
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  if (err && !fields) return <Empty>{err}</Empty>
  if (!fields) return <Busy />
  const list = fields.fields || []
  if (!list.length) return <Empty>양식 칸을 찾지 못했습니다. 누름틀이나 "성명" 같은 라벨 옆 빈칸이 있는 문서에서 나타납니다.</Empty>
  return (
    <div className="hf-pane">
      <p className="hf-note">칸 {list.length}개{fields.confidence != null && fields.confidence < 0.6 ? ' (찾은 결과가 확실하지 않을 수 있습니다)' : ''}. 값을 넣고 미리보기로 어디가 바뀌는지 확인한 뒤 적용합니다.</p>
      <ul className="hf-list">
        {list.map((f) => (
          <li key={`${f.name}:${f.cell || f.block || ''}`} className="hf-field">
            <button type="button" className="hf-field__name" onClick={() => (f.cell || f.block) && jumpTo({ block: f.block, cell: f.cell })} title="이 칸으로 이동">
              {f.name}
              <em>{f.kind === 'clickhere' ? '누름틀' : '라벨'}</em>
            </button>
            <input
              value={vals[f.name] ?? ''}
              disabled={!canEdit || busy}
              placeholder={f.empty ? f.hint || '비어 있음' : f.value}
              aria-label={`${f.name} 값`}
              onChange={(e) => {
                setPreview(null)
                setVals((v) => ({ ...v, [f.name]: e.target.value }))
              }}
            />
          </li>
        ))}
      </ul>
      {err && <p className="hf-error">{err}</p>}
      {preview && (
        <div className="hf-preview">
          <b>미리보기: {summarizeEdit(preview, { dry: true })}</b>
          <ul>
            {(preview.applied || []).slice(0, 12).map((a, i) => (
              <li key={i}>
                <s>{a.before || '(빈칸)'}</s> <ChevronRight size={12} /> {a.after}
              </li>
            ))}
            {(preview.skipped || []).slice(0, 6).map((s, i) => (
              <li key={`s${i}`} className="is-skip">
                {s.message || s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="hf-actions">
        <button type="button" className="hf-btn" disabled={!canEdit || busy || !n} onClick={dry}>
          미리보기
        </button>
        <button type="button" className="hf-btn hf-btn--primary" disabled={!canEdit || busy || !n || !preview || !(preview.applied || []).length} onClick={apply}>
          {n}칸 적용
        </button>
      </div>
    </div>
  )
}

// ───────────────────────── 공문 검사 ─────────────────────────
export function LintPanel({ ctx }) {
  const { api, canEdit, jumpTo, openAiWith } = ctx
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      setRes(await api.lint({ version: ctx.viewVersion }))
      ctx.setFlagged?.(null)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [api, ctx])
  const list = useMemo(() => sortFindings(res?.findings || []), [res])
  useEffect(() => {
    ctx.setFlagged?.(res ? new Set(list.map((f) => f.block).filter(Boolean)) : null)
    return () => ctx.setFlagged?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res])
  async function fixOne(f) {
    const op = lintFixFor(f, ctx.blocks)
    if (!op) return
    setBusy(true)
    try {
      const { res: r } = await ctx.runEdit([op], { note: `공문 검사: ${f.rule}` })
      ctx.toast(summarizeEdit(r))
      setRes(await api.lint({ version: r.version }))
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function fixAll() {
    const ops = lintFixOps(list, ctx.blocks)
    if (!ops.length) return
    setBusy(true)
    try {
      const { res: r } = await ctx.runEdit(ops, { note: `공문 검사: ${ops.length}곳 고침` })
      ctx.toast(summarizeEdit(r))
      setRes(await api.lint({ version: r.version }))
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const fixable = lintFixOps(list, ctx.blocks).length
  return (
    <div className="hf-pane">
      <div className="hf-actions hf-actions--top">
        <button type="button" className="hf-btn hf-btn--primary" onClick={run} disabled={busy}>
          {busy ? <LoaderCircle size={14} className="hf-spin" /> : <ScanSearch size={14} />} 공문 검사
        </button>
        {canEdit && fixable > 0 && (
          <button type="button" className="hf-btn" onClick={fixAll} disabled={busy}>
            <Wand2 size={14} /> 고칠 수 있는 {fixable}곳 모두 고치기
          </button>
        )}
      </div>
      {err && <p className="hf-error">{err}</p>}
      {!res && !busy && <Empty>날짜, 시각, 붙임, 끝 표시, 항목부호 같은 공문서 표기를 검사합니다.</Empty>}
      {res && (
        <>
          <p className="hf-note">
            {list.length ? `${list.length}건` : '지적 없음'} {res.counts ? `(오류 ${res.counts.error || 0}, 주의 ${res.counts.warn || 0}, 참고 ${res.counts.info || 0})` : ''}
          </p>
          <ul className="hf-list">
            {list.map((f, i) => (
              <li key={i} className={`hf-lint hf-lint--${f.severity}`}>
                <div className="hf-lint__head">
                  <span className="hf-pill">{SEVERITY_KO[f.severity] || f.severity}</span>
                  <button type="button" className="hf-link" onClick={() => f.block && jumpTo({ block: f.block, cell: f.cell })}>
                    {f.rule}
                  </button>
                </div>
                <p>{f.message}</p>
                {f.match && (
                  <p className="hf-diffline">
                    <s>{f.match}</s>
                    {f.suggest ? <em>{f.suggest}</em> : null}
                  </p>
                )}
                <div className="hf-actions hf-actions--row">
                  {canEdit && lintFixFor(f, ctx.blocks) && (
                    <button type="button" className="hf-btn hf-btn--sm" disabled={busy} onClick={() => fixOne(f)}>
                      고치기
                    </button>
                  )}
                  <button type="button" className="hf-btn hf-btn--sm" onClick={() => openAiWith(`공문 검사 지적을 고쳐 줘. 블록 ${f.cell || f.block}: ${f.rule} - ${f.message}${f.match ? ` (지금 글: ${String(f.match).slice(0, 60)})` : ''}`)}>
                    <Sparkles size={12} /> AI에게
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ───────────────────────── 버전, 신구대조 ─────────────────────────
export function VersionsPanel({ ctx }) {
  const { api, current, viewVersion, canEdit } = ctx
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [cmp, setCmp] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    api
      .versions()
      .then((r) => setList(r.items || []))
      .catch((e) => setErr(errorText(e)))
  }, [api])
  useEffect(() => {
    load()
  }, [load, current])
  async function compare(v) {
    setBusy(true)
    setErr('')
    try {
      // 신구대조: 옛 버전(v) -> 지금(current). before 는 옛 글, after 는 지금 글
      const r = await api.compare(current, v)
      const diffs = pairDiffs(r.diffs)
      setCmp({ ...r, diffs, against: v, stats: { added: diffs.filter((d) => d.type === 'added').length, removed: diffs.filter((d) => d.type === 'removed').length, modified: diffs.filter((d) => d.type === 'modified').length } })
      ctx.setChanged(new Map(diffs.filter((d) => d.block).map((d) => [d.block, d.type])))
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  useEffect(() => () => ctxRef.current.setChanged(new Map()), [])
  async function restore(v) {
    if (!(await confirmDialog({ title: '이 버전으로 되돌리기', message: `v${v} 내용으로 되돌립니다. 지금 상태도 버전 기록에 남습니다.`, confirmLabel: '되돌리기' }))) return
    try {
      await ctx.restoreVersion(v)
      ctx.toast(`v${v} 내용으로 되돌렸습니다`)
      setCmp(null)
      ctx.setChanged(new Map())
    } catch (e) {
      setErr(errorText(e))
    }
  }
  async function star(v) {
    try {
      await api.star(v.version, !v.starred)
      load()
    } catch (e) {
      setErr(errorText(e))
    }
  }
  if (err && !list) return <Empty>{err}</Empty>
  if (!list) return <Busy />
  return (
    <div className="hf-pane">
      {err && <p className="hf-error">{err}</p>}
      <ul className="hf-list">
        {list.map((v) => (
          <li key={v.version} className={`hf-ver${v.version === viewVersion ? ' is-on' : ''}`}>
            <div className="hf-ver__head">
              <b>v{v.version}</b>
              {v.version === current && <span className="hf-pill hf-pill--cur">현재</span>}
              <span className="hf-ver__src">{SOURCE_KO[v.source] || v.source}</span>
              <span className="hf-ver__time">{fmtTime(v.created_at)}</span>
              <button type="button" className={`hf-iconbtn${v.starred ? ' is-on' : ''}`} aria-label={v.starred ? '별표 해제' : '별표'} title="별표를 달면 오래돼도 지워지지 않습니다" onClick={() => star(v)}>
                <Star size={14} />
              </button>
            </div>
            <p className="hf-ver__note">
              {v.note || '(설명 없음)'}
              {v.created_by ? ` · ${v.created_by}` : ''}
            </p>
            {v.version !== current && (
              <div className="hf-actions hf-actions--row">
                <button type="button" className="hf-btn hf-btn--sm" onClick={() => ctx.previewVersion(v.version === viewVersion ? null : v.version)}>
                  <Eye size={12} /> {v.version === viewVersion ? '보기 끝' : '보기'}
                </button>
                <button type="button" className="hf-btn hf-btn--sm" disabled={busy} onClick={() => compare(v.version)}>
                  <History size={12} /> 신구대조
                </button>
                {canEdit && (
                  <button type="button" className="hf-btn hf-btn--sm" onClick={() => restore(v.version)}>
                    <RotateCcw size={12} /> 복원
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {cmp && (
        <div className="hf-cmp">
          <b>
            v{cmp.against} 에서 지금까지: 바뀜 {cmp.stats?.modified ?? 0}, 추가 {cmp.stats?.added ?? 0}, 삭제 {cmp.stats?.removed ?? 0}
          </b>
          <ul>
            {(cmp.diffs || []).slice(0, 40).map((d, i) => (
              <li key={i} className={`hf-cmp__row hf-cmp__row--${d.type}`}>
                <button type="button" className="hf-link" onClick={() => d.block && ctx.jumpTo({ block: d.block })}>
                  {d.block || '표'} · {{ added: '추가', removed: '삭제', modified: '수정' }[d.type] || d.type}
                </button>
                {d.before != null && <s>{String(d.before).slice(0, 120)}</s>}
                {d.after != null && <em>{String(d.after).slice(0, 120)}</em>}
                {(d.cells || []).slice(0, 4).map((c, j) => (
                  <span key={j} className="hf-cmp__cell">
                    {c.row + 1}행 {c.col + 1}열: <s>{String(c.before ?? '').slice(0, 30)}</s> <em>{String(c.after ?? '').slice(0, 30)}</em>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <button type="button" className="hf-btn hf-btn--sm" onClick={() => { setCmp(null); ctx.setChanged(new Map()) }}>
            비교 닫기
          </button>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 개인정보 ─────────────────────────
export function RedactPanel({ ctx }) {
  const { api, canEdit, current } = ctx
  const [rules, setRules] = useState(() => new Set(REDACT_RULES.slice(0, 3).map((r) => r.id)))
  const [hits, setHits] = useState(null)
  const [dryCount, setDryCount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const ruleList = [...rules]
  async function scan() {
    setBusy(true)
    setErr('')
    setDone('')
    try {
      const [sug, pre] = await Promise.all([api.redactionSuggest(current), ctx.runEdit([{ type: 'redact', rules: ruleList, dry_run: true }], { dry_run: true }).catch(() => null)])
      setHits(sug.hits || [])
      setDryCount(pre?.res?.applied?.length ?? null)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function apply() {
    if (!(await confirmDialog({ title: '개인정보 가리기', message: '개인정보로 찾은 곳을 모두 가립니다. 이미지 속 글자는 가려지지 않습니다. 버전 기록에서 되돌릴 수 있습니다.', confirmLabel: '가리기' }))) return
    setBusy(true)
    setErr('')
    try {
      const { res } = await ctx.runEdit([{ type: 'redact', rules: ruleList }], { note: '개인정보 가림' })
      setDone(`${res.applied?.length || 0}곳을 가렸습니다. 이미지 속 글자는 직접 확인하세요.`)
      setHits(null)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const byRule = useMemo(() => {
    const m = {}
    for (const h of hits || []) m[h.rule] = (m[h.rule] || 0) + 1
    return m
  }, [hits])
  return (
    <div className="hf-pane">
      <p className="hf-note">가릴 종류를 고르고 찾아본 뒤, 미리보기를 확인하고 가립니다. 자동 검출은 보조 도구라 결과를 눈으로 확인해야 합니다.</p>
      <div className="hf-checks">
        {REDACT_RULES.slice(0, 3).map((r) => (
          <label key={r.id}>
            <input
              type="checkbox"
              checked={rules.has(r.id)}
              onChange={(e) =>
                setRules((s) => {
                  const n = new Set(s)
                  if (e.target.checked) n.add(r.id)
                  else n.delete(r.id)
                  return n
                })
              }
            />
            {r.label}
          </label>
        ))}
      </div>
      <div className="hf-actions hf-actions--top">
        <button type="button" className="hf-btn hf-btn--primary" onClick={scan} disabled={busy || !rules.size}>
          {busy ? <LoaderCircle size={14} className="hf-spin" /> : <ShieldCheck size={14} />} 개인정보 찾기
        </button>
      </div>
      {err && <p className="hf-error">{err}</p>}
      {done && <p className="hf-note hf-note--ok">{done}</p>}
      {hits && (
        <>
          <p className="hf-note">
            후보 {hits.length}곳{dryCount != null ? ` (가려질 곳 ${dryCount})` : ''} · {Object.entries(byRule).map(([k, v]) => `${REDACT_RULES.find((r) => r.id === k)?.label || k} ${v}`).join(', ') || '없음'}
          </p>
          <ul className="hf-list">
            {hits.slice(0, 60).map((h, i) => (
              <li key={i} className="hf-hit-row">
                <button type="button" className="hf-link" onClick={() => ctx.jumpTo({ block: h.block, cell: h.cell })}>
                  {REDACT_RULES.find((r) => r.id === h.rule)?.label || h.rule}
                </button>
                <code>{h.preview}</code>
              </li>
            ))}
          </ul>
          <div className="hf-actions">
            <button type="button" className="hf-btn hf-btn--primary" disabled={!canEdit || busy || !hits.length} onClick={apply}>
              {hits.length}곳 가리기
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ───────────────────────── 내보내기, 도장 ─────────────────────────
export function ExportPanel({ ctx }) {
  const { info, canEdit } = ctx
  const [anchor, setAnchor] = useState('(인)')
  const [mm, setMm] = useState(20)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const file = useRef(null)
  const original = info?.format === 'hwp' ? 'hwp' : 'hwpx'
  const rows = [
    { f: original, label: `한글(${original.toUpperCase()}) 원본 형식`, sub: '서식 그대로' },
    { f: 'docx', label: '워드(DOCX)', sub: '변환본' },
    { f: 'pdf', label: 'PDF', sub: '쪽 그림으로 만듭니다' },
    { f: 'md', label: '마크다운(MD)', sub: '글만' },
    { f: 'txt', label: '텍스트(TXT)', sub: '글만' },
  ]
  function pick(f) {
    const r = f?.[0]
    if (!r) return
    if (!/^image\/(png|jpeg)$/.test(r.type)) return setErr('PNG 나 JPEG 이미지를 올려 주세요')
    const fr = new FileReader()
    fr.onload = () => {
      ctx.setSeal(String(fr.result))
      setErr('')
    }
    fr.readAsDataURL(r)
  }
  async function place() {
    setBusy(true)
    setErr('')
    try {
      const { res } = await ctx.runEdit([{ type: 'place_seal', image: ctx.seal, anchor: anchor.trim(), width_mm: Math.max(8, Math.min(40, Number(mm) || 20)) }], { note: `${anchor} 자리에 도장` })
      ctx.toast(summarizeEdit(res) + ' (위치는 근사치입니다)')
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="hf-pane">
      <ul className="hf-list">
        {rows.map((r) => (
          <li key={r.f}>
            <button type="button" className="hf-export" onClick={() => ctx.download(r.f).catch((e) => setErr(errorText(e)))}>
              <Download size={16} />
              <span>
                {r.label}
                <small>{r.sub}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {ctx.viewVersion !== ctx.current && <p className="hf-note">지난 버전 v{ctx.viewVersion} 을 내려받습니다.</p>}
      <h3 className="hf-h3">
        <Stamp size={14} /> 도장
      </h3>
      <p className="hf-note">도장 이미지를 올리고, 찍을 자리의 글자(예: (인))를 적으면 그 자리에 넣습니다. 위치는 근사치라 쪽 그림으로 확인하세요. HWPX 파일만 됩니다.</p>
      <input ref={file} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
      <div className="hf-seal">
        {ctx.seal ? <img src={ctx.seal} alt="올린 도장" /> : <span>이미지 없음</span>}
        <button type="button" className="hf-btn hf-btn--sm" onClick={() => file.current?.click()}>
          이미지 올리기
        </button>
      </div>
      <div className="hf-seal__row">
        <label>
          자리 글자
          <input value={anchor} onChange={(e) => setAnchor(e.target.value)} maxLength={20} aria-label="도장을 찍을 자리 글자" />
        </label>
        <label>
          너비(mm)
          <input type="number" min={8} max={40} value={mm} onChange={(e) => setMm(e.target.value)} aria-label="도장 너비(mm)" />
        </label>
      </div>
      {err && <p className="hf-error">{err}</p>}
      <div className="hf-actions">
        <button type="button" className="hf-btn hf-btn--primary" disabled={!canEdit || busy || !ctx.seal || !anchor.trim() || info?.format === 'hwp'} onClick={place}>
          {busy ? <LoaderCircle size={14} className="hf-spin" /> : <Check size={14} />} 도장 찍기
        </button>
      </div>
    </div>
  )
}
