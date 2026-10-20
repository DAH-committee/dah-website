// /sheets/:id: 범용 스프레드시트. 내용은 ws_files.content({columns, rows, nextId})에 저장하고,
// 화면은 기존 SheetWorkspace(구글 시트 방식 작업면)를 그대로 쓴다. 칸 수정은 0.9초 모아서 저장한다.
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SheetWorkspace from '../../components/admin/sheet/SheetWorkspace'
import NoAccess from '../../components/common/NoAccess'
import { useMe } from '../../components/common/AccountMenu'
import { api } from '../../hooks/useApi'
import { confirmDialog } from '../../components/common/AppDialog'
import * as formulaEngine from '../../components/admin/sheet/formula'
import { makeEngine } from '../../components/admin/sheet/sheetEngine'
import { getKnowledge } from '../../components/ai/knowledge'
import { createSheetTools } from './aiSheetTools'
import { QUICK_ACTIONS, buildSystemPrompt } from './aiSheetPrompts'

import { useMcpRelay } from '../../components/ai/mcpRelay'
// AI 창(공용 AiPanel). 파일이 없으면 빈 객체라 빌드가 깨지지 않고 AI 단추도 숨긴다.
const AI_PANEL = import.meta.glob('../../components/ai/AiPanel.jsx')
const AI_LOADER = Object.values(AI_PANEL)[0]
const AiPanel = AI_LOADER ? lazy(() => AI_LOADER().then((m) => ({ default: m.default || m.AiPanel }))) : null
const AI_OPEN_KEY = 'dah-ai-open:sheet'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'

// AI 창이 오류를 내도 시트 화면 전체가 멈추지 않게 한다
class AiBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <div className="sh-ai__note">AI 창을 열지 못했습니다. 화면을 새로 고쳐 주세요</div> : this.props.children
  }
}

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
  const [denied, setDenied] = useState(null) // null | 'denied' | 'missing'
  const [canEdit, setCanEdit] = useState(false)
  const [lastEdit, setLastEdit] = useState(null)
  const { me } = useMe()
  const editTimer = useRef(null)
  const [file, setFile] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState('')
  const timer = useRef(null)
  const latest = useRef(null)
  const wsApi = useRef(null)
  const canEditRef = useRef(false)
  canEditRef.current = canEdit

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/workspace/sheets/${id}`)
      setFile(r.item)
      const content = normalize(r.item.content)
      setData(content)
      setCanEdit(r.canEdit === true)
      setLastEdit(r.last_edit || null)
      latest.current = content
      setUpdatedAt(new Date(r.item.updated_at).toLocaleString('ko-KR'))
      setError('')
      document.title = `${r.item.title} | 디인예 워크스페이스`
    } catch (e) {
      if (e.status === 401 || e.status === 403) setDenied('denied')
      else if (e.status === 404) setDenied('missing')
      else setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

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

  // 마지막으로 수정한 칸을 기록한다(연속 입력은 마지막 칸만 서버에 보낸다)
  const markEdit = useCallback(
    (sheet, row, col) => {
      const by = me?.user?.name || '내'
      setLastEdit({ by, at: new Date().toISOString(), sheet, row, col })
      clearTimeout(editTimer.current)
      editTimer.current = setTimeout(() => {
        api.put(`/workspace/files/${id}/last-edit`, { sheet, row: String(row), col }).then((r) => setLastEdit(r.last_edit)).catch(() => {})
      }, 900)
    },
    [id, me]
  )

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
            editable: canEdit,
            allowCustom: canEdit,
            formulas: true,
            unit: '행',
          }))
        : [],
    [data, canEdit]
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

  // ── AI 창 ──
  const [aiOpen, setAiOpenState] = useState(() => {
    try {
      return localStorage.getItem(AI_OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const setAiOpen = useCallback((v) => {
    setAiOpenState((cur) => {
      const next = typeof v === 'function' ? v(cur) : v
      try { localStorage.setItem(AI_OPEN_KEY, next ? '1' : '0') } catch { /* 저장소 사용 불가 */ }
      return next
    })
  }, [])
  const engine = useMemo(() => makeEngine(formulaEngine), [])
  const aiHost = useMemo(() => {
    const snapshot = () => ({ sheets: latest.current.sheets, nextSheet: latest.current.nextSheet, ui: wsApi.current?.getAllUi() || {} })
    // 보고 있는 시트는 그대로 둔다(지워진 시트면 화면이 첫 시트로 알아서 옮겨 간다)
    const restore = (snap) => {
      const cur = latest.current
      commit({ ...cur, sheets: snap.sheets, nextSheet: snap.nextSheet })
      wsApi.current?.applyAllUi(snap.ui)
    }
    return {
      engine,
      getState: () => ({ ...snapshot(), activeId: wsApi.current?.getActiveSheetId() || latest.current.sheets[0]?.id }),
      getSelection: () => wsApi.current?.getSelection() || { sheetId: latest.current.sheets[0]?.id, range: null, active: null, filtered: false },
      select: (sid, g) => wsApi.current?.select(sid, g),
      editBlock: () => (canEditRef.current ? '' : '이 시트는 보기 전용이라 고칠 수 없습니다. 고칠 내용은 글로 제안해 주세요'),
      // 새 상태를 반영하고, 시트의 실행취소 목록에 한 단계로 넣는다. 돌려주는 함수는 AI 창의 되돌리기 단추가 쓴다
      applyState: (next, label) => {
        const api = wsApi.current
        const before = snapshot()
        restore({ sheets: next.sheets, nextSheet: next.nextSheet ?? latest.current.nextSheet, ui: next.ui || {} })
        const after = snapshot()
        const entry = { label: 'AI ' + label, global: true, undo: async () => restore(before), redo: async () => restore(after) }
        api?.pushHistory(entry)
        return async () => {
          const a = wsApi.current
          if (!a) return
          if (!a.inUndo(entry)) return a.toast('이미 되돌렸습니다')
          if (a.topEntry() === entry) return a.undo()
          const ok = await confirmDialog({ title: '되돌리기', message: 'AI가 고친 뒤에 직접 고친 내용도 함께 되돌려집니다. 계속할까요?', confirmLabel: '되돌리기' })
          if (!ok) return
          restore(before)
          a.dropEntry(entry)
        }
      },
    }
  }, [commit, engine])
  const aiTools = useMemo(() => createSheetTools(aiHost), [aiHost])
  const aiSystem = useMemo(() => buildSystemPrompt({ functions: engine.listFunctions(), knowledge: getKnowledge('sheets') }), [engine])
  const aiGetContext = useCallback(() => aiTools.getContext(), [aiTools])
  const mcpRelay = useMcpRelay({ fileId: id, kind: 'sheet', tools: aiTools.tools, canEdit })
  useEffect(() => {
    if (!AiPanel) return undefined
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setAiOpen((v) => !v)
        return
      }
      // 보내기 뒤에는 초점이 AI 입력칸에 있다. 입력칸이 비어 있으면 실행취소·다시 실행은 시트에 적용한다
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z') && e.target?.closest?.('.sh-ai') && (!('value' in e.target) || e.target.value === '')) {
        e.preventDefault()
        if (e.shiftKey) wsApi.current?.redo()
        else wsApi.current?.undo()
      }
    }
    // 시트 칸 입력창이 키를 먼저 가로채므로 캡처 단계에서 받는다
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setAiOpen])

  if (denied) return <NoAccess kind="sheet" notFound={denied === 'missing'} />
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
      onEditCell={canEdit ? onEditCell : undefined}
      onInsertRow={canEdit ? onInsertRow : undefined}
      onDeleteRows={canEdit ? onDeleteRows : undefined}
      onRenameColumn={canEdit ? onRenameColumn : undefined}
      onAddSheet={canEdit ? onAddSheet : undefined}
      onRenameSheet={canEdit ? onRenameSheet : undefined}
      onDuplicateSheet={canEdit ? onDuplicateSheet : undefined}
      onDeleteSheet={canEdit ? onDeleteSheet : undefined}
      readOnly={!canEdit}
      lastEdit={lastEdit}
      onCellEdited={canEdit ? markEdit : undefined}
      apiRef={wsApi}
      aiOpen={aiOpen && Boolean(AiPanel)}
      aiShortcut={`${MOD}J`}
      onToggleAi={AiPanel ? () => setAiOpen((v) => !v) : undefined}
      topExtra={mcpRelay.badge}
      aiSlot={
        AiPanel ? (
          <AiBoundary>
            <Suspense fallback={<div className="sh-ai__note">불러오는 중</div>}>
              <AiPanel
                open
                onClose={() => setAiOpen(false)}
                scope={`sheet:${id}`}
                title="시트 AI"
                systemPrompt={aiSystem}
                tools={aiTools.tools}
                getContext={aiGetContext}
                quickActions={QUICK_ACTIONS}
                placeholder="시트를 어떻게 도울까요? 예: 합계 수식 넣어 줘"
                canEdit={canEdit}
              />
            </Suspense>
          </AiBoundary>
        ) : null
      }
      stateApi={`/workspace/sheets/${id}/ui`}
      exportName={file.title}
      homeHref="/workspace/sheets"
      fileId={Number(id)}
      onRenameFile={!canEdit ? undefined : async (title) => {
        await api.put(`/workspace/files/${id}`, { title })
        setFile((f) => ({ ...f, title }))
        document.title = `${title} | 디인예 워크스페이스`
      }}
    />
  )
}
