// 再現の帯と Provider。地図などの画面（MapPage、見本の農場の画面）を、再現の時計と事例で動かす。
// 端末内の地点は読むだけ・書かない: SpotProvider の fixed を必ず渡す（fixed が null だと、地点や町を端末に書いてしまう）。
import { FIXED_TEXT } from "@hpai/shared/wording";
import type { ReplayScenario } from "@hpai/shared/replay";
import type { FarmPoint } from "@hpai/shared/types";
import { useSyncExternalStore, type ReactNode } from "react";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { RecordStore } from "../../data/types";
import { AsOfPrecisionContext, type AsOfPrecision } from "../../ui/AsOf";
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
  watchExample: "見回りの状況（地図の斜線）は説明のための例です。実際の見回りの結果ではありません。",
  noMail: "メールは実際には送りません。『このときメールが届く』は、届くとしたらこうなる、という表示です。",
  noTime: "時刻の記載がない発表は『時刻の記載なし』とし、その日の終わりに置いています。",
} as const;

export interface ReplayFrameProps {
  scenario: ReplayScenario;
  dataSource: ReplayDataSource;
  /** 見る地点。null は仮の地点（defaultSpot）。どちらも読み取り専用で、端末には書かない */
  spot: FarmPoint | null;
  recordStore?: RecordStore;
  /** 再現の帯より前に置くもの（見本の断りを最初の画面に入れる） */
  lead?: ReactNode;
  children: ReactNode;
}

export function ReplayFrame({ scenario, dataSource, spot, recordStore, lead, children }: ReplayFrameProps) {
  const order = useSyncExternalStore(dataSource.subscribeOrder, dataSource.currentOrder);
  const fixed = spot ?? scenario.defaultSpot;
  const tentative = isDefaultSpot(scenario, spot);
  const timeKnown = order > 0 && scenario.events[order - 1]!.time !== null;
  // 時刻の記載がない時点は、時刻の文字を描かない（日付だけ。はじまる前は何も描かない）。内部の 23:59:59 は画面に出さない
  const precision: AsOfPrecision = timeKnown ? "time" : order === 0 ? "none" : "date";

  return (
    <DataSourceProvider value={dataSource}>
      <RecordStoreProvider value={recordStore ?? EMPTY_RECORD_STORE}>
        <SpotProvider fixed={fixed}>
          {lead}
          <section className="replay-band" aria-label="去年の再現">
            <p className="replay-banner">{FIXED_TEXT.replayBanner}</p>
            <p className="replay-title">{scenario.title}</p>
            <p className="replay-time">再現の時点: {pointInTime(scenario, order)}</p>
            <p className="replay-spot">
              {tentative
                ? "仮の地点で見ています（津山市の範囲から 5km 以内に説明のために置いた地点で、特定の農場を指すものではありません）"
                : "この端末にある地点で見ています（端末の外へは送りません）"}
            </p>
            <ul className="replay-notes">
              <li>{REPLAY_NOTES.fourCases}</li>
              <li>{REPLAY_NOTES.watchExample}</li>
              <li>{REPLAY_NOTES.noMail}</li>
              <li>{REPLAY_NOTES.noTime}</li>
            </ul>
          </section>
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
