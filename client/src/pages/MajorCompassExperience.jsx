import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import GlassCard from '../components/common/GlassCard'
import ImageFrame from '../components/common/ImageFrame'
import Tag from '../components/common/Tag'
import Button from '../components/common/Button'
import { useApi } from '../hooks/useApi'
import { professors as fallbackProfessors } from '../data/professors'
import { councils } from '../data/council'
import { clubs as fallbackClubs } from '../data/clubs'

const CAMERA_STEPS = {
  cover: [{ x: 0, y: 0, scale: 1 }],
  faculty: [
    { x: 0, y: 0, scale: 1 },
    { x: '10%', y: '4%', scale: 1.45 },
    { x: '-10%', y: '-4%', scale: 1.45 },
    { x: 0, y: 0, scale: 1 },
  ],
  community: [
    { x: 0, y: 0, scale: 1 },
    { x: '12%', y: 0, scale: 1.4 },
    { x: '-12%', y: 0, scale: 1.4 },
  ],
}

function professorOf(person) {
  return {
    id: person.id,
    name: person.name_ko ?? person.nameKr ?? '',
    role: person.title_ko ?? person.role ?? '',
    photo: person.photo_url ?? '',
    hasBg: Boolean(person.has_bg),
  }
}

function SceneHeader({ number, label }) {
  return <header className="flex items-center justify-between gap-16 border-b border-border-subtle pb-16 font-mono text-caption-m text-text-meta"><span>{String(number).padStart(2, '0')}</span><span>{label}</span></header>
}

function MajorCompassExperience() {
  const rootRef = useRef(null)
  const reducedMotion = useReducedMotion()
  const [sceneIndex, setSceneIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const { data: facultyData } = useApi('/content/professors', { params: { pageSize: 100 } })
  const { data: councilData } = useApi('/content/council', { params: { pageSize: 100 } })
  const { data: clubData } = useApi('/content/club', { params: { pageSize: 100 } })
  const faculty = useMemo(() => (facultyData?.items?.length ? facultyData.items : fallbackProfessors).map(professorOf), [facultyData])
  const council = councilData?.items?.[0] ?? councils[0]
  const clubs = clubData?.items?.length ? clubData.items : fallbackClubs

  const scenes = [
    { id: 'cover', label: 'DIGITAL ARTS & HUMANITIES', steps: CAMERA_STEPS.cover },
    { id: 'faculty', label: 'FACULTY', steps: CAMERA_STEPS.faculty },
    { id: 'community', label: 'STUDENT COMMUNITY', steps: CAMERA_STEPS.community },
  ]
  const scene = scenes[sceneIndex]
  const camera = scene.steps[stepIndex]

  const next = () => {
    if (stepIndex < scene.steps.length - 1) return setStepIndex((value) => value + 1)
    if (sceneIndex < scenes.length - 1) { setSceneIndex((value) => value + 1); setStepIndex(0) }
  }
  const previous = () => {
    if (stepIndex > 0) return setStepIndex((value) => value - 1)
    if (sceneIndex > 0) { const before = scenes[sceneIndex - 1]; setSceneIndex((value) => value - 1); setStepIndex(before.steps.length - 1) }
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        else rootRef.current?.requestFullscreen().catch(() => {})
      }
      if (event.repeat) return
      if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); next() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); previous() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sceneIndex, stepIndex])

  const transition = reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 20 }
  return (
    <main ref={rootRef} className="flex min-h-screen items-center overflow-hidden bg-bg-base px-gutter-m py-24 md:px-gutter-t lg:px-gutter-d">
      <div className="mx-auto flex w-full max-w-container flex-col gap-16">
        <div className="relative aspect-auto min-h-480 overflow-hidden rounded-glass border border-glass-line bg-glass-bg p-20 shadow-glass sm:p-24 lg:aspect-video lg:min-h-0 lg:p-40">
          <motion.div animate={camera} transition={transition} className="origin-center">
            {scene.id === 'cover' && <div className="flex min-h-400 flex-col justify-center gap-24"><SceneHeader number={1} label={scene.label} /><p className="font-mono text-caption-m text-text-meta">2026 자유전공학부 전공 나침반</p><h1 className="max-w-lead text-displayL-m font-bold leading-relaxed tracking-display text-text-pri md:text-displayL-d">사람을 이해하고, 디지털로 미래를 만듭니다.</h1><p className="max-w-lead text-body-l-m leading-relaxed text-text-sec md:text-body-l-d">디지털인문예술전공은 인문학의 질문, 기술의 가능성, 디자인의 실행력을 함께 다룹니다.</p></div>}
            {scene.id === 'faculty' && <div className="min-h-400"><SceneHeader number={2} label={scene.label} /><div className="mt-24 grid grid-cols-2 gap-16 lg:grid-cols-4 md:gap-24">{faculty.map((person) => <GlassCard key={person.id} className="flex min-w-0 flex-col gap-12 p-12"><ImageFrame src={person.photo || undefined} alt={`${person.name} 교수 사진`} ratio="4/3" bg={person.hasBg} placeholder={person.name} /><div className="flex flex-col gap-4"><h2 className="text-h3-m font-bold leading-relaxed text-text-pri md:text-h3-d">{person.name}</h2>{person.role && <p className="text-small-m leading-relaxed text-text-sec md:text-small-d">{person.role}</p>}</div></GlassCard>)}</div></div>}
            {scene.id === 'community' && <div className="min-h-400"><SceneHeader number={3} label={scene.label} /><div className="mt-32 grid grid-cols-1 gap-24 lg:grid-cols-2"><GlassCard className="flex flex-col gap-16 p-20 md:p-24">{council.logo_url && <ImageFrame src={council.logo_url} alt={`${council.name || council.title} 로고`} ratio="3/2" contain bg={Boolean(council.has_bg)} />}<h2 className="text-h2-m font-bold leading-relaxed text-text-pri md:text-h2-d">{council.name || council.title}</h2><p className="text-body-m leading-relaxed text-text-sec md:text-body-d">{council.intro}</p></GlassCard><div className="grid grid-cols-2 gap-16">{clubs.map((club) => <GlassCard key={club.id} className="flex min-w-0 flex-col gap-12 p-12"><ImageFrame src={club.poster_url || undefined} alt={`${club.title || club.name} 로고`} ratio="4/3" contain bg={Boolean(club.has_bg)} placeholder={club.title || club.name} /><h2 className="text-h3-m font-bold leading-relaxed text-text-pri md:text-h3-d">{club.title || club.name}</h2>{club.tag && <Tag>{club.tag}</Tag>}</GlassCard>)}</div></div></div>}
          </motion.div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-12"><p className="font-mono text-caption-m text-text-meta">{sceneIndex + 1} / {scenes.length} · {stepIndex + 1} / {scene.steps.length}</p><div className="flex gap-8"><Button variant="secondary" onClick={previous} disabled={sceneIndex === 0 && stepIndex === 0}><ChevronLeft size={16} aria-hidden="true" />이전</Button><Button variant="secondary" onClick={next} disabled={sceneIndex === scenes.length - 1 && stepIndex === scene.steps.length - 1}>다음<ChevronRight size={16} aria-hidden="true" /></Button></div></div>
      </div>
    </main>
  )
}

export default MajorCompassExperience
