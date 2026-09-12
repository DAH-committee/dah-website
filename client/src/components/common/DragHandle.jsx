// DragHandle.jsx — 노션식 6점 드래그 정렬 (C3, 22_PHASE10)
// HTML5 드래그 앤 드롭 자체 구현(외부 라이브러리 금지). 어드민·공개 인라인 편집 공용.
//
// 사용 계약:
//   const { dragIndex, overIndex, rowProps } = useDragSort(onReorder)
//   onReorder(fromIndex, toIndex) — 드롭 시 호출. 부모가 배열 재정렬 후 sort 저장.
//   <li {...rowProps(i)}> <DragHandle /> ... </li>  // 행 전체가 draggable, 핸들은 시각 어포던스
import { useState } from 'react'
import { GripVertical } from 'lucide-react'

export function useDragSort(onReorder) {
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)

  // iOS Safari(및 터치 기기 전반)는 HTML5 Drag&Drop API 자체를 지원하지 않는데도,
  // draggable=true가 걸린 요소는 WebKit이 터치를 드래그 제스처 후보로 취급해 그 안의
  // 버튼(연필·삭제 등) 탭에 대한 합성 click을 통째로 삼킨다 — 원래도 안 되던 드래그의
  // 대가로 탭까지 막히는 셈이라, coarse pointer(터치)에서는 draggable을 아예 걸지 않는다.
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  const rowProps = (index) => {
    if (coarsePointer) return {}
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragIndex(index)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (index !== overIndex) setOverIndex(index)
      },
      onDrop: (e) => {
        e.preventDefault()
        if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index)
        setDragIndex(null)
        setOverIndex(null)
      },
      onDragEnd: () => {
        setDragIndex(null)
        setOverIndex(null)
      },
    }
  }

  return { dragIndex, overIndex, rowProps }
}

export function DragHandle({ className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-11 w-11 shrink-0 cursor-grab items-center justify-center text-text-meta transition-colors duration-fast ease-out hover:text-text-pri active:cursor-grabbing md:h-24 md:w-24 ${className}`.trim()}
    >
      <GripVertical size={16} />
    </span>
  )
}

export default DragHandle
