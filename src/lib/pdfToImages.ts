/**
 * PDFの各ページを画像（JPEG・PNG・WebP）にする。
 * ページを200dpiで描画し、写真と同じ方法で1枚ごとに目標容量に収める。
 */
import { openPdf, PdfError } from './pdf'
import { convertImage, type ImageMime } from './imageProcess'

/** 書類の文字が読める解像度 */
const RENDER_DPI = 200
/** 大きなページ（ポスターなど）でも重くなりすぎないよう、長辺をこの画素数までにする */
const MAX_LONG_EDGE = 4000

export interface PageImage {
  blob: Blob
  width: number
  height: number
  reachedTarget: boolean
}

export async function pdfToImages(
  file: Blob,
  rotationOf: (index: number) => number,
  mime: ImageMime,
  targetBytes: number,
  onProgress?: (page: number, total: number) => void,
): Promise<PageImage[]> {
  const { doc, close } = await openPdf(file)
  try {
    const out: PageImage[] = []
    for (let i = 0; i < doc.numPages; i++) {
      onProgress?.(i + 1, doc.numPages)
      const page = await doc.getPage(i + 1)
      let bitmap: ImageBitmap
      try {
        const rotation = (page.rotate + rotationOf(i)) % 360
        const atOne = page.getViewport({ scale: 1, rotation })
        const scale = Math.min(RENDER_DPI / 72, MAX_LONG_EDGE / Math.max(atOne.width, atOne.height))
        const viewport = page.getViewport({ scale, rotation })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        await page.render({ canvas, viewport, background: '#ffffff' }).promise
        bitmap = await createImageBitmap(canvas)
        canvas.width = 0
        canvas.height = 0
      } catch {
        throw new PdfError(`${i + 1}ページ目を画像にできませんでした。`)
      } finally {
        page.cleanup()
      }
      // 回転は描画時に反映済みなので、ここでは回さない（bitmap は convertImage が解放する）
      const img = await convertImage(bitmap, { rotation: 0, mime, targetBytes })
      out.push({ blob: img.blob, width: img.width, height: img.height, reachedTarget: img.reachedTarget })
    }
    return out
  } finally {
    await close()
  }
}
