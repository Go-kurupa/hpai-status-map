import type { PastHit, PastSummary } from "@hpai/shared/past";
import type { MuniCode } from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PastList } from "./PastList";
import { TEXT } from "./texts";
import type { TownLine } from "./townLine";

export type PastState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; summary: PastSummary };

export interface TownBannerProps {
  muniCode: MuniCode | null;
  muniName: string | null;
  /** 今季の事例を読めている（読めていないのに④と書いて「何もない」に見せない。§2） */
  loaded: boolean;
  /** 計算できた 1 文。null は計算中か、失敗 */
  line: TownLine | null;
  lineFailed: boolean;
  past: PastState;
  /** 過去のシーズンを見ているとき、ページが pastDisclaimer を出しているので重ねない */
  showPastDisclaimer: boolean;
  /** 町の選び方、場所の決め方 */
  children?: ReactNode;
}

function PastRow({ past, line, showDisclaimer }: { past: PastState; line: TownLine | null; showDisclaimer: boolean }) {
  if (past.status === "idle") return null;
  let body: ReactNode;
  if (past.status === "loading") body = <p>{TEXT.pastLoading}</p>;
  else if (past.status === "failed") body = <p role="alert">{TEXT.pastFailed}</p>;
  else {
    const { summary } = past;
    const hits: readonly PastHit[] = summary.hits;
    body = (
      <>
        <p>
          <span className="town-label">{TEXT.pastLabel}</span> {summary.sentence}
        </p>
        {hits.length === 0 && !line?.details.includes(FIXED_TEXT.riskAnywhere) ? <p className="town-note">{FIXED_TEXT.riskAnywhere}</p> : null}
        <PastList hits={hits} />
        {showDisclaimer ? <p className="town-note">{FIXED_TEXT.pastDisclaimer}</p> : null}
      </>
    );
  }
  // 過去の行は事実だけ。段階の色（data-tone）を持たない
  return <div className="town-past">{body}</div>;
}

/** 地図の上の「自分の町の 1 文」。色は今季の段階だけ。過去の発生は別の行で、色を使わない（設計書 §15） */
export function TownBanner(p: TownBannerProps) {
  const noTown = p.muniCode === null;
  let now: ReactNode;
  if (noTown) {
    now = (
      <div className="town-now" data-tone="none" role="status">
        <p className="town-main">{TEXT.noTown}</p>
      </div>
    );
  } else if (p.lineFailed) {
    now = (
      <p className="town-now-wait" role="alert">
        {TEXT.loadFailed}
      </p>
    );
  } else if (!p.loaded || p.line === null) {
    now = (
      <p className="town-now-wait" role="status">
        {TEXT.loading}
      </p>
    );
  } else {
    now = (
      <div className="town-now" data-tone={p.line.tone} role="status">
        <p className="town-main">{p.line.main}</p>
        {p.line.details.length > 0 ? (
          <ul className="town-details">
            {p.line.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <section className="town-banner" aria-label={TEXT.myTown}>
      {p.muniName ? (
        <p className="town-name">
          <span className="town-label">{TEXT.myTown}</span> <strong>{p.muniName}</strong>
        </p>
      ) : null}
      {now}
      {noTown ? null : <PastRow past={p.past} line={p.line} showDisclaimer={p.showPastDisclaimer} />}
      {noTown ? null : (
        <p className="town-area-link">
          <Link to={`/area/${p.muniCode}`}>{TEXT.areaLink}</Link>
        </p>
      )}
      {p.children}
    </section>
  );
}
