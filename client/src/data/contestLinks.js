// contestLinks.js — 학기별 공모전 아카이브 링크
//
// 공모전은 "회차 하나 = 게시글 하나"다. 기존 이관 행의 external_url이 비어 있어도
// 아카이브 페이지로 가는 길이 사라지지 않도록 seed_key를 기준으로 공개 링크를 보완한다.
// 관리자가 CMS에서 외부 URL을 직접 저장하면 그 값이 항상 우선한다.

const CONTEST_LINKS = {
  // 프로젝트 전시회 포스터 공모전 (최신 → 과거)
  'contest-dah-poster-2026-1': 'https://26-1-dah-exhibition-poster-competit.vercel.app/',
  'contest-dah-poster-2025-2': 'https://sites.google.com/glab.hallym.ac.kr/l-huss-x-dah/about',
  'contest-dah-poster-2025-1': 'https://sites.google.com/view/l-hussxdah/home',
  'contest-dah-poster-2024-2': 'https://sites.google.com/glab.hallym.ac.kr/dah2024/home',

  // 도서관 장서표 디자인 공모전 (최신 → 과거)
  'contest-library-bookplate-2026-1': 'https://26-1-dah-exlibris-contest.vercel.app/contest.html',
  'contest-library-bookplate-2025-2': 'https://sites.google.com/view/bookplatecontest/about',
  'contest-library-bookplate-2025-1': 'https://sites.google.com/view/l-huss-x/about?authuser=0',
  'contest-library-bookplate-2024-2': 'https://sites.google.com/view/l-hussx/about',
}

export function contestSiteUrl(item) {
  if (item?.external_url) return item.external_url
  return CONTEST_LINKS[item?.seed_key] || null
}

export function contestSiteLabel(item) {
  const semester = item?.semester_label
  if (!semester) return '공모전 사이트'
  if (item?.seed_key?.startsWith('contest-dah-poster-')) return `${semester} 포스터 공모전`
  if (item?.seed_key?.startsWith('contest-library-bookplate-')) return `${semester} 장서표 공모전`
  return `${semester} 공모전 사이트`
}
