/**
 * 設定（出力形式・ファイル名の末尾）を、このブラウザの中だけに保存する。
 * 目標容量はファイルごとに決めるため保存しない。
 * ファイルそのものは保存しない。保存できない環境（プライベートブラウズなど）では何もしない。
 */
import type { OutputFormat, Settings } from '../types'

const KEY = 'karuku:settings:v1'
const FORMATS: OutputFormat[] = ['auto', 'jpeg', 'png', 'webp', 'pdf']

export function loadSettings(defaults: Settings): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults
    const v = JSON.parse(raw) as Partial<Settings>
    return {
      ...defaults,
      outputFormat: FORMATS.includes(v.outputFormat as OutputFormat)
        ? (v.outputFormat as OutputFormat)
        : defaults.outputFormat,
      suffix: typeof v.suffix === 'string' && v.suffix.length <= 30 ? v.suffix : defaults.suffix,
    }
  } catch {
    return defaults
  }
}

export function saveSettings({ outputFormat, suffix }: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ outputFormat, suffix }))
  } catch {
    // 保存できなくても動作には影響しない
  }
}
