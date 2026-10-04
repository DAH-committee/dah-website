// /sheets/:id: 범용 스프레드시트. 내용은 ws_files.content({columns, rows, nextId})에 저장하고,
// 화면은 기존 SheetWorkspace(구글 시트 방식 작업면)를 그대로 쓴다. 칸 수정은 0.9초 모아서 저장한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import SheetWorkspace from '../../components/admin/sheet/SheetWorkspace'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../hooks/useApi'

export default function SheetEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole, loading: authLoading } = useAuth()
  const [file, setFile] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState('')
  const timer = useRef(null)
  const latest = useRef(null)

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/workspace/sheets/${id}`)
      setFile(r.item)
      setData(r.item.content)
      latest.current = r.item.content
      setUpdatedAt(new Date(r.item.updated_at).toLocaleString('ko-KR'))
      setError('')
      document.title = `${r.item.title} | 디지털인문예술전공`
    } catch (e) {
      if (e.status === 404) navigate('/workspace/sheets', { replace: true })
      else setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => {
    if (!authLoading && hasRole('manager')) load()
  }, [load, authLoading, hasRole])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (!latest.current) return
    await api.put(`/workspace/sheets/${id}`, { content: latest.current })
    setUpdatedAt(new Date().toLocaleString('ko-KR'))
  }, [id])

  const commit = useCallback(
    (next) => {
      latest.current = next
      setData(next)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => flush().catch((e) => setError(e.message)), 900)
    },
    [flush]
  )

  useEffect(() => {
    const h = () => {
      if (timer.current) flush().catch(() => {})
    }
    window.addEventListener('beforeunload', h)
    return () => {
      window.removeEventListener('beforeunload', h)
      h()
    }
  }, [flush])

  const columns = useMemo(
    () =>
      (data?.columns || []).map((c) => ({
        key: c.key,
        label: c.label,
        width: c.width || 140,
        get: (r) => String(r.cells?.[c.key] ?? ''),
        patch: (value) => ({ [c.key]: value }),
      })),
    [data]
  )

  const onEditCell = useCallback(
    async (row, col, value) => {
      const cur = latest.current
      commit({ ...cur, rows: cur.rows.map((r) => (r.id === row.id ? { ...r, cells: { ...r.cells, [col.key]: value } } : r)) })
    },
    [commit]
  )
  const onInsertRow = useCallback(async () => {
    const cur = latest.current
    const row = { id: cur.nextId || cur.rows.length + 1, cells: {} }
    commit({ ...cur, rows: [...cur.rows, row], nextId: row.id + 1 })
    return row
  }, [commit])
  const onDeleteRows = useCallback(
    async (target) => {
      const ids = new Set(target.map((r) => r.id))
      const cur = latest.current
      commit({ ...cur, rows: cur.rows.filter((r) => !ids.has(r.id)) })
    },
    [commit]
  )

  const sheets = useMemo(
    () => (data ? [{ id: 'main', label: '시트1', columns, rows: data.rows, editable: true, allowCustom: true, unit: '행' }] : []),
    [data, columns]
  )

  if (authLoading) return null
  if (!hasRole('manager')) return <Navigate to="/resources/handover" replace />
  if (loading || !data) return <div className="p-24 text-small-m text-reading-text">{error || '불러오는 중'}</div>

  return (
    <SheetWorkspace
      title={file.title}
      stateKey={`ws-sheet-${id}`}
      sheets={sheets}
      loading={false}
      error={error || null}
      updatedAt={updatedAt}
      onRefresh={load}
      onEditCell={onEditCell}
      onInsertRow={onInsertRow}
      onDeleteRows={onDeleteRows}
      exportName={file.title}
      homeHref="/workspace/sheets"
      fileId={Number(id)}
      onRenameFile={async (title) => {
        await api.put(`/workspace/files/${id}`, { title })
        setFile((f) => ({ ...f, title }))
        document.title = `${title} | 디지털인문예술전공`
      }}
    />
  )
}
