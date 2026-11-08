// 再現の帯と Provider。地図などの画面（MapPage、近くで発生した場合の見え方の画面）を、再現の時計と事例で動かす。
// 端末内の地点は読むだけ・書かない: SpotProvider の fixed を必ず渡す（fixed が null だと、地点や町を端末に書いてしまう）。
import { FIXED_TEXT } from "@hpai/shared/wording";
import { NATIONAL_FLOW_ID, type ReplayScenario } from "@hpai/shared/replay";
import type { FarmPoint } from "@hpai/shared/types";
import { useSyncExternalStore, type ReactNode } from "react";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { RecordStore } from "../../data/types";
import { AsOfPrecisionContext, type AsOfPrecision } from "../../ui/AsOf";
import { Fold } from "../../ui/Fold";
import { isDefaultSpot, pointInTime } from "./replayEngine";
import type { ReplayDataSource } from "./ReplayDataSource";
import "./replay.css";

const NOT_IN_REPLAY = () => Promise.reject(new Error("再現では保存できません"));

/** 記録の口が渡されなかったとき用。会員の農場も記録もない（上の階の Firestore の口をここで隠す） */
const EMPTY_RECORD_STORE: RecordStore = {
  mode: "sample",
  getFarm: () => Promise.resolve(null),
  saveFarm: NOT_IN_REPLAY,
  listHouses: () => Promise.resolve([]),
  saveHouse: NOT_IN_REPLAY,
  listDeaths: () => Promise.resolve([]),
  saveDeath: NOT_IN_REPLAY,
  listChecks: () => Promise.resolve([]),
  saveCheck: NOT_IN_REPLAY,
  getCaseDraft: () => Promise.resolve(null),
  isMailStopped: () => Promise.resolve(false),
};

export const REPLAY_NOTES = {
  fourCases: "この再現が流すのは 4 事例だけです（米子市、姫路市、津山市、亀岡市）。ほかの発生は入っていません。",
  watchExample: "県のホームページの確認の状況（地図の斜線）は、説明のための例です。実際の結果ではありません。",
  noMail: "メールは実際には送りません。『このときメールが届く』は、届くとしたらこうなる、という表示です。",
  noTime: "時刻の記載がない発表は『時刻の記載なし』とし、その日の終わりに置いています。",
} as const;

/** 全国の流れの注記。4 事例の文のうち、合わない文（4 事例だけ、メールの枠、時刻の記載のない発表）を替える */
export const NATIONAL_NOTES = {
  flow: (count: number): string => `この流れは、過去の記録にある 2025 年シーズンの発生 ${count} 件を、確定の日の順に並べたものです。関連農場は数えていません。`,
  noLift: "移動制限の解除の日は入っていません。解除までの動きは『12 月の 4 事例』で見られます。",
  noMail: "メールは実際には送りません。この流れでは、メールの下書きも出しません。",
  noTime: "過去の記録は日付だけなので『時刻の記載なし』とし、その日の終わりに置いています。",
} as const;

/** 帯に出す仮の地点の短い 1 行。くわしい説明は「くわしく」の中 */
const SPOT_SHORT = {
  cases: "仮の地点で見ています。特定の農場を指すものではありません。",
  national: "作者の村の中心付近を仮の地点にしています。農場の場所を指すものではありません。",
  device: "この端末にある地点で見ています（端末の外へは送りません）",
} as const;

const SPOT_DETAIL = {
  cases: "仮の地点は、津山市の範囲から 5km 以内に説明のために置いた地点です。",
  national: "仮の地点で見ています（作者の農場がある村の中心付近に置いた約 1km のマス目で、農場の場所を指すものではありません）",
} as const;

/** 帯の残りの注記を畳む部品の見出し */
export const MORE_LABEL = "くわしく";

/** 帯の題。括弧の中（4 事例の町の名）は「くわしく」の注記にあるので、帯では省く */
const bandTitle = (scenario: ReplayScenario): string => scenario.title.replace(/（[^）]*）$/u, "");

export interface ReplayFrameProps {
  scenario: ReplayScenario;
  dataSource: ReplayDataSource;
  /** 見る地点。null は仮の地点（defaultSpot）。どちらも読み取り専用で、端末には書かない */
  spot: FarmPoint | null;
  recordStore?: RecordStore;
  /**
   * 近くで発生した場合の見え方（/sample）の 1 行。これを渡すと、枠つきの再現の帯を出さず（上の帯は画面の骨格の 1 本だけ）、
   * 時点とこの 1 行と「くわしく」を、枠のない短い行で出す。仮の地点の短い 1 行と、くわしくの中の仮の地点の説明は、この 1 行に替える
   */
  note?: string;
  children: ReactNode;
}

export function ReplayFrame({ scenario, dataSource, spot, recordStore, note, children }: ReplayFrameProps) {
  const order = useSyncExternalStore(dataSource.subscribeOrder, dataSource.currentOrder);
  const fixed = spot ?? scenario.defaultSpot;
  const tentative = isDefaultSpot(scenario, spot);
  const timeKnown = order > 0 && scenario.events[order - 1]!.time !== null;
  // 時刻の記載がない時点は、時刻の文字を描かない（日付だけ。はじまる前は何も描かない）。内部の 23:59:59 は画面に出さない
  const precision: AsOfPrecision = timeKnown ? "time" : order === 0 ? "none" : "date";
  const national = scenario.id === NATIONAL_FLOW_ID;
  const spotShort = tentative ? (national ? SPOT_SHORT.national : SPOT_SHORT.cases) : SPOT_SHORT.device;
  const details = (
    <>
      {tentative && !note ? <p>{national ? SPOT_DETAIL.national : SPOT_DETAIL.cases}</p> : null}
      <ul className="replay-notes">
        {national ? (
          <>
            <li>{NATIONAL_NOTES.flow(scenario.events.length)}</li>
            <li>{NATIONAL_NOTES.noLift}</li>
            <li>{REPLAY_NOTES.watchExample}</li>
            <li>{NATIONAL_NOTES.noMail}</li>
            <li>{NATIONAL_NOTES.noTime}</li>
          </>
        ) : (
          <>
            <li>{REPLAY_NOTES.fourCases}</li>
            <li>{REPLAY_NOTES.watchExample}</li>
            <li>{REPLAY_NOTES.noMail}</li>
            <li>{REPLAY_NOTES.noTime}</li>
          </>
        )}
      </ul>
    </>
  );

  return (
    <DataSourceProvider value={dataSource}>
      <RecordStoreProvider value={recordStore ?? EMPTY_RECORD_STORE}>
        <SpotProvider fixed={fixed}>
          {note ? (
            <section className="replay-under" aria-label="去年の再現">
              <p className="replay-time">再現の時点: {pointInTime(scenario, order)}</p>
              <p className="replay-spot">{note}</p>
              <Fold summary={MORE_LABEL} className="band-fold">
                {details}
              </Fold>
            </section>
          ) : (
            <section className="replay-band replay-band-short" aria-label="去年の再現">
              <p className="replay-banner">{FIXED_TEXT.replayBanner}</p>
              <p className="replay-title">{bandTitle(scenario)}</p>
              <p className="replay-time">再現の時点: {pointInTime(scenario, order)}</p>
              <p className="replay-spot">{spotShort}</p>
              <Fold summary={MORE_LABEL} className="band-fold">
                {details}
              </Fold>
            </section>
          )}
          {/* 地図の h1 は『今季』と出るので隠し、再現の画面が『去年の再現』の見出しを出す（replay.css） */}
          <AsOfPrecisionContext.Provider value={precision}>
            <div className="replay-scope" data-time-known={timeKnown ? "true" : "false"}>
              {children}
            </div>
          </AsOfPrecisionContext.Provider>
        </SpotProvider>
      </RecordStoreProvider>
    </DataSourceProvider>
  );
}
