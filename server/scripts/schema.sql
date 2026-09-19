-- scripts/schema.sql — DAH 웹사이트 DB 스키마 (12_BACKEND.md 4절 초안 그대로)
-- 멱등: CREATE TABLE IF NOT EXISTS + 초기 데이터 ON CONFLICT DO NOTHING.
-- 적용: psql "$DATABASE_URL" -f scripts/schema.sql 또는 node scripts/seed.mjs(내부에서 이 파일을 먼저 실행).

-- 사용자 (권한 4단계 중 로그인 3롤. public은 행 없음)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager')),
  password_hash TEXT,
  must_set_pw   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 공개 제출자 (41_AUTH_CONTRACT). 구글 로그인으로만 생성되며 스태프 users와 신원 클래스가 다르다.
CREATE TABLE IF NOT EXISTS public_users (
  id            SERIAL PRIMARY KEY,
  google_sub    TEXT UNIQUE NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- 주현호 이스터에그 발견 기록. 공개 화면은 최대 3명만 수집하며,
-- 열람·초기화 API는 이름이 주현호인 owner 계정으로 제한된다.
CREATE TABLE IF NOT EXISTS hyunho_easter_egg_discoveries (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  student_no TEXT NOT NULL,
  phone      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 사이트 설정 (hero 버튼 텍스트·링크, 접수 버튼 노출 등 key-value)
CREATE TABLE IF NOT EXISTS site_settings (
  key   TEXT PRIMARY KEY,
  value JSONB
);

-- 게시글형 콘텐츠 (type: notice | lecture | contest | achievement | resource | club)
CREATE TABLE IF NOT EXISTS posts (
  id           SERIAL PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('notice', 'lecture', 'contest', 'achievement', 'resource', 'club')),
  title_ko     TEXT NOT NULL,
  title_en     TEXT,
  body         JSONB,
  tag          TEXT,
  poster_url   TEXT,
  gallery      JSONB,
  external_url TEXT,
  event_start  TIMESTAMPTZ,
  event_end    TIMESTAMPTZ,
  published    BOOLEAN NOT NULL DEFAULT TRUE,
  pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_type_published ON posts (type, published, pinned DESC, created_at DESC);

-- 첨부 파일 배열 (PDF·HWP 등 문서). 형태: [{name, url, type, bytes}]. 공지·자료실 type에서 사용.
-- 마이그레이션 안전: 기존 posts 테이블에도 컬럼 없으면 추가 (IF NOT EXISTS).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS attachments JSONB;

-- P5-2: 시드 멱등 키. 시드가 삽입한 posts를 seed_key로 식별해 ON CONFLICT (seed_key) DO NOTHING으로
-- 중복·덮어쓰기를 막는다. CMS 작성분은 seed_key NULL(유니크 인덱스는 NULL 다수 허용).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS seed_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_seed_key ON posts (seed_key);

-- G1(18_PHASE6): 학생 성과 원문 등장 순서. 목록 정렬 = 연도(tag) DESC, 연도 내 sort ASC.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS sort INTEGER;

-- J10(20_PHASE8): 교과목 학점 표기 "학점-강의-실습" (예: 3-2-2)
ALTER TABLE curriculum ADD COLUMN IF NOT EXISTS credit TEXT;

-- Q2(24_PHASE12): 상단 고정 전시회 CTA 버튼(표시 여부·텍스트·링크)
ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS cta_show BOOLEAN DEFAULT TRUE;
ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS cta_label TEXT;
ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS cta_url TEXT;

-- 교수진
CREATE TABLE IF NOT EXISTS professors (
  id        SERIAL PRIMARY KEY,
  name_ko   TEXT NOT NULL,
  name_en   TEXT,
  title_ko  TEXT,
  title_en  TEXT,
  email     TEXT,
  photo_url TEXT,
  links     JSONB,
  sort      INTEGER NOT NULL DEFAULT 0,
  active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- 산업 멘토단
CREATE TABLE IF NOT EXISTS mentors (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  company TEXT,
  title   TEXT,
  link    TEXT,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- 교과목 로드맵 (track: common | design | ai | culture. common은 로드맵 최상단 고정)
CREATE TABLE IF NOT EXISTS curriculum (
  id       SERIAL PRIMARY KEY,
  grade    INTEGER NOT NULL,
  semester INTEGER,
  track    TEXT NOT NULL CHECK (track IN ('common', 'design', 'ai', 'culture')),
  name_ko  TEXT NOT NULL,
  name_en  TEXT,
  sort     INTEGER NOT NULL DEFAULT 0
);

-- 코드쉐어링 (단일 행 문서. id=1 고정)
CREATE TABLE IF NOT EXISTS codesharing (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  body    JSONB,
  depts   JSONB,
  hwp_url TEXT
);

-- 운영위원회 (기수별 아카이브)
CREATE TABLE IF NOT EXISTS council (
  id         SERIAL PRIMARY KEY,
  ordinal    INTEGER,
  name       TEXT NOT NULL,
  logo_url   TEXT,
  intro      TEXT,
  members    JSONB,
  year_label TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);

-- 전시회 아카이브
CREATE TABLE IF NOT EXISTS exhibitions (
  id             SERIAL PRIMARY KEY,
  semester_label TEXT,
  title          TEXT NOT NULL,
  poster_url     TEXT,
  site_url       TEXT,
  intro          TEXT,
  body           JSONB,
  gallery        JSONB,
  held_at        DATE,
  published      BOOLEAN NOT NULL DEFAULT TRUE
);

-- 쇼케이스 (비로그인 제출 → pending → manager+ 승인 시 published)
CREATE TABLE IF NOT EXISTS showcase (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  topic          TEXT,
  creator        TEXT,
  description    TEXT,
  tools          JSONB,
  link           TEXT,
  main_img       TEXT,
  sub_imgs       JSONB,
  semester_label TEXT,
  edit_pw_hash   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 41_AUTH_CONTRACT: 제출 소유자(public_users.id). 구글 로그인 이전 행은 NULL.
  public_user_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_showcase_status ON showcase (status, created_at DESC);

-- 전시회 접수 설정 (단일 행. id=1 고정. owner·admin이 어드민에서 변경)
CREATE TABLE IF NOT EXISTS exhibition_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  submit_open    TIMESTAMPTZ,
  submit_close   TIMESTAMPTZ,
  edit_close     TIMESTAMPTZ,
  form_schema    JSONB,
  header_visible BOOLEAN NOT NULL DEFAULT TRUE,
  button_mode    TEXT NOT NULL DEFAULT 'header' CHECK (button_mode IN ('header', 'floating'))
);

-- 전시회 접수 (구글 폼 대체. 41_GOOGLE_AUTH_PUBLIC 이후 본인 확인은 구글 로그인)
CREATE TABLE IF NOT EXISTS exhibition_entries (
  id             SERIAL PRIMARY KEY,
  semester_label TEXT,
  entry_type     TEXT NOT NULL CHECK (entry_type IN ('solo', 'team')),
  fields         JSONB,
  email          TEXT NOT NULL,
  -- 41_AUTH_CONTRACT: 구글 로그인 전환으로 신규 접수는 비밀번호를 받지 않는다.
  -- 기존 접수 건의 값이 남아 있으므로 컬럼은 유지하고 NOT NULL 제약만 없앤다.
  pw_hash        TEXT,
  images         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- H1-7(37_SHEET_ROADMAP): 수정용 비밀번호 초기화 이력(누가·언제). admin+만 실행 가능.
  pw_reset_at    TIMESTAMPTZ,
  pw_reset_by    TEXT,
  -- 41_AUTH_CONTRACT: 접수 소유자(public_users.id). 구글 로그인 이전 행은 NULL이며
  -- 이메일이 일치하면 조회 시점에 백필된다.
  public_user_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_exhibition_entries_email ON exhibition_entries (email);

-- 졸업생 취업 현황
CREATE TABLE IF NOT EXISTS careers (
  id          SERIAL PRIMARY KEY,
  grad_name   TEXT NOT NULL,
  majors      TEXT,
  company     TEXT,
  company_url TEXT,
  position    TEXT,
  year        INTEGER,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- 재학생·졸업생 포트폴리오
CREATE TABLE IF NOT EXISTS portfolios (
  id         SERIAL PRIMARY KEY,
  student_no TEXT,
  name       TEXT NOT NULL,
  majors     TEXT,
  link       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);

-- 상담 신청 (Phase 9. POST /consult 공개 접수 → 어드민 열람·읽음 처리)
CREATE TABLE IF NOT EXISTS consultations (
  id         SERIAL PRIMARY KEY,
  company    TEXT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  -- H2-5(37_SHEET_ROADMAP): 이메일 필수 수집(해외 지원자 대응)
  email      TEXT,
  -- S3-1(28_PHASE14): 상담 폼 필드. migrate-phase16에만 있고 schema.sql에 누락돼 있던 것을 함께 정리.
  grade         TEXT,
  main_major    TEXT,
  double_major  TEXT,
  message    TEXT,
  agreed     BOOLEAN NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 나노디그리 (단일 행 문서. id=1 고정 — codesharing과 동일 싱글턴 패턴)
-- body jsonb: { intro, cert, programs: [{ name, courses, partner, rule, note? }] }
CREATE TABLE IF NOT EXISTS nanodegree (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  body JSONB
);

-- ─── Phase 10 (22_PHASE10) ─────────────────────────────────────
-- M1-1: 이미지 배경 옵션 — 투명 로고 등을 중성 배경 프레임 위에 렌더할지 여부.
ALTER TABLE professors  ADD COLUMN IF NOT EXISTS has_bg BOOLEAN DEFAULT FALSE;
ALTER TABLE council     ADD COLUMN IF NOT EXISTS has_bg BOOLEAN DEFAULT FALSE;
ALTER TABLE showcase    ADD COLUMN IF NOT EXISTS has_bg BOOLEAN DEFAULT FALSE;
ALTER TABLE posts       ADD COLUMN IF NOT EXISTS has_bg BOOLEAN DEFAULT FALSE; -- 동아리 로고용

-- M1-2: 전시회 기간·상단 고정. held_at은 레거시 유지.
ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS start_date  DATE;
ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS end_date    DATE;
ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

-- ─── Phase 11 (23_PHASE11) ─────────────────────────────────────
-- N1-2: 전시회 회차. full_title은 exhibitionFullTitle(ordinal)로 파생 — DB에는 회차만 저장.
ALTER TABLE exhibitions ADD COLUMN IF NOT EXISTS ordinal INTEGER;

-- ─── Phase 18 (33_PHASE18) ─────────────────────────────────────
-- Y3-5: 동아리 공식 사이트 URL. 상세 페이지의 "사이트 바로가기" 버튼(새 탭)에 사용.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS site_url TEXT;

-- ─── Phase 51 (51_CONTEST_SPLIT) ───────────────────────────────
-- 공모전 1회차 = post 1건. 이전에는 한 post의 body.editions 배열에 회차를 묶어 두었으나,
-- 회차마다 제목·주최·포스터가 달라 개별 게시글로 분리했다. 아래 3개는 그 분리로 회차가
-- 직접 들고 있어야 하는 값이다(poster_url·title_en·external_url·site_url은 posts에 이미 있다).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS semester_label TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS period TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS host TEXT;

-- 52_CONTEST_CATEGORY: 공모전 종류. 공개 목록을 종류별 섹션으로 묶는 기준이다.
-- category는 정해진 3종 중 하나('기타' 포함)이고, '기타'일 때만 category_etc에 직접 입력값을 담는다.
-- 섹션 묶음은 category로만 하므로 category_etc가 달라도 같은 '기타' 섹션에 모인다.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS category_etc TEXT;

-- N1-5: CI(브랜드 아이덴티티) 단일 행 문서 (codesharing·nanodegree 동일 싱글턴 패턴. id=1 고정)
-- body jsonb: { intro, elements:[{title,text,image}], logoGuide:[{title,image}], colors:[{name,hex}], downloads:[{label,url}] }
CREATE TABLE IF NOT EXISTS ci (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  body JSONB
);

-- ─── 초기 데이터 ───────────────────────────────────────────────

-- 전시회 접수 2026-2 일정 초기값 (12_BACKEND.md 5절. 11-24 00:00부터 신규·수정 전면 차단)
INSERT INTO exhibition_settings (id, submit_open, submit_close, edit_close, form_schema, header_visible, button_mode)
VALUES (
  1,
  '2026-11-02T00:00:00+09:00',
  '2026-11-13T23:59:59+09:00',
  '2026-11-23T23:59:59+09:00',
  NULL,
  TRUE,
  'header'
)
ON CONFLICT (id) DO NOTHING;

-- 코드쉐어링 단일 행 자리 (내용은 seed.mjs가 tracks.js 원문으로 채움)
INSERT INTO codesharing (id, body, depts, hwp_url)
VALUES (1, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- 나노디그리 단일 행 자리 (내용은 migrate-phase9.mjs가 data/nanodegree.js 원문으로 채움)
INSERT INTO nanodegree (id, body)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- CI 단일 행 자리 (내용은 migrate-phase11.mjs가 data/ci.js 원문으로 채움 — body NULL일 때만)
INSERT INTO ci (id, body)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- 학기별 개설 과목 (H3-3, 37_SHEET_ROADMAP)
-- curriculum(과목 마스터)은 그대로 두고, (연도, 학기, 과목) 조합만 여기에 쌓는다.
CREATE TABLE IF NOT EXISTS semester_offerings (
  id            SERIAL PRIMARY KEY,
  year          INTEGER NOT NULL,
  term          INTEGER NOT NULL CHECK (term IN (1, 2)),
  curriculum_id INTEGER NOT NULL REFERENCES curriculum(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 같은 학기에 같은 과목 중복 등록 방지 (POST /admin/offerings의 ON CONFLICT가 이 인덱스를 쓴다)
CREATE UNIQUE INDEX IF NOT EXISTS semester_offerings_unique_idx
  ON semester_offerings (year, term, curriculum_id);
CREATE INDEX IF NOT EXISTS semester_offerings_semester_idx
  ON semester_offerings (year DESC, term DESC);

-- ─── Phase 39 (39_FORM_BUILDER) ────────────────────────────────
-- 구글 폼 대체 자체 폼. 폼 정의(제목·안내문·필드)는 전부 DB에 둔다 — 내년 담당자가
-- 코드를 고치지 않고 내용만 바꿔 쓸 수 있어야 한다는 것이 이 테이블의 존재 이유다.
-- fields: [{ id, label_ko, label_en, type, required, hint_ko, options, validation, order }]
-- settings: { accept_start, accept_end, edit_end, require_google_auth, max_responses,
--             show_button_in_header, button_label_ko, button_label_en }
CREATE TABLE IF NOT EXISTS custom_forms (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title_ko        TEXT NOT NULL,
  title_en        TEXT,
  description_ko  TEXT,
  description_en  TEXT,
  category        TEXT NOT NULL DEFAULT 'other',
  fields          JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  published       BOOLEAN NOT NULL DEFAULT FALSE,
  seed_key        TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_forms_seed_key ON custom_forms (seed_key);

-- 응답. 본인 확인은 구글 로그인(public_users)이다 — 41_GOOGLE_AUTH_PUBLIC에서 공개 제출자
-- 비밀번호 방식을 폐지했으므로 수정용 비밀번호 컬럼은 두지 않는다.
CREATE TABLE IF NOT EXISTS custom_form_responses (
  id             SERIAL PRIMARY KEY,
  form_id        INTEGER NOT NULL REFERENCES custom_forms(id) ON DELETE CASCADE,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_user_id INTEGER,
  google_email   TEXT,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_responses_form ON custom_form_responses (form_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_responses_user ON custom_form_responses (form_id, public_user_id);

-- ── 53_DRIVE_STORAGE: Google Drive 저장소 연동 ──────────────────────────────
-- 연결 프로필. refresh token은 DRIVE_TOKEN_ENC_KEY로 봉인해서만 저장하고 API로는 내보내지 않는다.
CREATE TABLE IF NOT EXISTS google_drive_connections (
  id                SERIAL PRIMARY KEY,
  label             TEXT NOT NULL,
  account_email     TEXT,
  auth_mode         TEXT NOT NULL DEFAULT 'oauth',
  scope             TEXT,
  root_folder_id    TEXT,
  root_folder_name  TEXT,
  refresh_token_enc TEXT,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_check_at     TIMESTAMPTZ,
  last_check_ok     BOOLEAN,
  last_error        TEXT DEFAULT '',
  created_by        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 경로 → 폴더 ID 캐시. 같은 경로를 여러 번 요청해도 같은 폴더로 수렴한다.
CREATE TABLE IF NOT EXISTS google_drive_folder_bindings (
  id            SERIAL PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES google_drive_connections(id) ON DELETE CASCADE,
  path_key      TEXT NOT NULL,
  path_labels   JSONB NOT NULL DEFAULT '[]'::jsonb,
  folder_id     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_drive_binding_path
  ON google_drive_folder_bindings (connection_id, path_key);

-- 업로드 기록. 폼 제출 전 업로드는 pending, 응답 저장 시 attached로 바뀐다(자동 삭제 없음).
CREATE TABLE IF NOT EXISTS form_file_uploads (
  id              SERIAL PRIMARY KEY,
  form_id         INTEGER,
  field_id        TEXT NOT NULL,
  response_id     INTEGER,
  public_user_id  INTEGER,
  submitter_email TEXT,
  idempotency_key TEXT NOT NULL,
  storage         TEXT NOT NULL,
  purpose         TEXT,
  connection_id   INTEGER,
  drive_file_id   TEXT,
  file_url        TEXT,
  folder_id       TEXT,
  original_name   TEXT,
  stored_name     TEXT,
  mime            TEXT,
  bytes           BIGINT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  attached_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_form_file_uploads_idem ON form_file_uploads (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_form_file_uploads_form ON form_file_uploads (form_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_file_uploads_url ON form_file_uploads (file_url);
