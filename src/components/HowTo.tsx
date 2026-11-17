/** ファイルを追加する前に表示する使い方の案内 */
export function HowTo() {
  const steps = [
    { title: 'ファイルを追加', body: 'PDF・JPG・PNG・HEICを、ドロップするか選んで追加します。' },
    { title: '向きと容量を決める', body: '回転ボタンで向きを直し、目標容量をスライダーで選びます。' },
    { title: '変換', body: '「変換」を押すと、目標容量に収まるよう自動で調整します。' },
    { title: '保存', body: '1件ずつ、または「すべて保存（ZIP）」でまとめて保存します。' },
  ]
  return (
    <section className="howto" aria-labelledby="howto-title">
      <h2 id="howto-title" className="visually-hidden">使い方</h2>
      <ol className="howto-steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="howto-num">{i + 1}</span>
            <div>
              <p className="howto-title">{s.title}</p>
              <p className="howto-body">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="howto-privacy">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <div>
          <p className="howto-title">ファイルはどこにも送信されません</p>
          <p className="howto-body">
            変換はすべて、お使いのブラウザの中で行われます。ファイルがサーバーに送られることはなく、
            ページを閉じると読み込んだファイルも変換結果も消えます。元のファイルは変更されません。
          </p>
        </div>
      </div>
    </section>
  )
}
