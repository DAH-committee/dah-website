// 편집기 작은 부품: 도구 단추, 구분선, 펼침 상자, 색 고르기.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ChevronDown, Pipette } from 'lucide-react'
import { COLOR_TOKENS, TOKEN_NAMES, resolveColor } from './deckCore'

export function TB({ label, onClick, disabled, pressed, children, keep, className = '', text }) {
  return (
    <button
      type="button"
      className={`sl-tb ${text ? 'sl-tb--text' : ''} ${className}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={pressed === undefined ? undefined : !!pressed}
      onMouseDown={keep ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export const Sep = () => <span className="sl-sep" aria-hidden="true" />

/** 단추를 누르면 열리는 상자. 바깥을 누르거나 Esc로 닫힌다 */
export function Pop({ label, icon, text, children, keep, align = 'left', disabled, className = '', wide, caret = true, pressed }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const key = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <span className={`sl-pop-wrap ${className}`} ref={ref}>
      <button
        type="button"
        className={`sl-tb ${text ? 'sl-tb--text' : ''}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-pressed={pressed === undefined ? undefined : !!pressed}
        disabled={disabled}
        onMouseDown={keep ? (e) => e.preventDefault() : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {text && <span>{text}</span>}
        {caret && <ChevronDown size={14} className="sl-caret" />}
      </button>
      {open && (
        <div className={`sl-popover sl-popover--${align} ${wide ? 'sl-popover--wide' : ''}`} onMouseDown={keep ? (e) => e.target.tagName !== 'INPUT' && e.preventDefault() : undefined}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </span>
  )
}

export const PALETTE = ['#111111', '#5F6368', '#9E9E9E', '#E2E2E2', '#FFFFFF', '#7A3CFF', '#6200EA', '#FFEA00', '#FFB300', '#FF1744', '#00E676', '#00B0FF']

/** 발표에 쓰인 색(문서 색). 편집기가 채운다 */
export const DeckColorsContext = createContext([])

const RECENT_KEY = 'dah-slides-recent-colors'
function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(v) ? v.filter((c) => /^#[0-9A-F]{6}$/i.test(c)).slice(0, 10) : []
  } catch {
    return []
  }
}
export function pushRecent(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c || '')) return
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([c.toUpperCase(), ...readRecent().filter((x) => x !== c.toUpperCase())].slice(0, 10)))
  } catch {
    /* 저장 공간이 없으면 넘어간다 */
  }
}
const normHex = (v) => {
  let t = String(v || '').trim().replace(/^#?/, '#')
  if (/^#[0-9a-f]{3}$/i.test(t)) t = '#' + t.slice(1).split('').map((c) => c + c).join('')
  return /^#[0-9a-f]{6}$/i.test(t) ? t.toUpperCase() : null
}

/** 색 고르기: 테마 색(토큰) + 문서 색 + 최근 색 + 기본 색 + HEX 입력 + 스포이트 */
export function ColorGrid({ value, theme, onPick, allowNone, close, keep }) {
  const docColors = useContext(DeckColorsContext)
  const [recent] = useState(readRecent)
  const cur = value || null
  const curHex = cur ? resolveColor(cur, theme) : ''
  const [hex, setHex] = useState(/^#[0-9a-f]{6}/i.test(curHex) ? curHex.slice(0, 7).toUpperCase() : '')
  const pick = (v, stay) => {
    if (v && v[0] === '#') pushRecent(v)
    onPick(v)
    if (!stay) close?.()
  }
  const sw = (c, title) => (
    <button key={c} type="button" className={`sl-swatch ${cur && cur.toUpperCase() === c.toUpperCase() ? 'is-on' : ''}`} style={{ background: resolveColor(c, theme) }} title={title || c} aria-label={title || c} onMouseDown={keep ? (e) => e.preventDefault() : undefined} onClick={() => pick(c)} />
  )
  const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window
  return (
    <div className="sl-colors">
      <div className="sl-colors__label">테마 색</div>
      <div className="sl-colors__row">{COLOR_TOKENS.map((k) => sw(`@${k}`, TOKEN_NAMES[k]))}</div>
      {docColors.length > 0 && (
        <>
          <div className="sl-colors__label">문서 색</div>
          <div className="sl-colors__row">{docColors.map((c) => sw(c))}</div>
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className="sl-colors__label">최근 색</div>
          <div className="sl-colors__row">{recent.map((c) => sw(c))}</div>
        </>
      )}
      <div className="sl-colors__label">기본 색</div>
      <div className="sl-colors__row">
        {allowNone && (
          <button type="button" className={`sl-swatch sl-swatch--none ${cur === null ? 'is-on' : ''}`} title="없음" aria-label="없음" onMouseDown={keep ? (e) => e.preventDefault() : undefined} onClick={() => pick(null)} />
        )}
        {PALETTE.map((c) => sw(c))}
      </div>
      <div className="sl-colors__custom">
        <span className="sl-colors__chip" style={{ background: normHex(hex) || curHex || '#fff' }} />
        <input
          className="sl-hex"
          value={hex}
          placeholder="#RRGGBB"
          aria-label="색 코드"
          maxLength={7}
          onChange={(e) => setHex(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              const h = normHex(hex)
              if (h) pick(h)
            }
          }}
          onBlur={() => {
            const h = normHex(hex)
            if (h && h !== curHex.toUpperCase()) pick(h, true)
          }}
        />
        {!keep && (
          <label className="sl-colors__native" title="직접 고르기">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(curHex.slice(0, 7)) ? curHex.slice(0, 7) : '#7a3cff'} onChange={(e) => { setHex(e.target.value.toUpperCase()); onPick(e.target.value.toUpperCase()) }} onBlur={(e) => pushRecent(e.target.value)} aria-label="직접 고르기" />
          </label>
        )}
        {canDrop && (
          <button
            type="button"
            className="sl-icon-btn"
            title="화면에서 색 따기"
            aria-label="화면에서 색 따기"
            onMouseDown={keep ? (e) => e.preventDefault() : undefined}
            onClick={async () => {
              try {
                const r = await new window.EyeDropper().open()
                const h = normHex(r.sRGBHex)
                if (h) {
                  setHex(h)
                  pick(h)
                }
              } catch {
                /* 취소 */
              }
            }}
          >
            <Pipette size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

export function ColorButton({ label, value, theme, onPick, allowNone, icon, keep, align }) {
  const shown = value ? resolveColor(value, theme) : null
  return (
    <Pop
      label={label}
      keep={keep}
      align={align}
      icon={
        <span className="sl-colorbtn">
          {icon}
          <span className={`sl-colorbtn__bar ${shown ? '' : 'is-none'}`} style={{ background: shown || undefined }} />
        </span>
      }
    >
      {(close) => <ColorGrid value={value} theme={theme} onPick={onPick} allowNone={allowNone} close={close} keep={keep} />}
    </Pop>
  )
}

export function NumField({ label, value, onChange, min, max, step = 1, suffix, width }) {
  const [v, setV] = useState(String(value ?? ''))
  useEffect(() => setV(String(value ?? '')), [value])
  const commit = () => {
    const n = parseFloat(v)
    if (!Number.isFinite(n)) return setV(String(value ?? ''))
    const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))
    if (c !== value) onChange(c)
    else setV(String(value ?? ''))
  }
  return (
    <label className="sl-num">
      <span>{label}</span>
      <input
        type="number"
        value={v}
        step={step}
        min={min}
        max={max}
        style={width ? { width, flex: 'none' } : undefined}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          }
          e.stopPropagation()
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  )
}

/**
 * 숫자 칸. 이름표를 좌우로 끌면 값이 바뀐다(Shift: 10배).
 * onLive(v): 끄는 동안, onChange(v): 입력 확정, onEnd(): 끌기 끝
 */
export function ScrubField({ label, value, onChange, onLive, onEnd, min, max, step = 1, suffix, title, mixed, icon }) {
  const [v, setV] = useState(mixed ? '' : String(value ?? ''))
  const drag = useRef(null)
  useEffect(() => setV(mixed ? '' : String(value ?? '')), [value, mixed])
  const clamp = (n) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))
  const commit = () => {
    const raw = String(v).trim()
    if (!raw) return setV(mixed ? '' : String(value ?? ''))
    // 간단한 계산식(100+20, 50*2)
    let n = Number(raw)
    if (!Number.isFinite(n) && /^[\d\s.+\-*/()]+$/.test(raw)) {
      try {
        n = Function(`"use strict";return (${raw})`)()
      } catch {
        n = NaN
      }
    }
    if (!Number.isFinite(n)) return setV(mixed ? '' : String(value ?? ''))
    const c = clamp(Math.round(n / step) * step)
    if (c !== value || mixed) onChange(c)
    else setV(String(value ?? ''))
  }
  return (
    <label className="sl-num sl-scrub" title={title}>
      <span
        className="sl-scrub__label"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, base: Number(value) || 0, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (!d.moved && Math.abs(dx) < 2) return
          d.moved = true
          const n = clamp(Math.round((d.base + dx * step * (e.shiftKey ? 10 : 1)) / step) * step)
          setV(String(n))
          ;(onLive || onChange)(n)
        }}
        onPointerUp={() => {
          if (drag.current?.moved) onEnd?.()
          drag.current = null
        }}
      >
        {icon || label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={v}
        placeholder={mixed ? '혼합' : undefined}
        aria-label={title || label}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const n = clamp((Number(v) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1))
            setV(String(n))
            onChange(n)
          }
          if (e.key === 'Escape') {
            setV(mixed ? '' : String(value ?? ''))
            e.currentTarget.blur()
          }
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  )
}
