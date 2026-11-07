// 死亡数の記録（設計書 §8）。鶏舎ごとの日別の死亡数を入れ、告示の 2 倍の計算を見せ、週の報告文を作る。
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
import { FarmGuide, useFarmRecord } from "./disinfectionLog";
import { CopyBox } from "./CopyBox";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

const LOOKBACK_DAYS = 120;
/** 窓がこの日数より長く広がったら、遡った日数を出す（索引 Q2） */
const LOOKBACK_NOTICE_SPAN = 30;

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

function ResultView({ shown, farm }: { shown: Shown; farm: FarmWithId }) {
  const { result } = shown;
  const contact = farm.kahoContact.trim();
  return (
    <section className="death-result" aria-label={RECORD_TEXT.resultHeading}>
      <h2>{RECORD_TEXT.resultHeading}</h2>
      <p>{safeJa(shown.date)}の記録で計算しました</p>
      {result.status === "insufficient" ? (
        <>
          <p role="status">{MORTALITY_TEXT.insufficient}</p>
          <p>{RECORD_TEXT.insufficientDays(result.validDays)}</p>
        </>
      ) : null}
      {result.status === "today_excluded" ? <p role="status">{RECORD_TEXT.todayExcluded(EXCLUSION_LABELS[result.kind])}</p> : null}
      {result.status === "no_record" ? <p role="alert">{RECORD_TEXT.noRecordToday}</p> : null}
      {result.status === "invalid_input" ? (
        <>
          <p role="alert">{MORTALITY_TEXT.invalidInput}</p>
          <p>
            {RECORD_TEXT.invalidDates}: {result.dates.map(safeJa).join("、")}
          </p>
        </>
      ) : null}
      {result.status === "evaluated" ? <Evaluated shown={shown} result={result} contact={contact} /> : null}
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
      <p role="status">{RECORD_TEXT.saved}</p>
      <ResultView shown={shown} farm={farm} />
    </div>
  );
}

function Evaluated({
  shown,
  result,
  contact,
}: {
  shown: Shown;
  result: Extract<MortalityResult, { status: "evaluated" }>;
  contact: string;
}) {
  const oldest = result.windowDates[result.windowDates.length - 1] ?? shown.date;
  const back = diffDays(shown.date, oldest);
  return (
    <>
      <p>{RECORD_TEXT.rateLine(pct(result.todayRate), pct(result.averageRate))}</p>
      {result.hit ? (
        <div className="death-hit" role="alert">
          <h3>{RECORD_TEXT.hitHeading}</h3>
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
          <p>{RECORD_TEXT.askKaho}</p>
        </div>
      ) : (
        <>
          <p>{RECORD_TEXT.notHit}</p>
          <p>{RECORD_TEXT.askKaho}</p>
        </>
      )}
      <p>{RECORD_TEXT.missingDays(result.skippedMissingDates.length)}</p>
      <p>{RECORD_TEXT.excludedDays(shown.excludedCount)}</p>
      {back + 1 > LOOKBACK_NOTICE_SPAN ? <p>{RECORD_TEXT.lookedBack(back)}</p> : null}
      <p>{MORTALITY_TEXT.definition}</p>
      <p>{MORTALITY_TEXT.exceptions}</p>
      <p>{MORTALITY_TEXT.reading}</p>
    </>
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
      <h2>{RECORD_TEXT.weeklyHeading}</h2>
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
    </section>
  );
}

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
  const [houseId, setHouseId] = useState("");
  const [date, setDate] = useState<string>(today);
  const [count, setCount] = useState("");
  const [reason, setReason] = useState<"" | ExclusionKind>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([store.listHouses(), store.listDeaths(from, today)]).then(
      ([hs, ds2]) => {
        if (off) return;
        setHouses(hs);
        setDeaths(ds2);
        setHouseId((cur) => cur || hs[0]?.id || "");
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
      <p>
        {RECORD_TEXT.noHousesYet} <Link to="/settings/farm#houses">{RECORD_TEXT.addHouseLink}</Link>
      </p>
    );
  }

  const house = houses.find((h) => h.id === houseId) ?? houses[0];
  if (!house) return null;
  const flockUnset = !house.empty && house.flockSize === 0;
  const clearShown = () => {
    setShown(null);
    setError(null);
  };

  async function save() {
    if (!house || busy) return;
    setError(null);
    setShown(null);
    const entered = date;
    if (!isRealDate(entered) || entered > today || entered < from) {
      setError(RECORD_TEXT.dateRange);
      return;
    }
    let n = 0;
    if (!house.empty) {
      if (count.trim() === "") {
        setError(RECORD_TEXT.deathsEmpty);
        return;
      }
      const parsed = parseCount(count);
      if (parsed === null) {
        setError(RECORD_TEXT.deathsNotNumber);
        return;
      }
      if (parsed > house.flockSize) {
        setError(RECORD_TEXT.deathsOverFlock(house.flockSize));
        return;
      }
      n = parsed;
    }
    const exclusion: DeathRecord["exclusion"] = house.empty
      ? { kind: "empty", note: "" }
      : reason === ""
        ? null
        : { kind: reason, note: "" };
    setBusy(true);
    try {
      await store.saveDeath({ date: entered, houseId: house.id, deaths: n, flockSizeAt: house.flockSize, exclusion });
    } catch {
      setError(RECORD_TEXT.saveFailed);
      setBusy(false);
      return;
    }
    noteSaved(); // 上の「最後の記録」を読み直させる（下の読み直しが失敗しても、保存はできている）
    try {
      const fresh = await store.listDeaths(from, today);
      setDeaths(fresh);
      setShown(compute(fresh, house.id, entered));
      setCount("");
      setReason("");
    } catch {
      setError(RECORD_TEXT.readFailed); // 保存はできている。計算に使う記録だけ読み込めなかった
    }
    setBusy(false);
  }

  const existing = house.empty ? undefined : deaths.find((d) => d.date === date && d.houseId === house.id);

  const recent = deaths
    .filter((d) => d.houseId === house.id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 10);

  return (
    <>
      <div className="record-form">
        <label htmlFor={`${id}-house`}>{RECORD_TEXT.houseLabel}</label>
        <select
          id={`${id}-house`}
          value={house.id}
          onChange={(e) => {
            setHouseId(e.target.value);
            setCount("");
            setReason("");
            clearShown();
          }}
        >
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-date`}>{RECORD_TEXT.dateLabel}</label>
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          min={from}
          max={today}
          onChange={(e) => {
            setDate(e.target.value);
            setReason("");
            clearShown();
          }}
        />
        {house.empty ? (
          <p role="status">{RECORD_TEXT.houseEmpty}</p>
        ) : (
          <>
            {existing ? <p role="status">{RECORD_TEXT.deathsExisting(existing.deaths)}</p> : null}
            <label htmlFor={`${id}-deaths`}>{RECORD_TEXT.deathsLabel}</label>
            <input
              id={`${id}-deaths`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={count}
              onChange={(e) => {
                setCount(e.target.value);
                clearShown();
              }}
            />
            <label htmlFor={`${id}-reason`}>{RECORD_TEXT.reasonLabel}</label>
            <select
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as "" | ExclusionKind);
                clearShown();
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
          </>
        )}
        {flockUnset ? <p role="alert">{RECORD_TEXT.flockZero}</p> : null}
        <p className="record-note">{RECORD_TEXT.deathsMailNote}</p>
        <p className="record-note">{RECORD_TEXT.hitAfterEdit}</p>
        <Button variant="primary" disabled={busy || flockUnset} onClick={() => void save()}>
          {busy ? RECORD_TEXT.saving : RECORD_TEXT.save}
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </div>

      {shown ? <ResultFrame shown={shown} farm={farm} /> : null}
      <p className="record-symptoms">{MORTALITY_TEXT.symptoms}</p>

      <section aria-label={RECORD_TEXT.recentHeading}>
        <h2>{RECORD_TEXT.recentHeading}</h2>
        {recent.length === 0 ? <p>{RECORD_TEXT.recentNone}</p> : null}
        <ul className="record-list">
          {recent.map((r) => (
            <li key={`${r.date}_${r.houseId}`}>
              {safeJa(r.date)}　{r.deaths} 羽（飼養 {r.flockSizeAt} 羽）{r.exclusion ? `　除外: ${EXCLUSION_LABELS[r.exclusion.kind] ?? r.exclusion.kind}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <WeeklyReport farm={farm} houses={houses} deaths={deaths} today={today} />
    </>
  );
}

export function DeathsPanel() {
  const farm = useFarmRecord();
  return (
    <section className="deaths-panel">
      <h1>{RECORD_TEXT.deathsTitle}</h1>
      <p>{RECORD_TEXT.deathsLead}</p>
      <FarmGuide farm={farm} />
      {farm.status === "loading" ? <p role="status">{RECORD_TEXT.loading}</p> : null}
      {farm.status === "ready" ? <DeathsBody farm={farm.farm} /> : null}
    </section>
  );
}

export default DeathsPanel;
