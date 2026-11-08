// やること（設計書 §7）。ふだんは短い確認を数行だけ出し、「確認リストを開く（N 項目）」で確認リストを開く。
// リマインドにとどめる。義務（いつも、区域に入っていれば）と、見直しの推奨（確かめておくとよいこと）は見た目も言葉も分ける。
// 会員でなくても開ける（RequireMember で包まない）。記録（やった）は農場が読めているときだけ。
// 会員で農場があるときは「今日のやること」の 1 本のリスト（MemberTodo、2026-11-07 A）。見本の農場と会員でない人は今のまま（PlainTodo）。
// 時点の行は、どの形でも「発表の確認: …」と主語を付ける（2026-11-07 B）。
// 段階 1 だけ、題の行の下に目次を出す（見出しのある節が 4 つ以上のとき。2026-11-08 レビュー 1 周目）。
import { ZONE_AUTHORITY_NOTE, buildChecklist, shortReminder, type ChecklistItem, type ChecklistSection, type ChecklistSource } from "@hpai/shared/checklist";
import { STANDARD_NUMBER_NOTE } from "@hpai/shared/checklist/items";
import type { Farm } from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import { useState } from "react";
import { Link } from "react-router";
import { useRecordStore } from "../../data/context";
import { SURVEILLANCE_NOTE } from "../map/texts";
import { AsOf } from "../../ui/AsOf";
import { Button } from "../../ui/Button";
import { ClassBlock } from "../../ui/ClassBlock";
import { isWebUrl, SourceLine } from "../../ui/SourceLine";
import { TextItem } from "../../ui/RiskLine";
import { DoneButton, FarmGuide, useDisinfectionLog, useFarmRecord, type FarmState } from "../record/disinfectionLog";
import { LiftEstimateBlock } from "./LiftEstimateBlock";
import { useReviewItems } from "./reviewItems";
import { TODAY_TEXT, TODO_TEXT, WORKER_MESSAGE_TEXT } from "./texts";
import { TodayList } from "./TodayList";
import { TodoToc, type TocEntry } from "./TodoToc";
import { levelOf, useTodoData, type TodoData } from "./useTodoData";
import { WorkerMessagePanel } from "./WorkerMessagePanel";
import "./todo.css";

const ZONE_FIRST = ["if_in_zone", "always", "good_to_check"] as const;

/** 段階 1 だけ、区域に入っていれば求められることを先に出す。shared の順は変えず、画面の側で並べ替える */
export function orderSections<T extends { class: string }>(level: number, sections: T[]): T[] {
  if (level !== 1) return sections;
  const rank = (c: string) => {
    const i = (ZONE_FIRST as readonly string[]).indexOf(c);
    return i < 0 ? ZONE_FIRST.length : i;
  };
  return [...sections].sort((a, b) => rank(a.class) - rank(b.class));
}

const hasNumberNote = (item: ChecklistItem) => item.source.note?.includes(STANDARD_NUMBER_NOTE) ?? false;

const itemNote = (item: ChecklistItem) => item.source.note?.replace(STANDARD_NUMBER_NOTE, "").trim() ?? "";

/** 項目の条文の位置（「項目 17」「第 9 の 1(5)、留意事項 48」）。末尾の「。」は落とす */
const itemPosition = (item: ChecklistItem) => itemNote(item).replace(/。$/u, "");

/**
 * 枠の中の項目がすべて同じ出典（題名と URL が同じ）で、どの項目にも位置があれば、その出典を返す。
 * そのときは出典を枠の見出しの直下に 1 回だけ出し、各項目には位置だけを同じ URL のリンクで残す（2026-11-08 直し 2）。
 * 出典が混ざる枠と、位置のない項目がある枠は null（今のまま各項目に出典を出す）
 */
export function sharedSource(items: ChecklistItem[]): ChecklistSource | null {
  const first = items[0];
  if (!first) return null;
  const same = items.every((i) => i.source.title === first.source.title && i.source.url === first.source.url && itemPosition(i) !== "");
  return same ? first.source : null;
}

/** 出典をまとめた枠の、項目の位置。何の位置かが分かるよう灰色の「出典の」を前に置き、位置の部分だけを出典と同じ URL のリンクにする */
function PositionLine({ item }: { item: ChecklistItem }) {
  const pos = itemPosition(item);
  return (
    <p className="todo-note todo-pos">
      {TODO_TEXT.sourcePositionLead}
      {isWebUrl(item.source.url) ? (
        <a href={item.source.url} target="_blank" rel="noopener noreferrer" aria-label={TODO_TEXT.sourcePositionLabel(item.source.title, pos)}>
          {pos}
        </a>
      ) : (
        pos
      )}
    </p>
  );
}

type Log = ReturnType<typeof useDisinfectionLog>;

/**
 * 確認リストの 1 項目。log が null なら「やった」を出さない（会員の画面では、記録は今日のやることの行で押す）。
 * grouped（枠で出典をまとめた）なら、出典の名前は出さず位置のリンクだけ
 */
function ItemRow({ item, log, grouped }: { item: ChecklistItem; log: Log | null; grouped: boolean }) {
  return (
    <li>
      <p>{item.text}</p>
      {grouped ? (
        <PositionLine item={item} />
      ) : (
        <>
          <SourceLine title={item.source.title} url={item.source.url} />
          {itemNote(item) ? <p className="todo-note">{itemNote(item)}</p> : null}
        </>
      )}
      {item.disinfectionLoggable && log ? <DoneButton itemId={item.id} label={item.text} log={log} /> : null}
    </li>
  );
}

/** 確認リストの枠の飛び先の id（目次が使う） */
const blockId = (cls: string) => `todo-${cls}`;

/**
 * 確認リストの枠（3 分類）。番号の注意は枠ごとに 1 回、区域の枠には県の連絡の注を添える。全項目が同じ出典なら、出典は見出しの直下に 1 回。
 * level は枠の見出しの段（「確認リスト」の h2 の中なら 3）
 */
function ChecklistBlocks({ sections, log, level = 2 }: { sections: ChecklistSection[]; log: Log | null; level?: 2 | 3 }) {
  return (
    <>
      {sections.map((s) => {
        const shared = sharedSource(s.items);
        return (
          <ClassBlock key={s.class} cls={s.class} heading={s.heading} id={blockId(s.class)} level={level}>
            {shared ? <SourceLine title={shared.title} url={shared.url} /> : null}
            {s.items.some(hasNumberNote) ? <p className="todo-note">{STANDARD_NUMBER_NOTE}</p> : null}
            {s.class === "if_in_zone" ? <p>{ZONE_AUTHORITY_NOTE}</p> : null}
            <ul className="todo-items">
              {s.items.map((item) => (
                <ItemRow key={item.id} item={item} log={log} grouped={shared !== null} />
              ))}
            </ul>
          </ClassBlock>
        );
      })}
    </>
  );
}

/** 目次の札の名前。確かめておくとよいことの見出しの括弧（義務ではありません…）は、札では省く */
const tocName = (heading: string) => heading.split("（")[0]!;

/** 確認リストの枠の札（項目数を添え、左の縦線を枠の線に合わせる） */
const sectionEntry = (s: ChecklistSection): TocEntry => ({ id: blockId(s.class), label: tocName(s.heading), note: TODO_TEXT.tocItems(s.items.length), cls: s.class });

/** 解除の見込みの札（段階 1 だけ）。町の名前を括弧で添える。日付は出さない */
function liftEntry(data: TodoData): TocEntry | null {
  const { state } = data;
  if (state.status !== "ready" || levelOf(state) !== 1) return null;
  const towns = [...new Set(state.result.lifts.map((l) => l.muniName).filter((n) => n !== ""))];
  const town = TODO_TEXT.tocTowns(towns);
  return { id: LIFT_ID, label: town ? `${TODO_TEXT.liftHeading}（${town}）` : TODO_TEXT.liftHeading };
}

/** 読み込み中・読めない・地点がないの知らせ（どの形でも同じ） */
function StateLines({ data }: { data: TodoData }) {
  const { state } = data;
  return (
    <>
      {state.status === "loading" ? <p role="status">{TODO_TEXT.loading}</p> : null}
      {state.status === "failed" ? <p role="alert">{TODO_TEXT.loadFailed}</p> : null}
      {state.status === "no_spot" ? (
        <p>
          {TODO_TEXT.noSpot}。 <Link to="/">{TODO_TEXT.pickTown}</Link>
        </p>
      ) : null}
    </>
  );
}

function ReminderLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="todo-reminder" aria-label="短い確認">
      {/* 守る文は「文（出典: 名前）」のリンクにし、長い URL を本文に出さない */}
      {lines.map((l) => (
        <TextItem key={l} text={l} />
      ))}
    </ul>
  );
}

const LIFT_ID = "todo-lift";

function LiftRegion({ data }: { data: TodoData }) {
  const { state } = data;
  if (state.status !== "ready" || levelOf(state) !== 1) return null;
  return (
    <section className="lift-region" role="region" aria-label={TODO_TEXT.liftHeading} id={LIFT_ID} tabIndex={-1}>
      <h2>{TODO_TEXT.liftHeading}</h2>
      {state.result.lifts.map((l) => (
        <LiftEstimateBlock key={l.caseId} muniName={l.muniName} estimate={l.estimate} />
      ))}
      {state.result.level.inSurveillanceNote ? <p>{SURVEILLANCE_NOTE}</p> : null}
    </section>
  );
}

function WorkerMessage({ data }: { data: TodoData }) {
  const { state } = data;
  return state.status === "ready" && state.result.workerCase ? (
    <WorkerMessagePanel caseId={state.result.workerCase.caseId} facts={state.result.workerCase.facts} />
  ) : null;
}

const shortLines = (data: TodoData) =>
  data.state.status === "ready" || data.state.status === "no_spot" ? shortReminder(levelOf(data.state)) : [];

/** 段階 1 は、解除の見込みの枠が「正式な情報は県の連絡です」を出すので、短い確認からはその 1 行を除く（同じ断りを繰り返さない。2 本目と 1 本目の両方） */
const reminderLines = (data: TodoData, level: number) =>
  level === 1 ? shortLines(data).filter((l) => l !== FIXED_TEXT.prefContactIsAuthority) : shortLines(data);

const hasWorkerMessage = (data: TodoData) => data.state.status === "ready" && Boolean(data.state.result.workerCase);

export default function TodoPage() {
  const data = useTodoData();
  const farm = useFarmRecord();
  const recordMode = useRecordStore().mode;
  // 会員の農場だけ。見本の農場には Firebase の保存先がない（今日のやることと、相談から足した対策の行）
  const memberFarm = farm.status === "ready" && recordMode === "firestore" ? farm.farm : null;
  return memberFarm ? <MemberTodo data={data} farm={memberFarm} /> : <PlainTodo data={data} farm={farm} recordLinks={recordMode !== "sample"} />;
}

/**
 * 見本の農場と会員でない人の対策項目（今のまま。時点の主語だけ変えた）。
 * recordLinks が false（/sample の中）のときは、自己点検と消毒の記録へのリンクを出さない（記録を試す画面はなくした。2026-11-08）
 */
function PlainTodo({ data, farm, recordLinks }: { data: TodoData; farm: FarmState; recordLinks: boolean }) {
  const log = useDisinfectionLog(farm.status === "ready");
  const { state } = data;
  const level = levelOf(state);
  const [openedByUser, setOpened] = useState<boolean | null>(null);
  // 区域に入っている可能性があるとき（段階①）は、求められることを最初から開く。ふだんは短い確認だけ
  const open = openedByUser ?? level === 1;

  const farmInfo = farm.status === "ready" ? farm.farm : null;
  const sections = orderSections(level, buildChecklist({ level, production: farmInfo?.production ?? null, housing: farmInfo?.housing ?? null }));
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  const lines = reminderLines(data, level);

  // 目次は画面の順。確認リストの枠は開いているときだけ（閉じた枠は数えない）
  const lift = liftEntry(data);
  const toc: TocEntry[] = [
    ...(lift ? [lift] : []),
    ...(hasWorkerMessage(data) ? [{ id: "todo-worker", label: WORKER_MESSAGE_TEXT.heading }] : []),
    ...(open && state.status !== "loading" && state.status !== "failed" ? sections.map(sectionEntry) : []),
  ];

  return (
    <div className="todo-page">
      <h1>{TODO_TEXT.title}</h1>
      <AsOf iso={data.asOf} subject={TODAY_TEXT.asOfSubject} loading={data.asOfLoading} />

      <StateLines data={data} />
      {data.prefUnconfirmed && state.status !== "failed" ? <p role="status">{TODO_TEXT.prefUnconfirmed}</p> : null}

      {/* 短い確認（区域に入っている可能性など）を目次で押し下げない。目次は短い確認のすぐ下（2026-11-08 2 周目） */}
      <ReminderLines lines={lines} />
      {state.status === "ready" ? <TodoToc entries={toc} /> : null}
      <LiftRegion data={data} />
      <WorkerMessage data={data} />

      {state.status !== "loading" && state.status !== "failed" ? (
        <section className="todo-checklist" aria-labelledby="todo-checklist-h" id="todo-checklist" tabIndex={-1}>
          <h2 id="todo-checklist-h">{TODO_TEXT.checklistHeading}</h2>
          {recordLinks ? (
            <>
              <p>
                <Link to="../record/self-check" relative="path" className="tap-link">
                  {TODO_TEXT.selfCheckLink}
                </Link>
              </p>
              <p>
                <Link to="../record/disinfection" relative="path" className="tap-link">
                  {TODO_TEXT.disinfectionLink}
                </Link>
              </p>
            </>
          ) : null}
          <p className="todo-note">{TODO_TEXT.moreLead}</p>
          <Button aria-expanded={open} onClick={() => setOpened(!open)}>
            {open ? TODO_TEXT.less : TODO_TEXT.more(itemCount)}
          </Button>
          {open ? (
            <div className="todo-details">
              <FarmGuide farm={farm} />
              {farm.status === "ready" ? <p className="todo-note">{TODO_TEXT.doneNoUndo}</p> : null}
              <ChecklistBlocks sections={sections} log={farm.status === "ready" ? log : null} level={3} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** 「今月の自己点検を確かめましょう」は、今日のやることの自己点検の行と重なるので、会員の画面では出さない（断りを繰り返さない） */
const SELF_CHECK_REMINDER = "今月の自己点検を確かめましょう";

/**
 * 会員で農場があるときの対策項目（2026-11-07 A）。
 * 見出しの横に時点と発生の地図への入口 → （段階 1 だけ）短い確認・解除の見込み・区域に入っていれば求められること
 * → 今日のやること（記録できるものの 1 本のリスト）→ 参照（県の注意、声かけ文、国の指針の一覧）。
 * 消毒の「やった」は今日のやることの行だけに出し、区域の枠と下の一覧には出さない（同じボタンを 2 つにしない）。
 */
function MemberTodo({ data, farm }: { data: TodoData; farm: Farm & { id: string } }) {
  const log = useDisinfectionLog(true);
  const reviews = useReviewItems(farm.id);
  const { state } = data;
  const level = levelOf(state);
  const [openedByUser, setOpened] = useState<boolean | null>(null);
  // 段階①は、一覧も最初から開く（今と同じ）
  const open = openedByUser ?? level === 1;

  const all = orderSections(level, buildChecklist({ level, production: farm.production ?? null, housing: farm.housing ?? null }));
  const loggable = all.flatMap((s) => s.items).filter((i) => i.disinfectionLoggable);
  // 段階 1 は、区域に入っていれば求められることをリストの上に出す（今の順序）。下の一覧には残りだけ
  const zoneFirst = level === 1;
  const zone = zoneFirst ? all.filter((s) => s.class === "if_in_zone") : [];
  const refSections = zoneFirst ? all.filter((s) => s.class !== "if_in_zone") : all;
  const itemCount = refSections.reduce((n, s) => n + s.items.length, 0);
  const lines = reminderLines(data, level);
  const refLines = zoneFirst ? [] : lines.filter((l) => l !== SELF_CHECK_REMINDER);
  const showList = state.status !== "loading" && state.status !== "failed";

  // 目次は画面の順（段階 1 で 4 つ: 解除の見込み、区域、今日のやること、参照）。今日のやることには件数を添えない
  const lift = liftEntry(data);
  const toc: TocEntry[] = [
    ...(lift ? [lift] : []),
    ...zone.map(sectionEntry),
    { id: "todo-today", label: TODAY_TEXT.heading },
    { id: "todo-ref", label: TODAY_TEXT.refHeading },
  ];

  return (
    <div className="todo-page">
      <div className="todo-head">
        <h1>{TODO_TEXT.title}</h1>
        <AsOf iso={data.asOf} subject={TODAY_TEXT.asOfSubject} loading={data.asOfLoading} />
        <p className="todo-head-link">
          <Link to="/" className="tap-link">
            {TODAY_TEXT.outbreakLink}
          </Link>
        </p>
      </div>

      <StateLines data={data} />

      {zoneFirst ? (
        <>
          <ReminderLines lines={lines} />
          {/* 目次は段階 1 だけ（4 つ以上の節があるとき）。短い確認のすぐ下 */}
          {state.status === "ready" ? <TodoToc entries={toc} /> : null}
          <LiftRegion data={data} />
          <ChecklistBlocks sections={zone} log={null} />
        </>
      ) : null}

      <TodayList farm={farm} levelSettled={state.status !== "loading"} loggable={loggable} log={log} reviews={reviews} />

      <section className="todo-ref" role="region" aria-label={TODAY_TEXT.refHeading} id="todo-ref" tabIndex={-1}>
        <h2>{TODAY_TEXT.refHeading}</h2>
        <ReminderLines lines={refLines} />
        {data.prefUnconfirmed && state.status !== "failed" ? <p role="status">{TODO_TEXT.prefUnconfirmed}</p> : null}
        <WorkerMessage data={data} />
        {showList ? (
          <>
            <div className="todo-ref-more">
              <p>{TODAY_TEXT.refLead}</p>
              <Button aria-expanded={open} onClick={() => setOpened(!open)}>
                {open ? TODAY_TEXT.refLess : TODAY_TEXT.refMore(itemCount)}
              </Button>
            </div>
            {open ? (
              <div className="todo-details">
                <ChecklistBlocks sections={refSections} log={null} />
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
