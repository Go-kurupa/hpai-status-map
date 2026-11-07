// よく行き来する町（設計書 §5 の③）を選ぶ部品。県を選び、市町村を 1 つずつ足す。
// 保存するのは市町村のコード（GeoStore.index のキー。政令市は市のコード）だけ。住所も緯度経度も聞かない。
// 1 つを選ぶ TownPicker とは別の部品（こちらは複数を持つ）。
import type { GeoStore } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import type { MuniCode } from "@hpai/shared/types";
import { useMemo, useState } from "react";
import { Button } from "../../ui/Button";
import { SaveStatus, useSectionSave } from "./sectionSave";

/** 足せる町の数【計】 */
export const MAX_FREQUENT_MUNIS = 20;

const prefName = (code: string) => PREFS.find((p) => p.code === code)?.name ?? "";

export function MuniMultiPicker({
  geo,
  geoFailed,
  farmMuniCode,
  initial,
  save,
}: {
  /** 索引を読むまで null */
  geo: GeoStore | null;
  geoFailed: boolean;
  /** 農場の町。ここは足せない（農場の地点で見ているため） */
  farmMuniCode: MuniCode;
  initial: readonly MuniCode[];
  save: (codes: MuniCode[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<MuniCode[]>(() => [...new Set(initial)]);
  const [prefCode, setPrefCode] = useState("");
  const [town, setTown] = useState("");

  // 農場の町が後から変わっても、農場の町は持たない
  const shown = useMemo(() => selected.filter((c) => c !== farmMuniCode), [selected, farmMuniCode]);
  const { state, run, reset } = useSectionSave(() => save(shown));

  const choices = useMemo(
    () =>
      geo
        ? Object.values(geo.index)
            .filter((m) => m.prefCode === prefCode)
            .sort((a, b) => a.code.localeCompare(b.code))
        : [],
    [geo, prefCode],
  );

  const blocked: string | null =
    town === farmMuniCode
      ? "農場の町は足せません。農場の地点として登録してあります。"
      : shown.includes(town)
        ? "この町はもう追加してあります。"
        : shown.length >= MAX_FREQUENT_MUNIS
          ? `${MAX_FREQUENT_MUNIS} 件までです。追加するには、どれかを外してください。`
          : null;

  function add() {
    if (town === "" || blocked) return;
    setSelected([...shown, town]);
    setTown("");
    reset();
  }

  return (
    <div className="settings-form">
      <p>仕事や用事でよく行き来する町を追加します。その町で発生したときに、知らせます。</p>
      <p className="settings-note">
        {shown.length} / {MAX_FREQUENT_MUNIS} 件
      </p>

      {shown.length > 0 ? (
        <ul className="settings-list">
          {shown.map((code) => {
            const m = geo?.index[code];
            const name = m ? m.name : code;
            return (
              <li key={code}>
                <span>{m ? `${prefName(m.prefCode)} ${m.name}` : code}</span>
                <Button
                  aria-label={`${name}を外す`}
                  onClick={() => {
                    setSelected(shown.filter((c) => c !== code));
                    reset();
                  }}
                >
                  外す
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="settings-note">まだ追加していません。</p>
      )}

      <label htmlFor="frequent-pref">追加する町の県</label>
      <select
        id="frequent-pref"
        value={prefCode}
        onChange={(e) => {
          setPrefCode(e.target.value);
          setTown("");
        }}
      >
        <option value="">選んでください</option>
        {PREFS.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </select>
      <label htmlFor="frequent-town">追加する町</label>
      <select id="frequent-town" value={town} disabled={prefCode === "" || !geo} onChange={(e) => setTown(e.target.value)}>
        <option value="">選んでください</option>
        {choices.map((m) => (
          <option key={m.code} value={m.code}>
            {m.name}
          </option>
        ))}
      </select>
      {geoFailed ? <p className="settings-note">市町村の一覧を読み込めなかったため、町を追加できません。</p> : null}
      {blocked ? <p className="settings-note">{blocked}</p> : null}
      <div>
        <Button disabled={town === "" || blocked !== null} onClick={add}>
          この町を追加する
        </Button>
      </div>

      <div>
        <Button variant="primary" disabled={state === "saving"} onClick={() => void run()}>
          行き来する町を保存
        </Button>
      </div>
      <SaveStatus state={state} />
    </div>
  );
}
