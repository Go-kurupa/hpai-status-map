// けさの確認（F3。会員で農場があるときだけ、対策項目の見出しの直下）。朝に探し回らずに見る 4 つ:
// 最新の発生の入口と時点、今日の死亡数の記録の状況、「後でやる」「まだ」の対策、次の報告期限。
// 新しい計算はしない。時点は対策項目と同じ値（useTodoData の asOf）、死亡数は記録の口（listHouses・listDeaths）、
// 対策は下の欄と同じ読み出し（reviewItems.ts）、期限は農場の selfCheckDue。
// 読めないを「変化なし」、未入力を「0 羽」にしない。前回との比べ、安全・危険の判定はしない。
import { REVIEW_STATUS_LABEL } from "@hpai/shared/consult/review";
import { jstDateOf } from "@hpai/shared/dates";
import { latestSelfCheckDue, nextSelfCheckDue } from "@hpai/shared/notices";
import type { DeathRecord, Farm, House, IsoDateTime } from "@hpai/shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordStore } from "../../data/context";
import { useFormatAsOf } from "../../ui/AsOf";
import type { ReviewItem } from "../consult/reviewStore";
import { RECORD_TEXT } from "../record/recordTexts";
import { REVIEWS_ANCHOR } from "./ReviewsSection";
import type { ReviewItems } from "./reviewItems";
import { MORNING_TEXT } from "./texts";

/** 対策の名前を出す数（それぞれ） */
const NAMES_MAX = 3;
/** メモを添えるときの長さ（これより長いメモは切って「…」） */
const NOTE_SHORT = 20;

function Item({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="morning-item">
      <h3>{heading}</h3>
      {children}
    </div>
  );
}

function OutbreakItem({ asOf, loading }: { asOf: IsoDateTime | null; loading: boolean }) {
  const format = useFormatAsOf();
  // 読めない時刻は上の時点の行と同じ「確認できていません」（「…の確認」を付けない）
  const unchecked = asOf === null || Number.isNaN(new Date(asOf).getTime());
  const formatted = loading || unchecked ? null : format(asOf);
  const text = loading ? MORNING_TEXT.loading : unchecked ? MORNING_TEXT.outbreakUnchecked : formatted === null ? null : MORNING_TEXT.outbreakAsOf(formatted);
  return (
    <Item heading={MORNING_TEXT.outbreakHeading}>
      {text !== null ? <p>{text}</p> : null}
      <p>
        <Link to="/" className="tap-link">
          {MORNING_TEXT.outbreakLink}
        </Link>
      </p>
    </Item>
  );
}

type DeathsLoad =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; houses: Array<House & { id: string }>; deaths: DeathRecord[] };

function DeathsItem() {
  const store = useRecordStore();
  const ds = useDataSource();
  const [load, setLoad] = useState<DeathsLoad>({ status: "loading" });

  useEffect(() => {
    let off = false;
    const today = jstDateOf(ds.now());
    // 口が投げても（同期の例外も）「読めませんでした」にする
    Promise.resolve()
      .then(() => Promise.all([store.listHouses(), store.listDeaths(today, today)]))
      .then(
        ([houses, deaths]) => !off && setLoad({ status: "ready", houses, deaths: deaths.filter((d) => d.date === today) }),
        () => !off && setLoad({ status: "failed" }),
      );
    return () => {
      off = true;
    };
  }, [store, ds]);

  let body: ReactNode;
  if (load.status === "loading") body = <p>{MORNING_TEXT.loading}</p>;
  else if (load.status === "failed") body = <p>{MORNING_TEXT.failed}</p>;
  else if (load.houses.length === 0)
    body = (
      <p>
        {RECORD_TEXT.noHousesYet}{" "}
        <Link to="/settings/farm#houses" className="tap-link">
          {RECORD_TEXT.addHouseLink}
        </Link>
      </p>
    );
  else
    body = (
      <ul className="morning-list">
        {load.houses.map((h) => {
          const rec = load.deaths.find((d) => d.houseId === h.id);
          return (
            <li key={h.id}>
              {h.name}: {rec ? MORNING_TEXT.deathsRecorded(rec.deaths) : h.empty ? MORNING_TEXT.deathsVacant : MORNING_TEXT.deathsMissing}
            </li>
          );
        })}
      </ul>
    );

  // 鶏舎がないときは記録できないので、鶏舎を足す入口だけにする
  const noHouses = load.status === "ready" && load.houses.length === 0;
  return (
    <Item heading={MORNING_TEXT.deathsHeading}>
      {body}
      {noHouses ? null : (
        <p>
          <Link to="/record/deaths" className="tap-link">
            {MORNING_TEXT.deathsLink}
          </Link>
        </p>
      )}
    </Item>
  );
}

const shortNote = (note: string) => (note.length > NOTE_SHORT ? `${note.slice(0, NOTE_SHORT)}…` : note);

function ReviewGroup({
  label,
  items,
  names,
  unrecorded = 0,
}: {
  label: string;
  items: ReviewItem[];
  names: ReadonlyMap<string, string> | null;
  /** 記録なし（状態を一度も記録していない）の数。0 なら内訳を出さない */
  unrecorded?: number;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, NAMES_MAX);
  return (
    <>
      <p className="morning-count">
        {MORNING_TEXT.reviewsCount(label, items.length)}
        {unrecorded > 0 ? MORNING_TEXT.reviewsUnrecorded(unrecorded) : ""}
      </p>
      {names ? (
        <ul className="morning-list" aria-label={label}>
          {shown.map((it) => (
            <li key={it.id}>
              {names.get(it.id)}
              {it.note ? MORNING_TEXT.reviewsNote(shortNote(it.note)) : ""}
            </li>
          ))}
          {items.length > NAMES_MAX ? <li>{MORNING_TEXT.reviewsMore(items.length - NAMES_MAX)}</li> : null}
        </ul>
      ) : null}
    </>
  );
}

function ReviewsItem({ reviews }: { reviews: ReviewItems }) {
  const { load, catalog } = reviews;
  let body: ReactNode;
  if (load.status === "loading") body = <p>{MORNING_TEXT.loading}</p>;
  else if (load.status === "failed") body = <p>{MORNING_TEXT.failed}</p>;
  else {
    // 今の資料にないカードは数えない（下の欄でも状態のボタンが出ない）。資料を読めなければ全部を数え、名前は出さない
    const counted = catalog ? load.items.filter((x) => catalog.cards.has(x.id)) : load.items;
    const later = counted.filter((x) => x.status === "later");
    const notYet = counted.filter((x) => x.status === null || x.status === "pending");
    const names = catalog ? new Map(counted.map((x) => [x.id, catalog.cards.get(x.id)?.action ?? x.id])) : null;
    body =
      later.length + notYet.length === 0 ? (
        <p>{MORNING_TEXT.reviewsNone}</p>
      ) : (
        <>
          <ReviewGroup label={REVIEW_STATUS_LABEL.later} items={later} names={names} />
          <ReviewGroup label={REVIEW_STATUS_LABEL.pending} items={notYet} names={names} unrecorded={notYet.filter((x) => x.status === null).length} />
        </>
      );
  }
  return (
    <Item heading={MORNING_TEXT.reviewsHeading}>
      {body}
      <p>
        {/* 同じ画面の下の欄へ。ページの中の移動なので a の既定の動き（その位置へ移る）に任せる */}
        <a href={`#${REVIEWS_ANCHOR}`} className="tap-link">
          {MORNING_TEXT.reviewsLink}
        </a>
      </p>
    </Item>
  );
}

/** "2026-11-30" → "11 月 30 日"。この画面の時点（AsOf）と更新の行と同じ、数字の前後を空ける書き方 */
const monthDay = (d: string) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`;

function DueItem({ farm }: { farm: Farm }) {
  const ds = useDataSource();
  const next = nextSelfCheckDue(farm.selfCheckDue, jstDateOf(ds.now()));
  // 今日以降の期限がないとき、登録が 1 件でもあれば「すべて過ぎた」。「登録されていません」と言わない
  const lastDue = next === null ? latestSelfCheckDue(farm.selfCheckDue) : null;
  return (
    <Item heading={MORNING_TEXT.dueHeading}>
      {next ? (
        <>
          <p>{MORNING_TEXT.dueLine(monthDay(next.date), next.daysLeft)}</p>
          <p className="morning-links">
            <Link to="/record/self-check" className="tap-link">
              {MORNING_TEXT.dueRecordLink}
            </Link>
            <Link to="/settings/notify" className="tap-link">
              {MORNING_TEXT.dueChangeLink}
            </Link>
          </p>
        </>
      ) : (
        <>
          <p>{lastDue !== null ? MORNING_TEXT.dueAllPast(monthDay(lastDue)) : MORNING_TEXT.dueNone}</p>
          <p>
            <Link to="/settings/notify" className="tap-link">
              {MORNING_TEXT.dueSetLink}
            </Link>
          </p>
        </>
      )}
    </Item>
  );
}

export function MorningCheck({
  asOf,
  asOfLoading,
  farm,
  reviews,
}: {
  asOf: IsoDateTime | null;
  asOfLoading: boolean;
  farm: Farm & { id: string };
  reviews: ReviewItems;
}) {
  return (
    <section className="morning-check" role="region" aria-label={MORNING_TEXT.heading}>
      <h2>{MORNING_TEXT.heading}</h2>
      <div className="morning-grid">
        <OutbreakItem asOf={asOf} loading={asOfLoading} />
        <DeathsItem />
        <ReviewsItem reviews={reviews} />
        <DueItem farm={farm} />
      </div>
    </section>
  );
}
