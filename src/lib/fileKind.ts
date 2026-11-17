import type { FileKind } from '../types'

export const MAX_FILE_BYTES = 100 * 1024 * 1024
export const MAX_FILES = 50

export const ACCEPT_ATTR =
  '.jpg,.jpeg,.png,.heic,.heif,.pdf,image/jpeg,image/png,image/heic,image/heif,application/pdf'

/** MIMEタイプと拡張子からファイルの種類を判定する。対応外は null */
export function detectKind(file: File): FileKind | null {
  const type = file.type.toLowerCase()
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (type === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (type === 'image/png' || ext === 'png') return 'png'
  // HEICは端末によってMIMEタイプが空のことがあるため拡張子も見る
  if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic'
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf'
  return null
}

export const KIND_LABEL: Record<FileKind, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  heic: 'HEIC',
  pdf: 'PDF',
}
