// 보드 위 항목 하나. 위치·크기는 부모가 정하고 여기서는 모양과 글 편집만 맡는다.
// 종류: 메모·키워드·링크·이미지·영상·우리 파일(1차) + 포스트잇·도형·글자·펜 획·프레임(2차).
// 끌기·크기 조절·연결은 BoardEditor가 data-* 속성(data-item-id, data-handle, data-resize, data-nodrag)으로 알아본다.
import { memo, useLayoutEffect, useRef } from 'react'
import { ExternalLink, ImageOff, Link2, Lock, MessageSquare, PlayCircle } from 'lucide-react'
import { BoardsIcon, DocsIcon, FormsIcon, SheetsIcon, SlidesIcon } from '../workspace/icons'
import { hostnameOf, parseVideo, sanitizeMemoHtml } from './sanitize'
import { COLORS } from './palette'
import { strokePath } from './geometry'
import { useFilePreview } from './connect'

export const FILE_META = {
  doc: { label: 'DAH Docs', Icon: DocsIcon },
  sheet: { label: 'DAH Sheet', Icon: SheetsIcon },
  form: { label: 'DAH Form', Icon: FormsIcon },
  slide: { label: 'DAH Slides', Icon: SlidesIcon },
  board: { label: 'DAH Board', Icon: BoardsIcon },
}

/** 우리 파일 카드의 주소. 숫자 id로만 만든다 */
export function fileHref(d) {
  if (d.kind === 'doc' && d.tabId) return `/docs/${d.tabId}`
  if (d.kind === 'sheet' && d.fileId) return `/sheets/${d.fileId}`
  if (d.kind === 'form' && d.fileId) return `/form/${d.fileId}/edit`
  if (d.kind === 'slide' && d.fileId) return `/slides/${d.fileId}`
  if (d.kind === 'board' && d.fileId) return `/boards/${d.fileId}`
  return null
}

export const STICKY_DEFAULT = 'yellow'
const SITE_LABEL = { figma: 'Figma', notion: 'Notion', youtube: 'YouTube' }

/** 포스트잇·도형·글자의 여러 줄 글 편집 */
function TextEdit({ item, field = 'text', className, placeholder, onCommit, onEndEdit, autoHeight }) {
  const text = item.data[field] || ''
  return (
    <textarea
      className={`bd-textedit ${className || ''}`}
      defaultValue={text}
      autoFocus
      maxLength={10000}
      placeholder={placeholder}
      aria-label="글 쓰기"
      onFocus={(e) => {
        const el = e.currentTarget
        el.setSelectionRange(el.value.length, el.value.length)
      }}
      onInput={autoHeight ? (e) => {
        const el = e.currentTarget
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      } : undefined}
      onBlur={(e) => {
        const v = e.currentTarget.value
        const patch = autoHeight ? { h: Math.max(Math.round(e.currentTarget.scrollHeight), 24) } : null
        if (v !== text || (patch && patch.h !== item.h)) onCommit(item.id, { [field]: v }, patch)
        onEndEdit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        e.stopPropagation()
      }}
    />
  )
}

function MemoBody({ item, editing, onCommit, onEndEdit }) {
  const ref = useRef(null)
  const html = item.data.html || ''
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !editing) return
    el.innerHTML = sanitizeMemoHtml(html)
    el.focus()
    // Enter로 새 줄을 만들면 div 대신 p를 쓴다
    document.execCommand('defaultParagraphSeparator', false, 'p')
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(r)
    // 편집을 시작할 때 한 번만 채운다(입력 중에 다시 그리면 커서가 튄다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  if (editing) {
    return (
      <div
        ref={ref}
        className="bd-memo__body bd-memo__body--edit"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="메모 내용"
        onBlur={(e) => {
          const next = sanitizeMemoHtml(e.currentTarget.innerHTML)
          if (next !== html) onCommit(item.id, { html: next })
          onEndEdit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
    )
  }
  const clean = sanitizeMemoHtml(html)
  return clean ? <div className="bd-memo__body" dangerouslySetInnerHTML={{ __html: clean }} /> : <div className="bd-memo__body bd-empty">두 번 눌러 메모 쓰기</div>
}

function KeywordBody({ item, editing, onCommit, onEndEdit }) {
  const text = item.data.text || ''
  if (editing) {
    return (
      <input
        className="bd-keyword__input"
        defaultValue={text}
        autoFocus
        maxLength={200}
        aria-label="키워드"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim()
          if (v !== text) onCommit(item.id, { text: v })
          onEndEdit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
    )
  }
  return <span className={`bd-keyword__text ${text ? '' : 'bd-empty'}`}>{text || '키워드'}</span>
}


function Dot({ color }) {
  if (!color) return null
  return <span className="bd-dot" style={{ background: COLORS[color]?.fill }} aria-hidden="true" />
}

function ImageBody({ item }) {
  const { src, alt } = item.data
  if (!src) {
    return (
      <div className="bd-image bd-image--empty">
        <ImageOff size={20} aria-hidden="true" />
        <span>이미지를 불러오지 못했습니다</span>
      </div>
    )
  }
  return (
    <div className="bd-image">
      <img src={src} alt={alt || ''} draggable={false} loading="lazy" referrerPolicy="no-referrer" />
      {item.color && <span className="bd-image__dot"><Dot color={item.color} /></span>}
    </div>
  )
}

function VideoBody({ item, selected, readOnly }) {
  const v = parseVideo(item.data.url)
  return (
    <div className="bd-video">
      <div className="bd-card__head bd-video__head">
        <Dot color={item.color} />
        <PlayCircle size={14} aria-hidden="true" />
        <span className="bd-card__meta">{v ? (v.provider === 'youtube' ? 'YouTube' : 'Vimeo') : '영상'}</span>
        {v && (
          <a className="bd-card__open" data-nodrag href={v.url} target="_blank" rel="noopener noreferrer nofollow" title="새 탭에서 열기" aria-label="새 탭에서 열기">
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <div className="bd-video__frame">
        {v ? (
          <iframe
            src={v.embed}
            title={item.data.title || '영상'}
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          <span className="bd-empty">지원하지 않는 영상 주소</span>
        )}
        {/* 편집자는 선택하기 전에는 덮개가 눌림을 받아 끌 수 있게 한다. 선택하면(보기 전용이면 처음부터) 영상을 조작할 수 있다 */}
        {!selected && !readOnly && <div className="bd-video__cover" />}
      </div>
    </div>
  )
}


function StickyBody({ item, editing, readOnly, onCommit, onEndEdit }) {
  const text = item.data.text || ''
  const fs = Math.max(13, Math.min(30, Math.round(item.w / (text.length > 80 ? 14 : text.length > 30 ? 11 : 9))))
  return (
    <div className="bd-sticky" style={{ fontSize: fs }}>
      {editing ? (
        <TextEdit item={item} className="bd-sticky__edit" placeholder="내용 적기" onCommit={onCommit} onEndEdit={onEndEdit} />
      ) : (
        <div className={`bd-sticky__text ${text ? '' : 'bd-empty'}`}>{text || (readOnly ? '' : '두 번 눌러 쓰기')}</div>
      )}
    </div>
  )
}

/** 도형 모양(상자 0..w, 0..h 안의 SVG) */
export function shapeSvg(shape, w, h, fill) {
  const p = { fill }
  if (shape === 'ellipse') return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...p} />
  if (shape === 'rounded') return <rect width={w} height={h} rx={Math.min(24, w / 4, h / 4)} {...p} />
  if (shape === 'diamond') return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...p} />
  if (shape === 'triangle') return <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} {...p} />
  if (shape === 'arrow') {
    const head = Math.min(w * 0.4, h * 0.9)
    return <polygon points={`0,${h * 0.22} ${w - head},${h * 0.22} ${w - head},0 ${w},${h / 2} ${w - head},${h} ${w - head},${h * 0.78} 0,${h * 0.78}`} {...p} />
  }
  return <rect width={w} height={h} rx="2" {...p} />
}

function ShapeBody({ item, editing, onCommit, onEndEdit }) {
  const c = item.color ? COLORS[item.color] : { fill: '#e2e2e2', text: '#1f1f1f' }
  const { shape, text } = item.data
  const inset = shape === 'diamond' || shape === 'triangle' ? '22%' : shape === 'ellipse' ? '14%' : '8px'
  return (
    <div className="bd-shape" style={{ color: c.text }}>
      <svg className="bd-shape__svg" width={item.w} height={item.h} viewBox={`0 0 ${item.w} ${item.h}`} aria-hidden="true">
        {shapeSvg(shape, item.w, item.h, c.fill)}
      </svg>
      <div className="bd-shape__text" style={{ padding: inset, paddingTop: shape === 'triangle' ? '40%' : inset }}>
        {editing ? (
          <TextEdit item={item} className="bd-shape__edit" onCommit={onCommit} onEndEdit={onEndEdit} />
        ) : (
          <span>{text}</span>
        )}
      </div>
    </div>
  )
}

function TextBody({ item, editing, readOnly, onCommit, onEndEdit }) {
  const { text, size, bold } = item.data
  const style = { fontSize: size, fontWeight: bold ? 700 : 400, color: item.color ? COLORS[item.color].fill : '#1f1f1f' }
  return (
    <div className="bd-text" style={style}>
      {editing ? (
        <TextEdit item={item} className="bd-text__edit" placeholder="글자" onCommit={onCommit} onEndEdit={onEndEdit} autoHeight />
      ) : (
        <div className={`bd-text__body ${text ? '' : 'bd-empty'}`}>{text || (readOnly ? '' : '글자')}</div>
      )}
    </div>
  )
}

function StrokeBody({ item }) {
  const { points, width, tool } = item.data
  const color = item.color ? COLORS[item.color].fill : tool === 'highlighter' ? COLORS.yellow.fill : '#1f1f1f'
  const d = strokePath(points)
  return (
    <svg className="bd-stroke" width={item.w} height={item.h} viewBox={`0 0 ${item.w} ${item.h}`} aria-hidden="true">
      <path d={d} className="bd-stroke__hit" strokeWidth={Math.max(width + 10, 14)} />
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={tool === 'highlighter' ? 0.45 : 1} />
    </svg>
  )
}

function FrameBody({ item, editing, onCommit, onEndEdit }) {
  const name = item.data.name || ''
  const c = item.color ? COLORS[item.color] : null
  return (
    <>
      <div className="bd-frame__label" style={c ? { background: c.fill, color: c.text } : undefined}>
        {editing ? (
          <input
            className="bd-frame__input"
            defaultValue={name}
            autoFocus
            maxLength={100}
            aria-label="프레임 이름"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim()
              if (v !== name) onCommit(item.id, { name: v })
              onEndEdit()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                e.currentTarget.blur()
              }
              e.stopPropagation()
            }}
          />
        ) : (
          name || '프레임'
        )}
      </div>
      <div className="bd-frame__area" />
    </>
  )
}

function LinkBody({ item, selected, readOnly }) {
  const { url, title, description, image, siteName, kind, embedUrl } = item.data
  const host = hostnameOf(url)
  const site = SITE_LABEL[kind] || siteName || host || '링크'
  const open = url && (
    <a className="bd-card__open bd-card__open--text" data-nodrag href={url} target="_blank" rel="noopener noreferrer nofollow" title="새 탭에서 열기">
      <ExternalLink size={14} aria-hidden="true" /> 열기
    </a>
  )
  if (embedUrl) {
    return (
      <div className="bd-video bd-embed">
        <div className="bd-card__head bd-video__head">
          <Dot color={item.color} />
          <Link2 size={14} aria-hidden="true" />
          <span className="bd-card__meta">{title && title !== host ? `${site} · ${title}` : site}</span>
          {open}
        </div>
        <div className="bd-video__frame bd-embed__frame">
          <iframe src={embedUrl} title={title || site} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
          {!selected && !readOnly && <div className="bd-video__cover" />}
        </div>
      </div>
    )
  }
  const wide = item.w >= 300 && item.h >= 200 && image
  return (
    <div className={`bd-link ${wide ? 'bd-link--wide' : ''}`}>
      {wide && <img className="bd-link__img" src={image} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      <div className="bd-link__body">
        <div className="bd-card__head">
          <Dot color={item.color} />
          <Link2 size={14} aria-hidden="true" />
          <span className="bd-card__meta">{site}</span>
          {open}
        </div>
        <div className="bd-link__row">
          <div className="bd-link__main">
            <p className="bd-link__title">{title || host || '링크'}</p>
            {description ? <p className="bd-link__desc">{description}</p> : <p className="bd-link__url">{url}</p>}
          </div>
          {!wide && image && <img className="bd-link__thumb" src={image} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        </div>
      </div>
    </div>
  )
}

function FilePreview({ kind, row }) {
  if (!row) return null
  if (kind === 'doc' && row.excerpt) {
    const lines = String(row.excerpt).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4)
    return lines.length ? <div className="bd-file__preview">{lines.map((l, i) => <p key={i}>{l}</p>)}</div> : null
  }
  if (kind === 'sheet' && Array.isArray(row.preview) && (row.preview.length || row.head?.length)) {
    const head = (row.head || []).slice(0, 4)
    return (
      <table className="bd-file__table">
        {head.length > 0 && (
          <thead>
            <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {row.preview.slice(0, 4).map((r, i) => (
            <tr key={i}>{r.slice(0, 4).map((c, k) => <td key={k}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (kind === 'board' && Number.isFinite(row.items) && row.items > 0) return <div className="bd-file__preview"><p>항목 {row.items}개</p></div>
  return null
}

function FileBody({ item }) {
  const d = item.data
  const meta = FILE_META[d.kind] || FILE_META.doc
  const href = fileHref(d)
  const Icon = meta.Icon
  const row = useFilePreview(d.kind, item.h >= 120 ? d.fileId : null)
  return (
    <div className="bd-file">
      <div className="bd-file__head">
        <Icon size={32} />
        <div className="bd-file__text">
          <span className="bd-card__meta">{meta.label}</span>
          <p className="bd-file__title">{row?.title || d.title}</p>
        </div>
        <Dot color={item.color} />
        {href && (
          <a className="bd-card__open bd-card__open--text" data-nodrag href={href} target="_blank" rel="noopener noreferrer" title="새 탭에서 열기">
            <ExternalLink size={14} aria-hidden="true" /> 열기
          </a>
        )}
      </div>
      {item.h >= 120 && <FilePreview kind={d.kind} row={row} />}
    </div>
  )
}

const FILLED = new Set(['memo', 'keyword', 'sticky'])

function BoardItem({ item, selected, editing, hit, hitCurrent, dimmed, readOnly, showHandles, comments, onCommit, onEndEdit, onComments }) {
  const t = item.type
  const color = t === 'sticky' ? item.color || STICKY_DEFAULT : item.color
  const c = color ? COLORS[color] : null
  const filled = FILLED.has(t) && c
  const style = {
    transform: `translate(${item.x}px, ${item.y}px)`,
    width: item.w,
    height: item.h,
    zIndex: t === 'frame' ? item.z - 1000000 : item.z,
    ...(filled ? { background: c.fill, color: c.text } : {}),
  }
  const cls = [
    'bd-item',
    `bd-item--${t}`,
    filled ? 'bd-item--filled' : '',
    selected ? 'is-selected' : '',
    editing ? 'is-editing' : '',
    hit ? 'is-hit' : '',
    hitCurrent ? 'is-hit-current' : '',
    dimmed ? 'is-dimmed' : '',
    item.locked ? 'is-locked' : '',
  ].join(' ')
  const props = { item, editing, readOnly, onCommit, onEndEdit }
  let body = null
  if (t === 'memo') body = <MemoBody {...props} />
  else if (t === 'keyword') body = <KeywordBody {...props} />
  else if (t === 'link') body = <LinkBody item={item} selected={selected} readOnly={readOnly} />
  else if (t === 'image') body = <ImageBody item={item} />
  else if (t === 'video') body = <VideoBody item={item} selected={selected} readOnly={readOnly} />
  else if (t === 'file') body = <FileBody item={item} />
  else if (t === 'sticky') body = <StickyBody {...props} />
  else if (t === 'shape') body = <ShapeBody {...props} />
  else if (t === 'text') body = <TextBody {...props} />
  else if (t === 'stroke') body = <StrokeBody item={item} />
  else if (t === 'frame') body = <FrameBody {...props} />
  const canTouch = !readOnly && !item.locked && !editing
  const handles = canTouch && showHandles && t !== 'stroke' && t !== 'frame'
  return (
    <div className={cls} style={style} data-item-id={item.id} data-editing={editing ? 'true' : undefined}>
      {body}
      {handles && ['top', 'right', 'bottom', 'left'].map((s) => <span key={s} className={`bd-handle bd-handle--${s}`} data-handle={s} title="끌어서 연결" />)}
      {canTouch && selected && t !== 'stroke' && <span className="bd-resize" data-resize title="크기 조절" />}
      {item.locked && selected && (
        <span className="bd-lock" title="잠김" aria-label="잠김">
          <Lock size={12} />
        </span>
      )}
      {comments > 0 && (
        <button type="button" className="bd-cpin" data-nodrag onClick={() => onComments?.(item.id)} title={`댓글 ${comments}개`} aria-label={`댓글 ${comments}개`}>
          <MessageSquare size={12} aria-hidden="true" />
          {comments}
        </button>
      )}
    </div>
  )
}

export default memo(BoardItem)
