import type { Season } from "@hpai/shared/types";

export interface SeasonBarItem {
  season: Season;
  label: string;
  /** null は「まだ読めていない」。0 件とは別 */
  count: number | null;
  /** 見回りで確認できていない県の数。1 以上のとき「確認できた範囲では N 件（M 県は確認できていません）」と出す */
  unchecked?: number;
  /** 47 県とも確認できていない（見回りの結果が未着を含む）。件数を見出しにせず「まだ確認できていません」と出す */
  allUnchecked?: boolean;
}

/** 件数の見出し。確認できていない県があるあいだは、0 件を「発生なし」と読ませない形にする */
export function countText(b: SeasonBarItem): string {
  if (b.count === null) return "まだ読めていません";
  if (b.allUnchecked) return "まだ確認できていません";
  if (b.unchecked && b.unchecked > 0) return `確認できた範囲では ${b.count} 件（${b.unchecked} 県は確認できていません）`;
  return `${b.count} 件`;
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
                  <span className="season-bar-fill" style={{ width: `${b.count === null || b.allUnchecked ? 0 : (b.count / max) * 100}%` }} />
                </span>
                <span className="season-bar-count">{countText(b)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
