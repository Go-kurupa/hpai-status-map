import type { GeoStore } from "@hpai/shared/geo";
import { mesh3Center } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import type { FarmPoint, MuniCode } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useOaza } from "../../data/oaza";
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
  /** 端末内の地点の地区名（地区の一覧で選んで決めたときだけ。端末の中だけ） */
  deviceOaza?: string | null;
  /** 会員の農場や再現の場所を使っている。ここでは何も出さない */
  readOnly: boolean;
  saveFailed: boolean;
  /** 十字を合わせている（地図の上に十字を出すのは親） */
  aiming: boolean;
  onAimingChange(on: boolean): void;
  /** 地区名は、地区の一覧で選び、その目安の点の近く（約 3km 以内）で決めたときだけ。ほかは null */
  onSet(spot: FarmPoint, oazaName: string | null): void;
  onClear(): void;
  /** 地図が描けない端末（WebGL2 がない）。十字の代わりに、町の中心あたりのマス目を使うボタンを出す */
  mapless?: boolean;
  /** 選んでいる町（mapless のとき、地区の一覧で使う） */
  town?: MuniCode | null;
  /** 地区（大字）を選んだら、地図をその目安の点へ寄せる（[経度, 緯度]）。渡さなければ地区の一覧を出さない */
  onAimAt?(lng: number, lat: number): void;
  /** 確かめる候補がある間 true。親はこの間、町の欄の置き場を動かさない（動くと作り直されて候補が消える） */
  onCandidateChange?(has: boolean): void;
  /** 決めた場所を農場の設定でそのまま使えると案内する先。渡さなければ案内しない（見本や再現） */
  registerHref?: string;
}

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

/** 選んだ地区の目安の点から、決めたマス目の中心までがこれより遠ければ、地区名を付けない（違う地区名を出さないため。2026-11-07 作者の了承） */
const OAZA_NEAR_KM = 3;

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371;
}

/**
 * 鶏舎の場所を約 1km のマス目まで決める（任意）。中央の十字の位置を町にして、町の名前で確かめてから保存する。
 * 選択地域の行のすぐ下に置く（2026-11-07 作者の決定 A）。緯度経度はここでも持たない（pickFromMap が捨てる）。
 */
export function SpotPicker(p: SpotPickerProps) {
  const [candidate, setCandidateState] = useState<FarmPoint | null>(null);
  const [candidateOaza, setCandidateOaza] = useState<string | null>(null);
  // 候補の有無は、候補を入れるのと同じ更新の中で親に知らせる（描いた後に知らせると、その間に親の置き場の固定が外れる）
  const setCandidate = (c: FarmPoint | null) => {
    setCandidateState(c);
    p.onCandidateChange?.(c !== null);
  };
  // 候補を持ったまま欄が消えたら（町を外したときなど）、親の「候補あり」を戻す
  const onCandidateChange = p.onCandidateChange;
  useEffect(() => () => onCandidateChange?.(false), [onCandidateChange]);
  const [message, setMessage] = useState<string | null>(null);
  const [oazaPick, setOazaPick] = useState("");
  // 地区の一覧は、十字を合わせている間だけ読む（画面を開いただけでは通信しない。再現や見本の画面も同じ）
  const oaza = useOaza(p.aiming && !p.mapless && p.onAimAt ? p.town : null, p.town ? p.geo?.index[p.town]?.prefCode : null);
  if (p.readOnly) return null;

  const nameOf = (code: string): string => {
    const e = p.geo?.index[code];
    return e ? `${PREF_NAME.get(e.prefCode) ?? ""} ${e.name}`.trim() : code;
  };

  function start() {
    setMessage(null);
    setCandidate(null);
    setCandidateOaza(null);
    setOazaPick("");
    p.onAimingChange(true);
  }
  function stop() {
    setMessage(null);
    setCandidate(null);
    setCandidateOaza(null);
    setOazaPick("");
    p.onAimingChange(false);
  }
  const oazaRows = oaza.status === "ready" ? oaza.rows : [];
  function pickOaza(value: string) {
    setOazaPick(value);
    const row = value === "" ? undefined : oazaRows[Number(value)];
    if (!row) return;
    setMessage(null);
    p.onAimAt?.(row[2], row[1]);
  }
  /** 町の中心（索引の center、[経度, 緯度]）をマス目にする。座標は spotFromPick の中で捨てる */
  function pickCenter() {
    const e = p.town ? p.geo?.index[p.town] : undefined;
    if (!e) return;
    setMessage(null);
    setCandidateOaza(null);
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
    // 地区の一覧で選んだ地区があり、その目安の点の近くで決めたときだけ、地区名を添える
    const row = oazaPick === "" ? undefined : oazaRows[Number(oazaPick)];
    const near = row && r.spot.muniCode === p.town && distanceKm({ lat: row[1], lng: row[2] }, mesh3Center(r.spot.meshCode)) <= OAZA_NEAR_KM;
    setCandidateOaza(near ? row[0] : null);
    setCandidate(r.spot);
    p.onAimingChange(false);
  }

  return (
    <section className="spot-picker" aria-label={TEXT.spotTitle} data-active={p.aiming || candidate ? "true" : undefined}>
      <h2>{TEXT.spotTitle}</h2>
      {candidate ? <p className="map-note">{TEXT.spotWhy}</p> : null}
      {!p.aiming && !candidate ? (
        p.deviceSpot ? (
          <p>
            {nameOf(p.deviceSpot.muniCode)}
            {p.deviceOaza ? ` ${p.deviceOaza}` : ""}の約 1km のマス目。{TEXT.spotSavedNoSend}
          </p>
        ) : (
          <p className="map-note">{TEXT.spotNone}</p>
        )
      ) : null}
      {/* 町が索引にない（合併などで古い値）ときは、農場の設定でそのまま使えないので案内しない */}
      {!p.aiming && !candidate && p.deviceSpot && p.registerHref && p.geo?.index[p.deviceSpot.muniCode] ? (
        <p className="map-note">
          {TEXT.spotRegisterNote}
          <Link to={p.registerHref} className="tap-link">
            {TEXT.spotRegister}
          </Link>
        </p>
      ) : null}
      {p.saveFailed ? <p role="status">{TEXT.spotSaveFailed}</p> : null}

      {candidate ? (
        <div>
          <p>
            <strong>{candidateOaza ? `${nameOf(candidate.muniCode)} ${candidateOaza}` : nameOf(candidate.muniCode)}</strong>の上です。{TEXT.spotConfirm}
          </p>
          <div className="town-actions">
            <Button
              variant="primary"
              onClick={() => {
                p.onSet(candidate, candidateOaza);
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
          {/* 十字の案内と［ここに決める］を先に置く。スマホで地区の欄がボタンを画面の外へ押し出さないように */}
          <p>{TEXT.spotHint}</p>
          {message ? <p role="alert">{message}</p> : null}
          <div className="town-actions">
            <Button variant="primary" onClick={decide}>
              {TEXT.spotSet}
            </Button>
            <Button onClick={stop}>{TEXT.cancel}</Button>
          </div>
          <p className="map-note">{TEXT.spotWhy}</p>
          {/* 地区の一覧が読めて 1 つ以上あるときだけ。読めなくても十字で決められるので、失敗は出さない */}
          {oazaRows.length > 0 ? (
            <div className="spot-oaza">
              <label htmlFor="spot-oaza">{TEXT.oazaLabel}</label>
              <select id="spot-oaza" value={oazaPick} onChange={(e) => pickOaza(e.target.value)}>
                <option value="">{TEXT.oazaChoose}</option>
                {oazaRows.map((r, i) => (
                  <option key={i} value={String(i)}>
                    {r[0]}
                  </option>
                ))}
              </select>
              <p className="map-note">{TEXT.oazaNote}</p>
              <p className="map-note">{TEXT.oazaSource}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="town-actions">
          <Button onClick={start}>{p.deviceSpot ? TEXT.spotRestart : TEXT.spotStart}</Button>
          {p.deviceSpot ? <Button onClick={p.onClear}>{TEXT.spotClear}</Button> : null}
        </div>
      )}
    </section>
  );
}
