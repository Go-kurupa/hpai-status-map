// 今日のやること（2026-11-07 A。会員で農場があるときだけ。F3 の「けさの確認」を置き換えた）。
// 記録できるものだけを 1 本のリストにする。保存の形と記録の仕組みは変えず、画面で 1 本に見せるだけ:
//   1 死亡数（鶏舎ごと。記録の口 listHouses・listDeaths。空舎は出さない）
//   2 消毒（確認リストの disinfectionLoggable。DoneButton と saveCheck をそのまま）
//   3 AI の相談から追加した対策（F1。reviewItems.ts の読み出しと markReview をそのまま）
//   4 自己点検（農場の selfCheckDue と、今月の記録の有無）
// 並びは、全部の読み出しが終わったときに「まだ → 後でやる → 済み」で 1 度だけ決め、押しても動かさない
// （押した行が指の下から動き、次の行を押し間違えないように）。集計は押すたびに変わる。
// 読めないを「済み」「変化なし」、未入力を「0 羽」にしない。前回との比べ、安全・危険の判定はしない。
import type { ChecklistItem } from "@hpai/shared/checklist";
import { jstDateOf } from "@hpai/shared/dates";
import { latestSelfCheckDue, nextSelfCheckDue } from "@hpai/shared/notices";
import type { DeathRecord, Farm, House } from "@hpai/shared/types";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordStore } from "../../data/context";
import { DoneButton, type DisinfectionLog } from "../record/disinfectionLog";
import { byHouseName } from "../record/houseOrder";
import { RECORD_TEXT } from "../record/recordTexts";
import type { ReviewItems } from "./reviewItems";
import { reviewMark, ReviewRow } from "./ReviewsSection";
import { TODAY_TEXT, TODO_TEXT } from "./texts";
import { COUNTED, MARK_RANK, TodayRow, type TodayMark } from "./TodayRow";

type Load<T> = { status: "loading" } | { status: "failed" } | { status: "ready"; value: T };

interface DeathsValue {
  houses: Array<House & { id: string }>;
  deaths: DeathRecord[];
}
interface ChecksValue {
  /** 今日「やった」を記録した消毒の項目 */
  disinfectionToday: ReadonlySet<string>;
  /** 自己点検を記録した月（"YYYY-MM"） */
  selfMonths: ReadonlySet<string>;
}

/** 今日の死亡数と、今月の記録（消毒と自己点検）を 1 度ずつ読む。口が投げても（同期の例外も）「読めませんでした」にする */
function useTodayRecords(): { deaths: Load<DeathsValue>; checks: Load<ChecksValue> } {
  const store = useRecordStore();
  const ds = useDataSource();
  const [deaths, setDeaths] = useState<Load<DeathsValue>>({ status: "loading" });
  const [checks, setChecks] = useState<Load<ChecksValue>>({ status: "loading" });

  useEffect(() => {
    let off = false;
    const today = jstDateOf(ds.now());
    const month = today.slice(0, 7);
    Promise.resolve()
      .then(() => Promise.all([store.listHouses(), store.listDeaths(today, today)]))
      .then(
        ([houses, rows]) => !off && setDeaths({ status: "ready", value: { houses, deaths: rows.filter((d) => d.date === today) } }),
        () => !off && setDeaths({ status: "failed" }),
      );
    // 消毒の「やった」の部品（useDisinfectionLog）は読み終わりを外に出さないので、開いたときの印はここで読む
    Promise.resolve()
      .then(() => store.listChecks(`${month}-01`, today))
      .then(
        (rows) => {
          if (off) return;
          const disinfectionToday = new Set<string>();
          const selfMonths = new Set<string>();
          for (const r of rows) {
            if (r.kind === "disinfection" && r.date === today) disinfectionToday.add(r.itemId);
            if (r.kind === "self_inspection") selfMonths.add(r.month);
          }
          setChecks({ status: "ready", value: { disinfectionToday, selfMonths } });
        },
        () => !off && setChecks({ status: "failed" }),
      );
    return () => {
      off = true;
    };
  }, [store, ds]);

  return { deaths, checks };
}

/** "2026-11-30" → "11 月 30 日"。この画面の時点（AsOf）と更新の行と同じ、数字の前後を空ける書き方 */
const monthDay = (d: string) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`;

interface Row {
  key: string;
  mark: TodayMark;
  /** first は、並べた後の消毒の最初の行か（「記録は任意」をそこに 1 回だけ添える） */
  render(first: boolean): ReactNode;
}

function deathRows(load: Load<DeathsValue>): Row[] {
  if (load.status === "loading") return [];
  if (load.status === "failed")
    return [
      {
        key: "deaths",
        mark: "unknown",
        render: () => (
          <TodayRow
            mark="unknown"
            text={TODAY_TEXT.deathsAll}
            sub={TODAY_TEXT.failed}
            act={
              <Link to="/record/deaths" className="btn">
                {TODAY_TEXT.deathsRecord}
              </Link>
            }
          />
        ),
      },
    ];
  const { houses, deaths } = load.value;
  if (houses.length === 0)
    return [
      {
        key: "deaths",
        mark: "todo",
        render: () => (
          <TodayRow
            mark="todo"
            text={TODAY_TEXT.deathsAll}
            sub={RECORD_TEXT.noHousesYet}
            act={
              <Link to="/settings/farm#houses" className="btn">
                {RECORD_TEXT.addHouseLink}
              </Link>
            }
          />
        ),
      },
    ];
  // 空舎にした鶏舎は記録しないので出さない。保存の側は順を決めないので、名前の順に並べる（死亡数の画面と同じ順）
  return byHouseName(houses)
    .filter((h) => !h.empty)
    .map((h): Row => {
      const rec = deaths.find((d) => d.houseId === h.id);
      const mark: TodayMark = rec ? "done" : "todo";
      return {
        key: `deaths:${h.id}`,
        mark,
        render: () => (
          <TodayRow
            mark={mark}
            text={TODAY_TEXT.deathsRow(h.name)}
            sub={rec ? TODAY_TEXT.deathsRecorded(rec.deaths) : TODAY_TEXT.deathsMissing}
            act={
              rec ? undefined : (
                <Link to="/record/deaths" className="btn">
                  {TODAY_TEXT.deathsRecord}
                </Link>
              )
            }
          />
        ),
      };
    });
}

function isWebUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

function disinfectionRows(items: readonly ChecklistItem[], checks: Load<ChecksValue>, log: DisinfectionLog): Row[] {
  return items.map((item): Row => {
    const done = log.doneToday.has(item.id) || (checks.status === "ready" && checks.value.disinfectionToday.has(item.id));
    const mark: TodayMark = done ? "done" : checks.status === "failed" ? "unknown" : "todo";
    const src = isWebUrl(item.source.url) ? (
      <a
        href={item.source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="today-src"
        aria-label={TODAY_TEXT.sourceLabel(item.source.title, item.text)}
      >
        {TODAY_TEXT.source}
      </a>
    ) : null;
    const unread = mark === "unknown" ? TODAY_TEXT.disinfectionUnread : null;
    return {
      key: `dis:${item.id}`,
      mark,
      render: (first) => (
        <TodayRow
          mark={mark}
          text={item.text}
          textLink={src}
          sub={[first ? `${TODAY_TEXT.disinfectionOptional}。${TODO_TEXT.doneNoUndo}` : null, unread].filter(Boolean).join("。") || undefined}
          act={<DoneButton itemId={item.id} label={item.text} log={log} />}
        />
      ),
    };
  });
}

function selfRow(farm: Farm, checks: Load<ChecksValue>, today: string): Row {
  const next = nextSelfCheckDue(farm.selfCheckDue, today);
  const month = next?.month ?? today.slice(0, 7);
  const openLink = (
    <Link to="/record/self-check" className="btn">
      {TODAY_TEXT.selfOpen}
    </Link>
  );
  const setLink = (
    <Link to="/settings/notify" className="btn">
      {TODAY_TEXT.dueSetLink}
    </Link>
  );
  const dueText = next ? TODAY_TEXT.selfDue(monthDay(next.date), next.daysLeft) : null;
  // 今日以降の期限がないとき、登録が 1 件でもあれば「すべて過ぎた」。「登録されていません」と言わない
  const lastDue = next === null ? latestSelfCheckDue(farm.selfCheckDue) : null;
  const noDueText = lastDue !== null ? TODAY_TEXT.dueAllPast(monthDay(lastDue)) : TODAY_TEXT.dueNone;

  let mark: TodayMark;
  let sub: ReactNode;
  let act: ReactNode;
  if (checks.status === "failed") {
    mark = "unknown";
    sub = dueText ? `${dueText}。${TODAY_TEXT.selfUnread}` : `${noDueText}。${TODAY_TEXT.selfUnread}`;
    act = next ? openLink : setLink;
  } else if (checks.status === "ready" && checks.value.selfMonths.has(month)) {
    mark = "done";
    sub = TODAY_TEXT.selfDone(Number(month.slice(5, 7)));
  } else if (next) {
    mark = "todo";
    sub = dueText;
    act = openLink;
  } else {
    mark = "info";
    sub = noDueText;
    act = setLink;
  }
  return {
    key: "self",
    mark,
    render: () => (
      <TodayRow mark={mark} markLabel={mark === "info" ? TODAY_TEXT.mark.dueNone : undefined} text={TODAY_TEXT.selfRow} sub={sub} act={act} />
    ),
  };
}

export function TodayList({
  farm,
  levelSettled,
  loggable,
  log,
  reviews,
}: {
  farm: Farm & { id: string };
  /** 段階（近くの発生）が決まったか。段階で消毒の項目が増えるので、決まるまで並びを決めない */
  levelSettled: boolean;
  /** 記録できる消毒の項目（段階に合わせた確認リストのうち disinfectionLoggable） */
  loggable: readonly ChecklistItem[];
  log: DisinfectionLog;
  reviews: ReviewItems;
}) {
  const ds = useDataSource();
  const today = jstDateOf(ds.now());
  const { deaths, checks } = useTodayRecords();
  const { store, load, catalog, applied, removed } = reviews;

  const reviewList = load.status === "ready" ? load.items : [];
  const reviewRows = reviewList.map(
    (item): Row => ({
      key: `review:${item.id}`,
      mark: reviewMark(item, catalog),
      render: () => <ReviewRow item={item} catalog={catalog} store={store} onSaved={applied} onRemoved={removed} />,
    }),
  );
  const all: Row[] = [...deathRows(deaths), ...disinfectionRows(loggable, checks, log), ...reviewRows, selfRow(farm, checks, today)];

  const settled = levelSettled && deaths.status !== "loading" && checks.status !== "loading" && load.status !== "loading";
  // 並びは読み終わったときに 1 度だけ決める（その後に押しても、行の場所は変えない）
  const rankRef = useRef<Map<string, number> | null>(null);
  if (settled && rankRef.current === null) {
    rankRef.current = new Map(all.map((r, i) => [r.key, MARK_RANK[r.mark] * 10_000 + i]));
  }
  const ranks = rankRef.current;
  const sorted = ranks
    ? all
        // 決めた後に増えた行（開いている間に段階が上がって増えた区域の消毒など）は、その印の群の末尾に入れる
        .map((r, i) => ({ r, w: ranks.get(r.key) ?? MARK_RANK[r.mark] * 10_000 + 5_000 + i }))
        .sort((a, b) => a.w - b.w)
        .map((x) => x.r)
    : [];

  const count = (m: TodayMark) => all.filter((r) => r.mark === m).length;
  const unread = all.filter((r) => r.mark === "unknown").length + (load.status === "failed" ? 1 : 0);
  const firstDisinfection = sorted.find((r) => r.key.startsWith("dis:"))?.key ?? null;

  return (
    <section className="today-list" role="region" aria-label={TODAY_TEXT.heading} id="todo-today" tabIndex={-1}>
      <div className="today-head">
        <h2>{TODAY_TEXT.heading}</h2>
        {ranks ? (
          <p className="today-summary">
            {TODAY_TEXT.summary(count("todo"), count("later"), count("done"))}
            {unread > 0 ? TODAY_TEXT.summaryUnread(unread) : ""}
          </p>
        ) : null}
      </div>
      {ranks ? (
        <>
          <ul className="today-rows">
            {sorted.map((r) => (
              <Fragment key={r.key}>{r.render(r.key === firstDisinfection)}</Fragment>
            ))}
          </ul>
          {load.status === "failed" ? <p role="alert">{TODO_TEXT.reviewsLoadFailed}</p> : null}
          <p className="today-foot">
            {load.status === "ready" && load.items.length === 0 ? `${TODO_TEXT.reviewsEmpty} ` : null}
            {load.status !== "failed" ? (
              <Link to="/consult" className="tap-link">
                {TODO_TEXT.reviewsLink}
              </Link>
            ) : null}
          </p>
        </>
      ) : (
        <p role="status">{TODAY_TEXT.loading}</p>
      )}
    </section>
  );
}
