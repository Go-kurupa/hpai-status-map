// 見本の農場の記録の口（契約 3.10、X-08）。このインスタンスの中（メモリ）だけで動く。
// サーバーにも localStorage にも書かない。新しく作れば、渡された元のデータに戻る。会員の本物の記録と混ざらない。
import type { SampleFarmData } from "@hpai/shared/replay";
import type { CaseDraft, CheckRecord, DeathRecord, Farm, House, IsoDate } from "@hpai/shared/types";
import type { RecordStore } from "../../data/types";

type FarmWithId = Farm & { id: string };
type HouseWithId = House & { id: string };
type CheckWithId = CheckRecord & { id: string };

const clone = <T>(v: T): T => structuredClone(v);
const byDate = <T extends { date: IsoDate }>(a: T, b: T): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Firestore の記録の口と同じ id（消毒は dis_{日付}_{項目}、自己点検は self_{月}） */
function checkId(c: CheckRecord): string {
  return c.kind === "disinfection" ? `dis_${c.date}_${c.itemId}` : `self_${c.month}`;
}

export class SampleRecordStore implements RecordStore {
  readonly mode = "sample" as const;
  private farm: FarmWithId;
  private houses: HouseWithId[];
  private deaths: DeathRecord[];
  private checks: CheckWithId[];
  private nextHouse = 1;

  /** 渡されたデータは書き換えない（複製して持つ） */
  constructor(data: SampleFarmData) {
    this.farm = clone(data.farm);
    this.houses = clone(data.houses);
    this.deaths = clone(data.deaths);
    this.checks = clone(data.checks);
  }

  getFarm = (): Promise<FarmWithId | null> => Promise.resolve(clone(this.farm));

  saveFarm = (patch: Partial<Omit<Farm, "memberUids" | "unsubscribedUids">>): Promise<void> => {
    // 会員の欄（memberUids、unsubscribedUids）は型でも受けないが、渡されても写さない
    const rest: Partial<Farm> = clone(patch);
    delete rest.memberUids;
    delete rest.unsubscribedUids;
    this.farm = { ...this.farm, ...rest };
    return Promise.resolve();
  };

  listHouses = (): Promise<HouseWithId[]> => Promise.resolve(clone(this.houses));

  saveHouse = (h: House & { id?: string }): Promise<void> => {
    const data: House = { name: h.name, birdType: h.birdType, flockSize: h.flockSize, empty: h.empty };
    const i = h.id === undefined ? -1 : this.houses.findIndex((x) => x.id === h.id);
    if (h.id !== undefined && i >= 0) {
      this.houses[i] = { id: h.id, ...data };
    } else if (h.id !== undefined) {
      this.houses.push({ id: h.id, ...data });
    } else {
      let id = `sample-house-${this.nextHouse++}`;
      while (this.houses.some((x) => x.id === id)) id = `sample-house-${this.nextHouse++}`;
      this.houses.push({ id, ...data });
    }
    return Promise.resolve();
  };

  listDeaths = (from: IsoDate, to: IsoDate): Promise<DeathRecord[]> =>
    Promise.resolve(clone(this.deaths.filter((d) => d.date >= from && d.date <= to).sort(byDate)));

  saveDeath = (r: DeathRecord): Promise<void> => {
    // 入力者を持たない。同じ日と鶏舎は置き換える（Firestore の id が {date}_{houseId} なのと同じ）
    const data: DeathRecord = { date: r.date, houseId: r.houseId, deaths: r.deaths, flockSizeAt: r.flockSizeAt, exclusion: clone(r.exclusion) };
    this.deaths = [...this.deaths.filter((d) => !(d.date === r.date && d.houseId === r.houseId)), data];
    return Promise.resolve();
  };

  listChecks = (from: IsoDate, to: IsoDate): Promise<CheckWithId[]> =>
    Promise.resolve(clone(this.checks.filter((c) => c.date >= from && c.date <= to).sort(byDate)));

  saveCheck = (c: CheckRecord): Promise<void> => {
    const id = checkId(c);
    const data: CheckWithId = clone({ ...c, id });
    this.checks = [...this.checks.filter((x) => x.id !== id), data];
    return Promise.resolve();
  };

  getCaseDraft = (_caseId: string): Promise<CaseDraft | null> => Promise.resolve(null);

  isMailStopped = (): Promise<boolean> => Promise.resolve(false);
}
