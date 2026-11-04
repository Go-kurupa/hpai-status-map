import { isCountable } from "@hpai/shared/level";
import { compareSeasons, seasonSpan, TOP_PREF_LIMIT } from "@hpai/shared/seasonCompare";
import type { Case, HistoryCase, IsoDate, IsoDateTime, Season } from "@hpai/shared/types";
import { formatAsOf } from "../../ui/AsOf";
import { caseDate } from "./seasonView";
import { TEXT } from "./texts";

/** 過去の事例（国の事例一覧）を取得した日。docs/data-sources.md「過去の事例」の取得日 */
export const HISTORY_CHECKED_ON = "2026-11-02";
export const COMPARE_DISCLAIMER = "過去の件数は国の事例一覧から数えた実績です。今季がどうなるかを示すものではありません。";

export interface SeasonCompareProps {
  /** 日本時間の今日 */
  today: IsoDate;
  current: Season;
  /** null は今季の事例がまだ読めていない */
  currentCases: readonly Case[] | null;
  /** null は過去の記録がまだ読めていない */
  history: readonly HistoryCase[] | null;
  historyFailed: boolean;
  /** 直近の確認の時刻。なければ null */
  asOf: IsoDateTime | null;
  /** 見回りで確認できていない県の数（件数の言い方を変える） */
  unchecked: number;
  allUnchecked: boolean;
}

const jaMonthDay = (d: IsoDate) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`;
const bar = (n: number, max: number) => (
  <span className="compare-track" aria-hidden="true">
    <span className="compare-fill" style={{ width: `${(n / Math.max(1, max)) * 100}%` }} />
  </span>
);

/** 今季の、今日までの件数（数える事例。日付のない事例も数える） */
export function countThisSeasonToDate(cases: readonly Case[], current: Season, today: IsoDate): number {
  return cases.filter((c) => c.season === current && isCountable(c) && (caseDate(c) ?? today) <= today).length;
}

function currentText(p: SeasonCompareProps, n: number | null): string {
  if (n === null) return "まだ読めていません";
  if (p.allUnchecked) return "まだ確認できていません";
  if (p.unchecked > 0) return `確認できた範囲では ${n} 件（${p.unchecked} 県は確認できていません）`;
  return `${n} 件`;
}

/** 過去のシーズンとの比べ。過去の実績の並べ方だけで、これからの発生は言わない */
export function SeasonCompare(p: SeasonCompareProps) {
  const rows = p.history ? compareSeasons(p.history, p.today) : null;
  const nowCount = p.currentCases ? countThisSeasonToDate(p.currentCases, p.current, p.today) : null;
  const md = jaMonthDay(p.today);
  const last = rows?.find((r) => r.season === p.current - 1) ?? null;

  const monthTotals = rows ? rows[0]?.months.map((m, i) => ({ month: m.month, count: rows.reduce((s, r) => s + r.months[i]!.count, 0) })) : null;
  const monthMax = Math.max(1, ...(monthTotals ?? []).map((m) => m.count));
  const peak = [...(monthTotals ?? [])].sort((a, b) => b.count - a.count).slice(0, 2).filter((m) => m.count > 0);
  const outside = rows ? rows.reduce((s, r) => s + r.total - r.months.reduce((t, m) => t + m.count, 0), 0) : 0;
  const max = Math.max(1, ...(rows ?? []).flatMap((r) => [r.total, r.countToDate]), nowCount ?? 0);

  return (
    <section className="season-compare" aria-label="過去のシーズンとの比べ">
      <h2>過去のシーズンとの比べ</h2>
      {rows === null ? (
        <p className={p.historyFailed ? "state-unknown" : "state-wait"} role="status">
          過去のシーズンの記録をまだ読めていません。{p.historyFailed ? "ページを読み込み直してください。" : null}
        </p>
      ) : (
        <>
          <p className="compare-lead" data-testid="compare-lead">
            今季（{seasonSpan(p.current)}）は {md}までに {currentText(p, nowCount)}。
            {last ? (
              <>
                昨季（{seasonSpan(last.season)}）の同じ時期までは {last.countToDate} 件、シーズンの合計は {last.total} 件でした。
              </>
            ) : null}
          </p>
          <div className="table-scroll">
          <table className="compare-table data-table">
            <caption>シーズンごとの件数（{md}までと、シーズンの合計）</caption>
            <thead>
              <tr>
                <th scope="col">シーズン</th>
                <th scope="col">最初の発生</th>
                <th scope="col">{md}まで</th>
                <th scope="col">合計</th>
              </tr>
            </thead>
            <tbody>
              <tr className="is-now">
                <th scope="row">今季 {seasonSpan(p.current)}</th>
                <td>―</td>
                <td className="num">
                  {nowCount === null ? "読めていません" : p.allUnchecked ? "確認できていません" : `${nowCount} 件`}
                  {nowCount !== null && !p.allUnchecked ? bar(nowCount, max) : null}
                </td>
                <td className="num">途中</td>
              </tr>
              {[...rows].reverse().map((r) => (
                <tr key={r.season}>
                  <th scope="row">{seasonSpan(r.season)}</th>
                  <td>{r.firstDate ? jaMonthDay(r.firstDate) : "なし"}</td>
                  <td className="num">
                    {r.countToDate} 件{bar(r.countToDate, max)}
                  </td>
                  <td className="num">
                    {r.total} 件{bar(r.total, max)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="table-scroll">
          <table className="compare-table data-table compare-months">
            <caption>月ごとの件数（過去 {rows.length} シーズンの合計）</caption>
            <thead>
              <tr>
                <th scope="col">月</th>
                <th scope="col">件数</th>
              </tr>
            </thead>
            <tbody>
              {(monthTotals ?? []).map((m) => (
                <tr key={m.month}>
                  <th scope="row">{m.month} 月</th>
                  <td className="num">
                    {m.count} 件{bar(m.count, monthMax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {peak.length > 0 ? (
            <p className="map-note">
              過去 {rows.length} シーズンでは、{peak.map((m) => `${m.month} 月（${m.count} 件）`).join("と")}に多く出ています。
              {outside > 0 ? `6〜9 月の ${outside} 件は表に入れていません。` : null}
            </p>
          ) : null}

          <details className="compare-prefs">
            <summary>件数の多かった県（シーズンごとの上位 {TOP_PREF_LIMIT} つ）</summary>
            <ul>
              {[...rows].reverse().map((r) => (
                <li key={r.season}>
                  <strong>{seasonSpan(r.season)}</strong>: {r.topPrefs.length ? r.topPrefs.map((t) => `${t.name} ${t.count} 件`).join("、") : "なし"}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p className="map-notice">{COMPARE_DISCLAIMER}</p>
      <p className="as-of">時点: 国の事例一覧、確認日 {HISTORY_CHECKED_ON}</p>
      <p className="as-of">
        今季のデータの時点:{" "}
        {p.asOf
          ? p.allUnchecked
            ? `${TEXT.watchAttemptOnly} ${formatAsOf(p.asOf).replace(/ 時点$/, "")} です`
            : formatAsOf(p.asOf)
          : "確認できていません"}
      </p>
    </section>
  );
}

