import { useState } from 'react'
import { Search } from 'lucide-react'
import { useLang } from '../../i18n/LangContext'

// KPC 게시판 문법(11_DESIGN_V2 1절) — 검색 입력.
// 제출 시 onSearch(q)만 호출한다. 데이터 요청은 페이지가 소유.
function SearchBar({ value = '', onSearch, placeholder }) {
  const { t } = useLang()
  const [q, setQ] = useState(value)

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        onSearch(q.trim())
      }}
      className="flex min-h-11 w-full min-w-0 items-center gap-8 rounded-sm border border-border-subtle bg-bg-panel px-8 transition-colors duration-fast ease-out focus-within:border-border-strong md:w-auto md:px-12"
    >
      <input
        type="search"
        value={q}
        size={18}
        onChange={(event) => setQ(event.target.value)}
        placeholder={placeholder || t('news.searchPlaceholder')}
        aria-label={t('aria.searchQuery')}
        className="min-h-11 w-full min-w-0 bg-transparent px-8 font-sans text-small-m text-text-pri placeholder:text-text-meta focus:outline-none md:w-auto md:text-small-d"
      />
      <button
        type="submit"
        aria-label={t('aria.search')}
        disabled={!q.trim()}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-meta transition-colors duration-fast ease-out hover:bg-glass-strong hover:text-text-pri disabled:cursor-not-allowed disabled:text-text-disabled"
      >
        <Search size={16} aria-hidden="true" />
      </button>
    </form>
  )
}

export default SearchBar
