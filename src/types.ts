export type FileKind = 'jpeg' | 'png' | 'heic' | 'pdf'

/** 時計回りの回転角度 */
export type Rotation = 0 | 90 | 180 | 270

/**
 * pending: 未変換（設定や回転を変えた後もこの状態に戻る）
 * processing: 変換中
 * done: 変換済み
 * error: 失敗
 */
export type ItemStatus = 'pending' | 'processing' | 'done' | 'error'

export interface ConvertResult {
  blob: Blob
  url: string
  fileName: string
  width: number
  height: number
  /** 目標容量に収まったか */
  reachedTarget: boolean
  /** reencode: 画像を作り直した / original: 画質を変えずに処理した（情報の削除・PDFの回転） */
  method: 'reencode' | 'original'
  /** カードに添える補足（PDFの圧縮結果など） */
  note?: string
  /**
   * 複数のファイルに分かれた場合の中身（複数ページのPDF→画像）。
   * blob はこれをまとめたZIP。「すべて保存」では、ZIPの中にZIPを入れず、これをフォルダに展開する
   */
  parts?: { name: string; blob: Blob }[]
}

export interface FileItem {
  id: string
  file: File
  kind: FileKind
  rotation: Rotation
  /** 一覧表示用のサムネイル（object URL）。PDFは後の手順で対応 */
  thumbUrl: string | null
  /** サムネイルを作成中（HEIC・PDFは読み込みに時間がかかるため） */
  thumbLoading: boolean
  /** PDFのページ数（PDF以外・読み込み前は null） */
  pageCount: number | null
  /**
   * PDFのページごとの追加回転（時計回り）。rotation（全ページ共通）に足して使う。
   * 長さはページ数と同じ。PDF以外は空。
   */
  pageRotations: Rotation[]
  /** このファイルの目標容量（バイト）。初期値は元のサイズ（＝「元のまま」） */
  targetBytes: number
  status: ItemStatus
  /** 読み込みの時点で失敗した理由（壊れたファイル・パスワード付きPDFなど）。変換もできない */
  loadError: string | null
  result: ConvertResult | null
  /** 変換結果を保存したか（個別保存・ZIP保存のどちらか）。閉じるときの警告に使う */
  saved: boolean
  message: string | null
}

export type OutputFormat = 'auto' | 'jpeg' | 'png' | 'webp' | 'pdf'

/** 全ファイル共通の設定 */
export interface Settings {
  outputFormat: OutputFormat
  /** 出力ファイル名の末尾に付ける文字 */
  suffix: string
}

/** 1ファイルを変換するときの設定（共通の設定 ＋ そのファイルの目標容量） */
export interface ConvertSettings extends Settings {
  targetBytes: number
}
