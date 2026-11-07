// 自己点検（設計書 §8。2026-11-07 業務画面の作り直し）。
// 上から: 題と 1 文 → 状態の札 → 次にすること → 7 項目（1 行 1 項目）→ 記録する → 報告文 → これまでの自己点検。
// 7 項目を「できている」「できていない」の押しボタンで記録し、報告文（○×）を作ってコピーする。送るのは人（送信のボタンは置かない）。
// 期限は農場ごとに設定する（固定しない）。RecordStore と DataSource だけを使う。保存の形（ok・ng・null）は変えない。
// 画面の見出しは平易な文（確認リストの always-17 など）、報告文は法令の語（SELF_CHECK_ITEMS）のまま。
import { CHECKLIST_ITEMS } from "@hpai/shared/checklist";
import { addDays, diffDays, jstDateOf } from "@hpai/shared/dates";
import { formatJaDate } from "@hpai/shared/jaDate";
import { buildSelfCheckReport, SELF_CHECK_ITEMS, SELF_CHECK_SOURCE_NOTE } from "@hpai/shared/reports";
import type { Farm, IsoDate, SelfCheckItemNo } from "@hpai/shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordSaves, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { RowItem, RowList, type RowMark } from "../../ui/RowList";
import { StatRow, StatTile, type StatValue } from "../../ui/StatRow";
import { CopyBox } from "./CopyBox";
import { FarmGuide, useFarmRecord } from "./disinfectionLog";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

type Answer = "ok" | "ng" | null;
type Answers = Record<SelfCheckItemNo, Answer>;
const BLANK: Answers = { "17": null, "18": null, "19": null, "22": null, "23": null, "25": null, "27": null };

/** 過去の月も読む日数（記録の画面のほかの読み込みと同じ 120 日） */
const LOOKBACK_DAYS = 120;

/** 基準の項目番号 → 確認リストの項目 id（平易な文はそちらから引く。shared は変えない） */
const PLAIN_ID: Record<SelfCheckItemNo, string> = {
  "17": "always-17",
  "18": "always-18",
  "19": "always-19",
  "22": "always-22",
  "23": "always-23",
  "25": "always-25",
  "27": "always-27",
};
const PLAIN_TEXT = new Map(CHECKLIST_ITEMS.map((i) => [i.id, i.text]));

/** 画面の見出しにする平易な文。確認リストに見つからなければ法令の語に戻す */
function selfCheckPlainText(no: SelfCheckItemNo, fallback: string): string {
  return PLAIN_TEXT.get(PLAIN_ID[no]) ?? fallback;
}

interface MonthRecord {
  month: string;
  date: IsoDate;
  answers: Answers;
}

type History = { status: "loading" } | { status: "failed" } | { status: "ok"; rows: MonthRecord[] };

/** "2026-11" → "2026年11月" */
function monthLabelOf(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

function safeJa(d: string): string {
  try {
    return formatJaDate(d);
  } catch {
    return d;
  }
}

function countOf(a: Answers) {
  const values = SELF_CHECK_ITEMS.map((it) => a[it.no]);
  return {
    ok: values.filter((v) => v === "ok").length,
    ng: values.filter((v) => v === "ng").length,
    blank: values.filter((v) => v === null || v === undefined).length,
  };
}

const MARK: Record<"ok" | "ng" | "blank", RowMark> = { ok: "yes", ng: "no", blank: "todo" };

function SelfCheckBody({ farm }: { farm: Farm & { id: string } }) {
  const store = useRecordStore();
  const ds = useDataSource();
  const { saved: noteSaved } = useRecordSaves();
  const today = jstDateOf(ds.now());
  const month = today.slice(0, 7);
  const monthLabel = monthLabelOf(month);

  const [answers, setAnswers] = useState<Answers>(BLANK);
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    store.listChecks(addDays(today, -LOOKBACK_DAYS), today).then(
      (rows) => {
        if (off) return;
        const byMonth = new Map<string, MonthRecord>();
        for (const r of rows) {
          if (r.kind !== "self_inspection") continue;
          const prev = byMonth.get(r.month);
          // 同じ月の記録は 1 つ（id が月ごと）。念のため、記録した日の新しい方を使う
          if (!prev || prev.date <= r.date) byMonth.set(r.month, { month: r.month, date: r.date, answers: { ...BLANK, ...r.answers } });
        }
        const mine = byMonth.get(month);
        // 答えの読み戻しは今月の分だけ
        if (mine) setAnswers(mine.answers);
        setHistory({ status: "ok", rows: [...byMonth.values()] });
      },
      () => {
        if (!off) setHistory({ status: "failed" });
      },
    );
    return () => {
      off = true;
    };
    // month と today は ds.now() から決まる。画面を開いている間は変えない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const loaded = history.status === "ok";
  const thisMonth = history.status === "ok" ? (history.rows.find((r) => r.month === month) ?? null) : null;
  const due = farm.selfCheckDue[month];
  const report = buildSelfCheckReport({ farmName: farm.name, month, answers });
  const blankNow = countOf(answers).blank;

  function pick(no: SelfCheckItemNo, v: Answer) {
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
      // 札と表の今月の行を、記録した内容に直す（同じ月の記録は置き換わる）
      setHistory((h) =>
        h.status === "ok" ? { status: "ok", rows: [...h.rows.filter((r) => r.month !== month), { month, date: today, answers }] } : h,
      );
      noteSaved(); // 上の「最後に記録した日」を読み直させる
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  /** 読み込み中は「…」、読めなければ「読み込めませんでした」（0 や未記録と言わない） */
  const stat = (f: () => ReactNode): StatValue =>
    history.status === "loading" ? { status: "loading" } : history.status === "failed" ? { status: "failed" } : { status: "ok", value: f() };

  const savedCount = thisMonth ? SELF_CHECK_ITEMS.length - countOf(thisMonth.answers).blank : 0;
  const historyRows = history.status === "ok" ? [...history.rows].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)) : [];

  return (
    <>
      <StatRow label={RECORD_TEXT.selfStatsLabel}>
        <StatTile
          label={RECORD_TEXT.selfMonthTile(monthLabel)}
          // 大きな値は「記録済み」「未記録」の語だけ。記録した日は note へ
          value={stat(() => (thisMonth ? RECORD_TEXT.selfRecorded : RECORD_TEXT.selfNotRecorded))}
          note={thisMonth ? RECORD_TEXT.selfRecordedOn(safeJa(thisMonth.date)) : undefined}
        />
        {due ? (
          <StatTile label={RECORD_TEXT.selfDueTile} value={{ status: "ok", value: safeJa(due) }} note={RECORD_TEXT.selfDueLeft(diffDays(due, today))} />
        ) : (
          <StatTile
            label={RECORD_TEXT.selfDueTile}
            value={{ status: "ok", value: RECORD_TEXT.selfDueMissing }}
            // 期限は任意の項目なので赤くしない（通知の設定の札と同じ。赤は次の作業を止める未登録だけ）
            // 見本の農場では会員向けの設定へ案内しない
            note={store.mode === "sample" ? undefined : <Link to="/settings/notify">{RECORD_TEXT.selfDueLink}</Link>}
          />
        )}
        <StatTile label={RECORD_TEXT.selfAnsweredTile} value={stat(() => `${savedCount} / ${SELF_CHECK_ITEMS.length}`)} />
      </StatRow>

      {history.status === "failed" ? <p role="alert">{RECORD_TEXT.readFailed}</p> : null}
      {loaded ? <p className="record-next">{`次にすること: ${thisMonth ? RECORD_TEXT.selfNextDone : RECORD_TEXT.selfNext}`}</p> : null}

      <RowList label={RECORD_TEXT.selfItemsLabel}>
        {SELF_CHECK_ITEMS.map((it) => {
          const plain = selfCheckPlainText(it.no, it.label);
          const a = answers[it.no];
          const kind = a === "ok" ? "ok" : a === "ng" ? "ng" : "blank";
          return (
            <RowItem
              key={it.no}
              mark={MARK[kind]}
              markLabel={kind === "blank" ? RECORD_TEXT.selfMarkBlank : undefined}
              title={plain}
              sub={RECORD_TEXT.selfItemBasis(it.no, it.label)}
              act={
                // 読み上げと試験は「17 …」の名前でこのまとまりを探す（e2e の場面 5 も）
                <div role="group" aria-label={`${it.no} ${plain}`} className="self-answer">
                  {(
                    [
                      ["ok", RECORD_TEXT.selfOk],
                      ["ng", RECORD_TEXT.selfNg],
                    ] as const
                  ).map(([v, text]) => (
                    // 押していない状態が未記入。押してある方をもう一度押すと未記入に戻す（保存の形は ok・ng・null のまま）
                    <Button key={v} aria-pressed={a === v} disabled={!loaded} onClick={() => pick(it.no, a === v ? null : v)}>
                      {text}
                    </Button>
                  ))}
                </div>
              }
            />
          );
        })}
      </RowList>
      <p className="record-note">{RECORD_TEXT.selfMeaning}</p>

      <div className="self-save">
        <Button variant="primary" disabled={busy || !loaded} onClick={() => void save()}>
          {busy ? RECORD_TEXT.saving : RECORD_TEXT.selfSave}
        </Button>
        {loaded ? <span>{RECORD_TEXT.selfBlankCount(blankNow)}</span> : null}
      </div>
      {saved ? (
        <p role="status" className="record-saved">
          {RECORD_TEXT.saved}
        </p>
      ) : null}
      {failed ? <p role="alert">{RECORD_TEXT.saveFailed}</p> : null}

      <h3>{RECORD_TEXT.selfReportHeading}</h3>
      <p className="record-note">
        {RECORD_TEXT.selfReportNote}
        <span>{SELF_CHECK_SOURCE_NOTE}</span>。
      </p>
      <CopyBox label={RECORD_TEXT.selfReportLabel} value={report} />

      <section aria-label={RECORD_TEXT.selfHistoryHeading}>
        <h3>{RECORD_TEXT.selfHistoryHeading}</h3>
        {history.status === "loading" ? <p role="status">{RECORD_TEXT.loading}</p> : null}
        {history.status === "ok" && historyRows.length === 0 ? <p>{RECORD_TEXT.selfHistoryNone}</p> : null}
        {historyRows.length > 0 ? (
          <div className="record-table-wrap">
            <table className="record-table">
              <thead>
                <tr>
                  <th scope="col">{RECORD_TEXT.selfHistoryMonth}</th>
                  <th scope="col">{RECORD_TEXT.selfHistoryDate}</th>
                  <th scope="col">{RECORD_TEXT.selfHistoryOk}</th>
                  <th scope="col">{RECORD_TEXT.selfHistoryNg}</th>
                  <th scope="col">{RECORD_TEXT.selfHistoryBlank}</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((r) => {
                  const c = countOf(r.answers);
                  return (
                    <tr key={r.month}>
                      <th scope="row">{monthLabelOf(r.month)}</th>
                      <td>{safeJa(r.date)}</td>
                      <td>{c.ok}</td>
                      <td>{c.ng}</td>
                      <td>{c.blank}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}

export function SelfCheckPanel() {
  const farm = useFarmRecord();
  return (
    <section className="self-check-panel">
      <h2>{RECORD_TEXT.selfTitle}</h2>
      <p>{RECORD_TEXT.selfLead}</p>
      <FarmGuide farm={farm} />
      {farm.status === "loading" ? <p role="status">{RECORD_TEXT.loading}</p> : null}
      {farm.status === "ready" ? <SelfCheckBody farm={farm.farm} /> : null}
    </section>
  );
}

export default SelfCheckPanel;
