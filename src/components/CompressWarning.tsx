import { useEffect, useRef } from 'react'

/** compress: 画像化して圧縮 / rotate: 圧縮せず回転のみ / cancel: 変換をやめる */
export type CompressAnswer = 'compress' | 'rotate' | 'cancel'

interface Props {
  /** 目標容量を超えるPDFのファイル名 */
  fileNames: string[]
  onAnswer: (answer: CompressAnswer) => void
}

/** 目標容量を超えるPDFを、画像化して圧縮してよいかの確認（仕様 4-3） */
export function CompressWarning({ fileNames, onAnswer }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const d = ref.current
    d?.showModal()
    cancelRef.current?.focus() // 誤って続行しないよう、最初は「キャンセル」を選んだ状態にする
    return () => d?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onAnswer('cancel')
      }}
      aria-labelledby="compress-title"
      aria-describedby="compress-desc"
    >
      <div className="confirm-inner">
        <div className="confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18v.01" />
          </svg>
        </div>
        <h2 id="compress-title">PDFを画像にして圧縮しますか？</h2>
        <div id="compress-desc">
          <p>
            次の{fileNames.length}件のPDFは目標容量を超えています。
            圧縮すると各ページを画像に変換して作り直すため、次のことが<strong>できなくなります</strong>。
          </p>
          <ul className="confirm-list">
            <li>文字の選択・コピー・検索</li>
            <li>リンクのクリック、しおり（目次）</li>
            <li>フォームへの入力、電子署名の確認</li>
          </ul>
          <ul className="confirm-files">
            {fileNames.map((n) => (
              <li key={n} title={n}>{n}</li>
            ))}
          </ul>
          <p className="confirm-note">
            「圧縮せず回転のみ」を選ぶと、PDFは画質も容量もそのままで回転だけ行います。元のファイルは変更されません。
          </p>
        </div>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn-text" onClick={() => onAnswer('cancel')}>
            キャンセル
          </button>
          <button type="button" className="btn-secondary btn-lg" onClick={() => onAnswer('rotate')}>
            圧縮せず回転のみ
          </button>
          <button type="button" className="btn-primary btn-lg" onClick={() => onAnswer('compress')}>
            圧縮して変換
          </button>
        </div>
      </div>
    </dialog>
  )
}
