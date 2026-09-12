// 공용 Tag — mono caption, 4pt 간격 스케일, text.sec
// v2 스킨(11_DESIGN_V2 5절): 표면을 글래스 톤으로 정돈(blur 미사용 — 상한 3 보존)
function Tag({ children }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-sm border border-glass-line bg-glass-bg px-12 py-4 font-mono text-caption-m text-text-sec">
      {children}
    </span>
  )
}

export default Tag
