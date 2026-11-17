/**
 * 変換結果をまとめて1つのZIPにする。
 * JPEG・PDFなどはすでに圧縮されているため、ZIPでは圧縮せず格納だけ行う（速く、容量もほぼ変わらない）。
 */
import { zipSync } from 'fflate'

export interface ZipEntry {
  name: string
  blob: Blob
}

/** 同じ名前が重複したら「名前 (2).jpg」のように番号を付ける */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase())
      return name
    }
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${ext}`
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase())
        return candidate
      }
    }
  })
}

export async function makeZip(entries: ZipEntry[]): Promise<Blob> {
  const names = uniqueNames(entries.map((e) => e.name))
  const files: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {}
  const now = new Date()
  for (const [i, e] of entries.entries()) {
    files[names[i]] = [new Uint8Array(await e.blob.arrayBuffer()), { level: 0, mtime: now }]
  }
  const data = zipSync(files)
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

/** 例: Karuku_20261117_1530.zip */
export function zipFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Karuku_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}.zip`
}

/** ブラウザに保存させる */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 保存処理が始まるまで少し待ってから解放する
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
