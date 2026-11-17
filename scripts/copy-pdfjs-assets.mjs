// pdf.js が使う補助データ（日本語などの文字対応表・標準フォント・画像デコーダ・色プロファイル）を
// public/pdfjs にコピーする。アプリと同じサイトから配信し、外部のCDNには取りに行かせないため。
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const dest = join(root, 'public', 'pdfjs')

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'iccs']) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true })
}
// PDF内のJavaScriptを実行する機能（quickjs）は使わないのでコピーしない
cpSync(join(src, 'wasm'), join(dest, 'wasm'), {
  recursive: true,
  filter: (p) => !p.includes('quickjs'),
})
console.log('pdf.js の補助データを public/pdfjs にコピーしました')
