const expandSlides = (slides) => slides.flatMap(({ id, steps = 1 }) =>
  Array.from({ length: steps }, (_, step) => ({
    hash: `${id}${step > 0 ? `:${step + 1}` : ''}`,
  })),
)

/**
 * 웹 발표 자료를 PDF로 만드는 공통 등록표입니다.
 * 새 자료는 이 배열에 항목만 추가하면 일괄 생성·자동 갱신됩니다.
 */
export const presentationPdfJobs = [
  {
    id: 'major-compass',
    route: '/major-compass',
    output: 'public/downloads/2026-major-compass.pdf',
    title: '2026 자유전공학부 전공 나침반 발표 자료',
    author: '한림대학교 디지털인문예술전공',
    subject: '디지털인문예술전공 소개 발표 자료',
    pages: expandSlides([
      { id: 'cover' },
      { id: 'about', steps: 3 },
      { id: 'curriculum', steps: 4 },
      { id: 'codesharing' },
      { id: 'nanodegree' },
      { id: 'faculty', steps: 2 },
      { id: 'exhibitions', steps: 2 },
      { id: 'contests', steps: 2 },
      { id: 'achievements' },
      { id: 'careers' },
      // 한수미 교수 「전공교육 우수사례」 구간은 교수님이 따로 발표하셔서 PDF에서도 뺀다.
      // 되살릴 때는 아래 주석을 풀고 MajorCompassExperience.jsx의 enabled: false도 같이 지운다.
      // { id: 'decade-cover' },
      // { id: 'decade-intro' },
      // { id: 'decade-origin', steps: 3 },
      // { id: 'decade-foundation', steps: 3 },
      // { id: 'decade-motivation', steps: 2 },
      // { id: 'decade-assignments', steps: 2 },
      // { id: 'decade-efficacy', steps: 2 },
      // { id: 'decade-exhibition', steps: 2 },
      // { id: 'decade-ai', steps: 3 },
      // { id: 'decade-career', steps: 4 },
      // { id: 'decade-vision', steps: 3 },
      // { id: 'decade-reverse' },
      // { id: 'decade-wrapup', steps: 2 },
      { id: 'council', steps: 4 },
      { id: 'clubs', steps: 4 },
      { id: 'closing' },
    ]),
  },
]

export const pdfDefaults = {
  viewport: { width: 1920, height: 1080 },
  page: { width: 1440, height: 810 },
  imageFormat: 'jpeg',
  imageQuality: 93,
  settleTime: 900,
}
