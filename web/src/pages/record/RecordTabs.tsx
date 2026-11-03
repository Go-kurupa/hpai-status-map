// 記録の 4 画面の上に置く行き来と、2 行の状態（最後の記録、メールが止まっているか）。
// RecordStore と DataSource だけを使う。/sample/record の下では、リンクも /sample/record/… にする。
import { addDays, jstDateOf } from "@hpai/shared/dates";
import type { IsoDate } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useDataSource, useRecordStore } from "../../data/context";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

const LOOKBACK_DAYS = 120;

type Last = { status: "loading" } | { status: "failed" } | { status: "ok"; date: IsoDate | null };
type Mail = { status: "loading" } | { status: "failed" } | { status: "ok"; stopped: boolean };

export function jaDateWithYear(d: IsoDate): string {
  return `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
}

export function RecordTabs() {
  const store = useRecordStore();
  const ds = useDataSource();
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
  }, [store, ds]);

  const tabs = [
    { to: `${base}/deaths`, label: RECORD_TEXT.tabDeaths },
    { to: `${base}/self-check`, label: RECORD_TEXT.tabSelfCheck },
    { to: `${base}/disinfection`, label: RECORD_TEXT.tabDisinfection },
    { to: base, label: RECORD_TEXT.tabExport },
  ];

  const lastText =
    last.status === "loading"
      ? ""
      : last.status === "failed"
        ? RECORD_TEXT.lastRecordFailed
        : last.date === null
          ? RECORD_TEXT.lastRecordNone
          : jaDateWithYear(last.date);

  return (
    <div className="record-tabs no-print">
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
      {last.status === "loading" ? null : <p>{`${RECORD_TEXT.lastRecord}: ${lastText}`}</p>}
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
