// 事例にすでにある段階の日付を直す（Q-n）。打ち間違いで正しい日付を上書きしないよう、読み取りの経路は食い違う値を拒む。
// そのため、すでに載った日付が誤っていたときは、ここで運営者が理由つきで直す。確認の段を出し、「直す」を押すまで何も変えない。
// 直すのは日付だけ（段階を足したり消したりしない）。会員へのメールは、この操作では送らない。
import { STAGE_LABELS } from "@hpai/shared/cases";
import { jstDateOf } from "@hpai/shared/dates";
import { checkStageDateFix } from "@hpai/shared/read/correctedCheck";
import { MAX_CORRECTION_REASON, type CorrectStageRequest, type CorrectStageResponse } from "@hpai/shared/read/review";
import type { Case, CaseStage } from "@hpai/shared/types";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../../ui/Button";
import { errorText, prefNameOf } from "./operatorText";
import { useCorrectableCases, type CorrectableCasesState } from "./useCorrectableCases";

export type CorrectFn = (req: CorrectStageRequest) => Promise<CorrectStageResponse>;

interface Props {
  /** 試験用: 事例の状態を渡す（渡さなければ Firestore を購読する） */
  cases?: CorrectableCasesState;
  correct: CorrectFn;
  now: () => Date;
}

const STAGE_ORDER = Object.keys(STAGE_LABELS) as CaseStage[];

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="op-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

const caseLabel = (c: Case): string => {
  const first = Object.values(c.stages).map((s) => s.date).sort()[0] ?? "";
  return `${c.muniName ?? "市町村不明"}（${prefNameOf(c.prefCode) ?? c.prefCode}） ${first} ${c.nationalNo !== null ? `国内 ${c.nationalNo} 例目 ` : ""}[${c.id}]`;
};

function FixForm({ cases, correct, now }: { cases: Case[]; correct: CorrectFn; now: () => Date }) {
  const [caseId, setCaseId] = useState("");
  const [stage, setStage] = useState("");
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"edit" | "confirm" | "busy" | "done">("edit");
  /** 「確かめる」を押した時点の内容。確認の段の表示と送信は、一覧が途中で変わってもこれを使う */
  const [fixed, setFixed] = useState<{ caseId: string; stage: CaseStage; expectedDate: string; newDate: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  const target = cases.find((c) => c.id === caseId) ?? null;
  const stamp = target !== null && stage !== "" ? target.stages[stage as CaseStage] : undefined;
  const stagesOfTarget = target === null ? [] : STAGE_ORDER.filter((s) => target.stages[s] !== undefined);
  const today = jstDateOf(now());

  function reset() {
    setCaseId("");
    setStage("");
    setNewDate("");
    setReason("");
    setError(null);
    setFixed(null);
    setStep("edit");
  }

  function toConfirm() {
    if (target === null || stamp === undefined || newDate === "") return;
    // サーバーと同じ検査を先に当てる（確認の段に進む前に、直せない日付を知らせる）
    const r = checkStageDateFix({ stage: stage as CaseStage, expectedDate: stamp.date, newDate }, { today, season: target.season, stages: target.stages });
    if (!r.ok) return setError(r.message);
    setError(null);
    setFixed({ caseId: target.id, stage: stage as CaseStage, expectedDate: stamp.date, newDate, label: caseLabel(target) });
    setStep("confirm");
  }

  // 確認の段の間に、一覧が更新されることがある。消えた、日付が変わった、は黙って戻さず文で知らせ、「直す」を止める
  const liveStamp = fixed === null ? undefined : cases.find((c) => c.id === fixed.caseId)?.stages[fixed.stage];
  const staleNote =
    fixed === null || step !== "confirm"
      ? null
      : liveStamp === undefined
        ? "この事例は、確かめた後に一覧から消えました。「やめる」を押して、開き直して確かめてください。"
        : liveStamp.date !== fixed.expectedDate
          ? `この段階の日付が、確かめた後に変わりました（いまは ${liveStamp.date}）。「やめる」を押して、もう一度確かめてください。`
          : null;

  async function submit() {
    if (locked.current || fixed === null || staleNote !== null || reason.trim() === "") return;
    locked.current = true;
    setStep("busy");
    setError(null);
    try {
      await correct({ caseId: fixed.caseId, stage: fixed.stage, expectedDate: fixed.expectedDate, newDate: fixed.newDate, reason: reason.trim() });
      setStep("done"); // 次に直すときは「続けて直す」から（同じ操作を 2 度送らない）
    } catch (e) {
      setError(errorText(e));
      setStep("confirm");
      locked.current = false;
    }
  }

  if (step === "done") {
    return (
      <>
        <p role="status">直しました。解除の見込みは新しい日付から計算し直されます。声かけ文の下書きは、新しい日付で作り直されます。会員へのメールは送られません。</p>
        <div className="op-actions">
          <Button
            onClick={() => {
              locked.current = false;
              reset();
            }}
          >
            続けて直す
          </Button>
        </div>
      </>
    );
  }

  const editing = step === "edit";
  // 確認の段の途中で一覧が空になっても、フォームを消さない（消えたことを文で知らせる）
  if (editing && cases.length === 0) return <p>今季の事例はまだありません。</p>;
  return (
    <form
      className="op-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (editing) toConfirm();
      }}
    >
      <Field label="事例">
        {(id) => (
          <select
            id={id}
            value={caseId}
            disabled={!editing}
            onChange={(e) => {
              setCaseId(e.target.value);
              setStage("");
              setNewDate("");
              setError(null);
            }}
          >
            <option value="">選んでください</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {caseLabel(c)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="直す段階">
        {(id) => (
          <select
            id={id}
            value={stage}
            disabled={!editing || target === null}
            onChange={(e) => {
              setStage(e.target.value);
              setNewDate("");
              setError(null);
            }}
          >
            <option value="">選んでください</option>
            {stagesOfTarget.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}（いまは {target!.stages[s]!.date}）
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="新しい日付">
        {(id) => <input id={id} type="date" max={today} value={newDate} disabled={!editing || stamp === undefined} onChange={(e) => setNewDate(e.target.value)} />}
      </Field>

      {!editing && fixed !== null && (
        <div className="op-confirm">
          <p className="op-label">直す内容の確認</p>
          <ul>
            <li>事例: {fixed.label}</li>
            <li>段階: {STAGE_LABELS[fixed.stage]}</li>
            <li>元の日付: {fixed.expectedDate}</li>
            <li>新しい日付: {fixed.newDate}</li>
          </ul>
          {staleNote !== null && <p role="alert" className="op-error">{staleNote}</p>}
          <p className="op-note">直すのは、この段階の日付だけです。直した記録（元の値、新しい値、理由、あなた、時刻）が残ります。会員へのメールは、この操作では送られません。</p>
          <Field label="理由（必須）">
            {(id) => <input id={id} value={reason} maxLength={MAX_CORRECTION_REASON} disabled={step === "busy"} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
      )}

      {error !== null && <p role="alert" className="op-error">{error}</p>}
      <div className="op-actions">
        {editing ? (
          <Button type="submit" variant="primary" disabled={target === null || stamp === undefined || newDate === ""}>
            確かめる
          </Button>
        ) : (
          <>
            <Button variant="primary" disabled={step === "busy" || reason.trim() === "" || staleNote !== null} onClick={() => void submit()}>
              直す
            </Button>
            <Button
              disabled={step === "busy"}
              onClick={() => {
                setStep("edit");
                setError(null);
              }}
            >
              やめる
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

function Body({ state, correct, now }: { state: CorrectableCasesState; correct: CorrectFn; now: () => Date }) {
  if (state.status === "loading") return <p>事例を読み込んでいます</p>;
  if (state.status === "error") return <p role="alert">事例を読み込めませんでした。ページを開き直してください。</p>;
  return <FixForm cases={state.cases} correct={correct} now={now} />;
}

function Live({ correct, now }: { correct: CorrectFn; now: () => Date }) {
  return <Body state={useCorrectableCases(now)} correct={correct} now={now} />;
}

export function StageDateFix({ cases, correct, now }: Props) {
  return (
    <section className="op-page" aria-labelledby="stage-fix-title">
      <h2 id="stage-fix-title">事例の段階の日付を直す</h2>
      <p className="op-note">すでに載っている日付が誤っているときに、理由を添えて直します。読み取りの経路は、食い違う日付で上書きしません。</p>
      {cases !== undefined ? <Body state={cases} correct={correct} now={now} /> : <Live correct={correct} now={now} />}
    </section>
  );
}
