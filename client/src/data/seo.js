// seo.js — 공개 페이지의 검색 제목·설명 원본. 화면용 카피와 분리해 두되,
// 실제 페이지에 있는 교육·활동 정보만 사용한다. 키워드 나열이나 숨김 텍스트는 금지한다.

export const SITE_NAME = '한림대학교 디지털인문예술전공'
export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://dah-hallym.vercel.app')
  .trim()
  .replace(/\/+$/, '')

export const PAGE_SEO = {
  '/': {
    title: SITE_NAME,
    description:
      '한림대학교 디지털인문예술전공은 AI, 디자인, 인문사회학을 융합해 디지털 시대의 새로운 가치를 만드는 교육과정입니다.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      name: SITE_NAME,
      alternateName: 'Digital Arts and Humanities',
      url: SITE_URL,
      parentOrganization: { '@type': 'CollegeOrUniversity', name: '한림대학교' },
    },
  },
  '/about': {
    title: '디지털인문예술전공 소개 | 한림대학교 AI·디자인·인문학 융합전공',
    description:
      'AI·디지털 기술, 인간 중심 디자인, 인문사회학적 통찰을 연결하는 한림대학교 디지털인문예술전공을 소개합니다.',
  },
  '/about/people': {
    title: '한림대학교 디지털인문예술전공 교수진·산업 멘토',
    description: '한림대학교 디지털인문예술전공의 교수진과 디자인·AI·콘텐츠 분야 산업 멘토를 소개합니다.',
  },
  '/about/ci': {
    title: '디지털인문예술전공 CI | 한림대학교',
    description: '한림대학교 디지털인문예술전공의 브랜드 아이덴티티, 로고, 전용색상과 활용 가이드를 안내합니다.',
  },
  '/curriculum': {
    title: '디지털인문예술전공 교육과정 | 디자인·AI·엔터컬쳐 트랙',
    description:
      '한림대학교 디지털인문예술전공의 디자인, AI 디지털인문학, 엔터컬쳐 트랙과 수준·학기별 교과목을 확인하세요.',
  },
  '/curriculum/codesharing': {
    title: '디지털인문예술전공 코드쉐어링 | 타과 교과목 인정 안내',
    description: '타과 교과목의 디지털인문예술전공 인정 기준과 코드쉐어링 절차를 안내합니다.',
  },
  '/curriculum/nanodegree': {
    title: '디지털인문예술전공 나노디그리 | AI 디자인·UX 디자인 과정',
    description: 'AI 디자인, UX 디자인, 디지털 디자인, AI와 길 정보 구축 나노디그리 과정을 안내합니다.',
  },
  '/programs/exhibitions': {
    title: '한림대학교 디지털인문예술전공 프로젝트 전시회 아카이브',
    description: '2017년부터 이어진 한림대학교 디지털인문예술전공 학생 프로젝트 전시회와 회차별 주제를 확인하세요.',
  },
  '/programs/contests': {
    title: '디지털인문예술전공 공모전 | 전시 포스터·장서표·캐릭터',
    description: '프로젝트 전시회 포스터, 장서표 디자인, 신규 캐릭터 공모전 등 전공 관련 공모전 정보를 안내합니다.',
  },
  '/programs/lectures': {
    title: '디지털인문예술전공 특강 | 디자인·AI·디지털 실무 프로그램',
    description: '디자인, AI, 디지털 도구와 콘텐츠 분야의 교내외 특강·실무 프로그램을 확인하세요.',
  },
  '/students/council': {
    title: '디지털인문예술전공 운영위원회 LUCID | 한림대학교',
    description: '한림대학교 디지털인문예술전공 운영위원회 LUCID와 역대 학생회 활동을 소개합니다.',
  },
  '/students/clubs': {
    title: '디지털인문예술전공 학생 동아리 | UX·디자인·콘텐츠·데이터',
    description: 'UX·UI, 시각디자인, 콘텐츠, 데이터 분야에서 활동하는 디지털인문예술전공 학생 동아리를 소개합니다.',
  },
  '/students/achievements': {
    title: '디지털인문예술전공 학생 성과 | AI·디자인·캡스톤 수상',
    description: 'AI, 디자인, 디지털인문학, 지역문제 해결, 캡스톤 프로젝트 분야의 학생 수상·연구 성과를 소개합니다.',
  },
  '/students/careers': {
    title: '디지털인문예술전공 진로 | 디자인·AI·콘텐츠·디지털 마케팅',
    description: '졸업생의 디자인, 인공지능, 디지털 마케팅, 콘텐츠, 개발, 대학원 진학 사례를 확인하세요.',
  },
  '/showcase': {
    title: '디지털인문예술전공 웹·앱 쇼케이스 | 한림대학교 학생 프로젝트',
    description: '한림대학교 디지털인문예술전공 학생이 만든 웹·앱·AI 프로젝트를 소개합니다.',
  },
  '/news': {
    title: '한림대학교 디지털인문예술전공 공지사항',
    description: '한림대학교 디지털인문예술전공의 전시, 공모전, 특강, 학생 활동과 교내외 소식을 확인하세요.',
  },
  '/resources': {
    title: '디지털인문예술전공 자료실 | 한림대학교',
    description: '한림대학교 디지털인문예술전공의 교육과정·코드쉐어링 관련 자료를 확인하세요.',
  },
}

export function normalizeSeoPath(pathname = '/') {
  if (pathname === '/en') return '/'
  return pathname.startsWith('/en/') ? pathname.slice(3) : pathname
}

export function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  }
}
