import { useState } from "react";

import { BookDetailDialog } from "@/components/book-detail-dialog";
import { OpacLinks } from "@/components/opac-links";
import { ApiRequestError } from "@/lib/api-client";
import { isActivationKey } from "@/utils/is-activation-key";

import { formatSlipDate, nextRecommendationDate } from "../utils/recommendation-slip";

import { BookPanel } from "./book-panel";

import type { AppSettings, CurrentRecommendation } from "@/types/api";
import type { JSX } from "react";

export function CurrentRecommendationView(input: {
  readonly current: CurrentRecommendation | null;
  readonly settings: AppSettings | null;
  readonly loading: boolean;
  readonly onRun: () => Promise<void>;
  readonly onRandomize: () => Promise<void>;
  readonly onPromote: (bookmeterUrl: string) => Promise<void>;
}): JSX.Element {
  const [selectedRelatedBook, setSelectedRelatedBook] = useState<CurrentRecommendation["relatedBooks"][number] | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function runAction(action: () => Promise<void>): Promise<void> {
    if (actionPending) {
      return;
    }

    setActionError(null);
    setActionPending(true);
    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError && error.code === "no_random_candidate"
          ? "ほかに選べる本がありません。"
          : "操作に失敗しました。少し時間をおいて再度お試しください。"
      );
    } finally {
      setActionPending(false);
    }
  }

  if (input.loading) {
    return (
      <section className="view" aria-busy="true">
        <div className="skeleton-card">
          <div className="skeleton-line skeleton-line--kicker" />
          <div className="skeleton-line skeleton-line--title" />
          <div className="skeleton-line skeleton-line--title skeleton-line--short" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-line--short" />
        </div>
      </section>
    );
  }

  if (!input.current?.primary) {
    return (
      <section className="view">
        <h2 className="section-label">今週の一冊</h2>
        <p className="status">推薦を作成できる書籍がありません。</p>
        <button disabled={actionPending} onClick={() => void runAction(input.onRun)}>
          推薦を更新
        </button>
        {actionError ? (
          <p className="status status--error" role="alert">
            {actionError}
          </p>
        ) : null}
      </section>
    );
  }

  const recommendationDate = new Date(input.current.createdAt);
  const plannedFinishDate = input.settings
    ? nextRecommendationDate(input.settings.recommendationDayOfWeek, recommendationDate)
    : null;
  const recommendationSlip = (
    <div className="recommendation-slip">
      <span className="recommendation-slip__col">
        <span className="recommendation-slip__key">推薦日</span>
        <span className="recommendation-slip__val">{formatSlipDate(recommendationDate)}</span>
      </span>
      <span className="recommendation-slip__sep" />
      <span className="recommendation-slip__col">
        <span className="recommendation-slip__key">読了予定</span>
        <span className="recommendation-slip__val">{plannedFinishDate ? formatSlipDate(plannedFinishDate) : "—"}</span>
      </span>
    </div>
  );

  return (
    <section className="view">
      <div className="view-heading">
        <p className="cycle-meta">
          CYCLE {input.current.cycleId} · {input.current.reason}
        </p>
        <div className="toolbar">
          <button disabled={actionPending} onClick={() => void runAction(input.onRun)}>
            更新
          </button>
          <button disabled={actionPending} onClick={() => void runAction(input.onRandomize)}>
            ランダムに選ぶ
          </button>
        </div>
      </div>
      {actionError ? (
        <p className="status status--error" role="alert">
          {actionError}
        </p>
      ) : null}
      <BookPanel book={input.current.primary} featured kicker="今週の一冊" slip={recommendationSlip} />
      <h2 className="section-label">次の候補</h2>
      <div className="grid">
        {input.current.secondaries.map((book) => (
          <BookPanel
            key={book.bookmeterUrl}
            book={book}
            kicker="候補"
            actionLabel="今週はこれを読む"
            onAction={() => void runAction(() => input.onPromote(book.bookmeterUrl))}
          />
        ))}
      </div>
      <h2 className="section-label">近い内容の本</h2>
      <div className="related-list">
        {input.current.relatedBooks.map((book) => (
          <article
            key={book.bookmeterUrl}
            className="related-row"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedRelatedBook(book)}
            onKeyDown={(event) => {
              if (isActivationKey(event)) {
                event.preventDefault();
                setSelectedRelatedBook(book);
              }
            }}
          >
            <div>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <p>{book.reasons.join(" ")}</p>
            </div>
            <div className="related-row__actions">
              <span className="related-row__score">{book.score.toFixed(3)}</span>
              <a
                className="button-link button-link--bookmeter"
                href={book.bookmeterUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Bookmeter
              </a>
              <OpacLinks book={book} stopPropagation />
            </div>
          </article>
        ))}
      </div>
      {selectedRelatedBook ? (
        <BookDetailDialog
          book={selectedRelatedBook}
          reasons={selectedRelatedBook.reasons}
          titleId="related-book-title"
          onClose={() => setSelectedRelatedBook(null)}
        />
      ) : null}
    </section>
  );
}
