import { useEffect, useRef } from "react";

import type { CurrentRecommendation, RecommendationBook, SearchResult } from "../../shared/types";
import type { JSX, KeyboardEvent, ReactNode } from "react";

export function listLabel(book: { readonly inStacked: boolean; readonly inWish: boolean }): string {
  if (book.inStacked && book.inWish) {
    return "積読本 / 読みたい本";
  }
  return book.inStacked ? "積読本" : "読みたい本";
}

export function catalogNumber(book: {
  readonly wishRowid: number | null;
  readonly stackedRowid: number | null;
  readonly remoteRank: number;
}): string {
  const source = book.stackedRowid ?? book.wishRowid ?? book.remoteRank;
  const value = Number.isFinite(source) ? Math.max(0, Math.trunc(source)) : 0;
  return `No. ${String(value).padStart(4, "0")}`;
}

export function stampLabel(book: { readonly inStacked: boolean }): {
  readonly text: string;
  readonly modifier: string;
} {
  return book.inStacked ? { text: "積読", modifier: "" } : { text: "読みたい", modifier: " stamp--wish" };
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

export function BookDetailDialog(input: {
  readonly book: CurrentRecommendation["relatedBooks"][number] | SearchResult;
  readonly titleId: string;
  readonly onClose: () => void;
}): JSX.Element {
  const stamp = stampLabel(input.book);
  const dialogRef = useRef<HTMLElement>(null);
  const onClose = input.onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || dialog === null) {
        return;
      }
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={input.onClose}>
      <article
        ref={dialogRef}
        className="book-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={input.titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="book-panel__head">
          <span className="book-panel__kicker">目録カード</span>
          <span className="book-panel__tags">
            <span className="catalog-no">{catalogNumber(input.book)}</span>
            <span className={`stamp${stamp.modifier}`} title={listLabel(input.book)}>
              {stamp.text}
            </span>
          </span>
        </div>
        <div className="book-panel__rule" />
        <h3 id={input.titleId} className="book-dialog__title">
          {input.book.title || "無題"}
        </h3>
        <p className="book-panel__author">
          {input.book.author || "著者不明"}
          <span className="cho">著</span>
        </p>
        <dl className="catalog-record">
          <div className="catalog-record__row">
            <dt>出版社</dt>
            <dd>{input.book.publisher || "不明"}</dd>
          </div>
          <div className="catalog-record__row">
            <dt>刊行</dt>
            <dd>{input.book.publishedDate || "不明"}</dd>
          </div>
          <div className="catalog-record__row">
            <dt>所蔵</dt>
            <dd>{libraryLabel(input.book)}</dd>
          </div>
          {input.book.isbnOrAsin ? (
            <div className="catalog-record__row">
              <dt>ISBN/ASIN</dt>
              <dd>{input.book.isbnOrAsin}</dd>
            </div>
          ) : null}
        </dl>
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
          <button type="button" onClick={input.onClose}>
            閉じる
          </button>
        </div>
      </article>
    </div>
  );
}
