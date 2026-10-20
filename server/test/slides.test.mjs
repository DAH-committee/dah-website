// test/slides.test.mjs: DAH Slides 내용 읽기·저장 API와 템플릿 (DB는 mock 주입)
process.env.JWT_SECRET = 'test-secret'
process.env.NODE_ENV = 'test'
delete process.env.DATABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { validateSlides, MAX_SLIDES } from '../src/routes/slides.js'
import { SLIDE_TEMPLATES, SLIDE_TEMPLATE_META, outlineToSlides, applyLayout } from '../src/lib/slideTemplates.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const OWNER = { id: 1, email: 'o@example.com', name: '소유자', role: 'manager' }
const OTHER = { id: 9, email: 'v@example.com', name: '보기', role: 'manager' }
const cookie = (u) => `dah_access=${jwt.sign({ sub: u.id, email: u.email, name: u.name, role: u.role, type: 'access' }, 'test-secret', { expiresIn: '15m' })}`
const fileOf = (over = {}) => ({ id: 7, kind: 'slide', title: '발표', created_by: null, owner_email: OWNER.email, general_access: 'restricted', general_role: 'viewer', share_token: 't', gated: false, form_id: null, last_edit: null, hidden: false, owner_only: false, deleted_at: null, ...over })

function mockApp(file, onUpdate, shareRole = null, stored = { version: 1, slides: [] }) {
  return createApp({
    db: {
      query: async (text, params) => {
        if (text.startsWith('SELECT id, title, content, updated_at FROM ws_files')) return { rows: [{ id: 7, title: '발표', content: stored, updated_at: 'now' }] }
        if (text.startsWith('SELECT') && text.includes('FROM ws_files WHERE id = $1')) return { rows: file ? [file] : [] }
        if (text.startsWith('SELECT role FROM ws_shares')) return { rows: shareRole ? [{ role: shareRole }] : [] }
        if (text.startsWith('UPDATE ws_files SET content')) {
          onUpdate?.(JSON.parse(params[0]))
          return { rows: [{ id: 7, updated_at: 'now' }] }
        }
        return { rows: [] }
      },
    },
  })
}

const deck = () => SLIDE_TEMPLATES.pitch()

test('템플릿: 목록의 모든 id가 올바른 발표를 만든다', () => {
  assert.ok(SLIDE_TEMPLATE_META.length >= 7)
  for (const m of SLIDE_TEMPLATE_META) {
    assert.equal(typeof SLIDE_TEMPLATES[m.id], 'function', m.id)
    const c = SLIDE_TEMPLATES[m.id]()
    assert.equal(validateSlides(c), null, m.id)
    assert.ok(c.slides.length >= 1)
    assert.ok(c.theme?.colors?.accent)
  }
})

test('템플릿 파일: 서버 사본과 화면 사본이 같다', () => {
  const a = fs.readFileSync(path.join(here, '../src/lib/slideTemplates.js'), 'utf8')
  const b = fs.readFileSync(path.join(here, '../../client/src/pages/slides/deckCore.js'), 'utf8')
  assert.equal(a, b)
})

test('글로 만들기: 제목, 섹션, 목록 나누기, 큰 숫자, 이미지', () => {
  const s = outlineToSlides(['# 발표', '부제', '## 문제', ...Array.from({ length: 10 }, (_, i) => `- 항목 ${i}`), '## 72%', '설명', '# 둘째', '## 그림', 'https://example.com/a.png'].join('\n'))
  assert.deepEqual(s.map((x) => x.layout), ['title', 'title-body', 'title-body', 'big-number', 'section', 'image-text'])
  assert.equal(validateSlides({ version: 1, slides: s }), null)
  const moved = applyLayout(s[1], 'two-col', 0)
  assert.ok(moved.elements.some((e) => e.role === 'col1' && e.data.html.includes('항목 0')))
})

test('validateSlides: 틀린 모양은 거절', () => {
  assert.equal(validateSlides(deck()), null)
  assert.ok(validateSlides(null))
  assert.ok(validateSlides({ version: 2, slides: [] }))
  assert.ok(validateSlides({ version: 1, slides: {} }))
  const bad = deck()
  bad.slides[0].elements[0].type = 'script'
  assert.ok(validateSlides(bad))
  const dup = deck()
  dup.slides[1].id = dup.slides[0].id
  assert.ok(validateSlides(dup))
  const nan = deck()
  nan.slides[0].elements[0].x = 'a'
  assert.ok(validateSlides(nan))
  const tr = deck()
  tr.slides[0].transition = 'spin'
  assert.ok(validateSlides(tr))
  assert.match(validateSlides({ version: 1, slides: Array.from({ length: MAX_SLIDES + 1 }, (_, i) => ({ id: 's' + i, elements: [] })) }), /too many/)
})

test('GET: 소유자는 편집 가능, 다른 종류 파일은 404, 권한 없으면 403', async () => {
  let r = await request(mockApp(fileOf())).get('/workspace/slides/7').set('Cookie', cookie(OWNER))
  assert.equal(r.status, 200)
  assert.equal(r.body.canEdit, true)
  assert.deepEqual(r.body.item.content, { version: 1, slides: [] })
  r = await request(mockApp(fileOf({ kind: 'board' }))).get('/workspace/slides/7').set('Cookie', cookie(OWNER))
  assert.equal(r.status, 404)
  r = await request(mockApp(fileOf())).get('/workspace/slides/7').set('Cookie', cookie(OTHER))
  assert.equal(r.status, 403)
  r = await request(mockApp(fileOf(), null, 'viewer')).get('/workspace/slides/7').set('Cookie', cookie(OTHER))
  assert.equal(r.status, 200)
  assert.equal(r.body.canEdit, false)
})

test('PUT: 편집자만 저장, 모양 검사', async () => {
  let saved = null
  const app = mockApp(fileOf(), (c) => (saved = c))
  let r = await request(app).put('/workspace/slides/7').set('Cookie', cookie(OWNER)).send({ content: deck() })
  assert.equal(r.status, 200)
  assert.equal(saved.slides.length, deck().slides.length)
  r = await request(app).put('/workspace/slides/7').set('Cookie', cookie(OWNER)).send({ content: { version: 1 } })
  assert.equal(r.status, 400)
  r = await request(mockApp(fileOf(), null, 'viewer')).put('/workspace/slides/7').set('Cookie', cookie(OTHER)).send({ content: deck() })
  assert.equal(r.status, 403)
})

test('템플릿: 모든 템플릿은 흰 바탕, 첫 슬라이드는 배경색을 따로 두지 않는다(허브 미리보기도 흰색)', () => {
  for (const m of SLIDE_TEMPLATE_META) {
    const c = SLIDE_TEMPLATES[m.id]()
    assert.equal(c.theme.colors.bg.toUpperCase(), '#FFFFFF', m.id)
    for (const s of c.slides) {
      const bg = s.background?.color
      assert.ok(!bg || bg === '@bg', `${m.id}: 슬라이드 배경 ${bg}`)
    }
  }
})

test('validateSlides: 매직 무브, mid·name·hidden, stacks, 새 style 키를 받는다', () => {
  const c = deck()
  c.slides[1].transition = 'magic'
  c.slides[1].stacks = { g1: { dir: 'column', gap: 16, pad: 8, align: 'center', frame: 'bg-shape' } }
  const el = c.slides[1].elements[0]
  Object.assign(el, { mid: 'hero', name: '제목 상자', hidden: true })
  el.style = { ...el.style, fillType: 'gradient', gradient: { from: '#7A3CFF', to: '@bg', angle: 45 }, shadow: { x: 0, y: 8, blur: 24, color: '#00000040' }, strokeStyle: 'dashed', mask: 'circle', tracking: 0.02, sizing: 'auto-h' }
  assert.equal(validateSlides(c), null)
  const bad = (fn) => {
    const d = structuredClone(c)
    fn(d)
    return validateSlides(d)
  }
  assert.ok(bad((d) => (d.slides[1].elements[0].mid = 5)))
  assert.ok(bad((d) => (d.slides[1].elements[0].mid = 'x'.repeat(65))))
  assert.ok(bad((d) => (d.slides[1].elements[0].name = 'x'.repeat(81))))
  assert.ok(bad((d) => (d.slides[1].elements[0].hidden = 'yes')))
  assert.ok(bad((d) => (d.slides[1].stacks = [])))
  assert.ok(bad((d) => (d.slides[1].stacks = { g: { dir: 'diagonal' } })))
  assert.ok(bad((d) => (d.slides[1].stacks = { g: { frame: 7 } })))
  assert.ok(bad((d) => (d.slides[1].stacks = Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['g' + i, {}])))))
})

test('PUT: 매직 무브와 새 필드가 그대로 저장된다', async () => {
  let saved = null
  const c = deck()
  c.slides[2].transition = 'magic'
  c.slides[2].stacks = { g1: { dir: 'row', gap: 24, pad: 0, align: 'start', frame: 'f1' } }
  Object.assign(c.slides[2].elements[0], { mid: 'm1', name: '이름', hidden: false })
  const r = await request(mockApp(fileOf(), (x) => (saved = x))).put('/workspace/slides/7').set('Cookie', cookie(OWNER)).send({ content: c })
  assert.equal(r.status, 200)
  assert.equal(saved.slides[2].transition, 'magic')
  assert.deepEqual(saved.slides[2].stacks, c.slides[2].stacks)
  assert.equal(saved.slides[2].elements[0].mid, 'm1')
  assert.equal(saved.slides[2].elements[0].name, '이름')
})
