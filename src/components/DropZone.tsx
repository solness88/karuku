import { useEffect, useRef, useState } from 'react'
import { ACCEPT_ATTR } from '../lib/fileKind'

interface Props {
  onFiles: (files: File[]) => void
  compact: boolean
}

/**
 * ファイルの追加口。ページのどこにドロップしても受け付ける
 * （誤ってドロップしたときにブラウザがファイルを開いてしまうのを防ぐため）。
 */
export function DropZone({ onFiles, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current += 1
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) onFiles(files)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [onFiles])

  return (
    <>
      <button
        type="button"
        className={`dropzone${dragging ? ' is-dragging' : ''}${compact ? ' is-compact' : ''}`}
        onClick={() => inputRef.current?.click()}
      >
        <svg className="dropzone-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5" />
          <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
        </svg>
        <span className="dropzone-main">
          {compact ? 'ファイルを追加' : 'ここにファイルをドロップ'}
        </span>
        {!compact && (
          <span className="dropzone-sub">
            またはクリックして選択 ・ PDF / JPG / PNG / HEIC
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = '' // 同じファイルを再度選べるようにする
        }}
      />
      {dragging && <div className="drop-overlay" aria-hidden="true">ドロップして追加</div>}
    </>
  )
}
