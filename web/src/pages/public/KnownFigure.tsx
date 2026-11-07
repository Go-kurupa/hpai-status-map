import type { KnownFigure } from "./knownFindings";

/**
 * 知見の本文の数を図にする（設計書 2026-11-06-public-known-redesign §6）。
 * share: whole 事例のうち part 事例の内訳を 1 本の帯で示す（同じ分母の記録）。groups: 比べた農場の数を棒の長さで並べる。
 * 数字は図の横に文字でも書く。色だけで意味を持たせない。
 */
export function KnownFigureView({ figure }: { figure: KnownFigure }) {
  if (figure.kind === "share") {
    // 1 本の帯で内訳を示す（2026-11-07 作者の決定 案 A）。見出しで分母を先に言い、数は帯の下に文字でも書く。
    // 2 / 24 のように細い区切りもあるので、数は帯の中に入れない。説明は数を先に置く（スマホで「8 / 事例」と折らない）
    const { part, whole, title, partLabel, restLabel } = figure;
    return (
      <figure className="known-figure" data-figure="share">
        <figcaption className="known-share-title">{title}</figcaption>
        <div className="known-share" role="img" aria-label={`${whole} 事例のうち、${partLabel} ${part} 事例、${restLabel} ${whole - part} 事例`}>
          <span className="on" style={{ flexGrow: part }} />
          <span className="off" style={{ flexGrow: whole - part }} />
        </div>
        <ul className="known-share-legend" aria-hidden="true">
          <li>
            <span className="known-share-swatch on" />
            <span>
              <strong>{part} 事例</strong> {partLabel}
            </span>
          </li>
          <li>
            <span className="known-share-swatch off" />
            <span>
              <strong>{whole - part} 事例</strong> {restLabel}
            </span>
          </li>
        </ul>
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
