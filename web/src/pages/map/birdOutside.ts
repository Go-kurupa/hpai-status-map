// 約 60 km より遠い野鳥の陽性の帯（2026-11-07 作者の決定 C）。鶏舎の付近・選択地域付近を見ているときに、
// 輪の中心から遠い陽性を県名で知らせる。印の位置は地図（MapView・SvgMap）と同じ決め方（町の中心、なければ県の代表の位置）
import { useEffect, useState } from "react";
import { haversineKm } from "@hpai/shared/geo";
import type { MuniCode, PrefCode, WildBird } from "@hpai/shared/types";
import { loadPrefAnchors } from "../../geo/loadGeo";
import { birdPrefsText } from "./birdStat";

type LngLat = readonly [number, number];

/** 地図と同じ印の位置。町の中心、なければ県の代表の位置。どちらもなければ null（地図にも印がない） */
export function birdPosition(
  b: Pick<WildBird, "muniCode" | "prefCode">,
  index: Readonly<Record<MuniCode, { center: [number, number] } | undefined>>,
  anchors: Readonly<Partial<Record<PrefCode, [number, number]>>> | null,
): LngLat | null {
  const entry = b.muniCode ? index[b.muniCode] : undefined;
  return entry ? entry.center : (anchors?.[b.prefCode] ?? null);
}

/**
 * 輪の中心から km より遠い野鳥の陽性（陰性は除く）の県名。地図に印のない陽性（位置が決まらない）も入れる。なければ null。
 */
export function birdsFarText(
  birds: readonly WildBird[],
  center: LngLat,
  index: Readonly<Record<MuniCode, { center: [number, number] } | undefined>>,
  anchors: Readonly<Partial<Record<PrefCode, [number, number]>>> | null,
  km: number,
): string | null {
  return birdPrefsText(
    birds.filter((b) => {
      const at = birdPosition(b, index, anchors);
      return at === null || haversineKm(center, at) > km;
    }),
  );
}

/** 県の代表の位置。読めなければ null のまま（市町村の分からない陽性は、地図と同じく印なしとして扱う） */
export function usePrefAnchors(): Partial<Record<PrefCode, [number, number]>> | null {
  const [anchors, setAnchors] = useState<Partial<Record<PrefCode, [number, number]>> | null>(null);
  useEffect(() => {
    let off = false;
    loadPrefAnchors().then(
      (a) => {
        if (!off) setAnchors(a);
      },
      () => {},
    );
    return () => {
      off = true;
    };
  }, []);
  return anchors;
}
