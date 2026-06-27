import Database from "better-sqlite3";

import type { BookListKind, SourceBook, SourceOrderRow } from "../shared/types";

type SourceRow = {
  readonly source_rowid: number;
  readonly bookmeter_url: string;
  readonly isbn_or_asin: string | null;
  readonly book_title: string | null;
  readonly author: string | null;
  readonly publisher: string | null;
  readonly published_date: string | null;
  readonly description: string | null;
};

export type SourceBooksRepository = {
  readonly loadCurrentBooks: () => readonly SourceBook[];
  readonly loadRowOrderDiagnostics: (limit: number) => readonly {
    readonly tableName: BookListKind;
    readonly firstRows: readonly SourceOrderRow[];
    readonly lastRows: readonly SourceOrderRow[];
  }[];
  readonly close: () => void;
};

function normalizeText(value: string | null): string {
  return value?.trim() ?? "";
}

function rowToPartialBook(row: SourceRow, listKind: BookListKind): SourceBook {
  const rowid = row.source_rowid;

  return {
    bookmeterUrl: row.bookmeter_url,
    isbnOrAsin: row.isbn_or_asin,
    title: normalizeText(row.book_title),
    author: normalizeText(row.author),
    publisher: normalizeText(row.publisher),
    publishedDate: normalizeText(row.published_date),
    description: normalizeText(row.description),
    inWish: listKind === "wish",
    inStacked: listKind === "stacked",
    wishRowid: listKind === "wish" ? rowid : null,
    stackedRowid: listKind === "stacked" ? rowid : null,
    remoteRank: rowid,
    remoteRankSource: listKind
  };
}

function mergeBooks(existing: SourceBook, incoming: SourceBook): SourceBook {
  const inStacked = existing.inStacked || incoming.inStacked;
  const stackedRowid = existing.stackedRowid ?? incoming.stackedRowid;
  const wishRowid = existing.wishRowid ?? incoming.wishRowid;
  const remoteRankSource = inStacked ? "stacked" : "wish";
  const remoteRank = remoteRankSource === "stacked" ? (stackedRowid ?? incoming.remoteRank) : (wishRowid ?? incoming.remoteRank);

  return {
    ...existing,
    isbnOrAsin: existing.isbnOrAsin ?? incoming.isbnOrAsin,
    title: existing.title || incoming.title,
    author: existing.author || incoming.author,
    publisher: existing.publisher || incoming.publisher,
    publishedDate: existing.publishedDate || incoming.publishedDate,
    description: existing.description || incoming.description,
    inWish: existing.inWish || incoming.inWish,
    inStacked,
    wishRowid,
    stackedRowid,
    remoteRank,
    remoteRankSource
  };
}

function selectRows(db: Database.Database, tableName: BookListKind): readonly SourceRow[] {
  return db
    .prepare(
      `SELECT
        rowid AS source_rowid,
        bookmeter_url,
        isbn_or_asin,
        book_title,
        author,
        publisher,
        published_date,
        description
      FROM ${tableName}
      ORDER BY rowid ASC`
    )
    .all() as readonly SourceRow[];
}

function selectOrderRows(db: Database.Database, tableName: BookListKind, direction: "ASC" | "DESC", limit: number): readonly SourceOrderRow[] {
  const rows = db
    .prepare(
      `SELECT
        rowid,
        bookmeter_url,
        book_title,
        author
      FROM ${tableName}
      ORDER BY rowid ${direction}
      LIMIT ?`
    )
    .all(limit) as readonly {
    readonly rowid: number;
    readonly bookmeter_url: string;
    readonly book_title: string | null;
    readonly author: string | null;
  }[];

  const orderedRows = direction === "DESC" ? [...rows].reverse() : rows;

  return orderedRows.map((row) => ({
    rowid: row.rowid,
    bookmeterUrl: row.bookmeter_url,
    title: normalizeText(row.book_title),
    author: normalizeText(row.author)
  }));
}

export function createSourceBooksRepository(dbPath: string): SourceBooksRepository {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  return {
    loadCurrentBooks() {
      const booksByUrl = new Map<string, SourceBook>();

      for (const tableName of ["wish", "stacked"] as const) {
        for (const row of selectRows(db, tableName)) {
          const incoming = rowToPartialBook(row, tableName);
          const existing = booksByUrl.get(incoming.bookmeterUrl);
          booksByUrl.set(incoming.bookmeterUrl, existing ? mergeBooks(existing, incoming) : incoming);
        }
      }

      return [...booksByUrl.values()].sort((a, b) => {
        if (a.remoteRankSource !== b.remoteRankSource) {
          return a.remoteRankSource === "stacked" ? -1 : 1;
        }
        return a.remoteRank - b.remoteRank;
      });
    },

    loadRowOrderDiagnostics(limit) {
      return (["wish", "stacked"] as const).map((tableName) => ({
        tableName,
        firstRows: selectOrderRows(db, tableName, "ASC", limit),
        lastRows: selectOrderRows(db, tableName, "DESC", limit)
      }));
    },

    close() {
      db.close();
    }
  };
}
