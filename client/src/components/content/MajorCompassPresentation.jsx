import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import GlassCard from '../common/GlassCard'
import ImageFrame from '../common/ImageFrame'
import Tag from '../common/Tag'
import Button from '../common/Button'
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
  { id: '403', award: '최우수상', title: '403: Bypass', author: '에브리타인', image: 'https://26-1-dah-exhibition.vercel.app/works/035_intro.webp', url: 'https://26-1-dah-exhibition.vercel.app/works/detail/035_intro' },
  { id: 'gangneungpay', award: '우수상', title: '강릉페이 UX 개선', author: '프로젝트 팀', image: 'https://26-1-dah-exhibition.vercel.app/works/009_intro.webp', url: 'https://26-1-dah-exhibition.vercel.app/works/detail/009_intro' },
  { id: 'library', award: '우수상', title: '사이의 서가', author: '프로젝트 팀', image: 'https://26-1-dah-exhibition.vercel.app/works/019_intro.webp', url: 'https://26-1-dah-exhibition.vercel.app/works/detail/019_intro' },
]

const TRACKS = [
  { id: 'common', title: '공통기초', description: '1학년부터 인문·기술·디자인을 함께 다루는 기초를 만듭니다.' },
  { id: 'track-1', title: '디자인', description: '사용자 경험과 시각 언어를 바탕으로 서비스를 설계합니다.' },
  { id: 'track-2', title: 'AI·데이터', description: '데이터와 AI를 인문적 질문과 연결해 탐구합니다.' },
  { id: 'track-3', title: '엔터컬처', description: '문화와 콘텐츠의 흐름을 읽고 새로운 경험을 기획합니다.' },
]

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))

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

function Slide({ number, label, children }) {
  return (
    <GlassCard className="aspect-auto min-h-480 p-20 sm:p-24 lg:aspect-video lg:min-h-0 lg:p-40">
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex items-center justify-between gap-16 border-b border-border-subtle pb-16">
          <p className="font-mono text-caption-m text-text-meta">{String(number).padStart(2, '0')}</p>
          <p className="font-mono text-caption-m text-text-meta">{label}</p>
        </header>
        <div className="flex min-h-0 flex-1 items-center py-24 lg:py-32">{children}</div>
      </div>
    </GlassCard>
  )
}

function FacultyCard({ person }) {
  return (
    <GlassCard className="grid h-full min-w-0 grid-cols-2 gap-16 p-16 md:p-20">
      <ImageFrame src={person.photo || undefined} alt={`${person.name} 교수 사진`} ratio="4/3" bg={person.hasBg} placeholder={person.name} />
      <div className="flex min-w-0 flex-col justify-center gap-4">
        <div className="flex flex-wrap items-center gap-8">
          <h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{person.name}</h3>
          {person.link && <a href={person.link} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} 외부 페이지`} className="text-text-sec transition-colors duration-fast ease-out hover:text-text-pri"><ExternalLink size={16} aria-hidden="true" /></a>}
        </div>
        {person.nameEn && <p className="font-mono text-caption-m text-text-meta">{person.nameEn}</p>}
        {person.role && <p className="text-small-m text-text-sec md:text-small-d">{person.role}</p>}
        {person.affiliation && <p className="text-small-m text-text-meta md:text-small-d">{person.affiliation}</p>}
        {person.email && <a href={`mailto:${person.email}`} className="font-mono text-caption-m text-text-sec transition-colors duration-fast ease-out hover:text-text-pri">{person.email}</a>}
      </div>
    </GlassCard>
  )
}

function MajorCompassPresentation() {
  const presentationRef = useRef(null)
  const [index, setIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { data: facultyData } = useApi('/content/professors', { params: { pageSize: 100 } })
  const { data: exhibitionData } = useApi('/content/exhibitions', { params: { pageSize: 100 } })
  const { data: contestData } = useApi('/content/contest', { params: { pageSize: 100 } })
  const { data: councilData } = useApi('/content/council', { params: { pageSize: 100 } })
  const { data: clubData } = useApi('/content/club', { params: { pageSize: 100 } })

  const faculty = useMemo(() => (facultyData?.items?.length ? facultyData.items : fallbackProfessors).map(professorOf), [facultyData])
  const exhibitions = exhibitionData?.items?.length ? exhibitionData.items.slice(0, 3) : EXHIBITION_FALLBACKS
  const contests = contestData?.items?.length ? contestData.items.slice(0, 2) : CONTEST_FALLBACKS
  const council = councilData?.items?.[0] ?? councils[0]
  const clubs = (clubData?.items?.length ? clubData.items : fallbackClubs).map(clubOf)
  const facultyGroups = chunk(faculty, 2)

  const slides = [
    {
      label: 'DIGITAL ARTS & HUMANITIES',
      content: <div className="flex max-w-lead flex-col gap-24"><p className="font-mono text-caption-m text-text-meta">2026 자유전공학부 전공 나침반</p><h2 className="text-displayL-m font-bold leading-snug tracking-display text-text-pri md:text-displayL-d">사람을 이해하고, 디지털로 미래를 만듭니다.</h2><p className="text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">인문학의 질문, 기술의 가능성, 디자인의 실행력을 함께 다루는 디지털인문예술전공을 소개합니다.</p><div className="flex flex-wrap gap-8">{['HUMANITIES', 'TECHNOLOGY', 'DESIGN'].map((word) => <Tag key={word}>{word}</Tag>)}</div></div>,
    },
    {
      label: 'CURRICULUM',
      content: <div className="w-full"><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">관심에서 시작해, 나만의 방향을 설계합니다.</h2><div className="mt-24 grid grid-cols-1 gap-16 sm:grid-cols-2 md:gap-24">{TRACKS.map((track) => <GlassCard key={track.id} className="flex min-w-0 flex-col gap-12 p-16 md:p-20"><h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{track.title}</h3><p className="text-small-m leading-relaxed text-text-sec md:text-small-d">{track.description}</p><ul className="flex flex-col gap-4 border-t border-border-subtle pt-12">{curriculum.filter((course) => track.id === 'common' ? course.year === 1 : course.track === track.id).slice(0, 3).map((course) => <li key={`${course.name}-${course.semester}`} className="text-caption-m text-text-pri">{course.name}</li>)}</ul></GlassCard>)}</div></div>,
    },
    ...facultyGroups.map((group, groupIndex) => ({
      label: 'FACULTY',
      content: <div className="w-full"><div className="flex flex-wrap items-end justify-between gap-12"><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">서로 다른 전문성을 가진 교수진과 만납니다.</h2><p className="font-mono text-caption-m text-text-meta">{groupIndex + 1} / {facultyGroups.length}</p></div><div className="mt-24 grid grid-cols-1 gap-16 md:grid-cols-2 md:gap-24">{group.map((person) => <FacultyCard key={person.id} person={person} />)}</div></div>,
    })),
    {
      label: 'PROJECT EXHIBITION',
      content: <div className="w-full"><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">수업의 결과는 전시로 이어집니다.</h2><p className="mt-12 max-w-lead text-body-m leading-relaxed text-text-sec md:text-body-d">기획과 리서치, 디자인과 구현을 거친 결과물을 매 학기 전시로 공개합니다.</p><div className="mt-24 grid grid-cols-3 gap-12 md:gap-16">{exhibitions.map((item) => <a key={item.id} href={item.site_url || `/programs/exhibitions/${item.id}`} target={item.site_url ? '_blank' : undefined} rel={item.site_url ? 'noopener noreferrer' : undefined} className="group min-w-0"><ImageFrame src={item.poster_url} alt={`${item.title} 전시 포스터`} ratio="2/3" placeholder={item.title} /><p className="mt-8 text-small-m font-bold leading-snug text-text-pri underline-offset-4 group-hover:underline md:text-small-d">{item.title}</p></a>)}</div></div>,
    },
    {
      label: 'FEATURED WORKS',
      content: <div className="w-full"><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">전시 안에서 발견하는 학생들의 작업입니다.</h2><div className="mt-24 grid grid-cols-3 gap-12 md:gap-16">{AWARD_WORKS.map((work) => <a key={work.id} href={work.url} target="_blank" rel="noopener noreferrer" className="group min-w-0"><ImageFrame src={work.image} alt={`${work.title} 작품 이미지`} ratio="4/3" placeholder={work.title} /><div className="mt-8 flex flex-col gap-4"><Tag>{work.award}</Tag><h3 className="text-small-m font-bold leading-snug text-text-pri underline-offset-4 group-hover:underline md:text-small-d">{work.title}</h3><p className="text-caption-m text-text-sec">{work.author}</p></div></a>)}</div></div>,
    },
    {
      label: 'CONTESTS & ACHIEVEMENTS',
      content: <div className="grid w-full grid-cols-1 gap-24 lg:grid-cols-2"><div className="grid grid-cols-2 gap-16">{contests.map((item) => <a key={item.id} href={`/programs/contests/${item.id}`} className="group min-w-0"><ImageFrame src={item.poster_url} alt={`${item.title} 포스터`} ratio="2/3" placeholder={item.title} /><p className="mt-8 text-small-m font-bold leading-snug text-text-pri underline-offset-4 group-hover:underline md:text-small-d">{item.title}</p></a>)}</div><div className="flex flex-col justify-center gap-12"><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">교실 밖에서도 결과를 만듭니다.</h2>{achievements.slice(0, 4).map((item) => <div key={item.id} className="flex gap-12 border-b border-border-subtle pb-8"><span className="font-mono text-caption-m text-text-meta">{item.year}</span><p className="text-small-m leading-relaxed text-text-pri md:text-small-d">{item.title}</p></div>)}</div></div>,
    },
    {
      label: 'CAREERS',
      content: <div className="w-full"><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">전공의 경험은 다양한 진로로 이어집니다.</h2><div className="mt-24 grid grid-cols-2 gap-16 md:grid-cols-3 md:gap-24">{careers.slice(0, 6).map((career) => <GlassCard key={career.id} className="flex min-w-0 flex-col gap-4 p-16 md:p-20"><h3 className="text-h3-m font-bold leading-snug text-text-pri md:text-h3-d">{career.name}</h3><p className="text-small-m text-text-sec md:text-small-d">{career.company}</p>{career.role && <p className="text-caption-m leading-relaxed text-text-meta">{career.role}</p>}</GlassCard>)}</div></div>,
    },
    {
      label: 'STUDENT COUNCIL',
      content: <div className="grid w-full grid-cols-1 gap-24 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="flex flex-col justify-center gap-12">{council.logo_url && <ImageFrame src={council.logo_url} alt={`${council.name || council.title} 로고`} ratio="3/2" contain bg={Boolean(council.has_bg)} />}<p className="font-mono text-caption-m text-text-meta">{council.year_label || council.year}</p><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">{council.name || council.title}</h2>{council.intro && <p className="text-small-m leading-relaxed text-text-sec md:text-small-d">{council.intro}</p>}</div><dl className="border-t border-border-subtle">{(council.members ?? []).slice(0, 6).map((member) => { const item = typeof member === 'string' ? { name: member } : member; return <div key={`${item.role}-${item.name}`} className="flex gap-16 border-b border-border-subtle py-12"><dt className="w-80 shrink-0 font-mono text-caption-m text-text-meta">{item.role}</dt><dd className="text-small-m text-text-pri md:text-small-d">{item.name}</dd></div> })}</dl></div>,
    },
    {
      label: 'CLUBS',
      content: <div className="w-full"><h2 className="text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">동아리에서는 관심을 프로젝트로 확장합니다.</h2><div className="mt-24 grid grid-cols-2 gap-16 lg:grid-cols-4 md:gap-24">{clubs.map((club) => <GlassCard key={club.id} className="flex min-w-0 flex-col gap-12 p-12 md:p-16"><ImageFrame src={club.image || undefined} alt={`${club.name} 로고`} ratio="4/3" contain bg={club.hasBg} placeholder={club.name} /><h3 className="text-small-m font-bold leading-snug text-text-pri md:text-small-d">{club.name}</h3>{club.field && <Tag>{club.field}</Tag>}</GlassCard>)}</div></div>,
    },
  ]

  useEffect(() => setIndex((current) => Math.min(current, slides.length - 1)), [slides.length])

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    const onKeyDown = (event) => {
      const target = event.target
      const editing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        else presentationRef.current?.requestFullscreen().catch(() => {})
      }
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        setIndex((current) => Math.min(current + 1, slides.length - 1))
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIndex((current) => Math.max(current - 1, 0))
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('fullscreenchange', onFullscreenChange); window.removeEventListener('keydown', onKeyDown) }
  }, [slides.length])

  const activeSlide = slides[index]
  return (
    <section ref={presentationRef} className={isFullscreen ? 'flex min-h-screen items-center bg-bg-base px-gutter-m py-24 md:px-gutter-t lg:px-gutter-d' : ''} aria-label="디지털인문예술전공 전공 나침반">
      <div className="mx-auto flex w-full min-w-0 max-w-container flex-col gap-16">
        <Slide number={index + 1} label={activeSlide.label}>{activeSlide.content}</Slide>
        <div className="flex flex-wrap items-center justify-between gap-12" aria-live="polite">
          <p className="font-mono text-caption-m text-text-meta">{index + 1} / {slides.length}</p>
          <div className="flex items-center gap-8">
            <Button variant="secondary" onClick={() => setIndex((current) => Math.max(current - 1, 0))} disabled={index === 0}><ChevronLeft size={16} aria-hidden="true" />이전</Button>
            <Button variant="secondary" onClick={() => setIndex((current) => Math.min(current + 1, slides.length - 1))} disabled={index === slides.length - 1}>다음<ChevronRight size={16} aria-hidden="true" /></Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default MajorCompassPresentation
