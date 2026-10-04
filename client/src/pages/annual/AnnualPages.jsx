// AnnualPages.jsx: 애뉴얼 리포트의 모든 쪽. 서버 렌더 문자열로 책에 들어가므로 훅과 라우터 없이 쓴다.
import { councils } from '../../data/council'
import {
  IMG,
  reportMeta,
  chapters,
  regularEvents,
  yearFlow,
  axCompare,
  axNew,
  submitFlow,
  exhibitionArchive,
  exhibition261Schedule,
  exhibition261Programs,
  exhibition261Awards,
  characterResult,
  characterWorks,
  achievements2026,
  clubsInfo,
} from '../../data/annualReport2026'

const council2026 = councils.find((c) => c.year === 2026)

const Img = ({ src, alt = '', className = '', cover = true }) => (
  <img
    src={src.startsWith('/') ? src : `${IMG}/${src}`}
    alt={alt}
    decoding="async"
    draggable="false"
    className={`ar-img ${cover ? 'ar-img--cover' : ''} ${className}`}
  />
)

const Head = ({ eyebrow, title, lead }) => (
  <header className="ar-head">
    {eyebrow && <p className="ar-eyebrow">{eyebrow}</p>}
    <h2 className="ar-title">{title}</h2>
    {lead && <p className="ar-lead">{lead}</p>}
  </header>
)

const Caption = ({ children }) => <p className="ar-caption">{children}</p>

const Bullets = ({ items }) => (
  <ul className="ar-list">
    {items.map((t) => (
      <li key={t}>{t}</li>
    ))}
  </ul>
)

const Rows = ({ rows, cols = 2, head = false }) => (
  <dl className={`ar-rows ar-rows--${cols}`}>
    {rows.map((r, ri) => (
      <div key={r.join('|')} className={`ar-row ${head && ri === 0 ? 'ar-row--head' : ''}`}>
        {r.map((c, i) => (
          <dd key={i} className={i === 0 ? 'ar-row__key' : ''}>
            {c}
          </dd>
        ))}
      </div>
    ))}
  </dl>
)

const Opener = ({ no, title, sub }) => (
  <div className="ar-opener">
    <span className="ar-opener__no">{no}</span>
    <div>
      <h2 className="ar-opener__title">{title}</h2>
      <p className="ar-opener__sub">{sub}</p>
    </div>
  </div>
)

const Grid = ({ srcs, cols = 3, ratio = '4 / 5', className = '' }) => (
  <div className={`ar-grid ${className}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, '--ar-ratio': ratio }}>
    {srcs.map((s) => (
      <div key={s} className="ar-grid__cell">
        <Img src={s} />
      </div>
    ))}
  </div>
)

const chapterOf = (id) => chapters.find((c) => c.id === id)

// 쪽 정의. density: hard 는 표지류. chapter 는 상단 러닝헤드와 목차에 쓴다.
export const pages = [
  // 0 표지
  {
    id: 'cover',
    density: 'hard',
    tone: 'cover',
    render: () => (
      <div className="ar-cover">
        <p className="ar-cover__org">{reportMeta.org}</p>
        <div className="ar-cover__year">2026</div>
        <h1 className="ar-cover__title">
          Digital
          <br />
          Annual Report
        </h1>
        <p className="ar-cover__sub">{reportMeta.council}</p>
        <div className="ar-cover__mosaic" aria-hidden="true">
          {['awards-1/8.webp', 'results-1/8.webp', 'works/3.webp', 'characters/disoong-i.webp', 'awards-1/5.webp', 'results-1/1.webp'].map((s) => (
            <Img key={s} src={s} />
          ))}
        </div>
      </div>
    ),
  },
  // 1 발간사
  {
    id: 'preface',
    render: () => (
      <>
        <Head eyebrow="발간사" title="2026년의 기록" />
        <div className="ar-prose">
          <p>
            2026년 디지털인문예술전공 학생 조직은 학생회라는 이름을 내려놓고 제1대 운영위원회 LUCID로 새로 시작했습니다. 이
            리포트는 그 첫해의 기록입니다.
          </p>
          <p>
            이 한 해 동안 전시회는 두 학기로 이어졌고, 신규 캐릭터 공모전이 처음 열렸으며, 공모전마다 전용 사이트가 만들어졌습니다.
            인스타그램은 하나의 디자인으로 통일했고, 전시회 접수와 신청 폼, 파일 정리는 전공 웹사이트 한 곳으로 모았습니다.
          </p>
          <p>
            2025 리포트가 A4 40쪽의 인쇄본이었다면 2026 리포트는 웹에서 책장을 넘기며 보는 디지털 판입니다. 2학기 전시회는 현재
            접수 중이며 전시가 끝나면 이어서 담습니다.
          </p>
          <p className="ar-sign">{reportMeta.council} 일동</p>
        </div>
      </>
    ),
  },
  // 2 목차 (본문은 AnnualReport에서 쪽 번호를 채워 넣는다)
  { id: 'toc', render: ({ toc }) => <Toc toc={toc} /> },
  // 3 사진
  {
    id: 'photo-opening',
    chapter: 'council',
    bleed: true,
    render: () => (
      <div className="ar-bleed">
        <Img src="gaechong/3.webp" alt="2026년 개강 총회 현장" />
        <Caption>2026.03.11 개강 총회와 전공 비전 설명회</Caption>
      </div>
    ),
  },
  // 4 01 오프너
  { id: 'op-council', chapter: 'council', tone: 'chapter', render: () => <Opener {...chapterOf('council')} /> },
  // 5 학생회 역사
  {
    id: 'council-history',
    chapter: 'council',
    render: () => (
      <>
        <Head eyebrow="01 운영위원회 LUCID" title="전공 학생 조직의 역사" lead="2017년 전공 설립과 함께 시작한 학생 조직의 이름이 올해 처음으로 바뀌었습니다." />
        <ol className="ar-history">
          {councils.map((c) => (
            <li key={c.year} className={c.year === 2026 ? 'is-now' : ''}>
              <span className="ar-history__year">{c.year}</span>
              <span className="ar-history__name">{c.title}</span>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  // 6 이름이 바뀐 해
  {
    id: 'council-change',
    chapter: 'council',
    render: () => (
      <>
        <Head eyebrow="01 운영위원회 LUCID" title="학생회에서 운영위원회로" />
        <div className="ar-prose">
          <p>
            2025년까지 전공의 학생 대표 조직은 학생회였고 마지막은 제7대 CUBE였습니다. 2026년에는 이름을 제1대 운영위원회
            LUCID로 바꾸고 대수를 새로 시작했습니다.
          </p>
          <p>
            학생회의 역할을 이어받으면서 전시회 접수, 공모전, 전공 웹사이트 운영처럼 전공 운영 실무를 위원회가 직접 맡는 구조로
            바뀌었습니다.
          </p>
        </div>
        <Rows
          cols={3}
          head
          rows={[
            ['', '2025', '2026'],
            ['이름', '제7대 학생회 CUBE', '제1대 운영위원회 LUCID'],
            ['인원', '12명', '10명'],
            ['부서', '학회장, 부학회장, 전시, 대외, 홍보, 기획', '위원장, 부위원장, 기획부, 홍보부, 웹전시부'],
          ]}
        />
      </>
    ),
  },
  // 7 LUCID 이름
  {
    id: 'council-lucid',
    chapter: 'council',
    render: () => (
      <>
        <Head eyebrow="01 운영위원회 LUCID" title="LUCID" lead="2026 1st Student Council" />
        <div className="ar-mark">
          <img src="/images/decade/lucid-mark.svg" alt="LUCID 로고" draggable="false" />
        </div>
        <blockquote className="ar-quote">{council2026.intro}</blockquote>
      </>
    ),
  },
  // 8 조직
  {
    id: 'council-org',
    chapter: 'council',
    render: () => {
      const groups = ['위원장', '부위원장', '기획부', '홍보부', '웹전시부']
      return (
        <>
          <Head eyebrow="01 운영위원회 LUCID" title="조직" lead="위원장과 부위원장 아래 세 개 부서로 운영했습니다." />
          <div className="ar-org">
            {groups.map((g) => (
              <div key={g} className="ar-org__row">
                <span className="ar-org__role">{g}</span>
                <span className="ar-org__names">{council2026.members.filter((m) => m.role === g).map((m) => m.name).join(', ')}</span>
              </div>
            ))}
          </div>
          <p className="ar-note">웹전시부는 2025년 학생회 부서에 없던 부서입니다. 전시회 사이트와 웹 전시를 맡습니다.</p>
        </>
      )
    },
  },
  // 9 정기 행사
  {
    id: 'council-events',
    chapter: 'council',
    render: () => (
      <>
        <Head eyebrow="01 운영위원회 LUCID" title="정기 운영 행사 7종" lead="한 학기의 시작부터 끝까지 전공의 공식 행사를 운영합니다." />
        <ol className="ar-numbered">
          {regularEvents.map(([t, d], i) => (
            <li key={t}>
              <span className="ar-numbered__no">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  // 10 한 해의 흐름
  {
    id: 'council-year',
    chapter: 'council',
    render: () => (
      <>
        <Head eyebrow="01 운영위원회 LUCID" title="2026년의 흐름" />
        <ol className="ar-timeline">
          {yearFlow.map(([d, t]) => (
            <li key={d + t}>
              <span className="ar-timeline__date">{d}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  // 11 개총 사진
  {
    id: 'council-photos',
    chapter: 'council',
    render: () => (
      <>
        <Head eyebrow="01 운영위원회 LUCID" title="개강 총회" lead="2026.03.11 C.square Blue" />
        <div className="ar-collage ar-collage--3">
          <Img src="gaechong/5.webp" alt="개강 총회 단체 사진" />
          <Img src="gaechong/1.webp" alt="개강 총회 발표" />
          <Img src="gaechong/4.webp" alt="개강 총회 뒤풀이" />
        </div>
      </>
    ),
  },

  // 12 02 오프너
  { id: 'op-ax', chapter: 'ax', tone: 'chapter', render: () => <Opener {...chapterOf('ax')} /> },
  // 13 작년과 올해
  {
    id: 'ax-compare',
    chapter: 'ax',
    render: () => (
      <>
        <Head eyebrow="02 전공 AX" title="작년에서 올해로" lead="전공 운영의 도구가 구글 문서에서 전공 웹사이트로 옮겨 왔습니다." />
        <Rows cols={3} head rows={[['', '2025', '2026'], ...axCompare]} />
      </>
    ),
  },
  // 14 웹사이트
  {
    id: 'ax-website',
    chapter: 'ax',
    render: () => (
      <>
        <Head eyebrow="02 전공 AX" title="전공 웹사이트를 새로 만들다" />
        <div className="ar-prose">
          <p>구글 사이트로 운영하던 전공 웹사이트를 자체 개발한 사이트로 완전히 바꿨습니다. 한국어와 영어를 함께 지원합니다.</p>
        </div>
        <Bullets
          items={[
            '전공 소개, 학사 안내, 학과 행사, 학생 활동, 공지사항, 자료실의 여섯 영역',
            '권한을 네 단계로 나눠 학생 운영진이 코딩 없이 공개 화면에서 직접 편집',
            '전시회 아카이브 18건, 학생 성과, 동아리, 공지를 한 사이트에서 관리',
            '개발 기록은 2026.07.06에 시작해 10월 현재까지 이어지고 있습니다',
          ]}
        />
      </>
    ),
  },
  // 15 접수 통합
  {
    id: 'ax-submit',
    chapter: 'ax',
    render: () => (
      <>
        <Head eyebrow="02 전공 AX" title="전시회 접수를 한 곳으로" lead="구글 폼과 앱스 스크립트로 나뉘어 있던 접수를 전공 웹사이트 안으로 옮겼습니다." />
        <ol className="ar-steps">
          {submitFlow.map(([t, d], i) => (
            <li key={t}>
              <span className="ar-steps__no">{i + 1}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
        <Bullets
          items={[
            '접수 기간은 서버가 검증하고 마감 뒤에는 접수와 수정이 닫힙니다',
            '운영진은 구글 시트처럼 생긴 접수 시트에서 바로 확인하고 고칩니다',
            '접수 정보는 엑셀과 CSV로 내보내고, 마감 뒤 개인정보 초기화 기능을 씁니다',
          ]}
        />
      </>
    ),
  },
  // 16 폼 빌더
  {
    id: 'ax-forms',
    chapter: 'ax',
    render: () => (
      <>
        <Head eyebrow="02 전공 AX" title="신청 폼을 사이트 안에서" lead="종강 총회, 부원 모집 같은 신청을 구글 폼 없이 받습니다." />
        <Bullets
          items={[
            '구글 폼과 같은 방식의 편집기에서 질문을 추가하고 순서를 바꿉니다',
            '객관식, 체크박스, 드롭다운, 선형 배율, 날짜, 시간 등 열두 가지 질문 유형',
            '응답은 구글 시트처럼 생긴 응답 시트에서 보고 고칩니다',
            '제출 확인 메일을 폼마다 켜고 끌 수 있습니다',
            '폼 복사로 다음 학기 신청 폼을 바로 만듭니다',
          ]}
        />
        <div className="ar-shot ar-shot--tall">
          <Img src="site/submit.webp" alt="전시회 접수 화면" cover />
        </div>
        <Caption>전시회 접수 화면(참가 유형, 신청자, 과목, 원본 파일, 작품 정보)</Caption>
      </>
    ),
  },
  // 17 새로 생긴 것
  {
    id: 'ax-new',
    chapter: 'ax',
    render: () => (
      <>
        <Head eyebrow="02 전공 AX" title="올해 새로 생긴 기능" />
        <Rows cols={2} rows={axNew} />
        <p className="ar-note">전시 원본은 인쇄용 파일 그대로 구글 드라이브에 보관하고, 웹에 보여 줄 이미지는 작게 줄인 웹용으로 따로 만듭니다.</p>
      </>
    ),
  },
  // 18 화면 모음 1
  {
    id: 'ax-screens-1',
    chapter: 'ax',
    render: () => (
      <>
        <Head eyebrow="02 전공 AX" title="전공 웹사이트 화면" />
        <div className="ar-stack">
          <figure>
            <Img src="site/home.webp" alt="전공 웹사이트 첫 화면" />
            <Caption>첫 화면</Caption>
          </figure>
          <figure>
            <Img src="site/exhibitions.webp" alt="프로젝트 전시회 페이지" />
            <Caption>프로젝트 전시회</Caption>
          </figure>
        </div>
      </>
    ),
  },
  // 19 화면 모음 2
  {
    id: 'ax-screens-2',
    chapter: 'ax',
    render: () => (
      <>
        <Head eyebrow="02 전공 AX" title="공모전 기록과 회차별 아카이브" />
        <div className="ar-stack">
          <figure>
            <Img src="site/contests.webp" alt="공모전 페이지" />
            <Caption>공모전 회차별 포스터 기록</Caption>
          </figure>
        </div>
        <p className="ar-note">공모전 상세 페이지에서 각 공모전 전용 사이트로 이어집니다.</p>
      </>
    ),
  },

  // 20 03 오프너
  { id: 'op-exhibition', chapter: 'exhibition', tone: 'chapter', render: () => <Opener {...chapterOf('exhibition')} /> },
  // 21 18회 아카이브
  {
    id: 'ex-archive',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회" title="18회, 2017년부터" lead="2017년 2학기 제1회부터 2026년 1학기 제18회까지 이어진 전공 최대 행사입니다." />
        <div className="ar-archive">
          {exhibitionArchive.map((k) => (
            <figure key={k}>
              <Img src={`/images/exhibitions/${k}.webp`} alt={`${k} 전시회 포스터`} />
              <figcaption>{k}</figcaption>
            </figure>
          ))}
        </div>
      </>
    ),
  },
  // 22 26-1 개요
  {
    id: 'ex-261',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="제18회 프로젝트 전시회" lead="2026.06.02 ~ 06.04, 캠퍼스라이프센터" />
        <Rows cols={2} rows={exhibition261Schedule} />
        <div className="ar-prose">
          <p>
            디지털인문예술전공 전공과 동아리가 만든 기말 프로젝트 작품을 전시합니다. 인쇄 작품은 오프라인에, 작품 사이트는 온라인 전시로
            함께 선보였습니다.
          </p>
        </div>
      </>
    ),
  },
  // 23 컨셉
  {
    id: 'ex-concept',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="전시 컨셉 기획" lead="418 I'M A TEAPOT" />
        <div className="ar-prose">
          <p>
            슬로건은 &lsquo;커피를 요구하는 세상, 따뜻한 차 한 잔&rsquo;, 주제는 휴먼 터치입니다. AI가 정답을 내놓는 시대에 기술이 흉내 내지 못하는
            인간의 흔적을 전시의 중심에 두었습니다.
          </p>
          <p>
            418은 1998년 만우절 농담에서 나온 기술 표준입니다. 커피를 내리라는 요청에 서버가 &lsquo;나는 찻주전자라서 커피를 내릴 수 없다&rsquo;고
            답하는 상황으로, 효율 중심의 시스템 속에서 자기다움을 유쾌하게 드러내는 태도를 상징합니다.
          </p>
          <p>기획안은 동아리 CON:NECT가 작성했습니다.</p>
        </div>
      </>
    ),
  },
  // 24 프로그램
  {
    id: 'ex-programs',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="기획안의 프로그램" />
        <ol className="ar-numbered">
          {exhibition261Programs.map(([t, d], i) => (
            <li key={t}>
              <span className="ar-numbered__no">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  // 25 포스터와 현장
  {
    id: 'ex-posters',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="전시 포스터" lead="전시회 포스터 공모전에서 뽑은 작품이 전시 얼굴이 되었습니다." />
        <div className="ar-collage ar-collage--2x2">
          <Img src="poster-photos/4.webp" alt="전시 포스터 설치 현장" />
          <Img src="poster-photos/7.webp" alt="전시 포스터 설치 현장" />
          <Img src="poster-photos/13.webp" alt="전시 포스터 설치 현장" />
          <Img src="poster-photos/16.webp" alt="전시 포스터 설치 현장" />
        </div>
      </>
    ),
  },
  // 26 작품 모자이크
  {
    id: 'ex-works',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="전시된 작품들" lead="수업과 동아리에서 만든 프로젝트가 온라인 전시 사이트에 올랐습니다." />
        <Grid srcs={Array.from({ length: 20 }, (_, i) => `works/${i + 1}.webp`)} cols={5} ratio="3 / 4" />
      </>
    ),
  },
  // 27 수상작 카드 (표지 포함 15장)
  {
    id: 'ex-awards-cards',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="수상작 발표" lead="2026.06.04 시상식" />
        <Grid srcs={Array.from({ length: 15 }, (_, i) => `awards-1/${i + 1}.webp`)} cols={5} ratio="4 / 5" />
      </>
    ),
  },
  // 28 수상 목록
  {
    id: 'ex-awards-list',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="수상 목록" lead="최우수상 1점, 우수상 13점" />
        <ul className="ar-awards">
          {exhibition261Awards.map(([a, c, t]) => (
            <li key={t}>
              <span className={`ar-awards__tag ${a === '최우수상' ? 'is-top' : ''}`}>{a}</span>
              <span className="ar-awards__course">{c}</span>
              <span className="ar-awards__title">{t}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  // 29 시상식 사진
  {
    id: 'ex-ceremony',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 1학기" title="시상식과 종강 총회" lead="2026.06.04 18:00 C.square Blue" />
        <div className="ar-collage ar-collage--3">
          <Img src="jongchong/2.webp" alt="시상식 단체 사진" />
          <Img src="jongchong/1.webp" alt="시상식 수상팀" />
          <Img src="jongchong/3.webp" alt="시상식 수상팀" />
        </div>
      </>
    ),
  },
  // 30 2학기
  {
    id: 'ex-262',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 2학기" title="제19회 프로젝트 전시회" lead="작품 접수 중" />
        <Rows
          cols={2}
          rows={[
            ['접수 시작', '2026.10.01'],
            ['접수 마감', '2026.11.13'],
            ['수정 마감', '2026.11.24'],
          ]}
        />
        <div className="ar-prose">
          <p>2학기 전시회는 처음으로 전공 웹사이트 안의 접수 화면에서 작품을 받습니다. 구글 계정으로 로그인해 한 페이지에서 작성하고, 마감 전까지 같은 계정으로 고칩니다.</p>
          <p>서비스 디자인, UI 디자인, 디자인 씽킹, 캡스톤디자인 등 2학기 과목과 전공 동아리, 자율 참가를 접수합니다.</p>
        </div>
        <p className="ar-note">전시 일정과 결과는 전시가 끝난 뒤 이 리포트에 이어서 담습니다.</p>
      </>
    ),
  },
  // 31 2학기 접수 시스템
  {
    id: 'ex-262-sys',
    chapter: 'exhibition',
    render: () => (
      <>
        <Head eyebrow="03 프로젝트 전시회 | 2026 2학기" title="바뀐 접수 방식" />
        <Rows
          cols={2}
          rows={[
            ['접수 창구', '전공 웹사이트 한 곳'],
            ['본인 확인', '구글 계정 로그인'],
            ['입력', '한 페이지에 참가 유형, 신청자, 과목, 원본 파일, 작품 정보'],
            ['확인', '제출하면 접수 확인 메일 발송'],
            ['수정', '수정 마감까지 같은 계정으로 직접 수정'],
            ['파일', '학기와 과목별 폴더로 자동 정리'],
          ]}
        />
      </>
    ),
  },

  // 32 04 오프너
  { id: 'op-contest', chapter: 'contest', tone: 'chapter', render: () => <Opener {...chapterOf('contest')} /> },
  // 33 공모전 사이트
  {
    id: 'ct-sites',
    chapter: 'contest',
    render: () => (
      <>
        <Head eyebrow="04 공모전" title="공모전마다 전용 사이트" lead="공모전 안내, 출품, 투표, 결과를 하나의 사이트에서 볼 수 있게 만들었습니다." />
        <Bullets
          items={[
            '신규 캐릭터 공모전 사이트: 출품작 포스터와 온라인 투표, 결과 확인',
            '전시회 포스터 공모전 사이트: 안내, 수상작, 갤러리',
            '장서표 디자인 공모전 사이트',
            '세 사이트는 전공 웹사이트의 공모전 회차 기록으로 이어집니다',
          ]}
        />
        <div className="ar-shot">
          <Img src="site/contests.webp" alt="공모전 회차별 기록" cover />
        </div>
      </>
    ),
  },
  // 34 캐릭터 공모전
  {
    id: 'ct-character',
    chapter: 'contest',
    render: () => (
      <>
        <Head eyebrow="04 공모전" title="신규 캐릭터 공모전" lead="2026년에 처음 열린 공모전" />
        <Rows
          cols={2}
          rows={[
            ['접수', '2026.03.23 ~ 04.30'],
            ['온라인 투표', '2026.05.02 공지'],
            ['결과 발표', '2026.05.08'],
            ['출품작', '7점'],
          ]}
        />
        <p className="ar-sub">투표 결과</p>
        <Rows cols={3} rows={characterResult} />
      </>
    ),
  },
  // 35 캐릭터 갤러리
  {
    id: 'ct-characters',
    chapter: 'contest',
    render: () => (
      <>
        <Head eyebrow="04 공모전" title="출품작" lead="디숭이, 디푸, 도도, 다홍이, 루멘, 아-인, 디우리" />
        <div className="ar-grid ar-grid--char" style={{ gridTemplateColumns: 'repeat(3, 1fr)', '--ar-ratio': '3 / 4' }}>
          {characterWorks.slice(0, 6).map(([k, n]) => (
            <figure key={k} className="ar-grid__cell">
              <Img src={`characters/${k}.webp`} alt={`${n} 캐릭터 포스터`} />
            </figure>
          ))}
        </div>
        <Caption>캐릭터 포스터 (왼쪽부터 디숭이, 디푸, 도도, 다홍이, 루멘, 아-인)</Caption>
      </>
    ),
  },
  // 36 포스터 공모전
  {
    id: 'ct-poster',
    chapter: 'contest',
    render: () => (
      <>
        <Head eyebrow="04 공모전" title="전시회 포스터 공모전" lead="2026 1학기 프로젝트 전시회 포스터 디자인" />
        <Grid srcs={['results-1/7.webp', 'results-1/8.webp', 'results-1/9.webp', 'results-1/10.webp', 'results-1/11.webp', 'results-1/12.webp']} cols={3} ratio="4 / 5" />
        <Caption>최우수상 1점, 우수상 3점, 장려상 1점</Caption>
      </>
    ),
  },
  // 37 장서표
  {
    id: 'ct-bookplate',
    chapter: 'contest',
    render: () => (
      <>
        <Head eyebrow="04 공모전" title="장서표 디자인 공모전" lead="2026 강원과 함께 하는 도서관, 인제 기적의 도서관" />
        <Grid srcs={['results-1/6.webp', 'results-1/1.webp', 'results-1/2.webp', 'results-1/3.webp', 'results-1/4.webp', 'results-1/5.webp']} cols={3} ratio="4 / 5" />
        <Caption>최우수상 1점, 우수상 3점, 장려상 1점</Caption>
      </>
    ),
  },

  // 38 05 오프너
  { id: 'op-brand', chapter: 'brand', tone: 'chapter', render: () => <Opener {...chapterOf('brand')} /> },
  // 39 인스타그램 통일
  {
    id: 'br-insta',
    chapter: 'brand',
    render: () => (
      <>
        <Head eyebrow="05 브랜딩과 인스타그램" title="인스타그램 디자인 통일" lead="@hallym_lucid" />
        <div className="ar-prose">
          <p>
            모집, 행사 안내, 공모전, 전시회 수상작, 교수 소개까지 모든 게시물을 LUCID의 하나의 디자인으로 통일해 정비했습니다. 어떤 게시물을
            봐도 한눈에 전공 운영위원회의 계정임을 알아볼 수 있습니다.
          </p>
        </div>
        <Grid srcs={['insta/recruit-1.webp', 'insta/gaechong-1.webp', 'insta/character-1.webp', 'insta/event-1.webp', 'insta/fair-1.webp', 'insta/closing-1.webp']} cols={3} ratio="4 / 5" />
      </>
    ),
  },
  // 40 인스타 카드뉴스 모음
  {
    id: 'br-cards',
    chapter: 'brand',
    render: () => (
      <>
        <Head eyebrow="05 브랜딩과 인스타그램" title="전시 안내와 동아리 홍보" lead="한 학기를 따라가는 게시물 시리즈" />
        <Grid
          srcs={['exhibit-info/3-1.webp', 'exhibit-info/1-1.webp', 'exhibit-info/2-1.webp', 'insta2/club-exhibit-1.webp', 'insta2/DS4H-1.webp', 'insta2/더인스-1.webp']}
          cols={3}
          ratio="4 / 5"
        />
        <Caption>전시회 안내, 접수 안내, 동아리 전시회, 동아리 홍보 카드뉴스</Caption>
      </>
    ),
  },

  // 41 06 오프너
  { id: 'op-events', chapter: 'events', tone: 'chapter', render: () => <Opener {...chapterOf('events')} /> },
  // 42 행사
  {
    id: 'ev-list',
    chapter: 'events',
    render: () => (
      <>
        <Head eyebrow="06 행사와 대외 활동" title="전공 안에서" />
        <ol className="ar-numbered">
          <li>
            <span className="ar-numbered__no">01</span>
            <div>
              <strong>개강 총회와 비전 설명회</strong>
              <p>2026.03.11 C.square Blue. 운영위원회와 동아리를 소개하고 전공 비전을 설명했습니다.</p>
            </div>
          </li>
          <li>
            <span className="ar-numbered__no">02</span>
            <div>
              <strong>전공 박람회</strong>
              <p>2026 1학기 전공 박람회로 전공을 알렸습니다.</p>
            </div>
          </li>
          <li>
            <span className="ar-numbered__no">03</span>
            <div>
              <strong>미래융합스쿨 교류와 연합 엠티</strong>
              <p>미래융합스쿨 학생회와 교류하고 연합 엠티에서 전공 동아리 네 곳을 소개했습니다.</p>
            </div>
          </li>
          <li>
            <span className="ar-numbered__no">04</span>
            <div>
              <strong>시상식과 종강 총회</strong>
              <p>2026.06.04 C.square Blue. 프로젝트 전시회 시상식과 함께 학기를 마무리했습니다.</p>
            </div>
          </li>
        </ol>
      </>
    ),
  },
  // 43 대외
  {
    id: 'ev-outside',
    chapter: 'events',
    render: () => (
      <>
        <Head eyebrow="06 행사와 대외 활동" title="전공 밖으로" lead="전공을 알리고 연결한 활동입니다." />
        <ol className="ar-numbered">
          <li>
            <span className="ar-numbered__no">01</span>
            <div>
              <strong>2026 Hallym Local Branding Camp</strong>
              <p>Team LUCID가 참가해 Station C를 찾는 외빈을 위한 브랜드 경험을 제안했습니다.</p>
            </div>
          </li>
          <li>
            <span className="ar-numbered__no">02</span>
            <div>
              <strong>Station C 아이데이션 캠프</strong>
              <p>2026.04와 05 두 차례 진행된 캠프에 Team LUCID가 참가했습니다.</p>
            </div>
          </li>
          <li>
            <span className="ar-numbered__no">03</span>
            <div>
              <strong>전공 나침반</strong>
              <p>한림대학교 교수 하계 세미나에서 발표된 전공 10년의 교육 사례를 웹 발표 화면으로 옮겨 공개했습니다.</p>
            </div>
          </li>
        </ol>
      </>
    ),
  },

  // 44 07 오프너
  { id: 'op-ach', chapter: 'achievements', tone: 'chapter', render: () => <Opener {...chapterOf('achievements')} /> },
  // 45 성과 1
  {
    id: 'ach-1',
    chapter: 'achievements',
    render: () => (
      <>
        <Head eyebrow="07 학생 성과" title="2026년의 수상과 선발" lead="전공 웹사이트에 2026년으로 기록된 성과 21건 중 대상이 6건입니다." />
        <ul className="ar-ach">
          {achievements2026.slice(0, 6).map((a) => (
            <li key={a.t}>
              <strong>{a.t}</strong>
              <span>{a.a}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  // 46 성과 2
  {
    id: 'ach-2',
    chapter: 'achievements',
    render: () => (
      <>
        <Head eyebrow="07 학생 성과" title="2026년의 수상과 선발" lead="한국연구재단 이사장상을 두 번 받았고 KDM+는 4년 연속 선발자를 냈습니다." />
        <ul className="ar-ach">
          {achievements2026.slice(6).map((a) => (
            <li key={a.t}>
              <strong>{a.t}</strong>
              <span>{a.a}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },

  // 47 08 클럽 오프너 + 동아리
  { id: 'op-clubs', chapter: 'clubs', tone: 'chapter', render: () => <Opener {...chapterOf('clubs')} /> },
  {
    id: 'clubs',
    chapter: 'clubs',
    render: () => (
      <>
        <Head eyebrow="08 전공 동아리" title="네 개의 동아리" lead="2026년에는 동아리 홍보 카드뉴스, 연합 엠티 발표, 동아리 전시회로 활동을 알렸습니다." />
        <div className="ar-clubs">
          {clubsInfo.map((c) => (
            <article key={c.name}>
              <div className="ar-clubs__img">
                <Img src={c.img} alt={`${c.name} 소개`} />
              </div>
              <div>
                <h3>
                  {c.name} <span>{c.field}</span>
                </h3>
                <p>{c.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </>
    ),
  },
  // 49 맺음
  {
    id: 'closing',
    chapter: 'clubs',
    render: () => (
      <>
        <Head eyebrow="맺음말" title="아직 쓰는 중입니다" />
        <div className="ar-prose">
          <p>2026년의 절반이 남았습니다. 2학기 프로젝트 전시회, 종강 총회, 새 성과가 생기면 이 리포트에 이어서 담겠습니다.</p>
          <p>전공 웹사이트에서 전시회, 공모전, 학생 성과의 전체 기록을 볼 수 있습니다.</p>
          <p className="ar-sign">{reportMeta.council}</p>
        </div>
        <div className="ar-mark ar-mark--small">
          <img src="/images/decade/lucid-mark.svg" alt="LUCID 로고" draggable="false" />
        </div>
      </>
    ),
  },
  // 제작 정보
  {
    id: 'colophon',
    chapter: 'clubs',
    render: () => (
      <>
        <Head eyebrow="제작 정보" title="이 리포트에 대해" />
        <Rows
          cols={2}
          rows={[
            ['발행', `${reportMeta.org} ${reportMeta.council}`],
            ['형식', '웹에서 넘겨 보는 디지털 판'],
            ['2025 리포트', 'A4 40쪽 인쇄 PDF'],
            ['자료', '1학기와 2학기 운영위원회 활동 자료와 전공 웹사이트 기록'],
            ['갱신', '2학기 전시회와 새 성과는 이후 이어서 담습니다'],
          ]}
        />
      </>
    ),
  },
  // 뒷표지
  {
    id: 'back',
    density: 'hard',
    tone: 'cover',
    render: () => (
      <div className="ar-cover ar-cover--back">
        <div className="ar-mark">
          <img src="/images/decade/lucid-mark.svg" alt="" draggable="false" />
        </div>
        <p className="ar-cover__org">{reportMeta.org}</p>
        <p className="ar-cover__sub">{reportMeta.title}</p>
      </div>
    ),
  },
]

function Toc({ toc }) {
  return (
    <>
      <Head eyebrow="Contents" title="목차" />
      <ol className="ar-toc">
        {toc.map((c) => (
          <li key={c.id}>
            <a href={`#p${c.page}`} data-goto={c.page} className="ar-toc__link">
              <span className="ar-toc__no">{c.no}</span>
              <span className="ar-toc__title">
                {c.title}
                <small>{c.sub}</small>
              </span>
              <span className="ar-toc__page">{c.page}</span>
            </a>
          </li>
        ))}
      </ol>
    </>
  )
}
