// 기존 Google Sites의 2026 공지 본문을 현재 posts.notice 레코드에 이관한다.
// 실행: node scripts/import-google-site-notices.mjs --apply
// 기본값은 미리보기이며, 제목은 이미 등록된 공지만 갱신한다. 중복 INSERT는 하지 않는다.

import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), override: true })

const { query } = await import('../src/db.js')

const ORIGIN = 'https://sites.google.com/glab.hallym.ac.kr/dah-hallym'
const FOOTER = 'Since 2017. Digital Arts & Humanities at Hallym University. All Rights Reserved.'

// 현재 DB의 공지 제목과 1:1로 대응한다. 제목이 조금 달라진 원문도 안전하게 같은 레코드에 들어간다.
const SOURCES = [
  ['2026-station-c-아이데이션-캠프-모집-안내', '2026 Station C 아이데이션 캠프 모집 안내'],
  ['2026-디지털인문예술전공-신규-캐릭터-공모전-안내', '2026 디지털인문예술전공 신규 캐릭터 공모전 안내'],
  ['2026-신규-캐릭터-공모전-결과-공지', '2026 디지털인문예술전공 신규 캐릭터 공모전 결과 공지'],
  ['2026-신규-캐릭터-공모전-온라인-투표', '2026 신규 캐릭터 공모전 온라인 투표'],
  ['2026-장서표-디자인-공모전', '2026 강원과 함께 하는 도서관 장서표 디자인 공모전'],
  ['2026-전시회-포스터-공모전', '2026-1학기 디지털인문예술전공 프로젝트 전시회 포스터 공모전'],
  ['2026학년도-1학기-디지털인문예술전공-프로젝트-전시회-참가-신청', '2026학년도 1학기 디지털인문예술전공 프로젝트 전시회 참가 신청'],
  ['26-1-pbl-경진대회', '2026-1학기 지역사회 문제해결 PBL 프레젠테이션 경진대회 개최 안내'],
  ['26-1-개강-총회', '2026-1 디지털인문예술전공 비전 설명회 및 개강 총회 공지'],
  ['26-1-좋은-수업-공모전', '2026-1학기 좋은 수업 Learning Portfolio 공모전'],
  ['26-위원회-신입부원-모집-1', '2026 제1대 디지털인문예술전공 운영위원회 "LUCID" 신입 부원 모집'],
  ['ai-활용-능력-강화-학습지원-프로그램-온라인-특강-안내', 'AI 활용 능력 강화 학습지원 프로그램 온라인 특강 안내'],
  ['huss-삿포로', '2026 L-HUSS in the World 해외 탐방(일본/삿포로) 모집 공고'],
  ['멋쟁이사자처럼', '한림대학교 멋쟁이사자처럼 대학 14기 아기사자 모집'],
  ['스테이션씨서포터즈', '2026 Station C 서포터즈 모집'],
  ['지역정주센터-지서포터즈', '5기 G-Sㅓ포터즈 모집 안내'],
  ['청년서포터즈', '청년 서포터즈 모집'],
  ['커리어-아이디어-공모전', '2026 커리어 아이디어 공모전 개최'],
  ['코이카서포터즈', '2026 그린 ODA 서포터즈 추가 모집 안내 (~3.20)'],
]

function decodeEntities(input = '') {
  return input
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, value) =>
      String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : parseInt(value, 10))
    )
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

function extractLines(html) {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*/g, '\n')
  )
  return text.split('\n').map((line) => line.trim()).filter(Boolean)
}

function dateFrom(lines) {
  const registration = lines.find((line) => line.includes('등록일:')) || ''
  const digits = registration.replace(/\D/g, '')
  if (digits.length < 8) return null
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00+09:00`
}

function tiptap(lines) {
  return {
    type: 'doc',
    content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  }
}

async function sourceContent(slug) {
  const url = `${ORIGIN}/공지사항/${slug}`
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (DAH notice migration)' } })
  if (!response.ok) throw new Error(`${slug}: ${response.status}`)
  const lines = extractLines(await response.text())
  const start = lines.findIndex((line) => line.includes('등록일:'))
  if (start < 0) throw new Error(`${slug}: 공지 등록일을 찾지 못했습니다`)
  const finish = lines.findIndex((line, index) => index > start && line === FOOTER)
  const body = lines.slice(start + 1, finish > start ? finish : undefined)
  if (!body.length) throw new Error(`${slug}: 공지 본문을 찾지 못했습니다`)
  return { url, body, eventStart: dateFrom(lines) }
}

const apply = process.argv.includes('--apply')
let filled = 0
let kept = 0

for (const [slug, title] of SOURCES) {
  const { rows } = await query(
    `SELECT id, body FROM posts WHERE type = 'notice' AND title_ko = $1 LIMIT 1`,
    [title]
  )
  const row = rows[0]
  if (!row) throw new Error(`대상 공지를 찾지 못했습니다: ${title}`)
  if (row.body) {
    kept += 1
    console.log(`유지  #${row.id} ${title}`)
    continue
  }
  const source = await sourceContent(slug)
  console.log(`${apply ? '채움' : '미리보기'} #${row.id} ${title} (${source.body.length}문단)`)
  if (apply) {
    await query(
      `UPDATE posts
       SET body = $1::jsonb,
           event_start = COALESCE(event_start, $2::timestamptz),
           updated_at = now()
       WHERE id = $3`,
      [JSON.stringify(tiptap(source.body)), source.eventStart, row.id]
    )
    filled += 1
  }
}

console.log(apply ? `완료: 본문 ${filled}건 채움, 기존 본문 ${kept}건 유지` : '미리보기 완료: 실제 반영은 --apply')
