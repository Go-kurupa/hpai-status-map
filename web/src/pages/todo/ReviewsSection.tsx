// 相談から足した見直し（会員だけ）。AIに対策を相談の「対策項目に足す」で足したカードを並べる。
// 中身はカードの一覧（/consult/cards.json）から引く。農場に保存してあるのはカードの id、足した時刻と人、
// 人が付けた実施の記録（まだ・後でやる・やった、40 字までのメモ、更新の時刻と人）だけ。AI は記録を書かない。
// 読み出しと並び（読み込んだときだけ「後でやる」「まだ」を上）は reviewItems.ts。上の「けさの確認」と同じ状態を見る。
import { EVIDENCE_LABEL } from "@hpai/shared/consult/types";
import { REVIEW_NOTE_MAX, REVIEW_STATUS_LABEL, reviewNoteProblem, type ReviewStatus } from "@hpai/shared/consult/review";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "../../ui/Button";
import type { ReviewChange, ReviewItem, ReviewStore } from "../consult/reviewStore";
import type { ReviewItems } from "./reviewItems";
import { TODO_TEXT } from "./texts";

/** 欄の id。上の「けさの確認」からの入口（#todo-reviews） */
export const REVIEWS_ANCHOR = "todo-reviews";

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

export function ReviewsSection({ reviews }: { reviews: ReviewItems }) {
  const { store, load, catalog, applied, removed } = reviews;
  const [removeFailed, setRemoveFailed] = useState(false);

  async function remove(id: string) {
    setRemoveFailed(false);
    try {
      await store.removeReview(id);
      removed(id);
    } catch {
      setRemoveFailed(true);
    }
  }

  const items = load.status === "ready" ? load.items : [];
  const anyUnrecorded = items.some((x) => x.status === null && catalog?.cards.has(x.id));

  return (
    <section id={REVIEWS_ANCHOR} className="todo-reviews" role="region" aria-label={TODO_TEXT.reviewsHeading}>
      <h2>{TODO_TEXT.reviewsHeading}</h2>
      {load.status === "failed" ? <p role="alert">{TODO_TEXT.reviewsLoadFailed}</p> : null}
      {load.status === "ready" && items.length === 0 ? (
        <p>
          {TODO_TEXT.reviewsEmpty} <Link to="/consult">{TODO_TEXT.reviewsLink}</Link>
        </p>
      ) : null}
      {anyUnrecorded ? <p className="todo-note">{TODO_TEXT.reviewsUnrecordedLead}</p> : null}
      {items.length > 0 ? (
        <ul className="todo-items">
          {items.map((item) => {
            const card = catalog?.cards.get(item.id);
            const source = card ? catalog?.sources.get(card.sourceId) : undefined;
            return (
              <li key={item.id}>
                {card ? (
                  <>
                    <p>{card.action}</p>
                    <p className="todo-note">
                      {EVIDENCE_LABEL[card.evidence]}
                      {source ? `。資料: ${source.title}（${source.publisher}）` : ""}
                    </p>
                    <ReviewMark item={item} action={card.action} store={store} onSaved={applied} />
                    {/* 相談の画面の入力欄に、この対策の名前を入れて開く（送るのは本人） */}
                    <p>
                      <Link to={`/consult?q=${encodeURIComponent(card.action)}`}>{TODO_TEXT.reviewsAsk}</Link>
                    </p>
                  </>
                ) : (
                  <p className="todo-note">{catalog ? TODO_TEXT.reviewsGone : item.id}</p>
                )}
                <Button onClick={() => void remove(item.id)}>{TODO_TEXT.reviewsRemove}</Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <p>
          <Link to="/consult">{TODO_TEXT.reviewsLink}</Link>
        </p>
      ) : null}
      {removeFailed ? <p role="alert">{TODO_TEXT.reviewsRemoveFailed}</p> : null}
    </section>
  );
}

/** 1 つの対策の実施の記録。状態の 3 つのボタン、メモ、更新の 1 行。保存は押した方（状態かメモ）だけを送る */
function ReviewMark({
  item,
  action,
  store,
  onSaved,
}: {
  item: ReviewItem;
  action: string;
  store: ReviewStore;
  onSaved: (id: string, change: ReviewChange) => void;
}) {
  const [draft, setDraft] = useState(item.note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown: ReviewStatus = item.status ?? "pending";

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

  const inputId = `review-note-${item.id}`;
  return (
    <div className="review-mark">
      <div className="review-status" role="group" aria-label={`${TODO_TEXT.reviewsStatusGroup}: ${action}`}>
        {STATUS_ORDER.map((s) => (
          <Button key={s} aria-pressed={shown === s} disabled={saving} onClick={() => pick(s)}>
            {REVIEW_STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      <p className="todo-note review-updated">
        {item.updatedAt === null
          ? TODO_TEXT.reviewsNoRecord
          : `${TODO_TEXT.reviewsUpdated}${formatReviewUpdated(item.updatedAt)}${item.mine ? TODO_TEXT.reviewsByMe : TODO_TEXT.reviewsByMember}`}
      </p>
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
      {saving ? <p role="status">{TODO_TEXT.reviewsSaving}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
