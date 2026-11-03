import type { Season } from "@hpai/shared/types";

export interface SeasonBarItem {
  season: Season;
  label: string;
  /** null は「まだ読めていない」。0 件とは別 */
  count: number | null;
  /** 件数に添える注記（例: 確認できていない県あり）。0 件を「発生なし」と読ませないため */
  note?: string;
}

/**
 * シーズンの棒グラフ。棒が切り替えのボタンを兼ねる（今季、昨季、2 年前…）。
 * 1 系列なので色は 1 色。長さは件数に比例し、数字を棒の横に直に書く。
 */
export function SeasonBar({
  bars,
  selected,
  onSelect,
}: {
  bars: readonly SeasonBarItem[];
  selected: Season;
  onSelect: (season: Season) => void;
}) {
  const max = Math.max(1, ...bars.map((b) => b.count ?? 0));
  return (
    <section className="season-bar" aria-label="シーズンの切り替え">
      <h2>発生した件数</h2>
      <ul>
        {bars.map((b) => {
          const pressed = b.season === selected;
          return (
            <li key={b.season}>
              <button
                type="button"
                className={`season-bar-btn${pressed ? " is-selected" : ""}`}
                aria-pressed={pressed}
                onClick={() => onSelect(b.season)}
              >
                <span className="season-bar-label">
                  {b.label}
                  <small>{b.season}〜{b.season + 1} 年</small>
                </span>
                <span className="season-bar-track" aria-hidden="true">
                  <span className="season-bar-fill" style={{ width: `${b.count === null ? 0 : (b.count / max) * 100}%` }} />
                </span>
                <span className="season-bar-count">
                  {b.count === null ? "まだ読めていません" : `${b.count} 件`}
                  {b.note ? <small>（{b.note}）</small> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
