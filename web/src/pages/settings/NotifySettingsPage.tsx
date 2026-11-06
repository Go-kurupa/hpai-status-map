import { currentSeason, seasonOf } from "@hpai/shared/season";
import type { Farm, NotifySettings } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { MultipleFarmsError } from "../auth/firestoreRecordStore";
import { RequireMember } from "../auth/RequireMember";
import { savedAtLabel, seasonMonths } from "./farmForm";
import { SaveStatus, useSectionSave } from "./sectionSave";
import "./settings.css";

type Saved = Farm & { id: string };
type Load = { state: "loading" } | { state: "error"; message: string | null } | { state: "ok"; farm: Saved | null };

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
  // 配信を止めているか。確かめられなければ null（止めている表示は出さず、設定の画面は使える）
  const [stopped, setStopped] = useState<boolean | null>(null);
  const [resume, setResume] = useState<"idle" | "busy" | "failed" | "done">("idle");

  useEffect(() => {
    let off = false;
    store.isMailStopped().then(
      (v) => {
        if (!off) setStopped(v);
      },
      () => {
        if (!off) setStopped(null);
      },
    );
    return () => {
      off = true;
    };
  }, [store]);

  async function resumeMail() {
    if (resume === "busy") return;
    setResume("busy");
    try {
      const { resumeMailCall } = await import("./resumeMailCall");
      await resumeMailCall(farm.id);
      setStopped(false);
      setResume("done");
    } catch {
      setResume("failed");
    }
  }

  // 失敗は投げる（useSectionSave が failed にして、ボタンの直下に出す）
  async function saveWith(patch: Partial<Farm>) {
    await store.saveFarm(patch);
    const next = await store.getFarm();
    if (next) setFarm(next);
  }

  const notifySave = useSectionSave(() => saveWith({ notify }));
  const dueSave = useSectionSave(saveDue);

  const toggle = (key: "level1" | "level2" | "level3" | "morningDigest") => (e: { target: { checked: boolean } }) => {
    setNotify((n) => ({ ...n, [key]: e.target.checked }));
    notifySave.reset();
  };

  function changeNotify(update: (n: NotifySettings) => NotifySettings) {
    setNotify(update);
    notifySave.reset();
  }

  async function saveDue() {
    // 前季の期限は残し、この画面の月だけを置き換える。空の月は持たない。
    // 前季より古い月と月でないキーは捨てる（残すと季ごとに増え、規則の上限 40 件に当たって保存できなくなる）
    const merged: Record<string, string> = Object.fromEntries(
      Object.entries(farm.selfCheckDue).filter(([k]) => /^\d{4}-(0[1-9]|1[0-2])$/.test(k) && seasonOf(`${k}-01`) >= season - 1),
    );
    for (const m of months) {
      const v = due[m] ?? "";
      if (v === "") delete merged[m];
      else merged[m] = v;
    }
    await saveWith({ selfCheckDue: merged });
  }

  const remindOn = notify.selfCheckRemindDays !== null;
  const saved = savedAtLabel(farm.updatedAt);

  return (
    <div className="settings-page">
      <h1>通知の設定</h1>

      {stopped === true ? (
        <section>
          <h2>配信を止めています</h2>
          <p className="settings-note">
            メールのリンクで、この農場あてのメールを止めています。発生の知らせ、野鳥の知らせ、朝のまとめが届きません。基準に当たった知らせと期限の知らせも止まっています。画面の表示は止まっていません。
          </p>
          <Button variant="primary" disabled={resume === "busy"} onClick={() => void resumeMail()}>
            配信を再開する
          </Button>
          {resume === "failed" ? (
            <p className="settings-error" role="alert">
              戻せませんでした。通信を確かめて、もう一度試してください。
            </p>
          ) : null}
        </section>
      ) : null}
      {resume === "done" ? (
        <p className="settings-saved" role="status">
          配信を再開しました
        </p>
      ) : null}

      <section>
        <h2>メールで知らせる</h2>
        <p className="settings-note">発生の知らせは、疑いも「疑い」と書いてメールで届きます。県の連絡が正です。</p>
        <p className="settings-note">
          野鳥の高病原性鳥インフルエンザが確定したときは、近くなら朝のまとめに入ります（警告の段階は上がりません）。死亡数が基準に当たったときの知らせは、この設定にかかわらずすぐ届きます。メールの配信停止のリンクで、これらも止まります。
        </p>
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
              onChange={(e) => changeNotify((n) => ({ ...n, selfCheckRemindDays: e.target.checked ? DEFAULT_REMIND_DAYS : null }))}
            />
            自己点検の期限の前に知らせる
          </label>
          {remindOn ? (
            <>
              <label htmlFor="remind-days">何日前に知らせるか</label>
              <select
                id="remind-days"
                value={notify.selfCheckRemindDays ?? DEFAULT_REMIND_DAYS}
                onChange={(e) => changeNotify((n) => ({ ...n, selfCheckRemindDays: Number(e.target.value) }))}
              >
                {REMIND_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d} 日前
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <Button variant="primary" disabled={notifySave.state === "saving"} onClick={() => void notifySave.run()}>
            通知の設定を保存
          </Button>
          <SaveStatus state={notifySave.state} />
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
                onChange={(e) => {
                  setDue((d) => ({ ...d, [m]: e.target.value }));
                  dueSave.reset();
                }}
              />
            </div>
          ))}
          <Button disabled={dueSave.state === "saving"} onClick={() => void dueSave.run()}>
            期限を保存
          </Button>
          <SaveStatus state={dueSave.state} />
        </div>
      </section>

      {saved ? <p className="settings-saved">{saved}</p> : null}
      <p>
        <Link to="/privacy" className="tap-link">プライバシーの説明</Link>
      </p>
      <p>
        <Link to="/settings/farm" className="tap-link">
          農場の設定を開く
        </Link>
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
      (e: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: e instanceof MultipleFarmsError ? e.message : null });
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
        <h1>通知の設定</h1>
        <p className="settings-error" role="alert">
          {load.message ?? "農場の情報を読めませんでした。通信を確かめて、ページを読み込み直してください。"}
        </p>
      </section>
    );
  }
  if (!load.farm) {
    // 農場がないと保存できない（ルールが meshCode を要る）。地点を決める画面へ案内する
    return (
      <section className="settings-page">
        <h1>通知の設定</h1>
        <p>先に、農場の設定で地点を選んでください。地点を登録すると、通知の設定ができます。</p>
        <p>
          <Link to="/settings/farm" className="tap-link">農場の設定へ</Link>
        </p>
        <p>
          <Link to="/privacy" className="tap-link">プライバシーの説明</Link>
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
