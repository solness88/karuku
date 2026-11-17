/**
 * PDFの読み込み・描画（pdf.js）と、回転・作成（pdf-lib）。
 * どちらも約1MB以上あるため、PDFを扱うときに初めて読み込む。
 * 補助データ（文字対応表・フォントなど）は public/pdfjs から配信し、外部には取りに行かない。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'

// pdf.js の通常版は最新のブラウザ機能を前提にしているため、少し前のChrome・Safariでも
// 動くよう、足りない機能を補った legacy 版を使う
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfLibModule = typeof import('pdf-lib')

export class PdfError extends Error {}

let pdfjsPromise: Promise<PdfjsModule> | null = null
let pdfLibPromise: Promise<PdfLibModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
    .then(([mod, worker]) => {
      mod.GlobalWorkerOptions.workerSrc = worker.default
      return mod
    })
    .catch((e) => {
      pdfjsPromise = null
      throw e
    })
  return pdfjsPromise
}

function loadPdfLib(): Promise<PdfLibModule> {
  pdfLibPromise ??= import('pdf-lib').catch((e) => {
    pdfLibPromise = null
    throw e
  })
  return pdfLibPromise
}

/** 補助データの置き場所（同じサイト内の絶対URL） */
function assetUrl(dir: string): string {
  return new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, location.href).href
}

export interface OpenedPdf {
  doc: PDFDocumentProxy
  /** 使い終わったら必ず呼ぶ（メモリと裏側の処理を解放する） */
  close: () => Promise<void>
}

/** PDFを開く */
export async function openPdf(file: Blob): Promise<OpenedPdf> {
  let pdfjs: PdfjsModule
  try {
    pdfjs = await loadPdfjs()
  } catch {
    throw new PdfError('PDFの読み込み機能を準備できませんでした。ページを再読み込みしてください。')
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    enableXfa: false,
  })
  try {
    const doc = await task.promise
    return { doc, close: () => task.destroy() }
  } catch (e) {
    void task.destroy()
    if (e instanceof Error && e.name === 'PasswordException') {
      throw new PdfError('パスワードで保護されたPDFは扱えません。')
    }
    throw new PdfError('PDFとして読み込めませんでした。ファイルが壊れている可能性があります。')
  }
}

/**
 * ページを縮小画像（JPEG）にする。ページにもともと設定されている回転は反映し、
 * アプリ上の回転はかけない（画面ではCSSで回す）。
 */
export async function renderPageThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  maxEdge = 480,
): Promise<Blob> {
  const page = await doc.getPage(pageNumber)
  try {
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: maxEdge / Math.max(base.width, base.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8))
    canvas.width = 0
    canvas.height = 0
    if (!blob) throw new PdfError('ページを表示できませんでした。')
    return blob
  } finally {
    page.cleanup()
  }
}

/** 読み込みが終わらないまま止まるのを防ぐための上限時間 */
const SUMMARY_TIMEOUT_MS = 60_000

/** 一覧に表示するための情報（ページ数と1ページ目の縮小画像） */
export async function summarizePdf(file: Blob): Promise<{ pageCount: number; thumbnail: Blob }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PdfError('PDFの読み込みが終わりませんでした。ブラウザを最新版にして、もう一度お試しください。')),
      SUMMARY_TIMEOUT_MS,
    )
  })
  const work = (async () => {
    const { doc, close } = await openPdf(file)
    try {
      return { pageCount: doc.numPages, thumbnail: await renderPageThumbnail(doc, 1) }
    } finally {
      await close()
    }
  })()
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 各ページの回転情報だけを書き換える（画質・文字・リンクはそのまま）。
 * rotationOf(i) は i+1 ページ目に追加する角度（時計回り、90の倍数）。
 */
export async function rotatePdf(file: Blob, rotationOf: (index: number) => number): Promise<Blob> {
  const { PDFDocument, degrees, EncryptedPDFError } = await loadPdfLib()
  let doc: Awaited<ReturnType<PdfLibModule['PDFDocument']['load']>>
  try {
    doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false })
  } catch (e) {
    if (e instanceof EncryptedPDFError) {
      throw new PdfError('保護されたPDF（パスワードや編集制限付き）は回転できません。')
    }
    throw new PdfError('PDFを書き換えられませんでした。ファイルが壊れている可能性があります。')
  }
  doc.getPages().forEach((page, i) => {
    const delta = rotationOf(i)
    if (delta % 360 === 0) return
    const current = page.getRotation().angle
    page.setRotation(degrees((((current + delta) % 360) + 360) % 360))
  })
  const bytes = await doc.save()
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

/** A4の長辺（pt）。画像から作るPDFは、長辺をこの長さに合わせる */
const A4_LONG_EDGE_PT = 842

/**
 * 画像1枚から1ページのPDFを作る。ページの縦横比は画像に合わせ、長辺をA4の長辺にそろえる
 * （印刷やプレビューでちょうどよい大きさになるように）。
 */
export async function imageToPdf(image: Blob, width: number, height: number): Promise<Blob> {
  const { PDFDocument } = await loadPdfLib()
  const doc = await PDFDocument.create()
  const bytes = new Uint8Array(await image.arrayBuffer())
  const embedded = image.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  const scale = A4_LONG_EDGE_PT / Math.max(width, height)
  const pw = width * scale
  const ph = height * scale
  const page = doc.addPage([pw, ph])
  page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph })
  const out = await doc.save()
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
