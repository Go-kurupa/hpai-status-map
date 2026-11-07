// 自己点検（設計書 §8）。7 項目を「できている」「できていない」の押しボタンで記録し、報告文（○×）を作ってコピーする。送るのは人（送信のボタンは置かない）。
// 期限は農場ごとに設定する（固定しない）。RecordStore と DataSource だけを使う。
import { jstDateOf } from "@hpai/shared/dates";
import { formatJaDate } from "@hpai/shared/jaDate";
import { buildSelfCheckReport, SELF_CHECK_ITEMS, SELF_CHECK_SOURCE_NOTE } from "@hpai/shared/reports";
import type { Farm, SelfCheckItemNo } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordSaves, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { CopyBox } from "./CopyBox";
import { FarmGuide, useFarmRecord } from "./disinfectionLog";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

type Answers = Record<SelfCheckItemNo, "ok" | "ng" | null>;
const BLANK: Answers = { "17": null, "18": null, "19": null, "22": null, "23": null, "25": null, "27": null };

function SelfCheckBody({ farm }: { farm: Farm & { id: string } }) {
  const store = useRecordStore();
  const ds = useDataSource();
  const { saved: noteSaved } = useRecordSaves();
  const today = jstDateOf(ds.now());
  const month = today.slice(0, 7);
  const monthLabel = `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

  const [answers, setAnswers] = useState<Answers>(BLANK);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let off = false;
    store.listChecks(`${month}-01`, today).then(
      (rows) => {
        if (off) return;
        for (const r of rows) {
          if (r.kind === "self_inspection" && r.month === month) setAnswers({ ...BLANK, ...r.answers });
        }
        setLoaded(true);
      },
      () => {
        if (!off) setReadFailed(true);
      },
    );
    return () => {
      off = true;
    };
    // month と today は ds.now() から決まる。画面を開いている間は変えない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const due = farm.selfCheckDue[month];
  const report = buildSelfCheckReport({ farmName: farm.name, month, answers });

  function pick(no: SelfCheckItemNo, v: "ok" | "ng" | null) {
    setAnswers((a) => ({ ...a, [no]: v }));
    setSaved(false);
  }

  async function save() {
    if (busy || !loaded) return;
    setBusy(true);
    setFailed(false);
    try {
      await store.saveCheck({ kind: "self_inspection", date: today, month, answers });
      setSaved(true);
      noteSaved(); // 上の「最後の記録」を読み直させる
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <>
      <p>{RECORD_TEXT.selfMonth(monthLabel)}</p>
      {due ? (
        <p>{RECORD_TEXT.selfDue(safeJa(due))}</p>
      ) : (
        <p>
          {RECORD_TEXT.selfDueMissing}。 <Link to="/settings/notify">{RECORD_TEXT.selfDueLink}</Link>
        </p>
      )}
      <p className="record-note">{SELF_CHECK_SOURCE_NOTE}</p>
      {readFailed ? <p role="alert">{RECORD_TEXT.readFailed}</p> : null}
      <p>{RECORD_TEXT.selfMeaning}</p>
      {SELF_CHECK_ITEMS.map((it) => (
        <fieldset key={it.no} className="self-item">
          <legend>
            {it.no} {it.label}
          </legend>
          <div className="self-answer">
            {(
              [
                ["ok", RECORD_TEXT.selfOk],
                ["ng", RECORD_TEXT.selfNg],
              ] as const
            ).map(([v, text]) => (
              // 押していない状態が未記入。押してある方をもう一度押すと未記入に戻す（保存の形は ok・ng・null のまま）
              <Button key={v} aria-pressed={answers[it.no] === v} disabled={!loaded} onClick={() => pick(it.no, answers[it.no] === v ? null : v)}>
                {text}
              </Button>
            ))}
          </div>
        </fieldset>
      ))}
      <Button variant="primary" disabled={busy || !loaded} onClick={() => void save()}>
        {busy ? RECORD_TEXT.saving : RECORD_TEXT.selfSave}
      </Button>
      {saved ? <p role="status">{RECORD_TEXT.saved}</p> : null}
      {failed ? <p role="alert">{RECORD_TEXT.saveFailed}</p> : null}
      <h2>{RECORD_TEXT.selfReportHeading}</h2>
      <p className="record-note">{RECORD_TEXT.selfReportNote}</p>
      <CopyBox label={RECORD_TEXT.selfReportLabel} value={report} />
    </>
  );
}

function safeJa(d: string): string {
  try {
    return formatJaDate(d);
  } catch {
    return d;
  }
}

export function SelfCheckPanel() {
  const farm = useFarmRecord();
  return (
    <section className="self-check-panel">
      <h1>{RECORD_TEXT.selfTitle}</h1>
      <p>{RECORD_TEXT.selfLead}</p>
      <FarmGuide farm={farm} />
      {farm.status === "loading" ? <p role="status">{RECORD_TEXT.loading}</p> : null}
      {farm.status === "ready" ? <SelfCheckBody farm={farm.farm} /> : null}
    </section>
  );
}

export default SelfCheckPanel;
