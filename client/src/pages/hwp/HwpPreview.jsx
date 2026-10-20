// 한글 미리보기: 서버가 만든 HWPX 를 kordoc 조판 엔진으로 그린 쪽 그림(SVG)을 보여 준다.
// SVG 는 그림(img)으로 넣어 문서 안 글이 화면 스크립트로 실행되지 않게 한다.
import { useEffect, useMemo } from 'react'
import { Download, X } from 'lucide-react'
import { splitPages } from './hwpExport'

export default function HwpPreview({ state, onClose, onSave }) {
  const pages = useMemo(() => (state?.pages?.length ? state.pages : state?.svg ? splitPages(state.svg, state) : []), [state])
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="hw-prev" role="dialog" aria-label="한글 미리보기">
      <div className="hw-prev__bar">
        <strong>한글 미리보기</strong>
        <span className="hw-prev__meta">{state?.loading ? '그리는 중' : state?.error ? '' : `${pages.length}쪽`}</span>
        {pages.length > 0 && <span className="hw-prev__note">표시용 미리보기입니다. 쪽 나눔은 한글에서 열 때와 다를 수 있습니다</span>}
        <span className="gd-grow" />
        <button type="button" className="hw-primary" onClick={onSave} disabled={state?.loading}><Download size={16} /> 한글로 저장</button>
        <button type="button" className="gd-icon-btn hw-prev__x" aria-label="닫기" onClick={onClose}><X size={20} /></button>
      </div>
      <div className="hw-prev__scroll">
        {state?.loading && <p className="hw-prev__msg">한글 문서를 만들어 그리는 중입니다</p>}
        {state?.error && <p className="hw-prev__msg">{state.error}</p>}
        {state?.warnings?.length > 0 && <p className="hw-prev__warn">{state.warnings.slice(0, 3).join(' / ')}</p>}
        {pages.map((p, i) => (
          <img key={i} className="hw-prev__page" alt={`${i + 1}쪽`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p)}`} />
        ))}
      </div>
    </div>
  )
}
