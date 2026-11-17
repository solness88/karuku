import type { FileItem } from '../types'
import { KIND_LABEL } from '../lib/fileKind'
import { formatBytes } from '../lib/format'

interface Props {
  item: FileItem
  onRotate: (id: string, delta: 90 | -90) => void
  onRemove: (id: string) => void
  onOpenPages: (id: string) => void
  onSaved: (id: string) => void
  /** 目標容量を調整する対象として選ばれているか */
  selected: boolean
  onToggleSelect: (id: string) => void
  /** 変換中は操作できないようにする */
  locked: boolean
}

function StatusLine({ item }: { item: FileItem }) {
  const original = formatBytes(item.file.size)

  switch (item.status) {
    case 'processing':
      return (
        <>
          <p className="card-meta">
            <span>{original}</span>
            <span className="status status-processing"><span className="spinner" />変換中</span>
          </p>
          {item.message && <p className="card-sub">{item.message}</p>}
        </>
      )
    case 'done': {
      const r = item.result!
      const diff = Math.round((1 - r.blob.size / item.file.size) * 100)
      return (
        <>
          <p className="card-meta">
            <span className="size-change">
              {original} → <strong>{formatBytes(r.blob.size)}</strong>
            </span>
            <span className={`status ${diff > 0 ? 'status-done' : 'status-neutral'}`}>
              {diff > 0 ? `-${diff}%` : diff < 0 ? `+${-diff}%` : '±0%'}
            </span>
          </p>
          <p className="card-sub">
            {r.width > 0 ? `${r.width}×${r.height}` : 'PDF'}
            {r.method === 'original' && ' ・画質そのまま'}
            {r.note && ` ・${r.note}`}
            {!r.reachedTarget && <span className="warn-text"> ・目標容量に届かず</span>}
          </p>
        </>
      )
    }
    case 'error':
      return (
        <>
          <p className="card-meta">
            <span>{original}</span>
            <span className="status status-error">失敗</span>
          </p>
          <p className="card-sub">{item.message}</p>
        </>
      )
    default:
      return (
        <p className="card-meta">
          <span>{original}</span>
          <span className="status status-pending">未変換</span>
        </p>
      )
  }
}

function rotationLabel(item: FileItem): string {
  const base = item.rotation === 0 ? '回転なし' : `${item.rotation}°`
  return item.pageRotations.some((r) => r !== 0) ? `${base}＋ページ別` : base
}

export function FileCard({
  item,
  onRotate,
  onRemove,
  onOpenPages,
  onSaved,
  selected,
  onToggleSelect,
  locked,
}: Props) {
  const isOriginal = item.targetBytes >= item.file.size
  return (
    <li
      className={`card${item.status === 'processing' ? ' is-processing' : ''}${selected ? ' is-selected' : ''}`}
      onClick={(e) => {
        // ボタンやリンクを押したときは選択を切り替えない
        if ((e.target as HTMLElement).closest('button, a')) return
        onToggleSelect(item.id)
      }}
    >
      <div className="thumb">
        {item.thumbLoading ? (
          <div className="thumb-placeholder">
            <span className="thumb-loading"><span className="spinner" />読み込み中</span>
          </div>
        ) : item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt=""
            style={{ transform: `rotate(${item.rotation}deg)` }}
            draggable={false}
          />
        ) : (
          <div className="thumb-placeholder" style={{ transform: `rotate(${item.rotation}deg)` }}>
            <span>{KIND_LABEL[item.kind]}</span>
          </div>
        )}
        <button
          type="button"
          className="select-toggle"
          aria-pressed={selected}
          aria-label={`${item.file.name} の目標容量を調整する`}
          title={selected ? '選択を外す' : 'このファイルの容量を調整する'}
          onClick={() => onToggleSelect(item.id)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
        </button>
        <span className={`badge badge-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
        {item.status === 'done' && item.result && (
          // 保存ボタンはサムネイルに重ねて置く（カードの下側だと画面外に隠れることがあるため）
          <a
            className={`thumb-save${item.saved ? ' is-saved' : ''}`}
            href={item.result.url}
            download={item.result.fileName}
            title={`${item.result.fileName} を保存`}
            onClick={() => onSaved(item.id)}
          >
            {item.saved ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5" />
                <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
              </svg>
            )}
            {item.saved ? '保存済み' : '保存'}
          </a>
        )}
        <button
          type="button"
          className="icon-btn remove-btn"
          onClick={() => onRemove(item.id)}
          disabled={locked}
          aria-label={`${item.file.name} を一覧から外す`}
          title="一覧から外す"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="card-body">
        <p className="card-name" title={item.file.name}>{item.file.name}</p>
        <p className={`card-target${isOriginal ? '' : ' is-set'}`}>
          目標 {isOriginal ? '元のまま' : formatBytes(item.targetBytes)}
        </p>
        {item.pageCount !== null && <p className="card-sub">{item.pageCount}ページ</p>}
        <StatusLine item={item} />
        <div className="card-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRotate(item.id, -90)}
            disabled={locked}
            aria-label="左に90度回転"
            title="左に90度回転"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9a8 8 0 1 1 1.5 7" />
              <path d="M4 4v5h5" />
            </svg>
          </button>
          <span className="rotation-label" aria-live="polite">
            {rotationLabel(item)}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRotate(item.id, 90)}
            disabled={locked}
            aria-label="右に90度回転"
            title="右に90度回転"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 9a8 8 0 1 0-1.5 7" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
        </div>
        {item.kind === 'pdf' && item.pageCount !== null && item.pageCount > 1 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onOpenPages(item.id)}
            disabled={locked}
          >
            ページごとに回転
          </button>
        )}
      </div>
    </li>
  )
}
