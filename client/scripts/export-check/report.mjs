// report.json 을 사람이 보는 report.html 로 바꾼다. 이미지는 report.html 기준 상대 경로.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const BADGE = { pass: ['PASS', '#1b7f3b'], fail: ['FAIL', '#c0261b'], warn: ['WARN', '#b86e00'], skip: ['SKIP', '#6b7280'], pending: ['대기', '#6b7280'] }
export const badge = (st, title = '') => {
  const [t, c] = BADGE[st] || BADGE.skip
  return `<span style="background:${c};color:#fff;border-radius:4px;padding:1px 7px;font-size:12px" title="${esc(title)}">${t}</span>`
}

export function renderReportHtml(report, { thumbH = 340 } = {}) {
  const rows = []
  const checkCols = [['write.docx', '쓰기 DOCX'], ['write.hwpx', '쓰기 HWPX'], ['struct.docx', '구조 DOCX'], ['struct.hwpx', '구조 HWPX'], ['tool.pythonDocx', 'python-docx'], ['tool.kordocValidate', 'kordoc validate'], ['roundtrip.docx', '왕복 DOCX'], ['roundtrip.hwpx', '왕복 HWPX'], ['render.docx', '렌더 DOCX'], ['render.hwpx', '렌더 HWPX'], ['cross.pages', '쪽 수 일치'], ['cross.tables', '표 위치 일치']]
  const head = `<tr><th>문서</th>${checkCols.map((c) => `<th>${c[1]}</th>`).join('')}</tr>`
  for (const it of report.items) {
    rows.push(`<tr><td><a href="#${esc(it.id)}">${esc(it.id)}</a></td>${checkCols.map(([k]) => `<td style="text-align:center">${badge(it.checks[k]?.status || 'skip', it.checks[k]?.note)}</td>`).join('')}</tr>`)
  }
  const sections = report.items.map((it) => {
    const thumbs = (label, variant) => {
      if (!variant || !variant.pages?.length) return `<div class="col"><div class="cap">${esc(label)}</div><div class="none">${variant?.renderNote ? esc(variant.renderNote) : '렌더 없음'}</div></div>`
      return `<div class="col"><div class="cap">${esc(label)} (${variant.pageCount}쪽${variant.pageCountNote ? ', ' + esc(variant.pageCountNote) : ''}${variant.wordPages ? ', 워드 저장본 ' + variant.wordPages + '쪽' : ''})</div><div class="pages">${variant.pages.map((p) => `<img src="${esc(p)}" style="height:${thumbH}px;border:1px solid #bbb;background:#fff" loading="lazy">`).join('')}</div></div>`
    }
    const detail = []
    for (const [k, c] of Object.entries(it.checks)) if (c.details?.length) detail.push(`<details><summary>${esc(k)}: ${esc(c.note || '')}</summary><ul>${c.details.slice(0, 40).map((d) => `<li>${esc(typeof d === 'string' ? d : JSON.stringify(d))}</li>`).join('')}</ul></details>`)
    const cmp = (it.comparisons || []).map((c) => `<table class="t"><caption>${esc(c.name)}: 쪽 수 ${c.pageCount.join(' vs ')}, 표 수 ${c.tableCount.join(' vs ')} ${badge(c.pass ? 'pass' : 'fail')}</caption><tr><th>표</th><th>시작 쪽</th><th>끝 쪽</th><th>x0 (쪽 폭 비)</th><th>x1</th><th>dx0</th><th>dx1</th><th>dy0 (쪽 높이 비)</th><th>높이 pt</th><th>높이 차 %</th><th>열 경계 수</th><th>열 경계 최대 차</th><th>표시</th></tr>${c.tables.map((t) => `<tr><td>${t.index}</td><td>${t.startPage.join(' / ')}</td><td>${t.endPage.join(' / ')}</td><td>${t.x0Frac.join(' / ')}</td><td>${t.x1Frac.join(' / ')}</td><td>${t.dx0}</td><td>${t.dx1}</td><td>${t.dy0}</td><td>${t.heightPt.join(' / ')}</td><td>${t.heightDiffPct}</td><td>${t.colEdges.join(' / ')}</td><td>${t.edgeMax ?? ''}</td><td>${esc(t.flags.join(', '))}</td></tr>`).join('')}</table>`).join('')
    return `<section id="${esc(it.id)}"><h2>${esc(it.id)} <small>${esc(it.label || '')}</small></h2><div class="row">${thumbs('원본', it.variants.orig)}${thumbs('DOCX (docx-preview)', it.variants.docx)}${thumbs('HWPX (kordoc)', it.variants.hwpx)}</div>${detail.join('')}${cmp}</section>`
  })
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>export-check 보고서</title><style>
body{font:14px/1.5 -apple-system,'Apple SD Gothic Neo',sans-serif;margin:24px;color:#111}
table.main{border-collapse:collapse;margin-bottom:24px}table.main td,table.main th{border:1px solid #ccc;padding:4px 8px;font-size:13px}
table.t{border-collapse:collapse;margin:8px 0;font-size:12px}table.t td,table.t th{border:1px solid #ddd;padding:2px 6px}
.row{display:flex;gap:16px;align-items:flex-start;overflow-x:auto}.col{min-width:200px}.cap{font-weight:600;margin-bottom:4px}.pages{display:flex;gap:6px}.none{color:#888;padding:20px;border:1px dashed #bbb}
section{border-top:2px solid #333;margin-top:28px;padding-top:8px}small{color:#666;font-weight:normal}
</style></head><body><h1>export-check 보고서</h1><p>생성: ${esc(report.generatedAt)} / 도구: ${esc(JSON.stringify(report.tools))}</p>
<p style="color:#555">DOCX 렌더는 docx-preview 를 브라우저에서 돌려 얻은 것이고 쪽 나눔은 블록 높이로 어림한 값이다(워드와 같다는 보증이 아님). HWPX 렌더는 kordoc 순수 TS 조판이다(한컴과 같다는 보증이 아님).</p>
<table class="main">${head}${rows.join('')}</table>${sections.join('')}</body></html>`
}
