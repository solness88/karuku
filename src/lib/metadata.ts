/**
 * 画像を作り直さずに、撮影情報（EXIF・XMP・コメントなど）だけを取り除く。
 * 画質は一切変わらない。
 *
 * 向き情報（EXIFのOrientation）が「そのまま」以外の画像は、情報を消すと
 * 表示の向きが変わってしまうため対象外とし、null を返す。
 * 形式が壊れているなど解析できない場合も null を返す（呼び出し側で作り直す）。
 */
export async function stripMetadata(file: Blob, kind: 'jpeg' | 'png'): Promise<Blob | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const parts = kind === 'jpeg' ? stripJpeg(bytes) : stripPng(bytes)
    if (!parts) return null
    return new Blob(parts, { type: kind === 'jpeg' ? 'image/jpeg' : 'image/png' })
  } catch {
    return null
  }
}

/* ---------- JPEG ---------- */

// 残すAPPセグメント: APP0(JFIF), APP2(ICCカラープロファイル), APP14(Adobe: 色の解釈に必要)
const JPEG_KEEP_APP = new Set([0xe0, 0xe2, 0xee])

function stripJpeg(b: Uint8Array): Uint8Array<ArrayBuffer>[] | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  const out: Uint8Array<ArrayBuffer>[] = [b.subarray(0, 2) as Uint8Array<ArrayBuffer>]
  let pos = 2

  while (pos < b.length) {
    if (b[pos] !== 0xff) return null
    let m = pos + 1
    while (b[m] === 0xff) m++ // 埋め草の0xFFを飛ばす
    const marker = b[m]
    const segStart = pos

    if (marker === 0xda) {
      // 画像データ本体（SOS以降）はそのまま残す
      out.push(b.subarray(segStart) as Uint8Array<ArrayBuffer>)
      return out
    }
    if (marker === 0xd9) return null // 画像データの前に終わっている
    const len = (b[m + 1] << 8) | b[m + 2]
    const segEnd = m + 1 + len
    if (len < 2 || segEnd > b.length) return null

    const isApp = marker >= 0xe0 && marker <= 0xef
    if (marker === 0xe1) {
      const orientation = readExifOrientation(b.subarray(m + 3, segEnd), true)
      if (orientation !== null && orientation !== 1) return null
    } else if (marker === 0xfe || (isApp && !JPEG_KEEP_APP.has(marker))) {
      // コメント・その他のAPPセグメントは捨てる
    } else {
      out.push(b.subarray(segStart, segEnd) as Uint8Array<ArrayBuffer>)
    }
    pos = segEnd
  }
  return null
}

/* ---------- PNG ---------- */

// 捨てるチャンク: EXIF、テキスト（作成ソフトや説明文など）、更新日時
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function stripPng(b: Uint8Array): Uint8Array<ArrayBuffer>[] | null {
  if (!PNG_SIG.every((v, i) => b[i] === v)) return null
  const out: Uint8Array<ArrayBuffer>[] = [b.subarray(0, 8) as Uint8Array<ArrayBuffer>]
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = 8

  while (pos + 12 <= b.length) {
    const len = view.getUint32(pos)
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7])
    const end = pos + 12 + len
    if (end > b.length) return null

    if (type === 'eXIf') {
      const orientation = readExifOrientation(b.subarray(pos + 8, pos + 8 + len), false)
      if (orientation !== null && orientation !== 1) return null
    } else if (!PNG_DROP.has(type)) {
      out.push(b.subarray(pos, end) as Uint8Array<ArrayBuffer>)
    }
    pos = end
    if (type === 'IEND') return out
  }
  return null
}

/* ---------- EXIF ---------- */

/**
 * EXIFから向き情報（Orientation, タグ0x0112）を読む。見つからなければ null。
 * JPEGのAPP1は先頭に "Exif\0\0" が付き、PNGのeXIfは付かない。
 */
function readExifOrientation(data: Uint8Array, hasHeader: boolean): number | null {
  let t = 0
  if (hasHeader) {
    const header = String.fromCharCode(...data.subarray(0, 4))
    if (header !== 'Exif') return null // XMPなど、EXIF以外のAPP1
    t = 6
  }
  if (data.length < t + 8) return null
  const view = new DataView(data.buffer, data.byteOffset + t, data.byteLength - t)
  const order = view.getUint16(0)
  const le = order === 0x4949 // "II" = リトルエンディアン
  if (!le && order !== 0x4d4d) return null
  const ifd = view.getUint32(4, le)
  if (ifd + 2 > view.byteLength) return null
  const count = view.getUint16(ifd, le)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) return null
    if (view.getUint16(entry, le) === 0x0112) return view.getUint16(entry + 8, le)
  }
  return null
}
