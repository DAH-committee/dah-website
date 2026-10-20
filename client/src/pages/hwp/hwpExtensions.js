// 한글 모드 Tiptap 확장
// HwpVar: 자료값 칸(인라인 노드, attrs key 또는 calc). 값은 editor.storage.hwpVar.vars 에서 읽는다.
// HwpMarks: 한글 모드일 때 장 제목, 절 제목, 목록 항목에 항목 부호(data-mark)와 단계(data-lv)를 붙이는 장식. 문서 내용은 바꾸지 않는다.
// HwpTextStyle: 글자 모양의 장평(ratio, %)과 자간(spacing, %). 화면에서는 자간(letter-spacing)으로 근사한다.
// LineHeight: 문단 줄 간격(%)
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { walkMarks } from './hwpDoc'
import { chipText } from './hwpVars'

export const HwpVar = Node.create({
  name: 'hwpVar',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addStorage() {
    return { vars: {} }
  },
  addAttributes() {
    return {
      key: { default: null, parseHTML: (el) => el.getAttribute('data-var') || null, renderHTML: (a) => (a.key ? { 'data-var': a.key } : {}) },
      calc: { default: null, parseHTML: (el) => el.getAttribute('data-calc') || null, renderHTML: (a) => (a.calc ? { 'data-calc': a.calc } : {}) },
      digits: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-digits') || 0), renderHTML: (a) => (a.digits ? { 'data-digits': a.digits } : {}) },
      unit: { default: '', parseHTML: (el) => el.getAttribute('data-unit') || '', renderHTML: (a) => (a.unit ? { 'data-unit': a.unit } : {}) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-var]' }, { tag: 'span[data-calc]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'hw-var' }), chipText(node.attrs, this.storage.vars)]
  },
  renderText({ node }) {
    return chipText(node.attrs, this.storage.vars)
  },
  addNodeView() {
    const storage = this.storage
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span')
      dom.className = `hw-var${node.attrs.calc ? ' is-calc' : ''}`
      dom.contentEditable = 'false'
      if (node.attrs.key) dom.dataset.var = node.attrs.key
      if (node.attrs.calc) dom.dataset.calc = node.attrs.calc
      let cur = node
      const paint = () => {
        dom.textContent = chipText(cur.attrs, storage.vars)
        const v = cur.attrs.key ? storage.vars?.[cur.attrs.key] : null
        dom.title = cur.attrs.calc ? `계산: ${cur.attrs.calc}` : `자료값: ${v?.label || cur.attrs.key}`
      }
      dom._hwPaint = paint
      paint()
      dom.addEventListener('click', () => {
        const pos = typeof getPos === 'function' ? getPos() : null
        editor.storage.hwpVar.onPick?.(cur.attrs, pos)
      })
      return {
        dom,
        update(n) {
          if (n.type !== cur.type) return false
          cur = n
          paint()
          return true
        },
        ignoreMutation: () => true,
        stopEvent: () => false,
      }
    }
  },
})

/** 자료값이 바뀌면 화면의 칸을 다시 그린다 */
export function repaintVars(editor) {
  if (!editor?.view?.dom) return
  editor.view.dom.querySelectorAll('.hw-var').forEach((el) => el._hwPaint?.())
}

export const hwpMarksKey = new PluginKey('hwpMarks')
const build = (doc, preset) => {
  const decos = []
  walkMarks(doc, preset, (kind, node, pos, info) => {
    const attrs = { 'data-mark': info.mark, 'data-lv': String(info.lv) }
    attrs.class = kind === 'item' ? 'hm-item' : 'hm-h'
    decos.push(Decoration.node(pos, pos + node.nodeSize, attrs))
  })
  return DecorationSet.create(doc, decos)
}
export const HwpMarks = Extension.create({
  name: 'hwpMarks',
  addStorage() {
    return { on: false, preset: '보고서' }
  },
  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: hwpMarksKey,
        state: {
          init: (_, state) => (storage.on ? build(state.doc, storage.preset) : DecorationSet.empty),
          apply(tr, set, _old, state) {
            const forced = tr.getMeta(hwpMarksKey)
            if (!storage.on) return DecorationSet.empty
            if (forced || tr.docChanged) return build(state.doc, storage.preset)
            return set
          },
        },
        props: { decorations: (state) => hwpMarksKey.getState(state) },
      }),
    ]
  },
})
/** 한글 모드 켜고 끄기, 양식 바꾸기 */
export function setHwpView(editor, on, preset) {
  if (!editor || editor.isDestroyed) return
  const st = editor.storage.hwpMarks
  st.on = on
  st.preset = preset
  editor.view.dispatch(editor.state.tr.setMeta(hwpMarksKey, true))
}

const r3 = (v) => Math.round(v * 1000) / 1000
export const HwpTextStyle = Extension.create({
  name: 'hwpTextStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          ratio: {
            default: null,
            parseHTML: (el) => Number(el.getAttribute('data-ratio')) || null,
            renderHTML: (a) => {
              const out = {}
              if (a.ratio) out['data-ratio'] = a.ratio
              if (a.ratio || a.spacing) out.style = `letter-spacing: ${r3(((a.ratio || 100) - 100) / 200 + (a.spacing || 0) / 100)}em`
              return out
            },
          },
          spacing: {
            default: null,
            parseHTML: (el) => (el.hasAttribute('data-spacing') ? Number(el.getAttribute('data-spacing')) : null),
            renderHTML: (a) => (a.spacing != null && a.spacing !== 0 ? { 'data-spacing': a.spacing, ...(a.ratio ? {} : { style: `letter-spacing: ${r3(a.spacing / 100)}em` }) } : {}),
          },
        },
      },
    ]
  },
})

export const LineHeight = Extension.create({
  name: 'lineHeight',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => Number(el.getAttribute('data-lh')) || null,
            renderHTML: (a) => (a.lineHeight ? { 'data-lh': a.lineHeight, style: `line-height: ${a.lineHeight / 100} !important` } : {}),
          },
        },
      },
    ]
  },
})
