import type { ConvertResult, ConvertSettings, FileItem, FileKind, OutputFormat } from '../types'
import { convertImage, getImageSize, type ImageMime } from './imageProcess'
import { decodeHeic } from './heic'
import { stripMetadata } from './metadata'
import { outputFileName } from './naming'
import { formatBytes } from './format'
import { imageToPdf, rotatePdf } from './pdf'
import { compressPdf } from './pdfCompress'
import { pdfToImages } from './pdfToImages'
import { makeZip } from './zip'


const MIME_EXT: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** 画像→PDFで、PDFの枠組みに使う分の容量（目標容量からこの分を引いて画像を作る。実測で約1KB） */
const PDF_OVERHEAD_BYTES = 1536

/** 「元の形式に合わせる」を実際の形式に置き換える（仕様 3） */
function resolveFormat(kind: FileKind, format: OutputFormat): OutputFormat {
  if (format !== 'auto') return format
  if (kind === 'png') return 'png'
  if (kind === 'pdf') return 'pdf'
  return 'jpeg' // JPG・HEIC
}

/**
 * 拡張子が .heic でも中身がJPEG・PNGのファイルがある（一部のスマホやアプリが書き出す）。
 * 先頭のバイトを見て、実際の形式を判定する。
 */
async function sniffImageKind(file: Blob, fallback: FileKind): Promise<FileKind> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  return fallback
}

function makeResult(
  blob: Blob,
  fileName: string,
  rest: Omit<ConvertResult, 'blob' | 'url' | 'fileName'>,
): ConvertResult {
  return { blob, url: URL.createObjectURL(blob), fileName, ...rest }
}

/** 変換中の進み具合を画面に伝える */
export type ProgressReporter = (text: string) => void

/** 目標容量を超えるPDF。圧縮（画像化）の対象になるため、変換前に確認する */
export function needsPdfCompression(item: FileItem, settings: ConvertSettings): boolean {
  // PDF→画像のときは、文字が選択できなくなるのは明らかなので確認しない
  return (
    item.kind === 'pdf' &&
    resolveFormat('pdf', settings.outputFormat) === 'pdf' &&
    item.file.size > settings.targetBytes
  )
}

export interface ConvertOptions {
  /** 目標容量を超えるPDFを画像化して圧縮してよいか（確認ダイアログでの回答） */
  allowPdfCompression: boolean
  onProgress?: ProgressReporter
}

export async function convertItem(
  item: FileItem,
  settings: ConvertSettings,
  options: ConvertOptions,
): Promise<ConvertResult> {
  if (item.kind === 'pdf') return convertPdf(item, settings, options)

  const kind = item.kind === 'heic' ? await sniffImageKind(item.file, 'heic') : item.kind
  const format = resolveFormat(kind, settings.outputFormat)

  // 画像→PDF: 目標容量に合わせたJPEGを作り、1ページのPDFにする
  if (format === 'pdf') {
    const source = kind === 'heic' ? await decodeHeic(item.file) : item.file
    const img = await convertImage(source, {
      rotation: item.rotation,
      mime: 'image/jpeg',
      targetBytes: Math.max(settings.targetBytes - PDF_OVERHEAD_BYTES, 512),
    })
    const pdf = await imageToPdf(img.blob, img.width, img.height)
    return makeResult(pdf, outputFileName(item.file.name, settings.suffix, 'pdf'), {
      width: img.width,
      height: img.height,
      reachedTarget: pdf.size <= settings.targetBytes,
      method: 'reencode',
    })
  }

  const mime = `image/${format}` as ImageMime
  const fileName = outputFileName(item.file.name, settings.suffix, MIME_EXT[mime])
  const sameFormat = format === kind
  const withinTarget = item.file.size <= settings.targetBytes

  // 回転なし・同じ形式・元から目標以下 → 画像は作り直さず、撮影情報だけ取り除く
  if (sameFormat && withinTarget && item.rotation === 0) {
    const stripped = await stripMetadata(item.file, kind as 'jpeg' | 'png')
    if (stripped) {
      const { width, height } = await getImageSize(stripped)
      return makeResult(stripped, fileName, { width, height, reachedTarget: true, method: 'original' })
    }
  }

  // HEICは先に読み込んでから渡す（ブラウザによっては標準機能で読めないため）
  const source = kind === 'heic' ? await decodeHeic(item.file) : item.file
  const out = await convertImage(source, {
    rotation: item.rotation,
    mime,
    targetBytes: settings.targetBytes,
    // 同じ形式なら、元のファイルより大きくしない
    preferMaxBytes: sameFormat && withinTarget ? item.file.size : undefined,
  })

  return makeResult(out.blob, fileName, {
    width: out.width,
    height: out.height,
    reachedTarget: out.reachedTarget,
    method: 'reencode',
  })
}

async function convertPdf(
  item: FileItem,
  settings: ConvertSettings,
  { allowPdfCompression, onProgress }: ConvertOptions,
): Promise<ConvertResult> {
  const fileName = outputFileName(item.file.name, settings.suffix, 'pdf')
  // ページ数の読み込み前でも全ページ共通の回転は反映できるよう、ページ番号から角度を求める
  const rotationOf = (index: number) => (item.rotation + (item.pageRotations[index] ?? 0)) % 360

  const format = resolveFormat('pdf', settings.outputFormat)
  if (format !== 'pdf') return convertPdfToImages(item, settings, `image/${format}` as ImageMime, rotationOf, onProgress)

  const noRotation = item.rotation === 0 && item.pageRotations.every((r) => r === 0)

  /** 画質を変えずに回転だけ行う（回転がなければ元のファイルのまま） */
  const rotateOnly = async (note?: string, ignoreTarget = false): Promise<ConvertResult> => {
    const blob = noRotation
      ? item.file.slice(0, item.file.size, 'application/pdf')
      : await rotatePdf(item.file, rotationOf)
    return makeResult(blob, fileName, {
      width: 0,
      height: 0,
      reachedTarget: ignoreTarget || blob.size <= settings.targetBytes,
      method: 'original',
      note,
    })
  }

  if (!needsPdfCompression(item, settings)) return rotateOnly('目標容量以下のため圧縮なし')
  // 確認ダイアログで圧縮しないことを選んだ場合は、目標容量に届かなくても警告しない
  if (!allowPdfCompression) return rotateOnly('圧縮しない選択のため回転のみ', true)

  const out = await compressPdf(item.file, rotationOf, settings.targetBytes, (p) =>
    onProgress?.(`${p.total}ページ中${p.page}ページ目（${p.dpi}dpi）`),
  )

  // 画像にするとかえって大きくなる場合（文字だけのPDFなど）は、元の画質のまま回転だけ行う
  if (out.blob.size >= item.file.size) {
    return rotateOnly('圧縮すると大きくなるため元の画質のまま')
  }

  return makeResult(out.blob, fileName, {
    width: 0,
    height: 0,
    reachedTarget: out.reachedTarget,
    method: 'reencode',
    note: `画像化 ${out.dpi}dpi・画質${Math.round(out.quality * 100)}%`,
  })
}

/**
 * PDF→画像。1ページなら画像1枚、複数ページなら全ページの画像をZIPにまとめる。
 * 目標容量は画像1枚ごとの上限。
 */
async function convertPdfToImages(
  item: FileItem,
  settings: ConvertSettings,
  mime: ImageMime,
  rotationOf: (index: number) => number,
  onProgress?: ProgressReporter,
): Promise<ConvertResult> {
  const ext = MIME_EXT[mime]
  const pages = await pdfToImages(item.file, rotationOf, mime, settings.targetBytes, (page, total) =>
    onProgress?.(`${total}ページ中${page}ページ目`),
  )
  const reachedTarget = pages.every((p) => p.reachedTarget)
  const label = ext.toUpperCase()

  if (pages.length === 1) {
    const p = pages[0]
    return makeResult(p.blob, outputFileName(item.file.name, settings.suffix, ext), {
      width: p.width,
      height: p.height,
      reachedTarget,
      method: 'reencode',
      note: `${label}に変換`,
    })
  }

  // 例: 請求書_edited_p01.jpg（ページ数の桁に合わせてゼロで埋め、並び順が崩れないようにする）
  const base = outputFileName(item.file.name, settings.suffix, ext).replace(/\.[^.]+$/, '')
  const digits = String(pages.length).length
  const parts = pages.map((p, i) => ({
    name: `${base}_p${String(i + 1).padStart(digits, '0')}.${ext}`,
    blob: p.blob,
  }))
  const zip = await makeZip(parts)
  const largest = Math.max(...pages.map((p) => p.blob.size))
  return makeResult(zip, `${base}.zip`, {
    width: 0,
    height: 0,
    reachedTarget,
    method: 'reencode',
    note: `${label} ${pages.length}枚をZIPに（1枚最大${formatBytes(largest)}）`,
    parts,
  })
}
