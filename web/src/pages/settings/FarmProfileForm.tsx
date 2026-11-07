// 農場の情報（農場名、採卵か肉用か、鶏舎の造り、飼い方）と、家畜保健衛生所の連絡先の欄。設計書 §8。
// 鶏舎の造り（housing）は対策項目の並びに使う。飼い方（rearing: ケージ飼い・平飼い）は、相談の条件に本人が選んだときだけ使う（2026-11-07 作者の決定 B）。
// どちらも、保存は欄ごとに saveFarm へ渡す項目だけにする（ほかの項目を巻き込まない）。
import type { Farm, FarmHousing, FarmRearing, Production } from "@hpai/shared/types";
import { useState } from "react";
import { Button } from "../../ui/Button";
import { SaveStatus, useSectionSave } from "./sectionSave";

export type SaveFarmPatch = (patch: Partial<Farm>) => Promise<void>;

export const FARM_NAME_MAX = 60;
export const KAHO_CONTACT_MAX = 300;

const PRODUCTION_OPTIONS: ReadonlyArray<{ value: Production; label: string }> = [
  { value: "layer", label: "採卵" },
  { value: "broiler", label: "肉用" },
];
const HOUSING_OPTIONS: ReadonlyArray<{ value: FarmHousing; label: string }> = [
  { value: "windowless", label: "窓のない鶏舎" },
  { value: "open", label: "開放的な鶏舎" },
  { value: "free_range", label: "屋外にも出す（放し飼い）" },
];
// 国の事例一覧（data/history/cases.json）と同じ語
const REARING_OPTIONS: ReadonlyArray<{ value: FarmRearing; label: string }> = [
  { value: "cage", label: "ケージ飼い" },
  { value: "floor", label: "平飼い" },
];

export function FarmBasicsForm({
  farm,
  save,
}: {
  farm: Pick<Farm, "name" | "production" | "housing" | "rearing">;
  save: SaveFarmPatch;
}) {
  const [name, setName] = useState(farm.name);
  const [production, setProduction] = useState<Production | null>(farm.production);
  const [housing, setHousing] = useState<FarmHousing | null>(farm.housing);
  // 項目がない前からの農場は未登録（選ばない）として開く
  const [rearing, setRearing] = useState<FarmRearing | null>(farm.rearing ?? null);
  const { state, run, reset } = useSectionSave(() => save({ name: name.trim(), production, housing, rearing }));

  return (
    <div className="settings-form">
      <label htmlFor="farm-name">農場名</label>
      <input
        id="farm-name"
        type="text"
        value={name}
        maxLength={FARM_NAME_MAX}
        autoComplete="off"
        onChange={(e) => {
          setName(e.target.value);
          reset();
        }}
      />
      <p className="settings-note">農場名は、この農場の会員にだけ見えます。</p>

      <fieldset className="settings-choice">
        <legend>採卵か肉用か</legend>
        {PRODUCTION_OPTIONS.map((o) => (
          <label key={o.value} className="settings-check">
            <input
              type="radio"
              name="production"
              checked={production === o.value}
              onChange={() => {
                setProduction(o.value);
                reset();
              }}
            />
            {o.label}
          </label>
        ))}
        <label className="settings-check">
          <input
            type="radio"
            name="production"
            checked={production === null}
            onChange={() => {
              setProduction(null);
              reset();
            }}
          />
          用途を選ばない
        </label>
        <p className="settings-note">出荷についての項目を出し分けるのに使います。選ばないときは、確認リストは両方を出します。</p>
      </fieldset>

      <fieldset className="settings-choice">
        <legend>鶏舎の造り</legend>
        {HOUSING_OPTIONS.map((o) => (
          <label key={o.value} className="settings-check">
            <input
              type="radio"
              name="housing"
              checked={housing === o.value}
              onChange={() => {
                setHousing(o.value);
                reset();
              }}
            />
            {o.label}
          </label>
        ))}
        <label className="settings-check">
          <input
            type="radio"
            name="housing"
            checked={housing === null}
            onChange={() => {
              setHousing(null);
              reset();
            }}
          />
          鶏舎の造りを選ばない
        </label>
        <p className="settings-note">鶏舎の造りは、確かめておくとよいことの並びに使います。選ばないときは、決まった並びで出します。</p>
      </fieldset>

      <fieldset className="settings-choice">
        <legend>飼い方</legend>
        {REARING_OPTIONS.map((o) => (
          <label key={o.value} className="settings-check">
            <input
              type="radio"
              name="rearing"
              checked={rearing === o.value}
              onChange={() => {
                setRearing(o.value);
                reset();
              }}
            />
            {o.label}
          </label>
        ))}
        <label className="settings-check">
          <input
            type="radio"
            name="rearing"
            checked={rearing === null}
            onChange={() => {
              setRearing(null);
              reset();
            }}
          />
          飼い方を選ばない
        </label>
        <p className="settings-note">「AIに対策を相談」で、条件として付けられます。付けるかは、相談のたびに選びます。</p>
      </fieldset>

      <div>
        <Button variant="primary" disabled={state === "saving"} onClick={() => void run()}>
          農場の情報を保存
        </Button>
      </div>
      <SaveStatus state={state} />
    </div>
  );
}

export function KahoContactForm({ farm, save }: { farm: Pick<Farm, "kahoContact">; save: SaveFarmPatch }) {
  const [text, setText] = useState(farm.kahoContact);
  const { state, run, reset } = useSectionSave(() => save({ kahoContact: text.trim() }));

  return (
    <div className="settings-form">
      <label htmlFor="kaho-contact">家畜保健衛生所の連絡先</label>
      <p className="settings-note">
        県の案内を見て、窓口の名前や連絡の方法を、自分で書き写して残します。異状があって通報が必要なとき、画面にこの内容を出します。空のままでも使えます。
      </p>
      <textarea
        id="kaho-contact"
        rows={4}
        value={text}
        maxLength={KAHO_CONTACT_MAX}
        placeholder="管轄の家畜保健衛生所の名前、窓口の時間帯、時間外の連絡方法など"
        onChange={(e) => {
          setText(e.target.value);
          reset();
        }}
      />
      <div>
        <Button variant="primary" disabled={state === "saving"} onClick={() => void run()}>
          家畜保健衛生所の連絡先を保存
        </Button>
      </div>
      <SaveStatus state={state} />
    </div>
  );
}
