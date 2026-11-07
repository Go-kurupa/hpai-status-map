import { jstDateOf } from "@hpai/shared/dates";
import { formatJaDate } from "@hpai/shared/jaDate";
import { currentSeason, seasonOf } from "@hpai/shared/season";
import type { Farm, NotifySettings } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { StatRow, StatTile, type StatValue } from "../../ui/StatRow";
import { MultipleFarmsError } from "../auth/firestoreRecordStore";
import { RequireMember } from "../auth/RequireMember";
import { DUE_DAYS, dueDateOf, savedAtLabel, seasonMonths, uniformDueDay } from "./farmForm";
import { SaveStatus, useSectionSave } from "./sectionSave";
import { SettingsTabs } from "./SettingsTabs";
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
  const ds = useDataSource();
  const season = currentSeason(ds.now());
  const months = seasonMonths(season);

  const [farm, setFarm] = useState<Saved>(initial);
  const [notify, setNotify] = useState<NotifySettings>(initial.notify);
  // 期限の値は月ごとの欄（due）が正。「各月の分の期限」の 1 欄は、選ぶと 8 か月分の日付をまとめて作る入口
  const [due, setDue] = useState<Record<string, string>>(() =>
    Object.fromEntries(months.map((m) => [m, initial.selfCheckDue[m] ?? ""])),
  );
  const day = uniformDueDay(due, months);
  const dayValue = day === null ? "mixed" : String(day);
  // 保存済みの期限が 1 つの日で作れない（月ごとに違う、一部だけ入っている）ときは、月ごとの欄を開いて出す（値を壊さない）
  const [perMonthOpen, setPerMonthOpen] = useState(() => uniformDueDay(initial.selfCheckDue, months) === null);
  const thisMonth = jstDateOf(ds.now()).slice(0, 7);
  const exampleMonth = months.includes(thisMonth) ? thisMonth : months[0]!;

  function pickDay(v: string) {
    if (v === "mixed") return;
    const n = v === "" ? null : Number(v);
    setDue(Object.fromEntries(months.map((m) => [m, n === null ? "" : dueDateOf(m, n)])));
    dueSave.reset();
  }
  // 配信を止めているか。確かめられなければ null（止めている表示も札も出さず、設定の画面は使える）
  const [stopped, setStopped] = useState<boolean | null | "loading">("loading");
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

  // 札は保存済みの値（入力途中の値ではない）
  const mailKinds = (["level1", "level2", "level3", "morningDigest"] as const).filter((k) => farm.notify[k]).length;
  const savedDay = uniformDueDay(farm.selfCheckDue, months);
  const remindDays = farm.notify.selfCheckRemindDays;
  const dueValue: StatValue = {
    status: "ok",
    value: typeof savedDay === "number" ? `翌月の ${savedDay} 日` : savedDay === "" ? "未登録" : "月ごとに決めています",
  };

  return (
    <div className="settings-page">
      <h1>通知の設定</h1>
      <p>この画面では、メールで知らせる内容と、自己点検の期限を決めます。</p>
      <SettingsTabs />
      <StatRow label="通知の状況">
        {stopped === null ? null : (
          <StatTile
            label="配信"
            value={stopped === "loading" ? { status: "loading" } : { status: "ok", value: stopped ? "止めています" : "届きます" }}
          />
        )}
        <StatTile label="メールの知らせ" value={{ status: "ok", value: `${mailKinds} / 4`, unit: "種類" }} />
        <StatTile
          label="自己点検の期限"
          value={dueValue}
          note={savedDay === "" ? undefined : remindDays === null ? "期限の前には知らせません" : `期限の ${remindDays} 日前に知らせます`}
        />
      </StatRow>
      {saved ? <p className="settings-saved">{saved}</p> : null}

      {stopped === true ? (
        <section>
          <h2>配信を止めています</h2>
          <p className="settings-note">
            メールのリンクで、この農場あてのメールを止めています。発生の知らせ、野鳥の知らせ、朝のまとめが届きません。届け出の基準に達したときの知らせと期限の知らせも止まっています。画面の表示は止まっていません。
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
        <ul className="settings-notes">
          <li>発生の知らせは、疑いも「疑い」と書いてメールで届きます。正式な情報は県の連絡です。</li>
          <li>野鳥の高病原性鳥インフルエンザが確定したときは、近くなら朝のまとめに入ります（知らせの段階は上がりません）。</li>
          <li>死亡数が届け出の基準に達したときの知らせは、この設定にかかわらずすぐ届きます。</li>
          <li>メールの配信停止のリンクで、これらも止まります。</li>
        </ul>
        <div className="settings-form">
          <label className="settings-check">
            <input type="checkbox" checked={notify.level1} onChange={toggle("level1")} />
            区域に入っている可能性（すぐ届きます）
          </label>
          <label className="settings-check">
            <input type="checkbox" checked={notify.level2} onChange={toggle("level2")} />
            隣の町で発生（朝 6 時にまとめて届きます）
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
        <h2>自己点検の期限</h2>
        <ul className="settings-notes">
          <li>各月の分を出す期限を、翌月の日で選びます（県の様式に合わせてください）。</li>
          <li>翌月にない日（31 日など）は翌月の末日にします。</li>
        </ul>
        <div className="settings-form">
          <label htmlFor="due-day">各月の分の期限</label>
          <select id="due-day" value={dayValue} onChange={(e) => pickDay(e.target.value)}>
            <option value="">選ばない（知らせない）</option>
            {day === null ? <option value="mixed">月ごとに違う日</option> : null}
            {DUE_DAYS.map((n) => (
              <option key={n} value={String(n)}>
                翌月の {n} 日
              </option>
            ))}
          </select>
          {typeof day === "number" ? (
            <p className="settings-note">
              例: {monthLabel(exampleMonth)}の分は {formatJaDate(dueDateOf(exampleMonth, day))}まで
            </p>
          ) : null}
          <Button aria-expanded={perMonthOpen} aria-controls="due-months" onClick={() => setPerMonthOpen(!perMonthOpen)}>
            月ごとに変える
          </Button>
          {perMonthOpen ? (
            <div id="due-months" className="settings-form">
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
            </div>
          ) : null}
          {/* 主のボタン（青）は 1 画面に 1 つ。期限の保存は普通のボタン */}
          <Button disabled={dueSave.state === "saving"} onClick={() => void dueSave.run()}>
            期限を保存
          </Button>
          <SaveStatus state={dueSave.state} />
        </div>
      </section>

      <p>
        <Link to="/privacy" className="tap-link">プライバシーの説明</Link>
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
          {load.message ?? "農場の情報を読み込めませんでした。通信を確かめて、ページを読み込み直してください。"}
        </p>
      </section>
    );
  }
  if (!load.farm) {
    // 農場がないと保存できない（ルールが meshCode を要る）。地点を決める画面へ案内する
    return (
      <section className="settings-page">
        <h1>通知の設定</h1>
        <p>この画面では、メールで知らせる内容と、自己点検の期限を決めます。</p>
        <SettingsTabs />
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
