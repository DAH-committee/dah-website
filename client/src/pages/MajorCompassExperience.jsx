import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import Link from '../components/common/LangLink'
import ImageFrame from '../components/common/ImageFrame'
import { useApi } from '../hooks/useApi'
import { ABOUT_COPY } from './About'
import { tracks, codeSharing } from '../data/tracks'
import { nanodegree } from '../data/nanodegree'
import { professors as fallbackProfessors } from '../data/professors'
import { achievements } from '../data/achievements'
import { careers } from '../data/careers'
import { councils } from '../data/council'
import { clubs as fallbackClubs } from '../data/clubs'

const EXHIBITION_FALLBACKS = [
  ['2026-1', 'Against Flow'],
  ['2025-2', '프로젝트 전시회'],
  ['2025-1', '프로젝트 전시회'],
  ['2024-2', '프로젝트 전시회'],
  ['2024-1', '프로젝트 전시회'],
  ['2023-2', '프로젝트 전시회'],
].map(([semester, title]) => ({
  id: semester,
  title,
  semester_label: semester,
  poster_url: `/images/exhibitions/${semester}.webp`,
}))

const CONTEST_FALLBACKS = [
  ['poster-2026-1', '2026-1 포스터 공모전'],
  ['bookplate-2026-1', '2026-1 장서표 공모전'],
  ['poster-2025-2', '2025-2 포스터 공모전'],
  ['bookplate-2025-2', '2025-2 장서표 공모전'],
].map(([id, title]) => ({
  id,
  title,
  poster_url: `/images/contests/${id.replace(/-(\d{4}-\d)$/, '-contest-$1')}.webp`,
}))

// 발표 흐름의 단일 원천. steps는 같은 화면 안에서 설명을 한 단계 더 깊게 보여줄 때만 쓴다.
const SLIDES = [
  { id: 'cover', label: 'DIGITAL ARTS & HUMANITIES', steps: 1 },
  { id: 'map', label: 'PRESENTATION MAP', steps: 1 },
  { id: 'about', label: 'ABOUT', steps: 3 },
  { id: 'curriculum', label: 'CURRICULUM', steps: 4 },
  { id: 'codesharing', label: 'CODE SHARING', steps: 2 },
  { id: 'nanodegree', label: 'NANODEGREE', steps: 5 },
  { id: 'faculty', label: 'FACULTY', steps: 2 },
  { id: 'exhibitions', label: 'EXHIBITIONS', steps: 2 },
  { id: 'contests', label: 'CONTESTS', steps: 2 },
  { id: 'achievements', label: 'STUDENT ACHIEVEMENTS', steps: 6 },
  { id: 'careers', label: 'CAREERS', steps: 6 },
  { id: 'council', label: 'STUDENT COUNCIL', steps: 2 },
  { id: 'clubs', label: 'CLUBS', steps: 2 },
  { id: 'closing', label: 'DIGITAL ARTS & HUMANITIES', steps: 1 },
]

const MAP_ITEMS = [
  ['01', '전공 소개', '디지털인문예술전공이 다루는 질문'],
  ['02', '배움의 구조', '교육과정 · Code Sharing · 나노디그리'],
  ['03', '사람과 결과', '교수진 · 전시 · 공모전 · 학생 성과'],
  ['04', '함께하는 활동', '진로 · 운영위원회 · 동아리'],
]

const slideMotion = {
  enter: (direction) => ({ opacity: 0, x: direction > 0 ? 36 : -36 }),
  center: { opacity: 1, x: 0 },
  exit: (direction) => ({ opacity: 0, x: direction > 0 ? -24 : 24 }),
}

function readLocation() {
  if (typeof window === 'undefined') return { slide: 0, step: 0 }
  const [id, rawStep] = window.location.hash.replace(/^#/, '').split(':')
  const slide = Math.max(0, SLIDES.findIndex((item) => item.id === id))
  const step = Math.min(Math.max(Number(rawStep || 1) - 1, 0), SLIDES[slide].steps - 1)
  return { slide, step }
}

function normalizeProfessor(person) {
  return {
    id: person.id,
    name: person.name_ko ?? person.nameKr ?? '',
    nameEn: person.name_en ?? person.nameEn ?? '',
    role: person.title_ko ?? person.role ?? '',
    affiliation: person.affiliation ?? '',
    photo: person.photo_url ?? '',
    hasBg: Boolean(person.has_bg),
  }
}

function initialsOf(person) {
  if (person.nameEn) return person.nameEn.split(/\s+/).map((word) => word[0]).join('').slice(0, 2)
  return person.name?.slice(0, 1) || ''
}

function SlideTitle({ index, label, title, description }) {
  return (
    <header className="max-w-7xl">
      <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">
        {String(index + 1).padStart(2, '0')} / {label}
      </p>
      <h1 className="mt-20 text-deck-title-m font-bold leading-[1.22] tracking-normal text-text-pri md:mt-24 md:text-deck-title-d">
        {title}
      </h1>
      {description && (
        <p className="mt-20 max-w-4xl text-deck-body-m leading-[1.7] text-text-sec md:mt-24 md:text-deck-body-d">
          {description}
        </p>
      )}
    </header>
  )
}

function EntryList({ items, renderItem, className = '' }) {
  return (
    <ol className={`divide-y divide-border-subtle border-y border-border-subtle ${className}`.trim()}>
      {items.map((item, index) => (
        <li key={item.id ?? item.name ?? item.title ?? index} className="py-16 first:pt-16 last:pb-16 md:py-20">
          {renderItem(item, index)}
        </li>
      ))}
    </ol>
  )
}

function PosterStrip({ items }) {
  return (
    <div className="grid grid-cols-2 gap-20 md:grid-cols-3 md:gap-28">
      {items.map((item, index) => (
        <motion.figure
          key={item.id}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.05, ease: 'easeOut' }}
          className="min-w-0"
        >
          <ImageFrame
            src={item.poster_url}
            alt={`${item.title_ko || item.title} 포스터`}
            ratio="2/3"
            placeholder={item.title_ko || item.title}
          />
          <figcaption className="mt-12 font-mono text-deck-meta-m leading-relaxed text-text-meta md:text-deck-meta-d">
            {item.semester_label || item.title_ko || item.title}
          </figcaption>
        </motion.figure>
      ))}
    </div>
  )
}

function MajorCompassExperience() {
  const rootRef = useRef(null)
  const lastInputAt = useRef(0)
  const touchStartY = useRef(null)
  const initialLocation = useRef(readLocation())
  const reducedMotion = useReducedMotion()
  const [slideIndex, setSlideIndex] = useState(initialLocation.current.slide)
  const [stepIndex, setStepIndex] = useState(initialLocation.current.step)
  const [direction, setDirection] = useState(1)
  const [pointer, setPointer] = useState({ x: 50, y: 50 })

  const { data: facultyData } = useApi('/content/professors', { params: { pageSize: 100 } })
  const { data: exhibitionData } = useApi('/content/exhibitions', { params: { pageSize: 100 } })
  const { data: contestData } = useApi('/content/contest', { params: { pageSize: 100 } })
  const { data: councilData } = useApi('/content/council', { params: { pageSize: 100 } })
  const { data: clubData } = useApi('/content/club', { params: { pageSize: 100 } })

  const faculty = useMemo(
    () => (facultyData?.items?.length ? facultyData.items : fallbackProfessors).map(normalizeProfessor),
    [facultyData],
  )
  const exhibitions = exhibitionData?.items?.length ? exhibitionData.items.slice(0, 6) : EXHIBITION_FALLBACKS
  const contests = contestData?.items?.length ? contestData.items.slice(0, 4) : CONTEST_FALLBACKS
  const council = councilData?.items?.[0] ?? councils[0]
  const clubs = clubData?.items?.length ? clubData.items : fallbackClubs
  const slide = SLIDES[slideIndex]
  const atStart = slideIndex === 0 && stepIndex === 0
  const atEnd = slideIndex === SLIDES.length - 1 && stepIndex === slide.steps - 1

  const next = useCallback(() => {
    if (stepIndex < slide.steps - 1) {
      setDirection(1)
      setStepIndex((value) => value + 1)
      return
    }
    if (slideIndex < SLIDES.length - 1) {
      setDirection(1)
      setSlideIndex((value) => value + 1)
      setStepIndex(0)
    }
  }, [slide.steps, slideIndex, stepIndex])

  const previous = useCallback(() => {
    if (stepIndex > 0) {
      setDirection(-1)
      setStepIndex((value) => value - 1)
      return
    }
    if (slideIndex > 0) {
      setDirection(-1)
      setSlideIndex((value) => value - 1)
      setStepIndex(SLIDES[slideIndex - 1].steps - 1)
    }
  }, [slideIndex, stepIndex])

  const moveWithLock = useCallback((move) => {
    const now = Date.now()
    if (now - lastInputAt.current < 700) return
    lastInputAt.current = now
    move()
  }, [])

  const jumpTo = useCallback((index) => {
    if (index === slideIndex) return
    setDirection(index > slideIndex ? 1 : -1)
    setSlideIndex(index)
    setStepIndex(0)
  }, [slideIndex])

  useEffect(() => {
    const suffix = stepIndex > 0 ? `:${stepIndex + 1}` : ''
    window.history.replaceState(null, '', `#${slide.id}${suffix}`)
  }, [slide.id, stepIndex])

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName))) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        else rootRef.current?.requestFullscreen().catch(() => {})
        return
      }
      if (event.repeat) return
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault()
        moveWithLock(next)
      }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault()
        moveWithLock(previous)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moveWithLock, next, previous])

  const renderSlide = () => {
    if (slide.id === 'cover') {
      return (
        <div className="relative flex h-full items-end overflow-hidden">
          <img
            src="/videos/hero-poster.jpg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-bg-base via-bg-base/90 to-bg-base/20" />
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.75, ease: 'easeOut' }}
            className="relative z-10 max-w-6xl pb-40 md:pb-56"
          >
            <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-sec md:text-deck-meta-d">2026 자유전공학부 전공 나침반</p>
            <h1 className="mt-28 text-deck-display-m font-bold leading-[1.12] tracking-normal text-text-pri md:mt-36 md:text-deck-display-d">
              디지털인문예술전공
            </h1>
            <p className="mt-28 max-w-4xl text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">
              사람과 사회에 대한 질문을 기술과 디자인의 언어로 풀어냅니다.
            </p>
          </motion.div>
        </div>
      )
    }

    if (slide.id === 'map') {
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle index={slideIndex} label={slide.label} title="오늘의 전공 나침반" description="전공을 고르기 전에, 무엇을 배우고 어떤 결과를 만들 수 있는지 순서대로 살펴봅니다." />
          <EntryList
            items={MAP_ITEMS}
            className="mt-36 max-w-5xl"
            renderItem={([number, title, detail]) => (
              <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-16 md:grid-cols-[96px_minmax(0,1fr)] md:gap-24">
                <span className="font-mono text-caption-m text-text-meta">{number}</span>
                <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-baseline md:justify-between md:gap-24">
                  <h2 className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{title}</h2>
                  <p className="text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{detail}</p>
                </div>
              </div>
            )}
          />
        </div>
      )
    }

    if (slide.id === 'about') {
      const mode = ['QUESTION', 'DEFINITION', 'VISION'][stepIndex]
      return (
        <div className="grid h-full items-center gap-64 lg:grid-cols-[minmax(0,.82fr)_minmax(0,1.18fr)]">
          <SlideTitle index={slideIndex} label={slide.label} title="인문학의 질문을 디지털로 확장합니다." />
          <motion.div
            initial={false}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="border-l border-border-strong pl-28 md:pl-48"
          >
            <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{mode}</p>
            {stepIndex === 0 && (
              <p className="mt-24 text-deck-title-m font-bold leading-[1.45] text-text-pri md:text-deck-title-d">{ABOUT_COPY.ko.whyStatement}</p>
            )}
            {stepIndex === 1 && (
              <p className="mt-24 text-deck-body-m leading-[1.8] text-text-pri md:text-deck-body-d">{ABOUT_COPY.ko.what}</p>
            )}
            {stepIndex === 2 && (
              <EntryList
                items={ABOUT_COPY.ko.vision}
                className="mt-20"
                renderItem={(item) => <p className="text-deck-body-m leading-[1.7] text-text-pri md:text-deck-body-d">{item.title}</p>}
              />
            )}
          </motion.div>
        </div>
      )
    }

    if (slide.id === 'curriculum') {
      const focusedTrack = stepIndex > 0 ? tracks[stepIndex - 1] : null
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle index={slideIndex} label={slide.label} title="세 개의 트랙으로 나만의 전공을 설계합니다." />
          {!focusedTrack ? (
            <div className="mt-40 grid border-y border-border-subtle lg:grid-cols-3">
              {tracks.map((track, index) => (
                <motion.article key={track.id} initial={reducedMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.07 }} className="border-b border-border-subtle py-28 lg:border-b-0 lg:border-r lg:px-32 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0">
                  <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">{track.no}</p>
                  <h2 className="mt-16 text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{track.name}</h2>
                  <p className="mt-20 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{track.keywords.join(' · ')}</p>
                </motion.article>
              ))}
            </div>
          ) : (
            <div className="mt-36 grid gap-56 border-y border-border-subtle py-32 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,.92fr)]">
              <div>
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{focusedTrack.no}</p>
                <h2 className="mt-16 text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{focusedTrack.name}</h2>
                <p className="mt-24 text-deck-body-m leading-[1.75] text-text-sec md:text-deck-body-d">{focusedTrack.summary}</p>
              </div>
              <div className="border-l border-border-subtle pl-28 md:pl-40">
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">KEYWORDS</p>
                <p className="mt-16 text-deck-body-m font-bold leading-[1.7] text-text-pri md:text-deck-body-d">{focusedTrack.keywords.join(' · ')}</p>
                <p className="mt-28 font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">COURSES</p>
                <p className="mt-16 text-body-l-m leading-[1.8] text-text-sec md:text-body-l-d">{focusedTrack.courses.slice(0, 7).join(' / ')}</p>
              </div>
            </div>
          )}
        </div>
      )
    }

    if (slide.id === 'codesharing') {
      const showTypes = stepIndex === 1
      return (
        <div className="grid h-full items-center gap-40 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <SlideTitle index={slideIndex} label={slide.label} title="다른 전공의 배움도 디인예의 역량으로 연결합니다." description={codeSharing.definition} />
          {showTypes ? (
            <EntryList
              items={codeSharing.types}
              renderItem={(item, index) => (
                <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-20">
                  <span className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</span>
                  <div><h2 className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{item.name}</h2><p className="mt-8 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{item.detail}</p></div>
                </div>
              )}
            />
          ) : (
            <ol className="grid grid-cols-2 gap-x-32 gap-y-28 border-y border-border-subtle py-28 md:grid-cols-4">
              {codeSharing.steps.map((item, index) => (
                <li key={item} className="min-w-0"><p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</p><p className="mt-12 text-deck-body-m font-bold leading-[1.6] text-text-pri md:text-deck-body-d">{item}</p></li>
              ))}
            </ol>
          )}
        </div>
      )
    }

    if (slide.id === 'nanodegree') {
      const selected = stepIndex > 0 ? nanodegree.programs[stepIndex - 1] : null
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle index={slideIndex} label={slide.label} title="현장 실무 중심의 나노디그리" description={`${nanodegree.intro} ${nanodegree.cert}`} />
          <div className="mt-32 grid border-y border-border-subtle lg:grid-cols-4">
            {nanodegree.programs.map((program, index) => {
              const active = !selected || selected.name === program.name
              return (
                <motion.article key={program.name} initial={false} animate={{ opacity: active ? 1 : 0.34 }} transition={{ duration: 0.35 }} className="border-b border-border-subtle px-0 py-24 last:border-b-0 lg:border-b-0 lg:border-r lg:px-28 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0">
                  <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</p>
                  <h2 className="mt-12 text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{program.name}</h2>
                  <p className="mt-12 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{program.criteria} · {program.partner}</p>
                  {active && selected && <p className="mt-20 border-t border-border-subtle pt-16 text-body-l-m leading-[1.7] text-text-pri md:text-body-l-d">{program.courses.map((course) => course.name).join(' / ')}</p>}
                </motion.article>
              )
            })}
          </div>
        </div>
      )
    }

    if (slide.id === 'faculty') {
      const current = faculty.slice(stepIndex * 6, (stepIndex + 1) * 6)
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle index={slideIndex} label={slide.label} title="서로 다른 전문성이 하나의 융합 교육을 만듭니다." />
          <div className="mt-32 grid gap-x-56 gap-y-24 border-y border-border-subtle py-28 lg:grid-cols-2">
            {current.map((person, index) => (
              <motion.figure key={person.id} initial={reducedMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.45, delay: reducedMotion ? 0 : index * 0.055 }} className="grid min-w-0 grid-cols-[104px_minmax(0,1fr)] items-center gap-24 md:grid-cols-[120px_minmax(0,1fr)] md:gap-28">
                <ImageFrame src={person.photo || undefined} alt={`${person.name} 교수 사진`} ratio="306/427" contain bg={person.hasBg} placeholder={<span className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">{initialsOf(person)}</span>} />
                <figcaption className="min-w-0">
                  <p className="text-deck-body-m font-bold leading-[1.45] text-text-pri md:text-deck-body-d">{person.name}</p>
                  <p className="mt-8 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{person.nameEn}</p>
                  <p className="mt-8 text-small-m leading-[1.65] text-text-meta md:text-small-d">{person.role}</p>
                  {person.affiliation && <p className="mt-4 text-small-m leading-[1.65] text-text-meta md:text-small-d">{person.affiliation}</p>}
                </figcaption>
              </motion.figure>
            ))}
          </div>
          <p className="mt-16 font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">{stepIndex + 1} / {slide.steps}</p>
        </div>
      )
    }

    if (slide.id === 'exhibitions') {
      return (
        <div className="grid h-full items-center gap-36 lg:grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)]">
          <SlideTitle index={slideIndex} label={slide.label} title="수업의 결과를 전시로 공개합니다." description="프로젝트는 매 학기 전시를 통해 관객을 만나고, 다음 작업의 출발점이 됩니다." />
          <PosterStrip items={exhibitions.slice(stepIndex * 3, (stepIndex + 1) * 3)} />
        </div>
      )
    }

    if (slide.id === 'contests') {
      return (
        <div className="grid h-full items-center gap-36 lg:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)]">
          <SlideTitle index={slideIndex} label={slide.label} title="공모전에서 기획과 제작의 결과를 남깁니다." description="포스터와 장서표 공모전은 학생이 직접 주제를 해석하고 시각화한 결과를 공유하는 자리입니다." />
          <div className="max-w-3xl"><PosterStrip items={contests.slice(stepIndex * 2, (stepIndex + 1) * 2)} /></div>
        </div>
      )
    }

    if (slide.id === 'achievements') {
      const pageSize = 5
      const current = achievements.slice(stepIndex * pageSize, (stepIndex + 1) * pageSize)
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle index={slideIndex} label={slide.label} title="학생 성과" description="사이트에 등록된 기록을 최신 순서로 발표 화면에 이어 보여줍니다." />
          <EntryList
            items={current}
            className="mt-28 max-w-5xl"
            renderItem={(item) => <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-24"><span className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">{item.year}</span><div><h2 className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{item.title}</h2>{item.awardees && <p className="mt-8 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{item.awardees}</p>}</div></div>}
          />
          <p className="mt-16 font-mono text-caption-m text-text-meta">{stepIndex + 1} / {slide.steps}</p>
        </div>
      )
    }

    if (slide.id === 'careers') {
      const pageSize = 5
      const current = careers.slice(stepIndex * pageSize, (stepIndex + 1) * pageSize)
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle index={slideIndex} label={slide.label} title="졸업 이후의 진로" description="디자인, 콘텐츠, 데이터, 연구와 대학원 등 서로 다른 현장으로 이어집니다." />
          <EntryList
            items={current}
            className="mt-28 max-w-5xl"
            renderItem={(item) => <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-28"><span className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{item.name}</span><div><h2 className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{item.company}</h2><p className="mt-6 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{item.role || item.majors}</p></div></div>}
          />
          <p className="mt-16 font-mono text-caption-m text-text-meta">{stepIndex + 1} / {slide.steps}</p>
        </div>
      )
    }

    if (slide.id === 'council') {
      const members = council?.members ?? []
      const leaders = members.slice(0, 2)
      return (
        <div className="grid h-full items-center gap-40 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <SlideTitle index={slideIndex} label={slide.label} title={council?.title || council?.name || '운영위원회'} description={stepIndex === 0 ? council?.intro : '서로 다른 역할을 연결해 전공의 활동과 전시를 만듭니다.'} />
          {stepIndex === 0 ? (
            <EntryList
              items={leaders}
              renderItem={(member) => <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-24"><dt className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">{member.role}</dt><dd><p className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{member.name}</p>{member.majors && <p className="mt-6 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{member.majors}</p>}</dd></div>}
            />
          ) : (
            <EntryList
              items={members}
              className="grid grid-cols-2 gap-x-40"
              renderItem={(member) => <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-20"><dt className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">{member.role}</dt><dd className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{member.name}</dd></div>}
            />
          )}
        </div>
      )
    }

    if (slide.id === 'clubs') {
      const current = clubs.slice(stepIndex * 2, (stepIndex + 1) * 2)
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle index={slideIndex} label={slide.label} title="네 개의 동아리가 각자의 방식으로 전공을 확장합니다." />
          <div className="mt-32 grid border-y border-border-subtle lg:grid-cols-2">
            {current.map((club, index) => {
              const name = club.title_ko || club.title || club.name
              const field = club.tag || club.field
              const intro = club.intro || club.body?.intro
              const activities = club.activities || club.body?.activities || []
              return (
                <article key={club.id} className="border-b border-border-subtle py-28 last:border-b-0 lg:border-b-0 lg:border-r lg:px-40 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0">
                  <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{stepIndex * 2 + index + 1} / {field}</p>
                  <h2 className="mt-16 text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{name}</h2>
                  <p className="mt-20 text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">{intro}</p>
                  {activities.length > 0 && <ul className="mt-24 space-y-10 border-t border-border-subtle pt-20">{activities.slice(0, 3).map((activity) => <li key={activity} className="text-body-l-m leading-[1.65] text-text-pri md:text-body-l-d">— {activity}</li>)}</ul>}
                </article>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col justify-center">
        <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">DIGITAL ARTS & HUMANITIES</p>
        <h1 className="mt-28 max-w-6xl text-deck-display-m font-bold leading-[1.2] tracking-normal text-text-pri md:text-deck-display-d">당신의 질문에서<br />다음 프로젝트가 시작됩니다.</h1>
        <p className="mt-32 max-w-3xl text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">한림대학교 디지털인문예술전공</p>
      </div>
    )
  }

  return (
    <main
      ref={rootRef}
      className="relative h-dvh w-full touch-none overflow-hidden bg-bg-base"
      aria-label="디지털인문예술전공 전공 나침반"
      onWheel={(event) => {
        event.preventDefault()
        if (Math.abs(event.deltaY) < 12) return
        moveWithLock(event.deltaY > 0 ? next : previous)
      }}
      onPointerMove={(event) => setPointer({ x: (event.clientX / window.innerWidth) * 100, y: (event.clientY / window.innerHeight) * 100 })}
      onTouchStart={(event) => { touchStartY.current = event.changedTouches[0]?.clientY ?? null }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientY
        if (touchStartY.current === null || end === undefined) return
        const distance = touchStartY.current - end
        if (Math.abs(distance) > 36) moveWithLock(distance > 0 ? next : previous)
        touchStartY.current = null
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-nebula-soft opacity-80" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(36rem circle at ${pointer.x}% ${pointer.y}%, rgb(var(--dah-purple-primary) / .08), transparent 62%)` }} />

      <Link to="/news/major-compass" aria-label="전공 나침반 공지 상세로 돌아가기" className="absolute left-16 top-20 z-30 inline-flex h-40 w-40 items-center justify-center border border-border-subtle text-text-sec transition-colors duration-fast ease-out hover:border-border-strong hover:text-text-pri md:left-24 md:top-24 lg:left-32">
        <X size={16} aria-hidden="true" />
      </Link>
      <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 font-mono text-caption-m text-text-meta md:top-24">
        {String(slideIndex + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
      </div>

      <section className="relative z-10 h-full px-24 pb-80 pt-80 md:px-64 md:pb-88 md:pt-88 lg:px-128">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={`${slide.id}-${stepIndex}`}
            custom={direction}
            variants={slideMotion}
            initial={reducedMotion ? false : 'enter'}
            animate="center"
            exit={reducedMotion ? undefined : 'exit'}
            transition={{ duration: reducedMotion ? 0 : 0.48, ease: [0.22, 1, 0.36, 1] }}
            className="h-full"
          >
            {renderSlide()}
          </motion.div>
        </AnimatePresence>
      </section>

      <nav aria-label="전공 나침반 목차" className="absolute right-16 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-end md:flex lg:right-28">
        {SLIDES.map((item, index) => (
          <button key={item.id} type="button" onClick={() => jumpTo(index)} aria-label={`${index + 1}. ${item.label}`} aria-current={index === slideIndex ? 'step' : undefined} className="group flex h-28 items-center gap-8">
            {index === slideIndex && <span className="font-mono text-caption-m text-text-meta opacity-0 transition-opacity duration-fast ease-out group-hover:opacity-100">{item.label}</span>}
            <span className={`block rounded-full transition-all duration-fast ease-out ${index === slideIndex ? 'h-8 w-8 bg-purple-light' : 'h-4 w-4 bg-border-strong group-hover:bg-text-sec'}`} />
          </button>
        ))}
      </nav>

      <footer className="absolute inset-x-16 bottom-20 z-30 flex items-center justify-between gap-16 md:inset-x-24 md:bottom-24 lg:inset-x-32">
        <p className="font-mono text-caption-m text-text-meta">← → · Space · F</p>
        <div className="flex items-center gap-12">
          <button type="button" onClick={previous} disabled={atStart} className="inline-flex h-40 items-center gap-8 border border-border-subtle px-12 font-mono text-caption-m text-text-sec transition-colors duration-fast ease-out hover:border-border-strong hover:text-text-pri disabled:opacity-30"><ArrowLeft size={14} aria-hidden="true" /> 이전</button>
          <button type="button" onClick={next} disabled={atEnd} className="inline-flex h-40 items-center gap-8 border border-border-subtle px-12 font-mono text-caption-m text-text-sec transition-colors duration-fast ease-out hover:border-border-strong hover:text-text-pri disabled:opacity-30">다음 <ArrowRight size={14} aria-hidden="true" /></button>
        </div>
      </footer>
    </main>
  )
}

export default MajorCompassExperience
