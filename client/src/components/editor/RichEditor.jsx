// RichEditor.jsx — Tiptap 리치 에디터 (13_CMS_SPEC 2·3절)
// JSON(body jsonb) 저장. 템플릿 잠금: 색상 피커·폰트 선택 기능 없음 — 내용만 넣는다.
// 지원: 볼드·이탤릭·밑줄, H2·H3, 리스트, 인용, 구분선, 링크, 이미지 업로드, 표,
// 임베드 3종(유튜브/피그마/구글 슬라이드 — URL 붙여넣기 자동 감지 + 툴바 입력)

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Youtube from '@tiptap/extension-youtube'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link2,
  ImagePlus,
  Table as TableIcon,
  MonitorPlay,
  Rows3,
  Columns3,
  Trash2,
  Check,
  X,
} from 'lucide-react'
import { api } from '../../hooks/useApi'
import { FigmaEmbed, SlidesEmbed } from './embeds'

// 붙여넣기 클린업 — 워드·구글독스 인라인 스타일 스트립 (StarterKit 파서 + 이중 방어)
function stripPastedStyles(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(?:font|o:p|xml|meta|link)[^>]*>/gi, '')
    .replace(/\s(?:style|class|face|color|lang|align|width|height)="[^"]*"/gi, '')
}

// 에디터 내부 콘텐츠 스타일 — 래퍼의 arbitrary variant로만 지정 (전역 CSS 유출 금지)
const CONTENT_WRAP = [
  'rounded-md border border-border-subtle bg-bg-panel px-16 py-12 transition duration-fast ease-out focus-within:border-border-strong',
  '[&_.ProseMirror]:min-h-[240px] [&_.ProseMirror]:break-keep [&_.ProseMirror]:outline-none',
  '[&_.ProseMirror>*+*]:mt-12',
  '[&_.ProseMirror_p]:text-body-m [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:text-text-sec',
  '[&_.ProseMirror_h2]:text-h2-m [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:leading-snug [&_.ProseMirror_h2]:text-text-pri',
  '[&_.ProseMirror_h3]:text-h3-m [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:leading-snug [&_.ProseMirror_h3]:text-text-pri',
  '[&_.ProseMirror_strong]:font-bold [&_.ProseMirror_strong]:text-text-pri',
  '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-24 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-24',
  '[&_.ProseMirror_li]:text-text-sec',
  '[&_.ProseMirror_blockquote]:border-l [&_.ProseMirror_blockquote]:border-border-strong [&_.ProseMirror_blockquote]:pl-16',
  '[&_.ProseMirror_hr]:border-0 [&_.ProseMirror_hr]:border-t [&_.ProseMirror_hr]:border-border-subtle',
  '[&_.ProseMirror_a]:text-text-pri [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-4',
  '[&_.ProseMirror_code]:rounded-sm [&_.ProseMirror_code]:bg-bg-elev [&_.ProseMirror_code]:px-8 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-small-m',
  '[&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-bg-elev [&_.ProseMirror_pre]:p-16 [&_.ProseMirror_pre]:font-mono [&_.ProseMirror_pre]:text-small-m',
  '[&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-md [&_.ProseMirror_img]:border [&_.ProseMirror_img]:border-border-subtle',
  '[&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border-collapse',
  '[&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border-subtle [&_.ProseMirror_th]:bg-bg-elev [&_.ProseMirror_th]:px-12 [&_.ProseMirror_th]:py-8 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_th]:text-text-pri',
  '[&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border-subtle [&_.ProseMirror_td]:px-12 [&_.ProseMirror_td]:py-8 [&_.ProseMirror_td]:align-top [&_.ProseMirror_td]:text-text-sec',
  '[&_.ProseMirror_iframe]:pointer-events-none [&_.ProseMirror_iframe]:aspect-video [&_.ProseMirror_iframe]:h-auto [&_.ProseMirror_iframe]:w-full',
  '[&_.ProseMirror_.ProseMirror-selectednode]:outline [&_.ProseMirror_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror_.ProseMirror-selectednode]:outline-border-focus',
  '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-text-meta [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
].join(' ')

function ToolButton({ onClick, active = false, disabled = false, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 md:h-32 md:w-32 ${
        active
          ? 'bg-glass-strong text-text-pri'
          : 'text-text-sec hover:bg-glass-strong hover:text-text-pri'
      }`}
    >
      {children}
    </button>
  )
}

function ToolDivider() {
  return <span aria-hidden="true" className="mx-4 h-16 w-px bg-border-subtle" />
}

/**
 * RichEditor — Tiptap JSON 에디터.
 * @param {{ value: Object|null, onChange: Function, placeholder?: string }} props
 *   value: Tiptap doc JSON(body jsonb), onChange(json): 변경 시 JSON 전달
 */
function RichEditor({ value, onChange, placeholder = '내용 입력' }) {
  const [urlMode, setUrlMode] = useState(null) // null | 'link' | 'embed'
  const [urlValue, setUrlValue] = useState('')
  const [linkText, setLinkText] = useState('') // K1-4: 링크 표시 이름 (본문 생 URL 노출 금지)
  const [urlError, setUrlError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  // J2: Tiptap doc이 아닌 레거시 body jsonb({paragraphs}, {field,intro} 등)가 들어오면
  // setContent가 스키마 오류로 크래시(빈 화면) — doc 형태만 통과시킨다
  const safeValue = value && value.type === 'doc' ? value : null

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Youtube.configure({ nocookie: true, controls: true }),
      Placeholder.configure({ placeholder }),
      FigmaEmbed,
      SlidesEmbed,
    ],
    content: safeValue,
    editorProps: {
      transformPastedHTML: stripPastedStyles,
    },
    onUpdate: ({ editor: ed }) => {
      if (onChange) onChange(ed.getJSON())
    },
  })

  // 편집 폼 비동기 로딩 대응 — 외부 value 도착 시 1회 주입
  useEffect(() => {
    if (!editor || !safeValue) return
    if (editor.isEmpty && !editor.isFocused) {
      editor.commands.setContent(safeValue, false)
    }
  }, [editor, safeValue])

  if (!editor) return null

  const openUrlInput = (mode) => {
    setUrlError(null)
    setLinkText('')
    if (urlMode === mode) {
      setUrlMode(null)
      return
    }
    setUrlMode(mode)
    setUrlValue(mode === 'link' ? editor.getAttributes('link').href || '' : '')
  }

  // K1-4: 선택 텍스트가 있으면 그 텍스트에 링크, 없으면 표시 이름 필수 (생 URL 삽입 금지)
  const hasSelection = !editor.state.selection.empty
  const onExistingLink = editor.isActive('link')
  const canApplyLink =
    urlMode !== 'link' ||
    (urlValue.trim()
      ? hasSelection || onExistingLink || linkText.trim() !== ''
      : onExistingLink)

  const applyUrl = () => {
    const url = urlValue.trim()
    setUrlError(null)
    if (urlMode === 'link') {
      if (!canApplyLink) return
      if (!url) {
        // URL을 비우면 기존 링크 해제
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      } else if (!hasSelection && !onExistingLink) {
        // 선택 없음 — 표시 이름 텍스트를 삽입하고 링크 적용
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: linkText.trim(),
            marks: [{ type: 'link', attrs: { href: url } }],
          })
          .run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      }
      setUrlMode(null)
      setUrlValue('')
      setLinkText('')
      return
    }
    // 임베드 3종 판별 — 유튜브 / 피그마 / 구글 슬라이드
    if (/(?:youtube\.com|youtu\.be)\//.test(url)) {
      editor.chain().focus().setYoutubeVideo({ src: url }).run()
    } else if (/figma\.com\/(?:file|proto|design|board|slides)\//.test(url)) {
      editor.chain().focus().insertContent({ type: 'figma', attrs: { src: url } }).run()
    } else if (/docs\.google\.com\/presentation\/d\//.test(url)) {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'googleSlides', attrs: { src: url } })
        .run()
    } else {
      setUrlError('유튜브·피그마·구글 슬라이드 URL만 임베드할 수 있습니다.')
      return
    }
    setUrlMode(null)
    setUrlValue('')
  }

  const handleImageFile = async (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setUrlError(null)
    try {
      const res = await api.upload(file)
      const src = res?.url
      if (!src) throw new Error('업로드 응답에 url이 없습니다.')
      editor.chain().focus().setImage({ src, alt: file.name }).run()
    } catch (err) {
      setUrlError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const inTable = editor.isActive('table')

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {/* 툴바 — 글래스 필. 색상·폰트 컨트롤 없음(템플릿 잠금) */}
      <div
        role="toolbar"
        aria-label="서식 도구"
        className="flex flex-wrap items-center gap-4 rounded-sm border border-glass-line bg-glass-bg px-12 py-4 backdrop-blur-glass-mobile"
      >
        <ToolButton
          label="볼드"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </ToolButton>
        <ToolButton
          label="이탤릭"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </ToolButton>
        <ToolButton
          label="밑줄"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon size={16} />
        </ToolButton>
        <ToolDivider />
        <ToolButton
          label="제목 2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={16} />
        </ToolButton>
        <ToolButton
          label="제목 3"
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 size={16} />
        </ToolButton>
        <ToolDivider />
        <ToolButton
          label="불릿 리스트"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={16} />
        </ToolButton>
        <ToolButton
          label="번호 리스트"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={16} />
        </ToolButton>
        <ToolDivider />
        <ToolButton
          label="인용"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={16} />
        </ToolButton>
        <ToolButton
          label="구분선"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus size={16} />
        </ToolButton>
        <ToolDivider />
        <ToolButton
          label="링크"
          active={editor.isActive('link') || urlMode === 'link'}
          onClick={() => openUrlInput('link')}
        >
          <Link2 size={16} />
        </ToolButton>
        <ToolButton
          label="이미지 업로드"
          disabled={uploading}
          onClick={() => fileRef.current && fileRef.current.click()}
        >
          <ImagePlus size={16} />
        </ToolButton>
        <ToolButton
          label="표 삽입"
          active={inTable}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <TableIcon size={16} />
        </ToolButton>
        <ToolButton
          label="임베드 (유튜브·피그마·슬라이드)"
          active={urlMode === 'embed'}
          onClick={() => openUrlInput('embed')}
        >
          <MonitorPlay size={16} />
        </ToolButton>
        {inTable && (
          <>
            <ToolDivider />
            <ToolButton
              label="행 추가"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <Rows3 size={16} />
            </ToolButton>
            <ToolButton
              label="열 추가"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              <Columns3 size={16} />
            </ToolButton>
            <ToolButton
              label="표 삭제"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              <Trash2 size={16} />
            </ToolButton>
          </>
        )}
      </div>

      {/* URL 입력 행 — 링크(URL+표시 이름 2필드)·임베드 공용 */}
      {urlMode && (
        <div className="flex flex-wrap items-center gap-8 rounded-sm border border-glass-line bg-glass-bg px-12 py-4 backdrop-blur-glass-mobile">
          <input
            type="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyUrl()
              }
              if (e.key === 'Escape') setUrlMode(null)
            }}
            placeholder={
              urlMode === 'link' ? '링크 URL' : '유튜브 · 피그마 · 구글 슬라이드 URL'
            }
            aria-label={urlMode === 'link' ? '링크 URL' : '임베드 URL'}
            className="h-32 min-w-0 flex-1 bg-transparent font-mono text-small-m text-text-pri outline-none placeholder:text-text-meta"
          />
          {urlMode === 'link' && (
            <input
              type="text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyUrl()
                }
                if (e.key === 'Escape') setUrlMode(null)
              }}
              placeholder={
                hasSelection || onExistingLink
                  ? '선택한 텍스트에 적용됩니다'
                  : '표시 이름 (필수)'
              }
              disabled={hasSelection || onExistingLink}
              aria-label="링크 표시 이름"
              className="h-32 min-w-0 flex-1 bg-transparent text-small-m text-text-pri outline-none placeholder:text-text-meta disabled:opacity-40"
            />
          )}
          <ToolButton label="적용" onClick={applyUrl} disabled={!canApplyLink}>
            <Check size={16} />
          </ToolButton>
          <ToolButton label="닫기" onClick={() => setUrlMode(null)}>
            <X size={16} />
          </ToolButton>
        </div>
      )}
      {urlError && <p className="text-small-m text-state-error">{urlError}</p>}
      {uploading && (
        <p className="font-mono text-caption-m text-text-meta">이미지 업로드 중</p>
      )}

      <div className={CONTENT_WRAP}>
        <EditorContent editor={editor} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleImageFile}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  )
}

export default RichEditor
