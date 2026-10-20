// 슬라이드 한 장 그리기. 편집 화면, 썸네일, 발표, 내보내기가 모두 이 컴포넌트를 쓴다.
// 슬라이드 좌표는 항상 1920x1080이고 scale로 줄이거나 키운다.
// mode: 'edit'(자리 표시 문장 보임) | 'thumb' | 'present'(임베드 재생, 등장 효과) | 'export'
import { memo, useId, useLayoutEffect, useRef, useState } from 'react'
import { ImagePlus, Link2, PlayCircle, PenTool, FileText } from 'lucide-react'
import { SLIDE_H, SLIDE_W, resolveColor, resolveFont } from './deckCore'
import { hostnameOf, sanitizeRich } from './sanitize'
import { ICONS } from './iconLib'
import './slideView.css'

const emptyHtml = (html) => !String(html || '').replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

export function textCss(el, theme) {
  const s = el.style || {}
  return {
    fontFamily: resolveFont(s.font || '@body', theme),
    color: resolveColor(s.color || '@text', theme),
    lineHeight: s.lineHeight || 1.4,
    textAlign: s.align || 'left',
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: s.underline ? 'underline' : 'none',
    letterSpacing: s.tracking ? `${s.tracking}em` : undefined,
    textTransform: s.textTransform && s.textTransform !== 'none' ? s.textTransform : undefined,
    textShadow: s.textShadow ? shadowCss(s.textShadow, theme) : undefined,
    '--sl-para': s.paraSpacing ? `${s.paraSpacing}px` : undefined,
  }
}

const alphaOf = (hex) => (/^#[0-9a-f]{8}$/i.test(hex) ? parseInt(hex.slice(7, 9), 16) / 255 : 1)
const hexA = (c, theme) => resolveColor(c || '#00000040', theme)
/** 그림자 { x, y, blur, color } → CSS 값 */
export function shadowCss(sh, theme) {
  if (!sh) return undefined
  return `${sh.x || 0}px ${sh.y || 0}px ${Math.max(0, sh.blur || 0)}px ${hexA(sh.color, theme)}`
}
/** 채우기: 단색 또는 선형 그라데이션 */
export function fillCss(s, theme) {
  if (s.fillType === 'linear' && s.gradient) return `linear-gradient(${s.gradient.angle ?? 90}deg, ${resolveColor(s.gradient.from || '@accent', theme)}, ${resolveColor(s.gradient.to || '@accent2', theme)})`
  return s.fill ? resolveColor(s.fill, theme) : undefined
}
const hasFill = (s) => !!(s.fill || (s.fillType === 'linear' && s.gradient))

/** 글이 상자를 넘치면 글자를 줄여 맞춘다(자동 맞춤). 반환: 배율 */
function useAutofit(ref, el, deps) {
  const [fit, setFit] = useState(1)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    if (el.style?.autofit === false || (el.style?.sizing && el.style.sizing !== 'fixed')) {
      if (fit !== 1) setFit(1)
      return
    }
    const box = node.parentElement
    const prev = node.style.fontSize
    const cs = getComputedStyle(box)
    const avail = box.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0)
    let f = 1
    const base = el.style?.size || 36
    for (let i = 0; i < 8; i++) {
      node.style.fontSize = `${base * f}px`
      const need = node.scrollHeight
      if (need <= avail + 1 || f <= 0.35) break
      f = Math.max(0.35, f * Math.max(0.7, Math.min(0.97, avail / need)))
    }
    node.style.fontSize = prev
    if (Math.abs(f - fit) > 0.005) setFit(f)
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return fit
}

function TextEl({ el, theme, mode, editing, onEditInput, editRef, editCaret }) {
  const s = el.style || {}
  const inner = useRef(null)
  const [tick, setTick] = useState(0)
  const html = editing ? null : sanitizeRich(el.data?.html)
  const fit = useAutofit(inner, el, [html, s.size, s.lineHeight, s.font, el.w, el.h, editing, tick, theme?.fonts?.heading, theme?.fonts?.body])
  const showPh = (mode === 'edit' || mode === 'thumb') && !editing && emptyHtml(el.data?.html) && el.data?.placeholder
  const pad = s.pad ?? 8
  const filled = hasFill(s)
  const autoSize = s.sizing === 'auto-w' || s.sizing === 'auto-h'
  const outer = {
    position: 'absolute', inset: 0, padding: pad, display: 'flex', flexDirection: 'column',
    justifyContent: s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start',
    background: fillCss(s, theme), borderRadius: filled ? s.radius ?? 12 : undefined, overflow: mode === 'export' || autoSize ? 'visible' : 'hidden',
    boxShadow: filled && s.shadow ? shadowCss(s.shadow, theme) : undefined,
  }
  const css = { ...textCss(el, theme), fontSize: (s.size || 36) * fit, minHeight: editing ? '1em' : undefined }
  if (!filled && s.shadow && !s.textShadow) css.textShadow = shadowCss(s.shadow, theme)
  if (s.sizing === 'auto-w') {
    css.width = 'max-content'
    css.whiteSpace = 'nowrap'
  }
  // html2canvas는 줄 높이가 아주 낮으면 글자를 아래로 밀어 그린다
  if (mode === 'export' && (s.lineHeight || 1.4) < 1.15) css.lineHeight = 1.15
  const setRef = (n) => {
    inner.current = n
    if (editRef && editing && n) editRef.current = n
  }
  if (editing) {
    return (
      <div style={outer}>
        <div
          key="edit"
          ref={(n) => {
            if (n && !n.dataset.init) {
              n.dataset.init = '1'
              n.innerHTML = sanitizeRich(el.data?.html) || '<p><br></p>'
              requestAnimationFrame(() => {
                n.focus()
                const sel = window.getSelection()
                const at = editCaret?.current
                if (editCaret) editCaret.current = null
                let r = null
                if (at === 'all') {
                  r = document.createRange()
                  r.selectNodeContents(n)
                } else if (at && typeof at === 'object') {
                  // 편집기 선택 테두리(겹친 판)가 글자 위치 찾기를 가리지 않게 잠시 숨긴다
                  const covers = [...document.querySelectorAll('.sl-overlay'), ...[...(n.closest('.sl-slide')?.querySelectorAll('.sl-el') || [])].filter((o) => !o.contains(n))]
                  covers.forEach((o) => (o.style.visibility = 'hidden'))
                  if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(at.x, at.y)
                  else if (document.caretPositionFromPoint) {
                    const cp = document.caretPositionFromPoint(at.x, at.y)
                    if (cp) {
                      r = document.createRange()
                      r.setStart(cp.offsetNode, cp.offset)
                      r.collapse(true)
                    }
                  }
                  covers.forEach((o) => (o.style.visibility = ''))
                  if (r && !n.contains(r.startContainer)) r = null
                }
                if (!r) {
                  r = document.createRange()
                  r.selectNodeContents(n)
                  r.collapse(false)
                }
                sel.removeAllRanges()
                sel.addRange(r)
              })
            }
            setRef(n)
          }}
          className="sl-text sl-text--edit"
          contentEditable
          suppressContentEditableWarning
          data-ph={el.data?.placeholder || '텍스트 입력'}
          style={css}
          onInput={(e) => {
            onEditInput?.(e.currentTarget.innerHTML)
            setTick((t) => t + 1)
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </div>
    )
  }
  return (
    <div style={outer}>
      {showPh ? (
        <div key="ph" ref={setRef} className="sl-text sl-text--ph" style={css}>
          <p>{el.data.placeholder}</p>
        </div>
      ) : (
        <div key="view" ref={setRef} className="sl-text" style={css} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  )
}

export function shapePath(shape, w, h) {
  if (shape === 'triangle') return `M${w / 2},0 L${w},${h} L0,${h} Z`
  if (shape === 'arrow') {
    const hw = Math.min(w * 0.45, h * 0.9)
    return `M0,${h * 0.3} L${w - hw},${h * 0.3} L${w - hw},0 L${w},${h / 2} L${w - hw},${h} L${w - hw},${h * 0.7} L0,${h * 0.7} Z`
  }
  return ''
}

function ShapeEl({ el, theme }) {
  const s = el.style || {}
  const uid = useId().replace(/:/g, '')
  const shape = el.data?.shape || 'rect'
  const grad = s.fillType === 'linear' && s.gradient
  const fill = grad ? `url(#g${uid})` : s.fill ? resolveColor(s.fill, theme) : 'none'
  const stroke = s.stroke ? resolveColor(s.stroke, theme) : 'none'
  const sw = s.stroke ? s.strokeWidth || 4 : 0
  const dash = s.strokeStyle === 'dashed' ? `${Math.max(2, sw * 3)} ${Math.max(2, sw * 2)}` : s.strokeStyle === 'dotted' ? `0.1 ${Math.max(2, sw * 2)}` : undefined
  const fx = s.shadow || s.blur ? `url(#f${uid})` : undefined
  const { w, h } = el
  const defs = (grad || fx) && (
    <defs>
      {grad && (() => {
        const a = (((s.gradient.angle ?? 90) - 90) * Math.PI) / 180
        const x = Math.cos(a) / 2
        const y = Math.sin(a) / 2
        return (
          <linearGradient id={`g${uid}`} x1={0.5 - x} y1={0.5 - y} x2={0.5 + x} y2={0.5 + y}>
            <stop offset="0" stopColor={resolveColor(s.gradient.from || '@accent', theme)} />
            <stop offset="1" stopColor={resolveColor(s.gradient.to || '@accent2', theme)} />
          </linearGradient>
        )
      })()}
      {fx && (
        <filter id={`f${uid}`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          {s.blur ? <feGaussianBlur in="SourceGraphic" stdDeviation={s.blur / 2} result="b" /> : null}
          {s.shadow ? <feDropShadow in={s.blur ? 'b' : 'SourceGraphic'} dx={s.shadow.x || 0} dy={s.shadow.y || 0} stdDeviation={Math.max(0, (s.shadow.blur || 0) / 2)} floodColor={hexA(s.shadow.color, theme).slice(0, 7)} floodOpacity={alphaOf(hexA(s.shadow.color, theme))} /> : null}
        </filter>
      )}
    </defs>
  )
  if (shape === 'icon') {
    const Icon = ICONS[el.data?.icon] || ICONS.Star
    const c = resolveColor(s.color || s.stroke || '@accent', theme)
    return <Icon width={w} height={h} color={c} strokeWidth={s.strokeWidth || 2} absoluteStrokeWidth={false} style={{ position: 'absolute', inset: 0, display: 'block', filter: s.shadow ? `drop-shadow(${shadowCss(s.shadow, theme)})` : undefined }} />
  }
  if (shape === 'line') {
    const lc = resolveColor(s.stroke || s.fill || '@text', theme)
    const lw = s.strokeWidth || 6
    const head = s.arrowEnd ? Math.max(lw * 3, 18) : 0
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {defs}
        <g filter={fx}>
          <line x1={0} y1={h / 2} x2={w - head * 0.8} y2={h / 2} stroke={lc} strokeWidth={lw} strokeLinecap={dash ? 'butt' : 'round'} strokeDasharray={s.strokeStyle === 'dashed' ? `${lw * 3} ${lw * 2}` : s.strokeStyle === 'dotted' ? `0.1 ${lw * 2}` : undefined} style={s.strokeStyle === 'dotted' ? { strokeLinecap: 'round' } : undefined} />
          {head > 0 && <polygon points={`${w},${h / 2} ${w - head},${h / 2 - head * 0.6} ${w - head},${h / 2 + head * 0.6}`} fill={lc} />}
        </g>
      </svg>
    )
  }
  const i = sw / 2
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      {defs}
      <g filter={fx}>
        {(shape === 'rect' || shape === 'rounded') && (
          <rect x={i} y={i} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={shape === 'rounded' ? Math.min(s.radius ?? 24, w / 2, h / 2) : Math.min(s.radius && shape === 'rect' ? s.radius : 0, w / 2, h / 2)} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} strokeLinecap={s.strokeStyle === 'dotted' ? 'round' : undefined} />
        )}
        {shape === 'ellipse' && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - i)} ry={Math.max(0, h / 2 - i)} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} strokeLinecap={s.strokeStyle === 'dotted' ? 'round' : undefined} />}
        {(shape === 'triangle' || shape === 'arrow') && <path d={shapePath(shape, w, h)} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeDasharray={dash} strokeLinecap={s.strokeStyle === 'dotted' ? 'round' : undefined} />}
      </g>
    </svg>
  )
}

function ImageEl({ el, mode, theme }) {
  const s = { ...(el.style || {}) }
  const src = el.data?.src
  s.radius = s.mask === 'circle' ? '50%' : s.mask === 'rounded' ? Math.max(s.radius || 0, Math.min(el.w, el.h) * 0.12) : s.radius || 0
  const shadow = s.shadow ? shadowCss(s.shadow, theme) : undefined
  const filt = [s.brightness !== undefined && s.brightness !== 100 ? `brightness(${s.brightness}%)` : '', s.contrast !== undefined && s.contrast !== 100 ? `contrast(${s.contrast}%)` : '', s.saturate !== undefined && s.saturate !== 100 ? `saturate(${s.saturate}%)` : ''].filter(Boolean).join(' ') || undefined
  if (!src) {
    if (mode !== 'edit' && mode !== 'thumb') return null
    return (
      <div className="sl-img-ph" style={{ borderRadius: s.radius || 0 }}>
        <ImagePlus size={Math.max(24, Math.min(el.w, el.h) * 0.12)} strokeWidth={1.5} />
        {mode === 'edit' && Math.min(el.w, el.h) > 180 && <span>{el.data?.placeholder || '이미지를 넣으세요'}</span>}
      </div>
    )
  }
  if (mode === 'export') {
    // html2canvas는 object-fit을 그리지 못하므로 배경 그림으로 같은 모양을 만든다
    const fit = s.fit || 'cover'
    return <div style={{ position: 'absolute', inset: 0, backgroundImage: `url("${String(src).replace(/["\\]/g, '')}")`, backgroundSize: fit === 'fill' ? '100% 100%' : fit, backgroundPosition: `${s.posX ?? 50}% ${s.posY ?? 50}%`, backgroundRepeat: 'no-repeat', borderRadius: s.radius || 0, opacity: s.opacity ?? 1, boxShadow: shadow, filter: filt }} />
  }
  return (
    <img
      src={src}
      alt={el.data?.alt || ''}
      draggable={false}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: s.fit || 'cover', objectPosition: `${s.posX ?? 50}% ${s.posY ?? 50}%`, borderRadius: s.radius || 0, display: 'block', opacity: s.opacity ?? 1, boxShadow: shadow, filter: filt }}
    />
  )
}

function TableEl({ el, theme, editing, onCell }) {
  const s = el.style || {}
  const rows = el.data?.rows || [['']]
  const head = el.data?.header !== false
  const line = resolveColor(s.line || '@muted', theme)
  const font = resolveFont(s.font || '@body', theme)
  const color = resolveColor(s.color || '@text', theme)
  return (
    <table className="sl-table" style={{ fontFamily: font, fontSize: s.size || 24, color, background: s.fill ? resolveColor(s.fill, theme) : undefined }}>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} style={{ height: `${100 / rows.length}%` }}>
            {r.map((c, ci) => {
              const isHead = head && ri === 0
              return (
                <td
                  key={ci}
                  style={{ borderColor: line, background: isHead ? resolveColor(s.headerFill || '@accent', theme) : undefined, color: isHead ? resolveColor(s.headerColor || '@bg', theme) : undefined, fontWeight: isHead ? 700 : 400 }}
                  contentEditable={editing ? 'plaintext-only' : undefined}
                  suppressContentEditableWarning
                  onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
                  onBlur={editing ? (e) => onCell?.(ri, ci, e.currentTarget.innerText.replace(/\n$/, '')) : undefined}
                  onKeyDown={
                    editing
                      ? (e) => {
                          if (e.key === 'Tab') {
                            e.preventDefault()
                            const tds = [...e.currentTarget.closest('table').querySelectorAll('td')]
                            const i = tds.indexOf(e.currentTarget)
                            tds[(i + (e.shiftKey ? -1 : 1) + tds.length) % tds.length]?.focus()
                          }
                        }
                      : undefined
                  }
                >
                  {c}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EmbedEl({ el, theme, mode }) {
  const d = el.data || {}
  if (mode === 'present' && d.embedUrl) {
    return <iframe src={d.embedUrl} title={d.title || '임베드'} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 16 }} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" />
  }
  const wide = el.w / el.h > 1.9
  const KindIcon = d.kind === 'youtube' ? PlayCircle : d.kind === 'figma' ? PenTool : d.kind === 'notion' ? FileText : Link2
  const fg = resolveColor('@text', theme)
  const bg = resolveColor('@surface', theme)
  const sz = Math.max(18, Math.min(34, el.h * 0.06))
  const link = (
    <>
      {d.image && <div className="sl-embed__img" style={wide ? { width: '42%', height: '100%' } : { height: '58%' }}><img src={d.image} alt="" draggable={false} /></div>}
      <div className="sl-embed__body" style={{ padding: sz }}>
        <div className="sl-embed__site" style={{ fontSize: sz * 0.75 }}>
          <KindIcon size={sz} /> {d.siteName || hostnameOf(d.url)}
        </div>
        <div className="sl-embed__title" style={{ fontSize: sz * 1.15 }}>{d.title || d.url}</div>
        {d.description && <div className="sl-embed__desc" style={{ fontSize: sz * 0.8 }}>{d.description}</div>}
      </div>
    </>
  )
  const style = { flexDirection: wide ? 'row' : 'column', background: bg, color: fg }
  if (mode === 'present' && d.url) {
    return (
      <a className="sl-embed" href={d.url} target="_blank" rel="noopener noreferrer" style={style}>
        {link}
      </a>
    )
  }
  return (
    <div className="sl-embed" style={style}>
      {link}
    </div>
  )
}

export function ElementView({ el, theme, mode, editing, onEditInput, editRef, editCaret, onCell, animClass, hidden }) {
  if (el.hidden) return null
  const st = el.style || {}
  const style = {
    position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h,
    transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined, zIndex: el.z || 0,
    opacity: hidden ? 0 : st.opacity !== undefined && el.type !== 'image' ? st.opacity : undefined,
    // 도형은 SVG 필터로 흐리게 한다(내보내기에도 남는다)
    filter: st.blur && el.type !== 'shape' ? `blur(${st.blur}px)` : undefined,
    boxShadow: st.shadow && (el.type === 'table' || el.type === 'embed') ? shadowCss(st.shadow, theme) : undefined,
  }
  return (
    <div className={`sl-el sl-el--${el.type} ${animClass || ''}`} style={style} data-el={el.id} data-mid={el.mid || el.id}>
      {el.type === 'text' && <TextEl el={el} theme={theme} mode={mode} editing={editing} onEditInput={onEditInput} editRef={editRef} editCaret={editCaret} />}
      {el.type === 'shape' && <ShapeEl el={el} theme={theme} />}
      {el.type === 'image' && <ImageEl el={el} mode={mode} theme={theme} />}
      {el.type === 'table' && <TableEl el={el} theme={theme} editing={editing} onCell={onCell} />}
      {el.type === 'embed' && <EmbedEl el={el} theme={theme} mode={mode} />}
    </div>
  )
}

export function slideBackground(slide, theme) {
  const b = slide?.background
  const color = resolveColor(b?.color || '@bg', theme)
  const st = { backgroundColor: color }
  if (b?.image) {
    st.backgroundImage = `url("${String(b.image).replace(/["\\]/g, '')}")`
    st.backgroundSize = b.fit === 'contain' ? 'contain' : 'cover'
    st.backgroundPosition = 'center'
    st.backgroundRepeat = 'no-repeat'
  }
  return st
}

/**
 * 슬라이드 한 장. scale: 화면 배율. animStep: 발표에서 지금까지 나타난 등장 효과 순번(없으면 모두 보임).
 */
function SlideViewInner({ slide, theme, scale = 1, mode = 'thumb', editingId = null, onEditInput, editRef, editCaret, onCell, animStep, className = '', innerRef }) {
  const els = [...(slide?.elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0))
  return (
    <div className={`sl-frame ${className}`} style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
      <div ref={innerRef} className={`sl-slide ${mode === 'export' ? 'is-export' : ''}`} style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, ...slideBackground(slide, theme), fontFamily: resolveFont('@body', theme), '--sl-link': resolveColor('@accent', theme) }}>
        {els.map((el) => {
          const order = el.anim ? el.anim.order || 1 : 0
          const hidden = animStep !== undefined && order > 0 && order > animStep
          const animClass = animStep !== undefined && order > 0 && order <= animStep ? `sl-anim-${el.anim.type}` : ''
          return (
            <ElementView key={el.id} el={el} theme={theme} mode={mode} editing={editingId === el.id} onEditInput={onEditInput} editRef={editRef} editCaret={editCaret} onCell={onCell} animClass={animClass} hidden={hidden} />
          )
        })}
      </div>
    </div>
  )
}

export const SlideView = memo(SlideViewInner)
export default SlideView
