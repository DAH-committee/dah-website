// scripts/contest-data.mjs — 공모전 원문 (51_CONTEST_SPLIT)
//
// 회차 하나 = post 하나. seed-contests.mjs(신규 DB 시드)와
// split-contest-editions.mjs(기존 묶음 post 분리)가 같은 정의를 공유해
// 두 경로의 결과가 어긋나지 않게 한다.
//
// 제목은 사용자 원문 그대로다. 학기마다 주관 도서관이 바뀌므로 기계 파생이 불가능해 나열한다.

const poster = (semester) => `/images/contests/poster-contest-${semester}.webp`
const bookplate = (semester) => `/images/contests/bookplate-contest-${semester}.webp`

const DAH_HOST = '디지털인문예술전공 운영위원회'
const LIBRARY_HOST = '한림대학교 도서관'

// 회차별 실제 아카이브/공모전 사이트. DB 신규 시드와 이관 재실행 시에도 그대로 보존한다.
// 배열 표시는 최신 → 과거지만, 키로 연결해 학기 순서가 바뀌어도 오배치되지 않게 한다.
const SITE_URL = {
  'contest-dah-poster-2026-1': 'https://26-1-dah-exhibition-poster-competit.vercel.app/',
  'contest-dah-poster-2025-2': 'https://sites.google.com/glab.hallym.ac.kr/l-huss-x-dah/about',
  'contest-dah-poster-2025-1': 'https://sites.google.com/view/l-hussxdah/home',
  'contest-dah-poster-2024-2': 'https://sites.google.com/glab.hallym.ac.kr/dah2024/home',
  'contest-library-bookplate-2026-1': 'https://26-1-dah-exlibris-contest.vercel.app/contest.html',
  'contest-library-bookplate-2025-2': 'https://sites.google.com/view/bookplatecontest/about',
  'contest-library-bookplate-2025-1': 'https://sites.google.com/view/l-huss-x/about?authuser=0',
  'contest-library-bookplate-2024-2': 'https://sites.google.com/view/l-hussx/about',
}

// 52_CONTEST_CATEGORY: 공모전 종류. 공개 목록의 섹션 묶음 기준이자 어드민 드롭다운 값이다.
// 클라이언트(client/src/data/contestCategory.js)와 같은 문자열을 쓴다 — 값이 어긋나면 섹션이 갈라진다.
export const CONTEST_CATEGORY = {
  POSTER: '디지털인문예술 프로젝트 전시회 포스터 공모전',
  BOOKPLATE: '도서관 장서표 디자인 공모전',
  ETC: '기타',
}

export const CONTEST_POSTS = [
  // 디지털인문예술 프로젝트 전시회 포스터 공모전
  {
    seed_key: 'contest-dah-poster-2024-2',
    semester_label: '2024-2',
    title_ko: '2024-2 디지털인문예술 프로젝트 전시회 포스터 공모전',
    title_en: 'DAH Project Exhibition Poster Contest',
    category: CONTEST_CATEGORY.POSTER,
    poster_url: poster('2024-2'),
    host: DAH_HOST,
    external_url: SITE_URL['contest-dah-poster-2024-2'],
  },
  {
    seed_key: 'contest-dah-poster-2025-1',
    semester_label: '2025-1',
    title_ko: '2025-1 디지털인문예술 프로젝트 전시회 포스터 공모전',
    title_en: 'DAH Project Exhibition Poster Contest',
    category: CONTEST_CATEGORY.POSTER,
    poster_url: poster('2025-1'),
    host: DAH_HOST,
    external_url: SITE_URL['contest-dah-poster-2025-1'],
  },
  {
    seed_key: 'contest-dah-poster-2025-2',
    semester_label: '2025-2',
    title_ko: '2025-2 디지털인문예술 프로젝트 전시회 포스터 공모전',
    title_en: 'DAH Project Exhibition Poster Contest',
    category: CONTEST_CATEGORY.POSTER,
    poster_url: poster('2025-2'),
    host: DAH_HOST,
    external_url: SITE_URL['contest-dah-poster-2025-2'],
  },
  {
    seed_key: 'contest-dah-poster-2026-1',
    semester_label: '2026-1',
    title_ko: '2026-1 디지털인문예술 프로젝트 전시회 포스터 공모전',
    title_en: 'DAH Project Exhibition Poster Contest',
    category: CONTEST_CATEGORY.POSTER,
    poster_url: poster('2026-1'),
    host: DAH_HOST,
    external_url: SITE_URL['contest-dah-poster-2026-1'],
  },

  // 도서관 장서표 디자인 공모전 — 학기마다 주관 도서관이 다르다
  {
    seed_key: 'contest-library-bookplate-2024-2',
    semester_label: '2024-2',
    title_ko: '일송기념도서관 장서표 디자인 공모전',
    title_en: 'Library Bookplate Design Contest',
    category: CONTEST_CATEGORY.BOOKPLATE,
    poster_url: bookplate('2024-2'),
    host: LIBRARY_HOST,
    external_url: SITE_URL['contest-library-bookplate-2024-2'],
  },
  {
    seed_key: 'contest-library-bookplate-2025-1',
    semester_label: '2025-1',
    title_ko: '일송기념도서관 장서표 디자인 공모전',
    title_en: 'Library Bookplate Design Contest',
    category: CONTEST_CATEGORY.BOOKPLATE,
    poster_url: bookplate('2025-1'),
    host: LIBRARY_HOST,
    external_url: SITE_URL['contest-library-bookplate-2025-1'],
  },
  {
    seed_key: 'contest-library-bookplate-2025-2',
    semester_label: '2025-2',
    title_ko: '정선군립도서관 장서표 디자인 공모전',
    title_en: 'Library Bookplate Design Contest',
    category: CONTEST_CATEGORY.BOOKPLATE,
    poster_url: bookplate('2025-2'),
    host: LIBRARY_HOST,
    external_url: SITE_URL['contest-library-bookplate-2025-2'],
  },
  {
    seed_key: 'contest-library-bookplate-2026-1',
    semester_label: '2026-1',
    title_ko: '인제 기적의 도서관 장서표 디자인 공모전',
    title_en: 'Library Bookplate Design Contest',
    category: CONTEST_CATEGORY.BOOKPLATE,
    poster_url: bookplate('2026-1'),
    host: LIBRARY_HOST,
    external_url: SITE_URL['contest-library-bookplate-2026-1'],
  },
]

/** 분리 대상 묶음 post의 seed_key → 회차 seed_key 접두사 */
export const LEGACY_BUNDLES = {
  'contest-dah-poster': 'contest-dah-poster',
  'contest-library-bookplate': 'contest-library-bookplate',
}
