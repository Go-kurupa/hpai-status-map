// 会員の記録の口（契約 3.10）。Firestore のルールが守りの本体で、ここは形を整えて読み書きするだけ。
// firebase/* と ../../firebase は動的 import だけにする（型は import type）。静的に読むと公開の画面に Firebase が載る。
//
// 失敗は黙って丸めない。権限や通信の失敗を null、[]、false にすると、画面が「ない」と読み違える
// （isMailStopped を false にすれば、配信を止めた人にメールが届く）。例外は getCaseDraft の permission-denied だけ。
import { toJstIso } from "@hpai/shared/dates";
import type { CaseDraft, CheckRecord, DeathRecord, Farm, House } from "@hpai/shared/types";
import type { Firestore } from "firebase/firestore";
import type { RecordStore } from "../../data/types";
import { NEW_FARM_NOTIFY } from "../settings/farmForm";

interface Session {
  db: Firestore;
  /** 未ログインは null */
  uid: string | null;
}

export interface StoreOptions {
  /** 試験用の時計 */
  now?: () => Date;
}

type FarmWithId = Farm & { id: string };

export const MULTIPLE_FARMS_MESSAGE = "農場の所属が複数あります。運営者に連絡してください";

/** 2 つ以上の農場の会員になっている。どちらかを黙って選ぶと別の農場に書くので、止める（fail closed） */
export class MultipleFarmsError extends Error {
  constructor() {
    super(MULTIPLE_FARMS_MESSAGE);
    this.name = "MultipleFarmsError";
  }
}

const NO_FARM = "農場がありません。先に農場の設定で地点を選んでください";

function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** undefined の項目は送らない（Firestore は undefined を受けない） */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function createStore(getSession: () => Promise<Session>, opts: StoreOptions): RecordStore {
  const now = opts.now ?? (() => new Date());
  // 同じ人の農場の id は覚えておく（鶏舎や記録のたびに探し直さない）。別の人になれば捨てる
  let known: { uid: string; id: string } | null = null;

  async function farmOf(s: Session): Promise<FarmWithId | null> {
    if (!s.uid) return null;
    const fs = await import("firebase/firestore");
    const snap = await fs.getDocs(
      fs.query(fs.collection(s.db, "farms"), fs.where("memberUids", "array-contains", s.uid), fs.limit(2)),
    );
    if (snap.docs.length > 1) {
      known = null;
      throw new MultipleFarmsError();
    }
    const d = snap.docs[0];
    if (!d) {
      known = null;
      return null;
    }
    known = { uid: s.uid, id: d.id };
    return { id: d.id, ...(d.data() as Farm) };
  }

  /** 自分の農場の id。未ログインか農場がなければ null（権限などの失敗は例外のまま） */
  async function farmIdOf(s: Session): Promise<string | null> {
    if (!s.uid) return null;
    if (known && known.uid === s.uid) return known.id;
    return (await farmOf(s))?.id ?? null;
  }

  async function requireFarmId(s: Session): Promise<string> {
    const id = await farmIdOf(s);
    if (!id) throw new Error(NO_FARM);
    return id;
  }

  return {
    mode: "firestore",

    async getFarm() {
      return farmOf(await getSession());
    },

    async saveFarm(patch) {
      const s = await getSession();
      if (!s.uid) throw new Error("ログインしていません");
      const fs = await import("firebase/firestore");
      const fields = { ...defined(patch), updatedAt: toJstIso(now()) };
      const id = await farmIdOf(s);
      if (id) {
        await fs.updateDoc(fs.doc(s.db, "farms", id), fields);
        return;
      }
      // 新しい農場は、地点が決まっているときだけ作る（ルールが meshCode を要る）
      const { meshCode, muniCode, prefCode } = patch;
      if (typeof meshCode !== "string" || typeof muniCode !== "string" || typeof prefCode !== "string") {
        throw new Error("地点を選んでから保存してください");
      }
      const ref = fs.doc(fs.collection(s.db, "farms"));
      const created: Farm = {
        name: "",
        memberUids: [s.uid],
        unsubscribedUids: [],
        meshCode,
        muniCode,
        prefCode,
        frequentMuniCodes: [],
        production: null,
        housing: null,
        kahoContact: "",
        notify: { ...NEW_FARM_NOTIFY },
        selfCheckDue: {},
        ...fields,
      };
      await fs.setDoc(ref, created);
      known = { uid: s.uid, id: ref.id };
    },

    async listHouses() {
      const s = await getSession();
      const farmId = await farmIdOf(s);
      if (!farmId) return [];
      const fs = await import("firebase/firestore");
      const snap = await fs.getDocs(fs.collection(s.db, "farms", farmId, "houses"));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as House) }));
    },

    async saveHouse(h) {
      const s = await getSession();
      const farmId = await requireFarmId(s);
      const fs = await import("firebase/firestore");
      const data: House = { name: h.name, birdType: h.birdType, flockSize: h.flockSize, empty: h.empty };
      const col = fs.collection(s.db, "farms", farmId, "houses");
      if (h.id) await fs.setDoc(fs.doc(col, h.id), data);
      else await fs.addDoc(col, data);
    },

    async listDeaths(from, to) {
      const s = await getSession();
      const farmId = await farmIdOf(s);
      if (!farmId) return [];
      const fs = await import("firebase/firestore");
      const snap = await fs.getDocs(
        fs.query(
          fs.collection(s.db, "farms", farmId, "deaths"),
          fs.where("date", ">=", from),
          fs.where("date", "<=", to),
          fs.orderBy("date"),
        ),
      );
      return snap.docs.map((d) => {
        const r = d.data() as DeathRecord;
        return { date: r.date, houseId: r.houseId, deaths: r.deaths, flockSizeAt: r.flockSizeAt, exclusion: r.exclusion };
      });
    },

    async saveDeath(r) {
      const s = await getSession();
      const farmId = await requireFarmId(s);
      const fs = await import("firebase/firestore");
      // 入力者を持たない。ID は {date}_{houseId}
      const data: DeathRecord = { date: r.date, houseId: r.houseId, deaths: r.deaths, flockSizeAt: r.flockSizeAt, exclusion: r.exclusion };
      await fs.setDoc(fs.doc(s.db, "farms", farmId, "deaths", `${r.date}_${r.houseId}`), data);
    },

    async listChecks(from, to) {
      const s = await getSession();
      const farmId = await farmIdOf(s);
      if (!farmId) return [];
      const fs = await import("firebase/firestore");
      const snap = await fs.getDocs(
        fs.query(
          fs.collection(s.db, "farms", farmId, "checks"),
          fs.where("date", ">=", from),
          fs.where("date", "<=", to),
          fs.orderBy("date"),
        ),
      );
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as CheckRecord) }));
    },

    async saveCheck(c) {
      const s = await getSession();
      const farmId = await requireFarmId(s);
      const fs = await import("firebase/firestore");
      // ID は消毒が dis_{date}_{itemId}、自己点検が self_{month}。入力者を持たない
      const [id, data]: [string, CheckRecord] =
        c.kind === "disinfection"
          ? [`dis_${c.date}_${c.itemId}`, { kind: "disinfection", date: c.date, itemId: c.itemId }]
          : [`self_${c.month}`, { kind: "self_inspection", date: c.date, month: c.month, answers: c.answers }];
      await fs.setDoc(fs.doc(s.db, "farms", farmId, "checks", id), data);
    },

    async getCaseDraft(caseId) {
      const s = await getSession();
      if (!s.uid) return null; // 未ログインは Firestore を呼ばない
      const fs = await import("firebase/firestore");
      try {
        const snap = await fs.getDoc(fs.doc(s.db, "caseDrafts", caseId));
        return snap.exists() ? (snap.data() as CaseDraft) : null;
      } catch (e) {
        if (errorCode(e) === "permission-denied") return null; // claim がない人は雛形に戻る
        throw e;
      }
    },

    async isMailStopped() {
      const s = await getSession();
      const farm = await farmOf(s);
      if (!farm || !s.uid) return false; // 農場がなければ止める相手もいない
      return farm.unsubscribedUids.includes(s.uid);
    },
  };
}

/** 各メソッドの中で getFirebase() と uid を読む。作っただけでは Firebase を読まない。未ログインの getFarm は null */
export function createFirestoreRecordStore(opts: StoreOptions = {}): RecordStore {
  return createStore(async () => {
    const { getFirebase } = await import("../../firebase");
    const { auth, db } = await getFirebase();
    // 読み込み直後は currentUser がまだ null のことがある。保存済みのログインが戻るのを待つ
    await auth.authStateReady();
    return { db, uid: auth.currentUser?.uid ?? null };
  }, opts);
}

/** 試験用。db と uid を渡す */
export function createFirestoreRecordStoreWith(db: Firestore, uid: string, opts: StoreOptions = {}): RecordStore {
  return createStore(async () => ({ db, uid }), opts);
}
