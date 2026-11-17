import type { Rotation } from '../types'

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ImageConvertOptions {
  rotation: Rotation
  mime: ImageMime
  targetBytes: number
  /**
   * できればこの容量以下にしたい上限（元のファイルより大きくしないため）。
   * 元の解像度のまま画質の調整だけで収まる場合に限り適用する。
   */
  preferMaxBytes?: number
}

export interface ImageConvertOutput {
  blob: Blob
  width: number
  height: number
  quality: number | null
  reachedTarget: boolean
}

/** 画質の上限・下限（仕様 4-2） */
const QUALITY_MAX = 0.92
/** 通常の画質の下限。長辺640pxまでは、これより下げずに解像度を下げる */
const QUALITY_MIN = 0.4
/** 目標容量に必ず収めるための、最終的な画質の下限 */
const QUALITY_FLOOR = 0.1
/** 画質の二分探索の回数（約1%刻みまで絞り込める） */
const QUALITY_SEARCH_STEPS = 6
/** 解像度を下げるときの倍率 */
const SCALE_STEP = 0.8
/** ここまでは画質40%を守って解像度を下げる（長辺） */
const MIN_LONG_EDGE = 640
/** 目標容量に必ず収めるために解像度を下げる、最終的な下限（長辺） */
const ABSOLUTE_MIN_LONG_EDGE = 16
/** iPhoneのSafariで扱えるキャンバスの上限（約1,677万画素） */
const MAX_CANVAS_PIXELS = 16_777_216

/**
 * 画像を読み込む。スマホ写真の向き情報（EXIF）はここで反映される。
 */
export async function loadImage(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    // createImageBitmap が使えないブラウザ向け
    const url = URL.createObjectURL(source)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

function sourceSize(src: ImageBitmap | HTMLImageElement) {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height }
}

/** 回転と縮小をかけたキャンバスを作る */
function render(
  src: ImageBitmap | HTMLImageElement,
  rotation: Rotation,
  scale: number,
  fillWhite: boolean,
): HTMLCanvasElement {
  const { w, h } = sourceSize(src)
  const dw = Math.max(1, Math.round(w * scale))
  const dh = Math.max(1, Math.round(h * scale))
  const swap = rotation === 90 || rotation === 270

  const canvas = document.createElement('canvas')
  canvas.width = swap ? dh : dw
  canvas.height = swap ? dw : dh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画像を処理できませんでした（キャンバスを作成できません）。')

  if (fillWhite) {
    // JPEGは透明を扱えないため、透明部分を白で塗る（黒くなるのを防ぐ）
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh)
  return canvas
}

function encode(canvas: HTMLCanvasElement, mime: ImageMime, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('画像の書き出しに失敗しました。'))
        // 対応していない形式を指定すると、ブラウザは黙ってPNGで書き出すため確認する
        if (blob.type !== mime) {
          return reject(
            new Error(`このブラウザは${mime.split('/')[1].toUpperCase()}の書き出しに対応していません。`),
          )
        }
        resolve(blob)
      },
      mime,
      quality,
    )
  })
}

function release(canvas: HTMLCanvasElement) {
  // iPhoneのSafariはキャンバスのメモリをすぐに解放しないため、明示的に小さくする
  canvas.width = 0
  canvas.height = 0
}

/**
 * 一覧表示用の縮小画像（JPEG）を作る。src は解放しない。
 * 回転はかけない（画面上の回転はCSSで表示する）。
 */
export async function makeThumbnail(
  src: ImageBitmap | HTMLImageElement,
  maxEdge = 480,
): Promise<Blob> {
  const { w, h } = sourceSize(src)
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const canvas = render(src, 0, scale, true)
  try {
    return await encode(canvas, 'image/jpeg', 0.8)
  } finally {
    release(canvas)
  }
}

/** 画像の縦横の大きさ（向き情報を反映した後）を調べる */
export async function getImageSize(source: Blob): Promise<{ width: number; height: number }> {
  const src = await loadImage(source)
  const { w, h } = sourceSize(src)
  if ('close' in src) src.close()
  return { width: w, height: h }
}

/**
 * 画質を二分探索し、limit 以下に収まる最も高い画質で書き出す。
 * 最低画質でも収まらなければ null と、その最低画質の結果を返す。
 */
async function searchQuality(
  canvas: HTMLCanvasElement,
  mime: ImageMime,
  limit: number,
  qualityMin = QUALITY_MIN,
): Promise<{ fit: { blob: Blob; quality: number } | null; smallest: Blob }> {
  // まず最高画質で試す（元から小さければ画質を下げずに済む）
  const best = await encode(canvas, mime, QUALITY_MAX)
  if (best.size <= limit) return { fit: { blob: best, quality: QUALITY_MAX }, smallest: best }

  const worst = await encode(canvas, mime, qualityMin)
  if (worst.size > limit) return { fit: null, smallest: worst }

  let lo = qualityMin
  let hi = QUALITY_MAX
  let fit = worst
  for (let i = 0; i < QUALITY_SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2
    const blob = await encode(canvas, mime, mid)
    if (blob.size <= limit) {
      lo = mid
      fit = blob
    } else {
      hi = mid
    }
  }
  return { fit: { blob: fit, quality: lo }, smallest: worst }
}

/**
 * 画像を回転し、目標容量に収まるよう変換する（仕様 4-2）。
 * 0. preferMaxBytes があれば、元の解像度のまま画質の調整だけでその容量以下にできないか試す
 * （11/17 変更: 画質が落ちても目標容量に必ず収める。長辺640pxに達したら画質を10%まで下げ、
 *   それでも収まらなければ解像度をさらに下げ続ける）
 * 1. 元の解像度で、目標容量に収まる最も高い画質を探す（画質は40%まで）
 * 2. 収まらなければ解像度を80%ずつ下げて1を繰り返す（長辺640pxまで）
 * 3. それでも収まらなければ、最も小さくできた結果を返す
 */
export async function convertImage(
  source: Blob | ImageBitmap,
  { rotation, mime, targetBytes, preferMaxBytes }: ImageConvertOptions,
): Promise<ImageConvertOutput> {
  // 読み込み済みの画像（HEICなど）を渡された場合はそのまま使い、最後に解放する
  const src = source instanceof Blob ? await loadImage(source) : source
  try {
    const { w, h } = sourceSize(src)
    const lossy = mime !== 'image/png'
    const fillWhite = mime === 'image/jpeg'
    const longEdge = Math.max(w, h)

    let scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)))
    let smallest: ImageConvertOutput | null = null

    for (let first = true; ; first = false) {
      const canvas = render(src, rotation, scale, fillWhite)
      const out = (blob: Blob, quality: number | null, reachedTarget: boolean): ImageConvertOutput => ({
        blob,
        width: canvas.width,
        height: canvas.height,
        quality,
        reachedTarget,
      })
      const keepSmallest = (blob: Blob, quality: number | null) => {
        if (!smallest || blob.size < smallest.blob.size) smallest = out(blob, quality, false)
      }

      try {
        if (!lossy) {
          const blob = await encode(canvas, mime)
          if (blob.size <= targetBytes) return out(blob, null, true)
          keepSmallest(blob, null)
        } else {
          if (first && preferMaxBytes !== undefined && preferMaxBytes < targetBytes) {
            const preferred = await searchQuality(canvas, mime, preferMaxBytes)
            if (preferred.fit) return out(preferred.fit.blob, preferred.fit.quality, true)
          }
          // 次に解像度を下げると長辺640pxを下回る段階からは、画質を10%まで下げてよい
          const qualityMin = longEdge * scale * SCALE_STEP < MIN_LONG_EDGE ? QUALITY_FLOOR : QUALITY_MIN
          const { fit, smallest: worst } = await searchQuality(canvas, mime, targetBytes, qualityMin)
          if (fit) return out(fit.blob, fit.quality, true)
          keepSmallest(worst, qualityMin)
        }
      } finally {
        release(canvas)
      }

      const nextScale = scale * SCALE_STEP
      if (longEdge * nextScale < ABSOLUTE_MIN_LONG_EDGE) break
      scale = nextScale
    }

    return smallest!
  } finally {
    if ('close' in src) src.close()
  }
}
