import { caseDate, isSuspectedOnly, pastSeasonsOf } from "@hpai/shared/overview";
import { isCountable } from "@hpai/shared/level";
import { seasonAgoLabel } from "@hpai/shared/season";
import type { Case, HistoryCase, MuniCode, Season } from "@hpai/shared/types";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { NearbyTown } from "@hpai/shared/past";
import { TEXT } from "./texts";

/** 「昨季（2025 年シーズン）」。今季より先のシーズン（再現の時計など）は年だけ */
function seasonText(season: Season, current: Season): string {
  try {
    return `${seasonAgoLabel(season, current)}（${season} 年シーズン）`;
  } catch {
    return `${season} 年シーズン`;
  }
}

/** 日付を「2025 年 12 月 20 日」に */
function dateText(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日` : TEXT.panelNoDate;
}

/** 用途・飼い方・羽数。記載がなければそう書く（空欄にしない）。羽数は数と「羽」の間で折らない */
function Detail({ birdUse, housing, headCount }: { birdUse: string | null; housing: string | null; headCount: number | null }) {
  return (
    <span>
      {birdUse ?? TEXT.panelNoUse}・{housing ?? TEXT.panelNoHousing}・
      <span className="town-cases-nowrap">{headCount !== null ? `${headCount.toLocaleString("ja-JP")} 羽` : TEXT.panelNoHead}</span>
    </span>
  );
}

export interface TownCasesPanelProps {
  /** 押した町。null なら、近くで過去に発生のある町を押せる一覧だけを出す */
  muniCode: MuniCode | null;
  muniName: string | null;
  /** 今季の事例（読めていなければ null） */
  currentCases: readonly Case[] | null;
  /** 過去 6 シーズンの国の事例一覧（読めていなければ null） */
  history: readonly HistoryCase[] | null;
  /** 国の事例一覧を読めなかった。読み込み中と分けて、もう一度読む口を出す */
  historyFailed: boolean;
  onRetryHistory: () => void;
  /** 自分の町を選んでいる。閉じるボタンの文を「自分の町に戻る」にする（選んでいなければ「閉じる」） */
  hasTown: boolean;
  current: Season;
  /** 近くで過去に発生のある町（キーボードでも町を選べるように、ボタンで並べる） */
  nearbyTowns: readonly NearbyTown[];
  onPick: (code: MuniCode) => void;
  onClose: () => void;
}

/**
 * 地図で押した町の事例（設計書 2026-11-06-ui-frame 4.1、決定 4）。今季の事例と、過去 6 シーズンの国の事例一覧の記録を、
 * 日付、用途、飼い方、羽数、資料へのリンクで出す。関連農場は件数に入れない（棒と同じ）。記録がないことを安全と読ませない。
 */
export function TownCasesPanel(p: TownCasesPanelProps) {
  const headRef = useRef<HTMLHeadingElement>(null);
  // 欄を開いた元（地図、近くの町のボタン）。閉じたらそこへフォーカスを戻す
  const opener = useRef<{ el: Element | null; code: MuniCode | null }>({ el: null, code: null });
  // 町を押したら、読み上げとキーボードの位置を欄の題へ移す。スマホは欄が地図の下なので、題まで画面を動かす
  useEffect(() => {
    if (!p.muniCode) return;
    if (!headRef.current?.contains(document.activeElement)) opener.current = { el: document.activeElement, code: p.muniCode };
    headRef.current?.focus();
  }, [p.muniCode]);
  const close = () => {
    const { el, code } = opener.current;
    p.onClose();
    // 閉じると欄の中身が替わる。描き直した後に、開いた元か、同じ町のボタンへ戻す
    requestAnimationFrame(() => {
      const back = el instanceof HTMLElement && el.isConnected && el !== document.body ? el : code ? document.querySelector<HTMLElement>(`.town-cases-picks [data-muni="${code}"]`) : null;
      back?.focus();
    });
  };

  if (p.muniCode === null) {
    if (p.nearbyTowns.length === 0) return null;
    return (
      <section className="town-cases" aria-label={TEXT.panelPickAria}>
        <p className="town-cases-hint">{TEXT.panelHint}</p>
        <ul className="town-cases-picks">
          {p.nearbyTowns.map((t) => (
            <li key={t.muniCode}>
              <button type="button" className="btn" data-muni={t.muniCode} onClick={() => p.onPick(t.muniCode)}>
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // 今季は件数に数える事例だけ（否定・確認中は出さない）。新しい順
  const now = (p.currentCases ?? [])
    .filter((c) => c.muniCode === p.muniCode && c.season === p.current && isCountable(c))
    .sort((a, b) => (caseDate(b) ?? "").localeCompare(caseDate(a) ?? ""));
  // 過去は見出しどおりの 6 シーズンだけ（データに古いシーズンが入っても混ぜない）。関連農場は出さない
  const seasons = new Set(pastSeasonsOf(p.history ?? [], p.current));
  const past = (p.history ?? []).filter((h) => h.muniCode === p.muniCode && !h.related && seasons.has(h.season)).sort((a, b) => b.date.localeCompare(a.date));
  const bySeason = new Map<Season, HistoryCase[]>();
  for (const h of past) bySeason.set(h.season, [...(bySeason.get(h.season) ?? []), h]);
  const name = p.muniName ?? p.muniCode;
  return (
    <section className="town-cases" aria-labelledby="town-cases-h">
      <p className="town-cases-label">{TEXT.panelLabel}</p>
      <h2 id="town-cases-h" ref={headRef} tabIndex={-1}>
        {name}
      </h2>

      <h3>{TEXT.panelNow}</h3>
      {p.currentCases === null ? (
        <p role="status">{TEXT.panelLoading}</p>
      ) : now.length === 0 ? (
        <p>{TEXT.panelNoneNow}</p>
      ) : (
        <ul className="town-cases-list">
          {now.map((c) => (
            <li key={c.id}>
              <b>
                {dateText(caseDate(c))}　{isSuspectedOnly(c) ? TEXT.panelSuspected : TEXT.panelConfirmed}
              </b>
              <Detail birdUse={c.birdUse} housing={c.housing} headCount={c.headCount} />
              {c.sourceUrls[0] ? (
                <a href={c.sourceUrls[0]} target="_blank" rel="noopener noreferrer" className="tap-link">
                  {TEXT.panelSource}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3>{TEXT.panelPast}</h3>
      {p.history === null && p.historyFailed ? (
        <p className="state-unknown" role="status">
          {TEXT.panelPastFailed}{" "}
          <button type="button" className="btn" onClick={p.onRetryHistory}>
            {TEXT.panelRetry}
          </button>
        </p>
      ) : p.history === null ? (
        <p role="status">{TEXT.panelLoading}</p>
      ) : past.length === 0 ? (
        <p>{TEXT.panelNonePast}</p>
      ) : (
        [...bySeason.entries()].map(([season, rows]) => (
          <div key={season} className="town-cases-season">
            <p className="town-cases-season-label">
              {seasonText(season, p.current)} {rows.length} 件
            </p>
            <ul className="town-cases-list">
              {rows.map((h) => (
                <li key={`${h.season}-${h.no}`}>
                  <b>{dateText(h.date)}</b>
                  <Detail birdUse={h.birdUse} housing={h.housing} headCount={h.headCount} />
                  <a href={h.sourceUrl} target="_blank" rel="noopener noreferrer" className="tap-link">
                    {TEXT.panelSource}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="town-cases-note">{TEXT.panelNote}</p>
      <p>
        <Link to={`/area/${p.muniCode}`} className="tap-link">
          {TEXT.areaLink}
        </Link>
      </p>
      <button type="button" className="btn" onClick={close}>
        {p.hasTown ? TEXT.panelClose : TEXT.panelCloseNoTown}
      </button>
    </section>
  );
}
