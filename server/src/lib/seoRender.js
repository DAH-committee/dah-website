// src/lib/seoRender.js — 검색·공유 크롤러에게 주는 "내용이 담긴 HTML"
//
// 문제: 사이트는 브라우저에서 화면을 그리는 SPA라서, 자바스크립트를 실행하지 않는 크롤러(네이버 Yeti, 카카오톡·페이스북
// 미리보기, 일부 Bing 단계)는 모든 주소에서 똑같은 빈 껍데기 HTML과 메인 페이지 제목만 받는다.
//
// 해결: Vercel이 크롤러 User-Agent일 때만 이 서버의 /seo/page로 넘긴다(client/vercel.json). 여기서는
//   1) 배포된 index.html(해시된 스크립트 경로 포함)을 받아 와서
//   2) 경로별 제목·설명·canonical·Open Graph·JSON-LD로 바꾸고
//   3) #root 안에 실제 본문(사람이 보는 화면과 같은 내용)을 넣어 돌려준다.
// 브라우저가 이 HTML을 받아도 #root는 React가 다시 그리므로 사용자 화면은 달라지지 않는다.
//
// 내용 출처: 관리자 화면에서 고치는 글(전시, 공모전, 특강, 공지, 자료, 동아리, 교수진, 교육과정, 운영위원회, 학생 성과, 진로 등)은
// 전부 DB에서 읽어 항상 최신이다. 코드에 본문이 들어 있는 페이지(메인, 전공소개 연혁, CI, 개인정보, 약관)만
// server/src/data/seoStatic.json(화면에서 뽑은 본문)을 쓴다. 그 페이지의 글을 코드에서 바꿨을 때만 스냅샷을 다시 만든다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getTypeConfig } from '../content-config.js'
import { runList, runGetOne } from '../routes/content.js'
import { query } from '../db.js'
import { normalizeVisibility } from '../routes/settings.js'
import { NAV } from './seoNav.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const SITE_URL = (process.env.SEO_SITE_URL || 'https://dah-hallym.vercel.app').replace(/\/+$/, '')
const SITE_NAME = '한림대학교 디지털인문예술전공'

let STATIC = {}
try {
  STATIC = JSON.parse(readFileSync(join(__dirname, '../data/seoStatic.json'), 'utf8'))
} catch {
  STATIC = {}
}

// 목록 경로 → 콘텐츠 유형
const SECTIONS = {
  '/programs/exhibitions': { type: 'exhibitions', label: '프로젝트 전시회', h1: '프로젝트 전시회' },
  '/programs/contests': { type: 'contest', label: '공모전', h1: '공모전' },
  '/programs/lectures': { type: 'lecture', label: '특강', h1: '특강' },
  '/news': { type: 'notice', label: '공지사항', h1: '공지사항' },
  '/resources': { type: 'resource', label: '자료실', h1: '자료실' },
  '/students/clubs': { type: 'club', label: '동아리', h1: '동아리' },
  '/showcase': { type: 'showcase', label: '쇼케이스', h1: '쇼케이스' },
}

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const abs = (u) => {
  if (!u) return ''
  try {
    return new URL(u, SITE_URL).toString()
  } catch {
    return ''
  }
}
const oneLine = (s, max = 180) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

// ── TipTap(JSON) 본문 → 단순 HTML ─────────────────────────────────
function textOf(node) {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (node.type === 'text') return node.text || ''
  return (node.content || []).map(textOf).join(node.type === 'paragraph' || node.type === 'heading' ? '' : ' ')
}

function marks(html, ms = []) {
  let out = html
  for (const m of ms) {
    if (m.type === 'bold') out = `<strong>${out}</strong>`
    else if (m.type === 'italic') out = `<em>${out}</em>`
    else if (m.type === 'link' && m.attrs?.href && /^(https?:|mailto:|\/)/.test(m.attrs.href)) out = `<a href="${esc(m.attrs.href)}">${out}</a>`
  }
  return out
}

function renderNode(n) {
  if (!n) return ''
  const kids = () => (n.content || []).map(renderNode).join('')
  switch (n.type) {
    case 'doc':
      return kids()
    case 'text':
      return marks(esc(n.text || ''), n.marks)
    case 'paragraph': {
      const k = kids()
      return k.trim() ? `<p>${k}</p>` : ''
    }
    case 'heading': {
      const lv = Math.min(Math.max(Number(n.attrs?.level) || 2, 2), 4)
      return `<h${lv}>${kids()}</h${lv}>`
    }
    case 'bulletList':
      return `<ul>${kids()}</ul>`
    case 'orderedList':
      return `<ol>${kids()}</ol>`
    case 'listItem':
      return `<li>${kids()}</li>`
    case 'blockquote':
      return `<blockquote>${kids()}</blockquote>`
    case 'hardBreak':
      return '<br>'
    case 'image':
      return n.attrs?.src && n.attrs?.alt ? `<img src="${esc(abs(n.attrs.src))}" alt="${esc(n.attrs.alt)}">` : ''
    case 'table':
      return `<table>${kids()}</table>`
    case 'tableRow':
      return `<tr>${kids()}</tr>`
    case 'tableHeader':
      return `<th>${kids()}</th>`
    case 'tableCell':
      return `<td>${kids()}</td>`
    default:
      return kids()
  }
}

export function bodyHtml(body) {
  if (!body) return ''
  if (typeof body === 'string') {
    try {
      const j = JSON.parse(body)
      if (j && typeof j === 'object') return renderNode(j)
    } catch {
      /* 일반 글 */
    }
    return body
      .split(/\n{2,}/)
      .map((p) => (p.trim() ? `<p>${esc(p.trim())}</p>` : ''))
      .join('')
  }
  return renderNode(body)
}

export const bodyText = (body) => oneLine(textOf(typeof body === 'string' ? safeJson(body) ?? body : body), 400)
function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ── index.html 껍데기 ─────────────────────────────────────────────
let shellCache = { html: '', at: 0 }
const FALLBACK_SHELL = `<!doctype html><html lang="ko"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title></title><meta name="description" content="" /><link rel="canonical" href="" /></head><body><div id="root"></div></body></html>`

async function loadShell() {
  if (shellCache.html && Date.now() - shellCache.at < 10 * 60 * 1000) return shellCache.html
  try {
    const res = await fetch(`${SITE_URL}/index.html`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'dah-seo-render' } })
    const text = await res.text()
    if (res.ok && text.includes('<div id="root"')) {
      // index.html에 미리 넣어 둔 메인 페이지용 본문 블록은 경로별 본문으로 갈아 끼우므로 걷어 낸다
      const clean = text.replace(/<!--seo-start-->[\s\S]*?<!--seo-end-->/, '')
      shellCache = { html: clean, at: Date.now() }
      return clean
    }
  } catch {
    /* 아래 폴백 */
  }
  return shellCache.html || FALLBACK_SHELL
}

function setMeta(html, selectorRe, tag) {
  return selectorRe.test(html) ? html.replace(selectorRe, tag) : html.replace('</head>', `  ${tag}\n</head>`)
}

export function applyMeta(shell, { title, description, canonical, image, type = 'website', jsonLd, bodyInner, noindex = false }) {
  let h = shell
  const t = esc(title)
  const d = esc(description)
  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
  h = setMeta(h, /<meta name="description"[^>]*>/, `<meta name="description" content="${d}" />`)
  h = setMeta(h, /<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${esc(canonical)}" />`)
  h = setMeta(h, /<meta property="og:type"[^>]*>/, `<meta property="og:type" content="${type}" />`)
  h = setMeta(h, /<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(canonical)}" />`)
  h = setMeta(h, /<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${t}" />`)
  h = setMeta(h, /<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${d}" />`)
  h = setMeta(h, /<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${t}" />`)
  h = setMeta(h, /<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${d}" />`)
  if (image) {
    h = setMeta(h, /<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${esc(image)}" />`)
    h = setMeta(h, /<meta property="og:image:secure_url"[^>]*>/, `<meta property="og:image:secure_url" content="${esc(image)}" />`)
    h = setMeta(h, /<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${esc(image)}" />`)
    // 기본 이미지의 크기·형식 정보는 다른 이미지에 맞지 않으므로 뺀다
    h = h.replace(/\s*<meta property="og:image:(type|width|height|alt)"[^>]*>/g, '')
  }
  if (noindex) h = setMeta(h, /<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex" />')
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''
  h = h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, ld)
  const nav = `<nav aria-label="주요 메뉴"><ul>${NAV.map(([p, l]) => `<li><a href="${p}">${esc(l)}</a></li>`).join('')}</ul></nav>`
  h = h.replace(
    /<div id="root"><\/div>/,
    `<div id="root"><header><a href="/">${esc(SITE_NAME)}</a>${nav}</header><main data-seo-prerender="1">${bodyInner}</main></div>`
  )
  return h
}

const breadcrumb = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
})

// ── 유형별 필드 ──────────────────────────────────────────────────
const titleOf = (it) => it.title_ko || it.title || it.name || ''
const posterOf = (it) => abs(it.poster_url || it.main_img || '')

function metaLines(it) {
  const rows = []
  if (it.semester_label) rows.push(['학기', it.semester_label])
  if (it.category) rows.push(['분류', it.category_etc || it.category])
  if (it.host) rows.push(['주최', it.host])
  if (it.period) rows.push(['기간', it.period])
  const s = it.event_start || it.start_date
  const e = it.event_end || it.end_date
  if (s) rows.push(['일정', `${String(s).slice(0, 10)}${e && String(e).slice(0, 10) !== String(s).slice(0, 10) ? ` ~ ${String(e).slice(0, 10)}` : ''}`])
  if (it.creator) rows.push(['제작자', it.creator])
  if (it.topic) rows.push(['주제', it.topic])
  return rows
}

function itemDetailHtml(it, h1) {
  const poster = posterOf(it)
  const rows = metaLines(it)
  const intro = it.intro ? `<p>${esc(it.intro)}</p>` : it.description ? `<p>${esc(it.description)}</p>` : ''
  const link = it.external_url || it.site_url || it.link
  return (
    `<article><h1>${esc(h1)}</h1>` +
    (poster ? `<img src="${esc(poster)}" alt="${esc(h1)}">` : '') +
    (rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '') +
    intro +
    bodyHtml(it.body) +
    (link && /^https?:/.test(link) ? `<p><a href="${esc(link)}">${esc(link)}</a></p>` : '') +
    '</article>'
  )
}

function itemDescription(it, section) {
  const parts = [it.semester_label, titleOf(it), section.label].filter(Boolean)
  const lead = it.intro || it.description || bodyText(it.body) || [it.host && `주최 ${it.host}`, it.category && (it.category_etc || it.category)].filter(Boolean).join(', ')
  return oneLine(`${parts.join(' ')}${lead ? `. ${lead}` : ''}. ${SITE_NAME}`, 170)
}

// 관리자 화면에서 고치는 고정 페이지(소개 자료, 교육과정, 교수진, 운영위원회 등)도 DB에서 바로 읽는다.
// 값 구조가 제각각이라 범용 변환기로 "사람이 읽는 글"만 뽑는다. 주소·이미지·내부 번호는 뺀다.
const LIVE = {
  '/about/people': { types: ['professors', 'mentors'], heading: { professors: '교수진', mentors: '산업 멘토' } },
  '/curriculum': { types: ['curriculum'] },
  '/curriculum/codesharing': { types: ['codesharing'] },
  '/curriculum/nanodegree': { types: ['nanodegree'] },
  '/about/ci': { types: ['ci'] },
  '/students/council': { types: ['council'] },
  '/students/achievements': { types: ['achievement'] },
  '/students/careers': { types: ['careers', 'portfolios'], heading: { careers: '졸업생 진로', portfolios: '포트폴리오' } },
  '/students/portfolios': { types: ['portfolios'] },
}
const SKIP_KEY = /^(id|sort|has_bg|published|pinned|status|created_at|updated_at|created_by|seed_key|type|hex|depts_id|hwp_url|attachments|gallery|tag)$|(_url|url|image|img|logo|poster|photo|picture|src|href|link)$/i
const NAME_KEYS = ['title_ko', 'title', 'name', 'grad_name', 'company', 'year_label']

function genericHtml(v, depth = 0) {
  if (v == null || typeof v === 'boolean') return ''
  if (typeof v === 'number') return `<span>${v}</span>`
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t || /^(https?:\/\/|\/|#[0-9a-f]{3,8}$)/i.test(t)) return ''
    const j = t.startsWith('{') ? safeJson(t) : null
    if (j && j.type === 'doc') return renderNode(j)
    return depth === 0 ? `<p>${esc(t)}</p>` : esc(t)
  }
  if (Array.isArray(v)) {
    const items = v.map((x) => genericHtml(x, depth + 1)).filter(Boolean)
    return items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''
  }
  if (typeof v === 'object') {
    if (v.type === 'doc') return renderNode(v)
    const keys = Object.keys(v).filter((k) => !SKIP_KEY.test(k))
    const nameKey = NAME_KEYS.find((k) => typeof v[k] === 'string' && v[k].trim() && keys.includes(k))
    const head = nameKey ? `<h3>${esc(v[nameKey])}</h3>` : ''
    const rest = keys
      .filter((k) => k !== nameKey)
      .map((k) => genericHtml(v[k], depth + 1))
      .filter(Boolean)
      .map((x) => (x.startsWith('<') ? x : `<p>${x}</p>`))
      .join('')
    return head + rest
  }
  return ''
}

async function liveSection(path, hidden) {
  const def = LIVE[path]
  if (!def) return ''
  const parts = []
  for (const type of def.types) {
    if (hidden[type] === false) continue
    const cfg = getTypeConfig(type)
    if (!cfg) continue
    let rows = []
    try {
      if (cfg.singleton) {
        const one = await runGetOne(cfg, 1)
        rows = one ? [one] : []
      } else {
        rows = (await runList(cfg, { page: 1, pageSize: 100 })).items || []
      }
    } catch {
      rows = []
    }
    const body = rows.map((r) => `<article>${genericHtml(r)}</article>`).join('')
    if (body.replace(/<[^>]+>/g, '').trim()) parts.push(`${def.heading?.[type] ? `<h2>${esc(def.heading[type])}</h2>` : ''}${body}`)
  }
  return parts.join('')
}

async function hiddenTypes() {
  try {
    const { rows } = await query("SELECT value FROM site_settings WHERE key = 'contentVisibility'", [])
    const v = normalizeVisibility(rows[0]?.value)
    return v || {}
  } catch {
    return {}
  }
}

// ── 경로 → 완성된 HTML ───────────────────────────────────────────
export function normalizePath(raw) {
  let p = String(raw || '/').split('?')[0].split('#')[0]
  try {
    p = decodeURI(p)
  } catch {
    /* 그대로 */
  }
  if (!p.startsWith('/')) p = `/${p}`
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return p
}

export async function renderPage(rawPath) {
  const path = normalizePath(rawPath)
  const shell = await loadShell()
  const canonical = abs(path)
  const ldBase = (graph) => ({ '@context': 'https://schema.org', '@graph': graph })

  // 1) 목록
  const section = SECTIONS[path]
  if (section) {
    const hidden = await hiddenTypes()
    if (hidden[section.type] === false) return { status: 404, html: applyMeta(shell, { title: SITE_NAME, description: '', canonical: abs('/'), bodyInner: '<h1>페이지를 찾을 수 없습니다</h1>', noindex: true }) }
    const meta = STATIC[path] || {}
    const { items } = await runList(getTypeConfig(section.type), { page: 1, pageSize: 100 })
    const list = (items || [])
      .map((it) => {
        const poster = posterOf(it)
        const sub = [it.semester_label, it.host, it.category_etc || it.category].filter(Boolean).join(' · ')
        return `<li><a href="${path}/${it.id}">${poster ? `<img src="${esc(poster)}" alt="${esc(titleOf(it))}">` : ''}<h2>${esc(titleOf(it))}</h2></a>${sub ? `<p>${esc(sub)}</p>` : ''}${it.intro ? `<p>${esc(oneLine(it.intro, 200))}</p>` : ''}</li>`
      })
      .join('')
    const title = meta.title || `${section.label} | ${SITE_NAME}`
    const description = meta.description || `${SITE_NAME} ${section.label} 목록입니다.`
    return {
      status: 200,
      html: applyMeta(shell, {
        title,
        description,
        canonical,
        image: items?.[0] ? posterOf(items[0]) : '',
        jsonLd: ldBase([
          { '@type': 'CollectionPage', name: title, url: canonical, description },
          breadcrumb([{ name: '홈', path: '/' }, { name: section.label, path }]),
        ]),
        bodyInner: `<h1>${esc(section.h1)}</h1><p>${esc(description)}</p><ul>${list}</ul>`,
      }),
    }
  }

  // 2) 상세 /목록경로/숫자
  const m = /^(\/[a-z/]+?)\/(\d+)$/.exec(path)
  if (m && SECTIONS[m[1]]) {
    const sec = SECTIONS[m[1]]
    const hidden = await hiddenTypes()
    const item = hidden[sec.type] === false ? null : await runGetOne(getTypeConfig(sec.type), Number(m[2])).catch(() => null)
    if (!item) return { status: 404, html: applyMeta(shell, { title: `찾을 수 없음 | ${SITE_NAME}`, description: '', canonical, bodyInner: '<h1>페이지를 찾을 수 없습니다</h1>', noindex: true }) }
    const name = titleOf(item)
    const title = `${name} | ${SITE_NAME} ${sec.label}`
    const description = itemDescription(item, sec)
    const image = posterOf(item)
    const s = item.event_start || item.start_date
    const e = item.event_end || item.end_date
    const graph = [breadcrumb([{ name: '홈', path: '/' }, { name: sec.label, path: m[1] }, { name, path }])]
    if (['contest', 'lecture', 'exhibitions'].includes(sec.type) && s) {
      graph.unshift({
        '@type': 'Event',
        name,
        startDate: String(s).slice(0, 10),
        ...(e ? { endDate: String(e).slice(0, 10) } : {}),
        ...(image ? { image } : {}),
        description,
        organizer: { '@type': 'EducationalOrganization', name: item.host || SITE_NAME },
      })
    } else if (sec.type === 'notice' || sec.type === 'resource') {
      graph.unshift({ '@type': 'Article', headline: name, ...(image ? { image } : {}), datePublished: item.created_at, dateModified: item.updated_at || item.created_at, publisher: { '@type': 'EducationalOrganization', name: SITE_NAME } })
    }
    return {
      status: 200,
      html: applyMeta(shell, { title, description, canonical, image, type: 'article', jsonLd: ldBase(graph), bodyInner: itemDetailHtml(item, name) }),
    }
  }

  // 3) 고정 페이지: 관리자 화면에서 고치는 페이지는 DB에서 읽고(실패·빈 값이면 스냅샷), 코드에 든 페이지는 스냅샷
  const st = STATIC[path]
  if (st) {
    if (LIVE[path]) {
      const live = await liveSection(path, await hiddenTypes())
      const plain = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length
      // DB 글이 화면 본문의 절반에도 못 미치면(본문 대부분이 코드에 있는 페이지) 화면 스냅샷이 더 충실하다
      if (live && plain(live) >= plain(st.html) * 0.5) {
        const h1 = /<h1>(.*?)<\/h1>/.exec(st.html || '')?.[1] || st.title.split(' | ')[0]
        const description = st.description || `${SITE_NAME}의 안내 페이지입니다.`
        return {
          status: 200,
          html: applyMeta(shell, {
            title: st.title,
            description,
            canonical,
            jsonLd: ldBase([breadcrumb([{ name: '홈', path: '/' }, { name: st.title.split(' | ')[0], path }])]),
            bodyInner: `<h1>${h1}</h1><p>${esc(description)}</p>${live}`,
          }),
        }
      }
    }
    const description = st.description || `${SITE_NAME}의 안내 페이지입니다.`
    const graph = path === '/' ? st.jsonLd?.['@graph'] || [] : [breadcrumb([{ name: '홈', path: '/' }, { name: st.title.split(' | ')[0], path }])]
    return {
      status: 200,
      html: applyMeta(shell, {
        title: st.title,
        description,
        canonical,
        jsonLd: ldBase(graph.map((g) => JSON.parse(JSON.stringify(g).split('"__SITE__').join(`"${SITE_URL}`)))),
        bodyInner: st.html.replace(/(href|src)="\/(?!\/)/g, `$1="${SITE_URL}/`).replace(new RegExp(`(href)="${SITE_URL}/`, 'g'), '$1="/'),
      }),
    }
  }

  // 4) 그 밖의 경로: 색인하지 않는다
  return { status: 404, html: applyMeta(shell, { title: SITE_NAME, description: '', canonical: abs('/'), bodyInner: '<h1>페이지를 찾을 수 없습니다</h1>', noindex: true }) }
}
