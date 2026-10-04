// 인수인계 문서 전용 Tiptap 확장.
// CommentMark: 여백 댓글이 붙는 문장 표시(data-comment). SecretNode: 비밀값 칩(값은 서버에서 따로 받음).
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import SecretChip from './SecretChip'

// 편집 권한 같은 화면 상태를 노드뷰(SecretChip)에 전달하는 저장소
export const HandoverStorage = Extension.create({
  name: 'handover',
  addStorage() {
    return { canEdit: false }
  },
})

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment'),
        renderHTML: (attrs) => (attrs.id ? { 'data-comment': attrs.id } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'gd-cmark' }), 0]
  },
})

export const SecretNode = Node.create({
  name: 'secret',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-secret-id')) || null,
        renderHTML: (attrs) => ({ 'data-secret-id': attrs.id }),
      },
      label: {
        default: '비밀값',
        parseHTML: (el) => el.getAttribute('data-label') || '비밀값',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-secret-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'gd-secret' }), HTMLAttributes['data-label'] || '비밀값']
  },
  addNodeView() {
    return ReactNodeViewRenderer(SecretChip, { as: 'span', className: 'gd-secret-wrap' })
  },
})
