/** バイト数を「1.2MB」「340KB」のような表示にする */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`
}

/*
 * 目標容量スライダー（仕様 4-2, 11/17 変更）
 * 右端 = 読み込んだファイルのうち最大の容量（＝元のサイズ）。そこから左に動かして小さくするだけ。
 * 左端 = 50KB（ファイルがとても小さい場合は、右端の1/10）。
 * 目盛りは対数（小さい容量も細かく選べるように）。
 */
export const SLIDER_STEPS = 1000
const DEFAULT_MIN = 50 * 1024

export interface TargetRange {
  min: number
  max: number
}

export function targetRangeFor(maxFileBytes: number): TargetRange {
  const max = Math.max(1024, maxFileBytes)
  const min = Math.min(DEFAULT_MIN, Math.floor(max / 10))
  return { min, max }
}

export function sliderToBytes(pos: number, { min, max }: TargetRange): number {
  // 右端はちょうど元のサイズ（丸めない）
  if (pos >= SLIDER_STEPS) return max
  const raw = min * Math.pow(max / min, pos / SLIDER_STEPS)
  return Math.min(max, Math.max(min, roundNice(raw)))
}

export function bytesToSlider(bytes: number, { min, max }: TargetRange): number {
  if (max <= min) return SLIDER_STEPS
  const clamped = Math.min(max, Math.max(min, bytes))
  return Math.round((Math.log(clamped / min) / Math.log(max / min)) * SLIDER_STEPS)
}

/** 表示しやすいキリのよい値に丸める（例: 1,037KB → 1.0MB） */
function roundNice(bytes: number): number {
  const kb = bytes / 1024
  if (kb < 20) return Math.max(1, Math.round(kb)) * 1024
  if (kb < 100) return Math.round(kb / 5) * 5 * 1024
  if (kb < 1024) return Math.round(kb / 10) * 10 * 1024
  const mb = kb / 1024
  return (Math.round(mb * 10) / 10) * 1024 * 1024
}
