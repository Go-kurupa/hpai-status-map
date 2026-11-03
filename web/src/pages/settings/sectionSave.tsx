// 設定の各欄の保存の状態。欄ごとに「保存中、保存した、保存できなかった」を持つ。
import { useCallback, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "failed";

/** save を実行し、結果を state に残す。入力が変わったら reset() で idle に戻す（古い『保存しました』を残さない） */
export function useSectionSave(save: () => Promise<void>): { state: SaveState; run: () => Promise<void>; reset: () => void } {
  const [state, setState] = useState<SaveState>("idle");
  const run = useCallback(async () => {
    if (state === "saving") return;
    setState("saving");
    try {
      await save();
      setState("saved");
    } catch {
      setState("failed");
    }
  }, [save, state]);
  const reset = useCallback(() => setState((s) => (s === "saving" ? s : "idle")), []);
  return { state, run, reset };
}

export function SaveStatus({ state }: { state: SaveState }) {
  if (state === "failed") {
    return (
      <p className="settings-error" role="alert">
        保存できませんでした。通信を確かめて、もう一度試してください。
      </p>
    );
  }
  if (state === "saved") return <p role="status">保存しました</p>;
  return null;
}
