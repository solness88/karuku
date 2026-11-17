import { useEffect, useRef, useState } from 'react'
import type { FileItem } from '../types'
import { openPdf, renderPageThumbnail, type OpenedPdf } from '../lib/pdf'

interface Props {
  item: FileItem
  onRotateAll: (id: string, delta: 90 | -90) => void
  onRotatePage: (id: string, page: number, delta: 90 | -90) => void
  onClose: () => void
}

/**
 * PDFの全ページを一覧にして、1ページずつ回転できるダイアログ。
 * ページの縮小画像は、画面に見えたものから順に作る（ページ数が多くても重くならないように）。
 */
export function PageDialog({ item, onRotateAll, onRotatePage, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [thumbs, setThumbs] = useState<(string | null)[]>(() =>
    Array(item.pageCount ?? 0).fill(null),
  )
  const [error, setError] = useState<string | null>(null)
  const pdfRef = useRef<Promise<OpenedPdf> | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const requested = useRef(new Set<number>())
  const urls = useRef<string[]>([])

  // ダイアログを開く・閉じる
  useEffect(() => {
    const d = dialogRef.current
    d?.showModal()
    return () => d?.close()
  }, [])

  // PDFを開き、閉じるときに後片付けをする
  useEffect(() => {
    const opening = openPdf(item.file)
    pdfRef.current = opening
    opening.catch((e) => setError(e instanceof Error ? e.message : 'PDFを読み込めませんでした。'))
    const created = urls.current
    return () => {
      pdfRef.current = null
      opening.then((p) => p.close()).catch(() => {})
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [item.file])

  const requestThumb = (index: number) => {
    if (requested.current.has(index)) return
    requested.current.add(index)
    queue.current = queue.current.then(async () => {
      const opening = pdfRef.current
      if (!opening) return
      try {
        const { doc } = await opening
        const blob = await renderPageThumbnail(doc, index + 1, 320)
        if (pdfRef.current !== opening) return // 途中で閉じられた
        const url = URL.createObjectURL(blob)
        urls.current.push(url)
        setThumbs((prev) => prev.map((t, i) => (i === index ? url : t)))
      } catch {
        // 1ページ描けなくても他のページは続ける
      }
    })
  }

  const total = item.pageCount ?? 0

  return (
    <dialog
      ref={dialogRef}
      className="page-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose() // 背景をクリックしたら閉じる
      }}
      aria-labelledby="page-dialog-title"
    >
      <div className="page-dialog-inner">
        <header className="page-dialog-head">
          <div>
            <h2 id="page-dialog-title">ページごとに回転</h2>
            <p className="page-dialog-file" title={item.file.name}>
              {item.file.name} ・ {total}ページ
            </p>
          </div>
          <div className="page-dialog-all">
            <span>全ページ</span>
            <button type="button" className="icon-btn" onClick={() => onRotateAll(item.id, -90)}
              aria-label="全ページを左に90度回転" title="全ページを左に90度回転">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 1 1 1.5 7" /><path d="M4 4v5h5" /></svg>
            </button>
            <button type="button" className="icon-btn" onClick={() => onRotateAll(item.id, 90)}
              aria-label="全ページを右に90度回転" title="全ページを右に90度回転">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 9a8 8 0 1 0-1.5 7" /><path d="M20 4v5h-5" /></svg>
            </button>
            <button type="button" className="btn-primary btn-small" onClick={onClose}>
              完了
            </button>
          </div>
        </header>

        {error ? (
          <p className="page-dialog-error">{error}</p>
        ) : (
          <ul className="page-grid">
            {Array.from({ length: total }, (_, i) => (
              <PageTile
                key={i}
                index={i}
                thumbUrl={thumbs[i]}
                rotation={(item.rotation + (item.pageRotations[i] ?? 0)) % 360}
                onVisible={requestThumb}
                onRotate={(delta) => onRotatePage(item.id, i, delta)}
              />
            ))}
          </ul>
        )}
      </div>
    </dialog>
  )
}

interface TileProps {
  index: number
  thumbUrl: string | null
  rotation: number
  onVisible: (index: number) => void
  onRotate: (delta: 90 | -90) => void
}

function PageTile({ index, thumbUrl, rotation, onVisible, onRotate }: TileProps) {
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onVisible(index)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [index, onVisible])

  return (
    <li ref={ref} className="page-tile">
      <div className="page-thumb">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{ transform: `rotate(${rotation}deg)` }} draggable={false} />
        ) : (
          <span className="spinner" aria-label="読み込み中" />
        )}
      </div>
      <div className="page-tile-actions">
        <button type="button" className="icon-btn" onClick={() => onRotate(-90)}
          aria-label={`${index + 1}ページ目を左に90度回転`} title="左に90度回転">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 1 1 1.5 7" /><path d="M4 4v5h5" /></svg>
        </button>
        <span className="page-no">
          {index + 1}
          {rotation !== 0 && <small> {rotation}°</small>}
        </span>
        <button type="button" className="icon-btn" onClick={() => onRotate(90)}
          aria-label={`${index + 1}ページ目を右に90度回転`} title="右に90度回転">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 9a8 8 0 1 0-1.5 7" /><path d="M20 4v5h-5" /></svg>
        </button>
      </div>
    </li>
  )
}
