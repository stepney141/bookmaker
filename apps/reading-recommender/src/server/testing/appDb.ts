import { onTestFinished } from "vitest";

import { openAppDb } from "../db/appDb";

import type { AppDb } from "../db/appDb";
import type Database from "better-sqlite3";

export type RecommendationEvent = {
  readonly eventType: string;
  readonly bookmeterUrl: string | null;
  readonly cycleId: number | null;
  readonly reason: string;
  readonly payload: unknown;
};

export function openTestAppDb(): AppDb {
  const appDb = openAppDb(":memory:");
  onTestFinished(() => appDb.close());
  return appDb;
}

export function readRecommendationEvents(
  db: Database.Database,
  types: readonly string[]
): readonly RecommendationEvent[] {
  const where = types.length === 0 ? "" : `WHERE event_type IN (${types.map(() => "?").join(", ")})`;
  const rows = db
    .prepare(
      `SELECT event_type AS eventType, bookmeter_url AS bookmeterUrl, cycle_id AS cycleId, reason, payload_json
       FROM recommendation_event ${where} ORDER BY id`
    )
    .all(...types) as readonly (Omit<RecommendationEvent, "payload"> & { readonly payload_json: string })[];

  return rows.map(({ payload_json, ...event }) => ({
    ...event,
    payload: JSON.parse(payload_json) as unknown
  }));
}
