// 自分の地点と町（契約 3.10）。優先は fixed（再現）→ 会員の農場 → 端末内。
// 会員の農場（getFarm）は、useSpot が最初に呼ばれるまで読まない。根に置いても、地点を使わない公開の画面で
// Firebase を読み込まないため。再現（fixed）は getFarm を呼ばず、端末内の保存を書かない（読むだけ）。
import type { FarmPoint, MuniCode } from "@hpai/shared/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOptionalRecordStore } from "./context";
import { clearSpot, loadSpot, loadTown, parseSpot, saveSpot, saveTown } from "./spot";

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
  /** 端末に保存できなかった（そのページを開いているあいだだけ使える） */
  saveFailed: boolean;
  /** 端末内の地点を決める。町も同じ市町村にする。fixed では何もしない */
  setDeviceSpot(spot: FarmPoint): void;
  clearDeviceSpot(): void;
  /** 町を選ぶ。別の市町村を選んだら前のくわしい場所を消す（古い場所が新しい町を上書きしないため） */
  setTown(code: MuniCode | null): { clearedSpot: boolean };
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
  const [farm, setFarm] = useState<FarmPoint | null>(null);
  const [farmRequested, setFarmRequested] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const farmPromise = useRef<ReturnType<NonNullable<typeof store>["getFarm"]> | null>(null);

  const requestFarm = useCallback(() => setFarmRequested(true), []);

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
        if (!off) setFarm(null); // 読めなければ会員の農場なし（M-01 の本実装は権限や通信の失敗で reject する）
      },
    );
    return () => {
      off = true;
    };
  }, [fixed, farmRequested, store]);

  const setDeviceSpot = useCallback(
    (spot: FarmPoint) => {
      if (!readsDevice) return;
      const clean = parseSpot(spot);
      if (!clean) return;
      const ok = saveSpot(clean) && saveTown(clean.muniCode);
      setSaveFailed(!ok);
      setDevice(clean);
      setStoredTown(clean.muniCode);
    },
    [readsDevice],
  );

  const clearDeviceSpot = useCallback(() => {
    if (!readsDevice) return;
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
      readOnly: source === "fixed" || source === "farm",
      deviceSpot: device,
      saveFailed,
      setDeviceSpot,
      clearDeviceSpot,
      setTown,
      requestFarm,
    };
  }, [fixed, farm, device, storedTown, readsDevice, saveFailed, setDeviceSpot, clearDeviceSpot, setTown, requestFarm]);

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

/** 使う地点。fixed → 会員の農場 → 端末内の順 */
export function useSpot(): FarmPoint | null {
  return useSpotState().spot;
}

/** 自分の町。地点があればその市町村、なければ端末で選んだ町 */
export function useTown(): { town: MuniCode | null; setTown: SpotState["setTown"]; readOnly: boolean } {
  const { town, setTown, readOnly } = useSpotState();
  return { town, setTown, readOnly };
}
