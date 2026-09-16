import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import SectionLabel from '../common/SectionLabel'
import GlassCard from '../common/GlassCard'
import ImageFrame from '../common/ImageFrame'
import Tag from '../common/Tag'
import ArrowLink from '../common/ArrowLink'
import { useApi } from '../../hooks/useApi'
import { professors as fallbackProfessors } from '../../data/professors'
import { curriculum } from '../../data/curriculum'
import { achievements } from '../../data/achievements'
import { careers } from '../../data/careers'
import { councils } from '../../data/council'
import { clubs as fallbackClubs } from '../../data/clubs'

const EXHIBITION_FALLBACKS = [
  { id: '2026-1', title: 'Against Flow', semester_label: '2026-1', poster_url: '/images/exhibitions/2026-1.webp' },
  { id: '2025-2', title: '프로젝트 전시회', semester_label: '2025-2', poster_url: '/images/exhibitions/2025-2.webp' },
  { id: '2025-1', title: '프로젝트 전시회', semester_label: '2025-1', poster_url: '/images/exhibitions/2025-1.webp' },
]

const CONTEST_FALLBACKS = [
  { id: 'poster-2026-1', title: '2026-1 포스터 공모전', poster_url: '/images/contests/poster-contest-2026-1.webp' },
  { id: 'bookplate-2026-1', title: '2026-1 장서표 공모전', poster_url: '/images/contests/bookplate-contest-2026-1.webp' },
]

const AWARD_WORKS = [
  {
    id: 'award-403',
    award: '최우수상',
    title: '403: Bypass',
    author: '에브리타인',
    image: 'https://26-1-dah-exhibition.vercel.app/works/035_intro.webp',
    url: 'https://26-1-dah-exhibition.vercel.app/works/detail/035_intro',
  },
  {
    id: 'award-gangneungpay',
    award: '우수상',
    title: '강릉페이 UX 개선',
    author: '프로젝트 팀',
    image: 'https://26-1-dah-exhibition.vercel.app/works/009_intro.webp',
    url: 'https://26-1-dah-exhibition.vercel.app/works/detail/009_intro',
  },
  {
    id: 'award-library',
    award: '우수상',
    title: '사이의 서가',
    author: '프로젝트 팀',
    image: 'https://26-1-dah-exhibition.vercel.app/works/019_intro.webp',
    url: 'https://26-1-dah-exhibition.vercel.app/works/detail/019_intro',
  },
]

const TRACKS = [
  { id: 'common', title: '공통기초', description: '1학년부터 인문·기술·디자인을 함께 다루는 기초를 만듭니다.' },
  { id: 'track-1', title: '디자인', description: '사용자 경험과 시각 언어를 바탕으로 서비스를 설계합니다.' },
  { id: 'track-2', title: 'AI·데이터', description: '데이터와 AI를 인문적 질문과 연결해 탐구합니다.' },
  { id: 'track-3', title: '엔터컬처', description: '문화와 콘텐츠의 흐름을 읽고 새로운 경험을 기획합니다.' },
]

function professorOf(person) {
  const links = Array.isArray(person.links) ? person.links : []
  return {
    id: person.id,
    name: person.name_ko ?? person.nameKr ?? '',
    nameEn: person.name_en ?? person.nameEn ?? '',
    role: person.title_ko ?? person.role ?? '',
    affiliation: person.affiliation ?? '',
    email: person.email ?? '',
    link: person.link ?? links[0]?.url ?? '',
    photo: person.photo_url ?? '',
    hasBg: Boolean(person.has_bg),
  }
}

function clubOf(club) {
  return {
    id: club.id,
    name: club.title_ko ?? club.title ?? club.name ?? '',
    field: club.tag ?? club.field ?? '',
    intro: club.intro ?? club.body?.intro ?? '',
    image: club.poster_url ?? '',
    hasBg: Boolean(club.has_bg),
  }
}

function PresentationSection({ index, label, title, children }) {
  return (
    <section className="scroll-mt-header py-section-m lg:py-section-d">
      <SectionLabel index={index} text={label} />
      <h2 className="mt-24 text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">{title}</h2>
      <div className="mt-32">{children}</div>
    </section>
  )
}

function MajorCompassPresentation() {
  const presentationRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { data: facultyData } = useApi('/content/professors', { params: { pageSize: 100 } })
  const { data: exhibitionData } = useApi('/content/exhibitions', { params: { pageSize: 100 } })
  const { data: contestData } = useApi('/content/contest', { params: { pageSize: 100 } })
  const { data: councilData } = useApi('/content/council', { params: { pageSize: 100 } })
  const { data: clubData } = useApi('/content/club', { params: { pageSize: 100 } })

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    const onKeyDown = (event) => {
      const target = event.target
      const editing = target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )
      if (editing || event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      } else {
        presentationRef.current?.requestFullscreen().catch(() => {})
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const faculty = useMemo(
    () => (facultyData?.items?.length ? facultyData.items : fallbackProfessors).map(professorOf),
    [facultyData]
  )
  const exhibitions = exhibitionData?.items?.length ? exhibitionData.items.slice(0, 3) : EXHIBITION_FALLBACKS
  const contests = contestData?.items?.length ? contestData.items.slice(0, 2) : CONTEST_FALLBACKS
  const council = councilData?.items?.[0] ?? councils[0]
  const clubs = (clubData?.items?.length ? clubData.items : fallbackClubs).map(clubOf)
  const currentCourses = curriculum.filter((course) => course.year === 1)

  return (
    <div
      ref={presentationRef}
      className={isFullscreen ? 'overflow-y-auto bg-bg-base px-gutter-m md:px-gutter-t lg:px-gutter-d' : ''}
      aria-label="디지털인문예술전공 전공 나침반"
    >
      <PresentationSection index="01" label="DIGITAL ARTS & HUMANITIES" title="사람을 이해하고, 디지털로 미래를 만듭니다.">
        <div className="flex max-w-lead flex-col gap-16">
          <p className="text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">
            디지털인문예술전공은 인문학의 질문, 기술의 가능성, 디자인의 실행력을 함께 다루며 사람과 사회의 변화를 만듭니다.
          </p>
          <div className="flex flex-wrap gap-8">
            {['HUMANITIES', 'TECHNOLOGY', 'DESIGN'].map((word) => <Tag key={word}>{word}</Tag>)}
          </div>
        </div>
      </PresentationSection>

      <PresentationSection index="02" label="CURRICULUM" title="관심에서 시작해, 나만의 방향을 설계합니다.">
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 md:gap-24">
          {TRACKS.map((track) => {
            const courses = track.id === 'common' ? currentCourses : curriculum.filter((course) => course.track === track.id).slice(0, 4)
            return (
              <GlassCard key={track.id} className="flex h-full flex-col gap-16 p-20 md:p-24">
                <div className="flex flex-col gap-8">
                  <h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{track.title}</h3>
                  <p className="text-small-m leading-relaxed text-text-sec md:text-small-d">{track.description}</p>
                </div>
                <ul className="flex flex-col gap-8 border-t border-border-subtle pt-16">
                  {courses.map((course) => <li key={`${course.name}-${course.semester}`} className="text-small-m text-text-pri md:text-small-d">{course.name}</li>)}
                </ul>
              </GlassCard>
            )
          })}
        </div>
        <div className="mt-24"><ArrowLink href="/curriculum">교과과정 전체 보기</ArrowLink></div>
      </PresentationSection>

      <PresentationSection index="03" label="FACULTY" title="서로 다른 전문성을 가진 교수진과 만납니다.">
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3 md:gap-24">
          {faculty.map((person) => (
            <GlassCard key={person.id} className="flex h-full flex-col gap-16 p-16 md:p-20">
              <ImageFrame
                src={person.photo || undefined}
                alt={`${person.name} 교수 사진`}
                ratio="306/427"
                bg={person.hasBg}
                placeholder={person.name}
              />
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-8">
                  <h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{person.name}</h3>
                  {person.link && <a href={person.link} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} 외부 페이지`} className="text-text-sec transition-colors duration-fast ease-out hover:text-text-pri"><ExternalLink size={16} aria-hidden="true" /></a>}
                </div>
                {person.nameEn && <p className="font-mono text-caption-m text-text-meta">{person.nameEn}</p>}
                {person.role && <p className="text-small-m text-text-sec md:text-small-d">{person.role}</p>}
                {person.affiliation && <p className="text-small-m text-text-meta md:text-small-d">{person.affiliation}</p>}
                {person.email && <a className="mt-4 self-start font-mono text-caption-m text-text-sec transition-colors duration-fast ease-out hover:text-text-pri" href={`mailto:${person.email}`}>{person.email}</a>}
              </div>
            </GlassCard>
          ))}
        </div>
        <div className="mt-24"><ArrowLink href="/about/people">교수진·멘토 전체 보기</ArrowLink></div>
      </PresentationSection>

      <PresentationSection index="04" label="PROJECT EXHIBITION" title="수업의 결과는 전시로 이어집니다.">
        <p className="max-w-lead text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">기획과 리서치, 디자인과 구현을 거친 결과물을 매 학기 전시로 공개합니다.</p>
        <div className="mt-32 grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3 md:gap-24">
          {exhibitions.map((item) => (
            <a key={item.id} href={item.site_url || `/programs/exhibitions/${item.id}`} target={item.site_url ? '_blank' : undefined} rel={item.site_url ? 'noopener noreferrer' : undefined} className="group block h-full">
              <GlassCard hover className="flex h-full flex-col gap-12 p-12">
                <ImageFrame src={item.poster_url} alt={`${item.title} 전시 포스터`} ratio="2/3" placeholder={item.title} />
                <div className="flex flex-col gap-4">
                  {item.semester_label && <p className="font-mono text-caption-m text-text-meta">{item.semester_label}</p>}
                  <h3 className="text-body-l-m font-bold leading-snug text-text-pri underline-offset-4 group-hover:underline md:text-body-l-d">{item.title}</h3>
                </div>
              </GlassCard>
            </a>
          ))}
        </div>
        <div className="mt-24"><ArrowLink href="/programs/exhibitions">프로젝트 전시회 전체 보기</ArrowLink></div>
      </PresentationSection>

      <PresentationSection index="05" label="FEATURED WORKS" title="전시 안에서 발견하는 학생들의 작업입니다.">
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3 md:gap-24">
          {AWARD_WORKS.map((work) => (
            <a key={work.id} href={work.url} target="_blank" rel="noopener noreferrer" className="group block h-full">
              <GlassCard hover className="flex h-full flex-col gap-12 p-12">
                <ImageFrame src={work.image} alt={`${work.title} 작품 이미지`} ratio="4/3" placeholder={work.title} />
                <div className="flex flex-col gap-8">
                  <Tag>{work.award}</Tag>
                  <h3 className="text-body-l-m font-bold leading-snug text-text-pri underline-offset-4 group-hover:underline md:text-body-l-d">{work.title}</h3>
                  <p className="text-small-m text-text-sec md:text-small-d">{work.author}</p>
                </div>
              </GlassCard>
            </a>
          ))}
        </div>
      </PresentationSection>

      <PresentationSection index="06" label="CONTESTS & ACHIEVEMENTS" title="교실 밖에서도 결과를 만듭니다.">
        <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-16 md:gap-24">
            {contests.map((item) => (
              <a key={item.id} href={`/programs/contests/${item.id}`} className="group block h-full">
                <GlassCard hover className="flex h-full flex-col gap-12 p-12">
                  <ImageFrame src={item.poster_url} alt={`${item.title} 포스터`} ratio="2/3" placeholder={item.title} />
                  <h3 className="text-small-m font-bold leading-snug text-text-pri underline-offset-4 group-hover:underline md:text-small-d">{item.title}</h3>
                </GlassCard>
              </a>
            ))}
          </div>
          <div className="flex flex-col gap-12 border-t border-border-subtle pt-16 lg:border-l lg:border-t-0 lg:pl-24 lg:pt-0">
            {achievements.slice(0, 4).map((item) => (
              <div key={item.id} className="flex gap-16 border-b border-border-subtle pb-12">
                <span className="shrink-0 font-mono text-caption-m text-text-meta">{item.year}</span>
                <p className="text-small-m leading-relaxed text-text-pri md:text-small-d">{item.title}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-24"><ArrowLink href="/programs/contests">공모전 전체 보기</ArrowLink></div>
      </PresentationSection>

      <PresentationSection index="07" label="CAREERS" title="전공의 경험은 다양한 진로로 이어집니다.">
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3 md:gap-24">
          {careers.slice(0, 6).map((career) => (
            <GlassCard key={career.id} className="flex h-full flex-col gap-8 p-20 md:p-24">
              <h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{career.name}</h3>
              <p className="text-small-m text-text-sec md:text-small-d">{career.company}</p>
              {career.role && <p className="text-small-m leading-relaxed text-text-meta md:text-small-d">{career.role}</p>}
            </GlassCard>
          ))}
        </div>
        <div className="mt-24"><ArrowLink href="/students/careers">졸업생 진로 전체 보기</ArrowLink></div>
      </PresentationSection>

      <PresentationSection index="08" label="STUDENT COUNCIL" title="운영위원회는 학생의 경험을 함께 만듭니다.">
        <GlassCard className="flex flex-col gap-24 p-20 md:p-32">
          <div className="flex flex-col gap-24 md:flex-row md:items-start">
            {council.logo_url && <div className="w-full shrink-0 md:w-160"><ImageFrame src={council.logo_url} alt={`${council.name || council.title} 로고`} ratio="3/2" contain bg={Boolean(council.has_bg)} /></div>}
            <div className="flex flex-col gap-12">
              <p className="font-mono text-caption-m text-text-meta">{council.year_label || council.year}</p>
              <h3 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">{council.name || council.title}</h3>
              {council.intro && <p className="whitespace-pre-line text-body-m leading-relaxed text-text-sec md:text-body-d">{council.intro}</p>}
            </div>
          </div>
          {Array.isArray(council.members) && council.members.length > 0 && (
            <dl className="border-t border-border-subtle">
              {council.members.map((member) => {
                const item = typeof member === 'string' ? { name: member } : member
                return <div key={`${item.role}-${item.name}`} className="flex flex-col gap-4 border-b border-border-subtle py-12 md:flex-row md:gap-24"><dt className="w-128 shrink-0 font-mono text-caption-m text-text-meta">{item.role}</dt><dd className="text-small-m text-text-pri md:text-small-d">{item.name}</dd></div>
              })}
            </dl>
          )}
        </GlassCard>
        <div className="mt-24"><ArrowLink href="/students/council">운영위원회 전체 보기</ArrowLink></div>
      </PresentationSection>

      <PresentationSection index="09" label="CLUBS" title="동아리에서는 관심을 프로젝트로 확장합니다.">
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-4 md:gap-24">
          {clubs.map((club) => (
            <GlassCard key={club.id} className="flex h-full flex-col gap-16 p-16 md:p-20">
              <ImageFrame src={club.image || undefined} alt={`${club.name} 로고`} ratio="4/3" contain bg={club.hasBg} placeholder={club.name} />
              <div className="flex flex-col gap-8">
                <h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{club.name}</h3>
                {club.field && <Tag>{club.field}</Tag>}
                {club.intro && <p className="text-small-m leading-relaxed text-text-sec md:text-small-d">{club.intro}</p>}
              </div>
            </GlassCard>
          ))}
        </div>
        <div className="mt-24"><ArrowLink href="/students/clubs">동아리 전체 보기</ArrowLink></div>
      </PresentationSection>
    </div>
  )
}

export default MajorCompassPresentation
