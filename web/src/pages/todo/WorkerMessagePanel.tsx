// 働く人への声かけ文（M-18、設計書 §7）。Claude の下書き（なければ雛形）を出し、直してコピーできる。保存しない。
// RecordStore の getCaseDraft だけを使う。sample と再現は呼ばず、読めなかったときも雛形に戻る（例外にしない）。
import { workerMessageTemplate, type DraftFacts } from "@hpai/shared/drafts";
import { normalizeForMatch } from "@hpai/shared/text";
import type { CaseDraft } from "@hpai/shared/types";
import { useEffect, useRef, useState } from "react";
import { useDataSource, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { WORKER_MESSAGE_TEXT as T } from "./texts";

interface Loaded {
  text: string;
  source: CaseDraft["source"];
}

export function WorkerMessagePanel({ caseId, facts }: { caseId: string; facts: DraftFacts }) {
  const store = useRecordStore();
  const ds = useDataSource();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const box = useRef<HTMLTextAreaElement>(null);
  const { muniName, date, stage } = facts;

  useEffect(() => {
    let off = false;
    setLoaded(null);
    setCopy("idle");
    const template: Loaded = { text: workerMessageTemplate({ muniName, date, stage }), source: "template" };
    // sample と再現は Firestore を呼ばない。getCaseDraft が同期で投げても reject と同じく雛形に戻る
    const load: Promise<CaseDraft | null> =
      store.mode === "sample" || ds.mode === "replay" ? Promise.resolve(null) : Promise.resolve().then(() => store.getCaseDraft(caseId));
    load.then(
      (d) => {
        if (!off) setLoaded(d ? { text: d.workerMessage, source: d.source } : template);
      },
      () => {
        if (!off) setLoaded(template);
      },
    );
    return () => {
      off = true;
    };
  }, [store, ds, caseId, muniName, date, stage]);

  const copyText = async () => {
    if (!loaded) return;
    try {
      await navigator.clipboard.writeText(loaded.text);
      setCopy("copied");
    } catch {
      setCopy("failed");
      box.current?.select(); // 手でコピーできるよう、文を選んでおく
    }
  };

  // 疑いで作った下書きのまま確定になったとき、「疑い」が残っていると確定と読めない
  const staleSuspected = loaded !== null && stage === "confirmed" && normalizeForMatch(loaded.text).includes("疑い");

  return (
    <section className="worker-message" role="region" aria-label={T.heading} id="todo-worker" tabIndex={-1}>
      <h2>{T.heading}</h2>
      <p>{T.lead}</p>
      {loaded === null ? (
        <p role="status">{T.loading}</p>
      ) : (
        <>
          <p className="worker-message-source">{loaded.source === "claude" ? T.sourceClaude : T.sourceTemplate}</p>
          <label htmlFor="worker-message-text">{T.label}</label>
          <textarea
              id="worker-message-text"
              ref={box}
              value={loaded.text}
              onChange={(e) => {
                setLoaded({ ...loaded, text: e.target.value });
                setCopy("idle");
              }}
            />
          {staleSuspected ? (
            <p role="alert" className="worker-message-warn">
              {T.staleSuspected}
            </p>
          ) : null}
          <Button variant="primary" onClick={copyText}>
            {T.copy}
          </Button>
          {copy === "copied" ? <p role="status">{T.copied}</p> : null}
          {copy === "failed" ? <p role="alert">{T.copyFailed}</p> : null}
          <p className="worker-message-basis">{T.basis}</p>
          <p className="worker-message-basis">{T.notSaved}</p>
        </>
      )}
    </section>
  );
}
