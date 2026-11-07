import { DISTANCE_BAND_KM } from "@hpai/shared/level";
import type { NearbyPastSummary, NearbyTown, SmallFlockCount } from "@hpai/shared/past";
import { seasonAgoLabel } from "@hpai/shared/season";
import type { MuniCode, Season } from "@hpai/shared/types";
import { RiskLine } from "../../ui/RiskLine";
import { TEXT } from "./texts";

export type NearbyPastState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | {
      status: "ready";
      /** center: 町の中心どうし。mesh: 農場のマス目から町の面まで */
      basis: "center" | "mesh";
      summary: NearbyPastSummary;
      smallFlocks: SmallFlockCount;
      current: Season;
    };

function TownTable({ towns, town, current }: { towns: readonly NearbyTown[]; town: MuniCode | null; current: Season }) {
  return (
    <div className="table-scroll">
      <table className="data-table data-table-stack" role="table" aria-label={TEXT.nearbyAria}>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">{TEXT.nearbyColTown}</th>
            <th role="columnheader" scope="col" className="num">{TEXT.nearbyColDistance}</th>
            <th role="columnheader" scope="col" className="num">{TEXT.nearbyColCount}</th>
            <th role="columnheader" scope="col">{TEXT.nearbyColSeason}</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {towns.map((t) => (
            <tr role="row" key={t.muniCode}>
              <th role="rowheader" scope="row">{t.name}</th>
              <td role="cell" className="num" data-label={TEXT.nearbyColDistance}>{t.muniCode === town ? TEXT.nearbySameTown : TEXT.nearbyDistance(t.distanceKm)}</td>
              <td role="cell" className="num" data-label={TEXT.nearbyColCount}>{t.count} 件</td>
              <td role="cell" data-label={TEXT.nearbyColSeason}>{t.seasons.map((s) => seasonAgoLabel(s, current)).join("、")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 周辺の町の過去の発生。事実の表で、色を使わない。多い少ないを書かない。地図の町の枠では表を畳む（地図を下へ押しやらない） */
export function NearbyPast({ state, town, collapsed = false, riskShown }: { state: NearbyPastState; town: MuniCode | null; collapsed?: boolean; riskShown: boolean }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <p className="nearby-past">{TEXT.nearbyLoading}</p>;
  if (state.status === "failed") {
    return (
      <p className="nearby-past" role="alert">
        {TEXT.nearbyFailed}
      </p>
    );
  }
  const { summary, basis, smallFlocks, current } = state;
  if (summary.windowSeasons === 0) return null;
  const hasTowns = summary.towns.length > 0;
  const table = hasTowns ? (
    <>
      <TownTable towns={summary.towns} town={town} current={current} />
      <p className="town-note">{basis === "mesh" ? TEXT.nearbyBasisMesh : TEXT.nearbyBasisCenter}</p>
    </>
  ) : null;
  return (
    <div className="nearby-past">
      <h2 className="nearby-title">{TEXT.nearbyTitle(DISTANCE_BAND_KM, summary.windowSeasons)}</h2>
      <p>{hasTowns ? TEXT.nearbyTotal(summary.total, summary.seasonsWithCases, summary.windowSeasons) : TEXT.nearbyNone(DISTANCE_BAND_KM, summary.windowSeasons)}</p>
      {!hasTowns && !riskShown ? <RiskLine className="town-note" /> : null}
      {table && collapsed ? (
        <details className="past-details">
          <summary>{TEXT.nearbyDetails}</summary>
          {table}
        </details>
      ) : (
        table
      )}
      <p className="town-note">{TEXT.statBandRelated}</p>
      <p>{TEXT.smallFlocks(summary.windowSeasons, smallFlocks.total, smallFlocks.known, smallFlocks.small)}</p>
    </div>
  );
}
