import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Link from '../components/common/LangLink'
import GlassCard from '../components/common/GlassCard'
import ImageFrame from '../components/common/ImageFrame'
import Tag from '../components/common/Tag'
import Button from '../components/common/Button'
import { useApi } from '../hooks/useApi'
import { ABOUT_COPY } from './About'
import { tracks, codeSharing } from '../data/tracks'
import { curriculum } from '../data/curriculum'
import { nanodegree } from '../data/nanodegree'
import { professors as fallbackProfessors } from '../data/professors'
import { achievements } from '../data/achievements'
import { careers } from '../data/careers'
import { councils } from '../data/council'
import { clubs as fallbackClubs } from '../data/clubs'

const EXHIBITION_FALLBACKS = [
  ['2026-1', 'Against Flow'], ['2025-2', '프로젝트 전시회'], ['2025-1', '프로젝트 전시회'],
  ['2024-2', '프로젝트 전시회'], ['2024-1', '프로젝트 전시회'], ['2023-2', '프로젝트 전시회'],
].map(([semester, title]) => ({ id: semester, title, semester_label: semester, poster_url: `/images/exhibitions/${semester}.webp` }))

const CONTEST_FALLBACKS = [
  ['poster-2026-1', '2026-1 포스터 공모전'], ['bookplate-2026-1', '2026-1 장서표 공모전'],
  ['poster-2025-2', '2025-2 포스터 공모전'], ['bookplate-2025-2', '2025-2 장서표 공모전'],
].map(([id, title]) => ({ id, title, poster_url: `/images/contests/${id.replace(/-(\d{4}-\d)$/, '-contest-$1')}.webp` }))

const CAMERA = {
  still: [{ x: 0, y: 0, scale: 1 }],
  horizontal: [{ x: 0, y: 0, scale: 1 }, { x: '13%', y: 0, scale: 1.35 }, { x: '-13%', y: 0, scale: 1.35 }, { x: 0, y: 0, scale: 1 }],
  vertical: [{ x: 0, y: 0, scale: 1 }, { x: 0, y: '11%', scale: 1.3 }, { x: 0, y: '-11%', scale: 1.3 }, { x: 0, y: 0, scale: 1 }],
}

const SCENES = [
  ['cover', 'DIGITAL ARTS & HUMANITIES', CAMERA.still], ['about', 'ABOUT', CAMERA.horizontal],
  ['curriculum', 'CURRICULUM', CAMERA.horizontal], ['codesharing', 'CODE SHARING', CAMERA.horizontal],
  ['nanodegree', 'NANODEGREE', CAMERA.horizontal], ['faculty', 'FACULTY', CAMERA.horizontal],
  ['exhibitions', 'EXHIBITIONS', CAMERA.horizontal], ['contests', 'CONTESTS', CAMERA.horizontal],
  ['achievements', 'ACHIEVEMENTS', CAMERA.vertical], ['careers', 'CAREERS', CAMERA.horizontal],
  ['council', 'STUDENT COUNCIL', CAMERA.vertical], ['clubs', 'CLUBS', CAMERA.horizontal],
  ['closing', 'DIGITAL ARTS & HUMANITIES', CAMERA.still],
].map(([id, label, camera]) => ({ id, label, camera }))

function professorOf(person) {
  return { id: person.id, name: person.name_ko ?? person.nameKr ?? '', role: person.title_ko ?? person.role ?? '', affiliation: person.affiliation ?? '', photo: person.photo_url ?? '', hasBg: Boolean(person.has_bg) }
}

function SceneTitle({ number, label, title, description }) {
  return <div className="flex min-w-0 flex-col gap-8"><div className="flex items-center gap-12 font-mono text-caption-m text-text-meta"><span>{String(number).padStart(2, '0')}</span><span>{label}</span></div><h1 className="text-h1-m font-bold leading-relaxed tracking-display text-text-pri md:text-h1-d">{title}</h1>{description && <p className="max-w-lead text-body-m leading-relaxed text-text-sec md:text-body-d">{description}</p>}</div>
}

function MajorCompassExperience() {
  const rootRef = useRef(null)
  const reducedMotion = useReducedMotion()
  const [sceneIndex, setSceneIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const { data: facultyData } = useApi('/content/professors', { params: { pageSize: 100 } })
  const { data: exhibitionData } = useApi('/content/exhibitions', { params: { pageSize: 100 } })
  const { data: contestData } = useApi('/content/contest', { params: { pageSize: 100 } })
  const { data: councilData } = useApi('/content/council', { params: { pageSize: 100 } })
  const { data: clubData } = useApi('/content/club', { params: { pageSize: 100 } })
  const faculty = useMemo(() => (facultyData?.items?.length ? facultyData.items : fallbackProfessors).map(professorOf), [facultyData])
  const exhibitions = exhibitionData?.items?.length ? exhibitionData.items.slice(0, 6) : EXHIBITION_FALLBACKS
  const contests = contestData?.items?.length ? contestData.items.slice(0, 4) : CONTEST_FALLBACKS
  const council = councilData?.items?.[0] ?? councils[0]
  const clubs = clubData?.items?.length ? clubData.items : fallbackClubs
  const scene = SCENES[sceneIndex]
  const camera = scene.camera[stepIndex]
  const atStart = sceneIndex === 0 && stepIndex === 0
  const atEnd = sceneIndex === SCENES.length - 1 && stepIndex === scene.camera.length - 1
  const next = useCallback(() => { if (stepIndex < scene.camera.length - 1) setStepIndex((v) => v + 1); else if (sceneIndex < SCENES.length - 1) { setSceneIndex((v) => v + 1); setStepIndex(0) } }, [scene.camera.length, sceneIndex, stepIndex])
  const previous = useCallback(() => { if (stepIndex > 0) setStepIndex((v) => v - 1); else if (sceneIndex > 0) { setSceneIndex((v) => v - 1); setStepIndex(SCENES[sceneIndex - 1].camera.length - 1) } }, [sceneIndex, stepIndex])

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName))) return
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else rootRef.current?.requestFullscreen().catch(() => {}) }
      if (event.repeat) return
      if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); next() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); previous() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [next, previous])

  const title = (number, label, heading, description) => <SceneTitle number={number} label={label} title={heading} description={description} />
  const renderScene = () => {
    if (scene.id === 'cover') return <div className="flex h-full flex-col justify-center gap-24"><p className="font-mono text-caption-m text-text-meta">2026 자유전공학부 전공 나침반</p><h1 className="max-w-lead text-displayL-m font-bold leading-relaxed tracking-display text-text-pri md:text-displayL-d">사람을 이해하고, 디지털로 미래를 만듭니다.</h1><p className="max-w-lead text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">한림대학교 디지털인문예술전공</p></div>
    if (scene.id === 'about') return <div className="grid h-full grid-cols-1 items-center gap-40 lg:grid-cols-2">{title(2, scene.label, '인문학의 질문에 기술과 디자인의 실행력을 더합니다.', ABOUT_COPY.ko.what)}<div className="grid gap-16">{ABOUT_COPY.ko.vision.map((item) => <GlassCard key={item.title} className="p-20 md:p-24"><h2 className="text-h3-m font-bold leading-relaxed text-text-pri md:text-h3-d">{item.title}</h2><p className="mt-8 text-small-m leading-relaxed text-text-sec md:text-small-d">{item.desc}</p></GlassCard>)}</div></div>
    if (scene.id === 'curriculum') return <div className="flex h-full flex-col gap-24">{title(3, scene.label, '세 개의 트랙을 연결해 나만의 전공을 설계합니다.')}<div className="grid flex-1 grid-cols-1 gap-16 lg:grid-cols-3 md:gap-24">{tracks.map((track) => <GlassCard key={track.id} className="flex min-w-0 flex-col p-20 md:p-24"><p className="font-mono text-caption-m text-text-meta">{track.no}</p><h2 className="mt-8 text-h2-m font-bold leading-relaxed text-text-pri md:text-h2-d">{track.name}</h2><p className="mt-12 text-small-m leading-relaxed text-text-sec md:text-small-d">{track.summary}</p><div className="mt-16 flex flex-wrap gap-8">{track.keywords.map((word) => <Tag key={word}>{word}</Tag>)}</div><ul className="mt-16 grid grid-cols-2 gap-x-12 gap-y-4 border-t border-border-subtle pt-16">{curriculum.filter((course) => course.track === track.id).map((course) => <li key={`${course.name}-${course.semester}`} className="text-caption-m leading-relaxed text-text-meta">{course.name}</li>)}</ul></GlassCard>)}</div></div>
    if (scene.id === 'codesharing') return <div className="grid h-full grid-cols-1 items-center gap-40 lg:grid-cols-2">{title(4, scene.label, '다른 전공의 배움도 디인예의 역량으로 연결합니다.', codeSharing.definition)}<div className="flex flex-col gap-24"><ol className="grid grid-cols-2 gap-16">{codeSharing.steps.map((item, index) => <GlassCard key={item} className="p-20"><span className="font-mono text-caption-m text-text-meta">{String(index + 1).padStart(2, '0')}</span><p className="mt-8 text-body-m leading-relaxed text-text-pri md:text-body-d">{item}</p></GlassCard>)}</ol><p className="text-small-m leading-relaxed text-text-sec md:text-small-d">최대 9학점 인정 · 인정 학과 {codeSharing.departments.length}개</p><div className="flex flex-wrap gap-8">{codeSharing.departments.slice(0, 10).map((item) => <Tag key={item}>{item}</Tag>)}</div></div></div>
    if (scene.id === 'nanodegree') return <div className="flex h-full flex-col gap-24">{title(5, scene.label, '현장 실무 중심의 네 가지 집중 교육과정', `${nanodegree.intro} ${nanodegree.cert}`)}<div className="grid flex-1 grid-cols-1 gap-16 lg:grid-cols-4 md:gap-24">{nanodegree.programs.map((program) => <GlassCard key={program.name} className="p-20"><h2 className="text-h3-m font-bold leading-relaxed text-text-pri md:text-h3-d">{program.name}</h2><p className="mt-8 text-small-m leading-relaxed text-text-sec md:text-small-d">{program.criteria} · {program.partner}</p><ul className="mt-16 flex flex-col gap-8 border-t border-border-subtle pt-16">{program.courses.map((course) => <li key={course.code} className="text-small-m leading-relaxed text-text-pri md:text-small-d">{course.name}</li>)}</ul></GlassCard>)}</div></div>
    if (scene.id === 'faculty') return <div className="flex h-full flex-col gap-20">{title(6, scene.label, '서로 다른 전문성이 하나의 융합 교육을 만듭니다.')}<div className="grid flex-1 grid-cols-2 gap-12 lg:grid-cols-4 lg:gap-16">{faculty.map((person) => <GlassCard key={person.id} className="flex min-w-0 items-center gap-12 p-12"><ImageFrame src={person.photo || undefined} alt={`${person.name} 교수 사진`} ratio="306/427" contain bg={person.hasBg} className="w-80 shrink-0 md:w-96" placeholder={person.name} /><div className="min-w-0"><h2 className="text-h3-m font-bold leading-relaxed text-text-pri md:text-h3-d">{person.name}</h2>{person.role && <p className="mt-4 text-small-m leading-relaxed text-text-sec md:text-small-d">{person.role}</p>}</div></GlassCard>)}</div></div>
    if (scene.id === 'exhibitions') return <div className="flex h-full flex-col gap-20">{title(7, scene.label, '수업의 끝은 전시의 시작입니다.', '매 학기 프로젝트의 결과를 전시로 공개하고 다음 작업으로 연결합니다.')}<div className="grid flex-1 grid-cols-3 gap-16 lg:grid-cols-6">{exhibitions.map((item) => <div key={item.id} className="min-w-0"><ImageFrame src={item.poster_url} alt={`${item.title} 포스터`} ratio="2/3" placeholder={item.title} /><p className="mt-8 font-mono text-caption-m text-text-meta">{item.semester_label}</p><h2 className="mt-4 text-small-m font-bold leading-relaxed text-text-pri md:text-small-d">{item.title}</h2></div>)}</div></div>
    if (scene.id === 'contests') return <div className="grid h-full grid-cols-1 items-center gap-40 lg:grid-cols-2">{title(8, scene.label, '교실 밖의 주제에 답하고 결과를 공개합니다.', '포스터와 장서표 공모전을 통해 기획·시각화·콘텐츠 제작 역량을 실제 결과물로 완성합니다.')}<div className="grid grid-cols-4 gap-16">{contests.map((item) => <div key={item.id} className="min-w-0"><ImageFrame src={item.poster_url} alt={`${item.title} 포스터`} ratio="2/3" placeholder={item.title} /><h2 className="mt-8 text-small-m font-bold leading-relaxed text-text-pri md:text-small-d">{item.title_ko || item.title}</h2></div>)}</div></div>
    if (scene.id === 'achievements') return <div className="flex h-full flex-col gap-20">{title(9, scene.label, '학생 성과는 최신 기록부터 이어집니다.', '특정 수상 하나를 반복하지 않고 사이트에 등록된 최신 성과를 순서대로 보여줍니다.')}<div className="grid flex-1 grid-cols-2 gap-x-24 gap-y-12 lg:grid-cols-3">{achievements.slice(0, 12).map((item) => <GlassCard key={item.id} className="p-16"><p className="font-mono text-caption-m text-text-meta">{item.year}</p><h2 className="mt-4 text-small-m font-bold leading-relaxed text-text-pri md:text-small-d">{item.title}</h2>{item.awardees && <p className="mt-4 text-caption-m leading-relaxed text-text-sec">{item.awardees}</p>}</GlassCard>)}</div></div>
    if (scene.id === 'careers') return <div className="flex h-full flex-col gap-20">{title(10, scene.label, '전공의 경험은 다양한 직무와 대학원으로 이어집니다.')}<div className="grid flex-1 grid-cols-3 gap-12 lg:grid-cols-5">{careers.map((item) => <GlassCard key={item.id} className="p-12"><h2 className="text-small-m font-bold leading-relaxed text-text-pri md:text-small-d">{item.name}</h2><p className="mt-4 text-caption-m leading-relaxed text-text-sec">{item.company}</p>{item.role && <p className="mt-4 text-caption-m leading-relaxed text-text-meta">{item.role}</p>}</GlassCard>)}</div></div>
    if (scene.id === 'council') return <div className="grid h-full grid-cols-1 items-center gap-40 lg:grid-cols-2">{title(11, scene.label, council.name || council.title, council.intro)}<dl className="grid grid-cols-2 gap-x-24 border-t border-border-subtle">{(council.members ?? []).map((member) => { const item = typeof member === 'string' ? { name: member } : member; return <div key={`${item.role}-${item.name}`} className="flex gap-12 border-b border-border-subtle py-12"><dt className="w-80 shrink-0 font-mono text-caption-m leading-relaxed text-text-meta">{item.role}</dt><dd className="text-small-m leading-relaxed text-text-pri md:text-small-d">{item.name}</dd></div> })}</dl></div>
    if (scene.id === 'clubs') return <div className="flex h-full flex-col gap-24">{title(12, scene.label, '학생이 직접 기획하고 운영하는 네 개의 동아리')}<div className="grid flex-1 grid-cols-2 gap-16 lg:grid-cols-4 md:gap-24">{clubs.map((club) => { const clubTitle = club.title_ko || club.title || club.name; const intro = club.intro || club.body?.intro; return <GlassCard key={club.id} className="flex min-w-0 flex-col p-16 md:p-20"><ImageFrame src={club.poster_url || undefined} alt={`${clubTitle} 로고`} ratio="4/3" contain bg={Boolean(club.has_bg)} placeholder={clubTitle} /><h2 className="mt-12 text-h3-m font-bold leading-relaxed text-text-pri md:text-h3-d">{clubTitle}</h2>{club.tag && <div className="mt-8"><Tag>{club.tag}</Tag></div>}{intro && <p className="mt-12 text-small-m leading-relaxed text-text-sec md:text-small-d">{intro}</p>}</GlassCard> })}</div></div>
    return <div className="flex h-full flex-col items-start justify-center gap-24">{title(13, scene.label, '당신의 질문에서 다음 프로젝트가 시작됩니다.', '한림대학교 디지털인문예술전공')}<Button variant="secondary" href="/resources">자료실로 돌아가기</Button></div>
  }

  const transition = reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 80, damping: 22 }
  return <main ref={rootRef} className="relative h-screen w-screen overflow-hidden bg-bg-base"><Link to="/resources/major-compass" aria-label="전공 나침반 상세로 돌아가기" className="absolute left-gutter-m top-24 z-30 inline-flex h-11 w-11 items-center justify-center rounded-sm border border-glass-line bg-glass-bg text-text-pri md:left-gutter-t lg:left-gutter-d"><X size={16} aria-hidden="true" /></Link><div className="absolute inset-x-gutter-m top-24 z-20 flex justify-end md:inset-x-gutter-t lg:inset-x-gutter-d"><p className="font-mono text-caption-m text-text-meta">{sceneIndex + 1} / {SCENES.length} · {stepIndex + 1} / {scene.camera.length}</p></div><div className="absolute inset-0 overflow-hidden px-gutter-m pb-80 pt-80 md:px-gutter-t lg:px-gutter-d"><AnimatePresence mode="wait"><motion.section key={scene.id} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reducedMotion ? undefined : { opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.25 }} className="h-full w-full"><motion.div animate={camera} transition={transition} className="h-full w-full origin-center">{renderScene()}</motion.div></motion.section></AnimatePresence></div><div className="absolute inset-x-gutter-m bottom-24 z-30 flex items-center justify-between md:inset-x-gutter-t lg:inset-x-gutter-d"><p className="font-mono text-caption-m text-text-meta">← → · Space · F</p><div className="flex gap-8"><Button variant="secondary" onClick={previous} disabled={atStart}><ChevronLeft size={16} aria-hidden="true" />이전</Button><Button variant="secondary" onClick={next} disabled={atEnd}>다음<ChevronRight size={16} aria-hidden="true" /></Button></div></div></main>
}

export default MajorCompassExperience
