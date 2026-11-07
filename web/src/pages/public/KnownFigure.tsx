import type { KnownFigure } from "./knownFindings";

/**
 * 知見の本文の数を図にする（設計書 2026-11-06-public-known-redesign §6）。
 * share: whole 個のます目のうち part 個を塗る（同じ分母の記録）。groups: 比べた農場の数を棒の長さで並べる。
 * 数字は図の横に文字でも書く。色だけで意味を持たせない。
 */
export function KnownFigureView({ figure }: { figure: KnownFigure }) {
  if (figure.kind === "share") {
    const { part, whole, caption } = figure;
    return (
      <figure className="known-figure" data-figure="share">
        <div className="known-share" role="img" aria-label={`${whole} 事例のうち ${part} 事例`}>
          {Array.from({ length: whole }, (_, i) => (
            <span key={i} className={i < part ? "on" : "off"} />
          ))}
        </div>
        <p className="known-share-legend">
          1 マスが 1 事例です（全 {whole} マス）。塗ったマスが当てはまる {part} 事例、白いマスがそれ以外です。
        </p>
        <figcaption>
          <strong className="known-share-count">
            {part} / {whole} 事例
          </strong>{" "}
          {caption}
        </figcaption>
      </figure>
    );
  }
  const max = Math.max(1, ...figure.groups.flatMap((g) => g.bars.map((b) => b.count)));
  return (
    <figure className="known-figure" data-figure="groups">
      <figcaption>{figure.caption}</figcaption>
      {figure.groups.map((g) => (
        <div key={g.name} className="known-group">
          <p className="known-group-name">{g.name}</p>
          <ul>
            {g.bars.map((b) => (
              <li key={b.label}>
                <span className="known-bar-label">{b.label}</span>
                <span className="known-bar-track" aria-hidden="true">
                  <span className="known-bar" style={{ width: `${(b.count / max) * 100}%` }} />
                </span>
                <span className="known-bar-count">{b.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </figure>
  );
}
