// 過去シーズンとの比べ（設計書 2026-11-06-ui-frame 4.4、決定 5）。2 つのシーズンの地図を並べ（スマホは上下）、
// 片方が動くともう片方も同じ場所へ動く。町を押すと、2 つのシーズンのその町の事例を地図の下に並べる。
// 地図の読み込みの分け方（lazy、読めないときの境）は MapPage が持つので、地図は renderMap で描いてもらう。
import { isCountable } from "@hpai/shared/level";
import { caseDate, isSuspectedOnly } from "@hpai/shared/overview";
import type { Case, HistoryCase, IsoDateTime, MuniCode, Season } from "@hpai/shared/types";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { MlMap } from "../../geo/maplibre";
import type { MapViewProps } from "./MapView";
import { asOfText, Chunks, dateText, Detail } from "./TownCasesPanel";
import { TEXT } from "./texts";

type Focus = MapViewProps["focus"];

export interface CompareMapsProps {
  /** 選べるシーズン（今季と過去のシーズン）。label は「今季」「昨季」「2 年前」… */
  options: ReadonlyArray<{ season: Season; label: string }>;
  /** 比べる 1。下のシーズンの一覧と同じ選び */
  first: Season;
  /** 比べる 2 */
  second: Season;
  onFirst: (s: Season) => void;
  onSecond: (s: Season) => void;
  current: Season;
  /** 今季の事例（読めていなければ null） */
  currentCases: readonly Case[] | null;
  /** 過去のシーズンの国の事例一覧（読めていなければ null） */
  history: readonly HistoryCase[] | null;
  historyFailed: boolean;
  onRetryHistory: () => void;
  /** 今季の記録の時点。今季に記録がないとき「〇時点で、発生記録はありません。」と書く（2026-11-06 作者の決定） */
  asOf: IsoDateTime | null;
  /** 「自分の近く／全国」の広さの指定。2 枚に同じものを当てる */
  focus: Focus;
  muniName: (code: MuniCode) => string | null;
  /** 地図ごとの時点と凡例（今季と過去で色が違う） */
  renderSideNotes: (index: 0 | 1) => ReactNode;
  renderMap: (o: {
    index: 0 | 1;
    season: Season;
    focus: Focus;
    ariaLabel: string;
    onMapReady: (m: MlMap) => void;
    onInspectMuni: (c: MuniCode) => void;
  }) => ReactNode;
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
export function rowsOf(season: Season, code: MuniCode, p: Pick<CompareMapsProps, "current" | "currentCases" | "history">): Row[] | null {
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

/** 画面に入ったら true。スマホで WebGL の地図を 2 つ同時に作らないため、2 枚目は入ってから描く（設計書 4.4） */
function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

export function CompareMaps(p: CompareMapsProps) {
  const [inspected, setInspected] = useState<MuniCode | null>(null);
  const maps = useRef<[MlMap | null, MlMap | null]>([null, null]);
  const [secondRef, secondSeen] = useInView<HTMLDivElement>();
  const headRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  const ids = [useId(), useId()];

  // 2 枚目は後から作られることがある。作った時点より前の広さの指定を当て直すと、利用者が 1 枚目で動かした位置を消すので、
  // 作った後に出た指定だけを当てる。作った時点の位置は 1 枚目に合わせる（ready）
  const secondFrom = useRef<number | null>(null);
  if (secondSeen && secondFrom.current === null) secondFrom.current = p.focus?.nonce ?? 0;
  const secondFocus = p.focus && secondFrom.current !== null && p.focus.nonce > secondFrom.current ? p.focus : null;

  // 片方が動いたら、もう片方を同じ場所へ。指を離した後の惰性の動きには originalEvent が付かないので、操作の印では選ばない。
  // 写している間（jumpTo の中で相手の move が起きる）は写し返さない印を立てて、往復しないようにする
  const syncing = useRef(false);
  const copy = (from: MlMap, to: MlMap) => {
    syncing.current = true;
    try {
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom() });
    } finally {
      syncing.current = false;
    }
  };
  const ready = (i: 0 | 1) => (m: MlMap) => {
    maps.current[i] = m;
    const first = maps.current[i === 0 ? 1 : 0];
    if (first) copy(first, m);
    m.on("move", () => {
      const other = maps.current[i === 0 ? 1 : 0];
      if (!syncing.current && other) copy(m, other);
    });
  };

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

  const nameOf = (i: 0 | 1) => (i === 0 ? TEXT.compareFirst : TEXT.compareSecond);
  const labelOf = (season: Season) => p.options.find((o) => o.season === season)?.label ?? `${season} 年`;
  const side = (i: 0 | 1, season: Season, onChange: (s: Season) => void) => (
    <div className="compare-side">
      <p className="compare-pick">
        <label htmlFor={ids[i]}>{nameOf(i)}</label>
        <select id={ids[i]} value={season} onChange={(e) => onChange(Number(e.target.value) as Season)}>
          {p.options.map((o) => (
            <option key={o.season} value={o.season}>
              {TEXT.compareOption(o.label, o.season)}
            </option>
          ))}
        </select>
      </p>
      <div className="map-box" ref={i === 1 ? secondRef : undefined}>
        {i === 0 || secondSeen ? (
          p.renderMap({
            index: i,
            season,
            focus: i === 0 ? p.focus : secondFocus,
            ariaLabel: TEXT.compareMapAria(nameOf(i), TEXT.compareOption(labelOf(season), season)),
            onMapReady: ready(i),
            onInspectMuni: setInspected,
          })
        ) : (
          <p role="status">{TEXT.compareMapWait}</p>
        )}
      </div>
      {p.renderSideNotes(i)}
    </div>
  );

  const seasons: [Season, Season] = [p.first, p.second];
  const asOf = asOfText(p.asOf);
  return (
    <>
      <div className="compare-maps">
        {side(0, p.first, p.onFirst)}
        {side(1, p.second, p.onSecond)}
      </div>
      {inspected ? (
        <section className="town-cases compare-cases" aria-labelledby="compare-cases-h">
          <p className="town-cases-label">{TEXT.panelLabel}</p>
          <h2 id="compare-cases-h" ref={headRef} tabIndex={-1}>
            {p.muniName(inspected) ?? inspected}
          </h2>
          <div className="compare-cases-cols">
            {seasons.map((season, i) => {
              const rows = rowsOf(season, inspected, p);
              const isNow = season === p.current;
              return (
                <div key={`${i}-${season}`} className="compare-cases-col">
                  <h3>
                    <Chunks parts={TEXT.compareHead(nameOf(i as 0 | 1), season)} />
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
          </div>
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
        <p className="map-note compare-hint">{TEXT.compareHint}</p>
      )}
    </>
  );
}
