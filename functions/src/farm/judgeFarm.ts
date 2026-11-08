// 審査員用の見本の農場（2026-11-08 豪さんとの相談）。審査員は全員、1 つの会員（JUDGE_UID）と 1 つの農場（JUDGE_FARM_ID）に入る。
// judgeSignIn が呼ぶたびに、会員と農場をそろえ、記録のない日だけ作り物の記録を足す。
// - 書くのは create だけ（あれば飛ばす）。審査員が直した設定や、入れた記録を上書きしない。
// - 文書の id は日付と鶏舎から決める（死亡数 {date}_{houseId}、消毒 dis_{date}_{itemId}、自己点検 self_{month}）。
//   2 人が同時に開いても二重にならない（後から来た create は ALREADY_EXISTS で飛ばす）。
// - 数は日付から決める（乱数を使わない）。死亡数は届け出の基準（死亡率が平均の 2 倍）に当たらない並び。
// - 会員はメールアドレスを持たない。知らせのメールは宛先がないので届かない。
// - 2 人目以降のログインを軽くする: 農場・鍵・鶏舎と、前日の分（飼育中の鶏舎の死亡数、消毒）・前の月の自己点検が
//   そろっていれば、1 回の読み込み（getAll）だけで戻る（会員の claim の付け直しは毎回する）。
// 限界: 審査員が消した記録（範囲の中の日）は、その日のうちは作り直されない。前日の分が欠けた回（翌日の最初のログインなど）に
//   作り直される。前日の分そのものを消すと、そのたびに全部を確かめて作り直す。
import type { Auth } from "firebase-admin/auth";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { addDays, diffDays, jstDateOf, toJstIso } from "@hpai/shared/dates";
import { JUDGE_FARM_ID, JUDGE_FARM_NAME, JUDGE_UID } from "@hpai/shared/judge";
import { selfCheckMonthsOf } from "@hpai/shared/notices";
import { NATIONAL_FLOW_SPOT } from "@hpai/shared/replay";
import type { CheckRecord, DeathRecord, Farm, House, IsoDate, SelfCheckItemNo } from "@hpai/shared/types";

export interface JudgeFarmDeps {
  db: Firestore;
  auth: Auth;
  now: () => Date;
}

/** 記録を足す範囲（今日の前日までの日数） */
export const JUDGE_DEATH_DAYS = 28;
/** 消毒の記録を足す範囲（今日の前日までの日数） */
export const JUDGE_DISINFECTION_DAYS = 14;
/** 消毒の記録の項目（確認リストの「やった」を残せる項目。見本の農場と同じ 2 つ） */
export const JUDGE_DISINFECTION_ITEMS = ["always-17", "always-22"] as const;

/** 見本の鶏舎。死亡数を足すのは飼育中の 1 号舎と 2 号舎 */
export const JUDGE_HOUSES: ReadonlyArray<House & { id: string }> = [
  { id: "house-1", name: "1 号舎", birdType: "採卵鶏", flockSize: 1200, empty: false },
  { id: "house-2", name: "2 号舎", birdType: "採卵鶏", flockSize: 800, empty: false },
  { id: "house-3", name: "3 号舎", birdType: "採卵鶏", flockSize: 0, empty: true },
];
const DEATH_HOUSES: ReadonlyArray<{ id: string; offset: number }> = [
  { id: "house-1", offset: 0 },
  { id: "house-2", offset: 3 },
];

/**
 * 7 日でひと回りする死亡数（0〜3 羽、合計 13 羽）。続いた 21 日の合計はいつも 39 羽（平均 1.86 羽）で、3 羽の日も平均の 2 倍に届かない。
 * 記録の抜けで 21 日が 2 つの続きに分かれても、合計は 36 羽を下回らない（3 羽 < 2 × 36 / 21）。
 */
const DEATH_CYCLE = [2, 1, 3, 2, 0, 2, 3] as const;
/** 日の通し番号の起点 */
const EPOCH: IsoDate = "2000-01-01";

const dayNo = (date: IsoDate): number => diffDays(date, EPOCH);
const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** その日・その鶏舎の作り物の死亡数。houseOffset で鶏舎ごとに並びをずらす */
export function judgeDeathsOn(date: IsoDate, houseOffset: number): number {
  return DEATH_CYCLE[mod(dayNo(date) + houseOffset, DEATH_CYCLE.length)]!;
}

/** 消毒を記録した日か。7 日のうち 5 日なので、どの 14 日を取っても 10 日になる */
export function judgeDisinfectedOn(date: IsoDate): boolean {
  return mod(dayNo(date), 7) < 5;
}

/** 自己点検の答え。「できている」が多く、ネットの点検（25）だけ「できていない」 */
export const JUDGE_SELF_CHECK_ANSWERS: Record<SelfCheckItemNo, "ok" | "ng" | null> = {
  "17": "ok",
  "18": "ok",
  "19": "ok",
  "22": "ok",
  "23": "ok",
  "25": "ng",
  "27": "ok",
};

/** "2026-11" の前の月 */
function prevMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** month の分の自己点検の期限（翌月の 10 日。画面の「翌月の N 日」と同じ形） */
function dueOf(month: string): IsoDate {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-10`;
}

/** 新しく作るときの農場の文書。項目は firestore.rules の farmShapeOk の一覧に収める */
export function judgeFarmDoc(now: Date): Farm {
  const today = jstDateOf(now);
  return {
    name: JUDGE_FARM_NAME,
    memberUids: [JUDGE_UID],
    unsubscribedUids: [],
    // 去年の再現と同じ、作者の村の中心付近の約 1km のマス目（農場の場所ではない）
    meshCode: NATIONAL_FLOW_SPOT.meshCode,
    muniCode: NATIONAL_FLOW_SPOT.muniCode,
    prefCode: NATIONAL_FLOW_SPOT.muniCode.slice(0, 2),
    frequentMuniCodes: [],
    production: "layer",
    housing: "windowless",
    rearing: "cage",
    kahoContact: "",
    // 知らせは全部切る（宛先もないが、記録も作らない）
    notify: { level1: false, level2: false, level3: false, morningDigest: false, selfCheckRemindDays: null },
    selfCheckDue: Object.fromEntries(selfCheckMonthsOf(today).map((m) => [m, dueOf(m)])),
    updatedAt: toJstIso(now),
  };
}

function isAlreadyExists(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists";
}

/** ないときだけ作る。同時に作られた分（ALREADY_EXISTS）は飛ばす */
async function createIfMissing(ref: DocumentReference, data: object): Promise<void> {
  try {
    await ref.create(data);
  } catch (e) {
    if (!isAlreadyExists(e)) throw e;
  }
}

/** 有無を 1 回の読みで確かめ、ない文書だけを 1 件ずつ作る（バッチにしない。1 件の衝突で全部を落とさない） */
async function createMissing(db: Firestore, docs: ReadonlyArray<{ ref: DocumentReference; data: object }>): Promise<void> {
  if (docs.length === 0) return;
  const snaps = await db.getAll(...docs.map((d) => d.ref));
  const missing = docs.filter((_, i) => !snaps[i]!.exists);
  await Promise.all(missing.map((d) => createIfMissing(d.ref, d.data)));
}

async function ensureJudgeUser(auth: Auth): Promise<void> {
  try {
    await auth.getUser(JUDGE_UID);
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== "auth/user-not-found") throw e;
    try {
      // メールアドレスを持たない会員（知らせのメールは届かない）
      await auth.createUser({ uid: JUDGE_UID, displayName: JUDGE_FARM_NAME });
    } catch (e2) {
      if ((e2 as { code?: unknown } | null)?.code !== "auth/uid-already-exists") throw e2;
    }
  }
  const claims = (await auth.getUser(JUDGE_UID)).customClaims ?? {};
  if (claims.member !== true || claims.judge !== true) {
    await auth.setCustomUserClaims(JUDGE_UID, { ...claims, member: true, judge: true });
  }
}

/** 死亡数を足す鶏舎か（飼育中で、羽数が正の整数） */
function isActiveHouse(house: House | undefined): house is House {
  return !!house && !house.empty && Number.isInteger(house.flockSize) && house.flockSize > 0;
}

/**
 * 足すものがもうないか（2 人目以降のログインの近道）。1 回の getAll で、農場・鍵・鶏舎 3 つ・前日の死亡数（1 号舎と 2 号舎）・
 * 前日の消毒（記録する日なら）・前の月の自己点検を読む。どれか欠けていれば false（全部を確かめる道へ）。
 * 空舎や羽数 0 にされた鶏舎の死亡数は、もともと足さないので問わない。
 */
async function alreadyReady(db: Firestore, farmRef: DocumentReference, lockRef: DocumentReference, today: IsoDate): Promise<boolean> {
  const yesterday = addDays(today, -1);
  const houseCol = farmRef.collection("houses");
  const checks = farmRef.collection("checks");
  const houseRefs = JUDGE_HOUSES.map((h) => houseCol.doc(h.id));
  const deathRefs = DEATH_HOUSES.map((h) => farmRef.collection("deaths").doc(`${yesterday}_${h.id}`));
  const checkRefs = [
    ...(judgeDisinfectedOn(yesterday) ? JUDGE_DISINFECTION_ITEMS.map((itemId) => checks.doc(`dis_${yesterday}_${itemId}`)) : []),
    checks.doc(`self_${prevMonthOf(today.slice(0, 7))}`),
  ];
  const snaps = await db.getAll(farmRef, lockRef, ...houseRefs, ...deathRefs, ...checkRefs);
  const [farm, lock, ...rest] = snaps;
  const houses = rest.slice(0, houseRefs.length);
  const deaths = rest.slice(houseRefs.length, houseRefs.length + deathRefs.length);
  const others = rest.slice(houseRefs.length + deathRefs.length);
  if (!farm!.exists || !lock!.exists) return false;
  if (!houses.every((h) => h.exists)) return false;
  const deathsOk = DEATH_HOUSES.every((h, i) => {
    const house = houses[JUDGE_HOUSES.findIndex((j) => j.id === h.id)]!.data() as House | undefined;
    return !isActiveHouse(house) || deaths[i]!.exists;
  });
  return deathsOk && others.every((c) => c.exists);
}

/**
 * 審査員の会員と農場をそろえる。何度呼んでも、同時に呼んでも、結果は同じ。
 * 会員: uid JUDGE_UID、claim {member: true, judge: true}。
 * 農場: farms/JUDGE_FARM_ID と鶏舎 3 つ。記録は今日の前日までの範囲で、記録のない日だけ足す
 *   （死亡数 28 日 × 飼育中の鶏舎、消毒は直近 14 日のうち 10 日、自己点検は前の月）。
 */
export async function ensureJudgeFarm(deps: JudgeFarmDeps): Promise<void> {
  const { db, auth } = deps;
  const now = deps.now();
  const today = jstDateOf(now);
  const farmRef = db.collection("farms").doc(JUDGE_FARM_ID);
  const lockRef = db.collection("invites").doc("_membership").collection("uids").doc(JUDGE_UID);

  await ensureJudgeUser(auth);

  if (await alreadyReady(db, farmRef, lockRef, today)) return;

  // 農場（審査員が直した設定は上書きしない）
  await createIfMissing(farmRef, judgeFarmDoc(now));
  // 1 会員 1 農場の鍵。審査員が自分の uid の農場を作れないようにする（作られると全員の画面が「所属が複数」で止まる）
  await createIfMissing(lockRef, {
    touchedAt: toJstIso(now),
    farmId: JUDGE_FARM_ID,
  });

  // 鶏舎（なければ作る。審査員が直した羽数などは上書きしない）
  const houseCol = farmRef.collection("houses");
  await createMissing(
    db,
    JUDGE_HOUSES.map(({ id, ...house }) => ({ ref: houseCol.doc(id), data: house })),
  );

  // 死亡数。羽数は今の鶏舎の値（空舎にされた鶏舎には足さない）
  const houseSnaps = await db.getAll(...DEATH_HOUSES.map((h) => houseCol.doc(h.id)));
  const deathDocs: Array<{ ref: DocumentReference; data: DeathRecord }> = [];
  DEATH_HOUSES.forEach((h, i) => {
    const house = houseSnaps[i]!.data() as House | undefined;
    if (!isActiveHouse(house)) return;
    for (let d = 1; d <= JUDGE_DEATH_DAYS; d++) {
      const date = addDays(today, -d);
      const data: DeathRecord = { date, houseId: h.id, deaths: judgeDeathsOn(date, h.offset), flockSizeAt: house.flockSize, exclusion: null };
      deathDocs.push({ ref: farmRef.collection("deaths").doc(`${date}_${h.id}`), data });
    }
  });

  // 点検と消毒
  const checks = farmRef.collection("checks");
  const checkDocs: Array<{ ref: DocumentReference; data: CheckRecord }> = [];
  for (let d = 1; d <= JUDGE_DISINFECTION_DAYS; d++) {
    const date = addDays(today, -d);
    if (!judgeDisinfectedOn(date)) continue;
    for (const itemId of JUDGE_DISINFECTION_ITEMS) {
      checkDocs.push({ ref: checks.doc(`dis_${date}_${itemId}`), data: { kind: "disinfection", date, itemId } });
    }
  }
  // 前の月の自己点検。記録した日は、その月の 25 日（画面は記録した月の分として保存する）
  const prev = prevMonthOf(today.slice(0, 7));
  checkDocs.push({
    ref: checks.doc(`self_${prev}`),
    data: { kind: "self_inspection", date: `${prev}-25`, month: prev, answers: { ...JUDGE_SELF_CHECK_ANSWERS } },
  });

  await createMissing(db, [...deathDocs, ...checkDocs]);
}
