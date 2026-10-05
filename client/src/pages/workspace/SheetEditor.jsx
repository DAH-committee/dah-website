// /sheets/:id: 범용 스프레드시트. 내용은 ws_files.content({columns, rows, nextId})에 저장하고,
// 화면은 기존 SheetWorkspace(구글 시트 방식 작업면)를 그대로 쓴다. 칸 수정은 0.9초 모아서 저장한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import SheetWorkspace from '../../components/admin/sheet/SheetWorkspace'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../hooks/useApi'

// content는 {sheets:[{id,label,columns,rows,nextId}]}. 예전 모양({columns,rows,nextId})은 시트 1개로 바꿔 읽는다.
const normalize = (c) => {
  if (c && Array.isArray(c.sheets) && c.sheets.length) return { sheets: c.sheets, nextSheet: c.nextSheet || c.sheets.length + 1 }
  return { sheets: [{ id: 'main', label: '시트1', columns: c?.columns || [], rows: c?.rows || [], nextId: c?.nextId || (c?.rows?.length || 0) + 1 }], nextSheet: 2 }
}
const blankSheet = (id, label) => {
  const columns = Array.from({ length: 10 }, (_, i) => ({ key: `c${i}`, label: `열 ${i + 1}`, width: 140 }))
  return { id, label, columns, rows: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, cells: {} })), nextId: 51 }
}

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
      const content = normalize(r.item.content)
      setData(content)
      latest.current = content
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

  const patchSheet = useCallback(
    (sid, fn) => {
      const cur = latest.current
      commit({ ...cur, sheets: cur.sheets.map((sh) => (sh.id === sid ? fn(sh) : sh)) })
    },
    [commit]
  )

  const sheets = useMemo(
    () =>
      data
        ? data.sheets.map((sh) => ({
            id: sh.id,
            label: sh.label,
            columns: (sh.columns || []).map((c) => ({
              key: c.key,
              label: c.label,
              width: c.width || 140,
              get: (r) => String(r.cells?.[c.key] ?? ''),
              patch: (value) => ({ [c.key]: value }),
            })),
            rows: sh.rows,
            editable: true,
            allowCustom: true,
            formulas: true,
            unit: '행',
          }))
        : [],
    [data]
  )

  const onEditCell = useCallback(
    async (row, col, value, sid) => patchSheet(sid, (sh) => ({ ...sh, rows: sh.rows.map((r) => (r.id === row.id ? { ...r, cells: { ...r.cells, [col.key]: value } } : r)) })),
    [patchSheet]
  )
  const onInsertRow = useCallback(
    async (sid) => {
      let row
      patchSheet(sid, (sh) => {
        row = { id: sh.nextId || sh.rows.length + 1, cells: {} }
        return { ...sh, rows: [...sh.rows, row], nextId: row.id + 1 }
      })
      return row
    },
    [patchSheet]
  )
  const onDeleteRows = useCallback(
    async (target, sid) => {
      const ids = new Set(target.map((r) => r.id))
      patchSheet(sid, (sh) => ({ ...sh, rows: sh.rows.filter((r) => !ids.has(r.id)) }))
    },
    [patchSheet]
  )
  const onRenameColumn = useCallback(
    (key, label, sid) => patchSheet(sid, (sh) => ({ ...sh, columns: sh.columns.map((c) => (c.key === key ? { ...c, label } : c)) })),
    [patchSheet]
  )
  const onAddSheet = useCallback(async () => {
    const cur = latest.current
    const id = `s${cur.nextSheet}`
    let n = cur.sheets.length + 1
    while (cur.sheets.some((sh) => sh.label === `시트${n}`)) n += 1
    commit({ ...cur, sheets: [...cur.sheets, blankSheet(id, `시트${n}`)], nextSheet: cur.nextSheet + 1 })
    return id
  }, [commit])
  const onRenameSheet = useCallback((sid, label) => patchSheet(sid, (sh) => ({ ...sh, label })), [patchSheet])
  const onDuplicateSheet = useCallback(
    async (sid) => {
      const cur = latest.current
      const src = cur.sheets.find((sh) => sh.id === sid)
      if (!src) return null
      const id = `s${cur.nextSheet}`
      const copy = JSON.parse(JSON.stringify(src))
      copy.id = id
      copy.label = `${src.label}의 사본`.slice(0, 30)
      const at = cur.sheets.findIndex((sh) => sh.id === sid)
      const next = [...cur.sheets]
      next.splice(at + 1, 0, copy)
      commit({ ...cur, sheets: next, nextSheet: cur.nextSheet + 1 })
      return id
    },
    [commit]
  )
  const onDeleteSheet = useCallback(
    (sid) => {
      const cur = latest.current
      if (cur.sheets.length <= 1) return
      commit({ ...cur, sheets: cur.sheets.filter((sh) => sh.id !== sid) })
    },
    [commit]
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
      onRenameColumn={onRenameColumn}
      onAddSheet={onAddSheet}
      onRenameSheet={onRenameSheet}
      onDuplicateSheet={onDuplicateSheet}
      onDeleteSheet={onDeleteSheet}
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
