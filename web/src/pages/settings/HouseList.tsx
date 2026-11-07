// 鶏舎の一覧と、足す、直すの欄（設計書 §8）。
// 鶏舎は消せない。過去の死亡数の記録が鶏舎の id を指しているので、使わなくなったら空舎にする。
// 羽数を直しても、過去の死亡数の記録の羽数（flockSizeAt）は動かさない（saveDeath は呼ばない）。
import type { House } from "@hpai/shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordStore } from "../../data/types";
import { Button } from "../../ui/Button";
import { BIRD_TYPES, HOUSE_NAME_MAX, parseHouseInput } from "./houseForm";

type SavedHouse = House & { id: string };
type Load = { state: "loading" } | { state: "error" } | { state: "ok"; houses: SavedHouse[] };

interface Draft {
  /** なければ新しい鶏舎 */
  id: string | null;
  name: string;
  birdType: string;
  flockSize: string;
  empty: boolean;
}

const BLANK: Draft = { id: null, name: "", birdType: "", flockSize: "", empty: false };

export function HouseList({
  store,
  onSaved,
  onCount,
}: {
  store: Pick<RecordStore, "listHouses" | "saveHouse">;
  /** 鶏舎を保存した後に呼ぶ。農場の updatedAt を進める（失敗しても鶏舎の保存は取り消さない） */
  onSaved: () => Promise<void>;
  /** 鶏舎の件数を親へ返す（ページの上の帯が使う）。読み込み中と読めなかったときは null（ないとは言わない） */
  onCount?: (count: number | null) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const count = load.state === "ok" ? load.houses.length : null;
  useEffect(() => {
    onCount?.(count);
  }, [count, onCount]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // 欄が新しく開いたら、先頭の入力欄へフォーカスを移す（開いたまま入力するたびには動かさない）
  const openedKey = draft === null ? null : (draft.id ?? "new");
  useEffect(() => {
    if (openedKey !== null) nameRef.current?.focus?.();
  }, [openedKey]);

  const reload = useCallback(async () => {
    try {
      const houses = await store.listHouses();
      setLoad({
        state: "ok",
        houses: [...houses].sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true })),
      });
    } catch {
      setLoad({ state: "error" });
    }
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function open(next: Draft) {
    setDraft(next);
    setErrors([]);
    setSaveFailed(false);
  }

  function change(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setErrors([]);
    setSaveFailed(false);
  }

  async function save() {
    if (!draft || saving) return;
    const parsed = parseHouseInput(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    try {
      // 新しい鶏舎は id を持たせない。直すときは同じ id に保存する
      await store.saveHouse(draft.id ? { id: draft.id, ...parsed.house } : parsed.house);
    } catch {
      setSaveFailed(true);
      setSaving(false);
      return;
    }
    setDraft(null);
    setSaving(false);
    await reload();
    try {
      await onSaved();
    } catch {
      // 鶏舎の保存は済んでいる。『最終保存』が進まないだけなので、保存の失敗にはしない
    }
  }

  if (load.state === "loading") return <p role="status">読み込んでいます</p>;
  if (load.state === "error") {
    // 読めなかったときは「ない」と言わない（ないと思って重ねて足さないため）
    return (
      <p className="settings-error" role="alert">
        鶏舎の一覧を読めませんでした。通信を確かめて、ページを読み込み直してください。
      </p>
    );
  }

  return (
    <div className="settings-form">
      <p>鶏舎ごとに、名前、鳥の種類、飼養羽数を登録します。死亡数の記録は、鶏舎ごとにつけます。</p>
      {load.houses.length === 0 ? (
        <p className="settings-note">鶏舎はまだ登録していません。</p>
      ) : (
        <ul className="settings-list">
          {load.houses.map((h) => (
            <li key={h.id}>
              <span className="house-name">{h.name}</span>
              <span>{h.birdType}</span>
              <span>{h.empty ? "空舎" : `${h.flockSize} 羽`}</span>
              <Button
                aria-label={`${h.name}を編集`}
                onClick={() => open({ id: h.id, name: h.name, birdType: h.birdType, flockSize: String(h.flockSize), empty: h.empty })}
              >
                編集
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="settings-note">
        鶏舎は消せません。使わなくなったときは、空舎にします（過去の記録が残ります）。羽数を直しても、過去の記録の羽数は変わりません。
      </p>

      {draft ? (
        <div className="settings-form house-form">
          <label htmlFor="house-name">鶏舎の名前</label>
          <input ref={nameRef} id="house-name" type="text" value={draft.name} maxLength={HOUSE_NAME_MAX} onChange={(e) => change({ name: e.target.value })} />
          <label htmlFor="house-bird">鳥の種類</label>
          <select id="house-bird" value={draft.birdType} onChange={(e) => change({ birdType: e.target.value })}>
            <option value="">選んでください</option>
            {BIRD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label htmlFor="house-flock">飼養羽数</label>
          <input
            id="house-flock"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft.flockSize}
            onChange={(e) => change({ flockSize: e.target.value })}
          />
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.empty}
              onChange={(e) =>
                // 空舎にすると 0 羽。空舎をやめるときは、鶏を入れた羽数を入れ直す
                change(e.target.checked ? { empty: true, flockSize: "0" } : { empty: false, flockSize: draft.flockSize === "0" ? "" : draft.flockSize })
              }
            />
            空舎（いま鶏がいない）
          </label>
          {errors.length > 0 ? (
            <div className="settings-error" role="alert">
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {saveFailed ? (
            <p className="settings-error" role="alert">
              保存できませんでした。通信を確かめて、もう一度試してください。
            </p>
          ) : null}
          <div className="settings-actions">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              鶏舎を保存
            </Button>
            <Button disabled={saving} onClick={() => setDraft(null)}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={() => open(BLANK)}>鶏舎を足す</Button>
        </div>
      )}
    </div>
  );
}
