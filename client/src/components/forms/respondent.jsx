// respondent.jsx: 응답자가 보는 접수 화면의 부품. 구글 폼의 응답 화면 구조를 따른다.
//   밝은 바탕 위에 가운데 한 줄(640px) 흰 카드가 쌓이고, 질문 하나가 카드 하나다.
//   제목 카드만 위쪽에 굵은 보라 선이 있고 나머지는 거의 무채색이다.
//   입력은 밑줄 한 줄, 선택은 동그라미(라디오)와 네모(체크)다.
// 색은 .reading-scope(index.css)가 다크 토큰을 읽기 표면 값으로 다시 연결해 주므로 토큰 클래스를 그대로 쓴다.
import { AlertCircle, Check, LogOut } from 'lucide-react'
import GoogleLoginButton from '../auth/GoogleLoginButton'

const CARD = 'rounded-md border border-border-subtle bg-bg-panel'

/** 화면 전체 바탕. 이 안쪽이 모두 밝은 읽기 표면이다 */
export function RespondentPage({ children }) {
  return (
    <div className="reading-scope min-h-[70dvh] w-full bg-bg-base text-text-sec">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-12 px-16 py-24 md:py-40">{children}</div>
    </div>
  )
}

/** 일반 카드 */
export function Card({ as: Tag = 'section', className = '', children }) {
  return <Tag className={`${CARD} p-20 md:p-24 ${className}`.trim()}>{children}</Tag>
}

/** 맨 위 제목 카드. 위쪽 굵은 선만 보라색이다 */
export function HeaderCard({ title, children }) {
  return (
    <header className={`${CARD} overflow-hidden border-t-8 border-t-purple-primary`}>
      <div className="flex min-w-0 flex-col gap-12 p-20 md:p-24">
        <h1 className="min-w-0 break-keep text-h2-m font-bold leading-snug text-text-pri md:text-h2-d">{title}</h1>
        {children}
      </div>
    </header>
  )
}

/** 질문 카드: 제목, 필수 별표, 설명, 입력, 오류 */
export function QuestionCard({ label, required = false, hint, error, children, as: Tag = 'div', ...rest }) {
  return (
    <Tag className={`${CARD} flex min-w-0 flex-col gap-12 p-20 md:p-24 ${error ? '!border-state-error' : ''}`} {...rest}>
      {label && (
        <span className="text-body-m font-medium text-text-pri md:text-body-l-d">
          {label}
          {required && (
            <span className="ml-4 text-state-error" aria-label="필수">
              *
            </span>
          )}
        </span>
      )}
      {hint && <span className="text-small-m text-text-meta">{hint}</span>}
      {children}
      {error && (
        <span role="alert" className="flex items-center gap-8 text-small-m text-state-error">
          <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
          {error}
        </span>
      )}
    </Tag>
  )
}

/** 질문 카드 안의 작은 이름표 + 입력 한 쌍(인적사항처럼 한 카드에 여러 칸이 있을 때) */
export function MiniField({ label, required = false, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-4">
      <span className="text-small-m text-text-meta">
        {label}
        {required && <span className="ml-4 text-state-error">*</span>}
      </span>
      {children}
    </label>
  )
}

// 밑줄 입력. 눌렀을 때 밑줄이 굵어지고 보라색이 된다.
export const underlineCls =
  'w-full min-w-0 rounded-none border-0 border-b border-border-strong bg-transparent px-0 py-8 text-body-m text-text-pri outline-none transition-colors duration-fast ease-out placeholder:text-text-meta focus:border-b-2 focus:border-purple-primary disabled:cursor-not-allowed disabled:text-text-meta aria-[invalid=true]:border-state-error'

export function ShortInput(props) {
  return <input type="text" {...props} className={`${underlineCls} ${props.className || ''}`.trim()} />
}

export function LongInput({ rows = 3, ...props }) {
  return <textarea rows={rows} {...props} className={`${underlineCls} resize-y ${props.className || ''}`.trim()} />
}

/** 라디오: 동그라미 + 글자 한 줄. 카드나 상자 없이 목록으로 둔다 */
export function RadioList({ name, options, value, onChange, disabled = false, invalid = false, ...rest }) {
  return (
    <div role="radiogroup" aria-invalid={invalid || undefined} className="flex flex-col" {...rest}>
      {options.map((opt) => {
        const checked = value === opt.value
        const off = disabled || opt.disabled
        return (
          <label key={opt.value} className={`flex min-h-11 min-w-0 items-start gap-12 py-8 ${off ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
            <input type="radio" name={name} value={opt.value} checked={checked} disabled={off} onChange={() => onChange?.(opt.value)} className="peer sr-only" />
            <span
              aria-hidden="true"
              className={`mt-4 flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-fast ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus peer-focus-visible:ring-offset-2 ${
                checked ? 'border-purple-primary' : 'border-border-strong'
              }`}
            >
              {checked && <span className="h-8 w-8 rounded-full bg-purple-primary" />}
            </span>
            <span className="min-w-0 text-body-m text-text-pri">
              {opt.label}
              {opt.desc && <span className="block text-small-m text-text-meta">{opt.desc}</span>}
            </span>
          </label>
        )
      })}
    </div>
  )
}

/** 체크박스: 네모 + 글자 한 줄 */
export function CheckList({ name, options, value = [], onChange, invalid = false, ...rest }) {
  const selected = Array.isArray(value) ? value : []
  const toggle = (opt) => onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt])
  return (
    <div role="group" aria-invalid={invalid || undefined} className="flex flex-col" {...rest}>
      {options.map((opt) => {
        const checked = selected.includes(opt)
        return (
          <label key={opt} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-12 py-8">
            <input type="checkbox" name={name} value={opt} checked={checked} onChange={() => toggle(opt)} className="peer sr-only" />
            <span
              aria-hidden="true"
              className={`mt-4 flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border-2 transition-colors duration-fast ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus peer-focus-visible:ring-offset-2 ${
                checked ? 'border-purple-primary bg-purple-primary text-text-invert' : 'border-border-strong'
              }`}
            >
              {checked && <Check size={14} />}
            </span>
            <span className="min-w-0 text-body-m text-text-pri">{opt}</span>
          </label>
        )
      })}
    </div>
  )
}

/** 제출 줄. 왼쪽에 제출, 오른쪽에 보조 동작 */
export function SubmitRow({ children, aside }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-16 pt-4">
      <div className="flex flex-wrap items-center gap-12">{children}</div>
      {aside}
    </div>
  )
}

/** 로그인한 계정 한 줄. 구글 폼의 "계정 전환" 자리 */
export function AccountStrip({ user, onLogout }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-12 px-4 text-small-m text-text-meta">
      <span className="min-w-0 truncate">
        {user.name ? `${user.name} (${user.email})` : user.email}
      </span>
      <button type="button" onClick={onLogout} className="inline-flex cursor-pointer items-center gap-8 font-semibold text-text-sec transition-colors duration-fast ease-out hover:text-purple-primary">
        <LogOut size={14} aria-hidden="true" />
        로그아웃
      </button>
    </div>
  )
}

/** 안내용 카드: 접수 마감, 제출 완료 같은 상태 화면 */
export function NoticeCard({ title, children, actions }) {
  return (
    <Card className="flex flex-col gap-16">
      <h2 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">{title}</h2>
      <div className="text-body-m leading-relaxed text-text-sec">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-12">{actions}</div>}
    </Card>
  )
}

/** 구글 로그인 카드 */
export function LoginCard({ title, description, next, children }) {
  return (
    <Card className="flex flex-col gap-16">
      <h2 className="text-body-l-m font-bold text-text-pri md:text-body-l-d">{title}</h2>
      {description && <p className="text-body-m leading-relaxed text-text-sec">{description}</p>}
      <div className="flex flex-wrap items-center gap-16">
        <GoogleLoginButton next={next} />
        {children}
      </div>
    </Card>
  )
}

/** 작은 글씨 링크 버튼 (이전으로, 목록으로) */
export function TextButton({ children, ...rest }) {
  return (
    <button type="button" {...rest} className="cursor-pointer text-small-m font-semibold text-text-sec transition-colors duration-fast ease-out hover:text-purple-primary">
      {children}
    </button>
  )
}

/** 기간 한 줄 요약. 큰 패널 대신 제목 카드 안에 작게 둔다 */
export function ScheduleInline({ rows }) {
  const list = rows.filter((r) => r.value)
  if (!list.length) return null
  return (
    <dl className="flex flex-col gap-4 border-t border-border-subtle pt-12 text-small-m">
      {list.map(({ label, value }) => (
        <div key={label} className="flex flex-wrap items-baseline gap-12">
          <dt className="w-64 shrink-0 text-text-meta">{label}</dt>
          <dd className="min-w-0 font-semibold text-text-pri">{value}</dd>
        </div>
      ))}
    </dl>
  )
}


/** 제출 버튼. 눌러도 되는 때와 아닐 때가 한눈에 구분되게 한다 */
export function PrimarySubmit({ busy = false, disabled = false, children, ...rest }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className="inline-flex h-11 cursor-pointer items-center justify-center rounded-sm bg-button-primary px-24 text-body-m font-semibold text-button-primaryText transition-colors duration-fast ease-out hover:bg-button-primaryHover active:bg-button-primaryPressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:bg-bg-elev disabled:text-text-meta"
      {...rest}
    >
      {children}
    </button>
  )
}

/** 읽기만 되는 값 한 줄 (접수 수정 화면의 참가 유형, 과목, 이메일) */
export function ReadOnlyRow({ label, value }) {
  return (
    <div className="flex flex-wrap items-baseline gap-12 text-small-m">
      <dt className="w-64 shrink-0 text-text-meta">{label}</dt>
      <dd className="min-w-0 break-words font-semibold text-text-pri">{value || '-'}</dd>
    </div>
  )
}
