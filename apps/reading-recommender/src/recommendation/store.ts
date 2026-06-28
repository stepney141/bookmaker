
import { getSnapshotsByUrls, insertRecommendationEvent } from "../db/appDb";

import type { CurrentRecommendation, RecommendationBook, RecommendationSlot, RelatedBook, ScoreContribution } from "../shared/types";
import type Database from "better-sqlite3";

type CycleRow = {
  readonly id: number;
  readonly status: string;
  readonly reason: string;
  readonly created_at: string;
};

type ItemRow = {
  readonly cycle_id: number;
  readonly slot: RecommendationSlot;
  readonly rank: number;
  readonly bookmeter_url: string;
  readonly score: number;
  readonly score_breakdown_json: string;
  readonly explanation_json: string;
};

export type RecommendationSelection = {
  readonly primary: RecommendationBook;
  readonly secondaries: readonly RecommendationBook[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseBreakdown(value: string): readonly ScoreContribution[] {
  return JSON.parse(value) as readonly ScoreContribution[];
}

function parseReasons(value: string): readonly string[] {
  return JSON.parse(value) as readonly string[];
}

export function getActiveCycleId(db: Database.Database): number | null {
  const row = db.prepare("SELECT id FROM recommendation_cycle WHERE status = ? ORDER BY id DESC LIMIT 1").get("active") as
    | { readonly id: number }
    | undefined;
  return row?.id ?? null;
}

export function getLatestScheduledFor(db: Database.Database): string | null {
  const row = db
    .prepare(
      `SELECT scheduled_for
       FROM recommendation_cycle
       WHERE reason = ? AND scheduled_for IS NOT NULL
       ORDER BY scheduled_for DESC
       LIMIT 1`
    )
    .get("scheduled") as { readonly scheduled_for: string } | undefined;
  return row?.scheduled_for ?? null;
}

export function hasScheduledCycle(db: Database.Database, scheduledFor: string): boolean {
  const row = db
    .prepare(
      `SELECT id
       FROM recommendation_cycle
       WHERE reason = ? AND scheduled_for = ?
       LIMIT 1`
    )
    .get("scheduled", scheduledFor) as { readonly id: number } | undefined;
  return Boolean(row);
}

export function getCurrentRecommendation(input: {
  readonly db: Database.Database;
  readonly relatedBooks: readonly RelatedBook[];
}): CurrentRecommendation | null {
  const cycle = input.db
    .prepare("SELECT id, status, reason, created_at FROM recommendation_cycle WHERE status = ? ORDER BY id DESC LIMIT 1")
    .get("active") as CycleRow | undefined;

  if (!cycle) {
    return null;
  }

  const itemRows = input.db
    .prepare("SELECT * FROM recommendation_item WHERE cycle_id = ? ORDER BY slot ASC, rank ASC")
    .all(cycle.id) as readonly ItemRow[];
  const snapshots = getSnapshotsByUrls(
    input.db,
    itemRows.map((item) => item.bookmeter_url)
  );
  const snapshotsByUrl = new Map(snapshots.map((snapshot) => [snapshot.bookmeterUrl, snapshot]));
  const books = itemRows.flatMap((item) => {
    const snapshot = snapshotsByUrl.get(item.bookmeter_url);

    if (!snapshot) {
      return [];
    }

    return [
      {
        ...snapshot,
        score: item.score,
        scoreBreakdown: parseBreakdown(item.score_breakdown_json),
        reasons: parseReasons(item.explanation_json)
      }
    ];
  });

  return {
    cycleId: cycle.id,
    status: cycle.status,
    reason: cycle.reason,
    createdAt: cycle.created_at,
    primary: books.find((book) => itemRows.find((item) => item.bookmeter_url === book.bookmeterUrl)?.slot === "primary") ?? null,
    secondaries: books.filter((book) => itemRows.find((item) => item.bookmeter_url === book.bookmeterUrl)?.slot === "secondary"),
    relatedBooks: input.relatedBooks
  };
}

export function saveRecommendationSelection(input: {
  readonly db: Database.Database;
  readonly reason: string;
  readonly selection: RecommendationSelection;
  readonly scheduledFor?: string | null;
}): number {
  const transaction = input.db.transaction(() => {
    input.db.prepare("UPDATE recommendation_cycle SET status = ? WHERE status = ?").run("superseded", "active");
    const cycle = input.db
      .prepare("INSERT INTO recommendation_cycle (status, reason, scheduled_for, created_at, activated_at) VALUES (?, ?, ?, ?, ?)")
      .run("active", input.reason, input.scheduledFor ?? null, nowIso(), nowIso());
    const cycleId = Number(cycle.lastInsertRowid);
    const items = [
      { slot: "primary" as const, rank: 1, book: input.selection.primary },
      ...input.selection.secondaries.map((book, index) => ({ slot: "secondary" as const, rank: index + 1, book }))
    ];

    for (const item of items) {
      input.db
        .prepare(
          `INSERT INTO recommendation_item (cycle_id, slot, rank, bookmeter_url, score, score_breakdown_json, explanation_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          cycleId,
          item.slot,
          item.rank,
          item.book.bookmeterUrl,
          item.book.score,
          JSON.stringify(item.book.scoreBreakdown),
          JSON.stringify(item.book.reasons)
        );
    }

    insertRecommendationEvent({
      db: input.db,
      eventType: "recommendation_created",
      bookmeterUrl: input.selection.primary.bookmeterUrl,
      cycleId,
      reason: input.reason,
      payload: { primary: input.selection.primary.bookmeterUrl, secondaries: input.selection.secondaries.map((book) => book.bookmeterUrl) }
    });

    return cycleId;
  });

  return transaction();
}
