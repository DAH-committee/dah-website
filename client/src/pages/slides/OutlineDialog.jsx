// 글로 만들기: 개요를 붙여 넣으면 규칙대로 슬라이드를 만든다(deckCore.outlineToSlides).
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { THEMES, outlineToSlides, themeCopy } from './deckCore'
import SlideView from './SlideView'

const EXAMPLE = `# 발표 제목
부제목이나 발표자 이름

## 문제
- 누가 어떤 불편을 겪는지
- 지금은 어떻게 해결하고 있는지
노트: 이 줄은 발표자 노트가 됩니다

## 72%
숫자만 있는 제목은 큰 숫자 슬라이드가 됩니다

# 두 번째 장
## 해결
> 인용문은 인용 슬라이드가 됩니다`

export default function OutlineDialog({ themeId, onClose, onCreate, hasSlides }) {
  const [text, setText] = useState('')
  const [theme, setTheme] = useState(themeId || 'basic')
  const [mode, setMode] = useState(hasSlides ? 'append' : 'replace')
  const ta = useRef(null)
  useEffect(() => {
    ta.current?.focus()
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const slides = useMemo(() => (text.trim() ? outlineToSlides(text) : []), [text])
  const th = useMemo(() => themeCopy(theme), [theme])
  return (
    <div className="sl-modal" role="dialog" aria-modal="true" aria-label="글로 만들기" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sl-modal__panel sl-outline">
        <div className="sl-modal__head">
          <h2>글로 만들기</h2>
          <button type="button" className="sl-icon-btn" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="sl-outline__body">
          <div className="sl-outline__left">
            <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} aria-label="개요" spellCheck={false} />
            <p className="sl-hint">
              # 제목·섹션, ## 슬라이드, - 목록, &gt; 인용, 이미지 주소, --- 나누기, 노트: 발표자 노트. 긴 목록은 다음 슬라이드로 나눕니다.
            </p>
            <div className="sl-outline__opts">
              <div className="sl-chips" role="radiogroup" aria-label="테마">
                {THEMES.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`sl-chip ${theme === t.id ? 'is-on' : ''}`} onClick={() => setTheme(t.id)}>
                    <span className="sl-chip__dot" style={{ background: t.colors.bg, boxShadow: `inset 0 0 0 4px ${t.colors.accent}` }} />
                    {t.name}
                  </button>
                ))}
              </div>
              {hasSlides && (
                <div className="sl-chips" role="radiogroup" aria-label="넣는 방법">
                  <button type="button" role="radio" aria-checked={mode === 'append'} className={`sl-chip ${mode === 'append' ? 'is-on' : ''}`} onClick={() => setMode('append')}>
                    뒤에 더하기
                  </button>
                  <button type="button" role="radio" aria-checked={mode === 'replace'} className={`sl-chip ${mode === 'replace' ? 'is-on' : ''}`} onClick={() => setMode('replace')}>
                    전체 바꾸기
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="sl-outline__preview" aria-label="미리보기">
            {slides.length === 0 && <p className="sl-hint">왼쪽에 개요를 입력하면 여기에 슬라이드가 보입니다.</p>}
            {slides.slice(0, 30).map((s) => (
              <SlideView key={s.id} slide={s} theme={th} scale={200 / 1920} mode="thumb" />
            ))}
          </div>
        </div>
        <div className="sl-modal__foot">
          <span className="sl-hint">{slides.length ? `슬라이드 ${slides.length}장` : ''}</span>
          <button type="button" className="sl-btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="sl-btn sl-btn--primary" disabled={!slides.length} onClick={() => onCreate(slides, theme, mode)}>
            만들기
          </button>
        </div>
      </div>
    </div>
  )
}
