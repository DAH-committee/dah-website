import { useMemo, useState } from 'react'
import PageBanner from '../components/layout/PageBanner'
import Container from '../components/layout/Container'
import SectionLabel from '../components/common/SectionLabel'
import Reveal from '../components/common/Reveal'
import SegmentControl from '../components/common/SegmentControl'
import { EditPencil } from '../components/content/EditControls'
import { useApi } from '../hooks/useApi'
import { useTitle } from '../hooks/useTitle'
import { useLang } from '../i18n/LangContext'
import { tracks } from '../data/tracks'
import { curriculum } from '../data/curriculum'
import { colors } from '../styles/tokens'

// 교육과정 (J10, 20_PHASE8) — 표 형식 전환.
// 트랙(공통기초 포함)별로 1학기·2학기 표를 나란히(데스크탑 2열, 모바일 세로) 배치.
// 표 컬럼: 수준 | 과목명 | 학점-강의-실습. 디자인은 토큰만(radius 4, 헤어라인, 다크).
// 4수준 로드맵 SVG는 과목의 개설 학기(1·2학기)를 학기 서브컬럼에 반영, 공통기초 최상단.

const LANE_KEYS = ['common', 'track-1', 'track-2', 'track-3']

// A0(38_UI_FIX_BATCH) 개설 과목 ↔ 교과목 원문 매칭 키.
// 서버 개설 정보(name_ko)와 data/curriculum.js 과목명은 표기 공백이 다를 수 있어
// (예: "디지털 디자인1" / "디지털디자인1") 공백·대소문자를 지우고 비교한다.
const nameKey = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

function coursesOf(trackKey, semester) {
  return curriculum.filter((c) => c.track === trackKey && c.semester === semester)
}

function courseName(course, lang) {
  return lang === 'en' && course.nameEn ? course.nameEn : course.name
}

// J10: 학기 표 — 수준 | 과목명 | 학점-강의-실습
// A0: 선택 학기에 개설된 과목 행은 면 자체를 state.semesterActive로 은은히 틴트한다.
function SemesterTable({ trackKey, semester, lang, t, offeredNames }) {
  const rows = coursesOf(trackKey, semester)
  if (rows.length === 0) return null
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border-subtle">
      <p className="border-b border-border-subtle bg-bg-elev px-16 py-12 font-mono text-label-m uppercase tracking-label text-text-sec md:text-label-d">
        {t(`curriculum.sem${semester}`)}
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          {/* K2-11: 헤더 셀 whitespace-nowrap + 학점-강의-실습 컬럼 w-128로 잘림 제거 */}
          <tr className="border-b border-border-subtle">
            <th
              scope="col"
              className="w-64 whitespace-nowrap px-16 py-8 font-mono text-caption-m font-semibold text-text-meta"
            >
              {t('curriculum.grade')}
            </th>
            <th
              scope="col"
              className="whitespace-nowrap px-8 py-8 font-mono text-caption-m font-semibold text-text-meta"
            >
              {t('curriculum.course')}
            </th>
            <th
              scope="col"
              className="w-128 whitespace-nowrap px-16 py-8 text-right font-mono text-caption-m font-semibold text-text-meta"
            >
              {t('curriculum.credit')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((course) => (
            <tr
              key={`${course.name}-${course.year}`}
              className={`transition-colors duration-base ease-out ${
                offeredNames.has(nameKey(course.name)) ? 'bg-state-semesterActive' : ''
              }`}
            >
              <td className="px-16 py-12 font-mono text-small-m text-text-meta md:text-small-d">
                {course.year}
              </td>
              <td className="min-w-0 break-keep px-8 py-12 text-body-m text-text-pri md:text-body-d">
                {courseName(course, lang)}
              </td>
              <td className="px-16 py-12 text-right font-mono text-small-m text-text-sec md:text-small-d">
                {course.credit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 트랙 블록: 헤딩(+트랙 소개) + 1·2학기 표 2열
function LaneSection({ trackKey, lang, t, offeredNames }) {
  const track = tracks.find((tr) => tr.id === trackKey) ?? null
  const displayName = track ? t(`tracks.${track.id}`) : t('tracks.common')
  const summary =
    track && (lang === 'en' && track.summaryEn ? track.summaryEn : track.summary)

  return (
    <Container
      as="section"
      id={trackKey === 'common' ? undefined : trackKey}
      className="scroll-mt-header pt-section-m md:pt-section-d"
    >
      <Reveal>
        <p className="font-mono text-label-m uppercase tracking-label text-text-sec md:text-label-d">
          {track ? track.no : 'COMMON'}
        </p>
        <h2 className="mt-16 text-h1-m font-extrabold leading-tight tracking-display text-text-pri md:mt-24 md:text-h1-d">
          {displayName}
        </h2>
        {summary && (
          // K2-5: 트랙 요약 max-w 720 → 960(가독 상한)
          <p className="mt-16 max-w-lead text-body-l-m leading-relaxed text-text-sec md:mt-24 md:text-body-l-d">
            {summary}
          </p>
        )}
      </Reveal>
      {/* J10·J13: 데스크탑 2열(1학기|2학기), 모바일 세로 스택.
          K2-11: items-start — 표 높이는 각자 행 수만큼만(등고 강제 없음) */}
      <div className="mt-32 grid grid-cols-1 items-start gap-16 md:mt-48 md:grid-cols-2 md:gap-24">
        <SemesterTable
          trackKey={trackKey}
          semester={1}
          lang={lang}
          t={t}
          offeredNames={offeredNames}
        />
        <SemesterTable
          trackKey={trackKey}
          semester={2}
          lang={lang}
          t={t}
          offeredNames={offeredNames}
        />
      </div>
    </Container>
  )
}

// 4수준 로드맵 다이어그램 — 학기(1·2학기) 서브컬럼에 과목 배치, 공통기초 최상단
// K2-12 겹침 진단: 블록 자체는 레인 계산상 겹치지 않으나, 긴 과목명(예: "AI 서비스 기획과
// 프로토타이핑")이 블록 폭(semW-12)을 넘겨 이웃 블록·레인 라벨을 시각적으로 침범했다.
// 해결: (1) 문자폭 추정 기반 말줄임 + <title>로 전체명 제공 (2) labelH·rowH 여유 상향
// (3) lanePad 증가. 전 블록 y+h < 다음 레인 top이 구조식으로 보장된다(아래 y 누적식).
const BLOCK_FONT = 9

// 문자폭 추정(px): 한글 등 전각 ≈ 폰트 크기, ASCII 등 반각 ≈ 0.6배
function estCharW(ch) {
  return ch.charCodeAt(0) > 0x2000 ? BLOCK_FONT : BLOCK_FONT * 0.6
}

// 블록 내부 폭(maxW)을 넘는 과목명을 말줄임 — 전체명은 <title>이 담당
function fitBlockName(name, maxW) {
  let w = 0
  for (let i = 0; i < name.length; i += 1) {
    w += estCharW(name[i])
    if (w > maxW - BLOCK_FONT) return `${name.slice(0, Math.max(1, i))}…`
  }
  return name
}

function buildDiagramLayout(lanes, items, lang) {
  const W = 960
  const colW = W / 4
  const semW = colW / 2
  const axisH = 40
  const labelH = 28
  const rowH = 28
  const lanePad = 20
  let y = axisH
  const laneBoxes = []
  for (const lane of lanes) {
    // (수준, 학기)별 과목 — 레인 높이는 수준 내 학기 중 최다 행 기준
    const cells = [1, 2, 3, 4].map((year) =>
      [1, 2].map((sem) =>
        items.filter((c) => c.track === lane.key && c.year === year && c.semester === sem)
      )
    )
    const maxRows = Math.max(...cells.map(([s1, s2]) => Math.max(s1.length, s2.length)))
    if (maxRows === 0) continue
    const top = y
    const blocks = []
    cells.forEach((sems, yi) => {
      sems.forEach((semItems, si) => {
        semItems.forEach((course, ri) => {
          const w = semW - 12
          const nm = courseName(course, lang)
          blocks.push({
            key: `${lane.key}-${yi}-${si}-${course.name}-${ri}`,
            name: nm,
            // 개설 정보(name_ko)와 맞추는 키 — 표시명은 언어에 따라 바뀌므로 국문명을 따로 든다
            ko: course.name,
            display: fitBlockName(nm, w - 12),
            x: yi * colW + si * semW + 6,
            y: top + labelH + ri * rowH,
            w,
            h: rowH - 6,
          })
        })
      })
    })
    laneBoxes.push({ label: lane.label, top, blocks })
    y = top + labelH + maxRows * rowH + lanePad
  }
  return { W, H: y, colW, axisH, lanes: laneBoxes }
}

// ── H3-4(37_SHEET_ROADMAP) 학기별 개설 과목 ──────────────────────────────
// 어드민이 semester_offerings에 저장한 (연도, 학기, 과목)을 읽는다.
// A0(38_UI_FIX_BATCH): 개설 과목을 나열식 목록으로 따로 붙이지 않는다. 로드맵·학기 표에는
// 전 과목이 그대로 남고, 선택한 학기의 과목만 카드 면이 틴트된다(state.semesterActive).
const semKey = (s) => `${s.year}-${s.term}`

/**
 * "현재 학기"는 어드민 설정(GET /settings/public)이 제공한다. 아직 키·형태가 확정되지
 * 않아 객체({year,term|semester})·문자열('2026-2')·학기 숫자(1|2)를 모두 받아들이고,
 * 값이 없거나 해석할 수 없으면 가장 최근 개설 학기로 폴백한다(없으면 null).
 */
function readCurrentSemester(settings, semesters) {
  const fallback = semesters[0] ?? null
  const raw = settings?.currentSemester ?? settings?.exhibitionSemester ?? null
  if (raw === null || raw === undefined) return fallback

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const year = Number(raw.year)
    const term = Number(raw.term ?? raw.semester)
    if (Number.isInteger(year) && (term === 1 || term === 2)) return { year, term }
    if (term === 1 || term === 2) {
      return semesters.find((s) => s.term === term) ?? { year: new Date().getFullYear(), term }
    }
    return fallback
  }

  const matched = String(raw).match(/(\d{4})\D+([12])/)
  if (matched) return { year: Number(matched[1]), term: Number(matched[2]) }

  const term = Number(raw)
  if (term === 1 || term === 2) {
    return semesters.find((s) => s.term === term) ?? { year: new Date().getFullYear(), term }
  }
  return fallback
}

// 학기 선택 상태 + 그 학기 개설 과목 이름 집합. 틴트 대상(로드맵 SVG·학기 표)이 페이지
// 전체에 걸쳐 있어 상태를 페이지 루트에 두고 값만 내려보낸다.
function useSemesterSelection() {
  const { data: semData } = useApi('/offerings/semesters')
  const { data: settingsData } = useApi('/settings/public')
  const [picked, setPicked] = useState(null)

  const semesters = useMemo(
    () =>
      (semData?.items || [])
        .map((s) => ({ year: Number(s.year), term: Number(s.term) }))
        .filter((s) => Number.isInteger(s.year) && (s.term === 1 || s.term === 2)),
    [semData]
  )
  const current = useMemo(
    () => readCurrentSemester(settingsData?.settings, semesters),
    [settingsData, semesters]
  )

  // 선택 목록 = 개설 이력 있는 학기 + 현재 학기(개설 정보가 아직 없어도 선택 가능)
  const options = useMemo(() => {
    const map = new Map()
    for (const s of [...(current ? [current] : []), ...semesters]) map.set(semKey(s), s)
    return [...map.values()].sort((a, b) => b.year - a.year || b.term - a.term)
  }, [current, semesters])

  const active = options.find((s) => semKey(s) === picked) ?? options[0] ?? null
  const isCurrent = Boolean(active && current && semKey(active) === semKey(current))

  const { data: offData } = useApi(active ? '/offerings' : null, {
    params: active ? { year: active.year, term: active.term } : undefined,
  })

  // 틴트 판정용 이름 집합 — 표시명(언어별)이 아니라 국문명 기준
  const offeredNames = useMemo(
    () => new Set((offData?.items || []).map((o) => nameKey(o.name_ko))),
    [offData]
  )

  return {
    options,
    active,
    isCurrent,
    setPicked,
    offeredNames,
    // 응답이 온 뒤에만 "개설 정보 없음" — 로딩 중 문구가 깜빡이지 않게
    isEmpty: Boolean(active) && Boolean(offData) && offeredNames.size === 0,
  }
}

// 선택된 학기 컨트롤 — 나열식 개설 목록을 대체한다. 어떤 학기가 선택돼 있는지,
// 그 학기가 현재 학기인지, 개설 정보가 아직 없는지를 이 한 줄이 전부 말한다.
function SemesterPicker({ options, active, isCurrent, isEmpty, onPick, t }) {
  if (options.length === 0) return null
  const semLabel = (s) => `${s.year} ${t(s.term === 2 ? 'curriculum.sem2' : 'curriculum.sem1')}`

  return (
    <div className="mt-24 flex flex-wrap items-center gap-12 md:mt-32">
      <SegmentControl
        mode="single"
        options={options.map((s) => ({ value: semKey(s), label: semLabel(s) }))}
        value={active ? semKey(active) : ''}
        onChange={onPick}
        aria-label={t('meta.semester')}
      />
      {isCurrent && (
        <span className="inline-flex items-center rounded-sm border border-border-purple px-12 py-4 font-mono text-caption-m text-purple-light">
          {t('common.currentSemester')}
        </span>
      )}
      {isEmpty && (
        <span className="font-mono text-caption-m text-text-meta">{t('common.noOfferings')}</span>
      )}
    </div>
  )
}

function Curriculum() {
  const { lang, t } = useLang()
  useTitle(t('titles.curriculum'))
  const semester = useSemesterSelection()

  const lanes = [
    { key: 'common', label: t('tracks.common') },
    ...tracks.map((track) => ({ key: track.id, label: t(`tracks.${track.id}`) })),
  ]
  const diagram = buildDiagramLayout(lanes, curriculum, lang)

  return (
    <>
      <PageBanner
        titleKo="교육과정"
        titleEn="CURRICULUM"
        breadcrumb={[
          { label: t('nav.home'), to: '/' },
          { label: t('nav.curriculum'), to: '/curriculum' },
        ]}
        nebulaX="65%"
        nebulaY="25%"
      />

      <div className="pb-section-m md:pb-section-d">
        {/* 수준별 교육 과정은 페이지의 첫 내용으로 둔다. 전체 구조를 먼저 본 뒤
            공통기초·트랙별 상세 표로 내려가는 흐름이다. */}
        {/* 4년 로드맵 — 학기 반영 SVG (md 미만은 표가 이미 학기별 정보를 제공해 숨김) */}
        {curriculum.length > 0 && (
          <Container as="section" className="pt-section-m md:pt-section-d">
            <Reveal>
              <SectionLabel index="05" text="ROADMAP" />
              <div className="mt-24 flex flex-wrap items-center gap-12 md:mt-32">
                <h2 className="text-h1-m font-extrabold leading-tight tracking-display text-text-pri md:text-h1-d">
                  {t('sections.roadmap')}
                </h2>
                <EditPencil type="curriculum" to="/admin/curriculum" />
              </div>
            </Reveal>

            {/* A0: 연도·학기 선택 — 고른 학기의 과목만 로드맵·학기 표에서 면이 틴트된다 */}
            <SemesterPicker
              options={semester.options}
              active={semester.active}
              isCurrent={semester.isCurrent}
              isEmpty={semester.isEmpty}
              onPick={semester.setPicked}
              t={t}
            />

            <div className="mt-48 hidden md:mt-64 md:block">
              <svg
                viewBox={`0 0 ${diagram.W} ${diagram.H}`}
                role="img"
                aria-label={t('curriculum.roadmapAria')}
                className="h-auto w-full"
              >
                {[0, 1, 2, 3].map((i) => (
                  <g key={i}>
                    <text
                      x={i * diagram.colW + diagram.colW / 2}
                      y="16"
                      textAnchor="middle"
                      fontSize="13"
                      fill="currentColor"
                      className="font-mono font-semibold text-text-pri"
                    >
                      {`${t('curriculum.levelPrefix')}${i + 1}`}
                    </text>
                    <text
                      x={i * diagram.colW + diagram.colW / 4}
                      y="32"
                      textAnchor="middle"
                      fontSize="9"
                      fill="currentColor"
                      className="font-mono text-text-meta"
                    >
                      {t('curriculum.sem1')}
                    </text>
                    <text
                      x={i * diagram.colW + (diagram.colW * 3) / 4}
                      y="32"
                      textAnchor="middle"
                      fontSize="9"
                      fill="currentColor"
                      className="font-mono text-text-meta"
                    >
                      {t('curriculum.sem2')}
                    </text>
                    <line
                      x1={i * diagram.colW + diagram.colW / 2}
                      y1={diagram.axisH - 6}
                      x2={i * diagram.colW + diagram.colW / 2}
                      y2={diagram.H}
                      stroke="currentColor"
                      strokeDasharray="2 6"
                      className="text-border-subtle"
                    />
                    {i > 0 && (
                      <line
                        x1={i * diagram.colW}
                        y1="6"
                        x2={i * diagram.colW}
                        y2={diagram.H}
                        stroke="currentColor"
                        className="text-border-strong"
                      />
                    )}
                  </g>
                ))}

                {diagram.lanes.map((lane) => (
                  <g key={lane.label}>
                    <line
                      x1="0"
                      y1={lane.top}
                      x2={diagram.W}
                      y2={lane.top}
                      stroke="currentColor"
                      className="text-border-subtle"
                    />
                    <text
                      x="0"
                      y={lane.top + 16}
                      fontSize="11"
                      fill="currentColor"
                      className="font-sans font-bold text-text-pri"
                    >
                      {lane.label}
                    </text>
                    {lane.blocks.map((b) => (
                      <g key={b.key}>
                        {/* K2-12: 블록 폭 초과 과목명은 말줄임(display), 전체명은 title 툴팁 */}
                        <title>{b.name}</title>
                        {/* A0: 선택 학기 개설 과목은 블록 면을 틴트. 미선택은 transparent —
                            none이 아니라 투명색이라야 fill이 색상 전환된다(레이아웃 불변) */}
                        <rect
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={b.h}
                          rx="4"
                          style={{
                            fill: semester.offeredNames.has(nameKey(b.ko))
                              ? colors.state.semesterActive
                              : 'transparent',
                          }}
                          stroke="currentColor"
                          className="text-border-subtle transition-colors duration-base ease-out"
                        />
                        <text
                          x={b.x + 6}
                          y={b.y + b.h / 2 + 3.5}
                          fontSize={BLOCK_FONT}
                          fill="currentColor"
                          className="font-sans text-text-sec"
                        >
                          {b.display}
                        </text>
                      </g>
                    ))}
                  </g>
                ))}
              </svg>
            </div>
          </Container>
        )}

        {/* 공통기초 → 트랙 3: 로드맵 다음에 학기별 상세 표 (앵커 유지: /curriculum#track-n) */}
        {LANE_KEYS.map((key) => (
          <LaneSection
            key={key}
            trackKey={key}
            lang={lang}
            t={t}
            offeredNames={semester.offeredNames}
          />
        ))}
      </div>
    </>
  )
}

export default Curriculum
