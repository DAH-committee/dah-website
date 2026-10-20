// AI 사용 설명서: 편집기마다 "이 프로그램은 이렇게 동작한다"를 모델에게 알려 주는 짧은 글(.md).
// 각 편집기의 시스템 프롬프트가 getKnowledge('docs'|'sheets'|'forms'|'slides'|'board'|'hwp') 로 불러다 붙인다.
// 글은 모델 토큰을 쓰므로 편집기당 2500 토큰(약 6000자) 안쪽으로 유지한다.
const RAW = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true })

export function getKnowledge(app) {
  const key = Object.keys(RAW).find((p) => p.endsWith(`/${app}.md`))
  return key ? String(RAW[key]).trim() : ''
}

export const KNOWLEDGE_APPS = ['docs', 'sheets', 'forms', 'slides', 'board', 'hwp']
