/** 仮の画面。各領域が自分のファイルを置き換えるまでの表示 */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="placeholder">
      <h1>{title}</h1>
      <p>この画面は準備中です。</p>
    </div>
  );
}
