// AnnualPages.jsx: 애뉴얼 리포트의 모든 쪽(600 x 800 고정 판형). 렌더 화면(/annual-report/render)에서만 쓴다.
// 이 쪽들을 이미지로 구워 책 화면(/annual-report)이 캔버스로 넘긴다.
// 사이트 데이터는 라이브 API 스냅샷(siteSnapshot.json, scripts/annual-snapshot.mjs로 갱신)만 쓴다.
// 트랙 요약과 키워드는 사이트 홈과 교육과정 화면이 직접 렌더하는 data/tracks.js를 그대로 쓴다.
import snap from './siteSnapshot.json'
import { tracks } from '../../data/tracks'
import { exAwards } from '../../data/annualAwards'
import {
  IMG,
  SITE_URL,
  reportMeta,
  chapters,
  regularEvents,
  yearFlow,
  axCompare,
  axNew,
  submitFlow,
  workspaceTools,
  exhibitionOps,
  exhibition262Schedule,
  exhibition262Stats,
  contests262,
  exhibitionArchive,
  exhibition261Facts,
  exhibition261Concept,
  exhibition261Prep,
  posterAwards,
  bookplateAwards,
  characterWorks,
  studentAchievements,
  workspaceShare,
  driveLink,
  clubsInfo,
} from '../../data/annualContent'

const about = snap.settings.about
const history = snap.settings.history
const councils = [...snap.council].sort((a, b) => Number(b.year_label) - Number(a.year_label))
const council2026 = councils.find((c) => c.year_label === '2026')
const nanodegree = snap.nanodegree[0].body
const codesharing = snap.codesharing[0].body
const curriculum = snap.curriculum
const professors = [...snap.professors].filter((p) => p.active !== false).sort((a, b) => a.sort - b.sort)
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

// 표 열 너비: 퍼센트를 본문 12열 격자(열 간격 44px)의 배수로 맞춘다. 마지막 열은 남은 폭을 쓴다.
const PITCH = 44
const gridCol = (w) => {
  const pct = parseFloat(w)
  if (!Number.isFinite(pct)) return w
  return `${Math.max(1, Math.round(((pct / 100) * 528) / PITCH)) * PITCH}px`
}
// 열 너비는 격자 칸에 맞추고 가장 넓은 열이 남는 폭을 받는다
const flexCol = (cols) => cols.reduce((m, w, i) => (parseFloat(w) > parseFloat(cols[m]) ? i : m), 0)
const Table = ({ head, rows, cols, small, dense }) => (
  <table className={`ap-table ${small ? 'is-small' : ''} ${dense ? 'is-dense' : ''}`}>
    {cols && (
      <colgroup>
        {cols.map((w, i) => (
          <col key={i} style={{ width: i === flexCol(cols) ? 'auto' : gridCol(w) }} />
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
            <td key={j}>{Array.isArray(c) ? c.map((x, k) => <span key={k} className="ap-line">{x}</span>) : c}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
)

// 이름 목록: "주현호, 조영은" 같은 값을 반점 없이 간격으로 나눠 보여 준다
const Names = ({ v }) => {
  const list = Array.isArray(v) ? v : String(v || '').split(/\s*,\s*/).filter(Boolean)
  return (
    <span className="ap-names">
      {list.map((n) => (
        <span key={n}>{n}</span>
      ))}
    </span>
  )
}

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

// 장 표지: 2025 판처럼 단색 보라 바탕, 은은한 큰 원, 오른쪽 정렬 영문 제목과 하위 목록
const Opener = ({ id, lead }) => {
  const c = ch(id)
  return (
    <div className="ap-opener">
      <span className="ap-opener__ring ap-opener__ring--a" />
      <span className="ap-opener__ring ap-opener__ring--b" />
      <span className="ap-opener__ring ap-opener__ring--c" />
      <div className="ap-opener__body">
        <span className="ap-opener__no">{c.no}</span>
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
  <figure className={`ap-photo ${shot ? 'ap-photo--shot' : ''}`} style={{ height: Math.round(h / 8) * 8 }}>
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

// 격자: 열 사이 16px(12열 격자의 열 사이와 같음). 2, 3, 4, 6열만 12열 격자와 맞는다.
const Grid = ({ cols, children, style, dense }) => (
  <div className={`ap-grid ${dense ? 'is-dense' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16, ...style }}>
    {children}
  </div>
)

// 수상작 카드: 원본 비율(A 규격)로 자르지 않고 보여 주고 아래에 등급, 작품명, 팀과 수상자를 적는다
const topGrade = (g) => g === '최우수상' || g === '1등'
const Award = ({ img, grade, line, title, who, major, desc }) => (
  <article className="ap-aw">
    <div className="ap-aw__img">
      <Img s={img} alt={`${grade} ${title}`} />
    </div>
    <div className="ap-aw__tx">
      <span className={`ap-aw__g ${topGrade(grade) ? 'is-top' : ''}`}>{grade}</span>
      {line && <p className="ap-aw__c">{line}</p>}
      <h3 className="ap-aw__t">{title}</h3>
      {who && (
        <p className="ap-aw__w">
          <Names v={who} />
          {major && <span className="ap-aw__m">{major}</span>}
        </p>
      )}
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
    who={a.members}
    desc={a.desc}
  />
)

// 사진 파일은 한글 이름으로 찾는다. 사이트에서 영문 표기가 바뀌어도(Soomi Han에서 Sumi Han) 사진이 빠지지 않게 한다.
const FACULTY_PHOTO = {
  한수미: 'han-soomi',
  김용수: 'kim-yongsoo',
  김성우: 'kim-sungwoo',
  유인선: 'yoo-inseon',
  송인재: 'song-injae',
  양태근: 'yang-taegeun',
  이정근: 'lee-junggeun',
  이은솔: 'lee-eunsol',
  김지현: 'kim-jeehyun',
  송한나: 'song-hanna',
  서주희: 'seo-joohee',
}
const slug = (p) => {
  if (FACULTY_PHOTO[p.name_ko]) return FACULTY_PHOTO[p.name_ko]
  const [first, ...rest] = p.name_en.trim().split(/\s+/)
  return `${rest.join('-')}-${first}`.toLowerCase()
}
const roleOf = (p) => p.title_ko.replace('디지털인문예술전공', '').trim() || '디지털인문예술전공'
const linkOf = (p, label) => (Array.isArray(p.links) ? p.links.find((l) => l.label === label)?.url : null) || null
const shortUrl = (u) => {
  const t = u.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return t.length > 44 ? t.split('/')[0] : t
}
const sortedHistory = [...history].sort((a, b) => a.date.localeCompare(b.date))

const Prof = ({ p }) => {
  const aff = linkOf(p, 'affiliation')
  const web = linkOf(p, 'website')
  return (
    <article className="ap-prof">
      <div className="ap-prof__photo">
        <Img s={`faculty/${slug(p)}.webp`} alt={`${p.name_ko} 교수`} />
      </div>
      <div className="ap-prof__body">
        <h3>
          {p.name_ko} <small>{roleOf(p)}</small>
        </h3>
        <p className="ap-prof__en">{p.name_en}</p>
        <dl>
          <dt>직함</dt>
          <dd>{p.title_ko}</dd>
          {aff && (
            <>
              <dt>소속</dt>
              <dd>{aff}</dd>
            </>
          )}
          {p.email && (
            <>
              <dt>이메일</dt>
              <dd>{p.email}</dd>
            </>
          )}
          {web && (
            <>
              <dt>웹사이트</dt>
              <dd>{shortUrl(web)}</dd>
            </>
          )}
        </dl>
      </div>
    </article>
  )
}

const RosterCell = ({ p }) => (
  <article>
    <div className="ap-roster__photo">
      <Img s={`faculty/${slug(p)}.webp`} alt={p.name_ko} />
    </div>
    <strong>{p.name_ko}</strong>
    <span>{roleOf(p)}</span>
  </article>
)

const courseRows = (track) =>
  curriculum
    .filter((c) => c.track === track)
    .sort((a, b) => a.semester - b.semester || a.grade - b.grade || a.sort - b.sort)
    .map((c) => [`${c.semester}학기`, track === 'common' ? '공통' : `${c.grade}수준`, c.name_ko, c.credit])
const commonNames = (sem) =>
  curriculum
    .filter((c) => c.track === 'common' && c.semester === sem)
    .sort((a, b) => a.sort - b.sort)
    .map((c) => c.name_ko)

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
    <Table head={['과목번호', '교과목명', '학점']} cols={['22%', '56%', '22%']} rows={p.courses.map((c) => [c.code, c.name, c.credit])} small dense />
  </section>
)

const SiteShot = ({ k, cap, h = 296 }) => <Photo s={`site/${k}.webp`} h={h} cap={cap} shot />

// 쪽 정의 ---------------------------------------------------------------------------------
// ch: 장 id, tone: paper | dark | opener | cover, alt: 접근성 대체 문구
export const pages = [
  // 0 표지: 2025 표지 구성(가로선, 연도와 제목, 알약 라벨, 기하 타일 그리드)을 사진 없이 이어받는다
  {
    id: 'cover',
    tone: 'cover',
    alt: '2026 애뉴얼 리포트 표지',
    render: () => (
      <div className="ap-cover">
        <div className="ap-cover__rule" />
        <h1 className="ap-cover__title">
          <span>2026</span>
          <b>ANNUAL REPORT</b>
        </h1>
        <p className="ap-cover__pill">한림대학교 디지털인문예술전공 애뉴얼 리포트</p>
        <CoverTiles />
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
            2026년은 학생회가 운영위원회로 바뀌어 첫 대를 시작한 해입니다. 위원회는 프로젝트 전시회 두 번과 공모전 다섯 번을 운영했습니다.
            신규 캐릭터 공모전을 새로 만들었고 전공 웹사이트에서 전시회 접수를 받기 시작했습니다.
          </p>
          <p>
            장 구성은 2025 리포트를 이어받고 2026년에 바뀐 내용을 더했습니다. 인쇄본(PDF)이던 리포트를 웹에서 넘겨 보는 디지털 판으로 바꿨습니다.
          </p>
          <p>2학기 전시회와 공모전 결과는 행사가 끝나면 이어서 싣습니다.</p>
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
        <p className="ap-body">{about.what}</p>
        <H3 en="Why is DAH?">설립 취지</H3>
        <p className="ap-body">{about.why}</p>
        <div className="ap-stats">
          <div>
            <b>2017</b>
            <span>전공 설립</span>
          </div>
          <div>
            <b>{professors.length}명</b>
            <span>교수진</span>
          </div>
          <div>
            <b>{snap.exhibitions.length}회</b>
            <span>프로젝트 전시회</span>
          </div>
          <div>
            <b>{snap.club.length}개</b>
            <span>전공 동아리</span>
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
                <dd>
                  <Names v={t.keywords} />
                </dd>
              </dl>
            </section>
          ))}
        </div>
      </>
    ),
  },
  {
    id: 'about-mission',
    ch: 'about',
    alt: '미션',
    render: () => (
      <>
        <Head title="미션" />
        <div className="ap-mission">
          <p className="ap-mission__kr">{about.mission.kr}</p>
          <p className="ap-mission__en">{about.mission.en}</p>
        </div>
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
          {about.vision.map((v, i) => (
            <li key={v.title}>
              <span>{i + 1}</span>
              <div>
                <strong>{v.title}</strong>
                <p>{v.body}</p>
              </div>
            </li>
          ))}
        </ol>
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
        <Table head={['학기', '수준', '과목명', '학점-강의-실습']} cols={['16%', '16%', '52%', '16%']} dense rows={courseRows('common')} small />
        <H3>디자인 트랙</H3>
        <Table head={['학기', '수준', '과목명', '학점-강의-실습']} cols={['16%', '16%', '52%', '16%']} dense rows={courseRows('design')} small />
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
        <Table head={['학기', '수준', '과목명', '학점-강의-실습']} cols={['16%', '16%', '52%', '16%']} dense rows={courseRows('ai')} small />
        <H3>엔터컬쳐 트랙</H3>
        <Table head={['학기', '수준', '과목명', '학점-강의-실습']} cols={['16%', '16%', '52%', '16%']} dense rows={courseRows('culture')} small />
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
            ['1학기', ['디지털인문예술입문', '문화콘텐츠 기초', '융합형 인재를 위한 코딩 기초'], commonNames(1)],
            ['2학기', ['디자인 씽킹 기초', '스토리텔링 기초', 'AI이해의 기초'], commonNames(2)],
          ]}
        />
        <H3>코드쉐어링</H3>
        <p className="ap-body">{codesharing.definition}</p>
        <p className="ap-note">{codesharing.note.trim()}</p>
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
            <dd>{nanodegree.intro}</dd>
          </div>
          <div>
            <dt>기준</dt>
            <dd>{nanodegree.cert}</dd>
          </div>
          <div>
            <dt>운영</dt>
            <dd>{nanodegree.programs.length}개 과정</dd>
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
    alt: `교수진 구성 ${professors.length}명`,
    render: () => (
      <>
        <Head title="교수진 구성" />
        <div className="ap-roster">
          {professors.map((p) => (
            <RosterCell key={p.id} p={p} />
          ))}
        </div>
      </>
    ),
  },
  ...[0, 3, 6, 9].map((start) => {
    const group = professors.slice(start, start + 3)
    return {
      id: `fac-${start / 3 + 1}`,
      ch: 'faculty',
      alt: `교수 소개 ${group.map((p) => p.name_ko).join(', ')}`,
      render: () => (
        <>
          <Head title="교수 소개" />
          <div className="ap-profs">
            {group.map((p) => (
              <Prof key={p.id} p={p} />
            ))}
          </div>
        </>
      ),
    }
  }),

  // ===== 04 Council =====
  { id: 'op-council', ch: 'council', tone: 'opener', alt: '04 Council 운영위원회 LUCID', render: () => <Opener id="council" /> },
  {
    id: 'council-history',
    ch: 'council',
    alt: '학생회의 역사',
    render: () => (
      <>
        <Head title="학생회의 역사" sub="2017년 전공 설립과 함께 시작한 학생 조직" />
        <Table head={['연도', '학생 조직']} cols={['22%', '78%']} rows={councils.map((c) => [c.year_label, c.name])} />
        <p className="ap-note">2017년 전공 설립과 함께 학생 조직이 시작되었습니다. 2026년부터 학생회는 제1대 운영위원회 LUCID가 되었습니다.</p>
      </>
    ),
  },
  {
    id: 'council-change',
    ch: 'council',
    alt: '학생회에서 운영위원회로',
    render: () => (
      <>
        <Head title="학생회에서 운영위원회로" sub="이름과 구조가 바뀐 2026년" />
        <div className="ap-prose">
          <p>2026년에 전공 학생 대표 조직의 이름이 학생회에서 운영위원회 LUCID로 바뀌었습니다. 대수도 제1대로 새로 셉니다.</p>
          <p>위원회는 학생회 역할을 이어받아 전시회 접수와 공모전 운영을 맡습니다. 전공 웹사이트도 위원회가 직접 운영합니다.</p>
        </div>
        <Table
          head={['', '2026 운영위원회']}
          cols={['22%', '78%']}
          rows={[
            ['명칭', '제1대 운영위원회 LUCID'],
            ['인원', `${council2026.members.length}명`],
            ['구성', ['위원장과 부위원장', '기획부와 홍보부', '웹전시부']],
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
        <Head title="조직" sub={`위원장과 부위원장 그리고 세 부서 ${council2026.members.length}명`} />
        <dl className="ap-org">
          {['위원장', '부위원장', '기획부', '홍보부', '웹전시부'].map((g) => (
            <div key={g}>
              <dt>{g}</dt>
              <dd>
                <Names v={council2026.members.filter((m) => m.role === g).map((m) => m.name)} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="ap-note">운영 방향: 여러 전공에서 온 학생이 함께 전공 행사를 만듭니다.</p>
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
        <Head title="2026년의 흐름" sub="공지와 행사 일정 기준. 12월 일정은 예정" />
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
          <Photo s="gaechong/3.webp" h={188} cap="운영위원회와 동아리 소개" />
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
        <Head title="전공 웹사이트" sub="구글 사이트에서 자체 개발 사이트로 전환" />
        <p className="ap-body">구글 사이트로 운영하던 전공 웹사이트를 직접 개발한 사이트로 바꿨습니다. 한국어와 영어를 함께 지원합니다.</p>
        <Table
          cols={['24%', '76%']}
          rows={[
            ['메뉴', ['전공 소개와 학사 안내', '학과 행사와 학생 활동', '공지사항과 자료실']],
            ['편집', ['권한 4단계', '학생 운영진이 화면에서 바로 내용 수정']],
            ['관리 항목', [`전시회 아카이브 ${snap.exhibitions.length}건`, `학생 성과 ${snap.achievement.length}건`, `동아리 ${snap.club.length}곳과 공지 21건`]],
            ['개발', ['2026.07.06 개발 시작', '11월 현재 계속 개발']],
          ]}
        />
        <SiteShot k="home" cap="전공 웹사이트 첫 화면" h={272} />
      </>
    ),
  },
  {
    id: 'ax-submit',
    ch: 'ax',
    alt: '전시회 접수 폼',
    render: () => (
      <>
        <Head title="전시회 접수 폼" sub="구글 폼과 앱스 스크립트로 나뉘어 있던 접수를 전공 웹사이트 한 곳으로" />
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
        <Table
          head={['기능', '내용']}
          cols={['24%', '76%']}
          rows={[
            ['자동 입력', ['로그인한 구글 계정 이메일', '가장 최근 접수의 신청자 정보']],
            ['입력 도움', ['관리자가 등록한 과목 목록', '팀원 추가', '작품 설명 100자 글자 수 표시']],
            ['빠진 칸', '제출을 누르면 빠진 칸을 표시하고 맨 위 칸으로 이동'],
            ['파일', ['한 작품에 최대 10개', '파일당 100MB', '올리는 동안 제출 잠금']],
            ['확인', ['접수 확인 메일', '내 접수 목록에서 작품마다 수정']],
            ['기간', ['접수와 작품 제출 기간은 서버 시각으로 검사', '마감 뒤 접수와 수정 차단']],
          ]}
          small
        />
      </>
    ),
  },
  {
    id: 'ax-forms',
    ch: 'ax',
    alt: '신청 폼',
    render: () => (
      <>
        <Head title="신청 폼 편집기" sub="종강 총회 신청과 부원 모집을 구글 폼 없이 사이트 안에서 운영" />
        <Bullets
          items={[
            '구글 폼과 같은 방식의 질문 편집기',
            '질문 유형 15가지',
            '구글 시트 형태의 응답 시트에서 응답 확인과 수정',
            '폼별 제출 확인 메일 사용 여부 설정',
            '폼 복사로 다음 학기 신청 폼 즉시 생성',
          ]}
        />
        <H3>올해 새로 생긴 기능</H3>
        <Table head={['기능', '내용']} cols={['28%', '72%']} rows={axNew} />
        <p className="ap-note">전시 원본은 인쇄용 파일 그대로 구글 드라이브에 보관합니다. 웹에는 용량을 줄인 이미지를 따로 만들어 올립니다.</p>
      </>
    ),
  },
  {
    id: 'ax-workspace',
    ch: 'ax',
    alt: 'DAH 워크스페이스 도구',
    render: () => (
      <>
        <Head title="DAH 워크스페이스" sub="전공 웹사이트 안의 문서 작업 공간" />
        <p className="ap-body">운영위원회가 쓰던 구글 독스와 구글 시트를 전공 웹사이트 안으로 옮겼습니다. 위원은 구글 계정으로 로그인해 문서를 만들고 함께 고칩니다.</p>
        <Table head={['도구', '하는 일']} cols={['24%', '76%']} rows={workspaceTools} small />
        <SiteShot k="workspace-docs" cap="DAH Docs 새 문서 화면" h={176} />
      </>
    ),
  },
  {
    id: 'ax-workspace-2',
    ch: 'ax',
    alt: 'DAH 워크스페이스 공유와 협업',
    render: () => (
      <>
        <Head title="공유와 협업" sub="DAH 워크스페이스의 권한과 팀 공간" />
        <Table head={['항목', '내용']} cols={['24%', '76%']} rows={workspaceShare} />
        <p className="ap-note">운영위원회 인수인계 문서도 DAH Docs로 만들어 다음 위원회에 넘깁니다.</p>
      </>
    ),
  },
  {
    id: 'ax-drive',
    ch: 'ax',
    alt: '구글 드라이브 연결',
    render: () => (
      <>
        <Head title="구글 드라이브 연결" sub="사이트로 들어온 파일을 운영위원회 드라이브에 저장" />
        <p className="ap-body">관리 화면의 파일 보관함에서 운영위원회 구글 계정을 한 번 연결합니다. 그 뒤로 전시회 접수와 신청 폼에 올라온 파일이 지정한 폴더에 쌓입니다.</p>
        <Table head={['항목', '내용']} cols={['24%', '76%']} rows={driveLink} small />
        <Photo s="site/drive.webp" h={168} shot contain />
        <p className="ap-note">관리 화면 파일 보관함(구글 드라이브)의 연결 상태 카드</p>
      </>
    ),
  },
  {
    id: 'ax-ops',
    ch: 'ax',
    alt: '전시회 운영 자동화',
    render: () => (
      <>
        <Head title="전시회 운영 자동화" sub="접수부터 인쇄와 채점 그리고 인수인계까지" />
        <Table head={['항목', '내용']} cols={['24%', '76%']} rows={exhibitionOps} />
        <H3>2학기에 달라진 점</H3>
        <Bullets
          items={[
            '접수 기간에는 작품 정보만 받고 작품 제출 기간에 파일을 받습니다.',
            '작품이 여러 개이면 작품마다 따로 접수합니다.',
            '사이트 시각 표기를 24시간제로 통일했습니다.',
          ]}
        />
        <Photo s="site/exhibition-settings.webp" h={144} shot contain />
        <p className="ap-note">관리 화면 전시회 설정의 접수 일정</p>
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
        <Grid cols={6}>
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
        <Head title="Against the Flow" sub="2026 1학기 제18회 디지털인문예술전공 프로젝트 전시회" />
        <div className="ap-awone">
          <div className="ap-aw__img">
            <Img s="poster-awards/against-the-flow.webp" alt="Against the Flow 전시 포스터" />
          </div>
          <Table head={['구분', '내용']} cols={['26%', '74%']} rows={exhibition261Facts} small dense />
        </div>
        <H3>준비와 운영 일정</H3>
        <Table head={['일정', '내용']} cols={['28%', '72%']} rows={exhibition261Prep} small dense />
      </>
    ),
  },
  {
    id: 'ex-concept',
    ch: 'exhibition',
    alt: 'Against the Flow 전시 컨셉',
    render: () => (
      <>
        <Head title="전시 컨셉" sub="Against the Flow 포스터 컨셉" />
        <div className="ap-prose">
          {exhibition261Concept.lines.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
        <Numbered items={exhibition261Concept.points} />
        <H3>AI 활용과 학생의 기여</H3>
        <Table cols={['28%', '72%']} rows={exhibition261Concept.credits} small dense />
      </>
    ),
  },
  {
    id: 'ex-works',
    ch: 'exhibition',
    alt: '전시된 작품들',
    render: () => (
      <>
        <Head title="전시 작품" sub="출품작 81점 중 18점" />
        <Grid cols={6}>
          {Array.from({ length: 18 }, (_, i) => (
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
        <Head title="수상작" sub={`2026 1학기 최우수상 1점과 우수상 13점 (${i * 2 + 1}~${i * 2 + 2} / 14)`} />
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
        <Head title="시상식" sub="2026.06.04 18:00 C.square Blue 종강 총회와 함께 진행" />
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
        <Grid cols={2}>
          <Cell s="poster-photos/4.webp" ratio="1 / 1" />
          <Cell s="poster-photos/7.webp" ratio="1 / 1" />
          <Cell s="poster-photos/13.webp" ratio="1 / 1" />
          <Cell s="poster-photos/21.webp" ratio="1 / 1" />
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
        <Table head={['구분', '일정']} cols={['34%', '66%']} rows={exhibition262Schedule} small />
        <div className="ap-stats">
          <div>
            <b>{exhibition262Stats.total}점</b>
            <span>접수 작품</span>
          </div>
          <div>
            <b>{exhibition262Stats.courses.length}개</b>
            <span>과목과 부문</span>
          </div>
          <div>
            <b>{exhibition262Stats.people}명</b>
            <span>참여 학생(중복 제외)</span>
          </div>
          <div>
            <b>{exhibition262Stats.team}팀</b>
            <span>팀 참가</span>
          </div>
        </div>
        <Table
          head={['과목', '작품', '참여']}
          cols={['60%', '20%', '20%']}
          rows={exhibition262Stats.courses.map(([c, n, p]) => [c, `${n}점`, `${p}명`])}
          small
        />
      </>
    ),
  },
  {
    id: 'ex-262-sys',
    ch: 'exhibition',
    alt: '2학기 접수와 작품 제출',
    render: () => (
      <>
        <Head title="접수와 작품 제출" sub="2학기 전시회부터 전공 웹사이트 한 곳에서 접수와 작품 제출" />
        <Table
          head={['항목', '내용']}
          cols={['24%', '76%']}
          rows={[
            ['본인 확인', ['구글 계정 로그인', '학교 계정과 개인 계정 모두 가능']],
            ['접수', ['참가 유형과 신청자', '과목과 작품명 그리고 작품 설명', '작품마다 따로 접수']],
            ['작품 제출', ['작품 제출 기간에 같은 화면에서 파일 업로드', '웹전시와 평가용 PNG 필수', '인쇄용 PDF 선택']],
            ['수정', '마감 전까지 같은 계정으로 접수 내용과 파일 수정'],
            ['확인', ['접수 직후 확인 메일', '사이트의 내 접수 목록']],
            ['관리', '접수 관리 시트의 과목별 현황 탭'],
          ]}
        />
        <Photo s="site/sheet-summary.webp" h={154} shot contain />
        <p className="ap-note">접수 관리 시트의 과목별 현황 탭 (2026.11.22)</p>
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
        <Head title="공모전 전용 사이트" sub="공모전마다 안내부터 결과까지 한 사이트에서" />
        <Table
          head={['사이트', '내용']}
          cols={['34%', '66%']}
          rows={[
            ['1학기 신규 캐릭터 공모전', ['출품작 포스터와 온라인 투표', '결과 발표']],
            ['1학기 전시회 포스터 공모전', ['안내와 수상작', '갤러리']],
            ['1학기 장서표 디자인 공모전', '안내와 수상작'],
            ['2학기 전시회 포스터 공모전', '출품작 20점을 별자리로 이은 화면'],
            ['2학기 장서표 디자인 공모전', ['출품작 46점과 수상작', '갤러리']],
            ['회차 기록', '전공 웹사이트 공모전 메뉴에서 회차별로 연결'],
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
        <Head title="신규 캐릭터 공모전" sub="2026년 새로 만든 공모전 출품작 9점 중 투표 1등과 2등" />
        <AwardPair>
          {characterWorks.slice(0, 2).map((c) => (
            <Award key={c.k} img={`characters/${c.k}.webp`} grade={c.r} line={`온라인 투표 ${c.v}`} title={c.n} who={c.by} major={c.major} desc={`${c.d}${c.note ? ' ' + c.note + '.' : ''}`} />
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
              ['일정', ['03.23 접수 시작', '05.02 온라인 투표', '05.08 결과 발표']],
              ['심사', ['투표 100%', '주전공생과 복수전공생 그리고 교수진 투표 합산']],
              ['시상', ['1등 30만원', '2등과 3등 각 10만원']],
            ]}
            small
            dense
          />
          <div className="ap-awone is-narrow">
            <div className="ap-aw__img">
              <Img s={`characters/${c.k}.webp`} alt={`${c.r} ${c.n}`} />
            </div>
            <div className="ap-aw__tx">
              <span className="ap-aw__g">{c.r}</span>
              <p className="ap-aw__c">온라인 투표 {c.v}</p>
              <h3 className="ap-aw__t">{c.n}</h3>
              <p className="ap-aw__w">
                <Names v={c.by} />
                <span className="ap-aw__m">{c.major}</span>
              </p>
              <p className="ap-aw__d">{c.d}</p>
            </div>
          </div>
          <H3>그 밖의 출품작 6점</H3>
          <Grid cols={6} dense>
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
        <Head title="전시회 포스터 공모전" sub="2026 1학기 프로젝트 전시회 포스터 수상작 5점 중 1~2" />
        <AwardPair>
          {posterAwards.slice(0, 2).map((a) => (
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={a.who} major={a.major} />
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
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={a.who} major={a.major} />
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
              <p className="ap-aw__w">
                <Names v={a.who} />
                <span className="ap-aw__m">{a.major}</span>
              </p>
            </div>
          </div>
          <Table
            head={['구분', '내용']}
            cols={['26%', '74%']}
            rows={[
              ['공모', ['2026학년도 1학기 디지털인문예술전공 전시회 포스터 공모전', '2026.05.02 공지']],
              ['주관', '인문사회 융합인재양성사업단(L-HUSS)'],
              ['수상', ['최우수상 1점과 우수상 3점', '장려상 1점']],
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
        <Head title="장서표 디자인 공모전" sub="인제 기적의 도서관 수상작 5점 중 1~2" />
        <AwardPair>
          {bookplateAwards.slice(0, 2).map((a) => (
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={a.who} major={a.major} />
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
            <Award key={a.title} img={a.img} grade={a.grade} title={a.title} who={a.who} major={a.major} />
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
              <p className="ap-aw__w">
                <Names v={a.who} />
                <span className="ap-aw__m">{a.major}</span>
              </p>
            </div>
          </div>
          <Table
            head={['구분', '내용']}
            cols={['26%', '74%']}
            rows={[
              ['공모', ['2026 강원과 함께 하는 도서관 장서표 디자인 공모전', '2026.05.02 공지']],
              ['대상 도서관', '인제 기적의 도서관'],
              ['주관', '인문사회 융합인재양성사업단(L-HUSS)'],
              ['수상', ['최우수상 1점과 우수상 3점', '장려상 1점']],
            ]}
            small
          />
        </>
      )
    },
  },

  {
    id: 'ct-262-poster',
    ch: 'contest',
    alt: '2026 2학기 전시회 포스터 공모전 BEYOND THE KNOWN',
    render: () => (
      <>
        <Head title="2026 2학기 포스터 공모전" sub="BEYOND THE KNOWN" />
        <SiteShot k="contest-poster-262" cap="공모전 사이트 첫 화면" h={160} />
        <SiteShot k="contest-poster-262-sky" cap="출품작 20점을 별로 이은 Works in the Sky" h={160} />
        <Table cols={['22%', '78%']} rows={contests262.poster} small />
      </>
    ),
  },
  {
    id: 'ct-262-bookplate',
    ch: 'contest',
    alt: '2026 2학기 장서표 디자인 공모전',
    render: () => (
      <>
        <Head title="2026 2학기 장서표 공모전" sub="제5회 강원과 함께하는 도서관" />
        <SiteShot k="contest-bookplate-262" cap="공모전 사이트 첫 화면" h={160} />
        <SiteShot k="contest-bookplate-262-works" cap="공모작 46점 목록" h={160} />
        <Table cols={['22%', '78%']} rows={contests262.bookplate} small />
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
        <Head title="디자인 통일" sub="@hallym_lucid" />
        <p className="ap-body">모집 공지부터 동아리 홍보까지 모든 게시물을 LUCID 디자인 하나로 맞췄습니다. 게시물 한 장만 보아도 전공 운영위원회 계정임을 알 수 있습니다.</p>
        <Grid cols={3}>
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
        <Head title="전시 안내 시리즈" sub="전시회 접수와 작품 제출 안내 게시물" />
        <Grid cols={3}>
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
        <Grid cols={3}>
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
        <Head title="전공 행사와 일정" sub="2026년 진행 행사와 남은 일정" />
        <Numbered
          items={[
            ['개강 총회와 비전 설명회', '2026.03.11 C.square Blue\n운영위원회와 동아리 소개\n전공 비전 설명'],
            ['전공 박람회', '1학기 2026.05.20 레크리에이션센터 3층\n2학기 2026.11.18\n전공 소개와 상담'],
            ['미래융합스쿨 교류와 연합 엠티', '미래융합스쿨 학생회와 교류\n연합 엠티에서 전공 동아리 4곳 소개'],
            ['시상식과 1학기 종강 총회', '2026.06.04 C.square Blue\n프로젝트 전시회 시상식과 학기 마무리'],
            ['제2대 위원장과 부위원장 모집', '2026.11.13 ~ 11.20\n전공 웹사이트 신청 폼으로 접수'],
            ['2학기 프로젝트 전시회', '2026.12.01 ~ 12.03 예정'],
            ['2학기 종강 총회', '전시 마지막 날 예정'],
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
            ['2026 Hallym Local Branding Camp', 'Team LUCID 참가\nStation C 방문 외빈을 위한 브랜드 경험 제안'],
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
        <Head title="행사 사진" sub="개강 총회와 시상식\n종강 총회" />
        <Grid cols={2}>
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
        <Head title="대표 성과" sub="전공 웹사이트에 2026년으로 올라 있는 학생 성과 26건" />
        <div className="ap-feats">
          <section>
            <b>4년 연속</b>
            <strong>세계일류 디자이너 양성사업(KDM+) 선발</strong>
            <p>2023년부터 4년 연속 선발자를 냈습니다. 2026년 7기에는 두 명이 함께 선발되었습니다.</p>
          </section>
          <section>
            <b>이사장상 2회</b>
            <strong>앵커 경진대회 한국연구재단 이사장상</strong>
            <p>{'앵커 참여 대학(원)생 우수사례 경진대회 최우수상\n앵커 AI-Solution 경진대회 우수상'}</p>
          </section>
          <section>
            <b>대상 6건</b>
            <strong>2026년 대상 수상</strong>
            <p>{'동해시 AI 아이디어톤\n한림 AI 교육 포털 오픈 공모전\n지역사회 문제해결 PBL 경진대회\n커리어 인바디 아이디어 공모전\n한림 로컬 창업 빌드업\nTown MICE 아이디어톤'}</p>
          </section>
        </div>
      </>
    ),
  },
  ...[
    [0, 5],
    [5, 10],
    [10, 14],
    [14, 18],
    [18, 22],
    [22, 26],
  ].map(([a, b], i) => ({
    id: `ach-${i + 1}`,
    ch: 'achievements',
    alt: `2026 학생 성과 ${a + 1}번부터 ${b}번`,
    render: () => (
      <>
        <Head title="학생 성과" sub={`2026년 ${a + 1}~${b} / ${studentAchievements.length}`} />
        <ol className="ap-ach">
          {studentAchievements.slice(a, b).map((x, k) => (
            <li key={x.t + x.w}>
              <span className="ap-ach__no">{String(a + k + 1).padStart(2, '0')}</span>
              <div>
                <strong>{x.t}</strong>
                <dl>
                  <dt>수상자</dt>
                  <dd>
                    <Names v={x.w} />
                  </dd>
                  {x.k && (
                    <>
                      <dt>작품과 주제</dt>
                      <dd>{x.k}</dd>
                    </>
                  )}
                  {x.h && (
                    <>
                      <dt>주최</dt>
                      <dd>{x.h}</dd>
                    </>
                  )}
                </dl>
              </div>
            </li>
          ))}
        </ol>
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
        <Head title={c.name} sub={`${c.nameEn} ${c.field} 동아리`} />
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
              <Cell key={s} s={s} ratio="1 / 1" />
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
        <Grid cols={3}>
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
          <p>2학기 프로젝트 전시회 결과와 공모전 수상작은 이 리포트에 이어서 싣습니다.</p>
          <p className="ap-sign">{reportMeta.council}</p>
        </div>
        <H3>제작 정보</H3>
        <Table
          cols={['26%', '74%']}
          rows={[
            ['발행', `${reportMeta.org} ${reportMeta.council}`],
            ['형식', '웹에서 넘겨 보는 디지털 판'],
            ['이전 판', '2025 애뉴얼 리포트(A4 40쪽 PDF)'],
            ['자료', ['운영위원회 1학기와 2학기 활동 자료', '전공 웹사이트 기록(2026.11.22 기준)']],
          ]}
          small
        />
      </>
    ),
  },
  {
    id: 'back',
    tone: 'cover',
    alt: '뒤표지',
    render: () => (
      <div className="ap-cover ap-cover--back">
        <p className="ap-back__top">2026 운영위원회 LUCID</p>
        <h2 className="ap-cover__title ap-cover__title--back">
          <span>2026</span>
          <b>ANNUAL REPORT</b>
        </h2>
      </div>
    ),
  },
]

// 표지 타일: 5열 4행 정사각, 사진 없이 공식 보라 단색과 흰 선의 기하 패턴
const TILE = ['diag', 'half-r', 'solid', 'quarter', 'vstripe', 'solid', 'tri', 'grid4', 'circle', 'hstripe', 'quarter-b', 'vstripe', 'half-b', 'diag-r', 'solid', 'hstripe', 'solid', 'arch', 'tri-d', 'split']
function Tile({ k }) {
  const L = { stroke: '#fff', strokeWidth: 1.4, fill: 'none' }
  const n = Array.from({ length: 7 }, (_, i) => (i + 1) * 12.5)
  const body = {
    solid: null,
    diag: n.map((v) => <line key={v} x1={0} y1={v} x2={v} y2={0} {...L} />).concat(n.map((v) => <line key={'b' + v} x1={v} y1={100} x2={100} y2={v} {...L} />)),
    'diag-r': n.map((v) => <line key={v} x1={100 - v} y1={0} x2={100} y2={v} {...L} />).concat(n.map((v) => <line key={'b' + v} x1={0} y1={100 - v} x2={v} y2={100} {...L} />)),
    vstripe: [60, 70, 80, 90].map((v) => <line key={v} x1={v} y1={0} x2={v} y2={100} {...L} />),
    hstripe: [55, 66, 77, 88].map((v) => <line key={v} x1={0} y1={v} x2={100} y2={v} {...L} />),
    'half-r': <path d="M50 0 A50 50 0 0 1 50 100" {...L} />,
    'half-b': <path d="M0 50 A50 50 0 0 0 100 50" {...L} />,
    arch: <path d="M0 100 A50 50 0 0 1 100 100" {...L} />,
    quarter: <path d="M0 100 A100 100 0 0 1 100 0" {...L} />,
    'quarter-b': <path d="M0 0 A100 100 0 0 0 100 100" {...L} />,
    tri: <path d="M50 0 L100 100 L0 100 Z" {...L} />,
    'tri-d': <path d="M0 0 L100 0 L50 100 Z" {...L} />,
    circle: <circle cx="50" cy="50" r="38" {...L} />,
    grid4: [<line key="v" x1={50} y1={0} x2={50} y2={100} {...L} />, <line key="h" x1={0} y1={50} x2={100} y2={50} {...L} />],
    split: [<line key="v" x1={50} y1={0} x2={50} y2={100} {...L} />, <line key="a" x1={50} y1={50} x2={100} y2={0} {...L} />],
  }[k]
  return (
    <svg viewBox="0 0 100 100" className="ap-tile" aria-hidden="true">
      <rect width="100" height="100" className="ap-tile__bg" />
      {body}
    </svg>
  )
}
function CoverTiles() {
  return (
    <div className="ap-cover__tiles">
      {TILE.map((k, i) => (
        <Tile key={i} k={k} />
      ))}
    </div>
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
              <p>
                <Names v={c.items} />
              </p>
            </div>
            <span className="ap-toc__page">{String(c.page).padStart(2, '0')}</span>
          </li>
        ))}
      </ol>
    </>
  )
}
