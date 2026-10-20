// 새 캔버스 템플릿: 디인예 수업(UX·서비스 디자인)에서 자주 쓰는 틀. 글은 자리 표시 문구만 넣는다.
// 각 템플릿은 (0, 0) 기준으로 항목과 연결을 만든다. 넣을 때 BoardEditor가 자리를 옮긴다.
let seq = 0
const nid = (p = 't') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

function maker() {
  const items = []
  const connections = []
  let z = 0
  let order = 0
  const push = (it) => {
    const full = { id: nid(), color: null, z: ++z, ...it }
    items.push(full)
    return full
  }
  return {
    items,
    connections,
    frame: (x, y, w, h, name) => push({ type: 'frame', x, y, w, h, data: { name, order: ++order } }),
    sticky: (x, y, text = '', color = 'yellow', s = 180) => push({ type: 'sticky', x, y, w: s, h: s, color, data: { text } }),
    text: (x, y, w, text, size = 18, bold = false) => push({ type: 'text', x, y, w, h: Math.round(size * 1.5), data: { text, size, bold } }),
    shape: (x, y, w, h, shape, text = '', color = null) => push({ type: 'shape', x, y, w, h, color, data: { shape, text } }),
    link: (a, b, style = 'curve', arrow = 'none') => connections.push({ id: nid('c'), from: a.id, to: b.id, label: '', arrow, color: null, style }),
  }
}

function brainstorm() {
  const m = maker()
  m.frame(0, 0, 1400, 900, '브레인스토밍')
  m.text(48, 40, 900, '질문이나 주제를 적으세요', 32, true)
  m.text(48, 96, 900, '판단은 미루고 떠오르는 대로 많이 붙입니다', 16)
  const center = m.shape(560, 360, 280, 160, 'ellipse', '주제', 'purple')
  const spots = [[200, 200], [520, 160], [880, 200], [1060, 400], [880, 620], [520, 660], [200, 620], [120, 410]]
  spots.forEach(([x, y], i) => m.sticky(x, y, '아이디어', i % 2 ? 'amber' : 'yellow', 160))
  void center
  return m
}

function mindmap() {
  const m = maker()
  m.frame(0, 0, 1500, 900, '마인드맵')
  const c = m.shape(620, 390, 260, 120, 'rounded', '중심 주제', 'purple')
  const branches = [
    [260, 160, 'green'], [1000, 160, 'amber'], [260, 640, 'red'], [1000, 640, 'yellow'],
  ]
  branches.forEach(([x, y, color], i) => {
    const b = m.shape(x, y, 220, 90, 'rounded', `가지 ${i + 1}`, color)
    m.link(c, b)
    const left = x < 700
    for (let k = 0; k < 2; k++) {
      const s = m.shape(left ? x - 230 : x + 250, y - 60 + k * 150, 180, 64, 'rounded', '세부 내용')
      m.link(b, s)
    }
  })
  return m
}

function kanban() {
  const m = maker()
  const cols = ['할 일', '진행 중', '완료']
  const colors = ['red', 'amber', 'green']
  cols.forEach((name, i) => {
    const x = i * 460
    m.frame(x, 0, 420, 900, name)
    m.shape(x + 24, 24, 372, 56, 'rounded', name, colors[i])
    for (let k = 0; k < 3; k++) m.sticky(x + 24 + (k % 2) * 196, 112 + Math.floor(k / 2) * 196, '할 일 적기', 'yellow', 176)
  })
  return m
}

function kpt() {
  const m = maker()
  const cols = [
    ['Keep', '계속할 것', 'green'],
    ['Problem', '문제였던 것', 'red'],
    ['Try', '다음에 시도할 것', 'purple'],
  ]
  cols.forEach(([en, ko, color], i) => {
    const x = i * 520
    m.frame(x, 0, 480, 820, `${en} ${ko}`)
    m.text(x + 32, 32, 400, en, 36, true)
    m.text(x + 32, 92, 400, ko, 16)
    for (let k = 0; k < 4; k++) m.sticky(x + 32 + (k % 2) * 210, 150 + Math.floor(k / 2) * 210, '내용 적기', color === 'purple' ? 'yellow' : color === 'green' ? 'green' : 'amber', 190)
  })
  return m
}

function journey() {
  const m = maker()
  const stages = 5
  const rows = ['행동', '생각', '감정', '접점', '문제점', '기회']
  const colW = 240
  const left = 200
  const rowH = 150
  m.frame(0, 0, left + stages * colW + 40, 140 + rows.length * rowH + 40, '사용자 여정 지도')
  m.text(32, 32, 600, '페르소나와 시나리오를 적으세요', 24, true)
  for (let s = 0; s < stages; s++) m.shape(left + s * colW, 96, colW - 16, 56, 'arrow', `단계 ${s + 1}`, 'purple')
  rows.forEach((r, ri) => {
    const y = 176 + ri * rowH
    m.text(32, y + 40, 150, r, 18, true)
    for (let s = 0; s < stages; s++) m.sticky(left + s * colW + 24, y, '', ri === 2 ? 'amber' : ri === 4 ? 'red' : ri === 5 ? 'green' : 'yellow', 130)
  })
  return m
}

function persona() {
  const m = maker()
  m.frame(0, 0, 1200, 820, '페르소나')
  m.shape(40, 40, 220, 220, 'ellipse', '사진 자리')
  m.text(300, 60, 600, '이름', 36, true)
  m.text(300, 124, 600, '나이, 전공 또는 직업, 사는 곳', 18)
  m.text(300, 170, 800, '"이 사람을 대표하는 한마디"', 22)
  const blocks = [
    ['목표', 'green'], ['불편한 점', 'red'], ['행동 패턴', 'yellow'], ['쓰는 도구와 채널', 'amber'],
  ]
  blocks.forEach(([name, color], i) => {
    const x = 40 + (i % 2) * 580
    const y = 300 + Math.floor(i / 2) * 260
    m.text(x, y, 400, name, 20, true)
    m.sticky(x, y + 44, '내용 적기', color, 180)
    m.sticky(x + 200, y + 44, '내용 적기', color, 180)
  })
  return m
}

function stakeholder() {
  const m = maker()
  m.frame(0, 0, 1200, 1000, '이해관계자 지도')
  m.shape(100, 100, 1000, 860, 'ellipse', '')
  m.shape(260, 240, 680, 580, 'ellipse', '', 'gray')
  m.shape(470, 440, 260, 180, 'ellipse', '서비스 또는 프로젝트', 'purple')
  m.text(520, 130, 300, '간접 이해관계자', 16, true)
  m.text(530, 270, 300, '직접 이해관계자', 16, true)
  const spots = [[320, 380], [760, 380], [320, 650], [760, 650], [140, 520], [940, 520], [520, 820]]
  spots.forEach(([x, y], i) => m.sticky(x, y, '이해관계자', i < 4 ? 'yellow' : 'amber', 130))
  return m
}

function matrix() {
  const m = maker()
  m.frame(0, 0, 1100, 1000, '2x2 매트릭스')
  m.shape(540, 80, 8, 840, 'rect', '', 'black')
  m.shape(80, 496, 940, 8, 'rect', '', 'black')
  m.text(470, 40, 300, '세로축 높음', 16, true)
  m.text(470, 932, 300, '세로축 낮음', 16, true)
  m.text(30, 460, 120, '가로축 낮음', 16, true)
  m.text(960, 460, 120, '가로축 높음', 16, true)
  const q = [[150, 150, '영역 1'], [640, 150, '영역 2'], [150, 600, '영역 3'], [640, 600, '영역 4']]
  q.forEach(([x, y, t]) => m.text(x, y, 300, t, 20, true))
  m.sticky(200, 220, '항목', 'yellow', 150)
  m.sticky(700, 680, '항목', 'yellow', 150)
  return m
}

function weekly() {
  const m = maker()
  const days = ['월', '화', '수', '목', '금', '토', '일']
  const colW = 220
  m.frame(0, 0, days.length * colW + 48, 820, '주간 일정')
  m.text(24, 24, 600, '주차와 목표를 적으세요', 24, true)
  days.forEach((d, i) => {
    const x = 24 + i * colW
    m.shape(x, 90, colW - 16, 52, 'rounded', d, i >= 5 ? 'red' : 'purple')
    m.sticky(x + 12, 170, '일정', 'yellow', 180)
    m.sticky(x + 12, 370, '', i >= 5 ? 'amber' : 'yellow', 180)
  })
  return m
}

export const TEMPLATES = [
  { id: 'blank', name: '빈 캔버스', desc: '아무것도 없는 캔버스', make: () => maker() },
  { id: 'brainstorm', name: '브레인스토밍', desc: '주제 하나와 아이디어 포스트잇', make: brainstorm },
  { id: 'mindmap', name: '마인드맵', desc: '중심 주제에서 가지 뻗기', make: mindmap },
  { id: 'kanban', name: '칸반', desc: '할 일, 진행 중, 완료', make: kanban },
  { id: 'kpt', name: '회고 (KPT)', desc: 'Keep, Problem, Try', make: kpt },
  { id: 'journey', name: '사용자 여정 지도', desc: '단계별 행동, 생각, 감정, 접점', make: journey },
  { id: 'persona', name: '페르소나', desc: '목표, 불편한 점, 행동 패턴', make: persona },
  { id: 'stakeholder', name: '이해관계자 지도', desc: '직접, 간접 이해관계자', make: stakeholder },
  { id: 'matrix', name: '2x2 매트릭스', desc: '두 축으로 나누기', make: matrix },
  { id: 'weekly', name: '주간 일정', desc: '월요일부터 일요일까지', make: weekly },
]

/** 템플릿 항목을 만든다. 반환: { items, connections } */
export function buildTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0]
  const m = t.make()
  return { name: t.id === 'blank' ? null : t.name, items: m.items, connections: m.connections }
}
