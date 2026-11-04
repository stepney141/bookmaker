import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { getCurrentSnapshots, getSettings } from "./db/appDb";
import { syncSourceBooks } from "./db/sync";
import { ensureBookEmbeddings } from "./embedding/repository";
import { runRecommendation } from "./recommendation/engine";
import { createReadingRecommenderService } from "./service";
import { openTestAppDb, readRecommendationEvents } from "./testing/appDb";
import { stackedBook } from "./testing/books";
import { createSourceDb, deleteBook, insertBook, updateBookTitle } from "./testing/sourceDb";

import type { EmbeddingProvider } from "./embedding/types";
import type { LearningPathPlanner, LearningPathPlanResult } from "./learningPath/types";
import type { SourceBook } from "../types/api";

function temporarySourceDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "reading-recommender-service-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "source.sqlite");
}

function mockEmbeddingProvider(): EmbeddingProvider {
  const embeddings = [
    { marker: "clinicaltrialfixture", vector: [1, 0] },
    { marker: "bayesianinferencefixture", vector: [0.95, 0.05] },
    { marker: "lexicaloverlapfixture", vector: [0, 1] }
  ];
  return {
    providerId: "mock",
    modelId: "mock-related",
    dimension: 2,
    embed(input) {
      return Promise.resolve(
        input.texts.map((text) => {
          const embedding = embeddings.find(({ marker }) => text.includes(marker));
          assert(embedding, "Embedding input has no fixture marker");
          return Float32Array.from(embedding.vector);
        })
      );
    }
  };
}

function mockLearningPathPlanner(): LearningPathPlanner & {
  readonly plan: ReturnType<typeof vi.fn<LearningPathPlanner["plan"]>>;
} {
  return {
    id: "anthropic",
    label: "Claude",
    modelId: "requested-model",
    plan: vi.fn<LearningPathPlanner["plan"]>(() =>
      Promise.resolve({
        modelId: "actual-model",
        output: {
          overview: "定義から学びます。",
          stages: [{ title: "基礎", goal: "定義を理解する", books: [{ id: "b1", reason: "定義を学べます。" }] }],
          gaps: ["応用の本がありません。"]
        }
      })
    )
  };
}

describe("reading recommender service", () => {
  function learningPathFixture(
    books: readonly SourceBook[],
    embeddingProvider?: EmbeddingProvider
  ): {
    readonly appDb: ReturnType<typeof openTestAppDb>;
    readonly sourceDbPath: string;
    readonly service: ReturnType<typeof createReadingRecommenderService>;
    readonly planner: ReturnType<typeof mockLearningPathPlanner>;
  } {
    const sourceDbPath = temporarySourceDbPath();
    createSourceDb(sourceDbPath, {
      wish: [],
      stacked: books.map((book) => ({
        bookmeter_url: book.bookmeterUrl,
        book_title: book.title,
        isbn_or_asin: book.isbnOrAsin,
        author: book.author,
        publisher: book.publisher,
        published_date: book.publishedDate,
        description: book.description
      }))
    });
    const appDb = openTestAppDb();
    syncSourceBooks({ db: appDb.db, booksDbPath: sourceDbPath, sourceBooks: books });
    const planner = mockLearningPathPlanner();
    const service = createReadingRecommenderService({
      appDb,
      booksDbPath: sourceDbPath,
      embeddingProvider,
      learningPathPlanners: [planner]
    });
    return { appDb, sourceDbPath, service, planner };
  }

  it("lists enabled planners and creates a path using their actual response model", async () => {
    const sourceBook = stackedBook({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 });
    const { service, planner } = learningPathFixture([sourceBook]);

    const result = await service.createLearningPath("圏論", "anthropic");

    expect(service.listLearningPathPlanners()).toEqual([
      { id: "anthropic", label: "Claude", modelId: "requested-model" }
    ]);
    expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
      topic: "圏論",
      candidates: [{ id: "b1", book: sourceBook }]
    });
    expect(result).toMatchObject({
      status: "created",
      learningPath: {
        topic: "圏論",
        overview: "定義から学びます。",
        stages: [
          {
            title: "基礎",
            goal: "定義を理解する",
            books: [{ ...sourceBook, reason: "定義を学べます。" }]
          }
        ],
        gaps: ["応用の本がありません。"],
        planner: { id: "anthropic", label: "Claude", modelId: "actual-model" }
      }
    });
  });

  it("reports an unavailable planner without invoking a configured planner", async () => {
    const { service, planner } = learningPathFixture([]);

    expect(await service.createLearningPath("圏論", "openai")).toEqual({ status: "planner_unavailable" });
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it("reports no candidates when the current list has no relevant lexical books", async () => {
    const { service, planner } = learningPathFixture([
      stackedBook({ bookmeterUrl: "history", title: "日本の近代史", remoteRank: 1 })
    ]);

    expect(await service.createLearningPath("圏論", "anthropic")).toEqual({ status: "no_candidates" });
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it("preserves a planner rejection as the failure cause", async () => {
    const { service, planner } = learningPathFixture([
      stackedBook({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 })
    ]);
    const cause = new Error("private provider response");
    planner.plan.mockRejectedValue(cause);

    expect(await service.createLearningPath("圏論", "anthropic")).toEqual({ status: "planner_failed", cause });
  });

  it("uses low-similarity current books and excludes deleted books from the embedding cache", async () => {
    const retained = stackedBook({ bookmeterUrl: "retained", title: "測度と積分", remoteRank: 1 });
    const deleted = stackedBook({ bookmeterUrl: "deleted", title: "削除された本", remoteRank: 2 });
    const provider: EmbeddingProvider = {
      providerId: "fake",
      modelId: "semantic",
      dimension: 2,
      embed: ({ texts, kind }) =>
        Promise.resolve(texts.map(() => Float32Array.from(kind === "query" ? [1, 0] : [0.4, 0.9])))
    };
    const { appDb, sourceDbPath, service, planner } = learningPathFixture([retained, deleted], provider);

    await ensureBookEmbeddings({ db: appDb.db, provider, books: getCurrentSnapshots(appDb.db) });
    deleteBook(sourceDbPath, "stacked", "deleted");
    const result = await service.createLearningPath("確率論", "anthropic");

    expect(result.status).toBe("created");
    expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
      topic: "確率論",
      candidates: [{ id: "b1", book: { bookmeterUrl: "retained" } }]
    });
  });

  it("keeps lexical candidates when query embedding returns no vector", async () => {
    const provider: EmbeddingProvider = {
      providerId: "fake",
      modelId: "empty-query",
      dimension: 2,
      embed: ({ texts, kind }) => Promise.resolve(kind === "query" ? [] : texts.map(() => Float32Array.from([1, 0])))
    };
    const { service, planner } = learningPathFixture(
      [
        stackedBook({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 }),
        stackedBook({ bookmeterUrl: "history", title: "日本の近代史", remoteRank: 2 })
      ],
      provider
    );

    expect((await service.createLearningPath("圏論", "anthropic")).status).toBe("created");
    expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
      topic: "圏論",
      candidates: [{ id: "b1", book: { bookmeterUrl: "category" } }]
    });
  });

  it.each(["document", "query"] as const)(
    "propagates %s embedding rejection without calling the planner",
    async (failedKind) => {
      const cause = new Error("embedding unavailable");
      const provider: EmbeddingProvider = {
        providerId: "fake",
        modelId: "rejected-embedding",
        dimension: 2,
        embed: ({ texts, kind }) =>
          kind === failedKind ? Promise.reject(cause) : Promise.resolve(texts.map(() => Float32Array.from([1, 0])))
      };
      const { service, planner } = learningPathFixture(
        [stackedBook({ bookmeterUrl: "category", title: "圏論入門", remoteRank: 1 })],
        provider
      );

      await expect(service.createLearningPath("圏論", "anthropic")).rejects.toBe(cause);
      expect(planner.plan).not.toHaveBeenCalled();
    }
  );

  it("syncs and reconciles source changes before preparing learning-path candidates", async () => {
    const { appDb, sourceDbPath, service, planner } = learningPathFixture([
      stackedBook({ bookmeterUrl: "original", title: "圏論入門", remoteRank: 1 })
    ]);

    const before = await service.run("initial");
    insertBook(sourceDbPath, "stacked", { bookmeter_url: "new", book_title: "圏論講義" });
    deleteBook(sourceDbPath, "stacked", "original");
    await service.createLearningPath("圏論", "anthropic");
    const current = await service.current();
    const completionEvents = readRecommendationEvents(appDb.db, ["primary_completed_by_db_absence"]);

    expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
      topic: "圏論",
      candidates: [{ id: "b1", book: { bookmeterUrl: "new" } }]
    });
    expect(completionEvents).toMatchObject([
      { bookmeterUrl: "original", cycleId: before?.cycleId, reason: "source_changed" }
    ]);
    expect(current?.primary?.bookmeterUrl).toBe("new");
    expect(current?.reason).toBe("source_changed");
    expect(await service.runIfSourceChanged()).toEqual({ changed: false, current });
  });

  it("allows queued reads and source sync during a pending plan while preserving its captured books", async () => {
    const sourceBook = stackedBook({ bookmeterUrl: "original", title: "圏論入門", remoteRank: 1 });
    const { sourceDbPath, service, planner } = learningPathFixture([sourceBook]);
    const started = Promise.withResolvers<void>();
    const planned = Promise.withResolvers<LearningPathPlanResult>();
    const response: LearningPathPlanResult = {
      modelId: "actual-model",
      output: {
        overview: "定義から学びます。",
        stages: [{ title: "基礎", goal: "定義を理解する", books: [{ id: "b1", reason: "定義を学べます。" }] }],
        gaps: []
      }
    };
    planner.plan.mockImplementation(() => {
      started.resolve();
      return planned.promise;
    });
    await service.run("initial");
    const pending = service.createLearningPath("圏論", "anthropic");

    try {
      await started.promise;
      expect(await service.current()).not.toBeNull();
      updateBookTitle(sourceDbPath, "stacked", "original", "圏論の改訂版");
      expect((await service.runIfSourceChanged()).changed).toBe(true);
      planned.resolve(response);
      const result = await pending;

      expect(result.status).toBe("created");
      expect(result.status === "created" ? result.learningPath.stages[0]?.books[0]?.title : null).toBe("圏論入門");
      expect(planner.plan.mock.calls[0]?.[0]).toMatchObject({
        topic: "圏論",
        candidates: [{ id: "b1", book: { title: "圏論入門" } }]
      });
    } finally {
      planned.resolve(response);
      await pending;
    }
  });

  it("uses document embeddings for related books when a provider is available", async () => {
    const sourceDbPath = temporarySourceDbPath();
    const appDb = openTestAppDb();
    const books = [
      stackedBook({
        bookmeterUrl: "primary",
        title: "臨床 試験",
        remoteRank: 10,
        description: "clinicaltrialfixture"
      }),
      stackedBook({
        bookmeterUrl: "lexical",
        title: "臨床 試験 入門",
        remoteRank: 2,
        description: "lexicaloverlapfixture"
      }),
      stackedBook({
        bookmeterUrl: "semantic",
        title: "ベイズ 推論",
        remoteRank: 9,
        description: "bayesianinferencefixture"
      })
    ];

    syncSourceBooks({ db: appDb.db, booksDbPath: "fixture", sourceBooks: books });
    runRecommendation({ db: appDb.db, settings: getSettings(appDb.db), reason: "initial" });
    const service = createReadingRecommenderService({
      appDb,
      booksDbPath: sourceDbPath,
      embeddingProvider: mockEmbeddingProvider()
    });

    const current = await service.current();

    expect(current?.primary?.bookmeterUrl).toBe("primary");
    expect(current?.relatedBooks.map((item) => item.bookmeterUrl)).toEqual(["semantic", "lexical"]);
    expect(current?.relatedBooks[0]?.reasons).toContain("説明文の意味が近い候補です。");
  });

  it("reconciles a removed primary before searching and leaves no source change for the watcher", async () => {
    const sourceDbPath = temporarySourceDbPath();
    const appDb = openTestAppDb();
    createSourceDb(sourceDbPath, {
      wish: [],
      stacked: [
        { bookmeter_url: "remaining", book_title: "次の候補" },
        { bookmeter_url: "primary", book_title: "現在の候補" }
      ]
    });
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    const before = await service.current();
    deleteBook(sourceDbPath, "stacked", "primary");
    const results = await service.search("候補");
    const current = await service.current();
    const completionEvents = readRecommendationEvents(appDb.db, ["primary_completed_by_db_absence"]);

    expect(before?.primary?.bookmeterUrl).toBe("primary");
    expect(results.map((result) => result.bookmeterUrl)).toEqual(["remaining"]);
    expect(completionEvents).toMatchObject([
      { bookmeterUrl: "primary", cycleId: before?.cycleId, reason: "source_changed" }
    ]);
    expect(current?.primary?.bookmeterUrl).toBe("remaining");
    expect(current?.reason).toBe("source_changed");
    expect(current?.cycleId).not.toBe(before?.cycleId);
    expect(await service.runIfSourceChanged()).toEqual({ changed: false, current });
  });

  it("reconciles removed and added books before randomizing the new cycle", async () => {
    const sourceDbPath = temporarySourceDbPath();
    const appDb = openTestAppDb();
    createSourceDb(sourceDbPath, {
      wish: [],
      stacked: [
        { bookmeter_url: "candidate", book_title: "確率論" },
        { bookmeter_url: "secondary-2", book_title: "代数学" },
        { bookmeter_url: "secondary-1", book_title: "幾何学" },
        { bookmeter_url: "primary", book_title: "解析学" }
      ]
    });
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    const before = await service.current();
    deleteBook(sourceDbPath, "stacked", "primary");
    insertBook(sourceDbPath, "stacked", { bookmeter_url: "new-book", book_title: "統計学" });
    const result = await service.randomize();
    const current = await service.current();
    const events = readRecommendationEvents(appDb.db, ["primary_completed_by_db_absence", "primary_randomized"]);

    assert(current);
    expect(before?.primary?.bookmeterUrl).toBe("primary");
    expect(result).toEqual({ status: "selected", current });
    expect(events).toMatchObject([
      {
        eventType: "primary_completed_by_db_absence",
        bookmeterUrl: "primary",
        cycleId: before?.cycleId,
        reason: "source_changed"
      },
      {
        eventType: "primary_randomized",
        bookmeterUrl: "candidate",
        cycleId: current.cycleId,
        reason: "random"
      }
    ]);
    const displayedUrls = [current.primary, ...current.secondaries].map((book) => book?.bookmeterUrl);
    expect(current.primary?.bookmeterUrl).toBe("candidate");
    expect(displayedUrls).toHaveLength(3);
    expect(displayedUrls).toContain("new-book");
    expect(displayedUrls).not.toContain("primary");
    expect(current.reason).toBe("source_changed");
    expect(current.cycleId).not.toBe(before?.cycleId);
    expect(await service.runIfSourceChanged()).toEqual({ changed: false, current });
  });

  it("does not create the same scheduled cycle twice", async () => {
    const sourceDbPath = temporarySourceDbPath();
    const appDb = openTestAppDb();
    createSourceDb(sourceDbPath, {
      wish: [],
      stacked: [
        { bookmeter_url: "secondary", book_title: "副推薦" },
        { bookmeter_url: "primary", book_title: "定期推薦" }
      ]
    });
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    const first = await service.runScheduled("2026-06-28T22:30:00Z");
    const repeated = await service.runScheduled("2026-06-28T22:30:00Z");

    expect(first).not.toBeNull();
    expect(repeated).toEqual(first);
    expect(service.getLatestScheduledFor()).toBe("2026-06-28T22:30:00Z");
  });

  it("runs a source-changed recommendation only when the source hash changes", async () => {
    const sourceDbPath = temporarySourceDbPath();
    const appDb = openTestAppDb();
    createSourceDb(sourceDbPath, {
      wish: [],
      stacked: [
        { bookmeter_url: "secondary", book_title: "副推薦" },
        { bookmeter_url: "primary", book_title: "初回推薦" }
      ]
    });
    const service = createReadingRecommenderService({ appDb, booksDbPath: sourceDbPath });

    await service.run("initial");
    const unchanged = await service.runIfSourceChanged();
    insertBook(sourceDbPath, "stacked", { bookmeter_url: "new-book", book_title: "前倒し推薦" });
    const changed = await service.runIfSourceChanged();

    expect(unchanged.changed).toBe(false);
    expect(changed.changed).toBe(true);
    expect(changed.current?.reason).toBe("source_changed");
  });
});
