// majorCompassDeck.js — 전공 나침반 발표(/major-compass) 화면 전용 보강 데이터.
//
// 사이트 본문 데이터(achievements.js · clubs.js · council.js)는 자동 생성 파일이라 손대지 않는다.
// 발표에서만 필요한 묶음(중복 수상 통합, 동아리 이미지, 위원회 활동)을 여기에 둔다.

// 학생 성과 대표 3건.
// achievements.js에는 같은 사업의 연도별 수상이 따로 들어 있어 발표에서는 하나로 합쳐 보여준다.
export const achievementHighlights = [
  {
    id: 'kdm-plus',
    period: '2023 – 2026',
    title: '세계일류 디자이너 양성사업(KDM+) 4년 연속 선발',
    desc: 'Korea Design Membership Plus(KDM+)에 2023년 심재연, 2024년 원수정, 2025년 이예린, 2026년 주현호·허준희 학생이 선발되었습니다. 4년 연속 합격이며, 2026년에는 두 명이 동시에 선발되었습니다.',
    awardees: '심재연, 원수정, 이예린, 주현호, 허준희',
  },
  {
    id: 'anchor-nrf',
    period: '2026',
    title: '앵커사업단 한국연구재단 이사장상 2회 수상',
    desc: '주현호 학생이 앵커사업단 주관 사업에서 한국연구재단 이사장상을 두 차례 수상했습니다.',
    awardees: '주현호',
  },
  {
    id: 'ai-edutech',
    period: '2025',
    title: '2025 AI 에듀테크 소프트랩 해커톤 대상 수상',
    desc: '김도희, 감주희, 박근영, 홍지윤 학생이 2025년 개최된 AI 에듀테크 소프트랩 해커톤에서 대상을 수상했습니다. 「AI 저수율 알리미 : 실시간 저수율 데이터로 하는 강릉 가뭄 대비」',
    awardees: '김도희, 감주희, 박근영, 홍지윤',
  },
]

// 동아리별 실제 카드뉴스·활동 사진.
// 개인 전화번호가 찍힌 장(DS4H 표지, 아이소 지원방법, 커넥트 문의)은 발표 자료에서 제외했다.
export const clubDeckImages = {
  'club-the-instudio': [
    { src: '/images/clubs-deck/theinstudio-1.webp', alt: '더 인스튜디오 소개 표지' },
    { src: '/images/clubs-deck/theinstudio-2.webp', alt: '더 인스튜디오 UX·UI 프로젝트 결과물 모음' },
    { src: '/images/clubs-deck/theinstudio-3.webp', alt: '더 인스튜디오 활동 내용 안내' },
    { src: '/images/clubs-deck/theinstudio-4.webp', alt: '더 인스튜디오 동아리 소개' },
  ],
  'club-i-so': [
    { src: '/images/clubs-deck/iso-1.webp', alt: 'I-SO 활동 현장 사진' },
    { src: '/images/clubs-deck/iso-2.webp', alt: 'I-SO 활동 안내' },
    { src: '/images/clubs-deck/iso-3.webp', alt: 'I-SO 모집 대상 안내' },
  ],
  'club-connect': [
    { src: '/images/clubs-deck/connect-1.webp', alt: 'CON:NECT 소개 표지와 활동 사진' },
    { src: '/images/clubs-deck/connect-2.webp', alt: 'CON:NECT 북페어·콘텐츠페스타·고교 연계 활동 사진' },
    { src: '/images/clubs-deck/connect-3.webp', alt: 'CON:NECT 활동 소개' },
    { src: '/images/clubs-deck/connect-4.webp', alt: 'CON:NECT 동아리 소개' },
  ],
  'club-ds4h': [
    { src: '/images/clubs-deck/ds4h-1.webp', alt: 'DS4H 데이터 분석 스터디 현장' },
    { src: '/images/clubs-deck/ds4h-2.webp', alt: 'DS4H 프로젝트 결과물' },
  ],
}

// 운영위원회가 2026년에 실제로 한 일.
export const councilWork = {
  title: '2026년, 우리가 한 일',
  lead: '전공이 AX를 가르치는 동안, 운영위원회도 전공의 AX를 직접 만들었습니다.',
  groups: [
    {
      title: '전공을 잇다',
      items: ['미래융합스쿨 학생회 교류', '미래융합스쿨 연합 엠티', '동아리 홍보'],
    },
    {
      title: '전공을 알리다',
      items: ['위원회 인스타그램 디자인 통일 및 정비', '전공 캐릭터 공모전 운영'],
    },
    {
      title: '전공을 짓다',
      items: ['바이브코딩으로 최초의 공모전 사이트 제작', '전공 웹사이트 전체 리뉴얼', '전시회 설문 폼 자동화'],
    },
  ],
  footer: '즉, 우리도 전공의 AX를 이루어 내고 있습니다.',
}

export const councilMark = '/images/decade/lucid-mark.svg'
export const closingPhoto = {
  src: '/images/decade/lucid-assembly.webp',
  alt: '2026년 디지털인문예술전공 개강총회에 모인 학생들',
}
