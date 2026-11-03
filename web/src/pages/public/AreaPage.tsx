import { toJstIso } from "@hpai/shared/dates";
import { OFFICIAL_GUIDANCE } from "@hpai/shared/guidance/official";
import { computeAreaStatus } from "@hpai/shared/level";
import type { AreaStatus } from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { useDataSource } from "../../data/context";
import { PastList } from "../map/PastList";
import { TEXT } from "../map/texts";
import { areaLine, neighborPrefsOf, withWatchState, type TownLine } from "../map/townLine";
import { useGeoStore, usePast } from "../map/useTownView";
import { useSeasonData } from "../map/useSeasonData";
import { WatchAsOf, WatchLine } from "../map/WatchLine";
import "../map/map.css";
import "./public.css";

type Computed =
  | { kind: "geo_failed" }
  | { kind: "geo_loading" }
  | { kind: "not_found" }
  | { kind: "cases_loading"; name: string }
  | { kind: "failed"; name: string }
  | { kind: "ready"; name: string; line: TownLine; status: AreaStatus };

const isWebUrl = (url: string) => /^https?:\/\//u.test(url);

/**
 * 市町村の案内 /area/{市町村コード}（§11）。その市町村と隣の市町村の状況と、要点へのリンク。登録なしで読める。
 * 地点がないので距離は見ない（computeAreaStatus だけを使い、全段階で areaNoDistance と riskAnywhere を出す）。
 * 農場の記録の口（RecordStore）も端末内の地点も使わない。Firebase を読まない。農場の情報は載せない。
 */
export default function AreaPage() {
  const { muniCode = "" } = useParams();
  const ds = useDataSource();
  const d = useSeasonData();
  const { geo, failed: geoFailed } = useGeoStore();
  const now = ds.now();
  const nowMinute = Math.floor(now.getTime() / 60_000);

  const computed = useMemo<Computed>(() => {
    if (geoFailed) return { kind: "geo_failed" };
    if (geo === null) return { kind: "geo_loading" };
    // constructor、toString など、オブジェクトが元から持つ名前は市町村ではない
    const entry = Object.hasOwn(geo.index, muniCode) ? geo.index[muniCode] : undefined;
    if (!entry) return { kind: "not_found" }; // 区のコード（政令市の区）や未知のコード。「発生なし」に見せない
    if (d.currentCases === null) return { kind: "cases_loading", name: entry.name };
    try {
      const status = computeAreaStatus({
        muniCode,
        cases: d.currentCases,
        wildBirds: d.wildBirds,
        geo,
        asOf: toJstIso(new Date(nowMinute * 60_000)),
        season: d.current,
      });
      // この町の県、隣の県が見回りで確認できていないときは、それを 1 文に足す（④だけで済ませない）
      const line = withWatchState(areaLine(status), entry.prefCode, d.failedPrefCodes, neighborPrefsOf(muniCode, geo));
      return { kind: "ready", name: entry.name, line, status };
    } catch {
      return { kind: "failed", name: entry.name }; // 壊れた記録で画面を落とさない。「発生なし」にも見せない
    }
  }, [geo, geoFailed, muniCode, d.currentCases, d.wildBirds, d.current, d.failedPrefCodes, nowMinute]);

  const known = geo !== null && Object.hasOwn(geo.index, muniCode);
  const past = usePast({
    town: known ? muniCode : null,
    history: d.history,
    historyFailed: d.historyFailed,
    geo,
    geoFailed: false, // 市町村の形が読めないときは、過去の行を出さずに 1 つの失敗の文だけにする
    current: d.current,
  });

  const name = "name" in computed ? computed.name : null;
  const showWatch = computed.kind === "ready" || computed.kind === "cases_loading" || computed.kind === "failed";

  return (
    <div className="area-page">
      <h1>{name ? `${name}の状況` : "町の状況"}</h1>

      {computed.kind === "not_found" ? (
        <>
          <p role="status">この市町村は見つかりません</p>
          <p>アドレスをお確かめください。</p>
        </>
      ) : null}
      {computed.kind === "geo_failed" ? (
        <p role="alert">{TEXT.loadFailed}</p>
      ) : null}
      {computed.kind === "geo_loading" || computed.kind === "cases_loading" ? (
        <p className="town-now-wait" role="status">
          {TEXT.loading}
        </p>
      ) : null}
      {computed.kind === "failed" ? (
        <p className="town-now-wait" role="alert">
          {TEXT.loadFailed}
        </p>
      ) : null}

      {showWatch ? <WatchAsOf loaded={d.watchLoaded} line={d.watch} /> : null}

      {computed.kind === "ready" ? (
        <>
          <div className="town-now" data-tone={computed.line.tone} role="status">
            <p className="town-main">{computed.line.main}</p>
            {computed.line.details.length > 0 ? (
              <ul className="town-details">
                {computed.line.details.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <p>{FIXED_TEXT.prefContactIsAuthority}</p>
          {computed.status.sourceUrls.some(isWebUrl) ? (
            <ul className="area-sources">
              {computed.status.sourceUrls.filter(isWebUrl).map((u) => (
                <li key={u}>
                  <a href={u} target="_blank" rel="noopener noreferrer">
                    出典
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {showWatch ? <WatchLine loaded={d.watchLoaded} line={d.watch} /> : null}

      {known && computed.kind !== "geo_failed" ? (
        <div className="town-past">
          {past.status === "loading" ? <p>{TEXT.pastLoading}</p> : null}
          {past.status === "failed" ? <p role="alert">{TEXT.pastFailed}</p> : null}
          {past.status === "ready" ? (
            <>
              <p>
                <span className="town-label">{TEXT.pastLabel}</span> {past.summary.sentence}
              </p>
              <PastList hits={past.summary.hits} />
              <p className="town-note">{FIXED_TEXT.pastDisclaimer}</p>
            </>
          ) : null}
        </div>
      ) : null}

      <nav aria-label="くわしい説明" className="area-links">
        <h2>くわしい説明</h2>
        <ul>
          {OFFICIAL_GUIDANCE.map((g) => (
            <li key={g.topic}>
              <Link to={`/public#${g.topic}`}>{g.heading}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <p>
        <Link to="/">地図にもどる</Link>
      </p>
    </div>
  );
}
