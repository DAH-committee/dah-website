// AnnualPages.jsx: 애뉴얼 리포트의 모든 쪽(600 x 800 고정 판형). 렌더 화면(/annual-report/render)에서만 쓴다.
// 이 쪽들을 이미지로 구워 책 화면(/annual-report)이 캔버스로 넘긴다.
import { councils } from '../../data/council'
import { history } from '../../data/history'
import { curriculum } from '../../data/curriculum'
import { tracks } from '../../data/tracks'
import { nanodegree } from '../../data/nanodegree'
import { professors } from '../../data/professors'
import { exAwards } from '../../data/annualAwards'
import {
  IMG,
  SITE_URL,
  reportMeta,
  chapters,
  aboutText,
  trackCareers,
  talent,
  vision,
  facultyDetail,
  regularEvents,
  yearFlow,
  axCompare,
  axNew,
  submitFlow,
  exhibitionArchive,
  exhibition261Facts,
  exhibition261Concept,
  exhibition261Prep,
  posterAwards,
  bookplateAwards,
  characterWorks,
  achievements21,
  clubsInfo,
} from '../../data/annualContent'

const council2026 = councils.find((c) => c.year === 2026)
const ch = (id) => chapters.find((c) => c.id === id)
const src = (s) => (s.startsWith('/') ? s : `${IMG}/${s}`)

const Img = ({ s, alt = '', style, className = '' }) => <img src={src(s)} alt={alt} className={`ap-img ${className}`} style={style} draggable="false" />

const Head = ({ title, sub }) => (
  <header className="ap-head">
    <h2 className="ap-title">{title}</h2>
    {sub && <p className="ap-sub">{sub}</p>}
  </header>
)

const H3 = ({ children, en }) => (
  <h3 className="ap-h3">
    {children}
    {en && <em>{en}</em>}
  </h3>
)

const Table = ({ head, rows, cols, small }) => (
  <table className={`ap-table ${small ? 'is-small' : ''}`}>
    {cols && (
      <colgroup>
        {cols.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
    )}
    {head && (
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
    )}
    <tbody>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c, j) => (
            <td key={j}>{c}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
)

const Bullets = ({ items }) => (
  <ul className="ap-bullets">
    {items.map((t) => (
      <li key={t}>{t}</li>
    ))}
  </ul>
)

const Numbered = ({ items }) => (
  <ol className="ap-numbered">
    {items.map(([t, d], i) => (
      <li key={t}>
        <span>{String(i + 1).padStart(2, '0')}</span>
        <div>
          <strong>{t}</strong>
          {d && <p>{d}</p>}
        </div>
      </li>
    ))}
  </ol>
)

const Opener = ({ id, lead }) => {
  const c = ch(id)
  return (
    <div className="ap-opener">
      <span className="ap-opener__no">{c.no}</span>
      <div className="ap-opener__body">
        <h2>{c.en}</h2>
        <p className="ap-opener__kr">{c.title}</p>
        {lead && <p className="ap-opener__lead">{lead}</p>}
        <ul>
          {c.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// 사진 한 장. shot이면 화면 캡처(위쪽 기준 정렬로 머리글이 잘리지 않게 한다)
const Photo = ({ s, h, cap, alt, shot, contain }) => (
  <figure className={`ap-photo ${shot ? 'ap-photo--shot' : ''}`} style={{ height: h }}>
    <Img s={s} alt={alt || cap || ''} className={contain ? 'ap-img--contain' : ''} />
    {cap && <figcaption>{cap}</figcaption>}
  </figure>
)

const Cell = ({ s, cap, sub, ratio = '3 / 4', contain }) => (
  <figure className="ap-cell">
    <div className="ap-cell__img" style={{ aspectRatio: ratio }}>
      <Img s={s} className={contain ? 'ap-img--contain' : ''} />
    </div>
    {cap && <figcaption>{cap}</figcaption>}
    {sub && <small>{sub}</small>}
  </figure>
)

const Grid = ({ cols, gap = 8, children, style, dense }) => (
  <div className={`ap-grid ${dense ? 'is-dense' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap, ...style }}>
    {children}
  </div>
)

// 수상작 카드: 원본 비율(A 규격)로 자르지 않고 보여 주고 아래에 등급, 작품명, 팀과 수상자를 적는다
const topGrade = (g) => g === '최우수상' || g === '1등'
const Award = ({ img, grade, line, title, who, desc }) => (
  <article className="ap-aw">
    <div className="ap-aw__img">
      <Img s={img} alt={`${grade} ${title}`} />
    </div>
    <div className="ap-aw__tx">
      <span className={`ap-aw__g ${topGrade(grade) ? 'is-top' : ''}`}>{grade}</span>
      {line && <p className="ap-aw__c">{line}</p>}
      <h3 className="ap-aw__t">{title}</h3>
      {who && <p className="ap-aw__w">{who}</p>}
      {desc && <p className="ap-aw__d">{desc}</p>}
    </div>
  </article>
)
const AwardPair = ({ children }) => <div className="ap-awpair">{children}</div>

const exAward = (a) => (
  <Award
    key={a.id}
    img={`ex-awards/${a.id}.webp`}
    grade={a.grade}
    line={a.course}
    title={a.title}
    who={`${a.team ? a.team + ', ' : ''}${a.members.join(', ')}`}
    desc={a.desc}
  />
)

const prof = (id) => professors.find((p) => p.id === id)
const roleOf = (p) => (p.id === 'han-soomi' ? '주임교수' : p.role.replace('디지털인문예술전공', '').trim() || '디지털인문예술전공')
const sortedHistory = [...history].sort((a, b) => a.date.localeCompare(b.date))
// 한수미 주임교수를 가장 먼저 둔다
const facultyOrder = ['han-soomi', 'kim-yongsoo', 'kim-sungwoo', 'yoo-inseon', 'song-injae', 'yang-taegeun', 'lee-junggeun', 'lee-eunsol', 'kim-jeehyun', 'song-hanna', 'seo-joohee']

const Prof = ({ id }) => {
  const p = prof(id)
  const d = facultyDetail[id]
  return (
    <article className="ap-prof">
      <div className="ap-prof__photo">
        <Img s={`faculty/${id}.webp`} alt={`${p.nameKr} 교수`} />
      </div>
      <div className="ap-prof__body">
        <h3>
          {p.nameKr} <small>{roleOf(p)}</small>
        </h3>
        <p className="ap-prof__en">
          {p.nameEn}
          {p.affiliation ? `, ${p.affiliation}` : ''}
        </p>
        <dl>
          <dt>학력</dt>
          <dd>
            {d.edu.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </dd>
          <dt>전공</dt>
          <dd>
            {d.field.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </dd>
          <dt>연구관심사</dt>
          <dd>
            {d.interest.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </dd>
        </dl>
      </div>
    </article>
  )
}

const RosterCell = ({ id }) => {
  const p = prof(id)
  return (
    <article>
      <div className="ap-roster__photo">
        <Img s={`faculty/${id}.webp`} alt={`${p.nameKr}`} />
      </div>
      <strong>{p.nameKr}</strong>
      <span>{roleOf(p)}</span>
    </article>
  )
}

const courseRows = (track) =>
  curriculum
    .filter((c) => c.track === track)
    .sort((a, b) => a.semester - b.semester || a.year - b.year)
    .map((c) => [`${c.semester}학기`, c.year === 1 && track === 'common' ? '공통' : `${c.year}학년`, c.name, c.credit])

const NanoBlock = ({ p, i }) => (
  <section className="ap-nano">
    <h3>
      <span>{i}</span> {p.name}
    </h3>
    <dl>
      <div>
        <dt>이수기준</dt>
        <dd>{p.criteria}</dd>
      </div>
      <div>
        <dt>유관기관</dt>
        <dd>{p.partner}</dd>
      </div>
      <div>
        <dt>수료</dt>
        <dd>{p.completion}</dd>
      </div>
    </dl>
    <Table head={['과목번호', '교과목명', '학점']} cols={['22%', '56%', '22%']} rows={p.courses.map((c) => [c.code, c.name, c.credit])} small />
  </section>
)

// 인재상 벤 다이어그램(SVG): 세 원의 중심과 글자를 좌표로 맞춘다
const Venn = () => (
  <svg className="ap-venn" viewBox="0 0 512 346" role="img" aria-label="Digital, Creative, Human 세 영역이 겹치는 인재상">
    <circle cx="186" cy="120" r="106" />
    <circle cx="326" cy="120" r="106" />
    <circle cx="256" cy="232" r="106" />
    <text x="140" y="104" className="v-en">Digital</text>
    <text x="140" y="124" className="v-ko">디지털 역량</text>
    <text x="140" y="140" className="v-sub">기술, 디자인</text>
    <text x="372" y="104" className="v-en">Creative</text>
    <text x="372" y="124" className="v-ko">창의적인 발상</text>
    <text x="256" y="262" className="v-en">Human</text>
    <text x="256" y="282" className="v-ko">인문사회적 소양</text>
    <text x="256" y="162" className="v-core">DAH</text>
  </svg>
)

const SiteShot = ({ k, cap, h = 296 }) => <Photo s={`site/${k}.webp`} h={h} cap={cap} shot />

// 쪽 정의 ---------------------------------------------------------------------------------
// ch: 장 id, tone: paper | dark | opener | cover, alt: 접근성 대체 문구
export const pages = [
  // 0 표지: 로고만
  {
    id: 'cover',
    tone: 'cover',
    alt: '2026 디지털 애뉴얼 리포트 표지',
    render: () => (
      <div className="ap-cover">
        <div className="ap-mark">
          <img src="/images/decade/lucid-mark.svg" alt="LUCID 로고" draggable="false" />
        </div>
        <h1>2026 Digital Annual Report</h1>
        <p className="ap-cover__org">
          {reportMeta.org}
          <br />
          {reportMeta.council}
        </p>
      </div>
    ),
  },
  // 1 발간사
  {
    id: 'foreword',
    alt: '발간사',
    render: () => (
      <>
        <Head title="발간사" />
        <div className="ap-prose">
          <p>한림대학교 디지털인문예술전공 제1대 운영위원회 LUCID는 2026년 한 해의 활동과 성과를 이 리포트에 담았습니다.</p>
          <p>
            2026년은 학생회가 운영위원회로 바뀌어 첫 대를 시작한 해입니다. 프로젝트 전시회 운영, 신규 캐릭터 공모전 신설, 공모전 전용
            사이트 제작, 인스타그램 디자인 통일, 전공 웹사이트 제작과 전시회 접수 통합이 이어졌습니다.
          </p>
          <p>
            2025 리포트의 구성인 전공 소개, 교과목, 교수진, 행사, 학생 활동을 그대로 이어받고 2026년의 변화를 더했습니다. 형식은 인쇄본(PDF)에서
            웹에서 넘겨 보는 디지털 판으로 바뀌었습니다.
          </p>
          <p>
            2학기에는 11월 18일 전공 박람회, 12월 2일부터 4일까지 프로젝트 전시회, 12월 4일 종강 총회가 예정되어 있습니다. 행사가 끝나는 대로 결과를 이어서
            수록합니다.
          </p>
          <p className="ap-sign">{reportMeta.council}</p>
        </div>
        <div className="ap-qr">
          <img src={`${IMG}/site-qr.svg`} alt="전공 웹사이트 QR" />
          <p>
            전공 웹사이트
            <br />
            {SITE_URL}
          </p>
        </div>
      </>
    ),
  },
  // 2 목차
  { id: 'toc', alt: '목차', render: ({ toc }) => <Toc toc={toc} /> },

  // ===== 01 About Us =====
  { id: 'op-about', ch: 'about', tone: 'opener', alt: '01 About Us 전공 소개', render: () => <Opener id="about" /> },
  {
    id: 'about-intro',
    ch: 'about',
    alt: '전공 소개',
    render: () => (
      <>
        <Head title="전공 소개" sub="“한림대학교 디지털인문예술전공을 소개합니다”" />
        <Photo s="gaechong/5.webp" h={250} cap="2026.03.11 개강 총회" />
        <H3 en="What is DAH?">전공 정의</H3>
        <p className="ap-body">{aboutText.what}</p>
        <H3 en="Why is DAH?">설립 취지</H3>
        <p className="ap-body">{aboutText.why}</p>
        <div className="ap-stats">
          <div>
            <b>2017</b>
            <span>전공 설립</span>
          </div>
          <div>
            <b>262명</b>
            <span>재적학생(2026 1학기)</span>
          </div>
          <div>
            <b>11명</b>
            <span>교수진</span>
          </div>
          <div>
            <b>18회</b>
            <span>프로젝트 전시회</span>
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'about-tracks',
    ch: 'about',
    alt: '트랙 소개',
    render: () => (
      <>
        <Head title="트랙 소개" />
        <div className="ap-tracks">
          {tracks.map((t) => (
            <section key={t.id}>
              <h3>
                <span>{t.no.replace('TRACK ', '')}</span> {t.name}
              </h3>
              <p>{t.summary}</p>
              <dl className="ap-trk">
                <dt>키워드</dt>
                <dd>{t.keywords.join(', ')}</dd>
                <dt>관련 진로</dt>
                <dd>{trackCareers[t.id].join(' / ')}</dd>
              </dl>
            </section>
          ))}
        </div>
      </>
    ),
  },
  {
    id: 'about-talent',
    ch: 'about',
    alt: '인재상',
    render: () => (
      <>
        <Head title="인재상" sub={talent.lead} />
        <Venn />
        <H3>인재상 유형</H3>
        <Bullets items={talent.roles} />
      </>
    ),
  },
  {
    id: 'about-vision',
    ch: 'about',
    alt: '비전',
    render: () => (
      <>
        <Head title="비전" />
        <ol className="ap-vision">
          {vision.map(([t, d], i) => (
            <li key={t}>
              <span>{i + 1}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="ap-pull">디지털 기술 활용 능력으로 창의적 아이디어를 표현하는 21세기형 인문 인재 양성</div>
      </>
    ),
  },
  {
    id: 'about-history',
    ch: 'about',
    alt: '연혁',
    render: () => (
      <>
        <Head title="연혁" sub="2017년 설립 이후의 주요 기록" />
        <ol className="ap-timeline">
          {sortedHistory.map((h) => (
            <li key={h.date + h.text}>
              <time>{h.date.replace(/\.$/, '')}</time>
              <span>{h.text}</span>
            </li>
          ))}
        </ol>
      </>
    ),
  },

  // ===== 02 Curriculum =====
  { id: 'op-curr', ch: 'curriculum', tone: 'opener', alt: '02 Curriculum 교과목', render: () => <Opener id="curriculum" /> },
  {
    id: 'curr-1',
    ch: 'curriculum',
    alt: '교과목 편성표 공통기초와 디자인 트랙',
    render: () => (
      <>
        <Head title="교과목 편성표" sub="트랙별 교과목 편성표 (학점-강의-실습)" />
        <H3>공통기초</H3>
        <Table head={['학기', '수준', '과목명', '학점']} cols={['14%', '14%', '58%', '14%']} rows={courseRows('common')} small />
        <H3>디자인 트랙</H3>
        <Table head={['학기', '수준', '과목명', '학점']} cols={['14%', '14%', '58%', '14%']} rows={courseRows('track-1')} small />
      </>
    ),
  },
  {
    id: 'curr-2',
    ch: 'curriculum',
    alt: '교과목 편성표 AI 트랙과 엔터컬쳐 트랙',
    render: () => (
      <>
        <Head title="교과목 편성표" sub="트랙별 교과목 편성표 (학점-강의-실습)" />
        <H3>AI 트랙</H3>
        <Table head={['학기', '수준', '과목명', '학점']} cols={['14%', '14%', '58%', '14%']} rows={courseRows('track-2')} small />
        <H3>엔터컬쳐 트랙</H3>
        <Table head={['학기', '수준', '과목명', '학점']} cols={['14%', '14%', '58%', '14%']} rows={courseRows('track-3')} small />
      </>
    ),
  },
  {
    id: 'curr-change',
    ch: 'curriculum',
    alt: '2025에서 2026으로 바뀐 교과목 구성',
    render: () => (
      <>
        <Head title="2025에서 2026으로" sub="2025 리포트와 2026 사이트 기준의 교과목 구성 비교" />
        <H3>트랙 명칭</H3>
        <Table
          head={['2025', '2026']}
          rows={[
            ['미래융합디자인 트랙', '디자인 트랙'],
            ['AI디지털인문학 트랙', 'AI 트랙'],
            ['문화예술콘텐츠 트랙', '엔터컬쳐 트랙'],
          ]}
        />
        <H3>공통기초 교과목</H3>
        <Table
          head={['', '2025', '2026']}
          cols={['16%', '42%', '42%']}
          rows={[
            ['1학기', '디지털인문예술입문, 문화콘텐츠 기초, 융합형 인재를 위한 코딩 기초', '디지털인문예술입문, 문화콘텐츠 기초'],
            ['2학기', '디자인 씽킹 기초, 스토리텔링 기초, AI이해의 기초', '디자인 씽킹, AI 활용 데이터 리터러시, 서브컬처 가이드'],
          ]}
        />
        <H3>코드쉐어링</H3>
        <p className="ap-body">타과 교과목 중 기준에 충족하는 과목에 한해서 디지털인문예술전공의 과목으로 인정하는 시스템입니다.</p>
        <p className="ap-note">이미 취득한 학점에 한하며, 졸업 전까지 코드쉐어링 인정원 작성 후 미래융합스쿨 교학팀의 승인 필요</p>
      </>
    ),
  },
  {
    id: 'nano-1',
    ch: 'curriculum',
    alt: '나노디그리 1',
    render: () => (
      <>
        <Head title="나노디그리" sub="디지털인문예술전공 나노디그리 안내" />
        <dl className="ap-def">
          <div>
            <dt>정의</dt>
            <dd>전공 심화 역량 함양과 전공별 현장 실무 중심의 역량 배양을 위하여 운영하는 집중 교육 과정</dd>
          </div>
          <div>
            <dt>기준</dt>
            <dd>{nanodegree.cert}</dd>
          </div>
          <div>
            <dt>운영</dt>
            <dd>4개 과정</dd>
          </div>
        </dl>
        {nanodegree.programs.slice(0, 2).map((p, i) => (
          <NanoBlock key={p.name} p={p} i={i + 1} />
        ))}
      </>
    ),
  },
  {
    id: 'nano-2',
    ch: 'curriculum',
    alt: '나노디그리 2',
    render: () => (
      <>
        <Head title="나노디그리" sub="과정별 인정 교과목" />
        {nanodegree.programs.slice(2).map((p, i) => (
          <NanoBlock key={p.name} p={p} i={i + 3} />
        ))}
      </>
    ),
  },

  // ===== 03 Faculty =====
  { id: 'op-fac', ch: 'faculty', tone: 'opener', alt: '03 Faculty 교수진', render: () => <Opener id="faculty" /> },
  {
    id: 'fac-list',
    ch: 'faculty',
    alt: '교수진 구성 11명',
    render: () => (
      <>
        <Head title="교수진 구성" />
        <div className="ap-roster">
          {facultyOrder.map((id) => (
            <RosterCell key={id} id={id} />
          ))}
          <p className="ap-roster__note">
            2026.09.01
            <br />
            한수미 교수
            <br />
            전공주임교수 취임
          </p>
        </div>
      </>
    ),
  },
  { id: 'fac-1', ch: 'faculty', alt: '교수 소개 한수미, 김용수', render: () => <><Head title="교수 소개" /><div className="ap-profs"><Prof id="han-soomi" /><Prof id="kim-yongsoo" /></div></> },
  { id: 'fac-2', ch: 'faculty', alt: '교수 소개 김성우, 유인선', render: () => <><Head title="교수 소개" /><div className="ap-profs"><Prof id="kim-sungwoo" /><Prof id="yoo-inseon" /></div></> },
  { id: 'fac-3', ch: 'faculty', alt: '교수 소개 송인재, 양태근', render: () => <><Head title="교수 소개" /><div className="ap-profs"><Prof id="song-injae" /><Prof id="yang-taegeun" /></div></> },
  {
    id: 'fac-4',
    ch: 'faculty',
    alt: '교수 소개 이정근과 겸임교수',
    render: () => (
      <>
        <Head title="교수 소개" />
        <div className="ap-profs">
          <Prof id="lee-junggeun" />
        </div>
        <H3>겸임교수와 지원</H3>
        <div className="ap-adjunct">
          {['lee-eunsol', 'kim-jeehyun', 'song-hanna', 'seo-joohee'].map((id) => (
            <RosterCellLite key={id} id={id} />
          ))}
        </div>
      </>
    ),
  },

  // ===== 04 Council =====
  { id: 'op-council', ch: 'council', tone: 'opener', alt: '04 Council 운영위원회 LUCID', render: () => <Opener id="council" /> },
  {
    id: 'council-history',
    ch: 'council',
    alt: '학생회의 역사',
    render: () => (
      <>
        <Head title="학생회의 역사" sub="2017년 전공 설립과 함께 시작한 학생 조직" />
        <Table head={['연도', '학생 조직']} cols={['22%', '78%']} rows={councils.map((c) => [String(c.year), c.title])} />
        <p className="ap-note">2017년에 전공이 설립되고 학생 조직의 역사가 시작되었으며, 2026년부터 학생회가 제1대 운영위원회 LUCID로 바뀌었습니다.</p>
      </>
    ),
  },
  {
    id: 'council-change',
    ch: 'council',
    alt: '학생회에서 운영위원회로',
    render: () => (
      <>
        <Head title="학생회에서 운영위원회로" sub="2026, 이름과 구조가 바뀐 첫 해" />
        <div className="ap-prose">
          <p>2026년에 전공의 학생 대표 조직 이름이 학생회에서 운영위원회 LUCID로 바뀌었고, 대수도 제1대로 새로 시작했습니다.</p>
          <p>학생회의 역할을 이어받으면서 전시회 접수, 공모전, 전공 웹사이트 운영 등 전공 운영 실무를 위원회가 직접 맡는 구조입니다.</p>
        </div>
        <Table
          head={['', '2026 운영위원회']}
          cols={['22%', '78%']}
          rows={[
            ['명칭', '제1대 운영위원회 LUCID'],
            ['인원', '10명'],
            ['구성', '위원장, 부위원장, 기획부, 홍보부, 웹전시부'],
            ['웹전시부', '전시회 사이트와 웹 전시 담당'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'council-lucid',
    ch: 'council',
    alt: 'LUCID 소개',
    render: () => (
      <>
        <Head title="LUCID" sub="2026 1st Student Council" />
        <div className="ap-mark">
          <img src="/images/decade/lucid-mark.svg" alt="LUCID 로고" draggable="false" />
        </div>
        <blockquote className="ap-quote">{council2026.intro}</blockquote>
      </>
    ),
  },
  {
    id: 'council-org',
    ch: 'council',
    alt: '조직',
    render: () => (
      <>
        <Head title="조직" sub="위원장, 부위원장과 세 개 부서 총 10명" />
        <dl className="ap-org">
          {['위원장', '부위원장', '기획부', '홍보부', '웹전시부'].map((g) => (
            <div key={g}>
              <dt>{g}</dt>
              <dd>{council2026.members.filter((m) => m.role === g).map((m) => m.name).join(', ')}</dd>
            </div>
          ))}
        </dl>
        <p className="ap-note">운영 방향: 인문과 기술, 다양한 전공이 모인 전공에서 서로를 빛내는 시너지 조성</p>
      </>
    ),
  },
  {
    id: 'council-events',
    ch: 'council',
    alt: '정기 운영 행사 7종',
    render: () => (
      <>
        <Head title="정기 운영 행사" sub="한 학기의 시작부터 끝까지 운영하는 전공 공식 행사 7종" />
        <Numbered items={regularEvents} />
      </>
    ),
  },
  {
    id: 'council-year',
    ch: 'council',
    alt: '2026년의 흐름',
    render: () => (
      <>
        <Head title="2026년의 흐름" sub="공지, 행사 일정, 개발 기록 기준. 11월 이후는 예정" />
        <ol className="ap-timeline">
          {yearFlow.map(([d, t]) => (
            <li key={d + t}>
              <time>{d}</time>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  {
    id: 'council-photos',
    ch: 'council',
    alt: '개강 총회 현장 사진',
    render: () => (
      <>
        <Head title="개강 총회" sub="2026.03.11 C.square Blue" />
        <div className="ap-stackp">
          <Photo s="gaechong/1.webp" h={188} alt="개강 총회 발표" />
          <Photo s="gaechong/4.webp" h={188} alt="개강 총회 뒤풀이" />
          <Photo s="gaechong/3.webp" h={188} cap="운영위원회와 동아리 소개, 전공 비전 설명" />
        </div>
      </>
    ),
  },

  // ===== 05 AX =====
  { id: 'op-ax', ch: 'ax', tone: 'opener', alt: '05 AX 전공 디지털 전환', render: () => <Opener id="ax" lead="전공 운영을 웹으로 옮긴 한 해" /> },
  {
    id: 'ax-compare',
    ch: 'ax',
    alt: '작년과 올해',
    render: () => (
      <>
        <Head title="작년과 올해" sub="전공 운영 도구가 구글 문서에서 전공 웹사이트로 이동" />
        <Table head={['', '2025', '2026']} cols={['20%', '38%', '42%']} rows={axCompare} />
      </>
    ),
  },
  {
    id: 'ax-site',
    ch: 'ax',
    alt: '전공 웹사이트',
    render: () => (
      <>
        <Head title="전공 웹사이트" sub="구글 사이트 운영에서 자체 개발 사이트로 전환" />
        <p className="ap-body">구글 사이트로 운영하던 전공 웹사이트를 자체 개발한 사이트로 교체하였습니다. 한국어와 영어를 함께 지원합니다.</p>
        <Bullets
          items={[
            '정보 구조: 전공 소개, 학사 안내, 학과 행사, 학생 활동, 공지사항, 자료실',
            '권한 4단계 운영과 학생 운영진의 코딩 없는 화면 직접 편집',
            '전시회 아카이브 18건, 학생 성과 38건, 동아리 4건, 공지 19건 관리',
            '개발 기록 2026.07.06 시작, 10월 현재 진행 중',
          ]}
        />
        <SiteShot k="home" cap="전공 웹사이트 첫 화면" h={300} />
      </>
    ),
  },
  {
    id: 'ax-submit',
    ch: 'ax',
    alt: '전시회 접수 통합',
    render: () => (
      <>
        <Head title="전시회 접수 통합" sub="구글 폼과 앱스 스크립트로 나뉘어 있던 접수를 전공 웹사이트 한 곳으로 통합" />
        <ol className="ap-steps">
          {submitFlow.map(([t, d], i) => (
            <li key={t}>
              <span>{i + 1}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <Bullets
          items={[
            '접수 기간 서버 검증, 마감 후 접수와 수정 차단',
            '구글 시트 형태의 접수 시트에서 운영진이 바로 확인과 수정',
            '엑셀과 CSV 내보내기, 마감 후 개인정보 초기화',
            '과목 선택 드롭다운, 개인과 팀 참가 구분',
          ]}
        />
        <SiteShot k="submit" cap="전시회 접수 화면" h={250} />
      </>
    ),
  },
  {
    id: 'ax-forms',
    ch: 'ax',
    alt: '신청 폼',
    render: () => (
      <>
        <Head title="신청 폼 편집기" sub="종강 총회, 부원 모집 등 각종 신청을 구글 폼 없이 사이트 안에서 운영" />
        <Bullets
          items={[
            '구글 폼과 같은 방식의 질문 편집기',
            '객관식, 체크박스, 드롭다운, 선형 배율, 날짜, 시간 등 12가지 질문 유형',
            '구글 시트 형태의 응답 시트에서 응답 확인과 수정',
            '폼별 제출 확인 메일 사용 여부 설정',
            '폼 복사로 다음 학기 신청 폼 즉시 생성',
          ]}
        />
        <H3>올해 새로 생긴 기능</H3>
        <Table head={['기능', '내용']} cols={['28%', '72%']} rows={axNew} />
        <p className="ap-note">전시 원본은 인쇄용 파일 그대로 구글 드라이브에 보관하고, 웹 노출용 이미지는 용량을 줄인 웹용으로 별도 제작합니다.</p>
      </>
    ),
  },
  {
    id: 'ax-shots-1',
    ch: 'ax',
    alt: '전공 웹사이트 화면 프로젝트 전시회와 공모전',
    render: () => (
      <>
        <Head title="화면 모음" sub="프로젝트 전시회와 공모전" />
        <SiteShot k="exhibitions" cap="프로젝트 전시회" h={292} />
        <SiteShot k="contests" cap="공모전 회차별 포스터 기록" h={292} />
      </>
    ),
  },
  {
    id: 'ax-shots-2',
    ch: 'ax',
    alt: '전공 웹사이트 화면 학생 성과와 동아리',
    render: () => (
      <>
        <Head title="화면 모음" sub="학생 성과와 동아리" />
        <SiteShot k="achievements" cap="학생 성과" h={292} />
        <SiteShot k="clubs" cap="동아리" h={292} />
      </>
    ),
  },
  {
    id: 'ax-shots-3',
    ch: 'ax',
    alt: '전공 웹사이트 화면 교수진',
    render: () => (
      <>
        <Head title="화면 모음" sub="교수진과 운영위원회" />
        <SiteShot k="people" cap="교수진과 멘토" h={292} />
        <SiteShot k="council" cap="운영위원회" h={292} />
      </>
    ),
  },

  // ===== 06 Events 프로젝트 전시회 =====
  { id: 'op-ex', ch: 'exhibition', tone: 'opener', alt: '06 Events 프로젝트 전시회', render: () => <Opener id="exhibition" lead="2026 1학기와 2학기" /> },
  {
    id: 'ex-archive',
    ch: 'exhibition',
    alt: '전시회 18회의 기록',
    render: () => (
      <>
        <Head title="전시회 18회의 기록" sub="2017년 2학기 제1회부터 2026년 1학기 제18회까지 전공 최대 행사" />
        <Grid cols={6} gap={8}>
          {exhibitionArchive.map((k) => (
            <Cell key={k} s={`/images/exhibitions/${k}.webp`} cap={k} ratio="3 / 4" />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'ex-261',
    ch: 'exhibition',
    alt: '2026 1학기 전시회 Against the Flow 개요',
    render: () => (
      <>
        <Head title="Against the Flow" sub="제18회 디지털인문예술전공 프로젝트 전시회, 2026 1학기" />
        <div className="ap-awone" style={{ gridTemplateColumns: '216px 1fr' }}>
          <div className="ap-aw__img">
            <Img s="poster-awards/against-the-flow.webp" alt="Against the Flow 전시 포스터" />
          </div>
          <Table head={['구분', '내용']} cols={['26%', '74%']} rows={exhibition261Facts} />
        </div>
        <H3>준비와 운영 일정</H3>
        <Table head={['일정', '내용']} cols={['28%', '72%']} rows={exhibition261Prep} small />
      </>
    ),
  },
  {
    id: 'ex-concept',
    ch: 'exhibition',
    alt: 'Against the Flow 전시 컨셉',
    render: () => (
      <>
        <Head title="전시 컨셉" sub="Against the Flow, 기술의 흐름 위에서 사람의 방향으로" />
        <div className="ap-prose">
          {exhibition261Concept.lines.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
        <Numbered items={exhibition261Concept.points} />
        <H3>AI 활용과 학생의 기여</H3>
        <Table cols={['28%', '72%']} rows={exhibition261Concept.credits} small />
      </>
    ),
  },
  {
    id: 'ex-works',
    ch: 'exhibition',
    alt: '전시된 작품들',
    render: () => (
      <>
        <Head title="전시 작품" sub="12개 수업과 동아리, 자율 부문 출품작 81점 중 일부" />
        <Grid cols={5} gap={7}>
          {Array.from({ length: 20 }, (_, i) => (
            <Cell key={i} s={`works/${i + 1}.webp`} ratio="3 / 4" />
          ))}
        </Grid>
      </>
    ),
  },
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `ex-award-${i + 1}`,
    ch: 'exhibition',
    alt: `프로젝트 전시회 수상작 ${exAwards[i * 2].title}${exAwards[i * 2 + 1] ? ', ' + exAwards[i * 2 + 1].title : ''}`,
    render: () => (
      <>
        <Head title="수상작" sub={`2026 1학기 프로젝트 전시회, 최우수상 1점과 우수상 13점 (${i * 2 + 1}~${i * 2 + 2} / 14)`} />
        <AwardPair>{exAwards.slice(i * 2, i * 2 + 2).map(exAward)}</AwardPair>
      </>
    ),
  })),
  {
    id: 'ex-ceremony',
    ch: 'exhibition',
    alt: '시상식',
    render: () => (
      <>
        <Head title="시상식" sub="2026.06.04 18:00 C.square Blue, 종강 총회 병행" />
        <div className="ap-stackp">
          <Photo s="jongchong/2.webp" h={188} />
          <Photo s="jongchong/1.webp" h={188} />
          <Photo s="jongchong/3.webp" h={188} />
        </div>
      </>
    ),
  },
  {
    id: 'ex-install',
    ch: 'exhibition',
    alt: '전시 포스터 설치 현장',
    render: () => (
      <>
        <Head title="전시 현장" sub="전시회 포스터 공모전 수상작이 전시의 얼굴로 활용되었습니다" />
        <Grid cols={2} gap={10}>
          <Cell s="poster-photos/4.webp" ratio="5 / 6" />
          <Cell s="poster-photos/7.webp" ratio="5 / 6" />
          <Cell s="poster-photos/13.webp" ratio="5 / 6" />
          <Cell s="poster-photos/21.webp" ratio="5 / 6" />
        </Grid>
      </>
    ),
  },
  {
    id: 'ex-262',
    ch: 'exhibition',
    alt: '2026 2학기 전시회',
    render: () => (
      <>
        <Head title="2026 2학기 전시회" sub="제19회 디지털인문예술전공 프로젝트 전시회" />
        <Table
          head={['구분', '일정']}
          cols={['30%', '70%']}
          rows={[
            ['작품 접수', '2026.10.01 ~ 11.13'],
            ['수정 마감', '2026.11.24'],
            ['전공 박람회', '2026.11.18 (예정)'],
            ['프로젝트 전시회', '2026.12.02 ~ 12.04 (예정)'],
            ['종강 총회', '2026.12.04 (예정)'],
          ]}
        />
        <p className="ap-body">서비스 디자인, UI 디자인, 디자인 씽킹, 캡스톤디자인 등 2학기 과목과 전공 동아리, 자율 참가 접수. 전시 장소와 결과는 행사가 끝난 뒤 이어서 수록합니다.</p>
        <SiteShot k="exhibitions" cap="전공 웹사이트의 프로젝트 전시회 페이지" h={290} />
      </>
    ),
  },
  {
    id: 'ex-262-sys',
    ch: 'exhibition',
    alt: '2학기 접수 방식',
    render: () => (
      <>
        <Head title="접수 방식의 변화" sub="2학기 전시회부터 전공 웹사이트에서 작품 접수" />
        <Table
          head={['항목', '내용']}
          cols={['26%', '74%']}
          rows={[
            ['접수 창구', '전공 웹사이트 한 곳'],
            ['본인 확인', '구글 계정 로그인'],
            ['입력', '한 페이지에 참가 유형, 신청자, 과목, 원본 파일, 작품 정보'],
            ['확인', '제출 후 접수 확인 메일 발송'],
            ['수정', '수정 마감까지 같은 계정으로 직접 수정'],
            ['파일', '학기와 과목별 폴더로 자동 정리'],
          ]}
        />
        <SiteShot k="submit" cap="전시회 접수 화면" h={290} />
      </>
    ),
  },

  // ===== 07 Contests =====
  { id: 'op-contest', ch: 'contest', tone: 'opener', alt: '07 Contests 공모전', render: () => <Opener id="contest" /> },
  {
    id: 'ct-sites',
    ch: 'contest',
    alt: '공모전 전용 사이트',
    render: () => (
      <>
        <Head title="공모전 전용 사이트" sub="안내, 출품, 투표, 결과를 한 사이트에서 확인" />
        <Bullets
          items={[
            '신규 캐릭터 공모전 사이트: 출품작 포스터, 온라인 투표, 결과 확인',
            '전시회 포스터 공모전 사이트: 안내, 수상작, 갤러리',
            '장서표 디자인 공모전 사이트',
            '전공 웹사이트의 공모전 회차별 기록으로 연결',
          ]}
        />
        <SiteShot k="contests" cap="공모전 회차별 포스터 기록" h={300} />
      </>
    ),
  },
  {
    id: 'ct-char-1',
    ch: 'contest',
    alt: '신규 캐릭터 공모전 1등 디숭이, 2등 디푸',
    render: () => (
      <>
        <Head title="신규 캐릭터 공모전" sub="2026년 신설, 출품작 9점 중 투표 1등과 2등" />
        <AwardPair>
          {characterWorks.slice(0, 2).map((c) => (
            <Award key={c.k} img={`characters/${c.k}.webp`} grade={c.r} line={`온라인 투표 ${c.v}`} title={c.n} who={`${c.by}, ${c.major}`} desc={`${c.d}${c.note ? ' ' + c.note + '.' : ''}`} />
          ))}
        </AwardPair>
      </>
    ),
  },
  {
    id: 'ct-char-2',
    ch: 'contest',
    alt: '신규 캐릭터 공모전 3등 도도와 나머지 출품작',
    render: () => {
      const c = characterWorks[2]
      return (
        <>
          <Head title="신규 캐릭터 공모전" sub="투표 3등과 나머지 출품작" />
          <Table
            head={['구분', '내용']}
            cols={['26%', '74%']}
            rows={[
              ['일정', '2026.03.23 접수 시작, 05.02 온라인 투표, 05.08 결과 발표'],
              ['심사', '투표 100% (주전공생, 복수전공생, 교수진 투표 합산)'],
              ['시상', '1등 30만원, 2등과 3등 각 10만원'],
            ]}
            small
          />
          <div className="ap-awone" style={{ gridTemplateColumns: '176px 1fr', gap: 20 }}>
            <div className="ap-aw__img">
              <Img s={`characters/${c.k}.webp`} alt={`${c.r} ${c.n}`} />
            </div>
            <div className="ap-aw__tx">
              <span className="ap-aw__g">{c.r}</span>
              <p className="ap-aw__c">온라인 투표 {c.v}</p>
              <h3 className="ap-aw__t">{c.n}</h3>
              <p className="ap-aw__w">{c.by}, {c.major}</p>
              <p className="ap-aw__d">{c.d}</p>
            </div>
          </div>
          <H3>그 밖의 출품작 6점</H3>
          <Grid cols={6} gap={8} dense>
            {characterWorks.slice(3).map((x) => (
              <Cell key={x.k} s={`characters/${x.k}.webp`} ratio="1 / 1.4142" cap={x.n} sub={x.by} contain />
            ))}
          </Grid>
        </>
      )
    },
  },
  {
    id: 'ct-poster-1',
    ch: 'contest',
    alt: '전시회 포스터 공모전 최우수상 Against the Flow, 우수상 Un-formatted',
    render: () => (
      <>
        <Head title="전시회 포스터 공모전" sub="2026 1학기 프로젝트 전시회 포스터, 수상작 5점 중 1~2" />
        <AwardPair>
          {posterAwards.slice(0, 2).map((a) => (
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={`${a.who}, ${a.major}`} />
          ))}
        </AwardPair>
      </>
    ),
  },
  {
    id: 'ct-poster-2',
    ch: 'contest',
    alt: '전시회 포스터 공모전 우수상 에러 418, 개화',
    render: () => (
      <>
        <Head title="전시회 포스터 공모전" sub="수상작 5점 중 3~4" />
        <AwardPair>
          {posterAwards.slice(2, 4).map((a) => (
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={`${a.who}, ${a.major}`} />
          ))}
        </AwardPair>
      </>
    ),
  },
  {
    id: 'ct-poster-3',
    ch: 'contest',
    alt: '전시회 포스터 공모전 장려상 흔열',
    render: () => {
      const a = posterAwards[4]
      return (
        <>
          <Head title="전시회 포스터 공모전" sub="수상작 5점 중 5" />
          <div className="ap-awone">
            <div className="ap-aw__img">
              <Img s={a.img} alt={`${a.grade} ${a.title}`} />
            </div>
            <div className="ap-aw__tx">
              <span className="ap-aw__g">{a.grade}</span>
              <h3 className="ap-aw__t">{a.title}</h3>
              <p className="ap-aw__w">{a.who}, {a.major}</p>
            </div>
          </div>
          <Table
            head={['구분', '내용']}
            cols={['26%', '74%']}
            rows={[
              ['공모', '2026학년도 1학기 디지털인문예술전공 전시회 포스터 공모전, 2026.05.02 공지'],
              ['주관', '인문사회 융합인재양성사업단(L-HUSS)'],
              ['수상', '최우수상 1점, 우수상 3점, 장려상 1점'],
              ['활용', '최우수상 포스터는 1학기 전시회의 포스터로 쓰였습니다'],
            ]}
            small
          />
        </>
      )
    },
  },
  {
    id: 'ct-book-1',
    ch: 'contest',
    alt: '장서표 디자인 공모전 최우수상 고요한 기적, 우수상 온고지신',
    render: () => (
      <>
        <Head title="장서표 디자인 공모전" sub="인제 기적의 도서관, 수상작 5점 중 1~2" />
        <AwardPair>
          {bookplateAwards.slice(0, 2).map((a) => (
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={`${a.who}, ${a.major}`} />
          ))}
        </AwardPair>
      </>
    ),
  },
  {
    id: 'ct-book-2',
    ch: 'contest',
    alt: '장서표 디자인 공모전 우수상 사이의 서가, 방황하는 페이지들의 이정표',
    render: () => (
      <>
        <Head title="장서표 디자인 공모전" sub="수상작 5점 중 3~4" />
        <AwardPair>
          {bookplateAwards.slice(2, 4).map((a) => (
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={`${a.who}, ${a.major}`} />
          ))}
        </AwardPair>
      </>
    ),
  },
  {
    id: 'ct-book-3',
    ch: 'contest',
    alt: '장서표 디자인 공모전 장려상 첵의 물길',
    render: () => {
      const a = bookplateAwards[4]
      return (
        <>
          <Head title="장서표 디자인 공모전" sub="수상작 5점 중 5" />
          <div className="ap-awone">
            <div className="ap-aw__img">
              <Img s={a.img} alt={`${a.grade} ${a.title}`} />
            </div>
            <div className="ap-aw__tx">
              <span className="ap-aw__g">{a.grade}</span>
              <h3 className="ap-aw__t">{a.title}</h3>
              <p className="ap-aw__w">{a.who}, {a.major}</p>
            </div>
          </div>
          <Table
            head={['구분', '내용']}
            cols={['26%', '74%']}
            rows={[
              ['공모', '2026 강원과 함께 하는 도서관 장서표 디자인 공모전, 2026.05.02 공지'],
              ['대상 도서관', '인제 기적의 도서관'],
              ['주관', '인문사회 융합인재양성사업단(L-HUSS)'],
              ['수상', '최우수상 1점, 우수상 3점, 장려상 1점'],
            ]}
            small
          />
        </>
      )
    },
  },

  // ===== 08 Branding =====
  { id: 'op-brand', ch: 'brand', tone: 'opener', alt: '08 Branding 인스타그램과 브랜딩', render: () => <Opener id="brand" lead="@hallym_lucid" /> },
  {
    id: 'br-unify',
    ch: 'brand',
    alt: '인스타그램 디자인 통일',
    render: () => (
      <>
        <Head title="디자인 통일" sub="@hallym_lucid" />
        <p className="ap-body">모집, 행사 안내, 공모전, 전시회 수상작, 동아리 홍보까지 모든 게시물을 LUCID의 하나의 디자인으로 통일하여 정비하였습니다. 게시물 한 장만으로 전공 운영위원회 계정임을 알아볼 수 있는 구성입니다.</p>
        <Grid cols={3} gap={10}>
          {['insta/recruit-1.webp', 'insta/gaechong-1.webp', 'insta/character-1.webp', 'insta/event-1.webp', 'insta/fair-1.webp', 'insta/closing-1.webp'].map((s) => (
            <Cell key={s} s={s} ratio="3 / 4" />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'br-series-1',
    ch: 'brand',
    alt: '전시 안내 게시물 시리즈',
    render: () => (
      <>
        <Head title="전시 안내 시리즈" sub="전시회 접수, 안내, 작품 제출 게시물" />
        <Grid cols={3} gap={10}>
          {['exhibit-info/1-1.webp', 'exhibit-info/1-2.webp', 'exhibit-info/1-3.webp', 'exhibit-info/2-1.webp', 'exhibit-info/2-5.webp', 'exhibit-info/2-7.webp'].map((s) => (
            <Cell key={s} s={s} ratio="3 / 4" />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'br-series-2',
    ch: 'brand',
    alt: '동아리 홍보 게시물',
    render: () => (
      <>
        <Head title="동아리 홍보 시리즈" sub="동아리 전시회와 동아리 홍보 카드뉴스" />
        <Grid cols={3} gap={10}>
          {['exhibit-info/3-1.webp', 'exhibit-info/3-2.webp', 'exhibit-info/3-3.webp', 'clubs/ds4h-1.webp', 'clubs/theins-1.webp', 'clubs/iso-1.webp'].map((s) => (
            <Cell key={s} s={s} ratio="3 / 4" />
          ))}
        </Grid>
      </>
    ),
  },

  // ===== 09 Outreach =====
  { id: 'op-out', ch: 'outreach', tone: 'opener', alt: '09 Outreach 행사와 대외 활동', render: () => <Opener id="outreach" /> },
  {
    id: 'out-in',
    ch: 'outreach',
    alt: '전공 행사와 일정',
    render: () => (
      <>
        <Head title="전공 행사와 일정" sub="2026 1학기 진행 행사와 2학기 일정" />
        <Numbered
          items={[
            ['개강 총회와 비전 설명회', '2026.03.11 C.square Blue. 운영위원회와 동아리 소개, 전공 비전 설명'],
            ['전공 박람회', '2026 1학기 전공 소개와 홍보. 2학기 전공 박람회는 2026.11.18 예정'],
            ['미래융합스쿨 교류와 연합 엠티', '미래융합스쿨 학생회 교류, 연합 엠티에서 전공 동아리 4곳 소개'],
            ['시상식과 1학기 종강 총회', '2026.06.04 C.square Blue. 프로젝트 전시회 시상식과 학기 마무리'],
            ['2학기 프로젝트 전시회', '2026.12.02 ~ 12.04 예정'],
            ['2학기 종강 총회', '2026.12.04 예정'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'out-ext',
    ch: 'outreach',
    alt: '대외 활동',
    render: () => (
      <>
        <Head title="대외 활동" sub="전공을 알리고 연결한 활동" />
        <Numbered
          items={[
            ['2026 Hallym Local Branding Camp', 'Team LUCID 참가, Station C 방문 외빈을 위한 브랜드 경험 제안'],
            ['Station C 아이데이션 캠프', '2026.04와 05 두 차례 운영 캠프에 Team LUCID 참가'],
            ['전공 나침반', '한림대학교 교수 하계 세미나에서 발표된 전공 10년의 교육 사례를 웹 발표 화면으로 공개'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'out-photos',
    ch: 'outreach',
    alt: '행사 사진',
    render: () => (
      <>
        <Head title="행사 사진" sub="개강 총회, 시상식과 종강 총회" />
        <Grid cols={2} gap={10}>
          <Cell s="gaechong/2.webp" ratio="16 / 9" />
          <Cell s="gaechong/3.webp" ratio="16 / 9" />
          <Cell s="gaechong/4.webp" ratio="16 / 9" />
          <Cell s="gaechong/1.webp" ratio="16 / 9" />
          <Cell s="jongchong/4.webp" ratio="16 / 9" />
          <Cell s="jongchong/5.webp" ratio="16 / 9" />
          <Cell s="jongchong/2.webp" ratio="16 / 9" />
          <Cell s="jongchong/3.webp" ratio="16 / 9" />
        </Grid>
      </>
    ),
  },

  // ===== 10 Achievements =====
  { id: 'op-ach', ch: 'achievements', tone: 'opener', alt: '10 Achievements 학생 성과', render: () => <Opener id="achievements" /> },
  {
    id: 'ach-top',
    ch: 'achievements',
    alt: '대표 성과',
    render: () => (
      <>
        <Head title="대표 성과" sub="전공 웹사이트에 2026년으로 기록된 학생 성과 21건 중 대상 6건" />
        <div className="ap-feats">
          <section>
            <b>4년 연속</b>
            <strong>세계일류 디자이너 양성사업(KDM+) 선발</strong>
            <p>2023년 첫 선발 이후 4년 연속 선발자 배출. 2026년 7기에 두 명 동시 선발.</p>
          </section>
          <section>
            <b>이사장상 2회</b>
            <strong>앵커 경진대회 한국연구재단 이사장상</strong>
            <p>앵커 참여 대학(원)생 우수사례 경진대회 최우수상, 앵커 AI-Solution 경진대회 우수상.</p>
          </section>
          <section>
            <b>대상 6건</b>
            <strong>2026년 대상 수상</strong>
            <p>동해시 AI 아이디어톤, 한림 AI 교육 포털 오픈 공모전, 지역사회 문제해결 PBL 경진대회, 커리어 인바디 아이디어 공모전, 한림 로컬 창업 빌드업, Town MICE 아이디어톤.</p>
          </section>
        </div>
      </>
    ),
  },
  ...[
    [0, 6],
    [6, 12],
    [12, 17],
    [17, 21],
  ].map(([a, b], i) => ({
    id: `ach-${i + 1}`,
    ch: 'achievements',
    alt: `2026 수상과 선발 ${a + 1}번부터 ${b}번`,
    render: () => (
      <>
        <Head title="2026 수상과 선발" sub={`${a + 1}~${b} / 21`} />
        <ul className="ap-acl">
          {achievements21.slice(a, b).map((x) => (
            <li key={x.c + x.t + x.w + x.g}>
              <span className={`ap-acl__g ${x.g === '대상' ? 'is-top' : ''}`}>{x.g}</span>
              <div>
                <strong>{x.c}</strong>
                {x.t && <p>{x.t}</p>}
                <em>
                  {x.w}
                  {x.x ? `, ${x.x}` : ''}
                </em>
              </div>
            </li>
          ))}
        </ul>
      </>
    ),
  })),

  // ===== 11 Activities =====
  { id: 'op-clubs', ch: 'clubs', tone: 'opener', alt: '11 Activities 전공 동아리', render: () => <Opener id="clubs" lead="학생이 직접 기획하고 운영하는 4개 분야의 동아리" /> },
  {
    id: 'clubs',
    ch: 'clubs',
    alt: '전공 동아리 4곳',
    render: () => (
      <>
        <Head title="전공 동아리" sub="4개 분야의 동아리를 학생들이 직접 기획하고 운영하며 다양한 분야의 지식과 역량 축적" />
        <div className="ap-clubs">
          {clubsInfo.map((c) => (
            <article key={c.id}>
              <div className="ap-logo">
                <Img s={c.logo} alt={`${c.name} 로고`} />
              </div>
              <h3>
                {c.name}
                <small>{c.field}</small>
              </h3>
              <p>{c.lead}</p>
            </article>
          ))}
        </div>
      </>
    ),
  },
  ...clubsInfo.map((c) => ({
    id: `club-${c.id}`,
    ch: 'clubs',
    alt: `동아리 ${c.name}`,
    render: () => (
      <>
        <Head title={c.name} sub={`${c.nameEn}, ${c.field} 동아리`} />
        <div className="ap-club">
          <div className="ap-club__top">
            <div className="ap-logo" style={{ width: 88, height: 88 }}>
              <Img s={c.logo} alt={`${c.name} 로고`} />
            </div>
            <p>{c.lead}</p>
          </div>
          <div>
            <H3>활동</H3>
            <Bullets items={c.items} />
          </div>
          <Table head={['구분', '내용']} cols={['24%', '76%']} rows={c.info} small />
          <div className="ap-club__imgs">
            {c.imgs.map((s) => (
              <Cell key={s} s={s} ratio="4 / 5" />
            ))}
          </div>
        </div>
      </>
    ),
  })),
  {
    id: 'clubs-record',
    ch: 'clubs',
    alt: '동아리 활동 기록',
    render: () => (
      <>
        <Head title="활동 기록" sub="연합 엠티 동아리 소개와 동아리 전시회" />
        <Photo s="clubs/mt-overview.webp" h={288} cap="연합 엠티 동아리 소개 발표" contain />
        <Grid cols={3} gap={10}>
          {['exhibit-info/3-1.webp', 'exhibit-info/3-2.webp', 'exhibit-info/3-3.webp'].map((s) => (
            <Cell key={s} s={s} ratio="3 / 4" />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'closing',
    ch: 'clubs',
    alt: '맺음말과 제작 정보',
    render: () => (
      <>
        <Head title="맺음말" />
        <div className="ap-prose">
          <p>2026년은 학생회에서 운영위원회로 바뀐 첫 해이자 전공 운영이 웹으로 옮겨 간 해입니다.</p>
          <p>2학기 전공 박람회, 프로젝트 전시회, 종강 총회와 새 성과는 이 리포트에 이어서 수록합니다.</p>
          <p className="ap-sign">{reportMeta.council}</p>
        </div>
        <H3>제작 정보</H3>
        <Table
          cols={['26%', '74%']}
          rows={[
            ['발행', `${reportMeta.org} ${reportMeta.council}`],
            ['형식', '웹에서 넘겨 보는 디지털 판'],
            ['이전 판', '2025 애뉴얼 리포트(A4 40쪽 PDF)'],
            ['자료', '1학기와 2학기 운영위원회 활동 자료, 전공 웹사이트 기록'],
          ]}
          small
        />
      </>
    ),
  },
  {
    id: 'back',
    tone: 'cover',
    alt: '뒷표지',
    render: () => (
      <div className="ap-cover ap-cover--back">
        <div className="ap-mark">
          <img src="/images/decade/lucid-mark.svg" alt="" draggable="false" />
        </div>
        <p className="ap-cover__org">{reportMeta.org}</p>
        <p className="ap-cover__sub">{reportMeta.title}</p>
        <div className="ap-qr ap-qr--back">
          <img src={`${IMG}/site-qr.svg`} alt="" />
          <p>{SITE_URL}</p>
        </div>
      </div>
    ),
  },
]

// 사진과 이름만 있는 작은 인물 칸
function RosterCellLite({ id }) {
  const p = prof(id)
  return (
    <article>
      <div className="ap-roster__photo">
        <Img s={`faculty/${id}.webp`} alt={p.nameKr} />
      </div>
      <div className="ap-roster" style={{ display: 'block' }}>
        <strong>{p.nameKr}</strong>
        <span>{roleOf(p)}</span>
      </div>
    </article>
  )
}

function Toc({ toc }) {
  return (
    <>
      <Head title="목차" />
      <ol className="ap-toc">
        {toc.map((c) => (
          <li key={c.id}>
            <span className="ap-toc__no">{c.no}</span>
            <div>
              <strong>
                {c.en} <em>{c.title}</em>
              </strong>
              <p>{c.items.join(', ')}</p>
            </div>
            <span className="ap-toc__page">{String(c.page).padStart(2, '0')}</span>
          </li>
        ))}
      </ol>
    </>
  )
}
