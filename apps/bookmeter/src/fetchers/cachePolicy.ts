/**
 * 既存キャッシュを再利用するかどうかの判定を純粋関数として定義する。
 * fetchers/index.ts から分離し、ユニットテストしやすくする。
 */

import type { Book } from "../domain/book";

const BIBLIO_FIELDS = ["book_title", "author", "publisher", "published_date"] as const;

function isMissingFieldValue(value: string): boolean {
  const trimmedValue = value.trim();

  return (
    trimmedValue === "" ||
    trimmedValue === "[object Object]" ||
    trimmedValue.startsWith("Not_found_in_") ||
    trimmedValue.endsWith("_API_Error") ||
    trimmedValue === "INVALID_ISBN"
  );
}

export function hasCompleteCachedBiblio(book: Book): boolean {
  return BIBLIO_FIELDS.every((fieldName) => !isMissingFieldValue(book[fieldName]));
}

export function shouldFetchBibliographicData(book: Book, refetch: boolean): boolean {
  if (refetch) {
    return true;
  }

  return !hasCompleteCachedBiblio(book);
}

export function shouldFetchLibraryHoldings(
  book: Book,
  refetch: boolean,
  cachedBookUrls: ReadonlySet<string>
): boolean {
  if (refetch) {
    return true;
  }

  return cachedBookUrls.has(book.bookmeter_url) !== true;
}
