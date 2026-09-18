// ImageFrame.jsx — 비율 고정 이미지 프레임 (C1, 22_PHASE10)
// 교수 사진·전시 포스터·동아리 로고·위원회 로고·쇼케이스 이미지 공용 래퍼.
//
// - ratio: CSS aspect-ratio 문자열('306/427' 세로형, '2/3', '1/1', '16/9')로 프레임 비율 고정
// - bg=false(기본): 사진·포스터 → object-cover로 프레임을 여백 없이 꽉 채움
// - bg=true: 투명 PNG 로고 → object-contain + bg-bg-frame(중성 배경) 위에 로고 전체 노출
// - src 없으면(또는 로드 실패 시) placeholder(노드) 또는 기본 캡션. 색·간격은 토큰 클래스만.
import { useState } from 'react'

function ImageFrame({
  src,
  alt = '',
  ratio = '2/3',
  bg = false,
  contain = false,
  loading = 'lazy',
  className = '',
  imgClassName = '',
  placeholder = null,
}) {
  // 로고류는 잘림 없이 전체 노출(object-contain). bg=true도 배경 프레임 위 로고라 contain.
  // 사진·포스터는 contain·bg 모두 false → object-cover로 프레임을 꽉 채운다.
  const isContain = contain || bg
  // 26_CI: 정적 슬롯(/ci/*.png 등) 파일 부재 시 깨진 이미지 대신 placeholder 노출.
  // src별로 실패를 추적해 어드민이 새 src를 넣으면 다시 시도한다.
  //
  // 주의: 여기서 useEffect로 loadedSrc를 null로 초기화하면, 브라우저 캐시에 있던
  // 이미지는 onLoad가 먼저 실행된 뒤 effect가 다시 null을 덮어쓴다. 그러면 이미지는
  // 실제로 내려받았는데도 opacity-0(로딩 스켈레톤)으로 영구히 남는다. 전시·공모전의
  // 이관된 정적 포스터가 빈 프레임으로 보이던 원인이었다. src 비교만으로 전환 상태를
  // 계산하면 effect 없이도 새 src에는 자동으로 로딩 상태가 적용된다.
  const [erroredSrc, setErroredSrc] = useState(null)
  const [loadedSrc, setLoadedSrc] = useState(null)
  const showImg = src && erroredSrc !== src
  const loadingImage = showImg && loadedSrc !== src

  return (
    <div
      aria-busy={loadingImage || undefined}
      className={`relative w-full overflow-hidden rounded-md ${
        bg ? 'bg-bg-frame' : 'bg-bg-elev'
      } ${className}`.trim()}
      style={{ aspectRatio: ratio }}
    >
      {showImg ? (
        <>
          {loadingImage && <span aria-hidden="true" className="absolute inset-0 bg-bg-panel" />}
          <img
            src={src}
            alt={alt}
            loading={loading}
            onLoad={() => setLoadedSrc(src)}
            onError={() => setErroredSrc(src)}
            className={`absolute inset-0 h-full w-full transition-opacity duration-base ease-out ${
              loadingImage ? 'opacity-0' : 'opacity-100'
            } ${isContain ? 'object-contain p-12' : 'object-cover'} ${imgClassName}`.trim()}
          />
        </>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center px-12 text-center font-mono text-caption-m text-text-meta">
          {placeholder}
        </span>
      )}
    </div>
  )
}

export default ImageFrame
