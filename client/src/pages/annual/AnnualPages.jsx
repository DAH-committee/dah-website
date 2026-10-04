// AnnualPages.jsx: 애뉴얼 리포트의 모든 쪽(600 x 800 고정 판형). 렌더 화면(/annual-report/render)에서만 쓴다.
// 이 쪽들을 이미지로 구워 책 화면(/annual-report)이 캔버스로 넘긴다.
import { councils } from '../../data/council'
import { history } from '../../data/history'
import { curriculum } from '../../data/curriculum'
import { tracks } from '../../data/tracks'
import { nanodegree } from '../../data/nanodegree'
import { professors } from '../../data/professors'
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
  councilCube,
  regularEvents,
  yearFlow,
  axCompare,
  axNew,
  submitFlow,
  exhibitionArchive,
  exhibition261Schedule,
  exhibition261Programs,
  exhibition261Awards,
  characterWorks,
  achievements2026,
  clubsInfo,
} from '../../data/annualContent'

const council2026 = councils.find((c) => c.year === 2026)
const ch = (id) => chapters.find((c) => c.id === id)
const src = (s) => (s.startsWith('/') ? s : `${IMG}/${s}`)

const Img = ({ s, alt = '', style, className = '' }) => <img src={src(s)} alt={alt} className={`ap-img ${className}`} style={style} draggable="false" />

const Head = ({ id, title, sub }) => {
  const c = ch(id)
  return (
    <header className="ap-head">
      <p className="ap-run">
        <span>{c.no}</span> {c.en}
      </p>
      <h2 className="ap-title">{title}</h2>
      {sub && <p className="ap-sub">{sub}</p>}
    </header>
  )
}

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

const Photo = ({ s, h, cap, alt }) => (
  <figure className="ap-photo" style={{ height: h }}>
    <Img s={s} alt={alt || cap || ''} />
    {cap && <figcaption>{cap}</figcaption>}
  </figure>
)

const Cell = ({ s, cap, sub, ratio = '4 / 5' }) => (
  <figure className="ap-cell">
    <div className="ap-cell__img" style={{ aspectRatio: ratio }}>
      <Img s={s} />
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

// 최상위 수상작 한 쪽 전체
const BigWinner = ({ rank, title, meta, img, note }) => (
  <div className="ap-big">
    <div className="ap-big__img">
      <Img s={img} alt={`${rank} ${title}`} />
    </div>
    <div className="ap-big__cap">
      <span>{rank}</span>
      <strong>{title}</strong>
      <p>{meta}</p>
      {note && <p className="ap-big__note">{note}</p>}
    </div>
  </div>
)

const prof = (id) => professors.find((p) => p.id === id)
const roleOf = (p) => (p.id === 'han-soomi' ? '주임교수' : p.role.replace('디지털인문예술전공 ', '') || '교수')
const sortedHistory = [...history].sort((a, b) => a.date.localeCompare(b.date))

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
          {d.en}
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

// 쪽 정의 ---------------------------------------------------------------------------------
// ch: 장 id, tone: paper | dark | opener | cover, alt: 접근성 대체 문구
export const pages = [
  // 0 표지
  {
    id: 'cover',
    tone: 'cover',
    alt: '2026 디지털 애뉴얼 리포트 표지',
    render: () => (
      <div className="ap-cover">
        <p className="ap-cover__org">{reportMeta.org}</p>
        <p className="ap-cover__year">2026</p>
        <h1>
          DIGITAL
          <br />
          ANNUAL REPORT
        </h1>
        <p className="ap-cover__sub">디지털 애뉴얼 리포트</p>
        <div className="ap-cover__mosaic">
          {[
            'works/3.webp', 'results-1/8.webp', 'works/9.webp', 'characters/disoong-i.webp', 'awards-1/5.webp', 'works/14.webp',
            'results-1/1.webp', 'works/5.webp', 'awards-1/3.webp', 'works/12.webp', 'results-1/9.webp', 'works/18.webp',
          ].map((s) => (
            <Img key={s} s={s} />
          ))}
        </div>
        <p className="ap-cover__council">{reportMeta.council}</p>
      </div>
    ),
  },
  // 1 발간사
  {
    id: 'foreword',
    alt: '발간사',
    render: () => (
      <>
        <header className="ap-head">
          <p className="ap-run">Foreword</p>
          <h2 className="ap-title">발간사</h2>
        </header>
        <div className="ap-prose">
          <p>
            한림대학교 디지털인문예술전공 제1대 운영위원회 LUCID는 2026년 한 해의 활동과 성과를 이 리포트에 담았습니다.
          </p>
          <p>
            2026년은 학생회가 운영위원회로 바뀌어 첫 대를 시작한 해입니다. 프로젝트 전시회 두 학기 운영, 신규 캐릭터 공모전 신설,
            공모전 전용 사이트 제작, 인스타그램 디자인 통일, 전공 웹사이트 제작과 전시회 접수 통합이 이어졌습니다.
          </p>
          <p>
            2025 리포트의 구성인 전공 소개, 교과목, 교수진, 행사, 학생 활동을 그대로 이어받고 2026년의 변화를 더했습니다. 형식은
            인쇄본(PDF)에서 웹에서 넘겨 보는 디지털 판으로 바뀌었습니다.
          </p>
          <p>2학기 프로젝트 전시회는 현재 접수 중이며, 전시가 끝나면 결과를 이어서 수록합니다.</p>
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
        <Head id="about" title="전공 소개" sub="“한림대학교 디지털인문예술전공을 소개합니다”" />
        <Photo s="gaechong/5.webp" h={196} cap="2026.03.11 개강 총회" />
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
        <Head id="about" title="트랙 소개" />
        <div className="ap-tracks">
          {tracks.map((t) => (
            <section key={t.id}>
              <h3>
                <span>{t.no}</span> {t.name}
              </h3>
              <p>{t.summary}</p>
              <div className="ap-chips">
                {t.keywords.map((k) => (
                  <i key={k}>{k}</i>
                ))}
              </div>
              <h4>관련 진로</h4>
              <Bullets items={trackCareers[t.id]} />
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
        <Head id="about" title="인재상" sub={talent.lead} />
        <div className="ap-venn" aria-hidden="true">
          <div className="ap-venn__c ap-venn__c--a">
            <b>Digital</b>
            <span>디지털 역량</span>
            <small>기술, 디자인</small>
          </div>
          <div className="ap-venn__c ap-venn__c--b">
            <b>Creative</b>
            <span>창의적인 발상</span>
          </div>
          <div className="ap-venn__c ap-venn__c--c">
            <b>Human</b>
            <span>인문사회적 소양</span>
          </div>
        </div>
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
        <Head id="about" title="비전" />
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
        <Head id="about" title="연혁" sub="2017년 설립 이후의 주요 기록" />
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
        <Head id="curriculum" title="교과목 편성표" sub="트랙별 교과목 편성표 (학점-강의-실습)" />
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
        <Head id="curriculum" title="교과목 편성표" sub="트랙별 교과목 편성표 (학점-강의-실습)" />
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
        <Head id="curriculum" title="2025에서 2026으로" sub="2025 리포트와 2026 사이트 기준의 교과목 구성 비교" />
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
        <Head id="curriculum" title="나노디그리" sub="디지털인문예술전공 나노디그리 안내" />
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
        <Head id="curriculum" title="나노디그리" sub="과정별 인정 교과목" />
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
    alt: '교수진 구성',
    render: () => (
      <>
        <Head id="faculty" title="교수진 구성" sub="디지털인문예술전공 교수진 11명" />
        <Table
          head={['이름', '직함', '소속']}
          cols={['22%', '38%', '40%']}
          rows={professors.map((p) => [p.nameKr, roleOf(p), p.affiliation || '디지털인문예술전공'])}
        />
        <p className="ap-note">2026.09.01 한수미 교수 전공주임교수 취임</p>
      </>
    ),
  },
  { id: 'fac-1', ch: 'faculty', alt: '교수 소개 김용수, 김성우', render: () => <><Head id="faculty" title="교수 소개" /><div className="ap-profs"><Prof id="kim-yongsoo" /><Prof id="kim-sungwoo" /></div></> },
  { id: 'fac-2', ch: 'faculty', alt: '교수 소개 유인선, 한수미', render: () => <><Head id="faculty" title="교수 소개" /><div className="ap-profs"><Prof id="yoo-inseon" /><Prof id="han-soomi" /></div></> },
  { id: 'fac-3', ch: 'faculty', alt: '교수 소개 양태근, 이정근', render: () => <><Head id="faculty" title="교수 소개" /><div className="ap-profs"><Prof id="yang-taegeun" /><Prof id="lee-junggeun" /></div></> },
  {
    id: 'fac-4',
    ch: 'faculty',
    alt: '교수 소개 송인재와 겸임교수',
    render: () => (
      <>
        <Head id="faculty" title="교수 소개" />
        <div className="ap-profs">
          <Prof id="song-injae" />
        </div>
        <H3>겸임교수와 지원</H3>
        <Table
          head={['이름', '직함']}
          cols={['30%', '70%']}
          rows={['lee-eunsol', 'seo-joohee', 'kim-jeehyun', 'song-hanna'].map((id) => [prof(id).nameKr, prof(id).role])}
        />
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
        <Head id="council" title="학생회의 역사" sub="2017년 전공 설립과 함께 시작한 학생 조직" />
        <Table
          head={['연도', '학생 조직']}
          cols={['22%', '78%']}
          rows={councils.map((c) => [String(c.year), c.title])}
        />
        <H3>{councilCube.title}</H3>
        <p className="ap-body">{councilCube.intro}</p>
        <p className="ap-body">
          {councilCube.work} {councilCube.workEx}
        </p>
      </>
    ),
  },
  {
    id: 'council-change',
    ch: 'council',
    alt: '학생회에서 운영위원회로',
    render: () => (
      <>
        <Head id="council" title="학생회에서 운영위원회로" sub="2026, 이름과 구조가 바뀐 첫 해" />
        <div className="ap-prose">
          <p>
            2025년까지 전공의 학생 대표 조직은 학생회였고 마지막 대는 제7대 CUBE였습니다. 2026년에 학생회라는 이름을 제1대 운영위원회
            LUCID로 바꾸고 대수를 새로 시작했습니다.
          </p>
          <p>학생회의 역할을 이어받으면서 전시회 접수, 공모전, 전공 웹사이트 운영 등 전공 운영 실무를 위원회가 직접 맡는 구조입니다.</p>
        </div>
        <Table
          head={['', '2025', '2026']}
          cols={['16%', '40%', '44%']}
          rows={[
            ['명칭', '제7대 학생회 CUBE', '제1대 운영위원회 LUCID'],
            ['인원', '12명', '10명'],
            ['구성', '학회장, 부학회장, 전시, 대외, 홍보, 기획', '위원장, 부위원장, 기획부, 홍보부, 웹전시부'],
          ]}
        />
        <p className="ap-note">웹전시부는 2025 학생회 구성에 없던 부서로, 전시회 사이트와 웹 전시를 맡습니다.</p>
      </>
    ),
  },
  {
    id: 'council-lucid',
    ch: 'council',
    alt: 'LUCID 소개',
    render: () => (
      <>
        <Head id="council" title="LUCID" sub="2026 1st Student Council" />
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
        <Head id="council" title="조직" sub="위원장, 부위원장과 세 개 부서 총 10명" />
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
        <Head id="council" title="정기 운영 행사" sub="한 학기의 시작부터 끝까지 운영하는 전공 공식 행사 7종" />
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
        <Head id="council" title="2026년의 흐름" sub="공지, 행사 일정, 개발 기록 기준" />
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
        <Head id="council" title="개강 총회" sub="2026.03.11 C.square Blue" />
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
        <Head id="ax" title="작년과 올해" sub="전공 운영 도구가 구글 문서에서 전공 웹사이트로 이동" />
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
        <Head id="ax" title="전공 웹사이트" sub="구글 사이트 운영에서 자체 개발 사이트로 전환" />
        <p className="ap-body">구글 사이트로 운영하던 전공 웹사이트를 자체 개발한 사이트로 교체하였습니다. 한국어와 영어를 함께 지원합니다.</p>
        <Bullets
          items={[
            '정보 구조: 전공 소개, 학사 안내, 학과 행사, 학생 활동, 공지사항, 자료실',
            '권한 4단계 운영과 학생 운영진의 코딩 없는 화면 직접 편집',
            '전시회 아카이브 18건, 학생 성과 38건, 동아리 4건, 공지 19건 관리',
            '개발 기록 2026.07.06 시작, 10월 현재 진행 중',
          ]}
        />
        <Photo s="site/home.webp" h={200} cap="전공 웹사이트 첫 화면" />
      </>
    ),
  },
  {
    id: 'ax-submit',
    ch: 'ax',
    alt: '전시회 접수 통합',
    render: () => (
      <>
        <Head id="ax" title="전시회 접수 통합" sub="구글 폼과 앱스 스크립트로 나뉘어 있던 접수를 전공 웹사이트 한 곳으로 통합" />
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
        <Photo s="site/submit.webp" h={190} cap="전시회 접수 화면" />
      </>
    ),
  },
  {
    id: 'ax-forms',
    ch: 'ax',
    alt: '신청 폼',
    render: () => (
      <>
        <Head id="ax" title="신청 폼 편집기" sub="종강 총회, 부원 모집 등 각종 신청을 구글 폼 없이 사이트 안에서 운영" />
        <Bullets
          items={[
            '구글 폼과 같은 방식의 질문 편집기',
            '객관식, 체크박스, 드롭다운, 선형 배율, 날짜, 시간 등 12가지 질문 유형',
            '구글 시트 형태의 응답 시트에서 응답 확인과 수정',
            '폼별 제출 확인 메일 사용 여부 설정',
            '폼 복사로 다음 학기 신청 폼 즉시 생성',
          ]}
        />
        <Photo s="site/exhibitions.webp" h={200} cap="프로젝트 전시회 페이지" />
      </>
    ),
  },
  {
    id: 'ax-new',
    ch: 'ax',
    alt: '올해 새로 생긴 기능',
    render: () => (
      <>
        <Head id="ax" title="올해 새로 생긴 기능" />
        <Table head={['기능', '내용']} cols={['28%', '72%']} rows={axNew} />
        <p className="ap-note">전시 원본은 인쇄용 파일 그대로 구글 드라이브에 보관하고, 웹 노출용 이미지는 용량을 줄인 웹용으로 별도 제작합니다.</p>
      </>
    ),
  },
  {
    id: 'ax-shots-1',
    ch: 'ax',
    alt: '전공 웹사이트 화면',
    render: () => (
      <>
        <Head id="ax" title="화면 모음" sub="전공 웹사이트" />
        <Photo s="site/home.webp" h={248} cap="첫 화면" />
        <Photo s="site/exhibitions.webp" h={248} cap="프로젝트 전시회" />
      </>
    ),
  },
  {
    id: 'ax-shots-2',
    ch: 'ax',
    alt: '공모전과 접수 화면',
    render: () => (
      <>
        <Head id="ax" title="화면 모음" sub="공모전과 접수" />
        <Photo s="site/contests.webp" h={248} cap="공모전 회차별 포스터 기록" />
        <Photo s="site/submit.webp" h={248} cap="전시회 접수 화면" />
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
        <Head id="exhibition" title="전시회 18회의 기록" sub="2017년 2학기 제1회부터 2026년 1학기 제18회까지 전공 최대 행사" />
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
    alt: '2026 1학기 전시회 개요',
    render: () => (
      <>
        <Head id="exhibition" title="2026 1학기 전시회" sub="제18회 디지털인문예술전공 프로젝트 전시회, 2026.06.02 ~ 06.04, 캠퍼스라이프센터" />
        <Table head={['일정', '내용']} cols={['30%', '70%']} rows={exhibition261Schedule} />
        <p className="ap-body">디지털인문예술전공 전공 수업과 동아리의 기말 프로젝트 작품 전시. 인쇄 작품 오프라인 전시와 작품 사이트 온라인 전시 병행.</p>
        <Photo s="exhibit/poster.webp" h={250} cap="1학기 전시회 포스터" />
      </>
    ),
  },
  {
    id: 'ex-concept',
    ch: 'exhibition',
    alt: '전시 컨셉 기획',
    render: () => (
      <>
        <Head id="exhibition" title="전시 컨셉 기획" sub="418 I'M A TEAPOT, 휴먼 터치 (CON:NECT 기획안)" />
        <dl className="ap-def">
          <div>
            <dt>슬로건</dt>
            <dd>커피를 요구하는 세상, 따뜻한 차 한 잔</dd>
          </div>
          <div>
            <dt>주제</dt>
            <dd>휴먼 터치(Human touch)</dd>
          </div>
        </dl>
        <div className="ap-prose">
          <p>
            기술이 고도화될수록 기술이 흉내 낼 수 없는 인간의 흔적이 주목받는 흐름에서, 디지털 시스템의 틈새에서 발견되는 인간다움을
            탐구하는 전시입니다.
          </p>
          <p>
            418은 1998년 만우절 농담에서 유래한 기술 표준으로, 커피를 내리라는 요청에 서버가 찻주전자라서 할 수 없다고 답하는 상황입니다.
            정체성에 맞지 않는 요청에 유쾌하게 자기다움을 밝히는 태도를 상징합니다.
          </p>
        </div>
        <Photo s="poster-photos/16.webp" h={230} cap="전시 포스터 설치 현장" />
      </>
    ),
  },
  {
    id: 'ex-programs',
    ch: 'exhibition',
    alt: '전시 프로그램',
    render: () => (
      <>
        <Head id="exhibition" title="전시 프로그램" sub="기획안 기준 현장 프로그램 5종" />
        <Numbered items={exhibition261Programs} />
      </>
    ),
  },
  {
    id: 'ex-posters',
    ch: 'exhibition',
    alt: '전시 포스터 설치 현장',
    render: () => (
      <>
        <Head id="exhibition" title="전시 현장" sub="전시회 포스터 공모전 수상작이 전시 얼굴로 활용" />
        <Grid cols={2} gap={10}>
          <Cell s="poster-photos/4.webp" ratio="1 / 1.1" />
          <Cell s="poster-photos/7.webp" ratio="1 / 1.1" />
          <Cell s="poster-photos/13.webp" ratio="1 / 1.1" />
          <Cell s="poster-photos/21.webp" ratio="1 / 1.1" />
        </Grid>
      </>
    ),
  },
  {
    id: 'ex-top',
    ch: 'exhibition',
    tone: 'dark',
    alt: '2026 1학기 프로젝트 전시회 최우수상 403: Bypass',
    render: () => <BigWinner rank="최우수상" title="403: Bypass" meta="디지털인문예술입문" img="big/exhibit-top.webp" note="2026 1학기 프로젝트 전시회" />,
  },
  {
    id: 'ex-rest',
    ch: 'exhibition',
    alt: '우수상 13점',
    render: () => (
      <>
        <Head id="exhibition" title="우수상" sub="2026 1학기 프로젝트 전시회 우수상 13점" />
        <Grid cols={5} gap={8} dense>
          {exhibition261Awards.slice(1).map(([course, title], i) => (
            <Cell key={title} s={`awards-1/${[7, 6, 5, 4, 3, 2, 15, 14, 13, 12, 11, 10, 9][i]}.webp`} ratio="1 / 1" cap={title} sub={course} />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'ex-works',
    ch: 'exhibition',
    alt: '전시된 작품들',
    render: () => (
      <>
        <Head id="exhibition" title="전시 작품" sub="수업과 동아리의 프로젝트 작품을 온라인 전시 사이트에 게시" />
        <Grid cols={5} gap={7}>
          {Array.from({ length: 20 }, (_, i) => (
            <Cell key={i} s={`works/${i + 1}.webp`} ratio="3 / 4" />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'ex-ceremony',
    ch: 'exhibition',
    alt: '시상식',
    render: () => (
      <>
        <Head id="exhibition" title="시상식" sub="2026.06.04 18:00 C.square Blue, 종강 총회 병행" />
        <div className="ap-stackp">
          <Photo s="jongchong/2.webp" h={188} />
          <Photo s="jongchong/1.webp" h={188} />
          <Photo s="jongchong/3.webp" h={188} />
        </div>
      </>
    ),
  },
  {
    id: 'ex-262',
    ch: 'exhibition',
    alt: '2026 2학기 전시회',
    render: () => (
      <>
        <Head id="exhibition" title="2026 2학기 전시회" sub="제19회 디지털인문예술전공 프로젝트 전시회, 작품 접수 중" />
        <Table
          head={['구분', '일정']}
          cols={['30%', '70%']}
          rows={[
            ['접수 시작', '2026.10.01'],
            ['접수 마감', '2026.11.13'],
            ['수정 마감', '2026.11.24'],
          ]}
        />
        <p className="ap-body">서비스 디자인, UI 디자인, 디자인 씽킹, 캡스톤디자인 등 2학기 과목과 전공 동아리, 자율 참가 접수. 전시 일정과 결과는 전시 종료 후 이어서 수록합니다.</p>
        <Photo s="site/exhibitions.webp" h={230} cap="전공 웹사이트의 프로젝트 전시회 페이지" />
      </>
    ),
  },
  {
    id: 'ex-262-sys',
    ch: 'exhibition',
    alt: '2학기 접수 방식',
    render: () => (
      <>
        <Head id="exhibition" title="접수 방식의 변화" sub="2학기 전시회부터 전공 웹사이트에서 작품 접수" />
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
        <Head id="contest" title="공모전 전용 사이트" sub="안내, 출품, 투표, 결과를 한 사이트에서 확인" />
        <Bullets
          items={[
            '신규 캐릭터 공모전 사이트: 출품작 포스터, 온라인 투표, 결과 확인',
            '전시회 포스터 공모전 사이트: 안내, 수상작, 갤러리',
            '장서표 디자인 공모전 사이트',
            '전공 웹사이트의 공모전 회차별 기록으로 연결',
          ]}
        />
        <Photo s="site/contests.webp" h={250} cap="공모전 회차별 포스터 기록" />
      </>
    ),
  },
  {
    id: 'ct-char-top',
    ch: 'contest',
    tone: 'dark',
    alt: '신규 캐릭터 공모전 1등 디숭이',
    render: () => <BigWinner rank="1등" title="디숭이" meta="온라인 투표 12표, 김지연" img="big/character-top.webp" note="2026 신규 캐릭터 공모전" />,
  },
  {
    id: 'ct-char-rest',
    ch: 'contest',
    alt: '신규 캐릭터 공모전 나머지 출품작',
    render: () => (
      <>
        <Head id="contest" title="신규 캐릭터 공모전" sub="2026년 신설, 출품작 7점" />
        <Table
          head={['구분', '일정']}
          cols={['30%', '70%']}
          rows={[
            ['접수', '2026.03.23 ~ 04.30'],
            ['온라인 투표', '2026.05.02 공지'],
            ['결과 발표', '2026.05.08'],
          ]}
          small
        />
        <Grid cols={3} gap={10} style={{ marginTop: 8 }}>
          {characterWorks.slice(1).map((c) => (
            <Cell key={c.k} s={`characters/${c.k}.webp`} ratio="1 / 1.1" cap={`${c.r ? c.r + ' ' : ''}${c.n}${c.v ? ' ' + c.v : ''}`} sub={c.by} />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'ct-poster-top',
    ch: 'contest',
    tone: 'dark',
    alt: '전시회 포스터 공모전 최우수상',
    render: () => <BigWinner rank="최우수상" title="Against the Flow" meta="2026 1학기 프로젝트 전시회 포스터 공모전" img="big/poster-top.webp" />,
  },
  {
    id: 'ct-poster-rest',
    ch: 'contest',
    alt: '전시회 포스터 공모전 우수상과 장려상',
    render: () => (
      <>
        <Head id="contest" title="전시회 포스터 공모전" sub="2026 1학기 전시회 포스터, 최우수상 1점, 우수상 3점, 장려상 1점" />
        <Grid cols={2} gap={10}>
          {[9, 10, 11, 12].map((n) => (
            <Cell key={n} s={`results-1/${n}.webp`} ratio="1 / 1.1" cap={n === 12 ? '장려상' : '우수상'} />
          ))}
        </Grid>
      </>
    ),
  },
  {
    id: 'ct-book-top',
    ch: 'contest',
    tone: 'dark',
    alt: '장서표 디자인 공모전 최우수상',
    render: () => <BigWinner rank="최우수상" title="인제 기적의 도서관 장서표" meta="2026 강원과 함께 하는 도서관 장서표 디자인 공모전" img="big/bookplate-top.webp" />,
  },
  {
    id: 'ct-book-rest',
    ch: 'contest',
    alt: '장서표 디자인 공모전 우수상과 장려상',
    render: () => (
      <>
        <Head id="contest" title="장서표 디자인 공모전" sub="인제 기적의 도서관, 최우수상 1점, 우수상 3점, 장려상 1점" />
        <Grid cols={2} gap={10}>
          {[2, 3, 4, 5].map((n) => (
            <Cell key={n} s={`results-1/${n}.webp`} ratio="1 / 1.1" cap={n === 5 ? '장려상' : '우수상'} />
          ))}
        </Grid>
      </>
    ),
  },

  // ===== 08 Branding =====
  { id: 'op-brand', ch: 'brand', tone: 'opener', alt: '08 Branding 인스타그램과 브랜딩', render: () => <Opener id="brand" lead="@hallym_lucid" /> },
  {
    id: 'br-unify',
    ch: 'brand',
    alt: '인스타그램 디자인 통일',
    render: () => (
      <>
        <Head id="brand" title="디자인 통일" sub="@hallym_lucid" />
        <p className="ap-body">모집, 행사 안내, 공모전, 전시회 수상작, 동아리 홍보까지 모든 게시물을 LUCID의 하나의 디자인으로 통일하여 정비하였습니다. 게시물 한 장만으로 전공 운영위원회 계정임을 알아볼 수 있는 구성입니다.</p>
        <Grid cols={3} gap={10}>
          {['insta/recruit-1.webp', 'insta/gaechong-1.webp', 'insta/character-1.webp', 'insta/event-1.webp', 'insta/fair-1.webp', 'insta/closing-1.webp'].map((s) => (
            <Cell key={s} s={s} ratio="4 / 5" />
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
        <Head id="brand" title="전시 안내 시리즈" sub="전시회 접수, 안내, 동아리 전시 게시물" />
        <Grid cols={3} gap={10}>
          {['exhibit-info/3-1.webp', 'exhibit-info/1-1.webp', 'exhibit-info/2-1.webp', 'exhibit-info/2-7.webp', 'exhibit-info/3-3.webp', 'exhibit-info/2-5.webp'].map((s) => (
            <Cell key={s} s={s} ratio="4 / 5" />
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
        <Head id="brand" title="동아리 홍보 시리즈" sub="동아리 전시회와 동아리 홍보 카드뉴스" />
        <Grid cols={3} gap={10}>
          {['insta2/club-exhibit-1.webp', 'insta2/club-exhibit-3.webp', 'insta2/club-exhibit-4.webp', 'insta2/club-exhibit-5.webp', 'insta2/DS4H-1.webp', 'insta2/더인스-1.webp'].map((s) => (
            <Cell key={s} s={s} ratio="4 / 5" />
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
    alt: '전공 행사',
    render: () => (
      <>
        <Head id="outreach" title="전공 행사" />
        <Numbered
          items={[
            ['개강 총회와 비전 설명회', '2026.03.11 C.square Blue. 운영위원회와 동아리 소개, 전공 비전 설명'],
            ['전공 박람회', '2026 1학기 전공 소개와 홍보'],
            ['미래융합스쿨 교류와 연합 엠티', '미래융합스쿨 학생회 교류, 연합 엠티에서 전공 동아리 4곳 소개'],
            ['시상식과 종강 총회', '2026.06.04 C.square Blue. 프로젝트 전시회 시상식과 학기 마무리'],
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
        <Head id="outreach" title="대외 활동" sub="전공을 알리고 연결한 활동" />
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
        <Head id="outreach" title="행사 사진" sub="개강 총회, 시상식과 종강 총회" />
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
        <Head id="achievements" title="대표 성과" sub="전공 웹사이트에 2026년으로 기록된 성과 21건 중 대상 6건" />
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
            <p>Town MICE 아이디어톤, 한림 로컬 창업 빌드업, 동해시 AI 아이디어톤, 한림 AI 교육 포털 오픈 공모전, 지역사회 문제해결 PBL 경진대회, 커리어 인바디 아이디어 공모전.</p>
          </section>
        </div>
      </>
    ),
  },
  {
    id: 'ach-1',
    ch: 'achievements',
    alt: '2026 수상과 선발 1',
    render: () => (
      <>
        <Head id="achievements" title="2026 수상과 선발" sub="1 / 2" />
        <ul className="ap-ach">
          {achievements2026.slice(0, 7).map((a) => (
            <li key={a.t}>
              <strong>{a.t}</strong>
              <span>{a.a}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: 'ach-2',
    ch: 'achievements',
    alt: '2026 수상과 선발 2',
    render: () => (
      <>
        <Head id="achievements" title="2026 수상과 선발" sub="2 / 2" />
        <ul className="ap-ach">
          {achievements2026.slice(7).map((a) => (
            <li key={a.t}>
              <strong>{a.t}</strong>
              <span>{a.a}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },

  // ===== 11 Activities =====
  { id: 'op-clubs', ch: 'clubs', tone: 'opener', alt: '11 Activities 전공 동아리', render: () => <Opener id="clubs" lead="학생이 직접 기획하고 운영하는 4개 분야의 동아리" /> },
  {
    id: 'clubs',
    ch: 'clubs',
    alt: '전공 동아리 4곳',
    render: () => (
      <>
        <Head id="clubs" title="전공 동아리" sub="4개 분야의 동아리를 학생들이 직접 기획하고 운영하며 다양한 분야의 지식과 역량 축적" />
        <div className="ap-clubs">
          {clubsInfo.map((c) => (
            <article key={c.name}>
              <h3>
                {c.name} <small>{c.field}</small>
              </h3>
              <p>{c.lead}</p>
              <Bullets items={c.items} />
            </article>
          ))}
        </div>
      </>
    ),
  },
  {
    id: 'clubs-photos',
    ch: 'clubs',
    alt: '동아리 활동 기록',
    render: () => (
      <>
        <Head id="clubs" title="활동 기록" sub="2026 동아리 전시회, 연합 엠티 발표, 홍보 카드뉴스" />
        <Grid cols={2} gap={10}>
          <Cell s="/images/clubs-deck/theinstudio-2.webp" ratio="1 / 1" cap="더 인스튜디오" />
          <Cell s="/images/clubs-deck/iso-2.webp" ratio="1 / 1" cap="I-SO" />
          <Cell s="/images/clubs-deck/connect-2.webp" ratio="1 / 1" cap="CON:NECT" />
          <Cell s="/images/clubs-deck/ds4h-2.webp" ratio="1 / 1" cap="DS4H" />
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
        <header className="ap-head">
          <p className="ap-run">Closing</p>
          <h2 className="ap-title">맺음말</h2>
        </header>
        <div className="ap-prose">
          <p>2026년은 학생회에서 운영위원회로 바뀐 첫 해이자 전공 운영이 웹으로 옮겨 간 해입니다.</p>
          <p>2학기 프로젝트 전시회, 종강 총회, 새 성과는 이 리포트에 이어서 수록합니다.</p>
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
        <div className="ap-mark ap-mark--light">
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

function Toc({ toc }) {
  return (
    <>
      <header className="ap-head">
        <p className="ap-run">Contents</p>
        <h2 className="ap-title">목차</h2>
      </header>
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
