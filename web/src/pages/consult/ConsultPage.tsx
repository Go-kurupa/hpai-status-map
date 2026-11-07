// AIに対策を相談（設計書 2026-11-06-consult-design 14 章、2026-11-07 チャットの形へ。見本 private/requirements/consult-chat-mock.html）。
// 話題を押すか文で聞くと、集めた資料のカードから、短いおすすめと根拠が返る。続けて聞くと、同じ相談の前の往復も関数へ渡す。
// おすすめの文と続けて聞く候補は Claude の下書き。引用・資料・根拠の札・注意書きは、カードのデータをそのまま出す（Claude は書き換えない）。
// 資料の行は、応答のカードに付いた source から出す（静的な /consult/cards.json は、対策項目の欄でだけ使う）。
// これまでの相談は、会員の分だけ、この端末のブラウザに残す（consultHistory.ts）。審査員の入口（?judge=1）は残さず、会員の確認も通さない。
import { CONSULT_TOPICS, type ConsultTopic } from "@hpai/shared/consult/topics";
import { STATS_SOURCE, type ConsultStats } from "@hpai/shared/consult/stats";
import { CONSULT_MAX_QUESTION, EVIDENCE_LABEL, type ConsultAnswerCard } from "@hpai/shared/consult/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "../../ui/Button";
import { RequireMember } from "../auth/RequireMember";
import { useAuthUser } from "../auth/useAuthUser";
import {
  TAG_FREE,
  TAG_STATS,
  dayGroupOf,
  filterConversations,
  historyForAsk,
  hasAdvice,
  historyKey,
  isAnswered,
  loadConversations,
  newConversationId,
  saveConversations,
  tagCounts,
  trimConversations,
  turnTimeLabel,
  whenLabel,
  type ConsultConversation,
  type ConsultHistoryTurn,
  type DayGroup,
} from "./consultHistory";
import { CONSULT_TEXT, attributionText } from "./consultTexts";
import { useReviewStore } from "./reviewStore";
import "./consult.css";

function isWebUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function isNoFarm(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "no-farm";
}

function isPermissionDenied(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.endsWith("permission-denied");
}

interface AddState {
  reviews: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  noFarmIds: ReadonlySet<string>;
  addingIds: ReadonlySet<string>;
}

/** 根拠の資料のカード（引用・出典・注意書き）。カードのデータをそのまま出す。足すボタンは答えのすぐ下の対策の一覧にある */
function ConsultCardView({ card }: { card: ConsultAnswerCard }) {
  // 古い関数の返事には source がない。そのときは資料の行と帰属の文を出さず、カードの本体だけ出す
  const source = (card as { source?: ConsultAnswerCard["source"] }).source;
  return (
    <li className="consult-card" data-testid="consult-card">
      <p className="consult-card-action">{card.action}</p>
      <p>
        <span className="consult-evidence">{EVIDENCE_LABEL[card.evidence]}</span>
      </p>
      <blockquote className="consult-quote">{card.quote}</blockquote>
      {source ? (
        <>
          <p className="consult-source">
            資料:{" "}
            {isWebUrl(source.url) ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            ) : (
              source.title
            )}
            （{source.publisher}）
          </p>
          <p className="consult-attribution" data-testid="consult-attribution">
            {attributionText(source)}
          </p>
          {/* 注意書きに「海外:」があれば、そちらが具体的なので、一般の注意は重ねない */}
          {!source.domestic && !card.caveats.some((c) => c.startsWith("海外:")) ? <p className="consult-foreign">{CONSULT_TEXT.foreign}</p> : null}
        </>
      ) : null}
      {card.caveats.length > 0 ? (
        <ul className="consult-caveats">
          {card.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** 答えのカードを、対策の文（action）ごとにまとめる。同じ対策の別の引用（M04a と M04b など）は 1 行にする */
export function groupActions(cards: readonly ConsultAnswerCard[]): { action: string; ids: string[] }[] {
  const groups: { action: string; ids: string[] }[] = [];
  for (const c of cards) {
    const g = groups.find((x) => x.action === c.action);
    if (g) g.ids.push(c.id);
    else groups.push({ action: c.action, ids: [c.id] });
  }
  return groups;
}

/** 答えのすぐ下の「この答えの対策」。その場で対策項目に足せる（会員だけ）。足したら対策項目への道を出す */
function ActionsView({ cards, canAdd, add, onAdd }: { cards: readonly ConsultAnswerCard[]; canAdd: boolean; add: AddState; onAdd: (cardId: string) => void }) {
  const groups = groupActions(cards);
  const anyAdded = groups.some((g) => g.ids.some((id) => add.reviews.has(id)));
  return (
    <div className="consult-actions" data-testid="consult-actions">
      <p className="consult-actions-head">{CONSULT_TEXT.actionsHead}</p>
      <ul>
        {groups.map((g) => {
          const added = g.ids.some((id) => add.reviews.has(id));
          const adding = g.ids.some((id) => add.addingIds.has(id));
          const failed = g.ids.some((id) => add.failedIds.has(id));
          const noFarm = g.ids.some((id) => add.noFarmIds.has(id));
          return (
            <li key={g.action} className="consult-action" data-testid="consult-action">
              <p className="consult-action-name">{g.action}</p>
              {canAdd ? (
                added ? (
                  <Button disabled>
                    <span aria-hidden="true">✓ </span>
                    {CONSULT_TEXT.added}
                  </Button>
                ) : adding ? (
                  <Button disabled>{CONSULT_TEXT.adding}</Button>
                ) : (
                  <Button onClick={() => onAdd(g.ids[0]!)}>
                    <span aria-hidden="true">＋ </span>
                    {CONSULT_TEXT.add}
                  </Button>
                )
              ) : null}
              {failed ? (
                <p role="alert" className="consult-error">
                  {noFarm ? (
                    <>
                      {CONSULT_TEXT.noFarmBefore}
                      <Link to="/settings/farm">{CONSULT_TEXT.noFarmLink}</Link>
                      {CONSULT_TEXT.noFarmAfter}
                    </>
                  ) : (
                    CONSULT_TEXT.addFailed
                  )}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canAdd && anyAdded ? (
        <p>
          <Link to="/todo" className="consult-to-todo">
            {CONSULT_TEXT.toTodo}
            <span aria-hidden="true"> →</span>
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function noticeText(notice: "daily_limit" | "budget_stop" | "unavailable", judge: boolean): string {
  if (notice === "unavailable") return CONSULT_TEXT.unavailable;
  if (notice === "budget_stop") return CONSULT_TEXT.budgetStop;
  return judge ? CONSULT_TEXT.dailyLimitJudge : CONSULT_TEXT.dailyLimit;
}

/**
 * 発生の件数の表。件数・題・まとめの文はプログラムが過去の事例から組んだもの（Claude は数え方を選んだだけ）。
 * 過去の記録であり予測ではないこと、今季は含まないこと、出典を必ず添える。県を指定した表には、件数が少なくてもリスクがあることも添える。
 */
function StatsView({ stats }: { stats: ConsultStats }) {
  const id = useId();
  return (
    <div className="consult-stats" data-testid="consult-stats">
      <p className="consult-stats-title" id={`${id}-title`}>
        {stats.title}
      </p>
      <p>{stats.summary}</p>
      <p className="consult-note">{CONSULT_TEXT.statsCounted}</p>
      {stats.outOfRange ? null : (
        <table className="consult-stats-table" aria-labelledby={`${id}-title`}>
          <thead>
            <tr>
              <th scope="col">{stats.labelHeader}</th>
              <th scope="col">{CONSULT_TEXT.statsCount}</th>
            </tr>
          </thead>
          <tbody>
            {stats.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.count.toLocaleString("en-US")} 件</td>
              </tr>
            ))}
            {stats.rest ? (
              <tr>
                <th scope="row" colSpan={2}>
                  {CONSULT_TEXT.statsRest(stats.rest.rows, stats.rest.count)}
                </th>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{CONSULT_TEXT.statsTotal}</th>
              <td>{stats.total.toLocaleString("en-US")} 件</td>
            </tr>
          </tfoot>
        </table>
      )}
      <ul className="consult-stats-notes">
        <li>{FIXED_TEXT.pastDisclaimer}。</li>
        {stats.query.prefCode !== null ? <li>{FIXED_TEXT.riskAnywhere}</li> : null}
        <li>
          {CONSULT_TEXT.statsCurrent}
          <Link to="/">{CONSULT_TEXT.statsMapLink}</Link>
        </li>
        <li>
          {CONSULT_TEXT.statsSourcePrefix}
          <a href={STATS_SOURCE.url} target="_blank" rel="noopener noreferrer">
            {STATS_SOURCE.label}
          </a>
        </li>
      </ul>
      <p>
        <Link to="/explore" className="consult-to-todo">
          {CONSULT_TEXT.statsExploreLink}
          <span aria-hidden="true"> →</span>
        </Link>
      </p>
    </div>
  );
}

/** AI の答えの吹き出し。根拠のカードは畳んでおき、押すと開く */
function AnswerView({ turn, judge, add, onAdd }: { turn: ConsultHistoryTurn; judge: boolean; add: AddState; onAdd: (cardId: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { result } = turn;
  if (result.notice) {
    return (
      <div className="consult-bubble consult-ai consult-notice" data-testid="consult-notice">
        <span className="consult-who">{CONSULT_TEXT.aiName}</span>
        <p>{noticeText(result.notice, judge)}</p>
      </div>
    );
  }
  if (!isAnswered(turn)) {
    // 範囲外と、資料にないことは、決まった文だけを出す。カードは出さない
    return (
      <div className="consult-bubble consult-ai consult-notice" data-testid="consult-notice">
        <span className="consult-who">{CONSULT_TEXT.aiName}</span>
        <p>{CONSULT_TEXT.outOfScope}</p>
      </div>
    );
  }
  const n = result.cards.length;
  const advice = hasAdvice(result);
  return (
    <div className="consult-bubble consult-ai consult-advice" data-testid="consult-advice">
      <span className="consult-who consult-advice-head">{advice ? CONSULT_TEXT.advice : CONSULT_TEXT.statsWho}</span>
      {advice ? (
        <>
          <p className="consult-answer">{result.answer}</p>
          <ActionsView cards={result.cards} canAdd={!judge} add={add} onAdd={onAdd} />
        </>
      ) : null}
      {result.stats ? <StatsView stats={result.stats} /> : null}
      {advice ? (
        <>
          <button type="button" className="consult-sources-toggle" aria-expanded={open} aria-controls={`${id}-cards`} onClick={() => setOpen((v) => !v)}>
            <span aria-hidden="true">{open ? "▾ " : "▸ "}</span>
            {open ? CONSULT_TEXT.sourcesClose(n) : CONSULT_TEXT.sourcesOpen(n)}
          </button>
          <ul className="consult-cards" id={`${id}-cards`} hidden={!open}>
            {open ? result.cards.map((card) => <ConsultCardView key={card.id} card={card} />) : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function TurnView({
  turn,
  judge,
  now,
  add,
  onAdd,
  last,
}: {
  turn: ConsultHistoryTurn;
  judge: boolean;
  now: number;
  add: AddState;
  onAdd: (cardId: string) => void;
  last: React.Ref<HTMLElement> | null;
}) {
  return (
    <section className="consult-entry" data-testid="consult-entry" ref={last} tabIndex={last ? -1 : undefined}>
      <div className="consult-bubble consult-me">
        <p className="consult-me-text">{turn.question}</p>
        <span className="consult-time">{turnTimeLabel(turn.at, now)}</span>
      </div>
      <AnswerView turn={turn} judge={judge} add={add} onAdd={onAdd} />
    </section>
  );
}

/** その相談の答えに出た対策のうち、対策項目に足したものの数（同じ対策の別の引用は 1 つと数える） */
function addedCount(c: ConsultConversation, reviews: ReadonlySet<string>): number {
  const groups = groupActions(c.turns.flatMap((t) => t.result.cards));
  return groups.filter((g) => g.ids.some((id) => reviews.has(id))).length;
}

const GROUPS: readonly { key: DayGroup; label: string }[] = [
  { key: "today", label: CONSULT_TEXT.groupToday },
  { key: "yesterday", label: CONSULT_TEXT.groupYesterday },
  { key: "earlier", label: CONSULT_TEXT.groupEarlier },
];

/** パソコンの幅（64rem 以上。地図の画面と同じ境目）では、これまでの相談を左にいつも出す。幅を調べられない環境では切り替えの作り */
const WIDE_QUERY = "(min-width: 64rem)";
function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const isWide = (): boolean => typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, isWide, () => false);
}

function tagLabel(tag: string): string {
  if (tag === TAG_STATS) return CONSULT_TEXT.tagStats;
  if (tag === TAG_FREE) return CONSULT_TEXT.tagFree;
  return CONSULT_TOPICS.find((t) => t.id === tag)?.label ?? tag;
}

function HistoryPanel({
  conversations,
  currentId,
  now,
  kept,
  saveFailed,
  onOpen,
  onNew,
  onRemove,
  onRemoveAll,
  headingRef,
  reviews,
}: {
  headingRef: React.Ref<HTMLHeadingElement>;
  /** 対策項目に足したカードの id（会員だけ。審査員の入口は null） */
  reviews: ReadonlySet<string> | null;
  conversations: readonly ConsultConversation[];
  currentId: string | null;
  now: number;
  kept: boolean;
  saveFailed: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const searchId = useId();
  const tags = tagCounts(conversations);
  // 絞っていた札の相談が消えたら、すべてに戻す
  const activeTag = tag !== null && tags.some((t) => t.tag === tag) ? tag : null;
  const shown = filterConversations(conversations, query, activeTag);
  const filtering = query.trim() !== "" || activeTag !== null;
  return (
    <section className="consult-history" aria-labelledby="consult-history-title">
      <h2 id="consult-history-title" ref={headingRef} tabIndex={-1}>
        {CONSULT_TEXT.historyTitle}
      </h2>
      <p>
        <Button variant="primary" onClick={onNew}>
          <span aria-hidden="true">＋ </span>
          {CONSULT_TEXT.newChat}
        </Button>
      </p>
      {conversations.length === 0 ? <p className="consult-note">{CONSULT_TEXT.historyEmpty}</p> : null}
      {conversations.length > 0 ? (
        <>
          <label htmlFor={searchId} className="consult-visually-hidden">
            {CONSULT_TEXT.searchLabel}
          </label>
          <input
            id={searchId}
            type="search"
            className="consult-history-search"
            placeholder={CONSULT_TEXT.searchLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div role="group" aria-label={CONSULT_TEXT.tagsLabel} className="consult-history-tags">
            <button type="button" className="consult-tag" aria-pressed={activeTag === null} onClick={() => setTag(null)}>
              {CONSULT_TEXT.tagAll(conversations.length)}
            </button>
            {tags.map((t) => (
              <button key={t.tag} type="button" className="consult-tag" aria-pressed={activeTag === t.tag} onClick={() => setTag(activeTag === t.tag ? null : t.tag)}>
                {tagLabel(t.tag)} {t.count}
              </button>
            ))}
          </div>
          <p className="consult-note" aria-live="polite">
            {CONSULT_TEXT.resultCount(shown.length)}
          </p>
          {filtering && shown.length === 0 ? <p className="consult-note">{CONSULT_TEXT.noMatch}</p> : null}
        </>
      ) : null}
      {GROUPS.map(({ key, label }) => {
        const items = shown.filter((c) => dayGroupOf(c.updatedAt, now) === key);
        if (items.length === 0) return null;
        return (
          <div key={key} className="consult-history-group">
            <h3>{label}</h3>
            <ul>
              {items.map((c) => (
                <li key={c.id} className={c.id === currentId ? "consult-history-item is-current" : "consult-history-item"}>
                  <button type="button" className="consult-history-open" aria-current={c.id === currentId ? "true" : undefined} onClick={() => onOpen(c.id)}>
                    <span className="consult-history-name">{c.title}</span>
                    <span className="consult-history-meta">
                      {CONSULT_TEXT.turns(c.turns.length)} · {whenLabel(c.updatedAt, now)}
                      {reviews && addedCount(c, reviews) > 0 ? ` · ${CONSULT_TEXT.addedCount(addedCount(c, reviews))}` : ""}
                    </span>
                  </button>
                  <button type="button" className="consult-history-remove" aria-label={`「${c.title}」を${CONSULT_TEXT.remove}`} onClick={() => onRemove(c.id)}>
                    {CONSULT_TEXT.remove}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="consult-history-kept">{kept ? CONSULT_TEXT.historyKept : CONSULT_TEXT.historyNotKept}</p>
      {saveFailed ? <p className="consult-note">{CONSULT_TEXT.historySaveFailed}</p> : null}
      {conversations.length > 0 ? (
        confirming ? (
          <p className="consult-history-confirm">
            <Button
              onClick={() => {
                setConfirming(false);
                onRemoveAll();
              }}
            >
              {CONSULT_TEXT.removeAllConfirm}
            </Button>
            <Button onClick={() => setConfirming(false)}>{CONSULT_TEXT.removeAllCancel}</Button>
          </p>
        ) : (
          <p>
            <Button onClick={() => setConfirming(true)}>{CONSULT_TEXT.removeAll}</Button>
          </p>
        )
      ) : null}
    </section>
  );
}

function ConsultBody({ judge, uid, initialQuestion = "" }: { judge: boolean; uid: string | null; initialQuestion?: string }) {
  const id = useId();
  const store = useReviewStore();
  // 会員の分だけ、この端末に残す。審査員の入口と、uid が分からないとき（見本）は残さない
  const key = !judge && uid ? historyKey(uid) : null;
  const [conversations, setConversations] = useState<ConsultConversation[]>(() => (key ? loadConversations(key) : []));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [saveFailed, setSaveFailed] = useState(false);
  // 対策項目の「この対策を AI に聞く」から来たときは、その対策の名前を入れておく（送るのは本人）
  const [text, setText] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reviews, setReviews] = useState<ReadonlySet<string>>(new Set());
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [addFailed, setAddFailed] = useState<ReadonlySet<string>>(new Set());
  const [noFarmIds, setNoFarmIds] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const addingRef = useRef(new Set<string>()); // 二度押しを同期で止める（state は次の描き直しまで古い）
  const busyRef = useRef(false); // 送るの二度押しを同期で止める
  const lastEntry = useRef<HTMLElement>(null);
  const pendingEntry = useRef<HTMLElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  // 描いた後に動かすフォーカスの行き先（答えが届いた往復／開いた相談のやりとりの欄／これまでの相談の見出し）
  const focusNext = useRef<"turn" | "log" | "history" | null>(null);
  const loadedKey = useRef(key);

  // ログインの状態が後から決まったとき（uid が替わったとき）は、その会員の分を読み直す
  useEffect(() => {
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    setConversations(key ? loadConversations(key) : []);
    setCurrentId(null);
  }, [key]);

  useEffect(() => {
    if (judge) return;
    let off = false;
    store.listReviews().then(
      (ids) => !off && setReviews(new Set(ids)),
      () => !off && setReviewsFailed(true),
    );
    return () => {
      off = true;
    };
  }, [judge, store]);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const turns = current?.turns ?? [];

  // 新しい往復の位置へ動く
  useEffect(() => {
    if (view === "chat" && turns.length > 0) lastEntry.current?.scrollIntoView?.({ block: "start" });
  }, [turns.length, view, currentId]);

  // キーボードや読み上げで使う人が、答えや画面の切り替えの後に今どこにいるか分かるよう、フォーカスを移す
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const el = target === "turn" ? lastEntry.current : target === "log" ? logRef.current : historyHeading.current;
    el?.focus?.({ preventScroll: true });
  });

  // 送っている間は「答えを作っています…」の位置へ動く（長い相談でも、入力欄の陰に隠さない）
  useEffect(() => {
    if (pending !== null) pendingEntry.current?.scrollIntoView?.({ block: "start" });
  }, [pending]);

  // 待っている間に読み直した一覧と置き場所を、答えが届いた時点で使うため、最新の値を ref にも持つ
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const persist = (next: ConsultConversation[]) => {
    const k = loadedKey.current;
    if (!k) return;
    setSaveFailed(!saveConversations(k, next));
  };

  // typed: 入力欄の文を送るとき true。話題や候補のボタンのときは、書きかけの文を消さない
  // title: 新しい相談の一覧の題（話題のときは話題の短い名前。それ以外は聞いた文）
  const ask = async (input: { question: string } | { topicId: string }, shown: string, typed: boolean, title: string = shown) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    setPending(shown);
    if (typed) setText("");
    // 送る時点の相談と置き場所（この後に一覧や会員が変わっても、この相談に足す）
    const base = current;
    const sentKey = key;
    try {
      const { consultAskCall } = await import("../auth/callables");
      const result = await consultAskCall(input, judge, base ? historyForAsk(base.turns) : []);
      // 待っている間に会員が替わったら、前の会員の一覧を今の画面と置き場所に混ぜない。
      // 送った時点で会員が未定（ログインの状態を読み込み中）だったなら同じ人なので、今の置き場所に入れる
      if (sentKey !== null && loadedKey.current !== sentKey) return;
      const at = Date.now();
      const turn: ConsultHistoryTurn = { question: shown, result, at };
      const conv: ConsultConversation = base
        ? { ...base, updatedAt: at, turns: [...base.turns, turn] }
        : { id: newConversationId(at), title, createdAt: at, updatedAt: at, turns: [turn], ...("topicId" in input ? { topicId: input.topicId } : {}) };
      const next = trimConversations([conv, ...conversationsRef.current.filter((c) => c.id !== conv.id)]);
      setConversations(next);
      setCurrentId(conv.id);
      persist(next);
      focusNext.current = "turn";
    } catch {
      setFailed(true);
      // 入力の文は消さない（待っている間に書いた新しい文があれば、そちらを残す）
      if (typed) setText((cur) => (cur === "" ? shown : cur));
    } finally {
      setPending(null);
      setBusy(false);
      busyRef.current = false;
    }
  };

  const question = text.trim();
  const canAsk = !busy && question !== "" && Array.from(question).length <= CONSULT_MAX_QUESTION;

  const askTopic = (t: ConsultTopic) => {
    void ask({ topicId: t.id }, t.question, false, t.label);
  };

  const add = async (cardId: string) => {
    if (addingRef.current.has(cardId) || reviews.has(cardId)) return;
    addingRef.current.add(cardId);
    setAdding(new Set(addingRef.current));
    setAddFailed((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
    setNoFarmIds((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
    try {
      await store.addReview(cardId);
      setReviews((prev) => new Set(prev).add(cardId));
    } catch (e) {
      // 足し済みのカードへの書き込みは上書きになり、規則が拒む。一覧を読めていなかっただけなら、読み直して足し済みにする
      let already = false;
      if (isNoFarm(e)) setNoFarmIds((prev) => new Set(prev).add(cardId));
      else if (isPermissionDenied(e)) {
        try {
          const ids = await store.listReviews();
          setReviews(new Set(ids));
          already = ids.includes(cardId);
        } catch {
          already = false;
        }
      }
      if (!already) setAddFailed((prev) => new Set(prev).add(cardId));
    }
    addingRef.current.delete(cardId);
    setAdding(new Set(addingRef.current));
  };

  const addState: AddState = { reviews, failedIds: addFailed, noFarmIds, addingIds: adding };
  const onAdd = (cardId: string) => void add(cardId);

  const startNew = () => {
    if (busy) return;
    setCurrentId(null);
    setFailed(false);
    setText("");
    setView("chat");
  };
  const openConversation = (cid: string) => {
    if (busy) return;
    setCurrentId(cid);
    setFailed(false);
    setText("");
    setView("chat");
    focusNext.current = "log";
  };
  const removeConversation = (cid: string) => {
    const next = conversations.filter((c) => c.id !== cid);
    setConversations(next);
    persist(next);
    if (cid === currentId) setCurrentId(null);
  };
  const removeAll = () => {
    setConversations([]);
    persist([]);
    setCurrentId(null);
  };

  const wide = useWide();
  const showHistory = wide || view === "history";
  const showChat = wide || view === "chat";
  const now = Date.now();
  const lastTurn = turns.at(-1);
  const followUps = !busy && lastTurn && isAnswered(lastTurn) ? (lastTurn.result.followUps ?? []) : [];

  return (
    <div className={wide ? "consult-page is-wide" : "consult-page"}>
      <div className="consult-bar">
        <h1>{CONSULT_TEXT.title}</h1>
        {/* パソコンの幅では、一覧がいつも左にあり、「新しい相談」も一覧の上にあるので、切り替えのボタンは出さない */}
        <div className="consult-bar-actions" hidden={wide}>
          {view === "chat" ? (
            <Button
              onClick={() => {
                focusNext.current = "history";
                setView("history");
              }}
              disabled={busy}
            >
              <span aria-hidden="true">≡ </span>
              {CONSULT_TEXT.historyOpen}
            </Button>
          ) : (
            <Button onClick={() => setView("chat")}>
              <span aria-hidden="true">× </span>
              {CONSULT_TEXT.historyClose}
            </Button>
          )}
          <Button onClick={startNew} disabled={busy}>
            <span aria-hidden="true">＋ </span>
            {CONSULT_TEXT.newChat}
          </Button>
        </div>
      </div>
      {judge ? <p className="consult-judge">{CONSULT_TEXT.judgeBanner}</p> : null}

      <div className="consult-body">
      {showHistory ? (
        <HistoryPanel
          conversations={conversations}
          currentId={currentId}
          now={now}
          kept={key !== null}
          saveFailed={saveFailed}
          onOpen={openConversation}
          onNew={startNew}
          onRemove={removeConversation}
          onRemoveAll={removeAll}
          headingRef={historyHeading}
          reviews={judge ? null : reviews}
        />
      ) : null}
      {showChat ? (
        <div className="consult-chat">
          {current ? (
            <p className="consult-chat-head">
              <span className="consult-chat-title">{current.title}</span>
              <span className="consult-note">{CONSULT_TEXT.chatSince(turnTimeLabel(current.createdAt, now), current.turns.length)}</span>
            </p>
          ) : null}
          <div className="consult-log" role="log" aria-live="polite" aria-label={CONSULT_TEXT.logLabel} ref={logRef} tabIndex={-1}>
            <div className="consult-bubble consult-ai consult-greeting">
              <span className="consult-who">{CONSULT_TEXT.aiName}</span>
              <p>{CONSULT_TEXT.greeting}</p>
              {turns.length === 0 ? (
                <div role="group" aria-label={CONSULT_TEXT.topicsLabel} className="consult-chips">
                  {CONSULT_TOPICS.map((t) => (
                    <button key={t.id} type="button" className="consult-chip" disabled={busy} onClick={() => askTopic(t)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {turns.map((t, i) => (
              <TurnView key={`${t.at}:${i}`} turn={t} judge={judge} now={now} add={addState} onAdd={onAdd} last={i === turns.length - 1 ? lastEntry : null} />
            ))}
            {pending !== null ? (
              <section className="consult-entry" ref={pendingEntry}>
                <div className="consult-bubble consult-me">
                  <p className="consult-me-text">{pending}</p>
                </div>
                <div className="consult-bubble consult-ai consult-thinking">
                  <p>{CONSULT_TEXT.thinking}</p>
                </div>
              </section>
            ) : null}
            {followUps.length > 0 ? (
              <div role="group" aria-label={CONSULT_TEXT.followUpsLabel} className="consult-chips consult-follow">
                {followUps.map((f) => (
                  <button key={f} type="button" className="consult-chip" onClick={() => void ask({ question: f }, f, false)}>
                    {f}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="consult-composer">
            {failed ? (
              <p role="alert" className="consult-error">
                {CONSULT_TEXT.failed}
              </p>
            ) : null}
            {reviewsFailed ? <p className="consult-note">{CONSULT_TEXT.reviewsLoadFailed}</p> : null}
            {saveFailed ? <p className="consult-note">{CONSULT_TEXT.historySaveFailed}</p> : null}
            <label htmlFor={`${id}-q`} className="consult-visually-hidden">
              {CONSULT_TEXT.questionLabel}
            </label>
            <div className="consult-composer-row">
              <textarea
                id={`${id}-q`}
                rows={2}
                maxLength={CONSULT_MAX_QUESTION}
                aria-describedby={`${id}-hint`}
                placeholder={turns.length > 0 ? CONSULT_TEXT.followPlaceholder : CONSULT_TEXT.placeholder}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button variant="primary" disabled={!canAsk} onClick={() => void ask({ question }, question, true)}>
                {busy ? CONSULT_TEXT.asking : CONSULT_TEXT.ask}
              </Button>
            </div>
            <p className="consult-hint" id={`${id}-hint`}>
              {CONSULT_TEXT.inputHint}
            </p>
          </div>
        </div>
      ) : null}
      </div>

      <p className="consult-processed">{CONSULT_TEXT.processed}</p>
      <p className="consult-footer">{CONSULT_TEXT.footer}</p>
    </div>
  );
}

/** 会員の画面。uid でこの端末の記録の置き場所を分ける */
function MemberConsult({ initialQuestion }: { initialQuestion: string }) {
  const auth = useAuthUser();
  return <ConsultBody judge={false} uid={auth.user?.uid ?? null} initialQuestion={initialQuestion} />;
}

/** ?q= の文（前後の空白を除き、上限の字数まで）。対策項目からの入口が使う */
function initialQuestionOf(params: URLSearchParams): string {
  return Array.from((params.get("q") ?? "").trim()).slice(0, CONSULT_MAX_QUESTION).join("");
}

export default function ConsultPage() {
  const params = new URLSearchParams(useLocation().search);
  const judge = params.get("judge") === "1";
  const initialQuestion = initialQuestionOf(params);
  if (judge) return <ConsultBody judge uid={null} initialQuestion={initialQuestion} />;
  return (
    <RequireMember>
      <MemberConsult initialQuestion={initialQuestion} />
    </RequireMember>
  );
}
