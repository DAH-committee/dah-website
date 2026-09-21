// majorDecade.js — 「디지털인문예술전공 10년: 전공교육 우수사례」 발표 구간의 원문 데이터.
//
// 출처: 한수미 교수 「전공 교육 우수 사례 - 디지털인문예술전공」(한림대학교 교수 하계 세미나) 28장.
// 문장·수치·사례는 원본 슬라이드를 그대로 옮긴다. 화면 분할과 시각 문법만 이 사이트의
// 발표 디자인시스템(어두운 배경 · Pretendard · 얇은 구분선 · 16:9)으로 다시 이식했다.
// 원본 이미지는 client/public/images/decade/ 에 webp로 이관해 사용한다.

export const decadeCover = {
  eyebrow: '한림대학교 교수 하계 세미나 | 전공교육 우수사례',
  title: '디지털인문예술전공 10년',
  subtitle: '좋아하는 것에서 시작해서 진로로 이어지다',
  presenter: '한수미  |  미래융합스쿨 디지털인문예술전공',
}

export const decadeIntro = {
  title: '이 전공, 무엇을 하는 곳인가요',
  questions: [
    '"디인예요? 거기서 뭘 배우는 거예요?"',
    '"융합전공들이 많이 정리됐는데 저기는 아직 있네?"',
    '"인문사회 학생이 앱을 만든다고요?"',
  ],
  closing: '2017년에 시작한 디지털인문예술전공이 지난 10년 동안 무엇을 어떻게 해왔을까요?',
}

// 원본 3장: 2017년 첫 전시회 화면과 2026년 전시회 화면을 나란히 둔 슬라이드.
// 한 화면에 세 장의 스크린샷이 겹쳐 있어 웹에서는 시점별로 나눈다.
export const decadeOrigin = {
  title: '디인예전공의 시작과 현재',
  past: {
    label: '2017년 2학기 · 첫 프로젝트 전시회',
    images: [
      {
        src: '/images/decade/exhibition-2017.webp',
        alt: '2017년 2학기 제1회 디지털인문예술전공 프로젝트 전시회 웹사이트 화면',
        w: 2200,
        h: 1158,
      },
    ],
  },
  present: {
    label: '2026년 1학기 · 제18회 프로젝트 전시회',
    images: [
      {
        src: '/images/decade/exhibition-2026-hero.webp',
        alt: '2026-1 DAH Exhibition "Against the Flow" 전시 웹사이트 첫 화면',
        w: 2322,
        h: 924,
      },
      {
        src: '/images/decade/exhibition-2026-intro.webp',
        alt: '2026-1 프로젝트 전시회 소개 화면',
        w: 1652,
        h: 648,
      },
    ],
    enrollment: '현재 재적학생수: 262명',
    source: '2026-1 DAH Exhibition: https://26-1-dah-exhibition.vercel.app/',
  },
}

export const decadePrinciple = {
  label: 'Since 2017',
  title: '디인예전공의 시작과 현재',
  lead: '2인의 교수가 2017년 스타트업 회사처럼 시작했습니다. 판단 기준은 다음과 같습니다.',
  quote: '"내 자녀가 혹은 조카가 이 수업을 듣는다면, 나는 어떻게 가르칠 것인가."',
  quoteDetail: [
    '세상에 나갔을 때 노력한 만큼 인정받을 수 있는 교육.',
    '이걸 기준으로 커리큘럼을 짜고 수업을 만들고 10년 동안 고쳐왔습니다.',
  ],
  rules: [
    { title: '빨리 만들고 빨리 고친다', detail: '정답이 없으니 일단 해보고 안 되면 바꿨습니다' },
    { title: '학생 한 명 기준으로', detail: '몇 명이 듣느냐보다 그 학생에게 도움이 되는지를 보았습니다.' },
    { title: '노력이 남게', detail: '들인 시간이 결과물로 남는 구조를 만들었습니다' },
  ],
}

export const decadeAgenda = {
  title: '목차',
  items: [
    { no: '1', title: '동기', detail: '좋아하는 것에서 시작' },
    { no: '2', title: '효능감', detail: '결과물이 남고 자기성장' },
    { no: '3', title: '진로', detail: '진로 탐색을 빠르고 꾸준히' },
    { no: '4', title: '디인예의 다음 10년', detail: 'AI 솔로프리너와 새로운 시도' },
  ],
}

export const decadeProblem = {
  label: '출발점',
  title: '처음에 부딪힌 문제',
  lead: '디인예전공과 같은 융합전공은 여러 분야를 배운다는 장점이 있지만, 학생 입장에서는 소속감도 결과물도 진로도 잘 잡히지 않습니다.',
  items: [
    { tag: '동기', quote: '"내가 왜 이걸 배우죠?"', detail: '전공 정체성이 흐릿해 학습 동기가 붙지 않음' },
    { tag: '효능감', quote: '"한 학기 지났는데 남은 게 없어요"', detail: '수업은 들었지만 보여줄 산출물이 없음' },
    { tag: '진로', quote: '"저는 앞으로 무엇을 할 수 있죠?"', detail: '하고 싶은 일 등을 스스로 설명하지 못함' },
  ],
  footer: '학생 상담에서 흔한 질문입니다. 다양한 이유로 우리 학생들은 미래가 불안합니다.',
}

export const decadeDesign = {
  label: '설계 원리',
  title: '학습동기, 효능감, 그리고 진로 설계',
  lead: '1학년에게 진로부터 말하면 부담스러워합니다. 흥미가 붙고 작은 성공이 쌓인 다음에야 진로 이야기를 자기 일로 받아들입니다.',
  stages: [
    { title: '동기', detail: '좋아하는 것을 수업에서 다룹니다' },
    { title: '효능감', detail: '만든 것을 남들이 봅니다' },
    { title: '진로', detail: '만든 것이 모여 직무가 됩니다' },
  ],
  footer: '학생이 "다음 학기엔 더 큰 걸 해보고 싶다"고 시도하면 성공한 것입니다!',
}

export const decadeParts = {
  motivation: { no: 'Part 1', title: '동기', detail: '학생이 좋아하는 것에서 시작합니다' },
  efficacy: { no: 'Part 2', title: '효능감', detail: '만든 것을 남에게 보여줄 때 생깁니다' },
  career: { no: 'Part 3', title: '진로', detail: '자기 진로를 설명할 수 있게 만듭니다' },
  vision: { no: 'Part 4', title: '다음 10년', detail: '디인예의 비전: 앞으로 무엇을 할 것인가' },
}

export const decadeFamiliar = {
  label: 'Part 1 · 동기',
  title: '익숙한 것을 낯설게 보기',
  blocks: [
    {
      title: '학생이 매일 쓰는 것에서 출발합니다',
      lines: [
        '토스, 당근마켓, 쿠팡, 웹툰, 게임, 유튜브',
        '학생이 이미 잘 아는 영역이라 설명이 필요 없음',
        '"이걸 왜 배우죠?"라는 질문도 안 나옴',
      ],
    },
    {
      title: '그 다음 낯설게 봅니다',
      lines: [
        '"왜 이 화면은 이렇게 생겼을까?"',
        '"이 데이터는 누가, 왜 모을까?"',
        '쓰는 사람에서 분석하는 사람, 기획하는 사람으로',
      ],
    },
  ],
  aside: {
    label: '교수가 할 일',
    statement: '그 학기 학생들이 무엇을 좋아하는지 매번 다시 봅니다',
    detail: '교재는 몇 년을 쓰지만 학생 관심사는 한 학기면 바뀝니다. 학기 초 간단한 설문 하나로 그 학기에 쓸 사례가 정해집니다.',
  },
}

export const decadeAssignments = {
  label: 'Part 1 · 동기',
  title: '학생 관심사로 만든 과제들',
  items: [
    { title: '엔터테인먼트 컬처 분석', detail: '좋아하는 콘텐츠를 데이터로 분석해봅니다. 덕질이 그대로 분석 훈련이 됩니다' },
    { title: '서브웨이 고객 설문지 개선', detail: '실제 설문지의 문항을 뜯어보고 다시 설계합니다. 조사방법론 입문 과제입니다' },
    { title: '통계 만화 제작', detail: '어려운 통계 개념을 네 컷 만화로 그립니다. 설명할 수 있어야 이해한 것이니까요' },
    { title: '유기견 문제 해결 프로젝트', detail: '학생들이 직접 고른 주제로 서비스 기획부터 웹사이트, 영상까지 만들었습니다' },
  ],
  footer: '네 과제 모두 정답이 없고, 학생이 이미 아는 소재이고, 결과물이 눈에 보입니다.',
  shot: {
    image: '/images/decade/assignment-classroom.webp',
    alt: '학생 관심사를 주제로 낸 실제 수업 과제 화면',
    caption: 'AI 시대에 아이디어가 중요하다고 합니다. 학생들이 창의적인 아이디어를 발굴하기 위해서는 꽤 많은 훈련이 필요합니다.',
  },
}

export const decadeProject = {
  label: 'Part 2 · 효능감',
  title: '수업마다 결과물이 남게 했습니다',
  lead: '모든 전공 수업을 프로젝트 기반으로 운영하고, 공개할 수 있는 결과물로 마무리합니다.',
  steps: [
    { title: '문제 발견', detail: '학생이 스스로 주제 선정' },
    { title: '조사 · 분석', detail: '데이터 수집, 사용자 조사' },
    { title: '제작', detail: 'AI 도구로 직접 구현' },
    { title: '공개', detail: '포스터 · 웹사이트 · 영상' },
    { title: '축적', detail: '개인 포트폴리오로 누적' },
  ],
  footer: [
    '학습에 대한 효능감에서 4번과 5번은 매우 중요합니다.',
    '제출하고 끝나는 과제와 남이 보게 되는 결과물은 학생이 들이는 공이 다릅니다.',
  ],
}

export const decadeExhibition = {
  label: 'Part 2 · 효능감',
  title: '프로젝트 전시회',
  lead: '2017년 2학기, 첫 전시회 이후 매 학기 열고 있습니다.',
  stats: [
    { value: '10년', caption: '중단 없이 지속' },
    { value: '18회', caption: '누적 개최 횟수' },
    { value: '100%', caption: '전공 수업 참여' },
  ],
  reason: {
    label: '왜 전시회인가',
    detail: '교수만 보던 과제를 모르는 사람도 보게 됩니다. 보는 사람이 생기니 완성도가 달라집니다. 자기 작업을 직접 설명해보는 기회가 프로젝트 전시회입니다.',
  },
  output: {
    label: '산출물 형태',
    detail: '포스터  ·  앱 디자인/개발  ·  웹사이트  ·  유튜브 영상  ·  데이터 대시보드 등',
  },
  shot: {
    image: '/images/decade/exhibition-2026-works.webp',
    alt: '2026년 1학기 프로젝트 전시회 출품작 목록 화면',
    caption: '2026년 1학기 프로젝트 전시회 출품작',
  },
}

export const decadeAiGap = {
  label: 'Part 2 · 효능감',
  title: 'AI 수업은 격차를 확인하는 것부터',
  titleNote: 'AI 격차에 대한 메타인지',
  lead: '사용법부터 가르치면 잘 쓰는 학생은 더 잘 쓰고 못 쓰는 학생은 포기합니다. 학기 초에 격차를 스스로 확인하는 과제를 먼저 냅니다.',
  steps: [
    { title: '같은 과제로 시작', detail: '전원이 같은 조건으로 AI 스토리북 등 제작' },
    { title: '중간발표/결과물 비교', detail: '자극과 동기 부여' },
    { title: '원인 등 토론', detail: '프롬프트, 검증, 반복 횟수에서 차이 발생' },
    { title: '배울 이유 = 학습 동기 상승', detail: '이후 AI 수업에 대한 태도 변화(+ 프로젝트 전시회 결과물 비교)' },
  ],
  rules: {
    label: '운영 원칙',
    items: [
      'AI를 쓰게 하되 쓴 과정을 기록하게 합니다',
      '수업마다 AI 사용 기준을 밝힙니다 (교수학습센터, 교양과 연계)',
      '주 도구: ChatGPT · Claude · Gemini · Notion',
    ],
  },
}

export const decadeStorybook = {
  label: 'Part 2 · 효능감',
  title: '제미나이 스토리북 사례',
  images: [
    { src: '/images/decade/ai-storybook-strip.webp', alt: '제미나이 스토리북으로 만든 결과물 장면', w: 928, h: 320 },
    { src: '/images/decade/ai-storybook-result.webp', alt: '제미나이 스토리북 제작 화면', w: 880, h: 634 },
  ],
}

export const decadeDemo = {
  label: 'Part 2 · 효능감',
  title: '교수가 직접 써서 보여줍니다',
  lead: 'AI 격차를 확인한 다음이 중요합니다. 교수가 써보고 좋았던 것 한두 개를 그 자리에서 보여주면 학습효과가 높습니다.',
  listLabel: '수업에서 보여주는 것',
  items: [
    { title: '설문지 만들기', detail: '참고문헌을 조사한 뒤, AI로 문항 작성하고, 편향되거나 겹치는 문항을 걸러내는 과정까지 보여줍니다.' },
    { title: '프롬프트 써보기', detail: '같은 요청을 세 번 다르게 써서 결과가 어떻게 달라지는지 그 자리에서 비교합니다.(퀴즈 만들기 등)' },
    { title: '문서와 PPT 초안', detail: '어디까지 맡기고 어디서부터 직접 손보는지를 보여줍니다.(클로드 vs. 퍼플렉시티)' },
  ],
  aside: {
    label: '마지막은 비교 과제',
    detail: '같은 과제를 ChatGPT, Claude, Perplexity, Gemini에 각각 넣어보고 장단점을 정리하게 합니다.',
    note: '어떤 도구를 고를지 아는 것도 실력입니다.',
    quote: ['AI는 다들 쓸 수 있습니다.', '차이는 어떻게 쓰느냐에서 납니다.'],
  },
  footer: 'AI 시대, 연구 역량을 강조하고 있습니다.',
}

export const decadeJobMap = {
  label: 'Part 3 · 진로',
  title: '1주차에 보여주는 직군 지도',
  lead: '이 전공을 하면 어떤 일을 하게 되는지를 네 묶음으로 먼저 보여줍니다.',
  groups: [
    { title: 'UX/UI 디자인 기획 · 제작', detail: 'UX 디자이너, 시각 디자이너\n사회혁신디자인, 크리에이터 · 디지털 마케터' },
    { title: '데이터 분석 · 활용', detail: '데이터 사이언티스트 · AI 연구원\n비즈니스 애널리스트' },
    { title: 'AI 서비스 기획 · 개발', detail: 'AI 서비스 기획자/디자이너/개발자, 프로덕트 매니저' },
    { title: '엔터테인먼트산업', detail: '디지털 아트 디렉터, 문화콘텐츠 기획자, 전시 기획자,\nK-Culture 기획자/제작자' },
  ],
  footer: '교수와 학생이 전공에 대한 소속감과 방향성을 공유합니다.',
}

export const decadeSolopreneurShot = {
  label: 'Part 3 · 진로',
  title: '대융합의 시대이자, AI솔로프리너의 시대!',
  image: '/images/decade/stack-2017-2026.webp',
  alt: '2017년과 2026년의 기술 스택 차이를 키 높이로 비교한 그림',
  source: '출처: https://www.youtube.com/shorts/jDIgubyxnzU',
}

export const decadeThenNow = {
  label: 'Part 3 · 진로',
  title: '2017년 vs. 2026년',
  lead: '한 사람이 혼자 할 수 있는 일의 범위가 이만큼 달라졌습니다.',
  past: {
    year: '2017',
    lines: ['유튜브 강의 보기', '검색해서 따라 하기', '학교 수업 듣기', '뭘 해야 할지 모르겠음'],
    note: ['아이디어가 있어도', '혼자서는 만들 수 없었습니다.'],
  },
  present: {
    year: '2026',
    items: [
      { title: '기획 · 리서치', detail: '문제를 찾고 정의' },
      { title: '디자인 · 프로토타입', detail: '화면과 흐름을 직접 제작' },
      { title: '데이터 분석', detail: '근거를 확인' },
      { title: '개발 · 배포', detail: '노코드와 바이브 코딩으로' },
      { title: '콘텐츠 · 영상', detail: '알리는 것까지 직접' },
      { title: '운영 · 개선', detail: '공유하고 개선' },
    ],
  },
  footer: '예전에는 이걸 다 배워야 혼자 할 수 있었습니다. 지금은 AI와 함께 할 수 있습니다.',
}

export const decadeCompetency = {
  label: 'Part 4 · 디인예 비전',
  title: '프로젝트의 기반 다섯가지 역량',
  lead: '문제를 찾는 것부터 해결까지를 한 흐름으로 두고 그 안에 다섯 역량(feat. AI)을 넣었습니다.',
  flow: ['문제 발굴', '문제 정의', '해결안 설계', '프로토타입 구현', '공개 · 검증'],
  items: [
    { title: '지역과 글로벌 이슈 탐색', detail: '문제를 사람의 경험으로 다시 살펴보기' },
    { title: '디자인 씽킹', detail: '무엇을 개선하고 해결하고 목표로 하고 있는가' },
    { title: '데이터 분석', detail: '데이터기반 근거로 문제를 분석하고 해결방안 도출' },
    { title: '스토리텔링', detail: '만든 것을 이해가능하게 전달' },
    { title: 'AI 서비스 개발', detail: '노코드와 바이브 코딩' },
  ],
  footer: '수업 난이도를 조절해서 1학년부터 4학년까지 위의 다섯 역량이 최종적으로 발휘되도록 가르치고 있습니다.',
}

export const decadeSolopreneur = {
  label: 'Part 4 · 디인예 비전',
  title: 'AI 솔로프리너',
  definition: 'AI를 팀처럼 써서 혼자서도 기획부터 제작, 출시, 운영까지 해내는 사람',
  blocks: [
    {
      title: '왜 지금인가',
      lines: [
        '다섯 명이 붙어야 했던 일을 한 명이 합니다',
        '만드는 비용이 줄면서 아이디어의 값이 올라갔습니다',
        '기획과 해석이 강점인 인문사회 학생에게 유리합니다',
      ],
    },
    {
      title: '무엇이 필요한가',
      lines: [
        '남들이 그냥 지나친 불편을 알아보는 눈',
        '도구를 고르고 결과를 검증하는 능력',
        '끝까지 만들어 내본 경험',
      ],
    },
  ],
  footer: 'AI 시대 인재란? AI와 함께 아이디어 발굴에서부터 실제 프로덕트를 구현하는 역량을 지속적으로 쌓아나가는 사람!',
}

export const decadeReverse = {
  label: 'Part 4 · 디인예 비전',
  title: '새로운 시도: Reverse Learning & Scaling Up',
  lead: '가르치는 순서와 목표를 다르게!',
  blocks: [
    {
      title: 'Reverse Learning',
      subtitle: '거꾸로 배운다',
      lines: [
        'AI로 완성된 결과물을 먼저 만들기',
        '그 다음에 왜 이렇게 되는지를 분석',
        '기초부터 쌓는 순서를 뒤집는 방식',
        '코딩이나 디자인/영상 생성 등의 역량이 없던 학생에게 새로운 기회를 제공',
      ],
    },
    {
      title: 'Scaling Up',
      subtitle: '목표를 훨씬 높게 잡는다',
      lines: [
        '레포트 한 편이 아니라 실제로 쓰이는 서비스까지',
        '만드는 비용이 줄었으니 목표를 올려야 배우는 양이 유지',
        '목표가 높으면 오히려 더 몰입하고 협업',
        '결과물이 그대로 포트폴리오로',
        'AI 활용 교수법 혁신 → 3학점 수업에서 6학점 수업 성과',
      ],
    },
  ],
  footer: '디인예에서 먼저 해보고 결과를 공유하겠습니다.',
}

export const decadeWrapUp = {
  label: '다음 학기에 바로 해보실 만한 것',
  title: '정리하며',
  items: [
    { title: '꾸준히 학생들의 관심 파악하기', detail: '설문 다섯 문항이면 그 학기에 쓸 사례가 정해집니다.' },
    { title: '과제를 남이 볼 수 있게 마무리하기', detail: '노션 페이지 하나, 포스터 한 장이면 충분합니다.' },
    { title: '1주차에 커리큘럼 대신 직군 이름 알려주기', detail: '이 수업을 들으면 어떤 일을 하게 되는지 먼저 말해줍니다.' },
    { title: 'AI는 격차를 먼저 보여주고 직접 써서 시연하기', detail: '같은 과제로 차이를 확인시킨 뒤, 써보고 좋았던 도구를 보여줍니다.' },
    { title: '결과물을 한 곳에 모으게 하기', detail: '쌓이고 있다는 걸 학생이 눈으로 볼 수 있게 합니다.' },
  ],
}

export const decadeNext = {
  label: '마무리',
  title: '2027년, 디인예 새로운 도약',
  lead: '전공명과 구조를 새로 쓰고자 합니다 — Design, AI & EnterCulture (DAE)',
  items: [
    { title: 'Career Ready', detail: '모든 교과목이 직군과 직접 연결되도록 재편' },
    { title: 'AI Ready', detail: '전 과목 AI 활용을 역량 기준으로 명문화' },
    { title: 'Change Ready', detail: '중재형(mediator) 융합인재 양성 = AI솔로프리너' },
  ],
  closing: '감사합니다.',
}
