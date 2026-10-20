// 보드 둘레 패널: 캔버스 탭, 템플릿 고르기, 단축키 도움말, 댓글, 오른쪽 클릭 메뉴.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Ellipsis, MessageSquare, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { COLORS } from './palette'
import { TEMPLATES, buildTemplate } from './templates'
import { boundsOf } from './geometry'
import { itemLine } from './exporters'

/** 바깥을 누르거나 Esc를 누르면 닫히는 떠 있는 상자 */
export function useDismiss(open, onClose, ref) {
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [open, onClose, ref])
}

// ── 캔버스 탭 ─────────────────────────────────────────
export function CanvasTabs({ canvases, active, canEdit, onSwitch, onAdd, onRename, onDuplicate, onMove, onDelete, onReorder }) {
  const [menu, setMenu] = useState(null) // { id, x, y }
  const [dragId, setDragId] = useState(null)
  const ref = useRef(null)
  useDismiss(Boolean(menu), () => setMenu(null), ref)
  const idx = menu ? canvases.findIndex((c) => c.id === menu.id) : -1
  return (
    <div className="bd-tabsbar" role="tablist" aria-label="캔버스">
      {canEdit && (
        <button type="button" className="bd-icon-btn" onClick={onAdd} aria-label="캔버스 추가" title="캔버스 추가">
          <Plus size={18} />
        </button>
      )}
      <div className="bd-tabsbar__list">
        {canvases.map((c) => (
          <div
            key={c.id}
            role="tab"
            tabIndex={0}
            aria-label={c.name}
            aria-selected={c.id === active}
            className={`bd-ctab ${c.id === active ? 'is-on' : ''} ${dragId === c.id ? 'is-drag' : ''}`}
            draggable={canEdit}
            onDragStart={(e) => {
              setDragId(c.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/x-dah-canvas', c.id)
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => {
              if (dragId && dragId !== c.id) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && dragId !== c.id) onReorder(dragId, c.id)
              setDragId(null)
            }}
            onClick={() => onSwitch(c.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSwitch(c.id)}
            onDoubleClick={() => canEdit && onRename(c.id)}
            onContextMenu={(e) => {
              if (!canEdit) return
              e.preventDefault()
              setMenu({ id: c.id, x: e.clientX, y: e.clientY })
            }}
          >
            <span className="bd-ctab__name">{c.name}</span>
            {canEdit && c.id === active && (
              <button
                type="button"
                className="bd-ctab__more"
                aria-label="캔버스 메뉴"
                onClick={(e) => {
                  e.stopPropagation()
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({ id: c.id, x: r.left, y: r.top })
                }}
              >
                <Ellipsis size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {menu && (
        <div ref={ref} className="bd-menu" role="menu" style={{ left: menu.x, top: menu.y, transform: 'translateY(calc(-100% - 6px))' }}>
          <MenuItem onClick={() => { setMenu(null); onRename(menu.id) }}>이름 바꾸기</MenuItem>
          <MenuItem onClick={() => { setMenu(null); onDuplicate(menu.id) }}>복제</MenuItem>
          <MenuItem disabled={idx <= 0} onClick={() => { setMenu(null); onMove(menu.id, -1) }}>왼쪽으로 옮기기</MenuItem>
          <MenuItem disabled={idx >= canvases.length - 1} onClick={() => { setMenu(null); onMove(menu.id, 1) }}>오른쪽으로 옮기기</MenuItem>
          <MenuItem danger disabled={canvases.length <= 1} onClick={() => { setMenu(null); onDelete(menu.id) }}>삭제</MenuItem>
        </div>
      )}
    </div>
  )
}

export function MenuItem({ children, onClick, disabled, danger, hint }) {
  return (
    <button type="button" role="menuitem" className={`bd-menu__item ${danger ? 'is-danger' : ''}`} disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {hint && <span className="bd-menu__hint">{hint}</span>}
    </button>
  )
}
export const MenuSep = () => <div className="bd-menu__sep" role="separator" />

// ── 템플릿 ────────────────────────────────────────────
const TemplateThumb = memo(function TemplateThumb({ id }) {
  const t = useMemo(() => buildTemplate(id), [id])
  const W = 200
  const H = 120
  if (!t.items.length) return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="bd-tpl__svg" aria-hidden="true" />
  const b = boundsOf(t.items)
  const s = Math.min((W - 16) / b.w, (H - 16) / b.h)
  const ox = (W - b.w * s) / 2 - b.x * s
  const oy = (H - b.h * s) / 2 - b.y * s
  const fill = (it) => {
    if (it.type === 'frame') return '#ffffff'
    if (it.type === 'text') return '#1f1f1f'
    if (it.color) return COLORS[it.color].fill
    if (it.type === 'sticky') return COLORS.yellow.fill
    return '#c9c9c9'
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="bd-tpl__svg" aria-hidden="true">
      {t.items.map((it) => (
        <rect
          key={it.id}
          x={ox + it.x * s}
          y={oy + it.y * s + (it.type === 'text' ? it.h * s * 0.3 : 0)}
          width={Math.max(1, it.w * s * (it.type === 'text' ? 0.5 : 1))}
          height={Math.max(1, it.type === 'text' ? Math.max(1.5, it.h * s * 0.35) : it.h * s)}
          rx={it.data?.shape === 'ellipse' ? (it.w * s) / 2 : 1}
          fill={fill(it)}
        />
      ))}
    </svg>
  )
})

export function TemplatePicker({ mode, onPick, onClose }) {
  const panel = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    panel.current?.querySelector('button.bd-tpl')?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const list = mode === 'insert' ? TEMPLATES.filter((t) => t.id !== 'blank') : TEMPLATES
  return (
    <div className="bd-modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="bd-modal__panel bd-modal__panel--wide" role="dialog" aria-modal="true" aria-label={mode === 'insert' ? '템플릿 넣기' : '새 캔버스'}>
        <div className="bd-modal__head">
          <h2>{mode === 'insert' ? '템플릿 넣기' : '새 캔버스'}</h2>
          <button type="button" className="bd-icon-btn" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <p className="bd-modal__sub">{mode === 'insert' ? '지금 보고 있는 캔버스 가운데에 넣습니다' : '빈 캔버스나 수업에서 자주 쓰는 틀로 시작합니다'}</p>
        <div className="bd-tpl-grid">
          {list.map((t) => (
            <button key={t.id} type="button" className="bd-tpl" onClick={() => onPick(t.id)}>
              <TemplateThumb id={t.id} />
              <span className="bd-tpl__name">{t.name}</span>
              <span className="bd-tpl__desc">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 단축키 ────────────────────────────────────────────
export function ShortcutHelp({ mod, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    ref.current?.querySelector('button')?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const groups = [
    ['도구', [['V', '선택'], ['H 또는 Space 누른 채 끌기', '화면 이동'], ['N', '포스트잇'], ['R', '사각형'], ['O', '타원'], ['T', '글자'], ['F', '프레임'], ['P', '펜'], ['Shift+P', '형광펜'], ['E', '지우개']]],
    ['편집', [[`${mod}Z`, '실행취소'], [`${mod}Shift+Z`, '다시 실행'], [`${mod}C · ${mod}V`, '복사 · 붙여넣기'], [`${mod}D`, '복제'], ['Delete', '삭제'], [`${mod}A`, '모두 선택'], ['Enter', '글 고치기'], ['방향키', '1px 옮기기 (Shift: 10px)']]],
    ['정리', [[`${mod}G`, '묶기'], [`${mod}Shift+G`, '묶음 풀기'], [`${mod}Shift+L`, '잠그기 · 풀기'], [']', '앞으로'], ['[', '뒤로'], [`${mod}]`, '맨 앞으로'], [`${mod}[`, '맨 뒤로'], [`${mod}'`, '격자에 맞추기']]],
    ['보기', [[`${mod}F`, '찾기'], [`${mod}+ · ${mod}-`, '확대 · 축소'], [`${mod}0`, '100%'], ['Shift+1', '화면에 맞추기'], ['?', '이 도움말']]],
  ]
  return (
    <div className="bd-modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="bd-modal__panel bd-modal__panel--wide" role="dialog" aria-modal="true" aria-label="단축키">
        <div className="bd-modal__head">
          <h2>단축키</h2>
          <button type="button" className="bd-icon-btn" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="bd-keys">
          {groups.map(([name, rows]) => (
            <section key={name}>
              <h3>{name}</h3>
              <dl>
                {rows.map(([k, v]) => (
                  <div key={k + v} className="bd-keys__row">
                    <dt>{v}</dt>
                    <dd><kbd>{k}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 댓글 ─────────────────────────────────────────────
const when = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function CommentsPanel({ canvas, focusId, selectedId, me, canEdit, onAdd, onResolve, onDelete, onJump, onClose }) {
  const [showResolved, setShowResolved] = useState(false)
  const [text, setText] = useState('')
  const target = selectedId || focusId
  const itemsById = useMemo(() => new Map(canvas.items.map((i) => [i.id, i])), [canvas.items])
  const threads = useMemo(() => {
    const m = new Map()
    for (const c of canvas.comments) {
      if (!showResolved && c.resolved) continue
      if (!m.has(c.itemId)) m.set(c.itemId, [])
      m.get(c.itemId).push(c)
    }
    return [...m.entries()].map(([itemId, list]) => ({ itemId, list: list.sort((a, b) => a.at.localeCompare(b.at)) }))
  }, [canvas.comments, showResolved])
  const listRef = useRef(null)
  useEffect(() => {
    if (!focusId) return
    listRef.current?.querySelector(`[data-thread="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusId])
  const label = (id) => {
    const it = itemsById.get(id)
    if (!it) return '항목'
    const t = it.type === 'frame' ? it.data.name || '프레임' : itemLine(it)
    return (t || { image: '그림', stroke: '펜 그림', video: '영상' }[it.type] || '항목').slice(0, 40)
  }
  const submit = () => {
    const v = text.trim()
    if (!v || !target) return
    onAdd(target, v)
    setText('')
  }
  return (
    <aside className="bd-floating bd-side" aria-label="댓글">
      <div className="bd-side__head">
        <h2>댓글</h2>
        <button type="button" className={`bd-chip ${showResolved ? 'is-on' : ''}`} onClick={() => setShowResolved((v) => !v)} aria-pressed={showResolved}>
          해결됨 보기
        </button>
        <button type="button" className="bd-icon-btn" onClick={onClose} aria-label="댓글 닫기">
          <X size={16} />
        </button>
      </div>
      <div className="bd-side__list" ref={listRef}>
        {!threads.length && <p className="bd-modal__note">{showResolved ? '댓글이 없습니다' : '열린 댓글이 없습니다. 항목을 고르고 아래에 댓글을 남기세요'}</p>}
        {threads.map(({ itemId, list }) => (
          <div key={itemId} data-thread={itemId} className={`bd-thread ${itemId === target ? 'is-on' : ''}`}>
            <button type="button" className="bd-thread__item" onClick={() => onJump(itemId)}>
              <MessageSquare size={14} aria-hidden="true" />
              <span>{label(itemId)}</span>
            </button>
            {list.map((c) => (
              <div key={c.id} className={`bd-comment ${c.resolved ? 'is-resolved' : ''}`}>
                <div className="bd-comment__meta">
                  <strong>{c.author}</strong>
                  <span>{when(c.at)}</span>
                  {canEdit && (
                    <span className="bd-comment__acts">
                      <button type="button" className="bd-icon-btn bd-icon-btn--sm" onClick={() => onResolve(c.id, !c.resolved)} title={c.resolved ? '다시 열기' : '해결'} aria-label={c.resolved ? '다시 열기' : '해결'}>
                        {c.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
                      </button>
                      <button type="button" className="bd-icon-btn bd-icon-btn--sm" onClick={() => onDelete(c.id)} title="삭제" aria-label="삭제">
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </div>
                <p className="bd-comment__text">{c.text}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="bd-side__compose">
          <p className="bd-side__target">{target ? `${label(target)}에 남기기` : '댓글을 남길 항목을 하나 고르세요'}</p>
          <textarea
            value={text}
            disabled={!target}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            maxLength={2000}
            placeholder={me ? `${me}(으)로 댓글 쓰기` : '댓글 쓰기'}
            aria-label="댓글 쓰기"
          />
          <button type="button" className="bd-btn" disabled={!target || !text.trim()} onClick={submit}>
            남기기
          </button>
        </div>
      )}
    </aside>
  )
}
