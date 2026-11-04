import type { BookListKind, BookSnapshot, SourceBook } from "../../types/api";
import type { ScoredBook } from "../recommendation/scoring";

export type BookInput = Pick<SourceBook, "bookmeterUrl" | "title" | "remoteRank"> &
  Partial<
    Omit<
      SourceBook,
      | "bookmeterUrl"
      | "title"
      | "remoteRank"
      | "inWish"
      | "inStacked"
      | "wishRowid"
      | "stackedRowid"
      | "remoteRankSource"
    >
  >;

function bookInList(input: BookInput, list: BookListKind): SourceBook {
  return {
    isbnOrAsin: null,
    author: "",
    publisher: "",
    publishedDate: "",
    description: "",
    sophiaLibraryStatus: "unknown",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "",
    utokyoOpacUrl: "",
    ...input,
    inWish: list === "wish",
    inStacked: list === "stacked",
    wishRowid: list === "wish" ? input.remoteRank : null,
    stackedRowid: list === "stacked" ? input.remoteRank : null,
    remoteRankSource: list
  };
}

export function stackedBook(input: BookInput): SourceBook {
  return bookInList(input, "stacked");
}

export function wishBook(input: BookInput): SourceBook {
  return bookInList(input, "wish");
}

export function snapshotOf(
  book: SourceBook,
  overrides: Partial<Omit<BookSnapshot, keyof SourceBook>> = {}
): BookSnapshot {
  return {
    ...book,
    contentHash: "",
    firstSeenAt: "2024-01-01T00:00:00.000Z",
    lastSeenAt: "2024-01-01T00:00:00.000Z",
    lastScanRunId: 1,
    ...overrides
  };
}

export function scoredOf(book: SourceBook, score: number): ScoredBook {
  return { ...snapshotOf(book), score, scoreBreakdown: [], reasons: [] };
}
