import type { FileItem } from '../types'
import { formatBytes } from '../lib/format'

interface Props {
  items: FileItem[]
  onSaveAll: () => void
  saving: boolean
  disabled: boolean
}

/** 画面下部に固定する「すべて保存（ZIP）」のバー */
export function SaveAllBar({ items, onSaveAll, saving, disabled }: Props) {
  const done = items.filter((i) => i.status === 'done' && i.result)
  if (done.length === 0) return null

  const before = done.reduce((s, i) => s + i.file.size, 0)
  const after = done.reduce((s, i) => s + i.result!.blob.size, 0)
  const unsaved = done.filter((i) => !i.saved).length

  return (
    <div className="save-bar" role="region" aria-label="まとめて保存">
      <div className="save-bar-inner">
        <p className="save-bar-summary">
          <span>変換済み {done.length}件</span>
          <span className="save-bar-size">
            合計 {formatBytes(before)} → <strong>{formatBytes(after)}</strong>
          </span>
          {unsaved > 0 && <span className="save-bar-unsaved">未保存 {unsaved}件</span>}
        </p>
        <button
          // 新しく変換された件数が変わるたびに作り直し、光る動きをもう一度再生する
          key={done.length}
          type="button"
          className={`btn-primary${unsaved > 0 ? ' btn-attention' : ''}`}
          onClick={onSaveAll}
          disabled={disabled || saving}
        >
          {saving ? 'ZIPを作成中…' : 'すべて保存（ZIP）'}
        </button>
      </div>
    </div>
  )
}
