import { describe, expect, it } from "vitest";

import { getSettings } from "../db/appDb";
import { syncSourceBooks } from "../db/sync";
import { openTestAppDb, readRecommendationEvents } from "../testing/appDb";
import { scoredOf, stackedBook, wishBook } from "../testing/books";

import { promoteRecommendation, randomizeRecommendation, runRecommendation, selectWeightedCandidate } from "./engine";
import { getCurrentRecommendation } from "./store";

describe("recommendation engine", () => {
  it("selects candidates in score-proportional intervals", () => {
    const weightedCandidates = [
      {
        book: scoredOf(stackedBook({ bookmeterUrl: "lighter", title: "軽い候補", remoteRank: 1 }), 1),
        weight: 0.25
      },
      {
        book: scoredOf(stackedBook({ bookmeterUrl: "heavier", title: "重い候補", remoteRank: 2 }), 1),
        weight: 0.75
      }
    ];

    expect(selectWeightedCandidate({ candidates: weightedCandidates, randomValue: 0.249 })?.bookmeterUrl).toBe(
      "lighter"
    );
    expect(selectWeightedCandidate({ candidates: weightedCandidates, randomValue: 0.25 })?.bookmeterUrl).toBe(
      "heavier"
    );
  });

  it("rejects invalid random values and explicit weights", () => {
    const candidate = scoredOf(stackedBook({ bookmeterUrl: "candidate", title: "候補", remoteRank: 1 }), 1);

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

  it("keeps the active primary when a higher-ranked book is added to both source lists", () => {
    const appDb = openTestAppDb();
    const books = [
      stackedBook({ bookmeterUrl: "book-1", title: "古い積読", remoteRank: 10 }),
      stackedBook({ bookmeterUrl: "book-2", title: "新しい積読", remoteRank: 1 }),
      stackedBook({ bookmeterUrl: "book-3", title: "別の積読", remoteRank: 2 })
    ];
    const higherRanked = {
      ...stackedBook({ bookmeterUrl: "higher-ranked", title: "順位が上の本", remoteRank: 100 }),
      inWish: true,
      wishRowid: 1
    };

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
    const first = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: [...books, higherRanked] });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "scheduled" });
    const second = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

    expect(first?.primary?.bookmeterUrl).toBe("book-1");
    expect(second?.primary?.bookmeterUrl).toBe("book-1");
  });

  it("creates a new primary when the active primary disappears from the source set", () => {
    const appDb = openTestAppDb();
    const books = [
      stackedBook({ bookmeterUrl: "book-1", title: "古い積読", remoteRank: 10 }),
      stackedBook({ bookmeterUrl: "book-2", title: "次の積読", remoteRank: 9 }),
      stackedBook({ bookmeterUrl: "book-3", title: "別の積読", remoteRank: 1 })
    ];

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books.slice(1) });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "source_changed" });
    const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

    expect(current?.primary?.bookmeterUrl).toBe("book-2");
    expect(readRecommendationEvents(appDb.db, ["primary_completed_by_db_absence"])).toMatchObject([
      { eventType: "primary_completed_by_db_absence", bookmeterUrl: "book-1" }
    ]);
  });

  it("replaces an active later volume when an earlier volume from the same series is available", () => {
    const appDb = openTestAppDb();
    const lower = stackedBook({
      bookmeterUrl: "lower",
      title: "美味礼讃 下 (岩波文庫)",
      author: "ブリア＝サヴァラン",
      remoteRank: 20
    });
    const upper = stackedBook({
      bookmeterUrl: "upper",
      title: "美味礼讃　上",
      author: "ブリア＝サヴァラン",
      remoteRank: 10
    });

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: [lower] });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: [lower, upper] });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "scheduled" });
    const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

    expect(current?.primary?.bookmeterUrl).toBe("upper");
    expect(readRecommendationEvents(appDb.db, ["primary_replaced_by_series_predecessor"])).toMatchObject([
      { eventType: "primary_replaced_by_series_predecessor" }
    ]);
  });

  it("randomizes outside the displayed set and excludes later series volumes while preserving the cycle", () => {
    const appDb = openTestAppDb();
    const books = [
      stackedBook({ bookmeterUrl: "current-primary", title: "現在の主推薦", remoteRank: 100 }),
      stackedBook({ bookmeterUrl: "current-secondary-1", title: "現在の副推薦1", remoteRank: 90 }),
      stackedBook({ bookmeterUrl: "current-secondary-2", title: "現在の副推薦2", remoteRank: 80 }),
      stackedBook({ bookmeterUrl: "later-volume", title: "解析入門 2巻", author: "解析の著者", remoteRank: 70 }),
      stackedBook({ bookmeterUrl: "earlier-volume", title: "解析入門 1巻", author: "解析の著者", remoteRank: 1 }),
      stackedBook({ bookmeterUrl: "other", title: "別の候補", remoteRank: 60 })
    ];

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    const settings = getSettings(appDb.db);
    runRecommendation({ db: appDb.db, settings, reason: "initial" });
    const before = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
    const result = randomizeRecommendation({ db: appDb.db, settings, randomValue: 0 });
    const after = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
    const [event] = readRecommendationEvents(appDb.db, ["primary_randomized"]);

    expect(result).toEqual({ status: "selected", cycleId: before?.cycleId });
    expect(after?.cycleId).toBe(before?.cycleId);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.reason).toBe(before?.reason);
    expect(after?.primary?.bookmeterUrl).toBe("earlier-volume");
    expect(after?.secondaries.map((item) => item.bookmeterUrl)).toEqual(["current-primary", "current-secondary-1"]);
    expect(event?.cycleId).toBe(before?.cycleId);
    expect(event?.payload).toEqual({
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
  });

  it.each([
    { randomValue: 0.79, primaryUrl: "eligible-stacked" },
    { randomValue: 0.81, primaryUrl: "eligible-wish" }
  ])(
    "selects $primaryUrl at random value $randomValue with 80% stacked and 20% wish shares",
    ({ randomValue, primaryUrl }) => {
      const appDb = openTestAppDb();
      const books = [
        stackedBook({ bookmeterUrl: "stacked-1", title: "積読本1", remoteRank: 100 }),
        stackedBook({ bookmeterUrl: "stacked-2", title: "積読本2", remoteRank: 90 }),
        stackedBook({ bookmeterUrl: "stacked-3", title: "積読本3", remoteRank: 80 }),
        stackedBook({ bookmeterUrl: "eligible-stacked", title: "抽出対象の積読本", remoteRank: 70 }),
        wishBook({ bookmeterUrl: "eligible-wish", title: "抽出対象の読みたい本", remoteRank: 1 })
      ];

      syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
      const settings = getSettings(appDb.db);
      runRecommendation({ db: appDb.db, settings, reason: "initial" });
      randomizeRecommendation({ db: appDb.db, settings, randomValue });
      const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

      expect(current?.primary?.bookmeterUrl).toBe(primaryUrl);
      expect(readRecommendationEvents(appDb.db, ["primary_randomized"])).toMatchObject([
        { payload: { eligibleCount: 2 } }
      ]);
    }
  );

  it.each([
    { target: "book-2", source: "a secondary" },
    { target: "book-4", source: "an undisplayed current book" }
  ])("promotes $source to primary and records its event", ({ target }) => {
    const appDb = openTestAppDb();
    const books = [
      stackedBook({ bookmeterUrl: "book-1", title: "主推薦", remoteRank: 4 }),
      stackedBook({ bookmeterUrl: "book-2", title: "副推薦1", remoteRank: 3 }),
      stackedBook({ bookmeterUrl: "book-3", title: "副推薦2", remoteRank: 2 }),
      stackedBook({ bookmeterUrl: "book-4", title: "表示外の候補", remoteRank: 1 })
    ];

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    const settings = getSettings(appDb.db);
    runRecommendation({ db: appDb.db, settings, reason: "initial" });
    const before = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
    const cycleId = promoteRecommendation({ db: appDb.db, settings, bookmeterUrl: target });
    const current = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

    expect(before?.primary?.bookmeterUrl).toBe("book-1");
    expect(current?.primary?.bookmeterUrl).toBe(target);
    expect(cycleId).toBe(current?.cycleId);
    expect(readRecommendationEvents(appDb.db, ["secondary_promoted"])).toMatchObject([
      { eventType: "secondary_promoted", bookmeterUrl: target, cycleId: current?.cycleId }
    ]);
  });

  it("does not mutate the active cycle when no random candidate remains", () => {
    const appDb = openTestAppDb();
    const books = [
      stackedBook({ bookmeterUrl: "book-1", title: "候補1", remoteRank: 3 }),
      stackedBook({ bookmeterUrl: "book-2", title: "候補2", remoteRank: 2 }),
      stackedBook({ bookmeterUrl: "book-3", title: "候補3", remoteRank: 1 })
    ];

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    const settings = getSettings(appDb.db);
    runRecommendation({ db: appDb.db, settings, reason: "initial" });
    const before = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });
    const eventsBefore = readRecommendationEvents(appDb.db, []);
    const result = randomizeRecommendation({ db: appDb.db, settings, randomValue: 0.5 });
    const after = getCurrentRecommendation({ db: appDb.db, relatedBooks: [] });

    expect(result).toEqual({ status: "no_random_candidate" });
    expect(after).toEqual(before);
    expect(readRecommendationEvents(appDb.db, [])).toEqual(eventsBefore);
  });
});
