// Container — 전역 페이지 폭은 항상 1280px(max-w-container) 하나로 고정한다.
// 1200→1280으로 바뀌던 2xl 분기를 없애, 공개 페이지·관리자·헤더의 좌우 정렬선이
// 모든 데스크톱 폭에서 동일하다. 장문 폭은 호출부에서 max-w-reading/lead만 추가한다.
function Container({ as: As = 'div', className = '', children, ...rest }) {
  return (
    <As
      className={`dah-safe-inline mx-auto w-full max-w-container px-gutter-m md:px-gutter-t lg:px-gutter-d ${className}`}
      {...rest}
    >
      {children}
    </As>
  )
}

export default Container
