/** ファイル名に使えない文字を取り除く */
export function sanitizeSuffix(suffix: string): string {
  // eslint-disable-next-line no-control-regex
  return suffix.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
}

/** 元の名前の末尾に文字を付け、拡張子を差し替える。例: receipt.heic → receipt_edited.jpg */
export function outputFileName(original: string, suffix: string, ext: string): string {
  const dot = original.lastIndexOf('.')
  const base = dot > 0 ? original.slice(0, dot) : original
  return `${base}${sanitizeSuffix(suffix)}.${ext}`
}
