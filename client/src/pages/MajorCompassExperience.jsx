import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LayoutGrid, Maximize2, X } from 'lucide-react'
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
import {
  decadeAgenda,
  decadeAiGap,
  decadeAssignments,
  decadeCompetency,
  decadeCover,
  decadeDemo,
  decadeDesign,
  decadeExhibition,
  decadeFamiliar,
  decadeIntro,
  decadeJobMap,
  decadeNext,
  decadeOrigin,
  decadeParts,
  decadePrinciple,
  decadeProblem,
  decadeProject,
  decadeReverse,
  decadeSolopreneur,
  decadeSolopreneurShot,
  decadeStorybook,
  decadeThenNow,
  decadeWrapUp,
} from '../data/majorDecade'

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
  { id: 'cover', label: '표지', steps: 1 },
  { id: 'about', label: '전공 소개', steps: 3 },
  { id: 'curriculum', label: '교육과정', steps: 4 },
  { id: 'codesharing', label: '코드쉐어링', steps: 2 },
  { id: 'nanodegree', label: '나노디그리', steps: 5 },
  { id: 'faculty', label: '교수진', steps: 2 },
  { id: 'exhibitions', label: '전시', steps: 2 },
  { id: 'contests', label: '공모전', steps: 2 },
  { id: 'achievements', label: '학생 성과', steps: 1 },
  { id: 'careers', label: '졸업 후 진로', steps: 1 },
  // 「디지털인문예술전공 10년: 전공교육 우수사례」(한수미 교수) 28장을 옮겨온 구간.
  // 교수 발표가 '졸업 후 진로'에서 끝나고 학생회 발표가 '운영위원회'에서 시작하므로 그 사이에 둔다.
  { id: 'decade-cover', label: '디인예 10년', steps: 1 },
  { id: 'decade-intro', label: '들어가며', steps: 1 },
  { id: 'decade-origin', label: '2017년 시작과 현재', steps: 3 },
  { id: 'decade-foundation', label: '전공교육의 출발점', steps: 3 },
  { id: 'decade-motivation', label: 'Part 1 · 동기', steps: 2 },
  { id: 'decade-assignments', label: '관심사 기반 과제', steps: 2 },
  { id: 'decade-efficacy', label: 'Part 2 · 효능감', steps: 2 },
  { id: 'decade-exhibition', label: '프로젝트 전시회', steps: 2 },
  { id: 'decade-ai', label: 'AI 교육', steps: 3 },
  { id: 'decade-career', label: 'Part 3 · 진로', steps: 4 },
  { id: 'decade-vision', label: 'Part 4 · 다음 10년', steps: 3 },
  { id: 'decade-reverse', label: 'Reverse Learning', steps: 1 },
  { id: 'decade-wrapup', label: '정리 및 다음 방향', steps: 2 },
  { id: 'council', label: '운영위원회', steps: 1 },
  { id: 'clubs', label: '동아리', steps: 2 },
  { id: 'closing', label: '마무리', steps: 1 },
]

const FEATURED_ACHIEVEMENT_IDS = ['ach-12', 'ach-18', 'ach-20']
const FEATURED_CAREER_IDS = ['career-07', 'career-15', 'career-22', 'career-03']

const slideMotion = {
  enter: (direction) => ({ opacity: 0, x: direction > 0 ? 56 : -56, scale: 0.994, filter: 'blur(2px)' }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.54, ease: [0.22, 1, 0.36, 1] },
  },
  exit: (direction) => ({
    opacity: 0,
    x: direction > 0 ? -28 : 28,
    scale: 0.998,
    filter: 'blur(1px)',
    transition: { duration: 0.26, ease: [0.4, 0, 1, 1] },
  }),
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

function SlideTitle({ label, title, description }) {
  return (
    <header className="max-w-7xl">
      <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">
        {label}
      </p>
      <h1 className="mt-20 text-deck-title-m font-bold leading-[1.22] tracking-normal text-text-pri md:mt-24 md:text-[clamp(32px,4.45dvh,48px)]">
        {title}
      </h1>
      {description && (
        <p className="mt-20 max-w-4xl text-deck-body-m leading-[1.7] text-text-sec md:mt-24 md:text-[clamp(17px,2.05dvh,22px)]">
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
          transition={{ duration: 0.32, delay: index * 0.025, ease: [0.16, 1, 0.3, 1] }}
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

// 원본 PPT에서 가져온 화면 캡처는 잘라내지 않는다. 남은 높이를 모두 쓰고 비율만 지킨다.
// 한 화면에 여러 장을 쌓을 때는 각 이미지의 세로비율만큼 높이를 나눠줘야
// 가로로 긴 측정 이미지 위아래에 빈 여백이 쌓이지 않는다.
function Shot({ images, caption, align = 'center' }) {
  return (
    <figure className="flex h-full min-w-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-16 md:gap-20">
        {images.map((image) => (
          <div
            key={image.src}
            className="min-h-0 flex-1"
            style={image.w && image.h ? { flexGrow: image.h / image.w } : undefined}
          >
            <img
              src={image.src}
              alt={image.alt}
              className={`h-full w-full rounded-md object-contain ${align === 'left' ? 'object-left' : 'object-center'}`}
            />
          </div>
        ))}
      </div>
      {caption && (
        <figcaption className="mt-20 shrink-0 border-t border-border-subtle pt-16 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

// Part 1~4 구간 표지. 숫자·제목·한 줄 설명만 남기고 나머지는 여백으로 둔다.
function PartCover({ part }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{part.no}</p>
      <h1 className="mt-24 text-deck-display-m font-bold leading-[1.14] tracking-normal text-text-pri md:mt-32 md:text-[clamp(48px,8.9dvh,96px)]">
        {part.title}
      </h1>
      <p className="mt-28 max-w-4xl border-t border-border-subtle pt-24 text-deck-body-m leading-[1.7] text-text-sec md:mt-36 md:text-deck-body-d">
        {part.detail}
      </p>
    </div>
  )
}

// 원본 슬라이드 하단의 마무리 문장. 얇은 윗선 하나로 본문과 구분한다.
function NoteLine({ children, className = '' }) {
  return (
    <p className={`mt-[clamp(20px,3dvh,32px)] border-t border-border-subtle pt-[clamp(14px,2.2dvh,20px)] text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d ${className}`.trim()}>
      {children}
    </p>
  )
}

// 번호가 붙는 동일 위계 항목을 가로로 늘어놓는다. 카드가 아니라 세로 구분선으로 나눈다.
function NumberedGrid({ items, columns = 4, reducedMotion }) {
  const columnClass = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' }[columns]
  return (
    <div className={`mt-[clamp(20px,3.4dvh,36px)] grid border-y border-border-subtle sm:grid-cols-2 ${columnClass}`}>
      {items.map((item, index) => (
        <motion.article
          key={item.title}
          initial={reducedMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.32, delay: reducedMotion ? 0 : index * 0.03, ease: [0.16, 1, 0.3, 1] }}
          className="min-w-0 border-b border-border-subtle py-[clamp(18px,2.8dvh,30px)] last:border-b-0 sm:px-20 sm:first:pl-0 sm:last:pr-0 lg:border-b-0 lg:border-r lg:px-28 lg:last:border-r-0"
        >
          <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</p>
          <h2 className="mt-16 text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{item.title}</h2>
          <p className="mt-16 whitespace-pre-line text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{item.detail}</p>
        </motion.article>
      ))}
    </div>
  )
}

function MobilePreview({ onPresent }) {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 390 : window.innerWidth))
  const frameWidth = Math.min(Math.max(viewportWidth - 40, 280), 640)
  const scale = frameWidth / 1280

  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  return (
    <main className="min-h-dvh bg-bg-base pb-40 text-text-pri" aria-label="디지털인문예술전공 전공 나침반 미리보기">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-subtle bg-bg-base/90 px-20 py-14 backdrop-blur-glass">
        <Link to="/resources/major-compass" className="text-small-m text-text-sec">자료실로 돌아가기</Link>
        <button type="button" onClick={onPresent} className="inline-flex min-h-11 items-center gap-8 border border-purple-light/60 bg-purple-primary px-12 text-small-m font-bold text-text-pri">
          <Maximize2 size={15} aria-hidden="true" />
          가로 발표 보기
        </button>
      </header>
      <div className="mx-auto max-w-[680px] space-y-12 px-20 pt-20">
        {SLIDES.map((item, index) => {
          const step = Math.max(item.steps - 1, 0)
          return (
            <section key={item.id} aria-label={`${item.label} 미리보기`} className="overflow-hidden border border-border-subtle bg-bg-panel shadow-glass" style={{ height: `${720 * scale}px` }}>
              <iframe
                title={`${item.label} 발표 자료`}
                src={`/major-compass?preview=1#${item.id}${step > 0 ? `:${step + 1}` : ''}`}
                tabIndex="-1"
                loading={index < 3 ? 'eager' : 'lazy'}
                className="pointer-events-none origin-top-left border-0"
                style={{ width: '1280px', height: '720px', transform: `scale(${scale})` }}
              />
            </section>
          )
        })}
      </div>
    </main>
  )
}

function MajorCompassExperience() {
  const rootRef = useRef(null)
  const lastInputAt = useRef(0)
  const touchStartY = useRef(null)
  const initialLocation = useRef(readLocation())
  const reducedMotion = useReducedMotion()
  const isPreviewFrame = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview')
  const [slideIndex, setSlideIndex] = useState(initialLocation.current.slide)
  const [stepIndex, setStepIndex] = useState(initialLocation.current.step)
  const [direction, setDirection] = useState(1)
  const [pointer, setPointer] = useState({ x: 50, y: 50 })
  const [mapOpen, setMapOpen] = useState(false)
  const [mobilePresentation, setMobilePresentation] = useState(false)

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
    if (now - lastInputAt.current < 580) return
    lastInputAt.current = now
    move()
  }, [])

  const jumpTo = useCallback((index) => {
    setMapOpen(false)
    if (index !== slideIndex) {
      setDirection(index > slideIndex ? 1 : -1)
      setSlideIndex(index)
      setStepIndex(0)
    }
  }, [slideIndex])

  const openMobilePresentation = useCallback(async () => {
    setMobilePresentation(true)
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen?.()
      await screen.orientation?.lock?.('landscape')
    } catch {
      // 일부 모바일 브라우저는 방향 잠금을 지원하지 않는다. 사용자가 직접 가로로 돌려도 발표 화면은 유지한다.
    }
  }, [])

  useEffect(() => {
    const suffix = stepIndex > 0 ? `:${stepIndex + 1}` : ''
    window.history.replaceState(null, '', `#${slide.id}${suffix}`)
  }, [slide.id, stepIndex])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && mapOpen) {
        event.preventDefault()
        setMapOpen(false)
        return
      }
      if (mapOpen) return
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
  }, [mapOpen, moveWithLock, next, previous])

  useEffect(() => {
    const resetMobilePresentation = () => {
      if (!document.fullscreenElement) setMobilePresentation(false)
    }
    document.addEventListener('fullscreenchange', resetMobilePresentation)
    return () => document.removeEventListener('fullscreenchange', resetMobilePresentation)
  }, [])

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
            transition={{ duration: reducedMotion ? 0 : 0.36, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full px-[clamp(24px,6.7vw,128px)] pb-[clamp(48px,8dvh,88px)]"
          >
            <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-sec md:text-deck-meta-d">2026 자유전공학부 전공 나침반</p>
            <h1 className="mt-28 text-deck-display-m font-bold leading-[1.12] tracking-normal text-text-pri md:mt-36 md:text-[clamp(48px,8.9dvh,96px)]">
              디지털인문예술전공
            </h1>
            <p className="mt-28 max-w-4xl text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">
              사람과 사회에 대한 질문을 기술과 디자인의 언어로 풀어냅니다.
            </p>
          </motion.div>
        </div>
      )
    }

    if (slide.id === 'about') {
      const mode = ['핵심 질문', '전공의 정의', '전공의 비전'][stepIndex]
      return (
        <div className="grid h-full items-center gap-64 lg:grid-cols-[minmax(0,.82fr)_minmax(0,1.18fr)]">
          <SlideTitle label={slide.label} title="인문학의 질문을 디지털로 확장합니다." />
          <motion.div
            initial={false}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
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
          <SlideTitle label={slide.label} title="세 개의 트랙으로 나만의 전공을 설계합니다." />
          {!focusedTrack ? (
            <div className="mt-40 grid border-y border-border-subtle lg:grid-cols-3">
              {tracks.map((track, index) => (
                <motion.article key={track.id} initial={reducedMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.34, delay: reducedMotion ? 0 : index * 0.025, ease: [0.16, 1, 0.3, 1] }} className="border-b border-border-subtle py-28 lg:border-b-0 lg:border-r lg:px-32 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0">
                  <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">트랙 {String(index + 1).padStart(2, '0')}</p>
                  <h2 className="mt-16 text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{track.name}</h2>
                  <p className="mt-20 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{track.keywords.join(' · ')}</p>
                </motion.article>
              ))}
            </div>
          ) : (
            <div className="mt-36 grid gap-56 border-y border-border-subtle py-32 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,.92fr)]">
              <div>
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">트랙 {String(tracks.findIndex((track) => track.id === focusedTrack.id) + 1).padStart(2, '0')}</p>
                <h2 className="mt-16 text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{focusedTrack.name}</h2>
                <p className="mt-24 text-deck-body-m leading-[1.75] text-text-sec md:text-deck-body-d">{focusedTrack.summary}</p>
              </div>
              <div className="border-l border-border-subtle pl-28 md:pl-40">
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">핵심 키워드</p>
                <p className="mt-16 text-deck-body-m font-bold leading-[1.7] text-text-pri md:text-deck-body-d">{focusedTrack.keywords.join(' · ')}</p>
                <p className="mt-28 font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">주요 교과목</p>
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
          <SlideTitle label={slide.label} title="다른 전공의 배움도 디인예의 역량으로 연결합니다." description={codeSharing.definition} />
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
          <SlideTitle label={slide.label} title="현장 실무 중심의 나노디그리" description={`${nanodegree.intro} ${nanodegree.cert}`} />
          <div className="mt-32 grid border-y border-border-subtle lg:grid-cols-4">
            {nanodegree.programs.map((program, index) => {
              const active = !selected || selected.name === program.name
              return (
                <motion.article key={program.name} initial={false} animate={{ opacity: active ? 1 : 0.34 }} transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }} className="border-b border-border-subtle px-0 py-24 last:border-b-0 lg:border-b-0 lg:border-r lg:px-28 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0">
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
          <SlideTitle label={slide.label} title="서로 다른 전문성이 하나의 융합 교육을 만듭니다." />
          <div className="mt-[clamp(20px,3dvh,32px)] grid gap-x-56 gap-y-[clamp(12px,2.2dvh,24px)] border-y border-border-subtle py-[clamp(16px,2.6dvh,28px)] lg:grid-cols-2">
            {current.map((person, index) => (
              <motion.figure key={person.id} initial={reducedMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.32, delay: reducedMotion ? 0 : index * 0.025, ease: [0.16, 1, 0.3, 1] }} className="grid min-w-0 items-center gap-20 md:gap-28" style={{ gridTemplateColumns: 'clamp(72px, 11dvh, 120px) minmax(0, 1fr)' }}>
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
        </div>
      )
    }

    if (slide.id === 'exhibitions') {
      return (
        <div className="grid h-full items-center gap-36 lg:grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)]">
          <SlideTitle label={slide.label} title="수업의 결과를 전시로 공개합니다." description="프로젝트는 매 학기 전시를 통해 관객을 만나고, 다음 작업의 출발점이 됩니다." />
          <PosterStrip items={exhibitions.slice(stepIndex * 3, (stepIndex + 1) * 3)} />
        </div>
      )
    }

    if (slide.id === 'contests') {
      return (
        <div className="grid h-full items-center gap-36 lg:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)]">
          <SlideTitle label={slide.label} title="공모전에서 기획과 제작의 결과를 남깁니다." description="포스터와 장서표 공모전은 학생이 직접 주제를 해석하고 시각화한 결과를 공유하는 자리입니다." />
          <div className="max-w-3xl"><PosterStrip items={contests.slice(stepIndex * 2, (stepIndex + 1) * 2)} /></div>
        </div>
      )
    }

    if (slide.id === 'achievements') {
      const featured = FEATURED_ACHIEVEMENT_IDS
        .map((id) => achievements.find((item) => item.id === id))
        .filter(Boolean)
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={slide.label} title="배움은 공모전·디자인·연구 성과로 이어집니다." description="디자인 역량, AI 프로젝트, 학술 연구로 확장된 디인예의 대표 성과입니다." />
          <div className="mt-[clamp(24px,4dvh,40px)] grid border-y border-border-subtle lg:grid-cols-3">
            {featured.map((item, index) => (
              <article key={item.id} className="border-b border-border-subtle py-[clamp(20px,3dvh,32px)] lg:border-b-0 lg:border-r lg:px-32 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0">
                <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1} / {item.year}</p>
                <h2 className="mt-16 text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{item.title}</h2>
                <p className="mt-16 line-clamp-3 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{item.desc}</p>
                {item.awardees && <p className="mt-16 font-bold leading-[1.6] text-text-pri">{item.awardees}</p>}
              </article>
            ))}
          </div>
        </div>
      )
    }

    if (slide.id === 'careers') {
      const featured = FEATURED_CAREER_IDS
        .map((id) => careers.find((item) => item.id === id))
        .filter(Boolean)
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={slide.label} title="졸업 이후의 진로" description="UX 디자인, AI 연구, 비주얼 디자인, 대학원까지—전공에서 시작한 역량은 서로 다른 현장으로 이어집니다." />
          <div className="mt-[clamp(24px,4dvh,40px)] grid grid-cols-2 border-y border-border-subtle lg:grid-cols-4">
            {featured.map((item, index) => (
              <article key={item.id} className="border-b border-r border-border-subtle px-16 py-[clamp(20px,3dvh,32px)] even:border-r-0 lg:border-b-0 lg:px-28 lg:even:border-r lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0">
                <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</p>
                <h2 className="mt-16 text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{item.company}</h2>
                <p className="mt-12 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{item.role || item.majors}</p>
                <p className="mt-20 font-bold leading-[1.6] text-text-pri">{item.name}</p>
              </article>
            ))}
          </div>
        </div>
      )
    }

    if (slide.id === 'decade-cover') {
      return (
        <div className="flex h-full flex-col justify-center">
          <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeCover.eyebrow}</p>
          <h1 className="mt-28 text-deck-display-m font-bold leading-[1.12] tracking-normal text-text-pri md:mt-36 md:text-[clamp(48px,8.9dvh,96px)]">
            {decadeCover.title}
          </h1>
          <p className="mt-28 max-w-5xl text-deck-title-m leading-[1.45] text-text-sec md:mt-32 md:text-deck-title-d">{decadeCover.subtitle}</p>
          <p className="mt-[clamp(32px,6dvh,64px)] border-t border-border-subtle pt-24 font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">
            {decadeCover.presenter}
          </p>
        </div>
      )
    }

    if (slide.id === 'decade-intro') {
      return (
        <div className="grid h-full items-center gap-48 lg:grid-cols-[minmax(0,.88fr)_minmax(0,1.12fr)] lg:gap-64">
          <SlideTitle label={slide.label} title={decadeIntro.title} />
          <div>
            <EntryList
              items={decadeIntro.questions.map((question) => ({ id: question, question }))}
              renderItem={(item) => (
                <p className="text-deck-body-m font-bold leading-[1.6] text-text-pri md:text-deck-body-d">{item.question}</p>
              )}
            />
            <NoteLine className="border-t-0 pt-0">{decadeIntro.closing}</NoteLine>
          </div>
        </div>
      )
    }

    if (slide.id === 'decade-origin') {
      if (stepIndex === 2) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={decadePrinciple.label} title={decadePrinciple.title} description={decadePrinciple.lead} />
            <div className="mt-[clamp(20px,3.4dvh,36px)] border-l border-border-strong pl-28 md:pl-40">
              <p className="text-deck-title-m font-bold leading-[1.4] text-text-pri md:text-deck-title-d">{decadePrinciple.quote}</p>
              <p className="mt-20 text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">
                {decadePrinciple.quoteDetail.join(' ')}
              </p>
            </div>
            <NumberedGrid items={decadePrinciple.rules} columns={3} reducedMotion={reducedMotion} />
          </div>
        )
      }
      const view = stepIndex === 0 ? decadeOrigin.past : decadeOrigin.present
      return (
        <div className="grid h-full min-h-0 gap-40 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,.62fr)_minmax(0,1.38fr)] lg:gap-56">
          <div className="flex min-w-0 flex-col justify-center">
            <SlideTitle label={slide.label} title={decadeOrigin.title} />
            <p className="mt-[clamp(20px,3dvh,32px)] border-t border-border-subtle pt-20 font-mono text-deck-meta-m text-text-sec md:text-deck-meta-d">
              {view.label}
            </p>
            {stepIndex === 1 && (
              <>
                <p className="mt-20 text-deck-title-m font-bold leading-[1.4] text-text-pri md:text-deck-title-d">
                  {decadeOrigin.present.enrollment}
                </p>
                <p className="mt-16 break-all text-small-m leading-[1.65] text-text-meta md:text-small-d">
                  {decadeOrigin.present.source}
                </p>
              </>
            )}
          </div>
          <Shot images={stepIndex === 0 ? decadeOrigin.past.images : decadeOrigin.present.images} />
        </div>
      )
    }

    if (slide.id === 'decade-foundation') {
      if (stepIndex === 0) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={slide.label} title={decadeAgenda.title} />
            <div className="mt-[clamp(24px,4dvh,44px)] grid border-y border-border-subtle sm:grid-cols-2 lg:grid-cols-4">
              {decadeAgenda.items.map((item, index) => (
                <motion.article
                  key={item.no}
                  initial={reducedMotion ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.34, delay: reducedMotion ? 0 : index * 0.03, ease: [0.16, 1, 0.3, 1] }}
                  className="min-w-0 border-b border-border-subtle py-[clamp(20px,3.2dvh,34px)] last:border-b-0 sm:px-20 sm:first:pl-0 sm:last:pr-0 lg:border-b-0 lg:border-r lg:px-32 lg:last:border-r-0"
                >
                  <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{item.no}</p>
                  <h2 className="mt-16 text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{item.title}</h2>
                  <p className="mt-16 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{item.detail}</p>
                </motion.article>
              ))}
            </div>
          </div>
        )
      }
      if (stepIndex === 1) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={decadeProblem.label} title={decadeProblem.title} description={decadeProblem.lead} />
            <EntryList
              className="mt-[clamp(20px,3.2dvh,34px)]"
              items={decadeProblem.items.map((item) => ({ ...item, id: item.tag }))}
              renderItem={(item) => (
                <div className="grid gap-12 md:grid-cols-[120px_minmax(0,1fr)] md:gap-28">
                  <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{item.tag}</p>
                  <div className="min-w-0">
                    <p className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{item.quote}</p>
                    <p className="mt-8 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{item.detail}</p>
                  </div>
                </div>
              )}
            />
            <NoteLine className="border-t-0 pt-0">{decadeProblem.footer}</NoteLine>
          </div>
        )
      }
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeDesign.label} title={decadeDesign.title} description={decadeDesign.lead} />
          <div className="mt-[clamp(24px,4dvh,44px)] grid border-y border-border-subtle lg:grid-cols-3">
            {decadeDesign.stages.map((stage, index) => (
              <motion.article
                key={stage.title}
                initial={reducedMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.34, delay: reducedMotion ? 0 : index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                className="min-w-0 border-b border-border-subtle py-[clamp(20px,3.2dvh,34px)] last:border-b-0 lg:border-b-0 lg:border-r lg:px-32 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0"
              >
                <p className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</p>
                <h2 className="mt-16 text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{stage.title}</h2>
                <p className="mt-16 text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">{stage.detail}</p>
              </motion.article>
            ))}
          </div>
          <NoteLine className="border-t-0 pt-0 font-bold text-text-pri">{decadeDesign.footer}</NoteLine>
        </div>
      )
    }

    if (slide.id === 'decade-motivation') {
      if (stepIndex === 0) return <PartCover part={decadeParts.motivation} />
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeFamiliar.label} title={decadeFamiliar.title} />
          <div className="mt-[clamp(20px,3.4dvh,36px)] grid gap-40 border-y border-border-subtle py-[clamp(18px,2.8dvh,30px)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] lg:gap-56">
            <div className="grid gap-[clamp(18px,2.8dvh,30px)]">
              {decadeFamiliar.blocks.map((block) => (
                <div key={block.title} className="min-w-0">
                  <h2 className="text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{block.title}</h2>
                  <ul className="mt-12 space-y-8">
                    {block.lines.map((line) => (
                      <li key={line} className="text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">— {line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="border-t border-border-subtle pt-24 lg:border-l lg:border-t-0 lg:pl-40 lg:pt-0">
              <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeFamiliar.aside.label}</p>
              <p className="mt-16 text-deck-title-m font-bold leading-[1.4] text-text-pri md:text-deck-title-d">{decadeFamiliar.aside.statement}</p>
              <p className="mt-20 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{decadeFamiliar.aside.detail}</p>
            </div>
          </div>
        </div>
      )
    }

    if (slide.id === 'decade-assignments') {
      if (stepIndex === 0) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={decadeAssignments.label} title={decadeAssignments.title} />
            <NumberedGrid items={decadeAssignments.items} columns={4} reducedMotion={reducedMotion} />
            <NoteLine className="border-t-0 pt-0 font-bold text-text-pri">{decadeAssignments.footer}</NoteLine>
          </div>
        )
      }
      return (
        <div className="grid h-full min-h-0 gap-40 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,.62fr)_minmax(0,1.38fr)] lg:gap-56">
          <div className="flex min-w-0 flex-col justify-center">
            <SlideTitle label={decadeAssignments.label} title={decadeAssignments.title} />
            <p className="mt-[clamp(20px,3dvh,32px)] border-t border-border-subtle pt-20 text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">
              {decadeAssignments.shot.caption}
            </p>
          </div>
          <Shot images={[{ src: decadeAssignments.shot.image, alt: decadeAssignments.shot.alt }]} />
        </div>
      )
    }

    if (slide.id === 'decade-efficacy') {
      if (stepIndex === 0) return <PartCover part={decadeParts.efficacy} />
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeProject.label} title={decadeProject.title} description={decadeProject.lead} />
          <NumberedGrid items={decadeProject.steps} columns={5} reducedMotion={reducedMotion} />
          <NoteLine className="border-t-0 pt-0">{decadeProject.footer.join(' ')}</NoteLine>
        </div>
      )
    }

    if (slide.id === 'decade-exhibition') {
      if (stepIndex === 0) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={decadeExhibition.label} title={decadeExhibition.title} description={decadeExhibition.lead} />
            <div className="mt-[clamp(20px,3.4dvh,36px)] grid gap-40 border-y border-border-subtle py-[clamp(18px,2.8dvh,30px)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] lg:gap-56">
              <div className="min-w-0">
                <dl className="grid grid-cols-3 gap-24">
                  {decadeExhibition.stats.map((stat) => (
                    <div key={stat.value} className="min-w-0">
                      <dt className="text-stat-m font-bold leading-[1.1] text-text-pri md:text-stat-d">{stat.value}</dt>
                      <dd className="mt-12 text-body-l-m leading-[1.6] text-text-meta md:text-body-l-d">{stat.caption}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-[clamp(20px,3dvh,32px)] border-t border-border-subtle pt-20">
                  <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeExhibition.output.label}</p>
                  <p className="mt-12 text-deck-body-m leading-[1.7] text-text-pri md:text-deck-body-d">{decadeExhibition.output.detail}</p>
                </div>
              </div>
              <div className="border-t border-border-subtle pt-24 lg:border-l lg:border-t-0 lg:pl-40 lg:pt-0">
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeExhibition.reason.label}</p>
                <p className="mt-16 text-deck-body-m leading-[1.75] text-text-sec md:text-deck-body-d">{decadeExhibition.reason.detail}</p>
              </div>
            </div>
          </div>
        )
      }
      return (
        <div className="grid h-full min-h-0 gap-40 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,.55fr)_minmax(0,1.45fr)] lg:gap-56">
          <div className="flex min-w-0 flex-col justify-center">
            <SlideTitle label={decadeExhibition.label} title={decadeExhibition.title} />
            <p className="mt-[clamp(20px,3dvh,32px)] border-t border-border-subtle pt-20 text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">
              {decadeExhibition.shot.caption}
            </p>
          </div>
          <Shot images={[{ src: decadeExhibition.shot.image, alt: decadeExhibition.shot.alt }]} />
        </div>
      )
    }

    if (slide.id === 'decade-ai') {
      if (stepIndex === 0) {
        return (
          <div className="flex h-full flex-col justify-center">
            <header className="max-w-7xl">
              <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeAiGap.label}</p>
              <h1 className="mt-20 text-deck-title-m font-bold leading-[1.22] tracking-normal text-text-pri md:mt-24 md:text-[clamp(32px,4.45dvh,48px)]">
                {decadeAiGap.title}
              </h1>
              <p className="mt-16 text-deck-body-m leading-[1.6] text-text-meta md:text-deck-body-d">{decadeAiGap.titleNote}</p>
              <p className="mt-20 max-w-5xl text-deck-body-m leading-[1.7] text-text-sec md:mt-24 md:text-[clamp(17px,2.05dvh,22px)]">{decadeAiGap.lead}</p>
            </header>
            <div className="mt-[clamp(20px,3.4dvh,36px)] grid gap-40 border-y border-border-subtle py-[clamp(16px,2.6dvh,28px)] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.75fr)] lg:gap-56">
              <ol className="min-w-0 divide-y divide-border-subtle">
                {decadeAiGap.steps.map((step, index) => (
                  <li key={step.title} className="grid grid-cols-[52px_minmax(0,1fr)] gap-16 py-[clamp(12px,2dvh,20px)] first:pt-0 last:pb-0">
                    <span className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</span>
                    <div className="min-w-0">
                      <h2 className="text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{step.title}</h2>
                      <p className="mt-8 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="border-t border-border-subtle pt-24 lg:border-l lg:border-t-0 lg:pl-40 lg:pt-0">
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeAiGap.rules.label}</p>
                <ul className="mt-16 space-y-12">
                  {decadeAiGap.rules.items.map((item) => (
                    <li key={item} className="text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">— {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      }
      if (stepIndex === 1) {
        return (
          <div className="grid h-full min-h-0 gap-40 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,.5fr)_minmax(0,1.5fr)] lg:gap-56">
            <div className="flex min-w-0 flex-col justify-center">
              <SlideTitle label={decadeStorybook.label} title={decadeStorybook.title} />
            </div>
            <Shot images={decadeStorybook.images} />
          </div>
        )
      }
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeDemo.label} title={decadeDemo.title} description={decadeDemo.lead} />
          <div className="mt-[clamp(20px,3.2dvh,34px)] grid gap-40 border-y border-border-subtle py-[clamp(16px,2.6dvh,28px)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)] lg:gap-56">
            <div className="min-w-0">
              <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeDemo.listLabel}</p>
              <ol className="mt-16 divide-y divide-border-subtle">
                {decadeDemo.items.map((item, index) => (
                  <li key={item.title} className="grid grid-cols-[52px_minmax(0,1fr)] gap-16 py-[clamp(12px,2dvh,20px)] first:pt-0 last:pb-0">
                    <span className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</span>
                    <div className="min-w-0">
                      <h2 className="text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{item.title}</h2>
                      <p className="mt-8 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="border-t border-border-subtle pt-24 lg:border-l lg:border-t-0 lg:pl-40 lg:pt-0">
              <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeDemo.aside.label}</p>
              <p className="mt-16 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{decadeDemo.aside.detail}</p>
              <p className="mt-16 text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">{decadeDemo.aside.note}</p>
              <p className="mt-20 border-t border-border-subtle pt-20 text-deck-body-m font-bold leading-[1.6] text-text-pri md:text-deck-body-d">
                {decadeDemo.aside.quote.join(' ')}
              </p>
            </div>
          </div>
          <NoteLine className="border-t-0 pt-0">{decadeDemo.footer}</NoteLine>
        </div>
      )
    }

    if (slide.id === 'decade-career') {
      if (stepIndex === 0) return <PartCover part={decadeParts.career} />
      if (stepIndex === 1) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={decadeJobMap.label} title={decadeJobMap.title} description={decadeJobMap.lead} />
            <NumberedGrid items={decadeJobMap.groups} columns={4} reducedMotion={reducedMotion} />
            <NoteLine className="border-t-0 pt-0">{decadeJobMap.footer}</NoteLine>
          </div>
        )
      }
      if (stepIndex === 2) {
        return (
          <div className="grid h-full min-h-0 gap-40 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)] lg:gap-56">
            <div className="flex min-w-0 flex-col justify-center">
              <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeSolopreneurShot.label}</p>
              <h1 className="mt-20 text-deck-title-m font-bold leading-[1.3] text-text-pri md:mt-24 md:text-[clamp(32px,4.45dvh,48px)]">
                {decadeSolopreneurShot.title}
              </h1>
              <p className="mt-[clamp(20px,3dvh,32px)] break-all border-t border-border-subtle pt-20 text-small-m leading-[1.65] text-text-meta md:text-small-d">
                {decadeSolopreneurShot.source}
              </p>
            </div>
            <Shot images={[{ src: decadeSolopreneurShot.image, alt: decadeSolopreneurShot.alt }]} />
          </div>
        )
      }
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeThenNow.label} title={decadeThenNow.title} description={decadeThenNow.lead} />
          <div className="mt-[clamp(20px,3.2dvh,34px)] grid gap-40 border-y border-border-subtle py-[clamp(18px,2.8dvh,30px)] lg:grid-cols-[minmax(0,.62fr)_minmax(0,1.38fr)] lg:gap-56">
            <div className="min-w-0">
              <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeThenNow.past.year}</p>
              <ul className="mt-16 space-y-10">
                {decadeThenNow.past.lines.map((line) => (
                  <li key={line} className="text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">— {line}</li>
                ))}
              </ul>
              <p className="mt-20 border-t border-border-subtle pt-16 text-body-l-m leading-[1.7] text-text-meta md:text-body-l-d">
                {decadeThenNow.past.note.join(' ')}
              </p>
            </div>
            <div className="border-t border-border-subtle pt-24 lg:border-l lg:border-t-0 lg:pl-40 lg:pt-0">
              <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{decadeThenNow.present.year}</p>
              <div className="mt-16 grid gap-x-40 gap-y-[clamp(12px,2dvh,20px)] sm:grid-cols-2 lg:grid-cols-3">
                {decadeThenNow.present.items.map((item) => (
                  <div key={item.title} className="min-w-0">
                    <h2 className="text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{item.title}</h2>
                    <p className="mt-8 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <NoteLine className="border-t-0 pt-0">{decadeThenNow.footer}</NoteLine>
        </div>
      )
    }

    if (slide.id === 'decade-vision') {
      if (stepIndex === 0) return <PartCover part={decadeParts.vision} />
      if (stepIndex === 1) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={decadeCompetency.label} title={decadeCompetency.title} description={decadeCompetency.lead} />
            <p className="mt-[clamp(18px,2.8dvh,30px)] border-y border-border-subtle py-16 font-mono text-deck-meta-m leading-[1.7] text-text-sec md:text-deck-meta-d">
              {decadeCompetency.flow.join('  \u203a  ')}
            </p>
            <NumberedGrid items={decadeCompetency.items} columns={5} reducedMotion={reducedMotion} />
            <NoteLine className="border-t-0 pt-0">{decadeCompetency.footer}</NoteLine>
          </div>
        )
      }
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeSolopreneur.label} title={decadeSolopreneur.title} />
          <p className="mt-[clamp(20px,3dvh,32px)] border-l border-border-strong pl-28 text-deck-title-m font-bold leading-[1.4] text-text-pri md:pl-40 md:text-deck-title-d">
            {decadeSolopreneur.definition}
          </p>
          <div className="mt-[clamp(20px,3.2dvh,34px)] grid gap-40 border-y border-border-subtle py-[clamp(18px,2.8dvh,30px)] lg:grid-cols-2 lg:gap-56">
            {decadeSolopreneur.blocks.map((block, index) => (
              <div key={block.title} className={`min-w-0 ${index === 1 ? 'border-t border-border-subtle pt-24 lg:border-l lg:border-t-0 lg:pl-40 lg:pt-0' : ''}`}>
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">{block.title}</p>
                <ul className="mt-16 space-y-12">
                  {block.lines.map((line) => (
                    <li key={line} className="text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">— {line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <NoteLine className="border-t-0 pt-0">{decadeSolopreneur.footer}</NoteLine>
        </div>
      )
    }

    if (slide.id === 'decade-reverse') {
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeReverse.label} title={decadeReverse.title} description={decadeReverse.lead} />
          <div className="mt-[clamp(20px,3.4dvh,36px)] grid gap-40 border-y border-border-subtle py-[clamp(18px,2.8dvh,30px)] lg:grid-cols-2 lg:gap-56">
            {decadeReverse.blocks.map((block, index) => (
              <div key={block.title} className={`min-w-0 ${index === 1 ? 'border-t border-border-subtle pt-24 lg:border-l lg:border-t-0 lg:pl-40 lg:pt-0' : ''}`}>
                <h2 className="text-deck-title-m font-bold leading-[1.3] text-text-pri md:text-deck-title-d">{block.title}</h2>
                <p className="mt-12 text-deck-body-m leading-[1.6] text-text-meta md:text-deck-body-d">{block.subtitle}</p>
                <ul className="mt-20 space-y-12">
                  {block.lines.map((line) => (
                    <li key={line} className="text-body-l-m leading-[1.7] text-text-sec md:text-body-l-d">— {line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <NoteLine className="border-t-0 pt-0">{decadeReverse.footer}</NoteLine>
        </div>
      )
    }

    if (slide.id === 'decade-wrapup') {
      if (stepIndex === 0) {
        return (
          <div className="flex h-full flex-col justify-center">
            <SlideTitle label={decadeWrapUp.label} title={decadeWrapUp.title} />
            <EntryList
              className="mt-[clamp(20px,3.2dvh,34px)]"
              items={decadeWrapUp.items.map((item) => ({ ...item, id: item.title }))}
              renderItem={(item, index) => (
                <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-16 md:gap-24">
                  <span className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">0{index + 1}</span>
                  <div className="min-w-0">
                    <h2 className="text-deck-body-m font-bold leading-[1.5] text-text-pri md:text-deck-body-d">{item.title}</h2>
                    <p className="mt-8 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{item.detail}</p>
                  </div>
                </div>
              )}
            />
          </div>
        )
      }
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={decadeNext.label} title={decadeNext.title} description={decadeNext.lead} />
          <NumberedGrid items={decadeNext.items} columns={3} reducedMotion={reducedMotion} />
          <p className="mt-[clamp(24px,4dvh,44px)] text-deck-display-m font-bold leading-[1.2] text-text-pri md:text-deck-display-d">
            {decadeNext.closing}
          </p>
        </div>
      )
    }

    if (slide.id === 'council') {
      const leaders = (council?.members ?? []).slice(0, 2)
      return (
        <div className="grid h-full items-center gap-40 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <SlideTitle label={slide.label} title={council?.title || council?.name || '운영위원회'} description={council?.intro} />
          <EntryList
            items={leaders}
            renderItem={(member) => <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-24"><dt className="font-mono text-deck-meta-m text-text-meta md:text-deck-meta-d">{member.role}</dt><dd><p className="text-deck-body-m font-bold leading-[1.55] text-text-pri md:text-deck-body-d">{member.name}</p>{member.majors && <p className="mt-6 text-body-l-m leading-[1.65] text-text-sec md:text-body-l-d">{member.majors}</p>}</dd></div>}
          />
        </div>
      )
    }

    if (slide.id === 'clubs') {
      const current = clubs.slice(stepIndex * 2, (stepIndex + 1) * 2)
      return (
        <div className="flex h-full flex-col justify-center">
          <SlideTitle label={slide.label} title="네 개의 동아리가 각자의 방식으로 전공을 확장합니다." />
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
        <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">디지털인문예술전공</p>
        <h1 className="mt-28 max-w-6xl text-deck-display-m font-bold leading-[1.2] tracking-normal text-text-pri md:text-deck-display-d">당신의 질문에서<br />다음 프로젝트가 시작됩니다.</h1>
        <p className="mt-32 max-w-3xl text-deck-body-m leading-[1.7] text-text-sec md:text-deck-body-d">한림대학교 디지털인문예술전공</p>
      </div>
    )
  }

  return (
    <>
      {!isPreviewFrame && (
        <div className={mobilePresentation ? 'hidden' : 'hidden max-md:portrait:block'}>
          <MobilePreview onPresent={openMobilePresentation} />
        </div>
      )}
    <main
      ref={rootRef}
      className={`relative h-dvh w-full touch-none overflow-hidden bg-bg-base ${isPreviewFrame || mobilePresentation ? '' : 'max-md:portrait:hidden'}`}
      aria-label="디지털인문예술전공 전공 나침반"
      onWheel={(event) => {
        if (isPreviewFrame) return
        event.preventDefault()
        if (mapOpen) return
        if (Math.abs(event.deltaY) < 12) return
        moveWithLock(event.deltaY > 0 ? next : previous)
      }}
      onPointerMove={isPreviewFrame ? undefined : (event) => setPointer({ x: (event.clientX / window.innerWidth) * 100, y: (event.clientY / window.innerHeight) * 100 })}
      onTouchStart={(event) => { touchStartY.current = event.changedTouches[0]?.clientY ?? null }}
      onTouchEnd={(event) => {
        if (isPreviewFrame) return
        if (mapOpen) return
        const end = event.changedTouches[0]?.clientY
        if (touchStartY.current === null || end === undefined) return
        const distance = touchStartY.current - end
        if (Math.abs(distance) > 36) moveWithLock(distance > 0 ? next : previous)
        touchStartY.current = null
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-nebula-soft opacity-80" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(36rem circle at ${pointer.x}% ${pointer.y}%, rgb(var(--dah-purple-primary) / .08), transparent 62%)` }} />

      {!isPreviewFrame && (
        <>
          <Link to="/resources/major-compass" aria-label="전공 나침반 자료 상세로 돌아가기" className="absolute left-16 top-20 z-30 inline-flex h-40 w-40 items-center justify-center border border-border-subtle text-text-sec transition-colors duration-fast ease-out hover:border-border-strong hover:text-text-pri md:left-24 md:top-24 lg:left-32">
            <X size={16} aria-hidden="true" />
          </Link>
          <motion.button
            type="button"
            onClick={() => setMapOpen(true)}
            aria-label="전체 발표 주제 열기"
            whileHover={reducedMotion ? undefined : { scale: 1.06 }}
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-[max(20px,env(safe-area-inset-bottom))] right-[max(20px,env(safe-area-inset-right))] z-40 inline-flex h-56 w-56 items-center justify-center rounded-full border border-purple-light/50 bg-purple-primary text-text-pri shadow-btn transition-colors duration-fast ease-out hover:bg-purple-light md:bottom-32 md:right-32"
          >
            <LayoutGrid size={20} aria-hidden="true" />
          </motion.button>
        </>
      )}

      {/* 패딩은 slide 단위(motion.div)에 붙인다. section에 붙이면 AnimatePresence가 보존하는
          퇴장 중인 이전 슬라이드까지 현재 슬라이드의 패딩을 공유해, 표지(p-0) ↔ 본문(유무)
          사이를 오가가는 순간만 퇴장 컸텐츠에 새 패딩이 먹허 보이며 전환이 튀거리는 문제가 있었다. */}
      <section className="relative z-10 h-full">
        <AnimatePresence mode="sync" custom={direction}>
          <motion.div
            key={`${slide.id}-${stepIndex}`}
            custom={direction}
            variants={slideMotion}
            initial={reducedMotion ? false : 'enter'}
            animate={reducedMotion ? { opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' } : 'center'}
            exit={reducedMotion ? undefined : 'exit'}
            className={`relative h-full overflow-hidden ${slide.id === 'cover' ? 'p-0' : 'px-[clamp(24px,6.7vw,128px)] py-[clamp(48px,8dvh,88px)]'}`}
          >
            {!reducedMotion && (
              <motion.div
                aria-hidden="true"
                initial={{ opacity: 0, x: direction > 0 ? '45%' : '-45%' }}
                animate={{ opacity: [0, 0.09, 0], x: direction > 0 ? '-45%' : '45%' }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none absolute inset-y-0 z-0 w-1/3 bg-gradient-to-r from-transparent via-purple-primary/30 to-transparent blur-3xl"
              />
            )}
            <div className="relative z-10 h-full">{renderSlide()}</div>
          </motion.div>
        </AnimatePresence>
      </section>

      {!isPreviewFrame && (
        <AnimatePresence>
          {mapOpen && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="전체 발표 주제"
            initial={reducedMotion ? false : { opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.994 }}
            transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 z-50 overflow-y-auto bg-bg-base/95 px-[clamp(24px,6.7vw,128px)] py-[clamp(48px,8dvh,88px)] backdrop-blur-glass"
          >
            <div className="flex items-start justify-between gap-24">
              <div>
                <p className="font-mono text-deck-meta-m font-bold tracking-label text-text-meta md:text-deck-meta-d">전체 주제</p>
                <h2 className="mt-16 text-deck-title-m font-bold leading-[1.25] text-text-pri md:text-deck-title-d">원하는 주제로 바로 이동합니다.</h2>
              </div>
              <button type="button" onClick={() => setMapOpen(false)} aria-label="발표 주제 닫기" className="inline-flex h-40 w-40 shrink-0 items-center justify-center border border-border-subtle text-text-sec transition-colors duration-fast ease-out hover:border-border-strong hover:text-text-pri">
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="전체 발표 주제" className="mt-[clamp(32px,6dvh,64px)] grid grid-cols-2 gap-12 sm:grid-cols-3 md:gap-16 lg:grid-cols-4 xl:grid-cols-7">
              {SLIDES.map((item, index) => (
                <motion.button
                  key={item.id}
                  type="button"
                  onClick={() => jumpTo(index)}
                  aria-current={index === slideIndex ? 'page' : undefined}
                  initial={reducedMotion ? false : { opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.3, delay: reducedMotion ? 0 : index * 0.018, ease: [0.16, 1, 0.3, 1] }}
                  className={`group flex h-[clamp(104px,14dvh,144px)] items-center border px-16 text-left transition-colors duration-fast ease-out md:px-20 ${index === slideIndex ? 'border-purple-light bg-purple-primary/10' : 'border-border-subtle hover:border-border-strong hover:bg-bg-elev'}`}
                >
                  <strong className="block text-body-l-m font-bold leading-[1.5] text-text-pri md:text-body-l-d">{item.label}</strong>
                </motion.button>
              ))}
            </nav>
          </motion.div>
          )}
        </AnimatePresence>
      )}
    </main>
    </>
  )
}

export default MajorCompassExperience
