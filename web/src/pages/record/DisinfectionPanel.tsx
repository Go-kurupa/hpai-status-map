// 消毒・対策の記録（設計書 §8。2026-11-07 業務画面の作り直し）。今日の項目は消毒の 6 項目の「やった」。表には確認リストで記録したほかの項目も短い名前で出す（2026-11-08）。
// 上から: 題と 1 文 → 状態の札 → 次にすること → 今日の項目（1 行 1 項目）→ 直近 14 日の表。
// 経路に依存しない（M-04 の /record/disinfection と X-08 の /sample/record/disinfection が包む）。
// 使うのは RecordStore と DataSource と地点だけ。会員かどうかの判断（RequireMember）は包む側が行う。
// 「やった」の部品（DoneButton、useDisinfectionLog）は対策項目の今日のやることと共有する。中身は変えない。
import { buildChecklist, CHECKLIST_ITEMS } from "@hpai/shared/checklist";
import { addDays, jstDateOf } from "@hpai/shared/dates";
import { formatJaDate } from "@hpai/shared/jaDate";
import { DISINFECTION_LABELS } from "@hpai/shared/reports";
import { useDataSource } from "../../data/context";
import { ClassBlock } from "../../ui/ClassBlock";
import { RowItem, RowList } from "../../ui/RowList";
import { StatRow, StatTile, type StatValue } from "../../ui/StatRow";
import { levelOf, useTodoData } from "../todo/useTodoData";
import { TODO_TEXT } from "../todo/texts";
import { DoneButton, FarmGuide, RECENT_DAYS, useDisinfectionLog, useFarmRecord } from "./disinfectionLog";
import { RECORD_TEXT } from "./recordTexts";
import "./record.css";

const TEXT_OF = new Map(CHECKLIST_ITEMS.map((i) => [i.id, i.text]));

/** 項目の短い名前（表の列と行の見出し）。なければ確認リストの文、それもなければ id */
function shortName(id: string): string {
  return DISINFECTION_LABELS[id] ?? TEXT_OF.get(id) ?? id;
}

function isWebUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

export function DisinfectionPanel() {
  const farm = useFarmRecord();
  const todo = useTodoData();
  const ds = useDataSource();
  const log = useDisinfectionLog(farm.status === "ready");
  const today = jstDateOf(ds.now());

  const farmInfo = farm.status === "ready" ? farm.farm : null;
  const sections = buildChecklist({
    level: levelOf(todo.state),
    production: farmInfo?.production ?? null,
    housing: farmInfo?.housing ?? null,
  })
    .map((s) => ({ ...s, items: s.items.filter((i) => i.disinfectionLoggable) }))
    .filter((s) => s.items.length > 0);
  const shown = sections.flatMap((s) => s.items.map((i) => i.id));
  const listReady = todo.state.status !== "loading";
  const ready = farm.status === "ready";

  // 札: 今出ている項目のうち今日記録した数と、直近 14 日の件数。読み終えるまで 0 と言わない
  const doneCount = shown.filter((id) => log.doneToday.has(id)).length;
  const left = shown.length - doneCount;
  const todayValue: StatValue = log.recentFailed
    ? { status: "failed" }
    : !log.recentReady || !listReady
      ? { status: "loading" }
      : { status: "ok", value: `${doneCount} / ${shown.length}`, unit: "項目" };
  const recentValue: StatValue = log.recentFailed
    ? { status: "failed" }
    : !log.recentReady
      ? { status: "loading" }
      : { status: "ok", value: String(log.recent.length), unit: "件" };

  // 表: 列は今出ている項目と、直近の記録にある項目（段階が下がって出なくなった区域の項目も消さない）
  const columns = [...shown, ...[...new Set(log.recent.map((r) => r.itemId))].filter((id) => !shown.includes(id))];
  const days = Array.from({ length: RECENT_DAYS }, (_, k) => addDays(today, -k));
  const doneOn = new Set(log.recent.map((r) => `${r.date}|${r.itemId}`));

  return (
    <section className="disinfection-panel">
      <h2>{RECORD_TEXT.disTitle}</h2>
      <p>{RECORD_TEXT.disLead}</p>
      <FarmGuide farm={farm} />
      {ready ? (
        <>
          <StatRow label={RECORD_TEXT.disStatsLabel}>
            <StatTile label={RECORD_TEXT.disTodayTile} value={todayValue} />
            <StatTile label={RECORD_TEXT.disRecentTile} value={recentValue} />
          </StatRow>
          {log.recentReady && listReady ? (
            <p className="record-next">{`次にすること: ${left > 0 ? RECORD_TEXT.disNext(left) : RECORD_TEXT.disNextDone}`}</p>
          ) : null}
          <p className="record-note">{RECORD_TEXT.disNote}</p>
        </>
      ) : null}
      {todo.state.status === "loading" ? <p role="status">{TODO_TEXT.loading}</p> : null}
      {todo.state.status === "failed" ? <p role="alert">{TODO_TEXT.panelLevelFailed}</p> : null}
      {listReady
        ? sections.map((s) => (
            <ClassBlock key={s.class} cls={s.class} heading={s.heading}>
              <RowList label={RECORD_TEXT.disItemsLabel(s.heading)}>
                {s.items.map((i) => {
                  const done = log.doneToday.has(i.id);
                  const name = shortName(i.id);
                  return (
                    <RowItem
                      key={i.id}
                      mark={done ? "done" : "todo"}
                      title={name}
                      sub={
                        <>
                          {name === i.text ? null : <>{i.text} </>}
                          {isWebUrl(i.source.url) ? (
                            <a href={i.source.url} target="_blank" rel="noopener noreferrer" aria-label={RECORD_TEXT.disSourceLabel(i.source.title, name)}>
                              {RECORD_TEXT.disSource}
                            </a>
                          ) : null}
                        </>
                      }
                      act={
                        !ready ? null : done ? (
                          <span className="dis-done">{RECORD_TEXT.disDoneToday}</span>
                        ) : (
                          // 読み上げの名前は対策項目と同じ長い文（「やった: 衛生管理区域に入る車両を…」）
                          <DoneButton itemId={i.id} label={i.text} log={log} />
                        )
                      }
                    />
                  );
                })}
              </RowList>
            </ClassBlock>
          ))
        : null}
      {ready ? (
        <section aria-label={RECORD_TEXT.disTableHeading}>
          <h3>{RECORD_TEXT.disTableHeading}</h3>
          {log.recentFailed ? <p role="alert">{RECORD_TEXT.disTableFailed}</p> : null}
          {!log.recentReady && !log.recentFailed ? <p role="status">{RECORD_TEXT.loading}</p> : null}
          {/* 直近 14 日に記録が 1 件もなければ、空の表を出さず 1 行で言う */}
          {log.recentReady && log.recent.length === 0 ? <p>{RECORD_TEXT.recentEmpty}</p> : null}
          {log.recentReady && log.recent.length > 0 && columns.length > 0 ? (
            <div className="record-table-wrap">
              <table className="record-table dis-table">
                <thead>
                  <tr>
                    <th scope="col">{RECORD_TEXT.disTableDate}</th>
                    {columns.map((id) => (
                      <th key={id} scope="col">
                        {shortName(id)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d}>
                      <th scope="row">{formatJaDate(d)}</th>
                      {columns.map((id) => (
                        <td key={id}>
                          {doneOn.has(`${d}|${id}`) ? (
                            <span role="img" aria-label={RECORD_TEXT.disTableDone}>
                              ☑
                            </span>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

export default DisinfectionPanel;
