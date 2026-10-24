import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { seoPlugin } from './scripts/vite-seo-plugin.mjs'

// 37_OG: index.html의 %SITE_URL% 치환.
// 카카오톡 등 공유 크롤러는 JS를 실행하지 않으므로 og:image·og:url이 정적 HTML에
// https 절대 URL로 박혀 있어야 한다(상대경로는 카카오가 무시). 도메인은 하드코딩하지 않고
// VITE_SITE_URL 환경변수로만 주입한다(Vercel > Settings > Environment Variables).
// 미설정 시에는 빈 문자열로 치환해 상대경로로 남긴다 — 깨진 '%SITE_URL%' 문자열이
// 산출물에 남지 않게 하고, 대신 빌드 로그에 경고를 남긴다.
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = (env.VITE_SITE_URL || '').trim().replace(/\/+$/, '')

  if (!siteUrl) {
    console.warn(
      '[dah] VITE_SITE_URL 미설정 — og:image·og:url이 상대경로로 남습니다. ' +
        '카카오톡 공유 미리보기가 이미지를 읽지 못하니 배포 환경에 설정하세요(예: https://example.vercel.app).'
    )
  }

  return {
    plugins: [
      react(),
      seoPlugin({ siteUrl }),
      {
        name: 'dah-html-site-url',
        transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
      },
    ],
  }
})
