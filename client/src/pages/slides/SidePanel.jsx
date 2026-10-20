// 오른쪽 패널: 맨 위 정렬 막대(선택했을 때) + 탭 디자인(테마, 브랜드 키트, 배경, 전환) / 레이아웃(디자인 제안) /
// 서식(위치·크기·자동 배치·채우기·선·효과·글) / 레이어(요소 목록, 순서 끌기, 잠금·숨김, 이름).
import { useMemo, useRef, useState } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Group, ImagePlus, Lock, LockOpen,
  Trash2, Ungroup, EyeOff, Eye, LayoutGrid, Link as LinkIcon, Unlink, Type, Square, Circle, Image as ImageIcon, Table2, Link2, Minus, Smile,
  Triangle, ArrowRight, ChevronDown, ChevronRight, Rows3, Columns3, RotateCw, Radius, MoveHorizontal, MoveVertical,
} from 'lucide-react'
import { COLOR_TOKENS, FONTS, LAYOUTS, THEMES, TOKEN_NAMES, applyLayout, themeCopy } from './deckCore'
import SlideView from './SlideView'
import { ColorButton, NumField, ScrubField, TB } from './parts'
import { elementName, unionBox } from './editorOps'

const TABS = [
  { id: 'design', name: '디자인' },
  { id: 'layout', name: '레이아웃' },
  { id: 'format', name: '서식' },
  { id: 'layers', name: '레이어' },
]
const ALT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌥' : 'Alt+'
const TYPE_NAMES = { text: '텍스트', shape: '도형', image: '이미지', table: '표', embed: '링크 카드' }
const ANIMS = [
  { id: '', name: '없음' },
  { id: 'fade', name: '나타나기' },
  { id: 'rise', name: '떠오르기' },
  { id: 'zoom', name: '커지기' },
]
const TRANSITIONS = [
  { id: 'none', name: '없음' },
  { id: 'fade', name: '페이드' },
  { id: 'slide', name: '밀기' },
  { id: 'magic', name: '매직 무브' },
]

function Section({ title, children, right }) {
  return (
    <section className="sl-sec">
      <div className="sl-sec__head">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

function Seg({ value, options, onChange, label }) {
  return (
    <div className="sl-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  )
}

function ThemeCard({ t, on, onClick }) {
  return (
    <button type="button" className={`sl-theme ${on ? 'is-on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="sl-theme__art" style={{ background: t.colors.bg, color: t.colors.text, fontFamily: FONTS[t.fonts.heading]?.css }}>
        <b>가나</b>
        <i style={{ background: t.colors.accent }} />
        <i style={{ background: t.colors.accent2, width: 14 }} />
      </span>
      <span className="sl-theme__name">{t.name}</span>
    </button>
  )
}

function DesignTab({ deck, slide, canEdit, act }) {
  const theme = deck.theme
  const bgInput = useRef(null)
  return (
    <>
      <Section title="테마">
        <div className="sl-theme-grid">
          {THEMES.map((t) => (
            <ThemeCard key={t.id} t={t} on={theme.id === t.id && THEMES.find((x) => x.id === t.id).colors.accent === theme.colors.accent} onClick={() => canEdit && act.setTheme(themeCopy(t.id))} />
          ))}
        </div>
      </Section>
      <Section title="브랜드 키트">
        <p className="sl-hint">발표 전체의 색과 글꼴입니다. 테마 색을 쓴 요소가 함께 바뀝니다.</p>
        <div className="sl-brand">
          {COLOR_TOKENS.map((k) => (
            <label key={k} className="sl-brand__color">
              <input type="color" value={theme.colors[k]} disabled={!canEdit} onChange={(e) => act.setTheme({ ...theme, colors: { ...theme.colors, [k]: e.target.value.toUpperCase() } }, true)} onBlur={() => act.endThemeEdit()} />
              <span>{TOKEN_NAMES[k]}</span>
            </label>
          ))}
        </div>
        <div className="sl-field-row">
          <label className="sl-select">
            <span>제목 글꼴</span>
            <select value={theme.fonts.heading} disabled={!canEdit} onChange={(e) => act.setTheme({ ...theme, fonts: { ...theme.fonts, heading: e.target.value } })}>
              {Object.values(FONTS).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sl-select">
            <span>본문 글꼴</span>
            <select value={theme.fonts.body} disabled={!canEdit} onChange={(e) => act.setTheme({ ...theme, fonts: { ...theme.fonts, body: e.target.value } })}>
              {Object.values(FONTS).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>
      {slide && (
        <Section title="배경" right={canEdit && <button type="button" className="sl-link" onClick={act.bgAll}>모든 슬라이드에</button>}>
          <div className="sl-field-row">
            <ColorButton label="배경 색" value={slide.background?.color || '@bg'} theme={theme} onPick={(v) => act.updateSlide((s) => ({ ...s, background: { ...(s.background || {}), color: v || '@bg' } }))} />
            <button type="button" className="sl-btn sl-btn--small" disabled={!canEdit} onClick={() => bgInput.current?.click()}>
              <ImagePlus size={16} /> 배경 이미지
            </button>
            {slide.background?.image && (
              <button type="button" className="sl-btn sl-btn--small" onClick={() => act.updateSlide((s) => ({ ...s, background: { ...(s.background || {}), image: undefined } }))}>
                지우기
              </button>
            )}
          </div>
          <input
            ref={bgInput}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              const url = await act.upload(f)
              if (url) act.updateSlide((s) => ({ ...s, background: { ...(s.background || {}), image: url } }))
            }}
          />
        </Section>
      )}
      {slide && (
        <Section title="전환" right={canEdit && <button type="button" className="sl-link" onClick={act.transitionAll}>모든 슬라이드에</button>}>
          <Seg label="전환" value={slide.transition || 'none'} options={TRANSITIONS} onChange={(v) => canEdit && act.updateSlide((s) => ({ ...s, transition: v }))} />
          {slide.transition === 'magic' && <p className="sl-hint">앞 슬라이드와 짝이 맞는 요소(복제한 슬라이드의 같은 요소)가 자리·크기·색을 이어서 움직입니다.</p>}
        </Section>
      )}
      {slide && canEdit && (
        <Section title="슬라이드">
          <button type="button" className="sl-btn sl-btn--small" onClick={act.toggleHidden}>
            {slide.hidden ? <Eye size={16} /> : <EyeOff size={16} />} {slide.hidden ? '건너뛰기 해제' : '발표에서 건너뛰기'}
          </button>
        </Section>
      )}
    </>
  )
}

function LayoutTab({ deck, slide, canEdit, act }) {
  const options = useMemo(() => {
    if (!slide) return []
    const out = []
    const curL = LAYOUTS.find((l) => l.id === slide.layout)
    if (curL) curL.variants.forEach((_, v) => out.push({ layout: curL.id, v, name: `${curL.name} ${v + 1}` }))
    for (const L of LAYOUTS) {
      if (L.id === slide.layout) continue
      L.variants.forEach((_, v) => out.push({ layout: L.id, v, name: `${L.name} ${v + 1}` }))
    }
    return out.map((o) => ({ ...o, preview: applyLayout(slide, o.layout, o.v) }))
  }, [slide])
  if (!slide) return null
  return (
    <Section title="디자인 제안">
      <p className="sl-hint">지금 슬라이드의 내용을 그대로 두고 배치만 바꿉니다.</p>
      <div className="sl-suggest">
        {options.map((o) => (
          <button
            key={`${o.layout}-${o.v}`}
            type="button"
            className={`sl-suggest__item ${slide.layout === o.layout && (slide.variant || 0) === o.v ? 'is-on' : ''}`}
            disabled={!canEdit}
            onClick={() => act.applyLayout(o.layout, o.v)}
            title={o.name}
          >
            <SlideView slide={o.preview} theme={deck.theme} scale={112 / 1920} mode="thumb" />
            <span>{o.name}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}

/** 정렬 막대: 하나면 슬라이드에, 여럿이면 선택 범위에 맞춘다 */
function AlignBar({ act }) {
  const n = act.unitCount()
  const gapInfo = n >= 2 ? act.gapInfo() : { axis: null, gap: null }
  return (
    <div className="sl-alignbar" role="toolbar" aria-label="정렬">
      <div className="sl-iconrow sl-alignbar__row">
        <TB label={`왼쪽 맞춤 (${ALT}A)`} onClick={() => act.align('left')}><AlignStartVertical size={18} /></TB>
        <TB label={`가로 가운데 (${ALT}H)`} onClick={() => act.align('center')}><AlignCenterVertical size={18} /></TB>
        <TB label={`오른쪽 맞춤 (${ALT}D)`} onClick={() => act.align('right')}><AlignEndVertical size={18} /></TB>
        <TB label={`위 맞춤 (${ALT}W)`} onClick={() => act.align('top')}><AlignStartHorizontal size={18} /></TB>
        <TB label={`세로 가운데 (${ALT}V)`} onClick={() => act.align('middle')}><AlignCenterHorizontal size={18} /></TB>
        <TB label={`아래 맞춤 (${ALT}S)`} onClick={() => act.align('bottom')}><AlignEndHorizontal size={18} /></TB>
        <TB label={`가로 간격 같게 (${ALT}⇧H, 셋 이상)`} disabled={n < 3} onClick={() => act.distribute('x')}><AlignHorizontalDistributeCenter size={18} /></TB>
        <TB label={`세로 간격 같게 (${ALT}⇧V, 셋 이상)`} disabled={n < 3} onClick={() => act.distribute('y')}><AlignVerticalDistributeCenter size={18} /></TB>
        <TB label={`간격 정리 (${ALT}⇧T)`} disabled={n < 2} onClick={act.tidy}><LayoutGrid size={18} /></TB>
      </div>
      {n >= 2 && (
        <div className="sl-alignbar__gap">
          <ScrubField
            label={gapInfo.axis === 'y' ? '세로 간격' : '가로 간격'}
            icon={gapInfo.axis === 'y' ? <MoveVertical size={14} /> : <MoveHorizontal size={14} />}
            title={gapInfo.axis === 'y' ? '세로 간격(px)' : '가로 간격(px)'}
            value={gapInfo.gap ?? 0}
            mixed={gapInfo.gap === null}
            min={-2000}
            max={2000}
            onChange={(v) => act.setGap(v)}
            onLive={(v) => act.setGap(v, true)}
            onEnd={act.endLive}
          />
          <span className="sl-hint sl-alignbar__note">{gapInfo.gap === null ? '간격이 서로 다릅니다' : '사이 간격'}</span>
        </div>
      )}
    </div>
  )
}

const SHAPE_ICONS = { rect: Square, rounded: Square, ellipse: Circle, triangle: Triangle, arrow: ArrowRight, line: Minus, icon: Smile }
function TypeIcon({ e, size = 14 }) {
  const I = e.type === 'text' ? Type : e.type === 'image' ? ImageIcon : e.type === 'table' ? Table2 : e.type === 'embed' ? Link2 : SHAPE_ICONS[e.data?.shape] || Square
  return <I size={size} />
}

function FillEditor({ s, theme, setStyle, label = '채우기', allowNone = true }) {
  const grad = s.fillType === 'linear'
  const g = s.gradient || { from: s.fill || '@accent', to: '@accent2', angle: 90 }
  return (
    <>
      <Seg
        label="채우기 종류"
        value={grad ? 'linear' : 'solid'}
        options={[{ id: 'solid', name: '단색' }, { id: 'linear', name: '그라데이션' }]}
        onChange={(v) => setStyle(v === 'linear' ? { fillType: 'linear', gradient: g } : { fillType: 'solid', fill: s.fill || g.from })}
      />
      <div className="sl-field-row sl-mt">
        {grad ? (
          <>
            <ColorButton label="시작 색" value={g.from} theme={theme} onPick={(v) => setStyle({ gradient: { ...g, from: v || '@accent' } })} icon={<span className="sl-mini-label">시작</span>} />
            <ColorButton label="끝 색" value={g.to} theme={theme} onPick={(v) => setStyle({ gradient: { ...g, to: v || '@accent2' } })} icon={<span className="sl-mini-label">끝</span>} />
            <ScrubField label="각도" icon={<RotateCw size={14} />} title="그라데이션 각도" value={g.angle ?? 90} min={-360} max={360} suffix="°" onChange={(v) => setStyle({ gradient: { ...g, angle: v } })} />
          </>
        ) : (
          <ColorButton label={label} value={s.fill || null} theme={theme} allowNone={allowNone} onPick={(v) => setStyle({ fill: v })} icon={<span className="sl-mini-label">{label}</span>} />
        )}
      </div>
    </>
  )
}

function ShadowEditor({ value, theme, onChange, label = '그림자' }) {
  const sh = value
  return (
    <div className="sl-effect">
      <label className="sl-check">
        <input type="checkbox" checked={!!sh} onChange={(e) => onChange(e.target.checked ? { x: 0, y: 8, blur: 24, color: '#00000040' } : null)} /> {label}
      </label>
      {sh && (
        <div className="sl-grid2">
          <ScrubField label="X" value={sh.x || 0} min={-400} max={400} onChange={(v) => onChange({ ...sh, x: v })} />
          <ScrubField label="Y" value={sh.y || 0} min={-400} max={400} onChange={(v) => onChange({ ...sh, y: v })} />
          <ScrubField label="흐림" value={sh.blur || 0} min={0} max={400} onChange={(v) => onChange({ ...sh, blur: v })} />
          <div className="sl-field-row">
            <ColorButton label="그림자 색" value={(sh.color || '#000000').slice(0, 7)} theme={theme} onPick={(v) => onChange({ ...sh, color: v && v[0] === '#' ? `${v.slice(0, 7)}${(sh.color || '#00000040').slice(7) || '40'}` : v || '#00000040' })} icon={<span className="sl-mini-label">색</span>} />
            <ScrubField label="%" title="그림자 진하기" value={Math.round((parseInt((sh.color || '#00000040').slice(7) || 'ff', 16) / 255) * 100)} min={0} max={100} onChange={(v) => onChange({ ...sh, color: `${(sh.color || '#000000').slice(0, 7)}${Math.round((v / 100) * 255).toString(16).padStart(2, '0')}` })} />
          </div>
        </div>
      )}
    </div>
  )
}

function FormatTab({ deck, selEls, canEdit, act, stackOf }) {
  const theme = deck.theme
  if (!selEls.length) return <p className="sl-hint sl-pad">요소를 고르면 서식이 여기에 나옵니다. 레이어 탭에서도 고를 수 있습니다.</p>
  const one = selEls.length === 1 ? selEls[0] : null
  const s = one?.style || {}
  const types = [...new Set(selEls.map((e) => e.type))]
  const allLocked = selEls.every((e) => e.locked)
  const grouped = selEls.some((e) => e.group)
  const setStyle = (patch, live) => act.updateSel((e) => ({ ...e, style: { ...e.style, ...patch } }), live)
  const box = one ? { x: one.x, y: one.y, w: one.w, h: one.h } : unionBox(selEls)
  const lockRatio = selEls.every((e) => e.style?.lockRatio)
  const stack = stackOf
  const allText = types.length === 1 && types[0] === 'text'
  const shapeKind = one?.type === 'shape' ? one.data?.shape : null
  const boxy = one && ((one.type === 'shape' && ['rect', 'rounded'].includes(shapeKind)) || one.type === 'image' || (one.type === 'text' && (s.fill || s.fillType === 'linear')))
  const radiusVal = one?.type === 'shape' ? (shapeKind === 'rounded' ? s.radius ?? 24 : s.radius || 0) : one?.type === 'text' ? s.radius ?? 12 : s.radius || 0
  const tf = (k) => (v) => act.setBox({ [k]: v })
  const tfLive = (k) => (v) => act.setBox({ [k]: v }, true)
  return (
    <fieldset disabled={!canEdit} className="sl-fieldset">
      <Section title={one ? `${TYPE_NAMES[one.type]}${one.name ? ` · ${one.name}` : ''}` : `${selEls.length}개 선택`}>
        <div className="sl-grid2">
          <ScrubField label="X" value={Math.round(box.x)} onChange={tf('x')} onLive={tfLive('x')} onEnd={act.endLive} />
          <ScrubField label="Y" value={Math.round(box.y)} onChange={tf('y')} onLive={tfLive('y')} onEnd={act.endLive} />
          <ScrubField label="W" title="너비" value={Math.round(box.w)} min={4} onChange={tf('w')} onLive={tfLive('w')} onEnd={act.endLive} />
          <ScrubField label="H" title="높이" value={Math.round(box.h)} min={4} onChange={tf('h')} onLive={tfLive('h')} onEnd={act.endLive} />
          {one && <ScrubField label="회전" icon={<RotateCw size={14} />} title="회전" value={Math.round(one.rotate || 0)} min={-360} max={360} suffix="°" onChange={(v) => act.updateSel((e) => ({ ...e, rotate: v }))} onLive={(v) => act.updateSel((e) => ({ ...e, rotate: v }), true)} onEnd={act.endLive} />}
          {boxy && <ScrubField label="모서리" icon={<Radius size={14} />} title="모서리 둥글기" value={radiusVal} min={0} max={540} onChange={(v) => setStyle({ radius: v })} onLive={(v) => setStyle({ radius: v }, true)} onEnd={act.endLive} />}
        </div>
        <div className="sl-field-row sl-mt">
          <TB label={lockRatio ? '비율 고정 풀기' : '비율 고정'} pressed={lockRatio} onClick={() => act.updateSel((e) => ({ ...e, style: { ...e.style, lockRatio: !lockRatio } }))}>
            {lockRatio ? <LinkIcon size={16} /> : <Unlink size={16} />}
          </TB>
          <span className="sl-hint sl-inline-hint">이름표를 좌우로 끌면 값이 바뀝니다</span>
        </div>
        <div className="sl-sliders">
          <label>
            불투명도
            <input type="range" min={0} max={100} value={Math.round((s.opacity ?? selEls[0].style?.opacity ?? 1) * 100)} onChange={(e) => act.updateSel((x) => ({ ...x, style: { ...x.style, opacity: +e.target.value / 100 } }), true)} onPointerUp={act.endLive} />
            <b className="sl-val">{Math.round((selEls[0].style?.opacity ?? 1) * 100)}%</b>
          </label>
        </div>
      </Section>

      <Section
        title="자동 배치"
        right={stack ? <button type="button" className="sl-link" onClick={act.removeStack}>풀기</button> : <button type="button" className="sl-link" onClick={act.makeStack}>만들기 (Shift+A)</button>}
      >
        {stack ? (
          <>
            <div className="sl-field-row">
              <TB label="가로로 늘어놓기" pressed={stack.dir === 'row'} onClick={() => act.setStack({ dir: 'row' })}><Columns3 size={16} /></TB>
              <TB label="세로로 쌓기" pressed={stack.dir === 'column'} onClick={() => act.setStack({ dir: 'column' })}><Rows3 size={16} /></TB>
              <span className="sl-sep" />
              {['start', 'center', 'end'].map((a) => (
                <TB key={a} label={{ start: '앞쪽 맞춤', center: '가운데 맞춤', end: '뒤쪽 맞춤' }[a]} pressed={(stack.align || 'start') === a} onClick={() => act.setStack({ align: a })}>
                  {stack.dir === 'row' ? { start: <AlignStartHorizontal size={16} />, center: <AlignCenterHorizontal size={16} />, end: <AlignEndHorizontal size={16} /> }[a] : { start: <AlignStartVertical size={16} />, center: <AlignCenterVertical size={16} />, end: <AlignEndVertical size={16} /> }[a]}
                </TB>
              ))}
            </div>
            <div className="sl-grid2">
              <ScrubField label="간격" value={stack.gap || 0} min={0} max={2000} onChange={(v) => act.setStack({ gap: v })} onLive={(v) => act.setStack({ gap: v }, true)} onEnd={act.endLive} />
              <ScrubField label="안쪽" title="안쪽 여백(배경 도형이 있을 때)" value={stack.pad || 0} min={0} max={1000} onChange={(v) => act.setStack({ pad: v })} onLive={(v) => act.setStack({ pad: v }, true)} onEnd={act.endLive} />
            </div>
            <p className="sl-hint">{stack.frame ? '배경 도형이 내용에 맞춰 늘고 줄어듭니다.' : '요소 크기를 바꾸거나 끌어서 순서를 바꾸면 나머지가 다시 줄을 섭니다.'}</p>
          </>
        ) : (
          <p className="sl-hint">고른 요소를 한 줄로 묶어 간격을 고정합니다. 모두를 감싸는 도형이 있으면 배경이 됩니다.</p>
        )}
      </Section>

      {allText && (
        <Section title="글">
          <Seg label="크기 조절" value={selEls[0].style?.sizing || 'fixed'} options={[{ id: 'auto-w', name: '자동 너비' }, { id: 'auto-h', name: '자동 높이' }, { id: 'fixed', name: '고정 크기' }]} onChange={(v) => setStyle({ sizing: v })} />
          <div className="sl-grid2">
            <ScrubField label="자간" title="자간(글자 크기의 %)" value={Math.round((selEls[0].style?.tracking || 0) * 100)} min={-20} max={100} suffix="%" onChange={(v) => setStyle({ tracking: v / 100 })} onLive={(v) => setStyle({ tracking: v / 100 }, true)} onEnd={act.endLive} />
            <ScrubField label="행간" title="줄 높이(배)" value={selEls[0].style?.lineHeight || 1.4} step={0.05} min={0.6} max={4} onChange={(v) => setStyle({ lineHeight: v })} onLive={(v) => setStyle({ lineHeight: v }, true)} onEnd={act.endLive} />
            <ScrubField label="문단" title="문단 간격(px)" value={selEls[0].style?.paraSpacing || 0} min={0} max={400} onChange={(v) => setStyle({ paraSpacing: v })} onLive={(v) => setStyle({ paraSpacing: v }, true)} onEnd={act.endLive} />
            <ScrubField label="여백" title="상자 안쪽 여백" value={selEls[0].style?.pad ?? 8} min={0} max={200} onChange={(v) => setStyle({ pad: v })} onLive={(v) => setStyle({ pad: v }, true)} onEnd={act.endLive} />
          </div>
          <div className="sl-mt">
            <Seg label="대소문자" value={selEls[0].style?.textTransform || 'none'} options={[{ id: 'none', name: '그대로' }, { id: 'uppercase', name: 'AB' }, { id: 'lowercase', name: 'ab' }, { id: 'capitalize', name: 'Ab' }]} onChange={(v) => setStyle({ textTransform: v })} />
          </div>
          {(selEls[0].style?.sizing || 'fixed') === 'fixed' && (
            <label className="sl-check">
              <input type="checkbox" checked={selEls[0].style?.autofit !== false} onChange={(e) => setStyle({ autofit: e.target.checked })} /> 넘치면 글자 줄이기
            </label>
          )}
          <ShadowEditor label="글자 그림자" value={selEls[0].style?.textShadow || null} theme={theme} onChange={(v) => setStyle({ textShadow: v || undefined })} />
          <p className="sl-hint">링크: 글을 고르고 {/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}K</p>
        </Section>
      )}

      {one?.type === 'text' && (
        <Section title="상자 채우기">
          <FillEditor s={s} theme={theme} setStyle={setStyle} />
        </Section>
      )}
      {one?.type === 'shape' && (
        <Section title={shapeKind === 'icon' ? '아이콘' : '도형'}>
          {shapeKind === 'icon' ? (
            <div className="sl-field-row">
              <ColorButton label="색" value={s.color || '@accent'} theme={theme} onPick={(v) => setStyle({ color: v || '@accent' })} icon={<span className="sl-mini-label">색</span>} />
              <ScrubField label="두께" value={s.strokeWidth || 2} step={0.5} min={0.5} max={10} onChange={(v) => setStyle({ strokeWidth: v })} />
            </div>
          ) : shapeKind === 'line' ? (
            <>
              <div className="sl-field-row">
                <ColorButton label="선 색" value={s.stroke || '@text'} theme={theme} onPick={(v) => setStyle({ stroke: v || '@text' })} icon={<span className="sl-mini-label">선 색</span>} />
                <ScrubField label="두께" value={s.strokeWidth || 6} step={0.5} min={0.5} max={80} onChange={(v) => setStyle({ strokeWidth: v })} />
              </div>
              <div className="sl-mt">
                <Seg label="선 모양" value={s.strokeStyle || 'solid'} options={[{ id: 'solid', name: '실선' }, { id: 'dashed', name: '파선' }, { id: 'dotted', name: '점선' }]} onChange={(v) => setStyle({ strokeStyle: v })} />
              </div>
              <label className="sl-check">
                <input type="checkbox" checked={!!s.arrowEnd} onChange={(e) => setStyle({ arrowEnd: e.target.checked })} /> 끝에 화살표
              </label>
            </>
          ) : (
            <>
              <FillEditor s={s} theme={theme} setStyle={setStyle} />
              <div className="sl-field-row sl-mt">
                <ColorButton label="선" value={s.stroke || null} theme={theme} allowNone onPick={(v) => setStyle({ stroke: v, strokeWidth: v ? s.strokeWidth || 4 : 0 })} icon={<span className="sl-mini-label">선</span>} />
                {s.stroke && <ScrubField label="두께" value={s.strokeWidth || 4} step={0.5} min={0.5} max={80} onChange={(v) => setStyle({ strokeWidth: v })} />}
              </div>
              {s.stroke && (
                <div className="sl-mt">
                  <Seg label="선 모양" value={s.strokeStyle || 'solid'} options={[{ id: 'solid', name: '실선' }, { id: 'dashed', name: '파선' }, { id: 'dotted', name: '점선' }]} onChange={(v) => setStyle({ strokeStyle: v })} />
                </div>
              )}
            </>
          )}
        </Section>
      )}
      {one?.type === 'image' && (
        <Section title="이미지">
          <Seg label="맞춤" value={s.fit || 'cover'} options={[{ id: 'cover', name: '채우기' }, { id: 'contain', name: '맞추기' }, { id: 'fill', name: '늘이기' }]} onChange={(v) => setStyle({ fit: v })} />
          <div className="sl-mt">
            <Seg label="모양 자르기" value={s.mask || 'none'} options={[{ id: 'none', name: '그대로' }, { id: 'rounded', name: '둥글게' }, { id: 'circle', name: '원' }]} onChange={(v) => setStyle({ mask: v })} />
          </div>
          <div className="sl-sliders">
            {(s.fit || 'cover') !== 'fill' && (
              <>
                <label>
                  가로 위치 <input type="range" min={0} max={100} value={s.posX ?? 50} onChange={(e) => setStyle({ posX: +e.target.value }, true)} onPointerUp={act.endLive} />
                </label>
                <label>
                  세로 위치 <input type="range" min={0} max={100} value={s.posY ?? 50} onChange={(e) => setStyle({ posY: +e.target.value }, true)} onPointerUp={act.endLive} />
                </label>
              </>
            )}
            <label>
              밝기 <input type="range" min={0} max={200} value={s.brightness ?? 100} onChange={(e) => setStyle({ brightness: +e.target.value }, true)} onPointerUp={act.endLive} />
            </label>
            <label>
              대비 <input type="range" min={0} max={200} value={s.contrast ?? 100} onChange={(e) => setStyle({ contrast: +e.target.value }, true)} onPointerUp={act.endLive} />
            </label>
          </div>
          <div className="sl-field-row sl-mt">
            <button type="button" className="sl-btn sl-btn--small" onClick={act.replaceImage}>
              <ImagePlus size={16} /> 이미지 바꾸기
            </button>
          </div>
          <label className="sl-text-field">
            <span>대체 글</span>
            <input defaultValue={one.data?.alt || ''} key={one.id} maxLength={200} onBlur={(e) => e.target.value !== (one.data?.alt || '') && act.updateSel((x) => ({ ...x, data: { ...x.data, alt: e.target.value } }))} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        </Section>
      )}
      {one?.type === 'table' && (
        <Section title="표">
          <div className="sl-field-row">
            <ColorButton label="머리글 채우기" value={s.headerFill || '@accent'} theme={theme} onPick={(v) => setStyle({ headerFill: v || '@accent' })} icon={<span className="sl-mini-label">머리글</span>} />
            <ColorButton label="머리글 글자" value={s.headerColor || '@bg'} theme={theme} onPick={(v) => setStyle({ headerColor: v || '@bg' })} icon={<span className="sl-mini-label">머리글 글자</span>} />
            <ColorButton label="선 색" value={s.line || '@muted'} theme={theme} onPick={(v) => setStyle({ line: v || '@muted' })} icon={<span className="sl-mini-label">선</span>} />
          </div>
          <label className="sl-check">
            <input type="checkbox" checked={one.data?.header !== false} onChange={(e) => act.updateSel((x) => ({ ...x, data: { ...x.data, header: e.target.checked } }))} /> 첫 줄을 머리글로
          </label>
        </Section>
      )}
      {one?.type === 'embed' && (
        <Section title="링크 카드">
          <p className="sl-hint sl-break">{one.data?.url}</p>
          {one.data?.embedUrl && <p className="sl-hint">발표 모드에서 바로 재생합니다.</p>}
        </Section>
      )}

      <Section title="효과">
        <ShadowEditor value={selEls[0].style?.shadow || null} theme={theme} onChange={(v) => setStyle({ shadow: v || undefined })} />
        <div className="sl-grid2 sl-mt">
          <ScrubField label="흐림" title="레이어 흐림(px)" value={selEls[0].style?.blur || 0} min={0} max={200} onChange={(v) => setStyle({ blur: v || undefined })} onLive={(v) => setStyle({ blur: v || undefined }, true)} onEnd={act.endLive} />
        </div>
      </Section>

      <Section title="순서와 묶기">
        <div className="sl-iconrow">
          <TB label="맨 앞으로" onClick={() => act.layer('front')}><ArrowUpToLine size={18} /></TB>
          <TB label="앞으로" onClick={() => act.layer('forward')}><ArrowUp size={18} /></TB>
          <TB label="뒤로" onClick={() => act.layer('backward')}><ArrowDown size={18} /></TB>
          <TB label="맨 뒤로" onClick={() => act.layer('back')}><ArrowDownToLine size={18} /></TB>
          <TB label="묶기" disabled={selEls.length < 2} onClick={act.group}><Group size={18} /></TB>
          <TB label="묶음 풀기" disabled={!grouped} onClick={act.ungroup}><Ungroup size={18} /></TB>
          <TB label={allLocked ? '잠금 풀기' : '잠그기'} pressed={allLocked} onClick={act.toggleLock}>{allLocked ? <Lock size={18} /> : <LockOpen size={18} />}</TB>
          <TB label="삭제" onClick={act.deleteSel}><Trash2 size={18} /></TB>
        </div>
      </Section>

      <Section title="등장 효과">
        <Seg label="등장 효과" value={one ? one.anim?.type || '' : ''} options={ANIMS} onChange={(v) => act.setAnim(v)} />
        {one?.anim && <NumField label="순서" value={one.anim.order || 1} min={1} max={50} onChange={(v) => act.updateSel((e) => ({ ...e, anim: { ...e.anim, order: v } }))} />}
        <p className="sl-hint">발표할 때 누를 때마다 순서대로 나타납니다.</p>
      </Section>
      {types.length > 1 && <p className="sl-hint sl-pad">종류가 다른 요소를 함께 골랐습니다. 위치, 크기, 효과, 순서를 함께 바꿀 수 있습니다.</p>}
    </fieldset>
  )
}

/** 레이어: 위에 있는 것부터. 묶음은 접고 펼친다. 끌어서 순서를 바꾼다 */
function LayersTab({ slide, sel, canEdit, act }) {
  const [closed, setClosed] = useState(() => new Set())
  const [drag, setDrag] = useState(null) // { ids, over, pos }
  const [renaming, setRenaming] = useState(null)
  if (!slide) return null
  const els = [...slide.elements].sort((a, b) => (b.z || 0) - (a.z || 0))
  if (!els.length) return <p className="sl-hint sl-pad">이 슬라이드에는 요소가 없습니다.</p>
  const rows = []
  const seen = new Set()
  for (const e of els) {
    if (e.group) {
      if (seen.has(e.group)) continue
      seen.add(e.group)
      const members = els.filter((x) => x.group === e.group)
      rows.push({ kind: 'group', id: e.group, members })
      if (!closed.has(e.group)) members.forEach((m) => rows.push({ kind: 'el', el: m, depth: 1 }))
    } else rows.push({ kind: 'el', el: e, depth: 0 })
  }
  const dropProps = (targetId, groupTarget) => ({
    onDragOver: (ev) => {
      if (!drag || !canEdit) return
      ev.preventDefault()
      const r = ev.currentTarget.getBoundingClientRect()
      const pos = ev.clientY < r.top + r.height / 2 ? 'above' : 'below'
      if (drag.over !== targetId || drag.pos !== pos) setDrag({ ...drag, over: targetId, pos })
    },
    onDrop: (ev) => {
      ev.preventDefault()
      if (drag && !drag.ids.includes(targetId)) act.reorderLayers(drag.ids, targetId, drag.pos, groupTarget, drag.whole)
      setDrag(null)
    },
  })
  const rowCls = (id) => (drag && drag.over === id ? `is-drop-${drag.pos}` : '')
  return (
    <ul className="sl-layers" aria-label="레이어">
      {rows.map((r) => {
        if (r.kind === 'group') {
          const ids = r.members.map((m) => m.id)
          const on = ids.every((x) => sel.includes(x))
          const isStack = !!slide.stacks?.[r.id]
          const open = !closed.has(r.id)
          return (
            <li
              key={`g-${r.id}`}
              className={`sl-layer sl-layer--group ${on ? 'is-on' : ''} ${rowCls(r.id)}`}
              draggable={canEdit}
              onDragStart={(ev) => {
                ev.dataTransfer.effectAllowed = 'move'
                ev.dataTransfer.setData('text/x-dah-layer', r.id)
                setDrag({ ids, over: null, pos: null, whole: true })
              }}
              onDragEnd={() => setDrag(null)}
              {...dropProps(r.id, null)}
              onClick={(ev) => act.selectIds(ids, ev.shiftKey)}
            >
              <button type="button" className="sl-layer__chev" aria-label={open ? '접기' : '펼치기'} onClick={(ev) => { ev.stopPropagation(); setClosed((c) => { const n = new Set(c); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n }) }}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <span className="sl-layer__icon">{isStack ? <Rows3 size={14} /> : <Group size={14} />}</span>
              <span className="sl-layer__name">{isStack ? '자동 배치' : '묶음'} <em>{r.members.length}</em></span>
            </li>
          )
        }
        const e = r.el
        const on = sel.includes(e.id)
        return (
          <li
            key={e.id}
            className={`sl-layer ${on ? 'is-on' : ''} ${e.hidden ? 'is-hidden' : ''} ${rowCls(e.id)}`}
            style={{ paddingLeft: 8 + r.depth * 18 }}
            draggable={canEdit && renaming !== e.id}
            onDragStart={(ev) => {
              ev.dataTransfer.effectAllowed = 'move'
              ev.dataTransfer.setData('text/x-dah-layer', e.id)
              const ids = on ? sel : [e.id]
              setDrag({ ids, over: null, pos: null, whole: false })
            }}
            onDragEnd={() => setDrag(null)}
            {...dropProps(e.id, e.group || null)}
            onClick={(ev) => act.selectIds([e.id], ev.shiftKey, true)}
            onDoubleClick={() => canEdit && setRenaming(e.id)}
          >
            <span className="sl-layer__icon"><TypeIcon e={e} /></span>
            {renaming === e.id ? (
              <input
                className="sl-layer__input"
                defaultValue={e.name || elementName(e)}
                autoFocus
                maxLength={80}
                onClick={(ev) => ev.stopPropagation()}
                onKeyDown={(ev) => {
                  ev.stopPropagation()
                  if (ev.key === 'Enter') ev.currentTarget.blur()
                  if (ev.key === 'Escape') setRenaming(null)
                }}
                onBlur={(ev) => {
                  const v = ev.target.value.trim()
                  if (renaming === e.id && v !== (e.name || elementName(e))) act.renameEl(e.id, v)
                  setRenaming(null)
                }}
              />
            ) : (
              <span className="sl-layer__name" title="두 번 눌러 이름 바꾸기">{elementName(e)}</span>
            )}
            {canEdit && (
              <span className={`sl-layer__tools ${e.locked || e.hidden ? 'is-sticky' : ''}`}>
                <button type="button" className={e.locked ? 'is-active' : ''} aria-label={e.locked ? '잠금 풀기' : '잠그기'} title={e.locked ? '잠금 풀기' : '잠그기'} onClick={(ev) => { ev.stopPropagation(); act.toggleElLock(e.id) }}>
                  {e.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
                <button type="button" className={e.hidden ? 'is-active' : ''} aria-label={e.hidden ? '보이기' : '숨기기'} title={e.hidden ? '보이기' : '숨기기'} onClick={(ev) => { ev.stopPropagation(); act.toggleElHidden(e.id) }}>
                  {e.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </span>
            )}
          </li>
        )
      })}
      <li className="sl-layers__foot sl-hint">끌어서 겹침 순서를 바꿉니다. 묶음 안으로 끌면 그 묶음에 들어갑니다.</li>
    </ul>
  )
}

export default function SidePanel({ tab, setTab, deck, slide, selEls, sel, canEdit, act, stackOf }) {
  return (
    <aside className="sl-panel" aria-label="속성">
      {canEdit && selEls.length > 0 && <AlignBar act={act} />}
      <div className="sl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="sl-panel__body">
        {tab === 'design' && <DesignTab deck={deck} slide={slide} canEdit={canEdit} act={act} />}
        {tab === 'layout' && <LayoutTab deck={deck} slide={slide} canEdit={canEdit} act={act} />}
        {tab === 'format' && <FormatTab deck={deck} slide={slide} selEls={selEls} canEdit={canEdit} act={act} stackOf={stackOf} />}
        {tab === 'layers' && <LayersTab slide={slide} sel={sel} canEdit={canEdit} act={act} />}
      </div>
    </aside>
  )
}
