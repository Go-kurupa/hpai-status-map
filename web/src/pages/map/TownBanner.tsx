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
  /** 町の名前の横に描く（地域を選択ボタン。設計書 2026-11-06-town-picker D1）。町を選んでいないときは children を使う */
  nameAction?: ReactNode;
  /** 選択地域の行のすぐ下に描く（鶏舎の場所と、約 60 km 以内の件数。2026-11-07 作者の決定 A）。町を選んでいないときは出さない */
  spotRow?: ReactNode;
  /** スマホの段階の文を地図の前に置くとき、lead は段階の文だけ、rest はそれ以外を描く。既定は全部 */
  part?: "all" | "lead" | "rest";
  /** 過去の行を 1 文と「選択地域の過去」へのリンクだけにする（最初の画面。設計書 2026-11-06-ui-frame 4.1） */
  pastBrief?: boolean;
  /**
   * 最初の画面で、過去の記録に近くの自治体ごとの件数のボタンを並べ、押すとその町の欄を開く（2026-11-06 作者の決定）。
   * 渡さなければボタンを出さない
   */
  onPickTown?: (code: MuniCode) => void;
  /** 「全国の動き」の見出しを出さない（最初の画面は「全国」の見方があるので要らない。2026-11-06 作者の決定）。下の文は残す */
  hideNationalHead?: boolean;
}

/** 近くの自治体のボタン。件数の多い順、同じなら近い順 */
function NearbyPicks({ nearby, onPick }: { nearby: Extract<NearbyPastState, { status: "ready" }>; onPick: (code: MuniCode) => void }) {
  const { summary, current } = nearby;
  const towns = [...summary.towns].sort((a, b) => b.count - a.count || a.distanceKm - b.distanceKm);
  return (
    <>
      <p>
        <span className="town-label">{TEXT.pastLabel}</span> {TEXT.pastNearby(towns.length, summary.total, current - summary.windowSeasons, current)}
      </p>
      <ul className="town-cases-picks" aria-label={TEXT.pastPickAria}>
        {towns.map((t) => (
          <li key={t.muniCode}>
            <button type="button" className="btn" data-muni={t.muniCode} onClick={() => onPick(t.muniCode)}>
              {TEXT.pastPick(t.name, t.count)}
            </button>
          </li>
        ))}
      </ul>
      <p className="town-note">{TEXT.pastPickHint}</p>
    </>
  );
}

function PastRow({ past, nearby, town, line, showDisclaimer, riskShownAbove, brief, onPickTown }: { past: PastState; nearby?: NearbyPastState; town: MuniCode | null; line: TownLine | null; showDisclaimer: boolean; riskShownAbove: boolean; brief: boolean; onPickTown?: (code: MuniCode) => void }) {
  if (past.status === "idle") return null;
  let body: ReactNode;
  if (past.status === "loading") body = <p>{TEXT.pastLoading}</p>;
  else if (past.status === "failed") body = <p role="alert">{TEXT.pastFailed}</p>;
  else if (brief) {
    const link = (
      <Link to="/town" className="tap-link">
        {TEXT.townPastLink}
      </Link>
    );
    // 近くの自治体が読めていて 1 つ以上あれば、どこで何件かをボタンで並べる。なければ今までの 1 文
    body =
      onPickTown && nearby?.status === "ready" && nearby.summary.towns.length > 0 ? (
        <>
          <NearbyPicks nearby={nearby} onPick={onPickTown} />
          <p>{link}</p>
        </>
      ) : (
        <p>
          <span className="town-label">{TEXT.pastLabel}</span> {past.summary.sentence} {link}
        </p>
      );
  } else {
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
  const part = p.part ?? "all";
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
  if (part === "lead") {
    return (
      <section className="town-lead" aria-label={TEXT.myTown}>
        {p.lineFailed ? (
          <p className="state-unknown" role="alert">
            {TEXT.loadFailed}
          </p>
        ) : (
          <div className="town-now" data-tone={p.line?.tone} role="status">
            <p className="town-main">{p.line?.main}</p>
          </div>
        )}
      </section>
    );
  }
  if (part === "rest") {
    // 段階の文と読めない断りは地図の前にあるので、ここでは残りの行だけを描く
    now =
      !p.lineFailed && p.line && p.line.details.length > 0 ? (
        // 段階の色は地図の前の文だけが持つ
        <div className="town-now">
          <ul className="town-details">
            {p.line.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null;
  } else if (p.lineFailed) {
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
    const hideHead = p.hideNationalHead === true && p.line.main === TEXT.national;
    now = hideHead && p.line.details.length === 0 ? null : (
      <div className="town-now" data-tone={p.line.tone} role="status">
        {hideHead ? null : <p className="town-main">{p.line.main}</p>}
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
      {p.muniName || p.nameAction ? (
        <div className="town-name-row">
          {p.muniName ? (
            <p className="town-name">
              <span className="town-label">{TEXT.myTown}</span> <strong>{p.muniName}</strong>
            </p>
          ) : null}
          {p.nameAction}
        </div>
      ) : null}
      {p.spotRow}
      {now}
      <PastRow past={p.past} nearby={p.nearby} town={p.muniCode} line={p.line} showDisclaimer={p.showPastDisclaimer} riskShownAbove={p.riskShownAbove ?? false} brief={p.pastBrief ?? false} onPickTown={p.onPickTown} />
      {/* 最初の画面は「選択地域の過去を見る」の 1 本にする。案内ページへは選択地域の過去の画面から（設計書 2026-11-06-town-picker D8） */}
      {p.pastBrief ? null : (
        <p className="town-area-link">
          <Link to={`/area/${p.muniCode}`} className="tap-link">{TEXT.areaLink}</Link>
        </p>
      )}
      {p.children}
    </section>
  );
}
