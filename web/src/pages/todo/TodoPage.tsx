// やること（設計書 §7）。ふだんは短い確認を数行だけ出し、「くわしく」で確認リストを開く。
// リマインドにとどめる。義務（いつも、区域に入っていれば）と、見直しの推奨（確かめておくとよいこと）は見た目も言葉も分ける。
// 会員でなくても開ける（RequireMember で包まない）。記録（やった）は農場が読めているときだけ。
import { ZONE_AUTHORITY_NOTE, buildChecklist, shortReminder, type ChecklistItem } from "@hpai/shared/checklist";
import { useState } from "react";
import { Link } from "react-router";
import { SURVEILLANCE_NOTE } from "../map/texts";
import { AsOf } from "../../ui/AsOf";
import { Button } from "../../ui/Button";
import { ClassBlock } from "../../ui/ClassBlock";
import { SourceLine } from "../../ui/SourceLine";
import { DoneButton, FarmGuide, useDisinfectionLog, useFarmRecord } from "../record/disinfectionLog";
import { LiftEstimateBlock } from "./LiftEstimateBlock";
import { TODO_TEXT } from "./texts";
import { levelOf, useTodoData } from "./useTodoData";
import "./todo.css";

function ItemRow({ item, log }: { item: ChecklistItem; log: ReturnType<typeof useDisinfectionLog> | null }) {
  return (
    <li>
      <p>{item.text}</p>
      <SourceLine title={item.source.title} url={item.source.url} />
      {item.source.note ? <p className="todo-note">{item.source.note}</p> : null}
      {item.disinfectionLoggable && log ? <DoneButton itemId={item.id} label={item.text} log={log} /> : null}
    </li>
  );
}

export default function TodoPage() {
  const data = useTodoData();
  const farm = useFarmRecord();
  const log = useDisinfectionLog(farm.status === "ready");
  const { state } = data;
  const level = levelOf(state);
  const [openedByUser, setOpened] = useState<boolean | null>(null);
  // 区域に入っている可能性があるとき（段階①）は、求められることを最初から開く。ふだんは短い確認だけ
  const open = openedByUser ?? level === 1;

  const farmInfo = farm.status === "ready" ? farm.farm : null;
  const sections = buildChecklist({ level, production: farmInfo?.production ?? null, housing: farmInfo?.housing ?? null });
  const lifts = state.status === "ready" ? state.result.lifts : [];
  const lines = state.status === "ready" || state.status === "no_spot" ? shortReminder(level) : [];

  return (
    <div className="todo-page">
      <h1>{TODO_TEXT.title}</h1>
      <AsOf iso={data.asOf} />

      {state.status === "loading" ? <p role="status">{TODO_TEXT.loading}</p> : null}
      {state.status === "failed" ? <p role="alert">{TODO_TEXT.loadFailed}</p> : null}
      {state.status === "no_spot" ? (
        <p>
          {TODO_TEXT.noSpot}。 <Link to="/">{TODO_TEXT.pickTown}</Link>
        </p>
      ) : null}
      {data.prefUnconfirmed && state.status !== "failed" ? <p role="status">{TODO_TEXT.prefUnconfirmed}</p> : null}

      {lines.length > 0 ? (
        <ul className="todo-reminder" aria-label="短い確認">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}

      {level === 1 && state.status === "ready" ? (
        <section className="lift-region" role="region" aria-label={TODO_TEXT.liftHeading}>
          <h2>{TODO_TEXT.liftHeading}</h2>
          {lifts.map((l) => (
            <LiftEstimateBlock key={l.caseId} muniName={l.muniName} estimate={l.estimate} />
          ))}
          {state.result.level.inSurveillanceNote ? <p>{SURVEILLANCE_NOTE}</p> : null}
        </section>
      ) : null}

      {state.status !== "loading" && state.status !== "failed" ? (
        <>
          <p>
            <Link to="../record/self-check" relative="path">
              {TODO_TEXT.selfCheckLink}
            </Link>
          </p>
          <Button aria-expanded={open} onClick={() => setOpened(!open)}>
            {open ? TODO_TEXT.less : TODO_TEXT.more}
          </Button>
          {open ? (
            <div className="todo-details">
              <FarmGuide farm={farm} />
              {sections.map((s) => (
                <ClassBlock key={s.class} cls={s.class} heading={s.heading}>
                  {s.class === "if_in_zone" ? <p>{ZONE_AUTHORITY_NOTE}</p> : null}
                  <ul className="todo-items">
                    {s.items.map((item) => (
                      <ItemRow key={item.id} item={item} log={farm.status === "ready" ? log : null} />
                    ))}
                  </ul>
                </ClassBlock>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
