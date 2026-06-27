import { sourceBookToSnapshot } from "./appDb";
import { sha256 } from "./hash";

import type { BookSnapshot, SourceBook } from "../shared/types";
import type Database from "better-sqlite3";

export type SourceSyncResult = {
  readonly scanRunId: number;
  readonly sourceHash: string;
  readonly wishCount: number;
  readonly stackedCount: number;
  readonly currentBooks: readonly BookSnapshot[];
};

type ScanRunHashRow = {
  readonly source_hash: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function createContentHash(book: SourceBook): string {
  return sha256([
    book.bookmeterUrl,
    book.isbnOrAsin,
    book.title,
    book.author,
    book.publisher,
    book.publishedDate,
    book.description,
    book.inWish,
    book.inStacked,
    book.sophiaLibraryStatus,
    book.utokyoLibraryStatus,
    book.sophiaOpacUrl,
    book.utokyoOpacUrl,
    book.remoteRank,
    book.remoteRankSource
  ]);
}

function createSourceHash(books: readonly SourceBook[]): string {
  return sha256(
    books.flatMap((book) => [book.bookmeterUrl, createContentHash(book), book.remoteRank, book.remoteRankSource])
  );
}

function getLatestSourceHash(db: Database.Database): string | null {
  const row = db.prepare("SELECT source_hash FROM scan_run ORDER BY id DESC LIMIT 1").get() as
    | ScanRunHashRow
    | undefined;
  return row?.source_hash ?? null;
}

function getExistingFirstSeenAt(db: Database.Database, bookmeterUrl: string, fallback: string): string {
  const row = db.prepare("SELECT first_seen_at FROM book_snapshot WHERE bookmeter_url = ?").get(bookmeterUrl) as
    | { readonly first_seen_at: string }
    | undefined;
  return row?.first_seen_at ?? fallback;
}

function replaceFtsRow(db: Database.Database, book: BookSnapshot): void {
  db.prepare("DELETE FROM book_fts WHERE bookmeter_url = ?").run(book.bookmeterUrl);
  db.prepare(
    `INSERT INTO book_fts (bookmeter_url, book_title, author, publisher, description)
     VALUES (?, ?, ?, ?, ?)`
  ).run(book.bookmeterUrl, book.title, book.author, book.publisher, book.description);
}

function upsertSnapshot(db: Database.Database, book: BookSnapshot): void {
  db.prepare(
    `INSERT INTO book_snapshot (
      bookmeter_url,
      isbn_or_asin,
      book_title,
      author,
      publisher,
      published_date,
      description,
      in_wish,
      in_stacked,
      sophia_library_status,
      utokyo_library_status,
      sophia_opac_url,
      utokyo_opac_url,
      wish_rowid,
      stacked_rowid,
      remote_rank,
      remote_rank_source,
      content_hash,
      first_seen_at,
      last_seen_at,
      last_scan_run_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bookmeter_url) DO UPDATE SET
      isbn_or_asin = excluded.isbn_or_asin,
      book_title = excluded.book_title,
      author = excluded.author,
      publisher = excluded.publisher,
      published_date = excluded.published_date,
      description = excluded.description,
      in_wish = excluded.in_wish,
      in_stacked = excluded.in_stacked,
      sophia_library_status = excluded.sophia_library_status,
      utokyo_library_status = excluded.utokyo_library_status,
      sophia_opac_url = excluded.sophia_opac_url,
      utokyo_opac_url = excluded.utokyo_opac_url,
      wish_rowid = excluded.wish_rowid,
      stacked_rowid = excluded.stacked_rowid,
      remote_rank = excluded.remote_rank,
      remote_rank_source = excluded.remote_rank_source,
      content_hash = excluded.content_hash,
      last_seen_at = excluded.last_seen_at,
      last_scan_run_id = excluded.last_scan_run_id`
  ).run(
    book.bookmeterUrl,
    book.isbnOrAsin,
    book.title,
    book.author,
    book.publisher,
    book.publishedDate,
    book.description,
    book.inWish ? 1 : 0,
    book.inStacked ? 1 : 0,
    book.sophiaLibraryStatus,
    book.utokyoLibraryStatus,
    book.sophiaOpacUrl,
    book.utokyoOpacUrl,
    book.wishRowid,
    book.stackedRowid,
    book.remoteRank,
    book.remoteRankSource,
    book.contentHash,
    book.firstSeenAt,
    book.lastSeenAt,
    book.lastScanRunId
  );
}

export function syncSourceBooks(input: {
  readonly db: Database.Database;
  readonly booksDbPath: string;
  readonly sourceBooks: readonly SourceBook[];
}): SourceSyncResult {
  const timestamp = nowIso();
  const sourceHash = createSourceHash(input.sourceBooks);
  const wishCount = input.sourceBooks.filter((book) => book.inWish).length;
  const stackedCount = input.sourceBooks.filter((book) => book.inStacked).length;

  const transaction = input.db.transaction(() => {
    const scanRun = input.db
      .prepare(
        `INSERT INTO scan_run (started_at, finished_at, books_db_path, source_hash, wish_count, stacked_count)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(timestamp, timestamp, input.booksDbPath, sourceHash, wishCount, stackedCount);
    const scanRunId = Number(scanRun.lastInsertRowid);

    const snapshots = input.sourceBooks.map((book) => {
      const contentHash = createContentHash(book);
      const firstSeenAt = getExistingFirstSeenAt(input.db, book.bookmeterUrl, timestamp);
      return sourceBookToSnapshot(book, contentHash, firstSeenAt, scanRunId, timestamp);
    });

    for (const snapshot of snapshots) {
      const existing = input.db
        .prepare("SELECT content_hash FROM book_snapshot WHERE bookmeter_url = ?")
        .get(snapshot.bookmeterUrl) as { readonly content_hash: string } | undefined;
      upsertSnapshot(input.db, snapshot);

      if (existing?.content_hash !== snapshot.contentHash) {
        replaceFtsRow(input.db, snapshot);
      }
    }

    return {
      scanRunId,
      sourceHash,
      wishCount,
      stackedCount,
      currentBooks: snapshots
    };
  });

  return transaction();
}

export function syncSourceBooksIfChanged(input: {
  readonly db: Database.Database;
  readonly booksDbPath: string;
  readonly sourceBooks: readonly SourceBook[];
}): SourceSyncResult | null {
  const sourceHash = createSourceHash(input.sourceBooks);
  const latestSourceHash = getLatestSourceHash(input.db);

  if (latestSourceHash === sourceHash) {
    return null;
  }

  return syncSourceBooks(input);
}
