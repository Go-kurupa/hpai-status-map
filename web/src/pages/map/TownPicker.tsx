import type { GeoStore } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import type { MuniCode } from "@hpai/shared/types";
import { useMemo, useState } from "react";
import { Button } from "../../ui/Button";
import { TEXT } from "./texts";

export interface TownPickerProps {
  /** 市町村の一覧（索引）。まだ読めていなければ null */
  geo: Pick<GeoStore, "index"> | null;
  geoFailed: boolean;
  town: MuniCode | null;
  /** 会員の農場や再現の場所を使っている。ここでは変えられない */
  readOnly: boolean;
  /** readOnly のときの説明。既定は会員の農場の場所を使っている旨 */
  readOnlyNote?: string;
  /** 選ぶ画面を開いている（地図の町をさわっても選べる） */
  picking: boolean;
  onPickingChange(open: boolean): void;
  onChoose(code: MuniCode): void;
  onShowJapan(): void;
  onShowTown(): void;
}

/** 県 → 市町村の順に選ぶ。知らない人でも迷わないよう、ふつうの選択欄（select）と大きなボタンだけを使う */
function Chooser({ geo, town, onChoose, onClose }: { geo: Pick<GeoStore, "index">; town: MuniCode | null; onChoose(c: MuniCode): void; onClose(): void }) {
  const [pref, setPref] = useState<string>(() => (town ? (geo.index[town]?.prefCode ?? "") : ""));
  const [muni, setMuni] = useState<string>(() => (town && geo.index[town] ? town : ""));

  const options = useMemo(() => {
    if (!pref) return [];
    const list = Object.values(geo.index)
      .filter((e) => e.prefCode === pref)
      .sort((a, b) => (a.code < b.code ? -1 : 1));
    const dup = new Set(list.filter((e, i) => list.findIndex((x) => x.name === e.name) !== i).map((e) => e.name));
    return list.map((e) => ({ code: e.code, label: dup.has(e.name) ? `${e.name}（${e.code}）` : e.name }));
  }, [geo, pref]);

  return (
    <div className="town-chooser">
      <label className="field">
        <span>{TEXT.prefLabel}</span>
        <select
          value={pref}
          onChange={(e) => {
            setPref(e.target.value);
            setMuni(""); // 別の県のコードを残さない
          }}
        >
          <option value="">{TEXT.prefPlaceholder}</option>
          {PREFS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{TEXT.muniLabel}</span>
        <select value={muni} disabled={!pref} onChange={(e) => setMuni(e.target.value)}>
          <option value="">{TEXT.muniPlaceholder}</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="map-note">{TEXT.mapTapHint}</p>
      <div className="town-actions">
        <Button
          variant="primary"
          disabled={!muni}
          onClick={() => {
            onChoose(muni);
            onClose();
          }}
        >
          {TEXT.decideTown}
        </Button>
        <Button onClick={onClose}>{TEXT.cancel}</Button>
      </div>
    </div>
  );
}

/** 地図の見る場所（全国／自分の町）と、自分の町の選び方 */
export function TownPicker(p: TownPickerProps) {
  if (p.readOnly) {
    return (
      <div className="town-picker">
        <div className="town-actions">
          <Button onClick={p.onShowJapan}>{TEXT.japan}</Button>
          <Button onClick={p.onShowTown}>{TEXT.myTown}</Button>
        </div>
        <p className="map-note">{p.readOnlyNote ?? TEXT.spotFromFarm}</p>
      </div>
    );
  }
  return (
    <div className="town-picker">
      <div className="town-actions">
        <Button onClick={p.onShowJapan}>{TEXT.japan}</Button>
        <Button onClick={p.town ? p.onShowTown : () => p.onPickingChange(true)}>{TEXT.myTown}</Button>
        {p.town && !p.picking ? <Button onClick={() => p.onPickingChange(true)}>{TEXT.changeTown}</Button> : null}
      </div>
      {p.picking ? (
        p.geo ? (
          <Chooser geo={p.geo} town={p.town} onChoose={p.onChoose} onClose={() => p.onPickingChange(false)} />
        ) : p.geoFailed ? (
          <p role="alert">市町村の一覧を読めませんでした。ページを読み込み直してください。</p>
        ) : (
          <p role="status">市町村の一覧を読み込んでいます</p>
        )
      ) : null}
    </div>
  );
}
