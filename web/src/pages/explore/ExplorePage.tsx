import { FIXED_TEXT } from "@hpai/shared/wording";
import { PREFS } from "@hpai/shared/pref";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { regionOf, REGIONS, type RegionId } from "../../geo/regions";
import { SectionTabs } from "../../ui/SectionTabs";
import { countText } from "../map/SeasonBar";
import { dateText } from "../map/TownCasesPanel";
import { useSeasonData } from "../map/useSeasonData";
import { chipCounts, countByMonth, countBySeason, countBySeasonMonth, exploreRows, filterRows, HEAD_BANDS, SEASON_MONTHS, USE_BUCKETS, type ExploreFilter, type HeadBand, type UseBucket } from "./exploreData";
import { EXPLORE_TEXT as T } from "./texts";
import "../map/map.css";
import "./explore.css";

/**
 * 押すだけで選ぶ 1 段のボタン。複数選べる。押すと入り、もう一度押すと外れる。先頭の「すべて」（「全国」）は選びを空に戻す。
 * 選んでいるものに aria-pressed
 */
function Choices<V extends string>({
  label,
  allText,
  items,
  value,
  counts,
  onChange,
}: {
  label: string;
  allText: string;
  items: ReadonlyArray<{ value: V; text: string }>;
  value: readonly V[];
  /** ボタンに添える件数（E4b。その段以外の条件で数えた数。キー "all" は「すべて」）。null は読めていない間 */
  counts: ReadonlyMap<string, number> | null;
  onChange: (v: V[]) => void;
}) {
  const n = (k: string) => (counts === null ? null : <>{" "}<span className="explore-chip-count">{T.count(counts.get(k) ?? 0)}</span></>);
  return (
    <div className="explore-row" role="group" aria-label={label}>
      <span className="explore-row-label" aria-hidden="true">
        {label}
      </span>
      <div>
        <button type="button" aria-pressed={value.length === 0} onClick={() => onChange([])}>
          {allText}
          {n("all")}
        </button>
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            aria-pressed={value.includes(it.value)}
            onClick={() => onChange(value.includes(it.value) ? value.filter((v) => v !== it.value) : items.map((x) => x.value).filter((v) => v === it.value || value.includes(v)))}
          >
            {it.text}
            {n(it.value)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 条件で見る過去の発生（設計書 2026-11-06-data-explore E1〜E7、E16）。用途・羽数・地方のボタンで、
 * 過去 6 シーズンと今季の事例を絞り、件数の 1 文、シーズンごとの件数、事例の一覧を同時に変える。
 */
export default function ExplorePage() {
  const d = useSeasonData();
  const [f, setF] = useState<ExploreFilter>({ use: [], band: [], region: [], month: null });
  // 過去 6 シーズン（古い順）と今季
  const seasons = useMemo(() => [6, 5, 4, 3, 2, 1, 0].map((n) => d.current - n), [d.current]);
  const rows = useMemo(() => (d.history === null ? null : exploreRows({ history: d.history, currentCases: d.currentCases, current: d.current })), [d.history, d.currentCases, d.current]);
  const result = useMemo(() => (rows === null ? null : filterRows(rows, f)), [rows, f]);
  // 月ごとの件数と表は、月の条件を外して数える（月を選んでもほかの月の数が消えない。E4b）
  const monthBase = useMemo(() => (rows === null ? null : filterRows(rows, { ...f, month: null }).hits), [rows, f]);
  const byMonth = useMemo(() => (monthBase === null ? null : countByMonth(monthBase)), [monthBase]);
  const grid = useMemo(() => (monthBase === null ? null : countBySeasonMonth(monthBase, seasons)), [monthBase, seasons]);
  const chips = useMemo(
    () => (rows === null ? null : { use: chipCounts(rows, f, "use"), band: chipCounts(rows, f, "band"), region: chipCounts(rows, f, "region") }),
    [rows, f],
  );
  const counts = useMemo(() => (result === null ? [] : countBySeason(result.hits, seasons)), [result, seasons]);
  // 新しい順。日付の記載がない今季の事例は、いちばん新しいシーズンの先頭に置く（古い側の最後に回さない）
  const sorted = useMemo(
    () =>
      result === null
        ? []
        : [...result.hits].sort((a, b) => b.season - a.season || (a.date === null ? -1 : b.date === null ? 1 : b.date.localeCompare(a.date))),
    [result],
  );
  const regionNames = REGIONS.filter((r) => f.region.includes(r.id)).map((r) => r.name);
  // 段の中は「、」、段どうしは「・」でつなぐ（例「東北、関東・採卵鶏」）
  const cond = [regionNames, f.use, f.band, f.month === null ? [] : [T.monthText(f.month)]].filter((xs) => xs.length > 0).map((xs) => xs.join("、")).join("・") || T.japan;
  // 地図で見るのは、地方を 1 つだけ選んだとき（地図はひとつの広さにしか寄せられない）
  const oneRegion = f.region.length === 1 ? (REGIONS.find((r) => r.id === f.region[0]) ?? null) : null;
  const withCurrent = d.currentCases !== null;
  // 確認できていない県は、選んだ地方の中だけを数える（中国だけを選んで北海道が確認できていないとき、断りを出さない）
  const scopePrefs = f.region.length === 0 ? PREFS.map((p) => p.code) : PREFS.map((p) => p.code).filter((c) => f.region.includes(regionOf(c)));
  const unchecked = d.failedPrefCodes.filter((c) => scopePrefs.includes(c)).length;
  const allUnchecked = unchecked === scopePrefs.length;
  const max = Math.max(1, ...counts.map((c) => c.count));
  const monthMax = Math.max(1, ...(byMonth?.months.map((m) => m.count) ?? []));
  const gridMax = Math.max(1, ...(grid ? [...grid.values()] : []));

  return (
    <div className="explore-page">
      <SectionTabs group="past" />
      <h1>{T.title}</h1>
      <p className="explore-lead">{T.lead}</p>

      <div className="explore-questions" role="group" aria-label={T.questionsAria}>
        {T.questions.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => setF({ use: q.use ? [q.use as UseBucket] : [], band: q.band ? [q.band as HeadBand] : [], region: q.region ? [q.region as RegionId] : [], month: null })}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="explore-choices">
        <Choices label={T.useLabel} allText={T.all} items={USE_BUCKETS.map((u) => ({ value: u, text: u }))} value={f.use} counts={chips?.use ?? null} onChange={(use) => setF({ ...f, use })} />
        <Choices label={T.bandLabel} allText={T.all} items={HEAD_BANDS.map((b) => ({ value: b, text: b }))} value={f.band} counts={chips?.band ?? null} onChange={(band) => setF({ ...f, band })} />
        <Choices label={T.regionLabel} allText={T.japan} items={REGIONS.map((r) => ({ value: r.id, text: r.name }))} value={f.region} counts={chips?.region ?? null} onChange={(region) => setF({ ...f, region })} />
      </div>

      {result === null ? (
        d.historyFailed ? (
          <p className="state-unknown" role="status">
            {T.historyFailed}{" "}
            <button type="button" className="btn" onClick={d.retryHistory}>
              {T.retry}
            </button>
          </p>
        ) : (
          <p className="state-wait" role="status">
            {T.historyLoading}
          </p>
        )
      ) : (
        <>
          <p className="explore-answer" aria-live="polite">
            {T.answer(cond, result.hits.length, withCurrent)}
          </p>
          {/* 件数が少ないことを「発生しない」と読ませない（E6） */}
          {result.hits.length <= 3 ? <p className="map-notice">{FIXED_TEXT.riskAnywhere}</p> : null}
          <p className="explore-note">{T.noDenominator}</p>
          {result.missingUse > 0 ? <p className="explore-note">{T.missingUse(result.missingUse)}</p> : null}
          {result.missingBand > 0 ? <p className="explore-note">{T.missingBand(result.missingBand)}</p> : null}
          {result.missingDate > 0 ? <p className="explore-note">{T.missingDate(result.missingDate)}</p> : null}
          {oneRegion ? (
            <p>
              <Link to={`/compare?region=${oneRegion.id}`} className="tap-link">
                {T.mapLink(oneRegion.name)}
              </Link>
            </p>
          ) : null}

          <table className="explore-bars">
            <caption>{T.barsCaption}</caption>
            <tbody>
              {counts.map((c) => {
                const isNow = c.season === d.current;
                // 今季は確認できていない県の断りを、今の画面と同じ文にする（E16）
                const text = isNow
                  ? countText({ count: withCurrent ? c.count : null, unchecked, allUnchecked })
                  : countText({ count: c.count });
                return (
                  <tr key={c.season} className={isNow ? "is-current" : undefined}>
                    <th scope="row">{isNow ? T.currentSeason(c.season) : T.seasonRange(c.season)}</th>
                    <td className="explore-bar-count">{text}</td>
                    <td className="explore-bar-cell" aria-hidden="true">
                      <span className="explore-bar-fill" style={{ width: `${(c.count / max) * 100}%` }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {byMonth ? (
            <section className="explore-months">
              <h2>{T.monthsTitle}</h2>
              <p className="explore-note">{T.monthsHint}</p>
              <div role="group" aria-label={T.monthsAria}>
                {byMonth.months.map((m) => (
                  <button key={m.month} type="button" aria-pressed={f.month === m.month} onClick={() => setF({ ...f, month: f.month === m.month ? null : m.month })}>
                    <span className="explore-month-label">{T.monthText(m.month)}</span>
                    <span className="explore-month-track" aria-hidden="true">
                      <span className="explore-bar-fill" style={{ width: `${(m.count / monthMax) * 100}%` }} />
                    </span>
                    <span className="explore-month-count">{T.count(m.count)}</span>
                  </button>
                ))}
              </div>
              {byMonth.undated > 0 ? <p className="explore-note">{T.undated(byMonth.undated)}</p> : null}
            </section>
          ) : null}

          {grid ? (
            // 横に送る箱。キーボードでも送れるように、押せるものがなくても入れる
            <div className="explore-grid" role="region" aria-label={T.gridCaption} tabIndex={0}>
              <table>
                <caption>{T.gridCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{T.colSeason}</th>
                    {SEASON_MONTHS.map((m) => (
                      <th key={m} scope="col" className={f.month === m ? "is-picked" : undefined}>
                        {T.monthText(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((s) => {
                    const isNow = s === d.current;
                    return (
                      <tr key={s} className={isNow ? "is-current" : undefined}>
                        <th scope="row">{isNow ? T.gridCurrent : T.gridSeason(s)}</th>
                        {SEASON_MONTHS.map((m) => {
                          const c = grid.get(`${s}-${m}`) ?? 0;
                          // 薄い色は数の補助。数を必ず書く（色だけで読ませない）
                          return (
                            <td key={m} className={f.month === m ? "is-picked" : undefined} style={c > 0 ? { backgroundColor: `rgba(0, 23, 193, ${(0.08 + 0.32 * (c / gridMax)).toFixed(2)})` } : undefined}>
                              {isNow && !withCurrent ? "" : c}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {grid && !withCurrent ? <p className="explore-note">{T.gridNotLoaded}</p> : null}
          {grid && withCurrent && unchecked > 0 ? <p className="explore-note">{T.gridUnchecked(unchecked)}</p> : null}

          <div className="explore-cases">
            <table>
              <caption>{T.casesCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{T.colDate}</th>
                  <th scope="col">{T.colPlace}</th>
                  <th scope="col">{T.colUse}</th>
                  <th scope="col">{T.colHead}</th>
                  <th scope="col">{T.colSource}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{T.none}</td>
                  </tr>
                ) : (
                  sorted.map((r) => (
                    <tr key={r.key}>
                      <td>{r.date ? dateText(r.date) : T.noDate}</td>
                      <td>{r.place}</td>
                      <td>{r.birdUse ?? T.noUse}</td>
                      <td>{r.headCount === null ? T.noHead : `${r.headCount.toLocaleString("ja-JP")} 羽`}</td>
                      <td>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer">
                            {T.source}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="explore-note">{T.sourceNote}</p>
        </>
      )}
    </div>
  );
}
