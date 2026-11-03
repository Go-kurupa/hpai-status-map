// 記録の出力（表の印刷と CSV）と、農場の全データの削除（設計書 §8、§12）。
// 削除は取り消せないので、農場の名前を入れるまで押せない。見本の農場（sample）には出さない。
// 説明は X-19 のプライバシーの説明（web/src/pages/privacy/privacyNotice.ts の「消し方」）と同じ内容にする。
import { addDays, jstDateOf } from "@hpai/shared/dates";
import { checksToCsv, DISINFECTION_LABELS, deathsToCsv, EXCLUSION_LABELS, SELF_CHECK_ITEMS } from "@hpai/shared/reports";
import type { CheckRecord, DeathRecord, Farm, House } from "@hpai/shared/types";
import { useEffect, useId, useState } from "react";
import { useDataSource, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { FarmGuide, useFarmRecord } from "./disinfectionLog";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

const LOOKBACK_DAYS = 120;

type FarmWithId = Farm & { id: string };
type Data = { houses: Array<House & { id: string }>; deaths: DeathRecord[]; checks: Array<CheckRecord & { id: string }> };

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DeleteSection({ farm, onDone }: { farm: FarmWithId; onDone: () => void }) {
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
    <section className="delete-section no-print" aria-label={RECORD_TEXT.deleteHeading}>
      <h2>{RECORD_TEXT.deleteHeading}</h2>
      <p>
        <strong>{RECORD_TEXT.deleteWarn}</strong>
      </p>
      <p>{RECORD_TEXT.deleteGone}</p>
      <p>{RECORD_TEXT.deleteKept}</p>
      <p>{RECORD_TEXT.deleteAnyMember}</p>
      {nameMissing ? <p role="alert">{RECORD_TEXT.deleteNameMissing}</p> : null}
      <div className="record-form">
        <label htmlFor={`${id}-name`}>{RECORD_TEXT.deleteInput}</label>
        <input
          id={`${id}-name`}
          type="text"
          autoComplete="off"
          value={typed}
          disabled={nameMissing}
          onChange={(e) => setTyped(e.target.value)}
        />
        <Button variant="primary" disabled={busy || nameMissing || typed !== farm.name} onClick={() => void remove()}>
          {busy ? RECORD_TEXT.deleting : RECORD_TEXT.deleteButton}
        </Button>
        {failed ? <p role="alert">{RECORD_TEXT.deleteFailed}</p> : null}
      </div>
    </section>
  );
}

function ExportBody({ farm }: { farm: FarmWithId }) {
  const store = useRecordStore();
  const ds = useDataSource();
  const today = jstDateOf(ds.now());
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let off = false;
    const from = addDays(today, -LOOKBACK_DAYS);
    Promise.all([store.listHouses(), store.listDeaths(from, today), store.listChecks(from, today)]).then(
      ([houses, deaths, checks]) => {
        if (!off) setData({ houses, deaths, checks });
      },
      () => {
        if (!off) setFailed(true);
      },
    );
    return () => {
      off = true;
    };
    // today は ds.now() から決まる。画面を開いている間は変えない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  if (deleted) {
    return (
      <section className="delete-section" aria-label={RECORD_TEXT.deleteHeading}>
        <p role="status">{RECORD_TEXT.deleted}</p>
        <p>
          <a href="/">{RECORD_TEXT.deletedTop}</a>
        </p>
      </section>
    );
  }

  const houseName = (houseId: string) => data?.houses.find((h) => h.id === houseId)?.name ?? houseId;

  return (
    <>
      <div className="no-print">
        <Button variant="primary" onClick={() => window.print()}>
          {RECORD_TEXT.print}
        </Button>
        <Button disabled={!data} onClick={() => data && download(`deaths-${today}.csv`, deathsToCsv(data.deaths, data.houses))}>
          {RECORD_TEXT.csvDeaths}
        </Button>
        <Button disabled={!data} onClick={() => data && download(`checks-${today}.csv`, checksToCsv(data.checks))}>
          {RECORD_TEXT.csvChecks}
        </Button>
      </div>
      {failed ? <p role="alert">{RECORD_TEXT.readFailed}</p> : null}
      {data ? (
        <>
          <h2>{RECORD_TEXT.tableDeaths}</h2>
          {data.deaths.length === 0 ? (
            <p>{RECORD_TEXT.none}</p>
          ) : (
            <table className="record-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>鶏舎</th>
                  <th>飼養羽数</th>
                  <th>死亡羽数</th>
                  <th>除外の理由</th>
                </tr>
              </thead>
              <tbody>
                {data.deaths.map((r) => (
                  <tr key={`${r.date}_${r.houseId}`}>
                    <td>{r.date}</td>
                    <td>{houseName(r.houseId)}</td>
                    <td>{r.flockSizeAt}</td>
                    <td>{r.deaths}</td>
                    <td>{r.exclusion ? (EXCLUSION_LABELS[r.exclusion.kind] ?? r.exclusion.kind) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2>{RECORD_TEXT.tableChecks}</h2>
          {data.checks.length === 0 ? (
            <p>{RECORD_TEXT.none}</p>
          ) : (
            <table className="record-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>種類</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {data.checks.map((c) => (
                  <tr key={c.id}>
                    <td>{c.date}</td>
                    <td>{c.kind === "disinfection" ? "消毒" : "自己点検"}</td>
                    <td>
                      {c.kind === "disinfection"
                        ? (DISINFECTION_LABELS[c.itemId] ?? c.itemId)
                        : SELF_CHECK_ITEMS.map((it) => `${it.no} ${c.answers[it.no] === "ok" ? "○" : c.answers[it.no] === "ng" ? "×" : "未記入"}`).join("　")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
      {store.mode === "sample" ? null : <DeleteSection farm={farm} onDone={() => setDeleted(true)} />}
    </>
  );
}

export function ExportPanel() {
  const farm = useFarmRecord();
  return (
    <section className="export-panel">
      <h1>{RECORD_TEXT.exportTitle}</h1>
      <p>{RECORD_TEXT.exportLead}</p>
      <FarmGuide farm={farm} />
      {farm.status === "loading" ? <p role="status">{RECORD_TEXT.loading}</p> : null}
      {farm.status === "ready" ? <ExportBody farm={farm.farm} /> : null}
    </section>
  );
}

export default ExportPanel;
