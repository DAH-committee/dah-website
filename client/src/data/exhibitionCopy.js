// exhibitionCopy.js — 전시회 접수 온보딩·폼의 편집 가능한 문구 (53_EXHIBITION_COPY)
//
// 문구를 코드에서 DB로 옮긴 이유: 내년에 담당자가 바뀌어도 어드민에서 안내문을 고칠 수 있어야 한다.
// 과목 선택·회차 지정·기간 검증 같은 특수 기능은 전용 구조 그대로 두고, 텍스트만 분리했다.
//
// 저장 위치는 site_settings의 exhibitionCopy 키(단일 jsonb 문서)다.
// 아래 값은 분리 이전에 코드에 있던 원문 그대로이며 DB 값이 비었을 때의 폴백이다.
// 구글 클래스룸 업로드를 더는 쓰지 않아 관련 안내(작품명의 '-' 처리)는 삭제했다.

export const EXHIBITION_COPY_DEFAULT = {
  ko: {
    onboardingEyebrow: '접수 안내',
    onboardingLead: '접수 대상 디지털인문예술전공 수강생, 개인 또는 팀 단위로 출품합니다.',
    stepsTitle: '접수 절차',
    steps: [
      { title: '로그인', desc: '구글 계정으로 로그인해 접수자 신원을 확인합니다.' },
      { title: '작성', desc: '참가 유형·인적사항·과목·작품 정보를 입력합니다.' },
      {
        title: '수정',
        desc: '수정 마감 전까지 같은 구글 계정으로 로그인해 접수 내용을 수정합니다.',
      },
    ],
    notesTitle: '유의사항',
    notes: [
      '접수 이메일은 로그인한 구글 계정 주소로 자동 입력됩니다.',
      '참가 유형·과목·이메일은 접수 후 수정할 수 없습니다. 제출 전에 확인해 주세요.',
      '연락처는 010-0000-0000 형식으로만 입력됩니다.',
      '작품 설명은 최대 100자입니다.',
    ],
    startLabel: '접수 시작하기',
    formLead: '',
    workTitleHint: '',
    workDescPlaceholder: '작품 설명은 전시회 사이트에 사용됩니다.',
  },
  en: {
    onboardingEyebrow: 'Submission guide',
    onboardingLead: '',
    stepsTitle: 'Steps',
    steps: [],
    notesTitle: 'Notes',
    notes: [],
    startLabel: 'Start submission',
    formLead: '',
    workTitleHint: '',
    workDescPlaceholder: '',
  },
}

/**
 * DB 값 + 기본값 병합. 빈 문자열·빈 배열은 값이 없는 것으로 보고 기본값으로 떨어진다.
 * 영문은 값이 없으면 국문으로 폴백한다(사이트 전역 i18n 규칙과 동일).
 * @param {object|null} saved  site_settings.exhibitionCopy
 * @param {'ko'|'en'} lang
 */
export function exhibitionCopy(saved, lang = 'ko') {
  const base = EXHIBITION_COPY_DEFAULT.ko
  const baseLang = EXHIBITION_COPY_DEFAULT[lang] || base
  const savedLang = saved?.[lang] ?? {}
  const savedKo = saved?.ko ?? {}

  const pick = (key) => {
    const candidates = lang === 'en' ? [savedLang[key], baseLang[key], savedKo[key], base[key]] : [savedLang[key], base[key]]
    for (const v of candidates) {
      if (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v != null) {
        return v
      }
    }
    return Array.isArray(base[key]) ? [] : ''
  }

  return {
    onboardingEyebrow: pick('onboardingEyebrow'),
    onboardingLead: pick('onboardingLead'),
    stepsTitle: pick('stepsTitle'),
    steps: pick('steps'),
    notesTitle: pick('notesTitle'),
    notes: pick('notes'),
    startLabel: pick('startLabel'),
    formLead: pick('formLead'),
    workTitleHint: pick('workTitleHint'),
    workDescPlaceholder: pick('workDescPlaceholder'),
  }
}
