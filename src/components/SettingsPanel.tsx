import type { OutputFormat, Settings } from '../types'
import { bytesToSlider, formatBytes, SLIDER_STEPS, sliderToBytes, type TargetRange } from '../lib/format'

interface Props {
  settings: Settings
  onChange: (next: Settings) => void
  onConvert: () => void
  canConvert: boolean
  progress: { done: number; total: number } | null
  /** 選択中のファイルの目標容量。選択がなければ null */
  target: TargetState | null
  onTargetChange: (bytes: number, isOriginal: boolean) => void
  hasItems: boolean
}

/** 選択中の1ファイルの目標容量 */
export interface TargetState {
  /** スライダーの範囲（右端 = そのファイルの元のサイズ） */
  range: TargetRange
  bytes: number
  /** 「元のまま」か */
  isOriginal: boolean
  fileName: string
}

const FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: 'auto', label: '元の形式に合わせる（HEICはJPEG）' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'pdf', label: 'PDF' },
]

export function SettingsPanel({
  settings,
  onChange,
  onConvert,
  canConvert,
  progress,
  target,
  onTargetChange,
  hasItems,
}: Props) {
  const range = target?.range ?? null
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <fieldset className="settings" aria-label="変換の設定" disabled={progress !== null}>
      <div className="setting setting-target">
        <div className="target-head">
          <label htmlFor="target" className="setting-label">
            目標容量
            {target && <span className="target-scope">：{target.fileName}</span>}
          </label>
        </div>
        <div className="target-row">
          <span className="target-edge">{range ? formatBytes(range.min) : '—'}</span>
          <input
            id="target"
            type="range"
            min={0}
            max={SLIDER_STEPS}
            disabled={!target}
            value={target ? (target.isOriginal ? SLIDER_STEPS : bytesToSlider(target.bytes, target.range)) : SLIDER_STEPS}
            onChange={(e) => {
              if (!range) return
              const pos = Number(e.target.value)
              onTargetChange(sliderToBytes(pos, range), pos >= SLIDER_STEPS)
            }}
          />
          <span className="target-edge">{range ? `${formatBytes(range.max)}（元）` : '—'}</span>
          <output htmlFor="target" className="target-value">
            {!target ? '—' : target.isOriginal ? '元のまま' : formatBytes(target.bytes)}
          </output>
        </div>
        <p className="setting-hint">
          {!hasItems
            ? 'ファイルを追加すると選べます。'
            : !target
              ? '容量を調整するファイルをクリックして選んでください。'
              : '右端が元のサイズです。左に動かすほど小さくなります。ほかのファイルを調整するときは、そのカードをクリックしてください。'}
        </p>
      </div>

      <div className="setting">
        <label htmlFor="format" className="setting-label">出力形式</label>
        <select
          id="format"
          value={settings.outputFormat}
          onChange={(e) => set('outputFormat', e.target.value as OutputFormat)}
        >
          {FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>


      <div className="setting">
        <label htmlFor="suffix" className="setting-label">ファイル名の末尾</label>
        <input
          id="suffix"
          type="text"
          value={settings.suffix}
          maxLength={30}
          spellCheck={false}
          onChange={(e) => set('suffix', e.target.value)}
        />
      </div>

      <div className="setting setting-action">
        <button type="button" className="btn-primary" onClick={onConvert} disabled={!canConvert}>
          {progress ? `変換中… ${progress.done}/${progress.total}` : '変換'}
        </button>
      </div>
    </fieldset>
  )
}
