import type { PastHit, PastSummary } from "@hpai/shared/past";
import type { MuniCode } from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { NearbyPast, type NearbyPastState } from "./NearbyPast";
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
  /** 周辺の町の過去の発生。渡さなければ出さない */
  nearby?: NearbyPastState;
  /** 事例が 15 秒たっても読めていない。読み込み中の文の後ろに読み込み直しの案内を足す */
  slow?: boolean;
  /** 過去のシーズンを見ているとき、ページが pastDisclaimer を出しているので重ねない */
  showPastDisclaimer: boolean;
  /** 同じ画面の札の前に riskAnywhere を出している。重ねて書かない */
  riskShownAbove?: boolean;
  /** 町の選び方、場所の決め方 */
  children?: ReactNode;
}

function PastRow({ past, nearby, town, line, showDisclaimer, riskShownAbove }: { past: PastState; nearby?: NearbyPastState; town: MuniCode | null; line: TownLine | null; showDisclaimer: boolean; riskShownAbove: boolean }) {
  if (past.status === "idle") return null;
  let body: ReactNode;
  if (past.status === "loading") body = <p>{TEXT.pastLoading}</p>;
  else if (past.status === "failed") body = <p role="alert">{TEXT.pastFailed}</p>;
  else {
    const { summary } = past;
    const hits: readonly PastHit[] = summary.hits;
    const riskMissing = !riskShownAbove && !line?.details.includes(FIXED_TEXT.riskAnywhere);
    body = (
      <>
        <p>
          <span className="town-label">{TEXT.pastLabel}</span> {summary.sentence}
        </p>
        {riskMissing && hits.length === 0 ? <p className="town-note">{FIXED_TEXT.riskAnywhere}</p> : null}
        <PastList hits={hits} />
        {nearby ? <NearbyPast state={nearby} town={town} collapsed riskShown={!riskMissing || hits.length === 0} /> : null}
        {showDisclaimer ? <p className="town-note">{FIXED_TEXT.pastDisclaimer}</p> : null}
      </>
    );
  }
  // 過去の行は事実だけ。段階の色（data-tone）を持たない
  return <div className="town-past">{body}</div>;
}

/** 「自分の町の 1 文」。色は今季の段階だけ。過去の発生は別の行で、色を使わない（設計書 §15） */
export function TownBanner(p: TownBannerProps) {
  const noTown = p.muniCode === null;
  let now: ReactNode;
  if (noTown) {
    // 案内の文と町を選ぶボタンを 1 行に並べる。選ぶ画面を開くと、その下に折り返す
    return (
      <section className="town-banner" aria-label={TEXT.myTown}>
        <div className="town-prompt">
          <p className="town-prompt-text" role="status">
            {TEXT.pickPrompt}
          </p>
          {p.children}
        </div>
      </section>
    );
  }
  if (p.lineFailed) {
    now = (
      <p className="state-unknown" role="alert">
        {TEXT.loadFailed}
      </p>
    );
  } else if (!p.loaded || p.line === null) {
    now = (
      <p className="state-wait" role="status">
        {TEXT.loading}
        {p.slow ? <span className="slow-load">{TEXT.slowLoad}</span> : null}
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
      <PastRow past={p.past} nearby={p.nearby} town={p.muniCode} line={p.line} showDisclaimer={p.showPastDisclaimer} riskShownAbove={p.riskShownAbove ?? false} />
      <p className="town-area-link">
        <Link to={`/area/${p.muniCode}`} className="tap-link">{TEXT.areaLink}</Link>
      </p>
      {p.children}
    </section>
  );
}
