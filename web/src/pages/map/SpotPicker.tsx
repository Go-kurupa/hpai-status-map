import type { GeoStore } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import type { FarmPoint, MuniCode } from "@hpai/shared/types";
import { useState } from "react";
import { Button } from "../../ui/Button";
import { spotFromPick } from "../../data/spot";
import { pickFromMap, type PickTarget } from "./pickSpot";
import { TEXT } from "./texts";

export interface SpotPickerProps {
  /** 地図。まだ作られていなければ null */
  getMap(): PickTarget | null;
  geo: Pick<GeoStore, "index"> | null;
  /** 端末内の地点（行き来する町を引き継ぎ、消せるようにする） */
  deviceSpot: FarmPoint | null;
  /** 会員の農場や再現の場所を使っている。ここでは何も出さない */
  readOnly: boolean;
  saveFailed: boolean;
  /** 十字を合わせている（地図の上に十字を出すのは親） */
  aiming: boolean;
  onAimingChange(on: boolean): void;
  onSet(spot: FarmPoint): void;
  onClear(): void;
  /** 地図が描けない端末（WebGL2 がない）。十字の代わりに、町の中心あたりのマス目を使うボタンを出す */
  mapless?: boolean;
  /** 選んでいる町（mapless のときに使う） */
  town?: MuniCode | null;
}

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

/**
 * 約 1km のマス目まで場所を決める（任意）。中央の十字の位置を町にして、町の名前で確かめてから保存する。
 * 緯度経度はここでも持たない（pickFromMap が捨てる）。
 */
export function SpotPicker(p: SpotPickerProps) {
  const [candidate, setCandidate] = useState<FarmPoint | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (p.readOnly) return null;

  const nameOf = (code: string): string => {
    const e = p.geo?.index[code];
    return e ? `${PREF_NAME.get(e.prefCode) ?? ""} ${e.name}`.trim() : code;
  };

  function start() {
    setMessage(null);
    setCandidate(null);
    p.onAimingChange(true);
  }
  function stop() {
    setMessage(null);
    setCandidate(null);
    p.onAimingChange(false);
  }
  /** 町の中心（索引の center、[経度, 緯度]）をマス目にする。座標は spotFromPick の中で捨てる */
  function pickCenter() {
    const e = p.town ? p.geo?.index[p.town] : undefined;
    if (!e) return;
    setMessage(null);
    setCandidate(spotFromPick(e.center[1], e.center[0], e.code, p.deviceSpot?.frequentMuniCodes ?? []));
  }
  const canUseCenter = !!(p.town && p.geo?.index[p.town]);
  function decide() {
    const map = p.getMap();
    if (!map) {
      setMessage(TEXT.spotMapWait);
      return;
    }
    const r = pickFromMap(map, p.deviceSpot?.frequentMuniCodes ?? []);
    if (!r.ok) {
      setMessage(r.reason === "zoom" ? TEXT.spotZoom : TEXT.spotSea);
      return;
    }
    setMessage(null);
    setCandidate(r.spot);
    p.onAimingChange(false);
  }

  return (
    <section className="spot-picker" aria-label={TEXT.spotTitle} data-active={p.aiming || candidate ? "true" : undefined}>
      <h2>{TEXT.spotTitle}</h2>
      <p className="map-note">{TEXT.spotWhy}</p>
      {p.deviceSpot && !p.aiming && !candidate ? (
        <p>
          {nameOf(p.deviceSpot.muniCode)}の約 1km のマス目。{TEXT.spotSaved}
        </p>
      ) : null}
      {p.saveFailed ? <p role="status">{TEXT.spotSaveFailed}</p> : null}

      {candidate ? (
        <div>
          <p>
            <strong>{nameOf(candidate.muniCode)}</strong>の上です。{TEXT.spotConfirm}
          </p>
          <div className="town-actions">
            <Button
              variant="primary"
              onClick={() => {
                p.onSet(candidate);
                stop();
              }}
            >
              {TEXT.spotDecide}
            </Button>
            <Button onClick={p.mapless ? () => setCandidate(null) : start}>{TEXT.spotRetry}</Button>
          </div>
        </div>
      ) : p.mapless ? (
        <div>
          <p className="map-note">{TEXT.spotNoMap}</p>
          {canUseCenter ? null : <p className="map-note">{TEXT.noTown}</p>}
          <div className="town-actions">
            <Button disabled={!canUseCenter} onClick={pickCenter}>
              {TEXT.meshUseCenter}
            </Button>
            {p.deviceSpot ? <Button onClick={p.onClear}>{TEXT.spotClear}</Button> : null}
          </div>
        </div>
      ) : p.aiming ? (
        <div>
          <p>{TEXT.spotHint}</p>
          {message ? <p role="alert">{message}</p> : null}
          <div className="town-actions">
            <Button variant="primary" onClick={decide}>
              {TEXT.spotSet}
            </Button>
            <Button onClick={stop}>{TEXT.cancel}</Button>
          </div>
        </div>
      ) : (
        <div className="town-actions">
          <Button onClick={start}>{TEXT.spotStart}</Button>
          {p.deviceSpot ? <Button onClick={p.onClear}>{TEXT.spotClear}</Button> : null}
        </div>
      )}
    </section>
  );
}
