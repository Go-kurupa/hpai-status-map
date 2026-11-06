// 過去シーズンとの比べを 1 枚の地図に重ねる（設計書 2026-11-06-data-explore E8〜E14）。
// 比べる 1 だけの町は「／」、比べる 2 だけの町は「＼」、両方の町は「×」。見せ方は「重ねる／1 だけ／2 だけ」。
// 町を押すと、2 つのシーズンのその町の事例を 1 つの欄に上下に並べる。地図の読み込みの分け方は MapPage が持つので、地図は renderMap で描いてもらう。
// 読めていない間の断り（「今季の発生をまだ読めていません」など）は MapPage が地図の上に出す。ここでは塗らない（overlay を null にする）だけ
import { isCountable } from "@hpai/shared/level";
import { caseDate, isSuspectedOnly } from "@hpai/shared/overview";
import type { Case, HistoryCase, IsoDateTime, MuniCode, PrefCode, Season } from "@hpai/shared/types";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { overlayStyle, type OverlayShow, type OverlayState } from "./applyView";
import { CMP_TEXT } from "./compareTexts";
import type { MapViewProps } from "./MapView";
import type { SeasonView } from "./seasonView";
import { asOfText, Chunks, dateText, Detail } from "./TownCasesPanel";
import { TEXT } from "./texts";
import "./compare.css";

type Focus = MapViewProps["focus"];

export interface CompareOverlayProps {
  /** 選べるシーズン（今季と過去のシーズン）。label は「今季」「昨季」「2 年前」… */
  options: ReadonlyArray<{ season: Season; label: string }>;
  first: Season;
  second: Season;
  onFirst: (s: Season) => void;
  onSecond: (s: Season) => void;
  current: Season;
  currentCases: readonly Case[] | null;
  history: readonly HistoryCase[] | null;
  historyFailed: boolean;
  onRetryHistory: () => void;
  asOf: IsoDateTime | null;
  /** 確認できていない県。今季を比べに選んだときだけ地図に出す（E14） */
  failedPrefCodes: readonly PrefCode[];
  /** 2 つのシーズンの見え方（MapPage の buildSeasonView） */
  firstView: SeasonView;
  secondView: SeasonView;
  focus: Focus;
  muniName: (code: MuniCode) => string | null;
  renderMap: (o: { overlay: OverlayState | null; focus: Focus; ariaLabel: string; onInspectMuni: (c: MuniCode) => void }) => ReactNode;
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

export function CompareOverlay(p: CompareOverlayProps) {
  const [show, setShow] = useState<OverlayShow>("both");
  const [inspected, setInspected] = useState<MuniCode | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  const ids = [useId(), useId()];
  const overlay = useMemo(() => overlayOf(p.firstView, p.secondView, show, p.failedPrefCodes), [p.firstView, p.secondView, show, p.failedPrefCodes]);
  const split = overlay ? overlayStyle(overlay) : null;
  const withCurrent = p.firstView.isCurrent || p.secondView.isCurrent;

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

  const labelOf = (season: Season) => TEXT.compareOption(p.options.find((o) => o.season === season)?.label ?? `${season} 年`, season);
  const pick = (i: 0 | 1, season: Season, onChange: (s: Season) => void) => (
    <p className="compare-pick">
      <span className={`swatch cmp-swatch ${i === 0 ? "is-one" : "is-two"}`} aria-hidden="true" />
      <label htmlFor={ids[i]}>{i === 0 ? TEXT.compareFirst : TEXT.compareSecond}</label>
      <select id={ids[i]} value={season} onChange={(e) => onChange(Number(e.target.value) as Season)}>
        {p.options.map((o) => (
          <option key={o.season} value={o.season}>
            {TEXT.compareOption(o.label, o.season)}
          </option>
        ))}
      </select>
    </p>
  );
  const showButton = (value: OverlayShow, text: string) => (
    <button type="button" aria-pressed={show === value} onClick={() => setShow(value)}>
      {text}
    </button>
  );

  const seasons: [Season, Season] = [p.first, p.second];
  const asOf = asOfText(p.asOf);
  return (
    <div className="cmp-overlay">
      <div className="cmp-picks">
        {pick(0, p.first, p.onFirst)}
        {pick(1, p.second, p.onSecond)}
      </div>
      {p.first === p.second ? <p className="map-notice">{CMP_TEXT.sameSeason}</p> : null}
      <div className="cmp-show" role="group" aria-label={CMP_TEXT.showAria}>
        {showButton("both", CMP_TEXT.showBoth)}
        {showButton("one", CMP_TEXT.showOne)}
        {showButton("two", CMP_TEXT.showTwo)}
      </div>
      <div className="map-box">
        {p.renderMap({ overlay, focus: p.focus, ariaLabel: CMP_TEXT.mapAria(labelOf(p.first), labelOf(p.second)), onInspectMuni: setInspected })}
      </div>
      {split ? (
        <ul className="map-legend cmp-legend" aria-label={CMP_TEXT.legendAria}>
          {show === "both" ? (
            <>
              <li>
                <span className="swatch cmp-swatch is-one" aria-hidden="true" />
                {CMP_TEXT.legendOneOnly(split.one.length)}
              </li>
              <li>
                <span className="swatch cmp-swatch is-two" aria-hidden="true" />
                {CMP_TEXT.legendTwoOnly(split.two.length)}
              </li>
              <li>
                <span className="swatch cmp-swatch is-both" aria-hidden="true" />
                {CMP_TEXT.legendBoth(split.both.length)}
              </li>
            </>
          ) : show === "one" ? (
            <li>
              <span className="swatch cmp-swatch is-one" aria-hidden="true" />
              {CMP_TEXT.legendOne(split.one.length)}
            </li>
          ) : (
            <li>
              <span className="swatch cmp-swatch is-two" aria-hidden="true" />
              {CMP_TEXT.legendTwo(split.two.length)}
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
      {split ? <p className="map-note">{CMP_TEXT.legendNote}</p> : null}

      {inspected ? (
        <section className="town-cases compare-cases" aria-labelledby="cmp-cases-h">
          <p className="town-cases-label">{TEXT.panelLabel}</p>
          <h2 id="cmp-cases-h" ref={headRef} tabIndex={-1}>
            {p.muniName(inspected) ?? inspected}
          </h2>
          {seasons.map((season, i) => {
            const rows = rowsOf(season, inspected, p);
            const isNow = season === p.current;
            return (
              <div key={`${i}-${season}`} className="cmp-cases-block">
                <h3>
                  <span className={`swatch cmp-swatch ${i === 0 ? "is-one" : "is-two"}`} aria-hidden="true" />
                  <Chunks parts={TEXT.compareHead(i === 0 ? TEXT.compareFirst : TEXT.compareSecond, season)} />
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
        <p className="map-note compare-hint">{CMP_TEXT.hint}</p>
      )}
    </div>
  );
}
