// 農場の全データの削除（設計書 §8、§12）。記録の画面の「出力と削除」から、農場の設定の一番下へ移した（2026-11-07）。
// 削除は取り消せないので、農場の名前を入れるまで押せない。見本の農場（sample）には出さない（呼ぶ側で止める）。
// 説明はプライバシーの説明（web/src/pages/privacy/privacyNotice.ts の「消し方」）と同じ内容にする。
import type { Farm } from "@hpai/shared/types";
import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import { RECORD_TEXT } from "../record/recordTexts";

export function DeleteFarmForm({ farm, onDone }: { farm: Farm & { id: string }; onDone: () => void }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const nameMissing = farm.name === "";

  async function remove() {
    if (busy || nameMissing || typed !== farm.name) return;
    setBusy(true);
    setFailed(false);
    try {
      const { deleteFarmDataCall } = await import("../auth/callables");
      await deleteFarmDataCall(farm.id, typed);
      onDone();
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <div className="settings-form settings-delete">
      <p>
        <strong>{RECORD_TEXT.deleteWarn}</strong>
      </p>
      <p>{RECORD_TEXT.deleteGone}</p>
      <p>{RECORD_TEXT.deleteKept}</p>
      <p>{RECORD_TEXT.deleteAnyMember}</p>
      {/* 状態の説明なので role="alert" にしない（畳んだ欄の中から、開く前に読み上げない） */}
      {nameMissing ? <p className="settings-error">{RECORD_TEXT.deleteNameMissing}</p> : null}
      <label htmlFor={`${id}-name`}>{RECORD_TEXT.deleteInput}</label>
      <input
        id={`${id}-name`}
        type="text"
        autoComplete="off"
        value={typed}
        disabled={nameMissing}
        onChange={(e) => setTyped(e.target.value)}
      />
      <Button className="settings-delete-button" disabled={busy || nameMissing || typed !== farm.name} onClick={() => void remove()}>
        {busy ? RECORD_TEXT.deleting : RECORD_TEXT.deleteButton}
      </Button>
      {failed ? (
        <p className="settings-error" role="alert">
          {RECORD_TEXT.deleteFailed}
        </p>
      ) : null}
    </div>
  );
}
