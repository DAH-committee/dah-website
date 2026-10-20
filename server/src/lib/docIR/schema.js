// docIR 공통: 단위 변환, 검증·보정, 표 격자 전개, 비교용 요약. 명세는 README.md.
// 순수 ESM, DOM 없음.

export const U = {
  mmToPt: (mm) => (mm * 72) / 25.4,
  ptToMm: (pt) => (pt * 25.4) / 72,
  ptToHwp: (pt) => Math.round(pt * 100), // hwpunit: 1/7200 in, 1pt = 100
  hwpToPt: (h) => h / 100,
  ptToDxa: (pt) => Math.round(pt * 20), // twips: 1/1440 in
  dxaToPt: (d) => d / 20,
  ptToEmu: (pt) => Math.round(pt * 12700),
  emuToPt: (e) => e / 12700,
  pxToPt: (px) => (px * 72) / 96,
  mmToHwp: (mm) => Math.round((mm * 7200) / 25.4),
  mmToDxa: (mm) => Math.round((mm * 1440) / 25.4),
}

export const PAGE_SIZES_MM = {
  A4: { wMm: 210, hMm: 297 },
  B5: { wMm: 176, hMm: 250 },
  A3: { wMm: 297, hMm: 420 },
  Letter: { wMm: 215.9, hMm: 279.4 },
}

export function pageDims(page) {
  const base = typeof page.size === 'object' ? page.size : PAGE_SIZES_MM[page.size] || PAGE_SIZES_MM.A4
  const land = page.orientation === 'landscape'
  const wMm = land ? Math.max(base.wMm, base.hMm) : Math.min(base.wMm, base.hMm)
  const hMm = land ? Math.min(base.wMm, base.hMm) : Math.max(base.wMm, base.hMm)
  const m = page.marginMm
  return { wMm, hMm, bodyWMm: wMm - m.left - m.right - (page.gutterMm || 0), bodyHMm: hMm - m.top - m.bottom }
}

const DEFAULT_PAGE = {
  size: 'A4',
  orientation: 'portrait',
  marginMm: { top: 20, right: 20, bottom: 15, left: 20 },
  headerMm: 10,
  footerMm: 10,
}
const DEFAULT_DEFAULTS = { font: { ko: '맑은 고딕', latin: '맑은 고딕' }, sizePt: 10, lineSpacing: { mode: 'percent', value: 160 }, color: '#000000', align: 'left' }

// 모자란 값을 채우고, 표의 열 폭과 병합을 바로잡고, 문제를 목록으로 돌려준다. 원본은 바꾸지 않는다.
export function normalizeIR(input) {
  const issues = []
  const ir = {
    version: 1,
    meta: { title: '', ...(input.meta || {}) },
    page: { ...DEFAULT_PAGE, ...(input.page || {}), marginMm: { ...DEFAULT_PAGE.marginMm, ...(input.page?.marginMm || {}) } },
    defaults: { ...DEFAULT_DEFAULTS, ...(input.defaults || {}), font: { ...DEFAULT_DEFAULTS.font, ...(input.defaults?.font || {}) } },
    header: input.header ? input.header.map((b) => normBlock(b, issues, 'header')) : undefined,
    footer: input.footer ? input.footer.map((b) => normBlock(b, issues, 'footer')) : undefined,
    body: (input.body || []).map((b, i) => normBlock(b, issues, `body[${i}]`)),
    assets: input.assets || {},
  }
  const bodyW = U.mmToPt(pageDims(ir.page).bodyWMm)
  walkBlocks(ir.body, (b, path) => {
    if (b.t !== 'table') return
    const sum = b.colPt.reduce((a, c) => a + c, 0)
    if (Math.abs(sum - b.widthPt) > 0.5) {
      issues.push({ path, msg: `열 폭 합(${sum.toFixed(1)})이 표 폭(${b.widthPt.toFixed(1)})과 다름: 표 폭을 열 합으로 맞춤` })
      b.widthPt = sum
    }
    if (b.widthPt > bodyW + 0.5 && path.split('.').length <= 2) issues.push({ path, msg: `표 폭(${b.widthPt.toFixed(1)}pt)이 본문 폭(${bodyW.toFixed(1)}pt)을 넘음` })
    const g = tableGrid(b)
    if (g.error) issues.push({ path, msg: g.error })
  })
  return { ir, issues }
}

function normBlock(b, issues, path) {
  if (b.t === 'p') return { ...b, runs: (b.runs || []).map((r) => ({ ...r })) }
  if (b.t === 'table') {
    return {
      ...b,
      rows: b.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ colspan: 1, rowspan: 1, ...c, blocks: (c.blocks?.length ? c.blocks : [{ t: 'p', runs: [] }]).map((x, i) => normBlock(x, issues, `${path}.cell.${i}`)) })) })),
    }
  }
  return { ...b }
}

export function walkBlocks(blocks, fn, path = 'body') {
  blocks.forEach((b, i) => {
    const p = `${path}[${i}]`
    fn(b, p)
    if (b.t === 'table') b.rows.forEach((r, ri) => r.cells.forEach((c, ci) => walkBlocks(c.blocks, fn, `${p}.r${ri}c${ci}`)))
  })
}

// 표를 (행 x 열) 격자로 펼친다. 각 칸이 어느 병합 칸에 속하는지 알려 준다. 병합이 어긋나면 error.
export function tableGrid(table) {
  const nCols = table.colPt.length
  const nRows = table.rows.length
  const grid = Array.from({ length: nRows }, () => Array(nCols).fill(null))
  for (let r = 0; r < nRows; r++) {
    let c = 0
    for (let k = 0; k < table.rows[r].cells.length; k++) {
      const cell = table.rows[r].cells[k]
      while (c < nCols && grid[r][c]) c++
      if (c >= nCols) return { grid, nRows, nCols, error: `행 ${r}: 칸이 열 수(${nCols})보다 많음` }
      const cs = cell.colspan || 1
      const rs = cell.rowspan || 1
      if (c + cs > nCols || r + rs > nRows) return { grid, nRows, nCols, error: `행 ${r} 칸 ${k}: 병합이 표 밖으로 나감` }
      for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) {
        if (grid[rr][cc]) return { grid, nRows, nCols, error: `행 ${rr} 열 ${cc}: 병합 칸이 겹침` }
        grid[rr][cc] = { r, c, ri: r, ki: k, anchor: rr === r && cc === c }
      }
      c += cs
    }
  }
  for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) if (!grid[r][c]) return { grid, nRows, nCols, error: `행 ${r} 열 ${c}: 비어 있음(칸이 모자람)` }
  return { grid, nRows, nCols }
}

export function runsText(runs) {
  return runs.map((r) => (r.text ?? '') + (r.br ? '\n' : '') + (r.tab ? '\t' : '') + (r.check ? (r.check.checked ? '☑' : '☐') : '')).join('')
}

export function plainText(blocks) {
  const out = []
  walkBlocks(blocks, (b) => {
    if (b.t === 'p') out.push((b.list?.marker ? b.list.marker + ' ' : '') + runsText(b.runs))
  })
  return out
}

// 서로 다른 경로로 만든 IR(편집기 원본, 읽어 되돌린 것)을 견주기 위한 요약. 글꼴 이름·정확한 pt 는 허용 오차를 두고 견주도록 값만 담는다.
export function summarize(ir) {
  const tables = []
  walkBlocks(ir.body, (b, path) => {
    if (b.t !== 'table') return
    const g = tableGrid(b)
    tables.push({
      path,
      cols: b.colPt.length,
      rows: b.rows.length,
      widthPt: Math.round(b.widthPt * 10) / 10,
      colPt: b.colPt.map((x) => Math.round(x * 10) / 10),
      merges: b.rows.flatMap((r, ri) => r.cells.filter((c) => (c.colspan || 1) > 1 || (c.rowspan || 1) > 1).map((c) => `${ri}:${c.colspan || 1}x${c.rowspan || 1}`)),
      bgs: b.rows.flatMap((r) => r.cells.map((c) => c.bg || '')),
      error: g.error,
    })
  })
  return {
    page: { ...pageDims(ir.page), margin: ir.page.marginMm },
    paragraphs: plainText(ir.body),
    tables,
    figures: ir.body.filter((b) => b.t === 'figure').length,
  }
}
