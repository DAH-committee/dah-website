// FormControls.jsx — 어드민 공용 폼·리스트 프리미티브 (13_CMS_SPEC 6절)
// 어드민도 동일 디자인 시스템(우주+글래스). 별도 관리자 테마 금지.

import CommonSelect from '../common/Select'
import CommonDatePicker from '../common/DatePicker'
import StateMessage from '../common/StateMessage'

const INPUT =
  'w-full rounded-md border border-border-subtle bg-bg-panel px-16 py-12 text-body-m text-text-pri outline-none transition duration-fast ease-out placeholder:text-text-meta enabled:hover:border-border-strong focus:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-bg-elev disabled:text-text-disabled disabled:placeholder:text-text-disabled read-only:cursor-default read-only:bg-bg-elev read-only:text-text-meta aria-[invalid=true]:border-state-error'

const BUTTON_BASE =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm px-24 text-body-m font-semibold transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40'

/** 페이지 상단 — 제목(명사형) + 액션 + 오프라인 배지 */
export function PageHead({ title, desc, actions, offline = false }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-16 border-b border-border-subtle pb-24">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-wrap items-center gap-12">
          <h2 className="text-h2-m font-bold text-text-pri md:text-h2-d">{title}</h2>
          <OfflineBadge show={offline} />
        </div>
        {desc && <p className="text-body-m text-text-sec md:text-body-d">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-8">{actions}</div>}
    </div>
  )
}

/** 폴백 렌더 표시 — "실시간 동기화 대기 중" 미세 배지 (12_BACKEND 7절) */
export function OfflineBadge({ show = false }) {
  if (!show) return null
  return (
    <span className="inline-flex items-center rounded-sm border border-glass-line bg-glass-bg px-12 py-4 font-mono text-caption-m text-text-meta">
      실시간 동기화 대기 중
    </span>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-8">
      <span className="font-mono text-label-m uppercase tracking-label text-text-meta">
        {label}
      </span>
      {children}
      {hint && <span className="text-small-m text-text-meta">{hint}</span>}
    </label>
  )
}

export function Input(props) {
  return <input {...props} className={`${INPUT} ${props.className || ''}`.trim()} />
}

export function TextArea({ rows = 4, ...props }) {
  return (
    <textarea
      rows={rows}
      {...props}
      className={`${INPUT} resize-y ${props.className || ''}`.trim()}
    />
  )
}

// X5(33_PHASE18): 네이티브 <select> 폐기 → 공용 커스텀 드롭다운으로 위임.
// 호출부 계약 유지를 위해 기존 시그니처(value/onChange 이벤트 형태)를 그대로 흡수한다 —
// 어드민 호출부들은 e.target.value를 읽으므로 합성 이벤트 형태로 되돌려준다.
export function Select({ options = [], value, onChange, ...props }) {
  return (
    <CommonSelect
      options={options}
      value={value}
      onChange={(v) => onChange?.({ target: { value: v } })}
      {...props}
    />
  )
}

// X5(33_PHASE18): 네이티브 <input type="date"|"datetime-local"> 폐기 → 공용 캘린더로 위임.
// 값 문자열 계약이 네이티브와 같아('YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm') 저장 로직은 무변경.
// 호출부가 e.target.value를 읽으므로 합성 이벤트 형태로 되돌려준다.
export function DateInput({ value, onChange, withTime = false, ...props }) {
  return (
    <CommonDatePicker
      value={value}
      withTime={withTime}
      onChange={(v) => onChange?.({ target: { value: v } })}
      {...props}
    />
  )
}

/** 스위치 — published 토글 등 */
export function Toggle({ checked = false, onChange, label, disabled = false, tone = 'default' }) {
  const light = tone === 'light'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange && onChange(!checked)}
      // 모바일 조작 상자는 44px, 실제 트랙은 40×24로 유지해 시각 밀도와 터치 정확도를 분리한다.
      className="relative inline-flex h-[44px] w-[52px] shrink-0 cursor-pointer items-center justify-center rounded-full transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className={`relative h-[26px] w-[44px] rounded-full border-2 transition duration-fast ease-out ${
          checked
            ? (light ? 'border-[#6246c7] bg-[#7457dc]' : 'border-purple-primary bg-purple-primary')
            : (light ? 'border-[#827993] bg-[#eeebf3]' : 'border-border-strong bg-transparent')
        }`}
      >
        <span
          className={`absolute left-[3px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full shadow-sm transition duration-fast ease-out ${
            checked ? 'translate-x-[18px] bg-white' : (light ? 'translate-x-0 bg-[#655d73]' : 'translate-x-0 bg-text-meta')
          }`}
        />
      </span>
    </button>
  )
}

export function PrimaryButton({ children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      {...rest}
      className={`${BUTTON_BASE} bg-button-primary text-button-primaryText hover:bg-button-primaryHover active:bg-button-primaryPressed disabled:bg-bg-panel disabled:text-text-disabled disabled:shadow-none ${rest.className || ''}`.trim()}
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      {...rest}
      className={`${BUTTON_BASE} border border-border-subtle bg-transparent text-text-pri hover:border-border-strong disabled:border-border-subtle disabled:text-text-disabled ${rest.className || ''}`.trim()}
    >
      {children}
    </button>
  )
}

export function ErrorText({ children }) {
  if (!children) return null
  return <p className="text-small-m text-state-error">{children}</p>
}

/** 빈 상태 — P6: mono caption 1줄 + 여백 */
export function EmptyNote({ children = '등록된 항목이 없습니다' }) {
  return <StateMessage state="empty">{children}</StateMessage>
}

/** KPC 게시판 문법 페이지네이션 — mono 숫자 */
export function Pagination({ page = 1, pageSize = 10, total = 0, onPage }) {
  const totalPages = Math.max(1, Math.ceil(total / (pageSize || 10)))
  if (totalPages <= 1) return null
  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
  const nums = []
  for (let n = start; n <= Math.min(totalPages, start + 4); n += 1) nums.push(n)

  const btn = (active) =>
    `flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm font-mono text-small-m transition duration-fast ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 md:h-32 md:w-32 ${
      active ? 'bg-glass-strong text-text-pri' : 'text-text-sec hover:text-text-pri'
    }`

  return (
    <nav aria-label="페이지" className="flex items-center justify-center gap-4 pt-24">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        aria-label="이전 페이지"
        className={btn(false)}
      >
        {'<'}
      </button>
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPage(n)}
          aria-current={n === page ? 'page' : undefined}
          className={btn(n === page)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        aria-label="다음 페이지"
        className={btn(false)}
      >
        {'>'}
      </button>
    </nav>
  )
}
