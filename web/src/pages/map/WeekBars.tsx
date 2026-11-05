import { addDays } from "@hpai/shared/dates";
import { PREFS } from "@hpai/shared/pref";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { WeekBar } from "./seasonView";
import { TEXT } from "./texts";
import { monthDay } from "./townLine";

const PREF_ORDER = new Map(PREFS.map((p, i) => [p.code, i]));
const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
/** 詳細に並べる県の上限。超えた分は「ほか N 県」 */
const MAX_PREF_LINES = 4;

/** 縦軸の目盛り。3〜4 本になる切りのよい刻みと、上の端の値 */
export function weekTicks(max: number): { step: number; top: number } {
  const step = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((s) => Math.ceil(max / s) <= 4) ?? Math.ceil(max / 4);
  return { step, top: Math.max(step, Math.ceil(max / step) * step) };
}

/** 週の県と町を、県の番号の順に 1 県 1 行にする。同じ町が 2 件以上なら件数を添える */
export function weekPlaceLines(places: WeekBar["places"]): string[] {
  const byPref = new Map<string, Map<string, number>>();
  for (const p of places) {
    const munis = byPref.get(p.prefCode) ?? new Map<string, number>();
    const name = p.muniName ?? TEXT.weekPlaceUnknown;
    munis.set(name, (munis.get(name) ?? 0) + 1);
    byPref.set(p.prefCode, munis);
  }
  const lines = [...byPref.entries()]
    .sort(([a], [b]) => (PREF_ORDER.get(a) ?? 99) - (PREF_ORDER.get(b) ?? 99))
    .map(([code, munis]) => `${PREF_NAME.get(code) ?? code} ${[...munis].map(([name, n]) => TEXT.weekPlaceCount(name, n)).join("、")}`);
  return lines.length > MAX_PREF_LINES ? [...lines.slice(0, MAX_PREF_LINES), TEXT.weekPlacesMore(lines.length - MAX_PREF_LINES)] : lines;
}

/**
 * 週ごとの全国の棒（2026-11-06 作者の決定）。縦軸に目盛りと薄い横線を引き、棒の上に数字は置かない。
 * 棒に当てる・押す・キー（左右）で、その週の件数、日付、県と町を出す。0 件の週には出さない（0 を大きく見せない）。
 * 指やカーソルは近くの週に吸い付く（棒が細く、1 本を狙わせない）。読み上げは一覧の各行に同じ中身がある。
 */
export function WeekBars({ weeks }: { weeks: readonly WeekBar[] }) {
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const max = Math.max(0, ...weeks.map((w) => w.count));
  const { step, top } = weekTicks(max);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const filled = weeks.flatMap((w, i) => (w.count > 0 ? [i] : []));
  const focusIndex = active !== null && weeks[active]!.count > 0 ? active : filled[0];

  // 詳細の枠は棒の真上に置き、左右の端ではみ出さないよう寄せる
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const list = listRef.current;
    if (!tip || !list || active === null) return;
    const width = list.clientWidth;
    const center = ((active + 0.5) / weeks.length) * width;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(width - half, center))}px`;
  }, [active, weeks.length]);

  const pick = (e: PointerEvent<HTMLOListElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(weeks.length - 1, Math.floor(((e.clientX - rect.left) / rect.width) * weeks.length)));
    setActive(weeks[i]!.count > 0 ? i : null);
  };
  const move = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    if (e.key === "Escape") return setActive(null);
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const at = filled.indexOf(i);
    const next = filled[Math.max(0, Math.min(filled.length - 1, at + (e.key === "ArrowRight" ? 1 : -1)))];
    if (next === undefined) return;
    (listRef.current?.children[next] as HTMLElement | undefined)?.focus();
  };
  const shown = active !== null ? weeks[active] : undefined;

  return (
    <div className="week-plot" style={{ "--week-ticks": ticks.length - 1 } as CSSProperties}>
      <ul className="week-ticks" aria-label={TEXT.weekAxisAria}>
        {ticks.map((v) => (
          <li key={v} style={{ "--t": Number((v / top).toFixed(4)) } as CSSProperties}>
            <span>{v}</span>
          </li>
        ))}
      </ul>
      <div className="week-area">
        <div className="week-grid" aria-hidden="true">
          {ticks.slice(1).map((v) => (
            <span key={v} style={{ "--t": Number((v / top).toFixed(4)) } as CSSProperties} />
          ))}
        </div>
        <ol
          ref={listRef}
          className="week-bar-list"
          aria-label={TEXT.weekBarsAria}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setActive(null);
          }}
        >
          {weeks.map((w, i) => {
            if (w.count === 0) return <li key={w.monday} aria-hidden="true" />;
            const lines = weekPlaceLines(w.places);
            return (
              <li
                key={w.monday}
                className={i === active ? "is-on" : undefined}
                tabIndex={i === focusIndex ? 0 : -1}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                onKeyDown={(e) => move(e, i)}
              >
                <span className="week-label">
                  {TEXT.weekOf(monthDay(w.monday))} {w.count} 件（{lines.join("。")}）
                </span>
                <span className="week-bar-fill" aria-hidden="true" style={{ "--r": Number((w.count / top).toFixed(4)) } as CSSProperties} />
              </li>
            );
          })}
        </ol>
        {shown ? (
          <div ref={tipRef} className="week-tip" aria-hidden="true">
            <b>{shown.count} 件</b>
            <span className="week-tip-date">{TEXT.weekRange(monthDay(shown.monday), monthDay(addDays(shown.monday, 6)))}</span>
            {weekPlaceLines(shown.places).map((line) => (
              <span key={line} className="week-tip-place">
                {line}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
