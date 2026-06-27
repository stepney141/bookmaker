import type { SearchResult } from "../shared/types";
import type Database from "better-sqlite3";


type SearchRow = {
  readonly bookmeter_url: string;
  readonly rank_score: number;
};

type SnapshotRow = {
  readonly bookmeter_url: string;
  readonly isbn_or_asin: string | null;
  readonly book_title: string;
  readonly author: string;
  readonly publisher: string;
  readonly published_date: string;
  readonly description: string;
  readonly in_wish: number;
  readonly in_stacked: number;
  readonly wish_rowid: number | null;
  readonly stacked_rowid: number | null;
  readonly remote_rank: number;
  readonly remote_rank_source: "wish" | "stacked";
};

function normalizeQuery(query: string): string {
  return query.trim();
}

function escapeFtsQuery(query: string): string {
  return query.replace(/["]/gu, " ").trim();
}

function snippet(description: string, query: string): string {
  const normalized = normalizeQuery(query);

  if (description.length <= 160) {
    return description;
  }

  const index = normalized.length > 0 ? description.indexOf(normalized) : -1;
  const start = index >= 0 ? Math.max(0, index - 50) : 0;
  return `${description.slice(start, start + 160)}...`;
}

function rowToSearchResult(row: SnapshotRow, rank: number, score: number, query: string): SearchResult {
  const reasons = [
    row.book_title.includes(query) ? "タイトルに一致します。" : null,
    row.author.includes(query) ? "著者名に一致します。" : null,
    row.description.includes(query) ? "説明文に一致します。" : null,
    row.in_stacked === 1 ? "積読本に登録されています。" : "読みたい本に登録されています。"
  ].filter((reason): reason is string => reason !== null);

  return {
    bookmeterUrl: row.bookmeter_url,
    isbnOrAsin: row.isbn_or_asin,
    title: row.book_title,
    author: row.author,
    publisher: row.publisher,
    publishedDate: row.published_date,
    description: row.description,
    inWish: row.in_wish === 1,
    inStacked: row.in_stacked === 1,
    wishRowid: row.wish_rowid,
    stackedRowid: row.stacked_rowid,
    remoteRank: row.remote_rank,
    remoteRankSource: row.remote_rank_source,
    rank,
    score,
    reasons,
    snippet: snippet(row.description, query)
  };
}

export function searchBooks(input: {
  readonly db: Database.Database;
  readonly query: string;
  readonly limit: number;
}): readonly SearchResult[] {
  const query = normalizeQuery(input.query);

  if (query.length === 0) {
    return [];
  }

  const currentScanRun = input.db.prepare("SELECT id FROM scan_run ORDER BY id DESC LIMIT 1").get() as { readonly id: number } | undefined;

  if (!currentScanRun) {
    return [];
  }

  const ftsRows = input.db
    .prepare(
      `SELECT bookmeter_url, bm25(book_fts, 6.0, 3.0, 1.5, 1.0) AS rank_score
       FROM book_fts
       WHERE book_fts MATCH ?
       ORDER BY rank_score ASC
       LIMIT ?`
    )
    .all(escapeFtsQuery(query), input.limit * 2) as readonly SearchRow[];
  const likeRows = input.db
    .prepare(
      `SELECT bookmeter_url, 10.0 AS rank_score
       FROM book_snapshot
       WHERE last_scan_run_id = ?
         AND (book_title LIKE ? OR author LIKE ? OR isbn_or_asin LIKE ? OR description LIKE ?)
       LIMIT ?`
    )
    .all(currentScanRun.id, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, input.limit * 2) as readonly SearchRow[];
  const scores = new Map<string, number>();

  for (const row of [...ftsRows, ...likeRows]) {
    const existing = scores.get(row.bookmeter_url);
    scores.set(row.bookmeter_url, existing === undefined ? row.rank_score : Math.min(existing, row.rank_score));
  }

  const urls = [...scores.keys()].slice(0, input.limit * 2);

  if (urls.length === 0) {
    return [];
  }

  const placeholders = urls.map(() => "?").join(", ");
  const rows = input.db
    .prepare(`SELECT * FROM book_snapshot WHERE bookmeter_url IN (${placeholders}) AND last_scan_run_id = ?`)
    .all(...urls, currentScanRun.id) as readonly SnapshotRow[];
  const rowByUrl = new Map(rows.map((row) => [row.bookmeter_url, row]));

  return urls
    .flatMap((url) => {
      const row = rowByUrl.get(url);
      const score = scores.get(url);
      return row && score !== undefined ? [rowToSearchResult(row, 0, score, query)] : [];
    })
    .sort((a, b) => a.score - b.score || a.remoteRank - b.remoteRank)
    .slice(0, input.limit)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}
