// 쪽 설정 대화상자: 용지, 방향, 여백, 머리말·꼬리말(글, 로고 그림), 쪽 번호.
// content.page 에 저장된다(모양은 lib/docIR/tiptapToIR.js normPage). 크기가 변하지 않도록 본문 높이를 고정하고 안쪽만 스크롤한다.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { PAGE_SIZES_MM } from '../../lib/docIR/schema'
import { normPage } from '../../lib/docIR/tiptapToIR'

const SIZES = [['A4', 'A4 (210 x 297)'], ['B5', 'B5 (176 x 250)'], ['Letter', 'Letter (216 x 279)'], ['A3', 'A3 (297 x 420)']]
const ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]

function Seg({ value, options, onChange }) {
  return (
    <div className="ps-seg" role="group">
      {options.map(([v, l]) => (
        <button key={v} type="button" className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

function Num({ label, value, onChange, min = 0, max = 100, step = 1 }) {
  return (
    <label className="ps-num">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    </label>
  )
}

function HeadFoot({ title, spec, onChange, upload }) {
  const file = useRef(null)
  const [busy, setBusy] = useState(false)
  const pick = async (f) => {
    if (!f) return
    setBusy(true)
    try {
      const url = await upload(f)
      onChange({ ...spec, image: { src: url, wPt: spec.image?.wPt || 90, align: spec.image?.align || 'right' } })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ps-sec">
      <h3>{title}</h3>
      <div className="ps-line">
        <input className="ps-text" value={spec.text} placeholder="글 (비워 두면 없음)" onChange={(e) => onChange({ ...spec, text: e.target.value })} />
        <Seg value={spec.align} options={ALIGNS} onChange={(v) => onChange({ ...spec, align: v })} />
      </div>
      <div className="ps-line">
        {spec.image ? (
          <>
            <img className="ps-logo" src={spec.image.src} alt="로고 미리보기" />
            <Num label="그림 너비(mm)" value={Math.round(((spec.image.wPt || 90) * 25.4) / 72)} min={5} max={150} onChange={(v) => onChange({ ...spec, image: { ...spec.image, wPt: ((Number(v) || 30) * 72) / 25.4, hPt: undefined } })} />
            <Seg value={spec.image.align || 'right'} options={ALIGNS} onChange={(v) => onChange({ ...spec, image: { ...spec.image, align: v } })} />
            <button type="button" className="ps-icon" aria-label="그림 지우기" title="그림 지우기" onClick={() => onChange({ ...spec, image: null })}><Trash2 size={16} /></button>
          </>
        ) : (
          <button type="button" className="ps-ghost" disabled={busy} onClick={() => file.current?.click()}><ImagePlus size={16} /> {busy ? '올리는 중' : '로고 그림 넣기'}</button>
        )}
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; pick(f) }} />
      </div>
    </div>
  )
}

export default function PageSetupDialog({ value, presetPage, hwpOn, onApply, onClose, upload }) {
  const [d, setD] = useState(() => normPage(value, hwpOn ? presetPage : null))
  const ref = useRef(null)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  const m = d.marginMm
  const setM = (k, v) => setD({ ...d, marginMm: { ...m, [k]: v } })
  const dims = typeof d.size === 'object' ? d.size : PAGE_SIZES_MM[d.size] || PAGE_SIZES_MM.A4
  const w = d.orientation === 'landscape' ? Math.max(dims.wMm, dims.hMm) : Math.min(dims.wMm, dims.hMm)
  const h = d.orientation === 'landscape' ? Math.min(dims.wMm, dims.hMm) : Math.max(dims.wMm, dims.hMm)
  const bodyW = Math.round((w - (Number(m.left) || 0) - (Number(m.right) || 0)) * 10) / 10
  const bad = bodyW < 30 || h - (Number(m.top) || 0) - (Number(m.bottom) || 0) < 30
  const scale = 96 / Math.max(w, h)
  const apply = () => {
    const clean = normPage({ ...d, marginMm: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v) || 0])) }, null)
    onApply(clean)
  }
  return createPortal(
    <div className="ps-root" role="presentation">
      <button type="button" className="ps-back" aria-label="닫기" tabIndex={-1} onClick={onClose} />
      <div className="ps-panel" role="dialog" aria-modal="true" aria-label="쪽 설정" ref={ref} tabIndex={-1}>
        <header>
          <h2>쪽 설정</h2>
          <button type="button" className="ps-icon" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="ps-body">
          <div className="ps-sec ps-sec--top">
            <div>
              <h3>용지</h3>
              <select className="ps-select" value={typeof d.size === 'object' ? 'custom' : d.size} onChange={(e) => e.target.value !== 'custom' && setD({ ...d, size: e.target.value })}>
                {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {typeof d.size === 'object' && <option value="custom">{`사용자 지정 (${Math.round(dims.wMm)} x ${Math.round(dims.hMm)})`}</option>}
              </select>
              <Seg value={d.orientation} options={[['portrait', '세로'], ['landscape', '가로']]} onChange={(v) => setD({ ...d, orientation: v })} />
            </div>
            <div className="ps-preview" aria-hidden="true" style={{ width: w * scale * 0.6, height: h * scale * 0.6 }}>
              <div style={{ inset: `${(Number(m.top) || 0) * scale * 0.6}px ${(Number(m.right) || 0) * scale * 0.6}px ${(Number(m.bottom) || 0) * scale * 0.6}px ${(Number(m.left) || 0) * scale * 0.6}px` }} />
            </div>
          </div>
          <div className="ps-sec">
            <h3>여백 (mm)</h3>
            <div className="ps-grid">
              <Num label="위" value={m.top} max={100} onChange={(v) => setM('top', v)} />
              <Num label="아래" value={m.bottom} max={100} onChange={(v) => setM('bottom', v)} />
              <Num label="왼쪽" value={m.left} max={100} onChange={(v) => setM('left', v)} />
              <Num label="오른쪽" value={m.right} max={100} onChange={(v) => setM('right', v)} />
              <Num label="머리말 거리" value={d.headerMm} max={50} onChange={(v) => setD({ ...d, headerMm: v })} />
              <Num label="꼬리말 거리" value={d.footerMm} max={50} onChange={(v) => setD({ ...d, footerMm: v })} />
            </div>
            <p className={`ps-note${bad ? ' is-bad' : ''}`}>{bad ? '여백이 너무 커서 본문이 남지 않습니다' : `본문 폭 ${bodyW}mm`}</p>
          </div>
          <div className="ps-sec">
            <h3>쪽 번호</h3>
            <div className="ps-line">
              <Seg value={d.pageNumbers.on ? 'on' : 'off'} options={[['off', '넣지 않음'], ['on', '넣기']]} onChange={(v) => setD({ ...d, pageNumbers: { ...d.pageNumbers, on: v === 'on' } })} />
              {d.pageNumbers.on && <Seg value={d.pageNumbers.pos} options={ALIGNS} onChange={(v) => setD({ ...d, pageNumbers: { ...d.pageNumbers, pos: v } })} />}
            </div>
          </div>
          <HeadFoot title="머리말" spec={d.header} onChange={(s) => setD({ ...d, header: s })} upload={upload} />
          <HeadFoot title="꼬리말" spec={d.footer} onChange={(s) => setD({ ...d, footer: s })} upload={upload} />
        </div>
        <footer>
          {hwpOn && presetPage && <button type="button" className="ps-ghost" onClick={() => setD(normPage(null, presetPage))}>양식 기본값으로</button>}
          <span className="ps-grow" />
          <button type="button" className="ps-ghost" onClick={onClose}>취소</button>
          <button type="button" className="ps-ok" disabled={bad} onClick={apply}>적용</button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
