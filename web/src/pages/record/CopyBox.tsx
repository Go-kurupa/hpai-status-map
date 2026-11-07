// 報告文の下書きを出してコピーさせる部品。送らない（送るのは人）。保存も呼ばない。
import { useState } from "react";
import { Button } from "../../ui/Button";
import { RECORD_TEXT } from "./recordTexts";

export function CopyBox({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="copy-box">
      <textarea
        aria-label={label}
        readOnly
        rows={Math.min(24, Math.max(6, value.split("\n").length + 1))}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="no-print">
        {/* 主のボタンは各画面の「記録する」だけ。コピーは secondary */}
        <Button onClick={() => void copy()}>
          {RECORD_TEXT.copy}
        </Button>
        {state === "copied" ? <p role="status">{RECORD_TEXT.copied}</p> : null}
        {state === "failed" ? <p role="alert">{RECORD_TEXT.copyFailed}</p> : null}
      </div>
    </div>
  );
}
