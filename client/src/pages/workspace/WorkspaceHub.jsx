// /workspace/:kind (docs | sheets | forms | boards | slides): 문서·스프레드시트·설문지·보드·프레젠테이션 홈.
// 구조: 상단 바(햄버거, 제품 아이콘과 이름, 검색, 5종 전환, 계정) → 템플릿 띠 → 최근 항목(카드 격자 또는 목록, 정렬, 필터, 항목별 ⋮ 메뉴).
// 왼쪽 메뉴에서 "내 파일"(내가 만든 파일, 공유받은 파일, 링크로 연 파일)과 내가 속한 팀 공간(?team=<id>)을 고른다.
// 팀 공간에서 템플릿으로 만들면 그 팀 파일(팀원 모두 편집자)로 만들어진다.
// 문서·시트·보드·슬라이드는 /workspace/files, 폼은 /admin/forms를 쓴다.
// 문서 홈에는 "Notion에서 가져오기"가 있다(연동 페이지에서 노션 토큰을 연결해야 한다).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownAZ, ChevronDown, ExternalLink, FolderClosed, LayoutGrid, List, Menu, Pencil, Plus, Search, Settings, Table2, Trash2, X, Clock3, ListChecks, Lock, UsersRound, Undo2, Link2, FileDown, Upload } from 'lucide-react'
import { api, API_BASE } from '../../hooks/useApi'
import { hwpCreate, hwpUpload } from '../hwpfile/hwpApi'
import { errorText as hwpErrorText } from '../hwpfile/hwpCore'
import { useAuth } from '../../context/AuthContext'
import AccountMenu, { GoogleG, startGoogleLogin, useMe } from '../../components/common/AccountMenu'
import WorkspaceToggle from '../../components/layout/WorkspaceToggle'
import { alertDialog, confirmDialog, promptDialog } from '../../components/common/AppDialog'
import { ICONS, KINDS } from './icons'
import './workspace.css'

const FORM_SETTINGS = {
  accept_start: '', accept_end: '', edit_end: '', require_google_auth: true, confirmation_mail: true, max_responses: '',
  show_button_in_header: false, button_label_ko: '', button_label_en: '', drive_enabled: false, drive_folder_id: '',
  drive_auto_folder: true, drive_semester: '', drive_course_field_id: '', drive_share_mode: 'restricted', drive_connection_id: '',
}
const f = (id, label_ko, type, extra = {}) => ({ id, label_ko, type, required: false, options: [], ...extra })
// 개인정보 수집·이용 동의(공개 대학 동의서의 공통 요소: 수집 항목, 목적, 보유 기간, 거부 권리와 불이익). 보유 기간은 행사에 맞게 고친다.
const consent = (id, items, purpose) =>
  f(id, '개인정보 수집·이용 동의', 'radio', {
    required: true,
    options: ['동의합니다', '동의하지 않습니다'],
    hint_ko: `수집 항목: ${items}\n이용 목적: ${purpose}\n보유 기간: 목적 달성 후 ○년(행사에 맞게 수정)\n동의를 거부할 수 있으며, 거부하면 신청이 제한될 수 있습니다.`,
  })
// 템플릿 근거: 개강·종강총회 방명록 hwp, 기말전시 기획안(참여형 방명록), 포스터 공모전 요강·출품자 명단,
// 근로일지 기록카드 hwp, 멘토 결과 보고서 hwpx (구조만 옮김)
const FORM_TEMPLATES = [
  { id: 'blank', name: '빈 양식', sub: '', title: '제목 없는 설문지', category: 'other', fields: [f('f1', '제목 없는 질문', 'radio', { options: ['옵션 1'] })] },
  {
    id: 'register', name: '행사 참가 신청', sub: '학과, 학번, 참석 여부', title: '행사 참가 신청', category: 'event',
    desc: '행사 참가 신청서입니다.\n일시: \n장소: ',
    fields: [
      f('f1', '학과', 'text', { required: true }),
      f('f2', '학번', 'studentid', { required: true }),
      f('f3', '성명', 'text', { required: true }),
      f('f4', '연락처', 'phone', { required: true }),
      f('f5', '참석 여부', 'radio', { required: true, options: ['참석', '불참'] }),
      f('f6', '문의 사항', 'textarea'),
      consent('f7', '학과, 학번, 성명, 연락처', '참가자 확인과 행사 안내 연락'),
    ],
  },
  {
    id: 'guestbook', name: '방명록', sub: '이름과 남길 말', title: '방명록', category: 'event',
    desc: '행사에 와 주셔서 고맙습니다. 남기고 싶은 말을 적어 주세요.',
    fields: [
      f('f1', '학과', 'text', { required: true }),
      f('f2', '학번', 'studentid'),
      f('f3', '성명', 'text', { required: true }),
      f('f4', '남길 말', 'textarea', { required: true }),
      f('f5', '남긴 말을 전시·홍보에 공개해도 될까요?', 'radio', { required: true, options: ['공개해도 됩니다', '공개하지 않습니다'] }),
    ],
  },
  {
    id: 'contest', name: '공모전 출품 신청', sub: '작품, 소개, AI 활용', title: '공모전 출품 신청', category: 'other',
    desc: '공모전 출품 신청서입니다. 작품 규격과 파일 형식은 공모전 안내를 확인해 주세요.',
    fields: [
      f('f1', '참가 유형', 'radio', { required: true, options: ['개인', '팀'] }),
      f('f2', '이름(팀이면 대표자)', 'text', { required: true }),
      f('f3', '학과', 'text', { required: true }),
      f('f4', '학번', 'studentid', { required: true }),
      f('f5', '연락처', 'phone', { required: true }),
      f('f6', '이메일', 'email', { required: true }),
      f('f7', '작품명', 'text', { required: true }),
      f('f8', '작품 소개', 'textarea', { required: true }),
      f('f9', '생성형 AI 활용 도구와 활용 내용', 'textarea', { hint_ko: '사용하지 않았다면 비워 두세요.' }),
      consent('f10', '이름, 학과, 학번, 연락처, 이메일', '출품자 확인, 심사, 결과 안내, 시상'),
      f('f11', '수상작 공개 동의', 'radio', { required: true, options: ['동의합니다', '동의하지 않습니다'], hint_ko: '수상작은 전시, 웹사이트, 인스타그램에 작품명과 이름이 공개될 수 있습니다.' }),
    ],
  },
  {
    id: 'worklog', name: '근무 기록 제출', sub: '날짜, 시간, 내용', title: '근무 기록 제출', category: 'other',
    desc: '근무한 날마다 한 번씩 제출합니다.',
    fields: [
      f('f1', '이름', 'text', { required: true }),
      f('f2', '학번', 'studentid', { required: true }),
      f('f3', '근무 날짜', 'date', { required: true }),
      f('f4', '시작 시각', 'time', { required: true }),
      f('f5', '종료 시각', 'time', { required: true }),
      f('f6', '근무 내용', 'textarea', { required: true }),
      f('f7', '확인', 'checkbox', { required: true, options: ['위 내용이 사실과 같음을 확인합니다'] }),
    ],
  },
  {
    id: 'mentoring', name: '멘토링·특강 결과 보고', sub: '활동, 의견, 만족도', title: '멘토링·특강 결과 보고', category: 'other',
    desc: '멘토링 또는 특강이 끝난 뒤 작성합니다.',
    fields: [
      f('f1', '이름', 'text', { required: true }),
      f('f2', '학과·전공', 'text', { required: true }),
      f('f3', '학번', 'studentid', { required: true }),
      f('f4', '활동 날짜', 'date', { required: true }),
      f('f5', '활동 시간(시간)', 'text', { required: true }),
      f('f6', '참여 인원', 'text'),
      f('f7', '활동 내용', 'textarea', { required: true }),
      f('f8', '참여 학생에게 필요한 사항', 'textarea'),
      f('f9', '프로그램을 위한 건의 사항', 'textarea'),
      f('f10', '종합 소감', 'textarea'),
      f('f11', '전체 만족도', 'scale', { required: true, validation: { min: 1, max: 5 } }),
    ],
  },
]

function fmtDate(iso, prefixToday = false) {
  if (!iso) return ''
  const d = new Date(iso)
  const n = new Date()
  if (d.toDateString() === n.toDateString()) {
    const h = d.getHours()
    return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

/* 썸네일: 문서 쪽 미리보기, 시트 격자, 폼 카드 */
function DocThumb({ text }) {
  const [first, ...rest] = String(text || '').split('\n')
  return (
    <div className="ws-thumb ws-thumb--doc">
      {first && <b>{first}</b>}
      <p>{rest.join('\n')}</p>
    </div>
  )
}
function SheetThumb({ head = [], rows = [] }) {
  return (
    <div className="ws-thumb ws-thumb--sheet">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
function FormThumb({ title, fields = [] }) {
  return (
    <div className="ws-thumb ws-thumb--form">
      <div className="ws-thumb__card ws-thumb__card--head"><b>{title}</b></div>
      {fields.slice(0, 3).map((x, i) => (
        <div key={i} className="ws-thumb__card"><span>{x.label_ko}{x.required ? ' *' : ''}</span><i /></div>
      ))}
    </div>
  )
}

/* 보드 썸네일: 점 격자 위에 메모 두 장과 키워드 하나(내용 미리보기 대신 자리 표시) */
function BoardThumb({ count }) {
  return (
    <div className="ws-thumb ws-thumb--board">
      <i className="ws-thumb__memo" style={{ left: '12%', top: '18%' }} />
      <i className="ws-thumb__memo" style={{ left: '52%', top: '40%' }} />
      <i className="ws-thumb__chip" style={{ left: '20%', top: '66%' }} />
      <svg className="ws-thumb__link" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M46 30 C 50 30, 48 52, 52 52" /></svg>
      {count > 0 && <span className="ws-thumb__count">{count}</span>}
    </div>
  )
}

/* 슬라이드 썸네일: 16:9 흰 카드에 첫 슬라이드의 제목 글 */
function SlideThumb({ title, bg = '#ffffff', fg = '#111111', small = false }) {
  return (
    <div className={`ws-thumb ws-thumb--slide${small ? ' is-small' : ''}`}>
      <div className="ws-slide" style={{ background: bg, color: fg }}>
        <b>{title}</b>
      </div>
    </div>
  )
}

/* 한글 파일 썸네일: 서버가 그린 1쪽 PNG(버전별로 캐시됨). 서버가 PNG 를 못 만드는 환경이면 쪽 그림(svg)으로 대신하고, 그것도 안 되면 빈 종이 */
let hwpPngBroken = false
function HwpThumb({ file }) {
  const [src, setSrc] = useState(null)
  const [bad, setBad] = useState(false)
  const v = file.current_version || 1
  useEffect(() => {
    let live = true
    let url = null
    const png = `${API_BASE}/hwp/files/${file.id}/thumbs/1.png?version=${v}`
    const svg = async () => {
      try {
        const r = await fetch(`${API_BASE}/hwp/files/${file.id}/pages?from=1&to=1&version=${v}&format=svg`, { credentials: 'include' })
        const j = await r.json()
        const s = j?.pages?.[0]?.svg
        if (!s || !live) throw new Error('none')
        url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }))
        setSrc(url)
      } catch {
        if (live) setBad(true)
      }
    }
    if (hwpPngBroken) svg()
    else setSrc(png)
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.id, v])
  return (
    <div className="ws-thumb ws-thumb--hwp">
      {bad || !src ? (
        <i className="ws-thumb__paper" />
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => {
            if (src.startsWith('blob:')) return setBad(true)
            hwpPngBroken = true
            setSrc(null)
            fetch(`${API_BASE}/hwp/files/${file.id}/pages?from=1&to=1&version=${v}&format=svg`, { credentials: 'include' })
              .then((r) => r.json())
              .then((j) => {
                const s = j?.pages?.[0]?.svg
                if (!s) throw new Error('none')
                setSrc(URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' })))
              })
              .catch(() => setBad(true))
          }}
        />
      )}
      {file.format && <span className="ws-thumb__fmt">{String(file.format).toUpperCase()}</span>}
    </div>
  )
}

/* 한글 새로 만들기 칸: 종이 위에 두문 줄 모양, 올리기는 위쪽 화살표 */
function HwpTplThumb({ tpl }) {
  if (tpl.id === 'upload') return <div className="ws-plus"><Upload size={40} strokeWidth={2.2} /></div>
  return (
    <div className="ws-thumb ws-thumb--hwptpl">
      <b>{tpl.paper}</b>
      <i /><i /><i className="is-short" />
    </div>
  )
}

function TemplateThumb({ kind, tpl }) {
  if (kind === 'hwp') return <HwpTplThumb tpl={tpl} />
  if (tpl.id === 'blank') return <div className="ws-plus"><Plus size={44} strokeWidth={2.4} /></div>
  if (kind === 'docs') return <DocThumb text={tpl.preview || tpl.name} />
  if (kind === 'sheets') return <SheetThumb head={tpl.head || [tpl.name]} rows={tpl.rows || []} />
  if (kind === 'boards') return <BoardThumb />
  if (kind === 'slides') return <SlideThumb title={tpl.name} small />
  return <FormThumb title={tpl.title} fields={tpl.fields} />
}

// 한글(HWPX) 양식: 같은 문서 템플릿을 kordoc으로 공문서 서식의 HWPX로 만든 파일(client/public/templates)
const HWPX_FILES = [
  { name: '행사·전시 기획안', href: '/templates/dah-plan.hwpx' },
  { name: '행사 결과 보고서', href: '/templates/dah-report.hwpx' },
  { name: '회의록', href: '/templates/dah-minutes.hwpx' },
  { name: '공모전 안내', href: '/templates/dah-contest.hwpx' },
  { name: '방명록', href: '/templates/dah-guestbook.hwpx' },
]

const DOC_PREVIEW = {
  plan: '행사·전시 기획안\n행사명 슬로건 일시 장소\n1. 기획 의도 및 목적\n2. 실행 방안\n현장 프로그램 공간 구성\n홍보 방안\n3. 필요 물품 및 예산\n4. 추진 일정\n5. 운영 인원',
  report: '행사 결과 보고서\n행사명 일시 장소\n참석 인원 추진 목적\n1. 주요 행사 내용\n2. 행사 효과\n3. 행사 현장 사진\n4. 정산\n참여자 명단',
  minutes: '회의록\n1. 회의 개요\n2. 참석자\n3. 상정 안건\n4. 논의 내용\n5. 결정 사항\n6. 기타',
  contest: '공모전 안내\n접수 기간 참가 대상\n1. 공모 주제\n2. 출품 양식\n3. 시상 내용\n4. 세부 일정\n5. 출품 방법\n6. 유의 사항',
  guestbook: '방명록\n행사명 일시 장소\n순번 학과 학번 성명 서명\n1\n2\n3\n4\n5',
}
const SHEET_PREVIEW = {
  participants: { head: ['순번', '학과', '학번', '성명', '참석'], rows: [['1', '', '', '', ''], ['2', '', '', '', ''], ['3', '', '', '', '']] },
  budget: { head: ['구분', '물품', '단가', '수량', '금액'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
  judging: { head: ['순번', '작품명', '과목명', '대표학생', '독창성'], rows: [['1', '', '', '', ''], ['2', '', '', '', ''], ['3', '', '', '', '']] },
  worklog: { head: ['날짜', '요일', '근무자', '내용', '시간'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
  files: { head: ['ID', '과목', '작품명', '파일명', '제출'], rows: [['', '', '', '', ''], ['', '', '', '', '']] },
}

function CardMenu({ items, onClose, anchorRef, align = 'right' }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  // 메뉴는 body에 고정 위치로 띄운다: 목록 아래쪽 카드에서도 잘리지 않고, 공간이 모자라면 위로 열린다
  useLayoutEffect(() => {
    const a = anchorRef?.current?.getBoundingClientRect()
    const m = ref.current
    if (!a || !m) return
    const w = m.offsetWidth
    const h = m.offsetHeight
    const left = align === 'right' ? Math.min(Math.max(8, a.right - w), window.innerWidth - w - 8) : Math.min(a.left, window.innerWidth - w - 8)
    const below = a.bottom + 2
    const top = below + h > window.innerHeight - 8 ? Math.max(8, a.top - h - 2) : below
    setPos({ top, left })
  }, [anchorRef, align, items.length])
  useEffect(() => {
    const down = (e) => {
      if (ref.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    const key = (e) => e.key === 'Escape' && onClose()
    const away = () => onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', away)
    document.querySelector('.ws')?.addEventListener('scroll', away, { passive: true })
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', away)
      document.querySelector('.ws')?.removeEventListener('scroll', away)
    }
  }, [onClose, anchorRef])
  return createPortal(
    <div ref={ref} className="ws-menu ws-menu--fixed" role="menu" style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="ws-menu__item" disabled={it.disabled} onClick={() => { onClose(); it.onClick() }}>
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}

function FileCard({ file, kind, view, showTeam, onOpen, onRename, onDelete, onNewTab, onRestore, onPurge, extraMenu = [] }) {
  const [menu, setMenu] = useState(false)
  const btn = useRef(null)
  const Icon = ICONS[kind]
  const items = file.trashed ? [
    ...(file.can_delete ? [{ label: '복원', icon: <Undo2 size={20} />, onClick: () => onRestore(file) }, { label: '영구 삭제', icon: <Trash2 size={20} />, onClick: () => onPurge(file) }] : []),
  ] : [
    { label: '이름 바꾸기', icon: <Pencil size={20} />, onClick: () => onRename(file), disabled: file.my_role === 'viewer' },
    ...(file.can_delete ? [{ label: '휴지통으로 이동', icon: <Trash2 size={20} />, onClick: () => onDelete(file) }] : []),
    { label: '새 탭에서 열기', icon: <ExternalLink size={20} />, onClick: () => onNewTab(file) },
    ...extraMenu.map((m) => ({ ...m, onClick: () => m.onClick(file) })),
  ]
  const hasMenu = items.length > 0
  const thumb = kind === 'docs' ? <DocThumb text={file.excerpt} /> : kind === 'sheets' ? <SheetThumb head={file.head} rows={file.preview} /> : kind === 'boards' ? <BoardThumb count={file.items} /> : kind === 'slides' ? <SlideThumb title={file.slide_preview?.title || file.title} bg={file.slide_preview?.bg} fg={file.slide_preview?.fg} /> : kind === 'hwp' ? <HwpThumb file={file} /> : <FormThumb title={file.title} fields={file.fields} />
  const tag = file.owner_only
    ? <em className="ws-tag" title="만든 사람만 볼 수 있습니다"><Lock size={12} />나만 보기</em>
    : showTeam && file.team_name ? <em className="ws-tag ws-tag--team" title={`${file.team_name} 팀 파일`}><UsersRound size={12} /><span>{file.team_name}</span></em> : null

  if (view === 'list') {
    return (
      <div className="ws-row" onClick={() => onOpen(file)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
        <span className="ws-row__title"><Icon size={24} />{file.title}{tag}</span>
        <span className="ws-row__owner">{file.mine ? '나' : file.created_by || '-'}</span>
        <span className="ws-row__date">{file.trashed ? `${file.days_left}일 뒤 삭제` : fmtDate(file.opened_at || file.updated_at)}</span>
        <span className="ws-row__more" onClick={(e) => e.stopPropagation()}>
          {hasMenu && <button ref={btn} type="button" className="ws-iconbtn" aria-label="더보기" onClick={() => setMenu((v) => !v)}><MoreV /></button>}
          {menu && <CardMenu items={items} onClose={() => setMenu(false)} anchorRef={btn} />}
        </span>
      </div>
    )
  }
  return (
    <div className="ws-card" role="button" tabIndex={0} onClick={() => onOpen(file)} onKeyDown={(e) => e.key === 'Enter' && onOpen(file)}>
      <div className={`ws-card__thumb ws-card__thumb--${kind}`}>{thumb}</div>
      <div className="ws-card__foot">
        <strong title={file.title}>{file.title}</strong>
        <div className="ws-card__meta">
          <Icon size={22} />
          {tag}
          <span>{file.trashed ? `${file.days_left}일 뒤 삭제` : fmtDate(file.opened_at || file.updated_at, true)}</span>
          <span className="ws-card__more" onClick={(e) => e.stopPropagation()}>
            {hasMenu && <button ref={btn} type="button" className="ws-iconbtn" aria-label="더보기" onClick={() => setMenu((v) => !v)}><MoreV /></button>}
            {menu && <CardMenu items={items} onClose={() => setMenu(false)} anchorRef={btn} />}
          </span>
        </div>
      </div>
    </div>
  )
}

function MoreV() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="19" r="2" fill="currentColor" /></svg>
  )
}

const KIND_API = { docs: 'doc', sheets: 'sheet', boards: 'board', slides: 'slide', hwp: 'hwp' }
const NOUN = { docs: '문서', sheets: '스프레드시트', forms: '설문지', boards: '보드', slides: '프레젠테이션', hwp: '한글 문서' }

// 한글 새로 만들기: 서버 내장 서식(gian, gian-simple)과 보고서(개조식 마크다운). 올리기는 파일 선택 창을 연다.
const HWP_TEMPLATES = [
  { id: 'gian', name: '빈 기안문', sub: '일반기안문 서식', paper: '기안문' },
  { id: 'gian-simple', name: '간이 기안문', sub: '간이기안문 서식', paper: '간이' },
  { id: 'report', name: '보고서', sub: '개조식 보고서', paper: '보고서' },
  { id: 'upload', name: '파일 올리기', sub: '.hwp .hwpx .docx' },
]
const HWP_REPORT_MD = '# 보고서 제목\n\n> 보고 목적을 한 문장으로 쓴다.\n\n## 1. 추진 배경\n\n- 배경을 항목별로 쓴다\n\n## 2. 주요 내용\n\n- 내용을 항목별로 쓴다\n\n## 3. 향후 계획\n\n- 계획을 항목별로 쓴다\n'

export default function WorkspaceHub() {
  const { kind } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { me, reload: reloadMe } = useMe()
  const [params, setParams] = useSearchParams()
  const signedIn = Boolean(me?.user)
  const teamParam = Number(params.get('team')) || null
  const [teams, setTeams] = useState(null)
  const team = teamParam && teams ? teams.find((t) => t.id === teamParam) || null : null
  const [files, setFiles] = useState([])
  const [templates, setTemplates] = useState({ doc: [], sheet: [], board: [], slide: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState('grid')
  const [sort, setSort] = useState('opened')
  const [owner, setOwner] = useState('all')
  const [ownerMenu, setOwnerMenu] = useState(false)
  const [drawer, setDrawer] = useState('closed') // closed | open | closing
  const closeDrawer = () => {
    setDrawer('closing')
    setTimeout(() => setDrawer('closed'), 220)
  }
  const [busy, setBusy] = useState(false)
  const ownerBtn = useRef(null)
  const hwpBtn = useRef(null)
  const hwpInput = useRef(null)
  const [hwpMenu, setHwpMenu] = useState(false)
  const K = KINDS[kind]
  const Icon = ICONS[kind] || ICONS.docs

  useEffect(() => {
    if (K) document.title = `${team ? `${team.name} · ` : ''}${K.name} | 디인예 워크스페이스`
  }, [K, team])

  const loadTeams = useCallback(async () => {
    try {
      const r = await api.get('/workspace/teams')
      setTeams(r.items || [])
    } catch {
      setTeams([])
    }
  }, [])
  useEffect(() => {
    if (me === undefined) return // 계정 정보를 읽는 중
    if (signedIn) loadTeams()
    else setTeams([])
  }, [me, signedIn, loadTeams])

  // 팀이 없어졌거나 내가 팀원이 아니면 내 파일로 돌아간다(계정과 팀 목록을 다 읽은 뒤에만 판단)
  useEffect(() => {
    if (!teamParam || !teams || team || me === undefined) return
    const next = new URLSearchParams(params)
    next.delete('team')
    setParams(next, { replace: true })
    setError('팀을 찾을 수 없거나 팀원이 아닙니다. 내 파일을 보여 줍니다.')
  }, [teamParam, teams, team, me, params, setParams])

  const load = useCallback(async () => {
    if (teamParam && !team) return
    setLoading(true)
    setError('')
    try {
      const scope = { ...(owner === 'trash' ? { trash: '1' } : {}), ...(teamParam ? { team: String(teamParam) } : {}) }
      if (kind === 'forms') {
        const r = await api.get('/admin/forms', scope)
        setFiles(
          (r.items || []).map((x) => ({
            id: x.id, title: x.title_ko || '제목 없는 설문지', created_by: '', opened_at: x.updated_at, updated_at: x.updated_at,
            fields: Array.isArray(x.fields) ? x.fields : [], response_count: x.response_count, slug: x.slug,
            ws_id: x.ws_id, my_role: x.my_role, mine: x.mine, can_delete: x.can_delete, team_id: x.team_id,
            trashed: x.trashed, days_left: x.days_left,
          }))
        )
      } else {
        const r = await api.get('/workspace/files', { kind: KIND_API[kind] || 'doc', ...scope })
        setFiles(r.items || [])
      }
    } catch (e) {
      setFiles([])
      setError(e.message || '불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [kind, owner, teamParam, team])

  useEffect(() => {
    if (K && !authLoading && me !== undefined) load()
  }, [K, load, authLoading, me])

  // 다른 계정으로 바꾸면 계정 정보와 목록을 다시 읽는다
  const staffId = user?.id ?? null
  const firstStaff = useRef(true)
  useEffect(() => {
    if (firstStaff.current) { firstStaff.current = false; return }
    reloadMe()
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId])

  // 구글 로그인이 실패하면 서버가 ?login_error=로 돌려보낸다. 안내를 띄우고 주소에서 지운다.
  useEffect(() => {
    const msg = params.get('login_error')
    if (!msg) return
    const next = new URLSearchParams(params)
    next.delete('login_error')
    setParams(next, { replace: true })
    alertDialog({ title: '로그인하지 못했습니다', message: msg })
  }, [params, setParams])

  useEffect(() => {
    if (signedIn) api.get('/workspace/templates').then((r) => setTemplates({ doc: [], sheet: [], board: [], slide: [], ...r })).catch(() => {})
  }, [signedIn])

  const tplList = useMemo(() => {
    if (kind === 'forms') return FORM_TEMPLATES
    if (kind === 'boards') return templates.board?.length ? templates.board : [{ id: 'blank', name: '빈 보드', sub: '' }]
    if (kind === 'slides') return templates.slide?.length ? templates.slide : [{ id: 'blank', name: '빈 프레젠테이션', sub: '' }]
    if (kind === 'hwp') return HWP_TEMPLATES
    const src = kind === 'docs' ? templates.doc : templates.sheet
    return src.map((t) => ({ ...t, ...(kind === 'docs' ? { preview: DOC_PREVIEW[t.id] } : SHEET_PREVIEW[t.id] || {}) }))
  }, [kind, templates])

  const shown = useMemo(() => {
    let list = files.filter((x) => !q.trim() || x.title.toLowerCase().includes(q.trim().toLowerCase()))
    if (owner === 'mine') list = list.filter((x) => x.mine)
    const rest = [...list]
    rest.sort(sort === 'name' ? (a, b) => a.title.localeCompare(b.title, 'ko') : (a, b) => new Date(b.opened_at || b.updated_at) - new Date(a.opened_at || a.updated_at))
    return rest
  }, [files, q, owner, sort])

  if (!K) return <Navigate to="/workspace/docs" replace />
  if (authLoading) return null

  const spaceQuery = teamParam ? `?team=${teamParam}` : ''
  const pickSpace = (id) => {
    const next = new URLSearchParams(params)
    if (id) next.set('team', String(id))
    else next.delete('team')
    setOwner('all')
    setParams(next)
    closeDrawer()
  }
  async function createTeam() {
    closeDrawer()
    const name = await promptDialog({ title: '팀 만들기', label: '팀 이름', defaultValue: '', confirmLabel: '만들기' })
    if (!name || !name.trim()) return
    try {
      const r = await api.post('/workspace/teams', { name: name.trim() })
      await loadTeams()
      pickSpace(r.team.id)
    } catch (e) {
      setError(e.hint ? `${e.message} (${e.hint})` : e.message)
    }
  }

  const open = (file) => {
    if (file.trashed) return alertDialog({ title: '휴지통에 있는 파일입니다', message: `"${file.title}"은(는) 복원해야 열 수 있습니다. 카드의 ⋮ 메뉴에서 복원하세요. ${file.days_left}일 뒤에 영구 삭제됩니다.` })
    if (kind === 'docs') {
      api.post(`/workspace/files/${file.id}/open`).catch(() => {})
      return navigate(`/docs/${file.first_tab}`)
    }
    if (kind === 'boards') {
      api.post(`/workspace/files/${file.id}/open`).catch(() => {})
      return navigate(`/boards/${file.id}`)
    }
    if (kind === 'slides') {
      api.post(`/workspace/files/${file.id}/open`).catch(() => {})
      return navigate(`/slides/${file.id}`)
    }
    if (kind === 'hwp') {
      api.post(`/workspace/files/${file.id}/open`).catch(() => {})
      return navigate(`/hwp/${file.id}`)
    }
    if (kind === 'sheets') return navigate(`/sheets/${file.id}`)
    return navigate(`/form/${file.id}/edit`)
  }
  const urlOf = (file) => (kind === 'docs' ? `/docs/${file.first_tab}` : kind === 'sheets' ? `/sheets/${file.id}` : kind === 'boards' ? `/boards/${file.id}` : kind === 'slides' ? `/slides/${file.id}` : kind === 'hwp' ? `/hwp/${file.id}` : `/form/${file.id}/edit`)

  // 한글: 올린 파일(.hwp .hwpx .docx)을 서버가 읽어 새 파일로 만든다
  async function uploadHwp(file) {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await hwpUpload(file, team ? { team_id: team.id } : {})
      navigate(`/hwp/${(r.item || r).id}`)
    } catch (e) {
      setError(hwpErrorText(e))
      setBusy(false)
    }
  }

  async function createFrom(tpl) {
    if (busy) return
    if (kind === 'hwp' && tpl.id === 'upload') {
      hwpInput.current?.click()
      return
    }
    setBusy(true)
    const inTeam = team ? { team_id: team.id } : {}
    try {
      if (kind === 'hwp') {
        const body = tpl.id === 'report' ? { template: 'markdown', markdown: HWP_REPORT_MD, preset: '보고서', title: '제목 없는 보고서', ...inTeam } : { template: tpl.id, title: tpl.name, ...inTeam }
        const r = await hwpCreate(body)
        navigate(`/hwp/${(r.item || r).id}`)
      } else if (kind === 'forms') {
        const payload = {
          slug: `form-${Date.now().toString(36)}`, title_ko: tpl.title, title_en: '', description_ko: tpl.desc || '', description_en: '',
          category: tpl.category, fields: tpl.fields, published: false, settings: FORM_SETTINGS, ...inTeam,
        }
        const r = await api.post('/admin/forms', payload)
        navigate(`/form/${r.item.id}/edit`, { state: { justSaved: true } })
      } else if (kind === 'docs') {
        const r = await api.post('/workspace/files', { kind: 'doc', template: tpl.id, ...inTeam })
        navigate(`/docs/${r.item.first_tab}`)
      } else if (kind === 'boards') {
        const r = await api.post('/workspace/files', { kind: 'board', template: 'blank', ...inTeam })
        navigate(`/boards/${r.item.id}`)
      } else if (kind === 'slides') {
        const r = await api.post('/workspace/files', { kind: 'slide', template: tpl.id, ...inTeam })
        navigate(`/slides/${r.item.id}`)
      } else {
        const r = await api.post('/workspace/files', { kind: 'sheet', template: tpl.id, ...inTeam })
        navigate(`/sheets/${r.item.id}`)
      }
    } catch (e) {
      setError(e.message || '만들지 못했습니다')
      setBusy(false)
    }
  }

  async function rename(file) {
    const title = await promptDialog({ title: '이름 바꾸기', label: '새 이름', defaultValue: file.title, confirmLabel: '바꾸기' })
    if (!title || !title.trim() || title === file.title) return
    try {
      if (kind === 'forms') await api.put(`/admin/forms/${file.id}`, { title_ko: title.trim() })
      else await api.put(`/workspace/files/${file.id}`, { title: title.trim() })
      setFiles((l) => l.map((x) => (x.id === file.id ? { ...x, title: title.trim() } : x)))
    } catch (e) {
      setError(e.message)
    }
  }
  async function remove(file) {
    if (!(await confirmDialog({ title: '휴지통으로 이동', message: `'${file.title}'을(를) 휴지통으로 옮길까요? 30일 동안 보관되며, 그 안에는 휴지통에서 복원할 수 있습니다. 30일이 지나면 영구 삭제됩니다.`, confirmLabel: '휴지통으로 이동' }))) return
    try {
      if (kind === 'forms') await api.del(`/admin/forms/${file.id}`)
      else await api.del(`/workspace/files/${file.id}`)
      setFiles((l) => l.filter((x) => x.id !== file.id))
    } catch (e) {
      setError(e.message)
    }
  }
  const wsIdOf = (file) => (kind === 'forms' ? file.ws_id : file.id)
  async function restore(file) {
    try {
      await api.post(`/workspace/files/${wsIdOf(file)}/restore`)
      setFiles((l) => l.filter((x) => x.id !== file.id))
    } catch (e) {
      setError(e.message)
    }
  }
  async function purge(file) {
    if (!(await confirmDialog({ title: '영구 삭제', message: `'${file.title}'을(를) 영구 삭제할까요? 복원할 수 없습니다.`, confirmLabel: '영구 삭제' }))) return
    try {
      await api.del(`/workspace/files/${wsIdOf(file)}/permanent`)
      setFiles((l) => l.filter((x) => x.id !== file.id))
    } catch (e) {
      setError(e.message)
    }
  }

  // Notion 페이지를 새 문서로 가져온다: 서버가 노션 API로 본문을 HTML로 바꾸고, 정리한 HTML로 문서를 만든다.
  async function importNotion() {
    if (busy) return
    const url = await promptDialog({ title: 'Notion에서 가져오기', label: 'Notion 페이지 주소', placeholder: 'https://www.notion.so/…', confirmLabel: '가져오기' })
    if (!url || !url.trim()) return
    setBusy(true)
    try {
      const page = await api.get('/integrations/notion/page', { url: url.trim() })
      const r = await api.post('/workspace/files/import-html', { html: page.html, title: page.title, ...(team ? { team_id: team.id } : {}) })
      const notes = [page.truncated ? '페이지가 길어 앞부분만 가져왔습니다.' : '', page.notice || ''].filter(Boolean)
      if (notes.length) await alertDialog({ title: '가져왔습니다', message: notes.join('\n') })
      navigate(`/docs/${r.item.first_tab}`)
    } catch (e) {
      setBusy(false)
      if (e.body?.code === 'not_connected') {
        const go = await confirmDialog({ title: '노션이 연결되어 있지 않습니다', message: '연동 페이지에서 노션 내부 연동 토큰을 연결한 뒤 다시 시도하세요.', confirmLabel: '연동으로 이동' })
        if (go) navigate('/workspace/integrations')
        return
      }
      alertDialog({ title: '가져오지 못했습니다', message: e.hint ? `${e.message}\n${e.hint}` : e.message })
    }
  }

  const cardProps = {
    kind, showTeam: !team, onOpen: open, onRename: rename, onDelete: remove, onRestore: restore, onPurge: purge,
    onNewTab: (file) => window.open(urlOf(file), '_blank'),
  }
  const formMenu = (icon) => (kind === 'forms' ? [{ label: '응답 시트 열기', icon, onClick: (file) => navigate(`/form/${file.id}/responses`) }] : [])
  const ownerLabel = owner === 'trash' ? '휴지통' : owner === 'mine' ? '내가 만든 항목' : '모든 항목'

  return (
    <div className="ws">
      <header className="ws-top">
        <button type="button" className="ws-iconbtn ws-iconbtn--lg" aria-label="기본 메뉴" onClick={() => setDrawer('open')}><Menu size={24} /></button>
        <Link to={`${K.path}${spaceQuery}`} className="ws-brand"><Icon size={40} /><span>{K.name}</span></Link>
        <label className="ws-search">
          <Search size={22} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" aria-label="검색" />
          {q && <button type="button" className="ws-iconbtn" aria-label="검색어 지우기" onClick={() => setQ('')}><X size={20} /></button>}
        </label>
        <span className="ws-top__right">
          <WorkspaceToggle light />
          <AccountMenu size={40} />
        </span>
      </header>

      {drawer !== 'closed' && (
        <div className={`ws-drawer-wrap is-${drawer}`} onClick={() => closeDrawer()}>
          <nav className="ws-drawer" onClick={(e) => e.stopPropagation()} aria-label="워크스페이스 메뉴">
            <div className="ws-drawer__head"><button type="button" className="ws-iconbtn ws-iconbtn--lg" aria-label="닫기" onClick={() => closeDrawer()}><X size={24} /></button><strong>디인예 워크스페이스</strong></div>
            {Object.values(KINDS).map((k) => {
              const I = ICONS[k.id]
              return <Link key={k.id} to={`${k.path}${spaceQuery}`} onClick={() => closeDrawer()} className={`ws-drawer__item${k.id === kind ? ' is-on' : ''}`}><I size={24} />{k.name}</Link>
            })}
            {signedIn && (
              <>
                <hr />
                <p className="ws-drawer__label">공간</p>
                <button type="button" className={`ws-drawer__item${!teamParam ? ' is-on' : ''}`} onClick={() => pickSpace(null)}><FolderClosed size={22} />내 파일</button>
                {(teams || []).map((t) => (
                  <button key={t.id} type="button" className={`ws-drawer__item${teamParam === t.id ? ' is-on' : ''}`} onClick={() => pickSpace(t.id)} title={t.name}>
                    <UsersRound size={22} /><span className="ws-drawer__text">{t.name}</span><small>{t.member_count}</small>
                  </button>
                ))}
                <button type="button" className="ws-drawer__item" onClick={createTeam}><Plus size={22} />팀 만들기</button>
                <Link to={team ? `/workspace/members?team=${team.id}` : '/workspace/members'} onClick={() => closeDrawer()} className="ws-drawer__item"><Settings size={22} />팀 관리</Link>
                <Link to="/workspace/integrations" onClick={() => closeDrawer()} className="ws-drawer__item"><Link2 size={22} />연동</Link>
              </>
            )}
          </nav>
        </div>
      )}

      {me && !signedIn && (
        <section className="ws-band ws-signin">
          <div className="ws-wrap">
            <h2>{K.name}에 로그인</h2>
            <p>구글 계정으로 로그인하면 누구나 새 {NOUN[kind]}를 만들고, 팀을 만들어 함께 쓰고, 공유받은 파일을 열 수 있습니다.</p>
            <div className="ws-signin__btns">
              <button type="button" className="gbtn" onClick={() => startGoogleLogin()}><GoogleG size={22} /> 구글 계정으로 로그인</button>
            </div>
          </div>
        </section>
      )}

      {signedIn && (
      <section className="ws-band">
        <div className="ws-wrap">
          <div className="ws-band__head">
            <h2>{K.start}{team && <span className="ws-band__team"><UsersRound size={16} />{team.name}에 만들기</span>}</h2>
            {kind === 'docs' && (
              <span className="ws-owner ws-owner--row">
                <button type="button" className="ws-owner__btn" onClick={importNotion} disabled={busy}><FileDown size={18} />Notion에서 가져오기</button>
                <button ref={hwpBtn} type="button" className="ws-owner__btn" onClick={() => setHwpMenu((v) => !v)}>한글(HWPX) 양식<ChevronDown size={16} /></button>
                {hwpMenu && (
                  <CardMenu anchorRef={hwpBtn} onClose={() => setHwpMenu(false)} items={HWPX_FILES.map((x) => ({ label: x.name, icon: <ExternalLink size={20} />, onClick: () => { const a = document.createElement('a'); a.href = x.href; a.download = `${x.name}.hwpx`; a.click() } }))} />
                )}
              </span>
            )}
          </div>
          {kind === 'hwp' && (
            <input
              ref={hwpInput}
              type="file"
              accept=".hwp,.hwpx,.docx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                uploadHwp(f)
              }}
            />
          )}
          <div className={`ws-tpls ws-tpls--${kind}`}>
            {tplList.map((t) => (
              <button key={t.id} type="button" className="ws-tpl" disabled={busy} onClick={() => createFrom(t)}>
                <span className="ws-tpl__thumb"><TemplateThumb kind={kind} tpl={t} /></span>
                <strong>{t.name}</strong>
                {t.sub && <small>{t.sub}</small>}
              </button>
            ))}
          </div>
        </div>
      </section>
      )}

      <section className="ws-recent">
        <div className="ws-wrap">
          <div className="ws-recent__head">
            <h2 className="ws-recent__title">
              {team ? <><UsersRound size={20} />{team.name}<span>{K.plural}</span></> : K.recent}
            </h2>
            <div className="ws-recent__tools">
              {team && <Link to={`/workspace/members?team=${team.id}`} className="ws-owner__btn ws-teamlink"><Settings size={16} />팀 관리</Link>}
              <div className="ws-owner">
                <button ref={ownerBtn} type="button" className="ws-owner__btn" onClick={() => setOwnerMenu((v) => !v)}>{ownerLabel}<ChevronDown size={16} /></button>
                {ownerMenu && (
                  <CardMenu anchorRef={ownerBtn} align="left" onClose={() => setOwnerMenu(false)} items={[
                    { label: '모든 항목', icon: null, onClick: () => setOwner('all') },
                    { label: '내가 만든 항목', icon: null, onClick: () => setOwner('mine') },
                    ...(signedIn ? [{ label: '휴지통', icon: <Trash2 size={20} />, onClick: () => setOwner('trash') }] : []),
                  ]} />
                )}
              </div>
              <button type="button" className="ws-iconbtn ws-iconbtn--lg" aria-label={view === 'grid' ? '목록 보기' : '격자 보기'} title={view === 'grid' ? '목록 보기' : '격자 보기'} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>{view === 'grid' ? <List size={24} /> : <LayoutGrid size={24} />}</button>
              <button type="button" className={`ws-iconbtn ws-iconbtn--lg${sort === 'name' ? ' is-on' : ''}`} aria-label="정렬 옵션" title={sort === 'name' ? '이름순 (누르면 최근 연 순서)' : '최근 연 순서 (누르면 이름순)'} onClick={() => setSort(sort === 'name' ? 'opened' : 'name')}>{sort === 'name' ? <ArrowDownAZ size={24} /> : <Clock3 size={24} />}</button>
            </div>
          </div>

          {owner === 'trash' && <p className="ws-note">휴지통에 넣은 파일은 30일 동안 보관되며, 그 안에는 복원할 수 있습니다. 30일이 지나면 영구 삭제됩니다.{team ? ' 팀 파일은 만든 사람과 팀 오너가 복원할 수 있습니다.' : ''}</p>}
          {error && <p className="ws-error" role="alert">{error}</p>}
          {loading ? (
            <p className="ws-empty">불러오는 중</p>
          ) : shown.length === 0 ? (
            <div className="ws-empty">
              <p style={{ margin: 0 }}>{q ? '검색 결과가 없습니다.' : owner === 'trash' ? '휴지통이 비어 있습니다.' : team ? `아직 ${team.name} 팀의 ${NOUN[kind]}가 없습니다. 위 템플릿으로 만들면 팀원 모두가 편집할 수 있습니다.` : signedIn ? '아직 항목이 없습니다. 위 템플릿으로 새로 만들거나, 다른 사람이 이메일로 공유하면 여기에 표시됩니다.' : '로그인하면 내 파일과 나에게 공유된 파일이 여기에 표시됩니다.'}</p>
            </div>
          ) : view === 'list' ? (
            <div className="ws-list">
              <div className="ws-row ws-row--head"><span>이름</span><span>소유자</span><span>마지막으로 연 시간</span><span /></div>
              {shown.map((x) => <FileCard key={x.id} file={x} view="list" {...cardProps} extraMenu={formMenu(<Table2 size={20} />)} />)}
            </div>
          ) : (
            <div className={`ws-grid ws-grid--${kind}`}>
              {shown.map((x) => <FileCard key={x.id} file={x} view="grid" {...cardProps} extraMenu={formMenu(<ListChecks size={20} />)} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
