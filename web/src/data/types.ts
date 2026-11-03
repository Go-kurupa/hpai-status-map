// 契約 3.10 画面のデータの口。地図と記録の画面は Firestore を直接呼ばない。
// 再現と見本の農場が同じ画面を使うため。
import type {
  Case,
  CaseDraft,
  CheckRecord,
  DeathRecord,
  Farm,
  House,
  HistoryCase,
  IsoDate,
  Season,
  WatchStatus,
  WildBird,
} from "@hpai/shared/types";

export type Unsubscribe = () => void;

export interface DataSource {
  mode: "live" | "replay";
  /** 公開の画面の時計はこれだけ */
  now(): Date;
  subscribeCases(season: Season, cb: (cases: Case[]) => void): Unsubscribe;
  subscribeWildBirds(season: Season, cb: (birds: WildBird[]) => void): Unsubscribe;
  subscribeWatchStatus(cb: (all: WatchStatus[]) => void): Unsubscribe;
  loadHistory(): Promise<HistoryCase[]>;
}

export interface RecordStore {
  mode: "firestore" | "sample";
  getFarm(): Promise<(Farm & { id: string }) | null>;
  saveFarm(patch: Partial<Omit<Farm, "memberUids" | "unsubscribedUids">>): Promise<void>;
  listHouses(): Promise<Array<House & { id: string }>>;
  saveHouse(h: House & { id?: string }): Promise<void>;
  listDeaths(from: IsoDate, to: IsoDate): Promise<DeathRecord[]>;
  saveDeath(r: DeathRecord): Promise<void>;
  listChecks(from: IsoDate, to: IsoDate): Promise<Array<CheckRecord & { id: string }>>;
  saveCheck(c: CheckRecord): Promise<void>;
  /** sample、未ログイン、claim なし（拒否を変換）は null。画面は雛形に戻る */
  getCaseDraft(caseId: string): Promise<CaseDraft | null>;
  /** 自分の uid が unsubscribedUids にある。sample は false */
  isMailStopped(): Promise<boolean>;
}
