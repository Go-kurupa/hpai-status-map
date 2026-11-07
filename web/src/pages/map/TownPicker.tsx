import type { GeoStore } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import type { MuniCode } from "@hpai/shared/types";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../ui/Button";
import { TEXT } from "./texts";
import { searchTowns } from "./townSearch";

export interface TownPickerProps {
  /** 市町村の一覧（索引）。まだ読めていなければ null */
  geo: Pick<GeoStore, "index"> | null;
  geoFailed: boolean;
  town: MuniCode | null;
  /** 会員の農場や再現の場所を使っている。ここでは変えられない */
  readOnly: boolean;
  /** readOnly のときの説明。既定は会員の農場の場所を使っている旨 */
  readOnlyNote?: string;
  /** この端末に鶏舎の場所（くわしい場所）がある。別の町にすると消えることを前もって伝える */
  hasSpot?: boolean;
  /** 地図を押しても選べると書く。地図がない画面（/town）では false。既定は true */
  mapHint?: boolean;
  /** 選ぶ画面を開いている（地図の町をさわっても選べる） */
  picking: boolean;
  onPickingChange(open: boolean): void;
  onChoose(code: MuniCode): void;
}

/**
 * 町の名前を入力して探すか、県 → 市町村の順に選ぶ。入力の候補は押すとすぐ決まる（設計書 2026-11-06-town-picker D2）。
 * 文字を打つのが苦手な人のため、ふつうの選択欄（select）と大きなボタンも残す
 */
function Chooser({ geo, town, hasSpot, mapHint, onChoose, onClose }: { geo: Pick<GeoStore, "index">; town: MuniCode | null; hasSpot: boolean; mapHint: boolean; onChoose(c: MuniCode): void; onClose(): void }) {
  const [pref, setPref] = useState<string>(() => (town ? (geo.index[town]?.prefCode ?? "") : ""));
  const hintId = useId();
  const [muni, setMuni] = useState<string>(() => (town && geo.index[town] ? town : ""));
  const [query, setQuery] = useState("");
  // かな漢字の変換の途中は、ひらがなで「見つかりません」を点滅させない
  const [composing, setComposing] = useState(false);
  const found = useMemo(() => searchTowns(geo.index, query), [geo, query]);
  const decide = (code: MuniCode) => {
    onChoose(code);
    onClose();
  };

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
      {hasSpot ? <p className="map-note">{TEXT.spotWillClear}</p> : null}
      <label className="field town-search">
        <span>{TEXT.searchLabel}</span>
        <input
          type="search"
          value={query}
          placeholder={TEXT.searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
      </label>
      {found.hits.length > 0 ? (
        <ul className="town-hits">
          {found.hits.map((h) => (
            <li key={h.code}>
              <Button onClick={() => decide(h.code)}>{h.label}</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {found.more > 0 ? <p className="map-note">{TEXT.searchMore(found.more)}</p> : null}
      {query.trim() && found.hits.length === 0 && !composing ? <p role="status">{TEXT.searchNone}</p> : null}
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
      {mapHint ? <p className="map-note">{TEXT.mapTapHint}</p> : null}
      <div className="town-actions">
        <Button
          variant="primary"
          disabled={!muni}
          aria-describedby={muni ? undefined : hintId}
          onClick={() => decide(muni)}
        >
          {TEXT.decideTown}
        </Button>
        <Button onClick={onClose}>{TEXT.cancel}</Button>
      </div>
      {muni ? null : <p id={hintId}>{TEXT.decideHint}</p>}
    </div>
  );
}

/** 自分の町の選び方。地図の見る場所の切り替えは、地図のすぐ上にある */
export function TownPicker(p: TownPickerProps) {
  if (p.readOnly) {
    return (
      <div className="town-picker">
        <p>{p.readOnlyNote ?? TEXT.spotFromFarm}</p>
        {p.readOnlyNote ? null : (
          <Link to="/settings/farm" className="tap-link">
            {TEXT.openFarmSettings}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="town-picker">
      <div className="town-actions">
        {p.town ? (
          p.picking ? null : <Button onClick={() => p.onPickingChange(true)}>{TEXT.changeTown}</Button>
        ) : (
          <Button variant="primary" className="town-pick-btn" onClick={() => p.onPickingChange(true)}>
            {TEXT.pickTown}
          </Button>
        )}
      </div>
      {p.picking ? (
        p.geo ? (
          <Chooser geo={p.geo} town={p.town} hasSpot={p.hasSpot ?? false} mapHint={p.mapHint ?? true} onChoose={p.onChoose} onClose={() => p.onPickingChange(false)} />
        ) : p.geoFailed ? (
          <p role="alert">市町村の一覧を読み込めませんでした。ページを読み込み直してください。</p>
        ) : (
          <p role="status">市町村の一覧を読み込んでいます</p>
        )
      ) : null}
    </div>
  );
}
