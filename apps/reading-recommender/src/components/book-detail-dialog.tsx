import { useEffect, useRef } from "react";

import { catalogNumber, libraryLabel, listLabel, stampLabel } from "@/utils/book-labels";

import { OpacLinks } from "./opac-links";

import type { SourceBook } from "@/types/api";
import type { JSX } from "react";

export function BookDetailDialog(input: {
  readonly book: SourceBook;
  readonly reasons: readonly string[];
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
          {input.reasons.map((reason) => (
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
