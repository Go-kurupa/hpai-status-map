// 過去シーズンとの比べを 1 枚の地図に重ねる（設計書 2026-11-06-data-explore E8〜E14）。
// 比べる 1 だけの町は「／」、比べる 2 だけの町は「＼」、両方の町は「×」。いつも重ねて見せる（2026-11-07 作者の決定: 見せ方の切り替え「重ねる／1 だけ／2 だけ」は外した。片方だけ見たいときはシーズンのボタンで選ぶ）。
// 町を押すと、2 つのシーズンのその町の事例を 1 つの欄に上下に並べる。地図の読み込みの分け方は MapPage が持つので、地図は renderMap で描いてもらう。
// 読めていない間の断り（「今季の発生をまだ読めていません」など）は MapPage が地図の上に出す。ここでは塗らない（overlay を null にする）だけ
import { isCountable } from "@hpai/shared/level";
import { caseDate, isSuspectedOnly } from "@hpai/shared/overview";
import type { Case, HistoryCase, IsoDateTime, MuniCode, PrefCode, Season } from "@hpai/shared/types";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { overlayStyle, type LatestState, type OverlayShow, type OverlayState } from "./applyView";
import { LATEST_COLORS } from "./mapStyle";
import { CMP_TEXT } from "./compareTexts";
import type { MapViewProps } from "./MapView";
import type { SeasonView } from "./seasonView";
import { asOfText, Chunks, dateText, Detail } from "./TownCasesPanel";
import { TEXT } from "./texts";
import "./compare.css";

type Focus = MapViewProps["focus"];

export interface CompareOverlayProps {
  /** 選べるシーズン（今季と過去のシーズン）。label は「今季」「1 年前」「2 年前」… */
  options: ReadonlyArray<{ season: Season; label: string }>;
  /** 選んだシーズン（MapPage が古い順にそろえて渡す）。2 つなら重ね合わせ、1 つか 3 つ以上なら最後の発生の色（設計書 E12） */
  seasons: readonly Season[];
  /** 選び直した後のシーズン（古い順） */
  onSeasons: (s: Season[]) => void;
  current: Season;
  currentCases: readonly Case[] | null;
  history: readonly HistoryCase[] | null;
  historyFailed: boolean;
  onRetryHistory: () => void;
  asOf: IsoDateTime | null;
  /** 確認できていない県。今季を比べに選んだときだけ地図に出す（E14） */
  failedPrefCodes: readonly PrefCode[];
  /** 選んだシーズンの見え方（seasons と同じ順。MapPage の buildSeasonView） */
  views: readonly SeasonView[];
  focus: Focus;
  muniName: (code: MuniCode) => string | null;
  /** picked は欄を開いている町（地図で赤い線で囲む。作者 11/7） */
  renderMap: (o: { overlay: OverlayState | null; latest: LatestState | null; picked: MuniCode | null; focus: Focus; ariaLabel: string; onInspectMuni: (c: MuniCode) => void }) => ReactNode;
}

/** 欄の 1 行。今季の事例と過去の事例を同じ形にそろえる */
interface Row {
  key: string;
  date: string | null;
  suspected: boolean;
  birdUse: string | null;
  housing: string | null;
  headCount: number | null;
  url: string | null;
}

/**
 * あるシーズンのある町の事例。今季は件数に数える事例（否定・確認中を除く）、過去は国の事例一覧から関連農場を除く。新しい順。
 * 読めていなければ null
 */
export function rowsOf(season: Season, code: MuniCode, p: Pick<CompareOverlayProps, "current" | "currentCases" | "history">): Row[] | null {
  if (season === p.current) {
    if (p.currentCases === null) return null;
    return p.currentCases
      .filter((c) => c.muniCode === code && c.season === season && isCountable(c))
      .map((c) => ({ key: c.id, date: caseDate(c), suspected: isSuspectedOnly(c), birdUse: c.birdUse, housing: c.housing, headCount: c.headCount, url: c.sourceUrls[0] ?? null }))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }
  if (p.history === null) return null;
  return p.history
    .filter((h) => h.muniCode === code && h.season === season && !h.related)
    .map((h) => ({ key: `${h.season}-${h.no}`, date: h.date, suspected: false, birdUse: h.birdUse, housing: h.housing, headCount: h.headCount, url: h.sourceUrl }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** 発生のあった町。今季は疑いを含む（E10） */
const muniOf = (v: SeasonView): MuniCode[] => [...new Set([...v.confirmedMuniCodes, ...v.suspectedMuniCodes])].sort();

/** 地図に渡す重ね合わせ。どちらかのシーズンが読めていなければ null（塗らない） */
export function overlayOf(first: SeasonView, second: SeasonView, show: OverlayShow, failedPrefCodes: readonly PrefCode[]): OverlayState | null {
  if (!first.loaded || !second.loaded) return null;
  return { first: muniOf(first), second: muniOf(second), show, unwatchedPrefCodes: first.isCurrent || second.isCurrent ? [...failedPrefCodes] : [] };
}

export { LATEST_COLORS };

/**
 * 3 つ以上の比べ（設計書 E12）。町ごとに、選んだうち最後に発生したシーズンの色。新しいシーズンほど濃い色（LATEST_COLORS の後ろ）。
 * bySeason はシーズンごとに「最後」になった町の数（凡例）。どれかが読めていなければ null（塗らない）
 */
export function latestOf(
  views: readonly SeasonView[],
  failedPrefCodes: readonly PrefCode[],
  current: Season,
): { state: LatestState; colorOf: Map<Season, string>; bySeason: Map<Season, number> } | null {
  if (views.some((v) => !v.loaded)) return null;
  const ordered = [...views].sort((a, b) => a.season - b.season);
  // 色はシーズンごとに固定（今季から何年前か）。選ぶ数で変わらない（作者 11/7）
  const colorOf = new Map(ordered.map((v) => [v.season, LATEST_COLORS[Math.min(LATEST_COLORS.length - 1, Math.max(0, current - v.season))]!] as const));
  const last = new Map<MuniCode, Season>();
  for (const v of ordered) for (const c of muniOf(v)) last.set(c, v.season);
  // 町ごとの発生の回数（選んだシーズン全体の事例の数。同じシーズンに 2 回でも 2）。作者 11/7「計◯回」
  const times = new Map<MuniCode, number>();
  for (const v of ordered) for (const k of v.cases) if (k.muniCode !== null && last.has(k.muniCode)) times.set(k.muniCode, (times.get(k.muniCode) ?? 0) + 1);
  const bySeason = new Map<Season, number>(ordered.map((v) => [v.season, 0]));
  for (const s of last.values()) bySeason.set(s, (bySeason.get(s) ?? 0) + 1);
  const colors = [...last].sort(([a], [b]) => (a < b ? -1 : 1)).map(([c, s]) => [c, colorOf.get(s)!] as const);
  const counts = [...times].filter(([, n]) => n >= 2).sort(([a], [b]) => (a < b ? -1 : 1));
  return { state: { colors, counts, unwatchedPrefCodes: ordered.some((v) => v.isCurrent) ? [...failedPrefCodes] : [] }, colorOf, bySeason };
}

export function CompareOverlay(p: CompareOverlayProps) {
  // いつも重ねる（2026-11-07 作者の決定。片方だけ見たいときはシーズンのボタンで外す）
  const show: OverlayShow = "both";
  const [inspected, setInspected] = useState<MuniCode | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  const pair = p.seasons.length === 2;
  const firstView = p.views[0]!;
  const secondView = p.views[1] ?? p.views[0]!;
  const overlay = useMemo(() => (pair ? overlayOf(firstView, secondView, show, p.failedPrefCodes) : null), [pair, firstView, secondView, show, p.failedPrefCodes]);
  const latest = useMemo(() => (pair ? null : latestOf(p.views, p.failedPrefCodes, p.current)), [pair, p.views, p.failedPrefCodes, p.current]);
  const split = overlay ? overlayStyle(overlay) : null;
  const withCurrent = p.views.some((v) => v.isCurrent);

  // 町を押したら、読み上げとキーボードの位置を欄の題へ移す。閉じたら開いた元（地図）へ戻す
  useEffect(() => {
    if (!inspected) return;
    if (!headRef.current?.contains(document.activeElement)) opener.current = document.activeElement;
    headRef.current?.focus();
  }, [inspected]);
  const close = () => {
    const back = opener.current;
    setInspected(null);
    requestAnimationFrame(() => {
      if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus();
    });
  };

  // シーズンの呼び方（今季、1 年前…）。「比べる 1・2」とは呼ばない（作者 11/7）
  const nameOf = (season: Season) => p.options.find((o) => o.season === season)?.label ?? `${season} 年`;
  const labelOf = (season: Season) => TEXT.compareOption(nameOf(season), season);
  // シーズンのボタン。押すと足し、もう一度押すと外す。最後の 1 つは外さない（何も比べない地図にしない）
  const toggle = (season: Season) => {
    const on = p.seasons.includes(season);
    if (on && p.seasons.length === 1) return;
    const next = on ? p.seasons.filter((s) => s !== season) : [...p.seasons, season];
    p.onSeasons([...next].sort((a, b) => a - b));
  };
  // 2 つのときは、古い方が比べる 1、新しい方が比べる 2（見本と今の画面の並び）
  const swatchOf = (season: Season) => (pair ? (season === p.seasons[0] ? "is-one" : "is-two") : null);

  const asOf = asOfText(p.asOf);
  // 欄の並び: 2 つのときは比べる 1・2 の順、3 つ以上のときは新しい順
  const panelSeasons = pair ? [...p.seasons] : [...p.seasons].sort((a, b) => b - a);
  return (
    <div className="cmp-overlay">
      <p className="map-note">{CMP_TEXT.seasonsHint}</p>
      <div className="cmp-seasons" role="group" aria-label={CMP_TEXT.seasonsAria}>
        {p.options.map((o) => {
          const on = p.seasons.includes(o.season);
          const sw = on ? swatchOf(o.season) : null;
          const color = on && !pair ? latest?.colorOf.get(o.season) : undefined;
          return (
            <button key={o.season} type="button" aria-pressed={on} onClick={() => toggle(o.season)}>
              {sw ? <span className={`swatch cmp-swatch ${sw}`} aria-hidden="true" /> : null}
              {color ? <span className="swatch cmp-latest-swatch" style={{ background: color }} aria-hidden="true" /> : null}
              {CMP_TEXT.seasonChip(o.label, o.season)}
            </button>
          );
        })}
      </div>
      {pair && p.seasons[0] === p.seasons[1] ? <p className="map-notice">{CMP_TEXT.sameSeason}</p> : null}
      <div className="map-box">
        {/* 読み込めていない間も重ね合わせの形で渡し、塗りは空にする。1 シーズン分の普通の塗りと県の件数の札を凡例なしで出さない（E8、E13） */}
        {p.renderMap(
          pair
            ? {
                overlay: { ...(overlay ?? { first: [], second: [], show, unwatchedPrefCodes: withCurrent ? [...p.failedPrefCodes] : [] }), names: [nameOf(p.seasons[0]!), nameOf(p.seasons[1]!)] },
                latest: null,
                picked: inspected,
                focus: p.focus,
                ariaLabel: CMP_TEXT.mapAria(labelOf(p.seasons[0]!), labelOf(p.seasons[1]!)),
                onInspectMuni: setInspected,
              }
            : {
                overlay: null,
                // 読めていない間は色を付けない（空の色で渡し、1 シーズン分の普通の塗りと札を出さない）
                latest: latest?.state ?? { colors: [], counts: [], unwatchedPrefCodes: withCurrent ? [...p.failedPrefCodes] : [] },
                picked: inspected,
                focus: p.focus,
                ariaLabel: CMP_TEXT.latestAria(p.seasons.length),
                onInspectMuni: setInspected,
              },
        )}
      </div>
      {latest ? (
        <ul className="map-legend cmp-legend" aria-label={CMP_TEXT.legendAria}>
          {[...p.seasons].sort((a, b) => a - b).map((s) => (
            <li key={s}>
              <span className="swatch cmp-latest-swatch" style={{ background: latest.colorOf.get(s) }} aria-hidden="true" />
              {CMP_TEXT.legendLatest(labelOf(s), latest.bySeason.get(s) ?? 0)}
            </li>
          ))}
          {latest.state.unwatchedPrefCodes.length > 0 ? (
            <li>
              <span className="swatch cmp-swatch is-unwatched" aria-hidden="true" />
              {CMP_TEXT.legendUnwatched}
            </li>
          ) : null}
        </ul>
      ) : null}
      {split ? (
        <ul className="map-legend cmp-legend" aria-label={CMP_TEXT.legendAria}>
          {show === "both" && p.seasons[0] === p.seasons[1] ? (
            // 同じシーズンどうしは、すべて「両方」になる。0 町の行を並べない
            <li>
              <span className="swatch cmp-swatch is-both" aria-hidden="true" />
              {CMP_TEXT.legendBoth(split.both.length)}
            </li>
          ) : show === "both" ? (
            <>
              <li>
                <span className="swatch cmp-swatch is-one" aria-hidden="true" />
                {CMP_TEXT.legendOnly(nameOf(p.seasons[0]!), split.one.length)}
              </li>
              <li>
                <span className="swatch cmp-swatch is-two" aria-hidden="true" />
                {CMP_TEXT.legendOnly(nameOf(p.seasons[1]!), split.two.length)}
              </li>
              <li>
                <span className="swatch cmp-swatch is-both" aria-hidden="true" />
                {CMP_TEXT.legendBoth(split.both.length)}
              </li>
            </>
          ) : show === "one" ? (
            <li>
              <span className="swatch cmp-swatch is-one" aria-hidden="true" />
              {CMP_TEXT.legendIn(nameOf(p.seasons[0]!), split.one.length)}
            </li>
          ) : (
            <li>
              <span className="swatch cmp-swatch is-two" aria-hidden="true" />
              {CMP_TEXT.legendIn(nameOf(p.seasons[1]!), split.two.length)}
            </li>
          )}
          {overlay && overlay.unwatchedPrefCodes.length > 0 ? (
            <li>
              <span className="swatch cmp-swatch is-unwatched" aria-hidden="true" />
              {CMP_TEXT.legendUnwatched}
            </li>
          ) : null}
        </ul>
      ) : null}
      {withCurrent ? <p className="map-note">{CMP_TEXT.currentSuspected}</p> : null}
      {latest && latest.state.counts.length > 0 ? <p className="map-note">{CMP_TEXT.countNote}</p> : null}
      {split || latest ? <p className="map-note">{CMP_TEXT.legendNote}</p> : null}

      {inspected ? (
        <section className="town-cases compare-cases" aria-labelledby="cmp-cases-h">
          <p className="town-cases-label">{TEXT.panelLabel}</p>
          <h2 id="cmp-cases-h" ref={headRef} tabIndex={-1}>
            {p.muniName(inspected) ?? inspected}
          </h2>
          {panelSeasons.map((season, i) => {
            const rows = rowsOf(season, inspected, p);
            const isNow = season === p.current;
            return (
              <div key={`${i}-${season}`} className="cmp-cases-block">
                <h3>
                  {pair ? (
                    <>
                      <span className={`swatch cmp-swatch ${i === 0 ? "is-one" : "is-two"}`} aria-hidden="true" />
                      <Chunks parts={TEXT.compareHead(nameOf(season), season)} />
                    </>
                  ) : (
                    <>
                      <span className="swatch cmp-latest-swatch" style={{ background: latest?.colorOf.get(season) }} aria-hidden="true" />
                      {labelOf(season)}
                    </>
                  )}
                </h3>
                {rows === null && !isNow && p.historyFailed ? (
                  <p className="state-unknown" role="status">
                    {TEXT.panelPastFailed}{" "}
                    <button type="button" className="btn" onClick={p.onRetryHistory}>
                      {TEXT.panelRetry}
                    </button>
                  </p>
                ) : rows === null ? (
                  <p role="status">{TEXT.panelLoading}</p>
                ) : rows.length === 0 ? (
                  <p>{isNow ? <Chunks parts={TEXT.panelNoneNow(asOf)} /> : TEXT.panelNonePast}</p>
                ) : (
                  <ul className="town-cases-list">
                    {rows.map((r) => (
                      <li key={r.key}>
                        <b>
                          {dateText(r.date)}
                          {isNow ? `　${r.suspected ? TEXT.panelSuspected : TEXT.panelConfirmed}` : null}
                        </b>
                        <Detail birdUse={r.birdUse} housing={r.housing} headCount={r.headCount} />
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="tap-link">
                            {TEXT.panelSource}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="town-cases-note">{TEXT.panelNote}</p>
          <p>
            <Link to={`/area/${inspected}`} className="tap-link">
              {TEXT.areaLink}
            </Link>
          </p>
          <button type="button" className="btn" onClick={close}>
            {TEXT.panelCloseNoTown}
          </button>
        </section>
      ) : (
        <p className="map-note compare-hint">{pair ? CMP_TEXT.hint : CMP_TEXT.latestHint}</p>
      )}
    </div>
  );
}
