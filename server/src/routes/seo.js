// src/routes/seo.js — 크롤러용 HTML. Vercel이 검색·공유 봇의 요청만 여기로 넘긴다(client/vercel.json).
// GET /seo/page?path=/programs/contests/190  → 내용이 담긴 완성 HTML
import { Router } from 'express'
import { renderPage } from '../lib/seoRender.js'

const router = Router()

router.get('/seo/page', async (req, res) => {
  try {
    const { status, html } = await renderPage(req.query.path)
    // 봇 전용 응답이 CDN에서 일반 방문자 주소에 섞여 저장되지 않도록 저장 금지
    res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': status === 200 ? 'all' : 'noindex' }).send(html)
  } catch (err) {
    console.error('[seo] 렌더 실패:', err.message)
    res.status(502).set('Cache-Control', 'private, no-store').type('text/plain').send('seo render failed')
  }
})

export default router
