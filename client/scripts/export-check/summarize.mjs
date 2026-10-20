#!/usr/bin/env node
// report.json / report-corpus.json 을 짧은 표로 요약한다(개인 내용은 담지 않고 구조 수치만).
//   node summarize.mjs <report.json>
import fs from 'node:fs'

export function summarizeReport(r) {
  const lines = []
  const S = { pass: 'P', fail: 'F', warn: 'W', skip: '-', pending: '?' }
  lines.push('id | 읽기 | 쓰기 D/H | 구조 D/H | pyDocx | kordoc | 왕복 D/H | 쪽(워드저장/원본렌더/DOCX산출/HWPX산출) | 같은 렌더러 비교(표 이탈/전체)')
  const agg = { n: 0, sameDocx: { files: 0, pagesEq: 0, tables: 0, flagged: 0 }, sameHwpx: { files: 0, pagesEq: 0, tables: 0, flagged: 0 }, flags: {} }
  for (const it of r.items) {
    const c = it.checks
    const k = (x) => S[c[x]?.status] || '.'
    const o = it.variants.orig
    const same = it.comparisons.find((x) => x.sameRenderer)
    if (same) {
      const g = o?.ext === '.docx' ? agg.sameDocx : agg.sameHwpx
      g.files++; if (same.pageCount[0] === same.pageCount[1]) g.pagesEq++
      g.tables += same.tables.length; g.flagged += same.tables.filter((t) => t.flags.length).length
      for (const t of same.tables) for (const f of t.flags) agg.flags[f] = (agg.flags[f] || 0) + 1
    }
    lines.push(`${it.id.replace('corpus-', '')} | ${k('read.orig')} | ${k('write.docx')}${k('write.hwpx')} | ${k('struct.docx')}${k('struct.hwpx')} | ${k('tool.pythonDocx')} | ${k('tool.kordocValidate')} | ${k('roundtrip.docx')}${k('roundtrip.hwpx')} | ${o?.wordPages ?? '-'}/${o?.pageCount ?? '-'}/${it.variants.docx?.pageCount ?? '-'}/${it.variants.hwpx?.pageCount ?? '-'} | ${same ? `${same.tables.filter((t) => t.flags.length).length}/${same.tables.length}` : '-'}`)
  }
  return { lines, agg }
}

if (process.argv[2]) {
  const { lines, agg } = summarizeReport(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
  console.log(lines.join('\n'))
  console.log(JSON.stringify(agg))
}
