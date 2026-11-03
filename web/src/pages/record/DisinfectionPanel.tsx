// 消毒の記録（設計書 §8）。確認リストのうち、消毒の「やった」を日付と項目で残す。
// 経路に依存しない（M-04 の /record/disinfection と X-08 の /sample/record/disinfection が包む）。
// 使うのは RecordStore と DataSource と地点だけ。会員かどうかの判断（RequireMember）は包む側が行う。
import { buildChecklist, CHECKLIST_ITEMS } from "@hpai/shared/checklist";
import { formatJaDate } from "@hpai/shared/jaDate";
import { ClassBlock } from "../../ui/ClassBlock";
import { levelOf, useTodoData } from "../todo/useTodoData";
import { TODO_TEXT } from "../todo/texts";
import { DoneButton, FarmGuide, useDisinfectionLog, useFarmRecord } from "./disinfectionLog";

const TEXT_OF = new Map(CHECKLIST_ITEMS.map((i) => [i.id, i.text]));

export function DisinfectionPanel() {
  const farm = useFarmRecord();
  const todo = useTodoData();
  const log = useDisinfectionLog(farm.status === "ready");

  const farmInfo = farm.status === "ready" ? farm.farm : null;
  const sections = buildChecklist({
    level: levelOf(todo.state),
    production: farmInfo?.production ?? null,
    housing: farmInfo?.housing ?? null,
  })
    .map((s) => ({ ...s, items: s.items.filter((i) => i.disinfectionLoggable) }))
    .filter((s) => s.items.length > 0);

  return (
    <section className="disinfection-panel">
      <h1>{TODO_TEXT.panelTitle}</h1>
      <p>{TODO_TEXT.panelLead}</p>
      <FarmGuide farm={farm} />
      {todo.state.status === "loading" ? <p role="status">{TODO_TEXT.loading}</p> : null}
      {todo.state.status === "failed" ? <p role="alert">{TODO_TEXT.panelLevelFailed}</p> : null}
      {todo.state.status !== "loading"
        ? sections.map((s) => (
            <ClassBlock key={s.class} cls={s.class} heading={s.heading}>
              <ul className="todo-items">
                {s.items.map((i) => (
                  <li key={i.id}>
                    <p>{i.text}</p>
                    {farm.status === "ready" ? <DoneButton itemId={i.id} label={i.text} log={log} /> : null}
                  </li>
                ))}
              </ul>
            </ClassBlock>
          ))
        : null}
      {farm.status === "ready" ? (
        <section aria-label={TODO_TEXT.panelRecent}>
          <h2>{TODO_TEXT.panelRecent}</h2>
          {log.recentFailed ? <p role="alert">{TODO_TEXT.panelListFailed}</p> : null}
          {log.recent.length === 0 && !log.recentFailed ? <p>{TODO_TEXT.panelNone}</p> : null}
          <ul className="todo-items">
            {log.recent.map((r) => (
              <li key={r.key}>
                {formatJaDate(r.date)}　{TEXT_OF.get(r.itemId) ?? r.itemId}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

export default DisinfectionPanel;
