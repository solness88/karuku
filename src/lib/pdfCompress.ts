/**
 * PDFの圧縮（仕様 4-3）。各ページを画像（JPEG）にしてPDFを作り直す。
 * 文字の選択・検索・リンク・しおり・フォームは失われる。
 *
 * 目標容量に収まるよう、解像度（dpi）を高い順に試し、各解像度で全ページ共通の画質を選ぶ。
 * 1つの解像度につき各ページを1回だけ描画し、その場で複数の画質で書き出しておく
 * （ページの画像をすべてメモリに持たずに済むように）。
 */
import { openPdf, PdfError } from './pdf'

/**
 * 試す解像度と、その解像度で試す画質（高い順）。上から順に、収まる最初の組み合わせを使う。
 * 11/17 変更: 画質が落ちても目標容量に必ず収める。
 *  - 150〜96dpi: 画質40%まで
 *  - 72dpi: 画質10%まで
 *  - それ以下: 解像度を下げ続ける（画質40%〜10%）
 */
const LEVELS: { dpi: number; qualities: number[] }[] = [
  { dpi: 150, qualities: [0.85, 0.75, 0.65, 0.55, 0.4] },
  { dpi: 120, qualities: [0.85, 0.75, 0.65, 0.55, 0.4] },
  { dpi: 96, qualities: [0.85, 0.75, 0.65, 0.55, 0.4] },
  { dpi: 72, qualities: [0.85, 0.75, 0.65, 0.55, 0.4, 0.25, 0.1] },
  ...[54, 36, 24, 16, 12, 8].map((dpi) => ({ dpi, qualities: [0.4, 0.25, 0.1] })),
]
/** PDFの枠組みに使う容量の見積もり */
const BASE_OVERHEAD = 2 * 1024
const PAGE_OVERHEAD = 600
/** iPhoneのSafariでも扱えるキャンバスの上限 */
const MAX_CANVAS_PIXELS = 16_777_216

export interface CompressProgress {
  page: number
  total: number
  dpi: number
}

export interface CompressOutput {
  blob: Blob
  dpi: number
  quality: number
  reachedTarget: boolean
}

interface RenderedPage {
  /** その解像度の qualities と同じ順の書き出し結果 */
  encodings: Blob[]
  /** ページの大きさ（pt）。回転を反映した後の向き */
  widthPt: number
  heightPt: number
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new PdfError('ページを画像にできませんでした。'))),
      'image/jpeg',
      quality,
    ),
  )
}

export async function compressPdf(
  file: Blob,
  rotationOf: (index: number) => number,
  targetBytes: number,
  onProgress?: (p: CompressProgress) => void,
): Promise<CompressOutput> {
  const { doc, close } = await openPdf(file)
  try {
    const total = doc.numPages
    const budget = targetBytes - BASE_OVERHEAD - PAGE_OVERHEAD * total
    let smallest: { pages: RenderedPage[]; dpi: number; quality: number } | null = null

    for (const { dpi, qualities } of LEVELS) {
      const pages: RenderedPage[] = []

      for (let i = 0; i < total; i++) {
        onProgress?.({ page: i + 1, total, dpi })
        const page = await doc.getPage(i + 1)
        try {
          // ページにもともとある回転に、アプリでの回転を足す
          const rotation = (page.rotate + rotationOf(i)) % 360
          const atOne = page.getViewport({ scale: 1, rotation })
          let scale = dpi / 72
          const pixels = atOne.width * atOne.height * scale * scale
          if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
          const viewport = page.getViewport({ scale, rotation })

          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(viewport.width))
          canvas.height = Math.max(1, Math.round(viewport.height))
          await page.render({ canvas, viewport, background: '#ffffff' }).promise
          const encodings: Blob[] = []
          for (const q of qualities) encodings.push(await encodeJpeg(canvas, q))
          canvas.width = 0
          canvas.height = 0
          pages.push({ encodings, widthPt: atOne.width, heightPt: atOne.height })
        } finally {
          page.cleanup()
        }
      }

      // この解像度で、全ページの合計が予算に収まる最も高い画質を探す
      for (let qi = 0; qi < qualities.length; qi++) {
        const sum = pages.reduce((s, p) => s + p.encodings[qi].size, 0)
        if (sum <= budget) {
          const blob = await buildPdf(pages, qi)
          return { blob, dpi, quality: qualities[qi], reachedTarget: blob.size <= targetBytes }
        }
      }

      // この解像度での最低画質の結果だけを残す（メモリ節約）
      const last = qualities.length - 1
      const trimmed = pages.map((p) => ({ ...p, encodings: [p.encodings[last]] }))
      const sumSize = (ps: RenderedPage[]) => ps.reduce((s, p) => s + p.encodings[0].size, 0)
      if (!smallest || sumSize(trimmed) < sumSize(smallest.pages)) {
        smallest = { pages: trimmed, dpi, quality: qualities[last] }
      }
    }

    // どの組み合わせでも収まらない（ページ数が非常に多く目標が極端に小さい場合のみ）: 最も小さくできたものを返す
    const blob = await buildPdf(smallest!.pages, 0)
    // 枠組みの容量は多めに見積もっているため、実際の大きさで判定する
    return { blob, dpi: smallest!.dpi, quality: smallest!.quality, reachedTarget: blob.size <= targetBytes }
  } finally {
    await close()
  }
}

async function buildPdf(pages: RenderedPage[], qualityIndex: number): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  for (const p of pages) {
    const jpg = await out.embedJpg(new Uint8Array(await p.encodings[qualityIndex].arrayBuffer()))
    const page = out.addPage([p.widthPt, p.heightPt])
    page.drawImage(jpg, { x: 0, y: 0, width: p.widthPt, height: p.heightPt })
  }
  const bytes = await out.save()
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
