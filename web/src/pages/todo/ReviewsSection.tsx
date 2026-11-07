// 相談から足した対策の行（会員だけ。2026-11-07 A で「今日のやること」の 1 本のリストの行にした）。
// AIに対策を相談の「対策項目に追加する」で足したカードを、今日のやることの行として出す。
// 中身はカードの一覧（/consult/cards.json）から引く。農場に保存してあるのはカードの id、足した時刻と人、
// 人が付けた実施の記録（まだ・後でやる・やった、40 字までのメモ、更新の時刻と人）だけ。AI は記録を書かない。
// 押すもの（状態の 3 つ）は行に出し、メモ・「この対策を AI に聞く」・「外す」は行の中の「くわしく」に畳む。
// 読み出しは reviewItems.ts（画面で 1 度だけ読む）。並びは今日のやることの側で開いたときに固定する。
import { EVIDENCE_LABEL } from "@hpai/shared/consult/types";
import { REVIEW_NOTE_MAX, REVIEW_STATUS_LABEL, reviewNoteProblem, type ReviewStatus } from "@hpai/shared/consult/review";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "../../ui/Button";
import { Fold } from "../../ui/Fold";
import type { ConsultCatalog } from "../consult/cardsData";
import type { ReviewChange, ReviewItem, ReviewStore } from "../consult/reviewStore";
import { TODAY_TEXT, TODO_TEXT } from "./texts";
import { TodayRow, type TodayMark } from "./TodayRow";

/** ボタンの並び（左から） */
const STATUS_ORDER: readonly ReviewStatus[] = ["pending", "later", "done"];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 更新の時刻を日本時間で「11 月 8 日 6:30」（実行する機械の時刻帯に頼らない。AsOf と同じ書き方） */
export function formatReviewUpdated(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCMonth() + 1} 月 ${j.getUTCDate()} 日 ${j.getUTCHours()}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}

const isPermissionDenied = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.endsWith("permission-denied");
};

/**
 * 行の印。今の資料にないカードは状態を付けられないので info（集計に数えない）。
 * カードの一覧を読めない（null）ときは、状態だけで印を付ける（名前の代わりに id を出す）。
 */
export function reviewMark(item: ReviewItem, catalog: ConsultCatalog | null): TodayMark {
  if (catalog && !catalog.cards.has(item.id)) return "info";
  return item.status === "done" ? "done" : item.status === "later" ? "later" : "todo";
}

/** 1 つの対策の行。状態の 3 つのボタン（行）、メモ・AI に聞く・外す（くわしく）。保存は押した方（状態かメモ）だけを送る */
export function ReviewRow({
  item,
  catalog,
  store,
  onSaved,
  onRemoved,
}: {
  item: ReviewItem;
  catalog: ConsultCatalog | null;
  store: ReviewStore;
  onSaved: (id: string, change: ReviewChange) => void;
  onRemoved: (id: string) => void;
}) {
  const card = catalog?.cards.get(item.id);
  const source = card ? catalog?.sources.get(card.sourceId) : undefined;
  const [draft, setDraft] = useState(item.note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown: ReviewStatus = item.status ?? "pending";
  const mark = reviewMark(item, catalog);

  async function save(change: ReviewChange) {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      await store.markReview(item.id, change);
      onSaved(item.id, change);
    } catch (e) {
      // 表示は保存できたものだけ。失敗したら元のまま
      setError(isPermissionDenied(e) ? TODO_TEXT.reviewsSaveDenied : TODO_TEXT.reviewsSaveFailed);
    }
    setSaving(false);
  }

  async function remove() {
    setError(null);
    try {
      await store.removeReview(item.id);
      onRemoved(item.id);
    } catch {
      setError(TODO_TEXT.reviewsRemoveFailed);
    }
  }

  function pick(s: ReviewStatus) {
    // 押されている状態を押しても保存しない（記録なしの「まだ」は、押すと「まだ」と記録する）
    if (item.status === s) return;
    void save({ status: s });
  }

  function saveNote(e: FormEvent) {
    e.preventDefault();
    const note = draft.trim();
    const problem = reviewNoteProblem(note);
    if (problem !== null) {
      setError(problem === "newline" ? TODO_TEXT.reviewsNoteNewline : TODO_TEXT.reviewsNoteTooLong);
      return;
    }
    if (note === item.note) return;
    setDraft(note);
    void save({ note });
  }

  const removeButton = <Button onClick={() => void remove()}>{TODO_TEXT.reviewsRemove}</Button>;
  const notice = (
    <>
      {saving ? <p role="status">{TODO_TEXT.reviewsSaving}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );

  if (!card) {
    // 今の資料にないカード・カードの一覧を読めないとき: 名前の代わりにその旨か id。外すことだけできる
    return (
      <TodayRow
        mark={mark}
        markLabel={mark === "info" ? TODAY_TEXT.mark.gone : undefined}
        text={catalog ? TODO_TEXT.reviewsGone : item.id}
        sub={TODAY_TEXT.reviewFrom}
        more={
          <>
            <Fold summary={TODAY_TEXT.details} className="today-fold">
              <div className="today-fold-body">{removeButton}</div>
            </Fold>
            {notice}
          </>
        }
      />
    );
  }

  const inputId = `review-note-${item.id}`;
  return (
    <TodayRow
      mark={mark}
      text={card.action}
      sub={item.status === null ? `${TODAY_TEXT.reviewFrom}。${TODO_TEXT.reviewsNoRecord}` : TODAY_TEXT.reviewFrom}
      act={
        <div className="review-status" role="group" aria-label={`${TODO_TEXT.reviewsStatusGroup}: ${card.action}`}>
          {STATUS_ORDER.map((s) => (
            <Button key={s} aria-pressed={shown === s} disabled={saving} onClick={() => pick(s)}>
              {REVIEW_STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
      }
      more={
        <>
          {item.note ? <p className="todo-note">{TODAY_TEXT.reviewMemo(item.note)}</p> : null}
          <Fold summary={TODAY_TEXT.details} className="today-fold">
            <div className="today-fold-body">
              <p className="todo-note">
                {EVIDENCE_LABEL[card.evidence]}
                {source ? `。資料: ${source.title}（${source.publisher}）` : ""}
              </p>
              {item.updatedAt !== null ? (
                <p className="todo-note review-updated">
                  {`${TODO_TEXT.reviewsUpdated}${formatReviewUpdated(item.updatedAt)}${item.mine ? TODO_TEXT.reviewsByMe : TODO_TEXT.reviewsByMember}`}
                </p>
              ) : null}
              <form className="review-note" onSubmit={saveNote}>
                <label htmlFor={inputId}>{TODO_TEXT.reviewsNoteLabel}</label>
                <div className="review-note-row">
                  <input
                    id={inputId}
                    type="text"
                    maxLength={REVIEW_NOTE_MAX}
                    autoComplete="off"
                    value={draft}
                    disabled={saving}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <Button type="submit" disabled={saving || draft.trim() === item.note}>
                    {TODO_TEXT.reviewsNoteSave}
                  </Button>
                </div>
              </form>
              {/* 相談の画面の入力欄に、この対策の名前を入れて開く（送るのは本人） */}
              <p>
                <Link to={`/consult?q=${encodeURIComponent(card.action)}`} className="tap-link">
                  {TODO_TEXT.reviewsAsk}
                </Link>
              </p>
              {removeButton}
            </div>
          </Fold>
          {notice}
        </>
      }
    />
  );
}
