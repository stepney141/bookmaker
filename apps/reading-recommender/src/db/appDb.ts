import Database from "better-sqlite3";

import { DEFAULT_SETTINGS } from "../shared/settings";

import { APP_DB_MIGRATIONS } from "./migrations";


import type { AppSettings, BookSnapshot, SourceBook } from "../shared/types";

export type AppDb = {
  readonly db: Database.Database;
  readonly close: () => void;
};

type BookSnapshotRow = {
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
  readonly content_hash: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly last_scan_run_id: number;
};

type SettingRow = {
  readonly value_json: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function rowToSnapshot(row: BookSnapshotRow): BookSnapshot {
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
    contentHash: row.content_hash,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastScanRunId: row.last_scan_run_id
  };
}

export function openAppDb(dbPath: string): AppDb {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  for (const migration of APP_DB_MIGRATIONS) {
    db.exec(migration);
  }

  saveSettings(db, { ...DEFAULT_SETTINGS, ...loadSettings(db) });

  return {
    db,
    close() {
      db.close();
    }
  };
}

export function loadSettings(db: Database.Database): Partial<AppSettings> {
  const row = db.prepare("SELECT value_json FROM app_setting WHERE key = ?").get("settings") as SettingRow | undefined;

  if (!row) {
    return {};
  }

  const parsed = JSON.parse(row.value_json) as Partial<AppSettings>;
  return parsed;
}

export function saveSettings(db: Database.Database, settings: AppSettings): void {
  db.prepare(
    `INSERT INTO app_setting (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run("settings", JSON.stringify(settings), nowIso());
}

export function getSettings(db: Database.Database): AppSettings {
  return { ...DEFAULT_SETTINGS, ...loadSettings(db) };
}

export function getCurrentSnapshots(db: Database.Database): readonly BookSnapshot[] {
  const scanRun = db.prepare("SELECT id FROM scan_run ORDER BY id DESC LIMIT 1").get() as { readonly id: number } | undefined;

  if (!scanRun) {
    return [];
  }

  const rows = db
    .prepare("SELECT * FROM book_snapshot WHERE last_scan_run_id = ? ORDER BY in_stacked DESC, remote_rank ASC")
    .all(scanRun.id) as readonly BookSnapshotRow[];

  return rows.map(rowToSnapshot);
}

export function getSnapshotsByUrls(db: Database.Database, urls: readonly string[]): readonly BookSnapshot[] {
  if (urls.length === 0) {
    return [];
  }

  const placeholders = urls.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT * FROM book_snapshot WHERE bookmeter_url IN (${placeholders})`).all(...urls) as readonly BookSnapshotRow[];
  const byUrl = new Map(rows.map((row) => [row.bookmeter_url, rowToSnapshot(row)]));
  return urls.flatMap((url) => {
    const snapshot = byUrl.get(url);
    return snapshot ? [snapshot] : [];
  });
}

export function insertRecommendationEvent(input: {
  readonly db: Database.Database;
  readonly eventType: string;
  readonly bookmeterUrl: string | null;
  readonly cycleId: number | null;
  readonly reason: string;
  readonly payload: unknown;
}): void {
  input.db
    .prepare(
      `INSERT INTO recommendation_event (event_type, bookmeter_url, cycle_id, reason, created_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.eventType, input.bookmeterUrl, input.cycleId, input.reason, nowIso(), JSON.stringify(input.payload));
}

export function sourceBookToSnapshot(book: SourceBook, contentHash: string, firstSeenAt: string, scanRunId: number, timestamp: string): BookSnapshot {
  return {
    ...book,
    contentHash,
    firstSeenAt,
    lastSeenAt: timestamp,
    lastScanRunId: scanRunId
  };
}
