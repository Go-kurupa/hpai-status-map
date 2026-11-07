// 記録の 3 画面の上に置く題（h1）、行き来のタブ、2 行の状態（最後に記録した日、メールが止まっているか）。
// h1 は残す（AppShell が画面の替わり目に h1 へ焦点を移す）。「この画面では、〜」の 1 文は各パネルが持つ（2 回出さない）。
// 各画面の題は h2（パネルが持つ）。RecordStore と DataSource だけを使う。/sample/record の下では、リンクも /sample/record/… にする。
import { addDays, jstDateOf } from "@hpai/shared/dates";
import { formatJaDate } from "@hpai/shared/jaDate";
import type { IsoDate } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useDataSource, useRecordSaves, useRecordStore } from "../../data/context";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

const LOOKBACK_DAYS = 120;

type Last = { status: "loading" } | { status: "failed" } | { status: "ok"; date: IsoDate | null };
type Mail = { status: "loading" } | { status: "failed" } | { status: "ok"; stopped: boolean };

/** 「11月7日」の形。形の違う値は、そのまま出す（画面を落とさない） */
function jaDate(d: IsoDate): string {
  try {
    return formatJaDate(d);
  } catch {
    return d;
  }
}

export function RecordTabs() {
  const store = useRecordStore();
  const ds = useDataSource();
  // 記録を保存するたびに増える。同じ画面で記録した後も、上の 2 行を読み直す（読み直す間は前の表示のまま）
  const { version } = useRecordSaves();
  const { pathname } = useLocation();
  const base = store.mode === "sample" || pathname.startsWith("/sample/") ? "/sample/record" : "/record";

  const [last, setLast] = useState<Last>({ status: "loading" });
  const [mail, setMail] = useState<Mail>({ status: "loading" });

  useEffect(() => {
    let off = false;
    const today = jstDateOf(ds.now());
    const from = addDays(today, -LOOKBACK_DAYS);
    Promise.all([store.listDeaths(from, today), store.listChecks(from, today)]).then(
      ([deaths, checks]) => {
        if (off) return;
        const dates = [...deaths.map((d) => d.date), ...checks.map((c) => c.date)].sort();
        setLast({ status: "ok", date: dates[dates.length - 1] ?? null });
      },
      () => {
        if (!off) setLast({ status: "failed" });
      },
    );
    store.isMailStopped().then(
      (stopped) => {
        if (!off) setMail({ status: "ok", stopped });
      },
      () => {
        if (!off) setMail({ status: "failed" });
      },
    );
    return () => {
      off = true;
    };
  }, [store, ds, version]);

  const tabs = [
    { to: `${base}/deaths`, label: RECORD_TEXT.tabDeaths },
    { to: `${base}/self-check`, label: RECORD_TEXT.tabSelfCheck },
    { to: `${base}/disinfection`, label: RECORD_TEXT.tabDisinfection },
  ];

  const lastText =
    last.status === "loading"
      ? ""
      : last.status === "failed"
        ? RECORD_TEXT.lastRecordFailed
        : last.date === null
          ? RECORD_TEXT.lastRecordNone
          : jaDate(last.date);

  return (
    <div className="record-tabs no-print">
      <h1>{RECORD_TEXT.pageTitle}</h1>
      <nav aria-label={RECORD_TEXT.tabsLabel}>
        <ul>
          {tabs.map((t) => (
            <li key={t.to}>
              <Link to={t.to} aria-current={pathname === t.to ? "page" : undefined}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {last.status === "loading" ? null : <p className="record-last">{`${RECORD_TEXT.lastRecord}: ${lastText}`}</p>}
      {mail.status === "ok" && mail.stopped ? (
        <p role="status" className="record-mail-stopped">
          {RECORD_TEXT.mailStopped}
          {store.mode === "sample" ? null : (
            <>
              {" "}
              <Link to="/settings/notify">{RECORD_TEXT.mailResume}</Link>
            </>
          )}
        </p>
      ) : null}
      {mail.status === "failed" ? <p role="alert">{RECORD_TEXT.mailStopFailed}</p> : null}
    </div>
  );
}

export default RecordTabs;
