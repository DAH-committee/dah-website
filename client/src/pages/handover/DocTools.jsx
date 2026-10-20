// 문서 편집기 도구: 떠 있는 표 도구 막대, 그림 도구 막대, 색 고르기.
// 막대는 표 안에 커서가 있을 때, 그림을 골랐을 때만 나타난다. 선·테두리 없이 채움과 옅은 그림자만 쓴다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NodeSelection } from '@tiptap/pm/state'
import {
  AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  BetweenHorizontalStart, BetweenVerticalStart, Columns3, Grid2x2, PaintBucket, Rows3, TableCellsMerge, TableCellsSplit,
  Trash2, X, Ruler, Heading, Maximize,
} from 'lucide-react'
import { applyBorders, distributeColumns, setCellProps, setRowHeight, setRowRepeat, setTableAttrs, tableInfo } from './tableOps'
import { toHex } from './docExtensions'

const FILL_COLORS = [
  '#FFEA00', '#FFB300', '#FF1744', '#00E676', '#7A3CFF', '#2979FF', '#00E5FF', '#FF9100',
  '#F2F2F2', '#D9D9D9', '#BFBFBF', '#808080', '#404040', '#000000', '#FFFFFF',
]

// 화면 고정 위치로 띄우는 작은 창(도구 막대 영역에 잘리지 않게)
function Pop({ trigger, children, title, active, wide }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = (e) => { if (!btn.current?.contains(e.target) && !panel.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const toggle = () => {
    const r = btn.current.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - (wide ? 296 : 240) - 8)) })
    setOpen((v) => !v)
  }
  return (
    <>
      <button ref={btn} type="button" className={`dt-btn${active || open ? ' is-active' : ''}`} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>{trigger}</button>
      {open && createPortal(
        <div ref={panel} className={`dt-pop${wide ? ' dt-pop--wide' : ''}`} style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => { if (!/INPUT|SELECT/.test(e.target.tagName)) e.preventDefault() }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>,
        document.body
      )}
    </>
  )
}

const Btn = ({ icon: I, label, onClick, disabled, active }) => (
  <button type="button" className={`dt-btn${active ? ' is-active' : ''}`} title={label} aria-label={label} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
    <I size={17} strokeWidth={1.8} />
  </button>
)

export function ColorPicker({ value, onPick, onNone, noneLabel = '없음' }) {
  const [hex, setHex] = useState(value || '')
  useEffect(() => setHex(value || ''), [value])
  const commit = () => { const h = toHex(hex.startsWith('#') ? hex : `#${hex}`); if (h) onPick(h) }
  return (
    <div className="dt-colors">
      {onNone && <button type="button" className="dt-colors__none" onClick={onNone}><X size={14} /> {noneLabel}</button>}
      <div className="dt-colors__grid">
        {FILL_COLORS.map((c) => <button key={c} type="button" title={c} className={value && value.toUpperCase() === c ? 'is-sel' : ''} style={{ background: c }} onClick={() => onPick(c)} />)}
      </div>
      <label className="dt-hex">
        <span>직접 입력</span>
        <input value={hex} placeholder="#C5CCEA" maxLength={7} onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} onBlur={commit} />
        <input type="color" aria-label="색 선택기" value={toHex(hex) || '#ffffff'} onChange={(e) => onPick(e.target.value.toUpperCase())} />
      </label>
    </div>
  )
}

const BORDER_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3]
const BORDER_STYLES = [['solid', '실선'], ['dashed', '파선'], ['dotted', '점선'], ['double', '이중선']]

function useTick(editor) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!editor) return undefined
    const h = () => setN((n) => n + 1)
    editor.on('transaction', h)
    editor.on('selectionUpdate', h)
    return () => { editor.off('transaction', h); editor.off('selectionUpdate', h) }
  }, [editor])
}

// 도구 막대의 위치: 표(또는 그림) 위. 화면 위쪽에 가려지면 화면 위쪽에 붙인다
function useAnchor(editor, getPos, enabled) {
  const [box, setBox] = useState(null)
  const calc = useCallback(() => {
    if (!enabled) { setBox((b) => (b ? null : b)); return }
    const p = getPos()
    const dom = p == null ? null : editor.view.nodeDOM(p)
    if (!dom || !dom.getBoundingClientRect) { setBox((b) => (b ? null : b)); return }
    const r = dom.getBoundingClientRect()
    setBox((b) => (b && Math.abs(b.top - r.top) < 0.5 && Math.abs(b.left - r.left) < 0.5 && Math.abs(b.width - r.width) < 0.5 ? b : { top: r.top, left: r.left, width: r.width, bottom: r.bottom }))
  }, [editor, getPos, enabled])
  useLayoutEffect(() => { calc() })
  useEffect(() => {
    if (!enabled) return undefined
    const sc = document.querySelector('.gd-scroll')
    window.addEventListener('resize', calc)
    sc?.addEventListener('scroll', calc, { passive: true })
    return () => { window.removeEventListener('resize', calc); sc?.removeEventListener('scroll', calc) }
  }, [calc, enabled])
  return box
}

// 막대는 눈금자 줄 위에 앉힌다(표·그림 바로 위에 두면 앞 문단을 가려 누를 수 없다). 눈금자가 없으면 화면 위쪽에 붙인다
function place(box, barW = 760, barH = 38) {
  const ruler = document.querySelector('.gd-ruler')?.getBoundingClientRect()
  const pg = document.querySelector('.gd-page')?.getBoundingClientRect()
  const top = ruler && ruler.height > 10 ? ruler.top + Math.max(0, (ruler.height - barH) / 2) : Math.min(Math.max(box.top - barH - 8, 100), window.innerHeight - barH - 12)
  const left = Math.max(8, Math.min(pg ? pg.left : box.left, window.innerWidth - barW - 8))
  return { top, left }
}

export function TableToolbar({ editor, editing, flash }) {
  useTick(editor)
  const info = editing && editor ? tableInfo(editor) : null
  const [bspec, setBspec] = useState({ style: 'solid', width: 0.75, color: '#000000' })
  const box = useAnchor(editor, () => (editor && tableInfo(editor) ? tableInfo(editor).tablePos : null), !!info)
  if (!info || !box) return null
  const ca = info.cellAttrs
  const c = () => editor.chain().focus()
  const can = (name) => { try { return editor.can()[name]() } catch { return false } }
  const hPt = info.rowAttrs.height ? Math.round(info.rowAttrs.height * 0.75 * 10) / 10 : ''
  const st = place(box)
  return createPortal(
    <div className="dt-bar" style={{ top: st.top, left: st.left }} role="toolbar" aria-label="표 도구" onMouseDown={(e) => { if (!/INPUT|SELECT/.test(e.target.tagName)) e.preventDefault() }}>
      <Btn icon={BetweenHorizontalStart} label="위에 행 추가" onClick={() => c().addRowBefore().run()} />
      <Btn icon={Rows3} label="아래에 행 추가" onClick={() => c().addRowAfter().run()} />
      <Btn icon={BetweenVerticalStart} label="왼쪽에 열 추가" onClick={() => c().addColumnBefore().run()} />
      <Btn icon={Columns3} label="오른쪽에 열 추가" onClick={() => c().addColumnAfter().run()} />
      <button type="button" className="dt-txt" onMouseDown={(e) => e.preventDefault()} onClick={() => c().deleteRow().run()}>행 삭제</button>
      <button type="button" className="dt-txt" onMouseDown={(e) => e.preventDefault()} onClick={() => c().deleteColumn().run()}>열 삭제</button>
      <span className="dt-sep" />
      <Btn icon={TableCellsMerge} label="칸 합치기" disabled={!can('mergeCells')} onClick={() => c().mergeCells().run()} />
      <Btn icon={TableCellsSplit} label="칸 나누기" disabled={!can('splitCell')} onClick={() => c().splitCell().run()} />
      <Btn icon={Heading} label="제목 행 켜기·끄기" active={info.headerRow} onClick={() => c().toggleHeaderRow().run()} />
      <span className="dt-sep" />
      <Pop title="칸 채우기" trigger={<span className="dt-fill"><PaintBucket size={17} strokeWidth={1.8} /><i style={{ background: ca.background || '#FFFFFF' }} /></span>}>
        {(close) => <ColorPicker value={ca.background} onPick={(h) => { setCellProps(editor, { background: h }); close() }} onNone={() => { setCellProps(editor, { background: null }); close() }} />}
      </Pop>
      <Btn icon={AlignVerticalJustifyStart} label="위쪽 맞춤" active={ca.verticalAlign === 'top'} onClick={() => setCellProps(editor, { verticalAlign: 'top' })} />
      <Btn icon={AlignVerticalJustifyCenter} label="가운데 맞춤" active={ca.verticalAlign === 'middle'} onClick={() => setCellProps(editor, { verticalAlign: 'middle' })} />
      <Btn icon={AlignVerticalJustifyEnd} label="아래쪽 맞춤" active={ca.verticalAlign === 'bottom'} onClick={() => setCellProps(editor, { verticalAlign: 'bottom' })} />
      <span className="dt-sep" />
      <Pop wide title="선" trigger={<Grid2x2 size={17} strokeWidth={1.8} />}>
        {() => (
          <div className="dt-bpanel">
            <p className="dt-cap">{info.multi ? '선택한 칸에 적용' : '표 전체에 적용(칸을 끌어 선택하면 그 칸만)'}</p>
            <div className="dt-bgrid">
              {[['all', '모두'], ['outer', '바깥'], ['inner', '안쪽'], ['none', '없음'], ['header-bottom', '제목 아래'], ['top', '위'], ['bottom', '아래'], ['left', '왼쪽'], ['right', '오른쪽']].map(([m, l]) => (
                <button key={m} type="button" className="dt-chip" onClick={() => applyBorders(editor, m, bspec)}>{l}</button>
              ))}
            </div>
            <div className="dt-row">
              <label>굵기<select value={bspec.width} onChange={(e) => setBspec({ ...bspec, width: Number(e.target.value) })}>{BORDER_WIDTHS.map((w) => <option key={w} value={w}>{w}pt</option>)}</select></label>
              <label>종류<select value={bspec.style} onChange={(e) => setBspec({ ...bspec, style: e.target.value })}>{BORDER_STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            </div>
            <p className="dt-cap">색</p>
            <ColorPicker value={bspec.color} onPick={(h) => setBspec({ ...bspec, color: h })} />
          </div>
        )}
      </Pop>
      <Pop title="행 높이와 열 너비" trigger={<Ruler size={17} strokeWidth={1.8} />}>
        {(close) => (
          <div className="dt-bpanel">
            <label className="dt-field">행 높이(pt)<input type="number" min="0" step="1" defaultValue={hPt} placeholder="자동" onKeyDown={(e) => { if (e.key === 'Enter') { setRowHeight(editor, Math.round((Number(e.currentTarget.value) || 0) / 0.75 * 100) / 100); close() } }} onBlur={(e) => setRowHeight(editor, Math.round((Number(e.currentTarget.value) || 0) / 0.75 * 100) / 100)} /></label>
            <button type="button" className="dt-chip dt-chip--wide" onClick={() => { distributeColumns(editor); close() }}>열 너비 같게</button>
            <button type="button" className="dt-chip dt-chip--wide" onClick={() => { setRowRepeat(editor, !info.rowAttrs.header); close() }}>{info.rowAttrs.header ? '쪽마다 제목 행 반복 끄기' : '쪽마다 이 행 반복'}</button>
          </div>
        )}
      </Pop>
      <Btn icon={AlignLeft} label="표 왼쪽 맞춤" active={!info.tableAttrs.align} onClick={() => setTableAttrs(editor, { align: null })} />
      <Btn icon={AlignCenter} label="표 가운데 맞춤" active={info.tableAttrs.align === 'center'} onClick={() => setTableAttrs(editor, { align: 'center' })} />
      <Btn icon={AlignRight} label="표 오른쪽 맞춤" active={info.tableAttrs.align === 'right'} onClick={() => setTableAttrs(editor, { align: 'right' })} />
      <span className="dt-sep" />
      <Btn icon={Trash2} label="표 삭제" onClick={() => { c().deleteTable().run(); flash?.('표를 삭제했습니다') }} />
    </div>,
    document.body
  )
}

// ── 그림 도구 ──
const MM = 96 / 25.4
export function ImageToolbar({ editor, editing }) {
  useTick(editor)
  const sel = editing && editor ? editor.state.selection : null
  const isImg = sel instanceof NodeSelection && sel.node.type.name === 'image'
  const box = useAnchor(editor, () => (editor.state.selection instanceof NodeSelection ? editor.state.selection.from : null), !!isImg)
  if (!isImg || !box) return null
  const a = sel.node.attrs
  const dom = editor.view.nodeDOM(sel.from)
  const natural = dom?.naturalWidth && dom?.naturalHeight ? dom.naturalHeight / dom.naturalWidth : 0.6
  const curW = a.width || Math.round(dom?.getBoundingClientRect().width || 300)
  const curH = a.height || Math.round(curW * natural)
  const upd = (patch) => editor.chain().focus().updateAttributes('image', patch).run()
  const setW = (mm) => {
    const w = Math.max(10, Math.round(Number(mm) * MM))
    if (!Number.isFinite(w)) return
    upd({ width: w, height: Math.round(w * (curH / curW || natural)) })
  }
  const st = place(box, 640)
  return createPortal(
    <div className="dt-bar" style={{ top: st.top, left: st.left }} role="toolbar" aria-label="그림 도구" onMouseDown={(e) => { if (!/INPUT|SELECT/.test(e.target.tagName)) e.preventDefault() }}>
      <label className="dt-num">너비(mm)<input type="number" min="5" step="1" key={`w${curW}`} defaultValue={Math.round(curW / MM)} onKeyDown={(e) => e.key === 'Enter' && setW(e.currentTarget.value)} onBlur={(e) => setW(e.currentTarget.value)} /></label>
      <label className="dt-num">높이(mm)<input type="number" min="5" step="1" key={`h${curH}`} defaultValue={Math.round(curH / MM)} onKeyDown={(e) => { if (e.key === 'Enter') upd({ height: Math.max(10, Math.round(Number(e.currentTarget.value) * MM)) }) }} onBlur={(e) => upd({ height: Math.max(10, Math.round(Number(e.currentTarget.value) * MM)) })} /></label>
      <Btn icon={Maximize} label="원래 비율로" onClick={() => upd({ height: Math.round(curW * natural) })} />
      <span className="dt-sep" />
      <Btn icon={AlignLeft} label="왼쪽" active={a.align === 'left' || !a.align} onClick={() => upd({ align: 'left' })} />
      <Btn icon={AlignCenter} label="가운데" active={a.align === 'center'} onClick={() => upd({ align: 'center' })} />
      <Btn icon={AlignRight} label="오른쪽" active={a.align === 'right'} onClick={() => upd({ align: 'right' })} />
      <span className="dt-sep" />
      {[['block', '줄 바꿈'], ['inline', '글자처럼'], ['right', '오른쪽 띄움']].map(([v, l]) => (
        <button key={v} type="button" className={`dt-txt${(a.wrap || 'block') === v ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => upd(v === 'right' ? { wrap: 'right', align: 'right' } : { wrap: v })} title={l}>{l}</button>
      ))}
      <span className="dt-sep" />
      <label className="dt-num dt-num--alt">대체 글<input type="text" key={`alt${a.alt}`} defaultValue={a.alt || ''} placeholder="그림 설명" onBlur={(e) => upd({ alt: e.currentTarget.value || null })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
      <Btn icon={Trash2} label="그림 삭제" onClick={() => editor.chain().focus().deleteSelection().run()} />
    </div>,
    document.body
  )
}
