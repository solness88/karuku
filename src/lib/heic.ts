/**
 * HEIC（iPhoneの写真形式）を読み込む。
 *
 * 1. まずブラウザの標準機能で読む（Safariは標準でHEICに対応）。
 *    拡張子だけ .heic で中身がJPEGのファイルも、ここで読める。
 * 2. 読めなければ、同梱の heic-to（libheif）で読む。
 *    約3MBあるため、HEICが追加されたときに初めて読み込む。
 *
 * どちらの方法でも、ファイルが外部に送られることはない。
 * 写真の向き（iPhoneが記録する回転情報）はどちらの方法でも反映される。
 */

type HeicModule = typeof import('heic-to/csp')
let heicModule: Promise<HeicModule> | null = null

function loadHeicModule(): Promise<HeicModule> {
  heicModule ??= import('heic-to/csp').catch((e) => {
    heicModule = null // 読み込みに失敗したら次回やり直す
    throw e
  })
  return heicModule
}

export class HeicDecodeError extends Error {}

/** HEICを画像として読み込む。呼び出し側で使い終わったら close() する */
export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // 標準機能では読めない（Chrome・Edge・Firefoxなど）
  }

  let mod: HeicModule
  try {
    mod = await loadHeicModule()
  } catch {
    throw new HeicDecodeError('HEICの読み込み機能を準備できませんでした。ページを再読み込みしてください。')
  }

  try {
    return await mod.heicTo({ blob: file, type: 'bitmap' })
  } catch {
    throw new HeicDecodeError('HEICとして読み込めませんでした。ファイルが壊れている可能性があります。')
  }
}
