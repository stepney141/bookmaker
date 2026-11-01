import { OpacLinks } from "@/components/opac-links";
import { catalogNumber, listLabel, stampLabel } from "@/utils/book-labels";

import type { RecommendationBook } from "@/types/api";
import type { JSX, ReactNode } from "react";

export function BookPanel(input: {
  readonly book: RecommendationBook;
  readonly featured?: boolean;
  readonly kicker?: string;
  readonly slip?: ReactNode;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}): JSX.Element {
  const stamp = stampLabel(input.book);
  return (
    <article className={`book-panel${input.featured ? " book-panel--feature" : ""}`}>
      <div className="book-panel__head">
        {input.kicker ? <span className="book-panel__kicker">{input.kicker}</span> : <span />}
        <span className="book-panel__tags">
          <span className="catalog-no">{catalogNumber(input.book)}</span>
          <span className={`stamp${stamp.modifier}`} title={listLabel(input.book)}>
            {stamp.text}
          </span>
        </span>
      </div>
      <div className="book-panel__rule" />
      <h3 className="book-panel__title">{input.book.title || "無題"}</h3>
      <p className="book-panel__author">
        {input.book.author || "著者不明"}
        <span className="cho">著</span>
      </p>
      <p className="book-panel__desc">{input.book.description || "説明文はまだ取得されていません。"}</p>
      <ul className="book-panel__notes">
        {input.book.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="book-panel__actions">
        <a
          className="button-link button-link--bookmeter"
          href={input.book.bookmeterUrl}
          target="_blank"
          rel="noreferrer"
        >
          Bookmeter
        </a>
        <OpacLinks book={input.book} />
        {input.actionLabel && input.onAction ? <button onClick={input.onAction}>{input.actionLabel}</button> : null}
      </div>
      {input.slip}
    </article>
  );
}
