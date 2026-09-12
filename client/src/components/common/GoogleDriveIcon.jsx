// Google Drive의 세 색상 마크를 24px 기준 벡터로 제공한다.
// 파일 업로드의 저장 위치를 명확히 알리기 위한 표식이며, 외부 이미지 요청 없이 렌더한다.
function GoogleDriveIcon({ size = 18, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M8.15 2.5h4.66L20 14.95h-4.66L8.15 2.5Z" fill="#0F9D58" />
      <path d="m8.15 2.5-7.2 12.45 2.33 4.03L10.48 6.53 8.15 2.5Z" fill="#4285F4" />
      <path d="M3.28 18.98h14.39L20 14.95H5.61l-2.33 4.03Z" fill="#F4B400" />
    </svg>
  )
}

export default GoogleDriveIcon
