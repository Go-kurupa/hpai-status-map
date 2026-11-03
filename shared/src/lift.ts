// 解除の見込み（設計書 §7「いつまで」）。区域に入っている可能性があるとき（段階①）だけに使う。
// 防疫措置の完了日から、移動制限は 21 日後、監視強化は 28 日後に「解除できる最も早い日」を数える。
// 「見込み」であって、解除の決定は県が検査の結果を受けて行う（文は呼び出し側が「県の連絡が正です」を添える）。
// 解除の基準は全発生農場なので、同じ市町村か隣の市町村で進行中の事例があれば、最も遅い完了日で数える。
import { addDays } from "./dates";
import { isAdjacent, type GeoStore } from "./geo";
import { isZoneActive } from "./level";
import type { Case, IsoDate } from "./types";

/** 防疫措置の完了から、移動制限を解除できる最短の日数（完了の日を 0 として数える前の基準） */
export const MOVEMENT_DAYS = 21;
/** 同じく、監視強化区域 */
export const SURVEILLANCE_DAYS = 28;

export const SHIPMENT_PENDING_TEXT = "検査の結果を受けて県が解除します";
export const SHIPMENT_LIFTED_TEXT = "搬出制限は解除されました";

export interface LiftEstimate {
  /** undetermined 未定／published 県の発表／calculated 完了日から計算／lifted 解除された */
  status: "undetermined" | "published" | "calculated" | "lifted";
  movement: IsoDate | null;
  surveillance: IsoDate | null;
  /** 計算の元にした防疫措置の完了日（最も遅いもの）。計算した日がないとき（未定、すべて県の発表）は null */
  basisControlDone: IsoDate | null;
  /** true なら「続発があると延びます」を添える */
  extendedByChain: boolean;
  shipmentText: string;
}

/** 完了の日から days 日たった次の日（完了 12/30 + 21 日 → 1/21）。 */
export function liftDate(controlDone: IsoDate, days: number): IsoDate {
  return addDays(controlDone, days + 1);
}

/** target と同じシーズンで、区域が続いていて、同じ市町村か隣の市町村にある、ほかの事例。 */
function chainOf(target: Case, all: readonly Case[], geo: GeoStore): Case[] {
  const muni = target.muniCode;
  if (muni === null) return [];
  return all.filter(
    (c) =>
      c.id !== target.id &&
      c.season === target.season &&
      isZoneActive(c) &&
      c.muniCode !== null &&
      (c.muniCode === muni || isAdjacent(muni, c.muniCode, geo)),
  );
}

export function computeLiftEstimate(target: Case, all: readonly Case[], geo: GeoStore): LiftEstimate {
  const shipmentLifted = target.stages.shipment_lifted !== undefined || target.stages.movement_lifted !== undefined;
  const shipmentText = shipmentLifted ? SHIPMENT_LIFTED_TEXT : SHIPMENT_PENDING_TEXT;

  if (target.stages.movement_lifted !== undefined) {
    return { status: "lifted", movement: null, surveillance: null, basisControlDone: null, extendedByChain: false, shipmentText };
  }

  const chain = chainOf(target, all, geo);
  const extendedByChain = chain.length > 0;

  // 全発生農場が基準。1 つでも防疫措置の完了がなければ、計算できない
  const group = [target, ...chain];
  const dones = group.map((c) => c.stages.control_done?.date);
  const complete = dones.every((d): d is IsoDate => typeof d === "string");
  const basis = complete ? dones.reduce((a, b) => (a >= b ? a : b)) : null; // 同じ形の日付は文字列の順が日付の順

  const published = target.prefEstimates.movement;
  if (published !== null) {
    return {
      status: "published",
      movement: published,
      surveillance: target.prefEstimates.surveillance ?? (basis === null ? null : liftDate(basis, SURVEILLANCE_DAYS)),
      // 監視強化の日を完了日から計算したときだけ、その元を残す（県の発表のとおりの日には元がない）
      basisControlDone: target.prefEstimates.surveillance === null ? basis : null,
      extendedByChain,
      shipmentText,
    };
  }

  if (basis === null) {
    return { status: "undetermined", movement: null, surveillance: null, basisControlDone: null, extendedByChain, shipmentText };
  }
  return {
    status: "calculated",
    movement: liftDate(basis, MOVEMENT_DAYS),
    surveillance: target.prefEstimates.surveillance ?? liftDate(basis, SURVEILLANCE_DAYS),
    basisControlDone: basis,
    extendedByChain,
    shipmentText,
  };
}
