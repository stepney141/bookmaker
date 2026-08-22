import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getSettings, openAppDb } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";

import { randomizeRecommendation, runRecommendation, selectWeightedCandidate } from "./engine";
import { getCurrentRecommendation } from "./store";

import type { ScoredBook } from "./scoring";
import type { SourceBook } from "../shared/types";

function book(input: Partial<SourceBook> & Pick<SourceBook, "bookmeterUrl" | "title" | "remoteRank">): SourceBook {
  return {
    isbnOrAsin: null,
    author: "著者",
    publisher: "出版社",
    publishedDate: "2024",
    description: "説明文があります。",
    inWish: false,
    inStacked: true,
    sophiaLibraryStatus: "unknown",
    utokyoLibraryStatus: "unknown",
    sophiaOpacUrl: "",
    utokyoOpacUrl: "",
    wishRowid: null,
    stackedRowid: input.remoteRank,
    remoteRankSource: "stacked",
    ...input
  };
}

function scoredBook(input: Partial<SourceBook> & Pick<SourceBook, "bookmeterUrl" | "title" | "remoteRank"> & {
  readonly score: number;
}): ScoredBook {
  return {
    ...book(input),
    contentHash: "hash",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    lastScanRunId: 1,
    score: input.score,
    scoreBreakdown: [],
    reasons: []
  };
}

describe("recommendation engine", () => {
  it("selects candidates in score-proportional intervals", () => {
    const weightedCandidates = [
      {
        book: scoredBook({ bookmeterUrl: "lighter", title: "軽い候補", remoteRank: 1, score: 1 }),
        weight: 0.25
      },
      {
        book: scoredBook({ bookmeterUrl: "heavier", title: "重い候補", remoteRank: 2, score: 1 }),
        weight: 0.75
      }
    ];

    expect(selectWeightedCandidate({ candidates: weightedCandidates, randomValue: 0.249 })?.bookmeterUrl).toBe("lighter");
    expect(selectWeightedCandidate({ candidates: weightedCandidates, randomValue: 0.25 })?.bookmeterUrl).toBe("heavier");
  });

  it("rejects invalid random values and explicit weights", () => {
    const candidate = scoredBook({ bookmeterUrl: "candidate", title: "候補", remoteRank: 1, score: 1 });

    expect(selectWeightedCandidate({ candidates: [], randomValue: 0.5 })).toBeNull();
    expect(selectWeightedCandidate({ candidates: [{ book: candidate, weight: 1 }], randomValue: -0.1 })).toBeNull();
    expect(selectWeightedCandidate({ candidates: [{ book: candidate, weight: 1 }], randomValue: 1 })).toBeNull();
    expect(selectWeightedCandidate({ candidates: [{ book: candidate, weight: 0 }], randomValue: 0.5 })).toBeNull();
    expect(
      selectWeightedCandidate({ candidates: [{ book: candidate, weight: Number.NaN }], randomValue: 0.5 })
    ).toBeNull();
    expect(
      selectWeightedCandidate({
        candidates: [{ book: candidate, weight: Number.POSITIVE_INFINITY }],
        randomValue: 0.5
      })
    ).toBeNull();
  });

  it("keeps the active primary while it remains in the current source set", () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-"));
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const books = [
      book({ bookmeterUrl: "book-1", title: "古い積読", remoteRank: 10 }),
      book({ bookmeterUrl: "book-2", title: "新しい積読", remoteRank: 1 }),
      book({ bookmeterUrl: "book-3", title: "別の積読", remoteRank: 2 })
    ];

    try {
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
      runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
      const first = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: [...books].reverse() });
      runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "scheduled" });
      const second = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

      expect(first?.primary?.bookmeterUrl).toBe("book-1");
      expect(second?.primary?.bookmeterUrl).toBe("book-1");
    } finally {
      appDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a new primary when the active primary disappears from the source set", () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-"));
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const books = [
      book({ bookmeterUrl: "book-1", title: "古い積読", remoteRank: 10 }),
      book({ bookmeterUrl: "book-2", title: "次の積読", remoteRank: 9 }),
      book({ bookmeterUrl: "book-3", title: "別の積読", remoteRank: 1 })
    ];

    try {
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
      runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books.slice(1) });
      runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "source_changed" });
      const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
      const completionEvent = appDb.db
        .prepare("SELECT event_type FROM recommendation_event WHERE event_type = ?")
        .get("primary_completed_by_db_absence") as { readonly event_type: string } | undefined;

      expect(current?.primary?.bookmeterUrl).toBe("book-2");
      expect(completionEvent?.event_type).toBe("primary_completed_by_db_absence");
    } finally {
      appDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces an active later volume when an earlier volume from the same series is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-"));
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const lower = book({
      bookmeterUrl: "lower",
      title: "美味礼讃 下 (岩波文庫)",
      remoteRank: 20
    });
    const upper = book({
      bookmeterUrl: "upper",
      title: "美味礼讃　上",
      remoteRank: 10
    });

    try {
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: [lower] });
      runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: [lower, upper] });
      runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "scheduled" });
      const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
      const replacementEvent = appDb.db
        .prepare("SELECT event_type FROM recommendation_event WHERE event_type = ?")
        .get("primary_replaced_by_series_predecessor") as { readonly event_type: string } | undefined;

      expect(current?.primary?.bookmeterUrl).toBe("upper");
      expect(replacementEvent?.event_type).toBe("primary_replaced_by_series_predecessor");
    } finally {
      appDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("randomizes outside the displayed set and excludes later series volumes while preserving the cycle", () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-"));
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const books = [
      book({ bookmeterUrl: "current-primary", title: "現在の主推薦", remoteRank: 100 }),
      book({ bookmeterUrl: "current-secondary-1", title: "現在の副推薦1", remoteRank: 90 }),
      book({ bookmeterUrl: "current-secondary-2", title: "現在の副推薦2", remoteRank: 80 }),
      book({ bookmeterUrl: "later-volume", title: "解析入門 2巻", remoteRank: 70 }),
      book({ bookmeterUrl: "earlier-volume", title: "解析入門 1巻", remoteRank: 1 }),
      book({ bookmeterUrl: "other", title: "別の候補", remoteRank: 60 })
    ];

    try {
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
      const settings = getSettings(appDb.db);
      runRecommendation({ db: appDb.db, settings, reason: "initial" });
      const before = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
      const result = randomizeRecommendation({ db: appDb.db, settings, randomValue: 0 });
      const after = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
      const event = appDb.db
        .prepare("SELECT cycle_id, payload_json FROM recommendation_event WHERE event_type = ?")
        .get("primary_randomized") as { readonly cycle_id: number; readonly payload_json: string } | undefined;
      const payload = JSON.parse(event?.payload_json ?? "null") as {
        readonly previous: { readonly primary: string; readonly secondaries: readonly string[] };
        readonly next: { readonly primary: string; readonly secondaries: readonly string[] };
        readonly eligibleCount: number;
      };

      expect(result).toEqual({ status: "selected", cycleId: before?.cycleId });
      expect(after?.cycleId).toBe(before?.cycleId);
      expect(after?.createdAt).toBe(before?.createdAt);
      expect(after?.reason).toBe(before?.reason);
      expect(after?.primary?.bookmeterUrl).toBe("earlier-volume");
      expect(after?.primary?.bookmeterUrl).not.toBe("later-volume");
      expect(after?.secondaries.map((item) => item.bookmeterUrl)).toEqual(["current-primary", "current-secondary-1"]);
      expect(event?.cycle_id).toBe(before?.cycleId);
      expect(payload).toEqual({
        previous: {
          primary: "current-primary",
          secondaries: ["current-secondary-1", "current-secondary-2"]
        },
        next: {
          primary: "earlier-volume",
          secondaries: ["current-primary", "current-secondary-1"]
        },
        eligibleCount: 2
      });
    } finally {
      appDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("randomizes mixed eligible candidates with an 80% stacked and 20% wish tier share", () => {
    const books = [
      book({ bookmeterUrl: "stacked-1", title: "積読本1", remoteRank: 100 }),
      book({ bookmeterUrl: "stacked-2", title: "積読本2", remoteRank: 90 }),
      book({ bookmeterUrl: "stacked-3", title: "積読本3", remoteRank: 80 }),
      book({ bookmeterUrl: "eligible-stacked", title: "抽出対象の積読本", remoteRank: 70 }),
      book({
        bookmeterUrl: "eligible-wish",
        title: "抽出対象の読みたい本",
        remoteRank: 1,
        inWish: true,
        inStacked: false,
        wishRowid: 1,
        stackedRowid: null,
        remoteRankSource: "wish"
      })
    ];

    function selectAt(randomValue: number): {
      readonly primaryUrl: string | null;
      readonly eligibleCount: number | null;
    } {
      const dir = mkdtempSync(join(tmpdir(), "reading-recommender-"));
      const appDb = openAppDb(join(dir, "app.sqlite"));

      try {
        syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
        const settings = getSettings(appDb.db);
        runRecommendation({ db: appDb.db, settings, reason: "initial" });
        randomizeRecommendation({ db: appDb.db, settings, randomValue });
        const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
        const event = appDb.db
          .prepare("SELECT payload_json FROM recommendation_event WHERE event_type = ?")
          .get("primary_randomized") as { readonly payload_json: string } | undefined;
        const payload = JSON.parse(event?.payload_json ?? "null") as { readonly eligibleCount: number } | null;

        return {
          primaryUrl: current?.primary?.bookmeterUrl ?? null,
          eligibleCount: payload?.eligibleCount ?? null
        };
      } finally {
        appDb.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }

    expect(selectAt(0.5)).toEqual({ primaryUrl: "eligible-stacked", eligibleCount: 2 });
    expect(selectAt(0.9)).toEqual({ primaryUrl: "eligible-wish", eligibleCount: 2 });
  });

  it("falls back to a wish book when no eligible stacked book remains", () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-"));
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const books = [
      book({ bookmeterUrl: "stacked-1", title: "積読本1", remoteRank: 100 }),
      book({ bookmeterUrl: "stacked-2", title: "積読本2", remoteRank: 90 }),
      book({ bookmeterUrl: "stacked-3", title: "積読本3", remoteRank: 80 }),
      book({
        bookmeterUrl: "eligible-wish",
        title: "抽出対象の読みたい本",
        remoteRank: 1,
        inWish: true,
        inStacked: false,
        wishRowid: 1,
        stackedRowid: null,
        remoteRankSource: "wish"
      })
    ];

    try {
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
      const settings = getSettings(appDb.db);
      runRecommendation({ db: appDb.db, settings, reason: "initial" });
      const result = randomizeRecommendation({ db: appDb.db, settings, randomValue: 0.999 });
      const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

      expect(result.status).toBe("selected");
      expect(current?.primary?.bookmeterUrl).toBe("eligible-wish");
    } finally {
      appDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not mutate the active cycle when no random candidate remains", () => {
    const dir = mkdtempSync(join(tmpdir(), "reading-recommender-"));
    const appDb = openAppDb(join(dir, "app.sqlite"));
    const books = [
      book({ bookmeterUrl: "book-1", title: "候補1", remoteRank: 3 }),
      book({ bookmeterUrl: "book-2", title: "候補2", remoteRank: 2 }),
      book({ bookmeterUrl: "book-3", title: "候補3", remoteRank: 1 })
    ];

    try {
      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
      const settings = getSettings(appDb.db);
      runRecommendation({ db: appDb.db, settings, reason: "initial" });
      const before = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
      const eventCountBefore = appDb.db.prepare("SELECT COUNT(*) AS count FROM recommendation_event").get() as {
        readonly count: number;
      };
      const result = randomizeRecommendation({ db: appDb.db, settings, randomValue: 0.5 });
      const after = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
      const eventCountAfter = appDb.db.prepare("SELECT COUNT(*) AS count FROM recommendation_event").get() as {
        readonly count: number;
      };

      expect(result).toEqual({ status: "no_random_candidate" });
      expect(after).toEqual(before);
      expect(eventCountAfter.count).toBe(eventCountBefore.count);
    } finally {
      appDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
