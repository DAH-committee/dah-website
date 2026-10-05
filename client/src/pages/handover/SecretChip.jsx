// 비밀값 칩: 기본 가림, 눈 아이콘으로 표시, 복사 아이콘으로 클립보드 복사. 값은 누를 때만 서버에서 받는다.
import { useState } from 'react'
import { promptDialog } from '../../components/common/AppDialog'
import { NodeViewWrapper } from '@tiptap/react'
import { Eye, EyeOff, Copy, Check, Pencil, KeyRound } from 'lucide-react'
import { api } from '../../hooks/useApi'

export default function SecretChip({ node, editor }) {
  const { id, label } = node.attrs
  const [value, setValue] = useState(null)
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    if (value != null) return value
    const r = await api.get(`/handover/secrets/${id}`)
    setValue(r.item.value)
    return r.item.value
  }

  async function toggle() {
    setErr('')
    try {
      if (!shown) await load()
      setShown((s) => !s)
    } catch {
      setErr('불러오기 실패')
    }
  }

  async function copy() {
    setErr('')
    try {
      const v = await load()
      await navigator.clipboard.writeText(v)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      setErr('복사 실패')
    }
  }

  async function edit() {
    const next = await promptDialog({ title: label, label: '새 값', confirmLabel: '저장' })
    if (!next) return
    try {
      await api.put(`/handover/secrets/${id}`, { value: next })
      setValue(next)
    } catch {
      setErr('저장 실패')
    }
  }

  const canEdit = editor?.storage?.handover?.canEdit

  return (
    <NodeViewWrapper as="span" className="gd-secret" contentEditable={false} data-secret-id={id}>
      <KeyRound size={13} aria-hidden="true" className="gd-secret__key" />
      <span className="gd-secret__label">{label}</span>
      <span className={`gd-secret__val${shown ? ' is-shown' : ''}`}>{shown && value != null ? value : '••••••••••'}</span>
      <button type="button" className="gd-secret__btn" onClick={toggle} aria-label={shown ? '가리기' : '보기'} title={shown ? '가리기' : '보기'}>
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
      <button type="button" className="gd-secret__btn" onClick={copy} aria-label="복사" title="복사">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      {canEdit && (
        <button type="button" className="gd-secret__btn" onClick={edit} aria-label="값 수정" title="값 수정">
          <Pencil size={14} />
        </button>
      )}
      {copied && <span className="gd-secret__toast">복사됨</span>}
      {err && <span className="gd-secret__err">{err}</span>}
    </NodeViewWrapper>
  )
}
