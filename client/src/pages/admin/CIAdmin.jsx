// CIAdmin.jsx — CI(브랜드 아이덴티티) 단일 문서 편집 (N1-5, 23_PHASE11, admin+)
// codesharing·나노디그리 동일 싱글턴 패턴(id=1, POST가 upsert). body jsonb 계약(data/ci.js):
//   { intro, elements:[{title,text,image}], logoGuide:[{title,image}], colors:[{name,hex}], downloads:[{label,url}] }
// 이미지·다운로드 슬롯은 ImageUpload(업로드 → url). 비워둠 허용. 공개 /about/ci 렌더는 N2.

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
import ImageUpload from '../../components/admin/ImageUpload'
import {
  ErrorText,
  Field,
  GhostButton,
  Input,
  PageHead,
  PrimaryButton,
  TextArea,
} from '../../components/admin/FormControls'

const ICON_BTN =
  'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-sec transition duration-fast ease-out hover:bg-glass-strong hover:text-text-pri focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus md:h-32 md:w-32'

const EMPTY = {
  intro: '',
  symbol: '',
  downloads: [],
  elements: [],
  logoGuide: [],
  signatures: [],
  colors: [],
  motif: '',
}

const asArray = (v) => (Array.isArray(v) ? v : [])

function CIAdmin() {
  useTitle('CI 관리')
  const { data, loading, error, offline, refetch } = useApi('/admin/content/ci')
  const [form, setForm] = useState(EMPTY)
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (hydrated) return
    const item = data?.items?.[0]
    if (!item || !item.body) return
    const b = item.body
    setForm({
      intro: b.intro || '',
      symbol: b.symbol || '',
      downloads: asArray(b.downloads).map((d) => ({ label: d.label || '', url: d.url || '' })),
      elements: asArray(b.elements).map((e) => ({
        title: e.title || '',
        text: e.text || '',
        image: e.image || '',
      })),
      logoGuide: asArray(b.logoGuide).map((g) => ({
        title: g.title || '',
        image: g.image || '',
      })),
      signatures: asArray(b.signatures).map((s) => ({
        title: s.title || '',
        image: s.image || '',
      })),
      colors: asArray(b.colors).map((c) => ({ name: c.name || '', hex: c.hex || '' })),
      motif: b.motif || '',
    })
    setHydrated(true)
  }, [hydrated, data])

  const set = (key) => (v) => {
    setSaved(false)
    setForm((prev) => ({ ...prev, [key]: v }))
  }
  const setRow = (key, i, patch) =>
    set(key)(form[key].map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
  const addRow = (key, blank) => set(key)([...form[key], blank])
  const removeRow = (key, i) => set(key)(form[key].filter((_, idx) => idx !== i))

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setSaveError(null)
    try {
      // 싱글턴 upsert — POST /admin/content/ci (id=1 고정). 빈 슬롯(image/url)은 null로 정규화.
      await api.post('/admin/content/ci', {
        body: {
          intro: form.intro,
          symbol: form.symbol || null,
          downloads: form.downloads
            .filter((d) => (d.label || '').trim() !== '')
            .map((d) => ({ label: d.label, url: d.url || null })),
          elements: form.elements
            .filter((e) => (e.title || '').trim() !== '')
            .map((e) => ({ title: e.title, text: e.text, image: e.image || null })),
          logoGuide: form.logoGuide
            .filter((g) => (g.title || '').trim() !== '')
            .map((g) => ({ title: g.title, image: g.image || null })),
          signatures: form.signatures
            .filter((s) => (s.title || '').trim() !== '')
            .map((s) => ({ title: s.title, image: s.image || null })),
          colors: form.colors.filter((c) => (c.name || '').trim() !== '' || (c.hex || '').trim() !== ''),
          motif: form.motif || null,
        },
      })
      setSaved(true)
    } catch (err) {
      setSaveError(err.hint ? `${err.message} (${err.hint})` : err.message)
    } finally {
      setBusy(false)
    }
  }

  const bodyEmpty = !loading && !error && !data?.items?.[0]?.body

  return (
    <section className="flex flex-col gap-24">
      <PageHead
        title="CI"
        desc="단일 문서입니다. 소개·심벌·다운로드·구성요소·로고가이드·시그니처·전용색상·그래픽모티브를 관리합니다."
        offline={offline}
      />

      {/* 기존 문서가 채워진 뒤에만 폼 렌더 — 빈 폼으로 덮어쓰기 방지 (Nanodegree 패턴) */}
      {!hydrated ? (
        <div className="flex flex-col items-start gap-16">
          {loading && (
            <p className="font-mono text-caption-m text-text-meta">기존 내용을 불러오는 중</p>
          )}
          {error && (
            <>
              <ErrorText>{error.message}</ErrorText>
              <GhostButton onClick={refetch}>다시 불러오기</GhostButton>
            </>
          )}
          {bodyEmpty && (
            <p className="font-mono text-caption-m text-text-meta">
              문서가 아직 없습니다. 저장하면 새 문서가 생성됩니다.
            </p>
          )}
        </div>
      ) : null}

      {(hydrated || bodyEmpty) && (
        <form onSubmit={save} className="flex flex-col gap-24">
          <Field label="소개" hint="CI의 의미">
            <TextArea rows={4} value={form.intro} onChange={(e) => set('intro')(e.target.value)} />
          </Field>

          {/* 대표 심벌 — CI 의미 섹션 대표 이미지 */}
          <Field label="대표 심벌" hint="CI 의미 섹션 대표 이미지">
            <ImageUpload value={form.symbol} onChange={set('symbol')} usage="general" />
          </Field>

          {/* 구성요소 — 곡선·컬러·워드마크. 제목 + 설명 + 이미지 */}
          <Field label={`구성요소 (${form.elements.length})`}>
            <div className="flex flex-col gap-16">
              {form.elements.map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-8 rounded-md border border-border-subtle p-16"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-8">
                    <Input
                      value={row.title}
                      onChange={(e) => setRow('elements', i, { title: e.target.value })}
                      placeholder="제목 (예: 심벌)"
                      aria-label={`구성요소 ${i + 1} 제목`}
                    />
                    <TextArea
                      rows={2}
                      value={row.text}
                      onChange={(e) => setRow('elements', i, { text: e.target.value })}
                      placeholder="설명"
                      aria-label={`구성요소 ${i + 1} 설명`}
                    />
                    <ImageUpload
                      value={row.image}
                      onChange={(v) => setRow('elements', i, { image: v })}
                      usage="general"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow('elements', i)}
                    aria-label={`구성요소 ${i + 1} 제거`}
                    className={ICON_BTN}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div>
                <GhostButton onClick={() => addRow('elements', { title: '', text: '', image: '' })}>
                  <Plus size={16} aria-hidden="true" />
                  구성요소 추가
                </GhostButton>
              </div>
            </div>
          </Field>

          {/* 로고가이드 — 국문/영문/시그니처 로고. 제목 + 이미지 */}
          <Field label={`로고가이드 (${form.logoGuide.length})`}>
            <div className="flex flex-col gap-16">
              {form.logoGuide.map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-8 rounded-md border border-border-subtle p-16"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-8">
                    <Input
                      value={row.title}
                      onChange={(e) => setRow('logoGuide', i, { title: e.target.value })}
                      placeholder="제목 (예: 국문 로고)"
                      aria-label={`로고가이드 ${i + 1} 제목`}
                    />
                    <ImageUpload
                      value={row.image}
                      onChange={(v) => setRow('logoGuide', i, { image: v })}
                      usage="general"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow('logoGuide', i)}
                    aria-label={`로고가이드 ${i + 1} 제거`}
                    className={ICON_BTN}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div>
                <GhostButton onClick={() => addRow('logoGuide', { title: '', image: '' })}>
                  <Plus size={16} aria-hidden="true" />
                  로고가이드 추가
                </GhostButton>
              </div>
            </div>
          </Field>

          {/* 시그니처 — 상하조합형 / 좌우조합형. 제목 + 이미지 */}
          <Field label={`시그니처 (${form.signatures.length})`}>
            <div className="flex flex-col gap-16">
              {form.signatures.map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-8 rounded-md border border-border-subtle p-16"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-8">
                    <Input
                      value={row.title}
                      onChange={(e) => setRow('signatures', i, { title: e.target.value })}
                      placeholder="제목 (예: 상하조합형)"
                      aria-label={`시그니처 ${i + 1} 제목`}
                    />
                    <ImageUpload
                      value={row.image}
                      onChange={(v) => setRow('signatures', i, { image: v })}
                      usage="general"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow('signatures', i)}
                    aria-label={`시그니처 ${i + 1} 제거`}
                    className={ICON_BTN}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div>
                <GhostButton onClick={() => addRow('signatures', { title: '', image: '' })}>
                  <Plus size={16} aria-hidden="true" />
                  시그니처 추가
                </GhostButton>
              </div>
            </div>
          </Field>

          {/* 전용색상 — 색상명 + HEX (색상 선택기로 값 지정) */}
          <Field label={`전용색상 (${form.colors.length})`}>
            <div className="flex flex-col gap-8">
              {form.colors.map((row, i) => (
                <div key={i} className="flex items-center gap-8">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(row.hex) ? row.hex : '#100D18'}
                    onChange={(e) => setRow('colors', i, { hex: e.target.value })}
                    aria-label={`색상 ${i + 1} 선택`}
                    className="h-32 w-40 shrink-0 cursor-pointer rounded-sm border border-border-subtle bg-transparent"
                  />
                  <Input
                    value={row.name}
                    onChange={(e) => setRow('colors', i, { name: e.target.value })}
                    placeholder="색상명"
                    aria-label={`색상 ${i + 1} 이름`}
                  />
                  <Input
                    value={row.hex}
                    onChange={(e) => setRow('colors', i, { hex: e.target.value })}
                    placeholder="#RRGGBB"
                    aria-label={`색상 ${i + 1} HEX`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow('colors', i)}
                    aria-label={`색상 ${i + 1} 제거`}
                    className={ICON_BTN}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div>
                <GhostButton onClick={() => addRow('colors', { name: '', hex: '' })}>
                  <Plus size={16} aria-hidden="true" />
                  색상 추가
                </GhostButton>
              </div>
            </div>
          </Field>

          {/* 다운로드 — 라벨 + 파일(매뉴얼·JPG·AI 등) */}
          <Field label={`다운로드 (${form.downloads.length})`}>
            <div className="flex flex-col gap-16">
              {form.downloads.map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-8 rounded-md border border-border-subtle p-16"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-8">
                    <Input
                      value={row.label}
                      onChange={(e) => setRow('downloads', i, { label: e.target.value })}
                      placeholder="라벨 (예: CI 매뉴얼)"
                      aria-label={`다운로드 ${i + 1} 라벨`}
                    />
                    <ImageUpload
                      value={row.url}
                      onChange={(v) => setRow('downloads', i, { url: v })}
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.ai,.eps,.zip"
                      preview={false}
                      buttonLabel="파일 업로드"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow('downloads', i)}
                    aria-label={`다운로드 ${i + 1} 제거`}
                    className={ICON_BTN}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div>
                <GhostButton onClick={() => addRow('downloads', { label: '', url: '' })}>
                  <Plus size={16} aria-hidden="true" />
                  다운로드 추가
                </GhostButton>
              </div>
            </div>
          </Field>

          {/* 그래픽모티브 — 단일 이미지 */}
          <Field label="그래픽모티브" hint="그래픽모티브 이미지">
            <ImageUpload value={form.motif} onChange={set('motif')} usage="general" />
          </Field>

          <ErrorText>{saveError}</ErrorText>
          {saved && <p className="font-mono text-caption-m text-text-meta">저장 완료</p>}
          <div>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? '저장 중' : '저장'}
            </PrimaryButton>
          </div>
        </form>
      )}
    </section>
  )
}

export default CIAdmin
