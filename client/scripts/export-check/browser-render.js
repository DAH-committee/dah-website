// Aside 브라우저(repl)에서 실행하는 DOCX 렌더 드라이버. 단독 노드 스크립트가 아니다.
// repl 에서:
//   const drive = new Function((await fs.readFile('<이 파일>', 'utf8')) + '; return driveDocxRender')()
//   await drive({ page, fs, jobsFile: '<out>/jobs.json', port: 3170 })
// jobs.json 은 run.mjs 가 만든다: [{ id, docx, outDir, headerRows }]. 각 outDir 에 docx-p01.png ... 와 docx-geom.json 을 쓴다.
async function driveDocxRender({ page, fs, jobsFile, port = 3170, only = null }) {
  const jobs = JSON.parse(await fs.readFile(jobsFile, 'utf8')).filter((j) => !only || only.includes(j.id))
  if (!/render\.html/.test(page.url())) await page.goto(`http://127.0.0.1:${port}/render.html`)
  const out = []
  for (const job of jobs) {
    const t0 = Date.now()
    try {
      const url = `http://127.0.0.1:${port}/files${job.docx.split('/').map(encodeURIComponent).join('/')}`
      const geom = await page.evaluate(async ([u, headerRows, breakBefore]) => await window.renderDocx(u, { headerRows, breakBefore }), [url, job.headerRows || [], job.breakBefore || []])
      await fs.mkdir(job.outDir, { recursive: true })
      const files = []
      const MAXP = 12 // 쪽 그림은 앞 12쪽까지만
      for (const p of geom.pages.slice(0, MAXP)) {
        const s = Math.min(1, 860 / p.h, 1380 / p.w)
        await page.evaluate(([pp, ss]) => window.maskPage(pp, ss), [p, s])
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: Math.round(p.w * s), height: Math.round(p.h * s) } })
        const name = `docx-p${String(p.pageNo + 1).padStart(2, '0')}.png`
        await fs.writeFile(`${job.outDir}/${name}`, buf)
        files.push(name)
      }
      await page.evaluate(() => window.unmask())
      geom.files = files
      geom.renderedAt = new Date().toISOString()
      geom.source = job.docx
      geom.sourceSha = job.sha
      await fs.writeFile(`${job.outDir}/docx-geom.json`, JSON.stringify(geom, null, 1))
      out.push({ id: job.id, pages: geom.pageCount, tables: geom.tables.length, ms: Date.now() - t0 })
    } catch (e) {
      await fs.mkdir(job.outDir, { recursive: true })
      await fs.writeFile(`${job.outDir}/docx-geom.json`, JSON.stringify({ error: String(e && e.message || e), source: job.docx, sourceSha: job.sha }))
      out.push({ id: job.id, error: String(e && e.message || e).slice(0, 160) })
    }
  }
  return out
}
