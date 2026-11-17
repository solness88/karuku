import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

/**
 * 本番（Vercel）と同じセキュリティ設定（CSPなど）を、確認用サーバー（npm run preview）にもかける。
 * 設定の正本は vercel.json の1か所だけにしておく。
 */
function productionHeaders(): Record<string, string> {
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }
  const all = vercel.headers.find((h) => h.source === '/(.*)')
  return Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // HEIC読み込み用のライブラリ（約3MB）は、HEICが追加されたときだけ読み込む別ファイルなので警告を抑える
    chunkSizeWarningLimit: 3500,
  },
  preview: {
    headers: productionHeaders(),
  },
})
