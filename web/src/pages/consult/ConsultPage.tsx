// 対策の相談（設計書 2026-11-06-consult-design 14 章）。話題を押すか、文で聞くと、集めた資料のカードから、おすすめと根拠が返る。
// おすすめの文は Claude の下書き。引用・資料・根拠の札・注意書きは、カードのデータをそのまま出す（Claude は書き換えない）。
// 資料の行は、応答のカードに付いた source から出す（静的な /consult/cards.json は、対策項目の欄でだけ使う）。
// 前の相談は画面に残し、ページを離れたら消える（保存しない）。会員だけの画面だが、?judge=1 の審査員の入口は会員の確認を通さない。
import { CONSULT_TOPICS, type ConsultTopic } from "@hpai/shared/consult/topics";
import { EVIDENCE_LABEL, type ConsultAnswerCard, type ConsultAskResponse } from "@hpai/shared/consult/types";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "../../ui/Button";
import { RequireMember } from "../auth/RequireMember";
import { CONSULT_TEXT, attributionText } from "./consultTexts";
import { useReviewStore } from "./reviewStore";
import "./consult.css";

/** 聞く文の長さの上限。関数も同じ数で止める */
const MAX_QUESTION = 300;

interface Entry {
  n: number;
  question: string;
  result: ConsultAskResponse;
}

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

function ConsultCardView({
  card,
  canAdd,
  added,
  adding,
  failed,
  noFarm,
  onAdd,
}: {
  card: ConsultAnswerCard;
  canAdd: boolean;
  added: boolean;
  adding: boolean;
  failed: boolean;
  noFarm: boolean;
  onAdd: (cardId: string) => void;
}) {
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
      {canAdd ? (
        <p>
          {added ? (
            <Button disabled>{CONSULT_TEXT.added}</Button>
          ) : adding ? (
            <Button disabled>{CONSULT_TEXT.adding}</Button>
          ) : (
            <Button onClick={() => onAdd(card.id)}>{CONSULT_TEXT.add}</Button>
          )}
        </p>
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
}

function noticeText(notice: "daily_limit" | "budget_stop" | "unavailable", judge: boolean): string {
  if (notice === "unavailable") return CONSULT_TEXT.unavailable;
  if (notice === "budget_stop") return CONSULT_TEXT.budgetStop;
  return judge ? CONSULT_TEXT.dailyLimitJudge : CONSULT_TEXT.dailyLimit;
}

function EntryView({
  entry,
  judge,
  reviews,
  failedIds,
  noFarmIds,
  addingIds,
  onAdd,
  last,
}: {
  entry: Entry;
  judge: boolean;
  reviews: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  noFarmIds: ReadonlySet<string>;
  addingIds: ReadonlySet<string>;
  onAdd: (cardId: string) => void;
  last: React.Ref<HTMLElement>;
}) {
  const { result } = entry;
  let body;
  if (result.notice) {
    body = <p role="status" className="consult-notice">{noticeText(result.notice, judge)}</p>;
  } else if (result.outOfScope || result.cards.length === 0) {
    // 範囲外と、資料にないことは、決まった文だけを出す。カードは出さない
    body = <p role="status" className="consult-notice">{CONSULT_TEXT.outOfScope}</p>;
  } else {
    body = (
      <>
        <div className="consult-advice" data-testid="consult-advice">
          <p className="consult-advice-head">{CONSULT_TEXT.advice}</p>
          <p className="consult-answer">{result.answer}</p>
        </div>
        <ul className="consult-cards">
          {result.cards.map((card) => (
            <ConsultCardView
              key={card.id}
              card={card}
              canAdd={!judge}
              added={reviews.has(card.id)}
              adding={addingIds.has(card.id)}
              failed={failedIds.has(card.id)}
              noFarm={noFarmIds.has(card.id)}
              onAdd={onAdd}
            />
          ))}
        </ul>
      </>
    );
  }
  return (
    <section className="consult-entry" data-testid="consult-entry" ref={last}>
      <p className="consult-me">{entry.question}</p>
      {body}
    </section>
  );
}

function ConsultBody({ judge }: { judge: boolean }) {
  const id = useId();
  const store = useReviewStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reviews, setReviews] = useState<ReadonlySet<string>>(new Set());
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [addFailed, setAddFailed] = useState<ReadonlySet<string>>(new Set());
  const [noFarmIds, setNoFarmIds] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const addingRef = useRef(new Set<string>()); // 二度押しを同期で止める（state は次の描き直しまで古い）
  const lastEntry = useRef<HTMLElement>(null);
  const counter = useRef(0);

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

  // 新しい相談の位置へ動く
  useEffect(() => {
    if (entries.length > 0) lastEntry.current?.scrollIntoView?.({ block: "start" });
  }, [entries.length]);

  const ask = useCallback(
    async (input: { question: string } | { topicId: string }, shown: string) => {
      setBusy(true);
      setFailed(false);
      setText(shown);
      try {
        const { consultAskCall } = await import("../auth/callables");
        const result = await consultAskCall(input, judge);
        counter.current += 1;
        const n = counter.current;
        setEntries((prev) => [...prev, { n, question: shown, result }]);
        setText("");
      } catch {
        setFailed(true); // 入力の文は消さない
      }
      setBusy(false);
    },
    [judge],
  );

  const question = text.trim();
  const canAsk = !busy && question !== "" && Array.from(question).length <= MAX_QUESTION;

  const askTopic = (t: ConsultTopic) => {
    if (busy) return;
    void ask({ topicId: t.id }, t.question);
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

  return (
    <div className="consult-page">
      <h1>{CONSULT_TEXT.title}</h1>
      {judge ? <p className="consult-judge">{CONSULT_TEXT.judgeBanner}</p> : null}
      <p>{CONSULT_TEXT.intro}</p>

      <div role="group" aria-label={CONSULT_TEXT.topicsLabel} className="consult-topics">
        {CONSULT_TOPICS.map((t) => (
          <Button key={t.id} className="consult-topic" disabled={busy} onClick={() => askTopic(t)}>
            {t.label}
          </Button>
        ))}
      </div>

      <div className="consult-ask">
        <label htmlFor={`${id}-q`}>{CONSULT_TEXT.questionLabel}</label>
        <p className="consult-note">{CONSULT_TEXT.inputHint}</p>
        <textarea
          id={`${id}-q`}
          rows={3}
          maxLength={MAX_QUESTION}
          placeholder={CONSULT_TEXT.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p>
          <Button variant="primary" disabled={!canAsk} onClick={() => void ask({ question }, question)}>
            {busy ? CONSULT_TEXT.asking : CONSULT_TEXT.ask}
          </Button>
        </p>
        {failed ? (
          <p role="alert" className="consult-error">
            {CONSULT_TEXT.failed}
          </p>
        ) : null}
        {reviewsFailed ? <p className="consult-note">{CONSULT_TEXT.reviewsLoadFailed}</p> : null}
      </div>

      <div className="consult-log">
        {entries.map((e, i) => (
          <EntryView
            key={e.n}
            entry={e}
            judge={judge}
            reviews={reviews}
            failedIds={addFailed}
            noFarmIds={noFarmIds}
            addingIds={adding}
            onAdd={(cardId) => void add(cardId)}
            last={i === entries.length - 1 ? lastEntry : null}
          />
        ))}
      </div>

      <p className="consult-processed">{CONSULT_TEXT.processed}</p>
      <p className="consult-footer">{CONSULT_TEXT.footer}</p>
    </div>
  );
}

export default function ConsultPage() {
  const judge = new URLSearchParams(useLocation().search).get("judge") === "1";
  if (judge) return <ConsultBody judge />;
  return (
    <RequireMember>
      <ConsultBody judge={false} />
    </RequireMember>
  );
}
