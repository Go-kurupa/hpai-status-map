// 自分の地点と町（契約 3.10）。優先は fixed（再現）→ 会員の農場 → 端末内。
// 会員の農場（getFarm）は、useSpot が最初に呼ばれるまで読まない。根に置いても、地点を使わない公開の画面で
// Firebase を読み込まないため。再現（fixed）は getFarm を呼ばず、端末内の保存を書かない（読むだけ）。
import type { FarmPoint, MuniCode } from "@hpai/shared/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOptionalRecordStore } from "./context";
import { clearSpot, clearSpotOaza, loadSpot, loadSpotOaza, loadTown, parseSpot, saveSpot, saveSpotOaza, saveTown } from "./spot";

export type SpotSource = "fixed" | "farm" | "device";

export interface SpotState {
  /** 使う地点。fixed → 会員の農場 → 端末内の順 */
  spot: FarmPoint | null;
  source: SpotSource | null;
  /** 地点があればその市町村、なければ端末で選んだ町 */
  town: MuniCode | null;
  /** fixed か会員の農場が地点のとき true。端末内の町や場所を変えても見える形が変わらない */
  readOnly: boolean;
  /** 端末内の地点（農場や fixed があっても持っている値） */
  deviceSpot: FarmPoint | null;
  /** 鶏舎の場所の地区名。地区の一覧で選んで決めたときだけ、同じマス目の場所に付ける。端末の中だけで送らない（2026-11-07 作者の決定） */
  spotOaza: string | null;
  /** 端末に保存できなかった（そのページを開いているあいだだけ使える） */
  saveFailed: boolean;
  /** 端末内の地点を決める。町も同じ市町村にする。地区名は一覧で選んで決めたときだけ渡す（渡さなければ消す）。fixed では何もしない */
  setDeviceSpot(spot: FarmPoint, oazaName?: string | null): void;
  clearDeviceSpot(): void;
  /** 町を選ぶ。別の市町村を選んだら前のくわしい場所を消す（古い場所が新しい町を上書きしないため） */
  setTown(code: MuniCode | null): { clearedSpot: boolean };
  /** 会員の農場を読み直す。農場の設定で保存した後に呼び、ページを読み込み直さなくても地図を農場の場所にする */
  refreshFarm(): void;
}

interface Internal extends SpotState {
  requestFarm(): void;
}

const SpotContext = createContext<Internal | null>(null);

function toPoint(farm: { meshCode: string; muniCode: string; frequentMuniCodes: string[] } | null): FarmPoint | null {
  return farm ? parseSpot({ meshCode: farm.meshCode, muniCode: farm.muniCode, frequentMuniCodes: farm.frequentMuniCodes }) : null;
}

export function SpotProvider({ fixed = null, children }: { fixed?: FarmPoint | null; children: ReactNode }) {
  const store = useOptionalRecordStore();
  // 端末内の値は、fixed があっても読んでおく（読むだけ。再現が「選択地域で見る」に切り替えられる）。書くのは fixed がないときだけ
  const readsDevice = fixed === null;
  const [device, setDevice] = useState<FarmPoint | null>(() => loadSpot());
  const [storedTown, setStoredTown] = useState<MuniCode | null>(() => loadTown());
  // 地区名は、端末内の地点のマス目と組で読む（マス目が違えば付けない）
  const [oaza, setOaza] = useState<{ meshCode: string; name: string } | null>(() => {
    const spot = loadSpot();
    const name = spot ? loadSpotOaza(spot.meshCode) : null;
    return spot && name ? { meshCode: spot.meshCode, name } : null;
  });
  const [farm, setFarm] = useState<FarmPoint | null>(null);
  const [farmRequested, setFarmRequested] = useState(false);
  const [farmVersion, setFarmVersion] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const farmPromise = useRef<ReturnType<NonNullable<typeof store>["getFarm"]> | null>(null);

  const requestFarm = useCallback(() => setFarmRequested(true), []);
  const refreshFarm = useCallback(() => {
    farmPromise.current = null;
    setFarmVersion((v) => v + 1);
    setFarmRequested(true);
  }, []);

  useEffect(() => {
    if (fixed !== null || !farmRequested || !store) return;
    // 約束を覚えて 1 度だけ呼ぶ（開発時の二重実行でも getFarm を重ねない）
    farmPromise.current ??= store.getFarm();
    let off = false;
    farmPromise.current.then(
      (f) => {
        if (!off) setFarm(toPoint(f));
      },
      () => {
        // 最初に読めなければ会員の農場なし（M-01 の本実装は権限や通信の失敗で reject する）。
        // 読み直し（refreshFarm）の失敗では、読めていた農場の場所を残す（一時的な失敗で端末の場所に戻さない）
        if (!off && farmVersion === 0) setFarm(null);
      },
    );
    return () => {
      off = true;
    };
  }, [fixed, farmRequested, store, farmVersion]);

  const setDeviceSpot = useCallback(
    (spot: FarmPoint, oazaName?: string | null) => {
      if (!readsDevice) return;
      const clean = parseSpot(spot);
      if (!clean) return;
      const named = oazaName ? { meshCode: clean.meshCode, name: oazaName } : null;
      const oazaOk = named ? saveSpotOaza(named) : clearSpotOaza();
      setOaza(named && oazaOk ? named : null);
      const ok = saveSpot(clean) && saveTown(clean.muniCode);
      setSaveFailed(!ok);
      setDevice(clean);
      setStoredTown(clean.muniCode);
    },
    [readsDevice],
  );

  const clearDeviceSpot = useCallback(() => {
    if (!readsDevice) return;
    clearSpotOaza();
    setOaza(null);
    setSaveFailed(!clearSpot());
    setDevice(null);
  }, [readsDevice]);

  const deviceRef = useRef(device);
  deviceRef.current = device;
  const setTown = useCallback(
    (code: MuniCode | null) => {
      if (!readsDevice) return { clearedSpot: false };
      let clearedSpot = false;
      const current = deviceRef.current;
      let ok = saveTown(code);
      if (current && current.muniCode !== code) {
        clearSpotOaza();
        setOaza(null);
        ok = clearSpot() && ok;
        setDevice(null);
        clearedSpot = true;
      }
      setSaveFailed(!ok);
      setStoredTown(code);
      return { clearedSpot };
    },
    [readsDevice],
  );

  const value = useMemo<Internal>(() => {
    const spot = fixed ?? farm ?? device;
    const source: SpotSource | null = fixed ? "fixed" : farm ? "farm" : device ? "device" : null;
    return {
      spot,
      source,
      town: spot?.muniCode ?? storedTown,
      // 再現（fixed）では付けない。会員の農場でも、同じマス目なら同じ端末で決めた地区名を付ける
      spotOaza: !fixed && oaza && spot?.meshCode === oaza.meshCode ? oaza.name : null,
      readOnly: source === "fixed" || source === "farm",
      deviceSpot: device,
      saveFailed,
      setDeviceSpot,
      clearDeviceSpot,
      setTown,
      refreshFarm,
      requestFarm,
    };
  }, [fixed, farm, device, storedTown, oaza, readsDevice, saveFailed, setDeviceSpot, clearDeviceSpot, setTown, refreshFarm, requestFarm]);

  return <SpotContext.Provider value={value}>{children}</SpotContext.Provider>;
}

/** 状態の全部。最初に呼ばれたときに会員の農場を読み始める */
export function useSpotState(): SpotState {
  const v = useContext(SpotContext);
  if (!v) throw new Error("SpotProvider の中で使ってください");
  const { requestFarm } = v;
  useEffect(() => requestFarm(), [requestFarm]);
  return v;
}

/**
 * Provider の外では null（農場の設定を単独で描く試験など）。会員の農場の読み込みは始めない
 * （農場の設定は自分で getFarm を読み、保存の後に refreshFarm で地図側へ知らせる）
 */
export function useOptionalSpotState(): SpotState | null {
  return useContext(SpotContext);
}

/** 使う地点。fixed → 会員の農場 → 端末内の順 */
export function useSpot(): FarmPoint | null {
  return useSpotState().spot;
}

/** 自分の町。地点があればその市町村、なければ端末で選んだ町 */
export function useTown(): { town: MuniCode | null; setTown: SpotState["setTown"]; readOnly: boolean } {
  const { town, setTown, readOnly } = useSpotState();
  return { town, setTown, readOnly };
}
