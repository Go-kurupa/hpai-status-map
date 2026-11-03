import { currentSeason } from "@hpai/shared/season";
import type { Farm, NotifySettings } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { RequireMember } from "../auth/RequireMember";
import { savedAtLabel, seasonMonths } from "./farmForm";
import "./settings.css";

type Saved = Farm & { id: string };
type Load = { state: "loading" } | { state: "error" } | { state: "ok"; farm: Saved | null };

/** 期限の何日前に知らせるか。入れたときの既定は 3 日前 */
const REMIND_CHOICES = [1, 2, 3, 5, 7] as const;
const DEFAULT_REMIND_DAYS = 3;

const monthLabel = (month: string): string => {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
};

function NotifyForm({ farm: initial }: { farm: Saved }) {
  const store = useRecordStore();
  const season = currentSeason(useDataSource().now());
  const months = seasonMonths(season);

  const [farm, setFarm] = useState<Saved>(initial);
  const [notify, setNotify] = useState<NotifySettings>(initial.notify);
  const [due, setDue] = useState<Record<string, string>>(() =>
    Object.fromEntries(months.map((m) => [m, initial.selfCheckDue[m] ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function saveWith(patch: Partial<Farm>) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await store.saveFarm(patch);
      const next = await store.getFarm();
      if (next) setFarm(next);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  const toggle = (key: "level1" | "level2" | "level3" | "morningDigest") => (e: { target: { checked: boolean } }) =>
    setNotify((n) => ({ ...n, [key]: e.target.checked }));

  function saveDue() {
    // 他のシーズンの期限は残し、この画面の月だけを置き換える。空の月は持たない
    const merged: Record<string, string> = { ...farm.selfCheckDue };
    for (const m of months) {
      const v = due[m] ?? "";
      if (v === "") delete merged[m];
      else merged[m] = v;
    }
    void saveWith({ selfCheckDue: merged });
  }

  const remindOn = notify.selfCheckRemindDays !== null;
  const saved = savedAtLabel(farm.updatedAt);

  return (
    <div className="settings-page">
      <h1>知らせの設定</h1>

      <section>
        <h2>メールで知らせる</h2>
        <p className="settings-note">発生の知らせは、疑いも「疑い」と書いてメールで届きます。県の連絡が正です。</p>
        <div className="settings-form">
          <label className="settings-check">
            <input type="checkbox" checked={notify.level1} onChange={toggle("level1")} />
            区域に入っている可能性（すぐ届きます）
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={notify.level2} onChange={toggle("level2")} />
            隣町で発生（朝 6 時にまとめて届きます）
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={notify.level3} onChange={toggle("level3")} />
            登録した町で発生（朝 6 時にまとめて届きます）
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={notify.morningDigest} onChange={toggle("morningDigest")} />
            朝のまとめのメール（朝 6 時）
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={remindOn}
              onChange={(e) => setNotify((n) => ({ ...n, selfCheckRemindDays: e.target.checked ? DEFAULT_REMIND_DAYS : null }))}
            />
            自己点検の期限の前に知らせる
          </label>
          {remindOn ? (
            <>
              <label htmlFor="remind-days">何日前に知らせるか</label>
              <select
                id="remind-days"
                value={notify.selfCheckRemindDays ?? DEFAULT_REMIND_DAYS}
                onChange={(e) => setNotify((n) => ({ ...n, selfCheckRemindDays: Number(e.target.value) }))}
              >
                {REMIND_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d} 日前
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <Button variant="primary" disabled={busy} onClick={() => void saveWith({ notify })}>
            知らせの設定を保存
          </Button>
        </div>
      </section>

      <section>
        <h2>自己点検の期限（月ごと）</h2>
        <p className="settings-note">期限は県の様式で決まっています。月ごとに、決まった日を入れてください。入れない月は知らせません。</p>
        <div className="settings-form">
          {months.map((m) => (
            <div key={m} className="settings-form">
              <label htmlFor={`due-${m}`}>{monthLabel(m)}の分の期限</label>
              <input
                id={`due-${m}`}
                name={`due-${m}`}
                type="date"
                value={due[m] ?? ""}
                onChange={(e) => setDue((d) => ({ ...d, [m]: e.target.value }))}
              />
            </div>
          ))}
          <Button disabled={busy} onClick={saveDue}>
            期限を保存
          </Button>
        </div>
      </section>

      {failed ? (
        <p className="settings-error" role="alert">
          保存できませんでした。通信を確かめて、もう一度試してください。
        </p>
      ) : null}
      {saved ? <p className="settings-saved">{saved}</p> : null}
      <p>
        <Link to="/privacy">プライバシーの説明</Link>
      </p>
    </div>
  );
}

function NotifySettingsLoader() {
  const store = useRecordStore();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    store.getFarm().then(
      (farm) => {
        if (!cancelled) setLoad({ state: "ok", farm });
      },
      () => {
        if (!cancelled) setLoad({ state: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  if (load.state === "loading") return <p role="status">読み込んでいます</p>;
  if (load.state === "error") {
    return (
      <section className="settings-page">
        <h1>知らせの設定</h1>
        <p className="settings-error" role="alert">
          農場の情報を読めませんでした。通信を確かめて、ページを読み込み直してください。
        </p>
      </section>
    );
  }
  if (!load.farm) {
    // 農場がないと保存できない（ルールが meshCode を要る）。地点を決める画面へ案内する
    return (
      <section className="settings-page">
        <h1>知らせの設定</h1>
        <p>先に、農場の設定で地点を選んでください。地点を登録すると、知らせの設定ができます。</p>
        <p>
          <Link to="/settings/farm">農場の設定へ</Link>
        </p>
        <p>
          <Link to="/privacy">プライバシーの説明</Link>
        </p>
      </section>
    );
  }
  return <NotifyForm farm={load.farm} />;
}

export default function NotifySettingsPage() {
  return (
    <RequireMember>
      <NotifySettingsLoader />
    </RequireMember>
  );
}
