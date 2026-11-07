// 死亡数の記録（設計書 §8、2026-11-07 業務画面の作り直し）。上から: 題と 1 文 → 状態の札 → 次にすること →
// 鶏舎ごとの入力（1 鶏舎 1 行）→ 直近 14 日の表 → 週の報告文。
// 計算は shared の computeMortality だけ（Claude は使わない）。診断も、届け出の要否の断定もしない。
// RecordStore と DataSource だけを使う。会員かどうかの判断（RequireMember）は包む側。
import { addDays, diffDays, jstDateOf } from "@hpai/shared/dates";
import { formatJaDate } from "@hpai/shared/jaDate";
import { computeMortality, MORTALITY_TEXT, toMortalityDays, type MortalityResult } from "@hpai/shared/mortality";
import { buildWeeklyDeathReport, EXCLUSION_LABELS } from "@hpai/shared/reports";
import type { DeathRecord, ExclusionKind, Farm, House, IsoDate } from "@hpai/shared/types";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useDataSource, useRecordSaves, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { Fold } from "../../ui/Fold";
import { RowItem, RowList } from "../../ui/RowList";
import { StatRow, StatTile, type StatValue } from "../../ui/StatRow";
import { FarmGuide, useFarmRecord } from "./disinfectionLog";
import { CopyBox } from "./CopyBox";
import { byHouseName } from "./houseOrder";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

const LOOKBACK_DAYS = 120;
/** 窓がこの日数より長く広がったら、遡った日数を出す（索引 Q2） */
const LOOKBACK_NOTICE_SPAN = 30;
const TREND_DAYS = 14;
const WEEK_DAYS = 7;

type FarmWithId = Farm & { id: string };
type HouseWithId = House & { id: string };

/** 選べる除外の理由（空舎は鶏舎の「空舎」から決まる） */
const REASONS: ReadonlyArray<{ kind: ExclusionKind; label: string }> = [
  { kind: "equipment", label: "設備の故障" },
  { kind: "temperature", label: "急な気温変化" },
  { kind: "disaster", label: "災害" },
  { kind: "other", label: "その他" },
];

/** 全角の数字も受ける。文字、負の数、小数は null */
function parseCount(s: string): number | null {
  const t = s.normalize("NFKC").trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

function isRealDate(s: string): s is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  try {
    addDays(s, 0);
    return true;
  } catch {
    return false;
  }
}

function safeJa(d: string): string {
  try {
    return formatJaDate(d);
  } catch {
    return d;
  }
}

const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const exclusionLabel = (kind: string) => EXCLUSION_LABELS[kind as ExclusionKind] ?? kind;
/** 空舎の日（鶏舎の「空舎」で記録した日、または羽数 0 の記録） */
const isEmptyDay = (r: DeathRecord) => r.exclusion?.kind === "empty" || r.flockSizeAt === 0;

interface Shown {
  date: IsoDate;
  result: MortalityResult;
  /** evaluated のとき、窓の範囲で特段の事情か空舎として除いた日 */
  excludedCount: number;
}

function compute(records: readonly DeathRecord[], houseId: string, date: IsoDate): Shown {
  const own = records.filter((r) => r.houseId === houseId);
  const result = computeMortality(toMortalityDays(own), date);
  let excludedCount = 0;
  if (result.status === "evaluated") {
    const oldest = result.windowDates[result.windowDates.length - 1] ?? date;
    excludedCount = own.filter((r) => r.date >= oldest && r.date <= date && (r.exclusion !== null || r.flockSizeAt === 0)).length;
  }
  return { date, result, excludedCount };
}

/** shared の文（句点なし。shared は変えない）を 1 行にして、行末に句点を置く。文は span に入れ、試験と読み上げはそのまま引ける */
function Sentence({ text, role, className }: { text: string; role?: "status" | "alert"; className?: string }) {
  return (
    <p role={role} className={className}>
      <span>{text}</span>。
    </p>
  );
}

function ResultView({ shown, farm }: { shown: Shown; farm: FarmWithId }) {
  const { result } = shown;
  const contact = farm.kahoContact.trim();
  const evaluated = result.status === "evaluated" ? result : null;
  const back = evaluated ? diffDays(shown.date, evaluated.windowDates[evaluated.windowDates.length - 1] ?? shown.date) : 0;
  const dateLine = RECORD_TEXT.resultDate(safeJa(shown.date));
  return (
    <section className="death-result" aria-label={RECORD_TEXT.resultHeading}>
      <h3>{RECORD_TEXT.resultHeading}</h3>
      {result.status === "insufficient" ? (
        // 「11月8日の記録で計算しました。まだ計算できません（使える日は 1 日。21 日分そろうと計算します）。」を 1 行に
        <p role="status">
          {dateLine}
          <span>{MORTALITY_TEXT.insufficient}</span>
          {RECORD_TEXT.insufficientDays(result.validDays)}
        </p>
      ) : null}
      {result.status === "today_excluded" ? <p role="status">{RECORD_TEXT.todayExcluded(exclusionLabel(result.kind))}</p> : null}
      {result.status === "no_record" ? <p role="alert">{RECORD_TEXT.noRecordToday}</p> : null}
      {result.status === "invalid_input" ? (
        <>
          <Sentence role="alert" text={MORTALITY_TEXT.invalidInput} />
          <p>
            {RECORD_TEXT.invalidDates}: {result.dates.map(safeJa).join("、")}。
          </p>
        </>
      ) : null}
      {evaluated ? (
        <>
          <p>{dateLine}</p>
          <p className="death-rate">{RECORD_TEXT.rateLine(pct(evaluated.todayRate), pct(evaluated.averageRate))}</p>
          {evaluated.hit ? (
            <div className="death-hit" role="alert">
              <h4>{RECORD_TEXT.hitHeading}</h4>
              <p>{MORTALITY_TEXT.hit}</p>
              {contact !== "" ? (
                <p>
                  {RECORD_TEXT.hitContact}: {contact}
                </p>
              ) : (
                <p>
                  {RECORD_TEXT.contactMissing}。 <Link to="/settings/farm">{RECORD_TEXT.contactLink}</Link>
                </p>
              )}
              <p>{MORTALITY_TEXT.exceptions}</p>
            </div>
          ) : (
            <p>{RECORD_TEXT.notHit}</p>
          )}
        </>
      ) : null}
      <p>{RECORD_TEXT.askKaho}</p>
      <Fold summary={RECORD_TEXT.detailOpen} className="death-detail">
        {evaluated ? (
          <>
            <p>{RECORD_TEXT.missingDays(evaluated.skippedMissingDates.length)}</p>
            <p>{RECORD_TEXT.excludedDays(shown.excludedCount)}</p>
            {back + 1 > LOOKBACK_NOTICE_SPAN ? <p>{RECORD_TEXT.lookedBack(back)}</p> : null}
          </>
        ) : null}
        <Sentence text={MORTALITY_TEXT.definition} />
        <Sentence text={MORTALITY_TEXT.exceptions} />
        <Sentence text={MORTALITY_TEXT.reading} />
        <Sentence text={MORTALITY_TEXT.symptoms} />
      </Fold>
      <p className="record-note">{RECORD_TEXT.hitAfterEdit}</p>
    </section>
  );
}

/** 保存したら画面をこの枠へ動かし、フォーカスを移す。先頭に「記録しました」を出す */
function ResultFrame({ shown, farm }: { shown: Shown; farm: FarmWithId }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "start" });
    ref.current?.focus?.({ preventScroll: true });
  }, [shown]);
  return (
    <div ref={ref} tabIndex={-1} className="death-result-focus">
      <p role="status" className="death-saved">
        {RECORD_TEXT.saved}
      </p>
      <ResultView shown={shown} farm={farm} />
    </div>
  );
}

function intOrNull(s: string): { value: number | null; bad: boolean } {
  if (s.trim() === "") return { value: null, bad: false };
  const n = parseCount(s);
  return n === null ? { value: null, bad: true } : { value: n, bad: false };
}

function WeeklyReport({
  farm,
  houses,
  deaths,
  today,
}: {
  farm: FarmWithId;
  houses: HouseWithId[];
  deaths: DeathRecord[];
  today: IsoDate;
}) {
  const id = useId();
  // 畳んで出す（2026-11-07 精査 C。毎日の記録の下に長い欄を広げない）。値はこの部品が持つので、畳んでも残る
  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState<string>(addDays(today, -6));
  const [culled, setCulled] = useState("");
  const [introduced, setIntroduced] = useState("");
  const [healthNote, setHealthNote] = useState("");
  const [mortalityNote, setMortalityNote] = useState("");

  const culledN = intOrNull(culled);
  const introducedN = intOrNull(introduced);
  const startOk = isRealDate(weekStart);
  const text = startOk
    ? buildWeeklyDeathReport({
        farmName: farm.name,
        weekStart,
        houses,
        records: deaths,
        extras: { culledShipped: culledN.value, introduced: introducedN.value, healthNote, mortalityNote },
      })
    : "";

  return (
    <section className="weekly-report" aria-label={RECORD_TEXT.weeklyHeading}>
      <h3>{RECORD_TEXT.weeklyHeading}</h3>
      <Button aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)}>
        {RECORD_TEXT.weeklyOpen}
      </Button>
      {open ? (
        <div id={`${id}-body`} className="weekly-report-body">
          <p>{RECORD_TEXT.weeklyLead}</p>
          <div className="record-form">
            <label htmlFor={`${id}-start`}>{RECORD_TEXT.weeklyStart}</label>
            <input id={`${id}-start`} type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            <label htmlFor={`${id}-culled`}>{RECORD_TEXT.weeklyCulled}</label>
            <input id={`${id}-culled`} type="text" inputMode="numeric" value={culled} onChange={(e) => setCulled(e.target.value)} />
            {culledN.bad ? <p role="alert">{RECORD_TEXT.weeklyNumberBad}</p> : null}
            <label htmlFor={`${id}-intro`}>{RECORD_TEXT.weeklyIntroduced}</label>
            <input id={`${id}-intro`} type="text" inputMode="numeric" value={introduced} onChange={(e) => setIntroduced(e.target.value)} />
            {introducedN.bad ? <p role="alert">{RECORD_TEXT.weeklyNumberBad}</p> : null}
            <label htmlFor={`${id}-health`}>{RECORD_TEXT.weeklyHealth}</label>
            <textarea id={`${id}-health`} rows={2} value={healthNote} onChange={(e) => setHealthNote(e.target.value)} />
            <label htmlFor={`${id}-mort`}>{RECORD_TEXT.weeklyMortality}</label>
            <textarea id={`${id}-mort`} rows={2} value={mortalityNote} onChange={(e) => setMortalityNote(e.target.value)} />
          </div>
          <p className="record-note">{RECORD_TEXT.weeklyNotSaved}</p>
          {startOk ? <CopyBox label="週の報告文の下書き" value={text} /> : <p role="alert">{RECORD_TEXT.weeklyNumberBad}</p>}
        </div>
      ) : null}
    </section>
  );
}

/** 日付 × 鶏舎の表。未入力は「—」、空舎の日は「空舎」、特段の事情の日は数字の後に「※」 */
function DeathsTable({ label, houses, deaths, dates }: { label: string; houses: HouseWithId[]; deaths: DeathRecord[]; dates: IsoDate[] }) {
  const byKey = new Map(deaths.map((r) => [`${r.date}_${r.houseId}`, r]));
  return (
    <div className="record-table-wrap">
      <table className="record-table death-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{RECORD_TEXT.trendDate}</th>
            {houses.map((h) => (
              <th scope="col" key={h.id}>
                {h.name}
              </th>
            ))}
            <th scope="col">{RECORD_TEXT.trendTotal}</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => {
            const rows = houses.map((h) => byKey.get(`${date}_${h.id}`));
            const any = rows.some((r) => r !== undefined);
            const total = rows.reduce((sum, r) => sum + (r ? r.deaths : 0), 0);
            return (
              <tr key={date}>
                <th scope="row">{safeJa(date)}</th>
                {rows.map((r, i) => (
                  <td key={houses[i]?.id ?? i}>
                    {r === undefined
                      ? RECORD_TEXT.trendNone
                      : isEmptyDay(r)
                        ? RECORD_TEXT.trendEmpty
                        : `${r.deaths}${r.exclusion ? RECORD_TEXT.trendExcludedMark : ""}`}
                  </td>
                ))}
                <td>{any ? total : RECORD_TEXT.trendNone}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 札「届け出の基準」。優先の順: 達している可能性 → 鶏舎なし → 入力の誤り → 未入力 → 日数不足 → 全部が対象外 → 達していない。
 * active は羽数が 1 以上の飼育中の鶏舎（羽数 0 の鶏舎は入力できないので、未入力として数えない）。
 */
function judgeTile(active: HouseWithId[], deaths: DeathRecord[], today: IsoDate) {
  if (active.length === 0) return { value: RECORD_TEXT.judgeNoHouse, note: RECORD_TEXT.judgeNoHouseNote, alert: false };
  const results = active.map((h) => ({
    house: h,
    recorded: deaths.some((r) => r.date === today && r.houseId === h.id),
    result: compute(deaths, h.id, today).result,
  }));
  const hits = results.filter((x) => x.recorded && x.result.status === "evaluated" && x.result.hit);
  if (hits.length > 0) return { value: RECORD_TEXT.judgeHit, note: RECORD_TEXT.judgeHitNote(hits.map((x) => x.house.name).join("、")), alert: true };
  const invalid = results.filter((x) => x.recorded && x.result.status === "invalid_input");
  if (invalid.length > 0) {
    return { value: RECORD_TEXT.judgeInvalid, note: RECORD_TEXT.judgeInvalidNote(invalid.map((x) => x.house.name).join("、")), alert: false };
  }
  if (results.some((x) => !x.recorded)) return { value: RECORD_TEXT.judgeMissing, note: RECORD_TEXT.judgeMissingNote, alert: false };
  if (results.some((x) => x.result.status === "insufficient")) {
    return { value: RECORD_TEXT.judgeInsufficient, note: RECORD_TEXT.judgeInsufficientNote, alert: false };
  }
  if (results.every((x) => x.result.status === "today_excluded")) {
    return { value: RECORD_TEXT.judgeExcluded, note: RECORD_TEXT.judgeExcludedNote, alert: false };
  }
  // 一部の鶏舎だけが特段の事情（または空舎）の日なら、「今日の記録で計算しました」と言わず、除いた鶏舎の名前を出す
  const notes: string[] = [];
  for (const empty of [false, true]) {
    const names = results
      .filter((x) => x.result.status === "today_excluded" && (x.result.kind === "empty") === empty)
      .map((x) => x.house.name);
    if (names.length > 0) notes.push(RECORD_TEXT.judgeNotHitExcludedNote(names.join("・"), empty));
  }
  return { value: RECORD_TEXT.judgeNotHit, note: notes.length > 0 ? notes.join("。") : RECORD_TEXT.judgeNotHitNote, alert: false };
}

const ok = (value: string, unit?: string): StatValue => ({ status: "ok", value, unit });

function DeathsBody({ farm }: { farm: FarmWithId }) {
  const store = useRecordStore();
  const ds = useDataSource();
  const { saved: noteSaved } = useRecordSaves();
  const id = useId();
  const today = jstDateOf(ds.now());
  const from = addDays(today, -LOOKBACK_DAYS);

  const [houses, setHouses] = useState<HouseWithId[] | null>(null);
  const [deaths, setDeaths] = useState<DeathRecord[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [date, setDate] = useState<string>(today);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, "" | ExclusionKind>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ houseId: string; text: string } | null>(null);
  const [shown, setShown] = useState<{ houseId: string; shown: Shown } | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([store.listHouses(), store.listDeaths(from, today)]).then(
      ([hs, ds2]) => {
        if (off) return;
        // 保存の側は順を決めないので、名前の順に 1 回だけ並べる。記録しても読み直さないので、行の順は動かない
        setHouses(byHouseName(hs));
        setDeaths(ds2);
      },
      () => {
        if (!off) setLoadFailed(true);
      },
    );
    return () => {
      off = true;
    };
    // today と from は ds.now() から決まる。画面を開いている間は変えない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  if (loadFailed) return <p role="alert">{RECORD_TEXT.readFailed}</p>;
  if (houses === null) return <p role="status">{RECORD_TEXT.loading}</p>;
  if (houses.length === 0) {
    // 見本の農場（sample）は今までの文とリンクのまま。会員は農場の設定の鶏舎の欄（#houses）へ直に送る
    return store.mode === "sample" ? (
      <p>
        {RECORD_TEXT.noHouses}。 <Link to="/settings/farm">{RECORD_TEXT.setFarmLink}</Link>
      </p>
    ) : (
      <p className="death-next">
        {RECORD_TEXT.nextLabel}: {RECORD_TEXT.deathsNoHouses} <Link to="/settings/farm#houses">{RECORD_TEXT.addHouseLink}</Link>
      </p>
    );
  }

  /** 入力を直すと、その行の結果と誤りの表示を消す */
  const touch = (houseId: string) => {
    setShown((s) => (s?.houseId === houseId ? null : s));
    setError((e) => (e?.houseId === houseId ? null : e));
  };

  async function save(house: HouseWithId) {
    if (busy !== null) return;
    setError(null);
    setShown(null);
    const entered = date;
    const fail = (text: string) => setError({ houseId: house.id, text });
    if (!isRealDate(entered) || entered > today || entered < from) {
      fail(RECORD_TEXT.dateRange);
      return;
    }
    let n = 0;
    const count = counts[house.id] ?? "";
    if (!house.empty) {
      if (count.trim() === "") {
        fail(RECORD_TEXT.deathsEmpty);
        return;
      }
      const parsed = parseCount(count);
      if (parsed === null) {
        fail(RECORD_TEXT.deathsNotNumber);
        return;
      }
      if (parsed > house.flockSize) {
        fail(RECORD_TEXT.deathsOverFlock(house.flockSize));
        return;
      }
      n = parsed;
    }
    const reason = reasons[house.id] ?? "";
    const exclusion: DeathRecord["exclusion"] = house.empty
      ? { kind: "empty", note: "" }
      : reason === ""
        ? null
        : { kind: reason, note: "" };
    setBusy(house.id);
    try {
      await store.saveDeath({ date: entered, houseId: house.id, deaths: n, flockSizeAt: house.flockSize, exclusion });
    } catch {
      fail(RECORD_TEXT.saveFailed);
      setBusy(null);
      return;
    }
    noteSaved(); // 上の「最後に記録した日」を読み直させる（下の読み直しが失敗しても、保存はできている）
    try {
      const fresh = await store.listDeaths(from, today);
      setDeaths(fresh);
      setShown({ houseId: house.id, shown: compute(fresh, house.id, entered) });
      setCounts((c) => ({ ...c, [house.id]: "" }));
      setReasons((r) => ({ ...r, [house.id]: "" }));
    } catch {
      fail(RECORD_TEXT.readFailed); // 保存はできている。計算に使う記録だけ読み込めなかった
    }
    setBusy(null);
  }

  // 札と次にすることは「今日」の分で数える（記録する日を変えても、札は今日のまま）。
  // 数える鶏舎は、羽数が 1 以上の飼育中の鶏舎（recordable）。羽数 0 の鶏舎は行で入力を止めているので、札でも未入力と数えない
  const active = houses.filter((h) => !h.empty);
  const recordable = active.filter((h) => h.flockSize > 0);
  const flockZeroCount = active.length - recordable.length;
  const todayOf = (houseId: string) => deaths.find((r) => r.date === today && r.houseId === houseId);
  const enteredToday = recordable.filter((h) => todayOf(h.id) !== undefined);
  const missingRecordable = recordable.filter((h) => todayOf(h.id) === undefined);
  const todaySum = enteredToday.reduce((sum, h) => sum + (todayOf(h.id)?.deaths ?? 0), 0);
  const weekFrom = addDays(today, -(WEEK_DAYS - 1));
  const weekRecords = deaths.filter((r) => r.date >= weekFrom && r.date <= today);
  const weekSum = weekRecords.reduce((sum, r) => sum + r.deaths, 0);
  const weekDays = new Set(weekRecords.map((r) => r.date)).size;
  const judge = judgeTile(recordable, deaths, today);

  const next =
    active.length === 0
      ? RECORD_TEXT.nextNoActive
      : missingRecordable.length > 0
        ? RECORD_TEXT.nextMissing(missingRecordable.map((h) => h.name).join("・"))
        : flockZeroCount > 0
            ? RECORD_TEXT.nextFlockZero
            : RECORD_TEXT.nextDone;

  const trendDates = Array.from({ length: TREND_DAYS }, (_, k) => addDays(today, -k));
  const allDates = [...new Set(deaths.map((r) => r.date))].sort().reverse();
  const anyExcluded = deaths.some((r) => trendDates.includes(r.date) && r.exclusion !== null && !isEmptyDay(r));
  const anyRecent = deaths.some((r) => trendDates.includes(r.date));

  const dateOk = isRealDate(date);
  const recordOf = (houseId: string) => (dateOk ? deaths.find((r) => r.date === date && r.houseId === houseId) : undefined);

  return (
    <>
      <StatRow label={RECORD_TEXT.statsLabel}>
        <StatTile
          label={RECORD_TEXT.statToday}
          value={ok(`${enteredToday.length} / ${recordable.length}`, "鶏舎")}
          note={flockZeroCount > 0 ? RECORD_TEXT.statTodayFlockZero(flockZeroCount) : RECORD_TEXT.statTodayNote}
        />
        <StatTile
          label={RECORD_TEXT.statTodayDeaths}
          value={recordable.length === 0 ? ok(RECORD_TEXT.statNoTarget) : enteredToday.length === 0 ? ok(RECORD_TEXT.statNotEntered) : ok(String(todaySum), "羽")}
          note={enteredToday.length > 0 && missingRecordable.length > 0 ? RECORD_TEXT.statMissing(missingRecordable.length) : undefined}
        />
        <StatTile
          label={RECORD_TEXT.statWeek}
          value={weekDays === 0 ? ok(RECORD_TEXT.statWeekNone) : ok(String(weekSum), "羽")}
          note={weekDays === 0 ? RECORD_TEXT.statWeekNote(safeJa(weekFrom)) : RECORD_TEXT.statWeekNoteDays(safeJa(weekFrom), weekDays)}
        />
        <StatTile label={RECORD_TEXT.statJudge} value={ok(judge.value)} note={judge.note} tone={judge.alert ? "alert" : "normal"} />
      </StatRow>

      <p className="death-next">
        {RECORD_TEXT.nextLabel}: {next}
      </p>

      <div className="death-date">
        <label htmlFor={`${id}-date`}>{RECORD_TEXT.dateLabel}</label>
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          min={from}
          max={today}
          onChange={(e) => {
            // 日を変えたら、各行をその日の記録で読み直す（入れかけの数と理由は空にする）
            setDate(e.target.value);
            setCounts({});
            setReasons({});
            setShown(null);
            setError(null);
          }}
        />
      </div>
      <p className="record-note">{RECORD_TEXT.deathsMailNote}</p>

      <RowList label={RECORD_TEXT.rowsLabel}>
        {houses.map((h) => {
          const rec = recordOf(h.id);
          const rowError = error?.houseId === h.id ? <p role="alert">{error.text}</p> : null;
          const rowResult = shown?.houseId === h.id ? <ResultFrame shown={shown.shown} farm={farm} /> : null;
          const saving = busy === h.id;
          if (h.empty) {
            // 空舎の日の記録があれば記録済み。空舎にする前の死亡数の記録なら、その数と「記録し直す」（押すと空舎の日に置き換わる）
            const emptyDone = rec !== undefined && isEmptyDay(rec);
            return (
              <RowItem
                key={h.id}
                mark="off"
                markLabel={RECORD_TEXT.emptyMark}
                title={h.name}
                sub={emptyDone ? RECORD_TEXT.houseEmptyRecorded : rec ? RECORD_TEXT.deathsRecorded(rec.deaths) : RECORD_TEXT.houseEmpty}
                act={
                  emptyDone ? undefined : (
                    <Button
                      variant={rec ? "secondary" : "primary"}
                      disabled={busy !== null}
                      onClick={() => void save(h)}
                      aria-label={rec ? RECORD_TEXT.resaveFor(h.name) : RECORD_TEXT.saveFor(h.name)}
                    >
                      {saving ? RECORD_TEXT.saving : rec ? RECORD_TEXT.resave : RECORD_TEXT.save}
                    </Button>
                  )
                }
                more={rowError || rowResult ? <>{rowError}{rowResult}</> : undefined}
              />
            );
          }
          const flockUnset = h.flockSize === 0;
          const inputId = `${id}-${h.id}-count`;
          const reason = reasons[h.id] ?? "";
          return (
            <RowItem
              key={h.id}
              mark={rec ? "done" : "todo"}
              title={h.name}
              sub={
                flockUnset ? (
                  <span role="alert">{RECORD_TEXT.flockZero}</span>
                ) : rec ? (
                  <span role="status">
                    {rec.exclusion && !isEmptyDay(rec)
                      ? RECORD_TEXT.deathsRecordedExcluded(rec.deaths, exclusionLabel(rec.exclusion.kind))
                      : RECORD_TEXT.deathsRecorded(rec.deaths)}
                  </span>
                ) : (
                  RECORD_TEXT.flock(h.flockSize)
                )
              }
              act={
                <>
                  <span className="death-field">
                    <label htmlFor={inputId}>{RECORD_TEXT.deathsLabel}</label>
                    <input
                      id={inputId}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={RECORD_TEXT.deathsInputLabel(h.name)}
                      disabled={flockUnset}
                      value={counts[h.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCounts((c) => ({ ...c, [h.id]: v }));
                        touch(h.id);
                      }}
                    />
                    <span>{RECORD_TEXT.deathsUnit}</span>
                  </span>
                  <Button
                    // 主のボタンは未記録の「記録する」だけ。「記録し直す」は secondary
                    variant={rec ? "secondary" : "primary"}
                    disabled={busy !== null || flockUnset}
                    onClick={() => void save(h)}
                    aria-label={rec ? RECORD_TEXT.resaveFor(h.name) : RECORD_TEXT.saveFor(h.name)}
                  >
                    {saving ? RECORD_TEXT.saving : rec ? RECORD_TEXT.resave : RECORD_TEXT.save}
                  </Button>
                </>
              }
              more={
                <>
                  {flockUnset ? null : (
                    <details className="death-reason">
                      {/* 開閉の印（▸ ▾）は record.css の summary::before で出す */}
                      <summary>{reason === "" ? RECORD_TEXT.reasonOpen : RECORD_TEXT.reasonChosen(exclusionLabel(reason))}</summary>
                      <label htmlFor={`${inputId}-reason`}>{RECORD_TEXT.reasonLabel}</label>
                      <select
                        id={`${inputId}-reason`}
                        aria-label={RECORD_TEXT.reasonInputLabel(h.name)}
                        value={reason}
                        onChange={(e) => {
                          const v = e.target.value as "" | ExclusionKind;
                          setReasons((r) => ({ ...r, [h.id]: v }));
                          touch(h.id);
                        }}
                      >
                        <option value="">{RECORD_TEXT.reasonNone}</option>
                        {REASONS.map((r) => (
                          <option key={r.kind} value={r.kind}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <p className="record-note">{RECORD_TEXT.reasonHelp}</p>
                    </details>
                  )}
                  {rowError}
                  {rowResult}
                </>
              }
            />
          );
        })}
      </RowList>

      <section className="death-trend" aria-label={RECORD_TEXT.trendHeading}>
        <h3>{RECORD_TEXT.trendHeading}</h3>
        {anyRecent ? (
          <DeathsTable label={RECORD_TEXT.trendHeading} houses={houses} deaths={deaths} dates={trendDates} />
        ) : (
          <p>{RECORD_TEXT.recentEmpty}</p>
        )}
        {anyExcluded ? <p className="record-note">{RECORD_TEXT.trendExcludedNote}</p> : null}
        {/* 120 日分は、記録があるときだけ畳んで出す */}
        {allDates.length > 0 ? (
          <Fold summary={RECORD_TEXT.trendAll}>
            <DeathsTable label={RECORD_TEXT.trendAll} houses={houses} deaths={deaths} dates={allDates} />
          </Fold>
        ) : null}
      </section>

      <WeeklyReport farm={farm} houses={houses} deaths={deaths} today={today} />
    </>
  );
}

export function DeathsPanel() {
  const farm = useFarmRecord();
  return (
    <section className="deaths-panel">
      <h2>{RECORD_TEXT.deathsTitle}</h2>
      <p>{RECORD_TEXT.deathsLead}</p>
      <FarmGuide farm={farm} />
      {farm.status === "loading" ? <p role="status">{RECORD_TEXT.loading}</p> : null}
      {farm.status === "ready" ? <DeathsBody farm={farm.farm} /> : null}
    </section>
  );
}

export default DeathsPanel;
