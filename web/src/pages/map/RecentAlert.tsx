import { addDays } from "@hpai/shared/dates";
import { RECENT_DAYS } from "@hpai/shared/overview";
import { PREFS } from "@hpai/shared/pref";
import type { Case, IsoDate, Season, WildBird } from "@hpai/shared/types";
import { useState } from "react";
import { Link } from "react-router";
import { caseDate } from "./seasonView";
import { TEXT } from "./texts";

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

/** 赤い枠の 1 行。野鳥の検査中を確定と読ませないよう、段階を分けて持つ */
export interface RecentAlertItem {
  id: string;
  kind: "farm" | "bird";
  date: IsoDate;
  /** 「岡山県 津山市」。町が分からなければ県だけ */
  place: string;
  stage: "suspected" | "confirmed" | "screening";
}

const placeOf = (prefCode: string, muniName: string | null) => {
  const pref = PREF_NAME.get(prefCode) ?? prefCode;
  return muniName ? `${pref} ${muniName}` : pref;
};

/**
 * 今日を含む直近 14 日（札の「直近 14 日の件数」と同じ期間）の、今季の発生と野鳥の陽性。新しい順（2026-11-07 作者の決定）。
 * 否定と否定の候補は並べない。確認中（町が分からない）は「確認中の発表がある県」の行に任せる。日付のない事例は、いつか書けないので並べない
 */
export function recentAlertItems(p: { cases: readonly Case[]; birds: readonly WildBird[]; current: Season; today: IsoDate }): RecentAlertItem[] {
  const from = addDays(p.today, -(RECENT_DAYS - 1));
  const inRange = (d: IsoDate | null): d is IsoDate => d !== null && d >= from && d <= p.today;
  const farms = p.cases.flatMap((c): RecentAlertItem[] => {
    const date = caseDate(c);
    if (c.season !== p.current || c.confirmState === "reviewing" || c.negation !== "none" || !inRange(date)) return [];
    return [{ id: c.id, kind: "farm", date, place: placeOf(c.prefCode, c.muniName), stage: c.stages.confirmed ? "confirmed" : "suspected" }];
  });
  const birds = p.birds.flatMap((b): RecentAlertItem[] =>
    b.season !== p.current || b.test === "negative" || !inRange(b.date)
      ? []
      : [{ id: b.id, kind: "bird", date: b.date, place: placeOf(b.prefCode, b.muniName), stage: b.test === "hpai_confirmed" ? "confirmed" : "screening" }],
  );
  // 同じ日は養鶏場などを先に
  return [...farms, ...birds].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.kind === b.kind ? 0 : a.kind === "farm" ? -1 : 1));
}

const md = (d: IsoDate) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`;

/**
 * 最初の地図の画面の、時刻のすぐ下の赤い枠。1 件もなければ出さない（「発生はありません」と書かない）。
 * compact（スマホ）は、地図が最初の画面に収まるよう件数だけの 1 行に畳む。押すと全部の行が開く（2026-11-07 作者の決定 案 A）。
 * 確認できていない県があるときは、畳んだ行に件数を出さない（件数を全部と読ませない）
 */
export function RecentAlert({
  items,
  today,
  limit,
  uncheckedNote,
  compact = false,
}: {
  items: readonly RecentAlertItem[];
  today: IsoDate;
  limit: number;
  uncheckedNote: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const head = TEXT.recentAlertHead(md(addDays(today, -(RECENT_DAYS - 1))), md(today));
  const shown = items.slice(0, limit);
  const folded = compact && !open;
  return (
    <section className={compact ? "recent-alert is-compact" : "recent-alert"} aria-label={head}>
      {compact ? (
        // 畳んだときは件数だけの 1 行にする（最新の 1 件まで入れると幅 360px で途中で切れて読めない。地図を最初の画面に収める）
        <h2 className="recent-alert-head">
          <button type="button" className="recent-alert-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="recent-alert-count">{TEXT.recentAlertFolded(uncheckedNote === null ? items.length : null)}</span>
            <span className="recent-alert-mark" aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        </h2>
      ) : (
        <h2 className="recent-alert-head">{head}</h2>
      )}
      {folded ? null : (
        <>
          {compact ? <p className="recent-alert-range">{TEXT.recentAlertRange(md(addDays(today, -(RECENT_DAYS - 1))), md(today))}</p> : null}
          <ul>
            {shown.map((i) => (
              <li key={`${i.kind}-${i.id}`}>
                <span className="recent-alert-date">{md(i.date)}</span>
                <span>{i.place}</span>
                <span className="recent-alert-kind">{TEXT.recentAlertKind(i.kind, i.stage)}</span>
              </li>
            ))}
          </ul>
          {items.length > shown.length ? (
            <p className="recent-alert-more">
              <Link to="/season" className="tap-link">
                {TEXT.recentAlertMore(items.length - shown.length)}
              </Link>
            </p>
          ) : null}
          {uncheckedNote ? <p className="recent-alert-note">{uncheckedNote}</p> : null}
        </>
      )}
    </section>
  );
}
