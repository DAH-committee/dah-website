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
    title: '앵커 경진대회 한국연구재단 이사장상 2회 수상',
    desc: '주현호 학생이 한국연구재단과 전국 앵커 사업단이 주최한 두 대회에서 모두 이사장상을 받았습니다.',
    details: [
      '앵커 참여 대학(원)생 우수사례 경진대회 참여 후기 영상 공모전 부문 최우수상 · ‘창업 교과목 수강을 통한 지역 산업체 디지털 소외 문제 해결’',
      '(앵커 AI-Solution) AI 활용 지역문제 현안 해결 경진대회 우수상 · ‘내 돈이 내 편인 앱, 강릉페이 UX 개선 프로젝트’',
    ],
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
//
// 키는 동아리 이름이다. id로 잡으면 안 된다 — 폴백 데이터(clubs.js)는 'club-ds4h' 같은
// 문자열 id를 쓰지만 서버 API는 숫자 id(25~28)를 내려줘서 배포 환경에서만
// 이미지가 통째로 안 보였다. 이름은 양쪽이 같다.
export const clubDeckImages = {
  '더 인스튜디오': [
    { src: '/images/clubs-deck/theinstudio-1.webp', alt: '더 인스튜디오 소개 표지' },
    { src: '/images/clubs-deck/theinstudio-2.webp', alt: '더 인스튜디오 UX·UI 프로젝트 결과물 모음' },
    { src: '/images/clubs-deck/theinstudio-3.webp', alt: '더 인스튜디오 활동 내용 안내' },
    { src: '/images/clubs-deck/theinstudio-4.webp', alt: '더 인스튜디오 동아리 소개' },
  ],
  'I-SO': [
    { src: '/images/clubs-deck/iso-1.webp', alt: 'I-SO 활동 현장 사진' },
    { src: '/images/clubs-deck/iso-2.webp', alt: 'I-SO 활동 안내' },
    { src: '/images/clubs-deck/iso-3.webp', alt: 'I-SO 모집 대상 안내' },
  ],
  'CON:NECT': [
    { src: '/images/clubs-deck/connect-1.webp', alt: 'CON:NECT 소개 표지와 활동 사진' },
    { src: '/images/clubs-deck/connect-2.webp', alt: 'CON:NECT 북페어·콘텐츠페스타·고교 연계 활동 사진' },
    { src: '/images/clubs-deck/connect-3.webp', alt: 'CON:NECT 활동 소개' },
    { src: '/images/clubs-deck/connect-4.webp', alt: 'CON:NECT 동아리 소개' },
  ],
  'DS4H': [
    { src: '/images/clubs-deck/ds4h-1.webp', alt: 'DS4H 데이터 분석 스터디 현장' },
    { src: '/images/clubs-deck/ds4h-2.webp', alt: 'DS4H 프로젝트 결과물' },
  ],
}

// 운영위원회가 한 해 동안 운영하는 전공 행사.
export const councilEvents = {
  title: '운영위원회 활동',
  lead: '한 학기의 시작부터 끝까지, 전공의 공식 행사를 운영합니다.',
  items: [
    { title: '개강 총회', detail: '전공 비전 설명 및 신규 진입·기존 전공생들과의 교류' },
    { title: '공모전 전시회', detail: '캐릭터/장서표/전시회 포스터 공모전 운영 및 결과 전시' },
    { title: '전공 박람회', detail: '전공 소개 및 홍보 행사 운영' },
    { title: '전공 프로젝트 전시회', detail: '학기 말 진행되는 최대 규모의 기말 프로젝트 작품 온·오프라인 동시 전시 행사' },
    { title: '동아리 전시회', detail: '전공 동아리 활동 결과 전시 및 네트워킹' },
    { title: '종강 총회', detail: '학기 마무리 및 시상식 운영' },
    { title: '전공 교류 행사', detail: '타 전공·학과와의 네트워킹 프로그램' },
  ],
}

// 정기 행사 외에 2026년 운영위원회가 새로 만든 결과.
export const councilWork = {
  title: '운영위원회 성과',
  lead: '2026년 운영위원회가 새로 만들거나 바꿔 낸 결과입니다.',
  groups: [
    {
      title: '외부 교류',
      items: ['미래융합스쿨 학생회 교류', '미래융합스쿨 연합 엠티', '동아리 홍보'],
    },
    {
      title: '전공 홍보 및 확산',
      items: ['위원회 인스타그램 디자인 통일 및 정비', '전공 캐릭터 공모전 운영'],
    },
    {
      title: '전공 디지털 전환',
      items: ['바이브코딩 기반 공모전 사이트 제작', '전공 웹사이트 전체 리뉴얼', '전시회 설문 폼 자동화'],
    },
  ],
  footer: '전공의 AX를 운영위원회가 직접 수행하고 있습니다.',
}

export const councilMark = '/images/decade/lucid-mark.svg'
export const closingPhoto = {
  src: '/images/decade/lucid-assembly.webp',
  alt: '2026년 디지털인문예술전공 개강총회에 모인 학생들',
}
