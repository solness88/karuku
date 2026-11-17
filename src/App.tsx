import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvertSettings, FileItem, Rotation, Settings } from './types'
import { detectKind, MAX_FILE_BYTES, MAX_FILES } from './lib/fileKind'
import { formatBytes, targetRangeFor } from './lib/format'
import { convertItem, needsPdfCompression } from './lib/convert'
import { decodeHeic, HeicDecodeError } from './lib/heic'
import { makeThumbnail } from './lib/imageProcess'
import { PdfError, summarizePdf } from './lib/pdf'
import { DropZone } from './components/DropZone'
import { SettingsPanel, type TargetState } from './components/SettingsPanel'
import { FileCard } from './components/FileCard'
import { PageDialog } from './components/PageDialog'
import { CompressWarning, type CompressAnswer } from './components/CompressWarning'
import { SaveAllBar } from './components/SaveAllBar'
import { HowTo } from './components/HowTo'
import { downloadBlob, makeZip, zipFileName } from './lib/zip'
import { loadSettings, saveSettings } from './lib/settingsStore'

const DEFAULT_SETTINGS: Settings = {
  outputFormat: 'auto',
  suffix: '_edited',
}

/** 変換結果を破棄して「未変換」に戻す */
function resetItem(item: FileItem): FileItem {
  if (item.result) URL.revokeObjectURL(item.result.url)
  // 読み込めなかったファイルは、設定を変えても失敗のまま
  if (item.loadError) return { ...item, status: 'error', result: null, saved: false, message: item.loadError }
  if (item.status === 'pending') return item
  return { ...item, status: 'pending', result: null, saved: false, message: null }
}

function revokeAll(item: FileItem) {
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
  if (item.result) URL.revokeObjectURL(item.result.url)
}

/** HEICのサムネイル作成は重いので、1件ずつ順番に行う */
let thumbQueue: Promise<void> = Promise.resolve()

let idCounter = 0
const newId = () => `f${Date.now().toString(36)}${(idCounter++).toString(36)}`

export default function App() {
  const [items, setItems] = useState<FileItem[]>([])
  // 前回の設定を引き継ぐ（このブラウザの中だけに保存）
  const [settings, setSettings] = useState<Settings>(() => loadSettings(DEFAULT_SETTINGS))
  const [zipping, setZipping] = useState(false)
  /** 目標容量を調整する対象として選んでいるファイル（1件だけ） */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notices, setNotices] = useState<string[]>([])
  /** ページ一覧を開いているPDFのid */
  const [pagesFor, setPagesFor] = useState<string | null>(null)
  /** PDF圧縮の確認ダイアログ（表示中なら対象のファイル名と、答えを返す関数） */
  const [confirmState, setConfirmState] = useState<{
    fileNames: string[]
    answer: (choice: CompressAnswer) => void
  } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const busy = progress !== null

  /** スライダーに表示する、選択中のファイルの目標容量 */
  const target = useMemo<TargetState | null>(() => {
    const sel = items.find((i) => i.id === selectedId)
    if (!sel) return null
    return {
      range: targetRangeFor(sel.file.size),
      bytes: sel.targetBytes,
      isOriginal: sel.targetBytes >= sel.file.size,
      fileName: sel.file.name,
    }
  }, [items, selectedId])

  /** 1ファイルを変換するときの設定 */
  const settingsFor = (item: FileItem): ConvertSettings => ({ ...settings, targetBytes: item.targetBytes })

  // 画面を閉じるときにサムネイルと変換結果のURLを解放する
  const itemsRef = useRef(items)
  itemsRef.current = items
  useEffect(() => () => itemsRef.current.forEach(revokeAll), [])

  useEffect(() => saveSettings(settings), [settings])

  // 変換したのに保存していないファイルがあるときは、閉じる・再読み込みの前にブラウザに確認させる
  const hasUnsaved = items.some((i) => i.status === 'done' && !i.saved)
  useEffect(() => {
    if (!hasUnsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // 古いブラウザ向け
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsaved])

  const addFiles = useCallback((files: File[]) => {
    const messages: string[] = []
    const added: FileItem[] = []
    let room = MAX_FILES - itemsRef.current.length

    for (const file of files) {
      const kind = detectKind(file)
      if (!kind) {
        messages.push(`「${file.name}」は対応していない形式です。`)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        messages.push(`「${file.name}」は${formatBytes(file.size)}あり、上限の100MBを超えています。`)
        continue
      }
      if (room <= 0) {
        messages.push(`一度に扱えるのは${MAX_FILES}ファイルまでです。残りのファイルは追加していません。`)
        break
      }
      room -= 1
      // JPG・PNGはブラウザがそのまま表示できる。HEICは読み込んで縮小画像を作る。PDFは後の手順で対応
      const thumbUrl = kind === 'jpeg' || kind === 'png' ? URL.createObjectURL(file) : null
      added.push({
        id: newId(),
        file,
        kind,
        rotation: 0,
        thumbUrl,
        thumbLoading: kind === 'heic' || kind === 'pdf',
        pageCount: null,
        pageRotations: [],
        targetBytes: file.size, // 初期値は「元のまま」（スライダーの右端）
        status: 'pending',
        loadError: null,
        result: null,
        saved: false,
        message: null,
      })
    }

    setNotices(messages)
    if (added.length === 0) return
    itemsRef.current = [...itemsRef.current, ...added]
    setItems((prev) => [...prev, ...added])
    // 追加したファイル（複数なら1件目）を選択した状態にする（そのままスライダーで調整できるように）
    setSelectedId(added[0].id)

    for (const item of added.filter((i) => i.kind === 'heic' || i.kind === 'pdf')) {
      thumbQueue = thumbQueue.then(() => createThumbnail(item))
    }
  }, [])

  /** HEIC・PDFの縮小画像を作る（PDFはページ数も調べる） */
  const createThumbnail = async (item: FileItem) => {
    // 作成前に一覧から外されていたら何もしない
    if (!itemsRef.current.some((i) => i.id === item.id)) return
    let url: string | null = null
    let message: string | null = null
    let pageCount: number | null = null
    try {
      if (item.kind === 'pdf') {
        const summary = await summarizePdf(item.file)
        pageCount = summary.pageCount
        url = URL.createObjectURL(summary.thumbnail)
      } else {
        const bitmap = await decodeHeic(item.file)
        try {
          url = URL.createObjectURL(await makeThumbnail(bitmap))
        } finally {
          bitmap.close()
        }
      }
    } catch (e) {
      message = e instanceof Error ? e.message : 'ファイルを読み込めませんでした。'
    }
    // 作成中に一覧から外されていたら、作った画像を捨てる
    if (!itemsRef.current.some((i) => i.id === item.id)) {
      if (url) URL.revokeObjectURL(url)
      return
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              thumbUrl: url,
              thumbLoading: false,
              ...(pageCount !== null
                ? { pageCount, pageRotations: Array<Rotation>(pageCount).fill(0) }
                : {}),
              // 読み込めないファイルは、変換しても失敗するので先に知らせる
              ...(message ? { status: 'error' as const, message, loadError: message } : {}),
            }
          : i,
      ),
    )
  }

  const rotate = useCallback((id: string, delta: 90 | -90) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...resetItem(i), rotation: ((((i.rotation + delta) % 360) + 360) % 360) as Rotation }
          : i,
      ),
    )
  }, [])

  /** PDFの1ページだけを回転する */
  const rotatePage = useCallback((id: string, page: number, delta: 90 | -90) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        const pageRotations = [...i.pageRotations]
        pageRotations[page] = ((((pageRotations[page] ?? 0) + delta) % 360) + 360) % 360 as Rotation
        return { ...resetItem(i), pageRotations }
      }),
    )
  }, [])

  const remove = useCallback((id: string) => {
    const target = itemsRef.current.find((i) => i.id === id)
    if (target) revokeAll(target)
    itemsRef.current = itemsRef.current.filter((i) => i.id !== id)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setSelectedId((prev) => (prev === id ? null : prev))
  }, [])

  /** カードをクリック: そのファイルを選ぶ（選択は1件だけ）。選択中のカードなら解除する */
  const toggleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }, [])

  /**
   * スライダーを動かしたとき: 選択中のファイルの目標容量を設定する（右端なら「元のまま」）。
   * 目標容量が変わったら「未変換」に戻す
   */
  const changeTarget = (bytes: number, isOriginal: boolean) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== selectedId) return i
        const next = isOriginal ? i.file.size : Math.min(bytes, i.file.size)
        return next === i.targetBytes ? i : { ...resetItem(i), targetBytes: next }
      }),
    )
  }

  const clearAll = () => {
    items.forEach(revokeAll)
    setItems([])
    setSelectedId(null)
    setNotices([])
  }

  const markSaved = useCallback((id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, saved: true } : i)))
  }, [])

  /** 変換済みのファイルをまとめてZIPで保存する */
  const saveAll = async () => {
    const done = itemsRef.current.filter((i) => i.status === 'done' && i.result)
    if (done.length === 0) return
    setZipping(true)
    try {
      // 複数ページのPDF→画像は、ZIPの中にZIPを入れず「ファイル名/」フォルダに展開する
      const entries = done.flatMap((i) => {
        const r = i.result!
        if (!r.parts) return [{ name: r.fileName, blob: r.blob }]
        const folder = r.fileName.replace(/\.zip$/i, '')
        return r.parts.map((p) => ({ name: `${folder}/${p.name}`, blob: p.blob }))
      })
      const zip = await makeZip(entries)
      downloadBlob(zip, zipFileName())
      const ids = new Set(done.map((i) => i.id))
      setItems((prev) => prev.map((i) => (ids.has(i.id) ? { ...i, saved: true } : i)))
    } catch (e) {
      console.error(e)
      setNotices(['ZIPを作成できませんでした。1件ずつ保存してください。'])
    } finally {
      setZipping(false)
    }
  }

  /** 設定を変えたら、変換済みのものは「未変換」に戻す（仕様 4-4） */
  const changeSettings = (next: Settings) => {
    setSettings(next)
    setItems((prev) => prev.map(resetItem))
  }

  const patchItem = (id: string, patch: Partial<FileItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  /** 「変換」ボタン: 未変換・失敗のファイルを1件ずつ順に変換する */
  const convert = async () => {
    const targets = itemsRef.current.filter(
      (i) => !i.loadError && (i.status === 'pending' || i.status === 'error'),
    )
    if (targets.length === 0) {
      const anyDone = itemsRef.current.some((i) => i.status === 'done')
      setNotices([
        anyDone
          ? 'すべて変換済みです。設定や回転を変えると、もう一度変換できます。'
          : '変換できるファイルがありません。',
      ])
      return
    }

    // 目標容量を超えるPDFがあれば、画像化して圧縮してよいか先に確認する（仕様 4-3）
    let allowPdfCompression = false
    const oversizedPdfs = targets.filter((i) => needsPdfCompression(i, settingsFor(i)))
    if (oversizedPdfs.length > 0) {
      const choice = await new Promise<CompressAnswer>((resolve) =>
        setConfirmState({ fileNames: oversizedPdfs.map((i) => i.file.name), answer: resolve }),
      )
      setConfirmState(null)
      if (choice === 'cancel') return
      allowPdfCompression = choice === 'compress'
    }

    setNotices([])
    setProgress({ done: 0, total: targets.length })

    let missed = 0
    for (const [n, item] of targets.entries()) {
      patchItem(item.id, { status: 'processing', message: null })
      // 画面の更新を挟んでから重い処理に入る
      await new Promise((r) => setTimeout(r, 0))
      try {
        const result = await convertItem(item, settingsFor(item), {
          allowPdfCompression,
          onProgress: (text) => patchItem(item.id, { message: text }),
        })
        if (!result.reachedTarget) missed += 1
        patchItem(item.id, { status: 'done', result, message: null })
      } catch (e) {
        // 壊れたファイルなど想定内の失敗は画面に出すだけにする
        if (!(e instanceof HeicDecodeError || e instanceof PdfError)) console.error(e)
        patchItem(item.id, {
          status: 'error',
          message: e instanceof Error ? e.message : '変換に失敗しました。',
        })
      }
      setProgress({ done: n + 1, total: targets.length })
    }

    setProgress(null)
    if (missed > 0) {
      setNotices([`${missed}件は目標容量に届きませんでした。理由は各ファイルの表示をご確認ください。`])
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
          <span className="brand-name">Karuku</span>
        </div>
        <p className="privacy">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 018 0v3" />
          </svg>
          ファイルはこの端末から出ません
        </p>
      </header>

      <main className="main">
        <DropZone onFiles={addFiles} compact={items.length > 0} />
        {items.length === 0 && <HowTo />}

        {notices.length > 0 && (
          <div className="notices" role="status">
            {notices.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
            <button type="button" className="link-btn" onClick={() => setNotices([])}>閉じる</button>
          </div>
        )}

        <SettingsPanel
          settings={settings}
          onChange={changeSettings}
          onConvert={convert}
          canConvert={items.length > 0 && !busy}
          progress={progress}
          target={target}
          onTargetChange={changeTarget}
          hasItems={items.length > 0}
        />

        {items.length > 0 && (
          <section aria-label="追加したファイル">
            <div className="list-head">
              <h2>ファイル <span className="count">{items.length}</span></h2>
              <button type="button" className="link-btn" onClick={clearAll} disabled={busy}>
                すべて外す
              </button>
            </div>
            <ul className="grid">
              {items.map((item) => (
                <FileCard
                  key={item.id}
                  item={item}
                  onRotate={rotate}
                  onRemove={remove}
                  onOpenPages={setPagesFor}
                  onSaved={markSaved}
                  selected={item.id === selectedId}
                  onToggleSelect={toggleSelect}
                  locked={busy}
                />
              ))}
            </ul>
          </section>
        )}
      </main>

      <SaveAllBar items={items} onSaveAll={saveAll} saving={zipping} disabled={busy} />

      {confirmState && (
        <CompressWarning fileNames={confirmState.fileNames} onAnswer={confirmState.answer} />
      )}

      {pagesFor &&
        (() => {
          const item = items.find((i) => i.id === pagesFor)
          return item ? (
            <PageDialog
              item={item}
              onRotateAll={rotate}
              onRotatePage={rotatePage}
              onClose={() => setPagesFor(null)}
            />
          ) : null
        })()}

      <footer className="footer">
        変換はすべてお使いのブラウザの中で行われます。元のファイルは変更されません。
      </footer>
    </div>
  )
}
