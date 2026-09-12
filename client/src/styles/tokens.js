// tokens.js — DAH 웹사이트 디자인 토큰 (단일 진실 소스)
// 색상·표면·그림자는 index.css의 --dah-* CSS 변수에서 결정한다. Tailwind는 여기의
// 변수만 참조하므로 기본 테마와 이스터에그 테마가 같은 컴포넌트·클래스 체계를 쓴다.
// 32_REBRAND — 색상 전면 리브랜딩. 유일 기준: docs/CI.md(4장 컬러 시스템, 4.5 위계).
// 딥 퍼플 블랙(우주) + 보라(지성). 순수 검정·청록·옐로우·핑크 금지.

const cssColor = (name) => `rgb(var(--dah-${name}) / <alpha-value>)`
const cssVar = (name) => `var(--dah-${name})`

export const colors = {
  // 배경 (딥 퍼플 블랙, CI 4.2 — 순수 검정 금지)
  bg: {
    base: cssColor('bg-base'),
    elev: cssColor('bg-elev'),
    panel: cssColor('bg-panel'),
    frame: cssColor('bg-frame'),
    invert: cssColor('bg-invert'),
  },
  // 텍스트 (CI 4.2 — 보라 본문 금지, 위계는 그레이 3단)
  text: {
    pri: cssColor('text-pri'),
    sec: cssColor('text-sec'),
    meta: cssColor('text-meta'),
    disabled: cssColor('text-disabled'),
    invert: cssColor('text-invert'),
  },
  // 브랜드 보라 스케일 (CI 4.2) — 강조·인터랙션 전용, 넓은 본문 배경 금지
  purple: {
    primary: cssColor('purple-primary'),
    light: cssColor('purple-light'),
    mid: cssColor('purple-mid'),
    deep: cssColor('purple-deep'),
    deepDark: cssColor('purple-deep-dark'),
  },
  // 보더 (헤어라인 시스템, CI 4.2)
  border: {
    subtle: cssVar('border-subtle'),     // Hairline White 10% — 기본 카드/구분선
    strong: cssVar('border-strong'),     // hover, 활성 상태(화이트 헤어라인 강조)
    purple: cssVar('border-purple'),     // Hairline Purple 15% — 약한 보라 경계선
    // A5(36_ACCENT_POLISH): 트랙 카드 hover에서 보라 헤어라인이 "진해지는" 단계.
    // CI 4.2 Hairline Purple과 같은 #C8B9F2를 불투명도만 올린 값(색+불투명도 방식).
    purpleStrong: cssVar('border-purple-strong'),
    focus: cssColor('border-focus'),     // 키보드 포커스 링(CI 4.5 인터랙션 Mid Purple)
    invert: cssVar('border-invert'),     // 보라 경계선(레거시 키 호환)
  },
  // 강조·링크 위계 (CI 4.5) — 색상만으로 구분하지 말고 별도 인터랙션 병행
  link: {
    DEFAULT: cssColor('link'),       // 기본 링크
    hover: cssColor('link-hover'),   // hover
    active: cssColor('link-active'), // 활성
  },
  // 아이콘 위계 (CI 4.5) — 아이콘 전체를 보라로 통일하지 않는다
  icon: {
    DEFAULT: cssColor('icon'),          // 기본
    active: cssColor('icon-active'),    // 활성
    key: cssColor('icon-key'),          // 핵심
    disabled: cssColor('icon-disabled'),// 비활성
  },
  // 버튼 위계 (CI 4.5)
  button: {
    primary: cssColor('button-primary'),             // Primary 배경
    primaryText: cssColor('button-primary-text'),    // Primary 텍스트
    primaryHover: cssColor('button-primary-hover'),  // Primary hover
    primaryPressed: cssColor('button-primary-pressed'), // Primary pressed
    secondaryBorder: cssColor('button-secondary-border'), // Secondary 테두리
    secondaryText: cssColor('button-secondary-text'), // Secondary 텍스트
    secondaryHover: cssColor('button-secondary-hover'), // Secondary hover(배경/채움)
    ghostText: cssColor('button-ghost-text'),        // Ghost 텍스트
    ghostHover: cssColor('button-ghost-hover'),      // Ghost hover 배경(Glass Surface)
  },
  // 상태 컬러 — CI 7.3: 브랜드 승격 금지, 시스템 경고용 최소 사용만.
  state: {
    error: cssColor('state-error'),
    success: cssColor('state-success'),
    // A0(38_UI_FIX_BATCH) 로드맵에서 "선택된 학기"에 속한 과목 카드의 배경 틴트.
    // 하단 글로우가 아니라 카드 면 자체가 밝아지는 방식이라 배경색으로 쓴다.
    // 색은 #815FD7 Primary Purple 하나(CI 4.2 "색+불투명도"). 알파 0.16 —
    // depth0(#100D18) 위에서 합성하면 ≈#221A37로, bg.panel(#211A31)과 같은 밝기대다.
    // 즉 "카드가 한 단계 밝아졌다"는 인지는 주되 텍스트 대비를 해치지 않는 상한이다.
    semesterActive: cssVar('state-semester-active'),
  },
};

// G4(37_SHEET_ROADMAP) 밝은 읽기 표면(Reading Surface).
// 사이트 전역은 다크 유지. 긴 글을 읽는 화면(공지·자료실 상세 본문, 접수 시트)에만
// 예외로 적용하는 표면이다. 값은 전부 CI.md HEX —
//   배경군: CI 3.3 "밝은 회색·흰색 배경(#FFFFFF, #F7F5FC, #F2F0F6)"
//   본문·제목: CI 3.2 Dark #211A31 / Deep Dark #100D18
//   강조·링크: CI 4.2 Deep Purple #6844C4 (밝은 배경에서 연보라는 대비 부족이라 금지)
//   헤어라인: #211A31 15% (CI 4.2 "색+불투명도" 방식)
// 대비(검증 완료): text 15.0:1 · meta 6.0:1 · accent 6.0:1 — 전부 4.5:1 이상.
export const reading = {
  bg: cssColor('reading-bg'),                    // 표면 바탕
  surface: cssColor('reading-surface'),          // 표·카드 내부(바탕 위 한 단계)
  subtle: cssColor('reading-subtle'),            // 표 헤더행·구분 영역
  text: cssColor('reading-text'),                // 본문
  textStrong: cssColor('reading-text-strong'),   // 제목
  textMeta: cssColor('reading-text-meta'),       // 메타·캡션
  accent: cssColor('reading-accent'),            // 링크·강조
  accentStrong: cssColor('reading-accent-strong'), // hover·활성
  hairline: cssVar('reading-hairline'),          // 경계선
};

export const typography = {
  family: {
    // F1(16_PHASE4): 폰트 전면 통일 — Pretendard 단일화 (Space Grotesk·IBM Plex Mono·Anton 폐기)
    // display/sans/mono 전부 동일 패밀리. mono 사용처는 웨이트+letter-spacing으로 구분.
    display: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
    sans: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
    mono: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
  },
  // 사이즈 [모바일, 데스크탑] px — F1.3 정보 사이트 기준 전면 하향
  // K2-14 유동 타이포 원리: tailwind.config.js가 각 사이즈의 -d 클래스를
  // clamp(모바일px, calc(모바일px + (데스크탑-모바일) * ((100vw - 390px) / (1440 - 390))), 데스크탑px)
  // 로 재정의한다. 390~1440px 구간에서 뷰포트 선형 보간되어 브레이크포인트 점프가 없고,
  // 아래 배열값 [m, d]가 보간의 양 끝점이 된다. 호출부(-m/-d 클래스)는 변경 불필요.
  size: {
    displayXL: [40, 64],
    displayL: [32, 48],
    h1: [26, 36],
    h2: [20, 28],
    h3: [17, 22],
    bodyL: [16, 17],
    body: [15, 16],
    small: [13, 14],
    caption: [12, 12],
    label: [11, 12],       // eyebrow, 라벨 (letter-spacing 0.06em)
  },
  weight: { black: 900, extrabold: 800, bold: 700, semibold: 600, medium: 500, regular: 400 },
  // F1.3 행간: 헤드라인 1.25, 본문 1.7, 리스트 1.6 (+ 기존 키 호환 유지)
  leading: { heading: 1.25, body: 1.7, list: 1.6, tight: 1.05, snug: 1.25, normal: 1.5, relaxed: 1.7 },
  // F1.3 자간: 헤드라인 -0.02em(display), 본문 0(normal). label F1.2 → 0.06em
  tracking: { display: '-0.02em', normal: '0', label: '0.06em' },
};

export const spacing = {
  // 4pt 배수 (K2-4: 운영위 로고 1.5배 스케일용 144 추가)
  scale: [4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 128, 144, 160],
  // AR(38_UI_FIX_BATCH) 섹션 수직 패딩 소폭 축소: 96→80(-17%) / 160→128(-20%).
  // 실측 근거 — vw1425에서 상하 각 160px이라 섹션 사이 실효 간격이 320px였다.
  // 호출부 37곳이 전부 `py-section-m lg:py-section-d`라 이 한 줄이 곧 전 페이지 적용이고,
  // tailwind fluid()가 clamp(80, 보간, 128)로 재계산해 브레이크포인트 점프도 없다.
  section: { mobile: 80, desktop: 128 },   // 섹션 수직 패딩
  // 페이지 배너 직후 첫 콘텐츠의 시작 여백. 일반 섹션 간격보다 작아야 배너와
  // 첫 콘텐츠가 서로 떨어진 블록처럼 보이지 않는다. 이후 섹션은 section 값을 쓴다.
  pageStart: { mobile: 40, desktop: 56 },
  container: { desktop: 1280, wide: 1440 }, // 콘텐츠 최대폭
  gutter: { mobile: 16, tablet: 24, desktop: 32 },
};

export const layout = {
  // v2(11_DESIGN_V2 7절): 5xl 3840 추가 (4K·32인치 대응)
  breakpoints: { xs: 320, sm: 390, md: 768, lg: 1024, xl: 1280, '2xl': 1440, '3xl': 1920, '4xl': 2560, '5xl': 3840 },
  // G4(18_PHASE6): 라디우스 전면 4px 통일. full은 알약형(언어 토글·GlassDock)만 허용.
  radius: { sm: 4, md: 4, lg: 4, full: 9999 },
  headerHeight: { default: 72, shrunk: 56 },
  // 콘텐츠 폭 규칙: 한 화면 안에서 본문 성격에 따라 이 세 단계만 사용한다.
  // page는 목록·그리드·관리 화면, lead는 넓은 설명, reading은 약관·장문 본문이다.
  contentWidth: { page: 1280, lead: 960, reading: 760, prose: 720 },
};

// v2(11_DESIGN_V2 2절): 유리 패널 표면 언어 (Apple HIG 글래스모피즘)
export const glass = {
  bg: cssVar('glass-bg'),
  bgStrong: cssVar('glass-bg-strong'),
  border: cssVar('glass-border'),
  highlight: cssVar('glass-highlight'),
  blur: cssVar('glass-blur'),        // backdrop-filter: blur(20px) saturate(160%)
  blurMobile: cssVar('glass-blur-mobile'),
  radius: 4,           // G4: 글래스 카드도 4px 통일
};

// v2: 무한한 우주 배경 시스템 (CI 4.1 — 딥 퍼플 블랙 우주, 보라 단일 계열)
export const cosmos = {
  depth0: cssColor('cosmos-depth0'),   // Deep Purple Black — 페이지 최하층(CI 최심층, 그 이하 없음)
  depth1: cssColor('cosmos-depth1'),   // Purple Black 2 — 상단 그라데이션 층
  background: cssVar('cosmos-background'),
  nebula: cssVar('nebula'),
  nebulaViolet: cssVar('nebula-violet'),
  nebulaDeep: cssVar('nebula-deep'),
  nebulaSoft: cssVar('nebula-soft'),
  // 순백 대신 아주 살짝 보라 섞인 오프화이트(Text Primary 계열)
  star: cssVar('cosmos-star'),
  // 히어로 무드 성운 글로우 — 배경 radial glow에만 사용. 보라 단일(청록 폐기).
  // 텍스트·보더·아이콘 사용 금지. 채도는 거의 안 보일 수준(상한 0.05).
  accentViolet: cssVar('cosmos-accent-violet'), // #815FD7 Primary Purple 글로우
  accentDeep: cssVar('cosmos-accent-deep'),     // #6844C4 Deep Purple 글로우(반대편)
};

export const shadow = {
  // 다크 배경에서 그림자 대신 보더+글로우
  cardGlow: cssVar('shadow-card-glow'),
  cardGlowHover: cssVar('shadow-card-glow-hover'),
  // X2(33_PHASE18) 버튼 질감 — 상단 화이트 하이라이트(inset) + 퍼플 글로우.
  // 글로우는 #815FD7 rgb(129,95,215), 딥 그림자는 #100D18 rgb(16,13,24) — CI 색만 사용.
  btnPrimary: cssVar('shadow-btn'),
  btnPrimaryHover: cssVar('shadow-btn-hover'),
  // X3 글래스 위계 — 상단 1px 화이트 하이라이트 + 내부 은은한 깊이
  glassPanel: cssVar('shadow-glass'),
  glassPanelHover: cssVar('shadow-glass-hover'),
  // A4(36_ACCENT_POLISH) 카드 공용 글로우 — 히어로 Primary 버튼(btnPrimary)의 질감
  // (상단 화이트 하이라이트 inset + 퍼플 글로우)을 카드에 확장한 것.
  // 절제 규칙: 기본은 "상시 발광"이 아니라 거의 안 보이는 잔광(0.14), hover에서만 상승(0.40).
  // 버튼(0.35→0.50)보다 한 단계 낮게 잡아 카드가 CTA보다 강해지지 않게 한다.
  // 색은 #815FD7 Primary Purple rgb(129,95,215) 하나만 사용(CI 4.2).
  glowCard: cssVar('shadow-glow-card'),
  glowCardHover: cssVar('shadow-glow-card-hover'),
};

export const motion = {
  duration: { fast: '150ms', base: '250ms', slow: '400ms', reveal: '600ms' },
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  revealDistance: 24, // px, 스크롤 리빌 translateY
  stagger: 80,        // ms, 그리드 아이템 간 지연
};
