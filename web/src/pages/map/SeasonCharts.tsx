import { PREFS } from "@hpai/shared/pref";
import type { Case, IsoDate, PrefCode, Season } from "@hpai/shared/types";
import type { ReactNode } from "react";
import { buildPrefBars, buildWeeks } from "./seasonView";
import { TEXT } from "./texts";
import { monthDay } from "./townLine";
import { WeekBars } from "./WeekBars";

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

export interface SeasonChartsProps {
  loaded: boolean;
  /** 47 県とも確認できていない */
  allUnchecked: boolean;
  countByPref: Readonly<Record<PrefCode, number>>;
  /** 今季の数えた事例 */
  cases: readonly Case[];
  season: Season;
  /** 日本時間の今日（再現では再現の時計の日） */
  today: IsoDate;
  failedPrefCodes: readonly PrefCode[];
  /** 時点の文。null は描かない */
  asOfText: string | null;
  source: string;
  /** 件数の少なさを読み違えないための断り（守る文がほかにないときだけ呼び出し側が渡す） */
  note?: ReactNode;
}

/**
 * 県ごとの今季の棒と、週ごとの全国の棒。件数の少なさを安全と読ませないよう、0 を大きく見せない。
 * 読めていない、1 県も確認できていない、全県確認できて 0 件のときは枠を出さない（月の表と守る文が書く）。
 * 色は今季の濃い青。県の棒は数字を棒に添え、週の棒は縦軸の目盛りと、当てると出る詳細で読む。
 */
export function SeasonCharts({ loaded, allUnchecked, countByPref, cases, season, today, failedPrefCodes, asOfText, source, note }: SeasonChartsProps) {
  if (!loaded || allUnchecked) return null;
  const total = cases.length;
  const partial = failedPrefCodes.length > 0;
  if (total === 0 && !partial) return null;

  const prefBars = buildPrefBars(countByPref);
  const prefMax = Math.max(1, ...prefBars.map((b) => b.count));
  const { weeks, undated } = buildWeeks(cases, season, today);
  const weekMax = Math.max(0, ...weeks.map((w) => w.count));
  const failedNames = failedPrefCodes.map((c) => PREF_NAME.get(c) ?? c).join("、");

  return (
    <div className="season-charts">
      <section className="pref-bars">
        <h2>{TEXT.prefBarsTitle}</h2>
        {prefBars.length > 0 ? (
          <ul className="pref-bar-list" aria-label={TEXT.prefBarsTitle}>
            {prefBars.map((b) => (
              <li className="pref-bar-row" key={b.prefCode}>
                <span>{b.name}</span>
                <span className="month-bar-track" aria-hidden="true">
                  <span className="month-bar-fill" style={{ width: `${(b.count / prefMax) * 100}%` }} />
                </span>
                <span className="pref-bar-count">{b.count} 件</span>
              </li>
            ))}
          </ul>
        ) : null}
        {partial ? (
          <p className="map-note">
            {total > 0 ? TEXT.watchShortRange : null}
            {TEXT.watchShortWho(failedNames)}
          </p>
        ) : null}
      </section>

      {total > 0 ? (
        <section className="week-bars">
          <h2>{TEXT.weekBarsTitle}</h2>
          {weekMax > 0 ? (
            <>
              <WeekBars weeks={weeks} />
              <p className="week-axis">
                <span>{TEXT.weekOf(monthDay(weeks[0]!.monday))}</span>
                {weeks.length > 1 ? <span>{TEXT.weekOf(monthDay(weeks[weeks.length - 1]!.monday))}</span> : null}
              </p>
            </>
          ) : null}
          {undated > 0 ? <p className="map-note">{TEXT.weekUndated(undated)}</p> : null}
        </section>
      ) : null}

      {note}
      <p className="map-note">{asOfText === null ? source : `${asOfText}。${source}`}</p>
    </div>
  );
}
