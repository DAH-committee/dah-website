const text = (value) => ({ type: 'text', text: value })
const paragraph = (value) => ({ type: 'paragraph', content: [text(value)] })

// 전공 나침반은 발표 당일까지 자료실 첫 화면에 고정 노출하는 전공소개 자료다.
// 목록과 상세가 같은 객체를 쓰므로 제목·날짜·썸네일이 어긋나지 않는다.
export const majorCompassResource = {
  id: 'major-compass',
  date: '2026-09-21',
  org: '전공',
  tag: '전공 소개',
  author: '디지털인문예술전공',
  pinned: true,
  title: '2026 자유전공학부 전공 나침반 | 디지털인문예술전공',
  title_ko: '2026 자유전공학부 전공 나침반 | 디지털인문예술전공',
  poster_url: '/videos/hero-poster.jpg',
  poster_alt: '디지털인문예술전공 전공 나침반 표지',
  body: {
    type: 'doc',
    content: [
      paragraph('자유전공학부 학생을 위한 디지털인문예술전공 전공소개 발표 자료입니다.'),
      paragraph('전공 소개, 교육과정, Code Sharing, 나노디그리, 교수진, 전시와 공모전, 학생 성과, 진로, 운영위원회와 동아리 활동을 발표 흐름으로 확인할 수 있습니다.'),
    ],
  },
}
