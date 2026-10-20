// 실행취소·재실행 기록. KnotPad(js/state.js)의 스냅샷 방식(undoStack/redoStack에 상태 통째로 저장)을 옮겼다.
// 보드 상태는 바꿀 때마다 새 객체를 만들기 때문에 스냅샷은 참조만 쌓여 가볍다(바뀌지 않은 항목은 공유).
export const HISTORY_LIMIT = 100

export function createHistory() {
  return { undo: [], redo: [] }
}

/** 바꾸기 직전 상태를 기록한다. 새 변경이 생기면 재실행 기록은 버린다 */
export function record(h, snapshot) {
  h.undo.push(snapshot)
  if (h.undo.length > HISTORY_LIMIT) h.undo.shift()
  h.redo = []
}

/** 되돌린 상태를 돌려준다(없으면 null). current는 재실행 기록으로 옮긴다 */
export function undo(h, current) {
  if (!h.undo.length) return null
  h.redo.push(current)
  return h.undo.pop()
}

export function redo(h, current) {
  if (!h.redo.length) return null
  h.undo.push(current)
  return h.redo.pop()
}
