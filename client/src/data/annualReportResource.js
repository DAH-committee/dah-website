const text = (value) => ({ type: 'text', text: value })
const paragraph = (value) => ({ type: 'paragraph', content: [text(value)] })

// 2026 디지털 애뉴얼 리포트는 로그인 없이 누구나 보는 공개 자료다. 자료실 첫 화면에 고정해 찾을 수 있게 한다.
// 목록과 상세가 같은 객체를 쓰므로 제목과 날짜가 어긋나지 않는다.
export const annualReportResource = {
  id: 'annual-report-2026',
  date: '2026-11-23',
  org: '전공',
  tag: '애뉴얼 리포트',
  author: '운영위원회 LUCID',
  pinned: true,
  title: '2026 디지털인문예술전공 애뉴얼 리포트',
  title_ko: '2026 디지털인문예술전공 애뉴얼 리포트',
  title_en: '2026 Digital Arts & Humanities Annual Report',
  body: {
    type: 'doc',
    content: [
      paragraph('디지털인문예술전공의 2026년 한 해를 담은 리포트입니다. 전공 소개부터 전시회와 공모전 그리고 학생 성과까지 94쪽에 실었습니다.'),
      paragraph('로그인 없이 누구나 웹에서 책처럼 넘겨 볼 수 있습니다.'),
    ],
  },
  body_en: {
    type: 'doc',
    content: [
      paragraph('A 94-page digital report on the 2026 year of Digital Arts & Humanities at Hallym University. Anyone can read it on the web without signing in.'),
    ],
  },
}
