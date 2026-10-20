// 아주 작은 RTF → HTML 변환. 키노트·페이지스·텍스트 편집기에서 복사한 글(text/rtf)을 받을 때 쓴다.
// 굵게·기울임·밑줄·취소선·색·크기·문단·링크만 본다. 그림과 표는 버린다.
import { escapeAttr, escapeText } from './html.js'

const SKIP_DEST = new Set(['fonttbl', 'stylesheet', 'info', 'pict', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'header', 'footer', 'object', 'nonshppict', 'expandedcolortbl', 'filetbl', 'revtbl'])

export function rtfToHtml(rtf) {
  const s = String(rtf || '')
  if (!/^\s*\{\\rtf/.test(s)) return ''
  const colors = []
  let i = 0
  let st = { b: false, i: false, u: false, s: false, cf: 0, fs: 24, skip: false, uc: 1, href: null, inst: false, rslt: false }
  const stack = []
  const paras = []
  let runs = []
  let fldInst = ''
  let align = null
  let pendingSkip = 0
  const emit = (t) => {
    if (!t) return
    if (st.inst) {
      fldInst += t
      return
    }
    if (st.skip) return
    const key = `${st.b}|${st.i}|${st.u}|${st.s}|${st.cf}|${st.fs}|${st.href}`
    const last = runs[runs.length - 1]
    if (last && last.key === key) last.text += t
    else runs.push({ key, text: t, b: st.b, i: st.i, u: st.u, s: st.s, color: colors[st.cf] || null, pt: st.fs / 2, href: st.href })
  }
  const endPara = () => {
    paras.push({ runs, align })
    runs = []
  }
  while (i < s.length) {
    const ch = s[i]
    if (ch === '{') {
      stack.push(st)
      st = { ...st }
      i++
      if (s.startsWith('\\*', i)) st.skip = true
      continue
    }
    if (ch === '}') {
      const wasInst = st.inst
      st = stack.pop() || st
      if (wasInst && !st.inst) {
        const m = /HYPERLINK\s+"([^"]+)"/i.exec(fldInst)
        st.href = m ? m[1] : null
        fldInst = ''
        st.fieldHref = st.href
      }
      i++
      continue
    }
    if (ch === '\\') {
      const next = s[i + 1]
      if (next === '\\' || next === '{' || next === '}') {
        emit(next)
        i += 2
        continue
      }
      if (next === "'") {
        const hex = s.slice(i + 2, i + 4)
        if (pendingSkip > 0) pendingSkip--
        else emit(String.fromCharCode(parseInt(hex, 16)))
        i += 4
        continue
      }
      if (next === '~') {
        emit('\u00a0')
        i += 2
        continue
      }
      if (next === '\n' || next === '\r') {
        endPara()
        i += 2
        continue
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 40))
      if (!m) {
        i += 2
        continue
      }
      i += m[0].length
      const word = m[1]
      const arg = m[2] === undefined ? null : parseInt(m[2], 10)
      if (SKIP_DEST.has(word)) st.skip = true
      else if (word === 'colortbl') st.colortbl = true
      else if (word === 'red' && st.colortbl) st._r = arg
      else if (word === 'green' && st.colortbl) st._g = arg
      else if (word === 'blue' && st.colortbl) st._b = arg
      else if (word === 'b') st.b = arg !== 0
      else if (word === 'i') st.i = arg !== 0
      else if (word === 'ul') st.u = arg !== 0
      else if (word === 'ulnone') st.u = false
      else if (word === 'strike') st.s = arg !== 0
      else if (word === 'cf') st.cf = arg || 0
      else if (word === 'fs') st.fs = arg || 24
      else if (word === 'plain') Object.assign(st, { b: false, i: false, u: false, s: false, cf: 0, fs: 24 })
      else if (word === 'par') endPara()
      else if (word === 'line') emit('\n')
      else if (word === 'tab') emit('\t')
      else if (word === 'pard') align = null
      else if (word === 'qc') align = 'center'
      else if (word === 'qr') align = 'right'
      else if (word === 'qj') align = 'justify'
      else if (word === 'ql') align = 'left'
      else if (word === 'uc') st.uc = arg ?? 1
      else if (word === 'u') {
        emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg))
        pendingSkip = st.uc
      } else if (word === 'fldinst') {
        st.inst = true
        st.skip = false
      }
      continue
    }
    if (ch === ';' && st.colortbl) {
      colors.push(st._r === undefined ? null : '#' + [st._r, st._g, st._b].map((n) => (n || 0).toString(16).padStart(2, '0')).join('').toUpperCase())
      st._r = st._g = st._b = undefined
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      i++
      continue
    }
    if (pendingSkip > 0) {
      pendingSkip--
      i++
      continue
    }
    if (!st.colortbl) emit(ch)
    i++
  }
  if (runs.length) endPara()
  while (paras.length && !paras[paras.length - 1].runs.length) paras.pop()
  return paras
    .map((p) => {
      const inner = p.runs
        .map((r) => {
          const css = [`font-size:${r.pt}pt`, r.color ? `color:${r.color}` : '', r.b ? 'font-weight:700' : '', r.i ? 'font-style:italic' : '', r.u || r.s ? `text-decoration:${[r.u ? 'underline' : '', r.s ? 'line-through' : ''].join(' ').trim()}` : ''].filter(Boolean).join(';')
          let h = `<span style="${css}">${escapeText(r.text).replace(/\n/g, '<br>')}</span>`
          if (r.href) h = `<a href="${escapeAttr(r.href)}">${h}</a>`
          return h
        })
        .join('')
      return `<p${p.align ? ` style="text-align:${p.align}"` : ''}>${inner || '<br>'}</p>`
    })
    .join('')
}
