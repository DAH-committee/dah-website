// NanodegreeAdmin.jsx — 나노디그리 단일 문서 편집 (Phase 9 K1-10, admin+)
// codesharing과 동일 싱글턴 패턴(id=1, POST가 upsert). body jsonb:
// { intro: string, cert: string, programs: [{ name, courses, partner, rule, note? }] } — K2 공개 페이지 계약

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApi, api } from '../../hooks/useApi'
import { useTitle } from '../../hooks/useTitle'
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

const PROGRAM_KEYS = [
  { key: 'name', label: '과정명' },
  { key: 'criteria', label: '이수기준' },
  { key: 'partner', label: '유관 기관' },
  { key: 'completion', label: '이수 규칙' },
]

const COURSE_KEYS = [
  { key: 'code', label: '과목번호' },
  { key: 'name', label: '교과목명' },
  { key: 'credit', label: '학점' },
]

const EMPTY = { intro: '', cert: '', programs: [] }

function NanodegreeAdmin() {
  useTitle('나노디그리 관리')
  const { data, loading, error, offline, refetch } = useApi('/admin/content/nanodegree')
  const [form, setForm] = useState(EMPTY)
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (hydrated) return
    const item = data?.items?.[0]
    if (!item || !item.body) return
    setForm({
      intro: item.body.intro || '',
      cert: item.body.cert || '',
      // 신규 shape {name, criteria, partner, completion, courses:[{code,name,credit}]}로 정규화.
      // 구 shape(courses 문자열·rule·note)는 courses 배열 없음 → 빈 행으로 관대하게 시작.
      programs: Array.isArray(item.body.programs)
        ? item.body.programs.map((p) => ({
            name: p.name || '',
            criteria: p.criteria || '',
            partner: p.partner || '',
            completion: p.completion || '',
            courses: Array.isArray(p.courses)
              ? p.courses.map((c) => ({
                  code: c.code || '',
                  name: c.name || '',
                  credit: c.credit || '',
                }))
              : [],
          }))
        : [],
    })
    setHydrated(true)
  }, [hydrated, data])

  const set = (key) => (v) => {
    setSaved(false)
    setForm((prev) => ({ ...prev, [key]: v }))
  }

  const setProgram = (i, key, v) => {
    set('programs')(form.programs.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)))
  }

  const mapCourses = (pi, fn) => {
    set('programs')(
      form.programs.map((p, idx) => (idx === pi ? { ...p, courses: fn(p.courses) } : p)),
    )
  }
  const setCourse = (pi, ci, key, v) =>
    mapCourses(pi, (courses) => courses.map((c, cdx) => (cdx === ci ? { ...c, [key]: v } : c)))
  const addCourse = (pi) => mapCourses(pi, (courses) => [...courses, { code: '', name: '', credit: '' }])
  const removeCourse = (pi, ci) => mapCourses(pi, (courses) => courses.filter((_, cdx) => cdx !== ci))

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setSaveError(null)
    try {
      // 싱글턴 upsert — POST /admin/content/nanodegree (id=1 고정)
      await api.post('/admin/content/nanodegree', {
        body: {
          intro: form.intro,
          cert: form.cert,
          programs: form.programs
            .filter((p) => (p.name || '').trim() !== '')
            .map((p) => ({
              name: p.name,
              criteria: p.criteria,
              partner: p.partner,
              completion: p.completion,
              courses: p.courses.filter((c) =>
                COURSE_KEYS.some((k) => (c[k.key] || '').trim() !== ''),
              ),
            })),
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
        title="나노디그리"
        desc="단일 문서입니다. 소개·인증 안내와 프로그램 목록을 관리합니다."
        offline={offline}
      />

      {/* 기존 문서가 채워진 뒤에만 폼 렌더 — 빈 폼으로 덮어쓰기 방지 (CodeSharingAdmin 패턴) */}
      {!hydrated ? (
        <div className="flex flex-col items-start gap-16">
          {loading && (
            <p className="font-mono text-caption-m text-text-meta">
              기존 내용을 불러오는 중
            </p>
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
        <Field label="소개">
          <TextArea rows={4} value={form.intro} onChange={(e) => set('intro')(e.target.value)} />
        </Field>
        <Field label="인증 안내">
          <Input value={form.cert} onChange={(e) => set('cert')(e.target.value)} />
        </Field>

        <Field label={`프로그램 (${form.programs.length})`}>
          <div className="flex flex-col gap-16">
            {form.programs.map((row, i) => (
              <div
                key={i}
                className="flex flex-col gap-12 rounded-md border border-border-subtle p-16"
              >
                <div className="flex items-start gap-8">
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-8 md:grid-cols-2">
                    {PROGRAM_KEYS.map((k) => (
                      <Input
                        key={k.key}
                        value={row[k.key] || ''}
                        onChange={(e) => setProgram(i, k.key, e.target.value)}
                        placeholder={k.label}
                        aria-label={`과정 ${i + 1} ${k.label}`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => set('programs')(form.programs.filter((_, idx) => idx !== i))}
                    aria-label={`과정 ${i + 1} 제거`}
                    className={ICON_BTN}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* 인정 교과목 표 — 과목번호/교과목명/학점 행 리피터 */}
                <div className="flex flex-col gap-8 border-t border-border-subtle pt-12">
                  {row.courses.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-8">
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-8 md:grid-cols-3">
                        {COURSE_KEYS.map((k) => (
                          <Input
                            key={k.key}
                            value={c[k.key] || ''}
                            onChange={(e) => setCourse(i, ci, k.key, e.target.value)}
                            placeholder={k.label}
                            aria-label={`과정 ${i + 1} 과목 ${ci + 1} ${k.label}`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCourse(i, ci)}
                        aria-label={`과정 ${i + 1} 과목 ${ci + 1} 제거`}
                        className={ICON_BTN}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <div>
                    <GhostButton onClick={() => addCourse(i)}>
                      <Plus size={16} aria-hidden="true" />
                      과목 추가
                    </GhostButton>
                  </div>
                </div>
              </div>
            ))}
            <div>
              <GhostButton
                onClick={() =>
                  set('programs')([
                    ...form.programs,
                    { name: '', criteria: '', partner: '', completion: '', courses: [] },
                  ])
                }
              >
                <Plus size={16} aria-hidden="true" />
                과정 추가
              </GhostButton>
            </div>
          </div>
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

export default NanodegreeAdmin
