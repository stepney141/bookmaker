import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getSettings, openAppDb } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";

import { runRecommendation } from "./engine";
import { getCurrentRecommendation } from "./store";

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

describe("recommendation engine", () => {
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
});
