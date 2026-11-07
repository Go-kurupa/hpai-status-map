// 鶏舎の一覧（表）と、登録、直すの欄（設計書 §8。2026-11-07 業務画面の作り直しで表にした）。
// 鶏舎は消せない。過去の死亡数の記録が鶏舎の id を指しているので、使わなくなったら空舎にする。
// 羽数を直しても、過去の死亡数の記録の羽数（flockSizeAt）は動かさない（saveDeath は呼ばない）。
import type { House } from "@hpai/shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordStore } from "../../data/types";
import { Button } from "../../ui/Button";
import { BIRD_TYPES, HOUSE_NAME_MAX, parseHouseInput } from "./houseForm";

type SavedHouse = House & { id: string };
type Load = { state: "loading" } | { state: "error" } | { state: "ok"; houses: SavedHouse[] };

/** ページの上の札と「次にすること」に渡す鶏舎のまとめ。読み込み中と読めなかったときは、0 件とは言わない */
export type HouseSummary = { status: "loading" } | { status: "failed" } | { status: "ok"; count: number; total: number };

/** 登録と編集の欄の中の注記（一覧の下には出さない） */
export const HOUSE_NOTE = "鶏舎は消せません。使わなくなった鶏舎は「空舎」にします。羽数を直しても、過去の記録の羽数は変わりません。";

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
  onSummary,
}: {
  store: Pick<RecordStore, "listHouses" | "saveHouse">;
  /** 鶏舎を保存した後に呼ぶ。農場の updatedAt を進める（失敗しても鶏舎の保存は取り消さない） */
  onSaved: () => Promise<void>;
  /** 鶏舎の件数と合計羽数（空舎を除く）を親へ返す（ページの上の札と次にすることが使う） */
  onSummary?: (summary: HouseSummary) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const count = load.state === "ok" ? load.houses.length : null;
  const total = load.state === "ok" ? load.houses.filter((h) => !h.empty).reduce((sum, h) => sum + h.flockSize, 0) : null;
  useEffect(() => {
    onSummary?.(
      load.state === "loading"
        ? { status: "loading" }
        : load.state === "error" || count === null || total === null
          ? { status: "failed" }
          : { status: "ok", count, total },
    );
  }, [load.state, count, total, onSummary]);
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
        鶏舎の一覧を読み込めませんでした。通信を確かめて、ページを読み込み直してください。
      </p>
    );
  }

  // 一覧の上の合計（空舎を除く）。鶏のいる鶏舎がなければ出さない（2026-11-07 精査 D）
  const stocked = load.houses.filter((h) => !h.empty);

  return (
    <div className="settings-form">
      <p>鶏舎ごとに、名前、鳥の種類、飼養羽数を登録します。</p>
      {load.houses.length === 0 ? (
        <p className="settings-note">鶏舎はまだ登録していません。</p>
      ) : (
        <>
          {stocked.length > 0 ? <p className="house-total">{`合計 ${(total ?? 0).toLocaleString("ja-JP")} 羽（空舎を除く）`}</p> : null}
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th scope="col">鶏舎</th>
                  <th scope="col">鳥の種類</th>
                  <th scope="col">飼養羽数</th>
                  <th scope="col">状態</th>
                  <th scope="col">
                    <span className="settings-visually-hidden">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {load.houses.map((h) => (
                  <tr key={h.id}>
                    <th scope="row" className="house-name">
                      {h.name}
                    </th>
                    <td>{h.birdType}</td>
                    <td className="settings-num">{h.empty ? "—" : `${h.flockSize.toLocaleString("ja-JP")} 羽`}</td>
                    <td>{h.empty ? "空舎" : "飼育中"}</td>
                    <td>
                      <Button
                        aria-label={`${h.name}を編集`}
                        onClick={() => open({ id: h.id, name: h.name, birdType: h.birdType, flockSize: String(h.flockSize), empty: h.empty })}
                      >
                        編集
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {draft ? (
        <div className="settings-form house-form">
          <p className="settings-note">{HOUSE_NOTE}</p>
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
            className="settings-number"
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
          <Button onClick={() => open(BLANK)}>{load.houses.length === 0 ? "鶏舎を登録する" : "鶏舎を追加する"}</Button>
        </div>
      )}
    </div>
  );
}
