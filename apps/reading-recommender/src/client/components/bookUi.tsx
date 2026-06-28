import type { CurrentRecommendation, RecommendationBook, SearchResult } from "../../shared/types";
import type { JSX, KeyboardEvent } from "react";

export function listLabel(book: { readonly inStacked: boolean; readonly inWish: boolean }): string {
  if (book.inStacked && book.inWish) {
    return "積読本 / 読みたい本";
  }
  return book.inStacked ? "積読本" : "読みたい本";
}

export function libraryLabel(book: {
  readonly sophiaLibraryStatus: SearchResult["sophiaLibraryStatus"];
  readonly utokyoLibraryStatus: SearchResult["utokyoLibraryStatus"];
}): string {
  const availableLibraries = [
    book.utokyoLibraryStatus === "available" ? "東大" : null,
    book.sophiaLibraryStatus === "available" ? "上智" : null
  ].filter((label): label is string => label !== null);

  if (availableLibraries.length > 0) {
    return `${availableLibraries.join(" / ")}にあり`;
  }
  if (book.utokyoLibraryStatus === "unavailable" && book.sophiaLibraryStatus === "unavailable") {
    return "東大にも上智にもない";
  }
  return "所蔵確認中";
}

export function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

export function OpacLinks(input: {
  readonly book: {
    readonly sophiaOpacUrl: string;
    readonly utokyoOpacUrl: string;
  };
  readonly stopPropagation?: boolean;
}): JSX.Element | null {
  const links = [
    { label: "東大OPAC", url: input.book.utokyoOpacUrl.trim(), className: "button-link--utokyo" },
    { label: "上智OPAC", url: input.book.sophiaOpacUrl.trim(), className: "button-link--sophia" }
  ].filter((link) => link.url.length > 0);

  if (links.length === 0) {
    return null;
  }

  return (
    <div className="opac-links" aria-label="OPACリンク">
      {links.map((link) => (
        <a
          key={link.label}
          className={`button-link ${link.className}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          onClick={input.stopPropagation ? (event) => event.stopPropagation() : undefined}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

export function BookPanel(input: {
  readonly book: RecommendationBook;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}): JSX.Element {
  return (
    <article className="book-panel">
      <div className="book-panel__meta">
        <span>{listLabel(input.book)}</span>
        <span>score {input.book.score.toFixed(3)}</span>
      </div>
      <h3>{input.book.title || "無題"}</h3>
      <p className="book-panel__author">{input.book.author || "著者不明"}</p>
      <p>{input.book.description || "説明文はまだ取得されていません。"}</p>
      <ul>
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
    </article>
  );
}

export function BookDetailDialog(input: {
  readonly book: CurrentRecommendation["relatedBooks"][number] | SearchResult;
  readonly titleId: string;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={input.onClose}>
      <article
        className="book-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={input.titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="book-panel__meta">
          <span>{listLabel(input.book)}</span>
          <span>score {input.book.score.toFixed(3)}</span>
        </div>
        <h3 id={input.titleId}>{input.book.title || "無題"}</h3>
        <p className="book-panel__author">{input.book.author || "著者不明"}</p>
        <p>
          {input.book.publisher || "出版社不明"} / {input.book.publishedDate || "刊行日不明"}
        </p>
        <p>{libraryLabel(input.book)}</p>
        {input.book.isbnOrAsin ? <p>ISBN/ASIN {input.book.isbnOrAsin}</p> : null}
        <p>{input.book.description || "説明文はまだ取得されていません。"}</p>
        <ul>
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
          <button type="button" onClick={input.onClose}>
            閉じる
          </button>
        </div>
      </article>
    </div>
  );
}
