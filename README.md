# Karuku

PDF・JPG・PNG・HEIC の容量調整と回転を、ブラウザの中だけで行うウェブアプリです。
ファイルはサーバーに送信されません。

## できること

- 画像（JPG / PNG / HEIC）の回転、目標容量への圧縮、形式変換（JPEG / PNG / WebP / PDF）
- PDF の回転（全ページ・ページごと、劣化なし）と圧縮（ページを画像化。実行前に確認あり）
- 撮影情報（EXIF・GPS など）の削除
- 個別保存と ZIP での一括保存

## 開発

```bash
npm install
npm run dev      # 開発用サーバー
npm run build    # 本番用ビルド（dist/ に出力）
npm run preview  # ビルド結果の確認
```

`npm run dev` / `npm run build` の前に、pdf.js の補助データ（文字対応表・フォントなど）が
`public/pdfjs/` に自動でコピーされます（Git の管理対象外）。

## 構成

| 役割 | ライブラリ |
|---|---|
| 画面 | Vite + React + TypeScript |
| PDF の描画 | pdfjs-dist（legacy 版） |
| PDF の回転・作成 | pdf-lib |
| HEIC の読み込み | heic-to（CSP 対応版） |
| ZIP | fflate |

ライブラリと補助データはすべてアプリと一緒に配信し、外部の CDN やフォント、アクセス解析は使いません。

主なファイル:

- `src/lib/imageProcess.ts` … 画像の回転・目標容量への調整
- `src/lib/metadata.ts` … 画像を作り直さずに撮影情報だけを削除
- `src/lib/pdf.ts` / `src/lib/pdfCompress.ts` … PDF の読み込み・回転・圧縮
- `src/lib/convert.ts` … ファイルの種類と設定に応じて処理を振り分け

## セキュリティ設定（CSP）

`vercel.json` で Content-Security-Policy を設定し、ブラウザが外部への通信
（fetch・画像の読み込み・フォーム送信・外部スクリプトなど）を拒否するようにしています。
仮にコードに不具合があっても、ファイルの中身が外部に送られることはありません。

`npm run preview` でも同じ設定が適用されます（`vite.config.ts` が `vercel.json` を読み込みます）。

## Vercel へのデプロイ

1. このリポジトリを GitHub に push する
2. Vercel で「Add New… → Project」から、このリポジトリを Import する
3. 設定は `vercel.json` から自動で読み込まれるので、そのまま「Deploy」を押す
   （Framework: Vite / Build Command: `npm run build` / Output: `dist`）

以降は main ブランチに push するたびに自動でデプロイされます。
# karuku
